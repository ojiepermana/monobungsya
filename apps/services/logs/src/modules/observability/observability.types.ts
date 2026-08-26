export interface TraceQuery {
  from?: string;
  to?: string;
  service?: string;
  resourceKind?: string;
  resourceName?: string;
  status?: string;
  correlationId?: string;
  requestId?: string;
  runId?: string;
  cursor?: string;
}

export interface TraceSummary {
  traceId: string;
  serviceName: string;
  resourceName: string;
  status: 'ok' | 'error' | 'unset';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  spanCount: number;
  samplingReason: string;
  complete: boolean;
  correlationId: string | null;
  requestId: string | null;
  runId: string | null;
}

export interface TraceListResult {
  data: TraceSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    services: string[];
    resourceKinds: string[];
    resourceNames: string[];
  };
  completeness: 'complete' | 'partial';
  storageStatus: 'available' | 'blind_spot';
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  serviceName: string;
  serviceInstanceId: string;
  resourceKind: string;
  resourceName: string;
  operation: string;
  status: 'ok' | 'error' | 'unset';
  samplingReason: string;
  attributes: unknown;
  errorType: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  orphan: boolean;
}

export interface TraceDetailResult {
  traceId: string;
  spans: TraceSpan[];
  orphanRoots: string[];
  completeness: 'complete' | 'partial';
  samplingReasons: string[];
  storageStatus: 'available' | 'blind_spot';
}

export interface MetricQuery {
  from?: string;
  to?: string;
  metric?: string;
  service?: string;
  resourceKind?: string;
  resourceName?: string;
  statistic?: string;
  step?: string;
  group?: string;
  groups?: readonly MetricGroup[];
}

export const METRIC_GROUPS = [
  'service',
  'resourceKind',
  'resourceName',
  'status',
] as const;

export type MetricGroup = (typeof METRIC_GROUPS)[number];

export interface MetricPoint {
  bucketStart: string;
  value: number;
  count: number;
  serviceName: string;
  resourceKind: string;
  resourceName: string;
  metricName: string;
  unit: string;
  labels: unknown;
}

export interface MetricsResult {
  data: MetricPoint[];
  statistic: 'count' | 'sum' | 'min' | 'max';
  stepSeconds: number;
  coverage: {
    expectedBuckets: number;
    storedBuckets: number;
    missingBuckets: number;
    storageStatus: 'available' | 'blind_spot';
  };
  options: {
    metrics: string[];
    services: string[];
    resourceKinds: string[];
  };
}

export interface BenchmarkRunQuery {
  scenarioId?: string;
  status?: string;
  sourceCommitSha?: string;
  bunVersion?: string;
  cursor?: string;
}

export interface BenchmarkRunSummary {
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  status: string;
  sourceCommitSha: string;
  fixtureVersion: string;
  environment: string;
  bunVersion: string;
  completeness: string;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  comparisonStatus: string | null;
}

export interface BenchmarkComparison {
  comparisonId: string;
  resourceKind: string;
  resourceName: string;
  metricKey: string;
  statistic: string;
  unit: string;
  baselineValue: number | null;
  candidateValue: number;
  absoluteDelta: number | null;
  relativeDeltaPercent: number | null;
  absoluteThreshold: number | null;
  relativeThreshold: number | null;
  decision: 'pass' | 'fail' | 'not_comparable';
  evidenceUri: string | null;
}

export interface BenchmarkRunDetail extends BenchmarkRunSummary {
  sourceBranch: string | null;
  sourceChecksum: string;
  runnerProfile: unknown;
  instrumentationSchemaVersion: string;
  thresholdPolicyVersion: string;
  artifactUri: string | null;
  traceUri: string | null;
  artifactChecksum: string | null;
  comparisons: BenchmarkComparison[];
}

export interface BenchmarkRunsResult {
  data: BenchmarkRunSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    scenarioIds: string[];
    statuses: string[];
    bunVersions: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

export interface BenchmarkBaselineQuery {
  scenarioId?: string;
  scenarioVersion?: string;
  fixtureVersion?: string;
  environment?: string;
  cursor?: string;
}

export interface BenchmarkBaselineSummary {
  baselineId: string;
  scenarioId: string;
  scenarioVersion: string;
  approvedRunId: string;
  fixtureVersion: string;
  environment: string;
  instrumentationSchemaVersion: string;
  thresholdPolicyVersion: string;
  approvalCommitSha: string;
  active: boolean;
  promotedAt: string;
}

export interface BenchmarkBaselinesResult {
  data: BenchmarkBaselineSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    scenarioIds: string[];
    environments: string[];
    fixtureVersions: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

export interface AlertQuery {
  status?: string;
  severity?: 'warning' | 'critical';
  service?: string;
  ruleId?: string;
  seriesFingerprint?: string;
  cursor?: string;
}

export interface AlertStateSummary {
  ruleId: string;
  ruleVersion: string;
  seriesFingerprint: string;
  serviceName: string;
  resourceKind: string;
  resourceName: string;
  status: 'pending' | 'firing' | 'resolved' | 'unknown';
  consecutiveBreachWindows: number;
  consecutiveHealthyWindows: number;
  transitionSequence: number;
  firstBreachedAt: string | null;
  lastEvaluatedAt: string;
  evidenceBucket: string | null;
  lastNotifiedAt: string | null;
  resolvedAt: string | null;
  title?: string;
  severity?: 'warning' | 'critical';
  metric?: string;
  threshold?: number;
  windowSeconds?: number;
  ruleChecksum?: string;
}

export interface AlertsResult {
  data: AlertStateSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    ruleIds: string[];
    services: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

export interface BenchmarkIngestionResult {
  ingestionId: string;
  runId: string;
  reportChecksum: string;
  projectionCounts: {
    runs: number;
    comparisons: number;
    baselines: number;
  };
}
