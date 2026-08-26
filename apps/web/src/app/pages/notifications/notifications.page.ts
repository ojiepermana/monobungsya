import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import {
  ApiService,
  type NotificationCategory,
  type NotificationPreference,
  type NotificationRecord,
} from '../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Semua kategori' },
  { value: 'security', label: 'Keamanan' },
  { value: 'access', label: 'Akses' },
  { value: 'account', label: 'Akun' },
  { value: 'operational', label: 'Operasional' },
];

@Component({
  selector: 'app-notifications-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    IconComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layoutAppearance" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex items-center gap-3">
          <Icon name="notifications" [size]="18" class="text-primary" aria-hidden="true" />
          <div>
            <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
            <h1 class="text-lg font-semibold text-foreground">Notifikasi</h1>
          </div>
        </div>
        <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading()" (click)="markAllRead()">
          <Icon name="done_all" [size]="14" aria-hidden="true" />
          Tandai semua dibaca
        </button>
      </PageHeader>

      <PageContent class="grid min-h-0 content-start">
        <div class="flex flex-wrap items-center gap-3 border-b border-border px-3 py-4">
          <select NativeSelect [value]="category()" (change)="changeCategory($event)">
            @for (option of categoryOptions; track option.value) { <option NativeSelectOption [value]="option.value">{{ option.label }}</option> }
          </select>
          <label class="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" [checked]="unreadOnly()" (change)="changeUnread($event)" /> Hanya belum dibaca
          </label>
          <button Button variant="outline" size="xs" type="button" (click)="openPreferences()">Preferensi email</button>
        </div>

        @if (preferencesOpen()) {
          <section class="grid gap-3 border-b border-border bg-card px-3 py-4" aria-labelledby="preference-title">
            <h2 id="preference-title" class="text-sm font-semibold text-foreground">Preferensi notifikasi</h2>
            @if (preferencesLoading()) { <p class="text-sm text-muted-foreground">Memuat preferensi...</p> }
            @for (group of preferences(); track group.category) {
              <div class="flex flex-wrap items-center gap-4 text-sm">
                <span class="w-28 capitalize text-foreground">{{ group.category }}</span>
                @for (preference of group.channels; track preference.channel) {
                  <label class="flex items-center gap-2 text-muted-foreground">
                    <input type="checkbox" [checked]="preference.enabled" [disabled]="preference.mandatory" (change)="changePreference(preference, $event)" />
                    {{ preference.channel === 'email' ? 'Email' : 'Dalam aplikasi' }}
                    @if (preference.mandatory) { <span class="text-xs">wajib</span> }
                  </label>
                }
              </div>
            }
            @if (preferenceError()) { <p class="text-sm text-destructive" role="alert">{{ preferenceError() }}</p> }
          </section>
        }

        @if (error()) { <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p> }
        @if (loading()) { <p class="text-sm text-muted-foreground">Memuat notifikasi...</p> }
        @else if (rows().length === 0) { <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada notifikasi.</p> }
        @else {
          @for (notification of rows(); track notification.id) {
            <article class="grid gap-2 border border-border bg-card p-4" [class.border-l-4]="!notification.readAt" [class.border-l-accent]="!notification.readAt">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{{ notification.category }} · {{ notification.severity }}</p>
                  <h2 class="mt-1 text-base font-semibold text-foreground">{{ notification.title }}</h2>
                </div>
                @if (!notification.readAt) { <button Button variant="outline" size="xs" type="button" (click)="markRead(notification)">Tandai dibaca</button> }
              </div>
              <p class="text-sm leading-6 text-muted-foreground">{{ notification.body }}</p>
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <time [attr.datetime]="notification.createdAt">{{ formatDate(notification.createdAt) }}</time>
                @if (notification.actionRoute) { <a class="underline underline-offset-4" [routerLink]="notification.actionRoute">Buka terkait</a> }
              </div>
            </article>
          }
        }
      </PageContent>
      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">Halaman {{ meta().page }} dari {{ pageCount() }} · {{ meta().total }} notifikasi</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page <= 1" (click)="load(meta().page - 1)"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Sebelumnya</button>
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page >= meta().totalPages" (click)="load(meta().page + 1)"><Icon name="chevron_right" [size]="14" aria-hidden="true" />Berikutnya</button>
        </div>
      </PageFooter>
    </Page>
  `,
})
export class NotificationsPage {
  private readonly api = inject(ApiService);
  protected readonly layoutAppearance = 'flat' as const;
  protected readonly categoryOptions = CATEGORIES;
  protected readonly category = signal('');
  protected readonly unreadOnly = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<NotificationRecord[]>([]);
  protected readonly meta = signal({
    page: 1,
    perPage: 25,
    total: 0,
    totalPages: 0,
  });
  protected readonly preferencesOpen = signal(false);
  protected readonly preferencesLoading = signal(false);
  protected readonly preferenceError = signal<string | null>(null);
  protected readonly preferences = signal<
    Array<{
      category: NotificationCategory;
      channels: NotificationPreference[];
    }>
  >([]);
  protected readonly hasNext = computed(
    () => this.meta().page < this.meta().totalPages,
  );
  protected readonly pageCount = computed(() =>
    Math.max(this.meta().totalPages, 1),
  );

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .notifications({
        page,
        category: this.category(),
        unreadOnly: this.unreadOnly(),
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.meta.set(response.meta);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Notifikasi tidak dapat dimuat. Coba lagi.');
          this.loading.set(false);
        },
      });
  }
  protected changeCategory(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value);
    this.load(1);
  }
  protected changeUnread(event: Event): void {
    this.unreadOnly.set((event.target as HTMLInputElement).checked);
    this.load(1);
  }
  protected markRead(notification: NotificationRecord): void {
    this.api.markNotificationRead(notification.id).subscribe({
      next: (updated) =>
        this.rows.update((rows) =>
          rows.map((row) => (row.id === updated.id ? updated : row)),
        ),
    });
  }
  protected markAllRead(): void {
    this.api
      .markAllNotificationsRead()
      .subscribe({ next: () => this.load(this.meta().page) });
  }
  protected formatDate(value: string): string {
    return DATE_FORMAT.format(new Date(value));
  }
  protected changePreference(
    preference: NotificationPreference,
    event: Event,
  ): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.api
      .updateNotificationPreference(
        preference.category,
        preference.channel,
        enabled,
      )
      .subscribe({
        next: (updated) =>
          this.preferences.update((groups) =>
            groups.map((group) =>
              group.category === updated.category
                ? {
                    ...group,
                    channels: group.channels.map((item) =>
                      item.channel === updated.channel ? updated : item,
                    ),
                  }
                : group,
            ),
          ),
        error: () => {
          this.preferenceError.set(
            'Preferensi wajib tidak dapat dinonaktifkan.',
          );
        },
      });
  }
  protected openPreferences(): void {
    this.preferencesOpen.set(true);
    this.preferencesLoading.set(true);
    this.preferenceError.set(null);
    this.api.notificationPreferences().subscribe({
      next: (response) => {
        this.preferences.set(response.categories);
        this.preferencesLoading.set(false);
      },
      error: () => {
        this.preferenceError.set('Preferensi tidak dapat dimuat.');
        this.preferencesLoading.set(false);
      },
    });
  }
}
