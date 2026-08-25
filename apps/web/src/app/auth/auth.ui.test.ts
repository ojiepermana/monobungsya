import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayRequestError } from '../../api/generated-client';
import { TauriService } from '../desktop/tauri.service';
import { AuthService, type AuthUser } from './auth.service';
import { LoginPage } from './login.page';
import { PasskeyCancelled, PasskeyService } from './passkey.service';
import { VerifyPage } from './verify.page';

const user: AuthUser = {
  id: 'user-1',
  name: 'System User',
  email: 'user@example.com',
  permissions: [],
};

function routeFor(
  data: Record<string, unknown> = {},
  query: Record<string, string | null> = {},
) {
  return {
    snapshot: {
      data,
      queryParamMap: { get: (key: string) => query[key] ?? null },
    },
  };
}

function passkeyStub() {
  return {
    supported: () => false,
    promptDismissed: () => false,
  } as unknown as PasskeyService;
}

afterEach(() => TestBed.resetTestingModule());

describe('auth UI', () => {
  it('covers AC-8 and AC-15: keeps login in one centered package card without navigation', async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink: vi.fn() } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('page')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('pagecontent')).toHaveLength(
      1,
    );
    expect(fixture.nativeElement.querySelectorAll('card')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('main')).toBeNull();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Masuk ke Monobungsya');
  });

  it('keeps the email input and concise submit action in one row', async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink: vi.fn() } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[type="email"]');
    const submit = fixture.nativeElement.querySelector('button[type="submit"]');

    expect(input.parentElement).toBe(submit.parentElement);
    expect(fixture.nativeElement.querySelector('#login-help')).toBeNull();
    expect(submit.textContent).toContain('Kirim');
    expect(submit.textContent).not.toContain('Kirim magic link');

    expect(fixture.nativeElement.textContent).toContain('atau login dengan');
    const providerButtons = [
      ...fixture.nativeElement.querySelectorAll(
        'button[aria-label^="Login dengan"]',
      ),
    ];
    expect(
      providerButtons.map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Login dengan Google',
      'Login dengan Microsoft',
      'Login dengan Apple',
      'Login dengan GitHub',
      'Login dengan Facebook',
      'Login dengan X',
      'Login dengan Yahoo',
    ]);
    expect(
      providerButtons.every((button) => button.textContent.trim() === ''),
    ).toBe(true);
    expect(
      providerButtons.every(
        (button) =>
          button.getAttribute('title') === button.getAttribute('aria-label'),
      ),
    ).toBe(true);
    expect(
      providerButtons.every(
        (button) =>
          button.style.height === '32px' && button.style.width === '32px',
      ),
    ).toBe(true);
    expect(providerButtons[0].parentElement?.classList.contains('gap-2')).toBe(
      true,
    );
    expect(
      providerButtons[0].parentElement?.classList.contains('justify-between'),
    ).toBe(true);
    expect(
      providerButtons.every((button) =>
        button.querySelector('svg path')?.getAttribute('d'),
      ),
    ).toBe(true);
    expect(
      providerButtons.every((button) =>
        button
          .querySelector('svg')
          ?.getAttribute('viewBox')
          ?.startsWith('0 0 '),
      ),
    ).toBe(true);
    expect(
      providerButtons.every(
        (button) => button.querySelector('svg')?.style.transform,
      ),
    ).toBe(true);
  });

  it('covers AC-7: shows a soft passkey cancellation and keeps magic link available', async () => {
    const signIn = vi.fn(() => Promise.reject(new PasskeyCancelled()));
    const messageFrom = vi.fn((_error: unknown, fallback: string) =>
      _error instanceof PasskeyCancelled ? 'Passkey dibatalkan.' : fallback,
    );
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink: vi.fn() } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        {
          provide: PasskeyService,
          useValue: {
            supported: () => true,
            promptDismissed: () => false,
            signIn,
            messageFrom,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        'button[type="button"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(signIn).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('Passkey dibatalkan.');
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('input[type="email"]'),
    ).toBeTruthy();
  });

  it('covers AC-3: signs in with a passkey and routes to the workspace', async () => {
    let resolveSignIn: (value: AuthUser) => void = () => undefined;
    const signIn = vi.fn(
      () =>
        new Promise<AuthUser>((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    const navigateByUrl = vi.fn(() => Promise.resolve(true));
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink: vi.fn() } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        {
          provide: PasskeyService,
          useValue: {
            supported: () => true,
            promptDismissed: () => false,
            signIn,
            messageFrom: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(
      navigateByUrl,
    );
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button[type="button"]',
    ) as HTMLButtonElement;

    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Menunggu passkey');

    resolveSignIn(user);
    await fixture.whenStable();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('covers AC-7: shows a generic passkey failure and re-enables the action', async () => {
    const signIn = vi.fn(() => Promise.reject(new Error('backend detail')));
    const messageFrom = vi.fn((_error: unknown, fallback: string) => fallback);
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink: vi.fn() } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        {
          provide: PasskeyService,
          useValue: {
            supported: () => true,
            promptDismissed: () => false,
            signIn,
            messageFrom,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button[type="button"]',
    ) as HTMLButtonElement;

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(messageFrom).toHaveBeenCalledWith(
      expect.any(Error),
      'Passkey gagal. Coba lagi atau gunakan magic link.',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Passkey gagal. Coba lagi atau gunakan magic link.',
    );
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
    expect(button.disabled).toBe(false);
  });

  it('covers AC-2 and AC-6: rejects invalid email with linked alert semantics', async () => {
    const requestMagicLink = vi.fn();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.updateEmail({
      target: { value: 'not-an-email' },
    } as unknown as Event);
    fixture.componentInstance.send({
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
    fixture.detectChanges();

    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Enter a valid work email address.',
    );
    const input = fixture.nativeElement.querySelector('input');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('login-error');
  });

  it('covers AC-1, AC-2, and AC-3: shows generic sent copy without a magic link response', async () => {
    const requestMagicLink = vi.fn(() => of({ accepted: true }));
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.updateEmail({
      target: { value: 'user@example.com' },
    } as unknown as Event);
    fixture.componentInstance.send({
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
    fixture.detectChanges();

    expect(requestMagicLink).toHaveBeenCalledWith('user@example.com', {});
    expect(fixture.nativeElement.textContent).toContain(
      'Your way in is on its way.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('token=');
    expect(fixture.nativeElement.querySelector('a[href*="verify"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
  });

  it('covers AC-2: shows a rate limit state without exposing account details', async () => {
    const requestMagicLink = vi.fn(() =>
      throwError(() => new GatewayRequestError(429, {})),
    );
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.updateEmail({
      target: { value: 'user@example.com' },
    } as unknown as Event);
    fixture.componentInstance.send({
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Too many requests.');
    expect(fixture.nativeElement.textContent).not.toContain('user@example.com');
  });

  it('covers AC-2: keeps the submit action disabled while the request is pending', async () => {
    const response = new Subject<{ accepted: true }>();
    const requestMagicLink = vi.fn(() => response.asObservable());
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.updateEmail({
      target: { value: 'user@example.com' },
    } as unknown as Event);
    fixture.componentInstance.send({
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
    fixture.detectChanges();

    const submit = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain('Membuat link');

    response.next({ accepted: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Your way in is on its way.',
    );
  });

  it('covers AC-2: shows a generic service error without backend details', async () => {
    const requestMagicLink = vi.fn(() =>
      throwError(() => new GatewayRequestError(503, {})),
    );
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { requestMagicLink } },
        { provide: TauriService, useValue: { magicLinkOptions: () => ({}) } },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.updateEmail({
      target: { value: 'user@example.com' },
    } as unknown as Event);
    fixture.componentInstance.send({
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('The sign in service is unavailable.');
    expect(fixture.nativeElement.textContent).not.toContain('503');
  });

  it('covers AC-4 and AC-5: shows a generic callback error when no session exists', async () => {
    const loadCurrentUser = vi.fn(() => of(null));
    await TestBed.configureTestingModule({
      imports: [VerifyPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: routeFor({ callback: 'success' }),
        },
        { provide: AuthService, useValue: { loadCurrentUser } },
        { provide: TauriService, useValue: {} },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyPage);
    fixture.detectChanges();

    expect(loadCurrentUser).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain(
      'That link cannot be used.',
    );
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[routerlink="/"]')).toBeNull();
  });

  it('covers AC-4 and AC-5: checks the cookie session before showing callback success', async () => {
    const loadCurrentUser = vi.fn(() => of(user));
    await TestBed.configureTestingModule({
      imports: [VerifyPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: routeFor({ callback: 'success' }),
        },
        { provide: AuthService, useValue: { loadCurrentUser } },
        { provide: TauriService, useValue: {} },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyPage);
    fixture.detectChanges();

    expect(loadCurrentUser).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain(
      'Welcome, System User.',
    );
    expect(
      fixture.nativeElement.querySelector('a[routerlink="/"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
  });

  it('covers AC-4 and AC-8: renders fixed callback error copy without query details', async () => {
    const loadCurrentUser = vi.fn();
    await TestBed.configureTestingModule({
      imports: [VerifyPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: routeFor(
            { callback: 'error' },
            { token: 'secret-token-value' },
          ),
        },
        { provide: AuthService, useValue: { loadCurrentUser } },
        { provide: TauriService, useValue: {} },
        { provide: PasskeyService, useValue: passkeyStub() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VerifyPage);
    fixture.detectChanges();

    expect(loadCurrentUser).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'That link cannot be used.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('token');
    expect(window.location.search).toBe('');
    expect(
      fixture.nativeElement.querySelector('a[routerlink="/auth/login"]'),
    ).toBeTruthy();
  });
});
