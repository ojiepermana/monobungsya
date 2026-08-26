import type {
  RuntimeMetricGroup,
  RuntimeMetricsResponse,
} from '../../services/api.service';

export const OBSERVABILITY_DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const METRIC_GROUPS: Array<{
  value: RuntimeMetricGroup | '';
  label: string;
}> = [
  { value: '', label: 'Aggregate' },
  { value: 'service', label: 'Service' },
  { value: 'resourceKind', label: 'Resource kind' },
  { value: 'resourceName', label: 'Resource name' },
  { value: 'status', label: 'Status' },
];

export const METRIC_STATISTICS = [
  { value: 'sum' as const, label: 'Sum' },
  { value: 'count' as const, label: 'Count' },
  { value: 'min' as const, label: 'Minimum' },
  { value: 'max' as const, label: 'Maximum' },
];

export const TRACE_STATUSES = [
  { value: 'ok' as const, label: 'OK' },
  { value: 'error' as const, label: 'Error' },
  { value: 'unset' as const, label: 'Unset' },
];

export const ALERT_STATUSES = [
  { value: 'pending' as const, label: 'Pending' },
  { value: 'firing' as const, label: 'Firing' },
  { value: 'resolved' as const, label: 'Resolved' },
  { value: 'unknown' as const, label: 'Unknown' },
];

export const ALERT_SEVERITIES = [
  { value: 'warning' as const, label: 'Warning' },
  { value: 'critical' as const, label: 'Critical' },
];

export const WINDOW_PRESETS = [
  { value: '15m', label: '15 minutes', milliseconds: 15 * 60 * 1000 },
  { value: '1h', label: '1 hour', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: '6 hours', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24 hours', milliseconds: 24 * 60 * 60 * 1000 },
] as const;

export type MetricStatistic = (typeof METRIC_STATISTICS)[number]['value'];

export interface TimeWindow {
  from: string;
  to: string;
}

export interface MetricChartRow {
  bucketStart: string;
  [series: string]: string | number;
}

export interface MetricGapSegment {
  start: number;
  end: number;
  left: number;
  width: number;
}

export function defaultTimeWindow(now = new Date()): TimeWindow {
  return {
    from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}

export function formatDate(value: string): string {
  return OBSERVABILITY_DATE_FORMAT.format(new Date(value));
}

export function formatCount(value: number | string | null | undefined): string {
  return new Intl.NumberFormat('id-ID').format(Number(value ?? 0));
}

export function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

export function localDateTimeValue(value: string): string {
  return new Date(value).toISOString().slice(0, 16);
}

export function isoFromLocalDateTime(value: string): string {
  return new Date(value).toISOString();
}

export function validateDayWindow(window: TimeWindow): string | null {
  const from = new Date(window.from).getTime();
  const to = new Date(window.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return 'Choose a valid time range.';
  }
  if (to - from > 24 * 60 * 60 * 1000) {
    return 'The time range cannot be longer than 24 hours.';
  }
  return null;
}

export function trim(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

export function loadErrorMessage(permission: string, error: unknown): string {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  if (status === 403) {
    return `You need ${permission} to view this signal.`;
  }
  if (status === 401) {
    return 'Your session is no longer authorized. Sign in again.';
  }
  return 'This signal could not be loaded. Check telemetry query health.';
}

export function isExpiredCursorError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    Number((error as { status?: unknown }).status) === 422
  );
}

export function metricGroupValue(
  point: RuntimeMetricsResponse['data'][number],
  group: RuntimeMetricGroup | '',
): string {
  if (group === 'service') return point.serviceName;
  if (group === 'resourceKind') return point.resourceKind;
  if (group === 'resourceName') return point.resourceName;
  if (group === 'status') {
    const labels = point.labels;
    if (labels && typeof labels === 'object' && 'status' in labels) {
      return String((labels as { status?: unknown }).status ?? 'unknown');
    }
    return 'unknown';
  }
  return 'aggregate';
}

export function metricChart(
  response: RuntimeMetricsResponse,
  window: TimeWindow,
  group: RuntimeMetricGroup | '',
): { data: MetricChartRow[]; seriesKeys: string[]; gaps: MetricGapSegment[] } {
  const stepMs = Number(response.stepSeconds) * 1000;
  const from = new Date(window.from).getTime();
  const to = new Date(window.to).getTime();
  const expectedCount = Math.max(0, Math.ceil((to - from) / stepMs));
  const bucketTimes = Array.from(
    { length: expectedCount },
    (_, index) => from + index * stepMs,
  );
  const values = new Map<string, Map<number, number>>();
  for (const point of response.data) {
    const key = metricGroupValue(point, group);
    const bucket = new Date(point.bucketStart).getTime();
    const series = values.get(key) ?? new Map<number, number>();
    series.set(bucket, Number(point.value));
    values.set(key, series);
  }

  const seriesKeys = [...values.keys()];
  if (seriesKeys.length === 0 && response.data.length > 0) {
    seriesKeys.push('aggregate');
  }
  const data = bucketTimes.map((bucket) => {
    const row: MetricChartRow = {
      bucketStart: new Date(bucket).toISOString(),
    };
    for (const key of seriesKeys) {
      const value = values.get(key)?.get(bucket);
      if (value !== undefined) row[key] = value;
    }
    return row;
  });

  const missingIndexes = bucketTimes.flatMap((bucket, index) => {
    const hasValue = [...values.values()].some((series) => series.has(bucket));
    return hasValue ? [] : [index];
  });
  const gaps: MetricGapSegment[] = [];
  for (const index of missingIndexes) {
    const previous = gaps.at(-1);
    if (previous && previous.end === index) {
      previous.end = index + 1;
      previous.width = ((previous.end - previous.start) / expectedCount) * 100;
    } else {
      gaps.push({
        start: index,
        end: index + 1,
        left: (index / Math.max(expectedCount, 1)) * 100,
        width: (1 / Math.max(expectedCount, 1)) * 100,
      });
    }
  }
  return { data, seriesKeys, gaps };
}

export function waterfallDepths(
  spans: ReadonlyArray<{
    spanId: string;
    parentSpanId: string | null;
    orphan: boolean;
  }>,
): Map<string, number> {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const depths = new Map<string, number>();
  const visit = (spanId: string, stack = new Set<string>()): number => {
    if (depths.has(spanId)) return depths.get(spanId) ?? 0;
    const span = byId.get(spanId);
    if (!span || span.orphan || !span.parentSpanId || stack.has(spanId)) {
      depths.set(spanId, 0);
      return 0;
    }
    stack.add(spanId);
    const parentDepth = visit(span.parentSpanId, stack);
    stack.delete(spanId);
    const depth = depths.has(spanId)
      ? (depths.get(spanId) ?? 0)
      : parentDepth + 1;
    depths.set(spanId, depth);
    return depth;
  };
  for (const span of spans) visit(span.spanId);
  return depths;
}
