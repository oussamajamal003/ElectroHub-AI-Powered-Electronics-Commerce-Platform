# Task 03.6 — Unified Real-PostgreSQL A–S and Stripe Test Mode Acceptance Readiness

Prepared 2026-10-14. **Source preparation and offline verification only.** Nothing was executed against a database, Docker, Stripe, GitHub Actions or any shared resource; nothing was staged, committed, pushed or migrated; no approval flag was set. **Task 03.6 remains OPEN.** Real PostgreSQL A–S and real Stripe Test Mode results do not exist; every real-flow item below is NOT VERIFIED or BLOCKED. No score or verdict is assigned.

Evidence labels: **OBSERVED** (inspected or run in this task), **REPORTED** (from earlier documents/agents), **NOT VERIFIED** (no sufficient evidence).

## 1. Three modes, three identities

| | Mode A: disposable A–S | Mode C: disposable real Stripe | Mode B: shared-DEV isolated schema (fallback) |
|---|---|---|---|
| Entrypoint | `scripts/payment-pg-disposable.cjs` | `scripts/payment-stripe-disposable.cjs` | `scripts/payment-concurrency-integration-suite.cjs` (Codex) |
| Target | throwaway PostgreSQL 17, loopback, `electrohub_ci*`, TLS to per-run CA | same proof, **public** schema of the disposable database | DEV `pzxekjybdiulzmssalfo`, restricted role, marked schema, session pooler |
| Tests | A–J (`payment.concurrency…`) + K–S (`payment.lifecycle…`), mocked provider | `payment.stripe.live.test.ts` (26 cases), **real Stripe Test Mode** | A–J only (exactly 10, 0 skipped) |
| Approval variables | `PAYMENT_PG_DISPOSABLE_APPROVED`, `_AUTHORIZATION` (scope `scenarios-A-S`) | `PAYMENT_STRIPE_DISPOSABLE_APPROVED`, `_EXPECTED_ACCOUNT`, `_ALLOWANCE_CENTS`, `_AUTHORIZATION`, plus PG vars with scope `stripe-live` | `PAYMENT_PG_TEST_*` (`APPROVED`, `TARGET`, `PROJECT_REF`, `SCHEMA`, `ROLE`, `SCOPE_AUTHORIZATION`, monitor file) |
| Secrets | disposable password, per-run CA | disposable password, per-run CA, **explicit** `sk_test_` key, fresh per-run `JWT_SECRET` | restricted-role URL, DEV CA |
| Stripe | blank key in children | Test Mode key, account and allowance gates | never |
| Cleanup | drops only the schema carrying this run's marker; skipped if child termination is unconfirmed | suite removes its own fixtures; runner then verifies no `payment-gate-*` residue; instance destroyed by its provisioner | `DROP … RESTRICT` of the marked schema |
| Monitoring | none required | none required | trusted observer feed (Codex), required |

Independence is enforced and tested (OBSERVED, offline): each entrypoint scrubs `PAYMENT_STRIPE_LIVE_*`, `PAYMENT_STRIPE_DISPOSABLE_*` and `PAYMENT_PG_TEST_*` from its children; the A–S authorization string cannot start Mode C and vice versa; Mode C refuses a set `PAYMENT_STRIPE_LIVE_DEV`; the A–S runner's source does not reference Mode C and Mode C never invokes `--run` of another runner; the live suite refuses both-flags, hosted/DEV/PROD URLs and a missing exact authorization **at import**, before any database or Stripe code (5 real Vitest imports in the test suite).

## 2. Codex shared-DEV path preserved (fallback only)

OBSERVED: none of `payment-concurrency-integration-suite.cjs`, `payment-pg-execution.cjs`, `payment-pg-observer.cjs`, `payment-pg-readiness.cjs`, `payment-pg-child-guard.ps1`, `payment-pg-engine-probe.sql` or their tests was modified (sha256 prefixes `5b2308a0a99e`, `aaaf2d8dd194`, `cbd0c32245f3`, `e459af3d201c`, `04532112f414`, `0d569623f216`; mtimes 2026-10-13). Their 46 tests still pass. Contract confirmed in code: DEV-only identity and restricted-role checks; denied public financial tables; marker/ownership; four-session ceiling (`runnerBackends` ≤ 4, 0 at admission); ordinary client backends ≤ 34 at admission and ≤ 38 while running (abort above 38); samples older than 10 s rejected; unknown pooler values blocked unless risk is explicitly accepted; strict TLS migration URL; Windows Job-Object child guard; `DROP … RESTRICT` cleanup.
The A–J test file's DEV guard block is byte-identical; its disposable branch returns before it. The DEV path stays **BLOCKED**: the observer's approved connection/health feed was never operational (REPORTED) and this task did not build monitoring. Shared-DEV prerequisites are not prerequisites of Modes A and C.

## 3. Disposable-target proof and security checks (Mode A and C)

All OBSERVED in the 31 offline tests of Modes A and C unless marked: refuses DEV/PROD/hosted identities **before connecting** (text match on host/user/path, then loopback-only, explicit port, role `postgres`, database `electrohub_ci*`); refuses any URL query options; refuses pgbouncer/pooler text; requires TLS verified against a per-run CA file (self-signed, `CN=electrohub-ci-ca`, a real CA, ≤ 48 h validity, issued within 48 h); server-side proof in a read-only transaction: database name, session role, PostgreSQL 17, active TLS session, no other databases or login roles, no Supabase platform roles/schemas, no relations outside the run schema (so the installed PostgreSQL 18 service or any shared server fails); proof repeated inside the test process; an environment flag alone never enables a run (approval ≠ proof); ambient `DATABASE_URL`/`DIRECT_URL` and DEV env files cannot select a target (children get explicit URLs; Mode C also supplies its own random `JWT_SECRET` and never reads DEV login data); PostgreSQL-only children carry an empty Stripe key; connections capped at 4 (A–S) with one test fork and no file parallelism; stage timeouts 60 s probe / 180 s migrate / 600 s tests (A–S) and 2,400 s (Mode C); output capped at 4 MB; A–S report must contain scenarios A–S exactly once, all passed, none skipped; Mode C report must show ≥ 26 cases, all passed, none skipped; fresh run identifiers (`pgrun_<12 hex>`, marker comment created atomically with the schema).

## 4. Process cancellation, interrupted runs and cleanup (new in this task)

Defect found in my earlier runner: `child.kill('SIGKILL')` stopped only the direct child, so a vitest worker could outlive a timeout and race cleanup. Fixed and tested with real processes (OBSERVED, on this Windows host):
- Children lead their own process group on POSIX (`detached`) and the whole group is killed; Windows uses `taskkill /PID … /T /F`. After the leader exits the group is checked again (POSIX `kill(-pid, 0)`); stragglers are killed and re-checked.
- Owner SIGINT/SIGTERM abort the running stage, kill its tree, and reject as `OWNER_CANCELED`.
- If termination cannot be confirmed (`CHILD_TERMINATION_UNCONFIRMED`) cleanup is **skipped**, nothing is dropped, and the run schema/marker is reported as residue. Cleanup otherwise drops only a schema whose marker equals this run's id and verifies absence; a missing marker or mismatch refuses. Schema creation and marker are one transaction, so an unmarked schema cannot exist.
- Differences from Codex's guard, deliberately not copied: Codex uses a Windows Job Object with kill-on-job-close and an owner-pid watchdog, so children die even if the runner is hard-killed. The platform-neutral runner cannot give that guarantee on POSIX or with `taskkill`: **if the runner itself is force-killed (SIGKILL, power loss), orphaned children keep running until their own timeouts** and the schema may remain. Exposure is limited to a throwaway instance (no shared resource); accepted residual risk, destroyed with the container. NOT VERIFIED on Linux (tested on Windows only); the POSIX group logic is unit-tested with injected primitives.

## 5. Runtime TLS verification status

Mode A/C use TLS verified against the per-run CA in three places: the runner's proof client, the in-test proof client, and the application's `pg` adapter (`rejectUnauthorized: true` with `NODE_EXTRA_CA_CERTS`/`DB_SSL_CA_CERT_PATH`). Prisma's native engine (CLI) now also uses strict TLS (`sslmode=require`, `sslaccept=strict`, `sslcert=<per-run CA>`, one connection), replacing the earlier `sslmode=disable` shortcut, and a read-only **engine probe stage fails unless the engine's own session is on TLS in the proved database and schema**. Certificate recipe verified offline (chain, `localhost` and `127.0.0.1` verify; wrong host rejected). **Runtime handshakes: NOT VERIFIED** (no instance available; the Prisma 6.12 native handling of `sslcert` as the trusted root is REPORTED by Codex for DEV, also not executed there).

## 6. A–S scenario matrix (bodies reviewed; none executed)

Provider is a scripted double in every scenario (no network). "PG" = real PostgreSQL behavior relied upon.

| ID | Trigger | PG behavior required | Expected persistent state / outcome | Idempotency / recovery | Cleanup |
|---|---|---|---|---|---|
| A | two concurrent `submit` | row locks / unique `sourceCartItemId` | one transfer: `submittedAt` set, `activeCartId` null, 1 item with the source line, active Cart emptied | second submit is a no-op | run schema dropped |
| B | `submit` racing `CartService.add` | locking / serialization | either transfer then new line stays, or rollback with `CHECKOUT_CHANGED`/40001/40P01 and nothing transferred | caller may retry | same |
| C | Product B added while A is being processed (retrieve gate) | independent Cart rows | A's order has only A's item; active Cart and Checkout B only B; one capture | n/a | same |
| D | same SKU added after submit | unique line identity | new line id, qty 3 stays; A's saved item keeps the original line; stock 48 | n/a | same |
| E | `OrderService.commitAuthorized` with lease token | transaction | order for A only; Cart B byte-equal before and after | token-fenced | same |
| F | PostgreSQL trigger raises `P0001` inside the ownership transaction | full rollback | `submittedAt` null, `activeCartId` set, no transferred line, original Cart intact | retry possible after trigger dropped | trigger and function dropped in `finally` |
| G | lease replaced while a worker is mid-retrieve | fencing UPDATEs | stale worker commits nothing: no order, stock 50, no capture; work keeps the new lease | fenced | same |
| H | duplicate signed webhook + duplicate processor delivery | unique event id, one worker lease | 1 order, 1 payment, 1 item, stock −1, 2 event rows, capture 1, state PAID | event/processor duplicates inert | same |
| I | direct SQL violating ownership constraints | UNIQUE / CHECK | `23505`, `23514`; `submittedAt` stays null | n/a | same |
| J | two Serializable transactions (write skew) | SSI | exactly one `40001`, one write survives. Raw Prisma transactions, **not** service code | n/a | same |
| K | two customers authorize the last unit simultaneously | row lock on inventory | one PAID and one CANCELED; stock 0; 1 order; capture 1; cancel 1 | worker retries until terminal | same |
| L | two concurrent `setup` with one key | unique key | one attempt, one provider intent; replay returns same id | idempotent create | same |
| M | capture rejected, first runner stalled after cancel, lease expired, second runner compensates, first resumes | fenced compensation | COMPENSATED once; stock back to 10 (not 13); order CANCELLED; payment FAILED; Cart B untouched (submitted purchase never merges) | stalled runner fenced out | same |
| N | provider captured, reply lost | durable order + retry | fresh runner reads provider truth, PAID, capture count stays 1, stock −1 | no recapture | same |
| O | local transaction fails after a real provider capture (injected once) | rollback of the failed write | purchase already durable; fresh runner finishes PAID without recapture | no recapture | same |
| P | refund created, reply lost | durable `REFUND_PENDING` | fresh runner reuses the identity; one refund; `REFUNDED`; no order, stock unchanged | stable per-attempt refund identity | same |
| Q | process dies after purchase commit, before capture | durable commit | fresh runner captures exactly once; PAID; stock −1 | one effective capture | same |
| R | `prisma migrate deploy` of all repository migrations in the run schema | transactional DDL | ledger lists exactly the 17 repository migrations; `familyId` uuid NOT NULL without default; unique and CHECK present | n/a | same |
| S | historical (pre-ownership) attempt: authorized without a submit step, capture rejected, compensation while the runner is stalled; branch 1 retires one product, branch 2 adds a newer Cart item | transactional compensation, row locks | branch 1: COMPENSATED, order CANCELLED, stock restored, active line back in the empty Cart, retired line parked in `recoveryRemainder`; branch 2: nothing merges, Cart keeps the newer item only, whole line parked | stalled runner continues without a second restore | same |

A–J drive the real `PaymentService`, `CartService`, `OrderService` and the webhook router (H); I and J are database-level by design. R proves replay on a fresh disposable database only; it does **not** prove DEV or PROD parity.

## 7. Remaining material coverage gaps (spec sections 52–54)

- **Compensation-time Cart restoration: scenario S added** (19 scenarios, A–S; the runner's scenario list, report verifier and authorization scope were updated together, as the mandatory §52 requirement outranks the earlier count). Finding: in current source an unsubmitted attempt whose items carry a cart-line marker cannot commit at all (`PAYMENT_SUBMISSION_REQUIRED`) and a submitted purchase never merges into the Cart, so Cart restoration is live only for **historical** attempts without the marker; S drives that path. Restoration with an existing same-product line, or capped by the quantity limit, is **unreachable by construction** (restoration requires an empty Cart and stock is restored first) and is not separately testable without corrupting fixtures.
- "No Stripe call inside a financial transaction": static/mocked only.
- Crash boundaries 1–4 and 7 (provider create/cancel replies lost, browser abandonment, webhook accepted before work): covered only by the real-Stripe suite cases; not PostgreSQL-only.
- Signed Stripe-CLI webhook forwarding: Section 9.

## 8. Mode C: live Stripe suite on a disposable database — status

Implemented, **never executed**. The original DEV mode keeps its guard text and DEV login read. Disposable mode: proves the target (public schema, database-level marker) before any activity; skips the DEV login entirely; creates the `CUSTOMER` role when the fresh database lacks it; uses the run's own `JWT_SECRET`; keeps provider account-identity and allowance gates; requires an independent exact authorization bound to account, allowance and database; refuses live keys, DEV/PROD/hosted URLs and a set DEV flag; uses fixture ids scoped by the `payment-gate-<uuid>` prefix and removes only tracked ids; the runner verifies no prefixed user/product/category remains; stable provider operation identities are unchanged; ambiguous outcomes are read back by the existing cases (no replay logic added). The compiled `dist/payment-runner.js` spawned by the restart cases must be fresh; the runner blocks if it is missing or older than the payment sources (currently fresh, OBSERVED: built 2026-10-14 16:18). **No architectural blocker found.** Caveats: first-run adjustments are likely; Stripe API egress is required; hosted-pooler behavior is not exercised.

## 9. S7: owner-run signed Stripe-CLI webhook procedure (not run, no approval simulated)

Needs its own authorization. Prerequisites: the disposable instance from Mode C still running and migrated; `STRIPE_SECRET_KEY` Test Mode; a backend server built from current source started by the owner with the same environment the Mode C children use (disposable `DATABASE_URL`/`DIRECT_URL`, `DB_SSL_CA_CERT_PATH`, fresh `JWT_SECRET`), and `STRIPE_WEBHOOK_SECRET` set to the secret printed by the CLI.
1. `stripe listen --forward-to http://localhost:<port>/api/webhooks/stripe` (account verified as `acct_…` first); note the signing secret it prints.
2. Create one authorized disposable purchase (card `4242 4242 4242 4242`) so Stripe emits `payment_intent.amount_capturable_updated` and, after capture, `payment_intent.succeeded`.
3. **Valid signed events:** CLI shows `[200]` for each; read-only SQL: one `stripe_events` row per event id, attempt state `PAID`, exactly one order, one payment, one stock decrement, one capture in the provider.
4. **Tampered signature:** `POST` the same body to the route with `Stripe-Signature: t=1,v1=00`: expect rejection (4xx), no new `stripe_events` row, no state change.
5. **Replay:** `stripe events resend <evt_id>` for an already processed event: expect an accepted response, event row count for that id still 1, order/payment/stock/capture unchanged.
6. Stop on any unexpected state. Never retry an ambiguous capture. Record `x-request-id`, UTC time, event ids and sanitized SQL counts (no secrets).

## 10. Offline verification (this task; exact)

| Check | Result |
|---|---|
| `node --test scripts/payment-pg-disposable.test.cjs` | **20 passed, 0 failed, 0 skipped** (guard, CA proof, config fail-closed, server proof, cleanup marker, process-tree kill/abort/unconfirmed, atomic provisioning, env scrub, strict-TLS stages, probe SQL, report verifier, cross-scope guards) |
| `node --test scripts/payment-stripe-disposable.test.cjs` | **11 passed, 0 failed, 0 skipped** (includes 5 real Vitest imports of the live suite) |
| Codex DEV suites: `payment-concurrency-integration-suite`, `payment-pg-execution`, `payment-pg-readiness`, `payment-pg-ca`, `payment-pg-observer` tests | **46 passed, 0 failed, 0 skipped** |
| `node --check` on the 4 new scripts | OK |
| Backend `npx tsc --noEmit` | exit 0 |
| `npx eslint` on 4 TS files `--max-warnings 0` | exit 0 |
| Vitest discovery, no scope variables, 3 PostgreSQL/Stripe test files | 45 test definitions (10 + 9 + 26), **all skipped, 0 failed**, no database or Stripe contact |
| `git diff --check` (backend) | clean |

Not run: any database, container, Stripe operation, workflow; the 258 backend / 132 frontend mocked baselines (no production source changed).

## 11. Changed files and ownership

New (untracked, mine): `scripts/payment-pg-disposable.cjs` (+ `.test.cjs`), `scripts/payment-stripe-disposable.cjs` (+ `.test.cjs`), `src/services/__tests__/helpers/payment-postgres-harness.ts`, `src/services/__tests__/payment.lifecycle.postgres.integration.test.ts`, this document. Edited (test-only, untracked, mine): `payment.concurrency.postgres.integration.test.ts` (4 hunks, DEV guard untouched), `payment.stripe.live.test.ts` (adaptation and disposable branch). Not touched: all Codex DEV files, production payment/checkout source, AUTH, CI, migrations. Coordination: Codex-owned files were read, not edited; no concurrent edits to my files were observed.

## 12. Exact future authorization requests

**A–S (Mode A):** *"I authorize one run of `node scripts/payment-pg-disposable.cjs --run` against a throwaway PostgreSQL 17 instance started for this purpose with TLS and a per-run CA (database `electrohub_ci`, role `postgres`, loopback port ____), not the installed PostgreSQL 18 service and not any hosted database. The run creates and drops one marked schema, replays the 17 repository migrations in it, writes only disposable fixtures, and makes no Stripe call. Scope string: `DISPOSABLE:electrohub_ci:scenarios-A-S:fixtures+drop-run-schema`."* The instance can be a local container started with the recipe in `.github/actions/disposable-postgres/action.yml` (Docker is not installed on this machine) or one CI-owner-approved GitHub Actions job (separate job, fresh container; not `backend-test`/`verify-migration`, which migrate into `public`). Per the standing decision, no push before Task 03.6 closure.

**Stripe Test Mode (Mode C), separate:** *"I authorize one run of `node scripts/payment-stripe-disposable.cjs --run` on the proved disposable instance above, using Stripe TEST account `acct_____`, a total authorization allowance of ____ cents, and the operations create, authorize, capture, cancel and refund of PaymentIntents on disposable fixtures only; ambiguous outcomes are to be read back, never replayed; no live key; no PROD."* Exact environment: `PAYMENT_STRIPE_DISPOSABLE_APPROVED=true`, `PAYMENT_STRIPE_DISPOSABLE_EXPECTED_ACCOUNT=acct_…`, `PAYMENT_STRIPE_DISPOSABLE_ALLOWANCE_CENTS=…`, `PAYMENT_STRIPE_DISPOSABLE_AUTHORIZATION=STRIPE-TEST:<account>:<allowance>:DISPOSABLE:electrohub_ci:create+authorize+capture+cancel+refund:disposable-fixtures`, an explicit `STRIPE_SECRET_KEY=sk_test_…`, and the disposable-PostgreSQL variables with authorization `DISPOSABLE:electrohub_ci:stripe-live-suite:disposable-fixtures-owned-ids`. S7 needs its own approval.

## 13. Open items outside this task

- Scenario 1 manual owner acceptance: open.
- Historical HTTP 503 (≈53 s) / 500: root cause unknown; a loopback database cannot reproduce hosted-pooler behaviour; needs an authorized live setup with the existing correlation diagnostics or an owner residual-risk decision.
- Supavisor-specific behavior: Mode B only.
- DEV/PROD 17-migration release: unchanged. DEV 16 applied + AUTH pending (REPORTED/OBSERVED 2026-10-14); PROD NOT VERIFIED; PROD checksums for two historical migrations differ from DEV by approved design; no migration was applied, no historical SQL byte changed (the payment migration remains CRLF), `_prisma_migrations` untouched. Scenario R is disposable-replay evidence only.
- GitHub administrator steps, safe-push authorization, Task 03.6 closure: unchanged.

## 14. Concrete blockers to one real acceptance run

1. **No disposable PostgreSQL 17 + TLS runtime is available here** (Docker absent; the local PostgreSQL 18 service is not a valid target and fails the proof by design). Needs an owner-approved local container or a CI job.
2. **No CI job exists** for the disposable runs (CI-owner approval required; the CI disposable action itself has not run on a runner).
3. **Explicit authorizations** in Section 12 (PostgreSQL run, then separately Stripe).
4. **Authored-but-unexecuted code** (K–S, harness, Mode C edits): compile/lint/discovery/guard evidence only; first-run fixes are expected.
5. For Mode C: Stripe test-account allowance statement, an explicit `sk_test_` key in the runner's environment, and a fresh backend build.


## 15. First controlled acceptance attempt (2026-10-14): NOT EXECUTED

Phase 1 prerequisite check (OBSERVED): none of the six items was supplied. No `PAYMENT_PG_DISPOSABLE_*` or `PAYMENT_STRIPE_*` variable is set; no Docker or Podman exists on this machine; no per-run CA file exists; no `electrohub_ci` instance is listening; the only PostgreSQL is the installed v18 service, which the harness cannot and must not use; no owner authorization text exists. Per the stop conditions **no database-mutating command was run**, no workflow was used, and PostgreSQL 18, DEV and PROD were not touched. Consequently there are **no real per-scenario results, no migration-replay result, no cleanup result and no residual state to report**; PostgreSQL acceptance is NOT complete. The contract is now **A–S (19 scenarios)**; the exact authorization string is `DISPOSABLE:electrohub_ci:scenarios-A-S:fixtures+drop-run-schema`, and the request in section 12 applies with that string.
