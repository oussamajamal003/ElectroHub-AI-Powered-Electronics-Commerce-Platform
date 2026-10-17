# PROD Migration Authorization Packet: Task 03.6 release

| | |
|---|---|
| Implementation | **CLOSED — ACCEPTED** (Final Architect decision, 94/100) |
| Accepted commit | `a824eb42fe0e3c4663ccf1c7dceac2c8fa2ae490` |
| DEV migration ledger | 19/19 finished |
| PROD migration ledger | 15/19 finished |
| PROD migration execution | **NO-GO**; blockers B1–B5 transferred to the DATABASE, AUTH and Release workstreams |
| Production payment acceptance | **NOT YET APPROVED**; R1–R8 tracked under the production release acceptance process |

**Decision: NO-GO.** Execution is not safe or authorized. Blockers B1–B5 are open and transferred to the separate production release and migration process.
Prepared 2026-10-17 using read-only verification only. Final Architect decision: 94/100.

No PROD write, migration, `migrate resolve`, `reset`, `db push`, history edit, deploy, commit, push or merge was performed.

## 1. Verified target identity
| | |
|---|---|
| Project | `electrohub` (`yepfgjehdstlxbpespun`), Supabase, ap-northeast-1, Postgres 17.6, status ACTIVE_HEALTHY |
| Not DEV | DEV is `electrohub-dev` (`pzxekjybdiulzmssalfo`, ap-northeast-2), a different project and region |
| Inspection mode | Supabase SQL inside `BEGIN READ ONLY … COMMIT` |
| Ledger (2026-10-17) | 15 finished, 0 failed or rolled back |

## 2. Approved commit
`a824eb42fe0e3c4663ccf1c7dceac2c8fa2ae490` on `feature/Stripe`. CI run `39061797904` passed 10/10 and run `39061797922` passed.

**This is not yet a release commit.** It is unmerged and not on `main`, and the production release commit has not been named (B3).

## 3. Pending migrations: exact checksums at `a824eb4`
Prisma hashes the raw bytes of the file it reads, so the checkout's line endings decide the recorded checksum.

| # | Migration | Committed blob (LF) | Windows CRLF checkout | Effect |
|---|---|---|---|---|
| 1 | `20261012120000_payment_purchase_ownership` | `a45372e2e25895345b7499e6d7d82b852e75a1a5e29b03b8b1fcf53a0f8cc310` | `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8` | Additive nullable columns, a unique index and a CHECK constraint |
| 2 | `20261013000000_refresh_token_rotation_lineage` | `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991` | same (no CR bytes) | **Revokes every refresh token: global sign-out** |
| 3 | `20261015000000_payment_attempt_dismissed_at` | `e124407f979f8825cc33442a5f7a0758037144cc44aca10874d793b56fea21f3` | same | Adds a nullable column |
| 4 | `20261016000000_payment_attempt_confirmation_started` | `97f32ab98dc286955adba6881d661b49434611c5ec037239d7f084781e933a05` | same | Adds a nullable column |

### Finding: migration #1 has an unpinned checksum
- `.gitattributes` doesn't pin its line endings, so its checksum depends on the checkout.
- The disposable acceptance ledger of 2026-10-15 recorded the CRLF form (`0cf4bc6b…`).
- **DEV recorded `0cf4bc6b…`, the CRLF form.** This is read-only DEV ledger evidence from the Principal Architect's earlier verification.

**Before execution:** pin and verify the intended byte form of the PROD run. Matching DEV means the CRLF form `0cf4bc6b…`, not the committed LF blob `a45372e2…`. Pinning `eol` in `.gitattributes` for migrations #1–#4 is a repository change, which needs its own approval.

The 2026-10-17 closure record previously listed `0cf4bc6b…` as the checksum for #1. That is only the CRLF form.

## 4. Foundation checksum drift: decision required (owner: DATABASE)
**Status: UNRESOLVED (blocker B1). No decision has been documented.**

### Evidence
- **PROD ledger.** `20240101000000_database_foundation` has checksum `5de060a3…`, one row, `applied_steps_count` 1. Its `started_at` equals `finished_at` exactly (`2026-09-15 19:21:27.541024+00`).
- **Repository.** The file has a single version in git history (`f3934ed`, committed 2026-09-16). It hashes to `cb2baf5e…` as LF and `a41f086f…` as CRLF; neither matches PROD.
- **Interpretation.** PROD recorded this migration a day before the only committed version existed, so it was applied from a pre-commit draft whose bytes git never recorded. The identical start and finish timestamps are consistent with a baseline or resolve-style ledger entry rather than a timed execution. **This is a hypothesis, not proven.**
- **Schema check (read-only).** Every object the committed file creates exists in PROD: 8 enum types, 15 tables, 41 indexes and 16 foreign keys. That is existence only; column types and defaults were **not** diffed.
- **Runtime impact.** `prisma migrate deploy` does not re-run applied migrations. The mismatch is a history-integrity issue, not an execution blocker by itself. It does block any future `migrate dev` or drift tooling against PROD.

### Options for the DATABASE owner (no action taken)
- **(a)** Accept and document the drift as a known historical baseline. Rewrite nothing.
- **(b)** Require a full column-level schema diff between PROD and the committed file before accepting.
- **(c)** Reject, and escalate.

**Never:** edit the file, run `migrate resolve`, or update the ledger row.

## 5. Global sign-out decision
**Owners: Project Owner (acceptance) and AUTH (gates).**

**Status: NOT OBTAINED (blocker B2).**
- **Impact.** Migration #2 revokes and expires every PROD refresh token, so every user is signed out at cutover.
- **AUTH gates.** The AUTH owner must confirm the R3 (refresh rotation and revocation) security gates, and that the deployed application is compatible: it needs `familyId` in the code that ships alongside.
- **Communication.** Customers need to be told about the sign-out.

## 6. Backup and recovery
**Status: NOT CONFIRMED (blocker B4).**
- This agent could not verify PROD backup or PITR status. The tools available don't expose it, so it is not inferred.
- The operator must confirm a current, restorable PITR or backup.
- The restore procedure must be tested or rehearsed, with a recorded target time.

## 7. Cutover sequence (for the approved window)
1. **GO checkpoint.** B1–B5 are closed and the owners have signed section 9.
2. **Freeze.** Announce the maintenance window and the sign-out. Stop the application instances that are incompatible with the new schema, and **pause the recovery worker**. Confirm there are no in-flight `payment_work` leases (read-only query).
3. **Snapshot.** Record the PITR point, or take a snapshot.
4. **Pre-check (read-only).** The ledger must show 15 finished and 0 failed, and the 4 pending names must match section 3. There must be no long-running transactions and no locks on `payment_attempts`, `payment_attempt_items` or `refresh_tokens`.
5. **Migrate.** Run `prisma migrate deploy` from the approved release commit in the pinned checkout byte form, via `DIRECT_URL` (session pooler 5432), in order #1 → #4.
6. **Verify** using section 8.
7. **Deploy** the compatible application, then resume the worker.
8. **Smoke test:** login, session refresh, Cart, a checkout read path, and webhook signature verification. Use no live payments unless separately authorized.
9. **Close the window.**

### Abort criteria
Abort on any of these:
- the lock timeout is exceeded (migration #2 sets 10s);
- any ledger row is unfinished or rolled back;
- a checksum differs from the pinned value;
- the pre-check shows unexpected pending migrations or active payment leases;
- verification fails.

On abort, keep the application on the previous version, do **not** run `migrate resolve` or `reset`, and restore from the snapshot only on DATABASE plus Owner decision.

## 8. Post-migration verification queries (read-only)
```sql
-- Ledger: expect 19 rows, 0 bad, and the pinned checksums for the 4 new rows.
select migration_name, checksum, finished_at is not null as finished, rolled_back_at
from _prisma_migrations order by migration_name;
select count(*) filter (where finished_at is not null and rolled_back_at is null) as ok,
       count(*) filter (where finished_at is null or rolled_back_at is not null) as bad
from _prisma_migrations;

-- Columns: expect timestamp(3) nullable / varchar / uuid as declared.
select table_name, column_name, data_type, is_nullable, character_maximum_length
from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'payment_attempts' and column_name in ('submittedAt','restoredAt','notificationReadState','dismissedAt','confirmationStartedAt'))
  or (table_name = 'payment_attempt_items' and column_name in ('sourceCartItemId','snapshotCartItemId'))
  or (table_name = 'refresh_tokens' and column_name in ('familyId','replacedByTokenHash')));

-- Indexes and constraints.
select to_regclass('public."payment_attempt_items_sourceCartItemId_key"'), to_regclass('public."refresh_tokens_familyId_idx"'),
       to_regclass('public."refresh_tokens_replacedByTokenHash_key"');
select conname from pg_constraint
where conname in ('submitted_purchase_releases_active_cart', 'refresh_tokens_no_self_replacement_check');

-- Global sign-out took effect (expect 0 active pre-cutover tokens).
select count(*) from refresh_tokens where "isRevoked" = false and "expiresAt" > now() and "createdAt" < '<cutover start>';
```

## 9. GO/NO-GO record
| Gate | Owner | Status |
|---|---|---|
| B1: foundation drift decision (section 4) | DATABASE owner | **OPEN** |
| B2: global sign-out acceptance, and AUTH R3 and compatibility gates (section 5) | Project Owner + AUTH owner | **OPEN** |
| B3: production release commit named; checksums pinned and DEV form confirmed (sections 2–3) | Release owner + DATABASE | **OPEN** |
| B4: PITR/backup confirmed and recovery rehearsed (section 6) | DATABASE / operations | **OPEN** |
| B5: auth, checkout, webhook and worker release readiness, with R1–R8 not treated as passed | PAYMENT + AUTH + release owner | **OPEN** |
| Separate PROD execution approval | Project Owner + Architect | Not given |

## 10. Remaining risks
- **R1–R8 remain open** (see the closure record). In particular:
  - R3 (AUTH refresh rotation) is coupled to migration #2;
  - R4 (worker supervision) affects the pause and resume steps;
  - R5 (pooler latency) affects migration lock timing.
- **Production payment acceptance is NOT approved.**

**Is execution safe now? No: NO-GO.**
