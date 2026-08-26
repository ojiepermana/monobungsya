import type { ClickHouseClient, ClickHouseRequest } from './clickhouse';

const SHORT_RANGE_LIMIT_MS = 24 * 60 * 60 * 1_000;
const SHORT_RANGE_TIMEOUT_MS = 5_000;
const LONG_RANGE_TIMEOUT_MS = 10_000;
const READ_ONLY_SETTINGS = {
  max_memory_usage: 536_870_912,
  max_result_bytes: 16_777_216,
  max_result_rows: 10_000,
  max_threads: 4,
  readonly: 1,
  result_overflow_mode: 'throw',
} as const;

export interface ClickHouseSignalReadRange {
  start: Date | string;
  end: Date | string;
}

export interface ClickHouseSignalQueryOptions
  extends Omit<ClickHouseRequest, 'query' | 'body' | 'timeoutMs'> {
  range: ClickHouseSignalReadRange;
  /** Reuse this object for every physical query in one public logical read. */
  deadline?: ClickHouseSignalReadDeadline;
}

export interface ClickHouseSignalReaderOptions {
  maxConcurrentQueries?: number;
  /** Injected for deterministic deadline accounting in callers and tests. */
  now?: () => number;
}

/**
 * An absolute monotonic deadline for one public logical Signal query. It is
 * created by the reader so callers cannot accidentally reset a subquery budget.
 */
export interface ClickHouseSignalReadDeadline {
  readonly expiresAt: number;
}

interface ClickHouseSignalQueryClient {
  queryRows<Row extends object>(
    query: string,
    options?: Omit<ClickHouseRequest, 'query' | 'body'>,
  ): Promise<Row[]>;
}

/**
 * Deliberately safe for transport mapping: it gives callers the public HTTP
 * semantics without including query shape, credentials, or storage details.
 */
export class ClickHouseSignalReadQuotaError extends Error {
  readonly code = 'observability_query_concurrency_exhausted';
  readonly status = 429;
  readonly retryAfterSeconds = 1;

  constructor() {
    super('Observability query capacity is temporarily unavailable');
    this.name = 'ClickHouseSignalReadQuotaError';
  }
}

export class ClickHouseSignalReadRangeError extends Error {
  readonly code = 'observability_query_range_invalid';

  constructor() {
    super('Observability query range is invalid');
    this.name = 'ClickHouseSignalReadRangeError';
  }
}

/**
 * Safe transport-neutral failure. List callers turn it into a Blind Spot and
 * detail callers map it to their existing storage-unavailable response.
 */
export class ClickHouseSignalReadDeadlineError extends Error {
  readonly code = 'observability_query_deadline_exhausted';

  constructor() {
    super('Observability query deadline was exceeded');
    this.name = 'ClickHouseSignalReadDeadlineError';
  }
}

function milliseconds(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ClickHouseSignalReadRangeError();
  }
  return timestamp;
}

export function clickHouseSignalQueryTimeoutMs(
  range: ClickHouseSignalReadRange,
): number {
  const start = milliseconds(range.start);
  const end = milliseconds(range.end);
  if (end < start) {
    throw new ClickHouseSignalReadRangeError();
  }
  return end - start <= SHORT_RANGE_LIMIT_MS
    ? SHORT_RANGE_TIMEOUT_MS
    : LONG_RANGE_TIMEOUT_MS;
}

/**
 * One bounded, non-queuing gate for Signal reads. The reader owns deadline
 * selection, while the caller owns only allowlisted query text and bound
 * values.
 */
export class ClickHouseSignalReader {
  private readonly maxConcurrentQueries: number;
  private readonly now: () => number;
  private activeQueries = 0;

  constructor(
    private readonly client: ClickHouseSignalQueryClient | ClickHouseClient,
    options: ClickHouseSignalReaderOptions = {},
  ) {
    this.maxConcurrentQueries = options.maxConcurrentQueries ?? 8;
    this.now = options.now ?? (() => performance.now());
    if (
      !Number.isSafeInteger(this.maxConcurrentQueries) ||
      this.maxConcurrentQueries < 1
    ) {
      throw new Error('maxConcurrentQueries must be a positive integer');
    }
  }

  /** Starts the one hard deadline shared by a public logical Signal read. */
  createDeadline(
    range: ClickHouseSignalReadRange,
  ): ClickHouseSignalReadDeadline {
    return {
      expiresAt: this.now() + clickHouseSignalQueryTimeoutMs(range),
    };
  }

  async queryRows<Row extends object>(
    query: string,
    options: ClickHouseSignalQueryOptions,
  ): Promise<Row[]> {
    if (this.activeQueries >= this.maxConcurrentQueries) {
      throw new ClickHouseSignalReadQuotaError();
    }

    this.activeQueries += 1;
    try {
      const { range, deadline: suppliedDeadline, ...request } = options;
      const timeoutMs = suppliedDeadline
        ? this.remainingTimeoutMs(suppliedDeadline)
        : clickHouseSignalQueryTimeoutMs(range);
      return await this.client.queryRows<Row>(query, {
        ...request,
        settings: {
          ...request.settings,
          ...READ_ONLY_SETTINGS,
          max_execution_time: timeoutMs / 1_000,
        },
        timeoutMs,
      });
    } finally {
      this.activeQueries -= 1;
    }
  }

  private remainingTimeoutMs(deadline: ClickHouseSignalReadDeadline): number {
    const remaining = Math.floor(deadline.expiresAt - this.now());
    if (remaining < 1) throw new ClickHouseSignalReadDeadlineError();
    return remaining;
  }
}
