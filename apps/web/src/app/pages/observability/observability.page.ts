import { Component, computed, inject, signal } from '@angular/core';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { catchError, forkJoin, of } from 'rxjs';
import { GatewayRequestError } from '../../../api/generated-client';
import {
  type RuntimeAlertStatus as AlertStatus,
  ApiService,
  type BenchmarkRunDetail,
  type BenchmarkRunSummary,
  type RuntimeAlertsResponse,
  type RuntimeMetricGroup,
  type RuntimeMetricsResponse,
  type RuntimeTraceDetail,
  type RuntimeTraceSummary,
} from '../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type View = 'traces' | 'metrics' | 'benchmarks' | 'alerts';

@Component({
  selector: 'app-observability-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" [appsLauncher]="false" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="grid size-9 shrink-0 place-items-center rounded-base bg-primary/10 text-primary"><Icon name="monitor_heart" [size]="18" aria-hidden="true" /></div>
          <div class="min-w-0"><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Operator evidence</p><h1 class="truncate text-lg font-semibold text-foreground">Observability</h1></div>
        </div>
        <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button>
      </PageHeader>

      <PageContent class="grid min-h-0 content-start gap-6 overflow-auto px-3 py-6">
        <section class="grid gap-5 rounded-base border border-border bg-card p-5" aria-labelledby="observability-heading">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div><p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Runtime signal map</p><h2 id="observability-heading" class="mt-2 text-xl font-semibold text-foreground">Follow evidence from trace to decision</h2><p class="mt-1 max-w-2xl text-sm text-muted-foreground">Read sampled traces, canonical metric buckets, benchmark comparisons, and alert transitions from one permission guarded surface.</p></div>
            <div class="flex flex-wrap gap-2" role="tablist" aria-label="Observability views">
              @for (item of views; track item.value) { <button Button variant="ghost" size="xs" type="button" role="tab" [attr.aria-selected]="view() === item.value" [class.bg-accent]="view() === item.value" [class.text-accent-foreground]="view() === item.value" (click)="view.set(item.value)"><Icon [name]="item.icon" [size]="14" aria-hidden="true" />{{ item.label }}</button> }
            </div>
          </div>

          @if (error()) { <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p> }
          @if (storageWarning()) { <p class="border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">{{ storageWarning() }}</p> }
          @if (loading()) { <p class="border border-border bg-muted p-5 text-sm text-muted-foreground" role="status">Loading operator evidence...</p> }

          @if (!loading() && view() === 'traces') {
            <section class="grid gap-4" aria-labelledby="trace-title">
              <div class="flex flex-wrap items-end justify-between gap-3"><div><h3 id="trace-title" class="text-base font-semibold text-foreground">Trace search</h3><p class="text-sm text-muted-foreground">Sampled runtime trees retain their correlation link and incomplete marker.</p></div><div class="flex gap-2"><label class="sr-only" for="trace-service">Service</label><input Input id="trace-service" class="w-44" placeholder="Service" [value]="service()" (input)="service.set(inputValue($event))" /><button Button variant="outline" size="xs" type="button" (click)="refresh()">Apply</button></div></div>
              @if (traceDetail(); as detail) {
                <div class="grid gap-4 border border-border bg-muted p-4"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="text-xs uppercase tracking-[0.14em] text-muted-foreground">Trace detail</p><h4 class="mt-1 font-mono text-sm text-foreground">{{ detail.traceId }}</h4></div><button Button variant="outline" size="xs" type="button" (click)="traceDetail.set(null)"><Icon name="arrow_back" [size]="14" aria-hidden="true" />Back to traces</button></div><div class="grid gap-2"><div class="flex items-center justify-between text-xs text-muted-foreground"><span>{{ detail.spans.length }} spans · {{ detail.completeness }}</span><span>{{ detail.orphanRoots.length }} orphan roots</span></div>@for (span of detail.spans; track span.spanId) { <article class="grid gap-1 border-l-2 border-primary bg-card p-3 text-sm" [style.margin-left.px]="span.orphan ? 0 : 16"><div class="flex flex-wrap justify-between gap-2"><span class="font-medium text-foreground">{{ span.resourceName }}</span><span Badge [variant]="statusVariant(span.status)">{{ span.status }}</span></div><p class="text-xs text-muted-foreground">{{ span.serviceName }} · {{ span.operation }} · {{ span.durationMs.toFixed(2) }} ms · {{ span.samplingReason }}</p></article> }</div></div>
              } @else if (traces().length === 0) { <p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No sampled traces in this window. A quiet result is different from a zero metric.</p> } @else { <div class="overflow-auto rounded-base border border-border"><table class="min-w-full text-left text-sm"><caption class="sr-only">Sampled runtime traces</caption><thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th class="px-4 py-3">Start</th><th class="px-4 py-3">Service and root</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Duration</th><th class="px-4 py-3">Evidence</th></tr></thead><tbody>@for (trace of traces(); track trace.traceId) { <tr class="border-b border-border last:border-0"><td class="whitespace-nowrap px-4 py-3">{{ formatDate(trace.startedAt) }}</td><td class="px-4 py-3"><button class="text-left font-medium text-foreground underline-offset-4 hover:underline" type="button" (click)="openTrace(trace)">{{ trace.serviceName }} · {{ trace.resourceName }}</button><p class="font-mono text-xs text-muted-foreground">{{ trace.traceId }}</p></td><td class="px-4 py-3"><span Badge [variant]="statusVariant(trace.status)">{{ trace.status }}</span></td><td class="px-4 py-3">{{ trace.durationMs.toFixed(2) }} ms</td><td class="px-4 py-3 text-xs text-muted-foreground">{{ trace.spanCount }} spans · {{ trace.complete ? trace.samplingReason : 'incomplete' }}</td></tr> }</tbody></table></div> }
            </section>
          }

          @if (!loading() && view() === 'metrics') {
            <section class="grid gap-4" aria-labelledby="metric-title"><div class="flex flex-wrap items-end justify-between gap-3"><div><h3 id="metric-title" class="text-base font-semibold text-foreground">Metric explorer</h3><p class="text-sm text-muted-foreground">Canonical buckets expose missing coverage as a gap, never as a false zero.</p></div><div class="flex gap-2"><label class="sr-only" for="metric-group">Group</label><select NativeSelect id="metric-group" [value]="metricGroup()" (change)="setMetricGroup(inputValue($event))"><option NativeSelectOption value="">All resource dimensions</option><option NativeSelectOption value="service">Service</option><option NativeSelectOption value="resourceKind">Resource kind</option><option NativeSelectOption value="resourceName">Resource name</option><option NativeSelectOption value="status">Status</option></select><label class="sr-only" for="metric-statistic">Statistic</label><select NativeSelect id="metric-statistic" [value]="statistic()" (change)="setStatistic(inputValue($event))"><option NativeSelectOption value="sum">Sum</option><option NativeSelectOption value="count">Count</option><option NativeSelectOption value="min">Minimum</option><option NativeSelectOption value="max">Maximum</option></select></div></div><div class="grid gap-3 sm:grid-cols-3"><article class="border border-border bg-muted p-4"><p class="text-xs uppercase tracking-[0.14em] text-muted-foreground">Stored buckets</p><p class="mt-2 text-2xl font-semibold text-foreground">{{ metricCoverage().stored }}</p></article><article class="border border-border bg-muted p-4"><p class="text-xs uppercase tracking-[0.14em] text-muted-foreground">Expected buckets</p><p class="mt-2 text-2xl font-semibold text-foreground">{{ metricCoverage().expected }}</p></article><article class="border border-border bg-muted p-4"><p class="text-xs uppercase tracking-[0.14em] text-muted-foreground">Coverage gap</p><p class="mt-2 text-2xl font-semibold text-foreground">{{ metricCoverage().missing }}</p></article></div>@if (metrics().length === 0) { <p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No metric buckets are available for this window.</p> } @else { <div class="overflow-auto rounded-base border border-border"><table class="min-w-full text-left text-sm"><caption class="sr-only">Runtime metric buckets</caption><thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th class="px-4 py-3">Bucket</th><th class="px-4 py-3">Metric</th><th class="px-4 py-3">Resource</th><th class="px-4 py-3">Value</th></tr></thead><tbody>@for (point of metrics(); track point.bucketStart + point.metricName) { <tr class="border-b border-border last:border-0"><td class="whitespace-nowrap px-4 py-3">{{ formatDate(point.bucketStart) }}</td><td class="px-4 py-3 font-mono text-xs">{{ point.metricName }}</td><td class="px-4 py-3"><p>{{ point.serviceName }}</p><p class="text-xs text-muted-foreground">{{ point.resourceName }}</p></td><td class="px-4 py-3 font-mono">{{ point.value.toFixed(2) }} {{ point.unit }}</td></tr> }</tbody></table></div> }</section>
          }

          @if (!loading() && view() === 'benchmarks') {
            <section class="grid gap-4" aria-labelledby="benchmark-title"><div><h3 id="benchmark-title" class="text-base font-semibold text-foreground">Benchmark comparisons</h3><p class="text-sm text-muted-foreground">Compatibility includes scenario, fixture, environment, runner profile, and instrumentation schema. Bun and commit remain visible evidence.</p></div>@if (benchmarkDetail(); as detail) { <div class="grid gap-4 border border-border bg-muted p-4"><div class="flex items-center justify-between gap-3"><div><p class="font-mono text-sm">{{ detail.scenarioId }} · {{ detail.sourceCommitSha }}</p><p class="text-xs text-muted-foreground">{{ detail.bunVersion }} · {{ detail.completeness }}</p></div><button Button variant="outline" size="xs" type="button" (click)="benchmarkDetail.set(null)">Back</button></div><div class="grid gap-2">@for (comparison of detail.comparisons; track comparison.comparisonId) { <div class="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-3 text-sm"><span>{{ comparison.metricKey }} · {{ comparison.statistic }}</span><span class="flex items-center gap-2"><span class="font-mono">{{ comparison.relativeDeltaPercent ?? 'n/a' }}%</span><span Badge [variant]="decisionVariant(comparison.decision)">{{ comparison.decision }}</span></span></div> }</div></div> } @else if (benchmarks().length === 0) { <p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No benchmark runs have been ingested yet. This is a projection view, not a live runner.</p> } @else { <div class="overflow-auto rounded-base border border-border"><table class="min-w-full text-left text-sm"><caption class="sr-only">Benchmark runs</caption><thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th class="px-4 py-3">Run</th><th class="px-4 py-3">Build</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Comparison</th></tr></thead><tbody>@for (run of benchmarks(); track run.runId) { <tr class="border-b border-border last:border-0"><td class="px-4 py-3"><button class="text-left font-medium text-foreground underline-offset-4 hover:underline" type="button" (click)="openBenchmark(run)">{{ run.scenarioId }}</button><p class="font-mono text-xs text-muted-foreground">{{ run.runId }}</p></td><td class="px-4 py-3"><p>{{ run.bunVersion }}</p><p class="font-mono text-xs text-muted-foreground">{{ run.sourceCommitSha.slice(0, 12) }}</p></td><td class="px-4 py-3"><span Badge [variant]="decisionVariant(run.status)">{{ run.status }}</span></td><td class="px-4 py-3"><span Badge [variant]="decisionVariant(run.comparisonStatus ?? 'not_comparable')">{{ run.comparisonStatus ?? 'not comparable' }}</span></td></tr> }</tbody></table></div> }</section>
          }

          @if (!loading() && view() === 'alerts') {
            <section class="grid gap-4" aria-labelledby="alert-title"><div><h3 id="alert-title" class="text-base font-semibold text-foreground">Alert state</h3><p class="text-sm text-muted-foreground">Transitions require three breach windows or three healthy windows. Missing telemetry remains unknown.</p></div>@if (alerts().length === 0) { <p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No active or historical alert state is projected.</p> } @else { <div class="grid gap-3 md:grid-cols-2">@for (alert of alerts(); track alert.ruleId + alert.seriesFingerprint) { <article class="grid gap-3 border border-border bg-card p-4"><div class="flex items-start justify-between gap-3"><div><p class="font-mono text-sm text-foreground">{{ alert.ruleId }}</p><p class="mt-1 text-xs text-muted-foreground">{{ alert.serviceName }} · {{ alert.resourceName }}</p><p class="mt-1 font-mono text-xs text-muted-foreground">{{ alert.seriesFingerprint }}</p></div><span Badge [variant]="alertVariant(alert.status)">{{ alert.status }}</span></div><div class="grid grid-cols-2 gap-3 text-sm"><div><p class="text-xs text-muted-foreground">Breach windows</p><p class="mt-1 font-semibold">{{ alert.consecutiveBreachWindows }}</p></div><div><p class="text-xs text-muted-foreground">Transitions</p><p class="mt-1 font-semibold">{{ alert.transitionSequence }}</p></div></div><p class="text-xs text-muted-foreground">Evidence {{ alert.evidenceBucket ? formatDate(alert.evidenceBucket) : 'unavailable' }} · evaluated {{ formatDate(alert.lastEvaluatedAt) }}</p></article> }</div> }</section>
          }
        </section>
      </PageContent>
    </Page>
  `,
})
export class ObservabilityPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  protected readonly views = [
    { value: 'traces' as const, label: 'Traces', icon: 'account_tree' },
    { value: 'metrics' as const, label: 'Metrics', icon: 'insights' },
    { value: 'benchmarks' as const, label: 'Benchmarks', icon: 'speed' },
    {
      value: 'alerts' as const,
      label: 'Alerts',
      icon: 'notification_important',
    },
  ];
  protected readonly view = signal<View>('traces');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal<string | null>(null);
  protected readonly service = signal('');
  protected readonly statistic = signal<'count' | 'sum' | 'min' | 'max'>('sum');
  protected readonly metricGroup = signal<RuntimeMetricGroup | ''>('');
  protected readonly traces = signal<RuntimeTraceSummary[]>([]);
  protected readonly traceDetail = signal<RuntimeTraceDetail | null>(null);
  protected readonly metrics = signal<RuntimeMetricsResponse['data']>([]);
  protected readonly benchmarks = signal<BenchmarkRunSummary[]>([]);
  protected readonly benchmarkDetail = signal<BenchmarkRunDetail | null>(null);
  protected readonly alerts = signal<RuntimeAlertsResponse['data']>([]);
  private readonly loadErrorStatuses = signal<number[]>([]);
  protected readonly metricCoverage = computed(() => {
    const current = this.metricResponse();
    return {
      stored: current?.coverage.storedBuckets ?? 0,
      expected: current?.coverage.expectedBuckets ?? 0,
      missing: current?.coverage.missingBuckets ?? 0,
    };
  });
  private readonly metricResponse = signal<RuntimeMetricsResponse | null>(null);

  constructor() {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.storageWarning.set(null);
    this.traceDetail.set(null);
    this.loadErrorStatuses.set([]);
    const group = this.metricGroup();
    forkJoin({
      traces: this.api
        .runtimeTraces({ service: this.service() })
        .pipe(catchError((error) => this.captureLoadError(error))),
      metrics: this.api
        .runtimeMetrics({
          statistic: this.statistic(),
          ...(group ? { group } : {}),
        })
        .pipe(catchError((error) => this.captureLoadError(error))),
      benchmarks: this.api
        .benchmarkRuns()
        .pipe(catchError((error) => this.captureLoadError(error))),
      alerts: this.api
        .runtimeAlerts()
        .pipe(catchError((error) => this.captureLoadError(error))),
    }).subscribe((data) => {
      const loadErrors = this.loadErrorStatuses();
      if (loadErrors.length > 0) {
        this.error.set(this.loadErrorMessage(loadErrors));
      }
      const storageBlindSpot =
        data.traces?.storageStatus === 'blind_spot' ||
        data.metrics?.coverage.storageStatus === 'blind_spot' ||
        data.benchmarks?.storageStatus === 'blind_spot' ||
        data.alerts?.storageStatus === 'blind_spot';
      if (storageBlindSpot) {
        this.storageWarning.set(
          'Telemetry storage is unavailable. This view is a blind spot, not a zero result.',
        );
      }
      this.traces.set(data.traces?.data ?? []);
      this.metricResponse.set(data.metrics);
      this.metrics.set(data.metrics?.data ?? []);
      this.benchmarks.set(data.benchmarks?.data ?? []);
      this.alerts.set(data.alerts?.data ?? []);
      this.loading.set(false);
    });
  }

  private captureLoadError(error: unknown) {
    const status = error instanceof GatewayRequestError ? error.status : 0;
    this.loadErrorStatuses.update((statuses) => [...statuses, status]);
    return of(null);
  }

  private loadErrorMessage(statuses: readonly number[]): string {
    if (statuses.includes(403)) {
      return 'You do not have the observability permission to view this evidence.';
    }
    if (statuses.includes(401)) {
      return 'Your session is not authorized to view observability. Sign in again.';
    }
    return 'Observability data could not be loaded. Check telemetry query health.';
  }

  protected openTrace(trace: RuntimeTraceSummary): void {
    this.api.runtimeTrace(trace.traceId).subscribe({
      next: (detail) => this.traceDetail.set(detail),
      error: () =>
        this.error.set('This trace has expired or is no longer available.'),
    });
  }

  protected openBenchmark(run: BenchmarkRunSummary): void {
    this.api.benchmarkRun(run.runId).subscribe({
      next: (detail) => this.benchmarkDetail.set(detail),
      error: () =>
        this.error.set(
          'This benchmark projection is stale or no longer available.',
        ),
    });
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setStatistic(value: string): void {
    if (
      value === 'count' ||
      value === 'sum' ||
      value === 'min' ||
      value === 'max'
    ) {
      this.statistic.set(value);
      this.refresh();
    }
  }

  protected setMetricGroup(value: string): void {
    if (
      value === '' ||
      value === 'service' ||
      value === 'resourceKind' ||
      value === 'resourceName' ||
      value === 'status'
    ) {
      this.metricGroup.set(value);
      this.refresh();
    }
  }

  protected formatDate(value: string): string {
    return DATE_FORMAT.format(new Date(value));
  }

  protected statusVariant(
    status: string,
  ): 'default' | 'secondary' | 'destructive' {
    return status === 'error'
      ? 'destructive'
      : status === 'ok'
        ? 'default'
        : 'secondary';
  }

  protected decisionVariant(
    status: string,
  ): 'default' | 'secondary' | 'destructive' {
    return status === 'fail' || status === 'failed'
      ? 'destructive'
      : status === 'pass' || status === 'passed'
        ? 'default'
        : 'secondary';
  }

  protected alertVariant(
    status: AlertStatus,
  ): 'default' | 'secondary' | 'destructive' {
    return status === 'firing'
      ? 'destructive'
      : status === 'resolved'
        ? 'default'
        : 'secondary';
  }
}
