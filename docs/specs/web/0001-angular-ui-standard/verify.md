# Verify: Angular UI package and CSS standard, spec 0001, updated 2026-08-21

> **Stale as of the 2026-08-21 layout revision.** Spec 0001 changed the layout decision from hand
> composed package primitives to `LayoutWrapperDefault`, an input free `Shell` at the application
> root, and pages as lazy loaded routed components. Steps below that name `LayoutVertical`,
> `LayoutNavigation`, `LayoutContent`, a pinned shell mode, a deferred workspace chunk, five service
> cards, or a 500 kB initial budget no longer match the decision. Keep this file for the auth,
> theme, storage, and accessibility steps, which still hold, and regenerate the composition and
> bundle steps with `/develop` after the rebuild lands.

Steps derived from spec 0001 acceptance criteria. `/check verify` can run these, and `/test` can lock the durable cases.

## UI and manual

- [ ] Open `/auth/login` at a desktop viewport, confirm the fluid two column shell, labeled email field, visible focus, strong submit action, and no main navigation, verifies AC-8 and AC-10.
- [ ] Open `/auth/login` at 390 by 844, confirm one column layout, hidden context panel, readable copy, 44 pixel controls, and no horizontal overflow, verifies AC-8, AC-9, and AC-10.
- [ ] Open `/` with an authenticated session, confirm loading appears first, then the main navigation, theme settings trigger, gateway status, five service cards, and footer, verifies AC-6 and AC-7.
- [ ] Inspect the authenticated main DOM, confirm package `Shell`, `Layout`, `LayoutVertical`, `LayoutNavigation`, `LayoutContent`, and `Page` hosts are present with the expected package attributes, verifies AC-13, AC-14, and AC-15.
- [ ] Confirm the main app uses `PageHeader`, `PageDashboard` or `PageContent`, and `PageFooter` for its page sections, while gateway and service markup remains projected application content, verifies AC-15.
- [ ] Open `/` with no session, confirm operation content does not render and the browser navigates to `/auth/login`, verifies AC-7.
- [ ] Make the session endpoint return a service failure, confirm a visible retryable error and no operation content, verifies AC-7.
- [ ] At a desktop viewport, confirm sidebar navigation and five service cards do not overflow, verifies AC-6 and AC-9.
- [ ] At a mobile viewport, open the navigation flyout, confirm focus enters the menu, Escape closes it, outside click closes it, and focus returns to the trigger, verifies AC-6, AC-9, and AC-10.
- [ ] Audit landmarks and scrolling, confirm one `main` landmark, one primary navigation landmark, a working skip link target, one authenticated content scroll owner, and no local outer frame duplicate, verifies AC-14 and AC-16.
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
- [ ] `rg -n "@ojiepermana/angular/(theme/shell|theme/layout|theme/page|navigation|theme/component/settings)" apps/web/src` finds explicit package subpath imports, and no local shell wrapper replaces the package composition, verifies AC-13, AC-14, AC-15, and AC-16.

## Acceptance criteria coverage

- AC-1, AC-2, AC-3, and AC-4 are covered by dependency, provider, import, network, storage, and build checks.
- AC-5 is covered by CSS audit, Angular configuration audit, lint, and build.
- AC-6 and AC-7 are covered by session, navigation, main shell, health, and responsive checks.
- AC-8 is covered by login, callback, generic messaging, cookie, and auth regression checks.
- AC-9 and AC-10 are covered by responsive, focus, keyboard, overlay, AXE, and unit checks.
- AC-11 is covered by storage and network inspection.
- AC-12 is covered by build, lint, tests, and production bundle inspection.

## Deferred shell boundary and bundle reality, added 2026-08-21

The authenticated composition loads as a deferred chunk, so the initial bundle stays close to
its pre feature size. These steps supersede the two earlier claims that `bun run typecheck:web`
emits no budget warning and that the initial bundle stays below 500 kB.

- [ ] Open `/` with an authenticated session on a cold cache, confirm the session gate loading state is followed by the deferred workspace placeholder and then the package shell, with no duplicate frame flash, verifies AC-7 and AC-13.
- [ ] Throttle the network to slow 3G and reload `/`, confirm the workspace placeholder keeps an accessible live region and the workspace renders once the deferred chunk arrives, verifies AC-7 and AC-10.
- [ ] Inspect the production output, confirm `theme-shell`, `theme-page-root`, the navigation menu chunks, badge, and card are lazy chunks, and record the initial bundle at 504.44 kB against the 500 kB warning, verifies AC-12 and leaves the remaining 4.44 kB as an open budget decision.
- [ ] Confirm `LayoutContent` is the only element carrying `role="main"`, and that the mobile `Navigation` inside `PageHeader` is hidden at desktop widths so exactly one navigation landmark is exposed per viewport, verifies AC-16.
- [ ] Resize from 1440 to 390 CSS pixels, confirm the desktop `LayoutNavigation` hides, the `PageHeader` flyout trigger appears, sections stack, service cards become one column, and no horizontal overflow appears, verifies AC-9 and AC-15.

## Value sourcing checks for shell, layout, and page axes, added 2026-08-21

- [ ] Inspect the `Shell` host, confirm web mode and `sync` color resolve from the explicit template inputs, and confirm no `shell-mode`, `shell-device`, `shell-color`, or `shell-frame` key is written to browser storage, verifies AC-13 and AC-11. Source: explicit `Shell` inputs in the authenticated template.
- [ ] Inspect the `Layout` host, confirm surface `grid`, appearance `border-rail`, width `full`, and type `vertical` resolve from the explicit package inputs and the `LayoutVertical` variant, verifies AC-14. Source: explicit package `Layout` inputs.
- [ ] Inspect the page slots, confirm `data-page-slot` header, dashboard, and footer are present, the dashboard slot is the single content scroll region, and `Page` itself does not add a page wide scroll container, verifies AC-15. Source: package `Page` slots.

## Upstream library API, added 2026-08-21

Steps for [upstream library API](0001-upstream-library-api.md) acceptance criteria AC-U1 to AC-U7.
These run in the library repository at `/Users/ojiepermana/Development/ojiepermana/angular/`, not in
monobungsia. Every step except the release ones is already covered by automated tests there, so
`/check verify` can confirm them by running the commands rather than by hand.

### Commands

- [ ] `npx ng test angular-theme --watch=false` passes, including the ten logout cases and the seventeen adapter cases, verifies AC-U1, AC-U2, AC-U3, AC-U4, and AC-U5.
- [ ] `npx ng test --watch=false` passes for every project, including the fifty seven showcase app tests that now run against the published adapter, verifies AC-U6.
- [ ] `npx ng build angular --configuration production` completes, so the showcase app template still typechecks with no logout binding present, verifies AC-U6.
- [ ] `node scripts/check-public-api.mjs` passes, and the contract diff for `@ojiepermana/angular-theme/component/settings` adds seven symbols and removes none, verifies AC-U6.
- [ ] `bun run verify:libs` passes end to end before release, verifies AC-U7 is safe to attempt.
- [ ] `bun run publish` releases the version, then `npm view @ojiepermana/angular version` reports it, and the number is recorded in spec 0001 and in the upstream spec, verifies AC-U7.

### UI and manual

- [ ] In the showcase app set nav type `sidebar`, press the footer logout button, and confirm nothing happens and no console error appears, since the showcase binds no handler, verifies AC-U1 and AC-U6.
- [ ] Set nav type `dockbar`, press the rail footer logout button and then the aside footer logout button, and confirm both are wired to the same output, verifies AC-U2 and AC-U3.
- [ ] Set layout type `fluid`, and confirm the brand only shell renders no logout control and no user email, verifies AC-U1 and AC-U3.
- [ ] At a viewport below 640 pixels open the mobile drawer and confirm its footer logout control reaches the same consumer output, verifies AC-U2 and AC-U3.
- [ ] Open theme settings, change layout type, nav type, and nav type mode, and confirm each disallowed combination is corrected rather than rendered, verifies AC-U4.

### Value sourcing checks

- [ ] Click the logout button on each of `sidebar`, `dockbar`, `navbar`, and `flyout`, and confirm the consumer receives one emission per click with no payload, verifies AC-U1 and AC-U3. Source: click event on the `LayoutUser` logout button.
- [ ] Confirm the package performs no endpoint call and no navigation of its own when logout fires, by watching the network panel with no consumer handler bound, verifies AC-U1. Source: consumer only; the package decides nothing.
- [ ] Set layout type `vertical` then `horizontal`, and confirm the offered nav types change to `sidebar` and `dockbar`, then `navbar` and `flyout`. Set shell mode `desktop` with layout type `horizontal` and confirm `desktop` becomes the only option, verifies AC-U4. Source: layout type and shell mode pair, a package rule.
- [ ] With nav type `sidebar` confirm the modes offered are default and collapsed, with `dockbar` confirm default and drawer, and with `navbar` confirm default only, verifies AC-U4. Source: active nav type, a package rule.
- [ ] Change layout type, nav type, and nav type mode, then read `localStorage` and confirm only `layout-type`, `nav-type`, and `nav-type-mode` are written, holding presentation values and no identity, verifies AC-U5. Source: package owned storage keys.
- [ ] Put a foreign value in `nav-type` and reload, then block `localStorage` and reload again, and confirm the default `dockbar` renders with no thrown error either time, verifies AC-U5. Source: storage read with a safe fallback.
- [ ] Set layout type `fluid` and confirm width is coerced to `fluid`, then leave `fluid` and confirm width returns to a non fluid value, verifies AC-U4. Source: active layout type, a package rule.

### Acceptance criteria coverage

- AC-U1, AC-U2, and AC-U3 are covered by the per variant logout tests, the mobile drawer test, the brand only test, and the manual clicks.
- AC-U4 is covered by the adapter constraint tests and the settings surface checks.
- AC-U5 is covered by the storage key, foreign value, and blocked storage tests.
- AC-U6 is covered by the full test run, the production app build, and the additive public API contract diff.
- AC-U7 is covered by the release gate, the publish run, and recording the version in both specs.
