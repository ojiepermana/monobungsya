import { type AppEnvironment, loadEnv } from '#project/config';

export interface JobsEnvironment extends AppEnvironment {
  JOBS_SERVICE_PORT: number;
  JOBS_DATABASE_URL: string;
  JOB_WORKER_CONCURRENCY: number;
  JOB_LEASE_MS: number;
  JOB_HEARTBEAT_MS: number;
  JOB_POLL_INTERVAL_MS: number;
  JOB_SHUTDOWN_TIMEOUT_MS: number;
  JOB_RETENTION_DAYS: number;
  JOB_CLEANUP_INTERVAL_MS: number;
  JOB_SCHEDULE_INTERVAL_MS: number;
  JOB_SCHEDULE_CATCH_UP_LIMIT: number;
}

export function loadJobsEnv(
  source: Record<string, string | undefined> = Bun.env,
): JobsEnvironment {
  const jobsDatabaseUrl = source.JOBS_DATABASE_URL ?? source.DATABASE_URL;
  const environment = loadEnv('jobs', {
    ...source,
    PORT: source.JOBS_SERVICE_PORT ?? '3105',
    ...(jobsDatabaseUrl ? { DATABASE_URL: jobsDatabaseUrl } : {}),
  });

  return {
    ...environment,
    JOBS_SERVICE_PORT: positive(
      source.JOBS_SERVICE_PORT,
      3105,
      'JOBS_SERVICE_PORT',
    ),
    JOBS_DATABASE_URL: jobsDatabaseUrl ?? environment.DATABASE_URL,
    JOB_WORKER_CONCURRENCY: positive(
      source.JOB_WORKER_CONCURRENCY,
      5,
      'JOB_WORKER_CONCURRENCY',
    ),
    JOB_LEASE_MS: positive(source.JOB_LEASE_MS, 60_000, 'JOB_LEASE_MS'),
    JOB_HEARTBEAT_MS: positive(
      source.JOB_HEARTBEAT_MS,
      20_000,
      'JOB_HEARTBEAT_MS',
    ),
    JOB_POLL_INTERVAL_MS: positive(
      source.JOB_POLL_INTERVAL_MS,
      5_000,
      'JOB_POLL_INTERVAL_MS',
    ),
    JOB_SHUTDOWN_TIMEOUT_MS: positive(
      source.JOB_SHUTDOWN_TIMEOUT_MS,
      30_000,
      'JOB_SHUTDOWN_TIMEOUT_MS',
    ),
    JOB_RETENTION_DAYS: positive(
      source.JOB_RETENTION_DAYS,
      90,
      'JOB_RETENTION_DAYS',
    ),
    JOB_CLEANUP_INTERVAL_MS: positive(
      source.JOB_CLEANUP_INTERVAL_MS,
      24 * 60 * 60 * 1000,
      'JOB_CLEANUP_INTERVAL_MS',
    ),
    JOB_SCHEDULE_INTERVAL_MS: positive(
      source.JOB_SCHEDULE_INTERVAL_MS,
      5_000,
      'JOB_SCHEDULE_INTERVAL_MS',
    ),
    JOB_SCHEDULE_CATCH_UP_LIMIT: positive(
      source.JOB_SCHEDULE_CATCH_UP_LIMIT,
      100,
      'JOB_SCHEDULE_CATCH_UP_LIMIT',
    ),
  };
}

function positive(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const env = loadJobsEnv();
