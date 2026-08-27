import { describe, expect, test } from 'bun:test';
import { loadNotificationEnv } from './env';

describe('notification environment', () => {
  test('AC-2 uses notification-specific overrides and safe defaults', () => {
    const environment = loadNotificationEnv({
      NODE_ENV: 'test',
      NOTIFICATION_DATABASE_URL: 'postgres://notification@localhost/db',
      NOTIFICATION_SERVICE_PORT: '3110',
      NOTIFICATION_RETENTION_DAYS: '90',
      NOTIFICATION_CLEANUP_INTERVAL_MS: '60000',
      NOTIFICATION_CENTER_ENABLED: 'false',
      SMTP_PORT: '2526',
      SMTP_HOST: 'smtp.local',
      SMTP_FROM: 'alerts@local.app',
    });

    expect(environment.serviceName).toBe('notification');
    expect(environment.NOTIFICATION_DATABASE_URL).toBe(
      'postgres://notification@localhost/db',
    );
    expect(environment.NOTIFICATION_SERVICE_PORT).toBe(3110);
    expect(environment.NOTIFICATION_RETENTION_DAYS).toBe(90);
    expect(environment.NOTIFICATION_CLEANUP_INTERVAL_MS).toBe(60000);
    expect(environment.NOTIFICATION_CENTER_ENABLED).toBe(false);
    expect(environment.SMTP_HOST).toBe('smtp.local');
    expect(environment.SMTP_PORT).toBe(2526);
    expect(environment.SMTP_FROM).toBe('alerts@local.app');
  });

  test('AC-2 falls back to the shared database URL and defaults', () => {
    const environment = loadNotificationEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://shared@localhost/db',
    });

    expect(environment.NOTIFICATION_DATABASE_URL).toBe(
      'postgres://shared@localhost/db',
    );
    expect(environment.NOTIFICATION_SERVICE_PORT).toBe(3106);
    expect(environment.NOTIFICATION_RETENTION_DAYS).toBe(365);
    expect(environment.NOTIFICATION_CENTER_ENABLED).toBe(true);
    expect(environment.SMTP_PORT).toBe(2525);
  });

  test('AC-2 rejects non-positive numeric settings', () => {
    expect(() =>
      loadNotificationEnv({ NODE_ENV: 'test', SMTP_PORT: '0' }),
    ).toThrow('must be positive');
    expect(() =>
      loadNotificationEnv({
        NODE_ENV: 'test',
        NOTIFICATION_RETENTION_DAYS: '1.5',
      }),
    ).toThrow('must be positive');
  });
});
