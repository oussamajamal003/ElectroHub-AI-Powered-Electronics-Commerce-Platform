# Cart — Add to Cart backend performance follow-up — 2026-10-15

Scope: `POST /api/cart/items` and the Cart response read. Backend source and offline tests only. No database was
connected to, no shared DEV/PROD write was made, no migration, region, pool or Stripe change, nothing staged,
committed or pushed. Task 03.6 remains OPEN. NO PUSH remains in effect.

## What was measured, and what was not

| Claim | Evidence | Status |
|---|---|---|
| Adds took 4.7–12.5 s (13 requests, 2026-10-15) | Existing `app.log` `http.completed` durations | Measured (real, DEV, before the change) |
| Per-statement cost is network, not server | `db.*` events 324–586 ms each; earlier EXPLAIN evidence in `PAYMENT_LATENCY_LOADING_INVESTIGATION.md` (server < 2 ms/statement) | Measured (real, before) |
| Sequential Prisma operations per add: **9 / 10 / 10 → 7 / 7 / 9** (existing line / new line / first-ever Cart; includes begin and commit) | `cart.add-roundtrips.test.ts` recording client, run on the pre-change service and on the new one | Measured (offline count) |
| Real SQL statements per add | Not measured after the change. Before the change, the real log for one new-line add showed 11 logged statements excluding authentication (7 selects, 1 insert, 1 commit, then 2 selects), against 9 Prisma operations excluding `begin` in the offline count. So Prisma issues about 2 extra statements for some operations (likely the `upsert`). `begin` and `SET TRANSACTION` are not logged | **NOT MEASURED** |
| Request duration after the change | Needs an authorized write path or a read-only DEV run | **NOT MEASURED** |
| Pool acquisition vs `BEGIN`/`SET TRANSACTION` vs network | `profile-transaction-start.ts`, 8 samples, read-only, authorized by the owner (see below) | Measured (raw `pg` client, not the Prisma adapter) |

No improvement in request duration is claimed. The expected effect is proportional to the removed round trips at
roughly 0.3–0.8 s each, so about 2–3 fewer sequential waits per add, plus the `upsert` expansion, but this is an
estimate until measured.

## Change (`apps/backend/src/services/cart.service.ts`)

1. **Lock first, in one statement.** `lockCartForUser` (existing helper) resolves and locks the customer's Cart row
   (`SELECT id … WHERE userId … FOR UPDATE`). `cart.upsert` plus `lockCart` run only when the customer has no Cart yet,
   then lock as before. The lock is the same row lock, still taken before any read.
2. **One read of the Cart's lines** (`cartItem.findMany`, at most `MAX_CART_LINES` rows, under the lock) replaces
   `cartItem.findUnique` plus `cartItem.count`. The existing line and the line-count limit are derived from it. Error
   order is unchanged: `CART_FULL`, then `INVALID_CART_QUANTITY`, then product/stock validation, then the write.
3. **One-read Cart response.** New `cartResponse` reads the Cart, lines and their products in one statement
   (relation join), replacing `currentCart`'s two sequential reads for API responses (`CartService.get`, and so the
   responses of add, update, remove and reconcile). A marked disposable fixture is projected as an unavailable
   product (`null`), exactly as before.
4. **Unchanged:** `currentCart` (payment/order paths), authentication and role middleware, ownership (every read is
   scoped to the authenticated `userId`), stock validation, Serializable isolation, the 3-attempt retry, timeouts,
   transaction stage names used in diagnostics, API shape and status codes.

Considered and not changed: transaction start (see below), the 457 ms authentication lookup, pool settings.

## Verification (offline)

| Check | Result |
|---|---|
| Cart service tests (existing, stubs updated to the nested-product shape; assertions unchanged) | 30/30 |
| New: single-read response output-identical to `currentCart` (empty, ordering, over-stock, fixture, no Cart) | pass |
| New: limits and error precedence on the combined line read; existing line allowed at the line maximum | pass |
| New: concurrent adds cannot lose an update (lock precedes the line read; second read follows first commit) | pass; mutation check (read before lock) fails with quantity 2 instead of 3 |
| New: round-trip accounting and sequence guard | pass |
| Cart, payment, order, checkout, Buy Now and inventory suites plus cart/checkout routes | 17 files, 368/368 |
| Backend typecheck, scoped ESLint, `git diff --check` | clean |

The real-PostgreSQL concurrency test (`cart.quantity-correction.integration.test.ts`) was not run.

## Transaction-start gap (0.5–1.7 s): hypotheses and the measurement that decides them

Hypotheses from source: `max` is 5 in development, so a request can wait for a free pooled connection; a Serializable
transaction costs a connection checkout plus `BEGIN` plus `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`, which may be
two round trips; and a pooled connection that was idle may need a new TLS handshake.

`apps/backend/scripts/profile-transaction-start.ts` separates these. It uses one dedicated connection, `SELECT 1`
and transaction control only, no tables and no writes, and prints timings only. **Run on 2026-10-15 with the owner's
authorization**, 8 samples, one connection at a time, against the DEV pooler (`ap-northeast-2`):

| Stage (ms) | p50 | p95 | max |
|---|---|---|---|
| connect (new TCP + TLS + auth) | 2717 | 4447 | 4447 |
| `SELECT 1` on a warm connection (one network round trip) | 405 | 495 | 495 |
| `BEGIN` | 347 | 499 | 499 |
| `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` | 425 | 1517 | 1517 |
| first `SELECT 1` inside the transaction | 384 | 467 | 467 |
| `COMMIT` | 378 | 579 | 579 |
| `BEGIN ISOLATION LEVEL SERIALIZABLE` as one statement | 441 | 1732 | 1732 |

Reading:
- **Network round trip is about 0.4 s.** Every statement, including `BEGIN` and `COMMIT`, costs one round trip.
- **Serializable start is two round trips today** (`BEGIN` then `SET TRANSACTION`), about 0.77 s p50. As one statement it is about 0.44 s p50, so it would save roughly one round trip (about 0.33 s) per transaction.
- **A new connection costs about 2.7 s** (up to 4.4 s) before any statement. The observed 0.5–1.7 s start gap is therefore explained by the two round trips plus round-trip variance, with a cold or replaced pooled connection adding seconds on top. Pool wait for a free slot was not isolated.

Limits: 8 samples (p95 equals max); earlier work saw up to 5x run-to-run variance; this used the raw `pg` client, so
whether the Prisma adapter sends `BEGIN` and `SET TRANSACTION` as two statements, or pipelines them, is **not
verified** and must be checked before relying on the saving. Changing it touches the shared `transaction` helper
and needs separate approval.

## Rollback

Revert only the hunks described above in `cart.service.ts` and `cart.service.test.ts` (both also carry other, unrelated uncommitted edits, so do not restore them wholesale from version control), and delete
`cart.add-roundtrips.test.ts`, `cart.add-equivalence.test.ts` and `scripts/profile-transaction-start.ts`.
No data or schema is involved.
