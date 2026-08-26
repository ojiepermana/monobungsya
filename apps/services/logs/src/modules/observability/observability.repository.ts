import { type DatabaseClient, withTransaction } from '#project/database';
import {
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from '#project/errors';
import { isoFromDbTimestamp } from '#project/logger';
import {
  type BenchmarkReport,
  canonicalJson,
  sha256,
} from '#project/telemetry';
import type {
  AlertStateSummary,
  AlertsResult,
  BenchmarkBaselineQuery,
  BenchmarkBaselinesResult,
  BenchmarkComparison,
  BenchmarkIngestionResult,
  BenchmarkRunDetail,
  BenchmarkRunQuery,
  BenchmarkRunSummary,
  BenchmarkRunsResult,
  MetricGroup,
  MetricQuery,
  MetricsResult,
  TraceDetailResult,
  TraceQuery,
  TraceSpan,
  TraceSummary,
} from './observability.types';

const TRACE_PAGE_SIZE = 50;
const METRIC_STEPS = new Set([60, 300, 900, 3600]);
const DEFAULT_MAX_SERIES = 200;
const DEFAULT_QUERY_TIMEOUT_MS = 5_000;

interface Cursor {
  direction: 'next' | 'prev';
  startedAt: string;
  traceId: string;
}

interface AlertCursor {
  direction: 'next' | 'prev';
  evaluatedAt: string;
  ruleId: string;
  seriesFingerprint: string;
}

interface BenchmarkCursor {
  direction: 'next' | 'prev';
  createdAt: string;
  runId: string;
}

interface BaselineCursor {
  direction: 'next' | 'prev';
  promotedAt: string;
  baselineId: string;
}

interface TracePage {
  items: TraceSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    services: string[];
    resourceKinds: string[];
    resourceNames: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

const BENCHMARK_PAGE_SIZE = 50;

interface ObservabilityRepositoryOptions {
  maxSeries?: number;
  queryTimeoutMs?: number;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function timestamp(value: unknown): string {
  return isoFromDbTimestamp(String(value));
}

function encodeCursor(
  cursor: Omit<Cursor, 'direction'>,
  direction: Cursor['direction'] = 'next',
): string {
  return btoa(`${direction}|${cursor.startedAt}|${cursor.traceId}`);
}

export function decodeTraceCursor(value: string): Cursor {
  try {
    const parts = atob(value).split('|');
    const hasDirection = parts[0] === 'next' || parts[0] === 'prev';
    const direction: Cursor['direction'] =
      hasDirection && parts[0] === 'prev' ? 'prev' : 'next';
    const startedAt = hasDirection ? parts[1] : parts[0];
    const traceId = hasDirection ? parts[2] : parts[1];
    if (!startedAt || !traceId || !/^[0-9a-f]{32}$/.test(traceId)) {
      throw new Error('invalid cursor');
    }
    return { direction, startedAt, traceId };
  } catch {
    throw new Error('invalid cursor');
  }
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function cursor(
  value: string,
  id: string,
  direction: 'next' | 'prev' = 'next',
): string {
  return btoa(`${direction}|${value}|${id}`);
}

export function decodeBenchmarkCursor(value: string): BenchmarkCursor {
  try {
    const parts = atob(value).split('|');
    const hasDirection = parts[0] === 'next' || parts[0] === 'prev';
    const direction: BenchmarkCursor['direction'] =
      hasDirection && parts[0] === 'prev' ? 'prev' : 'next';
    const createdAt = hasDirection ? parts[1] : parts[0];
    const runId = hasDirection ? parts[2] : parts[1];
    if (!createdAt || !runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
      throw new Error('invalid cursor');
    }
    return { direction, createdAt, runId };
  } catch {
    throw new Error('invalid cursor');
  }
}

function encodeAlertCursor(
  cursor: Omit<AlertCursor, 'direction'>,
  direction: AlertCursor['direction'] = 'next',
): string {
  return btoa(
    `${direction}|${cursor.evaluatedAt}|${cursor.ruleId}|${cursor.seriesFingerprint}`,
  );
}

export function decodeAlertCursor(value: string): AlertCursor {
  try {
    const parts = atob(value).split('|');
    const hasDirection = parts[0] === 'next' || parts[0] === 'prev';
    const direction: AlertCursor['direction'] =
      hasDirection && parts[0] === 'prev' ? 'prev' : 'next';
    const evaluatedAt = hasDirection ? parts[1] : parts[0];
    const ruleId = hasDirection ? parts[2] : parts[1];
    const seriesFingerprint = hasDirection ? parts[3] : parts[2];
    if (
      !evaluatedAt ||
      Number.isNaN(Date.parse(evaluatedAt)) ||
      !ruleId ||
      !seriesFingerprint ||
      !/^[0-9a-f]{64}$/i.test(seriesFingerprint)
    ) {
      throw new Error('invalid cursor');
    }
    return { direction, evaluatedAt, ruleId, seriesFingerprint };
  } catch {
    throw new Error('invalid cursor');
  }
}

function encodeBaselineCursor(
  cursor: Omit<BaselineCursor, 'direction'>,
  direction: BaselineCursor['direction'] = 'next',
): string {
  return btoa(`${direction}|${cursor.promotedAt}|${cursor.baselineId}`);
}

export function decodeBaselineCursor(value: string): BaselineCursor {
  try {
    const parts = atob(value).split('|');
    const hasDirection = parts[0] === 'next' || parts[0] === 'prev';
    const direction: BaselineCursor['direction'] =
      hasDirection && parts[0] === 'prev' ? 'prev' : 'next';
    const promotedAt = hasDirection ? parts[1] : parts[0];
    const baselineId = hasDirection ? parts[2] : parts[1];
    if (!promotedAt || !baselineId || !/^[0-9a-f-]{36}$/i.test(baselineId)) {
      throw new Error('invalid cursor');
    }
    return { direction, promotedAt, baselineId };
  } catch {
    throw new Error('invalid cursor');
  }
}

export class ObservabilityRepository {
  private readonly maxSeries: number;
  private readonly queryTimeoutMs: number;

  constructor(
    private readonly database?: DatabaseClient,
    options: ObservabilityRepositoryOptions = {},
  ) {
    this.maxSeries = Math.max(1, options.maxSeries ?? DEFAULT_MAX_SERIES);
    this.queryTimeoutMs = Math.max(
      1,
      options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    );
  }

  isStorageAvailable(): boolean {
    return Boolean(this.database);
  }

  async ingestBenchmark(
    report: BenchmarkReport,
    receipt: { keyId: string; nonce: string; bodyChecksum: string },
  ): Promise<BenchmarkIngestionResult> {
    if (!this.database) {
      throw new ServiceUnavailableError(
        'Benchmark projection storage is unavailable',
        'observability_storage_unavailable',
      );
    }
    if (!/^[0-9a-f-]{36}$/i.test(report.runId)) {
      throw new ValidationError('Benchmark run ID must be a UUID');
    }

    const existingRows = (await this.database.unsafe(
      `SELECT body_checksum, response_body FROM "telemetry"."ingestion_receipts" ` +
        `WHERE key_id = $1 AND nonce = $2`,
      [receipt.keyId, receipt.nonce] as never[],
    )) as Array<Record<string, unknown>>;
    const existing = existingRows[0];
    if (existing) {
      if (String(existing.body_checksum) !== receipt.bodyChecksum) {
        throw new ConflictError(
          'The ingestion nonce was already used for a different body',
          'benchmark_ingestion_replay',
        );
      }
      return parseJson(existing.response_body) as BenchmarkIngestionResult;
    }

    const cachedBodyRows = (await this.database.unsafe(
      `SELECT response_body FROM "telemetry"."ingestion_receipts" ` +
        `WHERE key_id = $1 AND body_checksum = $2 ` +
        `ORDER BY created_at ASC LIMIT 1`,
      [receipt.keyId, receipt.bodyChecksum] as never[],
    )) as Array<Record<string, unknown>>;
    if (cachedBodyRows[0]) {
      return parseJson(
        cachedBodyRows[0].response_body,
      ) as BenchmarkIngestionResult;
    }

    const ingestionId = crypto.randomUUID();
    const status =
      report.status === 'incomplete'
        ? 'incomplete'
        : report.comparisonStatus === 'fail'
          ? 'failed'
          : report.comparisonStatus === 'not_comparable'
            ? 'not_comparable'
            : 'passed';
    const response: BenchmarkIngestionResult = {
      ingestionId,
      runId: report.runId,
      reportChecksum: report.reportChecksum,
      projectionCounts: {
        runs: 1,
        comparisons: report.comparisons.length,
        baselines: 0,
      },
    };
    const responseBody = canonicalJson(response);
    const responseChecksum = sha256(responseBody);

    await withTransaction(this.database, async (transaction) => {
      const lockedRows = (await transaction.unsafe(
        `SELECT body_checksum, response_body FROM "telemetry"."ingestion_receipts" ` +
          `WHERE key_id = $1 AND nonce = $2 FOR UPDATE`,
        [receipt.keyId, receipt.nonce] as never[],
      )) as Array<Record<string, unknown>>;
      const locked = lockedRows[0];
      if (locked) {
        if (String(locked.body_checksum) !== receipt.bodyChecksum) {
          throw new ConflictError(
            'The ingestion nonce was already used for a different body',
            'benchmark_ingestion_replay',
          );
        }
        return;
      }

      await transaction.unsafe(
        `INSERT INTO "telemetry"."benchmark_runs" ` +
          `(run_id, scenario_id, scenario_version, status, source_commit_sha, source_branch, ` +
          `source_checksum, fixture_version, environment, runner_profile, instrumentation_schema_version, ` +
          `threshold_policy_version, bun_version, artifact_uri, trace_uri, artifact_checksum, completeness, ` +
          `started_at, finished_at) VALUES ` +
          `($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          report.runId,
          report.scenario.scenarioId,
          report.scenario.scenarioVersion,
          status,
          report.runner.commitSha,
          report.runner.branch,
          report.source.sourceChecksum,
          report.scenario.fixtureVersion,
          report.runner.environment,
          JSON.stringify(report.runner.runnerProfile),
          report.scenario.instrumentationSchemaVersion,
          report.scenario.thresholdPolicyVersion,
          report.runner.bunVersion,
          report.artifactUri,
          report.traceUri,
          report.reportChecksum,
          report.telemetryComplete ? 'complete' : 'incomplete',
          report.startedAt,
          report.finishedAt,
        ] as never[],
      );

      for (const comparison of report.comparisons) {
        await transaction.unsafe(
          `INSERT INTO "telemetry"."benchmark_comparisons" ` +
            `(run_id, resource_kind, resource_name, metric_key, statistic, unit, baseline_value, ` +
            `candidate_value, absolute_delta, relative_delta_percent, absolute_threshold, relative_threshold, ` +
            `decision, evidence_uri) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            report.runId,
            comparison.resourceKind,
            comparison.resourceName,
            comparison.metricKey,
            comparison.statistic,
            comparison.unit,
            comparison.baselineValue,
            comparison.candidateValue,
            comparison.absoluteDelta,
            comparison.relativeDeltaPercent,
            comparison.absoluteThreshold,
            comparison.relativeThreshold,
            comparison.decision,
            comparison.evidenceUri,
          ] as never[],
        );
      }

      await transaction.unsafe(
        `INSERT INTO "telemetry"."ingestion_receipts" ` +
          `(key_id, nonce, ingestion_id, body_checksum, response_status, response_checksum, response_body, expires_at) ` +
          `VALUES ($1, $2, $3, $4, 200, $5, $6::jsonb, CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
        [
          receipt.keyId,
          receipt.nonce,
          ingestionId,
          receipt.bodyChecksum,
          responseChecksum,
          responseBody,
        ] as never[],
      );
    });

    return response;
  }

  async listTraces(
    query: Omit<TraceQuery, 'from' | 'to'> & { from: Date; to: Date },
  ): Promise<TracePage> {
    if (!this.database)
      return {
        items: [],
        prevCursor: null,
        nextCursor: null,
        options: { services: [], resourceKinds: [], resourceNames: [] },
        storageStatus: 'blind_spot',
      };

    const params: unknown[] = [query.from, query.to];
    const conditions = ['started_at >= $1', 'started_at < $2'];
    const add = (column: string, value: string | undefined) => {
      if (!value) return;
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };
    add('service_name', query.service);
    add('resource_kind', query.resourceKind);
    add('resource_name', query.resourceName);
    add('status', query.status);
    add('correlation_id', query.correlationId);
    add('request_id', query.requestId);
    add('run_id', query.runId);

    const optionRows = (await this.readQuery(
      `SELECT ` +
        `COALESCE(array_agg(DISTINCT service_name ORDER BY service_name) FILTER (WHERE service_name IS NOT NULL), ARRAY[]::text[]) AS services, ` +
        `COALESCE(array_agg(DISTINCT resource_kind ORDER BY resource_kind) FILTER (WHERE resource_kind IS NOT NULL), ARRAY[]::text[]) AS resource_kinds, ` +
        `COALESCE(array_agg(DISTINCT resource_name ORDER BY resource_name) FILTER (WHERE resource_name IS NOT NULL), ARRAY[]::text[]) AS resource_names ` +
        `FROM "telemetry"."spans" WHERE ${conditions.join(' AND ')}`,
      params,
    )) as Array<Record<string, unknown>>;

    const optionRow = optionRows[0];
    const options = {
      services: stringArray(optionRow?.services),
      resourceKinds: stringArray(optionRow?.resource_kinds),
      resourceNames: stringArray(optionRow?.resource_names),
    };

    let direction: Cursor['direction'] = 'next';
    if (query.cursor) {
      const decoded = decodeTraceCursor(query.cursor);
      direction = decoded.direction;
      params.push(decoded.startedAt, decoded.traceId);
      conditions.push(
        direction === 'prev'
          ? `(started_at, trace_id) > ($${params.length - 1}, $${params.length})`
          : `(started_at, trace_id) < ($${params.length - 1}, $${params.length})`,
      );
    }

    const order =
      direction === 'prev'
        ? 'ORDER BY min(started_at) ASC, trace_id ASC'
        : 'ORDER BY min(started_at) DESC, trace_id DESC';
    const rows = (await this.readQuery(
      `SELECT trace_id, min(started_at)::text AS started_at, ` +
        `max(finished_at)::text AS finished_at, ` +
        `max(duration_ns) FILTER (WHERE parent_span_id IS NULL) AS duration_ns, ` +
        `(array_agg(service_name ORDER BY started_at, span_id))[1] AS service_name, ` +
        `(array_agg(resource_name ORDER BY started_at, span_id))[1] AS resource_name, ` +
        `CASE WHEN bool_or(status = 'error') THEN 'error' ` +
        `WHEN bool_or(status = 'unset') THEN 'unset' ELSE 'ok' END AS status, ` +
        `count(*)::int AS span_count, ` +
        `(array_agg(sampling_reason ORDER BY started_at, span_id))[1] AS sampling_reason, ` +
        `bool_or(parent_span_id IS NULL) AS has_root, ` +
        `max(correlation_id) AS correlation_id, max(request_id) AS request_id, ` +
        `(array_agg(run_id ORDER BY started_at DESC NULLS LAST))[1]::text AS run_id ` +
        `FROM "telemetry"."spans" WHERE ${conditions.join(' AND ')} ` +
        `GROUP BY trace_id ${order} ` +
        `LIMIT $${params.length + 1}`,
      [...params, TRACE_PAGE_SIZE + 1],
    )) as Array<Record<string, unknown>>;
    if (query.cursor && rows.length === 0) {
      throw new ValidationError('The trace cursor has expired');
    }

    const hasMore = rows.length > TRACE_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, TRACE_PAGE_SIZE) : rows;
    const page = direction === 'prev' ? pageRows.reverse() : pageRows;
    const first = page[0];
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        traceId: String(row.trace_id).trim(),
        serviceName: String(row.service_name),
        resourceName: String(row.resource_name),
        status: String(row.status) as TraceSummary['status'],
        startedAt: timestamp(row.started_at),
        finishedAt: timestamp(row.finished_at),
        durationMs: Number(row.duration_ns ?? 0) / 1_000_000,
        spanCount: Number(row.span_count ?? 0),
        samplingReason: String(row.sampling_reason),
        complete: Boolean(row.has_root),
        correlationId: textOrNull(row.correlation_id),
        requestId: textOrNull(row.request_id),
        runId: textOrNull(row.run_id),
      })),
      prevCursor:
        first &&
        ((direction === 'prev' && hasMore) ||
          (direction === 'next' && Boolean(query.cursor)))
          ? encodeCursor(
              {
                startedAt: String(first.started_at),
                traceId: String(first.trace_id).trim(),
              },
              'prev',
            )
          : null,
      nextCursor:
        last && (direction === 'prev' || hasMore)
          ? encodeCursor(
              {
                startedAt: String(last.started_at),
                traceId: String(last.trace_id).trim(),
              },
              'next',
            )
          : null,
      options,
      storageStatus: 'available',
    };
  }

  async getTrace(traceId: string): Promise<TraceDetailResult | null> {
    if (!this.database) return null;
    const rows = (await this.readQuery(
      `SELECT trace_id, span_id, parent_span_id, service_name, ` +
        `service_instance_id, resource_kind, resource_name, operation, status, ` +
        `sampling_reason, attributes, error_type, started_at::text AS started_at, ` +
        `finished_at::text AS finished_at, duration_ns ` +
        `FROM "telemetry"."spans" WHERE trace_id = $1 ` +
        `ORDER BY started_at ASC, span_id ASC`,
      [traceId],
    )) as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;

    const ids = new Set(rows.map((row) => String(row.span_id).trim()));
    const spans: TraceSpan[] = rows.map((row) => {
      const parentSpanId = textOrNull(row.parent_span_id)?.trim() ?? null;
      return {
        traceId: String(row.trace_id).trim(),
        spanId: String(row.span_id).trim(),
        parentSpanId,
        serviceName: String(row.service_name),
        serviceInstanceId: String(row.service_instance_id),
        resourceKind: String(row.resource_kind),
        resourceName: String(row.resource_name),
        operation: String(row.operation),
        status: String(row.status) as TraceSpan['status'],
        samplingReason: String(row.sampling_reason),
        attributes: parseJson(row.attributes),
        errorType: textOrNull(row.error_type),
        startedAt: timestamp(row.started_at),
        finishedAt: timestamp(row.finished_at),
        durationMs: Number(row.duration_ns ?? 0) / 1_000_000,
        orphan: parentSpanId !== null && !ids.has(parentSpanId),
      };
    });
    const orphanRoots = spans
      .filter((span) => span.orphan)
      .map((span) => span.spanId);
    const samplingReasons = [
      ...new Set(spans.map((span) => span.samplingReason)),
    ];
    return {
      traceId,
      spans,
      orphanRoots,
      completeness: spans.some((span) => span.parentSpanId === null)
        ? 'complete'
        : 'partial',
      samplingReasons,
      storageStatus: 'available',
    };
  }

  async listMetrics(
    query: Omit<MetricQuery, 'from' | 'to' | 'statistic'> & {
      from: Date;
      to: Date;
      statistic: 'count' | 'sum' | 'min' | 'max';
      stepSeconds: number;
    },
  ): Promise<MetricsResult> {
    if (!this.database) {
      return {
        data: [],
        statistic: query.statistic,
        stepSeconds: query.stepSeconds,
        coverage: {
          expectedBuckets: 0,
          storedBuckets: 0,
          missingBuckets: 0,
          storageStatus: 'blind_spot',
        },
        options: { metrics: [], services: [], resourceKinds: [] },
      };
    }

    const params: unknown[] = [query.from, query.to, query.stepSeconds];
    const conditions = [
      'bucket_start >= $1',
      'bucket_start < $2',
      'bucket_width_seconds = $3',
    ];
    const add = (column: string, value: string | undefined) => {
      if (!value) return;
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };
    add('metric_name', query.metric);
    add('service_name', query.service);
    add('resource_kind', query.resourceKind);
    add('resource_name', query.resourceName);
    const optionRows = (await this.readQuery(
      `SELECT ` +
        `COALESCE(array_agg(DISTINCT metric_name ORDER BY metric_name) FILTER (WHERE metric_name IS NOT NULL), ARRAY[]::text[]) AS metrics, ` +
        `COALESCE(array_agg(DISTINCT service_name ORDER BY service_name) FILTER (WHERE service_name IS NOT NULL), ARRAY[]::text[]) AS services, ` +
        `COALESCE(array_agg(DISTINCT resource_kind ORDER BY resource_kind) FILTER (WHERE resource_kind IS NOT NULL), ARRAY[]::text[]) AS resource_kinds ` +
        `FROM "telemetry"."metric_buckets" WHERE ${conditions.join(' AND ')}`,
      params,
    )) as Array<Record<string, unknown>>;
    const optionRow = optionRows[0];
    const options = {
      metrics: stringArray(optionRow?.metrics),
      services: stringArray(optionRow?.services),
      resourceKinds: stringArray(optionRow?.resource_kinds),
    };
    const groups = query.groups ?? [];
    const hasGroup = (group: MetricGroup) => groups.includes(group);
    const statusGroup = `(COALESCE(labels->>'status', 'unknown'))`;
    const structuralGroups = [
      ...(hasGroup('service') ? ['service_name'] : []),
      ...(hasGroup('resourceKind') ? ['resource_kind'] : []),
      ...(hasGroup('resourceName') ? ['resource_name'] : []),
    ];
    const seriesDimensions = [
      'metric_name',
      ...structuralGroups,
      ...(hasGroup('status') ? [statusGroup] : []),
    ];
    const estimateRows = (await this.readQuery(
      `SELECT COUNT(*)::int AS series_count FROM (` +
        `SELECT DISTINCT ${seriesDimensions.join(', ')} ` +
        `FROM "telemetry"."metric_buckets" WHERE ${conditions.join(' AND ')}` +
        `) AS metric_series`,
      params,
    )) as Array<Record<string, unknown>>;
    const estimatedSeries = Number(estimateRows[0]?.series_count ?? 0);
    if (estimatedSeries > this.maxSeries) {
      throw new ValidationError(
        `Metric query exceeds the ${this.maxSeries} series limit`,
      );
    }
    const valueExpression = {
      count: 'sum(count)',
      sum: 'sum(sum)',
      min: 'min(min)',
      max: 'max(max)',
    }[query.statistic];
    const serviceExpression = hasGroup('service') ? 'service_name' : `'*'`;
    const resourceKindExpression = hasGroup('resourceKind')
      ? 'resource_kind'
      : `'*'`;
    const resourceNameExpression = hasGroup('resourceName')
      ? 'resource_name'
      : `'*'`;
    const labelsExpression = hasGroup('status')
      ? `jsonb_build_object('status', ${statusGroup})`
      : `(array_agg(labels ORDER BY series_fingerprint))[1]`;
    const rows = (await this.readQuery(
      `SELECT bucket_start::text AS bucket_start, ${valueExpression} AS value, ` +
        `sum(count)::bigint AS count, ${serviceExpression} AS service_name, ` +
        `${resourceKindExpression} AS resource_kind, ${resourceNameExpression} AS resource_name, ` +
        `metric_name, max(unit) AS unit, ${labelsExpression} AS labels ` +
        `FROM "telemetry"."metric_buckets" WHERE ${conditions.join(' AND ')} ` +
        `GROUP BY bucket_start, ${seriesDimensions.join(', ')} ` +
        `ORDER BY bucket_start ASC, service_name, resource_name`,
      params,
    )) as Array<Record<string, unknown>>;
    const expectedBuckets = Math.ceil(
      (query.to.getTime() - query.from.getTime()) / (query.stepSeconds * 1000),
    );
    const storedBuckets = new Set(rows.map((row) => String(row.bucket_start)))
      .size;
    return {
      data: rows.map((row) => ({
        bucketStart: timestamp(row.bucket_start),
        value: Number(row.value ?? 0),
        count: Number(row.count ?? 0),
        serviceName: String(row.service_name),
        resourceKind: String(row.resource_kind),
        resourceName: String(row.resource_name),
        metricName: String(row.metric_name),
        unit: String(row.unit),
        labels: parseJson(row.labels),
      })),
      statistic: query.statistic,
      stepSeconds: query.stepSeconds,
      coverage: {
        expectedBuckets,
        storedBuckets,
        missingBuckets: Math.max(0, expectedBuckets - storedBuckets),
        storageStatus: 'available',
      },
      options,
    };
  }

  private async readQuery<T>(text: string, params: unknown[]): Promise<T> {
    if (!this.database) return [] as T;
    const begin = (this.database as unknown as { begin?: unknown }).begin;
    if (typeof begin !== 'function') {
      return this.database.unsafe(text, params as never[]) as Promise<T>;
    }
    return withTransaction(this.database, async (transaction) => {
      await transaction.unsafe(
        `SELECT set_config('statement_timeout', $1, true)`,
        [String(this.queryTimeoutMs)] as never[],
      );
      return transaction.unsafe(text, params as never[]) as Promise<T>;
    });
  }

  async listBenchmarkRuns(
    query: BenchmarkRunQuery,
  ): Promise<BenchmarkRunsResult> {
    if (!this.database)
      return {
        data: [],
        prevCursor: null,
        nextCursor: null,
        options: { scenarioIds: [], statuses: [], bunVersions: [] },
        storageStatus: 'blind_spot',
      };
    const params: unknown[] = [];
    const conditions: string[] = [];
    const add = (column: string, value: string | undefined) => {
      if (!value) return;
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    };
    add('scenario_id', query.scenarioId);
    add('status', query.status);
    add('source_commit_sha', query.sourceCommitSha);
    add('bun_version', query.bunVersion);
    const optionRows = (await this.readQuery(
      `SELECT ` +
        `COALESCE(array_agg(DISTINCT scenario_id ORDER BY scenario_id) FILTER (WHERE scenario_id IS NOT NULL), ARRAY[]::text[]) AS scenario_ids, ` +
        `COALESCE(array_agg(DISTINCT status ORDER BY status) FILTER (WHERE status IS NOT NULL), ARRAY[]::text[]) AS statuses, ` +
        `COALESCE(array_agg(DISTINCT bun_version ORDER BY bun_version) FILTER (WHERE bun_version IS NOT NULL), ARRAY[]::text[]) AS bun_versions ` +
        `FROM "telemetry"."benchmark_runs" ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params,
    )) as Array<Record<string, unknown>>;
    const optionRow = optionRows[0];
    const options = {
      scenarioIds: stringArray(optionRow?.scenario_ids),
      statuses: stringArray(optionRow?.statuses),
      bunVersions: stringArray(optionRow?.bun_versions),
    };
    let direction: BenchmarkCursor['direction'] = 'next';
    if (query.cursor) {
      const decoded = decodeBenchmarkCursor(query.cursor);
      direction = decoded.direction;
      params.push(decoded.createdAt, decoded.runId);
      conditions.push(
        direction === 'prev'
          ? `(created_at, run_id) > ($${params.length - 1}, $${params.length})`
          : `(created_at, run_id) < ($${params.length - 1}, $${params.length})`,
      );
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order =
      direction === 'prev'
        ? 'ORDER BY created_at ASC, run_id ASC'
        : 'ORDER BY created_at DESC, run_id DESC';
    const rows = (await this.readQuery(
      `SELECT run_id, scenario_id, scenario_version, status, source_commit_sha, ` +
        `fixture_version, environment, bun_version, completeness, started_at::text AS started_at, ` +
        `finished_at::text AS finished_at, created_at::text AS created_at, ` +
        `(SELECT CASE WHEN bool_or(decision = 'fail') THEN 'fail' ` +
        `WHEN bool_or(decision = 'not_comparable') THEN 'not_comparable' ELSE 'pass' END ` +
        `FROM "telemetry"."benchmark_comparisons" c WHERE c.run_id = r.run_id) AS comparison_status ` +
        `FROM "telemetry"."benchmark_runs" r ${where} ` +
        `${order} LIMIT $${params.length + 1}`,
      [...params, BENCHMARK_PAGE_SIZE + 1],
    )) as Array<Record<string, unknown>>;
    if (query.cursor && rows.length === 0) {
      throw new ValidationError('The benchmark cursor has expired');
    }
    const hasMore = rows.length > BENCHMARK_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, BENCHMARK_PAGE_SIZE) : rows;
    const page = direction === 'prev' ? pageRows.reverse() : pageRows;
    const first = page[0];
    const last = page.at(-1);
    return {
      data: page.map((row) => this.mapBenchmarkRun(row)),
      prevCursor:
        first &&
        ((direction === 'prev' && hasMore) ||
          (direction === 'next' && Boolean(query.cursor)))
          ? cursor(String(first.created_at), String(first.run_id), 'prev')
          : null,
      nextCursor:
        last && (direction === 'prev' || hasMore)
          ? cursor(String(last.created_at), String(last.run_id), 'next')
          : null,
      options,
      storageStatus: 'available',
    };
  }

  async getBenchmarkRun(runId: string): Promise<BenchmarkRunDetail | null> {
    if (!this.database) return null;
    const rows = (await this.readQuery(
      `SELECT run_id, scenario_id, scenario_version, status, source_commit_sha, source_branch, ` +
        `source_checksum, fixture_version, environment, runner_profile, instrumentation_schema_version, ` +
        `threshold_policy_version, bun_version, artifact_uri, trace_uri, artifact_checksum, completeness, ` +
        `started_at::text AS started_at, finished_at::text AS finished_at, created_at::text AS created_at ` +
        `FROM "telemetry"."benchmark_runs" WHERE run_id = $1`,
      [runId],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    const comparisons = (await this.readQuery(
      `SELECT comparison_id, resource_kind, resource_name, metric_key, statistic, unit, ` +
        `baseline_value, candidate_value, absolute_delta, relative_delta_percent, ` +
        `absolute_threshold, relative_threshold, decision, evidence_uri ` +
        `FROM "telemetry"."benchmark_comparisons" WHERE run_id = $1 ` +
        `ORDER BY created_at ASC, comparison_id ASC`,
      [runId],
    )) as Array<Record<string, unknown>>;
    return {
      ...this.mapBenchmarkRun(row),
      sourceBranch: textOrNull(row.source_branch),
      sourceChecksum: String(row.source_checksum),
      runnerProfile: parseJson(row.runner_profile),
      instrumentationSchemaVersion: String(row.instrumentation_schema_version),
      thresholdPolicyVersion: String(row.threshold_policy_version),
      artifactUri: textOrNull(row.artifact_uri),
      traceUri: textOrNull(row.trace_uri),
      artifactChecksum: textOrNull(row.artifact_checksum),
      comparisons: comparisons.map((comparison) =>
        this.mapComparison(comparison),
      ),
    };
  }

  async listBenchmarkBaselines(
    query: BenchmarkBaselineQuery,
  ): Promise<BenchmarkBaselinesResult> {
    if (!this.database) {
      return {
        data: [],
        prevCursor: null,
        nextCursor: null,
        options: {
          scenarioIds: [],
          environments: [],
          fixtureVersions: [],
        },
        storageStatus: 'blind_spot',
      };
    }
    const params: unknown[] = [];
    const conditions: string[] = [];
    for (const [column, value] of [
      ['scenario_id', query.scenarioId],
      ['scenario_version', query.scenarioVersion],
      ['fixture_version', query.fixtureVersion],
      ['environment', query.environment],
    ] as const) {
      if (!value) continue;
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
    const optionRows = (await this.readQuery(
      `SELECT ` +
        `COALESCE(array_agg(DISTINCT scenario_id ORDER BY scenario_id) FILTER (WHERE scenario_id IS NOT NULL), ARRAY[]::text[]) AS scenario_ids, ` +
        `COALESCE(array_agg(DISTINCT environment ORDER BY environment) FILTER (WHERE environment IS NOT NULL), ARRAY[]::text[]) AS environments, ` +
        `COALESCE(array_agg(DISTINCT fixture_version ORDER BY fixture_version) FILTER (WHERE fixture_version IS NOT NULL), ARRAY[]::text[]) AS fixture_versions ` +
        `FROM "telemetry"."benchmark_baselines" ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params,
    )) as Array<Record<string, unknown>>;
    const optionRow = optionRows[0];
    const options = {
      scenarioIds: stringArray(optionRow?.scenario_ids),
      environments: stringArray(optionRow?.environments),
      fixtureVersions: stringArray(optionRow?.fixture_versions),
    };
    let direction: BaselineCursor['direction'] = 'next';
    if (query.cursor) {
      const decoded = decodeBaselineCursor(query.cursor);
      direction = decoded.direction;
      params.push(decoded.promotedAt, decoded.baselineId);
      const promotedAtParam = `$${params.length - 1}`;
      const baselineIdParam = `$${params.length}`;
      conditions.push(
        direction === 'prev'
          ? `(promoted_at > ${promotedAtParam} OR (promoted_at = ${promotedAtParam} AND baseline_id < ${baselineIdParam}))`
          : `(promoted_at < ${promotedAtParam} OR (promoted_at = ${promotedAtParam} AND baseline_id > ${baselineIdParam}))`,
      );
    }
    const order =
      direction === 'prev'
        ? 'ORDER BY promoted_at ASC, baseline_id DESC'
        : 'ORDER BY promoted_at DESC, baseline_id ASC';
    const rows = (await this.readQuery(
      `SELECT baseline_id, scenario_id, scenario_version, approved_run_id, fixture_version, ` +
        `environment, instrumentation_schema_version, threshold_policy_version, approval_commit_sha, ` +
        `active, promoted_at::text AS promoted_at FROM "telemetry"."benchmark_baselines" ` +
        `${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ${order} ` +
        `LIMIT $${params.length + 1}`,
      [...params, BENCHMARK_PAGE_SIZE + 1],
    )) as Array<Record<string, unknown>>;
    if (query.cursor && rows.length === 0) {
      throw new ValidationError('The benchmark baseline cursor has expired');
    }
    const hasMore = rows.length > BENCHMARK_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, BENCHMARK_PAGE_SIZE) : rows;
    const page = direction === 'prev' ? pageRows.reverse() : pageRows;
    const first = page[0];
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        baselineId: String(row.baseline_id),
        scenarioId: String(row.scenario_id),
        scenarioVersion: String(row.scenario_version),
        approvedRunId: String(row.approved_run_id),
        fixtureVersion: String(row.fixture_version),
        environment: String(row.environment),
        instrumentationSchemaVersion: String(
          row.instrumentation_schema_version,
        ),
        thresholdPolicyVersion: String(row.threshold_policy_version),
        approvalCommitSha: String(row.approval_commit_sha),
        active: Boolean(row.active),
        promotedAt: timestamp(row.promoted_at),
      })),
      prevCursor:
        first &&
        ((direction === 'prev' && hasMore) ||
          (direction === 'next' && Boolean(query.cursor)))
          ? encodeBaselineCursor(
              {
                promotedAt: String(first.promoted_at),
                baselineId: String(first.baseline_id),
              },
              'prev',
            )
          : null,
      nextCursor:
        last && (direction === 'prev' || hasMore)
          ? encodeBaselineCursor(
              {
                promotedAt: String(last.promoted_at),
                baselineId: String(last.baseline_id),
              },
              'next',
            )
          : null,
      options,
      storageStatus: 'available',
    };
  }

  async listAlerts(query: {
    status?: string;
    severity?: 'warning' | 'critical';
    service?: string;
    ruleId?: string;
    seriesFingerprint?: string;
    cursor?: string;
  }): Promise<AlertsResult> {
    if (!this.database)
      return {
        data: [],
        prevCursor: null,
        nextCursor: null,
        options: { ruleIds: [], services: [] },
        storageStatus: 'blind_spot',
      };
    const params: unknown[] = [];
    const conditions: string[] = [];
    for (const [column, value] of [
      ['state.status', query.status],
      ['rules.severity', query.severity],
      ['state.service_name', query.service],
      ['state.rule_id', query.ruleId],
      ['state.series_fingerprint', query.seriesFingerprint],
    ] as const) {
      if (!value) continue;
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
    const optionRows = (await this.readQuery(
      `SELECT ` +
        `COALESCE(array_agg(DISTINCT state.rule_id ORDER BY state.rule_id) FILTER (WHERE state.rule_id IS NOT NULL), ARRAY[]::text[]) AS rule_ids, ` +
        `COALESCE(array_agg(DISTINCT state.service_name ORDER BY state.service_name) FILTER (WHERE state.service_name IS NOT NULL), ARRAY[]::text[]) AS services ` +
        `FROM "telemetry"."alert_states" AS state ` +
        `LEFT JOIN "telemetry"."alert_rules" AS rules ON rules.rule_id = state.rule_id AND rules.rule_version = state.rule_version ` +
        `${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params,
    )) as Array<Record<string, unknown>>;
    const optionRow = optionRows[0];
    const options = {
      ruleIds: stringArray(optionRow?.rule_ids),
      services: stringArray(optionRow?.services),
    };
    let direction: AlertCursor['direction'] = 'next';
    if (query.cursor) {
      const decoded = decodeAlertCursor(query.cursor);
      direction = decoded.direction;
      params.push(
        decoded.evaluatedAt,
        decoded.ruleId,
        decoded.seriesFingerprint,
      );
      const evaluatedAtParam = `$${params.length - 2}`;
      const ruleIdParam = `$${params.length - 1}`;
      const seriesFingerprintParam = `$${params.length}`;
      conditions.push(
        direction === 'prev'
          ? `(` +
              `state.last_evaluated_at > ${evaluatedAtParam} ` +
              `OR (state.last_evaluated_at = ${evaluatedAtParam} ` +
              `AND state.rule_id < ${ruleIdParam}) ` +
              `OR (state.last_evaluated_at = ${evaluatedAtParam} ` +
              `AND state.rule_id = ${ruleIdParam} ` +
              `AND state.series_fingerprint < ${seriesFingerprintParam})` +
              `)`
          : `(` +
              `state.last_evaluated_at < ${evaluatedAtParam} ` +
              `OR (state.last_evaluated_at = ${evaluatedAtParam} ` +
              `AND state.rule_id > ${ruleIdParam}) ` +
              `OR (state.last_evaluated_at = ${evaluatedAtParam} ` +
              `AND state.rule_id = ${ruleIdParam} ` +
              `AND state.series_fingerprint > ${seriesFingerprintParam})` +
              `)`,
      );
    }
    const order =
      direction === 'prev'
        ? 'ORDER BY state.last_evaluated_at ASC, state.rule_id DESC, state.series_fingerprint DESC'
        : 'ORDER BY state.last_evaluated_at DESC, state.rule_id ASC, state.series_fingerprint ASC';
    const rows = (await this.readQuery(
      `SELECT state.rule_id, state.rule_version, state.series_fingerprint, ` +
        `state.service_name, state.resource_kind, state.resource_name, state.status, ` +
        `state.consecutive_breach_windows, state.consecutive_healthy_windows, ` +
        `rules.title, rules.severity, rules.metric, rules.threshold, rules.window_seconds, rules.manifest_checksum, ` +
        `state.transition_sequence, state.first_breached_at::text AS first_breached_at, ` +
        `state.last_evaluated_at::text AS last_evaluated_at, state.evidence_bucket::text AS evidence_bucket, ` +
        `state.last_notified_at::text AS last_notified_at, state.resolved_at::text AS resolved_at ` +
        `FROM "telemetry"."alert_states" AS state ` +
        `LEFT JOIN "telemetry"."alert_rules" AS rules ON rules.rule_id = state.rule_id AND rules.rule_version = state.rule_version ` +
        `${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ` +
        `${order} ` +
        `LIMIT $${params.length + 1}`,
      [...params, 51],
    )) as Array<Record<string, unknown>>;
    if (query.cursor && rows.length === 0) {
      throw new ValidationError('The alert cursor has expired');
    }
    const hasMore = rows.length > 50;
    const pageRows = hasMore ? rows.slice(0, 50) : rows;
    const page = direction === 'prev' ? pageRows.reverse() : pageRows;
    const first = page[0];
    const last = page.at(-1);
    return {
      data: page.map((row) => this.mapAlert(row)),
      prevCursor:
        first &&
        ((direction === 'prev' && hasMore) ||
          (direction === 'next' && Boolean(query.cursor)))
          ? encodeAlertCursor(
              {
                evaluatedAt: String(first.last_evaluated_at),
                ruleId: String(first.rule_id),
                seriesFingerprint: String(first.series_fingerprint).trim(),
              },
              'prev',
            )
          : null,
      nextCursor:
        last && (direction === 'prev' || hasMore)
          ? encodeAlertCursor(
              {
                evaluatedAt: String(last.last_evaluated_at),
                ruleId: String(last.rule_id),
                seriesFingerprint: String(last.series_fingerprint).trim(),
              },
              'next',
            )
          : null,
      options,
      storageStatus: 'available',
    };
  }

  async listAlertsForRule(
    ruleId: string,
    seriesFingerprint?: string,
  ): Promise<AlertsResult> {
    return this.listAlerts({ ruleId, seriesFingerprint });
  }

  private mapBenchmarkRun(row: Record<string, unknown>): BenchmarkRunSummary {
    return {
      runId: String(row.run_id),
      scenarioId: String(row.scenario_id),
      scenarioVersion: String(row.scenario_version),
      status: String(row.status),
      sourceCommitSha: String(row.source_commit_sha),
      fixtureVersion: String(row.fixture_version),
      environment: String(row.environment),
      bunVersion: String(row.bun_version),
      completeness: String(row.completeness),
      startedAt: timestamp(row.started_at),
      finishedAt: textOrNull(row.finished_at)
        ? timestamp(row.finished_at)
        : null,
      createdAt: timestamp(row.created_at),
      comparisonStatus: textOrNull(row.comparison_status),
    };
  }

  private mapComparison(row: Record<string, unknown>): BenchmarkComparison {
    return {
      comparisonId: String(row.comparison_id),
      resourceKind: String(row.resource_kind),
      resourceName: String(row.resource_name),
      metricKey: String(row.metric_key),
      statistic: String(row.statistic),
      unit: String(row.unit),
      baselineValue:
        row.baseline_value === null ? null : Number(row.baseline_value),
      candidateValue: Number(row.candidate_value),
      absoluteDelta:
        row.absolute_delta === null ? null : Number(row.absolute_delta),
      relativeDeltaPercent:
        row.relative_delta_percent === null
          ? null
          : Number(row.relative_delta_percent),
      absoluteThreshold:
        row.absolute_threshold === null ? null : Number(row.absolute_threshold),
      relativeThreshold:
        row.relative_threshold === null ? null : Number(row.relative_threshold),
      decision: String(row.decision) as BenchmarkComparison['decision'],
      evidenceUri: textOrNull(row.evidence_uri),
    };
  }

  private mapAlert(row: Record<string, unknown>): AlertStateSummary {
    return {
      ruleId: String(row.rule_id),
      ruleVersion: String(row.rule_version),
      seriesFingerprint: String(row.series_fingerprint),
      serviceName: String(row.service_name ?? 'runtime'),
      resourceKind: String(row.resource_kind ?? 'business.operation'),
      resourceName: String(row.resource_name ?? 'runtime'),
      status: String(row.status) as AlertStateSummary['status'],
      consecutiveBreachWindows: Number(row.consecutive_breach_windows),
      consecutiveHealthyWindows: Number(row.consecutive_healthy_windows ?? 0),
      transitionSequence: Number(row.transition_sequence),
      firstBreachedAt: textOrNull(row.first_breached_at)
        ? timestamp(row.first_breached_at)
        : null,
      lastEvaluatedAt: timestamp(row.last_evaluated_at),
      evidenceBucket: textOrNull(row.evidence_bucket)
        ? timestamp(row.evidence_bucket)
        : null,
      lastNotifiedAt: textOrNull(row.last_notified_at)
        ? timestamp(row.last_notified_at)
        : null,
      resolvedAt: textOrNull(row.resolved_at)
        ? timestamp(row.resolved_at)
        : null,
      title: textOrNull(row.title) ?? undefined,
      severity: textOrNull(row.severity) as AlertStateSummary['severity'],
      metric: textOrNull(row.metric) ?? undefined,
      threshold:
        row.threshold === null || row.threshold === undefined
          ? undefined
          : Number(row.threshold),
      windowSeconds:
        row.window_seconds === null || row.window_seconds === undefined
          ? undefined
          : Number(row.window_seconds),
      ruleChecksum: textOrNull(row.manifest_checksum) ?? undefined,
    };
  }
}

export { METRIC_STEPS };
