import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiService,
  type PermissionRecord,
  type PermissionsResponse,
} from '../../../services/api.service';
import { PermissionsPage } from './permissions.page';

const permission: PermissionRecord = {
  id: 'permission-1',
  name: 'user:user:read',
  code: 'USER_USER_READ',
  namespace: 'user',
  resource: 'user',
  action: 'read',
  scope: null,
  description: 'Read users',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
};

function response(
  rows: PermissionRecord[] = [permission],
): PermissionsResponse {
  return {
    data: rows,
    meta: { page: 1, pageSize: 25, total: rows.length, totalPages: 1 },
    filters: { search: '', namespace: '' },
  };
}

function createPage() {
  const api = {
    permissions: vi.fn().mockReturnValue(of(response())),
    createPermission: vi.fn().mockReturnValue(of(permission)),
    updatePermission: vi.fn().mockReturnValue(of(permission)),
    deletePermission: vi.fn().mockReturnValue(of(undefined)),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: LayoutService,
        useValue: {
          appearance: () => 'flat',
          type: () => 'vertical',
        },
      },
      { provide: ApiService, useValue: api },
    ],
  });

  const fixture = TestBed.createComponent(PermissionsPage);
  fixture.detectChanges();
  return { fixture, api, component: fixture.componentInstance };
}

interface PermissionsPageInternals {
  filterOpen(): boolean;
  remove(permission: PermissionRecord): void;
}

function internal(component: PermissionsPage): PermissionsPageInternals {
  return component as unknown as PermissionsPageInternals;
}

describe('PermissionsPage (spec docs/specs/0008-permission-acl, AC-14, AC-15)', () => {
  it('starts with filters closed and exposes catalog actions', () => {
    const { fixture, component } = createPage();
    const page = internal(component);
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;

    expect(page.filterOpen()).toBe(false);
    expect(root.getAttribute('data-page-variant')).toBe('stacked');
    expect(root.querySelector('pagefilter')).not.toBeNull();
    expect(root.textContent).toContain('Permission Catalog');
    expect(root.textContent).toContain('Create permission');
    expect(root.textContent).toContain('Edit');
    expect(root.textContent).toContain('Delete');
  });

  it('explains cascading grants before deleting and respects cancellation', () => {
    const { component, api } = createPage();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    try {
      internal(component).remove(permission);
      expect(confirm).toHaveBeenCalledWith(
        'Delete user:user:read? This will cascade and remove all user grants.',
      );
      expect(api.deletePermission).not.toHaveBeenCalled();

      confirm.mockReturnValue(true);
      internal(component).remove(permission);
      expect(api.deletePermission).toHaveBeenCalledWith(permission.id);
    } finally {
      confirm.mockRestore();
    }
  });
});
