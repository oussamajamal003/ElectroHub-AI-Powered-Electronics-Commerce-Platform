# Task 03.6 — PROD cutover: consolidated GO/NO-GO record

| | |
|---|---|
| Production target | `electrohub` (`yepfgjehdstlxbpespun`), Supabase ap-northeast-1 |
| PROD ledger (from the authorization packet, 2026-10-17) | 15/19 finished, 0 failed |
| Implementation | CLOSED — ACCEPTED (94/100). Not reopened. |
| This record | Prepared by Claude Code. **No PROD access was used or available; nothing was written to PROD, DEV or Stripe.** |
| **Decision** | **NO-GO** — five owner decisions/evidence items below remain genuinely unavailable. Everything that could be verified without them has been verified. |

Evidence classes used here: **LOCAL** = computed from the repository or a disposable local PostgreSQL 17 (scratch databases created and dropped by me); **CARRIED** = taken from the packet / Principal Architect's earlier read-only checks and NOT re-verified here; **NOT VERIFIED** = no source available to me.

## 1. What I verified independently (Phase 1)

### 1.1 Accepted commit and release revision (B3)
- LOCAL: `HEAD` = `a824eb42fe0e3c4663ccf1c7dceac2c8fa2ae490` on `feature/Stripe`; it equals the accepted commit and is on `origin/feature/Stripe`.
- LOCAL: it is **not on `main`**; `main`'s `origin` tip is `f284574d…`, and the branch is 142 commits ahead. **No production release commit has been named.** Releasing an unmerged feature commit to production is not something I may assume approved.
- LOCAL: the working tree has about 419 uncommitted/untracked entries (other workstreams, cleanup passes, this task). A release artifact must be built from a clean checkout of the named SHA, not from this working tree.

### 1.2 Pending-migration checksums and byte forms (B3)
`docs/tasks/Phase-03/prod-cutover/verify-migration-artifact.cjs` (offline, file reads only) computes SHA-256 of the exact bytes of the four pending migrations and checks order. LOCAL result on this checkout: all four match the pinned values, order correct, the four are the last four of 19 folders.

| # | Migration | Pinned SHA-256 (exact file bytes) | Notes |
|---|---|---|---|
| 1 | `20261012120000_payment_purchase_ownership` | `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8` (CRLF form) | The committed git blob is LF `a45372e2…cc310`. `.gitattributes` does not pin it (`git check-attr eol` = unspecified), so a Linux checkout or CI produces `a45372e2…`, which the verifier **rejects** (negative test run). |
| 2 | `20261013000000_refresh_token_rotation_lineage` | `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991` | No CR bytes. |
| 3 | `20261015000000_payment_attempt_dismissed_at` | `e124407f979f8825cc33442a5f7a0758037144cc44aca10874d793b56fea21f3` | |
| 4 | `20261016000000_payment_attempt_confirmation_started` | `97f32ab98dc286955adba6881d661b49434611c5ec037239d7f084781e933a05` | |

- CARRIED, not re-verified: the DEV ledger recorded `0cf4bc6b…` for #1. I have no authenticated read access to the DEV or PROD ledger in this session (the Supabase connector is unauthenticated and I did not use any environment file). Whoever runs the pre-check must re-read DEV's `_prisma_migrations.checksum` for #1.
- Release-artifact procedure (reproducible, modifies no applied migration): check out the named SHA; make migration #1 byte-identical to the pinned CRLF form (or have the release owner and DATABASE decide on the LF form, which would mean a different PROD checksum than DEV and must update the pinned table in a reviewed change); run `node docs/tasks/Phase-03/prod-cutover/verify-migration-artifact.cjs <checkout>/apps/backend/prisma/migrations`; require `ok: true`; record the SHA-256 of the verifier output with the GO record. Pinning `eol` for #1–#4 in `.gitattributes` is a repository change that needs its own approval; I did not make it.

### 1.3 Full-schema drift check for `database_foundation` (B1)
What I built so the DATABASE owner can close B1 without guessing:
- `readonly-schema-introspection.sql`: one read-only query returning enums, every column (type, nullability, default, identity, generated), every constraint definition and every index definition of schema `public`, no row data.
- `compare-schema.cjs`: offline comparison of two such documents.
- `reference-schema-after-15-migrations.json`: the schema produced by applying the 15 migrations PROD has finished (all except the four pending) in order to a fresh scratch database, from the repository files. 18 enums, 280 columns, 74 constraints, 112 indexes. `reference-schema-after-19-migrations.json`: after all 19.
- LOCAL tool validation: the comparison of the 15-reference against the 19-reference reports exactly 14 differences: 9 added columns, 2 constraints, 3 indexes, which are precisely the objects of the four pending migrations (matches the packet's section 8 verification list). The comparison therefore detects drift, and nothing else changes between 15 and 19.
- LOCAL: `prisma migrate diff` of the 19-reference against `schema.prisma` shows no added or removed objects, only 7 columns where the database keeps a default that `schema.prisma` does not model (`id gen_random_uuid()` on 5 tables, `updatedAt now()` on 2). This is a pre-existing, benign modeling difference unrelated to the four migrations.

**Not done, and why:** I could not read PROD, so the actual PROD-versus-reference comparison has **not** been performed. Required step (read-only, DATABASE owner or an operator with a read-only PROD role): run the introspection SQL inside `BEGIN READ ONLY … COMMIT` on PROD, save the output as `prod-observed-schema.json`, then run `node compare-schema.cjs reference-schema-after-15-migrations.json prod-observed-schema.json`. `identical: true` closes the schema half of B1 (the packet's earlier check covered only object existence). Any difference is the precise drift list for the owner. The ledger-checksum half (PROD `5de060a3…` vs the repository's `cb2baf5e…` LF / `a41f086f…` CRLF) remains a documented-history question that only the DATABASE owner can decide (options a/b/c in the packet); never edit the file or the ledger row.

### 1.4 Backup / PITR (B4)
NOT VERIFIED. No approved operational source is available to me. I am not claiming a backup exists. The operator must supply: the PITR/backup reference or snapshot ID, the earliest and latest restorable timestamps, the planned restore target time, and the evidence of a restore rehearsal. Nothing may start without this.

### 1.5 Cutover plan (concrete, supersedes nothing in the packet's section 7)
Dependencies established from the code and migration text:
- **Order is forced:** the new application selects `submittedAt`, `restoredAt`, `dismissedAt` and the refresh-token `familyId` columns, so it cannot run before the migrations; the old application cannot refresh sessions after migration #2 (`familyId NOT NULL`, no default makes its INSERT fail closed). So: stop old → migrate → deploy new. Downtime across the window is inherent.
- **Confirmation signal column:** `PAYMENT_CONFIRMATION_SIGNAL` stays `false` (the column is omitted from every query) until migration #4 is applied AND the new release is serving; only then may it be set to `true`. Setting it earlier would break every payment query.
- **Maintenance mode / incompatible instances:** the release owner stops every old API instance and any dedicated payment worker, and holds traffic (maintenance page) for the window. Recovery also runs in-process inside each API process, so stopping the API pauses recovery; set `PAYMENT_INPROCESS_RECOVERY=false` on the new release until the worker pause is lifted.
- **Payment lease verification (read-only, before migrating):** `select count(*) from payment_work where state = 'LEASED' and "leaseUntil" > now();` must be 0; also record counts of `payment_attempts` by state so the post-check can show data preserved.
- **Webhook preservation:** Stripe retries failed deliveries, so leave the endpoint refusing (503) or unreachable during the window instead of acknowledging events the old code cannot process; after deploy confirm `stripe_events` dedupe by event id and that signature verification still passes. No live payments in the smoke test.
- **Refresh-token invalidation:** migration #2 revokes every existing refresh token (global sign-out, `expiresAt` = epoch; access tokens live up to 15 minutes). Customers must be notified.
- **Lock behavior:** #2 sets `lock_timeout = '10s'` and takes an `ACCESS EXCLUSIVE` lock on `refresh_tokens` for the `SET NOT NULL` scan; run only with the application stopped. A lock-timeout failure rolls the transaction back but Prisma records a failed row: that state needs DATABASE to confirm the columns are absent and decide on `migrate resolve --rolled-back`, which this plan does not authorize.
- **Rollback / roll-forward authority:** keep the old release on abort; database restore only by joint DATABASE and Project Owner decision from the confirmed snapshot; roll-forward (hotfix) authority to be named by the release owner. The packet's abort criteria stand.
- **Post-migration verification:** the packet's section 8 queries, plus `compare-schema.cjs` of PROD against `reference-schema-after-19-migrations.json` (expect `identical: true`), plus row-count parity of `users`, `orders`, `payment_attempts`, `refresh_tokens`.

### 1.6 AUTH assessment of R3 (B2)
NOT OBTAINED. I cannot sign for AUTH. Technical facts for them to rule on: migration #2 contains no logic bug that I can see in the text (revoke, single-row families, NOT NULL, check, two indexes, in one transaction with a 10 s lock timeout), and its legacy-token revocation removes the lineage ambiguity the R3 defect concerns. That is a statement about the database change only. R3 itself is a defect in refresh rotation and revocation behavior of the application; a passing migration does not close it, and the AUTH owner must state whether the proposed release's rotation code is acceptable to ship together with this migration.

### 1.7 R1–R8 classification (needs owner acceptance; none waived by me)
| Risk | Blocks this database cutover? | Reason |
|---|---|---|
| R3 AUTH rotation defect | **Yes** (coupled) | Migration #2 changes the session model; shipping it with an unresolved rotation defect would carry the defect into production. |
| R4 worker has no supervision | **Yes** (for the pause/resume steps and the window) | The plan depends on reliably pausing and resuming recovery and confirming no leases. |
| R5 pooler latency | **Yes** (lock timing) | Affects whether #2 completes within its 10 s lock timeout; use the direct/session connection and a quiet window. |
| R7 PROD parity/cutover | **Yes** (is this task) | |
| R1 real 3DS not accepted | No, independently blocks later payment activation | Additive columns only; no payment path is enabled by the migration. |
| R2 3DS overlay navigation | No, blocks payment activation | |
| R6 browser acceptance gaps | No, blocks payment activation | |
| R8 K–S scenarios not executed | No, blocks payment activation | |

Rationale for the "No" rows: the four migrations add nullable columns, two indexes and constraints and one revocation; they do not enable Stripe in production. Acceptance of this split must come from the responsible owners; unsigned until then.

## 2. Consolidated approval record (Phase 2) — all unsigned

I did not sign or pre-fill any statement. Each owner supplies their own line.

| Gate | Owner | Evidence now available | Statement required | Status |
|---|---|---|---|---|
| B1 foundation drift | DATABASE owner | Reference schemas, introspection SQL, compare tool (LOCAL); packet evidence (CARRIED) | Accept/reject option a, b or c, and approve the migration artifact | **UNSIGNED** |
| B2 global sign-out | Project Owner | Migration text states every session is invalidated | "I acknowledge all existing PROD sessions will be revoked." | **UNSIGNED** |
| B2 AUTH security/compat | AUTH owner | Section 1.6 facts | R3 acceptance for this release and compatibility of the proposed code | **UNSIGNED** |
| B3 release | Release owner | HEAD `a824eb4` on `feature/Stripe`, not on `main`; verifier and pinned table | Production SHA, artifact (including #1 byte form), maintenance window, deployment readiness | **UNSIGNED, SHA not named** |
| B4 backup | DATABASE / Operations | None available to me | Backup/PITR reference, restore evidence, named operator | **UNSIGNED, no evidence** |
| B5 coordination | PAYMENT + AUTH + Release | Sections 1.5 and 1.7 | Safe worker, webhook and app coordination; acceptance of the R1–R8 split | **UNSIGNED** |
| Execution authorization | Project Owner + Architect | — | Explicit authorization to run exactly the four migrations in order | **NOT GIVEN** |

## 3. Decisions and evidence still needed (only what I cannot produce)
1. DATABASE owner: run the introspection SQL read-only on PROD and the comparison; decide the foundation checksum option (a/b/c).
2. DATABASE owner / Release owner: re-read DEV's ledger checksum for #1, confirm the pinned form for PROD.
3. Release owner: name the production SHA (a merged commit or a justified tag) and the maintenance window.
4. Operations: backup/PITR reference and restore rehearsal evidence.
5. AUTH owner and Project Owner: the R3 ruling and the sign-out acknowledgement.
6. Project Owner + Architect: the separate execution authorization.

## 4. Phases 3 and 4
**Phase 3 not executed.** B1–B5 are not closed and no execution authorization exists; I also have no PROD access in this session. Nothing was run against PROD: no `migrate deploy`, `resolve`, `reset`, `db push` or ledger edit. **Phase 4 not applicable** — there is no post-migration state to verify; I make no completion claim. Verdict: **NO-GO**, gated only on items 1–6 above.

## 5. Files added (all under `docs/tasks/Phase-03/prod-cutover/`)
`readonly-schema-introspection.sql`, `compare-schema.cjs`, `verify-migration-artifact.cjs`, `reference-schema-after-15-migrations.json`, `reference-schema-after-19-migrations.json`. Scratch databases `prod_ref_15` and `prod_ref_19` exist only on the local disposable PostgreSQL 17 instance.

---

# Update 2 — count reconciliation, rehearsal and readiness (same day)

Task 03.6 stays CLOSED. No PROD, DEV or Stripe access or write. All results below are **LOCAL** (disposable PostgreSQL 17 on this machine; scratch databases `prod_ref_15`, `prod_ref_19`, `prod_prisma_15`, `rehearse_cutover`) unless marked CARRIED.

## U2.1 Count reconciliation (your PROD figures: 18 enums, 288 columns, 75 constraints, 113 indexes)
My earlier 15-migration reference (18 / 280 / 74 / 112) deliberately **excluded Prisma's ledger table `_prisma_migrations`**, and its scratch databases were built from raw SQL so that table never existed. The ledger table has exactly 8 columns (`id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count`), one primary-key constraint and one primary-key index. 280+8 = 288, 74+1 = 75, 112+1 = 113, enums 18 = 18.

Proof, not arithmetic: I applied the same 15 migrations with the real `prisma migrate deploy` (ledger 15 finished, 0 failed) and introspected with the ledger included (`-v include_ledger=on`): **18 enums, 288 columns, 75 constraints, 113 indexes**, identical to your PROD counts. With the ledger excluded the same database gives 18/280/74/112, and the exact comparison against the raw-SQL reference is `identical: true`. The introspection SQL now takes `-v include_ledger=off|on`, so both scopes are reproducible. Evidence files: `scratch-prisma15-ledger-off.json`, `scratch-prisma15-ledger-on.json`.

**What this does and does not establish.** Equal counts on all four categories make a large structural difference unlikely, but counts cannot show a different column type, default, nullability or index definition. The exact comparison against PROD needs PROD's introspection document, which I do not have. I was given counts only. The exact, and only remaining, step is: run `readonly-schema-introspection.sql` on PROD with `-v include_ledger=on` inside `BEGIN READ ONLY … COMMIT`, save it as `prod-observed-schema.json`, and run `node compare-schema.cjs scratch-prisma15-ledger-on.json prod-observed-schema.json`. Until that returns `identical: true`, **material schema discrepancies are unverified, not ruled out**, and the foundation checksum drift (`5de060a3…` in PROD versus `cb2baf5e…` LF / `a41f086f…` CRLF in the repository) is not assumed harmless.

## U2.2 Full cutover rehearsal on a copy of the 15-state schema
`prod_prisma_15` (Prisma-applied 15, real ledger) was seeded with one role, one user and two active legacy refresh tokens, cloned to `rehearse_cutover`, and the real `prisma migrate deploy` was run from the repository (19 migrations found; the four pending applied in order; success).

| Check | Result |
|---|---|
| Ledger | 19 finished, 0 failed or unfinished |
| Recorded checksums of the 4 new rows | `0cf4bc6b88a2…`, `51495598e0e1…`, `e124407f979f…`, `97f32ab98dc2…`: equal to the pinned values (migration #1 recorded in its CRLF form, as DEV did) |
| Structure after migration vs the 19-migration reference | `identical: true` |
| Data preserved | 1 user, 1 role unchanged |
| Legacy sessions | 2 of 2 revoked, none active; `familyId = id` and `expiresAt` = epoch for all |
| Old-application insert into `refresh_tokens` (no `familyId`) | rejected: not-null violation (fails closed, as designed) |
| Current backend client against the 15-state schema | **fails** on payment queries (columns missing), with the confirmation signal flag unset and set: the new release cannot run before the migrations |
| Current backend client against the 19-state schema | works, flag unset and set |

Conclusion (rehearsal only): stop old, migrate, deploy new is the only workable order; the four migrations apply cleanly under Prisma from a 15-state schema.

## U2.3 AUTH compatibility (R3) — evidence and one open observation
Real AuthService run against the migrated rehearsal database (login, refresh, logout through the application code; local-only guard in the probe refuses any other target):
- login issues a refresh token and stores a row with a `familyId`, active.
- 8 concurrent refreshes of one token: exactly one rotation wins (1 winner, 7 accepted concurrent losers with no new refresh token, 0 rejected); rotation keeps one family (2 rows).
- logout revokes the session's family and leaves other families active.
- Unit/model suites `auth.refresh-concurrency`, `auth.service` and `auth.controller`: 83 passed (these use a model database, not PostgreSQL).

**Open observation (not a pass):** after a rotated token had been replaced, presenting the **old token again** returned a fresh access token with no new refresh token and did **not** revoke the successor (1 of 2 rows revoked, the successor still active). That is the "concurrent loser" path the service accepts when an active successor exists; it cannot tell a real race from a later replay. Whether that is acceptable is exactly the R3 question for the AUTH owner. The migration is compatible with the code; the refresh-replay semantics are an application-security decision this record cannot make, so **AUTH security compatibility stays unverified until the AUTH owner rules on it**. A passing database rehearsal does not bypass it.

## U2.4 Recovery readiness
- Worker/webhook/application coordination: sequence and constraints are in section 1.5 and now verified against the rehearsal (old app fails closed; new app needs all four migrations; `PAYMENT_CONFIRMATION_SIGNAL` stays off until migration #4 and the new release are live).
- Backup/PITR: **still not verified** (no source available to me). The cutover must not start without the operator's backup reference, restorable window and rehearsal evidence.

## U2.5 Final execution readiness report
| Gate | State |
|---|---|
| Migrations apply cleanly in order (Prisma, 15 to 19, checksums as pinned, schema parity with reference, data preserved, sign-out effect as designed) | **VERIFIED locally** |
| PROD ledger 15/0 and DEV #1 checksum CRLF | CARRIED from the Architect's read-only check |
| PROD structural match | counts reconciled exactly; **type/default/constraint comparison NOT performed** (needs PROD introspection JSON) |
| Foundation checksum drift decision | **OPEN** (DATABASE owner) |
| Backup/PITR recoverability | **NOT VERIFIED** |
| AUTH security compatibility (R3, refresh replay) | **NOT VERIFIED** (observation above) |
| Production SHA named; maintenance window; execution authorization | **NOT GIVEN** |

**Execution readiness: NOT READY. No PROD migration was executed, and none should be until backup recoverability, the exact PROD schema comparison and the AUTH ruling are in.** The technical preparation (artifact verifier, introspection and comparison tools, rehearsal) is complete; the remaining gates are evidence only the operators can supply.

New files in `docs/tasks/Phase-03/prod-cutover/`: `scratch-prisma15-ledger-off.json`, `scratch-prisma15-ledger-on.json`, `scratch-rehearsal-after-migrate.json`; the introspection SQL gained `include_ledger`.


---

# Update 3 — AUTH R3 fixed and verified; remaining blockers (same day)

Task 03.6 stays CLOSED. No PROD, DEV or Stripe access or write. Evidence is LOCAL (a freshly created disposable PostgreSQL 17, migrated 15 to 19 with the real `prisma migrate deploy`, 19 finished) unless marked.

## U3.1 R3 defect analysis
Confirmed in code: `refreshSession` accepted a **superseded** (already rotated) token, inside a 10-second window, when its direct successor was still active, and minted a **new access token** from it (`refreshToken: null`). Possession of the old token alone therefore authenticated, with no revocation and no signal to the victim. The same path was reached when a request lost the atomic rotation race. Outside the window, reuse revoked **every** session of the user (all devices), and the "successor is active" lookup was the only boundary. Timing alone cannot distinguish a harmless browser race from theft, so a successor lookup is not an authorization boundary.

## U3.2 Fix (security semantics as implemented)
- **A superseded token never authenticates on its own and never receives any token.** Inside the 10-second window, when the token was rotated (rotation pointer present) and its session family is still alive, the request gets **HTTP 409 `REFRESH_ROTATION_IN_PROGRESS`** with `Retry-After: 1`: no access token, no refresh token, no revocation, no cookie change. A request that loses the atomic rotation race gets the same 409 (or 401 if the family is already dead). Duplicate successors remain impossible (rotation is conditional and runs under the user lifecycle lock).
- **Reuse is family-scoped.** Anything else (outside the window, no rotation pointer, or a dead family) is reuse: 401 `REFRESH_TOKEN_REUSED`, and the replayed token's **session family** is revoked; other devices of the user are untouched. A harmless concurrency event revokes nothing.
- **Unchanged and re-verified:** logout (family revoke, expiry in the past), password change and reset (all sessions), account deactivation (refresh refused), session issuance versus revocation locking.
- **Frontend:** the single-flight refresh now treats a 409 as "another request rotated this session": it waits 250, 600 and 1200 ms and retries up to three times so the browser re-reads the cookie the winner set, then surfaces a failure without signing the user out. Cross-tab races are the only case that reaches it, since one tab already single-flights. The 409 path does not clear the cookie.
- Files: `auth.service.ts` (`CONCURRENT_ROTATION_WINDOW_MS`, revoked branch, lost-race branch), `auth.repository.ts` (`hasActiveFamilyToken`), `auth.controller.ts` (409 mapping), `apps/frontend/src/lib/api.ts`, plus their tests. Review artifact: `prod-cutover/r3-refresh-replay.patch` (SHA-256 `a0c1167e2c5cff11585dec153593a3ee75d79824f9035047ef9cb3f39d5c6018`, 8 files, a diff against the accepted commit `a824eb4`).

## U3.3 R3 test evidence
- Real PostgreSQL (migrated 19/19), real `AuthService`, 14 checks, 14 PASS:
  - 8 concurrent refreshes of one token give 1 winner and 7 losers with 409 and no token; one successor; the session stays alive.
  - Immediate stolen-token replay gets 409, revokes nothing, and the legitimate holder keeps refreshing.
  - Delayed replay gets 401 `REFRESH_TOKEN_REUSED`, revokes the compromised family including its successor, and does not revoke another device.
  - Logout raced with refresh leaves no usable token in that family and keeps the other session.
  - Password change leaves 0 active tokens and a refresh is refused; a deactivated account cannot refresh (401 `USER_INACTIVE`).
- Focused tests: 9 new `refreshSession` unit tests (concurrent 409, immediate replay yields no token, delayed replay family-scoped, no-pointer reuse, dead family, expired by logout, lost race 409 and 401, normal rotation); model-database tests rewritten and extended (one winner and a 409 loser, immediate replay, family-scoped delayed replay, a revoked family cannot be refreshed by the successor holder, logout racing refresh, lost-acknowledgement retry); 1 controller test (409 with Retry-After and no cookie change); 2 frontend client tests (retry with the winner's cookie; bounded retry without sign-out).
- Backend: tsc and eslint clean; 640 tests passed (55 skipped) across services, controllers and payment routes. Frontend: tsc and eslint clean; api tests 14 passed.
- The previous grace-window tests encoded the defective behavior and were replaced, not left passing.

**Residual semantics, stated plainly:**
1. A thief who replays within 10 seconds gets only a 409; one who replays later revokes the shared family and signs the victim out. That is detection, not prevention of a token stolen before its first rotation.
2. A client that loses the response to its own successful rotation keeps the old cookie, gets 409 inside the window, and is signed out once the window passes. It receives no token on a superseded credential.
3. There is still no client binding (IP or user agent). Adding it needs stored context and was not done.

**AUTH owner sign-off on these semantics is still required; this record does not sign for AUTH.**

## U3.4 Other blockers
- **PROD exact structural comparison:** not performed. I have no PROD access, and the only PROD data I hold is your four counts, which are reconciled in U2.1. The prepared steps stand: run `readonly-schema-introspection.sql` with `-v include_ledger=on` read-only on PROD and compare against `scratch-prisma15-ledger-on.json` with `compare-schema.cjs`. Evidence gap: the PROD introspection document.
- **Foundation drift:** no new evidence. PROD ledger `5de060a3…` versus repository `cb2baf5e…` (LF) / `a41f086f…` (CRLF) is unchanged and unexplained beyond the packet's hypothesis; matching object counts do not prove matching definitions. Not concealed: no `migrate resolve`, no history edit. The decision stays with the DATABASE owner after the exact comparison.
- **Backup/PITR:** NOT VERIFIED. No approved source is reachable from this session. Needed from the operator: backup/PITR reference, restorable window, restore procedure and rehearsal evidence.
- **Release revision:** the tracked difference between the accepted commit `a824eb4` and the working tree is exactly the R3 patch (8 files) plus one edited document; the only untracked files are these cutover documents. A release revision is therefore `a824eb4` plus the R3 patch. **I did not commit, branch or push**; the Release owner must create and name that revision.
- **Migrations and plan:** the four pending migrations, the CRLF-pinned #1 checksum, the ordering, stop-old then migrate then deploy-new, and `PAYMENT_CONFIRMATION_SIGNAL` off until schema and application are compatible are unchanged and were verified by the earlier rehearsal.
- **Environment note:** my earlier scratch PostgreSQL clusters and scripts were deleted by something external while the disk sat at 100 percent, so the first rehearsal databases no longer exist. Their results are recorded above and the R3 probe was re-run on a fresh disposable cluster. The reference schema documents in `prod-cutover/` are intact.

## U3.5 Final disposition
| Item | State |
|---|---|
| R3 replay defect | **Fixed and verified** locally (real PostgreSQL, unit, model, controller, frontend); AUTH owner acceptance pending |
| PROD exact schema comparison | **Not performed**: needs the PROD introspection output |
| Foundation drift | **Open**: DATABASE owner decision |
| Backup/PITR | **Not verified** |
| Release revision | Not created: `a824eb4` plus the R3 patch, to be named by the Release owner |
| Execution authorization | **Not given** |

**GO/NO-GO: NO-GO.** The remaining gates are evidence and decisions outside this session: the PROD introspection comparison, the foundation drift decision, backup/PITR proof, AUTH acceptance of the R3 semantics, the named release revision, and explicit execution authorization. No PROD migration was or will be run on the basis of this record.


---

# Update 4 — Final readiness report (release candidate, PROD parity, backup, compatibility)

Task 03.6 stays **CLOSED**. This update used the authorized Supabase connector for **read-only SELECT queries on PROD** (`yepfgjehdstlxbpespun`) and the earlier local evidence. No PROD write, `migrate resolve`, `reset`, `db push`, history edit, Stripe live action, staging, commit, push or deployment occurred.

## A. R3 final review
Reviewed the actual diff and the surrounding code (`auth.service.ts` revoked and lost-race branches, `auth.repository.ts` `rotateRefreshToken`, `revokeRefreshTokenFamily`, `hasActiveFamilyToken`, `auth.controller.ts`, `apps/frontend/src/lib/api.ts`). Confirmed: a superseded token never receives an access or refresh token (409 carries neither); rotation stays conditional under the user lifecycle lock, so duplicate successors cannot be created; reuse outside the window revokes only the replayed family; logout (expired-by-epoch rows are rejected before the reuse branch), password change and reset (user-wide), and deactivation (401 `USER_INACTIVE`) are unchanged; the 409 path does not clear the cookie.

**One concrete defect found and fixed in this pass:** the server sent `Retry-After: 1` but the frontend retried after 250 ms, contradicting the contract. The client now treats Retry-After (seconds) as a floor, capped at 5 s: first retry waits at least 1 s, schedule 250/600/1200 ms otherwise, at most three retries. Test added: no retry before the advertised second; bounded retries still surface a failure without a sign-out. Cross-tab behavior: a tab that loses the race retries and reads the cookie the winning tab set; one tab already single-flights its own refreshes. Residual semantics are unchanged from Update 3 (detection not prevention for a token stolen before first rotation; a lost acknowledgement ends in re-login after the window; no client binding). Evidence reused: real-PostgreSQL 14/14 (Update 3). Newly run: frontend `src/lib`, `src/features/auth`, `src/components/layout` 106 passed; backend tsc and eslint clean; frontend tsc and eslint clean.

## B. Release candidate
The accepted commit `a824eb4` does **not** contain R3. The tracked delta of the working tree against `a824eb4` is exactly 8 source files plus one edited document and nothing else; the only untracked files are the cutover documents and scripts.

| File | Role |
|---|---|
| `apps/backend/src/services/auth.service.ts` | superseded-token handling, 409 and family-scoped reuse |
| `apps/backend/src/repositories/auth.repository.ts` | `hasActiveFamilyToken` |
| `apps/backend/src/controllers/auth.controller.ts` | 409 + `Retry-After` mapping |
| `apps/frontend/src/lib/api.ts` | bounded 409 retry honoring Retry-After |
| four test files | `auth.service`, `auth.refresh-concurrency`, `auth.controller`, `api` tests |

Review artifact: `prod-cutover/r3-refresh-replay.patch` (`git diff a824eb4 -- apps/backend/src apps/frontend/src`, 34,483 bytes, SHA-256 `4c3e621b76c7c16b02b5484b7a3b9ebfc025c20fd627965f5bbeae4592f09968`; supersedes the earlier `a0c1167e…` patch, which predates the Retry-After fix). Proposed immutable revision: `a824eb4` + this patch. **No SHA exists yet.** Required operation, not performed here: the Release owner commits exactly those 8 files on a release branch (the one edited document `TASK_03.6_INTEGRATION_CLOSURE_AND_MIGRATION_READINESS.md` is documentation and optional) and names the resulting SHA; do not include the untracked cutover files unless the release wants them.

## C. Migration integrity
Verifier (`verify-migration-artifact.cjs`) on this checkout: all four match, order correct, last four of 19. New: `build-migration-artifact.cjs <revision> <outDir>` builds the four migrations from the committed **blobs** (git object database), so it does not depend on the checkout's line endings: #1 is the committed LF blob transformed LF to CRLF (deterministic), #2 to #4 are the committed bytes, then it runs the verifier. Run against `a824eb4` it produced exactly `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8` (#1), `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991`, `e124407f979f8825cc33442a5f7a0758037144cc44aca10874d793b56fea21f3`, `97f32ab98dc286955adba6881d661b49434611c5ec037239d7f084781e933a05`, identically under `core.autocrlf` true, false and input. It reads only blobs and Node, so it is platform independent by construction; I could not run it on an actual Linux host here. Procedure on the release host: create the release checkout, run the builder with the release SHA, copy the produced `20261012120000_payment_purchase_ownership` over the checkout's file, run the verifier on `apps/backend/prisma/migrations` and require `ok: true`, then `prisma migrate deploy`. No applied migration was edited. The migration rehearsal was not re-run (migration files, Prisma version and execution logic are unchanged since the successful 15 to 19 run).

## D. PROD schema parity — exact result: IDENTICAL
Method: one read-only SELECT on PROD (`readonly-schema-rollup.sql`), including the Prisma ledger table, returning for each of enums, columns, constraints and indexes the object count and an md5 over the ordered per-object digests of the full definitions (column type, nullability, default, identity and generated flags; constraint definition text, which covers primary, foreign, unique and CHECK constraints; index definition text; enum labels in sort order). The same query on a Prisma-applied 15-migration reference gave the same values.

| Kind | PROD objects | Reference objects | PROD rollup | Reference rollup |
|---|---|---|---|---|
| columns | 288 | 288 | `fdc6dacc05b0b2d31ccd92be6986a0b3` | `fdc6dacc05b0b2d31ccd92be6986a0b3` |
| constraints | 75 | 75 | `f6ac676aa18858d4e23a986fd7c2f18a` | `f6ac676aa18858d4e23a986fd7c2f18a` |
| enums | 18 | 18 | `7f07fb595dcffc3d2d6ed91d9b726867` | `7f07fb595dcffc3d2d6ed91d9b726867` |
| indexes | 113 | 113 | `8a5291b0a7f90384f3fa9a3ecc033f34` | `8a5291b0a7f90384f3fa9a3ecc033f34` |

All four match: PROD has no material difference in column names, types, nullability, defaults, enum definitions, keys, unique, CHECK or index definitions from the expected 15-migration schema. Scope limit: the digest covers schema `public` tables, enums, constraints and indexes; it does not cover grants, RLS policies, triggers, functions, sequences ownership or comments. Post-migration expectation (from the 19-migration rehearsal database, `expected-rollup-after-19-migrations.txt`): columns 297 `9e0a68e26297e97f28633e52fc372fcf`, constraints 77 `4dd851d73f88deabfd149c4c85688d2b`, enums 18 `7f07fb595dcffc3d2d6ed91d9b726867`, indexes 116 `a228d9c63023f5d85469bc12406ba3f8`.

## E. Foundation drift — disposition
Read-only PROD ledger: 15 rows, all finished, none rolled back; the four pending names are absent. Compared with this repository's bytes (first 12 hex of SHA-256): 8 of the 15 match this Windows checkout directly, 6 more (`authentication`, `google_oauth`, `account_deleted_security_event`, `product_foundation`, `product_reviews`, `inventory_nonnegative`) match the committed LF blob (the working copy is CRLF, so only the line endings differ), and **`20240101000000_database_foundation` is the only migration whose PROD checksum `5de060a305af` matches neither the LF blob (`cb2baf5e79d8`) nor the CRLF form (`a41f086f7f9d`).** Because the actual PROD schema is identical to the 15-migration reference (section D), the drift has no structural consequence: it is a history-integrity difference (PROD was recorded from a pre-commit draft whose bytes git never saw; hypothesis from the packet, still unproven). Historical ledger and file untouched. Disposition recommended for the DATABASE owner: option (a), accept and document as a known historical baseline, with the structural proof above attached; `migrate deploy` is unaffected, while `migrate dev` or drift tooling against PROD would still flag it. The decision remains the owner's.

## F. Backup / recovery — NOT VERIFIED
No approved source exposes backup status or restore capability to this session (the connector offers no backup or PITR tool; the project record shows only status ACTIVE_HEALTHY). Read-only database observations, supporting but **not sufficient**: `archive_mode = on`, `wal_level = logical`, `archive_command` is the provider's `wal-push` (WAL-G), 376 WAL segments archived, **0 failures**, last archived segment at 20:32:55 UTC (database time 20:51:56 UTC, an idle database switches segments slowly). This shows WAL archiving is operating; it does not show that a base backup exists, the restorable window, a recovery reference, a tested restore procedure or any rehearsal, and plan tier is not evidence. **Missing operational evidence (operator):** the backup/PITR reference, earliest and latest restorable timestamps, the documented restore procedure, and the result of a restore rehearsal or an explicit owner statement accepting the risk. Risk context for that decision: PROD currently holds **no application data** (see G), so a failed migration puts no customer data at risk; the exposure is schema state only.

## G. Cutover compatibility (verified facts)
- **PROD baseline (read-only, exact counts):** 0 users, 0 orders, 0 refresh tokens (0 active), 0 payment attempts, 0 payment work rows, 0 live leases, 0 Stripe events; the only populated table is the 15-row `_prisma_migrations`; no other active database sessions and no open transactions. Consequences: migration #2's global sign-out affects **0 sessions today** (still document that it revokes every refresh token present at cutover); no payment work, lease or webhook event exists to lose; lock time is trivial.
- **Sequence:** stop old application, migrate, verify schema (rollup SQL), deploy compatible application, resume. Verified earlier on the rehearsal: an old-version refresh-token insert fails closed (`familyId NOT NULL`, no default); the current backend cannot run against the 15-state schema; migration #2 revokes all legacy tokens (`familyId = id`, expiry at epoch); new login stores a `familyId` (real-PostgreSQL check).
- **Webhooks:** during the window the Stripe endpoint must not return 2xx. Stop the API (connection refused) or serve 503 for `/api/webhooks/stripe`; a generic maintenance page that answers 200 would acknowledge and lose events. Stripe retries non-2xx deliveries; after deploy, duplicates are absorbed by event-id dedupe (`stripe_events`) and signature verification. The repository defines no maintenance-mode artifact (`infrastructure/` holds only placeholders), so the release host must supply it.
- **Workers:** recovery also runs inside each API process, so stopping the API pauses it; stop any dedicated worker as well. Work rows persist in the database; expired leases are reclaimed on restart (earlier fault test), so nothing is discarded. Keep `PAYMENT_INPROCESS_RECOVERY=false` until the pause is lifted.
- **`PAYMENT_CONFIRMATION_SIGNAL` stays `false`** until migration #4 is applied and the new release is serving; only then may it be set `true`.
- **Payment launch:** R1, R2, R6 and R8 remain open and block payment activation (not this migration); production payment acceptance is not approved by this work.

## H. Verification
Reused (unchanged, not repeated): development CI 10/10, security audit pass, Prisma 15 to 19 rehearsal, real-PostgreSQL R3 14/14. New in this pass: read-only PROD ledger, rollup comparison, baseline counts and archiver query; Prisma-applied 15-migration reference rollups; artifact builder runs (4 checksums, 3 `autocrlf` settings); frontend lib, auth and layout tests 106 passed; backend tsc and eslint clean; frontend tsc and eslint clean. Not independently verifiable here: backup recoverability, a Linux execution of the artifact builder, grants/RLS/trigger parity.

## I. Final readiness: **NOT READY for controlled execution**
Technically complete and verified: R3 correction, PROD schema parity (identical), ledger state (15/0), migration bytes and a reproducible artifact, application, worker and webhook transition, empty-data baseline. **Genuinely unresolved:** (1) **recoverable backup/PITR evidence** (operator), which this task's own boundary requires before any PROD migration; (2) **the release revision**: R3 is not in any commit, so the Release owner must commit the 8 files and name the SHA (then build and verify the artifact against that SHA); (3) AUTH acceptance of the R3 semantics and DATABASE acceptance of the foundation disposition; (4) the separate execution authorization. When (1) and (2) are supplied the plan is ready to run exactly as follows.

Controlled execution (for the approved window): `node prod-cutover/build-migration-artifact.cjs <SHA> <dir>` then overlay #1 and `node prod-cutover/verify-migration-artifact.cjs apps/backend/prisma/migrations` (`ok: true`); pre-check by running `readonly-schema-rollup.sql` on PROD (expect the four 15-state rollups above) and the ledger query (15 finished, 0 bad); stop old application and workers, webhook endpoint non-2xx; `prisma migrate deploy` via `DIRECT_URL` (session pooler); post-check: ledger 19 finished with the four pinned checksums, `readonly-schema-rollup.sql` equals the 19-state rollups above, row counts unchanged (all zero), no active refresh tokens; deploy the release, resume workers, smoke test (login, refresh, cart read, webhook signature); only then consider `PAYMENT_CONFIRMATION_SIGNAL=true`.


---

# Update 5 — Release commit created; PROD migration NOT executed (stopped before any PROD write)

Task 03.6 stays **CLOSED**. Authorization for the controlled migration was treated as given; execution still requires its stated technical preconditions, and three of them cannot be established from this session. Nothing was written to PROD in this update (read-only SELECTs only). No push, no merge.

## 1. Release commit
- **Full SHA: `cae658ddade067e4df6ea1438df73e312de3b07f`**, one commit on the new local branch `release/task-03.6-r3`, parent `a824eb42fe0e3c4663ccf1c7dceac2c8fa2ae490` (the accepted commit). Not pushed.
- Created in an isolated Git worktree at `C:\Users\ouss0\electrohub-release` (outside the repository, so the shared working tree, its branch `feature/Stripe`, its index and all other workstreams' uncommitted files were not touched). Exactly 8 files staged and committed, nothing else:
  `apps/backend/src/controllers/auth.controller.ts`, `apps/backend/src/controllers/__tests__/auth.controller.test.ts`, `apps/backend/src/repositories/auth.repository.ts`, `apps/backend/src/services/auth.service.ts`, `apps/backend/src/services/__tests__/auth.service.test.ts`, `apps/backend/src/services/__tests__/auth.refresh-concurrency.test.ts`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/lib/api.test.ts` (218 insertions, 191 deletions).
- Verification of the commit: `git diff a824eb4 cae658d -- apps/backend/src apps/frontend/src` has SHA-256 `4c3e621b76c7c16b02b5484b7a3b9ebfc025c20fd627965f5bbeae4592f09968`, **identical to the reviewed R3 patch**; the commit changes 8 files; the whole `apps/backend/prisma` tree is identical to the baseline (no migration or schema edit). Because the content is byte-identical to the working-tree delta that passed the focused tests (106 frontend, backend scoped suites, tsc and eslint on both apps) and the real-PostgreSQL R3 checks (14/14), those results are accepted as the evidence for this commit; I did not install dependencies in the clean worktree and re-run them (not justified by an unchanged delta, and the disk is almost full). Final review of the delta confirmed: a superseded token receives no credential (409 carries no token), `hasActiveFamilyToken` plus the conditional rotation under the user lifecycle lock prevents duplicate successors, reuse revokes only the replayed family, and the frontend honors `Retry-After` as a floor with three bounded retries and no cookie clearing.

## 2. Migration artifact (built from the release SHA, not the working tree)
`node docs/tasks/Phase-03/prod-cutover/build-migration-artifact.cjs cae658ddade067e4df6ea1438df73e312de3b07f <dir>` exited 0 and wrote exactly four folders, in order, with these SHA-256 values (verifier `ok: true`; a second build is byte-identical):

| # | Migration | SHA-256 |
|---|---|---|
| 1 | `20261012120000_payment_purchase_ownership` | `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8` (CRLF form, equals the DEV-recorded value) |
| 2 | `20261013000000_refresh_token_rotation_lineage` | `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991` |
| 3 | `20261015000000_payment_attempt_dismissed_at` | `e124407f979f8825cc33442a5f7a0758037144cc44aca10874d793b56fea21f3` |
| 4 | `20261016000000_payment_attempt_confirmation_started` | `97f32ab98dc286955adba6881d661b49434611c5ec037239d7f084781e933a05` |

The release commit contains 19 migration folders, the last four being these, and no historical migration or ledger record was altered.

## 3. PROD baseline recheck (read-only, 2026-10-17 20:59 UTC database time)
Ledger 15 finished, 0 failed or unfinished, last migration `20261012000000_storefront_product_visibility`; 0 users, 0 refresh tokens, 0 payment attempts, 0 open payment work; no other active sessions. Unchanged from the verified baseline (schema rollups matched the 15-migration reference earlier the same day; the baseline counts that would reveal a change are unchanged, so the rollup was not re-run since no execution followed). The foundation checksum exception is accepted as documented (schema definitions identical; scope: public tables, enums, constraints and indexes).

New read-only inventory of the scope the rollup does not cover (answers the earlier scope limit): 29 public tables, 6 with RLS enabled and 0 policies; 150 table grants to `anon`/`authenticated` in `public`; extensions `pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.1, uuid-ossp 1.1`; 0 public functions, 0 public triggers, 1 publication, 6 event triggers. **The four pending migrations only add columns, constraints and indexes to existing tables; they create no tables**, so they cannot change RLS enablement or grants on new objects. A post-migration check should still repeat this inventory and expect the same figures.

## 4. Backup / recovery — NOT ESTABLISHED
Available access: the Supabase connector (SQL and project metadata only). It exposes no backup, snapshot or PITR information or controls, and the project record shows only status. Observed earlier: WAL archiving operating (WAL-G, 376 segments, 0 failures), which is supporting evidence only. Missing, and required from the operator with dashboard or API access: the PITR window (earliest/latest restorable time) or a snapshot reference covering the current state, the documented restore procedure, and a rehearsal or an explicit owner acceptance of the risk. Nothing here is claimed to exist. Partial-failure behavior I can state: each migration file runs inside its own explicit transaction (migration #2 under `BEGIN`/`COMMIT` with a 10 s lock timeout), so a failure inside one migration rolls that migration back; migrations that completed stay recorded, and the schema never sits in a half-applied statement state. The state after a failure is therefore a valid prefix, recoverable by fixing the cause and re-running `migrate deploy` for the remainder; if Prisma records a failed row it needs the owner-reviewed `migrate resolve --rolled-back` step, which this task forbids as a shortcut.

## 5. Why execution was not performed
Material preconditions that could not be verified from this session:
1. **Recoverable backup/PITR** (section 4): required by the task before any PROD write.
2. **No approved execution path to PROD for Prisma:** `prisma migrate deploy` needs a PROD `DIRECT_URL` with credentials; no such connection is available to me and I did not use environment files. The connector's `apply_migration` writes Supabase's own migration history, not Prisma's `_prisma_migrations`, so using it would desynchronize the ledger and is not the approved procedure.
3. **Deployment and maintenance mechanism not reachable or defined:** the repository holds no maintenance-mode or PROD deployment artifact (`infrastructure/` contains only placeholders) and I have no access to the host that runs PROD, so I cannot verify that old instances and workers can be stopped, that traffic can be paused, or that `/api/webhooks/stripe` will return non-2xx (not 200) during the window, nor deploy the release commit.

I did not run PROD writes to work around any of these.

## 6. Controlled execution procedure (ready to run once 1 to 3 are supplied)
1. On the release host: check out `cae658ddade067e4df6ea1438df73e312de3b07f`; `node docs/tasks/Phase-03/prod-cutover/build-migration-artifact.cjs cae658ddade067e4df6ea1438df73e312de3b07f <dir>`; copy `<dir>/20261012120000_payment_purchase_ownership/migration.sql` over the checkout's file; `node docs/tasks/Phase-03/prod-cutover/verify-migration-artifact.cjs apps/backend/prisma/migrations` must print `"ok": true`.
2. Pre-check on PROD (read-only): ledger 15 finished and 0 bad; `readonly-schema-rollup.sql` returns columns 288 `fdc6dacc05b0b2d31ccd92be6986a0b3`, constraints 75 `f6ac676aa18858d4e23a986fd7c2f18a`, enums 18 `7f07fb595dcffc3d2d6ed91d9b726867`, indexes 113 `8a5291b0a7f90384f3fa9a3ecc033f34`; no open payment work, no active sessions.
3. Maintenance: stop old API instances and any dedicated worker; keep the Stripe webhook endpoint non-2xx; record the recovery checkpoint (PITR timestamp or snapshot reference).
4. `cd apps/backend && npx prisma migrate deploy` with `DATABASE_URL` and `DIRECT_URL` set to the PROD session-pooler connection; expect exactly four migrations applied in order; stop on any error.
5. Post-check: ledger 19 finished, 0 bad, the four pinned checksums; rollups equal columns 297 `9e0a68e26297e97f28633e52fc372fcf`, constraints 77 `4dd851d73f88deabfd149c4c85688d2b`, enums 18 `7f07fb595dcffc3d2d6ed91d9b726867`, indexes 116 `a228d9c63023f5d85469bc12406ba3f8`; repeat the scope inventory in section 3; counts of users, orders, refresh tokens and payment attempts unchanged (all zero); zero active refresh tokens.
6. Deploy the release commit, resume workers, smoke test login, refresh, logout, a cart read, a payment read path and webhook signature verification; no live payments. Only then, and separately, consider `PAYMENT_CONFIRMATION_SIGNAL=true`. Production payment activation (R1, R2, R6, R8) remains a separate milestone.

## 7. Verdict
Ledger: 15 finished, 0 failed, 4 pending (no change). Schema parity after migration: not applicable, nothing applied. **Final verdict: NO-GO for execution (not FAILED, not PARTIAL).** The release commit and artifact are ready and verified; the remaining actionable items are (a) backup/PITR evidence, (b) a PROD Prisma connection and the deployment and maintenance mechanism, both held by the operator. No 19/19 claim is made.


---

# Update 6 — Execution attempt: stopped at the recovery precondition (NO-GO, no PROD write)

Task 03.6 stays **CLOSED**. Connection method used: **Supabase MCP, read-only SELECTs only** (connected project confirmed as `yepfgjehdstlxbpespun`, database `postgres`). No write, no `prisma migrate deploy`, no `migrate resolve`, `reset` or `db push`; no push or merge.

- **Release commit:** `cae658ddade067e4df6ea1438df73e312de3b07f` (local branch `release/task-03.6-r3`, unchanged). The artifact was rebuilt from that SHA again: exit 0, four folders, all pinned checksums match (`0cf4bc6b…ff8` for #1 in CRLF form; `51495598…991`, `e124407f…1f3`, `97f32ab9…a05`).
- **Helper scripts are not in the release commit** (0 files under `prod-cutover/` at that SHA; they are untracked). The release host must receive them alongside the checkout; pinned SHA-256 values of the files used: `build-migration-artifact.cjs` `cf3ce6a04abdd101eff6a79bb79b467c934d8aff36bec87b187941068781d2eb`, `verify-migration-artifact.cjs` `3c47891597a0f80eb3d6dd77e01a97c23f48cdecf9e3032cb8613def17169112`, `readonly-schema-rollup.sql` `a2364a40b01587ace71bf55470a2c51b1ab937a3a6772c74d2dab09bdd5f9d9f`, `compare-schema.cjs` `0088d176c9fb4f37049b000e13c79f24e46a62f46c69372542795629026182b2`. I did not alter the approved SHA to include them.
- **PROD preflight (read-only, 2026-10-17 21:05 UTC):** 15 finished, 0 failed or unfinished, last migration `20261012000000_storefront_product_visibility`, 0 users, 0 refresh tokens, 0 payment attempts, 0 open payment work, no other active sessions. Baseline unchanged from the accepted one; the four pending names are absent.
- **Recovery protection: still NOT established, and it is the blocker.** The MCP exposes no backup, snapshot or PITR listing or status tool (its tools cover SQL, migrations, branches, advisors, logs, edge functions and project restore of a paused project). A Supabase development branch would be a schema-only copy at extra cost and is not a backup of PROD, so I did not create one. WAL archiving working (WAL-G, 0 failures) remains supporting evidence only. Nothing in this session shows a base backup, a restorable window, a recovery reference or a rehearsal. This task forbids any database write without credible recoverability evidence, so I stopped.
- **Connection option B (PROD URL):** the repository has a `.env.production.local` beside the DEV file (existence only; I did not read or load it). I did not use it: the recovery precondition fails regardless of the connection method, and this project's tooling blocks reading environment files. Supplying a PROD `DIRECT_URL` (session pooler) to the release host, not to this session, is the safer path. Prisma deployment through the MCP is not possible (its `apply_migration` writes Supabase's own history, not `_prisma_migrations`).
- **Deployment and maintenance:** unchanged and unreachable from here (no access to the PROD application host, no maintenance-mode artifact in the repository; the webhook endpoint must return non-2xx during the window, and a stopped API satisfies that).

**Migrations executed: none. Ledger: 15 finished, 0 failed, 4 pending. Schema parity after migration: not applicable. Verdict: ⚠ NO-GO — execution could not safely begin.** Missing, precisely: (1) backup/PITR evidence for PROD (snapshot reference or restorable window, restore procedure, rehearsal or explicit risk acceptance), (2) a PROD Prisma connection and the deployment and maintenance mechanism on the release host. The procedure in Update 5 section 6 is ready to run unchanged once those exist.

---

# Update 7 — Final execution prerequisites assessed (2026-10-18, Asia/Beirut)

**Verdict: ⚠ NO-GO — execution blocked before any PROD write. Task 03.6 remains CLOSED.** The owner authorized the controlled cutover conditional on recoverability and compatible application deployment arrangements. Those conditions remain unmet; no additional migration authorization is being requested.

## Actual access and recovery evidence

- Supabase project metadata independently confirms `electrohub`, `yepfgjehdstlxbpespun`, `ap-northeast-1`, `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.166`.
- The available Supabase tools still expose neither backup/PITR inventory nor a Prisma CLI execution mechanism. `apply_migration` was not used. No Management API token is configured in this process or the inspected production environment file.
- A connected Brave browser inventory includes the exact PROD Dashboard. Binding that tab failed with a CDP `Emulation.setFocusEmulationEnabled` timeout; opening the exact project's backup page failed with a CDP `Page.navigate` timeout. Dashboard authentication and backup contents therefore could not be verified. No backup was created or restored, no branch was created, and no plan/settings changes were made.
- Official backup documentation identifies Dashboard **Database > Backups** and the read-only Management API `GET /v1/projects/{ref}/database/backups` as evidence sources: <https://supabase.com/docs/guides/platform/backups>. For an existing usable daily backup, restoration is selected from that page and requires confirmation; for PITR, choose a timestamp within the displayed earliest/latest recovery window. These are documented procedures, not evidence that this project's recovery point exists or is usable. Custom-role passwords and Storage objects require separate recovery consideration. No restore was attempted.
- **Recovery reference: unavailable.** WAL archiving evidence from earlier updates does not satisfy this gate. Needed: a successful backup reference or actual restorable PITR window covering the cutover baseline, available restore controls, and the documented rehearsal/risk disposition from Update 5.

## Secure PROD Prisma connection assessment

- Safely parsed `apps/backend/.env.production.local` in memory; no values, passwords, authenticated URLs, or raw connection errors were emitted. Both database URL fields contain the exact PROD reference. `DIRECT_URL` has the session/direct port `5432`, database `postgres`, and a password; `DATABASE_URL` does not have that port and was not selected for migration execution. Credentials remain unvalidated.
- Attempted only a read-only `psql` ledger query using the configured `DIRECT_URL` endpoint, `-X -w`, a 10-second connection timeout, read-only transactions, and a 5-second statement timeout. TLS was strengthened to `verify-full`, using the locally available CA whose fingerprint matches the previously verified `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. This is not a claim of a completed TLS handshake.
- Result: **BLOCKED, DNS_FAILURE, psql exit 2**. Follow-up IPv4 and IPv6 DNS queries through the system resolver, `1.1.1.1`, and `8.8.8.8` all returned `ETIMEOUT`. This does not establish an invalid password, invalid hostname, or database outage; local/network/sandbox DNS reachability remains unresolved. No alternate database endpoint, insecure TLS setting, or network configuration change was used.
- A successful native Prisma connection and migration-engine TLS verification remain runtime prerequisites on the actual release host.

## Application maintenance/deployment

- `infrastructure/deployment`, `infrastructure/docker`, and `infrastructure/nginx` contain `.gitkeep` placeholders only. `docs/09_Deployment/PRODUCTION.md` and `DEPLOYMENT_WORKFLOW.md` describe a planned DigitalOcean environment and defer production deployment to the final project phase. Available workflows do not establish PROD host control. No production deployment API credential is present in the checked process environment.
- No concrete PROD host/service inventory, maintenance route, API/worker stop controls, or exact-commit deployment mechanism has been established. Absence of active database sessions would not prove that no application instances exist.
- Consequently, stopping incompatible instances, withholding webhook 2xx acknowledgments, deploying the approved release, restoring service, and smoke-testing it are **NOT EXECUTED / NOT VERIFIED**. `PAYMENT_CONFIRMATION_SIGNAL` was not changed or activated. Its disabled production state must be verified by the operator before execution.

## Release artifact and fresh ledger evidence

- Approved release remains `cae658ddade067e4df6ea1438df73e312de3b07f`; no source, migration, commit, or index changes were made for this update. Prior R3, rehearsal, and schema-parity evidence was reused rather than rerun.
- Both helper scripts match Update 6 exactly: builder `cf3ce6a04abdd101eff6a79bb79b467c934d8aff36bec87b187941068781d2eb`; verifier `3c47891597a0f80eb3d6dd77e01a97c23f48cdecf9e3032cb8613def17169112`.
- Copied only those verified helpers into the ignored local handoff bundle `.cache/prod-cutover-20261018-1792271640165/helpers/`. Ran the copied builder with the approved release SHA and output `../pending-migrations`, then the copied verifier against that output. Both exited 0; exactly four folders, correct order, all four pinned SHA-256 values from Update 5 matched, including migration #1's CRLF bytes. The bundle contains no environment file or credentials. It is local preparation, **not delivered to a verified production execution host**; the pending-only folder is not a replacement for the full approved checkout and migration history.
- Read-only Supabase PROD ledger query at database timestamp **2026-10-17 21:13:58.354880 UTC** returned **15 finished, 0 unfinished/failed, 0 rolled back**. Four migrations remain pending relative to the approved release. The native connection failed before SQL execution; this ledger evidence came from MCP.
- Exact post-19 schema rollups, data-preservation checks, deployment, and application smoke tests are **NOT EXECUTED**. Earlier 15-state schema rollups and the documented historical `database_foundation` checksum exception remain unchanged as evidence; no new schema-parity claim is made. Repeat the full final preflight immediately before any future cutover.

## Operator handoff / remaining dependencies

Provide one accessible release execution environment with (1) the PROD backup/PITR recovery reference and restore capability, (2) working DNS and an authenticated, certificate-verified PROD Prisma connection, and (3) the actual production API/worker inventory and maintenance/deploy/restore controls for the exact release commit. The existing authorization is sufficient once those technical conditions pass. Then execute Update 5 section 6, retaining the historical checksum exception, webhook non-2xx behavior during maintenance, and disabled payment activation.

**PROD mutations: NONE. Migrations: NOT EXECUTED. Deployment: NOT EXECUTED. No Stripe operations, commit, push, merge, or CI run.**

---

# Update 8 — Controlled development-stage PROD migration completed (2026-10-18, Asia/Beirut)

**✅ SUCCESS: PROD reached 19/19 successful Prisma migrations, all four new checksums match, and exact schema parity is independently verified. Task 03.6 remains CLOSED — 94/100; migration preparation remains APPROVED — 98/100.**

## Authorization and accepted recovery risk

The owner's latest explicit instruction supersedes the backup/deployment prerequisites in Updates 4–7 for this operation. The owner confirmed that no production application, payment service, or customer traffic is running, and expressly accepted proceeding **without a backup or PITR recovery point**. Recoverability was not established or represented as guaranteed. No nonexistent maintenance/deployment arrangement was required. This was a controlled database-only operation; production application deployment and payment activation remain out of scope.

## Connection and artifact

- Target independently identified as Supabase `electrohub`, `yepfgjehdstlxbpespun`, `ap-northeast-1`, database `postgres`.
- Native connectivity succeeded when executed outside the network-restricted sandbox. The earlier DNS failures therefore did not establish invalid credentials or a failed database. The existing authorized `apps/backend/.env.production.local` `DIRECT_URL` was parsed in memory only, using its exact session-pooler endpoint `aws-0-ap-northeast-1.pooler.supabase.com:5432`. Passwords and authenticated URLs were neither printed nor stored in the evidence bundle.
- Read-only psql connection: `sslmode=verify-full` with the previously verified Supabase CA. Native Prisma 6.12.0: `sslmode=require`, `sslaccept=strict`, `sslcert` pointing to that same CA, `schema=public`, connection limit 1, connection/pool timeouts 10 seconds, socket/statement timeout 60 seconds, lock timeout 10 seconds. Node pg snapshot connections also verified the certificate and exact hostname. No TLS fallback or insecure setting was used.
- Release source: **`cae658ddade067e4df6ea1438df73e312de3b07f`**. Extracted its committed Prisma schema and **complete 19-migration history** into `.cache/prod-final-20261018/release/prisma/`; applied the verified builder's pending-migration bytes, including the approved CRLF form for migration #1. Original working-tree/release-history files were not edited.
- The builder and verifier retained the exact helper hashes recorded in Update 6. The copied verifier passed against all 19 folders; all four pending checksums and their order matched. `manifest.json` records every extracted schema/migration artifact hash. The documented historical `database_foundation` checksum exception was preserved; no ledger row was rewritten.

## Final preflight and execution

Read-only repeatable-read snapshots were saved before execution. They verified 15 finished migrations, no failed/unfinished/rolled-back rows, exactly the four approved pending names, and exact equality to all four saved 15-state definition rollups. **Every one of the 28 application tables was empty**, including users, refresh tokens, orders, payment attempts, payments, payment work, and Stripe events. Other observed sessions were idle managed Supabase infrastructure: PostgREST, Supavisor authentication, and Supabase monitoring. No application traffic, active financial work, or contrary evidence was observed.

The local guard initially stopped on the idle `pgbouncer` / `Supavisor (auth_query)` session; after identifying that managed infrastructure session, only that exact idle combination was admitted. A second local diagnostic expected different Prisma status wording and stopped after the read-only command; its parser was corrected to require the exact four migration names and 19-folder count. Neither diagnostic stop executed a migration or changed database state.

Actual commands, with secrets supplied only in child-process environment:

```text
node .cache/prod-final-20261018/run.cjs prepare
node .cache/prod-final-20261018/run.cjs preflight
node .cache/prod-final-20261018/run.cjs deploy
```

The wrapper invoked the installed, pinned **Prisma 6.12.0 CLI** directly through Node, equivalent to `npx prisma migrate deploy`, with `migrate deploy --schema <approved-artifact>/prisma/schema.prisma`. It did not use Supabase `apply_migration`, `db push`, `reset`, or `migrate resolve`. The final deploy action repeated the entire baseline check immediately before execution and required the previously captured native Prisma status to identify exactly the four pending migrations. A 180-second child lifetime limit was configured; it was not reached.

**Prisma deploy exit code: 0.** Output: `19 migrations found in prisma/migrations`, followed by exactly these four applications and `All migrations have been successfully applied.`

| Migration | Recorded PROD SHA-256 | Finished UTC |
|---|---|---|
| `20261012120000_payment_purchase_ownership` | `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8` | 2026-10-17 21:26:18.394631 |
| `20261013000000_refresh_token_rotation_lineage` | `51495598e0e1a7e8d74b2d19f8e596fcae32a0e1afb2e626120fad7c06b2e991` | 2026-10-17 21:26:20.823031 |
| `20261015000000_payment_attempt_dismissed_at` | `e124407f979f8825cc33442a5f7a0758037144cc44aca10874d793b56fea21f3` | 2026-10-17 21:26:23.373068 |
| `20261016000000_payment_attempt_confirmation_started` | `97f32ab98dc286955adba6881d661b49434611c5ec037239d7f084781e933a05` | 2026-10-17 21:26:25.680585 |

These timestamps correspond to **2026-10-18 00:26, Asia/Beirut**. Each new ledger row records one applied step.

## Independent post-migration verification

Both the native read-only connection and the separate Supabase PROD MCP connection verified the results. MCP ledger verification at **2026-10-17 21:27:17.352068 UTC** returned **19 finished, 0 failed, 0 unfinished, 0 rolled back**. All four new ledger checksums match the table above; the original 15 ledger rows are byte-for-byte equal as serialized query results to the preflight rows.

| Object class | Actual count | Actual definition rollup | Saved 19-state reference |
|---|---:|---|---|
| Columns | 297 | `9e0a68e26297e97f28633e52fc372fcf` | MATCH |
| Constraints | 77 | `4dd851d73f88deabfd149c4c85688d2b` | MATCH |
| Enums | 18 | `7f07fb595dcffc3d2d6ed91d9b726867` | MATCH |
| Indexes | 116 | `a228d9c63023f5d85469bc12406ba3f8` | MATCH |

The exact catalog-definition comparison includes the payment ownership columns/constraints, refresh-token `familyId` and successor constraints/indexes, `dismissedAt`, and `confirmationStartedAt`. This is equality of the saved canonical definitions, not merely matching counts. No structural drift was detected within that reference scope.

All 28 application tables remain empty with unchanged count/content digests; independent MCP checks also returned zero users, orders, payment attempts, payment work, and refresh tokens. Therefore the refresh-token revocation/backfill affected zero existing sessions. Public security metadata is unchanged: 29 tables including the Prisma ledger, 6 RLS-enabled tables, 0 public policies, and all 440 captured role-table-grant rows unchanged (the earlier 150 figure covered only `anon`/`authenticated`). No grants or RLS settings were changed by this operation.

## Local evidence and final disposition

Evidence directory: `.cache/prod-final-20261018/` (ignored local artifacts; no credentials): `before.json`, `immediate-before.json`, `after.json`, `manifest.json`, `prisma-status.json`, `prisma-deploy.json`, `execution-started.json`, and `independent-verification.json`. Snapshots contain catalog/ACL metadata and application-table counts/digests, not application records; **they are not backups**.

Selected evidence SHA-256 values:

```text
immediate-before.json c41ec0e4823e0b198235158328fd7f40ce6eb5b713962f8d4c174da2883d086d
after.json            70af18c1e3447f608308d1d044f52382d76b36fbe900906630e209ba072678da
manifest.json         57919fe7dbef5865bf191476225607041930392f784b52604aedf7fc1d9f2056
prisma-deploy.json    fd9d35bd9166843f7c5ee3831787508078310f1cbf94ba9058dc0db9ba601484
```

Timestamp caveat: the native snapshots' `identity.observed_utc` field was returned as a PostgreSQL timestamp without timezone and serialized by pg using local timezone interpretation, shifting that JSON field by three hours. Those original snapshots were preserved. Use the timezone-aware Prisma ledger timestamps and independent MCP UTC timestamp recorded above as the authoritative execution chronology; this display issue did not affect any migration, checksum, schema, data, or access-control comparison.

**Remaining migration defects: none identified.** Accepted risk remains: no verified backup/PITR recovery point. Production application deployment, checkout activation, Stripe operations, and application smoke tests were not part of this database-only authorization and were not performed. No confirmation-signal flag was activated. No commit, push, merge, or CI run occurred. **Production database migration work is complete; Task 03.6 remains CLOSED.**
