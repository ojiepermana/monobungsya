import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
  PageFilterComponent,
  PageFilterToggleComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import type { RuntimeTraceSummary } from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import {
  defaultTimeWindow,
  formatCount,
  formatDate,
  inputValue,
  isExpiredCursorError,
  isoFromLocalDateTime,
  loadErrorMessage,
  localDateTimeValue,
  TRACE_STATUSES,
  trim,
  validateDayWindow,
  WINDOW_PRESETS,
} from '../observability.utils';

@Component({
  selector: 'app-observability-traces-page',
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
    PageFilterComponent,
    PageFilterToggleComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <Icon name="account_tree" [size]="18" class="shrink-0 text-primary" aria-hidden="true" />
          <div class="min-w-0"><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Observability</p><h1 class="truncate text-lg font-semibold text-foreground">Traces</h1></div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <PageFilterToggle ariaLabel="Show or hide trace filters" (toggled)="filterOpen.set($event)"><Icon name="filter_list" [size]="14" aria-hidden="true" /><span>Filter</span></PageFilterToggle>
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button>
        </div>
      </PageHeader>

      <PageFilter placement="stacked" collapsible [hidden]="!filterOpen()" class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-end">
        <label class="grid gap-1 text-xs text-muted-foreground">Service<select NativeSelect class="md:w-44" [value]="service()" (change)="service.set(inputValue($event))"><option NativeSelectOption value="">All services</option>@for (option of options().services; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Resource kind<select NativeSelect class="md:w-44" [value]="resourceKind()" (change)="resourceKind.set(inputValue($event))"><option NativeSelectOption value="">All resource kinds</option>@for (option of options().resourceKinds; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Resource name<select NativeSelect class="md:w-52" [value]="resourceName()" (change)="resourceName.set(inputValue($event))"><option NativeSelectOption value="">All resource names</option>@for (option of options().resourceNames; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Status<select NativeSelect [value]="status()" (change)="status.set(inputValue($event))"><option NativeSelectOption value="">All statuses</option>@for (option of statuses; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Correlation ID<input Input class="md:w-48" [value]="correlationId()" (input)="correlationId.set(inputValue($event))" /></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Request ID<input Input class="md:w-48" [value]="requestId()" (input)="requestId.set(inputValue($event))" /></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Run ID<input Input class="md:w-48" [value]="runId()" (input)="runId.set(inputValue($event))" /></label>
        <label class="grid gap-1 text-xs text-muted-foreground">Quick window<select NativeSelect [value]="preset()" (change)="setPreset(inputValue($event))"><option NativeSelectOption value="custom">Custom</option>@for (option of presets; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label>
        <label class="grid gap-1 text-xs text-muted-foreground">From<input Input type="datetime-local" [value]="fromLocal()" (change)="setFrom(inputValue($event))" /></label>
        <label class="grid gap-1 text-xs text-muted-foreground">To<input Input type="datetime-local" [value]="toLocal()" (change)="setTo(inputValue($event))" /></label>
        <div class="flex gap-2"><button Button size="xs" type="button" (click)="applyFilters()">Apply filters</button><button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">Clear Filters</button></div>
      </PageFilter>

      <PageContent class="grid min-h-0 content-start gap-5 overflow-auto px-3 py-5">
        <section class="grid gap-2"><p class="text-sm text-muted-foreground">Sampled runtime trees, linked to their request and benchmark evidence. The filter window is limited to 24 hours.</p>@if (expiredNotice()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100" role="status">This trace link has expired. The first page was loaded with your filters intact.</p>} @if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>} @if (storageWarning()) {<p class="border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">Telemetry storage is unavailable. This view is a blind spot, not a zero result.</p>}</section>
        @if (loading()) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground" role="status">Loading traces...</p>} @else if (rows().length === 0) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No sampled traces match this window.</p>} @else {
          <div class="overflow-auto rounded-base border border-border bg-card"><table class="min-w-full text-left text-sm"><caption class="sr-only">Sampled runtime traces</caption><thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th scope="col" class="px-4 py-3">Started</th><th scope="col" class="px-4 py-3">Service and resource</th><th scope="col" class="px-4 py-3">Status</th><th scope="col" class="px-4 py-3">Duration</th><th scope="col" class="px-4 py-3">Evidence</th></tr></thead><tbody>@for (trace of rows(); track trace.traceId) {<tr class="border-b border-border align-top last:border-0"><td class="whitespace-nowrap px-4 py-3">{{ formatDate(trace.startedAt) }}</td><td class="px-4 py-3"><a class="font-medium text-foreground underline-offset-4 hover:underline" [routerLink]="['/observability/traces', trace.traceId]">{{ trace.serviceName }} · {{ trace.resourceName }}</a><p class="font-mono text-xs text-muted-foreground">{{ trace.traceId }}</p></td><td class="px-4 py-3"><span Badge [variant]="statusVariant(trace.status)">{{ trace.status }}</span></td><td class="whitespace-nowrap px-4 py-3">{{ Number(trace.durationMs).toFixed(2) }} ms</td><td class="px-4 py-3 text-xs text-muted-foreground">{{ formatCount(trace.spanCount) }} spans · {{ trace.complete ? trace.samplingReason : 'partial tree' }}</td></tr>}</tbody></table></div>
        }
      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><p class="text-sm text-muted-foreground">{{ rows().length }} rows on this page</p><div class="flex gap-2"><button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || !prevCursor()" (click)="goTo(prevCursor())"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button><button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || !nextCursor()" (click)="goTo(nextCursor())">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button></div></PageFooter>
    </Page>
  `,
})
export class ObservabilityTracesPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly statuses = TRACE_STATUSES;
  protected readonly presets = WINDOW_PRESETS;
  protected readonly rows = signal<RuntimeTraceSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly expiredNotice = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly service = signal('');
  protected readonly resourceKind = signal('');
  protected readonly resourceName = signal('');
  protected readonly status = signal('');
  protected readonly correlationId = signal('');
  protected readonly requestId = signal('');
  protected readonly runId = signal('');
  protected readonly from = signal(defaultTimeWindow().from);
  protected readonly to = signal(defaultTimeWindow().to);
  protected readonly preset = signal('24h');
  protected readonly cursor = signal<string | null>(null);
  protected readonly prevCursor = signal<string | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly options = signal({
    services: [] as string[],
    resourceKinds: [] as string[],
    resourceNames: [] as string[],
  });
  protected readonly fromLocal = computed(() =>
    localDateTimeValue(this.from()),
  );
  protected readonly toLocal = computed(() => localDateTimeValue(this.to()));
  protected readonly hasFilters = computed(() =>
    Boolean(
      this.service() ||
        this.resourceKind() ||
        this.resourceName() ||
        this.status() ||
        this.correlationId() ||
        this.requestId() ||
        this.runId() ||
        this.preset() !== '24h',
    ),
  );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const defaults = defaultTimeWindow();
    this.from.set(query.get('from') ?? defaults.from);
    this.to.set(query.get('to') ?? defaults.to);
    this.service.set(query.get('service') ?? '');
    this.resourceKind.set(query.get('resourceKind') ?? '');
    this.resourceName.set(query.get('resourceName') ?? '');
    this.status.set(query.get('status') ?? '');
    this.correlationId.set(query.get('correlationId') ?? '');
    this.requestId.set(query.get('requestId') ?? '');
    this.runId.set(query.get('runId') ?? '');
    this.preset.set(query.get('preset') ?? '24h');
    this.cursor.set(query.get('cursor'));
    this.load();
  }

  protected refresh(): void {
    this.cursor.set(null);
    this.expiredNotice.set(false);
    this.applyUrl();
    this.load();
  }

  protected applyFilters(): void {
    const validation = validateDayWindow({ from: this.from(), to: this.to() });
    if (validation) {
      this.error.set(validation);
      return;
    }
    this.cursor.set(null);
    this.expiredNotice.set(false);
    this.applyUrl();
    this.load();
  }

  protected clearFilters(): void {
    const defaults = defaultTimeWindow();
    this.service.set('');
    this.resourceKind.set('');
    this.resourceName.set('');
    this.status.set('');
    this.correlationId.set('');
    this.requestId.set('');
    this.runId.set('');
    this.from.set(defaults.from);
    this.to.set(defaults.to);
    this.preset.set('24h');
    this.applyFilters();
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

  protected goTo(cursor: string | null): void {
    if (!cursor) return;
    this.cursor.set(cursor);
    this.applyUrl();
    this.load();
  }

  protected formatDate = formatDate;
  protected formatCount = formatCount;
  protected inputValue = inputValue;
  protected Number = Number;

  protected statusVariant(
    status: string,
  ): 'default' | 'secondary' | 'destructive' {
    return status === 'error'
      ? 'destructive'
      : status === 'ok'
        ? 'default'
        : 'secondary';
  }

  private load(): void {
    const validation = validateDayWindow({ from: this.from(), to: this.to() });
    if (validation) {
      this.error.set(validation);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api
      .runtimeTraces({
        from: this.from(),
        to: this.to(),
        service: trim(this.service()),
        resourceKind: trim(this.resourceKind()),
        resourceName: trim(this.resourceName()),
        status: trim(this.status()) as 'ok' | 'error' | 'unset' | undefined,
        correlationId: trim(this.correlationId()),
        requestId: trim(this.requestId()),
        runId: trim(this.runId()),
        cursor: this.cursor() ?? undefined,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.prevCursor.set(response.prevCursor);
          this.nextCursor.set(response.nextCursor);
          this.options.set(response.options);
          this.storageWarning.set(response.storageStatus === 'blind_spot');
          this.loading.set(false);
        },
        error: (error: unknown) => {
          if (this.cursor() && isExpiredCursorError(error)) {
            this.cursor.set(null);
            this.expiredNotice.set(true);
            this.applyUrl();
            this.load();
            return;
          }
          this.error.set(loadErrorMessage('observability:trace:read', error));
          this.loading.set(false);
        },
      });
  }

  private applyUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        from: this.from(),
        to: this.to(),
        preset: this.preset(),
        service: trim(this.service()) ?? null,
        resourceKind: trim(this.resourceKind()) ?? null,
        resourceName: trim(this.resourceName()) ?? null,
        status: trim(this.status()) ?? null,
        correlationId: trim(this.correlationId()) ?? null,
        requestId: trim(this.requestId()) ?? null,
        runId: trim(this.runId()) ?? null,
        cursor: this.cursor() ?? null,
      },
    });
  }
}
