import { Elysia, t } from 'elysia';
import type { AppEnvironment } from '#project/config';
import { loadEnv } from '#project/config';
import type { DatabaseClient } from '#project/database';
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { Logger } from '#project/logger';
import { createLogsRoute } from './modules/logs/logs.route';
import { createAuthIdentityPlugin } from './shared/plugins/auth-identity.plugin';

export interface LogsAppOptions {
  database?: DatabaseClient;
}

export function createApp(
  environment: AppEnvironment = loadEnv('logs'),
  options: LogsAppOptions = {},
) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL, {
    persist: environment.BEST_EFFORT_LOGGING_ENABLED,
  });

  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger, 'logs-logger'))
    .use(createErrorHandler('logs-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'Logs Service API',
          version: '0.1.0',
          description: 'Internal HTTP contract for the read only logs service.',
        },
        tags: [
          { name: 'Health', description: 'Service health checks' },
          { name: 'Logs', description: 'Log viewer module' },
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
        detail: { tags: ['Health'], summary: 'Check service health' },
      },
    )
    .use(
      createAuthIdentityPlugin(
        environment.INTERNAL_AUTH_SIGNING_SECRET,
        environment.AUTH_CLOCK_SKEW_SECONDS,
      ),
    )
    .use(createLogsRoute({ database: options.database }));
}
