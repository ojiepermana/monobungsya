import { cors } from '@elysiajs/cors';
import { Elysia, t } from 'elysia';
import {
  createAccessLogPlugin,
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { Logger } from '#project/logger';
import type { GatewayEnvironment } from './config/env';
import { loadGatewayEnv } from './config/env';
import { createProxyRoute } from './routes/proxy.route';

export function createApp(environment: GatewayEnvironment = loadGatewayEnv()) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL, {
    persist: environment.BEST_EFFORT_LOGGING_ENABLED,
  });

  return new Elysia({ name: environment.serviceName })
    .use(cors({ origin: environment.CORS_ORIGIN, credentials: true }))
    .use(requestIdPlugin)
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
    .use(createProxyRoute(environment));
}
