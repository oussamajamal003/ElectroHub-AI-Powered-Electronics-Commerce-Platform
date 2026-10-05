# Task 03.4A — Inventory database and 05.3 handoff

## Recorded Gemini live gate

The project owner supplied the following completed live verification for this handoff. Gemini reported DEV `pzxekjybdiulzmssalfo` and PROD `yepfgjehdstlxbpespun`; repository, DEV, and PROD migration counts were each 11; `20261005000000_inventory_nonnegative` was applied to both environments; the `quantity >= 0` and `lowStockAt >= 0` physical CHECK constraints passed on both; and schema drift was NONE. The DEV authenticated Cart and Wishlist checks passed, neither operation changed Inventory, and the genuine last-unit concurrency check began at 1, allowed one decrement, returned `INVENTORY_CONFLICT` to the competing decrement, and ended at 0. DEV/PROD parity passed.

The Gemini run timestamp and transcript/immutable run ID were not included in the supplied report. The final working tree’s relevant source is pinned by SHA-256 in [Task 03.4A implementation evidence](../tasks/Phase-03/TASK_03.4A_IMPLEMENTATION_EVIDENCE.md#gemini-live-gate-source-fingerprint). Codex did not repeat or modify the migration, constraint, parity, concurrency, or Wishlist gates during final closure. The narrowly scoped authenticated Cart quantity-correction re-gate is recorded separately below. The local PostgreSQL tests remain SKIPPED because `INVENTORY_TEST_DATABASE_URL` was not configured; this does not negate or replace the separately labeled Gemini live result.

## Targeted Cart correction — DEV re-gate closed

`CartService.setQuantity` now compares the requested final quantity with the persisted Cart quantity inside the existing serializable transaction. A strict decrease requires an existing owned Cart line, an existing active Product/category, valid Inventory, and a valid positive quantity, but it skips stock sufficiency so the customer can correct an existing invalid Cart line. Equal-quantity requests and increases retain full purchase/stock validation. This does not reserve or mutate Inventory; checkout remains blocked while any Cart line is not currently purchasable.

The earlier source/test pass used mocked Prisma persistence and did not exercise a database. The subsequent targeted gate used real DEV authentication and the real local authenticated Cart API route backed by DEV, with a disposable Product/Inventory/Cart item created for this test. Every Cart mutation was followed by `GET /api/cart`; Inventory quantities were compared before and after, and the fixture was removed. The prior Gemini gate still applies to its unchanged constraint, migration parity, concurrency, and Wishlist evidence; its authenticated `setQuantity` result did not cover this source revision and was superseded by this targeted gate.

At `2026-10-05T18:23:06Z`, authenticated DEV results: `3→2` and `3→1` at stock 0 succeeded; `3→4` at stock 0 returned HTTP 409 `CART_STOCK_CONFLICT`; `5→4` and `5→3` at stock 3 succeeded; `5→6` at stock 3 returned HTTP 409 `CART_STOCK_CONFLICT`. `GET /api/cart` confirmed every resulting quantity, Inventory was unchanged in all six cases, Cart ownership matched the authenticated customer, and cleanup passed. The tested `apps/backend/src/services/cart.service.ts` SHA-256 was `9DC6F2EB9858AC83448B849DD80F76ECA600F42C68AA817151D225544F2E75C8` before and after the gate. No PROD access/write, migration, seed, curated Product change, or source modification occurred. No migration rerun or PROD re-verification is required.

## Execution boundary and future database changes

The earlier Codex implementation pass was source-only; the later Gemini gate above supersedes its pending live-status statements. The migration adds only the two nonnegative CHECK constraints and changes no Prisma field or historical migration. Do not reapply the completed Task 03.4A migration or rerun its DEV/PROD fixtures as part of this closure. For a future database change, confirm project identity, review pending SQL, run a read-only invalid-row preflight, stop if invalid rows exist, and use the separately approved deployment workflow. Never print connection credentials, repair rows implicitly, or infer production authorization from DEV success.

```sql
SELECT "productId", quantity, "lowStockAt"
FROM inventory
WHERE quantity < 0 OR "lowStockAt" < 0;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'inventory'::regclass AND contype = 'c';
```

## Internal service contract for Task 05.3

Read the authoritative `docs/tasks/Phase-03/TASK_03.4_CUSTOMER_INVENTORY.md` first. Reuse `InventoryService.getSnapshot`, `validateRequestedQuantity`, `setStock`, `increaseStock`, `decreaseStock`, `deriveStockStatus`, `projectInventory` and `validateInventoryPurchase`. Preserve optional existing transaction-client support: no nested transaction or disconnected write. Lock order must remain deterministic when future multi-Product operations are introduced. Set accepts zero; increases/decreases require positive integer deltas. All values are bounded to 2,147,483,647; negative/overflow results reject without writing. Quantity and persisted status update in one locked, guarded transaction.

05.3 owns authorized Admin routes/UI, audit policy and threshold-edit policy. It must not expose internal primitives directly to customers, introduce a parallel stock store/status enum, bypass locks or treat Cart line LOW_STOCK as threshold stock status. Use the existing StatusBadge. Checkout/Orders must perform their own final transactional validation and idempotent purchase protocol; this task does not reserve/decrement stock on Cart/Wishlist intent.

## Reproducible local concurrency gate (separate from Gemini live evidence)

Set `INVENTORY_TEST_DATABASE_URL` only to an authorized disposable local PostgreSQL database, then run `npx vitest run src/services/__tests__/inventory.postgres.test.ts` from `apps/backend`. The tests create/drop an isolated schema, apply the actual CHECK migration and compete to decrement the last unit using the service's real SQL lock through a transaction adapter. They never connect to hosted DEV/PROD. Both local tests were SKIPPED in the Codex run because that environment was absent; mocks do not substitute for the local gate, and the local skip must not be reported as a local pass. The separately reported Gemini DEV gate did exercise real live concurrency.
