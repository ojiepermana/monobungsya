import { describe, expect, test } from 'bun:test';
import {
  parseLocalPostgresAdapterContractConfig,
  postgresAdapterContractPartitions,
} from './observability-postgres-adapter-contract';

const localEnvironment = {
  OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_CONFIRM: 'local-adapter-contract',
  TELEMETRY_DATABASE_URL: 'postgres://telemetry@127.0.0.1:5432/project',
  LOG_DATABASE_URL: 'postgres://logs@localhost:5432/project',
  OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_TELEMETRY_CLEANUP_URL:
    'postgres://cleanup@127.0.0.1:5432/project',
  OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_LOG_CLEANUP_URL:
    'postgres://cleanup@localhost:5432/project',
};

describe('local PostgreSQL observability adapter contract', () => {
  test('requires explicit confirmation and both explicit database targets', () => {
    expect(() =>
      parseLocalPostgresAdapterContractConfig({
        ...localEnvironment,
        OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_CONFIRM: undefined,
      }),
    ).toThrow(
      'OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_CONFIRM must equal local-adapter-contract',
    );
    expect(() =>
      parseLocalPostgresAdapterContractConfig({
        ...localEnvironment,
        TELEMETRY_DATABASE_URL: undefined,
      }),
    ).toThrow('TELEMETRY_DATABASE_URL is required');
    expect(() =>
      parseLocalPostgresAdapterContractConfig({
        ...localEnvironment,
        OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_TELEMETRY_CLEANUP_URL:
          undefined,
      }),
    ).toThrow(
      'OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_TELEMETRY_CLEANUP_URL is required',
    );
  });

  test('refuses a nonlocal database even when confirmation is present', () => {
    expect(() =>
      parseLocalPostgresAdapterContractConfig({
        ...localEnvironment,
        LOG_DATABASE_URL: 'postgres://logs@postgres.example/project',
      }),
    ).toThrow('LOG_DATABASE_URL must point to localhost for this contract');
  });

  test('refuses production mode before opening any database', () => {
    expect(() =>
      parseLocalPostgresAdapterContractConfig({
        ...localEnvironment,
        NODE_ENV: 'production',
      }),
    ).toThrow('local PostgreSQL adapter contract cannot run in production');
  });

  test('pins daily telemetry and Jakarta yearly log partitions without creating them', () => {
    expect(
      postgresAdapterContractPartitions('2025-12-31T17:00:00.000Z'),
    ).toEqual({
      spans: 'telemetry.spans_2025_2025_12_31',
      metricBuckets: 'telemetry.metric_buckets_2025_2025_12_31',
      logging: 'partition.logging_2026',
      accessLogs: 'partition.access_logs_2026',
    });
  });
});
