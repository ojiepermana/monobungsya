import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { GatewayRequestError } from '../../api/generated-client';
import { TauriService } from '../desktop/tauri.service';
import { AuthService } from './auth.service';
import { AuthShell } from './auth-shell';
import { PasskeyService } from './passkey.service';

type LoginState =
  | 'idle'
  | 'invalid'
  | 'submitting'
  | 'sent'
  | 'rate-limited'
  | 'service-error';

@Component({
  selector: 'app-login-page',
  host: { class: 'block min-h-full' },
  imports: [IconComponent, AuthShell],
  template: `
    <app-auth-shell>
      <section class="w-full max-w-xl" aria-labelledby="login-title">
        @if (state() === 'sent') {
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Check your inbox</p>
          <h1 id="login-title" class="mt-5 max-w-lg font-serif text-5xl font-normal leading-[0.98] tracking-[-0.03em] text-foreground sm:text-6xl">Your way in is on its way.</h1>
          <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground">If this address is registered, a one time sign in link will arrive shortly. The link expires after fifteen minutes.</p>
          <div class="mt-8 max-w-lg border-l-2 border-primary bg-muted px-5 py-4 text-sm leading-6 text-foreground" role="status" aria-live="polite">Check <strong>{{ email() }}</strong> for your secure link.</div>
          <button type="button" class="mt-7 inline-flex min-h-11 items-center gap-2 border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" (click)="reset()"><Icon name="arrow_back" [size]="16" aria-hidden="true" />Use another email</button>
        } @else {
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Workspace sign in</p>
          <h1 id="login-title" class="mt-5 max-w-lg font-serif text-5xl font-normal leading-[0.98] tracking-[-0.03em] text-foreground sm:text-6xl">A calmer way to sign in.</h1>
          <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground">Enter your work email and we will send a secure link. No password required.</p>

          @if (passkeySupported) {
            <div class="mt-8 grid max-w-md gap-4">
              <button type="button" class="inline-flex min-h-11 w-full items-center justify-center gap-2 border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60" [disabled]="passkeyLoading()" (click)="signInWithPasskey()"><Icon name="fingerprint" [size]="17" aria-hidden="true" />{{ passkeyLoading() ? 'Menunggu passkey...' : 'Masuk dengan passkey' }}</button>
              <div class="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground" aria-hidden="true"><span class="h-px flex-1 bg-border"></span>atau email<span class="h-px flex-1 bg-border"></span></div>
            </div>
          }

          <form class="mt-8 grid max-w-md gap-3" (submit)="send($event)" novalidate>
            <label class="text-sm font-semibold text-foreground" for="login-email">Work email</label>
            <input id="login-email" class="min-h-12 w-full border border-border bg-background px-4 text-base text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25" type="email" name="email" autocomplete="email" placeholder="you@company.com" [value]="email()" [attr.aria-invalid]="state() === 'invalid'" [attr.aria-describedby]="state() === 'invalid' || state() === 'rate-limited' || state() === 'service-error' ? 'login-help login-error' : 'login-help'" required (input)="updateEmail($event)" />
            <p id="login-help" class="text-xs leading-5 text-muted-foreground">Use the address connected to your workspace.</p>

            @if (state() === 'invalid') {
              <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">Enter a valid work email address.</p>
            } @else if (state() === 'rate-limited') {
              <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">Too many requests. Wait a few minutes, then try again.</p>
            } @else if (state() === 'service-error') {
              <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">The sign in service is unavailable. Try again shortly.</p>
            }

            <button type="submit" class="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60" [disabled]="state() === 'submitting'"><Icon name="mail" [size]="17" aria-hidden="true" />{{ state() === 'submitting' ? 'Membuat link...' : 'Kirim magic link' }}</button>
          </form>

          @if (passkeyMessage(); as passkeyText) { <p class="mt-4 max-w-md text-sm text-muted-foreground" role="alert">{{ passkeyText }}</p> }
          <p class="mt-8 max-w-md text-xs leading-5 text-muted-foreground">By continuing, you use a server managed session protected by the workspace.</p>
        }
      </section>
    </app-auth-shell>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly tauri = inject(TauriService);
  private readonly passkey = inject(PasskeyService);

  protected readonly passkeySupported = this.passkey.supported();
  protected readonly email = signal('');
  protected readonly state = signal<LoginState>('idle');
  protected readonly passkeyLoading = signal(false);
  protected readonly passkeyMessage = signal<string | null>(null);

  updateEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    if (this.state() !== 'submitting') this.state.set('idle');
  }

  send(event: SubmitEvent): void {
    event.preventDefault();
    const email = this.email().trim();

    if (!this.isValidEmail(email)) {
      this.state.set('invalid');
      return;
    }

    this.state.set('submitting');
    this.passkeyMessage.set(null);
    this.auth.requestMagicLink(email, this.tauri.magicLinkOptions()).subscribe({
      next: () => this.state.set('sent'),
      error: (error: unknown) => {
        this.state.set(
          error instanceof GatewayRequestError && error.status === 429
            ? 'rate-limited'
            : 'service-error',
        );
      },
    });
  }

  reset(): void {
    this.state.set('idle');
    this.passkeyMessage.set(null);
  }

  signInWithPasskey(): void {
    this.passkeyLoading.set(true);
    this.passkeyMessage.set(null);
    void this.passkey
      .signIn()
      .then((user) =>
        this.router.navigateByUrl(user ? '/' : '/auth/two-factor'),
      )
      .catch((error: unknown) =>
        this.passkeyMessage.set(
          this.passkey.messageFrom(error, 'Login dengan passkey gagal.'),
        ),
      )
      .finally(() => this.passkeyLoading.set(false));
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
