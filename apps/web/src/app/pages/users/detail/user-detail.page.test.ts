import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../auth/auth.service';
import { AuthService } from '../../../auth/auth.service';
import {
  ApiService,
  type AuditTrailsResponse,
  type LogsMeta,
  type UserRecord,
  type UsersResponse,
} from '../../../services/api.service';
import { UserDetailPage } from './user-detail.page';

function emptyMeta(): LogsMeta {
  return { page: 1, perPage: 25, total: 0, totalPages: 0 };
}

function testUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    name: 'Jane Staff',
    email: 'jane@project.local',
    status: 'active',
    emailVerifiedAt: null,
    suspendedAt: null,
    blockedAt: null,
    deletedAt: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

function usersResponse(): UsersResponse {
  return {
    data: [],
    meta: emptyMeta(),
    filters: { search: '', status: '' },
    options: { statuses: ['active', 'suspended', 'blocked', 'deleted'] },
  };
}

function auditResponse(
  overrides: Partial<AuditTrailsResponse> = {},
): AuditTrailsResponse {
  return {
    data: [],
    meta: emptyMeta(),
    filters: { search: '', module: '', action: '' },
    options: { modules: [], actions: [] },
    ...overrides,
  };
}

function createDetailPage(
  apiOverrides: Record<string, ReturnType<typeof vi.fn>> = {},
  id = 'user-1',
  callerUser: AuthUser | null = {
    id: 'admin-1',
    name: 'Admin One',
    email: 'admin@project.local',
    permissions: ['user:user:manage'],
  },
) {
  const api = {
    user: vi.fn().mockReturnValue(of(testUser({ id }))),
    users: vi.fn().mockReturnValue(of(usersResponse())),
    updateUser: vi.fn().mockReturnValue(of(testUser({ id }))),
    runUserStatusAction: vi.fn().mockReturnValue(of(testUser({ id }))),
    auditTrails: vi.fn().mockReturnValue(of(auditResponse())),
    ...apiOverrides,
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: {
          user: signal(callerUser),
          hasPermission: vi.fn().mockReturnValue(false),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(UserDetailPage);
  fixture.componentRef.setInput('id', id);
  fixture.detectChanges();

  return { fixture, api, component: fixture.componentInstance };
}

interface UserDetailPageInternals {
  loading(): boolean;
  error(): string | null;
  user(): UserRecord | null;
  tab(): 'audit' | 'permissions';
  logsLoading(): boolean;
  auditRows(): unknown[];
  activeMeta(): LogsMeta;
  actions(): Array<{ action: string }>;
  editOpen(): boolean;
  editError(): string | null;
  actionOpen(): boolean;
  actionError(): string | null;
  selectTab(tab: 'audit' | 'permissions'): void;
  goTo(page: number): void;
  openEdit(): void;
  submitEdit(payload: unknown): void;
  askFor(action: { action: string }): void;
  runAction(reason: string): void;
}

function internal(component: UserDetailPage): UserDetailPageInternals {
  return component as unknown as UserDetailPageInternals;
}

describe('UserDetailPage load (spec docs/specs/0007-user-management, AC-9, AC-10)', () => {
  it('loads the profile and the audit tab for the routed id on construction', () => {
    const { api, component } = createDetailPage({}, 'user-42');
    const page = internal(component);

    expect(api.user).toHaveBeenCalledWith('user-42');
    expect(api.auditTrails).toHaveBeenCalledWith({
      search: '',
      module: '',
      action: '',
      page: 1,
      actorUserId: 'user-42',
    });
    expect(page.loading()).toBe(false);
    expect(page.user()?.id).toBe('user-42');
    expect(page.tab()).toBe('audit');
  });

  it('sets an error and stops loading when the profile request fails', () => {
    const { component } = createDetailPage({
      user: vi.fn().mockReturnValue(throwError(() => new Error('not found'))),
    });
    const page = internal(component);

    expect(page.loading()).toBe(false);
    expect(page.error()).toBe('Gagal memuat user.');
    expect(page.user()).toBeNull();
  });
});

describe('UserDetailPage page composition (spec docs/specs/0007-user-management, AC-12)', () => {
  it('composes the shared stacked page slots with content scrolling and no page main', () => {
    const { fixture } = createDetailPage();
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;
    const content = root.querySelector('pagecontent') as HTMLElement;

    expect(root).not.toBeNull();
    expect(root.getAttribute('data-page-variant')).toBe('stacked');
    expect(root.getAttribute('data-page-scroll')).toBe('content');
    const header = root.querySelector('pageheader') as HTMLElement;
    const footer = root.querySelector('pagefooter') as HTMLElement;

    expect(root.querySelectorAll('pageheader')).toHaveLength(1);
    expect(header.className).toContain('min-h-(--layout-topbar-height)');
    expect(root.querySelectorAll('pagecontent')).toHaveLength(1);
    expect(content.classList.contains('p-6')).toBe(false);
    expect(root.querySelectorAll('pagefooter')).toHaveLength(1);
    expect(footer.className).toContain('min-h-(--layout-topbar-height)');
    expect(
      root.querySelector('pagecontent app-user-edit-dialog'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('main')).toBeNull();
  });
});

describe('UserDetailPage edit and status actions (spec docs/specs/0007-user-management, AC-3, AC-4, AC-6)', () => {
  it('updates the user and reloads the audit tab on a successful edit', () => {
    const updated = testUser({
      id: 'user-1',
      name: 'Renamed',
    });
    const { api, component } = createDetailPage({
      updateUser: vi.fn().mockReturnValue(of(updated)),
    });
    const page = internal(component);
    api.auditTrails.mockClear();
    page.openEdit();

    page.submitEdit({ name: 'Renamed' });

    expect(api.updateUser).toHaveBeenCalledWith('user-1', {
      name: 'Renamed',
    });
    expect(page.editOpen()).toBe(false);
    expect(page.user()).toEqual(updated);
    expect(api.auditTrails).toHaveBeenCalledWith({
      search: '',
      module: '',
      action: '',
      page: 1,
      actorUserId: 'user-1',
    });
  });

  it('keeps the edit dialog open and reports the server message on failure', () => {
    const { component } = createDetailPage({
      updateUser: vi.fn().mockReturnValue(
        throwError(() => ({
          error: { error: { reason: 'last_active_admin' } },
        })),
      ),
    });
    const page = internal(component);
    page.openEdit();

    page.submitEdit({ name: 'Renamed' });

    expect(page.editOpen()).toBe(true);
    expect(page.editError()).toBe(
      'Admin aktif terakhir tidak bisa dinonaktifkan atau diturunkan.',
    );
  });

  it('runs a status action, updates the profile, and reloads the audit tab on success', () => {
    const suspended = testUser({
      id: 'user-1',
      status: 'suspended',
      suspendedAt: '2026-08-22T00:00:00.000Z',
    });
    const { api, component } = createDetailPage({
      runUserStatusAction: vi.fn().mockReturnValue(of(suspended)),
    });
    const page = internal(component);
    page.askFor({ action: 'suspend' });

    page.runAction('policy violation');

    expect(api.runUserStatusAction).toHaveBeenCalledWith(
      'user-1',
      'suspend',
      'policy violation',
    );
    expect(page.actionOpen()).toBe(false);
    expect(page.user()?.status).toBe('suspended');
  });

  it('surfaces an invalid transition message and keeps the dialog open on failure', () => {
    const { component } = createDetailPage({
      runUserStatusAction: vi.fn().mockReturnValue(
        throwError(() => ({
          error: { error: { reason: 'invalid_transition' } },
        })),
      ),
    });
    const page = internal(component);
    page.askFor({ action: 'unsuspend' });

    page.runAction('reversing suspension');

    expect(page.actionOpen()).toBe(true);
    expect(page.actionError()).toBe(
      'Status user sudah berubah. Muat ulang halaman lalu coba lagi.',
    );
  });

  it("hides every status action on the caller's own profile (AC-6 self guard)", () => {
    const { component } = createDetailPage({}, 'admin-1', {
      id: 'admin-1',
      name: 'Admin One',
      email: 'admin@project.local',
      permissions: ['user:user:manage'],
    });

    expect(internal(component).actions()).toEqual([]);
  });

  it("offers status actions on someone else's profile", () => {
    const { component } = createDetailPage({}, 'user-1', {
      id: 'admin-1',
      name: 'Admin One',
      email: 'admin@project.local',
      permissions: ['user:user:manage'],
    });

    expect(internal(component).actions().length).toBeGreaterThan(0);
  });
});
