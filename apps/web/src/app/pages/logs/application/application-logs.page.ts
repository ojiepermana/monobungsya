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
  ApiService,
  type ApplicationLogItem,
  type LogsMeta,
} from '../../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };

@Component({
  selector: 'app-application-logs-page',
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
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Logs</p>
          <h1 class="truncate text-lg font-semibold text-foreground">Application Logs</h1>
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
          placeholder="Cari application log..."
          class="md:max-w-xs"
          [value]="search()"
          (input)="updateSearch($event)"
        />
        <select NativeSelect class="md:w-40" [value]="level()" (change)="updateLevel($event)">
          <option NativeSelectOption value="">Semua level</option>
          @for (option of levels(); track option) {
            <option NativeSelectOption [value]="option" [selected]="option === level()">{{ option }}</option>
          }
        </select>
        <select NativeSelect class="md:w-40" [value]="module()" (change)="updateModule($event)">
          <option NativeSelectOption value="">Semua module</option>
          @for (option of modules(); track option) {
            <option NativeSelectOption [value]="option" [selected]="option === module()">{{ option }}</option>
          }
        </select>
        <select NativeSelect class="md:w-44" [value]="event()" (change)="updateEvent($event)">
          <option NativeSelectOption value="">Semua event</option>
          @for (option of events(); track option) {
            <option NativeSelectOption [value]="option" [selected]="option === event()">{{ option }}</option>
          }
        </select>
        <button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">
          Clear Filters
        </button>
      </PageFilter>

      <PageContent class="grid min-h-0 content-start gap-6 overflow-auto">

      @if (error()) {
        <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat application log...</p>
      } @else if (rows().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada application log.</p>
      } @else {
        <div class="overflow-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-border text-sm uppercase text-muted-foreground">
              <tr>
                <th class="px-4 py-3">Time</th>
                <th class="px-4 py-3">Level</th>
                <th class="px-4 py-3">Event</th>
                <th class="px-4 py-3">Message</th>
                <th class="px-4 py-3">Actor</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr class="border-b border-border align-top last:border-0">
                  <td class="whitespace-nowrap px-4 py-3">{{ formatDate(row.occurredAt) }}</td>
                  <td class="px-4 py-3">
                    <span Badge [variant]="levelVariant(row.level)">{{ row.level }}</span>
                  </td>
                  <td class="px-4 py-3">
                    <p class="font-medium text-foreground">{{ row.event ?? '-' }}</p>
                    <p class="text-xs text-muted-foreground">{{ row.module ?? '-' }} · {{ row.category }}</p>
                  </td>
                  <td class="px-4 py-3 text-muted-foreground">{{ row.message }}</td>
                  <td class="px-4 py-3">{{ row.actorEmail ?? '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
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
export class ApplicationLogsPage {
  private readonly api = inject(ApiService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<ApplicationLogItem[]>([]);
  protected readonly meta = signal<LogsMeta>(EMPTY_META);
  protected readonly filterOpen = signal(false);
  protected readonly search = signal('');
  protected readonly level = signal('');
  protected readonly module = signal('');
  protected readonly event = signal('');
  protected readonly levels = signal<string[]>([]);
  protected readonly modules = signal<string[]>([]);
  protected readonly events = signal<string[]>([]);

  protected readonly pageLabel = computed(() => {
    const meta = this.meta();
    return `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} records`;
  });
  protected readonly hasFilters = computed(
    () =>
      this.search() !== '' ||
      this.level() !== '' ||
      this.module() !== '' ||
      this.event() !== '',
  );

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .applicationLogs({
        search: this.search(),
        level: this.level(),
        module: this.module(),
        event: this.event(),
        page,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.meta.set(response.meta);
          this.levels.set(response.options.levels);
          this.modules.set(response.options.modules);
          this.events.set(response.options.events);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Gagal memuat application log.');
          this.loading.set(false);
        },
      });
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected updateLevel(event: Event): void {
    this.level.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }

  protected updateModule(event: Event): void {
    this.module.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }

  protected updateEvent(event: Event): void {
    this.event.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.level.set('');
    this.module.set('');
    this.event.set('');
    this.load(1);
  }

  protected goTo(page: number): void {
    this.load(page);
  }

  protected formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(iso));
  }

  protected levelVariant(
    level: string,
  ): 'destructive' | 'outline' | 'secondary' {
    if (level === 'error' || level === 'critical') return 'destructive';
    if (level === 'warning' || level === 'warn') return 'outline';
    return 'secondary';
  }
}
