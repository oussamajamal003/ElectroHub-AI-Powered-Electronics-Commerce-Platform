# Task 06.2: Delivery Notifications card, mail-drain workflow, and verification of themes, alerts, email and push

Recorded 2026-11-14 on `feature/06.2-accessibility-qa-ci-cd` (PR #51 into `develop`), on top of `bae8b7ea`. Local machine: Windows 11, Node 22.19.
Every result below was observed in this run. Anything not observed is labelled NOT VERIFIED.

## Scope of this change

Theme isolation and per-category alert acknowledgement were already on the PR branch (`c4b1eca8`, `80f31358`, `f6db8079`) when this work was integrated, so this change does not touch them; it re-verifies them. This change adds:

| Area | Behaviour now | Where |
| --- | --- | --- |
| Delivery Notifications card (My Account) | States: On, Available, Blocked in browser, Unavailable, Not supported here, and "could not be checked". The control stays disabled while the backend reports push unavailable. "Check again" re-reads the server and announces the result. The browser permission prompt opens only from the Enable button, never on load. | `apps/frontend/src/features/notifications/DeliveryNotificationPreferences.tsx`, `.module.scss`, `.test.tsx` |
| Browser tests for the card | 390 px and 1440 px: enable from the keyboard and turn off; backend-unavailable with Check again; browser-level block. Light and dark captures. A stalled page now reports the requests still pending. | `apps/frontend/tests/notifications/customer-notifications.spec.ts` |
| Mail-drain workflow | `npm run dev:stack:supervised:email`, `npm run dev:stack:restart:email` and root `npm run notifications:doctor`. `npm run dev:stack:status` now says when events are queued but not sent and names the command. No send permission, allowlist or default was widened. | `package.json`, `scripts/dev-stack.cjs`, `scripts/dev-stack.test.cjs`, runbook and development-runtime docs |
| Out-for-delivery email button | New test: one "View Order Details" button whose link is `/orders/<reference>` on the validated origin, in the HTML and the text part. | `apps/backend/src/emails/commerce/__tests__/render.test.ts` |

## Alerts panel width (decided 2026-11-14: widen to 460 px)

The owner chose the 460 px panel. `.alertsMenu { width: 28.75rem }` (`AdminLayout.module.scss`, applied only to the alerts menu, not the profile menu) fixes the width; the existing `.menu` cap of `100vw - 2rem` keeps it inside narrow viewports. The former test "keeps its original compact width" is replaced by "the alerts panel is 460px wide and stays inside narrow viewports" and the `playwright.critical-four.config.ts` filter was updated to match.

| Viewport | Measured (Chromium and WebKit) | Capture |
| --- | --- | --- |
| 1440x900 | 460.0 px, right-aligned under the bell, no page overflow | `apps/frontend/test-results/alerts/alerts-menu-1440.png` (inspected) |
| 390x900 | 358.0 px (viewport minus a 16 px gutter each side), no page overflow | `apps/frontend/test-results/alerts/alerts-menu-390.png` |

Longer footer copy now wraps instead of stretching the panel (asserted in the same test). The admin reference screenshot was still not supplied, so the width follows the stated 460 px figure; comparison against that screenshot remains **NOT VERIFIED**.

## Why mail was not arriving in development (read-only investigation)

- `npm run dev:stack:status`: frontend, backend, database, payment supervisor, Stripe listener and Socket.IO READY; `Commerce email worker: DISABLED BY APPROVED POLICY (disabled-by-default)`. The running stack was started without the email worker, so nothing drains the outbox.
- `npm run notifications:doctor`: producer on, dispatch on, send mode `allowlist` with 2 recipients, origin configured, schema ok. Queue: `READY 31`, `ACCEPTED 16`, `staleNeedingReview 26` (older than 24 h, never sent automatically), `allowlistExcluded 5` (every fresh READY row is for a recipient outside the development allowlist), oldest due about 14 days.
- Conclusion: events are being enqueued. They are not sent because no worker is running, and the fresh ones would be held anyway because their recipients are not allowlisted. This is the designed safety behaviour, not a code defect. No row was replayed, no worker was started against the shared database, and no mail was sent during this work.
- Push: doctor reports `enabled: false, configured: false`. "Unavailable" on the Account card in development is missing push configuration (no valid VAPID settings), not a code defect; the control correctly stays disabled.

| Claim | Status |
| --- | --- |
| Event enqueued (welcome on verification, out-for-delivery on the committed transition) | VERIFIED for existing rows via doctor counts |
| Worker ready | NOT VERIFIED (worker deliberately not started; needs an approved allowlist run) |
| Provider accepted | NOT VERIFIED in this run (16 historical ACCEPTED rows exist) |
| Provider delivered | NOT VERIFIED |
| Inbox received | NOT VERIFIED (no approved test mailbox was provided) |
| In-tab real-time update and push receipt authorization against a real database | NOT VERIFIED locally (see `delivery-pg` below); covered by the CI delivery suite |
| OS push toast with the tab closed | NOT VERIFIED |

Welcome email on re-registration: the key is `customer:<userId>:welcome` and account deletion anonymises the old row, so a re-registered address is a new user id and gets its own single welcome. The existing integration test "deleted email re-registration creates a new verified identity and independent welcome delivery" covers it; no code change was needed. That test could not connect locally (below) and runs in CI.

## Commands and results

Frontend (`apps/frontend`)

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors, 5 pre-existing warnings |
| `npm test` | 192 files, 1650 tests pass |
| `npm run build` | pass |
| `npx playwright test -c playwright.notifications.config.ts --project=chromium --project=webkit` | 10/10 pass (30/30 with `--repeat-each=3` before the rebase onto `bae8b7ea`) |
| `npx playwright test -c playwright.critical-four.config.ts --project=chromium --project=webkit scoped-themes admin-alerts-badge` | 8/8 pass: two-tab customer/admin theme isolation, per-category acknowledgement, failed-acknowledgement rollback, 460 px panel width (re-run after the width change) |

Backend (`apps/backend`) and root

| Command | Result |
| --- | --- |
| `npx tsc --noEmit`, `npm run lint`, `npm run build` | pass |
| `npx vitest run` on email render, admin routes and alert acknowledgement | 194 tests pass |
| `npm run test:runtime` (root) | 51/51 pass |
| `npm run test:ci` | NOT a valid local result: 318 failures from local environment gates (`DATABASE_TEST_TARGET_REQUIRED`, payments disabled) and timeouts while the dev stack was running. CI runs it on a disposable database. |
| `node scripts/delivery-pg.cjs` | 40 pass, 11 fail. All 11 are `customer-notifications.postgres.integration.test.ts` failing to connect ("self-signed certificate") on this machine. The file is unchanged and runs in CI. |
| `node scripts/commerce-email-pg.cjs` | did not start: local PostgreSQL has no pgvector for migration `20261024000000_ai_vector_search` |

## Visual QA

The customer Account screenshot and the admin alert screenshot named in the task were not attached to the session and are not in the repository, so comparison against them is **NOT VERIFIED**. The captures below were inspected directly.

| Capture (under `apps/frontend/test-results/notifications/`) | Viewport | Observed |
| --- | --- | --- |
| `push-preferences-available-1440.png` | 1440x900 | "Available" badge, primary Enable button, card inside the viewport |
| `push-preferences-unavailable-1440.png` | 1440x900 | "Unavailable" badge, explanatory notice, Enable disabled, "Check again" present |
| `push-preferences-on-390-dark.png` | 390x900, dark | "On" badge, full-width "Turn off notifications", no horizontal overflow |

Firefox cannot launch on this machine (`browserType.launch: spawn UNKNOWN`), so Firefox is NOT VERIFIED locally; CI runs the notifications spec on all three engines.

## Follow-up closed on 2026-11-14

- **Notifications spec stall: cause established.** Reproduced deliberately with `--workers=8 --repeat-each=6` on Chromium and WebKit (31 of 60 failed). Every failure listed only static build assets as pending (`/assets/AccountPage-*.js`, its CSS and its lazy dependencies) and no `/api/` request: under CPU saturation the lazy Account chunk does not finish loading within the 20 s wait. It is load starvation of the browser and the single `vite preview` process, not a card or fixture defect. At the configured `workers: 1` (what CI uses) the spec passed 10/10 after this change and 30/30 earlier.
- **Duplicate "On" text removed.** A successful enable or turn-off no longer adds a second message; the status line, a live region, already states the new state.
- **Two local edits committed** as their own commits: the admin route first-load loader in `apps/frontend/src/routes/index.tsx` (typecheck, lint and the 1650 unit tests pass with it; no browser test was run for it) and the supervised-restart section of `TASK_06.2_RUNTIME_RELIABILITY_EVIDENCE.md` (recorded by its author, not re-verified here).
