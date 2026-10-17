# Task 03.6 — Real-Flow Acceptance Plan and 17-Migration Release Gate

Prepared 2026-10-14. **Planning and offline verification only.** No database was connected to, no Stripe API was called, no workflow ran, nothing was staged, committed, pushed or migrated. No real-flow acceptance evidence was produced by this document: every real-PostgreSQL and real-Stripe item below remains **BLOCKED** or **NOT VERIFIED** and is not claimed otherwise. Decision text, score and closure belong to the Principal Architect.

Extends `TASK_03.6_ACCEPTANCE_CLOSURE_HANDOFF.md` (matrix A, blockers B1-B4, baseline 258 backend / 132 frontend mocked tests, unchanged). AUTH, CI and pre-push work are not reopened.

## 1. New findings (observed this pass)

| # | Finding | Consequence |
|---|---|---|
| F1 | `payment.concurrency.postgres.integration.test.ts` (A-J) is hard-wired to **shared DEV**: constants for project ref `pzxekjybdiulzmssalfo`, schema `electrohub_payment_concurrency_20261012`, role `eh_payment_concurrency_runner`, a `DEV:...` scope string, `DATABASE_URL === DIRECT_URL === PAYMENT_PG_TEST_DATABASE_URL`, and `STRIPE_SECRET_KEY === ''`. Its runner (`payment-concurrency-integration-suite.cjs`) also accepts only the DEV target. | It cannot run on a disposable PostgreSQL unchanged. Using it there needs a harness generalization (task-owned, not done, not runnable here), not an environment variable. |
| F2 | A-J covers only **10 scenarios of the new ownership transfer** (submit, Cart B isolation, lease fencing, webhook/processor duplicates, ownership constraints, serialization). It does **not** cover spec section 54 crash/restart boundaries, section 53 rows "last unit", "same key setup", "compensation runners overlap", or most of section 52. | A fully green A-J run would still **not** satisfy sections 52-54 as written. The earlier framing "A-J = the real PostgreSQL acceptance" understates the requirement. |
| F3 | `payment.stripe.live.test.ts` (real DEV API + PostgreSQL + Stripe Test Mode, 20 test definitions (some parameterized), disposable `isTestFixture` data) covers most of sections 52-54 and 57 **by title**, but was last modified **2026-10-09**, before the 2026-10-12 submitted-purchase redesign. It never calls `POST .../submit`, and nothing in it exercises ownership transfer. | It is the right instrument but is **unvalidated against current source**. Current source still commits an authorized (`requires_capture`) attempt without a `submittedAt` precondition (`payment.service.ts` ~line 633), so it is probably runnable, but its results would not cover the new lifecycle. I did not edit it: an unrunnable edit to a financial live test would be unverified. |
| F4 | A faithful **disposable PostgreSQL is unavailable right now**: no Docker on this machine; the local PostgreSQL 18 service has no verified credentials/isolation and the owner earlier declined local DB execution. The CI disposable-container recipe is prepared in source but has not run on a runner. | Disposable-database acceptance needs either an owner-approved local PostgreSQL or the authorized CI disposable run. |
| F5 | PROD's ledger differs from DEV **by approved design** for two historical migrations (foundation: UTF-8 BOM + CRLF; OTP: CRLF; DEV used LF). Documented in `docs/06_Database/MIGRATIONS.md`. Seven historical physical defaults (`id` `gen_random_uuid()` and `updatedAt` `CURRENT_TIMESTAMP` on five tables) also differ from `schema.prisma` by approval. | A PROD `pre-check` that demands byte-identity with LF blobs (as `dev-migration.yml`'s `migration-plan.cjs` does for DEV) would **block PROD** on those two. The future PROD workflow needs an explicit, owner-approved exception list. A parity check needs the same list of tolerated differences. |
| F6 | All four local env files, **including `.env.production.local`**, carry a Stripe **test**-mode secret key (prefix check only; webhook secrets are `whsec_`; the frontend publishable key is `pk_test_`). | Consistent with "PROD live payments deferred". A PROD application deployment would have no live Stripe credentials; not a Task 03.6 blocker, but a PROD release must treat it explicitly. |
| F7 | Diagnostics can correlate a future setup failure: the setup response sets `x-request-id`; `payment.setup.http_performance` and `payment.setup.transaction_failed` events carry the same correlation ID, stage, sanitized Prisma code and SQLSTATE; attempt state is available from the owned read. Tested [MOCK] (`payment.setup-timing`, in the 258). Not verified in a hosted runtime. | A single authorized setup would produce the missing record **if the failure recurs**. It cannot be reconstructed for the historical 503/500. |

## 2. Minimal real verification the specification requires

Required by spec: section 52 (real PostgreSQL transaction/migration tests), 53 (genuine concurrency), 54 (crash/restart), 57 (real Stripe Test Mode with signed CLI forwarding). Coverage by existing instrument, by test title (bodies not re-read):

| Spec requirement | A-J (PG only) | Live suite (DEV + Stripe Test) | Gap |
|---|---|---|---|
| 52 valid one/many-item authorized commit, exact stock, immutable snapshots | A, E | #1 | Live suite predates ownership |
| 52 pre-authorization decline: zero effects | n/a | decline / action-required | - |
| 52 stock/price/product/category/Cart change after authorization: no purchase effects | B | Cart-mutation, price/product/category x3 | - |
| 52 injected second-item failure rolls back all | F | second-item failure | - |
| 52 unique/CHECK constraints (attempt, provider, event, work, money, quantity) | I (ownership) | CHECK/unique, intent-bound-once | - |
| 52 capture succeeded, DB write failed: recovered | G (fencing) | unknown capture; ack-failure boundary x3 | - |
| 52 compensation restores stock once; newer Cart merge; partial recovery | - | compensation, partial rollback | Removed/inactive product and quantity-limit restoration not evident |
| 52 no Stripe call inside a transaction | - | - | Mocked/static only |
| 52 migration apply/readback/legacy reads | runner replays migrations in an isolated schema | - | DEV readback exists for the ownership migration; legacy-record reads not evidenced |
| 53 last unit, two customers | - | last-unit test | - |
| 53 same owner/key setup; same Cart distinct keys | A | overlapping keys (same/different) | - |
| 53 reconcile + webhook + worker: one Order | H | partial | - |
| 53 duplicate capture/timeout/restart | - | unknown capture; expired worker | - |
| 53 compensation runners overlap | - | restarted/overlapping workers | - |
| 53 stale worker vs success/cancel/supersede | G | expired worker | - |
| 54 crash boundaries 1-10 | - | provider-reply-loss, browser abandonment, lost cancel reply, capture/cancel/binding ack failure, pending refund restart, expired lease | Boundary 4 (webhook accepted, work not run) only partly; all against pre-redesign flow |
| 57 real Stripe: authorize+capture, decline, 3DS success/cancel, webhook events, replay | n/a | decline, action-required; others by historical runs | Current-source run absent; signed CLI forwarding readback last timed out |

**Minimal required real evidence, therefore:** (1) the A-J run (new ownership transfer on PostgreSQL), plus (2) the live suite reconciled to the current lifecycle (add the explicit submit step and ownership assertions) run against PostgreSQL **and** real Stripe Test Mode, plus (3) the signed CLI-forwarded webhook cases of section 57. A disposable PostgreSQL can faithfully host (1) and the database side of (2); it cannot replace real Stripe for (2)/(3), which still call the Stripe Test account. Real Stripe Test Mode with a disposable database avoids all shared-DEV writes; shared DEV is required only if the owner insists on the Supavisor/hosted-pooler path (section 59 slow-network and the 53 s setup anomaly are pooler-sensitive and cannot be inferred from a loopback database).

**Recommended route for the owner to choose (not done here):**
- Option A (preferred): disposable PostgreSQL 17 with TLS (owner-approved local instance or the authorized CI disposable run), generalize the A-J and live harness scope guards to the disposable target, execute (1)-(3); real Stripe Test Mode only for card/capture/webhook steps. Hosted-pooler behaviour then stays an explicitly classified residual risk.
- Option B: shared DEV through the already-prepared gate: Supavisor capacity numbers recorded by the owner (pool size, client cap, headroom), a trusted five-second monitor feed, the exact one-run authorization string, bounded 15-minute quiet window, at most four role sessions.

Neither is authorized by this task. If approval is unavailable, each gate stays **BLOCKED**.

## 3. Stripe Test Mode verification matrix (proposed; nothing executed)

Common rules for every row: Stripe **TEST** account `acct_1UEZW5KiVgdl63pN` only; secret key prefix `sk_test_` (observed offline); **preflight S0 must pass before anything else**; amounts use the fixture price (`1.00`) within the acceptance ledger's remaining allowance (historical allowance UNKNOWN: the owner must restate it before a run); one operation, one stable identity, **never replay an operation whose outcome is unknown, read provider truth instead**; stop on the first unexpected state; PROD and live keys are forbidden.

| ID | Operation | Expected side effects | Idempotency identity | Stop condition | Environment |
|---|---|---|---|---|---|
| S0 | Read-only account retrieval (identity) | None | n/a (GET) | Account id differs from `acct_1UEZW5KiVgdl63pN` or `livemode` is true | Test key, no DB write |
| S1 | Setup, card `4242 4242 4242 4242`, manual capture, submit, commit, capture | 1 PaymentIntent, 1 captured test charge, 1 Order+Payment, stock decremented once, Cart cleared, 1 capture command | Attempt's persisted stable operation keys for create and capture (confirm exact format from the ledger before running) | Any second capture attempt or non-matching amount | Disposable PG or DEV; real Stripe Test |
| S2 | 3DS success `4000 0025 0000 3155` | As S1 after authentication | As S1 | Authentication not completed within the bounded wait | Same |
| S3 | 3DS cancellation | Intent canceled, Cart and stock preserved, no Order | Stable cancel identity | Any purchase effect | Same |
| S4 | Decline `4000 0000 0000 9995` | `DECLINED`, zero purchase effects, same attempt retryable | Same attempt/intent reused on retry | A second PaymentIntent created for the same attempt | Same |
| S5 | Duplicate setup/submit (same key, concurrent) | One attempt, one provider creation, one purchase | Same key | Two intents/orders | Same |
| S6 | Ambiguous outcome (harness-injected reply loss after provider success; fault is test-mode only) | Fresh runner retrieves the existing intent; no second capture, no premature stock release | Existing identities | Any call that would create a second charge | Same |
| S7 | Webhooks via signed Stripe CLI forwarding (`amount_capturable_updated`, `succeeded`); tampered-signature and replayed-event-id deliveries | Valid signed events processed once; bad signature rejected with no effects; replay recorded as duplicate | Event id | Unsigned/unknown events producing any effect | Same + CLI listener |
| S8 | Compensation: committed purchase whose capture is definitively rejected, then pending-refund restart | Stock restored once, newer Cart merged, one refund with stable identity, survives restart | Refund identity | Duplicate refund or stock inflation | Same |

Each row records: request id (`x-request-id`), UTC times, attempt id, provider ids, DB/Stripe read-back agreeing on intent/Order/amount/state, and cleanup of disposable fixtures.

## 4. Scenario 1 owner verification (current UX contract)

Preconditions: updated source running locally, owned services only, authorized Test Mode account, one customer and disposable fixtures. Do not repeat any ambiguous payment.

1. Submit a purchase; confirm the shared loader (heading "Processing your order…") appears and Checkout does not offer a second action that could resubmit.
2. While it is unresolved, add a different product to the Cart: the Cart shows a pending purchase separately from the active Cart, and Checkout B stays isolated.
3. Open a bookmarked `/account/payment-status/<attempt>`: it redirects to `/cart?purchase=<attempt>` and issues no new payment request.
4. Success: the Cart outcome indicator briefly shows, collapses (about 450 ms), Orders updates, a bottom-right toast (5 s, closable) appears once, and the second tab does not duplicate it.
5. Decline: the failure goes to compact Saved purchases (never Pending), retry is explicit and keeps the same attempt, Cart B is untouched.
6. UNKNOWN: "Awaiting confirmation", no toast, no resubmission.
7. A late A result never navigates away from B (offline-proven; confirm in the real browser).

Record screenshots, timestamps and `x-request-id`s. The owner's earlier manual result was PARTIAL; this section is not a pass until the owner records one.

## 5. HTTP 503 (about 53 s) and 500: classification

Not a confirmed source defect; **root cause UNKNOWN**; not fixed and not claimed fixed. No timeout was changed and no setup was replayed. It is a **verification gap that can only be closed by a correlated runtime record** (F7). Acceptable as a **residual operational risk** only if the owner records that decision; otherwise it stays a closure condition. A pooler-sensitive cause cannot be excluded by a loopback disposable database.

## 6. Mandatory release requirement: 17 Prisma migrations in DEV and PROD

Separate from Task 03.6 acceptance. **Nothing here authorizes execution.**

| Item | DEV | PROD |
|---|---|---|
| Expected migrations in the approved release checkout | 17 present locally; 4 applied-to-DEV migrations and the AUTH migration are untracked in Git | same checkout |
| Applied (last read) | 16 finished, 0 failed/rolled back (observed read-only 2026-10-14; **re-read immediately before any execution**) | **NOT VERIFIED.** Documentation (REPORTED) says PROD received `checkout_core` and `stripe_orchestration`, i.e. about 13; `test_fixture_visibility`, `storefront_visibility`, `payment_purchase_ownership` and AUTH would then be pending: **not confirmed** |
| Pending now | AUTH only | possibly 4; unknown |
| Checksum rule | byte-identical to LF blobs for 16; payment migration is CRLF | PROD differs from DEV for foundation (BOM+CRLF) and OTP (CRLF) **by owner approval**; needs an explicit exception list |
| Schema parity | `refresh_tokens` and ledger observed; whole-schema parity NOT VERIFIED | NOT VERIFIED |
| Parity method | From an LF release checkout, `prisma migrate diff --from-url <env direct URL> --to-schema-datamodel prisma/schema.prisma --exit-code` (read-only); tolerate only the approved seven historical defaults; any other difference stops the release | same, after separate read-only authorization |
| Forbidden | `db push`, `migrate reset`, manual `_prisma_migrations` edits, `migrate resolve` without separate approval | same |

Byte-sensitive inputs to carry forward: `.gitattributes` rule `apps/backend/prisma/migrations/*/migration.sql -text` (pending its owner), the four untracked applied migrations included **unchanged** (hashes `8efc55f8e823`, `007b9167866b`, `21ae532f49eb`, `0cf4bc6b88a2`; the last is CRLF), AUTH migration LF `51495598e0e1...2e991`.

Required order, each step a separate authorization, never automatic:
1. Task 03.6 closed by the Principal Architect.
2. CI and GitHub environment safeguards complete and approved.
3. Explicit safe-push authorization and coordinated integration.
4. DEV cutover, `migrate deploy`, post-verification (ledger, 17 finished, parity diff clean, zero active refresh tokens, application smoke).
5. PROD read-only reconciliation and approval (ledger, `refresh_tokens`, payment/checkout tables and constraints, server version).
6. PROD cutover, `migrate deploy`, post-verification, via a **separate gated PROD workflow** that does not exist yet and must carry the checksum exception list.

## 7. Does Task 03.6 meet the specification as written?

**No, not yet.** Required real PostgreSQL (sections 52-54) and real Stripe Test Mode (section 57) evidence on current source is absent, no owner-approved deferral is recorded, Scenario 1 manual acceptance is open, and the 503/500 concern is neither explained nor classified by the owner. Source and offline evidence are consistent. Closure requires either executing the Option A/B plan with authorization, or a recorded owner scope decision accepted by the Architect.

## 8. Smallest next owner action

Decide the route: **choose Option A or B** and authorize its gate (or record a scope deferral). Option A also needs either an owner-approved local PostgreSQL or permission to run the disposable CI job. Independently, the owner can restate the acceptance-ledger Stripe allowance and capture the Supavisor numbers from the dashboard, which unblocks either route without any write.

## Update 2026-10-14 (harness preparation)
See `TASK_03.6_DISPOSABLE_HARNESS_READINESS.md`: the disposable PostgreSQL scope (`scripts/payment-pg-disposable.cjs`), scenarios K-R, and the adapted live Stripe suite are prepared and verified offline only (12 + 32 script tests, typecheck, lint, discovery). No real-flow test has been executed; status of every real-PostgreSQL and real-Stripe item is unchanged: BLOCKED / NOT VERIFIED.
