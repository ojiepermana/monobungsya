import { Elysia, t } from 'elysia';
import { PERMISSIONS } from '#project/acl';
import type { AppEnvironment } from '#project/config';
import { loadEnv } from '#project/config';
import type { DatabaseClient } from '#project/database';
import {
  createErrorHandler,
  createLoggerPlugin,
  createObservabilityStorageHealthRoute,
  createOpenApiPlugin,
  createTelemetryPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { Logger } from '#project/logger';
import type {
  ClickHouseSignalReader,
  ObservabilitySignalReadMode,
  ObservabilitySignalStore,
} from '#project/observability';
import type { TelemetryRuntime } from '#project/telemetry';
import { createLogsRoute } from './modules/logs/logs.route';
import { createObservabilityRoute } from './modules/observability/observability.route';
import { createAuthIdentityPlugin } from './shared/plugins/auth-identity.plugin';

export interface LogsAppOptions {
  clickhouseReader?: ClickHouseSignalReader | null;
  database?: DatabaseClient;
  telemetryDatabase?: DatabaseClient;
  signalStore?: ObservabilitySignalStore;
  telemetry?: TelemetryRuntime;
  ingestionKeys?: ReadonlyMap<string, string>;
  ingestionMaxBytes?: number;
  ingestionClockSkewSeconds?: number;
  observabilityQueryTimeoutMs?: number;
  observabilityMaxSeries?: number;
  observabilityReadMode?: ObservabilitySignalReadMode;
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
    .use(createTelemetryPlugin(options.telemetry))
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
        (pathname) =>
          pathname === '/internal/observability/benchmark-ingestions'
            ? null
            : pathname === '/internal/observability/storage-health'
              ? null
              : pathname === '/internal/observability/traces' ||
                  pathname.startsWith('/internal/observability/traces/')
                ? PERMISSIONS.observabilityTraceRead
                : pathname === '/internal/observability/metrics'
                  ? PERMISSIONS.observabilityMetricRead
                  : pathname === '/internal/observability/benchmarks/runs' ||
                      pathname.startsWith(
                        '/internal/observability/benchmarks/runs/',
                      ) ||
                      pathname ===
                        '/internal/observability/benchmarks/baselines'
                    ? PERMISSIONS.observabilityBenchmarkRead
                    : pathname === '/internal/observability/alerts' ||
                        pathname.startsWith('/internal/observability/alerts/')
                      ? PERMISSIONS.observabilityAlertRead
                      : PERMISSIONS.logsLogRead,
        (pathname) =>
          pathname === '/internal/observability/benchmark-ingestions',
      ),
    )
    .use(
      createObservabilityStorageHealthRoute({
        signalStore: options.signalStore,
        signingSecret: environment.INTERNAL_AUTH_SIGNING_SECRET,
        clockSkewSeconds: environment.AUTH_CLOCK_SKEW_SECONDS,
      }),
    )
    .use(
      createLogsRoute({
        clickhouseReader: options.clickhouseReader,
        database: options.database,
        readMode:
          options.observabilityReadMode ??
          environment.OBSERVABILITY_SIGNAL_READ_MODE,
        signalStore: options.signalStore,
        telemetry: options.telemetry,
      }),
    )
    .use(
      createObservabilityRoute({
        clickhouseReader: options.clickhouseReader,
        database: options.telemetryDatabase,
        ingestionKeys: options.ingestionKeys,
        ingestionMaxBytes: options.ingestionMaxBytes,
        ingestionClockSkewSeconds: options.ingestionClockSkewSeconds,
        queryTimeoutMs:
          options.observabilityQueryTimeoutMs ??
          environment.OBSERVABILITY_QUERY_TIMEOUT_MS,
        maxSeries:
          options.observabilityMaxSeries ??
          environment.OBSERVABILITY_MAX_SERIES,
        readMode:
          options.observabilityReadMode ??
          environment.OBSERVABILITY_SIGNAL_READ_MODE,
      }),
    );
}
