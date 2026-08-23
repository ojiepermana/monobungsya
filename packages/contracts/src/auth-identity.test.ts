import { expect, test } from 'bun:test';
import {
  permissionsHash,
  readAndVerifyAuthIdentity,
  signAuthIdentity,
} from './auth-identity';

const identity = {
  userId: '0198f8a0-0000-7000-8000-000000000001',
  email: 'admin@project.local',
  permissions: ['user:user:manage', 'logs:log:read'],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

test('hashes the normalized permission list', () => {
  expect(permissionsHash([' user:user:manage ', 'logs:log:read'])).toBe(
    permissionsHash(['user:user:manage', 'logs:log:read']),
  );
});

test('signs and verifies the extended identity header', () => {
  const headers = new Headers({
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': identity.permissions.join(','),
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity(
      'GET',
      '/internal/users',
      identity,
      'secret',
    ),
  });

  expect(
    readAndVerifyAuthIdentity(headers, 'GET', '/internal/users', 'secret'),
  ).toEqual(identity);
});

test('rejects a permission list changed after signing', () => {
  const headers = new Headers({
    'x-auth-user-id': identity.userId,
    'x-auth-email': identity.email,
    'x-auth-permissions': `${identity.permissions.join(',')},access:permission:read`,
    'x-auth-expires-at': identity.expiresAt,
    'x-auth-signature': signAuthIdentity(
      'GET',
      '/internal/users',
      identity,
      'secret',
    ),
  });

  expect(
    readAndVerifyAuthIdentity(headers, 'GET', '/internal/users', 'secret'),
  ).toBeNull();
});
