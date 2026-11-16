# Task 03.6 — Scenarios 2–6 frontend UI/UX + Chromium quality gate — 2026-10-15

## A. Executive summary

FRONTEND workstream handoff for independent Principal Architect review. No approval score is self-assigned. Nothing was staged, committed, pushed, merged or deployed.

Branch `feature/Stripe`, HEAD `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`. The working tree already held ~315 uncommitted paths from other workstreams; this report certifies only the task-owned hunks listed in §B. Pre-change copies and SHA-256 values: `.cache/scenarios-2-6/before/`.

Five reproducible customer-facing defects were found in Chromium and fixed. The most material one: **Checkout B opened pre-filled with submitted Purchase A's shipping address and delivery method**, so B's summary showed A's Express shipping before the customer chose anything.

Final evidence:

- New Scenarios 2–6 Chromium suite: **37/37 PASS**.
- Scenario 1 combined regression: **36/36 PASS**.
- Focused Vitest suites pass.
- Typecheck, scoped ESLint, build and diff check all exit 0.

Two pre-existing, unrelated failure sets are reported in §I.

Evidence category for every browser result: **A — real Chromium + real production React build (Vite preview), all `/api/**` and Stripe.js intercepted.** B (real backend reads), C (real PostgreSQL) and D (real Stripe) were **NOT TESTED**. No PaymentIntent, card submission, webhook, worker, DB write or remote operation occurred.

## B. Changed-file manifest (task-owned hunks only)

| File | Δ | Purpose |
|---|---|---|
| `apps/frontend/src/features/checkout/state.ts` | +7 | `draftWasSubmitted()`. `detachDraft` resets a submitted or unconfirmed draft to `newDraft()`. An unsubmitted draft keeps its fields. |
| `apps/frontend/src/features/checkout/CheckoutPage.tsx` | +11/−5 | Clean draft on mount after a submitted purchase. `dismissTerminal` and `clearTerminalBeforeLeaving` reset submitted drafts. `payment-purchases` is invalidated when Place Order / Check again settles. |
| `apps/frontend/src/features/checkout/PaymentPurchases.tsx` | +8/−5 | Payment toast viewport class. The acknowledgement-save error is now a dismissible error toast instead of a raw `<p>` injected above page content. Saved-purchase loading is announced via a visually-hidden status, and load/refresh errors use the existing `inlineNotice`. |
| `apps/frontend/src/features/checkout/Checkout.module.scss` | +12/−4 | One type scale for step actions (`.actions`, link-buttons, `.checkingActions` at 14px). Lock icon no longer shrinks in wrapped `.subtle`. Wider saved-purchase meta column at ≥1024px. `ol.paymentToasts` phone placement. |
| `apps/frontend/src/pages/customer/OrdersPage.tsx` | +45/−11 | Order cards built from shared `PaymentStatus`, `ProductImage`, `Skeleton`, `EmptyState` and `ErrorState`. The API contract is unchanged. |
| `apps/frontend/src/pages/customer/OrdersPage.module.scss` | +34/−1 | Order history card styles, using existing tokens only. |
| `apps/frontend/src/features/checkout/checkout.test.tsx` | +test | Draft isolation unit regression. |
| `apps/frontend/src/features/checkout/CheckoutPage.test.tsx` | +helper | Two Return-to-Cart tests now assert that the new checkout starts empty, then enter the address. All idempotency-key and confirm-count assertions are unchanged. |
| `apps/frontend/src/features/checkout/PaymentPurchases.test.tsx` | 1 assertion | The acknowledgement error is asserted as a dismissible notice (it was previously a raw `role=alert` paragraph). |
| `apps/frontend/tests/checkout/scenarios-2-6.spec.ts` | new | 37 customer journeys with screenshots. |
| `apps/frontend/playwright.scenarios.config.ts` | new | Owned preview on port 3146, `reuseExistingServer: false`, JSON report. |
| `apps/frontend/tests/checkout/scenario1-browser.spec.ts` | 1 assertion | Toast vertical bound is branched at <768px for the new phone placement. The ≥768px bottom-right assertion is unchanged. |
| `docs/05_Features/ORDERS.md`, `docs/05_Features/PAYMENT_CORE_03.6.md` | notes | Documented behaviour. |

No backend, Prisma, migration, AUTH, CartProvider, payment-service, shared `Toast`/`Button` primitive, CI or infrastructure file was edited.

## C. Root-cause register

| # | Reproduction (Chromium, intercepted) | Root cause | Fix | Regression test | Final |
|---|---|---|---|---|---|
| 1 | Submit A (Express, "Avery Purchase-A") → Home → add B → Checkout B: the Shipping form is pre-filled with A's address and the summary shows *Express $9.99 / $158.99*. Screenshot: `before/s2-1024-B-shipping.png`. | The cart-scope draft is keyed per user, not per purchase. `CheckoutDraftSession → detachDraft` dropped only `attempt`, so A's shipping and delivery seeded B. | `state.ts` `detachDraft` + `draftWasSubmitted`; `CheckoutPage` initializer, `dismissTerminal` and `clearTerminalBeforeLeaving`. | `checkout.test.tsx` "leaving a submitted purchase…"; S2 and S6 assert empty fields, *Standard Delivery*, $149.00. | FIXED |
| 2 | S3 at 390px: the A success toast fully covers B's **Review Order** (toast `y=716–820`, CTA `y=682–730`). Screenshot: `before/s3-390-toast-over-B.png`. | Bottom-anchored 390px viewport. Below 30rem the checkout actions stack full-width at the bottom. | `ol.paymentToasts` below the sticky header at <768px. Bottom-right is unchanged at ≥768px. | S3 at 390/768/1024/1280/1366/1920 asserts toast∩CTA = ∅ and placement. | FIXED |
| 3 | S3: `/orders` shows "Order Confirmed" as plain text — no Paid status, "Total: USD 58.99", no images. | Order history reused the sign-in card style with unformatted text. | `OrdersPage` rebuilt with existing shared components. | S3 "Paid" + $58.99 + View Order; "Orders history states" at 390/1024/1280. | FIXED |
| 4 | S5: lost reconcile → Home → Cart within 10 s shows **"Processing"**, although the server projection is UNKNOWN ("Awaiting confirmation"). | The list cache was refreshed only after `/submit`, before reconcile settled (10 s `staleTime`). | Invalidate `payment-purchases` in the `place()`/`check()` `finally` blocks. This is a read only, with no payment request. | S5 asserts *Awaiting confirmation*. | FIXED |
| 5 | Visual: 12px Buttons beside 16px link-buttons in step actions. The lock icon shrinks to ~8px when the summary note wraps. Failed-purchase cards were 240px tall with three-line copy. Saved-purchase loading/error states were unstyled `<p>` text. Acknowledgement failure inserted a raw paragraph above the page. | Local style gaps. | SCSS + `PaymentPurchases` (see §B). | Screenshot inspection; S3 ack-failure test asserts no layout shift and a dismissible notice. | FIXED |

Investigated but not reproduced (current source already correct):

- B total excludes A.
- Header badge counts the active Cart only.
- B owns a separate setup key and secret.
- No stale A error or Processing state appears in B.
- A's terminal result never redirects or clears B, or remounts B's Element.
- Decline → Try Again restores A's own snapshot without an empty-Cart screen.
- Failed purchases A and C keep separate contexts.
- UNKNOWN is never labelled Paid or Failed, and no resubmission occurs.
- Buy Now A stays independent of Cart B.

## D. Scenario results (category A)

| Scenario | Status | Proof (spec `scenarios-2-6.spec.ts`) |
|---|---|---|
| 2 — A processing, B checkout | **PASS** | 7 widths. Covers the full Product → Cart → Checkout A → Place Order journey, held reconcile ("Processing your order…"), Checking, Home → Wishlist → B → Add → Cart (pending A card with no actions, active B, summary $149.00, badge "Cart, 1 item") → clean B Shipping → Overnight → B payment ready → Review ($168.99, B address). Request checks: 2 setups with distinct keys; B body `{shipB, OVERNIGHT, revision b}`; 1 submit; 1 confirm; last secret `pi_B`; no console errors. |
| 3 — A succeeds while B open | **PASS** | 6 widths, plus Shipping/Review variants and acknowledgement failure. One toast, which closes after 5 s or immediately by X (one `/read`) and is not repeated after refetch or visibility events. The URL, step, mounted Element (mount count and typed card value), totals and focus are unchanged. The toast does not intersect the CTA. Orders shows A as Paid. |
| 4 — Declined payment | **PASS** | 5 widths, plus the A+C test. Payment Failed (no alert or toast duplicate) → Try Again → `/checkout?step=payment` with A's items, $58.99, recipient and Express. Back → Delivery/Shipping shows A's saved data → card entry. Only one `/resume`; no new setup or submit; secret `pi_A_retry`. Two failed purchases keep separate data; no Cart writes. |
| 5 — Unknown outcome | **PASS** | 4 widths, plus a later-DECLINED variant. "We couldn't confirm your payment yet" with no Try Again/Pay; a failed Check again stops loading. Cart shows *Awaiting confirmation* with no retry, including after reload. One setup, one submit and one confirm. A later PAID removes the card with one toast. A later DECLINED shows a toast on Home (no full-page failure) linking to Failed payments. |
| 6 — Buy Now independence | **PASS** | PAID at 5 widths; DECLINED and PENDING at 1280px. The Buy Now setup body is `scope: BUY_NOW`. Cart B starts with empty shipping and has no scope. A's late outcome shows only a toast (or nothing while pending): the URL and Element stay, there is no Payment Failed screen, the summary is $168.99 without A, the last secret is `pi_B`, and there is one submit. |

Shared Scenario 1 regression: **36/36 PASS** (`playwright.scenario1.config.ts`). This covers toasts, deduplication across tabs, UNKNOWN persistence, legacy routes, reduced motion and keyboard dismissal.

## E/H. Visual evidence actually opened

Directory: `docs/tasks/Phase-03/evidence/scenarios-2-6-20261015/` (`before/` 117 PNG, `after/` 142 PNG, `report.json`, logs).

Opened and inspected at native resolution:

- **Before:** S2 1280 Cart (pending A + B) and Checking; S2 1024 Shipping (defect 1) and Payment; S3 390 (defect 2) and 1280 toast; S4 1280 Payment Failed, retry context and Cart failed A+C; S4 1024 restored Shipping; S5 1280 unconfirmed; S2 390 Cart.
- **After:** S2 1280 B Shipping (empty, Standard, $149.00); S3 390 toast below header with CTA clear; Orders 1024 and 390 lists; S3 1280 Orders Paid; S4 1280 Cart failed (two-line copy, shorter cards); S5 1280 unconfirmed (14px button).

Not every one of the 142 PNGs was individually opened. The geometry assertions (no overflow, element-in-viewport, toast/CTA intersection) run at every captured width.

Known remaining visual note: at 1280×720 the bottom-right toast overlaps the summary's Total row for up to 5 s. It does not cover any action or input. This was left as designed.

## F. Small-browser results

- **1024 / 1280 / 1366:** all S2–S6 journeys pass with no horizontal overflow; primary CTAs are inside the viewport and never under the toast.
- **390 / 768 / 1440 / 1920:** S2 at all of them; S3 at 390/768/1920; S4/S6 at 390/1920; S5 at 390.
- The owner's real browser content viewport and 200% zoom were **NOT VERIFIED** (no authorized local browser session was measured).

## G/I. Commands and results (run from `apps/frontend`)

| Command | Result |
|---|---|
| `npx playwright test -c playwright.scenarios.config.ts --workers=1` | **37 passed, 0 failed, 0 flaky, 0 skipped**, exit 0, 12.0 min. |
| `npx playwright test -c playwright.scenario1.config.ts --workers=1` | **36 passed**, exit 0. |
| Adjacent specs (temporary config, since removed): `payment-retry`, `payment-session-isolation`, `payment-processing`, `payment-recovery` | **26 passed**. |
| Adjacent spec `payment-recovery-ux` | **9 failed**. Pre-existing and stale: it asserts copy absent from all source ("Checking your payment status…", "Your cart has been preserved…") and expects a populated Cart after its own harness empties it on submit. No file it exercises was edited by this task. Owner: FRONTEND spec maintenance. |
| `npx vitest run` (full frontend) | **627 passed, 2 failed**. `Select` "opens options list" and `Tooltip` "shows content on hover" hit 60 s timeouts. Both components are unmodified (clean `git status`); `Select` also fails in isolation. |
| Focused Vitest (checkout, Cart, Orders, Toast) | All pass. |
| `npm run typecheck` | Exit 0. |
| Scoped `eslint --max-warnings 0` (10 files) | Exit 0. |
| `npm run build` | Exit 0; the existing chunk-size advisory remains. |
| `git diff --check` (tracked task files) + whitespace scan (untracked) | Clean. |
| Credential-pattern scan | No matches. |

Earlier pre-fix runs were not promoted:

- 23/32 pass. The 9 failures were 5 × S3 (defects 2 and 3) and 4 × S5 (defect 4).
- After the fixes, a run produced 8 failures. One test read the in-page SDK counter after `reload()` had reset it; the rest raced transient frames or a lazy chunk on the loaded machine. These were fixed with condition-based waits and wider (non-retrying) deadlines: test 120 s, expect 15 s.

No assertion on totals, identities, submissions, confirmations or deduplication was weakened.

## J. Financial invariants preserved

- Payment is never shown as Paid without the verified projection, and never as Failed from a timeout or transport error.
- UNKNOWN never offers Try Again or Pay.
- Try Again only resumes an eligible attempt and requires an explicit Place Order.
- The new list invalidation is a GET only: no automatic reconcile, submit or setup retry was added.
- A's responses cannot mutate B (identity and generation guards are untouched).
- No client secret enters storage or the query cache.

## K. Cross-owner blockers

1. **Editing a failed purchase's shipping or delivery before retry** is not possible: the PaymentAttempt snapshot is immutable (AGENT_COORDINATION §7). Shipping and Delivery are shown read-only in retry. Allowing edits needs a PAYMENT backend contract, as already recorded in `TASK_03.6_SCENARIO_1_FINAL_CLOSURE_HANDOFF.md`.
2. Real Stripe Test Mode decline/UNKNOWN runs and real backend/PostgreSQL behaviour: **BLOCKED** (separate authorization).
3. Design system: `$font-family-mono` (JetBrains Mono) is never loaded anywhere in the app. The Orders reference uses the base font instead. This needs a separate design-system fix.

## L. Rollback (smallest safe reversal)

- **Defect 1:** revert the `draftWasSubmitted` branch in `detachDraft` and the three `CheckoutPage` reset sites. Checkout B will then be pre-filled with A's address and delivery again.
- **Defect 2:** delete the `ol.paymentToasts` rule. The toast returns to bottom on phones; also revert the one-line Scenario 1 assertion.
- **Defect 3:** restore `OrdersPage.tsx/.module.scss` from `.cache/scenarios-2-6/before/`.
- **Defect 4:** remove the two `invalidateQueries` calls.
- **Defect 5:** revert the listed SCSS lines and `PaymentPurchases` notice markup.

No data or provider rollback is needed.

## M. Readiness

- **Frontend/UX: READY FOR ARCHITECT REVIEW**, within category A evidence, with the §I pre-existing failures noted.
- **Backend/financial acceptance: BLOCKED / NOT VERIFIED** (outside scope).
- Merge: NO.

## Round 2 — test maintenance and cross-owner handoff (2026-10-15, after the 95/100 APPROVE)

Accepted fixes were re-verified in the current tree. Checkout B's clean draft, phone toast placement, the Orders Paid status, the saved-purchase refresh, the cards and notices are all present. Peers added their own `CheckoutPage.tsx` / `state.ts` / `OrdersPage` work without removing any accepted hunk.

| Item | Result |
|---|---|
| Legacy suites (`payment-recovery-ux`, `task-03.6-bugfix-verification`, `task-03.6-refinements`) | Owned and reconciled by the Scenario 1 session (classification table: `TASK_03.6_SCENARIO_1_FINAL_CLOSURE_HANDOFF.md` "Final test reconciliation"). 32 obsolete expectations were updated, 2 checks retained unchanged, 1 real regression fixed ("Refresh totals" shown only when totals changed), and **none retired**. To avoid concurrent edits, this session edited none of them and verified **read-only: 83/83 PASS** on its own preview (fresh 15:36 bundle; spec hashes unchanged during the run). |
| Select / Tooltip timeouts | **Broken test environment, not a component regression, and not only contention.** floating-ui `isTopLayer()` (Radix Popper) calls `element.matches(':modal')`. Under jsdom 25.0.1 with nwsapi 2.2.27 (both unchanged since HEAD), that self-recurses to stack overflow and is swallowed: ~580 ms per call (measured), ~29 s per Select open (in-process CPU profile: nwsapi `isFullscreen` ↔ `Element.matches`). The tests were always ~30 s, and machine load pushed them past 60 s. **Fix:** a 10-line shim in `src/test/setup.ts` answers the never-matching `:modal`/`:fullscreen` probes with `false` (jsdom has no top layer). No component or assertion changed. Select 36 s → 0.6 s, Tooltip passes. Full suite: Select/Tooltip PASS. |
| Orders crash in S3 (reported by the Scenario 1 session) | A 12:41 `OrdersPage` change (owner unknown, not this session) paginates `/api/orders` and read `query.data?.meta.totalPages`. My Scenario 3 fixture still returned `{ data }` only, which threw on `/orders`. **Fixed:** the fixture now returns the real contract `{ data, meta }` (`order.service.ts` `list`), and `OrdersPage` fails closed with `meta?.totalPages` (unit test added). On a fresh bundle, S3 ×8 + ack + Orders history: **12/12 PASS**. |
| S3 acknowledgement layout test | My original sampled a viewport-relative position while `fill()` was still scrolling. It is replaced by the Scenario 1 owner's document-relative, stability-polled version, which fails with a 40px negative-control shim. Included in the 12/12 above. |
| PAYMENT contract | `TASK_03.6_SCENARIOS_2_6_PAYMENT_CONTRACT_HANDOFF.md`. Read-only stays (no change). Per-line `unitPrice`: optional. **Delivery re-eligibility: risk decision requested.** `resume` checks only the product price, but commit re-derives delivery price/`DELIVERY_VERSION` *after authorization*, so a delivery pricing change would surface as an authorize-then-compensate failure. Recommended option A: refuse early in `resume`. |
| Typography | `WORK_ITEM_TYPOGRAPHY_FONT_LOADING.md`. The app loads **no** web fonts: neither Poppins nor JetBrains Mono has a link, `@font-face` or package. Kept separate from payment work. |

### Genuine regressions found in other owners' areas (not fixed here)

1. `npm run build` fails at `tsc -b`: `src/components/layout/CustomerHeader/CustomerHeader.test.tsx:389–395` (TS18048, TS2322), modified 12:32 today. `npm run typecheck` (`tsc --noEmit`) still passes, and `vite build` alone succeeds. Browser evidence above used a `vite build` bundle.
2. `CartSyncPerformance.test.tsx`: 2 badge-hydration tests now fail. They expect `Cart, 2 items` / `Cart, 3 items` synchronously on refresh. The 12:32 `CustomerHeader.tsx` change labels the link `Cart` while `cartCountUnresolved` is true. Verified independent of this session's shim (identical failure with the shim reverted). The tests passed in this session's first full run. Owner decision: intended behaviour change (update the tests) or regression of the "no 0 flash / synchronous restore" requirement.

Full frontend Vitest (round 2): **631 passed / 2 failed**; the only failures are item 2. Typecheck and scoped ESLint exit 0.

### Round-2 files (this session)

- `apps/frontend/src/test/setup.ts`: +10, jsdom `:modal`/`:fullscreen` shim.
- `apps/frontend/src/pages/customer/OrdersPage.tsx`: +1/−1, `meta?.` fail-closed, plus a comment.
- `apps/frontend/src/pages/customer/OrdersPage.test.tsx`: +1 test, missing-meta case.
- `apps/frontend/tests/checkout/scenarios-2-6.spec.ts`: paginated `/api/orders` fixture; peer-authored ack test.
- `docs/tasks/Phase-03/TASK_03.6_SCENARIOS_2_6_PAYMENT_CONTRACT_HANDOFF.md`, `docs/tasks/Phase-03/WORK_ITEM_TYPOGRAPHY_FONT_LOADING.md`: new.

Temporary diagnostic test and configs were deleted. Rollback copies: `.cache/select-tooltip/before/setup.ts`, `.cache/scenarios-2-6/before/*.round2.*`.

Task 03.6 remains OPEN. NO PUSH remains in effect. No database, Stripe, backend, staging or commit operation was performed.

## Round 3 — header build and badge hydration (2026-10-15)

- **Build:** `CustomerHeader.test.tsx` took a fixture item via `items[0]`, which is possibly `undefined` under `noUncheckedIndexedAccess` (TS18048). It then spread a `ProductSummary | null` product, so the result was not a valid `ProductSummary` (TS2322 ×2). The test now builds items from the typed `wishlistProduct`, with no casts or suppressions. `npm run build` (including `tsc -b`) exits 0. Note: `npm run typecheck` (`tsc --noEmit` on the solution-style `tsconfig.json` with `files: []`) checks nothing, so `tsc -b` is the real gate. Script owner to fix.
- **Badge failures:** the two `CartSyncPerformance` tests had **outdated expectations**: they painted the session-cached count before identity verification. They were rewritten to the approved contract: number-free until resolved, cached counts provably not shown, no 0 during a held Cart read, correct counts after, a single Cart read.
- **Real defect fixed in `CustomerHeader.tsx`:** a failed Cart read (no data, not loading) announced "Cart, 0 items". The count is now unresolved whenever there is no authoritative Cart. A new unit test fails on the 12:32 header (negative control). Customer-switch and background-refetch unit tests were added.
- **Results:** CustomerHeader + CartSyncPerformance 34/34 PASS. Chromium (`playwright.header-badges.config.ts`, intercepted APIs) at 390 and 1366: 10/10 PASS. Cases: empty Cart, reload with a held Cart read (label `Cart`, no badge, never `Cart, 0 items` across the full label history), background refetch keeps the count, customer switch never paints the previous customer's cached 7 or a 0, wishlist resolves to (2), pending A (qty 5) plus active B shows `Cart, 1 item`. Screenshots and report: `evidence/header-badges-20261015/`.
- **Files:** `CustomerHeader.tsx`, `CustomerHeader.test.tsx`, `CartSyncPerformance.test.tsx`, `tests/checkout/header-badges.spec.ts` (new), `playwright.header-badges.config.ts` (new).

## Round 4 — global payment-toast reliability (2026-10-15)

**Status: APPROVED / CLOSED — scoped frontend implementation.** Decision source: Principal Architect message relayed in the agent session on 2026-10-15 (97/100, APPROVE). The agent cannot independently verify its origin. This closes only the payment-toast reliability fix below. It is not real-backend notification acceptance, broader payment acceptance or release approval.

### Reproduced root cause
`PaymentNotifications` (mounted once in `CustomerLayout`) presented and recorded a notice in any tab that held the data, including a **hidden** tab. The browser-local key `electrohub.payment-notice.<user>.<attempt>.<state>` is shared by all tabs of the browser. A hidden tab therefore wrote the key, its toast auto-dismissed unseen after 5 s, and the visible tab then skipped the result because of that key. Reproduced in Chromium (intercepted APIs): the key read `shown` while no toast had been seen, and a tab that became visible later showed nothing.

### Fix
- `PaymentPurchases.tsx`: `PaymentNotifications` subscribes to `visibilitychange` (`useSyncExternalStore`). A hidden tab no longer presents, claims or records a notice. When a tab becomes visible, the notification effect re-evaluates, so a visible tab shows the result exactly once. No new API calls and no change to the `/read` contract.
- Related hardening from the preceding round: when the effect re-runs, only a toast that was never recorded as presented is withdrawn; a toast already presented stays up. A race was not observed; the change closes a theoretical window.

### Notification rules (unchanged unless stated)
- **Backend `unread`** decides whether a result is new. **The local key** only stops the same browser repeating a presented result. Only `SUCCEEDED`, `DECLINED` and `FAILED` are notifiable.
- PAID and confirmed failure results toast once on customer pages, including Cart.
- Dedicated Processing, Checking Payment and Payment Failed screens suppress only the matching purchase; other purchases still toast.
- UNKNOWN, PENDING, PROCESSING and transport errors (including 500/503) never produce a terminal toast.
- Mobile placement stays below the header; larger screens stay bottom-right. Toasts did not overlap Proceed to Checkout, Review Order or Place Order in the checked pages.
- A late result for Purchase A never redirects, clears or resets Checkout B.
- `/read` is sent once per dismissal. A failed `/read` shows an error toast and the local key prevents a repeat in that browser; a clean browser shows it again from backend truth.

### Files
`apps/frontend/src/features/checkout/PaymentPurchases.tsx`, `PaymentPurchases.test.tsx` (+1 test), `apps/frontend/tests/checkout/payment-toasts.spec.ts` (new).

### Evidence (intercepted frontend only)
- Checkout Vitest 176/176 (includes `PaymentPurchases.test.tsx`).
- Chromium at 390 and 1366 (`payment-toasts` + `payment-purchases`): 54/55. The one failure was an isolated `page.goto` navigation abort in a reliability spec that passed before and again on two reruns. The five new reliability specs passed on repeated runs.
- `tsc --noEmit`, `npm run build`, scoped ESLint and `git diff --check`: pass.
- Not repeated: the other Chromium suites (not part of this lifecycle change).

### Accepted limitations
- **One-frame display window:** the key is recorded when the toast commits in a visible tab, not after its enter animation. A reload within about one frame of commit would suppress that toast in this browser.
- **Failed `/read`:** the backend stays unread until a later acknowledgment; this browser will not repeat the toast, other browsers will.
- **Cleared localStorage:** clearing the local keys while the backend still reports `unread` shows the toast again, by design.
- **Paused timers:** Radix pauses the 5 s timer when the window loses focus, so a toast in an unfocused but visible window stays until focus returns.

### Separation of evidence
All results above are **intercepted frontend evidence**. Real-backend notification acceptance (real `unread`/acknowledgment values, real payment results) remains a separate, **NOT VERIFIED** item, as is visual comparison against Figma.

No backend, Prisma, AUTH, database, migration, Stripe, staging or commit operation was performed. Task 03.6 remains OPEN. NO PUSH remains in effect.
