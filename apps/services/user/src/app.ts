import { Elysia, t } from 'elysia';
import type { AppEnvironment } from '#project/config';
import { loadEnv } from '#project/config';
import type { DatabaseClient } from '#project/database';
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  createTelemetryPlugin,
  requestIdPlugin,
} from '#project/elysia';
import type { JobRegistry } from '#project/jobs';
import { Logger } from '#project/logger';
import type { Publisher } from '#project/messaging';
import type { TelemetryRuntime } from '#project/telemetry';
import { createUsersRoute } from './modules/users/users.route';

export interface UserAppDependencies {
  database?: DatabaseClient;
  messaging?: Publisher;
  jobs?: JobRegistry;
  durableJobsEnabled?: boolean;
  telemetry?: TelemetryRuntime;
}

export function createApp(
  environment: AppEnvironment = loadEnv('user'),
  dependencies: UserAppDependencies = {},
) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL, {
    persist: environment.BEST_EFFORT_LOGGING_ENABLED,
  });

  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createTelemetryPlugin(dependencies.telemetry))
    .use(createLoggerPlugin(logger, 'user-logger'))
    .use(createErrorHandler('user-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'User Service API',
          version: '0.1.0',
          description: 'Internal HTTP contract for the user service.',
        },
        tags: [
          { name: 'Health', description: 'Service health checks' },
          { name: 'Users', description: 'User module' },
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
      createUsersRoute(environment.serviceName, {
        database: dependencies.database,
        messaging: dependencies.messaging,
        jobs: dependencies.jobs,
        durableJobsEnabled: dependencies.durableJobsEnabled,
        logger,
        signingSecret: environment.INTERNAL_AUTH_SIGNING_SECRET,
        clockSkewSeconds: environment.AUTH_CLOCK_SKEW_SECONDS,
      }),
    );
}
