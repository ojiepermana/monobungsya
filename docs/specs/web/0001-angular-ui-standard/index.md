# 0001. Adopt the Angular UI package and CSS standard

**Date**: 2026-08-20
**Status**: Accepted

## Summary

`apps/web` akan memakai `@ojiepermana/angular` sebagai dasar komponen, theme, dan navigation. Semua style aplikasi akan berpindah dari SCSS ke CSS dengan Tailwind v4 dan token theme package. Login tetap mempertahankan perilaku auth yang sudah disepakati, tetapi memakai shell fluid, sedangkan main app memakai navigation shell dan settings package setelah session berhasil.

## Structure

1. [Package and theme adoption](0001-package-theme.md), menetapkan dependency, import, theme provider, icon, dan state theme.
2. [CSS migration](0001-css-migration.md), menetapkan perpindahan seluruh style `apps/web` dari SCSS ke CSS.
3. [Layout integration](0001-layout-integration.md), menetapkan session gate, shell main app, shell login, responsive behavior, dan aksesibilitas.

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
11. **AC-11**: Browser storage contains only the package theme values and package navigation state. It never contains email, magic link token, session cookie value, token hash, health response, or user identity data.
12. **AC-12**: The web validation gate passes Angular build, lint, web unit tests, AXE checks, desktop and mobile responsive checks, and the existing bundle budgets. If a root barrel or package import breaks the budget, production imports remain subpath based and the budget is not raised without a separate decision.

## Decision

Adopt `@ojiepermana/angular` version `22.1.x` as the Angular design system for `apps/web`. Use its production subpaths for UI components, theme services, navigation, and settings. Use `@ojiepermana/angular-theme` directly for the published CSS assets, `tailwindcss` `^4.3.0` for utility generation, and `@fontsource/material-symbols-rounded` `5.3.3` for local icon assets.

The canonical theme is system mode with light and dark support, brand teal, base neutral, extra small radius, and compact spacing. The main app uses the package navigation shell and settings drawer after the existing session endpoint confirms authentication. Login and callback keep the dedicated auth routes from spec 0004 and use a fluid shell without main navigation.

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

1. Production components import from subpaths such as `@ojiepermana/angular/component/button`, `@ojiepermana/angular/component/card`, `@ojiepermana/angular/navigation`, and `@ojiepermana/angular/theme/component/settings`.
2. The main app composes the package `Navigation` container with its desktop renderer and mobile flyout or drawer. The package owns navigation overlay state and the `main` navigation persistence.
3. The theme provider owns mode persistence. The application does not create a second theme storage service.
4. Local semantic wrappers are allowed for domain content such as gateway status, service cards, session gate messages, and auth state panels when a package component cannot preserve the required behavior or accessibility.
5. Domain colors that are not part of the package theme, such as the existing coral status accent, use scoped CSS custom properties and do not replace package tokens.
6. The provider does not enable external Material Symbols loading. The local font import is the only icon font source.

**Replaces**:

1. Component style defaults that generate SCSS.
2. `styleUrl` values that point to `.scss` files.
3. Global SCSS files and Sass variables used as the application theme.
4. Production imports from the bare `@ojiepermana/angular` barrel.
5. A local theme storage service that duplicates `ThemeModeService` behavior.
6. A main app shell that renders before session state is known.
7. A mobile navigation implementation without focus containment and focus return.

**Enforcement**:

1. Angular CLI configuration uses CSS for the component schematic and inline style language.
2. A repository check fails when `apps/web` contains a referenced `.scss` file or a production import from the bare package barrel.
3. Angular build keeps the existing initial and component style budgets.
4. TypeScript compilation catches invalid package entry points and component inputs.
5. Web tests cover session gate states, auth regressions, theme fallback, navigation overlay behavior, and responsive layout.
6. AXE and responsive browser checks are required in the validation gate.

**Rollout**:

1. Install the package, theme CSS dependency, Tailwind, and local icon font, then register the provider.
2. Migrate global and component styles from SCSS to CSS and change Angular defaults.
3. Replace mapped controls and containers with package components, then add the main navigation and settings surface.
4. Add the client session gate and preserve the auth route state machine while applying the fluid login shell.
5. Run build, lint, unit, AXE, responsive, and bundle checks in one coordinated migration.

**Exceptions**: The package does not own domain content markup. A local semantic wrapper is allowed when it is needed for an application specific state, a generated SDK boundary, or an accessibility behavior that the package does not expose. Any exception must keep package tokens and CSS rules and must not add SCSS.

## Consequences

**Positive**:

1. Angular screens share one source for tokens, components, navigation, and theme behavior.
2. CSS becomes the only style language in `apps/web`, which reduces configuration and migration ambiguity.
3. Login adapts fluidly while preserving the security behavior already defined for magic links and cookies.
4. Main app navigation and settings gain package managed responsive and keyboard behavior.
5. Self hosted icons avoid an external font request and keep the browser data boundary explicit.

**Negative / tradeoffs**:

1. The umbrella package adds a large dependency surface even when production imports are tree shakeable.
2. Tailwind utilities and package tokens add a new styling vocabulary that maintainers must learn.
3. The session gate adds a loading and service failure state before the main app can render.
4. A package update can change component behavior or visual tokens, so the bundle and browser validation gate must run on updates.
5. The migration touches every active web style file and can create broad visual regressions if components are mapped without focused tests.

**Neutral**:

1. No backend migration, API route, generated SDK contract, or auth service change is part of this decision.
2. The theme preference is browser local state, not a user profile preference, so it does not follow a user across devices.
3. The existing operations console copy and gateway health data remain in the main app.
4. The current login and callback behavior remains governed by [0004 auth UI callback](../../0004-auth-ui-callback.md).

## Follow-up

1. [ ] Capture the Angular package and CSS rules in the `## Agent skills` section of the appropriate `AGENTS.md` before implementation begins.
2. [ ] Run `/check verify` against the acceptance criteria after the migration, including AXE and browser responsive checks.
3. [ ] Measure the production bundle after subpath imports and record the result with the validation evidence.
4. [ ] Enroll a matching `apps/web` feature in `docs/scope/` if this standalone decision is going to be tracked as a buildable work item.
5. [ ] Revisit the package update policy if a future release changes the Angular peer range or the published theme entry points.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
