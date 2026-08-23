import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Elysia } from 'elysia';
import type { DatabaseClient } from '#project/database';
import { UnauthorizedError } from '#project/errors';
import type { Logger } from '#project/logger';
import { AuthRepository } from './auth.repository';
import {
  readCookie,
  recordAuthAccess,
  serializeSessionCookie,
} from './auth.route';
import { PasskeyRepository } from './passkey.repository';
import {
  passkeyCeremonyOptionsResponse,
  passkeyIdParams,
  passkeyListResponse,
  passkeyLoginResponse,
  passkeyLoginVerifyBody,
  passkeyRegisterVerifyBody,
  passkeyRenameBody,
  passkeySummaryResponse,
} from './passkey.schema';
import { type PasskeyLoginResult, PasskeyService } from './passkey.service';

export interface PasskeyRouteOptions {
  database?: DatabaseClient;
  webAppUrl?: string;
  cookieName?: string;
  cookieSecure?: boolean;
  rpId?: string;
  rpName?: string;
  logger?: Logger;
}

export function createPasskeyRoute(options: PasskeyRouteOptions = {}) {
  const webAppUrl = options.webAppUrl ?? 'http://localhost:4200';
  const dependencies = options.database
    ? { database: options.database }
    : undefined;
  const service = new PasskeyService(
    {
      rpId: options.rpId ?? hostnameOf(webAppUrl),
      rpName: options.rpName ?? 'Monobungsya',
      expectedOrigin: originOf(webAppUrl),
      logger: options.logger,
    },
    new PasskeyRepository(dependencies),
    new AuthRepository(dependencies),
  );
  const cookieName = options.cookieName ?? 'project_session';
  const cookieSecure = options.cookieSecure ?? false;

  return new Elysia({ name: 'passkey-routes' })
    .post(
      '/internal/auth/passkey/register/options',
      async ({ request }) => {
        const identity = await service.requireSession(
          readCookie(request.headers.get('cookie'), cookieName),
        );

        return Response.json(
          await service.createRegistrationOptions(identity.id),
        );
      },
      {
        response: { 200: passkeyCeremonyOptionsResponse },
        detail: {
          tags: ['Passkey'],
          summary: 'Start passkey registration for the signed in user',
        },
      },
    )
    .post(
      '/internal/auth/passkey/register/verify',
      async ({ body, request }) => {
        const identity = await service.requireSession(
          readCookie(request.headers.get('cookie'), cookieName),
        );

        return Response.json(
          await service.verifyRegistration(
            identity.id,
            body.response as unknown as RegistrationResponseJSON,
            body.label,
          ),
        );
      },
      {
        body: passkeyRegisterVerifyBody,
        response: { 200: passkeySummaryResponse },
        detail: {
          tags: ['Passkey'],
          summary: 'Finish passkey registration',
        },
      },
    )
    .post(
      '/internal/auth/passkey/login/options',
      async ({ request }) =>
        Response.json(await service.createLoginOptions(clientIp(request))),
      {
        response: { 200: passkeyCeremonyOptionsResponse },
        detail: {
          tags: ['Passkey'],
          summary: 'Start passkey sign in',
        },
      },
    )
    .post(
      '/internal/auth/passkey/login/verify',
      async ({ body, request }) => {
        let result: PasskeyLoginResult;
        try {
          result = await service.verifyLogin(
            body.response as unknown as AuthenticationResponseJSON,
            clientIp(request),
          );
        } catch (error) {
          recordAuthAccess({
            request,
            method: 'passkey',
            event: 'sign_in',
            outcome: 'failure',
            status: error instanceof UnauthorizedError ? 401 : 400,
            failureReason: 'authentication_failed',
          });
          throw error;
        }

        recordAuthAccess({
          request,
          method: 'passkey',
          event: 'sign_in',
          outcome: 'success',
          status: 200,
          actor: result.user,
          sessionId: result.session.id,
        });

        return Response.json(
          {
            authenticated: true as const,
            user: result.user,
            session: {
              id: result.session.id,
              idleExpiresAt: result.session.idleExpiresAt.toISOString(),
              absoluteExpiresAt: result.session.absoluteExpiresAt.toISOString(),
            },
          },
          {
            headers: {
              'Set-Cookie': serializeSessionCookie(
                cookieName,
                result.sessionToken,
                result.session.absoluteExpiresAt,
                cookieSecure,
              ),
            },
          },
        );
      },
      {
        body: passkeyLoginVerifyBody,
        response: { 200: passkeyLoginResponse },
        detail: {
          tags: ['Passkey'],
          summary: 'Finish passkey sign in and open a session',
        },
      },
    )
    .get(
      '/internal/auth/passkeys',
      async ({ request }) => {
        const identity = await service.requireSession(
          readCookie(request.headers.get('cookie'), cookieName),
        );

        return Response.json({
          passkeys: await service.listPasskeys(identity.id),
        });
      },
      {
        response: { 200: passkeyListResponse },
        detail: {
          tags: ['Passkey'],
          summary: "List the signed in user's passkeys",
        },
      },
    )
    .patch(
      '/internal/auth/passkeys/:id',
      async ({ body, params, request }) => {
        const identity = await service.requireSession(
          readCookie(request.headers.get('cookie'), cookieName),
        );

        return Response.json(
          await service.renamePasskey(identity.id, params.id, body.label),
        );
      },
      {
        params: passkeyIdParams,
        body: passkeyRenameBody,
        response: { 200: passkeySummaryResponse },
        detail: {
          tags: ['Passkey'],
          summary: "Rename one of the signed in user's passkeys",
        },
      },
    )
    .delete(
      '/internal/auth/passkeys/:id',
      async ({ params, request }) => {
        const identity = await service.requireSession(
          readCookie(request.headers.get('cookie'), cookieName),
        );
        await service.deletePasskey(identity.id, params.id);

        return new Response(null, { status: 204 });
      },
      {
        params: passkeyIdParams,
        detail: {
          tags: ['Passkey'],
          summary: "Delete one of the signed in user's passkeys",
        },
      },
    );
}

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  );
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return 'localhost';
  }
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return 'http://localhost:4200';
  }
}
