import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../auth/auth.service';
import { AuthService } from '../../../auth/auth.service';
import { PERMISSIONS } from '../../../auth/permissions';
import {
  ApiService,
  type PermissionGroupRecord,
  type PermissionRecord,
} from '../../../services/api.service';
import { UserAccessPanel } from './user-access-panel';

const permission: PermissionRecord = {
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
};

const group: PermissionGroupRecord = {
  id: 'group-1',
  name: 'Operators',
  status: 'active',
  description: 'Can operate the system',
  permissionCount: 2,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  deletedAt: null,
};

const caller: AuthUser = {
  id: 'admin-1',
  name: 'Admin One',
  email: 'admin@project.local',
  permissions: [PERMISSIONS.accessPermissionUserCreate],
};

function createPanel(
  authUser: AuthUser | null = caller,
  apiOverrides: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const api = {
    permissions: vi.fn().mockReturnValue(of({ data: [permission] })),
    userPermissions: vi.fn().mockReturnValue(of([])),
    groups: vi.fn().mockReturnValue(of({ data: [group] })),
    applyGroupToUser: vi
      .fn()
      .mockReturnValue(
        of({ granted: ['permission-1'], skipped: ['permission-2'] }),
      ),
    ...apiOverrides,
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: {
          user: signal(authUser),
          hasPermission: (permissionName: string) =>
            authUser?.permissions.includes(permissionName as never) ?? false,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(UserAccessPanel);
  fixture.componentRef.setInput('userId', 'user-1');
  fixture.detectChanges();
  return { fixture, api, component: fixture.componentInstance };
}

describe('UserAccessPanel (spec docs/specs/0015-permission-group-template)', () => {
  it('AC-14 loads applicable groups beside copy grants and reports granted and skipped counts', () => {
    const { fixture, api } = createPanel();
    const root = fixture.nativeElement as HTMLElement;

    expect(api.groups).toHaveBeenCalledWith({
      status: 'active',
      deleted: 'exclude',
      appliable: true,
      page: 1,
    });
    expect(root.querySelector('#copy-source-user')).not.toBeNull();
    expect(root.querySelector('#apply-permission-group')).not.toBeNull();
    expect(root.textContent).toContain('Operators (2)');

    const select = root.querySelector(
      '#apply-permission-group',
    ) as HTMLSelectElement;
    select.value = group.id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const applyButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Apply group',
    );
    applyButton?.click();
    fixture.detectChanges();

    expect(api.applyGroupToUser).toHaveBeenCalledWith('user-1', group.id);
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      'Group applied: 1 granted, 1 skipped.',
    );
  });

  it('AC-14 does not query or render group apply controls without grant permission', () => {
    const { fixture, api } = createPanel(null);
    const root = fixture.nativeElement as HTMLElement;

    expect(api.groups).not.toHaveBeenCalled();
    expect(root.querySelector('#apply-permission-group')).toBeNull();
    expect(root.textContent).toContain('Group apply access is required.');
  });
});
