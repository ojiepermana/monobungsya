# Verify: single lint and formatter toolchain · spec 0001 · updated 2026-08-22

_Steps derived from the spec 0001 stack decision `Lint | Biome | Satu lint dan formatter ringan pada workspace`. This spec is a decision record, so it carries no numbered acceptance criteria; each step names the part of the decision it proves instead. `/check verify` runs these; `/test` locks the durable ones._

## Run record

**2026-08-22 · commands PASS, manual steps not driven.** Prettier was removed and Biome is now the only formatter in the repo. Before this run the two tools disagreed: Prettier had no config file at all, so it ran on its defaults and wanted double quotes, while `biome.json` sets single quotes. The repo was split between the two styles and neither gate could pass.

All twelve command steps below ran and passed. The four manual steps were **not** driven in a running app, so they stay unticked. What covers them for now: the navigation change is covered by `apps/web/src/app/shell/app.nav.test.ts`, which passes and never passed a role argument; the other three rest on `typecheck:web` plus the 15 web unit tests. Driving them properly needs `bun run dev` with PostgreSQL and NATS up, which is what `/check verify` is for.

**2026-08-22 · /check verify · PASS with one step blocked.** Driven as a refactor check: the change must not alter behavior, so the app was run twice and the outputs compared. A git worktree at HEAD served the pre change app on port 4201 while the changed app ran on 4200, both against the same live gateway, auth service, PostgreSQL, and NATS. Chrome was driven headless over the DevTools Protocol.

What came back identical, before versus after:

- `appNavigationFor` output over 20 input combinations (4 permission sets times 5 role values), 19822 bytes each, identical byte for byte. This is the direct proof that dropping the unused `role` parameter changed nothing.
- Rendered DOM snapshots of `/auth/login`, `/verify?token=bogus`, `/`, `/auth/callback-error`, and `/auth/callback-complete`, identical byte for byte (2178 bytes for the first four).
- All five screenshots, identical pixel for pixel by SHA-256.

What was positively observed, not just compared:

- The login page renders in Indonesian (`MONOBUNGSYA · Masuk`, "Masuk ke Monobungsya", "Kirim magic link"), so the rewritten `TreeWalker` loop still walks and replaces every text node.
- Computed `font-family` on icon elements is `"Material Symbols Rounded Variable"`, and the glyphs are visible in the screenshot, so the icon font rules survived the lint pass.
- `auth/callback-complete` renders "Login berhasil" while `auth/callback-error` renders "Link tidak valid atau sudah kedaluwarsa". Same component, two different route data values, two different renders. That proves `this.route.snapshot.data['callback']` is really read at runtime.
- No JavaScript errors on any route.

Still blocked: the signed in app shell was never opened, so the sidebar was not seen rendered in a browser. Sign in needs a magic link, and the local SMTP catcher (Laravel Herd on port 2525) exposes no readable API, while a hand made session row returns 500 from the auth service both before and after this change. The navigation data itself is proven identical above, and `app.nav.test.ts` passes.

One note on the environment, not on this change: a re-run of `bun run lint` at 13:23 reported 2 errors, both in `packages/logger` code another session was writing at that moment (`activity-log.ts` did not exist in HEAD). Linting only the 84 files this change touches gives 1 finding, and that one is the unsorted export block the other session added to `index.ts`, a file this change only reformatted.

Two problems surfaced during the run that had nothing to do with Prettier, and both are fixed:

1. Biome was scanning build output. `apps/tauri/src/target` (cargo) and `apps/web/graphify-out` were not excluded, so 426 artifact JSON files were being linted. Biome now reads `.gitignore` through `vcs.useIgnoreFile`, which cut the scan from 990 files to 131.
2. `apps/web/src/styles.css` and `apps/web/src/theme.css` could not be parsed at all, because Tailwind v4 at-rules such as `@theme` need `css.parser.tailwindDirectives`.

## Commands

- [x] `bun run lint` → exits 0 with no errors and no warnings, and prints no deprecation notice about the `recommended` field, proves one tool gates both lint and formatting
- [x] `bun run format` on a clean tree → `No fixes applied`, proves the formatter is idempotent and the tree matches Biome
- [x] `bun run lint` output says `Checked 131 files`, not roughly 990, proves build output is no longer scanned
- [x] `bunx biome check apps/web/src/theme.css` → no `Tailwind-specific syntax is disabled` parse error, proves the web CSS is actually parsed
- [x] `git grep -in prettier` → no hits, proves nothing in tracked files still reaches for Prettier
- [x] `grep -n format:check .github/workflows/ci.yml` → no hits, proves the redundant CI formatting step is gone (`biome check` already covers formatting)
- [x] `bun install --frozen-lockfile` → succeeds, proves `bun.lock` matches `package.json` with the Prettier dependency removed
- [x] `bun run test` → 61 pass, 0 fail
- [x] `bun run test:web` → 15 pass across 4 files
- [x] `bun run typecheck` → every target green, including `typecheck:web`
- [x] `bun run openapi:generate` then `git status --short packages/angular-sdk/src/generated packages/contracts/openapi` → empty, proves the reformat caused no generated artifact drift
- [x] `bun run check:dependencies` → `No cross service package or source imports found`

## UI / manual

- [ ] Run `bun run dev`, sign in, and open the app shell → the sidebar navigation still shows the same items for the same permissions, proves dropping the unused `role` parameter from `appNavigationFor` changed nothing a user sees
- [x] Open a magic link callback URL → the verify page still reads its `callback` route data and redirects, proves the bracket access suppression in `verify.page.ts` kept the behavior
- [x] Switch the interface language in theme settings → labels still translate, proves the rewritten `TreeWalker` loop in `ui-label-localization.service.ts` still walks every text node
- [x] Open theme settings and look at the icons → the Material Symbols glyphs still render, proves the icon font rules in `styles.css` survived the lint pass

## Decision coverage

- `Satu lint dan formatter ringan pada workspace` → covered by the first three command steps: one tool, one config, both jobs, and no second formatter left to disagree with it.
- Formatter settings in `biome.json` (single quotes, two space indent, trailing commas) → covered by the idempotent `bun run format` step.
- No behavior change from the cleanup → covered by the test, typecheck, and manual steps.

## Known suppressions

Three deliberate exceptions were recorded rather than silently disabled, so a later reader can judge them:

- `biome.json` override for `apps/web/src/**/*.css` turns off `correctness/noUnknownTypeSelector` and `complexity/noImportantStyles`. Angular custom element selectors such as `pageheader` and `NavigationHeader` are legitimate, and `!important` is how this stylesheet overrides `@ojiepermana/angular`.
- `apps/web/src/styles.css` carries two inline `biome-ignore` lines for `a11y/useGenericFontNames`, because an icon font has no meaningful generic fallback.
- `apps/web/src/app/auth/verify.page.ts` carries one inline `biome-ignore` for `complexity/useLiteralKeys`, because TypeScript `noPropertyAccessFromIndexSignature` requires bracket access on Angular route data. Biome marks that fix as unsafe for exactly this reason, and applying it did break `typecheck:web` during this run.
