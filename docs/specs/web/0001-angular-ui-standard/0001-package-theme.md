# 0001. Adopt package theme and component imports

## Summary

`apps/web` memakai umbrella package `@ojiepermana/angular`, tetapi production code mengimpor entry point yang spesifik. Theme package menjadi owner mode dan theme persistence, sedangkan shell, layout, page, component, navigation, settings, dan icon memakai API package yang dapat diuji secara type safe.

## Requirements

1. **AC-P1**: Root dependency dan lockfile merekam package versions yang disetujui oleh umbrella spec.
2. **AC-P2**: Provider theme mendukung light, dark, dan system dengan system sebagai default, brand teal, base neutral, radius xs, dan compact spacing.
3. **AC-P3**: Production import tidak memakai root barrel dan tidak memuat chart atau entry point yang tidak dipakai.
4. **AC-P4**: Mode invalid atau local storage error kembali ke system tanpa membuat app gagal render.
5. **AC-P5**: Icon package memakai font lokal dan tidak membuat request font eksternal.
6. **AC-P6**: Production code dapat mengimpor shell, layout, page, navigation, settings, dan component dari explicit package subpaths tanpa bare barrel import.
7. **AC-P7**: `Shell` dirender tanpa input axis, sehingga mode, device, color, dan frame diselesaikan package dari storage dan tetap dapat diubah dari settings surface.
8. **AC-P8**: Aplikasi memasang satu implementasi `ThemeSettingsAdapter` yang dipublikasikan package pada `THEME_SETTINGS_ADAPTER`, sehingga settings surface dapat mengubah axis layout dan navigation tanpa logika batasan lokal.
9. **AC-P9**: Storage browser hanya memuat key presentasi milik package: theme, shell axes, layout axes, dan navigation state. Tidak ada data pengguna yang ditulis.
8. **AC-P8**: Shell, layout, page, and navigation packages own the frame, content scroll, skip link target, page slots, and navigation landmarks. Local CSS does not duplicate outer shell geometry.

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
13. `@ojiepermana/angular/theme/shell`
14. `@ojiepermana/angular/theme/layout/wrapper`
15. `@ojiepermana/angular/theme/page/root`
16. `@ojiepermana/angular/theme/page/slots`

`@angular/material` tidak dipasang karena tidak ada kebutuhan untuk select, date picker, atau calendar. Provider tidak mengaktifkan preload Material Symbols eksternal. Import `@fontsource/material-symbols-rounded/400.css` harus menjadi sumber font lokal.

## State and persistence

Theme package mengelola mode yang dipilih. Nilai yang diizinkan adalah `light`, `dark`, dan `system`. `system` mengikuti `prefers-color-scheme`. Persistence package tetap berada di browser dan hanya menyimpan nilai theme yang didukung package. Aplikasi tidak membuat key kedua untuk mode.

Navigation package mengelola state untuk navigation instance `main`. State navigation package yang disimpan tidak boleh diperluas dengan email, user identity, auth token, health response, atau data domain.

`Shell` tidak menerima input axis. Package menyelesaikan mode, device, color, dan frame dari storage,
sehingga kontrol shell pada settings surface benar benar bekerja. Menyetel `mode` atau `color` secara
eksplisit akan mematikan kontrol itu, jadi input axis tidak dipakai.

Konsekuensinya storage memuat lebih dari satu preference visual. Key yang diizinkan adalah:

| Kelompok | Key | Pemilik |
| --- | --- | --- |
| Theme | mode dan axis theme lain | `provideUiTheme` dan `ThemeModeService` |
| Shell | `shell-mode`, `shell-device`, `shell-color`, `shell-frame` | `ShellService` |
| Layout | surface, appearance, width, layout type | `LayoutService` |
| Navigation | nav type, nav type mode | `ThemeSettingsAdapter` yang dipublikasikan |

Semuanya adalah preference tampilan milik package. Tidak ada identitas, token, atau data session yang
ditulis ke storage. Kegagalan storage tetap tidak fatal dan jatuh ke default.

Axis layout dan navigation dilayani satu implementasi `ThemeSettingsAdapter` dari package, dipasang
melalui `THEME_SETTINGS_ADAPTER`, sehingga batasan seperti nav type yang valid per layout type tidak
diduplikasi di aplikasi. Lihat [upstream library API](0001-upstream-library-api.md).

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
| Shell axes        | `web` mode and `sync` color                  | Explicit `Shell` inputs in the authenticated app template |
| Layout and pages  | Frame, scroll, slots, and landmarks         | Package layout and page composition in the layout child spec |
| Component state  | Loading, error, selected, and disabled state | Existing Angular signals and generated SDK responses   |

## Invariants and security

1. Production imports remain subpath based.
2. The app never imports or exposes the package root barrel in production code.
3. No package setting enables a Google Fonts request.
4. Browser storage contains only package owned presentation keys: theme, shell axes, layout axes, and navigation state.
5. Theme storage failure is non fatal.
6. Package components do not receive raw magic link tokens, session cookie values, or token hashes.
7. Existing generated SDK calls remain the only client API boundary for health and auth.
8. The package shell, layout, and page entry points remain explicit subpath imports.
9. Shell mode, device, color, and frame are not stored by the authenticated web surface because the mode and color are pinned by template inputs.

## Critical test scenarios

1. Provider startup with no stored value follows system mode, verifies **AC-P2**.
2. Provider startup with each valid stored mode applies that mode, verifies **AC-P2** and **AC-P4**.
3. Invalid storage value and thrown storage access both fall back to system, verifies **AC-P4**.
4. Production build has no external font request and renders package icons, verifies **AC-P5**.
5. Typecheck rejects invalid component or provider entry points, verifies **AC-P3**.
6. Bundle report stays inside the existing Angular budgets, verifies **AC-P3**.
7. Production import audit finds explicit shell, layout, page, navigation, settings, and component subpaths and no bare package barrel import, verifies **AC-P6**.
8. Authenticated browser output shows package shell and page host attributes, one content scroll owner, and no duplicate outer frame rules, verifies **AC-P7** and **AC-P8**.

## Rationale

A package owned provider avoids duplicate persistence logic and keeps the four theme axes consistent. Directly declaring the theme package is intentional because the application imports its CSS asset, while the umbrella package remains the requested public Angular dependency. Subpath imports respect the package guidance and preserve the existing bundle guardrails.

Shell, layout, and page imports are part of the same design system boundary. Pinning web shell inputs keeps browser behavior predictable and avoids turning desktop or Tauri preferences into an accidental web feature. The page primitives also give future routes one scroll and landmark contract, while local domain components remain free to express gateway and service content.
