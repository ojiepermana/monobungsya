import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import {
  accessNotificationCreateContract,
  accessNotificationRecipientCapabilitySyncContract,
  JobRegistry,
} from '#project/jobs';
import { ActivityLog } from '#project/logger';
import { tryConnectMessaging } from '#project/messaging';
import { createApp } from './app';
import { env } from './config/env';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.DATABASE_URL)
  : undefined;
const logDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.LOG_DATABASE_URL)
  : undefined;
const jobs = env.DURABLE_JOBS_ENABLED ? new JobRegistry() : undefined;
if (jobs) {
  jobs.registerContract(accessNotificationCreateContract);
  jobs.registerContract(accessNotificationRecipientCapabilitySyncContract);
}
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
});
const messaging = env.ENABLE_INFRASTRUCTURE
  ? await tryConnectMessaging(env.NATS_URL, env.serviceName, (error) => {
      console.warn(
        `${env.serviceName} could not reach NATS at ${env.NATS_URL}; cache invalidation events will be skipped:`,
        error instanceof Error ? error.message : error,
      );
    })
  : undefined;

const app = createApp(env, {
  database,
  messaging,
  jobs,
  durableJobsEnabled: env.DURABLE_JOBS_ENABLED,
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
  if (logDatabase) await closeDatabaseClient(logDatabase);
  if (database) await closeDatabaseClient(database);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
