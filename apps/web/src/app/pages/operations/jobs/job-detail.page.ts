import { JsonPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { ApiService, type JobDetail } from '../../../services/api.service';

@Component({
  selector: 'app-job-detail-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    IconComponent,
    JsonPipe,
    PageComponent,
    PageContentComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
  <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0"><PageHeader class="flex min-h-(--layout-topbar-height) items-center justify-between gap-3 px-6"><div><a routerLink="/operations/jobs" class="text-xs text-muted-foreground underline">Operations / Jobs</a><h1 class="mt-1 text-lg font-semibold text-foreground">Job detail</h1></div><button Button size="xs" class="gap-1.5" [disabled]="!job() || job()?.status !== 'failed' || retrying()" (click)="retry()"><Icon name="refresh" [size]="14" aria-hidden="true" />{{ retrying() ? 'Mengirim...' : 'Retry' }}</button></PageHeader><PageContent class="grid content-start gap-5 p-6">@if (error()) { <p class="text-sm text-destructive" role="alert">{{ error() }}</p> } @if (loading()) { <p class="text-sm text-muted-foreground">Memuat detail...</p> } @if (job(); as detail) { <section class="grid gap-3 border border-border bg-card p-5"><div class="grid gap-1"><span class="text-xs uppercase text-muted-foreground">Jenis</span><strong class="font-mono text-sm">{{ detail.type }} @{{ detail.version }}</strong></div><div class="grid gap-1"><span class="text-xs uppercase text-muted-foreground">Status</span><strong class="font-mono text-sm">{{ detail.status }}</strong></div><div class="grid gap-1"><span class="text-xs uppercase text-muted-foreground">Payload aman</span><pre class="overflow-auto bg-muted p-3 text-xs">{{ detail.payload | json }}</pre></div></section><section class="grid gap-3"><h2 class="text-base font-semibold text-foreground">Attempt history</h2>@for (attempt of detail.attempts; track attempt.id) { <article class="grid gap-1 border border-border bg-card p-4 text-sm"><div class="flex flex-wrap justify-between gap-2"><span>Attempt {{ attempt.attemptNumber }} · {{ attempt.outcome }}</span><span class="font-mono text-xs text-muted-foreground">{{ attempt.workerId }}</span></div><p class="text-xs text-muted-foreground">{{ attempt.errorCode ?? 'No error' }} {{ attempt.errorMessage ?? '' }}</p></article> }</section> }</PageContent></Page>
`,
  providers: [],
})
export class JobDetailPage {
  protected readonly layout = inject(LayoutService);
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly job = signal<JobDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly retrying = signal(false);
  protected readonly error = signal<string | null>(null);
  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Job tidak ditemukan.');
      this.loading.set(false);
      return;
    }
    this.api.job(id).subscribe({
      next: (job) => {
        this.job.set(job);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Detail job tidak dapat dimuat.');
        this.loading.set(false);
      },
    });
  }
  protected retry(): void {
    const id = this.job()?.id;
    if (!id) return;
    this.retrying.set(true);
    this.api.retryJob(id, 'Retry manual dari operator').subscribe({
      next: () => this.retrying.set(false),
      error: () => {
        this.error.set('Job tidak dapat di retry.');
        this.retrying.set(false);
      },
    });
  }
}
