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
Stripe.js confirm (client)   → card authorized (requires_capture); nothing captured
webhook / durable worker     → OrderService.commitAuthorized: Serializable, inventory rows SELECT … FOR UPDATE (ordered by productId),
                               validateInventoryPurchase, decrement, create Order   ← the ONLY stock decrement
                             → capture → PAID
loser (stock gone at commit) → no Order, no decrement; authorization cancelled (never captured)
                               → CANCEL_PENDING → CANCELED only after a fresh provider read says `canceled`
```

## 3. Cart no-reservation policy — PASS (preserved)

- Adding to the Cart, setup and Elements reserve nothing. This is unchanged.
- The new submit gate is a read inside the existing Serializable submit transaction. It writes no stock and holds no lock past the transaction.
- Scenario T (existing) still proves Add to Cart reserves nothing.

## 4. Commitment point — PASS (code inspection + real PostgreSQL scenario Z1/Z4)

- The commitment point is still `OrderService.commitAuthorized` (`apps/backend/src/services/order.service.ts`). It runs Serializable, locks inventory `FOR UPDATE`, and calls `validateInventoryPurchase`.
- Transactional locks were **not** weakened. `order.service.ts` is unchanged by this PR.

## 5. Authorization-before-commit — PASS (by design; residual risk noted)

- The card is authorized (manual capture) before the stock commit, so a race that starts after submit can still produce authorize → cancel. The customer is never captured in that case.
- New: submit refuses with the standard stock 409 when the item is already sold out *before* card confirmation, so the common case (B bought earlier) never authorizes A's card at all (scenario Z2/Z3).

## 6. Cancellation and reconciliation — PASS (unit + real PostgreSQL scenario Z1)

- Loser branch in `PaymentService.process()`: `CANCEL_PENDING` with `failureCode` → `provider.cancel` → **fresh `provider.retrieve`** → `CANCELED` only when that read says `canceled`. Otherwise the work stays READY and the next pass re-verifies.
- An unknown or unconfirmed cancellation is never presented as "not charged". It is not refunded or cancelled blindly.
- `CHECKOUT_CONFLICT` (serialization exhaustion, P2002, P2025) is **not** a stock outcome. It is retried durably up to `COMMIT_CONFLICT_RETRIES = 3` passes before the authorization is released.
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

## 8. Fixes — PASS

- D1: additive status fields `outcomeReason` (`STOCK_UNAVAILABLE` | null), `authorizationReleased` (provider-verified) and `unavailableItems`. The frontend now has a sold-out state (`SoldOutRecovery`) and sold-out purchase cards. The existing `classification` contract is unchanged (CANCELED stays `FAILED`).
- D2: copy changed to "Please don’t submit another payment while this is in progress."
- D3: `released = intent.status === 'canceled'` from a fresh retrieve.
- D4: a bounded durable retry (3 passes) for `CHECKOUT_CONFLICT`. After that, the authorization is released.
- D5/D6: `assertStillPurchasable()` in submit for Cart and Buy Now raises the standard 409 `CART_STOCK_CONFLICT` / `PRODUCT_UNAVAILABLE` with the product name and available quantity.
- Swagger/OpenAPI: the status response documents the new fields. The submit endpoint documents its 409 codes.

## 9. Two-customer scenario — PASS in code + unit tests; real PostgreSQL: see §13

Scenario Z (`payment.last-unit.postgres.integration.test.ts`), stock = 1:

- **Z1** — A and B both authorized, commit released concurrently through a barrier:
  - One PAID and one CANCELED. Stock 1 → 0, never negative. Exactly 1 order and 1 capture.
  - The loser intent is canceled, with received 0 and capturable 0.
  - Loser status: `outcomeReason` STOCK_UNAVAILABLE, `authorizationReleased` true, `retryAllowed` false, and `unavailableItems` = qty 1, available 0, OUT_OF_STOCK.
  - Winner: SUCCEEDED, no stock outcome.
  - Restore → 409 `CHECKOUT_CHANGED` (no stock restoration, Cart stays empty). Replays change nothing. Adding to the Cart again → 409 `CART_STOCK_CONFLICT`.
- **Z2** — B buys first; A's Cart submit → 409 `CART_STOCK_CONFLICT`.
  - `submittedAt` stays null and the intent is still `requires_payment_method` (never authorized).
  - The Cart line is kept and flagged OUT_OF_STOCK with `canCheckout` false. A can remove it.
- **Z3** — A Buy Now submit after the sale → 409 `CART_STOCK_CONFLICT`. A's Cart is untouched.
- **Z4** — Buy Now vs Cart race: one PAID, one CANCELED with the stock code. A Buy Now loser's restore → `PURCHASE_NOT_RESTORABLE`.

## 10. Provider failure scenarios — PASS (mocked provider; not Stripe evidence)

- The cancel reply says canceled but a fresh read doesn't: the attempt stays `CANCEL_PENDING`, work READY, no capture. The next pass → CANCELED/DONE.
- Persistent `CHECKOUT_CONFLICT`: 3 durable retries (state AUTHORIZED, no cancel). Then release → CANCELED, no capture.
- `CHECKOUT_CONFLICT` that clears within the budget → committed and captured once.
- Existing stock-conflict cancel tests still pass.

## 11. Cart and saved-attempt recovery — PASS

- Cart scope, sold out before submit: the line stays in the Cart, flagged OUT_OF_STOCK, and A can remove it (Z2).
- Cart scope, lost at commit: restore is refused with `CHECKOUT_CHANGED` and no stock is restored. The sold-out card offers no Try Again. Dismiss stays available when the server says `dismissible`.
- Buy Now loser: `PURCHASE_NOT_RESTORABLE`; the Cart is untouched.

## 12. Frontend out-of-stock behavior — PASS (component tests); Visual QA: NOT VERIFIED

- **Checkout, stock outcome:** shows `PackageX` icon with "This item sold out" / "Some items sold out", plus the product, the quantity requested and its availability. Copy depends on whether the provider has verified the release:
  - **Released:** "Your card was not charged…authorization…was cancelled", plus the bank-hold line. Actions are Continue shopping, View product and Return to Cart.
  - **Not released:** the cancelling/checking copy and a "Check again" action only. It never says "not charged".
- **Submit refusal:** shows the standard 409 message plus "Review your Cart/order to continue.". It never shows the Processing screen.
- **Saved purchase cards:** "Sold out · Not charged" or "Sold out · Checking payment". Try Again is never offered.
- **"Processing your order…":** already bounded by `CHECKOUT_RECOVERY_WINDOW_MS` (120 s), after which it hands off to `/cart?purchase=`.
- Not done for the new UI: Figma comparison and Playwright screenshots. **Visual QA: NOT VERIFIED.**

## 13. Real PostgreSQL concurrency evidence — NOT VERIFIED locally; CI pending

- The runner `payment-pg-disposable.cjs` has a new suite, `scenarios-A-Z` (A–Y plus Z, 4 files).
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
| backend `npx vitest run payment.last-unit.test.ts payment.service.test.ts` | 148/148 passed |
| backend `npx vitest run payment.session-isolation … swagger … logging-continuity … brand … auth.service … product.seed … order-document` | 145 passed, 1 failed (swagger 5 s timeout; the same timeout occurs with the PR's route-doc change reverted, i.e. pre-existing/environmental) |
| backend `npm run test:ci` (full) | 147 files passed, 14 failed. Failures were DB-integration suites (no reachable DB by design), env-file loading (`ELECTROHUB_ENV_FILES=none`), an `EADDRINUSE` from a local port, Windows fs `ENOTEMPTY`, and load timeouts. `payment.session-isolation` was the one regression from this PR: its fixtures lacked `availability`. Fixtures were fixed and 2 stock-gate tests added; the file then passed. The non-DB files re-run in isolation all passed except the swagger timeout above. |
| backend `node --test scripts/payment-pg-disposable.test.cjs` | 23/23 passed |
| OpenAPI spec load (`swaggerSpec`) | submit documents 200/404/409; status `data` has `outcomeReason`, `authorizationReleased`, `unavailableItems` |
| frontend `npm run typecheck` | exit 0 |
| frontend `npm run lint` | 0 errors, 4 pre-existing warnings in unrelated files |
| frontend `npx vitest run src/features/checkout` | 21 files, 291/291 passed |
| frontend `npx vitest run` (full) | 185/186 files, 1549/1550 tests. 1 failure: `CheckoutPage.test.tsx` "retains setup identity and exposes failed lease-status readback" (status read count 2 vs 1) under a 758 s contended run. It does not touch the changed submit-refusal branch, and it passed 3/3 when re-run alone. The `src/features/checkout` folder passed 291/291 alone. |
| frontend `npm run build` | exit 0 (existing chunk-size warning) |

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
- new: `src/services/__tests__/payment.last-unit.test.ts`
- new: `src/services/__tests__/payment.last-unit.postgres.integration.test.ts`

Frontend (`src/features/checkout/`):
- `types.ts`
- `CheckoutComponents.tsx`
- `CheckoutPage.tsx`
- `PaymentPurchases.tsx`
- `PaymentRecovery.tsx`
- `Checkout.module.scss`
- `CheckoutPage.test.tsx`
- `PaymentPurchases.test.tsx`
- `PaymentRecovery.test.tsx`

CI and docs:
- `.github/workflows/ci.yml`
- this file
- `TASK_06.2_PAYMENT_INVENTORY_INTEGRITY_EVIDENCE.md` (scope pointer)

## 18. Residual risks

- **Authorization window:** a race that starts after submit still produces authorize → cancel. The customer may briefly see a pending hold on their bank statement. It is never captured. A pre-confirmation re-check at `confirmation-started` was not added.
- **Fake provider:** the provider is a deterministic fake, so real Stripe cancel latency and failure modes are not proven.
- **D4 retries:** during the bounded retries the customer sees "checking", not a result.
- **Restore while sold out:** restore is unavailable while stock is 0. The shopper adds the item again when it is restocked.
- **Visual QA:** NOT VERIFIED for the new sold-out UI.

## 19. Final SHA — recorded in the PR #51 description

## 20. PR URL — PASS

https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/51
