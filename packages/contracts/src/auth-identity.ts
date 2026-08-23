import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizePermissions } from '#project/acl';

export interface AuthIdentity {
  userId: string;
  email: string;
  permissions: string[];
  expiresAt: string;
}

export function permissionsHash(permissions: readonly string[]): string {
  return createHash('sha256')
    .update(normalizePermissions(permissions).join(','), 'utf8')
    .digest('hex');
}

export function canonicalIdentityInput(
  method: string,
  path: string,
  identity: AuthIdentity,
): string {
  return [
    method.toUpperCase(),
    path,
    identity.userId,
    permissionsHash(identity.permissions),
    identity.expiresAt,
  ].join('\n');
}

export function signAuthIdentity(
  method: string,
  path: string,
  identity: AuthIdentity,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(canonicalIdentityInput(method, path, identity), 'utf8')
    .digest('hex');
}

export function readAndVerifyAuthIdentity(
  headers: Headers,
  method: string,
  path: string,
  secret: string,
  now = Date.now(),
  clockSkewSeconds = 30,
): AuthIdentity | null {
  const identity: AuthIdentity = {
    userId: headers.get('x-auth-user-id') ?? '',
    email: headers.get('x-auth-email') ?? '',
    permissions: normalizePermissions(headers.get('x-auth-permissions')),
    expiresAt: headers.get('x-auth-expires-at') ?? '',
  };
  const receivedSignature = headers.get('x-auth-signature') ?? '';
  const expiresAt = Date.parse(identity.expiresAt);
  const expectedSignature = signAuthIdentity(method, path, identity, secret);
  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(receivedSignature, 'hex');

  if (
    !identity.userId ||
    !identity.email ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now - clockSkewSeconds * 1000 ||
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  return identity;
}
