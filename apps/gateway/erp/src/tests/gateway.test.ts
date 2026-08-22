import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readAndVerifyAuthIdentity } from '#project/contracts';
import { createApp } from '../app';
import { loadGatewayEnv } from '../config/env';

describe('api gateway', () => {
  it('exposes health and forwards public boundaries', async () => {
    const app = createApp(loadGatewayEnv({ NODE_ENV: 'test', PORT: '3000' }));
    const health = await app.handle(new Request('http://localhost/health'));
    const originalFetch = globalThis.fetch;
    const unavailableFetch = Object.assign(
      async () => {
        throw new Error('user service unavailable');
      },
      { preconnect: originalFetch.preconnect },
    );

    globalThis.fetch = unavailableFetch;

    try {
      const unavailableService = await app.handle(
        new Request('http://localhost/api/v1/users/status'),
      );

      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({
        status: 'ok',
        service: 'api-gateway',
      });
      expect(unavailableService.status).toBe(503);
      expect(await unavailableService.json()).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards the public request contract to the user service', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        USER_SERVICE_URL: 'http://user.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequest = new Request(input, init);
        return Response.json(
          { service: 'user', status: 'ok', module: 'users' },
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users/status?detail=full', {
          headers: {
            'x-request-id': 'request-123',
            'x-correlation-id': 'correlation-456',
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'user',
        status: 'ok',
        module: 'users',
      });
      expect(upstreamRequest?.url).toBe(
        'http://user.internal/internal/users/status?detail=full',
      );
      expect(upstreamRequest?.headers.get('x-request-id')).toBe('request-123');
      expect(upstreamRequest?.headers.get('x-correlation-id')).toBe(
        'correlation-456',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards validated auth request bodies', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequest = new Request(input, init);
        return Response.json({ accepted: true });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/auth/magic-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'system@project.local' }),
        }),
      );

      expect(response.status).toBe(200);
      expect(upstreamRequest?.url).toBe(
        'http://auth.internal/internal/auth/magic-link',
      );
      expect(await upstreamRequest?.json()).toEqual({
        email: 'system@project.local',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('forwards the protected user list with a signed admin identity', async () => {
    const secret = 'integration-signing-secret';
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === '/internal/auth/session') {
          return Response.json({
            authenticated: true,
            user: {
              id: '0198f8a0-0000-7000-8000-000000000001',
              email: 'admin@project.local',
              role: 'admin',
            },
            session: { absoluteExpiresAt: expiresAt },
          });
        }

        upstreamRequest = request;
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request(
          'http://localhost/api/v1/users?search=system&status=&page=1',
          { headers: { cookie: 'project_session=session-value' } },
        ),
      );

      expect(response.status).toBe(200);
      expect(upstreamRequest?.url).toBe(
        'http://user.internal/internal/users?search=system&status=&page=1',
      );
      expect(
        readAndVerifyAuthIdentity(
          upstreamRequest?.headers ?? new Headers(),
          'GET',
          '/internal/users',
          secret,
        ),
      ).toMatchObject({
        userId: '0198f8a0-0000-7000-8000-000000000001',
        email: 'admin@project.local',
        role: 'admin',
        expiresAt,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses the user boundary for a non admin role (spec 0007 AC-8)', async () => {
    const secret = 'integration-signing-secret';
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const originalFetch = globalThis.fetch;
    let reachedUpstream = false;

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === '/internal/auth/session') {
          return Response.json({
            authenticated: true,
            user: {
              id: '0198f8a0-0000-7000-8000-000000000003',
              email: 'manager@project.local',
              role: 'manager',
            },
            session: {
              absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          });
        }

        reachedUpstream = true;
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users?search=&status=&page=1', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );

      expect(response.status).toBe(403);
      // The refusal happens before any identity is signed, so the user
      // service is never called at all.
      expect(reachedUpstream).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses create, update, and status action user routes for a non admin role (spec 0007 AC-8)', async () => {
    const secret = 'integration-signing-secret';
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const originalFetch = globalThis.fetch;
    let reachedUpstream = false;

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === '/internal/auth/session') {
          return Response.json({
            authenticated: true,
            user: {
              id: '0198f8a0-0000-7000-8000-000000000004',
              email: 'staff@project.local',
              role: 'staff',
            },
            session: {
              absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          });
        }

        reachedUpstream = true;
        return Response.json({});
      },
      { preconnect: originalFetch.preconnect },
    );
    const cookie = { headers: { cookie: 'project_session=session-value' } };

    try {
      const create = await app.handle(
        new Request('http://localhost/api/v1/users', {
          method: 'POST',
          ...cookie,
          headers: { ...cookie.headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            id: '0198f8a0-0000-7000-8000-000000000099',
            name: 'New User',
            email: 'new@project.local',
            role: 'staff',
          }),
        }),
      );
      const update = await app.handle(
        new Request(
          'http://localhost/api/v1/users/0198f8a0-0000-7000-8000-000000000099',
          {
            method: 'PATCH',
            ...cookie,
            headers: { ...cookie.headers, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Renamed' }),
          },
        ),
      );
      const suspend = await app.handle(
        new Request(
          'http://localhost/api/v1/users/0198f8a0-0000-7000-8000-000000000099/suspend',
          {
            method: 'POST',
            ...cookie,
            headers: { ...cookie.headers, 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'policy violation' }),
          },
        ),
      );

      expect(create.status).toBe(403);
      expect(update.status).toBe(403);
      expect(suspend.status).toBe(403);
      // The refusal happens before any identity is signed, for every one of
      // these routes, so the user service is never called at all.
      expect(reachedUpstream).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves auth redirects from the upstream service', async () => {
    const upstreamServer = createServer((_request, response) => {
      response.writeHead(302, {
        Location: 'http://web.local/auth/callback-complete',
      });
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      upstreamServer.once('error', reject);
      upstreamServer.listen(0, '127.0.0.1', resolve);
    });

    const address = upstreamServer.address() as AddressInfo;
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: `http://127.0.0.1:${address.port}`,
      }),
    );

    try {
      const response = await app.handle(
        new Request(
          'http://localhost/api/v1/auth/verify?token=valid-token-for-test',
        ),
      );

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        'http://web.local/auth/callback-complete',
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstreamServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('validates a session and forwards a verifiable signed identity', async () => {
    const secret = 'integration-signing-secret';
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        USER_SERVICE_URL: 'http://user.internal',
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === '/internal/auth/session') {
          return Response.json({
            authenticated: true,
            user: {
              id: '0198f8a0-0000-7000-8000-000000000001',
              email: 'system@project.local',
              role: 'admin',
            },
            session: { absoluteExpiresAt: expiresAt },
          });
        }

        upstreamRequest = request;
        return Response.json({ status: 'ok' });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/users/status', {
          headers: { cookie: 'project_session=session-value' },
        }),
      );
      const identityHeaders = upstreamRequest?.headers;

      expect(response.status).toBe(200);
      expect(
        readAndVerifyAuthIdentity(
          identityHeaders ?? new Headers(),
          'GET',
          '/internal/users/status',
          secret,
        ),
      ).toMatchObject({
        userId: '0198f8a0-0000-7000-8000-000000000001',
        email: 'system@project.local',
        role: 'admin',
        expiresAt,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('guards the logs boundary with a session and forwards signed identity', async () => {
    const secret = 'integration-signing-secret';
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        PORT: '3000',
        AUTH_SERVICE_URL: 'http://auth.internal',
        LOGS_SERVICE_URL: 'http://logs.internal',
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    let sessionAuthenticated = false;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === '/internal/auth/session') {
          return Response.json(
            sessionAuthenticated
              ? {
                  authenticated: true,
                  user: {
                    id: '0198f8a0-0000-7000-8000-000000000001',
                    email: 'system@project.local',
                    role: 'admin',
                  },
                  session: { absoluteExpiresAt: expiresAt },
                }
              : { authenticated: false },
          );
        }

        upstreamRequest = request;
        return Response.json({ status: 'ok' });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const unauthenticated = await app.handle(
        new Request('http://localhost/api/v1/logs/audit-trails'),
      );
      expect(unauthenticated.status).toBe(401);

      sessionAuthenticated = true;
      const response = await app.handle(
        new Request(
          'http://localhost/api/v1/logs/audit-trails?search=invoice&page=2',
          { headers: { cookie: 'project_session=session-value' } },
        ),
      );

      expect(response.status).toBe(200);
      expect(upstreamRequest?.url).toBe(
        'http://logs.internal/internal/logs/audit-trails?search=invoice&page=2',
      );
      expect(
        readAndVerifyAuthIdentity(
          upstreamRequest?.headers ?? new Headers(),
          'GET',
          '/internal/logs/audit-trails',
          secret,
        ),
      ).toMatchObject({ role: 'admin' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
