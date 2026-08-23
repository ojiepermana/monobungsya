# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun 1.4+ is the only package manager. There is a single root `package.json` and one `node_modules` — never add a `package.json` under `apps/` or `packages/`; add dependencies only at the root.

```bash
bun install
cp .env.example .env          # ENABLE_INFRASTRUCTURE=false runs services without PostgreSQL/NATS

bun run dev                   # web + gateway + auth + user
bun run doctor                # verify local runtime, dependencies, and infrastructure
bun run dev:gateway           # or one app: dev:web, dev:auth, dev:user
bun run dev:tauri             # Angular dev server + Tauri desktop window

bun run test                  # backend + package tests (bun test)
bun test apps/services/auth/src/tests/auth.test.ts   # single test file
bun run test:web              # Angular unit tests (Vitest builder)

bun run lint                  # Biome (single quotes, 2-space indent, trailing commas)
bun run typecheck             # Angular build + tsc per backend app and package + Rust
bun run typecheck:tauri       # cargo check for desktop shell
bun run build
bun run build:tauri           # Tauri package build; runs build:web first

bun run openapi:generate      # regenerate openapi.yaml specs + generated SDK (run after changing Elysia schemas/routes)
bun run openapi:validate
bun run check:dependencies    # fails on cross-service imports

bun run db:migrate            # accepts --service <name> and --dry-run
bun run db:seed
bun run db:reset --confirm --seed   # requires DATABASE_RESET_ALLOWED=true
bun run db:migrate:down --steps 1
```

## Docker Usage

- Do not use Docker or Docker Compose to run local development infrastructure or services.
- Use the local development services and commands documented by the repository for development and runtime verification.
- Use Docker only to test Dockerfiles and validate built images, including image-level smoke tests.

CI (`.github/workflows/ci.yml`) runs db reset/seed + idempotence check, tests, typecheck, lint, dependency check, OpenAPI generate + validate, then fails if generated artifacts (`apps/*/openapi.yaml`, `packages/contracts/openapi`, `packages/angular-sdk/src/generated`) have uncommitted diffs — always commit regenerated output.

## Architecture

Bun monorepo: Angular/Tauri clients → Elysia API Gateway → two domain services, with PostgreSQL and NATS behind them. An MCP server consumes the gateway contract.

- **apps/web** (port 4200) — Angular 22 client using `@ojiepermana/angular`; talks to the gateway through its public API.
- **apps/gateway/erp** (port 3000, public `/api/v1/*`) — CORS, request ID, public OpenAPI, proxying to services. No domain business logic.
- **apps/services/{auth,user}** (ports 3101–3102, internal only) — each has the same shape: `main.ts` (composition root), `app.ts` (`createApp` factory), `config/env.ts`, `modules/<module>/`, `shared/plugins/`, `jobs/workers/`, `tests/`, Dockerfile.
- **apps/mcp** (STDIO) — MCP tools that call the gateway through the shared contract.
- **apps/tauri** — Tauri v2 desktop shell around the Angular build at `dist/web/browser`.
- **packages/** — shared infrastructure only: `contracts` (OpenAPI artifacts + event contracts), `database` (Bun native SQL for PostgreSQL), `elysia` (shared Elysia adapters), `messaging` (NATS abstraction), `config`, `logger`, `errors`, `angular-sdk` (generated). Imported everywhere via the root import map `#project/*`.

### Layering inside a module

```text
route → Elysia schema validation → service → domain repository → #project/database → PostgreSQL
```

Routes handle HTTP only and never call repositories directly. Schemas do validation/API shape only. Services own business logic, workflows, transaction boundaries (`withTransaction`), and messaging. Repositories do data access only and know nothing about HTTP. There is deliberately no `BaseRepository`/`GenericRepository`/generic query builder — repositories stay domain-specific in the service that owns the domain. Don't move domain code into `packages/` until cross-service reuse is real and the contract is stable.

### Composition root pattern

`main.ts` only loads config, creates infrastructure connections (database, NATS, mailer) **when `ENABLE_INFRASTRUCTURE=true`**, injects them into `createApp(env, deps)`, starts the server, and handles graceful shutdown. `app.ts` must be constructible without a live server — `scripts/openapi-generate.ts` imports each `createApp` and calls `/openapi/json` in-process to produce specs.

### Logging system (mandatory for every backend service)

Every backend service, including the gateway and every service under `apps/services/` such as `auth`, `user`, and `logs`, must implement the shared logging system. When adding a new service, treat logging as part of the service contract; the service is incomplete until all of the following are present:

- `app.ts` creates a `Logger` with the service name and configured `LOG_LEVEL`, registers `requestIdPlugin`, `createLoggerPlugin`, and `createErrorHandler`, and passes the logger to modules that need to emit domain events.
- `main.ts` configures `ActivityLog` with the least-privilege `LOG_DATABASE_URL` connection when infrastructure is enabled, uses `BEST_EFFORT_LOGGING_ENABLED`, and calls `ActivityLog.flush(LOG_FLUSH_TIMEOUT_MS)` before closing the log database during graceful shutdown.
- Application logs use structured event keys and sanitized context through `#project/logger`; credentials, cookies, authorization values, tokens, secrets, passwords, and passkey responses must never be persisted. Logging failures must not fail a request for best-effort application/access logs.
- Business mutations that require an audit trail call `ActivityLog.writeAudit` and await it inside the business operation. Do not expose a public log-write endpoint; log writes are server-side only.
- The gateway records one access log for each completed public API request, excluding CORS `OPTIONS`. Authentication/security events and domain audit events are emitted at their authoritative server boundary, not by the Angular client. Internal service requests do not create duplicate public access rows.
- Tests for a service cover logger wiring, redaction, failure behavior, and graceful-shutdown flushing. When a service emits access or audit events, tests also prove correlation fields and the required event classification.

### Cross-service rules (enforced)

Services may import shared packages and event contracts, never another service's package or source. `scripts/check-dependencies.ts` and CI enforce this. Inter-service communication is NATS events (contracts in `packages/contracts/src/events`, handlers live in the owning service) or HTTP through the gateway. The goal: any service folder can be extracted to its own repo unchanged.

### OpenAPI / SDK flow

Elysia schemas are the source of truth. `bun run openapi:generate` writes `openapi.yaml` into the gateway and each remaining service, copies the public gateway spec to `packages/contracts/openapi/generated/`, then runs `@hey-api/openapi-ts` to regenerate `packages/angular-sdk/src/generated`. Never hand-edit generated folders (Biome ignores them).

### Database

PostgreSQL 18, native Bun SQL (no ORM). Multischema with per domain ownership: `auth`, `access`, `user`, and `logs`. Primary keys are `uuid` with native `uuidv7()` default. Canonical migrations and seeds live in `packages/database/migrations/<schema>` and `packages/database/seeds`, outside deployable services. Migrations use `DATABASE_MIGRATION_URL` with role `project_migrator`; runtime roles are provisioned outside the migration runner. All queries must use parameter binding; filtering and sorting must go through field whitelists in the repository.

### Auth

Passwordless magic-link login (spec `docs/specs/0003`): tokens stored only as SHA-256 hashes, server-side sessions in PostgreSQL, HttpOnly cookie for the browser. The gateway validates the session cookie and forwards an HMAC-SHA-256-signed identity header (`INTERNAL_AUTH_SIGNING_SECRET`); services verify it via their `shared/plugins/auth-identity.plugin.ts` and never read the auth schema directly. Auth email links use `PUBLIC_API_URL`, then redirect to `WEB_APP_URL` after verification.

## Workflow docs

- `docs/scope/scope.md` — living scope with feature status (maintained by `/scope`).
- `docs/specs/NNNN-<name>/` — sequentially numbered build-spec folders (entry point `index.md`) with acceptance criteria (owned by `/architect`). Check the relevant spec before building; features in progress list which acceptance criteria each task covers.
- Prose in README/specs is partly Indonesian; code, identifiers, and commit content are English.

## Spec slice completion

Treat a slice from a governing `docs/specs/` build plan as complete only after its implementation tasks and required validation pass. Close the slice in this order:

1. Identify the exact files belonging to the slice, including any spec or scope progress updates. Keep unrelated pre-existing work out of the slice.
2. Run `graphify update .` (the `/graphify . --update` equivalent) and confirm that it succeeds, so the graph re-extracts the new or changed files.
3. Stage and commit only the slice files with a one-line English Conventional Commit subject. Do not stage `graphify-out/` unless a tracked graph artifact is explicitly part of the slice.

If the Graphify update fails, leave the slice uncommitted, report the failure, and retry the update before committing.
