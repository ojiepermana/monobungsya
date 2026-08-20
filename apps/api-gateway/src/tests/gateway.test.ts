import { describe, expect, it } from "bun:test";
import { readAndVerifyAuthIdentity } from "#project/contracts";
import { createApp } from "../app";
import { loadGatewayEnv } from "../config/env";

describe("api gateway", () => {
  it("exposes health and forwards public boundaries", async () => {
    const app = createApp(loadGatewayEnv({ NODE_ENV: "test", PORT: "3000" }));
    const health = await app.handle(new Request("http://localhost/health"));
    const unavailableService = await app.handle(
      new Request("http://localhost/api/v1/users/status"),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: "ok",
      service: "api-gateway",
    });
    expect(unavailableService.status).toBe(503);
    expect(await unavailableService.json()).toMatchObject({
      error: { code: "SERVICE_UNAVAILABLE" },
    });
  });

  it("forwards the public request contract to the user service", async () => {
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: "test",
        PORT: "3000",
        USER_SERVICE_URL: "http://user.internal",
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        upstreamRequest = new Request(input, init);
        return Response.json(
          { service: "user", status: "ok", module: "users" },
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request("http://localhost/api/v1/users/status?detail=full", {
          headers: {
            "x-request-id": "request-123",
            "x-correlation-id": "correlation-456",
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: "user",
        status: "ok",
        module: "users",
      });
      expect(upstreamRequest?.url).toBe(
        "http://user.internal/internal/users/status?detail=full",
      );
      expect(upstreamRequest?.headers.get("x-request-id")).toBe("request-123");
      expect(upstreamRequest?.headers.get("x-correlation-id")).toBe(
        "correlation-456",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates a session and forwards a verifiable signed identity", async () => {
    const secret = "integration-signing-secret";
    const app = createApp(
      loadGatewayEnv({
        NODE_ENV: "test",
        PORT: "3000",
        AUTH_SERVICE_URL: "http://auth.internal",
        USER_SERVICE_URL: "http://user.internal",
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const originalFetch = globalThis.fetch;
    let upstreamRequest: Request | undefined;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === "/internal/auth/session") {
          return Response.json({
            authenticated: true,
            user: {
              id: "0198f8a0-0000-7000-8000-000000000001",
              email: "system@project.local",
              role: "admin",
            },
            session: { absoluteExpiresAt: expiresAt },
          });
        }

        upstreamRequest = request;
        return Response.json({ status: "ok" });
      },
      { preconnect: originalFetch.preconnect },
    );

    try {
      const response = await app.handle(
        new Request("http://localhost/api/v1/users/status", {
          headers: { cookie: "project_session=session-value" },
        }),
      );
      const identityHeaders = upstreamRequest?.headers;

      expect(response.status).toBe(200);
      expect(
        readAndVerifyAuthIdentity(
          identityHeaders ?? new Headers(),
          "GET",
          "/internal/users/status",
          secret,
        ),
      ).toMatchObject({
        userId: "0198f8a0-0000-7000-8000-000000000001",
        email: "system@project.local",
        role: "admin",
        expiresAt,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
