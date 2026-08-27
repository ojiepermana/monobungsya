import {
  type AppendResult,
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignal,
  type ObservabilitySignalStore,
  type SignalFlushResult,
  type SignalKind,
  type SignalStoreDiagnostics,
  type SignalTargetDiagnostics,
  type StoredObservabilitySignal,
} from './types';

const encoder = new TextEncoder();
const SIGNAL_KINDS: readonly SignalKind[] = [
  'span',
  'metric_bucket',
  'application_log',
  'access_log',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const SERIES_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export interface SignalBatch {
  readonly id: string;
  readonly kind: SignalKind;
  readonly signals: readonly StoredObservabilitySignal[];
}

/** Internal adapter seam. It is intentionally not exported from the package barrel. */
export interface SignalTarget {
  readonly name: string;
  write(batch: SignalBatch): Promise<void>;
}

export class SignalDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly options: { transient?: boolean; rowSpecific?: boolean } = {},
  ) {
    super(code);
    this.name = 'SignalDeliveryError';
  }
}

export interface BufferedSignalStoreOptions {
  targets: readonly SignalTarget[];
  maxItems?: number;
  maxBytes?: number;
  batchMaxItems?: number;
  batchMaxBytes?: number;
  flushIntervalMs?: number;
  maxInFlight?: number;
  retryLimit?: number;
  now?: () => Date;
}

interface QueuedSignal {
  readonly signal: StoredObservabilitySignal;
  readonly bytes: number;
  readonly priority: boolean;
}

interface DeliveryOutcome {
  written: number;
  dropped: number;
  failed: boolean;
}

interface AcknowledgedTargetWrite {
  readonly target: SignalTarget;
  readonly status: 'acknowledged';
}

interface FailedTargetWrite {
  readonly target: SignalTarget;
  readonly status: 'failed';
  readonly error: unknown;
}

type TargetWriteOutcome = AcknowledgedTargetWrite | FailedTargetWrite;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isNullableUuid(value: unknown): boolean {
  return value === null || isUuid(value);
}

function isNullableFixedHex(value: unknown, pattern: RegExp): boolean {
  return value === null || (typeof value === 'string' && pattern.test(value));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnsignedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isUnsignedUInt16(value: unknown): boolean {
  return isUnsignedInteger(value) && value <= 65_535;
}

function isUnsignedUInt32(value: unknown): boolean {
  return isUnsignedInteger(value) && value <= 4_294_967_295;
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function isUnsignedIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isUnsignedInteger);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isSpanAttributes(
  value: unknown,
): value is Record<string, string | number | boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        isFiniteNumber(item),
    )
  );
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (isFiniteNumber(value)) return true;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      return value.every((item) => isJsonValue(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isRecord(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    return Object.values(value).every((item) => isJsonValue(item, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function signalTime(signal: ObservabilitySignal): string {
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

function retentionMs(signal: ObservabilitySignal): number {
  return signal.kind === 'span'
    ? 7 * 24 * 60 * 60 * 1_000
    : 30 * 24 * 60 * 60 * 1_000;
}

function isPriority(signal: ObservabilitySignal): boolean {
  if (signal.kind === 'span') {
    return signal.status === 'error' || signal.samplingReason === 'slow';
  }
  if (signal.kind === 'application_log') {
    return /^(error|fatal|critical|alert)$/i.test(signal.level);
  }
  return (
    signal.kind === 'access_log' &&
    (signal.outcome !== 'success' || (signal.httpStatus ?? 0) >= 500)
  );
}

function failureCode(error: unknown): string {
  if (error instanceof SignalDeliveryError) return error.code;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return `http_${(error as { status: number }).status}`;
  }
  return error instanceof Error ? error.constructor.name : 'unknown';
}

function isTransient(error: unknown): boolean {
  if (error instanceof SignalDeliveryError)
    return error.options.transient === true;
  const status =
    error && typeof error === 'object'
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /network|connect|connection|timeout|timed out|reset|unavailable|outage|transient|refused/i.test(
    text,
  );
}

function isRowSpecific(error: unknown): boolean {
  if (error instanceof SignalDeliveryError) {
    return error.options.rowSpecific === true;
  }
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { status?: unknown }).status === 400
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Owns the bounded queue and delivery policy. Producers see only the four
 * ObservabilitySignalStore methods from types.ts.
 */
export class BufferedObservabilitySignalStore
  implements ObservabilitySignalStore
{
  private readonly targets: readonly SignalTarget[];
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly batchMaxItems: number;
  private readonly batchMaxBytes: number;
  private readonly maxInFlight: number;
  private readonly retryLimit: number;
  private readonly now: () => Date;
  private readonly targetDiagnostics = new Map<
    string,
    SignalTargetDiagnostics
  >();
  private readonly droppedByReason = new Map<string, number>();
  private readonly queue: QueuedSignal[] = [];
  private readonly inFlight = new Set<Promise<DeliveryOutcome>>();
  private readonly nextKindIndex = { value: 0 };
  private readonly flushTimer: ReturnType<typeof setInterval> | undefined;
  private queueBytes = 0;
  private totalWritten = 0;
  private totalDropped = 0;
  private totalFailedDeliveries = 0;
  private blindSpotSince: string | null = null;
  private lastAcknowledgedAt: string | null = null;
  private lastFailureCode: string | null = null;
  private shuttingDown = false;
  private drainPromise: Promise<void> | undefined;

  constructor(options: BufferedSignalStoreOptions) {
    this.targets = options.targets;
    this.maxItems = options.maxItems ?? 20_000;
    this.maxBytes = options.maxBytes ?? 32 * 1_024 * 1_024;
    this.batchMaxItems = options.batchMaxItems ?? 5_000;
    this.batchMaxBytes = options.batchMaxBytes ?? 4 * 1_024 * 1_024;
    this.maxInFlight = options.maxInFlight ?? 4;
    this.retryLimit = options.retryLimit ?? 3;
    this.now = options.now ?? (() => new Date());
    if (this.batchMaxBytes < 4_096) {
      throw new Error(
        'Observability Signal batch capacity must fit one maximum size signal',
      );
    }
    for (const target of this.targets) {
      this.targetDiagnostics.set(target.name, {
        written: 0,
        dropped: 0,
        lastAcknowledgedAt: null,
        failureCode: null,
      });
    }
    if (this.targets.length > 0) {
      this.flushTimer = setInterval(
        () => void this.flush(),
        options.flushIntervalMs ?? 500,
      );
      this.flushTimer.unref();
    }
  }

  append(signal: ObservabilitySignal): AppendResult {
    if (this.targets.length === 0) return this.dropAppend('disabled');
    if (this.shuttingDown) return this.dropAppend('shutting_down');
    try {
      if (!this.isValidSchema(signal)) return this.dropAppend('invalid_schema');
      if (!this.isValidTime(signal)) return this.dropAppend('invalid_time');
    } catch {
      return this.dropAppend('invalid_schema');
    }

    let bytes: number;
    try {
      bytes = encoder.encode(canonicalJson(signal)).byteLength;
    } catch {
      return this.dropAppend('invalid_schema');
    }
    if (bytes > 4_096) return this.dropAppend('oversize');

    const priority = isPriority(signal);
    if (!this.canAccept(bytes, priority)) {
      return this.dropAppend('queue_full');
    }

    const ingestedAtDate = this.now();
    const ingestedAt = ingestedAtDate.toISOString();
    const stored = Object.freeze({
      ...signal,
      ingestedAt,
      writeVersion: ingestedAtDate.getTime() * 1_000,
    }) as StoredObservabilitySignal;
    this.queue.push({ signal: stored, bytes, priority });
    this.queueBytes += bytes;
    return { status: 'accepted' };
  }

  async flush(timeoutMs?: number): Promise<SignalFlushResult> {
    const writtenAtStart = this.totalWritten;
    const droppedAtStart = this.totalDropped;
    const failuresAtStart = this.totalFailedDeliveries;
    const drain = this.drain();
    if (timeoutMs === undefined) {
      await drain;
      return this.resultSince(
        writtenAtStart,
        droppedAtStart,
        failuresAtStart,
        false,
      );
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = await Promise.race([
        drain.then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      return this.resultSince(
        writtenAtStart,
        droppedAtStart,
        failuresAtStart,
        !completed,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async shutdown(timeoutMs?: number): Promise<SignalFlushResult> {
    this.shuttingDown = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    const result = await this.flush(timeoutMs);
    const queuedAtTimeout = result.timedOut ? this.queue.length : 0;
    if (result.timedOut) this.dropQueued('shutdown_timeout');
    return {
      ...result,
      dropped: result.dropped + queuedAtTimeout,
    };
  }

  diagnostics(): SignalStoreDiagnostics {
    const targets = Object.fromEntries(
      [...this.targetDiagnostics.entries()].map(([name, value]) => [
        name,
        { ...value },
      ]),
    );
    return {
      state:
        this.targets.length === 0
          ? 'disabled'
          : this.blindSpotSince
            ? 'blind_spot'
            : 'available',
      queueDepth: this.queue.length,
      queueBytes: this.queueBytes,
      droppedByReason: Object.fromEntries(this.droppedByReason),
      blindSpotSince: this.blindSpotSince,
      lastAcknowledgedAt: this.lastAcknowledgedAt,
      schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      failureCode: this.lastFailureCode,
      targets,
    };
  }

  private isValidSchema(signal: ObservabilitySignal): boolean {
    if (!isRecord(signal)) return false;
    if (signal.schemaVersion !== OBSERVABILITY_SIGNAL_SCHEMA_VERSION) {
      return false;
    }
    if (signal.kind === 'span') {
      return (
        typeof signal.traceId === 'string' &&
        TRACE_ID_PATTERN.test(signal.traceId) &&
        typeof signal.spanId === 'string' &&
        SPAN_ID_PATTERN.test(signal.spanId) &&
        isNullableFixedHex(signal.parentSpanId, SPAN_ID_PATTERN) &&
        isNullableUuid(signal.runId) &&
        isNonEmptyString(signal.serviceName) &&
        isNonEmptyString(signal.serviceInstanceId) &&
        isNonEmptyString(signal.resourceKind) &&
        isNonEmptyString(signal.resourceName) &&
        isNonEmptyString(signal.operation) &&
        (signal.status === 'ok' ||
          signal.status === 'error' ||
          signal.status === 'unset') &&
        isNonEmptyString(signal.samplingReason) &&
        isSpanAttributes(signal.attributes) &&
        isNullableString(signal.correlationId) &&
        isNullableString(signal.requestId) &&
        isNullableString(signal.errorType) &&
        isTimestamp(signal.startedAt) &&
        isTimestamp(signal.finishedAt) &&
        isUnsignedInteger(signal.durationNs)
      );
    }
    if (signal.kind === 'metric_bucket') {
      return (
        isTimestamp(signal.bucketStart) &&
        isUnsignedUInt32(signal.bucketWidthSeconds) &&
        signal.bucketWidthSeconds > 0 &&
        typeof signal.seriesFingerprint === 'string' &&
        SERIES_FINGERPRINT_PATTERN.test(signal.seriesFingerprint) &&
        isUnsignedInteger(signal.flushSequence) &&
        isNonEmptyString(signal.serviceName) &&
        isNonEmptyString(signal.serviceInstanceId) &&
        isNonEmptyString(signal.resourceKind) &&
        isNonEmptyString(signal.resourceName) &&
        isNonEmptyString(signal.metricName) &&
        (signal.metricKind === 'counter' ||
          signal.metricKind === 'histogram' ||
          signal.metricKind === 'gauge') &&
        isNonEmptyString(signal.unit) &&
        isUnsignedInteger(signal.count) &&
        isFiniteNumber(signal.sum) &&
        isFiniteNumber(signal.min) &&
        isFiniteNumber(signal.max) &&
        isFiniteNumberArray(signal.histogramBoundaries) &&
        isUnsignedIntegerArray(signal.histogramCounts) &&
        signal.histogramBoundaries.length + 1 ===
          signal.histogramCounts.length &&
        isStringRecord(signal.labels)
      );
    }
    if (signal.kind === 'application_log') {
      return (
        typeof signal.id === 'string' &&
        UUID_V7_PATTERN.test(signal.id) &&
        isNonEmptyString(signal.level) &&
        isNonEmptyString(signal.channel) &&
        isNonEmptyString(signal.category) &&
        isNullableString(signal.event) &&
        isNullableString(signal.module) &&
        isNonEmptyString(signal.message) &&
        isJsonValue(signal.context) &&
        isNullableString(signal.exceptionClass) &&
        isNullableString(signal.exceptionMessage) &&
        isNullableString(signal.stackTrace) &&
        isNullableUuid(signal.actorUserId) &&
        isNullableString(signal.actorName) &&
        isNullableString(signal.actorEmail) &&
        isNullableString(signal.entityType) &&
        isNullableString(signal.entityId) &&
        isNullableString(signal.referenceNo) &&
        isNullableString(signal.branchCode) &&
        isNullableString(signal.requestId) &&
        isNullableString(signal.traceId) &&
        isNullableFixedHex(signal.runtimeTraceId, TRACE_ID_PATTERN) &&
        isNullableFixedHex(signal.runtimeSpanId, SPAN_ID_PATTERN) &&
        isNullableString(signal.sessionId) &&
        isNullableString(signal.ipAddress) &&
        isNullableString(signal.userAgent) &&
        isTimestamp(signal.occurredAt) &&
        isTimestamp(signal.createdAt)
      );
    }
    if (signal.kind === 'access_log') {
      return (
        typeof signal.id === 'string' &&
        UUID_V7_PATTERN.test(signal.id) &&
        isNonEmptyString(signal.event) &&
        isNonEmptyString(signal.outcome) &&
        isNullableString(signal.authenticationMethod) &&
        isNonEmptyString(signal.accessChannel) &&
        isNullableString(signal.guard) &&
        isNullableUuid(signal.actorUserId) &&
        isNullableString(signal.actorName) &&
        isNullableString(signal.actorEmail) &&
        isNullableString(signal.branchCode) &&
        isNullableString(signal.ipAddress) &&
        isNullableString(signal.forwardedIp) &&
        isNullableString(signal.userAgent) &&
        isNullableString(signal.deviceName) &&
        isNullableString(signal.platform) &&
        isNullableString(signal.browser) &&
        isNullableString(signal.sessionId) &&
        isNullableString(signal.requestId) &&
        isNullableString(signal.traceId) &&
        isNullableFixedHex(signal.runtimeTraceId, TRACE_ID_PATTERN) &&
        isNullableFixedHex(signal.runtimeSpanId, SPAN_ID_PATTERN) &&
        isNullableString(signal.routeName) &&
        isNullableString(signal.path) &&
        isNullableString(signal.method) &&
        (signal.httpStatus === null || isUnsignedUInt16(signal.httpStatus)) &&
        isNullableString(signal.failureReason) &&
        isJsonValue(signal.metadata) &&
        isTimestamp(signal.accessedAt) &&
        isTimestamp(signal.createdAt)
      );
    }
    return false;
  }

  private isValidTime(signal: ObservabilitySignal): boolean {
    const eventMs = Date.parse(signalTime(signal));
    if (!Number.isFinite(eventMs)) return false;
    const now = this.now().getTime();
    return eventMs >= now - retentionMs(signal) && eventMs <= now + 5 * 60_000;
  }

  private canAccept(bytes: number, priority: boolean): boolean {
    if (!priority) {
      if (bytes > this.maxBytes || this.queue.length >= this.maxItems) {
        return false;
      }
      const normalItems = this.queue.filter((item) => !item.priority).length;
      const normalBytes = this.queue
        .filter((item) => !item.priority)
        .reduce((total, item) => total + item.bytes, 0);
      return (
        this.queueBytes + bytes <= this.maxBytes &&
        normalItems < Math.floor(this.maxItems * 0.8) &&
        normalBytes + bytes <= Math.floor(this.maxBytes * 0.8)
      );
    }
    if (
      bytes > this.maxBytes ||
      this.queue.length >= this.maxItems ||
      this.queueBytes + bytes > this.maxBytes
    ) {
      this.evictNormalUntilFits(bytes);
    }
    return (
      this.queueBytes + bytes <= this.maxBytes &&
      this.queue.length < this.maxItems
    );
  }

  private evictNormalUntilFits(requiredBytes: number): void {
    while (
      (this.queue.length >= this.maxItems ||
        this.queueBytes + requiredBytes > this.maxBytes) &&
      this.queue.some((item) => !item.priority)
    ) {
      const index = this.queue.findIndex((item) => !item.priority);
      const [dropped] = this.queue.splice(index, 1);
      if (!dropped) return;
      this.queueBytes -= dropped.bytes;
      this.recordDrop('queue_full', 1);
    }
  }

  private dropAppend(
    reason: Extract<AppendResult, { status: 'dropped' }>['reason'],
  ): AppendResult {
    this.recordDrop(reason, 1);
    return { status: 'dropped', reason };
  }

  private resultSince(
    writtenAtStart: number,
    droppedAtStart: number,
    failuresAtStart: number,
    timedOut: boolean,
  ): SignalFlushResult {
    return {
      written: this.totalWritten - writtenAtStart,
      dropped: this.totalDropped - droppedAtStart,
      timedOut,
      failed: timedOut || this.totalFailedDeliveries > failuresAtStart,
    };
  }

  private async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = (async () => {
      while (this.queue.length > 0 || this.inFlight.size > 0) {
        while (this.inFlight.size < this.maxInFlight) {
          const batch = this.takeBatch();
          if (!batch) break;
          const delivery = this.deliver(batch).finally(() => {
            this.inFlight.delete(delivery);
          });
          this.inFlight.add(delivery);
        }
        if (this.inFlight.size > 0) await Promise.race(this.inFlight);
      }
    })().finally(() => {
      this.drainPromise = undefined;
    });
    return this.drainPromise;
  }

  private takeBatch(): SignalBatch | null {
    if (this.queue.length === 0) return null;
    let kind: SignalKind | undefined;
    for (let offset = 0; offset < SIGNAL_KINDS.length; offset += 1) {
      const candidate =
        SIGNAL_KINDS[(this.nextKindIndex.value + offset) % SIGNAL_KINDS.length];
      if (this.queue.some((item) => item.signal.kind === candidate)) {
        kind = candidate;
        this.nextKindIndex.value =
          (this.nextKindIndex.value + offset + 1) % SIGNAL_KINDS.length;
        break;
      }
    }
    if (!kind) return null;

    const selected: QueuedSignal[] = [];
    let selectedBytes = 0;
    for (let index = 0; index < this.queue.length; ) {
      const item = this.queue[index];
      if (
        item?.signal.kind === kind &&
        selected.length < this.batchMaxItems &&
        selectedBytes + item.bytes <= this.batchMaxBytes
      ) {
        selected.push(item);
        selectedBytes += item.bytes;
        this.queue.splice(index, 1);
        continue;
      }
      index += 1;
    }
    if (selected.length === 0) return null;
    this.queueBytes -= selectedBytes;
    return {
      id: Bun.randomUUIDv7(),
      kind,
      signals: selected.map((item) => item.signal),
    };
  }

  private async deliver(
    batch: SignalBatch,
    pendingTargets: readonly SignalTarget[] = this.targets,
  ): Promise<DeliveryOutcome> {
    const outcomes = await Promise.all(
      pendingTargets.map(async (target): Promise<TargetWriteOutcome> => {
        try {
          await this.writeWithRetry(target, batch);
          return { target, status: 'acknowledged' };
        } catch (error) {
          return { target, status: 'failed', error };
        }
      }),
    );
    const failures = outcomes.filter(
      (outcome): outcome is FailedTargetWrite => outcome.status === 'failed',
    );

    if (failures.length === 0) {
      this.totalWritten += batch.signals.length;
      this.lastAcknowledgedAt = this.now().toISOString();
      this.blindSpotSince = null;
      this.lastFailureCode = null;
      return { written: batch.signals.length, dropped: 0, failed: false };
    }

    const code = failureCode(failures[0]?.error);
    const allRowSpecific = failures.every((failure) =>
      isRowSpecific(failure.error),
    );
    this.totalFailedDeliveries += 1;
    this.lastFailureCode = code;
    for (const failure of failures) {
      this.recordTargetFailure(failure.target, failureCode(failure.error));
    }

    if (allRowSpecific && batch.signals.length > 1) {
      const [leftBatch, rightBatch] = this.splitBatch(batch);
      const unresolvedTargets = failures.map((failure) => failure.target);
      const left = await this.deliver(leftBatch, unresolvedTargets);
      const right = await this.deliver(rightBatch, unresolvedTargets);
      return {
        written: left.written + right.written,
        dropped: left.dropped + right.dropped,
        failed: true,
      };
    }

    this.recordDrop(
      allRowSpecific ? 'poison' : 'delivery_failed',
      batch.signals.length,
    );
    console.error('[observability] signal delivery failed', {
      code,
      kind: batch.kind,
      batchId: batch.id,
      count: batch.signals.length,
    });
    for (const failure of failures) {
      const diagnostics = this.targetDiagnostics.get(failure.target.name);
      if (diagnostics) diagnostics.dropped += batch.signals.length;
    }
    return { written: 0, dropped: batch.signals.length, failed: true };
  }

  private splitBatch(batch: SignalBatch): readonly [SignalBatch, SignalBatch] {
    const midpoint = Math.ceil(batch.signals.length / 2);
    return [
      {
        id: Bun.randomUUIDv7(),
        kind: batch.kind,
        signals: batch.signals.slice(0, midpoint),
      },
      {
        id: Bun.randomUUIDv7(),
        kind: batch.kind,
        signals: batch.signals.slice(midpoint),
      },
    ];
  }

  private async writeWithRetry(
    target: SignalTarget,
    batch: SignalBatch,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      try {
        await target.write(batch);
        const diagnostics = this.targetDiagnostics.get(target.name);
        if (diagnostics) {
          diagnostics.written += batch.signals.length;
          diagnostics.lastAcknowledgedAt = this.now().toISOString();
          diagnostics.failureCode = null;
        }
        return;
      } catch (error) {
        lastError = error;
        if (!isTransient(error) || attempt === this.retryLimit) break;
        await wait(20 * 2 ** attempt + Math.floor(Math.random() * 20));
      }
    }
    throw lastError;
  }

  private recordTargetFailure(target: SignalTarget, code: string): void {
    const diagnostics = this.targetDiagnostics.get(target.name);
    if (diagnostics) diagnostics.failureCode = code;
  }

  private recordDrop(reason: string, count: number): void {
    this.totalDropped += count;
    this.droppedByReason.set(
      reason,
      (this.droppedByReason.get(reason) ?? 0) + count,
    );
    if (reason !== 'disabled' && this.blindSpotSince === null) {
      this.blindSpotSince = this.now().toISOString();
    }
  }

  private dropQueued(reason: string): void {
    const count = this.queue.length;
    this.queue.length = 0;
    this.queueBytes = 0;
    if (count > 0) this.recordDrop(reason, count);
  }
}
