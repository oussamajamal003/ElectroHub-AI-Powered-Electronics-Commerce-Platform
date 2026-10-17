# Task 03.6 — Intermittent Processing: root cause and acceptance

Review date: 2026-10-16. Branch: `feature/Stripe`. Base commit: `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`.

**Task remains OPEN for Principal Architect approval. No commit, push, merge, CI or deployment.** This report supersedes no historical evidence: it distinguishes newly reproduced mechanisms from earlier observations, and preserves unsuccessful acceptance runs.

## 1. Executive finding

There are distinct ways a purchase can look stuck. Two backend mechanisms were reproduced and corrected:

1. **Recovery never starts after a failed API database prewarm.** `server.ts` placed `startInProcessRecovery()` inside the successful-prewarm branch. The HTTP process could survive the outage and later serve database traffic without ever starting recovery. A regression failed with zero recovery starts before the correction. Recovery now starts independently; its existing loop owns readiness retries. A real isolated API started with PostgreSQL unavailable subsequently processed its saved authorization and reported a healthy local runner.
2. **A retried decline can be permanently undiscoverable after a missed webhook.** A verified decline finishes `PaymentWork` as `DONE`. Stripe allows the approved retry of that same Intent. The batch selector and claim predicate previously accepted only due `READY` or expired `LEASED` rows. Without a later webhook or browser reconciliation, the old `DONE` row was never selected. Real PostgreSQL scenario H reproduced `DECLINED` where `PAID` was expected. Both selection and atomic claim now include due `DONE` rows bound to submitted `DECLINED` attempts with a provider identity. Unchanged declines schedule a provider recheck after 60 seconds. This retrieves the existing Intent; it does not confirm a card or create an Intent.

Other corrections from this acceptance pass: both runner topologies now share the bounded incident/overdue query; graceful API shutdown drains recovery before disconnecting Prisma; cancellation during readiness prevents a new batch; local recovery health exposes progress and a stable worker instance identity; financial transition logs link attempt, Intent, lease, order and correlation IDs. An unchanged definitive decline stays classified as declined during its periodic lease. Card entry awaiting customer input now has a distinct Cart label, without a progress animation or failure toast. During the later concurrent edit, another writer added a confirmation-start signal and additive migration; it is not part of the recovery correction described here.

These are demonstrated failure mechanisms, **not proof that every historical DEV incident had the same cause**. The old hosted 53-second setup failure and missing historical request timeline remain unexplained.

## 2. Historical evidence and why earlier fixes were insufficient

`TASK_03.6_PROCESSING_RECOVERY_HANDOFF.md` and `.cache/payment-lifecycle-followup/intermittent-provider-comparison.json` distinguish unpaid card entry, genuine decline and captured payments. The USD719 attempt `080806e3-70cc-4dfa-a664-2571cbd731fd` initially had no payment method, no received/capturable amount and no decline. It was not evidence of a failed charge. Its later explicitly approved provider cancellation and deferred shared-DEV synchronization are historical; this task performed no shared-DEV reconciliation write.

Earlier UI discovery/route fixes cannot start an absent backend runner. Adding in-process recovery still left its startup behind a one-shot database check. A durable queue plus webhook ingestion also does not guarantee that a mutable, retryable provider Intent remains discoverable after its prior work row becomes `DONE`. The new tests cover these exact boundaries rather than relying on several successful cards.

## 3. Preserved financial contract

PaymentAttempt/items remain the saved purchase; PaymentWork remains the sole durable processor; Order remains the commercial result. No new payment engine, schema migration or compensation policy was introduced. Existing Attempt → Work → Cart locking, Serializable transactions, lease-token fencing, provider binding, stable financial idempotency keys and manual capture remain in place. Provider calls remain outside transactions. `AUTHORIZED` is not `PAID`; uncertain acknowledgement remains `UNKNOWN`; genuine failure and abandonment remain distinct.

`DONE` is still a completed observation for a decline, but it no longer means that a retryable Intent can never change. Background rechecks are serial, limited to the existing ten-row batch, and spaced by `nextRunAt`. This adds provider reads for retained submitted declines; operators must include that load in capacity planning. Paid/canceled/refunded work is not added to this selector. Incident work still requires actionable investigation; it is not blindly replayed.

## 4. Isolation, credentials and budget

New acceptance writes target only the task-owned PostgreSQL **17.10** cluster on loopback port **55439**, database **electrohub_ci_p0**. Its pinned `@embedded-postgres/windows-x64@17.10.0-beta.17` archive matched npm's SHA-512 integrity. The repository's guard proved PostgreSQL 17, strict per-run CA/TLS, loopback, dedicated database/roles and no hosted-platform objects before migration replay. Native Prisma TLS probes and migrations passed. The unrelated installed PG18 service and the owner's existing disposable instance on 55432 were not stopped or modified.

The prior 55432 disposable database was queried read-only to reconcile its seven later Intent IDs. The canonical account was retrieved as `acct_1UEZW5KiVgdl63pN`; all retrieved objects were Test Mode. The CLI was supplied the canonical application's Test Mode key in memory rather than relying on its differently bound stored login.

The owner explicitly confirmed a **70 total** ceiling during this task, correcting the later usage to seven, not “about 11.” Accounting retains **54 consumed** as its inherited baseline. The old ledger plus seven database rows expose 46 distinct retrievable Intent IDs; that incomplete independent historical inventory does **not** reduce the 54 baseline. New setup reservations are fsynced before setup and remain consumed across failed harness runs. No reset of historical accounting occurred.

No secret URL, password, private key or raw webhook payload is included in evidence. The new database password is Windows-DPAPI protected outside the repository in an owner-only directory. Raw signed webhook bodies/signatures were retained only in memory for the replay test.

## 5. New verification and retained failures

| Evidence class | Result |
|---|---|
| Startup regression before fix, mocked dependencies | FAIL: recovery start called zero times |
| Real PG A–J before strengthening | 10 PASS |
| Strengthened real PG A–J before the discovery correction | 9 PASS / 1 FAIL (H); guarded cleanup completed |
| Strengthened real PG A–J after correction | 10 PASS / 0 FAIL / 0 SKIP; guarded run schema removed |
| Focused backend final unit/service/route/driver suites | 259 PASS / 0 FAIL / 0 SKIP, 13 files |
| Focused frontend final suites | 145 PASS / 0 FAIL / 0 SKIP, 5 files |
| Disposable runner offline safety suites, working OpenSSL and owned-child permissions | 32 PASS / 0 FAIL / 0 SKIP |
| Backend build/typecheck and scoped ESLint | PASS |
| Frontend build/typecheck and scoped ESLint | PASS; existing large-bundle advisory retained |

The initial frontend run had eight failures (137 passes). The new awaiting-input requirement contradicted one old Processing assertion; retry fixtures omitted the current owned-status preflight and fresh outcome versions, and one expected a failed-state button for awaiting input. Tests now exercise those contracts without removing the ownership/read/identity assertions. The final frontend typecheck also caught an unreachable test comparison, which was corrected.

Initial runner tests under the restricted sandbox had OpenSSL skips and child-termination failures. The subsequent explicit rerun with the installed working OpenSSL client and permission to terminate only owned mock child trees passed all 32; the first result is not counted as a pass.

Acceptance-controller failures are retained in `live-evidence.jsonl`: wrong TLS-helper invocation; CLI 1.53.1 requiring an explicit event list; a nonexistent Buy Now quote URL; an unhandled **controller** connection during the intentional outage; an overly broad mobile Try Again selector; a frontend startup race; a premature iframe-empty assertion; and 3DS selection/resume diagnostics. These are not silently excluded or reclassified as application passes. Recorded identities are resumed rather than replaced.

## 6. Operational and browser results

New real batches verified repeated success/decline, same-Intent retry without a webhook, independent customers, concurrent success and decline, Buy Now isolation, expired-worker lease recovery, database stop/restart, backend cold-start recovery, and captured-payment acknowledgement failure. Genuine CLI-signed webhook bytes were delivered twice each in reverse order: all four replays returned 200, only two event rows remained, and the existing paid order was unchanged.

At 1366×900, A's success toast appeared while B's real Payment Element retained its card entry and total. At 390×900, A's decline toast appeared while B retained Shipping fields and its Cart. Neither redirected or changed Cart B. Return to the same submitted purchase scrolled to top at both widths. Real card entry, Review and Place Order reached authoritative success on desktop and decline on mobile. A subsequent exact-B mobile retry verified an empty Stripe card field and reached paid on the same Intent without another setup.

Screenshots taken immediately after toast insertion may show its entrance animation; they alone do not prove settled toast bounds. No Figma parity claim is made. `assets/figma` was absent in this workspace. Existing tokens/components were reused.

## 7. Monitoring and remaining operational limits

`GET /api/health/payments` now combines durable overdue/incident checks with **local** in-process progress. Starting, stopped, failed or >120-second stale local progress is not healthy. That stale threshold is an attention signal, not a forced payment result; an unusually long batch can also trigger it. External-worker liveness is explicitly `external_unverified` in the API, never inferred from an empty queue. Separate-process supervision and alert delivery remain operational requirements when in-process recovery is disabled.

Both runners use the existing bounded escalation query (oldest ten incidents or submitted READY/LEASED purchases older than 30 minutes), once per minute. Twelve consecutive work retries still become an incident with correlation evidence. Financial failures are not suppressed. Prolonged infrastructure/provider failure can delay recovery; no guarantee of uninterrupted availability is made.

This disposable loopback test does not establish hosted Supavisor capacity or explain shared-DEV P2028 history. No hosted worker, historical READY work, shared application data, production database or production Stripe account was used for writes.

## 8. Source corrections

- `apps/backend/src/server.ts`, `server.recovery.test.ts`: independent recovery startup and shutdown drain.
- `apps/backend/src/payment-inprocess-recovery.ts`, `payment-runner.ts`, `payment-recovery-loop.ts`: shared attention, shutdown fencing and correlated runner execution.
- `apps/backend/src/payment-recovery-attention.ts`, `payment-recovery-runtime.ts`, their service tests: bounded attention and explicit local health evidence.
- `apps/backend/src/routes/health.routes.ts`: include overdue decline rechecks and local runner health; external liveness remains unverified.
- `apps/backend/src/utils/logContext.ts`: optional worker instance identity.
- `apps/backend/src/services/payment.service.ts`, `payment.domain.ts`: matching batch/claim discovery for submitted declines, spaced observations, definitive decline classification and transition correlation.
- `apps/backend/src/services/__tests__/payment.concurrency.postgres.integration.test.ts`: strengthen G and H, without expanding A–J to K–S.
- `apps/backend/src/services/__tests__/payment.domain.test.ts`, `payment-recovery-loop.test.ts`: prevent decline flicker and new work after shutdown.
- `apps/frontend/src/features/checkout/PaymentPurchases.tsx`, its test, and `CheckoutPage.test.tsx`: truthful card-entry presentation and current retry/preflight/version regression fixtures.

The prior scroll/toast changes and all unrelated working-tree changes were preserved. Temporary acceptance controllers live under `.cache/payment-p0-runtime`; they are not production services or a replacement payment engine.

## 9. Final evidence appendix — 2026-10-16

### Stable source boundary

During acceptance a second writer changed the payment service, domain, Prisma schema, and added migration `20261016000000_payment_attempt_confirmation_started`. The acceptance controller's source/build guard then blocked continuation with `BUILD_STALE` at 19:08:08Z. The writer was paused by the owner. At resume, no Claude, Codex, Node, PostgreSQL or `pg_ctl` process was present; the payment files had stable observed modification times. This report therefore distinguishes evidence from the earlier tested build from the current checkout. No rebuild, migration, or financial operation was performed after the stale-build guard.

Current checkout fingerprints at resume:

| File | SHA-256 |
|---|---|
| `apps/backend/src/services/payment.service.ts` | `5B218CE50DA56A4DEFBD473327B7922AAEE31193D6DEC357D03B328D59F59193` |
| `apps/backend/src/services/payment.domain.ts` | `2898F6EA2979D41347FAE0208E59BFD1EB97AF766FED992B38B5ACDAD6B2A341` |
| `apps/backend/prisma/schema.prisma` | `06CAC75C494FA3F71B3125DA0C8E1993371011AAC10AE36DC9FEEC76A752EBCD` |
| `apps/backend/prisma/migrations/20261016000000_payment_attempt_confirmation_started/migration.sql` | `97F32AB98DC286955ADBA6881D661B49434611C5EC037239D7F084781E933A05` |

The confirmation-start change is present in the current working tree and is not represented by the earlier source fingerprint used for the passing recovery acceptance. Although later guarded disposable-run invocations logged migration success, a final direct catalog and migration-ledger readback was not captured. Current-source PostgreSQL acceptance is therefore **NOT VERIFIED**.

### Attempt budget and outcomes

The inherited consumption was 54 of the 70 authorized attempts. The new reservation file records ordinals 55–70, fsynced before each attempt setup. Therefore the authorized ceiling is fully consumed: **70/70 accounted; no new PaymentIntent may be created under this authorization**. The inherited 54 baseline is retained despite only 46 distinct IDs being independently retrievable from the old ledger and seven later database rows. The seven later rows were confirmed by the owner; earlier approximate “about 11” notes are corrected in the master handoff addendum.

Of the 16 new attempts, 15 reached PAID with one order, one payment, and one capture each; one 3DS attempt remains correctly `ACTION_REQUIRED` / Stripe `requires_action`, with a READY recovery row and no order or charge. No forced result was applied. Identifiers and sanitized per-attempt records are in `.cache/payment-p0-runtime/live-evidence.jsonl`; the complete 16-attempt mapping is retained in the owner-approved disposable acceptance evidence. The final financial invariant read reported 15 paid, 15 orders, 15 payments, and stock decrements totaling 15. Captured amount was $15; real-money amount was $0. No refund or cancellation was performed by this run.

Attempt-level terminal readback (all initially submitted from `AWAITING_INPUT`; retry rows describe subsequent provider observations for the same attempt/Intent):

| PaymentAttempt | Scenario | Provider outcome | Persisted outcome | Order | Result |
|---|---|---|---|---|---|
| `56393a5c-ddb9-4f12-9542-410165961e22` | Batch success | `succeeded` | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `150ec209-b6a6-4d66-983e-69363d1ea7b3` | Decline, then same-Intent recovery without webhook | `requires_payment_method` → `succeeded` | `DECLINED` → `PAID`, Work `DONE` | 0 → `CONFIRMED`, 1 | PASS |
| `29100939-5018-487f-b361-1466a003e539` | Buy Now | `succeeded` | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `c3564968-6dc6-46ca-9791-f53378fb0629` | Expired lease / worker restart | `succeeded` | `PAID`, Work `DONE` after lease recovery | `CONFIRMED`, 1 | PASS |
| `06ea222f-a81a-4770-b173-2627ac889e63` | Database outage and recovery | `succeeded` | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `0596d1ea-cbaf-4f60-b6d1-b8c79a10ae92` | Decline then real capture reply loss | `requires_payment_method` → `succeeded` | `DECLINED` → `CAPTURE_PENDING/UNKNOWN` → `PAID`, Work `DONE` | 0 → `CONFIRMED`, 1 | PASS |
| `edf24ccc-fe5f-4e9c-aab1-2de1e9fac9c9` | Concurrent customer success | `succeeded` | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `f6cbaf66-4373-478e-aa53-f832c3f6c410` | Concurrent decline, later same-Intent retry with delayed provider and Cart B | `requires_payment_method` → `succeeded` | `DECLINED` → `PAID`, Work `DONE` | 0 → `CONFIRMED`, 1 | PASS |
| `51568f92-372d-4449-ae33-063d77f43ed4` | Desktop background A | `succeeded` | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `ff7da04f-7db1-4cd0-9933-0dde71913e1b` | Desktop Checkout B purchase | `succeeded` | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `15a3f597-e09d-4054-8ad5-a2941fea3c14` | Mobile background A; driver selected a different card's retry action | Initial `requires_payment_method`; later final inventory PAID | Final inventory `PAID` | One order in final 15/15 invariant; individual outcome event was not preserved in JSONL | PARTIAL evidence |
| `80b3e0f1-b090-4ede-bfd1-e498a110544a` | Mobile Checkout B decline then exact-attempt retry | `requires_payment_method` → `succeeded` | `DECLINED` → `PAID`, Work `DONE` | 0 → `CONFIRMED`, 1 | PASS |
| `cc2b3136-3118-40b4-bcc8-cd3ef96e073e` | Captured provider result / DB commit gap | `succeeded` | `CAPTURE_PENDING/UNKNOWN` → `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `1d2c3201-b4c8-4483-b159-19701df0ed9f` | API cold start while DB unavailable | `succeeded` | `PAID`, Work `DONE` after recovery | `CONFIRMED`, 1 | PASS |
| `feb2ddfe-be27-40d4-8dbe-ccbc29277aac` | Signed duplicate/out-of-order webhook delivery | `succeeded`; two unique event rows after four deliveries | `PAID`, Work `DONE` | `CONFIRMED`, 1 | PASS |
| `30af72f8-4973-4004-89f2-c2e4f7376eb7` | 3DS challenge | `requires_action` remained after Complete timed out | `ACTION_REQUIRED`, Work `READY` | None | UNRESOLVED; correctly not forced terminal |

The evidence stream does not retain every webhook ID, worker lease ID, notification acknowledgement, or a terminal outcome event for the mobile background A row. The aggregate 15/15 invariants support final financial counts, but those missing per-attempt correlations remain an audit limitation; they are not filled by inference.

Representative correlated evidence:

| Boundary | Evidence |
|---|---|
| Same-Intent retry after decline and missed webhook | PostgreSQL A–J H failed before the code correction (`DECLINED` instead of `PAID`) and passed after it. The real Stripe run later reached PAID using the same Intent, with no browser dependence. |
| Capture succeeded but DB acknowledgement failed | Real capture was followed by an injected PostgreSQL `P0001`; application retained `CAPTURE_PENDING`/`UNKNOWN`, then reconciled the same Intent to PAID with one Order. |
| Recovery after DB interruption | PostgreSQL stopped and restarted; in-process recovery started while DB was unavailable and later recovered the submitted attempt after connectivity returned. |
| Competing worker / delayed provider | A 20-second real provider response delay overlapped a competing worker and Cart B mutation; fencing held, capture count stayed one, and Cart B was preserved. |
| Duplicate and out-of-order signed webhooks | Two distinct signed events were replayed twice each in reverse order; all four responses were 200, two event rows remained, and no duplicate financial effects occurred. |
| Browser A/B isolation | Real Chromium at 1366×900 and 390×900 showed A's outcome toast during B checkout while preserving B's fields, totals, and route. Return to the same submitted purchase scrolled to top. |

### 3DS and remaining acceptance gaps

The final 3DS attempt reached Stripe's real test ACS (`testmode-acs.stripe.com`) and surfaced Complete/Fail controls. Selecting Complete did not resolve Stripe.js within the 30-second action deadline; there were no recorded network failures, and Stripe remained `requires_action`. The local state remained `ACTION_REQUIRED`, Work READY, with no Order and no charge. This is an **unresolved acceptance failure**, not a backend decline and not a reason to force a terminal state. The 3DS scenario is not accepted.

Browser closure followed by reopening the same attempt and observing its eventual terminal toast, settled mobile toast bounds, and the final 3DS completion remain unverified. Do not spend more attempts without a new explicit budget authorization. The full run also cannot be called current-source acceptance because source changed during the run and the stale-build guard correctly stopped it.

### Verification summary and decision

| Check | Result |
|---|---|
| Focused backend suites on tested build | 329 PASS / 0 FAIL / 0 SKIP, 39 files |
| Focused frontend suites on tested build | 145 PASS / 0 FAIL / 0 SKIP, 5 files |
| Offline runner safety | 32 PASS / 0 FAIL / 0 SKIP |
| Real PostgreSQL A–J on tested build | 10 PASS / 0 FAIL / 0 SKIP after the H correction; disposable schema cleanup completed |
| Real Stripe/browser attempts | 15 PAID; one remains provider-authoritative `requires_action`; all 16 reservations consumed |
| Backend/frontend build, typecheck, scoped lint | Previously passed before the current source mutation; not a verification of the current source fingerprint |
| Shared DEV/PROD writes, live Stripe, workers, CI, commits, deployment | None |

After the owner resumed work, current-checkout offline verification was run without a database target: 15 focused backend payment/recovery/health files passed **278 tests**; backend `tsc --noEmit` and scoped ESLint passed. One stale health-test expectation still searched for “payment worker” while the current health route reports “payment recovery runner”; the assertion now matches the implemented hint and the rerun passed. This is a test-only correction. `git diff --check` passed; Git emitted existing line-ending conversion warnings. These checks do not replace real PostgreSQL/Stripe acceptance against the current source.

**Architect recommendation: REQUEST CHANGES / PARTIAL.** The recovered failure mechanisms have reproducible evidence and their focused regressions passed on the tested build. Task 03.6 remains open because the current source changed during acceptance, the 3DS completion is unresolved, final schema-ledger readback is absent, and several browser closure/mobile presentation checks were not completed. A new attempt budget is required for any additional Stripe PaymentIntent. The 70-attempt authorization has no remaining capacity.

## 10. Current-source PostgreSQL rerun and cleanup verification — 2026-10-17

The owner confirmed the external writer was paused and authorized use of the current checkout. The current files were fingerprinted before the rerun; the payment implementation was not edited during this PostgreSQL-only verification.

| File | SHA-256 |
|---|---|
| `apps/backend/src/services/payment.service.ts` | `F3F46B69D4DE8B5C7EC4B13AE76F167FA0DF3C4187889AFAEB2C3F54FE198318` |
| `apps/backend/src/services/payment.domain.ts` | `E295B6ED11F8B08FEE441EEF0747C466E7227E81A4DDE5C901DBB315625C1E87` |
| `apps/backend/prisma/schema.prisma` | `06CAC75C494FA3F71B3125DA0C8E1993371011AAC10AE36DC9FEEC76A752EBCD` |
| `apps/backend/prisma/migrations/20261016000000_payment_attempt_confirmation_started/migration.sql` | `97F32AB98DC286955ADBA6881D661B49434611C5EC037239D7F084781E933A05` |

The earlier disposable database on port 55439 was deliberately preserved after its `public` schema failed the fresh-target guard. The rerun used a separate task-owned PostgreSQL 17.10 instance, database `electrohub_ci_p0`, bound only to `127.0.0.1:55440`, with TLS certificate verification. The pre-run server proof reported the `postgres` owner session, TLS active, and zero non-system relations. The Prisma native TLS probe passed and migration deploy succeeded in the per-run schema.

The first current-source run passed all ten scenario assertions but its cleanup failed with SQLSTATE `2BP01`. Cleanup had counted the 21 internal TOAST ownership edges correctly as internal, then attempted to drop the still-nonempty schema directly with `RESTRICT`. The transaction rolled back. A read-only inventory confirmed those edges were exclusively PostgreSQL-owned TOAST tables for relations inside the marked schema; no public or external objects were modified.

The disposable cleanup now verifies the exact `pgrun_<id>` schema owner and run marker, rejects external dependencies, then removes only qualified schema-owned views, foreign/materialized views, tables (including `_prisma_migrations`, indexes, constraints and table-owned TOAST), standalone sequences, routines and Prisma enum types using `RESTRICT`. Unsupported type kinds or remaining objects fail closed. The final schema drop also uses `RESTRICT`, and cleanup verifies namespace absence. All steps are in one transaction, so a failed drop rolls the cleanup back. No `CASCADE` is used. The cleanup regression checks operation ordering, exact schema qualification, internal TOAST handling and the external-dependency refusal.

The prior marked run schema `pgrun_00b68a3c1563` was cleaned using this exact routine. The new A–J run then passed **10/10** against real PostgreSQL 17.10, with zero failed/skipped scenarios:

| Scenario | Verified behavior |
|---|---|
| A | Concurrent submissions transfer one saved Cart generation |
| B | Submit racing CartService mutation commits or rolls back safely |
| C | Submitted A remains isolated while B is added/prepared |
| D | Re-added same SKU has a distinct line identity |
| E | OrderService commits A without mutating Cart B |
| F | Injected SQLSTATE `P0001` rolls back every ownership write |
| G | Stale PaymentWork lease cannot commit order/capture |
| H | Duplicate webhook/processor delivery creates one order, payment, capture and stock decrement |
| I | Real unique/CHECK constraints reject invalid ownership (`23505`/`23514`) |
| J | Real Serializable conflict returns SQLSTATE `40001` and rolls back write skew |

The successful run used schema `pgrun_cd90728118b5`; its Prisma migration, tests and cleanup all passed. Post-run read-only verification again reported TLS, PostgreSQL 17.10, loopback port 55440, and zero non-system relations. The server stopped cleanly. The A–J provider is mocked; this run made no Stripe calls and consumed no PaymentIntent budget. It did not write to Supabase DEV/PROD.

Current-checkout verification after the cleanup correction: 19 focused backend payment/recovery/health files passed **356 tests**; the disposable-runner offline safety suite passed **21/21**; backend typecheck and backend build passed; scoped ESLint passed; Node syntax checks passed; and `git diff --check` exited 0 (with existing line-ending conversion warnings). The frontend production build also passed and retained its existing >500 kB bundle advisory. The JSON test report records exactly the ten A–J cases above, with 10 passed, 0 failed and 0 pending.

This closes the current-source PostgreSQL A–J gap only. Stripe remains **70/70 attempts consumed**; 15 were PAID and one 3DS attempt remains authoritatively `requires_action`/`ACTION_REQUIRED`, correctly without an Order or charge. No further PaymentIntent is authorized under that budget. Browser closure/reopen and settled mobile-toast checks remain open. Task 03.6 is still **OPEN / PARTIAL**, with **REQUEST CHANGES** recommended pending a separately authorized Stripe budget for resolving 3DS and the remaining browser acceptance gaps.
