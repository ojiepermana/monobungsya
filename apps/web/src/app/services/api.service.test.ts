import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiService } from './api.service';

function setup(): { service: ApiService; httpMock: HttpTestingController } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  return {
    service: TestBed.inject(ApiService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('ApiService (spec docs/specs/0007-user-management)', () => {
  let httpMock: HttpTestingController;

  afterEach(() => {
    httpMock.verify();
  });

  it('requests the users list with search, status, and page as query params', () => {
    const built = setup();
    httpMock = built.httpMock;

    built.service
      .users({ search: 'jane', status: 'active', page: 2 })
      .subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/users'),
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('search')).toBe('jane');
    expect(request.request.params.get('status')).toBe('active');
    expect(request.request.params.get('page')).toBe('2');
    request.flush({
      data: [],
      meta: { page: 2, perPage: 25, total: 0, totalPages: 0 },
      filters: { search: 'jane', status: 'active' },
      options: { statuses: [] },
    });
  });

  it('reads one user, url encoding the id', () => {
    const built = setup();
    httpMock = built.httpMock;

    built.service.user('id with spaces').subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/users/id%20with%20spaces'),
    );
    expect(request.request.method).toBe('GET');
    request.flush({});
  });

  it('creates a user with the full payload as the POST body', () => {
    const built = setup();
    httpMock = built.httpMock;
    const payload = {
      id: 'uuid-v7',
      name: 'New User',
      email: 'new@project.local',
    };

    built.service.createUser(payload).subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/users'),
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({});
  });

  it('updates a user, PATCHing only the fields the caller supplies', () => {
    const built = setup();
    httpMock = built.httpMock;

    built.service.updateUser('user-1', { name: 'Renamed' }).subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/users/user-1'),
    );
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Renamed' });
    request.flush({});
  });

  it('runs a non delete status action as a POST with the reason in the body', () => {
    const built = setup();
    httpMock = built.httpMock;

    built.service
      .runUserStatusAction('user-1', 'suspend', 'policy violation')
      .subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/users/user-1/suspend'),
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reason: 'policy violation' });
    request.flush({});
  });

  it('runs delete as an HTTP DELETE that still carries the reason in the body', () => {
    const built = setup();
    httpMock = built.httpMock;

    built.service
      .runUserStatusAction('user-1', 'delete', 'retiring the account')
      .subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/users/user-1'),
    );
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ reason: 'retiring the account' });
    request.flush({});
  });

  it('omits actorUserId from the audit trail request when it is not given (AC-10)', () => {
    const built = setup();
    httpMock = built.httpMock;

    built.service
      .auditTrails({ search: '', module: '', action: '', page: 1 })
      .subscribe();

    const request = httpMock.expectOne((req) =>
      req.url.endsWith('/api/v1/logs/audit-trails'),
    );
    expect(request.request.params.has('actorUserId')).toBe(false);
    request.flush({});
  });

  it('sends actorUserId on all three log endpoints when given, narrowing to one user (AC-10)', () => {
    const built = setup();
    httpMock = built.httpMock;
    const actorUserId = '0198f8a0-0000-7000-8000-0000000000aa';

    built.service
      .auditTrails({ search: '', module: '', action: '', page: 1, actorUserId })
      .subscribe();
    built.service
      .accessLogs({
        search: '',
        event: '',
        outcome: '',
        traceId: '',
        page: 1,
        actorUserId,
      })
      .subscribe();
    built.service
      .applicationLogs({
        search: '',
        level: '',
        module: '',
        event: '',
        page: 1,
        actorUserId,
      })
      .subscribe();

    const requests = [
      httpMock.expectOne((req) =>
        req.url.endsWith('/api/v1/logs/audit-trails'),
      ),
      httpMock.expectOne((req) => req.url.endsWith('/api/v1/logs/access-logs')),
      httpMock.expectOne((req) =>
        req.url.endsWith('/api/v1/logs/application-logs'),
      ),
    ];

    for (const request of requests) {
      expect(request.request.params.get('actorUserId')).toBe(actorUserId);
      request.flush({});
    }
  });
});
