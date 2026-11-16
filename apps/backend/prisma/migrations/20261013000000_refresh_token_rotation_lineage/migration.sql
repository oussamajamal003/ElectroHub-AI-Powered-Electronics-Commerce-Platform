-- PREPARED ONLY. Not applied anywhere. Requires separate DEV/PROD authorization.
-- ElectroHub refresh-token rotation lineage and session families.
-- Migration: 20261013000000_refresh_token_rotation_lineage
--
-- OWNER-VISIBLE DECISION: this migration INVALIDATES EVERY EXISTING REFRESH-TOKEN SESSION.
-- Every user must sign in again after cutover. Access tokens (15 min) keep working until they expire.
--
-- WHY: refresh_tokens never stored successor relationships, so the session family of a legacy row
-- cannot be reconstructed from durable data. Giving rows families by default would leave a revoked
-- ancestor T1 and its active successor T2 in different families, so a family logout or replay
-- revocation of T1 could leave T2 alive. Revoking every legacy row removes that possibility: after
-- this migration no legacy row is active, so no legacy descendant can outlive an invalidated session.
-- Nothing is inferred from token age, rotation timing, or process memory.
--
-- ROW SEMANTICS AFTER CUTOVER: every legacy row is revoked with expiresAt = epoch (the same
-- revocation contract used by logout) and is its own single-row family ("familyId" = row "id").
-- Revoked rows remain for audit; they carry no successor links.
--
-- COMPATIBILITY ENFORCEMENT: "familyId" is NOT NULL with NO default. An old-version application
-- instance cannot insert a refresh token (its INSERT omits "familyId"), so it cannot commit a login
-- or a rotation under the old protocol. It fails closed instead of creating disconnected families.
-- See docs/06_Database/REFRESH_TOKEN_LINEAGE.md for the cutover runbook: old instances must be
-- stopped BEFORE this migration so users are not mid-request when sessions are revoked.
--
-- LOCKING (from PostgreSQL documentation; not measured here): ADD COLUMN without a default is a
-- catalog-only change. The UPDATE rewrites each row (a legacy row is written once). SET NOT NULL
-- scans the table while holding ACCESS EXCLUSIVE. Table size is bounded by 7-day tokens plus audit
-- rows. Run inside the maintenance window with the application stopped.
--
-- ATOMICITY: every statement below runs inside the explicit BEGIN/COMMIT (the same pattern as the
-- already-applied 20261006000000_checkout_core and 20261007000000_stripe_orchestration migrations).
-- All statements are transactional DDL/DML (no CREATE INDEX CONCURRENTLY), so a failure at any point
-- aborts the transaction and PostgreSQL rolls back every change; a dropped connection also rolls back.
-- Prisma still records a failed run in "_prisma_migrations" and refuses further deploys until the
-- operator confirms the columns are absent and runs `prisma migrate resolve --rolled-back`.
-- "lock_timeout" makes the migration fail fast (and roll back) instead of queueing an ACCESS EXCLUSIVE
-- request behind a long transaction, which would block every other query on the table meanwhile.

BEGIN;

SET LOCAL lock_timeout = '10s';

ALTER TABLE "refresh_tokens"
  ADD COLUMN "familyId" UUID,
  ADD COLUMN "replacedByTokenHash" VARCHAR(255);

UPDATE "refresh_tokens"
SET "familyId" = "id",
    "isRevoked" = true,
    "expiresAt" = TIMESTAMP '1970-01-01 00:00:00',
    "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" SET NOT NULL;

-- A token can never be recorded as its own successor.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_no_self_replacement_check"
  CHECK ("replacedByTokenHash" IS NULL OR "replacedByTokenHash" <> "tokenHash");

-- Family-wide revocation (logout) filters on familyId.
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- A token has at most one predecessor (NULLs are exempt). Forward successor lookup reads the
-- old row's pointer by its unique "tokenHash"; this index enforces integrity.
CREATE UNIQUE INDEX "refresh_tokens_replacedByTokenHash_key" ON "refresh_tokens"("replacedByTokenHash");

COMMIT;
