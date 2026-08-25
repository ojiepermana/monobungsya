import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiService,
  type JobRecord,
  type JobsResponse,
} from '../../../services/api.service';
import { JobsPage } from './jobs.page';

const job: JobRecord = {
  id: '0198f8a0-0000-7000-8000-000000000001',
  type: 'auth.cleanup',
  version: 1,
  sourceService: 'jobs',
  targetService: 'auth',
  status: 'retry_wait',
  priority: 0,
  runAt: '2026-08-25T00:00:00.000Z',
  attemptCount: 2,
  maxAttempts: 5,
  lockedBy: null,
  lockedAt: null,
  leaseExpiresAt: null,
  completedAt: null,
  failedAt: null,
  lastErrorCode: 'provider_error',
  lastErrorMessage: 'temporary failure',
  scheduleCode: null,
  retryOfJobId: null,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

function createPage(fail = false) {
  const response: JobsResponse = {
    data: [job],
    meta: { page: 1, perPage: 25, total: 1, totalPages: 1 },
    filters: {
      page: 1,
      status: '',
      type: '',
      sourceService: '',
      targetService: '',
      from: '',
      to: '',
    },
    options: {
      statuses: ['queued', 'running', 'retry_wait', 'completed', 'failed'],
      types: ['auth.cleanup'],
      sourceServices: ['jobs'],
      targetServices: ['auth'],
    },
  };
  const api = {
    jobs: vi
      .fn()
      .mockReturnValue(
        fail ? throwError(() => new Error('jobs unavailable')) : of(response),
      ),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ApiService, useValue: api },
    ],
  });
  return { fixture: TestBed.createComponent(JobsPage), api };
}

describe('JobsPage (AC-11, AC-12, AC-13)', () => {
  it('renders job status, target, attempts, and detail links', () => {
    const { fixture, api } = createPage();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(api.jobs).toHaveBeenCalledWith({ page: 1, status: '' });
    expect(root.textContent).toContain('auth.cleanup @1');
    expect(root.textContent).toContain('retry_wait');
    expect(root.textContent).toContain('2 / 5');
  });

  it('renders a recoverable load error', () => {
    const { fixture } = createPage(true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Jobs tidak dapat dimuat',
    );
  });
});
