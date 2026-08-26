import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import type { BenchmarkBaselinesResponse } from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import {
  formatDate,
  inputValue,
  isExpiredCursorError,
  loadErrorMessage,
  trim,
} from '../observability.utils';

@Component({
  selector: 'app-observability-baselines-page',
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
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><div class="flex items-center gap-3"><Icon name="verified" [size]="18" class="text-primary" aria-hidden="true" /><div><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Observability</p><h1 class="text-lg font-semibold text-foreground">Baselines</h1></div></div><div class="flex gap-2"><PageFilterToggle ariaLabel="Show or hide baseline filters" (toggled)="filterOpen.set($event)"><Icon name="filter_list" [size]="14" aria-hidden="true" /><span>Filter</span></PageFilterToggle><button Button variant="outline" size="xs" type="button" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button></div></PageHeader>
      <PageFilter placement="stacked" collapsible [hidden]="!filterOpen()" class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-end"><label class="grid gap-1 text-xs text-muted-foreground">Scenario<select NativeSelect [value]="scenarioId()" (change)="scenarioId.set(inputValue($event))"><option NativeSelectOption value="">All scenarios</option>@for (option of options().scenarioIds; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Environment<select NativeSelect [value]="environment()" (change)="environment.set(inputValue($event))"><option NativeSelectOption value="">All environments</option>@for (option of options().environments; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Fixture version<select NativeSelect [value]="fixtureVersion()" (change)="fixtureVersion.set(inputValue($event))"><option NativeSelectOption value="">All fixture versions</option>@for (option of options().fixtureVersions; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Scenario version<input Input class="md:w-44" [value]="scenarioVersion()" (input)="scenarioVersion.set(inputValue($event))" /></label><div class="flex gap-2"><button Button size="xs" type="button" (click)="applyFilters()">Apply filters</button><button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">Clear Filters</button></div></PageFilter>
      <PageContent class="grid min-h-0 content-start overflow-auto"><section class="grid gap-2">@if (expiredNotice()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">This baseline link has expired. The first page was loaded with your filters intact.</p>}@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (storageWarning()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">Baseline storage is a blind spot, not an empty result.</p>}</section>@if (loading()) {<p class="border border-border bg-muted p-5 text-sm" role="status">Loading baselines...</p>} @else if (rows().length === 0) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No promoted baselines match the current filters.</p>} @else {<table class="min-w-full rounded-base bg-card text-left text-xs"><caption class="sr-only">Promoted benchmark baselines</caption><thead class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground"><tr><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Promoted</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Scenario</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Environment</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Fixture</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">State</th></tr></thead><tbody>@for (baseline of rows(); track baseline.baselineId) {<tr class="border-b border-border align-top last:border-0"><td class="whitespace-nowrap px-4 py-3">{{ formatDate(baseline.promotedAt) }}</td><td class="px-4 py-3"><p class="font-medium">{{ baseline.scenarioId }} · {{ baseline.scenarioVersion }}</p><p class="font-mono text-xs text-muted-foreground">{{ baseline.baselineId }}</p></td><td class="px-4 py-3">{{ baseline.environment }}</td><td class="px-4 py-3">{{ baseline.fixtureVersion }}</td><td class="px-4 py-3"><span Badge [variant]="baseline.active ? 'default' : 'secondary'">{{ baseline.active ? 'Active' : 'Inactive' }}</span></td></tr>}</tbody></table>}</PageContent>
      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><p class="text-sm text-muted-foreground">{{ rows().length }} rows on this page</p><div class="flex gap-2"><button Button variant="outline" size="xs" type="button" [disabled]="loading() || !prevCursor()" (click)="goTo(prevCursor())"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button><button Button variant="outline" size="xs" type="button" [disabled]="loading() || !nextCursor()" (click)="goTo(nextCursor())">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button></div></PageFooter>
    </Page>
  `,
})
export class ObservabilityBaselinesPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly rows = signal<BenchmarkBaselinesResponse['data']>([]);
  protected readonly options = signal<BenchmarkBaselinesResponse['options']>({
    scenarioIds: [],
    environments: [],
    fixtureVersions: [],
  });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly expiredNotice = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly scenarioId = signal('');
  protected readonly scenarioVersion = signal('');
  protected readonly fixtureVersion = signal('');
  protected readonly environment = signal('');
  protected readonly cursor = signal<string | null>(null);
  protected readonly prevCursor = signal<string | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly hasFilters = () =>
    Boolean(
      this.scenarioId() ||
        this.scenarioVersion() ||
        this.fixtureVersion() ||
        this.environment(),
    );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    this.scenarioId.set(query.get('scenarioId') ?? '');
    this.scenarioVersion.set(query.get('scenarioVersion') ?? '');
    this.fixtureVersion.set(query.get('fixtureVersion') ?? '');
    this.environment.set(query.get('environment') ?? '');
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
    this.scenarioVersion.set('');
    this.fixtureVersion.set('');
    this.environment.set('');
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
      .benchmarkBaselines({
        scenarioId: trim(this.scenarioId()),
        scenarioVersion: trim(this.scenarioVersion()),
        fixtureVersion: trim(this.fixtureVersion()),
        environment: trim(this.environment()),
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
        scenarioVersion: trim(this.scenarioVersion()) ?? null,
        fixtureVersion: trim(this.fixtureVersion()) ?? null,
        environment: trim(this.environment()) ?? null,
        cursor: this.cursor() ?? null,
      },
    });
  }
}
