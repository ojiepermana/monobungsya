import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiService } from './api.service';

describe('ApiService reliable jobs and notifications', () => {
  let http: HttpTestingController;
  let service: ApiService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ApiService);
  });

  afterEach(() => http.verify());

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
});
