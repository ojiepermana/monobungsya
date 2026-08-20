# 0001. Adopt package theme and component imports

## Summary

`apps/web` memakai umbrella package `@ojiepermana/angular`, tetapi production code mengimpor entry point yang spesifik. Theme package menjadi owner mode dan theme persistence, sedangkan component, navigation, settings, dan icon memakai API package yang dapat diuji secara type safe.

## Requirements

1. **AC-P1**: Root dependency dan lockfile merekam package versions yang disetujui oleh umbrella spec.
2. **AC-P2**: Provider theme mendukung light, dark, dan system dengan system sebagai default, brand teal, base neutral, radius xs, dan compact spacing.
3. **AC-P3**: Production import tidak memakai root barrel dan tidak memuat chart atau entry point yang tidak dipakai.
4. **AC-P4**: Mode invalid atau local storage error kembali ke system tanpa membuat app gagal render.
5. **AC-P5**: Icon package memakai font lokal dan tidak membuat request font eksternal.

## Decision

Gunakan dependency berikut pada root project:

| Package                                | Version   | Peran                                               |
| -------------------------------------- | --------- | --------------------------------------------------- |
| `@ojiepermana/angular`                 | `^22.1.4` | Umbrella package dan production subpath API         |
| `@ojiepermana/angular-theme`           | `^22.1.4` | CSS theme asset yang diimpor langsung oleh aplikasi |
| `tailwindcss`                          | `^4.3.0`  | Utility generation dan token mapping                |
| `@fontsource/material-symbols-rounded` | `5.3.3`   | Material Symbols font yang dilayani lokal           |

Gunakan provider berikut sebagai konfigurasi canonical:

```ts
import { provideUiTheme } from "@ojiepermana/angular/theme/styles";

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
});
```

Gunakan subpath berikut bila dibutuhkan:

1. `@ojiepermana/angular/component/button`
2. `@ojiepermana/angular/component/card`
3. `@ojiepermana/angular/component/input`
4. `@ojiepermana/angular/component/label`
5. `@ojiepermana/angular/component/badge`
6. `@ojiepermana/angular/component/separator`
7. `@ojiepermana/angular/component/icon`
8. `@ojiepermana/angular/navigation`
9. `@ojiepermana/angular/navigation/types`
10. `@ojiepermana/angular/theme/component/settings`
11. `@ojiepermana/angular/theme/layout`
12. `@ojiepermana/angular/theme/page`

`@angular/material` tidak dipasang karena tidak ada kebutuhan untuk select, date picker, atau calendar. Provider tidak mengaktifkan preload Material Symbols eksternal. Import `@fontsource/material-symbols-rounded/400.css` harus menjadi sumber font lokal.

## State and persistence

Theme package mengelola mode yang dipilih. Nilai yang diizinkan adalah `light`, `dark`, dan `system`. `system` mengikuti `prefers-color-scheme`. Persistence package tetap berada di browser dan hanya menyimpan nilai theme yang didukung package. Aplikasi tidak membuat key kedua untuk mode.

Navigation package mengelola state untuk navigation instance `main`. State navigation package yang disimpan tidak boleh diperluas dengan email, user identity, auth token, health response, atau data domain.

## API and value sourcing

Tidak ada endpoint baru dan tidak ada perubahan pada generated SDK.

| Action           | Value produced or displayed                  | Source                                                 |
| ---------------- | -------------------------------------------- | ------------------------------------------------------ |
| Theme startup    | Active mode                                  | Persisted package value, then `system` default         |
| Theme switching  | `light`, `dark`, or `system`                 | User selection in package settings surface             |
| Theme color      | Brand teal token                             | Provider brand value `177 72% 28%`                     |
| Theme neutral    | Base neutral token                           | Provider `neutral: 'base'`                             |
| Theme radius     | Extra small radius                           | Provider `radius: 'xs'`                                |
| Theme spacing    | Compact spacing                              | Provider `space: 'compact'`                            |
| Navigation items | Item title, icon, link, active state         | Local readonly `NavigationItem[]` owned by the web app |
| Component state  | Loading, error, selected, and disabled state | Existing Angular signals and generated SDK responses   |

## Invariants and security

1. Production imports remain subpath based.
2. The app never imports or exposes the package root barrel in production code.
3. No package setting enables a Google Fonts request.
4. Browser storage contains only package theme and main navigation state.
5. Theme storage failure is non fatal.
6. Package components do not receive raw magic link tokens, session cookie values, or token hashes.
7. Existing generated SDK calls remain the only client API boundary for health and auth.

## Critical test scenarios

1. Provider startup with no stored value follows system mode, verifies **AC-P2**.
2. Provider startup with each valid stored mode applies that mode, verifies **AC-P2** and **AC-P4**.
3. Invalid storage value and thrown storage access both fall back to system, verifies **AC-P4**.
4. Production build has no external font request and renders package icons, verifies **AC-P5**.
5. Typecheck rejects invalid component or provider entry points, verifies **AC-P3**.
6. Bundle report stays inside the existing Angular budgets, verifies **AC-P3**.

## Rationale

A package owned provider avoids duplicate persistence logic and keeps the four theme axes consistent. Directly declaring the theme package is intentional because the application imports its CSS asset, while the umbrella package remains the requested public Angular dependency. Subpath imports respect the package guidance and preserve the existing bundle guardrails.
