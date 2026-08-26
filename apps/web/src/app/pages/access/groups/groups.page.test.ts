import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiService,
  type PermissionGroupRecord,
  type PermissionGroupsResponse,
} from '../../../services/api.service';
import { GroupsPage } from './groups.page';

const group: PermissionGroupRecord = {
  id: 'group-1',
  name: 'Operators',
  status: 'active',
  description: 'Can operate the system',
  permissionCount: 3,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  deletedAt: null,
};

function response(
  rows: PermissionGroupRecord[] = [group],
): PermissionGroupsResponse {
  return {
    data: rows,
    meta: { page: 1, pageSize: 25, total: rows.length, totalPages: 1 },
    filters: {
      search: '',
      status: '',
      deleted: 'exclude',
      appliable: false,
    },
  };
}

function createPage(
  groups: ReturnType<typeof vi.fn> = vi.fn().mockReturnValue(of(response())),
) {
  const api = {
    groups,
    createGroup: vi.fn().mockReturnValue(of(group)),
    updateGroup: vi.fn().mockReturnValue(of(group)),
    deleteGroup: vi.fn().mockReturnValue(of(undefined)),
    restoreGroup: vi.fn().mockReturnValue(of(group)),
  };

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
    ],
  });

  const fixture = TestBed.createComponent(GroupsPage);
  fixture.detectChanges();
  return { fixture, api, component: fixture.componentInstance };
}

describe('GroupsPage (spec docs/specs/0015-permission-group-template)', () => {
  it('AC-12 renders a stacked list with hidden filters, required columns, and actions', () => {
    const { fixture, api } = createPage();
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;

    expect(api.groups).toHaveBeenCalledWith({
      search: '',
      deleted: 'exclude',
      page: 1,
    });
    expect(root.getAttribute('data-page-variant')).toBe('stacked');
    expect(root.querySelector('pagefilter')).not.toBeNull();
    expect(root.textContent).toContain('Permission groups');
    expect(root.textContent).toContain('Operators');
    expect(root.textContent).toContain('Permissions');
    expect(root.textContent).toContain('Description');
    expect(root.textContent).toContain('Create group');
    expect(root.textContent).toContain('Open');
    expect(root.textContent).toContain('Delete');

    const filterButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Filter'),
    );
    expect(filterButton).not.toBeUndefined();
    filterButton?.click();
    fixture.detectChanges();
    expect(root.querySelector('input[type="search"]')).not.toBeNull();
  });

  it('AC-12 shows a separate empty state and error state', () => {
    const empty = createPage(vi.fn().mockReturnValue(of(response([]))));
    expect(empty.fixture.nativeElement.textContent).toContain(
      'No permission groups found.',
    );

    const failed = createPage(
      vi.fn().mockReturnValue(throwError(() => new Error('network'))),
    );
    expect(
      failed.fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('Failed to load permission groups.');
  });

  it('AC-4 creates a group from the dialog and reloads the current page', () => {
    const { fixture, api } = createPage();
    const root = fixture.nativeElement as HTMLElement;
    const createButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Create group'),
    );
    createButton?.click();
    fixture.detectChanges();

    const name = document.querySelector('#group-name') as HTMLInputElement;
    expect(name).not.toBeNull();
    name.value = '  Finance operators  ';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const saveButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save',
    );
    expect(saveButton).not.toBeUndefined();
    saveButton?.click();
    fixture.detectChanges();

    expect(api.createGroup).toHaveBeenCalledWith({
      name: 'Finance operators',
      description: '',
      status: 'active',
    });
    expect(api.groups).toHaveBeenCalledTimes(2);
  });

  it('AC-4 confirms a live group delete before calling the API', () => {
    const { component, api } = createPage();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    try {
      (
        component as unknown as { remove(value: PermissionGroupRecord): void }
      ).remove(group);
      expect(confirm).toHaveBeenCalledWith(
        'Delete permission group “Operators”?',
      );
      expect(api.deleteGroup).not.toHaveBeenCalled();

      confirm.mockReturnValue(true);
      (
        component as unknown as { remove(value: PermissionGroupRecord): void }
      ).remove(group);
      expect(api.deleteGroup).toHaveBeenCalledWith(group.id);
    } finally {
      confirm.mockRestore();
    }
  });
});
