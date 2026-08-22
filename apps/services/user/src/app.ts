import { Elysia, t } from 'elysia';
import type { AppEnvironment } from '#project/config';
import { loadEnv } from '#project/config';
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { Logger } from '#project/logger';
import { createUsersRoute } from './modules/users/users.route';
import { createAuthIdentityPlugin } from './shared/plugins/auth-identity.plugin';

export function createApp(environment: AppEnvironment = loadEnv('user')) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL);

  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger, 'user-logger'))
    .use(createErrorHandler('user-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'User Service API',
          version: '0.1.0',
          description: 'Internal HTTP contract for the user service.',
        },
        tags: [
          { name: 'Health', description: 'Service health checks' },
          { name: 'Users', description: 'User module' },
        ],
      }),
    )
    .get(
      '/health',
      () => ({ status: 'ok' as const, service: environment.serviceName }),
      {
        response: {
          200: t.Object({ status: t.Literal('ok'), service: t.String() }),
        },
        detail: { tags: ['Health'], summary: 'Check service health' },
      },
    )
    .use(
      createAuthIdentityPlugin(
        environment.INTERNAL_AUTH_SIGNING_SECRET,
        environment.AUTH_CLOCK_SKEW_SECONDS,
      ),
    )
    .use(createUsersRoute(environment.serviceName));
}
