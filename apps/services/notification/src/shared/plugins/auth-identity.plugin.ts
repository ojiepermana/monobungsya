import { Elysia } from 'elysia';
import {
  type AuthIdentity,
  readAndVerifyAuthIdentity,
} from '#project/contracts';
import { UnauthorizedError } from '#project/errors';

export function createAuthIdentityPlugin(
  secret: string,
  clockSkewSeconds: number,
) {
  return new Elysia({ name: 'notification-auth-identity' }).resolve(
    { as: 'scoped' },
    ({ request }): { identity: AuthIdentity } => {
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
      return { identity };
    },
  );
}
