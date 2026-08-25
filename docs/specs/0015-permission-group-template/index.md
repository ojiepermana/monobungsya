# 0015. Permission group as a reusable grant template

**Date**: 2026-08-26
**Status**: In Progress

## Summary

Halaman `/permission/group` yang sekarang masih placeholder menjadi surface penuh untuk menyusun kelompok permission bernama, lalu menerapkannya ke user. Group bekerja sebagai template sekali pakai: saat diterapkan, isinya disalin menjadi grant langsung di `access.permission_user`, dan setelah itu group tidak lagi terhubung ke user mana pun. Karena itu jalur otorisasi gateway, cache permission, dan header identity sama sekali tidak berubah, sehingga risiko fitur ini terkurung di satu surface admin baru. Konsekuensi yang harus diterima secara sadar: menambah permission ke sebuah group tidak akan mengalir ke orang yang sudah pernah dikenai group itu.

## Requirements

**User stories**:

- As an admin, I want to define a named set of permissions once so that I do not rebuild the same multi select from memory every time I onboard someone.
- As an admin, I want to apply a group to one user from that user's page so that granting a familiar set of access is a single action.
- As an admin, I want to apply a group to many users from the group page so that onboarding a whole team is a single action.
- As an admin, I want to switch a group off and soft delete it so that an outdated group stops being used without losing its history.
- As an auditor, I want each apply recorded per user so that the audit trail explains where a user's permissions came from.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: Migration `0037_access_groups` creates `access.group` and `access.permission_group` exactly per the data model below, with up and down files in `packages/database/migrations/access`. `bun run db:migrate` run twice in a row succeeds, and `bun run db:migrate:down --steps 1` removes both tables plus the catalog rows from **AC-2**.
- **AC-2**: The same migration inserts eleven new catalog permissions (`access:group:list`, `read`, `create`, `update`, `delete`, `restore`, `manage`, and `access:permission_group:list`, `create`, `delete`, `manage`) using the `ON CONFLICT (name) DO UPDATE` shape of `0021_access_jobs_permissions`, and the down migration deletes exactly those names. `packages/acl` exports every one of them in `PERMISSIONS`, `PERMISSION_CATALOG`, and its description map, and its unit tests prove the catalog stays in step with the constants.
- **AC-3**: Group names are unique case insensitively across every row, soft deleted rows included. A create or update colliding with a live group returns 409 CONFLICT. A create colliding with a soft deleted group also returns 409, and the error message states that the conflicting group is deleted so the operator knows to restore it instead of guessing.
- **AC-4**: Group CRUD works through the gateway: list with pagination, search across name and description, filter by status, and a filter to include or show only soft deleted rows; read one with its permission count and its `deletedAt`; create with name required and status defaulting to `active`; update accepting `name`, `description`, and `status` in one request; soft delete setting `deleted_at` while leaving the row and its `permission_group` rows intact; restore clearing `deleted_at`. Soft deleting an already deleted group, or restoring a live one, returns 409 CONFLICT.
- **AC-5**: Attaching permissions to a group is idempotent: posting a list of permission ids returns `{ attached: [], skipped: [] }`, an unknown permission id returns 404, and an empty list returns 422. Detaching removes one `permission_group` row. Deleting a permission from the catalog removes it from every group through `ON DELETE CASCADE`, and no group operation fails because of it.
- **AC-6**: A group may be applied only when `status = 'active'`, `deleted_at IS NULL`, and it holds at least one permission. Both apply endpoints return 409 CONFLICT for a group that is `off` or deleted, and 422 for a group with no permissions. A group that cannot be applied never appears in an apply picker. Beyond blocking apply, `off` changes nothing: it never touches a grant that an earlier apply created.
- **AC-7**: Applying a group to one user from the user detail page grants every permission in the group that the user does not already hold, skips the rest, and returns `{ granted: [], skipped: [] }` in the same response shape as the existing copy grants endpoint.
- **AC-8**: Applying a group to many users from the group detail page accepts at most 50 user ids, processes each user inside its own transaction, and returns `{ applied: [{ userId, granted, skipped }], failed: [{ userId, reason }] }`. One failing user never aborts the others. More than 50 ids, or an empty list, returns 422.
- **AC-9**: Effective permission resolution is unchanged. `lookupPermissions`, the gateway permission cache, the signed identity header, and the `access.permission.changed` contract keep their current shape, and no query on the authorization path reads `access.group`. Each apply publishes the existing `access.permission.changed` event once per affected user, so cache invalidation behaves exactly as it does for a manual grant.
- **AC-10**: Every group create, update, soft delete, restore, permission attach, and permission detach writes one awaited `ActivityLog.writeAudit` row naming the acting admin and the group. Every apply writes one awaited audit row per affected user, carrying the group id, the group name, and the permission names actually granted, so a user's own audit history explains the grant.
- **AC-11**: Each endpoint requires the permission named in the API surface table, checked at the gateway and re checked inside the access service through the verified identity header. A request lacking the permission returns 403 FORBIDDEN both through the gateway and when it reaches the access service directly.
- **AC-12**: `/permission/group` replaces the placeholder with the stacked `Page` scaffold (`PageHeader`, `PageFilter`, `PageContent`, `PageFooter`), a `collapsible` filter closed by default and toggled by the `Filter` control in the header, `Button size="xs"` for header and table row actions, and table columns name, status, permission count, description, last updated, and actions. Loading, error, and empty states render distinctly.
- **AC-13**: `/permission/group/:id` shows the group profile with editing in place, a permission panel using the multi select grouped by namespace for attach plus per row detach in the shape of `user-access-panel.ts`, and an apply to users panel whose picker reads the existing `/api/v1/users` endpoint. An operator without `user:user:list` sees that panel disabled with a plain explanation instead of a broken picker.
- **AC-14**: The user detail access panel gains an apply group control listing only appliable groups, placed beside the existing copy grants from another user action, and reports the granted and skipped counts after it runs.
- **AC-15**: The Group navigation item and the `/permission/group` route gate on `access:group:list` rather than today's `access:permission:list`, and `/permission/group/:id` gates on `access:group:read`.
- **AC-16**: `openapi.yaml` specs and `packages/angular-sdk/src/generated` are regenerated and committed. `bun run check:dependencies`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:web`, `bun run progress:generate`, and `bun run progress:check` all pass. No new environment variable is introduced.

## Decision

**Chosen option**: Option 1: Group as a one shot template, copied into direct grants at apply time.

Add `access.group` and `access.permission_group` to hold named permission sets, and two apply actions that copy a group's permissions into existing `access.permission_user` grants, leaving the authorization path, the permission cache, and the identity header untouched.

**Implementation skills**: `elysiajs` (installed Claude Code skill, Elysia route, schema, and plugin conventions) · `angular-developer` (installed Claude Code skill, signals, routes, guards, and page composition)

## Rationale

Reasoning, the options weighed, and the tradeoffs consciously accepted: see [rationale.md](rationale.md).

## Feature design

**Data model** (canonical migrations in `packages/database/migrations/access`, file pair `0037_access_groups.up.sql` and `.down.sql`, primary keys `uuid` with native `uuidv7()` default, timestamps `timestamptz` defaulting to `now()`):

| Table | Column | Notes |
|---|---|---|
| `access.group` | `id` uuid PK DEFAULT `uuidv7()` | plus `access_group_id_uuidv7_check`, matching the existing access tables |
| | `name` varchar(100) NOT NULL | unique through `CREATE UNIQUE INDEX access_group_name_lower_key ON "access"."group" (lower(name))`, covering soft deleted rows too |
| | `status` varchar(20) NOT NULL DEFAULT `'active'` | `CONSTRAINT access_group_status_check CHECK (status IN ('active', 'off'))` |
| | `description` text NULL | |
| | `created_at` timestamptz NOT NULL DEFAULT `now()` | |
| | `updated_at` timestamptz NOT NULL DEFAULT `now()` | set to `now()` in every UPDATE statement, the repo convention |
| | `deleted_at` timestamptz NULL | soft delete marker; NULL means live |
| `access.permission_group` | `id` uuid PK DEFAULT `uuidv7()` | plus the uuidv7 check constraint |
| | `group_id` uuid NOT NULL | FK to `access.group(id)` ON DELETE CASCADE |
| | `permission_id` uuid NOT NULL | FK to `access.permission(id)` ON DELETE CASCADE |
| | `created_at` timestamptz NOT NULL DEFAULT `now()` | |
| | UNIQUE (`group_id`, `permission_id`) | makes attach idempotent |
| | index on `group_id`, index on `permission_id` | |

The migration also re runs the `project_access_runtime` grant block that `0012_access_permissions.up.sql` uses, so the new tables are reachable by the runtime role.

**Relationships**:

| From | To | Cardinality | Notes |
|---|---|---|---|
| `access.group` | `access.permission_group` | 1:N | cascade on delete, a safety net for direct database work since the API never hard deletes a group |
| `access.permission` | `access.permission_group` | 1:N | deleting a catalog permission removes it from every group automatically |
| `access.group` | `access.permission` | N:M in effect | through the join table above |
| `access.group` | a user | **no relationship** | the template model stores no membership; apply writes into the existing `access.permission_user` |

`access.permission_user` keeps its current shape. Apply reuses its idempotent insert path, so nothing downstream of it changes.

**State transitions**:

| From | To | Trigger | Rule |
|---|---|---|---|
| (none) | `active`, `deleted_at` NULL | create | status defaults to `active` |
| `active` | `off` | update with `status: 'off'` | blocks future apply only; existing grants are untouched |
| `off` | `active` | update with `status: 'active'` | |
| `deleted_at` NULL | `deleted_at` set | soft delete | permitted from either status; the group and its permission rows stay |
| `deleted_at` set | `deleted_at` NULL | restore | status returns as it was; 409 if the group is not deleted |

Applying is allowed only from `active` with `deleted_at` NULL and at least one attached permission.

**API surface** (public routes proxied by the gateway to the access service; every route is also re checked inside the access service through the identity header):

| Endpoint | Method | Key inputs | Key outputs | Required permission | Key errors |
|---|---|---|---|---|---|
| `/api/v1/access/groups` | GET | `page`, `pageSize`, `search`, `status`, `deleted` (`exclude` default, `include`, `only`), `appliable` | paged group rows with `permissionCount` | `access:group:list` | 401, 403 |
| `/api/v1/access/groups` | POST | `name` (req), `description`, `status` | created group | `access:group:create` | 409 duplicate name, 422 blank or overlong name |
| `/api/v1/access/groups/:id` | GET | id | group with `permissionCount` and `deletedAt` | `access:group:read` | 404 |
| `/api/v1/access/groups/:id` | PUT | `name`, `description`, `status`, any subset | updated group | `access:group:update` | 404, 409 duplicate name, 422 invalid status |
| `/api/v1/access/groups/:id` | DELETE | id | none | `access:group:delete` | 404, 409 already deleted |
| `/api/v1/access/groups/:id/restore` | POST | id | restored group | `access:group:restore` | 404, 409 not deleted |
| `/api/v1/access/groups/:id/permissions` | GET | id | the group's permissions, ordered by namespace then resource then name | `access:permission_group:list` | 404 |
| `/api/v1/access/groups/:id/permissions` | POST | `permissionIds: uuid[]` | `{ attached: [], skipped: [] }` | `access:permission_group:create` | 404 unknown group or permission id, 422 empty list |
| `/api/v1/access/groups/:id/permissions/:permissionId` | DELETE | ids | none | `access:permission_group:delete` | 404 |
| `/api/v1/access/groups/:id/apply` | POST | `userIds: uuid[]`, at most 50 | `{ applied: [{ userId, granted, skipped }], failed: [{ userId, reason }] }` | `access:permission_user:create` | 404, 409 group off or deleted, 422 empty group, empty list, or more than 50 ids |
| `/api/v1/access/users/:userId/permissions/apply-group` | POST | `groupId` | `{ granted: [], skipped: [] }` | `access:permission_user:create` | 404, 409 group off or deleted, 422 empty group |

Both apply actions require `access:permission_user:create` because their only lasting effect is a direct grant, exactly what that permission already governs. The `appliable=true` filter on the list endpoint exists so the two apply pickers do not need an endpoint of their own.

**Value sourcing** (every value an action must produce names its source):

| Action | Value produced or displayed | Source |
|---|---|---|
| Group list row | `permissionCount` | aggregate `count(permission_group.id)` in the list query, the same shape as `grant_count` on the permission catalog page |
| Group list row | status badge | `access.group.status` column |
| Group list row | last updated | `access.group.updated_at`, returned through `isoFromDbTimestamp` like every other access row |
| Group list | which rows are visible | `deleted_at IS NULL` unless the `deleted` filter says `include` or `only` |
| Group list | sort order and filter fields | the repository field whitelist, per the existing repo rule |
| Create group | `id` | database default `uuidv7()` |
| Create group | status when the caller omits it | the column default `'active'` |
| Update or soft delete | `updated_at`, `deleted_at` | `now()` set inside the UPDATE statement |
| Duplicate name check | the conflicting group and whether it is deleted | `SELECT id, deleted_at FROM "access"."group" WHERE lower(name) = lower($1)`, deleted rows included, so the 409 can name the deleted case |
| Attach permissions | `attached` versus `skipped` | `ON CONFLICT (group_id, permission_id) DO NOTHING RETURNING id`: a returned row means attached, no row means skipped |
| Apply picker on the user page | the list of appliable groups | `GET /api/v1/access/groups?appliable=true` |
| Apply picker on the group page | the list of users | the existing `GET /api/v1/users`, called by the Angular page, never by the access service |
| Apply | which permission ids to grant | `SELECT permission_id FROM "access"."permission_group" WHERE group_id = $1` |
| Apply | which of those the user already holds | the existing `existingGrantPermissionIds` on `access.permission_user` |
| Apply | `granted` versus `skipped` per user | the existing `insertGrant` idempotent insert, unchanged |
| Apply | eligibility of the group | `status = 'active'` AND `deleted_at IS NULL` AND at least one `permission_group` row |
| Apply | acting admin for the audit row | the verified identity header on the access service request |
| Apply | cache invalidation target | the existing `access.permission.changed` event with the affected `userId`, published once per user |
| Group detail apply panel | whether the picker is usable | the caller's own permission list from `GET /api/v1/auth/session`, checked for `user:user:list` |
| Group navigation item | whether it renders | session permissions checked against `access:group:list` through `hasResolvedPermission` |

**Key invariants**:

- A group never participates in an authorization decision. `lookupPermissions` stays a single join on `access.permission_user`, and no query in the gateway or the access service reads `access.group` while authorizing a request.
- Apply is additive only. No code path introduced by this spec revokes a grant.
- `lower(name)` is unique across every row in `access.group`, soft deleted rows included.
- A group is appliable only when `status = 'active'`, `deleted_at IS NULL`, and it holds at least one permission.
- Attach and apply are both idempotent through `ON CONFLICT DO NOTHING`, and both report what happened rather than failing on a repeat.
- Bulk apply is transactional per user: one user's failure never rolls back another's work, and the response names every failure with its reason.
- Bulk apply is capped at 50 user ids per request; the cap is a constant in the access module, not an environment variable.
- The API never hard deletes a group. The `ON DELETE CASCADE` on `permission_group` is a safety net for direct database work only.
- The access service never reads the `user` schema. User ids arrive as request inputs and their existence is not verified, the same application level integrity that spec 0008 chose for `permission_user.user_id`.
- All SQL is parameter bound; list filtering and sorting go through repository field whitelists.

**Security model**:

- Group definitions are gated by `access:group:*`, group contents by `access:permission_group:*`, and both apply actions by `access:permission_user:create`.
- The self lockout guard from spec 0008 needs no extension. Apply only adds grants, and detach only removes a permission from a group, never from a user, so no path here can strip the caller's own access.
- A group holding `access` namespace permissions is a fast route to full privilege, but it is not a new one: `access:permission_user:create` already lets its holder grant themselves any catalog permission. Treat that permission as effectively full privilege, as spec 0008 already implies, and grant it accordingly.
- The group detail page needs `user:user:list` for its bulk apply picker, so this is the first `access` surface that also depends on a `user` permission. Missing it disables that one panel and nothing else.
- Audit rows carry the acting admin, the group, and permission names only. No secrets, tokens, or cookies are ever logged, per the existing logging contract.
- No new personal data is stored and no regulatory scope is triggered: `access.group` holds operator authored names and descriptions.

**Configuration required**: none. No new environment variable, no new secret, no new service. The 50 user cap on bulk apply is a module constant.

**Critical test scenarios** (each maps to an acceptance criterion):

- Happy path: create a group, attach five permissions, apply it to a user with two of them already granted, and see three granted and two skipped, verifies **AC-4**, **AC-5**, **AC-7**
- Idempotence: run the migration twice and the seed twice, then attach the same permission list twice, and the state is identical with everything reported skipped, verifies **AC-1**, **AC-2**, **AC-5**
- Down migration: `bun run db:migrate:down --steps 1` drops both tables and removes the eleven catalog rows, verifies **AC-1**, **AC-2**
- Duplicate name: creating a group whose name differs only in case returns 409, and doing it against a soft deleted group returns 409 with a message naming the deleted group, verifies **AC-3**
- Soft delete and restore: a deleted group disappears from the default list, is still readable, reappears under the `only` filter, restores cleanly, and a second delete or a restore of a live group returns 409, verifies **AC-4**
- Off group: applying an `off` group returns 409, the group is absent from both pickers, and a user granted through an earlier apply keeps every permission, verifies **AC-6**
- Empty group: applying a group with no permissions returns 422 from both endpoints, verifies **AC-6**
- Catalog cascade: deleting a permission that belongs to three groups removes it from all three, and each group still lists and applies correctly, verifies **AC-5**
- Bulk apply partial failure: applying to ten user ids where one fails returns nine in `applied` and one in `failed` with its reason, and the nine grants persist, verifies **AC-8**
- Bulk apply cap: 51 user ids returns 422, verifies **AC-8**
- Resolution untouched: after an apply, `lookupPermissions` returns the union of the user's grants with no reference to the group, and the gateway grants access within the cache window because the `access.permission.changed` event fired for that user, verifies **AC-9**
- Authorization: each endpoint is called without its permission and denied 403 both through the gateway and directly against the access service, verifies **AC-11**
- Audit: one apply to three users produces exactly three audit rows, each naming the acting admin, the group, and the permissions actually granted, verifies **AC-10**
- UI list: the group page opens with its filter hidden, the header `Filter` toggle opens and closes it, header and row actions render at `xs`, and all six columns show, verifies **AC-12**
- UI detail: attach and detach work from the permission panel, and an operator without `user:user:list` sees the apply to users panel disabled with a stated reason, verifies **AC-13**
- UI user page: the apply group control lists only appliable groups and reports granted and skipped counts, verifies **AC-14**
- Navigation: an operator holding `access:permission:list` but not `access:group:list` sees no Group item and is refused the route, verifies **AC-15**

## Build plan

Tracer Bullet, following the project default. Slice 1 threads one group end to end through migration, acl, access service, gateway, and web before any of the richer behaviour lands; each later slice thickens one layer of behaviour and stays shippable on its own.

1. **Thin thread, create and list**: migration `0037_access_groups` for both tables and the eleven catalog rows; the new constants and descriptions in `packages/acl` with its unit tests; group repository, service, schema, and routes in `apps/services/access` for list, read, and create with the duplicate name check; the gateway proxy entries for those three with their permission requirements; `groups.page.ts` rebuilt on the stacked `Page` scaffold with real data, all six columns, the hidden collapsible filter, and `xs` actions; the nav item and route gate moved to `access:group:list`. Proof: an operator creates a group and sees it in the list end to end, and an operator without the new permission sees nothing. Satisfies **AC-1**, **AC-2**, **AC-12**, **AC-15**, and threads **AC-3**, **AC-4**, **AC-11**.
2. **Group contents**: attach and detach endpoints with idempotent reporting; the `PUT` update accepting name, description, and status together; the `/permission/group/:id` route and detail page with editing in place and the permission panel using the multi select grouped by namespace; audit writes for create, update, attach, and detach. Satisfies **AC-5**, and advances **AC-4**, **AC-10**, and **AC-13**.
3. **Lifecycle**: soft delete and restore endpoints with their 409 guards; the `deleted` filter on the list endpoint and its control in the page filter; the duplicate name error naming a soft deleted conflict; the `appliable` filter; audit writes for delete and restore. Satisfies **AC-3**, **AC-4**, and the `off` half of **AC-6**.
4. **Apply to one user**: the `apply-group` endpoint with the eligibility guard, the reuse of the existing idempotent grant insert, one awaited audit row per user, and one `access.permission.changed` publish per user; the apply group control added to the user detail access panel next to copy grants. Satisfies **AC-7**, **AC-9**, **AC-14**, and completes **AC-6** and **AC-10**.
5. **Bulk apply**: the group apply endpoint with per user transactions, the 50 id cap, and the `applied` and `failed` response; the apply to users panel on the group detail page, its picker reading the existing users endpoint, and its disabled state when the operator lacks `user:user:list`. Satisfies **AC-8**, completes **AC-13**, and closes **AC-11** now that the last endpoint of this feature carries its gateway requirement and its service side re check.
6. **Proof and artifacts**: the critical test scenarios across `packages/acl`, `apps/services/access`, `apps/gateway/erp`, and `apps/web`; OpenAPI and Angular SDK regeneration committed; `bun run check:dependencies`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:web`, `bun run progress:generate`, and `bun run progress:check`. Satisfies **AC-16** and the test halves of every criterion above.

## Migration plan

**Strategy**: additive, one deployment, no live data transformed.

**Phases**:

1. Run `bun run db:migrate` to create the two tables and insert the eleven catalog rows, then run `bun run db:seed` so the bootstrap grants seed cross joins the new permissions to every `ACCESS_BOOTSTRAP_ADMIN_EMAILS` user. Without this second step nobody holds the new permissions and the group page is invisible to everyone.
2. Deploy the code. The gateway, the access service, and the web app ship from one repository as one release, and nothing in the identity header or the lookup contract changes, so there is no ordering constraint between them.
3. Grant `access:group:*` and `access:permission_group:*` to any operator who is not a bootstrap admin but manages permissions today. Holding `access:permission:manage` does not imply the new permissions, because the manage wildcard is scoped to one namespace and resource.

**Rollback**: revert the commits and run `bun run db:migrate:down --steps 1`. The down migration drops both tables and deletes the eleven catalog rows.

**Risks**:

- Deleting those catalog rows cascades through `access.permission_user`, so a rollback silently revokes the new permissions from whoever held them. That is the correct outcome, but it means a rollback is not invisible to operators.
- Grants created by an apply are ordinary `permission_user` rows and survive the rollback untouched. That is intended: they were real grants, never group state, and no one loses access because grouping went away.
- Forgetting phase 1's seed run, or phase 3, leaves the new page reachable only by bootstrap admins, which reads as a broken deployment rather than a missing grant.

## Consequences

**Positive**:

- Onboarding a familiar access set becomes one action instead of rebuilding a twenty checkbox multi select from memory, per person, which is exactly the toil spec 0008 recorded as its cost.
- The authorization hot path is untouched. The lookup query, the gateway cache, the identity header, and the `access.permission.changed` contract keep their shape, so this feature cannot break a request that works today.
- A group name records the intent behind a set of grants, which loose `permission_user` rows never carried. Reading a group tells you what job it was meant for.
- Rollback is a revert plus one down migration, and no user loses access they legitimately have.

**Negative / tradeoffs**:

- A group is a starting point, not a living source of truth. Adding a permission to a group later reaches nobody who was already applied, and there is no view showing who is behind. Over time a group name will describe access that its past recipients do not have. This is the deliberate cost of the template model, chosen with open eyes over the assignment model.
- Taking access back gains nothing. You can grant twenty permissions in one action but still revoke them one at a time on the user page.
- `status = 'off'` carries almost no weight. Its only effect is blocking apply, and an operator may reasonably read it as suspending access and be surprised that it does not.
- Unique forever on `lower(name)` means a soft deleted group keeps its name reserved. The 409 message and the deleted filter soften it, but an operator can still hit a duplicate error for a group the default list does not show.
- The group detail page depends on `user:user:list` for its bulk picker, so this is the first `access` surface that is not gated purely by `access` permissions. An operator with `access` permissions alone gets a partly disabled page.
- Two apply surfaces mean two endpoints, two response shapes, and two audit paths that must stay consistent for as long as both exist.
- Bulk apply accepts user ids with no foreign key behind them, so a wrong id still creates a grant pointing at nobody, the same weakness spec 0008 accepted for `permission_user.user_id`.

**Neutral**:

- Two new tables in the `access` schema and eleven new rows in the permission catalog, so the catalog page grows by about half its `access` namespace.
- The Group nav gate moves off `access:permission:list`, so an operator holding only the old permission loses the item until granted the new one.
- Spec 0008's grouping follow up and the scope's Deferred entry for it are answered in the template form only. The assignment form, where a group keeps granting, stays undesigned.
- OpenAPI specs and the Angular SDK change shape, so regeneration must be committed or CI fails on the generated artifact diff.
- The access module grows a second domain concept beside permissions and grants, which is the first time that module holds more than one.

## Follow-up

- [ ] Design the assignment form of grouping, an `access.group_user` table where a group keeps granting and later edits propagate, if template drift becomes the real operational pain. That is the version spec 0008's follow up originally imagined, and it is the natural successor to this spec.
- [ ] Consider a reconciliation view listing users who are missing permissions their applied group has since gained. It is the cheapest partial cure for template drift and needs the apply history from the audit log rather than any new table.
- [ ] Consider a revoke by group action so taking access back costs as little as giving it.
- [ ] Record the group naming rule, the apply semantics, and the meaning of `status = 'off'` in the root `AGENTS.md` once this is built, alongside the permission naming convention that spec 0008 already flagged as absent from project context.
- [ ] Revisit whether `status = 'off'` should mean suspend rather than block apply. That only becomes meaningful if the assignment form above is ever built.
- [ ] Update the scope's Deferred list: the grouping entry from spec 0008 is now partly answered, so it should either close or be reworded to cover the assignment form only.
