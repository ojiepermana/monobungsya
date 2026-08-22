import { Elysia } from 'elysia';
import {
  type AuthCapability,
  canAccessAuthCapability,
  readAndVerifyAuthIdentity,
} from '#project/contracts';
import {
  ForbiddenError,
  toErrorResponse,
  UnauthorizedError,
} from '#project/errors';

/**
 * The logs service defaults to the 'admin' capability: only the admin and
 * manager roles hold the `logs.read` permission, because log rows carry PII.
 */
export function createAuthIdentityPlugin(
  secret: string,
  clockSkewSeconds: number,
  capability: AuthCapability = 'admin',
) {
  return new Elysia({ name: 'logs-auth-identity' }).onBeforeHandle(
    { as: 'scoped' },
    ({ request, set }) => {
      if (!secret) {
        return;
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
        const mapped = toErrorResponse(
          new UnauthorizedError('A valid signed identity is required'),
          request.headers.get('x-request-id') ?? undefined,
        );
        set.status = mapped.status;
        return mapped.body;
      }

      if (!canAccessAuthCapability(identity.role, capability)) {
        const mapped = toErrorResponse(
          new ForbiddenError('The current role cannot read logs'),
          request.headers.get('x-request-id') ?? undefined,
        );
        set.status = mapped.status;
        return mapped.body;
      }
    },
  );
}
