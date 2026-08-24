# Verify: Angular UI package and CSS standard · spec 0010 · updated 2026-08-24

_This checklist replaces the stale hand composed layout plan. It verifies the current `LayoutWrapperDefault`, routed `Page` composition, generated gateway SDK child, and published package integration._

## UI and manual

- [ ] Open login, callback, session error, dashboard, users, permissions, passkeys, TOTP, and log pages at desktop and mobile widths and confirm no duplicate frame, landmark, or horizontal overflow → AC-6 to AC-10, AC-13 to AC-16
- [ ] Inspect an authenticated screen and confirm one main landmark, one primary navigation landmark per viewport, a working skip link, and content only scrolling → AC-10, AC-14, AC-15
- [ ] Switch light, dark, and system modes plus supported layout settings, reload, and confirm only package presentation keys persist → AC-3, AC-4, AC-11
- [ ] Exercise navigation variants, mobile drawer focus, Escape, outside click, focus return, and logout from the package footer → AC-6, AC-10, AC-13, AC-14, AC-16
- [ ] Run accessibility scans on auth states, dashboard, and the primary domain pages → AC-8, AC-9, AC-10
- [ ] Run the Tauri shell and confirm it packages the same Angular output with desktop layout constraints and magic link behavior → AC-7, AC-8, AC-13

## Generated SDK child

- [ ] Inspect browser requests and confirm generated operations use the configured gateway origin, cookies, correlation headers, typed filters, and cancellation without direct gateway `HttpClient` paths → SDK AC-1 to AC-10
- [ ] Exercise `401`, `403`, `404`, `409`, `422`, `429`, and `503` and confirm each facade preserves the required domain state while magic link verification remains browser navigation → SDK AC-9, SDK AC-11, SDK AC-12
- [ ] Regenerate OpenAPI and the SDK and confirm no tracked artifact drift → SDK AC-1 to SDK AC-3, SDK AC-13, SDK AC-14

## Commands

- [ ] `bun run test:web` → routed pages, package composition, generated client middleware, and facades pass → AC-6 to AC-16 and SDK AC-4 to SDK AC-13
- [ ] `bun run typecheck:web` → the production Angular build completes without type errors → AC-1 to AC-16
- [ ] `bun run lint` → CSS, templates, and TypeScript pass Biome → AC-2, AC-5, AC-10
- [ ] `bun run openapi:validate` → the public gateway contract remains valid → SDK AC-1 to SDK AC-3
- [ ] `rg -n '\.scss|inlineStyleLanguage|styles\.scss' apps/web package.json` → no active SCSS source or configuration remains → AC-5
- [ ] `rg -n "from '@ojiepermana/angular'|import '@ojiepermana/angular'" apps/web/src` → production code uses explicit package subpaths → AC-2
- [ ] Measure the production initial bundle, record the accepted budget in this spec, and resolve the `qrcode` CommonJS warning before treating performance verification as complete → AC-12

## Acceptance criteria coverage

The UI and command sections cover umbrella AC-1 through AC-16. The generated SDK section covers its child AC-1 through AC-14. Browser, accessibility, responsive, Tauri, package release, and bundle budget decisions remain open until driven and recorded.
