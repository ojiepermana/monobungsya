import { describe, expect, it } from 'vitest';
import type { RuntimeMetricsResponse } from '../../services/api.service';
import {
  isExpiredCursorError,
  isoFromLocalDateTime,
  loadErrorMessage,
  localDateTimeValue,
  metricChart,
  validateDayWindow,
  waterfallDepths,
} from './observability.utils';

const metrics: RuntimeMetricsResponse = {
  data: [
    {
      bucketStart: '2026-08-25T00:00:00.000Z',
      value: 4,
      count: 1,
      serviceName: 'gateway',
      resourceKind: 'http.server',
      resourceName: 'request',
      metricName: 'telemetry.operation.count',
      unit: 'count',
      labels: {},
    },
    {
      bucketStart: '2026-08-25T00:02:00.000Z',
      value: 8,
      count: 1,
      serviceName: 'gateway',
      resourceKind: 'http.server',
      resourceName: 'request',
      metricName: 'telemetry.operation.count',
      unit: 'count',
      labels: {},
    },
  ],
  statistic: 'sum',
  stepSeconds: 60,
  coverage: {
    expectedBuckets: 3,
    storedBuckets: 2,
    missingBuckets: 1,
    storageStatus: 'available',
  },
  options: {
    metrics: ['telemetry.operation.count'],
    services: ['gateway'],
    resourceKinds: ['http.server'],
  },
};

describe('observability utilities', () => {
  it('rejects time ranges beyond the 24 hour signal window', () => {
    expect(
      validateDayWindow({
        from: '2026-08-25T00:00:00.000Z',
        to: '2026-08-26T00:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      validateDayWindow({
        from: '2026-08-25T00:00:00.000Z',
        to: '2026-08-26T00:00:00.001Z',
      }),
    ).toContain('24 hours');
    expect(
      validateDayWindow({ from: 'not-a-date', to: '2026-08-26T00:00:00.000Z' }),
    ).toContain('valid');
  });

  it('marks missing metric buckets as gaps instead of inventing a stored point', () => {
    const chart = metricChart(
      metrics,
      { from: '2026-08-25T00:00:00.000Z', to: '2026-08-25T00:03:00.000Z' },
      '',
    );

    expect(chart.data).toHaveLength(3);
    expect(chart.gaps).toEqual([
      { start: 1, end: 2, left: expect.any(Number), width: expect.any(Number) },
    ]);
    const missingPoint = chart.data[1] as { aggregate?: number } | undefined;
    expect(missingPoint?.aggregate).toBeUndefined();
  });

  it('aligns the chart grid to storage buckets when the window starts mid-minute', () => {
    const chart = metricChart(
      metrics,
      {
        from: '2026-08-25T00:00:37.000Z',
        to: '2026-08-25T00:03:37.000Z',
      },
      '',
    );

    expect(chart.data.map((row) => row.bucketStart)).toEqual([
      '2026-08-25T00:00:00.000Z',
      '2026-08-25T00:01:00.000Z',
      '2026-08-25T00:02:00.000Z',
      '2026-08-25T00:03:00.000Z',
    ]);
    expect(chart.data[0]).toMatchObject({ aggregate: 4 });
    expect(chart.data[2]).toMatchObject({ aggregate: 8 });
  });

  it('keeps different metrics in the same bucket as separate series', () => {
    const firstMetric = metrics.data.at(0);
    if (!firstMetric) throw new Error('The metric fixture is empty');
    const chart = metricChart(
      {
        ...metrics,
        data: [
          firstMetric,
          {
            ...firstMetric,
            metricName: 'telemetry.errors.total',
            value: 2,
          },
        ],
      },
      { from: '2026-08-25T00:00:00.000Z', to: '2026-08-25T00:01:00.000Z' },
      '',
    );

    expect(chart.seriesKeys).toEqual([
      'telemetry.operation.count',
      'telemetry.errors.total',
    ]);
    expect(chart.data[0]).toMatchObject({
      'telemetry.operation.count': 4,
      'telemetry.errors.total': 2,
    });
  });

  it('does not throw when a shared URL contains an invalid local date', () => {
    expect(localDateTimeValue('not-a-date')).toBe('');
    expect(isoFromLocalDateTime('not-a-date')).toBe('not-a-date');
  });

  it('keeps orphan and cyclic spans at waterfall depth zero', () => {
    const depths = waterfallDepths([
      { spanId: 'root', parentSpanId: null, orphan: false },
      { spanId: 'child', parentSpanId: 'root', orphan: false },
      { spanId: 'orphan', parentSpanId: 'missing', orphan: true },
      { spanId: 'cycle-a', parentSpanId: 'cycle-b', orphan: false },
      { spanId: 'cycle-b', parentSpanId: 'cycle-a', orphan: false },
    ]);

    expect(depths.get('root')).toBe(0);
    expect(depths.get('child')).toBe(1);
    expect(depths.get('orphan')).toBe(0);
    expect(depths.get('cycle-a')).toBe(0);
    expect(depths.get('cycle-b')).toBe(1);
  });

  it('explains authorization, expired cursors, and session errors distinctly', () => {
    expect(
      loadErrorMessage('observability:trace:read', { status: 403 }),
    ).toContain('observability:trace:read');
    expect(
      loadErrorMessage('observability:trace:read', { status: 401 }),
    ).toContain('Sign in again');
    expect(
      loadErrorMessage('observability:metric:read', { status: 422 }),
    ).toContain('filters are invalid');
    expect(isExpiredCursorError({ status: 422 })).toBe(true);
    expect(isExpiredCursorError({ status: 403 })).toBe(false);
  });
});
