import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureGeneratedClient } from '../../api/generated-client';
import { ApiService } from './api.service';

describe('ApiService reliable jobs and notifications', () => {
  let http: HttpTestingController;
  let service: ApiService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    configureGeneratedClient('https://gateway.example.test', () => null);
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ApiService);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('AC-4 sends notification filters and exposes the list response', () => {
    service
      .notifications({ page: 2, category: 'security', unreadOnly: true })
      .subscribe();
    const request = http.expectOne(
      '/api/v1/notifications?page=2&category=security&unreadOnly=true',
    );

    expect(request.request.method).toBe('GET');
    request.flush({ data: [], meta: {}, filters: {}, options: {} });
  });

  it('AC-5 targets notification read actions and preference updates', () => {
    service.markNotificationRead('notification-1').subscribe();
    const readRequest = http.expectOne(
      '/api/v1/notifications/notification-1/read',
    );
    expect(readRequest.request.method).toBe('PATCH');
    readRequest.flush({});

    service
      .updateNotificationPreference('security', 'email', false)
      .subscribe();
    const preferenceRequest = http.expectOne(
      '/api/v1/notifications/preferences/security/email',
    );
    expect(preferenceRequest.request.method).toBe('PATCH');
    expect(preferenceRequest.request.body).toEqual({ enabled: false });
    preferenceRequest.flush({});
  });

  it('omits an empty jobs status so the all-statuses query passes validation', () => {
    service.jobs({ page: 1, status: '' }).subscribe();
    const request = http.expectOne('/api/v1/jobs?page=1');

    expect(request.request.method).toBe('GET');
    request.flush({});
  });

  it('AC-12 sends a retry reason and a fresh idempotency key', () => {
    service.retryJob('job-1', 'Retry from test').subscribe();
    const request = http.expectOne('/api/v1/jobs/job-1/retry');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reason: 'Retry from test' });
    expect(request.request.headers.get('Idempotency-Key')).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    request.flush({});
  });

  it('AC-16 serializes group list filters through the generated SDK', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [], meta: {}, filters: {} }),
    );
    await firstValueFrom(
      service.groups({
        search: 'Operators',
        status: 'active',
        deleted: 'include',
        appliable: true,
        page: 2,
        pageSize: 50,
      }),
    );
    const request = fetchMock.mock.calls[0]?.[0] as Request;

    expect(request.method).toBe('GET');
    expect(request.url).toBe(
      'https://gateway.example.test/api/v1/access/groups?search=Operators&status=active&deleted=include&appliable=true&page=2&pageSize=50',
    );
  });

  it('AC-16 maps group lifecycle and attachment methods to their generated routes', async () => {
    const groupResponse = {
      id: 'group-1',
      name: 'Operators',
      status: 'active',
      description: 'Users',
      permissionCount: 1,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      deletedAt: null,
    };
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json(groupResponse)),
    );

    await firstValueFrom(
      service.createGroup({ name: 'Operators', description: 'Users' }),
    );
    const create = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(create.method).toBe('POST');
    expect(await create.json()).toEqual({
      name: 'Operators',
      description: 'Users',
    });

    fetchMock.mockClear();
    await firstValueFrom(service.updateGroup('group-1', { status: 'off' }));
    const update = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(update.method).toBe('PUT');
    expect(update.url).toBe(
      'https://gateway.example.test/api/v1/access/groups/group-1',
    );
    expect(await update.json()).toEqual({ status: 'off' });

    fetchMock.mockClear();
    await firstValueFrom(service.restoreGroup('group-1'));
    const restore = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(restore.method).toBe('POST');
    expect(restore.url).toBe(
      'https://gateway.example.test/api/v1/access/groups/group-1/restore',
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(Response.json([]));
    await firstValueFrom(service.groupPermissions('group-1'));
    const listPermissions = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(listPermissions.method).toBe('GET');
    expect(listPermissions.url).toBe(
      'https://gateway.example.test/api/v1/access/groups/group-1/permissions',
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      Response.json({ attached: ['permission-1'], skipped: [] }),
    );
    await firstValueFrom(
      service.attachGroupPermissions('group-1', ['permission-1']),
    );
    const attach = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(attach.method).toBe('POST');
    expect(attach.url).toBe(
      'https://gateway.example.test/api/v1/access/groups/group-1/permissions',
    );
    expect(await attach.json()).toEqual({ permissionIds: ['permission-1'] });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await firstValueFrom(
      service.detachGroupPermission('group-1', 'permission-1'),
    );
    const detach = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(detach.method).toBe('DELETE');
    expect(detach.url).toBe(
      'https://gateway.example.test/api/v1/access/groups/group-1/permissions/permission-1',
    );
  });

  it('AC-16 sends both single and bulk group apply requests with their result shapes', async () => {
    fetchMock.mockResolvedValue(Response.json({ applied: [], failed: [] }));
    await firstValueFrom(
      service.applyGroupToUsers('group-1', ['user-1', 'user-2']),
    );
    const bulk = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(bulk.method).toBe('POST');
    expect(bulk.url).toBe(
      'https://gateway.example.test/api/v1/access/groups/group-1/apply',
    );
    expect(await bulk.json()).toEqual({ userIds: ['user-1', 'user-2'] });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      Response.json({ granted: ['permission-1'], skipped: [] }),
    );
    await firstValueFrom(service.applyGroupToUser('user-1', 'group-1'));
    const single = fetchMock.mock.calls.at(0)?.[0] as Request;
    expect(single.method).toBe('POST');
    expect(single.url).toBe(
      'https://gateway.example.test/api/v1/access/users/user-1/permissions/apply-group',
    );
    expect(await single.json()).toEqual({ groupId: 'group-1' });
  });
});
