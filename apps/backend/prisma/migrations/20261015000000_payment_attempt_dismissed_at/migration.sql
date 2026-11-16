-- PREPARED ONLY. Not applied anywhere. Requires separate DEV/PROD authorization.
-- Migration: 20261015000000_payment_attempt_dismissed_at
-- Additive and nullable: a metadata-only change. No backfill, no default, no existing row is modified.
-- Customer-only hide for failed payment cards. Financial and audit records are never deleted by this column.
-- CI hazard: this folder must not be pushed while CI runs migrate deploy against shared DEV (see REFRESH_TOKEN_MIGRATION_CI_HANDOFF.md).

ALTER TABLE "payment_attempts" ADD COLUMN "dismissedAt" TIMESTAMP(3);
