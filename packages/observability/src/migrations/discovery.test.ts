import { describe, expect, test } from 'bun:test';
import {
  discoverClickHouseMigrations,
  parseClickHouseMigrations,
  sha256,
} from './discovery';

describe('ClickHouse migration discovery', () => {
  test('orders immutable one-statement files and records source checksum', () => {
    const migrations = parseClickHouseMigrations([
      {
        path: '/migrations/0002_create_table.sql',
        source: 'CREATE TABLE test',
      },
      {
        path: '/migrations/0001_create_database.sql',
        source: 'CREATE DATABASE test;',
      },
    ]);

    expect(migrations).toEqual([
      {
        version: 1,
        name: 'create_database',
        checksum: sha256('CREATE DATABASE test;'),
        sql: 'CREATE DATABASE test',
      },
      {
        version: 2,
        name: 'create_table',
        checksum: sha256('CREATE TABLE test'),
        sql: 'CREATE TABLE test',
      },
    ]);
  });

  test('rejects a changed migration shape with more than one statement', () => {
    expect(() =>
      parseClickHouseMigrations([
        { path: '/migrations/0001_bad.sql', source: 'CREATE A; CREATE B' },
      ]),
    ).toThrow('one statement');
  });

  test('includes additive readiness, table-marker, and migrator migrations', async () => {
    const migrations = await discoverClickHouseMigrations();

    expect(migrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: 25,
          name: 'configure_readiness_role',
          sql: 'ALTER ROLE project_observability_readiness SETTINGS async_insert = 1 CONST, wait_for_async_insert = 1 CONST, async_insert_deduplicate = 1 CONST, insert_deduplicate = 1 CONST',
        }),
        expect.objectContaining({
          version: 26,
          name: 'set_spans_schema_version_marker',
          sql: "ALTER TABLE observability.spans MODIFY COMMENT 'project_observability_schema_version=1'",
        }),
        expect.objectContaining({
          version: 35,
          name: 'grant_migrator_alter_observability_comments',
          sql: 'GRANT ALTER MODIFY COMMENT ON observability.* TO project_observability_migrator',
        }),
        expect.objectContaining({
          version: 37,
          name: 'grant_migrator_system_columns_select',
          sql: 'GRANT SELECT ON system.columns TO project_observability_migrator',
        }),
        expect.objectContaining({
          version: 43,
          name: 'grant_migrator_show_columns',
          sql: 'GRANT SHOW COLUMNS ON observability.* TO project_observability_migrator',
        }),
      ]),
    );
  });
});
