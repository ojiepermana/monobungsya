import { describe, expect, it } from 'bun:test';
import { readAndVerifyAuthIdentity } from '#project/contracts';
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
});
