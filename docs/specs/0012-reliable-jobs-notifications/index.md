# 0012. Reliable background jobs and notification center

**Date**: 2026-08-23

**Status**: In Progress

**Type**: Umbrella enhancement

## Summary

Add a PostgreSQL backed durable job runtime and a user notification center without adding Redis or JetStream. Durable work uses at least once processing, explicit idempotency, bounded retries, leases, and operator recovery. Notifications use the job runtime for reliable in app and email delivery.

This umbrella coordinates two child specs:

1. [Durable job runtime](./0012-durable-job-runtime.md)
2. [Notification center](./0012-notification-center.md)

## Decision

Use a PostgreSQL backed durable queue with NATS core as an optional wake signal. Keep execution handlers in their target services. Add a jobs service for queue operations and a notification service for user notification data and delivery. Use at least once processing with required producer and consumer idempotency.

## Goals

1. Preserve declared durable work across process and NATS outages.
2. Keep business mutations and durable enqueue in one PostgreSQL transaction.
3. Give users an in app notification center with email delivery and preferences.
4. Give authorized operators safe inspection and manual retry controls.
5. Keep auth tokens, credentials, and unrestricted payloads out of the queue and notification store.

## Out of scope

1. Employee, payroll, reporting, and employee self service features.
2. Native desktop push, web push, SMS, Slack, and mobile push.
3. A user editable recurring schedule interface.
4. Generic public enqueue or notification creation endpoints.
5. Exactly once side effects.
6. Queue partitioning, sharding, Redis, and JetStream.
7. Per user locale and timezone preferences.

## Confirmed architecture

1. `jobs` schema and `jobs` service own the queue, scheduler, recovery, cleanup, health endpoints, and operator API.
2. `notification` schema and `notification` service own notification records, preferences, recipient projection, delivery records, and user APIs.
3. `#project/jobs` provides transactional enqueue, registry validation, worker claiming, heartbeat, completion, failure, and graceful shutdown helpers.
4. Workers and handlers run in the target service. A runtime database role can claim only jobs mapped to that service.
5. PostgreSQL is the source of truth. Workers claim atomically with `FOR UPDATE SKIP LOCKED` and a lease.
6. NATS core sends best effort wake signals. Workers also poll every 5 seconds, so NATS failure changes latency rather than durability.
7. Producers must enqueue in the same database transaction as the source mutation. If enqueue fails, that mutation rolls back.
8. Processing is at least once. Every handler must enforce domain idempotency because a crash can occur after a side effect but before completion is recorded.
9. Durable job identity is unique on `(sourceService, type, idempotencyKey)`.
10. The default worker configuration is concurrency 5 per process, lease 60 seconds, heartbeat 20 seconds, poll 5 seconds, and 5 attempts. Deployment configuration can lower concurrency for a job type.
11. Automatic retry uses exponential backoff with 0 to 20 percent jitter, beginning at 5 seconds and capped at 15 minutes.
12. Immediate work, one time `runAt`, and recurring schedules declared in code are supported. `cron-parser` validates cron expressions and timezones during registry synchronization.
13. In app and email are the version one notification channels. Tauri uses the in app experience while open and does not emit native notifications.
14. The target operating scale is 100,000 jobs per day, 10,000 users, and a small worker fleet. Initial implementation does not partition tables.
15. Registered handlers may perform event, email, and webhook delivery. A webhook job carries a typed integration key only. Its destination and credential come from target service configuration and never from the payload.

## Feature design

The complete job data model, worker protocol, scheduler, operator API, and configuration are defined in [Durable job runtime](./0012-durable-job-runtime.md). The complete notification data model, delivery flow, event registry, user API, preference policy, and UI are defined in [Notification center](./0012-notification-center.md).

### Value sourcing

<table>
<thead><tr><th>Value or action</th><th>Named source</th></tr></thead>
<tbody>
<tr><td>Job type, version, target, retry policy, payload schema, and safe payload fields</td><td>Code owned job registry</td></tr>
<tr><td>Job payload and idempotency key</td><td>Source service domain event inside its business transaction</td></tr>
<tr><td>Actor and correlation identifiers</td><td>Verified request context propagated by the source service</td></tr>
<tr><td>Job time, attempt time, read time, and sent time</td><td>Database server time stored in UTC</td></tr>
<tr><td>Job target authorization</td><td>Runtime database role to target service mapping</td></tr>
<tr><td>Schedule expression, timezone, and occurrence key</td><td>Code schedule registry and planned UTC occurrence time</td></tr>
<tr><td>Webhook destination and credential</td><td>Target service typed configuration selected by a registered integration key</td></tr>
<tr><td>Manual retry reason</td><td>Required operator request body</td></tr>
<tr><td>Manual retry request identity</td><td>Required `Idempotency-Key` UUID header</td></tr>
<tr><td>Notification recipient name, email, active state, and job read capability</td><td>Durably maintained recipient projection</td></tr>
<tr><td>Notification category, severity, content, channels, mandatory rules, metadata, and action route</td><td>Versioned notification registry and Indonesian template</td></tr>
<tr><td>Effective channel preference</td><td>Mandatory registry rule, stored user override, then registry default</td></tr>
<tr><td>Unread totals, category counts, filter options, and pagination</td><td>Notification rows scoped to signed session user</td></tr>
<tr><td>Operator filter options, status, attempts, and correlations</td><td>Jobs schema through the ACL protected jobs service</td></tr>
<tr><td>Browser, platform, auth method, and masked IP</td><td>Normalized allowlisted security event fields from auth</td></tr>
<tr><td>Displayed timezone</td><td>Deployment `DATABASE_TIMEZONE`, currently `Asia/Jakarta`</td></tr>
</tbody>
</table>

### Critical test scenarios

1. Source mutation and enqueue commit or roll back together, including duplicate keys. Maps to `AC-1`.
2. Multiple workers race, a worker dies after claim, and another worker resumes after lease expiry without duplicate domain state. Maps to `AC-2` and `AC-5`.
3. Retryable, non retryable, scheduled, and manual retry paths produce the defined states and audit evidence. Maps to `AC-3`, `AC-4`, and `AC-12`.
4. One event from each category reaches the correct user and honors effective preferences. Maps to `AC-6`, `AC-8`, `AC-10`, and `AC-13`.
5. SMTP fails after in app persistence and does not remove the notification or create recursive failure notifications. Maps to `AC-9` and `AC-14`.
6. Two signed in users exercise all notification reads and mutations without cross user disclosure. Maps to `AC-7` and `AC-12`.
7. Invitation cutover creates a fresh token only inside auth attempt handling and persists no raw token. Maps to `AC-16`.
8. Web and Tauri exercise loading, empty, populated, failure, retry, filter, read, preference, and operations states. Maps to `AC-11` and `AC-17`.
9. Bounded cleanup removes only expired terminal data. Maps to `AC-15`.

## Cross child contract

1. Producers submit typed, versioned payloads no larger than 64 KB. The registry defines payload validation, target service, retry policy, redaction, and handler ownership.
2. Notification creation uses typed `notification.create` jobs. Email delivery uses a separate typed job containing only `notificationDeliveryId`.
3. `notification.notification_delivery.jobId` is a logical reference. There is no foreign key across service schemas.
4. User and access services maintain `notification.recipient_projection` through durable synchronization jobs. An initial controlled migration performs the backfill.
5. Terminal failure notifications are sent to active users projected with `jobs:job:read`. Notification pipeline failures never create another failure notification.
6. Normal auth magic link email remains synchronous and auth owned. Raw magic link and invitation tokens never enter a job payload.
7. User invitation moves from best effort NATS delivery to `auth.send_user_invitation`. Its payload contains `userId` only. The auth worker creates a fresh token at each attempt and invalidates earlier unused invitation tokens.
8. Auth cleanup moves from its process timer to the code registered `auth.cleanup_expired_security_data` recurring job. The auth service remains the handler owner.

## State model

```text
queued → running → succeeded
queued → running → retry_wait → running
queued → running → failed
running with an expired lease → retry_wait
failed → manual retry creates a new linked queued job
```

The original failed job is immutable. A manual retry creates a new job with `retryOfJobId`, a derived unique job key, and a strict audit record containing actor, reason, source job, and new job.

## Service and route placement

1. `apps/services/jobs` defaults to port `3105`.
2. `apps/services/notification` defaults to port `3106`.
3. The ERP gateway exposes notification self service routes and ACL protected job operator routes.
4. OpenAPI remains the source for the generated Angular SDK.
5. The Angular shell adds a bell and routes for `/notifications`, `/operations/jobs`, and `/operations/jobs/:id`.

## Migration plan

### Strategy

Use a strangler rollout. Establish the durable runtime first, cut over one producer without dual publish, then enroll notification categories incrementally.

### Phases

1. Add database schemas, runtime roles, migrations, shared package, registries, services, and workers while existing producers remain unchanged.
2. Deploy workers and require database plus registry readiness before producer cutover.
3. Switch invitation creation directly from NATS publish to transactional job enqueue and replace the auth cleanup timer with its registered schedule. Do not run old and new paths together.
4. Enable notification event producers one category at a time behind typed deployment flags.
5. Enable notification center UI after read, preference, and delivery paths are healthy.

### Rollback

Keep the old invitation event consumer disabled but available for one release rollback window. Disable the new producer before restoring the old producer. Never run both producers for the same invitation. Database migrations remain forward compatible during that window.

### Risks

1. A partial cutover can duplicate invitation email if producer ownership is unclear. Deployment checks must prove exactly one producer is enabled.
2. A queue backlog can increase database load. Queue age, claim latency, cleanup batches, and database health gate each rollout phase.
3. Runtime role mistakes can expose cross service jobs. Authorization tests gate deployment.
4. Ambiguous SMTP responses can duplicate email even when queue state is correct. User visible messages must tolerate duplicates.

## Build plan

1. [ ] Create the `jobs` database schema, grants, stored functions, registry, and `#project/jobs` package. Implement one transactional enqueue through claim, heartbeat, completion, retry, and lease recovery. Covers `AC-1` through `AC-5`.
2. [ ] Create the jobs service, recurring scheduler, cleanup, health and queue summary endpoints, structured telemetry, and operator list, detail, and retry routes. Covers `AC-3`, `AC-4`, `AC-11`, `AC-12`, `AC-14`, and `AC-15`.
3. [ ] Move invitation delivery to `auth.send_user_invitation` without storing a raw token, remove the invitation dependency on best effort NATS, and replace the auth cleanup timer with `auth.cleanup_expired_security_data`. Covers `AC-4`, `AC-13`, and `AC-16`.
4. [ ] Create the notification schema, service, recipient projection, typed templates, and one security event path from source mutation through in app persistence. Covers `AC-6`, `AC-7`, `AC-10`, and `AC-13`.
5. [ ] Add email delivery jobs, effective preference checks, mandatory categories, account and access event producers, and terminal job failure fanout. Covers `AC-6`, `AC-8`, `AC-9`, and `AC-10`.
6. [ ] Add OpenAPI contracts, generated Angular SDK, shell bell, notification page, preferences, jobs table, job detail, and retry reason dialog. Covers `AC-7`, `AC-8`, `AC-11`, and `AC-17`.
7. [ ] Add integration, failure recovery, authorization, redaction, migration, retention, and load focused tests. Complete staged rollout checks and operational documentation. Covers all acceptance criteria.

## Requirements

### AC-1 Transactional and idempotent enqueue

Given a registered durable job type and a source mutation, when the source transaction commits, then the mutation and one validated job commit together. Repeating the same `(sourceService, type, idempotencyKey)` returns the existing job without creating another row. If enqueue fails, the source mutation rolls back.

### AC-2 Safe at least once processing

Given competing workers, when they claim work, then a job is leased atomically to one worker at a time. A crashed worker loses its lease, the job becomes eligible again, and an idempotent handler prevents duplicate domain state.

### AC-3 Automatic and manual retry

Given a retryable failure, when attempts remain, then the job enters `retry_wait` with exponential backoff and jitter. After 5 failed attempts it becomes terminal `failed`. An authorized manual retry requires a reason and idempotency header, creates one linked job, and leaves the original unchanged.

### AC-4 Scheduled jobs

Given valid code registered schedules, including `auth.cleanup_expired_security_data`, when services start and scheduled times arrive, then definitions synchronize idempotently and one occurrence job is created using schedule code plus planned run time as the idempotency key. Invalid cron or timezone configuration fails readiness.

### AC-5 Least privilege worker access

Given a runtime database role, when it calls job functions, then it can claim and mutate only jobs for its mapped target service. Producer roles can insert validated jobs but cannot list, claim, or update arbitrary queue rows.

### AC-6 Reliable notification creation

Given a supported security, access, account, or terminal job failure event, when its source transaction commits, then a typed `notification.create` job is committed for every intended recipient. A notification stores an immutable rendered snapshot, allowlisted metadata, and an allowlisted internal action route.

### AC-7 Notification center behavior

Given a signed in user, when they use notification APIs or UI, then they can see only their own paginated notifications, unread total and category counts, category and unread filters, mark one as read, and mark all as read. Another user notification identifier returns `404`.

### AC-8 Effective preferences

Given a notification category and channel, when the user changes an optional preference, then future deliveries honor it. Critical security and access notifications remain mandatory in app. Account status email remains mandatory. Attempts to disable a mandatory preference return `409` with its effective state.

### AC-9 Independent channel delivery

Given in app creation succeeds and email later fails, when retries are exhausted, then the in app notification remains available, the email delivery is terminal failed, and operators can inspect the correlation without creating a recursive failure notification. Disabled or inactive recipients produce `skipped`, not `failed`.

### AC-10 Recipient projection

Given a user or permission change, when its durable projection job completes, then the notification service has the current name, email, active state, and job read capability without runtime reads across the user or access schema. A missing projection is retryable as `recipient_not_ready`.

### AC-11 Job operator access

Given an authorized operator, when they list or inspect jobs, then filters, timing, sanitized payload, attempt history, correlations, and retry links are available. List and detail require `jobs:job:list` and `jobs:job:read`; retry requires `jobs:job:retry`; `jobs:job:manage` is the wildcard.

### AC-12 Audit and privacy

Given a job or notification operation, when it is logged or audited, then no raw payload, token, cookie, credential, raw user agent, or unmasked IP is recorded. Job reads create ordinary access logs. Manual retry creates a strict audit record.

### AC-13 Source integrations

Given successful sign in, passkey change, TOTP change, recovery code use, session revocation, permission change, or account status change, when the source transaction commits, then the intended notification job is committed with summary data only. Normal magic link email remains outside this system.

### AC-14 Observable and recoverable operation

Given jobs are processing, when operators inspect health and metrics, then queue depth, oldest age, running, retrying, terminal failure, expired lease, duration, and delivery outcomes are visible without payload contents. NATS outage leaves polling active.

### AC-15 Retention

Given terminal data ages beyond configured retention, when cleanup runs, then jobs and attempts older than 90 days and notifications and deliveries older than 365 days are removed within their owner schema. Preferences, schedules, and active recipient projections remain while relevant.

### AC-16 Safe invitation cutover

Given a user invitation, when the user mutation commits after cutover, then an `auth.send_user_invitation` job containing only `userId` exists. The auth worker creates the token at attempt time. No dual publish occurs and raw tokens never enter jobs, logs, or notifications.

### AC-17 Web and desktop experience

Given the Angular web app or Tauri shell is open, when notification data changes, then the shell loads the unread count at session start, important navigation, and every 60 seconds while active. The bell, full page, preference controls, job operations pages, and all loading, empty, error, retry, and pagination states use the existing Angular design system.

## Consequences

1. PostgreSQL now carries queue workload and needs queue indexes, metrics, vacuum awareness, and bounded cleanup.
2. Handler authors must define domain idempotency, retry classification, payload validation, and redaction.
3. At least once processing can duplicate external email or webhook side effects after ambiguous provider responses.
4. Separate services add process and migration work but preserve clear user, operator, security, and retention boundaries.
5. Redis, JetStream, native push, user editable schedules, and exactly once guarantees remain outside this build.

## Rationale

See [rationale.md](./rationale.md) for evaluated runtime, service boundary, and migration options.

## Follow up

1. [ ] Run `/develop docs/specs/0012-reliable-jobs-notifications` after this spec and scope are approved.
2. [ ] Run `/check verify` against [verify.md](./verify.md) after implementation.
3. [ ] Run `/sync` after shipping. Record that additional Agent Skill and MCP discovery for `cron-parser` was declined for this feature.
