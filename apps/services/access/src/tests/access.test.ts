import { describe, expect, it } from 'bun:test';
import { signAuthIdentity } from '#project/contracts';
import { createApp } from '../app';
import { loadAccessEnv } from '../config/env';
import { PermissionLookupCache } from '../modules/access/access.cache';
import type { AccessRepository } from '../modules/access/access.repository';

const SECRET = 'access-test-signing-secret';
const USER_ID = '0198f8a0-0000-7000-8000-000000000001';

function headersFor(
  method: string,
  path: string,
  permissions: string[],
): Headers {
  const identity = {
    userId: USER_ID,
    email: 'admin@local.app',
    permissions,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return new Headers({
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': identity.permissions.join(','),
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity(method, path, identity, SECRET),
  });
}

describe('access service', () => {
  it('exposes health and denies unsigned catalog requests', async () => {
    const app = createApp(
      loadAccessEnv({
        NODE_ENV: 'test',
        PORT: '3104',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );

    const health = await app.handle(new Request('http://localhost/health'));
    const response = await app.handle(
      new Request('http://localhost/api/v1/access/permissions'),
    );

    expect(health.status).toBe(200);
    expect(response.status).toBe(401);
  });

  it('enforces access permissions before reaching the repository', async () => {
    const app = createApp(
      loadAccessEnv({
        NODE_ENV: 'test',
        PORT: '3104',
        INTERNAL_AUTH_SIGNING_SECRET: SECRET,
      }),
    );

    const response = await app.handle(
      new Request('http://localhost/api/v1/access/permissions', {
        headers: headersFor('GET', '/api/v1/access/permissions', []),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('normalizes, caches, invalidates, and bounds permission lookups', async () => {
    let calls = 0;
    const repository = {
      lookupPermissions: async () => {
        calls += 1;
        return ['user:user:read', 'user:user:read', 'logs:log:read'];
      },
    } as unknown as AccessRepository;
    const cache = new PermissionLookupCache(repository, 60_000, 1);

    expect(await cache.get('user-a')).toEqual([
      'logs:log:read',
      'user:user:read',
    ]);
    expect(await cache.get('user-a')).toEqual([
      'logs:log:read',
      'user:user:read',
    ]);
    expect(calls).toBe(1);

    cache.invalidate('user-a');
    await cache.get('user-a');
    expect(calls).toBe(2);

    await cache.get('user-b');
    await cache.get('user-a');
    expect(calls).toBe(4);
  });
});
