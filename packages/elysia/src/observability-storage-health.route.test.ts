import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { PERMISSIONS } from '#project/acl';
import { signAuthIdentity } from '#project/contracts';
import { createErrorHandler } from './error-handler';
import {
  createObservabilityStorageHealthRoute,
  OBSERVABILITY_STORAGE_HEALTH_PERMISSIONS,
} from './observability-storage-health.route';

const PATH = '/internal/observability/storage-health';
const SECRET = 'storage-health-test-secret';
const CHECKED_AT = new Date('2026-08-26T12:00:00.000Z');

function signedHeaders(permissions: readonly string[]): Headers {
  const identity = {
    userId: '0198f8a0-0000-7000-8000-000000000001',
    email: 'operator@project.local',
    permissions: [...permissions],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  return new Headers({
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': identity.permissions.join(','),
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity('GET', PATH, identity, SECRET),
  });
}

function request(headers?: Headers): Request {
  return new Request(new URL(PATH, 'http://localhost'), { headers });
}

function createApp(
  source?: Parameters<
    typeof createObservabilityStorageHealthRoute
  >[0]['signalStore'],
) {
  return new Elysia()
    .use(createErrorHandler('storage-health-test-error-handler'))
    .use(
      createObservabilityStorageHealthRoute({
        signalStore: source,
        signingSecret: SECRET,
        clockSkewSeconds: 30,
        now: () => CHECKED_AT,
      }),
    );
}

describe('observability storage health route', () => {
  test('requires a valid signed identity', async () => {
    const response = await createApp().handle(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'A valid signed identity is required',
      },
    });
  });

  test('requires an observability permission', async () => {
    const response = await createApp().handle(
      request(signedHeaders([PERMISSIONS.logsLogRead])),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'The current identity does not have the required permission',
        reason: 'insufficient_permissions',
      },
    });
  });

  test('accepts every observability permission from the existing catalog', async () => {
    const app = createApp();

    for (const permission of OBSERVABILITY_STORAGE_HEALTH_PERMISSIONS) {
      const response = await app.handle(request(signedHeaders([permission])));
      expect(response.status).toBe(200);
    }
  });

  test('does not apply its signed identity guard to sibling routes', async () => {
    const app = createApp().get('/health', () => ({ status: 'ok' }));
    const response = await app.handle(
      new Request(new URL('/health', 'http://localhost')),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('returns only sanitized local diagnostics', async () => {
    const app = createApp({
      diagnostics: () => ({
        state: 'blind_spot' as const,
        queueDepth: 7,
        queueBytes: 512,
        droppedByReason: {
          queue_full: 3,
          'postgres://writer:secret@db': 9,
          negative: -1,
        },
        blindSpotSince: '2026-08-26T11:00:00.000Z',
        lastAcknowledgedAt: '2026-08-26T10:59:00.000Z',
        schemaVersion: 1,
        failureCode: 'postgres://writer:secret@db',
        targets: {
          clickhouse: {
            endpoint: 'https://operator:secret@clickhouse.internal',
          },
        },
      }),
    });

    const response = await app.handle(
      request(signedHeaders([PERMISSIONS.observabilityMetricRead])),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      state: 'blind_spot',
      blindSpotSince: '2026-08-26T11:00:00.000Z',
      droppedByReason: { queue_full: 3 },
      queueDepth: 7,
      queueBytes: 512,
      lastAcknowledgedAt: '2026-08-26T10:59:00.000Z',
      schemaVersion: 1,
      failureCode: 'storage_failure',
      checkedAt: '2026-08-26T12:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('clickhouse.internal');
  });
});
