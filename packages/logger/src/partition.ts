import { type DatabaseClient, withTransaction } from '#project/database';

/**
 * Whitelist of log tables and their partition key columns. Every partition
 * helper resolves identifiers through this map, so no caller supplied name
 * ever reaches SQL text.
 */
export const LOG_TABLES = {
  audit_trails: 'audited_at',
} as const;

export type LogTable = keyof typeof LOG_TABLES;

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function assertLogTable(table: string): asserts table is LogTable {
  if (!Object.hasOwn(LOG_TABLES, table)) {
    throw new Error(`unknown log table "${table}"`);
  }
}

/** Calendar year in Jakarta (UTC+7) for a UTC timestamp. */
export function jakartaYear(value: string | Date): number {
  const utcMs = value instanceof Date ? value.getTime() : Date.parse(value);

  if (!Number.isFinite(utcMs)) {
    throw new Error(`invalid timestamp "${String(value)}"`);
  }

  return new Date(utcMs + JAKARTA_OFFSET_MS).getUTCFullYear();
}

/**
 * UTC wall time at which the given Jakarta calendar year opens, formatted as
 * 'YYYY-MM-DD HH:mm:ss'. Year 2026 opens at '2025-12-31 17:00:00'.
 */
export function jakartaYearBoundaryUtc(year: number): string {
  if (!Number.isInteger(year)) {
    throw new Error(`invalid partition year "${String(year)}"`);
  }

  const boundary = new Date(Date.UTC(year, 0, 1) - JAKARTA_OFFSET_MS);
  const pad = (part: number) => String(part).padStart(2, '0');

  return (
    `${boundary.getUTCFullYear()}-${pad(boundary.getUTCMonth() + 1)}-` +
    `${pad(boundary.getUTCDate())} ${pad(boundary.getUTCHours())}:` +
    `${pad(boundary.getUTCMinutes())}:${pad(boundary.getUTCSeconds())}`
  );
}

export function logPartitionName(table: LogTable, year: number): string {
  assertLogTable(table);

  if (!Number.isInteger(year)) {
    throw new Error(`invalid partition year "${String(year)}"`);
  }

  return `${table}_${year}`;
}

/**
 * Create the yearly partition child for the timestamp if it does not exist.
 * Idempotent; serialized with pg_advisory_xact_lock so concurrent requests
 * cannot race the CREATE.
 */
export async function ensureLogPartition(
  database: DatabaseClient,
  table: LogTable,
  timestamp: string | Date,
): Promise<void> {
  assertLogTable(table);

  const year = jakartaYear(timestamp);
  const child = logPartitionName(table, year);
  const from = jakartaYearBoundaryUtc(year);
  const to = jakartaYearBoundaryUtc(year + 1);

  await withTransaction(database, async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${child}))`;
    await transaction.unsafe(
      `CREATE TABLE IF NOT EXISTS "partition"."${child}" ` +
        `PARTITION OF "logs"."${table}" ` +
        `FOR VALUES FROM ('${from}') TO ('${to}')`,
    );
  });
}

/**
 * True only for the Postgres error raised when a row has no partition to
 * land in: SQLSTATE 23514 with a "no partition" message. Bun's SQL driver
 * reports the SQLSTATE on `errno` (its `code` is a generic driver constant),
 * so both fields are checked.
 */
export function isMissingLogPartitionError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const { code, errno, message } = error as {
    code?: unknown;
    errno?: unknown;
    message?: unknown;
  };

  return (
    (errno === '23514' || code === '23514') &&
    typeof message === 'string' &&
    message.includes('no partition')
  );
}

/**
 * Run the insert; if it fails because the partition child is missing, create
 * the child and retry exactly once. Any other failure, or a failure of the
 * retried insert, propagates to the caller.
 */
export async function withLogPartitionRecovery<T>(
  database: DatabaseClient,
  table: LogTable,
  timestamp: string | Date,
  insert: () => Promise<T>,
): Promise<T> {
  try {
    return await insert();
  } catch (error) {
    if (!isMissingLogPartitionError(error)) {
      throw error;
    }

    await ensureLogPartition(database, table, timestamp);

    return insert();
  }
}
