# Verify: Permission group grant templates · spec 0015

## Commands

- [x] `bun run db:migrate` applies migration `0037` and remains idempotent on a second run → AC-1
- [x] `bun run db:migrate:down` removes the group tables and `bun run db:migrate` restores them without orphan rows → AC-1
- [x] `bun run typecheck:acl && bun run typecheck:access && bun run typecheck:gateway && bun run typecheck:web` passes → AC-2, AC-11, AC-16
- [x] `bun run openapi:generate && bun run openapi:validate` passes and generated SDK contains every group endpoint → AC-16
- [x] `bun run check:dependencies && bun run lint` passes with no new dependency or formatting error → AC-16
- [x] `bun run progress:generate && bun run progress:check` passes with no workflow drift → AC-16

## API and data behavior

- [x] Catalog contains all eleven group and group permission names with descriptions, and rerunning the migration updates descriptions without duplicates → AC-2
- [x] Creating the same normalized name twice returns `409`, including when the existing row is soft deleted → AC-3
- [x] Group list supports pagination, name and description search, active or off status, deleted filters, and reports permission counts and deleted timestamps → AC-4
- [x] Group create, update, soft delete, restore, and state guards return the specified records and reasons → AC-4
- [x] Attaching known permissions is idempotent with `attached` and `skipped`, unknown IDs return `404`, empty input returns `422`, detach works, and deleting a group cascades its relations → AC-5
- [x] Applying an off, deleted, or empty group returns the specified `409` or `422`, and list filtering excludes it from applicable pickers → AC-6
- [x] Single user apply is additive, skips existing direct grants, and returns granted and skipped permission IDs → AC-7
- [x] Bulk apply accepts at most fifty users, returns per user applied and failed entries, and one failed user does not abort other users → AC-8
- [x] Existing permission lookup and cache behavior do not query group tables, and one `access.permission.changed` event is published per affected user → AC-9
- [x] Group mutations and applies create awaited audit rows with group context and actually granted permission names → AC-10
- [x] Gateway and service endpoints return `403` when the required group or group permission permission is absent → AC-11

## UI and routes

- [x] A user with `access:group:list` sees the group navigation item and list route, while a user without it does not → AC-12, AC-15
- [x] Group list renders loading, error, and empty states separately, has hidden filters, create action, required columns, and pagination → AC-12
- [x] Group detail route requires `access:group:read`, renders profile edit and lifecycle controls, and shows attached permissions with attach and detach controls → AC-13, AC-15
- [x] Bulk user picker uses `/api/v1/users`, is disabled without `user:user:list`, and reports applied and failed user counts → AC-13
- [x] User detail access panel offers only active, live, nonempty groups beside copy grants and reports granted and skipped counts after apply → AC-14

## Automated test evidence

- [x] `bun run test` passes with 280 backend and package tests.
- [x] `bun run test:web` passes with 136 Angular tests.
- [x] `bunx playwright test e2e/permission-groups.spec.ts` passes with four browser tests.
- [x] `bun run verify:web:standard` and `bun run verify:web:a11y` pass, with zero accessibility violations on the checked auth routes.

## Evidence

- Runtime database evidence covered migration idempotence, rollback, seed bootstrap, catalog count, grants, and cleanup.
- Runtime HTTP evidence covered service and gateway routes, authorization failures, CRUD, lifecycle guards, attachment idempotence, single apply, bulk success, bulk partial failure, lookup, events, and audit rows.
- Browser evidence was captured at `/tmp/monobungsia-permission-groups-list.png`, `/tmp/monobungsia-permission-group-detail.png`, `/tmp/monobungsia-permission-groups-empty.png`, `/tmp/monobungsia-permission-groups-error.png`, and `/tmp/monobungsia-user-access-group.png`.

## Acceptance criteria coverage

- AC-1 migration and rollback
- AC-2 catalog and ACL constants
- AC-3 normalized unique names
- AC-4 group CRUD and lifecycle
- AC-5 permission attachment
- AC-6 applicable group rules
- AC-7 single user apply
- AC-8 bulk apply
- AC-9 unchanged authorization lookup and events
- AC-10 audit coverage
- AC-11 authorization at service and gateway
- AC-12 group list page
- AC-13 group detail page and bulk picker
- AC-14 user detail apply control
- AC-15 route and navigation gates
- AC-16 generated artifacts and repository checks
