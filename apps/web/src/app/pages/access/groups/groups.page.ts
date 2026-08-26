import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BadgeComponent,
  type BadgeVariant,
} from '@ojiepermana/angular/component/badge';
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
import {
  ApiService,
  type GroupDeletedFilter,
  type GroupStatus,
  type PermissionGroupRecord,
} from '../../../services/api.service';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META = { page: 1, pageSize: 25, total: 0, totalPages: 0 };

@Component({
  selector: 'app-groups-page',
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
    IconComponent,
    InputComponent,
    LabelComponent,
    NativeSelectComponent,
    NativeSelectOptionDirective,
    PageComponent,
    PageContentComponent,
    PageFilterComponent,
    PageFilterToggleComponent,
    PageFooterComponent,
    PageHeaderComponent,
    RouterLink,
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
          <Icon name="group" [size]="18" class="shrink-0 text-primary" aria-hidden="true" />
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Access</p>
          <h1 class="truncate text-lg font-semibold text-foreground">Permission groups</h1>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <PageFilterToggle ariaLabel="Show or hide filters" (toggled)="filterOpen.set($event)">
            <Icon name="filter_list" [size]="14" aria-hidden="true" />
            <span>Filter</span>
          </PageFilterToggle>
          <button Button size="xs" type="button" class="gap-1.5" (click)="openCreate()">
            <Icon name="add" [size]="14" aria-hidden="true" />
            Create group
          </button>
        </div>
      </PageHeader>

      <PageFilter
        placement="stacked"
        collapsible
        [hidden]="!filterOpen()"
        class="grid shrink-0 gap-3 px-3 py-4 md:flex md:flex-wrap md:items-center"
      >
        <input Input type="search" placeholder="Search name or description..." class="md:max-w-xs" [value]="search()" (input)="setSearch($event)" />
        <select NativeSelect class="md:w-36" [value]="status()" (change)="setStatus($event)">
          <option NativeSelectOption value="">All status</option>
          <option NativeSelectOption value="active">Active</option>
          <option NativeSelectOption value="off">Off</option>
        </select>
        <select NativeSelect class="md:w-48" [value]="deleted()" (change)="setDeleted($event)">
          <option NativeSelectOption value="exclude">Hide deleted</option>
          <option NativeSelectOption value="include">Include deleted</option>
          <option NativeSelectOption value="only">Deleted only</option>
        </select>
        <button Button variant="outline" size="xs" type="button" [disabled]="!hasFilters()" (click)="clearFilters()">Clear filters</button>
      </PageFilter>

      <PageContent class="grid min-h-0 content-start">
        @if (error()) {
          <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p>
        }
        @if (loading()) {
          <p class="text-sm text-muted-foreground">Loading permission groups...</p>
        } @else if (rows().length === 0) {
          <div class="border border-border bg-card p-5">
            <p class="font-medium text-foreground">No permission groups found.</p>
            <p class="mt-1 text-sm text-muted-foreground">Create a group or adjust the filters to see available templates.</p>
          </div>
        } @else {
          <Table class="min-w-full rounded-base bg-card">
            <caption TableCaption class="sr-only">Permission groups</caption>
            <thead TableHeader class="sticky top-0 z-10 bg-card text-xs uppercase text-muted-foreground">
              <tr TableRow>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Name</th>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Status</th>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Permissions</th>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Description</th>
                <th TableHead scope="col" class="bg-card shadow-[inset_0_-1px_0_0_var(--color-border)]">Updated</th>
                <th TableHead scope="col" class="bg-card text-right shadow-[inset_0_-1px_0_0_var(--color-border)]">Actions</th>
              </tr>
            </thead>
            <tbody TableBody>
              @for (group of rows(); track group.id) {
                <tr TableRow class="align-top">
                  <td TableCell>
                    <a [routerLink]="['/permission/group', group.id]" class="font-medium text-foreground underline-offset-4 hover:underline">{{ group.name }}</a>
                    @if (group.deletedAt) { <p class="mt-1 text-xs text-destructive">Deleted {{ formatDate(group.deletedAt) }}</p> }
                  </td>
                  <td TableCell><span Badge [variant]="statusVariant(group)">{{ statusLabel(group) }}</span></td>
                  <td TableCell class="whitespace-nowrap">{{ group.permissionCount }}</td>
                  <td TableCell class="max-w-sm text-muted-foreground">{{ group.description || '—' }}</td>
                  <td TableCell class="whitespace-nowrap text-muted-foreground">{{ formatDate(group.updatedAt) }}</td>
                  <td TableCell>
                    <div class="flex flex-wrap justify-end gap-2">
                      <a Button variant="outline" size="xs" class="gap-1.5" [routerLink]="['/permission/group', group.id]"><Icon name="open_in_new" [size]="14" aria-hidden="true" />Open</a>
                      @if (group.deletedAt) {
                        <button Button size="xs" type="button" class="gap-1.5" [disabled]="busyId() === group.id" (click)="restore(group)"><Icon name="restore" [size]="14" aria-hidden="true" />{{ busyId() === group.id ? 'Restoring...' : 'Restore' }}</button>
                      } @else {
                        <button Button variant="destructive" size="xs" type="button" class="gap-1.5" [disabled]="busyId() === group.id" (click)="remove(group)"><Icon name="delete" [size]="14" aria-hidden="true" />{{ busyId() === group.id ? 'Deleting...' : 'Delete' }}</button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </Table>
        }

        <Dialog [(open)]="dialogOpen" class="max-w-lg">
          <DialogHeader>
            <DialogTitle>{{ editing() ? 'Edit permission group' : 'Create permission group' }}</DialogTitle>
            <DialogDescription>Groups are copied into direct user grants when applied.</DialogDescription>
          </DialogHeader>
          <DialogContent class="grid gap-4 py-2">
            <div class="grid gap-2">
              <label Label for="group-name">Name</label>
              <input Input id="group-name" [value]="name()" (input)="setName($event)" />
            </div>
            <div class="grid gap-2">
              <label Label for="group-description">Description</label>
              <textarea id="group-description" class="min-h-24 border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" [value]="description()" (input)="setDescription($event)"></textarea>
            </div>
            <div class="grid gap-2">
              <label Label for="group-status">Status</label>
              <select NativeSelect id="group-status" [value]="formStatus()" (change)="setFormStatus($event)">
                <option NativeSelectOption value="active">Active</option>
                <option NativeSelectOption value="off">Off</option>
              </select>
            </div>
            @if (dialogError()) { <p class="text-sm text-destructive" role="alert">{{ dialogError() }}</p> }
          </DialogContent>
          <DialogFooter>
            <button Button variant="outline" type="button" DialogClose>Cancel</button>
            <button Button type="button" [disabled]="saving() || !formValid()" (click)="save()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </DialogFooter>
        </Dialog>
      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">Page {{ meta().page }} of {{ pageCount() }} · {{ meta().total }} groups</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page <= 1" (click)="load(meta().page - 1)"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button>
          <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="loading() || meta().page >= meta().totalPages" (click)="load(meta().page + 1)">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button>
        </div>
      </PageFooter>
    </Page>
  `,
})
export class GroupsPage {
  private readonly api = inject(ApiService);
  protected readonly layout = inject(LayoutService);
  protected readonly filterOpen = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = signal<PermissionGroupRecord[]>([]);
  protected readonly meta = signal(EMPTY_META);
  protected readonly search = signal('');
  protected readonly status = signal<GroupStatus | ''>('');
  protected readonly deleted = signal<GroupDeletedFilter>('exclude');
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<PermissionGroupRecord | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly formStatus = signal<GroupStatus>('active');
  protected readonly saving = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly formValid = computed(() => this.name().trim().length > 0);
  protected readonly pageCount = computed(() =>
    Math.max(this.meta().totalPages, 1),
  );

  constructor() {
    this.load(1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    const status = this.status();
    this.api
      .groups({
        search: this.search(),
        ...(status ? { status } : {}),
        deleted: this.deleted(),
        page,
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.data);
          this.meta.set(response.meta);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Failed to load permission groups.');
          this.loading.set(false);
        },
      });
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.load(1);
  }

  protected setStatus(event: Event): void {
    this.status.set(
      (event.target as HTMLSelectElement).value as GroupStatus | '',
    );
    this.load(1);
  }

  protected setDeleted(event: Event): void {
    this.deleted.set(
      (event.target as HTMLSelectElement).value as GroupDeletedFilter,
    );
    this.load(1);
  }

  protected hasFilters(): boolean {
    return (
      this.search().trim().length > 0 ||
      this.status() !== '' ||
      this.deleted() !== 'exclude'
    );
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('');
    this.deleted.set('exclude');
    this.load(1);
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.name.set('');
    this.description.set('');
    this.formStatus.set('active');
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected openEdit(group: PermissionGroupRecord): void {
    this.editing.set(group);
    this.name.set(group.name);
    this.description.set(group.description ?? '');
    this.formStatus.set(group.status);
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  protected setName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected setDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected setFormStatus(event: Event): void {
    this.formStatus.set(
      (event.target as HTMLSelectElement).value as GroupStatus,
    );
  }

  protected save(): void {
    const payload = {
      name: this.name().trim(),
      description: this.description().trim(),
      status: this.formStatus(),
    };
    this.saving.set(true);
    this.dialogError.set(null);
    const editing = this.editing();
    const request = editing
      ? this.api.updateGroup(editing.id, payload)
      : this.api.createGroup(payload);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.load(this.meta().page);
      },
      error: () => {
        this.saving.set(false);
        this.dialogError.set('Failed to save permission group.');
      },
    });
  }

  protected remove(group: PermissionGroupRecord): void {
    if (!window.confirm(`Delete permission group “${group.name}”?`)) return;
    this.busyId.set(group.id);
    this.api.deleteGroup(group.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.load(this.meta().page);
      },
      error: () => {
        this.busyId.set(null);
        this.error.set('Failed to delete permission group.');
      },
    });
  }

  protected restore(group: PermissionGroupRecord): void {
    this.busyId.set(group.id);
    this.api.restoreGroup(group.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.load(this.meta().page);
      },
      error: () => {
        this.busyId.set(null);
        this.error.set('Failed to restore permission group.');
      },
    });
  }

  protected statusLabel(group: PermissionGroupRecord): string {
    if (group.deletedAt) return 'Deleted';
    return group.status === 'active' ? 'Active' : 'Off';
  }

  protected statusVariant(group: PermissionGroupRecord): BadgeVariant {
    if (group.deletedAt || group.status === 'off') return 'destructive';
    return 'secondary';
  }

  protected formatDate(value: string): string {
    return DATE_FORMAT.format(new Date(value));
  }
}
