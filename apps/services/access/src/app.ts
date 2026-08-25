import { Elysia, t } from 'elysia';
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
import { type AccessEnvironment, loadAccessEnv } from './config/env';
import { createAccessRoute } from './modules/access/access.route';

export interface AccessAppOptions {
  database?: DatabaseClient;
  messaging?: Publisher;
  jobs?: JobRegistry;
  durableJobsEnabled?: boolean;
  telemetry?: TelemetryRuntime;
}

export function createApp(
  environment: AccessEnvironment = loadAccessEnv(),
  options: AccessAppOptions = {},
) {
  const accessEnvironment = environment;
  const logger = new Logger(
    accessEnvironment.serviceName,
    accessEnvironment.LOG_LEVEL,
    {
      persist: accessEnvironment.BEST_EFFORT_LOGGING_ENABLED,
    },
  );

  return new Elysia({ name: accessEnvironment.serviceName })
    .use(requestIdPlugin)
    .use(createTelemetryPlugin(options.telemetry))
    .use(createLoggerPlugin(logger, 'access-logger'))
    .use(createErrorHandler('access-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'Access Service API',
          version: '0.1.0',
          description: 'Permission catalog and direct user grants.',
        },
        tags: [
          { name: 'Health', description: 'Service health checks' },
          { name: 'Access', description: 'Permission and grant management' },
        ],
      }),
    )
    .get(
      '/health',
      () => ({ status: 'ok' as const, service: accessEnvironment.serviceName }),
      {
        response: {
          200: t.Object({ status: t.Literal('ok'), service: t.String() }),
        },
        detail: { tags: ['Health'], summary: 'Check access health' },
      },
    )
    .use(
      createAccessRoute({
        database: options.database,
        messaging: options.messaging,
        jobs: options.jobs,
        durableJobsEnabled: options.durableJobsEnabled,
        cacheTtlMs: accessEnvironment.ACCESS_PERMISSION_CACHE_TTL_MS,
        cacheMaxEntries: accessEnvironment.ACCESS_PERMISSION_CACHE_MAX_ENTRIES,
        signingSecret: accessEnvironment.INTERNAL_AUTH_SIGNING_SECRET,
        clockSkewSeconds: accessEnvironment.AUTH_CLOCK_SKEW_SECONDS,
      }),
    );
}
