import { describe, expect, test } from 'bun:test';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { createNotificationRoute } from './notification.route';

const secret = 'notification-route-secret';
const userId = '0198f8a0-0000-7000-8000-000000000001';

const database = (async () => []) as unknown as DatabaseClient;
const route = createNotificationRoute(database, {
  signingSecret: secret,
  clockSkewSeconds: 30,
});

function signedHeaders(
  method = 'GET',
  path = '/internal/notifications/me',
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
) {
  const identity = {
    userId,
    email: 'admin@local.app',
    permissions: [],
    expiresAt,
  };
  return new Headers({
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': '',
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity(method, path, identity, secret),
  });
}

describe('notification routes', () => {
  test('AC-3 rejects requests without a signed identity', async () => {
    const response = await route.handle(
      new Request('http://localhost/internal/notifications/me'),
    );

    expect(response.status).toBe(401);
  });

  test('AC-3 accepts a valid signed identity and returns only its subject', async () => {
    const response = await route.handle(
      new Request('http://localhost/internal/notifications/me', {
        headers: signedHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId });
  });

  test('AC-3 rejects expired and tampered identities', async () => {
    const expired = await route.handle(
      new Request('http://localhost/internal/notifications/me', {
        headers: signedHeaders(
          'GET',
          '/internal/notifications/me',
          new Date(Date.now() - 60_000).toISOString(),
        ),
      }),
    );
    const tamperedHeaders = signedHeaders();
    tamperedHeaders.set(
      'x-auth-user-id',
      '0198f8a0-0000-7000-8000-000000000099',
    );
    const tampered = await route.handle(
      new Request('http://localhost/internal/notifications/me', {
        headers: tamperedHeaders,
      }),
    );

    expect(expired.status).toBe(401);
    expect(tampered.status).toBe(401);
  });
});
