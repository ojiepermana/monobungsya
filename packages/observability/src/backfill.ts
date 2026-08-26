import { createHash } from 'node:crypto';
import { canonicalJson } from './store';
import {
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignal,
  type SignalKind,
  type StoredObservabilitySignal,
} from './types';

const MAX_BACKFILL_PAGE_SIZE = 5_000;
const DEFAULT_BACKFILL_PAGE_SIZE = 1_000;
const DEFAULT_SAMPLE_MODULUS = 1_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_GUARD_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

export type SignalBackfillCursor = Readonly<Record<string, unknown>>;

export type SignalMigrationRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed';

/**
 * The Control record for one immutable Signal kind and one UTC source day.
 * `sourceCursor` is written only after the target acknowledges its batch.
 */
export interface SignalMigrationRun {
  runId: string;
  kind: SignalKind;
  schemaVersion: number;
  sourceFrom: string;
  sourceTo: string;
  sourceCursor: SignalBackfillCursor | null;
  sourceCount: number;
  targetCount: number;
  sampleModulus: number;
  sourceChecksum: string | null;
  targetChecksum: string | null;
  status: SignalMigrationRunStatus;
  errorCode: string | null;
}

export interface SignalBackfillRange {
  kind: SignalKind;
  schemaVersion: number;
  sourceDay: string;
  sourceFrom: string;
  sourceTo: string;
  sampleModulus: number;
}

export interface SignalBackfillRunInput extends SignalBackfillRange {}

export interface SignalBackfillCheckpoint {
  sourceCursor: SignalBackfillCursor | null;
  sourceCount: number;
}

export interface SignalBackfillCompletion {
  sourceCount: number;
  targetCount: number;
  sourceChecksum: string;
  targetChecksum: string;
}

/**
 * The Control seam is intentionally small. Its PostgreSQL adapter owns the
 * `telemetry.signal_migration_runs` table, while the orchestrator owns every
 * ordering and acknowledgement invariant.
 */
export interface SignalBackfillControl {
  getOrCreate(input: SignalBackfillRunInput): Promise<SignalMigrationRun>;
  markRunning(runId: string): Promise<void>;
  checkpoint(
    runId: string,
    checkpoint: SignalBackfillCheckpoint,
  ): Promise<void>;
  pause(runId: string, errorCode: string): Promise<void>;
  fail(
    runId: string,
    errorCode: string,
    completion?: SignalBackfillCompletion,
  ): Promise<void>;
  succeed(runId: string, completion: SignalBackfillCompletion): Promise<void>;
}

export interface SignalBackfillPageRequest extends SignalBackfillRange {
  cursor: SignalBackfillCursor | null;
  limit: number;
}

export interface SignalBackfillPage {
  signals: readonly ObservabilitySignal[];
  nextCursor: SignalBackfillCursor | null;
}

export interface SignalBackfillParity {
  /** The number of latest stable identities in the full source day. */
  count: number;
  /** The number of records selected by the deterministic sample rule. */
  sampleCount: number;
  /** SHA 256 of sorted canonical sampled records. */
  checksum: string;
}

export interface SignalBackfillParityRequest extends SignalBackfillRange {}

/**
 * Source adapters must use a stable event time plus stable identity order.
 * Their parity result must use canonicalBackfillParity semantics.
 */
export interface SignalBackfillSource {
  readPage(input: SignalBackfillPageRequest): Promise<SignalBackfillPage>;
  canonicalParity(
    input: SignalBackfillParityRequest,
  ): Promise<SignalBackfillParity>;
}

export interface SignalBackfillBatch {
  /** Stable across retries and process restarts for this page boundary. */
  token: string;
  kind: SignalKind;
  signals: readonly StoredObservabilitySignal[];
}

/**
 * The target adapter resolves only after ClickHouse acknowledges the async
 * insert. The same adapter reports parity over latest stable identities.
 */
export interface SignalBackfillTarget {
  write(batch: SignalBackfillBatch): Promise<void>;
  canonicalParity(
    input: SignalBackfillParityRequest,
  ): Promise<SignalBackfillParity>;
}

export type SignalBackfillGuardResult =
  | { status: 'ready' }
  | { status: 'blocked'; code: string };

/**
 * Backfill guards represent live availability, freshness, query SLO, queue,
 * and disk checks. A blocked or unavailable guard never advances the cursor.
 */
export interface SignalBackfillGuard {
  check(range: SignalBackfillRange): Promise<SignalBackfillGuardResult>;
}

export interface SignalBackfillOrchestratorOptions {
  control: SignalBackfillControl;
  source: SignalBackfillSource;
  target: SignalBackfillTarget;
  guard: SignalBackfillGuard;
  pageSize?: number;
  sampleModulus?: number;
}

export interface SignalBackfillRequest {
  kind: SignalKind;
  /** A calendar day in UTC, for example 2026-08-26. */
  sourceDay: string;
  schemaVersion?: number;
}

export interface SignalBackfillResult {
  runId: string;
  status: 'succeeded' | 'paused' | 'failed';
  sourceCount: number;
  targetCount: number;
  errorCode: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertPositiveInteger(
  value: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(
      `${name} must be a positive integer no greater than ${maximum}`,
    );
  }
}

function dayRange(
  sourceDay: string,
): Pick<SignalBackfillRange, 'sourceDay' | 'sourceFrom' | 'sourceTo'> {
  if (!UTC_DAY_PATTERN.test(sourceDay)) {
    throw new Error('sourceDay must use YYYY-MM-DD UTC format');
  }
  const sourceFromDate = new Date(`${sourceDay}T00:00:00.000Z`);
  if (
    Number.isNaN(sourceFromDate.getTime()) ||
    sourceFromDate.toISOString().slice(0, 10) !== sourceDay
  ) {
    throw new Error('sourceDay must be a real UTC calendar day');
  }
  const sourceToDate = new Date(sourceFromDate);
  sourceToDate.setUTCDate(sourceToDate.getUTCDate() + 1);
  return {
    sourceDay,
    sourceFrom: sourceFromDate.toISOString(),
    sourceTo: sourceToDate.toISOString(),
  };
}

function eventTime(signal: ObservabilitySignal): string {
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

function normalizedTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Signal event time must be a valid timestamp');
  }
  return timestamp.toISOString();
}

function normalizedPublicSignal(
  signal: ObservabilitySignal | StoredObservabilitySignal,
): ObservabilitySignal {
  const {
    ingestedAt: _ingestedAt,
    writeVersion: _writeVersion,
    ...publicFields
  } = signal as StoredObservabilitySignal;
  switch (publicFields.kind) {
    case 'span':
      return {
        ...publicFields,
        startedAt: normalizedTimestamp(publicFields.startedAt),
        finishedAt: normalizedTimestamp(publicFields.finishedAt),
      };
    case 'metric_bucket':
      return {
        ...publicFields,
        bucketStart: normalizedTimestamp(publicFields.bucketStart),
      };
    case 'application_log':
      return {
        ...publicFields,
        occurredAt: normalizedTimestamp(publicFields.occurredAt),
        createdAt: normalizedTimestamp(publicFields.createdAt),
      };
    case 'access_log':
      return {
        ...publicFields,
        accessedAt: normalizedTimestamp(publicFields.accessedAt),
        createdAt: normalizedTimestamp(publicFields.createdAt),
      };
  }
}

/** Stable identity used for source ordering, sampling, and page tokens. */
export function stableSignalIdentity(
  signal: ObservabilitySignal | StoredObservabilitySignal,
): string {
  switch (signal.kind) {
    case 'span':
      return canonicalJson({
        traceId: signal.traceId,
        spanId: signal.spanId,
        startedAt: normalizedTimestamp(signal.startedAt),
      });
    case 'metric_bucket':
      return canonicalJson({
        bucketStart: normalizedTimestamp(signal.bucketStart),
        seriesFingerprint: signal.seriesFingerprint,
      });
    case 'application_log':
      return canonicalJson({
        id: signal.id,
        occurredAt: normalizedTimestamp(signal.occurredAt),
      });
    case 'access_log':
      return canonicalJson({
        id: signal.id,
        accessedAt: normalizedTimestamp(signal.accessedAt),
      });
  }
}

/**
 * Canonical public row form for parity. Ingestion metadata is intentionally
 * excluded, because it changes with a retry without changing source truth.
 */
export function canonicalBackfillRecord(
  signal: ObservabilitySignal | StoredObservabilitySignal,
): string {
  return canonicalJson(normalizedPublicSignal(signal));
}

export function stableSampleModulo(
  identity: string,
  modulus = DEFAULT_SAMPLE_MODULUS,
): number {
  assertPositiveInteger(modulus, 'sampleModulus');
  const prefix = sha256(identity).slice(0, 16);
  return Number(BigInt(`0x${prefix}`) % BigInt(modulus));
}

/**
 * Builds parity over canonical records. A short range samples every record;
 * otherwise it selects stable identities whose hash modulo is zero.
 */
export function canonicalBackfillParity(
  signals: readonly (ObservabilitySignal | StoredObservabilitySignal)[],
  sampleModulus = DEFAULT_SAMPLE_MODULUS,
): SignalBackfillParity {
  assertPositiveInteger(sampleModulus, 'sampleModulus');
  const checkEveryRow = signals.length < sampleModulus;
  const sampled = signals
    .filter(
      (signal) =>
        checkEveryRow ||
        stableSampleModulo(stableSignalIdentity(signal), sampleModulus) === 0,
    )
    .map((signal) => canonicalBackfillRecord(signal))
    .sort();
  return {
    count: signals.length,
    sampleCount: sampled.length,
    checksum: sha256(sampled.join('\n')),
  };
}

export interface DeterministicBackfillBatchTokenInput {
  kind: SignalKind;
  sourceDay: string;
  schemaVersion: number;
  cursor: SignalBackfillCursor | null;
  nextCursor: SignalBackfillCursor | null;
  signals: readonly (ObservabilitySignal | StoredObservabilitySignal)[];
}

/**
 * This token intentionally contains no run ID, clock value, or random value.
 * A retry of the same committed page therefore reaches ClickHouse with the
 * same deduplication token.
 */
export function deterministicBackfillBatchToken(
  input: DeterministicBackfillBatchTokenInput,
): string {
  const first = input.signals[0];
  const last = input.signals.at(-1);
  if (!first || !last) {
    throw new Error('A deterministic backfill token requires a nonempty page');
  }
  return sha256(
    canonicalJson({
      protocol: 'observability-backfill-v1',
      kind: input.kind,
      sourceDay: input.sourceDay,
      schemaVersion: input.schemaVersion,
      cursor: input.cursor,
      nextCursor: input.nextCursor,
      first: stableSignalIdentity(first),
      last: stableSignalIdentity(last),
    }),
  );
}

function compareSignals(
  left: ObservabilitySignal,
  right: ObservabilitySignal,
): number {
  const leftTime = normalizedTimestamp(eventTime(left));
  const rightTime = normalizedTimestamp(eventTime(right));
  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  const leftIdentity = stableSignalIdentity(left);
  const rightIdentity = stableSignalIdentity(right);
  if (leftIdentity < rightIdentity) return -1;
  if (leftIdentity > rightIdentity) return 1;
  return 0;
}

function assertPage(
  page: SignalBackfillPage,
  range: SignalBackfillRange,
  pageSize: number,
  cursor: SignalBackfillCursor | null,
): void {
  if (page.signals.length > pageSize) {
    throw new Error('Signal backfill source exceeded its bounded page size');
  }
  if (page.signals.length === 0 && page.nextCursor !== null) {
    throw new Error('Signal backfill source returned an empty advancing page');
  }
  if (
    cursor !== null &&
    page.nextCursor !== null &&
    canonicalJson(cursor) === canonicalJson(page.nextCursor)
  ) {
    throw new Error('Signal backfill source cursor did not advance');
  }

  const sourceFrom = Date.parse(range.sourceFrom);
  const sourceTo = Date.parse(range.sourceTo);
  let previous: ObservabilitySignal | undefined;
  for (const signal of page.signals) {
    if (signal.kind !== range.kind) {
      throw new Error('Signal backfill source mixed signal kinds');
    }
    const signalTimestamp = Date.parse(eventTime(signal));
    if (
      Number.isNaN(signalTimestamp) ||
      signalTimestamp < sourceFrom ||
      signalTimestamp >= sourceTo
    ) {
      throw new Error(
        'Signal backfill source returned a signal outside its UTC day',
      );
    }
    if (previous && compareSignals(previous, signal) >= 0) {
      throw new Error('Signal backfill source order is not strictly stable');
    }
    previous = signal;
  }
}

function parityIsValid(parity: SignalBackfillParity): boolean {
  return (
    Number.isSafeInteger(parity.count) &&
    parity.count >= 0 &&
    Number.isSafeInteger(parity.sampleCount) &&
    parity.sampleCount >= 0 &&
    parity.sampleCount <= parity.count &&
    SHA256_PATTERN.test(parity.checksum)
  );
}

function parityMatches(
  source: SignalBackfillParity,
  target: SignalBackfillParity,
  expectedSourceCount: number,
): boolean {
  return (
    parityIsValid(source) &&
    parityIsValid(target) &&
    source.count === expectedSourceCount &&
    source.count === target.count &&
    source.sampleCount === target.sampleCount &&
    source.checksum === target.checksum
  );
}

function guardFailureCode(code: string): string {
  return SAFE_GUARD_CODE_PATTERN.test(code)
    ? `backfill_guard_${code}`
    : 'backfill_guard_blocked';
}

function storedSignals(
  signals: readonly ObservabilitySignal[],
  schemaVersion: number,
): readonly StoredObservabilitySignal[] {
  return signals.map((signal) => {
    const ingestedAt = deterministicIngestedAt(signal);
    const writeVersion = new Date(ingestedAt).getTime() * 1_000;
    return Object.freeze({
      ...signal,
      schemaVersion,
      ingestedAt,
      writeVersion,
    }) as StoredObservabilitySignal;
  });
}

function deterministicIngestedAt(signal: ObservabilitySignal): string {
  switch (signal.kind) {
    case 'span':
      return normalizedTimestamp(signal.startedAt);
    case 'metric_bucket':
      return normalizedTimestamp(signal.bucketStart);
    case 'application_log':
      return normalizedTimestamp(signal.createdAt);
    case 'access_log':
      return normalizedTimestamp(signal.createdAt);
  }
}

function resultForRun(run: SignalMigrationRun): SignalBackfillResult {
  return {
    runId: run.runId,
    status: run.status === 'succeeded' ? 'succeeded' : 'failed',
    sourceCount: run.sourceCount,
    targetCount: run.targetCount,
    errorCode: run.errorCode,
  };
}

/**
 * A bounded one day orchestrator. It owns the committed cursor invariant:
 * source cursor progress follows, never precedes, a ClickHouse acknowledgement.
 */
export class SignalBackfillOrchestrator {
  private readonly control: SignalBackfillControl;
  private readonly source: SignalBackfillSource;
  private readonly target: SignalBackfillTarget;
  private readonly guard: SignalBackfillGuard;
  private readonly pageSize: number;
  private readonly sampleModulus: number;

  constructor(options: SignalBackfillOrchestratorOptions) {
    this.control = options.control;
    this.source = options.source;
    this.target = options.target;
    this.guard = options.guard;
    this.pageSize = options.pageSize ?? DEFAULT_BACKFILL_PAGE_SIZE;
    this.sampleModulus = options.sampleModulus ?? DEFAULT_SAMPLE_MODULUS;
    assertPositiveInteger(this.pageSize, 'pageSize', MAX_BACKFILL_PAGE_SIZE);
    assertPositiveInteger(this.sampleModulus, 'sampleModulus');
  }

  async run(input: SignalBackfillRequest): Promise<SignalBackfillResult> {
    const range: SignalBackfillRange = {
      ...dayRange(input.sourceDay),
      kind: input.kind,
      schemaVersion: input.schemaVersion ?? OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      sampleModulus: this.sampleModulus,
    };
    assertPositiveInteger(range.schemaVersion, 'schemaVersion');

    const run = await this.control.getOrCreate(range);
    if (run.status === 'succeeded' || run.status === 'failed') {
      return resultForRun(run);
    }
    await this.control.markRunning(run.runId);

    let cursor = run.sourceCursor;
    let sourceCount = run.sourceCount;
    while (true) {
      const guard = await this.checkGuard(range, run.runId, sourceCount);
      if (guard) return guard;

      let page: SignalBackfillPage;
      try {
        page = await this.source.readPage({
          ...range,
          cursor,
          limit: this.pageSize,
        });
        assertPage(page, range, this.pageSize, cursor);
      } catch {
        await this.control.fail(run.runId, 'backfill_source_invalid');
        return {
          runId: run.runId,
          status: 'failed',
          sourceCount,
          targetCount: 0,
          errorCode: 'backfill_source_invalid',
        };
      }

      if (page.signals.length === 0) {
        return await this.finish(range, run.runId, sourceCount);
      }

      const token = deterministicBackfillBatchToken({
        kind: range.kind,
        sourceDay: range.sourceDay,
        schemaVersion: range.schemaVersion,
        cursor,
        nextCursor: page.nextCursor,
        signals: page.signals,
      });
      try {
        await this.target.write({
          token,
          kind: range.kind,
          signals: storedSignals(page.signals, range.schemaVersion),
        });
      } catch {
        await this.control.pause(run.runId, 'backfill_target_unacknowledged');
        return {
          runId: run.runId,
          status: 'paused',
          sourceCount,
          targetCount: 0,
          errorCode: 'backfill_target_unacknowledged',
        };
      }

      sourceCount += page.signals.length;
      await this.control.checkpoint(run.runId, {
        sourceCursor: page.nextCursor,
        sourceCount,
      });
      cursor = page.nextCursor;
      if (cursor === null) {
        const guard = await this.checkGuard(range, run.runId, sourceCount);
        if (guard) return guard;
        return await this.finish(range, run.runId, sourceCount);
      }
    }
  }

  private async checkGuard(
    range: SignalBackfillRange,
    runId: string,
    sourceCount: number,
  ): Promise<SignalBackfillResult | undefined> {
    let result: SignalBackfillGuardResult;
    try {
      result = await this.guard.check(range);
    } catch {
      await this.control.pause(runId, 'backfill_guard_unavailable');
      return {
        runId,
        status: 'paused',
        sourceCount,
        targetCount: 0,
        errorCode: 'backfill_guard_unavailable',
      };
    }
    if (result.status === 'ready') return undefined;
    const errorCode = guardFailureCode(result.code);
    await this.control.pause(runId, errorCode);
    return {
      runId,
      status: 'paused',
      sourceCount,
      targetCount: 0,
      errorCode,
    };
  }

  private async finish(
    range: SignalBackfillRange,
    runId: string,
    sourceCount: number,
  ): Promise<SignalBackfillResult> {
    let source: SignalBackfillParity;
    let target: SignalBackfillParity;
    try {
      [source, target] = await Promise.all([
        this.source.canonicalParity(range),
        this.target.canonicalParity(range),
      ]);
    } catch {
      await this.control.pause(runId, 'backfill_parity_unavailable');
      return {
        runId,
        status: 'paused',
        sourceCount,
        targetCount: 0,
        errorCode: 'backfill_parity_unavailable',
      };
    }

    if (!parityMatches(source, target, sourceCount)) {
      await this.control.fail(runId, 'backfill_parity_mismatch', {
        sourceCount: source.count,
        targetCount: target.count,
        sourceChecksum: source.checksum,
        targetChecksum: target.checksum,
      });
      return {
        runId,
        status: 'failed',
        sourceCount,
        targetCount: target.count,
        errorCode: 'backfill_parity_mismatch',
      };
    }

    await this.control.succeed(runId, {
      sourceCount: source.count,
      targetCount: target.count,
      sourceChecksum: source.checksum,
      targetChecksum: target.checksum,
    });
    return {
      runId,
      status: 'succeeded',
      sourceCount: source.count,
      targetCount: target.count,
      errorCode: null,
    };
  }
}
