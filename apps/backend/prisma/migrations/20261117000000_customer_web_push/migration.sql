CREATE TABLE "customer_push_subscriptions" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "familyId" UUID NOT NULL, "endpoint" VARCHAR(2048) NOT NULL UNIQUE,
 "p256dh" VARCHAR(128) NOT NULL, "auth" VARCHAR(64) NOT NULL, "vapidKey" VARCHAR(128) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',now()), "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "customer_push_subscriptions_userId_familyId_revokedAt_idx" ON "customer_push_subscriptions"("userId", "familyId", "revokedAt");
CREATE TABLE "customer_push_deliveries" (
 "id" UUID PRIMARY KEY,
 "notificationId" UUID NOT NULL REFERENCES "customer_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "subscriptionId" UUID NOT NULL REFERENCES "customer_push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "state" VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK ("state" IN ('QUEUED','LEASED','RETRY','ACCEPTED','FAILED','EXPIRED','REVOKED')),
 "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
 "availableAt" TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC',now()), "leaseUntil" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "lastCode" VARCHAR(32),
 UNIQUE("notificationId", "subscriptionId")
);
CREATE INDEX "customer_push_deliveries_state_availableAt_idx" ON "customer_push_deliveries"("state", "availableAt");
CREATE INDEX "customer_push_deliveries_subscriptionId_idx" ON "customer_push_deliveries"("subscriptionId");
ALTER TABLE "customer_push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_push_deliveries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "customer_push_subscriptions", "customer_push_deliveries" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "customer_push_subscriptions", "customer_push_deliveries" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "customer_push_subscriptions", "customer_push_deliveries" FROM authenticated; END IF;
END $$;
