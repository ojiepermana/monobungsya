import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { DatabaseClient } from '#project/database';
import { withTransaction } from '#project/database';

export const RESOURCE_KINDS = [
  'http.server',
  'http.client',
  'db.query',
  'nats.publish',
  'nats.request',
  'nats.consume',
  'job.enqueue',
  'job.execute',
  'scheduler.tick',
  'smtp.send',
  'fs.operation',
  'process.spawn',
  'business.operation',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type SpanStatus = 'ok' | 'error' | 'unset';
export type SamplingReason =
  | 'deterministic'
  | 'error'
  | 'slow'
  | 'benchmark'
  | 'forced';

export const METRIC_NAMES = [
  'telemetry.spans.dropped_total',
  'telemetry.items.dropped_total',
  'telemetry.flush.failures_total',
  'telemetry.flush.recovery_dropped_total',
  'telemetry.context.invalid_total',
  'telemetry.queue.depth',
  'telemetry.memory_pressure.critical_total',
  'telemetry.memory_pressure.warning_total',
  'telemetry.process.cpu_ms',
  'telemetry.process.rss_bytes',
  'telemetry.process.heap_used_bytes',
  'telemetry.event_loop.lag_ms',
  'telemetry.throughput.operations',
  'telemetry.errors.total',
  'telemetry.traces.incomplete_total',
  'telemetry.operation.count',
  'telemetry.operation.duration_ns',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];
export type MetricKind = 'counter' | 'histogram' | 'gauge';

export interface TraceCarrier {
  traceparent?: string | null;
  correlationId?: string | null;
}

export interface TelemetryContext {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceFlags: number;
  correlationId: string | null;
  requestId: string | null;
  runId: string | null;
}

export interface SpanDefinition {
  resourceKind: ResourceKind;
  resourceName: string;
  operation: string;
  attributes?: Record<string, unknown>;
  runId?: string | null;
  forceSample?: boolean;
}

export interface SpanEnd {
  status?: SpanStatus;
  statusCode?: number;
  attributes?: Record<string, unknown>;
  error?: unknown;
}

export interface FlushResult {
  writtenSpans: number;
  writtenMetricBuckets: number;
  droppedItems: number;
  failed: boolean;
}

export interface SpanHandle {
  readonly context: TelemetryContext;
  end(result?: SpanEnd): void;
}

export interface Telemetry {
  currentContext(): TelemetryContext | undefined;
  enterContext(context: TelemetryContext): void;
  startSpan(
    definition: SpanDefinition,
    options?: {
      parent?: TelemetryContext | null;
      correlationId?: string | null;
      requestId?: string | null;
    },
  ): SpanHandle;
  withContext<T>(context: TelemetryContext, action: () => T): T;
  withContext<T>(
    context: TelemetryContext,
    action: () => Promise<T>,
  ): Promise<T>;
  withSpan<T>(definition: SpanDefinition, action: () => T): T;
  withSpan<T>(definition: SpanDefinition, action: () => Promise<T>): Promise<T>;
  addCounter(
    name: MetricName,
    value?: number,
    labels?: Record<string, string>,
  ): void;
  recordHistogram(
    name: MetricName,
    value: number,
    labels?: Record<string, string>,
  ): void;
  observeGauge(
    name: MetricName,
    value: number,
    labels?: Record<string, string>,
  ): void;
  extract(carrier: TraceCarrier): TelemetryContext;
  inject(context: TelemetryContext, carrier?: TraceCarrier): TraceCarrier;
  flush(timeoutMs?: number): Promise<FlushResult>;
  shutdown(timeoutMs?: number): Promise<FlushResult>;
}

export interface TelemetryRuntimeOptions {
  serviceName: string;
  serviceInstanceId: string;
  database?: DatabaseClient;
  enabled?: boolean;
  queueCapacity?: number;
  priorityCapacity?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  slowThresholdMs?: number;
  successSampleRate?: number;
  maxSpansPerTrace?: number;
  maxSerializedItemBytes?: number;
}

interface StoredSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  correlationId: string | null;
  requestId: string | null;
  runId: string | null;
  serviceName: string;
  serviceInstanceId: string;
  resourceKind: ResourceKind;
  resourceName: string;
  operation: string;
  status: SpanStatus;
  samplingReason: SamplingReason;
  attributes: Record<string, string | number | boolean>;
  errorType: string | null;
  startedAt: string;
  finishedAt: string;
  durationNs: number;
}

interface MetricBucket {
  bucketStart: string;
  bucketWidthSeconds: number;
  seriesFingerprint: string;
  flushSequence: number;
  serviceName: string;
  serviceInstanceId: string;
  resourceKind: ResourceKind;
  resourceName: string;
  metricName: MetricName;
  metricKind: MetricKind;
  unit: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  histogramBoundaries: number[];
  histogramCounts: number[];
  labels: Record<string, string>;
}

interface MetricSeries {
  fingerprint: string;
  resourceKind: ResourceKind;
  resourceName: string;
  unit: string;
  labels: Record<string, string>;
}

interface ActiveSpan {
  handle: SpanHandle;
  definition: SpanDefinition;
  startedNs: number;
  startedWallMs: number;
  startedAt: string;
  attributes: Record<string, string | number | boolean>;
  rawAttributes?: Record<string, unknown>;
  ended: boolean;
}

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|cookie|authorization|body|payload|param|query|email|user.?id|ip|header)/i;
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
const HISTOGRAM_BOUNDARIES = [
  0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
];
const CONTEXT = new AsyncLocalStorage<TelemetryContext>();
const HEX = '0123456789abcdef';
const EMPTY_LABELS: Record<string, string> = {};
const RANDOM_POOL = new Uint8Array(16 * 1024);
let randomPoolOffset = RANDOM_POOL.byteLength;
const SPAN_ID_PREFIX = randomHex(4);
let spanIdSequence = 0;
const DEFAULT_MAX_SPANS_PER_TRACE = 1_000;
const DEFAULT_MAX_SERIALIZED_ITEM_BYTES = 4_096;
const TEXT_ENCODER = new TextEncoder();

function randomHex(bytes: number): string {
  if (randomPoolOffset + bytes > RANDOM_POOL.byteLength) {
    crypto.getRandomValues(RANDOM_POOL);
    randomPoolOffset = 0;
  }
  const start = randomPoolOffset;
  randomPoolOffset += bytes;
  let result = '';
  for (let index = start; index < start + bytes; index += 1) {
    const value = RANDOM_POOL[index] ?? 0;
    result += HEX[value >>> 4] ?? '0';
    result += HEX[value & 15] ?? '0';
  }
  return result;
}

function randomSpanId(): string {
  const sequence = (spanIdSequence++ >>> 0).toString(16).padStart(8, '0');
  return `${SPAN_ID_PREFIX}${sequence}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function traceparent(context: TelemetryContext): string {
  return `00-${context.traceId}-${context.spanId}-${(context.traceFlags & 1) === 1 ? '01' : '00'}`;
}

function parseTraceparent(value: string | null | undefined): {
  traceId: string;
  spanId: string;
  traceFlags: number;
} | null {
  const match = value ? TRACEPARENT_PATTERN.exec(value) : null;
  if (!match) return null;
  const traceId = match[1]?.toLowerCase();
  const spanId = match[2]?.toLowerCase();
  const traceFlags = Number.parseInt(match[3] ?? '0', 16);
  if (!traceId || !spanId || /^0+$/.test(traceId) || /^0+$/.test(spanId)) {
    return null;
  }
  return { traceId, spanId, traceFlags };
}

function sampledTrace(traceId: string, rate: number): boolean {
  const value = Number.parseInt(traceId.slice(0, 8), 16) / 0xffffffff;
  return value < Math.max(0, Math.min(1, rate));
}

function normalizeResourceName(value: string): string {
  return value.replace(/[^A-Za-z0-9._:/-]/g, '_').slice(0, 150) || 'unknown';
}

function normalizeAttributeValue(
  value: unknown,
): string | number | boolean | null {
  if (typeof value === 'string') return value.slice(0, 256);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
}

function sanitizeAttributes(
  value: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!value) return result;
  for (const [key, raw] of Object.entries(value).slice(0, 32)) {
    if (!ATTRIBUTE_KEY_PATTERN.test(key) || SENSITIVE_KEY_PATTERN.test(key))
      continue;
    const normalized = normalizeAttributeValue(raw);
    if (normalized !== null) result[key] = normalized;
  }
  return result;
}

function errorType(value: unknown): string | null {
  return value instanceof Error ? value.constructor.name.slice(0, 100) : null;
}

function seriesFingerprint(
  metricName: MetricName,
  serviceInstanceId: string,
  resourceKind: ResourceKind,
  resourceName: string,
  unit: string,
  labels: Record<string, string>,
): string {
  const canonical = JSON.stringify({
    metricName,
    serviceInstanceId,
    resourceKind,
    resourceName,
    unit,
    labels: Object.fromEntries(Object.entries(labels).sort()),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function sqlValues(rows: unknown[][]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const placeholders = rows.map((row) => {
    const values = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${values.join(', ')})`;
  });
  return { sql: placeholders.join(', '), params };
}

function isStorageUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /connection|connect|timeout|timed out|database .* does not exist|server closed|terminating connection|network|refused|permission denied|unavailable/i.test(
    message,
  );
}

export class TelemetryRuntime implements Telemetry {
  private readonly serviceName: string;
  private readonly serviceInstanceId: string;
  private readonly database?: DatabaseClient;
  private readonly enabled: boolean;
  private readonly queueCapacity: number;
  private readonly priorityCapacity: number;
  private readonly batchSize: number;
  private readonly slowThresholdNs: number;
  private readonly successSampleRate: number;
  private readonly maxSpansPerTrace: number;
  private readonly maxSerializedItemBytes: number;
  private readonly spans: StoredSpan[] = [];
  private readonly prioritySpans: StoredSpan[] = [];
  private readonly metrics = new Map<string, MetricBucket>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private probeTimer: ReturnType<typeof setInterval> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private flushSequence = 0;
  private droppedItems = 0;
  private recoveryDroppedItems = 0;
  private storageBackoffUntil = 0;
  private storageBackoffMs = 0;
  private readonly traceSpanCounts = new Map<string, number>();
  private readonly incompleteTraces = new Set<string>();
  private readonly metricFingerprints = new Map<string, string>();
  private readonly metricSeries = new Map<string, MetricSeries>();
  private readonly currentMetricBuckets = new Map<string, MetricBucket>();
  private samplingMultiplier = 1;
  private memoryPressureListener: ((level: string) => void) | undefined;
  private lastCpuUsage = process.cpuUsage();
  private lastProbeNs = Bun.nanoseconds();
  private metricBucketStartMs = -1;
  private metricBucketStartValue = '';

  constructor(options: TelemetryRuntimeOptions) {
    this.serviceName = options.serviceName;
    this.serviceInstanceId = options.serviceInstanceId;
    this.database = options.database;
    this.enabled = options.enabled ?? true;
    this.queueCapacity = options.queueCapacity ?? 2_000;
    this.priorityCapacity = options.priorityCapacity ?? 500;
    this.batchSize = options.batchSize ?? 200;
    this.slowThresholdNs = (options.slowThresholdMs ?? 1_000) * 1_000_000;
    this.successSampleRate = options.successSampleRate ?? 0.05;
    this.maxSpansPerTrace =
      options.maxSpansPerTrace ?? DEFAULT_MAX_SPANS_PER_TRACE;
    this.maxSerializedItemBytes =
      options.maxSerializedItemBytes ?? DEFAULT_MAX_SERIALIZED_ITEM_BYTES;
    if (this.enabled && this.database) {
      this.flushTimer = setInterval(
        () => void this.flush(),
        options.flushIntervalMs ?? 1_000,
      );
    }
    if (this.enabled) {
      this.probeTimer = setInterval(() => this.recordRuntimeProbes(), 1_000);
      this.probeTimer.unref();
      this.attachMemoryPressureListener();
    }
  }

  currentContext(): TelemetryContext | undefined {
    return CONTEXT.getStore();
  }

  enterContext(context: TelemetryContext): void {
    CONTEXT.enterWith(context);
  }

  diagnostics(): { droppedItems: number; queueDepth: number } {
    return {
      droppedItems: this.droppedItems,
      queueDepth: this.spans.length + this.prioritySpans.length,
    };
  }

  withContext<T>(context: TelemetryContext, action: () => T): T;
  withContext<T>(
    context: TelemetryContext,
    action: () => Promise<T>,
  ): Promise<T>;
  withContext<T>(context: TelemetryContext, action: () => T): T | Promise<T> {
    return CONTEXT.run(context, action);
  }

  startSpan(
    definition: SpanDefinition,
    options: {
      parent?: TelemetryContext | null;
      correlationId?: string | null;
      requestId?: string | null;
    } = {},
  ): SpanHandle {
    const parent = options.parent ?? this.currentContext();
    const traceId = parent?.traceId ?? randomHex(16);
    const sampled =
      definition.forceSample === true ||
      Boolean(definition.runId) ||
      (parent
        ? (parent.traceFlags & 1) === 1
        : sampledTrace(traceId, this.effectiveSampleRate()));
    const context: TelemetryContext = {
      traceId,
      spanId: randomSpanId(),
      parentSpanId: parent?.spanId ?? null,
      traceFlags: sampled ? 1 : 0,
      correlationId: options.correlationId ?? parent?.correlationId ?? null,
      requestId: options.requestId ?? parent?.requestId ?? null,
      runId: definition.runId ?? parent?.runId ?? null,
    };
    if (!sampled) {
      const startedNs = Bun.nanoseconds();
      const startedWallMs = Date.now();
      let ended = false;
      const handle: SpanHandle = {
        context,
        end: (result = {}) => {
          if (ended) return;
          ended = true;
          const durationNs = Math.max(0, Bun.nanoseconds() - startedNs);
          if (!result.error && durationNs < this.slowThresholdNs) return;
          this.endSpan(
            {
              handle,
              definition,
              startedNs,
              startedWallMs,
              startedAt: '',
              attributes: {},
              rawAttributes: definition.attributes,
              ended: false,
            },
            result,
          );
        },
      };
      return handle;
    }
    const active: ActiveSpan = {
      handle: {
        context,
        end: (result = {}) => this.endSpan(active, result),
      },
      definition,
      startedNs: Bun.nanoseconds(),
      startedWallMs: Date.now(),
      startedAt: '',
      attributes: sampled ? sanitizeAttributes(definition.attributes) : {},
      rawAttributes: sampled ? undefined : definition.attributes,
      ended: false,
    };
    return active.handle;
  }

  withSpan<T>(definition: SpanDefinition, action: () => T): T;
  withSpan<T>(definition: SpanDefinition, action: () => Promise<T>): Promise<T>;
  withSpan<T>(definition: SpanDefinition, action: () => T): T | Promise<T> {
    if (!this.enabled) return action();
    const parent = this.currentContext();
    if (
      parent &&
      (parent.traceFlags & 1) === 0 &&
      definition.forceSample !== true &&
      !definition.runId
    ) {
      try {
        const result = action();
        if (result instanceof Promise) {
          return result.catch((error: unknown) => {
            const handle = this.startSpan(definition, { parent });
            handle.end({ status: 'error', error });
            throw error;
          });
        }
        return result;
      } catch (error) {
        const handle = this.startSpan(definition, { parent });
        handle.end({ status: 'error', error });
        throw error;
      }
    }
    const handle = this.startSpan(definition);
    let result: T | Promise<T>;
    try {
      result = CONTEXT.run(handle.context, action);
    } catch (error) {
      handle.end({ status: 'error', error });
      throw error;
    }
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          handle.end({ status: 'ok' });
          return value;
        },
        (error: unknown) => {
          handle.end({ status: 'error', error });
          throw error;
        },
      );
    }
    handle.end({ status: 'ok' });
    return result;
  }

  extract(carrier: TraceCarrier): TelemetryContext {
    const parsed = parseTraceparent(carrier.traceparent);
    if (!parsed) {
      if (carrier.traceparent)
        this.addCounter('telemetry.context.invalid_total');
      const traceId = randomHex(16);
      return {
        traceId,
        spanId: randomSpanId(),
        parentSpanId: null,
        traceFlags: sampledTrace(traceId, this.effectiveSampleRate()) ? 1 : 0,
        correlationId: carrier.correlationId?.slice(0, 100) ?? null,
        requestId: null,
        runId: null,
      };
    }
    return {
      ...parsed,
      parentSpanId: null,
      correlationId: carrier.correlationId?.slice(0, 100) ?? null,
      requestId: null,
      runId: null,
    };
  }

  inject(context: TelemetryContext, carrier: TraceCarrier = {}): TraceCarrier {
    return { ...carrier, traceparent: traceparent(context) };
  }

  handleMemoryPressure(level: 'warning' | 'critical' | 'normal'): void {
    if (level === 'warning') {
      this.samplingMultiplier = 0.5;
      this.addCounter('telemetry.memory_pressure.warning_total');
      void this.flush();
    } else if (level === 'critical') {
      this.samplingMultiplier = 0;
      this.addCounter('telemetry.memory_pressure.critical_total');
      while (this.spans.length > Math.floor(this.queueCapacity / 2)) {
        this.spans.shift();
        this.dropItem('memory_pressure');
      }
      void this.flush();
    }
    if (level !== 'normal') {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => {
        this.samplingMultiplier = 0.5;
        this.recoveryTimer = undefined;
        this.recoveryTimer = setTimeout(() => {
          this.samplingMultiplier = 1;
          this.recoveryTimer = undefined;
        }, 5 * 60_000);
        this.recoveryTimer.unref();
      }, 5 * 60_000);
      this.recoveryTimer.unref();
    } else {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
      this.samplingMultiplier = 1;
    }
  }

  addCounter(
    name: MetricName,
    value = 1,
    labels: Record<string, string> = {},
  ): void {
    this.recordMetric(name, 'counter', value, 'count', labels);
  }

  recordHistogram(
    name: MetricName,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    this.recordMetric(name, 'histogram', value, 'ms', labels);
  }

  observeGauge(
    name: MetricName,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    this.recordMetric(name, 'gauge', value, 'value', labels);
  }

  async flush(timeoutMs?: number): Promise<FlushResult> {
    if (!this.enabled || !this.database) {
      return {
        writtenSpans: 0,
        writtenMetricBuckets: 0,
        droppedItems: this.droppedItems,
        failed: false,
      };
    }
    const operation = this.flushNow();
    if (!timeoutMs) return operation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<FlushResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                writtenSpans: 0,
                writtenMetricBuckets: 0,
                droppedItems: this.droppedItems,
                failed: true,
              }),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async shutdown(timeoutMs?: number): Promise<FlushResult> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = undefined;
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = undefined;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    if (this.memoryPressureListener) {
      const processWithMemoryPressure = process as typeof process & {
        removeListener(
          event: 'memoryPressure',
          listener: (level: string) => void,
        ): void;
      };
      processWithMemoryPressure.removeListener(
        'memoryPressure',
        this.memoryPressureListener,
      );
      this.memoryPressureListener = undefined;
    }
    return this.flush(timeoutMs);
  }

  private endSpan(active: ActiveSpan, result: SpanEnd): void {
    if (active.ended) return;
    active.ended = true;
    const durationNs = Math.max(0, Bun.nanoseconds() - active.startedNs);
    const status = result.status ?? (result.error ? 'error' : 'unset');
    const keep =
      this.enabled &&
      ((active.handle.context.traceFlags & 1) === 1 ||
        Boolean(result.error) ||
        durationNs >= this.slowThresholdNs ||
        Boolean(active.definition.runId));
    if (!keep) return;
    const samplingReason: SamplingReason = active.definition.runId
      ? 'benchmark'
      : result.error
        ? 'error'
        : durationNs >= this.slowThresholdNs
          ? 'slow'
          : active.definition.forceSample
            ? 'forced'
            : 'deterministic';
    if (active.rawAttributes) {
      Object.assign(
        active.attributes,
        sanitizeAttributes(active.rawAttributes),
      );
      active.rawAttributes = undefined;
    }
    if (result.attributes) {
      Object.assign(active.attributes, sanitizeAttributes(result.attributes));
    }
    const resourceName = normalizeResourceName(active.definition.resourceName);
    const startedAt =
      active.startedAt || new Date(active.startedWallMs).toISOString();
    const span: StoredSpan = {
      traceId: active.handle.context.traceId,
      spanId: active.handle.context.spanId,
      parentSpanId: active.handle.context.parentSpanId,
      correlationId: active.handle.context.correlationId,
      requestId: active.handle.context.requestId,
      runId: active.handle.context.runId,
      serviceName: this.serviceName,
      serviceInstanceId: this.serviceInstanceId,
      resourceKind: active.definition.resourceKind,
      resourceName,
      operation: active.definition.operation.slice(0, 50),
      status,
      samplingReason,
      attributes: active.attributes,
      errorType: errorType(result.error),
      startedAt,
      finishedAt: nowIso(),
      durationNs,
    };
    const traceCount = this.traceSpanCounts.get(span.traceId) ?? 0;
    if (traceCount >= this.maxSpansPerTrace) {
      this.markTraceIncomplete(span.traceId);
      this.dropItem('trace_limit');
      return;
    }
    this.traceSpanCounts.set(span.traceId, traceCount + 1);
    if (this.incompleteTraces.has(span.traceId)) {
      span.attributes['telemetry.incomplete'] = true;
    }
    if (!this.fitSerializedItem(span)) {
      this.markTraceIncomplete(span.traceId);
      this.dropItem('item_limit');
      return;
    }
    this.enqueueSpan(
      span,
      Boolean(result.error) || durationNs >= this.slowThresholdNs,
    );
    this.addCounter('telemetry.operation.count', 1, {
      resource_kind: active.definition.resourceKind,
      resource_name: resourceName,
      status,
    });
    if (status === 'error') this.addCounter('telemetry.errors.total');
    this.recordHistogram(
      'telemetry.operation.duration_ns',
      durationNs / 1_000_000,
      {
        resource_kind: active.definition.resourceKind,
        resource_name: resourceName,
      },
    );
  }

  private enqueueSpan(span: StoredSpan, priority: boolean): void {
    const target = priority ? this.prioritySpans : this.spans;
    const capacity = priority ? this.priorityCapacity : this.queueCapacity;
    if (target.length >= capacity) {
      this.dropItem(priority ? 'high' : 'low');
      this.addCounter('telemetry.spans.dropped_total', 1, {
        priority: priority ? 'high' : 'low',
      });
      return;
    }
    target.push(span);
  }

  private recordMetric(
    metricName: MetricName,
    metricKind: MetricKind,
    value: number,
    unit: string,
    labels: Record<string, string>,
  ): void {
    if (!this.enabled || !Number.isFinite(value)) return;
    const resourceKind =
      (labels.resource_kind as ResourceKind | undefined) ??
      'business.operation';
    const resourceName = labels.resource_name ?? 'runtime';
    const labelEntries = Object.entries(labels);
    const hasOnlyResourceLabels =
      labelEntries.length === 0 ||
      (labelEntries.length === 2 &&
        labels.resource_kind !== undefined &&
        labels.resource_name !== undefined);
    const normalizedLabels = hasOnlyResourceLabels
      ? EMPTY_LABELS
      : Object.fromEntries(
          labelEntries
            .filter(
              ([key, label]) =>
                key !== 'resource_kind' &&
                key !== 'resource_name' &&
                label.length <= 256,
            )
            .sort(),
        );
    const seriesKey = hasOnlyResourceLabels
      ? `${metricName}|${this.serviceInstanceId}|${resourceKind}|${resourceName}|${unit}|`
      : `${metricName}|${this.serviceInstanceId}|${resourceKind}|${resourceName}|${unit}|${JSON.stringify(normalizedLabels)}`;
    let series = this.metricSeries.get(seriesKey);
    if (!series) {
      let fingerprint = this.metricFingerprints.get(seriesKey);
      if (!fingerprint) {
        fingerprint = seriesFingerprint(
          metricName,
          this.serviceInstanceId,
          resourceKind,
          resourceName,
          unit,
          normalizedLabels,
        );
        this.metricFingerprints.set(seriesKey, fingerprint);
      }
      series = {
        fingerprint,
        resourceKind,
        resourceName,
        unit,
        labels: normalizedLabels,
      };
      this.metricSeries.set(seriesKey, series);
    }
    const currentBucketStart = this.currentMetricBucketStart();
    let bucket = this.currentMetricBuckets.get(series.fingerprint);
    if (!bucket) {
      const key = `${currentBucketStart}:${series.fingerprint}`;
      bucket = this.metrics.get(key);
    }
    if (!bucket) {
      bucket = {
        bucketStart: currentBucketStart,
        bucketWidthSeconds: 60,
        seriesFingerprint: series.fingerprint,
        flushSequence: 0,
        serviceName: this.serviceName,
        serviceInstanceId: this.serviceInstanceId,
        resourceKind: series.resourceKind,
        resourceName: series.resourceName,
        metricName,
        metricKind,
        unit: series.unit,
        count: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        histogramBoundaries: HISTOGRAM_BOUNDARIES,
        histogramCounts: Array.from(
          { length: HISTOGRAM_BOUNDARIES.length + 1 },
          () => 0,
        ),
        labels: series.labels,
      } satisfies MetricBucket;
      this.metrics.set(`${currentBucketStart}:${series.fingerprint}`, bucket);
      this.currentMetricBuckets.set(series.fingerprint, bucket);
    } else {
      this.currentMetricBuckets.set(series.fingerprint, bucket);
    }
    bucket.count +=
      metricKind === 'histogram' || metricKind === 'gauge' ? 1 : value;
    bucket.sum += value;
    bucket.min = Math.min(bucket.min, value);
    bucket.max = Math.max(bucket.max, value);
    if (metricKind === 'histogram') {
      const index = HISTOGRAM_BOUNDARIES.findIndex(
        (boundary) => value <= boundary,
      );
      const bucketIndex = index < 0 ? bucket.histogramCounts.length - 1 : index;
      bucket.histogramCounts[bucketIndex] =
        (bucket.histogramCounts[bucketIndex] ?? 0) + 1;
    }
  }

  private currentMetricBucketStart(): string {
    const startMs = Math.floor(Date.now() / 60_000) * 60_000;
    if (startMs !== this.metricBucketStartMs) {
      this.metricBucketStartMs = startMs;
      this.metricBucketStartValue = new Date(startMs).toISOString();
      this.currentMetricBuckets.clear();
    }
    return this.metricBucketStartValue;
  }

  private async flushNow(): Promise<FlushResult> {
    if (Date.now() < this.storageBackoffUntil) {
      return {
        writtenSpans: 0,
        writtenMetricBuckets: 0,
        droppedItems: this.droppedItems,
        failed: true,
      };
    }
    if (this.recoveryDroppedItems > 0) {
      this.recordMetric(
        'telemetry.flush.recovery_dropped_total',
        'counter',
        this.recoveryDroppedItems,
        'count',
        {},
      );
      this.recoveryDroppedItems = 0;
    }
    const spans: StoredSpan[] = [];
    while (this.prioritySpans.length > 0 && spans.length < this.batchSize) {
      const span = this.prioritySpans.shift();
      if (span) spans.push(span);
    }
    while (this.spans.length > 0 && spans.length < this.batchSize) {
      const span = this.spans.shift();
      if (span) spans.push(span);
    }
    const buckets = Array.from(this.metrics.values());
    this.metrics.clear();
    this.currentMetricBuckets.clear();
    if (!this.database || (spans.length === 0 && buckets.length === 0)) {
      return {
        writtenSpans: 0,
        writtenMetricBuckets: 0,
        droppedItems: this.droppedItems,
        failed: false,
      };
    }
    this.flushSequence += 1;
    for (const bucket of buckets) bucket.flushSequence = this.flushSequence;
    const written = await this.persistItems(spans, buckets);
    if (!written.failed) {
      this.storageBackoffMs = 0;
      this.storageBackoffUntil = 0;
    }
    return {
      writtenSpans: written.writtenSpans,
      writtenMetricBuckets: written.writtenMetricBuckets,
      droppedItems: this.droppedItems,
      failed: written.failed,
    };
  }

  private async persistItems(
    spans: StoredSpan[],
    buckets: MetricBucket[],
  ): Promise<{
    writtenSpans: number;
    writtenMetricBuckets: number;
    failed: boolean;
  }> {
    if (spans.length === 0 && buckets.length === 0) {
      return { writtenSpans: 0, writtenMetricBuckets: 0, failed: false };
    }
    const database = this.database;
    if (!database) {
      return { writtenSpans: 0, writtenMetricBuckets: 0, failed: true };
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await withTransaction(database, async (transaction) => {
          if (spans.length > 0) {
            const values = sqlValues(
              spans.map((span) => [
                span.traceId,
                span.spanId,
                span.parentSpanId,
                span.correlationId,
                span.requestId,
                span.runId,
                span.serviceName,
                span.serviceInstanceId,
                span.resourceKind,
                span.resourceName,
                span.operation,
                span.status,
                span.samplingReason,
                JSON.stringify(span.attributes),
                span.errorType,
                span.startedAt,
                span.finishedAt,
                span.durationNs,
              ]),
            );
            await transaction.unsafe(
              `INSERT INTO "telemetry"."spans" (trace_id, span_id, parent_span_id, correlation_id, request_id, run_id, service_name, service_instance_id, resource_kind, resource_name, operation, status, sampling_reason, attributes, error_type, started_at, finished_at, duration_ns) VALUES ${values.sql} ON CONFLICT DO NOTHING`,
              values.params as never[],
            );
          }
          if (buckets.length > 0) {
            const values = sqlValues(
              buckets.map((bucket) => [
                bucket.bucketStart,
                bucket.bucketWidthSeconds,
                bucket.seriesFingerprint,
                bucket.flushSequence,
                bucket.serviceName,
                bucket.serviceInstanceId,
                bucket.resourceKind,
                bucket.resourceName,
                bucket.metricName,
                bucket.metricKind,
                bucket.unit,
                bucket.count,
                bucket.sum,
                bucket.min,
                bucket.max,
                transaction.array(bucket.histogramBoundaries, 'float8'),
                transaction.array(bucket.histogramCounts, 'int8'),
                JSON.stringify(bucket.labels),
              ]),
            );
            await transaction.unsafe(
              `INSERT INTO "telemetry"."metric_buckets" (bucket_start, bucket_width_seconds, series_fingerprint, flush_sequence, service_name, service_instance_id, resource_kind, resource_name, metric_name, metric_kind, unit, count, sum, min, max, histogram_boundaries, histogram_counts, labels) VALUES ${values.sql} ON CONFLICT (bucket_start, series_fingerprint) DO UPDATE SET flush_sequence = EXCLUDED.flush_sequence, count = EXCLUDED.count, sum = EXCLUDED.sum, min = EXCLUDED.min, max = EXCLUDED.max, histogram_boundaries = EXCLUDED.histogram_boundaries, histogram_counts = EXCLUDED.histogram_counts, labels = EXCLUDED.labels WHERE EXCLUDED.flush_sequence > "telemetry"."metric_buckets".flush_sequence`,
              values.params as never[],
            );
          }
        });
        return {
          writtenSpans: spans.length,
          writtenMetricBuckets: buckets.length,
          failed: false,
        };
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 20),
          );
        }
      }
    }

    const all = [
      ...spans.map((value) => ({ kind: 'span' as const, value })),
      ...buckets.map((value) => ({ kind: 'bucket' as const, value })),
    ];
    if (isStorageUnavailable(lastError)) {
      this.dropItems(all.length, 'storage_outage');
      this.scheduleStorageRetry();
      console.error(
        '[telemetry] storage unavailable; dropped telemetry batch',
        all.length,
      );
      return { writtenSpans: 0, writtenMetricBuckets: 0, failed: true };
    }
    if (all.length > 1) {
      const midpoint = Math.ceil(all.length / 2);
      const left = await this.persistItems(
        all
          .slice(0, midpoint)
          .filter(
            (item): item is { kind: 'span'; value: StoredSpan } =>
              item.kind === 'span',
          )
          .map((item) => item.value),
        all
          .slice(0, midpoint)
          .filter(
            (item): item is { kind: 'bucket'; value: MetricBucket } =>
              item.kind === 'bucket',
          )
          .map((item) => item.value),
      );
      const right = await this.persistItems(
        all
          .slice(midpoint)
          .filter(
            (item): item is { kind: 'span'; value: StoredSpan } =>
              item.kind === 'span',
          )
          .map((item) => item.value),
        all
          .slice(midpoint)
          .filter(
            (item): item is { kind: 'bucket'; value: MetricBucket } =>
              item.kind === 'bucket',
          )
          .map((item) => item.value),
      );
      return {
        writtenSpans: left.writtenSpans + right.writtenSpans,
        writtenMetricBuckets:
          left.writtenMetricBuckets + right.writtenMetricBuckets,
        failed: left.failed || right.failed,
      };
    }

    this.dropItem('poison');
    this.addCounter('telemetry.flush.failures_total');
    console.error(
      '[telemetry] poison item dropped:',
      lastError instanceof Error ? lastError.constructor.name : 'unknown',
    );
    return { writtenSpans: 0, writtenMetricBuckets: 0, failed: true };
  }

  private dropItem(reason: string): void {
    this.dropItems(1, reason);
  }

  private dropItems(count: number, reason: string): void {
    if (count < 1) return;
    this.droppedItems += count;
    this.recoveryDroppedItems += count;
    this.addCounter('telemetry.items.dropped_total', count, { reason });
  }

  private scheduleStorageRetry(): void {
    this.storageBackoffMs = Math.min(
      this.storageBackoffMs === 0 ? 1_000 : this.storageBackoffMs * 2,
      60_000,
    );
    this.storageBackoffUntil = Date.now() + this.storageBackoffMs;
  }

  private markTraceIncomplete(traceId: string): void {
    if (this.incompleteTraces.has(traceId)) return;
    this.incompleteTraces.add(traceId);
    this.addCounter('telemetry.traces.incomplete_total');
    for (const span of [...this.spans, ...this.prioritySpans]) {
      if (span.traceId === traceId) {
        span.attributes['telemetry.incomplete'] = true;
      }
    }
  }

  private fitSerializedItem(span: StoredSpan): boolean {
    if (Object.keys(span.attributes).length === 0) {
      return true;
    }
    const serializedBytes = () =>
      TEXT_ENCODER.encode(JSON.stringify(span)).byteLength;
    if (serializedBytes() <= this.maxSerializedItemBytes) return true;
    const keys = Object.keys(span.attributes);
    while (keys.length > 0 && serializedBytes() > this.maxSerializedItemBytes) {
      const key = keys.pop();
      if (key) delete span.attributes[key];
    }
    return serializedBytes() <= this.maxSerializedItemBytes;
  }

  private effectiveSampleRate(): number {
    return this.successSampleRate * this.samplingMultiplier;
  }

  private attachMemoryPressureListener(): void {
    const processWithMemoryPressure = process as typeof process & {
      on(event: 'memoryPressure', listener: (level: string) => void): void;
    };
    const listener = (level: string) => {
      if (level === 'critical' || level === 'warning') {
        this.handleMemoryPressure(level);
      }
    };
    this.memoryPressureListener = listener;
    processWithMemoryPressure.on('memoryPressure', listener);
  }

  private recordRuntimeProbes(): void {
    const nowNs = Bun.nanoseconds();
    const elapsedMs = Math.max(1, (nowNs - this.lastProbeNs) / 1_000_000);
    const cpu = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastProbeNs = nowNs;
    const memory = process.memoryUsage();
    this.recordHistogram(
      'telemetry.process.cpu_ms',
      (cpu.user + cpu.system) / 1_000,
      {
        resource_kind: 'business.operation',
        resource_name: 'runtime',
      },
    );
    this.observeGauge('telemetry.process.rss_bytes', memory.rss, {
      resource_kind: 'business.operation',
      resource_name: 'runtime',
    });
    this.observeGauge('telemetry.process.heap_used_bytes', memory.heapUsed, {
      resource_kind: 'business.operation',
      resource_name: 'runtime',
    });
    this.recordHistogram(
      'telemetry.event_loop.lag_ms',
      Math.max(0, elapsedMs - 1_000),
      { resource_kind: 'business.operation', resource_name: 'runtime' },
    );
    this.observeGauge(
      'telemetry.queue.depth',
      this.spans.length + this.prioritySpans.length,
      { resource_kind: 'business.operation', resource_name: 'telemetry.queue' },
    );
  }
}

export function isValidTraceparent(value: string | null | undefined): boolean {
  return parseTraceparent(value) !== null;
}

export function formatTraceparent(context: TelemetryContext): string {
  return traceparent(context);
}

export * from './alerting';
export * from './benchmark';
