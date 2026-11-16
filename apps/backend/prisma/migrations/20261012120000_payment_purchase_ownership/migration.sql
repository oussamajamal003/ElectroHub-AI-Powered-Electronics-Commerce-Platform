-- PREPARED ONLY. Requires separate DEV/PROD authorization.
-- Additive compatibility: historical attempts retain the legacy guarded commit path.
ALTER TABLE "payment_attempts" ADD COLUMN "submittedAt" TIMESTAMP(3), ADD COLUMN "restoredAt" TIMESTAMP(3),
  ADD COLUMN "notificationReadState" VARCHAR(32);
ALTER TABLE "payment_attempt_items" ADD COLUMN "sourceCartItemId" UUID, ADD COLUMN "snapshotCartItemId" UUID;
-- One cart-line generation can be transferred to at most one purchase.
CREATE UNIQUE INDEX "payment_attempt_items_sourceCartItemId_key" ON "payment_attempt_items" ("sourceCartItemId");

ALTER TABLE "payment_attempts" ADD CONSTRAINT "submitted_purchase_releases_active_cart"
  CHECK ("submittedAt" IS NULL OR "activeCartId" IS NULL);
