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
import type {
  RuntimeTraceDetail,
  RuntimeTraceSpan,
} from '../../../services/api.service';
import { ApiService } from '../../../services/api.service';
import {
  formatDate,
  loadErrorMessage,
  waterfallDepths,
} from '../observability.utils';

@Component({
  selector: 'app-observability-trace-detail-page',
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
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0"><PageHeader class="flex min-h-(--layout-topbar-height) items-center justify-between gap-3 px-3"><div><a class="text-xs text-muted-foreground underline" routerLink="/observability/traces">Observability / Traces</a><h1 class="mt-1 text-lg font-semibold text-foreground">Trace detail</h1></div><a Button variant="outline" size="xs" routerLink="/observability/traces" class="gap-1.5"><Icon name="arrow_back" [size]="14" aria-hidden="true" />Back to traces</a></PageHeader><PageContent class="grid min-h-0 content-start gap-5 overflow-auto px-3 py-5">@if (loading()) {<p class="border border-border bg-muted p-5 text-sm" role="status">Loading trace...</p>}@if (error()) {<p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground" role="alert">{{ error() }}</p>}@if (detail(); as trace) {<section class="grid gap-3 border border-border bg-card p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs uppercase tracking-[0.18em] text-muted-foreground">Trace ID</p><p class="mt-1 break-all font-mono text-sm">{{ trace.traceId }}</p></div><span Badge [variant]="trace.completeness === 'complete' ? 'default' : 'secondary'">{{ trace.completeness === 'complete' ? 'Complete tree' : 'Partial tree' }}</span></div>@if (trace.storageStatus === 'blind_spot') {<p class="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">Telemetry storage is unavailable. This trace is a blind spot.</p>}<p class="text-sm text-muted-foreground">Sampling reasons: {{ trace.samplingReasons.join(', ') || 'not recorded' }}. Orphan roots: {{ trace.orphanRoots.length }}.</p></section><section class="grid gap-3" aria-labelledby="waterfall-title"><div><h2 id="waterfall-title" class="text-base font-semibold text-foreground">Span waterfall</h2><p class="text-sm text-muted-foreground">Bars are scaled to the trace window. Orphan spans start at depth 0.</p></div><div class="grid gap-2 rounded-base border border-border bg-card p-4">@for (span of trace.spans; track span.spanId) {<article class="grid gap-1" [style.margin-left.px]="depth(span) * 20"><div class="flex flex-wrap items-center justify-between gap-2 text-sm"><span class="font-medium">{{ span.serviceName }} / {{ span.operation }}</span><span class="font-mono text-xs text-muted-foreground">{{ Number(span.durationMs).toFixed(2) }} ms · {{ span.status }}</span></div><div class="relative h-6 rounded bg-muted" [attr.aria-label]="barLabel(span)"><div class="absolute inset-y-0 rounded bg-primary" [style.left.%]="barLeft(span)" [style.width.%]="barWidth(span)"></div></div><p class="text-xs text-muted-foreground">{{ span.resourceKind }} · {{ span.resourceName }} · {{ formatDate(span.startedAt) }}@if (span.orphan) { · orphan root}@if (trace.completeness === 'partial') { · partial trace}</p><p class="sr-only">{{ barLabel(span) }}</p></article>} @empty {<p class="text-sm text-muted-foreground">No spans were retained for this trace.</p>}</div></section> }</PageContent><PageFooter class="flex min-h-(--layout-topbar-height) items-center justify-between px-3"><p class="text-sm text-muted-foreground">{{ detail()?.spans?.length ?? 0 }} spans</p><span class="text-xs text-muted-foreground">Waterfall text is available to screen readers.</span></PageFooter></Page>
  `,
})
export class ObservabilityTraceDetailPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detail = signal<RuntimeTraceDetail | null>(null);
  protected readonly depths = signal<Map<string, number>>(new Map());
  protected readonly Number = Number;

  constructor() {
    this.load();
  }
  protected formatDate = formatDate;
  protected depth(span: RuntimeTraceSpan): number {
    return this.depths().get(span.spanId) ?? 0;
  }
  protected barLeft(span: RuntimeTraceSpan): number {
    const spans = this.detail()?.spans ?? [];
    const start = Math.min(
      ...spans.map((item) => new Date(item.startedAt).getTime()),
      new Date(span.startedAt).getTime(),
    );
    const end = Math.max(
      ...spans.map((item) => new Date(item.finishedAt).getTime()),
      new Date(span.finishedAt).getTime(),
    );
    return (
      ((new Date(span.startedAt).getTime() - start) /
        Math.max(end - start, 1)) *
      100
    );
  }
  protected barWidth(span: RuntimeTraceSpan): number {
    const spans = this.detail()?.spans ?? [];
    const start = Math.min(
      ...spans.map((item) => new Date(item.startedAt).getTime()),
      new Date(span.startedAt).getTime(),
    );
    const end = Math.max(
      ...spans.map((item) => new Date(item.finishedAt).getTime()),
      new Date(span.finishedAt).getTime(),
    );
    return Math.max(
      1,
      (Number(span.durationMs) / Math.max(end - start, 1)) * 100,
    );
  }
  protected barLabel(span: RuntimeTraceSpan): string {
    return `${span.serviceName} ${span.operation}, started ${formatDate(span.startedAt)}, duration ${Number(span.durationMs).toFixed(2)} milliseconds${span.orphan ? ', orphan root' : ''}${this.detail()?.completeness === 'partial' ? ', partial trace' : ''}`;
  }
  private load(): void {
    const traceId = this.route.snapshot.paramMap.get('traceId') ?? '';
    this.api.runtimeTrace(traceId).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.depths.set(waterfallDepths(detail.spans));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(
          this.status(error) === 404
            ? 'This trace has expired or no longer exists.'
            : loadErrorMessage('observability:trace:read', error),
        );
        this.loading.set(false);
      },
    });
  }
  private status(error: unknown): number {
    return typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  }
}
