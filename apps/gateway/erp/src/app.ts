import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import { toErrorResponse, ValidationError } from "#project/errors";
import { Logger } from "#project/logger";
import type { GatewayEnvironment } from "./config/env";
import { loadGatewayEnv } from "./config/env";
import { createProxyRoute } from "./routes/proxy.route";
import { createErrorHandler } from "./shared/errors/error-handler";
import { createLoggerPlugin } from "./shared/plugins/logger.plugin";
import { openapiPlugin } from "./shared/plugins/openapi.plugin";
import { requestIdPlugin } from "./shared/plugins/request-id.plugin";

export function createApp(environment: GatewayEnvironment = loadGatewayEnv()) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL);

  return new Elysia({ name: environment.serviceName })
    .use(cors({ origin: environment.CORS_ORIGIN, credentials: true }))
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger))
    .use(openapiPlugin)
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
    .use(createErrorHandler())
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
