import { describe, expect, test } from 'bun:test';
import {
  assertPinnedClickHouseVersion,
  localClickHouseProvisioningStatements,
  localClickHouseQueryLogHasSevenDayRetention,
  localClickHouseQueryLogSmokeStatements,
  localClickHouseServerEnvironment,
  localClickHouseServiceCredentials,
  parseClickHouseVersion,
} from './start-local-clickhouse';

describe('native ClickHouse runner version gate', () => {
  test('reads the exact version from native binary output', () => {
    expect(
      parseClickHouseVersion(
        'ClickHouse local version 26.3.17.110 (official build).',
      ),
    ).toBe('26.3.17.110');
    expect(
      assertPinnedClickHouseVersion('ClickHouse local version 26.3.17.110'),
    ).toBe('26.3.17.110');
  });

  test('accepts an installed binary with the supported major version', () => {
    expect(
      assertPinnedClickHouseVersion(
        'ClickHouse local version 26.8.1.1324 (official build).',
      ),
    ).toBe('26.8.1.1324');
  });

  test('rejects an installed binary with a different major version', () => {
    expect(() =>
      assertPinnedClickHouseVersion(
        'ClickHouse local version 27.1.0.0 (official build).',
      ),
    ).toThrow('ClickHouse major version 26 is required');
  });

  test('recognizes the required query log seven day TTL in server DDL', () => {
    expect(
      localClickHouseQueryLogHasSevenDayRetention(
        'CREATE TABLE system.query_log ENGINE = MergeTree TTL event_date + INTERVAL 7 DAY DELETE',
      ),
    ).toBe(true);
    expect(
      localClickHouseQueryLogHasSevenDayRetention(
        'CREATE TABLE system.query_log ENGINE = MergeTree TTL event_date + toIntervalDay(7)',
      ),
    ).toBe(true);
    expect(
      localClickHouseQueryLogHasSevenDayRetention(
        'CREATE TABLE system.query_log ENGINE = MergeTree TTL event_date + INTERVAL 30 DAY DELETE',
      ),
    ).toBe(false);
  });

  test('flushes the lazy query log table before inspecting its DDL', () => {
    expect(localClickHouseQueryLogSmokeStatements()).toEqual([
      'SYSTEM FLUSH LOGS',
      'SHOW CREATE TABLE system.query_log',
    ]);
  });

  test('disables the ClickHouse watchdog so cleanup owns the server process', () => {
    expect(
      localClickHouseServerEnvironment({
        CLICKHOUSE_WATCHDOG_ENABLE: '1',
        PATH: '/bin',
      }),
    ).toEqual({
      CLICKHOUSE_WATCHDOG_ENABLE: '0',
      PATH: '/bin',
    });
  });

  test('uses distinct least-privilege identities after bootstrap', () => {
    const credentials = localClickHouseServiceCredentials(
      'http://127.0.0.1:8123',
    );
    expect(
      new Set(Object.values(credentials).map((identity) => identity.username))
        .size,
    ).toBe(5);
    expect(localClickHouseProvisioningStatements()).toEqual(
      expect.arrayContaining([
        'GRANT project_observability_writer TO local_observability_writer',
        'GRANT project_observability_readiness TO local_observability_readiness',
        'GRANT project_observability_reader TO local_observability_reader',
        'GRANT project_observability_migrator TO local_observability_migrator',
      ]),
    );
  });
});
