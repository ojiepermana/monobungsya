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

export const accessLogsQuery = t.Object({
  search: t.Optional(t.String()),
  event: t.Optional(t.String()),
  outcome: t.Optional(t.String()),
  page: t.Optional(t.String()),
  actorUserId: t.Optional(t.String({ format: 'uuid' })),
});

export const accessLogsResponse = t.Object({
  data: t.Array(
    t.Object({
      event: t.String(),
      outcome: t.String(),
      routeName: nullableString,
      path: nullableString,
      method: nullableString,
      httpStatus: t.Union([t.Integer(), t.Null()]),
      requestId: nullableString,
      actorEmail: nullableString,
      failureReason: nullableString,
      accessedAt: t.String(),
    }),
  ),
  meta: logsMeta,
  filters: t.Object({
    search: t.String(),
    event: t.String(),
    outcome: t.String(),
  }),
  options: t.Object({
    events: t.Array(t.String()),
    outcomes: t.Array(t.String()),
  }),
});

export const applicationLogsQuery = t.Object({
  search: t.Optional(t.String()),
  level: t.Optional(t.String()),
  module: t.Optional(t.String()),
  event: t.Optional(t.String()),
  page: t.Optional(t.String()),
  actorUserId: t.Optional(t.String({ format: 'uuid' })),
});

export const applicationLogsResponse = t.Object({
  data: t.Array(
    t.Object({
      id: t.String(),
      level: t.String(),
      channel: t.String(),
      category: t.String(),
      event: nullableString,
      module: nullableString,
      message: t.String(),
      context: t.Unknown(),
      exceptionClass: nullableString,
      exceptionMessage: nullableString,
      stackTrace: nullableString,
      actorUserId: nullableString,
      actorName: nullableString,
      actorEmail: nullableString,
      occurredAt: t.String(),
      createdAt: t.String(),
    }),
  ),
  meta: logsMeta,
  filters: t.Object({
    search: t.String(),
    level: t.String(),
    module: t.String(),
    event: t.String(),
  }),
  options: t.Object({
    levels: t.Array(t.String()),
    modules: t.Array(t.String()),
    events: t.Array(t.String()),
  }),
});
