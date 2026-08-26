import {
  ClickHouseClient,
  type ClickHouseClientOptions,
  createClickHouseSignalTarget,
} from './clickhouse';
import { createDisabledObservabilitySignalStore } from './fake';
import { CLICKHOUSE_VERSION_MANIFEST } from './migrations/manifest';
import {
  type ClickHouseSchemaReadiness,
  verifyClickHouseSignalSchema,
} from './migrations/schema';
import {
  createPostgresSignalTarget,
  type PostgresObservabilitySignalStoreOptions,
} from './postgres';
import { ClickHouseSignalReader } from './reader';
import {
  BufferedObservabilitySignalStore,
  type BufferedSignalStoreOptions,
  type SignalTarget,
} from './store';
import {
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignalStore,
} from './types';

export type ObservabilitySignalWriteMode = 'postgres' | 'dual' | 'clickhouse';
export type ObservabilitySignalReadMode = 'postgres' | 'clickhouse';

export interface ConfiguredObservabilitySignalStoreOptions
  extends Omit<BufferedSignalStoreOptions, 'targets'> {
  writeMode: ObservabilitySignalWriteMode;
  readMode: ObservabilitySignalReadMode;
  postgres?: Pick<
    PostgresObservabilitySignalStoreOptions,
    'telemetryDatabase' | 'logsDatabase'
  >;
  clickhouse?: ClickHouseClientOptions;
  readinessClickhouse?: ClickHouseClientOptions;
  verifyClickHouse?: (
    client: ClickHouseClient,
  ) => Promise<ClickHouseSchemaReadiness>;
}

export interface ConfiguredClickHouseSignalReaderOptions {
  readMode: ObservabilitySignalReadMode;
  clickhouse?: ClickHouseClientOptions;
  maxConcurrentQueries?: number;
  verifyClickHouse?: (
    client: ClickHouseClient,
  ) => Promise<ClickHouseSchemaReadiness>;
}

export interface ConfiguredClickHouseSignalReader {
  reader: ClickHouseSignalReader | null;
  readiness: ClickHouseSchemaReadiness | null;
}

export function isValidSignalStorageMode(
  writeMode: ObservabilitySignalWriteMode,
  readMode: ObservabilitySignalReadMode,
): boolean {
  return (
    (writeMode === 'postgres' && readMode === 'postgres') ||
    (writeMode === 'dual' &&
      (readMode === 'postgres' || readMode === 'clickhouse')) ||
    (writeMode === 'clickhouse' && readMode === 'clickhouse')
  );
}

export function assertSignalStorageMode(
  writeMode: ObservabilitySignalWriteMode,
  readMode: ObservabilitySignalReadMode,
): void {
  if (!isValidSignalStorageMode(writeMode, readMode)) {
    throw new Error(
      `Invalid observability signal storage mode: ${writeMode}/${readMode}`,
    );
  }
}

function hasPostgresTarget(
  postgres: ConfiguredObservabilitySignalStoreOptions['postgres'],
): boolean {
  return Boolean(postgres?.telemetryDatabase || postgres?.logsDatabase);
}

export async function createConfiguredObservabilitySignalStore(
  options: ConfiguredObservabilitySignalStoreOptions,
): Promise<ObservabilitySignalStore> {
  assertSignalStorageMode(options.writeMode, options.readMode);
  const targets: SignalTarget[] = [];

  if (options.writeMode === 'postgres' || options.writeMode === 'dual') {
    if (!hasPostgresTarget(options.postgres)) {
      return createDisabledObservabilitySignalStore(
        'postgres_storage_unavailable',
      );
    }
    targets.push(createPostgresSignalTarget(options.postgres ?? {}));
  }

  if (options.writeMode === 'dual' || options.writeMode === 'clickhouse') {
    if (!options.clickhouse) {
      return createDisabledObservabilitySignalStore(
        'clickhouse_configuration_missing',
      );
    }
    if (!options.readinessClickhouse) {
      return createDisabledObservabilitySignalStore(
        'clickhouse_readiness_configuration_missing',
      );
    }
    let readinessClient: ClickHouseClient;
    try {
      readinessClient = new ClickHouseClient(options.readinessClickhouse);
    } catch {
      return createDisabledObservabilitySignalStore(
        'clickhouse_readiness_configuration_invalid',
      );
    }
    const readiness = await (options.verifyClickHouse?.(readinessClient) ??
      verifyClickHouseSignalSchema(readinessClient, {
        expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }));
    if (!readiness.available) {
      return createDisabledObservabilitySignalStore(readiness.failureCode);
    }
    targets.push(createClickHouseSignalTarget(options.clickhouse));
  }

  return new BufferedObservabilitySignalStore({
    maxItems: options.maxItems,
    maxBytes: options.maxBytes,
    batchMaxItems: options.batchMaxItems,
    batchMaxBytes: options.batchMaxBytes,
    flushIntervalMs: options.flushIntervalMs,
    maxInFlight: options.maxInFlight,
    retryLimit: options.retryLimit,
    now: options.now,
    targets,
  });
}

/**
 * Initializes the reader separately from the writer so a reader cutover
 * exposes a Blind Spot instead of silently reading the PostgreSQL shadow.
 */
export async function createConfiguredClickHouseSignalReader(
  options: ConfiguredClickHouseSignalReaderOptions,
): Promise<ConfiguredClickHouseSignalReader> {
  if (options.readMode !== 'clickhouse') {
    return { reader: null, readiness: null };
  }
  if (!options.clickhouse) {
    return {
      reader: null,
      readiness: {
        available: false,
        checkedAt: new Date().toISOString(),
        failureCode: 'clickhouse_reader_configuration_missing',
        serverVersion: null,
      },
    };
  }

  let client: ClickHouseClient;
  try {
    client = new ClickHouseClient(options.clickhouse);
  } catch {
    return {
      reader: null,
      readiness: {
        available: false,
        checkedAt: new Date().toISOString(),
        failureCode: 'clickhouse_reader_configuration_invalid',
        serverVersion: null,
      },
    };
  }

  const readiness = await (options.verifyClickHouse?.(client) ??
    verifyClickHouseSignalSchema(client, {
      expectedServerVersion: CLICKHOUSE_VERSION_MANIFEST.serverVersion,
      schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      requireWriterSettings: false,
    }));
  if (!readiness.available) return { reader: null, readiness };

  return {
    reader: new ClickHouseSignalReader(client, {
      maxConcurrentQueries: options.maxConcurrentQueries,
    }),
    readiness,
  };
}
