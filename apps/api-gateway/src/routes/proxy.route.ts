import { Elysia, t } from "elysia";
import { type AuthIdentity, signAuthIdentity } from "#project/contracts";
import {
  ServiceUnavailableError,
  toErrorResponse,
  UnauthorizedError,
} from "#project/errors";
import type { GatewayEnvironment } from "../config/env";

async function forwardRequest(
  request: Request,
  serviceUrl: string,
  publicPrefix: string,
  internalPrefix: string,
  environment: GatewayEnvironment,
  requiresIdentity = false,
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const suffix = incomingUrl.pathname.slice(publicPrefix.length);
  const upstreamUrl = new URL(
    `${internalPrefix}${suffix}${incomingUrl.search}`,
    serviceUrl,
  );
  const headers = new Headers(request.headers);
  headers.set(
    "x-request-id",
    request.headers.get("x-request-id") ?? crypto.randomUUID(),
  );
  headers.set(
    "x-correlation-id",
    request.headers.get("x-correlation-id") ??
      headers.get("x-request-id") ??
      "",
  );

  if (requiresIdentity) {
    const identityError = await addIdentityHeaders(
      request,
      headers,
      upstreamUrl.pathname,
      environment,
    );

    if (identityError) {
      return identityError;
    }
  }

  try {
    return await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
    });
  } catch {
    const mapped = toErrorResponse(
      new ServiceUnavailableError(
        "The requested internal service is unavailable",
      ),
      headers.get("x-request-id") ?? undefined,
    );

    return Response.json(mapped.body, {
      status: mapped.status,
      headers: { "x-request-id": headers.get("x-request-id") ?? "" },
    });
  }
}

async function addIdentityHeaders(
  request: Request,
  headers: Headers,
  normalizedPath: string,
  environment: GatewayEnvironment,
): Promise<Response | undefined> {
  if (!environment.INTERNAL_AUTH_SIGNING_SECRET) {
    return undefined;
  }

  const requestId = headers.get("x-request-id") ?? "";
  let response: Response;

  try {
    response = await fetch(
      new URL("/internal/auth/session", environment.serviceUrls.auth),
      {
        headers: {
          cookie: request.headers.get("cookie") ?? "",
          "x-request-id": requestId,
        },
      },
    );
  } catch {
    return mappedGatewayError(
      new ServiceUnavailableError("Authentication service is unavailable"),
      requestId,
    );
  }

  if (!response.ok) {
    return mappedGatewayError(
      new ServiceUnavailableError("Authentication service is unavailable"),
      requestId,
    );
  }

  const session = (await response.json()) as {
    authenticated?: boolean;
    user?: { id?: string; email?: string; role?: AuthIdentity["role"] };
    session?: { absoluteExpiresAt?: string };
  };

  if (
    !session.authenticated ||
    !session.user?.id ||
    !session.user.email ||
    !session.user.role ||
    !session.session?.absoluteExpiresAt
  ) {
    return mappedGatewayError(
      new UnauthorizedError("Authentication is required"),
      requestId,
    );
  }

  const expiresAt = session.session.absoluteExpiresAt;
  const expiry = Date.parse(expiresAt);

  if (
    !Number.isFinite(expiry) ||
    expiry <= Date.now() - environment.AUTH_CLOCK_SKEW_SECONDS * 1000
  ) {
    return mappedGatewayError(
      new UnauthorizedError("Authentication session has expired"),
      requestId,
    );
  }

  const identity: AuthIdentity = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    expiresAt,
  };
  const signature = signAuthIdentity(
    request.method,
    normalizedPath,
    identity,
    environment.INTERNAL_AUTH_SIGNING_SECRET,
  );

  headers.set("x-auth-user-id", identity.userId);
  headers.set("x-auth-email", identity.email);
  headers.set("x-auth-role", identity.role);
  headers.set("x-auth-expires-at", identity.expiresAt);
  headers.set("x-auth-signature", signature);
}

function mappedGatewayError(error: unknown, requestId: string): Response {
  const mapped = toErrorResponse(error, requestId);
  return Response.json(mapped.body, {
    status: mapped.status,
    headers: { "x-request-id": requestId },
  });
}

export function createProxyRoute(environment: GatewayEnvironment) {
  return new Elysia({ name: "gateway-proxy-routes" })
    .all("/api/v1/auth/identity", () => new Response(null, { status: 404 }), {
      detail: { hide: true },
    })
    .get(
      "/api/v1/auth/status",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          "/api/v1/auth",
          "/internal/auth",
          environment,
        ),
      { detail: { tags: ["Auth"], summary: "Forward auth status request" } },
    )
    .post(
      "/api/v1/auth/magic-link",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          "/api/v1/auth",
          "/internal/auth",
          environment,
        ),
      {
        body: t.Object({
          email: t.String({ format: "email", minLength: 3, maxLength: 255 }),
        }),
        detail: { tags: ["Auth"], summary: "Request an auth magic link" },
      },
    )
    .get(
      "/api/v1/auth/verify",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          "/api/v1/auth",
          "/internal/auth",
          environment,
        ),
      {
        query: t.Object({ token: t.String({ minLength: 20, maxLength: 512 }) }),
        detail: { tags: ["Auth"], summary: "Consume an auth magic link" },
      },
    )
    .get(
      "/api/v1/auth/session",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          "/api/v1/auth",
          "/internal/auth",
          environment,
        ),
      {
        detail: { tags: ["Auth"], summary: "Read the current auth session" },
      },
    )
    .post(
      "/api/v1/auth/logout",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          "/api/v1/auth",
          "/internal/auth",
          environment,
        ),
      {
        detail: { tags: ["Auth"], summary: "Logout the current auth session" },
      },
    )
    .get(
      "/api/v1/users/status",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.user,
          "/api/v1/users",
          "/internal/users",
          environment,
          true,
        ),
      { detail: { tags: ["Users"], summary: "Forward users status request" } },
    )
    .all(
      "/api/v1/auth/*",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.auth,
          "/api/v1/auth",
          "/internal/auth",
          environment,
        ),
      {
        detail: { hide: true },
      },
    )
    .all(
      "/api/v1/users/*",
      ({ request }) =>
        forwardRequest(
          request,
          environment.serviceUrls.user,
          "/api/v1/users",
          "/internal/users",
          environment,
          true,
        ),
      {
        detail: { hide: true },
      },
    );
}
