import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../auth/auth.service';
import { AuthService } from '../../../auth/auth.service';
import {
  ApiService,
  type UserRecord,
  type UsersResponse,
} from '../../../services/api.service';
import { UsersPage } from './users.page';

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

function emptyResponse(overrides: Partial<UsersResponse> = {}): UsersResponse {
  return {
    data: [],
    meta: { page: 1, perPage: 25, total: 0, totalPages: 0 },
    filters: { search: '', status: '' },
    options: { statuses: ['active', 'suspended', 'blocked', 'deleted'] },
    ...overrides,
  };
}

/**
 * `UsersPage`'s markup, and every real child it composes (Dialog, the reason
 * and edit dialogs, Button, etc.), all render fine under zoneless change
 * detection with no extra providers, the same as the standalone dialog tests.
 * `RouterLink` is the one exception: it injects `Router`, so an empty
 * `provideRouter([])` is required even though no navigation is exercised here.
 */
function createPage(
  apiOverrides: Record<string, ReturnType<typeof vi.fn>> = {},
  callerUser: AuthUser | null = {
    id: 'admin-1',
    name: 'Admin One',
    email: 'admin@project.local',
    permissions: ['user:user:manage'],
  },
) {
  const api = {
    users: vi.fn().mockReturnValue(of(emptyResponse())),
    createUser: vi.fn().mockReturnValue(of(testUser())),
    updateUser: vi.fn().mockReturnValue(of(testUser())),
    runUserStatusAction: vi.fn().mockReturnValue(of(testUser())),
    ...apiOverrides,
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: signal(callerUser) } },
    ],
  });

  const fixture = TestBed.createComponent(UsersPage);
  fixture.detectChanges();

  return { fixture, api, component: fixture.componentInstance };
}

interface UsersPageInternals {
  loading(): boolean;
  error(): string | null;
  rows(): UserRecord[];
  meta(): { page: number; perPage: number; total: number; totalPages: number };
  search(): string;
  status(): string;
  callerId(): string | null;
  hasFilters(): boolean;
  draftValid(): boolean;
  createOpen(): boolean;
  creating(): boolean;
  createError(): string | null;
  draft(): { id: string; name: string; email: string };
  editOpen(): boolean;
  editError(): string | null;
  actionOpen(): boolean;
  actionError(): string | null;
  updateSearch(event: Event): void;
  updateStatus(event: Event): void;
  clearFilters(): void;
  goTo(page: number): void;
  openCreate(): void;
  patchDraft(field: string, event: Event): void;
  submitCreate(): void;
  openEdit(user: UserRecord): void;
  submitEdit(payload: unknown): void;
  askFor(user: UserRecord, action: { action: string }): void;
  runAction(reason: string): void;
}

function internal(component: UsersPage): UsersPageInternals {
  return component as unknown as UsersPageInternals;
}

function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('UsersPage list and filters (spec docs/specs/0007-user-management, AC-9)', () => {
  it('loads the first page on construction and exposes rows and meta', () => {
    const row = testUser({ name: 'Loaded User' });
    const { component } = createPage({
      users: vi.fn().mockReturnValue(
        of(
          emptyResponse({
            data: [row],
            meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
          }),
        ),
      ),
    });
    const page = internal(component);

    expect(page.loading()).toBe(false);
    expect(page.rows()).toEqual([row]);
    expect(page.meta().total).toBe(1);
  });

  it('sets an error and stops loading when the list request fails', () => {
    const { component } = createPage({
      users: vi
        .fn()
        .mockReturnValue(throwError(() => new Error('network down'))),
    });
    const page = internal(component);

    expect(page.loading()).toBe(false);
    expect(page.error()).toBe('Gagal memuat daftar user.');
  });

  it('resets to page 1 when the search or status filter changes', () => {
    const { api, component } = createPage();
    const page = internal(component);
    api.users.mockClear();

    page.updateSearch(inputEvent('jane'));

    expect(page.search()).toBe('jane');
    expect(api.users).toHaveBeenCalledWith({
      search: 'jane',
      status: '',
      page: 1,
    });

    api.users.mockClear();
    page.updateStatus(inputEvent('suspended'));

    expect(page.status()).toBe('suspended');
    expect(api.users).toHaveBeenCalledWith({
      search: 'jane',
      status: 'suspended',
      page: 1,
    });
  });

  it('clearFilters resets both search and status and reloads page 1', () => {
    const { api, component } = createPage();
    const page = internal(component);
    page.updateSearch(inputEvent('jane'));
    api.users.mockClear();

    page.clearFilters();

    expect(page.search()).toBe('');
    expect(page.status()).toBe('');
    expect(page.hasFilters()).toBe(false);
    expect(api.users).toHaveBeenCalledWith({ search: '', status: '', page: 1 });
  });

  it('goTo requests the given page without resetting filters', () => {
    const { api, component } = createPage();
    const page = internal(component);
    page.updateSearch(inputEvent('jane'));
    api.users.mockClear();

    page.goTo(3);

    expect(api.users).toHaveBeenCalledWith({
      search: 'jane',
      status: '',
      page: 3,
    });
  });

  it('hasFilters reflects whether search or status is set', () => {
    const { component } = createPage();
    const page = internal(component);

    expect(page.hasFilters()).toBe(false);
    page.updateSearch(inputEvent('x'));
    expect(page.hasFilters()).toBe(true);
  });
});

describe('UsersPage create (spec docs/specs/0007-user-management, AC-1, AC-2)', () => {
  it('mints a client generated UUIDv7 for a new user', () => {
    const { component } = createPage();
    const page = internal(component);

    page.openCreate();

    expect(page.createOpen()).toBe(true);
    expect(page.createError()).toBeNull();
    // Version nibble 7 at the 13th hex digit, the shape a UUIDv7 always has.
    expect(page.draft().id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('draftValid requires a non empty name and an email containing @', () => {
    const { component } = createPage();
    const page = internal(component);
    page.openCreate();

    page.patchDraft('name', inputEvent(''));
    page.patchDraft('email', inputEvent('not-an-email'));
    expect(page.draftValid()).toBe(false);

    page.patchDraft('name', inputEvent('New User'));
    expect(page.draftValid()).toBe(false);

    page.patchDraft('email', inputEvent('new@project.local'));
    expect(page.draftValid()).toBe(true);
  });

  it('submits the trimmed draft, closes the dialog, and reloads the list on success', () => {
    const { api, component } = createPage();
    const page = internal(component);
    page.openCreate();
    page.patchDraft('name', inputEvent('  New User  '));
    page.patchDraft('email', inputEvent('  new@project.local  '));
    api.users.mockClear();

    page.submitCreate();

    expect(api.createUser).toHaveBeenCalledWith({
      id: page.draft().id,
      name: 'New User',
      email: 'new@project.local',
    });
    expect(page.creating()).toBe(false);
    expect(page.createOpen()).toBe(false);
    expect(api.users).toHaveBeenCalledWith({ search: '', status: '', page: 1 });
  });

  it('shows a duplicate id conflict as a specific message and keeps the dialog open', () => {
    const { component } = createPage({
      createUser: vi
        .fn()
        .mockReturnValue(
          throwError(() => ({ error: { error: { reason: 'user_id_taken' } } })),
        ),
    });
    const page = internal(component);
    page.openCreate();
    page.patchDraft('name', inputEvent('New User'));
    page.patchDraft('email', inputEvent('new@project.local'));

    page.submitCreate();

    expect(page.creating()).toBe(false);
    expect(page.createOpen()).toBe(true);
    expect(page.createError()).toBe(
      'Id user sudah dipakai. Tutup dialog lalu coba lagi.',
    );
  });

  it('shows a duplicate email conflict distinctly from a duplicate id (AC-1)', () => {
    const { component } = createPage({
      createUser: vi.fn().mockReturnValue(
        throwError(() => ({
          error: { error: { reason: 'user_email_taken' } },
        })),
      ),
    });
    const page = internal(component);
    page.openCreate();

    page.submitCreate();

    expect(page.createError()).toBe('Email sudah dipakai user lain.');
  });
});

describe('UsersPage page composition (spec docs/specs/0007-user-management, AC-12)', () => {
  it('composes the shared stacked page slots and keeps dialogs inside content', () => {
    const { fixture } = createPage({
      users: vi.fn().mockReturnValue(of(emptyResponse({ data: [testUser()] }))),
    });
    const root = fixture.nativeElement.querySelector('page') as HTMLElement;
    const content = root.querySelector('pagecontent') as HTMLElement;

    expect(root).not.toBeNull();
    expect(root.getAttribute('data-page-variant')).toBe('stacked');
    expect(root.getAttribute('data-page-scroll')).toBe('content');
    const header = root.querySelector('pageheader') as HTMLElement;
    const filter = root.querySelector('pagefilter') as HTMLElement;
    const footer = root.querySelector('pagefooter') as HTMLElement;
    const filterToggle = root.querySelector(
      '[data-page-control="filter-toggle"] button',
    ) as HTMLButtonElement;
    const headerAction = header.querySelector(
      'button[button]',
    ) as HTMLButtonElement;

    expect(root.querySelectorAll('pageheader')).toHaveLength(1);
    expect(header.className).toContain('min-h-(--layout-topbar-height)');
    expect(headerAction.getAttribute('data-size')).toBe('xs');
    expect(root.querySelectorAll('pagefilter')).toHaveLength(1);
    expect(filter.getAttribute('data-page-filter-open')).toBe('false');
    expect(filterToggle).not.toBeNull();
    expect(filterToggle.getAttribute('aria-expanded')).toBe('false');
    expect(filter.className).toContain('hidden');
    expect(filter.hasAttribute('hidden')).toBe(true);
    expect(root.querySelectorAll('pagecontent')).toHaveLength(1);
    expect(content.classList.contains('p-6')).toBe(false);
    expect(content.querySelector('thead[tableheader]')).not.toBeNull();
    expect(content.querySelector('tbody[tablebody]')).not.toBeNull();
    expect(content.querySelector('caption[tablecaption]')).not.toBeNull();
    expect(content.querySelector('table')?.classList.contains('border')).toBe(
      false,
    );
    expect(root.querySelectorAll('pagefooter')).toHaveLength(1);
    expect(footer.className).toContain('min-h-(--layout-topbar-height)');
    expect(root.querySelector('pagecontent app-reason-dialog')).not.toBeNull();
    expect(root.querySelector('pagecontent dialog')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('main')).toBeNull();

    filterToggle.click();
    fixture.detectChanges();

    expect(filter.getAttribute('data-page-filter-open')).toBe('true');
    expect(filter.className).not.toContain('hidden');
    expect(filterToggle.getAttribute('aria-expanded')).toBe('true');
    expect(filter.hasAttribute('hidden')).toBe(false);

    filterToggle.click();
    fixture.detectChanges();

    expect(filter.getAttribute('data-page-filter-open')).toBe('false');
    expect(filter.className).toContain('hidden');
    expect(filter.hasAttribute('hidden')).toBe(true);
    expect(filterToggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('UsersPage edit and status actions (spec docs/specs/0007-user-management, AC-3, AC-4, AC-6)', () => {
  it('submits only the changed fields and reloads the current page on success', () => {
    // The fake server echoes back whatever page it was asked for, the same
    // way the real one does, so meta().page actually advances to 2.
    const { api, component } = createPage({
      users: vi.fn((query: { page: number }) =>
        of(
          emptyResponse({
            meta: { page: query.page, perPage: 25, total: 0, totalPages: 1 },
          }),
        ),
      ),
    });
    const page = internal(component);
    page.goTo(2);
    api.users.mockClear();
    page.openEdit(testUser({ id: 'user-1' }));

    page.submitEdit({ name: 'Renamed' });

    expect(api.updateUser).toHaveBeenCalledWith('user-1', { name: 'Renamed' });
    expect(page.editOpen()).toBe(false);
    expect(api.users).toHaveBeenCalledWith({ search: '', status: '', page: 2 });
  });

  it('keeps the edit dialog open and shows the server message on failure', () => {
    const { component } = createPage({
      updateUser: vi.fn().mockReturnValue(
        throwError(() => ({
          error: { error: { reason: 'last_active_admin' } },
        })),
      ),
    });
    const page = internal(component);
    page.openEdit(testUser());

    page.submitEdit({ name: 'Renamed' });

    expect(page.editOpen()).toBe(true);
    expect(page.editError()).toBe(
      'Admin aktif terakhir tidak bisa dinonaktifkan atau diturunkan.',
    );
  });

  it('runs a status action with the pending reason and reloads on success', () => {
    const { api, component } = createPage();
    const page = internal(component);
    const target = testUser({ id: 'user-9' });
    page.askFor(target, { action: 'suspend' });

    page.runAction('policy violation');

    expect(api.runUserStatusAction).toHaveBeenCalledWith(
      'user-9',
      'suspend',
      'policy violation',
    );
    expect(page.actionOpen()).toBe(false);
  });

  it('surfaces the self action guard message and keeps the dialog open on failure (AC-6)', () => {
    const { component } = createPage({
      runUserStatusAction: vi
        .fn()
        .mockReturnValue(
          throwError(() => ({ error: { error: { reason: 'self_action' } } })),
        ),
    });
    const page = internal(component);
    page.askFor(testUser(), { action: 'suspend' });

    page.runAction('trying to suspend myself');

    expect(page.actionOpen()).toBe(true);
    expect(page.actionError()).toBe(
      'Kamu tidak bisa mengubah status akunmu sendiri.',
    );
  });

  it("derives callerId from the signed in user, used to hide actions on the caller's own row", () => {
    const { component } = createPage(undefined, {
      id: 'admin-9',
      name: 'Admin Nine',
      email: 'admin9@project.local',
      permissions: ['user:user:manage'],
    });

    expect(internal(component).callerId()).toBe('admin-9');
  });

  it('callerId is null when no one is signed in', () => {
    const { component } = createPage(undefined, null);

    expect(internal(component).callerId()).toBeNull();
  });
});
