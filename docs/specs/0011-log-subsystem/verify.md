# Verify: Log subsystem · spec logs/0001 · updated 2026-08-23

_Steps derived from spec logs/0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Login as a user with `logs:log:read`, open `/logs/audit`, `/logs/access`, and `/logs/application`: each page renders a table with a search box, dropdown filters, a Clear Filters button, and First/Previous/Next/Last paging → AC-9
- [x] Login as a user without `logs:log:read`: the Logs section is absent from navigation and visiting `/logs/audit` redirects away → AC-5
- [x] On any log page, type in the search box or pick a dropdown value: the list reloads on page 1; press Clear Filters: all filters empty and page returns to 1 → AC-9
- [x] With more than 25 matching rows, walk First → Next → Last: the label reads `Page X of Y · N records` and the buttons disable at each end → AC-4, AC-9
- [x] Timestamps on all three pages render as Indonesian medium date plus short time (Intl id-ID) derived from ISO 8601 UTC strings ending in `Z` → AC-7
- [ ] Open `/users`, then open Log Akses: one `GET /api/v1/users` row shows the verified actor, success, status 200, route, request id, and access time → AC-10, AC-11, AC-15
- [ ] Search, filter, or change page on `/users`: each backend request adds one access row, while client navigation itself adds no `page_view` row → AC-10, AC-11
- [ ] Log Akses displays and can search route name, path, method, status, request id, actor email, outcome, and failure reason → AC-15
* [ ] Open `/users`, then narrow Log Akses to the trace shown on its session row: separate `/api/v1/auth/session` and `/api/v1/users` rows remain, both show client route `/users`, the trace source says `client supplied`, and no internal auth lookup appears → AC-17, AC-19
* [ ] An authenticated `/api/v1/auth/session` row shows session id, state, and the effective permission count plus the verified actor; it shows no role, permission names, expiry values, cookie, token, or raw body → AC-16, AC-19, AC-20
* [ ] An invalid session still returns `{ authenticated: false }` to the browser while an operator with `logs:log:read` can see its stable internal reason on the access row → AC-16, AC-20

## Commands

- [x] `bun run db:migrate` on a fresh database → all 10 migrations apply; `logs.logging`, `logs.audit_trails`, `logs.access_logs` are partitioned parents with composite PKs `(id, <time column>)` and children `partition.<table>_<YYYY>` exist for the current and next Jakarta year → AC-3, AC-7
- [x] `bun test packages/logger/src` → jakartaYear('2025-12-31T16:59:59.999Z') = 2025, jakartaYear('2025-12-31T17:00:00.000Z') = 2026, jakartaYearBoundaryUtc(2026) = '2025-12-31 17:00:00'; only SQLSTATE 23514 plus a "no partition" message counts as a missing partition; a failed writeLog logs to console and never throws; a failed writeAudit throws → AC-1, AC-2, AC-3
- [x] `bun test apps/services/logs/src` → search input "login' OR 1=1 --" never appears in SQL text (parameter bound, `%`/`_` escaped); 26 rows with page=2 yields meta { page: 2, perPage: 25, total: 26, totalPages: 2 }; snake_case maps to camelCase with jsonb parsed; distinct options per filter column; 401 unsigned, 403 without `logs:log:read`, and 200 with `logs:log:read` → AC-4, AC-5, AC-6
- [x] `bun test apps/gateway/erp/src` → `/api/v1/logs/*` without a session returns 401; with a valid session the gateway forwards to the logs service with a verifiable signed identity and intact query params → AC-4, AC-5
- [ ] `bun test packages/logger/src` → `Logger` writes the same sanitized event to console and `logs.logging`, maps `warn` to `warning`, extracts an `Error`, and never throws when the best effort database write fails → AC-1, AC-13, AC-14
- [ ] `bun test apps/gateway/erp/src` → each non OPTIONS `/api/v1` response produces one access row with the final status; 401 and 403 receive their security event names; internal service calls and health routes produce none → AC-10, AC-12, AC-14
- [ ] `bun test apps/services/auth/src` → magic link and passkey success or failure plus logout produce correlated access events without storing tokens or credential responses → AC-12, AC-14
- [ ] `bun test apps/services/logs/src` → access mapping and search include route name, path, method, status, request id, actor email, outcome, and failure reason; the read service does not claim to drain another process queue → AC-8, AC-15
- [ ] `bun run test:web` → the access pages render the extended fields, and the `/users` page still issues one initial users request → AC-11, AC-15
* [ ] `bun test apps/services/auth/src` → session inspection distinguishes missing cookie, unknown session, revoked, absolute expiry, idle expiry, missing user, deleted user, blocked user, and suspended user with the specified precedence; every non active public result remains `{ authenticated: false }` → AC-16, AC-20
* [ ] `bun test apps/services/auth/src` → the internal session observation contains only state and reason; it contains no role, permission list, or permission count → AC-16
* [ ] `bun test apps/services/auth/src` → session state classification and sliding expiry refresh use one database decision at database `now()`; a session crossing expiry is never refreshed after being classified invalid → AC-16
* [ ] `bun test apps/gateway/erp/src` → the public session handler stores only metadata version 1 fields, enriches actor and session only when verified, strips the internal observation, and falls back safely for invalid client correlation or route headers → AC-16, AC-18, AC-20
* [ ] `bun test apps/gateway/erp/src` → an authenticated public session uses one access lookup result for both `user.permissions` and `sessionSummary.permissionCount`; normalized duplicate names collapse before counting and a manage permission counts as one name → AC-16
* [ ] `bun test apps/gateway/erp/src` → when auth verifies a session but the access lookup fails, the public request returns 503 and the access row keeps verified actor and session, records `permission_lookup_failed`, and leaves session details null rather than storing count 0 → AC-5, AC-16
* [ ] `bun test apps/gateway/erp/src` → CORS permits `x-correlation-id` and `x-client-route`, and their preflight OPTIONS request produces no access row → AC-17
* [ ] `bun test apps/gateway/erp/src` → anonymous and invalid session results remain HTTP 200 access successes with their state in details, while malformed or unavailable auth responses have null details and the mapped failure → AC-16, AC-20
* [ ] `bun test apps/services/logs/src` → version 1 metadata maps to trace, client route, and session summary; old, malformed, unknown version, and unknown detail metadata map to null; exact trace filtering is parameter bound → AC-19, AC-20
* [ ] `bun run test:web` → one router navigation UUID is sent to the gateway origin for the guard and first page request, a later navigation gets another UUID, foreign origins receive no client context headers, and the access viewer can narrow to one trace → AC-17, AC-18, AC-19
* [ ] Run the `/users` E2E flow → the public session row and users row have different request ids, one shared trace id, client route `/users`, and exactly one row each → AC-17, AC-19
- [ ] Start a writer, enqueue application and access rows, send SIGTERM, and verify its local queue drains before the log database client closes or the configured timeout reports a warning → AC-8
- [ ] Hold a gateway write queue open while reading through the logs service and verify the logs service cannot flush that foreign queue; release and flush the gateway queue, then verify the row becomes visible → AC-8
- [x] Insert with a timestamp in a year that has no partition child (for example 2031) via `withLogPartitionRecovery` → the child `partition.logging_2031` is created under an advisory lock and the retried insert lands → AC-3

## Value sourcing checks

- [x] Write a log at a UTC time between 17:00 and 23:59 on December 31: the row lands in the NEXT year's partition (Jakarta year, UTC+7), not the UTC year's → AC-3
- [x] Audit write without `currencyCode` → stored `currency_code` is 'IDR'; writeLog without channel/category → both stored as 'application'
- [x] Correlation columns (request_id, trace_id, session_id, ip_address, user_agent) stay NULL unless the caller supplies them; the logging layer never fills them
- [ ] Gateway access without a client request id uses the value from `requestIdPlugin`; trace id uses `x-correlation-id` or falls back to that request id → AC-10
- [ ] Gateway access stores only `URL.pathname`, keeps raw `x-forwarded-for` separate from the direct Bun connection IP, and never stores query values, cookies, or authorization → AC-10, AC-14
- [ ] A public or failed auth request has null actor fields; a verified session supplies actor id, email, and session id → AC-10, AC-12
- [ ] Status 200 and 302 map to `success`; status 400, 401, 403, and 500 map to `failure`; 401 maps to `authentication_required` and 403 to `permission_denied` → AC-10, AC-12
- [x] `page=abc`, `page=0`, and `page=-3` all return page 1
- [x] `/api/v1/auth/session` for a user granted `logs:log:read` carries that canonical permission; a user with no grants carries `permissions: []` and no response contains a role → AC-5
* [ ] Session access metadata stores only `schemaVersion`, duration, required permission, correlation source, client route, detail kind, state, reason, and permission count; role and extra internal result fields are absent → AC-16, AC-20
* [ ] `x-correlation-id=trace-456` is accepted, a value over 100 characters or with unsafe characters falls back to request id, and a missing value also falls back to request id → AC-18
* [ ] `x-client-route=/users?search=email#section` stores `/users`, while an invalid URL or value over 255 characters stores null → AC-18
* [ ] An authenticated session summary gets permission count from the same gateway access lookup used for the public permission array, not from auth or a client header; unauthenticated rows keep actor and session null → AC-16, AC-18

## Acceptance-criteria coverage

AC-1 is covered by best effort writer and Logger tests. AC-2 is covered by strict audit tests. AC-3 is covered by migration, partition boundary, and recovery checks. AC-4 is covered by pagination and gateway checks. AC-5 is covered by direct permission checks. AC-6 is covered by injection checks. AC-7 is covered by timestamp checks. AC-8 is covered by process isolation and shutdown drain checks. AC-9 is covered by existing viewer checks. AC-10 is covered by gateway access integration. AC-11 is covered by the `/users` E2E flow. AC-12 is covered by auth and denial events. AC-13 is covered by Logger persistence. AC-14 is covered by redaction checks. AC-15 is covered by API and viewer field checks. AC-16 is covered by typed session summary, source ownership, and invalid state tests. AC-17 is covered by Angular navigation and `/users` flow tests. AC-18 is covered by forged context tests. AC-19 is covered by logs projection, exact trace filtering, viewer, and E2E checks. AC-20 is covered by public response, compatibility, and allowlist tests.
