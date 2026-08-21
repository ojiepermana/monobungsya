import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      const path = new URL(url).pathname;

      if (path === '/api/v1/auth/session') {
        return Response.json({
          authenticated: true,
          user: { name: 'Test User', role: 'admin' },
        });
      }

      return Response.json({ status: 'ok', service: 'api-gateway' });
    }) as typeof fetch;

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the workspace headline', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('A calm starting point');
  });

  it('should keep workspace content hidden for an unauthenticated session', async () => {
    globalThis.fetch = (async () => Response.json({ authenticated: false })) as typeof fetch;

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('Returning you to sign in');
    expect(compiled.querySelector('[data-layout-content]')).toBeNull();
  });

  it('should compose the authenticated app from package shell, layout, and page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('Shell')).not.toBeNull();
    expect(compiled.querySelector('Layout')).not.toBeNull();
    expect(compiled.querySelector('LayoutVertical')).not.toBeNull();
    expect(compiled.querySelector('[data-layout-navigation]')).not.toBeNull();
    expect(compiled.querySelector('[data-page-slot="header"]')).not.toBeNull();
    expect(compiled.querySelector('[data-page-slot="dashboard"]')).not.toBeNull();
    expect(compiled.querySelector('[data-page-slot="footer"]')).not.toBeNull();
  });

  it('should expose one main landmark owned by the package layout content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const mainRegions = compiled.querySelectorAll('main, [role="main"]');
    expect(mainRegions.length).toBe(1);

    const content = compiled.querySelector('[data-layout-content]');
    expect(content?.getAttribute('role')).toBe('main');
    expect(content?.getAttribute('id')).toBe('main-content');
    expect(compiled.querySelector('.workspace-content')).not.toBeNull();
  });

  it('should leave the navigation landmark to the package navigation container', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-layout-navigation]')?.getAttribute('role')).toBeNull();
    expect(compiled.querySelector('[data-layout-navigation] [role="navigation"]')).not.toBeNull();
  });

  it('should show a retryable state when session service fails', async () => {
    globalThis.fetch = (async () =>
      Response.json({ message: 'unavailable' }, { status: 503 })) as typeof fetch;

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('We could not check your access');
    expect(compiled.querySelector('button[type="button"]')?.textContent).toContain('Try again');
  });
});
