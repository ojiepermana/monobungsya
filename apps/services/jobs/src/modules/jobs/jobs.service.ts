import type { DatabaseClient } from '#project/database';
import { ConflictError, NotFoundError } from '#project/errors';
import type { JobRegistry } from '#project/jobs';
import { isoFromDbTimestamp } from '#project/logger';

export const JOB_STATUSES = [
  'queued',
  'running',
  'retry_wait',
  'completed',
  'failed',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobListQuery {
  page?: string;
  status?: string;
  type?: string;
  sourceService?: string;
  targetService?: string;
  from?: string;
  to?: string;
}

export class JobsService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly registry: JobRegistry,
  ) {}

  async list(query: JobListQuery) {
    const page = positivePage(query.page);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      if (!JOB_STATUSES.includes(query.status as JobStatus)) {
        throw new Error(`unsupported job status: ${query.status}`);
      }
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }
    addFilter(conditions, params, 'type', '=', query.type);
    addFilter(conditions, params, 'source_service', '=', query.sourceService);
    addFilter(conditions, params, 'target_service', '=', query.targetService);
    addFilter(conditions, params, 'created_at', '>=', query.from);
    addFilter(conditions, params, 'created_at', '<=', query.to);

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRows = (await this.database.unsafe(
      `SELECT count(*)::integer AS total FROM "jobs"."job" ${where}`,
      params as never[],
    )) as Array<{ total: number }>;
    const rows = (await this.database.unsafe(
      `SELECT ${SAFE_JOB_COLUMNS} FROM "jobs"."job" ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, 25, (page - 1) * 25] as never[],
    )) as Array<Record<string, unknown>>;
    const [typeRows, sourceRows, targetRows] = await Promise.all([
      this.database`SELECT DISTINCT type FROM jobs.job ORDER BY type`,
      this
        .database`SELECT DISTINCT source_service FROM jobs.job ORDER BY source_service`,
      this
        .database`SELECT DISTINCT target_service FROM jobs.job ORDER BY target_service`,
    ]);

    return {
      data: rows.map(mapSafeJob),
      meta: {
        page,
        perPage: 25,
        total: Number(countRows[0]?.total ?? 0),
        totalPages: Math.ceil(Number(countRows[0]?.total ?? 0) / 25),
      },
      filters: {
        page,
        status: query.status ?? '',
        type: query.type ?? '',
        sourceService: query.sourceService ?? '',
        targetService: query.targetService ?? '',
        from: query.from ?? '',
        to: query.to ?? '',
      },
      options: {
        statuses: [...JOB_STATUSES],
        types: typeRows.map((row: Record<string, unknown>) => String(row.type)),
        sourceServices: sourceRows.map((row: Record<string, unknown>) =>
          String(row.source_service),
        ),
        targetServices: targetRows.map((row: Record<string, unknown>) =>
          String(row.target_service),
        ),
      },
    };
  }

  async detail(id: string) {
    const rows = (await this.database.unsafe(
      `SELECT ${SAFE_JOB_COLUMNS}, payload FROM "jobs"."job" WHERE id = $1`,
      [id] as never[],
    )) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) throw new NotFoundError('Job not found');

    const contract = this.registry.get(String(row.type), Number(row.version));
    const payload = contract
      ? this.registry.operatorPayload(
          String(row.type),
          Number(row.version),
          (row.payload ?? {}) as Record<string, unknown>,
        )
      : {};
    const attempts = (await this.database.unsafe(
      `SELECT id, attempt_number, worker_id, started_at::text AS started_at,
              finished_at::text AS finished_at, outcome,
              duration_ms, error_code, error_message
       FROM "jobs"."job_attempt"
       WHERE job_id = $1 ORDER BY attempt_number`,
      [id] as never[],
    )) as Array<Record<string, unknown>>;

    return {
      ...mapSafeJob(row),
      payload,
      attempts: attempts.map((attempt) => ({
        id: String(attempt.id),
        attemptNumber: Number(attempt.attempt_number),
        workerId: String(attempt.worker_id),
        startedAt: isoOrNull(attempt.started_at) ?? '',
        finishedAt: isoOrNull(attempt.finished_at),
        outcome: nullableText(attempt.outcome),
        durationMs:
          attempt.duration_ms === null || attempt.duration_ms === undefined
            ? null
            : Number(attempt.duration_ms),
        errorCode: nullableText(attempt.error_code),
        errorMessage: nullableText(attempt.error_message),
      })),
    };
  }

  async retry(
    id: string,
    idempotencyKey: string,
    reason: string,
    actorUserId: string,
  ) {
    if (!UUID_PATTERN.test(idempotencyKey)) {
      throw new Error('Idempotency-Key must be a UUID');
    }
    if (reason.trim().length < 3) {
      throw new Error('retry reason is required');
    }
    try {
      const rows = (await this.database`
        SELECT * FROM jobs.manual_retry_job(
          ${id}::uuid,
          ${idempotencyKey}::uuid,
          ${reason},
          ${actorUserId}::uuid
        )
      `) as Array<Record<string, unknown>>;
      return rows[0] ? mapSafeJob(rows[0]) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('job not found')) {
        throw new NotFoundError('Job not found');
      }
      if (message.includes('only failed jobs')) {
        throw new ConflictError('Only failed jobs can be retried');
      }
      throw error;
    }
  }

  async summary() {
    const [counts] = (await this.database`
      SELECT
        count(*) FILTER (WHERE status = 'queued')::integer AS queued,
        count(*) FILTER (WHERE status = 'running')::integer AS running,
        count(*) FILTER (WHERE status = 'retry_wait')::integer AS retrying,
        count(*) FILTER (WHERE status = 'completed')::integer AS completed,
        count(*) FILTER (WHERE status = 'failed')::integer AS failed,
        count(*) FILTER (
          WHERE status = 'running'
            AND lease_expires_at < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        )::integer AS expired_lease_count
      FROM jobs.job
    `) as Array<Record<string, unknown>>;
    const [oldest] = (await this.database`
      SELECT min(run_at)::text AS oldest_queued_at
      FROM jobs.job WHERE status IN ('queued', 'retry_wait')
    `) as Array<{ oldest_queued_at: string | null }>;
    const oldestQueuedAt = isoOrNull(oldest?.oldest_queued_at);
    return {
      queued: Number(counts?.queued ?? 0),
      running: Number(counts?.running ?? 0),
      retrying: Number(counts?.retrying ?? 0),
      completed: Number(counts?.completed ?? 0),
      failed: Number(counts?.failed ?? 0),
      expiredLeaseCount: Number(counts?.expired_lease_count ?? 0),
      oldestQueuedAt,
      oldestQueuedAgeSeconds: oldestQueuedAt
        ? Math.max(
            0,
            Math.floor((Date.now() - Date.parse(oldestQueuedAt)) / 1000),
          )
        : null,
    };
  }
}

const SAFE_JOB_COLUMNS = `
  id, type, version, source_service, target_service, status, priority,
  run_at::text AS run_at, attempt_count, max_attempts, locked_by, locked_at,
  lease_expires_at::text AS lease_expires_at, completed_at::text AS completed_at,
  failed_at::text AS failed_at, last_error_code, last_error_message,
  schedule_code, retry_of_job_id, created_at::text AS created_at,
  updated_at::text AS updated_at`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function addFilter(
  conditions: string[],
  params: unknown[],
  column: string,
  operator: '=' | '>=' | '<=',
  value: string | undefined,
): void {
  if (!value) return;
  params.push(value);
  conditions.push(`${column} ${operator} $${params.length}`);
}

function positivePage(value: string | undefined): number {
  const parsed = Number(value ?? '1');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function mapSafeJob(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    type: String(row.type),
    version: Number(row.version),
    sourceService: String(row.source_service),
    targetService: String(row.target_service),
    status: String(row.status),
    priority: Number(row.priority),
    runAt: isoOrNull(row.run_at) ?? '',
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    lockedBy: row.locked_by,
    lockedAt: isoOrNull(row.locked_at),
    leaseExpiresAt: isoOrNull(row.lease_expires_at),
    completedAt: isoOrNull(row.completed_at),
    failedAt: isoOrNull(row.failed_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    scheduleCode: row.schedule_code,
    retryOfJobId: row.retry_of_job_id,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
  };
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return isoFromDbTimestamp(String(value));
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
