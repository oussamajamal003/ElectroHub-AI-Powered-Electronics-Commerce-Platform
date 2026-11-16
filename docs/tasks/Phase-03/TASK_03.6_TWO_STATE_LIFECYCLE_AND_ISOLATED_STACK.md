# Task 03.6 — Two-State Payment Lifecycle, Disabled-Environment Handling and Isolated Payment Stack

Status: **OPEN — pending Principal Architect review. No commit, push or deployment.**
Date 2026-10-17 (UTC). No shared DEV/PROD writes, no migrations, no Stripe calls, no PaymentIntents.

## 1. Root cause of each reported error (evidence: shared backend log)

| Error | Request | Response | Cause |
|---|---|---|---|
| A — "This payment could not be removed…" | `POST /api/checkout/payment-attempts/:id/dismiss` | **503 `PAYMENT_MUTATIONS_DISABLED`** (13:21:25) | Intended isolation guard on the watched shared-DEV backend. UI defect: the dialog showed a generic "try again" message. |
| B — "Secure payment setup could not finish… Retry" | `POST /api/checkout/payment-attempts` | **503 `PAYMENT_MUTATIONS_DISABLED`** ×4 (last 13:25:11) | Same guard. UI defect: shown as a retryable setup failure. |
| C — "Saved purchases could not be updated" | `GET /api/checkout/payment-attempts` | every logged read **200** (p90 2.0 s, max 3.4 s) | **Not the guard.** The failed reads never reached the server. The watched backend restarted on file saves (11:42, 11:44, 12:29, 13:36, 13:55, 13:56), and the list query had `retry: false`, so a single dropped read showed the banner. |

## 2. Customer-facing lifecycle (owner decision)

After Place Order is accepted: **Processing** (Pending purchases, Check payment status) → **Payment failed** (Failed payments, Try Again) or **Paid** (Orders).
**Removed everywhere:** Not completed, Incomplete purchases, Restore items (Cart card *and* status page), Checkout saved, Continue to payment, and the client `release-unconfirmed` endpoint and its calls.

| Situation | Internal record | Customer sees |
|---|---|---|
| Accepted, confirmation pending or in flight; customer navigates, refreshes, goes Back or closes Checkout | `AWAITING_INPUT` (unchanged) | **Processing**. Nothing is released or cancelled. |
| Stripe decline | `DECLINED / PAYMENT_DECLINED` | **Payment failed** + Try Again |
| Confirmation verifiably never reached Stripe (signal on; no marker 10 min after submit; Stripe records nothing) | `DECLINED / PAYMENT_NOT_CONFIRMED` (classification `FAILED`, never "declined"). **The intent is not cancelled.** | **Payment failed** + Try Again, which reopens a fresh card entry on the **same** intent (no new PaymentIntent, nothing charged) |
| Paid | `PAID` + Order | Order confirmed |
| Historical cancelled-before-payment rows (`PAYMENT_INCOMPLETE`, submitted `PAYMENT_EXPIRED`) | unchanged | **Payment failed**, no Try Again (intent cancelled); dismissible |

Safety:
- A NOT_CONFIRMED purchase stays stable on later recovery passes. A real decline or an authorization after Try Again still wins.
- A late confirmation announcement wins under the row lock.
- A provider decline is never lapsed or cancelled.

## 3. Disabled environment (payment isolation) handling

- **New** `GET /api/checkout/payment-capability` (authenticated, boolean only, `no-store`).
- **Checkout:** when payments are disabled, it shows "Checkout and payment changes are temporarily unavailable in this environment. Nothing was charged…" and never attempts setup or offers a retry. A 503 `PAYMENT_MUTATIONS_DISABLED` or `PAYMENT_CONFIGURATION_UNAVAILABLE` response gives the same state.
- **Cart:** purchases stay readable. Remove and Try Again are not offered, and a notice explains why.
- **Remove dialog:** maps the 503 to the same message and never claims a removal.
- **List read:** retries transport failures, timeouts and 5xx responses twice (1 s, 2 s). It never retries a 4xx or a malformed contract, and keeps the existing stale-data wording.

## 4. Isolated payment stack (provisioned this pass)

| Component | Result |
|---|---|
| Existing Postgres on `127.0.0.1:55432` | **Not used.** It belongs to another Claude session's acceptance harness (data directory in session `74bb8d1e…` scratchpad); its contents can't be proven disposable. |
| New disposable PostgreSQL 17 | Its own cluster in this session's scratchpad, `localhost:55433/electrohub_disposable`, loopback only, scram auth, **verified TLS** (`verify-full` against a per-run CA). 19 migrations applied. |
| Fixtures | Product/review seed plus **generated** test customer and admin credentials (scratchpad file, not `.env`). `assertDevSeedTarget` now also accepts a verified disposable target (same rule as the isolation boundary). No real customer or financial data was copied. |
| Isolated backend | `:5200`, started without watch, Stripe key and webhook secret **empty** (so no Stripe call or PaymentIntent is possible), separate log directory. Startup: `payment.isolation.resolved allowed=true target=disposable identity=localhost:55433/electrohub_disposable`. Its only connections were 3 × `127.0.0.1:55433`. Recovery runner not started (no Stripe key). |
| Isolated frontend | Vite `:3200` → proxy `:5200`. |
| Shared DEV backend | Every reload stays `allowed=false … watched-dev-server-on-shared-target` (latest 13:56:11). No live payment claims; the only claim lines are this session's mocked test runs. |

### Exercised on the isolated stack (real PostgreSQL; no Stripe)

- **Signed in, read, added to Cart:** login 200, capability `{paymentsEnabled:true}`, product read 200, add to Cart 201, quote eligible.
- **Payment setup:** **503 `PAYMENT_CONFIGURATION_UNAVAILABLE`**, no client secret and **0** payment attempts created. **The Payment Element can't load without an authorized Stripe Test Mode allowance.**
- **Projection, fixture by fixture:**
  - `AWAITING_INPUT` → PROCESSING (pending);
  - `CANCELED/PAYMENT_INCOMPLETE` → FAILED (no Try Again);
  - `DECLINED/PAYMENT_NOT_CONFIRMED` → FAILED (Try Again);
  - `DECLINED/PAYMENT_DECLINED` → DECLINED (Try Again);
  - no `restorable` field.
- **Dismissal:**
  - 200, then 200 again with the same `dismissedAt` (idempotent);
  - card gone from the list; 404 for a foreign id;
  - the row, state, code, intent, total and item are preserved, with only `dismissedAt` set.
- **Playwright** `playwright.isolated.config.ts` at 1366px and 390px: **2 passed**. Processing + Check payment status and Payment failed + Try Again are visible; no Incomplete, Not completed, Restore items, Checkout saved or Continue to payment text; no horizontal overflow. Screenshots: `apps/frontend/test-results/isolated/cart-payment-states-{1366,390}.png`.

## 5. Real DEV purchases (read-only; no record changed)

- **MacBook Air 15 1TB Starlight `aac568f8`** (customer B): `CANCELED / PAYMENT_INCOMPLETE`, intent cancelled by the 11:02 hot-reload incident, no order, nothing captured per backend reads. It is now presented as **Payment failed** (no Try Again possible, since the intent is cancelled), no longer as Not completed. Stripe-side verification is still blocked (wrong connector account).
- **iPad `327705a5` and `5c9261c5`, MacBook `aab01e3a`, Buds2 `bf43a065`:** same rule, Payment failed. Most were already dismissed by the customer.

## 6. Tests (actually run)

| Suite | Result |
|---|---|
| Backend `vitest src` + `tests/product.seed.test.ts` | **765 passed**, 55 skipped, 3 failed. Two are auth tests that timed out under load (5 s) while the isolated stack was running; both **pass when rerun alone**, and auth code was not changed this session. The third is the existing unrelated `cart.quantity-correction.integration.test.ts`. |
| Frontend `vitest src/features/checkout` | **250 passed** |
| Playwright `payment-recovery-navigation` (mocked API, 390px + 1366px) | **14 passed** |
| Playwright isolated stack (real backend + disposable PostgreSQL) | **2 passed** |
| Typecheck / lint / build (backend + frontend), `git diff --check` | all clean |

Key regressions:
- **Unmount and navigation:** unmount during a slow submit means no confirmation, no release or cancel, and the purchase stays discoverable.
- **Signal failure:** a failed confirmation signal never reaches Stripe and is never released.
- **Never-confirmed:** becomes Payment failed without cancelling or creating anything, and stays stable; a later decline or authorization wins.
- **Try Again:** on a never-confirmed purchase, uses the same intent with no financial effects.
- **No removed states:** no Not completed, Incomplete purchases or Restore items anywhere.
- **Disabled environment:** shows the maintenance state with no retry and no setup attempt.
- **Read retry:** a dropped list read is retried.
- **Capability endpoint:** auth, boolean only, no-store.
- **Seed guard:** accepts only a verified disposable target.

Real-stack refresh and Back during Processing: covered by the mocked navigation suite (refresh/forward/Checkout B) and the handoff tests. They were not exercised against Stripe.

## 7. Changed files (this pass)

- **Backend:**
  - `src/services/payment.domain.ts`
  - `src/services/payment.service.ts`
  - `src/routes/payment.routes.ts` (capability; release route removed)
  - `prisma/product-seed.ts`
  - tests: `payment.service.test.ts`, `payment.confirmation-signal.test.ts`, `payment.purchase-ownership.test.ts`, `payment.classification.test.ts`, `payment.routes.test.ts`, `src/__tests__/payment-isolation.test.ts`, `tests/product.seed.test.ts`.
- **Frontend:**
  - new `src/features/checkout/paymentCapability.ts`
  - `CheckoutPage.tsx`, `PaymentPurchases.tsx`, `PaymentRecovery.tsx`, `DismissFailedPurchase.tsx`, `confirmationSignal.ts`, `types.ts`
  - tests: `CheckoutPage.test.tsx`, `PaymentPurchases.test.tsx`, `PaymentRecovery.test.tsx`, `RestoredPurchase.test.tsx`
  - new `playwright.isolated.config.ts` and `tests/isolated/cart-payment-states.isolated.spec.ts`.

## 8. Remaining blockers

1. **Stripe Test Mode allowance** (suggested 3 PaymentIntents) plus a Test Mode key for the isolated backend, to verify the Payment Element, the decline, the success and the Try Again flows for real.
2. **Read-only Stripe access** to `acct_1UEZW5KiVgdl63pN`, to verify the historical intents.
3. **Shared DEV and PROD** must set `PAYMENT_SHARED_MUTATIONS_APPROVED` on a reviewed, non-watched deployment, or payments stay disabled there by design.
4. **Isolated stack processes still running:** Postgres `:55433`, backend `:5200`, frontend `:3200`. They hold disposable data only and can be stopped at any time.

## 9. Real Stripe Test Mode acceptance on the isolated stack (owner-authorized, 2026-10-17)

**Authorization:** up to 3 Test Mode PaymentIntents, isolated stack only, account `acct_1UEZW5KiVgdl63pN`.
**Used: 1 of 3** (`pi_3URYW5KiVgdl63pN0rV3qd2L`). **Remaining: 2, unused.** The historical 70/70 ledger was not reset or touched.

**Setup:**
- The isolated backend was restarted with the Test Mode key loaded from `.env` by the app itself (not printed or handled), and the database forced to the disposable target.
- Startup: `allowed=true target=disposable identity=localhost:55433/electrohub_disposable`; in-process recovery running; connections only to `127.0.0.1:55433` besides Stripe.
- No webhook listener; recovery polled Stripe.

**Journey** (`apps/frontend/tests/isolated/real-stripe-one-intent.isolated.spec.ts`, opt-in `ISOLATED_REAL_STRIPE=authorized`, `retries: 0`, Chromium 1366px). **PASSED in 53.4 s.**
- **Hard gates before any card confirmation:** isolated URL only; the database identity must be `electrohub_disposable|55433`; 0 real intents before the run; exactly 1 after setup, bound to `acct_1UEZW5KiVgdl63pN`.

| Step | Evidence (real) |
|---|---|
| Payment Element | Mounted with an empty card field after setup created the single intent (`real-1-payment-element.png`) |
| Decline | Stripe test card `4000 0000 0000 0002`. Stripe status `requires_payment_method`, **declined=true** (14:23:40). DB `DECLINED / PAYMENT_DECLINED`, no order. UI shows **Payment Failed** with "was declined" (`real-2-payment-failed.png`) |
| Try Again | Same intent. Fresh, empty card field (asserted). Still exactly 1 intent |
| Success | Stripe test card `4242 4242 4242 4242`. Stripe status **`requires_capture`**, card attached (14:23:53), then captured. DB attempt `PAID`, provider `succeeded`, amount 65800 cents. **1** order, `CONFIRMED`, total 658.00. UI navigated to Order Confirmed (`real-3-order-confirmed.png`) |
| Stock and Cart | Exactly **1** inventory row changed (the purchased product, stock now 12, at 14:23:53.785 = commit); no change on decline. Cart lines after: 0 |
| No duplicates | 1 intent, 1 order, 1 capture; no Incomplete, Not completed or Restore items text (`real-4-cart-after-paid.png`) |

Screenshots: `apps/frontend/test-results/isolated/real-{1..4}-*.png`.

**Evidence class:**
- **Real** Stripe Test Mode, read by the isolated backend's own provider calls.
- **Not** verified through a direct Stripe Dashboard or API read, because the connector reaches a different account.
- The before-value of stock wasn't captured, so "decrement by exactly 2" is inferred, not proven.
