import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  type AccessLogsResponse,
  ApiService,
  type ApplicationLogsResponse,
} from '../../services/api.service';
import { AccessLogsPage } from './access/access-logs.page';
import { ApplicationLogsPage } from './application/application-logs.page';

const from = '2026-08-25T00:00:00.000Z';
const to = '2026-08-25T01:00:00.000Z';
const BLIND_SPOT_SINCE = '2026-08-24T23:30:00.000Z';

function accessSignalResponse(
  storageStatus: 'available' | 'blind_spot' = 'blind_spot',
): AccessLogsResponse {
  return {
    data: [],
    prevCursor: null,
    nextCursor: 'access-next',
    filters: { search: '', event: '', outcome: '', traceId: '' },
    options: { events: [], outcomes: [] },
    storageStatus,
    blindSpotSince: storageStatus === 'blind_spot' ? BLIND_SPOT_SINCE : null,
  };
}

function accessLegacyResponse(): AccessLogsResponse {
  return {
    data: [],
    meta: { page: 2, perPage: 25, total: 60, totalPages: 3 },
    filters: { search: 'legacy', event: '', outcome: '', traceId: '' },
    options: { events: [], outcomes: [] },
  };
}

function applicationSignalResponse(
  storageStatus: 'available' | 'blind_spot' = 'blind_spot',
): ApplicationLogsResponse {
  return {
    data: [],
    prevCursor: null,
    nextCursor: 'application-next',
    filters: { search: '', level: '', module: '', event: '' },
    options: { levels: [], modules: [], events: [] },
    storageStatus,
    blindSpotSince: storageStatus === 'blind_spot' ? BLIND_SPOT_SINCE : null,
  };
}

function applicationLegacyResponse(): ApplicationLogsResponse {
  return {
    data: [],
    meta: { page: 2, perPage: 25, total: 60, totalPages: 3 },
    filters: { search: 'legacy', level: '', module: '', event: '' },
    options: { levels: [], modules: [], events: [] },
  };
}

function setup(query: Record<string, string>, api: object) {
  const router = {
    events: EMPTY,
    navigate: vi.fn().mockResolvedValue(true),
    url: '/',
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
      { provide: Router, useValue: router },
      { provide: ApiService, useValue: api },
    ],
  });
  return router;
}

interface CursorPageInternals {
  cursorPagination(): boolean;
  pageLabel(): string;
  goToCursor(cursor: string | null): void;
}

function accessInternal(component: AccessLogsPage): CursorPageInternals {
  return component as unknown as CursorPageInternals;
}

function applicationInternal(
  component: ApplicationLogsPage,
): CursorPageInternals {
  return component as unknown as CursorPageInternals;
}

describe('access and application signal log pagination', () => {
  it('keeps access-log cursor filters in the URL and renders its blind spot without offset controls', () => {
    const response = accessSignalResponse();
    const api = {
      accessLogs: vi.fn().mockReturnValue(of(response)),
    };
    const router = setup(
      {
        from,
        to,
        preset: 'custom',
        search: 'sign in',
        event: 'login',
        outcome: 'success',
        traceId: 'trace-1',
        cursor: 'access-current',
      },
      api,
    );
    const fixture = TestBed.createComponent(AccessLogsPage);
    fixture.detectChanges();
    const page = accessInternal(fixture.componentInstance);

    expect(api.accessLogs).toHaveBeenCalledWith({
      search: 'sign in',
      event: 'login',
      outcome: 'success',
      traceId: 'trace-1',
      page: 1,
      from,
      to,
      cursor: 'access-current',
    });
    expect(page.cursorPagination()).toBe(true);
    expect(page.pageLabel()).toBe('0 baris di halaman ini');
    const content = fixture.nativeElement as HTMLElement;
    expect(content.textContent).toContain('blind spot');
    expect(content.textContent).toContain('hingga sekarang');
    expect(content.querySelector('time')?.getAttribute('datetime')).toBe(
      BLIND_SPOT_SINCE,
    );
    expect(content.textContent).not.toContain('First');
    expect(content.textContent).not.toContain('Last');

    page.goToCursor('access-next');

    expect(api.accessLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'access-next', from, to }),
    );
    expect(router.navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({
          cursor: 'access-next',
          from,
          to,
        }),
      }),
    );
  });

  it('keeps access-log offset pagination for a legacy response', () => {
    const response = accessLegacyResponse();
    const api = { accessLogs: vi.fn().mockReturnValue(of(response)) };
    setup({ search: 'legacy', page: '2' }, api);
    const fixture = TestBed.createComponent(AccessLogsPage);
    fixture.detectChanges();
    const page = accessInternal(fixture.componentInstance);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(page.cursorPagination()).toBe(false);
    expect(text).toContain('Page 2 of 3 · 60 records');
    expect(
      fixture.nativeElement.querySelector('button[aria-label="First page"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Last page"]'),
    ).not.toBeNull();
  });

  it('keeps application-log cursor filters in the URL and renders its blind spot without offset controls', () => {
    const response = applicationSignalResponse();
    const api = {
      applicationLogs: vi.fn().mockReturnValue(of(response)),
    };
    const router = setup(
      {
        from,
        to,
        preset: 'custom',
        search: 'failed',
        level: 'error',
        module: 'jobs',
        event: 'job.failed',
        cursor: 'application-current',
      },
      api,
    );
    const fixture = TestBed.createComponent(ApplicationLogsPage);
    fixture.detectChanges();
    const page = applicationInternal(fixture.componentInstance);

    expect(api.applicationLogs).toHaveBeenCalledWith({
      search: 'failed',
      level: 'error',
      module: 'jobs',
      event: 'job.failed',
      page: 1,
      from,
      to,
      cursor: 'application-current',
    });
    expect(page.cursorPagination()).toBe(true);
    expect(page.pageLabel()).toBe('0 baris di halaman ini');
    const content = fixture.nativeElement as HTMLElement;
    expect(content.textContent).toContain('blind spot');
    expect(content.textContent).toContain('hingga sekarang');
    expect(content.querySelector('time')?.getAttribute('datetime')).toBe(
      BLIND_SPOT_SINCE,
    );
    expect(content.textContent).not.toContain('First');
    expect(content.textContent).not.toContain('Last');

    page.goToCursor('application-next');

    expect(api.applicationLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'application-next', from, to }),
    );
    expect(router.navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({
          cursor: 'application-next',
          from,
          to,
        }),
      }),
    );
  });

  it('keeps application-log offset pagination for a legacy response', () => {
    const response = applicationLegacyResponse();
    const api = { applicationLogs: vi.fn().mockReturnValue(of(response)) };
    setup({ search: 'legacy', page: '2' }, api);
    const fixture = TestBed.createComponent(ApplicationLogsPage);
    fixture.detectChanges();
    const page = applicationInternal(fixture.componentInstance);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(page.cursorPagination()).toBe(false);
    expect(text).toContain('Page 2 of 3 · 60 records');
    expect(
      fixture.nativeElement.querySelector('button[aria-label="First page"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Last page"]'),
    ).not.toBeNull();
  });
});
