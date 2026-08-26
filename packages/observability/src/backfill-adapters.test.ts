import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import {
  canonicalBackfillParity,
  type SignalBackfillPageRequest,
} from './backfill';
import {
  ClickHouseSignalBackfillGuard,
  ClickHouseSignalBackfillTarget,
  PostgresSignalBackfillSource,
} from './backfill-adapters';
import { ClickHouseClient, type ClickHouseFetch } from './clickhouse';
import type { StoredObservabilitySignal } from './types';

const RANGE = {
  sourceDay: '2026-08-25',
  sourceFrom: '2026-08-25T00:00:00.000Z',
  sourceTo: '2026-08-26T00:00:00.000Z',
  schemaVersion: 1,
  sampleModulus: 1_000,
} as const;

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function database(responses: unknown[][]): {
  client: DatabaseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const connection = {
    unsafe: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const response = responses.shift();
      if (!response) throw new Error('unexpected database query');
      return response;
    },
  };
  return { client: connection as unknown as DatabaseClient, queries };
}

function applicationLogRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: '01812345-6789-7abc-8def-0123456789ab',
    level: 'error',
    channel: 'application',
    category: 'runtime',
    event: 'request.failed',
    module: 'gateway',
    message: 'safe message',
    context: '{"attempt":1}',
    exception_class: null,
    exception_message: null,
    stack_trace: null,
    actor_user_id: null,
    actor_name: null,
    actor_email: null,
    entity_type: null,
    entity_id: null,
    reference_no: null,
    branch_code: null,
    request_id: 'request-1',
    trace_id: 'journey-1',
    runtime_trace_id: '0123456789abcdef0123456789abcdef',
    runtime_span_id: '0123456789abcdef',
    session_id: null,
    ip_address: null,
    user_agent: null,
    occurred_at: '2026-08-25 12:00:00.000',
    created_at: '2026-08-25 12:00:01.000',
    ...overrides,
  };
}

function spanRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    trace_id: '0123456789abcdef0123456789abcdef',
    span_id: '0123456789abcdef',
    parent_span_id: null,
    correlation_id: 'journey-1',
    request_id: 'request-1',
    run_id: null,
    service_name: 'gateway',
    service_instance_id: 'gateway-1',
    resource_kind: 'http.server',
    resource_name: 'health',
    operation: 'GET',
    status: 'ok',
    sampling_reason: 'deterministic',
    attributes: '{"status_code":200}',
    error_type: null,
    started_at: '2026-08-25 12:00:00.000',
    finished_at: '2026-08-25 12:00:01.000',
    duration_ns: '1000000000',
    ...overrides,
  };
}

function metricBucketRow(): Record<string, unknown> {
  return {
    bucket_start: '2026-08-25 12:00:00.000',
    bucket_width_seconds: 60,
    series_fingerprint: 'a'.repeat(64),
    flush_sequence: '1',
    service_name: 'gateway',
    service_instance_id: 'gateway-1',
    resource_kind: 'http.server',
    resource_name: 'health',
    metric_name: 'http.server.duration',
    metric_kind: 'histogram',
    unit: 'ms',
    count: '1',
    sum: 10,
    min: 10,
    max: 10,
    histogram_boundaries: [10],
    histogram_counts: [0, 1],
    labels: '{"method":"GET"}',
  };
}

function accessLogRow(): Record<string, unknown> {
  return {
    id: '01812345-6789-7abc-8def-0123456789ac',
    event: 'access.denied',
    outcome: 'failure',
    authentication_method: 'password',
    access_channel: 'web',
    guard: null,
    actor_user_id: null,
    actor_name: null,
    actor_email: null,
    branch_code: null,
    ip_address: null,
    forwarded_ip: null,
    user_agent: null,
    device_name: null,
    platform: null,
    browser: null,
    session_id: null,
    request_id: 'request-1',
    trace_id: 'journey-1',
    runtime_trace_id: null,
    runtime_span_id: null,
    route_name: '/health',
    path: '/health',
    method: 'GET',
    http_status: 403,
    failure_reason: 'permission_denied',
    metadata: '{"source":"test"}',
    accessed_at: '2026-08-25 12:00:00.000',
    created_at: '2026-08-25 12:00:01.000',
  };
}

function storedApplicationLog(): Extract<
  StoredObservabilitySignal,
  { kind: 'application_log' }
> {
  return storedApplicationLogWith({});
}

function storedApplicationLogWith(
  overrides: Partial<
    Extract<StoredObservabilitySignal, { kind: 'application_log' }>
  >,
): Extract<StoredObservabilitySignal, { kind: 'application_log' }> {
  return {
    kind: 'application_log',
    id: '01812345-6789-7abc-8def-0123456789ab',
    level: 'error',
    channel: 'application',
    category: 'runtime',
    event: 'request.failed',
    module: 'gateway',
    message: 'safe message',
    context: { attempt: 1 },
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
    requestId: 'request-1',
    traceId: 'journey-1',
    runtimeTraceId: '0123456789abcdef0123456789abcdef',
    runtimeSpanId: '0123456789abcdef',
    sessionId: null,
    ipAddress: null,
    userAgent: null,
    occurredAt: '2026-08-25T12:00:00.000Z',
    createdAt: '2026-08-25T12:00:01.000Z',
    schemaVersion: 1,
    ingestedAt: '2026-08-25T12:00:01.000Z',
    writeVersion: 1_772_120_801_000_000,
    ...overrides,
  };
}

function page(
  kind: SignalBackfillPageRequest['kind'],
  overrides: Partial<SignalBackfillPageRequest> = {},
): SignalBackfillPageRequest {
  return {
    ...RANGE,
    kind,
    cursor: null,
    limit: 1,
    ...overrides,
  };
}

describe('PostgresSignalBackfillSource', () => {
  test('reads one canonical application log page in stable key order', async () => {
    const telemetry = database([]);
    const logs = database([[applicationLogRow()], []]);
    const source = new PostgresSignalBackfillSource({
      telemetryDatabase: telemetry.client,
      logsDatabase: logs.client,
    });

    const result = await source.readPage(page('application_log'));

    expect(result.signals).toEqual([
      expect.objectContaining({
        kind: 'application_log',
        id: '01812345-6789-7abc-8def-0123456789ab',
        context: { attempt: 1 },
        occurredAt: '2026-08-25T12:00:00.000Z',
        schemaVersion: 1,
      }),
    ]);
    expect(result.nextCursor).toMatchObject({
      version: 1,
      order: 'event_time_stable_identity_v1',
      identity: { id: '01812345-6789-7abc-8def-0123456789ab' },
    });
    expect(logs.queries[0]?.sql).toContain('FROM "logs"."logging"');
    expect(logs.queries[0]?.sql).toContain('ORDER BY occurred_at ASC, id ASC');
    expect(logs.queries[0]?.params).toEqual([
      RANGE.sourceFrom,
      RANGE.sourceTo,
      1,
    ]);

    await expect(
      source.readPage(page('application_log', { cursor: result.nextCursor })),
    ).resolves.toMatchObject({ signals: [], nextCursor: null });
    expect(logs.queries[1]?.sql).toContain('id > $4::uuid');
    expect(logs.queries[1]?.params).toEqual([
      RANGE.sourceFrom,
      RANGE.sourceTo,
      '2026-08-25T12:00:00.000Z',
      '01812345-6789-7abc-8def-0123456789ab',
      1,
    ]);

    await expect(
      source.readPage(
        page('application_log', {
          cursor: {
            version: 1,
            order: 'event_time_stable_identity_v1',
            fingerprint: '0'.repeat(64),
            eventTime: '2026-08-25T12:00:00.000Z',
            identity: { id: '01812345-6789-7abc-8def-0123456789ab' },
          },
        }),
      ),
    ).rejects.toThrow('source cursor does not match this immutable range');
  });

  test('uses only the four fixed source tables and maps every Signal kind', async () => {
    const telemetry = database([[spanRow()], [metricBucketRow()]]);
    const logs = database([[applicationLogRow()], [accessLogRow()]]);
    const source = new PostgresSignalBackfillSource({
      telemetryDatabase: telemetry.client,
      logsDatabase: logs.client,
    });

    const span = await source.readPage(page('span'));
    const metric = await source.readPage(page('metric_bucket'));
    const application = await source.readPage(page('application_log'));
    const access = await source.readPage(page('access_log'));

    expect(span.signals[0]).toMatchObject({
      kind: 'span',
      durationNs: 1_000_000_000,
    });
    expect(metric.signals[0]).toMatchObject({
      kind: 'metric_bucket',
      histogramCounts: [0, 1],
    });
    expect(application.signals[0]).toMatchObject({ kind: 'application_log' });
    expect(access.signals[0]).toMatchObject({
      kind: 'access_log',
      httpStatus: 403,
      metadata: { source: 'test' },
    });

    expect(telemetry.queries.map((query) => query.sql)).toEqual([
      expect.stringContaining('FROM "telemetry"."spans"'),
      expect.stringContaining('FROM "telemetry"."metric_buckets"'),
    ]);
    expect(logs.queries.map((query) => query.sql)).toEqual([
      expect.stringContaining('FROM "logs"."logging"'),
      expect.stringContaining('FROM "logs"."access_logs"'),
    ]);
  });

  test('fails closed when retained source JSON is not canonical', async () => {
    const telemetry = database([[spanRow({ attributes: '{"nested":{}}' })]]);
    const logs = database([]);
    const source = new PostgresSignalBackfillSource({
      telemetryDatabase: telemetry.client,
      logsDatabase: logs.client,
    });

    await expect(source.readPage(page('span'))).rejects.toThrow(
      'attributes.nested must be a JSON primitive',
    );
  });

  test('builds canonical source parity through bounded stable pages', async () => {
    const telemetry = database([]);
    const first = applicationLogRow({ actor_name: 'zebra' });
    const second = applicationLogRow({
      id: '01812345-6789-7abc-8def-0123456789ac',
      actor_name: 'alpha',
      occurred_at: '2026-08-25 12:01:00.000',
      created_at: '2026-08-25 12:01:01.000',
    });
    const logs = database([[{ count: '2' }], [first, second]]);
    const source = new PostgresSignalBackfillSource({
      telemetryDatabase: telemetry.client,
      logsDatabase: logs.client,
    });

    await expect(
      source.canonicalParity({ ...RANGE, kind: 'application_log' }),
    ).resolves.toEqual(
      canonicalBackfillParity([
        storedApplicationLogWith({ actorName: 'zebra' }),
        storedApplicationLogWith({
          id: '01812345-6789-7abc-8def-0123456789ac',
          actorName: 'alpha',
          occurredAt: '2026-08-25T12:01:00.000Z',
          createdAt: '2026-08-25T12:01:01.000Z',
          ingestedAt: '2026-08-25T12:01:01.000Z',
          writeVersion: 1_772_120_861_000_000,
        }),
      ]),
    );
    expect(logs.queries[0]?.sql).toContain('SELECT count(*)::text AS count');
    expect(logs.queries[1]?.sql).toContain('ORDER BY occurred_at ASC, id ASC');
    expect(logs.queries[1]?.params).toEqual([
      RANGE.sourceFrom,
      RANGE.sourceTo,
      1_000,
    ]);
  });
});

describe('ClickHouseSignalBackfillTarget', () => {
  test('uses a deterministic token, bounded settings, and canonical target parity', async () => {
    const writes: Array<{ url: URL; init?: RequestInit }> = [];
    const reads: URL[] = [];
    const writerFetch: ClickHouseFetch = async (input, init) => {
      writes.push({ url: new URL(input.toString()), init });
      return new Response('', { status: 200 });
    };
    const signal = storedApplicationLog();
    const readerFetch: ClickHouseFetch = async (input) => {
      const url = new URL(input.toString());
      reads.push(url);
      const query = url.searchParams.get('query') ?? '';
      if (query.includes('SELECT count()')) {
        return new Response('{"count":"1"}\n', { status: 200 });
      }
      if (query.includes('FROM observability.application_logs FINAL')) {
        return new Response(
          `${JSON.stringify({
            ...applicationLogRow(),
            schema_version: 1,
          })}\n`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected ClickHouse query ${query}`);
    };
    const target = new ClickHouseSignalBackfillTarget({
      writer: new ClickHouseClient({
        url: 'https://clickhouse.internal:8443',
        username: 'writer',
        password: 'writer-secret',
        fetch: writerFetch,
      }),
      reader: new ClickHouseClient({
        url: 'https://clickhouse.internal:8443',
        username: 'reader',
        password: 'reader-secret',
        fetch: readerFetch,
      }),
      maxThreads: 4,
      maxMemoryBytes: 268_435_456,
      maxWriteBytesPerSecond: 10_000_000,
    });

    await target.write({
      token: 'stable-backfill-page-token',
      kind: 'application_log',
      signals: [signal],
    });
    await expect(
      target.canonicalParity({ ...RANGE, kind: 'application_log' }),
    ).resolves.toEqual(canonicalBackfillParity([signal]));

    expect(writes).toHaveLength(1);
    const request = writes[0];
    expect(request?.url.searchParams.get('insert_deduplication_token')).toBe(
      'stable-backfill-page-token',
    );
    expect(request?.url.searchParams.get('async_insert')).toBe('1');
    expect(request?.url.searchParams.get('wait_for_async_insert')).toBe('1');
    expect(request?.url.searchParams.get('async_insert_deduplicate')).toBe('1');
    expect(request?.url.searchParams.get('insert_deduplicate')).toBe('1');
    expect(request?.url.searchParams.get('max_threads')).toBe('4');
    expect(request?.url.searchParams.get('max_memory_usage')).toBe('268435456');
    expect(request?.url.searchParams.get('query')).toBe(
      'INSERT INTO observability.application_logs FORMAT JSONEachRow',
    );
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      id: signal.id,
      context: '{"attempt":1}',
      write_version: signal.writeVersion,
    });
    expect(reads).toHaveLength(2);
    for (const request of reads) {
      expect(request.searchParams.get('readonly')).toBe('1');
      expect(request.searchParams.get('max_threads')).toBe('4');
      expect(request.searchParams.get('max_memory_usage')).toBe('268435456');
      expect(request.searchParams.get('max_result_rows')).toBe('1000');
      expect(request.searchParams.get('max_result_bytes')).toBe('16777216');
      expect(request.searchParams.get('result_overflow_mode')).toBe('throw');
    }
  });
});

describe('ClickHouseSignalBackfillGuard', () => {
  test('waits for two consecutive query SLO failures and blocks queue pressure', async () => {
    let now = new Date('2026-08-26T12:00:00.000Z');
    let evidence = {
      observedAt: now.toISOString(),
      freshnessP95Ms: 100,
      querySloGreen: false,
      queueDropCount: 0,
    };
    const guard = new ClickHouseSignalBackfillGuard({
      evidence: async () => evidence,
      schemaCheck: async () => true,
      diskUsagePercent: async () => 79,
      now: () => now,
    });

    await expect(guard.check({ ...RANGE, kind: 'span' })).resolves.toEqual({
      status: 'ready',
    });
    await expect(guard.check({ ...RANGE, kind: 'span' })).resolves.toEqual({
      status: 'ready',
    });

    now = new Date('2026-08-26T12:00:01.000Z');
    evidence = { ...evidence, observedAt: now.toISOString() };
    await expect(guard.check({ ...RANGE, kind: 'span' })).resolves.toEqual({
      status: 'blocked',
      code: 'query_slo',
    });

    evidence = { ...evidence, querySloGreen: true, queueDropCount: 1 };
    await expect(guard.check({ ...RANGE, kind: 'span' })).resolves.toEqual({
      status: 'blocked',
      code: 'queue_pressure',
    });
  });
});
