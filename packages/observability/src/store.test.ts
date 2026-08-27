import { describe, expect, test } from 'bun:test';
import {
  BufferedObservabilitySignalStore,
  canonicalJson,
  type SignalBatch,
  SignalDeliveryError,
  type SignalTarget,
} from './store';
import {
  type ApplicationLogSignal,
  type MetricBucketSignal,
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type SpanSignal,
} from './types';

const NOW = new Date('2026-08-26T12:00:00.000Z');

function span(overrides: Partial<SpanSignal> = {}): SpanSignal {
  return {
    kind: 'span',
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    parentSpanId: null,
    correlationId: null,
    requestId: null,
    runId: null,
    serviceName: 'test',
    serviceInstanceId: 'test-1',
    resourceKind: 'http.server',
    resourceName: 'health',
    operation: 'GET',
    status: 'ok',
    samplingReason: 'deterministic',
    attributes: {},
    errorType: null,
    startedAt: '2026-08-26T11:59:59.000Z',
    finishedAt: '2026-08-26T12:00:00.000Z',
    durationNs: 1_000_000,
    schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    ...overrides,
  };
}

function applicationLog(
  overrides: Partial<ApplicationLogSignal> = {},
): ApplicationLogSignal {
  return {
    kind: 'application_log',
    id: '01812345-6789-7abc-8def-0123456789ab',
    level: 'info',
    channel: 'application',
    category: 'application',
    event: null,
    module: null,
    message: 'ok',
    context: null,
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
    occurredAt: '2026-08-26T11:59:59.000Z',
    createdAt: '2026-08-26T12:00:00.000Z',
    schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    ...overrides,
  };
}

function metricBucket(
  overrides: Partial<MetricBucketSignal> = {},
): MetricBucketSignal {
  return {
    kind: 'metric_bucket',
    bucketStart: '2026-08-26T11:59:00.000Z',
    bucketWidthSeconds: 60,
    seriesFingerprint: 'a'.repeat(64),
    flushSequence: 1,
    serviceName: 'test',
    serviceInstanceId: 'test-1',
    resourceKind: 'http.server',
    resourceName: 'health',
    metricName: 'telemetry.operation.count',
    metricKind: 'counter',
    unit: 'count',
    count: 1,
    sum: 1,
    min: 1,
    max: 1,
    histogramBoundaries: [],
    histogramCounts: [1],
    labels: {},
    schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    ...overrides,
  };
}

function store(targets: SignalTarget[], options: Record<string, unknown> = {}) {
  return new BufferedObservabilitySignalStore({
    targets,
    now: () => NOW,
    flushIntervalMs: 60_000,
    ...options,
  });
}

describe('BufferedObservabilitySignalStore', () => {
  test('rejects a batch configuration that cannot deliver a legal maximum size Signal', () => {
    expect(
      () =>
        new BufferedObservabilitySignalStore({
          targets: [],
          batchMaxBytes: 4_095,
        }),
    ).toThrow('batch capacity');
  });

  test('enriches accepted signals and rejects invalid records before delivery', async () => {
    const batches: SignalBatch[] = [];
    const target: SignalTarget = {
      name: 'memory',
      write: async (batch) => {
        batches.push(batch);
      },
    };
    const signalStore = store([target]);

    expect(signalStore.append(span())).toEqual({ status: 'accepted' });
    expect(signalStore.append(span({ schemaVersion: 2 }))).toEqual({
      status: 'dropped',
      reason: 'invalid_schema',
    });
    expect(
      signalStore.append(span({ startedAt: '2026-08-18T11:59:59.000Z' })),
    ).toEqual({ status: 'dropped', reason: 'invalid_time' });
    expect(
      signalStore.append(applicationLog({ message: 'x'.repeat(5_000) })),
    ).toEqual({ status: 'dropped', reason: 'oversize' });

    await expect(signalStore.flush()).resolves.toMatchObject({
      written: 1,
      dropped: 0,
      failed: false,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.signals[0]).toMatchObject({
      ingestedAt: NOW.toISOString(),
      writeVersion: expect.any(Number),
    });
    expect(signalStore.diagnostics().droppedByReason).toEqual({
      invalid_schema: 1,
      invalid_time: 1,
      oversize: 1,
    });
    await signalStore.shutdown();
  });

  test('derives the persisted write version from the same ingest instant', async () => {
    const batches: SignalBatch[] = [];
    const target: SignalTarget = {
      name: 'memory',
      write: async (batch) => {
        batches.push(batch);
      },
    };
    const instants = [NOW, NOW, new Date(NOW.getTime() + 1)];
    let instantIndex = 0;
    const signalStore = store([target], {
      now: () => instants[Math.min(instantIndex++, instants.length - 1)] ?? NOW,
    });

    expect(signalStore.append(span())).toEqual({ status: 'accepted' });
    await signalStore.flush();

    const delivered = batches[0]?.signals[0];
    expect(delivered?.ingestedAt).toBe(NOW.toISOString());
    expect(delivered?.writeVersion).toBe(NOW.getTime() * 1_000);
    await signalStore.shutdown();
  });

  test('rejects a Signal more than five minutes in the future before delivery', async () => {
    const batches: SignalBatch[] = [];
    const signalStore = store([
      {
        name: 'memory',
        write: async (batch) => {
          batches.push(batch);
        },
      },
    ]);
    const future = new Date(NOW.getTime() + 5 * 60_000 + 1).toISOString();

    expect(
      signalStore.append(span({ startedAt: future, finishedAt: future })),
    ).toEqual({ status: 'dropped', reason: 'invalid_time' });
    await expect(signalStore.flush()).resolves.toMatchObject({ written: 0 });
    expect(batches).toEqual([]);
    await signalStore.shutdown();
  });

  test('rejects signals older than their per-kind retention window', async () => {
    const batches: SignalBatch[] = [];
    const signalStore = store([
      {
        name: 'memory',
        write: async (batch) => {
          batches.push(batch);
        },
      },
    ]);
    const spanExpiredAt = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1_000 - 1,
    ).toISOString();
    const logExpiredAt = new Date(
      NOW.getTime() - 30 * 24 * 60 * 60 * 1_000 - 1,
    ).toISOString();

    expect(
      signalStore.append(
        span({ startedAt: spanExpiredAt, finishedAt: spanExpiredAt }),
      ),
    ).toEqual({ status: 'dropped', reason: 'invalid_time' });
    expect(
      signalStore.append(
        applicationLog({ occurredAt: logExpiredAt, createdAt: logExpiredAt }),
      ),
    ).toEqual({ status: 'dropped', reason: 'invalid_time' });
    await expect(signalStore.flush()).resolves.toMatchObject({ written: 0 });
    expect(batches).toEqual([]);
    await signalStore.shutdown();
  });

  test('keeps the priority reserve for error signals under item pressure', async () => {
    const target: SignalTarget = {
      name: 'memory',
      write: async () => undefined,
    };
    const signalStore = store([target], { maxItems: 5, maxBytes: 50_000 });

    for (let index = 0; index < 4; index += 1) {
      expect(
        signalStore.append(
          applicationLog({ id: `01812345-6789-7abc-8def-0123456789a${index}` }),
        ),
      ).toEqual({ status: 'accepted' });
    }
    expect(signalStore.append(applicationLog())).toEqual({
      status: 'dropped',
      reason: 'queue_full',
    });
    expect(signalStore.append(span({ status: 'error' }))).toEqual({
      status: 'accepted',
    });
    expect(signalStore.diagnostics().queueDepth).toBe(5);
    await signalStore.shutdown();
  });

  test('evicts normal data to admit priority data under byte pressure', async () => {
    const target: SignalTarget = {
      name: 'memory',
      write: async () => undefined,
    };
    const normal = applicationLog({ message: 'x'.repeat(500) });
    const priority = span({ status: 'error' });
    const maxBytes = Math.ceil(
      new TextEncoder().encode(JSON.stringify(normal)).byteLength / 0.8,
    );
    const signalStore = store([target], { maxItems: 10, maxBytes });

    expect(signalStore.append(normal)).toEqual({ status: 'accepted' });
    expect(signalStore.append(priority)).toEqual({ status: 'accepted' });
    expect(signalStore.diagnostics()).toMatchObject({
      queueDepth: 1,
      droppedByReason: { queue_full: 1 },
    });
    await signalStore.shutdown();
  });

  test('drops malformed and cyclic records without throwing or delivering them', async () => {
    const batches: SignalBatch[] = [];
    const target: SignalTarget = {
      name: 'memory',
      write: async (batch) => {
        batches.push(batch);
      },
    };
    const signalStore = store([target]);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    let malformedResult: unknown;
    expect(() => {
      malformedResult = signalStore.append(
        applicationLog({ id: 'not-a-uuid' }) as ApplicationLogSignal,
      );
    }).not.toThrow();
    expect(malformedResult).toEqual({
      status: 'dropped',
      reason: 'invalid_schema',
    });
    expect(
      signalStore.append(span({ durationNs: 1.5, finishedAt: 'not-a-time' })),
    ).toEqual({ status: 'dropped', reason: 'invalid_schema' });
    expect(
      signalStore.append(metricBucket({ seriesFingerprint: 'short' })),
    ).toEqual({ status: 'dropped', reason: 'invalid_schema' });
    let cyclicResult: unknown;
    expect(() => {
      cyclicResult = signalStore.append(applicationLog({ context: cyclic }));
    }).not.toThrow();
    expect(cyclicResult).toEqual({
      status: 'dropped',
      reason: 'invalid_schema',
    });

    await expect(signalStore.flush()).resolves.toMatchObject({
      written: 0,
      dropped: 0,
      failed: false,
    });
    expect(batches).toEqual([]);
    expect(signalStore.diagnostics().droppedByReason.invalid_schema).toBe(4);
    await signalStore.shutdown();
  });

  test('measures Unicode payloads by UTF-8 bytes at the size boundary', async () => {
    const signalStore = store([
      {
        name: 'memory',
        write: async () => undefined,
      },
    ]);

    expect(
      signalStore.append(applicationLog({ message: '€'.repeat(1_300) })),
    ).toEqual({ status: 'dropped', reason: 'oversize' });
    await signalStore.shutdown();
  });

  test('retries a transient target failure with one stable batch identity', async () => {
    const ids: string[] = [];
    const payloads: string[] = [];
    let attempts = 0;
    const target: SignalTarget = {
      name: 'flaky',
      write: async (batch) => {
        ids.push(batch.id);
        payloads.push(canonicalJson(batch.signals));
        attempts += 1;
        if (attempts < 3) {
          throw new SignalDeliveryError('network', { transient: true });
        }
      },
    };
    const signalStore = store([target]);
    signalStore.append(span());

    await expect(signalStore.flush()).resolves.toMatchObject({
      written: 1,
      failed: false,
    });
    expect(attempts).toBe(3);
    expect(new Set(ids)).toEqual(new Set([ids[0] ?? '']));
    expect(new Set(payloads)).toEqual(new Set([payloads[0] ?? '']));
    await signalStore.shutdown();
  });

  test('drops a transient delivery only after the configured retry budget is exhausted', async () => {
    let attempts = 0;
    const signalStore = store([
      {
        name: 'unavailable',
        write: async () => {
          attempts += 1;
          throw new SignalDeliveryError('clickhouse_unavailable', {
            transient: true,
          });
        },
      },
    ]);
    signalStore.append(span());

    await expect(signalStore.flush()).resolves.toEqual({
      written: 0,
      dropped: 1,
      timedOut: false,
      failed: true,
    });
    expect(attempts).toBe(4);
    expect(signalStore.diagnostics()).toMatchObject({
      state: 'blind_spot',
      failureCode: 'clickhouse_unavailable',
      targets: {
        unavailable: {
          dropped: 1,
          failureCode: 'clickhouse_unavailable',
        },
      },
    });
    await signalStore.shutdown();
  });

  test('classifies transient and permanent delivery failures at the storage seam', async () => {
    const scenarios: Array<{
      name: string;
      error: unknown;
      expectedCode: string;
      expectedAttempts: number;
    }> = [
      {
        name: 'network error',
        error: new Error('ECONNRESET: network unavailable'),
        expectedCode: 'Error',
        expectedAttempts: 4,
      },
      {
        name: 'timeout error',
        error: new Error('request timed out'),
        expectedCode: 'Error',
        expectedAttempts: 4,
      },
      {
        name: 'HTTP 429',
        error: { status: 429 },
        expectedCode: 'http_429',
        expectedAttempts: 4,
      },
      {
        name: 'HTTP 503',
        error: { status: 503 },
        expectedCode: 'http_503',
        expectedAttempts: 4,
      },
      {
        name: 'authentication failure',
        error: new SignalDeliveryError('clickhouse_unauthorized'),
        expectedCode: 'clickhouse_unauthorized',
        expectedAttempts: 1,
      },
      {
        name: 'schema failure',
        error: new SignalDeliveryError('clickhouse_schema_mismatch'),
        expectedCode: 'clickhouse_schema_mismatch',
        expectedAttempts: 1,
      },
    ];

    for (const scenario of scenarios) {
      let attempts = 0;
      const signalStore = store([
        {
          name: scenario.name,
          write: async () => {
            attempts += 1;
            throw scenario.error;
          },
        },
      ]);
      signalStore.append(span());

      await expect(signalStore.flush()).resolves.toMatchObject({
        written: 0,
        dropped: 1,
        failed: true,
      });
      expect(attempts, scenario.name).toBe(scenario.expectedAttempts);
      expect(signalStore.diagnostics(), scenario.name).toMatchObject({
        state: 'blind_spot',
        failureCode: scenario.expectedCode,
        targets: {
          [scenario.name]: {
            dropped: 1,
            failureCode: scenario.expectedCode,
          },
        },
      });
      await signalStore.shutdown();
    }
  });

  test('keeps failure diagnostics sanitized when a target throws sensitive text', async () => {
    const signalStore = store([
      {
        name: 'sensitive-target',
        write: async () => {
          throw new Error('password=super-secret endpoint=https://db.internal');
        },
      },
    ]);
    signalStore.append(span());

    await signalStore.flush();
    const diagnostics = signalStore.diagnostics();
    expect(diagnostics.failureCode).toBe('Error');
    expect(JSON.stringify(diagnostics)).not.toContain('super-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('db.internal');
    await signalStore.shutdown();
  });

  test('bounds shutdown and accounts for queued rows when a delivery remains blocked', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signalStore = store(
      [
        {
          name: 'blocked',
          write: async () => {
            await blocked;
          },
        },
      ],
      { maxInFlight: 1, batchMaxItems: 1 },
    );
    signalStore.append(span());
    signalStore.append(span({ spanId: '1123456789abcdef' }));

    const result = await signalStore.shutdown(1);
    expect(result.timedOut).toBe(true);
    expect(result.failed).toBe(true);
    expect(result.dropped).toBe(1);
    expect(signalStore.append(span())).toEqual({
      status: 'dropped',
      reason: 'shutting_down',
    });

    release?.();
    await signalStore.flush();
  });

  test('keeps at most four delivery batches in flight', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fourthDeliveryStarted: (() => void) | undefined;
    const firstFourStarted = new Promise<void>((resolve) => {
      fourthDeliveryStarted = resolve;
    });
    let started = 0;
    let active = 0;
    let maximumActive = 0;
    const signalStore = store(
      [
        {
          name: 'blocked',
          write: async () => {
            started += 1;
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            if (started === 4) fourthDeliveryStarted?.();
            await blocked;
            active -= 1;
          },
        },
      ],
      { batchMaxItems: 1 },
    );

    for (let index = 0; index < 5; index += 1) {
      expect(
        signalStore.append(
          span({ spanId: index.toString(16).padStart(16, '0') }),
        ),
      ).toEqual({ status: 'accepted' });
    }
    const flush = signalStore.flush();
    await firstFourStarted;
    expect(maximumActive).toBe(4);
    expect(started).toBe(4);

    release?.();
    await expect(flush).resolves.toMatchObject({ written: 5, failed: false });
    expect(maximumActive).toBe(4);
    await signalStore.shutdown();
  });

  test('keeps target diagnostics independent when one dual target fails', async () => {
    const postgres: SignalTarget = {
      name: 'postgres',
      write: async () => undefined,
    };
    const clickhouse: SignalTarget = {
      name: 'clickhouse',
      write: async () => {
        throw new SignalDeliveryError('clickhouse_unavailable');
      },
    };
    const signalStore = store([postgres, clickhouse]);
    signalStore.append(span());

    await expect(signalStore.flush()).resolves.toEqual({
      written: 0,
      dropped: 1,
      timedOut: false,
      failed: true,
    });
    expect(signalStore.diagnostics()).toMatchObject({
      state: 'blind_spot',
      failureCode: 'clickhouse_unavailable',
      targets: {
        postgres: {
          written: 1,
          dropped: 0,
          failureCode: null,
        },
        clickhouse: {
          written: 0,
          dropped: 1,
          failureCode: 'clickhouse_unavailable',
        },
      },
    });
    await signalStore.shutdown();
  });

  test('isolates one poison row while retaining valid rows', async () => {
    const landed: string[] = [];
    const writes: Array<{ id: string; messages: string[] }> = [];
    const childAttempts = new Map<string, number>();
    const target: SignalTarget = {
      name: 'selective',
      write: async (batch) => {
        const messages = batch.signals.map((signal) =>
          signal.kind === 'application_log' ? signal.message : '',
        );
        writes.push({ id: batch.id, messages });
        if (messages.includes('poison')) {
          throw new SignalDeliveryError('row_invalid', { rowSpecific: true });
        }
        const attempts = (childAttempts.get(batch.id) ?? 0) + 1;
        childAttempts.set(batch.id, attempts);
        if (batch.signals.length === 1 && attempts === 1) {
          throw new SignalDeliveryError('network', { transient: true });
        }
        landed.push(...batch.signals.map((signal) => signal.kind));
      },
    };
    const signalStore = store([target]);
    signalStore.append(
      applicationLog({ id: '01812345-6789-7abc-8def-0123456789a1' }),
    );
    signalStore.append(
      applicationLog({
        id: '01812345-6789-7abc-8def-0123456789a2',
        message: 'poison',
      }),
    );

    await expect(signalStore.flush()).resolves.toMatchObject({
      written: 1,
      dropped: 1,
      failed: true,
    });
    expect(landed).toEqual(['application_log']);
    expect(signalStore.diagnostics().droppedByReason.poison).toBe(1);
    const parent = writes.find(({ messages }) => messages.length === 2);
    const validChildWrites = writes.filter(
      ({ messages }) => messages.length === 1 && messages[0] === 'ok',
    );
    const poisonChild = writes.find(
      ({ messages }) => messages.length === 1 && messages[0] === 'poison',
    );
    expect(parent).toBeDefined();
    expect(validChildWrites).toHaveLength(2);
    expect(new Set(validChildWrites.map(({ id }) => id)).size).toBe(1);
    expect(poisonChild).toBeDefined();
    expect(validChildWrites[0]?.id).not.toBe(parent?.id);
    expect(poisonChild?.id).not.toBe(parent?.id);
    expect(poisonChild?.id).not.toBe(validChildWrites[0]?.id);
    await signalStore.shutdown();
  });
});
