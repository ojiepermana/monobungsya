import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../auth/auth.service';
import { AuthService } from '../../../auth/auth.service';
import { PERMISSIONS } from '../../../auth/permissions';
import {
  ApiService,
  type PermissionGroupRecord,
  type PermissionRecord,
  type UserRecord,
} from '../../../services/api.service';
import { GroupDetailPage } from './group-detail.page';

const group: PermissionGroupRecord = {
  id: 'group-1',
  name: 'Operators',
  status: 'active',
  description: 'Can operate the system',
  permissionCount: 1,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  deletedAt: null,
};

const permission = {
  id: 'permission-1',
  name: 'user:user:read',
  code: 'USER_USER_READ',
  namespace: 'user',
  resource: 'user',
  action: 'read',
  scope: null,
  description: 'Read users',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
} satisfies PermissionRecord;

const additionalPermission = {
  ...permission,
  id: 'permission-2',
  name: 'user:user:update',
  code: 'USER_USER_UPDATE',
  action: 'update',
  description: 'Update users',
} satisfies PermissionRecord;

const user: UserRecord = {
  id: 'user-1',
  name: 'Jane Staff',
  email: 'jane@project.local',
  status: 'active',
  emailVerifiedAt: null,
  suspendedAt: null,
  blockedAt: null,
  deletedAt: null,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: null,
};

const caller: AuthUser = {
  id: 'admin-1',
  name: 'Admin One',
  email: 'admin@project.local',
  permissions: [
    PERMISSIONS.accessGroupUpdate,
    PERMISSIONS.accessGroupDelete,
    PERMISSIONS.accessGroupRestore,
    PERMISSIONS.accessPermissionGroupCreate,
    PERMISSIONS.accessPermissionGroupDelete,
    PERMISSIONS.accessPermissionUserCreate,
    PERMISSIONS.userUserList,
  ],
};

function createPage(
  authUser: AuthUser | null = caller,
  authOverrides: {
    hasPermission?: (permissionName: string) => boolean;
  } = {},
  apiOverrides: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const api = {
    group: vi.fn().mockReturnValue(of(group)),
    groupPermissions: vi.fn().mockReturnValue(of([permission])),
    permissions: vi
      .fn()
      .mockReturnValue(of({ data: [permission, additionalPermission] })),
    users: vi.fn().mockReturnValue(
      of({
        data: [user],
        meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
        filters: { search: '', status: '' },
        options: { statuses: ['active'] },
      }),
    ),
    updateGroup: vi.fn().mockReturnValue(of(group)),
    deleteGroup: vi.fn().mockReturnValue(of(undefined)),
    restoreGroup: vi.fn().mockReturnValue(of(group)),
    attachGroupPermissions: vi
      .fn()
      .mockReturnValue(of({ attached: [], skipped: [] })),
    detachGroupPermission: vi.fn().mockReturnValue(of(undefined)),
    applyGroupToUsers: vi.fn().mockReturnValue(
      of({
        applied: [{ userId: user.id, granted: ['permission-2'], skipped: [] }],
        failed: [],
      }),
    ),
    ...apiOverrides,
  };
  const hasPermission = vi.fn(
    (permissionName: string) =>
      authUser?.permissions.includes(permissionName as never) ?? false,
  );

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: LayoutService,
        useValue: { appearance: () => 'flat', type: () => 'vertical' },
      },
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: {
          user: signal(authUser),
          hasPermission: authOverrides.hasPermission ?? hasPermission,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(GroupDetailPage);
  fixture.componentRef.setInput('id', group.id);
  fixture.detectChanges();
  return { fixture, api, component: fixture.componentInstance };
}

describe('GroupDetailPage (spec docs/specs/0015-permission-group-template)', () => {
  it('AC-13 renders profile, attached permissions, catalog choices, and a user picker', () => {
    const { fixture, api } = createPage();
    const root = fixture.nativeElement as HTMLElement;

    expect(api.group).toHaveBeenCalledWith(group.id);
    expect(api.groupPermissions).toHaveBeenCalledWith(group.id);
    expect(api.permissions).toHaveBeenCalledWith({
      search: '',
      namespace: '',
      page: 1,
    });
    expect(api.users).toHaveBeenCalledWith({
      search: '',
      status: '',
      page: 1,
    });
    expect(root.textContent).toContain('Profile');
    expect(root.textContent).toContain('Group permissions');
    expect(root.textContent).toContain('Operators');
    expect(root.textContent).toContain(permission.name);
    expect(root.textContent).toContain('Apply to users');
    expect(root.querySelector('#detail-group-name')).not.toBeNull();
    expect(root.querySelector('#detail-group-description')).not.toBeNull();
    expect(root.querySelector('#detail-group-status')).not.toBeNull();
    expect(root.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('AC-5 attaches a selected catalog permission and AC-8 reports the bulk result', () => {
    const { fixture, api } = createPage();
    const root = fixture.nativeElement as HTMLElement;
    const permissionLabel = Array.from(root.querySelectorAll('label')).find(
      (label) => label.textContent?.includes(additionalPermission.name),
    );
    const permissionCheckbox = permissionLabel?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(permissionCheckbox).not.toBeNull();
    if (!permissionCheckbox) throw new Error('permission checkbox missing');
    permissionCheckbox.checked = true;
    permissionCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const attachButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Attach selected'),
    );
    attachButton?.click();
    fixture.detectChanges();
    expect(api.attachGroupPermissions).toHaveBeenCalledWith(group.id, [
      additionalPermission.id,
    ]);

    const userLabel = Array.from(root.querySelectorAll('label')).find((label) =>
      label.textContent?.includes(user.email),
    );
    const userCheckbox = userLabel?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(userCheckbox).not.toBeNull();
    if (!userCheckbox) throw new Error('user checkbox missing');
    userCheckbox.checked = true;
    userCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const applyButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Apply to 1 users'),
    );
    applyButton?.click();
    fixture.detectChanges();
    expect(api.applyGroupToUsers).toHaveBeenCalledWith(group.id, [user.id]);
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      '1 user(s) updated; 0 failed.',
    );
  });

  it('AC-13 disables user selection without user list permission', () => {
    const hasPermission = vi.fn(
      (permissionName: string) => permissionName !== PERMISSIONS.userUserList,
    );
    const { fixture, api } = createPage(caller, { hasPermission });
    const root = fixture.nativeElement as HTMLElement;

    expect(api.users).not.toHaveBeenCalled();
    expect(root.textContent).toContain(
      'User selection is disabled because you do not have user list access.',
    );
    expect(root.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(root.textContent).not.toContain(user.email);
  });

  it('AC-13 renders an error state when the group detail request fails', () => {
    const { fixture } = createPage(
      caller,
      {},
      {
        group: vi
          .fn()
          .mockReturnValue(throwError(() => new Error('not found'))),
      },
    );
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('Failed to load permission group.');
    expect(fixture.nativeElement.textContent).toContain(
      'Permission group not found.',
    );
  });
});
