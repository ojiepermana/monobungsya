import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import { ClickHouseSignalReader } from '#project/observability';
import { createApp } from '../app';
import { ObservabilityRepository } from '../modules/observability/observability.repository';
import {
  decodeTraceCursor,
  TRACE_CURSOR_SORT_KEY,
  traceCursorFingerprint,
} from '../modules/observability/observability.trace-cursor';

interface ReaderCall {
  query: string;
  options:
    | {
        database?: string | null;
        params?: Readonly<Record<string, string | number | boolean>>;
        settings?: Readonly<Record<string, string | number | boolean>>;
        timeoutMs?: number;
      }
    | undefined;
}

class FakeClickHouseClient {
  readonly calls: ReaderCall[] = [];

  constructor(
    private readonly respond: (
      call: ReaderCall,
    ) =>
      | readonly Record<string, unknown>[]
      | Promise<readonly Record<string, unknown>[]>,
  ) {}

  async queryRows<Row extends object>(
    query: string,
    options?: ReaderCall['options'],
  ): Promise<Row[]> {
    const call = { query, options };
    this.calls.push(call);
    return (await this.respond(call)) as unknown as Row[];
  }
}

function expectRemainingTimeout(
  options: ReaderCall['options'],
  maximumTimeoutMs: number,
): void {
  expect(options?.timeoutMs).toBeGreaterThan(0);
  expect(options?.timeoutMs).toBeLessThanOrEqual(maximumTimeoutMs);
  expect(options?.settings?.max_execution_time).toBeGreaterThan(0);
  expect(options?.settings?.max_execution_time).toBeLessThanOrEqual(
    maximumTimeoutMs / 1_000,
  );
}

const SIGNING_SECRET = 'clickhouse-read-test-secret';

function testEnv() {
  return loadEnv('logs', {
    NODE_ENV: 'test',
    PORT: '3103',
    INTERNAL_AUTH_SIGNING_SECRET: SIGNING_SECRET,
  });
}

function request(path: string, permissions: string[]): Request {
  const url = new URL(path, 'http://localhost');
  const identity = {
    userId: '0198f8a0-0000-7000-8000-000000000001',
    email: 'operator@project.local',
    permissions,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  return new Request(url, {
    headers: {
      'x-auth-user-id': identity.userId,
      'x-auth-email': identity.email,
      'x-auth-permissions': identity.permissions.join(','),
      'x-auth-expires-at': identity.expiresAt,
      'x-auth-signature': signAuthIdentity(
        'GET',
        url.pathname,
        identity,
        SIGNING_SECRET,
      ),
    },
  });
}

describe('ClickHouse observability reads', () => {
  it('uses the shared versioned Trace cursor contract and rejects changed filters', async () => {
    const traceRows = Array.from({ length: 51 }, (_, index) => ({
      trace_id: index.toString(16).padStart(32, 'a'),
      trace_started_at: `2026-08-26 10:00:${String(index % 60).padStart(2, '0')}.000000`,
      trace_finished_at: `2026-08-26 10:01:${String(index % 60).padStart(2, '0')}.000000`,
      duration_ns: '100000000',
      service_name: 'gateway',
      resource_name: 'GET /api/v1/users',
      status: 'ok',
      span_count: '1',
      sampling_reason: 'deterministic',
      has_root: 1,
      correlation_id: 'journey-1',
      request_id: 'request-1',
      run_id: null,
    }));
    const client = new FakeClickHouseClient((call) => {
      if (call.query.includes('groupUniqArray')) {
        return [
          {
            services: ['gateway'],
            resource_kinds: ['http.server'],
            resource_names: ['GET /api/v1/users'],
          },
        ];
      }
      if (call.query.includes('GROUP BY trace_id')) return traceRows;
      return [];
    });
    const repository = new ObservabilityRepository(undefined, {
      readMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client),
    });
    const scope = {
      from: new Date('2026-08-26T09:00:00.000Z'),
      to: new Date('2026-08-26T11:00:00.000Z'),
      service: 'gateway',
    };

    const first = await repository.listTraces(scope);

    expect(first.nextCursor).not.toBeNull();
    expect(
      decodeTraceCursor(first.nextCursor ?? '', traceCursorFingerprint(scope)),
    ).toMatchObject({
      signalKind: 'trace',
      direction: 'next',
      sortKey: TRACE_CURSOR_SORT_KEY,
    });

    await repository.listTraces({
      ...scope,
      cursor: first.nextCursor ?? undefined,
    });
    const pagedSummary = client.calls
      .filter((call) => call.query.includes('GROUP BY trace_id'))
      .at(-1);
    expect(pagedSummary?.query).toContain(
      'HAVING (min(started_at), trace_id) <',
    );
    expect(pagedSummary?.options?.params).toMatchObject({
      cursorStartedAt: '2026-08-26 10:00:49.000',
    });

    await expect(
      repository.listTraces({
        ...scope,
        service: 'logs',
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toThrow('does not match the filters');
  });

  it('uses bound ClickHouse values for trace lists instead of PostgreSQL in clickhouse mode', async () => {
    const client = new FakeClickHouseClient((call) => {
      if (call.query.includes('groupUniqArray')) {
        return [
          {
            services: ['gateway'],
            resource_kinds: ['http.server'],
            resource_names: ['GET /api/v1/users'],
          },
        ];
      }
      if (call.query.includes('GROUP BY trace_id')) {
        return [
          {
            trace_id: 'a'.repeat(32),
            trace_started_at: '2026-08-26 10:00:00.000000',
            trace_finished_at: '2026-08-26 10:00:00.100000',
            duration_ns: '100000000',
            service_name: 'gateway',
            resource_name: 'GET /api/v1/users',
            status: 'ok',
            span_count: '1',
            sampling_reason: 'deterministic',
            has_root: 1,
            correlation_id: 'journey-1',
            request_id: 'request-1',
            run_id: null,
          },
        ];
      }
      return [];
    });
    const app = createApp(testEnv(), {
      telemetryDatabase: {
        unsafe() {
          throw new Error('PostgreSQL signal reader must not be used');
        },
      } as never,
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client),
    });
    const literal = "gateway' OR 1 = 1";
    const runId = '0198f8f8-0000-7000-8000-000000000001';
    const response = await app.handle(
      request(
        `/internal/observability/traces?from=2026-08-26T09:00:00Z&to=2026-08-26T10:00:00Z&service=${encodeURIComponent(literal)}&resourceKind=http.server&resourceName=${encodeURIComponent('GET /api/v1/users')}&status=ok&correlationId=journey-1&requestId=request-1&runId=${runId}`,
        ['observability:trace:read'],
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          traceId: 'a'.repeat(32),
          durationMs: 100,
          complete: true,
        },
      ],
      storageStatus: 'available',
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls.every((call) => !call.query.includes(literal))).toBe(
      true,
    );
    const summary = client.calls.find((call) =>
      call.query.includes('GROUP BY trace_id'),
    );
    expect(summary?.options).toMatchObject({
      params: {
        from: '2026-08-26 09:00:00.000',
        to: '2026-08-26 10:00:00.000',
        service: literal,
        resourceKind: 'http.server',
        resourceName: 'GET /api/v1/users',
        status: 'ok',
        correlationId: 'journey-1',
        requestId: 'request-1',
        runId,
      },
    });
    expectRemainingTimeout(summary?.options, 5_000);
    expect(summary?.query).toContain("DateTime64(6, 'UTC')");
    expect(summary?.query).toContain('LIMIT 1 BY trace_id, span_id');
  });

  it('reads trace detail from ClickHouse with a retention bounded query', async () => {
    const client = new FakeClickHouseClient(() => [
      {
        trace_id: 'b'.repeat(32),
        span_id: '0123456789abcdef',
        parent_span_id: null,
        service_name: 'logs',
        service_instance_id: 'logs-1',
        resource_kind: 'http.server',
        resource_name: 'health',
        operation: 'GET',
        status: 'ok',
        sampling_reason: 'deterministic',
        attributes: '{"status_code":200}',
        error_type: null,
        started_at: '2026-08-26 10:00:00.000000',
        finished_at: '2026-08-26 10:00:00.001000',
        duration_ns: '1000000',
      },
    ]);
    const repository = new ObservabilityRepository(undefined, {
      clickhouseReader: new ClickHouseSignalReader(client),
      readMode: 'clickhouse',
    });

    await expect(repository.getTrace('b'.repeat(32))).resolves.toMatchObject({
      traceId: 'b'.repeat(32),
      spans: [{ spanId: '0123456789abcdef', orphan: false }],
      storageStatus: 'available',
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.query).toContain(
      'WHERE trace_id = {traceId:String}',
    );
    expect(client.calls[0]?.query).toContain("DateTime64(6, 'UTC')");
    expect(client.calls[0]?.options).toMatchObject({
      params: { traceId: 'b'.repeat(32) },
      settings: { max_execution_time: 10 },
      timeoutMs: 10_000,
    });
  });

  it('uses allowed metric groups and parameter binding for ClickHouse metrics', async () => {
    const client = new FakeClickHouseClient((call) => {
      if (call.query.includes('groupUniqArray')) {
        return [
          {
            metrics: ['telemetry.operation.count'],
            services: ['gateway'],
            resource_kinds: ['http.server'],
          },
        ];
      }
      if (call.query.includes('SELECT DISTINCT')) {
        return [{ metric_name: 'telemetry.operation.count' }];
      }
      if (call.query.includes('toStartOfInterval')) {
        return [
          {
            aligned_bucket_start: '2026-08-26 10:00:00',
            value: 3,
            row_count: 3,
            service_name: 'gateway',
            resource_kind: '*',
            resource_name: '*',
            metric_name: 'telemetry.operation.count',
            unit: 'count',
            result_labels: '{"status":"ok"}',
          },
        ];
      }
      return [];
    });
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client),
    });
    const literal = "gateway' OR 1 = 1";
    const response = await app.handle(
      request(
        `/internal/observability/metrics?from=2026-08-26T00:00:00Z&to=2026-08-26T02:00:00Z&metric=telemetry.operation.count&service=${encodeURIComponent(literal)}&group=service,status&step=300`,
        ['observability:metric:read'],
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          metricName: 'telemetry.operation.count',
          serviceName: 'gateway',
          labels: { status: 'ok' },
        },
      ],
      coverage: { storageStatus: 'available' },
    });
    expect(client.calls).toHaveLength(3);
    expect(client.calls.every((call) => !call.query.includes(literal))).toBe(
      true,
    );
    expect(
      client.calls.every((call) => call.options?.params?.service === literal),
    ).toBe(true);
    const dataQuery = client.calls.find((call) =>
      call.query.includes('toStartOfInterval'),
    );
    expect(dataQuery?.query).toContain('JSONExtractString(labels');
    expect(dataQuery?.query).toContain('sum(`sum`) AS value');
    expect(dataQuery?.query).toContain('sum(`count`) AS row_count');
    expect(dataQuery?.options).toMatchObject({
      params: { stepSeconds: 300 },
    });
    expectRemainingTimeout(dataQuery?.options, 5_000);
  });

  it('keeps unreadable ClickHouse lists explicit and signal detail unavailable', async () => {
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: null,
    });

    const list = await app.handle(
      request('/internal/observability/traces', ['observability:trace:read']),
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      data: [],
      storageStatus: 'blind_spot',
      completeness: 'partial',
    });

    const detail = await app.handle(
      request(`/internal/observability/traces/${'c'.repeat(32)}`, [
        'observability:trace:read',
      ]),
    );
    expect(detail.status).toBe(503);
    expect(await detail.json()).toMatchObject({
      error: { reason: 'observability_storage_blind_spot' },
    });
  });

  it('maps saturated ClickHouse reads to HTTP 429 with Retry-After', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstQueryEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    const client = {
      async queryRows<Row extends object>(): Promise<Row[]> {
        calls += 1;
        if (calls === 1) {
          entered?.();
          await pending;
        }
        return [];
      },
    };
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client, {
        maxConcurrentQueries: 1,
      }),
    });

    const first = app.handle(
      request('/internal/observability/traces', ['observability:trace:read']),
    );
    await firstQueryEntered;
    const saturated = await app.handle(
      request('/internal/observability/traces', ['observability:trace:read']),
    );

    expect(saturated.status).toBe(429);
    expect(saturated.headers.get('retry-after')).toBe('1');
    expect(await saturated.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });

    release?.();
    await first;
  });
});
