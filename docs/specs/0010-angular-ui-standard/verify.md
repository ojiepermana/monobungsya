# Verify: Angular UI package and CSS standard · spec 0010 · updated 2026-08-24

_This checklist replaces the stale hand composed layout plan. It verifies the current `LayoutWrapperDefault`, routed `Page` composition, and published package integration. The generated gateway SDK integration has its own checklist in [spec 0013](../0013-angular-sdk-integration/verify.md)._

## UI and manual

- [x] Open login, callback, session error, dashboard, users, permissions, passkeys, TOTP, and log pages at desktop and mobile widths and confirm no duplicate frame, landmark, or horizontal overflow → AC-6 to AC-10, AC-13 to AC-16
- [x] Inspect an authenticated screen and confirm one main landmark, one primary navigation landmark per viewport, a working skip link, and content only scrolling → AC-10, AC-14, AC-15
- [x] Switch light, dark, and system modes plus supported layout settings, reload, and confirm only package presentation keys persist → AC-3, AC-4, AC-11
- [x] Exercise navigation variants, mobile drawer focus, Escape, outside click, focus return, and logout from the package footer → AC-6, AC-10, AC-13, AC-14, AC-16
- [x] Run accessibility scans on auth states, dashboard, and the primary domain pages → AC-8, AC-9, AC-10
- [x] Run the Tauri shell and confirm it packages the same Angular output with desktop layout constraints and magic link behavior → AC-7, AC-8, AC-13 (packaging proven 2026-08-24: `bun run build:tauri` produced the `.app` and `.dmg` from `dist/web/browser`; the interactive desktop run was confirmed by the engineer on 2026-08-24)

## Commands

- [x] `bun run test:web` → routed pages, package composition, generated client middleware, and facades pass → AC-6 to AC-16
- [x] `bun run typecheck:web` → the production Angular build completes without type errors → AC-1 to AC-16
- [x] `bun run lint` → CSS, templates, and TypeScript pass Biome → AC-2, AC-5, AC-10
- [x] `rg -n '\.scss|inlineStyleLanguage|styles\.scss' apps/web package.json` → no active SCSS source or configuration remains → AC-5
- [x] `rg -n "from '@ojiepermana/angular'|import '@ojiepermana/angular'" apps/web/src` → production code uses explicit package subpaths → AC-2
- [x] Measure the production initial bundle, record the accepted budget in this spec, and resolve the `qrcode` CommonJS warning before treating performance verification as complete → AC-12

## Acceptance criteria coverage

The UI and command sections cover umbrella AC-1 through AC-16. The generated SDK integration is verified separately through spec 0013. Verified 2026-08-24 against package release 22.1.5: browser, accessibility (10 routes, 0 AXE violations), responsive, storage, session gate error recovery, Tauri packaging, and bundle budget checks all passed, and the interactive desktop shell run was confirmed by the engineer.
