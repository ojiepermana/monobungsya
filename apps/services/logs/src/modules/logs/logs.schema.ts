import { t } from 'elysia';

const nullableString = t.Union([t.String(), t.Null()]);
const storageStatus = t.Union([
  t.Literal('available'),
  t.Literal('blind_spot'),
]);
const nullableSessionSummary = t.Union([
  t.Object({
    state: t.Union([
      t.Literal('authenticated'),
      t.Literal('anonymous'),
      t.Literal('invalid'),
    ]),
    reason: t.Union([t.String(), t.Null()]),
    permissionCount: t.Integer(),
  }),
  t.Null(),
]);

const logsMeta = t.Object({
  page: t.Integer(),
  perPage: t.Integer(),
  total: t.Integer(),
  totalPages: t.Integer(),
});

export const rateLimitResponse = t.Object(
  {
    error: t.Object({
      code: t.Literal('RATE_LIMITED'),
      message: t.String(),
      reason: t.Optional(t.String()),
      requestId: t.Optional(t.String()),
    }),
  },
  {
    description:
      'The Signal query capacity is full. Retry after the number of seconds in the Retry-After response header.',
  },
);

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
  traceId: t.Optional(t.String()),
  page: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  cursor: t.Optional(t.String({ maxLength: 512 })),
  actorUserId: t.Optional(t.String({ format: 'uuid' })),
});

const accessLogItems = t.Array(
  t.Object({
    event: t.String(),
    outcome: t.String(),
    routeName: nullableString,
    path: nullableString,
    method: nullableString,
    httpStatus: t.Union([t.Integer(), t.Null()]),
    requestId: nullableString,
    traceId: nullableString,
    traceSource: t.Union([
      t.Literal('client_header'),
      t.Literal('request_id'),
      t.Null(),
    ]),
    clientRoute: nullableString,
    sessionId: nullableString,
    sessionSummary: nullableSessionSummary,
    actorEmail: nullableString,
    failureReason: nullableString,
    accessedAt: t.String(),
  }),
);
const accessLogFilters = t.Object({
  search: t.String(),
  event: t.String(),
  outcome: t.String(),
  traceId: t.String(),
});
const accessLogOptions = t.Object({
  events: t.Array(t.String()),
  outcomes: t.Array(t.String()),
});
const postgresAccessLogsResponse = t.Object({
  data: accessLogItems,
  meta: logsMeta,
  filters: accessLogFilters,
  options: accessLogOptions,
});
const signalAccessLogsResponse = t.Object({
  data: accessLogItems,
  prevCursor: nullableString,
  nextCursor: nullableString,
  filters: accessLogFilters,
  options: accessLogOptions,
  storageStatus,
  blindSpotSince: nullableString,
});

export const accessLogsResponse = t.Union([
  postgresAccessLogsResponse,
  signalAccessLogsResponse,
]);

export const applicationLogsQuery = t.Object({
  search: t.Optional(t.String()),
  level: t.Optional(t.String()),
  module: t.Optional(t.String()),
  event: t.Optional(t.String()),
  page: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  cursor: t.Optional(t.String({ maxLength: 512 })),
  actorUserId: t.Optional(t.String({ format: 'uuid' })),
});

const applicationLogItems = t.Array(
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
);
const applicationLogFilters = t.Object({
  search: t.String(),
  level: t.String(),
  module: t.String(),
  event: t.String(),
});
const applicationLogOptions = t.Object({
  levels: t.Array(t.String()),
  modules: t.Array(t.String()),
  events: t.Array(t.String()),
});
const postgresApplicationLogsResponse = t.Object({
  data: applicationLogItems,
  meta: logsMeta,
  filters: applicationLogFilters,
  options: applicationLogOptions,
});
const signalApplicationLogsResponse = t.Object({
  data: applicationLogItems,
  prevCursor: nullableString,
  nextCursor: nullableString,
  filters: applicationLogFilters,
  options: applicationLogOptions,
  storageStatus,
  blindSpotSince: nullableString,
});

export const applicationLogsResponse = t.Union([
  postgresApplicationLogsResponse,
  signalApplicationLogsResponse,
]);
