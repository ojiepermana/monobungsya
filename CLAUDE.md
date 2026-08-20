# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun 1.3+ is the only package manager. There is a single root `package.json` and one `node_modules` — never add a `package.json` under `apps/` or `packages/`; add dependencies only at the root.

```bash
bun install
cp .env.example .env          # ENABLE_INFRASTRUCTURE=false runs services without PostgreSQL/NATS

bun run dev                   # all apps in parallel (web + gateway + 5 services)
bun run dev:gateway           # or one app: dev:web, dev:auth, dev:user

bun run test                  # backend + package tests (bun test)
bun test apps/services/auth/src/tests/auth.test.ts   # single test file
bun run test:web              # Angular tests (ng test, vitest-based builder)

bun run lint                  # Biome (single quotes, 2-space indent, trailing commas)
bun run typecheck             # tsc per app + ng build for web
bun run build

bun run openapi:generate      # regenerate openapi.yaml specs + Angular SDK (run after changing Elysia schemas/routes)
bun run openapi:validate
bun run check:dependencies    # fails on cross-service imports

bun run db:migrate            # accepts --service <name> and --dry-run
bun run db:seed
bun run db:reset --confirm --seed   # requires DATABASE_RESET_ALLOWED=true
bun run db:migrate:down --steps 1
```

CI (`.github/workflows/ci.yml`) runs db reset/seed + idempotence check, tests, typecheck, lint, dependency check, OpenAPI generate + validate, then fails if generated artifacts (`apps/*/openapi.yaml`, `packages/contracts/openapi`, `packages/angular-sdk/src/generated`) have uncommitted diffs — always commit regenerated output.

## Architecture

Bun monorepo: Angular 22 web client → Elysia API Gateway → two domain services, with PostgreSQL and NATS behind them.

- **apps/web** (port 4200) — talks only to the gateway via the generated SDK (`#project/angular-sdk`). Never calls domain services directly.
- **apps/api-gateway** (port 3000, public `/api/v1/*`) — CORS, request ID, public OpenAPI, proxying to services. No domain business logic.
- **apps/services/{auth,user}** (ports 3101–3102, internal only) — each has the same shape: `main.ts` (composition root), `app.ts` (`createApp` factory), `config/env.ts`, `modules/<module>/`, `shared/plugins/`, `jobs/workers/`, `tests/`, Dockerfile.
- **packages/** — shared infrastructure only: `contracts` (OpenAPI artifacts + event contracts), `database` (Bun native SQL for PostgreSQL), `messaging` (NATS abstraction), `config`, `logger`, `errors`, `angular-sdk` (generated). Imported everywhere via the root import map `#project/*`.

### Layering inside a module

```
route → Elysia schema validation → service → domain repository → #project/database → PostgreSQL
```

Routes handle HTTP only and never call repositories directly. Schemas do validation/API shape only. Services own business logic, workflows, transaction boundaries (`withTransaction`), and messaging. Repositories do data access only and know nothing about HTTP. There is deliberately no `BaseRepository`/`GenericRepository`/generic query builder — repositories stay domain-specific in the service that owns the domain. Don't move domain code into `packages/` until cross-service reuse is real and the contract is stable.

### Composition root pattern

`main.ts` only loads config, creates infrastructure connections (database, NATS, mailer) **when `ENABLE_INFRASTRUCTURE=true`**, injects them into `createApp(env, deps)`, starts the server, and handles graceful shutdown. `app.ts` must be constructible without a live server — `scripts/openapi-generate.ts` imports each `createApp` and calls `/openapi/json` in-process to produce specs.

### Cross-service rules (enforced)

Services may import shared packages and event contracts, never another service's package or source. `scripts/check-dependencies.ts` and CI enforce this. Inter-service communication is NATS events (contracts in `packages/contracts/src/events`, handlers live in the owning service) or HTTP through the gateway. The goal: any service folder can be extracted to its own repo unchanged.

### OpenAPI / SDK flow

Elysia schemas are the source of truth. `bun run openapi:generate` writes `openapi.yaml` into the gateway and each remaining service, copies the public gateway spec to `packages/contracts/openapi/generated/`, then runs `@hey-api/openapi-ts` to regenerate `packages/angular-sdk/src/generated`. Never hand-edit generated folders (Biome ignores them).

### Database

PostgreSQL 18, native Bun SQL (no ORM). Multischema with per-domain ownership: `auth`, `user`, `employee`, `payroll`, `reporting`, `logs`. Primary keys are `uuid` with native `uuidv7()` default. Canonical migrations and seeds live in `packages/database/migrations/<schema>` and `packages/database/seeds` — not inside services. Migrations use `DATABASE_MIGRATION_URL` (role `project_migrator`); runtime roles are per-service and provisioned outside the migration runner. All queries must use parameter binding; filtering/sorting must go through field whitelists in the repository.

### Auth

Passwordless magic-link login (spec `docs/specs/0003`): tokens stored only as SHA-256 hashes, server-side sessions in PostgreSQL, HttpOnly cookie for the browser. The gateway validates the session cookie and forwards an HMAC-SHA-256-signed identity header (`INTERNAL_AUTH_SIGNING_SECRET`); services verify it via their `shared/plugins/auth-identity.plugin.ts` and never read the auth schema directly. Auth email links use `PUBLIC_API_URL`, then redirect to `WEB_APP_URL` after verification.

## Angular (apps/web)

Follow [apps/web/AGENTS.md](apps/web/AGENTS.md) for all web work. Highlights: standalone components (don't write `standalone: true` — it's the default), signals for state (`signal`/`computed`/`linkedSignal`, never `mutate`), `input()`/`output()`/`model()` functions instead of decorators, `inject()` instead of constructor injection, native control flow (`@if`/`@for`/`@switch`), class/style bindings instead of `ngClass`/`ngStyle`, host bindings via the `host` object, Signal Forms for new forms, lazy-loaded feature routes, and WCAG AA / AXE-passing accessibility. Don't set `changeDetection: OnPush` explicitly (default in v22+).

## Workflow docs

- `docs/scope/scope.md` — living scope with feature status (maintained by `/scope`).
- `docs/specs/NNNN-*.md` — numbered build specs with acceptance criteria (owned by `/architect`). Check the relevant spec before building; features in progress list which acceptance criteria each task covers.
- Prose in README/specs is partly Indonesian; code, identifiers, and commit content are English.
