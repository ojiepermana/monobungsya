import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { readAndVerifyAuthIdentity } from '#project/contracts';
import { ActivityLog } from '#project/logger';
import { createApp } from '../app';
import { loadGatewayEnv } from '../config/env';

const USER_ID = '0198f8a0-0000-7000-8000-000000000001';
const SECRET = 'integration-signing-secret';
const EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();

function sessionResponse() {
  return Response.json({
    authenticated: true,
    user: {
      id: USER_ID,
      email: 'admin@project.local',
      name: 'Admin',
      permissions: [],
    },
    session: { id: 'session-1', absoluteExpiresAt: EXPIRES_AT },
    sessionObservation: {
      state: 'authenticated',
      reason: null,
    },
  });
}

function fetchFor(
  permissions: string[],
  upstream: (request: Request) => Response | Promise<Response> = () =>
    Response.json({ data: [] }),
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/internal/auth/session') return sessionResponse();
    if (path === '/internal/access/permissions/lookup') {
      return Response.json({ permissions });
    }
    return upstream(request);
  };
}

describe('api gateway', () => {
  beforeEach(() => ActivityLog.configure(undefined));

  afterEach(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('exposes health and maps unavailable upstream services', async () => {
    const app = createApp(loadGatewayEnv({ NODE_ENV: 'test', PORT: '3000' }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error('user service unavailable');
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const health = await app.handle(new Request('http://localhost/health'));
      const unavailable = await app.handle(
        new Request('http://localhost/api/v1/users/status'),
      );
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({
        status: 'ok',
        service: 'api-gateway',
      });
      expect(unavailable.status).toBe(503);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards a protected user request with a signed canonical permission identity', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    globalThis.fetch = Object.assign(
      fetchFor(['user:user:manage'], (request) => {
        upstreamRequest = request;
        return Response.json({ data: [] });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users?search=system&page=1', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      const identity = readAndVerifyAuthIdentity(
        upstreamRequest?.headers ?? new Headers(),
        'GET',
        '/internal/users',
        SECRET,
      );
      expect(response.status).toBe(200);
      expect(identity).toEqual({
        userId: USER_ID,
        email: 'admin@project.local',
        permissions: ['user:user:manage'],
        expiresAt: EXPIRES_AT,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('denies a missing permission before reaching the protected service', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    let reachedUpstream = false;
    globalThis.fetch = Object.assign(
      fetchFor([], (request) => {
        reachedUpstream = new URL(request.url).hostname === 'user.internal';
        return Response.json({ data: [] });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { reason: 'insufficient_permissions' },
      });
      expect(reachedUpstream).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards observability reads with their dedicated permission', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        LOGS_SERVICE_URL: 'http://logs.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    globalThis.fetch = Object.assign(
      fetchFor(['observability:trace:read'], (request) => {
        upstreamRequest = request;
        return Response.json({
          data: [],
          prevCursor: null,
          nextCursor: null,
          options: { services: [], resourceKinds: [], resourceNames: [] },
          completeness: 'complete',
        });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/observability/traces', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      const identity = readAndVerifyAuthIdentity(
        upstreamRequest?.headers ?? new Headers(),
        'GET',
        '/internal/observability/traces',
        SECRET,
      );
      expect(response.status).toBe(200);
      expect(identity?.permissions).toEqual(['observability:trace:read']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses the access cache for session responses and never exposes roles', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(fetchFor(['logs:log:read']), {
      preconnect: originalFetch.preconnect,
    });

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/auth/session', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      expect(await response.json()).toEqual({
        authenticated: true,
        user: {
          id: USER_ID,
          email: 'admin@project.local',
          name: 'Admin',
          permissions: ['logs:log:read'],
        },
        session: { id: 'session-1', absoluteExpiresAt: EXPIRES_AT },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('derives a role free session summary from the effective public permissions', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );
    globalThis.fetch = Object.assign(
      fetchFor(['user:user:manage', 'logs:log:read', 'logs:log:read']),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/auth/session', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );

      expect(await response.json()).toMatchObject({
        authenticated: true,
        user: {
          permissions: ['logs:log:read', 'user:user:manage'],
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const record = writeAccess.mock.calls[0]?.[0];
      expect(record).toMatchObject({
        event: 'api_request',
        actor: { id: USER_ID, email: 'admin@project.local' },
        sessionId: 'session-1',
        metadata: {
          details: {
            kind: 'auth_session',
            state: 'authenticated',
            reason: null,
            permissionCount: 2,
          },
        },
      });
      expect(JSON.stringify(record)).not.toContain('role');
    } finally {
      writeAccess.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps verified actor context when the session permission lookup fails', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/internal/auth/session') return sessionResponse();
        if (path === '/internal/access/permissions/lookup') {
          return Response.json(
            { error: 'access unavailable' },
            { status: 503 },
          );
        }
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/auth/session', {
          headers: {
            cookie: 'project_session=session-value',
            'x-request-id': 'session-request-503',
          },
        }),
      );

      expect(response.status).toBe(503);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const record = writeAccess.mock.calls[0]?.[0];
      expect(record).toMatchObject({
        actor: { id: USER_ID, email: 'admin@project.local' },
        sessionId: 'session-1',
        requestId: 'session-request-503',
        failureReason: 'permission_lookup_failed',
        metadata: { details: null },
      });
    } finally {
      writeAccess.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('maps an unavailable auth service without exposing response details', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const path = new URL(input.toString()).pathname;
        if (path === '/internal/auth/session') {
          throw new Error('auth service unavailable');
        }
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users', {
          headers: {
            cookie: 'project_session=session-value',
            'x-request-id': 'auth-unavailable-request',
          },
        }),
      );

      expect(response.status).toBe(503);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const record = writeAccess.mock.calls[0]?.[0];
      expect(record).toMatchObject({
        requestId: 'auth-unavailable-request',
        failureReason: 'auth_service_unavailable',
        metadata: { details: null },
      });
      expect(JSON.stringify(record)).not.toContain('session-value');
    } finally {
      writeAccess.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('maps malformed auth JSON to a safe server error without response details', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const path = new URL(input.toString()).pathname;
        if (path === '/internal/auth/session') {
          return new Response('{not-json', {
            headers: { 'content-type': 'application/json' },
          });
        }
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users', {
          headers: {
            cookie: 'project_session=session-value',
            'x-request-id': 'auth-malformed-request',
          },
        }),
      );

      expect(response.status).toBe(500);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const record = writeAccess.mock.calls[0]?.[0];
      expect(record).toMatchObject({
        requestId: 'auth-malformed-request',
        metadata: { details: null },
      });
      expect(JSON.stringify(record)).not.toContain('not-json');
      expect(JSON.stringify(record)).not.toContain('session-value');
    } finally {
      writeAccess.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards access catalog routes to the access service', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = Object.assign(
      fetchFor(['access:permission:manage'], (request) => {
        requests.push(request);
        return Response.json({ data: [] });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/access/permissions?page=1', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      expect(response.status).toBe(200);
      expect(requests[0]?.url).toBe(
        'http://access.internal/api/v1/access/permissions?page=1',
      );
      expect(requests[0]?.headers.get('x-auth-permissions')).toBe(
        'access:permission:manage',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards the protected jobs operator list with a canonical identity', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        JOBS_SERVICE_URL: 'http://jobs.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    globalThis.fetch = Object.assign(
      fetchFor(['jobs:job:list'], (request) => {
        upstreamRequest = request;
        return Response.json({ data: [] });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/jobs?page=2&status=failed', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      const identity = readAndVerifyAuthIdentity(
        upstreamRequest?.headers ?? new Headers(),
        'GET',
        '/internal/jobs',
        SECRET,
      );
      expect(response.status).toBe(200);
      expect(upstreamRequest?.url).toBe(
        'http://jobs.internal/internal/jobs?page=2&status=failed',
      );
      expect(identity?.permissions).toEqual(['jobs:job:list']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('writes a protected access log row without leaking request secrets', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );
    globalThis.fetch = Object.assign(fetchFor(['user:user:manage']), {
      preconnect: originalFetch.preconnect,
    });

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users?token=secret-token', {
          headers: {
            cookie: 'project_session=session-value',
            'x-request-id': 'request-123',
          },
        }),
      );
      expect(response.status).toBe(200);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writeAccess).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(writeAccess.mock.calls[0]?.[0])).not.toContain(
        'secret-token',
      );
    } finally {
      writeAccess.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('records validated client context and denial status without query or identity leakage', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );
    globalThis.fetch = Object.assign(fetchFor([]), {
      preconnect: originalFetch.preconnect,
    });

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users?email=private@example.com', {
          headers: {
            'x-request-id': 'request-456',
            'x-correlation-id': 'trace-456',
            'x-client-route': '/users?search=email#section',
            'x-forwarded-for': '198.51.100.10',
            cookie: 'project_session=session-value',
          },
        }),
      );

      expect(response.status).toBe(403);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const record = writeAccess.mock.calls[0]?.[0];
      expect(writeAccess).toHaveBeenCalledTimes(1);
      expect(record).toMatchObject({
        event: 'permission_denied',
        outcome: 'failure',
        requestId: 'request-456',
        traceId: 'trace-456',
        path: '/api/v1/users',
        httpStatus: 403,
        actor: null,
        forwardedIp: '198.51.100.10',
        metadata: {
          schemaVersion: 1,
          correlationSource: 'client_header',
          client: { route: '/users', source: 'client_header' },
        },
      });
      expect(JSON.stringify(record)).not.toContain('private@example.com');
      expect(JSON.stringify(record)).not.toContain('session-value');
    } finally {
      writeAccess.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('does not write an access row for CORS preflight', async () => {
    const app = createApp(loadGatewayEnv({ NODE_ENV: 'test', PORT: '3000' }));
    const writeAccess = spyOn(ActivityLog, 'writeAccess').mockImplementation(
      () => undefined as never,
    );

    const response = await app.handle(
      new Request('http://localhost/api/v1/users', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:4200',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-correlation-id,x-client-route',
        },
      }),
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(writeAccess).not.toHaveBeenCalled();
    writeAccess.mockRestore();
  });

  it('AC-11 forwards group requests with the dedicated group permission identity', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    globalThis.fetch = Object.assign(
      fetchFor(['access:group:list'], (request) => {
        upstreamRequest = request;
        return Response.json({
          data: [],
          meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
          filters: {
            search: '',
            status: '',
            deleted: 'exclude',
            appliable: false,
          },
        });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/access/groups?status=active', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      const identity = readAndVerifyAuthIdentity(
        upstreamRequest?.headers ?? new Headers(),
        'GET',
        '/api/v1/access/groups',
        SECRET,
      );

      expect(response.status).toBe(200);
      expect(upstreamRequest?.url).toBe(
        'http://access.internal/api/v1/access/groups?status=active',
      );
      expect(identity?.permissions).toEqual(['access:group:list']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('AC-11 denies group requests before reaching access when group permission is missing', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );
    const originalFetch = globalThis.fetch;
    let accessReached = false;
    globalThis.fetch = Object.assign(
      fetchFor([], (request) => {
        accessReached = new URL(request.url).hostname === 'access.internal';
        return Response.json({ data: [] });
      }),
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/access/groups', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );

      expect(response.status).toBe(403);
      expect(accessReached).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
