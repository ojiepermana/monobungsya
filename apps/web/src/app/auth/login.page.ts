import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  faApple,
  faFacebook,
  faGithub,
  faGoogle,
  faMicrosoft,
  faXTwitter,
  faYahoo,
} from '@fortawesome/free-brands-svg-icons';
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

const SOCIAL_PROVIDERS = [
  { label: 'Google', icon: faGoogle, iconScale: 1, brandColor: '#4285f4' },
  {
    label: 'Microsoft',
    icon: faMicrosoft,
    iconScale: 1.11,
    brandColor: '#00a4ef',
  },
  { label: 'Apple', icon: faApple, iconScale: 1.11, brandColor: '#1d1d1f' },
  { label: 'GitHub', icon: faGithub, iconScale: 1, brandColor: '#24292f' },
  {
    label: 'Facebook',
    icon: faFacebook,
    iconScale: 0.97,
    brandColor: '#1877f2',
  },
  { label: 'X', icon: faXTwitter, iconScale: 1.19, brandColor: '#000000' },
  { label: 'Yahoo', icon: faYahoo, iconScale: 1.11, brandColor: '#6001d2' },
] as const;

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
  styles: [
    `
      .social-provider-icon {
        color: hsl(var(--muted-foreground));
      }

      .social-provider-button:hover,
      .social-provider-button:focus-visible {
        background-color: transparent !important;
      }

      .social-provider-button:hover .social-provider-icon,
      .social-provider-button:focus-visible .social-provider-icon {
        color: var(--provider-brand-color) !important;
      }
    `,
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
                  @if (passkeyMessage(); as message) {
                    <p class="border-l-2 border-primary bg-muted px-3 py-2 text-sm leading-5 text-foreground" role="status" aria-live="polite">
                      {{ message }}
                    </p>
                  }
                  <div class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                    <span class="h-px flex-1 bg-border"></span>
                    atau gunakan email
                    <span class="h-px flex-1 bg-border"></span>
                  </div>
                </div>
              }

              <form class="space-y-5" (submit)="send($event)" novalidate>
                <div class="grid gap-2">
                  <label class="text-sm font-medium" for="login-email">Email</label>
                  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                    <input
                      id="login-email"
                      Input
                      type="email"
                      name="email"
                      autocomplete="email"
                      placeholder="nama@monobungsya.id"
                      [value]="email()"
                      [attr.aria-invalid]="state() === 'invalid'"
                      [attr.aria-describedby]="state() === 'invalid' || state() === 'rate-limited' || state() === 'service-error' ? 'login-error' : null"
                      required
                      (input)="updateEmail($event)"
                    />
                    <button Button size="xs" type="submit" class="h-full gap-1.5 whitespace-nowrap px-3" [disabled]="state() === 'submitting'">
                      <Icon name="mail" [size]="14" aria-hidden="true" />
                      {{ state() === 'submitting' ? 'Membuat link...' : 'Kirim' }}
                    </button>
                  </div>
                </div>

                @if (state() === 'invalid') {
                  <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">Enter a valid work email address.</p>
                } @else if (state() === 'rate-limited') {
                  <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">Too many requests. Wait a few minutes, then try again.</p>
                } @else if (state() === 'service-error') {
                  <p id="login-error" class="border-l-2 border-accent bg-accent/10 px-3 py-2 text-sm leading-5 text-foreground" role="alert">The sign in service is unavailable. Try again shortly.</p>
                }

                <div class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                  <span class="h-px flex-1 bg-border"></span>
                  atau login dengan
                  <span class="h-px flex-1 bg-border"></span>
                </div>
                <div class="flex items-center justify-between gap-2">
                  @for (provider of socialProviders; track provider.label) {
                    <button Button variant="ghost" size="xs" type="button" class="social-provider-button shrink-0 p-0" [style.height.px]="32" [style.width.px]="32" [attr.aria-label]="'Login dengan ' + provider.label" [title]="'Login dengan ' + provider.label">
                      <svg class="social-provider-icon !size-5 shrink-0 transition-colors" [style.--provider-brand-color]="provider.brandColor" [style.transform]="'scale(' + provider.iconScale + ')'" [attr.viewBox]="'0 0 ' + provider.icon.icon[0] + ' ' + provider.icon.icon[1]" fill="currentColor" aria-hidden="true" focusable="false">
                        <path [attr.d]="provider.icon.icon[4]"></path>
                      </svg>
                    </button>
                  }
                </div>

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
  protected readonly passkeyMessage = signal<string | null>(null);
  protected readonly socialProviders = SOCIAL_PROVIDERS;

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
    this.passkeyMessage.set(null);
    void this.passkey
      .signIn()
      .then((user) =>
        this.router.navigateByUrl(user ? '/' : '/auth/two-factor'),
      )
      .catch((error: unknown) =>
        this.passkeyMessage.set(
          this.passkey.messageFrom(
            error,
            'Passkey gagal. Coba lagi atau gunakan magic link.',
          ),
        ),
      )
      .finally(() => this.passkeyLoading.set(false));
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
