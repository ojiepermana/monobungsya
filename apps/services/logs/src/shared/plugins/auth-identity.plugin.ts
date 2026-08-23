import { Elysia } from 'elysia';
import { hasAnyRequiredPermission, PERMISSIONS } from '#project/acl';
import { readAndVerifyAuthIdentity } from '#project/contracts';
import {
  ForbiddenError,
  toErrorResponse,
  UnauthorizedError,
} from '#project/errors';

/**
 * The logs service has one read permission because log rows carry PII.
 */
export function createAuthIdentityPlugin(
  secret: string,
  clockSkewSeconds: number,
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

      if (
        !hasAnyRequiredPermission(identity.permissions, [
          PERMISSIONS.logsLogRead,
        ])
      ) {
        const mapped = toErrorResponse(
          new ForbiddenError(
            'The current identity does not have the required permission',
            'insufficient_permissions',
          ),
          request.headers.get('x-request-id') ?? undefined,
        );
        set.status = mapped.status;
        return mapped.body;
      }
    },
  );
}
