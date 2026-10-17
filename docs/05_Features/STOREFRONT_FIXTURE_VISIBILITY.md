# Storefront Fixture Visibility

## Classification contract

`Product.isTestFixture` remains the existing marker for internal fixtures. Stripe acceptance fixtures need a distinct marker because some are intentionally allowed through Cart and Checkout validation. `Product.storefrontVisible` is independent of purchase eligibility: public catalog surfaces require `storefrontVisible = true` and `isTestFixture = false`; Cart, Wishlist, Checkout, payment history, and admin access retain their existing contracts.

The additive Prisma change and migration source add `storefrontVisible BOOLEAN NOT NULL DEFAULT true`. The default preserves genuine catalog visibility. New acceptance-run fixture contracts explicitly set `storefrontVisible = false`; the guarded acceptance verifier checks that state. Category APIs and category suggestions expose only active categories with at least one active, non-test, storefront-visible product, so categories containing only fixtures disappear without deleting category or financial records.

## Historical acceptance run: unresolved exact IDs

The screenshot shows the category slug `stripe-acceptance-185cea43-13a8-40c7-87d0-0f0fd46413b4` and two products priced $1.00 and $0.50. The guarded browser source binds this run UUID to an approved recovery scenario, and its manifest contract requires two Product UUIDs. However, no accessible immutable manifest or evidence file in this checkout maps that run UUID to the two Product UUIDs. The screenshot, category slug, product names, SKU patterns, and prices are not sufficient to infer exact IDs. No database query or write is permitted in this task.

After the migration is separately applied, update only the two Product IDs from the independently verified run manifest. Proposed exact-ID-only correction (replace the two placeholders only after owner verification; do not execute this template):

```sql
UPDATE "products"
SET "storefrontVisible" = false
WHERE "id" IN ('<verified-product-uuid-1>', '<verified-product-uuid-2>')
  AND "storefrontVisible" = true
RETURNING "id", "storefrontVisible";
```

Require exactly two returned rows, verify both IDs are owned by the named run, then verify the category no longer has any visible products. Preserve the Product, Category, PaymentAttempt, Order, and all financial evidence. If ownership cannot be proven from the approved manifest/run evidence, request a data-owner decision rather than broadening the predicate.

## Verification and release state

- Source now filters `storefrontVisible = true` consistently in Product list/detail/deals, search results/suggestions, review access, and visible-category existence/counts. Home, Products, search recommendations, and related-product views consume those APIs.
- Existing historical rows default to visible until positively classified. Therefore the code/migration source is prepared, but the two screenshot fixtures are **not confirmed removed** and full storefront closure remains blocked on exact Product IDs, approved migration/data correction, and post-change verification.
- No database writes, migration execution, Stripe operations, worker execution, fixture deletion, or financial-record changes were performed.
