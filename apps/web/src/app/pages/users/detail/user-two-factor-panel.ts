import { Component, effect, inject, input, signal } from '@angular/core';
import {
  AlertComponent,
  AlertDescriptionComponent,
  AlertTitleComponent,
} from '@ojiepermana/angular/component/alert';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { InputComponent } from '@ojiepermana/angular/component/input';
import { TotpService, type TotpStatus } from '../../../auth/totp.service';

@Component({
  selector: 'app-user-two-factor-panel',
  imports: [
    AlertComponent,
    AlertDescriptionComponent,
    AlertTitleComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <section class="grid gap-4 border border-border bg-card p-5">
      <div><h2 class="text-base font-semibold">Two factor authentication</h2><p class="mt-1 text-sm text-muted-foreground">Admin dapat mewajibkan atau mereset 2FA. Secret dan recovery code tidak pernah ditampilkan.</p></div>
      @if (status(); as state) {
        <dl class="grid gap-3 text-sm sm:grid-cols-3"><div><dt class="text-xs uppercase text-muted-foreground">Status</dt><dd class="mt-1">{{ state.enabled ? 'Aktif' : 'Tidak aktif' }}</dd></div><div><dt class="text-xs uppercase text-muted-foreground">Wajib</dt><dd class="mt-1">{{ state.required ? 'Ya' : 'Tidak' }}</dd></div><div><dt class="text-xs uppercase text-muted-foreground">Recovery tersisa</dt><dd class="mt-1">{{ state.recoveryCodesRemaining }}</dd></div></dl>
        <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input Input type="text" placeholder="Alasan wajib diisi" [value]="reason()" (input)="updateReason($event)" /><button Button size="xs" type="button" [disabled]="busy() || !reason().trim()" (click)="setRequired(!state.required)">{{ state.required ? 'Cabut kewajiban' : 'Wajibkan 2FA' }}</button><button Button size="xs" type="button" variant="destructive" [disabled]="busy() || !reason().trim()" (click)="reset()">Reset 2FA</button></div>
      } @else { <p class="text-sm text-muted-foreground">Memuat status 2FA...</p> }
      @if (message(); as text) { <Alert [variant]="failed() ? 'destructive' : 'default'"><AlertTitle>{{ failed() ? 'Gagal' : 'Status' }}</AlertTitle><AlertDescription>{{ text }}</AlertDescription></Alert> }
    </section>
  `,
})
export class UserTwoFactorPanel {
  readonly userId = input.required<string>();
  private readonly totp = inject(TotpService);
  protected readonly status = signal<TotpStatus | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    effect(() => this.load(this.userId()));
  }

  protected updateReason(event: Event): void {
    this.reason.set((event.target as HTMLInputElement).value);
  }

  protected setRequired(required: boolean): void {
    this.busy.set(true);
    this.totp.setRequirement(this.userId(), required, this.reason()).subscribe({
      next: () => {
        this.status.update((status) =>
          status ? { ...status, required } : status,
        );
        this.note(required ? '2FA diwajibkan.' : 'Kewajiban 2FA dicabut.');
      },
      error: () => this.fail('Kewajiban 2FA gagal diubah.'),
      complete: () => this.busy.set(false),
    });
  }

  protected reset(): void {
    this.busy.set(true);
    this.totp.adminReset(this.userId(), this.reason()).subscribe({
      next: () => {
        this.status.update((status) =>
          status
            ? {
                ...status,
                enabled: false,
                confirmedAt: null,
                recoveryCodesRemaining: 0,
              }
            : status,
        );
        this.note('2FA direset dan semua sesi user dicabut.');
      },
      error: () => this.fail('Reset 2FA gagal.'),
      complete: () => this.busy.set(false),
    });
  }

  private load(userId: string): void {
    this.totp.adminStatus(userId).subscribe({
      next: (status) => this.status.set(status),
      error: () => this.fail('Status 2FA gagal dimuat.'),
    });
  }
  private note(text: string): void {
    this.failed.set(false);
    this.message.set(text);
    this.reason.set('');
    this.busy.set(false);
  }
  private fail(text: string): void {
    this.failed.set(true);
    this.message.set(text);
    this.busy.set(false);
  }
}
