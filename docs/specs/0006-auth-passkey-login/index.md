# 0006. Add passkey login alongside magic link

**Date**: 2026-08-21
**Status**: In Progress

## Summary

Web app mendapat metode login kedua berupa passkey (WebAuthn, login dengan sidik jari, face unlock, atau hardware key yang terikat ke domain). Magic link tetap ada tanpa perubahan dan menjadi jalur recovery universal, sehingga tidak dibutuhkan alur pemulihan akun baru. Login passkey membuat session yang sama persis dengan session magic link, jadi gateway, cookie, dan authorization tidak berubah. Desktop Tauri tetap memakai magic link karena WebAuthn di webview desktop belum andal.

## Requirements

**User stories**:

- As a registered user, I want to sign in with a passkey so that login is faster and resistant to phishing, without losing magic link.
- As a user with several devices, I want to list, rename, and delete my passkeys so that I control which devices can sign in.
- As a desktop app user, I want magic link to keep working unchanged so that the Tauri shell is never blocked by missing WebAuthn support.
- As an operator, I want challenges, rate limits, and signature counters to be safe under retry and concurrent requests.

**Acceptance criteria**:

- **AC-1**: The login page shows the passkey button only when the runtime supports WebAuthn and is not the Tauri desktop shell. Desktop and unsupported browsers see the unchanged magic link form only, and never call passkey endpoints from the UI.
- **AC-2**: An authenticated user can register a passkey. The server issues a single use registration challenge bound to that user, verifies the attestation response, and stores the credential with label, counter, transports, aaguid, and backup flags. A user holds at most 5 passkeys; the sixth registration attempt is rejected with a clear error, and a credential id already registered anywhere is rejected.
- **AC-3**: A user with a discoverable passkey can sign in from the login page without typing an email. The server issues a single use authentication challenge, verifies the assertion, and creates a session identical in shape and lifetime to a magic link session (same HttpOnly secure cookie policy, 8 hour idle expiry, 7 day absolute expiry). Successful login updates the stored counter and `last_used_at`.
- **AC-4**: Magic link login keeps working unchanged for every user, with or without passkeys. Deleting the last passkey is allowed because magic link remains the recovery path.
- **AC-5**: After a successful magic link login, a user with zero passkeys sees one dismissible prompt to register a passkey. Dismissal persists per browser and the prompt does not keep reappearing.
- **AC-6**: The account management surface lists the user's passkeys with label, created date, and last used date. A user can rename and delete only their own passkeys. Delete removes the row permanently and writes a structured log entry.
- **AC-7**: A challenge is single use and expires 5 minutes after issue. An expired, used, unknown, or tampered challenge, or an attestation or assertion that fails verification, never stores a credential or creates a session. Errors on public endpoints are generic and do not reveal account existence.
- **AC-8**: Public passkey endpoints are rate limited to 10 attempts per 15 minutes per hashed source IP, atomically, reusing `auth.auth_rate_limits`. A suspended user can neither register nor sign in with a passkey.
- **AC-9**: A signature counter regression (possible cloned authenticator) rejects the login and writes a warning log without deleting the credential. Two concurrent verifications of the same challenge create at most one session or one credential.
- **AC-10**: The daily cleanup job also removes expired or used WebAuthn challenges without touching credentials, active sessions, or users.

## Decision

**Chosen option**: Option 1: SimpleWebAuthn on the existing auth service

Implement passkey registration, login, and management inside the existing auth service with `@simplewebauthn/server`, `@simplewebauthn/browser` in the web app, two new `auth` schema tables, and full reuse of the session, cookie, rate limit, and cleanup machinery from spec 0003. Magic link stays untouched as the universal fallback.

**Implementation skills**: `elysiajs` (`project/elysiajs`, `/Users/ojiepermana/.agents/skills/elysiajs/`) · `angular-developer` (`/Users/ojiepermana/.agents/skills/angular-developer/`)

## Feature design

**Data model sketch**:

- `auth.passkey_credentials`: `id uuid` UUIDv7 primary key, required `user_id` foreign key to `user.users.id`, required unique `credential_id text` (base64url from the authenticator), required `public_key bytea` (COSE public key), required `counter bigint` default 0, nullable `transports text[]`, nullable `aaguid uuid`, required `label text`, required `backup_eligible boolean` and `backup_state boolean`, required `created_at` and `updated_at`, nullable `last_used_at`. Hard delete on removal; at most 5 rows per user.
- `auth.webauthn_challenges`: `id uuid` UUIDv7 primary key, required `type` with values `registration` or `authentication`, nullable `user_id` foreign key (required for registration, null for usernameless login), required `challenge text` (random base64url), required `expires_at timestamptz` (5 minutes), nullable `used_at`, required `created_at`. Single use with atomic consume.
- `auth.auth_rate_limits`: existing table; the `key_type` check constraint gains the value `passkey_ip`.
- `auth.sessions` and `user.users` are reused unchanged.

One user has many passkey credentials and many challenges. A passkey login creates a normal `auth.sessions` row.

**State transitions**:

- Challenge: `issued → consumed` or `issued → expired`. Both terminal.
- Credential: `registered → deleted` (hard delete). Counter and `last_used_at` update on each successful login.

**API surface** (public routes go through the gateway like the spec 0003 auth routes):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/auth/passkey/register/options` | POST | Session cookie | Creation options with challenge, excluded credential ids | Session cookie | `401`, `409` passkey limit reached, `503` |
| `/api/v1/auth/passkey/register/verify` | POST | Attestation response JSON, optional `label` | Created credential summary | Session cookie | `400` verification failed, `401`, `409` duplicate credential or limit, `410` challenge expired or used |
| `/api/v1/auth/passkey/login/options` | POST | None | Request options with challenge | Public, rate limited | `429`, `503` |
| `/api/v1/auth/passkey/login/verify` | POST | Assertion response JSON | Authenticated user summary, session cookie set | Public, rate limited | `401` generic verification failure, `410` challenge expired or used, `429`, `503` |
| `/api/v1/auth/passkeys` | GET | Session cookie | List of id, label, created, last used, backup state | Session cookie | `401` |
| `/api/v1/auth/passkeys/:id` | PATCH | `label:string` required | Updated credential summary | Session cookie | `401`, `404` not found or not owned |
| `/api/v1/auth/passkeys/:id` | DELETE | None | `204` | Session cookie | `401`, `404` not found or not owned |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Registration options | Challenge | Cryptographically random runtime value, stored in `auth.webauthn_challenges` |
| Registration options | RP ID and RP name | Hostname of `WEB_APP_URL`, overridable by `WEBAUTHN_RP_ID`; `WEBAUTHN_RP_NAME` |
| Registration options | User handle and excluded credentials | `user.users.id` from the session; `auth.passkey_credentials` by `user_id` |
| Registration verify | Expected challenge, origin, RP ID | Consumed challenge row; `WEB_APP_URL`; derived RP ID |
| Registration verify | Stored credential fields | Verified attestation response from the library |
| Registration verify | Label | Request body if given, else aaguid lookup of known authenticators, else a generic name with the registration date |
| Login options | Challenge | Random runtime value, stored with null `user_id` |
| Login verify | Credential lookup | `credential_id` inside the assertion, matched against `auth.passkey_credentials` |
| Login verify | Counter decision | Stored `counter` column compared with the assertion counter |
| Login verify | Session cookie and expiries | Random runtime value plus the fixed 8 hour and 7 day durations from spec 0003 |
| Passkey list | Label, created, last used, backup state | `auth.passkey_credentials` columns; public key is never returned |
| Post login prompt | Show or hide decision | Passkey count from the list endpoint plus a dismissal flag in browser localStorage |
| Rate limit | Allow or reject decision | SHA 256 hash of the source IP with key type `passkey_ip` in `auth.auth_rate_limits` |
| Cleanup | Removed challenge rows | `expires_at` and `used_at` in `auth.webauthn_challenges` |

**Key invariants**:

- Passkey login never bypasses the session rules of spec 0003: revocation, idle expiry, absolute expiry, and suspension all apply identically.
- Challenge consume plus credential creation, or challenge consume plus session creation, happen in one transaction with a row lock. A challenge yields at most one credential or one session.
- `credential_id` is globally unique; the 5 passkey cap is enforced inside the registration transaction.
- Raw challenges are never logged; public keys are stored but never returned by list or session endpoints.
- The magic link flow, its routes, and its tests remain behavior identical; this feature only adds code paths.
- RP ID and expected origin come from server configuration; the client never supplies them.
- The server validates everything regardless of UI gating; hiding the button is convenience, not security.

**Security model**:

Registration and management require an authenticated session of any role and operate only on the caller's own credentials. Login options and verify are public but rate limited by hashed IP, with generic error bodies to avoid account enumeration. User verification is requested as `preferred`. Suspended users are rejected at options and verify. The gateway forwards passkey routes exactly like other public auth routes and keeps signing HMAC identity from the session; no service other than auth reads the `auth` schema. Public keys are not secrets; no new compliance scope is introduced.

**Configuration required**:

- `WEBAUTHN_RP_ID`: optional override of the relying party id; default is the hostname of the existing `WEB_APP_URL`.
- `WEBAUTHN_RP_NAME`: display name shown by authenticators during the ceremony; default `Monobungsya`.

**Critical test scenarios**:

- Happy path: register a passkey while logged in via magic link, log out, sign in with the passkey, receive an identical session cookie, verifies **AC-2**, **AC-3**.
- Fallback intact: a user with passkeys still completes a full magic link login; deleting the last passkey succeeds, verifies **AC-4**, **AC-6**.
- Challenge safety: expired, reused, and tampered challenges are rejected; two concurrent verifies of one challenge create at most one session, verifies **AC-7**, **AC-9**.
- Limits: the sixth passkey registration and the eleventh public attempt per IP in the window are rejected atomically, verifies **AC-2**, **AC-8**.
- Clone signal: an assertion with a regressed counter is rejected with a warning log and the credential survives, verifies **AC-9**.
- Gating: Tauri runtime and a browser without WebAuthn support never render the passkey button, verifies **AC-1**.
- Ownership: renaming or deleting another user's credential returns not found, verifies **AC-6**.
- Cleanup: the daily job removes only expired or used challenges, verifies **AC-10**.

## Build plan

Ordered as Tracer Bullet slices: a thin end to end thread first (register once, sign in once, through database, service, gateway, SDK, and web), then thickened with management, prompts, and hardening.

1. [x] Add migration `0009` creating `auth.passkey_credentials` and `auth.webauthn_challenges` and extending the `key_type` check constraint with `passkey_ip`, satisfies **AC-2**, **AC-3**, **AC-8**.
2. [x] Implement the ceremony core in the auth service: challenge issue and atomic consume, SimpleWebAuthn registration and authentication verification, credential repository operations, and session creation reusing the spec 0003 session operations inside one transaction, satisfies **AC-2**, **AC-3**, **AC-7**, **AC-9**.
3. [x] Expose the four ceremony routes and three management routes with Elysia schemas, wire them through the gateway public surface, and regenerate the OpenAPI specs and Angular SDK, satisfies **AC-2**, **AC-3**, **AC-6**, **AC-7**.
4. [x] Build the thin web thread: passkey button on the login page behind WebAuthn feature detection and the existing Tauri runtime detection, a minimal register action for an authenticated user, and passkey sign in end to end with `@simplewebauthn/browser` and the generated SDK, satisfies **AC-1**, **AC-3**, **AC-4**.
5. [x] Thicken the web surface: the passkey management list with rename and delete, and the one time dismissible prompt after magic link login with localStorage persistence, satisfies **AC-5**, **AC-6**.
6. [x] Hardening: the 5 passkey cap and duplicate credential rejection, `passkey_ip` rate limiting, suspension checks, counter regression rejection with warning logs, and structured logs for register, delete, and login, satisfies **AC-2**, **AC-8**, **AC-9**.
7. [x] Extend the daily cleanup worker for expired or used challenges, add unit and integration tests for every critical scenario, and document the two optional env vars in `.env.example`, satisfies **AC-7**, **AC-10**.

## Consequences

**Positive**:

- Users gain a phishing resistant login that does not depend on email delivery or SMTP health.
- Session, gateway, authorization, and identity forwarding are untouched, so the blast radius is small.
- Magic link as the permanent fallback removes the need for a separate account recovery flow.

**Negative / tradeoffs**:

- Two login paths must be maintained and tested from now on.
- Passkeys bind to the web origin: changing the production domain of `WEB_APP_URL` invalidates every registered passkey, while magic link survives such a move.
- Browser and platform authenticator variability becomes a support surface (differing dialogs, sync behavior, cancellations).
- The SimpleWebAuthn dependency must be kept current as the WebAuthn spec evolves.

**Neutral**:

- Desktop Tauri users see no passkey option until webview WebAuthn support matures; that revisit is a separate decision.
- Localhost development works because WebAuthn treats localhost as a secure context.
- Conditional UI autofill (passkey suggestions inside the email field) is deliberately deferred.
- Role authorization and the single organization boundary are unchanged.

## Follow-up

- [ ] Consider conditional UI autofill on the login email field as a later web enhancement.
- [ ] Revisit passkey support in the Tauri desktop shell when webview WebAuthn support matures (separate decision).
- [ ] WebAuthn community agent skills were offered and skipped; record the skip in a future root `AGENTS.md` so they are not offered again, along with the installed `elysiajs` and `angular-developer` skills this project relies on.

Decision history (context, options, rationale) lives in [rationale.md](rationale.md). Verification steps live in [verify.md](verify.md).
