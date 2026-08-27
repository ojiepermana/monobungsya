import { describe, expect, it } from 'bun:test';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import { ValidationError } from '#project/errors';
import { ClickHouseSignalReader } from '#project/observability';
import { createApp } from '../app';
import { ClickHouseLogsSignalReader } from '../modules/logs/logs.clickhouse';

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

const SIGNING_SECRET = 'clickhouse-logs-read-test-secret';

function testEnv() {
  return loadEnv('logs', {
    NODE_ENV: 'test',
    PORT: '3103',
    INTERNAL_AUTH_SIGNING_SECRET: SIGNING_SECRET,
  });
}

function request(path: string): Request {
  const url = new URL(path, 'http://localhost');
  const identity = {
    userId: '0198f8a0-0000-7000-8000-000000000001',
    email: 'operator@project.local',
    permissions: ['logs:log:read'],
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

function uuid(index: number): string {
  return `0198f8a0-0000-7000-8000-${String(index).padStart(12, '0')}`;
}

function applicationRow(index: number) {
  const second = String(index % 60).padStart(2, '0');
  return {
    id: uuid(index),
    level: 'error',
    channel: 'application',
    category: 'application',
    event: 'invoice.failed',
    module: 'billing',
    message: `invoice ${index} failed`,
    context: '{"invoiceId":42}',
    exception_class: 'DatabaseError',
    exception_message: 'connection refused',
    stack_trace: 'at main.ts:1',
    actor_user_id: '0198f8a0-0000-7000-8000-000000000001',
    actor_name: 'Jane',
    actor_email: 'jane@example.com',
    occurred_at: `2026-08-26 10:00:${second}.000000`,
    created_at: `2026-08-26 10:00:${second}.000000`,
  };
}

describe('ClickHouse log Signal reads', () => {
  it('shares one deadline between option and page subqueries', async () => {
    let now = 0;
    const client = new FakeClickHouseClient((call) => {
      now += 3_000;
      if (call.query.includes('groupUniqArray')) {
        return [{ levels: [], modules: [], events: [] }];
      }
      return [];
    });
    const reader = new ClickHouseLogsSignalReader(
      new ClickHouseSignalReader(client, { now: () => now }),
    );

    await reader.listApplicationLogs({
      from: new Date('2026-08-26T09:00:00.000Z'),
      to: new Date('2026-08-26T10:00:00.000Z'),
      search: '',
      level: '',
      module: '',
      event: '',
      actorUserId: '',
    });

    expect(client.calls.map((call) => call.options?.timeoutMs)).toEqual([
      5_000, 2_000,
    ]);
    expect(
      client.calls.map((call) => call.options?.settings?.max_execution_time),
    ).toEqual([5, 2]);
  });

  it('returns a Blind Spot when the shared deadline is exhausted', async () => {
    let now = 0;
    const client = new FakeClickHouseClient((call) => {
      now += 5_000;
      if (call.query.includes('groupUniqArray')) {
        return [{ levels: [], modules: [], events: [] }];
      }
      return [];
    });
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client, {
        now: () => now,
      }),
    });

    const response = await app.handle(
      request('/internal/logs/application-logs'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [],
      storageStatus: 'blind_spot',
    });
    expect(client.calls).toHaveLength(1);
  });

  it('uses a versioned filter-bound keyset cursor in both directions', async () => {
    const firstRows = Array.from({ length: 101 }, (_, offset) =>
      applicationRow(201 - offset),
    );
    const nextRows = Array.from({ length: 101 }, (_, offset) =>
      applicationRow(100 - offset),
    );
    const previousRows = Array.from({ length: 101 }, (_, offset) =>
      applicationRow(102 + offset),
    );
    const client = new FakeClickHouseClient((call) => {
      if (call.query.includes('groupUniqArray')) {
        return [
          {
            levels: ['error'],
            modules: ['billing'],
            events: ['invoice.failed'],
          },
        ];
      }
      if (call.query.includes('ORDER BY occurred_at ASC')) return previousRows;
      if (call.options?.params?.cursorStableId) return nextRows;
      return firstRows;
    });
    const reader = new ClickHouseLogsSignalReader(
      new ClickHouseSignalReader(client),
    );
    const range = {
      from: new Date('2026-08-26T09:00:00Z'),
      to: new Date('2026-08-26T10:00:00Z'),
    };
    const injection = "billing' OR 1 = 1";
    const first = await reader.listApplicationLogs({
      ...range,
      search: injection,
      level: 'error',
      module: 'billing',
      event: 'invoice.failed',
      actorUserId: '',
    });

    expect(first.data).toHaveLength(100);
    expect(first.data[0]?.id).toBe(uuid(201));
    expect(first.nextCursor).toBeString();
    expect(first.prevCursor).toBeNull();
    expect(client.calls).toHaveLength(2);
    expect(client.calls.every((call) => !call.query.includes(injection))).toBe(
      true,
    );
    const firstDataQuery = client.calls[1];
    expect(firstDataQuery?.query).toContain('observability.application_logs');
    expect(firstDataQuery?.query).toContain('LIMIT 1 BY id, occurred_at');
    expect(firstDataQuery?.query).toContain("DateTime64(6, 'UTC')");
    expect(firstDataQuery?.options).toMatchObject({
      params: { search: injection, level: 'error', module: 'billing' },
    });
    expectRemainingTimeout(firstDataQuery?.options, 5_000);

    const next = await reader.listApplicationLogs({
      ...range,
      search: injection,
      level: 'error',
      module: 'billing',
      event: 'invoice.failed',
      actorUserId: '',
      cursor: first.nextCursor ?? undefined,
    });
    expect(next.data[0]?.id).toBe(uuid(100));
    expect(next.prevCursor).toBeString();
    expect(next.nextCursor).toBeString();

    const previous = await reader.listApplicationLogs({
      ...range,
      search: injection,
      level: 'error',
      module: 'billing',
      event: 'invoice.failed',
      actorUserId: '',
      cursor: next.prevCursor ?? undefined,
    });
    expect(previous.data.map((row) => row.id)).toEqual(
      first.data.map((row) => row.id),
    );

    await expect(
      reader.listApplicationLogs({
        ...range,
        search: injection,
        level: 'info',
        module: 'billing',
        event: 'invoice.failed',
        actorUserId: '',
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps different event times for the same id in both Signal log lists', async () => {
    const stableId = uuid(100);
    const applicationRows = [
      {
        ...applicationRow(2),
        id: stableId,
        message: 'latest write for the later event',
        occurred_at: '2026-08-26 10:01:00.000000',
        created_at: '2026-08-26 10:01:00.000000',
      },
      {
        ...applicationRow(1),
        id: stableId,
        message: 'latest write for the earlier event',
        occurred_at: '2026-08-26 10:00:00.000000',
        created_at: '2026-08-26 10:00:00.000000',
      },
    ];
    const accessRows = [
      {
        id: stableId,
        event: 'request_completed',
        outcome: 'success',
        route_name: '/api/v1/invoices/42',
        path: '/api/v1/invoices/42',
        method: 'GET',
        http_status: 200,
        request_id: 'request-later',
        trace_id: 'request-later',
        session_id: null,
        metadata: null,
        actor_email: 'operator@example.com',
        failure_reason: null,
        accessed_at: '2026-08-26 10:01:00.000000',
      },
      {
        id: stableId,
        event: 'request_started',
        outcome: 'success',
        route_name: '/api/v1/invoices/42',
        path: '/api/v1/invoices/42',
        method: 'GET',
        http_status: 200,
        request_id: 'request-earlier',
        trace_id: 'request-earlier',
        session_id: null,
        metadata: null,
        actor_email: 'operator@example.com',
        failure_reason: null,
        accessed_at: '2026-08-26 10:00:00.000000',
      },
    ];
    const client = new FakeClickHouseClient((call) => {
      if (call.query.includes('groupUniqArray')) {
        return call.query.includes('application_logs')
          ? [
              {
                levels: ['error'],
                modules: ['billing'],
                events: ['invoice.failed'],
              },
            ]
          : [
              {
                events: ['request_completed', 'request_started'],
                outcomes: ['success'],
              },
            ];
      }
      if (call.query.includes('observability.application_logs')) {
        return call.query.includes('LIMIT 1 BY id, occurred_at')
          ? applicationRows
          : applicationRows.slice(0, 1);
      }
      if (call.query.includes('observability.access_logs')) {
        return call.query.includes('LIMIT 1 BY id, accessed_at')
          ? accessRows
          : accessRows.slice(0, 1);
      }
      return [];
    });
    const reader = new ClickHouseLogsSignalReader(
      new ClickHouseSignalReader(client),
    );
    const range = {
      from: new Date('2026-08-26T09:00:00.000Z'),
      to: new Date('2026-08-26T11:00:00.000Z'),
    };

    const application = await reader.listApplicationLogs({
      ...range,
      search: '',
      level: '',
      module: '',
      event: '',
      actorUserId: '',
    });
    const access = await reader.listAccessLogs({
      ...range,
      search: '',
      event: '',
      outcome: '',
      traceId: '',
      actorUserId: '',
    });

    expect(application.data.map((row) => [row.id, row.occurredAt])).toEqual([
      [stableId, '2026-08-26T10:01:00.000Z'],
      [stableId, '2026-08-26T10:00:00.000Z'],
    ]);
    expect(application.data.map((row) => row.message)).toEqual([
      'latest write for the later event',
      'latest write for the earlier event',
    ]);
    expect(access.data.map((row) => [row.event, row.accessedAt])).toEqual([
      ['request_completed', '2026-08-26T10:01:00.000Z'],
      ['request_started', '2026-08-26T10:00:00.000Z'],
    ]);
  });

  it('uses the access Signal table and returns its cursor contract from the route', async () => {
    const client = new FakeClickHouseClient((call) => {
      if (call.query.includes('groupUniqArray')) {
        return [{ events: ['api_request'], outcomes: ['success'] }];
      }
      return [
        {
          id: uuid(99),
          event: 'api_request',
          outcome: 'success',
          route_name: '/api/v1/users',
          path: '/api/v1/users',
          method: 'GET',
          http_status: 200,
          request_id: 'request-123',
          trace_id: 'request-123',
          session_id: null,
          metadata: null,
          actor_email: 'admin@example.com',
          failure_reason: null,
          accessed_at: '2026-08-25 10:00:00.000000',
        },
      ];
    });
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client),
    });
    const to = new Date(Date.now() - 60_000);
    const from = new Date(to.getTime() - 48 * 60 * 60 * 1_000);
    const literal = "access' OR 1 = 1";
    const response = await app.handle(
      request(
        `/internal/logs/access-logs?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&search=${encodeURIComponent(literal)}&event=api_request&traceId=request-123`,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          event: 'api_request',
          traceSource: 'request_id',
          accessedAt: '2026-08-25T10:00:00.000Z',
        },
      ],
      prevCursor: null,
      nextCursor: null,
      filters: { search: literal, event: 'api_request' },
      options: { events: ['api_request'], outcomes: ['success'] },
      storageStatus: 'available',
    });
    expect(body).not.toHaveProperty('meta');
    expect(client.calls).toHaveLength(2);
    expect(client.calls.every((call) => !call.query.includes(literal))).toBe(
      true,
    );
    const dataQuery = client.calls[1];
    expect(dataQuery?.query).toContain('observability.access_logs');
    expect(dataQuery?.query).toContain('LIMIT 1 BY id, accessed_at');
    expect(dataQuery?.options).toMatchObject({
      params: { search: literal, event: 'api_request', traceId: 'request-123' },
    });
    expectRemainingTimeout(dataQuery?.options, 10_000);
  });

  it('keeps unavailable Signal lists explicit without changing PostgreSQL audit behavior', async () => {
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: null,
    });

    const application = await app.handle(
      request('/internal/logs/application-logs'),
    );
    expect(application.status).toBe(200);
    const applicationBody = await application.json();
    expect(applicationBody).toMatchObject({
      data: [],
      prevCursor: null,
      nextCursor: null,
      filters: { search: '', level: '', module: '', event: '' },
      options: { levels: [], modules: [], events: [] },
      storageStatus: 'blind_spot',
    });
    expect(applicationBody.blindSpotSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const audit = await app.handle(request('/internal/logs/audit-trails'));
    expect(audit.status).toBe(200);
    expect(await audit.json()).toEqual({
      data: [],
      meta: { page: 1, perPage: 100, total: 0, totalPages: 0 },
      filters: { search: '', module: '', action: '' },
      options: { modules: [], actions: [] },
    });
  });

  it('turns an unreadable ClickHouse Signal list into a blind spot', async () => {
    const client = new FakeClickHouseClient(() => {
      throw new Error('ClickHouse is unreachable');
    });
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client),
    });

    const response = await app.handle(request('/internal/logs/access-logs'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [],
      prevCursor: null,
      nextCursor: null,
      filters: { search: '', event: '', outcome: '', traceId: '' },
      options: { events: [], outcomes: [] },
      storageStatus: 'blind_spot',
    });
    expect(body.blindSpotSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects an invalid Signal range or cursor with 422 before querying ClickHouse', async () => {
    const client = new FakeClickHouseClient(() => []);
    const app = createApp(testEnv(), {
      observabilityReadMode: 'clickhouse',
      clickhouseReader: new ClickHouseSignalReader(client),
    });
    const now = Date.now();
    const expiredFrom = new Date(now - 31 * 24 * 60 * 60 * 1_000);
    const expiredTo = new Date(now - 60_000);
    const rangeResponse = await app.handle(
      request(
        `/internal/logs/application-logs?from=${encodeURIComponent(expiredFrom.toISOString())}&to=${encodeURIComponent(expiredTo.toISOString())}`,
      ),
    );
    expect(rangeResponse.status).toBe(422);
    expect(await rangeResponse.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const cursorResponse = await app.handle(
      request('/internal/logs/access-logs?cursor=not-a-valid-cursor'),
    );
    expect(cursorResponse.status).toBe(422);
    expect(await cursorResponse.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(client.calls).toHaveLength(0);
  });

  it('maps an immediately saturated ClickHouse Signal read to 429 Retry-After', async () => {
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

    const first = app.handle(request('/internal/logs/application-logs'));
    await firstQueryEntered;
    const saturated = await app.handle(request('/internal/logs/access-logs'));

    expect(saturated.status).toBe(429);
    expect(saturated.headers.get('retry-after')).toBe('1');
    expect(await saturated.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });

    release?.();
    await first;
  });
});
