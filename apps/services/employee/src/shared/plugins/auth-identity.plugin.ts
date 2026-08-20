import { Elysia } from "elysia";
import {
  type AuthCapability,
  canAccessAuthCapability,
  readAndVerifyAuthIdentity,
} from "#project/contracts";
import {
  ForbiddenError,
  toErrorResponse,
  UnauthorizedError,
} from "#project/errors";

export function createAuthIdentityPlugin(
  secret: string,
  clockSkewSeconds: number,
  capability: AuthCapability = "read",
) {
  return new Elysia({ name: "employee-auth-identity" }).onBeforeHandle(
    { as: "scoped" },
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
          new UnauthorizedError("A valid signed identity is required"),
          request.headers.get("x-request-id") ?? undefined,
        );
        set.status = mapped.status;
        return mapped.body;
      }

      if (!canAccessAuthCapability(identity.role, capability)) {
        const mapped = toErrorResponse(
          new ForbiddenError("The current role cannot access this resource"),
          request.headers.get("x-request-id") ?? undefined,
        );
        set.status = mapped.status;
        return mapped.body;
      }
    },
  );
}
