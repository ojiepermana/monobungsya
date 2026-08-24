# 0013. Integrate the generated gateway SDK into Angular

**Date**: 2026-08-23
**Status**: Accepted

> Split out of [spec 0010](../0010-angular-ui-standard/index.md) on 2026-08-24, authorized by the engineer, so this SDK integration can finish its own verify and test cycle while the umbrella UI standard is accepted. The decision content is unchanged.

## Summary

`apps/web` akan memakai SDK yang dihasilkan dari public OpenAPI gateway melalui `packages/angular-sdk`. `@hey-api/openapi-ts` tetap menjadi generator, sedangkan `@ojiepermana/angular` tetap menjadi library UI dan bukan pemilik kontrak backend. Semua request API gateway akan melewati operasi SDK typed melalui facade per domain, dengan satu pengecualian untuk navigasi browser pada verifikasi magic link.

## Context

> Premise note: `@ojiepermana/angular` adalah library UI, bukan generator SDK. Menggabungkan kontrak backend ke library UI akan membuat library umum bergantung pada aplikasi ERP. Keputusan ini menempatkan generator dan hasilnya di monorepo aplikasi, lalu membuat Angular memakai hasil tersebut.

Repository sudah memiliki `@hey-api/openapi-ts`, script `openapi:generate`, folder `packages/angular-sdk/src/generated`, dan public contract di `apps/gateway/erp/openapi.yaml`. Namun service Angular masih membuat request dengan `HttpClient` secara manual dan mendefinisikan ulang banyak tipe response. Sebagian besar route gateway juga belum mendeskripsikan response schema, sehingga output generator masih memiliki response `unknown`.

Perpindahan transport memengaruhi cookie session, correlation header, progress loading, error mapping, testing, dan navigasi magic link. Fetch yang dipakai client Hey API tidak melewati interceptor `HttpClient` Angular yang sekarang. Tidak ada tabel database, penyimpanan browser baru, atau endpoint bisnis baru dalam keputusan ini.

## Requirements

**User stories**:

1. As a maintainer, I want the public gateway contract and Angular SDK to be regenerated from one repeatable root command so that client code cannot silently drift.
2. As an Angular developer, I want typed operations and response models from the gateway so that pages do not duplicate HTTP paths, payloads, or response interfaces.
3. As an operator, I want the existing auth, user, log, permission, and passkey behavior to remain unchanged while the transport is migrated.
4. As a security owner, I want session cookies, tokens, and sensitive response data to stay outside JavaScript storage and logs.

**Acceptance criteria**:

1. **AC-1**: The full public gateway contract represented by `apps/gateway/erp/openapi.yaml` is generated into `packages/angular-sdk/src/generated`, including every current operation for health, auth, passkey, TOTP, users, logs, and access.
2. **AC-2**: `bun run openapi:generate` remains the canonical root command. It generates the service specs, gateway spec, contract fragment, and Angular SDK in order, exits nonzero on failure, and CI does not pass with stale generated output.
3. **AC-3**: Elysia route schemas are the source for request, success response, and main error response shapes. The public auth schema includes the existing `desktop` magic link option. Declared success responses generate useful TypeScript types instead of `unknown`.
4. **AC-4**: The Angular app configures one generated SDK client at bootstrap with `environment.apiUrl` and `credentials: 'include'`. The client does not use bearer tokens or store session credentials in browser storage.
5. **AC-5**: All gateway API requests in `apps/web` use generated SDK operations through Angular domain facades. The only navigation exception is browser navigation to `/api/v1/auth/verify`, which must preserve the magic link redirect and cookie flow.
6. **AC-6**: Generated request and response types are the primary types in `apps/web`. Existing duplicate HTTP response interfaces are removed or reduced to explicit facade mappings that have a documented UI reason.
7. **AC-7**: Facades expose the existing Angular Observable style, adapt the SDK Promise result at the boundary, and provide loading, success, empty, error, and retry state where the page needs it.
8. **AC-8**: Hey API middleware preserves the current navigation correlation headers and request loading behavior. It does not log credentials, cookies, tokens, passkey responses, or sensitive response bodies.
9. **AC-9**: HTTP errors preserve their status and are mapped by the relevant facade into domain errors. Statuses `401`, `403`, `404`, `409`, `410`, `422`, `429`, and upstream `5xx` remain distinguishable where the current UI needs them.
10. **AC-10**: Read requests may be cancelled when a filter or navigation makes them obsolete. Mutations have no automatic retry, are disabled while pending, and expose server conflicts instead of silently repeating the action.
11. **AC-11**: A `401` clears in memory identity state and follows the existing auth guard behavior toward login. Permission decisions remain server owned, and a client guard is only a UX optimization.
12. **AC-12**: No database migration, browser data model, visual redesign, or new public endpoint is introduced. Existing pages and auth behavior remain functionally equivalent.
13. **AC-13**: Tests cover generated operation imports, client configuration, cookie credentials, request and response mapping, correlation middleware, error mapping, cancellation, auth expiry, and the magic link navigation exception.
14. **AC-14**: `bun run openapi:validate`, web typecheck, web unit tests, lint, SDK regeneration, and a clean generated artifact diff pass before the feature is considered complete.

## Options considered

### Option 1: Fix the existing facades in place

Keep the existing Angular facade names and replace their internal `HttpClient` calls with generated SDK calls. This is the smallest code movement and preserves page call sites.

**Pros**:

1. Small initial diff and low page churn.
2. Existing Observable contracts and tests can remain mostly stable.

**Cons**:

1. The mixed `ApiService` still hides several domains behind one boundary.
2. Manual types and transport details can survive unnoticed.
3. The migration is harder to verify by domain.

### Option 2: Strangler migration through domain facades

Introduce the generated client beside the current transport, migrate one domain at a time behind domain facades, then remove manual requests and duplicate types after each slice proves equivalent.

**Pros**:

1. It gives a thin end to end proof before the whole web app changes.
2. Existing page behavior can be compared during each domain migration.
3. Rollback is possible by keeping the old facade boundary until the new path passes.

**Cons**:

1. The repository temporarily contains two transport paths.
2. Every slice needs focused tests so the old path is not accidentally left in use.
3. Facade mapping may add short lived code during the transition.

### Option 3: Directly replace every manual request

Change all Angular services and pages in one migration to call generated operations immediately.

**Pros**:

1. There is no period with two transports.
2. The final architecture appears quickly.

**Cons**:

1. Auth, passkey, TOTP, users, logs, and access can fail together.
2. A single contract or Promise adaptation mistake creates a broad regression.
3. Rollback requires reverting a wide set of application files.

## Decision

**Chosen option**: Option 2: Strangler migration through domain facades

Use the existing `@hey-api/openapi-ts` command to generate the complete public gateway client into `packages/angular-sdk/src/generated`. Keep generated files free of manual edits. `apps/web` imports the package through `#project/angular-sdk`, configures the exported client once at bootstrap, and uses `environment.apiUrl` with `credentials: 'include'`.

Use Elysia route schemas as the only source for public request and response contracts. Add success and main error response schemas at the owning gateway route boundary, and add the existing `desktop` magic link body field to the public schema. Never patch `apps/gateway/erp/openapi.yaml` or generated files by hand.

Keep Angular application behavior behind domain facades. Auth, passkey, TOTP, users, logs, access, and health facades adapt the generated Promise operations to the current Observable page contracts. Generated types are used directly unless a facade needs an explicit UI mapping. The client uses Hey API middleware for navigation correlation and request loading. Magic link verification remains browser navigation because the gateway response is a redirect that must set the browser cookie and move the page.

**Implementation skills**: `angular-developer` (`project/angular-developer`, `/Users/ojiepermana/.agents/skills/angular-developer/`) · `elysiajs` (`project/elysiajs`, `/Users/ojiepermana/.agents/skills/elysiajs/`)

## Feature design

**Data model sketch**:

| Entity | Identity | Fields | Relationship and persistence |
| --- | --- | --- | --- |
| OpenAPI operation | `operationId` | method, path, request parameters, response statuses | One operation produces one generated SDK function, no persistence |
| OpenAPI schema | schema name or inline shape | required fields, nullable fields, arrays, error envelope | Used by one or more operations, owned by route schemas, no persistence |
| Generated SDK operation | generated function name | typed input, typed success data, typed error result | Derived from one OpenAPI operation, stored as committed source artifact |
| Angular domain facade state | runtime service instance | data, loading, empty, error, pending mutation | Consumes generated operations, memory only |

There are no foreign keys, database tables, browser cache records, or new retention rules. Server owned data remains in the existing auth, user, logs, and access services.

**State transitions**:

1. Read operation: `idle` to `pending` to `success` or `empty`, or `pending` to `error`.
2. Mutation: `idle` to `pending` to `success` or `error`. The action is disabled during `pending`.
3. Auth session: `unknown` to `authenticated` or `anonymous`, with `401` moving in memory state to `anonymous` and the existing guard route.
4. SDK generation: `source changed` to `generated` or `generation failed`. A failed generation is not a valid build state.

**API surface**:

The gateway remains the only public HTTP boundary. Every listed operation is generated from the public OpenAPI document and consumed through a facade, except browser navigation for magic link verification.

| Endpoint group | Methods and paths | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| Health | `GET /health` | none | `status`, `service` | public | network, upstream unavailable |
| Auth status | `GET /api/v1/auth/status` | none | generated auth status | public | upstream, mapped HTTP status |
| Magic link | `POST /api/v1/auth/magic-link` | `email`, optional `desktop` | accepted result and expiry data when supplied | public | `422`, `429`, `503` |
| Magic link verify | `GET /api/v1/auth/verify` | `token` from current URL | browser redirect and session cookie | browser navigation | expired or invalid redirect |
| Session | `GET /api/v1/auth/session` | session cookie | authenticated flag and user identity | optional cookie | anonymous response, `503` |
| Logout | `POST /api/v1/auth/logout` | session cookie | logout result and cleared cookie | optional cookie | `503` |
| Passkey registration | `POST /api/v1/auth/passkey/register/options`, `POST /api/v1/auth/passkey/register/verify` | WebAuthn response and optional label | creation options and passkey summary | session | `400`, `401`, `403`, `409`, `410`, `422`, `429` |
| Passkey login | `POST /api/v1/auth/passkey/login/options`, `POST /api/v1/auth/passkey/login/verify` | WebAuthn response | options and login result | options public, verify public | `401`, `409`, `410`, `422`, `429` |
| Passkey management | `GET /api/v1/auth/passkeys`, `PATCH /api/v1/auth/passkeys/{id}`, `DELETE /api/v1/auth/passkeys/{id}` | passkey id and label for rename | passkey list, updated passkey, or delete result | session | `401`, `403`, `404`, `422` |
| TOTP self service | `POST /api/v1/auth/2fa/enroll`, `POST /api/v1/auth/2fa/enroll/confirm`, `GET /api/v1/auth/2fa/status`, `POST /api/v1/auth/2fa/disable`, `POST /api/v1/auth/2fa/recovery-codes` | six digit code, recovery code where applicable | enrollment, status, recovery codes, or result | session | `400`, `401`, `409`, `422`, `429` |
| TOTP login | `POST /api/v1/auth/2fa/verify` | six digit code or recovery code | authenticated result and redirect target | pending login challenge | `401`, `409`, `422`, `429` |
| TOTP administration | `GET /api/v1/auth/admin/users/{id}/2fa`, `POST /api/v1/auth/admin/users/{id}/2fa/reset` | user id and reset reason | status or result | permission | `401`, `403`, `404`, `422` |
| User status | `GET /api/v1/users/status` | none | status information | permission | `401`, `403`, upstream |
| Users | `GET /api/v1/users`, `POST /api/v1/users` | filters, page, id, name, email | paged users or created user | permission | `401`, `403`, `409`, `422` |
| User profile | `GET /api/v1/users/{id}`, `PATCH /api/v1/users/{id}` | user id and optional name | user record | permission | `401`, `403`, `404`, `422` |
| User lifecycle | `DELETE /api/v1/users/{id}`, `POST /api/v1/users/{id}/suspend`, `POST /api/v1/users/{id}/unsuspend`, `POST /api/v1/users/{id}/block`, `POST /api/v1/users/{id}/unblock`, `POST /api/v1/users/{id}/restore` | user id and mandatory reason | updated user record | permission | `401`, `403`, `404`, `409`, `422` |
| User TOTP requirement | `PUT /api/v1/users/{id}/2fa-requirement` | user id, required flag, reason | result | permission | `401`, `403`, `404`, `409`, `422` |
| Audit logs | `GET /api/v1/logs/audit-trails` | search, module, action, actor user id, page | paged audit records and filter options | permission | `401`, `403`, `422`, upstream |
| Access logs | `GET /api/v1/logs/access-logs` | search, event, outcome, actor user id, page | paged access records and filter options | permission | `401`, `403`, `422`, upstream |
| Application logs | `GET /api/v1/logs/application-logs` | search, level, module, event, actor user id, page | paged application records and filter options | permission | `401`, `403`, `422`, upstream |
| Permission catalog | `GET /api/v1/access/permissions`, `POST /api/v1/access/permissions` | search, namespace, page, name, description | paged permissions or created permission | permission | `401`, `403`, `409`, `422` |
| Permission item | `GET /api/v1/access/permissions/{id}`, `PUT /api/v1/access/permissions/{id}`, `DELETE /api/v1/access/permissions/{id}` | permission id and description | permission or delete result | permission | `401`, `403`, `404`, `409`, `422` |
| User permissions | `GET /api/v1/access/users/{userId}/permissions`, `POST /api/v1/access/users/{userId}/permissions`, `POST /api/v1/access/users/{userId}/permissions/copy` | user id, permission ids, source user id | grants or mutation result | permission | `401`, `403`, `404`, `409`, `422` |
| Revoke permission | `DELETE /api/v1/access/users/{userId}/permissions/{permissionId}` | user id and permission id | delete result | permission | `401`, `403`, `404`, `409` |

**Value sourcing**:

| Action | Value produced or displayed | Source |
| --- | --- | --- |
| SDK base URL | gateway origin | `environment.apiUrl`, generated from the root environment allowlist |
| SDK operation | method, path, input and output types | Elysia route schema, generated OpenAPI document, and generated SDK |
| Request query | search, filters, page, and actor ids | Angular facade arguments from the current page state |
| Request body | email, labels, codes, reasons, ids, and flags | Angular form or mutation input validated by the generated operation type |
| Response data | user, auth, passkey, TOTP, log, permission, and health values | Gateway response validated and described by the route response schema |
| HTTP error | status and error envelope | Fetch `Response` and generated error result, mapped by the facade |
| Session identity | current user and permissions | `GET /api/v1/auth/session` response and browser cookie |
| Cookie transport | session cookie sent to gateway | browser cookie policy and SDK `credentials: 'include'` |
| Correlation headers | `x-correlation-id`, `x-client-route` | existing `NavigationCorrelationService` state, forwarded by Hey API middleware |
| Loading state | request pending and settled state | Hey API middleware hooks and facade runtime state |
| Magic link target | redirect URL and token | current browser URL and fixed gateway verify route, never local storage |
| Empty state | no rows and page metadata | typed list response `data` and `meta` from the gateway |
| Error copy | safe user facing message | facade status mapping and fixed application copy, never raw credential data |

**Key invariants**:

1. The attached public OpenAPI document is an output, not a hand edited source.
2. Elysia route schemas own request and response shapes.
3. Generated files are regenerated and committed, never manually edited.
4. `@ojiepermana/angular` remains a UI dependency. It does not import this application contract.
5. `apps/web` imports the package through `#project/angular-sdk`, not the generated folder path.
6. One SDK client owns base URL and credentials configuration.
7. Session cookies remain browser managed. Tokens, passkey responses, and secrets never enter storage or logs.
8. Permission enforcement remains on the gateway and owning services. Client visibility does not grant access.
9. The verify magic link call remains browser navigation, not a Fetch response operation.
10. Mutations do not retry automatically and cannot be submitted twice while pending.
11. Obsolete reads are cancelled or ignored so an older response cannot overwrite newer filter state.
12. The generated artifact diff must be empty after a clean regeneration.

**Security model**:

The browser uses the existing HttpOnly session cookie. The SDK sends it with `credentials: 'include'` and does not create bearer headers. The gateway remains responsible for session validation and permission checks, and services continue their independent checks. A client guard may hide a page or action, but it is never the authorization boundary.

The SDK middleware may add validated correlation metadata already produced by the navigation service. It must not log request bodies, response bodies, headers containing cookies or authorization values, passkey responses, magic link tokens, TOTP secrets, or recovery codes. A `401` clears in memory identity and follows the existing login route. PII and log content remain in memory only for the current operation and are not cached globally.

**Configuration required**:

1. `environment.apiUrl`: existing public gateway URL generated from the root environment configuration.
2. No new secret, token, database, or browser storage configuration.

**Critical test scenarios**:

1. Regenerate the public gateway OpenAPI and SDK, then confirm all operation exports and typed response models exist, verifies **AC-1**, **AC-2**, and **AC-3**.
2. Start Angular with a configured API URL and inspect a request to confirm the gateway URL and browser credentials are used, verifies **AC-4**.
3. Request a user or log page and confirm the facade calls the generated operation with typed filters and keeps loading, empty, success, and error states, verifies **AC-5**, **AC-6**, and **AC-7**.
4. Navigate between filtered list pages quickly and confirm an obsolete read cannot overwrite the latest state, verifies **AC-10**.
5. Trigger a navigation and confirm generated requests carry the existing correlation and client route headers, verifies **AC-8**.
6. Return `401`, `403`, `404`, `409`, `422`, `429`, and `503` from a test transport and confirm each required facade mapping remains distinguishable, verifies **AC-9** and **AC-11**.
7. Submit a mutation twice while the first request is pending and confirm only one request is sent, verifies **AC-10**.
8. Open a valid and invalid magic link and confirm browser navigation, redirect behavior, cookie handling, and generic error copy remain unchanged, verifies **AC-5**, **AC-11**, and **AC-12**.
9. Run the complete validation gate and confirm generated directories have no diff after regeneration, verifies **AC-13** and **AC-14**.

## Rationale

The repository already has the generator, generated output, root import map, and CI contract for generated artifacts. Extending that path is cheaper and more coherent than placing backend types inside the UI library. Completing response schemas is necessary because input only generation leaves Angular with the same `unknown` response problem it has today.

The strangler path fits the Tracer Bullet delivery approach and the existing web risk. A thin health and session slice can prove client configuration, cookie transport, middleware, response typing, and facade adaptation before auth and domain pages move. Keeping browser navigation for magic link verification preserves the security behavior that a normal Fetch call would not reproduce.

## Build plan

1. Add or complete public request, success, and error response schemas at the Elysia gateway route boundaries, including the `desktop` magic link option, and add focused route contract tests, satisfies **AC-3** and **AC-12**.
2. Run the existing root generator, verify the full operation and response type export set, and commit gateway OpenAPI, contract fragments, and generated SDK artifacts, satisfies **AC-1**, **AC-2**, **AC-3**, and **AC-14**.
3. Configure the single exported SDK client from `environment.apiUrl` with `credentials: 'include'`, then add Hey API middleware for correlation and request loading, satisfies **AC-4** and **AC-8**.
4. Migrate the health and session gate thin thread through a typed facade while preserving the Observable page boundary and browser cookie behavior, satisfies **AC-5**, **AC-6**, **AC-7**, and **AC-11**.
5. Migrate magic link, logout, passkey, and TOTP facades. Keep verify magic link as browser navigation, and preserve all current login, challenge, cancellation, and error states, satisfies **AC-5**, **AC-7**, **AC-9**, **AC-11**, and **AC-12**.
6. Migrate users, logs, and access facades one domain at a time, replacing manual request paths and duplicate response interfaces with generated types and deliberate UI mappings, satisfies **AC-5**, **AC-6**, **AC-7**, and **AC-10**.
7. Add focused Angular transport and facade tests for credentials, middleware, typed payloads, cancellation, mutation guards, status mapping, empty lists, session expiry, and sensitive data redaction, satisfies **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, and **AC-13**.
8. Remove the old direct gateway `HttpClient` calls and unused manual contract types, then run OpenAPI validation, web typecheck, tests, lint, and clean regeneration checks, satisfies **AC-5**, **AC-6**, **AC-12**, **AC-13**, and **AC-14**.

## Consequences

**Positive**:

1. OpenAPI, generated SDK, and Angular request code share one public contract.
2. Response types become useful to the compiler instead of remaining mostly `unknown`.
3. Cookie, error, loading, and correlation behavior remain explicit at one client boundary.
4. Domain facades keep page state independent from generated transport details.
5. The migration can be proven in vertical slices and rolled back by domain.

**Negative / tradeoffs**:

1. The migration temporarily maintains old and new transport paths.
2. Elysia gateway schemas must describe response and error shapes in addition to request validation.
3. Hey API middleware becomes a second request lifecycle that maintainers must understand beside Angular providers.
4. Generated output changes when generator or public schema changes, so CI and committed artifacts remain part of every API change.
5. Promise to Observable adaptation adds a boundary that can mishandle cancellation if it is implemented without an abort signal.

**Neutral**:

1. No database migration or new runtime service is needed.
2. The existing `openapi:sdk` command remains the generator entry point.
3. `@ojiepermana/angular` continues to own UI composition, theme, navigation, and page components only.
4. The public gateway paths and authorization model remain unchanged.

## Follow-up

1. [ ] Capture `angular-developer` conventions in the root `AGENTS.md` before implementation begins. The repository currently has `CLAUDE.md` but no `AGENTS.md`.
2. [ ] Capture `elysiajs` route schema conventions in the root `AGENTS.md` before contract schema work begins.
3. [ ] Run `/check verify` for the complete generated client migration, including browser cookie, correlation, auth expiry, and sensitive data checks.
4. [ ] Decide whether `@hey-api/openapi-ts` should move from the current `latest` package range to an explicit version policy after the first stable generated contract release.

## Migration plan

**Strategy**: strangler migration

**Phases**:

1. Add source response schemas and regenerate the contract and SDK without changing page behavior.
2. Configure the generated client and migrate health plus session as the first vertical thread.
3. Migrate auth, passkey, and TOTP, then users, logs, and access in separate domain slices.
4. Remove direct gateway `HttpClient` calls and duplicate contract types after focused tests pass.
5. Make regeneration, OpenAPI validation, typecheck, lint, tests, and clean generated diff the completion gate.

**Rollback**: Keep the existing facade methods until each slice passes. If a slice fails, revert that facade implementation to its prior transport while leaving the generated artifacts and source schemas intact. Revert the entire migration commit only if the client configuration or middleware breaks application startup.

**Risks**: A missing gateway response schema can silently produce weak types. A generated Fetch request can bypass Angular interceptors. A malformed error mapping can turn permission or session failures into generic UI errors. A direct Fetch call for magic link verification can lose browser redirect behavior. Focused contract, transport, and browser tests are required before removing the old path.
