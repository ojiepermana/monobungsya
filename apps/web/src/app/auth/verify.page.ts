import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { TauriService } from '../desktop/tauri.service';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-verify-page',
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
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page variant="stacked" height="fix" scroll="content" appearance="flat" [appsLauncher]="false" class="h-full min-h-0 bg-background text-foreground">
      <PageHeader class="flex items-center px-4">
        <div class="mx-auto flex h-full w-full max-w-lg items-center">
          <h1 class="truncate text-base font-semibold leading-tight text-foreground sm:text-lg">{{ title() }}</h1>
        </div>
      </PageHeader>

      <PageContent class="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-10">
        <Card class="block w-full max-w-lg">
          <CardHeader>
            <CardTitle>{{ title() }}</CardTitle>
            <p CardDescription>{{ description() }}</p>
          </CardHeader>

          <CardContent>
            @if (status() === 'verifying') {
              <div class="rounded-md border border-border bg-muted px-4 py-3 text-sm">
                Memverifikasi link...
              </div>
            } @else if (status() === 'success') {
              <Alert>
                <AlertTitle>Login berhasil</AlertTitle>
                <AlertDescription>Anda akan diarahkan ke dashboard.</AlertDescription>
              </Alert>
              <a Button size="xs" routerLink="/" class="mt-5 w-full gap-1.5"><Icon name="home" [size]="14" />Buka dashboard</a>
            } @else {
              <Alert variant="destructive">
                <AlertTitle>Verifikasi gagal</AlertTitle>
                <AlertDescription>{{ message() }}</AlertDescription>
              </Alert>
              <a Button size="xs" variant="outline" routerLink="/login" class="mt-5 w-full gap-1.5"><Icon name="arrow_back" [size]="14" />Kembali ke login</a>
            }
          </CardContent>
        </Card>
      </PageContent>

      <PageFooter class="flex items-center px-4">
        <p class="mx-auto w-full max-w-lg truncate text-xs text-muted-foreground sm:text-sm">
          Gunakan ulang halaman login jika link tidak valid atau sudah kedaluwarsa.
        </p>
      </PageFooter>
    </Page>
  `,
})
export class VerifyPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly tauri = inject(TauriService);

  protected readonly status = signal<'verifying' | 'success' | 'expired' | 'invalid' | 'missing'>(
    'verifying',
  );
  protected readonly message = signal('Mohon tunggu sebentar.');

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    const desktop = this.route.snapshot.queryParamMap.get('desktop') === '1';
    const callback = this.route.snapshot.data['callback'];

    // Remove the bearer token from browser history and screenshots immediately.
    window.history.replaceState(window.history.state, '', window.location.pathname);

    if (callback === 'success') {
      this.status.set('success');
      this.message.set('Login berhasil. Anda dapat melanjutkan ke dashboard.');
      return;
    }

    if (callback === 'error') {
      this.status.set('invalid');
      this.message.set('Link tidak valid atau sudah kedaluwarsa.');
      return;
    }

    if (desktop && token) {
      this.message.set('Membuka aplikasi desktop Monobungsya.');
      this.tauri.redirectToDesktopAuth(token);
      return;
    }

    this.auth.verifyMagicLink(token).subscribe({
      next: (response) => {
        this.status.set(response.status === 'sent' ? 'invalid' : response.status);
        this.message.set(response.message);

        if (response.status === 'success') {
          window.setTimeout(() => void this.router.navigateByUrl('/'), 900);
        }
      },
      error: () => {
        this.status.set('invalid');
        this.message.set('Link tidak valid atau sudah pernah digunakan.');
      },
    });
  }

  title(): string {
    return this.status() === 'success' ? 'Login berhasil' : 'Verifikasi magic link';
  }

  description(): string {
    if (this.status() === 'verifying') {
      return 'Kami sedang menyiapkan sesi login Anda.';
    }

    return this.message();
  }
}
