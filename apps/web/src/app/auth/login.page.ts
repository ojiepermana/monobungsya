import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlertComponent, AlertDescriptionComponent, AlertTitleComponent } from '@ojiepermana/angular/component/alert';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import {
  CardComponent,
  CardContentComponent,
  CardDescriptionComponent,
  CardHeaderComponent,
  CardTitleComponent,
} from '@ojiepermana/angular/component/card';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { TauriService } from '../desktop/tauri.service';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkey.service';

@Component({
  selector: 'app-login-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    RouterLink,
    AlertComponent,
    AlertDescriptionComponent,
    AlertTitleComponent,
    ButtonComponent,
    IconComponent,
    CardComponent,
    CardContentComponent,
    CardDescriptionComponent,
    CardHeaderComponent,
    CardTitleComponent,
    InputComponent,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page variant="stacked" height="fix" scroll="content" appearance="flat" [appsLauncher]="false" class="h-full min-h-0 bg-layout-canvas [--layout-grid-size:2rem] bg-[linear-gradient(var(--layout-grid-color)_1px,transparent_1px),linear-gradient(to_right,var(--layout-grid-color)_1px,transparent_1px)] bg-position-[center_center] bg-size-[var(--layout-grid-size)_var(--layout-grid-size)] text-foreground">
      <PageHeader class="invisible h-0 overflow-hidden" aria-hidden="true"></PageHeader>

      <PageContent class="flex h-full min-h-0 flex-1 items-center justify-center overflow-auto px-4 py-8 sm:px-6">
        <Card class="block w-full max-w-md">
          <CardHeader class="text-center">
            <CardTitle class="text-xl sm:text-2xl">Masuk ke Monobungsya</CardTitle>
            <p CardDescription>Gunakan email kantor atau email yang sudah terdaftar.</p>
          </CardHeader>

          <CardContent>
            @if (passkeySupported) {
              <div class="mb-5 grid gap-3">
                <button
                  Button
                  size="xs"
                  type="button"
                  class="w-full gap-1.5"
                  [disabled]="passkeyLoading()"
                  (click)="signInWithPasskey()"
                >
                  <Icon name="fingerprint" [size]="14" />
                  {{ passkeyLoading() ? 'Menunggu passkey...' : 'Masuk dengan passkey' }}
                </button>
                <div class="flex items-center gap-3 text-xs text-muted-foreground">
                  <span class="h-px flex-1 bg-border"></span>
                  atau gunakan email
                  <span class="h-px flex-1 bg-border"></span>
                </div>
              </div>
            }

            <form class="space-y-5" (submit)="send($event)">
              <label class="grid gap-2 text-sm font-medium" for="login-email">
                Email
                <input
                  id="login-email"
                  Input
                  type="email"
                  autocomplete="email"
                  placeholder="nama@monobungsya.id"
                  [value]="email()"
                  (input)="updateEmail($event)"
                />
              </label>

              <button Button size="xs" type="submit" class="w-full gap-1.5" [disabled]="loading()">
                <Icon name="mail" [size]="14" />
                {{ loading() ? 'Membuat link...' : 'Kirim magic link' }}
              </button>

              @if (localLoginEnabled()) {
                <button Button size="xs" type="button" variant="outline" class="w-full gap-1.5" [disabled]="loading()" (click)="loginLocally()">
                  <Icon name="login" [size]="14" />
                  Login lokal
                </button>
              }
            </form>

            @if (message(); as messageText) {
              <Alert class="mt-5">
                <AlertTitle>Status</AlertTitle>
                <AlertDescription>{{ messageText }}</AlertDescription>
              </Alert>
            }

            @if (magicLink(); as link) {
              <Alert class="mt-4">
                <AlertTitle>Development magic link</AlertTitle>
                <AlertDescription>
                  <a
                    class="font-medium underline underline-offset-4"
                    [routerLink]="['/verify']"
                    [queryParams]="{ token: tokenFrom(link), desktop: desktopFrom(link) }"
                  >
                    Buka tautan verifikasi
                  </a>
                </AlertDescription>
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

  /**
   * Read once, not per change detection: WebAuthn support and the Tauri runtime
   * cannot change while this page is open.
   */
  protected readonly passkeySupported = this.passkey.supported();

  protected readonly email = signal('');
  protected readonly loading = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly magicLink = signal<string | null>(null);
  protected readonly localLoginEnabled = signal(false);
  protected readonly passkeyLoading = signal(false);

  constructor() {
    this.auth.localDevLoginStatus().subscribe({
      next: (response) => {
        this.localLoginEnabled.set(response.enabled);
        if (response.email) {
          this.email.set(response.email);
        }
      },
      error: () => this.localLoginEnabled.set(false),
    });
  }

  updateEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
  }

  send(event: Event): void {
    event.preventDefault();
    this.loading.set(true);
    this.message.set(null);
    this.magicLink.set(null);

    this.auth.requestMagicLink(this.email(), this.tauri.magicLinkOptions()).subscribe({
      next: (response) => {
        this.message.set(response.message ?? 'Magic link berhasil diminta. Periksa inbox email Anda.');
        this.magicLink.set(response.magicLink ?? null);
        this.loading.set(false);
      },
      error: (error: { error?: { error?: string } }) => {
        this.message.set(error.error?.error ?? 'Magic link gagal dibuat.');
        this.loading.set(false);
      },
    });
  }

  signInWithPasskey(): void {
    this.passkeyLoading.set(true);
    this.message.set(null);
    this.magicLink.set(null);

    void this.passkey
      .signIn()
      .then(() => this.router.navigateByUrl('/'))
      .catch((error: unknown) => {
        this.message.set(
          this.passkey.messageFrom(error, 'Login dengan passkey gagal.'),
        );
      })
      .finally(() => this.passkeyLoading.set(false));
  }

  loginLocally(): void {
    this.loading.set(true);
    this.message.set(null);
    this.magicLink.set(null);

    this.auth.localDevLogin().subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (error: { error?: { error?: string } }) => {
        this.message.set(error.error?.error ?? 'Login lokal tidak tersedia.');
        this.loading.set(false);
      },
    });
  }

  tokenFrom(link: string): string {
    return new URL(link).searchParams.get('token') ?? '';
  }

  desktopFrom(link: string): string | null {
    return new URL(link).searchParams.get('desktop') === '1' ? '1' : null;
  }
}
