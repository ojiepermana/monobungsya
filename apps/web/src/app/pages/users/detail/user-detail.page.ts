import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import {
  CardComponent,
  CardContentComponent,
  CardDescriptionComponent,
  CardHeaderComponent,
  CardTitleComponent,
} from '@ojiepermana/angular/component/card';
import {
  TableBodyComponent,
  TableCaptionComponent,
  TableCellComponent,
  TableComponent,
  TableHeadComponent,
  TableHeaderComponent,
  TableRowComponent,
} from '@ojiepermana/angular/component/table';
import {
  TabsComponent,
  TabsContentComponent,
  TabsListComponent,
  TabsTriggerComponent,
} from '@ojiepermana/angular/component/tabs';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageFooterComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';
import { AuthService } from '../../../auth/auth.service';
import { PERMISSIONS } from '../../../auth/permissions';
import {
  type AccessLogItem,
  ApiService,
  type ApplicationLogItem,
  type AuditTrailItem,
  type LogsMeta,
  type UpdateUserPayload,
  type UserRecord,
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
import { UserAccessPanel } from './user-access-panel';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };

type TabKey = 'audit' | 'permissions' | 'access' | 'application';

/**
 * User detail (spec docs/specs/0007-user-management, AC-9 and AC-10): the
 * profile with its derived status and timestamps, the same status actions the
 * list offers, and this user's audit, access, and application logs. Each tab
 * asks the matching logs endpoint with actorUserId set to the route id, so the
 * rows are only ever this user's.
 */
@Component({
  selector: 'app-user-detail-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    CardContentComponent,
    CardDescriptionComponent,
    CardHeaderComponent,
    CardTitleComponent,
    ReasonDialog,
    RouterLink,
    TabsComponent,
    TabsContentComponent,
    TabsListComponent,
    TabsTriggerComponent,
    TableBodyComponent,
    TableCaptionComponent,
    TableCellComponent,
    TableComponent,
    TableHeadComponent,
    TableHeaderComponent,
    TableRowComponent,
    PageComponent,
    PageContentComponent,
    PageFooterComponent,
    PageHeaderComponent,
    UserEditDialog,
    UserAccessPanel,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-6">
        <div class="flex min-w-0 items-center gap-3">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Users</p>
          <h1 class="truncate text-lg font-semibold text-foreground">{{ user()?.name ?? 'User' }}</h1>
        </div>
        <a Button variant="outline" size="xs" routerLink="/users">Kembali ke daftar</a>
      </PageHeader>

      <PageContent class="grid min-h-0 content-start gap-6">
        @if (error()) {
          <p class="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{{ error() }}</p>
        }

      @if (loading()) {
        <p class="text-sm text-muted-foreground">Memuat user...</p>
      } @else if (user(); as profile) {
        <Card>
          <CardHeader>
            <CardTitle level="2" class="flex flex-wrap items-center gap-3">
              <span>{{ profile.email }}</span>
              <span Badge [variant]="statusVariant()">{{ statusLabel() }}</span>
            </CardTitle>
            <CardDescription class="font-mono text-xs">{{ profile.id }}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl class="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt class="text-xs uppercase text-muted-foreground">Dibuat</dt>
                <dd class="mt-1">{{ formatDate(profile.createdAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-muted-foreground">Diubah</dt>
                <dd class="mt-1">{{ formatDate(profile.updatedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-muted-foreground">Email terverifikasi</dt>
                <dd class="mt-1">{{ formatDate(profile.emailVerifiedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-muted-foreground">Ditangguhkan</dt>
                <dd class="mt-1">{{ formatDate(profile.suspendedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-muted-foreground">Diblokir</dt>
                <dd class="mt-1">{{ formatDate(profile.blockedAt) }}</dd>
              </div>
              <div>
                <dt class="text-xs uppercase text-muted-foreground">Dihapus</dt>
                <dd class="mt-1">{{ formatDate(profile.deletedAt) }}</dd>
              </div>
            </dl>

            <div class="mt-6 flex flex-wrap gap-2">
              @if (profile.status !== 'deleted') {
                <button Button size="xs" variant="outline" type="button" (click)="openEdit()">Ubah</button>
              }
              @for (action of actions(); track action.action) {
                <button
                  Button
                  size="xs"
                  type="button"
                  [variant]="action.destructive ? 'destructive' : 'outline'"
                  (click)="askFor(action)"
                >
                  {{ action.label }}
                </button>
              }
            </div>
          </CardContent>
        </Card>

        <Tabs [(value)]="tab">
          <TabsList>
            <button TabsTrigger value="audit" (click)="selectTab('audit')">Audit Trail</button>
            @if (canViewAccess()) {
              <button TabsTrigger value="permissions" (click)="selectTab('permissions')">Access</button>
            }
            <button TabsTrigger value="access" (click)="selectTab('access')">Access Log</button>
            <button TabsTrigger value="application" (click)="selectTab('application')">Application Log</button>
          </TabsList>

          <TabsContent value="audit">
            @if (auditRows().length === 0) {
              <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada audit trail untuk user ini.</p>
            } @else {
              <Table class="min-w-full border border-border bg-card">
                <caption TableCaption class="sr-only">Audit trail user</caption>
                <thead TableHeader class="text-xs uppercase text-muted-foreground">
                  <tr TableRow>
                    <th TableHead scope="col">Waktu</th>
                    <th TableHead scope="col">Action</th>
                    <th TableHead scope="col">Entity</th>
                    <th TableHead scope="col">Perubahan</th>
                  </tr>
                </thead>
                <tbody TableBody>
                  @for (row of auditRows(); track row.id) {
                    <tr TableRow class="align-top">
                      <td TableCell class="whitespace-nowrap font-mono text-xs">{{ formatDate(row.auditedAt) }}</td>
                      <td TableCell>{{ row.action }}</td>
                      <td TableCell>
                        <p class="font-medium text-foreground">{{ row.module }}</p>
                        <p class="text-xs text-muted-foreground">{{ row.entityLabel ?? row.entityId }}</p>
                      </td>
                      <td TableCell class="text-muted-foreground">{{ row.changeSummary ?? '-' }}</td>
                    </tr>
                  }
                </tbody>
              </Table>
            }
          </TabsContent>

          @if (canViewAccess()) {
            <TabsContent value="permissions">
              <app-user-access-panel [userId]="profile.id" />
            </TabsContent>
          }

          <TabsContent value="access">
            @if (accessRows().length === 0) {
              <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada access log untuk user ini.</p>
            } @else {
              <Table class="min-w-full border border-border bg-card">
                <caption TableCaption class="sr-only">Access log user</caption>
                <thead TableHeader class="text-xs uppercase text-muted-foreground">
                  <tr TableRow>
                    <th TableHead scope="col">Waktu</th>
                    <th TableHead scope="col">Event</th>
                    <th TableHead scope="col">Hasil</th>
                    <th TableHead scope="col">Kegagalan</th>
                  </tr>
                </thead>
                <tbody TableBody>
                  @for (row of accessRows(); track row.accessedAt + row.event) {
                    <tr TableRow class="align-top">
                      <td TableCell class="whitespace-nowrap font-mono text-xs">{{ formatDate(row.accessedAt) }}</td>
                      <td TableCell>{{ row.event }}</td>
                      <td TableCell>{{ row.outcome }}</td>
                      <td TableCell class="text-muted-foreground">{{ row.failureReason ?? '-' }}</td>
                    </tr>
                  }
                </tbody>
              </Table>
            }
          </TabsContent>

          <TabsContent value="application">
            @if (applicationRows().length === 0) {
              <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada application log untuk user ini.</p>
            } @else {
              <Table class="min-w-full border border-border bg-card">
                <caption TableCaption class="sr-only">Application log user</caption>
                <thead TableHeader class="text-xs uppercase text-muted-foreground">
                  <tr TableRow>
                    <th TableHead scope="col">Waktu</th>
                    <th TableHead scope="col">Level</th>
                    <th TableHead scope="col">Module</th>
                    <th TableHead scope="col">Message</th>
                  </tr>
                </thead>
                <tbody TableBody>
                  @for (row of applicationRows(); track row.id) {
                    <tr TableRow class="align-top">
                      <td TableCell class="whitespace-nowrap font-mono text-xs">{{ formatDate(row.occurredAt) }}</td>
                      <td TableCell>{{ row.level }}</td>
                      <td TableCell>{{ row.module ?? '-' }}</td>
                      <td TableCell class="text-muted-foreground">{{ row.message }}</td>
                    </tr>
                  }
                </tbody>
              </Table>
            }
          </TabsContent>
        </Tabs>

        <app-user-edit-dialog
          [(open)]="editOpen"
          [user]="profile"
          [busy]="saving()"
          [error]="editError()"
          (saved)="submitEdit($event)"
        />

        <app-reason-dialog
          [(open)]="actionOpen"
          [title]="pendingTitle()"
          [description]="pending()?.question ?? ''"
          [confirmLabel]="pending()?.label ?? 'Konfirmasi'"
          [destructive]="pending()?.destructive ?? false"
          [busy]="acting()"
          [error]="actionError()"
          (confirmed)="runAction($event)"
        />
      } @else {
        <p class="border border-border bg-card p-5 text-sm text-muted-foreground">User tidak ditemukan.</p>
      }

      </PageContent>

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-6">
        <p class="text-sm text-muted-foreground">{{ pageLabel() }}</p>
        <div class="flex items-center gap-2">
          <button Button variant="outline" size="xs" type="button" [disabled]="logsLoading() || activeMeta().page <= 1" (click)="goTo(1)">First</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="logsLoading() || activeMeta().page <= 1" (click)="goTo(activeMeta().page - 1)">Previous</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="logsLoading() || activeMeta().page >= activeMeta().totalPages" (click)="goTo(activeMeta().page + 1)">Next</button>
          <button Button variant="outline" size="xs" type="button" [disabled]="logsLoading() || activeMeta().page >= activeMeta().totalPages" (click)="goTo(activeMeta().totalPages)">Last</button>
        </div>
      </PageFooter>
    </Page>
  `,
})
export class UserDetailPage {
  /** Bound from the route param by withComponentInputBinding. */
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly user = signal<UserRecord | null>(null);

  protected readonly tab = signal<TabKey>('audit');
  protected readonly logsLoading = signal(false);
  protected readonly auditRows = signal<AuditTrailItem[]>([]);
  protected readonly accessRows = signal<AccessLogItem[]>([]);
  protected readonly applicationRows = signal<ApplicationLogItem[]>([]);
  protected readonly auditMeta = signal<LogsMeta>(EMPTY_META);
  protected readonly accessMeta = signal<LogsMeta>(EMPTY_META);
  protected readonly applicationMeta = signal<LogsMeta>(EMPTY_META);

  protected readonly editOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly editError = signal<string | null>(null);

  protected readonly actionOpen = signal(false);
  protected readonly acting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly pending = signal<StatusActionMeta | null>(null);

  protected readonly actions = computed(() => {
    const user = this.user();
    return user ? actionsFor(user, this.auth.user()?.id ?? null) : [];
  });
  protected readonly canViewAccess = computed(() =>
    this.auth.hasPermission(PERMISSIONS.accessPermissionUserList),
  );
  protected readonly activeMeta = computed(() => {
    switch (this.tab()) {
      case 'permissions':
        return EMPTY_META;
      case 'access':
        return this.accessMeta();
      case 'application':
        return this.applicationMeta();
      default:
        return this.auditMeta();
    }
  });
  protected readonly pageLabel = computed(() => {
    const meta = this.activeMeta();
    return `Page ${meta.page} of ${Math.max(meta.totalPages, 1)} · ${meta.total} baris`;
  });
  protected readonly pendingTitle = computed(() => {
    const pending = this.pending();
    const user = this.user();
    return pending && user ? `${pending.label} ${user.name}` : '';
  });

  /**
   * The route binds `id` after construction, and it changes when the router
   * reuses this component for a different user, so the load reacts to the input
   * rather than running once in the constructor.
   */
  constructor() {
    effect(() => {
      const id = this.id();
      this.tab.set('audit');
      this.loadProfile(id);
      this.loadLogs('audit', 1, id);
    });
  }

  protected selectTab(tab: TabKey): void {
    this.tab.set(tab);
    if (tab !== 'permissions') this.loadLogs(tab, 1, this.id());
  }

  protected goTo(page: number): void {
    this.loadLogs(this.tab(), page, this.id());
  }

  private loadProfile(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.user(id).subscribe({
      next: (user) => {
        this.user.set(user);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Gagal memuat user.');
        this.loading.set(false);
      },
    });
  }

  private loadLogs(tab: TabKey, page: number, actorUserId: string): void {
    if (tab === 'permissions') return;
    this.logsLoading.set(true);

    if (tab === 'audit') {
      this.api
        .auditTrails({ search: '', module: '', action: '', page, actorUserId })
        .subscribe({
          next: (response) => {
            this.auditRows.set(response.data);
            this.auditMeta.set(response.meta);
            this.logsLoading.set(false);
          },
          error: () => this.logsLoading.set(false),
        });

      return;
    }

    if (tab === 'access') {
      this.api
        .accessLogs({
          search: '',
          event: '',
          outcome: '',
          traceId: '',
          page,
          actorUserId,
        })
        .subscribe({
          next: (response) => {
            this.accessRows.set(response.data);
            this.accessMeta.set(response.meta);
            this.logsLoading.set(false);
          },
          error: () => this.logsLoading.set(false),
        });

      return;
    }

    this.api
      .applicationLogs({
        search: '',
        level: '',
        module: '',
        event: '',
        page,
        actorUserId,
      })
      .subscribe({
        next: (response) => {
          this.applicationRows.set(response.data);
          this.applicationMeta.set(response.meta);
          this.logsLoading.set(false);
        },
        error: () => this.logsLoading.set(false),
      });
  }

  protected openEdit(): void {
    this.editError.set(null);
    this.editOpen.set(true);
  }

  protected submitEdit(payload: UpdateUserPayload): void {
    this.saving.set(true);
    this.editError.set(null);
    this.api.updateUser(this.id(), payload).subscribe({
      next: (user) => {
        this.saving.set(false);
        this.editOpen.set(false);
        this.user.set(user);
        this.loadLogs('audit', 1, this.id());
      },
      error: (failure) => {
        this.saving.set(false);
        this.editError.set(statusActionError(failure));
      },
    });
  }

  protected askFor(action: StatusActionMeta): void {
    this.pending.set(action);
    this.actionError.set(null);
    this.actionOpen.set(true);
  }

  protected runAction(reason: string): void {
    const pending = this.pending();

    if (!pending) {
      return;
    }

    this.acting.set(true);
    this.actionError.set(null);
    this.api.runUserStatusAction(this.id(), pending.action, reason).subscribe({
      next: (user) => {
        this.acting.set(false);
        this.actionOpen.set(false);
        this.user.set(user);
        this.loadLogs('audit', 1, this.id());
      },
      error: (failure) => {
        this.acting.set(false);
        this.actionError.set(statusActionError(failure));
      },
    });
  }

  protected statusLabel(): string {
    const user = this.user();
    return user ? STATUS_LABELS[user.status] : '';
  }

  protected statusVariant() {
    const user = this.user();
    return user ? STATUS_VARIANTS[user.status] : 'secondary';
  }

  protected formatDate(iso: string | null): string {
    return iso ? DATE_FORMAT.format(new Date(iso)) : '-';
  }
}
