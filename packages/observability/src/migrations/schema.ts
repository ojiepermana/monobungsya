import type { ClickHouseClient } from '../clickhouse';
import { SignalDeliveryError } from '../store';
import {
  CLICKHOUSE_VERSION_MANIFEST,
  isCompatibleClickHouseVersion,
} from './manifest';

interface TableCatalogRow {
  name: string;
  engine: string;
  partition_key: string;
  sorting_key: string;
  create_table_query: string;
  comment: string;
}

interface ColumnCatalogRow {
  table: string;
  name: string;
  type: string;
}

interface SettingRow {
  name: string;
  value: string | number;
}

interface VersionRow {
  version: string;
}

interface DatabaseRow {
  name: string;
}

export interface ClickHouseSchemaReadiness {
  available: boolean;
  checkedAt: string;
  failureCode: string | null;
  serverVersion: string | null;
}

export interface ClickHouseSchemaOptions {
  expectedServerVersion: string;
  schemaVersion: number;
  requireWriterSettings?: boolean;
  now?: () => Date;
}

interface SignalTableContract {
  readonly partition: string;
  readonly sort: string;
  readonly ttl: string;
  /** The ReplacingMergeTree version column. */
  readonly replacingVersion: string;
  /** Required canonical columns and their exact ClickHouse types. */
  readonly columns: Readonly<Record<string, string>>;
}

/**
 * A readiness contract deliberately repeats the canonical DDL shape. It is
 * checked through `system.columns` because a table name, engine, and sort key
 * alone cannot prove that an adapter can write or read every signal field.
 */
export const CLICKHOUSE_SIGNAL_TABLE_CONTRACTS: Readonly<
  Record<string, SignalTableContract>
> = {
  spans: {
    partition: 'toDate(started_at)',
    sort: 'service_name,resource_kind,resource_name,started_at,trace_id,span_id',
    ttl: 'started_at+INTERVAL7DAYDELETE',
    replacingVersion: 'write_version',
    columns: {
      trace_id: 'FixedString(32)',
      span_id: 'FixedString(16)',
      parent_span_id: 'Nullable(FixedString(16))',
      correlation_id: 'Nullable(String)',
      request_id: 'Nullable(String)',
      run_id: 'Nullable(UUID)',
      service_name: 'String',
      service_instance_id: 'String',
      resource_kind: 'String',
      resource_name: 'String',
      operation: 'String',
      status: "Enum8('ok' = 1, 'error' = 2, 'unset' = 3)",
      sampling_reason: 'String',
      attributes: 'String',
      error_type: 'Nullable(String)',
      started_at: "DateTime64(6, 'UTC')",
      finished_at: "DateTime64(6, 'UTC')",
      duration_ns: 'UInt64',
      schema_version: 'UInt16',
      ingested_at: "DateTime64(6, 'UTC')",
      write_version: 'UInt64',
    },
  },
  metric_buckets: {
    partition: 'toDate(bucket_start)',
    sort: 'metric_name,service_name,resource_kind,resource_name,bucket_start,series_fingerprint',
    ttl: 'bucket_start+INTERVAL30DAYDELETE',
    replacingVersion: 'flush_sequence',
    columns: {
      bucket_start: "DateTime64(6, 'UTC')",
      bucket_width_seconds: 'UInt32',
      series_fingerprint: 'FixedString(64)',
      flush_sequence: 'UInt64',
      service_name: 'String',
      service_instance_id: 'String',
      resource_kind: 'String',
      resource_name: 'String',
      metric_name: 'String',
      metric_kind: "Enum8('counter' = 1, 'histogram' = 2, 'gauge' = 3)",
      unit: 'String',
      count: 'UInt64',
      sum: 'Float64',
      min: 'Float64',
      max: 'Float64',
      histogram_boundaries: 'Array(Float64)',
      histogram_counts: 'Array(UInt64)',
      labels: 'String',
      schema_version: 'UInt16',
      ingested_at: "DateTime64(6, 'UTC')",
    },
  },
  application_logs: {
    partition: 'toDate(occurred_at)',
    sort: "ifNull(module,''),level,ifNull(event,''),occurred_at,id",
    ttl: 'occurred_at+INTERVAL30DAYDELETE',
    replacingVersion: 'write_version',
    columns: {
      id: 'UUID',
      level: 'String',
      channel: 'String',
      category: 'String',
      event: 'Nullable(String)',
      module: 'Nullable(String)',
      message: 'String',
      context: 'Nullable(String)',
      exception_class: 'Nullable(String)',
      exception_message: 'Nullable(String)',
      stack_trace: 'Nullable(String)',
      actor_user_id: 'Nullable(UUID)',
      actor_name: 'Nullable(String)',
      actor_email: 'Nullable(String)',
      entity_type: 'Nullable(String)',
      entity_id: 'Nullable(String)',
      reference_no: 'Nullable(String)',
      branch_code: 'Nullable(String)',
      request_id: 'Nullable(String)',
      trace_id: 'Nullable(String)',
      runtime_trace_id: 'Nullable(FixedString(32))',
      runtime_span_id: 'Nullable(FixedString(16))',
      session_id: 'Nullable(String)',
      ip_address: 'Nullable(String)',
      user_agent: 'Nullable(String)',
      occurred_at: "DateTime64(6, 'UTC')",
      created_at: "DateTime64(6, 'UTC')",
      schema_version: 'UInt16',
      ingested_at: "DateTime64(6, 'UTC')",
      write_version: 'UInt64',
    },
  },
  access_logs: {
    partition: 'toDate(accessed_at)',
    sort: "ifNull(route_name,''),outcome,event,accessed_at,id",
    ttl: 'accessed_at+INTERVAL30DAYDELETE',
    replacingVersion: 'write_version',
    columns: {
      id: 'UUID',
      event: 'String',
      outcome: 'String',
      authentication_method: 'Nullable(String)',
      access_channel: 'String',
      guard: 'Nullable(String)',
      actor_user_id: 'Nullable(UUID)',
      actor_name: 'Nullable(String)',
      actor_email: 'Nullable(String)',
      branch_code: 'Nullable(String)',
      ip_address: 'Nullable(String)',
      forwarded_ip: 'Nullable(String)',
      user_agent: 'Nullable(String)',
      device_name: 'Nullable(String)',
      platform: 'Nullable(String)',
      browser: 'Nullable(String)',
      session_id: 'Nullable(String)',
      request_id: 'Nullable(String)',
      trace_id: 'Nullable(String)',
      runtime_trace_id: 'Nullable(FixedString(32))',
      runtime_span_id: 'Nullable(FixedString(16))',
      route_name: 'Nullable(String)',
      path: 'Nullable(String)',
      method: 'Nullable(String)',
      http_status: 'Nullable(UInt16)',
      failure_reason: 'Nullable(String)',
      metadata: 'Nullable(String)',
      accessed_at: "DateTime64(6, 'UTC')",
      created_at: "DateTime64(6, 'UTC')",
      schema_version: 'UInt16',
      ingested_at: "DateTime64(6, 'UTC')",
      write_version: 'UInt64',
    },
  },
};

const REQUIRED_WRITER_SETTINGS = new Set([
  'async_insert',
  'wait_for_async_insert',
  'async_insert_deduplicate',
  'insert_deduplicate',
]);
const SCHEMA_VERSION_MARKER_PREFIX = 'project_observability_schema_version=';
const CANONICAL_TABLE_NAMES = new Set(
  Object.keys(CLICKHOUSE_SIGNAL_TABLE_CONTRACTS),
);

function normalizeExpression(value: string): string {
  return value.replace(/[\s`]/g, '').replace(/^tuple\((.*)\)$/, '$1');
}

function ttlMatches(query: string, ttl: string): boolean {
  const expected = ttl.toLowerCase();
  const canonicalInterval = expected.replace(
    /interval(\d+)day/,
    (_match, days: string) => `tointervalday(${days})`,
  );
  const defaultDeleteAction = canonicalInterval.replace('delete', '');
  return (
    query.includes(expected) ||
    query.includes(canonicalInterval) ||
    query.includes(defaultDeleteAction)
  );
}

function tableMatches(
  row: TableCatalogRow,
  table: SignalTableContract,
): boolean {
  const query = normalizeExpression(row.create_table_query).toLowerCase();
  return (
    row.engine === 'ReplacingMergeTree' &&
    query.includes(
      `engine=replacingmergetree(${normalizeExpression(table.replacingVersion).toLowerCase()})`,
    ) &&
    normalizeExpression(row.partition_key) ===
      normalizeExpression(table.partition) &&
    normalizeExpression(row.sorting_key) === normalizeExpression(table.sort) &&
    ttlMatches(query, table.ttl) &&
    query.includes('schema_versionuint16') &&
    query.includes("ingested_atdatetime64(6,'utc')") &&
    query.includes('non_replicated_deduplication_window=10000')
  );
}

function requiredColumnsMatch(
  rows: readonly ColumnCatalogRow[],
  table: string,
  contract: SignalTableContract,
): boolean {
  const columns = new Map(
    rows
      .filter((row) => row.table === table)
      .map((row) => [row.name, normalizeExpression(row.type).toLowerCase()]),
  );
  return Object.entries(contract.columns).every(
    ([name, expectedType]) =>
      columns.get(name) === normalizeExpression(expectedType).toLowerCase(),
  );
}

function unavailable(
  now: () => Date,
  failureCode: string,
  serverVersion: string | null = null,
): ClickHouseSchemaReadiness {
  return {
    available: false,
    checkedAt: now().toISOString(),
    failureCode,
    serverVersion,
  };
}

/**
 * Checks only bounded ClickHouse catalog and effective required insert settings. It
 * intentionally returns a safe state instead of surfacing database details.
 */
export async function verifyClickHouseSignalSchema(
  client: ClickHouseClient,
  options: ClickHouseSchemaOptions,
): Promise<ClickHouseSchemaReadiness> {
  const now = options.now ?? (() => new Date());
  try {
    const versions = await client.queryRows<VersionRow>(
      'SELECT version() AS version',
    );
    const serverVersion = versions[0]?.version ?? null;
    if (
      serverVersion === null ||
      !isCompatibleClickHouseVersion(
        serverVersion,
        options.expectedServerVersion,
      )
    ) {
      return unavailable(now, 'clickhouse_version_mismatch', serverVersion);
    }

    const manifestSchema = CLICKHOUSE_VERSION_MANIFEST.schema;
    if (
      options.schemaVersion !== manifestSchema.marker ||
      options.schemaVersion < manifestSchema.minimum ||
      options.schemaVersion > manifestSchema.maximum
    ) {
      return unavailable(
        now,
        'clickhouse_schema_version_mismatch',
        serverVersion,
      );
    }

    const databases = await client.queryRows<DatabaseRow>(
      'SELECT name FROM system.databases WHERE name = {database:String}',
      { params: { database: 'observability' } },
    );
    if (databases[0]?.name !== 'observability') {
      return unavailable(now, 'clickhouse_schema_mismatch', serverVersion);
    }

    const tableRows = await client.queryRows<TableCatalogRow>(
      'SELECT name, engine, partition_key, sorting_key, create_table_query, comment FROM system.tables WHERE database = {database:String} AND is_temporary = 0',
      { params: { database: 'observability' } },
    );
    if (tableRows.some((row) => !CANONICAL_TABLE_NAMES.has(row.name))) {
      return unavailable(now, 'clickhouse_schema_mismatch', serverVersion);
    }
    const schemaVersionMarker = `${SCHEMA_VERSION_MARKER_PREFIX}${manifestSchema.marker}`;
    const byName = new Map(tableRows.map((row) => [row.name, row]));
    const columnRows = await client.queryRows<ColumnCatalogRow>(
      "SELECT table, name, type FROM system.columns WHERE database = {database:String} AND table IN ('spans', 'metric_buckets', 'application_logs', 'access_logs')",
      { params: { database: 'observability' } },
    );
    for (const [name, expected] of Object.entries(
      CLICKHOUSE_SIGNAL_TABLE_CONTRACTS,
    )) {
      const row = byName.get(name);
      if (
        !row ||
        !tableMatches(row, expected) ||
        !requiredColumnsMatch(columnRows, name, expected)
      ) {
        return unavailable(now, 'clickhouse_schema_mismatch', serverVersion);
      }
      if (row.comment !== schemaVersionMarker) {
        return unavailable(
          now,
          'clickhouse_schema_version_mismatch',
          serverVersion,
        );
      }
    }

    if (options.requireWriterSettings !== false) {
      const settingRows = await client.queryRows<SettingRow>(
        "SELECT name, value FROM system.settings WHERE name IN ('async_insert', 'wait_for_async_insert', 'async_insert_deduplicate', 'insert_deduplicate')",
      );
      const settings = new Map(
        settingRows.map((row) => [row.name, String(row.value)]),
      );
      if (
        [...REQUIRED_WRITER_SETTINGS].some((name) => settings.get(name) !== '1')
      ) {
        return unavailable(now, 'clickhouse_setting_mismatch', serverVersion);
      }
    }

    return {
      available: true,
      checkedAt: now().toISOString(),
      failureCode: null,
      serverVersion,
    };
  } catch (error) {
    const failureCode =
      error instanceof SignalDeliveryError
        ? error.code
        : 'clickhouse_readiness_failed';
    return unavailable(now, failureCode);
  }
}
