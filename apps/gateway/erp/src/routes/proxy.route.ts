import { Elysia, t } from 'elysia';
import {
  hasAnyRequiredPermission,
  normalizePermissions,
  PERMISSIONS,
} from '#project/acl';
import {
  ACCESS_PERMISSION_CHANGED_SUBJECT,
  type AccessPermissionChangedEvent,
  type AuthIdentity,
  signAuthIdentity,
} from '#project/contracts';
import {
  normalizeClientCorrelation,
  normalizeClientRoute,
  updateAccessLogContext,
} from '#project/elysia';
import {
  AppError,
  ForbiddenError,
  ServiceUnavailableError,
  toErrorResponse,
  UnauthorizedError,
} from '#project/errors';
import type { AuthSessionDetail } from '#project/logger';
import type { Subscriber } from '#project/messaging';
import {
  grantMutationResponse,
  grantsResponse,
  permissionListResponse,
  permissionResponse,
} from '../../../../services/access/src/modules/access/access.schema';
import {
  authStatusResponse,
  magicLinkAcceptedResponse,
  sessionResponse,
  totpEnrollmentResponse,
  totpOkResponse,
  totpRecoveryCodesResponse,
  totpStatusResponse,
  totpVerifyResponse,
} from '../../../../services/auth/src/modules/auth/auth.schema';
import {
  passkeyCeremonyOptionsResponse,
  passkeyListResponse,
  passkeyLoginResponse,
  passkeySummaryResponse,
} from '../../../../services/auth/src/modules/auth/passkey.schema';
import {
  jobDetailResponse,
  jobIdParams,
  jobResponse,
  jobRetryBody,
  jobSummaryResponse,
  jobsListQuery,
  jobsListResponse,
} from '../../../../services/jobs/src/modules/jobs/jobs.schema';
import {
  accessLogsResponse,
  applicationLogsResponse,
  auditTrailsResponse,
} from '../../../../services/logs/src/modules/logs/logs.schema';
import {
  totpRequirementResponse,
  userResponse,
  usersListResponse,
  usersStatusResponse,
} from '../../../../services/user/src/modules/users/users.schema';
import type { GatewayEnvironment } from '../config/env';
import { GatewayPermissionCache } from '../shared/permission-cache';

type ResponseTransform = (response: Response) => Promise<Response>;

async function forwardRequest(
  request: Request,
  serviceUrl: string,
  publicPrefix: string,
  internalPrefix: string,
  environment: GatewayEnvironment,
  requiresIdentity = false,
  requestBody?: unknown,
  requiredPermissions: readonly string[] = [],
  permissionCache?: GatewayPermissionCache,
  transformResponse?: ResponseTransform,
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const suffix = incomingUrl.pathname.slice(publicPrefix.length);
  const upstreamUrl = new URL(
    `${internalPrefix}${suffix}${incomingUrl.search}`,
    serviceUrl,
  );
  updateAccessLogContext(request, {
    routeName: normalizeRouteName(incomingUrl.pathname),
    requiredPermission: requiredPermissions[0] ?? null,
  });
  const headers = new Headers(request.headers);
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const correlation = normalizeClientCorrelation(
    request.headers.get('x-correlation-id'),
    requestId,
  );
  headers.set('x-request-id', requestId);
  headers.set('x-correlation-id', correlation.value);
  const clientRoute = normalizeClientRoute(
    request.headers.get('x-client-route'),
  );
  if (clientRoute) {
    headers.set('x-client-route', clientRoute);
  } else {
    headers.delete('x-client-route');
  }

  if (requestBody !== undefined) {
    headers.delete('content-length');
  }

  if (requiresIdentity) {
    const identityError = await addIdentityHeaders(
      request,
      headers,
      upstreamUrl.pathname,
      environment,
      requiredPermissions,
      permissionCache,
    );

    if (identityError) {
      return identityError;
    }
  }

  try {
    const response = await fetch(upstreamUrl, {
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
    return transformResponse ? transformResponse(response) : response;
  } catch (error) {
    updateAccessLogContext(request, {
      failureReason: 'service_unavailable',
    });
    const mapped = toErrorResponse(
      error instanceof AppError
        ? error
        : new ServiceUnavailableError(
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

async function mapPublicSessionResponse(
  request: Request,
  response: Response,
  permissionCache: GatewayPermissionCache,
): Promise<Response> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return response;
  }

  const body = (await response.json()) as InternalSessionResponse;
  let effectivePermissions: string[] = [];
  if (body.authenticated === true && body.user?.id) {
    try {
      effectivePermissions = normalizePermissions(
        await permissionCache.get(
          body.user.id,
          request.headers.get('x-request-id') ?? crypto.randomUUID(),
        ),
      );
      body.user.permissions = effectivePermissions;
    } catch (error) {
      updateAccessLogContext(request, {
        actor: {
          id: body.user.id,
          name: body.user.name,
          email: body.user.email,
        },
        sessionId: body.session?.id ?? null,
        failureReason: 'permission_lookup_failed',
        details: null,
      });
      const mapped = toErrorResponse(
        error,
        request.headers.get('x-request-id') ?? undefined,
      );
      return Response.json(mapped.body, {
        status: mapped.status,
        headers: { 'x-request-id': request.headers.get('x-request-id') ?? '' },
      });
    }
  }
  const observation = body.sessionObservation;
  if (isSessionObservation(observation)) {
    const detail: AuthSessionDetail = {
      kind: 'auth_session',
      state: observation.state,
      reason: observation.reason,
      permissionCount:
        observation.state === 'authenticated' ? effectivePermissions.length : 0,
    };
    updateAccessLogContext(request, {
      details: detail,
      actor:
        observation.state === 'authenticated' && body.user
          ? {
              id: body.user.id,
              name: body.user.name,
              email: body.user.email,
            }
          : null,
      sessionId:
        observation.state === 'authenticated'
          ? (body.session?.id ?? null)
          : null,
    });
  }

  const publicBody = publicSessionBody(body);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(publicBody), {
    status: response.status,
    headers,
  });
}

interface InternalSessionResponse {
  authenticated?: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    permissions?: unknown;
  };
  session?: {
    id: string;
    idleExpiresAt?: string;
    absoluteExpiresAt?: string;
  };
  sessionObservation?: {
    state: 'authenticated' | 'anonymous' | 'invalid';
    reason: AuthSessionDetail['reason'];
  };
}

function publicSessionBody(
  body: InternalSessionResponse,
): Record<string, unknown> {
  if (body.authenticated !== true) {
    return { authenticated: false };
  }

  const publicBody: Record<string, unknown> = { authenticated: true };
  if (body.user) {
    publicBody.user = {
      id: body.user.id,
      email: body.user.email,
      name: body.user.name,
      permissions: Array.isArray(body.user.permissions)
        ? body.user.permissions.filter(
            (permission): permission is string =>
              typeof permission === 'string',
          )
        : [],
    };
  }
  if (body.session) {
    publicBody.session = {
      id: body.session.id,
      idleExpiresAt: body.session.idleExpiresAt,
      absoluteExpiresAt: body.session.absoluteExpiresAt,
    };
  }
  return publicBody;
}

function isSessionObservation(
  value: InternalSessionResponse['sessionObservation'],
): value is NonNullable<InternalSessionResponse['sessionObservation']> {
  return Boolean(
    value &&
      (value.state === 'authenticated' ||
        value.state === 'anonymous' ||
        value.state === 'invalid'),
  );
}

async function addIdentityHeaders(
  request: Request,
  headers: Headers,
  normalizedPath: string,
  environment: GatewayEnvironment,
  requiredPermissions: readonly string[],
  permissionCache?: GatewayPermissionCache,
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
    updateAccessLogContext(request, {
      failureReason: 'auth_service_unavailable',
    });
    return mappedGatewayError(
      new ServiceUnavailableError('Authentication service is unavailable'),
      requestId,
    );
  }

  if (!response.ok) {
    updateAccessLogContext(request, {
      failureReason: 'auth_service_unavailable',
    });
    return mappedGatewayError(
      new ServiceUnavailableError('Authentication service is unavailable'),
      requestId,
    );
  }

  const session = (await response.json()) as {
    authenticated?: boolean;
    user?: { id?: string; email?: string; permissions?: unknown };
    session?: { id?: string; absoluteExpiresAt?: string };
  };

  if (
    !session.authenticated ||
    !session.user?.id ||
    !session.user.email ||
    !Array.isArray(session.user.permissions) ||
    session.user.permissions.some(
      (permission) => typeof permission !== 'string',
    ) ||
    !session.session?.absoluteExpiresAt
  ) {
    updateAccessLogContext(request, {
      failureReason: 'authentication_required',
    });
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
    updateAccessLogContext(request, {
      failureReason: 'authentication_required',
    });
    return mappedGatewayError(
      new UnauthorizedError('Authentication session has expired'),
      requestId,
    );
  }

  const identity: AuthIdentity = {
    userId: session.user.id,
    email: session.user.email,
    permissions: session.user.permissions,
    expiresAt,
  };

  const cache =
    permissionCache ??
    new GatewayPermissionCache(
      environment.serviceUrls.access,
      environment.GATEWAY_PERMISSION_CACHE_TTL_MS,
      environment.GATEWAY_PERMISSION_CACHE_MAX_ENTRIES,
    );
  let effectivePermissions: string[];
  try {
    effectivePermissions = await cache.get(identity.userId, requestId);
  } catch (error) {
    updateAccessLogContext(request, {
      failureReason: 'permission_lookup_failed',
    });
    return mappedGatewayError(error, requestId);
  }

  identity.permissions = effectivePermissions;

  if (
    requiredPermissions.length > 0 &&
    !hasAnyRequiredPermission(identity.permissions, requiredPermissions)
  ) {
    updateAccessLogContext(request, {
      failureReason: 'permission_denied',
    });
    return mappedGatewayError(
      new ForbiddenError(
        'The current identity does not have the required permission',
        'insufficient_permissions',
      ),
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
  headers.set('x-auth-permissions', identity.permissions.join(','));
  headers.set('x-auth-expires-at', identity.expiresAt);
  headers.set('x-auth-signature', signature);
  updateAccessLogContext(request, {
    actor: { id: identity.userId, email: identity.email },
    authenticationMethod: 'session_cookie',
    sessionId: session.session?.id ?? null,
  });
}

function normalizeRouteName(path: string): string {
  return path.replace(
    /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=\/|$)/gi,
    '/:id',
  );
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

export function createProxyRoute(
  environment: GatewayEnvironment,
  options: { messaging?: Subscriber } = {},
) {
  const permissionCache = new GatewayPermissionCache(
    environment.serviceUrls.access,
    environment.GATEWAY_PERMISSION_CACHE_TTL_MS,
    environment.GATEWAY_PERMISSION_CACHE_MAX_ENTRIES,
  );
  options.messaging?.subscribe<AccessPermissionChangedEvent>(
    ACCESS_PERMISSION_CHANGED_SUBJECT,
    (event) => permissionCache.invalidate(event.userId),
  );

  const forwardUser = (
    request: Request,
    body?: unknown,
    requiredPermission: string = PERMISSIONS.userUserList,
  ) =>
    forwardRequest(
      request,
      environment.serviceUrls.user,
      '/api/v1/users',
      '/internal/users',
      environment,
      true,
      body,
      [requiredPermission],
      permissionCache,
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
      {
        response: { 200: authStatusResponse },
        detail: { tags: ['Auth'], summary: 'Forward auth status request' },
      },
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
          desktop: t.Optional(t.Literal(true)),
        }),
        response: { 200: magicLinkAcceptedResponse },
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
          false,
          undefined,
          undefined,
          permissionCache,
          (response) =>
            mapPublicSessionResponse(request, response, permissionCache),
        ),
      {
        response: { 200: sessionResponse },
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
        response: { 204: t.Void() },
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
        response: { 200: passkeyCeremonyOptionsResponse },
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
        response: { 200: passkeySummaryResponse },
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
        response: { 200: passkeyCeremonyOptionsResponse },
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
        response: { 200: passkeyLoginResponse },
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
        response: { 200: passkeyListResponse },
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
        response: { 200: passkeySummaryResponse },
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
        response: { 204: t.Void() },
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          tags: ['Passkey'],
          summary: 'Delete a passkey',
        },
      },
    )
    .post(
      '/api/v1/auth/2fa/enroll',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        response: { 200: totpEnrollmentResponse },
        detail: { tags: ['Auth'], summary: 'Start TOTP enrollment' },
      },
    )
    .post(
      '/api/v1/auth/2fa/enroll/confirm',
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
        response: { 200: totpRecoveryCodesResponse },
        body: t.Object({ code: t.String({ pattern: '^[0-9]{6}$' }) }),
        detail: { tags: ['Auth'], summary: 'Confirm TOTP enrollment' },
      },
    )
    .post(
      '/api/v1/auth/2fa/verify',
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
        response: { 200: totpVerifyResponse },
        body: t.Object({
          code: t.Optional(t.String({ pattern: '^[0-9]{6}$' })),
          recoveryCode: t.Optional(t.String({ minLength: 8, maxLength: 32 })),
        }),
        detail: { tags: ['Auth'], summary: 'Verify a TOTP login challenge' },
      },
    )
    .get(
      '/api/v1/auth/2fa/status',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
        ),
      {
        response: { 200: totpStatusResponse },
        detail: { tags: ['Auth'], summary: 'Read the current TOTP status' },
      },
    )
    .post(
      '/api/v1/auth/2fa/disable',
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
        response: { 200: totpOkResponse },
        body: t.Object({
          code: t.Optional(t.String({ pattern: '^[0-9]{6}$' })),
          recoveryCode: t.Optional(t.String({ minLength: 8, maxLength: 32 })),
        }),
        detail: { tags: ['Auth'], summary: 'Disable TOTP' },
      },
    )
    .post(
      '/api/v1/auth/2fa/recovery-codes',
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
        response: { 200: totpRecoveryCodesResponse },
        body: t.Object({ code: t.String({ pattern: '^[0-9]{6}$' }) }),
        detail: { tags: ['Auth'], summary: 'Regenerate TOTP recovery codes' },
      },
    )
    .get(
      '/api/v1/auth/admin/users/:id/2fa',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
          true,
          undefined,
          [PERMISSIONS.userUserManage],
          permissionCache,
        ),
      {
        response: { 200: totpStatusResponse },
        params: userIdParams,
        detail: { tags: ['Auth'], summary: 'Read a user TOTP status' },
      },
    )
    .post(
      '/api/v1/auth/admin/users/:id/2fa/reset',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          '/api/v1/auth',
          '/internal/auth',
          environment,
          true,
          body,
          [PERMISSIONS.userUserManage],
          permissionCache,
        ),
      {
        response: { 200: totpOkResponse },
        params: userIdParams,
        body: t.Object({ reason: t.String({ minLength: 3, maxLength: 500 }) }),
        detail: { tags: ['Auth'], summary: 'Reset a user TOTP credential' },
      },
    )
    .get(
      '/api/v1/users/status',
      ({ request }) =>
        forwardUser(request, undefined, PERMISSIONS.userUserRead),
      {
        response: { 200: usersStatusResponse },
        detail: { tags: ['Users'], summary: 'Forward users status request' },
      },
    )
    .get(
      '/api/v1/users',
      ({ request }) =>
        forwardUser(request, undefined, PERMISSIONS.userUserList),
      {
        response: { 200: usersListResponse },
        query: t.Object({
          search: t.Optional(t.String()),
          status: t.Optional(t.String()),
          page: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Users'],
          summary: 'List users (requires user:user:list)',
        },
      },
    )
    .post(
      '/api/v1/users',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserCreate),
      {
        response: { 200: userResponse },
        body: t.Object({
          id: t.String({ format: 'uuid' }),
          name: t.String({ minLength: 1, maxLength: 255 }),
          email: t.String({ format: 'email', minLength: 3, maxLength: 255 }),
        }),
        detail: {
          tags: ['Users'],
          summary: 'Create a user with a client generated UUIDv7 id',
        },
      },
    )
    .get(
      '/api/v1/users/:id',
      ({ request }) =>
        forwardUser(request, undefined, PERMISSIONS.userUserRead),
      {
        response: { 200: userResponse },
        params: userIdParams,
        detail: { tags: ['Users'], summary: 'Read one user' },
      },
    )
    .patch(
      '/api/v1/users/:id',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserUpdate),
      {
        response: { 200: userResponse },
        params: userIdParams,
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
        }),
        detail: {
          tags: ['Users'],
          summary: "Update a user's profile",
        },
      },
    )
    .post(
      '/api/v1/users/:id/suspend',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserSuspend),
      {
        ...statusActionRoute('Suspend a user'),
        response: { 200: userResponse },
      },
    )
    .post(
      '/api/v1/users/:id/unsuspend',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserSuspend),
      {
        ...statusActionRoute('Unsuspend a user'),
        response: { 200: userResponse },
      },
    )
    .post(
      '/api/v1/users/:id/block',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserBlock),
      { ...statusActionRoute('Block a user'), response: { 200: userResponse } },
    )
    .post(
      '/api/v1/users/:id/unblock',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserBlock),
      {
        ...statusActionRoute('Unblock a user'),
        response: { 200: userResponse },
      },
    )
    .post(
      '/api/v1/users/:id/restore',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserRestore),
      {
        ...statusActionRoute('Restore a soft deleted user'),
        response: { 200: userResponse },
      },
    )
    .delete(
      '/api/v1/users/:id',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserDelete),
      {
        ...statusActionRoute('Soft delete a user'),
        response: { 200: userResponse },
      },
    )
    .put(
      '/api/v1/users/:id/2fa-requirement',
      ({ body, request }) =>
        forwardUser(request, body, PERMISSIONS.userUserManage),
      {
        response: { 200: totpRequirementResponse },
        params: userIdParams,
        body: t.Object({
          required: t.Boolean(),
          reason: t.String({ minLength: 3, maxLength: 500 }),
        }),
        detail: {
          tags: ['Users'],
          summary: 'Require or release TOTP for a user',
        },
      },
    )
    .get(
      '/api/v1/jobs',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.jobs,
          '/api/v1/jobs',
          '/internal/jobs',
          environment,
          true,
          undefined,
          [PERMISSIONS.jobsJobList],
          permissionCache,
        ),
      {
        query: jobsListQuery,
        response: { 200: jobsListResponse },
        detail: { tags: ['Jobs'], summary: 'List durable jobs' },
      },
    )
    .get(
      '/api/v1/jobs/summary',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.jobs,
          '/api/v1/jobs',
          '/internal/jobs',
          environment,
          true,
          undefined,
          [PERMISSIONS.jobsJobRead],
          permissionCache,
        ),
      {
        response: { 200: jobSummaryResponse },
        detail: { tags: ['Jobs'], summary: 'Read the durable jobs summary' },
      },
    )
    .get(
      '/api/v1/jobs/:id',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.jobs,
          '/api/v1/jobs',
          '/internal/jobs',
          environment,
          true,
          undefined,
          [PERMISSIONS.jobsJobRead],
          permissionCache,
        ),
      {
        params: jobIdParams,
        response: { 200: jobDetailResponse },
        detail: { tags: ['Jobs'], summary: 'Read a durable job' },
      },
    )
    .post(
      '/api/v1/jobs/:id/retry',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.jobs,
          '/api/v1/jobs',
          '/internal/jobs',
          environment,
          true,
          body,
          [PERMISSIONS.jobsJobRetry],
          permissionCache,
        ),
      {
        params: jobIdParams,
        body: jobRetryBody,
        response: { 200: jobResponse },
        detail: { tags: ['Jobs'], summary: 'Retry a failed durable job' },
      },
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
          undefined,
          [PERMISSIONS.logsLogRead],
          permissionCache,
        ),
      {
        response: { 200: auditTrailsResponse },
        query: t.Object({
          search: t.Optional(t.String()),
          module: t.Optional(t.String()),
          action: t.Optional(t.String()),
          actorUserId: t.Optional(t.String({ format: 'uuid' })),
          page: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Logs'],
          summary: 'List audit trails (requires logs:log:read)',
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
          undefined,
          [PERMISSIONS.logsLogRead],
          permissionCache,
        ),
      {
        response: { 200: accessLogsResponse },
        query: t.Object({
          search: t.Optional(t.String()),
          event: t.Optional(t.String()),
          outcome: t.Optional(t.String()),
          traceId: t.Optional(t.String()),
          actorUserId: t.Optional(t.String({ format: 'uuid' })),
          page: t.Optional(t.String()),
        }),
        detail: {
          tags: ['Logs'],
          summary: 'List access logs (requires logs:log:read)',
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
          undefined,
          [PERMISSIONS.logsLogRead],
          permissionCache,
        ),
      {
        response: { 200: applicationLogsResponse },
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
          summary: 'List application logs (requires logs:log:read)',
        },
      },
    )
    .get(
      '/api/v1/access/permissions',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          undefined,
          [PERMISSIONS.accessPermissionList],
          permissionCache,
        ),
      {
        response: { 200: permissionListResponse },
        query: t.Object({
          page: t.Optional(t.String()),
          pageSize: t.Optional(t.String()),
          search: t.Optional(t.String()),
          namespace: t.Optional(t.String()),
        }),
        detail: { tags: ['Access'], summary: 'List the permission catalog' },
      },
    )
    .post(
      '/api/v1/access/permissions',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          body,
          [PERMISSIONS.accessPermissionCreate],
          permissionCache,
        ),
      {
        response: { 200: permissionResponse },
        body: t.Object({
          name: t.String({ minLength: 5, maxLength: 100 }),
          description: t.Optional(
            t.Union([t.String({ maxLength: 2000 }), t.Null()]),
          ),
        }),
        detail: { tags: ['Access'], summary: 'Create a permission' },
      },
    )
    .get(
      '/api/v1/access/permissions/:id',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          undefined,
          [PERMISSIONS.accessPermissionRead],
          permissionCache,
        ),
      {
        response: { 200: permissionResponse },
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { tags: ['Access'], summary: 'Read a permission' },
      },
    )
    .put(
      '/api/v1/access/permissions/:id',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          body,
          [PERMISSIONS.accessPermissionUpdate],
          permissionCache,
        ),
      {
        response: { 200: permissionResponse },
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: t.Object({
          description: t.Union([t.String({ maxLength: 2000 }), t.Null()]),
        }),
        detail: {
          tags: ['Access'],
          summary: 'Update a permission description',
        },
      },
    )
    .delete(
      '/api/v1/access/permissions/:id',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          undefined,
          [PERMISSIONS.accessPermissionDelete],
          permissionCache,
        ),
      {
        response: { 204: t.Void() },
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { tags: ['Access'], summary: 'Delete a permission' },
      },
    )
    .get(
      '/api/v1/access/users/:userId/permissions',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          undefined,
          [PERMISSIONS.accessPermissionUserList],
          permissionCache,
        ),
      {
        response: { 200: grantsResponse },
        params: t.Object({ userId: t.String({ format: 'uuid' }) }),
        detail: { tags: ['Access'], summary: 'List a user permissions' },
      },
    )
    .post(
      '/api/v1/access/users/:userId/permissions',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          body,
          [PERMISSIONS.accessPermissionUserCreate],
          permissionCache,
        ),
      {
        response: { 200: grantMutationResponse },
        params: t.Object({ userId: t.String({ format: 'uuid' }) }),
        body: t.Object({
          permissionIds: t.Array(t.String({ format: 'uuid' }), {
            minItems: 1,
            maxItems: 100,
          }),
        }),
        detail: { tags: ['Access'], summary: 'Grant permissions to a user' },
      },
    )
    .post(
      '/api/v1/access/users/:userId/permissions/copy',
      ({ body, request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          body,
          [PERMISSIONS.accessPermissionUserCreate],
          permissionCache,
        ),
      {
        response: { 200: grantMutationResponse },
        params: t.Object({ userId: t.String({ format: 'uuid' }) }),
        body: t.Object({ sourceUserId: t.String({ format: 'uuid' }) }),
        detail: {
          tags: ['Access'],
          summary: 'Copy permissions from another user',
        },
      },
    )
    .delete(
      '/api/v1/access/users/:userId/permissions/:permissionId',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          undefined,
          [PERMISSIONS.accessPermissionUserDelete],
          permissionCache,
        ),
      {
        response: { 204: t.Void() },
        params: t.Object({
          userId: t.String({ format: 'uuid' }),
          permissionId: t.String({ format: 'uuid' }),
        }),
        detail: { tags: ['Access'], summary: 'Revoke a user permission' },
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
    .all(
      '/api/v1/access/*',
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.access,
          '/api/v1/access',
          '/api/v1/access',
          environment,
          true,
          undefined,
          [PERMISSIONS.accessPermissionRead],
          permissionCache,
        ),
      {
        detail: { hide: true },
      },
    )
    .all(
      '/api/v1/users/*',
      ({ request }) =>
        forwardUser(request, undefined, PERMISSIONS.userUserRead),
      {
        detail: { hide: true },
      },
    );
}
