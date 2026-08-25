import { type AppEnvironment, loadEnv } from '#project/config';

export interface NotificationEnvironment extends AppEnvironment {
  NOTIFICATION_SERVICE_PORT: number;
  NOTIFICATION_DATABASE_URL: string;
  NOTIFICATION_RETENTION_DAYS: number;
  NOTIFICATION_CLEANUP_INTERVAL_MS: number;
  NOTIFICATION_CENTER_ENABLED: boolean;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
}

export function loadNotificationEnv(
  source: Record<string, string | undefined> = Bun.env,
): NotificationEnvironment {
  const databaseUrl = source.NOTIFICATION_DATABASE_URL ?? source.DATABASE_URL;
  const environment = loadEnv('notification', {
    ...source,
    PORT: source.NOTIFICATION_SERVICE_PORT ?? '3106',
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  });

  return {
    ...environment,
    NOTIFICATION_SERVICE_PORT: positive(source.NOTIFICATION_SERVICE_PORT, 3106),
    NOTIFICATION_DATABASE_URL: databaseUrl ?? environment.DATABASE_URL,
    NOTIFICATION_RETENTION_DAYS: positive(
      source.NOTIFICATION_RETENTION_DAYS,
      365,
    ),
    NOTIFICATION_CLEANUP_INTERVAL_MS: positive(
      source.NOTIFICATION_CLEANUP_INTERVAL_MS,
      24 * 60 * 60 * 1000,
    ),
    NOTIFICATION_CENTER_ENABLED: source.NOTIFICATION_CENTER_ENABLED !== 'false',
    SMTP_HOST: source.SMTP_HOST ?? '127.0.0.1',
    SMTP_PORT: positive(source.SMTP_PORT, 2525),
    SMTP_USERNAME: source.SMTP_USERNAME ?? 'monobungsia',
    SMTP_PASSWORD: source.SMTP_PASSWORD ?? '',
    SMTP_FROM: source.SMTP_FROM ?? 'no-reply@localhost',
  };
}

function positive(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('notification numeric configuration must be positive');
  }
  return parsed;
}

export const env = loadNotificationEnv();
