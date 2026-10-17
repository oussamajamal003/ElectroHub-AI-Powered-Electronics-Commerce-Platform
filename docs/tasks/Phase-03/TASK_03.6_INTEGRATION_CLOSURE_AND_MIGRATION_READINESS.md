# Task 03.6: Integration closure, DEV synchronization and PROD migration readiness (2026-10-17)

**Implementation phase: CLOSED BY PROJECT OWNER — RELEASE ACCEPTANCE SUBJECT TO TRACKED GATES.**
Principal Architect: 91/100, with controlled integration authorized. Operational and production payment acceptance: **NOT ACCEPTED** (tracked below).

## A. Closure record

### Test reconciliation (current source, offline)

| Suite | Result |
|---|---|
| Frontend Vitest (full) | **719/719 passed**, 96 files |
| Backend Vitest `src/**`, unit and mocked; excludes `*integration*` and `*.live.test.ts` | **756 passed**, 2 skipped |
| Backend `scripts/*.test.cjs` (acceptance, migration-safety and guard tooling) | all passed |
| Typecheck (backend `tsc --noEmit`, frontend `tsc -b`) | clean |
| ESLint (backend `src`, frontend) | clean |
| Frontend production build | OK |
| Isolated Playwright `failed-payment-dismiss` at 1366 and 390 | 2/2 passed (see `TASK_03.6_RECURRING_CHECKOUT_ERRORS_AND_ISOLATED_DEV.md`) |

The seven historical Checkout/Try Again unit failures no longer reproduce. The current suite passes in full, so none needed reclassifying as a regression or an obsolete assertion. The conflicting intercepted Chromium scenarios were not re-run here (they need a running stack).

Integration suites under `tests/**` and the `src/**` `*integration*` suites were not run, because they would target the `.env` database (shared DEV).

### Accepted financial invariants
These are backed by existing real evidence (earlier reports, not re-run):
- **Failed payment:** Try Again opens a fresh, empty Payment Element, and nothing is submitted automatically.
- **Terminal outcomes** are authoritative from the provider.
- **No duplicates:** no duplicate capture, Order or inventory mutation.
- **Webhooks** are verified by signature.
- **Recovery** is fenced by a lease.
- **Cancel purchase** is limited to verified never-confirmed purchases.
- **Payment isolation boundary** is in place.

Real Stripe Test Mode evidence: `pi_3URYW5…` (decline, then Try Again, then success, 1 order) and `pi_3URZGx…` (never confirmed, then Cancel purchase).

### Transferred release risks (open, NOT fixed)
| ID | Risk |
|---|---|
| R1 | Real 3DS challenge completion is not accepted |
| R2 | The Stripe 3DS overlay persists during in-app navigation |
| R3 | AUTH refresh-token rotation and session-revocation defect |
| R4 | The recovery worker has no supervision or alerting |
| R5 | Hosted-pooler latency and load-related 503s |
| R6 | Remaining browser acceptance gaps: intercepted Chromium scenarios, and Payment Element not re-run on the current source |
| R7 | PROD migration parity and production cutover (see D) |
| R8 | K–S acceptance scenarios not executed |

## B. Integration record
**Not pushed.** The current state is described here.
- Branch `feature/Stripe` → `origin` (github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform), base `3d69b97`.
- **CI safety.**
  - `ci.yml` runs on `feature/**` pushes, but applies `prisma migrate deploy` only to a disposable loopback Postgres after asserting the target.
  - `dev-migration.yml` runs only on `workflow_dispatch`, with an approved SHA and a gated environment.
  - No PROD migration or deploy workflow exists.

  A push therefore cannot migrate DEV or PROD, or deploy.
- **Change set.** 425 paths across several workstreams: PAYMENT, FRONTEND, AUTH (refresh lineage), DATABASE (storefront visibility), OBSERVABILITY and CI. `schema.prisma` and the migrations interleave these workstreams, so a "Task 03.6 only" commit is not separable without producing a schema that doesn't match the code.
- **Secret scan.** Every match was a placeholder: `.env.example` `[YOUR-…]`, `sk_test_your`, and offline test fixtures. Paths to exclude: `.claude/`, `apps/frontend/diag.txt`, `docs/tasks/Phase-03/*.patch`, and the raw logs under `docs/tasks/Phase-03/evidence/`. `apps/backend/.isolated/` is already git-ignored.
- **Pending decision:** the commit scope (see the final note).

## C. DEV migration parity
**NOT VERIFIED in this session.**
- **Identity.** The repository `.env` targets project `pzxekjybdiulzmssalfo` (`electrohub-dev`, ap-northeast-2) through the Supabase pooler: `DATABASE_URL` on 6543 (pgbouncer), `DIRECT_URL` on 5432 (session).
- **Blocked reads.** The local permission policy refused both read-only DEV reads I attempted (Supabase `execute_sql` in a read-only transaction, and `prisma migrate status`). No DEV query ran.
- **No migration executed.**
- **Earlier evidence.** The master handoff §173 records `20261016…` being applied to DEV earlier. That is a prior report, not fresh evidence. "DEV: 19/19" is **not** claimed.

## D. PROD read-only readiness
Project `yepfgjehdstlxbpespun` (`electrohub`, ap-northeast-1). The query ran inside `BEGIN READ ONLY`, so no write was possible.

| Check | Repository | DEV | PROD | Status |
|---|---|---|---|---|
| Migration count | 19 | not verified | **15 finished, 0 failed or rolled back** | Drift (4 pending) |
| Checksums (15 applied) | see note | not verified | 14 match a repository byte form | **`20240101000000_database_foundation` drift** |
| `dismissedAt` | `timestamp(3)` NULL | not verified | absent | Pending |
| `confirmationStartedAt` | `timestamp(3)` NULL | not verified | absent | Pending |
| Payment schema | 29+ columns, `submittedAt`/`restoredAt`/etc. | not verified | `payment_attempts` has 29 columns, without the 012120 columns | Pending |

### Checksum note
Prisma hashes raw file bytes. The repository has two byte forms: LF (the git index and Linux CI) and CRLF (the Windows working tree). The PROD ledger mixes both forms, depending on which machine applied each migration.

`20260925020000_remove_users_phone` is applied as CRLF (`15de2423…`). The staged change, which commits that file as CRLF with `-text` in `.gitattributes`, makes the repository match the ledger.

`20240101000000_database_foundation` in PROD is `5de060a3…`, which matches neither repository form (`a41f086f…` CRLF, `cb2baf5e…` LF). The file was most likely edited after PROD applied it (commit `f3934ed`). **Do not edit it, and do not `migrate resolve`.** It needs a DATABASE-owner decision.

### Pending in PROD, in order
1. `20261012120000_payment_purchase_ownership` (`0cf4bc6b…`): additive nullable columns, a unique index on `payment_attempt_items.sourceCartItemId`, and a CHECK constraint. These take short ACCESS EXCLUSIVE locks; the tables are small.
2. `20261013000000_refresh_token_rotation_lineage` (`51495598…`): **revokes and expires every PROD refresh token**, so all users are signed out. It sets `familyId` NOT NULL and uses `lock_timeout` 10s. This is an AUTH-owned change with customer impact (R3).
3. `20261015000000_payment_attempt_dismissed_at` (`e124407f…`): adds a nullable column (metadata-only).
4. `20261016000000_payment_attempt_confirmation_started` (`97f32ab9…`): adds a nullable column (metadata-only).

### Cutover plan (requires separate Owner authorization naming PROD and these four migrations)
1. **Verify.** Take a PITR or backup snapshot. Check the ledger, and confirm `database_foundation` drift is accepted.
2. **Deploy code before columns are used.** The current code needs every column, so deploy the backend only after migrate.
3. **Run the migrations.** Use `prisma migrate deploy` from an LF checkout through the 5432 session pooler, in a maintenance window, with the worker stopped. Expected duration is seconds.
4. **Run parity queries.** Check the ledger shows 19 finished rows, check the columns and indexes, and confirm 0 failed rows.
5. **Abort criteria:** a lock timeout, a failed row, or a checksum mismatch.
6. **Roll forward, never `reset`.** Recovery is the snapshot. Reversing the additive columns is a manual `DROP COLUMN` only with DATABASE approval. Token revocation is irreversible by design.

**No PROD write was performed. PROD execution is not authorized.**
