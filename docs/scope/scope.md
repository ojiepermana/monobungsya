# Scope: Monobungsia

Monobungsia adalah monorepo enterprise untuk gateway, service domain, dan MCP server dengan PostgreSQL multischema.

**Build approach:** Tracer Bullet (slices run through database, service, gateway, and client boundaries).
**Workflow:** Beta (verify, then test).

## At a glance

| #   | Feature                             | Phase      | Status      |
| --- | ----------------------------------- | ---------- | ----------- |
| 1   | Auth magic link and session         | Foundation | in-progress |
| 2   | Auth login and callback UI          | Foundation | in-progress |
| 3   | Angular UI package and CSS standard | Foundation | in-progress |
| 4   | MCP server for ERP tool access      | Foundation | in-progress |
| 5   | Auth passkey login                  | Foundation | in-progress |
| 6   | Log subsystem                       | Foundation | in-progress |
| 7   | User lifecycle management           | Domain     | in-progress |
| 8   | Permission access control           | Foundation | in-progress |

## Foundations

### 1. Auth magic link and session · in-progress

Implement passwordless login, server side sessions, role authorization, and signed identity forwarding for the single organization phase.
**Done when:** Registered users can request and consume a one time magic link, use a bounded session, logout, and access only the routes allowed by their global role.

- [x] Design it (spec): `/architect auth magic link and session`
- [x] Build it: `/develop auth magic link and session`
  - [x] Auth migration and atomic token or session operations (AC-2, AC-4, AC-6)
  - [x] SMTP magic link service and public auth routes (AC-1, AC-2, AC-3, AC-5, AC-9)
  - [x] Gateway HMAC identity forwarding and service identity guards (AC-7)
  - [x] Role authorization policy for admin, operational, and read only routes (AC-8)
  - [x] Cleanup worker, redacted logging, tests, and deployment configuration (AC-9, AC-10)
- [ ] Verify it: `/check verify auth magic link and session`
- [x] Test it: `/test auth magic link and session`

Spec [0003](../specs/0003-auth-magic-link-session.md) · code in `apps/services/auth`, `apps/gateway/erp`, and `packages/contracts`

### 2. Auth login and callback UI · in-progress

Provide login, magic-link verification, and callback states in the Angular web
client, with the same auth flow available from the Tauri desktop shell.
**Done when:** Browser and desktop users can request a link, consume a valid
session callback, and receive deterministic error states.

- [x] Angular routes, auth service, guards, and callback screens
- [x] Tauri runtime detection and desktop auth deep-link handoff
- [ ] Verify it: `/check verify auth login and callback UI`

Spec [0004](../specs/0004-auth-ui-callback.md) · code in `apps/web` and `apps/tauri`

### 3. Angular UI package and CSS standard · in-progress

Use `@ojiepermana/angular` for the web and desktop shell composition, with
Tailwind v4, package theme tokens, responsive navigation, and shared layout
settings.
**Done when:** `apps/web` builds in the root workspace, its unit tests pass,
and `apps/tauri` packages the same Angular output.

- [x] Package theme, shell, navigation, page, settings, and icon integration
- [x] Root web scripts, generated SDK dependency, and Tauri build wiring
- [ ] Verify it: `/check verify Angular UI package and CSS standard`

Spec [0001](../specs/web/0001-angular-ui-standard/index.md) · code in `apps/web`, `apps/tauri`, `package.json`, and `bun.lock`

### 4. MCP server for ERP tool access · in-progress

Scaffold an MCP server app at `apps/mcp` (Bun, TypeScript, STDIO transport) with a declarative tool registry and a starter `check_stock` tool calling the gateway.
**Done when:** An MCP client can list and call `check_stock` over STDIO, invalid input and ERP failures return clean errors, and the app passes lint and typecheck with all dependencies and env vars at the repo root.

- [x] Design it (spec): `/architect MCP server for ERP tool access`
- [x] Build it: `/develop MCP server for ERP tool access`
  - [x] Root wiring: SDK dependency, dev/typecheck/build scripts, ERP env section, app tsconfig (AC-6, AC-9)
  - [x] ERP service layer, ToolDefinition registry, and check_stock tool (AC-2, AC-3, AC-4, AC-7, AC-8)
  - [x] STDIO server wiring, README, and repo checks (AC-1, AC-5, AC-9)
- [x] Verify it: `/check verify MCP server for ERP tool access`
- [x] Test it: `/test MCP server for ERP tool access`

Spec [0005](../specs/0005-mcp-server-scaffold.md) · code in `apps/mcp`, `package.json`, and `.env.example`

### 5. Auth passkey login · in-progress

Add passkey (WebAuthn) as a second sign in method beside magic link, reusing the existing sessions, cookie, rate limits, and cleanup. Magic link stays unchanged as the universal fallback, and the Tauri desktop shell keeps magic link only.
**Done when:** A user can register up to 5 passkeys, sign in with one and receive a session identical to a magic link session, manage (rename, delete) their own passkeys on a settings page that follows the shared Page pattern, and magic link login still works unchanged for everyone.

- [x] Design it (spec): `/architect auth passkey login`
- [ ] Build it: `/develop auth passkey login`
  - [x] Migration, ceremony core, and challenge safety in the auth service (AC-2, AC-3, AC-7, AC-9)
  - [x] Public routes, gateway wiring, and regenerated OpenAPI plus SDK (AC-2, AC-3, AC-6, AC-7)
  - [x] Web thread: gated login button, registration, and passkey sign in end to end (AC-1, AC-3, AC-4)
  - [x] Management UI, post login prompt, rate limits, caps, and logging (AC-2, AC-5, AC-6, AC-8, AC-9)
  - [x] Cleanup worker extension, tests, and env documentation (AC-7, AC-10)
  - [ ] Passkey settings page recomposition with shared header, content, footer, appearance, one main landmark, and preserved interactions (AC-11)
- [ ] Verify it: `/check verify auth passkey login` (re-run for the page recomposition)
- [ ] Test it: `/test auth passkey login`

Spec [0006](../specs/0006-auth-passkey-login/index.md) · code in `apps/services/auth`, `apps/gateway/erp`, `apps/web`, `packages/database`, and `packages/errors`

### 6. Log subsystem · in-progress

Partitioned log storage in PostgreSQL (application logging, audit trails, access logs), a shared `ActivityLog` writer every service can use, a read only logs service behind the gateway, and three Angular viewer pages.
**Done when:** Log rows land in yearly partitions automatically, audit writes fail visibly while application log writes never block a request, and an admin or manager can browse, search, filter, and page all three log types in the web UI.

- [x] Design it (spec): imported reference design, adapted to this repo
- [ ] Build it: `/develop log subsystem`
  - [x] Partitioned migration and grants (AC-3, AC-7)
  - [x] Shared partition helpers and ActivityLog writer (AC-1, AC-2, AC-3, AC-8)
  - [x] Logs service, gateway wiring, and session permissions (AC-4, AC-5, AC-6)
  - [x] Web viewer pages with search, filters, and paging (AC-9)
  - [x] Tests and regenerated OpenAPI artifacts
  - [x] Safe session details from auth through the gateway, logs API, and viewer (AC-16, AC-19, AC-20)
  - [x] Angular navigation correlation, gateway validation, CORS, and trace filtering (AC-17, AC-18, AC-19)
  - [ ] Production regression coverage, E2E flow proof, and generated contracts (AC-1, AC-8, AC-10 to AC-20)
- [ ] Verify it: `/check verify log subsystem`
- [ ] Test it: `/test log subsystem`

Spec [0001](../specs/logs/0001-log-subsystem/index.md) · code in `packages/database`, `packages/logger`, `apps/services/logs`, `apps/services/auth`, `apps/gateway/erp`, and `apps/web`

### 8. Permission access control · in-progress

Permission first access control without roles: a new access service owns a permission catalog and direct per user grants, the gateway checks permission names on every protected route and forwards them in the signed identity header, services re check independently, and the role concept is removed from user, auth, gateway, and web. Admin pages manage the catalog and grants with multi select and copy from user.
**Done when:** A bootstrap admin (from env) can grant and revoke permissions per user through the web UI, every protected route allows or denies purely by permission names (manage wildcard included), a permission change takes effect within the cache window, no code path reads a role anymore, and a lookup failure denies instead of allowing.

- [x] Design it (spec): `/architect permission access control`
- [x] Build it: `/develop permission access control`
  - [x] Thin thread: acl package, access schema and seeds, access service lookup, gateway permission check on one users route (AC-1, AC-2, AC-4, AC-5, AC-6)
  - [x] Full cutover: permission route table, session enrichment, role removal across services and web (AC-3, AC-9, AC-11, AC-12, AC-13)
  - [x] Admin API: catalog CRUD, grants, lockout guards, audit writes, cache invalidation events (AC-7, AC-8, AC-10, AC-15)
  - [x] Admin UI: stacked catalog page with a hidden by default filter toggle, compact `xs` header and table actions, and the user detail access tab (AC-14)
  - [x] Proof and artifacts: test scenarios, OpenAPI and SDK regeneration, env docs (AC-16)
- [ ] Verify it: `/check verify permission access control`
- [ ] Test it: `/test permission access control`

Spec [0008](../specs/0008-permission-acl/index.md) · code in `apps/services/access`, `apps/gateway/erp`, `apps/services/auth`, `apps/services/user`, `apps/services/logs`, `apps/web`, `packages/acl`, `packages/contracts`, and `packages/database`

## Domain

### 7. User lifecycle management · in-progress

Full user management owned by the user service: create and update users, suspend, block, soft delete with restore, client generated UUIDv7 ids, and web pages for the user list and a detail view showing the user's logs.
**Done when:** An admin can create a user who receives an invitation email and can log in, update the user's name and role, suspend, block, soft delete, and restore with mandatory reasons and audit trails, and open a detail page showing the profile plus that user's audit, access, and application logs; no user row is ever hard deleted.

- [x] Design it (spec): `/architect user lifecycle management`
- [ ] Build it: `/develop user lifecycle management`
  - [x] Migration and read only tracer: status columns, list and detail from service through gateway to the /users page (AC-8, AC-9, AC-11)
  - [x] Create and update with client generated UUIDv7, audit writes, and the create dialog (AC-1, AC-3, AC-7)
  - [x] Status lifecycle: suspend, block, soft delete, restore, guards, and extended auth login checks (AC-4, AC-5, AC-6, AC-7)
  - [x] Invitation event and the auth magic link handler (AC-2)
  - [x] Detail page log tabs, actorUserId filter, and cutover off the auth users endpoint (AC-9, AC-10, AC-11)
  - [x] Recompose the two user pages on the package Page scaffold: stacked variant, hidden by default filter with header toggle, compact `xs` header and table actions, content, footer (AC-12, spec update 2026-08-23)
- [x] Verify it: `/check verify user lifecycle management` (re-run for AC-12; AC-1 to AC-11 passed 2026-08-22)
- [ ] Test it: `/test user lifecycle management` (re-run for the recomposed page tests)

Spec [0007](../specs/0007-user-management/index.md) · code in `apps/services/user`, `apps/services/auth`, `apps/services/logs`, `apps/gateway/erp`, `apps/web`, `packages/database`, and `packages/contracts`

## Deferred

- Gateway inventory stock endpoint (`/api/v1/stock`) · from spec 0005
- Gateway machine auth scheme for service tokens · from spec 0005
- Service registry endpoint so the console renders service cards from real data instead of a static list · from spec 0001
- Conditional UI autofill (passkey suggestions in the login email field) · from spec 0006
- Passkey support in the Tauri desktop shell when webview WebAuthn support matures · from spec 0006
- Resend invitation action for failed or expired invitation emails · from spec 0007
- Manager level read access to the user pages · from spec 0007
- Scoped permission variants (`:own`, `:scoped`) plus downstream ownership rules, when the first self service surface arrives · from spec 0008
- Permission grouping (bundles) if per user granting becomes painful as user count grows · from spec 0008
- Orphan grant sweep, only needed if user hard deletion is ever introduced · from spec 0008
