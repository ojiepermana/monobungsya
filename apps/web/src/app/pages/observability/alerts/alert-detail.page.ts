import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import type { RuntimeAlertsResponse } from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import { formatDate, loadErrorMessage } from '../observability.utils';

@Component({
  selector: 'app-observability-alert-detail-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0"><PageHeader class="flex min-h-(--layout-topbar-height) items-center justify-between gap-3 px-3"><div><a class="text-xs text-muted-foreground underline" routerLink="/observability/alerts">Observability / Alerts</a><h1 class="mt-1 text-lg font-semibold text-foreground">Alert rule detail</h1></div><a Button variant="outline" size="xs" routerLink="/observability/alerts" class="gap-1.5"><Icon name="arrow_back" [size]="14" aria-hidden="true" />Back to alerts</a></PageHeader><PageContent class="grid min-h-0 content-start gap-5 overflow-auto px-3 py-5">@if (loading()) {<p class="border border-border bg-muted p-5 text-sm" role="status">Loading alert rule...</p>}@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (!loading() && rows().length === 0 && !error()) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No state exists for this alert rule.</p>}@if (rows().length) {<section class="grid gap-4" aria-labelledby="alert-rule-title"><div><p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rule ID</p><h2 id="alert-rule-title" class="mt-1 break-all font-mono text-lg font-semibold text-foreground">{{ ruleId }}</h2><p class="mt-1 text-sm text-muted-foreground">Each series state is retained separately so a rule detail remains auditable.</p></div>@for (alert of rows(); track alert.ruleId + alert.seriesFingerprint) {<article class="grid gap-4 rounded-base border border-border bg-card p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="text-base font-semibold text-foreground">{{ alert.title ?? 'Alert state' }}</h3><p class="mt-1 font-mono text-xs text-muted-foreground">{{ alert.seriesFingerprint }}</p></div><span Badge [variant]="alert.status === 'firing' ? 'destructive' : alert.status === 'resolved' ? 'default' : 'secondary'">{{ alert.status }}{{ alert.severity ? ' · ' + alert.severity : '' }}</span></div><dl class="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><dt class="text-xs text-muted-foreground">Service</dt><dd class="mt-1">{{ alert.serviceName }}</dd></div><div><dt class="text-xs text-muted-foreground">Resource</dt><dd class="mt-1">{{ alert.resourceKind }} · {{ alert.resourceName }}</dd></div><div><dt class="text-xs text-muted-foreground">Metric</dt><dd class="mt-1">{{ alert.metric ?? 'not recorded' }}</dd></div><div><dt class="text-xs text-muted-foreground">Threshold</dt><dd class="mt-1">{{ alert.threshold ?? 'not recorded' }}</dd></div><div><dt class="text-xs text-muted-foreground">Breach windows</dt><dd class="mt-1">{{ alert.consecutiveBreachWindows }}</dd></div><div><dt class="text-xs text-muted-foreground">First breached</dt><dd class="mt-1">{{ alert.firstBreachedAt ? formatDate(alert.firstBreachedAt) : 'not recorded' }}</dd></div><div><dt class="text-xs text-muted-foreground">Last evaluated</dt><dd class="mt-1">{{ formatDate(alert.lastEvaluatedAt) }}</dd></div><div><dt class="text-xs text-muted-foreground">Resolved</dt><dd class="mt-1">{{ alert.resolvedAt ? formatDate(alert.resolvedAt) : 'not resolved' }}</dd></div></dl><p class="text-xs text-muted-foreground">Rule version {{ alert.ruleVersion }} · transition {{ alert.transitionSequence }} · evidence bucket {{ alert.evidenceBucket ?? 'not recorded' }}</p></article>}</section>}</PageContent><PageFooter class="flex min-h-(--layout-topbar-height) items-center justify-between px-3"><p class="text-sm text-muted-foreground">{{ rows().length }} series states</p><span class="text-xs text-muted-foreground">Alert detail is read-only.</span></PageFooter></Page>
  `,
})
export class ObservabilityAlertDetailPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<RuntimeAlertsResponse['data']>([]);
  protected readonly ruleId = this.route.snapshot.paramMap.get('ruleId') ?? '';
  constructor() {
    this.api
      .runtimeAlerts({
        ruleId: this.ruleId,
        seriesFingerprint:
          this.route.snapshot.queryParamMap.get('seriesFingerprint') ??
          undefined,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(
            this.status(error) === 404
              ? 'This alert rule has expired or no longer exists.'
              : loadErrorMessage('observability:alert:read', error),
          );
          this.loading.set(false);
        },
      });
  }
  protected formatDate = formatDate;
  private status(error: unknown): number {
    return typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  }
}
