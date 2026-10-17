# Prisma relationJoins — controlled evaluation handoff

Date: 2026-10-14 · Branch `feature/Stripe` · HEAD `3d69b97` (all work below is uncommitted) · Workstream: PERFORMANCE
Status: implementation-complete for source review. Not approved, integrated or released. No commit, push, migration, financial write, Stripe operation, auth change or A–J run occurred.

## 1. Scoped source change

Relative to the current working tree (other workstreams' uncommitted edits in the same files are not part of this change):

| File | Change |
|---|---|
| `apps/backend/prisma/schema.prisma` (generator block only) | `previewFeatures = ["driverAdapters"]` → `["driverAdapters", "relationJoins"]`, plus a three-line rollback comment |
| `apps/backend/src/services/order.service.ts:80-81` | One comment line and `relationLoadStrategy: 'query'` on the capture-path `paymentAttempt.findUnique({ include: { items: true } })` |
| `docs/06_Database/PRISMA_SCHEMA.md` | "Relation loading strategy" section and generated-client status |
| `docs/tasks/Phase-03/RELATIONJOINS_EVALUATION_HANDOFF.md` | This document |

## 2. Generated Prisma Client provenance

- Pinned and installed: `prisma`, `@prisma/client`, `@prisma/engines`, `@prisma/adapter-pg` 6.12.0; engine `8047c96bbd92`.
- 2026-10-13 history: the first regeneration hit `EPERM` on `query_engine-windows.dll.node` after JS/types were written, and the client's `schema.prisma` copy was synchronized by hand (a policy violation). A later regeneration at 19:01 by another agent also left temp DLL files.
- 2026-10-14 16:11: process module enumeration showed no process with the engine loaded. The backend dev server was not running. The six stale `tsx -e` Prisma scripts from 2026-10-12 (PIDs 82512/100920/126084, 22112/22660/122288) and the frontend Vite process (11660) had no `query_engine` module loaded. No process was stopped.
- `npm run prisma:generate` → **exit 0**, "Generated Prisma Client (v6.12.0)". Every generated file was rewritten at 16:12, and no new temp DLL was created.
- Verified: `previewFeatures` = `driverAdapters, relationJoins`; `relationLoadStrategy` present in `index.d.ts`; the engine DLL is byte-identical to `@prisma/engines`; the generated schema copy has 0 semantic differences from `prisma/schema.prisma`; `prisma validate` exit 0.
- Not authoritative and left in place: five `query_engine-windows.dll.node.tmp*` files from earlier failed generations (unreferenced). Their deletion is left to the DATABASE owner.
- Observation: the repo `schema.prisma` fails `prisma format --check` (formatting from several workstreams). I did not reformat it.
- Cross-workstream note: the regenerated client includes the AUTH refresh-token lineage fields (`familyId`, `replacedByTokenHash`). That migration is marked "PREPARED ONLY. Not applied anywhere". Anyone starting the backend against DEV must first confirm with the AUTH owner that DEV matches this client.

## 3. Runtime compatibility

- No backend server process is currently serving requests, so no incompatible source/client combination is live.
- The pinned argument is accepted by the regenerated client: verified by typecheck and by executing the exact capture query at runtime (section 4).

## 4. Query-result equivalence

| Check | Result | Class |
|---|---|---|
| 17 auth/payment/order/inventory/cart/catalog relation shapes, `query` vs `join` (2026-10-13) | 16 identical in values and runtime types (Decimal, Date, Json); 1 item-order difference | [DB-READ], reused |
| Capture query `order.service.ts:81`, regenerated client, all 70 DEV attempts (2026-10-14) | scalars 70/70 and item sets 70/70 identical; item order differs for 15; statements: pinned 2, join 1 | [DB-READ], new |
| Consumers of the capture snapshot | Only scalars are read: `userId`, `idempotencyKey`, `request`, `requestHash`, `amountCents`, `total`, `shippingCost`, `cartIdentity`, `cartId`, and `verifyAuthorization` scalars. The items used in the capture transaction come from a separate `paymentAttemptItem.findMany` (`order.service.ts:131`), which has no relation load. No consumer of the include's item order exists. | Source |

## 5. Benchmark evidence (reused, not rerun)

Bounded, read-only, concurrency 1, warm connection, strategies interleaved, DEV pooler `ap-northeast-2`:

| Path | Round trips | p50 before → after | p95 before → after | Failures |
|---|---|---|---|---|
| `GET /api/cart` reads | 5 → 3 | 2.5–3.4 s → 1.5–2.6 s | 3.8–9.0 s → 2.4–5.5 s | 0 |
| Saved purchases reads | 5 → 2 | 7.1 s → 2.7 s | 14.6 s → 5.6 s | 0 |
| Setup-transaction reads only | 10 → 8 | 18.5 s → 12.4 s | 28.1 s → 20.4 s | 0 |

Limitations: network latency varied up to 5× between runs; 20 samples per strategy; carts in DEV have at most 2 lines; the setup figures exclude locks, writes and commit. The full setup transaction duration is unmeasured. Server execution is under 2 ms for every path, so latency is network-bound. This change does not resolve the four reported loading problems.

## 6. Checks run on 2026-10-14

| Command | Exit | Result |
|---|---|---|
| `npm run prisma:generate` | 0 | Section 2 |
| `prisma validate` | 0 | valid |
| `npx tsc --noEmit` (backend) | 0 | |
| `npx eslint src/services/order.service.ts` | 0 | |
| `npx vitest run` on order/payment/checkout test files plus `prisma.test.ts` | 0 | 7 files, 173 passed; 2 env-gated files (live checkout and A–J) skipped and not run |
| `npm run build` (backend) | 0 | |
| Capture-query runtime check | 0 | Section 4 |

## 7. Test-failure reconciliation (owners: Task 03.6 / FRONTEND / OBSERVABILITY)

| Item | Status on 2026-10-14 | Owner |
|---|---|---|
| 3 frontend unit failures (`PaymentSessionIsolation.test.tsx`) | **Corrected by Task 03.6** at 15:48 as stale presentation expectations. Reproduced: 2 files, 15/15 pass. | Task 03.6 |
| 18 lifecycle browser failures (`playwright.payment-lifecycle.config.ts`): 8 heading, 6 retry-confirmation, 4 legacy status screen | Unchanged. No spec or exercised component changed since the last run (2026-10-13, 31 pass / 18 fail). Not rerun. They assert pre-Scenario-1 behavior; Task 03.6 has treated Scenario 1 as authoritative in its unit tests. | Task 03.6 / FRONTEND |
| Count note | The earlier "21" was 18 browser + 3 unit; the 3 unit failures are now resolved, leaving 18. | |
| Backend logger exception masking in `setup()` `finally` | **Already corrected by OBSERVABILITY** (`logSafely`, `payment.service.ts:257`); its test passes | OBSERVABILITY |
| 16 backend failures (logger mocks lacking `logSafely`) | Corrected 2026-10-13 by completing the mocks in `tests/product.api.test.ts` and `tests/search.test.ts` (no assertion changed) | OBSERVABILITY to confirm |
| `tests/logging-continuity.test.ts` | Intermittent 5 s timeouts only under parallel load; 23/23 alone | OBSERVABILITY |

## 8. Cross-workstream handoffs

### 8.1 PAYMENT / FRONTEND — duplicate payment resume

- Evidence: request IDs `324609cf-e1df-4745-ae2c-69f14d971aee` and `402c0716-b84c-4ab6-a537-7712f5830902` started 35 ms apart (13:06:09.613Z / .648Z on 2026-10-13) for the same attempt's `POST …/resume`. The first logged `db.error` and returned 503 `PAYMENT_UNAVAILABLE` after 52,987 ms; the second returned 200 after 64,062 ms. The app renders under `StrictMode` (`src/render.tsx`); the retry page's effect at that time aborted on cleanup and re-posted.
- The client's retry-eligibility deadline is 25 s (an approved requirement), against 53–64 s server resolution on this link.
- Owner review requested: StrictMode effect replay, single-flight, safe retry semantics, the deadline mismatch. Preserve backend idempotency, durable recovery and UNKNOWN-outcome behavior.
- **Existing edits needing owner disposition:** under the 2026-10-13 directive, which assigned this work, the following were implemented and remain in the tree. The current directive moves this to the owners, so I have not modified them further. Keep, change or revert at the owner's discretion:
  - `apps/frontend/src/features/checkout/paymentResume.ts` (new): one in-flight resume per customer/attempt, 25 s bound, failure classification.
  - `apps/frontend/src/features/checkout/PaymentRetryPage.tsx`: uses it; a timeout or 5xx shows "not a payment result" with Check again, and only a 4xx shows "cannot be retried yet".
  - `apps/frontend/src/features/checkout/paymentResume.test.tsx` (new): 16 tests.
  - `apps/backend/src/services/payment.service.ts` `resume()`: per-process single-flight keyed by owner and attempt, plus a bounded serialization retry (≤2) that re-reads eligibility under locks. Only side effects are a provider read and an `expiresAt` extension.
  - `apps/backend/src/services/__tests__/payment.purchase-ownership.test.ts`: 8 barrier tests.
  - `apps/frontend/tests/checkout/loading-baseline.spec.ts` (new), intercepted measurement spec, and its note in `docs/08_Quality/TESTING.md`.
  - Cross-instance correctness relies on PostgreSQL row locks and is **not verified** against real PostgreSQL.

### 8.2 PAYMENT / DATABASE — long transactions and setup latency

- Evidence: setup-transaction reads alone measured p50 12.4 s, p95 20.4 s, max 23.4 s with joins. A new-attempt setup transaction statically issues about 13 round trips with joins, inside a 30 s Serializable interactive transaction (`maxWait` 10 s). No retained runtime trace shows a full setup exceeding 30 s.
- A read-only candidate: `currentCart` as one nested statement returned identical results for 13/13 DEV carts (including 9 excluded-product lines). p50 880 → 452 ms, p95 1,090 → 573 ms, server cost under 1 ms. Unmeasured for carts above 2 lines; 11 callers; stubs in 7 test files; it changes the SQL inside every payment transaction. **Not implemented.**
- Request: focused examination of transaction scope, lock wait, query sequence and real failure classification. The setup performance log now reports per-attempt outcome codes, lock wait, statement time, commit remainder, timeout and max-wait. Do not raise the timeout or change isolation without cross-owner approval. Stock, price and snapshot reads must stay under the cart lock.

### 8.3 PAYMENT / OBSERVABILITY — error masking and Prisma codes

- The logger exception in `finally` masking a validation error: already corrected by OBSERVABILITY (`logSafely`).
- The observed 503 (`324609cf…`) carried only `DATABASE_ERROR`. `lib/prisma.ts` now records sanitized `prismaCode` and `sqlState` (never the engine message), and OBSERVABILITY has added request correlation. Extraction tests pass. The P-code extraction was added on 2026-10-13 under the earlier directive; OBSERVABILITY owns it now.
- The separate historical HTTP 500 on setup remains **UNKNOWN**. Duration alone does not establish its cause.
- Request: confirm sanitized structured diagnostics keep the original error, the safe Prisma code and correlation, with no credentials, payment details, client secrets or provider payloads.

## 9. Rollback

1. In `schema.prisma`, set `previewFeatures = ["driverAdapters"]` and remove the three comment lines.
2. In `order.service.ts:80-81`, remove the comment and the `relationLoadStrategy: 'query'` argument. It only typechecks with the feature enabled.
3. Confirm no process has the engine loaded, then run `npm run prisma:generate` in `apps/backend` and require exit 0.
4. Run `npx tsc --noEmit`, the order/payment focused tests and `npm run build`.

Never restore a copied client directory or edit generated files by hand.

## 10. Decisions still required

- Principal Architect: source review of sections 1 to 4.
- DATABASE: deletion of the five stale temp DLL files; reformatting the shared schema.
- AUTH: DEV schema alignment for the lineage columns before any backend start against DEV.
- PAYMENT / FRONTEND: disposition of the edits listed in 8.1 and the 18 browser expectations.
- PAYMENT / DATABASE: whether to pursue the `currentCart` change request (8.2).
