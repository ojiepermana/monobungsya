import { Component, input, model, output, signal } from '@angular/core';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import {
  DialogCloseDirective,
  DialogComponent,
  DialogContentComponent,
  DialogDescriptionComponent,
  DialogFooterComponent,
  DialogHeaderComponent,
  DialogTitleComponent,
} from '@ojiepermana/angular/component/dialog';
import { LabelComponent } from '@ojiepermana/angular/component/label';
import { TextareaComponent } from '@ojiepermana/angular/component/textarea';

/**
 * Confirms one status action and collects the mandatory reason that lands in
 * the audit trail (spec docs/specs/0007-user-management, AC-4 and AC-7). The
 * reason is required, so the confirm button stays disabled until it is filled.
 */
@Component({
  selector: 'app-reason-dialog',
  imports: [
    ButtonComponent,
    DialogCloseDirective,
    DialogComponent,
    DialogContentComponent,
    DialogDescriptionComponent,
    DialogFooterComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    LabelComponent,
    TextareaComponent,
  ],
  template: `
    <Dialog [(open)]="open" class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ title() }}</DialogTitle>
        <DialogDescription>{{ description() }}</DialogDescription>
      </DialogHeader>

      <DialogContent class="grid gap-2 py-2">
        <label Label for="reason-field">Alasan</label>
        <textarea
          Textarea
          id="reason-field"
          rows="3"
          placeholder="Alasan tindakan ini, tersimpan di audit trail"
          [value]="reason()"
          (input)="updateReason($event)"
        ></textarea>
        @if (error()) {
          <p class="text-sm text-destructive" role="alert">{{ error() }}</p>
        }
      </DialogContent>

      <DialogFooter>
        <button Button variant="outline" type="button" DialogClose (click)="cancel()">Batal</button>
        <button
          Button
          type="button"
          [variant]="destructive() ? 'destructive' : 'default'"
          [disabled]="busy() || reason().trim().length < 3"
          (click)="confirm()"
        >
          {{ busy() ? 'Menyimpan...' : confirmLabel() }}
        </button>
      </DialogFooter>
    </Dialog>
  `,
})
export class ReasonDialog {
  readonly open = model(false);
  readonly title = input('Konfirmasi');
  readonly description = input('');
  readonly confirmLabel = input('Konfirmasi');
  readonly destructive = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly confirmed = output<string>();

  protected readonly reason = signal('');

  protected updateReason(event: Event): void {
    this.reason.set((event.target as HTMLTextAreaElement).value);
  }

  protected cancel(): void {
    this.reason.set('');
    this.open.set(false);
  }

  protected confirm(): void {
    this.confirmed.emit(this.reason().trim());
  }

  /** Called by the host once the action succeeded, so the next open is clean. */
  reset(): void {
    this.reason.set('');
  }
}
