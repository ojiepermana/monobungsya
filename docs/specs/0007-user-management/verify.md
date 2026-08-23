# Verify: user lifecycle management · spec 0007 · updated 2026-08-23

_Steps derived from spec 0007 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

> **Run on 2026-08-22: FAIL, then fixed and re-checked the same day.**
> Two criteria failed on the first run and both now pass:
> - **AC-3:** a PATCH that omitted `role` silently set it to `admin`, because
>   `t.UnionEnum` stamps `default: "admin"` on the schema and `t.Optional` does not
>   strip it. Fixed with `enumSchema` in `packages/elysia`, which is the same union
>   with the default removed. Re-checked through the UI: renaming a staff user keeps
>   their role, and an intentional role change still works.
> - **AC-2 second half:** with NATS unreachable the user service did not start at all.
>   Fixed with `tryConnectMessaging` in `packages/messaging`. Re-checked: the service
>   boots, warns once, the create returns 200, and `user.invited.skipped` is logged.
>
> **Re-run on 2026-08-22 after the fix: PASS.** Every step above was exercised again
> against the running stack, not just the two that had failed, because the fix changed
> shared schema code that every request path goes through. Both former failures now
> behave: a rename keeps the stored role, and with NATS unreachable the service boots,
> warns, and the create returns 200 with `user.invited.skipped` logged.
>
> One regression probe worth keeping: removing the schema default from the list
> `status` filter left the default view still hiding deleted users, whether the
> parameter is empty or omitted entirely, because the service supplies `''` itself.
>
> Still open for `/test`: the audit rollback under "Known gap for /test", which needs
> fault injection rather than a manual run.

Set up first: sign in as an admin (the seeded `system@project.local` is one), and
have `bun run dev` up with `ENABLE_INFRASTRUCTURE=true` so PostgreSQL and NATS
are reachable. A second throwaway admin is handy for the last admin steps.

## UI / manual

- [x] Open `/users` as an admin → the list renders with search, a status filter defaulting to "Semua kecuali terhapus", status badges, and paging → AC-9
- [x] Sign in as a manager, then open `/users` → redirected away, and no "User Management" entry in the menu → AC-8
- [x] Click "Tambah User", fill name and email, pick a role, save → the new user appears in the list with status Aktif → AC-1
- [x] Check the mail catcher after that create → the new user has an invitation mail with a magic link → AC-2
- [x] Open the magic link from that mail → the new user reaches the app with a working session → AC-1
- [x] Click "Ubah" on a row, change the name and role, save → the row shows the new values, and there is no email field to change → AC-3
- [x] Click "Tangguhkan", leave the reason empty → the confirm button stays disabled → AC-4
- [x] Fill the reason and confirm → the badge becomes Ditangguhkan and the row now offers "Buka penangguhan" → AC-4
- [x] In another browser session as that suspended user, request a magic link and try to load the app → login is refused and the existing session stops working on the next request → AC-4
- [x] Click "Blokir" on a suspended user with a reason → the badge becomes Diblokir and the suspended timestamp is still filled on the detail page → AC-4
- [x] Click "Buka blokir" → the user returns to Ditangguhkan, not straight to Aktif → AC-4
- [x] Click "Hapus" with a reason → the user disappears from the default list → AC-5
- [x] Switch the status filter to "Dihapus" → the deleted user is listed there → AC-5
- [x] Click "Pulihkan" on that deleted user → they come back with the status they had before deletion → AC-5
- [x] Try to create a user with the email of a deleted user → refused with "Email sudah dipakai user lain." → AC-5
- [x] Look at your own row in the list → only "Ubah" is offered, no status actions → AC-6
- [x] With exactly one active admin left, have another admin try to delete or downgrade it → refused with "Admin aktif terakhir tidak bisa dinonaktifkan atau diturunkan." → AC-6
- [x] Open `/users/:id` for any user → the profile card shows the derived status, the role, the id, and all six timestamps, plus the action buttons → AC-9
- [x] On that detail page, open each of the three log tabs → each lists only rows where this user was the actor, with working paging → AC-10
- [x] On the detail page of the admin who just did the work → the Audit Trail tab shows one row per mutation, with the action, the entity, and the change summary → AC-7, AC-10
- [x] Open the old `/setting/users` URL → redirected to `/users` → AC-9

## Commands

- [x] `bun run test` → 113 tests pass, no failures
- [x] `bun run typecheck` → every app and package clean
- [x] `bun run lint` → no errors (one pre-existing `noStaticOnlyClass` warning in `packages/logger` is expected)
- [x] `bun run test:web` → 16 Angular tests pass
- [x] `bun run openapi:generate && git status --short` → no diff in `apps/*/openapi.yaml`, `packages/contracts/openapi`, or `packages/angular-sdk/src/generated`
- [x] `bun run check:dependencies` → no cross service imports
- [x] `bun run db:migrate` twice → the second run reports `skipped 0011_user_status_columns` and applies nothing
- [x] `psql "$DATABASE_URL" -c '\d "user".users'` → `blocked_at` and `deleted_at` exist, both nullable timestamptz
- [x] `curl -s "$PUBLIC_API_URL/api/v1/users" ` with no session cookie → 401, not 500
- [x] `curl` a create twice with the same id → the second is 409 with `"reason":"user_id_taken"`; with the same email but a different id → 409 with `"reason":"user_email_taken"` → AC-1
- [x] `curl` any `/api/v1/users` route with a manager session → 403 from the gateway, and the user service is never called → AC-8
- [x] `psql "$DATABASE_URL" -c "select count(*) from \"user\".users where deleted_at is not null"` after a delete → the row is still there, never removed → AC-5
- [x] Stop NATS, then create a user → the create still returns 200 and the auth log carries a `user.invited.skipped` or publish warning → AC-2

## Added 2026-08-23: page composition (AC-12) · not yet run

The spec update adds AC-12 (both pages compose the package `Page` scaffold). These steps stay unchecked until the recomposition ships.

- [ ] Open `/users` → the header (title plus "Tambah User"), the filter bar (search, status, clear), and the paging footer stay pinned while only the table region scrolls → AC-12
- [ ] Open `/users/:id` → the header (name plus back link) and the paging footer stay pinned while the profile card and log tabs scroll in the content region → AC-12
- [ ] Inspect both pages in devtools → no `<main>` element inside the page templates, exactly one `role="main"` landmark per screen (the layout wrapper's), and the content region is keyboard focusable (`tabindex="0"`) → AC-12
- [ ] Switch the shell appearance in the settings surface → the page header and footer section borders follow the flat or border rail setting → AC-12
- [ ] Open the create, edit, and reason dialogs from both pages → all still open and close normally from inside `PageContent` → AC-12
- [ ] `bun run test:web` → the updated composition assertions in `users.page.test.ts` and `user-detail.page.test.ts` pass → AC-12

## Value sourcing

One step per row of the spec's Value sourcing table, exercising the edge that breaks if the source is wrong.

- [x] Open the create dialog and read the shown id → it is a uuid whose version nibble is `7` (the 13th hex digit), and it differs every time the dialog is opened → id comes from the Angular `uuid` v7 function
- [x] Read the role dropdown in the create and edit dialogs → exactly `admin, manager, bi, staff, legacy`, matching the CHECK constraint; `GET /api/v1/users` echoes the same list in `options.roles` → role options come from the Elysia schema
- [x] After any mutation, read the audit row → `actor_user_id`, `actor_email`, and `actor_role` match the signed-in admin, and `actor_name` is filled from that admin's own user row → audit actor comes from the verified identity
- [x] Run a status action and read `logs.audit_trails.reason` → it holds exactly the text typed in the dialog; a create or update leaves it null → reason comes from the required body field
- [x] Set `suspended_at` and `blocked_at` on one row directly in SQL → the list and detail both report `blocked`, not `suspended`; then clear `blocked_at` and it reports `suspended` → derived status follows the deleted, blocked, suspended, active precedence
- [x] Create a user with a name containing an accent or apostrophe → the invitation mail greets them with that exact name at that exact address → recipient comes from the `user.invited` payload
- [x] Change `PUBLIC_API_URL` to a different host, restart, create a user → the link in the invitation mail uses the new host → magic link base URL comes from `PUBLIC_API_URL`
- [x] With two active admins, delete one (allowed); then try to delete or downgrade the survivor (refused with `last_active_admin`); suspend an admin first and confirm they no longer count toward the total → the guard counts only admins with all three timestamps null
- [x] On a detail page, compare each log tab against the same log viewer page filtered by hand → the tab shows the strict subset where that user is the actor; a user who never acted shows three empty tabs → tab rows come from the logs endpoints with `actorUserId`
- [x] Create 26 users and page the list → 25 rows on page one, 1 on page two, and `meta.perPage` is 25 → page size is fixed at 25

### Timezone and formatting edge

- [x] Confirm the API returns timestamps as ISO 8601 with a `Z` suffix, not the Postgres `2026-08-22 16:01:14.724637+07` shape → the columns are `timestamptz`, so the repository shifts them to UTC before rendering; if this regresses, every date in the UI reads "Invalid Date"
- [x] Change the database session timezone away from UTC and reload the list → the ISO values do not shift, and the UI still shows the correct local time

## Acceptance-criteria coverage

- AC-1 · create, duplicate id, duplicate email, and login by the new user · covered by the create, magic link, and curl duplicate steps
- AC-2 · invitation event and email, plus the NATS off fallback · covered by the mail catcher step and the stop NATS step
- AC-3 · update name and role, email immutable, audit trailed · covered by the "Ubah" step and the audit row step
- AC-4 · the four suspend and block actions with mandatory reasons, login refused, session stops · covered by the suspend, block, unblock, and second session steps
- AC-5 · soft delete, restore, hidden by default, reachable by filter, email stays unique · covered by the delete, filter, restore, email reuse, and row still present steps
- AC-6 · self guard and last active admin guard · covered by the own row step, the last admin step, and the guard counting step
- AC-7 · every mutation audit trailed, a failed audit fails the request · covered by the audit row steps; the rollback path is a unit test for `/test`
- AC-8 · admin only, 403 for any other role · covered by the manager UI step and the manager curl step
- AC-9 · the list page and the detail page, old settings list replaced · covered by the list, detail, and `/setting/users` redirect steps
- AC-10 · `actorUserId` on the three logs endpoints, tabs scoped with paging · covered by the log tab steps
- AC-11 · endpoints live in the user service, auth list code removed, login checks extended · covered by the openapi diff command and the suspended user login step
- AC-12 · package page scaffold on both pages, one main landmark, pinned slots · covered by the 2026-08-23 steps above, pending until the recomposition ships

## Known gap for `/test`

- A failing audit write rolling the mutation back (AC-7) needs a fault injected into `ActivityLog.writeAudit`; it is a unit test, not a manual step.
