import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BadgeComponent,
  type BadgeVariant,
} from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import {
  CardComponent,
  CardContentComponent,
  CardDescriptionComponent,
  CardHeaderComponent,
  CardTitleComponent,
} from '@ojiepermana/angular/component/card';
import { InputComponent } from '@ojiepermana/angular/component/input';
import { LabelComponent } from '@ojiepermana/angular/component/label';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { AuthService } from '../../../auth/auth.service';
import { PERMISSIONS } from '../../../auth/permissions';
import {
  ApiService,
  type PermissionGroupRecord,
  type PermissionRecord,
  type UserRecord,
} from '../../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

@Component({
  selector: 'app-group-detail-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    CardContentComponent,
    CardDescriptionComponent,
    CardHeaderComponent,
    CardTitleComponent,
    InputComponent,
    LabelComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageHeaderComponent,
    RouterLink,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <a Button variant="ghost" size="xs" [routerLink]="['/permission/group']" aria-label="Back to permission groups">Back</a>
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Permission group</p>
            <h1 class="truncate text-lg font-semibold text-foreground">{{ group()?.name || 'Group detail' }}</h1>
          </div>
          @if (group()) { <span Badge [variant]="statusVariant()">{{ statusLabel() }}</span> }
        </div>
        <div class="flex shrink-0 gap-2">
          @if (group() && group()!.deletedAt) {
            <button Button size="xs" type="button" [disabled]="busy() || !canRestore()" (click)="restore()">Restore</button>
          } @else if (group()) {
            <button Button variant="destructive" size="xs" type="button" [disabled]="busy() || !canDelete()" (click)="remove()">Delete</button>
          }
        </div>
      </PageHeader>

      <PageContent class="grid min-h-0 content-start gap-6 p-3 lg:grid-cols-2">
        @if (error()) { <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive lg:col-span-2" role="alert">{{ error() }}</p> }
        @if (loading()) {
          <p class="text-sm text-muted-foreground lg:col-span-2">Loading permission group...</p>
        } @else if (!group()) {
          <p class="border border-border bg-card p-5 text-sm text-muted-foreground lg:col-span-2">Permission group not found.</p>
        } @else {
          <Card class="bg-card">
            <CardHeader>
              <CardTitle level="2">Profile</CardTitle>
              <CardDescription>Group metadata and lifecycle state.</CardDescription>
            </CardHeader>
            <CardContent class="grid gap-4">
              <div class="grid gap-2">
                <label Label for="detail-group-name">Name</label>
                <input Input id="detail-group-name" [value]="name()" [disabled]="!canEdit() || !!group()!.deletedAt" (input)="setName($event)" />
              </div>
              <div class="grid gap-2">
                <label Label for="detail-group-description">Description</label>
                <textarea id="detail-group-description" class="min-h-28 border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60" [value]="description()" [disabled]="!canEdit() || !!group()!.deletedAt" (input)="setDescription($event)"></textarea>
              </div>
              <div class="grid gap-2">
                <label Label for="detail-group-status">Status</label>
                <select NativeSelect id="detail-group-status" [value]="formStatus()" [disabled]="!canEdit() || !!group()!.deletedAt" (change)="setStatus($event)">
                  <option NativeSelectOption value="active">Active</option>
                  <option NativeSelectOption value="off">Off</option>
                </select>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Updated {{ formatDate(group()!.updatedAt) }}</span>
                <button Button size="xs" type="button" [disabled]="busy() || !canEdit() || !!group()!.deletedAt || !formValid()" (click)="save()">{{ busy() ? 'Saving...' : 'Save changes' }}</button>
              </div>
            </CardContent>
          </Card>

          <Card class="bg-card lg:row-span-2">
            <CardHeader>
              <CardTitle level="2">Group permissions</CardTitle>
              <CardDescription>These catalog permissions are copied as direct grants when the group is applied.</CardDescription>
            </CardHeader>
            <CardContent class="grid gap-5">
              @if (permissionsLoading()) {
                <p class="text-sm text-muted-foreground">Loading group permissions...</p>
              } @else if (attachedPermissions().length === 0) {
                <p class="text-sm text-muted-foreground">No permissions attached. An empty group cannot be applied.</p>
              } @else {
                <div class="grid gap-2">
                  @for (permission of attachedPermissions(); track permission.id) {
                    <div class="flex flex-wrap items-center justify-between gap-3 border border-border p-3">
                      <div class="min-w-0">
                        <p class="font-mono text-sm text-foreground">{{ permission.name }}</p>
                        <p class="text-xs text-muted-foreground">{{ permission.description || 'No description' }}</p>
                      </div>
                      <button Button variant="outline" size="xs" type="button" [disabled]="busy() || !canDetach()" (click)="detach(permission)">Detach</button>
                    </div>
                  }
                </div>
              }

              @if (canAttach()) {
                <div class="grid gap-3 border-t border-border pt-4">
                  <div>
                    <h3 class="font-medium text-foreground">Attach catalog permissions</h3>
                    <p class="mt-1 text-sm text-muted-foreground">Select one or more permissions to add idempotently.</p>
                  </div>
                  @if (availablePermissions().length === 0) {
                    <p class="text-sm text-muted-foreground">All catalog permissions are already attached.</p>
                  } @else {
                    <div class="grid max-h-72 gap-2 overflow-y-auto">
                      @for (permission of availablePermissions(); track permission.id) {
                        <label class="flex items-start gap-3 border border-border p-3 text-sm">
                          <input type="checkbox" [checked]="selectedPermissionIds().includes(permission.id)" (change)="togglePermission(permission.id, $event)" />
                          <span class="min-w-0"><span class="block font-mono text-foreground">{{ permission.name }}</span><span class="block text-xs text-muted-foreground">{{ permission.description || 'No description' }}</span></span>
                        </label>
                      }
                    </div>
                    <button Button size="xs" class="justify-self-start" type="button" [disabled]="busy() || selectedPermissionIds().length === 0 || !!group()!.deletedAt" (click)="attach()">Attach selected</button>
                  }
                </div>
              } @else {
                <p class="border border-border p-3 text-sm text-muted-foreground">You need permission-group create access to attach catalog permissions.</p>
              }
            </CardContent>
          </Card>

          <Card class="bg-card">
            <CardHeader>
              <CardTitle level="2">Apply to users</CardTitle>
              <CardDescription>Apply this active, non-empty template to up to 50 users. Existing direct grants are skipped.</CardDescription>
            </CardHeader>
            <CardContent class="grid gap-4">
              @if (!canApply()) {
                <p class="border border-border p-3 text-sm text-muted-foreground">You need group manage access to apply a template.</p>
              } @else if (!canListUsers()) {
                <p class="border border-border p-3 text-sm text-muted-foreground">User selection is disabled because you do not have user list access.</p>
              } @else if (usersLoading()) {
                <p class="text-sm text-muted-foreground">Loading users...</p>
              } @else if (users().length === 0) {
                <p class="text-sm text-muted-foreground">No users available.</p>
              } @else {
                <div class="grid max-h-72 gap-2 overflow-y-auto">
                  @for (user of users(); track user.id) {
                    <label class="flex items-center gap-3 border border-border p-3 text-sm">
                      <input type="checkbox" [checked]="selectedUserIds().includes(user.id)" (change)="toggleUser(user.id, $event)" />
                      <span class="min-w-0"><span class="block font-medium text-foreground">{{ user.name }}</span><span class="block text-xs text-muted-foreground">{{ user.email }}</span></span>
                    </label>
                  }
                </div>
                <button Button type="button" [disabled]="busy() || selectedUserIds().length === 0 || !!group()!.deletedAt || group()!.status !== 'active' || group()!.permissionCount === 0" (click)="applyToUsers()">Apply to {{ selectedUserIds().length }} users</button>
                @if (applyMessage()) { <p class="text-sm text-muted-foreground" role="status">{{ applyMessage() }}</p> }
              }
            </CardContent>
          </Card>
        }
      </PageContent>
    </Page>
  `,
})
export class GroupDetailPage {
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly group = signal<PermissionGroupRecord | null>(null);
  protected readonly attachedPermissions = signal<PermissionRecord[]>([]);
  protected readonly catalog = signal<PermissionRecord[]>([]);
  protected readonly users = signal<UserRecord[]>([]);
  protected readonly selectedPermissionIds = signal<string[]>([]);
  protected readonly selectedUserIds = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly permissionsLoading = signal(true);
  protected readonly usersLoading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly applyMessage = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly formStatus = signal<'active' | 'off'>('active');
  protected readonly formValid = computed(() => this.name().trim().length > 0);
  protected readonly canEdit = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessGroupUpdate),
  );
  protected readonly canDelete = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessGroupDelete),
  );
  protected readonly canRestore = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessGroupRestore),
  );
  protected readonly canAttach = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessPermissionGroupCreate),
  );
  protected readonly canDetach = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessPermissionGroupDelete),
  );
  protected readonly canApply = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessPermissionUserCreate),
  );
  protected readonly canListUsers = computed(() =>
    this.auth.hasPermission(PERMISSIONS.userUserList),
  );
  protected readonly availablePermissions = computed(() => {
    const attached = new Set(
      this.attachedPermissions().map((permission) => permission.id),
    );
    return this.catalog().filter((permission) => !attached.has(permission.id));
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.permissionsLoading.set(true);
    this.usersLoading.set(true);
    this.error.set(null);
    this.applyMessage.set(null);
    this.api.group(id).subscribe({
      next: (group) => {
        this.group.set(group);
        this.name.set(group.name);
        this.description.set(group.description ?? '');
        this.formStatus.set(group.status);
        this.loading.set(false);
      },
      error: () => {
        this.group.set(null);
        this.loading.set(false);
        this.error.set('Failed to load permission group.');
      },
    });
    this.api.groupPermissions(id).subscribe({
      next: (permissions) => {
        this.attachedPermissions.set(permissions);
        this.permissionsLoading.set(false);
      },
      error: () => {
        this.permissionsLoading.set(false);
        this.error.set('Failed to load group permissions.');
      },
    });
    if (this.canAttach()) {
      this.api.permissions({ search: '', namespace: '', page: 1 }).subscribe({
        next: (response) => this.catalog.set(response.data),
        error: () => this.error.set('Failed to load permission catalog.'),
      });
    }
    if (this.canListUsers()) {
      this.api.users({ search: '', status: '', page: 1 }).subscribe({
        next: (response) => {
          this.users.set(
            response.data.filter((user) => user.status !== 'deleted'),
          );
          this.usersLoading.set(false);
        },
        error: () => {
          this.usersLoading.set(false);
          this.error.set('Failed to load users for group apply.');
        },
      });
    } else {
      this.usersLoading.set(false);
    }
  }

  protected setName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected setDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected setStatus(event: Event): void {
    this.formStatus.set(
      (event.target as HTMLSelectElement).value as 'active' | 'off',
    );
  }

  protected save(): void {
    const group = this.group();
    if (!group || !this.canEdit() || !this.formValid()) return;
    this.busy.set(true);
    this.api
      .updateGroup(group.id, {
        name: this.name().trim(),
        description: this.description().trim(),
        status: this.formStatus(),
      })
      .subscribe({
        next: (updated) => {
          this.group.set(updated);
          this.name.set(updated.name);
          this.description.set(updated.description ?? '');
          this.formStatus.set(updated.status);
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.error.set('Failed to update permission group.');
        },
      });
  }

  protected remove(): void {
    const group = this.group();
    if (
      !group ||
      !this.canDelete() ||
      !window.confirm(`Delete permission group “${group.name}”?`)
    )
      return;
    this.busy.set(true);
    this.api.deleteGroup(group.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.group.update((value) =>
          value ? { ...value, deletedAt: new Date().toISOString() } : value,
        );
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to delete permission group.');
      },
    });
  }

  protected restore(): void {
    const group = this.group();
    if (!group || !this.canRestore()) return;
    this.busy.set(true);
    this.api.restoreGroup(group.id).subscribe({
      next: (restored) => {
        this.busy.set(false);
        this.group.set(restored);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to restore permission group.');
      },
    });
  }

  protected togglePermission(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedPermissionIds.update((ids) =>
      checked ? [...ids, id] : ids.filter((value) => value !== id),
    );
  }

  protected attach(): void {
    const group = this.group();
    const ids = this.selectedPermissionIds();
    if (!group || ids.length === 0 || !this.canAttach()) return;
    this.busy.set(true);
    this.api.attachGroupPermissions(group.id, ids).subscribe({
      next: () => {
        this.selectedPermissionIds.set([]);
        this.busy.set(false);
        this.reloadGroupPermissions(group.id);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to attach group permissions.');
      },
    });
  }

  protected detach(permission: PermissionRecord): void {
    const group = this.group();
    if (!group || !this.canDetach()) return;
    this.busy.set(true);
    this.api.detachGroupPermission(group.id, permission.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.reloadGroupPermissions(group.id);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to detach group permission.');
      },
    });
  }

  protected toggleUser(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedUserIds.update((ids) =>
      checked ? [...ids, id] : ids.filter((value) => value !== id),
    );
  }

  protected applyToUsers(): void {
    const group = this.group();
    const ids = this.selectedUserIds();
    if (!group || ids.length === 0 || ids.length > 50 || !this.canApply())
      return;
    this.busy.set(true);
    this.applyMessage.set(null);
    this.api.applyGroupToUsers(group.id, ids).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.selectedUserIds.set([]);
        this.applyMessage.set(
          `${result.applied.length} user(s) updated; ${result.failed.length} failed.`,
        );
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Failed to apply permission group.');
      },
    });
  }

  private reloadGroupPermissions(id: string): void {
    this.permissionsLoading.set(true);
    this.api.groupPermissions(id).subscribe({
      next: (permissions) => {
        this.attachedPermissions.set(permissions);
        this.permissionsLoading.set(false);
        this.group.update((value) =>
          value ? { ...value, permissionCount: permissions.length } : value,
        );
      },
      error: () => {
        this.permissionsLoading.set(false);
        this.error.set('Failed to refresh group permissions.');
      },
    });
  }

  protected statusLabel(): string {
    const group = this.group();
    if (!group) return '';
    if (group.deletedAt) return 'Deleted';
    return group.status === 'active' ? 'Active' : 'Off';
  }

  protected statusVariant(): BadgeVariant {
    const group = this.group();
    return !group || group.deletedAt || group.status === 'off'
      ? 'destructive'
      : 'secondary';
  }

  protected formatDate(value: string): string {
    return DATE_FORMAT.format(new Date(value));
  }
}
