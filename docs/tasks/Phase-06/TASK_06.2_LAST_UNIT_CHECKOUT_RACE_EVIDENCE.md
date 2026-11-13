# Task 06.2 — Last-Unit Inventory & Checkout Race: Evidence (PR #51)

Status legend: **PASS** (verified by an executed check or by direct code inspection, as stated) · **FAIL** · **NOT VERIFIED** · **NOT APPLICABLE**.

Provider behavior in every automated test here comes from deterministic doubles (`HarnessProvider` on real PostgreSQL, mocked providers in unit tests). It is **not** Stripe evidence. No live charge, refund, shared DEV/PROD order, real inventory reset or production migration was made.

Scenario: one unit is left. Customer A has it in the Cart or at Checkout. Customer B buys it. A then tries to pay.

---

## 1. Starting branch / SHA — PASS

- PR #51 branch `feature/06.2-accessibility-qa-ci-cd`. Work was done in an isolated worktree branch created from its remote tip `704166d` (`test(theme): align premium pages checks with theme preferences`).
- The working tree was clean at the start. The remote tip was still `704166d` when re-fetched before commit, so the push is a fast-forward.

## 2. Inventory lifecycle — PASS (code inspection)

```text
Cart add / update            → validate against stock (read only), never decrement, never reserve
POST /checkout/payment-attempts (setup)
                             → PaymentAttempt NOT_SUBMITTED/AWAITING_INPUT, PaymentIntent (manual capture), no stock change
POST …/submit                → Serializable transaction: attempt/work/cart rows FOR UPDATE, Cart lines move into the attempt,
                               NEW: assertStillPurchasable() stock gate (Cart and Buy Now) — a read, never a reservation
POST …/confirmation-started  → NEW: Serializable stock re-read right before the card can be authorized (never a reservation).
                               Sold out → durable cancelRequested + stock failureCode, unconfirmed intent cancelled and
                               re-read in the same request, 409 CART_STOCK_CONFLICT / PRODUCT_UNAVAILABLE; client never confirms
Stripe.js confirm (client)   → card authorized (requires_capture); nothing captured
webhook / durable worker     → OrderService.commitAuthorized: Serializable, inventory rows SELECT … FOR UPDATE (ordered by productId),
                               validateInventoryPurchase, decrement, create Order   ← the ONLY stock decrement
                               CHECKOUT_CONFLICT (contention) → re-committed within the same pass, 3 rounds, 50/100/200 ms + jitter
                             → capture → PAID
loser (stock gone at commit) → no Order, no decrement; authorization cancelled (never captured)
                               → CANCEL_PENDING → CANCELED only after a fresh provider read says `canceled`
```

## 3. Cart no-reservation policy — PASS (preserved)

- Adding to the Cart, setup and Elements reserve nothing. This is unchanged.
- The new submit gate is a read inside the existing Serializable submit transaction. It writes no stock and holds no lock past the transaction.
- The new confirmation-started gate is the same kind of read. It locks only the purchase's own `payment_attempts`/`payment_work` rows, never inventory.
- Restoring a sold-out purchase adds an OUT_OF_STOCK Cart line. A Cart line reserves nothing, and checkout stays blocked until restock.
- Scenario T (existing) still proves Add to Cart reserves nothing.

## 4. Commitment point — PASS (code inspection + real PostgreSQL scenario Z1/Z4)

- The commitment point is still `OrderService.commitAuthorized` (`apps/backend/src/services/order.service.ts`). It runs Serializable, locks inventory `FOR UPDATE`, and calls `validateInventoryPurchase`.
- Transactional locks were **not** weakened. `order.service.ts` is unchanged by this PR.

## 5. Authorization-before-commit — PASS (window narrowed to the minimum without reservations; residual risk noted)

- The card is authorized (manual capture) before the stock commit. Without Cart reservations (forbidden for this task), a sale can only be detected before authorization, not prevented.
- Submit refuses with the standard stock 409 when the item is already sold out at Place Order (scenario Z2/Z3). A's card is never authorized.
- **New (closes the card-entry window):** `POST …/confirmation-started` re-reads stock immediately before Stripe.js may confirm the card. The client confirms only after a 200. If B bought the unit while A was entering card details:
  - the server records `cancelRequested` and the stock `failureCode` durably, before any provider call;
  - in the same request, it cancels the unconfirmed intent and re-reads it; the purchase settles `CANCELED` with `outcomeReason: STOCK_UNAVAILABLE`, `authorizationReleased: true`;
  - it answers 409 `CART_STOCK_CONFLICT` / `PRODUCT_UNAVAILABLE`. The client never calls Stripe.js, so there is no authorization and no bank hold (scenario Z5; unit and component tests).
  - The gate runs whether or not the confirmation-signal flag is enabled.
- **Remaining window:** a sale that commits between A's confirmation-started and A's own commit still authorizes A and then cancels. Card entry is already over by then; the gap is typically the seconds Stripe.js and 3-D Secure take. A is never captured. Only a stock reservation could close this, and this task rules reservations out.

## 6. Cancellation and reconciliation — PASS (unit + real PostgreSQL scenario Z1)

- Loser branch in `PaymentService.process()`: `CANCEL_PENDING` with `failureCode` → `provider.cancel` → **fresh `provider.retrieve`** → `CANCELED` only when that read says `canceled`. Otherwise the work stays READY and the next pass re-verifies.
- An unknown or unconfirmed cancellation is never presented as "not charged". It is not refunded or cancelled blindly.
- `CHECKOUT_CONFLICT` (serialization exhaustion, P2002, P2025) is **not** a stock outcome. It is re-committed **within the same processing pass** up to `COMMIT_CONFLICT_RETRIES = 3` more times, with a backoff of `COMMIT_CONFLICT_BACKOFF_MS = 50` × 2^round plus jitter (≈ 50/100/200 ms). The worker lease is re-checked before every round. Only a conflict that persists after that releases the authorization, in the same pass. Contention no longer causes durable "checking" retries.
- A sold-out refusal at confirmation-started uses the existing explicit-cancellation path: `CANCEL_PENDING` → cancel → fresh retrieve → `CANCELED`. If that pass fails, the durable runner finishes it, and the customer sees "checking", never "not charged".
- Replays with a fresh runner change nothing (Z1).

## 7. Defects — PASS (all found by code inspection, reproduced by tests)

| # | Defect | Impact |
|---|---|---|
| D1 | A stock loser (CANCELED, `CART_STOCK_CONFLICT`) was shown as a generic "Payment failed" | False result: implied a card problem |
| D2 | The processing screen said "You won't be charged twice." | Claim not backed by a provider check |
| D3 | `CANCELED` was persisted from the cancel call's reply alone | Could say "released" without a verified provider read |
| D4 | `CHECKOUT_CONFLICT` (serialization exhaustion) cancelled the authorization immediately | A legitimate buyer could lose a purchase to transient contention |
| D5 | A submit stock shortfall surfaced as generic `CHECKOUT_CHANGED` | Inaccurate message; no stock detail |
| D6 | Buy Now submit had no stock check | Card authorized for an item already sold out |
| D7 | No stock read between Place Order and card confirmation | A sale during card entry still authorized A's card, then cancelled it (bank hold) |
| D8 | Contention retries were durable passes | The customer saw "checking" through several backoff passes instead of a result |
| D9 | Restore of a sold-out purchase was refused while stock was 0 | A could not recover the saved purchase until a restock |

## 8. Fixes — PASS

- D1: additive status fields `outcomeReason` (`STOCK_UNAVAILABLE` | null), `authorizationReleased` (provider-verified) and `unavailableItems`. The frontend now has a sold-out state (`SoldOutRecovery`) and sold-out purchase cards. The existing `classification` contract is unchanged (CANCELED stays `FAILED`).
- D2: copy changed to "Please don’t submit another payment while this is in progress."
- D3: `released = intent.status === 'canceled'` from a fresh retrieve.
- D4/D8: `CHECKOUT_CONFLICT` is retried within one pass (`commitWithinPass`: 3 rounds, short jittered backoff, lease re-check). After that, the authorization is released in the same pass.
- D7: `refuseSoldOutConfirmation()` at `confirmation-started` (see §5). Frontend: `announceConfirmation` throws `ConfirmationStockRefused` on that 409, and Checkout shows the sold-out outcome from the status read. Stripe.js is never called.
- D9: restoring a `STOCK_UNAVAILABLE` Cart purchase is allowed at 0 stock, and the line comes back flagged OUT_OF_STOCK.
  - A withdrawn product is refused with 409 `PRODUCT_UNAVAILABLE`.
  - Buy Now is still `PURCHASE_NOT_RESTORABLE`.
  - Other outcomes keep the purchasable rule (`CHECKOUT_CHANGED`).
  - The UI offers **Save to Cart** on the sold-out Checkout screen and on the sold-out saved-purchase card.
- D5/D6: `assertStillPurchasable()` in submit for Cart and Buy Now raises the standard 409 `CART_STOCK_CONFLICT` / `PRODUCT_UNAVAILABLE` with the product name and available quantity.
- Swagger/OpenAPI: the status response documents the new fields. Submit, confirmation-started and restore document their 409 codes.

## 9. Two-customer scenario — PASS in code + unit tests; real PostgreSQL: see §13

Scenario Z (`payment.last-unit.postgres.integration.test.ts`), stock = 1:

- **Z1** — A and B both authorized, commit released concurrently through a barrier:
  - One PAID and one CANCELED. Stock 1 → 0, never negative. Exactly 1 order and 1 capture.
  - The loser intent is canceled, with received 0 and capturable 0.
  - Loser status: `outcomeReason` STOCK_UNAVAILABLE, `authorizationReleased` true, `retryAllowed` false, and `unavailableItems` = qty 1, available 0, OUT_OF_STOCK.
  - Winner: SUCCEEDED, no stock outcome.
  - Restore → 200. The Cart holds a qty-1 OUT_OF_STOCK line with `canCheckout` false, stock stays 0, and `restoredAt` is set.
  - A second restore changes nothing (idempotent), and neither do replays.
- **Z2** — B buys first; A's Cart submit → 409 `CART_STOCK_CONFLICT`.
  - `submittedAt` stays null and the intent is still `requires_payment_method` (never authorized).
  - The Cart line is kept and flagged OUT_OF_STOCK with `canCheckout` false. A can remove it.
- **Z3** — A Buy Now submit after the sale → 409 `CART_STOCK_CONFLICT`. A's Cart is untouched.
- **Z4** — Buy Now vs Cart race: one PAID, one CANCELED with the stock code. A Buy Now loser's restore → `PURCHASE_NOT_RESTORABLE`.
- **Z5** — A submits, then B buys outright while A is in card entry:
  - A's `confirmation-started` → 409 `CART_STOCK_CONFLICT`; a repeat → 409.
  - The attempt is CANCELED with `CART_STOCK_CONFLICT`, providerStatus `canceled`, no order, and `confirmationStartedAt` null.
  - The intent is canceled with received 0 and capturable 0; it was never confirmed.
  - Status shows `STOCK_UNAVAILABLE` and `authorizationReleased` true. Restore puts an OUT_OF_STOCK line in the Cart.
  - Stock 0, exactly 1 order and 1 capture (B's).

## 10. Provider failure scenarios — PASS (mocked provider; not Stripe evidence)

- The cancel reply says canceled but a fresh read doesn't: the attempt stays `CANCEL_PENDING`, work READY, no capture. The next pass → CANCELED/DONE.
- `CHECKOUT_CONFLICT` twice, then success → commit called 3 times in one pass, captured once, no cancel, `work.retryCount` 0.
- Persistent `CHECKOUT_CONFLICT` → commit called 4 times (1 + 3 retries) in one pass, then CANCELED with providerStatus `canceled`, no capture.
- Lease lost between rounds → commit called once, no cancel, state stays AUTHORIZED (the new lease holder decides).
- Confirmation-started stock gate (mocked DB):
  - Sold out: 409 with the product name. The cancel decision is written in the transaction before `process`, and the confirmation marker is not recorded.
  - Withdrawn: `PRODUCT_UNAVAILABLE`.
  - In stock: the marker is recorded and nothing is cancelled.
- Existing stock-conflict cancel tests still pass.

## 11. Cart and saved-attempt recovery — PASS

- Cart scope, sold out before submit: the line stays in the Cart, flagged OUT_OF_STOCK, and A can remove it (Z2).
- Cart scope, lost at commit or refused at confirmation-started (Z1, Z5):
  - **Save to Cart** returns the items as OUT_OF_STOCK lines, once, after the provider has verified the release.
  - Stock is untouched, nothing is reserved, and checkout stays blocked until restock.
  - The sold-out card offers no Try Again. Dismiss stays available when the server says `dismissible`.
- Withdrawn product: restore is refused with `PRODUCT_UNAVAILABLE` and the server's message, and Save to Cart is not offered.
- Buy Now loser: `PURCHASE_NOT_RESTORABLE`; the Cart is untouched.

## 12. Frontend out-of-stock behavior — PASS (component tests); Visual QA: NOT VERIFIED

- **Checkout, stock outcome:** shows `PackageX` icon with "This item sold out" / "Some items sold out", plus the product, the quantity requested and its availability. Copy depends on whether the provider has verified the release:
  - **Released:** "Your card was not charged. The payment for this order was cancelled.", plus the bank-hold line. Actions:
    - Save to Cart, for Cart purchases with no withdrawn item, with a hint that nothing is reserved;
    - Continue shopping and View product;
    - Return to Cart, when Save to Cart isn't offered.
  - **Not released:** the cancelling/checking copy and a "Check again" action only. It never says "not charged".
- **Submit refusal:** shows the standard 409 message plus "Review your Cart/order to continue.". It never shows the Processing screen.
- **Confirmation-started refusal:** Stripe.js is not called. The page shows "This item sold out" from the status read, never "the outcome is not yet known".
- **Contention:** the result comes from the same processing pass, with a few hundred milliseconds of backoff at most. There are no durable "checking" retries.
- **Saved purchase cards:** "Sold out · Not charged" or "Sold out · Checking payment". Try Again is never offered. Released Cart purchases offer "Save to Cart".
- **"Processing your order…":** already bounded by `CHECKOUT_RECOVERY_WINDOW_MS` (120 s), after which it hands off to `/cart?purchase=`.
- Not done for the new UI: Figma comparison and Playwright screenshots. **Visual QA: NOT VERIFIED.**

## 13. Real PostgreSQL concurrency evidence — NOT VERIFIED locally; CI pending

- The runner `payment-pg-disposable.cjs` has a new suite, `scenarios-A-Z` (A–Y plus Z, 4 files). Scenario Z now covers Z1–Z5.
  - CI's `payment-postgres` job now runs `--scope=scenarios-A-Z` with authorization `DISPOSABLE:electrohub_ci:scenarios-A-Z:fixtures+reset-run-database`.
  - `verifyReport` requires exactly one passing test for each letter A–Z.
- Not run locally. This machine has no Docker, and its local PostgreSQL is 18 (a shared service). The runner requires a fresh, dedicated PostgreSQL 17 with a per-run CA, and this was not weakened.
- Result: see the PR #51 CI run for the final SHA.

## 14. Exact commands and counts

Run in the worktree, with the unit env pointed at a loopback `electrohub_ci_unit_never_connects` URL that is never connected:

| Command | Result |
|---|---|
| backend `npm run typecheck` | exit 0 |
| backend `npm run lint` | exit 0, 0 errors |
| backend `npm run build` | exit 0 |
| backend `npx vitest run src/services/__tests__/payment` | 16 files passed, 5 skipped (DB suites, no DB by design); 359 passed, 52 skipped |
| backend `node --test scripts/payment-pg-disposable.test.cjs` | 23/23 passed |
| OpenAPI spec load (`src/docs/swagger/index.ts`) | submit, confirmation-started and restore each document 200/404/409 with their codes; status `data` has `outcomeReason`, `authorizationReleased`, `unavailableItems` |
| frontend `npm run typecheck` | exit 0 |
| frontend `npm run lint` | 0 errors, 4 pre-existing warnings in unrelated files |
| frontend `npx vitest run src/features/checkout` | 21 files, 298/298 passed |
| frontend `npm run build` | exit 0 (existing chunk-size warning) |

The full suites were run at `0a4dfb4` and not re-run for this change:

- Backend `npm run test:ci`: 147 files passed and 14 failed. All 14 failures were environmental:
  - no reachable DB, by design;
  - `ELECTROHUB_ENV_FILES=none`;
  - `EADDRINUSE`;
  - Windows `ENOTEMPTY`;
  - load timeouts;
  - a swagger 5 s timeout that also occurs with the previous routes file.
- Frontend full suite: 1549/1550. The one failure was a timing flake in an unrelated CheckoutPage test, which passed 3/3 when run alone.

## 15. Browser results — NOT VERIFIED locally

- No Playwright run was done locally for this change.
- CI `release-e2e` runs the existing release and quality suites on Chromium, Firefox and WebKit. That is regression evidence only; no browser test drives the new sold-out state.

## 16. CI — see PR #51 final-SHA run

- Recorded in the PR #51 description after push. Local results are not CI results.

## 17. Changed files

Backend:
- `src/services/payment.domain.ts`
- `src/services/payment.service.ts`
- `src/routes/payment.routes.ts`
- `scripts/payment-pg-disposable.cjs`
- `scripts/payment-pg-disposable.test.cjs`
- `src/services/__tests__/helpers/payment-postgres-harness.ts`
- `src/services/__tests__/payment.service.test.ts`
- `src/services/__tests__/payment.session-isolation.test.ts`
- `src/services/__tests__/payment.confirmation-signal.test.ts`
- new: `src/services/__tests__/payment.last-unit.test.ts`
- new: `src/services/__tests__/payment.last-unit.postgres.integration.test.ts`

Frontend (`src/features/checkout/`):
- `types.ts`
- `confirmationSignal.ts`
- `CheckoutComponents.tsx`
- `CheckoutPage.tsx`
- `PaymentPurchases.tsx`
- `PaymentRecovery.tsx`
- `Checkout.module.scss`
- `CheckoutPage.test.tsx`
- `PaymentPurchases.test.tsx`
- `PaymentRecovery.test.tsx`
- `confirmationSignal.test.ts`

CI and docs:
- `.github/workflows/ci.yml`
- this file
- `TASK_06.2_PAYMENT_INVENTORY_INTEGRITY_EVIDENCE.md` (scope pointer)

## 18. Residual risks

- **Authorization window (narrowed, not eliminated):**
  - A sale during card entry is now refused before authorization.
  - A sale that commits after A's confirmation-started but before A's commit still produces authorize → cancel. That gap is the seconds Stripe.js and 3-D Secure take.
  - A may briefly see a pending hold and is never captured.
  - Closing it fully requires a stock reservation, which this task forbids.
- **Client that skips confirmation-started:** an outdated or non-conforming client could confirm without calling it. The server-side commit is still authoritative: authorize → cancel, never captured.
- **Fake provider:** the provider is a deterministic fake, so real Stripe cancel latency and failure modes are not proven.
- **Contention:** a commit that keeps conflicting for about 350 ms, on top of its internal serialization retries, releases the authorization.
  - The customer sees that result instead of "checking".
  - Under extreme sustained contention, a legitimate buyer could lose. This is the bounded trade-off.
- **Background cancellation:** if the in-request cancellation after a confirmation-started refusal fails, the durable runner completes it. Until then the customer sees "checking", never "not charged".
- **Restore while sold out:** now allowed. Restored lines are OUT_OF_STOCK in the Cart. They reserve nothing, so another shopper can still buy a restocked unit first.
- **Visual QA:** NOT VERIFIED for the new sold-out UI.

## 19. Final SHA — recorded in the PR #51 description

## 20. PR URL — PASS

https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/51
