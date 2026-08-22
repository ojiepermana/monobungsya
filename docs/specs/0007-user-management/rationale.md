# 0007. User lifecycle management, rationale

Decision record for [index.md](index.md). /develop does not need this file.

## Context

The user service (`apps/services/user`, port 3102) is a stub with a single status route, while user administration squats in the auth service: the only user list endpoint is `/api/v1/auth/users`, backed by `listUsers` in the auth repository, and the only existing user was inserted by a seed. There is no way to create or change a user at runtime, no block state, and no soft delete; `user.users` carries just `suspended_at`, which every login query already checks.

Meanwhile the new log subsystem (spec logs/0001) stores `actor_user_id` on all three log tables, but no page correlates a user with their activity. The engineer wants fuller user management: create and update, suspend and block, soft delete only (no hard delete), ids supplied by the application, and a detail page showing the profile plus that user's logs.

The forces: the repo's cross service rule says any service folder must be extractable unchanged, so user domain logic growing inside the auth service digs the hole deeper. Magic link login requires a user row to exist, so runtime user creation is the actual gate to onboarding anyone beyond the seed. The build approach is Tracer Bullet, and the seeded lone admin makes lockout a real risk once disable and delete actions exist.

## Options considered

### Option 1: Full ownership in the user service, statuses as timestamp columns (chosen)

All user reads and writes move to the user service; auth keeps only the read only checks login needs. `blocked_at` and `deleted_at` join the existing `suspended_at`, and the effective status is derived by precedence.

**Pros**:
- Restores the domain ownership the architecture promises (basis: the cross service rules in `CLAUDE.md`).
- The status model extends the existing `suspended_at` checks instead of rewriting them, and each state keeps its own timestamp for the record.
- Restore comes free: delete touches only `deleted_at`, so clearing it returns the prior status.

**Cons**:
- The web list page must migrate off `/api/v1/auth/users`, a cutover that must land in the same release.
- Deriving status by precedence is a rule every reader must know rather than a value sitting in one column.

### Option 2: Grow the auth service

Keep everything where the list endpoint already is and add the write endpoints there.

**Pros**:
- No endpoint migration; fewer moving parts today.

**Cons**:
- The auth service becomes the de facto user service, and the real one stays an empty shell; extractability degrades further with every added route.

### Option 3: Split it, reads stay in auth and writes go to user

**Pros**:
- The web page keeps working untouched.

**Cons**:
- Two services own one domain, so every schema change lands in both, and list results and write results can drift apart.

A status representation alternative was also weighed: a single status enum column (simpler to read, but every existing login query must be rewritten and per state timestamps are lost) and enum plus timestamps (two sources that must stay in sync). Both lost to the timestamp only model.

## Rationale

Option 1 follows directly from the extractability force in Context: the moment user writes exist, whichever service holds them owns the domain, and putting them anywhere except `apps/services/user` makes the architecture a fiction. The migration cost that usually argues for Option 2 or 3 is near zero here because the whole system ships from one repo in one release, so the cutover is a single coordinated commit rather than a phased deprecation. The timestamp status model won because the auth login queries already gate on `suspended_at IS NULL`; extending the same shape to two more columns is an additive change to proven code (basis: the safe migration practice of nullable column adds).

The smaller calls made while writing, each with its runner up:

- **Migration location**: `packages/database/migrations/user/`, because the table belongs to the user domain even though the auth migration created it. Runner up: the auth migrations directory, rejected to stop the ownership blur from spreading.
- **Invalid or redundant transitions return 409**, so the audit trail only ever records real changes. Runner up: idempotent silent success, friendlier to retries but able to record actions that changed nothing.
- **NATS unavailable during create**: the create commits and the skipped invitation logs a warning, because the user can always self request a magic link. Runner up: fail the create, rejected since email delivery is not what create promises.
- **Invitation issuance inside auth** uses the internal token issuance path rather than the public magic link route, because the public route's per email rate limits and abuse protections are aimed at anonymous callers, not at an admin initiated invite.
- **Audit action names**: `user.created`, `user.updated`, `user.suspended`, `user.unsuspended`, `user.blocked`, `user.unblocked`, `user.deleted`, `user.restored`, matching the action column conventions the audit viewer already filters on.
- **Page size 25**, matching the logs pages so the web tables share one paging rhythm.
- **The user access settings page is removed** and the menu points at `/users`; its list duty moves wholesale, and keeping both would leave two lists with different powers.
- **The server validates id as a uuid** (format check plus 409 on collision) without enforcing the v7 variant, since the version bits buy nothing at this scale and strictness there would complicate seeds and tests.

Engineer chosen inputs treated as fixed requirements: suspend is temporary and block is heavier but both reversible, delete is also restorable, invitation email on create, client generated UUIDv7, all three log types on the detail page, minimal profile fields, admin only management, mandatory reasons recorded in the audit trail, email unique globally, session enforcement through the existing validation checks, self and last admin guards, pages built from the existing UI patterns, dialog create form, and deleted users hidden from the default list.

## References

**Project sources** (verifiable, in this repo):
- `CLAUDE.md`: the layering rule (route, schema, service, repository), the cross service extraction rule, and the field whitelist requirement.
- Spec `0003-auth-magic-link-session.md`: magic link issuance, session validation, `PUBLIC_API_URL`, and the `suspended_at` login checks this design extends.
- Spec `logs/0001-log-subsystem/`: the ActivityLog audit contract (audit writes fail visibly), the `actor_user_id` columns, and the viewer page patterns the new pages copy.
- `packages/database/migrations/auth/0001_auth_foundation.up.sql`: the current `user.users` shape and its foreign keys.
- The `@ojiepermana/angular` showcase as the composition reference for the web pages.

**Practices & standards**:
- Soft delete with a tombstone timestamp instead of row removal.
- Client generated UUIDv7 ids for ids known before the request returns.
- Mandatory reason capture on administrative actions, recorded in the audit trail.
- Last admin lockout guard on privilege and status changes.
- Nullable column adds as the safe migration step on a running database.
- Deriving state from authoritative timestamps rather than a duplicated enum.
