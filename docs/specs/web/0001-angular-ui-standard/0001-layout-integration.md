# 0001. Integrate the Angular package into the web layouts

## Summary

Main app menjadi shell operations console yang memakai navigation package, settings surface, dan session gate. Login dan callback tetap menjadi route khusus tanpa navigation, tetapi login memakai shell fluid yang memenuhi viewport dan tetap mempertahankan semua state auth dari spec 0004.

## Requirements

1. **AC-L1**: Main app tidak merender area operasi sebelum session gate selesai dan session API menyatakan authenticated.
2. **AC-L2**: Loading session memiliki konten stabil, unauthenticated diarahkan ke `/auth/login`, dan service atau network failure memiliki pesan serta retry action.
3. **AC-L3**: Main app memakai navigation container package dan settings component package setelah authentication. Desktop dan mobile memakai renderer package yang sesuai.
4. **AC-L4**: Gateway health status, service identity, contract, runtime, service cards, wordmark, copy, dan footer tetap tersedia secara semantik.
5. **AC-L5**: Login dan callback tidak memuat main navigation atau settings surface dan mempertahankan state serta API behavior dari spec 0004.
6. **AC-L6**: Login memiliki fluid shell, dua kolom pada layar besar, satu kolom pada layar kecil, dan tidak memiliki horizontal overflow.
7. **AC-L7**: Mobile navigation memakai flyout atau drawer package dengan Escape close, outside close, focus containment, focus return, and close after leaf selection.
8. **AC-L8**: Theme settings dapat memilih light, dark, dan system dari settings surface pada main app.
9. **AC-L9**: Semua route, status region, alert region, form label, focus state, dan touch target memenuhi WCAG AA dan AXE.
10. **AC-L10**: Tidak ada endpoint baru atau perubahan pada generated SDK.

## Decision

### Session gate

`App` memakai session operation yang sudah tersedia melalui generated SDK sebelum menampilkan main app. State gate adalah:

1. `checking`, menampilkan loading shell yang stabil dan tidak menampilkan data operasi.
2. `authenticated`, menampilkan main app dan menyediakan session identity hanya melalui state in memory yang dibutuhkan oleh UI.
3. `unauthenticated`, mengarahkan ke `/auth/login` tanpa menampilkan data main app.
4. `service-error`, menampilkan pesan generic yang dapat diulang. Error network, `503`, dan kegagalan response tidak diarahkan otomatis ke login.

Session gate tidak menggantikan role authorization backend. Main app boleh membaca role dari response session bila diperlukan untuk tampilan, tetapi akses protected route tetap ditentukan oleh gateway dan service.

### Main app shell

Gunakan navigation container package dengan `id="main"` supaya state navigation package memiliki satu owner. Desktop memakai navbar atau sidebar renderer sesuai komposisi package. Mobile memakai flyout atau drawer renderer dengan item data yang sama dan `data-id` yang sama bila package memerlukan mirror state.

Navigation data hanya berisi route atau action yang benar benar tersedia. Jangan menambahkan route untuk service yang belum memiliki halaman. Gateway status dan service cards tetap menjadi content domain lokal di dalam page shell package. Settings surface package berada pada main app dan menjadi lokasi pemilihan mode theme.

Main app mempertahankan:

1. Wordmark `monobungsia`.
2. Label `enterprise workspace` pada viewport yang cukup lebar.
3. Hero operations console dan copy yang sudah ada.
4. Gateway connection status dengan state checking, online, dan offline.
5. Service, contract, dan runtime values dari state current app.
6. Lima service boundary cards dan footer note.

Pada layar kecil, section ditumpuk, service grid menjadi satu kolom, label sekunder boleh disembunyikan bila sudah ditetapkan oleh layout saat ini, dan tidak ada scroll horizontal. Package breakpoint dan utility menjadi sumber breakpoint, bukan angka CSS baru yang tersebar.

### Login and callback shell

Auth route tetap memakai component dedicated dari spec 0004. Auth shell menggunakan layout fluid:

1. Tinggi minimum memenuhi viewport.
2. Gutter mengikuti lebar viewport dengan batas baca pada form.
3. Dua kolom pada layar besar.
4. Satu kolom pada layar kecil.
5. Panel context atau dekorasi disembunyikan pada layar kecil.
6. Tidak ada main navigation, settings drawer, atau session protected content.

State idle, invalid email, submitting, generic sent, rate limited, service error, callback loading, callback complete, dan callback error tetap sama. Generic message tidak boleh menambahkan account existence detail. Browser tidak membaca atau menyimpan magic link token dan session cookie.

## State transitions

```text
Session gate: checking -> authenticated
Session gate: checking -> unauthenticated -> /auth/login
Session gate: checking -> service-error -> checking on retry
Theme: system | light | dark -> another valid mode
Navigation overlay: closed -> open -> closed by Escape, outside click, close action, or leaf selection
Login: idle -> submitting -> sent | rate-limited | service-error
Callback: loading -> complete | error
```

## API surface

No new API surface is introduced.

| Endpoint | Method | Use | Auth | Key errors |
| --- | --- | --- | --- | --- |
| `/api/v1/auth/session` | GET | Session gate and callback success state | Optional browser cookie | `200` unauthenticated, `503` service failure |
| `/api/v1/auth/magic-link` | POST | Existing login form state machine | Public | `422`, `429`, `503` |
| `/api/v1/auth/verify` | GET | Existing email link redirect | Public | Generic redirect to callback error |
| `/api/v1/auth/logout` | POST | Existing logout action if surfaced by shell | Browser cookie | Idempotent success or `503` |
| `/api/v1/health` | GET | Existing gateway status panel | Public | Network failure or non ok response |

## Value sourcing

| Action | Value produced or displayed | Source |
| --- | --- | --- |
| Session loading | Stable loading label and region | Fixed accessible UI copy |
| Session success | Authenticated state and optional user identity | Existing session endpoint response and browser cookie managed by the API |
| Session redirect | `/auth/login` route | Fixed router target |
| Session service error | Generic error and retry action | Fixed UI copy and SDK request failure category |
| Main navigation | Titles, icons, routes, active state | Local readonly `NavigationItem[]` and Angular Router |
| Theme settings | `light`, `dark`, `system` choice | Package settings component and theme service |
| Gateway status | Checking, online, offline, service name | Existing health response and `App` signals |
| Service cards | Auth, Users, Employees, Payroll, Reports and status copy | Existing local static content |
| Login state | Email validation and request state | Existing auth form signals and generated SDK response |
| Callback state | Complete or error result | Existing route and session response |

## Invariants and security

1. Main app content is never rendered for an unauthenticated session.
2. A session service failure does not silently grant access and does not expose raw response data.
3. Role based access remains a backend responsibility from spec 0003.
4. Auth routes do not import or render the main navigation shell.
5. The browser never writes magic link token, session cookie value, token hash, email, health response, or user identity to local storage.
6. Navigation overlays remain keyboard operable and return focus to their trigger after close.
7. Settings drawer does not require a new endpoint and does not persist profile data.
8. Login generic messaging does not reveal account existence.
9. No external font request is needed for the shell or auth icons.

## Critical test scenarios

1. Initial visit with authenticated session renders loading, then main app, verifies **AC-L1**, **AC-L3**, and **AC-L4**.
2. Initial visit with unauthenticated session redirects to login without rendering operation content, verifies **AC-L1** and **AC-L2**.
3. Session endpoint service error renders retry and never renders operation data, verifies **AC-L2**.
4. Desktop main app renders package navigation, settings surface, gateway status, and all service cards, verifies **AC-L3** and **AC-L4**.
5. Mobile navigation opens, traps focus, closes on Escape or outside click, and restores focus, verifies **AC-L7** and **AC-L9**.
6. Login and callback tests retain every success, error, rate limit, and generic messaging behavior from spec 0004, verifies **AC-L5**.
7. Login at desktop and mobile widths keeps the fluid shell usable with no overflow, verifies **AC-L6**.
8. Theme settings switch modes and retain the package owned preference without adding user data to browser storage, verifies **AC-L8** and **AC-L9**.
9. Browser AXE scan passes for main app and auth routes, verifies **AC-L9**.
10. Network and SDK inspection shows no new backend request or contract, verifies **AC-L10**.

## Rationale

Using the package navigation and settings surfaces for the main app gives the repository one responsive shell and one place for theme controls. Keeping auth routes outside that shell protects the dedicated callback behavior and keeps unauthenticated screens smaller. The client session gate closes the current gap where the root shell can render before the browser knows whether the session is valid, while leaving server authorization unchanged.
