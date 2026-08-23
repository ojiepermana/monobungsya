# Verify: Log subsystem · spec logs/0001 · updated 2026-08-23

_Steps derived from spec logs/0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Login as an admin or manager, open `/logs/audit`, `/logs/access`, and `/logs/application`: each page renders a table with a search box, dropdown filters, a Clear Filters button, and First/Previous/Next/Last paging → AC-9
- [x] Login as a staff or bi user: the Logs section is absent from the navigation and visiting `/logs/audit` redirects away → AC-5
- [x] On any log page, type in the search box or pick a dropdown value: the list reloads on page 1; press Clear Filters: all filters empty and page returns to 1 → AC-9
- [x] With more than 25 matching rows, walk First → Next → Last: the label reads `Page X of Y · N records` and the buttons disable at each end → AC-4, AC-9
- [x] Timestamps on all three pages render as Indonesian medium date plus short time (Intl id-ID) derived from ISO 8601 UTC strings ending in `Z` → AC-7
- [ ] Open `/users`, then open Log Akses: one `GET /api/v1/users` row shows the verified actor, success, status 200, route, request id, and access time → AC-10, AC-11, AC-15
- [ ] Search, filter, or change page on `/users`: each backend request adds one access row, while client navigation itself adds no `page_view` row → AC-10, AC-11
- [ ] Log Akses displays and can search route name, path, method, status, request id, actor email, outcome, and failure reason → AC-15

## Commands

- [x] `bun run db:migrate` on a fresh database → all 10 migrations apply; `logs.logging`, `logs.audit_trails`, `logs.access_logs` are partitioned parents with composite PKs `(id, <time column>)` and children `partition.<table>_<YYYY>` exist for the current and next Jakarta year → AC-3, AC-7
- [x] `bun test packages/logger/src` → jakartaYear('2025-12-31T16:59:59.999Z') = 2025, jakartaYear('2025-12-31T17:00:00.000Z') = 2026, jakartaYearBoundaryUtc(2026) = '2025-12-31 17:00:00'; only SQLSTATE 23514 plus a "no partition" message counts as a missing partition; a failed writeLog logs to console and never throws; a failed writeAudit throws → AC-1, AC-2, AC-3
- [x] `bun test apps/services/logs/src` → search input "login' OR 1=1 --" never appears in SQL text (parameter bound, `%`/`_` escaped); 26 rows with page=2 yields meta { page: 2, perPage: 25, total: 26, totalPages: 2 }; snake_case maps to camelCase with jsonb parsed; distinct options per filter column; 401 unsigned, 403 staff, 200 admin and manager → AC-4, AC-5, AC-6
- [x] `bun test apps/gateway/erp/src` → `/api/v1/logs/*` without a session returns 401; with a valid session the gateway forwards to the logs service with a verifiable signed identity and intact query params → AC-4, AC-5
- [ ] `bun test packages/logger/src` → `Logger` writes the same sanitized event to console and `logs.logging`, maps `warn` to `warning`, extracts an `Error`, and never throws when the best effort database write fails → AC-1, AC-13, AC-14
- [ ] `bun test apps/gateway/erp/src` → each non OPTIONS `/api/v1` response produces one access row with the final status; 401 and 403 receive their security event names; internal service calls and health routes produce none → AC-10, AC-12, AC-14
- [ ] `bun test apps/services/auth/src` → magic link and passkey success or failure plus logout produce correlated access events without storing tokens or credential responses → AC-12, AC-14
- [ ] `bun test apps/services/logs/src` → access mapping and search include route name, path, method, status, request id, actor email, outcome, and failure reason; the read service does not claim to drain another process queue → AC-8, AC-15
- [ ] `bun run test:web` → the access pages render the extended fields, and the `/users` page still issues one initial users request → AC-11, AC-15
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
- [x] `/api/v1/auth/session` for an admin or manager carries `permissions: ["users.manage", "logs.read"]`; for staff, bi, and legacy it carries `[]` → AC-5

## Acceptance-criteria coverage

- AC-1 covered by best effort writer and Logger tests · AC-2 by strict audit tests · AC-3 by migration, partition boundary, and recovery checks · AC-4 by pagination and gateway checks · AC-5 by role checks · AC-6 by injection checks · AC-7 by timestamp checks · AC-8 by process isolation and shutdown drain checks · AC-9 by existing viewer checks · AC-10 by gateway access integration · AC-11 by the `/users` E2E flow · AC-12 by auth and denial events · AC-13 by Logger persistence · AC-14 by redaction checks · AC-15 by API and viewer field checks
