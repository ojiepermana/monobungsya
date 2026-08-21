# 0001. Upstream library API needed by the web console

## Summary

Dua kemampuan harus ada di `@ojiepermana/angular` sebelum `apps/web` dapat menyelesaikan komposisi
package: aksi logout yang dapat diikat consumer, dan implementasi `ThemeSettingsAdapter` yang
dipublikasikan. Keduanya adalah perubahan aditif di repository library, bukan di monobungsia. Spec ini
mencatat kontrak yang dibutuhkan supaya kedua repository sepakat sebelum pekerjaan dimulai.

Library berada di `/Users/ojiepermana/Development/ojiepermana/angular/`, repository terpisah dengan
siklus rilis sendiri. Monobungsia mengonsumsinya dari npm.

## Requirements

1. **AC-U1**: `LayoutUser` mengekspos aksi logout yang dapat diikat consumer, sehingga tombol logout di footer navigation memanggil kode aplikasi.
2. **AC-U2**: `LayoutWrapperDefault` meneruskan aksi logout itu ke consumer, sehingga aplikasi tidak perlu menyusun ulang footer navigation hanya untuk logout.
3. **AC-U3**: Aksi logout diteruskan pada setiap nav type yang menampilkan identitas user, termasuk `sidebar` dan `dockbar`, bukan hanya satu varian.
4. **AC-U4**: Package mempublikasikan implementasi `ThemeSettingsAdapter` default yang membawa batasan axis (`allowedNavTypes`, penyelarasan nav type mode, dan aturan width `fluid`), beserta cara memasangnya ke `THEME_SETTINGS_ADAPTER`.
5. **AC-U5**: Adapter default menyimpan pilihan layout type, nav type, dan nav type mode dengan storage key milik package, dan menangani storage yang tidak tersedia tanpa melempar error.
6. **AC-U6**: Kedua perubahan bersifat aditif. Consumer yang sudah ada, termasuk showcase app, tetap bekerja tanpa perubahan wajib.
7. **AC-U7**: Versi package yang memuat kedua perubahan dirilis ke npm, dan nomor versinya tercatat sehingga monobungsia dapat menaikkan dependency dengan pasti.

## Decision

### Aksi logout

Hari ini `LayoutUser` merender tombol logout tanpa handler dan tanpa output:

```ts
// library/theme/layout/wrapper/shared/layout-user.component.ts, keadaan sekarang
<button type="button" [attr.aria-label]="logoutLabel()" ...>
  <Icon [name]="logoutIcon()" [size]="18" />
</button>
```

Tombol itu terlihat aktif bagi pengguna tetapi tidak melakukan apa pun. Untuk aplikasi dengan session
nyata, itu adalah kontrol mati. Tambahkan output dan teruskan ke atas:

```ts
// LayoutUser
readonly logout = output<void>();
// template
<button type="button" (click)="logout.emit()" ...>

// LayoutWrapperDefault
readonly logout = output<void>();
// diteruskan dari setiap nav variant yang merender LayoutUser
```

Bentuk `output<void>()` dipilih karena consumer sudah memiliki identitas user; yang dibutuhkan hanya
sinyal bahwa pengguna menekan logout. Alternatifnya, sebuah input callback, akan menyimpang dari gaya
signal dan output yang dipakai package.

Package tidak boleh melakukan navigasi atau memanggil endpoint apa pun. Efek logout sepenuhnya milik
consumer, karena endpoint, cookie, dan target redirect berbeda tiap aplikasi.

### Adapter settings yang dipublikasikan

Showcase app memiliki `src/app/layout-settings-service.ts`, sekitar dua ratus baris yang berisi
logika batasan nyata: nav type yang diizinkan per pasangan layout type dan shell mode, penyelarasan
nav type mode, aturan width `fluid`, dan pembacaan storage yang aman. Logika itu bukan pilihan
aplikasi, melainkan aturan koherensi milik package. Setiap consumer yang mengaktifkan pengalihan
layout akan menulis ulang logika yang sama dan berpotensi menyimpang.

Pindahkan implementasi itu ke package sebagai adapter default yang dapat dipasang consumer:

```ts
// consumer
providers: [provideThemeSettingsAdapter()];
```

Adapter tetap mendelegasikan surface, appearance, dan width ke `LayoutService`, dan tetap memiliki
sendiri layout type, nav type, serta nav type mode, sebab `Layout` menulis balik `type` sesuai
orientasi nav sehingga membaca `layout.type()` akan melenceng. Perilaku yang sudah terbukti di
showcase app dipertahankan apa adanya; yang berubah hanya tempatnya.

Setelah adapter dipublikasikan, showcase app sebaiknya ikut memakainya supaya hanya ada satu
implementasi yang diuji.

## Value sourcing

| Action | Value produced or displayed | Source |
| --- | --- | --- |
| Logout pressed | Sinyal tanpa payload ke consumer | Event klik pada tombol logout `LayoutUser` |
| Logout effect | Panggilan endpoint dan redirect | Sepenuhnya milik consumer, package tidak menentukan |
| Allowed nav types | Daftar nav type yang valid | Pasangan layout type dan shell mode, aturan milik package |
| Allowed nav type modes | Daftar mode yang valid | Nav type aktif, aturan milik package |
| Stored layout choice | Layout type, nav type, nav type mode | Storage key milik package, dibaca dengan fallback aman |
| Width coercion | Width `fluid` atau non `fluid` | Layout type aktif, aturan milik package |

## Invariants and security

1. Package tidak pernah memanggil endpoint aplikasi dan tidak pernah melakukan navigasi atas nama consumer.
2. Adapter hanya menyimpan pilihan tampilan. Tidak ada identitas, token, atau data session yang ditulis ke storage.
3. Storage yang tidak tersedia atau berisi nilai tidak valid jatuh ke default, tanpa melempar error.
4. Kombinasi axis yang tidak koheren dikoreksi otomatis, sehingga shell tidak pernah dirender dalam keadaan tidak mungkin.
5. Perubahan bersifat aditif, sehingga consumer lama tidak rusak.

## Critical test scenarios

1. Menekan logout pada nav type `sidebar` memancarkan output tepat satu kali, memverifikasi **AC-U1** dan **AC-U3**.
2. Menekan logout pada nav type `dockbar` memancarkan output yang sama melalui wrapper, memverifikasi **AC-U2** dan **AC-U3**.
3. Consumer tanpa binding logout tetap merender tanpa error, memverifikasi **AC-U6**.
4. Adapter default menolak nav type yang tidak diizinkan untuk layout type aktif dan mengoreksi ke pilihan pertama yang valid, memverifikasi **AC-U4**.
5. Adapter default memaksa width `fluid` saat layout type `fluid`, dan melepasnya saat bukan, memverifikasi **AC-U4**.
6. Storage yang dilempar error atau berisi nilai asing menghasilkan default tanpa exception, memverifikasi **AC-U5**.
7. Showcase app berjalan tanpa perubahan wajib setelah kedua penambahan, memverifikasi **AC-U6**.

## Rationale

Kedua kemampuan ini dicatat sebagai spec di monobungsia karena keduanya memblokir pekerjaan di
monobungsia, dan kontraknya harus disepakati sebelum salah satu repository bergerak. Implementasinya
tetap milik repository library, yang boleh menuliskan spec sendiri jika diinginkan.

Menyerahkan logout ke consumer, bukan menanganinya di package, mengikuti batas yang sudah dipakai
package di tempat lain: package memiliki bentuk dan perilaku, aplikasi memiliki efek. Endpoint,
penanganan cookie, dan target redirect berbeda antar aplikasi, jadi package tidak boleh menebaknya.

Memindahkan adapter ke package adalah kebalikannya, dan justru karena itu konsisten: aturan
koherensi axis adalah pengetahuan package, bukan pengetahuan aplikasi. Membiarkannya di kode
consumer berarti setiap aplikasi menyalin aturan yang sama dan berisiko menyimpang saat package
menambah nav type baru.

Alternatif yang ditolak adalah menyalin adapter ke monobungsia dan membiarkan logout apa adanya. Itu
menghindari rilis library, tetapi menduplikasi logika nyata dan mengirim kontrol mati ke pengguna.
Karena satu rilis library sudah dibutuhkan untuk logout, adapter ikut dalam rilis yang sama tanpa
tambahan biaya koordinasi.

## Migration plan

**Strategy**: aditif, tanpa breaking change

**Phases**:

1. Tambahkan output logout pada `LayoutUser` dan teruskan melalui setiap nav variant serta `LayoutWrapperDefault`, dengan test untuk `sidebar` dan `dockbar`.
2. Pindahkan implementasi adapter dari showcase app ke package, ekspos fungsi provider, dan pertahankan perilaku batasan yang ada beserta testnya.
3. Ubah showcase app agar memakai adapter yang dipublikasikan, sehingga hanya ada satu implementasi.
4. Rilis ke npm, lalu catat nomor versinya di spec ini dan di spec 0001 monobungsia.

**Rollback**: keduanya aditif, jadi rollback berarti tidak memakai API baru. Tidak ada consumer yang
rusak jika perubahan dibatalkan sebelum monobungsia menaikkan versi.

**Risks**: meneruskan output melalui beberapa nav variant mudah terlewat pada salah satu varian, jadi
test per varian penting. Memindahkan adapter dapat mengubah storage key atau default jika tidak
dipindahkan apa adanya, yang akan mereset preferensi pengguna showcase app.
