import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiService,
  type NotificationPreferencesResponse,
  type NotificationRecord,
  type NotificationsResponse,
} from '../../services/api.service';
import { NotificationsPage } from './notifications.page';

const notification: NotificationRecord = {
  id: '0198f8a0-0000-7000-8000-000000000001',
  category: 'security',
  severity: 'info',
  type: 'security.sign_in',
  title: 'Aktivitas keamanan baru',
  body: 'Login berhasil.',
  metadata: { authMethod: 'passkey' },
  actionRoute: null,
  readAt: null,
  createdAt: '2026-08-25T00:00:00.000Z',
};

const preferences: NotificationPreferencesResponse = {
  categories: [
    {
      category: 'security',
      channels: [
        {
          category: 'security',
          channel: 'in_app',
          enabled: true,
          mandatory: true,
        },
        {
          category: 'security',
          channel: 'email',
          enabled: true,
          mandatory: false,
        },
      ],
    },
  ],
};

function createPage(options: { failLoad?: boolean } = {}) {
  const response: NotificationsResponse = {
    data: [notification],
    meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
    filters: { page: 1, category: '', unreadOnly: false },
    options: { categories: ['security', 'access', 'account', 'operational'] },
  };
  const api = {
    notifications: vi
      .fn()
      .mockReturnValue(
        options.failLoad
          ? throwError(() => new Error('notification service unavailable'))
          : of(response),
      ),
    markNotificationRead: vi
      .fn()
      .mockReturnValue(
        of({ ...notification, readAt: '2026-08-25T00:01:00.000Z' }),
      ),
    markAllNotificationsRead: vi.fn().mockReturnValue(of({ changed: 1 })),
    notificationPreferences: vi.fn().mockReturnValue(of(preferences)),
    updateNotificationPreference: vi
      .fn()
      .mockReturnValue(of(preferences.categories[0]?.channels[1])),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
    ],
  });
  const fixture = TestBed.createComponent(NotificationsPage);
  fixture.detectChanges();
  return { fixture, api, component: fixture.componentInstance };
}

interface NotificationsPageInternals {
  preferencesOpen(): boolean;
  rows(): NotificationRecord[];
  openPreferences(): void;
  markRead(notification: NotificationRecord): void;
  markAllRead(): void;
}

function internal(component: NotificationsPage): NotificationsPageInternals {
  return component as unknown as NotificationsPageInternals;
}

describe('NotificationsPage (AC-4, AC-5, AC-7)', () => {
  it('renders unread notifications and marks an item read', () => {
    const { fixture, api, component } = createPage();
    const page = internal(component);
    const root = fixture.nativeElement as HTMLElement;

    expect(page.rows()).toEqual([notification]);
    expect(root.textContent).toContain('Aktivitas keamanan baru');
    expect(root.textContent).toContain('Login berhasil.');
    page.markRead(notification);
    expect(api.markNotificationRead).toHaveBeenCalledWith(notification.id);
  });

  it('loads preferences and sends the read-all action', () => {
    const { api, component } = createPage();
    const page = internal(component);

    page.openPreferences();
    expect(page.preferencesOpen()).toBe(true);
    expect(api.notificationPreferences).toHaveBeenCalledTimes(1);
    page.markAllRead();
    expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it('shows a recoverable load error', () => {
    const { fixture } = createPage({ failLoad: true });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Notifikasi tidak dapat dimuat',
    );
  });
});
