import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import { createPostgresObservabilitySignalStore } from './postgres';

interface Capture {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function fakeDatabase(captures: Capture[]): DatabaseClient {
  const database = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    captures.push({ sql: [...strings].join('?'), params: values });
    return [];
  }) as unknown as DatabaseClient;
  const mutable = database as unknown as {
    begin: (
      operation: (transaction: DatabaseClient) => Promise<unknown>,
    ) => Promise<unknown>;
    unsafe: (sql: string, params?: readonly unknown[]) => Promise<unknown>;
    array: (values: readonly unknown[], type: string) => unknown;
  };
  mutable.begin = async (operation) => operation(database);
  mutable.unsafe = async (sql, params = []) => {
    captures.push({ sql, params });
    return [];
  };
  mutable.array = (values, type) => ({ values, type });
  return database;
}

function signals() {
  const eventAt = '2026-08-27T02:00:00.000Z';
  return [
    {
      kind: 'span' as const,
      traceId: '1234567890abcdef1234567890abcdef',
      spanId: '1234567890abcdef',
      parentSpanId: null,
      correlationId: null,
      requestId: null,
      runId: null,
      serviceName: 'postgres-jsonb-test',
      serviceInstanceId: 'postgres-jsonb-test',
      resourceKind: 'http.server',
      resourceName: 'test',
      operation: 'GET',
      status: 'ok' as const,
      samplingReason: 'deterministic',
      attributes: { marker: 'attributes' },
      errorType: null,
      startedAt: eventAt,
      finishedAt: eventAt,
      durationNs: 1,
      schemaVersion: 1,
    },
    {
      kind: 'metric_bucket' as const,
      bucketStart: eventAt,
      bucketWidthSeconds: 60,
      seriesFingerprint: '1'.repeat(64),
      flushSequence: 1,
      serviceName: 'postgres-jsonb-test',
      serviceInstanceId: 'postgres-jsonb-test',
      resourceKind: 'business.operation',
      resourceName: 'test',
      metricName: 'telemetry.operation.count',
      metricKind: 'counter' as const,
      unit: 'count',
      count: 1,
      sum: 1,
      min: 1,
      max: 1,
      histogramBoundaries: [],
      histogramCounts: [1],
      labels: { marker: 'labels' },
      schemaVersion: 1,
    },
    {
      kind: 'application_log' as const,
      id: '01812345-6789-7abc-8def-0123456789ab',
      level: 'info',
      channel: 'application',
      category: 'test',
      event: null,
      module: null,
      message: 'jsonb test',
      context: { marker: 'context' },
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
      occurredAt: eventAt,
      createdAt: eventAt,
      schemaVersion: 1,
    },
    {
      kind: 'access_log' as const,
      id: '01812345-6789-7abd-8def-0123456789ab',
      event: 'jsonb_test',
      outcome: 'success',
      authenticationMethod: null,
      accessChannel: 'internal',
      guard: null,
      actorUserId: null,
      actorName: null,
      actorEmail: null,
      branchCode: null,
      ipAddress: null,
      forwardedIp: null,
      userAgent: null,
      deviceName: null,
      platform: null,
      browser: null,
      sessionId: null,
      requestId: null,
      traceId: null,
      runtimeTraceId: null,
      runtimeSpanId: null,
      routeName: 'test',
      path: '/test',
      method: 'GET',
      httpStatus: 200,
      failureReason: null,
      metadata: { marker: 'metadata' },
      accessedAt: eventAt,
      createdAt: eventAt,
      schemaVersion: 1,
    },
  ];
}

describe('PostgreSQL Signal adapter', () => {
  test('passes JSONB fields as structured values instead of JSON strings', async () => {
    const captures: Capture[] = [];
    const database = fakeDatabase(captures);
    const store = createPostgresObservabilitySignalStore({
      telemetryDatabase: database,
      logsDatabase: database,
      flushIntervalMs: 60_000,
      now: () => new Date('2026-08-27T02:00:30.000Z'),
    } as never);

    for (const signal of signals())
      expect(store.append(signal)).toEqual({ status: 'accepted' });
    await expect(store.flush()).resolves.toMatchObject({
      written: 4,
      dropped: 0,
    });

    const params = captures.flatMap((capture) => [...capture.params]);
    expect(params).toContainEqual({ marker: 'attributes' });
    expect(params).toContainEqual({ marker: 'labels' });
    expect(params).toContainEqual({ marker: 'context' });
    expect(params).toContainEqual({ marker: 'metadata' });
    expect(
      params.every(
        (value) => typeof value !== 'string' || !value.includes('"marker"'),
      ),
    ).toBe(true);
    await store.shutdown();
  });
});
