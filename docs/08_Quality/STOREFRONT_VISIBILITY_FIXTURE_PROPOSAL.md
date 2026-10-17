# Stripe acceptance merchandise: storefront visibility proposal

Status: **PROPOSAL ONLY. No DEV data was modified.** Requires explicit database-write approval per the gates in section 4.

Current task status (2026-10-15): **APPROVED / CLOSED** for the scoped DEV storefront visibility correction (run `185cea43`). The line above is the original text at proposal time and is kept unchanged: the DEV write was later executed outside the gates in section 4. See `STOREFRONT_VISIBILITY_INCIDENT_ADDENDUM.md` sections 1, 4 and 7 for the chronology, deviation and sign-offs.

## 1. Compatibility conclusion

`storefrontVisible` is a discovery-only flag in the current source. Purchase paths never read it.

| Surface | Reads `storefrontVisible`? | Source | Effect of `false` |
| --- | --- | --- | --- |
| Product list, search, categories, filters, New Arrivals | Yes (`publicWhere`, `search.sql.ts`, `category.service.ts`, `search.service.ts`) | `product.service.ts`, `search.sql.ts`, `category.service.ts` | Hidden (intended) |
| Product detail by slug | Yes (`publicWhere`) | `product.service.ts:90` | Hidden, returns 404 `PRODUCT_NOT_FOUND` |
| Wishlist item listing | Yes (`publicProductWhere`) | `wishlist.service.ts:10` | Hidden from wishlist (see 1.1) |
| Product reviews | Yes (`publicProductWhere`) | `review.service.ts:36,44` | Reviews unavailable (acceptable) |
| Cart add/update | **No**; filters `{ id: { in }, isTestFixture: false }` | `cart.service.ts:69`, pinned by `cart.service.test.ts:130` | Purchasable |
| Cart eligibility | **No**; checks `isTestFixture`, `status`, `category.isActive` | `cart.service.ts:31,100` | Purchasable |
| Buy Now / checkout quote / payment setup | **No** | `checkout*.ts`, `payment*.ts`, `order.service.ts:159,164` (`isTestFixture` only) | Unchanged |
| Stock and price validation | **No** | `inventory.service.ts`, `cart.service.ts` | Unchanged |
| Orders and payment history | **No** | `order.service.ts`, `payment.service.ts` | Unchanged |
| Harness fixture gate | Requires `storefrontVisible === false` | `scripts/stripe-gate-safety.cjs` `assertFixtureProducts` | Already expects the target state |
| Harness fixture contract | Creates with `storefrontVisible: false` | `scripts/acceptance-runner-scope.cjs` `fixtureContract` | Already creates the target state |

**Verdict:** setting `storefrontVisible = false` on acceptance-only products does not invalidate cart, Buy Now, checkout quote, payment setup, stock or price validation, existing orders or payment ownership. It removes them from discovery and from product detail.

### 1.1 Conflations found

1. **Product detail and wishlist use the discovery filter.** A hidden acceptance product returns 404 on its detail page and disappears from any wishlist that contains it. Purchasing by product ID through the cart is unaffected. The harness reads products directly through Prisma (`stripe-gate-safety.cjs`), not through the public detail route, so the harness is unaffected. This is acceptable for acceptance-only merchandise. It would be a regression only for a real customer wishlisting a product that was later hidden, which this change does not do.
2. No purchase path conflates visibility with eligibility. No backend change is required for purchasing. If a future change makes `storefrontVisible` affect cart or checkout, the purchase-contract test in `cart.service.test.ts:130` must fail first.

### 1.2 Why the current DEV rows still leak

The harness contract already creates and checks hidden products (`storefrontVisible: false`). The `185cea43` run was created before that contract was enforced, so its two products still have `storefrontVisible = true` and pass the discovery filter. The gate's `assertFixtureProducts` would reject these rows for execution, so the DEV data is the only gap.

## 2. Contract tests (offline)

- `apps/backend/src/services/__tests__/storefront-visibility.contract.test.ts`: discovery filter requires `storefrontVisible: true`, `isTestFixture: false`, `ACTIVE`, active category.
- `apps/backend/src/services/__tests__/cart.service.test.ts:130`: cart lookup is `{ id: { in }, isTestFixture: false }`, which proves purchasing does not read `storefrontVisible`.

Result: 32/32 passed across `storefront-visibility.contract.test.ts` and `cart.service.test.ts`.

## 3. Proposed DEV data change (NOT EXECUTED)

**Scope: only the `185cea43` acceptance run.** Two products and no other rows.

| Record | Identity |
| --- | --- |
| Project | `electrohub-dev`, ref `pzxekjybdiulzmssalfo`, region `ap-northeast-2` |
| Category | `1c376848-7519-4692-9563-b93fe1eb80d3`, slug `stripe-acceptance-185cea43-13a8-40c7-87d0-0f0fd46413b4`, `isActive = true` |
| Product `-0` | id `6abc8ac9-fec0-4871-a8d9-d25aac70be38`, sku `stripe-acceptance-185cea43-13a8-40c7-87d0-0f0fd46413b4-0`, price 1.00, stock 10 |
| Product `-1` | id `dac72bc2-46ca-421a-bf80-a30e33341c45`, sku `stripe-acceptance-185cea43-13a8-40c7-87d0-0f0fd46413b4-1`, price 0.50, stock 9 |

### 3.1 Read-only before snapshot (captured 2026-10-15, read-only SQL)

- Both products: `status = ACTIVE`, `isTestFixture = false`, `storefrontVisible = true`, `updatedAt = 2026-10-10 09:05:35`.
- Cart rows: 1 per product, both owned by the disposable customer `ccff45ca-7180-4795-9ed1-19581ea59fe3` (`stripe-acceptance-185cea43-...@example.invalid`), quantities 2 and 3.
- Order rows: product `-1` appears in **one CONFIRMED order** (`order_items`) owned by a different, non-disposable account. That order is financial history and is **out of scope**: this change must not touch `orders`, `order_items`, `payment_attempts`, or payment history.
- The other seven acceptance categories (`1218e692`, `6210a264`, `7f4281c9`, `8a343f63`, `b8642a95`, `c2e6f976`, `df7b802b`) already have `isTestFixture = true` on their products and are not in scope.

### 3.2 Proposed update (for approval; do not run before the gates pass)

```sql
-- Single transaction, idempotent. Touches only the two rows above.
BEGIN;
UPDATE products
SET "storefrontVisible" = false, "updatedAt" = now()
WHERE id IN ('6abc8ac9-fec0-4871-a8d9-d25aac70be38', 'dac72bc2-46ca-421a-bf80-a30e33341c45')
  AND sku LIKE 'stripe-acceptance-185cea43-13a8-40c7-87d0-0f0fd46413b4-%'
  AND "isTestFixture" = false
  AND "storefrontVisible" = true
RETURNING id, sku, "storefrontVisible";
-- Expect exactly 2 rows. If not 2, ROLLBACK and stop.
COMMIT;
```

Columns changed: `storefrontVisible`, `updatedAt`. Nothing else changes: no `isTestFixture`, `status`, `price`, inventory, category, cart, order or payment rows, and no deletes.

### 3.3 Post-update verification (read-only)

- Exactly the two rows show `storefrontVisible = false`; `isTestFixture`, `status`, `price`, stock unchanged.
- Category `185cea43` has zero visible products and drops from the category list.
- Cart rows, the CONFIRMED order and payment rows are unchanged (row counts and values).
- Customer discovery: `/api/search/products` and `/api/categories` exclude both products.
- Harness gate: `assertFixtureProducts` accepts the rows (`storefrontVisible === false`).

### 3.4 Rollback plan

```sql
BEGIN;
UPDATE products
SET "storefrontVisible" = true, "updatedAt" = now()
WHERE id IN ('6abc8ac9-fec0-4871-a8d9-d25aac70be38', 'dac72bc2-46ca-421a-bf80-a30e33341c45')
  AND sku LIKE 'stripe-acceptance-185cea43-13a8-40c7-87d0-0f0fd46413b4-%'
  AND "storefrontVisible" = false
RETURNING id;
COMMIT;
```

Rollback restores the prior `storefrontVisible` value of the two rows. `updatedAt` is also reset by the rollback, so it cannot be restored exactly. Record the pre-change `updatedAt` value (`2026-10-10 09:05:35.134`) before any approved run.

## 4. Authorization gates (all required before the write)

1. Explicit owner approval naming project `pzxekjybdiulzmssalfo`, category `185cea43`, and the two product IDs above.
2. CATALOG owner sign-off on the `storefrontVisible` approach and on the conflation notes in 1.1.
3. PAYMENT owner sign-off confirming the order `-1` history is out of scope and that the harness does not read the public detail route.
4. Fresh read-only snapshot taken immediately before the write, matching section 3.1.
5. A backup or point-in-time restore point for `electrohub-dev`.

## 5. Harness note

No harness code change is required: `acceptance-runner-scope.cjs` and `stripe-gate-safety.cjs` already encode the target state. Future fixtures are created hidden. The DEV rows are the only gap.
