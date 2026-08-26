import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import {
  PageComponent,
  PageContentComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { catchError, forkJoin, type Observable, of } from 'rxjs';
import { AuthService } from '../../../auth/auth.service';
import { PERMISSIONS } from '../../../auth/permissions';
import {
  ApiService,
  type BenchmarkRunsResponse,
  type RuntimeAlertsResponse,
  type RuntimeMetricsResponse,
  type RuntimeTracesResponse,
} from '../../../services/api.service';
import {
  defaultTimeWindow,
  formatCount,
  loadErrorMessage,
} from '../observability.utils';

type SignalKey = 'trace' | 'metric' | 'benchmark' | 'alert';

type OverviewSources = {
  trace?: Observable<RuntimeTracesResponse>;
  metric?: Observable<RuntimeMetricsResponse>;
  benchmark?: Observable<BenchmarkRunsResponse>;
  alert?: Observable<RuntimeAlertsResponse>;
};

type OverviewResponses = {
  trace?: RuntimeTracesResponse;
  metric?: RuntimeMetricsResponse;
  benchmark?: BenchmarkRunsResponse;
  alert?: RuntimeAlertsResponse;
};

const SIGNALS: ReadonlyArray<{
  key: SignalKey;
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
  title: string;
  description: string;
  route: string;
  icon: string;
}> = [
  {
    key: 'trace',
    permission: PERMISSIONS.observabilityTraceRead,
    title: 'Traces',
    description: 'Sampled request trees and their runtime context.',
    route: '/observability/traces',
    icon: 'account_tree',
  },
  {
    key: 'metric',
    permission: PERMISSIONS.observabilityMetricRead,
    title: 'Metrics',
    description: 'Time-bucketed measurements with explicit coverage gaps.',
    route: '/observability/metrics',
    icon: 'insights',
  },
  {
    key: 'benchmark',
    permission: PERMISSIONS.observabilityBenchmarkRead,
    title: 'Benchmarks',
    description: 'Benchmark runs, comparisons, and promoted baselines.',
    route: '/observability/benchmarks',
    icon: 'speed',
  },
  {
    key: 'alert',
    permission: PERMISSIONS.observabilityAlertRead,
    title: 'Alerts',
    description: 'Rule state, breach windows, and notification evidence.',
    route: '/observability/alerts',
    icon: 'notification_important',
  },
];

@Component({
  selector: 'app-observability-overview-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    IconComponent,
    PageComponent,
    PageContentComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layoutAppearance" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Observability</p><h1 class="mt-1 text-lg font-semibold text-foreground">Signal overview</h1></div>
        <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button>
      </PageHeader>
      <PageContent class="grid min-h-0 content-start gap-6 overflow-auto px-3 py-6">
        <section class="max-w-3xl"><p class="text-sm text-muted-foreground">Each signal has its own permission boundary. This overview requests only the summaries for signals available to your session.</p>@if (error()) {<p class="mt-4 border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (storageWarning()) {<p class="mt-4 border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">One or more telemetry stores are unavailable. A blind spot is not an empty signal.</p>}</section>
        @if (loading()) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground" role="status">Loading signal summaries...</p>} @else {
          <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Observability signals">
            @for (signal of visibleSignals(); track signal.key) {
              <a class="group grid gap-5 rounded-base border border-border bg-card p-5 no-underline transition-colors hover:border-primary" [routerLink]="signal.route">
                <div class="flex items-start justify-between gap-3"><div class="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><Icon [name]="signal.icon" [size]="20" aria-hidden="true" /></div><Icon name="arrow_forward" [size]="16" class="text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" /></div>
                <div><h2 class="text-lg font-semibold text-foreground">{{ signal.title }}</h2><p class="mt-1 text-sm text-muted-foreground">{{ signal.description }}</p></div>
                <p class="font-mono text-2xl font-semibold text-foreground">{{ value(signal.key) }}</p>
                <p class="text-xs text-muted-foreground">{{ label(signal.key) }}</p>
              </a>
            } @empty {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No observability signals are enabled for this session.</p>}
          </section>
        }
        <p class="text-xs text-muted-foreground">Last loaded {{ updatedAt() ? formatDate(updatedAt()!) : 'never' }}. Counts represent the currently loaded summary window.</p>
      </PageContent>
    </Page>
  `,
})
export class ObservabilityOverviewPage {
  protected readonly layoutAppearance = 'flat' as const;
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly updatedAt = signal<string | null>(null);
  private readonly counts = signal<Record<SignalKey, number>>({
    trace: 0,
    metric: 0,
    benchmark: 0,
    alert: 0,
  });
  private readonly more = signal<Record<SignalKey, boolean>>({
    trace: false,
    metric: false,
    benchmark: false,
    alert: false,
  });
  protected readonly metricCoverage = signal({
    storedBuckets: 0,
    expectedBuckets: 0,
    missingBuckets: 0,
  });
  protected readonly latestBenchmarkStatus = signal('No runs recorded');
  protected readonly visibleSignals = computed(() =>
    SIGNALS.filter((item) => this.auth.hasPermission(item.permission)),
  );

  constructor() {
    this.load();
  }

  protected refresh(): void {
    this.load();
  }
  protected formatCount = formatCount;
  protected value(key: SignalKey): string {
    if (key === 'metric') {
      const coverage = this.metricCoverage();
      return `${formatCount(coverage.storedBuckets)} / ${formatCount(coverage.expectedBuckets)} / ${formatCount(coverage.missingBuckets)}`;
    }
    if (key === 'benchmark') return this.latestBenchmarkStatus();
    return `${formatCount(this.counts()[key])}${this.more()[key] ? '+' : ''}`;
  }
  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }
  protected label(key: SignalKey): string {
    return key === 'metric'
      ? 'stored / expected / missing buckets'
      : key === 'benchmark'
        ? 'latest run status'
        : key === 'alert'
          ? 'firing alert states'
          : 'error traces in the last 24 hours';
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.storageWarning.set(false);
    const sources: OverviewSources = {};
    const visible = this.visibleSignals();
    const window = defaultTimeWindow();
    for (const item of visible) {
      if (item.key === 'trace')
        sources.trace = this.api.runtimeTraces({
          from: window.from,
          to: window.to,
          status: 'error',
        });
      if (item.key === 'metric')
        sources.metric = this.api.runtimeMetrics({
          from: window.from,
          to: window.to,
        });
      if (item.key === 'benchmark')
        sources.benchmark = this.api.benchmarkRuns();
      if (item.key === 'alert')
        sources.alert = this.api.runtimeAlerts({ status: 'firing' });
    }
    if (visible.length === 0) {
      this.loading.set(false);
      return;
    }
    forkJoin(sources)
      .pipe(
        catchError((error: unknown) => {
          this.error.set(loadErrorMessage('observability signal', error));
          return of(null);
        }),
      )
      .subscribe((result) => {
        if (!result) {
          this.loading.set(false);
          return;
        }
        const loaded = result as OverviewResponses;
        const trace = loaded.trace;
        const metric = loaded.metric;
        const benchmark = loaded.benchmark;
        const alert = loaded.alert;
        const next = { ...this.counts() };
        const more = { ...this.more() };
        if (trace) {
          next.trace = trace.data.length;
          more.trace = Boolean(trace.nextCursor);
          this.storageWarning.set(
            this.storageWarning() || trace.storageStatus === 'blind_spot',
          );
        }
        if (metric) {
          next.metric = metric.data.length;
          this.metricCoverage.set({
            storedBuckets: Number(metric.coverage.storedBuckets),
            expectedBuckets: Number(metric.coverage.expectedBuckets),
            missingBuckets: Number(metric.coverage.missingBuckets),
          });
          this.storageWarning.set(
            this.storageWarning() ||
              metric.coverage.storageStatus === 'blind_spot',
          );
        }
        if (benchmark) {
          next.benchmark = benchmark.data.length;
          more.benchmark = Boolean(benchmark.nextCursor);
          this.latestBenchmarkStatus.set(
            benchmark.data[0]?.status ?? 'No runs recorded',
          );
          this.storageWarning.set(
            this.storageWarning() || benchmark.storageStatus === 'blind_spot',
          );
        }
        if (alert) {
          next.alert = alert.data.length;
          more.alert = Boolean(alert.nextCursor);
          this.storageWarning.set(
            this.storageWarning() || alert.storageStatus === 'blind_spot',
          );
        }
        this.counts.set(next);
        this.more.set(more);
        this.updatedAt.set(new Date().toISOString());
        this.loading.set(false);
      });
  }
}
