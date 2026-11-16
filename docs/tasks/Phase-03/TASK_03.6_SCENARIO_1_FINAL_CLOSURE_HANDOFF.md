# Task 03.6 — Scenario 1 final closure (frontend) — 2026-10-15

> **Status: APPROVED / CLOSED (frontend only).** Principal Architect decision 2026-10-15: 97/100, APPROVE.
> Scope: Scenario 1 frontend implementation and the legacy test reconciliation. **Task 03.6 remains OPEN.**
> **NO PUSH remains in effect** (no staging, commits, pushes, merges or deployments).
> Open item outside this scope: the PAYMENT owner decision on delivery-method and shipping-price re-eligibility on resume (see below).

Scope: the "SCENARIO 1 FINAL CLOSURE" directive and its three addenda (Payment Failed → Try Again; Empty Checkout on
Retry + Failed-purchase cards; Late results + premium cards + safe retry). Frontend only. No backend, Prisma, Stripe,
pool, migration or auth changes. No commits, pushes, staging or deployments.

**Evidence boundary.** Every browser result below is from real Chromium against the real app with **intercepted APIs
and the Stripe SDK fixture**. It proves UI transitions and request boundaries only. It is **not** real Stripe or
PostgreSQL acceptance, and it does not prove backend behaviour.

## Customer journey (as implemented)

| Situation | Presentation |
|---|---|
| Place Order in flight | Stage 1 "Processing your order…" (unchanged centered view) |
| Settled but unresolved | Stage 2 "Checking your payment" (new verification view; no buttons except Continue shopping) |
| Settled with network/5xx/UNKNOWN | "We couldn't confirm your payment yet": same-attempt **Check again**, never a failure claim, never permanent checking |
| Confirmed failure while on screen | Payment Failed screen, **no toast**; the outcome is acknowledged (`/read`) so no later toast repeats it |
| Confirmed result after leaving | One bottom-right global toast on any customer page (Home, Products, Cart, Checkout); 5 s auto-dismiss; close icon dismisses immediately; never repeated on refetch/remount |
| Try Again (failure screen or Cart card) | `/checkout?step=payment` for **that saved purchase** (see below). No "Complete your saved purchase", no eligibility page, no empty-Cart screen |
| Legacy `/account/payment-retry/:id` | Redirects to `/cart?purchase=:id`; makes **no** API call |

## Saved-purchase retry (`SavedPurchaseCheckout`)

Root cause of the owner's "Your cart is empty" screenshot: Checkout always rebuilt from the active Cart, and a fresh
Checkout mount drops a submitted attempt from its draft. Submit removes A's lines from the Cart (that is what keeps
Cart B independent), so retrying A had nothing to render.

Fix: when router state carries `retryPurchase: <attemptId>`, `/checkout` renders an isolated saved-purchase Checkout:

- Data comes only from the existing backend `POST /payment-attempts/:id/resume`. It returns the same attempt and the same
  PaymentIntent, and the server revalidates eligibility, availability and unit prices under lock. The response carries
  items, quantities, images, total, shipping and delivery.
- It never reads or writes the active Cart, Checkout B's draft, or browser storage. Each purchase is keyed by its own
  attempt id, so A and B never share draft, address, delivery, client secret, loading or error state.
- Steps: Shipping (saved, read-only) → Delivery (saved, read-only) → Payment (Stripe) → Review → Place Order. Back/forward
  keeps the identity because the router state travels with every step.
- The Payment step shows "Retrying payment for this purchase" with the saved items, verified total, destination and
  delivery. On small screens this context appears before the card fields.
- Place Order confirms once and reconciles the same attempt. There is no `/submit` (the attempt is already submitted)
  and no new setup. PAID goes to the confirmation route; failure returns to Payment Failed; unresolved goes to Stage 2.
- An ineligible attempt (409/404) shows "This purchase can't be paid again right now". A transport failure shows
  "We couldn't load this saved purchase" with a retry. Neither shows a fake payment form.

### Missing backend contracts (escalation: PAYMENT owner) — stopped at this boundary

1. **Editing shipping/delivery of a saved purchase.** A PaymentAttempt's `request` and total are fixed, and no endpoint
   re-quotes or updates a saved attempt. Shipping and Delivery are therefore shown read-only during retry, labelled
   "kept exactly as it was ordered". Allowing edits needs an owner-approved contract (re-price, delivery eligibility,
   intent amount update).
2. **Per-line unit prices.** `resume` and the purchases list expose name, quantity, image and total, but not the stored
   `unitPrice`. Cards and the retry summary show the server-verified purchase total, not per-line prices.
3. **Delivery re-eligibility.** `resume` revalidates product availability and unit price, but not delivery-method
   eligibility or shipping cost.

## Cart presentation

- **Pending purchases** (above the active Cart): Cart-style cards (80/100 px media, CartItem spacing and tokens), one
  card per purchase identity with all its lines grouped, a status badge (Processing / Awaiting confirmation / Action
  required), amount, a subtle progress bar (static under reduced motion), and no Try Again.
- **Failed payments**: the same card with a "Payment failed" error badge and an explanation. Try Again appears only when
  the backend sets `retryAllowed`.
- A confirmed terminal result exits Pending with the existing 450 ms animation (none under reduced motion). The card
  exit no longer suppresses the global toast, so Cart also gets exactly one toast. A late or stale read can never put a
  settled attempt back into Pending.
- Paid purchases leave Pending, never show Try Again, and their toast links to the order confirmation.

## Late results (beyond five minutes)

- No time cap. One bounded read at a time (10 s per-read deadline), with backoff by how long **this tab** has watched
  the newest unresolved purchase: 15 s for 5 min, then 60 s to 30 min, then 120 s. Client-observed time avoids
  server/client clock skew.
- Additional reads on window focus, tab visibility return, network reconnect, and route navigation (when the last read
  is more than 10 s old).
- A hidden or suspended tab is not polled and is not promised delivery; it re-reads when it becomes active again.
- A result is never inferred from elapsed time.

## Escalations (not modified here)

- **DATABASE/OBSERVABILITY:** an unhandled `pg` pool client error crashed the backend (`client.js:204` "Connection
  terminated unexpectedly", 18:11:26 UTC). `@prisma/adapter-pg` 6.12 builds `new pg.Pool(config)` without an `'error'`
  listener. Recommendation: an owned Pool with an error listener, plus a regression test.
- **AUTH:** refresh `cf3658e1` returned 500 P2028 after 16 583 ms against a 15 000 ms transaction timeout. Do not raise the
  timeout blindly; investigate pool wait and transaction work.
- **PERFORMANCE:** replay of an expired attempt took 55.8 s and the following new setup 37.0 s (Stripe 24–30 s, DB ops
  1–7 s each). Track separately under CCR-1/2/3.

## Verification (2026-10-15, this machine)

| Check | Result |
|---|---|
| `tsc -b` (typecheck) | exit 0 |
| ESLint `src/features/checkout src/pages/customer src/layouts src/routes tests/checkout` | exit 0 |
| `vite build` | exit 0 |
| `git diff --check` (frontend + edited doc) | exit 0 |
| Vitest `src/features/checkout` | 173/173 |
| Vitest full `src` | 624/629. The 5 failures are UI primitives (DropdownMenu, Tooltip, Select), routing, CheckoutPage and search, all timing out at 60–114 s under 80 % system CPU from other applications. CheckoutPage and search pass in isolation; routing/DropdownMenu/Tooltip/Select are unchanged files and passed 9/9 in isolation earlier |
| Playwright `checkout` config: payment-retry, late-results, loading-baseline | 28/28 |
| Playwright `scenario1` config (prod preview) | 36/36 |
| Playwright `payment-lifecycle` config | 55/55 |
| Playwright `purchases` and `cart` configs | exit 0 |
| Repeat runs: payment-retry ×3, late-results ×2 | stable after the test-timing fixes below |

Test-side timing fixes, applied without weakening assertions:
- A paused page clock where a 5 s toast lifetime raced slow navigation.
- The exit animation is frozen before the toast assertion.
- A single clock jump past the 5-minute window replaces 20 strictly timed steps.

Environment note: on a cold Vite dev server the app needed 5–9 s to boot, which caused intermittent `ERR_ABORTED` and redirect-timeout failures. These pass on a warm server and are not product defects.

Visual evidence (git-ignored), inspected at 390/768/1440/1920: `apps/frontend/screenshots/scenario1-final/`.
- Cart pending/failed cards.
- The restored Payment step (purchase context above card entry on mobile).
- The read-only saved shipping step.
- Ineligible and unreachable states.
- The pending→failed transition, the paid toast, and late Home toasts.

Known capture artifacts:
- One 390 px Cart capture shows the sticky header below the breadcrumb, because the card was scrolled into view before a full-page shot.
- The 1920 px paid-toast capture is mid slide-in.

## Final test reconciliation (2026-10-15, after the 91/100 "REQUEST CHANGES" decision)

### Legacy suites: classification of the 34 original failures

Classes: **A** = valid regression check (kept; implementation fixed if broken); **B** = obsolete expectation (updated to the approved contract, keeping its behavioural intent); **C** = superseded duplicate (none retired).

| # | Test | Cause | Class | Resolution |
|---|---|---|---|---|
| 1–4 | payment-recovery-ux · slow reconciliation ×4 widths | Expected the former recovery panel ("Checking your payment status…", progress bar, zero links) | B | Asserts the approved Stage 2 view: "Checking your payment" section, animated indicator, status role, no buttons, and exactly one safe link (Continue shopping → /products); still asserts no Try Again, Check payment status or Return to Cart |
| 5–8 | payment-recovery-ux · DECLINED failure screen ×4 | Copy "Your cart has been preserved…" (A now leaves the active Cart) | B | Copy updated to "Your purchase has been preserved. You can try again or use another card."; icon, notice and both enabled actions still asserted |
| 9 | payment-recovery-ux · Return to Cart → fresh Shipping | Expected A to remain in the active Cart | B | Asserts A is absent from the active Cart, then Cart B → fresh Shipping with zero stale terminal frames (MutationObserver kept) |
| 10 | bugfix-verification · unresolved capture survives leaving/re-entering | Old heading; expected Checkout's draft to own submitted A | B | Asserts Stage 2; re-entering Checkout makes no new setup, submission or confirmation and shows no terminal flash; A's identity persists as a pending, non-retryable Cart card |
| 11 | bugfix-verification · bounded waiting | Old `/account/payment-status` destination | B | After the 120 s window: `/cart?purchase=<id>`, pending card, no Try Again, Check payment status or failure claim; safe navigation available |
| 12 | bugfix-verification · Decline → Try Again → Confirmation | Mock reconcile lacked `submittedAt`; asserted a NEW idempotency key (contradicts the same-attempt contract) | B | Realistic `submittedAt`; Try Again → restored Payment step ("Retrying payment for this purchase") → Review → Place Order → Confirmation; asserts 1 setup key, both reconciles on the same attempt, 2 confirmations (one per Place Order) |
| 13–16 | refinements · Payment Failed layout/scroll ×4 | Same obsolete copy as 5–8 | B | Copy updated; centered layout, no checkout chrome, scroll-to-top and Try Again → card → Review still asserted |
| 17 | refinements · PREPARING setup | `page.goto ERR_ABORTED` (cold dev server) | A | Unchanged; passes on rerun |
| 18–25 | refinements · decline → Cart → fresh Checkout ×8 | Expected A to remain in the active Cart | B | Asserts A absent from the active Cart, then Cart B; stale-frame observer, delayed quote and overflow checks kept |
| 26 | refinements · failure → Products → Cart → Checkout | Same as 18–25 | B | Same update |
| 27–30 | refinements · payment skeleton/no layout jump ×4 | Formula assumed a fixed-height mock iframe plus 48 px padding; the fixture now sizes to its content (skeleton 282 px; mock entry 175/121 px) | B | Keeps reserved space ≥250 px, no spinner/text/conflict UI, and **mounting never pushes content down** (mounted ≤ reserved). Real Payment Element geometry: NOT VERIFIED (requires a real-entry spec) |
| 31–34 | refinements · 409 conflict, no Refresh totals ×4 | **Real regression**: the Payment-step setup-error card showed "Refresh totals" unconditionally, contrary to the documented rule (TASK_03.6_IMPLEMENTATION_EVIDENCE.md:362, "only when `changed` is true") | A | **Fixed in `CheckoutPage.tsx`** (`{changed && …}` restored); the test is unchanged and passes; the stale-total test still shows Refresh totals |

Totals (consistent with the table, 34 failures):
- **A — valid regression check, test unchanged:** 5 (#17; #31–34, where the implementation was fixed instead).
- **B — obsolete expectation, test updated:** 29 (#1–16 and #18–30).
- **C — superseded duplicate, retired:** 0.

Results: the three suites pass **83/83** (82 in one run, plus the one corrected assertion rerun). Checkout unit tests pass 174/174. ESLint and `git diff --check` are clean.

### Scenario 3 layout-stability assertion (owned by the Scenarios 2–6 session)

- **Evidence (instrumented copy, preview build, 1280 px):**
  - After `fillShippingWith`, `fill()` scrolls fields into view. Scroll goes 163→166 and the heading's document Y 330→327 within about 500 ms.
  - After that, the heading stays at document Y 327 / scrollY 166 through the 15 s result, toast settle, toast close, acknowledgement notice and +500 ms.
  - The failing baseline was viewport-relative and captured mid-settle (195 or 251 against 161).
  - **No product layout shift.**
- **Proposed test (sent to the owner, not applied here):**
  - Wait until document-relative heading geometry and scroll are stable.
  - Capture a baseline (geometry, URL, all shipping field values, Order Summary text).
  - Trigger the late A result, then close the toast and wait for the notice.
  - Assert geometry, URL, fields and totals are unchanged, and there was a single submission.
  - It passed 3/3. A negative control (40 px shim above the heading) failed it: top 327→367.
- **Resolution:** after this handoff, the Scenarios 2–6 owner resolved the stabilized layout assertion and the Orders pagination compatibility. The Architect's final decision records the stabilized test as 3/3 PASS with negative-control detection. No Scenario 1 file was changed for either.
- **Separate finding for that owner (since resolved):** on a fresh build, the six "S3 … non-disruptive toast" tests fail only at their final Orders step.
  - `OrdersPage.tsx` (changed 12:41 today, not by Scenario 1) reads `meta.totalPages`. The suite's `/api/orders` fixture has no `meta`, while the real backend returns it (`order.service.ts:48`).
  - Suggested fixes: add `meta` to the fixture, and make OrdersPage fail closed (`meta?.totalPages`) rather than crashing.

### PAYMENT owner decision request (no backend change made)

| Item | Current frontend behaviour | Decision needed | Blocker? |
|---|---|---|---|
| Shipping/delivery on saved-purchase retry | Read-only. The PaymentAttempt request and amount are immutable; no API re-prices or updates them | Keep read-only (recommended), or approve a contract to amend shipping/delivery (re-quote, eligibility, PaymentIntent amount update, audit) | No (product choice) |
| Line prices | The total only. `resume` and the purchases list omit the stored `unitPrice` | Optionally expose per-line `unitPrice` | No (optional UI improvement) |
| Delivery-method eligibility on resume | `resume` revalidates item availability and unit price, but not delivery-method eligibility or shipping cost | **Must eligibility be re-checked before accepting a resumed payment?** If yes, `resume` (backend) must refuse ineligible delivery; the UI already shows the authoritative refusal truthfully | **Potential contract blocker** for final payment acceptance |

## Rollback

Frontend-only. Revert the listed files. Deleting `SavedPurchaseCheckout.tsx` and restoring `PaymentRetryPage.tsx` from
the session backup brings back the previous retry page. No data migration is involved.
