import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GatewayRequestError } from '../../../api/generated-client';
import {
  ApiService,
  type BenchmarkRunSummary,
  type RuntimeAlertsResponse,
  type RuntimeMetricsResponse,
  type RuntimeTraceSummary,
} from '../../services/api.service';
import { ObservabilityPage } from './observability.page';

const trace: RuntimeTraceSummary = {
  traceId: 'a'.repeat(32),
  serviceName: 'gateway',
  resourceName: 'http.server',
  status: 'ok',
  startedAt: '2026-08-25T00:00:00.000Z',
  finishedAt: '2026-08-25T00:00:00.010Z',
  durationMs: 10,
  spanCount: 2,
  samplingReason: 'deterministic',
  complete: false,
  correlationId: 'correlation-1',
  requestId: 'request-1',
  runId: null,
};

const metrics: RuntimeMetricsResponse = {
  data: [
    {
      bucketStart: '2026-08-25T00:00:00.000Z',
      value: 42,
      count: 2,
      serviceName: 'gateway',
      resourceKind: 'business.operation',
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
};

const benchmark: BenchmarkRunSummary = {
  runId: '0198f8a0-0000-7000-8000-000000000001',
  scenarioId: 'runtime-telemetry-core',
  scenarioVersion: '1',
  status: 'completed',
  sourceCommitSha: 'commit-1',
  fixtureVersion: '1',
  environment: 'staging',
  bunVersion: '1.4.0',
  completeness: 'complete',
  startedAt: '2026-08-25T00:00:00.000Z',
  finishedAt: '2026-08-25T00:00:01.000Z',
  createdAt: '2026-08-25T00:00:01.000Z',
  comparisonStatus: 'not_comparable',
};

const alerts: RuntimeAlertsResponse = {
  data: [
    {
      ruleId: 'telemetry.latency.p95',
      ruleVersion: '0014.1',
      seriesFingerprint: 'b'.repeat(64),
      serviceName: 'gateway',
      resourceKind: 'http.server',
      resourceName: 'request',
      status: 'firing',
      consecutiveBreachWindows: 3,
      transitionSequence: 1,
      firstBreachedAt: '2026-08-25T00:00:00.000Z',
      lastEvaluatedAt: '2026-08-25T00:15:00.000Z',
      evidenceBucket: '2026-08-25T00:15:00.000Z',
      lastNotifiedAt: '2026-08-25T00:15:00.000Z',
      resolvedAt: null,
    },
  ],
  nextCursor: null,
  storageStatus: 'available',
};

const emptyMetrics: RuntimeMetricsResponse = {
  ...metrics,
  data: [],
  coverage: {
    expectedBuckets: 3,
    storedBuckets: 0,
    missingBuckets: 3,
    storageStatus: 'blind_spot',
  },
};

function createPage(options: { error?: unknown; empty?: boolean } = {}) {
  const errorSource = () =>
    throwError(() => options.error ?? new Error('query unavailable'));
  const empty = options.empty === true;
  const api = {
    runtimeTraces: vi.fn().mockReturnValue(
      options.error
        ? errorSource()
        : of({
            data: empty ? [] : [trace],
            nextCursor: null,
            completeness: 'partial' as const,
            storageStatus: 'available' as const,
          }),
    ),
    runtimeMetrics: vi
      .fn()
      .mockReturnValue(
        options.error ? errorSource() : of(empty ? emptyMetrics : metrics),
      ),
    benchmarkRuns: vi.fn().mockReturnValue(
      options.error
        ? errorSource()
        : of({
            data: empty ? [] : [benchmark],
            nextCursor: null,
            storageStatus: 'available' as const,
          }),
    ),
    runtimeAlerts: vi.fn().mockReturnValue(
      options.error
        ? errorSource()
        : of({
            ...(empty ? { data: [] } : alerts),
            nextCursor: null,
            storageStatus: 'available' as const,
          }),
    ),
    runtimeTrace: vi
      .fn()
      .mockReturnValue(throwError(() => new Error('expired trace'))),
    benchmarkRun: vi
      .fn()
      .mockReturnValue(throwError(() => new Error('stale projection'))),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: LayoutService,
        useValue: { appearance: () => 'flat', type: () => 'vertical' },
      },
      { provide: ApiService, useValue: api },
    ],
  });

  const fixture = TestBed.createComponent(ObservabilityPage);
  fixture.detectChanges();
  return {
    fixture,
    api,
    page: fixture.componentInstance as unknown as {
      view: {
        set(value: 'traces' | 'metrics' | 'benchmarks' | 'alerts'): void;
      };
      openTrace(value: RuntimeTraceSummary): void;
      openBenchmark(value: BenchmarkRunSummary): void;
    },
  };
}

describe('ObservabilityPage', () => {
  it('renders healthy, incomplete, gap, not comparable, and firing evidence', () => {
    const { fixture, page } = createPage();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('gateway');
    expect(root.textContent).toContain('incomplete');

    page.view.set('metrics');
    fixture.detectChanges();
    expect(root.textContent).toContain('Coverage gap');
    expect(root.textContent).toContain('1');

    page.view.set('benchmarks');
    fixture.detectChanges();
    expect(root.textContent).toContain('not_comparable');

    page.view.set('alerts');
    fixture.detectChanges();
    expect(root.textContent).toContain('firing');
  });

  it('renders empty and telemetry blind spot states instead of zero evidence', () => {
    const { fixture, page } = createPage({ empty: true });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Telemetry storage is unavailable');
    expect(root.textContent).toContain('No sampled traces');

    page.view.set('metrics');
    fixture.detectChanges();
    expect(root.textContent).toContain('No metric buckets are available');
    expect(root.textContent).toContain('3');
  });

  it('distinguishes unauthorized, forbidden, and query failures', () => {
    const unauthorized = createPage({
      error: new GatewayRequestError(401, {}),
    });
    expect(
      (unauthorized.fixture.nativeElement as HTMLElement).textContent,
    ).toContain('session is not authorized');

    const forbidden = createPage({ error: new GatewayRequestError(403, {}) });
    expect(
      (forbidden.fixture.nativeElement as HTMLElement).textContent,
    ).toContain('observability permission');

    const queryError = createPage({ error: new Error('database down') });
    expect(
      (queryError.fixture.nativeElement as HTMLElement).textContent,
    ).toContain('telemetry query health');
  });

  it('renders expired trace and stale benchmark projection errors', () => {
    const { fixture, page, api } = createPage();
    const root = fixture.nativeElement as HTMLElement;

    page.openTrace(trace);
    fixture.detectChanges();
    expect(api.runtimeTrace).toHaveBeenCalledWith(trace.traceId);
    expect(root.textContent).toContain('expired or is no longer available');

    page.view.set('benchmarks');
    fixture.detectChanges();
    page.openBenchmark(benchmark);
    fixture.detectChanges();
    expect(api.benchmarkRun).toHaveBeenCalledWith(benchmark.runId);
    expect(root.textContent).toContain('projection is stale');
  });
});
