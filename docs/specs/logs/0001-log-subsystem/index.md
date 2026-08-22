# 0001. Log subsystem: partitioned database logs, API module, and Angular viewer

**Date**: 2026-08-22
**Status**: In Progress

## Summary

All application logs, audit trails, and access logs live in the platform's own PostgreSQL database, in the `logs` schema split into yearly partitions (the table is divided by year so old data stays cheap to manage), with partition children in the `partition` schema. A shared `ActivityLog` helper in `packages/logger` writes them from any service, a dedicated read only service at `apps/services/logs` serves them through the gateway under `/api/v1/logs`, and three Angular pages let operators browse, filter, and page through them. The design comes from the ETOS Payroll reference implementation and is adapted here to the Monobungsia monorepo (schema name `logs`, gateway prefix `/api/v1`, per service architecture).

## Requirements

**User stories**:
- As a developer, I want application events and errors recorded with context so that I can diagnose problems without leaving the database I already query.
- As an auditor, I want an immutable record of who changed what business entity, when, and why, so that critical changes are accountable.
- As a security officer, I want every sign in, sign out, and denied access recorded so that suspicious activity is traceable.
- As an operator, I want to browse, search, filter, and page through all three log types in the web UI so that I never need direct database access.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Application log writes are queued asynchronously and are best effort; a failed write is reported to the console and never fails the calling request.
- **AC-2**: Audit trail writes are awaited; a failed audit write throws and the calling operation fails visibly.
- **AC-3**: Every log row lands in a yearly partition keyed by the Jakarta calendar year (UTC+7); a missing partition is created automatically on first write, serialized with a Postgres advisory lock, and an insert that hits Postgres error `23514` with a "no partition" message is retried once after the partition is created.
- **AC-4**: Three read endpoints (`/api/v1/logs/audit-trails`, `/api/v1/logs/access-logs`, `/api/v1/logs/application-logs`) return filtered results paged at 25 per page, newest first, each response carrying `data`, `meta` (page, perPage, total, totalPages), the applied `filters`, and `options` (distinct values for each dropdown filter).
- **AC-5**: All read endpoints require the `logs.read` permission, granted to the admin and manager roles; the gateway validates the session cookie and forwards the signed identity, the logs service enforces the permission from the forwarded role, and a caller without it is denied.
- **AC-6**: Free text search is parameterized with ILIKE and escapes `%` and `_`; raw search input never appears in SQL text.
- **AC-7**: Timestamps are stored as UTC wall time in a `timestamp` column (no timezone) and returned to clients as ISO 8601 UTC strings.
- **AC-8**: The application logs read path drains the async write queue (`ActivityLog.flush()`) before querying, so a log written just before the read is visible in the result.
- **AC-9**: Each Angular page (audit, access, application) shows its log type in a table with search, dropdown filters, a clear filters action, and first/previous/next/last paging; any filter change resets to page 1.

## Decision

**Chosen option**: keep all logs inside the application's PostgreSQL database, in the `logs` schema with yearly range partitions and children in the `partition` schema, written through one shared `ActivityLog` helper in `packages/logger` that every service can use, served by a dedicated read only service at `apps/services/logs` (port 3103, internal prefix `/internal/logs`) through the gateway under `/api/v1/logs`, and viewed in three standalone Angular pages. The logs service exists for control and monitoring only; it never writes logs.

## Feature design

**Data model sketch** (schema `logs`, partition children live in schema `partition`, all PKs are composite `(id, <time column>)` with `id uuid DEFAULT uuidv7()`, all time columns `timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`; the old non partitioned `logs` tables from migration 0002 are dropped and recreated in this shape):

`logs.logging` (application diagnostics, partitioned by RANGE on `occurred_at`, children `partition.logging_YYYY`):

| Column | Type | Null | Notes |
|---|---|---|---|
| level | varchar(20) | no | debug, info, warning, error, critical |
| channel | varchar(50) | yes | source channel, defaults to 'application' in code |
| category | varchar(50) | no | default 'application' |
| event, module | varchar(100) / varchar(50) | yes | event name, source module |
| message | text | no | the diagnostic message |
| context | jsonb | yes | arbitrary structured context |
| exception_class, exception_message, stack_trace | varchar(255), text, text | yes | error details |
| actor_user_id, actor_name, actor_email | uuid, varchar(150), varchar(150) | yes | who acted |
| entity_type, entity_id | varchar(100) | yes | affected entity |
| reference_no, branch_code | varchar(50), varchar(20) | yes | business references |
| request_id, trace_id, session_id | varchar(100) | yes | correlation, supplied by the caller |
| ip_address, user_agent | varchar(45), text | yes | client details |
| occurred_at, created_at | timestamp | no | occurred_at is the partition key |

Indexes: `(level, occurred_at)`, `(category, occurred_at)`, `(entity_type, entity_id)`, and single column indexes on channel, event, module, actor_user_id, reference_no, branch_code, request_id, trace_id, session_id.

`logs.audit_trails` (immutable business change record, partitioned on `audited_at`, children `partition.audit_trails_YYYY`):

| Column | Type | Null | Notes |
|---|---|---|---|
| action, module | varchar(50) | no | create, update, delete; owning module |
| entity_type, entity_id | varchar(100) | no | what changed |
| entity_label | varchar(150) | yes | human readable label |
| reference_no, transaction_no | varchar(50) | yes | business references |
| fiscal_period | varchar(20) | yes | YYYY-MM |
| branch_code | varchar(20) | yes | |
| amount | bigint | yes | smallest currency unit |
| currency_code | varchar(3) | no | default 'IDR' |
| status_before, status_after | varchar(30) | yes | state transition |
| actor_user_id, actor_name, actor_email, actor_role | uuid, varchar(150), varchar(150), varchar(50) | yes | who and in what role |
| reason, change_summary | text | yes | why and what changed |
| before_state, after_state, metadata | jsonb | yes | full entity snapshots |
| request_id, trace_id | varchar(100) | yes | correlation |
| ip_address, user_agent | varchar(45), text | yes | |
| audited_at, created_at | timestamp | no | audited_at is the partition key |

Indexes: `(module, audited_at)`, `(action, audited_at)`, `(entity_type, entity_id)`, and single column indexes on reference_no, transaction_no, fiscal_period, branch_code, actor_user_id, request_id, trace_id.

`logs.access_logs` (sign in and security events, partitioned on `accessed_at`, children `partition.access_logs_YYYY`):

| Column | Type | Null | Notes |
|---|---|---|---|
| event | varchar(50) | no | sign_in, sign_out, permission_denied |
| outcome | varchar(20) | no | default 'success' |
| authentication_method | varchar(30) | yes | magic_link, jwt, session_cookie |
| access_channel | varchar(20) | no | default 'web' |
| guard | varchar(30) | yes | auth guard name |
| actor_user_id, actor_name, actor_email | uuid, varchar(150), varchar(150) | yes | null on failed logins |
| branch_code | varchar(20) | yes | |
| ip_address, forwarded_ip | varchar(45) | yes | direct and X-Forwarded-For |
| user_agent, device_name, platform, browser | text, varchar(100), varchar(50), varchar(50) | yes | client fingerprint |
| session_id, request_id, trace_id | varchar(100) | yes | correlation |
| route_name, path, method, http_status | varchar(150), varchar(255), varchar(10), smallint | yes | what was accessed |
| failure_reason | text | yes | why access was denied |
| metadata | jsonb | yes | |
| accessed_at, created_at | timestamp | no | accessed_at is the partition key |

Indexes: `(event, accessed_at)`, `(outcome, accessed_at)`, and single column indexes on authentication_method, access_channel, actor_user_id, actor_email, branch_code, ip_address, session_id, request_id, trace_id, route_name, http_status.

**Partitioning helpers** (shared, whitelisted per table): `jakartaYear(value)` adds 7 hours before extracting the year; `jakartaYearBoundaryUtc(year)` returns the UTC wall time boundary (`2025-12-31 17:00:00` opens 2026); `logPartitionName(table, year)` returns `{table}_{year}`; `ensureLogPartition(table, ts)` creates the child idempotently under `pg_advisory_xact_lock`; `withLogPartitionRecovery(table, ts, insert)` retries the insert once when `isMissingLogPartitionError` matches code `23514` plus a "no partition" message.

**Write path** (shared `ActivityLog`, an abstract class with static methods):
- `ActivityLog.writeLog(input)` returns the record synchronously (uuidv7 id, ISO timestamps) and enqueues the INSERT on a single promise chain; errors go to the console, the chain continues (AC-1).
- `ActivityLog.writeAudit(input)` awaits the INSERT wrapped in partition recovery and throws on failure (AC-2).
- `ActivityLog.flush()` drains the queue; the application logs read path calls it before querying (AC-8).
- JSON fields are `JSON.stringify` encoded to jsonb; null and undefined become SQL NULL.

**API surface**:
| Endpoint | Method | Key inputs (query) | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/logs/audit-trails | GET | search, module, action, page | data[], meta, filters, options{modules, actions} | logs.read (admin, manager) | 401, 403 |
| /api/v1/logs/access-logs | GET | search, event, outcome, page | data[] (event, outcome, actorEmail, failureReason, createdAt), meta, filters, options{events, outcomes} | logs.read (admin, manager) | 401, 403 |
| /api/v1/logs/application-logs | GET | search, level, module, event, page | data[] (full record), meta, filters, options{levels, modules, events} | logs.read (admin, manager) | 401, 403 |

Ordering is `<time column> DESC, id DESC`. Search targets per endpoint: audit (action, module, entity_label, actor_email, change_summary), access (event, outcome, actor_email, failure_reason), application (level, category, event, module, message, actor_email), all via `concat_ws(' ', ...) ILIKE ? ESCAPE '\'`.

**Value sourcing** (every value each action produces or displays names its source):
| Action | Value produced / displayed | Source |
|---|---|---|
| write any log | id | generated, uuidv7() |
| write any log | occurred_at / audited_at / accessed_at | generated, `new Date().toISOString()`, stored as UTC wall time |
| write any log | request_id, trace_id, session_id, ip_address, user_agent | caller supplied input fields; HTTP middleware populates them, the logging layer does not |
| write any log | actor_* columns | caller supplied `actor` object (id, name, email, role) from the auth layer |
| write application log | channel, category | input, falling back to 'application' |
| write to a partition | target partition year | derived: partition key timestamp plus 7 hours (Jakarta), via `jakartaYear` |
| read any list | meta.total, meta.totalPages | derived from a COUNT query and perPage 25 |
| read any list | options dropdown values | DB, `SELECT DISTINCT` per filter column |
| read any list | page | query param, parsed to a positive int, default 1 |
| read any list | caller permission | derived: the forwarded identity role; admin and manager map to `logs.read` |
| display timestamps (UI) | localized date text | derived, `Intl.DateTimeFormat('id-ID')` over the ISO string |
| read rows | camelCase fields | derived, mappers rename snake_case columns and parse jsonb strings |

**Key invariants**:
- Composite primary key `(id, <time column>)` on every log table; Postgres requires the partition key in the PK.
- Every row's partition child exists before its insert commits (ensure plus one retry).
- Application log writes never block or fail a request; audit writes always do on failure.
- Read pages are exactly 25 rows; `page` below 1 is treated as 1.
- Stored timestamps are UTC wall time; the API always returns ISO 8601 with a `Z`.
- Search input is always bound as a parameter with ILIKE escaping.

**Security model**:
- All three read endpoints demand the `logs.read` permission. The gateway validates the session cookie and forwards the HMAC signed identity headers; the logs service verifies them with its auth identity plugin and grants `logs.read` to the admin and manager roles only. The auth session response also carries a `permissions` array (admin and manager get `logs.read` and `users.manage`) so the web client can gate its routes and navigation.
- Log rows carry PII (emails, IP addresses, user agents); only operators with `logs.read` may view them. There are no write endpoints; writes happen only in server code.
- Audit trails are append only by convention; no update or delete surface exists.

**Configuration required**:
- `DATABASE_URL`: the PostgreSQL connection the log writes and reads use (shared with the app).
- `LOGS_SERVICE_PORT` (default 3103) and `LOGS_SERVICE_URL` (used by the gateway to reach `/internal/logs`).
- `ENABLE_INFRASTRUCTURE`: when false, the logs service starts without PostgreSQL and its read endpoints return empty pages; `ActivityLog` stays unconfigured and skips writes.
- `INTERNAL_AUTH_SIGNING_SECRET`: shared secret the logs service uses to verify the forwarded identity headers.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: write an application log, flush, read it back through `/api/logs/application-logs` with jsonb context parsed and camelCase fields, verifies **AC-1**, **AC-7**, **AC-8**.
- Failure case: insert against a missing partition raises `23514` "no partition"; the helper creates the child and the retry succeeds, verifies **AC-3**.
- Injection case: a search of `login' OR 1=1 --` never appears in SQL text and returns safely, verifies **AC-6**.
- Auth case: a user without `logs.read` gets a denial from each endpoint, verifies **AC-5**.
- Pagination case: 26 rows and `page=2` yields meta `{ page: 2, perPage: 25, total: 26, totalPages: 2 }`, verifies **AC-4**.
- Audit failure case: a failing audit INSERT propagates to the caller, verifies **AC-2**.

## Build plan

The project's build approach is Tracer Bullet (from the scope header): a thin working thread first, then thickening.

- [x] 1. Migration `0010` in `packages/database/migrations/logs`: create schema `partition`, drop the old non partitioned `logs` tables from 0002, recreate the three partitioned parents with composite PKs, all indexes, grants, and the current Jakarta year children, satisfies **AC-3**, **AC-7**.
- [x] 2. Shared partition helpers in `packages/logger` (`jakartaYear`, `jakartaYearBoundaryUtc`, `logPartitionName`, `ensureLogPartition`, `withLogPartitionRecovery`, `isMissingLogPartitionError`) with unit tests on the year boundary math and error matching, satisfies **AC-3**.
- [x] 3. Shared `ActivityLog` writer in `packages/logger` (async queue for `writeLog`, awaited `writeAudit`, `flush`, configured with a database client by each composition root) plus the `isoFromDbTimestamp` utility, satisfies **AC-1**, **AC-2**, **AC-7**, **AC-8**.
- [x] 4. Thin thread: new `apps/services/logs` service (port 3103) with one endpoint (`/internal/logs/application-logs`) through route, schema, service, repository (queries plus mappers), the auth identity plugin with the `logs.read` role check, a gateway proxy for `/api/v1/logs/*`, and wiring into root scripts, env, OpenAPI generation, and CI, satisfies **AC-4**, **AC-5**, **AC-6**, **AC-8**.
- [x] 5. Thicken: add `/internal/logs/audit-trails` and `/internal/logs/access-logs` with their filters, options queries, and mappers, satisfies **AC-4**, **AC-5**, **AC-6**.
- [x] 6. Auth session `permissions` array mapped from the role (admin and manager get `logs.read` and `users.manage`) so the web permission guard and navigation work, satisfies **AC-5**, **AC-9**.
- [x] 7. Frontend: upgrade the three standalone signal based pages on the existing `ApiService` methods with search, dropdown filters, clear filters, paging, and id-ID date formatting, satisfies **AC-9**.
- [x] 8. Repository and service tests pinning injection safety, pagination clamping, jsonb parsing, field mapping, and distinct options, satisfies **AC-4**, **AC-6**.
- [x] 9. Regenerate the OpenAPI specs and the Angular SDK and commit the generated output (CI fails on uncommitted diffs).

## Consequences

**Positive**:
- Logs, audits, and app data share one database, so joins and audits are one query away and no external log service is needed.
- Yearly partitions keep pruning and archiving old years cheap (detach or drop a child) without table rewrites.
- Best effort application logging never slows or breaks user requests; audit writes are strict where correctness matters.
- The route, schema, service, repository split matches the rest of the backend, so the module is familiar to maintain.

**Negative / tradeoffs**:
- Log volume grows the primary database; heavy logging competes with application queries for the same Postgres.
- ILIKE search over text has no full text index and slows as partitions grow.
- Distinct option queries add 2 to 4 extra queries per list request.
- Async fire and forget writes can be lost on process crash before the queue drains; there is no retry beyond the partition recovery.
- The Jakarta year boundary is hardcoded at UTC+7; a project in another timezone must change the offset.

**Neutral**:
- No retention policy is implemented; partitions persist until someone drops them manually.
- Correlation fields (request_id, trace_id, session_id) are caller supplied; middleware must populate them or they stay null.

## Follow-up

- [ ] Define a retention and drop policy for old yearly partitions (currently manual).
- [ ] Consider middleware that auto populates request_id, trace_id, ip_address, and user_agent so callers cannot forget them.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
