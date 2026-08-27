import {
  type DatabaseClient,
  withLogPartitionRecovery,
  withTransaction,
} from '#project/database';
import {
  BufferedObservabilitySignalStore,
  canonicalJson,
  type SignalBatch,
  type SignalTarget,
} from './store';
import type {
  ObservabilitySignalStore,
  StoredObservabilitySignal,
} from './types';

export interface PostgresObservabilitySignalStoreOptions {
  telemetryDatabase?: DatabaseClient;
  logsDatabase?: DatabaseClient;
  maxItems?: number;
  maxBytes?: number;
  batchMaxItems?: number;
  batchMaxBytes?: number;
  flushIntervalMs?: number;
  maxInFlight?: number;
  retryLimit?: number;
}

function sqlValues(rows: readonly unknown[][]): {
  sql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const placeholders = rows.map((row) => {
    const values = row.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${values.join(', ')})`;
  });
  return { sql: placeholders.join(', '), params };
}

function nullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : canonicalJson(value);
}

class PostgresSignalTarget implements SignalTarget {
  readonly name = 'postgres';

  constructor(
    private readonly telemetryDatabase: DatabaseClient | undefined,
    private readonly logsDatabase: DatabaseClient | undefined,
  ) {}

  async write(batch: SignalBatch): Promise<void> {
    if (batch.kind === 'span' || batch.kind === 'metric_bucket') {
      if (!this.telemetryDatabase) {
        throw new Error('postgres telemetry storage unavailable');
      }
      await withTransaction(this.telemetryDatabase, async (transaction) => {
        if (batch.kind === 'span') {
          await this.writeSpans(transaction, batch.signals);
        } else {
          await this.writeMetricBuckets(transaction, batch.signals);
        }
      });
      return;
    }
    if (!this.logsDatabase) {
      throw new Error('postgres logs storage unavailable');
    }
    if (batch.kind === 'application_log') {
      await this.writeApplicationLogs(this.logsDatabase, batch.signals);
    } else {
      await this.writeAccessLogs(this.logsDatabase, batch.signals);
    }
  }

  private async writeSpans(
    transaction: DatabaseClient,
    signals: readonly StoredObservabilitySignal[],
  ): Promise<void> {
    const values = sqlValues(
      signals.map((signal) => {
        if (signal.kind !== 'span') throw new Error('span batch is mixed');
        return [
          signal.traceId,
          signal.spanId,
          signal.parentSpanId,
          signal.correlationId,
          signal.requestId,
          signal.runId,
          signal.serviceName,
          signal.serviceInstanceId,
          signal.resourceKind,
          signal.resourceName,
          signal.operation,
          signal.status,
          signal.samplingReason,
          canonicalJson(signal.attributes),
          signal.errorType,
          signal.startedAt,
          signal.finishedAt,
          signal.durationNs,
        ];
      }),
    );
    await transaction.unsafe(
      `INSERT INTO "telemetry"."spans" (trace_id, span_id, parent_span_id, correlation_id, request_id, run_id, service_name, service_instance_id, resource_kind, resource_name, operation, status, sampling_reason, attributes, error_type, started_at, finished_at, duration_ns) VALUES ${values.sql} ON CONFLICT DO NOTHING`,
      values.params as never[],
    );
  }

  private async writeMetricBuckets(
    transaction: DatabaseClient,
    signals: readonly StoredObservabilitySignal[],
  ): Promise<void> {
    const values = sqlValues(
      signals.map((signal) => {
        if (signal.kind !== 'metric_bucket') {
          throw new Error('metric bucket batch is mixed');
        }
        return [
          signal.bucketStart,
          signal.bucketWidthSeconds,
          signal.seriesFingerprint,
          signal.flushSequence,
          signal.serviceName,
          signal.serviceInstanceId,
          signal.resourceKind,
          signal.resourceName,
          signal.metricName,
          signal.metricKind,
          signal.unit,
          signal.count,
          signal.sum,
          signal.min,
          signal.max,
          transaction.array(signal.histogramBoundaries, 'float8'),
          transaction.array(signal.histogramCounts, 'int8'),
          canonicalJson(signal.labels),
        ];
      }),
    );
    await transaction.unsafe(
      `INSERT INTO "telemetry"."metric_buckets" (bucket_start, bucket_width_seconds, series_fingerprint, flush_sequence, service_name, service_instance_id, resource_kind, resource_name, metric_name, metric_kind, unit, count, sum, min, max, histogram_boundaries, histogram_counts, labels) VALUES ${values.sql} ON CONFLICT (bucket_start, series_fingerprint) DO UPDATE SET flush_sequence = EXCLUDED.flush_sequence, count = EXCLUDED.count, sum = EXCLUDED.sum, min = EXCLUDED.min, max = EXCLUDED.max, histogram_boundaries = EXCLUDED.histogram_boundaries, histogram_counts = EXCLUDED.histogram_counts, labels = EXCLUDED.labels WHERE EXCLUDED.flush_sequence > "telemetry"."metric_buckets".flush_sequence`,
      values.params as never[],
    );
  }

  private async writeApplicationLogs(
    database: DatabaseClient,
    signals: readonly StoredObservabilitySignal[],
  ): Promise<void> {
    for (const signal of signals) {
      if (signal.kind !== 'application_log') {
        throw new Error('application log batch is mixed');
      }
      await withLogPartitionRecovery(
        database,
        'logging',
        signal.occurredAt,
        () => database`
        INSERT INTO "logs"."logging" (
          id, level, channel, category, event, module, message, context,
          exception_class, exception_message, stack_trace,
          actor_user_id, actor_name, actor_email,
          entity_type, entity_id, reference_no, branch_code,
          request_id, trace_id, runtime_trace_id, runtime_span_id,
          session_id, ip_address, user_agent, occurred_at, created_at
        ) VALUES (
          ${signal.id}, ${signal.level}, ${signal.channel}, ${signal.category},
          ${signal.event}, ${signal.module}, ${signal.message}, ${nullableJson(signal.context)},
          ${signal.exceptionClass}, ${signal.exceptionMessage}, ${signal.stackTrace},
          ${signal.actorUserId}, ${signal.actorName}, ${signal.actorEmail},
          ${signal.entityType}, ${signal.entityId}, ${signal.referenceNo}, ${signal.branchCode},
          ${signal.requestId}, ${signal.traceId}, ${signal.runtimeTraceId}, ${signal.runtimeSpanId},
          ${signal.sessionId}, ${signal.ipAddress}, ${signal.userAgent},
          ${signal.occurredAt}, ${signal.createdAt}
        )
      `,
      );
    }
  }

  private async writeAccessLogs(
    database: DatabaseClient,
    signals: readonly StoredObservabilitySignal[],
  ): Promise<void> {
    for (const signal of signals) {
      if (signal.kind !== 'access_log') {
        throw new Error('access log batch is mixed');
      }
      await withLogPartitionRecovery(
        database,
        'access_logs',
        signal.accessedAt,
        () => database`
        INSERT INTO "logs"."access_logs" (
          id, event, outcome, authentication_method, access_channel, guard,
          actor_user_id, actor_name, actor_email, branch_code,
          ip_address, forwarded_ip, user_agent, device_name, platform, browser,
          session_id, request_id, trace_id, runtime_trace_id, runtime_span_id,
          route_name, path, method, http_status, failure_reason, metadata,
          accessed_at, created_at
        ) VALUES (
          ${signal.id}, ${signal.event}, ${signal.outcome},
          ${signal.authenticationMethod}, ${signal.accessChannel}, ${signal.guard},
          ${signal.actorUserId}, ${signal.actorName}, ${signal.actorEmail}, ${signal.branchCode},
          ${signal.ipAddress}, ${signal.forwardedIp}, ${signal.userAgent},
          ${signal.deviceName}, ${signal.platform}, ${signal.browser},
          ${signal.sessionId}, ${signal.requestId}, ${signal.traceId},
          ${signal.runtimeTraceId}, ${signal.runtimeSpanId}, ${signal.routeName},
          ${signal.path}, ${signal.method}, ${signal.httpStatus}, ${signal.failureReason},
          ${nullableJson(signal.metadata)}, ${signal.accessedAt}, ${signal.createdAt}
        )
      `,
      );
    }
  }
}

export function createPostgresSignalTarget(
  options: Pick<
    PostgresObservabilitySignalStoreOptions,
    'telemetryDatabase' | 'logsDatabase'
  >,
): SignalTarget {
  return new PostgresSignalTarget(
    options.telemetryDatabase,
    options.logsDatabase,
  );
}

export function createPostgresObservabilitySignalStore(
  options: PostgresObservabilitySignalStoreOptions,
): ObservabilitySignalStore {
  return new BufferedObservabilitySignalStore({
    ...options,
    targets: [createPostgresSignalTarget(options)],
  });
}
