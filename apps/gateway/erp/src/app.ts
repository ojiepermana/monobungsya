import { cors } from '@elysiajs/cors';
import { Elysia, t } from 'elysia';
import {
  createAccessLogPlugin,
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  createTelemetryPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { Logger } from '#project/logger';
import type { Subscriber } from '#project/messaging';
import type { TelemetryRuntime } from '#project/telemetry';
import type { GatewayEnvironment } from './config/env';
import { loadGatewayEnv } from './config/env';
import { createProxyRoute } from './routes/proxy.route';

export interface GatewayAppOptions {
  messaging?: Subscriber;
  telemetry?: TelemetryRuntime;
}

export function createApp(
  environment: GatewayEnvironment = loadGatewayEnv(),
  options: GatewayAppOptions = {},
) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL, {
    persist: environment.BEST_EFFORT_LOGGING_ENABLED,
  });

  return new Elysia({ name: environment.serviceName })
    .use(
      cors({
        origin: environment.CORS_ORIGIN,
        credentials: true,
        allowedHeaders: [
          'content-type',
          'x-request-id',
          'x-correlation-id',
          'x-client-route',
          'idempotency-key',
        ],
      }),
    )
    .use(requestIdPlugin)
    .use(createTelemetryPlugin(options.telemetry))
    .use(createAccessLogPlugin())
    .use(createLoggerPlugin(logger, 'gateway-logger'))
    .use(createErrorHandler('gateway-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'Project Public API',
          version: '0.1.0',
          description: 'Public HTTP contract exposed by the API Gateway.',
        },
        tags: [
          { name: 'Health', description: 'Gateway health checks' },
          { name: 'Auth', description: 'Public auth boundary' },
          {
            name: 'Passkey',
            description: 'Public passkey (WebAuthn) boundary',
          },
          { name: 'Users', description: 'Public users boundary' },
          { name: 'Logs', description: 'Public log viewer boundary' },
          {
            name: 'Observability',
            description: 'Runtime telemetry and trace boundary',
          },
          { name: 'Access', description: 'Public permission access boundary' },
          { name: 'Jobs', description: 'Authorized job operations boundary' },
        ],
      }),
    )
    .get(
      '/health',
      () => ({ status: 'ok' as const, service: environment.serviceName }),
      {
        response: {
          200: t.Object({ status: t.Literal('ok'), service: t.String() }),
        },
        detail: { tags: ['Health'], summary: 'Check gateway health' },
      },
    )
    .use(createProxyRoute(environment, options));
}
