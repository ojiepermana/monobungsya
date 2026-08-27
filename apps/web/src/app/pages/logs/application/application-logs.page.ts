import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import { PaginationComponent } from '../../../shared/pagination/pagination.component';
import { pageFromQuery } from '../../../shared/pagination/pagination-state';
import {
  defaultTimeWindow,
  inputValue,
  isExpiredCursorError,
  isoFromLocalDateTime,
  localDateTimeValue,
  trim,
  WINDOW_PRESETS,
} from '../../observability/observability.utils';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };
const SIGNAL_LOG_MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1_000;

function validateSignalLogRange(from: string, to: string): string | null {
  const fromTime = new Date(from).getTime();
  const toTime = new Date(to).getTime();
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    fromTime >= toTime
  ) {
    return 'Pilih rentang waktu yang valid.';
  }
  if (toTime - fromTime > SIGNAL_LOG_MAX_RANGE_MS) {
    return 'Rentang waktu log tidak boleh lebih dari 30 hari.';
  }
  if (toTime > Date.now() + 5 * 60 * 1_000) {
    return 'Waktu akhir tidak boleh lebih dari lima menit di masa depan.';
  }
  return null;
}

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
    PaginationComponent,
  ],
  template: `
    <Page variant="stacked" scroll="content" appearance="flat" [appsLauncher]="false" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <Icon name="terminal" [size]="18" class="shrink-0 text-primary" aria-hidden="true" />
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
        <label class="grid gap-1 text-xs text-muted-foreground">Rentang cepat
          <select NativeSelect [value]="preset()" (change)="setPreset(inputValue($event))">
            <option NativeSelectOption value="custom">Kustom</option>
            @for (option of presets; track option.value) {
              <option NativeSelectOption [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">Dari
          <input Input type="datetime-local" [value]="fromLocal()" (change)="setFrom(inputValue($event))" />
        </label>
        <label class="grid gap-1 text-xs text-muted-foreground">Sampai
          <input Input type="datetime-local" [value]="toLocal()" (change)="setTo(inputValue($event))" />
        </label>
        <button Button size="xs" type="button" (click)="applyFilters()">Terapkan filter</button>
        <button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">
          Clear Filters
        </button>
      </PageFilter>

      <PageContent class="grid min-h-0 content-start overflow-auto">

      @if (expiredNotice()) {
        <p class="border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">Cursor log ini sudah kedaluwarsa. Halaman pertama dimuat ulang dengan filter yang sama.</p>
      }
      @if (storageWarning()) {
        <p class="border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">
          Penyimpanan signal tidak tersedia.
          @if (blindSpotSince(); as since) {
            Blind spot sejak <time [attr.datetime]="since">{{ formatDate(since) }}</time> hingga sekarang.
          } @else {
            Blind spot sejak waktu yang belum diketahui hingga sekarang.
          }
          Tampilan ini adalah blind spot, bukan hasil kosong.
        </p>
      }
      @if (error()) {
        <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat application log...</p>
      } @else if (rows().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">{{ storageWarning() ? 'Application log tidak dapat dibaca untuk rentang ini.' : 'Belum ada application log.' }}</p>
      } @else {
          <table class="min-w-full rounded-base bg-card text-left text-xs">
            <thead class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground">
              <tr>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Time</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Level</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Event</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Message</th>
                <th class="bg-card px-4 py-3 shadow-[inset_0_-1px_0_0_var(--color-border)]">Actor</th>
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
      }

      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">{{ pageLabel() }}</p>
        <div class="flex items-center gap-2">
          @if (cursorPagination()) {
            <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || !prevCursor()" (click)="goToCursor(prevCursor())"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button>
            <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || !nextCursor()" (click)="goToCursor(nextCursor())">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button>
          } @else {
            <app-pagination
              [page]="meta().page"
              [totalPages]="meta().totalPages"
              [loading]="loading()"
              (pageChange)="goToPage($event)"
            />
          }
        </div>
      </PageFooter>
    </Page>
  `,
})
export class ApplicationLogsPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<ApplicationLogItem[]>([]);
  protected readonly meta = signal<LogsMeta>(EMPTY_META);
  protected readonly cursorPagination = signal(false);
  protected readonly cursor = signal<string | null>(null);
  protected readonly prevCursor = signal<string | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly storageWarning = signal(false);
  protected readonly blindSpotSince = signal<string | null>(null);
  protected readonly expiredNotice = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly search = signal('');
  protected readonly level = signal('');
  protected readonly module = signal('');
  protected readonly event = signal('');
  protected readonly from = signal(defaultTimeWindow().from);
  protected readonly to = signal(defaultTimeWindow().to);
  protected readonly preset = signal('24h');
  protected readonly page = signal(1);
  protected readonly levels = signal<string[]>([]);
  protected readonly modules = signal<string[]>([]);
  protected readonly events = signal<string[]>([]);
  protected readonly presets = WINDOW_PRESETS;

  protected readonly fromLocal = computed(() =>
    localDateTimeValue(this.from()),
  );
  protected readonly toLocal = computed(() => localDateTimeValue(this.to()));

  protected readonly pageLabel = computed(() => {
    if (this.cursorPagination()) {
      return `${this.rows().length} baris di halaman ini`;
    }
    const meta = this.meta();
    return `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} records`;
  });
  protected readonly hasFilters = computed(
    () =>
      this.search() !== '' ||
      this.level() !== '' ||
      this.module() !== '' ||
      this.event() !== '' ||
      this.preset() !== '24h',
  );

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const defaults = defaultTimeWindow();
    this.from.set(query.get('from') ?? defaults.from);
    this.to.set(query.get('to') ?? defaults.to);
    this.search.set(query.get('search') ?? '');
    this.level.set(query.get('level') ?? '');
    this.module.set(query.get('module') ?? '');
    this.event.set(query.get('event') ?? '');
    const preset =
      query.get('preset') ??
      (query.get('from') || query.get('to') ? 'custom' : '24h');
    this.preset.set(
      preset === 'custom' ||
        this.presets.some((option) => option.value === preset)
        ? preset
        : '24h',
    );
    this.cursor.set(query.get('cursor'));
    this.page.set(pageFromQuery(query.get('page')));
    this.applyUrl();
    this.load();
  }

  protected applyFilters(): void {
    this.cursor.set(null);
    this.page.set(1);
    this.expiredNotice.set(false);
    this.applyUrl();
    this.load();
  }

  protected setPreset(value: string): void {
    const preset = this.presets.find((option) => option.value === value);
    if (!preset) {
      this.preset.set('custom');
      return;
    }
    const to = new Date();
    this.to.set(to.toISOString());
    this.from.set(new Date(to.getTime() - preset.milliseconds).toISOString());
    this.preset.set(value);
  }

  protected setFrom(value: string): void {
    this.from.set(isoFromLocalDateTime(value));
    this.preset.set('custom');
  }

  protected setTo(value: string): void {
    this.to.set(isoFromLocalDateTime(value));
    this.preset.set('custom');
  }

  protected inputValue = inputValue;

  private load(): void {
    const validation = validateSignalLogRange(this.from(), this.to());
    if (validation) {
      this.error.set(validation);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.storageWarning.set(false);
    this.blindSpotSince.set(null);
    this.api
      .applicationLogs({
        search: trim(this.search()) ?? '',
        level: trim(this.level()) ?? '',
        module: trim(this.module()) ?? '',
        event: trim(this.event()) ?? '',
        page: this.page(),
        from: this.from(),
        to: this.to(),
        cursor: this.cursor() ?? undefined,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.levels.set(response.options.levels);
          this.modules.set(response.options.modules);
          this.events.set(response.options.events);
          if ('meta' in response) {
            this.meta.set(response.meta);
            this.cursorPagination.set(false);
            this.cursor.set(null);
            this.prevCursor.set(null);
            this.nextCursor.set(null);
          } else {
            this.cursorPagination.set(true);
            this.page.set(1);
            this.prevCursor.set(response.prevCursor);
            this.nextCursor.set(response.nextCursor);
            this.storageWarning.set(response.storageStatus === 'blind_spot');
            this.blindSpotSince.set(response.blindSpotSince);
          }
          this.applyUrl();
          this.loading.set(false);
        },
        error: (error: unknown) => {
          if (this.cursor() && isExpiredCursorError(error)) {
            this.cursor.set(null);
            this.page.set(1);
            this.expiredNotice.set(true);
            this.applyUrl();
            this.load();
            return;
          }
          this.error.set('Gagal memuat application log.');
          this.loading.set(false);
        },
      });
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.applyFilters();
  }

  protected updateLevel(event: Event): void {
    this.level.set((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  protected updateModule(event: Event): void {
    this.module.set((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  protected updateEvent(event: Event): void {
    this.event.set((event.target as HTMLSelectElement).value);
    this.applyFilters();
  }

  protected clearFilters(): void {
    const defaults = defaultTimeWindow();
    this.search.set('');
    this.level.set('');
    this.module.set('');
    this.event.set('');
    this.from.set(defaults.from);
    this.to.set(defaults.to);
    this.preset.set('24h');
    this.applyFilters();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.cursor.set(null);
    this.applyUrl();
    this.load();
  }

  protected goToCursor(cursor: string | null): void {
    if (!cursor) return;
    this.cursor.set(cursor);
    this.applyUrl();
    this.load();
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

  private applyUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        from: this.from(),
        to: this.to(),
        preset: this.preset(),
        search: trim(this.search()) ?? null,
        level: trim(this.level()) ?? null,
        module: trim(this.module()) ?? null,
        event: trim(this.event()) ?? null,
        cursor: this.cursor() ?? null,
        page: !this.cursorPagination() && this.page() > 1 ? this.page() : null,
      },
    });
  }
}
