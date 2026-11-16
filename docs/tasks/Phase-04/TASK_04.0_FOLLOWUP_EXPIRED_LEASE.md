# Task 04.0 Follow-up: Expired-Lease DECLINED Attempt Recovery

Branch: `feature/FastAPI-AI-Service` (lands as a separate commit after f6d49ef). Date: 2026-10-21.
Status: implemented and unit-tested. **Not executed against DEV.** No DEV/PROD data was read or changed by this change.

## 1. Problem

`/api/health/payments` on MAIN DEV reports `degraded` with 19 overdue items:

- 18 are `DONE` work rows for submitted `DECLINED` attempts. The worker rechecks them every 60 s (`duePaymentWork` third clause, `payment.service.ts` ~line 34; scheduled by `patchAndFinish` ~line 828). They are overdue only because no runner is running. This is expected and is **not** changed here. Whether `/health/payments` should count `DONE`+`DECLINED` rechecks as "overdue" is a separate question. It is reported for owner review and was not changed.
- 1 is attempt `384a8c53-c4bf-4924-92e0-e2c000870a8d` (Task 04.0 evidence §11 item 2, the isolated incident row). It is `DECLINED`/`PAYMENT_DECLINED`, provider `requires_payment_method`, 150 cents, no order, not cancel-requested, submitted 2026-10-14 19:58:31 UTC, 0 signed events. Its work row is `LEASED`, the lease expired 2026-10-20 12:39:55 UTC, retryCount 0, lastError null. An earlier unscoped worker died during its pass.

This one row blocks `assertNoPaymentBacklog`. `--accepted-backlog-attempt` only hides it from the count. `--recovery-mode=exact-attempt` refuses it because `assertReviewedRecovery` accepts only `AWAITING_INPUT` + `READY`.

## 2. Design (and why)

There is a new launcher mode: `--recovery-mode=expired-lease`.

The worker already has the correct recovery path. Its claim query reclaims `LEASED` rows whose `leaseUntil < now`. For a still-declined intent, `process()` re-reads Stripe and takes the generic branch. That branch persists `DECLINED`/`PAYMENT_DECLINED` and sets work `DONE` with the 60 s recheck, the same end state as the other 18 rows. It creates no order, does no capture or cancel, and creates no intent. So **no payment service, state machine, schema or migration change is needed**. The new mode only widens the launcher's *admission* gate, for exactly one row with frozen facts.

I rejected two alternatives:

- **Launcher writes the work row directly** (releasing the lease, or setting it to DONE). That is a second, unfenced mutation path outside `fenced()`/lease tokens, and it bypasses the provider re-read under lock. It is riskier and duplicates the worker's job.
- **Relaxing `assertReviewedRecovery`.** That would widen ordinary exact-attempt mode to any leased or declined row.

Gates added in `apps/backend/scripts/dev-payment-runtime.cjs`:

| Gate | Behaviour |
|---|---|
| Arguments | Exactly one `--reviewed-recovery-attempt`. `--no-email` is required. `--accepted-backlog-attempt` and `--allow-email-allowlist` are refused. `--start` still requires `--allow-dev-recovery`. |
| `assertExpiredLeaseRecovery` (read-only snapshot) | The attempt must be `DECLINED`, `PAYMENT_DECLINED`, provider `requires_payment_method`, with an intent, submitted, no order, not cancel-requested, and 0 signed events. Its work must be `LEASED`, with `leaseUntil` set and in the past, retryCount 0, and lastError null. Any drift fails closed. |
| Provider (Stripe Test Mode only) | `verifyBinding` must pass, `livemode=false`, status `requires_payment_method`, `declined=true`, received 0, capturable 0. |
| Backlog | Unchanged. Only this row's open work is subtracted, and any other open work or unresolved attempt still blocks. The 18 `DONE` rows are not "unfinished work" and never enter scope. |
| Worker scope | `normalizeWorkerAttemptIds(..., 'expired-lease')` requires exactly 1 ID. The supervisor IPC `prepare` sends only `attemptIds: [id]` to the worker. The batch query is `attemptId IN [id]`. |
| Supervisor | Refuses before taking the lock or spawning anything unless email is off and the scope is exactly the one reviewed attempt. Email dispatch is `disabled` for all children. |
| Idempotency | After success the work is `DONE`, so a re-run preflight refuses (`frozen record`) and changes nothing. Inside the worker, the lease token and `fenced()` row locks already prevent double processing. |

If Stripe instead reports anything other than a decline (for example, the customer retried and succeeded), the preflight refuses. If that change happens between preflight and claim, the worker applies normal provider truth (an order only on verified `requires_capture`/`succeeded`). It never invents an outcome.

While running, the worker keeps rechecking this one attempt every 60 s, exactly like the other declined rows. Stop the run with Ctrl+C once the work shows `DONE`.

## 3. CCR

```text
CCR ID: T04-FU-EXPIRED-LEASE-01
REQUESTING WORKSTREAM / TASK: PAYMENT / Task 04.0 follow-up (requested from the Task 04.1 closure session)
AFFECTED OWNERS: PAYMENT, Architect, Owner
PROTECTED FILES / CONTRACTS: apps/backend/scripts/dev-payment-runtime.cjs and its tests; apps/backend/src/payment-recovery-attention.test.ts (tests only).
  No change to payment.service.ts, payment-runner.ts, payment-isolation.ts, webhooks, API, schema, migrations, or /health/payments.
PROBLEM AND EVIDENCE: §1 above; Task 04.0 evidence §11 item 2 and the CCR near line 363.
PROPOSED CHANGE: --recovery-mode=expired-lease admission gate (§2). Recovery itself is the existing scoped worker claim.
SECURITY / PAYMENT / API / DB IMPACT: Test Mode only (existing sk/rk_test + canonical account gates); exact DEV identity gate unchanged;
  no order without verified provider success (worker unchanged); one row; no email; no API or schema change.
COMPATIBILITY AND MIGRATION PLAN: Additive CLI mode; all existing modes unchanged (29/29 launcher tests). No migration.
TEST PLAN AND ROLLBACK: Tests in §4. Rollback = revert the commit; DEV row stays as is until someone runs the mode.
REQUIRED APPROVAL: Owner approval of this CCR to merge; SEPARATE explicit owner approval to run §5 against DEV.
```

Review status: **PENDING owner review.** Editing code does not authorize running it against DEV.

## 4. Verification (local, 2026-10-21)

| Command (from `apps/backend`) | Result |
|---|---|
| `node --test scripts/dev-payment-runtime.test.cjs` | 29/29 passed. The new test covers argument rules, every frozen-fact drift, a DONE re-run refusal, signed-event drift, provider drift, a single-ID IPC scope, no API scope, email disabled, and supervisor refusal before lock/spawn. |
| `npx vitest run src/payment-recovery-attention.test.ts` | 6/6 passed. The new mocked-DB tests check that the claim uses the expired-lease clause, that the row ends DECLINED/DONE with no capture, cancel or create, and that the batch stays at `attemptId IN [id]`. |
| `npx vitest run payment` | 21 files passed, 3 skipped (395 passed, 45 skipped). The skipped files are the PG suites that need a disposable database. They were **not** run, and never against shared DEV. |
| `npm run typecheck` | passed |
| `npm run lint` (src) | passed |
| `npx eslint` on the launcher scripts | 1 error at test line 367 (`_record` unused). It predates this change and is outside `npm run lint` scope. Not fixed. |

These vitest runs set the CI-style dummy loopback env (`ELECTROHUB_DISPOSABLE_DATABASE=1`, `DATABASE_URL=postgresql://…@127.0.0.1:55432/electrohub_disposable`). No connection is made by the mocked tests.

**NOT VERIFIED:** the DEV run itself, the Stripe Test Mode intent state for `384a8c53…` today, the PG integration suites, and remote CI for this commit.

## 5. Owner command (run only after approving §3)

From `apps/backend`, with the normal DEV `.env` and a fresh `npm run build` (the launcher loads `dist/`). Stop any running API, runner or watcher first; the launcher refuses if one exists.

```bash
node scripts/dev-payment-runtime.cjs --preflight --recovery-mode=expired-lease --reviewed-recovery-attempt=384a8c53-c4bf-4924-92e0-e2c000870a8d --no-email
```

If the preflight prints `"preflight":"PASS"`:

```bash
node scripts/dev-payment-runtime.cjs --start --allow-dev-recovery --recovery-mode=expired-lease --reviewed-recovery-attempt=384a8c53-c4bf-4924-92e0-e2c000870a8d --no-email
```

Wait for `"readiness":"PASS"`, then for the attempt's work row to show `DONE` (within about one worker tick). Then press Ctrl+C. Expected end state: attempt `DECLINED`/`PAYMENT_DECLINED`, no order, work `DONE`, lease cleared, lastError null. Re-running the preflight must then refuse with `frozen record`. Normal startup no longer needs `--accepted-backlog-attempt` for this row.

## 6. Owner review and execution (2026-10-21)

- **Review:** the owner reviewed and approved CCR T04-FU-EXPIRED-LEASE-01 and authorized the DEV run. Lead review of the launcher diff: additive mode; the frozen facts include `stripe_events.attemptId` count = 0; Stripe Test Mode must still report the decline; worker scope is exactly 1 ID; email is forced off; only this row is subtracted from the backlog. Launcher tests 29/29.
- **Before (read-only):** attempt `384a8c53-…0a8d` DECLINED / PAYMENT_DECLINED / `requires_payment_method`, 150 cents, no order. Work LEASED, `leaseUntil` 2026-10-20 12:39:55 (expired), retry 0, no error. 1 unfinished work row, 65 orders.
- **Preflight:** `npm run build` OK; MAIN DEV watcher stopped. `--preflight --recovery-mode=expired-lease … --no-email` → PASS (identity `supabase:pzxekjybdiulzmssalfo`, 20 migrations, unfinishedWork 1, unresolvedAttempts 0, email backlog 0, Stripe account verified, email disabled).
- **Run:** `--start --allow-dev-recovery --recovery-mode=expired-lease … --no-email` in a terminal tab → readiness PASS, supervisor IPC prepared-and-activated, email worker not started. The worker claimed the row at 16:50:00 UTC and finished it at 16:50:05. Stopped with Ctrl+C; lock released, :5000 freed.
- **After (read-only):** attempt still DECLINED / PAYMENT_DECLINED / `requires_payment_method`, `orderId` null. Work **DONE**, lease cleared, retry 0, no error. Unfinished work rows **0**; orders 65 (unchanged); no email sent.
- **MAIN DEV:** restarted with `npm run dev`. `/api/health/payments`: `incidentWork` 0; `overdueWork` 18. These are the DONE+DECLINED rows the worker re-checks every 60 s for late provider success. The health clause counts them whenever no runner is running, so `degraded` persists by design until a governed recovery runner runs. The recovered row joins that set after its next re-check time. This is the definition noted as out of scope above; there is no stuck lease left.
