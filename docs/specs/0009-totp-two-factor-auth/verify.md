# Verify: TOTP two factor authentication · spec 0009 · updated 2026-08-24

_Steps derive from spec 0009 acceptance criteria. `/check verify` runs these; `/test` locks the durable cases._

## UI and infrastructure

- [ ] Enroll from security settings, scan the locally rendered QR, confirm one code, and record the one time recovery codes without any secret appearing after reload → AC-2, AC-3, AC-10, AC-13
- [ ] Complete magic link and passkey first factors for a protected user, then confirm no session exists until a valid TOTP or unused recovery code consumes the challenge → AC-1, AC-4, AC-11
- [ ] Exercise replay, five failed attempts, expiry, tampering, concurrent verification, and IP rate limiting and confirm none creates more than one session → AC-5, AC-11
- [ ] Disable and regenerate recovery codes with proof, then confirm audit entries and old code invalidation → AC-4, AC-6, AC-7, AC-13
- [ ] Require and reset 2FA from the user detail page with `user:user:manage`, then confirm mandatory reasons, session revocation, and secret free operator output → AC-8, AC-9, AC-10, AC-13
- [ ] Run the Tauri shell through magic link and code entry and confirm passkey remains absent while users without 2FA see no login change → AC-12

## Commands

- [ ] `bun test apps/services/auth/src apps/services/user/src apps/gateway/erp/src` → enrollment, challenge, recovery, enforcement, reset, and redaction tests pass → AC-1 to AC-14
- [ ] `bun run test:web` → security settings, login challenge, and admin panel tests pass → AC-1, AC-2, AC-8, AC-9, AC-10, AC-12
- [ ] `bun run openapi:validate && bun run lint && bun run typecheck` → contracts, SDK consumers, configuration, and code gates pass → AC-10, AC-14
- [ ] Apply auth and user migrations on PostgreSQL, inspect encrypted secrets and hashed recovery codes, then run cleanup → schema, grants, encryption, and lifecycle are live → AC-2, AC-3, AC-11, AC-13

## Acceptance criteria coverage

AC-1 through AC-14 are covered by the real authenticator flows, admin and self service behavior, Tauri check, database inspection, and automated command gates. Tauri, authenticator app, and live database checks remain manual until driven.
