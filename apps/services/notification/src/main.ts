import {
  closeDatabaseClient,
  createDatabaseClient,
  createTelemetryDatabaseClient,
} from '#project/database';
import { ActivityLog, Logger } from '#project/logger';
import { createRuntimeObservabilitySignalStore } from '#project/observability';
import { TelemetryRuntime } from '#project/telemetry';
import { createApp } from './app';
import { env } from './config/env';
import { startNotificationWorker } from './jobs/notification.worker';
import { SmtpNotificationMailer } from './modules/notification/notification.service';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.NOTIFICATION_DATABASE_URL)
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
const signalStore = await createRuntimeObservabilitySignalStore({
  environment: env,
  logsDatabase: logDatabase,
  telemetryDatabase,
  controlDatabase: observabilityDatabase,
});
const telemetry = env.TELEMETRY_ENABLED
  ? new TelemetryRuntime({
      serviceName: env.serviceName,
      serviceInstanceId: env.serviceInstanceId,
      signalStore,
      flushIntervalMs: env.TELEMETRY_FLUSH_INTERVAL_MS,
      slowThresholdMs: env.TELEMETRY_SLOW_THRESHOLD_MS,
      successSampleRate: env.TELEMETRY_SUCCESS_SAMPLE_RATE,
    })
  : undefined;
const applicationDatabase =
  database && telemetry
    ? createTelemetryDatabaseClient(
        database,
        telemetry,
        'notification.database',
      )
    : database;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
  signalStore,
});
const logger = new Logger(env.serviceName, env.LOG_LEVEL, {
  persist: env.BEST_EFFORT_LOGGING_ENABLED,
});
const mailer = env.ENABLE_INFRASTRUCTURE
  ? new SmtpNotificationMailer({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
      telemetry,
    })
  : undefined;
const stopWorker = applicationDatabase
  ? startNotificationWorker(applicationDatabase, logger, mailer, telemetry)
  : async () => undefined;
const cleanupTimer = applicationDatabase
  ? setInterval(async () => {
      try {
        const before = new Date(
          Date.now() - env.NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );
        const service = new (
          await import('./modules/notification/notification.service')
        ).NotificationService(applicationDatabase, mailer);
        await service.cleanup(before);
      } catch (error) {
        logger.error('notification.retention.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, env.NOTIFICATION_CLEANUP_INTERVAL_MS)
  : undefined;
cleanupTimer?.unref();
const server = createApp(
  env,
  applicationDatabase,
  telemetry,
  signalStore,
).listen(env.NOTIFICATION_SERVICE_PORT);
console.log(
  `${env.serviceName} listening on http://localhost:${server.server?.port ?? env.NOTIFICATION_SERVICE_PORT}`,
);
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${env.serviceName} received ${signal}, shutting down`);
  if (cleanupTimer) clearInterval(cleanupTimer);
  await server.stop();
  await stopWorker();
  await ActivityLog.flush(env.LOG_FLUSH_TIMEOUT_MS);
  await telemetry?.shutdown(env.TELEMETRY_FLUSH_TIMEOUT_MS);
  if (!telemetry) await signalStore?.shutdown(env.LOG_FLUSH_TIMEOUT_MS);
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
