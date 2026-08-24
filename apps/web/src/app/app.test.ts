import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { THEME_SETTINGS_ADAPTER } from '@ojiepermana/angular/theme/component/settings';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import { ShellService } from '@ojiepermana/angular/theme/shell';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthService, type AuthUser } from './auth/auth.service';
import { TauriService } from './desktop/tauri.service';
import { UiLabelLocalizationService } from './shell/ui-label-localization.service';

type SessionState =
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'service-error';

const user: AuthUser = {
  id: 'user-1',
  name: 'System User',
  email: 'user@example.com',
  permissions: [],
};

@Component({ template: '' })
class BlankPage {}

/**
 * The layout state contract these tests lock in (spec 0010, fixed after
 * /check verify): the package's LayoutFluid constructor writes 'fluid' into
 * the shared LayoutService whenever a guest surface renders. The App effect
 * must therefore never record or restore layout state while a guest route is
 * active, or the operator's choice gets corrupted and the navigation unhides
 * inside the fluid layout. The setType calls below simulate exactly those
 * documented package writes, since the template is overridden and the real
 * layout components do not render here.
 */
describe('App layout state', () => {
  let sessionState: ReturnType<typeof signal<SessionState>>;
  let currentUser: ReturnType<typeof signal<AuthUser | null>>;

  beforeEach(async () => {
    localStorage.clear();
    sessionState = signal<SessionState>('checking');
    currentUser = signal<AuthUser | null>(null);

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: '', component: BlankPage },
          { path: 'auth/login', component: BlankPage },
          { path: 'auth/callback-error', component: BlankPage },
          { path: 'auth/two-factor', component: BlankPage },
        ]),
        {
          provide: AuthService,
          useValue: {
            sessionState,
            user: currentUser,
            loadCurrentUser: vi.fn(() => of(null)),
            retrySession: vi.fn(() => of(null)),
            logout: vi.fn(() => of(undefined)),
          },
        },
        {
          provide: TauriService,
          useValue: { listenForAuthDeepLinks: vi.fn(async () => undefined) },
        },
        {
          provide: UiLabelLocalizationService,
          useValue: { start: vi.fn(), stop: vi.fn() },
        },
        {
          provide: THEME_SETTINGS_ADAPTER,
          useValue: { navType: () => 'sidebar', navTypeMode: () => 'default' },
        },
        {
          provide: ShellService,
          useValue: {
            platform: 'web',
            mode: () => 'web',
            device: () => 'browser',
            toggleMaximize: vi.fn(async () => undefined),
          },
        },
      ],
    });

    TestBed.overrideComponent(App, {
      set: { template: '<router-outlet />' },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  function createApp() {
    const layout = TestBed.inject(LayoutService);
    layout.setType('vertical', { persist: false });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return { fixture, layout, router: TestBed.inject(Router) };
  }

  function authenticate() {
    currentUser.set(user);
    sessionState.set('authenticated');
  }

  function effectiveLayoutType(fixture: { componentInstance: App }): string {
    return fixture.componentInstance['effectiveLayoutType']();
  }

  it('covers AC-13 and AC-14: restores the operator layout once the session gate resolves on a workspace route', async () => {
    const { fixture, layout } = createApp();

    layout.setType('fluid', { persist: false });
    fixture.detectChanges();
    expect(effectiveLayoutType(fixture)).toBe('fluid');

    authenticate();
    fixture.detectChanges();

    expect(layout.type()).toBe('vertical');
    expect(effectiveLayoutType(fixture)).toBe('vertical');
  });

  it('covers AC-8: keeps the fluid layout and never restores workspace state on an authenticated auth route', async () => {
    const { fixture, layout, router } = createApp();

    await router.navigateByUrl('/auth/callback-error');
    fixture.detectChanges();
    layout.setType('fluid', { persist: false });
    fixture.detectChanges();

    authenticate();
    fixture.detectChanges();

    expect(layout.type()).toBe('fluid');
    expect(effectiveLayoutType(fixture)).toBe('fluid');
  });

  it('covers AC-13: does not record the transient fluid frame of an auth route as the operator choice', async () => {
    const { fixture, layout, router } = createApp();
    authenticate();
    fixture.detectChanges();
    expect(effectiveLayoutType(fixture)).toBe('vertical');

    await router.navigateByUrl('/auth/two-factor');
    fixture.detectChanges();
    layout.setType('fluid', { persist: false });
    fixture.detectChanges();
    expect(effectiveLayoutType(fixture)).toBe('fluid');

    await router.navigateByUrl('/');
    fixture.detectChanges();

    expect(effectiveLayoutType(fixture)).toBe('vertical');
  });

  it('covers AC-13: keeps a deliberate operator fluid choice made on a workspace route', async () => {
    const { fixture, layout, router } = createApp();
    authenticate();
    fixture.detectChanges();

    layout.setType('fluid', { persist: false });
    fixture.detectChanges();
    expect(effectiveLayoutType(fixture)).toBe('fluid');

    await router.navigateByUrl('/auth/two-factor');
    fixture.detectChanges();
    await router.navigateByUrl('/');
    fixture.detectChanges();

    expect(effectiveLayoutType(fixture)).toBe('fluid');
  });

  it('covers AC-8: falls back to the fluid layout when the session ends and restores it on the next login', async () => {
    const { fixture, layout } = createApp();
    authenticate();
    fixture.detectChanges();
    expect(effectiveLayoutType(fixture)).toBe('vertical');

    sessionState.set('unauthenticated');
    fixture.detectChanges();
    expect(effectiveLayoutType(fixture)).toBe('fluid');

    layout.setType('fluid', { persist: false });
    fixture.detectChanges();

    authenticate();
    fixture.detectChanges();
    expect(layout.type()).toBe('vertical');
    expect(effectiveLayoutType(fixture)).toBe('vertical');
  });
});
