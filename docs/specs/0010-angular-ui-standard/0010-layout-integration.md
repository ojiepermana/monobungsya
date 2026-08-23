# 0001. Integrate the Angular package into the web layouts

## Summary

Main app memakai komposisi consumer yang sama dengan showcase app milik package: `Shell` sebagai
root aplikasi tanpa input, `LayoutLoading` di root, satu component penyedia data yang membungkus
`LayoutWrapperDefault`, dan halaman yang dirender melalui `router-outlet` memakai `Page`. Wrapper
package menjadi owner penempatan navigation, drawer mobile, skip link, content landmark, dan focus
on navigation. Session gate dan auth route ikut berada di dalam `Shell` memakai layout brand only,
sehingga frame aplikasi tidak muncul menyusul setelah gate selesai.

## Requirements

1. **AC-L1**: Main app tidak merender area operasi sebelum session gate selesai dan session API menyatakan authenticated.
2. **AC-L2**: Loading session memiliki konten stabil, unauthenticated diarahkan ke `/auth/login`, dan service atau network failure memiliki pesan serta retry action.
3. **AC-L3**: Authenticated app memakai `LayoutWrapperDefault` sebagai satu satunya owner frame, navigation, dan content region. Tidak ada komposisi manual `Layout`, `LayoutVertical`, `LayoutNavigation`, atau `LayoutContent` di application code.
4. **AC-L4**: Gateway health status, service identity, contract, runtime, service cards, wordmark, copy, dan footer tetap tersedia secara semantik.
5. **AC-L5**: Login dan callback mempertahankan seluruh state serta API behavior dari spec 0004, termasuk idle, invalid, submitting, sent, rate limited, service error, callback success, callback error, generic copy, dan cookie isolation.
6. **AC-L6**: Login dan callback memakai `layout-type="fluid"` di dalam `Shell`, sehingga package menyembunyikan navigation dan memusatkan konten. Tidak ada auth shell CSS lokal yang mengatur viewport atau frame.
7. **AC-L7**: Navigation mobile memakai drawer milik `LayoutWrapperDefault` dengan Escape close, outside close, focus containment, focus return ke trigger, dan close setelah leaf selection. Application code tidak merender instance `Navigation` kedua dan tidak memakai media query lokal untuk menyembunyikan navigation.
8. **AC-L8**: Theme settings dapat memilih theme mode, color, neutral, radius, space, shell axes, layout axes, dan navigation type. Pilihan layout dan navigation dilayani oleh satu implementasi `ThemeSettingsAdapter`.
9. **AC-L9**: Semua route, status region, alert region, form label, focus state, dan touch target memenuhi WCAG AA dan AXE.
10. **AC-L10**: Tidak ada endpoint baru atau perubahan pada generated SDK. Aksi logout memakai `POST /api/v1/auth/logout` yang sudah ada.
11. **AC-L11**: `Shell` dirender tanpa input axis, sehingga mode, device, color, dan frame diselesaikan dari storage dan dapat diubah dari settings surface. `Shell` berada di root dan selalu dirender, termasuk saat session gate berjalan.
12. **AC-L12**: `LayoutLoading` berada di root aplikasi sehingga progress bar aktif sejak navigasi pertama.
13. **AC-L13**: Setiap halaman adalah routed component dengan host `block h-full min-h-0` yang memakai `Page` beserta slot `PageHeader`, `PageContent` atau `PageDashboard`, dan `PageFooter`. Tidak ada markup halaman di root template.
14. **AC-L14**: Browser output memiliki satu `main` landmark, satu primary navigation landmark, skip link yang berfungsi, satu content scroll owner, dan tidak memiliki horizontal overflow.
15. **AC-L15**: Identitas brand berasal dari konstanta aplikasi, identitas user berasal dari response session, dan aksi logout dari footer navigation memanggil endpoint logout lalu mengarahkan ke `/auth/login`.
16. **AC-L16**: Route dashboard dimuat lazy, dan initial bundle diukur lalu dibandingkan dengan budget yang tercatat.

## Decision

### Komposisi consumer

Ikuti pola consumer yang dipakai showcase app package. Root aplikasi hanya mengurus shell, progress
bar, session gate, dan identitas. Frame, navigation, dan content region sepenuhnya milik package.

```html
<!-- app.ts, host: { class: 'contents' } -->
<LayoutLoading />

<Shell>
  <span shellBarTitle>{{ appTitle }}</span>
  <app-layout />
</Shell>
```

```html
<!-- layout/layout.ts, host: { class: 'contents' } -->
<LayoutWrapperDefault
  [surface]="settings.surface()"
  [layout-appearance]="settings.appearance()"
  [width]="settings.width()"
  [layout-type]="layoutType()"
  [nav-type]="settings.navType()"
  [nav-type-mode]="settings.navTypeMode()"
  [data]="navigationItems"
  [brand]="brand"
  [user]="user()"
  [focus-on-navigation]="true"
  (logout)="signOut()"
>
  <router-outlet />
</LayoutWrapperDefault>
```

`Shell` dirender tanpa input axis. Package menyelesaikan mode, device, color, dan frame dari storage,
sehingga kontrol shell pada settings surface benar benar bekerja. Menyetel `mode` atau `color`
secara eksplisit membuat kontrol itu mati, jadi input axis tidak dipakai.

`host: { class: 'contents' }` wajib pada root component dan pada component penyedia layout. Tanpa itu
`Layout` di dalam wrapper tidak menjadi flex item langsung dari `Shell`, dan rantai tinggi viewport
patah.

### Session gate dan auth route di dalam Shell

`Shell` selalu dirender. Yang berubah adalah `layout-type` dan konten di dalam wrapper:

| Kondisi | `layout-type` | Konten |
| --- | --- | --- |
| Session `checking` | `fluid` | Panel loading brand only |
| Session `unauthenticated` | `fluid` | Panel redirect brand only, lalu navigasi ke `/auth/login` |
| Session `service-error` | `fluid` | Panel error brand only dengan retry action |
| Route `/auth/*` | `fluid` | Login atau callback dari spec 0004 |
| Authenticated | `vertical` | `router-outlet` dengan navigation penuh |

Package memperlakukan `empty` dan `fluid` sebagai brand only, jadi navigation tidak dirender dan
tidak ada nav type yang berlaku. Inilah shell fluid yang diminta AC-L6, tanpa CSS auth lokal.

State gate tetap `checking`, `authenticated`, `unauthenticated`, dan `service-error` seperti
sebelumnya. Gate tidak menggantikan role authorization backend.

### Halaman sebagai routed component

Setiap halaman adalah component tersendiri yang di lazy load dari route, dengan host
`block h-full min-h-0` supaya `Page` mengisi tinggi content area:

```ts
@Component({
  selector: 'app-dashboard',
  host: { class: 'block h-full min-h-0' },
  imports: [PageComponent, PageHeaderComponent, PageDashboardComponent, PageFooterComponent],
  template: `
    <Page variant="stacked" scroll="content" appearance="border-rail">
      <PageHeader>...</PageHeader>
      <PageDashboard>...</PageDashboard>
      <PageFooter>...</PageFooter>
    </Page>
  `,
})
export class Dashboard {}
```

`PageHeader` memuat wordmark dan environment label. `PageDashboard` memuat hero, gateway status, dan
service cards. `PageFooter` memuat footer note. Domain content tetap milik aplikasi; geometri slot
milik package.

### Layout defaults dan settings adapter

Nilai awal disemai sekali melalui `LayoutService.registerDefaults`:

```ts
inject(LayoutService).registerDefaults({
  surface: 'grid',
  appearance: 'border-rail',
  width: 'full',
  type: 'vertical',
});
```

Navigation default adalah `dockbar` dengan mode `default`. Operator dapat mengganti surface,
appearance, width, layout type, nav type, dan nav type mode dari settings surface. Kontrol itu
dilayani satu implementasi `ThemeSettingsAdapter` yang dipublikasikan package (lihat
[upstream library API](0010-upstream-library-api.md)) dan dipasang melalui `THEME_SETTINGS_ADAPTER`.
Aplikasi tidak menulis ulang logika batasan axis seperti `allowedNavTypes` atau `enforceConstraints`.

Karena `layout-type` juga dipakai gate dan auth route, nilai efektifnya adalah `fluid` saat gate atau
auth aktif, dan nilai pilihan operator saat authenticated.

### Identitas dan logout

```ts
const APP_BRAND: BrandIdentity = {
  name: 'Monobungsia',
  icon: null,
  title: 'monobungsia',
  subtitle: 'enterprise workspace',
};
```

`icon: null` membuat package memakai inisial dari `name`, sehingga tanda `M` yang sekarang tetap
dipakai. Identitas user diambil dari response session:
`{ name: user.name, email: user.email }`. Keduanya sudah tersedia pada `sessionResponse`.

Footer navigation package menampilkan nama, email, tombol logout, dan trigger theme settings. Karena
itu trigger theme settings di header aplikasi dihapus supaya tidak ada dua pintu masuk. Tombol logout
memanggil `POST /api/v1/auth/logout` lalu mengarahkan ke `/auth/login`.

## State transitions

```text
Session gate: checking -> authenticated
Session gate: checking -> unauthenticated -> /auth/login
Session gate: checking -> service-error -> checking on retry
Layout type: fluid (gate, auth) -> vertical (authenticated)
Theme: system | light | dark -> another valid mode
Shell axes: mode | color | frame | device -> another valid value
Layout axes: surface | appearance | width | layout type -> another valid value
Navigation: nav type and nav type mode -> another allowed pair
Navigation overlay: closed -> open -> closed by Escape, outside click, close action, or leaf selection
Login: idle -> submitting -> sent | rate-limited | service-error
Callback: loading -> complete | error
Logout: authenticated -> logout request -> /auth/login
```

## API surface

No new API surface is introduced.

| Endpoint | Method | Use | Auth | Key errors |
| --- | --- | --- | --- | --- |
| `/api/v1/auth/session` | GET | Session gate dan identitas user | Optional browser cookie | `200` unauthenticated, `503` service failure |
| `/api/v1/auth/magic-link` | POST | Login form state machine | Public | `422`, `429`, `503` |
| `/api/v1/auth/verify` | GET | Email link redirect | Public | Generic redirect ke callback error |
| `/api/v1/auth/logout` | POST | Aksi logout dari footer navigation | Browser cookie | Idempotent success atau `503` |
| `/api/v1/health` | GET | Gateway status panel | Public | Network failure atau non ok response |

## Value sourcing

| Action | Value produced or displayed | Source |
| --- | --- | --- |
| Session loading | Label dan region loading yang stabil | Fixed accessible UI copy |
| Session success | State authenticated dan identitas user | Response `sessionResponse.user` dan cookie yang dikelola API |
| Session redirect | Route `/auth/login` | Fixed router target |
| Session service error | Pesan generic dan retry action | Fixed UI copy dan kategori kegagalan request SDK |
| Shell axes | Mode, device, color, frame | Storage milik package melalui `ShellService`, bukan input aplikasi |
| Layout axes | Surface, appearance, width | `LayoutService`, disemai `registerDefaults`, diubah operator |
| Layout type efektif | `fluid` atau `vertical` | Derived dari session state dan route, di atas pilihan operator |
| Navigation type | Nav type dan nav type mode | `ThemeSettingsAdapter` package, disimpan di storage |
| Main navigation | Titles, icons, routes, active state | Local readonly `NavigationItem[]` dan Angular Router |
| Brand identity | Name, icon, title, subtitle | Konstanta aplikasi `APP_BRAND` |
| User identity | Name dan email di footer navigation | `sessionResponse.user.name` dan `sessionResponse.user.email` |
| Logout result | Navigasi ke `/auth/login` | Response `POST /api/v1/auth/logout`, lalu fixed router target |
| Theme settings | Mode, color, neutral, radius, space | Package theme service dan settings component |
| Page sections | Header, dashboard, footer, scroll mode | Slot `Page` package dan domain content lokal |
| Gateway status | Checking, online, offline, service name | Response health dan signal aplikasi |
| Service cards | Satu card per service yang benar benar ada | Local static content, saat ini Auth dan Users |
| Login state | Validasi email dan state request | Signal form auth dan response generated SDK |
| Callback state | Complete atau error | Route dan response session |

## Invariants and security

1. Konten operasi tidak pernah dirender untuk session yang tidak authenticated.
2. Kegagalan service session tidak memberi akses dan tidak menampilkan raw response.
3. Role based access tetap tanggung jawab backend dari spec 0003.
4. Auth route tidak merender navigation atau settings surface milik authenticated app.
5. Browser tidak pernah menyimpan magic link token, nilai session cookie, token hash, health response, atau identitas user.
6. Email user hanya ditampilkan pada footer navigation dalam session yang authenticated, tidak disimpan ke storage.
7. Overlay navigation tetap dapat dioperasikan keyboard dan mengembalikan focus ke trigger.
8. Settings surface tidak memerlukan endpoint baru dan tidak menyimpan data profil.
9. Pesan generic login tidak mengungkap keberadaan akun.
10. Tidak ada request font eksternal untuk shell maupun ikon auth.
11. `LayoutWrapperDefault` adalah satu satunya owner content scroll, dan `Page` tidak menambah scroll container kedua selebar halaman.
12. Logout bersifat idempotent dan tetap mengarahkan ke `/auth/login` walaupun response gagal.

## Critical test scenarios

1. Kunjungan pertama dengan session authenticated merender shell, lalu dashboard, memverifikasi **AC-L1**, **AC-L3**, dan **AC-L4**.
2. Kunjungan dengan session unauthenticated mengarahkan ke login tanpa merender konten operasi, memverifikasi **AC-L1** dan **AC-L2**.
3. Session endpoint service error merender retry dan tidak pernah merender data operasi, memverifikasi **AC-L2**.
4. Desktop merender navigation package, settings surface, gateway status, dan seluruh service cards, memverifikasi **AC-L3** dan **AC-L4**.
5. Navigation mobile terbuka, menahan focus, tertutup oleh Escape atau klik luar, dan mengembalikan focus, memverifikasi **AC-L7** dan **AC-L9**.
6. Login dan callback mempertahankan seluruh perilaku sukses, error, rate limit, dan pesan generic dari spec 0004, memverifikasi **AC-L5**.
7. Login pada lebar desktop dan mobile memakai layout fluid tanpa overflow, memverifikasi **AC-L6**.
8. Settings surface mengganti theme mode, shell axes, layout axes, dan nav type, dan setiap pilihan tetap koheren, memverifikasi **AC-L8** dan **AC-L11**.
9. AXE scan lolos untuk dashboard dan seluruh auth route, memverifikasi **AC-L9**.
10. Inspeksi network dan SDK menunjukkan tidak ada request backend atau kontrak baru, memverifikasi **AC-L10**.
11. DOM authenticated memuat host `Shell`, wrapper layout, dan `Page` dengan atribut package yang diharapkan, dan tidak memuat komposisi manual, memverifikasi **AC-L3** dan **AC-L13**.
12. Audit landmark menemukan satu `main`, satu primary navigation, skip link yang berfungsi, satu scroll owner, dan tidak ada horizontal overflow, memverifikasi **AC-L14**.
13. Footer navigation menampilkan nama dan email dari session, dan logout memanggil endpoint lalu mengarahkan ke login, memverifikasi **AC-L15**.
14. Build produksi menunjukkan route dashboard sebagai lazy chunk dan initial bundle terukur terhadap budget tercatat, memverifikasi **AC-L16**.

## Rationale

Package sudah menyediakan komposisi consumer yang lengkap melalui `LayoutWrapperDefault`. Menyusun
`Layout`, `LayoutVertical`, `LayoutNavigation`, dan `LayoutContent` sendiri berarti aplikasi ikut
memiliki penempatan navigation, drawer mobile, skip link, dan landmark, yang persis bagian tersulit
dan paling mudah salah. Versi manual sebelumnya membuktikan itu: ia butuh dua instance `Navigation`
dan media query lokal hanya untuk perilaku mobile yang sudah dimiliki wrapper.

Keputusan sebelumnya menolak wrapper dengan alasan session hanya menyediakan role dan tidak
menyediakan field identitas kedua seperti email. Alasan itu tidak benar. `sessionResponse` memuat
`user: { id, email, name, role }`, dan gateway sudah membaca `user.email`. Jadi `UserIdentity` dapat
diisi data nyata tanpa mengarang nilai apa pun.

`Shell` tanpa input dipilih supaya kontrol shell pada settings surface hidup. Menyetel `mode="web"`
membuat kontrol mode, color, frame, dan device menjadi mati bagi pengguna. Biayanya adalah empat key
`shell-*` di localStorage, yang dimiliki package dan tidak memuat data pengguna, sehingga batasan
storage cukup dilonggarkan pada daftar key yang diizinkan.

Menempatkan `Shell` di root secara tak bersyarat menghapus kedipan frame setelah gate selesai, dan
sekaligus memberi auth route shell fluid yang memang diminta, karena package memperlakukan `fluid`
sebagai brand only. Satu mekanisme melayani dua kebutuhan, dan CSS auth lokal bisa dihapus.

## Migration plan

**Strategy**: strangler, dengan satu prasyarat upstream

**Phases**:

1. Rilis perubahan package pada [upstream library API](0010-upstream-library-api.md): output logout dan adapter settings yang dipublikasikan. Tanpa ini logout tidak dapat diikat dan adapter harus diduplikasi.
2. Naikkan versi package di monobungsia, pasang `THEME_SETTINGS_ADAPTER`, dan tambahkan `LayoutLoading` serta `Shell` tanpa input di root, dengan komposisi lama masih aktif di belakang gate.
3. Tambahkan component penyedia layout yang membungkus `LayoutWrapperDefault`, pindahkan `router-outlet` ke dalamnya, dan hapus komposisi manual `Layout`, `LayoutVertical`, `LayoutNavigation`, `LayoutContent` beserta instance `Navigation` kedua.
4. Pindahkan dashboard ke routed component yang di lazy load memakai `Page`, lalu hapus markup halaman dari root template.
5. Pindahkan auth route ke `layout-type="fluid"` di dalam `Shell`, lalu hapus auth shell CSS lokal setelah state spec 0004 terbukti utuh.
6. Ikat logout, hapus trigger theme settings di header, ukur bundle, lalu catat angkanya dan setel budget sesuai spec 0001.

**Rollback**: setiap fase adalah satu commit yang dapat dibalik. Fase 3 sampai 5 dapat dibalik ke
komposisi manual tanpa perubahan backend atau generated SDK. Prasyarat upstream bersifat aditif, jadi
menurunkan versi package tidak diperlukan.

**Risks**: nav type default berubah dari sidebar berlabel menjadi dockbar ikon, sehingga tampilan
berubah nyata. `layout-type` kini punya dua sumber, session state dan pilihan operator, jadi urutan
prioritasnya harus jelas. Bundle bisa bertambah karena wrapper memuat seluruh varian navigation.
Menghapus auth shell CSS terlalu awal berisiko mengubah state login yang sudah terbukti.
