import { Elysia, t } from 'elysia';
import type { DatabaseClient } from '#project/database';
import {
  createErrorHandler,
  createLoggerPlugin,
  createOpenApiPlugin,
  requestIdPlugin,
} from '#project/elysia';
import { Logger } from '#project/logger';
import type { NotificationEnvironment } from './config/env';
import { createNotificationRoute } from './modules/notification/notification.route';

export function createApp(
  environment: NotificationEnvironment,
  database?: DatabaseClient,
) {
  const logger = new Logger(environment.serviceName, environment.LOG_LEVEL, {
    persist: environment.BEST_EFFORT_LOGGING_ENABLED,
  });
  return new Elysia({ name: environment.serviceName })
    .use(requestIdPlugin)
    .use(createLoggerPlugin(logger, 'notification-logger'))
    .use(createErrorHandler('notification-error-handler', { logger }))
    .use(
      createOpenApiPlugin({
        info: {
          title: 'Notification Service API',
          version: '0.1.0',
          description: 'User notification center and delivery API.',
        },
        tags: [
          { name: 'Health', description: 'Notification health checks' },
          { name: 'Notifications', description: 'User notification center' },
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
        detail: { tags: ['Health'], summary: 'Check notification liveness' },
      },
    )
    .get(
      '/ready',
      () => ({ status: database ? ('ok' as const) : ('starting' as const) }),
      {
        response: {
          200: t.Object({
            status: t.Union([t.Literal('ok'), t.Literal('starting')]),
          }),
        },
        detail: { tags: ['Health'], summary: 'Check notification readiness' },
      },
    )
    .use(
      database
        ? createNotificationRoute(database, {
            signingSecret: environment.INTERNAL_AUTH_SIGNING_SECRET,
            clockSkewSeconds: environment.AUTH_CLOCK_SKEW_SECONDS,
          })
        : new Elysia({ name: 'notification-no-database-routes' }),
    );
}
