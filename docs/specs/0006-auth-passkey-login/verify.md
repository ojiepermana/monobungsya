# Verify: auth passkey login · spec 0006 · updated 2026-08-22

_Steps derived from spec 0006 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Run the stack first: `bun run dev` (web on 4200, gateway on 3000, auth on 3101). Passkeys bind to the `http://localhost:4200` origin, so use that exact address, not `127.0.0.1`.

## UI / manual

- [ ] Open `/auth/login` in a browser with WebAuthn → the "Masuk dengan passkey" button shows above a divider, the email form below it is unchanged → AC-1
- [ ] Open `/auth/login` in the Tauri shell (`bun run dev:tauri`) → no passkey button, magic link form only, and the network log shows no `/api/v1/auth/passkey/*` request → AC-1
- [ ] In DevTools run `delete window.PublicKeyCredential` then reload `/auth/login` → no passkey button → AC-1
- [ ] Sign in with a magic link, open `/setting/passkeys`, press "Tambah passkey", complete the platform dialog → the passkey appears with a label, today's created date, and "Belum pernah" as last used → AC-2
- [ ] Register five passkeys → "Tambah passkey" is disabled and the page says the limit is reached → AC-2
- [ ] Log out, open `/auth/login`, press "Masuk dengan passkey" and choose the passkey without typing an email → you land on `/` signed in → AC-3
- [ ] Reopen `/setting/passkeys` after that sign in → the passkey's last used date is today → AC-3
- [ ] With a passkey registered, request and consume a magic link → it still signs you in → AC-4
- [ ] Delete the only passkey → it is allowed, the list is empty, and a magic link still signs you in → AC-4
- [ ] In a browser profile with no passkeys and no dismissal, complete a magic link login → the "Lebih cepat lain kali" prompt shows on the callback page; press "Nanti saja", then log in again → the prompt does not return → AC-5
- [ ] With a passkey already registered, complete a magic link login → no prompt → AC-5
- [ ] On `/setting/passkeys` rename a passkey inline and save → the new name survives a reload → AC-6
- [ ] Cancel the platform passkey dialog mid ceremony → a soft message appears, no error page, and you stay signed out → AC-7

## Commands

- [ ] `bun test apps/services/auth` → 29 pass, 0 fail → AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10
- [ ] `bun run test:web` → 15 pass, 0 fail → AC-1, AC-5
- [ ] `bun run typecheck` and `bun run openapi:generate && bun run openapi:validate` → clean, and no diff appears in `apps/*/openapi.yaml`, `packages/contracts/openapi`, or `packages/angular-sdk/src/generated` → AC-2, AC-3, AC-6

### One step per Value sourcing row

- [ ] **Registration and login challenge.** `curl -s -X POST localhost:3000/api/v1/auth/passkey/login/options` twice → two different 43 character challenges, and `SELECT count(*) FROM auth.webauthn_challenges` grew by two → value sourcing: challenge
- [ ] **RP ID and RP name.** Load the auth env three ways and read `WEBAUTHN_RP_ID`: with `WEB_APP_URL=https://erp.example.com` and no override → `erp.example.com`; with `WEBAUTHN_RP_ID=custom.id` → `custom.id`; with `WEBAUTHN_RP_ID=` left blank → back to `erp.example.com`, never an empty string. The blank case is the one that silently breaks every ceremony if it regresses → value sourcing: RP ID and RP name
- [ ] **User handle and excluded credentials.** With two passkeys registered, `POST /api/v1/auth/passkey/register/options` with the session cookie → `excludeCredentials` lists exactly those two credential ids and nothing else → value sourcing: user handle and excluded credentials
- [ ] **Expected challenge, origin, RP ID.** Serve the app from a second origin (for example `http://127.0.0.1:4200`) and try to register → verification fails, because origin and RP ID come from server configuration, never from the client → value sourcing: expected challenge, origin, RP ID
- [ ] **Stored credential fields.** After a registration, `SELECT counter, transports, aaguid, backup_eligible, backup_state FROM auth.passkey_credentials` → the values match what the authenticator reported, not defaults → value sourcing: stored credential fields
- [ ] **Label.** Register with `{"label":"MacBook kantor"}` → that label. Register with no label from an authenticator reporting no AAGUID → `Passkey <today, YYYY-MM-DD>`. Register from an authenticator with a known AAGUID (for example iCloud Keychain) → the friendly name. Check the dated case near midnight in your timezone, since the date comes from the server clock → value sourcing: label
- [ ] **Login challenge is not bound to a user.** `SELECT user_id, type FROM auth.webauthn_challenges ORDER BY created_at DESC LIMIT 1` after `login/options` → `user_id` is null and `type` is `authentication` → value sourcing: login challenge
- [ ] **Credential lookup.** Sign in with a passkey → the row whose `credential_id` matches the assertion id is the one whose `counter` and `last_used_at` moved → value sourcing: credential lookup
- [ ] **Counter decision.** Replay an assertion whose counter is at or below the stored counter → `401` with the generic message, a `auth.passkey.counter_regression` warning in the logs, and the credential row still present with its old counter. Separately, an authenticator that always reports counter `0` (a synced passkey) must keep signing in successfully → value sourcing: counter decision
- [ ] **Session cookie and expiries.** After a passkey login, `SELECT idle_expires_at - now(), absolute_expires_at - now() FROM auth.sessions ORDER BY created_at DESC LIMIT 1` → about 8 hours and about 7 days. The `Set-Cookie` header carries `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800`, and `Secure` when `AUTH_COOKIE_SECURE=true` → value sourcing: session cookie and expiries · AC-3
- [ ] **Passkey list.** `curl /api/v1/auth/passkeys` with a session → each entry has only `id`, `label`, `createdAt`, `lastUsedAt`, `backupState`. No public key is present anywhere in the body → value sourcing: passkey list · AC-6
- [ ] **Post login prompt.** With zero passkeys and no flag → the prompt shows. Set `localStorage.monobungsya.passkey-prompt-dismissed = '1'` → it does not. Clear the flag but register a passkey → it still does not, because the count is now above zero → value sourcing: post login prompt · AC-5
- [ ] **Rate limit.** Eleven `login/options` calls from one `x-forwarded-for` address → ten `200` then `429`, and `SELECT attempts FROM auth.auth_rate_limits WHERE key_type = 'passkey_ip'` holds the count. A different address in the same window is unaffected, which proves the key is the hashed source address → value sourcing: rate limit · AC-8
- [ ] **Cleanup.** Insert one used, one expired, and one live challenge, run the cleanup, → only the live challenge remains, and credentials, live sessions, and users are untouched → value sourcing: cleanup · AC-10

### Safety and boundaries

- [ ] Reuse a consumed challenge → `410`; use a challenge that was never issued → `410`; use an expired one → `410`. In every case no session and no credential is created → AC-7
- [ ] Verification failure still burns the challenge: send a bad assertion, then retry the same challenge → `410`, not another chance → AC-7
- [ ] Two simultaneous verifications of one challenge → exactly one `200` and one `410`, and exactly one new row in `auth.sessions` → AC-9
- [ ] Suspend a user who owns a passkey → passkey sign in returns a generic `401` that names neither the account nor the reason → AC-8
- [ ] Sign in with an unknown credential id → `401` with a body that reveals nothing about whether the account exists → AC-7
- [ ] Rename or delete another user's passkey id → `404` both times, and the row is unchanged → AC-6
- [ ] Register a credential id that already exists → `409` → AC-2

## Acceptance-criteria coverage

- AC-1 covered by the three login page gating steps (WebAuthn browser, Tauri shell, WebAuthn removed) and `bun run test:web`
- AC-2 covered by the registration step, the five passkey limit step, the duplicate credential step, and the stored credential fields step
- AC-3 covered by the passkey sign in step, the last used step, and the session cookie and expiries step
- AC-4 covered by the magic link with a passkey step and the delete the last passkey step
- AC-5 covered by the prompt shown step, the prompt dismissed step, and the post login prompt sourcing step
- AC-6 covered by the rename step, the passkey list step, and the ownership step
- AC-7 covered by the challenge reuse, never issued, expired, burn on failure, cancellation, and generic error steps
- AC-8 covered by the rate limit step and the suspended user step
- AC-9 covered by the counter decision step and the concurrent verification step
- AC-10 covered by the cleanup step
