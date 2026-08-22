import { Elysia } from 'elysia';
import {
  type AuthCapability,
  type AuthIdentity,
  canAccessAuthCapability,
  readAndVerifyAuthIdentity,
} from '#project/contracts';
import { ForbiddenError, UnauthorizedError } from '#project/errors';

/**
 * Verifies the signed identity the gateway forwards and hands it to the routes
 * as `identity`, because every mutation in the users module needs the actor for
 * its audit trail (spec docs/specs/0007-user-management, AC-7).
 *
 * The default capability is 'user-management', which is admin only: the whole
 * user domain sits behind the admin role (AC-8). The gateway checks the same
 * capability before it signs, so a non admin never reaches this service; the
 * check here is the second, independent one.
 *
 * Errors are thrown, not returned, so the shared error handler shapes them into
 * the same JSON envelope every other failure uses.
 */
export function createAuthIdentityPlugin(
  secret: string,
  clockSkewSeconds: number,
  capability: AuthCapability = 'user-management',
) {
  return new Elysia({ name: 'user-auth-identity' }).resolve(
    { as: 'scoped' },
    ({ request }): { identity: AuthIdentity | null } => {
      if (!secret) {
        return { identity: null };
      }

      const identity = readAndVerifyAuthIdentity(
        request.headers,
        request.method,
        new URL(request.url).pathname,
        secret,
        Date.now(),
        clockSkewSeconds,
      );

      if (!identity) {
        throw new UnauthorizedError('A valid signed identity is required');
      }

      if (!canAccessAuthCapability(identity.role, capability)) {
        throw new ForbiddenError('The current role cannot manage users');
      }

      return { identity };
    },
  );
}
