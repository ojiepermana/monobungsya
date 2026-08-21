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

## Deferred

- Gateway inventory stock endpoint (`/api/v1/stock`) · from spec 0005
- Gateway machine auth scheme for service tokens · from spec 0005
- Service registry endpoint so the console renders service cards from real data instead of a static list · from spec 0001
