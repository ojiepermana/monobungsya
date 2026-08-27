# Verify: Audit Trail log subsystem

## UI and manual

* [x] Open `/logs/audit` as an authorized operator and confirm Audit Trail rows render.
* [x] Search and filter the list, then confirm the list returns to page 1.
* [x] Move through first, previous, next, and last page controls.
* [x] Open a user detail page and confirm only the Audit Trail tab is shown.
* [x] Open `/logs/access` and `/logs/application` and confirm they do not expose a viewer route.

## Commands

* [x] `bun run typecheck` passes.
* [x] `bun run lint` passes.
* [x] `bun test packages/logger/src apps/services/logs/src/tests/logs.test.ts` passes.
* [x] `bun run openapi:validate` passes.
* [x] `bun run progress:check` passes.
