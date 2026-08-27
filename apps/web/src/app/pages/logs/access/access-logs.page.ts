import { Component, computed, inject, signal } from '@angular/core';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
import {
  PageComponent,
  PageContentComponent,
  PageFilterComponent,
  PageFilterToggleComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import {
  type AccessLogItem,
  ApiService,
  type LogsMeta,
} from '../../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };

@Component({
  selector: 'app-access-logs-page',
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
    <Page variant="stacked" scroll="content" appearance="flat" [appsLauncher]="false" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <Icon name="login" [size]="18" class="shrink-0 text-primary" aria-hidden="true" />
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Logs</p>
          <h1 class="truncate text-lg font-semibold text-foreground">Access Logs</h1>
        </div>
        <PageFilterToggle
          ariaLabel="Tampilkan atau sembunyikan filter"
          (toggled)="filterOpen.set($event)"
        >
          <Icon name="filter_list" [size]="14" aria-hidden="true" />
          <span>Filter</span>
        </PageFilterToggle>
      </PageHeader>

      <PageFilter
        placement="stacked"
        collapsible
        [hidden]="!filterOpen()"
        class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-center"
      >
        <input
          Input
          type="search"
          placeholder="Cari access log..."
          class="md:max-w-xs"
          [value]="search()"
          (input)="updateSearch($event)"
        />
        <select NativeSelect class="md:w-44" [value]="event()" (change)="updateEvent($event)">
          <option NativeSelectOption value="">Semua event</option>
          @for (option of events(); track option) {
            <option NativeSelectOption [value]="option" [selected]="option === event()">{{ option }}</option>
          }
        </select>
        <select NativeSelect class="md:w-44" [value]="outcome()" (change)="updateOutcome($event)">
          <option NativeSelectOption value="">Semua outcome</option>
          @for (option of outcomes(); track option) {
            <option NativeSelectOption [value]="option" [selected]="option === outcome()">{{ option }}</option>
          }
        </select>
        <input
          Input
          type="search"
          placeholder="Trace ID..."
          class="md:max-w-xs"
          [value]="traceId()"
          (input)="updateTraceId($event)"
        />
        <button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">
          Clear Filters
        </button>
      </PageFilter>

      <PageContent class="grid min-h-0 content-start overflow-auto">

      @if (error()) {
        <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat access log...</p>
      } @else if (rows().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada access log.</p>
      } @else {
          <table class="min-w-full rounded-base bg-card text-left text-xs">
            <thead class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground">
              <tr>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Time</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Event</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Outcome</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Route</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Method</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Status</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Request ID</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Client Flow</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Session</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Actor</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Reason</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track $index) {
                <tr class="border-b border-border align-top last:border-0">
                  <td class="whitespace-nowrap px-4 py-3">{{ formatDate(row.accessedAt) }}</td>
                  <td class="px-4 py-3">
                    <span Badge variant="secondary">{{ row.event }}</span>
                  </td>
                  <td class="px-4 py-3" [class.text-destructive]="row.outcome !== 'success'">{{ row.outcome }}</td>
                  <td class="px-4 py-3">
                    <p class="font-medium">{{ row.routeName ?? '-' }}</p>
                    <p class="mt-1 font-mono text-xs text-muted-foreground">{{ row.path ?? '-' }}</p>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs">{{ row.method ?? '-' }}</td>
                  <td class="px-4 py-3 font-mono text-xs">{{ row.httpStatus ?? '-' }}</td>
                  <td class="px-4 py-3 font-mono text-xs">{{ row.requestId ?? '-' }}</td>
                  <td class="px-4 py-3 text-xs">
                    @if (row.clientRoute || row.traceId) {
                      <p>{{ row.clientRoute ?? '-' }}</p>
                      <button
                        type="button"
                        class="mt-1 inline-flex items-center gap-1.5 font-mono text-left text-primary underline"
                        [attr.aria-label]="'Filter trace ' + (row.traceId ?? '')"
                        (click)="filterTrace(row.traceId)"
                      >
                        <Icon name="filter_alt" [size]="14" aria-hidden="true" />{{ row.traceId ?? '-' }}
                      </button>
                      @if (row.traceSource === 'client_header') {
                        <p class="mt-1 text-muted-foreground">client supplied</p>
                      }
                    } @else {
                      <span>-</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-xs">
                    @if (row.sessionSummary) {
                      <p>{{ row.sessionId ?? '-' }} · {{ row.sessionSummary.state }}</p>
                      <p>{{ row.sessionSummary.permissionCount }} permissions</p>
                      <p>{{ row.sessionSummary.reason ?? '-' }}</p>
                    } @else {
                      <span>-</span>
                    }
                  </td>
                  <td class="px-4 py-3">{{ row.actorEmail ?? '-' }}</td>
                  <td class="px-4 py-3 text-muted-foreground">{{ row.failureReason ?? '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
      }

      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">{{ pageLabel() }}</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page <= 1" (click)="goTo(1)"><Icon name="first_page" [size]="14" aria-hidden="true" />First</button>
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page <= 1" (click)="goTo(meta().page - 1)"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button>
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page >= meta().totalPages" (click)="goTo(meta().page + 1)"><Icon name="chevron_right" [size]="14" aria-hidden="true" />Next</button>
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page >= meta().totalPages" (click)="goTo(meta().totalPages)"><Icon name="last_page" [size]="14" aria-hidden="true" />Last</button>
        </div>
      </PageFooter>
    </Page>
  `,
})
export class AccessLogsPage {
  private readonly api = inject(ApiService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<AccessLogItem[]>([]);
  protected readonly meta = signal<LogsMeta>(EMPTY_META);
  protected readonly filterOpen = signal(false);
  protected readonly search = signal('');
  protected readonly event = signal('');
  protected readonly outcome = signal('');
  protected readonly traceId = signal('');
  protected readonly events = signal<string[]>([]);
  protected readonly outcomes = signal<string[]>([]);

  protected readonly pageLabel = computed(() => {
    const meta = this.meta();
    return `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} records`;
  });
  protected readonly hasFilters = computed(
    () =>
      this.search() !== '' ||
      this.event() !== '' ||
      this.outcome() !== '' ||
      this.traceId() !== '',
  );

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .accessLogs({
        search: this.search(),
        event: this.event(),
        outcome: this.outcome(),
        traceId: this.traceId(),
        page,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.meta.set(response.meta);
          this.events.set(response.options.events);
          this.outcomes.set(response.options.outcomes);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Gagal memuat access log.');
          this.loading.set(false);
        },
      });
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected updateEvent(event: Event): void {
    this.event.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }

  protected updateOutcome(event: Event): void {
    this.outcome.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }

  protected updateTraceId(event: Event): void {
    this.traceId.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected filterTrace(traceId: string | null): void {
    this.traceId.set(traceId ?? '');
    this.load(1);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.event.set('');
    this.outcome.set('');
    this.traceId.set('');
    this.load(1);
  }

  protected goTo(page: number): void {
    this.load(page);
  }

  protected formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(iso));
  }
}
