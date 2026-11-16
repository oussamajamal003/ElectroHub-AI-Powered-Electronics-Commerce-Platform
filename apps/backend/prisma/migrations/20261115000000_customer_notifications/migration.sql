-- Extend the existing transactional email queue; no order status changes.
ALTER TYPE "CommerceEmailType" ADD VALUE IF NOT EXISTS 'CUSTOMER_WELCOME';
ALTER TABLE "commerce_email_outbox" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_aggregate_check"
  CHECK (("type"::text = 'CUSTOMER_WELCOME' AND "orderId" IS NULL AND "paymentId" IS NULL)
    OR ("type"::text <> 'CUSTOMER_WELCOME' AND "orderId" IS NOT NULL));
CREATE TABLE "customer_notifications" (
  "id" UUID PRIMARY KEY,
  "eventKey" VARCHAR(255) NOT NULL UNIQUE,
  "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "orderId" UUID NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" VARCHAR(32) NOT NULL CHECK ("type" = 'ORDER_OUT_FOR_DELIVERY'),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "readAt" TIMESTAMP(3)
);
CREATE INDEX "customer_notifications_userId_occurredAt_id_idx" ON "customer_notifications"("userId", "occurredAt", "id");
CREATE INDEX "customer_notifications_userId_readAt_idx" ON "customer_notifications"("userId", "readAt");
CREATE INDEX "customer_notifications_orderId_idx" ON "customer_notifications"("orderId");
ALTER TABLE "customer_notifications" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "customer_notifications" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "customer_notifications" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "customer_notifications" FROM authenticated; END IF;
END $$;
