import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import {
  PageDashboardComponent,
  PageComponent,
} from '@ojiepermana/angular/theme/page';
import { catchError, forkJoin, of } from 'rxjs';
import {
  ApiService,
  type AuditTrailItem,
  type JobStatus,
  type NotificationCategory,
} from '../../../services/api.service';

const NOTIFICATION_CATEGORIES: Array<{
  key: NotificationCategory;
  label: string;
}> = [
  { key: 'security', label: 'Security' },
  { key: 'access', label: 'Access' },
  { key: 'account', label: 'Account' },
  { key: 'operational', label: 'Operations' },
];

const JOB_STATUSES: Array<{ key: JobStatus; label: string }> = [
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'retry_wait', label: 'Retry wait' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

const EMPTY_NOTIFICATION_COUNTS: Record<NotificationCategory, number> = {
  security: 0,
  access: 0,
  account: 0,
  operational: 0,
};

const EMPTY_JOB_COUNTS: Record<JobStatus, number> = {
  queued: 0,
  running: 0,
  retry_wait: 0,
  completed: 0,
  failed: 0,
};

const UPDATED_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

@Component({
  selector: 'app-dashboard-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    IconComponent,
    PageComponent,
    PageDashboardComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" scroll="content" appearance="flat" [appsLauncher]="false" class="h-full min-h-0">
      <PageDashboard class="grid min-h-0 content-start gap-6 overflow-auto p-6">
        <section class="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Operations console</p>
          <h1 class="mt-1 text-2xl font-semibold text-foreground">Dashboard</h1>
          <p class="mt-1 max-w-2xl text-sm text-muted-foreground">Satu pandangan untuk kesehatan layanan, pekerjaan, akses, dan sinyal workspace.</p>
        </div>
        <button Button variant="outline" size="xs" type="button" [disabled]="loading()" (click)="refresh()">
          <Icon name="refresh" [size]="15" aria-hidden="true" />
          Refresh data
        </button>
        </section>
        <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Operational summary">
          <article class="rounded-base border border-border bg-card p-5 transition-colors hover:border-primary">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm text-muted-foreground">Gateway</p>
              <span class="size-2 rounded-full" [class.bg-primary]="gatewayStatus() === 'Online'" [class.bg-destructive]="gatewayStatus() === 'Unavailable'" [class.animate-pulse]="gatewayStatus() === 'Checking...'" aria-hidden="true"></span>
            </div>
            <p class="mt-4 text-2xl font-semibold text-foreground">{{ gatewayStatus() }}</p>
            <p class="mt-2 text-xs text-muted-foreground">Public API health signal</p>
          </article>

          <a routerLink="/notifications" class="group rounded-base border border-border bg-card p-5 no-underline transition-colors hover:border-primary">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm text-muted-foreground">Unread notifications</p>
              <Icon name="notifications" [size]="18" class="text-primary" aria-hidden="true" />
            </div>
            <p class="mt-4 text-2xl font-semibold text-foreground">{{ unreadTotal() }}</p>
            <p class="mt-2 text-xs text-muted-foreground">Across security, access, and operations</p>
          </a>

          <a routerLink="/operations/jobs" class="group rounded-base border border-border bg-card p-5 no-underline transition-colors hover:border-primary">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm text-muted-foreground">Durable jobs</p>
              <Icon name="sync" [size]="18" class="text-primary" aria-hidden="true" />
            </div>
            <p class="mt-4 text-2xl font-semibold text-foreground">{{ jobsTotal() }}</p>
            <p class="mt-2 text-xs text-muted-foreground">Queued, active, and completed work</p>
          </a>

          <a routerLink="/users" class="group rounded-base border border-border bg-card p-5 no-underline transition-colors hover:border-primary">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm text-muted-foreground">Workspace users</p>
              <Icon name="group" [size]="18" class="text-primary" aria-hidden="true" />
            </div>
            <p class="mt-4 text-2xl font-semibold text-foreground">{{ userTotal() ?? '-' }}</p>
            <p class="mt-2 text-xs text-muted-foreground">Active directory records</p>
          </a>
        </section>

        <section class="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <article class="rounded-base border border-border bg-card p-5">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Live signal map</p>
                <h2 class="mt-2 text-lg font-semibold text-foreground">Operational pulse</h2>
                <p class="mt-1 text-sm text-muted-foreground">Pilih sumber sinyal untuk membaca konsentrasi aktivitas saat ini.</p>
              </div>
              <div class="flex rounded-base border border-border bg-muted p-1" role="group" aria-label="Pulse source">
                <button Button variant="ghost" size="xs" type="button" class="rounded-base" [class.bg-accent]="pulseView() === 'notifications'" [class.text-accent-foreground]="pulseView() === 'notifications'" (click)="pulseView.set('notifications')">Notifications</button>
                <button Button variant="ghost" size="xs" type="button" class="rounded-base" [class.bg-accent]="pulseView() === 'jobs'" [class.text-accent-foreground]="pulseView() === 'jobs'" (click)="pulseView.set('jobs')">Jobs</button>
              </div>
            </div>

            <div class="mt-8 grid gap-4" role="img" [attr.aria-label]="pulseView() === 'notifications' ? 'Unread notifications by category' : 'Jobs by status'">
              @for (bar of pulseBars(); track bar.label) {
                <div class="grid gap-2">
                  <div class="flex items-center justify-between gap-3 text-sm">
                    <span class="text-foreground">{{ bar.label }}</span>
                    <span class="font-mono text-xs text-muted-foreground">{{ bar.value }}</span>
                  </div>
                  <div class="h-2 bg-muted"><div class="h-full bg-primary transition-[width] duration-500" [style.width.%]="barWidth(bar.value)"></div></div>
                </div>
              }
            </div>
            <div class="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
              <span>{{ pulseTotal() }} signals tracked</span>
              <span>Updated {{ updatedAt() ?? 'just now' }}</span>
            </div>
          </article>

          <article class="rounded-base border border-border bg-card p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace map</p>
                <h2 class="mt-2 text-lg font-semibold text-foreground">Quick access</h2>
              </div>
              <Icon name="bolt" [size]="18" class="text-primary" aria-hidden="true" />
            </div>
            <div class="mt-6 grid gap-2">
              <a routerLink="/notifications" class="flex items-center justify-between gap-3 border border-border p-3 text-sm text-foreground no-underline transition-colors hover:border-primary hover:text-primary"><span class="flex items-center gap-2"><Icon name="notifications" [size]="16" aria-hidden="true" />Notification center</span><Icon name="arrow_forward" [size]="16" aria-hidden="true" /></a>
              <a routerLink="/operations/jobs" class="flex items-center justify-between gap-3 border border-border p-3 text-sm text-foreground no-underline transition-colors hover:border-primary hover:text-primary"><span class="flex items-center gap-2"><Icon name="sync" [size]="16" aria-hidden="true" />Durable jobs</span><Icon name="arrow_forward" [size]="16" aria-hidden="true" /></a>
              <a routerLink="/logs/audit" class="flex items-center justify-between gap-3 border border-border p-3 text-sm text-foreground no-underline transition-colors hover:border-primary hover:text-primary"><span class="flex items-center gap-2"><Icon name="history" [size]="16" aria-hidden="true" />Audit trail</span><Icon name="arrow_forward" [size]="16" aria-hidden="true" /></a>
              <a routerLink="/access/permissions" class="flex items-center justify-between gap-3 border border-border p-3 text-sm text-foreground no-underline transition-colors hover:border-primary hover:text-primary"><span class="flex items-center gap-2"><Icon name="key" [size]="16" aria-hidden="true" />Permission catalog</span><Icon name="arrow_forward" [size]="16" aria-hidden="true" /></a>
            </div>
            <p class="mt-5 text-xs text-muted-foreground">{{ permissionTotal() ?? '-' }} permissions available to your workspace.</p>
          </article>
        </section>

        <section class="rounded-base border border-border bg-card p-5" aria-labelledby="recent-signals-title">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Recent signals</p>
              <h2 id="recent-signals-title" class="mt-2 text-lg font-semibold text-foreground">Latest audit activity</h2>
            </div>
            <a routerLink="/logs/audit" class="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">View audit trail</a>
          </div>
          @if (auditRows().length === 0) {
            <p class="mt-6 text-sm text-muted-foreground">Belum ada audit activity.</p>
          } @else {
            <div class="mt-6 grid gap-3 md:grid-cols-2">
              @for (row of auditRows(); track row.id) {
                <a routerLink="/logs/audit" class="grid gap-2 border-l-2 border-primary bg-muted p-4 no-underline transition-colors hover:bg-accent/10">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-xs font-medium uppercase tracking-[0.12em] text-primary">{{ row.module }} · {{ row.action }}</span>
                    <time class="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{{ formatDate(row.auditedAt) }}</time>
                  </div>
                  <p class="text-sm font-medium text-foreground">{{ row.entityLabel ?? row.entityType }}</p>
                  <p class="line-clamp-2 text-xs leading-5 text-muted-foreground">{{ row.changeSummary ?? 'Activity recorded in the audit trail.' }}</p>
                </a>
              }
            </div>
          }
        </section>
      </PageDashboard>
    </Page>
  `,
})
export class DashboardPage {
  private readonly api = inject(ApiService);
  protected readonly loading = signal(true);
  protected readonly gatewayStatus = signal('Checking...');
  protected readonly unreadTotal = signal(0);
  protected readonly unreadCategories = signal<Record<NotificationCategory, number>>({
    ...EMPTY_NOTIFICATION_COUNTS,
  });
  protected readonly jobsTotal = signal(0);
  protected readonly jobCounts = signal<Record<JobStatus, number>>({
    ...EMPTY_JOB_COUNTS,
  });
  protected readonly userTotal = signal<number | null>(null);
  protected readonly permissionTotal = signal<number | null>(null);
  protected readonly auditRows = signal<AuditTrailItem[]>([]);
  protected readonly updatedAt = signal<string | null>(null);
  protected readonly pulseView = signal<'notifications' | 'jobs'>('notifications');

  protected readonly pulseBars = computed(() => {
    if (this.pulseView() === 'notifications') {
      const categories = this.unreadCategories();
      return NOTIFICATION_CATEGORIES.map(({ key, label }) => ({
        label,
        value: categories[key],
      }));
    }

    const jobs = this.jobCounts();
    return JOB_STATUSES.map(({ key, label }) => ({
      label,
      value: jobs[key],
    }));
  });

  protected readonly pulseTotal = computed(() =>
    this.pulseBars().reduce((total, bar) => total + bar.value, 0),
  );

  protected readonly pulseMax = computed(() =>
    Math.max(...this.pulseBars().map((bar) => bar.value), 0),
  );

  constructor() {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);

    forkJoin({
      health: this.api.health().pipe(catchError(() => of(null))),
      notifications: this.api
        .unreadNotificationCount()
        .pipe(catchError(() => of(null))),
      jobs: this.api.jobs({ page: 1, status: '' }).pipe(catchError(() => of(null))),
      users: this.api
        .users({ search: '', status: '', page: 1 })
        .pipe(catchError(() => of(null))),
      permissions: this.api
        .permissions({ search: '', namespace: '', page: 1 })
        .pipe(catchError(() => of(null))),
      audit: this.api
        .auditTrails({ search: '', module: '', action: '', page: 1 })
        .pipe(catchError(() => of(null))),
    }).subscribe((data) => {
      this.gatewayStatus.set(data.health ? 'Online' : 'Unavailable');
      this.unreadTotal.set(data.notifications?.total ?? 0);
      this.unreadCategories.set({
        ...EMPTY_NOTIFICATION_COUNTS,
        ...(data.notifications?.categories ?? {}),
      });
      this.jobsTotal.set(data.jobs?.meta.total ?? 0);

      const jobCounts = { ...EMPTY_JOB_COUNTS };
      for (const job of data.jobs?.data ?? []) {
        jobCounts[job.status] += 1;
      }
      this.jobCounts.set(jobCounts);
      this.userTotal.set(data.users?.meta.total ?? null);
      this.permissionTotal.set(data.permissions?.meta.total ?? null);
      this.auditRows.set(data.audit?.data.slice(0, 4) ?? []);
      this.updatedAt.set(UPDATED_FORMAT.format(new Date()));
      this.loading.set(false);
    });
  }

  protected barWidth(value: number): number {
    const max = this.pulseMax();
    if (max === 0 || value === 0) return 0;

    return Math.max(8, Math.round((value / max) * 100));
  }

  protected formatDate(value: string): string {
    return UPDATED_FORMAT.format(new Date(value));
  }
}
