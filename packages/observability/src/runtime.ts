import type { AppEnvironment } from '#project/config';
import type { DatabaseClient } from '#project/database';
import {
  type ConfiguredClickHouseSignalReader,
  createConfiguredClickHouseSignalReader,
  createConfiguredObservabilitySignalStore,
} from './configured';
import { createDisabledObservabilitySignalStore } from './fake';
import {
  PostgresSignalPromotionControl,
  type SignalPromotionApprovalControl,
} from './promotion-control-postgres';
import type { ObservabilitySignalStore } from './types';

export interface RuntimeObservabilitySignalStoreOptions {
  environment: AppEnvironment;
  logsDatabase?: DatabaseClient;
  telemetryDatabase?: DatabaseClient;
  /** PostgreSQL Control reader used only for production Signal mode activation. */
  controlDatabase?: DatabaseClient;
  /** Injectable Control seam used by runtime tests. */
  promotionControl?: SignalPromotionApprovalControl;
  /** Injectable clock for Control evidence validation. */
  now?: () => Date;
}

export interface RuntimeClickHouseSignalReaderOptions {
  promotionControl?: SignalPromotionApprovalControl;
  controlDatabase?: DatabaseClient;
  now?: () => Date;
}

function isBaselineStorageMode(environment: AppEnvironment): boolean {
  return (
    environment.OBSERVABILITY_SIGNAL_WRITE_MODE === 'postgres' &&
    environment.OBSERVABILITY_SIGNAL_READ_MODE === 'postgres'
  );
}

function requiresProductionActivation(environment: AppEnvironment): boolean {
  return (
    environment.NODE_ENV === 'production' && !isBaselineStorageMode(environment)
  );
}

function requiresProductionPromotionReport(
  environment: AppEnvironment,
): boolean {
  return (
    environment.NODE_ENV === 'production' &&
    ((environment.OBSERVABILITY_SIGNAL_WRITE_MODE === 'dual' &&
      environment.OBSERVABILITY_SIGNAL_READ_MODE === 'clickhouse') ||
      environment.OBSERVABILITY_SIGNAL_WRITE_MODE === 'clickhouse')
  );
}

function promotionTarget(environment: AppEnvironment) {
  return {
    writeMode: environment.OBSERVABILITY_SIGNAL_WRITE_MODE,
    readMode: environment.OBSERVABILITY_SIGNAL_READ_MODE,
  };
}

function promotionControl(
  options: RuntimeClickHouseSignalReaderOptions,
): SignalPromotionApprovalControl | undefined {
  return (
    options.promotionControl ??
    (options.controlDatabase
      ? new PostgresSignalPromotionControl({
          controlDatabase: options.controlDatabase,
          now: options.now,
        })
      : undefined)
  );
}

async function isApprovedProductionStorageMode(
  environment: AppEnvironment,
  control: SignalPromotionApprovalControl | undefined,
): Promise<boolean> {
  if (!requiresProductionActivation(environment)) return true;
  if (!control) return false;
  const requiresReport = requiresProductionPromotionReport(environment);
  const reportId = requiresReport
    ? (environment.OBSERVABILITY_SIGNAL_PROMOTION_REPORT_ID ?? null)
    : null;
  if (requiresReport && reportId === null) return false;
  try {
    const target = promotionTarget(environment);
    if (!(await control.allowsActivatedStorageMode(target, reportId))) {
      return false;
    }
    return (
      reportId === null || (await control.allowsPromotion(reportId, target))
    );
  } catch {
    return false;
  }
}

function promotionUnavailableReadiness() {
  return {
    available: false,
    checkedAt: new Date().toISOString(),
    failureCode: 'clickhouse_promotion_unapproved',
    serverVersion: null,
  } as const;
}

function clickHouseWriterOptions(environment: AppEnvironment) {
  if (
    !environment.CLICKHOUSE_URL ||
    !environment.CLICKHOUSE_WRITER_USERNAME ||
    !environment.CLICKHOUSE_WRITER_PASSWORD
  ) {
    return undefined;
  }
  return {
    url: environment.CLICKHOUSE_URL,
    username: environment.CLICKHOUSE_WRITER_USERNAME,
    password: environment.CLICKHOUSE_WRITER_PASSWORD,
    requestTimeoutMs: environment.CLICKHOUSE_REQUEST_TIMEOUT_MS,
    tlsCaFile: environment.CLICKHOUSE_TLS_CA_FILE,
  };
}

function clickHouseReaderOptions(environment: AppEnvironment) {
  if (
    !environment.CLICKHOUSE_URL ||
    !environment.CLICKHOUSE_READER_USERNAME ||
    !environment.CLICKHOUSE_READER_PASSWORD
  ) {
    return undefined;
  }
  return {
    url: environment.CLICKHOUSE_URL,
    username: environment.CLICKHOUSE_READER_USERNAME,
    password: environment.CLICKHOUSE_READER_PASSWORD,
    requestTimeoutMs: environment.CLICKHOUSE_REQUEST_TIMEOUT_MS,
    tlsCaFile: environment.CLICKHOUSE_TLS_CA_FILE,
  };
}

function clickHouseReadinessOptions(environment: AppEnvironment) {
  if (
    !environment.CLICKHOUSE_URL ||
    !environment.CLICKHOUSE_READINESS_USERNAME ||
    !environment.CLICKHOUSE_READINESS_PASSWORD
  ) {
    return undefined;
  }
  return {
    url: environment.CLICKHOUSE_URL,
    username: environment.CLICKHOUSE_READINESS_USERNAME,
    password: environment.CLICKHOUSE_READINESS_PASSWORD,
    requestTimeoutMs: environment.CLICKHOUSE_REQUEST_TIMEOUT_MS,
    tlsCaFile: environment.CLICKHOUSE_TLS_CA_FILE,
  };
}

/**
 * Keeps process roots declarative while the package owns storage modes,
 * bounded queue policy, and ClickHouse readiness gating.
 */
export async function createRuntimeObservabilitySignalStore(
  options: RuntimeObservabilitySignalStoreOptions,
): Promise<ObservabilitySignalStore> {
  const { environment } = options;
  const control = promotionControl({
    promotionControl: options.promotionControl,
    controlDatabase: options.controlDatabase,
    now: options.now,
  });
  if (!(await isApprovedProductionStorageMode(environment, control))) {
    return createDisabledObservabilitySignalStore(
      'clickhouse_promotion_unapproved',
    );
  }
  return createConfiguredObservabilitySignalStore({
    writeMode: environment.OBSERVABILITY_SIGNAL_WRITE_MODE,
    readMode: environment.OBSERVABILITY_SIGNAL_READ_MODE,
    postgres: {
      logsDatabase: options.logsDatabase,
      telemetryDatabase: options.telemetryDatabase,
    },
    clickhouse: clickHouseWriterOptions(environment),
    readinessClickhouse: clickHouseReadinessOptions(environment),
    maxItems: environment.OBSERVABILITY_SIGNAL_QUEUE_MAX_ITEMS,
    maxBytes: environment.OBSERVABILITY_SIGNAL_QUEUE_MAX_BYTES,
    batchMaxItems: environment.OBSERVABILITY_SIGNAL_BATCH_MAX_ITEMS,
    batchMaxBytes: environment.OBSERVABILITY_SIGNAL_BATCH_MAX_BYTES,
    flushIntervalMs: environment.OBSERVABILITY_SIGNAL_FLUSH_INTERVAL_MS,
    maxInFlight: environment.OBSERVABILITY_SIGNAL_MAX_IN_FLIGHT,
    retryLimit: environment.OBSERVABILITY_SIGNAL_RETRY_LIMIT,
  });
}

export async function createRuntimeClickHouseSignalReader(
  environment: AppEnvironment,
  options: RuntimeClickHouseSignalReaderOptions = {},
): Promise<ConfiguredClickHouseSignalReader> {
  if (
    !(await isApprovedProductionStorageMode(
      environment,
      promotionControl(options),
    ))
  ) {
    return { reader: null, readiness: promotionUnavailableReadiness() };
  }
  return createConfiguredClickHouseSignalReader({
    readMode: environment.OBSERVABILITY_SIGNAL_READ_MODE,
    clickhouse: clickHouseReaderOptions(environment),
    maxConcurrentQueries:
      environment.OBSERVABILITY_SIGNAL_QUERY_MAX_CONCURRENCY,
  });
}

/**
 * Uses the read-only identity for bounded health probes during both shadow
 * write and reader-cutover phases. It never changes the public read mode.
 */
export async function createRuntimeClickHouseProbeReader(
  environment: AppEnvironment,
): Promise<ConfiguredClickHouseSignalReader> {
  return createConfiguredClickHouseSignalReader({
    readMode: 'clickhouse',
    clickhouse: clickHouseReaderOptions(environment),
    maxConcurrentQueries:
      environment.OBSERVABILITY_SIGNAL_QUERY_MAX_CONCURRENCY,
  });
}
