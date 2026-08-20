# Scope: Monobungsia

Monobungsia adalah monorepo enterprise untuk web client, gateway, dan service domain dengan PostgreSQL multischema.

**Build approach:** Tracer Bullet (slices run through database, service, gateway, and client boundaries).
**Workflow:** Beta (verify, then test).

## At a glance

| # | Feature | Phase | Status |
| --- | --- | --- | --- |
| 1 | Auth magic link and session | Foundation | in-progress |
| 2 | Auth login and callback UI | Foundation | in-progress |

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

Spec [0003](../specs/0003-auth-magic-link-session.md) · code in `apps/services/auth`, `apps/api-gateway`, and `packages/contracts`

### 2. Auth login and callback UI · in-progress
Provide login, check inbox, callback success, and callback error screens using the existing operations console visual language.
**Done when:** Users can request a link, understand sent or failed states, and see deterministic callback success or error screens with accessible responsive behavior.

- [x] Design it (spec): `/architect auth login and callback UI`
- [x] Build it: `/develop auth login and callback UI`
  - [x] Auth routes and callback states (AC-1, AC-4, AC-5)
  - [x] Generated SDK integration and form state machine (AC-2, AC-3, AC-5, AC-8)
  - [x] Auth shell, responsive styling, accessibility, and tests (AC-1, AC-4, AC-6, AC-7)
- [ ] Verify it: `/check verify auth login and callback UI`
- [x] Test it: `/test auth login and callback UI`

Spec [0004](../specs/0004-auth-ui-callback.md)
