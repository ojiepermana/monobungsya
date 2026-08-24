import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import type { ApplicationConfig } from '@angular/core';
import {
  inject,
  provideEnvironmentInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideMaterialSymbols } from '@ojiepermana/angular/component/icon';
import { provideThemeSettingsAdapter } from '@ojiepermana/angular/theme/component/settings';
import {
  LayoutService,
  layoutLoadingInterceptor,
} from '@ojiepermana/angular/theme/layout/services';
import type {
  LayoutAppearance,
  LayoutSurface,
  LayoutType,
  LayoutWidth,
} from '@ojiepermana/angular/theme/layout/types';
import {
  createTauriShellWindowBridge,
  isTauriRuntime,
  provideShellWindowBridge,
  ShellService,
  WEB_SHELL_WINDOW_BRIDGE,
} from '@ojiepermana/angular/theme/shell';
import {
  provideUiTheme,
  type ThemeColor,
  type ThemeMode,
  type ThemeNeutral,
  type ThemeRadius,
  type ThemeSpace,
} from '@ojiepermana/angular/theme/styles';
import { configureGeneratedClient } from '../../api/generated-client';
import { provideApiConfiguration } from '../../api/shared/api-configuration';
import { environment } from '../../environments/environment';
import { navigationCorrelationInterceptor } from '../services/navigation-correlation.interceptor';
import { NavigationCorrelationService } from '../services/navigation-correlation.service';
import { routes } from './app.routes';

/**
 * Theme defaults registered via `provideUiTheme` below. Each axis persists in
 * the browser (handled by the design-system services), so a user's runtime
 * choice wins over these.
 */
export const APP_THEME_DEFAULTS = {
  mode: 'system',
  color: 'brand',
  neutral: 'base',
  radius: 'xs',
  space: 'compact',
  brand: {
    color: '177 72% 28%',
    foreground: '0 0% 100%',
  },
} as const satisfies {
  mode: ThemeMode;
  color: ThemeColor;
  neutral: ThemeNeutral;
  radius: ThemeRadius;
  space: ThemeSpace;
  brand: {
    color: string;
    foreground: string;
  };
};

/**
 * Layout defaults (surface / appearance / type / width) initialized into
 * LayoutService at bootstrap. A persisted user choice still wins.
 */
export const APP_LAYOUT_DEFAULTS = {
  surface: 'flat',
  appearance: 'flat',
  type: 'vertical',
  width: 'full',
} as const satisfies {
  surface: LayoutSurface;
  appearance: LayoutAppearance;
  type: LayoutType;
  width: LayoutWidth;
};

/**
 * The same build serves the browser SPA and the Tauri window, so the shell
 * bridge is chosen at runtime. Registering the Tauri bridge unconditionally
 * would report `platform: 'tauri'` in a plain browser tab too, and `<Shell>`
 * reads that as "there is an OS window here" — a browser tab would grow a
 * titlebar with traffic lights it cannot drive.
 */
function shellWindowBridge() {
  if (!isTauriRuntime()) {
    return WEB_SHELL_WINDOW_BRIDGE;
  }

  return createTauriShellWindowBridge({
    // withGlobalTauri is off, so the window module is imported instead of read
    // off `window.__TAURI__`. The returned handle also carries onResized /
    // onFocusChanged, which is what keeps the titlebar's maximize/restore label
    // and focus dimming in step with the real window.
    currentWindow: () =>
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow(),
      ),
    platform: () => navigator.platform,
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    // layoutLoadingInterceptor drives the layout's top progress bar while
    // HTTP requests are in flight.
    provideHttpClient(
      withFetch(),
      withInterceptors([
        layoutLoadingInterceptor,
        navigationCorrelationInterceptor,
      ]),
    ),
    provideApiConfiguration(environment.apiUrl),
    provideShellWindowBridge(shellWindowBridge),
    // @ojiepermana/angular design-system theme defaults (each axis persists, so a
    // user's runtime choice wins over these).
    provideMaterialSymbols({ href: '/assets/icons/material-symbols.css' }),
    provideUiTheme({
      ...APP_THEME_DEFAULTS,
    }),
    provideThemeSettingsAdapter(),
    // Initialize LayoutService with the app's layout defaults; the App shell binds
    // the wrapper to the service signals so these take effect.
    provideEnvironmentInitializer(() => {
      const navigation = inject(NavigationCorrelationService);
      configureGeneratedClient(environment.apiUrl, () => navigation.current());
      inject(LayoutService).registerDefaults(APP_LAYOUT_DEFAULTS);
      const shell = inject(ShellService);
      shell.registerColor('sync');
      shell.registerFrame('modern');
    }),
  ],
};
