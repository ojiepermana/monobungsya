import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { ActivityLog, Logger } from '#project/logger';
import { tryConnectMessaging } from '#project/messaging';
import { createApp } from './app';
import { env } from './config/env';
import { startAuthCleanupWorker } from './jobs/workers/auth-cleanup.worker';
import { subscribeUserInvited } from './modules/auth/auth.events';
import { SmtpAuthMailer } from './modules/auth/auth.mailer';
import { AuthRepository } from './modules/auth/auth.repository';
import { AuthService } from './modules/auth/auth.service';

const database = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.DATABASE_URL)
  : undefined;
const logDatabase = env.ENABLE_INFRASTRUCTURE
  ? createDatabaseClient(env.LOG_DATABASE_URL)
  : undefined;
ActivityLog.configure(logDatabase, {
  bestEffort: env.BEST_EFFORT_LOGGING_ENABLED,
});
// Login must not depend on the broker. Without messaging the service still
// signs people in; only the invitation subscriber below is skipped.
const messaging = env.ENABLE_INFRASTRUCTURE
  ? await tryConnectMessaging(env.NATS_URL, env.serviceName, (error) => {
      console.warn(
        `${env.serviceName} could not reach NATS at ${env.NATS_URL}; invitation emails will not be delivered:`,
        error instanceof Error ? error.message : error,
      );
    })
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
    })
  : undefined;
const app = createApp(
  env,
  {
    database,
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
  },
);
const stopCleanupWorker = database
  ? startAuthCleanupWorker(new AuthRepository({ database }), logger)
  : () => undefined;

// Invitation emails for users the user service creates (spec 0007, AC-2).
if (database && messaging) {
  subscribeUserInvited(
    messaging,
    new AuthService(
      env.serviceName,
      new AuthRepository({ database }),
      mailer,
      env.WEB_APP_URL,
    ),
    logger,
  );
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
  stopCleanupWorker();
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
