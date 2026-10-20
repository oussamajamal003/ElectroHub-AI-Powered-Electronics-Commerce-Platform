# Task 04.0 — implementation evidence

Status: IMPLEMENTED / DEV ACCEPTANCE VERIFIED, pending independent Architect review and a commit, neither of which is authorized here. One authorized supervised Test Mode purchase completed on shared DEV under the exact incident scope. The out-of-scope customer attempt is owner-isolated and untouched. Earlier history follows below.

Continuation 2026-10-20: the user approved recovery of one exact existing attempt. Preflight/readiness passed with `reviewedRecoveryCount=1`, but independent review found the supervisor still launched an unscoped worker. The supervisor was stopped. Sanitized logs show the worker claimed and provider-checked the approved attempt, the Task04 synthetic pre-submit attempt, and one older attempt belonging to another customer. The older attempt was outside the user's approval. Its current local state is `DECLINED`, with no order, recorded provider status `requires_payment_method`, no payment method attached at the last provider observation, and an expired `LEASED` work item. It was claimed five times, provider-checked five times, and outcome-persisted four times between 12:29 and 12:37 UTC. The worker is stopped, its owned PIDs are absent, :5000 is clear, and the exact stale lock/stop marker were removed after verification. No manual financial record edits or retries were made.

Continuation after incident, 2026-10-20: PAYMENT and Architect reviewed and approved CCR T04-PAY-01. The user approved its exact code-only scope and offline tests, explicitly excluding worker start and payment recovery. The runner now requires the active supervisor-issued allowlist in supervised DEV and applies the same immutable two-ID scope to batch and attention scans. The supervisor validates the reviewed attempt plus the uniquely owned Task04 fixture attempt and sends the scope only to the payment worker. Offline launcher/supervisor/runner tests, typecheck and focused lint pass. The runtime was not started. The older customer's attempt remains outside scope and still requires owner review.

## FINAL VERIFICATION (2026-10-20) — current state; sections below are history

**Identity:** branch `feature/DEV-Environment-Stabilization`, HEAD `b716b53` (= origin), develop `28d828c`. Nothing is staged. The local uncommitted diff is 42 tracked files plus 11 new files; `git diff --check` is clean. A secret and address scan of the diff found only the documented `sk_test_placeholder`.

**Environments**
- **MAIN DEV, PASS:** `:3000` → `:5000` → Supabase DEV `pzxekjybdiulzmssalfo`.
  - Governed supervisor running: readiness PASS, IPC activated, verified Stripe Test account, allowlisted email worker READY.
  - Real purchases verified: $39 Task04 (twice), plus the user's $658, $469 and others.
  - Signed webhooks; one Order per paid attempt; My Orders and Order Details; three PDFs (verification-only Playwright plus a restricted restart probe).
  - Emails: dispatched, Brevo `delivered` events, and `deliveryState=DELIVERED` persisted.
- **ISOLATED QA, PASS:** `:3200` → `:5200` → PostgreSQL 17 `:55434/electrohub_disposable` with verify-full identity, capture-only email.
  - Real-stack `order-documents` suite 8/8 on the current source.
  - Fixed: QA and MAIN DEV shared one email-worker lock, so QA's capture worker refused to start while DEV ran. The locks are now per-environment (`commerce-email-worker.lock` / `.isolated.lock`), and each environment still allows only one worker (email dev-runtime tests 11/11).
  - The negative target matrix is unchanged and passing (database-target and payment-isolation suites).
- **DEV/PROD schema VERIFIED and migrations NO-OP:** reused from the ledger and physical-schema verification (20/20). Task 04.0 adds no migration and no Prisma schema change.

**Payment policy**
- **Exact-attempt scope, PASS:** 1–2 unique canonical IDs. Empty, duplicated, malformed or wider scopes are rejected at the launcher and over supervisor IPC.
  - Batch claim and attention scan share one frozen scope; the API and email workers never receive it.
  - Authority requires live IPC and is revoked on disconnect. Leases, fencing and idempotency are unchanged.
- **Steady-state DEV recovery, IMPLEMENTED (owner-approved run):** `--recovery-mode=governed --governed-since=<ISO>`.
  - The worker handles only attempts created at or after the boundary; older open work blocks startup unless it is the one accepted isolated row. There are no hardcoded IDs and no unrestricted mode.
  - One transient batch failure is retried; authority is revoked after 3 consecutive failures.
  - The owner-approved boundary in use is `2026-10-20T17:00:00Z`; changing it is an owner decision.
  - The isolated attempt `df9056ac4e` remains untouched. Resolved incidents were not reopened.

**Commerce email**
- Enqueue is automatic.
- Governed DEV starts the allowlisted worker by default and never runs live/unrestricted.
- Delivery outcomes are reconciled one-way from Brevo events.
- No resends: the historical rows were inspected read-only (all 6 owner sends `delivered`).

**UX**
- **Single confirmation:** exactly one "Order confirmed! 🎉" toast from one owner, covering Checkout, retry and restored paths. No customer email banners.
- **Navigation lock:** active only while the browser must confirm with Stripe.
- **Cancel purchase:** waits for the server-confirmed `CANCELED`, restores items and refreshes. Verified live: `e3f05198` cancelled and restored with no reload.

**Orders performance**
- DB/service level: 1565/2303 ms → 489/1726 ms (p50/p95, 30 samples).
- HTTP: 1787/5526 ms (10 samples) → 905/1652 ms (30 samples). The handler accounts for 430/1092 ms, with exactly 2 DB operations, 0 transactions, 0 pool waits, 0 errors, `exclusive` attribution and no PII.
- The remaining cost is remote RTT (Supabase ap-northeast-2), including the auth and role checks before the handler. A regional backend is only a proposal.

**Tests (this pass)**
- Frontend: full suite 106 files / 869 tests PASS; typecheck, lint and build PASS.
- Backend: typecheck, lint and build PASS.
- Node launcher, acceptance, email and isolated tests 49/49.
- Scope, isolation, metrics and delivery suites 61/61; email dev-runtime 11/11; isolated Playwright 8/8.
- Backend full suite reused from the last backend change: 1449 passed, 100 skipped, 3 failures confined to the seeded-admin files that `test:ci` excludes.
- CI: hosted Development CI and Security Audit green on `b716b53`. The local changes are not pushed, so they have no hosted run.

**Matrix (supersedes the table below)**
- PASS: T04-01, 02, 03, 04, 05, 06, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24.
- PARTIAL: T04-07. Supavisor tenant capacity is not independently provisioned; the conservative 15-session gate is enforced and counts only client backends.

**Remaining gates (operational, not source defects)**
- Commit, push and hosted CI of the local diff.
- Independent Architect review.
- `COMMERCE_EMAIL_ALLOWED_RECIPIENTS` set persistently in `.env.local` by the owner.

## Final correction pass (2026-10-20, uncommitted on HEAD `b716b53`)

Base: branch `feature/DEV-Environment-Stabilization`, HEAD `b716b5322477939ef1a6fb6abd9cd1b7d01ebc7f`, which equals origin. The tree was clean before this pass. HEAD is three commits beyond `origin/develop` `28d828c`. No commit, push, merge, deploy, runtime start, payment action or DB write was made in this pass.

- **F-01 worker scope:** unchanged and preserved. The supervisor sets `PAYMENT_INPROCESS_RECOVERY=false`. Supervisor, runner, payment-isolation, in-process-recovery, database-target and prisma suites pass 59/59. Launcher and acceptance node tests pass 35/35.
- **F-02 incident:** read-only DEV SQL found three non-`DONE` work rows; none changed after 12:37:56 UTC.
  - Out-of-scope customer attempt (md5 prefix `df9056ac4e`, created 2026-10-14): `DECLINED`/`PAYMENT_DECLINED`, provider `requires_payment_method`, submitted, no order, 0 signed events. Work is `LEASED` with a lease that expired 12:39:55 UTC.
  - Approved attempt: `AWAITING_INPUT`, submitted, `PAYMENT_NOT_CONFIRMED`, `READY` work, no order.
  - Task04 attempt: `AWAITING_INPUT`, never submitted, `READY` work, no order, now past `expiresAt`.
  - Classification: no money moved on the out-of-scope row as far as local facts show, but the row is unresolved. It is excluded from scope, and the launcher backlog gate refuses startup because of it. No provider readback was performed in this pass.
  - Owner decision required: authorize one scoped recovery for that exact attempt, or explicitly isolate it as accepted backlog.
- **F-03 resume:** added `--reconcile-resume`, `classifyResume`, `withResumeAuthorization`, `resumeDecision` and harness consumption.
  - Tests cover refusal for post-submit, uncertain, paid, duplicate, contradictory and expired states, plus single-use, monotonic history (node 3 tests, Vitest 2).
  - The Task04 attempt is now expired, so the real fixture classifies as `REFUSED_ATTEMPT_EXPIRED_NEEDS_OPERATOR`. Resume would need the expiry recovery decision first. Not run against DEV in this pass.
- **F-04 Stripe:**
  - A controlled harness (real Stripe.js, this account's `pk_test`, deferred Payment Element, no intent, no submit) reached hosted `ready` in 9.8 s plain and 6.3 s with the app's hidden-wrapper CSS, with the card-number field present. No CSP or headless failure.
  - The failed run's snapshot shows the Stripe iframe mounted and the skeleton present, but **no** 25 s slow notice. The harness's fixed ~30 s poll, which also counted the slow DEV setup, expired before the app's own readiness or stall deadline. Root cause: harness timing, not the hosted frame.
  - Fix: the harness now waits for the app's own ready/failed outcome (skeleton removed, then the `payment-element-ready` mark, bounded by the app's 90 s stall plus margin), fails fast on app alerts and reports timing marks. No app change.
  - The real DEV card entry is **not re-verified**; it needs a runtime start.
- **F-05 observability:** added `db-request-metrics.ts`.
  - The adapter records every actual round trip: read, write, transaction start, commit or rollback, with duration, pool-queue flag and failure class.
  - On the real adapter, AsyncLocalStorage attribution recorded 0 operations, because Prisma's engine calls the adapter outside the caller context. Scopes therefore observe the adapter while open and mark `exclusive` only when no other HTTP request overlapped.
  - Service stages are timed via AsyncLocalStorage. `GET /api/orders` logs one PII-free `orders.list.timing` event.
  - A real-PG test on the disposable DB asserts the exact sequence.
- **Orders performance:** measured on real DEV, 30 serial samples, exclusive, synthetic fixture, service level.
  - Before: four serial round trips (acquire+BEGIN 395, findMany 409, count 407, COMMIT 342 ms p50). Service time 1565/2303 ms p50/p95; pool queue 0; projection 0.01 ms.
  - The batch transaction ran at READ COMMITTED, so it never made page and total consistent. The reads now run concurrently without it; owner filter, pagination and shape are unchanged.
  - After: two reads, service time **489/1726 ms**. The tail includes the second pooled connection's cold TLS connect.
  - The remaining cost is irreducible remote RTT (~350–480 ms per round trip; DB in ap-northeast-2), plus auth reads at HTTP level (HTTP p95 not re-sampled).
  - A regional backend is a scoped proposal only.
- **F-06 policy:** `--recovery-mode=incident-scoped` is the only accepted mode. `governed` fails closed until owner approval; tested.
- **CI:** Codex's fix allows `sslmode=disable` only for `NODE_ENV=test` loopback `electrohub_disposable|ci` URLs, and the adapter still enforces verified TLS. Hosted Development CI #39444186977 and Security Audit #39444186838 on `b716b53`: **success**. This pass is not pushed, so it has no hosted CI.
- **Final suites (this pass):**
  - Backend full Vitest on the disposable target: 1435 passed, 100 skipped, 3 failed. All 3 failures are in `adminSeedLogin`/`auth.integration`, which need seeded admins and are excluded by `test:ci`.
  - `logging-final-acceptance` timed out once under load and passed alone.
  - Frontend results are in the handoff.

**Owner decision 2026-10-20: isolate `df9056ac4e` as accepted out-of-scope backlog. No recovery is authorized.**

The launcher now accepts exactly one `--accepted-backlog-attempt=<uuid>`. It removes that row only from the startup backlog count, and only while a read-only check matches the frozen incident record:
- `DECLINED` / `PAYMENT_DECLINED`, provider `requires_payment_method`;
- submitted, no order, not cancel-requested;
- work not `DONE`, 0 signed events;
- not in the worker scope.

Any drift fails closed. The row and its lease, provider references and history are never written.

Worker exclusion is proven by tests:
- the runner passes the frozen two-ID scope to every batch and attention poll;
- `paymentRecoveryAttention` and `runBatch` claim selection both filter `attemptId IN scope`;
- launcher isolation tests pass (20/20 node, 5/5 Vitest).

Fresh read-only state at 15:28:51 UTC: three open work rows, all unchanged since 12:37:56 UTC, with 0 signed events; the isolated row still matches. A fresh launcher `--preflight` stopped at its first gate: `DEV backend port has an existing owner`, the user-started watched API on :5000. It replaced nothing, and the DB/provider gates were not reached.

Before any start, the following are required, and runtime startup is **not authorized**:
1. a separate exact runtime authorization;
2. stopping that API, which is the user's process;
3. the Task04 attempt expiry. That attempt is now past `expiresAt`, and the scoped worker would release it as expired rather than allow a resume.

**Real DEV acceptance (authorized 2026-10-20; exact operation):**

1. **Stopped:** the user's watched API, tsx watcher PID 101492 plus child 105328. The PIDs were re-verified first; the originally named PID 103172 had been reused by an unrelated service child and was not touched.
2. **Preflight PASS** (read-only): DEV `pzxekjybdiulzmssalfo`, 20/20 migrations, Stripe Test account verified, 0 unresolved, email off. Open work was 3 rows: 2 in scope and 1 owner-accepted isolated row.
   - Preflight now evaluates the same reviewed-plus-fixture scope as `--start`. The gate was not relaxed; tested.
3. **Supervised start**, `--recovery-mode=incident-scoped`:
   - Readiness PASS, IPC activated, listener secret held in memory, email disabled.
   - The worker released the expired, never-submitted Task04 attempt: `CANCELED`/`PAYMENT_EXPIRED`, signed cancel webhook.
   - The approved attempt was re-checked and remains `AWAITING_INPUT` (provider `requires_payment_method`) for future recovery.
   - **The isolated row was unchanged:** every timestamp still reads 12:37:55.
4. **Resume reconciliation:** `PRE_SUBMIT_ATTEMPT_RELEASED` (0 orders; provider canceled, nothing received or capturable, no payment method). A single-use authorization was consumed by the run.
5. **One purchase:**
   - The hosted Stripe Payment Element loaded and accepted test card 4242.
   - Place Order was clicked exactly once and "Order Confirmed!" was shown.
   - The harness then stopped on its own check, which expected the history card's product as text when it is an image with alt text. Fixed to `getByRole('img')`.
6. **Witness PASS:**
   - 1 Order, 1 `PAID` attempt with work `DONE`, plus the 1 released pre-submit attempt.
   - Provider: Test Mode `succeeded`, 3900 received; 2 signed webhooks.
   - Commerce email: 2 rows `READY`, queued and **not sent**, because dispatch is off by design. No delivery claim.
7. **Verification-only pass** (no checkout reachable): PASS for My Orders, Order Details, three PDFs (`%PDF-`, >10 KB, correct filenames), reload and re-authentication at 1440 and 390 px, no overflow, 0 submit requests. Screenshot inspected: Confirmed/Paid, $39.00, Visa •4242, queued email notice.
8. **Rollback:**
   - Stopping the supervisor PID 105152 made the IPC children (API 102704, worker 108076, Stripe listener 98708) exit on disconnect.
   - Only the exact lock was removed, after verifying its supervisor and PIDs were all absent.
   - The user's watched restricted API was restored.
   - After the restart, against the restricted API: login 200; Orders shows 1 order, `CONFIRMED`/`PAID` $39.00; receipt PDF 200, 17,930 bytes; `paymentsEnabled:false`.
   - Live `orders.list.timing`: 404 ms, 2 concurrent reads, `attribution:shared` (correctly flagged an overlapping request), no customer identifier. The payment worker is stopped.

**Apple Watch purchase `51b336ee` (owner approval: code and offline tests only, 2026-10-20).**

- **Origin:** the user's own $329 attempt, submitted at 15:38:41 during the supervised window. Card confirmation never reached Stripe.
- **Read-only state at 16:09:17 UTC:** `AWAITING_INPUT`, no confirmation, no order, no events, `READY` work, expired. Stripe Test Mode `requires_payment_method`, 0 received, 0 capturable, no payment method, bound.
- **Why it shows Processing:** this is the designed state for a submitted but unconfirmed attempt. Only a process with payment authority can resolve it, and the restricted API plus the stopped worker have none.
- **Added `--recovery-mode=exact-attempt`:** the scope is only the reviewed attempt(s) and never involves the fixture. The supervisor IPC scope is validated as 1 to 2 exact IDs and fails closed when empty, duplicated, malformed or wider. Each reviewed attempt's provider state is verified, including 0 capturable.
- **Tests:** launcher 21/21; supervisor, runner and attention 13/13.
- **Elsewhere:** `bfdeb7f1` was already cancelled by the customer (`CANCELED`, provider canceled, 0 received). The isolated row is unchanged.
- **Cart:** a worker release does not restore the cart for a submitted attempt; the customer's `/restore` action does, with provider re-verification.
- **Runtime:** not started at the time of this entry; see the authorized execution below.

**Execution (authorized):**

1. **Start:** stopped the restricted API Claude had started. Exact-attempt preflight PASS (2 open rows: the Apple Watch plus the accepted isolated row). Supervised start PASS.
2. **Worker:** within its frozen one-ID scope it set `PAYMENT_NOT_CONFIRMED` and did **not** auto-cancel. That is the existing Phase 03 design: a verified not-confirmed purchase stays customer-cancellable and is never auto-abandoned.
3. **Customer action:** the customer used Cancel purchase with Return its items to my Cart. Result: `CANCELED`/`PAYMENT_CANCELED_BY_CUSTOMER`, Stripe Test Mode `canceled` with 0 received and 0 capturable, no order, work `DONE`, 1 signed event.
   - `/restore` returned 200 and set `restoredAt`, re-adding the item.
   - The customer then placed a new $658 purchase at 16:17 (`9c4e8bba6f`, `PAID`, order, work `DONE`), which consumed the cart.
4. **Stop:** stopped the supervisor; the API, worker and listener drained. Removed only the exact lock after verification, and restored the restricted API.
5. **Remaining open work:** only the isolated row `df9056ac4e`, unchanged since 12:37:55.

**Order `ORD-9FB0FC8A…` ($658), email and PDF correction (2026-10-20):**

- **PDF: no code defect reproduced.**
  - Metadata marks invoice, receipt and summary all AVAILABLE.
  - In-process DEV renders succeeded: invoice 19,498 B, receipt 18,141 B, summary 19,035 B, each `%PDF-`.
  - The backend logged only a receipt file request for this order (16:18:37, 200). The invoice and summary clicks never reached it: they fell in the 16:19–16:22 window when Claude was stopping the supervisor and restarting the restricted API, so :5000 was down.
  - Browser re-verification of this order needs the owner's session: NOT VERIFIED by Claude.
- **Email: enqueue PASS.** `ORDER_CONFIRMED` and `PAYMENT_CONFIRMED` were created at 16:18:00.
- **Dispatch, provider acceptance and delivery: NOT DONE.** Both rows are `READY` with 0 attempts, because shared-DEV dispatch is off by design and no email worker ran.
  - The launcher's allowlist path refuses any sendable backlog; there are 4 `READY` rows, including 2 Task04 `.invalid` rows.
- **Added `scripts/dev-email-exact-send.cjs` (tests 3/3):**
  - Dry-run by default.
  - Verifies that the order owner's address has exactly this order's 1–2 sendable rows.
  - `--send --confirm-recipient` runs the existing worker once, with the allowlist set to that single address. The dispatcher's claim SQL cannot select other recipients' rows.
  - Reports enqueue, dispatch, provider acceptance and delivery separately.
  - Dry run PASS.
- **Authorized exact send (2026-10-20):** worker exit 0. Both rows are now dispatched, with Brevo acceptance and a provider message ID: **dispatch PASS, provider acceptance PASS**.
  - Delivery state is still `UNKNOWN`, so delivery and inbox receipt are UNVERIFIED pending the owner's confirmation.
  - Global outbox afterwards: 2 `READY` (the untouched Task04 `.invalid` rows) and 6 `ACCEPTED`. No other backlog was replayed.

**Recurring "stuck Processing" (Samsung $819 `d90223e5`, Apple Watch `51b336ee`, `bfdeb7f1`):**

- **Common signature:** `/submit` returns 200, then there is no `confirmation-started` request and Stripe stays at `requires_payment_method` with no payment method. Nothing was charged.
  - Samsung: submit at 17:29:04, with the next requests (list reads and `recover-overdue`) about 2 s later.
  - The client skipped confirmation after a durable submit. Per its contract it never confirms from a stale or unmounted form or an unready Element.
  - The exact client trigger (stale form instance, unready Element, or `elements.submit` error) is **NOT DEMONSTRATED**: it is only observable through the DEV payment timing marks in a real browser run, which needs a new authorized purchase.
  - No speculative client change was made. The existing handoff suites pass: frontend checkout 19 files / 270 tests.
- **Operational cause (fixed):** stalled purchases never reached an actionable state because every normal DEV mode lacked a worker. The restricted API cannot mutate, checkout mode has no worker, and the incident and exact-attempt modes need hardcoded IDs.
- **Governed mode** (`--recovery-mode=governed --governed-since`):
  - The worker scope is the attempts' creation boundary, sent over IPC; an exact ID list or a boundary are the only accepted forms.
  - The same filter is used for the batch claim and the attention scan.
  - Preflight blocks on older open work except the accepted isolated row.
  - Tests: launcher 25/25 (governed arguments, preflight boundary gate, worker-only IPC, mismatch refusal); supervisor, runner and attention 20/20 (both forms, future, stale or malformed boundaries, API refusal, frozen pass-through, creation-time filter).
  - Final backend: 1443 passed, 100 skipped, 3 failures confined to the seeded-admin files that `test:ci` excludes.
  - Not started.

**Root cause REPRODUCED (authorized governed run, built-in browser, synthetic fixture):**

- **Controlled purchase** `ORD-39C62732…` ($39): PASS. Marks: `/submit` ≈10.3 s, Stripe confirm 6.1 s, reconcile +18.6 s. Order Confirmed, Paid. DB `PAID`/`DONE`, `confirmationStartedAt` set.
- **Interrupted purchase** (`29540d71c3`): Place Order, then in-app navigation to the Cart about 1.5 s later.
  - No `authorization-start` mark; DB shows submitted, `confirmationStartedAt` null, `requires_payment_method`, `READY`.
  - The cart shows "Processing… Please don't pay again", the same signature as Samsung, Apple Watch and `bfdeb7f1`.
- **Defect:** during the browser-owned window (Place Order until Stripe.js answers), `CheckoutProcessing` said "You can continue shopping", and `PaymentLockProvider` hard-coded `isLocked:false`. On DEV `/submit` takes about 10 s, so customers left, the form unmounted, and the client (correctly) never confirmed from an unmounted form.
- **Fix:**
  - The lock is on only while `CONFIRMING_PAYMENT` (header and footer navigation are inert, and a `beforeunload` warning covers close and reload), with a 90 s auto-release and release on Checkout unmount.
  - The copy says "Keep this page open… You won't be charged twice".
  - Server-owned states after Stripe answered stay fully navigable, unchanged.
  - This **reverses** the earlier "never lock" rule for that window only. The tests were updated to the new contract: navigation lock 10/10, including lock, unload, auto-release and copy.
  - Frontend full suite: 892 passed and 3 timing flakes in the unrelated routing and search tests (31/31 when rerun). Typecheck, lint and build PASS.
- **Governed worker:** it touched `29540d71c3` at 18:13:24, then about 10 `connection_terminated` DB driver errors (a remote pooler drop) failed the batch and the API. The supervisor shut down fail-closed at 18:13:44, before `PAYMENT_NOT_CONFIRMED` was due (about 18:16).
  - That attempt now needs a governed restart, then the customer's Cancel.
  - Residual: one transient DB drop stops the whole DEV payment runtime (`batch_failed` maps to degraded). This needs a reviewed tolerance policy and was not changed.

**Commerce email addendum (2026-10-20):**

- **Disappearing "queued" (reproduced in source):** Order Details used `TransientEmailNotice`, whose 60-second window hid every state, including unresolved QUEUED.
  - Fixed: only SENT/DELIVERED keep the 60 s success window. QUEUED, DELAYED, PARTIAL and UNAVAILABLE stay shown from the server projection, including after remount and re-authentication, until the projection changes.
  - SENT copy now says "accepted by our email provider. Delivery isn't confirmed yet", and QUEUED says "haven't been sent yet".
  - Tests: orders and checkout 369/370, with the 1 load flake passing 28/28 alone, including persistence beyond 2 minutes and on a fresh mount.
- **Why emails stayed queued:** every DEV payment runtime ran with dispatch off and no email worker.
  - The launcher's `--allow-email-allowlist` gate now counts only rows the allowlisted worker could claim, so other recipients' history is preserved and never blocks. Launcher 26/26.
  - `dev-email-exact-send.cjs` sends one order's events only, with explicit recipient confirmation.
  - `dev-email-delivery-evidence.cjs` reads Brevo events read-only (tests 4/4).
- **$658 order evidence:**
  - `ORDER_CONFIRMED` and `PAYMENT_CONFIRMED` are `ACCEPTED`, and Brevo events report **`delivered`** for both (2026-10-20 18:29 UTC).
  - The persisted `deliveryState` stays `UNKNOWN` because no delivery ingestion exists.
  - The recipient is the order account's address (`j******@gmail.com`).
- **Governed restart: BLOCKED.** After the 18:13 pooler drop, Supavisor retains 7 idle session-mode server connections, which are actively reused by the pooler itself. The conservative 15-session gate counts them, and relaxing it needs an owner decision.
  - The synthetic interrupted attempt `29540d71c3` stays `AWAITING_INPUT`/Processing, with nothing charged.

**Email closure (owner-authorized, 2026-10-20):**

- **Backlog send:** exactly the owner's 6 queued emails (3 orders) were sent once in one runner pass. All 6 are `ACCEPTED`, each with 1 attempt. The 4 Task04 `.invalid` rows are untouched.
- **Delivery evidence:** Brevo events for iPad `ORD-2C112E01…` show `delivered` for both emails.
- **Defect fixed:** `--allow-email-allowlist` could never start, because the session gate counted the permanent `pg_net` background worker, and the email reserve 15 against limit 15 requires 0 others. The gate now counts only `client backend` sessions (launcher 27/27).
- **Running state:** governed mode with an email worker in allowlist mode for the owner's address. Preflight `otherSessions:0`, readiness PASS, `emailAllowlist {enabled:true, workerStarted:true, sendMode:allowlist}`.

**Email reliability closure:**

- **Existing sends:** the 6 owner emails (3 orders) all have Brevo `delivered` events; none bounced or deferred, and nothing was resent.
- **Delivery tracking:** `commerce-email.delivery.ts` plus the worker sync (tests 5/5: final-outcome classification, one-way conditional update, bounded window, provider failure, events parsing).
  - In DEV it recorded 8 rows as `DELIVERED` with `deliveredAt`. The remaining older `ACCEPTED`/`UNKNOWN` rows are processed 10 per cycle.
- **Shutdown fix:** a single recovery batch failure no longer revokes supervised authority; revocation happens after 3 consecutive failures, malformed counts fail closed, and `server.degraded` is unchanged (supervisor 15/15).
- **Email by default:** governed mode starts the allowlisted email worker whenever an allowlist exists, otherwise reports why email is off, and supports `--no-email` (launcher 28/28).
- **Live run:** restarted on the new build. Email worker READY in allowlist mode, `reason: allowlist`.
- **Final backend:** 1449 passed, 100 skipped, 3 failures confined to the seeded-admin files that `test:ci` excludes. Lint and build PASS.

**Purchase confirmation UX (single notification):**

- **Before:** the global `PaymentNotifications` toast covered only background outcomes. Checkout success acknowledged silently and navigated to Confirmation, while Confirmation and Order Details each rendered an email-status banner (`CommerceEmailNotice` / `TransientEmailNotice`), giving multiple notices for one purchase.
- **After:** `PaymentNotifications` is the single owner.
  - Checkout's verified-PAID handoff calls `announceOrderConfirmed`, deduplicated per owner and attempt; it still acknowledges, so the background path cannot re-toast.
  - Copy: "Order confirmed! 🎉 / Your payment was successful. Your order is ready to view." with a View Order link. Background PAID toasts use the same copy, and the toast is suppressed when Checkout already announced that attempt.
  - The customer email banners, their window and refresh modules, and the email polling on Confirmation and Order Details were removed.
  - Backend email (producer, worker, allowlist, delivery sync) is unchanged.
- **Tests:** orders, checkout and layouts 335/335, including no email status in any state on Order Details or Confirmation, a single detail read, and announcement dedup across repeats, owners and missing fields. Lint and build PASS.
- **Browser QA** (real frontend, real toast via its event channel, no new purchase):
  - Order Details at 1440 and 390 px: no email banner, Confirmed/Paid badges kept.
  - Exactly one toast: bottom-right at 1440, full-width top at 390, no overflow.
  - A wrong-owner announcement showed nothing.
- **Not exercised live:** a new Stripe purchase, delayed webhook and decline. These are covered by the existing PaymentPurchases suites, updated to the new copy.

**Cancel purchase UI:**

- **Root cause:** `/cancel` usually returns `CANCEL_PENDING` (DEV-observed `CANCEL_PENDING` → `CANCELED`), but `CancelPurchase` acted only on an immediate `CANCELED`. It skipped the requested Cart restore, refreshed once while still pending, and closed, so the stale card stayed until reload and the items were never returned.
- **Fix:** `awaitCancellation` polls the owner-scoped status every 1.5 s, for up to 45 s, until a terminal answer.
  - Then it restores if requested, refreshes the cart and then purchases (invalidation cancels older in-flight reads), and closes.
  - The card is never removed before the server confirms.
  - A cancellation still pending at the deadline, or a restore failure, is reported truthfully in the dialog. The card stays until the dialog closes.
- **Tests:** PaymentPurchases 58/58, including pending→confirmed→restore→removal, restore failure, and the bounded poller with failed reads. Checkout, orders and pages 424/424. Lint and build PASS.
- **Live browser: VERIFIED** (authorized interrupted Task04 purchase `e3f05198`).
  - The worker marked it `NOT_CONFIRMED`, and Cancel with Return items to Cart was used.
  - In the same page, with no reload: `/cancel` 200, then `/restore` 200. The pending card disappeared, the dialog closed and the cart shows the item.
  - DB: `CANCELED`/`PAYMENT_CANCELED_BY_CUSTOMER`, provider `canceled`, `restoredAt` set, no order, work `DONE`.

**Missing toast after a successful retry:**

- **Root cause:** retrying a failed payment runs in `SavedPurchaseCheckout`, and a restored submitted purchase in `RestoredPurchase`. On verified PAID both acknowledged the outcome, which suppresses the background toast, and navigated without calling `announceOrderConfirmed`, so the customer got no notification.
- **Fix:** both now announce once through the same single owner, deduplicated per owner and attempt.
- **Test:** decline → retry → Review → Place Order → reconcile PAID → exactly one announcement and navigation to Confirmation. Checkout and orders 339/339; typecheck and lint PASS.
- **Live check of the cancel flow:** the navigation lock was observed in the real browser during Place Order (header `inert`, a header click blocked, "Keep this page open…" copy).

Changed this pass:
- `apps/backend/src/lib/{db-request-metrics.ts,db-request-metrics.test.ts,database-adapter.ts,database-adapter.test.ts}`
- `apps/backend/src/middleware/requestLogger.ts`
- `apps/backend/src/routes/{checkout.routes.ts,checkout.routes.test.ts}`
- `apps/backend/src/services/order.service.ts`
- `apps/backend/scripts/{task04-dev-acceptance.cjs,task04-dev-acceptance.test.cjs,dev-payment-runtime.cjs,dev-payment-runtime.test.cjs,task04-orders-diagnostic.ts}`
- `apps/frontend/tests/task04/{global-setup.ts,dev-commerce.spec.ts}`
- `apps/frontend/src/config/task04ResumePreflight.test.ts`
- the runbook and this file

Matrix changes from this pass:
- T04-17/18 move to **PASS (DB/service attribution) / PARTIAL (HTTP p95, checkout UI)**.
- T04-10/13/14/15/16/21/23 remain blocked on the owner decision above plus runtime authorization.
- T04-08 remains PARTIAL.

## Baseline and execution plan

2026-10-20: fetched origin successfully. Branch `feature/DEV-Environment-Stabilization`, HEAD and current origin/develop `28d828c1a52b92e4bac17ebb96b827cb1ad8be3b`. Existing untracked Phase-04 specification preserved. Existing other worktrees preserved. No commit, push, merge or deployment authorized.

The session is in Default mode; an actual Plan-mode transition is unavailable. This written plan precedes implementation. Four total agent slots permit three concurrent delegates and the integration lead; eight focused workstreams will run in waves. Requested Luna configuration uses supported `gpt-6-luna` only where explicitly selected.

1. Verify source, dependency versions, source contracts and protected ownership.
2. Inspect DEV/PROD through read-only Supabase metadata, migration ledger/checksums and physical schema. Do not mutate either schema until drift, prerequisites, and exact forward-only operation have been reviewed.
3. Resolve database identity, URL selection/TLS and payment supervisor design together. Preserve financial state machine, auth, outbox and PDF architecture.
4. Implement confirmed environment/guard/launcher gaps with focused negative tests; protected changes require the CCR gate below.
5. Preserve and exercise isolated PostgreSQL :55434, API :5200 and frontend :3200; test no shared-target fixture writes and browser session separation.
6. Verify compiled shared DEV API :5000, listener, worker ownership and backlog before any bounded genuine Test Mode purchase. No historical recovery or email backlog dispatch without scoped authority.
7. Measure fixed read-only cold/warm DB and API workloads before/after; optimize only a measured dominant cause. Record samples, p50/p95 and failures.
8. Exercise real browser catalog/cart/checkout/orders/email/PDF journeys, applicable negative states, 320/390/768/1440/1920 widths and 200% zoom. Inspect actual captures. No mock-to-DEV evidence substitution.
9. Exercise owned-process shutdown and restricted restart, preserving all financial/outbox facts. Run one integrated relevant static/test/build pass, review effective diff and document each T04 gate.

## Task registry and ownership

All workstreams: task_id T04.0; base SHA above; approval reference user Task 04.0 implementation prompt; status PLANNED; last_updated 2026-10-20. Initial delegate activity is read-only discovery; exact edit scopes recorded before implementation.

| Owner | Workstream | Owned files / protected requests |
|---|---|---|
| Lead | Integration, environment/DB connection, final evidence | This evidence, task invariants, runbook; protected config/env.ts, lib/prisma.ts and payment-isolation.ts only after CCR review |
| Agent 1 | Database and Supabase | Read-only ledger/physical schema; no schema/migration writes |
| Agent 2 | Stripe supervisor/recovery | scripts/dev-payment-runtime.cjs and tests proposed; no protected edits until coordinated |
| Agent 3 | Isolated QA | scripts/dev-isolated.cjs and targeted tests; no shared writes |
| Wave 2 | Frontend, performance, email/PDF, integration QA | Assign after initial findings; no overlapping writers |

## Initial confirmed gaps

- `resolvePaymentIsolation` permits all `NODE_ENV=test` callers before validating target identity, including shared URLs.
- Prisma runtime selects `DIRECT_URL` before `DATABASE_URL`; the task requires explicit runtime/migration semantics and logical project validation.
- Existing supervisor launches children without supplying the shared-target approval consumed by the runtime guard; supervisor readiness therefore requires investigation.

## CCR T04-ENV-01 — proposed protected boundary changes

Requesting workstreams: DATABASE, AUTH consumers, PAYMENT, PERFORMANCE, INTEGRATION. Owner: lead; supervisor changes delegated only with explicit scope.

Proposed scope: pure trusted database target validation, runtime URL selection/TLS configuration, fail-closed payment target checks and supervisor-owned activation. Preserve production deployment policy and existing financial domain services, auth middleware, API contracts, schema and migrations. No generator/dependency changes planned.

Evidence: source gaps above. Risks: legitimate direct/pooler pairs must resolve to one project; unit mocks must be explicit; watched/unsupervised shared DEV cannot gain payment authority from NODE_ENV or a copied approval string. Test plan: negative target matrix, guard/supervisor lifecycle, unchanged transaction/financial regression, actual read-only TLS and disposable integration. Rollback: stop owned supervisor, return to restricted DEV; never delete financial/outbox rows.

Review status: APPROVED by the user through the CCR T04-ENV-01 approval question on 2026-10-20. Protected scope is payment-isolation.ts, bootstrap.ts, config/env.ts, lib/prisma.ts, and scripts/dev-payment-runtime.cjs. No financial services, auth, schema or migration edits authorized by this CCR.

## CCR T04-PAY-01 — exact worker attempt scoping (code-only scope approved)

```text
CCR ID: T04-PAY-01
REQUESTING WORKSTREAM / TASK: INTEGRATION / Task 04.0
AFFECTED OWNERS: PAYMENT, INTEGRATION (Architect)
PROTECTED FILES / CONTRACTS: apps/backend/src/payment-runner.ts; apps/backend/scripts/dev-payment-runtime.cjs and its tests; the supervised-DEV scope gate in apps/backend/src/lib/dev-supervisor.ts if needed to read the supervisor-issued allowlist. No payment service/state-machine, webhook, API, schema or migration change is proposed.
PROBLEM AND EVIDENCE: The supervisor passed the one-attempt preflight but launched payment-runner without a scope. The runner called paymentService.runBatch(undefined), and one attempt outside the user's approval was processed. Sanitized local logs show five claims/provider observations and four persisted outcomes; current local evidence is DECLINED, no order, last provider observation requires_payment_method, no attached payment method, and an expired lease. The runtime is stopped; that row remains untouched.
PROPOSED CHANGE: In supervised shared DEV, fail closed unless active supervisor IPC authorizes a nonempty, unique, canonical UUID allowlist bounded to the two exact Task04 IDs: the user-reviewed recovery attempt and the Task04-owned synthetic fixture attempt. The trusted launcher validates both IDs against their expected roles and passes them only to the payment-worker child; never pass the allowlist to API or email workers. The runner uses one immutable parsed ID list for both paymentService.runBatch(ids) and paymentRecoveryAttention(prisma, ids). No unscoped fallback is permitted in supervised DEV. Preserve existing disposable NODE_ENV=test --attempt behavior and supported production behavior.
SECURITY / PAYMENT / API / DB IMPACT: This constrains worker reads/claims and recovery-attention scans to the approved two-attempt set; it does not change financial transitions, provider operations, APIs, database schema, or migration state. The older customer's attempt remains excluded. No runtime start, recovery, retry, or database mutation is authorized by this CCR.
COMPATIBILITY AND MIGRATION PLAN: No migration. Preserve scoped disposable-test execution and the currently supported production runner path. Reject absent, empty, malformed, duplicate, oversized, or otherwise unauthorized supervised-DEV scope before the recovery loop or any provider call.
TEST PLAN AND ROLLBACK: Unit tests cover missing/empty/malformed/duplicate/over-limit scope and absent IPC failing before batch/provider access; only the exact two authorized IDs reach every batch and attention poll; the older attempt is excluded; API/email children receive no scope; caller-set env/flags without active IPC are denied; disposable-test scoped and ordinary production behavior remain compatible. Run relevant runner/supervisor tests plus existing payment regression tests. Rollback by stopping the owned supervisor and returning to restricted DEV; do not rewrite or delete payment/order rows.
APPROVAL STATUS: PAYMENT and Architect approved the revised design; the user approved the exact protected code scope and offline tests on 2026-10-20. This does not authorize a DEV worker start, recovery, retry, or database mutation. Any later start/recovery requires a separate exact operational authorization after read-only review of current rows and backlog.
```

Review history: the first PAYMENT review requested changes because the launch path did not transport the allowlist. The revision includes the supervisor callsite and worker-only delivery. PAYMENT and INTEGRATION/Architect approved the exact-scope design, contingent on an active trusted supervisor channel and no unscoped fallback. The user approved the code-only change and offline tests; runtime authorization remains separate. The earlier T04-ENV-01 approval covered connection/isolation startup behavior and did not authorize the new runner-scope semantics.

CCR implementation verification, 2026-10-20: `node --test scripts/dev-payment-runtime.test.cjs` passed 18/18; `npx vitest run src/lib/dev-supervisor.test.ts src/payment-runner.test.ts` passed 10/10; `npm run typecheck` passed; focused ESLint for the supervisor and runner source/tests passed. PAYMENT independently re-reviewed the allowlist transport and runner gates and approved. No DEV runtime was started and no payment attempt was recovered by this CCR.

## 1. Branch and scope

Branch/base remain as above. No commits, pushes, merges, CI triggers or deployments. No remote migration, schema change, seed/reset, financial-row deletion, stock reset, live-mode payment or external commerce email was performed by this task. One bounded synthetic DEV CUSTOMER was provisioned under the explicit task authorization; its private credentials remain ignored. Current read-only reconciliation finds one pre-submit `AWAITING_INPUT` attempt for the fixture, one cart line, and zero orders. It has no `submittedAt`, order, or attached payment method; the browser never sent the `/submit` request.

The user separately approved stopping the verified legacy isolated launcher PID 75004 and its verified backend descendants so :5000 could return to MAIN DEV. The existing PostgreSQL PID 67080 was preserved. Unknown/foreign processes were not killed. Terminal sessions and PIDs are point-in-time evidence, not reusable authority to kill a later process.

## 2. Architecture result

- MAIN DEV: frontend :3000 → API :5000 → canonical Supabase DEV, explicit `DB_RUNTIME_URL_SOURCE=direct` selecting the existing session pooler :5432. Actual direct/proxy diagnostic matched one ready MAIN_DEV instance during supervised operation. A subsequent restricted compiled API verified real catalog and customer session restoration through the same frontend.
- QA: frontend :3200 → API :5200 → existing PostgreSQL 17 :55434 / `electrohub_disposable`, server identity and `verify-full` TLS checked before migrations. API/worker restarted without replacing the cluster or deleting fixtures.
- Separate persisted QA JWT/refresh/OTP secrets. Browser contexts remain separate because localhost cookies cross ports. External Stripe/Brevo keys are blank by default in QA; capture mode is explicit.
- PROD endpoints are refused in DEV/test. Production retains the existing explicit deployment approval and prior direct runtime default; DEV-only Test Mode validation does not change production key policy.

## 3. Database result

**DEV and PROD read-only verification: VERIFIED within the following scope.** See `database-discovery.json` for sanitized primary evidence. DEV `pzxekjybdiulzmssalfo` / ap-northeast-2 and PROD `yepfgjehdstlxbpespun` / ap-northeast-1 were ACTIVE_HEALTHY, PostgreSQL 17.6.1.166.

Both had exactly 20 completed Prisma migrations, no unfinished/rolled-back entries. Checksums matched local SQL or the two already documented historical formatting variants (foundation UTF-8 BOM/CRLF and OTP CRLF). No history repair or migration rewrite. Thirty Prisma models, 330 columns, 22 enum label sets, 91 validated constraints, 127 valid indexes and two trigger signatures were compared with physical catalogs; known historical defaults and enum ordering differences were preserved. This is current physical metadata/ledger verification plus prior accepted Prisma drift evidence, **not a newly executed full raw Prisma diff**. Supabase's separate migration ledger is not Prisma's schema authority. Migration action: **NO-OP**.

Runtime validates both logical datasets, accepts only the Prisma `public` schema, rejects URL override parameters/duplicate parameters/insecure TLS, and refuses transaction-pooler runtime semantics. Different direct/session endpoints may resolve to the same canonical project; different local ports/databases cannot. CA validation and `rejectUnauthorized:true` remain enabled. Supavisor `pg_stat_ssl` is its internal PostgreSQL hop; external TLS is established by the validated application socket and successful query.

Pool maxima remain 5 per nonproduction process / 10 production. Supervisor reserves 10 for API+runner, 15 with email, against a conservative 15 and observed other sessions. Supabase max_connections=60/reserved=3 is not proof of Supavisor tenant capacity. Restart briefly refused while former sessions drained; read-only counts later showed one active inspection and the existing pg_net worker. No limit increase or session termination.

Existing RLS/advisor findings remain explicit: 23 tables have RLS disabled, while anon/authenticated had no table privileges; two invoker outbox functions have mutable search_path advisory findings. This task makes no blanket RLS/security certification or unrelated migration.

## 4. Backend and payment

`payment-isolation.ts` removes NODE_ENV=test shared authority, copied DEV approval strings and forged environment-only supervisor authority. Watched shared DEV stays restricted. `dev-supervisor.ts` grants per-child revocable authority only through the live parent IPC prepare/activate protocol. Worker performs SELECT 1 before activation and imports the financial runner only after activation. API activates after API DB readiness, worker DB readiness, worker activation and actual runner readiness. Disconnect/degraded readiness revokes authority and uses existing shutdown handlers. Financial services, leases, transaction settings and state machine remain unchanged.

The foreground launcher verifies target/TLS, every migration/checksum, recovery backlog, canonical Stripe Test account, reserved port ownership and connection reserve. It owns its compiled API, runner and CLI listener, keeps the listener signing secret/IPC nonce in memory, and releases only its own lock after its recorded children exit. Windows IPC children receive graceful disconnect before force-stop fallback. Unit fixtures now inject the diagnostic-token writer, preventing tests from overwriting an active stack's token.

The supervisor reached API DB/worker DB/runner readiness with private IPC active, canonical account verified, listener signing secret held in memory, and email dispatch off. It was stopped after the scope defect was found. The task's wrapper stop marker did not clear the lock; recorded PIDs and listeners were checked, then only the exact stale task lock and marker were removed. No payment service remains on :5000.

**Unapproved attempt requiring owner review:** one older customer's attempt (created 2026-10-14; private hash `4356f18def`) is locally `DECLINED`, has no order, and its last observed provider state is `requires_payment_method` with no payment method attached. Its work row is `LEASED` with an expired lease. During the unsafe runtime, sanitized logs show five claims, five provider observations, and four persisted outcomes for this attempt. The current payment worker is stopped. Do not resume or manually reconcile this row without a separate exact decision.

The Task04 browser reached the Payment step but never loaded the Stripe card fields; the page remained at “Loading secure payment form.” It did not click “Place Order” and made no `/submit` request. Opening the Payment step had already created one Task04 pre-submit attempt (`AWAITING_INPUT`, `requires_payment_method`, no order/submission/method attached); the unscoped worker observed it seven times and persisted seven outcomes. The user-approved recovery attempt remained `AWAITING_INPUT`; the worker observed it six times and emitted recovery escalation events. No payment method was attached on the last provider observations. Full provider status after shutdown was not rechecked. No order or successful payment is evidenced for any of these three attempts.

## 5. Frontend

Vite validates loopback proxy URLs and reserved :3000/:5000, :3200/:5200 pairs, uses strict ports, honours CLI --port and rejects conflicting CLI/environment values. Builds do not validate unused dev proxies. Payment capability returns no enabled result until session verification, and discards stale enabled data on query failure.

Isolated Playwright global setup requires private direct/proxy diagnostics to attest the same ready ISOLATED_QA instance before fixtures. The real DEV harness has the equivalent MAIN_DEV handshake, exclusive local run lock, explicit purchase opt-in, no retries, one-way pre-submit marker and no retained trace/video. No mock interception is used for its core journey.

Real restricted DEV browser login and reload independently passed `/auth/refresh` and `/auth/me` 200 for the synthetic fixture on cart and product navigations. Catalog rendering was observed. Full genuine DEV checkout/history remains pending. Isolated real Orders/Documents suite passed 8/8; 320,390,768,1440,1920 widths asserted no horizontal overflow, owner/404/logout boundaries, keyboard controls and scoped axe checks. Existing captured details and preview images were opened/inspected. No new visual design or Figma fidelity claim is made; screenshot source continuity is preserved. Headless native PDF viewing uses the application's truthful download fallback.

## 6. Email and PDFs

Shared DEV dispatch is forced off by default. Explicit allowlist opt-in requires approved configuration, no sendable backlog and pool headroom. No historical email was replayed. Initial DEV aggregates: four ACCEPTED/delivery UNKNOWN events, no sendable backlog; provider acceptance is not delivery. No new task purchase means no genuine DEV commerce-email/PDF outcome to claim.

QA restart logged producer/dispatch capture, provider disabled, supervised capture worker READY PID 86048. Escalated CIM confirmed worker existence and preserved PostgreSQL PID 67080. Existing capture files predate this task; configuration/readiness does **not** prove a new captured email. Serialize launch attempts because the pre-existing email helper has a stale-lock reclaim race under concurrent starts; no concurrent restart was attempted.

Isolated actual invoice/receipt/summary downloads had `%PDF-` bytes, correct ElectroHub order-reference filenames and >10KB content. Preview/fallback, customer-B 404, logout and read-only document actions passed. A further separate-context check at 720 CSS px / DPR2 (1440×900 physical, 200%-equivalent) showed three document controls, no horizontal overflow and a 19,631-byte invoice preview response (`200 application/pdf`, `%PDF-`), with the screenshot opened/inspected. Headless Chromium ignored Ctrl+Plus: this is viewport emulation, **not verification of native browser zoom controls**. Screenshot: `apps/frontend/test-results/isolated/task04-documents-1440-zoom200.png`. Existing Arabic PDF exception remains unchanged. DEV PDF from the requested new purchase: NOT VERIFIED.

## 7. Performance

All below were actual bounded measurements, concurrency 1, complete HTTP body consumed or pg SELECT 1, no provider writes. Database driver pg, max 1, trusted CA. API-only customer login is a separately authorized reversible auth write; timed endpoint requests are reads. The empty synthetic customer is the stable fixture for cart/orders.

| Workload / environment | Samples | Baseline p50/p95 ms | Final p50/p95 ms |
|---|---:|---:|---:|
| DEV session pooler warm SELECT 1 | 30 each | 433.93 / 542.43 | 351.78 / 1786.99 |
| DEV pool acquisition | 30 each | 0.08 / 0.87 | 0.10 / 1.28 |
| Disposable TLS warm SELECT 1 | 30 | — | 0.35 / 1.15 |
| Disposable pool acquisition | 30 | — | 0.02 / 0.36 |
| DEV GET products page1/pageSize12 | 30 each | 422 / 987 | 392 / 513 |
| DEV GET owned cart | 10 | — | 741 / 826 |
| DEV GET owned empty order history | 10 | — | 1787 / 5526 |

DEV cold connect/select baseline 2457.54/349.20 ms; final 2294.90/329.01 ms. Local cold 141.80/1.67 ms. Both final DB probes: 30/30 acquires, zero errors, read-only transaction passed. Initial sandbox DNS failures were tooling failures, not performance samples. The benchmark now aborts after one failed cold connection; no fallback target.

Pool wait is negligible relative to remote warm round-trip time. Remote RTT is a confirmed contributor, not a proof of region/root cause. Source shows existing authenticated order history uses authorization reads plus a find/count transaction, so serial network round trips are a plausible contributor. Actual SQL query counts for that HTTP workload were **not captured** by normal adapter logging; do not substitute inferred counts. Existing catalog search uses one CTE query. The 10-sample authenticated results are diagnostic only (below the preferred 30); no checkout/UI p95 is claimed. Tail latency remains unresolved. No connection-pool enlargement, isolation weakening, cloud relocation or SQL rewrite was justified. Variation in two catalog samples is **not claimed as an optimization**.

## 8. Tests and provenance

Executed on Windows/Node v22.19.0 with existing pinned dependencies; CI's Node 20.11 runtime was not reproduced. Writable TEMP/TMP `.cache/task04-temp` resolved sandbox Vitest transform-cache EPERM. Escalation enabled actual localhost/TLS sockets where the sandbox blocked them; TLS was not disabled for application tests.

| Check / command | Actual result / provenance |
|---|---|
| Backend Vitest source regression (single fork, explicit `.isolated/env.json` pair+CA, NODE_ENV=test, mock Test key/Brevo blank) | 66 files passed,9 skipped;1244 tests passed,98 skipped. DISPOSABLE plus mocks; skipped external/barrier/manual gates are not passes. |
| Final backend delta: payment-isolation, database-target, dev-supervisor, prisma, development-runtime route | 5 files /54 passed; includes production compatibility and schema option guard. MOCK/DISPOSABLE-local sockets. |
| `node --test scripts/dev-payment-runtime.test.cjs scripts/dev-isolated.test.cjs scripts/task04-db-benchmark.test.cjs scripts/task04-dev-acceptance.test.cjs` | 25/25 passed after token-writer and port-alias fixes. MOCK, no shared writes. |
| Frontend `vitest run` | 106 files /891 passed. Existing jsdom window.scrollTo diagnostics; no failing tests. |
| Final frontend config/capability/preflight delta | 3 files /25 passed. MOCK. |
| Backend `npm run typecheck`, `npm run lint`, `npm run build` | PASS. Build repeated after reviewed guard changes; final lint passed. |
| Frontend `npm run typecheck`, `npm run lint`, `npm run build` | PASS. Initial two unused-parameter lint failures corrected; final lint/typecheck passed. Existing >500KB chunk warning remains. |
| `npx playwright test -c playwright.isolated.config.ts order-documents --trace off` | Final stable run8/8 PASS, actual disposable API/DB/PDF worker, no provider. Initial live-config reload caused one socket hangup before clean rerun. |
| `TASK04_DEV_PURCHASE_APPROVED=1; npx playwright test -c playwright.task04.config.ts` | NOT PASS; browser reached Payment but Stripe's secure form remained loading. No `/submit` request or order. A pre-submit Task04 attempt exists because the Payment step created it; see bounded post-stop reconciliation above. |
| `node scripts/task04-db-benchmark.cjs --source=direct --samples=30` | DEV read-only and explicitly configured disposable read-only measurements above; zero final errors. |
| Restricted API HTTP probe and real browser session probe | All50 timed catalog/cart/orders GETs200; capability200 false. Login and hard navigation restore200. SHARED_DEV_READ_ONLY endpoint provenance. |
| Git/CI | Commit `b8656e1` pushed to `feature/DEV-Environment-Stabilization`. Security Audit #190 passed; Development CI #199 passed 9/10 jobs, with Backend/Test failing because CI's loopback disposable URLs carry `sslmode=disable` for Prisma CLI migrations and the target classifier rejected that URL before the adapter could strip it. The follow-up fix permits this setting only for a test-mode loopback disposable pair; the adapter still strips the URL flag and requires verified TLS. Equivalent local regression set passed 8 files/213 tests, plus typecheck, build, and focused lint. Remote CI for the follow-up commit is pending. |

Raw local logs, credentials, diagnostic tokens, process locks and generated test artifacts remain ignored in backend `.cache` / `.isolated` and frontend `test-results`. This report intentionally contains no credentials, customer addresses, Stripe secrets, provider identifiers or private diagnostic tokens.

## 9. Security and rollback

Negative matrix covers missing/malformed/unknown targets, mixed DEV/PROD/local datasets, mismatched local ports, public-schema overrides, URL endpoint/TLS overrides/duplicates, global TLS disable, transaction runtime pooling, NODE_ENV=test on shared targets, live keys in nonproduction, copied approvals, forged/replayed/wrong-parent IPC and revoked/disconnected authority. Denied service tests prove zero provider/database calls. QA launcher pins its own exact cluster credential before any migration; numeric reserved-port aliases are rejected.

Restricted rollback was exercised on the real compiled DEV API after clean supervised shutdown. Authenticated payment capability returned `{paymentsEnabled:false}`; catalog/cart/history reads and session reload still worked. Financial records and historical incidents/outbox were preserved. Shared mutation permission cannot survive supervisor IPC disconnect. The payment supervisor/listener/API :5000 are stopped and its lock is cleared. The isolated PostgreSQL cluster at :55434 remains running. At the last process snapshot, :3000 had both the older unrelated IPv6 PID72380 (started Oct19) and a 127.0.0.1 listener PID81424; ownership was not rechecked, so do not treat either listener as verified MAIN DEV. Recheck direct/proxy identity before browser use.

## 10. Acceptance matrix

Paths are repository-relative here; MOCK means no claim of remote provider evidence.

| Gate | Status | Implementation / environment / evidence | Remaining gap |
|---|---|---|---|
| T04-01 | PASS | Branch/base/fetch/status/diff; this registry | Uncommitted by instruction |
| T04-02 | PASS | `viteServerConfig.ts`; actual :3000→:5000 MAIN_DEV attestation/browser | Full purchase journey pending |
| T04-03 | PASS | `database-target.ts`, `prisma.ts`, diagnostic; SHARED_DEV_READ_ONLY TLS/preflight | None in inspected scope |
| T04-04 | PASS | `dev-isolated.cjs`, isolated global setup; DISPOSABLE real browser/TLS | Separate browser contexts required |
| T04-05 | PASS | Target/payment guard matrix; MOCK/DISPOSABLE | No shared destructive negative execution |
| T04-06 | PASS | Explicit runtime source/session selection; actual session smoke | Alternative direct IPv6 endpoint not separately benchmarked |
| T04-07 | PARTIAL | Unchanged max5, reserve10/15, actual session counts/refusal | Supavisor tenant capacity not independently reconfigured/proven |
| T04-08 | PASS | Supervised incident-scoped runtime: readiness, IPC, scoped worker released only in-scope rows; isolated row untouched | Governed steady-state recovery is a separate owner decision |
| T04-09 | PASS | Canonical account read, Test-only nonprod guard; read-only intent livemode=false | Genuine task charge pending |
| T04-10 | PASS | Real hosted Payment Element loaded; one Test Mode confirm; harness waits on the app readiness signal | Decline/retry/dismiss paths are covered by regression tests, not live |
| T04-11 | PARTIAL | Unchanged financial domain; 1244 regression tests, lifecycle tests | Skipped manual/barrier/provider scenarios not rerun as live evidence |
| T04-12 | PASS | Capability hook tests, route regression; restricted DEV actual false | Supervised enabled path source/lifecycle tested; real task submit pending |
| T04-13 | PASS | Witness: 1 Order, 1 PAID/DONE, provider succeeded 3900; persisted after restart | — |
| T04-14 | PASS | My Orders and Order Details after reauthentication, 1440/390 px, restricted restart probe | — |
| T04-15 | PASS (truthful) | 2 commerce emails queued READY; dispatch off by design; UI shows "queued" | No delivery claimed |
| T04-16 | PASS | Three owner-scoped PDFs downloaded on DEV; receipt re-read after restart | Arabic exception unchanged |
| T04-17 | PASS (DB/service) / PARTIAL | Actual adapter op counts and stage timings; live HTTP event 404 ms | HTTP p95 at n=30 and checkout UI p95 not sampled |
| T04-18 | PASS | Orders list: 4 serial round trips reduced to 2 concurrent reads; 1565 to 489 ms p50 | Remaining cost is remote RTT; regional backend is a proposal only |
| T04-19 | PASS | Broad regression + target/adapter/guard delta | 98 skipped gated tests explicitly excluded |
| T04-20 | PASS | Exact launcher cluster/credential pin + negative target tests before writes | No intentional shared fixture write attempted |
| T04-21 | PASS | Exact authorized stop, supervised start, IPC drain on stop, exact lock cleanup, restricted restore | — |
| T04-22 | PASS | Private diagnostic, safe event-only IPC, redacted logs, degraded/child-exit tests | No public detailed target diagnostic |
| T04-23 | PASS | Paid order persisted across supervisor stop and restricted restart; capability false | — |
| T04-24 | PASS | Evidence, runbook, CCR history, owner isolation decision recorded | Architect review pending |

## 11. Remaining risks

1. The worker is now gated by the exact two-ID allowlist in supervised DEV. Keep the runtime stopped until the out-of-scope backlog has been reviewed, a fresh read-only preflight passes, and separate operational authorization is granted.
2. One additional older customer's DECLINED attempt has an expired LEASED work row and was processed by the unscoped worker. Preserve it pending owner review; do not retry or rewrite it.
3. No real task Test Mode purchase, signed webhook/payment/order witness, paid-order restart, new DEV PDFs or commerce email acceptance exists yet. `--witness` deliberately refuses anything short of unique PAID/DONE/order/provider success and a persisted signed event.
4. Remote authenticated Orders tail latency remains high; preserve existing transaction/auth guarantees while preparing a reviewed measured read-path optimization. Pool growth is not supported by these measurements.
5. Supavisor tenant headroom is conservatively gated but not equivalent to verified provider tenant limits. Stopped sessions can briefly delay restart.
6. Existing email helper concurrent stale-lock reclaim race: serialize starts; no external-send concurrency certification. Existing Arabic PDF exception, RLS/advisor findings, large frontend chunk and CI/runtime-version difference remain explicit.

## 12. Self-review and file manifest

Self-review: the CCR code scope passed focused offline tests and PAYMENT re-review. Overall Task 04.0 remains **STOPPED / PARTIAL** because the runtime was intentionally not restarted and the genuine checkout/final Architect acceptance remain incomplete. No merge, deployment, or full-task acceptance is claimed.

Changed tracked paths:
`apps/backend/.env.example`; `apps/backend/scripts/dev-isolated.cjs`; `apps/backend/scripts/dev-payment-runtime.cjs`; `apps/backend/scripts/dev-payment-runtime.test.cjs`; `apps/backend/src/__tests__/payment-isolation.test.ts`; `apps/backend/src/bootstrap.ts`; `apps/backend/src/config/env.ts`; `apps/backend/src/lib/prisma.test.ts`; `apps/backend/src/lib/prisma.ts`; `apps/backend/src/payment-isolation.ts`; `apps/backend/src/payment-runner.ts`; `apps/backend/src/routes/index.ts`; `apps/backend/src/services/__tests__/payment-inprocess-recovery.test.ts`; `apps/frontend/playwright.isolated.config.ts`; `apps/frontend/src/features/checkout/paymentCapability.ts`; `apps/frontend/vite.config.ts`.

New source/tests:
`apps/backend/scripts/dev-isolated.test.cjs`; `apps/backend/scripts/task04-db-benchmark.cjs` and `.test.cjs`; `apps/backend/scripts/task04-dev-acceptance.cjs` and `.test.cjs`; `apps/backend/src/lib/database-target.ts` and `.test.ts`; `apps/backend/src/lib/dev-supervisor.ts` and `.test.ts`; `apps/backend/src/payment-runner.test.ts`; `apps/backend/src/routes/development-runtime.routes.ts` and `.test.ts`; `apps/frontend/playwright.task04.config.ts`; `apps/frontend/src/config/viteServerConfig.ts` and `.test.ts`; `apps/frontend/src/config/isolatedRuntimePreflight.test.ts`; `apps/frontend/src/features/checkout/paymentCapability.test.tsx`; `apps/frontend/tests/isolated/global-setup.ts`; `apps/frontend/tests/task04/dev-commerce.spec.ts`; `apps/frontend/tests/task04/global-setup.ts`.

Documentation: `docs/10_Operations/DEV_ENVIRONMENT_RUNBOOK.md`, this evidence, `database-discovery.json`, and the preserved initially untracked Task04 specification with compact invariants added. Ignored local `.env.local` gained only the explicit runtime-source setting; secrets were not changed or committed. No generated Prisma/schema/migration/dependency files changed.

## 13. Architect handoff

```text
IMPLEMENTATION: STOPPED / PARTIAL (T04-PAY-01 code scope implemented and offline-tested; payment runtime remains stopped)
MAIN DEV: PARTIAL (persistent target/restricted reads verified; payment runtime stopped after worker scope defect)
ISOLATED QA: VERIFIED
STRIPE TEST MODE: PARTIAL (canonical account and no-card provider observations verified; genuine task checkout not verified)
DEV SCHEMA: VERIFIED (physical metadata + migration ledger scope above)
PROD SCHEMA: VERIFIED (physical metadata + migration ledger scope above)
MIGRATION ACTIONS: NO-OP
PERFORMANCE: UNRESOLVED
BROWSER QA: PARTIAL (isolated suite passed; DEV Stripe card form remained loading)
CCR T04-PAY-01 REVIEW: PAYMENT, Architect, and user code-scope approval complete; separate runtime authorization NOT GRANTED
READY FOR FINAL INDEPENDENT ARCHITECT ACCEPTANCE: YES (final correction pass; see top section). Superseded rows above are history.
COMMIT: NO
PUSH: NO
MERGE: NO
DEPLOYMENT: NO
```
