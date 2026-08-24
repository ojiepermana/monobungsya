# 0004. Build auth login and callback UI

**Date**: 2026-08-20
**Status**: Accepted

## Summary

Web app menambahkan alur login magic link yang menyatu dengan visual operations console yang sudah ada. UI memiliki login email, state check inbox, callback sukses, dan callback error, dengan layout dua kolom desktop serta satu kolom mobile. Semua request auth memakai generated gateway SDK dan tidak menyimpan token di browser.

## Context

Auth backend sudah menyediakan request magic link, verify redirect, session read, logout, dan response error generik. Web app saat ini hanya memiliki shell scaffold dan belum memiliki route atau state login. Tanpa UI callback, redirect sukses atau gagal dari email tidak memberi feedback yang dapat dipahami pengguna.

Design source yang dipilih adalah UI saat ini di `apps/web`, bukan design tool atau asset eksternal. Visual yang ada memakai Avenir Next, serif Georgia untuk heading, latar hijau abu, aksen teal dan coral, garis tipis, serta komposisi utilitarian untuk operations console.

## Requirements

**User stories**:

- As a user, I want to enter my email and request a sign in link so that I can access the workspace without a password.
- As a user, I want clear confirmation that the link was sent without account enumeration details so that I know what to do next.
- As a user, I want a clear success or failure result after following the link so that I know whether I can continue.
- As a keyboard or assistive technology user, I want the auth flow to expose labels, focus, error state, and status announcements correctly.

**Acceptance criteria**:

- **AC-1**: `/auth/login` renders a labeled email field and a primary request link action using the existing visual language and generated SDK.
- **AC-2**: The login screen has idle, invalid email, submitting, generic sent, rate limited, and service error states. The generic sent state does not reveal whether the email exists.
- **AC-3**: A successful request shows a check inbox state and does not expose raw token or account existence data.
- **AC-4**: `/auth/callback-complete` displays a success state with a clear action to continue to the workspace, and `/auth/callback-error` displays a generic failure state with an action to return to login.
- **AC-5**: Auth routes handle loading and error responses without blank content, and a session check can be performed after callback success.
- **AC-6**: Inputs and actions are keyboard accessible, have persistent labels and visible focus, and dynamic error or success messages use appropriate status or alert semantics.
- **AC-7**: The layout works at desktop and mobile widths. Mobile uses one column, hides the decorative panel, and has no horizontal overflow.
- **AC-8**: The UI never stores or logs the magic token, session cookie, or token hash. Browser credentials use the cookie behavior provided by the API.

## Options considered

### Option 1: Add dedicated Angular auth routes and focused components

Create route components for login and callback states, reuse current tokens and layout conventions, and call generated SDK operations.

**Pros**:

- Each URL has a stable browser state and refresh behavior.
- Tests can cover states independently without coupling auth to the dashboard shell.
- Matches the existing standalone Angular application structure.

**Cons**:

- Adds several small components and route files.
- The current scaffold needs a session aware shell after login.

### Option 2: Keep auth inside the root component with conditional template state

The root component owns the email form, callback detection, and all auth states.

**Pros**:

- Fewer files for the first screen.
- Easy to share the existing shell markup.

**Cons**:

- URL state and browser refresh become implicit.
- Root component becomes responsible for API, navigation, form, and dashboard concerns.

## Decision

**Chosen option**: Option 1: Add dedicated Angular auth routes and focused components

Use standalone Angular route components for `/auth/login`, `/auth/callback-complete`, and `/auth/callback-error`. Preserve the existing visual tokens and use the generated gateway SDK for request link, session, and logout operations.

**Implementation skills**: `angular-developer` (`project/angular-developer`, `/Users/ojiepermana/.agents/skills/angular-developer/`)

## Rationale

Dedicated routes make the email link redirect and browser refresh deterministic. They also keep auth state separate from the current platform status shell, while reusing its typography, colors, spacing, and operations console tone. The feature is small enough for focused standalone components and tests.

No external image or decorative asset is needed. The visual direction uses typography, line work, restrained color, and the existing wordmark. This keeps the auth flow fast and avoids an asset dependency for a utility screen.

## Feature design

**Data model sketch**:

No new UI data model. The UI consumes the auth API and the browser session cookie. It does not persist email, token, or session values in local storage, indexed DB, or application state beyond the current request.

**State transitions**:

- Login screen: `idle → submitting → sent` or `submitting → rate limited` or `submitting → service error`.
- Callback: `loading → complete` or `loading → error`.

**API surface**:

| Endpoint                  | Method | Key inputs                      | Key outputs                                     | Auth            | Key errors                      |
| ------------------------- | ------ | ------------------------------- | ----------------------------------------------- | --------------- | ------------------------------- |
| `/api/v1/auth/magic-link` | POST   | `email:string`                  | Generic accepted response                       | Public          | `422`, `429`, `503`             |
| `/api/v1/auth/session`    | GET    | Browser cookie                  | Authenticated flag, user identity, role, expiry | Cookie optional | `200` unauthenticated, `503`    |
| `/api/v1/auth/logout`     | POST   | Browser cookie                  | Cleared cookie                                  | Cookie optional | `204`, `503`                    |
| `/api/v1/auth/verify`     | GET    | Email link token handled by API | Redirect to callback complete or callback error | Public          | Generic callback error redirect |

**Value sourcing**:

| Action            | Value produced or displayed                   | Source                                                 |
| ----------------- | --------------------------------------------- | ------------------------------------------------------ |
| Login form        | Email field value and validation state        | Angular reactive form control                          |
| Request result    | Sent, rate limited, or service error state    | Generated SDK response status                          |
| Check inbox state | Entered email display, if shown               | Current form value only, never persisted               |
| Callback complete | Authenticated session state and user identity | `GET /api/v1/auth/session` response and browser cookie |
| Callback error    | Generic failure message                       | Fixed UI copy, no token or server detail               |
| Continue action   | Workspace navigation target                   | Fixed route `/`                                        |
| Retry action      | Login navigation target                       | Fixed route `/auth/login`                              |

**Key invariants**:

- The browser never writes magic token or session cookie values to JavaScript storage.
- Generic sent and callback error copy never reveals whether an account exists or why a token failed.
- A submit action is disabled while the request is pending and can be retried after a terminal error.
- The email field has a persistent label, validation message, and invalid state tied through accessible markup.
- Dynamic status uses a polite status region. Validation and service failures use an alert region.
- Mobile layout is one column with no horizontal overflow and touch targets at least 44 by 44.

**Security model**:

The UI treats the auth API as the source of truth. It does not inspect or decode the session cookie. It does not place token values in analytics, route state, local storage, or visible content. The callback error page uses fixed copy and never displays query parameters. Logout delegates revocation to the API.

**Configuration required**:

- `PUBLIC_API_URL`: browser API base URL used by the generated SDK.

## Design direction

- Existing Avenir Next and Georgia typography remain the source of truth.
- Desktop auth uses a restrained two column layout, form content on the left and a quiet system context panel on the right.
- Mobile collapses to one column and removes the context panel.
- Use the existing ink, muted, line, paper, teal, and coral tokens. No purple palette, decorative blobs, or external imagery.
- Use semantic form, button, heading, status, and alert elements. Use icons only when they clarify status or navigation.
- Keep headings compact for this tool surface. Do not use marketing hero copy.

**Critical test scenarios**:

- Happy path: enter valid email, submit, see generic check inbox state, verifies **AC-1**, **AC-2**, **AC-3**.
- Rate limit: API returns 429, show actionable rate limited state without account detail, verifies **AC-2**.
- Callback success: open complete route, check session, show success and continue action, verifies **AC-4**, **AC-5**.
- Callback failure: open error route, show generic error and retry action without query token, verifies **AC-4**, **AC-8**.
- Accessibility: keyboard through field and action, submit invalid form, observe linked alert or status, verifies **AC-6**.
- Responsive: render desktop and mobile widths, verify one column mobile and no horizontal overflow, verifies **AC-7**.

## Build plan

1. Add Angular auth routes and route level components for login, callback complete, and callback error, satisfies **AC-1**, **AC-4**, **AC-7**.
2. Add auth API client configuration and login form state machine using the generated SDK, satisfies **AC-2**, **AC-3**, **AC-5**, **AC-8**.
3. Add shared auth shell, labeled field, status notice, callback result panel, design tokens, and responsive styling based on the existing UI, satisfies **AC-1**, **AC-4**, **AC-6**, **AC-7**.
4. Add Angular component and route tests for success, rate limit, error, callback, cookie session, keyboard semantics, and mobile overflow, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**.

## Consequences

**Positive**:

- Login and callback URLs are deterministic and directly testable.
- Auth UI follows the existing operations console instead of introducing a second visual language.
- Sensitive token and session values remain owned by the browser and API boundary.
- The generated SDK remains the client contract.

**Negative / tradeoffs**:

- The root shell needs a later session aware dashboard transition.
- Component and route tests need a browser test harness that the current Angular scaffold has not fully configured.
- The UI cannot show account specific delivery detail because enumeration protection is intentional.

**Neutral**:

- No external images or design tool assets are required.
- MFA, SSO, tenant selection, and user administration remain outside this UI feature.

## Follow-up

- [ ] Connect the session success action to the first authenticated workspace route when that route exists.
- [ ] Add a separate UI design system spec if more screens need tokens beyond the current shell.

## References

**Project sources**:

- `apps/web/src/app/app.html` and `apps/web/src/app/app.scss`, current operations console visual language.
- `apps/web/src/app/app.routes.ts`, current empty route configuration.
- `packages/angular-sdk/src/generated`, generated gateway client contract.
- `docs/specs/0003-auth-magic-link-session/index.md`, auth API and security behavior.
- `apps/web/AGENTS.md`, Angular implementation and accessibility conventions.

**Practices & standards**:

- Semantic form accessibility and visible focus states.
- Browser credential isolation using HttpOnly cookies.
- Generic authentication messaging to prevent account enumeration.
