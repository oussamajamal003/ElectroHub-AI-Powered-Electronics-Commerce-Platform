# Task 03.6: Integration closure, DEV synchronization and PROD migration readiness

| | |
|---|---|
| Implementation | **CLOSED — ACCEPTED** (Final Architect decision, 94/100) |
| Accepted commit | `a824eb42fe0e3c4663ccf1c7dceac2c8fa2ae490` |
| DEV migration ledger | 19/19 finished |
| PROD migration ledger | 15/19 finished |
| PROD migration execution | **NO-GO**; blockers B1–B5 transferred to the DATABASE, AUTH and Release workstreams |
| Production payment acceptance | **NOT YET APPROVED**; R1–R8 tracked under the production release acceptance process |

Do not reopen the implementation because of the separately gated production work. The release blockers are not unfinished Task 03.6 work unless an investigation establishes an actual regression in the accepted code.

Last updated: 2026-10-17.

## A. Closure record

### Verification at the closed commit
| Evidence | Source | Result |
|---|---|---|
| Development CI, run `39061797904` (10 jobs) | GitHub Actions | **10/10 success**: Frontend Lint/Typecheck/Test/Build, Backend Lint/Typecheck/Test/Build, AI Service Test, Migration Safety Policy |
| Security Audit, run `39061797922` | GitHub Actions | **success** (NPM Audit) |
| Backend / Test in CI | disposable loopback Postgres, every migration applied | unit and integration suites passed |
| Frontend Vitest, local | current source | 719/719 |
| Backend Vitest `src/**` unit, local | current source | 756 passed, 2 skipped |
| Isolated Playwright `failed-payment-dismiss` at 1366 and 390 | disposable stack | 2/2 (see `TASK_03.6_RECURRING_CHECKOUT_ERRORS_AND_ISOLATED_DEV.md`) |

### Test reconciliation
- **Historical failures.** The seven historical Checkout/Try Again unit failures no longer reproduce on the current source.
- **Integration suites.** CI ran the backend integration suites against a disposable database for the first time. That surfaced four obsolete fixtures or mocks:
  - `familyId` in a refresh-token fixture;
  - role provisioning;
  - the supertest cookie-jar handling of the legacy cookie path;
  - the nested cart read.

  These were corrected without weakening any assertion.
- **Regressions fixed** (commits `e1f57d2` and `a824eb4`):
  1. A paid checkout's draft could be re-persisted by a late state update.
  2. Concurrent first-time Google sign-ins could show a spurious "linking required" prompt.

  Both are covered by tests.
- **Not re-run:** the intercepted Chromium scenarios (tracked under R6).

### Accepted financial invariants
These are backed by existing real evidence (earlier authorized runs, not repeated):
- **Try Again** opens a fresh, empty Payment Element, with no automatic submission.
- **Terminal outcomes** are authoritative from the provider.
- **No duplicates:** no duplicate capture, Order or inventory mutation.
- **Webhooks** are verified by signature.
- **Recovery** is fenced by a lease.
- **Cancel purchase** is limited to verified never-confirmed purchases.
- **Payment isolation boundary** is in place.

Stripe Test Mode evidence: `pi_3URYW5…` (decline, then Try Again, then success, 1 order) and `pi_3URZGx…` (never confirmed, then Cancel purchase).

### Release risks (open, NOT fixed, and blocking production payment acceptance)
| ID | Risk | Owner | Gate to close |
|---|---|---|---|
| R1 | Real 3DS challenge completion is not accepted | PAYMENT + FRONTEND | Authorized Test Mode 3DS challenge run, completed end to end |
| R2 | The Stripe 3DS overlay persists during in-app navigation | FRONTEND | Fix plus browser evidence |
| R3 | AUTH refresh-token rotation and session-revocation defect | AUTH | Security concurrency tests plus Architect review |
| R4 | The recovery worker has no supervision or alerting | OBSERVABILITY + PAYMENT | Supervisor, alerting and a runbook in place |
| R5 | Hosted-pooler latency and load-related 503s | PERFORMANCE + DATABASE | Load or latency evidence within budget |
| R6 | Browser acceptance gaps: intercepted Chromium scenarios, and the Payment Element not re-run on the closed source | FRONTEND + INTEGRATION | Scenarios re-run green; authorized Payment Element check |
| R7 | PROD migration parity and production cutover | DATABASE + Architect + Owner | Section D: drift decision, cutover authorization, post-cutover parity |
| R8 | K–S acceptance scenarios not executed | INTEGRATION | Separately approved execution |

## B. Integration record
| | |
|---|---|
| Branch | `feature/Stripe`, pushed to `origin` (github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform), fast-forward from `3d69b97`; no force-push |
| Commits | `a2b4380` (Task 03.6 integration), `e1f57d2` (CI key permissions, paid-draft race, `.gitignore`), `a824eb4` (Google sign-in race, integration-test alignment) |
| CI | run `39061797904` success (10/10); run `39061797922` success. The earlier runs `39058157815` and `39060967984` failed and were fixed as described in A |
| PR, merge, deploy | none |
| Migrations triggered by the push | none on DEV or PROD |

How CI handles migrations:
- `ci.yml` applies migrations only to a loopback disposable Postgres, and asserts the target first.
- `dev-migration.yml` runs only on a gated `workflow_dispatch`.
- No PROD migration or deploy workflow exists.

Excluded from the commits and git-ignored: `.claude/`, `apps/frontend/diag.txt`, `docs/tasks/Phase-03/*REVIEW.patch`, `apps/backend/.isolated/`, and the raw evidence logs.

Every secret-scan match was a placeholder or an offline test fixture.

## C. DEV migration parity
- **Target.** Project `pzxekjybdiulzmssalfo` (`electrohub-dev`, ap-northeast-2), the target of the repository `.env` through the Supabase pooler. `DIRECT_URL` uses the 5432 session pooler.
- **Ledger.** **19/19 finished, with 0 failed or rolled-back rows.** This comes from a fresh read-only Prisma ledger check recorded in the Principal Architect review for `a824eb4`. The implementing agent's own read-only DEV queries were blocked by local permission policy, so this agent did not run that check.
- **Migrations executed during closure:** none.
- **DEV checksum, from the Architect's earlier read-only DEV ledger evidence:** `20261012120000_payment_purchase_ownership` is recorded as `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8`, the CRLF byte form. The committed LF blob is `a45372e2e25895345b7499e6d7d82b852e75a1a5e29b03b8b1fcf53a0f8cc310`. The PROD cutover must pin and verify its intended byte form before execution.
- **Not covered by this record:** the DEV affected-column details (`dismissedAt`, `confirmationStartedAt`).

## D. PROD migration readiness (read-only)
Project `yepfgjehdstlxbpespun` (`electrohub`, ap-northeast-1). Inspected inside `BEGIN READ ONLY`; no write was possible.

**Status: NOT READY. Execution is not authorized.**

| Check | Repository | DEV | PROD | Status |
|---|---|---|---|---|
| Migration count | 19 | 19/19 finished (Architect check) | **15/19 finished**, 0 failed or rolled back | Drift: 4 pending |
| Checksums (applied 15) | see below | not in this record | 14 match a repository byte form | **`20240101000000_database_foundation` drift** |
| `dismissedAt` | `timestamp(3)` NULL | — | absent | Pending |
| `confirmationStartedAt` | `timestamp(3)` NULL | — | absent | Pending |
| Payment schema | includes the 012120 columns | — | 29 columns, without 012120 | Pending |

### Checksum drift: unresolved
- **The drift.** PROD records `20240101000000_database_foundation` as `5de060a3…`, which matches neither repository byte form (`a41f086f…` CRLF, `cb2baf5e…` LF). The file most likely changed after PROD applied it (commit `f3934ed`).
- **Required before any execution:** the DATABASE owner's documented decision on this drift.
- **Not permitted under this authorization:** editing the file, `migrate resolve`, or altering the ledger.
- **Line endings.** `20260925020000_remove_users_phone` is committed as CRLF (`15de2423…`) to match its applied checksum. Prisma hashes raw bytes, and the ledgers mix LF and CRLF forms.

### Pending in PROD, in order
1. `20261012120000_payment_purchase_ownership` (LF blob `a45372e2…`; a CRLF checkout gives `0cf4bc6b…`, so the byte form must be pinned; see the authorization packet): additive nullable columns, a unique index and a CHECK constraint, with short locks.
2. `20261013000000_refresh_token_rotation_lineage` (`51495598…`). **This signs everyone out of PROD.**
   - It revokes and expires every existing PROD refresh token.
   - It sets `familyId` NOT NULL, with `lock_timeout` 10s.
   - It is owned by AUTH and is linked to R3.
   - The global sign-out must be communicated, and accepted by the Owner, before the cutover.
3. `20261015000000_payment_attempt_dismissed_at` (`e124407f…`): adds a nullable column (metadata-only).
4. `20261016000000_payment_attempt_confirmation_started` (`97f32ab9…`): adds a nullable column (metadata-only).

The current GO/NO-GO status (**NO-GO**) and the full cutover plan are in `TASK_03.6_PROD_MIGRATION_AUTHORIZATION_PACKET.md`.

### Cutover prerequisites and plan (execution requires separate authorization naming PROD and these four migrations)
1. The DATABASE owner's drift decision is documented.
2. The Owner accepts the global sign-out.
3. A PITR or backup snapshot is confirmed.
4. **Migrate before the new code ships.** Run `prisma migrate deploy` from an LF checkout through the 5432 session pooler, in a maintenance window with the recovery worker stopped. Expected duration is seconds.
5. **Run parity queries.** The ledger must show 19 finished rows with 0 failed, and the columns and indexes must be present.
6. **Abort criteria:** a lock timeout, a failed ledger row, or a checksum mismatch.
7. **Roll forward only, never `reset`.** Recovery is the snapshot. Reversing the additive columns needs DATABASE approval. Token revocation is irreversible by design.

No PROD write, migration, `migrate resolve`, deploy or merge was performed.
