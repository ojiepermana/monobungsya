import { describe, expect, test } from 'bun:test';
import {
  canonicalBackfillParity,
  canonicalBackfillRecord,
  deterministicBackfillBatchToken,
  type SignalBackfillBatch,
  type SignalBackfillControl,
  type SignalBackfillGuard,
  SignalBackfillOrchestrator,
  type SignalBackfillPage,
  type SignalBackfillPageRequest,
  type SignalBackfillParity,
  type SignalBackfillRange,
  type SignalBackfillRunInput,
  type SignalBackfillSource,
  type SignalBackfillTarget,
  type SignalMigrationRun,
} from './backfill';
import {
  type ApplicationLogSignal,
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignal,
} from './types';

const BACKFILL_DAY = '2026-08-25';
function applicationLog(
  id: string,
  occurredAt: string,
  overrides: Partial<ApplicationLogSignal> = {},
): ApplicationLogSignal {
  return {
    kind: 'application_log',
    id,
    level: 'info',
    channel: 'application',
    category: 'application',
    event: null,
    module: null,
    message: 'ok',
    context: { source: 'postgres' },
    exceptionClass: null,
    exceptionMessage: null,
    stackTrace: null,
    actorUserId: null,
    actorName: null,
    actorEmail: null,
    entityType: null,
    entityId: null,
    referenceNo: null,
    branchCode: null,
    requestId: null,
    traceId: null,
    runtimeTraceId: null,
    runtimeSpanId: null,
    sessionId: null,
    ipAddress: null,
    userAgent: null,
    occurredAt,
    createdAt: occurredAt,
    schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    ...overrides,
  };
}

class MemoryControl implements SignalBackfillControl {
  run: SignalMigrationRun | undefined;
  readonly checkpoints: Array<{
    sourceCursor: Record<string, unknown> | null;
    sourceCount: number;
  }> = [];
  readonly operations: string[] = [];

  async getOrCreate(
    input: SignalBackfillRunInput,
  ): Promise<SignalMigrationRun> {
    if (!this.run) {
      this.run = {
        runId: '01812345-6789-7abc-8def-0123456789ab',
        kind: input.kind,
        schemaVersion: input.schemaVersion,
        sourceFrom: input.sourceFrom,
        sourceTo: input.sourceTo,
        sourceCursor: null,
        sourceCount: 0,
        targetCount: 0,
        sampleModulus: input.sampleModulus,
        sourceChecksum: null,
        targetChecksum: null,
        status: 'pending',
        errorCode: null,
      };
    }
    return { ...this.run };
  }

  async markRunning(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    run.status = 'running';
    run.errorCode = null;
    this.operations.push('running');
  }

  async checkpoint(
    runId: string,
    checkpoint: {
      sourceCursor: Record<string, unknown> | null;
      sourceCount: number;
    },
  ): Promise<void> {
    const run = this.requireRun(runId);
    run.sourceCursor = checkpoint.sourceCursor;
    run.sourceCount = checkpoint.sourceCount;
    this.checkpoints.push(checkpoint);
    this.operations.push('checkpoint');
  }

  async pause(runId: string, errorCode: string): Promise<void> {
    const run = this.requireRun(runId);
    run.status = 'paused';
    run.errorCode = errorCode;
    this.operations.push(`pause:${errorCode}`);
  }

  async fail(
    runId: string,
    errorCode: string,
    completion?: {
      sourceCount: number;
      targetCount: number;
      sourceChecksum: string;
      targetChecksum: string;
    },
  ): Promise<void> {
    const run = this.requireRun(runId);
    if (completion) Object.assign(run, completion);
    run.status = 'failed';
    run.errorCode = errorCode;
    this.operations.push(`fail:${errorCode}`);
  }

  async succeed(
    runId: string,
    completion: {
      sourceCount: number;
      targetCount: number;
      sourceChecksum: string;
      targetChecksum: string;
    },
  ): Promise<void> {
    const run = this.requireRun(runId);
    Object.assign(run, completion, { status: 'succeeded', errorCode: null });
    this.operations.push('succeeded');
  }

  private requireRun(runId: string): SignalMigrationRun {
    if (!this.run || this.run.runId !== runId) {
      throw new Error('unknown memory backfill run');
    }
    return this.run;
  }
}

class MemorySource implements SignalBackfillSource {
  readonly requests: SignalBackfillPageRequest[] = [];

  constructor(private readonly signals: readonly ObservabilitySignal[]) {}

  async readPage(
    input: SignalBackfillPageRequest,
  ): Promise<SignalBackfillPage> {
    this.requests.push(input);
    const index = input.cursor?.index;
    const offset = typeof index === 'number' ? index : 0;
    const signals = this.signals.slice(offset, offset + input.limit);
    const nextIndex = offset + signals.length;
    return {
      signals,
      nextCursor: nextIndex < this.signals.length ? { index: nextIndex } : null,
    };
  }

  async canonicalParity(
    input: SignalBackfillRange,
  ): Promise<SignalBackfillParity> {
    return canonicalBackfillParity(
      this.signals.map((signal) => ({
        ...signal,
        schemaVersion: input.schemaVersion,
      })),
      input.sampleModulus,
    );
  }
}

class MemoryTarget implements SignalBackfillTarget {
  readonly batches: SignalBackfillBatch[] = [];
  readonly attemptedBatches: SignalBackfillBatch[] = [];
  readonly attemptedTokens: string[] = [];
  failuresRemaining = 0;
  parityOverride: SignalBackfillParity | undefined;

  async write(batch: SignalBackfillBatch): Promise<void> {
    this.attemptedBatches.push(batch);
    this.attemptedTokens.push(batch.token);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('clickhouse unavailable');
    }
    this.batches.push(batch);
  }

  async canonicalParity(
    input: SignalBackfillRange,
  ): Promise<SignalBackfillParity> {
    if (this.parityOverride) return this.parityOverride;
    return canonicalBackfillParity(
      this.batches.flatMap((batch) => batch.signals),
      input.sampleModulus,
    );
  }
}

function readyGuard(): SignalBackfillGuard {
  return { check: async () => ({ status: 'ready' }) };
}

function orchestrator(
  control: MemoryControl,
  source: MemorySource,
  target: MemoryTarget,
  guard: SignalBackfillGuard = readyGuard(),
): SignalBackfillOrchestrator {
  return new SignalBackfillOrchestrator({
    control,
    source,
    target,
    guard,
    pageSize: 1,
  });
}

describe('SignalBackfillOrchestrator', () => {
  test('commits each bounded cursor only after ClickHouse acknowledges it', async () => {
    const control = new MemoryControl();
    const source = new MemorySource([
      applicationLog(
        '01812345-6789-7abc-8def-0123456789a1',
        '2026-08-25T00:00:01.000Z',
      ),
      applicationLog(
        '01812345-6789-7abc-8def-0123456789a2',
        '2026-08-25T00:00:02.000Z',
      ),
    ]);
    const target = new MemoryTarget();

    await expect(
      orchestrator(control, source, target).run({
        kind: 'application_log',
        sourceDay: BACKFILL_DAY,
      }),
    ).resolves.toEqual({
      runId: '01812345-6789-7abc-8def-0123456789ab',
      status: 'succeeded',
      sourceCount: 2,
      targetCount: 2,
      errorCode: null,
    });

    expect(control.operations).toEqual([
      'running',
      'checkpoint',
      'checkpoint',
      'succeeded',
    ]);
    expect(control.checkpoints).toEqual([
      { sourceCursor: { index: 1 }, sourceCount: 1 },
      { sourceCursor: null, sourceCount: 2 },
    ]);
    expect(target.batches).toHaveLength(2);
    expect(target.batches[0]?.signals[0]).toMatchObject({
      schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      ingestedAt: '2026-08-25T00:00:01.000Z',
      writeVersion: 1_787_616_001_000_000,
    });
    expect(
      target.attemptedTokens.every((token) => /^[0-9a-f]{64}$/.test(token)),
    ).toBe(true);
  });

  test('reuses deterministic token and payload after an unacknowledged write', async () => {
    const control = new MemoryControl();
    const source = new MemorySource([
      applicationLog(
        '01812345-6789-7abc-8def-0123456789a1',
        '2026-08-25T00:00:01.000Z',
      ),
    ]);
    const target = new MemoryTarget();
    target.failuresRemaining = 1;
    const subject = orchestrator(control, source, target);

    await expect(
      subject.run({ kind: 'application_log', sourceDay: BACKFILL_DAY }),
    ).resolves.toMatchObject({
      status: 'paused',
      sourceCount: 0,
      errorCode: 'backfill_target_unacknowledged',
    });
    expect(control.checkpoints).toEqual([]);
    expect(control.run?.sourceCursor).toBeNull();

    await expect(
      subject.run({ kind: 'application_log', sourceDay: BACKFILL_DAY }),
    ).resolves.toMatchObject({ status: 'succeeded', sourceCount: 1 });
    expect(target.attemptedTokens).toHaveLength(2);
    expect(target.attemptedTokens[0]).toBe(target.attemptedTokens[1]);
    expect(target.attemptedBatches[0]).toEqual(target.attemptedBatches[1]);
    expect(source.requests.map((request) => request.cursor)).toEqual([
      null,
      null,
    ]);
    expect(control.checkpoints).toEqual([
      { sourceCursor: null, sourceCount: 1 },
    ]);
  });

  test('pauses before source work when an injected disk guard blocks backfill', async () => {
    const control = new MemoryControl();
    const source = new MemorySource([
      applicationLog(
        '01812345-6789-7abc-8def-0123456789a1',
        '2026-08-25T00:00:01.000Z',
      ),
    ]);
    const target = new MemoryTarget();

    await expect(
      orchestrator(control, source, target, {
        check: async () => ({ status: 'blocked', code: 'disk_usage' }),
      }).run({ kind: 'application_log', sourceDay: BACKFILL_DAY }),
    ).resolves.toMatchObject({
      status: 'paused',
      sourceCount: 0,
      errorCode: 'backfill_guard_disk_usage',
    });
    expect(source.requests).toEqual([]);
    expect(target.batches).toEqual([]);
    expect(control.checkpoints).toEqual([]);
  });

  test('fails a range when source order violates the stable key contract', async () => {
    const control = new MemoryControl();
    const source = new MemorySource([
      applicationLog(
        '01812345-6789-7abc-8def-0123456789a2',
        '2026-08-25T00:00:02.000Z',
      ),
      applicationLog(
        '01812345-6789-7abc-8def-0123456789a1',
        '2026-08-25T00:00:01.000Z',
      ),
    ]);
    const target = new MemoryTarget();

    await expect(
      new SignalBackfillOrchestrator({
        control,
        source,
        target,
        guard: readyGuard(),
        pageSize: 2,
      }).run({ kind: 'application_log', sourceDay: BACKFILL_DAY }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'backfill_source_invalid',
    });
    expect(target.batches).toEqual([]);
  });

  test('persists canonical count and checksum evidence when parity fails', async () => {
    const signal = applicationLog(
      '01812345-6789-7abc-8def-0123456789a1',
      '2026-08-25T00:00:01.000Z',
    );
    const control = new MemoryControl();
    const source = new MemorySource([signal]);
    const target = new MemoryTarget();
    target.parityOverride = canonicalBackfillParity([]);

    await expect(
      orchestrator(control, source, target).run({
        kind: 'application_log',
        sourceDay: BACKFILL_DAY,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      sourceCount: 1,
      targetCount: 0,
      errorCode: 'backfill_parity_mismatch',
    });
    expect(control.run).toMatchObject({
      status: 'failed',
      sourceCount: 1,
      targetCount: 0,
      sourceChecksum: canonicalBackfillParity([signal]).checksum,
      targetChecksum: canonicalBackfillParity([]).checksum,
    });
  });
});

describe('canonical backfill evidence', () => {
  test('excludes retry metadata and keeps tokens stable for equivalent cursor objects', () => {
    const signal = applicationLog(
      '01812345-6789-7abc-8def-0123456789a1',
      '2026-08-25T00:00:01.000Z',
      { context: { nested: { b: 2, a: 1 } } },
    );
    const retried = {
      ...signal,
      ingestedAt: '2026-08-26T12:00:00.000Z',
      writeVersion: 1,
    };

    expect(canonicalBackfillRecord(retried)).toBe(
      canonicalBackfillRecord(signal),
    );
    expect(canonicalBackfillParity([retried])).toEqual(
      canonicalBackfillParity([signal]),
    );
    const token = deterministicBackfillBatchToken({
      kind: 'application_log',
      sourceDay: BACKFILL_DAY,
      schemaVersion: 1,
      cursor: { id: 'a', at: 1 },
      nextCursor: { id: 'b', at: 2 },
      signals: [signal],
    });
    expect(
      deterministicBackfillBatchToken({
        kind: 'application_log',
        sourceDay: BACKFILL_DAY,
        schemaVersion: 1,
        cursor: { at: 1, id: 'a' },
        nextCursor: { at: 2, id: 'b' },
        signals: [signal],
      }),
    ).toBe(token);
    expect(canonicalBackfillParity([signal]).sampleCount).toBe(1);
  });
});
