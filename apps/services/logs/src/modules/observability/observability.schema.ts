import { t } from 'elysia';

const nullableString = t.Union([t.String(), t.Null()]);
const storageStatus = t.Union([
  t.Literal('available'),
  t.Literal('blind_spot'),
]);

export const tracesQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  service: t.Optional(t.String({ maxLength: 50 })),
  resourceKind: t.Optional(t.String({ maxLength: 40 })),
  resourceName: t.Optional(t.String({ maxLength: 150 })),
  status: t.Optional(
    t.Union([t.Literal('ok'), t.Literal('error'), t.Literal('unset')]),
  ),
  correlationId: t.Optional(t.String({ maxLength: 100 })),
  requestId: t.Optional(t.String({ maxLength: 100 })),
  runId: t.Optional(t.String({ format: 'uuid' })),
  cursor: t.Optional(t.String({ maxLength: 512 })),
});

const traceSummary = t.Object({
  traceId: t.String(),
  serviceName: t.String(),
  resourceName: t.String(),
  status: t.Union([t.Literal('ok'), t.Literal('error'), t.Literal('unset')]),
  startedAt: t.String(),
  finishedAt: t.String(),
  durationMs: t.Number(),
  spanCount: t.Integer(),
  samplingReason: t.String(),
  complete: t.Boolean(),
  correlationId: nullableString,
  requestId: nullableString,
  runId: nullableString,
});

export const tracesResponse = t.Object({
  data: t.Array(traceSummary),
  nextCursor: nullableString,
  completeness: t.Union([t.Literal('complete'), t.Literal('partial')]),
  storageStatus,
});

const traceSpan = t.Object({
  traceId: t.String(),
  spanId: t.String(),
  parentSpanId: nullableString,
  serviceName: t.String(),
  serviceInstanceId: t.String(),
  resourceKind: t.String(),
  resourceName: t.String(),
  operation: t.String(),
  status: t.Union([t.Literal('ok'), t.Literal('error'), t.Literal('unset')]),
  samplingReason: t.String(),
  attributes: t.Unknown(),
  errorType: nullableString,
  startedAt: t.String(),
  finishedAt: t.String(),
  durationMs: t.Number(),
  orphan: t.Boolean(),
});

export const traceParams = t.Object({
  traceId: t.String({ pattern: '^[0-9a-f]{32}$' }),
});

export const traceDetailResponse = t.Object({
  traceId: t.String(),
  spans: t.Array(traceSpan),
  orphanRoots: t.Array(t.String()),
  completeness: t.Union([t.Literal('complete'), t.Literal('partial')]),
  samplingReasons: t.Array(t.String()),
  storageStatus,
});

export const metricsQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  metric: t.Optional(t.String({ maxLength: 100 })),
  service: t.Optional(t.String({ maxLength: 50 })),
  resourceKind: t.Optional(t.String({ maxLength: 40 })),
  resourceName: t.Optional(t.String({ maxLength: 150 })),
  group: t.Optional(t.String({ maxLength: 120 })),
  statistic: t.Optional(
    t.Union([
      t.Literal('count'),
      t.Literal('sum'),
      t.Literal('min'),
      t.Literal('max'),
    ]),
  ),
  step: t.Optional(t.String()),
});

export const metricsResponse = t.Object({
  data: t.Array(
    t.Object({
      bucketStart: t.String(),
      value: t.Number(),
      count: t.Integer(),
      serviceName: t.String(),
      resourceKind: t.String(),
      resourceName: t.String(),
      metricName: t.String(),
      unit: t.String(),
      labels: t.Unknown(),
    }),
  ),
  statistic: t.Union([
    t.Literal('count'),
    t.Literal('sum'),
    t.Literal('min'),
    t.Literal('max'),
  ]),
  stepSeconds: t.Integer(),
  coverage: t.Object({
    expectedBuckets: t.Integer(),
    storedBuckets: t.Integer(),
    missingBuckets: t.Integer(),
    storageStatus,
  }),
});

export const benchmarkRunsQuery = t.Object({
  scenarioId: t.Optional(t.String({ maxLength: 120 })),
  status: t.Optional(t.String({ maxLength: 30 })),
  sourceCommitSha: t.Optional(t.String({ maxLength: 64 })),
  bunVersion: t.Optional(t.String({ maxLength: 50 })),
  cursor: t.Optional(t.String({ maxLength: 512 })),
});

const benchmarkRunSummary = t.Object({
  runId: t.String({ format: 'uuid' }),
  scenarioId: t.String(),
  scenarioVersion: t.String(),
  status: t.String(),
  sourceCommitSha: t.String(),
  fixtureVersion: t.String(),
  environment: t.String(),
  bunVersion: t.String(),
  completeness: t.String(),
  startedAt: t.String(),
  finishedAt: nullableString,
  createdAt: t.String(),
  comparisonStatus: nullableString,
});

export const benchmarkRunsResponse = t.Object({
  data: t.Array(benchmarkRunSummary),
  nextCursor: nullableString,
  storageStatus,
});

const comparison = t.Object({
  comparisonId: t.String({ format: 'uuid' }),
  resourceKind: t.String(),
  resourceName: t.String(),
  metricKey: t.String(),
  statistic: t.String(),
  unit: t.String(),
  baselineValue: t.Union([t.Number(), t.Null()]),
  candidateValue: t.Number(),
  absoluteDelta: t.Union([t.Number(), t.Null()]),
  relativeDeltaPercent: t.Union([t.Number(), t.Null()]),
  absoluteThreshold: t.Union([t.Number(), t.Null()]),
  relativeThreshold: t.Union([t.Number(), t.Null()]),
  decision: t.Union([
    t.Literal('pass'),
    t.Literal('fail'),
    t.Literal('not_comparable'),
  ]),
  evidenceUri: nullableString,
});

export const benchmarkRunParams = t.Object({
  runId: t.String({ format: 'uuid' }),
});

export const benchmarkRunResponse = t.Composite([
  benchmarkRunSummary,
  t.Object({
    sourceBranch: nullableString,
    sourceChecksum: t.String(),
    runnerProfile: t.Unknown(),
    instrumentationSchemaVersion: t.String(),
    thresholdPolicyVersion: t.String(),
    artifactUri: nullableString,
    traceUri: nullableString,
    artifactChecksum: nullableString,
    comparisons: t.Array(comparison),
  }),
]);

export const benchmarkBaselinesQuery = t.Object({
  scenarioId: t.Optional(t.String({ maxLength: 120 })),
  scenarioVersion: t.Optional(t.String({ maxLength: 50 })),
  fixtureVersion: t.Optional(t.String({ maxLength: 100 })),
  environment: t.Optional(t.String({ maxLength: 50 })),
});

export const benchmarkBaselinesResponse = t.Object({
  data: t.Array(
    t.Object({
      baselineId: t.String({ format: 'uuid' }),
      scenarioId: t.String(),
      scenarioVersion: t.String(),
      approvedRunId: t.String({ format: 'uuid' }),
      fixtureVersion: t.String(),
      environment: t.String(),
      instrumentationSchemaVersion: t.String(),
      thresholdPolicyVersion: t.String(),
      approvalCommitSha: t.String(),
      active: t.Boolean(),
      promotedAt: t.String(),
    }),
  ),
  storageStatus,
});

export const alertsQuery = t.Object({
  status: t.Optional(
    t.Union([
      t.Literal('pending'),
      t.Literal('firing'),
      t.Literal('resolved'),
      t.Literal('unknown'),
    ]),
  ),
  severity: t.Optional(t.Union([t.Literal('warning'), t.Literal('critical')])),
  service: t.Optional(t.String({ maxLength: 50 })),
  ruleId: t.Optional(t.String({ maxLength: 120 })),
  seriesFingerprint: t.Optional(t.String({ maxLength: 64 })),
  cursor: t.Optional(t.String({ maxLength: 512 })),
});

const alertState = t.Object({
  ruleId: t.String(),
  ruleVersion: t.String(),
  seriesFingerprint: t.String(),
  serviceName: t.String(),
  resourceKind: t.String(),
  resourceName: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('firing'),
    t.Literal('resolved'),
    t.Literal('unknown'),
  ]),
  consecutiveBreachWindows: t.Integer(),
  consecutiveHealthyWindows: t.Integer(),
  transitionSequence: t.Integer(),
  firstBreachedAt: nullableString,
  lastEvaluatedAt: t.String(),
  evidenceBucket: nullableString,
  lastNotifiedAt: nullableString,
  resolvedAt: nullableString,
  title: t.Optional(t.String()),
  severity: t.Optional(t.Union([t.Literal('warning'), t.Literal('critical')])),
  metric: t.Optional(t.String()),
  threshold: t.Optional(t.Number()),
  windowSeconds: t.Optional(t.Integer()),
  ruleChecksum: t.Optional(t.String()),
});

export const alertsResponse = t.Object({
  data: t.Array(alertState),
  nextCursor: nullableString,
  storageStatus,
});
export const alertParams = t.Object({ ruleId: t.String({ maxLength: 120 }) });
export const alertDetailQuery = t.Object({
  seriesFingerprint: t.Optional(t.String({ maxLength: 64 })),
});

export const benchmarkIngestionResponse = t.Object({
  ingestionId: t.String({ format: 'uuid' }),
  runId: t.String({ format: 'uuid' }),
  reportChecksum: t.String({ pattern: '^[0-9a-f]{64}$' }),
  projectionCounts: t.Object({
    runs: t.Integer(),
    comparisons: t.Integer(),
    baselines: t.Integer(),
  }),
});
