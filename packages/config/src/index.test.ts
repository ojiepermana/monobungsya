import { describe, expect, test } from 'bun:test';
import { loadEnv } from './index';

describe('observability storage environment', () => {
  test('keeps PostgreSQL extraction as the safe default', () => {
    const env = loadEnv('test', { NODE_ENV: 'test' });
    expect(env.OBSERVABILITY_SIGNAL_WRITE_MODE).toBe('postgres');
    expect(env.OBSERVABILITY_SIGNAL_READ_MODE).toBe('postgres');
    expect(env.OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS).toBe(20_000);
  });

  test('rejects a reader cutover without a valid writer transition', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_WRITE_MODE: 'postgres',
        OBSERVABILITY_SIGNAL_READ_MODE: 'clickhouse',
      }),
    ).toThrow('Invalid observability signal storage mode');
  });

  test('requires a durable promotion report before a production ClickHouse cutover', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'production',
        LOG_DATABASE_URL: 'postgres://logs@localhost/project',
        INTERNAL_AUTH_SIGNING_SECRET: 'test-signing-secret',
        OBSERVABILITY_SIGNAL_WRITE_MODE: 'dual',
        OBSERVABILITY_SIGNAL_READ_MODE: 'clickhouse',
        CLICKHOUSE_URL: 'https://clickhouse.internal.example',
        CLICKHOUSE_WRITER_USERNAME: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-secret',
        CLICKHOUSE_READINESS_USERNAME: 'readiness',
        CLICKHOUSE_READINESS_PASSWORD: 'readiness-secret',
        CLICKHOUSE_READER_USERNAME: 'reader',
        CLICKHOUSE_READER_PASSWORD: 'reader-secret',
      }),
    ).toThrow('OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID');
  });

  test('requires an explicit Control database URL for a production non-baseline mode', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'production',
        LOG_DATABASE_URL: 'postgres://logs@localhost/project',
        INTERNAL_AUTH_SIGNING_SECRET: 'test-signing-secret',
        OBSERVABILITY_SIGNAL_WRITE_MODE: 'dual',
        OBSERVABILITY_SIGNAL_READ_MODE: 'postgres',
        CLICKHOUSE_URL: 'https://clickhouse.internal.example',
        CLICKHOUSE_WRITER_USERNAME: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-secret',
        CLICKHOUSE_READINESS_USERNAME: 'readiness',
        CLICKHOUSE_READINESS_PASSWORD: 'readiness-secret',
      }),
    ).toThrow('OBSERVABILITY_DATABASE_URL');
  });

  test('requires the correct least privilege credentials for ClickHouse mode', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_WRITE_MODE: 'dual',
        OBSERVABILITY_SIGNAL_READ_MODE: 'postgres',
        CLICKHOUSE_URL: 'http://127.0.0.1:8123',
      }),
    ).toThrow('CLICKHOUSE_WRITER_USERNAME');

    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_WRITE_MODE: 'dual',
        OBSERVABILITY_SIGNAL_READ_MODE: 'postgres',
        CLICKHOUSE_URL: 'http://127.0.0.1:8123',
        CLICKHOUSE_WRITER_USERNAME: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-secret',
      }),
    ).toThrow('CLICKHOUSE_READINESS_USERNAME');

    const env = loadEnv('test', {
      NODE_ENV: 'test',
      OBSERVABILITY_SIGNAL_WRITE_MODE: 'dual',
      OBSERVABILITY_SIGNAL_READ_MODE: 'clickhouse',
      CLICKHOUSE_URL: 'http://127.0.0.1:8123',
      CLICKHOUSE_WRITER_USERNAME: 'writer',
      CLICKHOUSE_WRITER_PASSWORD: 'writer-secret',
      CLICKHOUSE_READINESS_USERNAME: 'readiness',
      CLICKHOUSE_READINESS_PASSWORD: 'readiness-secret',
      CLICKHOUSE_READER_USERNAME: 'reader',
      CLICKHOUSE_READER_PASSWORD: 'reader-secret',
    });
    expect(env.CLICKHOUSE_WRITER_USERNAME).toBe('writer');
    expect(env.CLICKHOUSE_READER_USERNAME).toBe('reader');
  });

  test('requires TLS for an active production ClickHouse route', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'production',
        LOG_DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/project',
        INTERNAL_AUTH_SIGNING_SECRET: 'test-secret',
        OBSERVABILITY_SIGNAL_WRITE_MODE: 'clickhouse',
        OBSERVABILITY_SIGNAL_READ_MODE: 'clickhouse',
        OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID:
          '01812345-6789-7abc-8def-0123456789ab',
        OBSERVABILITY_DATABASE_URL:
          'postgres://control-reader@localhost/project',
        CLICKHOUSE_URL: 'http://127.0.0.1:8123',
        CLICKHOUSE_WRITER_USERNAME: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-secret',
        CLICKHOUSE_READINESS_USERNAME: 'readiness',
        CLICKHOUSE_READINESS_PASSWORD: 'readiness-secret',
        CLICKHOUSE_READER_USERNAME: 'reader',
        CLICKHOUSE_READER_PASSWORD: 'reader-secret',
      }),
    ).toThrow('CLICKHOUSE_URL must use HTTPS');
  });

  test('keeps Signal queue and batch limits within the bounded storage contract', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS: '20001',
      }),
    ).toThrow();
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES: '33554433',
      }),
    ).toThrow();
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS: '5001',
      }),
    ).toThrow();
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES: '4194305',
      }),
    ).toThrow();
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_FLUSH_INTERVAL_MS: '501',
      }),
    ).toThrow();
  });

  test('rejects a batch that cannot fit inside its configured queue', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS: '100',
        OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS: '101',
      }),
    ).toThrow('BATCH_MAX_ITEMS cannot exceed');
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES: '1000000',
        OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES: '1000001',
      }),
    ).toThrow('BATCH_MAX_BYTES cannot exceed');
  });

  test('requires queue and batch byte caps to fit one legal Signal', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES: '4095',
      }),
    ).toThrow();
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES: '4095',
      }),
    ).toThrow();
  });

  test('rejects ClickHouse endpoint userinfo and an HTTP private CA configuration', () => {
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        CLICKHOUSE_URL: 'https://writer:writer-secret@clickhouse.internal',
      }),
    ).toThrow('CLICKHOUSE_URL must not contain username or password');
    expect(() =>
      loadEnv('test', {
        NODE_ENV: 'test',
        CLICKHOUSE_URL: 'http://127.0.0.1:8123',
        CLICKHOUSE_TLS_CA_FILE: '/run/secrets/clickhouse-ca.pem',
      }),
    ).toThrow('CLICKHOUSE_TLS_CA_FILE requires an HTTPS CLICKHOUSE_URL');
  });
});
