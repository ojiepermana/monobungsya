# Verify: Angular UI package and CSS standard, spec 0001, updated 2026-08-20

Steps derived from spec 0001 acceptance criteria. `/check verify` can run these, and `/test` can lock the durable cases.

## UI and manual

- [ ] Open `/auth/login` at a desktop viewport, confirm the fluid two column shell, labeled email field, visible focus, strong submit action, and no main navigation, verifies AC-8 and AC-10.
- [ ] Open `/auth/login` at 390 by 844, confirm one column layout, hidden context panel, readable copy, 44 pixel controls, and no horizontal overflow, verifies AC-8, AC-9, and AC-10.
- [ ] Open `/` with an authenticated session, confirm loading appears first, then the main navigation, theme settings trigger, gateway status, five service cards, and footer, verifies AC-6 and AC-7.
- [ ] Open `/` with no session, confirm operation content does not render and the browser navigates to `/auth/login`, verifies AC-7.
- [ ] Make the session endpoint return a service failure, confirm a visible retryable error and no operation content, verifies AC-7.
- [ ] At a desktop viewport, confirm sidebar navigation and five service cards do not overflow, verifies AC-6 and AC-9.
- [ ] At a mobile viewport, open the navigation flyout, confirm focus enters the menu, Escape closes it, outside click closes it, and focus returns to the trigger, verifies AC-6, AC-9, and AC-10.
- [ ] Open theme settings and choose light, dark, and system, confirm the rendered mode changes and the choice survives reload, verifies AC-4 and AC-8.
- [ ] Inspect browser storage after login and main app use, confirm only package theme keys and navigation keys exist. Confirm no email, token, cookie value, token hash, health response, or identity is stored, verifies AC-4 and AC-11.
- [ ] Inspect network requests while icons render, confirm no Google Fonts or other external font request occurs, verifies AC-3 and AC-11.
- [ ] Run an AXE scan on login, callback complete, callback error, session error, and authenticated main app states, verifies AC-8, AC-9, and AC-10.

## Value sourcing checks

- [ ] Clear theme storage and set the OS color preference to dark, reload, and confirm system mode follows the OS preference. Set light, dark, and system individually and confirm the package owns the stored mode, verifies AC-4. Source: package theme provider and persisted package theme value.
- [ ] Select a theme mode from the settings surface and inspect storage, confirm the value is one of light, dark, or system, verifies AC-4 and AC-11. Source: package settings selection.
- [ ] Inspect document theme attributes and computed brand styles, confirm brand teal, base neutral, xs radius, and compact spacing come from the provider options, verifies AC-3 and AC-4. Source: provider options in `app.config.ts`.
- [ ] Inspect navigation links and active state, confirm title, icon, route, and active matching come from the local readonly `NavigationItem[]`, verifies AC-2 and AC-6. Source: `App.navigationItems` and Angular Router.
- [ ] Open the main app with a mock health response, confirm gateway state and service name match the response and the contract and runtime values remain fixed, verifies AC-6. Source: generated SDK health response and existing App signals.
- [ ] Open the main app with authenticated session data, confirm the role and display name come only from the session response and are not persisted, verifies AC-6, AC-7, and AC-11. Source: generated SDK session response and in memory signals.
- [ ] Submit an invalid login email, a rate limited request, and a service failure, confirm each visible state is derived from the existing form signal and generated SDK response status, verifies AC-8. Source: current auth form state and generated SDK response.
- [ ] Open callback complete and callback error, confirm complete state comes from the existing session response and error state uses fixed generic copy without query token content, verifies AC-8 and AC-11. Source: generated SDK session response and fixed route copy.

## Commands

- [ ] `bun run test:web` passes all web unit tests, verifies AC-7, AC-8, and AC-10.
- [ ] `bun run typecheck:web` passes with no initial or component style budget warning, verifies AC-1, AC-2, AC-3, AC-5, and AC-12.
- [ ] `./node_modules/.bin/biome check --files-ignore-unknown=true package.json apps/web/angular.json apps/web/src/app apps/web/src/styles.css` passes for the feature files, verifies AC-2 and AC-5.
- [ ] `rg -n '\.scss|inlineStyleLanguage|"style": "scss"|styles\.scss' apps/web package.json` returns no SCSS source or SCSS configuration, verifies AC-5.
- [ ] `rg -n "from '@ojiepermana/angular'|import '@ojiepermana/angular'" apps/web` returns no production root barrel import, verifies AC-2.
- [ ] Inspect the production output and confirm settings is a lazy chunk and the initial bundle remains below 500 kB, verifies AC-12.

## Acceptance criteria coverage

- AC-1, AC-2, AC-3, and AC-4 are covered by dependency, provider, import, network, storage, and build checks.
- AC-5 is covered by CSS audit, Angular configuration audit, lint, and build.
- AC-6 and AC-7 are covered by session, navigation, main shell, health, and responsive checks.
- AC-8 is covered by login, callback, generic messaging, cookie, and auth regression checks.
- AC-9 and AC-10 are covered by responsive, focus, keyboard, overlay, AXE, and unit checks.
- AC-11 is covered by storage and network inspection.
- AC-12 is covered by build, lint, tests, and production bundle inspection.
