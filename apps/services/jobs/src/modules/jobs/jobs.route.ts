import { Elysia } from 'elysia';
import { PERMISSIONS } from '#project/acl';
import type { AuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { ValidationError } from '#project/errors';
import type { JobRegistry } from '#project/jobs';
import { ActivityLog } from '#project/logger';
import { createAuthIdentityPlugin } from '../../shared/plugins/auth-identity.plugin';
import { jobIdParams, jobRetryBody, jobsListQuery } from './jobs.schema';
import { JobsService } from './jobs.service';

export function createJobsRoute(
  database: DatabaseClient,
  registry: JobRegistry,
  options: { signingSecret: string; clockSkewSeconds: number },
) {
  const service = new JobsService(database, registry);

  return new Elysia({ name: 'jobs-routes' })
    .use(
      createAuthIdentityPlugin(options.signingSecret, options.clockSkewSeconds),
    )
    .get(
      '/internal/jobs',
      ({ query, requirePermissions }) => {
        requirePermissions(PERMISSIONS.jobsJobList);
        return service.list(query);
      },
      {
        query: jobsListQuery,
      },
    )
    .get(
      '/internal/jobs/summary',
      ({ requirePermissions }) => {
        requirePermissions(PERMISSIONS.jobsJobRead);
        return service.summary();
      },
      {},
    )
    .get(
      '/internal/jobs/:id',
      ({ params, requirePermissions }) => {
        requirePermissions(PERMISSIONS.jobsJobRead);
        return service.detail(params.id);
      },
      { params: jobIdParams },
    )
    .post(
      '/internal/jobs/:id/retry',
      async ({ params, body, request, identity, requirePermissions }) => {
        requirePermissions(PERMISSIONS.jobsJobRetry);
        const idempotencyKey = request.headers.get('idempotency-key');
        if (!idempotencyKey) {
          throw new ValidationError('Idempotency-Key is required');
        }
        const result = await service.retry(
          params.id,
          idempotencyKey,
          body.reason,
          (identity as AuthIdentity).userId,
        );
        await ActivityLog.writeAudit({
          action: 'manual_retry',
          module: 'jobs',
          entityType: 'job',
          entityId: params.id,
          entityLabel: params.id,
          reason: body.reason,
          changeSummary: 'manually retried a failed job',
          metadata: {
            idempotencyKey,
            retryJobId: result?.id ?? null,
          },
          actor: {
            id: (identity as AuthIdentity).userId,
            email: (identity as AuthIdentity).email,
          },
          requestId: request.headers.get('x-request-id'),
          traceId: request.headers.get('x-correlation-id'),
          ipAddress: maskIp(request.headers.get('x-forwarded-for')),
        });
        return result;
      },
      {
        params: jobIdParams,
        body: jobRetryBody,
      },
    );
}

function maskIp(value: string | null): string | null {
  const ip = value?.split(',')[0]?.trim();
  if (!ip) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 4).join(':')}::`;
  return null;
}
