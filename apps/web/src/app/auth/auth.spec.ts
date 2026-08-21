import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { client } from '#project/angular-sdk';
import { AuthCallback } from './auth-callback';
import { AuthLogin } from './auth-login';

describe('auth UI', () => {
  it('renders a persistent email label and accessible submit action', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthLogin],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: {} } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthLogin);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('label[for="email"]')?.textContent).toContain('Work email');
    expect(element.querySelector('input[type="email"]')).toBeTruthy();
    expect(element.querySelector('button[type="submit"]')?.textContent).toContain(
      'Send sign in link',
    );
  });

  it('renders a generic callback error state without token details', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthCallback],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { mode: 'error' } } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthCallback);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('That link cannot be used');
    expect(element.textContent).not.toContain('token=');
    expect(element.querySelector('a[routerLink="/auth/login"]')).toBeTruthy();
  });

  it('shows the automatic workspace redirect after a successful callback', async () => {
    client.setConfig({ baseUrl: 'http://localhost:3000', credentials: 'include' });
    globalThis.fetch = (async () =>
      Response.json({ authenticated: true, user: { name: 'System User' } })) as typeof fetch;

    await TestBed.configureTestingModule({
      imports: [AuthCallback],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { mode: 'complete' } } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthCallback);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Welcome, System User');
    expect(element.textContent).toContain('redirected to the workspace in 5 seconds');

    fixture.destroy();
  });
});
