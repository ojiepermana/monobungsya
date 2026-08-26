import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertComponent,
  AlertDescriptionComponent,
  AlertTitleComponent,
} from '@ojiepermana/angular/component/alert';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  TableBodyComponent,
  TableCaptionComponent,
  TableCellComponent,
  TableComponent,
  TableHeadComponent,
  TableHeaderComponent,
  TableRowComponent,
} from '@ojiepermana/angular/component/table';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { QRCodeComponent } from 'angularx-qrcode';
import {
  MAX_PASSKEYS,
  type Passkey,
  PasskeyService,
} from '../../../auth/passkey.service';
import {
  type TotpEnrollment,
  TotpService,
  type TotpStatus,
} from '../../../auth/totp.service';

@Component({
  selector: 'app-passkeys-settings-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    AlertComponent,
    AlertDescriptionComponent,
    AlertTitleComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    QRCodeComponent,
    TableBodyComponent,
    TableCaptionComponent,
    TableCellComponent,
    TableComponent,
    TableHeadComponent,
    TableHeaderComponent,
    TableRowComponent,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page
      variant="stacked"
      scroll="content"
      [appearance]="layout.appearance()"
      class="h-full min-h-0"
    >
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <Icon name="fingerprint" [size]="18" class="shrink-0 text-primary" aria-hidden="true" />
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Settings</p>
          <h1 class="truncate text-lg font-semibold text-foreground">Passkey</h1>
        </div>
        @if (supported) {
          <button
            Button
            size="xs"
            type="button"
            class="gap-1.5"
            [disabled]="busy() || full()"
            (click)="add()"
          >
            <Icon name="fingerprint" [size]="14" />
            {{ busy() ? 'Menunggu passkey...' : 'Tambah passkey' }}
          </button>
        }
      </PageHeader>

      <PageContent class="grid min-h-0 content-start">
        <section class="grid gap-4 border-b border-border bg-card p-5">
          <div><h2 class="text-base font-semibold">Two factor authentication</h2><p class="mt-1 text-sm text-muted-foreground">Gunakan kode 6 digit dari aplikasi authenticator. Recovery code hanya ditampilkan sekali.</p></div>
          @if (totpStatus(); as status) {
            @if (status.enabled) {
              <p class="text-sm text-foreground">Aktif sejak {{ status.confirmedAt ? asDate(status.confirmedAt) : '-' }}. Recovery code tersisa {{ status.recoveryCodesRemaining }}.</p>
              <div class="flex flex-wrap gap-2"><input Input type="text" inputmode="numeric" maxlength="6" placeholder="Kode 6 digit" [value]="totpCode()" (input)="updateTotpCode($event)" /><button Button size="xs" type="button" variant="outline" [disabled]="totpBusy()" (click)="regenerateTotp()">Buat recovery code baru</button><button Button size="xs" type="button" variant="destructive" [disabled]="totpBusy()" (click)="disableTotp()">Matikan 2FA</button></div>
            } @else if (totpSetup(); as setup) {
              <div class="grid gap-3 sm:grid-cols-[auto_1fr]"><div class="rounded-base bg-white p-3"><qrcode [qrdata]="setup.otpauthUri" [width]="180" [margin]="1" elementType="img" alt="QR code TOTP" ariaLabel="QR code TOTP" /></div><div class="grid content-start gap-3"><p class="text-xs text-muted-foreground">Secret manual</p><code class="break-all rounded-base bg-muted p-3 text-sm">{{ setup.secret }}</code><div class="flex gap-2"><input Input type="text" inputmode="numeric" maxlength="6" placeholder="Kode 6 digit" [value]="totpCode()" (input)="updateTotpCode($event)" /><button Button size="xs" type="button" [disabled]="totpBusy()" (click)="confirmTotp()">Konfirmasi</button></div></div></div>
            } @else {
              <button Button size="xs" type="button" class="w-fit" [disabled]="totpBusy()" (click)="beginTotp()">Aktifkan 2FA</button>
            }
            @if (totpRecoveryCodes().length > 0) { <Alert><AlertTitle>Simpan recovery codes</AlertTitle><AlertDescription><div class="mt-2 grid grid-cols-2 gap-2 font-mono">@for (code of totpRecoveryCodes(); track code) { <span>{{ code }}</span> }</div></AlertDescription></Alert> }
          } @else { <p class="text-sm text-muted-foreground">Memuat status 2FA...</p> }
        </section>

        @if (message(); as messageText) {
          <Alert [variant]="failed() ? 'destructive' : 'default'">
            <AlertTitle>{{ failed() ? 'Gagal' : 'Status' }}</AlertTitle>
            <AlertDescription>{{ messageText }}</AlertDescription>
          </Alert>
        }

        @if (!supported) {
          <Alert>
            <AlertTitle>Passkey belum tersedia di perangkat ini</AlertTitle>
            <AlertDescription>
              Aplikasi desktop dan browser tanpa dukungan WebAuthn tetap memakai magic link.
              Passkey yang sudah terdaftar masih bisa dilihat dan dihapus di sini.
            </AlertDescription>
          </Alert>
        }

        <section class="grid gap-3">

        @if (full()) {
          <p class="text-xs text-muted-foreground">
            Batas {{ maxPasskeys }} passkey tercapai. Hapus satu untuk menambah yang baru.
          </p>
        }

        @if (loading()) {
          <p class="text-sm text-muted-foreground">Memuat passkey...</p>
        } @else if (passkeys().length === 0) {
          <p class="border border-border bg-card p-5 text-sm text-muted-foreground">
            Belum ada passkey terdaftar.
          </p>
        } @else {
          <Table class="min-w-full rounded-base bg-card text-xs">
            <caption TableCaption class="sr-only">Daftar passkey</caption>
              <thead TableHeader class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground">
                <tr TableRow>
                  <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Nama</th>
                  <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Dibuat</th>
                  <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Terakhir dipakai</th>
                  <th TableHead scope="col" class="bg-card text-right shadow-[inset_0_-1px_0_0_var(--color-border)]">Aksi</th>
                </tr>
              </thead>
              <tbody TableBody>
                @for (passkey of passkeys(); track passkey.id) {
                  <tr TableRow class="align-top">
                    <td TableCell>
                      @if (editingId() === passkey.id) {
                        <label class="sr-only" [attr.for]="'passkey-label-' + passkey.id">
                          Nama passkey
                        </label>
                        <input
                          [id]="'passkey-label-' + passkey.id"
                          Input
                          type="text"
                          maxlength="100"
                          class="max-w-xs"
                          [value]="draftLabel()"
                          (input)="updateDraft($event)"
                          (keydown.enter)="saveLabel(passkey)"
                          (keydown.escape)="cancelEdit()"
                        />
                      } @else {
                        <span class="font-medium text-foreground">{{ passkey.label }}</span>
                        @if (passkey.backupState) {
                          <span class="ml-2 text-xs text-muted-foreground">tersinkron</span>
                        }
                      }
                    </td>
                    <td TableCell class="text-muted-foreground">{{ asDate(passkey.createdAt) }}</td>
                    <td TableCell class="text-muted-foreground">
                      {{ passkey.lastUsedAt ? asDate(passkey.lastUsedAt) : 'Belum pernah' }}
                    </td>
                    <td TableCell>
                      <div class="flex justify-end gap-2">
                        @if (editingId() === passkey.id) {
                          <button Button size="xs" type="button" class="gap-1.5" [disabled]="busy()" (click)="saveLabel(passkey)">
                            <Icon name="save" [size]="14" aria-hidden="true" />
                            Simpan
                          </button>
                          <button Button size="xs" type="button" variant="outline" class="gap-1.5" (click)="cancelEdit()">
                            <Icon name="close" [size]="14" aria-hidden="true" />
                            Batal
                          </button>
                        } @else {
                          <button
                            Button
                            size="xs"
                            type="button"
                            variant="outline"
                            class="gap-1.5"
                            [disabled]="busy()"
                            (click)="startEdit(passkey)"
                          >
                            <Icon name="edit" [size]="14" />
                            Ganti nama
                          </button>
                          <button
                            Button
                            size="xs"
                            type="button"
                            variant="outline"
                            class="gap-1.5"
                            [disabled]="busy()"
                            (click)="remove(passkey)"
                          >
                            <Icon name="delete" [size]="14" />
                            Hapus
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </Table>
        }
        </section>
      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">
          {{ passkeys().length }} dari {{ maxPasskeys }} passkey terpakai
        </p>
        <p class="text-xs text-muted-foreground">
          Magic link tetap tersedia sebagai metode masuk dan pemulihan.
        </p>
      </PageFooter>
    </Page>
  `,
})
export class PasskeysSettingsPage {
  private readonly passkey = inject(PasskeyService);
  private readonly totp = inject(TotpService);

  protected readonly layout = inject(LayoutService);
  protected readonly maxPasskeys = MAX_PASSKEYS;
  protected readonly supported = this.passkey.supported();
  protected readonly passkeys = this.passkey.passkeys;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draftLabel = signal('');
  protected readonly full = computed(
    () => this.passkeys().length >= MAX_PASSKEYS,
  );
  protected readonly totpStatus = signal<TotpStatus | null>(null);
  protected readonly totpSetup = signal<TotpEnrollment | null>(null);
  protected readonly totpRecoveryCodes = signal<string[]>([]);
  protected readonly totpCode = signal('');
  protected readonly totpBusy = signal(false);

  constructor() {
    void this.passkey
      .load()
      .catch((error: unknown) =>
        this.report(error, 'Daftar passkey gagal dimuat.'),
      )
      .finally(() => this.loading.set(false));
    this.totp.status().subscribe({
      next: (status) => this.totpStatus.set(status),
    });
  }

  updateTotpCode(event: Event): void {
    this.totpCode.set(
      (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6),
    );
  }

  beginTotp(): void {
    this.totpBusy.set(true);
    this.totp.enroll().subscribe({
      next: (setup) => {
        this.totpSetup.set(setup);
        this.totpBusy.set(false);
      },
      error: () => {
        this.note('Enrollment 2FA gagal dimulai.');
        this.totpBusy.set(false);
      },
    });
  }

  confirmTotp(): void {
    this.totpBusy.set(true);
    this.totp.confirm(this.totpCode()).subscribe({
      next: (result) => {
        this.totpRecoveryCodes.set(result.recoveryCodes);
        this.totpSetup.set(null);
        this.totpCode.set('');
        this.totpStatus.update((status) =>
          status
            ? { ...status, enabled: true, recoveryCodesRemaining: 10 }
            : status,
        );
        this.totpBusy.set(false);
      },
      error: () => {
        this.note('Kode 2FA tidak valid.');
        this.totpBusy.set(false);
      },
    });
  }

  regenerateTotp(): void {
    this.totpBusy.set(true);
    this.totp.regenerateRecoveryCodes(this.totpCode()).subscribe({
      next: (result) => {
        this.totpRecoveryCodes.set(result.recoveryCodes);
        this.totpCode.set('');
        this.totpStatus.update((status) =>
          status ? { ...status, recoveryCodesRemaining: 10 } : status,
        );
        this.totpBusy.set(false);
      },
      error: () => {
        this.note('Kode 2FA tidak valid.');
        this.totpBusy.set(false);
      },
    });
  }

  disableTotp(): void {
    if (!this.totpCode()) {
      this.note('Masukkan kode 2FA untuk mematikan 2FA.');
      return;
    }
    this.totpBusy.set(true);
    this.totp.disable(this.totpCode()).subscribe({
      next: () => {
        this.totpStatus.set({
          enabled: false,
          confirmedAt: null,
          required: false,
          recoveryCodesRemaining: 0,
        });
        this.totpCode.set('');
        this.note('2FA dimatikan.');
        this.totpBusy.set(false);
      },
      error: () => {
        this.note('Kode 2FA tidak valid.');
        this.totpBusy.set(false);
      },
    });
  }

  add(): void {
    this.busy.set(true);
    this.clearMessage();

    void this.passkey
      .register()
      .then((created) =>
        this.note(`Passkey "${created.label}" berhasil didaftarkan.`),
      )
      .catch((error: unknown) =>
        this.report(error, 'Passkey gagal didaftarkan.'),
      )
      .finally(() => this.busy.set(false));
  }

  startEdit(passkey: Passkey): void {
    this.editingId.set(passkey.id);
    this.draftLabel.set(passkey.label);
    this.clearMessage();
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.draftLabel.set('');
  }

  updateDraft(event: Event): void {
    this.draftLabel.set((event.target as HTMLInputElement).value);
  }

  saveLabel(passkey: Passkey): void {
    const label = this.draftLabel().trim();

    if (label.length === 0) {
      this.report(null, 'Nama passkey tidak boleh kosong.');
      return;
    }

    if (label === passkey.label) {
      this.cancelEdit();
      return;
    }

    this.busy.set(true);
    this.clearMessage();

    void this.passkey
      .rename(passkey.id, label)
      .then((updated) => {
        this.cancelEdit();
        this.note(`Nama passkey diubah menjadi "${updated.label}".`);
      })
      .catch((error: unknown) =>
        this.report(error, 'Nama passkey gagal diubah.'),
      )
      .finally(() => this.busy.set(false));
  }

  remove(passkey: Passkey): void {
    // Magic link stays available, so removing the last passkey never locks
    // anyone out. The confirmation is only there to prevent a slip.
    const confirmed = window.confirm(
      `Hapus passkey "${passkey.label}"? Anda tetap bisa masuk dengan magic link.`,
    );

    if (!confirmed) {
      return;
    }

    this.busy.set(true);
    this.clearMessage();

    void this.passkey
      .remove(passkey.id)
      .then(() => this.note(`Passkey "${passkey.label}" dihapus.`))
      .catch((error: unknown) => this.report(error, 'Passkey gagal dihapus.'))
      .finally(() => this.busy.set(false));
  }

  asDate(value: string): string {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
  }

  private note(text: string): void {
    this.failed.set(false);
    this.message.set(text);
  }

  private report(error: unknown, fallback: string): void {
    this.failed.set(true);
    this.message.set(this.passkey.messageFrom(error, fallback));
  }

  private clearMessage(): void {
    this.message.set(null);
    this.failed.set(false);
  }
}
