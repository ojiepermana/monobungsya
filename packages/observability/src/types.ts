export const OBSERVABILITY_SIGNAL_SCHEMA_VERSION = 1;

export type SignalKind =
  | 'span'
  | 'metric_bucket'
  | 'application_log'
  | 'access_log';

export interface SpanSignal {
  kind: 'span';
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  correlationId: string | null;
  requestId: string | null;
  runId: string | null;
  serviceName: string;
  serviceInstanceId: string;
  resourceKind: string;
  resourceName: string;
  operation: string;
  status: 'ok' | 'error' | 'unset';
  samplingReason: string;
  attributes: Record<string, string | number | boolean>;
  errorType: string | null;
  startedAt: string;
  finishedAt: string;
  durationNs: number;
  schemaVersion: number;
}

export interface MetricBucketSignal {
  kind: 'metric_bucket';
  bucketStart: string;
  bucketWidthSeconds: number;
  seriesFingerprint: string;
  flushSequence: number;
  serviceName: string;
  serviceInstanceId: string;
  resourceKind: string;
  resourceName: string;
  metricName: string;
  metricKind: 'counter' | 'histogram' | 'gauge';
  unit: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  histogramBoundaries: number[];
  histogramCounts: number[];
  labels: Record<string, string>;
  schemaVersion: number;
}

export interface ApplicationLogSignal {
  kind: 'application_log';
  id: string;
  level: string;
  channel: string;
  category: string;
  event: string | null;
  module: string | null;
  message: string;
  context: unknown;
  exceptionClass: string | null;
  exceptionMessage: string | null;
  stackTrace: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  referenceNo: string | null;
  branchCode: string | null;
  requestId: string | null;
  traceId: string | null;
  runtimeTraceId: string | null;
  runtimeSpanId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: string;
  createdAt: string;
  schemaVersion: number;
}

export interface AccessLogSignal {
  kind: 'access_log';
  id: string;
  event: string;
  outcome: string;
  authenticationMethod: string | null;
  accessChannel: string;
  guard: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  branchCode: string | null;
  ipAddress: string | null;
  forwardedIp: string | null;
  userAgent: string | null;
  deviceName: string | null;
  platform: string | null;
  browser: string | null;
  sessionId: string | null;
  requestId: string | null;
  traceId: string | null;
  runtimeTraceId: string | null;
  runtimeSpanId: string | null;
  routeName: string | null;
  path: string | null;
  method: string | null;
  httpStatus: number | null;
  failureReason: string | null;
  metadata: unknown;
  accessedAt: string;
  createdAt: string;
  schemaVersion: number;
}

export type ObservabilitySignal =
  | SpanSignal
  | MetricBucketSignal
  | ApplicationLogSignal
  | AccessLogSignal;

export type AppendResult =
  | { status: 'accepted' }
  | {
      status: 'dropped';
      reason:
        | 'disabled'
        | 'shutting_down'
        | 'queue_full'
        | 'oversize'
        | 'invalid_time'
        | 'invalid_schema';
    };

export interface SignalFlushResult {
  written: number;
  dropped: number;
  timedOut: boolean;
  failed: boolean;
}

export interface SignalTargetDiagnostics {
  written: number;
  dropped: number;
  lastAcknowledgedAt: string | null;
  failureCode: string | null;
}

export interface SignalStoreDiagnostics {
  state: 'available' | 'blind_spot' | 'disabled';
  queueDepth: number;
  queueBytes: number;
  droppedByReason: Readonly<Record<string, number>>;
  blindSpotSince: string | null;
  lastAcknowledgedAt: string | null;
  schemaVersion: number;
  failureCode: string | null;
  targets: Readonly<Record<string, SignalTargetDiagnostics>>;
}

/** The only storage interface a signal producer may use. */
export interface ObservabilitySignalStore {
  append(signal: ObservabilitySignal): AppendResult;
  flush(timeoutMs?: number): Promise<SignalFlushResult>;
  shutdown(timeoutMs?: number): Promise<SignalFlushResult>;
  diagnostics(): SignalStoreDiagnostics;
}

export interface StoredSignalMetadata {
  ingestedAt: string;
  writeVersion: number;
}

export type StoredObservabilitySignal = ObservabilitySignal &
  StoredSignalMetadata;
