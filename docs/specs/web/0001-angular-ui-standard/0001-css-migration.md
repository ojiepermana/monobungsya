# 0001. Migrate apps web styles to CSS

## Summary

Semua style aktif di `apps/web` berpindah dari SCSS ke CSS. Angular CLI memakai CSS sebagai default, global CSS memuat theme package dan Tailwind v4, serta domain style hanya memakai custom property CSS yang scoped.

## Requirements

1. **AC-C1**: `app.scss`, `auth-shell.scss`, `auth-login.scss`, `auth-callback.scss`, dan `styles.scss` tidak lagi menjadi source aktif.
2. **AC-C2**: Semua `styleUrl`, global `styles`, schematic style default, dan `inlineStyleLanguage` menunjuk ke CSS.
3. **AC-C3**: Global CSS memuat theme full CSS, Tailwind v4, package token map, and local Material Symbols CSS.
4. **AC-C4**: Existing layout, copy, gateway status, service cards, auth state, and responsive behavior remain observable after the migration.
5. **AC-C5**: No Angular build error, style budget regression, horizontal overflow, or unscoped global rule is introduced.

## Decision

Use CSS as the only style language for `apps/web`. Rename every active SCSS file to CSS, update component metadata, and set Angular configuration defaults to CSS. Do not keep parallel SCSS files as an undocumented reference.

Use this global import order:

```css
@import '@ojiepermana/angular-theme/theme-full.css';
@import 'tailwindcss';
@import '@ojiepermana/angular-theme/styles/css/base/tailwind.css';
@import '@fontsource/material-symbols-rounded/400.css';
```

The full theme CSS is required because the application supports runtime mode and theme axes. Tailwind token mapping follows the theme CSS. Local CSS may add layout composition and domain values, but package tokens remain the source for surface, text, accent, radius, and spacing values wherever a token exists.

## Migration surface

1. `apps/web/src/styles.scss` becomes `apps/web/src/styles.css`.
2. `apps/web/src/app/app.scss` becomes `apps/web/src/app/app.css`.
3. `apps/web/src/app/auth/auth-shell.scss` becomes `apps/web/src/app/auth/auth-shell.css`.
4. `apps/web/src/app/auth/auth-login.scss` becomes `apps/web/src/app/auth/auth-login.css`.
5. `apps/web/src/app/auth/auth-callback.scss` becomes `apps/web/src/app/auth/auth-callback.css`.
6. Component metadata points to the new CSS files.
7. `apps/web/angular.json` sets the component schematic style to `css` and the build inline style language to `css`.
8. Existing SCSS syntax is rewritten as CSS syntax. Sass nesting, variables, mixins, and functions are not carried forward as a second local system.
9. Domain values such as the coral status accent use scoped custom properties with names owned by the component or feature.
10. CSS selectors remain component scoped unless a global reset, font, token import, or document level accessibility rule is required.

## Enforcement

The web configuration and repository checks enforce the migration.

1. A check fails when `apps/web` contains an `.scss` source.
2. A check fails when a component references `.scss` or Angular configuration contains `scss`.
3. A check fails when production TypeScript imports the bare package barrel.
4. Angular build enforces the existing initial and component style budgets.
5. Review checks that any new global selector is justified by document scope and that feature styles remain component scoped.

## Critical test scenarios

1. A clean build resolves every CSS import and component stylesheet, verifies **AC-C1**, **AC-C2**, and **AC-C3**.
2. A search over `apps/web` finds no SCSS source or reference, verifies **AC-C1** and **AC-C2**.
3. Main app and auth tests retain their visible states after the rename, verifies **AC-C4**.
4. Desktop and mobile browser checks show no horizontal overflow, verifies **AC-C4** and **AC-C5**.
5. Production build stays inside the existing style budgets, verifies **AC-C5**.

## Rationale

A complete CSS migration is preferable to leaving Sass files as dormant alternatives. The application is small enough for one coordinated migration, and the theme package already defines the token and utility layer that Sass variables would otherwise duplicate. The rollback point is the migration change itself, before later screens add new CSS assumptions.
