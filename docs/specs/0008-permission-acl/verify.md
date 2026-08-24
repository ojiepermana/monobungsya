# Verify: permission access control · spec 0008 · updated 2026-08-24

_Steps derive from spec 0008 acceptance criteria. `/check verify` runs these; `/test` locks the durable cases._

## UI and infrastructure

- [ ] Sign in as the bootstrap operator, grant and revoke a permission, and confirm the change reaches gateway authorization within the cache window → AC-1, AC-2, AC-7, AC-8, AC-10
- [ ] Open permission catalog and user access surfaces, then exercise create, update, grant, revoke, and copy with the expected lockout guards → AC-7, AC-8, AC-14, AC-15
- [ ] Try every protected users, logs, access, and jobs route without its required permission and confirm the gateway and owning service both deny it → AC-3, AC-4, AC-5, AC-9, AC-11
- [ ] Stop the access service and confirm permission lookup fails closed with `503`, never cached allow behavior → AC-5, AC-6
- [ ] Inspect public session responses, signed identities, database columns, generated contracts, and the web UI and confirm no role remains → AC-9, AC-12, AC-13

## Commands

- [ ] `bun test packages/acl/src apps/services/access/src apps/gateway/erp/src apps/services/auth/src apps/services/user/src` → catalog, grants, cache, identity, and route enforcement tests pass → AC-1 to AC-16
- [ ] `bun run test:web` → navigation, guards, catalog, and user access panel tests pass → AC-9, AC-12, AC-14
- [ ] `bun run check:dependencies && bun run openapi:validate` → service boundaries and permission contracts remain valid → AC-4, AC-11, AC-16
- [ ] `bun run lint && bun run typecheck` → the role free implementation compiles and passes policy checks → AC-12, AC-13, AC-16
- [ ] Apply access migrations and seeds twice on PostgreSQL → catalog, grants, bootstrap permissions, and runtime grants are live and idempotent → AC-1, AC-2, AC-6

## Acceptance criteria coverage

AC-1 through AC-16 are covered by the permission lifecycle, fail closed, role removal, UI, database, and automated command checks. Live cache invalidation and service outage behavior remain manual infrastructure steps.
