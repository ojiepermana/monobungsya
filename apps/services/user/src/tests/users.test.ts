import { describe, expect, it } from "bun:test";
import { loadEnv } from "#project/config";
import { signAuthIdentity } from "#project/contracts";
import { createApp } from "../app";

describe("user service", () => {
  it("exposes health and module status endpoints", async () => {
    const app = createApp(loadEnv("user", { NODE_ENV: "test", PORT: "3102" }));
    const health = await app.handle(new Request("http://localhost/health"));
    const moduleStatus = await app.handle(
      new Request("http://localhost/internal/users/status"),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", service: "user" });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: "user",
      status: "ok",
      module: "users",
    });
  });

  it("rejects unsigned internal requests when identity signing is enabled", async () => {
    const secret = "user-service-signing-secret";
    const app = createApp(
      loadEnv("user", {
        NODE_ENV: "test",
        PORT: "3102",
        INTERNAL_AUTH_SIGNING_SECRET: secret,
      }),
    );
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const identity = {
      userId: "0198f8a0-0000-7000-8000-000000000001",
      email: "system@project.local",
      role: "admin" as const,
      expiresAt,
    };
    const signature = signAuthIdentity(
      "GET",
      "/internal/users/status",
      identity,
      secret,
    );

    const unsigned = await app.handle(
      new Request("http://localhost/internal/users/status"),
    );
    expect(unsigned.status).toBe(401);

    const signed = await app.handle(
      new Request("http://localhost/internal/users/status", {
        headers: {
          "x-auth-user-id": identity.userId,
          "x-auth-email": identity.email,
          "x-auth-role": identity.role,
          "x-auth-expires-at": identity.expiresAt,
          "x-auth-signature": signature,
        },
      }),
    );
    expect(signed.status).toBe(200);
  });
});
