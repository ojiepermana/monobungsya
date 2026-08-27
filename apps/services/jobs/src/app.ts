import { Elysia, t } from 'elysia';
import type { DatabaseClient } from '#project/database';
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  createTelemetryPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { JobRegistry } from '#project/jobs';
import { Logger } from '#project/logger';
import type { TelemetryRuntime } from '#project/telemetry';
import type { JobsEnvironment } from './config/env';
import { loadJobsEnv } from './config/env';
import { createJobsRoute } from './modules/jobs/jobs.route';

export interface JobsAppOptions {
  database?: DatabaseClient;
  registry?: JobRegistry;
  isReady?: () => boolean;
  telemetry?: TelemetryRuntime;
}

export function createApp(
  environment: JobsEnvironment = loadJobsEnv(),
  options: JobsAppOptions = {},
) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL, {
    persist: environment.BEST_EFFORT_LOGGING_ENABLED,
  });
  const registry = options.registry ?? new JobRegistry();

  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createTelemetryPlugin(options.telemetry))
    .use(createLoggerPlugin(logger, 'jobs-logger'))
    .use(createErrorHandler('jobs-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'Jobs Service API',
          version: '0.1.0',
          description: 'Durable jobs scheduler and operator API.',
        },
        tags: [
          { name: 'Health', description: 'Jobs service health checks' },
          { name: 'Jobs', description: 'Operator jobs API' },
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
        detail: { tags: ['Health'], summary: 'Check jobs liveness' },
      },
    )
    .get(
      '/ready',
      () => ({
        status: options.isReady?.() ? ('ok' as const) : ('starting' as const),
      }),
      {
        response: {
          200: t.Object({
            status: t.Union([t.Literal('ok'), t.Literal('starting')]),
          }),
        },
        detail: { tags: ['Health'], summary: 'Check jobs readiness' },
      },
    )
    .use(
      options.database
        ? createJobsRoute(options.database, registry, {
            signingSecret: environment.INTERNAL_AUTH_SIGNING_SECRET,
            clockSkewSeconds: environment.AUTH_CLOCK_SKEW_SECONDS,
          })
        : new Elysia({ name: 'jobs-no-database-routes' }),
    );
}
