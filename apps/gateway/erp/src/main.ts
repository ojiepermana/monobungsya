import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog } from '#project/logger';
import { tryConnectMessaging } from '#project/messaging';
import { createApp } from './app';
import { env } from './config/env';

const logDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.LOG_DATABASE_URL)
  : undefined;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
});

const messaging = env.ENABLE_INFRASTRUCTURE
  ? await tryConnectMessaging(env.NATS_URL, env.serviceName, (error) => {
      console.warn(
        `${env.serviceName} could not reach NATS at ${env.NATS_URL}; permission cache invalidation will rely on TTL:`,
        error instanceof Error ? error.message : error,
      );
    })
  : undefined;
const app = createApp(env, { messaging });
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
  await messaging?.close();
  if (logDatabase) await closeDatabaseClient(logDatabase);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
