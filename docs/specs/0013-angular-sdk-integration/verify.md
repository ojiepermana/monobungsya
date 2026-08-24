# Verify: Generated gateway SDK integration · spec 0013 · updated 2026-08-24

_Steps moved from the shared spec 0010 checklist when this spec was split out. `/check verify` runs these; `/test` locks the durable ones._

## UI and manual

- [ ] Inspect browser requests and confirm generated operations use the configured gateway origin, cookies, correlation headers, typed filters, and cancellation without direct gateway `HttpClient` paths → AC-1 to AC-10
- [ ] Exercise `401`, `403`, `404`, `409`, `422`, `429`, and `503` and confirm each facade preserves the required domain state while magic link verification remains browser navigation → AC-9, AC-11, AC-12

## Commands

- [ ] `bun run test:web` → generated client middleware and facades pass → AC-4 to AC-13
- [ ] `bun run openapi:validate` → the public gateway contract remains valid → AC-1 to AC-3
- [ ] Regenerate OpenAPI and the SDK and confirm no tracked artifact drift → AC-1 to AC-3, AC-13, AC-14

## Acceptance criteria coverage

The sections above cover AC-1 through AC-14 of this spec.
