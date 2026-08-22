# Verify: Log subsystem · spec logs/0001 · updated 2026-08-22

_Steps derived from spec logs/0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Login as an admin or manager, open `/logs/audit`, `/logs/access`, and `/logs/application`: each page renders a table with a search box, dropdown filters, a Clear Filters button, and First/Previous/Next/Last paging → AC-9
- [x] Login as a staff or bi user: the Logs section is absent from the navigation and visiting `/logs/audit` redirects away → AC-5
- [x] On any log page, type in the search box or pick a dropdown value: the list reloads on page 1; press Clear Filters: all filters empty and page returns to 1 → AC-9
- [x] With more than 25 matching rows, walk First → Next → Last: the label reads `Page X of Y · N records` and the buttons disable at each end → AC-4, AC-9
- [x] Timestamps on all three pages render as Indonesian medium date plus short time (Intl id-ID) derived from ISO 8601 UTC strings ending in `Z` → AC-7

## Commands

- [x] `bun run db:migrate` on a fresh database → all 10 migrations apply; `logs.logging`, `logs.audit_trails`, `logs.access_logs` are partitioned parents with composite PKs `(id, <time column>)` and children `partition.<table>_<YYYY>` exist for the current and next Jakarta year → AC-3, AC-7
- [x] `bun test packages/logger/src` → jakartaYear('2025-12-31T16:59:59.999Z') = 2025, jakartaYear('2025-12-31T17:00:00.000Z') = 2026, jakartaYearBoundaryUtc(2026) = '2025-12-31 17:00:00'; only SQLSTATE 23514 plus a "no partition" message counts as a missing partition; a failed writeLog logs to console and never throws; a failed writeAudit throws → AC-1, AC-2, AC-3
- [x] `bun test apps/services/logs/src` → search input "login' OR 1=1 --" never appears in SQL text (parameter bound, `%`/`_` escaped); 26 rows with page=2 yields meta { page: 2, perPage: 25, total: 26, totalPages: 2 }; snake_case maps to camelCase with jsonb parsed; distinct options per filter column; 401 unsigned, 403 staff, 200 admin and manager → AC-4, AC-5, AC-6
- [x] `bun test apps/gateway/erp/src` → `/api/v1/logs/*` without a session returns 401; with a valid session the gateway forwards to the logs service with a verifiable signed identity and intact query params → AC-4, AC-5
- [x] Insert a row with `ActivityLog.writeLog`, call `/api/v1/logs/application-logs` immediately → the row is visible (flush before read) and `occurredAt` ends with `Z` → AC-7, AC-8
- [x] Insert with a timestamp in a year that has no partition child (for example 2031) via `withLogPartitionRecovery` → the child `partition.logging_2031` is created under an advisory lock and the retried insert lands → AC-3

## Value sourcing checks

- [x] Write a log at a UTC time between 17:00 and 23:59 on December 31: the row lands in the NEXT year's partition (Jakarta year, UTC+7), not the UTC year's → AC-3
- [x] Audit write without `currencyCode` → stored `currency_code` is 'IDR'; writeLog without channel/category → both stored as 'application'
- [x] Correlation columns (request_id, trace_id, session_id, ip_address, user_agent) stay NULL unless the caller supplies them; the logging layer never fills them
- [x] `page=abc`, `page=0`, and `page=-3` all return page 1
- [x] `/api/v1/auth/session` for an admin or manager carries `permissions: ["users.manage", "logs.read"]`; for staff, bi, and legacy it carries `[]` → AC-5

## Acceptance-criteria coverage

- AC-1 covered by the logger tests (failed writeLog never throws) · AC-2 by the logger tests (failed writeAudit throws) · AC-3 by the migration step, the partition boundary tests, and the recovery step · AC-4 by the pagination and gateway steps · AC-5 by the role steps (UI, service 401/403, session permissions) · AC-6 by the injection test · AC-7 by the timestamp steps · AC-8 by the flush before read step · AC-9 by the UI steps
