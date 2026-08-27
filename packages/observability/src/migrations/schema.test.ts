import { describe, expect, test } from 'bun:test';
import { ClickHouseClient, type ClickHouseFetch } from '../clickhouse';
import {
  CLICKHOUSE_SIGNAL_TABLE_CONTRACTS,
  verifyClickHouseSignalSchema,
} from './schema';

const NOW = new Date('2026-08-26T12:00:00.000Z');

function tableRow(
  name: string,
  partition: string,
  sort: string,
  ttl: string,
  comment: string,
) {
  const contract = CLICKHOUSE_SIGNAL_TABLE_CONTRACTS[name];
  return {
    name,
    engine: 'ReplacingMergeTree',
    partition_key: partition,
    sorting_key: sort,
    create_table_query: `CREATE TABLE observability.${name} (schema_version UInt16, ingested_at DateTime64(6, 'UTC')) ENGINE = ReplacingMergeTree(${contract?.replacingVersion ?? 'write_version'}) PARTITION BY ${partition} ORDER BY (${sort}) TTL ${ttl} SETTINGS non_replicated_deduplication_window = 10000`,
    comment,
  };
}

function fetchForCatalog(
  overrides: {
    canonicalTtl?: boolean;
    database?: boolean;
    extraTable?: boolean;
    schemaMarker?: string;
    version?: string;
    settings?: string;
    missingColumn?: { table: string; name: string };
    wrongColumnType?: { table: string; name: string; type: string };
    replacingVersion?: { table: string; name: string };
  } = {},
  expectedAuthorization = `Basic ${btoa('readiness:readiness-secret')}`,
): ClickHouseFetch {
  const ttl = (value: string) =>
    overrides.canonicalTtl
      ? value.replace(/ \+ INTERVAL (\d+) DAY DELETE/, ' + toIntervalDay($1)')
      : value;
  const schemaMarker =
    overrides.schemaMarker ?? 'project_observability_schema_version=1';
  return async (input, init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      expectedAuthorization,
    );
    const query = new URL(input.toString()).searchParams.get('query') ?? '';
    if (query.includes('version()')) {
      return new Response(
        JSON.stringify({ version: overrides.version ?? '26.3.17.110' }),
      );
    }
    if (query.includes('FROM system.databases')) {
      return new Response(
        overrides.database === false
          ? ''
          : JSON.stringify({ name: 'observability' }),
      );
    }
    if (query.includes('FROM system.tables')) {
      const rows = [
        tableRow(
          'spans',
          'toDate(started_at)',
          'service_name, resource_kind, resource_name, started_at, trace_id, span_id',
          ttl('started_at + INTERVAL 7 DAY DELETE'),
          schemaMarker,
        ),
        tableRow(
          'metric_buckets',
          'toDate(bucket_start)',
          'metric_name, service_name, resource_kind, resource_name, bucket_start, series_fingerprint',
          ttl('bucket_start + INTERVAL 30 DAY DELETE'),
          schemaMarker,
        ),
        tableRow(
          'application_logs',
          'toDate(occurred_at)',
          "ifNull(module, ''), level, ifNull(event, ''), occurred_at, id",
          ttl('occurred_at + INTERVAL 30 DAY DELETE'),
          schemaMarker,
        ),
        tableRow(
          'access_logs',
          'toDate(accessed_at)',
          "ifNull(route_name, ''), outcome, event, accessed_at, id",
          ttl('accessed_at + INTERVAL 30 DAY DELETE'),
          schemaMarker,
        ),
      ];
      if (overrides.replacingVersion) {
        const row = rows.find(
          (candidate) => candidate.name === overrides.replacingVersion?.table,
        );
        if (row) {
          row.create_table_query = row.create_table_query.replace(
            /ReplacingMergeTree\([^)]*\)/,
            `ReplacingMergeTree(${overrides.replacingVersion.name})`,
          );
        }
      }
      if (overrides.extraTable) {
        rows.push(
          tableRow(
            'business_state',
            'toDate(created_at)',
            'created_at',
            ttl('created_at + INTERVAL 30 DAY DELETE'),
            schemaMarker,
          ),
        );
      }
      return new Response(rows.map((row) => JSON.stringify(row)).join('\n'));
    }
    if (query.includes('FROM system.columns')) {
      const rows = Object.entries(CLICKHOUSE_SIGNAL_TABLE_CONTRACTS).flatMap(
        ([table, contract]) =>
          Object.entries(contract.columns)
            .filter(
              ([name]) =>
                !(
                  overrides.missingColumn?.table === table &&
                  overrides.missingColumn.name === name
                ),
            )
            .map(([name, type]) => ({
              table,
              name,
              type:
                overrides.wrongColumnType?.table === table &&
                overrides.wrongColumnType.name === name
                  ? overrides.wrongColumnType.type
                  : type,
            })),
      );
      return new Response(rows.map((row) => JSON.stringify(row)).join('\n'));
    }
    if (query.includes('FROM system.settings')) {
      return new Response(
        [
          'async_insert',
          'wait_for_async_insert',
          'async_insert_deduplicate',
          'insert_deduplicate',
        ]
          .map((name) =>
            JSON.stringify({ name, value: overrides.settings ?? '1' }),
          )
          .join('\n'),
      );
    }
    return new Response('', { status: 500 });
  };
}

function client(
  fetch: ClickHouseFetch,
  credentials = {
    username: 'readiness',
    password: 'readiness-secret',
  },
): ClickHouseClient {
  return new ClickHouseClient({
    url: 'http://127.0.0.1:8123',
    ...credentials,
    fetch,
  });
}

describe('verifyClickHouseSignalSchema', () => {
  test('accepts the exact supported version, signal tables, and readiness settings', async () => {
    await expect(
      verifyClickHouseSignalSchema(client(fetchForCatalog()), {
        expectedServerVersion: '26.3.17.110',
        schemaVersion: 1,
        now: () => NOW,
      }),
    ).resolves.toEqual({
      available: true,
      checkedAt: NOW.toISOString(),
      failureCode: null,
      serverVersion: '26.3.17.110',
    });
  });

  test('accepts ClickHouse canonical TTL output without an explicit DELETE action', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(fetchForCatalog({ canonicalTtl: true })),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({ available: true });
  });

  test('returns safe disabled readiness when the binary differs', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(fetchForCatalog({ version: '26.8.1.1324' })),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toEqual({
      available: false,
      checkedAt: NOW.toISOString(),
      failureCode: 'clickhouse_version_mismatch',
      serverVersion: '26.8.1.1324',
    });
  });

  test('returns safe disabled readiness when an effective readiness setting is not locked', async () => {
    await expect(
      verifyClickHouseSignalSchema(client(fetchForCatalog({ settings: '0' })), {
        expectedServerVersion: '26.3.17.110',
        schemaVersion: 1,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_setting_mismatch',
    });
  });

  test('returns safe disabled readiness when the observability database is missing', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(fetchForCatalog({ database: false })),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_mismatch',
    });
  });

  test('returns safe disabled readiness when observability has a noncanonical table', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(fetchForCatalog({ extraTable: true })),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_mismatch',
    });
  });

  test('returns safe disabled readiness when a required canonical column is missing', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(
          fetchForCatalog({
            missingColumn: { table: 'spans', name: 'duration_ns' },
          }),
        ),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_mismatch',
    });
  });

  test('returns safe disabled readiness when a canonical column type drifts', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(
          fetchForCatalog({
            wrongColumnType: {
              table: 'application_logs',
              name: 'id',
              type: 'String',
            },
          }),
        ),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_mismatch',
    });
  });

  test('returns safe disabled readiness when ReplacingMergeTree uses another version column', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(
          fetchForCatalog({
            replacingVersion: {
              table: 'metric_buckets',
              name: 'write_version',
            },
          }),
        ),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_mismatch',
    });
  });

  test('returns safe disabled readiness when the immutable schema marker differs', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(
          fetchForCatalog({
            schemaMarker: 'project_observability_schema_version=2',
          }),
        ),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_version_mismatch',
    });
  });

  test('returns safe disabled readiness when the requested schema is outside the manifest', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(
          fetchForCatalog({
            schemaMarker: 'project_observability_schema_version=2',
          }),
        ),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 2,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({
      available: false,
      failureCode: 'clickhouse_schema_version_mismatch',
    });
  });

  test('lets the migrator verify schema without inheriting writer only settings', async () => {
    await expect(
      verifyClickHouseSignalSchema(
        client(
          fetchForCatalog(
            { settings: '0' },
            `Basic ${btoa('migrator:migrator-secret')}`,
          ),
          { username: 'migrator', password: 'migrator-secret' },
        ),
        {
          expectedServerVersion: '26.3.17.110',
          schemaVersion: 1,
          requireWriterSettings: false,
          now: () => NOW,
        },
      ),
    ).resolves.toMatchObject({ available: true });
  });
});
