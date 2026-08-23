# 0008. Permission first access control without roles

**Date**: 2026-08-23
**Status**: Proposed

## Summary

Otorisasi di seluruh sistem pindah dari role global ke daftar permission per user (ACL murni). Sebuah service baru bernama access menjadi sumber kebenaran tunggal untuk katalog permission dan grant per user, gateway memeriksa permission pada setiap request terproteksi, dan konsep role dihapus total dari domain user, auth, dan web. Admin mengelola katalog dan grant lewat halaman Angular baru, dengan multi select dan aksi salin grant dari user lain supaya operasional tetap ringan.

## Requirements

**User stories**:

- As an admin, I want to grant and revoke named permissions per user so that access follows each person's real job, not a coarse role.
- As an admin, I want to manage the permission catalog and see who holds what so that access stays auditable.
- As a service owner, I want every request checked against permission names at the gateway and again at my service so that a bypass of one layer never grants access.
- As a user, I want my session to carry my effective permissions so that the web app shows only what I can do.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: `packages/acl` exports the typed permission constant catalog and the helpers `normalizePermissions`, `managePermissionFor`, `hasResolvedPermission`, `hasAnyRequiredPermission`. Unit tests prove trim, empty drop, order preserving dedupe, and that `user:user:manage` satisfies a requirement of `user:user:create` while a permission on another resource does not.
- **AC-2**: Migrations create `access.permission` and `access.permission_user` exactly per the data model below, with up and down files in `packages/database/migrations/access`; running `bun run db:migrate` twice in a row succeeds.
- **AC-3**: A `user` schema migration drops the `role` column and its CHECK constraint; the down migration restores the column with its previous default. After cutover no gateway, service, or web code reads or writes a role anywhere.
- **AC-4**: Seeds insert the base permission catalog idempotently (upsert on `code`); running `bun run db:seed` twice leaves identical rows with no duplicates.
- **AC-5**: The bootstrap seed grants the full catalog to every user whose email is listed in `ACCESS_BOOTSTRAP_ADMIN_EMAILS`; a listed email with no matching user row logs a clear warning and the seed continues.
- **AC-6**: The access service exposes an internal lookup returning the sorted, distinct permission names granted to a user id; a user with no grants, or an unknown id, returns an empty list.
- **AC-7**: The gateway exposes `/api/v1/access/*` routes for the permission catalog and per user grants, each protected by its own `access:*` permission, with pagination and search on list endpoints. Duplicate catalog names or codes return 409 CONFLICT; duplicate grants in a multi grant request are skipped idempotently and reported, not errored.
- **AC-8**: The access service refuses to delete catalog rows in the `access` namespace and refuses to revoke the caller's own grants in the `access` namespace (self lockout guard), both with 403 FORBIDDEN.
- **AC-9**: For every protected request the gateway resolves the session, loads effective permissions through its TTL cache, authorizes with `hasAnyRequiredPermission`, and forwards the extended HMAC identity header. No valid session returns 401 UNAUTHORIZED; a missing permission returns 403 FORBIDDEN with reason `insufficient_permissions`; a lookup failure returns 503 SERVICE_UNAVAILABLE with reason `permission_lookup_failed` and never allows the request through (fail closed).
- **AC-10**: The access service publishes an `access.permission.changed` event on every grant, revoke, and catalog mutation. The gateway subscription invalidates the affected user's cache entry, or the whole cache for catalog wide changes. With NATS down, entries still expire by TTL and requests keep working.
- **AC-11**: Downstream services (user, logs, access) verify the extended identity header signature, which now covers the permission list, and independently enforce their own route permissions. A request whose header lacks the required permission is rejected with 403 even when it reaches the service directly.
- **AC-12**: `GET /api/v1/auth/session` returns the user's effective permissions, filled by the gateway from the same lookup path, and no longer returns a role. The web `AuthUser` model, guards, and navigation gate on permission names imported from `packages/acl`.
- **AC-13**: Every previously protected gateway route (users, logs) now requires the matching new permission; the capability enum, `canAccessAuthCapability`, and `permissionsForRole` are deleted from the codebase.
- **AC-14**: The web app has permission catalog pages (list with search, create, edit description, delete with cascade warning) and the user detail page has an access tab with multi select granting grouped by namespace, revoking, and a copy grants from another user action; all gated by `access:*` permissions.
- **AC-15**: Every catalog mutation, grant, and revoke writes an awaited audit trail via `ActivityLog.writeAudit`, and the access service implements the full mandatory logging contract (request id plugin, logger plugin, error handler, redaction, best effort application logs, flush on shutdown).
- **AC-16**: OpenAPI specs and the Angular SDK are regenerated and committed; `bun run check:dependencies`, `bun run lint`, and `bun run typecheck` pass; every new env var is documented in `.env.example`.

## Decision

**Chosen option**: Option 2: Pure per user ACL on the existing transport, owned by a new access service.

Build `apps/services/access` (port 3104, schema `access`) as the single source of truth for a seeded permission catalog and direct per user grants, enforce permission names at the gateway on every protected route and again inside each service through the extended HMAC identity header, and remove the role concept from the entire system. The brief's NATS request-reply transport, JWT actor tokens, and role tables are deliberately not adopted; the repo's HTTP proxy, HMAC identity header, and NATS event patterns are reused instead.

**Implementation skills**: `elysiajs` (installed Claude Code skill, backend framework conventions) · `angular-developer` (installed Claude Code skill, web pages and guards)

## Rationale

Reasoning, options weighed, and the engineer's consciously accepted tradeoffs: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (canonical migrations in `packages/database/migrations/access`, primary keys `uuid` with native `uuidv7()` default, timestamps `timestamptz` defaulting to `now()`):

| Table | Column | Notes |
|---|---|---|
| `access.permission` | `id` uuid PK | |
| | `name` varchar(100) UNIQUE NOT NULL | canonical string, `namespace:resource:action[:scope]` |
| | `code` varchar(100) UNIQUE NOT NULL | derived SCREAMING_SNAKE, `USER_USER_UPDATE` |
| | `namespace` varchar(50) NOT NULL | first segment |
| | `resource` varchar(50) NOT NULL | second segment |
| | `action` varchar(50) NOT NULL | third segment |
| | `scope` varchar(50) NULL | optional fourth segment |
| | `description` text NULL | |
| | `created_at`, `updated_at` timestamptz NOT NULL | |
| `access.permission_user` | `id` uuid PK | one row per direct grant |
| | `permission_id` uuid NOT NULL FK to `access.permission(id)` ON DELETE CASCADE | |
| | `user_id` uuid NOT NULL, no FK | users live in the user domain; integrity is application level by engineer decision |
| | `created_at` timestamptz NOT NULL | the granting actor lives in the audit trail, not here |
| | UNIQUE(`permission_id`, `user_id`), indexes on `user_id` and on `permission_id` | |

Plus one migration in the `user` schema: drop `user.users.role` and its CHECK constraint (down migration restores the column with its previous default `bi`; historical values are only recoverable from database backups).

**Seeded permission catalog** (constants live once in `packages/acl`, seeds live in `packages/database/seeds`, upsert on `code`):

| Namespace | Resource | Actions |
|---|---|---|
| `user` | `user` | `list`, `read`, `create`, `update`, `suspend`, `block`, `delete`, `restore`, `manage` |
| `logs` | `log` | `read` |
| `access` | `permission` | `list`, `read`, `create`, `update`, `delete`, `manage` |
| `access` | `permission_user` | `list`, `create`, `delete`, `manage` |

The manage wildcard rule: holding `namespace:resource:manage` satisfies any required permission on that same `namespace:resource`, resolved by `managePermissionFor` in `packages/acl`. Scoped variants (`:own`, `:scoped`) are deliberately not seeded yet; no self service surface exists to use them (see Follow-up).

**API surface** (public routes proxied by the gateway to the access service; every route also independently re checked inside the access service via the identity header):

| Endpoint | Method | Key inputs | Key outputs | Required permission | Key errors |
|---|---|---|---|---|---|
| `/api/v1/access/permissions` | GET | `page`, `pageSize`, `search`, `namespace` | paged catalog rows | `access:permission:list` | 401, 403 |
| `/api/v1/access/permissions` | POST | `name`, `description` | created row (code and segments derived) | `access:permission:create` | 409 duplicate, 422 bad name format |
| `/api/v1/access/permissions/:id` | GET | id | catalog row plus grant count | `access:permission:read` | 404 |
| `/api/v1/access/permissions/:id` | PUT | `description` only | updated row | `access:permission:update` | 404, 422 if name or code in payload |
| `/api/v1/access/permissions/:id` | DELETE | id | none | `access:permission:delete` | 404, 403 for `access` namespace rows |
| `/api/v1/access/users/:userId/permissions` | GET | userId | that user's grants with permission details | `access:permission_user:list` | 401, 403 |
| `/api/v1/access/users/:userId/permissions` | POST | `permissionIds: uuid[]` | `{ granted: [], skipped: [] }` | `access:permission_user:create` | 404 unknown permission id, 422 empty list |
| `/api/v1/access/users/:userId/permissions/copy` | POST | `sourceUserId` | `{ granted: [], skipped: [] }` | `access:permission_user:create` | 404, 422 copy from self |
| `/api/v1/access/users/:userId/permissions/:permissionId` | DELETE | ids | none | `access:permission_user:delete` | 404, 403 self lockout |
| `GET /internal/access/permissions/lookup?userId=` | GET | userId | `{ permissions: string[] }` sorted distinct | internal only, called by the gateway, never proxied | 422 bad uuid |
| `/api/v1/auth/session` | GET | session cookie | existing session payload, now with gateway filled `permissions: string[]` and no `role` | authenticated session | 401 |

**Identity header contract** (replaces the role bearing shape from spec 0003, defined once in `packages/contracts`):

- Headers: `x-auth-user-id`, `x-auth-email`, `x-auth-permissions` (comma joined canonical names), `x-auth-expires-at`, `x-auth-signature`. `x-auth-role` is removed.
- HMAC-SHA-256 canonical input: `METHOD\nPATH\nuserId\nsha256(permissionsCsv)\nexpiresAt`, signed with `INTERNAL_AUTH_SIGNING_SECRET`. Hashing the permission list keeps the canonical string bounded while the header still carries the full list; services recompute the hash from the header during verification, so a tampered list fails the signature.
- Each service's `shared/plugins/auth-identity.plugin.ts` verifies the signature, applies `normalizePermissions`, and exposes a `requirePermissions(...names)` guard used per route (defence in depth).

**Value sourcing** (every value an action must produce names its source):

| Action | Value produced or displayed | Source |
|---|---|---|
| Authorize a request | effective permission list | internal lookup: `access.permission_user` joined to `access.permission`, through the gateway TTL cache |
| Authorize a request | required permissions for the route | declarative gateway route table importing constants from `packages/acl` |
| Forward to a service | permission list and its hash in the header | the lookup result attached to the request context |
| Session response | `permissions` array for the web | same gateway lookup path, same cache |
| Create catalog row | `code`, `namespace`, `resource`, `action`, `scope` | derived by splitting and uppercasing `name`, validated against the name regex |
| Bootstrap seed | user ids to grant | `ACCESS_BOOTSTRAP_ADMIN_EMAILS` env, resolved by the seed script querying `user.users` by email (central seed tooling may cross schemas; services may not) |
| Copy grants | permission ids to copy | source user's `access.permission_user` rows |
| Cache invalidation | which cache key to drop | `access.permission.changed` event payload `{ userId?: string }`; absent userId means catalog wide, drop all |
| Audit rows | acting admin identity | verified identity header on the access service request |
| UI catalog and grant screens | rows, grant counts, paging | the `/api/v1/access/*` endpoints above via the regenerated Angular SDK |

**Key invariants**:

- Every authorization decision tests permission names; no code path branches on a role. The words role and capability disappear from gateway, services, contracts, and web types.
- `name` matches `^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*){2,3}$`; `code` and the segment columns are always derived from `name`; `name`, `code`, and segments are immutable after creation (only `description` updates; renaming means delete then create).
- Grant uniqueness is `(permission_id, user_id)`; grant writes are idempotent (`ON CONFLICT DO NOTHING`) and report granted versus skipped.
- Fail closed everywhere: a permission lookup error, an unverifiable identity header, or an empty permission list on a protected route always denies.
- Catalog rows in the `access` namespace cannot be deleted, and an actor cannot revoke their own `access` namespace grants.
- All SQL is parameter bound; list filtering and sorting go through field whitelists in the repository (existing repo rule).
- The gateway logs a warning when the permissions header exceeds 4KB (roughly 150 grants for one user; far above the seeded catalog size, but pure ACL can grow).

**Security model**:

- Only holders of `access:*` permissions may read or mutate the catalog and grants; the initial holders come exclusively from the bootstrap seed env. Everyone else starts with zero permissions after cutover, by engineer decision.
- The gateway is the only public entry; services keep verifying the signed identity header and their own route permissions independently, so a request that skips the gateway check still fails at the service.
- Auth endpoints (login, verify, session, logout, passkey ceremonies) stay session scoped and require no catalog permission.
- Every access mutation is audited with the acting admin, target user, and permission name; log writes never persist tokens, cookies, or secrets (existing logging contract).

**Configuration required**:

- `ACCESS_SERVICE_PORT`: access service listen port, default 3104
- `ACCESS_SERVICE_URL`: gateway side base URL for the access service, default `http://localhost:3104`
- `ACCESS_BOOTSTRAP_ADMIN_EMAILS`: comma separated emails granted the full catalog by the bootstrap seed
- `GATEWAY_PERMISSION_CACHE_TTL_MS`: gateway lookup cache TTL, default 60000
- `GATEWAY_PERMISSION_CACHE_MAX_ENTRIES`: gateway cache bound, default 1000
- `ACCESS_PERMISSION_CACHE_TTL_MS`: access service internal lookup cache TTL, default 300000
- `ACCESS_PERMISSION_CACHE_MAX_ENTRIES`: access service cache bound, default 1000
- Reused, not new: `INTERNAL_AUTH_SIGNING_SECRET`, `NATS_URL`, `DATABASE_URL`, `LOG_DATABASE_URL`, `LOG_LEVEL`, `BEST_EFFORT_LOGGING_ENABLED`, `LOG_FLUSH_TIMEOUT_MS`, `ENABLE_INFRASTRUCTURE`

**Critical test scenarios** (each maps to an acceptance criterion):

- Happy path: bootstrap admin lists users through the gateway, the header carries permissions, the user service accepts, verifies **AC-5**, **AC-9**, **AC-11**
- Manage wildcard: a user granted only `user:user:manage` passes a route requiring `user:user:create`, verifies **AC-1**, **AC-9**
- Denied: a user with zero grants receives 403 with reason `insufficient_permissions` on every protected route, and 200 on `/api/v1/auth/session`, verifies **AC-9**, **AC-12**
- Fail closed: access service down makes protected routes return 503 `permission_lookup_failed`, never 200, verifies **AC-9**
- Tampered header: a permission appended to `x-auth-permissions` without re signing is rejected 401 by the service, verifies **AC-11**
- Invalidation: revoking a grant emits the event and the next request within the old TTL window is denied, verifies **AC-10**
- Self lockout: an admin revoking their own `access:permission_user:delete` grant receives 403, verifies **AC-8**
- Idempotence: migrate twice, seed twice, identical state, verifies **AC-2**, **AC-4**
- Multi grant: posting a list containing an already granted id reports it skipped and grants the rest, verifies **AC-7**
- Copy grants: copying from a source user grants exactly the missing subset, verifies **AC-7**, **AC-14**
- Role removal: `GET /api/v1/auth/session` payload contains no role key, and grep proves no role reads remain, verifies **AC-3**, **AC-12**, **AC-13**
- Audit: each grant, revoke, and catalog mutation produces one audit row with the acting admin, verifies **AC-15**

## Build plan

Tracer Bullet: slice 1 threads one request end to end through every new layer (package, schema, seed, service, gateway, downstream check), later slices thicken.

1. **Thin thread**: create `packages/acl` (constants, helpers, unit tests); access schema migrations and catalog plus bootstrap seeds; access service skeleton per the repo service shape (composition root, `createApp`, env validation, full logging contract, Dockerfile) exposing only the internal lookup; gateway resolves permissions through a new TTL cache and authorizes one migrated route, `GET /api/v1/users`, forwarding the extended identity header; the user service plugin verifies the new header shape for that route. Proof: bootstrap admin lists users, an ungranted user gets 403, access service down gives 503. Satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-6**, and threads **AC-9**, **AC-11**.
2. **Full cutover**: declarative gateway route table mapping every users and logs route to its permission constant; session response enrichment; delete the capability enum, `canAccessAuthCapability`, and `permissionsForRole`; auth service returns identity and session state only; `user` schema migration drops the role column; user service, auth service, and web stop reading or writing role (create user dialog loses the role field, guards and navigation move to `packages/acl` names). Satisfies **AC-3**, **AC-9**, **AC-11**, **AC-12**, **AC-13**.
3. **Admin API**: access service catalog CRUD and grant endpoints with derived code and segments, immutability rules, idempotent multi grant, copy action, protected namespace and self lockout guards, awaited audit writes, `access.permission.changed` publication, the access service internal cache, and the gateway invalidation subscription. Satisfies **AC-7**, **AC-8**, **AC-10**, **AC-15**.
4. **Admin UI**: Angular catalog pages and the user detail access tab (multi select grouped by namespace, revoke, copy from user), navigation gating, using the regenerated SDK. Satisfies **AC-14**.
5. **Proof and artifacts**: the critical test scenarios above across packages and services, OpenAPI and SDK regeneration committed, `.env.example` updates, dependency check, lint, typecheck. Satisfies **AC-16** and the test halves of the rest.

## Migration plan

**Strategy**: staged cutover in slices; slice 1 is additive and reversible, slice 2 is the point of no easy return.

**Phases**:
1. Additive (build plan slice 1): new schema, package, service, and one migrated route; every other route still uses the old capability checks; the role column is untouched. Both mechanisms briefly coexist by design.
2. Cutover (slice 2): all routes on permissions, role column dropped, old authorization code deleted. Gateway and services must deploy together since the header signature changes shape; this is one repo and one deploy unit, so that is a normal release, not a coordination project.
3. Management surfaces (slices 3 and 4): admin API, events, cache invalidation, UI.

**Rollback**: phase 1 reverts by commit revert plus `bun run db:migrate:down` for the access schema. Phase 2 reverts code by revert and restores the role column by down migration, but the historical role values themselves come back only from a database backup; take one immediately before running phase 2 in any real environment.

**Risks**: every non bootstrap user is locked out of protected routes after phase 2 until an admin grants them access (an accepted, engineer chosen tradeoff; the bootstrap admin should grant the team promptly); role values are unrecoverable post drop without a backup; a stale gateway cache can honor a revoked grant for up to the TTL if NATS is down (bounded at 60 seconds by default).

## Consequences

**Positive**:

- Access decisions become data, changeable per user at runtime with a full audit trail, instead of five hardcoded role enums spread across gateway, services, and web.
- Defence in depth gets real teeth: services verify a signed permission list instead of trusting a role string, and re check per route.
- The access domain is a clean, extractable service with its own schema, matching the repo's ownership rules, and future namespaces (employee, payroll) only add catalog rows and route entries.

**Negative / tradeoffs**:

- Pure ACL without grouping means onboarding a user is a manual multi grant every time; multi select and copy from user soften this, but at larger user counts this is real toil (the engineer chose this consciously; revisit grouping if it hurts).
- Full catalog CRUD in the UI can drift from the constants in `packages/acl`: a permission created in the UI does nothing until code references it, and one deleted while code still requires it silently locks that route for everyone. Seeds re create the base catalog, and the `access` namespace is delete protected, but drift outside that namespace is accepted.
- Starting empty locks out every existing user at cutover until granted; there is a deliberate operational window where only bootstrap admins can work.
- Every protected request now depends on the access service being reachable (softened by the gateway cache, hard failure is 503 by design).
- No FK on `permission_user.user_id` means orphan grants are possible if user rows ever disappear; acceptable today because users are never hard deleted (spec 0007).

**Neutral**:

- Spec 0003's role authorization criterion and spec 0007's role editing UI are superseded in behavior by this spec; `/sync` should reconcile their text after the build.
- The identity header, `packages/contracts` types, OpenAPI specs, and the Angular SDK all change shape in one release.
- A fourth backend service joins the dev, test, and deploy lineup, with the standard logging, Dockerfile, and env obligations.

## Follow-up

- [ ] Seed scoped permission variants (`:own`, `:scoped`) and downstream ownership rules when the first self service surface (own profile editing, scoped listing) is designed; they are deliberately absent now.
- [ ] Revisit permission grouping (bundles) if per user granting becomes painful as the user count grows; the schema extends cleanly with a group table pair.
- [ ] Consider a periodic orphan grant sweep (grants whose user id no longer resolves) if user hard deletion is ever introduced.
- [ ] `/sync` after the build: update spec 0003 (role authorization superseded) and spec 0007 (role field removed from user UI), and reconcile the scope.
- [ ] The repo has no root `AGENTS.md`; the permission naming convention and the manage wildcard rule should be recorded in project context (CLAUDE.md or a future AGENTS.md) once built.
