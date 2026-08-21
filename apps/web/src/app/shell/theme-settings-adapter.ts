import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import type {
  ThemeSettingsAdapter,
  ThemeSettingsNavigationMode,
  ThemeSettingsNavigationType,
} from '@ojiepermana/angular/theme/component/settings';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import type { LayoutType } from '@ojiepermana/angular/theme/layout/types';
import { ShellService } from '@ojiepermana/angular/theme/shell/services';
import type { ShellMode } from '@ojiepermana/angular/theme/shell/types';

const NAVIGATION_TYPE_STORAGE_KEY = 'theme-settings-nav-type';
const NAVIGATION_MODE_STORAGE_KEY = 'theme-settings-nav-type-mode';
const NAVIGATION_TYPES = ['sidebar', 'dockbar', 'navbar', 'flyout', 'desktop'] as const;
const NAVIGATION_MODES = ['default', 'collapsed', 'drawer'] as const;

function navigationTypesFor(
  layoutType: LayoutType,
  shellMode: ShellMode,
): readonly ThemeSettingsNavigationType[] {
  if (layoutType === 'vertical') {
    return ['sidebar', 'dockbar'];
  }

  if (layoutType === 'horizontal') {
    return shellMode === 'desktop' ? ['desktop'] : ['navbar', 'flyout'];
  }

  return [];
}

function navigationModesFor(
  navigationType: ThemeSettingsNavigationType,
): readonly ThemeSettingsNavigationMode[] {
  if (navigationType === 'sidebar') {
    return ['default', 'collapsed'];
  }

  if (navigationType === 'dockbar') {
    return ['default', 'drawer'];
  }

  return ['default'];
}

@Injectable({ providedIn: 'root' })
export class ThemeSettingsAdapterService implements ThemeSettingsAdapter {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly layout = inject(LayoutService);
  private readonly shell = inject(ShellService);
  private readonly navTypeState = signal<ThemeSettingsNavigationType>(
    this.readNavigationType() ?? 'sidebar',
  );
  private readonly navTypeModeState = signal<ThemeSettingsNavigationMode>(
    this.readNavigationMode() ?? 'default',
  );

  readonly appearance = this.layout.appearance;
  readonly surface = this.layout.surface;
  readonly layoutType = this.layout.type;
  readonly width = this.layout.width;
  readonly navType = this.navTypeState.asReadonly();
  readonly navTypeMode = this.navTypeModeState.asReadonly();

  constructor() {
    this.normalizeNavigation();
  }

  setAppearance(value: Parameters<LayoutService['setAppearance']>[0]): void {
    this.layout.setAppearance(value);
  }

  setSurface(value: Parameters<LayoutService['setSurface']>[0]): void {
    this.layout.setSurface(value);
  }

  setLayoutType(value: LayoutType): void {
    this.layout.setType(value);
    this.normalizeNavigation();
  }

  setWidth(value: Parameters<LayoutService['setWidth']>[0]): void {
    this.layout.setWidth(value);
  }

  setNavType(value: ThemeSettingsNavigationType): void {
    if (!navigationTypesFor(this.layout.type(), this.shell.mode()).includes(value)) {
      return;
    }

    this.navTypeState.set(value);
    this.writeStorage(NAVIGATION_TYPE_STORAGE_KEY, value);
    this.normalizeNavigationMode();
  }

  setNavTypeMode(value: ThemeSettingsNavigationMode): void {
    if (!navigationModesFor(this.navTypeState()).includes(value)) {
      return;
    }

    this.navTypeModeState.set(value);
    this.writeStorage(NAVIGATION_MODE_STORAGE_KEY, value);
  }

  private normalizeNavigation(): void {
    const allowedTypes = navigationTypesFor(this.layout.type(), this.shell.mode());
    const currentType = this.navTypeState();

    if (allowedTypes.length && !allowedTypes.includes(currentType)) {
      const [firstType] = allowedTypes;
      if (firstType) {
        this.navTypeState.set(firstType);
        this.writeStorage(NAVIGATION_TYPE_STORAGE_KEY, firstType);
      }
    }

    this.normalizeNavigationMode();
  }

  private normalizeNavigationMode(): void {
    const allowedModes = navigationModesFor(this.navTypeState());
    const currentMode = this.navTypeModeState();

    if (!allowedModes.includes(currentMode)) {
      this.navTypeModeState.set('default');
      this.writeStorage(NAVIGATION_MODE_STORAGE_KEY, 'default');
    }
  }

  private readNavigationType(): ThemeSettingsNavigationType | null {
    const value = this.readStorage(NAVIGATION_TYPE_STORAGE_KEY);

    return value && NAVIGATION_TYPES.includes(value as ThemeSettingsNavigationType)
      ? (value as ThemeSettingsNavigationType)
      : null;
  }

  private readNavigationMode(): ThemeSettingsNavigationMode | null {
    const value = this.readStorage(NAVIGATION_MODE_STORAGE_KEY);

    return value && NAVIGATION_MODES.includes(value as ThemeSettingsNavigationMode)
      ? (value as ThemeSettingsNavigationMode)
      : null;
  }

  private readStorage(key: string): string | null {
    const storage = this.getStorage();

    if (!storage) {
      return null;
    }

    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    const storage = this.getStorage();

    if (!storage) {
      return;
    }

    try {
      storage.setItem(key, value);
    } catch {
      return;
    }
  }

  private getStorage(): Storage | null {
    return isPlatformBrowser(this.platformId) ? localStorage : null;
  }
}