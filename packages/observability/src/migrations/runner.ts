import { type DatabaseClient, withTransaction } from '#project/database';
import type { ClickHouseClient } from '../clickhouse';
import {
  type ClickHouseMigration,
  discoverClickHouseMigrations,
} from './discovery';
import { CLICKHOUSE_VERSION_MANIFEST } from './manifest';
import { verifyClickHouseSignalSchema } from './schema';

const MIGRATION_LOCK = 'project:observability:clickhouse-migrations:v1';
const CLICKHOUSE_TARGET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * ClickHouse may combine compatible grants into one statement, for example
 * `GRANT CREATE DATABASE, CREATE TABLE ON observability.*`. Postconditions
 * therefore look for the granted privilege and object rather than requiring
 * a second `GRANT` keyword before every privilege.
 */
export function clickHouseGrantIncludes(
  definition: string,
  required: string,
): boolean {
  const normalizedRequired = required.replace(/\s+/g, ' ').toLowerCase();
  const separator = normalizedRequired.lastIndexOf(' on ');
  if (separator < 1) {
    return definition
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .includes(normalizedRequired);
  }
  const requiredPrivilege = normalizedRequired.slice(0, separator);
  const requiredScope = normalizedRequired.slice(separator + 4);
  return definition.split(/\r?\n/).some((statement) => {
    const match = statement
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .match(/^grant (.+) on (.+) to /);
    if (!match) return false;
    const [, grantedPrivileges, grantedScope] = match;
    if (!grantedPrivileges || grantedScope !== requiredScope) return false;
    return grantedPrivileges
      .split(',')
      .some((privilege) => privilege.trim() === requiredPrivilege);
  });
}

export interface AppliedClickHouseMigration {
  target_id: string;
  version: number;
  name: string;
  checksum: string;
  clickhouse_version: string;
}

export interface ClickHouseMigrationRunResult {
  applied: number[];
  skipped: number[];
  serverVersion: string;
  targetId: string;
}

export interface ClickHouseMigrationRunnerOptions {
  controlDatabase: DatabaseClient;
  client: ClickHouseClient;
  expectedServerVersion: string;
  schemaVersion: number;
  migrations?: readonly ClickHouseMigration[];
  now?: () => Date;
}

function findMigration(
  migrations: readonly ClickHouseMigration[],
  version: number,
): ClickHouseMigration | undefined {
  return migrations.find((migration) => migration.version === version);
}

function appliedMigrationVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Invalid ClickHouse migration history version');
  }
  return version;
}

/**
 * ClickHouse persists serverUUID() in its data directory. It is therefore the
 * identity of the schema target, not merely the hostname or endpoint that can
 * be reused after a node rebuild.
 */
export function parseClickHouseMigrationTargetId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('ClickHouse did not return a valid migration target ID');
  }
  const targetId = value.toLowerCase();
  if (
    !CLICKHOUSE_TARGET_ID_PATTERN.test(targetId) ||
    targetId === '00000000-0000-0000-0000-000000000000'
  ) {
    throw new Error('ClickHouse did not return a valid migration target ID');
  }
  return targetId;
}

/** Every ClickHouse target shares this lock so only one migration runner acts at once. */
export function clickHouseMigrationLockKey(): string {
  return MIGRATION_LOCK;
}

export function assertClickHouseMigrationTargetStable(
  expected: Readonly<{ serverVersion: string; targetId: string }>,
  actual: Readonly<{ serverVersion: string; targetId: string }>,
): void {
  if (actual.targetId !== expected.targetId) {
    throw new Error('ClickHouse migration target changed during migration');
  }
  if (actual.serverVersion !== expected.serverVersion) {
    throw new Error(
      'ClickHouse migration server version changed during migration',
    );
  }
}

export function planClickHouseMigrations(
  migrations: readonly ClickHouseMigration[],
  applied: readonly AppliedClickHouseMigration[],
  expectedClickHouseVersion: string,
  targetId: string,
): ClickHouseMigration[] {
  const expectedTargetId = parseClickHouseMigrationTargetId(targetId);
  const seen = new Set<number>();
  for (const row of applied) {
    if (parseClickHouseMigrationTargetId(row.target_id) !== expectedTargetId) {
      continue;
    }
    const version = appliedMigrationVersion(row.version);
    if (seen.has(version)) {
      throw new Error(
        `Duplicate ClickHouse migration history version: ${version}`,
      );
    }
    seen.add(version);
    const migration = findMigration(migrations, version);
    if (!migration) {
      throw new Error(
        `ClickHouse migration history has unknown version: ${version}`,
      );
    }
    if (migration.name !== row.name || migration.checksum !== row.checksum) {
      throw new Error(
        `ClickHouse migration checksum drift at version ${version}`,
      );
    }
    if (row.clickhouse_version !== expectedClickHouseVersion) {
      throw new Error(
        `ClickHouse migration binary drift at version ${row.version}`,
      );
    }
  }
  return migrations.filter((migration) => !seen.has(migration.version));
}

interface ClickHouseMigrationTarget {
  serverVersion: string;
  targetId: string;
}

async function readMigrationTarget(
  client: ClickHouseClient,
): Promise<ClickHouseMigrationTarget> {
  const rows = await client.queryRows<{ version: unknown; target_id: unknown }>(
    'SELECT version() AS version, toString(serverUUID()) AS target_id',
    { database: null },
  );
  const row = rows[0];
  if (typeof row?.version !== 'string' || row.version === '') {
    throw new Error('ClickHouse did not return a server version');
  }
  return {
    serverVersion: row.version,
    targetId: parseClickHouseMigrationTargetId(row.target_id),
  };
}

async function assertMigrationTargetStable(
  client: ClickHouseClient,
  expected: ClickHouseMigrationTarget,
): Promise<void> {
  assertClickHouseMigrationTargetStable(
    expected,
    await readMigrationTarget(client),
  );
}

async function assertPostcondition(
  client: ClickHouseClient,
  migration: ClickHouseMigration,
): Promise<void> {
  const tableByName: Readonly<Record<string, string>> = {
    create_spans: 'spans',
    create_metric_buckets: 'metric_buckets',
    create_application_logs: 'application_logs',
    create_access_logs: 'access_logs',
  };
  if (migration.name === 'create_observability_database') {
    const rows = await client.queryRows<{ name: string }>(
      'SELECT name FROM system.databases WHERE name = {database:String}',
      { database: null, params: { database: 'observability' } },
    );
    if (rows[0]?.name !== 'observability') {
      throw new Error('ClickHouse database postcondition failed');
    }
    return;
  }
  const tableName = tableByName[migration.name];
  if (tableName) {
    const rows = await client.queryRows<{ name: string }>(
      'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String}',
      {
        database: null,
        params: { database: 'observability', table: tableName },
      },
    );
    if (rows[0]?.name !== tableName) {
      throw new Error(`ClickHouse table postcondition failed: ${tableName}`);
    }
    return;
  }
  const schemaMarkerTableByName: Readonly<Record<string, string>> = {
    set_spans_schema_version_marker: 'spans',
    set_metric_buckets_schema_version_marker: 'metric_buckets',
    set_application_logs_schema_version_marker: 'application_logs',
    set_access_logs_schema_version_marker: 'access_logs',
  };
  const schemaMarkerTable = schemaMarkerTableByName[migration.name];
  if (schemaMarkerTable) {
    const rows = await client.queryRows<{ comment: string }>(
      'SELECT comment FROM system.tables WHERE database = {database:String} AND name = {table:String}',
      {
        database: null,
        params: { database: 'observability', table: schemaMarkerTable },
      },
    );
    if (
      rows[0]?.comment !==
      `project_observability_schema_version=${CLICKHOUSE_VERSION_MANIFEST.schema.marker}`
    ) {
      throw new Error(
        `ClickHouse schema marker postcondition failed: ${schemaMarkerTable}`,
      );
    }
    return;
  }
  if (migration.name === 'create_observability_roles') {
    const rows = await client.queryRows<{ count: string | number }>(
      "SELECT count() AS count FROM system.roles WHERE name IN ('project_observability_migrator', 'project_observability_writer', 'project_observability_readiness', 'project_observability_reader', 'project_observability_operator')",
      { database: null },
    );
    if (Number(rows[0]?.count) !== 5) {
      throw new Error('ClickHouse role postcondition failed');
    }
    return;
  }
  const expectedGrantByName: Readonly<Record<string, string>> = {
    grant_writer_spans_insert: 'insert on observability.spans',
    grant_writer_metric_buckets_insert:
      'insert on observability.metric_buckets',
    grant_writer_application_logs_insert:
      'insert on observability.application_logs',
    grant_writer_access_logs_insert: 'insert on observability.access_logs',
    grant_reader_spans_select: 'select on observability.spans',
    grant_reader_metric_buckets_select:
      'select on observability.metric_buckets',
    grant_reader_application_logs_select:
      'select on observability.application_logs',
    grant_reader_access_logs_select: 'select on observability.access_logs',
    grant_reader_system_databases_select: 'select on system.databases',
    grant_reader_system_tables_select: 'select on system.tables',
    grant_reader_system_columns_select: 'select on system.columns',
    grant_reader_system_settings_select: 'select on system.settings',
    grant_reader_system_disks_select: 'select on system.disks',
    grant_operator_query_log_select: 'select on system.query_log',
    grant_readiness_system_databases_select: 'select on system.databases',
    grant_readiness_system_tables_select: 'select on system.tables',
    grant_readiness_system_columns_select: 'select on system.columns',
    grant_readiness_system_settings_select: 'select on system.settings',
    grant_readiness_show_databases: 'show databases on *.*',
    grant_readiness_show_tables: 'show tables on observability.*',
    grant_readiness_show_columns: 'show columns on observability.*',
    grant_migrator_create_observability_database:
      'create database on observability.*',
    grant_migrator_create_observability_tables:
      'create table on observability.*',
    grant_migrator_system_databases_select: 'select on system.databases',
    grant_migrator_system_tables_select: 'select on system.tables',
    grant_migrator_system_settings_select: 'select on system.settings',
    grant_migrator_system_columns_select: 'select on system.columns',
    grant_migrator_show_databases: 'show databases on *.*',
    grant_migrator_show_tables: 'show tables on observability.*',
    grant_migrator_show_columns: 'show columns on observability.*',
    grant_migrator_alter_observability_comments:
      'alter modify comment on observability.*',
  };
  const role =
    migration.name === 'configure_writer_role'
      ? 'project_observability_writer'
      : migration.name === 'configure_readiness_role'
        ? 'project_observability_readiness'
        : migration.name.startsWith('grant_writer_')
          ? 'project_observability_writer'
          : migration.name.startsWith('grant_reader_')
            ? 'project_observability_reader'
            : migration.name.startsWith('grant_readiness_')
              ? 'project_observability_readiness'
              : migration.name.startsWith('grant_migrator_')
                ? 'project_observability_migrator'
                : migration.name === 'grant_operator_query_log_select'
                  ? 'project_observability_operator'
                  : undefined;
  if (!role) return;
  const definition = await client.execute({
    database: null,
    query:
      migration.name === 'configure_writer_role' ||
      migration.name === 'configure_readiness_role'
        ? `SHOW CREATE ROLE ${role}`
        : `SHOW GRANTS FOR ${role}`,
  });
  const required =
    migration.name === 'configure_writer_role' ||
    migration.name === 'configure_readiness_role'
      ? 'async_insert'
      : expectedGrantByName[migration.name];
  if (!required || !clickHouseGrantIncludes(definition, required)) {
    throw new Error(`ClickHouse grant postcondition failed: ${migration.name}`);
  }
}

export async function runClickHouseMigrations(
  options: ClickHouseMigrationRunnerOptions,
): Promise<ClickHouseMigrationRunResult> {
  const migrations =
    options.migrations ?? (await discoverClickHouseMigrations());
  const now = options.now ?? (() => new Date());
  const targetBeforeLock = await readMigrationTarget(options.client);
  if (targetBeforeLock.serverVersion !== options.expectedServerVersion) {
    throw new Error(
      `ClickHouse version mismatch: expected ${options.expectedServerVersion}, got ${targetBeforeLock.serverVersion}`,
    );
  }
  return withTransaction(options.controlDatabase, async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${clickHouseMigrationLockKey()}))`;
    const target = await readMigrationTarget(options.client);
    assertClickHouseMigrationTargetStable(targetBeforeLock, target);
    if (target.serverVersion !== options.expectedServerVersion) {
      throw new Error(
        `ClickHouse version mismatch: expected ${options.expectedServerVersion}, got ${target.serverVersion}`,
      );
    }

    const applied = (await transaction.unsafe(
      'SELECT target_id, version, name, checksum, clickhouse_version FROM telemetry.signal_schema_migrations WHERE target_id = $1 ORDER BY version',
      [target.targetId] as never[],
    )) as AppliedClickHouseMigration[];
    const pending = planClickHouseMigrations(
      migrations,
      applied,
      target.serverVersion,
      target.targetId,
    );
    for (const migration of pending) {
      await assertMigrationTargetStable(options.client, target);
      const startedAt = performance.now();
      await options.client.execute({ database: null, query: migration.sql });
      await assertMigrationTargetStable(options.client, target);
      await assertPostcondition(options.client, migration);
      await assertMigrationTargetStable(options.client, target);
      const executionMs = Math.max(
        0,
        Math.round(performance.now() - startedAt),
      );
      await transaction.unsafe(
        'INSERT INTO telemetry.signal_schema_migrations (target_id, version, name, checksum, clickhouse_version, execution_ms, applied_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          target.targetId,
          migration.version,
          migration.name,
          migration.checksum,
          target.serverVersion,
          executionMs,
          now(),
        ] as never[],
      );
    }

    await assertMigrationTargetStable(options.client, target);
    const readiness = await verifyClickHouseSignalSchema(options.client, {
      expectedServerVersion: options.expectedServerVersion,
      schemaVersion: options.schemaVersion,
      requireWriterSettings: false,
      now,
    });
    await assertMigrationTargetStable(options.client, target);
    if (!readiness.available) {
      throw new Error(
        `ClickHouse schema readiness failed: ${readiness.failureCode}`,
      );
    }
    return {
      applied: pending.map((migration) => migration.version),
      skipped: applied.map((migration) => migration.version),
      serverVersion: target.serverVersion,
      targetId: target.targetId,
    };
  });
}
