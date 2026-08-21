# 0003. Build magic link authentication and sessions

**Date**: 2026-08-20
**Status**: In Progress

## Summary

Auth service memakai magic link email untuk login dan session server side yang disimpan di PostgreSQL. Browser menerima cookie HttpOnly secure, sedangkan gateway meneruskan identity yang sudah diverifikasi melalui header HMAC ke service internal. Fase pertama adalah single organization dengan role global, tanpa password, MFA, SSO, atau tenant membership.

## Context

Monorepo sudah memiliki auth service, schema `auth`, tabel user, login token, session, dan rate limit, tetapi belum memiliki alur login yang dapat digunakan. Migration awal menyimpan bentuk token dan session yang belum cukup untuk hash token, expiry idle, expiry absolute, atau revoke session.

Sistem enterprise membutuhkan login yang tidak menyimpan password serta batas yang jelas antara browser session, gateway, dan service domain. SMTP harus dapat diganti per deployment tanpa vendor lock in. Fase pertama hanya melayani satu organisasi secara eksplisit, sehingga role global cukup untuk authorization awal dan `organization_id` belum masuk ke entity domain.

> Premise note: Auth feature ini mencakup login magic link, session, role authorization, dan identity forwarding. MFA, OIDC atau SSO, tenant membership, password login, serta halaman web callback adalah keputusan dan feature terpisah yang tidak boleh diselipkan ke build ini.

## Requirements

**User stories**:

- As a registered user, I want to request a magic link so that I can sign in without a password.
- As an authenticated user, I want my browser session to survive normal page navigation and expire predictably so that access remains safe.
- As a service, I want to receive a verified signed identity so that I can authorize requests without reading the auth schema directly.
- As an operator, I want expired tokens, revoked sessions, and rate limits to be safe under retry and concurrent requests.

**Acceptance criteria**:

- **AC-1**: A registered email can request a magic link. The response status and body are identical for registered and unregistered email addresses, and only a registered address receives an email.
- **AC-2**: Each magic link contains a raw random token that is never stored in the database. The database stores only its SHA 256 hash, the token expires after 15 minutes, and a successful consume marks it used atomically.
- **AC-3**: Consuming a valid token creates one session, sets an HttpOnly secure SameSite cookie, and redirects to `WEB_APP_URL/auth/callback-complete`. An expired, used, malformed, or unknown token never creates a session and redirects generically to `WEB_APP_URL/auth/callback-error`.
- **AC-4**: A session is valid only while it is not revoked, its idle expiry has not passed, and its absolute expiry has not passed. Idle lifetime is 8 hours and absolute lifetime is 7 days. Logout revokes the current session and clears the cookie.
- **AC-5**: `GET /api/v1/auth/session` returns only `authenticated`, user id, email, name, role, and session expiry values. It never returns a raw token, session cookie value, token hash, or rate limit key.
- **AC-6**: Magic link requests are limited to 5 attempts per 15 minutes for both the normalized email hash and the source IP hash. The rate limit update is atomic and does not store the raw email as a key.
- **AC-7**: The gateway validates the session cookie and forwards a canonical identity payload signed with HMAC SHA 256. Internal services reject missing, expired, malformed, or invalidly signed identity headers.
- **AC-8**: Admin and manager roles may access admin protected routes, bi and staff roles may access operational protected routes, and legacy users are authenticated but read only. Unknown or suspended users are denied.
- **AC-9**: SMTP failures, database failures, duplicate requests, concurrent token consume, and repeated logout fail without creating duplicate active sessions or exposing sensitive values in response or logs.
- **AC-10**: A daily cleanup job removes expired or used login tokens, revoked or expired sessions, and inactive rate limit rows without affecting active sessions or users.

## Options considered

### Option 1: Magic link with server side cookie sessions

The auth service creates a short lived hashed login token, sends the raw token through SMTP, and creates a PostgreSQL session after atomic consume. The gateway validates that session and signs internal identity headers.

**Pros**:

- No password storage or password reset flow.
- Revocation and idle expiry are controlled centrally in PostgreSQL.
- Existing auth tables and Bun SQL stack can support it without a new identity vendor.

**Cons**:

- Login depends on email delivery and SMTP operations.
- Gateway and services need shared HMAC secret rotation discipline.

### Option 2: JWT access and refresh tokens

Auth issues signed access tokens and rotates refresh tokens for browser or API clients.

**Pros**:

- Services can validate tokens without a database read for every request.
- Useful for clients that cannot use cookies.

**Cons**:

- Revocation, refresh reuse detection, cookie security, and logout are more complex than the current need.
- Token claims can remain stale after role or suspension changes.

### Option 3: Hosted identity provider

A hosted provider owns login, email delivery, sessions, and identity claims.

**Pros**:

- Less authentication code to operate.
- Provider may later offer MFA and SSO.

**Cons**:

- Adds vendor dependency and migration work from the existing auth schema.
- Current repository has no provider decision or integration boundary.

## Decision

**Chosen option**: Option 1: Magic link with server side cookie sessions

Implement magic link authentication in the auth service with SMTP deployment configuration, PostgreSQL hashed tokens and sessions, gateway HMAC identity forwarding, and role based authorization for a single organization.

**Implementation skills**: `elysiajs` (`project/elysiajs`, `/Users/ojiepermana/.agents/skills/elysiajs/`)

## Rationale

The existing user and auth schemas already contain users, login tokens, sessions, and rate limits, so server side magic link sessions extend the current foundation without introducing an identity provider or password lifecycle. Hashing raw tokens, atomic consume, and bounded session expiry address the highest risk paths directly.

The engineer selected SMTP relay rather than a named provider, which keeps local and enterprise deployment flexible. The cost is that infrastructure must own deliverability, credentials, DNS, and monitoring. HMAC identity forwarding preserves service schema isolation, while the single organization boundary keeps the first authorization model small and explicit.

## Feature design

**Data model sketch**:

- `user.users`: existing `id uuid` UUIDv7 primary key, required unique `email`, required `name`, required `role`, nullable `email_verified_at` and `suspended_at`, `created_at`, `updated_at`. No organization field in the single organization phase.
- `auth.login_tokens`: `id uuid` UUIDv7 primary key, required `user_id` foreign key to `user.users.id`, required unique `token_hash char(64)`, required `expires_at timestamptz`, nullable `used_at`, required `created_at`. Raw token is never persisted.
- `auth.sessions`: `id uuid` UUIDv7 primary key, required unique `session_token_hash char(64)`, required `user_id` foreign key to `user.users.id`, required `idle_expires_at`, required `absolute_expires_at`, required `last_activity`, nullable `revoked_at`, nullable request metadata, required `created_at` and `updated_at`.
- `auth.auth_rate_limits`: `id uuid` UUIDv7 primary key, required `key_hash char(64)`, required `key_type` with values `email` or `ip`, required `window_started_at`, required positive `attempts`, required `updated_at`, unique `(key_type, key_hash)`.

One user has many login tokens and sessions. Rate limit rows have no business foreign key. No service schema has a foreign key outside the auth-owned session tables; internal identity carries the user UUID through the gateway contract.

**State transitions**:

- Login token: `issued → consumed` or `issued → expired`. `consumed` and `expired` are terminal.
- Session: `active → revoked` by logout or security action, or `active → expired` when idle or absolute expiry passes. Expired and revoked sessions are terminal.

**API surface**:

| Endpoint                     | Method | Key inputs                           | Key outputs                                  | Auth                              | Key errors                                                                          |
| ---------------------------- | ------ | ------------------------------------ | -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `/api/v1/auth/magic-link`    | POST   | `email:string` required              | Generic accepted message                     | Public, rate limited              | `400` invalid email, `429` rate limit, `503` SMTP or database failure               |
| `/api/v1/auth/verify?token=` | GET    | `token:string` required              | `302` redirect and session cookie            | Public, one time token            | `400` malformed token, `410` expired or used token, `503` database failure          |
| `/api/v1/auth/session`       | GET    | Session cookie optional              | `authenticated`, user identity, role, expiry | Cookie optional                   | `401` only when a present cookie is invalid; missing cookie returns unauthenticated |
| `/api/v1/auth/logout`        | POST   | Session cookie optional              | Generic logout response and cleared cookie   | Authenticated cookie when present | `204` or idempotent success when already logged out, `503` database failure         |
| `/internal/auth/identity`    | GET    | Signed identity headers from gateway | Verified user id, email, role, expiry        | Internal HMAC                     | `401` missing or invalid signature, `403` suspended or disallowed role              |

The gateway applies session validation before signing identity headers for public service routes. The canonical signature input is HTTP method, normalized path, user id, role, and expiry joined with a fixed newline format. The signature is HMAC SHA 256 over UTF 8 bytes of that input. Services reject timestamps outside a short configured clock skew and never trust unsigned identity fields.

**Value sourcing**:

| Action             | Value produced or displayed                                              | Source                                                                                     |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Request magic link | Normalized email, email hash, IP hash, rate decision                     | Request body, request IP, SHA 256 derivation, `auth.auth_rate_limits`                      |
| Send magic link    | Raw token and link URL                                                   | Cryptographically random runtime value and `PUBLIC_API_URL` plus fixed verify path         |
| Consume token      | User id and token state                                                  | SHA 256 of query token and `auth.login_tokens` row                                         |
| Create session     | Session cookie value and expiry values                                   | Cryptographically random runtime value, `now()`, and fixed 8 hour or 7 day durations       |
| Session endpoint   | Authenticated flag, user id, email, name, role, idle and absolute expiry | Session cookie hash, `auth.sessions`, and `user.users`                                     |
| Signed identity    | User id, email, role, expiry, signature                                  | Validated session row and HMAC over the canonical identity input                           |
| Rate limit         | Allowed or rejected decision                                             | `key_type`, SHA 256 email or IP key, window start, and attempts in `auth.auth_rate_limits` |
| Cleanup            | Rows removed by category and count                                       | Expiry and revoke columns in auth tables, derived at cleanup time                          |

**Key invariants**:

- Email is normalized before lookup and remains unique in `user.users`.
- Raw magic link and session values never enter PostgreSQL, structured logs, or response bodies.
- Token consume and session creation occur in one transaction with a row lock. A token can create at most one session.
- A suspended user cannot request or consume a login token and cannot use an existing session.
- Rate limit increments are atomic and keyed by hashed email or hashed IP.
- Cookie is HttpOnly, Secure outside local development, SameSite Lax, scoped to the configured auth cookie path, and never exposed to JavaScript.
- Internal identity expires with the session and is accepted only with a valid HMAC signature and bounded clock skew.
- Phase one is single organization. No endpoint claims tenant context or accepts client supplied organization identifiers.

**Security model**:

Magic link request and verify are public but rate limited and return generic responses that do not reveal account existence. Only registered, unsuspended users may receive or consume a token. Session, logout, and identity endpoints use the session cookie. Admin and manager roles are authorized for admin routes, bi and staff for operational routes, and legacy is read only. The auth schema is private to auth runtime; other services receive only signed identity headers. SMTP credentials, HMAC secret, and session cookie settings are deployment secrets or configuration. No regulated compliance scope is declared for this phase.

**Configuration required**:

- `SMTP_HOST`: SMTP relay host.
- `SMTP_PORT`: SMTP relay port.
- `SMTP_USERNAME`: SMTP relay username.
- `SMTP_PASSWORD`: SMTP relay password from secret manager.
- `SMTP_FROM`: verified sender address.
- `PUBLIC_API_URL`: API Gateway origin used in email verify links.
- `WEB_APP_URL`: fixed allowed redirect origin.
- `INTERNAL_AUTH_SIGNING_SECRET`: HMAC secret shared by gateway and internal services.
- `AUTH_SESSION_COOKIE_NAME`: session cookie name.
- `AUTH_COOKIE_SECURE`: secure cookie setting, true outside local development.
- `AUTH_CLOCK_SKEW_SECONDS`: accepted internal signature clock skew.

**Critical test scenarios**:

- Happy path: registered email receives a link, valid verify creates one session and redirects with a secure cookie, verifies **AC-1**, **AC-2**, **AC-3**.
- Enumeration: registered and unregistered email produce identical response status and body, verifies **AC-1**.
- Concurrency: two simultaneous consumes of one token create at most one session, verifies **AC-2**, **AC-9**.
- Expiry: expired token, idle session, absolute session, and revoked session are rejected, verifies **AC-3**, **AC-4**.
- Rate limit: sixth request for the same hashed email or IP in the window is rejected without raw key storage, verifies **AC-6**.
- SMTP failure: bounded provider failure returns safe error and does not create a session, verifies **AC-9**.
- Internal authorization: missing, expired, or invalid HMAC identity is rejected by a service, verifies **AC-7**, **AC-8**.
- Role access: admin or manager, bi or staff, and legacy users receive the defined authorization outcomes, verifies **AC-8**.
- Cleanup: cleanup removes only expired, used, revoked, or inactive rows and preserves active session and user rows, verifies **AC-10**.

## Build plan

1. Add the auth migration that replaces raw login token storage with `token_hash`, adds session idle and absolute expiry fields, adds revoke state, and adds typed rate limit keys. Satisfies **AC-2**, **AC-4**, **AC-6**.
2. Implement token hashing, secure random values, normalization, atomic consume, session validation, revoke, and rate limit repository operations. Satisfies **AC-2**, **AC-4**, **AC-6**, **AC-9**.
3. Implement the SMTP adapter and magic link service with bounded timeout, generic response behavior, and safe structured logging. Satisfies **AC-1**, **AC-9**.
4. Implement the four public auth routes, cookie policy, redirect contract, and session response projection. Satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5**.
5. Add gateway session validation and HMAC identity forwarding, then add service authorization middleware for role checks. Satisfies **AC-7**, **AC-8**.
6. Add daily cleanup worker and schedule, then add unit, integration, and service contract tests for all critical scenarios. Satisfies **AC-9**, **AC-10**.
7. Add the web callback route contract and deployment documentation for SMTP and HMAC secret provisioning. Satisfies **AC-3**, **AC-7**.

## Consequences

**Positive**:

- Users do not need passwords and raw authentication secrets are not stored.
- Session revocation, expiry, and role changes take effect through PostgreSQL state.
- Service schemas remain isolated from auth data.
- SMTP and HMAC configuration can be operated per environment without adding a vendor SDK.

**Negative / tradeoffs**:

- Email delivery is a hard dependency for login and must be monitored by deployment owners.
- Every gateway and service must share and rotate the HMAC secret safely.
- Session validation performs database work and needs cleanup and indexing.
- Single organization is an explicit limitation. Adding organizations later requires membership, organization scope on domain tables, and authorization changes.

**Neutral**:

- Password login, MFA, OIDC or SSO, tenant membership, and web page design are outside this feature.
- Role values remain global in `user.users` until a separate organization authorization decision.
- The auth migration must be forward only after the current migration history has been applied.

## Follow-up

- [ ] Provision SMTP relay, sender DNS, and secret manager values for each deployment environment.
- [ ] Add the web callback route and user facing login screens as a separate UI feature.
- [ ] Design MFA or OIDC before enterprise identity requirements are introduced.
- [ ] Design tenant membership and organization scoped authorization before multi organization support.

## References

**Project sources**:

- `docs/specs/0001-enterprise-monorepo-foundation.md`, service boundaries, Bun, Elysia, and shared package decisions.
- `docs/specs/0002-central-multischema-database-tooling.md`, PostgreSQL 18, UUIDv7, schema ownership, grants, and migration rules.
- `packages/database/migrations/auth/0001_auth_foundation.up.sql`, existing auth entities and global roles.
- `apps/services/auth/src/app.ts` and `apps/api-gateway/src/routes/proxy.route.ts`, current HTTP composition and forwarding boundaries.
- `packages/database/src/index.ts`, Bun SQL transaction helper and client lifecycle.
- `/Users/ojiepermana/.agents/skills/elysiajs/`, Elysia route, validation, plugin, and testing conventions.

**Practices & standards**:

- One time token hashing and atomic consume.
- HttpOnly secure cookie sessions with server side revocation.
- Generic authentication responses to reduce account enumeration.
- Least privilege and signed identity forwarding between services.
- Rate limiting public authentication endpoints.
