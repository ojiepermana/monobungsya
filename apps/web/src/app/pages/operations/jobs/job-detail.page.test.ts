import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService, type JobDetail } from '../../../services/api.service';
import { JobDetailPage } from './job-detail.page';

const detail: JobDetail = {
  id: '0198f8a0-0000-7000-8000-000000000001',
  type: 'auth.cleanup',
  version: 1,
  sourceService: 'jobs',
  targetService: 'auth',
  status: 'failed',
  priority: 0,
  runAt: '2026-08-25T00:00:00.000Z',
  attemptCount: 5,
  maxAttempts: 5,
  lockedBy: null,
  lockedAt: null,
  leaseExpiresAt: null,
  completedAt: null,
  failedAt: '2026-08-25T00:01:00.000Z',
  lastErrorCode: 'handler_error',
  lastErrorMessage: 'job handler failed',
  scheduleCode: null,
  retryOfJobId: null,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:01:00.000Z',
  payload: { userId: '0198f8a0-0000-7000-8000-000000000002' },
  attempts: [
    {
      id: 'attempt-1',
      attemptNumber: 5,
      workerId: 'auth-worker-1',
      startedAt: '2026-08-25T00:01:00.000Z',
      finishedAt: '2026-08-25T00:01:01.000Z',
      outcome: 'failed',
      durationMs: 1000,
      errorCode: 'handler_error',
      errorMessage: 'job handler failed',
    },
  ],
};

function createPage(options: { missingId?: boolean; fail?: boolean } = {}) {
  const api = {
    job: vi
      .fn()
      .mockReturnValue(
        options.fail
          ? throwError(() => new Error('job unavailable'))
          : of(detail),
      ),
    retryJob: vi.fn().mockReturnValue(of({ ...detail, status: 'queued' })),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: { get: () => (options.missingId ? null : detail.id) },
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(JobDetailPage);
  fixture.detectChanges();
  return { fixture, api, component: fixture.componentInstance };
}

interface JobDetailInternals {
  retry(): void;
}

describe('JobDetailPage (AC-12, AC-13)', () => {
  it('renders safe payload and attempt history and retries failed jobs', () => {
    const { fixture, api, component } = createPage();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Payload aman');
    expect(root.textContent).toContain('auth-worker-1');
    (component as unknown as JobDetailInternals).retry();
    expect(api.retryJob).toHaveBeenCalledWith(
      detail.id,
      'Retry manual dari operator',
    );
  });

  it('reports missing route IDs without calling the API', () => {
    const { fixture, api } = createPage({ missingId: true });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Job tidak ditemukan',
    );
    expect(api.job).not.toHaveBeenCalled();
  });
});
