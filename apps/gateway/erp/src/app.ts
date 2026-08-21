import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  requestIdPlugin,
} from "#project/elysia";
import { toErrorResponse, ValidationError } from "#project/errors";
import { Logger } from "#project/logger";
import type { GatewayEnvironment } from "./config/env";
import { loadGatewayEnv } from "./config/env";
import { createProxyRoute } from "./routes/proxy.route";

export function createApp(environment: GatewayEnvironment = loadGatewayEnv()) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL);

  return new Elysia({ name: environment.serviceName })
    .use(cors({ origin: environment.CORS_ORIGIN, credentials: true }))
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger, "gateway-logger"))
    .use(
      createOpenApiPlugin({
        info: {
          title: "Project Public API",
          version: "0.1.0",
          description: "Public HTTP contract exposed by the API Gateway.",
        },
        tags: [
          { name: "Health", description: "Gateway health checks" },
          { name: "Auth", description: "Public auth boundary" },
          { name: "Passkey", description: "Public passkey (WebAuthn) boundary" },
          { name: "Users", description: "Public users boundary" },
        ],
      }),
    )
    .get(
      "/health",
      () => ({ status: "ok" as const, service: environment.serviceName }),
      {
        response: {
          200: t.Object({ status: t.Literal("ok"), service: t.String() }),
        },
        detail: { tags: ["Health"], summary: "Check gateway health" },
      },
    )
    .use(createProxyRoute(environment))
    .use(createErrorHandler("gateway-error-handler"))
    .onError(({ code, error, request, set }) => {
      const mapped = toErrorResponse(
        code === "VALIDATION"
          ? new ValidationError("Request validation failed")
          : error,
        request.headers.get("x-request-id") ?? undefined,
      );
      set.status = mapped.status;
      logger.error("request.failed", {
        requestId: request.headers.get("x-request-id"),
        error: mapped.body,
      });
      return mapped.body;
    });
}
