import { describe, expect, test } from 'bun:test';
import type { ClickHouseRequest } from './clickhouse';
import {
  type ClickHouseSignalReadDeadlineError,
  ClickHouseSignalReader,
  type ClickHouseSignalReadQuotaError,
} from './reader';

interface CapturedRequest {
  query: string;
  options: Omit<ClickHouseRequest, 'query' | 'body'> | undefined;
}

function queryClient(
  queryRows: <Row extends object>(
    query: string,
    options?: Omit<ClickHouseRequest, 'query' | 'body'>,
  ) => Promise<Row[]>,
) {
  return { queryRows };
}

describe('ClickHouseSignalReader', () => {
  test('uses five seconds through exactly a 24 hour range and ten seconds above it', async () => {
    const requests: CapturedRequest[] = [];
    const reader = new ClickHouseSignalReader(
      queryClient(async (query, options) => {
        requests.push({ query, options });
        return [];
      }),
    );

    await reader.queryRows('SELECT 1', {
      range: {
        start: '2026-08-25T00:00:00.000Z',
        end: '2026-08-26T00:00:00.000Z',
      },
    });
    await reader.queryRows('SELECT 1', {
      range: {
        start: '2026-08-25T00:00:00.000Z',
        end: '2026-08-26T00:00:00.001Z',
      },
    });

    expect(requests.map((request) => request.options?.timeoutMs)).toEqual([
      5_000, 10_000,
    ]);
  });

  test('keeps bound values while enforcing bounded read-only ClickHouse settings', async () => {
    const requests: CapturedRequest[] = [];
    const reader = new ClickHouseSignalReader(
      queryClient(async (query, options) => {
        requests.push({ query, options });
        return [];
      }),
    );

    await expect(
      reader.queryRows<{ trace_id: string }>(
        'SELECT trace_id FROM observability.spans WHERE started_at >= {start:DateTime64(6)}',
        {
          range: {
            start: '2026-08-26T00:00:00.000Z',
            end: '2026-08-26T01:00:00.000Z',
          },
          params: { start: '2026-08-26 00:00:00.000000' },
          settings: { max_execution_time: 5 },
          database: 'observability',
        },
      ),
    ).resolves.toEqual([]);

    expect(requests).toEqual([
      {
        query:
          'SELECT trace_id FROM observability.spans WHERE started_at >= {start:DateTime64(6)}',
        options: {
          params: { start: '2026-08-26 00:00:00.000000' },
          settings: {
            max_execution_time: 5,
            max_memory_usage: 536_870_912,
            max_result_bytes: 16_777_216,
            max_result_rows: 10_000,
            max_threads: 4,
            readonly: 1,
            result_overflow_mode: 'throw',
          },
          database: 'observability',
          timeoutMs: 5_000,
        },
      },
    ]);
  });

  test('rejects immediately with a safe retryable quota error when all slots are occupied', async () => {
    let release: (() => void) | undefined;
    let enteredCount = 0;
    let allSlotsEntered: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      allSlotsEntered = resolve;
    });
    const reader = new ClickHouseSignalReader(
      queryClient(async () => {
        enteredCount += 1;
        if (enteredCount === 8) allSlotsEntered?.();
        await active;
        return [];
      }),
    );
    const options = {
      range: {
        start: '2026-08-26T00:00:00.000Z',
        end: '2026-08-26T01:00:00.000Z',
      },
    };

    const activeQueries = Array.from({ length: 8 }, () =>
      reader.queryRows('SELECT 1', options),
    );
    await entered;

    await expect(reader.queryRows('SELECT 1', options)).rejects.toMatchObject({
      code: 'observability_query_concurrency_exhausted',
      status: 429,
      retryAfterSeconds: 1,
      message: 'Observability query capacity is temporarily unavailable',
    } satisfies Partial<ClickHouseSignalReadQuotaError>);

    release?.();
    await Promise.all(activeQueries);
    await expect(reader.queryRows('SELECT 1', options)).resolves.toEqual([]);
  });
  test('shares one request deadline across subqueries and fails safely when it is exhausted', async () => {
    let now = 10_000;
    const requests: CapturedRequest[] = [];
    const reader = new ClickHouseSignalReader(
      queryClient(async (query, options) => {
        requests.push({ query, options });
        return [];
      }),
      { now: () => now },
    );
    const range = {
      start: '2026-08-26T00:00:00.000Z',
      end: '2026-08-26T01:00:00.000Z',
    };
    const deadline = reader.createDeadline(range);

    await reader.queryRows('SELECT options', { range, deadline });
    now += 2_000;
    await reader.queryRows('SELECT rows', { range, deadline });
    now += 3_000;

    await expect(
      reader.queryRows('SELECT must not start', { range, deadline }),
    ).rejects.toMatchObject({
      code: 'observability_query_deadline_exhausted',
      message: 'Observability query deadline was exceeded',
    } satisfies Partial<ClickHouseSignalReadDeadlineError>);

    expect(requests.map((request) => request.options?.timeoutMs)).toEqual([
      5_000, 3_000,
    ]);
    expect(
      requests.map((request) => request.options?.settings?.max_execution_time),
    ).toEqual([5, 3]);
  });
});
