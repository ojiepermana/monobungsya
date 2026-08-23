# 0008. Permission first access control without roles — decision record

Build spec: [index.md](index.md). This file holds the reasoning; builds never need it.

## Context

> ⚠️ Premise note: three engineer choices in this design go against the default recommendation and are accepted consciously. (1) Pure ACL without any grouping is a known operational pain once user counts grow; the recommendation was permission groups, the engineer chose direct grants only, softened by multi select and copy from user. (2) Starting with zero grants at cutover locks out every existing user until an admin grants them; the recommendation was a seeder mapping old roles to equivalent grants. (3) Full catalog CRUD in the UI can drift from the code constants; the recommendation was a seeder owned, read only catalog. Each is recorded with its mitigation in the Consequences of the build spec, and grouping is a named revisit trigger in Follow-up.

The repo authorizes requests with a global role today: `user.users.role` holds one of five hardcoded values, the auth service derives two permission strings from it (`users.manage`, `logs.read`), the gateway maps roles to a capability enum per route, and the Angular app gates navigation on the same derived strings. Spec 0003 built this deliberately small for the single organization phase.

The engineer wants the production pattern from a reference Rust/Axum SOA system: permission first access control where every authorization decision tests permission names, a single source of truth service for the catalog and assignments, defence in depth at gateway and services, TTL caches with event driven invalidation, and a manage wildcard per resource. The reference brief prescribes NATS request-reply transport, JWT actor tokens, role tables, and Drizzle or porsager; the engineer explicitly asked for the design to be adapted to what this repo already runs, not replicated verbatim.

Forces: the repo already has a working trust fabric (session cookie at the gateway, HMAC signed identity headers verified per service), a transport convention (HTTP through the gateway, NATS for events), a mandatory logging contract, central migrations and seeds, and generated OpenAPI plus SDK artifacts that CI enforces. Not deciding leaves the hardcoded role enum as the only knob, which already shows strain: spec 0007 added user lifecycle actions that all collapse into one `users.manage` string, and the deferred list already asks for finer access (manager level read access to user pages).

During the design conversation the engineer made a direction setting call: roles are removed entirely, from the access schema as well as from user, auth, and web. The system becomes a pure access list, permissions granted directly per user.

## Options considered

### Option 1: Replicate the reference brief exactly

New access service with role, role_permission, role_user, and permission_user tables, NATS request-reply for all internal calls, short lived JWT actor tokens with per service audiences, RS256 end user JWTs at the gateway.

**Pros**:
- Proven production shape, strong replay isolation between services via per service token audiences.
- Role grouping keeps onboarding cheap.

**Cons**:
- Rearchitects the repo's transport (HTTP proxy to request-reply) and its authentication (sessions to JWTs) for no functional gain; spec 0003's session model would be discarded while it works.
- Two new secret families (actor token secret, service token) beside the existing HMAC secret.
- Contradicts the engineer's explicit no roles decision.

### Option 2: Pure per user ACL on the existing transport, owned by a new access service (chosen)

Only `permission` and `permission_user` tables in a new `access` schema and service; gateway keeps the session cookie, adds a lookup plus TTL cache, and authorization moves to permission names; the existing HMAC identity header is extended to carry the signed permission list; NATS carries a permission changed event for cache invalidation; full catalog and grant management via API and Angular UI.

**Pros**:
- Reuses every trust and transport mechanism the repo already tests and operates; the delta is one service, one package, one header change.
- Matches the engineer's no roles call exactly; the data model is two tables.
- Extractable access service, per domain schema, consistent with repo rules.

**Cons**:
- Onboarding toil without grouping; lockout window at cutover; catalog drift risk with UI CRUD (all consciously accepted, see the premise note).
- Every protected request gains a runtime dependency on the access service (bounded by the gateway cache, fail closed by design).

### Option 3: Minimal extension of the current mechanism

Keep the role column and the capability enum, back the role to permission mapping with database tables instead of the hardcoded `permissionsForRole`, add an admin UI for that mapping.

**Pros**:
- Smallest change, no cutover risk, no new service.

**Cons**:
- Role stays an authorization input, which the engineer explicitly rejected.
- Per user exceptions remain impossible without inventing pseudo roles; the capability enum stays a second, parallel concept.

## Rationale

Option 2 wins because the engineer's two fixed points, adapt to this repo and remove roles, eliminate the alternatives: Option 1 fails the first point (it replaces working transport and auth wholesale, which is a big bang rewrite of the trust fabric for zero user visible gain) and Option 3 fails the second (role survives as a decision input). The chosen shape keeps the blast radius honest: the only breaking change is the identity header contract, which lives in one repo and deploys as one unit, so the classic multi service coordination risk does not apply.

Decisions the engineer delegated, settled here: the permissions travel in the existing HMAC header with the list hashed into the canonical signing string (bounded signature input, tamper evident list; runner up was a separate JWT actor token, rejected as a second token infrastructure). Cache TTLs default to 60 seconds at the gateway and 300 seconds inside the access service with 1000 entry bounds, both env tunable (runner up, longer TTLs, rejected because the event stream already handles the common invalidation path and the TTL is only the NATS down safety net). The event subject is `access.permission.changed` following the repo's existing dot naming (`user.invited`). Error semantics reuse `packages/errors` codes with a `reason` field (`insufficient_permissions`, `permission_lookup_failed`) instead of the brief's AUTH-001/003/005 codes, keeping one envelope convention. Catalog rows are immutable except description, because renaming a permission in place silently changes enforcement everywhere; and the `access` namespace is delete protected with a self revocation guard, because a permission system that can amputate its own administration is a production incident waiting for a Friday. Scoped variants are not seeded: no surface uses them, and dead permissions in a UI managed catalog are drift bait.

## Current state inventory (evidence)

From the read only code scan on 2026-08-23:

- Gateway: `apps/gateway/erp/src/routes/proxy.route.ts` holds `forwardRequest`, `addIdentityHeaders`, `canAccessAuthCapability`; capabilities `admin`, `operational`, `read`, `user-management`; identity signed by `signAuthIdentity` in `packages/contracts/src/auth-identity.ts` over `METHOD\nPATH\nuserId\nrole\nexpiresAt`.
- Auth service: `permissionsForRole` in `apps/services/auth/src/modules/auth/auth.service.ts` maps admin to `['users.manage','logs.read']`, manager to `['logs.read']`, others to none; `GET /internal/auth/session` returns user, role, and those permissions.
- User schema: `user.users.role varchar(50)` NOT NULL with CHECK on `admin|manager|bi|staff|legacy`, default `bi`.
- Services verify the header in their own `shared/plugins/auth-identity.plugin.ts` with a capability parameter.
- Web: `permissionGuard` in `apps/web/src/app/auth/auth.guard.ts` checks the two derived strings from the session payload.
- Messaging: `packages/messaging` exposes publish, subscribe, and an unused request-reply interface; the only live event is `user.invited`.
- Errors: `packages/errors` envelope `{ error: { code, message, reason?, requestId? } }` with codes like `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `SERVICE_UNAVAILABLE`.
- Ports 3101 (auth), 3102 (user), 3103 (logs) are taken; 3104 is free for access.
