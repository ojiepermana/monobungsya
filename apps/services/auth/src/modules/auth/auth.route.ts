import { Elysia } from 'elysia';
import { readAndVerifyAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { UnauthorizedError } from '#project/errors';
import { type ActivityActor, ActivityLog } from '#project/logger';
import { AuthRepository } from './auth.repository';
import {
  authStatusResponse,
  identityResponse,
  magicLinkAcceptedResponse,
  magicLinkQuery,
  magicLinkRequestBody,
  sessionResponse,
} from './auth.schema';
import { AuthService } from './auth.service';
import type { AuthMailer } from './auth.types';

export interface AuthRouteOptions {
  database?: DatabaseClient;
  mailer?: AuthMailer;
  webAppUrl?: string;
  cookieName?: string;
  cookieSecure?: boolean;
  signingSecret?: string;
  clockSkewSeconds?: number;
}

export function createAuthRoute(
  serviceName: string,
  options: AuthRouteOptions = {},
) {
  const service = new AuthService(
    serviceName,
    new AuthRepository(
      options.database ? { database: options.database } : undefined,
    ),
    options.mailer,
    options.webAppUrl,
  );
  const cookieName = options.cookieName ?? 'project_session';
  const cookieSecure = options.cookieSecure ?? false;
  const signingSecret = options.signingSecret ?? '';
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;
  const route = new Elysia({ name: 'auth-routes' }).get(
    '/internal/auth/status',
    () => service.getStatus(),
    {
      response: { 200: authStatusResponse },
      detail: {
        tags: ['Auth'],
        summary: 'Return auth module status',
      },
    },
  );

  return route
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

        if (!identity) {
          throw new UnauthorizedError('A valid signed identity is required');
        }

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
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
            'unknown',
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
          const session = await service.verifyMagicLink(query.token);
          recordAuthAccess({
            request,
            method: 'magic_link',
            event: 'sign_in',
            outcome: 'success',
            status: 302,
            actor: session,
            sessionId: session.sessionId,
          });
          const headers = new Headers({
            Location: service.createVerifyRedirect(),
          });
          headers.append(
            'Set-Cookie',
            serializeSessionCookie(
              cookieName,
              session.sessionToken,
              session.absoluteExpiresAt,
              cookieSecure,
            ),
          );
          return new Response(null, { status: 302, headers });
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            recordAuthAccess({
              request,
              method: 'magic_link',
              event: 'sign_in',
              outcome: 'failure',
              status: 401,
              failureReason: 'authentication_failed',
            });
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
      async ({ request }) => {
        const result = await service.getSession(
          readCookie(request.headers.get('cookie'), cookieName),
        );
        return Response.json(result);
      },
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
        const session = await service.getSession(sessionToken);
        await service.logout(sessionToken);
        recordAuthAccess({
          request,
          method: 'session_cookie',
          event: 'sign_out',
          outcome: 'success',
          status: 204,
          actor: session.user,
          sessionId: session.session?.id,
        });
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
    );
}

export function recordAuthAccess(input: {
  request: Request;
  method: 'magic_link' | 'passkey' | 'session_cookie';
  event: 'sign_in' | 'sign_out';
  outcome: 'success' | 'failure';
  status: number;
  actor?: ActivityActor | null;
  sessionId?: string | null;
  failureReason?: string | null;
}): void {
  const url = new URL(input.request.url);
  ActivityLog.writeAccess({
    event: input.event,
    outcome: input.outcome,
    authenticationMethod: input.method,
    accessChannel: 'web',
    guard: 'auth',
    actor: input.actor,
    sessionId: input.sessionId,
    requestId: input.request.headers.get('x-request-id'),
    traceId:
      input.request.headers.get('x-correlation-id') ??
      input.request.headers.get('x-request-id'),
    ipAddress: input.request.headers.get('x-real-ip'),
    forwardedIp: input.request.headers.get('x-forwarded-for'),
    userAgent: input.request.headers.get('user-agent'),
    routeName: url.pathname,
    path: url.pathname,
    method: input.request.method,
    httpStatus: input.status,
    failureReason: input.failureReason,
  });
}

export function readCookie(
  header: string | null,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');

    if (key === name) {
      return value.join('=');
    }
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
