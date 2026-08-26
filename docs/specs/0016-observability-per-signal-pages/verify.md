# Verify: observability pages per signal · spec 0016

_Steps derive from spec 0016 acceptance criteria. `/check verify` runs these; `/test` locks the durable cases._

## Commands

- [x] `bun run db:migrate --service access` twice, then inspect the permission rows and run the reversible `0038` down/up exercise → AC-1 (passed 2026-08-26; four signal permissions and grants were present, legacy permission absent)
- [x] `bun run db:migrate --service logs` twice and inspect `telemetry_benchmark_baselines_promoted_cursor_idx` → AC-3 (passed 2026-08-26; index present and rerun idempotent)
- [x] `bun run typecheck:acl && bun run typecheck:access && bun run typecheck:logs && bun run typecheck:gateway && bun run typecheck:web` → AC-2, AC-4, AC-7, AC-19 (all five passed 2026-08-26)
- [x] `bun run openapi:generate && bun run openapi:validate` → AC-4, AC-5, AC-6, AC-19 (generation and validation passed 2026-08-26)
- [x] `bun run test` plus focused observability suites → AC-1, AC-2, AC-4, AC-5, AC-6, AC-12, AC-18 (281 backend/package tests passed; observability service file passed 11/11)
- [x] `bun run test:web -- --include src/app/pages/observability/observability.utils.test.ts --include src/app/shell/app.nav.test.ts` → AC-7 through AC-18 and AC-20 (targeted observability/nav tests passed 11/11; the broader suite was also run and has three pre-existing `access/groups` failures outside this feature)
- [x] `bunx playwright test e2e/observability.spec.ts --project=chromium` → AC-7, AC-8, AC-9, AC-10, AC-11, AC-19, AC-20 (4 tests passed 2026-08-26; authorized nine-route matrix, staff redirect, and AXE serious/critical sweep)
- [x] `bun run lint` and `bun run openapi:validate` → repository formatting and generated contract gates (both passed 2026-08-26)
- [x] `bun run progress:generate && bun run progress:check` → workflow evidence remains synchronized

## API and data behavior

- [x] An alert-only signed identity receives `200` from `/internal/observability/alerts` and `403` from `/internal/observability/traces`; ingestion remains unauthenticated internally → AC-4, AC-18
- [x] First list responses expose `prevCursor: null`; cursor SQL uses explicit next/previous directions, and a missing cursor boundary returns `422` → AC-5, AC-12
- [x] Each list endpoint returns dynamic options from the same filter window, while fixed enums remain in the UI → AC-6
- [x] Trace and metric windows default to 24 hours, quick presets are 15m/1h/6h/24h, and a range over 24 hours is rejected before the request → AC-13
- [x] Healthy empty storage renders an empty state, while unavailable telemetry renders a distinct blind-spot warning on each list/detail surface → AC-17

## UI and browser behavior

- [x] An authorized operator can open `/observability`, the four list pages, and the three detail pages; each detail route uses the same signal permission as its list route → AC-7
- [x] Navigation is flat under Observability, hides each item without its permission, places Baselines under benchmark permission, and hides the group when empty → AC-8
- [x] Every list page uses the shared PageHeader/Filter/Content/Footer scaffold; filters are hidden initially and Clear Filters is disabled with no active filter → AC-9
- [x] Cursor list footers show only Previous/Next and the current page row count; Metrics shows coverage without pagination; Overview shows only the latest loaded time → AC-10, AC-16
- [x] Filter and cursor state survives reload through the query string and a same-permission session can open the copied URL → AC-11
- [x] Expired cursor links show one expired-link message, remove only the cursor, preserve filters, and reload the first page → AC-12
- [x] Trace detail renders time-scaled bars, parent depth, orphan depth zero, and a partial-tree marker; an expired trace shows a 404/retention message → AC-14
- [x] Metrics uses `@ojiepermana/angular/chart/line`, renders one series per selected group, breaks over missing buckets, shows gray unavailable bands, and provides a text equivalent without treating missing data as zero → AC-15, AC-20
- [x] Overview requests only permissions owned by the session and renders error-trace, firing-alert, metric-coverage, and latest-benchmark summaries only for those signals → AC-16

## Acceptance criteria coverage

AC-1 through AC-20 are covered by the database, service/gateway, generated-contract, Angular, browser, and accessibility checks above. Runtime evidence is recorded here as each check is completed; no criterion is marked verified without observable evidence.

## Evidence

Verified 2026-08-26. Database migrations were applied idempotently and exercised down/up. Typechecks, OpenAPI generation/validation, lint, and the backend test gate passed. The browser matrix reached all nine authorized routes and confirmed the staff redirect; the same run applied AXE to every route and found no serious or critical violations. The focused Angular observability/nav suite passed 11/11. The repository-wide Angular suite has three unrelated failures in the pre-existing permission-group pages; they are retained as a known repository gate and are not part of this feature's changed surface.
