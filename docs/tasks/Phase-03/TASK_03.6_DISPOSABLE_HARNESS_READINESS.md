# Task 03.6 — Disposable PostgreSQL Real-Flow Harness: Readiness

Prepared 2026-10-14. **Source preparation and offline checks only.** No database was connected to, no Docker container started, no Stripe API called, no GitHub Actions run, nothing staged/committed/pushed/migrated. **Real-flow tests have NOT been executed; no real-flow test is claimed to pass.** The new scenarios K–R were authored against current source and **never executed** (no PostgreSQL available here), so expect first-run adjustments; they are test code only, no production source changed. No score or verdict is assigned.

Builds on `TASK_03.6_REAL_FLOW_ACCEPTANCE_PLAN.md` (Option A). Preserved unchanged: 258 backend / 132 frontend mocked results, AUTH/CI/pre-push approvals, the DEV isolated-schema guard.

## 1. Exact harness changes

| File | Status | Purpose |
|---|---|---|
| `apps/backend/scripts/payment-pg-disposable.cjs` | **new** | Separate DISPOSABLE scope: configuration + target proof, run identity, schema provisioning/cleanup, bounded stages, strict report verifier, `--check-config` and `--run`. Platform-neutral (Linux CI and Windows). |
| `apps/backend/scripts/payment-pg-disposable.test.cjs` | **new** | 12 offline tests for the scope, including cross-guards with the DEV runner. |
| `apps/backend/src/services/__tests__/helpers/payment-postgres-harness.ts` | **new** | Shared harness: provider double with Stripe-like idempotency and scripted faults, fault-injecting DB wrapper, in-process re-proof of the disposable target, fixtures, lifecycle helpers. |
| `apps/backend/src/services/__tests__/payment.lifecycle.postgres.integration.test.ts` | **new** | Scenarios K–R (PostgreSQL only). |
| `apps/backend/src/services/__tests__/payment.concurrency.postgres.integration.test.ts` | **4 small hunks** | A–J gains a disposable branch: import, `enabled` also true in disposable mode, run-schema name, and an early-returning `if (disposableMode)` block at the top of `beforeAll`. The DEV guard block below it is **byte-identical**; DEV mode (`PAYMENT_PG_TEST_INTERNAL_RUN='1'`) is unchanged. A–J scenarios untouched. |
| `apps/backend/src/services/__tests__/payment.stripe.live.test.ts` | **edited** | Adapted to the current `/submit` lifecycle plus explicit gates (section 5). Existing DEV/Test-Mode guard untouched. |
| `scripts/payment-concurrency-integration-suite.cjs`, `scripts/payment-pg-execution.cjs` (DEV runner and helpers) | **not modified** | State evidence: sha256 prefixes `5b2308a0a99e3069` / `aaaf2d8dd1945790`, mtimes 2026-10-13 14:24 / 17:27. Test `the DEV scope guard ... still DEV-only` asserts they gained no disposable branch. No production payment source was modified. |

Why a separate test file for K–R: the DEV runner's report check requires exactly 10 passed and 0 pending tests, and skipped tests count as pending, so adding scenarios to the A–J file would break DEV mode.

Known duplication to note for review: A–J keeps its own copies of `Barrier`, a provider double and fixture helpers; the new harness has improved copies. A later cleanup can migrate A–J to the shared module; it was not done to avoid touching a previously reviewed file beyond the four hunks.

## 2. Disposable-target safety guards (all fail closed)

"Disposable" is **proved, not declared.** `PAYMENT_PG_DISPOSABLE_APPROVED=true` expresses authorization only and never establishes the target.

1. **Exact authorization string** `DISPOSABLE:<database>:scenarios-A-R:fixtures+drop-run-schema` bound to the database name and scenario set.
2. **Target shape:** loopback host only (`localhost`, `127.0.0.1`, `::1`), explicit port 1024–65535, role `postgres`, database `electrohub_ci*` or `electrohub_disposable*`, no query options. Any text naming Supabase, a pooler, the DEV or PROD project refs, `amazonaws`, `ap-northeast`, `neon.tech`, `azure` or `rds.` is rejected first, so DEV/PROD identities are refused explicitly.
3. **Cryptographic proof:** the connection uses verified TLS against a per-run CA **file** that must be self-signed, `CN=electrohub-ci-ca`, a real CA, valid at most 48 hours and issued within the last 48 hours. A hosted or general-purpose server cannot present a certificate chaining to it.
4. **Server-side proof (read-only transaction, re-run inside the test process):** database name matches; session role is `postgres`; PostgreSQL 17; the session is actually on TLS (`pg_stat_ssl`); **no other databases, no other login roles, none of the Supabase platform roles or schemas, and no relations outside the run schema**. A local multi-purpose server (such as the installed PostgreSQL 18 service) fails these.
5. **Fresh identifiers per run:** random run id → schema `pgrun_<12 hex>`; the schema carries a marker comment equal to the run id; cleanup drops only a schema whose marker matches, then verifies absence.
6. **Isolation checks inside the tests:** `search_path` pinned to the run schema, and every `public` financial relation must be absent (`42P01`).
7. **No Stripe, no ambient database config:** children run with `STRIPE_SECRET_KEY=''`, a signature-fixture webhook secret, and `DATABASE_URL`/`DIRECT_URL` forced to the run URL (ambient DEV URLs from `.env` cannot leak in). Live Stripe values in the environment or env files block the run. `NODE_TLS_REJECT_UNAUTHORIZED=0` blocks the run.
8. **Bounds:** vitest `--pool=forks --maxWorkers=1 --no-file-parallelism`; Prisma pool max 4 and `connection_limit=4`; stage timeouts 180 s (migrate) / 600 s (tests), per-test 60 s; child output capped at 4 MB; the full report is verified (both files, scenarios A–R exactly once, all passed, none skipped).
9. **Financial constraints untouched:** the migrations are replayed unmodified (`prisma migrate deploy`), constraints and CHECKs stay in force, and scenario R asserts the lineage migration's effect.

## 3. Current-source A–J compatibility

A–J already drives the **current** lifecycle (`setup → submit → authorize → process`; nine `.submit(` calls). In disposable mode A–J runs unchanged against the run schema. DEV-only assumptions were isolated behind the early branch: the DEV project ref, role, `DEV:…` scope string, the public-table `42501` probes and the empty-Stripe-key check apply only in DEV mode. Not verified by execution.

## 4. Real-test coverage mapped to specification sections 52–54

PostgreSQL-only unless marked (all provider behaviour is the scripted double; real Stripe is covered in section 5).

| Spec requirement | Covered by |
|---|---|
| 52 atomic order + inventory; immutable snapshots | A, D, E (existing), K |
| 52 payment-attempt ownership transfer, Cart B isolation | A–F, I (existing) |
| 52 rollback/constraint failures (23505, 23514, P0001, 40001) | F, I, J (existing) |
| 52 capture succeeded, local write failed | **O** (injected local failure after capture), **N** (reply lost) |
| 52 compensation restores stock once; no Cart inflation | **M** |
| 52 migration apply/readback incl. lineage migration | **R** (all repository migrations replayed in the run schema; `familyId` `NOT NULL` without default, unique and CHECK present) |
| 53 last unit, two customers | **K** |
| 53 same owner/key concurrent setup | **L** |
| 53 reconcile + webhook + worker: one Order; stale worker | H, G (existing) |
| 53 compensation runners overlap | **M** (stalled first runner, expired lease, second runner, first fenced out) |
| 53 duplicate capture / restart | **N**, **O**, **Q** |
| 54 boundary 5 (commit done, dies before capture) | **Q** |
| 54 boundary 6 (capture done, reply/ack lost) | **N**, **O** |
| 54 boundary 8/9 (compensation / refund retry; stable refund identity) | **M**, **P** |
| 54 boundary 10 (lease expires mid-operation) | G (existing), **M** |
| 54 boundaries 1–4, 7 (provider create/cancel reply lost, abandonment, webhook before work) | not PostgreSQL-only; covered by real-Stripe suite cases (section 5) and H |
| 52 "no Stripe call inside a transaction" | remains mocked/static evidence only |
| 52 removed/inactive-product and quantity-limit Cart restoration | **not covered** (submitted purchases never merge into Cart; unsubmitted restoration needs its own case) |

New scenarios: K last-unit race, L same-key setup, M compensation overlap, N reply lost after capture, O local acknowledgement failure after capture, P refund reply lost with stable identity, Q death before capture, R migration replay (K–R = 8; with A–J, **18 scenarios, A–R**).

## 5. Stripe Test Mode suite adaptation (`payment.stripe.live.test.ts`)

Edits (existing DEV/Test-Mode guard untouched): `authorize()` now performs the customer's real final-action order, **`POST …/submit` then confirmation** (matches `CheckoutPage.tsx`), skipping submit when the attempt is unbound or already submitted (retry flow); same-Cart overlapping-key case tolerates the second tab's legitimate submit rejection; new case **duplicate and concurrent submit transfers the Cart once and still captures exactly once**; **account identity preflight** asserts the Stripe account equals the owner-supplied account before any mutation; **allowance gate** counts authorized cents per attempt and stops before a provider call that would exceed the owner-stated ceiling. Suite now has 26 test cases (20 definitions, some parameterized), all skipped unless authorized.

Required gates (the module throws at import if enabled without them, shown by a simulated run): `PAYMENT_STRIPE_LIVE_DEV=true`, DEV project ref in `DATABASE_URL`/`DIRECT_URL`, `sk_test_` key, **and** `PAYMENT_STRIPE_LIVE_EXPECTED_ACCOUNT=<acct_…>`, `PAYMENT_STRIPE_LIVE_ALLOWANCE_CENTS=<integer>`, `PAYMENT_STRIPE_LIVE_AUTHORIZATION=STRIPE-TEST:<account>:<allowance>:create+authorize+capture+cancel+refund:disposable-fixtures`.

Coverage by operation: authorization and capture (case 1), 3DS and decline (action-required/decline case), duplicate setup/submit (overlapping keys, new submit case), unknown provider outcomes and recovery (lost reply/ack cases, restarted runner), compensation and refund (terminal-cancellation, partial compensation, pending-refund-survives-restart). **Not automated in this suite:** signed Stripe-CLI webhook forwarding with tampered/replayed deliveries (spec 57) remains the owner-run step S7 of the plan; synthetic signed events for replay exist in A–J (H).
**Residual caveat:** the suite still reads an approved DEV login from the last two lines of `.env`, uses the hard-wired DEV project, and creates data in DEV `public`. It is not disposable-database ready: running its database half on a disposable instance needs a further generalization (not done; Option A route for Stripe cases is therefore still open).

## 6. Offline verification performed

| Check | Result |
|---|---|
| `node --test scripts/payment-pg-disposable.test.cjs` | **12 passed, 0 failed, 0 skipped** |
| `node --test` on the existing DEV script suites (`payment-concurrency-integration-suite`, `payment-pg-execution`, `payment-pg-readiness`, `payment-pg-ca`) | **32 passed, 0 failed, 0 skipped** (same count as before; DEV guard behaves the same) |
| Backend `npx tsc --noEmit` (includes all new/edited TS) | exit 0 |
| `npx eslint` on the 4 changed/new TS files `--max-warnings 0` | exit 0 |
| Vitest discovery without the disposable scope | 2 files, **18 tests discovered (A–R), all skipped, 0 failed**, no database contact |
| Live suite discovery without gates | 26 tests, all skipped, no throw |
| Live suite with only part of the gates | module throws the exact-authorization error before any code runs |
| `git diff --check` (backend) | clean |

Not run: any database, Docker, Stripe, workflow. The 258/132 mocked results were not rerun (unchanged production source).

## 7. Exact future disposable execution entrypoint

**Do not run without the authorizations in sections 8–9.** The runner needs a throwaway PostgreSQL 17 with TLS and its per-run CA (the recipe in `.github/actions/disposable-postgres/action.yml`: loopback port, database `electrohub_ci`, role `postgres`, CA `CN=electrohub-ci-ca`).

```bash
cd apps/backend
export PAYMENT_PG_DISPOSABLE_APPROVED=true
export PAYMENT_PG_DISPOSABLE_URL="postgresql://postgres:<password>@localhost:55432/electrohub_ci"
export PAYMENT_PG_DISPOSABLE_CA_FILE="/abs/path/to/ca.crt"
export PAYMENT_PG_DISPOSABLE_AUTHORIZATION="DISPOSABLE:electrohub_ci:scenarios-A-R:fixtures+drop-run-schema"
node scripts/payment-pg-disposable.cjs --check-config   # offline: configuration + CA proof only
node scripts/payment-pg-disposable.cjs --run            # connects, proves, provisions, tests, cleans up
```

Pass condition printed by the runner: `DISPOSABLE SUITE PASS: 18 scenarios (A-R) passed on real PostgreSQL in schema pgrun_<id>` and `CLEANUP PASS`. Anything else is a failure to be investigated, never retried against another target.

**CI route (needs the CI owner; the CI action itself has not yet run on a real runner):** add a **separate job** (not `backend-test` and not `verify-migration`, because those run `prisma migrate deploy` into `public`, which would correctly fail the "fresh instance" proof) that uses `./.github/actions/disposable-postgres`, then runs the entrypoint above with `PAYMENT_PG_DISPOSABLE_URL` derived from `DATABASE_URL` without its query string, `PAYMENT_PG_DISPOSABLE_CA_FILE=$DB_SSL_CA_CERT_PATH`, the authorization string above and `PAYMENT_PG_DISPOSABLE_APPROVED=true`. The action's CA (`CN=electrohub-ci-ca`, one day), loopback port 55432, database `electrohub_ci`, role `postgres` and `postgres:17` already satisfy every proof condition. The workflow policy check must be updated by the CI owner if the new job needs it. The disposable-run job also needs the `workflow-policy` allowlist logic reviewed (it uses no shared secret).

## 8. Owner authorization required for PostgreSQL execution

Written approval to run **only** `payment-pg-disposable.cjs --run` against a throwaway PostgreSQL 17 instance that is **not** the installed PostgreSQL 18 service and not any hosted database, either (a) an owner-approved local container started per the action's recipe, or (b) one GitHub Actions run of the new CI job (also needs the CI owner's approval and, per the standing decision, no push until Task 03.6 is formally closed). It creates and drops one schema in that instance and writes only disposable fixtures.

## 9. Owner authorization required for Stripe Test Mode operations

Not requested for the PostgreSQL-only suites. For the live suite the owner must supply, in one explicit approval: environment (DEV project + local runner), Stripe account id, the integer allowance in cents, the operation set above, and the three environment values in section 5. The suite then creates real PaymentIntents, authorizes with Stripe test payment methods, captures, cancels and refunds on disposable fixtures; ambiguous outcomes are read back, never replayed. Signed CLI webhook forwarding needs its own approval and a running `stripe listen`.

## 10. Remaining acceptance gaps

- **Scenario 1 manual verification (owner):** open; script in the plan section 4.
- **HTTP 503 (≈53 s) / 500:** root cause unknown, not explained by this harness; a disposable loopback database cannot reproduce hosted-pooler behaviour. Needs an authorized live setup with the existing correlation diagnostics, or an owner-recorded residual-risk decision.
- **Authored-but-unexecuted code:** K–R and the live-suite edits have only compile/lint/discovery evidence.
- **Live suite not disposable-DB ready** (section 5 caveat).
- **Release requirement unchanged:** DEV and PROD must end with 17 successful Prisma migrations, schema parity and Prisma-managed history; this task executed none. Scenario R gives disposable-replay evidence of all 17 migrations including the lineage migration, but it is not DEV/PROD parity evidence.

## Superseded in part by the unified readiness document (2026-10-14)
See `TASK_03.6_UNIFIED_ACCEPTANCE_READINESS.md`. Changes since this document: the runner now kills whole process trees and skips cleanup when termination is unconfirmed; the Prisma CLI uses strict native TLS with a probe stage (the earlier `sslmode=disable` loopback shortcut is gone); the live Stripe suite has a separate disposable mode and entrypoint (`scripts/payment-stripe-disposable.cjs`), so the caveat above that it is not disposable-database ready no longer applies at source level. Nothing has been executed.


## Contract update (2026-10-14)
The disposable suite is now scenarios A–S (19): scenario S covers compensation of historical attempts (spec 52). The authorization scope string is `DISPOSABLE:electrohub_ci:scenarios-A-S:fixtures+drop-run-schema`; earlier mentions of A–R and 18 scenarios in this document are superseded. See `TASK_03.6_UNIFIED_ACCEPTANCE_READINESS.md`.
