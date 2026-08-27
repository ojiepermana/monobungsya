import { Elysia } from 'elysia';
import { hasResolvedPermission, PERMISSIONS } from '#project/acl';
import {
  type AuthIdentity,
  readAndVerifyAuthIdentity,
} from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { ForbiddenError, UnauthorizedError } from '#project/errors';
import { type ActivityActor, ActivityLog } from '#project/logger';
import { createSecret, hashSecret } from './auth.crypto';
import {
  type AuthNotificationSink,
  securityContextFromRequest,
} from './auth.notifications';
import { AuthRepository } from './auth.repository';
import {
  authStatusResponse,
  identityResponse,
  magicLinkAcceptedResponse,
  magicLinkQuery,
  magicLinkRequestBody,
  sessionResponse,
  totpCodeBody,
  totpEnrollmentResponse,
  totpFactorBody,
  totpOkResponse,
  totpReasonBody,
  totpRecoveryCodesResponse,
  totpStatusResponse,
  totpVerifyBody,
  totpVerifyResponse,
  userIdParams,
} from './auth.schema';
import { AuthService } from './auth.service';
import type { AuthMailer, SessionIdentity } from './auth.types';
import { TotpRepository } from './totp.repository';
import { TotpService } from './totp.service';

const MFA_COOKIE_NAME = 'mfa_challenge';

export interface AuthRouteOptions {
  database?: DatabaseClient;
  notificationSink?: AuthNotificationSink;
  mailer?: AuthMailer;
  webAppUrl?: string;
  cookieName?: string;
  cookieSecure?: boolean;
  signingSecret?: string;
  clockSkewSeconds?: number;
  totpEncryptionKey?: string;
  totpIssuer?: string;
}

export function createAuthRoute(
  serviceName: string,
  options: AuthRouteOptions = {},
) {
  const dependencies = options.database
    ? {
        database: options.database,
        notificationSink: options.notificationSink,
      }
    : undefined;
  const repository = new AuthRepository(dependencies);
  const totp = new TotpService(
    {
      encryptionKey: options.totpEncryptionKey ?? '',
      issuer: options.totpIssuer ?? 'Monobungsya',
    },
    new TotpRepository(dependencies),
  );
  const service = new AuthService(
    serviceName,
    repository,
    options.mailer,
    options.webAppUrl,
  );
  const cookieName = options.cookieName ?? 'project_session';
  const cookieSecure = options.cookieSecure ?? false;
  const signingSecret = options.signingSecret ?? '';
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;

  return new Elysia({ name: 'auth-routes' })
    .get('/internal/auth/status', () => service.getStatus(), {
      response: { 200: authStatusResponse },
      detail: { tags: ['Auth'], summary: 'Return auth module status' },
    })
    .get(
      '/internal/auth/identity',
      ({ request }) => {
        const identity = readAndVerifyAuthIdentity(
          request.headers,
          request.method,
          new URL(request.url).pathname,
          signingSecret,
          Date.now(),
          clockSkewSeconds,
        );
        if (!identity)
          throw new UnauthorizedError('A valid signed identity is required');
        return identity;
      },
      {
        response: { 200: identityResponse },
        detail: {
          hide: true,
          tags: ['Auth'],
          summary: 'Verify internal identity',
        },
      },
    )
    .post(
      '/internal/auth/magic-link',
      async ({ body, request }) => {
        const result = await service.requestMagicLink(
          body.email,
          clientIp(request),
          body.desktop ? { desktop: true } : {},
        );
        return Response.json({ accepted: result.accepted });
      },
      {
        body: magicLinkRequestBody,
        response: { 200: magicLinkAcceptedResponse },
        detail: {
          tags: ['Auth'],
          summary: 'Request a passwordless sign in link',
        },
      },
    )
    .get(
      '/internal/auth/verify',
      async ({ query, request }) => {
        try {
          const result = await service.verifyMagicLink(
            query.token,
            securityContextFromRequest(request, 'magic_link'),
          );
          if (result.status === 'mfa_required') {
            const headers = new Headers({
              Location: service.createMfaRedirect(result.purpose),
            });
            headers.append(
              'Set-Cookie',
              serializeMfaCookie(
                MFA_COOKIE_NAME,
                result.challengeToken,
                cookieSecure,
              ),
            );
            return new Response(null, { status: 302, headers });
          }
          const headers = new Headers({
            Location: service.createVerifyRedirect(),
          });
          headers.append(
            'Set-Cookie',
            serializeSessionCookie(
              cookieName,
              result.sessionToken ?? '',
              result.session.absoluteExpiresAt,
              cookieSecure,
            ),
          );
          return new Response(null, { status: 302, headers });
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            return Response.redirect(service.createVerifyErrorRedirect(), 302);
          }
          throw error;
        }
      },
      {
        query: magicLinkQuery,
        detail: {
          tags: ['Auth'],
          summary: 'Consume a passwordless sign in link',
        },
      },
    )
    .get(
      '/internal/auth/session',
      async ({ request }) =>
        Response.json(
          await service.getSession(
            readCookie(request.headers.get('cookie'), cookieName),
          ),
        ),
      {
        response: { 200: sessionResponse },
        detail: {
          tags: ['Auth'],
          summary: 'Return the current browser session',
        },
      },
    )
    .post(
      '/internal/auth/logout',
      async ({ request }) => {
        const sessionToken = readCookie(
          request.headers.get('cookie'),
          cookieName,
        );
        await service.logout(
          sessionToken,
          securityContextFromRequest(request, 'session_cookie'),
        );
        return new Response(null, {
          status: 204,
          headers: {
            'Set-Cookie': clearSessionCookie(cookieName, cookieSecure),
          },
        });
      },
      {
        detail: {
          tags: ['Auth'],
          summary: 'Revoke the current browser session',
        },
      },
    )
    .post(
      '/internal/auth/2fa/enroll',
      async ({ request }) => {
        const actor = await resolveTotpActor(
          request,
          repository,
          totp,
          cookieName,
        );
        return Response.json(await totp.enroll(actor.id));
      },
      {
        response: { 200: totpEnrollmentResponse },
        detail: { tags: ['Auth'], summary: 'Start TOTP enrollment' },
      },
    )
    .post(
      '/internal/auth/2fa/enroll/confirm',
      async ({ body, request }) => {
        const actor = await resolveTotpActor(
          request,
          repository,
          totp,
          cookieName,
        );
        const challengeToken = readCookie(
          request.headers.get('cookie'),
          MFA_COOKIE_NAME,
        );
        const sessionToken = challengeToken ? createSecret() : undefined;
        const result = await totp.confirmEnrollment(
          actor.id,
          body.code,
          challengeToken ? hashSecret(challengeToken) : undefined,
          sessionToken ? hashSecret(sessionToken) : undefined,
          securityContextFromRequest(request, 'totp'),
        );
        await writeTotpAudit(request, 'totp_enable', actor, actor.id);
        const headers = new Headers();
        if (result.session && sessionToken)
          headers.append(
            'Set-Cookie',
            serializeSessionCookie(
              cookieName,
              sessionToken,
              result.session.absoluteExpiresAt,
              cookieSecure,
            ),
          );
        if (challengeToken)
          headers.append(
            'Set-Cookie',
            clearMfaCookie(MFA_COOKIE_NAME, cookieSecure),
          );
        return Response.json(
          { recoveryCodes: result.recoveryCodes },
          { headers },
        );
      },
      {
        body: totpCodeBody,
        response: { 200: totpRecoveryCodesResponse },
        detail: { tags: ['Auth'], summary: 'Confirm TOTP enrollment' },
      },
    )
    .post(
      '/internal/auth/2fa/verify',
      async ({ body, request }) => {
        const challengeToken = readCookie(
          request.headers.get('cookie'),
          MFA_COOKIE_NAME,
        );
        const sessionToken = createSecret();
        const result = await totp.verifyLogin(
          challengeToken,
          body.code,
          body.recoveryCode,
          clientIp(request),
          hashSecret(sessionToken),
          securityContextFromRequest(
            request,
            body.recoveryCode ? 'recovery_code' : 'totp',
          ),
        );
        if (body.recoveryCode)
          await writeTotpAudit(
            request,
            'totp_recovery_consume',
            result.user,
            result.user.id,
          );
        const headers = new Headers();
        headers.append(
          'Set-Cookie',
          serializeSessionCookie(
            cookieName,
            sessionToken,
            result.session.absoluteExpiresAt,
            cookieSecure,
          ),
        );
        headers.append(
          'Set-Cookie',
          clearMfaCookie(MFA_COOKIE_NAME, cookieSecure),
        );
        return Response.json(
          { authenticated: true as const, redirectTo: '/' },
          { headers },
        );
      },
      {
        body: totpVerifyBody,
        response: { 200: totpVerifyResponse },
        detail: { tags: ['Auth'], summary: 'Verify a TOTP login challenge' },
      },
    )
    .get(
      '/internal/auth/2fa/status',
      async ({ request }) => {
        const actor = await requireSessionIdentity(
          request,
          repository,
          cookieName,
        );
        return Response.json(await totp.status(actor.id));
      },
      {
        response: { 200: totpStatusResponse },
        detail: { tags: ['Auth'], summary: 'Read the current TOTP status' },
      },
    )
    .post(
      '/internal/auth/2fa/disable',
      async ({ body, request }) => {
        const actor = await requireSessionIdentity(
          request,
          repository,
          cookieName,
        );
        await totp.disable(
          actor.id,
          body.code,
          body.recoveryCode,
          securityContextFromRequest(request, 'totp'),
        );
        await writeTotpAudit(request, 'totp_disable', actor, actor.id);
        return Response.json({ ok: true as const });
      },
      {
        body: totpFactorBody,
        response: { 200: totpOkResponse },
        detail: { tags: ['Auth'], summary: 'Disable TOTP' },
      },
    )
    .post(
      '/internal/auth/2fa/recovery-codes',
      async ({ body, request }) => {
        const actor = await requireSessionIdentity(
          request,
          repository,
          cookieName,
        );
        const recoveryCodes = await totp.regenerateRecoveryCodes(
          actor.id,
          body.code,
          securityContextFromRequest(request, 'totp'),
        );
        await writeTotpAudit(
          request,
          'totp_recovery_regenerate',
          actor,
          actor.id,
        );
        return Response.json({ recoveryCodes });
      },
      {
        body: totpCodeBody,
        response: { 200: totpRecoveryCodesResponse },
        detail: { tags: ['Auth'], summary: 'Regenerate TOTP recovery codes' },
      },
    )
    .get(
      '/internal/auth/admin/users/:id/2fa',
      async ({ params, request }) => {
        requireAdminIdentity(request, signingSecret, clockSkewSeconds);
        return Response.json(await totp.adminStatus(params.id));
      },
      {
        params: userIdParams,
        response: { 200: totpStatusResponse },
        detail: { tags: ['Auth'], summary: 'Read a user TOTP status' },
      },
    )
    .post(
      '/internal/auth/admin/users/:id/2fa/reset',
      async ({ body, params, request }) => {
        const actor = requireAdminIdentity(
          request,
          signingSecret,
          clockSkewSeconds,
        );
        await totp.adminReset(
          params.id,
          securityContextFromRequest(request, 'totp'),
        );
        await writeTotpAudit(
          request,
          'totp_admin_reset',
          actor,
          params.id,
          body.reason,
        );
        return Response.json({ ok: true as const });
      },
      {
        params: userIdParams,
        body: totpReasonBody,
        response: { 200: totpOkResponse },
        detail: { tags: ['Auth'], summary: 'Reset a user TOTP credential' },
      },
    );
}

export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

export function serializeSessionCookie(
  name: string,
  value: string,
  expiresAt: Date,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    'Max-Age=604800',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function serializeMfaCookie(
  name: string,
  value: string,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(Date.now() + 300_000).toUTCString()}`,
    'Max-Age=300',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function clearMfaCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

async function requireSessionIdentity(
  request: Request,
  repository: AuthRepository,
  cookieName: string,
): Promise<SessionIdentity> {
  const token = readCookie(request.headers.get('cookie'), cookieName);
  const identity = token
    ? await repository.findSession(hashSecret(token))
    : null;
  if (!identity) throw new UnauthorizedError('Authentication is required');
  return identity;
}

async function resolveTotpActor(
  request: Request,
  repository: AuthRepository,
  totp: TotpService,
  cookieName: string,
): Promise<AuthUserLike> {
  const sessionToken = readCookie(request.headers.get('cookie'), cookieName);
  const session = sessionToken
    ? await repository.findSession(hashSecret(sessionToken))
    : null;
  if (session) return session;
  const challengeToken = readCookie(
    request.headers.get('cookie'),
    MFA_COOKIE_NAME,
  );
  const userId = await totp.resolveEnrollmentChallenge(challengeToken);
  const user = userId ? await totp.user(userId) : null;
  if (!user) throw new UnauthorizedError('Authentication is required');
  return user;
}

type AuthUserLike = { id: string; email: string; name: string };

function requireAdminIdentity(
  request: Request,
  secret: string,
  clockSkewSeconds: number,
): AuthIdentity {
  const identity = readAndVerifyAuthIdentity(
    request.headers,
    request.method,
    new URL(request.url).pathname,
    secret,
    Date.now(),
    clockSkewSeconds,
  );
  if (!identity)
    throw new UnauthorizedError('A valid signed identity is required');
  if (!hasResolvedPermission(identity.permissions, PERMISSIONS.userUserManage))
    throw new ForbiddenError(
      'The current identity does not have the required permission',
    );
  return identity;
}

async function writeTotpAudit(
  request: Request,
  action: string,
  actor: ActivityActor,
  targetUserId: string,
  reason?: string,
): Promise<void> {
  await ActivityLog.writeAudit({
    action,
    module: 'auth',
    entityType: 'user_2fa',
    entityId: targetUserId,
    entityLabel: 'TOTP',
    reason: reason ?? null,
    changeSummary: action,
    actor,
    requestId: request.headers.get('x-request-id'),
    traceId: request.headers.get('x-correlation-id'),
    ipAddress: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  });
}

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  );
}
