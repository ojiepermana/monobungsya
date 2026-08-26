import { createHash } from 'node:crypto';
import {
  closeDatabaseClient,
  createDatabaseClient,
  type DatabaseClient,
  jakartaYear,
} from '#project/database';
import {
  createPostgresObservabilitySignalStore,
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignalStore,
} from '#project/observability';

const LOCAL_POSTGRES_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  '[::1]',
  'localhost',
]);
const CONFIRMATION_VALUE = 'local-adapter-contract';

export interface LocalPostgresAdapterContractConfig {
  telemetryDatabaseUrl: string;
  logsDatabaseUrl: string;
  telemetryCleanupDatabaseUrl: string;
  logsCleanupDatabaseUrl: string;
}

export interface PostgresAdapterContractPartitions {
  spans: string;
  metricBuckets: string;
  logging: string;
  accessLogs: string;
}

function localPostgresUrl(
  environment: Record<string, string | undefined>,
  key: string,
): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a PostgreSQL URL`);
  }
  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    !LOCAL_POSTGRES_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(`${key} must point to localhost for this contract`);
  }
  return value;
}

/**
 * This executable deliberately has no fallback to DATABASE_URL: an operator
 * must make both storage targets explicit and confirm that they are local.
 */
export function parseLocalPostgresAdapterContractConfig(
  environment: Record<string, string | undefined> = Bun.env,
): LocalPostgresAdapterContractConfig {
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      'local PostgreSQL adapter contract cannot run in production',
    );
  }
  if (
    environment.OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_CONFIRM !==
    CONFIRMATION_VALUE
  ) {
    throw new Error(
      'OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_CONFIRM must equal local-adapter-contract',
    );
  }
  return {
    telemetryDatabaseUrl: localPostgresUrl(
      environment,
      'TELEMETRY_DATABASE_URL',
    ),
    logsDatabaseUrl: localPostgresUrl(environment, 'LOG_DATABASE_URL'),
    telemetryCleanupDatabaseUrl: localPostgresUrl(
      environment,
      'OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_TELEMETRY_CLEANUP_URL',
    ),
    logsCleanupDatabaseUrl: localPostgresUrl(
      environment,
      'OBSERVABILITY_POSTGRES_ADAPTER_CONTRACT_LOG_CLEANUP_URL',
    ),
  };
}

export function postgresAdapterContractPartitions(
  timestamp: string,
): PostgresAdapterContractPartitions {
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error('adapter contract timestamp must be valid');
  }
  const utcDate = timestamp.slice(0, 10).replaceAll('-', '_');
  if (!/^\d{4}_\d{2}_\d{2}$/.test(utcDate)) {
    throw new Error('adapter contract timestamp must be an ISO timestamp');
  }
  const jakartaPartitionYear = jakartaYear(instant);
  const utcPartitionYear = utcDate.slice(0, 4);
  return {
    spans: `telemetry.spans_${utcPartitionYear}_${utcDate}`,
    metricBuckets: `telemetry.metric_buckets_${utcPartitionYear}_${utcDate}`,
    logging: `partition.logging_${jakartaPartitionYear}`,
    accessLogs: `partition.access_logs_${jakartaPartitionYear}`,
  };
}

function digest(marker: string, length: number): string {
  return createHash('sha256').update(marker).digest('hex').slice(0, length);
}

function numberFromRow(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function queryRows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(
      'PostgreSQL adapter contract received an invalid query result',
    );
  }
  return value as readonly Record<string, unknown>[];
}

async function assertRelationExists(
  database: DatabaseClient,
  relation: string,
): Promise<void> {
  const rows = queryRows(
    await database.unsafe('SELECT to_regclass($1) AS relation', [relation]),
  );
  if (!rows[0]?.relation) {
    throw new Error(
      `PostgreSQL adapter contract requires existing partition ${relation}`,
    );
  }
}

async function assertExactCount(
  database: DatabaseClient,
  sql: string,
  params: readonly unknown[],
  name: string,
): Promise<void> {
  const rows = queryRows(await database.unsafe(sql, [...params] as never[]));
  if (numberFromRow(rows[0]?.count) !== 1) {
    throw new Error(`PostgreSQL adapter contract did not read back ${name}`);
  }
}

async function cleanupExactRecord(
  database: DatabaseClient,
  sql: string,
  params: readonly unknown[],
  name: string,
  requireOne: boolean,
): Promise<void> {
  const rows = queryRows(await database.unsafe(sql, [...params] as never[]));
  if (rows.length > 1 || (requireOne && rows.length !== 1)) {
    throw new Error(
      `PostgreSQL adapter contract cleanup did not remove ${name}`,
    );
  }
}

function cleanupFailures(
  outcomes: readonly PromiseSettledResult<void>[],
): unknown[] {
  return outcomes
    .filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    )
    .map((outcome) => outcome.reason);
}

function throwCleanupFailures(
  failures: readonly unknown[],
  originalError: unknown,
): void {
  if (failures.length === 0) return;
  if (originalError) {
    throw new AggregateError(
      [originalError, ...failures],
      'PostgreSQL adapter contract and cleanup both failed',
    );
  }
  throw new AggregateError(
    failures,
    'PostgreSQL adapter contract cleanup failed',
  );
}

/**
 * Writes four valid Signals through the public PostgreSQL adapter, reads each
 * one back by its exact primary key, then deletes only those exact rows.
 * It never creates partitions, accepts a remote host, or uses broad cleanup.
 */
export async function runLocalPostgresAdapterContract(
  environment: Record<string, string | undefined> = Bun.env,
): Promise<void> {
  const configuration = parseLocalPostgresAdapterContractConfig(environment);
  const telemetryDatabase = createDatabaseClient(
    configuration.telemetryDatabaseUrl,
  );
  const logsDatabase = createDatabaseClient(configuration.logsDatabaseUrl);
  const telemetryCleanupDatabase = createDatabaseClient(
    configuration.telemetryCleanupDatabaseUrl,
  );
  const logsCleanupDatabase = createDatabaseClient(
    configuration.logsCleanupDatabaseUrl,
  );
  const now = new Date();
  const eventAt = new Date(now.getTime() - 1_000).toISOString();
  const marker = `pg-adapter-${Bun.randomUUIDv7()}`;
  const traceId = digest(`${marker}:trace`, 32);
  const spanId = digest(`${marker}:span`, 16);
  const seriesFingerprint = digest(`${marker}:metric`, 64);
  const applicationLogId = Bun.randomUUIDv7();
  const accessLogId = Bun.randomUUIDv7();
  const partitions = postgresAdapterContractPartitions(eventAt);
  let store: ObservabilitySignalStore | undefined;
  let readBackSucceeded = false;
  let originalError: unknown;

  try {
    await Promise.all([
      assertRelationExists(telemetryDatabase, partitions.spans),
      assertRelationExists(telemetryDatabase, partitions.metricBuckets),
      assertRelationExists(logsDatabase, partitions.logging),
      assertRelationExists(logsDatabase, partitions.accessLogs),
    ]);

    store = createPostgresObservabilitySignalStore({
      telemetryDatabase,
      logsDatabase,
      flushIntervalMs: 60_000,
    });
    const appended = [
      store.append({
        kind: 'span',
        traceId,
        spanId,
        parentSpanId: null,
        correlationId: marker,
        requestId: marker,
        runId: null,
        serviceName: marker,
        serviceInstanceId: 'local-adapter-contract',
        resourceKind: 'http.server',
        resourceName: 'observability-adapter-contract',
        operation: 'GET',
        status: 'ok',
        samplingReason: 'deterministic',
        attributes: { adapter_contract: true },
        errorType: null,
        startedAt: eventAt,
        finishedAt: now.toISOString(),
        durationNs: 1_000_000_000,
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
      store.append({
        kind: 'metric_bucket',
        bucketStart: eventAt,
        bucketWidthSeconds: 60,
        seriesFingerprint,
        flushSequence: 1,
        serviceName: marker,
        serviceInstanceId: 'local-adapter-contract',
        resourceKind: 'http.server',
        resourceName: 'observability-adapter-contract',
        metricName: 'observability.adapter.contract',
        metricKind: 'counter',
        unit: 'count',
        count: 1,
        sum: 1,
        min: 1,
        max: 1,
        histogramBoundaries: [],
        histogramCounts: [1],
        labels: { marker },
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
      store.append({
        kind: 'application_log',
        id: applicationLogId,
        level: 'info',
        channel: 'observability',
        category: 'verification',
        event: marker,
        module: 'adapter-contract',
        message: 'local adapter contract verification',
        context: { marker },
        exceptionClass: null,
        exceptionMessage: null,
        stackTrace: null,
        actorUserId: null,
        actorName: null,
        actorEmail: null,
        entityType: null,
        entityId: null,
        referenceNo: null,
        branchCode: null,
        requestId: marker,
        traceId: null,
        runtimeTraceId: traceId,
        runtimeSpanId: spanId,
        sessionId: null,
        ipAddress: null,
        userAgent: null,
        occurredAt: eventAt,
        createdAt: now.toISOString(),
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
      store.append({
        kind: 'access_log',
        id: accessLogId,
        event: marker,
        outcome: 'success',
        authenticationMethod: null,
        accessChannel: 'internal',
        guard: null,
        actorUserId: null,
        actorName: null,
        actorEmail: null,
        branchCode: null,
        ipAddress: null,
        forwardedIp: null,
        userAgent: null,
        deviceName: null,
        platform: null,
        browser: null,
        sessionId: null,
        requestId: marker,
        traceId: null,
        runtimeTraceId: traceId,
        runtimeSpanId: spanId,
        routeName: 'observability-adapter-contract',
        path: '/internal/observability/storage-health',
        method: 'GET',
        httpStatus: 200,
        failureReason: null,
        metadata: { marker },
        accessedAt: eventAt,
        createdAt: now.toISOString(),
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      }),
    ];
    if (appended.some((result) => result.status !== 'accepted')) {
      throw new Error('PostgreSQL adapter contract rejected a valid Signal');
    }

    const flush = await store.flush(5_000);
    if (
      flush.written !== 4 ||
      flush.dropped !== 0 ||
      flush.failed ||
      flush.timedOut
    ) {
      throw new Error(
        'PostgreSQL adapter contract did not receive four acknowledged Signal rows',
      );
    }
    if (!store.diagnostics().lastAcknowledgedAt) {
      throw new Error(
        'PostgreSQL adapter contract did not record an acknowledgement',
      );
    }

    await Promise.all([
      assertExactCount(
        telemetryDatabase,
        'SELECT count(*) AS count FROM "telemetry"."spans" WHERE trace_id = $1 AND span_id = $2 AND started_at = $3',
        [traceId, spanId, eventAt],
        'span',
      ),
      assertExactCount(
        telemetryDatabase,
        'SELECT count(*) AS count FROM "telemetry"."metric_buckets" WHERE bucket_start = $1 AND series_fingerprint = $2',
        [eventAt, seriesFingerprint],
        'metric bucket',
      ),
      assertExactCount(
        logsDatabase,
        'SELECT count(*) AS count FROM "logs"."logging" WHERE id = $1 AND occurred_at = $2',
        [applicationLogId, eventAt],
        'application log',
      ),
      assertExactCount(
        logsDatabase,
        'SELECT count(*) AS count FROM "logs"."access_logs" WHERE id = $1 AND accessed_at = $2',
        [accessLogId, eventAt],
        'access log',
      ),
    ]);
    readBackSucceeded = true;
    console.log('Local PostgreSQL adapter contract succeeded');
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    const cleanup = [
      cleanupExactRecord(
        telemetryCleanupDatabase,
        'DELETE FROM "telemetry"."spans" WHERE trace_id = $1 AND span_id = $2 AND started_at = $3 RETURNING trace_id',
        [traceId, spanId, eventAt],
        'span',
        readBackSucceeded,
      ),
      cleanupExactRecord(
        telemetryCleanupDatabase,
        'DELETE FROM "telemetry"."metric_buckets" WHERE bucket_start = $1 AND series_fingerprint = $2 RETURNING series_fingerprint',
        [eventAt, seriesFingerprint],
        'metric bucket',
        readBackSucceeded,
      ),
      cleanupExactRecord(
        logsCleanupDatabase,
        'DELETE FROM "logs"."logging" WHERE id = $1 AND occurred_at = $2 RETURNING id',
        [applicationLogId, eventAt],
        'application log',
        readBackSucceeded,
      ),
      cleanupExactRecord(
        logsCleanupDatabase,
        'DELETE FROM "logs"."access_logs" WHERE id = $1 AND accessed_at = $2 RETURNING id',
        [accessLogId, eventAt],
        'access log',
        readBackSucceeded,
      ),
    ];
    const cleanupOutcomes = await Promise.allSettled(cleanup);
    const teardown = [
      closeDatabaseClient(telemetryDatabase),
      closeDatabaseClient(logsDatabase),
      closeDatabaseClient(telemetryCleanupDatabase),
      closeDatabaseClient(logsCleanupDatabase),
    ];
    if (store) teardown.unshift(store.shutdown().then(() => undefined));
    const teardownOutcomes = await Promise.allSettled(teardown);
    throwCleanupFailures(
      [
        ...cleanupFailures(cleanupOutcomes),
        ...cleanupFailures(teardownOutcomes),
      ],
      originalError,
    );
  }
}

if (import.meta.main) {
  runLocalPostgresAdapterContract().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Local PostgreSQL adapter contract failed',
    );
    process.exitCode = 1;
  });
}
