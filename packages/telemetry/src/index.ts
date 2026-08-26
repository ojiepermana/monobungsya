import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignalStore,
  type SpanSignal,
} from '#project/observability';

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
  signalStore?: ObservabilitySignalStore;
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

export class TelemetryRuntime implements Telemetry {
  private readonly serviceName: string;
  private readonly serviceInstanceId: string;
  private readonly signalStore?: ObservabilitySignalStore;
  private readonly enabled: boolean;
  private readonly slowThresholdNs: number;
  private readonly successSampleRate: number;
  private readonly maxSpansPerTrace: number;
  private readonly metrics = new Map<string, MetricBucket>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private probeTimer: ReturnType<typeof setInterval> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private flushSequence = 0;
  private droppedItems = 0;
  private recoveryDroppedItems = 0;
  private pendingSpans = 0;
  private pendingMetricBuckets = 0;
  private persistedDroppedItems = 0;
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
    this.signalStore = options.signalStore;
    this.enabled = options.enabled ?? true;
    this.slowThresholdNs = (options.slowThresholdMs ?? 1_000) * 1_000_000;
    this.successSampleRate = options.successSampleRate ?? 0.05;
    this.maxSpansPerTrace =
      options.maxSpansPerTrace ?? DEFAULT_MAX_SPANS_PER_TRACE;
    if (this.enabled && this.signalStore) {
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
    const storeDiagnostics = this.signalStore?.diagnostics();
    return {
      droppedItems:
        this.droppedItems +
        Object.values(storeDiagnostics?.droppedByReason ?? {}).reduce(
          (total, count) => total + count,
          0,
        ),
      queueDepth: storeDiagnostics?.queueDepth ?? 0,
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
    if (!this.enabled || !this.signalStore) {
      return {
        writtenSpans: 0,
        writtenMetricBuckets: 0,
        droppedItems: this.droppedItems + this.persistedDroppedItems,
        failed: false,
      };
    }
    return this.flushNow(timeoutMs);
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
    const result = await this.flush(timeoutMs);
    await this.signalStore?.shutdown(timeoutMs);
    return result;
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
    this.appendSpan(span);
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

  private async flushNow(timeoutMs?: number): Promise<FlushResult> {
    const signalStore = this.signalStore;
    if (!signalStore) {
      return {
        writtenSpans: 0,
        writtenMetricBuckets: 0,
        droppedItems: this.droppedItems + this.persistedDroppedItems,
        failed: false,
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
    const buckets = Array.from(this.metrics.values());
    this.metrics.clear();
    this.currentMetricBuckets.clear();
    this.flushSequence += 1;
    for (const bucket of buckets) {
      bucket.flushSequence = this.flushSequence;
      this.appendMetricBucket(bucket);
    }
    const storeResult = await signalStore.flush(timeoutMs);
    this.persistedDroppedItems += storeResult.dropped;
    this.recoveryDroppedItems += storeResult.dropped;
    const pending = this.pendingSpans + this.pendingMetricBuckets;
    const written = Math.min(storeResult.written, pending);
    const writtenSpans = Math.min(this.pendingSpans, written);
    const writtenMetricBuckets = Math.min(
      this.pendingMetricBuckets,
      Math.max(0, written - writtenSpans),
    );
    this.pendingSpans -= writtenSpans;
    this.pendingMetricBuckets -= writtenMetricBuckets;
    return {
      writtenSpans,
      writtenMetricBuckets,
      droppedItems: this.droppedItems + this.persistedDroppedItems,
      failed: storeResult.failed || storeResult.timedOut,
    };
  }

  private appendSpan(span: StoredSpan): void {
    const result = this.signalStore?.append({
      kind: 'span',
      ...span,
      schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    } satisfies SpanSignal);
    if (result?.status === 'accepted') {
      this.pendingSpans += 1;
    } else if (result?.status === 'dropped') {
      this.dropItem(result.reason);
    }
  }

  private appendMetricBucket(bucket: MetricBucket): void {
    const result = this.signalStore?.append({
      kind: 'metric_bucket',
      ...bucket,
      schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    });
    if (result?.status === 'accepted') {
      this.pendingMetricBuckets += 1;
    } else if (result?.status === 'dropped') {
      this.dropItem(result.reason);
    }
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

  private markTraceIncomplete(traceId: string): void {
    if (this.incompleteTraces.has(traceId)) return;
    this.incompleteTraces.add(traceId);
    this.addCounter('telemetry.traces.incomplete_total');
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
      this.signalStore?.diagnostics().queueDepth ?? 0,
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
