import { ValidationError } from '#project/errors';
import { isoFromDbTimestamp } from '#project/logger';
import type {
  ClickHouseSignalReadDeadline,
  ClickHouseSignalReader,
} from '#project/observability';
import type { TracePage } from './observability.repository';
import {
  decodeTraceCursor,
  encodeTraceCursor,
  traceCursorFingerprint,
  traceCursorTimestamp,
} from './observability.trace-cursor';
import type {
  MetricGroup,
  MetricQuery,
  MetricsResult,
  TraceDetailResult,
  TraceQuery,
  TraceSpan,
  TraceSummary,
} from './observability.types';

const DAY_MS = 24 * 60 * 60 * 1_000;
const TRACE_RETENTION_MS = 7 * DAY_MS;
const TRACE_PAGE_SIZE = 50;
const RAW_BUCKET_WIDTH_SECONDS = 60;
const OPTION_LIMIT = 200;

type ClickHouseScalar = string | number | boolean;
type ClickHouseParameters = Record<string, ClickHouseScalar>;
type ReadRange = { from: Date; to: Date };

interface TraceFilters {
  source: string;
  params: ClickHouseParameters;
}

interface MetricFilters {
  source: string;
  params: ClickHouseParameters;
}

function timestamp(value: unknown): string {
  const text = String(value);
  if (text.includes('T')) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return isoFromDbTimestamp(text);
}

function parameterTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function latestSpans(conditions: readonly string[]): string {
  return (
    `SELECT * FROM observability.spans WHERE ${conditions.join(' AND ')} ` +
    'ORDER BY trace_id ASC, span_id ASC, write_version DESC ' +
    'LIMIT 1 BY trace_id, span_id'
  );
}

function latestMetricBuckets(conditions: readonly string[]): string {
  return (
    `SELECT * FROM observability.metric_buckets WHERE ${conditions.join(' AND ')} ` +
    'ORDER BY bucket_start ASC, series_fingerprint ASC, flush_sequence DESC ' +
    'LIMIT 1 BY bucket_start, series_fingerprint'
  );
}

function statusDimension(): string {
  return `coalesce(nullIf(JSONExtractString(labels, 'status'), ''), 'unknown')`;
}

function traceFilters(
  query: Omit<TraceQuery, 'from' | 'to'> & ReadRange,
): TraceFilters {
  const params: ClickHouseParameters = {
    from: parameterTimestamp(query.from),
    to: parameterTimestamp(query.to),
  };
  const conditions = [
    "started_at >= {from:DateTime64(6, 'UTC')}",
    "started_at < {to:DateTime64(6, 'UTC')}",
  ];
  const add = (
    column: string,
    parameter: string,
    value: string | undefined,
    type = 'String',
  ) => {
    if (!value) return;
    params[parameter] = value;
    conditions.push(`${column} = {${parameter}:${type}}`);
  };

  add('service_name', 'service', query.service);
  add('resource_kind', 'resourceKind', query.resourceKind);
  add('resource_name', 'resourceName', query.resourceName);
  add('status', 'status', query.status);
  add('correlation_id', 'correlationId', query.correlationId);
  add('request_id', 'requestId', query.requestId);
  add('run_id', 'runId', query.runId, 'UUID');

  return { source: latestSpans(conditions), params };
}

function metricFilters(
  query: Omit<MetricQuery, 'from' | 'to' | 'statistic'> &
    ReadRange & {
      statistic: 'count' | 'sum' | 'min' | 'max';
      stepSeconds: number;
    },
): MetricFilters {
  const params: ClickHouseParameters = {
    from: parameterTimestamp(query.from),
    to: parameterTimestamp(query.to),
    bucketWidthSeconds: RAW_BUCKET_WIDTH_SECONDS,
  };
  const conditions = [
    "bucket_start >= {from:DateTime64(6, 'UTC')}",
    "bucket_start < {to:DateTime64(6, 'UTC')}",
    'bucket_width_seconds = {bucketWidthSeconds:UInt32}',
  ];
  const add = (
    column: string,
    parameter: string,
    value: string | undefined,
  ) => {
    if (!value) return;
    params[parameter] = value;
    conditions.push(`${column} = {${parameter}:String}`);
  };

  add('metric_name', 'metric', query.metric);
  add('service_name', 'service', query.service);
  add('resource_kind', 'resourceKind', query.resourceKind);
  add('resource_name', 'resourceName', query.resourceName);

  return { source: latestMetricBuckets(conditions), params };
}

/**
 * The logs module owns its ClickHouse read shape. It never accepts an
 * identifier, predicate, grouping expression, or sort expression as SQL.
 */
export class ClickHouseObservabilitySignalReader {
  constructor(
    private readonly reader: ClickHouseSignalReader,
    private readonly maxSeries: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listTraces(
    query: Omit<TraceQuery, 'from' | 'to'> & ReadRange,
  ): Promise<TracePage> {
    const deadline = this.reader.createDeadline({
      start: query.from,
      end: query.to,
    });
    const filterFingerprint = traceCursorFingerprint(query);
    const filters = traceFilters(query);
    const optionRows = await this.queryRows<{
      services: unknown;
      resource_kinds: unknown;
      resource_names: unknown;
    }>(
      `SELECT arraySort(groupUniqArray(${OPTION_LIMIT})(service_name)) AS services, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(resource_kind)) AS resource_kinds, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(resource_name)) AS resource_names ` +
        `FROM (${filters.source})`,
      query,
      filters.params,
      deadline,
    );
    const optionRow = optionRows[0];
    const options = {
      services: stringArray(optionRow?.services),
      resourceKinds: stringArray(optionRow?.resource_kinds),
      resourceNames: stringArray(optionRow?.resource_names),
    };

    const params: ClickHouseParameters = {
      ...filters.params,
      limit: TRACE_PAGE_SIZE + 1,
    };
    let direction: 'next' | 'prev' = 'next';
    let having = '';
    if (query.cursor) {
      const decoded = decodeTraceCursor(query.cursor, filterFingerprint);
      direction = decoded.direction;
      params.cursorStartedAt = traceCursorTimestamp(decoded.startedAt);
      params.cursorTraceId = decoded.traceId;
      having =
        direction === 'prev'
          ? "HAVING (min(started_at), trace_id) > ({cursorStartedAt:DateTime64(6, 'UTC')}, {cursorTraceId:String})"
          : "HAVING (min(started_at), trace_id) < ({cursorStartedAt:DateTime64(6, 'UTC')}, {cursorTraceId:String})";
    }

    const order =
      direction === 'prev'
        ? 'ORDER BY trace_started_at ASC, trace_id ASC'
        : 'ORDER BY trace_started_at DESC, trace_id DESC';
    const rows = await this.queryRows<{
      trace_id: string;
      trace_started_at: string;
      trace_finished_at: string;
      duration_ns: string | number;
      service_name: string;
      resource_name: string;
      status: TraceSummary['status'];
      span_count: string | number;
      sampling_reason: string;
      has_root: boolean | number;
      correlation_id: string | null;
      request_id: string | null;
      run_id: string | null;
    }>(
      `SELECT trace_id, toString(min(started_at)) AS trace_started_at, ` +
        `toString(max(finished_at)) AS trace_finished_at, ` +
        `maxIf(duration_ns, isNull(parent_span_id)) AS duration_ns, ` +
        `argMin(service_name, tuple(started_at, span_id)) AS service_name, ` +
        `argMin(resource_name, tuple(started_at, span_id)) AS resource_name, ` +
        `if(countIf(status = 'error') > 0, 'error', if(countIf(status = 'unset') > 0, 'unset', 'ok')) AS status, ` +
        `count() AS span_count, ` +
        `argMin(sampling_reason, tuple(started_at, span_id)) AS sampling_reason, ` +
        `countIf(isNull(parent_span_id)) > 0 AS has_root, ` +
        `max(correlation_id) AS correlation_id, max(request_id) AS request_id, ` +
        `argMax(run_id, tuple(started_at, span_id)) AS run_id ` +
        `FROM (${filters.source}) GROUP BY trace_id ${having} ${order} ` +
        'LIMIT {limit:UInt32}',
      query,
      params,
      deadline,
    );
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
        traceId: row.trace_id.trim(),
        serviceName: row.service_name,
        resourceName: row.resource_name,
        status: row.status,
        startedAt: timestamp(row.trace_started_at),
        finishedAt: timestamp(row.trace_finished_at),
        durationMs: Number(row.duration_ns ?? 0) / 1_000_000,
        spanCount: Number(row.span_count ?? 0),
        samplingReason: row.sampling_reason,
        complete: Boolean(row.has_root),
        correlationId: textOrNull(row.correlation_id),
        requestId: textOrNull(row.request_id),
        runId: textOrNull(row.run_id),
      })),
      prevCursor:
        first &&
        ((direction === 'prev' && hasMore) ||
          (direction === 'next' && Boolean(query.cursor)))
          ? encodeTraceCursor(
              {
                startedAt: timestamp(first.trace_started_at),
                traceId: first.trace_id.trim(),
              },
              'prev',
              filterFingerprint,
            )
          : null,
      nextCursor:
        last && (direction === 'prev' || hasMore)
          ? encodeTraceCursor(
              {
                startedAt: timestamp(last.trace_started_at),
                traceId: last.trace_id.trim(),
              },
              'next',
              filterFingerprint,
            )
          : null,
      options,
      storageStatus: 'available',
    };
  }

  async getTrace(traceId: string): Promise<TraceDetailResult | null> {
    const to = this.now();
    const from = new Date(to.getTime() - TRACE_RETENTION_MS);
    const rows = await this.queryRows<{
      trace_id: string;
      span_id: string;
      parent_span_id: string | null;
      service_name: string;
      service_instance_id: string;
      resource_kind: string;
      resource_name: string;
      operation: string;
      status: TraceSpan['status'];
      sampling_reason: string;
      attributes: unknown;
      error_type: string | null;
      started_at: string;
      finished_at: string;
      duration_ns: string | number;
    }>(
      'SELECT trace_id, span_id, parent_span_id, service_name, ' +
        'service_instance_id, resource_kind, resource_name, operation, status, ' +
        'sampling_reason, attributes, error_type, toString(started_at) AS started_at, ' +
        'toString(finished_at) AS finished_at, duration_ns ' +
        'FROM (SELECT * FROM observability.spans ' +
        'WHERE trace_id = {traceId:String} ' +
        "AND started_at >= {from:DateTime64(6, 'UTC')} " +
        "AND started_at < {to:DateTime64(6, 'UTC')} " +
        'ORDER BY trace_id ASC, span_id ASC, write_version DESC ' +
        'LIMIT 1 BY trace_id, span_id) ' +
        'ORDER BY started_at ASC, span_id ASC',
      { from, to },
      {
        traceId,
        from: parameterTimestamp(from),
        to: parameterTimestamp(to),
      },
    );
    if (rows.length === 0) return null;

    const ids = new Set(rows.map((row) => row.span_id.trim()));
    const spans: TraceSpan[] = rows.map((row) => {
      const parentSpanId = textOrNull(row.parent_span_id)?.trim() ?? null;
      return {
        traceId: row.trace_id.trim(),
        spanId: row.span_id.trim(),
        parentSpanId,
        serviceName: row.service_name,
        serviceInstanceId: row.service_instance_id,
        resourceKind: row.resource_kind,
        resourceName: row.resource_name,
        operation: row.operation,
        status: row.status,
        samplingReason: row.sampling_reason,
        attributes: parseJson(row.attributes),
        errorType: textOrNull(row.error_type),
        startedAt: timestamp(row.started_at),
        finishedAt: timestamp(row.finished_at),
        durationMs: Number(row.duration_ns ?? 0) / 1_000_000,
        orphan: parentSpanId !== null && !ids.has(parentSpanId),
      };
    });
    return {
      traceId,
      spans,
      orphanRoots: spans
        .filter((span) => span.orphan)
        .map((span) => span.spanId),
      completeness: spans.some((span) => span.parentSpanId === null)
        ? 'complete'
        : 'partial',
      samplingReasons: [...new Set(spans.map((span) => span.samplingReason))],
      storageStatus: 'available',
    };
  }

  async listMetrics(
    query: Omit<MetricQuery, 'from' | 'to' | 'statistic'> &
      ReadRange & {
        statistic: 'count' | 'sum' | 'min' | 'max';
        stepSeconds: number;
      },
  ): Promise<MetricsResult> {
    const deadline = this.reader.createDeadline({
      start: query.from,
      end: query.to,
    });
    const filters = metricFilters(query);
    const optionRows = await this.queryRows<{
      metrics: unknown;
      services: unknown;
      resource_kinds: unknown;
    }>(
      `SELECT arraySort(groupUniqArray(${OPTION_LIMIT})(metric_name)) AS metrics, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(service_name)) AS services, ` +
        `arraySort(groupUniqArray(${OPTION_LIMIT})(resource_kind)) AS resource_kinds ` +
        `FROM (${filters.source})`,
      query,
      filters.params,
      deadline,
    );
    const optionRow = optionRows[0];
    const options = {
      metrics: stringArray(optionRow?.metrics),
      services: stringArray(optionRow?.services),
      resourceKinds: stringArray(optionRow?.resource_kinds),
    };

    const groups = query.groups ?? [];
    const hasGroup = (group: MetricGroup) => groups.includes(group);
    const status = statusDimension();
    const seriesDimensions = [
      'metric_name',
      ...(hasGroup('service') ? ['service_name'] : []),
      ...(hasGroup('resourceKind') ? ['resource_kind'] : []),
      ...(hasGroup('resourceName') ? ['resource_name'] : []),
      ...(hasGroup('status') ? [status] : []),
    ];
    const estimateRows = await this.queryRows<Record<string, unknown>>(
      `SELECT DISTINCT ${seriesDimensions.join(', ')} FROM (${filters.source}) ` +
        'LIMIT {estimateLimit:UInt32}',
      query,
      { ...filters.params, estimateLimit: this.maxSeries + 1 },
      deadline,
    );
    if (estimateRows.length > this.maxSeries) {
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
    const bucket =
      'toStartOfInterval(bucket_start, toIntervalSecond({stepSeconds:UInt32}))';
    const serviceName = hasGroup('service') ? 'service_name' : `'*'`;
    const resourceKind = hasGroup('resourceKind') ? 'resource_kind' : `'*'`;
    const resourceName = hasGroup('resourceName') ? 'resource_name' : `'*'`;
    const labels = hasGroup('status')
      ? `toJSONString(map('status', any(${status})))`
      : 'argMin(labels, series_fingerprint)';
    const rows = await this.queryRows<{
      aligned_bucket_start: string;
      value: string | number;
      count: string | number;
      service_name: string;
      resource_kind: string;
      resource_name: string;
      metric_name: string;
      unit: string;
      result_labels: unknown;
    }>(
      `SELECT toString(${bucket}) AS aligned_bucket_start, ${valueExpression} AS value, ` +
        `sum(count) AS count, ${serviceName} AS service_name, ` +
        `${resourceKind} AS resource_kind, ${resourceName} AS resource_name, ` +
        `metric_name, max(unit) AS unit, ${labels} AS result_labels ` +
        `FROM (${filters.source}) GROUP BY ${bucket}, ${seriesDimensions.join(', ')} ` +
        'ORDER BY aligned_bucket_start ASC, service_name ASC, resource_name ASC',
      query,
      { ...filters.params, stepSeconds: query.stepSeconds },
      deadline,
    );
    const alignedFrom =
      Math.floor(query.from.getTime() / (query.stepSeconds * 1_000)) *
      (query.stepSeconds * 1_000);
    const expectedBuckets = Math.ceil(
      (query.to.getTime() - alignedFrom) / (query.stepSeconds * 1_000),
    );
    const storedBuckets = new Set(
      rows.map((row) => String(row.aligned_bucket_start)),
    ).size;
    return {
      data: rows.map((row) => ({
        bucketStart: timestamp(row.aligned_bucket_start),
        value: Number(row.value ?? 0),
        count: Number(row.count ?? 0),
        serviceName: row.service_name,
        resourceKind: row.resource_kind,
        resourceName: row.resource_name,
        metricName: row.metric_name,
        unit: row.unit,
        labels: parseJson(row.result_labels),
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

  private queryRows<Row extends object>(
    query: string,
    range: ReadRange,
    params: ClickHouseParameters,
    deadline?: ClickHouseSignalReadDeadline,
  ): Promise<Row[]> {
    return this.reader.queryRows(query, {
      range: { start: range.from, end: range.to },
      params,
      deadline,
    });
  }
}
