import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { THEME_SETTINGS_ADAPTER } from '@ojiepermana/angular/theme/component/settings';
import { LayoutLoadingComponent } from '@ojiepermana/angular/theme/layout';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  type BrandIdentity,
  LayoutWrapperDefault,
  type UserIdentity,
} from '@ojiepermana/angular/theme/layout/wrapper';
import { ShellComponent, ShellService } from '@ojiepermana/angular/theme/shell';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { TauriService } from './desktop/tauri.service';
import { ApiService, type NotificationRecord } from './services/api.service';
import { APP_BRAND_ICON, appNavigationFor } from './shell/app.nav';
import { UiLabelLocalizationService } from './shell/ui-label-localization.service';

@Component({
  selector: 'app-root',
  host: { class: 'contents' },
  imports: [
    RouterOutlet,
    RouterLink,
    LayoutWrapperDefault,
    LayoutLoadingComponent,
    ShellComponent,
    IconComponent,
  ],
  template: `
    <Shell
      navigationFlyoutIcon="apps"
      barAriaLabel="Monobungsya window controls"
    >
      <span shellBarTitle class="inline-flex items-center gap-2">
        <Icon [name]="appBrandIcon" [size]="16" aria-hidden="true" />
        <span>Monobungsya</span>
        @if (auth.sessionState() === 'authenticated') {
          <span class="relative ml-3">
            <button type="button" class="inline-flex min-h-9 items-center gap-1 border border-border px-2 text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Buka notifikasi" (click)="toggleNotifications()">
              <Icon name="notifications" [size]="16" aria-hidden="true" />
              @if (unreadCount() > 0) { <span class="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">{{ unreadCount() }}</span> }
            </button>
            @if (bellOpen()) {
              <div class="absolute left-0 top-11 z-50 grid w-80 gap-2 border border-border bg-card p-3 text-left shadow-lg">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-foreground">Notifikasi terbaru</p>
                  <a [routerLink]="['/notifications']" class="text-xs text-muted-foreground underline">Lihat semua</a>
                </div>
                @for (notification of latestNotifications(); track notification.id) {
                  <a [routerLink]="['/notifications']" class="grid gap-1 border-t border-border pt-2 text-xs" (click)="bellOpen.set(false)">
                    <span class="font-medium text-foreground">{{ notification.title }}</span>
                    <span class="line-clamp-2 text-muted-foreground">{{ notification.body }}</span>
                  </a>
                } @empty { <p class="border-t border-border pt-2 text-xs text-muted-foreground">Belum ada notifikasi.</p> }
              </div>
            }
          </span>
        }
      </span>
      <LayoutLoading />
      <LayoutWrapperDefault
        [data]="nav()"
        [brand]="brand"
        [user]="user()"
        [nav-type]="themeSettings.navType()"
        [nav-type-mode]="themeSettings.navTypeMode()"
        [layout-type]="effectiveLayoutType()"
        [surface]="layout.surface()"
        [layout-appearance]="layout.appearance()"
        [width]="layout.width()"
        [content-class]="contentClass()"
        (logout)="logout()"
      >
        @if (auth.sessionState() === 'checking') {
          <section class="grid h-full place-items-center p-6" aria-live="polite">
            <p class="text-sm text-muted-foreground">Checking workspace session...</p>
          </section>
        } @else if (auth.sessionState() === 'service-error') {
          <section class="grid h-full place-items-center p-6" aria-labelledby="session-error-title">
            <div class="w-full max-w-md border border-destructive/40 bg-card p-6 shadow-sm">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-destructive">Service unavailable</p>
              <h1 id="session-error-title" class="mt-3 text-xl font-semibold text-foreground">We could not check your session.</h1>
              <p class="mt-3 text-sm leading-6 text-muted-foreground">Check your connection and try again. No sign-in data was changed.</p>
              <button type="button" class="mt-6 inline-flex min-h-11 items-center justify-center border border-border bg-foreground px-4 text-sm font-semibold text-background hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" (click)="retrySession()">Try again</button>
            </div>
          </section>
        } @else {
          <router-outlet />
        }
      </LayoutWrapperDefault>
    </Shell>
  `,
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly labels = inject(UiLabelLocalizationService);
  protected readonly themeSettings = inject(THEME_SETTINGS_ADAPTER);
  private readonly tauri = inject(TauriService);
  protected readonly layout = inject(LayoutService);
  protected readonly shell = inject(ShellService);
  private readonly api = inject(ApiService);
  protected readonly unreadCount = signal(0);
  protected readonly latestNotifications = signal<NotificationRecord[]>([]);
  protected readonly bellOpen = signal(false);

  protected readonly brand: BrandIdentity = {
    name: 'PT MONOBUNGSYA',
    icon: APP_BRAND_ICON,
    title: 'PT MONOBUNGSYA',
    subtitle: 'Enterprise Operations',
  };

  protected readonly appBrandIcon = APP_BRAND_ICON;
  private readonly lastAuthenticatedLayoutType = signal(this.layout.type());
  private readonly restoreAuthenticatedLayout = signal(true);

  protected readonly contentClass = computed(() =>
    this.isGuestRoute() ? 'h-full min-h-0 max-w-none!' : 'h-full min-h-0',
  );

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly user = computed<UserIdentity>(() => {
    const current = this.auth.user();

    return {
      name: current?.name ?? 'Guest',
      email: current?.email ?? '',
    };
  });

  protected readonly nav = computed(() =>
    appNavigationFor(this.auth.user()?.permissions ?? []),
  );

  protected readonly isGuestRoute = computed(() => {
    const url = this.currentUrl().split('?')[0];

    return new Set([
      '/login',
      '/verify',
      '/auth/login',
      '/auth/callback-complete',
      '/auth/callback-error',
      '/auth/two-factor',
      '/auth/two-factor/enroll',
    ]).has(url);
  });

  protected readonly effectiveLayoutType = computed(() => {
    const sessionState = this.auth.sessionState();

    return this.isGuestRoute() || sessionState !== 'authenticated'
      ? 'fluid'
      : this.lastAuthenticatedLayoutType();
  });

  constructor() {
    this.labels.start();
    effect(() => {
      const sessionState = this.auth.sessionState();
      const onGuestRoute = this.isGuestRoute();

      // Guest routes render LayoutFluid, whose constructor writes 'fluid' into
      // the shared LayoutService, and this effect can run before the wrapper
      // swaps the layout back on re-entry. Layout state is only trustworthy
      // while authenticated on a workspace route; anywhere else, re-arm the
      // restore so every return re-asserts the operator's saved choice.
      if (sessionState !== 'authenticated' || onGuestRoute) {
        this.restoreAuthenticatedLayout.set(true);
        return;
      }

      if (this.restoreAuthenticatedLayout()) {
        this.restoreAuthenticatedLayout.set(false);
        this.layout.setType(this.lastAuthenticatedLayoutType(), {
          persist: false,
        });
        return;
      }

      this.lastAuthenticatedLayoutType.set(this.layout.type());
    });
    this.auth.loadCurrentUser().subscribe({
      next: () => this.loadNotifications(),
      error: () => undefined,
    });
    const notificationTimer = setInterval(
      () => this.loadNotifications(),
      60_000,
    );
    this.destroyRef.onDestroy(() => clearInterval(notificationTimer));
    void this.tauri.listenForAuthDeepLinks((token) => {
      void this.router.navigate(['/verify'], { queryParams: { token } });
    });
    afterNextRender(() => {
      const handleTitlebarDoubleClick = (event: MouseEvent): void => {
        const target = event.target;

        if (
          this.shell.platform !== 'tauri' ||
          this.shell.device() !== 'macos'
        ) {
          return;
        }

        if (
          !(target instanceof Element) ||
          !target.matches('[data-tauri-drag-region]')
        ) {
          return;
        }

        void this.shell.toggleMaximize();
      };

      document.addEventListener('dblclick', handleTitlebarDoubleClick);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('dblclick', handleTitlebarDoubleClick);
      });
    });
    this.destroyRef.onDestroy(() => this.labels.stop());
  }

  protected retrySession(): void {
    this.auth.retrySession().subscribe({
      next: (user) => {
        if (!user) void this.router.navigateByUrl('/auth/login');
      },
      error: () => undefined,
    });
  }

  protected logout(): void {
    this.auth.logout().subscribe({
      next: () => void this.router.navigateByUrl('/auth/login'),
    });
  }

  protected toggleNotifications(): void {
    this.bellOpen.update((open) => !open);
    if (this.bellOpen()) this.loadNotifications();
  }

  private loadNotifications(): void {
    if (this.auth.sessionState() !== 'authenticated') return;
    this.api.unreadNotificationCount().subscribe({
      next: (response) => this.unreadCount.set(response.total),
      error: () => undefined,
    });
    if (this.bellOpen()) {
      this.api
        .notifications({ page: 1, category: '', unreadOnly: false })
        .subscribe({
          next: (response) =>
            this.latestNotifications.set(response.data.slice(0, 5)),
          error: () => undefined,
        });
    }
  }
}
