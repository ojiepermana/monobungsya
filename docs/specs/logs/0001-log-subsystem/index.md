# 0001. Log subsystem: partitioned database logs, API module, and Angular viewer

**Date**: 2026-08-23
**Status**: In Progress

## Summary

Application logs, audit trails, and access logs live in PostgreSQL under yearly partitions (tables divided by year). The gateway records each completed public API request once, so opening `/users` creates an access row for `GET /api/v1/users`. Service `Logger` calls record technical events in Log Aplikasi, while Log Audit remains the strict record of business changes.

## Requirements

**User stories**:
- As a developer, I want application events and errors recorded with context so that I can diagnose problems without leaving the database I already query.
- As an auditor, I want an immutable record of who changed what business entity, when, and why, so that critical changes are accountable.
- As a security officer, I want every sign in, sign out, and denied access recorded so that suspicious activity is traceable.
- As a security officer, I want each public API request recorded with its actor, route, result, and correlation data so that I can reconstruct access to protected data.
- As an operator, I want to browse, search, filter, and page through all three log types in the web UI so that I never need direct database access.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Application and access log writes are queued asynchronously and are best effort; a failed write is reported to the console and never fails the calling request.
- **AC-2**: Audit trail writes are awaited; a failed audit write throws and the calling operation fails visibly.
- **AC-3**: Every log row lands in a yearly partition keyed by the Jakarta calendar year (UTC+7); a missing partition is created automatically on first write, serialized with a Postgres advisory lock, and an insert that hits Postgres error `23514` with a "no partition" message is retried once after the partition is created.
- **AC-4**: Three read endpoints (`/api/v1/logs/audit-trails`, `/api/v1/logs/access-logs`, `/api/v1/logs/application-logs`) return filtered results paged at 25 per page, newest first, each response carrying `data`, `meta` (page, perPage, total, totalPages), the applied `filters`, and `options` (distinct values for each dropdown filter).
- **AC-5**: All read endpoints require the `logs.read` permission, granted to the admin and manager roles; the gateway validates the session cookie and forwards the signed identity, the logs service enforces the permission from the forwarded role, and a caller without it is denied.
- **AC-6**: Free text search is parameterized with ILIKE and escapes `%` and `_`; raw search input never appears in SQL text.
- **AC-7**: Timestamps are stored as UTC wall time in a `timestamp` column (no timezone) and returned to clients as ISO 8601 UTC strings.
- **AC-8**: `ActivityLog.flush()` drains only the queue in its current process. Every process that writes application or access logs drains its own queue during graceful shutdown before closing PostgreSQL, with a bounded timeout. A read in the logs service never claims to flush queues owned by the gateway, auth service, or user service.
- **AC-9**: Each Angular page (audit, access, application) shows its log type in a table with search, dropdown filters, a clear filters action, and first/previous/next/last paging; any filter change resets to page 1.
- **AC-10**: The gateway writes exactly one access row after every completed request under `/api/v1`, except CORS `OPTIONS`. The row contains a normalized route name, pathname without query values, method, final HTTP status, outcome, actor and session when verified, request and trace identifiers, direct and forwarded IP values, user agent, and duration. Requests completed with status below 400 have outcome `success`; status 400 or above has outcome `failure`.
- **AC-11**: Opening the Angular `/users` route triggers `GET /api/v1/users` and produces an `api_request` access row. Search, filter, and paging requests produce their own rows. Angular does not write a security `page_view` event.
- **AC-12**: Successful and failed magic link or passkey sign in attempts, successful sign out, unauthenticated access, and forbidden access produce explicit access events. Auth events name their authentication method, and an unknown actor remains null rather than copying an unverified identity.
- **AC-13**: Each `Logger.debug`, `Logger.info`, `Logger.warn`, and `Logger.error` call at or above `LOG_LEVEL` writes one structured console record. When best effort persistence is enabled and a log database is configured, the same call also writes one application row. The stored module comes from the service name, the event comes from the stable message key, and `warn` is stored as `warning`. Normal request traffic is represented only in Log Akses, not duplicated as `request.received` application rows.
- **AC-14**: No stored log contains authorization headers, cookies, magic link tokens, session tokens, passkey responses, passwords, secrets, or sensitive query values. Access paths store only `URL.pathname`; application context is sanitized recursively before console or database output.
- **AC-15**: The access viewer and API expose method, path, normalized route name, HTTP status, request id, actor email, outcome, failure reason, and access time. Access search includes route name, path, method, request id, event, outcome, actor email, and failure reason.

## Decision

**Chosen option**: fix the existing subsystem in place. Keep PostgreSQL, the partition model, `ActivityLog`, the read API, and the viewers. Add one gateway lifecycle plugin that records completed public API requests, explicit auth security events, and a `Logger` bridge that writes technical application events to `ActivityLog.writeLog` as well as the console. The logs service exposes no write endpoint, but it may record its own technical failures through the same application logger.

**Implementation skills**: `elysiajs` (`elysiajs/elysia`, `.agents/skills/elysiajs/`)

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
| event | varchar(50) | no | api_request, authentication_required, permission_denied, sign_in, sign_out |
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
- `ActivityLog.writeAccess(input)` follows the same best effort queue contract as `writeLog` (AC-1).
- `ActivityLog.writeAudit(input)` awaits the INSERT wrapped in partition recovery and throws on failure (AC-2).
- `ActivityLog.flush()` drains only the current process queue. Composition roots call it during graceful shutdown before closing their log database client (AC-8).
- JSON fields are `JSON.stringify` encoded to jsonb; null and undefined become SQL NULL.
- `Logger` keeps the existing `(event, context)` signatures. When `context.error` is an `Error`, it is removed from json context and supplies exception class, exception message, and stack trace. A string error remains ordinary sanitized context.

**Sanitization policy**:

The sanitizer walks nested objects and arrays before either output. Key matching is case insensitive. It replaces authorization, cookie, set cookie, password, token, access token, refresh token, session token, secret, code, credential, and passkey response values with `[REDACTED]`. `sessionId` and `requestId` are correlation values and remain visible. Circular or unsupported values become a stable marker instead of making logging throw.

**Production logging policy**:

| Producer | Log type | Events | Rule |
|---|---|---|---|
| API gateway | access | completed `/api/v1` requests | One row after response, excluding CORS `OPTIONS` |
| Auth service | access | sign in and sign out | One security event with the verified actor when available |
| Gateway authorization | access | authentication required and permission denied | One request row classified by the final 401 or 403 status |
| All backend processes | application | technical events, warnings, and errors | `Logger` writes console plus database at or above `LOG_LEVEL` |
| User service | audit | user create, update, status, delete, restore | Awaited inside the business operation |
| Angular | none | client route navigation | No security log write; the server request is authoritative |

The gateway access plugin is named, registered before route plugins, and exported with global lifecycle scope. It creates mutable request scoped context, proxy authorization enriches that context with verified identity, and `onAfterResponse` writes once after the final result is known. This follows Elysia lifecycle ordering and keeps access logging at the public trust boundary.

Normal `request.received` messages are removed from persisted application logging. A failed request may intentionally create one access row and one application error row. They describe different facts and share the same request id.

**API surface**:
| Endpoint | Method | Key inputs (query) | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/logs/audit-trails | GET | search, module, action, page | data[], meta, filters, options{modules, actions} | logs.read (admin, manager) | 401, 403 |
| /api/v1/logs/access-logs | GET | search, event, outcome, page | data[] (event, outcome, routeName, path, method, httpStatus, requestId, actorEmail, failureReason, accessedAt), meta, filters, options{events, outcomes} | logs.read (admin, manager) | 401, 403 |
| /api/v1/logs/application-logs | GET | search, level, module, event, page | data[] (full record), meta, filters, options{levels, modules, events} | logs.read (admin, manager) | 401, 403 |

Ordering is `<time column> DESC, id DESC`. Search targets per endpoint: audit (action, module, entity_label, actor_email, change_summary), access (event, outcome, route_name, path, method, request_id, actor_email, failure_reason), application (level, category, event, module, message, actor_email), all via `concat_ws(' ', ...) ILIKE ? ESCAPE '\'`.

**Value sourcing** (every value each action produces or displays names its source):
| Action | Value produced / displayed | Source |
|---|---|---|
| write any log | id | generated, uuidv7() |
| write any log | occurred_at / audited_at / accessed_at | generated, `new Date().toISOString()`, stored as UTC wall time |
| write any log | request_id, trace_id, session_id, ip_address, user_agent | caller supplied input fields; HTTP middleware populates them, the logging layer does not |
| write any log | actor_* columns | caller supplied `actor` object (id, name, email, role) from the auth layer |
| write application log | channel, category | input, falling back to 'application' |
| write application log through `Logger` | level | logger method, with `warn` normalized to `warning` |
| write application log through `Logger` | event, module, context | stable message key, configured service name, sanitized context argument |
| write application error | exception class, message, stack | original `Error` object before response mapping; absent when the caller did not supply an `Error` |
| write gateway access | path, method, user agent | incoming `Request`; path is `new URL(request.url).pathname` only |
| write gateway access | route name | normalized public route template declared with the gateway route |
| write gateway access | HTTP status | final `Response.status`, falling back to Elysia `set.status`, then 200 |
| write gateway access | outcome | derived from HTTP status, success below 400 and failure at or above 400 |
| write gateway access | event | 401 becomes `authentication_required`, 403 becomes `permission_denied`, all other statuses become `api_request` |
| write gateway access | actor and session | verified auth session resolved by the gateway; null for public or failed authentication |
| write gateway access | authentication method | `session_cookie` when a verified session supplied the actor; null for public or failed authentication |
| write gateway access | request and trace id | request scoped values created by `requestIdPlugin`, with trace id sourced from `x-correlation-id` or the request id |
| write gateway access | direct and forwarded IP | Bun connection address and the raw `x-forwarded-for` header; forwarded IP is not trusted as identity |
| write gateway access | duration | monotonic elapsed time from request context start to `onAfterResponse`, stored in metadata |
| write gateway access | access channel, guard | constants `api` and `gateway`; capability is added to metadata when the route requires one |
| write auth access | authentication method | route contract, either `magic_link` or `passkey`; logout uses `session_cookie` |
| write auth access | access channel, guard | constants `web` and `auth`; future desktop specific attribution needs an authenticated client signal |
| write failed access | failure reason | stable mapped error code or HTTP status label, never the response body or credential input |
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
- Every public API request produces one gateway request row. Explicit auth security events may produce a second row with the same request id because they record authentication, not HTTP transport.
- Internal service requests do not create access rows, which prevents duplicate rows for one public request.
- Application and access queues are process local. Cross process reads are eventually consistent.
- Console and database application records use the same sanitized context.
- Read pages are exactly 25 rows; `page` below 1 is treated as 1.
- Stored timestamps are UTC wall time; the API always returns ISO 8601 with a `Z`.
- Search input is always bound as a parameter with ILIKE escaping.

**Security model**:
- All three read endpoints demand the `logs.read` permission. The gateway validates the session cookie and forwards the HMAC signed identity headers; the logs service verifies them with its auth identity plugin and grants `logs.read` to the admin and manager roles only. The auth session response also carries a `permissions` array (admin and manager get `logs.read` and `users.manage`) so the web client can gate its routes and navigation.
- Log rows carry PII (emails, IP addresses, user agents); only operators with `logs.read` may view them. There are no write endpoints; writes happen only in server code.
- Browser route events are not accepted as security evidence. The gateway request that releases data is the authoritative access event.
- Raw cookies, authorization values, query values, and credential bodies never enter stored context or access metadata.
- Audit trails are append only by convention; no update or delete surface exists.

**Configuration required**:
- `DATABASE_URL`: the existing domain or logs read connection used by each service.
- `LOG_DATABASE_URL`: the least privilege PostgreSQL connection used by gateway and service log writers. It uses the `project_logs_writer` role. Development may fall back to `DATABASE_URL`; production requires an explicit value.
- `BEST_EFFORT_LOGGING_ENABLED`: enables application and access persistence without disabling strict audit writes. Default true when infrastructure is enabled and may be turned off for rollback.
- `LOG_FLUSH_TIMEOUT_MS`: maximum graceful shutdown wait for the local application and access queue, default 5000 ms.
- `LOGS_SERVICE_PORT` (default 3103) and `LOGS_SERVICE_URL` (used by the gateway to reach `/internal/logs`).
- `ENABLE_INFRASTRUCTURE`: when false, services start without PostgreSQL. Application and access writes are skipped, while an attempted strict audit write fails visibly.
- `INTERNAL_AUTH_SIGNING_SECRET`: shared secret the logs service uses to verify the forwarded identity headers.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: write an application log, flush its writer process, and read it back with jsonb context parsed and camelCase fields, verifies **AC-1**, **AC-7**.
- Failure case: insert against a missing partition raises `23514` "no partition"; the helper creates the child and the retry succeeds, verifies **AC-3**.
- Injection case: a search of `login' OR 1=1 --` never appears in SQL text and returns safely, verifies **AC-6**.
- Auth case: a user without `logs.read` gets a denial from each endpoint, verifies **AC-5**.
- Pagination case: 26 rows and `page=2` yields meta `{ page: 2, perPage: 25, total: 26, totalPages: 2 }`, verifies **AC-4**.
- Audit failure case: a failing audit INSERT propagates to the caller, verifies **AC-2**.
- Gateway access case: an authenticated `GET /api/v1/users` response produces one row with actor, route, method, 200 status, request id, and success outcome, verifies **AC-10**, **AC-11**.
- Denial case: a forbidden user request produces one `permission_denied` row with status 403 and no credential data, verifies **AC-10**, **AC-12**, **AC-14**.
- Auth case: magic link and passkey success or failure plus logout produce the expected security events and authentication method, verifies **AC-12**.
- Application case: `logger.warn('user.invited.skipped', context)` emits one sanitized console record and one database row at level `warning`, verifies **AC-13**, **AC-14**.
- Process boundary case: flushing the logs service cannot claim visibility for a queued gateway write; graceful gateway shutdown drains its own queue before closing PostgreSQL, verifies **AC-8**.
- Viewer case: the access page displays and searches method, path, status, route, and request id, verifies **AC-15**.

## Build plan

The project's build approach is Tracer Bullet (from the scope header): a thin working thread first, then thickening.

- [x] 1. Migration `0010` in `packages/database/migrations/logs`: create schema `partition`, drop the old non partitioned `logs` tables from 0002, recreate the three partitioned parents with composite PKs, all indexes, grants, and the current Jakarta year children, satisfies **AC-3**, **AC-7**.
- [x] 2. Shared partition helpers in `packages/logger` (`jakartaYear`, `jakartaYearBoundaryUtc`, `logPartitionName`, `ensureLogPartition`, `withLogPartitionRecovery`, `isMissingLogPartitionError`) with unit tests on the year boundary math and error matching, satisfies **AC-3**.
- [x] 3. Shared `ActivityLog` writer in `packages/logger` (async queue for `writeLog`, awaited `writeAudit`, `flush`, configured with a database client by each composition root) plus the `isoFromDbTimestamp` utility, satisfies **AC-1**, **AC-2**, **AC-7**, **AC-8**.
- [x] 4. Thin thread: new `apps/services/logs` service (port 3103) with one endpoint (`/internal/logs/application-logs`) through route, schema, service, repository (queries plus mappers), the auth identity plugin with the `logs.read` role check, a gateway proxy for `/api/v1/logs/*`, and wiring into root scripts, env, OpenAPI generation, and CI, satisfies **AC-4**, **AC-5**, **AC-6**.
- [x] 5. Thicken: add `/internal/logs/audit-trails` and `/internal/logs/access-logs` with their filters, options queries, and mappers, satisfies **AC-4**, **AC-5**, **AC-6**.
- [x] 6. Auth session `permissions` array mapped from the role (admin and manager get `logs.read` and `users.manage`) so the web permission guard and navigation work, satisfies **AC-5**, **AC-9**.
- [x] 7. Frontend: upgrade the three standalone signal based pages on the existing `ApiService` methods with search, dropdown filters, clear filters, paging, and id-ID date formatting, satisfies **AC-9**.
- [x] 8. Repository and service tests pinning injection safety, pagination clamping, jsonb parsing, field mapping, and distinct options, satisfies **AC-4**, **AC-6**.
- [x] 9. Regenerate the OpenAPI specs and the Angular SDK and commit the generated output (CI fails on uncommitted diffs), satisfies **AC-4**, **AC-9**.
- [x] 10. Thin production thread: add shared parsing for `LOG_DATABASE_URL`, `BEST_EFFORT_LOGGING_ENABLED`, and `LOG_FLUSH_TIMEOUT_MS`, configure the gateway with the least privilege log connection, add the request scoped Elysia access plugin, enrich it during identity resolution, and prove `GET /api/v1/users` writes exactly one complete access row, satisfies **AC-1**, **AC-10**, **AC-11**, **AC-14**.
- [x] 11. Add explicit magic link, passkey, logout, authentication required, and permission denied event classification with shared request correlation, satisfies **AC-10**, **AC-12**, **AC-14**.
- [x] 12. Bridge `Logger` to `ActivityLog.writeLog`, normalize `warn`, extract exception details, sanitize context for both outputs, and remove persisted `request.received` traffic, satisfies **AC-1**, **AC-13**, **AC-14**.
- [x] 13. Configure every writer composition root, add bounded queue drain before database close, and remove the invalid cross process flush claim from the logs read path, satisfies **AC-8**, **AC-13**.
- [x] 14. Extend access repository mapping, API schemas, Angular types, access tables, and search targets with route, path, method, status, request id, and access time, satisfies **AC-15**.
- [ ] 15. Add unit, integration, and E2E coverage for production writes, denied access, auth events, redaction, duplicate prevention, application persistence, shutdown drain, and `/users`, then regenerate OpenAPI and SDK artifacts, satisfies **AC-1**, **AC-8**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**, **AC-15**.

## Migration plan

**Strategy**: feature flagged fix in place, with no schema or data migration.

**Phases**:

1. Deploy the shared writer, sanitization, gateway plugin, and viewer contract with `BEST_EFFORT_LOGGING_ENABLED=false`.
2. Enable application logging on one process and inspect volume, redaction, and failures.
3. Enable gateway access logging, verify one row per public request, then enable the remaining processes.

**Rollback**: set `BEST_EFFORT_LOGGING_ENABLED=false`. Strict audit writes and existing read APIs remain active.

**Risks**: request volume can grow PostgreSQL faster than current fixtures suggest. Incorrect lifecycle scope can miss plugin routes or write duplicates. A missing `project_logs_writer` credential causes best effort rows to fall back to console only.

## Consequences

**Positive**:
- Logs, audits, and app data share one database, so joins and audits are one query away and no external log service is needed.
- Yearly partitions keep pruning and archiving old years cheap (detach or drop a child) without table rewrites.
- Best effort application logging never slows or breaks user requests; audit writes are strict where correctness matters.
- Opening a data page such as `/users` leaves server side evidence of the API access without trusting the browser to report itself.
- Application events already emitted through `Logger` become visible in the existing viewer without changing each caller.
- The route, schema, service, repository split matches the rest of the backend, so the module is familiar to maintain.

**Negative / tradeoffs**:
- Log volume grows the primary database; heavy logging competes with application queries for the same Postgres.
- ILIKE search over text has no full text index and slows as partitions grow.
- Distinct option queries add 2 to 4 extra queries per list request.
- Async fire and forget writes can be lost on process crash before the queue drains; there is no retry beyond the partition recovery.
- One access row per public API request increases PostgreSQL write volume and makes retention policy more urgent.
- Application errors and failed requests intentionally appear in different log types with the same request id.
- The Jakarta year boundary is hardcoded at UTC+7; a project in another timezone must change the offset.

**Neutral**:
- No retention policy is implemented; partitions persist until someone drops them manually.
- Cross process reads remain eventually consistent because each process owns its own in memory queue.

## Follow-up

- [ ] Define a retention and drop policy for old yearly partitions (currently manual).
- [ ] Consider middleware that auto populates request_id, trace_id, ip_address, and user_agent so callers cannot forget them.
- [ ] Define a trusted proxy policy before treating `x-forwarded-for` as the client IP. Until then it remains an untrusted forwarded value.
- [ ] Add the project wide `elysiajs` conventions to root `AGENTS.md`; the installed skill shaped lifecycle scope and plugin ordering for this decision but is not referenced by project context.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
