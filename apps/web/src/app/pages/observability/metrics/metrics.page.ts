import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ChartAxisY,
  type ChartConfig,
  ChartContainer,
  ChartGrid,
} from '@ojiepermana/angular/chart';
import { AreaChart } from '@ojiepermana/angular/chart/area';
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
  PageFilterComponent,
  PageFilterToggleComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import type { Subscription } from 'rxjs';
import type {
  RuntimeMetricGroup,
  RuntimeMetricsResponse,
} from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import {
  defaultTimeWindow,
  formatCount,
  formatDate,
  formatMetricValue,
  inputValue,
  isoFromLocalDateTime,
  loadErrorMessage,
  localDateTimeValue,
  METRIC_GROUPS,
  METRIC_STATISTICS,
  metricChart,
  trim,
  validateDayWindow,
  WINDOW_PRESETS,
} from '../observability.utils';

@Component({
  selector: 'app-observability-metrics-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    ChartAxisY,
    ChartContainer,
    ChartGrid,
    IconComponent,
    InputComponent,
    AreaChart,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageFilterComponent,
    PageFilterToggleComponent,
    PageFooterComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3"><Icon name="insights" [size]="18" class="shrink-0 text-primary" aria-hidden="true" /><div class="min-w-0"><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Observability</p><h1 class="truncate text-lg font-semibold text-foreground">Metrics</h1></div></div>
        <div class="flex shrink-0 items-center gap-2"><PageFilterToggle ariaLabel="Show or hide metric filters" (toggled)="filterOpen.set($event)"><Icon name="filter_list" [size]="14" aria-hidden="true" /><span>Filter</span></PageFilterToggle><button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button></div>
      </PageHeader>

      <PageFilter placement="stacked" collapsible [hidden]="!filterOpen()" class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-end">
        <label class="grid gap-1 text-xs text-muted-foreground">Metric<select NativeSelect class="md:w-56" [value]="metric()" (change)="metric.set(inputValue($event))"><option NativeSelectOption value="">All metrics</option>@for (option of options().metrics; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Service<select NativeSelect class="md:w-44" [value]="service()" (change)="service.set(inputValue($event))"><option NativeSelectOption value="">All services</option>@for (option of options().services; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Resource kind<select NativeSelect class="md:w-44" [value]="resourceKind()" (change)="resourceKind.set(inputValue($event))"><option NativeSelectOption value="">All resource kinds</option>@for (option of options().resourceKinds; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Group<select NativeSelect [value]="group()" (change)="setGroup(inputValue($event))">@for (option of groups; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Statistic<select NativeSelect [value]="statistic()" (change)="setStatistic(inputValue($event))">@for (option of statistics; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Step<select NativeSelect [value]="step()" (change)="step.set(inputValue($event))"><option NativeSelectOption value="60">1 minute</option><option NativeSelectOption value="300">5 minutes</option><option NativeSelectOption value="900">15 minutes</option><option NativeSelectOption value="3600">1 hour</option></select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Quick window<select NativeSelect [value]="preset()" (change)="setPreset(inputValue($event))"><option NativeSelectOption value="custom">Custom</option>@for (option of presets; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">From<input Input type="datetime-local" [value]="fromLocal()" (change)="setFrom(inputValue($event))" /></label><label class="grid gap-1 text-xs text-muted-foreground">To<input Input type="datetime-local" [value]="toLocal()" (change)="setTo(inputValue($event))" /></label>
        <div class="flex gap-2"><button Button size="xs" type="button" (click)="applyFilters()">Apply filters</button><button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">Clear Filters</button></div>
      </PageFilter>

      <PageContent class="grid min-h-0 content-start gap-5 overflow-x-hidden overflow-y-auto px-3 py-5">
        <section class="grid gap-2"><p class="text-sm text-muted-foreground">Coverage compares stored buckets with the buckets expected in the selected time window. Missing buckets are shown at zero in the chart and counted separately as missing coverage.</p>@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (storageWarning()) {<p class="border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">Telemetry storage is unavailable. This view is a blind spot, not a zero result.</p>}</section>
        @if (loading()) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground" role="status">Loading metrics...</p>} @else {
          <section class="grid gap-4 rounded-base border border-border bg-card p-5" aria-labelledby="metrics-chart-title"><div class="flex flex-wrap items-end justify-between gap-3"><div><p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Coverage</p><h2 id="metrics-chart-title" class="mt-1 text-lg font-semibold text-foreground">Metric trend</h2></div><div class="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span><strong>{{ formatCount(coverage().storedBuckets) }}</strong> stored</span><span><strong>{{ formatCount(coverage().expectedBuckets) }}</strong> expected</span><span><strong>{{ formatCount(coverage().missingBuckets) }}</strong> missing</span></div></div>@if (response()?.data?.length) {<div class="relative" role="group" aria-label="Metric trend with missing buckets rendered as zero"><div class="relative h-80"><Chart [config]="chartConfig()" aspect="aspect-auto h-80" chartId="observability-metrics"><ChartArea [data]="chart().data" xKey="bucketStart" [gradient]="true"><svg:g ChartGrid></svg:g><svg:g ChartAxisY [tickFormat]="formatMetricValue"></svg:g></ChartArea></Chart></div><div class="relative z-10 mt-1 h-7 border-t border-border bg-card pt-1 text-xs text-muted-foreground" aria-hidden="true"><div class="metric-axis-labels relative ml-12 h-full mr-2">@for (label of chart().axisLabels; track label.left) {<span class="absolute top-1 whitespace-nowrap" [class.left-0]="label.align === 'start'" [class.right-0]="label.align === 'end'" [style.left.%]="label.align === 'middle' ? label.left : null" [style.transform]="label.align === 'middle' ? 'translateX(-50%)' : null">{{ label.label }}</span>}</div></div></div><p class="text-xs text-muted-foreground">Missing buckets are drawn at zero so the area stays continuous. Coverage counters still identify how much telemetry was not stored.</p><div class="sr-only">{{ missingDescription() }}</div>} @else {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No metric buckets are available for this window.</p>}</section>
          <section class="grid gap-3" aria-labelledby="metric-table-title"><div><h2 id="metric-table-title" class="text-base font-semibold text-foreground">Stored buckets</h2><p class="text-sm text-muted-foreground">Only buckets returned by the service are listed here.</p></div>@if (response()?.data?.length) {<div class="overflow-auto rounded-base border border-border bg-card"><table class="min-w-full text-left text-sm"><caption class="sr-only">Stored runtime metric buckets</caption><thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th scope="col" class="px-4 py-3">Bucket</th><th scope="col" class="px-4 py-3">Metric</th><th scope="col" class="px-4 py-3">Resource</th><th scope="col" class="px-4 py-3">Value</th></tr></thead><tbody>@for (point of response()!.data; track point.bucketStart + point.metricName + point.serviceName) {<tr class="border-b border-border last:border-0"><td class="whitespace-nowrap px-4 py-3">{{ formatDate(point.bucketStart) }}</td><td class="px-4 py-3 font-mono text-xs">{{ point.metricName }}</td><td class="px-4 py-3"><p>{{ point.serviceName }}</p><p class="text-xs text-muted-foreground">{{ point.resourceName }}</p></td><td class="px-4 py-3 font-mono">{{ point.value }} {{ point.unit }}</td></tr>}</tbody></table></div>} @else {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No stored buckets match the current filters.</p>}</section>
        }
      </PageContent>
      <PageFooter class="flex min-h-(--layout-topbar-height) items-center justify-between gap-3 px-3"><p class="text-sm text-muted-foreground">{{ formatCount(coverage().storedBuckets) }} buckets · coverage {{ formatCount(coverage().storedBuckets) }}/{{ formatCount(coverage().expectedBuckets) }}</p><span class="text-xs text-muted-foreground">No page cursor for metrics</span></PageFooter>
    </Page>
  `,
})
export class ObservabilityMetricsPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly groups = METRIC_GROUPS;
  protected readonly statistics = METRIC_STATISTICS;
  protected readonly presets = WINDOW_PRESETS;
  protected readonly filterOpen = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly response = signal<RuntimeMetricsResponse | null>(null);
  protected readonly options = signal({
    metrics: [] as string[],
    services: [] as string[],
    resourceKinds: [] as string[],
  });
  protected readonly metric = signal('');
  protected readonly service = signal('');
  protected readonly resourceKind = signal('');
  protected readonly group = signal<RuntimeMetricGroup | ''>('');
  protected readonly statistic = signal<'count' | 'sum' | 'min' | 'max'>('sum');
  protected readonly step = signal('60');
  protected readonly from = signal(defaultTimeWindow().from);
  protected readonly to = signal(defaultTimeWindow().to);
  protected readonly preset = signal('24h');
  protected readonly fromLocal = computed(() =>
    localDateTimeValue(this.from()),
  );
  protected readonly toLocal = computed(() => localDateTimeValue(this.to()));
  protected readonly coverage = computed(
    () =>
      this.response()?.coverage ?? {
        expectedBuckets: 0,
        storedBuckets: 0,
        missingBuckets: 0,
        storageStatus: 'blind_spot' as const,
      },
  );
  protected readonly chart = computed(() => {
    const response = this.response();
    return response
      ? metricChart(
          response,
          { from: this.from(), to: this.to() },
          this.group(),
        )
      : { data: [], seriesKeys: [], gaps: [], axisLabels: [] };
  });
  protected readonly chartConfig = computed<ChartConfig>(() =>
    Object.fromEntries(
      this.chart().seriesKeys.map((key, index) => [
        key,
        { label: key, color: `hsl(var(--chart-${(index % 5) + 1}))` },
      ]),
    ),
  );
  protected readonly hasFilters = computed(() =>
    Boolean(
      this.metric() ||
        this.service() ||
        this.resourceKind() ||
        this.group() ||
        this.statistic() !== 'sum' ||
        this.step() !== '60' ||
        this.preset() !== '24h',
    ),
  );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const defaults = defaultTimeWindow();
    this.from.set(query.get('from') ?? defaults.from);
    this.to.set(query.get('to') ?? defaults.to);
    this.metric.set(query.get('metric') ?? '');
    this.service.set(query.get('service') ?? '');
    this.resourceKind.set(query.get('resourceKind') ?? '');
    const group = query.get('group') ?? '';
    this.group.set(
      this.groups.some((option) => option.value === group)
        ? (group as RuntimeMetricGroup | '')
        : '',
    );
    const statistic = query.get('statistic') ?? 'sum';
    this.statistic.set(
      this.statistics.some((option) => option.value === statistic)
        ? (statistic as 'count' | 'sum' | 'min' | 'max')
        : 'sum',
    );
    const step = query.get('step') ?? '60';
    this.step.set(['60', '300', '900', '3600'].includes(step) ? step : '60');
    const preset = query.get('preset') ?? '24h';
    this.preset.set(
      preset === 'custom' ||
        this.presets.some((option) => option.value === preset)
        ? preset
        : '24h',
    );
    this.load();
  }

  protected refresh(): void {
    this.applyFilters();
  }
  protected applyFilters(): void {
    const validation = validateDayWindow({ from: this.from(), to: this.to() });
    if (validation) {
      this.error.set(validation);
      return;
    }
    this.applyUrl();
    this.load();
  }
  protected clearFilters(): void {
    const defaults = defaultTimeWindow();
    this.metric.set('');
    this.service.set('');
    this.resourceKind.set('');
    this.group.set('');
    this.statistic.set('sum');
    this.step.set('60');
    this.from.set(defaults.from);
    this.to.set(defaults.to);
    this.preset.set('24h');
    this.applyFilters();
  }
  protected setGroup(value: string): void {
    if (
      value === '' ||
      value === 'service' ||
      value === 'resourceKind' ||
      value === 'resourceName' ||
      value === 'status'
    )
      this.group.set(value);
  }
  protected setStatistic(value: string): void {
    if (
      value === 'count' ||
      value === 'sum' ||
      value === 'min' ||
      value === 'max'
    )
      this.statistic.set(value);
  }
  protected setPreset(value: string): void {
    const preset = this.presets.find((item) => item.value === value);
    if (!preset) {
      this.preset.set('custom');
      return;
    }
    const to = new Date();
    this.to.set(to.toISOString());
    this.from.set(new Date(to.getTime() - preset.milliseconds).toISOString());
    this.preset.set(value);
  }
  protected setFrom(value: string): void {
    this.from.set(isoFromLocalDateTime(value));
    this.preset.set('custom');
  }
  protected setTo(value: string): void {
    this.to.set(isoFromLocalDateTime(value));
    this.preset.set('custom');
  }
  protected formatDate = formatDate;
  protected formatCount = formatCount;
  protected formatMetricValue = formatMetricValue;
  protected inputValue = inputValue;
  protected missingDescription(): string {
    const count = Number(this.coverage().missingBuckets);
    return count > 0
      ? `${formatCount(count)} expected metric buckets are missing. They are drawn at zero in the chart and counted separately from stored values.`
      : 'All expected metric buckets are available.';
  }

  private load(): void {
    this.requestSubscription?.unsubscribe();
    const requestVersion = ++this.requestVersion;
    const validation = validateDayWindow({ from: this.from(), to: this.to() });
    if (validation) {
      this.error.set(validation);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.storageWarning.set(false);
    this.requestSubscription = this.api
      .runtimeMetrics({
        from: this.from(),
        to: this.to(),
        metric: trim(this.metric()),
        service: trim(this.service()),
        resourceKind: trim(this.resourceKind()),
        statistic: this.statistic(),
        step: this.step(),
        group: this.group() || undefined,
      })
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.requestVersion) return;
          this.response.set(response);
          this.options.set(response.options);
          this.storageWarning.set(
            response.coverage.storageStatus === 'blind_spot',
          );
          this.loading.set(false);
        },
        error: (error: unknown) => {
          if (requestVersion !== this.requestVersion) return;
          this.error.set(loadErrorMessage('observability:metric:read', error));
          this.loading.set(false);
        },
      });
  }

  private requestVersion = 0;
  private requestSubscription: Subscription | null = null;

  private applyUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        from: this.from(),
        to: this.to(),
        preset: this.preset(),
        metric: trim(this.metric()) ?? null,
        service: trim(this.service()) ?? null,
        resourceKind: trim(this.resourceKind()) ?? null,
        group: this.group() || null,
        statistic: this.statistic(),
        step: this.step(),
      },
    });
  }
}
