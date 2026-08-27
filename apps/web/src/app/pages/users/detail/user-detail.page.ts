import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent } from '@ojiepermana/angular/component/badge';
import { ButtonComponent } from '@ojiepermana/angular/component/button';
import {
  CardComponent,
  CardContentComponent,
  CardDescriptionComponent,
  CardHeaderComponent,
  CardTitleComponent,
} from '@ojiepermana/angular/component/card';
import { IconComponent } from '@ojiepermana/angular/component/icon';
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
import { PaginationComponent } from '../../../shared/pagination/pagination.component';
import {
  pageFromQuery,
  syncPageQuery,
} from '../../../shared/pagination/pagination-state';
import {
  defaultTimeWindow,
  isExpiredCursorError,
} from '../../observability/observability.utils';
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
import { UserTwoFactorPanel } from './user-two-factor-panel';

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EMPTY_META: LogsMeta = { page: 1, perPage: 25, total: 0, totalPages: 0 };

type TabKey = 'audit' | 'permissions' | 'access' | 'application';

function tabFromQuery(value: string | null): TabKey {
  return value === 'permissions' ||
    value === 'access' ||
    value === 'application'
    ? value
    : 'audit';
}

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
    IconComponent,
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
    PaginationComponent,
    UserEditDialog,
    UserAccessPanel,
    UserTwoFactorPanel,
  ],
  template: `
    <Page variant="stacked" scroll="content" [appearance]="layout.appearance()" class="h-full min-h-0">
      <PageHeader class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Users</p>
          <h1 class="truncate text-lg font-semibold text-foreground">{{ user()?.name ?? 'User' }}</h1>
        </div>
        <a Button variant="outline" size="xs" class="gap-1.5" routerLink="/users"><Icon name="arrow_back" [size]="14" aria-hidden="true" />Kembali ke daftar</a>
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

        <app-user-two-factor-panel [userId]="profile.id" />

        <Tabs [(value)]="tab">
          <TabsList>
            <button TabsTrigger value="audit" (click)="selectTab('audit')">Audit Trail</button>
            @if (canViewAccess()) {
              <button TabsTrigger value="permissions" (click)="selectTab('permissions')">Access</button>
            }
            <button TabsTrigger value="access" (click)="selectTab('access')">Access Log</button>
            <button TabsTrigger value="application" (click)="selectTab('application')">Application Log</button>
          </TabsList>

          @if (activeStorageWarning()) {
            <p class="mt-4 border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100" role="status">Penyimpanan signal tidak tersedia. Tampilan ini adalah blind spot, bukan hasil kosong.</p>
          }

          <TabsContent value="audit">
            @if (auditRows().length === 0) {
              <p class="border border-border bg-card p-5 text-sm text-muted-foreground">Belum ada audit trail untuk user ini.</p>
            } @else {
              <Table class="min-w-full bg-card text-xs">
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
                      <td TableCell class="whitespace-nowrap">{{ formatDate(row.auditedAt) }}</td>
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
              <p class="border border-border bg-card p-5 text-sm text-muted-foreground">{{ activeStorageWarning() ? 'Access log untuk user ini tidak dapat dibaca.' : 'Belum ada access log untuk user ini.' }}</p>
            } @else {
              <Table class="min-w-full bg-card text-xs">
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
                      <td TableCell class="whitespace-nowrap">{{ formatDate(row.accessedAt) }}</td>
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
              <p class="border border-border bg-card p-5 text-sm text-muted-foreground">{{ activeStorageWarning() ? 'Application log untuk user ini tidak dapat dibaca.' : 'Belum ada application log untuk user ini.' }}</p>
            } @else {
              <Table class="min-w-full bg-card text-xs">
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
                      <td TableCell class="whitespace-nowrap">{{ formatDate(row.occurredAt) }}</td>
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

      <PageFooter class="flex min-h-(--layout-topbar-height) flex-wrap items-center justify-between gap-3 px-3">
        <p class="text-sm text-muted-foreground">{{ pageLabel() }}</p>
        <div class="flex items-center gap-2">
          @if (activeCursorPagination()) {
            <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="logsLoading() || !activePrevCursor()" (click)="goToCursor(activePrevCursor())"><Icon name="chevron_left" [size]="14" aria-hidden="true" />Previous</button>
            <button Button variant="outline" size="xs" type="button" class="gap-1.5" [disabled]="logsLoading() || !activeNextCursor()" (click)="goToCursor(activeNextCursor())">Next<Icon name="chevron_right" [size]="14" aria-hidden="true" /></button>
          } @else {
            <app-pagination
              [page]="activeMeta().page"
              [totalPages]="activeMeta().totalPages"
              [loading]="logsLoading()"
              (pageChange)="goTo($event)"
            />
          }
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
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
  protected readonly accessCursorPagination = signal(false);
  protected readonly applicationCursorPagination = signal(false);
  protected readonly accessCursor = signal<string | null>(null);
  protected readonly applicationCursor = signal<string | null>(null);
  protected readonly accessPrevCursor = signal<string | null>(null);
  protected readonly accessNextCursor = signal<string | null>(null);
  protected readonly applicationPrevCursor = signal<string | null>(null);
  protected readonly applicationNextCursor = signal<string | null>(null);
  protected readonly accessStorageWarning = signal(false);
  protected readonly applicationStorageWarning = signal(false);
  protected readonly accessFrom = signal(defaultTimeWindow().from);
  protected readonly accessTo = signal(defaultTimeWindow().to);
  protected readonly applicationFrom = signal(defaultTimeWindow().from);
  protected readonly applicationTo = signal(defaultTimeWindow().to);

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
  protected readonly activeCursorPagination = computed(() => {
    switch (this.tab()) {
      case 'access':
        return this.accessCursorPagination();
      case 'application':
        return this.applicationCursorPagination();
      default:
        return false;
    }
  });
  protected readonly activePrevCursor = computed(() => {
    switch (this.tab()) {
      case 'access':
        return this.accessPrevCursor();
      case 'application':
        return this.applicationPrevCursor();
      default:
        return null;
    }
  });
  protected readonly activeNextCursor = computed(() => {
    switch (this.tab()) {
      case 'access':
        return this.accessNextCursor();
      case 'application':
        return this.applicationNextCursor();
      default:
        return null;
    }
  });
  protected readonly activeStorageWarning = computed(() => {
    switch (this.tab()) {
      case 'access':
        return this.accessStorageWarning();
      case 'application':
        return this.applicationStorageWarning();
      default:
        return false;
    }
  });
  protected readonly activeLogRowCount = computed(() => {
    switch (this.tab()) {
      case 'access':
        return this.accessRows().length;
      case 'application':
        return this.applicationRows().length;
      default:
        return 0;
    }
  });
  protected readonly pageLabel = computed(() => {
    if (this.activeCursorPagination()) {
      return `${this.activeLogRowCount()} baris di halaman ini`;
    }
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
    const query = this.route.snapshot.queryParamMap;
    const initialTab = tabFromQuery(query.get('tab'));
    const initialPage = pageFromQuery(query.get('page'));

    effect(() => {
      const id = this.id();
      this.tab.set(initialTab);
      this.resetSignalLogCursor('access');
      this.resetSignalLogCursor('application');
      this.loadProfile(id);
      this.loadLogs(initialTab, initialPage, id);
    });
  }

  protected selectTab(tab: TabKey): void {
    this.tab.set(tab);
    this.syncTabQuery(tab);
    if (tab === 'access' || tab === 'application') {
      this.resetSignalLogCursor(tab);
    }
    if (tab !== 'permissions') this.loadLogs(tab, 1, this.id());
  }

  protected goTo(page: number): void {
    syncPageQuery(this.router, this.route, page);
    this.loadLogs(this.tab(), page, this.id());
  }

  protected goToCursor(cursor: string | null): void {
    if (!cursor) return;
    syncPageQuery(this.router, this.route, 1);
    const tab = this.tab();
    if (tab === 'access') {
      this.accessCursor.set(cursor);
    } else if (tab === 'application') {
      this.applicationCursor.set(cursor);
    } else {
      return;
    }
    this.loadLogs(tab, 1, this.id());
  }

  private syncTabQuery(tab: TabKey): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        tab: tab === 'audit' ? null : tab,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
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
          from: this.accessFrom(),
          to: this.accessTo(),
          cursor: this.accessCursor() ?? undefined,
        })
        .subscribe({
          next: (response) => {
            this.accessRows.set(response.data);
            if ('meta' in response) {
              this.accessMeta.set(response.meta);
              this.accessCursorPagination.set(false);
              this.accessCursor.set(null);
              this.accessPrevCursor.set(null);
              this.accessNextCursor.set(null);
              this.accessStorageWarning.set(false);
            } else {
              this.accessMeta.set(EMPTY_META);
              this.accessCursorPagination.set(true);
              this.accessPrevCursor.set(response.prevCursor);
              this.accessNextCursor.set(response.nextCursor);
              this.accessStorageWarning.set(
                response.storageStatus === 'blind_spot',
              );
            }
            this.logsLoading.set(false);
          },
          error: (error: unknown) => {
            if (this.accessCursor() && isExpiredCursorError(error)) {
              this.accessCursor.set(null);
              this.loadLogs(tab, 1, actorUserId);
              return;
            }
            this.logsLoading.set(false);
          },
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
        from: this.applicationFrom(),
        to: this.applicationTo(),
        cursor: this.applicationCursor() ?? undefined,
      })
      .subscribe({
        next: (response) => {
          this.applicationRows.set(response.data);
          if ('meta' in response) {
            this.applicationMeta.set(response.meta);
            this.applicationCursorPagination.set(false);
            this.applicationCursor.set(null);
            this.applicationPrevCursor.set(null);
            this.applicationNextCursor.set(null);
            this.applicationStorageWarning.set(false);
          } else {
            this.applicationMeta.set(EMPTY_META);
            this.applicationCursorPagination.set(true);
            this.applicationPrevCursor.set(response.prevCursor);
            this.applicationNextCursor.set(response.nextCursor);
            this.applicationStorageWarning.set(
              response.storageStatus === 'blind_spot',
            );
          }
          this.logsLoading.set(false);
        },
        error: (error: unknown) => {
          if (this.applicationCursor() && isExpiredCursorError(error)) {
            this.applicationCursor.set(null);
            this.loadLogs(tab, 1, actorUserId);
            return;
          }
          this.logsLoading.set(false);
        },
      });
  }

  private resetSignalLogCursor(tab: 'access' | 'application'): void {
    const range = defaultTimeWindow();
    if (tab === 'access') {
      this.accessCursor.set(null);
      this.accessPrevCursor.set(null);
      this.accessNextCursor.set(null);
      this.accessCursorPagination.set(false);
      this.accessStorageWarning.set(false);
      this.accessFrom.set(range.from);
      this.accessTo.set(range.to);
      return;
    }
    this.applicationCursor.set(null);
    this.applicationPrevCursor.set(null);
    this.applicationNextCursor.set(null);
    this.applicationCursorPagination.set(false);
    this.applicationStorageWarning.set(false);
    this.applicationFrom.set(range.from);
    this.applicationTo.set(range.to);
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
