# Refresh-Token Rotation Lineage

Status: **implemented in source; migration prepared and NOT applied** (`20261013000000_refresh_token_rotation_lineage`).
Real-PostgreSQL concurrency behavior is **NOT VERIFIED** (see section 7).
Operational gates still open: owner authorization of the legacy-session invalidation, and the CI migration hazard in `REFRESH_TOKEN_MIGRATION_CI_HANDOFF.md`. **Do not push this migration before that handoff is resolved.**

## 1. Contract

| Operation | Behavior |
| --- | --- |
| Session issuance (password login, registration verification, Google sign-in) | Credentials are verified first, outside any transaction. `createSessionRefreshToken` then takes the lifecycle locks, **re-reads the account under them**, and inserts a new independent family only if the account still matches the state the proof was based on (same `passwordHash`, same `roleId`, `isActive`, email verified). Otherwise nothing is written and the request fails with the generic `Invalid credentials` (401); the user signs in again. |
| Rotation | One transaction under the lifecycle locks: read the eligible token (unrevoked, unexpired, owned by the user), conditionally revoke it while writing `replacedByTokenHash`, insert the successor with the **same** `familyId`. All-or-nothing. |
| Concurrent refresh within 10 s | The loser is authorized only if the old token's durable `replacedByTokenHash` points to a token that is still active with the same user and family. It receives an access token and no new cookie (unchanged). |
| Reuse after the 10 s grace | Unchanged: all of the user's refresh tokens are revoked (`REFRESH_TOKEN_REUSED`). |
| Logout (owner-confirmed) | Revokes the presented token **and every other generation of its family** (`isRevoked = true`, `expiresAt = epoch`). Other devices (other families) stay active. |
| Password change, password-reset completion, global revocation | Revoke all of the user's tokens (`isRevoked = true`, `expiresAt = epoch`). |

### Why issuance re-validates, and what it protects

A login can verify a password (slow bcrypt, outside the lock) and then lose a race with a password change that commits first. Taking the lock alone would still let that stale login insert a surviving session. Re-reading the account **after** acquiring the lock closes it:

- Password change / reset committed first: the re-read sees a different `passwordHash`; issuance is refused. Nothing survives.
- Issuance first: the session is inserted and committed before the revocation can take the lock; the revocation then revokes it (it revokes every token of the user).
- Account deactivation or deletion (`account-deletion.service.ts` sets `isActive = false` and deletes tokens while holding the user row `FOR UPDATE`, without the advisory lock): issuance and rotation hold the user row `FOR SHARE`, so they wait for that transaction and then re-read the committed account (refused), or the deletion waits for them and deletes the new session before committing.
- Global (replay) revocation does not change the account. A login that completes after it is a legitimate new authentication with fresh proof; one that completes before it is revoked by it.
- The same function serves all three issuers (`login`, `verifyRegistrationOtp`, `establishCustomerSession` for Google) through `AuthService.createSession`. A Google or OTP proof is also refused if the account changed in between; this is deliberately conservative and only occurs under a concurrent change.

### Lock order (all lifecycle transactions)

1. `pg_advisory_xact_lock(hashtext('user_token_lifecycle'), hashtext(userId))`
2. `SELECT id FROM users WHERE id = $1 FOR SHARE`
3. `refresh_tokens` rows

Both are released by PostgreSQL at commit or rollback, through the shared `lockUserTokenLifecycle` helper (`auth.repository.ts`), used by issuance, rotation, logout, password change, password-reset completion and global/replay revocation. Account deletion takes the user row `FOR UPDATE` and then token rows, and never the advisory lock; because lifecycle transactions also take the user row before touching tokens, the two orders cannot form a cycle. (Without step 2, a rotation holding a token row and waiting for the foreign-key check on `users` could deadlock against that deletion.) Model-tested; **not proven on real PostgreSQL**.

**Authority.** Committed PostgreSQL rows are the only source of truth. There is no process-local lineage map or cache; nothing is published before commit; any instance resolves successors and revokes families from the database alone. Database errors propagate; there is no in-memory or schema-compatibility fallback.

## 2. Legacy-session cutover policy (owner-visible decision, NOT yet authorized)

**Policy proposed: the migration invalidates every existing refresh-token session. Every user must sign in again.** Executing it requires explicit owner authorization for the named environment; passing tests is not that authorization.

What can be reconstructed: `refresh_tokens` stores only `id`, `userId`, `tokenHash`, `expiresAt`, `isRevoked`, timestamps. Successor links existed only in a process-local map and are not durable. A legacy ancestor and its active descendant therefore **cannot** be linked from durable data, and nothing is inferred from token age, `updatedAt` proximity or memory. Generated per-row families would leave ancestor T1 and active successor T2 in different families so a family logout or replay revocation of T1 could leave T2 alive; invalidating all legacy rows removes that case by construction.

Effect (see the migration SQL header):

- Every legacy row: `isRevoked = true`, `expiresAt = epoch` (the logout contract), `familyId = id` (its own single-row family; no lineage is pretended), no successor link. Revoked rows stay for audit. The `UPDATE` has no `WHERE`.
- **Active legacy sessions:** ended. Next refresh returns `401 EXPIRED_REFRESH_TOKEN`; the controller clears the cookie; the user reauthenticates. Access tokens already issued remain valid until their 15-minute expiry.
- **Revoked ancestors with active descendants:** the descendant is revoked too.
- **Logout after cutover:** a legacy cookie is a no-op on an already-revoked single-row family; the cookie is cleared.
- **Replay after cutover:** a legacy token has `expiresAt = epoch`, so it is rejected as expired before the reuse branch and does not trigger a user-wide revocation.
- A post-cutover login creates a fresh family and follows section 1.

## 3. Schema and migration

- `familyId UUID NOT NULL`, **no default**. The application always sets it. An old-version INSERT omitting it fails (`23502`) instead of creating a disconnected family.
- `replacedByTokenHash VARCHAR(255) NULL`, `UNIQUE`; `CHECK (replacedByTokenHash IS NULL OR replacedByTokenHash <> tokenHash)`; index on `familyId`. No foreign key on `replacedByTokenHash` (a dangling pointer fails closed).
- **Transaction boundary (verified from the SQL, not assumed):** the file is wrapped in an explicit `BEGIN; ... COMMIT;`, the same pattern as the already-applied `20261006000000_checkout_core` and `20261007000000_stripe_orchestration`. Every statement is transactional (no `CREATE INDEX CONCURRENTLY`; `SET LOCAL lock_timeout = '10s'` makes it fail fast instead of queueing an `ACCESS EXCLUSIVE` request). A failure at any statement aborts the transaction and PostgreSQL rolls everything back. This was established by static inspection and a static test, **not by executing the migration**. Prisma records a failed run in `_prisma_migrations` and refuses further deploys until the operator confirms the columns are absent and runs `prisma migrate resolve --rolled-back`.
- Locking (PostgreSQL documentation, **not measured**): `ADD COLUMN` without a default is catalog-only; the `UPDATE` writes each row once; `SET NOT NULL` scans under `ACCESS EXCLUSIVE`; index builds block writes. The server version was not established (no database was touched).
- Schema ownership: `schema.prisma` and migration SQL are protected hotspots; the `RefreshToken` model change needs DATABASE-owner review (`AGENT_COORDINATION.md`).

## 4. Cutover runbook (stop-the-world; rolling deployment is NOT supported)

**Architecture facts used** (`docs/09_Deployment`): Docker Compose behind Nginx on a DigitalOcean Ubuntu host; production deployment is documented as deferred; guidance is to avoid partially incompatible versions. No rolling or blue/green mechanism is documented, so none is claimed. The old and new rotation protocols are incompatible (old code takes no lifecycle lock and writes no lineage), so old and new must never serve authentication together.

**Environments.** DEV is the shared project `pzxekjybdiulzmssalfo`; every developer's local `npm run dev` / `tsx watch` pointing at it is an "old instance". PROD is `yepfgjehdstlxbpespun`. Run the full runbook per environment, with its own written authorization; DEV first.

### Prerequisites (stop if any is false)

1. **CI gate closed:** the hazard in `REFRESH_TOKEN_MIGRATION_CI_HANDOFF.md` is resolved and verified. Until then the migration directory must not be pushed to any branch or PR (it would be applied to shared DEV by CI).
2. Written owner approval of the session invalidation and of applying the migration to the named environment (Architect + Owner for CI/deploy/secrets; DATABASE + Architect for migration execution).
3. Tested backup/restore point for the target.
4. DATABASE-owner review of the `schema.prisma` and migration change.
5. The new build: `prisma validate`, `prisma generate` exit 0, typecheck, lint, build and auth tests pass.

### Steps

1. **Announce** the window; every user is signed out.
2. **Block at the edge** every route that issues, rotates or revokes a session. Under `/api` these are the whole `/api/auth/` prefix (login, register, verify-email, refresh, logout, reset-password, change-password, Google start/callback/complete/link) **and** `/api/account/` (deletion re-authentication). Return `503`. Validate Nginx with `nginx -t` before reload. This is secondary to step 3; do not rely on a prefix filter alone.
3. **Stop every old backend process:** the Compose backend service (and on DEV, every developer dev server and script that connects to the database, e.g. `scripts/diagnose-refresh.ts`). Confirm no backend container or process remains and that the database shows no application connections other than the operator's.
4. **Backup** (prerequisite 3).
5. **Apply the migration** (separately authorized) with the direct, non-pooler URL: `prisma migrate deploy`, then `prisma migrate status`.
6. **Verify (read-only SQL):** no active row (`NOT "isRevoked" OR "expiresAt" > now()` is 0); `familyId` has no NULLs, is `NOT NULL` with no default; both indexes and the CHECK exist; the migration is finished in `_prisma_migrations`.
7. **Start the new build only**, from a Prisma client generated against the migrated schema. `/health` and `/health/ready` prove only the process and a connection, **not schema compatibility**; steps 6 and 8 prove that.
8. **Smoke test with a dedicated test account** (owner-run live operation): login, refresh (cookie rotates), refresh again with the old cookie within 10 s (200, no new cookie), logout, refresh (401), and a replay of a rotated token after 10 s (401, all that user's sessions revoked). Confirm no `P2022` or `23502` in logs.
9. **Reopen Nginx.** Scale out only with new-build instances.
10. **Monitor** auth 5xx, `P2022`/`23502`, `REFRESH_TOKEN_REUSED` and `SESSION_REVOKED` rates after reopening.

### Detecting a straggler and stop conditions

A leftover old instance cannot commit a login or rotation after the migration (its INSERT fails with `23502` on `familyId`), so it fails closed. It shows up as `23502` in logs, old-build log lines, or an application connection in the database after step 3. Stop and resolve before continuing if: any prerequisite is false; an application connection other than the operator's exists at step 5; step 6 checks fail; the smoke test fails.

### Failure handling and rollback restrictions

| Failure point | State | Action |
| --- | --- | --- |
| Steps 1-4 | Nothing changed | Restore Nginx; restart the old build. |
| Step 5 fails | Migration did not apply (explicit transaction); the Prisma ledger shows a failed run | Confirm the columns are absent and the table is unchanged, `prisma migrate resolve --rolled-back`, fix, retry. The old build may be restarted only after that confirmation. |
| Step 5 succeeds, 6-8 fail | Schema migrated, legacy sessions revoked | **Fix forward on the new build with auth traffic still blocked.** Do not start the old build. |

**Reverting to the old application after a successful migration is not a routine rollback and is not security-equivalent.** Old writers have no lifecycle lock, no lineage and no family; they also cannot insert tokens at all against the migrated schema. Making them work would require a new schema change that re-introduces disconnected families and the unserialized protocol. That is a separate, exceptional decision that needs its own written Architect + Owner approval as an accepted security risk, a newly reviewed migration, and a re-run of the drain; it is deliberately not provided as a command here, and nothing executes automatically.

**Database restore** is also not a clean rollback: it reverts password changes, logouts and revocations made after the restore point and can resurrect sessions that were revoked since (including those the cutover revoked). After any restore, all refresh tokens must be revoked again by an owner-controlled operation before authentication is reopened. The legacy-session invalidation remains the documented cutover decision.

## 5. Lost response after a committed rotation (accepted trade-off)

- Durable after the commit: the old row (`isRevoked`, `updatedAt`, `replacedByTokenHash`) and the successor's **hash only**. The raw successor token existed only in the lost response and cannot be reissued.
- A retry with the old cookie within the 10 s grace window is recognized from the database (pointer to an active successor of the same user and family), on any instance and after a restart. It gets an access token and no cookie, so the browser keeps the old (now revoked) cookie.
- A retry after the window is indistinguishable from token theft and revokes all of the user's sessions (`REFRESH_TOKEN_REUSED`); the user must sign in again.
- The grace clock is the old row's `updatedAt`, which Prisma sets from the application clock; instance clock skew moves the window.
- Distinction: a transient database or transaction error returns a non-401 error and **keeps** the cookie (the client may retry); only a confirmed `401` from the refresh endpoint (invalid, expired, reused, session revoked) clears it.
- The grace window and replay policy are unchanged. Reissuing the raw successor would need a stored recoverable credential or a derivation from the old token, which weakens the contract; that would need a separately approved security design.

## 6. Prisma client

`prisma generate` was completed through the normal command after the owner authorized stopping the development server that held the engine DLL. That server was not restarted. The shared DEV database is unmigrated, so a new-schema server started against it will hit `P2022` until the DEV cutover is performed.

## 7. Verification limits

`auth.refresh-concurrency.test.ts` runs the real service and repository against a **model** of PostgreSQL transactions, advisory locks and user-row locks (`__tests__/helpers/refresh-token-model-db.ts`). It shows the repository logic depends only on committed state, takes locks in one consistent order and refuses stale issuance; it does **not** prove PostgreSQL lock, isolation or deadlock-detection behavior, and no isolated disposable PostgreSQL was available. Running the same interleavings against one is an operational-readiness gate before production use, separate from source review.
