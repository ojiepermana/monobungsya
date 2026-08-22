import { Elysia, t } from 'elysia';
import {
  type AuthCapability,
  type AuthIdentity,
  canAccessAuthCapability,
  signAuthIdentity,
} from '#project/contracts';
import {
  ForbiddenError,
  ServiceUnavailableError,
  toErrorResponse,
  UnauthorizedError,
} from '#project/errors';
import type { GatewayEnvironment } from '../config/env';

async function forwardRequest(
  request: Request,
  serviceUrl: string,
  publicPrefix: string,
  internalPrefix: string,
  environment: GatewayEnvironment,
  requiresIdentity = false,
  requestBody?: unknown,
  capability?: AuthCapability,
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const suffix = incomingUrl.pathname.slice(publicPrefix.length);
  const upstreamUrl = new URL(
    `${internalPrefix}${suffix}${incomingUrl.search}`,
    serviceUrl,
  );
  const headers = new Headers(request.headers);
  headers.set(
    'x-request-id',
    request.headers.get('x-request-id') ?? crypto.randomUUID(),
  );
  headers.set(
    'x-correlation-id',
    request.headers.get('x-correlation-id') ??
      headers.get('x-request-id') ??
      '',
  );

  if (requestBody !== undefined) {
    headers.delete('content-length');
  }

  if (requiresIdentity) {
    const identityError = await addIdentityHeaders(
      request,
      headers,
      upstreamUrl.pathname,
      environment,
      capability,
    );

    if (identityError) {
      return identityError;
    }
  }

  try {
    return await fetch(upstreamUrl, {
      method: request.method,
      headers,
      redirect: 'manual',
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : requestBody === undefined
            ? await request.arrayBuffer()
            : JSON.stringify(requestBody),
    });
  } catch {
    const mapped = toErrorResponse(
      new ServiceUnavailableError(
        'The requested internal service is unavailable',
      ),
      headers.get('x-request-id') ?? undefined,
    );

    return Response.json(mapped.body, {
      status: mapped.status,
      headers: { 'x-request-id': headers.get('x-request-id') ?? '' },
    });
  }
}

async function addIdentityHeaders(
  request: Request,
  headers: Headers,
  normalizedPath: string,
  environment: GatewayEnvironment,
  capability?: AuthCapability,
): Promise<Response | undefined> {
  if (!environment.INTERNAL_AUTH_SIGNING_SECRET) {
    return undefined;
  }

  const requestId = headers.get('x-request-id') ?? '';
  let response: Response;

  try {
    response = await fetch(
      new URL('/internal/auth/session', environment.serviceUrls.auth),
      {
        headers: {
          cookie: request.headers.get('cookie') ?? '',
          'x-request-id': requestId,
        },
      },
    );
  } catch {
    return mappedGatewayError(
      new ServiceUnavailableError('Authentication service is unavailable'),
      requestId,
    );
  }

  if (!response.ok) {
    return mappedGatewayError(
      new ServiceUnavailableError('Authentication service is unavailable'),
      requestId,
    );
  }

  const session = (await response.json()) as {
    authenticated?: boolean;
    user?: { id?: string; email?: string; role?: AuthIdentity['role'] };
    session?: { absoluteExpiresAt?: string };
  };

  if (
    !session.authenticated ||
    !session.user?.id ||
    !session.user.email ||
    !session.user.role ||
    !session.session?.absoluteExpiresAt
  ) {
    return mappedGatewayError(
      new UnauthorizedError('Authentication is required'),
      requestId,
    );
  }

  const expiresAt = session.session.absoluteExpiresAt;
  const expiry = Date.parse(expiresAt);

  if (
    !Number.isFinite(expiry) ||
    expiry <= Date.now() - environment.AUTH_CLOCK_SKEW_SECONDS * 1000
  ) {
    return mappedGatewayError(
      new UnauthorizedError('Authentication session has expired'),
      requestId,
    );
  }

  const identity: AuthIdentity = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    expiresAt,
  };

  // Checked here as well as inside the service, so a role that may not reach a
  // domain never gets a signed identity for it in the first place.
  if (capability && !canAccessAuthCapability(identity.role, capability)) {
    return mappedGatewayError(
      new ForbiddenError('The current role cannot access this resource'),
      requestId,
    );
  }

  const signature = signAuthIdentity(
    request.method,
    normalizedPath,
    identity,
    environment.INTERNAL_AUTH_SIGNING_SECRET,
  );

  headers.set('x-auth-user-id', identity.userId);
  headers.set('x-auth-email', identity.email);
  headers.set('x-auth-role', identity.role);
  headers.set('x-auth-expires-at', identity.expiresAt);
  headers.set('x-auth-signature', signature);
}

function mappedGatewayError(error: unknown, requestId: string): Response {
  const mapped = toErrorResponse(error, requestId);
  return Response.json(mapped.body, {
    status: mapped.status,
    headers: { 'x-request-id': requestId },
  });
}

const webAuthnResponse = t.Object(
  {
    id: t.String({ minLength: 1, maxLength: 1024 }),
    rawId: t.String({ minLength: 1, maxLength: 1024 }),
    type: t.String({ minLength: 1, maxLength: 32 }),
    response: t.Record(t.String(), t.Unknown()),
    clientExtensionResults: t.Optional(t.Record(t.String(), t.Unknown())),
    authenticatorAttachment: t.Optional(t.String({ maxLength: 32 })),
  },
  { additionalProperties: true },
);

const userIdParams = t.Object({ id: t.String({ format: 'uuid' }) });

/** Every status action takes the same mandatory reason. */
function statusActionRoute(summary: string) {
  return {
    params: userIdParams,
    body: t.Object({ reason: t.String({ minLength: 3, maxLength: 500 }) }),
    detail: { tags: ['Users'], summary },
  };
}

export function createProxyRoute(environment: GatewayEnvironment) {
  /**
   * The whole user domain is admin only (spec docs/specs/0007-user-management,
   * AC-8): a non admin is refused here, before an identity is ever signed.
   */
  const forwardUser = (request: Request, body?: unknown) =>
    forwardRequest(
      request,
      environment.serviceUrls.user,
      '/api/v1/users',
      '/internal/users',
      environment,
      true,
      body,
      'user-management',
    );

  return new Elysia({ name: 'gateway-proxy-routes' })
    .all('/api/v1/auth/identity', () => new Response(null, { status: 404 }), {
      detail: { hide: true },
    })
    .get(
      '/api/v1/auth/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      { detail: { tags: ['Auth'], summary: 'Forward auth status request' } },
    )
    .post(
      '/api/v1/auth/magic-link',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
          false,
          body,
        ),
      {
        body: t.Object({
          email: t.String({ format: 'email', minLength: 3, maxLength: 255 }),
        }),
        detail: { tags: ['Auth'], summary: 'Request an auth magic link' },
      },
    )
    .get(
      '/api/v1/auth/verify',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        query: t.Object({ token: t.String({ minLength: 20, maxLength: 512 }) }),
        detail: { tags: ['Auth'], summary: 'Consume an auth magic link' },
      },
    )
    .get(
      '/api/v1/auth/session',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        detail: { tags: ['Auth'], summary: 'Read the current auth session' },
      },
    )
    .post(
      '/api/v1/auth/logout',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        detail: { tags: ['Auth'], summary: 'Logout the current auth session' },
      },
    )
    .post(
      '/api/v1/auth/passkey/register/options',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        detail: {
          tags: ['Passkey'],
          summary: 'Start passkey registration',
        },
      },
    )
    .post(
      '/api/v1/auth/passkey/register/verify',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
          false,
          body,
        ),
      {
        body: t.Object({
          response: webAuthnResponse,
          label: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        }),
        detail: {
          tags: ['Passkey'],
          summary: 'Finish passkey registration',
        },
      },
    )
    .post(
      '/api/v1/auth/passkey/login/options',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        detail: {
          tags: ['Passkey'],
          summary: 'Start passkey sign in',
        },
      },
    )
    .post(
      '/api/v1/auth/passkey/login/verify',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
          false,
          body,
        ),
      {
        body: t.Object({ response: webAuthnResponse }),
        detail: {
          tags: ['Passkey'],
          summary: 'Finish passkey sign in',
        },
      },
    )
    .get(
      '/api/v1/auth/passkeys',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        detail: {
          tags: ['Passkey'],
          summary: "List the current user's passkeys",
        },
      },
    )
    .patch(
      '/api/v1/auth/passkeys/:id',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
          false,
          body,
        ),
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({ label: t.String({ minLength: 1, maxLength: 100 }) }),
        detail: {
          tags: ['Passkey'],
          summary: 'Rename a passkey',
        },
      },
    )
    .delete(
      '/api/v1/auth/passkeys/:id',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          tags: ['Passkey'],
          summary: 'Delete a passkey',
        },
      },
    )
    .get('/api/v1/users/status', ({ request }) => forwardUser(request), {
      detail: { tags: ['Users'], summary: 'Forward users status request' },
    })
    .get('/api/v1/users', ({ request }) => forwardUser(request), {
      query: t.Object({
        search: t.Optional(t.String()),
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Users'],
        summary: 'List users (requires the admin role)',
      },
    })
    .post('/api/v1/users', ({ body, request }) => forwardUser(request, body), {
      body: t.Object({
        id: t.String({ format: 'uuid' }),
        name: t.String({ minLength: 1, maxLength: 255 }),
        email: t.String({ format: 'email', minLength: 3, maxLength: 255 }),
        role: t.String({ minLength: 1, maxLength: 50 }),
      }),
      detail: {
        tags: ['Users'],
        summary: 'Create a user with a client generated UUIDv7 id',
      },
    })
    .get('/api/v1/users/:id', ({ request }) => forwardUser(request), {
      params: userIdParams,
      detail: { tags: ['Users'], summary: 'Read one user' },
    })
    .patch(
      '/api/v1/users/:id',
      ({ body, request }) => forwardUser(request, body),
      {
        params: userIdParams,
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
          role: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
        }),
        detail: {
          tags: ['Users'],
          summary: "Update a user's name and role",
        },
      },
    )
    .post(
      '/api/v1/users/:id/suspend',
      ({ body, request }) => forwardUser(request, body),
      statusActionRoute('Suspend a user'),
    )
    .post(
      '/api/v1/users/:id/unsuspend',
      ({ body, request }) => forwardUser(request, body),
      statusActionRoute('Unsuspend a user'),
    )
    .post(
      '/api/v1/users/:id/block',
      ({ body, request }) => forwardUser(request, body),
      statusActionRoute('Block a user'),
    )
    .post(
      '/api/v1/users/:id/unblock',
      ({ body, request }) => forwardUser(request, body),
      statusActionRoute('Unblock a user'),
    )
    .post(
      '/api/v1/users/:id/restore',
      ({ body, request }) => forwardUser(request, body),
      statusActionRoute('Restore a soft deleted user'),
    )
    .delete(
      '/api/v1/users/:id',
      ({ body, request }) => forwardUser(request, body),
      statusActionRoute('Soft delete a user'),
    )
    .get(
      '/api/v1/logs/audit-trails',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.logs,
          '/api/v1/logs',
          '/internal/logs',
          environment,
          true,
        ),
      {
        query: t.Object({
          search: t.Optional(t.String()),
          module: t.Optional(t.String()),
          action: t.Optional(t.String()),
          actorUserId: t.Optional(t.String({ format: 'uuid' })),
          page: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Logs'],
          summary: 'List audit trails (requires logs.read)',
        },
      },
    )
    .get(
      '/api/v1/logs/access-logs',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.logs,
          '/api/v1/logs',
          '/internal/logs',
          environment,
          true,
        ),
      {
        query: t.Object({
          search: t.Optional(t.String()),
          event: t.Optional(t.String()),
          outcome: t.Optional(t.String()),
          actorUserId: t.Optional(t.String({ format: 'uuid' })),
          page: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Logs'],
          summary: 'List access logs (requires logs.read)',
        },
      },
    )
    .get(
      '/api/v1/logs/application-logs',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.logs,
          '/api/v1/logs',
          '/internal/logs',
          environment,
          true,
        ),
      {
        query: t.Object({
          search: t.Optional(t.String()),
          level: t.Optional(t.String()),
          module: t.Optional(t.String()),
          event: t.Optional(t.String()),
          actorUserId: t.Optional(t.String({ format: 'uuid' })),
          page: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Logs'],
          summary: 'List application logs (requires logs.read)',
        },
      },
    )
    .all(
      '/api/v1/auth/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        detail: { hide: true },
      },
    )
    .all('/api/v1/users/*', ({ request }) => forwardUser(request), {
      detail: { hide: true },
    });
}
