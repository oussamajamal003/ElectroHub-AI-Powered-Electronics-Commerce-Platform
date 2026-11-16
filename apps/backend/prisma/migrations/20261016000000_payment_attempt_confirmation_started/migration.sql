-- PREPARED ONLY. Not applied anywhere except the disposable acceptance database. Requires separate DEV/PROD authorization.
-- Migration: 20261016000000_payment_attempt_confirmation_started
-- Additive and nullable: a metadata-only change. No backfill, no default, no existing row is modified.
-- Records that the client announced it is about to confirm the PaymentIntent with Stripe. It is intent only: it is never proof that
-- Stripe received a confirmation and never a financial status. Authoritative outcomes still come from Stripe reconciliation.
-- CI hazard: this folder must not be pushed while CI runs migrate deploy against shared DEV (see REFRESH_TOKEN_MIGRATION_CI_HANDOFF.md).

ALTER TABLE "payment_attempts" ADD COLUMN "confirmationStartedAt" TIMESTAMP(3);
