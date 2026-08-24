# 0009. Add TOTP two factor authentication

**Date**: 2026-08-23
**Status**: Accepted

## Summary

Setiap user bisa (dan bisa diwajibkan admin) menambahkan faktor kedua berupa kode 6 digit dari aplikasi authenticator (TOTP, kode berbasis waktu standar RFC 6238). Setelah magic link atau passkey berhasil, user dengan 2FA aktif harus memasukkan kode sebelum session dibuat. Secret disimpan terenkripsi AES-256-GCM, recovery codes sekali pakai menjadi jalur pemulihan mandiri, dan admin dapat mereset atau mewajibkan 2FA dari halaman user management. Pola tabel challenge, rate limit, cookie, dan cleanup worker yang sudah ada dipakai ulang seluruhnya.

## Requirements

**User stories**:

- As a user, I want to protect my account with a 6 digit code from an authenticator app so that a stolen first factor alone can never create a session.
- As a user who lost my authenticator device, I want single use recovery codes so that I can still sign in and re enroll without waiting for an admin.
- As an admin, I want to require 2FA for specific users, see their 2FA status, and reset a locked out user so that the organization stays secure without permanent lockouts.
- As a desktop (Tauri) user, I want magic link plus code entry to keep working so that the desktop shell is never blocked.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: A user with confirmed TOTP who completes a first factor (magic link verify or passkey assertion) receives no session. Instead the server issues a single use MFA challenge (random token, stored hashed, 5 minute TTL, delivered as an HttpOnly cookie with the same flag policy as the session cookie) and the web app shows the code entry page. Submitting a valid 6 digit code (30 second step, tolerance of one step either way) consumes the challenge and creates a session identical in shape and lifetime to a normal session.
- **AC-2**: An authenticated user without confirmed TOTP can enroll. The server generates a secret, stores it encrypted with AES-256-GCM under `TOTP_ENCRYPTION_KEY`, marks it unconfirmed, and returns the base32 secret plus the `otpauth://` URI exactly once. The Angular client renders the QR locally and shows the base32 for manual entry. Confirming with a valid code activates 2FA and returns exactly one display of 10 single use recovery codes, stored only as SHA-256 hashes.
- **AC-3**: An unconfirmed enrollment grants nothing: the login flow ignores unconfirmed credentials, re enrolling overwrites an unconfirmed secret, and the cleanup worker deletes unconfirmed enrollments older than 24 hours.
- **AC-4**: A valid unused recovery code passes the MFA challenge as an alternative to a TOTP code, is marked used atomically, and the user can see the remaining count and regenerate a fresh set.
- **AC-5**: Replay and brute force are blocked. A code for a time step at or before `last_used_step` is rejected even when otherwise valid. A challenge allows at most 5 code attempts and is then invalidated. Public 2FA verification endpoints are rate limited through `auth.auth_rate_limits` (10 attempts per 15 minutes per hashed source IP, atomically). Errors on public endpoints stay generic and reveal nothing about account state.
- **AC-6**: A user can disable their own 2FA only by proving a valid current TOTP code or an unused recovery code. Disable deletes the credential and all recovery codes and writes an audit entry. A plain click without proof never disables 2FA.
- **AC-7**: A user can regenerate recovery codes by proving a valid TOTP code. The old set is invalidated atomically and the new set is shown exactly once.
- **AC-8**: A user whose `totp_required_at` is set on `"user"."users"` but who has no confirmed credential is forced into enrollment after a successful first factor: the server issues an enroll purpose challenge that authorizes only the enroll and confirm endpoints, and no session exists until confirmation plus code verification completes.
- **AC-9**: An admin holding the existing user management permission can view a user's 2FA status (enabled, confirmed date, required flag, recovery codes remaining), reset 2FA with a mandatory reason (deletes credential and codes, revokes all of that user's sessions, writes an audit entry), and set or unset the requirement with a mandatory reason plus audit entry. The admin never sees secrets, codes, or URIs.
- **AC-10**: The web user detail page gains a 2FA panel with status and the admin actions; self service management lives on the settings security surface beside passkeys. Both follow the existing page composition patterns of the repo.
- **AC-11**: MFA challenges are single use and expire 5 minutes after issue. An expired, used, unknown, exhausted, or tampered challenge never creates a session or authorizes enrollment. Two concurrent verifications of the same challenge create at most one session. The cleanup worker removes expired and used challenges.
- **AC-12**: The Tauri desktop magic link flow works unchanged with the added code entry step (it ships the same Angular pages), passkey stays absent on desktop, and users without 2FA see zero change to any login flow.
- **AC-13**: Secrets never leak: TOTP secrets exist in the database only encrypted, recovery codes only hashed, and no secret, code, URI, or challenge token ever appears in application, access, or audit logs. Audit entries are written for enable, disable, admin reset, require, unrequire, and each recovery code consumption.
- **AC-14**: OpenAPI specs and the Angular SDK are regenerated and committed, the new env vars are documented in `.env.example`, and the auth service still starts with `ENABLE_INFRASTRUCTURE=false`.

## Decision

**Chosen option**: Option 1: TOTP step with a separate challenge table

Tambahkan TOTP sebagai langkah kedua login yang berdiri di antara faktor pertama dan pembuatan session, dengan tabel `auth.mfa_challenges` bergaya `webauthn_challenges`, library `otpauth`, enkripsi secret AES-256-GCM memakai key env terpisah, QR dirender di client Angular, recovery codes plus reset admin sebagai jalur pemulihan, dan penegakan opsional per user yang bisa diwajibkan admin.

**Implementation skills**: `elysiajs` (user level skill, Elysia route and schema conventions) · `angular-developer` (user level skill, Angular signals, forms, and component conventions). Baca juga demo app `@ojiepermana/angular` sebelum menyusun halaman baru, sesuai kebiasaan repo ini.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (schema `auth`, semua PK `uuid` default `uuidv7()`, migration di `packages/database/migrations/auth`):

| Tabel / perubahan | Kolom | Catatan |
|---|---|---|
| `auth.totp_credentials` (baru) | `id` PK · `user_id` FK UNIQUE · `secret_encrypted text NOT NULL` · `confirmed_at timestamptz NULL` · `last_used_step bigint NULL` · `created_at` · `updated_at` | Satu credential per user. `confirmed_at` kosong berarti enrollment belum selesai. `last_used_step` menolak pemakaian ulang kode pada step yang sama atau lebih lama. |
| `auth.totp_recovery_codes` (baru) | `id` PK · `user_id` FK · `code_hash text NOT NULL` · `used_at timestamptz NULL` · `created_at` · UNIQUE (`user_id`, `code_hash`) · index (`user_id`) | 10 baris per set. Regenerate menghapus set lama dalam satu transaksi. |
| `auth.mfa_challenges` (baru) | `id` PK · `user_id` FK · `purpose text NOT NULL` (`login` atau `enroll`) · `token_hash text NOT NULL UNIQUE` · `attempts int NOT NULL DEFAULT 0` · `expires_at timestamptz NOT NULL` · `used_at timestamptz NULL` · `created_at` · index (`expires_at`) | Meniru pola `webauthn_challenges`. Kolom `purpose` ditambahkan setelah konfirmasi data model untuk membedakan challenge login dari challenge paksa enroll (AC-8); perubahan kecil ini ditandai untuk ditinjau saat konfirmasi spec. |
| `"user"."users"` (existing, schema `user`) | tambah `totp_required_at timestamptz NULL` | Terisi berarti user wajib 2FA. Ditulis hanya oleh user service (endpoint kewajiban milik user service, alasan ke audit trail), mengikuti preseden kolom status suspend, block, dan delete dari spec 0007. Migration nya di `packages/database/migrations/user`. Auth service membacanya pada query login, sama seperti `suspended_at`. |

Catatan schema: tabel users repo ini adalah `"user"."users"` (schema `user`); tidak ada tabel `auth.users`. Semua FK `user_id` di atas menunjuk `"user"."users"(id)` dengan `ON DELETE CASCADE`, mengikuti pola `passkey_credentials` dan `sessions` yang sudah ada. Auth service hanya membaca tabel users; satu satunya tulisan fitur ini di schema `user` adalah `totp_required_at`, dan itu dilakukan user service di schema miliknya sendiri.

**State transitions**:

- Credential: `none` → `enrolling` (secret tersimpan, `confirmed_at` NULL) → `active` (`confirmed_at` terisi) → `none` lagi lewat disable mandiri atau reset admin (baris dihapus).
- Challenge: `issued` → `verified` (`used_at` terisi) · atau `expired` · atau `exhausted` (attempts mencapai 5). Semua jalur akhir dibersihkan worker.

**Login flow changes** (satu titik keputusan, dua pintu masuk):

1. `consumeMagicToken` dan jalur passkey `authenticate` tidak lagi langsung memanggil `insertSession` bila user punya credential terkonfirmasi atau `totp_required_at` nya terisi di `"user"."users"`. Sebagai gantinya keduanya membuat baris `mfa_challenges` (`purpose` `login`, atau `enroll` bila wajib tapi belum enroll) dan mengembalikan token mentah.
2. Alur magic link (GET redirect): server memasang cookie HttpOnly `mfa_challenge` lalu redirect ke `WEB_APP_URL/auth/two-factor` (atau `/auth/two-factor/enroll` untuk paksa enroll). Alur passkey (JSON): response berisi `mfaRequired: true` plus cookie yang sama, tanpa session.
3. Halaman two factor mengirim kode ke endpoint verify; server memvalidasi challenge dari cookie, memverifikasi kode TOTP atau recovery code, menandai challenge terpakai, lalu memanggil `insertSession` yang sudah ada dan memasang cookie session normal.

**API surface** (public lewat gateway `/api/v1/auth/...`, kecuali disebut lain):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/auth/2fa/enroll` | POST | (kosong) | `secret` base32, `otpauthUri` | session, atau challenge `enroll` valid | 401, 409 sudah aktif |
| `/auth/2fa/enroll/confirm` | POST | `code` | `recoveryCodes[10]`; pada alur paksa enroll juga cookie session | session, atau challenge `enroll` valid | 400 kode salah, 401 |
| `/auth/2fa/verify` | POST | `code` atau `recoveryCode` | cookie session, `redirectTo` | cookie `mfa_challenge` valid | 400, 401 generik, 429 |
| `/auth/2fa/status` | GET | (kosong) | `enabled`, `confirmedAt`, `required`, `recoveryCodesRemaining` | session | 401 |
| `/auth/2fa/disable` | POST | `code` atau `recoveryCode` | `ok` | session | 400, 401 |
| `/auth/2fa/recovery-codes` | POST | `code` | `recoveryCodes[10]` baru | session | 400, 401 |
| `/auth/admin/users/:id/2fa` | GET | `:id` | status seperti di atas | permission kelola user | 401, 403, 404 |
| `/auth/admin/users/:id/2fa/reset` | POST | `reason` wajib | `ok` | permission kelola user | 401, 403, 404, 422 |
| `/users/:id/2fa-requirement` (user service) | PUT | `required` boolean, `reason` wajib | `ok` | permission kelola user | 401, 403, 404, 422 |

Kepemilikan endpoint: semua rute `/auth/...` milik auth service; rute kewajiban 2FA milik user service karena dialah pemilik tulis `"user"."users"`, mengikuti pola aksi suspend dan block. Panel admin di web memanggil keduanya lewat gateway.

**Value sourcing** (setiap nilai yang diproduksi menamai sumbernya):

| Action | Value produced / displayed | Source |
|---|---|---|
| Enroll | secret base32 | dibuat server, 20 byte acak lewat `otpauth`, disimpan terenkripsi (`TOTP_ENCRYPTION_KEY`) |
| Enroll | `otpauth://` URI | derivasi dari secret + issuer dari env `TOTP_ISSUER` + label akun dari kolom `email` di `"user"."users"` |
| Enroll | gambar QR | dirender client Angular (`angularx-qrcode`) dari URI, server tidak membuat gambar |
| Verify | kode yang diharapkan | derivasi dari `secret_encrypted` yang didekripsi, waktu unix sekarang, step 30 detik, toleransi ±1 step |
| Verify | penjaga replay | kolom `totp_credentials.last_used_step`, diperbarui setiap verifikasi sukses |
| Challenge | token mentah | `createSecret()` yang sudah ada; hash SHA-256 ke `mfa_challenges.token_hash`; mentah hanya di cookie HttpOnly |
| Challenge | masa berlaku | `mfa_challenges.expires_at` = waktu terbit + 5 menit |
| Verify sukses | session | `insertSession()` yang sudah ada di `auth.repository.ts`, tanpa perubahan bentuk |
| Verify sukses | tujuan redirect | `WEB_APP_URL` dari env yang sudah ada, halaman web menentukan rute lanjutan |
| Recovery | kode mentah | dibuat saat confirm atau regenerate, 10 kode, tampil sekali; hash SHA-256 yang disimpan |
| Status | sisa recovery codes | COUNT baris `totp_recovery_codes` dengan `used_at` NULL |
| Keputusan login | apakah user kena 2FA | `totp_credentials.confirmed_at` terisi (LEFT JOIN dari query login) ATAU `"user"."users".totp_required_at` terisi (tabel users sudah terbaca di query login yang ada) |
| Status | flag `required` | kolom `"user"."users".totp_required_at`, dibaca auth service |
| Wajib atau cabut kewajiban | perubahan flag | endpoint user service menulis `totp_required_at` di schema nya sendiri; alasan dari body `reason` ke audit trail |
| Rate limit | kunci pembatasan | `incrementRateLimit()` yang sudah ada, key type baru `totp_ip` (IP di hash) dan `totp_user` |
| Aksi admin | aktor dan alasan | header identity bertanda tangan (`x-auth-*`) untuk aktor, body `reason` untuk alasan |

**Key invariants**:

- Secret TOTP hanya pernah tersimpan terenkripsi dan hanya dikembalikan pada satu response enroll.
- Tidak ada session sebelum kode terverifikasi bila 2FA aktif atau diwajibkan.
- Satu credential per user, ditegakkan constraint UNIQUE di database.
- Challenge sekali pakai, TTL 5 menit, maksimum 5 percobaan, konsumsi atomik (dua verifikasi bersamaan menghasilkan paling banyak satu session).
- Kode pada time step lebih kecil atau sama dengan `last_used_step` selalu ditolak.
- Reset admin dan regenerate recovery codes berjalan dalam transaksi (`withTransaction`); reset admin mencabut semua session user itu.
- Error endpoint publik generik, tidak membocorkan keberadaan akun atau status 2FA.

**Security model**:

- Endpoint self service butuh session valid; endpoint alur login butuh challenge cookie valid dengan `purpose` yang cocok; endpoint admin dijaga permission kelola user yang sudah ada di katalog access (tanpa entri katalog baru), diperiksa gateway dan diverifikasi ulang service lewat header identity bertanda tangan.
- `TOTP_ENCRYPTION_KEY` terpisah dari `INTERNAL_AUTH_SIGNING_SECRET`, tidak ada pemakaian ulang key.
- Semua mutasi bernilai audit memakai `ActivityLog.writeAudit` dan ditunggu di dalam operasi bisnisnya, sesuai mandat logging repo. Redaksi log mencakup secret, kode, URI, dan token challenge.
- Magic link tidak pernah menjadi jalur reset 2FA; pemulihan hanya lewat recovery code atau reset admin.

**Configuration required**:

- `TOTP_ENCRYPTION_KEY`: key AES-256-GCM 32 byte (base64) untuk enkripsi secret; wajib saat `ENABLE_INFRASTRUCTURE=true`.
- `TOTP_ISSUER`: nama issuer yang tampil di aplikasi authenticator; default `Monobungsia`.

**Critical test scenarios** (each maps to an acceptance criterion):

- Happy path: enroll, confirm, logout, magic link, halaman kode, kode valid membuat session normal, verifies **AC-1**, **AC-2**.
- Replay: kode yang sama pada step yang sama ditolak pada percobaan kedua, verifies **AC-5**.
- Brute force: percobaan keenam pada satu challenge menolak dan menghanguskan challenge; rate limit IP menolak setelah 10 percobaan per 15 menit, verifies **AC-5**.
- Kedaluwarsa dan konkuren: challenge kedaluwarsa ditolak; dua verify bersamaan atas satu challenge menghasilkan paling banyak satu session, verifies **AC-11**.
- Recovery: recovery code valid membuat session dan tidak bisa dipakai dua kali; regenerate menghanguskan set lama, verifies **AC-4**, **AC-7**.
- Paksa enroll: user wajib tanpa credential tidak mendapat session sampai enroll plus verifikasi selesai, verifies **AC-8**.
- Authorization: admin tanpa permission kelola user mendapat 403 pada semua endpoint admin; disable tanpa bukti kode ditolak, verifies **AC-6**, **AC-9**.
- Redaksi: log hasil enroll, verify, dan reset tidak memuat secret, kode, atau token, verifies **AC-13**.

## Build plan

Urutan Tracer Bullet: benang tipis menembus semua lapisan dulu, lalu menebal.

1. Migration auth berikutnya di `packages/database/migrations/auth` untuk ketiga tabel baru schema `auth` (credentials, recovery codes, challenges; semua FK ke `"user"."users"(id)`) plus grants mengikuti pola migration auth sebelumnya, dan migration user untuk kolom `totp_required_at` pada `"user"."users"` mengikuti pola kolom status 0011; env `TOTP_ENCRYPTION_KEY` dan `TOTP_ISSUER` di `config/env.ts` dan `.env.example`; helper enkripsi AES-256-GCM di auth service; dependency `otpauth` dan `angularx-qrcode` di root, satisfies **AC-2**, **AC-13**, **AC-14**.
2. Benang enroll ujung ke ujung: modul 2FA di auth service (route, schema, service, repository) untuk `enroll` dan `enroll/confirm` dengan pembuatan secret, URI, dan recovery codes; rute gateway; bagian minimal di halaman settings security (render QR, konfirmasi kode, tampil recovery codes sekali), satisfies **AC-2**, **AC-3**, **AC-10**.
3. Benang challenge login: cegat pembuatan session di jalur magic link dan passkey, terbitkan challenge `login` plus cookie, halaman `/auth/two-factor`, endpoint `verify` dengan verifikasi TOTP, penjaga replay `last_used_step`, batas 5 percobaan per challenge, konsumsi atomik, jalur recovery code, lalu `insertSession`, satisfies **AC-1**, **AC-4**, **AC-5**, **AC-11**, **AC-12**.
4. Penegakan dan self service lengkap: challenge `purpose` `enroll` untuk paksa enroll plus halaman `/auth/two-factor/enroll`, endpoint `disable` dan `recovery-codes` dengan bukti kode, endpoint `status`, panel settings lengkap dengan sisa kode dan regenerate, satisfies **AC-6**, **AC-7**, **AC-8**.
5. Permukaan admin: endpoint GET status dan POST reset di auth service (alasan wajib, hapus credential dan kode, cabut semua session, audit), endpoint PUT kewajiban di user service (alasan wajib, audit, menulis kolom di schema nya sendiri), semuanya dijaga permission kelola user; panel 2FA di halaman detail user web memanggil kedua service lewat gateway, satisfies **AC-9**, **AC-10**.
6. Pengerasan dan siklus hidup: key type rate limit `totp_ip` dan `totp_user`, perluasan cleanup worker (challenge kedaluwarsa atau terpakai, enrollment belum konfirmasi lebih dari 24 jam), penulisan audit untuk semua mutasi, redaksi log, regenerasi OpenAPI plus SDK, dokumentasi env, dan test untuk semua skenario kritis, satisfies **AC-3**, **AC-5**, **AC-11**, **AC-13**, **AC-14**.

## Consequences

**Positive**:

- Faktor pertama yang bocor (email dibajak untuk magic link, atau perangkat passkey dicuri dalam kondisi tak terkunci) tidak lagi cukup untuk membuat session pada akun ber 2FA.
- Semua pola yang dipakai sudah ada di repo (challenge table, rate limit, cookie HttpOnly, cleanup worker, audit), jadi beban operasional baru nyaris nol.
- Admin punya jalan keluar resmi untuk user terkunci tanpa menyentuh database manual.

**Negative / tradeoffs**:

- Login passkey ikut meminta kode TOTP sesuai pilihan desain, padahal WebAuthn sendiri sudah tahan phishing; ini friksi sadar demi keseragaman kebijakan.
- `TOTP_ENCRYPTION_KEY` menjadi rahasia baru yang harus dikelola; kehilangan key berarti semua user harus enroll ulang (tidak ada jalur rotasi otomatis di versi ini).
- Alur login bertambah satu halaman dan satu round trip untuk user ber 2FA.

**Neutral**:

- Rollback teknis sederhana: migration bersifat aditif, down migration menghapus tabel dan kolom baru, dan user tanpa credential tidak tersentuh sama sekali.
- Fitur ingat perangkat (lewati kode di browser tepercaya) sengaja ditunda ke daftar Deferred.
- MCP dan auth mesin tidak tersentuh; 2FA hanya berlaku pada alur login interaktif.
- Permukaan admin 2FA terbagi dua service mengikuti kepemilikan tulis: kewajiban di user service (seperti suspend dan block), status dan reset di auth service. Panel web menyatukannya di satu tempat.

## Follow-up

- [ ] Fitur ingat perangkat 30 hari (trusted device) ditunda; tambahkan ke daftar Deferred di scope saat spec ini dikaitkan.
- [ ] Rotasi `TOTP_ENCRYPTION_KEY` (enkripsi ulang massal atau versi key per baris) belum didesain; buat spec terpisah bila kebutuhan rotasi muncul.
- [ ] Pencarian Agent Skills untuk `otpauth` dan `angularx-qrcode` ditolak pada 2026-08-23; catat penolakan ini di baris `Declined:` `AGENTS.md` saat `/audit` atau `/sync` membuat file itu (repo belum punya `AGENTS.md`).
- [ ] Konvensi skill `elysiajs` dan `angular-developer` belum tercatat di `AGENTS.md` root karena file itu belum ada; jalankan `/audit` untuk membootstrap konteks proyek.
