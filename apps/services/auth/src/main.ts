import {
  closeDatabaseClient,
  createDatabaseClient,
  createTelemetryDatabaseClient,
} from '#project/database';
import { authNotificationCreateContract, JobRegistry } from '#project/jobs';
import { ActivityLog, Logger } from '#project/logger';
import { tryConnectMessaging } from '#project/messaging';
import { createRuntimeObservabilitySignalStore } from '#project/observability';
import { TelemetryRuntime } from '#project/telemetry';
import { createApp } from './app';
import { env } from './config/env';
import { startAuthJobWorker } from './jobs/workers/auth-cleanup.worker';
import { subscribeUserInvited } from './modules/auth/auth.events';
import { SmtpAuthMailer } from './modules/auth/auth.mailer';
import { DurableAuthNotificationSink } from './modules/auth/auth.notifications';
import { AuthRepository } from './modules/auth/auth.repository';
import { AuthService } from './modules/auth/auth.service';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.DATABASE_URL)
  : undefined;
const jobs = env.DURABLE_JOBS_ENABLED ? new JobRegistry() : undefined;
if (jobs) jobs.registerContract(authNotificationCreateContract);
const notificationSink = jobs
  ? new DurableAuthNotificationSink(jobs)
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
    ? createTelemetryDatabaseClient(database, telemetry, 'auth.database')
    : database;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
  signalStore,
});
// Login must not depend on the broker. Without messaging the service still
// signs people in; only the invitation subscriber below is skipped.
const messaging =
  env.ENABLE_INFRASTRUCTURE && !env.DURABLE_JOBS_ENABLED
    ? await tryConnectMessaging(
        env.NATS_URL,
        env.serviceName,
        (error) => {
          console.warn(
            `${env.serviceName} could not reach NATS at ${env.NATS_URL}; invitation emails will not be delivered:`,
            error instanceof Error ? error.message : error,
          );
        },
        telemetry,
      )
    : undefined;
const logger = new Logger(env.serviceName, env.LOG_LEVEL, {
  persist: env.BEST_EFFORT_LOGGING_ENABLED,
});
const mailer = env.ENABLE_INFRASTRUCTURE
  ? new SmtpAuthMailer({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
      publicApiUrl: env.PUBLIC_API_URL,
      webAppUrl: env.WEB_APP_URL,
      telemetry,
    })
  : undefined;
const authRepository = new AuthRepository(
  applicationDatabase
    ? { database: applicationDatabase, notificationSink }
    : undefined,
);
const authService = new AuthService(
  env.serviceName,
  authRepository,
  mailer,
  env.WEB_APP_URL,
);
const app = createApp(
  env,
  {
    database: applicationDatabase,
    notificationSink,
    mailer,
    webAppUrl: env.WEB_APP_URL,
    cookieName: env.AUTH_SESSION_COOKIE_NAME,
    cookieSecure: env.AUTH_COOKIE_SECURE,
    signingSecret: env.INTERNAL_AUTH_SIGNING_SECRET,
    clockSkewSeconds: env.AUTH_CLOCK_SKEW_SECONDS,
    totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
    totpIssuer: env.TOTP_ISSUER,
  },
  {
    rpId: env.WEBAUTHN_RP_ID,
    rpName: env.WEBAUTHN_RP_NAME,
    notificationSink,
  },
  telemetry,
  signalStore,
);
const stopCleanupWorker =
  applicationDatabase && env.DURABLE_JOBS_ENABLED
    ? startAuthJobWorker(
        applicationDatabase,
        authRepository,
        authService,
        logger,
        telemetry,
      )
    : async () => undefined;

// Invitation emails for users the user service creates (spec 0007, AC-2).
if (database && messaging && !env.DURABLE_JOBS_ENABLED) {
  subscribeUserInvited(messaging, authService, logger);
}
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
  await stopCleanupWorker();
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
