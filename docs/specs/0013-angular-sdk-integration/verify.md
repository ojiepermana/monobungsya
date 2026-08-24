# Verify: Generated gateway SDK integration · spec 0013 · updated 2026-08-24

_Steps moved from the shared spec 0010 checklist when this spec was split out. `/check verify` runs these; `/test` locks the durable ones._

## UI and manual

- [x] Inspect browser requests and confirm generated operations use the configured gateway origin, cookies, correlation headers, typed filters, and cancellation without direct gateway `HttpClient` paths → AC-1 to AC-10 (verified 2026-08-24: every captured request carried `credentials: include`, `x-correlation-id`, `x-client-route`, and typed filter params; zero `HttpClient` callers; read teardown locked by a unit test)
- [x] Exercise `401`, `403`, `404`, `409`, `422`, `429`, and `503` and confirm each facade preserves the required domain state while magic link verification remains browser navigation → AC-9, AC-11, AC-12 (verified 2026-08-24: `404` user detail live, `401` redirect live, `403` staff redirect plus `429` and `503` generic states in the passing e2e suite, `409` and `422` through the status carrying error unit test; verification navigates via `window.location.replace`, locked by a unit test)

## Commands

- [x] `bun run test:web` → generated client middleware and facades pass → AC-4 to AC-13 (104 tests green, plus the 20 test Playwright e2e suite)
- [x] `bun run openapi:validate` → the public gateway contract remains valid → AC-1 to AC-3 (all 5 specs valid)
- [x] Regenerate OpenAPI and the SDK and confirm no tracked artifact drift → AC-1 to AC-3, AC-13, AC-14 (clean after the stale auth spec artifacts from `3cbfe5b` were committed in `610bc5c`)

## Acceptance criteria coverage

The sections above cover AC-1 through AC-14 of this spec.
