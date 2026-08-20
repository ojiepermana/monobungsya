import { describe, expect, it } from "bun:test";
import { loadEnv } from "#project/config";
import { createApp } from "../app";

describe("reporting service", () => {
  it("exposes health and module status endpoints", async () => {
    const app = createApp(
      loadEnv("reporting", { NODE_ENV: "test", PORT: "3105" }),
    );
    const health = await app.handle(new Request("http://localhost/health"));
    const moduleStatus = await app.handle(
      new Request("http://localhost/internal/reports/status"),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", service: "reporting" });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: "reporting",
      status: "ok",
      module: "reports",
    });
  });
});
