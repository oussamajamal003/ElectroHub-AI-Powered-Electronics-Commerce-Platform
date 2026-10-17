# Payment latency and loading-state investigation

Date: 2026-10-14 · Branch `feature/Stripe` · HEAD `3d69b97` (uncommitted tree) · Workstream: PERFORMANCE, with Task 03.6 / OBSERVABILITY / CART coordination
Outcome: **no production source change.** The remaining evidence-backed savings are either cross-owner or API-contract changes, so they are submitted below as change requests (CCRs). The four loading problems are **not** declared fixed.

Evidence classes: [LOG] retained DEV logs · [DB-READ] bounded read-only DEV benchmark · [INTERCEPT] browser with intercepted APIs/SDK · [SRC] source inspection · [MOCK] offline tests.

## 1. Request-to-visible-state timeline per flow

Round-trip counts are for the current tree with `relationJoins` on. They are [SRC] counts confirmed by [DB-READ] where noted. Measured DEV round-trip latency is about 0.3–0.8 s per statement [DB-READ], with up to 5× variance between runs. Server execution is under 2 ms per statement [DB-READ, EXPLAIN], so latency is network-bound, not query-bound.

### 1.1 Cart skeleton

| Stage | Source | SQL round trips | Measured |
|---|---|---|---|
| Route mount → session refresh | `sessionRestore.ts` (AUTH, out of scope) | auth-owned | [LOG] historical 10.2–26.7 s |
| → `/api/auth/me` (sequential after refresh) | AUTH | auth-owned | [LOG] historical 9.1–24.6 s |
| → `GET /api/cart` (sequential after identity) | `requireAuth` 1 + `currentCart` 2 | 3 (was 5) [DB-READ] | p50 1.5–2.6 s, p95 2.4–5.5 s [DB-READ]; historical 18.2–18.6 s pre-joins [LOG] |
| ∥ `GET /payment-attempts` (parallel; holds skeleton only for an empty Cart) | `requireAuth` 1 + list 1 | 2 (was 5) [DB-READ] | p50 2.7 s, p95 5.6 s (was 7.1 s / 14.6 s) [DB-READ] |
| Response → cache → skeleton exit | `CartProvider`, `CartPage.tsx:69-72` | — | about 2–3 requests in sequence before content [INTERCEPT, 400 ms injected delay] |

Frontend behavior verified [INTERCEPT]: one Cart read per cold load; no refetch and no skeleton on client-side return; background refetches keep content (`isLoading` requires no data). The skeleton during a pending add replaces existing items by **documented design** (`docs/05_Features/CART.md:514`, "Cart shows a skeleton until confirmation"), so it was not changed. The dominant remaining cost is the three-request waterfall (refresh → me → cart), of which two steps belong to AUTH.

### 1.2 Stripe payment-input preparation

| Stage | Source | SQL round trips | Measured |
|---|---|---|---|
| Payment step → setup POST (`CheckoutPage.setup`) | frontend | — | inputs usable about one request after entering the step [INTERCEPT] |
| `requireAuth` | | 1 | |
| Stripe account id | `stripe.provider.ts` (memoized after the first call) | 0 | |
| Setup transaction, new attempt | `payment.service.ts` `setupMeasured` | BEGIN, idempotency lookup, customer check, attempt lock, cart lock, active-attempt lookup, purchase snapshot (2), nested create (attempt, work, one INSERT per item, read-back), COMMIT: about **12 + N items** | read portion only: p50 12.4 s, p95 20.4 s, max 23.4 s (was 18.5 / 28.1 / 42.5 s) [DB-READ] |
| Inline worker: provider intent creation plus fenced transaction(s) | `process()` | additional fenced transactions plus a Stripe create | **not measured** |
| Response projection (`projectStatus`) | `ownedStatus` 1, then `currentCart` 2 ∥ confirmation 1 | 3 on the critical path | |
| Elements mount → ready | `StripePaymentSession` (25 s ready deadline, then actionable error) | — | 1 setup POST, 1 mount [INTERCEPT]; live Stripe **not measured** |

The full setup request is about 25–35 round trips plus at least one Stripe call [SRC]. At the measured latency that is consistent with responses of tens of seconds, but **the full transaction and request duration are NOT VERIFIED**: no retained real setup trace exists, and measuring it requires a mutating request (section 5).

### 1.3 CheckoutProcessing / order processing

| Stage | Source | Measured |
|---|---|---|
| Place Order click → "Processing your order…" | `CheckoutPage.place` sets `pending` before any network request | 79–135 ms [INTERCEPT] |
| `submit` transaction | attempt and work locks, cart lock, `currentCart` (2), per-item update and delete, two updates | not measured |
| Stripe `confirmPayment` (browser) | provider | not measured live |
| `reconcile` → status projection | `ownedStatus` + `currentCart` ∥ confirmation | not measured |
| Bounded fallback | Checkout observation ends at 120 s and hands off to `/cart?purchase=<id>` | [INTERCEPT] 49/49 suite |

The loader is truthful: it never shows success without `hasVerifiedPayment` and never shows failure for UNKNOWN [INTERCEPT, Scenario 1 suite].

### 1.4 Saved-purchase and payment recovery

| Stage | Source | SQL round trips | Note |
|---|---|---|---|
| Each in-Checkout status poll (every 2 s after completion) | `requireAuth` 1 + `ownedStatus` 1 + `currentCart` 2 (∥ confirmation 1) | **4 on the critical path** | `currentCart` is measured at p50 880 ms, p95 1,090 ms [DB-READ] and is spent on a response field with no consumer (CCR-2) |
| Saved-purchases list (Cart / notifications, 15 s, bounded to 5 min) | `requireAuth` 1 + list 1 | 2 | p50 2.7 s [DB-READ] |
| Retry `resume` | `owned` 1, Stripe read, `purchaseItemsProjection` 1, transaction (BEGIN, 2 locks, read, update, COMMIT), `status` → `projectStatus` 3 | about 12 + Stripe | historical 53–64 s with a duplicate request contending on the same row lock [LOG]; duplicates now prevented in-process and on the client |

## 2. Reused measurements and their limits

| Metric | Value | Limits |
|---|---|---|
| Cart round trips | 5 → 3 | |
| Saved-purchases round trips | 5 → 2 | |
| Setup-read round trips | 10 → 8 | |
| Saved purchases p50 | 7.1 s → 2.7 s | |
| Setup-read p50 / p95 | 18.5 s → 12.4 s / 28.1 s → 20.4 s | |
| `currentCart` one-statement candidate | p50 880 ms → 452 ms, p95 1,090 ms → 573 ms; 13/13 carts identical | carts of at most 2 lines |
| Duplicate resume | two POSTs 35 ms apart (`324609cf…`, `402c0716…`); 53 s (503) and 64 s (200) | |

All runs were read-only, at concurrency 1, with 20 samples per strategy. Network latency varied up to 5×. Read-only timings do not establish full-transaction, lock-wait or commit improvement.

**New measurements: none.** Every remaining unknown needs either a mutating request or a change in another owner's code.

## 3. Loading-state correctness review

| Requirement | Status | Evidence |
|---|---|---|
| Cart leaves the skeleton once data is available | Holds | `CartPage.tsx:69-72`; `loading-baseline.spec.ts` asserts no skeleton on return |
| Background refetch keeps Cart content | Holds | `isLoading` requires `!serverQuery.data`; [INTERCEPT] "direct Cart refresh revalidates once…" |
| No indefinite Elements skeleton after a terminal setup error | Holds | `setupError` replaces the skeleton; 25 s Elements ready deadline (Task 03.6 fix); [INTERCEPT] "setup failure…", "genuine setup 503 remains actionable…" |
| Pending processing is truthful; UNKNOWN never becomes failure | Holds | `paymentPresentation.ts`; [INTERCEPT] Scenario 1 UNKNOWN, read-deadline and late-response tests |
| Reconciliation uses the same durable attempt; timeouts cannot double-charge | Holds | [INTERCEPT] same-attempt reconcile and single confirm assertions; [MOCK] backend single-flight and bounded retry |
| A/B isolation and late responses | Holds | [INTERCEPT] session-isolation and Scenario 1 late-503 tests |
| Recovery ends in a meaningful state | Holds | bounded 120 s Checkout handoff → Cart saved purchase (pending, outcome, failure with Try Again, or retriable list error) |

No loading-state defect was reproduced in this pass. The open problem is latency, not stuck or incorrect states.

## 4. Diagnostics capability

| Signal | Can it be distinguished today? |
|---|---|
| Connection acquisition | Partly: `acquisitionAndBeginMs` combines pool wait, network and BEGIN; `dbConnectionAcquisitionMs` stays null |
| Long relation-query sequences | **Setup only** (`operations[]`, `setupTransactionOperationCount`). Elsewhere **no**: all 78 sampled `db.*` events carry the server instance id, not a request id, because Prisma's `$on('query')` runs outside the request's async context (CCR-3) |
| Row-lock wait | Setup only, client-observed (`rowLockWaitMs` includes the round trip) |
| Transaction expiry | Yes: per-attempt outcome codes (P2028) in setup; handled-error `code` elsewhere |
| Client abort / disconnect | Yes: `http.aborted` (`requestLogger.ts:44,54`); setup HTTP performance `aborted` |
| Provider delay | Setup only (`stripeApiMs`, provider-mutation ambiguity) |
| Logger failure | Yes: `logging.synchronous_failure` and its counter; the original response is preserved ([MOCK] `errorHandler.logging-failure.test.ts`) |
| Unknown database error | Yes: `db.error` with `prismaCode: null` / `sqlState: null`; no code is invented |

**HTTP 503 (`324609cf…`):** a duplicate concurrent resume on the same row lock; logged only as `DATABASE_ERROR`, so the exact Prisma code is **UNKNOWN**. **Historical setup HTTP 500:** **UNKNOWN**. No correlated trace exists, and duration alone establishes nothing.

## 5. Payment transaction correctness and the full-transaction gate

No transaction boundary, isolation level, lock order, timeout or Stripe placement was changed. Stock, price and snapshot validation stay under the cart lock.

**Controlled acceptance run that would measure the full setup transaction** (requires separate owner authorization):
- Environment: the authorized disposable PostgreSQL target from the A–J suite (never shared DEV or PROD), Stripe Test Mode.
- Steps: one fixture customer with 1, 5 and 50-line carts; three setup POSTs per cart size; the existing `payment.setup.performance` fields recorded (per-attempt outcome, `acquisitionAndBeginMs`, statement and lock time, commit remainder, `longestSetupTransactionMs`, `stripeApiMs`).
- Pass criteria to be set by DATABASE and PAYMENT: no P2028; `setupTransactionBudgetExceeded=false`; p95 against an agreed budget; cleanup of the fixture attempts and intents through the harness's existing disposal path.

## 6. Change requests

### CCR-1 — Single-statement `currentCart` (DATABASE / CART / PAYMENT)
- **Problem and evidence:** `currentCart` runs two sequential statements (cart with items, then products). It runs inside the setup, submit and restore transactions while the cart row is locked, and on every status read. One nested read returned identical results for 13/13 DEV carts (including 9 excluded-product lines) and cut p50 from 880 to 452 ms [DB-READ].
- **Proposed change:** select `items.product` with the existing `productSelect` in the cart query (join strategy), map `product.isTestFixture ? null : product`, and build the same `{ cart, products, data }` return value.
- **Impact:** one fewer round trip, and less lock-held time, per call. No isolation, lock or shape change.
- **Blocking cost:** five test files run the real `currentCart` against stubs that pin the two-statement design (`cart.service.test.ts` asserts `product.findMany` called once with the `isTestFixture` filter; also `payment.service.test.ts`, `checkout.routes.test.ts`, `payment.routes.test.ts`, `cart.quantity-correction.integration.test.ts`). Eleven call sites.
- **Test plan:** update the stubs to the nested shape, keeping every availability assertion; EXPLAIN on a 50-line cart; A–J on disposable PostgreSQL.
- **Rollback:** revert the function; the stubs revert with it.

### CCR-2 — Drop the unused `cart` projection from payment status responses (PAYMENT / FRONTEND, API contract)
- **Problem and evidence:** `projectStatus` (`payment.service.ts:68-83`) runs `currentCart` (2 statements, p50 880 ms) for every status, setup, reconcile, resume and submit response, including each 2 s recovery poll. The frontend type declares `cart`, but no production code reads it. The only reader, `CartProvider.submitCheckout`, has no production caller.
- **Proposed change:** remove `cart` from the payment-status response, or make it opt-in.
- **Constraint:** the redesign states "Existing response fields remain", so this needs an explicit contract decision, an API documentation update and a mixed-version plan.
- **Impact:** in-Checkout status polls drop from 4 to 2 critical-path round trips (3 when an order exists). Setup, resume and reconcile responses each shed 2.

### CCR-3 — Request-correlated SQL timing (OBSERVABILITY)
- **Problem and evidence:** all sampled per-query `db.*` events carry the server instance id, so SQL round trips cannot be attributed to a request outside payment setup. This is why the historical 18 s Cart and 53–64 s resume could not be decomposed.
- **Proposed change:** attribute queries inside the request's async context, for example with a Prisma `$extends` query hook that records model, operation and duration only (no SQL text or parameters) under the current `requestId`, plus a per-request count on `http.completed`.
- **Constraints:** measure the overhead; preserve the sanitization rules; `prisma.ts` is actively owned by OBSERVABILITY.

## 7. Rollback

This pass added only this document. Delete it to roll back. Earlier accepted changes keep their recorded rollback procedures.
