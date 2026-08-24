# Verify: auth login and callback UI · spec 0004 · updated 2026-08-24

_Steps derive from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable cases._

## UI and manual

- [x] Open `/auth/login` on desktop and mobile, submit an invalid email, and confirm labels, focus, validation, status copy, and overflow remain accessible → AC-1, AC-2, AC-6, AC-7
- [x] Request a valid link, follow it in the browser, and confirm loading, completion, cookie session, and redirect states without rendering the raw token → AC-3, AC-4, AC-5, AC-8
- [x] Follow an invalid or expired link and confirm deterministic generic error copy without account or token disclosure → AC-4, AC-5
- [x] Run the Tauri shell, request a desktop link, and confirm the deep link returns to the same callback states without enabling browser only passkey behavior → AC-3, AC-4, AC-8
- [x] Run an accessibility scan on login, callback complete, callback error, and service failure states → AC-6, AC-7

## Commands

- [x] `bun run test:web` → auth routes, form state, callback state, and runtime detection tests pass → AC-1 to AC-8
- [x] `bun run typecheck:web` → every auth route and generated client binding compiles → AC-2, AC-3, AC-8
- [x] `bun run lint` → templates, styles, and TypeScript pass the repository gate → AC-6, AC-7

## Acceptance criteria coverage

AC-1 through AC-8 are covered by the browser and Tauri flows plus the Angular command checks. Visual, responsive, deep link, and accessibility behavior stays manual until driven in the real runtimes.
