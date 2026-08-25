import { Elysia } from 'elysia';
import type { AuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { createAuthIdentityPlugin } from '../../shared/plugins/auth-identity.plugin';
import {
  notificationIdParams,
  notificationResponse,
  notificationsQuery,
  notificationsResponse,
  preferenceBody,
  preferenceParams,
  preferenceResponse,
  preferencesResponse,
  unreadCountResponse,
} from './notification.schema';
import { NotificationService } from './notification.service';

export function createNotificationRoute(
  database: DatabaseClient,
  options: { signingSecret: string; clockSkewSeconds: number },
) {
  const service = new NotificationService(database);
  return new Elysia({ name: 'notification-routes' })
    .use(
      createAuthIdentityPlugin(options.signingSecret, options.clockSkewSeconds),
    )
    .get(
      '/internal/notifications',
      ({ identity, query }) => service.list(identity.userId, query),
      { query: notificationsQuery, response: { 200: notificationsResponse } },
    )
    .get(
      '/internal/notifications/unread-count',
      ({ identity }) => service.unreadCount(identity.userId),
      { response: { 200: unreadCountResponse } },
    )
    .patch(
      '/internal/notifications/:id/read',
      ({ identity, params }) => service.markRead(identity.userId, params.id),
      { params: notificationIdParams, response: { 200: notificationResponse } },
    )
    .post('/internal/notifications/read-all', ({ identity }) =>
      service.markAllRead(identity.userId),
    )
    .get(
      '/internal/notifications/preferences',
      ({ identity }) => service.preferences(identity.userId),
      { response: { 200: preferencesResponse } },
    )
    .patch(
      '/internal/notifications/preferences/:category/:channel',
      ({ identity, params, body }) =>
        service.updatePreference(
          identity.userId,
          params.category,
          params.channel,
          body.enabled,
        ),
      {
        params: preferenceParams,
        body: preferenceBody,
        response: { 200: preferenceResponse },
      },
    )
    .get('/internal/notifications/me', ({ identity }) => ({
      userId: (identity as AuthIdentity).userId,
    }));
}
