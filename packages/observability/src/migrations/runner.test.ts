import { describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '#project/database';
import type { ClickHouseClient } from '../clickhouse';
import { type ClickHouseMigration, sha256 } from './discovery';
import {
  assertClickHouseMigrationTargetStable,
  clickHouseGrantIncludes,
  clickHouseMigrationLockKey,
  parseClickHouseMigrationTargetId,
  planClickHouseMigrations,
  runClickHouseMigrations,
} from './runner';

const migrations: ClickHouseMigration[] = [
  {
    version: 1,
    name: 'create_database',
    sql: 'CREATE DATABASE observability',
    checksum: sha256('CREATE DATABASE observability'),
  },
  {
    version: 2,
    name: 'create_spans',
    sql: 'CREATE TABLE observability.spans',
    checksum: sha256('CREATE TABLE observability.spans'),
  },
];
const PINNED_CLICKHOUSE_VERSION = '26.3.17.110';
const FIRST_TARGET_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_TARGET_ID = '22222222-2222-4222-8222-222222222222';

function fakeControlDatabase(options: {
  lockKeys: string[];
  historyInserts: unknown[][];
}): DatabaseClient {
  const transaction = Object.assign(
    (_strings: TemplateStringsArray, ...values: unknown[]) => {
      options.lockKeys.push(String(values[0]));
      return Promise.resolve([]);
    },
    {
      unsafe: async (query: string, values?: readonly unknown[]) => {
        if (query.startsWith('SELECT target_id')) return [];
        if (
          query.startsWith('INSERT INTO telemetry.signal_schema_migrations')
        ) {
          options.historyInserts.push([...(values ?? [])]);
        }
        return [];
      },
    },
  ) as unknown as DatabaseClient;
  return {
    begin: async (operation: (database: DatabaseClient) => Promise<unknown>) =>
      await operation(transaction),
  } as unknown as DatabaseClient;
}

function fakeMigrationClient(
  targetIds: readonly string[],
  executedQueries: string[],
): ClickHouseClient {
  let targetIndex = 0;
  return {
    queryRows: async (query: string) => {
      if (query.includes('toString(serverUUID())')) {
        const targetId = targetIds[targetIndex] ?? FIRST_TARGET_ID;
        targetIndex += 1;
        return [{ version: PINNED_CLICKHOUSE_VERSION, target_id: targetId }];
      }
      throw new Error(`Unexpected ClickHouse query in target test: ${query}`);
    },
    execute: async ({ query }: { query: string }) => {
      executedQueries.push(query);
      return '';
    },
  } as unknown as ClickHouseClient;
}

describe('ClickHouse migration plan', () => {
  test('accepts a privilege combined into one ClickHouse grant statement', () => {
    expect(
      clickHouseGrantIncludes(
        'GRANT ALTER MODIFY COMMENT, CREATE DATABASE, CREATE TABLE ON observability.* TO project_observability_migrator',
        'create table on observability.*',
      ),
    ).toBe(true);
    expect(
      clickHouseGrantIncludes(
        'GRANT ALTER MODIFY COMMENT, CREATE DATABASE, CREATE TABLE ON observability.* TO project_observability_migrator',
        'alter modify comment on observability.*',
      ),
    ).toBe(true);
    expect(
      clickHouseGrantIncludes(
        'GRANT CREATE DATABASE, CREATE TABLE ON observability.* TO project_observability_migrator',
        'alter modify comment on observability.*',
      ),
    ).toBe(false);
  });

  test('applies only migrations that are not in immutable control history', () => {
    expect(
      planClickHouseMigrations(
        migrations,
        [
          {
            target_id: FIRST_TARGET_ID,
            version: 1,
            name: 'create_database',
            checksum: sha256('CREATE DATABASE observability'),
            clickhouse_version: '26.3.17.110',
          },
        ],
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toEqual([expect.objectContaining({ version: 2 })]);
  });

  test('accepts a decimal migration version returned by the database driver', () => {
    expect(
      planClickHouseMigrations(
        migrations,
        [
          {
            target_id: FIRST_TARGET_ID,
            version: '1' as unknown as number,
            name: 'create_database',
            checksum: sha256('CREATE DATABASE observability'),
            clickhouse_version: PINNED_CLICKHOUSE_VERSION,
          },
        ],
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toEqual([expect.objectContaining({ version: 2 })]);
  });

  test('rejects changed contents of an applied migration', () => {
    expect(() =>
      planClickHouseMigrations(
        migrations,
        [
          {
            target_id: FIRST_TARGET_ID,
            version: 1,
            name: 'create_database',
            checksum: 'changed',
            clickhouse_version: '26.3.17.110',
          },
        ],
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toThrow('checksum drift');
  });

  test('rejects history that cannot be traced to an on disk migration', () => {
    expect(() =>
      planClickHouseMigrations(
        migrations,
        [
          {
            target_id: FIRST_TARGET_ID,
            version: 99,
            name: 'unknown',
            checksum: 'unknown',
            clickhouse_version: '26.3.17.110',
          },
        ],
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toThrow('unknown version');
  });

  test('accepts history applied by a compatible ClickHouse minor and patch version', () => {
    expect(
      planClickHouseMigrations(
        migrations,
        [
          {
            target_id: FIRST_TARGET_ID,
            version: 1,
            name: 'create_database',
            checksum: sha256('CREATE DATABASE observability'),
            clickhouse_version: '26.8.1.1324',
          },
        ],
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toEqual([expect.objectContaining({ version: 2 })]);
  });

  test('rejects history applied by a different ClickHouse major version', () => {
    expect(() =>
      planClickHouseMigrations(
        migrations,
        [
          {
            target_id: FIRST_TARGET_ID,
            version: 1,
            name: 'create_database',
            checksum: sha256('CREATE DATABASE observability'),
            clickhouse_version: '27.1.0.0',
          },
        ],
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toThrow('ClickHouse migration binary drift at version 1');
  });

  test('does not let one target history skip a fresh ClickHouse target', () => {
    const firstTargetHistory = migrations.map((migration) => ({
      target_id: FIRST_TARGET_ID,
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      clickhouse_version: PINNED_CLICKHOUSE_VERSION,
    }));

    expect(
      planClickHouseMigrations(
        migrations,
        firstTargetHistory,
        PINNED_CLICKHOUSE_VERSION,
        FIRST_TARGET_ID,
      ),
    ).toEqual([]);
    expect(
      planClickHouseMigrations(
        migrations,
        firstTargetHistory,
        PINNED_CLICKHOUSE_VERSION,
        SECOND_TARGET_ID,
      ),
    ).toEqual(migrations);
  });

  test('parses only a non nil ClickHouse server UUID as target identity', () => {
    expect(
      parseClickHouseMigrationTargetId('11111111-1111-4111-8111-111111111111'),
    ).toBe(FIRST_TARGET_ID);
    expect(() => parseClickHouseMigrationTargetId('not-a-uuid')).toThrow(
      'valid migration target ID',
    );
    expect(() =>
      parseClickHouseMigrationTargetId('00000000-0000-0000-0000-000000000000'),
    ).toThrow('valid migration target ID');
  });

  test('uses one global lock even when history is scoped by target', () => {
    expect(clickHouseMigrationLockKey()).toBe(
      'project:observability:clickhouse-migrations:v1',
    );
  });

  test('rejects a target or binary change after migration starts', () => {
    const currentTarget = {
      targetId: FIRST_TARGET_ID,
      serverVersion: PINNED_CLICKHOUSE_VERSION,
    };
    expect(() =>
      assertClickHouseMigrationTargetStable(currentTarget, {
        ...currentTarget,
        targetId: SECOND_TARGET_ID,
      }),
    ).toThrow('target changed during migration');
    expect(() =>
      assertClickHouseMigrationTargetStable(currentTarget, {
        ...currentTarget,
        serverVersion: '26.3.17.111',
      }),
    ).toThrow('server version changed during migration');
  });

  test('aborts before history insert when the target changes after DDL', async () => {
    const lockKeys: string[] = [];
    const historyInserts: unknown[][] = [];
    const executedQueries: string[] = [];
    const migration: ClickHouseMigration = {
      version: 1,
      name: 'test_no_postcondition',
      sql: 'SELECT 1',
      checksum: sha256('SELECT 1'),
    };

    await expect(
      runClickHouseMigrations({
        controlDatabase: fakeControlDatabase({ lockKeys, historyInserts }),
        client: fakeMigrationClient(
          [FIRST_TARGET_ID, FIRST_TARGET_ID, FIRST_TARGET_ID, SECOND_TARGET_ID],
          executedQueries,
        ),
        expectedServerVersion: PINNED_CLICKHOUSE_VERSION,
        schemaVersion: 1,
        migrations: [migration],
      }),
    ).rejects.toThrow('target changed during migration');

    expect(lockKeys).toEqual([clickHouseMigrationLockKey()]);
    expect(executedQueries).toEqual(['SELECT 1']);
    expect(historyInserts).toEqual([]);
  });
});
