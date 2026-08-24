import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  type BrandIdentity,
  LayoutWrapperDefault,
  type UserIdentity,
} from '@ojiepermana/angular/theme/layout/wrapper';
import {
  isTauriRuntime,
  ShellComponent,
  type ShellMode,
  ShellService,
} from '@ojiepermana/angular/theme/shell';
import { AuthService } from './auth/auth.service';
import { TauriService } from './desktop/tauri.service';
import { APP_BRAND_ICON, appNavigationFor } from './shell/app.nav';
import { ThemeSettingsAdapterService } from './shell/theme-settings-adapter';
import { UiLabelLocalizationService } from './shell/ui-label-localization.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LayoutWrapperDefault, ShellComponent, IconComponent],
  template: `
    <!--
      Shell from @ojiepermana/angular owns the browser or desktop surface. The
      authenticated LayoutWrapperDefault assembles the Layout + Navigation skeleton
      from data inputs (brand, user, nav items).

      Layout and navigation settings are bound to the app adapter so every option
      in ThemeSettings updates the rendered shell and persists automatically.
    -->
    <Shell
      [mode]="shellMode"
      [color]="shell.color()"
      [frame]="shell.frame()"
      navigationFlyoutIcon="apps"
      barAriaLabel="Monobungsya window controls"
    >
      <span shellBarTitle class="inline-flex items-center gap-2">
        <Icon [name]="appBrandIcon" [size]="16" aria-hidden="true" />
        <span>Monobungsya</span>
      </span>
      @if (isGuestRoute()) {
        <router-outlet />
      } @else {
        <LayoutWrapperDefault
          [data]="nav()"
          [brand]="brand"
          [user]="user()"
          [nav-type]="themeSettings.navType()"
          [nav-type-mode]="themeSettings.navTypeMode()"
          [layout-type]="layout.type()"
          [surface]="layout.surface()"
          [layout-appearance]="layout.appearance()"
          [width]="layout.width()"
          content-class="h-full min-h-0"
        >
          <router-outlet />
        </LayoutWrapperDefault>
      }
    </Shell>
  `,
})
export class App {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly labels = inject(UiLabelLocalizationService);
  protected readonly themeSettings = inject(ThemeSettingsAdapterService);
  private readonly tauri = inject(TauriService);

  /**
   * Layout axes (surface / appearance / type / width). Defaults are registered
   * in app.config.ts. Persisted choices still win except page-only layout types
   * that hide primary navigation. The template binds the wrapper to these
   * signals so the registered defaults take effect.
   */
  protected readonly layout = inject(LayoutService);

  /** Desktop window state and commands behind `<Shell>`. */
  protected readonly shell = inject(ShellService);

  /**
   * Inside the Tauri window the shell always owns the window chrome — stated
   * explicitly rather than left to `ShellService`, whose fallback reads a
   * persisted `shell-mode` first and would otherwise let a stale `web` leave a
   * decoration-less window with no titlebar and no way to close it. In a
   * browser tab `null` hands the decision back to the stored/derived mode.
   */
  protected readonly shellMode: ShellMode | null = isTauriRuntime()
    ? 'desktop'
    : null;

  /** Brand shown in the layout's sidebar header. */
  protected readonly brand: BrandIdentity = {
    name: 'PT MONOBUNGSYA',
    icon: APP_BRAND_ICON,
    title: 'PT MONOBUNGSYA',
    subtitle: '',
  };

  protected readonly appBrandIcon = APP_BRAND_ICON;

  /** User identity shown in the layout's sidebar footer. */
  protected readonly user = computed<UserIdentity>(() => {
    const current = this.auth.user();

    return {
      name: current?.name ?? 'Guest',
      email: '',
    };
  });

  /** Sidebar navigation registered in app.config.ts. */
  protected readonly nav = computed(() =>
    appNavigationFor(this.auth.user()?.permissions ?? []),
  );

  protected isGuestRoute(): boolean {
    const url = this.router.url.split('?')[0];

    return (
      url === '/login' ||
      url === '/verify' ||
      url === '/auth/login' ||
      url === '/auth/callback-complete' ||
      url === '/auth/callback-error' ||
      url === '/auth/two-factor' ||
      url === '/auth/two-factor/enroll'
    );
  }

  constructor() {
    this.labels.start();
    void this.tauri.listenForAuthDeepLinks((token) => {
      void this.router.navigate(['/verify'], { queryParams: { token } });
    });
    afterNextRender(() => {
      this.moveThemeSettingsToNavigationHeaders();

      const observer = new MutationObserver(() => {
        this.moveThemeSettingsToNavigationHeaders();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    const handleLogoutClick = (event: MouseEvent): void => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest(
        'button[title="Logout"], button[title="Keluar"]',
      );

      if (!button || this.isGuestRoute()) {
        return;
      }

      event.preventDefault();
      this.auth.logout().subscribe({
        next: () => void this.router.navigateByUrl('/login'),
        error: () => void this.router.navigateByUrl('/login'),
      });
    };

    /**
     * Double-clicking the titlebar zooms the window — on macOS only, and only
     * from this app.
     *
     * Tauri's own drag-region script answers a double-click with
     * `internal_toggle_maximize`, which asks the window whether it is maximizable
     * before doing anything. A `decorations: false` macOS window has no zoom
     * button for that question to read, so it always answers no and the window
     * never moves. `toggle_maximize` performs the same zoom without that guard,
     * which is what `ShellService` drives. Windows and Linux do report a zoom
     * button, so Tauri already handles them — running this there as well would
     * toggle twice and land back where it started.
     *
     * The `[data-tauri-drag-region]` test mirrors Tauri's: the marked element
     * must be the click target itself, so titlebar controls are never affected.
     */
    const handleTitlebarDoubleClick = (event: MouseEvent): void => {
      const target = event.target;

      if (this.shell.platform !== 'tauri' || this.shell.device() !== 'macos') {
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

    document.addEventListener('click', handleLogoutClick);
    document.addEventListener('dblclick', handleTitlebarDoubleClick);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('click', handleLogoutClick);
      document.removeEventListener('dblclick', handleTitlebarDoubleClick);
      this.labels.stop();
    });
  }

  private moveThemeSettingsToNavigationHeaders(): void {
    const themeSettings = document.querySelectorAll<HTMLElement>(
      'app-root ThemeSettings',
    );

    for (const themeSetting of themeSettings) {
      const navigation = themeSetting.closest('Navigation');
      const header = navigation?.querySelector<HTMLElement>('NavigationHeader');
      const headerRow = header?.firstElementChild;

      if (!header || !headerRow || header.contains(themeSetting)) {
        continue;
      }

      headerRow.append(themeSetting);
    }
  }
}
