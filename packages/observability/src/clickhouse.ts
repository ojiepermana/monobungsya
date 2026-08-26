import {
  canonicalJson,
  type SignalBatch,
  SignalDeliveryError,
  type SignalTarget,
} from './store';
import type { SignalKind, StoredObservabilitySignal } from './types';

type ClickHouseScalar = string | number | boolean;
type ClickHouseFetchInit = RequestInit & { tls?: Bun.TLSOptions };

export type ClickHouseFetch = (
  input: RequestInfo | URL,
  init?: ClickHouseFetchInit,
) => Promise<Response>;

export interface ClickHouseClientOptions {
  url: string;
  username: string;
  password: string;
  database?: string;
  requestTimeoutMs?: number;
  /** Private CA bundle used by Bun fetch for an HTTPS ClickHouse endpoint. */
  tlsCaFile?: string;
  fetch?: ClickHouseFetch;
}

export interface ClickHouseRequest {
  query: string;
  params?: Readonly<Record<string, ClickHouseScalar>>;
  settings?: Readonly<Record<string, ClickHouseScalar>>;
  body?: string;
  /** Overrides the client default for this bounded request only. */
  timeoutMs?: number;
  /** Null sends no database parameter, for bootstrap statements. */
  database?: string | null;
}

export interface ClickHouseInsertRequest {
  table: string;
  batchId: string;
  body: string;
}

function normalizeQuery(value: string): string {
  const query = value.trim().replace(/;+$/, '');
  if (query === '') {
    throw new SignalDeliveryError('clickhouse_invalid_query');
  }
  return query;
}

function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function safeErrorForResponse(
  status: number,
  responseBody: string,
): SignalDeliveryError {
  if (
    status === 401 ||
    status === 403 ||
    /not enough privileges|access denied|authentication failed/i.test(
      responseBody,
    )
  ) {
    return new SignalDeliveryError('clickhouse_unauthorized');
  }
  if (status === 429 || status >= 500) {
    return new SignalDeliveryError(`clickhouse_http_${status}`, {
      transient: true,
    });
  }
  if (status === 400) {
    const isRowSpecific =
      /cannot parse|parse error|type mismatch|too large/i.test(responseBody);
    return new SignalDeliveryError(
      isRowSpecific ? 'clickhouse_row_invalid' : 'clickhouse_rejected',
      { rowSpecific: isRowSpecific },
    );
  }
  if (status === 404) {
    return new SignalDeliveryError('clickhouse_table_missing');
  }
  return new SignalDeliveryError(`clickhouse_http_${status}`);
}

/**
 * Minimal direct HTTP client. Query text is owned by the adapter, while every
 * variable value is carried through ClickHouse HTTP parameters.
 */
export class ClickHouseClient {
  private readonly endpoint: URL;
  private readonly database: string;
  private readonly requestTimeoutMs: number;
  private readonly fetcher: ClickHouseFetch;
  private readonly authorization: string;
  private readonly tls: Bun.TLSOptions | undefined;

  constructor(options: ClickHouseClientOptions) {
    this.endpoint = new URL(options.url);
    if (
      this.endpoint.protocol !== 'http:' &&
      this.endpoint.protocol !== 'https:'
    ) {
      throw new Error('CLICKHOUSE_URL must use HTTP or HTTPS');
    }
    if (this.endpoint.username !== '' || this.endpoint.password !== '') {
      throw new Error('CLICKHOUSE_URL must not contain username or password');
    }
    this.database = options.database ?? 'observability';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.authorization = basicAuthorization(options.username, options.password);
    this.tls = options.tlsCaFile
      ? { ca: Bun.file(options.tlsCaFile) }
      : undefined;
  }

  async execute(request: ClickHouseRequest): Promise<string> {
    const url = new URL(this.endpoint);
    const database =
      request.database === undefined ? this.database : request.database;
    if (database !== null) url.searchParams.set('database', database);
    url.searchParams.set('query', normalizeQuery(request.query));
    for (const [name, value] of Object.entries(request.params ?? {})) {
      url.searchParams.set(`param_${name}`, String(value));
    }
    for (const [name, value] of Object.entries(request.settings ?? {})) {
      url.searchParams.set(name, String(value));
    }

    const timeoutMs = request.timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: this.authorization,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: request.body,
        signal: controller.signal,
        ...(this.tls ? { tls: this.tls } : {}),
      });
      const responseBody = await response.text();
      if (!response.ok) {
        throw safeErrorForResponse(response.status, responseBody);
      }
      return responseBody;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SignalDeliveryError('clickhouse_timeout', {
          transient: true,
        });
      }
      if (error instanceof SignalDeliveryError) throw error;
      throw new SignalDeliveryError('clickhouse_unreachable', {
        transient: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async queryRows<Row extends object>(
    query: string,
    options: Omit<ClickHouseRequest, 'query' | 'body'> = {},
  ): Promise<Row[]> {
    const text = await this.execute({
      ...options,
      query: `${normalizeQuery(query)} FORMAT JSONEachRow`,
    });
    if (text.trim() === '') return [];
    try {
      return text
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as Row);
    } catch {
      throw new SignalDeliveryError('clickhouse_response_invalid');
    }
  }

  async insert(request: ClickHouseInsertRequest): Promise<void> {
    if (!SIGNAL_TABLES.has(request.table)) {
      throw new SignalDeliveryError('clickhouse_invalid_table');
    }
    await this.execute({
      query: `INSERT INTO ${this.database}.${request.table} FORMAT JSONEachRow`,
      settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_deduplicate: 1,
        insert_deduplicate: 1,
        insert_deduplication_token: request.batchId,
      },
      body: request.body,
    });
  }
}

const SIGNAL_TABLES = new Set([
  'spans',
  'metric_buckets',
  'application_logs',
  'access_logs',
]);

function timestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SignalDeliveryError('clickhouse_timestamp_invalid', {
      rowSpecific: true,
    });
  }
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function tableForKind(kind: SignalKind): string {
  switch (kind) {
    case 'span':
      return 'spans';
    case 'metric_bucket':
      return 'metric_buckets';
    case 'application_log':
      return 'application_logs';
    case 'access_log':
      return 'access_logs';
  }
}

function rowForSignal(
  signal: StoredObservabilitySignal,
): Record<string, unknown> {
  switch (signal.kind) {
    case 'span':
      return {
        trace_id: signal.traceId,
        span_id: signal.spanId,
        parent_span_id: signal.parentSpanId,
        correlation_id: signal.correlationId,
        request_id: signal.requestId,
        run_id: signal.runId,
        service_name: signal.serviceName,
        service_instance_id: signal.serviceInstanceId,
        resource_kind: signal.resourceKind,
        resource_name: signal.resourceName,
        operation: signal.operation,
        status: signal.status,
        sampling_reason: signal.samplingReason,
        attributes: canonicalJson(signal.attributes),
        error_type: signal.errorType,
        started_at: timestamp(signal.startedAt),
        finished_at: timestamp(signal.finishedAt),
        duration_ns: signal.durationNs,
        schema_version: signal.schemaVersion,
        ingested_at: timestamp(signal.ingestedAt),
        write_version: signal.writeVersion,
      };
    case 'metric_bucket':
      return {
        bucket_start: timestamp(signal.bucketStart),
        bucket_width_seconds: signal.bucketWidthSeconds,
        series_fingerprint: signal.seriesFingerprint,
        flush_sequence: signal.flushSequence,
        service_name: signal.serviceName,
        service_instance_id: signal.serviceInstanceId,
        resource_kind: signal.resourceKind,
        resource_name: signal.resourceName,
        metric_name: signal.metricName,
        metric_kind: signal.metricKind,
        unit: signal.unit,
        count: signal.count,
        sum: signal.sum,
        min: signal.min,
        max: signal.max,
        histogram_boundaries: signal.histogramBoundaries,
        histogram_counts: signal.histogramCounts,
        labels: canonicalJson(signal.labels),
        schema_version: signal.schemaVersion,
        ingested_at: timestamp(signal.ingestedAt),
      };
    case 'application_log':
      return {
        id: signal.id,
        level: signal.level,
        channel: signal.channel,
        category: signal.category,
        event: signal.event,
        module: signal.module,
        message: signal.message,
        context: signal.context === null ? null : canonicalJson(signal.context),
        exception_class: signal.exceptionClass,
        exception_message: signal.exceptionMessage,
        stack_trace: signal.stackTrace,
        actor_user_id: signal.actorUserId,
        actor_name: signal.actorName,
        actor_email: signal.actorEmail,
        entity_type: signal.entityType,
        entity_id: signal.entityId,
        reference_no: signal.referenceNo,
        branch_code: signal.branchCode,
        request_id: signal.requestId,
        trace_id: signal.traceId,
        runtime_trace_id: signal.runtimeTraceId,
        runtime_span_id: signal.runtimeSpanId,
        session_id: signal.sessionId,
        ip_address: signal.ipAddress,
        user_agent: signal.userAgent,
        occurred_at: timestamp(signal.occurredAt),
        created_at: timestamp(signal.createdAt),
        schema_version: signal.schemaVersion,
        ingested_at: timestamp(signal.ingestedAt),
        write_version: signal.writeVersion,
      };
    case 'access_log':
      return {
        id: signal.id,
        event: signal.event,
        outcome: signal.outcome,
        authentication_method: signal.authenticationMethod,
        access_channel: signal.accessChannel,
        guard: signal.guard,
        actor_user_id: signal.actorUserId,
        actor_name: signal.actorName,
        actor_email: signal.actorEmail,
        branch_code: signal.branchCode,
        ip_address: signal.ipAddress,
        forwarded_ip: signal.forwardedIp,
        user_agent: signal.userAgent,
        device_name: signal.deviceName,
        platform: signal.platform,
        browser: signal.browser,
        session_id: signal.sessionId,
        request_id: signal.requestId,
        trace_id: signal.traceId,
        runtime_trace_id: signal.runtimeTraceId,
        runtime_span_id: signal.runtimeSpanId,
        route_name: signal.routeName,
        path: signal.path,
        method: signal.method,
        http_status: signal.httpStatus,
        failure_reason: signal.failureReason,
        metadata:
          signal.metadata === null ? null : canonicalJson(signal.metadata),
        accessed_at: timestamp(signal.accessedAt),
        created_at: timestamp(signal.createdAt),
        schema_version: signal.schemaVersion,
        ingested_at: timestamp(signal.ingestedAt),
        write_version: signal.writeVersion,
      };
  }
}

export class ClickHouseSignalTarget implements SignalTarget {
  readonly name = 'clickhouse';

  constructor(private readonly client: ClickHouseClient) {}

  async write(batch: SignalBatch): Promise<void> {
    const body = `${batch.signals
      .map((signal) => JSON.stringify(rowForSignal(signal)))
      .join('\n')}\n`;
    await this.client.insert({
      table: tableForKind(batch.kind),
      batchId: batch.id,
      body,
    });
  }
}

export function createClickHouseSignalTarget(
  options: ClickHouseClientOptions,
): SignalTarget {
  return new ClickHouseSignalTarget(new ClickHouseClient(options));
}
