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
    expect(compiled.querySelector('.workspace-shell')).toBeNull();
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
