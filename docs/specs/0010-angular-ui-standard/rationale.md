# Rationale for the Angular UI package and CSS standard

## Context

`apps/web` memakai Angular 22 dan saat ini sedang mengadopsi design system package. Root app, auth shell, login, callback, dan global stylesheet sudah berpindah ke CSS, tetapi `App` masih memegang shell operations console, health check gateway, status panel, dan service boundary cards secara langsung. Outer `workspace-app`, `workspace-layout`, dan `workspace-shell` masih menjadi wrapper lokal.

Spec 0004 sudah menetapkan route login dan callback, state form, generic auth messaging, cookie isolation, responsive behavior, dan aksesibilitas. Perubahan baru perlu menjaga kontrak itu sambil memberi main app satu pola untuk theme, shell, layout, navigation, page, component, dan CSS. Tanpa keputusan bersama, halaman baru akan mencampur package component dengan CSS lokal dan aturan frame yang berbeda.

Package `@ojiepermana/angular` version `22.1.4` mendukung Angular 22.1 dan menyediakan subpath untuk component, theme, shell, layout, page, navigation, dan settings. Theme package menyediakan provider runtime untuk mode, color, neutral, radius, spacing, serta CSS Tailwind v4. Shell package mengatur surface browser atau window, layout package mengatur frame, landmark, dan content scroll, page package mengatur slot halaman, sedangkan navigation package menyediakan container input driven, navbar, sidebar, flyout, drawer, focus aware overlay behavior, dan persistence untuk navigation utama.

Perubahan ini adalah keputusan UI client. Tidak ada entity database baru, endpoint baru, perubahan generated SDK, atau perubahan pada auth service. Data browser dibatasi pada theme preference dan state navigation yang memang dikelola package.

> Premise note: Permintaan ini memuat tiga keputusan yang dapat dibangun terpisah, yaitu adopsi package, migrasi style, dan integrasi layout. Keputusan ini memakai umbrella spec supaya tiap bagian tetap dapat dibangun sendiri, tetapi kontraknya tetap satu.

## Diagnosis of the first attempt

Keputusan awal memilih Option 1, komposisi eksplisit, dan implementasinya sudah dibangun. Hasilnya
tidak sesuai dengan cara package dipakai, dan penyebabnya dapat ditunjuk dengan jelas.

**Premis yang salah.** Option 2 ditolak dengan alasan "session response saat ini hanya menyediakan
name dan role", sehingga `UserIdentity` tidak dapat diisi. Premis itu tidak benar.
`sessionResponse` di `apps/services/auth/src/modules/auth/auth.schema.ts` mengembalikan
`user: { id, email, name, role }`, dan `apps/gateway/erp/src/routes/proxy.route.ts` sudah membaca
`session.user.email`. Jadi penghalang utama Option 2 sebenarnya tidak ada.

**Akibatnya pada kode.** Komposisi eksplisit memaksa aplikasi memiliki bagian yang paling sulit:
penempatan navigation, drawer mobile, skip link, dan landmark. Implementasinya berakhir dengan dua
instance `Navigation` dan media query lokal hanya untuk menyembunyikan navigation per breakpoint,
padahal `LayoutWrapperDefault` sudah menyediakan semuanya lewat input.

**Detail yang terlewat.** Tiga hal yang dipakai showcase app tidak ikut diputuskan, dan ketiganya
bukan detail kosmetik:

1. `host: { class: 'contents' }` pada root component dan pada penyedia layout. Tanpa itu `Layout`
   tidak menjadi flex item langsung `Shell`, sehingga rantai tinggi viewport patah.
2. `Shell` tanpa input axis. Menyetel `mode="web"` dan `color="sync"` mematikan kontrol shell pada
   settings surface, dan komentar di showcase app menyebut hal ini secara eksplisit.
3. `LayoutLoading` di root, sehingga progress bar aktif sejak navigasi pertama.

**Kesimpulan.** Ini bukan kasus dua opsi yang seimbang lalu salah pilih. Option 2 ditolak karena satu
fakta yang salah tentang data yang tersedia, dan konsekuensinya adalah aplikasi menulis ulang
perilaku yang sudah dimiliki package. Revisi ini memilih Option 2 dan memperlakukan showcase app
package sebagai referensi consumer.

## Options considered

### Option 1: Package primitives dengan komposisi eksplisit

Gunakan package theme, shell, layout, page, component, navigation, dan settings pada `apps/web`. Pertahankan konten domain yang ada, tetapi letakkan di dalam komposisi `Shell`, `Layout`, `Navigation`, dan `Page`. Gunakan Tailwind v4 dan token package untuk style.

**Pros**:

1. Satu vocabulary untuk token, spacing, radius, shell, layout, page, component, dan navigation.
2. Package menjadi owner frame, scroll, landmark, dan overlay behavior.
3. Konten domain tetap dipertahankan sehingga perubahan tidak menjadi rewrite.
4. Session gate dan auth shell dapat dipisahkan dari main app dengan jelas.

**Cons**:

1. Blast radius visual besar karena outer composition berubah bersama migrasi style.
2. Dependency surface lebih besar daripada kebutuhan layar saat ini.
3. Maintainer perlu memahami package API, slot projection, dan Tailwind token.

### Option 2: Gunakan LayoutWrapperDefault (dipilih, revisi 2026-08-21)

Gunakan wrapper layout siap pakai dari package untuk merakit layout, navigation, brand, user, skip link, dan mobile drawer dari input.

**Pros**:

1. Kode consumer lebih pendek.
2. Mobile navigation dan landmark behavior memakai satu implementation package.
3. Brand dan user slots sudah memiliki pola yang konsisten.

**Cons**:

1. Footer navigation menampilkan email pengguna, bukan role, sehingga tampilan footer berubah.
2. Tombol logout wrapper belum memiliki output, dan wrapper memasang trigger theme settings sendiri, sehingga butuh penambahan aditif di package.
3. Wrapper memuat seluruh varian navigation, jadi biaya bundle lebih besar daripada frame yang dirakit tangan.
4. Wrapper memilih nav type lebih awal, walaupun operator tetap dapat menggantinya dari settings surface.

### Option 3: Pertahankan wrapper lokal

Pertahankan `workspace-app`, `workspace-layout`, dan `workspace-shell`, lalu tambahkan package component dan navigation di dalamnya.

**Pros**:

1. Perubahan template awal lebih kecil.
2. Role footer dan markup domain tidak perlu dipindahkan.
3. Rollback visual mudah dilakukan.

**Cons**:

1. Frame, scroll, landmark, dan responsive behavior tetap memiliki dua owner.
2. Package shell, layout, dan page tidak benar benar dipakai oleh main page.
3. Setiap page baru akan memperpanjang wrapper lokal yang tidak menjadi standard design system.

## Rationale

Option 2 dipilih karena package sudah menyediakan komposisi consumer yang lengkap, dan showcase app
package adalah bukti berjalan tentang cara memakainya. `LayoutWrapperDefault` menerima axis layout,
nav type, data navigation, brand, dan user, lalu memproyeksikan `router-outlet`. Semua yang sulit,
yaitu penempatan navigation, drawer mobile, skip link, content landmark, dan focus on navigation,
menjadi perilaku package. Aplikasi kembali hanya memiliki data dan konten domain.

Option 1 menjadi runner up, dan pengalaman membangunnya menjelaskan kenapa ia bukan pilihan utama.
Komposisi eksplisit memberi kontrol penuh, tetapi kontrol itu ditukar dengan kewajiban memelihara
perilaku responsif dan aksesibilitas yang sudah selesai di package. Ia tetap masuk akal untuk layar
yang benar benar tidak dapat dilayani wrapper, bukan untuk shell utama. Option 3 tetap ditolak
dengan alasan yang sama seperti sebelumnya, yaitu dua owner untuk frame dan scroll.

`Shell` tanpa input axis dipilih supaya kontrol shell pada settings surface hidup. Menyetel mode
secara eksplisit membuat empat kontrol menjadi mati bagi pengguna. Biayanya adalah empat key
`shell-*` di localStorage. Key itu milik package, hanya berisi preference tampilan, dan tidak memuat
data pengguna, sehingga batas storage cukup dilonggarkan pada daftar key yang diizinkan, bukan
dibuka bebas.

Menempatkan `Shell` di root secara tak bersyarat menyelesaikan dua hal sekaligus. Frame tidak lagi
muncul menyusul setelah session gate selesai, dan auth route mendapatkan shell fluid dari layout
brand only milik package, tepat seperti yang diminta AC-8. Satu mekanisme melayani dua kebutuhan,
dan CSS auth lokal dapat dihapus alih alih dipelihara.

Dua penambahan upstream diminta karena keduanya adalah kekurangan package, bukan kebutuhan khusus
monobungsia. Tombol logout yang tidak memancarkan apa pun adalah kontrol mati bagi setiap consumer
dengan session nyata. Logika batasan axis di showcase app adalah pengetahuan package, jadi
membiarkannya di kode consumer berarti setiap aplikasi menyalinnya dan berisiko menyimpang. Karena
satu rilis sudah dibutuhkan untuk logout, adapter ikut tanpa tambahan biaya koordinasi.

Nav type default `dockbar` mengikuti showcase app. Ini mengubah tampilan dari sidebar berlabel
menjadi rail ikon, jadi ia dicatat sebagai konsekuensi yang terlihat dan sebagai follow up untuk
dikonfirmasi bersama tim. Operator tetap dapat menggantinya, sehingga biaya salah pilih rendah.

Package adalah pilihan yang tepat untuk komponen umum karena sudah menyediakan theme provider, token CSS, shell window boundary, layout scroll contract, page slots, navigation overlay, dan subpath tree shaking. Aturan produksi memakai subpath karena package sendiri memperingatkan risiko bundle. Root barrel hanya layak untuk test, demo, atau prototype.

Session gate tetap menentukan kapan area operasi boleh dirender, tetapi tidak lagi menentukan kapan
`Shell` dirender. Endpoint session yang sudah ada cukup untuk ini. Login tetap tidak memuat
navigation karena layout `fluid` bersifat brand only, sehingga perubahan ini tidak memperlebar
boundary auth dan tidak memperkenalkan data browser baru.

Theme package service menjadi owner state karena provider sudah memiliki mode `light`, `dark`, dan `system` serta persistence. Service lokal kedua akan membuat dua sumber kebenaran. Nilai brand teal berasal dari token teal saat ini, radius `xs` dipilih daripada `none` agar component tetap memiliki affordance minimum, dan density `compact` mengikuti kebutuhan operations console.

Self hosted Material Symbols dipilih untuk menghindari request eksternal. Package font `@fontsource/material-symbols-rounded` menyediakan CSS dan file font lokal. Jika runtime package tetap mencoba memuat font eksternal, implementasi harus memakai renderer icon package yang diarahkan ke asset lokal dan validation gate harus memastikan tidak ada request font eksternal.

## References

**Project sources**:

1. `CLAUDE.md`, aturan monorepo, Angular, generated SDK, dan Bun.
2. `apps/web/AGENTS.md`, aturan Angular standalone, signals, forms, dan aksesibilitas.
3. `docs/specs/0004-auth-ui-callback/index.md`, kontrak login, callback, state, dan responsive auth.
4. `apps/web/src/app/app.ts` dan `apps/web/src/app/app.html`, shell utama dan gateway health behavior.
5. `apps/web/src/app/*.css` dan `apps/web/src/styles.css`, style surface yang menjadi batas migrasi.
6. Package metadata and README untuk `@ojiepermana/angular@22.1.4`, `@ojiepermana/angular-theme@22.1.4`, `@ojiepermana/angular-navigation@22.1.4`, dan `@fontsource/material-symbols-rounded@5.3.3`.
7. `apps/services/auth/src/modules/auth/auth.schema.ts`, `sessionResponse` yang mengembalikan `user: { id, email, name, role }`, fakta yang membatalkan penolakan awal terhadap `LayoutWrapperDefault`.
8. `apps/gateway/erp/src/routes/proxy.route.ts`, gateway yang sudah membaca `session.user.email`.

**Package consumer reference** (repository library, dibaca langsung, bukan dari web):

1. `/Users/ojiepermana/Development/ojiepermana/angular/src/app/app.ts`, pola root: `LayoutLoading`, `Shell` tanpa input, host class `contents`.
2. `/Users/ojiepermana/Development/ojiepermana/angular/src/app/layout/layout.ts`, pola penyedia layout yang membungkus `LayoutWrapperDefault`.
3. `/Users/ojiepermana/Development/ojiepermana/angular/src/app/layout/identity.ts`, bentuk konkret `BrandIdentity` dan `UserIdentity`.
4. `/Users/ojiepermana/Development/ojiepermana/angular/src/app/layout-settings-service.ts`, implementasi `ThemeSettingsAdapter` beserta `allowedNavTypes` dan `enforceConstraints`.
5. `/Users/ojiepermana/Development/ojiepermana/angular/src/app/app.config.ts`, pemasangan `THEME_SETTINGS_ADAPTER`.
6. `/Users/ojiepermana/Development/ojiepermana/angular/src/app/home-page.ts`, pola halaman: host `block h-full min-h-0` dengan root `Page`.
7. `/Users/ojiepermana/Development/ojiepermana/angular/library/theme/layout/wrapper/shared/layout-user.component.ts`, tombol logout tanpa handler dan trigger theme settings yang tertanam.
8. `/Users/ojiepermana/Development/ojiepermana/angular/CLAUDE.md`, struktur repository library dan aturan secondary entry point.

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
