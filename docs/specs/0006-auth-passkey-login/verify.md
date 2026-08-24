# Verify: auth passkey login · spec 0006 · updated 2026-08-23

_Steps derived from spec 0006 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Run the stack first: `bun run dev` (web on 4200, gateway on 3000, auth on 3101). Passkeys bind to the `http://localhost:4200` origin, so use that exact address, not `127.0.0.1`.

## Run record

**2026-08-22 · PASS.** 36 of the 37 steps below ran and passed against the live stack (web on 4200, gateway on 3000, auth on 3101, with PostgreSQL and NATS up). Every criterion AC-1 to AC-10 is met, and all seven passkey endpoints exist in the auth service, the public gateway spec, and the generated SDK. The live `auth` schema carries `passkey_credentials`, `webauthn_challenges`, and the `passkey_ip` rate limit key, so migration 0009 is applied, not just committed.

**2026-08-24 · AUTOMATED RECOMPOSITION CHECK PASS.** AC-11 implementation is present and `passkeys.page.test.ts`, the full web suite, lint, and typecheck pass. The earlier run record remains valid for AC-1 to AC-10. The six browser composition checks below were then driven against the authenticated page.

**2026-08-24 · RUNTIME PAGE AND TAURI CHECK PASS.** The live stack was launched with `bun run dev`. The browser opened `http://localhost:4200/auth/login` and rendered the passkey button, the email form, and the magic link action. The gateway health route and auth health route returned `200`, and `POST http://localhost:3000/api/v1/auth/passkey/login/options` returned `200` with a localhost RP ID and a challenge. An authenticated seed user opened `/setting/passkeys`; the page showed the stacked shell, two passkeys, the five item footer, and the magic link fallback. The page composition evidence is saved at `/Users/ojiepermana/.codex/visualizations/2026/08/24/01a03390-a4dd-76e2-89cb-aa20f8b3fd38/passkey-settings.png`. Rename was saved and remained after reload. The layout appearance changed from `flat` to `border-rail` and was restored to `flat`. `bun run dev:tauri` built and launched the real macOS shell. Its login screenshot showed only the magic link form and no passkey button at `/Users/ojiepermana/.codex/visualizations/2026/08/24/01a03390-a4dd-76e2-89cb-aa20f8b3fd38/tauri-window-front.png`.

Ceremonies were driven with the software authenticator in `apps/services/auth/src/tests/passkey.authenticator.ts` over real HTTP through the gateway, so registration, sign in, counter handling, challenge safety, rate limits, and cleanup were exercised in the running app. The two platform dialog ceremonies were driven for real in Chrome for Testing with a CDP virtual authenticator. The macOS shell was also built and launched, then checked visually for its magic link only surface.

## UI / manual

- [x] Open `/auth/login` in a browser with WebAuthn → the "Masuk dengan passkey" button shows above a divider, the email form below it is unchanged → AC-1
- [x] Open `/auth/login` in the Tauri shell (`bun run dev:tauri`) → no passkey button, magic link form only, and the network log shows no `/api/v1/auth/passkey/*` request → AC-1
  - Run on 2026-08-24 with `bun run dev:tauri`. The shell built and launched on macOS. The window showed no passkey button, no divider, and only the magic link form. The launch did not create a new WebAuthn challenge. Evidence is saved at `/Users/ojiepermana/.codex/visualizations/2026/08/24/01a03390-a4dd-76e2-89cb-aa20f8b3fd38/tauri-window-front.png`.
  - The visual part remains a manual style check on macOS because Tauri uses WKWebView and Apple ships no WebDriver for it. The real shell launch and screenshot are recorded above.
- [x] In DevTools run `delete window.PublicKeyCredential` then reload `/auth/login` → no passkey button → AC-1
  - Run on 2026-08-22 by serving the same bundle from a second origin that deletes `window.PublicKeyCredential` before boot, since a reload restores the property. The button and the divider were both gone, magic link form unchanged.
- [x] Sign in with a magic link, open `/setting/passkeys`, press "Tambah passkey", complete the platform dialog → the passkey appears with a label, today's created date, and "Belum pernah" as last used → AC-2
  - Run on 2026-08-22 in Chrome for Testing with a CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`, ctap2, internal transport, resident keys, user verified). Pressing the button ran Chrome's own WebAuthn ceremony, the authenticator kept one discoverable credential, and the row appeared as `Passkey 2026-08-22 · 22 Agu 2026 · Belum pernah` with `transports=["internal"]` stored.
- [x] Register five passkeys → "Tambah passkey" is disabled and the page says the limit is reached → AC-2
  - Run on 2026-08-22 with the five registrations made through the API, then the page checked: "5 dari 5 passkey terpakai", the add button carrying `disabled`, and "Batas 5 passkey tercapai. Hapus satu untuk menambah yang baru." Deleting one put the count back to four and re enabled the button.
- [x] Log out, open `/auth/login`, press "Masuk dengan passkey" and choose the passkey without typing an email → you land on `/` signed in → AC-3
  - Run on 2026-08-22 with the same virtual authenticator. The email field was empty, the button landed on `/`, `/api/v1/auth/session` answered `verify.passkey@example.com · admin`, the counter moved 1 → 2, and the passkeys page then showed today as the last used date.
- [x] Reopen `/setting/passkeys` after that sign in → the passkey's last used date is today → AC-3
- [x] With a passkey registered, request and consume a magic link → it still signs you in → AC-4
- [x] Delete the only passkey → it is allowed, the list is empty, and a magic link still signs you in → AC-4
- [x] In a browser profile with no passkeys and no dismissal, complete a magic link login → the "Lebih cepat lain kali" prompt shows on the callback page; press "Nanti saja", then log in again → the prompt does not return → AC-5
- [x] With a passkey already registered, complete a magic link login → no prompt → AC-5
- [x] On `/setting/passkeys` rename a passkey inline and save → the new name survives a reload → AC-6
- [x] Cancel the platform passkey dialog mid ceremony → a soft message appears, no error page, and you stay signed out → AC-7
  - Run on 2026-08-22 with `navigator.credentials.get` rejecting `NotAllowedError`, which is what a cancel produces. The login page showed "Passkey dibatalkan." as a soft status, stayed on the page, and left you signed out.

### Page composition update 2026-08-23

- [x] Open `/setting/passkeys` in the authenticated shell → one stacked `Page` contains exactly one `PageHeader`, one `PageContent`, and one `PageFooter`, with no `PageFilter` → AC-11
- [x] Inspect landmarks and scrolling → no `<main>` exists inside the page template, exactly one `role="main"` exists in the screen, only content scrolls, and the header plus footer remain pinned → AC-11
- [x] Switch the shell appearance setting → header and footer section treatment follows `LayoutService.appearance()` → AC-11
- [x] In a supported browser with fewer than five credentials → the header shows `Tambah passkey`; while busy or at five credentials it is disabled; in an unsupported runtime it is absent → AC-11
- [x] Exercise loading, empty, unsupported, success, failure, populated, inline rename, and delete states → every state appears inside content and the existing behavior remains unchanged → AC-11
- [x] Read the footer before and after adding or deleting a passkey → it shows the current `N dari 5` count and keeps the magic link fallback note → AC-11

## Commands

- [x] `bun test apps/services/auth` → 30 pass, 0 fail → AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10
- [x] `bun run test:web` → 15 pass, 0 fail → AC-1, AC-5
- [x] `bun run typecheck` and `bun run openapi:generate && bun run openapi:validate` → clean, and no diff appears in `apps/*/openapi.yaml`, `packages/contracts/openapi`, or `packages/angular-sdk/src/generated` → AC-2, AC-3, AC-6
- [x] `bun run test:web` → `passkeys.page.test.ts` proves the Page slot contract and preserved register, rename, and delete interactions → AC-11
- [x] `bun run lint` and `bun run typecheck` → clean after the page recomposition → AC-11

### One step per Value sourcing row

- [x] **Registration and login challenge.** `curl -s -X POST localhost:3000/api/v1/auth/passkey/login/options` twice → two different 43 character challenges, and `SELECT count(*) FROM auth.webauthn_challenges` grew by two → value sourcing: challenge
- [x] **RP ID and RP name.** Load the auth env three ways and read `WEBAUTHN_RP_ID`: with `WEB_APP_URL=https://erp.example.com` and no override → `erp.example.com`; with `WEBAUTHN_RP_ID=custom.id` → `custom.id`; with `WEBAUTHN_RP_ID=` left blank → back to `erp.example.com`, never an empty string. The blank case is the one that silently breaks every ceremony if it regresses → value sourcing: RP ID and RP name
- [x] **User handle and excluded credentials.** With two passkeys registered, `POST /api/v1/auth/passkey/register/options` with the session cookie → `excludeCredentials` lists exactly those two credential ids and nothing else → value sourcing: user handle and excluded credentials
- [x] **Expected challenge, origin, RP ID.** Serve the app from a second origin (for example `http://127.0.0.1:4200`) and try to register → verification fails, because origin and RP ID come from server configuration, never from the client → value sourcing: expected challenge, origin, RP ID
  - Run on 2026-08-22 by having the authenticator sign client data for `http://127.0.0.1:4200`, and separately for RP ID `evil.example.com`. Both were refused with `422` and stored nothing.
- [x] **Stored credential fields.** After a registration, `SELECT counter, transports, aaguid, backup_eligible, backup_state FROM auth.passkey_credentials` → the values match what the authenticator reported, not defaults → value sourcing: stored credential fields
- [x] **Label.** Register with `{"label":"MacBook kantor"}` → that label. Register with no label from an authenticator reporting no AAGUID → `Passkey <today, YYYY-MM-DD>`. Register from an authenticator with a known AAGUID (for example iCloud Keychain) → the friendly name. Check the dated case near midnight in your timezone, since the date comes from the server clock → value sourcing: label
- [x] **Login challenge is not bound to a user.** `SELECT user_id, type FROM auth.webauthn_challenges ORDER BY created_at DESC LIMIT 1` after `login/options` → `user_id` is null and `type` is `authentication` → value sourcing: login challenge
- [x] **Credential lookup.** Sign in with a passkey → the row whose `credential_id` matches the assertion id is the one whose `counter` and `last_used_at` moved → value sourcing: credential lookup
- [x] **Counter decision.** Replay an assertion whose counter is at or below the stored counter → `401` with the generic message, a `auth.passkey.counter_regression` warning in the logs, and the credential row still present with its old counter. Separately, an authenticator that always reports counter `0` (a synced passkey) must keep signing in successfully → value sourcing: counter decision
- [x] **Session cookie and expiries.** After a passkey login, `SELECT idle_expires_at - now(), absolute_expires_at - now() FROM auth.sessions ORDER BY created_at DESC LIMIT 1` → about 8 hours and about 7 days. The `Set-Cookie` header carries `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800`, and `Secure` when `AUTH_COOKIE_SECURE=true` → value sourcing: session cookie and expiries · AC-3
  - Run on 2026-08-22 against a live passkey login for the expiries and the cookie attributes. The `Secure` half was checked by calling `serializeSessionCookie` both ways: absent at `false`, present at `true`.
- [x] **Passkey list.** `curl /api/v1/auth/passkeys` with a session → each entry has only `id`, `label`, `createdAt`, `lastUsedAt`, `backupState`. No public key is present anywhere in the body → value sourcing: passkey list · AC-6
- [x] **Post login prompt.** With zero passkeys and no flag → the prompt shows. Set `localStorage.monobungsya.passkey-prompt-dismissed = '1'` → it does not. Clear the flag but register a passkey → it still does not, because the count is now above zero → value sourcing: post login prompt · AC-5
- [x] **Rate limit.** Eleven `login/options` calls from one `x-forwarded-for` address → ten `200` then `429`, and `SELECT attempts FROM auth.auth_rate_limits WHERE key_type = 'passkey_ip'` holds the count. A different address in the same window is unaffected, which proves the key is the hashed source address → value sourcing: rate limit · AC-8
- [x] **Cleanup.** Insert one used, one expired, and one live challenge, run the cleanup, → only the live challenge remains, and credentials, live sessions, and users are untouched → value sourcing: cleanup · AC-10

### Safety and boundaries

- [x] Reuse a consumed challenge → `410`; use a challenge that was never issued → `410`; use an expired one → `410`. In every case no session and no credential is created → AC-7
- [x] Verification failure still burns the challenge: send a bad assertion, then retry the same challenge → `410`, not another chance → AC-7
- [x] Two simultaneous verifications of one challenge → exactly one `200` and one `410`, and exactly one new row in `auth.sessions` → AC-9
- [x] Suspend a user who owns a passkey → passkey sign in returns a generic `401` that names neither the account nor the reason → AC-8
- [x] Sign in with an unknown credential id → `401` with a body that reveals nothing about whether the account exists → AC-7
- [x] Rename or delete another user's passkey id → `404` both times, and the row is unchanged → AC-6
- [x] Register a credential id that already exists → `409` → AC-2

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
- AC-11 covered by the page composition steps and the new `passkeys.page.test.ts` command step
