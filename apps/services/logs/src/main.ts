import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog } from '#project/logger';
import { TelemetryRuntime } from '#project/telemetry';
import { createApp } from './app';
import { env } from './config/env';
import { parseIngestionKeys } from './modules/observability/observability.ingestion';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.DATABASE_URL)
  : undefined;
const logDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.LOG_DATABASE_URL)
  : undefined;
const telemetryDatabase =
  env.TELEMETRY_ENABLED && env.ENABLE_INFRASTRUCTURE
    ? createDatabaseClient(env.TELEMETRY_DATABASE_URL)
    : undefined;
const observabilityDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.OBSERVABILITY_DATABASE_URL)
  : undefined;
const telemetry = env.TELEMETRY_ENABLED
  ? new TelemetryRuntime({
      serviceName: env.serviceName,
      serviceInstanceId: env.serviceInstanceId,
      database: telemetryDatabase,
      queueCapacity: env.TELEMETRY_QUEUE_CAPACITY,
      priorityCapacity: env.TELEMETRY_PRIORITY_CAPACITY,
      batchSize: env.TELEMETRY_BATCH_SIZE,
      flushIntervalMs: env.TELEMETRY_FLUSH_INTERVAL_MS,
      slowThresholdMs: env.TELEMETRY_SLOW_THRESHOLD_MS,
      successSampleRate: env.TELEMETRY_SUCCESS_SAMPLE_RATE,
    })
  : undefined;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
});
const app = createApp(env, {
  database,
  telemetryDatabase: observabilityDatabase,
  telemetry,
  ingestionKeys: parseIngestionKeys(env.OBSERVABILITY_INGESTION_KEYS),
  ingestionMaxBytes: env.OBSERVABILITY_INGESTION_MAX_BYTES,
  ingestionClockSkewSeconds: env.OBSERVABILITY_INGESTION_CLOCK_SKEW_SECONDS,
  observabilityQueryTimeoutMs: env.OBSERVABILITY_QUERY_TIMEOUT_MS,
  observabilityMaxSeries: env.OBSERVABILITY_MAX_SERIES,
});
const server = app.listen(env.PORT);

console.log(
  `${env.serviceName} listening on http://localhost:${server.server?.port ?? env.PORT}`,
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${env.serviceName} received ${signal}, shutting down`);
  await server.stop();
  await ActivityLog.flush(env.LOG_FLUSH_TIMEOUT_MS);
  await telemetry?.shutdown(env.TELEMETRY_FLUSH_TIMEOUT_MS);
  if (logDatabase) await closeDatabaseClient(logDatabase);
  if (telemetryDatabase) await closeDatabaseClient(telemetryDatabase);
  if (observabilityDatabase) await closeDatabaseClient(observabilityDatabase);
  if (database) await closeDatabaseClient(database);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
