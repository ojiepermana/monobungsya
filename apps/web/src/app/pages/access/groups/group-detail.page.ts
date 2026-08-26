import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  AlertDialogActionComponent,
  AlertDialogCancelComponent,
  AlertDialogComponent,
  AlertDialogContentComponent,
  AlertDialogDescriptionComponent,
  AlertDialogFooterComponent,
  AlertDialogHeaderComponent,
  AlertDialogTitleComponent,
} from '@ojiepermana/angular/component/alert-dialog';
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
import {
  MenuContentDirective,
  MenuItemComponent,
  MenuSeparatorComponent,
  MenuSurfaceComponent,
  MenuTriggerDirective,
} from '@ojiepermana/angular/component/dropdown-menu';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { InputComponent } from '@ojiepermana/angular/component/input';
import {
  NativeSelectComponent,
  NativeSelectOptionDirective,
} from '@ojiepermana/angular/component/native-select';
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
  PageFilterComponent,
  PageFilterToggleComponent,
  PageFooterComponent,
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

const ATTACHED_PERMISSIONS_PAGE_SIZE = 10;

@Component({
  selector: 'app-group-detail-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    AlertDialogActionComponent,
    AlertDialogCancelComponent,
    AlertDialogComponent,
    AlertDialogContentComponent,
    AlertDialogDescriptionComponent,
    AlertDialogFooterComponent,
    AlertDialogHeaderComponent,
    AlertDialogTitleComponent,
    ButtonComponent,
    DialogCloseDirective,
    DialogComponent,
    DialogContentComponent,
    DialogDescriptionComponent,
    DialogFooterComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    IconComponent,
    InputComponent,
    MenuContentDirective,
    MenuItemComponent,
    MenuSeparatorComponent,
    MenuSurfaceComponent,
    MenuTriggerDirective,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageFilterComponent,
    PageFilterToggleComponent,
    PageFooterComponent,
    PageHeaderComponent,
    TableBodyComponent,
    TableCaptionComponent,
    TableCellComponent,
    TableComponent,
    TableHeadComponent,
    TableHeaderComponent,
    TableRowComponent,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Permission group</p>
            <h1 class="truncate text-lg font-semibold text-foreground">{{ group()?.name || 'Group detail' }}</h1>
            @if (applyMessage()) { <p class="text-xs text-muted-foreground" role="status">{{ applyMessage() }}</p> }
          </div>
        </div>
        <div class="flex shrink-0 justify-end gap-2">
          <PageFilterToggle
            ariaLabel="Show or hide filters"
            (toggled)="filterOpen.set($event)"
          >
            <Icon name="filter_list" [size]="14" aria-hidden="true" />
            <span>Filter</span>
          </PageFilterToggle>
          @if (group()) {
            <button Button variant="outline" size="icon" class="h-8 w-8 p-0" type="button" aria-label="Group actions" title="Group actions" [MenuTrigger]="groupActionsMenu" align="end" [disabled]="busy()">
              <Icon name="more_vert" [size]="16" aria-hidden="true" />
            </button>
            <ng-template MenuContent #groupActionsMenu="MenuContent">
              <MenuSurface class="w-52">
                @if (!group()!.deletedAt) {
                  @if (canAttach()) {
                    <button MenuItem type="button" (selected)="openAttachDialog()"><Icon name="playlist_add" [size]="16" aria-hidden="true" />Attach catalog</button>
                  }
                  @if (canApply() && canListUsers()) {
                    <button MenuItem type="button" (selected)="openApplyDialog()"><Icon name="person_add" [size]="16" aria-hidden="true" />Apply to users</button>
                  }
                  @if (canEdit()) {
                    <button MenuItem type="button" (selected)="toggleStatus()"><Icon [name]="group()!.status === 'active' ? 'toggle_off' : 'toggle_on'" [size]="16" aria-hidden="true" />{{ group()!.status === 'active' ? 'Turn off' : 'Activate' }}</button>
                  }
                }
                <MenuSeparator />
                @if (group()!.deletedAt) {
                  @if (canRestore()) {
                    <button MenuItem type="button" (selected)="restore()"><Icon name="restore" [size]="16" aria-hidden="true" />Restore</button>
                  }
                } @else if (canDelete()) {
                  <button MenuItem variant="destructive" type="button" (selected)="remove()"><Icon name="delete" [size]="16" aria-hidden="true" />Delete</button>
                }
              </MenuSurface>
            </ng-template>
          }
        </div>
      </PageHeader>

      @if (group()) {
        <PageFilter
          placement="stacked"
          collapsible
          [hidden]="!filterOpen()"
          class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-center"
        >
          <input
            Input
            type="search"
            placeholder="Search attached permissions..."
            class="md:max-w-xs"
            [value]="permissionSearch()"
            (input)="setPermissionSearch($event)"
          />
          <select
            NativeSelect
            class="md:w-40"
            [value]="permissionNamespace()"
            (change)="setPermissionNamespace($event)"
          >
            <option NativeSelectOption value="">All namespaces</option>
            @for (namespace of permissionNamespaces(); track namespace) {
              <option NativeSelectOption [value]="namespace">{{ namespace }}</option>
            }
          </select>
          <select
            NativeSelect
            class="md:w-36"
            [value]="permissionAction()"
            (change)="setPermissionAction($event)"
          >
            <option NativeSelectOption value="">All actions</option>
            @for (action of permissionActions(); track action) {
              <option NativeSelectOption [value]="action">{{ action }}</option>
            }
          </select>
          <button
            Button
            variant="outline"
            size="xs"
            type="button"
            [disabled]="!hasPermissionFilters()"
            (click)="clearPermissionFilters()"
          >
            Clear filters
          </button>
        </PageFilter>
      }

      <PageContent class="grid min-h-0 content-start gap-6">
        @if (error()) { <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p> }
        @if (loading()) {
          <p class="text-sm text-muted-foreground">Loading permission group...</p>
        } @else if (!group()) {
          <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Permission group not found.</p>
        } @else {
          @if (permissionsLoading()) {
            <p class="text-sm text-muted-foreground">Loading attached catalog permissions...</p>
          } @else if (attachedPermissions().length === 0) {
            <p class="border border-border bg-card p-5 text-sm text-muted-foreground">No catalog permissions attached.</p>
          } @else if (filteredAttachedPermissions().length === 0) {
            <p class="border border-border bg-card p-5 text-sm text-muted-foreground">No catalog permissions match the active filters.</p>
          } @else {
            <Table class="min-w-full bg-card">
              <caption TableCaption class="sr-only">Attached catalog permissions</caption>
              <thead TableHeader class="text-sm uppercase text-muted-foreground">
                <tr TableRow>
                  <th TableHead scope="col">Name</th>
                  <th TableHead scope="col">Namespace</th>
                  <th TableHead scope="col">Resource</th>
                  <th TableHead scope="col">Action</th>
                  <th TableHead scope="col">Scope</th>
                  <th TableHead scope="col">Description</th>
                  <th TableHead scope="col" class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody TableBody>
                @for (permission of attachedPermissionPage(); track permission.id) {
                  <tr TableRow class="align-top">
                    <td TableCell class="font-mono text-sm">{{ permission.name }}</td>
                    <td TableCell>{{ permission.namespace }}</td>
                    <td TableCell>{{ permission.resource }}</td>
                    <td TableCell>{{ permission.action }}</td>
                    <td TableCell>{{ permission.scope || '—' }}</td>
                    <td TableCell class="text-muted-foreground">{{ permission.description || '—' }}</td>
                    <td TableCell class="text-right">
                      @if (canDetach()) {
                        <button Button variant="outline" size="xs" type="button" [disabled]="busy()" (click)="openRevokeDialog(permission)">Revoke</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </Table>
          }
        }
      </PageContent>

        <Dialog [(open)]="attachDialogOpen" class="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attach catalog permissions</DialogTitle>
            <DialogDescription>Select one or more permissions to add to this group.</DialogDescription>
          </DialogHeader>
          <DialogContent class="grid gap-4 py-2">
            @if (permissionsLoading()) {
              <p class="text-sm text-muted-foreground">Loading permission catalog...</p>
            } @else if (availablePermissions().length === 0) {
              <p class="text-sm text-muted-foreground">All catalog permissions are already attached.</p>
            } @else {
              <div class="grid max-h-80 gap-2 overflow-y-auto">
                @for (permission of availablePermissions(); track permission.id) {
                  <label class="flex items-start gap-3 border border-border p-3 text-sm">
                    <input type="checkbox" [checked]="selectedPermissionIds().includes(permission.id)" (change)="togglePermission(permission.id, $event)" />
                    <span class="min-w-0"><span class="block font-mono text-foreground">{{ permission.name }}</span><span class="block text-xs text-muted-foreground">{{ permission.description || 'No description' }}</span></span>
                  </label>
                }
              </div>
            }
            @if (dialogError()) { <p class="text-sm text-destructive" role="alert">{{ dialogError() }}</p> }
          </DialogContent>
          <DialogFooter>
            <button Button variant="outline" type="button" DialogClose (click)="closeAttachDialog()">Cancel</button>
            <button Button type="button" [disabled]="busy() || selectedPermissionIds().length === 0 || !!group()?.deletedAt" (click)="attach()">{{ busy() ? 'Attaching...' : 'Attach selected' }}</button>
          </DialogFooter>
        </Dialog>

        <Dialog [(open)]="applyDialogOpen" class="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Apply group to users</DialogTitle>
            <DialogDescription>Choose up to 50 users. Existing direct grants are skipped.</DialogDescription>
          </DialogHeader>
          <DialogContent class="grid gap-4 py-2">
            @if (usersLoading()) {
              <p class="text-sm text-muted-foreground">Loading users...</p>
            } @else if (users().length === 0) {
              <p class="text-sm text-muted-foreground">No users available.</p>
            } @else {
              <div class="grid max-h-80 gap-2 overflow-y-auto">
                @for (user of users(); track user.id) {
                  <label class="flex items-center gap-3 border border-border p-3 text-sm">
                    <input type="checkbox" [checked]="selectedUserIds().includes(user.id)" (change)="toggleUser(user.id, $event)" />
                    <span class="min-w-0"><span class="block font-medium text-foreground">{{ user.name }}</span><span class="block text-xs text-muted-foreground">{{ user.email }}</span></span>
                  </label>
                }
              </div>
            }
            @if (dialogError()) { <p class="text-sm text-destructive" role="alert">{{ dialogError() }}</p> }
          </DialogContent>
          <DialogFooter>
            <button Button variant="outline" type="button" DialogClose (click)="closeApplyDialog()">Cancel</button>
            <button Button type="button" [disabled]="busy() || selectedUserIds().length === 0 || selectedUserIds().length > 50 || !!group()?.deletedAt || group()?.status !== 'active' || group()?.permissionCount === 0" (click)="applyToUsers()">{{ busy() ? 'Applying...' : 'Apply to ' + selectedUserIds().length + ' users' }}</button>
          </DialogFooter>
        </Dialog>

        <AlertDialog [(open)]="revokeDialogOpen">
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke permission?</AlertDialogTitle>
              <AlertDialogDescription>This will remove {{ selectedPermission()?.name }} from this permission group.</AlertDialogDescription>
            </AlertDialogHeader>
            @if (dialogError()) { <p class="text-sm text-destructive" role="alert">{{ dialogError() }}</p> }
            <AlertDialogFooter>
              <button type="button" AlertDialogCancel (click)="closeRevokeDialog()">Cancel</button>
              <button type="button" AlertDialogAction variant="destructive" [closeOnClick]="false" [disabled]="busy() || !selectedPermission()" (click)="confirmRevoke()">{{ busy() ? 'Revoking...' : 'Revoke' }}</button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">Page {{ permissionsPage() }} of {{ permissionsPageCount() }} · {{ attachedPermissions().length }} catalog permissions</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" [disabled]="permissionsPage() <= 1 || permissionsLoading()" (click)="goToPermissionsPage(permissionsPage() - 1)">Previous</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="permissionsPage() >= permissionsPageCount() || permissionsLoading()" (click)="goToPermissionsPage(permissionsPage() + 1)">Next</button>
        </div>
      </PageFooter>
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
  protected readonly attachDialogOpen = signal(false);
  protected readonly applyDialogOpen = signal(false);
  protected readonly revokeDialogOpen = signal(false);
  protected readonly selectedPermission = signal<PermissionRecord | null>(null);
  protected readonly permissionsPage = signal(1);
  protected readonly filterOpen = signal(false);
  protected readonly permissionSearch = signal('');
  protected readonly permissionNamespace = signal('');
  protected readonly permissionAction = signal('');
  protected readonly loading = signal(true);
  protected readonly permissionsLoading = signal(true);
  protected readonly usersLoading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly applyMessage = signal<string | null>(null);
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
  protected readonly permissionNamespaces = computed(() =>
    [
      ...new Set(
        this.attachedPermissions().map((permission) => permission.namespace),
      ),
    ].sort(),
  );
  protected readonly permissionActions = computed(() =>
    [
      ...new Set(
        this.attachedPermissions().map((permission) => permission.action),
      ),
    ].sort(),
  );
  protected readonly filteredAttachedPermissions = computed(() => {
    const search = this.permissionSearch().trim().toLowerCase();
    const namespace = this.permissionNamespace();
    const action = this.permissionAction();
    return this.attachedPermissions().filter((permission) => {
      const matchesSearch =
        search.length === 0 ||
        [
          permission.name,
          permission.namespace,
          permission.resource,
          permission.action,
          permission.scope ?? '',
          permission.description ?? '',
        ].some((value) => value.toLowerCase().includes(search));
      return (
        matchesSearch &&
        (namespace.length === 0 || permission.namespace === namespace) &&
        (action.length === 0 || permission.action === action)
      );
    });
  });
  protected readonly permissionsPageCount = computed(() =>
    Math.max(
      Math.ceil(
        this.filteredAttachedPermissions().length /
          ATTACHED_PERMISSIONS_PAGE_SIZE,
      ),
      1,
    ),
  );
  protected readonly attachedPermissionPage = computed(() => {
    const start = (this.permissionsPage() - 1) * ATTACHED_PERMISSIONS_PAGE_SIZE;
    return this.filteredAttachedPermissions().slice(
      start,
      start + ATTACHED_PERMISSIONS_PAGE_SIZE,
    );
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.load(id);
    });
  }

  protected setPermissionSearch(event: Event): void {
    this.permissionSearch.set((event.target as HTMLInputElement).value);
    this.permissionsPage.set(1);
  }

  protected setPermissionNamespace(event: Event): void {
    this.permissionNamespace.set((event.target as HTMLSelectElement).value);
    this.permissionsPage.set(1);
  }

  protected setPermissionAction(event: Event): void {
    this.permissionAction.set((event.target as HTMLSelectElement).value);
    this.permissionsPage.set(1);
  }

  protected hasPermissionFilters(): boolean {
    return (
      this.permissionSearch().trim().length > 0 ||
      this.permissionNamespace().length > 0 ||
      this.permissionAction().length > 0
    );
  }

  protected clearPermissionFilters(): void {
    this.permissionSearch.set('');
    this.permissionNamespace.set('');
    this.permissionAction.set('');
    this.permissionsPage.set(1);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.permissionsLoading.set(true);
    this.usersLoading.set(true);
    this.permissionsPage.set(1);
    this.error.set(null);
    this.dialogError.set(null);
    this.applyMessage.set(null);
    this.api.group(id).subscribe({
      next: (group) => {
        this.group.set(group);
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
        this.setAttachedPermissions(permissions);
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

  protected toggleStatus(): void {
    const group = this.group();
    if (!group || !this.canEdit() || group.deletedAt) return;
    this.busy.set(true);
    this.error.set(null);
    this.api
      .updateGroup(group.id, {
        status: group.status === 'active' ? 'off' : 'active',
      })
      .subscribe({
        next: (updated) => {
          this.group.set(updated);
          this.busy.set(false);
        },
        error: () => {
          this.busy.set(false);
          this.error.set('Failed to update permission group status.');
        },
      });
  }

  protected openRevokeDialog(permission: PermissionRecord): void {
    this.selectedPermission.set(permission);
    this.dialogError.set(null);
    this.revokeDialogOpen.set(true);
  }

  protected closeRevokeDialog(): void {
    this.selectedPermission.set(null);
    this.dialogError.set(null);
  }

  protected confirmRevoke(): void {
    const group = this.group();
    const permission = this.selectedPermission();
    if (!group || !permission || !this.canDetach() || group.deletedAt) return;
    this.busy.set(true);
    this.dialogError.set(null);
    this.api.detachGroupPermission(group.id, permission.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.revokeDialogOpen.set(false);
        this.selectedPermission.set(null);
        this.reloadGroupPermissions(group.id);
      },
      error: () => {
        this.busy.set(false);
        this.dialogError.set('Failed to revoke group permission.');
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

  protected openAttachDialog(): void {
    this.selectedPermissionIds.set([]);
    this.dialogError.set(null);
    this.attachDialogOpen.set(true);
  }

  protected closeAttachDialog(): void {
    this.selectedPermissionIds.set([]);
    this.dialogError.set(null);
  }

  protected openApplyDialog(): void {
    this.selectedUserIds.set([]);
    this.dialogError.set(null);
    this.applyDialogOpen.set(true);
  }

  protected closeApplyDialog(): void {
    this.selectedUserIds.set([]);
    this.dialogError.set(null);
  }

  protected goToPermissionsPage(page: number): void {
    this.permissionsPage.set(
      Math.min(Math.max(page, 1), this.permissionsPageCount()),
    );
  }

  protected attach(): void {
    const group = this.group();
    const ids = this.selectedPermissionIds();
    if (!group || ids.length === 0 || !this.canAttach()) return;
    this.busy.set(true);
    this.dialogError.set(null);
    this.api.attachGroupPermissions(group.id, ids).subscribe({
      next: () => {
        this.selectedPermissionIds.set([]);
        this.attachDialogOpen.set(false);
        this.busy.set(false);
        this.reloadGroupPermissions(group.id);
      },
      error: () => {
        this.busy.set(false);
        this.dialogError.set('Failed to attach group permissions.');
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
    this.dialogError.set(null);
    this.api.applyGroupToUsers(group.id, ids).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.selectedUserIds.set([]);
        this.applyDialogOpen.set(false);
        this.applyMessage.set(
          `${result.applied.length} user(s) updated; ${result.failed.length} failed.`,
        );
      },
      error: () => {
        this.busy.set(false);
        this.dialogError.set('Failed to apply permission group.');
      },
    });
  }

  private reloadGroupPermissions(id: string): void {
    this.permissionsLoading.set(true);
    this.api.groupPermissions(id).subscribe({
      next: (permissions) => {
        this.setAttachedPermissions(permissions);
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

  private setAttachedPermissions(permissions: PermissionRecord[]): void {
    this.attachedPermissions.set(permissions);
    this.permissionsPage.update((page) =>
      Math.min(page, this.permissionsPageCount()),
    );
  }

  protected formatDate(value: string): string {
    return DATE_FORMAT.format(new Date(value));
  }
}
