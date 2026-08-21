import { Elysia, t } from "elysia";
import type { AppEnvironment } from "#project/config";
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  requestIdPlugin,
} from "#project/elysia";
import { Logger } from "#project/logger";
import { loadAuthEnv } from "./config/env";
import {
  type AuthRouteOptions,
  createAuthRoute,
} from "./modules/auth/auth.route";
import {
  createPasskeyRoute,
  type PasskeyRouteOptions,
} from "./modules/auth/passkey.route";

export function createApp(
  environment: AppEnvironment = loadAuthEnv(),
  authOptions: AuthRouteOptions = {},
  passkeyOptions: PasskeyRouteOptions = {},
) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL);

  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger, "auth-logger"))
    .use(createErrorHandler("auth-error-handler", { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: "Auth Service API",
          version: "0.1.0",
          description: "Internal HTTP contract for the auth service.",
        },
        tags: [
          { name: "Health", description: "Service health checks" },
          { name: "Auth", description: "Auth module" },
          { name: "Passkey", description: "Passkey (WebAuthn) sign in" },
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
        detail: { tags: ["Health"], summary: "Check service health" },
      },
    )
    .use(createAuthRoute(environment.serviceName, authOptions))
    .use(
      createPasskeyRoute({
        database: authOptions.database,
        webAppUrl: authOptions.webAppUrl,
        cookieName: authOptions.cookieName,
        cookieSecure: authOptions.cookieSecure,
        logger,
        ...passkeyOptions,
      }),
    );
}
