import { describe, expect, test } from 'bun:test';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import { FakeObservabilitySignalStore } from '#project/observability';
import { createApp as createAccessApp } from '../../../../services/access/src/app';
import { loadAccessEnv } from '../../../../services/access/src/config/env';
import { createApp as createAuthApp } from '../../../../services/auth/src/app';
import { createApp as createJobsApp } from '../../../../services/jobs/src/app';
import { loadJobsEnv } from '../../../../services/jobs/src/config/env';
import { createApp as createLogsApp } from '../../../../services/logs/src/app';
import { createApp as createNotificationApp } from '../../../../services/notification/src/app';
import { loadNotificationEnv } from '../../../../services/notification/src/config/env';
import { createApp as createUserApp } from '../../../../services/user/src/app';
import { createApp as createGatewayApp } from '../app';
import { loadGatewayEnv } from '../config/env';

const PATH = '/internal/observability/storage-health';
const SECRET = 'storage-health-contract-secret';

function signedRequest(): Request {
  const identity = {
    userId: '0198f8a0-0000-7000-8000-000000000001',
    email: 'operator@project.local',
    permissions: ['observability:trace:read'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  return new Request(new URL(PATH, 'http://localhost'), {
    headers: {
      'x-auth-user-id': identity.userId,
      'x-auth-email': identity.email,
      'x-auth-permissions': identity.permissions.join(','),
      'x-auth-expires-at': identity.expiresAt,
      'x-auth-signature': signAuthIdentity('GET', PATH, identity, SECRET),
    },
  });
}

describe('observability storage health app registration', () => {
  test('uses each Bun backend local Signal store without gateway proxying', async () => {
    const signalStore = new FakeObservabilitySignalStore();
    const apps: Array<{
      name: string;
      handle: (request: Request) => Promise<Response>;
    }> = [
      {
        name: 'gateway',
        handle: createGatewayApp(
          loadGatewayEnv({
            NODE_ENV: 'test',
            PORT: '3000',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          { signalStore },
        ).handle,
      },
      {
        name: 'auth',
        handle: createAuthApp(
          loadEnv('auth', {
            NODE_ENV: 'test',
            PORT: '3101',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          {},
          {},
          undefined,
          signalStore,
        ).handle,
      },
      {
        name: 'user',
        handle: createUserApp(
          loadEnv('user', {
            NODE_ENV: 'test',
            PORT: '3102',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          { signalStore },
        ).handle,
      },
      {
        name: 'access',
        handle: createAccessApp(
          loadAccessEnv({
            NODE_ENV: 'test',
            PORT: '3104',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          { signalStore },
        ).handle,
      },
      {
        name: 'logs',
        handle: createLogsApp(
          loadEnv('logs', {
            NODE_ENV: 'test',
            PORT: '3103',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          { signalStore },
        ).handle,
      },
      {
        name: 'jobs',
        handle: createJobsApp(
          loadJobsEnv({
            NODE_ENV: 'test',
            JOBS_SERVICE_PORT: '3105',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          { signalStore },
        ).handle,
      },
      {
        name: 'notification',
        handle: createNotificationApp(
          loadNotificationEnv({
            NODE_ENV: 'test',
            NOTIFICATION_SERVICE_PORT: '3106',
            INTERNAL_AUTH_SIGNING_SECRET: SECRET,
          }),
          undefined,
          undefined,
          signalStore,
        ).handle,
      },
    ];

    for (const app of apps) {
      const response = await app.handle(signedRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        state: 'available',
        queueDepth: 0,
        queueBytes: 0,
        schemaVersion: 1,
        failureCode: null,
      });
    }

    await signalStore.shutdown();
  });
});
