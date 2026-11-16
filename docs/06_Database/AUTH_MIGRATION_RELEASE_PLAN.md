# AUTH Refresh-Token Migration: Environment Reconciliation and Release Plan

**Dated checksum clarification (2026-10-14):** the original mixed working-copy/committed-blob comparison below is not a guarantee that all historical HEAD blobs match DEV. See the appended checksum clarification and [focused reconciliation](REMOVE_USERS_PHONE_CHECKSUM_RECONCILIATION.md). AUTH source approval is unchanged.

Prepared 2026-10-14. **Nothing in this document was executed against a database except read-only `SELECT`s on DEV. DEV migration: NOT AUTHORIZED / NOT EXECUTED. PROD migration: PREPARED / NOT AUTHORIZED / NOT EXECUTED, PROD not even read.**
AUTH source status: approved by the Principal Architect (93/100); not reopened here.

## 1. Evidence labels
OBSERVED = inspected directly in this task. REPORTED = from another agent/document. NOT VERIFIED = no adequate evidence.

## 2. Environment and tool matrix

| Environment | Supabase MCP | Local connection config (sanitized) | Identity verified | Read-only schema access | Writes authorized |
|---|---|---|---|---|---|
| DEV `pzxekjybdiulzmssalfo` (`electrohub-dev`, ap-northeast-2) | Available (`list_projects`, `list_tables`, `list_migrations`, `execute_sql`, `get_advisors`); used for `SELECT` only | `.env`, `.env.local`, `.env.test.local` all target this ref; `DATABASE_URL` pooled (6543, pgbouncer), `DIRECT_URL` session pooler (5432) | OBSERVED via project metadata (name, region, ref, PostgreSQL 17.6) | OBSERVED, done | **NO** |
| PROD `yepfgjehdstlxbpespun` (`electrohub`, ap-northeast-1) | Available (same tools) | `.env.production.local` (gitignored) targets this ref, same pooled/session-pooler layout | OBSERVED via project metadata (PostgreSQL 17.6) | **Not performed: no PROD read approval** | **NO** |

Operation classes of the Supabase MCP tools: `list_projects`, `get_project`, `list_tables`, `list_migrations`, `get_advisors`, `list_extensions` READ-ONLY; `execute_sql` CAN MUTATE (only `SELECT` was sent); `apply_migration`, `deploy_edge_function`, `create_branch`, `merge_branch`, `reset_branch`, `rebase_branch`, `delete_branch`, `create_project`, `pause_project`, `restore_project` MUTATING / REQUIRE AUTHORIZATION (not invoked). Note `list_migrations` reads Supabase's own history table, not Prisma's `_prisma_migrations`; the Prisma ledger was read with `SELECT` (names, short checksums, state; never log text).

Other sources: Prisma CLI 6.12.0, client 6.12.0 (match). GitHub CI: `.github/workflows` inspected locally (see section 6).

**Configuration hazard (OBSERVED):** a bare `prisma migrate deploy` run from `apps/backend` reads `.env` and therefore targets **DEV by default**, and a PROD-targeted `.env.production.local` sits beside it. Ad hoc local migration commands are forbidden by this plan.

## 3. Local migration inventory (OBSERVED)
17 migration directories, provider `postgresql`. The 16 historical ones are the DEV ledger set; the 17th, `20261013000000_refresh_token_rotation_lineage`, is the only candidate pending migration. Prisma schema and migration SQL for it agree (static test, previously accepted).

Two facts to carry into any release:

1. **Line endings.** Eight historical migrations (`database_foundation`, `authentication`, `email_otp_foundation`, `google_oauth`, `account_deleted_security_event`, `product_foundation`, `product_reviews`, `inventory_nonnegative`) have different SHA-256 on this Windows working copy (CRLF) than in the DEV ledger. From the **committed LF blobs** (`git show HEAD:...`), all eight match the ledger exactly. So there is no modified migration, only a checkout artifact. Prisma must run from a Linux/LF checkout (CI), never this working tree. `.gitattributes` pins `eol=lf` for only two migrations; **the AUTH migration is not pinned**. Required follow-up (owner of `.gitattributes`): see the corrected rule in `CI_MIGRATION_SAFETY_ADMIN_CHECKLIST.md` section 2 (`migration.sql -text`; **not** `eol=lf`, because `payment_purchase_ownership` is a CRLF file whose ledger checksum is the CRLF hash).
2. **Other workstreams' migrations are untracked in Git.** `20261007000000_stripe_orchestration`, `20261009000000_product_test_fixture_visibility`, `20261012000000_storefront_product_visibility`, `20261012120000_payment_purchase_ownership` are applied to DEV (checksums match, section 4) but still untracked locally. Any release branch must contain them or Prisma will see applied migrations missing from the directory.

## 4. DEV reconciliation (OBSERVED, read-only)

| Item | Local expected | DEV observed | Assessment |
|---|---|---|---|
| Migration ledger | 16 applied + AUTH pending | 16 rows, all `finished_at` set, none rolled back, 0 failed | Matches; **AUTH migration not applied** |
| Checksums | LF-blob SHA-256 | 8 recent (`security_events` … `payment_purchase_ownership`) match the working copy; 8 older match LF blobs | No modified migration |
| Pending migrations | exactly 1 (AUTH) | 1 | `migrate deploy` would apply only AUTH, **provided the checkout is the same 17 migrations** |
| `refresh_tokens` columns | + `familyId UUID NOT NULL` (no default), + `replacedByTokenHash VARCHAR(255) NULL` | neither present; 7 columns (`id, userId, tokenHash, expiresAt, isRevoked, createdAt, updatedAt`) | Expected pre-migration state |
| Constraints / indexes | + CHECK, + unique `replacedByTokenHash`, + `familyId` index | PK, FK `userId`→`users` (cascade), indexes `pkey`, `tokenHash` (unique + plain), `userId` | Expected pre-migration state |
| RLS / triggers / dependent views | none required | RLS off, no triggers, no policies, no dependent views | Nothing interferes with the migration |
| Data volume | | 1011 rows (70 active, 699 revoked), 728 kB | Cutover would invalidate **70 active sessions**; locking impact is small (still not measured) |
| Whole-schema parity vs `schema.prisma` | | **NOT VERIFIED**: only `refresh_tokens` and the ledger were inspected; a full drift diff needs a Prisma connection that was not authorized | Open |

## 5. PROD reconciliation

NOT VERIFIED. No production read was approved. Known only from metadata: project identity and region, PostgreSQL 17.6. Earlier project documentation (REPORTED, `MIGRATIONS.md`) says PROD applied `checkout_core` and `stripe_orchestration`; it must not be assumed that PROD has `product_test_fixture_visibility`, `storefront_product_visibility` or `payment_purchase_ownership`. **A PROD `migrate deploy` could therefore apply more than the AUTH migration.** The migration set must be established read-only first.

## 6. CI gate (OBSERVED)

See `REFRESH_TOKEN_MIGRATION_CI_HANDOFF.md`. Unsafe paths: `ci.yml` `backend-test` ("Prisma Migrate Deploy" against `ELECTROHUB_DEV_*`, on pushes to `develop`/`main`/`feature/**`/`fix/**`/`chore/**`/`task/**` and PRs to `develop`/`main`), `dev-migration.yml` (push to `develop` on migration paths, plus manual dispatch), `verify-migration.yml` (manual dispatch). Owner per `AGENT_COORDINATION.md`: Architect + Owner. **CI GATE: IMPLEMENTED LOCALLY (2026-10-14), NOT PUSHED OR RUN; PENDING GITHUB-SIDE ADMIN STEPS (protected Environment, secret relocation, required checks) AND ARCHITECT REVIEW. See the implementation status in the CI handoff.** (Section as of the original assessment: no workflow file had been edited then; the CI-owner task has since edited the three workflows.) **A push or PR containing the AUTH migration is currently unsafe.** Additional requirements for the CI owner beyond the handoff: pin the job to the approved commit SHA and migration list; add a `concurrency` group per target that does not cancel in-progress runs; assert the target project ref (from the database, `SELECT current_database()` plus the pooler's project ref in the URL) equals the environment's approved ref before `migrate deploy`; keep PROD secrets out of any non-approval job.

## 7. Authorization requests (separate, in this order)

### 7.1 CI change (Architect + Owner)
Approve the CI-owner change in the handoff, or explicitly authorize an agent to edit `ci.yml`, `dev-migration.yml`, `verify-migration.yml` (coordinating with the other workstream's existing `ci.yml` diff). Needed before any push.

### 7.2 DEV migration (Project Owner + DATABASE owner + Architect)
To be approved in writing, naming:
- Environment DEV, project `pzxekjybdiulzmssalfo`.
- Migration `20261013000000_refresh_token_rotation_lineage`, SHA-256 `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991` (LF bytes; recompute from the release checkout).
- Pending set: this migration only (re-verify immediately before running).
- Effect: **all 1011 existing refresh-token rows revoked, 70 active sessions ended; every DEV user must sign in again**; access tokens last up to 15 more minutes.
- Executor: the approved release mechanism (a dedicated, environment-gated CI job or an operator on a Linux/LF checkout) with the DEV direct/session connection; never an ad hoc local run from the default `.env`.
- Window: stop-the-world per `REFRESH_TOKEN_LINEAGE.md` section 4 (edge block of `/api/auth/` and `/api/account/`, stop every developer dev server and DEV-connected script, no application connections other than the operator's).
- Backup/recovery: a tested DEV restore point confirmed before starting (Supabase backup availability is NOT VERIFIED here).
- Permitted commands: `prisma migrate status` (before), `prisma migrate deploy`, `prisma migrate status` (after), read-only verification `SELECT`s. Not permitted: `db push`, `migrate reset`, `migrate dev`, `migrate resolve` (needs its own approval), any manual `_prisma_migrations` edit.
- Stop conditions: any unexpected pending migration or ledger state; checksum mismatch; an application connection present; a failed migration (then `migrate resolve --rolled-back` only after confirming the columns are absent, with separate approval).
- Post-run verification: exit code; `migrate status` clean; ledger row finished; `familyId` `NOT NULL` no default; unique `replacedByTokenHash` index; `familyId` index; CHECK present; **zero** active `refresh_tokens`; new build with the regenerated client; test-account smoke (login, refresh, grace retry, logout, replay) with no `P2022`/`23502`.
- Also required first: DATABASE-owner review of the `RefreshToken` schema change; a decision on the DEV-connected `account-deletion.integration.test.ts` fixture (section 8).

### 7.3 PROD read-only (Production Owner)
Approve read-only `SELECT`s on `yepfgjehdstlxbpespun`: Prisma ledger, `refresh_tokens` metadata and counts (no hashes), server version. Needed to produce the PROD parity table.

### 7.4 PROD migration (Production Owner + DATABASE + Architect), only after 7.2 is accepted and 7.3 is reconciled
Independent request with the same fields as 7.2 for PROD, plus: reviewed customer reauthentication impact, tested backup/restore, production schedule, full old-instance drain (Docker Compose backend + Nginx), least-privilege executor, monitoring plan, fix-forward plan. The exact PROD pending set and session count are not known yet.

## 8. Patch hygiene (OBSERVED)

`apps/backend/tests/account-deletion.integration.test.ts`:
- Its only working-tree change is `isTestFixture: true` on a product fixture, which belongs to the storefront/test-fixture workstream, not AUTH. **It is excluded from the AUTH patch** (`docs/tasks/Phase-03/AUTH_REFRESH_LINEAGE_REVIEW.patch` regenerated; 9 files, no `isTestFixture`).
- My earlier report described a `familyId` fixture adjustment in this file. That edit is **not present** in the file (it was lost or overwritten by the concurrent change); the earlier description was inaccurate.
- Consequence: line 47 still creates a `refresh_tokens` row without `familyId`. Once the AUTH migration is applied to the database that test uses, it will fail with `23502`. The owner of that file must add `familyId: crypto.randomUUID()` to the fixture before the DEV migration. Not changed here to avoid mixing concurrent edits.

AUTH-owned patch contents (all accounted for): `auth.repository.ts`, `auth.service.ts`, `auth.service.test.ts`, the `RefreshToken` hunks of `schema.prisma`, the migration SQL, `auth.refresh-concurrency.test.ts`, `helpers/refresh-token-model-db.ts`, `REFRESH_TOKEN_LINEAGE.md`, `REFRESH_TOKEN_MIGRATION_CI_HANDOFF.md`. Earlier AUTH work in `auth.controller.ts`, `jwt.ts` and the frontend auth files is separate and not part of this patch.

## Dated checksum clarification — 2026-10-14 (offline evidence only)

The original reconciliation reported eight working-copy matches and eight committed-LF matches. That mixed-source result must not be generalized to all 12 tracked historical HEAD blobs. Exact offline comparison against the already captured DEV ledger shows **11 of 12** match HEAD; `20260925020000_remove_users_phone` matches the existing **353-byte working copy** (`15de2423e054cfc803989515209340260b5786ce9a4b3b3879b05ede5b81334f`), while index/HEAD contain **352 bytes** (`227201e489fb0d6a4734037e10e0604a3d04505d400d5f47d59d168c2b5ef6e5`). Only the last line ending differs: working copy has six LF endings and one final CRLF; HEAD is all LF. SQL is identical.

The eight older committed-LF matches remain valid. The missing release-source preservation decision for the phone migration is separate from AUTH source approval and migration execution. Current strict CI checksum rejection is correct. An attributes rule alone does not repair the existing committed blob; owners must approve and verify exact deployed-byte preservation in the future release. No database or migration was accessed/executed for this clarification. Original findings above remain historical evidence; [the focused handoff](REMOVE_USERS_PHONE_CHECKSUM_RECONCILIATION.md) records byte identities, origin limits and the proposed owner action.
