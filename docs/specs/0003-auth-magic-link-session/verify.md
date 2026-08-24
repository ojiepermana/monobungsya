# Verify: auth magic link and session · spec 0003 · updated 2026-08-24

_Steps derive from the active authentication criteria in spec 0003 and the permission supersession in spec 0008. `/check verify` runs these; `/test` locks the durable cases._

## UI and infrastructure

- [x] Request a magic link for a registered user, consume it once, and confirm the browser receives a bounded HttpOnly session cookie without exposing the token → AC-1, AC-2, AC-3, AC-4
- [x] Reuse and expire a magic link, then confirm both attempts fail with generic user facing output and create no session → AC-2, AC-3
- [x] Log out and confirm the current session is revoked while other sessions keep their documented lifetime → AC-5, AC-6
- [x] Change effective permissions, then confirm protected routes use the refreshed permission list and no public response or signed identity contains a role → AC-7, AC-8, spec 0008
- [x] Run with the deployment SMTP relay and confirm timeout, sender, and secret configuration work without credentials appearing in logs → AC-1, AC-9

## Commands

- [x] `bun test apps/services/auth/src apps/gateway/erp/src packages/contracts/src` → magic link, session, rate limit, signed identity, and permission tests pass → AC-1 to AC-10
- [x] `bun run openapi:validate` → the current role free public contract is valid → AC-5, AC-7, AC-8
- [x] `bun run lint && bun run typecheck` → authentication and identity boundaries remain clean → AC-7, AC-10
- [x] Run the auth migrations on a fresh PostgreSQL database, then run them again → token, session, and rate limit schema is live and idempotent → AC-2, AC-4, AC-6, AC-9

## Acceptance criteria coverage

AC-1 through AC-6 are covered by the browser lifecycle and auth integration tests. AC-7 and the active part of AC-8 are covered by signed identity and permission checks. AC-9 is covered by SMTP, cleanup, rate limit, and redaction checks. AC-10 is covered by the automated regression suite.
