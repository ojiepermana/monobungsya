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
  it('AC-13 renders the group title, attached permissions table, and pagination footer', () => {
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
    expect(root.textContent).toContain('Operators');
    expect(root.textContent).toContain(permission.name);
    expect(root.textContent).toContain('Attached catalog permissions');
    expect(root.textContent).toContain('1 catalog permissions');
    expect(root.querySelector('table')).not.toBeNull();
    expect(root.querySelector('pagefooter')).not.toBeNull();
    const menuTrigger = root.querySelector(
      'button[aria-label="Group actions"]',
    ) as HTMLButtonElement | null;
    expect(menuTrigger).not.toBeNull();
    menuTrigger?.click();
    fixture.detectChanges();
    expect(document.body.textContent).toContain('Attach catalog');
    expect(document.body.textContent).toContain('Apply to users');
    expect(document.body.textContent).toContain('Turn off');
    expect(document.body.textContent).toContain('Delete');
    expect(root.querySelector('#detail-group-name')).toBeNull();
    expect(root.querySelector('#detail-group-description')).toBeNull();
    expect(root.querySelector('#detail-group-status')).toBeNull();
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('toggles the group status from the page header', () => {
    const updated = { ...group, status: 'off' as const };
    const { fixture, api } = createPage(
      caller,
      {},
      {
        updateGroup: vi.fn().mockReturnValue(of(updated)),
      },
    );
    const root = fixture.nativeElement as HTMLElement;
    const menuTrigger = root.querySelector(
      'button[aria-label="Group actions"]',
    );
    menuTrigger?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    const toggle = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Turn off'),
    );

    toggle?.click();
    fixture.detectChanges();

    expect(api.updateGroup).toHaveBeenCalledWith(group.id, { status: 'off' });
    expect(root.textContent).toContain('Off');
  });

  it('paginates attached catalog permissions in the page footer', () => {
    const permissions = Array.from({ length: 11 }, (_, index) => ({
      ...permission,
      id: `permission-${index + 1}`,
      name: `user:user:permission-${index + 1}` as PermissionRecord['name'],
    }));
    const { fixture } = createPage(
      caller,
      {},
      {
        groupPermissions: vi.fn().mockReturnValue(of(permissions)),
      },
    );
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Page 1 of 2 · 11 catalog permissions');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(10);

    const next = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Next'),
    );
    next?.click();
    fixture.detectChanges();

    expect(root.textContent).toContain('Page 2 of 2 · 11 catalog permissions');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.textContent).toContain('user:user:permission-11');
  });

  it('filters attached permissions from the toggleable PageFilter', () => {
    const secondPermission = {
      ...additionalPermission,
      namespace: 'access',
      name: 'access:group:update',
    } satisfies PermissionRecord;
    const { fixture } = createPage(
      caller,
      {},
      {
        groupPermissions: vi
          .fn()
          .mockReturnValue(of([permission, secondPermission])),
      },
    );
    const root = fixture.nativeElement as HTMLElement;
    const filterToggle = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Filter'),
    );

    expect(root.querySelector('input[type="search"]')).toBeNull();
    filterToggle?.click();
    fixture.detectChanges();

    const search = root.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement | null;
    expect(search).not.toBeNull();
    if (!search) throw new Error('permission filter search missing');
    search.value = 'access:group:update';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(root.textContent).toContain('access:group:update');
    expect(root.textContent).not.toContain(permission.name);
    expect(root.textContent).toContain('Page 1 of 1 · 1 catalog permissions');
  });

  it('revokes an attached permission from the table', () => {
    const groupPermissions = vi
      .fn()
      .mockReturnValueOnce(of([permission]))
      .mockReturnValueOnce(of([]));
    const { fixture, api } = createPage(caller, {}, { groupPermissions });
    const root = fixture.nativeElement as HTMLElement;
    const revoke = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Revoke'),
    );

    revoke?.click();
    fixture.detectChanges();
    expect(api.detachGroupPermission).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Revoke permission?');

    const confirm = document.querySelector(
      'button[alertdialogaction]',
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    if (!confirm) throw new Error('revoke confirmation button missing');
    confirm.click();
    fixture.detectChanges();

    expect(api.detachGroupPermission).toHaveBeenCalledWith(
      group.id,
      permission.id,
    );
    expect(groupPermissions).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('No catalog permissions attached.');
  });

  it('AC-5 attaches from a dialog and AC-8 reports the bulk result from a dialog', () => {
    const { fixture, api } = createPage();
    const root = fixture.nativeElement as HTMLElement;
    const attachAction = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Attach catalog'),
    );
    attachAction?.click();
    fixture.detectChanges();

    const permissionLabel = Array.from(document.querySelectorAll('label')).find(
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

    const attachButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Attach selected'),
    );
    attachButton?.click();
    fixture.detectChanges();
    expect(api.attachGroupPermissions).toHaveBeenCalledWith(group.id, [
      additionalPermission.id,
    ]);

    const applyAction = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Apply to users'),
    );
    applyAction?.click();
    fixture.detectChanges();

    const userLabel = Array.from(document.querySelectorAll('label')).find(
      (label) => label.textContent?.includes(user.email),
    );
    const userCheckbox = userLabel?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(userCheckbox).not.toBeNull();
    if (!userCheckbox) throw new Error('user checkbox missing');
    userCheckbox.checked = true;
    userCheckbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const applyButton = Array.from(document.querySelectorAll('button')).find(
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
    expect(
      Array.from(root.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Apply to users'),
      ),
    ).toBeUndefined();
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
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
