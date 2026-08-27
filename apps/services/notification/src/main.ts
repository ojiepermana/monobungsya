import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog, Logger } from '#project/logger';
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
ActivityLog.configure(logDatabase);
const logger = new Logger(env.serviceName, env.LOG_LEVEL);
const mailer = env.ENABLE_INFRASTRUCTURE
  ? new SmtpNotificationMailer({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
    })
  : undefined;
const stopWorker = database
  ? startNotificationWorker(database, logger, mailer)
  : async () => undefined;
const cleanupTimer = database
  ? setInterval(async () => {
      try {
        const before = new Date(
          Date.now() - env.NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );
        const service = new (
          await import('./modules/notification/notification.service')
        ).NotificationService(database, mailer);
        await service.cleanup(before);
      } catch (error) {
        logger.error('notification.retention.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, env.NOTIFICATION_CLEANUP_INTERVAL_MS)
  : undefined;
cleanupTimer?.unref();
const server = createApp(env, database).listen(env.NOTIFICATION_SERVICE_PORT);
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
  if (logDatabase) await closeDatabaseClient(logDatabase);
  if (database) await closeDatabaseClient(database);
}
process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
