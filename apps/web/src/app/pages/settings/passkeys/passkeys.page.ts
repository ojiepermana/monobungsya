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
  MAX_PASSKEYS,
  type Passkey,
  PasskeyService,
} from '../../../auth/passkey.service';

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
  ],
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header>
        <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Settings</p>
        <h1 class="mt-2 text-2xl font-semibold text-foreground">Passkey</h1>
        <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
          Passkey membuat Anda bisa masuk dengan sidik jari, face unlock, atau kunci keamanan,
          tanpa menunggu email. Magic link tetap bisa dipakai kapan saja, jadi menghapus semua
          passkey aman.
        </p>
      </header>

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
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-muted-foreground">
            {{ passkeys().length }} dari {{ maxPasskeys }} passkey terpakai.
          </p>
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
        </div>

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
          <div class="overflow-auto border border-border bg-card">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" class="px-4 py-3">Nama</th>
                  <th scope="col" class="px-4 py-3">Dibuat</th>
                  <th scope="col" class="px-4 py-3">Terakhir dipakai</th>
                  <th scope="col" class="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                @for (passkey of passkeys(); track passkey.id) {
                  <tr class="border-b border-border last:border-0">
                    <td class="px-4 py-3">
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
                    <td class="px-4 py-3 text-muted-foreground">{{ asDate(passkey.createdAt) }}</td>
                    <td class="px-4 py-3 text-muted-foreground">
                      {{ passkey.lastUsedAt ? asDate(passkey.lastUsedAt) : 'Belum pernah' }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex justify-end gap-2">
                        @if (editingId() === passkey.id) {
                          <button Button size="xs" type="button" [disabled]="busy()" (click)="saveLabel(passkey)">
                            Simpan
                          </button>
                          <button Button size="xs" type="button" variant="outline" (click)="cancelEdit()">
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
            </table>
          </div>
        }
      </section>
    </main>
  `,
})
export class PasskeysSettingsPage {
  private readonly passkey = inject(PasskeyService);

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

  constructor() {
    void this.passkey
      .load()
      .catch((error: unknown) =>
        this.report(error, 'Daftar passkey gagal dimuat.'),
      )
      .finally(() => this.loading.set(false));
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
