import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { TauriService } from '../desktop/tauri.service';
import { AuthService } from './auth.service';
import { AuthShell } from './auth-shell';
import { PasskeyService } from './passkey.service';

type VerifyState = 'verifying' | 'success' | 'error';

@Component({
  selector: 'app-verify-page',
  host: { class: 'block min-h-full' },
  imports: [RouterLink, IconComponent, AuthShell],
  template: `
    <app-auth-shell>
      <section class="w-full max-w-xl" aria-labelledby="callback-title">
        @if (state() === 'verifying') {
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Checking access</p>
          <h1 id="callback-title" class="mt-5 max-w-lg font-serif text-5xl font-normal leading-[0.98] tracking-[-0.03em] text-foreground sm:text-6xl">One moment.</h1>
          <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground" role="status" aria-live="polite">We are checking your secure workspace session.</p>
          <div class="mt-8 flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite"><span class="size-4 animate-pulse rounded-full bg-primary" aria-hidden="true"></span>Verifying session</div>
        } @else if (state() === 'success') {
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Access confirmed</p>
          <h1 id="callback-title" class="mt-5 max-w-lg font-serif text-5xl font-normal leading-[0.98] tracking-[-0.03em] text-foreground sm:text-6xl">Welcome{{ userName() ? ', ' + userName() : '' }}.</h1>
          <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground">Your workspace session is ready. Continue when you are set.</p>
          <div class="mt-8 max-w-lg border-l-2 border-primary bg-muted px-5 py-4 text-sm leading-6 text-foreground" role="status" aria-live="polite">Your browser session has been confirmed.</div>
          <a routerLink="/" class="mt-7 inline-flex min-h-12 items-center justify-center gap-2 bg-foreground px-5 text-sm font-semibold text-background no-underline transition-colors hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Icon name="arrow_forward" [size]="17" aria-hidden="true" />Continue to workspace</a>

          @if (showPasskeyPrompt()) {
            <div class="mt-8 max-w-lg border-t border-border pt-6">
              <h2 class="text-sm font-semibold text-foreground">Sign in faster next time</h2>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">Register a passkey to use fingerprint or face unlock without waiting for email.</p>
              <div class="mt-4 flex flex-wrap gap-3">
                <button type="button" class="inline-flex min-h-11 items-center gap-2 border border-border bg-background px-4 text-sm font-semibold text-foreground hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60" [disabled]="passkeyLoading()" (click)="registerPasskey()"><Icon name="fingerprint" [size]="17" aria-hidden="true" />{{ passkeyLoading() ? 'Menunggu passkey...' : 'Daftarkan passkey' }}</button>
                <button type="button" class="inline-flex min-h-11 items-center border border-border px-4 text-sm font-semibold text-foreground hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" (click)="dismissPasskeyPrompt()">Nanti saja</button>
              </div>
              @if (passkeyMessage(); as passkeyText) { <p class="mt-3 text-sm text-muted-foreground" role="alert">{{ passkeyText }}</p> }
            </div>
          }
        } @else {
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Link unavailable</p>
          <h1 id="callback-title" class="mt-5 max-w-lg font-serif text-5xl font-normal leading-[0.98] tracking-[-0.03em] text-foreground sm:text-6xl">That link cannot be used.</h1>
          <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground">The sign in link may have expired or already been used. Request a fresh link to continue.</p>
          <div class="mt-8 max-w-lg border-l-2 border-accent bg-accent/10 px-5 py-4 text-sm leading-6 text-foreground" role="alert">The link is invalid or no longer available.</div>
          <a routerLink="/auth/login" class="mt-7 inline-flex min-h-12 items-center justify-center gap-2 border border-border bg-background px-5 text-sm font-semibold text-foreground no-underline transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Icon name="arrow_back" [size]="17" aria-hidden="true" />Return to sign in</a>
        }
      </section>
    </app-auth-shell>
  `,
})
export class VerifyPage {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly tauri = inject(TauriService);
  private readonly passkey = inject(PasskeyService);

  protected readonly state = signal<VerifyState>('verifying');
  protected readonly userName = signal('');
  protected readonly showPasskeyPrompt = signal(false);
  protected readonly passkeyLoading = signal(false);
  protected readonly passkeyMessage = signal<string | null>(null);

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    const desktop = this.route.snapshot.queryParamMap.get('desktop') === '1';
    // biome-ignore lint/complexity/useLiteralKeys: route data uses an index signature
    const callback = this.route.snapshot.data['callback'];

    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname,
    );

    if (callback === 'error') {
      this.state.set('error');
      return;
    }

    if (desktop && token) {
      this.tauri.redirectToDesktopAuth(token);
      return;
    }

    if (callback === 'success' || !token) {
      this.loadSession();
      return;
    }

    this.auth.verifyMagicLink(token).subscribe({
      next: (response) => {
        if (response.status === 'success' && response.user) {
          this.complete(response.user.name);
        } else {
          this.state.set('error');
        }
      },
      error: () => this.state.set('error'),
    });
  }

  registerPasskey(): void {
    this.passkeyLoading.set(true);
    this.passkeyMessage.set(null);
    void this.passkey
      .register()
      .then(() => {
        this.passkey.dismissPrompt();
        this.showPasskeyPrompt.set(false);
      })
      .catch((error: unknown) =>
        this.passkeyMessage.set(
          this.passkey.messageFrom(error, 'Passkey gagal didaftarkan.'),
        ),
      )
      .finally(() => this.passkeyLoading.set(false));
  }

  dismissPasskeyPrompt(): void {
    this.passkey.dismissPrompt();
    this.showPasskeyPrompt.set(false);
  }

  private loadSession(): void {
    this.auth.loadCurrentUser().subscribe({
      next: (user) => {
        if (!user) {
          this.state.set('error');
          return;
        }

        this.complete(user.name);
      },
      error: () => this.state.set('error'),
    });
  }

  private complete(name: string): void {
    this.userName.set(name);
    this.state.set('success');
    this.offerPasskey();
  }

  private offerPasskey(): void {
    if (!this.passkey.supported() || this.passkey.promptDismissed()) return;

    void this.passkey
      .load()
      .then((passkeys) => this.showPasskeyPrompt.set(passkeys.length === 0))
      .catch(() => this.showPasskeyPrompt.set(false));
  }
}
