import { t } from 'elysia';

const nullableString = t.Union([t.String(), t.Null()]);
const jobStatus = t.Union([
  t.Literal('queued'),
  t.Literal('running'),
  t.Literal('retry_wait'),
  t.Literal('completed'),
  t.Literal('failed'),
]);

const jobProperties = {
  id: t.String({ format: 'uuid' }),
  type: t.String(),
  version: t.Integer(),
  sourceService: t.String(),
  targetService: t.String(),
  status: jobStatus,
  priority: t.Integer(),
  runAt: t.String(),
  attemptCount: t.Integer(),
  maxAttempts: t.Integer(),
  lockedBy: nullableString,
  lockedAt: nullableString,
  leaseExpiresAt: nullableString,
  completedAt: nullableString,
  failedAt: nullableString,
  lastErrorCode: nullableString,
  lastErrorMessage: nullableString,
  scheduleCode: nullableString,
  retryOfJobId: nullableString,
  createdAt: t.String(),
  updatedAt: t.String(),
};

export const jobResponse = t.Object(jobProperties);
export const jobIdParams = t.Object({ id: t.String({ format: 'uuid' }) });

export const jobsListQuery = t.Object({
  page: t.Optional(t.String({ maxLength: 8 })),
  pageSize: t.Optional(t.String({ maxLength: 8 })),
  status: t.Optional(jobStatus),
  type: t.Optional(t.String({ maxLength: 100 })),
  sourceService: t.Optional(t.String({ maxLength: 50 })),
  targetService: t.Optional(t.String({ maxLength: 50 })),
  from: t.Optional(t.String({ maxLength: 40 })),
  to: t.Optional(t.String({ maxLength: 40 })),
});

export const jobsListResponse = t.Object({
  data: t.Array(jobResponse),
  meta: t.Object({
    page: t.Integer(),
    perPage: t.Integer(),
    total: t.Integer(),
    totalPages: t.Integer(),
  }),
  filters: t.Object({
    page: t.Integer(),
    status: t.String(),
    type: t.String(),
    sourceService: t.String(),
    targetService: t.String(),
    from: t.String(),
    to: t.String(),
  }),
  options: t.Object({
    statuses: t.Array(jobStatus),
    types: t.Array(t.String()),
    sourceServices: t.Array(t.String()),
    targetServices: t.Array(t.String()),
  }),
});

export const jobAttemptResponse = t.Object({
  id: t.String({ format: 'uuid' }),
  attemptNumber: t.Integer(),
  workerId: t.String(),
  startedAt: t.String(),
  finishedAt: nullableString,
  outcome: t.Union([
    t.Literal('completed'),
    t.Literal('retry'),
    t.Literal('failed'),
    t.Literal('abandoned'),
    t.Null(),
  ]),
  durationMs: t.Union([t.Integer(), t.Null()]),
  errorCode: nullableString,
  errorMessage: nullableString,
});

export const jobDetailResponse = t.Object({
  ...jobProperties,
  payload: t.Record(t.String(), t.Unknown()),
  attempts: t.Array(jobAttemptResponse),
});

export const jobRetryBody = t.Object({
  reason: t.String({ minLength: 3, maxLength: 1000 }),
});

export const jobSummaryResponse = t.Object({
  queued: t.Integer(),
  running: t.Integer(),
  retrying: t.Integer(),
  completed: t.Integer(),
  failed: t.Integer(),
  expiredLeaseCount: t.Integer(),
  oldestQueuedAt: nullableString,
  oldestQueuedAgeSeconds: t.Union([t.Integer(), t.Null()]),
});
