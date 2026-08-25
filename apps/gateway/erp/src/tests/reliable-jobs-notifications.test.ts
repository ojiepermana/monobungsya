import { afterEach, describe, expect, it } from 'bun:test';
import { readAndVerifyAuthIdentity } from '#project/contracts';
import { ActivityLog } from '#project/logger';
import { createApp } from '../app';
import { loadGatewayEnv } from '../config/env';

const SECRET = 'reliable-jobs-gateway-secret';
const USER_ID = '0198f8a0-0000-7000-8000-000000000001';
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

afterEach(() => ActivityLog.configure(undefined));

describe('gateway reliable jobs and notifications routes', () => {
  it('AC-3 and AC-4 forwards notifications with a signed subject identity', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        NOTIFICATION_SERVICE_URL: 'http://notification.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/internal/auth/session') return sessionResponse();
        if (path === '/internal/access/permissions/lookup') {
          return Response.json({ permissions: [] });
        }
        if (path === '/internal/notifications') {
          upstreamRequest = request;
          return Response.json({
            data: [],
            meta: { page: 1, perPage: 25, total: 0, totalPages: 0 },
            filters: { page: 1, category: '', unreadOnly: false },
            options: {
              categories: ['security', 'access', 'account', 'operational'],
            },
          });
        }
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/notifications'),
      );
      const identity = readAndVerifyAuthIdentity(
        upstreamRequest?.headers ?? new Headers(),
        'GET',
        '/internal/notifications',
        SECRET,
      );

      expect(response.status).toBe(200);
      expect(identity).toEqual({
        userId: USER_ID,
        email: 'admin@project.local',
        permissions: [],
        expiresAt: EXPIRES_AT,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('AC-11 blocks durable jobs before the jobs service when permission is missing', async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: 'test',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
        AUTH_SERVICE_URL: 'http://auth.internal',
        ACCESS_SERVICE_URL: 'http://access.internal',
        JOBS_SERVICE_URL: 'http://jobs.internal',
      }),
    );
    const originalFetch = globalThis.fetch;
    let reachedJobs = false;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === '/internal/auth/session') return sessionResponse();
        if (path === '/internal/access/permissions/lookup') {
          return Response.json({ permissions: [] });
        }
        reachedJobs = true;
        return Response.json({ data: [] });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request('http://localhost/api/v1/jobs'),
      );

      expect(response.status).toBe(403);
      expect(reachedJobs).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
