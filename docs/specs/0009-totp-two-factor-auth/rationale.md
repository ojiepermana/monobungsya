# 0009. TOTP two factor authentication: rationale

## Context

Auth repo ini sudah punya dua metode login: magic link (spec 0003) dan passkey (spec 0006). Magic link pada dasarnya satu faktor, yaitu penguasaan kotak masuk email. Bila email user dibajak, penyerang bisa meminta magic link dan langsung mendapat session penuh. Spec 0003 secara eksplisit menandai MFA sebagai keputusan terpisah yang belum diambil, jadi celah ini adalah utang desain yang tercatat, bukan kelalaian.

Kekuatan yang membentuk keputusan ini: repo memakai pola yang sangat konsisten (token di hash, challenge sekali pakai, rate limit atomik, cleanup worker harian, audit lewat `ActivityLog`), sehingga solusi yang meniru pola itu murah dibangun dan murah dioperasikan. Organisasi masih fase satu tenant dengan admin yang mengelola user lewat halaman user management (spec 0007) dan ACL berbasis permission (spec 0008), jadi kemampuan admin mewajibkan dan mereset 2FA harus menempel ke permukaan yang sudah ada. Batasan penting lain: magic link tidak boleh menjadi jalur reset 2FA, karena faktor pertama yang bisa melucuti faktor kedua membuat faktor kedua itu tidak berarti.

Konsekuensi tidak memutuskan: akun admin (yang bisa memberi grant permission dan mereset user lain) tetap terlindungi hanya oleh keamanan kotak masuk emailnya.

## Options considered

### Option 1: TOTP step with a separate challenge table (chosen)

Kode 6 digit dari aplikasi authenticator sebagai langkah kedua setelah faktor pertama. Status antara disimpan di tabel `auth.mfa_challenges` bergaya `webauthn_challenges`; session asli baru dibuat setelah kode benar.

**Pros**:
- Meniru pola repo yang sudah terbukti (challenge sekali pakai, hash, TTL, worker), tabel `sessions` tetap bersih tanpa semantik pending.
- TOTP bekerja offline, tanpa biaya per pesan, dan didukung semua aplikasi authenticator umum.
- Gateway tidak berubah: dia tetap hanya memvalidasi session yang sudah jadi.

**Cons**:
- Satu tabel baru dan satu cookie baru yang harus dirawat.
- Alur login user ber 2FA bertambah satu halaman.

### Option 2: Pending flag on the sessions table

Session dibuat langsung setelah faktor pertama dengan kolom `mfa_verified_at` kosong; gateway menolak session pending kecuali menuju endpoint verifikasi.

**Pros**:
- Tanpa tabel baru; cookie session tunggal dari awal sampai akhir.

**Cons**:
- Semantik session jadi bercabang; setiap konsumen session (gateway, service, log, MCP kelak) harus tahu arti pending, dan satu kelalaian pengecekan menjadi bypass 2FA.
- Pengecekan gateway yang hari ini sederhana ikut menanggung logika baru.

### Option 3: Rely on passkeys as the only second factor

Tidak membangun TOTP; mendorong semua user memakai passkey yang memang sudah tahan phishing dan multi faktor secara alami.

**Pros**:
- Tanpa kode baru sama sekali; passkey sudah dibangun dan teruji.

**Cons**:
- Magic link tetap satu faktor, dan magic link adalah jalur recovery universal, jadi celah email tetap terbuka penuh.
- Tidak ada mekanisme mewajibkan faktor kedua bagi user yang menolak enroll passkey.

## Rationale

Option 1 menang karena kekuatan utama di Context adalah konsistensi pola: repo sudah membuktikan bentuk challenge sekali pakai pada WebAuthn, dan meniru bentuk itu memberi hampir semua sifat keamanan yang dibutuhkan (sekali pakai, TTL, atomik, dibersihkan worker) secara gratis. Option 2 menghemat satu tabel tapi membayar dengan risiko sistemik, satu titik lupa cek menjadi bypass 2FA, dan itu jenis kegagalan yang paling mahal di fitur keamanan. Option 3 tidak menjawab masalah karena magic link, satu satunya jalur universal, tetap satu faktor.

Keputusan turunannya:

- **Pemicu pada kedua metode login**: engineer memilih magic link dan passkey sama sama meminta kode, demi kebijakan seragam. Tercatat sadar bahwa ini menambah friksi pada passkey yang sudah kuat; keseragaman menang atas optimasi friksi.
- **Library `otpauth`** dipilih atas menulis sendiri dan `otplib`: zero dependency, implementasi RFC 6238 dan RFC 4226 lengkap termasuk URI, berjalan di Bun. Menulis sendiri (runner up) menghemat satu dependency tapi menjadikan base32 dan kasus tepi verifikasi tanggungan permanen.
- **Enkripsi AES-256-GCM dengan `TOTP_ENCRYPTION_KEY` terpisah**: secret TOTP harus bisa dibaca ulang server (hashing bukan opsi), dan dump database yang bocor tidak boleh membocorkan seed 2FA. Runner up derivasi dari `INTERNAL_AUTH_SIGNING_SECRET` ditolak karena memakai satu key untuk dua tujuan mengunci rotasi.
- **QR di client**: API tetap murni JSON, secret lewat sekali di atas TLS, dan render gambar bukan tanggung jawab auth service. Runner up SVG server menambah dependency backend tanpa manfaat sepadan.
- **Recovery codes plus reset admin**: kombinasi jalur mandiri dan jalur resmi, dengan prinsip magic link tidak boleh mereset 2FA. Kode di hash SHA-256 mengikuti pola magic link token.
- **Paksa enroll setelah faktor pertama** (bukan blokir login): kewajiban tegak tanpa mengunci siapa pun, dan tidak butuh jalur enroll khusus di luar alur login.
- **Reset admin mencabut semua session**: reset menandakan kemungkinan kompromi, session penyerang tidak boleh selamat. Enable dan disable mandiri membiarkan session berjalan karena keduanya aksi rutin dari pemilik akun sah.
- **Permission kelola user dipakai ulang** untuk endpoint admin: tombolnya hidup di halaman detail user bersebelahan dengan suspend dan block yang dijaga permission sama; entri katalog baru (runner up) menambah administrasi grant tanpa kebutuhan nyata saat ini.
- **Parameter TOTP standar** (6 digit, step 30 detik, SHA-1, toleransi ±1 step): default yang dipahami semua aplikasi authenticator; SHA-256 (runner up) masih bermasalah kompatibilitas di beberapa aplikasi.
- **Issuer dari env `TOTP_ISSUER` baru** alih alih memakai ulang `WEBAUTHN_RP_NAME`: branding label authenticator tidak selayaknya terikat konfigurasi WebAuthn.
- **Fitur ingat perangkat ditolak untuk versi pertama**: session absolut 7 hari sudah membatasi frekuensi friksi, dan trusted device menambah permukaan serangan plus satu tabel lagi. Masuk Deferred.
- **Koreksi 2026-08-23, referensi tabel users dan lokasi data kewajiban**: build terblokir karena spec semula menyebut `auth.users`, padahal tabel users repo ini adalah `"user"."users"` (schema `user`, dibuat migration auth foundation, semua FK auth yang ada menunjuknya). Verifikasi kode juga menunjukkan auth service hanya membaca tabel itu, tidak pernah menulisnya, dan grant `project_auth_runtime` hanya mencakup schema `auth`. Dua kandidat lokasi kewajiban dipertimbangkan: tabel kecil `auth.totp_requirements` (menjaga semua endpoint admin 2FA di satu service) atau kolom `totp_required_at` pada `"user"."users"` yang ditulis user service. Engineer memilih kolom pada `"user"."users"`: konsisten dengan preseden spec 0007 (suspend, block, dan delete adalah kolom pada baris user, ditulis user service dengan alasan wajib plus audit, dibaca query login auth), dan atribut kewajiban memang atribut user, bukan credential. Tradeoff yang diterima sadar: permukaan admin 2FA terbagi dua service (kewajiban di user service, status dan reset di auth service), dan panel web menyatukannya lewat gateway.
