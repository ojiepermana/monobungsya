import { Component, computed, inject, signal } from '@angular/core';
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
  AlertDialogActionComponent,
  AlertDialogComponent,
  AlertDialogContentComponent,
  AlertDialogDescriptionComponent,
  AlertDialogFooterComponent,
  AlertDialogHeaderComponent,
  AlertDialogMediaComponent,
  AlertDialogTitleComponent,
} from '@ojiepermana/angular/component/alert-dialog';
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

type LoginState = 'idle' | 'invalid' | 'submitting';

type LoginAlertStatus = 'gagal' | 'belum_verifikasi' | 'berhasil';

interface LoginAlert {
  status: LoginAlertStatus;
  keterangan: string;
}

@Component({
  selector: 'app-login-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    AlertDialogActionComponent,
    AlertDialogComponent,
    AlertDialogContentComponent,
    AlertDialogDescriptionComponent,
    AlertDialogFooterComponent,
    AlertDialogHeaderComponent,
    AlertDialogMediaComponent,
    AlertDialogTitleComponent,
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
                      [attr.aria-describedby]="state() === 'invalid' ? 'login-error' : null"
                      required
                      (input)="updateEmail($event)"
                    />
                    <button Button size="xs" type="submit" class="h-full gap-1.5 whitespace-nowrap px-3" [disabled]="state() === 'submitting' || !emailIsValid()">
                      <Icon name="mail" [size]="14" aria-hidden="true" />
                      {{ state() === 'submitting' ? 'Membuat link...' : 'Kirim' }}
                    </button>
                  </div>
                </div>

                @if (state() === 'invalid') {
                  <span id="login-error" class="sr-only">Email tidak valid</span>
                }

                <div class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                  <span class="h-px flex-1 bg-border"></span>
                  atau login dengan
                  <span class="h-px flex-1 bg-border"></span>
                </div>
                <div class="flex items-center justify-between gap-2">
                  @for (provider of socialProviders; track provider.label) {
                    <button Button variant="ghost" size="xs" type="button" class="social-provider-button shrink-0 p-0" [style.height.px]="32" [style.width.px]="32" [attr.aria-label]="'Login dengan ' + provider.label" [title]="'Login dengan ' + provider.label">
                        <svg class="social-provider-icon size-5! shrink-0 transition-colors" [style.--provider-brand-color]="provider.brandColor" [style.transform]="'scale(' + provider.iconScale + ')'" [attr.viewBox]="'0 0 ' + provider.icon.icon[0] + ' ' + provider.icon.icon[1]" fill="currentColor" aria-hidden="true" focusable="false">
                        <path [attr.d]="provider.icon.icon[4]"></path>
                      </svg>
                    </button>
                  }
                </div>

            </form>
          </CardContent>
        </Card>
      </PageContent>

      @if (alert(); as message) {
        <AlertDialog [(open)]="alertOpen" aria-labelledby="login-alert-title" aria-describedby="login-alert-description">
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <div class="flex items-center gap-3 text-left">
                <AlertDialogMedia [class]="alertMediaClass()">
                  <Icon [name]="alertIcon(message.status)" [size]="20" aria-hidden="true" />
                </AlertDialogMedia>
                <AlertDialogTitle id="login-alert-title" [class]="alertTextClass()">{{ alertLabel(message.status) }}</AlertDialogTitle>
              </div>
              <AlertDialogDescription id="login-alert-description" [class]="alertTextClass()">{{ message.keterangan }}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <button type="button" AlertDialogAction [variant]="message.status === 'gagal' ? 'destructive' : 'default'">Tutup</button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }

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
  protected readonly emailIsValid = computed(() =>
    this.isValidEmail(this.email().trim()),
  );
  protected readonly state = signal<LoginState>('idle');
  protected readonly alert = signal<LoginAlert | null>(null);
  protected readonly alertOpen = signal(false);
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
      this.showAlert({
        status: 'gagal',
        keterangan: 'Email yang dimasukkan tidak valid',
      });
      return;
    }

    this.state.set('submitting');
    this.auth.requestMagicLink(email, this.tauri.magicLinkOptions()).subscribe({
      next: (response) => {
        this.state.set('idle');
        this.showAlert(response);
      },
      error: (error: unknown) => {
        this.state.set('idle');
        this.showAlert({
          status: 'gagal',
          keterangan:
            error instanceof GatewayRequestError && error.status === 429
              ? 'Terlalu banyak permintaan. Silakan coba lagi beberapa menit lagi.'
              : 'Layanan login sedang tidak tersedia. Silakan coba lagi nanti.',
        });
      },
    });
  }

  reset(): void {
    this.state.set('idle');
    this.alertOpen.set(false);
    this.alert.set(null);
  }

  protected alertLabel(status: LoginAlertStatus): string {
    return status === 'gagal'
      ? 'Gagal'
      : status === 'belum_verifikasi'
        ? 'Belum verifikasi'
        : 'Berhasil';
  }

  protected alertIcon(status: LoginAlertStatus): string {
    return status === 'gagal'
      ? 'error'
      : status === 'belum_verifikasi'
        ? 'mark_email_unread'
        : 'check_circle';
  }

  protected alertMediaClass(): string {
    const status = this.alert()?.status;

    return status === 'gagal'
      ? 'border-destructive/20 bg-destructive/10 text-destructive'
      : status === 'belum_verifikasi'
        ? 'border-accent/30 bg-accent/10 text-accent-foreground'
        : 'border-primary/20 bg-primary/10 text-primary';
  }

  protected alertTextClass(): string {
    const status = this.alert()?.status;

    return status === 'gagal'
      ? 'text-destructive'
      : status === 'belum_verifikasi'
        ? 'text-accent-foreground'
        : 'text-primary';
  }

  private showAlert(alert: LoginAlert): void {
    this.alert.set(alert);
    this.alertOpen.set(true);
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
