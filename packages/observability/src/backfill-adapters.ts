import { createHash } from 'node:crypto';
import type { DatabaseClient } from '#project/database';
import {
  canonicalBackfillRecord,
  type SignalBackfillBatch,
  type SignalBackfillCursor,
  type SignalBackfillGuard,
  type SignalBackfillGuardResult,
  type SignalBackfillPage,
  type SignalBackfillPageRequest,
  type SignalBackfillParity,
  type SignalBackfillParityRequest,
  type SignalBackfillRange,
  type SignalBackfillSource,
  type SignalBackfillTarget,
  stableSampleModulo,
  stableSignalIdentity,
} from './backfill';
import type { ClickHouseClient } from './clickhouse';
import { CLICKHOUSE_VERSION_MANIFEST } from './migrations/manifest';
import { verifyClickHouseSignalSchema } from './migrations/schema';
import { canonicalJson } from './store';
import type {
  AccessLogSignal,
  ApplicationLogSignal,
  MetricBucketSignal,
  ObservabilitySignal,
  SignalKind,
  SpanSignal,
  StoredObservabilitySignal,
} from './types';

const MAX_PAGE_SIZE = 5_000;
const DEFAULT_PARITY_PAGE_SIZE = 1_000;
const DEFAULT_PARITY_MEMORY_BYTES = 268_435_456;
const DEFAULT_GUARD_EVIDENCE_MAX_AGE_MS = 60_000;
const MAX_FRESHNESS_P95_MS = 5_000;
const BACKFILL_DISK_USAGE_LIMIT = 80;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const CURSOR_VERSION = 1;
const CURSOR_ORDER = 'event_time_stable_identity_v1';

type SignalRecord = Record<string, unknown>;

interface BackfillCursor {
  readonly version: number;
  readonly order: string;
  readonly fingerprint: string;
  readonly eventTime: string;
  readonly identity: Readonly<Record<string, string>>;
}

export interface PostgresSignalBackfillSourceOptions {
  readonly telemetryDatabase: DatabaseClient;
  readonly logsDatabase: DatabaseClient;
  /** Bounds the canonical sample retained while its deterministic order is restored. */
  readonly maxParityMemoryBytes?: number;
}

export interface ClickHouseSignalBackfillTargetOptions {
  /** INSERT identity used only for the acknowledged target write. */
  readonly writer: ClickHouseClient;
  /** SELECT identity used only for parity reads. */
  readonly reader: ClickHouseClient;
  /** A backfill worker must set a bounded CPU thread budget explicitly. */
  readonly maxThreads: number;
  /** A backfill worker must set a bounded ClickHouse memory budget explicitly. */
  readonly maxMemoryBytes: number;
  /** Limits client side backfill body throughput before each acknowledged write. */
  readonly maxWriteBytesPerSecond: number;
  readonly parityPageSize?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface SignalBackfillOperationalEvidence {
  /** UTC time when all values below were measured. */
  readonly observedAt: string;
  /** Searchable freshness p95 for the current measurement window. */
  readonly freshnessP95Ms: number;
  /** Whether the current fixed query SLO window passed. */
  readonly querySloGreen: boolean;
  /** Queue drops observed during the same measurement window. */
  readonly queueDropCount: number;
}

export interface ClickHouseSignalBackfillGuardOptions {
  /** Reader identity with catalog and disk probe access. */
  readonly reader?: ClickHouseClient;
  /** A current operational measurement is required on every guard check. */
  readonly evidence: () => Promise<unknown>;
  readonly schemaCheck?: () => Promise<boolean>;
  readonly diskUsagePercent?: () => Promise<number>;
  readonly maxEvidenceAgeMs?: number;
  readonly now?: () => Date;
}

function assertPositiveInteger(
  value: number,
  name: string,
  max?: number,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (max !== undefined && value > max)
  ) {
    throw new Error(`${name} must be a positive bounded integer`);
  }
}

function record(value: unknown, name: string): SignalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as SignalRecord;
}

function text(row: SignalRecord, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} must be a nonempty string`);
  }
  return value;
}

function nullableText(row: SignalRecord, name: string): string | null {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string or null`);
  }
  return value;
}

function textOrDefault(
  row: SignalRecord,
  name: string,
  fallback: string,
): string {
  const value = row[name];
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string or null`);
  }
  return value;
}

function numberValue(
  row: SignalRecord,
  name: string,
  options: { integer?: boolean; minimum?: number; maximum?: number } = {},
): number {
  const raw = row[name];
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isSafeInteger(value)) ||
    (options.minimum !== undefined && value < options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    throw new Error(`${name} is not a supported number`);
  }
  return value;
}

function numericArray(row: SignalRecord, name: string): number[] {
  const value = row[name];
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            throw new Error(`${name} is not valid JSON`);
          }
        })()
      : value;
  if (!Array.isArray(parsed)) throw new Error(`${name} must be an array`);
  return parsed.map((item, index) => {
    const numeric =
      typeof item === 'number'
        ? item
        : typeof item === 'string' && item.trim() !== ''
          ? Number(item)
          : Number.NaN;
    if (!Number.isFinite(numeric)) {
      throw new Error(`${name}[${index}] is not finite`);
    }
    return numeric;
  });
}

function jsonValue(row: SignalRecord, name: string): unknown {
  const value = row[name];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

function jsonObject(row: SignalRecord, name: string): Record<string, unknown> {
  const value = jsonValue(row, name);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function primitiveJsonObject(
  row: SignalRecord,
  name: string,
): Record<string, string | number | boolean> {
  const value = jsonObject(row, name);
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    ) {
      throw new Error(`${name}.${key} must be a JSON primitive`);
    }
  }
  return value as Record<string, string | number | boolean>;
}

function stringJsonObject(
  row: SignalRecord,
  name: string,
): Record<string, string> {
  const value = jsonObject(row, name);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`${name}.${key} must be a string`);
    }
  }
  return value as Record<string, string>;
}

function timestampValue(row: SignalRecord, name: string): string {
  const value = row[name];
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${name} is invalid`);
    return value.toISOString();
  }
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} must be a timestamp string`);
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    value,
  )
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} is invalid`);
  return date.toISOString();
}

function requiredUuid(row: SignalRecord, name: string): string {
  const value = text(row, name);
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function nullableUuid(row: SignalRecord, name: string): string | null {
  const value = nullableText(row, name);
  if (value === null) return null;
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function requiredHex(row: SignalRecord, name: string, pattern: RegExp): string {
  const value = text(row, name).toLowerCase();
  if (!pattern.test(value)) throw new Error(`${name} has an invalid hex shape`);
  return value;
}

function nullableHex(
  row: SignalRecord,
  name: string,
  pattern: RegExp,
): string | null {
  const value = nullableText(row, name);
  if (value === null) return null;
  const normalized = value.toLowerCase();
  if (!pattern.test(normalized)) {
    throw new Error(`${name} has an invalid hex shape`);
  }
  return normalized;
}

function sourceEventTime(signal: ObservabilitySignal): string {
  switch (signal.kind) {
    case 'span':
      return signal.startedAt;
    case 'metric_bucket':
      return signal.bucketStart;
    case 'application_log':
      return signal.occurredAt;
    case 'access_log':
      return signal.accessedAt;
  }
}

function cursorIdentity(signal: ObservabilitySignal): Record<string, string> {
  switch (signal.kind) {
    case 'span':
      return { traceId: signal.traceId, spanId: signal.spanId };
    case 'metric_bucket':
      return { seriesFingerprint: signal.seriesFingerprint };
    case 'application_log':
    case 'access_log':
      return { id: signal.id };
  }
}

function cursorFingerprint(range: SignalBackfillRange): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        protocol: 'observability-postgres-backfill-v1',
        kind: range.kind,
        schemaVersion: range.schemaVersion,
        sourceFrom: range.sourceFrom,
        sourceTo: range.sourceTo,
        order: CURSOR_ORDER,
      }),
      'utf8',
    )
    .digest('hex');
}

function cursorFor(
  signal: ObservabilitySignal,
  range: SignalBackfillRange,
): SignalBackfillCursor {
  return Object.freeze({
    version: CURSOR_VERSION,
    order: CURSOR_ORDER,
    fingerprint: cursorFingerprint(range),
    eventTime: sourceEventTime(signal),
    identity: cursorIdentity(signal),
  });
}

function cursorForRequest(
  value: SignalBackfillCursor | null,
  range: SignalBackfillRange,
): BackfillCursor | null {
  if (value === null) return null;
  const parsed = record(value, 'source cursor');
  const version = numberValue(parsed, 'version', { integer: true, minimum: 1 });
  const order = text(parsed, 'order');
  const fingerprint = text(parsed, 'fingerprint');
  const eventTime = timestampValue(parsed, 'eventTime');
  const identity = record(parsed.identity, 'source cursor identity');
  if (
    version !== CURSOR_VERSION ||
    order !== CURSOR_ORDER ||
    fingerprint !== cursorFingerprint(range)
  ) {
    throw new Error('source cursor does not match this immutable range');
  }
  const expectedKeys =
    range.kind === 'span'
      ? ['traceId', 'spanId']
      : range.kind === 'metric_bucket'
        ? ['seriesFingerprint']
        : ['id'];
  const normalizedIdentity: Record<string, string> = {};
  for (const key of expectedKeys) {
    const candidate = identity[key];
    if (typeof candidate !== 'string' || candidate === '') {
      throw new Error('source cursor identity is invalid');
    }
    normalizedIdentity[key] = candidate;
  }
  return {
    version,
    order,
    fingerprint,
    eventTime,
    identity: normalizedIdentity,
  };
}

function signalFromRow(
  kind: SignalKind,
  value: unknown,
  schemaVersion: number,
): ObservabilitySignal {
  const row = record(value, `${kind} row`);
  switch (kind) {
    case 'span': {
      const status = text(row, 'status');
      if (status !== 'ok' && status !== 'error' && status !== 'unset') {
        throw new Error('span status is invalid');
      }
      return {
        kind,
        traceId: requiredHex(row, 'trace_id', TRACE_ID_PATTERN),
        spanId: requiredHex(row, 'span_id', SPAN_ID_PATTERN),
        parentSpanId: nullableHex(row, 'parent_span_id', SPAN_ID_PATTERN),
        correlationId: nullableText(row, 'correlation_id'),
        requestId: nullableText(row, 'request_id'),
        runId: nullableUuid(row, 'run_id'),
        serviceName: text(row, 'service_name'),
        serviceInstanceId: text(row, 'service_instance_id'),
        resourceKind: text(row, 'resource_kind'),
        resourceName: text(row, 'resource_name'),
        operation: text(row, 'operation'),
        status,
        samplingReason: text(row, 'sampling_reason'),
        attributes: primitiveJsonObject(row, 'attributes'),
        errorType: nullableText(row, 'error_type'),
        startedAt: timestampValue(row, 'started_at'),
        finishedAt: timestampValue(row, 'finished_at'),
        durationNs: numberValue(row, 'duration_ns', {
          integer: true,
          minimum: 0,
        }),
        schemaVersion,
      } satisfies SpanSignal;
    }
    case 'metric_bucket': {
      const metricKind = text(row, 'metric_kind');
      if (
        metricKind !== 'counter' &&
        metricKind !== 'histogram' &&
        metricKind !== 'gauge'
      ) {
        throw new Error('metric bucket kind is invalid');
      }
      const seriesFingerprint = text(row, 'series_fingerprint').toLowerCase();
      if (!FINGERPRINT_PATTERN.test(seriesFingerprint)) {
        throw new Error('series_fingerprint has an invalid hex shape');
      }
      const histogramBoundaries = numericArray(row, 'histogram_boundaries');
      const histogramCounts = numericArray(row, 'histogram_counts').map(
        (count, index) => {
          if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error(`histogram_counts[${index}] is invalid`);
          }
          return count;
        },
      );
      if (histogramCounts.length !== histogramBoundaries.length + 1) {
        throw new Error('metric bucket histogram shape is invalid');
      }
      return {
        kind,
        bucketStart: timestampValue(row, 'bucket_start'),
        bucketWidthSeconds: numberValue(row, 'bucket_width_seconds', {
          integer: true,
          minimum: 1,
        }),
        seriesFingerprint,
        flushSequence: numberValue(row, 'flush_sequence', {
          integer: true,
          minimum: 0,
        }),
        serviceName: text(row, 'service_name'),
        serviceInstanceId: text(row, 'service_instance_id'),
        resourceKind: text(row, 'resource_kind'),
        resourceName: text(row, 'resource_name'),
        metricName: text(row, 'metric_name'),
        metricKind,
        unit: text(row, 'unit'),
        count: numberValue(row, 'count', { integer: true, minimum: 0 }),
        sum: numberValue(row, 'sum'),
        min: numberValue(row, 'min'),
        max: numberValue(row, 'max'),
        histogramBoundaries,
        histogramCounts,
        labels: stringJsonObject(row, 'labels'),
        schemaVersion,
      } satisfies MetricBucketSignal;
    }
    case 'application_log':
      return {
        kind,
        id: requiredUuid(row, 'id'),
        level: text(row, 'level'),
        channel: textOrDefault(row, 'channel', 'application'),
        category: textOrDefault(row, 'category', 'application'),
        event: nullableText(row, 'event'),
        module: nullableText(row, 'module'),
        message: text(row, 'message'),
        context: jsonValue(row, 'context'),
        exceptionClass: nullableText(row, 'exception_class'),
        exceptionMessage: nullableText(row, 'exception_message'),
        stackTrace: nullableText(row, 'stack_trace'),
        actorUserId: nullableUuid(row, 'actor_user_id'),
        actorName: nullableText(row, 'actor_name'),
        actorEmail: nullableText(row, 'actor_email'),
        entityType: nullableText(row, 'entity_type'),
        entityId: nullableText(row, 'entity_id'),
        referenceNo: nullableText(row, 'reference_no'),
        branchCode: nullableText(row, 'branch_code'),
        requestId: nullableText(row, 'request_id'),
        traceId: nullableText(row, 'trace_id'),
        runtimeTraceId: nullableHex(row, 'runtime_trace_id', TRACE_ID_PATTERN),
        runtimeSpanId: nullableHex(row, 'runtime_span_id', SPAN_ID_PATTERN),
        sessionId: nullableText(row, 'session_id'),
        ipAddress: nullableText(row, 'ip_address'),
        userAgent: nullableText(row, 'user_agent'),
        occurredAt: timestampValue(row, 'occurred_at'),
        createdAt: timestampValue(row, 'created_at'),
        schemaVersion,
      } satisfies ApplicationLogSignal;
    case 'access_log':
      return {
        kind,
        id: requiredUuid(row, 'id'),
        event: text(row, 'event'),
        outcome: text(row, 'outcome'),
        authenticationMethod: nullableText(row, 'authentication_method'),
        accessChannel: textOrDefault(row, 'access_channel', 'web'),
        guard: nullableText(row, 'guard'),
        actorUserId: nullableUuid(row, 'actor_user_id'),
        actorName: nullableText(row, 'actor_name'),
        actorEmail: nullableText(row, 'actor_email'),
        branchCode: nullableText(row, 'branch_code'),
        ipAddress: nullableText(row, 'ip_address'),
        forwardedIp: nullableText(row, 'forwarded_ip'),
        userAgent: nullableText(row, 'user_agent'),
        deviceName: nullableText(row, 'device_name'),
        platform: nullableText(row, 'platform'),
        browser: nullableText(row, 'browser'),
        sessionId: nullableText(row, 'session_id'),
        requestId: nullableText(row, 'request_id'),
        traceId: nullableText(row, 'trace_id'),
        runtimeTraceId: nullableHex(row, 'runtime_trace_id', TRACE_ID_PATTERN),
        runtimeSpanId: nullableHex(row, 'runtime_span_id', SPAN_ID_PATTERN),
        routeName: nullableText(row, 'route_name'),
        path: nullableText(row, 'path'),
        method: nullableText(row, 'method'),
        httpStatus:
          row.http_status === null || row.http_status === undefined
            ? null
            : numberValue(row, 'http_status', {
                integer: true,
                minimum: 0,
                maximum: 65_535,
              }),
        failureReason: nullableText(row, 'failure_reason'),
        metadata: jsonValue(row, 'metadata'),
        accessedAt: timestampValue(row, 'accessed_at'),
        createdAt: timestampValue(row, 'created_at'),
        schemaVersion,
      } satisfies AccessLogSignal;
  }
}

function signalsFromRows(
  kind: SignalKind,
  rows: unknown,
  schemaVersion: number,
): ObservabilitySignal[] {
  if (!Array.isArray(rows)) throw new Error('backfill query result is invalid');
  return rows.map((row) => signalFromRow(kind, row, schemaVersion));
}

function postgresPageQuery(
  input: SignalBackfillPageRequest,
  cursor: BackfillCursor | null,
): { sql: string; params: unknown[] } {
  const before = [input.sourceFrom, input.sourceTo];
  const limit = input.limit;
  switch (input.kind) {
    case 'span': {
      const after = cursor
        ? ` AND (started_at > ($3::timestamptz AT TIME ZONE 'UTC') OR (started_at = ($3::timestamptz AT TIME ZONE 'UTC') AND (trace_id > $4::char(32) OR (trace_id = $4::char(32) AND span_id > $5::char(16)))))`
        : '';
      return {
        sql:
          'SELECT trace_id, span_id, parent_span_id, correlation_id, request_id, run_id::text AS run_id, ' +
          'service_name, service_instance_id, resource_kind, resource_name, operation, status, sampling_reason, ' +
          'attributes::text AS attributes, error_type, started_at::text AS started_at, finished_at::text AS finished_at, duration_ns ' +
          'FROM "telemetry"."spans" ' +
          "WHERE started_at >= ($1::timestamptz AT TIME ZONE 'UTC') AND started_at < ($2::timestamptz AT TIME ZONE 'UTC')" +
          after +
          ' ORDER BY started_at ASC, trace_id ASC, span_id ASC LIMIT $' +
          (cursor ? '6' : '3'),
        params: cursor
          ? [
              ...before,
              cursor.eventTime,
              cursor.identity.traceId,
              cursor.identity.spanId,
              limit,
            ]
          : [...before, limit],
      };
    }
    case 'metric_bucket': {
      const after = cursor
        ? ` AND (bucket_start > ($3::timestamptz AT TIME ZONE 'UTC') OR (bucket_start = ($3::timestamptz AT TIME ZONE 'UTC') AND series_fingerprint > $4::char(64)))`
        : '';
      return {
        sql:
          'SELECT bucket_start::text AS bucket_start, bucket_width_seconds, series_fingerprint, flush_sequence, ' +
          'service_name, service_instance_id, resource_kind, resource_name, metric_name, metric_kind, unit, count, sum, min, max, ' +
          'histogram_boundaries, histogram_counts, labels::text AS labels ' +
          'FROM "telemetry"."metric_buckets" ' +
          "WHERE bucket_start >= ($1::timestamptz AT TIME ZONE 'UTC') AND bucket_start < ($2::timestamptz AT TIME ZONE 'UTC')" +
          after +
          ' ORDER BY bucket_start ASC, series_fingerprint ASC LIMIT $' +
          (cursor ? '5' : '3'),
        params: cursor
          ? [
              ...before,
              cursor.eventTime,
              cursor.identity.seriesFingerprint,
              limit,
            ]
          : [...before, limit],
      };
    }
    case 'application_log': {
      const after = cursor
        ? ` AND (occurred_at > ($3::timestamptz AT TIME ZONE 'UTC') OR (occurred_at = ($3::timestamptz AT TIME ZONE 'UTC') AND id > $4::uuid))`
        : '';
      return {
        sql:
          'SELECT id::text AS id, level, channel, category, event, module, message, context::text AS context, ' +
          'exception_class, exception_message, stack_trace, actor_user_id::text AS actor_user_id, actor_name, actor_email, ' +
          'entity_type, entity_id, reference_no, branch_code, request_id, trace_id, runtime_trace_id, runtime_span_id, ' +
          'session_id, ip_address, user_agent, occurred_at::text AS occurred_at, created_at::text AS created_at ' +
          'FROM "logs"."logging" ' +
          "WHERE occurred_at >= ($1::timestamptz AT TIME ZONE 'UTC') AND occurred_at < ($2::timestamptz AT TIME ZONE 'UTC')" +
          after +
          ' ORDER BY occurred_at ASC, id ASC LIMIT $' +
          (cursor ? '5' : '3'),
        params: cursor
          ? [...before, cursor.eventTime, cursor.identity.id, limit]
          : [...before, limit],
      };
    }
    case 'access_log': {
      const after = cursor
        ? ` AND (accessed_at > ($3::timestamptz AT TIME ZONE 'UTC') OR (accessed_at = ($3::timestamptz AT TIME ZONE 'UTC') AND id > $4::uuid))`
        : '';
      return {
        sql:
          'SELECT id::text AS id, event, outcome, authentication_method, access_channel, guard, actor_user_id::text AS actor_user_id, ' +
          'actor_name, actor_email, branch_code, ip_address, forwarded_ip, user_agent, device_name, platform, browser, ' +
          'session_id, request_id, trace_id, runtime_trace_id, runtime_span_id, route_name, path, method, http_status, ' +
          'failure_reason, metadata::text AS metadata, accessed_at::text AS accessed_at, created_at::text AS created_at ' +
          'FROM "logs"."access_logs" ' +
          "WHERE accessed_at >= ($1::timestamptz AT TIME ZONE 'UTC') AND accessed_at < ($2::timestamptz AT TIME ZONE 'UTC')" +
          after +
          ' ORDER BY accessed_at ASC, id ASC LIMIT $' +
          (cursor ? '5' : '3'),
        params: cursor
          ? [...before, cursor.eventTime, cursor.identity.id, limit]
          : [...before, limit],
      };
    }
  }
}

function postgresCountQuery(range: SignalBackfillRange): {
  sql: string;
  params: unknown[];
} {
  const table =
    range.kind === 'span'
      ? '"telemetry"."spans"'
      : range.kind === 'metric_bucket'
        ? '"telemetry"."metric_buckets"'
        : range.kind === 'application_log'
          ? '"logs"."logging"'
          : '"logs"."access_logs"';
  const column =
    range.kind === 'span'
      ? 'started_at'
      : range.kind === 'metric_bucket'
        ? 'bucket_start'
        : range.kind === 'application_log'
          ? 'occurred_at'
          : 'accessed_at';
  return {
    sql:
      `SELECT count(*)::text AS count FROM ${table} ` +
      `WHERE ${column} >= ($1::timestamptz AT TIME ZONE 'UTC') ` +
      `AND ${column} < ($2::timestamptz AT TIME ZONE 'UTC')`,
    params: [range.sourceFrom, range.sourceTo],
  };
}

function postgresDatabaseFor(
  options: PostgresSignalBackfillSourceOptions,
  kind: SignalKind,
): DatabaseClient {
  return kind === 'span' || kind === 'metric_bucket'
    ? options.telemetryDatabase
    : options.logsDatabase;
}

function countFromRows(value: unknown): number {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('backfill count query returned an invalid result');
  }
  return numberValue(record(value[0], 'backfill count row'), 'count', {
    integer: true,
    minimum: 0,
  });
}

function nextCursorForPage(
  signals: readonly ObservabilitySignal[],
  range: SignalBackfillRange,
  limit: number,
): SignalBackfillCursor | null {
  const last = signals.at(-1);
  return signals.length === limit && last ? cursorFor(last, range) : null;
}

async function orderedParity(
  count: number,
  sampleModulus: number,
  pages: () => AsyncGenerator<readonly ObservabilitySignal[]>,
  maxSampleBytes: number,
): Promise<SignalBackfillParity> {
  assertPositiveInteger(maxSampleBytes, 'backfill parity memory bytes');
  const sampleEveryRow = count < sampleModulus;
  const sampledRecords: string[] = [];
  const encoder = new TextEncoder();
  let sampleCount = 0;
  let sampleBytes = 0;
  for await (const page of pages()) {
    for (const signal of page) {
      if (
        !sampleEveryRow &&
        stableSampleModulo(stableSignalIdentity(signal), sampleModulus) !== 0
      ) {
        continue;
      }
      const canonical = canonicalBackfillRecord(signal);
      const recordBytes = encoder.encode(canonical).byteLength + 1;
      if (sampleBytes + recordBytes > maxSampleBytes) {
        throw new Error('backfill parity sample exceeded its memory budget');
      }
      sampledRecords.push(canonical);
      sampleBytes += recordBytes;
      sampleCount += 1;
    }
  }
  const hash = createHash('sha256');
  for (const [index, canonical] of sampledRecords.sort().entries()) {
    if (index > 0) hash.update('\n', 'utf8');
    hash.update(canonical, 'utf8');
  }
  return { count, sampleCount, checksum: hash.digest('hex') };
}

export class PostgresSignalBackfillSource implements SignalBackfillSource {
  private readonly options: PostgresSignalBackfillSourceOptions;
  private readonly maxParityMemoryBytes: number;

  constructor(options: PostgresSignalBackfillSourceOptions) {
    assertPositiveInteger(
      options.maxParityMemoryBytes ?? DEFAULT_PARITY_MEMORY_BYTES,
      'backfill maxParityMemoryBytes',
    );
    this.options = options;
    this.maxParityMemoryBytes =
      options.maxParityMemoryBytes ?? DEFAULT_PARITY_MEMORY_BYTES;
  }

  async readPage(
    input: SignalBackfillPageRequest,
  ): Promise<SignalBackfillPage> {
    assertPositiveInteger(input.limit, 'backfill page size', MAX_PAGE_SIZE);
    const cursor = cursorForRequest(input.cursor, input);
    const query = postgresPageQuery(input, cursor);
    const database = postgresDatabaseFor(this.options, input.kind);
    const rows = await database.unsafe(query.sql, query.params as never[]);
    const signals = signalsFromRows(input.kind, rows, input.schemaVersion);
    return {
      signals,
      nextCursor: nextCursorForPage(signals, input, input.limit),
    };
  }

  async canonicalParity(
    input: SignalBackfillParityRequest,
  ): Promise<SignalBackfillParity> {
    const database = postgresDatabaseFor(this.options, input.kind);
    const countQuery = postgresCountQuery(input);
    const count = countFromRows(
      await database.unsafe(countQuery.sql, countQuery.params as never[]),
    );
    const source = this;
    return await orderedParity(
      count,
      input.sampleModulus,
      async function* () {
        let cursor: SignalBackfillCursor | null = null;
        while (true) {
          const page = await source.readPage({
            ...input,
            cursor,
            limit: DEFAULT_PARITY_PAGE_SIZE,
          });
          if (page.signals.length === 0) return;
          yield page.signals;
          if (page.nextCursor === null) return;
          cursor = page.nextCursor;
        }
      },
      this.maxParityMemoryBytes,
    );
  }
}

export function createPostgresSignalBackfillSource(
  options: PostgresSignalBackfillSourceOptions,
): SignalBackfillSource {
  return new PostgresSignalBackfillSource(options);
}

function clickHouseTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('backfill timestamp is invalid');
  }
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function clickHouseTable(kind: SignalKind): string {
  switch (kind) {
    case 'span':
      return 'spans';
    case 'metric_bucket':
      return 'metric_buckets';
    case 'application_log':
      return 'application_logs';
    case 'access_log':
      return 'access_logs';
  }
}

function clickHouseRow(
  signal: StoredObservabilitySignal,
): Record<string, unknown> {
  switch (signal.kind) {
    case 'span':
      return {
        trace_id: signal.traceId,
        span_id: signal.spanId,
        parent_span_id: signal.parentSpanId,
        correlation_id: signal.correlationId,
        request_id: signal.requestId,
        run_id: signal.runId,
        service_name: signal.serviceName,
        service_instance_id: signal.serviceInstanceId,
        resource_kind: signal.resourceKind,
        resource_name: signal.resourceName,
        operation: signal.operation,
        status: signal.status,
        sampling_reason: signal.samplingReason,
        attributes: canonicalJson(signal.attributes),
        error_type: signal.errorType,
        started_at: clickHouseTimestamp(signal.startedAt),
        finished_at: clickHouseTimestamp(signal.finishedAt),
        duration_ns: signal.durationNs,
        schema_version: signal.schemaVersion,
        ingested_at: clickHouseTimestamp(signal.ingestedAt),
        write_version: signal.writeVersion,
      };
    case 'metric_bucket':
      return {
        bucket_start: clickHouseTimestamp(signal.bucketStart),
        bucket_width_seconds: signal.bucketWidthSeconds,
        series_fingerprint: signal.seriesFingerprint,
        flush_sequence: signal.flushSequence,
        service_name: signal.serviceName,
        service_instance_id: signal.serviceInstanceId,
        resource_kind: signal.resourceKind,
        resource_name: signal.resourceName,
        metric_name: signal.metricName,
        metric_kind: signal.metricKind,
        unit: signal.unit,
        count: signal.count,
        sum: signal.sum,
        min: signal.min,
        max: signal.max,
        histogram_boundaries: signal.histogramBoundaries,
        histogram_counts: signal.histogramCounts,
        labels: canonicalJson(signal.labels),
        schema_version: signal.schemaVersion,
        ingested_at: clickHouseTimestamp(signal.ingestedAt),
      };
    case 'application_log':
      return {
        id: signal.id,
        level: signal.level,
        channel: signal.channel,
        category: signal.category,
        event: signal.event,
        module: signal.module,
        message: signal.message,
        context: signal.context === null ? null : canonicalJson(signal.context),
        exception_class: signal.exceptionClass,
        exception_message: signal.exceptionMessage,
        stack_trace: signal.stackTrace,
        actor_user_id: signal.actorUserId,
        actor_name: signal.actorName,
        actor_email: signal.actorEmail,
        entity_type: signal.entityType,
        entity_id: signal.entityId,
        reference_no: signal.referenceNo,
        branch_code: signal.branchCode,
        request_id: signal.requestId,
        trace_id: signal.traceId,
        runtime_trace_id: signal.runtimeTraceId,
        runtime_span_id: signal.runtimeSpanId,
        session_id: signal.sessionId,
        ip_address: signal.ipAddress,
        user_agent: signal.userAgent,
        occurred_at: clickHouseTimestamp(signal.occurredAt),
        created_at: clickHouseTimestamp(signal.createdAt),
        schema_version: signal.schemaVersion,
        ingested_at: clickHouseTimestamp(signal.ingestedAt),
        write_version: signal.writeVersion,
      };
    case 'access_log':
      return {
        id: signal.id,
        event: signal.event,
        outcome: signal.outcome,
        authentication_method: signal.authenticationMethod,
        access_channel: signal.accessChannel,
        guard: signal.guard,
        actor_user_id: signal.actorUserId,
        actor_name: signal.actorName,
        actor_email: signal.actorEmail,
        branch_code: signal.branchCode,
        ip_address: signal.ipAddress,
        forwarded_ip: signal.forwardedIp,
        user_agent: signal.userAgent,
        device_name: signal.deviceName,
        platform: signal.platform,
        browser: signal.browser,
        session_id: signal.sessionId,
        request_id: signal.requestId,
        trace_id: signal.traceId,
        runtime_trace_id: signal.runtimeTraceId,
        runtime_span_id: signal.runtimeSpanId,
        route_name: signal.routeName,
        path: signal.path,
        method: signal.method,
        http_status: signal.httpStatus,
        failure_reason: signal.failureReason,
        metadata:
          signal.metadata === null ? null : canonicalJson(signal.metadata),
        accessed_at: clickHouseTimestamp(signal.accessedAt),
        created_at: clickHouseTimestamp(signal.createdAt),
        schema_version: signal.schemaVersion,
        ingested_at: clickHouseTimestamp(signal.ingestedAt),
        write_version: signal.writeVersion,
      };
  }
}

function clickHousePageQuery(
  input: SignalBackfillPageRequest,
  cursor: BackfillCursor | null,
): {
  query: string;
  params: Record<string, string | number>;
} {
  const params: Record<string, string | number> = {
    source_from: clickHouseTimestamp(input.sourceFrom),
    source_to: clickHouseTimestamp(input.sourceTo),
    limit: input.limit,
  };
  switch (input.kind) {
    case 'span': {
      if (cursor) {
        params.cursor_event_time = clickHouseTimestamp(cursor.eventTime);
        params.cursor_trace_id = cursor.identity.traceId ?? '';
        params.cursor_span_id = cursor.identity.spanId ?? '';
      }
      const after = cursor
        ? " AND (started_at > {cursor_event_time:DateTime64(6, 'UTC')} OR (started_at = {cursor_event_time:DateTime64(6, 'UTC')} AND (toString(trace_id) > {cursor_trace_id:String} OR (toString(trace_id) = {cursor_trace_id:String} AND toString(span_id) > {cursor_span_id:String}))))"
        : '';
      return {
        query:
          'SELECT trace_id, span_id, parent_span_id, correlation_id, request_id, run_id, service_name, service_instance_id, ' +
          'resource_kind, resource_name, operation, status, sampling_reason, attributes, error_type, ' +
          'toString(started_at) AS started_at, toString(finished_at) AS finished_at, duration_ns, schema_version ' +
          'FROM observability.spans FINAL ' +
          "WHERE started_at >= {source_from:DateTime64(6, 'UTC')} AND started_at < {source_to:DateTime64(6, 'UTC')}" +
          after +
          ' ORDER BY started_at ASC, trace_id ASC, span_id ASC LIMIT {limit:UInt64}',
        params,
      };
    }
    case 'metric_bucket': {
      if (cursor) {
        params.cursor_event_time = clickHouseTimestamp(cursor.eventTime);
        params.cursor_series_fingerprint =
          cursor.identity.seriesFingerprint ?? '';
      }
      const after = cursor
        ? " AND (bucket_start > {cursor_event_time:DateTime64(6, 'UTC')} OR (bucket_start = {cursor_event_time:DateTime64(6, 'UTC')} AND toString(series_fingerprint) > {cursor_series_fingerprint:String}))"
        : '';
      return {
        query:
          'SELECT toString(bucket_start) AS bucket_start, bucket_width_seconds, series_fingerprint, flush_sequence, ' +
          'service_name, service_instance_id, resource_kind, resource_name, metric_name, metric_kind, unit, count, sum, min, max, ' +
          'histogram_boundaries, histogram_counts, labels, schema_version ' +
          'FROM observability.metric_buckets FINAL ' +
          "WHERE bucket_start >= {source_from:DateTime64(6, 'UTC')} AND bucket_start < {source_to:DateTime64(6, 'UTC')}" +
          after +
          ' ORDER BY bucket_start ASC, series_fingerprint ASC LIMIT {limit:UInt64}',
        params,
      };
    }
    case 'application_log': {
      if (cursor) {
        params.cursor_event_time = clickHouseTimestamp(cursor.eventTime);
        params.cursor_id = cursor.identity.id ?? '';
      }
      const after = cursor
        ? " AND (occurred_at > {cursor_event_time:DateTime64(6, 'UTC')} OR (occurred_at = {cursor_event_time:DateTime64(6, 'UTC')} AND toString(id) > {cursor_id:String}))"
        : '';
      return {
        query:
          'SELECT id, level, channel, category, event, module, message, context, exception_class, exception_message, stack_trace, ' +
          'actor_user_id, actor_name, actor_email, entity_type, entity_id, reference_no, branch_code, request_id, trace_id, ' +
          'runtime_trace_id, runtime_span_id, session_id, ip_address, user_agent, toString(occurred_at) AS occurred_at, ' +
          'toString(created_at) AS created_at, schema_version ' +
          'FROM observability.application_logs FINAL ' +
          "WHERE occurred_at >= {source_from:DateTime64(6, 'UTC')} AND occurred_at < {source_to:DateTime64(6, 'UTC')}" +
          after +
          ' ORDER BY occurred_at ASC, id ASC LIMIT {limit:UInt64}',
        params,
      };
    }
    case 'access_log': {
      if (cursor) {
        params.cursor_event_time = clickHouseTimestamp(cursor.eventTime);
        params.cursor_id = cursor.identity.id ?? '';
      }
      const after = cursor
        ? " AND (accessed_at > {cursor_event_time:DateTime64(6, 'UTC')} OR (accessed_at = {cursor_event_time:DateTime64(6, 'UTC')} AND toString(id) > {cursor_id:String}))"
        : '';
      return {
        query:
          'SELECT id, event, outcome, authentication_method, access_channel, guard, actor_user_id, actor_name, actor_email, ' +
          'branch_code, ip_address, forwarded_ip, user_agent, device_name, platform, browser, session_id, request_id, trace_id, ' +
          'runtime_trace_id, runtime_span_id, route_name, path, method, http_status, failure_reason, metadata, ' +
          'toString(accessed_at) AS accessed_at, toString(created_at) AS created_at, schema_version ' +
          'FROM observability.access_logs FINAL ' +
          "WHERE accessed_at >= {source_from:DateTime64(6, 'UTC')} AND accessed_at < {source_to:DateTime64(6, 'UTC')}" +
          after +
          ' ORDER BY accessed_at ASC, id ASC LIMIT {limit:UInt64}',
        params,
      };
    }
  }
}

function clickHouseCountQuery(range: SignalBackfillRange): {
  query: string;
  params: Record<string, string>;
} {
  const table = clickHouseTable(range.kind);
  const column =
    range.kind === 'span'
      ? 'started_at'
      : range.kind === 'metric_bucket'
        ? 'bucket_start'
        : range.kind === 'application_log'
          ? 'occurred_at'
          : 'accessed_at';
  return {
    query:
      `SELECT count() AS count FROM observability.${table} FINAL ` +
      `WHERE ${column} >= {source_from:DateTime64(6, 'UTC')} ` +
      `AND ${column} < {source_to:DateTime64(6, 'UTC')}`,
    params: {
      source_from: clickHouseTimestamp(range.sourceFrom),
      source_to: clickHouseTimestamp(range.sourceTo),
    },
  };
}

function targetSignalsFromRows(
  kind: SignalKind,
  rows: unknown,
): ObservabilitySignal[] {
  if (!Array.isArray(rows))
    throw new Error('ClickHouse parity result is invalid');
  return rows.map((value) => {
    const row = record(value, `${kind} target row`);
    const schemaVersion = numberValue(row, 'schema_version', {
      integer: true,
      minimum: 1,
    });
    return signalFromRow(kind, row, schemaVersion);
  });
}

export class ClickHouseSignalBackfillTarget implements SignalBackfillTarget {
  private readonly writer: ClickHouseClient;
  private readonly reader: ClickHouseClient;
  private readonly maxThreads: number;
  private readonly maxMemoryBytes: number;
  private readonly maxWriteBytesPerSecond: number;
  private readonly parityPageSize: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private nextWriteAt = 0;

  constructor(options: ClickHouseSignalBackfillTargetOptions) {
    assertPositiveInteger(options.maxThreads, 'backfill maxThreads');
    assertPositiveInteger(options.maxMemoryBytes, 'backfill maxMemoryBytes');
    assertPositiveInteger(
      options.maxWriteBytesPerSecond,
      'backfill maxWriteBytesPerSecond',
    );
    assertPositiveInteger(
      options.parityPageSize ?? DEFAULT_PARITY_PAGE_SIZE,
      'backfill parityPageSize',
      MAX_PAGE_SIZE,
    );
    this.writer = options.writer;
    this.reader = options.reader;
    this.maxThreads = options.maxThreads;
    this.maxMemoryBytes = options.maxMemoryBytes;
    this.maxWriteBytesPerSecond = options.maxWriteBytesPerSecond;
    this.parityPageSize = options.parityPageSize ?? DEFAULT_PARITY_PAGE_SIZE;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  }

  async write(batch: SignalBackfillBatch): Promise<void> {
    if (batch.signals.length === 0) {
      throw new Error('backfill batch must not be empty');
    }
    for (const signal of batch.signals) {
      if (signal.kind !== batch.kind) {
        throw new Error('backfill batch cannot mix signal kinds');
      }
    }
    const body = `${batch.signals
      .map((signal) => JSON.stringify(clickHouseRow(signal)))
      .join('\n')}\n`;
    await this.limitWriteRate(new TextEncoder().encode(body).byteLength);
    await this.writer.execute({
      query: `INSERT INTO observability.${clickHouseTable(batch.kind)} FORMAT JSONEachRow`,
      settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_deduplicate: 1,
        insert_deduplicate: 1,
        insert_deduplication_token: batch.token,
        max_threads: this.maxThreads,
        max_memory_usage: this.maxMemoryBytes,
      },
      body,
    });
  }

  async canonicalParity(
    input: SignalBackfillParityRequest,
  ): Promise<SignalBackfillParity> {
    const countQuery = clickHouseCountQuery(input);
    const countRows = await this.reader.queryRows<Record<string, unknown>>(
      countQuery.query,
      {
        params: countQuery.params,
        settings: this.readSettings(),
        timeoutMs: 10_000,
      },
    );
    const count = countFromRows(countRows);
    const target = this;
    return await orderedParity(
      count,
      input.sampleModulus,
      async function* () {
        let cursor: SignalBackfillCursor | null = null;
        while (true) {
          const page = await target.readPage({
            ...input,
            cursor,
            limit: target.parityPageSize,
          });
          if (page.signals.length === 0) return;
          yield page.signals;
          if (page.nextCursor === null) return;
          cursor = page.nextCursor;
        }
      },
      this.maxMemoryBytes,
    );
  }

  private async readPage(
    input: SignalBackfillPageRequest,
  ): Promise<SignalBackfillPage> {
    assertPositiveInteger(input.limit, 'backfill page size', MAX_PAGE_SIZE);
    const cursor = cursorForRequest(input.cursor, input);
    const query = clickHousePageQuery(input, cursor);
    const rows = await this.reader.queryRows<Record<string, unknown>>(
      query.query,
      {
        params: query.params,
        settings: this.readSettings(),
        timeoutMs: 10_000,
      },
    );
    const signals = targetSignalsFromRows(input.kind, rows);
    return {
      signals,
      nextCursor: nextCursorForPage(signals, input, input.limit),
    };
  }

  private readSettings(): Record<string, number | string> {
    return {
      readonly: 1,
      max_threads: this.maxThreads,
      max_memory_usage: this.maxMemoryBytes,
      max_result_rows: this.parityPageSize,
      max_result_bytes: 16_777_216,
      max_execution_time: 10,
      result_overflow_mode: 'throw',
    };
  }

  private async limitWriteRate(bodyBytes: number): Promise<void> {
    const current = this.now();
    const waitMilliseconds = Math.max(0, this.nextWriteAt - current);
    if (waitMilliseconds > 0) await this.sleep(waitMilliseconds);
    const startedAt = this.now();
    const durationMilliseconds = Math.ceil(
      (bodyBytes / this.maxWriteBytesPerSecond) * 1_000,
    );
    this.nextWriteAt =
      Math.max(this.nextWriteAt, startedAt) + durationMilliseconds;
  }
}

export function createClickHouseSignalBackfillTarget(
  options: ClickHouseSignalBackfillTargetOptions,
): SignalBackfillTarget {
  return new ClickHouseSignalBackfillTarget(options);
}

function operationalEvidence(
  value: unknown,
): SignalBackfillOperationalEvidence {
  const evidence = record(value, 'backfill operational evidence');
  const observedAt = timestampValue(evidence, 'observedAt');
  const freshnessP95Ms = numberValue(evidence, 'freshnessP95Ms', {
    minimum: 0,
  });
  const queueDropCount = numberValue(evidence, 'queueDropCount', {
    integer: true,
    minimum: 0,
  });
  if (typeof evidence.querySloGreen !== 'boolean') {
    throw new Error('querySloGreen must be a boolean');
  }
  return {
    observedAt,
    freshnessP95Ms,
    querySloGreen: evidence.querySloGreen,
    queueDropCount,
  };
}

function diskUsage(value: unknown): number {
  const row = record(value, 'ClickHouse disk probe row');
  return numberValue(row, 'disk_usage_percent', {
    minimum: 0,
    maximum: 100,
  });
}

export class ClickHouseSignalBackfillGuard implements SignalBackfillGuard {
  private readonly options: ClickHouseSignalBackfillGuardOptions;
  private readonly maxEvidenceAgeMs: number;
  private readonly now: () => Date;
  private consecutiveQuerySloFailures = 0;
  private lastQuerySloObservation: string | undefined;

  constructor(options: ClickHouseSignalBackfillGuardOptions) {
    if (
      !options.reader &&
      (!options.schemaCheck || !options.diskUsagePercent)
    ) {
      throw new Error(
        'a ClickHouse reader is required unless schema and disk checks are supplied',
      );
    }
    assertPositiveInteger(
      options.maxEvidenceAgeMs ?? DEFAULT_GUARD_EVIDENCE_MAX_AGE_MS,
      'backfill maxEvidenceAgeMs',
    );
    this.options = options;
    this.maxEvidenceAgeMs =
      options.maxEvidenceAgeMs ?? DEFAULT_GUARD_EVIDENCE_MAX_AGE_MS;
    this.now = options.now ?? (() => new Date());
  }

  async check(_range: SignalBackfillRange): Promise<SignalBackfillGuardResult> {
    if (!(await this.isSchemaHealthy())) {
      return { status: 'blocked', code: 'schema_health' };
    }

    let usage: number;
    try {
      usage = await this.currentDiskUsagePercent();
    } catch {
      return { status: 'blocked', code: 'disk_unavailable' };
    }
    if (usage >= BACKFILL_DISK_USAGE_LIMIT) {
      return { status: 'blocked', code: 'disk_usage' };
    }

    let evidence: SignalBackfillOperationalEvidence;
    try {
      evidence = operationalEvidence(await this.options.evidence());
    } catch {
      return { status: 'blocked', code: 'operational_metrics_unavailable' };
    }
    const ageMilliseconds =
      this.now().getTime() - Date.parse(evidence.observedAt);
    if (ageMilliseconds < 0 || ageMilliseconds > this.maxEvidenceAgeMs) {
      return { status: 'blocked', code: 'operational_metrics_stale' };
    }
    if (evidence.freshnessP95Ms > MAX_FRESHNESS_P95_MS) {
      return { status: 'blocked', code: 'freshness' };
    }
    if (evidence.queueDropCount > 0) {
      return { status: 'blocked', code: 'queue_pressure' };
    }
    if (this.lastQuerySloObservation !== evidence.observedAt) {
      this.lastQuerySloObservation = evidence.observedAt;
      if (evidence.querySloGreen) {
        this.consecutiveQuerySloFailures = 0;
      } else {
        this.consecutiveQuerySloFailures += 1;
      }
    }
    if (!evidence.querySloGreen && this.consecutiveQuerySloFailures >= 2) {
      return { status: 'blocked', code: 'query_slo' };
    }
    return { status: 'ready' };
  }

  private async isSchemaHealthy(): Promise<boolean> {
    try {
      if (this.options.schemaCheck) return await this.options.schemaCheck();
      const reader = this.options.reader;
      if (!reader) return false;
      const readiness = await verifyClickHouseSignalSchema(reader, {
        expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
        schemaVersion: CLICKHOUSE_VERSION_MANIFEST.schema.marker,
        requireWriterSettings: false,
      });
      return readiness.available;
    } catch {
      return false;
    }
  }

  private async currentDiskUsagePercent(): Promise<number> {
    if (this.options.diskUsagePercent) {
      const value = await this.options.diskUsagePercent();
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error('disk usage is invalid');
      }
      return value;
    }
    const reader = this.options.reader;
    if (!reader) throw new Error('ClickHouse reader is unavailable');
    const rows = await reader.queryRows<Record<string, unknown>>(
      'SELECT max(if(total_space = 0, 0.0, (1.0 - free_space / total_space) * 100.0)) AS disk_usage_percent FROM system.disks',
      {
        settings: {
          readonly: 1,
          max_threads: 1,
          max_memory_usage: 67_108_864,
          max_execution_time: 5,
        },
        timeoutMs: 5_000,
      },
    );
    if (rows.length !== 1) throw new Error('ClickHouse disk probe is invalid');
    return diskUsage(rows[0]);
  }
}

export function createClickHouseSignalBackfillGuard(
  options: ClickHouseSignalBackfillGuardOptions,
): SignalBackfillGuard {
  return new ClickHouseSignalBackfillGuard(options);
}
