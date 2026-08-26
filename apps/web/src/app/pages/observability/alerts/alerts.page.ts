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
  RuntimeAlertStatus,
  RuntimeAlertsResponse,
} from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  formatDate,
  inputValue,
  isExpiredCursorError,
  loadErrorMessage,
  trim,
} from '../observability.utils';

@Component({
  selector: 'app-observability-alerts-page',
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
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><div class="flex items-center gap-3"><Icon name="notification_important" [size]="18" class="text-primary" aria-hidden="true" /><div><p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Observability</p><h1 class="text-lg font-semibold text-foreground">Alerts</h1></div></div><div class="flex gap-2"><PageFilterToggle ariaLabel="Show or hide alert filters" (toggled)="filterOpen.set($event)"><Icon name="filter_list" [size]="14" aria-hidden="true" /><span>Filter</span></PageFilterToggle><button Button variant="outline" size="xs" type="button" [disabled]="loading()" (click)="refresh()"><Icon name="refresh" [size]="14" aria-hidden="true" />Refresh</button></div></PageHeader>
      <PageFilter placement="stacked" collapsible [hidden]="!filterOpen()" class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-end"><label class="grid gap-1 text-xs text-muted-foreground">Rule<select NativeSelect [value]="ruleId()" (change)="ruleId.set(inputValue($event))"><option NativeSelectOption value="">All rules</option>@for (option of options().ruleIds; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Service<select NativeSelect [value]="service()" (change)="service.set(inputValue($event))"><option NativeSelectOption value="">All services</option>@for (option of options().services; track option) {<option NativeSelectOption [value]="option">{{ option }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Status<select NativeSelect [value]="status()" (change)="setStatus(inputValue($event))"><option NativeSelectOption value="">All statuses</option>@for (option of statuses; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Severity<select NativeSelect [value]="severity()" (change)="setSeverity(inputValue($event))"><option NativeSelectOption value="">All severities</option>@for (option of severities; track option.value) {<option NativeSelectOption [value]="option.value">{{ option.label }}</option>}</select></label><label class="grid gap-1 text-xs text-muted-foreground">Series fingerprint<input Input class="md:w-56" [value]="seriesFingerprint()" (input)="seriesFingerprint.set(inputValue($event))" /></label><div class="flex gap-2"><button Button size="xs" type="button" (click)="applyFilters()">Apply filters</button><button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">Clear Filters</button></div></PageFilter>
      <PageContent class="grid min-h-0 content-start overflow-auto"><section class="grid gap-2">@if (expiredNotice()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">This alert link has expired. The first page was loaded with your filters intact.</p>}@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (storageWarning()) {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">Alert storage is a blind spot, not an empty result.</p>}</section>@if (loading()) {<p class="border border-border bg-muted p-5 text-sm" role="status">Loading alerts...</p>} @else if (rows().length === 0) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No alert states match the current filters.</p>} @else {<table class="min-w-full rounded-base bg-card text-left text-sm"><caption class="sr-only">Runtime alert states</caption><thead class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground"><tr><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Rule</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Service and resource</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">State</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Breaches</th><th scope="col" class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Last evaluated</th></tr></thead><tbody>@for (alert of rows(); track alert.ruleId + alert.seriesFingerprint) {<tr class="border-b border-border align-top last:border-0"><td class="px-4 py-3"><a class="font-medium underline-offset-4 hover:underline" [routerLink]="['/observability/alerts', alert.ruleId]">{{ alert.title ?? alert.ruleId }}</a><p class="font-mono text-xs text-muted-foreground">{{ alert.ruleId }} · {{ alert.ruleVersion }}</p></td><td class="px-4 py-3">{{ alert.serviceName }}<p class="text-xs text-muted-foreground">{{ alert.resourceKind }} · {{ alert.resourceName }}</p></td><td class="px-4 py-3"><span Badge [variant]="alert.status === 'firing' ? 'destructive' : alert.status === 'resolved' ? 'default' : 'secondary'">{{ alert.status }}{{ alert.severity ? ' · ' + alert.severity : '' }}</span></td><td class="px-4 py-3">{{ alert.consecutiveBreachWindows }} windows<p class="text-xs text-muted-foreground">transition {{ alert.transitionSequence }}</p></td><td class="whitespace-nowrap px-4 py-3">{{ formatDate(alert.lastEvaluatedAt) }}</td></tr>}</tbody></table>}</PageContent>
      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3"><p class="text-sm text-muted-foreground">{{ rows().length }} rows on this page</p><div class="flex gap-2"><button Button variant="outline" size="xs" type="button" [disabled]="loading() || !prevCursor()" (click)="goTo(prevCursor())"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button><button Button variant="outline" size="xs" type="button" [disabled]="loading() || !nextCursor()" (click)="goTo(nextCursor())">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button></div></PageFooter>
    </Page>
  `,
})
export class ObservabilityAlertsPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly statuses = ALERT_STATUSES;
  protected readonly severities = ALERT_SEVERITIES;
  protected readonly rows = signal<RuntimeAlertsResponse['data']>([]);
  protected readonly options = signal<RuntimeAlertsResponse['options']>({
    ruleIds: [],
    services: [],
  });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly expiredNotice = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly ruleId = signal('');
  protected readonly service = signal('');
  protected readonly status = signal<RuntimeAlertStatus | ''>('');
  protected readonly severity = signal<'warning' | 'critical' | ''>('');
  protected readonly seriesFingerprint = signal('');
  protected readonly cursor = signal<string | null>(null);
  protected readonly prevCursor = signal<string | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly hasFilters = () =>
    Boolean(
      this.ruleId() ||
        this.service() ||
        this.status() ||
        this.severity() ||
        this.seriesFingerprint(),
    );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    this.ruleId.set(query.get('ruleId') ?? '');
    this.service.set(query.get('service') ?? '');
    this.setStatus(query.get('status') ?? '');
    this.setSeverity(query.get('severity') ?? '');
    this.seriesFingerprint.set(query.get('seriesFingerprint') ?? '');
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
    this.ruleId.set('');
    this.service.set('');
    this.status.set('');
    this.severity.set('');
    this.seriesFingerprint.set('');
    this.applyFilters();
  }
  protected goTo(cursor: string | null): void {
    if (!cursor) return;
    this.cursor.set(cursor);
    this.applyUrl();
    this.load();
  }
  protected setStatus(value: string): void {
    this.status.set(
      ALERT_STATUSES.some((item) => item.value === value)
        ? (value as RuntimeAlertStatus)
        : '',
    );
  }
  protected setSeverity(value: string): void {
    this.severity.set(
      ALERT_SEVERITIES.some((item) => item.value === value)
        ? (value as 'warning' | 'critical')
        : '',
    );
  }
  protected inputValue = inputValue;
  protected formatDate = formatDate;
  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .runtimeAlerts({
        ruleId: trim(this.ruleId()),
        service: trim(this.service()),
        status: this.status() || undefined,
        severity: this.severity() || undefined,
        seriesFingerprint: trim(this.seriesFingerprint()),
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
          this.error.set(loadErrorMessage('observability:alert:read', error));
          this.loading.set(false);
        },
      });
  }
  private applyUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        ruleId: trim(this.ruleId()) ?? null,
        service: trim(this.service()) ?? null,
        status: this.status() || null,
        severity: this.severity() || null,
        seriesFingerprint: trim(this.seriesFingerprint()) ?? null,
        cursor: this.cursor() ?? null,
      },
    });
  }
}
