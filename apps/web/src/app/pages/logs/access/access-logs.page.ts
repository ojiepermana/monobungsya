import { Component, computed, inject, signal } from '@angular/core';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
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
    InputComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
  ],
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Logs</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Access Logs</h1>
      </header>

      <section class="grid gap-3 md:flex md:flex-wrap md:items-center">
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
        <button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">
          Clear Filters
        </button>
      </section>

      @if (error()) {
        <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat access log...</p>
      } @else if (rows().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada access log.</p>
      } @else {
        <div class="overflow-auto border border-border bg-card">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th class="px-4 py-3">Time</th>
                <th class="px-4 py-3">Event</th>
                <th class="px-4 py-3">Outcome</th>
                <th class="px-4 py-3">Route</th>
                <th class="px-4 py-3">Method</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Request ID</th>
                <th class="px-4 py-3">Actor</th>
                <th class="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track $index) {
                <tr class="border-b border-border align-top last:border-0">
                  <td class="whitespace-nowrap px-4 py-3 font-mono text-xs">{{ formatDate(row.accessedAt) }}</td>
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
                  <td class="px-4 py-3">{{ row.actorEmail ?? '-' }}</td>
                  <td class="px-4 py-3 text-muted-foreground">{{ row.failureReason ?? '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <footer class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">{{ pageLabel() }}</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page <= 1" (click)="goTo(1)">First</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page <= 1" (click)="goTo(meta().page - 1)">Previous</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page >= meta().totalPages" (click)="goTo(meta().page + 1)">Next</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page >= meta().totalPages" (click)="goTo(meta().totalPages)">Last</button>
        </div>
      </footer>
    </main>
  `,
})
export class AccessLogsPage {
  private readonly api = inject(ApiService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<AccessLogItem[]>([]);
  protected readonly meta = signal<LogsMeta>(EMPTY_META);
  protected readonly search = signal('');
  protected readonly event = signal('');
  protected readonly outcome = signal('');
  protected readonly events = signal<string[]>([]);
  protected readonly outcomes = signal<string[]>([]);

  protected readonly pageLabel = computed(() => {
    const meta = this.meta();
    return `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} records`;
  });
  protected readonly hasFilters = computed(
    () => this.search() !== '' || this.event() !== '' || this.outcome() !== '',
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

  protected clearFilters(): void {
    this.search.set('');
    this.event.set('');
    this.outcome.set('');
    this.load(1);
  }

  protected goTo(page: number): void {
    this.load(page);
  }

  protected formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(iso));
  }
}
