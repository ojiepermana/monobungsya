import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import { createApp } from './app';
import { loadNotificationEnv } from './config/env';

const environment = loadNotificationEnv({
  NODE_ENV: 'test',
  NOTIFICATION_SERVICE_PORT: '3110',
  INTERNAL_AUTH_SIGNING_SECRET: 'notification-test-secret',
});

const database = (async () => []) as unknown as DatabaseClient;

describe('notification app health', () => {
  test('AC-2 exposes liveness and reports starting without a database', async () => {
    const app = createApp(environment);
    const health = await app.handle(new Request('http://localhost/health'));
    const ready = await app.handle(new Request('http://localhost/ready'));

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      status: 'ok',
      service: 'notification',
    });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'starting' });
  });

  test('AC-2 reports ready and mounts internal routes with a database', async () => {
    const app = createApp(environment, database);
    const ready = await app.handle(new Request('http://localhost/ready'));

    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ok' });
    expect(
      (
        await app.handle(
          new Request('http://localhost/internal/notifications/me'),
        )
      ).status,
    ).toBe(401);
  });
});
