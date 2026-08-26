import { Component, inject, signal } from '@angular/core';
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
import type {
  BenchmarkRunSummary,
  BenchmarkRunsResponse,
} from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import {
  formatDate,
  inputValue,
  isExpiredCursorError,
  loadErrorMessage,
  trim,
} from '../observability.utils';

const RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'partial',
] as const;

@Component({
  selector: 'app-observability-benchmarks-page',
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
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><div class="flex items-center gap-3"><Icon name="speed" [size]="18" class="text-primary" aria-hidden="true" /><div><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Observability</p><h1 class="text-lg font-semibold text-foreground">Benchmark runs</h1></div></div><div class="flex gap-2"><PageFilterToggle ariaLabel="Show or hide benchmark filters" (toggled)="filterOpen.set($event)"><Icon name="filter_list" [size]="14" aria-hidden="true" /><span>Filter</span></PageFilterToggle><button Button variant="outline" size="xs" type="button" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button></div></PageHeader>
      <PageFilter placement="stacked" collapsible [hidden]="!filterOpen()" class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-end"><label class="grid gap-1 text-xs text-muted-foreground">Scenario<select NativeSelect [value]="scenarioId()" (change)="scenarioId.set(inputValue($event))"><option NativeSelectOption value="">All scenarios</option>@for (option of options().scenarioIds; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Status<select NativeSelect [value]="status()" (change)="status.set(inputValue($event))"><option NativeSelectOption value="">All statuses</option>@for (option of statuses; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Bun version<select NativeSelect [value]="bunVersion()" (change)="bunVersion.set(inputValue($event))"><option NativeSelectOption value="">All Bun versions</option>@for (option of options().bunVersions; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Source commit<input Input class="md:w-56" [value]="sourceCommitSha()" (input)="sourceCommitSha.set(inputValue($event))" /></label><div class="flex gap-2"><button Button size="xs" type="button" (click)="applyFilters()">Apply filters</button><button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">Clear Filters</button></div></PageFilter>
      <PageContent class="grid min-h-0 content-start overflow-auto"><section class="grid gap-2">@if (expiredNotice()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">This benchmark link has expired. The first page was loaded with your filters intact.</p>}@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (storageWarning()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">Benchmark storage is a blind spot, not an empty result.</p>}</section>@if (loading()) {<p class="border border-border bg-muted p-5 text-sm" role="status">Loading benchmark runs...</p>} @else if (rows().length === 0) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No benchmark runs match the current filters.</p>} @else {<table class="min-w-full rounded-base bg-card text-left text-xs"><caption class="sr-only">Benchmark runs</caption><thead class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground"><tr><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Started</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Scenario</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Status</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Environment</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Evidence</th></tr></thead><tbody>@for (run of rows(); track run.runId) {<tr class="border-b border-border align-top last:border-0"><td class="whitespace-nowrap px-4 py-3">{{ formatDate(run.startedAt) }}</td><td class="px-4 py-3"><a class="font-medium underline-offset-4 hover:underline" [routerLink]="['/observability/benchmarks', run.runId]">{{ run.scenarioId }} · {{ run.scenarioVersion }}</a><p class="font-mono text-xs text-muted-foreground">{{ run.runId }}</p></td><td class="px-4 py-3"><span Badge [variant]="run.status === 'failed' ? 'destructive' : run.status === 'completed' ? 'default' : 'secondary'">{{ run.status }}</span></td><td class="px-4 py-3">{{ run.environment }}<p class="text-xs text-muted-foreground">Bun {{ run.bunVersion }}</p></td><td class="px-4 py-3 text-xs text-muted-foreground">{{ run.completeness }} · {{ run.comparisonStatus ?? 'not compared' }}</td></tr>}</tbody></table>}</PageContent>
      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><p class="text-sm text-muted-foreground">{{ rows().length }} rows on this page</p><div class="flex gap-2"><button Button variant="outline" size="xs" type="button" [disabled]="loading() || !prevCursor()" (click)="goTo(prevCursor())"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button><button Button variant="outline" size="xs" type="button" [disabled]="loading() || !nextCursor()" (click)="goTo(nextCursor())">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button></div></PageFooter>
    </Page>
  `,
})
export class ObservabilityBenchmarksPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly statuses = RUN_STATUSES;
  protected readonly rows = signal<BenchmarkRunSummary[]>([]);
  protected readonly options = signal<BenchmarkRunsResponse['options']>({
    scenarioIds: [],
    statuses: [],
    bunVersions: [],
  });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly expiredNotice = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly scenarioId = signal('');
  protected readonly status = signal('');
  protected readonly bunVersion = signal('');
  protected readonly sourceCommitSha = signal('');
  protected readonly cursor = signal<string | null>(null);
  protected readonly prevCursor = signal<string | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly hasFilters = () =>
    Boolean(
      this.scenarioId() ||
        this.status() ||
        this.bunVersion() ||
        this.sourceCommitSha(),
    );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    this.scenarioId.set(query.get('scenarioId') ?? '');
    this.status.set(query.get('status') ?? '');
    this.bunVersion.set(query.get('bunVersion') ?? '');
    this.sourceCommitSha.set(query.get('sourceCommitSha') ?? '');
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
    this.cursor.set(null);
    this.expiredNotice.set(false);
    this.applyUrl();
    this.load();
  }
  protected clearFilters(): void {
    this.scenarioId.set('');
    this.status.set('');
    this.bunVersion.set('');
    this.sourceCommitSha.set('');
    this.applyFilters();
  }
  protected goTo(cursor: string | null): void {
    if (!cursor) return;
    this.cursor.set(cursor);
    this.applyUrl();
    this.load();
  }
  protected inputValue = inputValue;
  protected formatDate = formatDate;
  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .benchmarkRuns({
        scenarioId: trim(this.scenarioId()),
        status: trim(this.status()),
        bunVersion: trim(this.bunVersion()),
        sourceCommitSha: trim(this.sourceCommitSha()),
        cursor: this.cursor() ?? undefined,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.options.set(response.options);
          this.prevCursor.set(response.prevCursor);
          this.nextCursor.set(response.nextCursor);
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
          this.error.set(
            loadErrorMessage('observability:benchmark:read', error),
          );
          this.loading.set(false);
        },
      });
  }
  private applyUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        scenarioId: trim(this.scenarioId()) ?? null,
        status: trim(this.status()) ?? null,
        bunVersion: trim(this.bunVersion()) ?? null,
        sourceCommitSha: trim(this.sourceCommitSha()) ?? null,
        cursor: this.cursor() ?? null,
      },
    });
  }
}
