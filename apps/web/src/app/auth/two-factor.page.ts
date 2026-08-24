import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { QRCodeComponent } from 'angularx-qrcode';
import { firstValueFrom, type Observable } from 'rxjs';
import { AuthService } from './auth.service';
import {
  type TotpEnrollment,
  type TotpRecoveryCodes,
  TotpService,
} from './totp.service';

type TotpVerifyResult = { authenticated: true; redirectTo: string };

@Component({
  selector: 'app-two-factor-page',
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
    InputComponent,
    QRCodeComponent,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" height="fix" scroll="content" appearance="flat" [appsLauncher]="false" class="h-full min-h-0 bg-background text-foreground">
      <PageHeader class="flex items-center px-4"><div class="mx-auto w-full max-w-lg"><h1 class="text-lg font-semibold">{{ enrolling ? 'Aktifkan 2FA' : 'Verifikasi dua faktor' }}</h1></div></PageHeader>
      <PageContent class="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-10">
        <Card class="block w-full max-w-lg">
          <CardHeader>
            <CardTitle level="2">{{ enrolling ? 'Siapkan aplikasi authenticator' : 'Masukkan kode authenticator' }}</CardTitle>
            <p CardDescription>{{ enrolling ? 'Pindai QR atau masukkan secret secara manual, lalu masukkan kode 6 digit.' : 'Faktor pertama berhasil. Sesi belum dibuat sampai kode Anda benar.' }}</p>
          </CardHeader>
          <CardContent>
            @if (error(); as message) { <Alert variant="destructive" class="mb-4"><AlertTitle>Verifikasi gagal</AlertTitle><AlertDescription>{{ message }}</AlertDescription></Alert> }
            @if (enrolling && enrollment(); as setup) {
              <div class="grid gap-4">
                <div class="flex justify-center rounded border border-border bg-white p-4"><qrcode [qrdata]="setup.otpauthUri" [width]="220" [margin]="1" elementType="img" alt="QR code untuk authenticator" ariaLabel="QR code untuk authenticator" /></div>
                <div><p class="text-xs text-muted-foreground">Secret manual</p><code class="mt-1 block break-all rounded bg-muted p-3 text-sm">{{ setup.secret }}</code></div>
              </div>
            }
            @if (recoveryCodes(); as codes) {
              <Alert class="mb-4"><AlertTitle>Simpan recovery codes</AlertTitle><AlertDescription>Setiap code hanya bisa dipakai sekali. Ini satu satunya tampilan code tersebut.</AlertDescription></Alert>
              <div class="grid grid-cols-2 gap-2 rounded border border-border bg-muted p-4 font-mono text-sm">@for (code of codes; track code) { <span>{{ code }}</span> }</div>
              <a Button size="xs" routerLink="/" class="mt-5 w-full">Lanjutkan</a>
            } @else {
              <form class="grid gap-4" (submit)="submit($event)">
                <div class="grid gap-2"><label for="totp-code" class="text-sm font-medium">Kode 6 digit</label><input id="totp-code" Input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [value]="code()" (input)="updateCode($event)" /></div>
                @if (!enrolling) { <div class="grid gap-2"><label for="recovery-code" class="text-sm font-medium">Atau recovery code</label><input id="recovery-code" Input type="text" autocomplete="off" [value]="recoveryCode()" (input)="updateRecoveryCode($event)" /></div> }
                <button Button type="submit" [disabled]="busy() || (enrolling ? !enrollment() : false)">{{ busy() ? 'Memeriksa...' : enrolling ? 'Aktifkan 2FA' : 'Verifikasi dan masuk' }}</button>
              </form>
            }
          </CardContent>
        </Card>
      </PageContent>
      <PageFooter class="flex items-center px-4"><p class="mx-auto w-full max-w-lg text-xs text-muted-foreground">Gunakan recovery code jika perangkat authenticator tidak tersedia.</p></PageFooter>
    </Page>
  `,
})
export class TwoFactorPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly totp = inject(TotpService);

  protected readonly enrolling =
    (this.route.snapshot.data as { purpose?: string }).purpose === 'enroll';
  protected readonly enrollment = signal<TotpEnrollment | null>(null);
  protected readonly recoveryCodes = signal<string[] | null>(null);
  protected readonly code = signal('');
  protected readonly recoveryCode = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (this.enrolling) {
      this.totp.enroll().subscribe({
        next: (setup) => {
          this.enrollment.set(setup);
        },
        error: () => this.error.set('De enrollment kon niet worden gestart.'),
      });
    }
  }

  protected updateCode(event: Event): void {
    this.code.set(
      (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6),
    );
  }
  protected updateRecoveryCode(event: Event): void {
    this.recoveryCode.set((event.target as HTMLInputElement).value.trim());
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.busy.set(true);
    this.error.set(null);
    const request: Observable<TotpRecoveryCodes | TotpVerifyResult> = this
      .enrolling
      ? this.totp.confirm(this.code())
      : this.totp.verify(
          this.code() || undefined,
          this.recoveryCode() || undefined,
        );
    request.subscribe({
      next: (result) => {
        this.busy.set(false);
        if (this.enrolling && 'recoveryCodes' in result) {
          this.recoveryCodes.set(result.recoveryCodes);
          return;
        }
        void firstValueFrom(this.auth.loadCurrentUser()).then(() =>
          this.router.navigateByUrl('/'),
        );
      },
      error: (failure: { error?: { error?: { message?: string } } }) => {
        this.busy.set(false);
        this.error.set(
          failure.error?.error?.message ??
            'Kode tidak valid atau sudah kedaluwarsa.',
        );
      },
    });
  }
}
