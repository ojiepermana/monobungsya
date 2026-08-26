import { describe, expect, test } from 'bun:test';
import {
  assertSignalStorageMode,
  createConfiguredClickHouseSignalReader,
  createConfiguredObservabilitySignalStore,
  isValidSignalStorageMode,
} from './configured';

describe('configured observability signal store', () => {
  test('allows only staged writer and reader cutover combinations', () => {
    expect(isValidSignalStorageMode('postgres', 'postgres')).toBe(true);
    expect(isValidSignalStorageMode('dual', 'postgres')).toBe(true);
    expect(isValidSignalStorageMode('dual', 'clickhouse')).toBe(true);
    expect(isValidSignalStorageMode('clickhouse', 'clickhouse')).toBe(true);
    expect(isValidSignalStorageMode('postgres', 'clickhouse')).toBe(false);
    expect(isValidSignalStorageMode('clickhouse', 'postgres')).toBe(false);
    expect(() => assertSignalStorageMode('postgres', 'clickhouse')).toThrow(
      'Invalid observability signal storage mode',
    );
  });

  test('turns ClickHouse writer off safely when bounded startup verification fails', async () => {
    const store = await createConfiguredObservabilitySignalStore({
      writeMode: 'clickhouse',
      readMode: 'clickhouse',
      clickhouse: {
        url: 'http://127.0.0.1:8123',
        username: 'writer',
        password: 'writer-secret',
      },
      readinessClickhouse: {
        url: 'http://127.0.0.1:8123',
        username: 'readiness',
        password: 'readiness-secret',
      },
      verifyClickHouse: async () => ({
        available: false,
        checkedAt: '2026-08-26T12:00:00.000Z',
        failureCode: 'clickhouse_version_mismatch',
        serverVersion: '26.8.1.1324',
      }),
    });

    expect(store.diagnostics()).toMatchObject({
      state: 'disabled',
      failureCode: 'clickhouse_version_mismatch',
    });
    expect(store.diagnostics().blindSpotSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('does not use an INSERT only writer identity for catalog readiness', async () => {
    const store = await createConfiguredObservabilitySignalStore({
      writeMode: 'clickhouse',
      readMode: 'clickhouse',
      clickhouse: {
        url: 'http://127.0.0.1:8123',
        username: 'writer',
        password: 'writer-secret',
      },
    });

    expect(store.diagnostics()).toMatchObject({
      state: 'disabled',
      failureCode: 'clickhouse_readiness_configuration_missing',
    });
  });

  test('does not fall back to the PostgreSQL shadow when a reader cutover is unavailable', async () => {
    const configured = await createConfiguredClickHouseSignalReader({
      readMode: 'clickhouse',
      clickhouse: {
        url: 'http://127.0.0.1:8123',
        username: 'reader',
        password: 'reader-secret',
      },
      verifyClickHouse: async () => ({
        available: false,
        checkedAt: '2026-08-26T12:00:00.000Z',
        failureCode: 'clickhouse_schema_mismatch',
        serverVersion: '26.3.17.110',
      }),
    });

    expect(configured).toMatchObject({
      reader: null,
      readiness: {
        available: false,
        failureCode: 'clickhouse_schema_mismatch',
      },
    });
  });
});
