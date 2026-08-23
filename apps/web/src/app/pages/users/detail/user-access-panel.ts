import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import { InputComponent } from '@ojiepermana/angular/component/input';
import { LabelComponent } from '@ojiepermana/angular/component/label';
import {
  ApiService,
  type PermissionRecord,
} from '../../../services/api.service';

interface PermissionGroup {
  namespace: string;
  permissions: PermissionRecord[];
}

@Component({
  selector: 'app-user-access-panel',
  imports: [ButtonComponent, InputComponent, LabelComponent],
  template: `
    <div class="grid gap-6">
      @if (error()) {
        <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p>
      }

      <section class="grid gap-4 border border-border bg-card p-5">
        <div>
          <h2 class="font-semibold text-foreground">Granted access</h2>
          <p class="mt-1 text-sm text-muted-foreground">Direct grants for this user. Manage permissions are evaluated as namespace wildcards.</p>
        </div>
        @if (grants().length === 0 && !loading()) {
          <p class="text-sm text-muted-foreground">No direct permissions granted.</p>
        } @else {
          <div class="grid gap-2">
            @for (permission of grants(); track permission.id) {
              <div class="flex flex-wrap items-center justify-between gap-3 border border-border p-3">
                <div>
                  <p class="font-mono text-sm text-foreground">{{ permission.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ permission.description }}</p>
                </div>
                <button Button variant="outline" size="xs" type="button" [disabled]="busy()" (click)="revoke(permission)">Revoke</button>
              </div>
            }
          </div>
        }
      </section>

      <section class="grid gap-4 border border-border bg-card p-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="font-semibold text-foreground">Grant permissions</h2>
            <p class="mt-1 text-sm text-muted-foreground">Choose catalog entries and apply them together.</p>
          </div>
          <button Button type="button" [disabled]="busy() || selectedToGrant().length === 0" (click)="grantSelected()">
            {{ busy() ? 'Saving...' : 'Grant selected' }}
          </button>
        </div>
        <input Input type="search" placeholder="Search permissions..." [value]="search()" (input)="setSearch($event)" />
        @if (catalogLoading()) {
          <p class="text-sm text-muted-foreground">Loading permission catalog...</p>
        } @else {
          <div class="grid gap-5 md:grid-cols-2">
            @for (group of groups(); track group.namespace) {
              <div class="grid content-start gap-2">
                <h3 class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{{ group.namespace }}</h3>
                @for (permission of group.permissions; track permission.id) {
                  <label class="flex items-start gap-3 border border-border p-3 text-sm">
                    <input type="checkbox" [checked]="isSelected(permission)" [disabled]="isGranted(permission)" (change)="toggle(permission, $event)" />
                    <span class="min-w-0">
                      <span class="block font-mono text-foreground">{{ permission.name }}</span>
                      <span class="block text-xs text-muted-foreground">{{ permission.description }}</span>
                    </span>
                  </label>
                }
              </div>
            }
          </div>
        }
      </section>

      <section class="grid gap-3 border border-border bg-card p-5 md:grid-cols-[1fr_auto] md:items-end">
        <div class="grid gap-2">
          <label Label for="copy-source-user">Copy from another user</label>
          <input Input id="copy-source-user" placeholder="Source user UUID" [value]="sourceUserId()" (input)="setSourceUserId($event)" />
        </div>
        <button Button variant="outline" type="button" [disabled]="busy() || sourceUserId().trim().length === 0" (click)="copyFromSource()">Copy grants</button>
      </section>
    </div>
  `,
})
export class UserAccessPanel {
  readonly userId = input.required<string>();

  private readonly api = inject(ApiService);
  protected readonly loading = signal(true);
  protected readonly catalogLoading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly catalog = signal<PermissionRecord[]>([]);
  protected readonly grants = signal<PermissionRecord[]>([]);
  protected readonly selected = signal<string[]>([]);
  protected readonly search = signal('');
  protected readonly sourceUserId = signal('');

  protected readonly groups = computed<PermissionGroup[]>(() => {
    const grouped = new Map<string, PermissionRecord[]>();
    for (const permission of this.catalog()) {
      const entries = grouped.get(permission.namespace) ?? [];
      entries.push(permission);
      grouped.set(permission.namespace, entries);
    }
    return [...grouped.entries()].map(([namespace, permissions]) => ({
      namespace,
      permissions,
    }));
  });

  protected readonly selectedToGrant = computed(() => {
    const existing = new Set(this.grants().map((permission) => permission.id));
    return this.selected().filter((id) => !existing.has(id));
  });

  constructor() {
    effect(() => {
      const userId = this.userId();
      if (userId) this.reload(userId);
    });
  }

  private reload(userId: string): void {
    this.loading.set(true);
    this.catalogLoading.set(true);
    this.error.set(null);
    this.api
      .permissions({ search: this.search(), namespace: '', page: 1 })
      .subscribe({
        next: (response) => {
          this.catalog.set(response.data);
          this.catalogLoading.set(false);
        },
        error: () => {
          this.catalogLoading.set(false);
          this.error.set('Failed to load permission catalog.');
        },
      });
    this.api.userPermissions(userId).subscribe({
      next: (response) => {
        this.grants.set(response.map((grant) => grant.permission));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load user access.');
      },
    });
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.reload(this.userId());
  }

  protected setSourceUserId(event: Event): void {
    this.sourceUserId.set((event.target as HTMLInputElement).value);
  }

  protected isSelected(permission: PermissionRecord): boolean {
    return (
      this.selected().includes(permission.id) || this.isGranted(permission)
    );
  }

  protected isGranted(permission: PermissionRecord): boolean {
    return this.grants().some((grant) => grant.id === permission.id);
  }

  protected toggle(permission: PermissionRecord, event: Event): void {
    if (this.isGranted(permission)) return;
    const checked = (event.target as HTMLInputElement).checked;
    this.selected.update((ids) =>
      checked
        ? [...ids, permission.id]
        : ids.filter((id) => id !== permission.id),
    );
  }

  protected grantSelected(): void {
    const ids = this.selectedToGrant();
    if (ids.length === 0) return;
    this.busy.set(true);
    this.api.grantUserPermissions(this.userId(), ids).subscribe({
      next: () => {
        this.busy.set(false);
        this.selected.set([]);
        this.reload(this.userId());
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to grant permissions.');
      },
    });
  }

  protected revoke(permission: PermissionRecord): void {
    this.busy.set(true);
    this.api.revokeUserPermission(this.userId(), permission.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload(this.userId());
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to revoke permission.');
      },
    });
  }

  protected copyFromSource(): void {
    const source = this.sourceUserId().trim();
    if (!source) return;
    this.busy.set(true);
    this.api.copyUserPermissions(this.userId(), source).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload(this.userId());
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to copy permissions.');
      },
    });
  }
}
