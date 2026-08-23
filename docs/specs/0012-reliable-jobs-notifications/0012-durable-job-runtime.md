# 0012. Durable job runtime

**Date**: 2026-08-23

**Status**: Proposed

**Parent**: [Reliable background jobs and notification center](./index.md)

## Responsibility

Provide a reusable PostgreSQL backed runtime for declared durable jobs, code registered schedules, bounded retries, lease recovery, and operator visibility. This child spec owns the `jobs` schema, `jobs` service, and `#project/jobs` package.

## Job registry

Every job type must register these values before enqueue is accepted:

1. Stable type and integer version.
2. Source and target service.
3. Runtime payload validator.
4. Handler and domain idempotency strategy.
5. Retryable and non retryable error classification.
6. Maximum attempts, with default 5.
7. Payload redaction and operator payload allowlist.
8. Optional concurrency limit no greater than the process default.
9. Terminal failure notification eligibility.
10. For webhook work, a typed integration key whose destination and credential resolve from target service configuration.

Unknown type or version is rejected before enqueue. If a deployed worker encounters an unknown type or version, it marks the job terminal failed with a safe error and does not execute payload content.

## Data model

### `jobs.job`

1. `id`, UUIDv7 primary key.
2. `type`, `version`, `payload`, `sourceService`, and `targetService`.
3. `idempotencyKey`, unique with source service and type.
4. `correlationId` and nullable `actorUserId`.
5. `status`, `priority`, and `runAt`.
6. `attemptCount` and `maxAttempts`.
7. Nullable `lockedBy`, `lockedAt`, and `leaseExpiresAt`.
8. Nullable `completedAt` and `failedAt`.
9. Nullable sanitized `lastErrorCode` and `lastErrorMessage`.
10. Nullable logical `scheduleCode`.
11. Nullable self reference `retryOfJobId`.
12. Created and updated timestamps in UTC.

Payload is JSONB, limited to 64 KB after serialization. Registry validation rejects secrets, credentials, token values, and types outside the allowlist.

### `jobs.job_attempt`

1. UUIDv7 primary key and owning job foreign key.
2. Attempt number and worker identity.
3. Started and finished timestamps.
4. Outcome, duration, safe error code, and safe error message.
5. Attempts cascade only when their owning job is removed by retention.

### `jobs.job_schedule`

1. UUIDv7 primary key and unique stable `code`.
2. Job type and version.
3. Cron expression, IANA timezone, and enabled state.
4. `lastRunAt`, `nextRunAt`, and scheduler lock state.
5. Created and updated timestamps.

Schedule definitions synchronize idempotently from code at startup. Registry deletion disables a row rather than deleting history. Each occurrence uses `scheduleCode` plus planned UTC run time as its job idempotency key.

## Database boundary

1. Producer services call `enqueueJob(transaction, input)` in the same transaction as their mutation.
2. Producer roles receive only the required insert path. They cannot read, claim, or update queue data.
3. Worker functions map `current_user` to a configured target service and reject claims outside that target.
4. Claim, heartbeat, complete, and fail functions require the current lease owner.
5. Claim uses `FOR UPDATE SKIP LOCKED`, orders by priority then `runAt` then creation time, updates the lease, and creates an attempt row atomically.
6. A reaper moves expired running work to `retry_wait` or terminal `failed` according to attempts remaining.
7. No cross schema foreign key points from jobs to user, access, auth, or notification data.

## Worker lifecycle

1. Worker startup validates the registry, synchronizes schedules if it owns scheduler duties, and checks database function compatibility.
2. Default process concurrency is 5.
3. A claimed job receives a 60 second lease and a heartbeat every 20 seconds.
4. Workers poll every 5 seconds and may wake sooner from a best effort NATS signal.
5. Retry delay is `min(5 seconds × 2^(attempt number minus 1), 15 minutes)` plus 0 to 20 percent random jitter.
6. Non retryable failures become terminal immediately.
7. Shutdown stops new claims, continues heartbeats for active work, drains for a configured bounded period, then releases unfinished leases.
8. A handler that completed an external side effect but lost its lease must rely on its declared domain idempotency check when retried.

Exactly once email and webhook effects are not promised. An ambiguous provider timeout can create a duplicate external delivery, so templates and downstream integrations must tolerate duplicates.

A webhook payload cannot contain an arbitrary URL or credential. Its owning service resolves the registered integration key immediately before delivery and applies destination, method, header, timeout, and response size allowlists.

## Schedules

1. `cron-parser` is the only new runtime dependency in this feature.
2. Cron expression and IANA timezone validation run during code registry synchronization.
3. Invalid definitions fail readiness and do not emit occurrences.
4. One jobs service instance acquires a short scheduler lease before materializing due occurrences.
5. Missed occurrences after downtime are emitted in chronological order within a configured catch up limit. Older occurrences beyond that limit are recorded as skipped in structured telemetry.
6. There is no schedule editor API or UI.
7. `auth.cleanup_expired_security_data` replaces the current auth process timer and is the first production recurring schedule.

## Operator API

### `GET /api/v1/jobs`

Supports `page`, `status`, `type`, `sourceService`, `targetService`, `from`, and `to`. Page size is fixed at 25. The response contains rows, pagination metadata, applied filters, and available filter options.

### `GET /api/v1/jobs/:id`

Returns status, timing, source, target, correlation, sanitized payload allowlist, attempt history, and retry links. It never returns the original unrestricted payload.

### `POST /api/v1/jobs/:id/retry`

Requires `Idempotency-Key` with a UUID value and JSON body `{ reason }`. It accepts only a terminal failed job. Repeating the same header returns the same linked retry result. A new job uses a derived unique queue idempotency key and `retryOfJobId`. The original row remains immutable.

Permissions are `jobs:job:list`, `jobs:job:read`, and `jobs:job:retry`. `jobs:job:manage` is the wildcard. List and detail create ordinary access logs. Retry creates a strict audit entry.

There is no generic enqueue, payload edit, cancel, pause, resume, or force complete endpoint.

## Configuration

Typed environment configuration provides:

1. `JOBS_SERVICE_PORT`, default `3105`.
2. `JOBS_DATABASE_URL` for the jobs service role.
3. `JOB_WORKER_CONCURRENCY`, default `5`.
4. `JOB_LEASE_MS`, default `60000`.
5. `JOB_HEARTBEAT_MS`, default `20000`.
6. `JOB_POLL_INTERVAL_MS`, default `5000`.
7. `JOB_SHUTDOWN_TIMEOUT_MS`, default `30000`.
8. `JOB_RETENTION_DAYS`, default `90`.
9. `JOB_CLEANUP_INTERVAL_MS`, default one day.
10. `JOB_SCHEDULE_CATCH_UP_LIMIT`, default `100`.
11. `DURABLE_JOBS_ENABLED`, used only for staged producer rollout.

Payload values cannot override runtime limits.

## Health and telemetry

1. Liveness reports process state only.
2. Readiness verifies database access, required functions, and a valid registry.
3. Queue summary reports queued, running, retrying, failed, oldest queued age, and expired lease count.
4. Structured events cover enqueue, claim, complete, retry scheduled, terminal failure, lease recovery, schedule emission, and manual retry.
5. Metrics cover throughput, latency, attempts, terminal failures, queue age, lease expiry, and handler duration by job type.
6. Logs include request and correlation identifiers but never raw payloads.

## Retention and maintenance

Terminal jobs and attempts remain for 90 days by default. Cleanup runs in bounded batches, cascades only inside the jobs schema, and never removes queued, running, or retrying jobs. Retention is configurable by deployment.

## Required tests

1. Concurrent claim exclusion and ordering.
2. Enqueue transaction rollback and duplicate idempotency key behavior.
3. Lease heartbeat, expiry, recovery, and graceful shutdown.
4. Retry classification, backoff bounds, jitter bounds, and terminal transition.
5. Registry validation, payload size, unknown type, and unknown version.
6. Schedule synchronization, timezone behavior, duplicate occurrence prevention, and catch up limit.
7. Runtime database role isolation between target services.
8. Operator ACL, resource hiding, sanitized payload, idempotent manual retry, and audit emission.
9. Retention safety and bounded cleanup.
10. Worker progress while NATS is unavailable.
