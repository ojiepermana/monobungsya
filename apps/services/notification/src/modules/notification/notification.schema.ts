import { t } from 'elysia';

const nullableString = t.Union([t.String(), t.Null()]);
const meta = t.Object({
  page: t.Integer(),
  perPage: t.Integer(),
  total: t.Integer(),
  totalPages: t.Integer(),
});

export const notificationsQuery = t.Object({
  page: t.Optional(t.String()),
  category: t.Optional(t.String()),
  unreadOnly: t.Optional(t.String()),
});

const notification = t.Object({
  id: t.String(),
  category: t.String(),
  severity: t.String(),
  type: t.String(),
  title: t.String(),
  body: t.String(),
  metadata: t.Record(t.String(), t.Unknown()),
  actionRoute: nullableString,
  readAt: nullableString,
  createdAt: t.String(),
});

export const notificationsResponse = t.Object({
  data: t.Array(notification),
  meta,
  filters: t.Object({
    page: t.Integer(),
    category: t.String(),
    unreadOnly: t.Boolean(),
  }),
  options: t.Object({ categories: t.Array(t.String()) }),
});

export const unreadCountResponse = t.Object({
  total: t.Integer(),
  categories: t.Record(t.String(), t.Integer()),
});

export const notificationIdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});
export const notificationResponse = notification;
export const preferenceBody = t.Object({ enabled: t.Boolean() });
export const preferenceParams = t.Object({
  category: t.String(),
  channel: t.Union([t.Literal('in_app'), t.Literal('email')]),
});
export const preferenceResponse = t.Object({
  category: t.String(),
  channel: t.String(),
  enabled: t.Boolean(),
  mandatory: t.Boolean(),
});
export const preferencesResponse = t.Object({
  categories: t.Array(
    t.Object({
      category: t.String(),
      channels: t.Array(
        t.Object({
          channel: t.String(),
          enabled: t.Boolean(),
          mandatory: t.Boolean(),
        }),
      ),
    }),
  ),
});
