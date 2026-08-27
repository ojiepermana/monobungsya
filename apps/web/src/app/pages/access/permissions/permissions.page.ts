import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { InputComponent } from '@ojiepermana/angular/component/input';
import { LabelComponent } from '@ojiepermana/angular/component/label';
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
import {
  ApiService,
  type PermissionRecord,
} from '../../../services/api.service';
import { PaginationComponent } from '../../../shared/pagination/pagination.component';
import {
  pageFromQuery,
  syncPageQuery,
} from '../../../shared/pagination/pagination-state';

interface PermissionListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const EMPTY_META: PermissionListMeta = {
  page: 1,
  pageSize: 100,
  total: 0,
  totalPages: 0,
};

@Component({
  selector: 'app-permissions-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    ButtonComponent,
    IconComponent,
    DialogCloseDirective,
    DialogComponent,
    DialogContentComponent,
    DialogDescriptionComponent,
    DialogFooterComponent,
    DialogHeaderComponent,
    DialogTitleComponent,
    InputComponent,
    LabelComponent,
    PageComponent,
    PageContentComponent,
    PageFilterComponent,
    PageFilterToggleComponent,
    PageFooterComponent,
    PageHeaderComponent,
    PaginationComponent,
    TableBodyComponent,
    TableCaptionComponent,
    TableCellComponent,
    TableComponent,
    TableHeadComponent,
    TableHeaderComponent,
    TableRowComponent,
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
          <Icon name="list_alt" [size]="18" class="shrink-0 text-primary" aria-hidden="true" />
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Access</p>
          <h1 class="truncate text-lg font-semibold text-foreground">Permissions</h1>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <PageFilterToggle
            ariaLabel="Show or hide filters"
            (toggled)="filterOpen.set($event)"
          >
            <Icon name="filter_list" [size]="14" aria-hidden="true" />
            <span>Filter</span>
          </PageFilterToggle>
          <button Button size="xs" type="button" class="gap-1.5" (click)="openCreate()">
            <Icon name="add" [size]="14" aria-hidden="true" />
            Create permission
          </button>
        </div>
      </PageHeader>

      <PageFilter
        placement="stacked"
        collapsible
        [hidden]="!filterOpen()"
        class="grid shrink-0 gap-3 px-3 py-4 md:flex md:items-center"
      >
        <input Input type="search" placeholder="Search name or code..." [value]="search()" (input)="setSearch($event)" />
        <input Input placeholder="Namespace" [value]="namespace()" (input)="setNamespace($event)" class="md:max-w-xs" />
      </PageFilter>

      <PageContent class="grid min-h-0 content-start">
        @if (error()) {
          <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p>
        }
        @if (loading()) {
          <p class="text-sm text-muted-foreground">Loading permissions...</p>
        } @else if (rows().length === 0) {
          <p class="border border-border bg-card p-5 text-sm text-muted-foreground">No permissions found.</p>
        } @else {
          <Table class="min-w-full rounded-base bg-card text-xs">
            <caption TableCaption class="sr-only">Permissions</caption>
            <thead TableHeader class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground">
              <tr TableRow>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Name</th>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Description</th>
                <th TableHead scope="col" class="bg-card text-right shadow-[inset_0_-1px_0_0_var(--color-border)]">Actions</th>
              </tr>
            </thead>
            <tbody TableBody>
              @for (permission of rows(); track permission.id) {
                <tr TableRow class="align-top">
                  <td TableCell>{{ permission.name }}</td>
                  <td TableCell class="text-muted-foreground">{{ permission.description }}</td>
                  <td TableCell>
                    <div class="flex justify-end gap-2">
                      <button Button variant="outline" size="xs" type="button" class="gap-1.5" (click)="openEdit(permission)"><Icon name="edit" [size]="14" aria-hidden="true" />Edit</button>
                      <button Button variant="destructive" size="xs" type="button" class="gap-1.5" (click)="remove(permission)"><Icon name="delete" [size]="14" aria-hidden="true" />Delete</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </Table>
        }

        <Dialog [(open)]="createOpen" class="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create permission</DialogTitle>
            <DialogDescription>Use a canonical namespace:resource:action name.</DialogDescription>
          </DialogHeader>
          <DialogContent class="grid gap-4 py-2">
            <div class="grid gap-2"><label Label for="permission-name">Name</label><input Input id="permission-name" [value]="name()" (input)="setName($event)" /></div>
            <div class="grid gap-2"><label Label for="permission-description">Description</label><input Input id="permission-description" [value]="description()" (input)="setDescription($event)" /></div>
            @if (dialogError()) { <p class="text-sm text-destructive" role="alert">{{ dialogError() }}</p> }
          </DialogContent>
          <DialogFooter>
            <button Button variant="outline" type="button" DialogClose>Cancel</button>
            <button Button type="button" [disabled]="saving() || !formValid()" (click)="create()">{{ saving() ? 'Saving...' : 'Create' }}</button>
          </DialogFooter>
        </Dialog>

        <Dialog [(open)]="editOpen" class="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit permission</DialogTitle>
            <DialogDescription>The permission name is immutable. Update its description.</DialogDescription>
          </DialogHeader>
          <DialogContent class="grid gap-4 py-2">
            <p class="font-mono text-sm text-foreground">{{ editing()?.name }}</p>
            <div class="grid gap-2"><label Label for="edit-permission-description">Description</label><input Input id="edit-permission-description" [value]="description()" (input)="setDescription($event)" /></div>
            @if (dialogError()) { <p class="text-sm text-destructive" role="alert">{{ dialogError() }}</p> }
          </DialogContent>
          <DialogFooter>
            <button Button variant="outline" type="button" DialogClose>Cancel</button>
            <button Button type="button" [disabled]="saving() || description().trim().length === 0" (click)="update()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </DialogFooter>
        </Dialog>
      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">Page {{ meta().page }} of {{ pageCount() }} · {{ meta().total }} permissions</p>
        <app-pagination
          [page]="meta().page"
          [totalPages]="meta().totalPages"
          [loading]="loading()"
          (pageChange)="goTo($event)"
        />
      </PageFooter>
    </Page>
  `,
})
export class PermissionsPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly layout = inject(LayoutService);
  protected readonly filterOpen = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly rows = signal<PermissionRecord[]>([]);
  protected readonly meta = signal<PermissionListMeta>(EMPTY_META);
  protected readonly search = signal('');
  protected readonly namespace = signal('');
  protected readonly createOpen = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly editing = signal<PermissionRecord | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly formValid = computed(
    () => this.name().trim().length > 0 && this.description().trim().length > 0,
  );
  protected readonly pageCount = computed(() =>
    Math.max(this.meta().totalPages, 1),
  );

  constructor() {
    this.load(pageFromQuery(this.route.snapshot.queryParamMap.get('page')));
  }

  protected load(page: number): void {
    syncPageQuery(this.router, this.route, page);
    this.loading.set(true);
    this.error.set(null);
    this.api
      .permissions({ search: this.search(), namespace: this.namespace(), page })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.meta.set(response.meta);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Failed to load permission catalog.');
          this.loading.set(false);
        },
      });
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected setNamespace(event: Event): void {
    this.namespace.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected goTo(page: number): void {
    this.load(page);
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.name.set('');
    this.description.set('');
    this.dialogError.set(null);
    this.createOpen.set(true);
  }

  protected openEdit(permission: PermissionRecord): void {
    this.editing.set(permission);
    this.name.set(permission.name);
    this.description.set(permission.description ?? '');
    this.dialogError.set(null);
    this.editOpen.set(true);
  }

  protected setName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected setDescription(event: Event): void {
    this.description.set((event.target as HTMLInputElement).value);
  }

  protected create(): void {
    this.saving.set(true);
    this.dialogError.set(null);
    this.api
      .createPermission({
        name: this.name().trim(),
        description: this.description().trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.createOpen.set(false);
          this.load(1);
        },
        error: () => {
          this.saving.set(false);
          this.dialogError.set('Failed to create permission.');
        },
      });
  }

  protected update(): void {
    const permission = this.editing();
    if (!permission) return;
    this.saving.set(true);
    this.dialogError.set(null);
    this.api
      .updatePermission(permission.id, this.description().trim())
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editOpen.set(false);
          this.load(this.meta().page);
        },
        error: () => {
          this.saving.set(false);
          this.dialogError.set('Failed to update permission.');
        },
      });
  }

  protected remove(permission: PermissionRecord): void {
    if (
      !window.confirm(
        `Delete ${permission.name}? This will cascade and remove all user grants.`,
      )
    )
      return;
    this.api.deletePermission(permission.id).subscribe({
      next: () => this.load(this.meta().page),
      error: () => this.error.set('Failed to delete permission.'),
    });
  }
}
