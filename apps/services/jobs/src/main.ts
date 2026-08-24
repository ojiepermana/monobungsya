import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import {
  AUTH_JOB_CONTRACTS,
  DurableJobRuntime,
  DurableJobScheduler,
  type JobContract,
  JobRegistry,
} from '#project/jobs';
import { ActivityLog, Logger } from '#project/logger';
import { createApp } from './app';
import { env } from './config/env';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.JOBS_DATABASE_URL)
  : undefined;
const logDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.LOG_DATABASE_URL)
  : undefined;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
});

const logger = new Logger(env.serviceName, env.LOG_LEVEL, {
  persist: env.BEST_EFFORT_LOGGING_ENABLED,
});
const registry = new JobRegistry();
for (const contract of AUTH_JOB_CONTRACTS) {
  registry.registerContract(contract as unknown as JobContract<never>);
}

let ready = !database;
const scheduler = database
  ? new DurableJobScheduler(database, registry, {
      schedulerId: `jobs-${process.pid}`,
      catchUpLimit: env.JOB_SCHEDULE_CATCH_UP_LIMIT,
      leaseMs: Math.min(env.JOB_LEASE_MS, 30_000),
      onEvent: (event) =>
        logger.info(`jobs.${event.name}`, {
          code: event.code,
          count: event.count,
          error: event.error instanceof Error ? event.error.message : undefined,
        }),
    })
  : undefined;
const runtime = database
  ? new DurableJobRuntime(database, registry)
  : undefined;

async function scheduleTick(): Promise<void> {
  if (!scheduler || !runtime) return;
  try {
    await scheduler.runOnce();
    await runtime.recoverExpired();
  } catch (error) {
    logger.error('jobs.scheduler.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupTick(): Promise<void> {
  if (!database) return;
  const before = new Date(
    Date.now() - env.JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  try {
    await database`
      SELECT jobs.cleanup_terminal_jobs(${before}, 500)
    `;
  } catch (error) {
    logger.error('jobs.retention.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (scheduler) {
  try {
    await scheduler.synchronize();
    ready = true;
  } catch (error) {
    logger.error('jobs.scheduler.startup_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const scheduleTimer = scheduler
  ? setInterval(() => void scheduleTick(), env.JOB_SCHEDULE_INTERVAL_MS)
  : undefined;
const cleanupTimer = database
  ? setInterval(() => void cleanupTick(), env.JOB_CLEANUP_INTERVAL_MS)
  : undefined;
scheduleTimer?.unref();
cleanupTimer?.unref();

const app = createApp(env, { database, registry, isReady: () => ready });
const server = app.listen(env.JOBS_SERVICE_PORT);
console.log(
  `${env.serviceName} listening on http://localhost:${server.server?.port ?? env.JOBS_SERVICE_PORT}`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${env.serviceName} received ${signal}, shutting down`);
  if (scheduleTimer) clearInterval(scheduleTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  await server.stop();
  await ActivityLog.flush(env.LOG_FLUSH_TIMEOUT_MS);
  if (logDatabase) await closeDatabaseClient(logDatabase);
  if (database) await closeDatabaseClient(database);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
