# 0010. Adopt the Angular UI package and CSS standard

**Date**: 2026-08-21
**Status**: In Progress

## Summary

`apps/web` akan memakai `@ojiepermana/angular` sebagai dasar theme, shell, layout, navigation, page, dan component. Semua style aplikasi akan berpindah dari SCSS ke CSS dengan Tailwind v4 dan token theme package. Aplikasi mengikuti pola consumer yang sama dengan showcase app milik package: `Shell` sebagai root tanpa input, `LayoutWrapperDefault` sebagai owner frame dan navigation, dan setiap halaman sebagai routed component yang memakai `Page`. Login tetap mempertahankan perilaku auth yang sudah disepakati, dan mendapat shell fluid dari layout brand only milik package.

## Structure

1. [Package and theme adoption](0010-package-theme.md), menetapkan dependency, import, theme provider, icon, dan state theme.
2. [CSS migration](0010-css-migration.md), menetapkan perpindahan seluruh style `apps/web` dari SCSS ke CSS.
3. [Layout integration](0010-layout-integration.md), menetapkan session gate, komposisi `Shell` dan `LayoutWrapperDefault`, halaman sebagai routed component, shell login fluid, responsive behavior, dan aksesibilitas.
4. [Upstream library API](0010-upstream-library-api.md), menetapkan dua penambahan aditif di `@ojiepermana/angular` yang menjadi prasyarat: aksi logout yang dapat diikat consumer dan adapter settings yang dipublikasikan.
5. [Generated gateway SDK integration](0010-angular-sdk-integration.md), menetapkan generator OpenAPI, typed client, facade Angular, konfigurasi cookie, dan migrasi request gateway.

## Requirements

**User stories**:

1. As a user, I want the web application to have one consistent component and theme system so that every screen feels like the same operations console.
2. As a user, I want login to adapt to my viewport so that the auth flow remains usable on desktop and mobile.
3. As an authenticated user, I want the main app to provide clear navigation, status, and service information so that I can understand the workspace quickly.
4. As a maintainer, I want all web styles to use CSS and one package standard so that new Angular work does not add another styling system.
5. As an accessibility user, I want keyboard focus, labels, status messages, and overlays to behave predictably so that I can use the application without a mouse.

**Acceptance criteria**:

1. **AC-1**: The root project declares `@ojiepermana/angular` at `^22.1.4`, `@ojiepermana/angular-theme` at `^22.1.4` for the imported CSS assets, `tailwindcss` at `^4.3.0`, and `@fontsource/material-symbols-rounded` at `5.3.3`, with the Bun lockfile updated.
2. **AC-2**: Production TypeScript imports use the package subpath API for the components, theme, navigation, and settings used by `apps/web`. The bare root barrel is not imported by production code.
3. **AC-3**: `apps/web` loads the package theme CSS, Tailwind v4, the package Tailwind token map, and the self hosted Material Symbols font without a request to an external font host.
4. **AC-4**: The theme provider supports `light`, `dark`, and `system`, uses system mode as the initial default, persists the package owned theme choice, and falls back to `system` when storage is unavailable or invalid.
5. **AC-5**: All active Angular styles in `apps/web` use `.css`. No `.scss` file is referenced by `styleUrl`, `styles`, `inlineStyleLanguage`, or the component schematic configuration.
6. **AC-6**: The main app uses the package navigation container and settings surface after the client session gate reports an authenticated session. Desktop navigation and mobile flyout or drawer behavior use the package APIs, and the main app keeps the gateway status and service boundary content.
7. **AC-7**: The client session gate has a stable loading state, redirects an unauthenticated response to `/auth/login`, and shows a retryable error for session service or network failure. No backend endpoint or generated SDK contract changes.
8. **AC-8**: Login and callback routes preserve every state and security behavior from spec 0004, including idle, invalid, submitting, sent, rate limited, service error, callback success, callback error, generic copy, cookie isolation, and session check behavior. Login uses a fluid responsive shell and does not render the main navigation.
9. **AC-9**: The main app stacks its sections on small screens, changes service cards to one column, avoids horizontal overflow, and uses the package flyout or drawer with Escape close, outside close, focus containment, and focus return to the trigger.
10. **AC-10**: Interactive controls have persistent labels, visible focus, semantic status and alert regions, touch targets of at least 44 by 44 CSS pixels, and contrast that passes WCAG AA and AXE checks.
11. **AC-11**: Browser storage contains only package owned presentation keys: theme values, shell axes (`shell-mode`, `shell-device`, `shell-color`, `shell-frame`), layout axes (surface, appearance, width, layout type), and navigation state (nav type, nav type mode). It never contains email, magic link token, session cookie value, token hash, health response, or user identity data.
12. **AC-12**: The web validation gate passes Angular build, lint, web unit tests, AXE checks, and desktop and mobile responsive checks. Production imports stay subpath based, the dashboard route is lazy loaded, and the initial bundle is measured. The initial warning budget is then set once to the measured value plus headroom, and the measurement is recorded in this spec.
13. **AC-13**: The package `Shell` is the unconditional application root, rendered with no axis inputs so mode, device, color, and frame resolve from storage and stay changeable from the settings surface. `LayoutLoading` sits at the root. The root component and the layout provider both use host class `contents` so the package layout becomes a direct flex child of `Shell`.
14. **AC-14**: The authenticated app uses `LayoutWrapperDefault` as the only owner of the frame, navigation placement, mobile drawer, skip link, content landmark, and focus on navigation. Application code composes no `Layout`, `LayoutVertical`, `LayoutNavigation`, or `LayoutContent` directly, renders no second `Navigation` instance, and uses no local media query to hide navigation.
15. **AC-15**: Every page is a lazy loaded routed component with host class `block h-full min-h-0` that uses package `Page` with `PageHeader`, `PageDashboard` or `PageContent`, and `PageFooter` slots. No page markup remains in the root template. Local wrappers stay limited to domain content such as gateway status and service cards.
16. **AC-16**: Production imports use explicit package subpaths. Browser checks find one main landmark, one primary navigation landmark, a working skip link, one content scroll owner, no horizontal overflow, and no duplicate local shell frame. Brand identity comes from application constants, user identity comes from the session response, and the navigation footer logout calls `POST /api/v1/auth/logout` and then routes to `/auth/login`.

## Decision

Adopt `@ojiepermana/angular` version `22.1.x` as the Angular design system for `apps/web`, and follow the consumer composition the package's own showcase app uses. Use its production subpaths for theme services, shell, layout wrapper, navigation, page, settings, and UI components. Use `@ojiepermana/angular-theme` directly for the published CSS assets, `tailwindcss` `^4.3.0` for utility generation, and `@fontsource/material-symbols-rounded` `5.3.3` for local icon assets.

The canonical theme is system mode with light and dark support, brand teal, base neutral, extra small radius, and compact spacing. `Shell` is the unconditional application root with no axis inputs, so the shell controls on the settings surface stay live. `LayoutWrapperDefault` owns the frame, navigation placement, mobile drawer, skip link, content landmark, and focus on navigation. Pages are lazy loaded routed components that use `Page` and its slots. The session gate and the auth routes render inside `Shell` using `layout-type="fluid"`, which the package treats as brand only, so login gets its fluid shell from package geometry rather than local CSS.

Runtime switching of layout and navigation axes is exposed to operators through one published `ThemeSettingsAdapter`. That adapter and a bindable logout action are additive package changes recorded in [upstream library API](0010-upstream-library-api.md), and they are prerequisites for this work.

**Implementation skills**: `angular-developer` (`project/angular-developer`, `/Users/ojiepermana/.agents/skills/angular-developer/`)

## Standard definition

**Canonical pattern**:

```ts
import { provideUiTheme } from "@ojiepermana/angular/theme/styles";

export const appConfig = {
  providers: [
    provideUiTheme({
      mode: "system",
      color: "brand",
      neutral: "base",
      radius: "xs",
      space: "compact",
      brand: {
        color: "177 72% 28%",
        foreground: "0 0% 100%",
      },
    }),
  ],
};
```

```css
@import "@ojiepermana/angular-theme/theme-full.css";
@import "tailwindcss";
@import "@ojiepermana/angular-theme/styles/css/base/tailwind.css";
@import "@fontsource/material-symbols-rounded/400.css";
```

1. Production components import from subpaths such as `@ojiepermana/angular/component/button`, `@ojiepermana/angular/navigation`, `@ojiepermana/angular/theme/shell`, `@ojiepermana/angular/theme/layout`, `@ojiepermana/angular/theme/layout/wrapper`, `@ojiepermana/angular/theme/page`, and `@ojiepermana/angular/theme/component/settings`.
2. The application root renders `LayoutLoading` and `Shell`. `Shell` takes no axis inputs, so mode, device, color, and frame resolve from storage and remain changeable from the settings surface.
3. The root component and the layout provider component both set host class `contents`, so the package `Layout` inside the wrapper becomes a direct flex child of `Shell` and the viewport height chain stays intact.
4. `LayoutWrapperDefault` is the only layout composition in application code. It receives the layout axes, nav type, navigation data, brand, and user, and it projects `router-outlet`. Application code never composes `Layout`, `LayoutVertical`, `LayoutNavigation`, or `LayoutContent` directly.
5. Pages are lazy loaded routed components with host class `block h-full min-h-0` whose root is `Page`, using `PageHeader`, `PageDashboard` or `PageContent`, and `PageFooter`.
6. The session gate and the auth routes render inside `Shell` with `layout-type="fluid"`, which the package treats as brand only. The effective layout type is `fluid` while the gate or an auth route is active, and the operator's choice once authenticated.
7. Layout axis defaults are seeded once through `LayoutService.registerDefaults`. Runtime switching is served by one published `ThemeSettingsAdapter` installed on `THEME_SETTINGS_ADAPTER`; the application does not reimplement axis constraint logic.
8. Brand identity comes from an application constant. User identity comes from the session response. The navigation footer logout is bound to `POST /api/v1/auth/logout` followed by a route to `/auth/login`.
9. The theme provider owns mode persistence. The application does not create a second theme storage service.
6. Local semantic wrappers are allowed for domain content such as gateway status, service cards, session gate messages, and auth state panels when a package component cannot preserve the required behavior or accessibility.
7. Domain colors that are not part of the package theme, such as the existing coral status accent, use scoped CSS custom properties and do not replace package tokens.
8. The provider does not enable external Material Symbols loading. The local font import is the only icon font source.

**Replaces**:

1. Component style defaults that generate SCSS.
2. `styleUrl` values that point to `.scss` files.
3. Global SCSS files and Sass variables used as the application theme.
4. Production imports from the bare `@ojiepermana/angular` barrel.
5. A local theme storage service that duplicates `ThemeModeService` behavior.
6. Hand composed `Layout`, `LayoutVertical`, `LayoutNavigation`, and `LayoutContent` in application code.
7. A second `Navigation` instance plus local media queries used to build mobile navigation by hand.
8. Explicit `mode` or `color` inputs on `Shell`, which make the settings surface shell controls dead.
9. A local outer shell, `min-height: 100dvh` on the app host, or any local rule that claims viewport, frame, or scroll geometry.
10. Page markup in the root template instead of a routed page component.
11. A local auth shell stylesheet that recreates viewport and frame geometry for login and callback.
12. An application local copy of the layout and navigation axis constraint logic.

**Enforcement**:

1. Angular CLI configuration uses CSS for the component schematic and inline style language.
2. A repository check fails when `apps/web` contains a referenced `.scss` file, a production import from the bare package barrel, a direct import of `LayoutVertical`, `LayoutNavigation`, or `LayoutContent`, or an axis input on `Shell`.
3. Angular build keeps the component style budget, and the initial budget recorded from the measurement in AC-12.
4. TypeScript compilation catches invalid package entry points and component inputs.
5. Web tests cover session gate states, auth regressions, theme fallback, wrapper and page composition, landmark counts, logout wiring, and responsive layout.
6. AXE and responsive browser checks are required in the validation gate.

**Rollout**:

1. Release the additive package changes from [upstream library API](0010-upstream-library-api.md), then raise the dependency in monobungsia.
2. Install the package, theme CSS dependency, Tailwind, and local icon font, then register the theme provider and the settings adapter.
3. Migrate global and component styles from SCSS to CSS and change Angular defaults.
4. Put `LayoutLoading` and an input free `Shell` at the root, then move the layout into a provider component wrapping `LayoutWrapperDefault` and delete the hand composed primitives.
5. Move each page into a lazy loaded routed component using `Page`, then move the session gate and auth routes to the fluid layout inside `Shell`.
6. Bind logout, remove the duplicate header settings trigger, then run build, lint, unit, AXE, responsive, storage, landmark, and bundle checks and record the measured initial bundle.

**Exceptions**: The package does not own domain content markup. A local semantic wrapper is allowed when it is needed for an application specific state, a generated SDK boundary, or an accessibility behavior that the package does not expose. Any exception must keep package tokens and CSS rules and must not add SCSS.

## Consequences

**Positive**:

1. Angular screens share one source for tokens, components, navigation, and theme behavior.
2. CSS becomes the only style language in `apps/web`, which reduces configuration and migration ambiguity.
3. Login adapts fluidly while preserving the security behavior already defined for magic links and cookies, and it now gets that fluidity from package geometry instead of a second stylesheet.
4. Navigation placement, the mobile drawer, focus containment, skip link, and landmarks become package behavior rather than application code, which removes the part that was hardest to get right by hand.
5. The shell frame no longer appears after the session gate resolves, because `Shell` renders from the first paint.
6. Operators can change theme, shell, layout, and navigation axes at runtime, and the axis combinations stay coherent because one published adapter enforces them.
7. Self hosted icons avoid an external font request and keep the browser data boundary explicit.
8. `apps/web` now follows the same consumer pattern as the package's showcase app, so the reference implementation and the product agree.

**Negative / tradeoffs**:

1. The umbrella package adds a large dependency surface even when production imports are tree shakeable.
2. Tailwind utilities and package tokens add a new styling vocabulary that maintainers must learn.
3. The session gate adds a loading and service failure state before the main app can render.
4. A package update can change component behavior or visual tokens, so the bundle and browser validation gate must run on updates.
5. The migration touches every active web style file and can create broad visual regressions if components are mapped without focused tests.
6. `apps/web` now depends on an unreleased package version, so this work is blocked until the upstream changes ship. That couples the web console's schedule to a second repository.
7. `LayoutWrapperDefault` pulls every navigation variant plus the page apps launcher, so it costs more than a hand built frame. The initial budget has to be measured and reset rather than assumed.
8. The default navigation becomes a `dockbar` icon rail rather than the labelled sidebar shown today, which is a visible change for current users.
9. Exposing layout and navigation switching multiplies the states that need verifying, since surface, appearance, width, layout type, nav type, and nav type mode can each vary.
10. The authenticated app is coupled to the wrapper's slot and host contracts, so package upgrades must verify landmarks, scroll ownership, and layout host attributes, not just visual output.
11. The user's email is now displayed in the navigation footer. It is never stored, but it is on screen for anyone looking at the operator's display.

**Neutral**:

1. No backend migration, API route, generated SDK contract, or auth service change is part of this decision.
2. The theme preference is browser local state, not a user profile preference, so it does not follow a user across devices.
3. The existing operations console copy and gateway health data remain in the dashboard page.
4. The current login and callback behavior remains governed by [0004 auth UI callback](../0004-auth-ui-callback/index.md).

## Follow-up

1. [ ] Capture the Angular package and CSS rules in the `## Agent skills` section of the appropriate `AGENTS.md` before implementation begins.
2. [ ] Run `/check verify` against the acceptance criteria after the migration, including AXE and browser responsive checks.
3. [x] Ship the two additive package changes in [upstream library API](0010-upstream-library-api.md), then record the released version number here and raise the dependency. Released: `@ojiepermana/angular` and `@ojiepermana/angular-theme` `22.1.4`, root dependency raised to `^22.1.4`.
4. [x] Measure the production initial bundle after the wrapper adoption and the lazy dashboard route, record the number here, and set the initial warning budget from it. Measured 2026-08-24: initial total 740.11 kB raw, 164.25 kB estimated transfer. The initial warning budget is set to 850kB with a 1MB error budget in `apps/web/angular.json`. The `qrcode` CommonJS dependency of `angularx-qrcode` is declared in `allowedCommonJsDependencies`, so the production build completes with no warning.
5. [ ] Revisit the package update policy if a future release changes the Angular peer range or the published theme entry points.
6. [ ] Confirm with the team that a `dockbar` icon rail is the right default for operators, since it replaces the labelled sidebar currently shown.
7. [ ] Decide whether showing the operator's email in the navigation footer is acceptable on shared or public facing displays, and switch to name only if it is not.
8. [ ] Consider driving service cards from a gateway service registry endpoint, which would replace the static list with real data.

## Build plan

Tracer Bullet ordering: the first slice runs a thin thread from the upstream package through the
shell, the wrapper, and one real page, so the whole composition is proven before the remaining
surfaces move.

1. Ship the additive upstream package changes, a bindable logout action and a published `ThemeSettingsAdapter`, then release and raise the dependency in monobungsia, satisfies **AC-16** and unblocks **AC-13** and **AC-14**. See [upstream library API](0010-upstream-library-api.md).
2. Verify package versions, theme provider, CSS imports, local icon font, and explicit subpath imports, and install the settings adapter on `THEME_SETTINGS_ADAPTER`, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, and **AC-11**.
3. Complete the CSS migration and preserve auth behavior and domain content, satisfies **AC-5** and **AC-8**.
4. Put `LayoutLoading` and an input free `Shell` at the application root, set host class `contents` on the root and the layout provider, and seed layout defaults through `registerDefaults`, satisfies **AC-13**.
5. Add the layout provider component wrapping `LayoutWrapperDefault` with navigation data, brand, and user, move `router-outlet` inside it, and delete the hand composed `Layout`, `LayoutVertical`, `LayoutNavigation`, `LayoutContent`, the second `Navigation` instance, and the local navigation media queries, satisfies **AC-6**, **AC-9**, and **AC-14**.
6. Move the dashboard into a lazy loaded routed component using `Page` slots, preserving gateway status and rendering one card per real service, then remove page markup from the root template, satisfies **AC-15**.
7. Render the session gate and the auth routes inside `Shell` with the fluid layout, then remove the local auth shell geometry once every spec 0004 state is confirmed intact, satisfies **AC-7** and **AC-8**.
8. Bind the navigation footer logout to `POST /api/v1/auth/logout` followed by a route to `/auth/login`, and remove the duplicate header settings trigger, satisfies **AC-16**.
9. Run build, lint, unit, AXE, responsive, browser storage, network, and landmark checks, then measure the initial bundle, record it in this spec, and set the initial warning budget from the measurement, satisfies **AC-10**, **AC-11**, and **AC-12**.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
