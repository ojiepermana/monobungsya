# 0006. Add passkey login alongside magic link · rationale

Decision record for [index.md](index.md).

## Context

Spec 0003 membangun login magic link dengan session server side di PostgreSQL, dan spec 0004 membangun UI login dan callback. Magic link bergantung penuh pada pengiriman email: login lambat saat SMTP lambat, dan email adalah permukaan phishing. Passkey memberi login yang tahan phishing (kredensial terikat ke domain, tidak bisa dipakai di situs palsu) dan lebih cepat karena tanpa email.

Kekuatan yang membentuk keputusan ini: sistem auth yang ada sudah punya pola yang tepat untuk dipakai ulang (token sekali pakai dengan konsumsi atomik, session server side, rate limit dengan key hash, worker cleanup harian), verifikasi kripto WebAuthn terlalu berisiko untuk ditulis sendiri, dan klien desktop Tauri tidak bisa diandalkan menjalankan ceremony WebAuthn sehingga dua metode harus hidup berdampingan, bukan saling menggantikan. Premise note di spec 0003 sudah menandai metode login tambahan sebagai keputusan terpisah; spec ini adalah keputusan itu.

## Options considered

### Option 1: SimpleWebAuthn on the existing auth service

Add `@simplewebauthn/server` to the auth service and `@simplewebauthn/browser` to the Angular app. The auth service keeps owning ceremonies, credentials, and sessions in PostgreSQL.

**Pros**:

- De facto standard TypeScript WebAuthn library, actively maintained, runs on Bun.
- Registration and authentication verification are complete, including origin, RP ID, and counter checks.
- Sessions, rate limits, and cleanup from spec 0003 are reused without new infrastructure.

**Cons**:

- New dependency whose releases must track WebAuthn spec changes.
- Two client libraries (server and browser) must stay version compatible.

### Option 2: @passwordless-id/webauthn

A lighter WebAuthn library with a smaller API surface on both server and browser.

**Pros**:

- Smaller dependency and simpler API for basic ceremonies.

**Cons**:

- Smaller community and thinner verification coverage than SimpleWebAuthn.
- Fewer escape hatches when browser behavior differs.

### Option 3: Hosted passkey provider

Delegate passkey ceremonies and credential storage to a hosted identity vendor.

**Pros**:

- Least ceremony code to operate; vendor tracks spec changes.

**Cons**:

- Reintroduces the vendor dependency spec 0003 deliberately avoided.
- Splits identity state between PostgreSQL sessions and a vendor, complicating logout, revocation, and the HMAC identity contract.

## Rationale

The auth service already holds the exact patterns passkeys need: hashed single use tokens with atomic consume become single use challenges, server side sessions mean a passkey login is just another way to create the same session row, and the rate limit table takes a new key type without schema surgery. Writing WebAuthn verification by hand was rejected outright: CBOR parsing and signature verification are a high risk crypto surface with no upside over a proven library. A hosted provider conflicts with the self owned session decision in spec 0003 and would fragment identity state.

Calls settled here rather than asked: the login verify endpoint returns JSON plus the session cookie instead of a redirect, because the ceremony is a fetch call from the login page, not an email link (runner up: mirroring the magic link redirect, which fits links, not fetch). Challenge TTL is 5 minutes (runner up 10; ceremonies finish in seconds, shorter is safer). The post login prompt dismissal lives in browser localStorage (runner up: a per user column; localStorage needs no schema change, and reappearing once on a brand new device is acceptable, even useful). Counter regression rejects the login and warns without deleting the credential (runner up: auto delete; synced passkeys make counters unreliable, so silent destruction punishes legitimate users). The default label derives from the authenticator's aaguid when recognized, else a generic name with the registration date, and the user can rename it. User verification is `preferred`, not `required`, for the widest authenticator compatibility.
