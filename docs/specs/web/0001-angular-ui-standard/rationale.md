# Rationale for the Angular UI package and CSS standard

## Context

`apps/web` memakai Angular 22 dan saat ini belum memiliki design system package. Root app, auth shell, login, callback, dan global stylesheet masih memakai SCSS. `App` juga memegang shell operations console, health check gateway, status panel, dan service boundary cards secara langsung.

Spec 0004 sudah menetapkan route login dan callback, state form, generic auth messaging, cookie isolation, responsive behavior, dan aksesibilitas. Perubahan baru perlu menjaga kontrak itu sambil memberi main app satu pola untuk theme, navigation, component, dan CSS. Tanpa keputusan bersama, halaman baru akan mencampur SCSS lama, CSS lokal, dan package component dengan aturan yang berbeda.

Package `@ojiepermana/angular` version `22.1.4` mendukung Angular 22.1 dan menyediakan subpath untuk component, theme, navigation, dan settings. Theme package menyediakan provider runtime untuk mode, color, neutral, radius, spacing, serta CSS Tailwind v4. Navigation package menyediakan container input driven, navbar, sidebar, flyout, drawer, focus aware overlay behavior, dan persistence untuk navigation utama.

Perubahan ini adalah keputusan UI client. Tidak ada entity database baru, endpoint baru, perubahan generated SDK, atau perubahan pada auth service. Data browser dibatasi pada theme preference dan state navigation yang memang dikelola package.

> Premise note: Permintaan ini memuat tiga keputusan yang dapat dibangun terpisah, yaitu adopsi package, migrasi style, dan integrasi layout. Keputusan ini memakai umbrella spec supaya tiap bagian tetap dapat dibangun sendiri, tetapi kontraknya tetap satu.

## Options considered

### Option 1: Package Angular dengan migrasi CSS terkoordinasi

Gunakan package theme, component, navigation, dan settings pada seluruh `apps/web`. Pindahkan semua style ke CSS, gunakan Tailwind v4 dan token package, lalu migrasikan main app dan auth dengan perilaku lama sebagai batas.

**Pros**:

1. Satu vocabulary untuk token, spacing, radius, component, dan navigation.
2. Migrasi selesai dalam satu aturan sehingga file baru tidak menambah SCSS.
3. Package menyediakan behavior responsive dan overlay yang dapat diuji.
4. Session gate dan auth shell dapat dipisahkan dari main app dengan jelas.

**Cons**:

1. Blast radius visual besar karena semua style aktif berpindah sekaligus.
2. Dependency surface lebih besar daripada kebutuhan layar saat ini.
3. Maintainer perlu memahami package API dan Tailwind token.

### Option 2: Pertahankan SCSS dan pakai package hanya untuk layar baru

Biarkan shell dan auth yang ada memakai SCSS. Package hanya digunakan ketika feature baru membutuhkan component atau theme tertentu.

**Pros**:

1. Perubahan awal lebih kecil.
2. Risiko regresi visual jangka pendek lebih rendah.
3. Tim dapat belajar package tanpa migrasi menyeluruh.

**Cons**:

1. Dua sistem style akan hidup bersamaan tanpa batas akhir yang jelas.
2. Token dan responsive behavior dapat berbeda antar halaman.
3. Setiap feature baru harus memilih antara SCSS dan package.

### Option 3: Root barrel package dan rewrite bebas

Install umbrella package dan impor seluruh design system dari root barrel. Layout dan komponen dapat ditulis ulang tanpa mempertahankan banyak struktur UI saat ini.

**Pros**:

1. API import terlihat sederhana.
2. Rewrite memberi kebebasan untuk mengambil seluruh pola package.
3. Semua fitur package mudah dieksplorasi pada awal proyek.

**Cons**:

1. Dokumentasi package memperingatkan bahwa root barrel membawa seluruh design system dan dapat merusak budget bundle.
2. Rewrite bebas mengaburkan kontrak auth 0004 dan health check yang sudah ada.
3. Perubahan besar lebih sulit diverifikasi dan di-rollback.

## Rationale

Option 1 paling sesuai dengan Angular 22 yang sudah dipakai, kebutuhan untuk menghapus SCSS, dan keputusan 0004 yang menjadikan UI saat ini sebagai sumber isi dan perilaku. Migrasi terkoordinasi mengurangi umur dua sistem style dan memberi titik enforcement yang dapat diperiksa oleh build serta repository check.

Package adalah pilihan yang tepat untuk komponen umum karena sudah menyediakan theme provider, token CSS, navigation overlay, dan subpath tree shaking. Engineer memilih root barrel pada satu tahap percakapan, tetapi aturan produksi memakai subpath karena package sendiri memperingatkan risiko bundle. Root barrel hanya layak untuk test, demo, atau prototype.

Session gate menjadi bagian dari shell karena main app seharusnya tidak menampilkan area operasi sebelum session diketahui. Endpoint session yang sudah ada cukup untuk ini. Login tetap terpisah dan tidak memuat navigation, sehingga perubahan layout tidak memperlebar boundary auth atau memperkenalkan data browser baru.

Theme package service menjadi owner state karena provider sudah memiliki mode `light`, `dark`, dan `system` serta persistence. Service lokal kedua akan membuat dua sumber kebenaran. Nilai brand teal berasal dari token teal saat ini, radius `xs` dipilih daripada `none` agar component tetap memiliki affordance minimum, dan density `compact` mengikuti kebutuhan operations console.

Self hosted Material Symbols dipilih untuk menghindari request eksternal. Package font `@fontsource/material-symbols-rounded` menyediakan CSS dan file font lokal. Jika runtime package tetap mencoba memuat font eksternal, implementasi harus memakai renderer icon package yang diarahkan ke asset lokal dan validation gate harus memastikan tidak ada request font eksternal.

## References

**Project sources**:

1. `CLAUDE.md`, aturan monorepo, Angular, generated SDK, dan Bun.
2. `apps/web/AGENTS.md`, aturan Angular standalone, signals, forms, dan aksesibilitas.
3. `docs/specs/0004-auth-ui-callback.md`, kontrak login, callback, state, dan responsive auth.
4. `apps/web/src/app/app.ts` dan `apps/web/src/app/app.html`, shell utama dan gateway health behavior.
5. `apps/web/src/app/*.scss` dan `apps/web/src/styles.scss`, style surface yang harus dimigrasikan.
6. Package metadata and README untuk `@ojiepermana/angular@22.1.4`, `@ojiepermana/angular-theme@22.1.4`, `@ojiepermana/angular-navigation@22.1.4`, dan `@fontsource/material-symbols-rounded@5.3.3`.

**Practices and standards**:

1. Tree shaking and production subpath imports.
2. Progressive replacement of a live UI with a coordinated migration and a rollback point.
3. WCAG AA keyboard access, visible focus, semantic status, and focus return for overlays.
4. Browser credential isolation and data minimization.

**Links**:

1. [`@ojiepermana/angular` package](https://www.npmjs.com/package/@ojiepermana/angular)
2. [`@ojiepermana/angular-theme` package](https://www.npmjs.com/package/@ojiepermana/angular-theme)
3. [`@ojiepermana/angular-navigation` package](https://www.npmjs.com/package/@ojiepermana/angular-navigation)
4. [`@fontsource/material-symbols-rounded` package](https://www.npmjs.com/package/@fontsource/material-symbols-rounded)
5. [Tailwind CSS installation guidance](https://tailwindcss.com/docs/installation/using-vite)
6. [Angular package repository](https://github.com/ojiepermana/angular)
