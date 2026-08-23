import { Elysia } from 'elysia';
import { hasAnyRequiredPermission } from '#project/acl';
import {
  type AuthIdentity,
  readAndVerifyAuthIdentity,
} from '#project/contracts';
import { ForbiddenError, UnauthorizedError } from '#project/errors';

/**
 * Verifies the signed identity the gateway forwards and hands it to the routes
 * as `identity`. Each route applies its own permission requirement so the
 * service remains independently protected if the gateway is bypassed.
 */
export function createAuthIdentityPlugin(
  secret: string,
  clockSkewSeconds: number,
) {
  return new Elysia({ name: 'user-auth-identity' }).resolve(
    { as: 'scoped' },
    ({
      request,
    }): {
      identity: AuthIdentity;
      requirePermissions: (...required: string[]) => void;
    } => {
      const identity = readAndVerifyAuthIdentity(
        request.headers,
        request.method,
        new URL(request.url).pathname,
        secret,
        Date.now(),
        clockSkewSeconds,
      );

      if (!identity)
        throw new UnauthorizedError('A valid signed identity is required');
      return {
        identity,
        requirePermissions: (...required: string[]) => {
          if (!hasAnyRequiredPermission(identity.permissions, required)) {
            throw new ForbiddenError(
              'The current identity does not have the required permission',
              'insufficient_permissions',
            );
          }
        },
      };
    },
  );
}
