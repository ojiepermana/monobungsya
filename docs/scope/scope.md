# Scope: Monobungsia

Monobungsia adalah monorepo enterprise untuk gateway, service domain, dan MCP server dengan PostgreSQL multischema.

**Build approach:** Tracer Bullet (slices run through database, service, gateway, and client boundaries).
**Workflow:** Beta (verify, then test).

## At a glance

| #   | Feature                             | Phase      | Status      |
| --- | ----------------------------------- | ---------- | ----------- |
| A   | Enterprise monorepo foundation      | Foundation | existing    |
| B   | Central multischema database tooling | Foundation | existing    |
| 1   | Auth magic link and session         | Foundation | done        |
| 2   | Auth login and callback UI          | Foundation | done        |
| 3   | Angular UI package and CSS standard | Foundation | done        |
| 4   | MCP server for ERP tool access      | Foundation | done        |
| 5   | Auth passkey login                  | Foundation | done        |
| 6   | Log subsystem                       | Foundation | done        |
| 7   | User lifecycle management           | Domain     | done        |
| 8   | Permission access control           | Foundation | done        |
| 9   | TOTP two factor authentication      | Foundation | done        |
| 10  | Generated gateway SDK integration   | Foundation | done        |
| 11  | Reliable jobs and notification center | Foundation | done        |
| 12  | Bun observability and benchmarking standard | Foundation | done        |
| 13  | Permission group grant templates    | Foundation | planned     |

## Foundations

### A. Enterprise monorepo foundation · existing

The Bun monorepo, Angular and Tauri clients, Elysia gateway, service boundaries, shared packages, and CI predate the current feature workflow.
**Done when:** The repository installs, checks, tests, and builds from the root while preserving explicit service boundaries.

Spec [0001](../specs/0001-enterprise-monorepo-foundation/index.md) · code in `./`

### B. Central multischema database tooling · existing

The canonical Bun SQL runner owns ordered migrations, seeds, reset safety, checksums, PostgreSQL schemas, and runtime grants.
**Done when:** Database changes are repeatable, drift protected, service scoped, and safe to run through the root commands.

Spec [0002](../specs/0002-central-multischema-database-tooling/index.md) · code in `packages/database`

### 1. Auth magic link and session · done

Implement passwordless login, server side sessions, permission authorization, and signed identity forwarding for the single organization phase.
**Done when:** Registered users can request and consume a one time magic link, use a bounded session, logout, and access only routes allowed by their effective permissions.

- [x] Design it (spec): `/architect auth magic link and session`
- [x] Build it: `/develop auth magic link and session`
  - [x] Auth migration and atomic token or session operations (AC-2, AC-4, AC-6)
  - [x] SMTP magic link service and public auth routes (AC-1, AC-2, AC-3, AC-5, AC-9)
  - [x] Gateway HMAC identity forwarding and service identity guards (AC-7)
  - [x] Permission authorization policy superseding the original role policy through spec 0008 (AC-8)
  - [x] Cleanup worker, redacted logging, tests, and deployment configuration (AC-9, AC-10)
- [x] Verify it: `/check verify auth magic link and session`
- [x] Test it: `/test auth magic link and session`

Spec [0003](../specs/0003-auth-magic-link-session/index.md) · code in `apps/services/auth`, `apps/gateway/erp`, and `packages/contracts`

### 2. Auth login and callback UI · done

Provide login, magic-link verification, and callback states in the Angular web
client, with the same auth flow available from the Tauri desktop shell.
**Done when:** Browser and desktop users can request a link, consume a valid
session callback, and receive deterministic error states.

- [x] Design it (spec): `/architect auth login and callback UI`
- [x] Build it: `/develop auth login and callback UI`
  - [x] Angular routes, auth service, guards, and callback screens
  - [x] Tauri runtime detection and desktop auth deep-link handoff
- [x] Verify it: `/check verify auth login and callback UI`
- [x] Test it: `/test auth login and callback UI`

Spec [0004](../specs/0004-auth-ui-callback/index.md) · code in `apps/web` and `apps/tauri`

### 3. Angular UI package and CSS standard · done

Use `@ojiepermana/angular` for the web and desktop shell composition, with
Tailwind v4, package theme tokens, responsive navigation, and shared layout
settings.
**Done when:** `apps/web` builds in the root workspace, its unit tests pass,
and `apps/tauri` packages the same Angular output.

- [x] Design it (spec): `/architect Angular UI package and CSS standard`
- [x] Build it: `/develop Angular UI package and CSS standard`
  - [x] Package theme, shell, navigation, page, settings, and icon integration
  - [x] Root web scripts, generated SDK dependency, and Tauri build wiring
  - [x] Validation gate: build, lint, and web unit tests pass; initial bundle measured at 740.11 kB and the warning budget set to 850kB (AC-10, AC-11, AC-12)
- [x] Verify it: `/check verify Angular UI package and CSS standard` (passed 2026-08-24 against 22.1.5, after the icon font and layout state fixes)
- [x] Test it: `/test Angular UI package and CSS standard`

Spec [0010](../specs/0010-angular-ui-standard/index.md) · code in `apps/web`, `apps/tauri`, `package.json`, and `bun.lock`

### 10. Generated gateway SDK integration · done

Use the public gateway OpenAPI contract to generate a typed SDK in `packages/angular-sdk` and consume it from Angular through domain facades, while preserving cookie auth, correlation, loading, and existing page behavior.
**Done when:** The complete public gateway contract generates cleanly, all gateway requests in `apps/web` use the generated SDK except browser magic link navigation, response types are useful, and OpenAPI validation, web typecheck, tests, lint, and generated diff checks pass.

- [x] Design it (spec)
- [x] Build it: `/develop generated gateway SDK integration`
  - [x] Public Elysia response schemas, `desktop` magic link input, and regenerated OpenAPI and SDK artifacts (AC-1, AC-2, AC-3)
  - [x] Bootstrap client configuration, cookie credentials, Hey API middleware, and health or session tracer thread (AC-4, AC-7, AC-8, AC-11)
  - [x] Auth, passkey, and TOTP facade migration with preserved browser verification behavior (AC-5, AC-7, AC-9, AC-12)
  - [x] Users, logs, and access facade migration with generated types and explicit UI mappings (AC-5, AC-6, AC-7, AC-10)
  - [x] Transport tests, sensitive data checks, clean regeneration, and repository validation gate (AC-8, AC-9, AC-10, AC-13, AC-14)
- [x] Verify it: `/check verify generated gateway SDK integration` (passed 2026-08-24 after committing the stale auth spec artifacts)
- [x] Test it: `/test generated gateway SDK integration` (transport suite plus teardown and navigation exception locks; 104 web tests and 20 e2e tests green)

Spec [0013](../specs/0013-angular-sdk-integration/index.md) · code in `apps/gateway/erp`, `apps/services`, `apps/web`, `packages/angular-sdk`, and root scripts

### 4. MCP server for ERP tool access · done

Scaffold an MCP server app at `apps/mcp` (Bun, TypeScript, STDIO transport) with a declarative tool registry and a starter `check_stock` tool calling the gateway.
**Done when:** An MCP client can list and call `check_stock` over STDIO, invalid input and ERP failures return clean errors, and the app passes lint and typecheck with all dependencies and env vars at the repo root.

- [x] Design it (spec): `/architect MCP server for ERP tool access`
- [x] Build it: `/develop MCP server for ERP tool access`
  - [x] Root wiring: SDK dependency, dev/typecheck/build scripts, ERP env section, app tsconfig (AC-6, AC-9)
  - [x] ERP service layer, ToolDefinition registry, and check_stock tool (AC-2, AC-3, AC-4, AC-7, AC-8)
  - [x] STDIO server wiring, README, and repo checks (AC-1, AC-5, AC-9)
- [x] Verify it: `/check verify MCP server for ERP tool access`
- [x] Test it: `/test MCP server for ERP tool access`

Spec [0005](../specs/0005-mcp-server-scaffold/index.md) · code in `apps/mcp`, `package.json`, and `.env.example`

### 5. Auth passkey login · done

Add passkey (WebAuthn) as a second sign in method beside magic link, reusing the existing sessions, cookie, rate limits, and cleanup. Magic link stays unchanged as the universal fallback, and the Tauri desktop shell keeps magic link only.
**Done when:** A user can register up to 5 passkeys, sign in with one and receive a session identical to a magic link session, manage (rename, delete) their own passkeys on a settings page that follows the shared Page pattern, and magic link login still works unchanged for everyone.

- [x] Design it (spec): `/architect auth passkey login`
- [x] Build it: `/develop auth passkey login`
  - [x] Migration, ceremony core, and challenge safety in the auth service (AC-2, AC-3, AC-7, AC-9)
  - [x] Public routes, gateway wiring, and regenerated OpenAPI plus SDK (AC-2, AC-3, AC-6, AC-7)
  - [x] Web thread: gated login button, registration, and passkey sign in end to end (AC-1, AC-3, AC-4)
  - [x] Management UI, post login prompt, rate limits, caps, and logging (AC-2, AC-5, AC-6, AC-8, AC-9)
  - [x] Cleanup worker extension, tests, and env documentation (AC-7, AC-10)
  - [x] Passkey settings page recomposition with shared header, content, footer, appearance, one main landmark, and preserved interactions (AC-11)
- [x] Verify it: `/check verify auth passkey login` (re-run for the page recomposition)
- [x] Test it: `/test auth passkey login`

Spec [0006](../specs/0006-auth-passkey-login/index.md) · code in `apps/services/auth`, `apps/gateway/erp`, `apps/web`, `packages/database`, and `packages/errors`

### 6. Log subsystem · done

Partitioned log storage in PostgreSQL (application logging, audit trails, access logs), a shared `ActivityLog` writer every service can use, a read only logs service behind the gateway, and three Angular viewer pages.
**Done when:** Log rows land in yearly partitions automatically, audit writes fail visibly while application log writes never block a request, and an admin or manager can browse, search, filter, and page all three log types in the web UI.

- [x] Design it (spec): imported reference design, adapted to this repo
- [x] Build it: `/develop log subsystem`
  - [x] Partitioned migration and grants (AC-3, AC-7)
  - [x] Shared partition helpers and ActivityLog writer (AC-1, AC-2, AC-3, AC-8)
  - [x] Logs service, gateway wiring, and session permissions (AC-4, AC-5, AC-6)
  - [x] Web viewer pages with search, filters, and paging (AC-9)
  - [x] Tests and regenerated OpenAPI artifacts
  - [x] Safe session details from auth through the gateway, logs API, and viewer (AC-16, AC-19, AC-20)
  - [x] Angular navigation correlation, gateway validation, CORS, and trace filtering (AC-17, AC-18, AC-19)
  - [x] Production regression coverage, E2E flow proof, and generated contracts (AC-1, AC-8, AC-10 to AC-20)
- [x] Verify it: `/check verify log subsystem`
- [x] Test it: `/test log subsystem`

Spec [0011](../specs/0011-log-subsystem/index.md) · code in `packages/database`, `packages/logger`, `apps/services/logs`, `apps/services/auth`, `apps/gateway/erp`, and `apps/web`

### 11. Reliable jobs and notification center · done

Add a PostgreSQL backed durable job runtime with bounded retries, schedules, lease recovery, and operator controls, then use it for reliable in app and email notifications across supported security, access, account, and operational events.
**Done when:** Declared durable work survives process and NATS outages with transactional enqueue and idempotent handling, users can manage their own notifications and optional email preferences, and authorized operators can inspect and retry terminal jobs without exposing sensitive payloads.

- [x] Design it (spec)
- [x] Build it: `/develop reliable jobs and notification center`
  - [x] Shared contract registry, durable queue tracer, and local handler binding (AC-1 to AC-5)
  - [x] Contract schedule synchronization, jobs scheduler, operator API, audit, observability, recovery, and retention (AC-3, AC-4, AC-11, AC-12, AC-14, AC-15)
  - [x] Enable the invitation cutover and auth cleanup schedule without the fallback NATS path running at the same time (AC-4, AC-13, AC-16)
  - [x] Notification data, recipient projection, templates, self service API, and source event tracer (AC-6, AC-7, AC-10, AC-13)
  - [x] Email delivery, preferences, mandatory rules, account events, and terminal failure fanout (AC-6, AC-8, AC-9, AC-10, AC-14)
  - [x] OpenAPI, generated SDK, Angular and Tauri surfaces, security hardening, rollout, and full proof (AC-7, AC-8, AC-11, AC-12, AC-15, AC-17)
- [x] Verify it: `/check verify reliable jobs and notification center`
- [x] Test it: `/test reliable jobs and notification center`

Spec [0012](../specs/0012-reliable-jobs-notifications/index.md) · code in `packages/jobs`, `packages/database`, `packages/contracts`, `apps/services/jobs`, `apps/services/auth`, `apps/services/user`, `apps/services/notification`, `apps/services/access`, `apps/gateway/erp`, and `apps/web`

### 8. Permission access control · done

Permission first access control without roles: a new access service owns a permission catalog and direct per user grants, the gateway checks permission names on every protected route and forwards them in the signed identity header, services re check independently, and the role concept is removed from user, auth, gateway, and web. Admin pages manage the catalog and grants with multi select and copy from user.
**Done when:** A bootstrap admin (from env) can grant and revoke permissions per user through the web UI, every protected route allows or denies purely by permission names (manage wildcard included), a permission change takes effect within the cache window, no code path reads a role anymore, and a lookup failure denies instead of allowing.

- [x] Design it (spec): `/architect permission access control`
- [x] Build it: `/develop permission access control`
  - [x] Thin thread: acl package, access schema and seeds, access service lookup, gateway permission check on one users route (AC-1, AC-2, AC-4, AC-5, AC-6)
  - [x] Full cutover: permission route table, session enrichment, role removal across services and web (AC-3, AC-9, AC-11, AC-12, AC-13)
  - [x] Admin API: catalog CRUD, grants, lockout guards, audit writes, cache invalidation events (AC-7, AC-8, AC-10, AC-15)
  - [x] Admin UI: stacked catalog page with a hidden by default filter toggle, compact `xs` header and table actions, and the user detail access tab (AC-14)
  - [x] Proof and artifacts: test scenarios, OpenAPI and SDK regeneration, env docs (AC-16)
- [x] Verify it: `/check verify permission access control`
- [x] Test it: `/test permission access control`

Spec [0008](../specs/0008-permission-acl/index.md) · code in `apps/services/access`, `apps/gateway/erp`, `apps/services/auth`, `apps/services/user`, `apps/services/logs`, `apps/web`, `packages/acl`, `packages/contracts`, and `packages/database`

### 9. TOTP two factor authentication · done

Add a 6 digit authenticator app code (TOTP) as a second login step after magic link or passkey, optional per user and enforceable by admins. Secrets are stored encrypted, recovery codes plus admin reset cover device loss, and the challenge, rate limit, cookie, and cleanup patterns already in the auth service are reused.
**Done when:** A user can enroll from the settings page, must enter a valid code after either first factor before any session exists, can recover with a single use recovery code, and an admin can require or reset a user's 2FA with a mandatory reason, audit trail, and full session revocation on reset.

- [x] Design it (spec): `/architect TOTP two factor authentication`
- [x] Build it: `/develop TOTP two factor authentication`
  - [x] Migration, env keys, crypto helper, and the end to end enroll thread with the minimal settings UI (AC-2, AC-3, AC-10, AC-13, AC-14)
  - [x] Login challenge thread across magic link and passkey: verify endpoint, replay guard, attempt caps, recovery codes (AC-1, AC-4, AC-5, AC-11, AC-12)
  - [x] Enforcement and self service: forced enrollment, disable and regenerate with proof, plus the admin surface with audit and session revocation (AC-6, AC-7, AC-8, AC-9, AC-10)
  - [x] Hardening and lifecycle: rate limits, cleanup worker, log redaction, OpenAPI and SDK regeneration, tests (AC-3, AC-5, AC-11, AC-13, AC-14)
- [x] Verify it: `/check verify TOTP two factor authentication`
- [x] Test it: `/test TOTP two factor authentication`

Spec [0009](../specs/0009-totp-two-factor-auth/index.md) · code in `apps/services/auth`, `apps/services/user`, `apps/gateway/erp`, `apps/web`, `packages/database`, and `packages/contracts`

### 12. Bun observability and benchmarking standard · done

Extend the log subsystem with one typed telemetry contract for every Bun backend, bounded PostgreSQL storage, reproducible Git baselines, and operator evidence.
**Done when:** Required backend resource seams use the typed contract without changing business behavior, runtime traces connect to logs, metrics, benchmarks, alerts, and operator views, benchmark comparisons are reproducible, and instrumentation overhead stays within the accepted limits.

- [x] Design it (spec): `/architect Bun observability and benchmarking standard`
- [x] Build it: `/develop Bun observability and benchmarking standard`
  - [x] Typed runtime contract, bounded PostgreSQL writer, W3C Elysia roots, and log correlation links
  - [x] Trace, metric, benchmark, and alert operator read API with dedicated permission, logs service queries, gateway proxy, and generated contracts
  - [x] Observability enforcement check, migration grants, retrying writer, focused tests, and repository typecheck
  - [x] Benchmark runner, Git baselines, comparison projection, and CI ingestion
  - [x] Angular trace/metric viewer, alert projection/evaluator, and remaining resource seams
- [x] Verify it: `/check verify Bun observability and benchmarking standard`
- [x] Test it: `/test Bun observability and benchmarking standard`

Spec [0014](../specs/0014-bun-observability-benchmarking/index.md)

### 13. Permission group grant templates · planned

Name a set of permissions once as a group, then apply it to one user or to many at once. A group is a template: applying it copies its permissions into direct grants, so the authorization path, the gateway permission cache, and the signed identity header stay exactly as they are.
**Done when:** An operator can create, edit, switch off, soft delete, and restore a group, attach and detach its permissions, apply it to one user from that user's page and to many users from the group page, every apply lands as ordinary grants with one audit row per affected user, a group that is off or empty cannot be applied, and no query on the authorization path reads the group tables.

- [x] Design it (spec): `/architect permission group grant templates`
- [ ] Build it: `/develop permission group grant templates`
  - [ ] Thin thread: migration `0037`, the eleven catalog permissions, `packages/acl` constants, group create and list from service through gateway to a rebuilt group page (AC-1, AC-2, AC-12, AC-15)
  - [ ] Group contents and lifecycle: attach and detach, update with status, the detail route and page, soft delete and restore with their guards, the appliable filter, audit writes (AC-3, AC-4, AC-5, AC-6, AC-10, AC-13)
  - [ ] Apply to one user from the user detail access panel, with the eligibility guard, the invalidation event, and one audit row per user (AC-7, AC-9, AC-14)
  - [ ] Bulk apply from the group page: per user transactions, the fifty id cap, and a picker reading the existing users endpoint (AC-8, AC-11, AC-13)
  - [ ] Proof and artifacts: test scenarios, OpenAPI and SDK regeneration, repository validation gate (AC-16)
- [ ] Verify it: `/check verify permission group grant templates`
- [ ] Test it: `/test permission group grant templates`

Spec [0015](../specs/0015-permission-group-template/index.md) · code in `packages/database`, `packages/acl`, `apps/services/access`, `apps/gateway/erp`, and `apps/web`

## Domain

### 7. User lifecycle management · done

Full user management owned by the user service: create and update users, suspend, block, soft delete with restore, client generated UUIDv7 ids, and web pages for the user list and a detail view showing the user's logs.
**Done when:** An operator with user management permission can create a user who receives an invitation email and can log in, update the user's name, manage direct permissions through the access surface, suspend, block, soft delete, and restore with mandatory reasons and audit trails, and open a detail page showing the profile plus that user's audit, access, and application logs; no user row is ever hard deleted.

- [x] Design it (spec): `/architect user lifecycle management`
- [x] Build it: `/develop user lifecycle management`
  - [x] Migration and read only tracer: status columns, list and detail from service through gateway to the /users page (AC-8, AC-9, AC-11)
  - [x] Create and update with client generated UUIDv7, audit writes, and the create dialog (AC-1, AC-3, AC-7)
  - [x] Status lifecycle: suspend, block, soft delete, restore, guards, and extended auth login checks (AC-4, AC-5, AC-6, AC-7)
  - [x] Invitation event and the auth magic link handler (AC-2)
  - [x] Detail page log tabs, actorUserId filter, and cutover off the auth users endpoint (AC-9, AC-10, AC-11)
  - [x] Recompose the two user pages on the package Page scaffold: stacked variant, hidden by default filter with header toggle, compact `xs` header and table actions, content, footer (AC-12, spec update 2026-08-23)
- [x] Verify it: `/check verify user lifecycle management` (re-run for AC-12; AC-1 to AC-11 passed 2026-08-22)
- [x] Test it: `/test user lifecycle management` (re-run for the recomposed page tests)

Spec [0007](../specs/0007-user-management/index.md) · code in `apps/services/user`, `apps/services/auth`, `apps/services/logs`, `apps/gateway/erp`, `apps/web`, `packages/database`, and `packages/contracts`

## Deferred

- Gateway inventory stock endpoint (`/api/v1/stock`) · reason: Requires its own inventory contract and implementation spec · from spec 0005
- Gateway machine auth scheme for service tokens · reason: Requires a separate machine authentication decision aligned with HMAC identity forwarding · from spec 0005
- Service registry endpoint so the console renders service cards from real data instead of a static list · reason: Static service cards satisfy the current foundation slice · from spec 0001
- Conditional UI autofill (passkey suggestions in the login email field) · reason: Optional enhancement outside the current passkey login contract · from spec 0006
- Passkey support in the Tauri desktop shell when webview WebAuthn support matures · reason: Current desktop webview support is not mature enough · from spec 0006
- Resend invitation action for failed or expired invitation emails · reason: Users can request a magic link themselves in the current flow · from spec 0007
- Manager level read access to the user pages · reason: The current permission model only defines the admin management surface · from spec 0007
- Scoped permission variants (`:own`, `:scoped`) plus downstream ownership rules · reason: No self service ownership surface exists yet · from spec 0008
- Permission group assignment, where a group keeps granting through an `access.group_user` table and later edits reach every member · reason: Feature 13 answers grouping in template form only; the assignment form changes the effective permission lookup and is deferred until template drift becomes the real pain · from spec 0008, narrowed by spec 0015
- Reconciliation view showing users missing permissions their applied group has since gained · reason: The cheapest partial cure for template drift, but it needs apply history read from the audit log and blocks nothing today · from spec 0015
- Revoke by group, so taking a set of access back costs as little as giving it · reason: Apply is additive by design in the template model; revoking stays per permission until this is designed · from spec 0015
- Orphan grant sweep · reason: Only needed if user hard deletion is introduced · from spec 0008
- Remember this device for 30 days (skip the TOTP step in a trusted browser) · reason: Trusted device behavior is outside the current 2FA contract · from spec 0009
- Rotation path for `TOTP_ENCRYPTION_KEY` (bulk re encryption or per row key versions) · reason: Key rotation requires a separate operational design · from spec 0009
- Access and jobs Dockerfiles plus CI image matrix coverage · reason: Runtime code is available, but deployment images have not been implemented · from spec 0001
- Revisit OpenTelemetry integration · reason: Wait for official Bun support or evidence that maintaining the internal telemetry stack costs more than operating a Collector · from spec 0014
