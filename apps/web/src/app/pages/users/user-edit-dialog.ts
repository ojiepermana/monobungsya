import {
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
} from '@angular/core';
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
import { InputComponent } from '@ojiepermana/angular/component/input';
import { LabelComponent } from '@ojiepermana/angular/component/label';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
import type { AuthRole } from '../../auth/auth.service';
import type { UpdateUserPayload, UserRecord } from '../../services/api.service';

/**
 * Edits a user's name and role. Email is shown but not editable: it cannot be
 * changed through the API (spec docs/specs/0007-user-management, AC-3), because
 * it is the login identity and stays unique across every row.
 *
 * Shared by the list page and the detail page so both offer the same edit.
 */
@Component({
  selector: 'app-user-edit-dialog',
  imports: [
    ButtonComponent,
    DialogCloseDirective,
    DialogComponent,
    DialogContentComponent,
    DialogDescriptionComponent,
    DialogFooterComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    InputComponent,
    LabelComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
  ],
  template: `
    <Dialog [(open)]="open" class="max-w-lg">
      <DialogHeader>
        <DialogTitle>Ubah User</DialogTitle>
        <DialogDescription>Nama dan role bisa diubah. Email tidak bisa diubah.</DialogDescription>
      </DialogHeader>

      <DialogContent class="grid gap-4 py-2">
        <div class="grid gap-2">
          <label Label for="edit-name">Nama</label>
          <input Input id="edit-name" [value]="name()" (input)="setName($event)" />
        </div>
        <div class="grid gap-2">
          <label Label for="edit-role">Role</label>
          <select NativeSelect id="edit-role" [value]="role()" (change)="setRole($event)">
            @for (option of roles(); track option) {
              <option NativeSelectOption [value]="option" [selected]="option === role()">{{ option }}</option>
            }
          </select>
        </div>
        <p class="text-xs text-muted-foreground">{{ user()?.email }}</p>
        @if (error()) {
          <p class="text-sm text-destructive" role="alert">{{ error() }}</p>
        }
      </DialogContent>

      <DialogFooter>
        <button Button variant="outline" type="button" DialogClose>Batal</button>
        <button Button type="button" [disabled]="busy() || !changed()" (click)="submit()">
          {{ busy() ? 'Menyimpan...' : 'Simpan' }}
        </button>
      </DialogFooter>
    </Dialog>
  `,
})
export class UserEditDialog {
  readonly open = model(false);
  readonly user = input<UserRecord | null>(null);
  readonly roles = input<AuthRole[]>([]);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly saved = output<UpdateUserPayload>();

  protected readonly name = signal('');
  protected readonly role = signal<AuthRole>('staff');

  /** Reloads the fields whenever a different user is put into the dialog. */
  constructor() {
    effect(() => {
      const user = this.user();

      if (user) {
        this.name.set(user.name);
        this.role.set(user.role);
      }
    });
  }

  protected readonly changed = computed(() => {
    const user = this.user();

    if (!user) {
      return false;
    }

    return (
      this.name().trim().length > 0 &&
      (this.name().trim() !== user.name || this.role() !== user.role)
    );
  });

  protected setName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected setRole(event: Event): void {
    this.role.set((event.target as HTMLSelectElement).value as AuthRole);
  }

  /** Only the fields that actually changed are sent. */
  protected submit(): void {
    const user = this.user();

    if (!user) {
      return;
    }

    const payload: UpdateUserPayload = {};

    if (this.name().trim() !== user.name) {
      payload.name = this.name().trim();
    }

    if (this.role() !== user.role) {
      payload.role = this.role();
    }

    this.saved.emit(payload);
  }
}
