import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertComponent,
  AlertDescriptionComponent,
  AlertTitleComponent,
} from '@ojiepermana/angular/component/alert';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import {
  CardComponent,
  CardContentComponent,
  CardDescriptionComponent,
  CardHeaderComponent,
  CardTitleComponent,
} from '@ojiepermana/angular/component/card';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { GatewayRequestError } from '../../api/generated-client';
import { TauriService } from '../desktop/tauri.service';
import { AuthService } from './auth.service';
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
  host: { class: 'block h-full min-h-0' },
  imports: [
    AlertComponent,
    AlertDescriptionComponent,
    AlertTitleComponent,
    ButtonComponent,
    CardComponent,
    CardContentComponent,
    CardDescriptionComponent,
    CardHeaderComponent,
    CardTitleComponent,
    IconComponent,
    InputComponent,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page
      variant="stacked"
      height="fix"
      scroll="content"
      appearance="flat"
      [appsLauncher]="false"
      class="h-full min-h-0 bg-layout-canvas [--layout-grid-size:2rem] bg-[linear-gradient(var(--layout-grid-color)_1px,transparent_1px),linear-gradient(to_right,var(--layout-grid-color)_1px,transparent_1px)] bg-position-[center_center] bg-size-[var(--layout-grid-size)_var(--layout-grid-size)] text-foreground"
    >
      <PageHeader class="invisible h-0 overflow-hidden" aria-hidden="true"></PageHeader>

      <PageContent class="flex h-full min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-8 sm:px-6">
        <Card class="block w-full max-w-md">
          <CardHeader class="text-center">
            <CardTitle level="1" class="text-xl sm:text-2xl">Masuk ke Monobungsya</CardTitle>
            <p CardDescription>Gunakan email kantor atau email yang sudah terdaftar.</p>
          </CardHeader>

          <CardContent>
            @if (state() === 'sent') {
              <div class="grid gap-4" role="status" aria-live="polite">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Check your inbox</p>
                <p class="text-xl font-semibold text-foreground">Your way in is on its way.</p>
                <p class="text-sm leading-6 text-muted-foreground">If this address is registered, a one time sign in link will arrive shortly.</p>
                <div class="border-l-2 border-primary bg-muted px-4 py-3 text-sm leading-6 text-foreground">Check <strong>{{ email() }}</strong> for your secure link.</div>
                <button Button type="button" class="w-full gap-1.5" (click)="reset()">
                  <Icon name="arrow_back" [size]="14" aria-hidden="true" />
                  Use another email
                </button>
              </div>
            } @else {
              @if (passkeySupported) {
                <div class="mb-5 grid gap-3">
                  <button Button size="xs" type="button" class="w-full gap-1.5" [disabled]="passkeyLoading()" (click)="signInWithPasskey()">
                    <Icon name="fingerprint" [size]="14" aria-hidden="true" />
                    {{ passkeyLoading() ? 'Menunggu passkey...' : 'Masuk dengan passkey' }}
                  </button>
                  <div class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                    <span class="h-px flex-1 bg-border"></span>
                    atau gunakan email
                    <span class="h-px flex-1 bg-border"></span>
                  </div>
                </div>
              }

              <form class="space-y-5" (submit)="send($event)" novalidate>
                <label class="grid gap-2 text-sm font-medium" for="login-email">
                  Email
                  <input
                    id="login-email"
                    Input
                    type="email"
                    name="email"
                    autocomplete="email"
                    placeholder="nama@monobungsya.id"
                    [value]="email()"
                    [attr.aria-invalid]="state() === 'invalid'"
                    [attr.aria-describedby]="state() === 'invalid' || state() === 'rate-limited' || state() === 'service-error' ? 'login-help login-error' : 'login-help'"
                    required
                    (input)="updateEmail($event)"
                  />
                </label>
                <p id="login-help" class="text-xs leading-5 text-muted-foreground">Gunakan email kantor atau email yang sudah terdaftar.</p>

                @if (state() === 'invalid') {
                  <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">Enter a valid work email address.</p>
                } @else if (state() === 'rate-limited') {
                  <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">Too many requests. Wait a few minutes, then try again.</p>
                } @else if (state() === 'service-error') {
                  <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">The sign in service is unavailable. Try again shortly.</p>
                }

                <button Button size="xs" type="submit" class="w-full gap-1.5" [disabled]="state() === 'submitting'">
                  <Icon name="mail" [size]="14" aria-hidden="true" />
                  {{ state() === 'submitting' ? 'Membuat link...' : 'Kirim magic link' }}
                </button>
              </form>
            }

            @if (state() === 'rate-limited' || state() === 'service-error') {
              <Alert class="mt-5">
                <AlertTitle>Status</AlertTitle>
                <AlertDescription>Periksa koneksi Anda dan coba lagi sebentar.</AlertDescription>
              </Alert>
            }
          </CardContent>
        </Card>
      </PageContent>

      <PageFooter class="invisible h-0 overflow-hidden" aria-hidden="true"></PageFooter>
    </Page>
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
  }

  signInWithPasskey(): void {
    this.passkeyLoading.set(true);
    void this.passkey
      .signIn()
      .then((user) =>
        this.router.navigateByUrl(user ? '/' : '/auth/two-factor'),
      )
      .finally(() => this.passkeyLoading.set(false));
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
