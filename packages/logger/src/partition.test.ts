import { describe, expect, it } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import {
  ensureLogPartition,
  isMissingLogPartitionError,
  jakartaYear,
  jakartaYearBoundaryUtc,
  logPartitionName,
  withLogPartitionRecovery,
} from './partition';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function createFakeDatabase(
  onQuery?: (query: RecordedQuery) => Promise<unknown> | unknown,
) {
  const queries: RecordedQuery[] = [];

  const record = (query: RecordedQuery) => {
    queries.push(query);
    return Promise.resolve(onQuery ? onQuery(query) : []);
  };

  const fake = (strings: TemplateStringsArray, ...values: unknown[]) =>
    record({ text: strings.join('?'), values });
  fake.unsafe = (text: string) => record({ text, values: [] });
  fake.begin = async (operation: (transaction: unknown) => Promise<unknown>) =>
    operation(fake);

  return { database: fake as unknown as DatabaseClient, queries };
}

describe('jakartaYear', () => {
  it('keeps the year before the Jakarta boundary', () => {
    expect(jakartaYear('2025-12-31T16:59:59.999Z')).toBe(2025);
  });

  it('rolls to the next year exactly at the Jakarta boundary', () => {
    expect(jakartaYear('2025-12-31T17:00:00.000Z')).toBe(2026);
  });

  it('accepts Date values', () => {
    expect(jakartaYear(new Date('2026-06-15T00:00:00.000Z'))).toBe(2026);
  });

  it('rejects invalid timestamps', () => {
    expect(() => jakartaYear('not-a-date')).toThrow('invalid timestamp');
  });
});

describe('jakartaYearBoundaryUtc', () => {
  it('opens 2026 at 2025-12-31 17:00:00 UTC wall time', () => {
    expect(jakartaYearBoundaryUtc(2026)).toBe('2025-12-31 17:00:00');
  });

  it('opens 2025 at 2024-12-31 17:00:00 UTC wall time', () => {
    expect(jakartaYearBoundaryUtc(2025)).toBe('2024-12-31 17:00:00');
  });
});

describe('logPartitionName', () => {
  it('joins the table and year', () => {
    expect(logPartitionName('audit_trails', 2026)).toBe('audit_trails_2026');
  });

  it('rejects tables outside the whitelist', () => {
    expect(() =>
      logPartitionName('users; DROP TABLE x' as never, 2026),
    ).toThrow('unknown log table');
  });
});

describe('isMissingLogPartitionError', () => {
  it('matches code 23514 with a no partition message', () => {
    expect(
      isMissingLogPartitionError({
        code: '23514',
        message: 'no partition of relation "logging" found for row',
      }),
    ).toBe(true);
  });

  it('matches the Bun SQL error shape, where the SQLSTATE lives on errno', () => {
    expect(
      isMissingLogPartitionError({
        code: 'ERR_POSTGRES_SERVER_ERROR',
        errno: '23514',
        message: 'no partition of relation "logging" found for row',
      }),
    ).toBe(true);
  });

  it('rejects other codes even with the message', () => {
    expect(
      isMissingLogPartitionError({
        code: '23505',
        message: 'no partition of relation "logging" found for row',
      }),
    ).toBe(false);
  });

  it('rejects code 23514 with a different message', () => {
    expect(
      isMissingLogPartitionError({
        code: '23514',
        message: 'check constraint violated',
      }),
    ).toBe(false);
  });

  it('rejects non object errors', () => {
    expect(isMissingLogPartitionError(null)).toBe(false);
    expect(isMissingLogPartitionError('no partition')).toBe(false);
  });
});

describe('ensureLogPartition', () => {
  it('serializes with an advisory lock and creates the yearly child', async () => {
    const { database, queries } = createFakeDatabase();

    await ensureLogPartition(database, 'logging', '2026-03-01T10:00:00.000Z');

    expect(queries[0]?.text).toContain('pg_advisory_xact_lock');
    expect(queries[0]?.values).toEqual(['logging_2026']);
    expect(queries[1]?.text).toBe(
      'CREATE TABLE IF NOT EXISTS "partition"."logging_2026" ' +
        'PARTITION OF "logs"."logging" ' +
        "FOR VALUES FROM ('2025-12-31 17:00:00') TO ('2026-12-31 17:00:00')",
    );
  });

  it('rejects tables outside the whitelist', async () => {
    const { database } = createFakeDatabase();

    await expect(
      ensureLogPartition(
        database,
        'schema_migrations' as never,
        '2026-03-01T10:00:00.000Z',
      ),
    ).rejects.toThrow('unknown log table');
  });
});

describe('withLogPartitionRecovery', () => {
  const missingPartition = Object.assign(
    new Error('no partition of relation "logging" found for row'),
    { code: '23514' },
  );

  it('returns the insert result when nothing fails', async () => {
    const { database } = createFakeDatabase();

    const result = await withLogPartitionRecovery(
      database,
      'logging',
      '2026-03-01T10:00:00.000Z',
      async () => 'inserted',
    );

    expect(result).toBe('inserted');
  });

  it('creates the partition and retries once on a missing partition', async () => {
    const { database, queries } = createFakeDatabase();
    let attempts = 0;

    const result = await withLogPartitionRecovery(
      database,
      'logging',
      '2026-03-01T10:00:00.000Z',
      async () => {
        attempts += 1;
        if (attempts === 1) throw missingPartition;
        return 'inserted';
      },
    );

    expect(result).toBe('inserted');
    expect(attempts).toBe(2);
    expect(queries.some((query) => query.text.includes('CREATE TABLE'))).toBe(
      true,
    );
  });

  it('propagates a second failure without another retry', async () => {
    const { database } = createFakeDatabase();
    let attempts = 0;

    await expect(
      withLogPartitionRecovery(
        database,
        'logging',
        '2026-03-01T10:00:00.000Z',
        async () => {
          attempts += 1;
          throw missingPartition;
        },
      ),
    ).rejects.toThrow('no partition');
    expect(attempts).toBe(2);
  });

  it('propagates unrelated errors without recovery', async () => {
    const { database, queries } = createFakeDatabase();

    await expect(
      withLogPartitionRecovery(
        database,
        'logging',
        '2026-03-01T10:00:00.000Z',
        async () => {
          throw new Error('connection refused');
        },
      ),
    ).rejects.toThrow('connection refused');
    expect(queries).toHaveLength(0);
  });
});
