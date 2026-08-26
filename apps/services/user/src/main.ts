import {
  closeDatabaseClient,
  createDatabaseClient,
  createTelemetryDatabaseClient,
} from '#project/database';
import {
  authSendUserInvitationContract,
  JobRegistry,
  notificationCreateContract,
  notificationRecipientSyncContract,
} from '#project/jobs';
import { ActivityLog } from '#project/logger';
import { tryConnectMessaging } from '#project/messaging';
import { createRuntimeObservabilitySignalStore } from '#project/observability';
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
    ? createTelemetryDatabaseClient(database, telemetry, 'user.database')
    : database;
const jobs = env.DURABLE_JOBS_ENABLED ? new JobRegistry() : undefined;
if (jobs) {
  jobs.registerContract(authSendUserInvitationContract);
  jobs.registerContract(notificationCreateContract);
  jobs.registerContract(notificationRecipientSyncContract);
}
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
  signalStore,
});
// A missing broker degrades this service, it does not stop it: a create still
// commits and the invitation is logged as skipped (spec 0007, AC-2).
const messaging =
  env.ENABLE_INFRASTRUCTURE && !env.DURABLE_JOBS_ENABLED
    ? await tryConnectMessaging(
        env.NATS_URL,
        env.serviceName,
        (error) => {
          console.warn(
            `${env.serviceName} could not reach NATS at ${env.NATS_URL}; events will be skipped:`,
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
  signalStore,
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
