import { t } from 'elysia';

const nullableString = t.Union([t.String(), t.Null()]);

const logsMeta = t.Object({
  page: t.Integer(),
  perPage: t.Integer(),
  total: t.Integer(),
  totalPages: t.Integer(),
});

export const auditTrailsQuery = t.Object({
  search: t.Optional(t.String()),
  module: t.Optional(t.String()),
  action: t.Optional(t.String()),
  page: t.Optional(t.String()),
  actorUserId: t.Optional(t.String({ format: 'uuid' })),
});

export const auditTrailsResponse = t.Object({
  data: t.Array(
    t.Object({
      id: t.String(),
      action: t.String(),
      module: t.String(),
      entityType: t.String(),
      entityId: t.String(),
      entityLabel: nullableString,
      actorEmail: nullableString,
      actorRole: nullableString,
      changeSummary: nullableString,
      auditedAt: t.String(),
    }),
  ),
  meta: logsMeta,
  filters: t.Object({
    search: t.String(),
    module: t.String(),
    action: t.String(),
  }),
  options: t.Object({
    modules: t.Array(t.String()),
    actions: t.Array(t.String()),
  }),
});
