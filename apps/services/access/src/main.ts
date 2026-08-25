import {
  closeDatabaseClient,
  createDatabaseClient,
  createTelemetryDatabaseClient,
} from '#project/database';
import {
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  JobRegistry,
} from '#project/jobs';
import { ActivityLog } from '#project/logger';
import { tryConnectMessaging } from '#project/messaging';
import { TelemetryRuntime } from '#project/telemetry';
import { createApp } from './app';
import { env } from './config/env';

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
const applicationDatabase =
  database && telemetry
    ? createTelemetryDatabaseClient(database, telemetry, 'access.database')
    : database;
const jobs = env.DURABLE_JOBS_ENABLED ? new JobRegistry() : undefined;
if (jobs) {
  jobs.registerContract(accessNotificationCreateContract);
  jobs.registerContract(accessNotificationRecipientCapabilitySyncContract);
}
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
});
const messaging = env.ENABLE_INFRASTRUCTURE
  ? await tryConnectMessaging(
      env.NATS_URL,
      env.serviceName,
      (error) => {
        console.warn(
          `${env.serviceName} could not reach NATS at ${env.NATS_URL}; cache invalidation events will be skipped:`,
          error instanceof Error ? error.message : error,
        );
      },
      telemetry,
    )
  : undefined;

const app = createApp(env, {
  database: applicationDatabase,
  messaging,
  jobs,
  durableJobsEnabled: env.DURABLE_JOBS_ENABLED,
  telemetry,
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
  await messaging?.close();
  await ActivityLog.flush(env.LOG_FLUSH_TIMEOUT_MS);
  await telemetry?.shutdown(env.TELEMETRY_FLUSH_TIMEOUT_MS);
  if (logDatabase) await closeDatabaseClient(logDatabase);
  if (telemetryDatabase) await closeDatabaseClient(telemetryDatabase);
  if (database) await closeDatabaseClient(database);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
