# Task 03.6 — Final Strict Payment Lifecycle, Checkout Recovery & Failed-Payment Cleanup: Report

Status: **OPEN — awaiting Principal Software Architect review.** No migrations, commits, pushes, deployments, shared DEV/PROD payment writes or new
Stripe PaymentIntents in this pass. Date 2026-10-17 (UTC).

## A. Executive Summary

Customers now see only **Pending purchases → Processing**, **Failed payments → Payment failed** and **Orders → Paid**:
- **Try Again and the trash icon:** every Failed payments card shows both. Removal is persistent, idempotent and non-destructive.
- **Removed:** the Incomplete purchases UI, Not completed, Restore items, Checkout saved and Continue to payment are gone from every screen.

Leaving Checkout (navigation, refresh, Back, closing it) never cancels, releases or confirms a submitted purchase. Card confirmation depends only on the same secure card form still being mounted.

A purchase whose confirmation **verifiably** never reached Stripe:
- stays **Processing** (never Payment failed without provider evidence);
- gets a rare, **server-verified Cancel purchase**, re-checked against Stripe and under row locks at click time;
- optionally returns its items to the Cart, by explicit customer choice.

Other changes:
- **`/submit`** no longer runs the full status projection on the confirmation critical path.
- **Disabled shared-DEV environment:** shows a truthful "temporarily unavailable" state instead of retry loops.
- **Status page:** opens immediately with the saved purchase.

## B. Final Customer Payment Lifecycle

**Place Order → Processing → Payment failed / Paid.**
- **Pre-confirmation:**
  - setup errors keep the customer in Checkout with a recoverable error;
  - a disabled environment shows the maintenance state without retries;
  - nothing becomes a Pending purchase until `/submit` accepts Place Order.
- **Processing:** the purchase has been accepted. Recovery reconciles with Stripe; a 45-minute stale note gives a support reference.
- **Rare exception:** recovery records `PAYMENT_NOT_CONFIRMED` (internal evidence) when, 10 minutes or more after submit:
  - no confirmation was announced; and
  - Stripe shows no decline, no payment method, nothing received or authorized.

  The card then also shows **Cancel purchase**: confirmation dialog, then the server re-verifies with a **fresh Stripe read** and under attempt and work **row locks** (refused on an active lease, a late announcement, an order or any change). The lease-fenced worker then cancels the intent. A **decline or authorization observed at that point always wins**.

  A cancelled purchase leaves the active lists (`PAYMENT_CANCELED_BY_CUSTOMER`). For Cart purchases its items are returned to the Cart only if the customer ticked the option, through the idempotent `restore()`.
- **Payment failed:** only on provider evidence (`last_payment_error`) or a failed order. Try Again opens a fresh, empty Payment Element on the same intent (verified with real Stripe Test Mode on 2026-10-17).
- **Paid:** leaves Pending purchases and appears as an Order.

## C. Removed UI

Fully removed from customer-facing code:
- the Incomplete purchases section and heading;
- the "No payment was taken for these purchases…" note;
- the Not completed badge;
- "This purchase was closed before payment completed.";
- Restore items (Cart card and status page);
- the `RestorePurchaseItems` component;
- Checkout saved and Continue to payment;
- the client `release-unconfirmed` path and endpoint.

A source search of the shipped frontend finds none of these strings. Tests assert their absence (unit tests, the mocked browser test and the isolated stack at 390px and 1366px).

**Historical records (no relabelling):** purchases that ended with **no payment and no decline evidence** are **excluded** from active lists by a documented rule (`ABANDONMENT_FAILURE_CODES`: `PAYMENT_EXPIRED`, `PAYMENT_SETUP_SUPERSEDED`, legacy `PAYMENT_INCOMPLETE`, `PAYMENT_CANCELED_BY_CUSTOMER`). This includes the MacBook Air 15 1TB Starlight `aac568f8`, which no longer appears anywhere. Records are untouched.

## D. Failed Payments

- **Trash icon:** shown on **every** failed card (Cart, Buy Now, single and multi-item, DECLINED and FAILED). It's always visible, 44 px, keyboard-focusable, and named "Remove failed payment for …".
- **Dialog:** "Remove this failed payment?" / "Remove this failed payment from your list? Your payment history will be preserved." with Cancel and Remove.
- **Dismissal:** `POST …/dismiss` sets only `dismissedAt` (column already present in DEV). It is owner-scoped, eligibility-checked inside the write and idempotent; repeats return the same timestamp. A foreign id returns 404. The card is removed after the server confirms; on failure the card stays, with a truthful message.
- **Disabled environment:** the icon stays, the dialog explains, and Remove is not offered.
- **Isolated stack, real PostgreSQL:** dismissed, re-dismissed with the same timestamp, gone from the list, foreign id 404; the row, state, code, intent, total and item were preserved.

## E. Root-Cause Analysis

| Problem | Cause | Evidence |
|---|---|---|
| Lost confirmation / stuck Processing | **Verified.** After `/submit` returned, `place()` required page-wide freshness (mounted, setup generation, draft key). A slow submit (8.5–37 s) let Cart and quote refetches or navigation invalidate it, so confirmation was silently skipped. | Server logs of 4 DEV incidents: `/submit` 200 with post-submit invalidation GETs, then no `confirmation-started` |
| Slow `/submit` | **Verified + partly fixed.** Many sequential remote round trips inside the Serializable transaction (locks, re-reads, Cart lock and projection, per-line update and delete) at about 1–3 s each against Supabase ap-northeast-2, plus up to 5 s waiting out a recovery lease. After commit it also ran the full status projection (attempt re-read, Cart projection, order lookup) before responding. **Removed that post-commit projection**: the response is the accepted identity from the locked read. The in-transaction work is unchanged; it is inherent to safely moving Cart lines. | No before/after DEV latency measurement: DEV is write-disabled by design, and local disposable latency is not representative |
| Navigation/unmount failures | **Verified.** Previously the purchase was released or cancelled on unmount; now it never is. | Handoff tests |
| "Secure payment setup could not finish" | **Verified.** 503 `PAYMENT_MUTATIONS_DISABLED` from the isolation guard on shared DEV, shown as retryable. On the isolated stack without a key it was 503 `PAYMENT_CONFIGURATION_UNAVAILABLE`. | Shared log; isolated run |
| "This payment could not be removed" | **Verified.** `POST …/dismiss` → 503 `PAYMENT_MUTATIONS_DISABLED` (guard). | Shared log 13:21:25 |
| "Saved purchases could not be updated / loaded" | **Verified.** Not the guard (all logged reads 200). Reads were dropped while the watched dev server restarted on file saves, and the list query had `retry: false`. Now it retries transport, timeout and 5xx failures twice. **Hypothesis:** some may also have been browser-side aborts. | Shared log restart times |

## F. Architecture and Security Review

- **Stripe truth:** Paid only after the provider reports success; Payment failed only on `last_payment_error` or a failed order; a decline or authorization beats lapse, release and cancellation logic (tested).
- **No duplicate charges:**
  - one intent per attempt (provider idempotency keys);
  - confirmation only from the mounted form, after a durable announcement;
  - status pages only read;
  - Try Again reuses the same intent;
  - the real Test Mode run produced 1 intent, 1 capture and 1 order.
- **Cancellation races:** the decision runs on locked rows; it is refused on an active lease, a marker or a state change; the worker re-applies provider truth before cancelling at Stripe.
- **Ownership:** every customer route is owner-scoped (404 for others).
- **Financial records:** nothing is deleted; dismissal and cancellation only set fields.
- **Isolation:** unchanged and enforced. The shared DEV backend's latest reload resolved `allowed=false … watched-dev-server-on-shared-target`. The isolated stack ran only against `localhost:55433/electrohub_disposable` (own cluster, verified TLS). The isolation guard was not weakened.

## G. Files Changed (this pass)

Backend:
- **`src/services/payment.domain.ts`:** abandonment codes (incl. legacy and customer-cancelled), `NOT_CONFIRMED` as internal evidence, classification rules.
- **`src/services/payment.service.ts`:**
  - never-confirmed evidence (no auto-failure, no cancellation);
  - `cancelEligible`;
  - safe verified `cancel()` replacing the unrestricted one;
  - provider-wins precedence for customer cancellation;
  - `cancelable` in projections;
  - list exclusion rule;
  - lightweight `/submit` response.
- **Tests:** `payment.service.test.ts` (never-confirmed + 14 cancellation cases), `payment.classification.test.ts`, `payment.purchase-ownership.test.ts`, `payment.lock-order.test.ts`, `payment.session-isolation.test.ts`.

Frontend:
- **`PaymentPurchases.tsx`:** trash on every failed card; `CancelPurchase` dialog; never-confirmed copy.
- **`DismissFailedPurchase.tsx` + `.module.scss`:** agreed copy; unavailable state; 44 px target.
- **`RestoredPurchase.tsx`:** saved purchase shown immediately.
- **`types.ts`:** `cancelable`.
- **`paymentCapability.ts`:** comment.
- **Tests:** `PaymentPurchases.test.tsx` (trash on every card, dialog copy, cancel flows, Buy Now), `RestoredPurchase.test.tsx` (immediate summary), `tests/checkout/payment-recovery-navigation.spec.ts` (Processing through Cart navigation, refresh, Back and Forward; no cancel or release POST), `tests/isolated/cart-payment-states.isolated.spec.ts` (Cancel purchase and trash on the isolated stack).

Earlier passes today (still uncommitted, described in the earlier Task 03.6 reports): the isolation boundary, the confirmation handoff, decline-wins ordering, the capability endpoint, the disposable seed guard, removal of the Incomplete UI, and the isolated Playwright config.

## H. Tests and QA Results

| Command | Result |
|---|---|
| `apps/backend: npx vitest run src tests/product.seed.test.ts` | **779 passed**, 55 skipped, 1 failed: the existing unrelated `cart.quantity-correction.integration.test.ts` |
| `apps/frontend: npx vitest run src/features/checkout` | **257 passed** |
| `playwright -c playwright.payment-recovery-navigation.config.ts` (mocked API, Chromium 390 + 1366) | 15 passed + new test 2/2 passed on rerun. The first run of the new test hit `ERR_CONNECTION_RESET` from the preview server before any test step. |
| `playwright -c playwright.isolated.config.ts cart-payment-states` (real backend + disposable PostgreSQL, **no Stripe**) | 2 passed (1366, 390) |
| Real Stripe Test Mode (earlier today, separately authorized, 1 of 3 intents) | 1 passed: Payment Element, decline → Payment failed, Try Again (same intent, empty form), success → Paid Order |
| Typecheck, lint, build (backend + frontend), `git diff --check` | all exit 0 |

**Mocked vs real:** webhook races and most recovery transitions are mocked. **Cancel purchase now has real Stripe Test Mode evidence** (owner-authorized 1 intent, below).

### Real Stripe Test Mode — Cancel purchase (owner-authorized 1 PaymentIntent, isolated stack, 2026-10-17)

- **Intent:** `pi_3URZGxKiVgdl63pN1DmbBj0U` on `acct_1UEZW5KiVgdl63pN` (1 of 1). No card was ever confirmed.
- **15:11:46–59 UTC:** checkout reached the Payment step (setup created the intent), Place Order was accepted (`/submit`), and the customer left. Stripe reads: `requires_payment_method`, no decline, no card.
- **Grace fast-forward (test acceleration only):** the disposable `submittedAt` was moved back 11 minutes and the work made due; no Stripe state was touched.
  - The first attempt used the DB session's local time zone (UTC+3) and put the timestamp 3 hours in the future, so the rule correctly did not fire. That was a test-script defect, corrected with UTC.
- **15:15:00:** the real worker read Stripe (nothing recorded) and recorded `PAYMENT_NOT_CONFIRMED`; the purchase stayed **Processing**.
- **UI (`real-stripe-cancel-continue.isolated.spec.ts`, PASSED in 24.1 s):**
  - Processing + "Card payment didn’t start … nothing was charged" + Check payment status + **Cancel purchase**;
  - confirmation dialog with "Return its items to my Cart" ticked by default (Cart scope);
  - after cancelling, the card left Pending purchases.
- **15:15:51 / 15:15:52:** `payment.cancel.requested` (fresh Stripe read re-verified, row locks); the worker cancelled the intent at Stripe and read back **`canceled`**.
- **End state:** `CANCELED / PAYMENT_CANCELED_BY_CUSTOMER`, provider `canceled`, **no order** (orders total unchanged at 1), items returned to the Cart **once**, still 2 real intents in total. No Incomplete, Not completed or Restore items text.
- **Screenshots:** `apps/frontend/test-results/isolated/real-cancel-{1-processing-cancelable,2-after-cancel}.png`.
- **Optional finding:** after verification the worker re-reads an idle `PAYMENT_NOT_CONFIRMED` purchase from Stripe every ~10 s instead of the 60 s idle back-off. That's extra provider traffic only, with no correctness impact.

## I. Migration Dependency Register

| Capability | Storage | Status | Notes |
|---|---|---|---|
| Confirmation-started evidence | `payment_attempts.confirmationStartedAt` | **Exists** (migration `20261016000000` applied in DEV) | Requires `PAYMENT_CONFIRMATION_SIGNAL=true`; without it the never-confirmed and cancel exceptions are inert by design |
| Durable failed-payment dismissal | `payment_attempts.dismissedAt` | **Exists in DEV** (read during the investigation) | No migration needed; verify presence in PROD before release |
| Never-confirmed evidence, customer cancellation | `payment_attempts.failureCode` (string) values `PAYMENT_NOT_CONFIRMED`, `PAYMENT_CANCELED_BY_CUSTOMER` | **Existing column** | No schema change |
| Cancellation audit (who and when) | Only `updatedAt` plus the structured log `payment.cancel.requested` | **Gap (P1)** | A durable `canceledBy` / `canceledAt` audit field would need a migration if required; the current audit relies on logs |
| Idempotency and reconciliation | Existing keys, leases, `stripe_events` | Exists | — |

**No acceptance criterion in this pass is blocked by an unapplied migration.**

## J. Remaining Defects and Risks

- **P0 Blocker:** none identified in application code. **Release gate:** shared DEV and PROD must set `PAYMENT_SHARED_MUTATIONS_APPROVED` on a reviewed, non-watched deployment, or payments stay disabled there by design.
- **P1:**
  - The `/submit` in-transaction round trips are unchanged, so DEV latency there remains high (remote database region).
  - No durable cancellation-audit field (see register).
  - The DEV Stripe CLI webhook route must point at the reviewed backend (the listener was stopped earlier).
- **P1:** the existing unrelated failure `cart.quantity-correction.integration.test.ts` (500 vs 200; no payment imports).
- **Optional:** a Cancel purchase action on the status page as well (currently on the Cart card only).

## K. Delivery Status

- **Implemented:** everything in sections B–D, plus the `/submit` response and the status page.
- **Verified:** unit and component tests; mocked browser navigation at 390px and 1366px; isolated real-PostgreSQL projection, dismissal and visual checks; earlier real Stripe journey for decline, Try Again and success.
- **Partially verified:** `/submit` latency (code-path reduction, no DEV measurement).
- **Verified with real Stripe Test Mode:** Cancel purchase (1 intent) and, earlier, decline / Try Again / success (1 intent).
- **Blocked by migration:** none.
- **Requires further authorization:** release-gate approval for shared deployments.
- **Readiness:** ready for the migration-related review, with the P1 items above. **Not self-approved; Task 03.6 remains OPEN.**
