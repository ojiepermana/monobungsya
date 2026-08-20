import { closeDatabaseClient } from '#project/database';
import { Logger } from '#project/logger';
import { connectMessaging } from '#project/messaging';
import { createApp } from './app';
import { env } from './config/env';
import { createServiceDatabase } from './database/client';
import { startAuthCleanupWorker } from './jobs/workers/auth-cleanup.worker';
import { SmtpAuthMailer } from './modules/auth/auth.mailer';
import { AuthRepository } from './modules/auth/auth.repository';

const database = env.ENABLE_INFRASTRUCTURE
  ? createServiceDatabase(env)
  : undefined;
const messaging = env.ENABLE_INFRASTRUCTURE
  ? await connectMessaging(env.NATS_URL, env.serviceName)
  : undefined;
const app = createApp(env, {
  database,
  mailer: env.ENABLE_INFRASTRUCTURE
    ? new SmtpAuthMailer({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        username: env.SMTP_USERNAME,
        password: env.SMTP_PASSWORD,
        from: env.SMTP_FROM,
        publicApiUrl: env.PUBLIC_API_URL,
        webAppUrl: env.WEB_APP_URL,
      })
    : undefined,
  webAppUrl: env.WEB_APP_URL,
  cookieName: env.AUTH_SESSION_COOKIE_NAME,
  cookieSecure: env.AUTH_COOKIE_SECURE,
  signingSecret: env.INTERNAL_AUTH_SIGNING_SECRET,
  clockSkewSeconds: env.AUTH_CLOCK_SKEW_SECONDS,
});
const stopCleanupWorker = database
  ? startAuthCleanupWorker(
      new AuthRepository({ database }),
      new Logger(env.serviceName, env.LOG_LEVEL),
    )
  : () => undefined;
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
  if (database) await closeDatabaseClient(database);
}

process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.on(
  'SIGTERM',
  () => void shutdown('SIGTERM').then(() => process.exit(0)),
);
