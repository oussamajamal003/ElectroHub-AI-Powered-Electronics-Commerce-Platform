# Task 06.2 — Critical four packages: scoped themes, contact delivery, alerts, profile photo

Status vocabulary: **PASS** (evidence below), **FAIL**, **NOT VERIFIED** (not run or not reachable here), **NOT APPLICABLE**.
This report covers four packages only. It does **not** complete Phase 06.2.

All results are local runs on Windows 11 (Chromium and WebKit through Playwright; Firefox cannot launch on this machine: `spawn UNKNOWN`).
WebKit is Playwright's WebKit build, not physical Safari or iOS.

## 1. Starting branch and SHA — PASS
- Started on worktree branch `fix/06.2-ux-functional-bugfix`; the final integration is local branch `integrate/06.2-critical-four`, pushed fast-forward to PR #51's head. When this task started, PR #51's head was `ed65b9e9`.
- PR #51 then advanced to `36f5bf52` and to `e64af2af` (a parallel premium checkout-processing, description-layout and account-skeleton commit). This work is rebased onto `e64af2af`; where `e64af2af` and this work designed the same screen (processing card, Product Description), the remote design was kept (owner decision: "Keep remote's designs").
- Codex had started the same four packages in `.cache/critical-four-packages` (branch `codex/06.2-theme-contact-alerts-photo`) and left them uncommitted. That work was preserved as local commit `9517179b`, then taken over and finished here (user decision: "Take over from Codex").

## 2. Shared-theme root cause — PASS
`theme-init.js`, `themePreference.ts` and `ThemeProvider.tsx` used one key, `electrohub:theme`, and the provider synchronised that key across every tab. Choosing dark in the storefront therefore also turned the admin console dark, and the reverse.

## 3. Scoped-theme architecture — PASS
- Keys: `electrohub:theme:customer` and `electrohub:theme:admin`. Only explicit choices are written.
- Scope comes from the route segment: `/admin` and `/admin/...` are admin; `/administrator-help` is customer. The same regex `^/admin(?:/|$)` is used in `theme-init.js` and in `themePreference.ts`.
- There is still one `ThemeProvider`, now inside `BrowserRouter`, and one `<html data-theme>`. The provider keeps both scope choices in state, and SPA navigation applies the destination scope's choice **without writing it** to the other scope.
- A `storage` event updates only its own scope; the active document changes only if that scope is the active one. `key === null` (storage cleared) resets both scopes to the system preference.
- System-preference changes apply only to scopes that have no explicit choice.

## 4. Storage-key migration — PASS
A valid legacy `electrohub:theme` value is copied to the **customer** scope once, unless a valid customer value already exists (an explicit scoped value wins). The legacy key is then removed and never read again. Invalid legacy values are discarded. The admin scope starts from the system preference.
Evidence: `ThemeProvider.test.tsx` "consumes a valid legacy preference only for customer and never overrides an explicit scoped choice".

## 5. Pre-paint initialization — PASS
`public/theme-init.js` is still a render-blocking, same-origin classic script (CSP `script-src 'self'`). It migrates the legacy key, reads the key for the current route's scope, falls back to `prefers-color-scheme`, and sets `data-theme` before React loads.
Evidence: `scoped-themes.spec.ts` delays `src/main.tsx` by 1 s and loads `/admin/login` with `waitUntil: 'commit'`; `data-theme` is already the admin value, which differs from the customer value in the same browser.

## 6. Cross-tab test evidence — PASS (Chromium, WebKit) / NOT VERIFIED (Firefox)
`tests/visual/scoped-themes.spec.ts` uses one browser context with four real tabs (two customer, two admin) and a second, isolated context:

| # | Theme matrix item | Evidence | Status |
|---|---|---|---|
| 1–4 | Customer/Admin light/dark in all four combinations | `check()` asserts every tab after each toggle. Screenshots `customer-light-admin-light`, `customer-dark`, `admin-light`, `admin-dark`, `customer-light-admin-dark` | PASS |
| 5, 6 | One scope's toggle does not affect the other | same spec | PASS |
| 7, 8 | Hard reload of the customer and admin tabs | `Promise.all([page.reload(), admin.reload()])` | PASS |
| 9, 10 | Two customer tabs sync; two admin tabs sync | peer tabs follow through `storage` events | PASS |
| 11 | Customer and admin tabs stay isolated | same spec | PASS |
| 12 | Same-tab cross-scope navigation | `history.pushState` + `popstate` (BrowserRouter POP) to `/admin/profile` and back | PASS |
| 13 | System-theme fallback | unit tests "uses the system preference…", "follows system changes until the user chooses" | PASS |
| 14 | Storage unavailable | unit tests "falls back safely when storage or matchMedia throw", "still switches (without persisting) when storage writes are blocked" | PASS |
| 15 | Invalid stored values | `dark-mode.visual.spec.ts` "an invalid stored value falls back…"; unit tests | PASS |
| 16 | Legacy migration | unit test (§4) | PASS |
| 17 | Direct admin login route | pre-paint check on `/admin/login` (§5) | PASS |
| 18, 19 | Customer and admin logout | Code inspection only: logout removes auth-cache keys (`AuthContext.tsx`), never theme keys. No browser logout run. | NOT VERIFIED |
| 20 | Radix dialogs and portals | `playwright.dark-mode.config.ts` (Chromium): portal/dialog tests pass. The run is 43/46; the 3 failures (320 px toggle 30 px < 32 px, dark `/account`, dark `/about` `eyebrowDark` contrast 3.35:1) fail identically at `e64af2af` without this work | PASS |
| 21 | Toast surfaces | No dedicated scoped-theme toast assertion | NOT VERIFIED |
| 22 | Profile-photo dialogs | `task06-2-account-privacy.spec.ts` responsive matrix runs light and dark, including `/account/profile` and `/admin/profile` | PASS |
| 23 | Checkout screens | `StripePaymentSession.test.tsx` (Elements follow the theme, no remount). The `processing-premium.spec.ts` dark matrix was dropped with that design; the `e64af2af` processing panel has no scoped-theme browser assertion here | PARTIALLY VERIFIED |
| 24 | Reduced-motion mode | the scoped spec runs with `reducedMotion: 'reduce'` | PASS |

WebKit needed about 110 s for the four-tab spec on a cold Vite dev server, which exceeded the 120 s config limit in the first combined run. The spec is now marked `test.slow()`, and it passed in WebKit on its own.

## 7. Contact form root cause — PASS (recipient) / NOT VERIFIED (live inbox)
- **Observed (read-only):** an unauthenticated `GET http://localhost:3000/api/store/profile` returned `"supportEmail": null`. The server refused before calling Brevo and returned the same generic `CONTACT_UNAVAILABLE` as a provider outage, so the UI could not say what was wrong.
- **Reproduced in isolation:** the captured-provider route test returns 503 for a missing recipient; nothing is sent.

## 8. Configured recipient behavior — PASS, with a reported contradiction
- **Destination:** `StorefrontContactService.deliver()` sends to the Store Settings `supportEmail` when it is a valid address, and does not query administrators at all in that case.
- **Contradiction, not silently resolved:** a parallel commit on PR #51, `820c8ccc` ("route contact to verified MFA admins"), routes contact to active, email-verified, MFA-enrolled administrators instead. That contradicts this task's rule "do not silently route customer messages elsewhere". The reconciliation keeps both behaviours:
  - the configured mailbox is used first;
  - the verified-administrator route (one provider request, private Bcc) is used **only** when no valid mailbox is configured;
  - that fallback is not silent: it logs the operator event `contact.fallback_administrators`, without addresses, and Admin → Settings says so beside the Store email field.
- **Unconfigured:** with no mailbox and no eligible administrator, the response is 503 `CONTACT_NOT_CONFIGURED`, and the UI says the support inbox is not set up and keeps the typed message.
- **Owner decision needed:** whether the administrator fallback should remain. Making delivery strict (mailbox only) is a one-line change in `deliver()`.
- **Kept protections:**
  - the recipient never comes from the request;
  - the sender stays the configured trusted sender;
  - the customer appears only as Reply-To (`oneLine` strips CR/LF);
  - HTML is escaped and a plain-text copy is included;
  - validation, honeypot and 5/min rate limit are unchanged;
  - logs carry categories and provider codes, never addresses or message text.

## 9. Email-provider verification — PARTIALLY VERIFIED
- The Brevo payload is checked through the capture outbox (`.invalid` recipients only; nothing is sent) and through service and route tests.
- **No duplicate sends:**
  - every contact send carries a deterministic `idempotencyKey` in the Brevo `headers` object: a UUIDv5-style SHA-1 over the recipients, store name and message;
  - Brevo rejects a reuse within 30 minutes with `duplicate_parameter`, and that rejection is treated as already accepted;
  - the frontend button is disabled while a send is pending.
- **Real Brevo inbox delivery: NOT VERIFIED.** No uncontrolled live email was sent. `critical-contact-capture.spec.ts` needs the task-owned disposable browser harness (`CRITICAL_CAPTURE_CREDENTIALS`); it was not available here, so the spec skipped.

## 10. Admin alerts: existing behavior — PASS
Before this work, opening the bell marked everything read, the label ignored Out for delivery, and "See all alerts" widened the menu.

## 11. Four-category acknowledgment — PASS
- **Opening the bell acknowledges nothing.** Clicking a category acknowledges only that category, then navigates to its filtered queue. This applies to Out of stock, Low stock, Paid orders awaiting fulfillment and Out for delivery.
- **Badge:** the unread total is the sum of the four unread counts. The "no unread" label now counts all four operational categories (it previously omitted Out for delivery).
- **Atomicity:** each acknowledgement is a single statement per category:
  ```sql
  INSERT .. ON CONFLICT ("userId","category") DO UPDATE
    SET "acknowledgedCount" = LEAST(current, GREATEST(stored, seen))
  ```
  A stale tab therefore never lowers a larger baseline, and the stored baseline never exceeds the live count. Clamping at read time uses a guarded `updateMany` (`acknowledgedCount > live`), so it never overwrites a concurrent acknowledgement.
- **Frontend:**
  - optimistic per-category update, with rollback and an inline error on failure;
  - mutations are serialised (`scope: admin-alert-acknowledgement`);
  - invalidation runs after each settle.
- **Per-administrator isolation:** rows are keyed by `userId`; covered by unit and PostgreSQL tests.
- **Known limitation (investigated):** the baseline is a count, not event identity. If one item resolves and a different item appears **between two reads**, the count is unchanged and the replacement is not reported as new. When a read happens in between, the read-time clamp lowers the baseline and the new item is reported. The bell refetches every minute, which narrows the window but does not close it. Closing it fully requires stable event identity, i.e. per-item acknowledgement rows. That is a schema change beyond this task, so it is recorded as a risk (§21).

## 12. Dropdown width restoration — PASS
`git log -L` shows `.menu { min-width: 18rem; max-width: calc(100vw - 2rem) }` unchanged since `628e2567`. The regression came from content: the long footer sentence in `c95b6d35` and the "See all alerts" row stretched the menu to 688 px at 1440 px.
- **Now:** 368 px at 1440 px and 358.1 px at 390 px once the menu has settled, inside the viewport. Its entrance animation (`perspective` + `rotateX`) briefly widens the box (360.5 px was measured mid-animation in WebKit), so the spec now measures after the menu's animations finish. The spec also proves that restoring the old footer copy alone stretches the menu to 688 px.
- **Codex's guess:** its fixed `.alertMenu { width: 18rem }` had no historical basis and was not wired in, so it was dropped.

## 13. Profile photo: previous UI defects — PASS
- **Reported text:** "Use the camera button to manage it." and a visible "No file chosenNo file chosen". That text came from `95fd1da2` and was removed by `df03ce76`; the committed code at the start of this task already hid both native inputs.
- **Why the user still saw it:**
  - `:3000` is the Vite dev server that `scripts/dev-stack.cjs` starts from the **main checkout**, which only shows committed and pulled code, never another worktree's uncommitted changes (Codex's work was uncommitted);
  - the main checkout also holds a stale `apps/frontend/dist` (built 17:31) whose `ProfilePhotoManager-*.js` still contains the removed copy.
  - The dev server was not running when this was checked, so the exact bundle served to the user could not be observed.
- **Operator action:**
  1. pull PR #51 in the main checkout;
  2. restart the dev stack;
  3. hard-refresh the browser;
  4. rebuild `dist` if it is served anywhere.

## 14. Reuse of the existing image manager — PASS
No new system. The existing `ProfilePhotoManager` (shared by customer and admin) keeps its upload, camera, replace, remove, signed-URL refresh and private storage paths. The helper text is now exactly "JPEG, PNG or WebP · Maximum 5 MB". Both native inputs carry `hidden`; the buttons are the only visible triggers.

## 15. Preview popup — PASS
Clicking a saved avatar opens a Radix dialog with a title, a description (the name), focus trap, Escape and close button, and "Change photo". The camera/edit control opens the action menu. With no saved photo, the avatar opens the upload path instead of a preview. A broken or expired signed URL falls back to initials.
Evidence: `task06-2-account-privacy.spec.ts` "admin/customer: menu, upload, header sync, preview dialog, remove" and "broken or expired signed URL…" (Chromium, WebKit), plus `ProfilePhotoManager.test.tsx` 14/14.

## 16. Browser screenshots — PASS (captured locally)
Captured by the specs into `apps/frontend/test-results/` (not committed: they are regenerated on every run and contain only fixture data):
- theme combinations: `critical-four/scoped-themes-*/customer-light-admin-light.png`, `customer-dark.png`, `admin-light.png`, `admin-dark.png`, `customer-light-admin-dark.png`;
- alerts menu: `alerts/alerts-menu-1440.png`, `alerts/alerts-menu-390.png`;
- profile photo: `critical-four/task06-2-account-privacy-*`;
- contact states: `motion-contact/contact-*.png`.

## 17. Changed files — PASS
Commits on PR #51 (see §22): alerts and contact (`admin-dashboard.service.ts`, `storefront-contact.service.ts`, `storefront.controller.ts`, `brevo.provider.ts`/`types`, `AdminLayout.tsx`, `dashboard/api.ts`, `StoreSettingsForm.tsx`, `ContactPage.tsx`, OpenAPI), themes (`theme-init.js`, `features/theme/*`, `App.tsx`, `DARK_MODE.md`), profile photo (`components/profilePhoto/*`), and their tests and specs.

## 18. Test commands and counts
| Check | Command | Result |
|---|---|---|
| Backend typecheck / lint / build | `npx tsc --noEmit`, `npm run lint`, `npm run build` | PASS |
| Backend unit | `npx vitest run` (excluding DB/`.env` suites) | 2324 passed, 45 skipped, 8 timed out while the frontend suite ran in parallel (`logging-continuity`, `swagger`, one `payment.service` runtime test). Those 3 files pass alone: **188/188** |
| Alerts on disposable PostgreSQL | `npm run test:admin-security:pg` | **108/108 PASS**, including the new concurrent stale-tab test |
| Frontend typecheck / lint | `tsc -p tsconfig.app.json`, `npm run lint` | PASS; 0 errors, 5 pre-existing warnings |
| Frontend unit | `npx vitest run` | **1643/1645** (192 files). The 2 failures are `AdminProductFormPage.test.tsx` (not touched here): it also fails at `e64af2af` and passes alone 15/15. The later `viteServerConfig.test.ts` addition passes 15/15. **After the final rebase onto `abb5728f`: 1647/1647 PASS** (192 files) |
| Frontend build | `vite build` | PASS |
| Critical four (themes, alerts, photo, responsive, axe) | `npx playwright test -c playwright.critical-four.config.ts --project chromium --project webkit` | **43 passed, 2 skipped** (capture harness), 1 WebKit width failure measured mid-animation; it was fixed in the spec and then passed (see §12). **After the final rebase onto `abb5728f`:** 42 passed, 2 skipped, 2 failed on `page.goto` timeouts while the dev server reset connections (`ECONNRESET`); both (`/account` Chromium, `/admin/settings` WebKit responsive matrix) passed with `--last-failed` |
| Motion / contact / alerts | `npx playwright test -c playwright.motion-contact.config.ts` (+ `MOTION_BROWSER=webkit`) | Chromium **47/47**. WebKit **46/47** after the timing fixes: the remaining failure ("failed acknowledgement rolls back") passed 3/3 with `--repeat-each 3`. The fixes were waiting for the lazy route, ignoring 0.01 ms reduced-motion transitions, and measuring the settled menu |
| Checkout harness (recovery UX, failed-payment dismissal, payment processing, retry, scenarios, success sync, 03.6) | `CHECKOUT_PORT=3125 VITE_STRIPE_PUBLISHABLE_KEY=pk_test_intercepted_fixture npx playwright test -c playwright.checkout.config.ts <9 files>` | All pass except 8 tests in `checkout.spec.ts` and `payment-processing.spec.ts`. At `e64af2af` the same two files fail **9** (those 8 plus "setup failure cannot authorize"): pre-existing, not regressions |
| `e64af2af` description layout + account skeletons | `npx playwright test -c playwright.task06-2-description-skeletons.config.ts` (+ `DESCRIPTION_SKELETONS_ALL_BROWSERS=1 --project webkit`) | Chromium **28/28**, WebKit **28/28**; Chromium **28/28** again after the rebase onto `abb5728f` |
| Dark-mode route coverage | `npx playwright test -c playwright.dark-mode.config.ts --project chromium` | 43/46; the 3 failures are pre-existing at `e64af2af` (§6 item 20) |

## 19. CI results — NOT VERIFIED at time of writing
This report is part of the push that triggers CI, so it cannot contain that run's result. The final-SHA CI status is reported in the PR #51 update.

## 20. Concurrent branch reconciliation — PASS
- **Integration:** PR #51 advanced four times during this task: to `ed65b9e9`, to `36f5bf52` (`5b088f98` payments, `820c8ccc` contact routing and runtime doctor, `36f5bf52` roadmap), to `e64af2af` (parallel premium checkout processing, description layout, account skeletons), and finally to `abb5728f` (`AdminShellFrame` extraction for administrator account pages; one import conflict in `AdminLayout.tsx`, resolved by keeping the alert-category import and dropping the navigation import that moved to `AdminShellFrame`). Each was integrated by a normal rebase; nothing on the remote was overwritten, and the push is fast-forward only.
- **`e64af2af` overlap:** the remote `PaymentProcessingPanel` and Product Description layout were kept. This work's processing card, stages, slow hint and description layout were dropped together with their specs (`processing-premium.spec.ts`, `product-description.spec.ts`). The server-gated Cancel is kept as a `cancelAction` slot in the panel's actions, and the remote's unconfirmed-payment wording is kept.
- **Vite cache isolation (found while verifying):** every Playwright `webServer` ran Vite in the same checkout with one shared `node_modules/.vite`. That overwrote the dependency chunks the long-running :3000 server was serving, and the browser then hit "Invalid hook call" in Radix `SelectProvider` (reproduced on `localhost:3000/products`). Non-default dev ports now use `node_modules/.vite-port-<port>`. Verified on :3271: separate cache created, Sort select opens, no hook errors. The running :3000 server still needs one restart.
- **Conflict resolution:**
  - contact service and tests were combined (§8);
  - the Brevo capture outbox keeps the remote's per-recipient Bcc files and gains the idempotency header;
  - Codex's work was taken over file by file, with the verified implementation kept where both had changed the same code.
- Codex's mojibake middle dot was not adopted.

## 21. Remaining material risks
1. Contact routing is an owner decision (§8): supportEmail first, administrator fallback logged. It is not strict "mailbox only".
2. Real Brevo inbox delivery is not verified; capture-harness E2E skipped.
3. Count-baseline alerts cannot detect a same-count replacement between two reads (§11).
4. Firefox is not verified (does not launch here); WebKit is not physical Safari.
5. Theme matrix items 18, 19 and 21 are not verified in a browser.
6. Pre-existing failures that this work did not introduce (each confirmed at `e64af2af`): 8 checkout-harness tests in `checkout.spec.ts`/`payment-processing.spec.ts`, 3 dark-mode route tests, and the `AdminProductFormPage` unsaved-changes flake.
7. The unknown/unconfirmed payment wording is the `e64af2af` copy ("We couldn't confirm your payment yet" / **Check again**). It does not match the wording requested in the A–F bugfix task ("We're still checking your payment" / **Check payment status**). Owner decision.
8. Checkout screens (theme item 23) have no browser-level scoped-theme assertion for the `e64af2af` processing panel.

## 22. Final commit SHA
Reported in the PR #51 update (this file is inside the commit).

## 23. Existing PR #51
https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/51. Updated in place; no new PR, no merge, no deployment.
