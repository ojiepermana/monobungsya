import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import type { SignalBackfillRunInput } from './backfill';
import {
  PostgresSignalBackfillControl,
  type PostgresSignalBackfillControlOptions,
} from './backfill-control-postgres';

const RANGE: SignalBackfillRunInput = {
  kind: 'application_log',
  schemaVersion: 1,
  sourceDay: '2026-08-25',
  sourceFrom: '2026-08-25T00:00:00.000Z',
  sourceTo: '2026-08-26T00:00:00.000Z',
  sampleModulus: 1_000,
};

function migrationRunRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    run_id: '01812345-6789-7abc-8def-0123456789ab',
    signal_kind: 'application_log',
    schema_version: 1,
    source_from: new Date('2026-08-25T00:00:00.000Z'),
    source_to: new Date('2026-08-26T00:00:00.000Z'),
    source_cursor: null,
    source_count: 0,
    target_count: 0,
    sample_modulus: 1_000,
    source_checksum: null,
    target_checksum: null,
    status: 'pending',
    error_code: null,
    ...overrides,
  };
}

interface Query {
  sql: string;
  params: unknown[];
}

interface FakeDatabaseConnection {
  begin<T>(
    operation: (transaction: FakeDatabaseConnection) => Promise<T>,
  ): Promise<T>;
  unsafe(sql: string, params?: unknown[]): Promise<unknown[]>;
}

function fakeControlDatabase(responses: unknown[][]): {
  database: DatabaseClient;
  queries: Query[];
} {
  const queries: Query[] = [];
  const connection: FakeDatabaseConnection = {
    begin: async <T>(
      operation: (transaction: FakeDatabaseConnection) => Promise<T>,
    ): Promise<T> => await operation(connection),
    unsafe: async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
      queries.push({ sql, params });
      const response = responses.shift();
      if (!response) throw new Error('unexpected SQL query');
      return response;
    },
  };
  return { database: connection as unknown as DatabaseClient, queries };
}

function controlOptions(
  database: DatabaseClient,
): PostgresSignalBackfillControlOptions {
  return {
    controlDatabase: database,
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  };
}

describe('PostgresSignalBackfillControl', () => {
  test('reads or creates one UTC day run and persists only canonical checkpoints', async () => {
    const fake = fakeControlDatabase([
      [],
      [migrationRunRow()],
      [{ run_id: '01812345-6789-7abc-8def-0123456789ab' }],
      [{ run_id: '01812345-6789-7abc-8def-0123456789ab' }],
    ]);
    const control = new PostgresSignalBackfillControl(
      controlOptions(fake.database),
    );

    await expect(control.getOrCreate(RANGE)).resolves.toMatchObject({
      runId: '01812345-6789-7abc-8def-0123456789ab',
      sourceFrom: RANGE.sourceFrom,
      sourceTo: RANGE.sourceTo,
      sourceCursor: null,
      status: 'pending',
    });
    await control.markRunning('01812345-6789-7abc-8def-0123456789ab');
    await control.checkpoint('01812345-6789-7abc-8def-0123456789ab', {
      sourceCursor: { id: 'cursor-1', at: 1 },
      sourceCount: 25,
    });

    expect(fake.queries[0]?.sql).toContain(
      'SELECT run_id, signal_kind, schema_version',
    );
    expect(fake.queries[1]?.sql).toContain(
      'INSERT INTO telemetry.signal_migration_runs',
    );
    expect(fake.queries[1]?.params).toEqual([
      RANGE.kind,
      RANGE.schemaVersion,
      RANGE.sourceFrom,
      RANGE.sourceTo,
      RANGE.sampleModulus,
    ]);
    expect(fake.queries[3]?.params).toEqual([
      '01812345-6789-7abc-8def-0123456789ab',
      '{"at":1,"id":"cursor-1"}',
      25,
    ]);
    expect(fake.queries[3]?.sql).toContain('source_cursor = $2::jsonb');
  });

  test('fails closed when a Control state transition does not update exactly one row', async () => {
    const fake = fakeControlDatabase([[]]);
    const control = new PostgresSignalBackfillControl(
      controlOptions(fake.database),
    );

    await expect(
      control.pause('01812345-6789-7abc-8def-0123456789ab', 'disk_usage'),
    ).rejects.toThrow('state transition was not applied');
  });
});
