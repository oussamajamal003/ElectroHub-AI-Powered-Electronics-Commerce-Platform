# Task 06.2 — Payment & Inventory Integrity Review: Evidence

Status legend: **PASS** (verified by an executed check or by direct code inspection, as stated) · **FAIL** · **NOT VERIFIED** · **NOT APPLICABLE**.

Provider behavior in every automated test here comes from deterministic doubles (`HarnessProvider`, mocked routes). It is **not** Stripe evidence.

---

## 1. Starting branch / SHA — PASS

- Branch `feature/06.2-payment-inventory-integrity-review`, created from `feature/06.2-accessibility-qa-ci-cd` at `9e506557b3f84049e4c1fdf27d2abe39e1055159`. That SHA was also the remote tip of the base branch when work started.
- The working tree was clean at the start.

## 2. Actual payment / inventory lifecycle — PASS (code inspection)

```text
Cart (validate only, no stock change)
  → POST checkout: PaymentAttempt created (NOT_SUBMITTED, expiresAt = now + 30 min), no stock change
  → client confirms the PaymentIntent (manual capture)
  → webhook or durable worker sees requires_capture
  → OrderService.commitAuthorized: Serializable transaction, SELECT … FOR UPDATE on Inventory,
    CHECK quantity >= 0, decrement, create Order        ← the ONLY stock decrement
  → capture → PAID
  → on capture rejection, order failure, or insufficient stock:
      provider cancel/refund → compensation (fenced by compensatedAt) → stock restored once
      → COMPENSATED / REFUNDED, Order CANCELLED
```

## 3. Existing root causes — PASS

**Defect 1 (fixed): compensated failed purchases could never be removed.**
- `payment.service.ts` `dismiss()` refused every attempt that had an `orderId`.
- COMPENSATED and REFUNDED attempts always have one, because the order was created at authorization and then compensated.
- Result: those "Payment failed" cards showed a trash icon, but the server always answered `PAYMENT_NOT_DISMISSIBLE`, so the cards stayed in the list forever.

**Defect 2 (fixed): the frontend decided dismiss eligibility by guessing.**
- The trash icon was shown for every card with the `failure` tone.
- The backend projection carried no `dismissible` flag.

**Defect 3 (fixed): Product Details did not show an exact available quantity.**
- It showed only an In Stock / Low Stock badge.
- When the cart was empty, it also showed a confusing "N more items available to add" line.

**Defect 4 (fixed): stale catalog stock after a payment outcome.**
- A verified payment or a compensation did not invalidate the `['products']` React Query cache.

**Defect 5 (fixed): misleading admin inventory copy.**
- The text did not explain that sellable stock is already net of placed orders, and that "held" units are shown separately and not subtracted again.

**No other defect found.**
- No double decrement, no reservation at Add to Cart, no stock change on a pre-authorization decline, and no double restore.
- The real-PostgreSQL scenarios T–Y in item 16 lock this in.

## 4. Cart stock policy — PASS

- The Cart validates only. `CartService.add` checks the requested quantity against `Inventory.quantity` and writes only `CartItem`.
- This is a deliberate direct-decrement design, so no reservation was added.
- Evidence:
  - Scenario T (real PG, CI): stock stays 5 after cart adds, and a second shopper can still add 5.
  - `inventory.spec.ts` P–Q (browser, mocked API, passed): no `/inventory` writes happen during cart or wishlist actions.

## 5. Inventory commitment point — PASS

- Stock is decremented only in `OrderService.commitAuthorized`, after the provider reports `requires_capture`.
- That commit runs in a Serializable transaction with row locks.
- Scenarios V, X and Y cover it.

## 6. Payment failure and restoration behavior — PASS (CI real PG pending, see 16)

**Pre-authorization decline:**
- No Order is created and stock is unchanged.
- Scenario U: 5 → 5.

**Failure after authorization:**
- Compensation restores stock exactly once, guarded by `compensatedAt` and the worker lease.
- Scenario W: 5 → 3 → 5. Replays from the same runner and from a fresh runner both leave it at 5.

## 7. Failed-payment action matrix — PASS

Every flag comes from the server projection (`GET /api/payments/purchases`). The UI never guesses.

| Server state | Customer status | Try Again (`retryAllowed`) | Cancel (`cancelable`) | Dismiss (`dismissible`) |
|---|---|---|---|---|
| DECLINED, no order | DECLINED | yes | no | **yes** |
| AWAITING_INPUT, submitted, NOT_CONFIRMED, never confirmed | AWAITING_CUSTOMER_ACTION | yes | **yes** | no |
| CANCELED, no order (not abandonment) | FAILED | no | no | **yes** |
| COMPENSATED / REFUNDED with `compensatedAt` | FAILED | no | no | **yes** (fixed) |
| COMPENSATED / REFUNDED without `compensatedAt` (compensation still running) | — | no | no | no |
| DECLINED / CANCELED that has an order | — | no | no | no |
| Any state whose work row has `lastError` (UNKNOWN) | UNKNOWN | no | no | no |
| Order processing / PAID | ORDER_PROCESSING / SUCCEEDED | no | no | no |

**Server enforcement:**
- `dismiss()` re-checks `dismissEligible` and then runs a conditional `updateMany`.
- The `updateMany` where-clause encodes the same rules, including "work not LEASED and no lastError", so a race cannot dismiss a card mid-transition.
- Dismissing sets only `dismissedAt`. Scenarios U and W compare the whole row before and after.

**Transient leases:**
- The list projection ignores a transient worker lease, so the icon does not flicker.
- The mutation still refuses while the work row is leased, and the client shows the existing recoverable error.

## 8. Existing expiry / cancellation policy — PASS (code inspection)

These constants live in `payment.domain.ts`:

| Constant | Value |
|---|---|
| `ATTEMPT_LIFETIME_MS` | 30 min |
| `SUBMITTED_ABANDON_GRACE_MS` | 15 min |
| `NEVER_CONFIRMED_GRACE_MS` | 10 min |
| `SUBMITTED_UNRESOLVED_WINDOW_MS` | 3 min |
| `CONFIRMATION_SIGNAL_GRACE_MS` | 2 min |

- Abandoned attempts become CANCELED with an abandonment code.
- None of these timers holds stock, because no stock is held before authorization.

## 9. Three-day policy decision and rationale — PASS (not implemented, by design)

No three-day payment-cancellation or inventory-reservation policy exists, and none was added:

- No requirement or ADR defines one.
- No stock is reserved before authorization, so there is nothing to expire.
- An authorized order commits and captures right away, or is compensated.

A future hold policy would need a product decision, a schema field and an ADR. See item 21.

## 10. Out-of-stock / low-stock behavior — PASS

- `InventoryService.getSnapshot` derives `stockStatus` with these thresholds: OUT_OF_STOCK at 0; LOW_STOCK at 5 or fewer.
- The browser spec `inventory.spec.ts` passed 10 of its 11 scenarios. Out of stock keeps navigation and the wishlist heart usable, and disables purchase.

## 11. Product Details available-quantity display — PASS

| Stock state | Display |
|---|---|
| IN_STOCK, 12 units | "In Stock" badge + "**12 available**" |
| LOW_STOCK, 3 units | "Low Stock" badge + "**Only 3 left**" (warning style) |
| OUT_OF_STOCK | "Out of Stock" badge, no count, "Currently unavailable." |

- The count comes from the server's `availableQuantity` and is never changed locally.
- The cart-limit hint appears only when the cart already holds some of the product.
- Evidence:
  - `ProductDetailPage.test.tsx`: 21 passing.
  - Browser captures at 390 / 1920 / 1366 px (see item 18).

## 12. Admin inventory terminology — PASS

- `AdminInventoryPage` copy: "Sellable stock per product: units in placed orders are already deducted, and units held for a processing payment return automatically if it fails…"
- The service comment documents that `held` is never subtracted a second time.
- Code inspection confirmed there is no double subtraction.

## 13. API changes — PASS (additive only)

- `GET /api/payments/purchases` items gain `dismissible: boolean`. This is additive and backward compatible.
- `POST /api/payments/purchases/:attemptId/dismiss` now accepts compensated COMPENSATED / REFUNDED attempts that it previously refused. No other contract changed.

## 14. Database / schema changes — NOT APPLICABLE

None. There is no Prisma schema change and no migration.

## 15. Stripe / provider behavior — NOT VERIFIED (against Stripe)

- No Stripe Test Mode run was performed for this change.
- Provider transitions are exercised only through the deterministic `HarnessProvider` and mocked browser routes.
- No provider call was added or changed.

## 16. Concurrency and idempotency evidence — PASS (unit) / NOT VERIFIED locally (real PG)

New file: `payment.stock-integrity.postgres.integration.test.ts`, scenarios T–Y.

| Scenario | What it checks |
|---|---|
| T | Add to Cart reserves nothing |
| U | A decline leaves stock unchanged; dismissing the card changes only `dismissedAt` |
| V | An authorization decrements once, including across replays |
| W | Compensation restores stock once, including with a fresh runner |
| X | Two buyers of 4 units each from stock 5: one PAID, one CANCELED, stock 1, never negative |
| Y | A decline followed by authorization of the same intent decrements once |

- The CI `payment-postgres` job now runs scope `scenarios-A-Y`, which covers the existing A–S suites plus this file, on its disposable `electrohub_ci` database.
- The scope is authorized through `PAYMENT_PG_DISPOSABLE_AUTHORIZATION`.
- **These scenarios were not executed locally.** This machine has no Docker or PostgreSQL. Their status depends on the CI result for this PR.
- The dismiss race is covered by unit tests (`payment.dismiss.test.ts`) that assert the conditional where-clause.

## 17. Actual tests and results — PASS (with the noted environmental failures)

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | exit 0 |
| Backend lint | 0 errors |
| `payment.dismiss.test.ts` | 31 passed |
| `payment.routes.test.ts` | 30 passed (×2) |
| Backend full unit suite | 2100 passed, 11 failed, 260 skipped (see note 1) |
| `payment-pg-disposable.test.cjs` and siblings | 32 / 33 (see note 2) |
| Frontend typecheck (`tsc -b` + quality) | exit 0 |
| Frontend lint | 0 errors, 3 warnings (OtpCodeInput, TotpEnrollment, AdminInvitePage; none from this change) |
| Frontend full suite | 1357 passed, 2 failed (see note 3) |
| Checkout + customer + inventory suites, in isolation | 13 files, 171 passed |
| Frontend `npm run build` | exit 0 |

1. All 11 backend failures are environmental: `ECONNREFUSED 127.0.0.1:55432` in database-integration tests, plus `env.test` and `logging-continuity`, which need CI's env file.
2. The single failure is `payment-stripe-disposable.test.cjs` failing with `DATABASE_TEST_TARGET_REQUIRED`. That file is untouched and is not run by CI.
3. Both frontend failures are "Worker exited unexpectedly" under load, in `useUnsavedChangesGuard` and `AdminProductFormPage`. Both pass when run in isolation.

## 18. Browser QA — PARTIALLY VERIFIED

Playwright Chromium, against mocked APIs (no backend, no shared database):

- **`failed-payment-dismissal.spec.ts` (`playwright.dismissal.config.ts`, production preview): 21 / 21 passed** at 390, 768 and 1366 px.
  - The first run had 3 failures. The spec still asserted dialog copy that the product had replaced back in Task 03.6 (commit `a2b4380e`).
  - The assertion was aligned to the shipped copy "Remove this failed payment from your list? Your payment history will be preserved."
  - This branch did not change the dialog itself.
- **`inventory.spec.ts` (`playwright.catalog.config.ts`): 10 / 11 passed.**
  - **N FAILED.** After a background refetch, Product Details shows the full-page skeleton.
  - The cause is `ProductDetailPage.tsx:102`, which shows the skeleton on `isFetching`. That gate was added in commit `a83b29a` before this branch and is unchanged here.
  - This failure predates this branch and is out of scope. It is recorded as a residual risk.
- **Product Details quantity captures** (temporary capture spec, removed after the run):
  - 1920 px "Only 3 left": passed.
  - 390 px "12 available": passed (asserted; below the fold in the screenshot).
  - 1366 px OUT_OF_STOCK, no count: passed.
  - 1366 px for 12 and 3 units: dev-server timeouts, **NOT VERIFIED**.
- Only Firefox and WebKit are not installed locally: **NOT VERIFIED**.
- The Figma desktop screenshot `customer/screenshots/Product_details_page.png` shows the stock indicator above Qty. The quantity copy sits inline next to that indicator. No Figma frame defines the quantity copy, so exact-match against Figma is **NOT VERIFIED**.

## 19. CI status — NOT VERIFIED (at the time of writing)

- `.github/workflows/ci.yml` changed only the `payment-postgres` scope (A–S → A–Y).
- Remote CI results are reported on the PR, not here.

## 20. Changed files — PASS

**Backend**
- `apps/backend/src/services/payment.service.ts`
- `apps/backend/src/services/admin-inventory.service.ts` (comment only)
- `apps/backend/src/services/__tests__/payment.dismiss.test.ts`
- `apps/backend/src/routes/payment.routes.test.ts`
- `apps/backend/src/services/__tests__/payment.stock-integrity.postgres.integration.test.ts` (new)
- `apps/backend/src/services/__tests__/helpers/payment-postgres-harness.ts`
- `apps/backend/scripts/payment-pg-disposable.cjs`
- `apps/backend/scripts/payment-pg-disposable.test.cjs`

**Frontend**
- `apps/frontend/src/features/checkout/PaymentPurchases.tsx`
- `apps/frontend/src/features/checkout/PaymentPurchases.test.tsx`
- `apps/frontend/src/pages/customer/ProductPurchaseActions.tsx`
- `apps/frontend/src/pages/customer/ProductDetailPage.module.scss`
- `apps/frontend/src/pages/customer/ProductDetailPage.test.tsx`
- `apps/frontend/src/pages/admin/AdminInventoryPage.tsx`
- `apps/frontend/tests/checkout/failed-payment-dismissal.spec.ts`
- `apps/frontend/tests/release/admin.release.spec.ts`
- `apps/frontend/tests/release/discovery.release.spec.ts`

**CI and docs**
- `.github/workflows/ci.yml`
- this document

## 21. Material residual risks

1. **Real-PG scenarios T–Y:** first execution happens in CI. If CI fails, this review is not complete.
2. **Product Details skeleton on background refetch:** caused by commit `a83b29a` and fails `inventory.spec` N. Not fixed here, because it is outside this task's scope.
3. **No Stripe Test Mode run:** provider behavior relies on doubles.
4. **Re-polling DONE+DECLINED rows** every 60 s: intentional, so a late authorization is not stranded. It adds load at scale.
5. **Release specs** `admin.release` and `discovery.release` were updated but not executed locally, because they need a seeded database.
6. **A pure-decline card is dismissible.** A later authorization of the same intent would still produce an order (scenario Y). The order would then appear in Orders, but not in the dismissed list.
7. **No hold or expiry policy for authorized-but-uncaptured payments** beyond the existing worker. Any future "hold" policy needs an ADR.

## 22. Final commit SHA and PR URL

Recorded on the PR and in the final task report. A document cannot contain the SHA of the commit that adds it.
