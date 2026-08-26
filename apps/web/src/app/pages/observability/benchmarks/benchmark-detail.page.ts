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
import type { BenchmarkRunDetail } from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import { formatDate, loadErrorMessage } from '../observability.utils';

@Component({
  selector: 'app-observability-benchmark-detail-page',
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
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0"><PageHeader class="flex min-h-(--layout-topbar-height) items-center justify-between gap-3 px-3"><div><a class="text-xs text-muted-foreground underline" routerLink="/observability/benchmarks">Observability / Benchmarks</a><h1 class="mt-1 text-lg font-semibold text-foreground">Benchmark run detail</h1></div><a Button variant="outline" size="xs" routerLink="/observability/benchmarks" class="gap-1.5"><Icon name="arrow_back" [size]="14" aria-hidden="true" />Back to runs</a></PageHeader><PageContent class="grid min-h-0 content-start gap-5 overflow-auto px-3 py-5">@if (loading()) {<p class="border border-border bg-muted p-5 text-sm" role="status">Loading benchmark run...</p>}@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (run(); as detail) {<section class="grid gap-4 border border-border bg-card p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scenario</p><h2 class="mt-1 text-xl font-semibold text-foreground">{{ detail.scenarioId }} · {{ detail.scenarioVersion }}</h2><p class="mt-1 break-all font-mono text-xs text-muted-foreground">{{ detail.runId }}</p></div><span Badge [variant]="detail.status === 'failed' ? 'destructive' : detail.status === 'completed' ? 'default' : 'secondary'">{{ detail.status }}</span></div><dl class="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><dt class="text-xs text-muted-foreground">Environment</dt><dd class="mt-1">{{ detail.environment }}</dd></div><div><dt class="text-xs text-muted-foreground">Bun version</dt><dd class="mt-1">{{ detail.bunVersion }}</dd></div><div><dt class="text-xs text-muted-foreground">Started</dt><dd class="mt-1">{{ formatDate(detail.startedAt) }}</dd></div><div><dt class="text-xs text-muted-foreground">Finished</dt><dd class="mt-1">{{ detail.finishedAt ? formatDate(detail.finishedAt) : 'Still running' }}</dd></div><div><dt class="text-xs text-muted-foreground">Source commit</dt><dd class="mt-1 break-all font-mono text-xs">{{ detail.sourceCommitSha }}</dd></div><div><dt class="text-xs text-muted-foreground">Completeness</dt><dd class="mt-1">{{ detail.completeness }}</dd></div><div><dt class="text-xs text-muted-foreground">Instrumentation</dt><dd class="mt-1">{{ detail.instrumentationSchemaVersion }}</dd></div><div><dt class="text-xs text-muted-foreground">Threshold policy</dt><dd class="mt-1">{{ detail.thresholdPolicyVersion }}</dd></div></dl></section><section class="grid gap-3" aria-labelledby="comparison-title"><div><h2 id="comparison-title" class="text-base font-semibold text-foreground">Comparisons</h2><p class="text-sm text-muted-foreground">Candidate values and decisions retained with this run.</p></div>@if (detail.comparisons.length === 0) {<p class="border border-border bg-muted p-5 text-sm text-muted-foreground">No comparison rows were retained.</p>} @else {<div class="overflow-auto rounded-base border border-border bg-card"><table class="min-w-full text-left text-sm"><caption class="sr-only">Benchmark comparisons</caption><thead class="border-b border-border text-xs uppercase text-muted-foreground"><tr><th scope="col" class="px-4 py-3">Resource</th><th scope="col" class="px-4 py-3">Metric</th><th scope="col" class="px-4 py-3">Baseline</th><th scope="col" class="px-4 py-3">Candidate</th><th scope="col" class="px-4 py-3">Decision</th></tr></thead><tbody>@for (comparison of detail.comparisons; track comparison.comparisonId) {<tr class="border-b border-border align-top last:border-0"><td class="px-4 py-3">{{ comparison.resourceKind }} · {{ comparison.resourceName }}</td><td class="px-4 py-3">{{ comparison.metricKey }} <span class="text-xs text-muted-foreground">{{ comparison.statistic }} / {{ comparison.unit }}</span></td><td class="px-4 py-3 font-mono">{{ comparison.baselineValue ?? '—' }}</td><td class="px-4 py-3 font-mono">{{ comparison.candidateValue }}</td><td class="px-4 py-3"><span Badge [variant]="comparison.decision === 'fail' ? 'destructive' : comparison.decision === 'pass' ? 'default' : 'secondary'">{{ comparison.decision }}</span></td></tr>}</tbody></table></div>}</section> }</PageContent><PageFooter class="flex min-h-(--layout-topbar-height) items-center justify-between px-3"><p class="text-sm text-muted-foreground">{{ run()?.comparisons?.length ?? 0 }} comparisons</p><span class="text-xs text-muted-foreground">Run evidence is read-only.</span></PageFooter></Page>
  `,
})
export class ObservabilityBenchmarkDetailPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly run = signal<BenchmarkRunDetail | null>(null);
  constructor() {
    const runId = this.route.snapshot.paramMap.get('runId') ?? '';
    this.api.benchmarkRun(runId).subscribe({
      next: (run) => {
        this.run.set(run);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(
          this.status(error) === 404
            ? 'This benchmark run has expired or no longer exists.'
            : loadErrorMessage('observability:benchmark:read', error),
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
