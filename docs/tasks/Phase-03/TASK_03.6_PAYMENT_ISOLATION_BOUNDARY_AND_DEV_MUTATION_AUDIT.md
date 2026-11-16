# Task 03.6 — Payment Isolation Boundary and DEV Mutation Audit

Status: **OPEN — pending Principal Architect review. NO PUSH. Nothing committed.**
Responds to the Architect's "Request Changes (88/100)". Date 2026-10-17 (UTC). DEV reads were SELECT-only; logs read from `apps/backend/logs`.

## 1. Audit of the automatic DEV mutations

Code version: **the uncommitted working tree on base commit `3d69b97`** (branch `feature/Stripe`), loaded by the watched `npm run dev`
(`tsx watch src/bootstrap.ts`) when this task's backend edits were saved. There is no commit id because the code was never committed. The
mutating rule: `neverConfirmedSubmission` (10-minute grace) and, for the third row, the client `release-unconfirmed` path.

Note: the earlier closure handoff said the never-confirmed rule used a *fresh* provider read. **That was inaccurate.** It uses the read taken
in the same worker pass (seconds old). Race safety comes from re-checking the missing confirmation marker on the locked row, not from a
second Stripe read. The closure document is corrected below (§5).

| Attempt | Owner | Submitted | Process that mutated it | Evidence before mutation | Mutation (in order) | Charged? |
|---|---|---|---|---|---|---|
| `aac568f8` MacBook Air 15 1TB Starlight $1,619 | customer B | 10:47:57 | **pid 264336** (watch restart 11:00:22) | claim 11:02:12.472 → Stripe read 11:02:13.296 `requires_payment_method`; no confirmation marker; `failureCode` null | Stripe requests 11:02:15.910 (cancel) + 11:02:16.204 (read back); DB `CANCELED / PAYMENT_INCOMPLETE`, `providerStatus=canceled` at 11:02:17.937 | No: never authorized; no order |
| `5c9261c5` iPad Air 11 1TB Starlight $959 | customer A | 10:41:08 | **pid 264336** | claim 11:02:42.014 → read 11:02:44.727 `requires_payment_method`; no marker | Stripe 11:02:57.609 (cancel) + 11:02:59.214 (read back); DB `CANCELED / PAYMENT_INCOMPLETE` 11:03:04.021 | No; later **restored by the customer** (11:28:17), Cart holds exactly 1 iPad |
| `327705a5` (newly found) | customer A | 11:32:04 (`/submit` took **33.7 s**) | **pid 274424**, via the new client release | `POST …/release-unconfirmed` 202 at 11:32:24 (10.3 s), no confirmation marker; worker claim 11:34:28.926 → read 11:34:29.648 `requires_payment_method` | DB `CANCELED / PAYMENT_INCOMPLETE` 11:34:34.911 | No; no order |

Stripe-side verification of these cancellations remains **BLOCKED**: the connector reaches `acct_1UEZV83TuYNdQJpp`, but the app's account is
`acct_1UEZW5KiVgdl63pN`. The table cites the backend's own Stripe reads and request timings only.

The four originally reported purchases are preserved; nothing was reset or erased. Since the last report, customer A acted on them in the live UI:
- `aab01e3a` (MacBook Space Gray) and `bf43a065` (Buds2): dismissed.
- `5c9261c5` (iPad): restored, then dismissed.
- `8d797010`, `cca9a45f`, `cfc86916` (older submitted lapses that became visible through the read-side mapping): dismissed or restored.

These are customer actions, not mine.

**Unresolved question on `327705a5`.** The browser released the purchase immediately after a 33.7 s `/submit`, which means its secure-entry
instance was gone. Server logs can't tell whether the customer left Checkout (correct: release) or the form was torn down while they waited
(a remaining defect). The release request now carries a `reason` (`form-unmounted` / `form-replaced` / `signal-failed`), logged as
`payment.confirmation.released`, so the next occurrence is attributable. This must be re-tested in the isolated environment before closure.

## 2. Isolation boundary (implemented)

`apps/backend/src/payment-isolation.ts` makes one configuration-only decision per process:

| Target | Condition | Payment mutations |
|---|---|---|
| Disposable | **every** database URL is loopback AND the database is `electrohub_disposable*` / `electrohub_ci*` | allowed (including under `npm run dev`) |
| Shared, approved | `PAYMENT_SHARED_MUTATIONS_APPROVED` equals the exact `host:port/database` identity AND not `npm run dev` | allowed (reviewed deployments only) |
| Shared, otherwise | anything else, **including any shared target under the watched dev server, even with the approval set** | **denied** |
| Unit tests | `NODE_ENV=test` (mocked databases) | allowed |

Enforced at every mutation entry point (fail closed, `503 PAYMENT_MUTATIONS_DISABLED`):
- **In-process recovery:** not started.
- **Dedicated `--payment-worker` runner:** refuses to start.
- **`PaymentService.runBatch()`:** returns 0, no claim.
- **`process()`:** returns before any lease, read or write.
- **List-poll reconcile:** skipped.
- **Customer payment writes:** `setup` (PaymentIntent creation), `submit`, `confirmationStarted`, `releaseUnconfirmed`, `resume`, `reconcile`, `cancel`, `restore`, `dismiss`, `acknowledge`, `wake`.
- **Stripe provider:** `create`, `capture`, `cancel`, `refund` (defense in depth).
- **Webhook ingestion:** refused before signature or database work; Stripe retries.

Payment status reads stay available. Non-payment features (Cart, wishlist, auth) are unaffected. At startup the server and the runner log
`payment.isolation.resolved` with the credential-free target identity, the decision and the reason.

**Live confirmation (real, read from logs):** the watched DEV backend restarted at 11:44:08 (pid 275852) and logged
`allowed=false, target=shared, identity=aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres,…:5432/postgres,
reason=watched-dev-server-on-shared-target`. It **did not** start in-process recovery. Its payment workers are stopped without terminating
the process (Architect action 1).

## 3. Approval-gate evidence: start / restart / hot-reload cannot mutate shared records

- **Hot-reload and restart:** every reload re-runs `bootstrap → server.ts`, which re-resolves isolation from configuration. Under `npm run dev`
  with a shared target the answer is always "denied", regardless of approval variables (tested). A reload therefore cannot re-enable a
  worker, and every request path checks the same decision.
- **Start:** the same decision; there is no code path that mutates payments before it.
- **Tests (`src/__tests__/payment-isolation.test.ts`, 8 passed):**
  - the exact 2026-10-17 configuration is denied;
  - shared targets are denied by default in development and production;
  - only the exact approved identity is allowed (near matches and the other Supabase project are refused);
  - disposable targets are allowed;
  - a remote host with a disposable-looking name, or mixed URLs, are treated as shared;
  - no credentials appear in the identity;
  - unconfigured databases are denied;
  - in-process recovery is off for shared and on for disposable;
  - a denied `PaymentService` touches neither the database nor the provider (`runBatch`/`process`) and rejects all 11 customer payment writes with 503.
- **Webhook test:** `stripe-webhook.routes.test.ts`, refusal before any database write (22 passed).
- **Recovery default test:** updated to the target-aware rule (2 passed).

**Limit of this evidence:** it covers this repository's backend. It cannot stop *another* process that runs older code. See §4, item 1.

## 4. Remaining blockers (not closed)

1. **The stray runtime pid 270904** (started 08:32, never reloaded, so it runs older code without the boundary) was **still claiming payment
   work at 11:52** against a database that is **not** electrohub-dev. Stripe CLI webhooks are forwarded to it. I did not terminate it.
   - **Owner:** environment owner.
   - **Action:** identify its database. If it is the `electrohub` Supabase project, treat this as a PROD-safety incident. Then stop it and repoint `stripe listen`.
2. **The disposable database is not yet provisioned.** Docker is not installed on this workstation. The steps were provided earlier; database name `electrohub_disposable` on loopback satisfies the boundary.
3. **Stripe isolation:** the boundary governs *which database* payment code may mutate. The Test Mode key and account are still shared. A
   separately authorized PaymentIntent budget is required before any confirmation test (70/70 remains exhausted).
4. **Cause of `327705a5`'s release** (§1): must be re-tested in isolation.
5. **Shared DEV and PROD deployments must now set `PAYMENT_SHARED_MUTATIONS_APPROVED`** to their exact logged identity, or payments return 503.
   This is a deliberate release-gate change for the deployment owner (documented in `apps/backend/.env.example`).

## 5. Correction to the closure handoff

In `TASK_03.6_FINAL_ENDLESS_PROCESSING_ROOT_CAUSE_AND_CLOSURE.md` §1 #2 and §6 step 7, "fresh provider read" for the never-confirmed rule
should read "the provider read from the same recovery pass". The fresh second read applies only to clearing an announced marker.

## 6. Changed files (this pass)

- Backend: new `src/payment-isolation.ts`; `src/server.ts`, `src/payment-runner.ts`, `src/payment-inprocess-recovery.ts`,
  `src/services/payment.service.ts`, `src/services/stripe.provider.ts`, `src/routes/stripe-webhook.routes.ts`,
  `src/routes/payment.routes.ts` (release `reason`); `.env.example`.
- Tests: new `src/__tests__/payment-isolation.test.ts`; `src/routes/stripe-webhook.routes.test.ts`,
  `src/services/__tests__/payment-inprocess-recovery.test.ts`.
- Frontend: `confirmationSignal.ts` and `CheckoutPage.tsx` (release reason).

## 7. Verification (actually run)

| Check | Result |
|---|---|
| Backend `vitest src` | 752 passed, 63 skipped. 1 failure, which is the existing unrelated `cart.quantity-correction.integration.test.ts` (500 vs 200; no payment imports). The recovery-default test failed by design after the change and was updated; it now passes. |
| Frontend `vitest src/features/checkout` | 247 passed |
| Typecheck / lint / build, backend + frontend | exit 0 |
| `git diff --check` | clean |

## 8. Recommendation

The isolation boundary is implemented and confirmed live on the watched DEV backend. **Do not resume payment tests yet.** They need:
- the stray runtime 270904 resolved (§4, item 1);
- the disposable database provisioned and its `payment.isolation.resolved` line showing `target=disposable`;
- an explicit Stripe Test Mode allowance.

Task 03.6 remains **OPEN**. **NO PUSH.**

## 9. Containment of stray backend PID 270904 (2026-10-17, 11:54–12:01 UTC)

**Identity (verified):**
- `node.exe … tsx/dist/loader.mjs src/bootstrap.ts`, run from this repository and started 08:32:13 UTC, so it predates every Task 03.6 change in this session and was never reloaded. Its payment code therefore had **no isolation boundary**.
- Launch chain: Git Bash `npx tsx src/bootstrap.ts` → cmd → tsx CLI (270432) → node (270904). There was **no supervisor and no watch mode**; the originating shell (225964) had already exited.
- Console membership was exactly that chain.
- Listening port **5100**, `NODE_ENV=development`; in-process recovery runner active (`/api/health/payments`: phase `ready`, 0 overdue, 0 incident work).
- Account owner: not readable without elevation.

**Database:** its established connections were **`127.0.0.1:55432`**, a native local `postgres.exe` (pid 264688, started 08:33 UTC). That is loopback, so **not shared DEV or PROD**. The database name is unverified (no credentials read).

**Stripe:**
- One HTTPS connection to `198.202.176.175`, inside Stripe's address block but not a current `api.stripe.com` A record, so Stripe is likely, not proven.
- Mode: **Test** (enforced in code: `sdk()` refuses any key that is not `sk_`/`rk_test_`).
- The Stripe CLI listener was forwarding webhooks to this process (14 accepted).

**Its payment activity (log audit, read-only):**
- 241 Stripe requests across 3 attempts that exist only in its local database:
  - `00674bd3`: `requires_capture` → **PAID**.
  - `f9bd3a6a`: `requires_capture` → **PAID**. Both were real Test Mode authorizations and captures (webhooks at 08:36–08:37).
  - `23fa8fab`: DECLINED, re-read 201 times.
- No cancellation or refund outcome is logged.
- It **did not** mutate any electrohub-dev row. The webhooks for the DEV cancellations reached it and were recorded only in its local database.

The "third uncharged mutation" (`327705a5`) was **not** made by 270904. It was made by the watched DEV backend (pid 274424) before the boundary loaded (§1).

**Termination:**
1. A graceful console Ctrl+C (SIGINT → `gracefulShutdown`) was delivered only to that console at about 12:00:10. **It had no effect:** the chain was started from a non-interactive shell with Ctrl+C disabled, and no shutdown was logged. CTRL_BREAK would map to an unhandled SIGBREAK, so it would be equally abrupt.
2. After assessing the consequences (loopback database, no overdue or incident work, leases expire in ≤120 s and are reclaimed, Stripe calls idempotent), `taskkill /PID 270904 /F` was issued at a verified idle point: last pass `23fa8fab` claimed 12:00:34.700 → persisted 12:00:35.227, with no claim open.
3. Result: 270904 exited; its whole launch chain exited by itself; port 5100 closed; nothing restarted it after 8 s.
4. Any lease in its local database that was mid-pass would be reclaimed by the next runner on that database. None was open, per its log.

**Post-containment state:**
- The only ElectroHub backend left is the watched DEV server (tsx watch 272608 → node 275852, port 5000). It resolves `payment.isolation.resolved allowed=false, reason=watched-dev-server-on-shared-target` and has made **0 payment claims since 11:44**.
- No `payment-runner`/`--payment-worker` process exists.
- Pid 264436 (one claim at 11:49:12, redacted attempt id, 75 ms) matches this session's backend test run writing to the shared log file. It is not a runtime and not running.
- Port 5040 belongs to Windows `svchost.exe` (unrelated).

**Remaining risks:**
- **Stripe CLI listener:** still forwarding to 5100. Repoint it (`--forward-to localhost:<isolated backend port>/api/webhooks/stripe`) or stop it. Until then those Test Mode webhooks fail delivery and Stripe retries them.
- **Local Postgres on 55432:** still running (pid 264688). It holds 2 PAID test attempts. Preserve it if those count as acceptance evidence, otherwise retire it. It was left untouched.
- **Old-code risk:** any backend started outside this working tree's current code (`npx tsx src/bootstrap.ts` from an older checkout or shell) has no isolation boundary. Start backends only from the current tree, and check the `payment.isolation.resolved` startup line.

## 10. Orphaned Stripe CLI listener stopped (2026-10-17, ~12:03–12:07 UTC)

**Identity, recorded before stopping (no credentials shown):**
- Chain: `sh.exe 265700` → `node.exe 263424` (`@stripe/cli` shim) → `stripe.exe 265320`, started 08:28:25 UTC. The parent shell (274644) had already exited, so there was **no supervisor**.
- Command: `stripe listen --events payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.processing,payment_intent.canceled,refund.created,refund.updated,refund.failed,charge.refunded --forward-to http://127.0.0.1:5100/api/webhooks/stripe --api-key ***`.
- Mode: **Test** (key prefix `sk_test_`).
- Account: **`acct_1UEZW5KiVgdl63pN` (inferred).** The listener delivered the events for DEV intents bound to that account (for example the cancellations of `pi_3URTtb…` and `pi_3URTmx…`). It was not verified with a Stripe API call.
- Connection: a single websocket to `54.187.119.242:443`.
- Console membership: only its own three processes.

**Stop sequence:**
1. Console Ctrl+C was delivered and ignored (the chain was started from a non-interactive shell with Ctrl+C disabled).
2. `taskkill` without `/F` was refused by Windows ("can only be terminated forcefully").
3. After assessment (stateless relay, no database, forward target already closed, events retained in Stripe's event log, nothing replayed), `taskkill /PID 265320 /F` was run on **stripe.exe only**.
4. Result: stripe.exe, its shim and its shell exited.

**Verification:**
- No Stripe CLI process remains.
- Nothing listens on port 5100.
- It was the only Stripe CLI listener on the machine, so no other listener was affected.
- The only backend is the watched DEV server (node 275852, port 5000). Its last startup resolved `allowed=false, reason=watched-dev-server-on-shared-target`, and it has made **0 payment claims and ingested 0 webhooks since 11:44**.
- Evidence preserved: `apps/backend/logs/app.log` (20.7 MB) and `error.log` are untouched, and no `stripe_events` or payment rows were changed.

**Webhook endpoints, inspected read-only:**
- The repository exposes a single receiver, `POST /api/webhooks/stripe`.
- Dashboard-registered endpoints on `acct_1UEZW5KiVgdl63pN` could **not** be inspected: the connected Stripe integration reaches a different account (`acct_1UEZV83TuYNdQJpp`). **NOT VERIFIED**, and nothing was disabled.

**Rule for future payment tests (required before any new listener starts):**
1. A dedicated isolated backend, whose startup logs `payment.isolation.resolved target=disposable`.
2. A disposable PostgreSQL (loopback, `electrohub_disposable*`).
3. A Stripe Test Mode key and listener for the verified app account, forwarding to that isolated backend's port only.
4. An explicit written authorization with a PaymentIntent budget.
