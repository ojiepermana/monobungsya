import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
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
import { v7 as uuidv7 } from 'uuid';
import { type AuthRole, AuthService } from '../../../auth/auth.service';
import {
  ApiService,
  type LogsMeta,
  type UpdateUserPayload,
  type UserRecord,
  type UserStatus,
  type UserStatusFilter,
} from '../../../services/api.service';
import { ReasonDialog } from '../reason-dialog';
import { UserEditDialog } from '../user-edit-dialog';
import {
  actionsFor,
  STATUS_LABELS,
  STATUS_VARIANTS,
  type StatusActionMeta,
  statusActionError,
} from '../user-status';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };

const STATUS_FILTER_LABELS: Array<{
  value: UserStatusFilter;
  label: string;
}> = [
  { value: '', label: 'Semua kecuali terhapus' },
  { value: 'active', label: 'Aktif' },
  { value: 'suspended', label: 'Ditangguhkan' },
  { value: 'blocked', label: 'Diblokir' },
  { value: 'deleted', label: 'Dihapus' },
  { value: 'all', label: 'Semua termasuk terhapus' },
];

interface DraftUser {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
}

/**
 * User list (spec docs/specs/0007-user-management, AC-9): search, status
 * filter with deleted hidden by default, paging at 25, status badges, the
 * create dialog, and the row actions for the status lifecycle.
 */
@Component({
  selector: 'app-users-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    BadgeComponent,
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
    ReasonDialog,
    RouterLink,
    UserEditDialog,
  ],
  template: `
    <main class="grid h-full min-h-0 content-start gap-6 overflow-auto p-6">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Users</p>
          <h1 class="mt-2 text-2xl font-semibold text-foreground">User Management</h1>
        </div>
        <button Button type="button" (click)="openCreate()">Tambah User</button>
      </header>

      <section class="grid gap-3 md:flex md:flex-wrap md:items-center">
        <input
          Input
          type="search"
          placeholder="Cari nama, email, atau role..."
          class="md:max-w-xs"
          [value]="search()"
          (input)="updateSearch($event)"
        />
        <select NativeSelect class="md:w-60" [value]="status()" (change)="updateStatus($event)">
          @for (option of statusFilters; track option.value) {
            <option NativeSelectOption [value]="option.value" [selected]="option.value === status()">
              {{ option.label }}
            </option>
          }
        </select>
        <button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">
          Clear Filters
        </button>
      </section>

      @if (error()) {
        <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat user...</p>
      } @else if (rows().length === 0) {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada user yang cocok.</p>
      } @else {
        <div class="overflow-auto border border-border bg-card">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th class="px-4 py-3">Nama</th>
                <th class="px-4 py-3">Email</th>
                <th class="px-4 py-3">Role</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Dibuat</th>
                <th class="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              @for (user of rows(); track user.id) {
                <tr class="border-b border-border align-top last:border-0">
                  <td class="px-4 py-3">
                    <a class="font-medium text-foreground underline-offset-4 hover:underline" [routerLink]="['/users', user.id]">
                      {{ user.name }}
                    </a>
                  </td>
                  <td class="px-4 py-3 text-muted-foreground">{{ user.email }}</td>
                  <td class="px-4 py-3">{{ user.role }}</td>
                  <td class="px-4 py-3">
                    <span Badge [variant]="statusVariant(user.status)">{{ statusLabel(user.status) }}</span>
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 font-mono text-xs">{{ formatDate(user.createdAt) }}</td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap justify-end gap-2">
                      @if (user.status !== 'deleted') {
                        <button Button size="xs" variant="outline" type="button" (click)="openEdit(user)">
                          Ubah
                        </button>
                      }
                      @for (action of actionsFor(user, callerId()); track action.action) {
                        <button
                          Button
                          size="xs"
                          type="button"
                          [variant]="action.destructive ? 'destructive' : 'outline'"
                          (click)="askFor(user, action)"
                        >
                          {{ action.label }}
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

      <footer class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">{{ pageLabel() }}</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page <= 1" (click)="goTo(1)">First</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page <= 1" (click)="goTo(meta().page - 1)">Previous</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page >= meta().totalPages" (click)="goTo(meta().page + 1)">Next</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="loading() || meta().page >= meta().totalPages" (click)="goTo(meta().totalPages)">Last</button>
        </div>
      </footer>

      <Dialog [(open)]="createOpen" class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah User</DialogTitle>
          <DialogDescription>
            User baru menerima email undangan berisi magic link dan bisa langsung login.
          </DialogDescription>
        </DialogHeader>

        <DialogContent class="grid gap-4 py-2">
          <div class="grid gap-2">
            <label Label for="create-name">Nama</label>
            <input Input id="create-name" [value]="draft().name" (input)="patchDraft('name', $event)" />
          </div>
          <div class="grid gap-2">
            <label Label for="create-email">Email</label>
            <input Input id="create-email" type="email" [value]="draft().email" (input)="patchDraft('email', $event)" />
          </div>
          <div class="grid gap-2">
            <label Label for="create-role">Role</label>
            <select NativeSelect id="create-role" [value]="draft().role" (change)="patchDraft('role', $event)">
              @for (role of roles(); track role) {
                <option NativeSelectOption [value]="role" [selected]="role === draft().role">{{ role }}</option>
              }
            </select>
          </div>
          <p class="font-mono text-xs text-muted-foreground">id: {{ draft().id }}</p>
          @if (createError()) {
            <p class="text-sm text-destructive" role="alert">{{ createError() }}</p>
          }
        </DialogContent>

        <DialogFooter>
          <button Button variant="outline" type="button" DialogClose>Batal</button>
          <button Button type="button" [disabled]="creating() || !draftValid()" (click)="submitCreate()">
            {{ creating() ? 'Menyimpan...' : 'Simpan' }}
          </button>
        </DialogFooter>
      </Dialog>

      <app-user-edit-dialog
        [(open)]="editOpen"
        [user]="editing()"
        [roles]="roles()"
        [busy]="saving()"
        [error]="editError()"
        (saved)="submitEdit($event)"
      />

      <app-reason-dialog
        [(open)]="actionOpen"
        [title]="pendingTitle()"
        [description]="pending()?.action.question ?? ''"
        [confirmLabel]="pending()?.action.label ?? 'Konfirmasi'"
        [destructive]="pending()?.action.destructive ?? false"
        [busy]="acting()"
        [error]="actionError()"
        (confirmed)="runAction($event)"
      />
    </main>
  `,
})
export class UsersPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly reasonDialog = viewChild(ReasonDialog);

  /** Used to hide the status actions on the caller's own row (AC-6). */
  protected readonly callerId = computed(() => this.auth.user()?.id ?? null);

  protected readonly statusFilters = STATUS_FILTER_LABELS;
  protected readonly actionsFor = actionsFor;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<UserRecord[]>([]);
  protected readonly meta = signal<LogsMeta>(EMPTY_META);
  protected readonly search = signal('');
  protected readonly status = signal<UserStatusFilter>('');
  protected readonly roles = signal<AuthRole[]>([]);

  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly draft = signal<DraftUser>(emptyDraft());

  protected readonly editOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly editError = signal<string | null>(null);
  protected readonly editing = signal<UserRecord | null>(null);

  protected readonly actionOpen = signal(false);
  protected readonly acting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly pending = signal<{
    user: UserRecord;
    action: StatusActionMeta;
  } | null>(null);

  protected readonly pageLabel = computed(() => {
    const meta = this.meta();
    return `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} user`;
  });
  protected readonly hasFilters = computed(
    () => this.search() !== '' || this.status() !== '',
  );
  protected readonly draftValid = computed(() => {
    const draft = this.draft();
    return draft.name.trim().length > 0 && draft.email.includes('@');
  });
  protected readonly pendingTitle = computed(() => {
    const pending = this.pending();
    return pending ? `${pending.action.label} ${pending.user.name}` : '';
  });

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .users({ search: this.search(), status: this.status(), page })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.meta.set(response.meta);
          this.roles.set(response.options.roles);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Gagal memuat daftar user.');
          this.loading.set(false);
        },
      });
  }

  protected updateSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected updateStatus(event: Event): void {
    this.status.set(
      (event.target as HTMLSelectElement).value as UserStatusFilter,
    );
    this.load(1);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('');
    this.load(1);
  }

  protected goTo(page: number): void {
    this.load(page);
  }

  /**
   * The id is minted here, before the request: a UUIDv7 so rows stay roughly
   * time ordered, and so the caller already knows the id it created.
   */
  protected openCreate(): void {
    this.draft.set({
      ...emptyDraft(),
      id: uuidv7(),
      role: this.roles()[0] ?? 'staff',
    });
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected patchDraft(field: keyof DraftUser, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected submitCreate(): void {
    const draft = this.draft();
    this.creating.set(true);
    this.createError.set(null);
    this.api
      .createUser({
        id: draft.id,
        name: draft.name.trim(),
        email: draft.email.trim(),
        role: draft.role,
      })
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.createOpen.set(false);
          this.load(1);
        },
        error: (failure) => {
          this.creating.set(false);
          this.createError.set(statusActionError(failure));
        },
      });
  }

  protected openEdit(user: UserRecord): void {
    this.editing.set(user);
    this.editError.set(null);
    this.editOpen.set(true);
  }

  protected submitEdit(payload: UpdateUserPayload): void {
    const user = this.editing();

    if (!user) {
      return;
    }

    this.saving.set(true);
    this.editError.set(null);
    this.api.updateUser(user.id, payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.editOpen.set(false);
        this.load(this.meta().page);
      },
      error: (failure) => {
        this.saving.set(false);
        this.editError.set(statusActionError(failure));
      },
    });
  }

  protected askFor(user: UserRecord, action: StatusActionMeta): void {
    this.pending.set({ user, action });
    this.actionError.set(null);
    this.reasonDialog()?.reset();
    this.actionOpen.set(true);
  }

  protected runAction(reason: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    this.acting.set(true);
    this.actionError.set(null);
    this.api
      .runUserStatusAction(pending.user.id, pending.action.action, reason)
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.actionOpen.set(false);
          this.reasonDialog()?.reset();
          this.load(this.meta().page);
        },
        error: (failure) => {
          this.acting.set(false);
          this.actionError.set(statusActionError(failure));
        },
      });
  }

  protected statusLabel(status: UserStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusVariant(status: UserStatus) {
    return STATUS_VARIANTS[status];
  }

  protected formatDate(iso: string): string {
    return DATE_FORMAT.format(new Date(iso));
  }
}

function emptyDraft(): DraftUser {
  return { id: '', name: '', email: '', role: 'staff' };
}
