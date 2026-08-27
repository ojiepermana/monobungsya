import { describe, expect, test } from 'bun:test';
import {
  ClickHouseClient,
  type ClickHouseFetch,
  ClickHouseSignalTarget,
} from './clickhouse';
import type { SignalBatch } from './store';
import {
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type StoredObservabilitySignal,
} from './types';

function span(): StoredObservabilitySignal {
  return {
    kind: 'span',
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    parentSpanId: null,
    correlationId: 'journey-1',
    requestId: 'request-1',
    runId: null,
    serviceName: 'logs',
    serviceInstanceId: 'logs-1',
    resourceKind: 'http.server',
    resourceName: 'health',
    operation: 'GET',
    status: 'ok',
    samplingReason: 'deterministic',
    attributes: { status_code: 200 },
    errorType: null,
    startedAt: '2026-08-26T11:59:59.000Z',
    finishedAt: '2026-08-26T12:00:00.000Z',
    durationNs: 1_000_000,
    schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    ingestedAt: '2026-08-26T12:00:01.000Z',
    writeVersion: 1_777_211_201_000_000,
  };
}

function batch(): SignalBatch {
  return {
    id: '01812345-6789-7abc-8def-0123456789ab',
    kind: 'span',
    signals: [span()],
  };
}

function signalForKind(
  kind: 'span' | 'metric_bucket' | 'application_log' | 'access_log',
): StoredObservabilitySignal {
  const common = {
    schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
    ingestedAt: '2026-08-26T12:00:01.000Z',
    writeVersion: 1_777_211_201_000_000,
  };
  if (kind === 'span') return span();
  if (kind === 'metric_bucket') {
    return {
      kind,
      bucketStart: '2026-08-26T11:59:00.000Z',
      bucketWidthSeconds: 60,
      seriesFingerprint: 'a'.repeat(64),
      flushSequence: 1,
      serviceName: 'logs',
      serviceInstanceId: 'logs-1',
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
      labels: { status: 'ok' },
      ...common,
    };
  }
  if (kind === 'application_log') {
    return {
      kind,
      id: '01812345-6789-7abc-8def-0123456789ac',
      level: 'error',
      channel: 'application',
      category: 'application',
      event: 'invoice.failed',
      module: 'billing',
      message: 'invoice failed',
      context: { invoiceId: 42 },
      exceptionClass: 'DatabaseError',
      exceptionMessage: 'connection refused',
      stackTrace: null,
      actorUserId: null,
      actorName: null,
      actorEmail: null,
      entityType: 'invoice',
      entityId: 'invoice-42',
      referenceNo: null,
      branchCode: null,
      requestId: 'request-123',
      traceId: '0123456789abcdef0123456789abcdef',
      runtimeTraceId: '0123456789abcdef0123456789abcdef',
      runtimeSpanId: '0123456789abcdef',
      sessionId: null,
      ipAddress: null,
      userAgent: null,
      occurredAt: '2026-08-26T11:59:59.000Z',
      createdAt: '2026-08-26T12:00:00.000Z',
      ...common,
    };
  }
  return {
    kind,
    id: '01812345-6789-7abc-8def-0123456789ad',
    event: 'api_request',
    outcome: 'failure',
    authenticationMethod: 'session',
    accessChannel: 'web',
    guard: 'user',
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
    requestId: 'request-123',
    traceId: '0123456789abcdef0123456789abcdef',
    runtimeTraceId: '0123456789abcdef0123456789abcdef',
    runtimeSpanId: '0123456789abcdef',
    routeName: '/api/v1/invoices',
    path: '/api/v1/invoices',
    method: 'POST',
    httpStatus: 500,
    failureReason: 'upstream_failure',
    metadata: { source: 'test' },
    accessedAt: '2026-08-26T11:59:59.000Z',
    createdAt: '2026-08-26T12:00:00.000Z',
    ...common,
  };
}

describe('ClickHouse HTTP signal adapter', () => {
  test('sends an acknowledged async insert with stable token and snake case row', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetch: ClickHouseFetch = async (input, init) => {
      requests.push({ url: new URL(input.toString()), init });
      return new Response('', { status: 200 });
    };
    const target = new ClickHouseSignalTarget(
      new ClickHouseClient({
        url: 'https://clickhouse.internal:8443',
        username: 'writer',
        password: 'not-in-diagnostic',
        fetch,
      }),
    );

    await target.write(batch());

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url.searchParams.get('database')).toBe('observability');
    expect(request?.url.searchParams.get('async_insert')).toBe('1');
    expect(request?.url.searchParams.get('wait_for_async_insert')).toBe('1');
    expect(request?.url.searchParams.get('async_insert_deduplicate')).toBe('1');
    expect(request?.url.searchParams.get('insert_deduplication_token')).toBe(
      batch().id,
    );
    expect(request?.url.searchParams.get('query')).toBe(
      'INSERT INTO observability.spans FORMAT JSONEachRow',
    );
    expect(request?.init?.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
    });
    const row = JSON.parse(String(request?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      trace_id: '0123456789abcdef0123456789abcdef',
      started_at: '2026-08-26 11:59:59.000',
      write_version: 1_777_211_201_000_000,
      attributes: '{"status_code":200}',
    });
    expect(row).not.toHaveProperty('traceId');
  });

  test('routes all four Signal kinds through acknowledged async inserts', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetch: ClickHouseFetch = async (input, init) => {
      requests.push({ url: new URL(input.toString()), init });
      return new Response('', { status: 200 });
    };
    const target = new ClickHouseSignalTarget(
      new ClickHouseClient({
        url: 'https://clickhouse.internal:8443',
        username: 'writer',
        password: 'writer-secret',
        fetch,
      }),
    );
    const kinds = [
      'span',
      'metric_bucket',
      'application_log',
      'access_log',
    ] as const;
    const tables = [
      'spans',
      'metric_buckets',
      'application_logs',
      'access_logs',
    ];

    for (const [index, kind] of kinds.entries()) {
      const batchId = `01812345-6789-7abc-8def-0123456789a${index}`;
      await target.write({
        id: batchId,
        kind,
        signals: [signalForKind(kind)],
      });
      const request = requests[index];
      expect(request?.url.searchParams.get('query')).toBe(
        `INSERT INTO observability.${tables[index]} FORMAT JSONEachRow`,
      );
      expect(request?.url.searchParams.get('wait_for_async_insert')).toBe('1');
      expect(request?.url.searchParams.get('insert_deduplication_token')).toBe(
        batchId,
      );
      expect(String(request?.init?.body)).toContain('"schema_version":1');
    }
    expect(requests).toHaveLength(4);
  });

  test('binds query values as HTTP parameters and parses JSONEachRow', async () => {
    let url: URL | undefined;
    const client = new ClickHouseClient({
      url: 'http://127.0.0.1:8123',
      username: 'reader',
      password: 'reader-secret',
      fetch: async (input) => {
        url = new URL(input.toString());
        return new Response(
          '{"trace_id":"0123456789abcdef0123456789abcdef"}\n',
        );
      },
    });

    await expect(
      client.queryRows<{ trace_id: string }>(
        'SELECT trace_id FROM observability.spans WHERE started_at >= {start:DateTime64(6)}',
        { params: { start: '2026-08-26 00:00:00.000000' } },
      ),
    ).resolves.toEqual([{ trace_id: '0123456789abcdef0123456789abcdef' }]);
    expect(url?.searchParams.get('param_start')).toBe(
      '2026-08-26 00:00:00.000000',
    );
    expect(url?.searchParams.get('query')).toContain('FORMAT JSONEachRow');
  });

  test('honors a bounded per-query timeout instead of the client default', async () => {
    let aborted = false;
    const client = new ClickHouseClient({
      url: 'http://127.0.0.1:8123',
      username: 'reader',
      password: 'reader-secret',
      requestTimeoutMs: 1_000,
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });

    await expect(
      client.queryRows('SELECT 1', { timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: 'clickhouse_timeout' });
    expect(aborted).toBe(true);
  });

  test('classifies a parse failure without exposing server response text', async () => {
    const target = new ClickHouseSignalTarget(
      new ClickHouseClient({
        url: 'http://127.0.0.1:8123',
        username: 'writer',
        password: 'writer-secret',
        fetch: async () =>
          new Response('Cannot parse confidential payload', { status: 400 }),
      }),
    );

    await expect(target.write(batch())).rejects.toMatchObject({
      code: 'clickhouse_row_invalid',
      options: { rowSpecific: true },
    });
  });

  test('classifies HTTP 429 and 5xx insert failures as retryable', async () => {
    for (const status of [429, 500, 503]) {
      const target = new ClickHouseSignalTarget(
        new ClickHouseClient({
          url: 'http://127.0.0.1:8123',
          username: 'writer',
          password: 'writer-secret',
          fetch: async () => new Response('temporary failure', { status }),
        }),
      );

      await expect(target.write(batch())).rejects.toMatchObject({
        code: `clickhouse_http_${status}`,
        options: { transient: true },
      });
    }
  });

  test('classifies an access denial even when ClickHouse returns it as HTTP 500', async () => {
    const client = new ClickHouseClient({
      url: 'http://127.0.0.1:8123',
      username: 'writer',
      password: 'writer-secret',
      fetch: async () =>
        new Response('Not enough privileges. To execute this query.', {
          status: 500,
        }),
    });

    await expect(client.queryRows('SELECT 1')).rejects.toMatchObject({
      code: 'clickhouse_unauthorized',
    });
  });

  test('passes a configured private CA to Bun fetch without placing it in the URL', async () => {
    let request: RequestInit | undefined;
    const client = new ClickHouseClient({
      url: 'https://clickhouse.internal:8443',
      username: 'reader',
      password: 'reader-secret',
      tlsCaFile: '/run/secrets/clickhouse-ca.pem',
      fetch: async (_input, init) => {
        request = init;
        return new Response('{"value":1}\n');
      },
    });

    await expect(client.queryRows('SELECT 1')).resolves.toEqual([{ value: 1 }]);
    const tls = request as (RequestInit & { tls?: Bun.TLSOptions }) | undefined;
    expect(tls?.tls?.ca).toBeDefined();
    expect(new URL('https://clickhouse.internal:8443').username).toBe('');
  });

  test('rejects endpoint credentials so only the configured identity is sent', () => {
    expect(
      () =>
        new ClickHouseClient({
          url: 'https://writer:writer-secret@clickhouse.internal:8443',
          username: 'writer',
          password: 'writer-secret',
        }),
    ).toThrow('CLICKHOUSE_URL must not contain username or password');
  });
});
