BEGIN;

-- CreateEnum
CREATE TYPE "PaymentAttemptState" AS ENUM ('PREPARING', 'AWAITING_INPUT', 'ACTION_REQUIRED', 'DECLINED', 'PROCESSING', 'AUTHORIZED', 'CAPTURE_PENDING', 'PAID', 'CANCEL_PENDING', 'CANCELED', 'COMPENSATION_PENDING', 'COMPENSATED', 'REFUND_PENDING', 'REFUNDED', 'INCIDENT');

-- CreateEnum
CREATE TYPE "PaymentWorkState" AS ENUM ('READY', 'LEASED', 'DONE', 'INCIDENT');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_CAPTURE';

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_orderId_fkey";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cardBrand" VARCHAR(32),
ADD COLUMN     "cardLast4" VARCHAR(4),
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cartId" UUID,
    "cartIdentity" UUID NOT NULL,
    "activeCartId" UUID,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "revision" VARCHAR(64) NOT NULL,
    "request" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "shippingCost" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "stripeAccountId" VARCHAR(255) NOT NULL,
    "providerIntentId" VARCHAR(255),
    "providerStatus" VARCHAR(64),
    "state" "PaymentAttemptState" NOT NULL DEFAULT 'PREPARING',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" VARCHAR(64),
    "authorizationExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "orderId" UUID,
    "refundId" VARCHAR(255),
    "refundAmountCents" INTEGER,
    "compensatedAt" TIMESTAMP(3),
    "recoveryRemainder" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempt_items" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productName" VARCHAR(255) NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "imageUrl" VARCHAR(2048),
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_attempt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_work" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "state" "PaymentWorkState" NOT NULL DEFAULT 'READY',
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "lastError" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "providerIntentId" VARCHAR(255),
    "attemptId" UUID,
    "disposition" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_activeCartId_key" ON "payment_attempts"("activeCartId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_providerIntentId_key" ON "payment_attempts"("providerIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_orderId_key" ON "payment_attempts"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_refundId_key" ON "payment_attempts"("refundId");

-- CreateIndex
CREATE INDEX "payment_attempts_userId_createdAt_idx" ON "payment_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_attempts_cartId_idx" ON "payment_attempts"("cartId");

-- CreateIndex
CREATE INDEX "payment_attempts_state_expiresAt_idx" ON "payment_attempts"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_userId_idempotencyKey_key" ON "payment_attempts"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_attempt_items_productId_idx" ON "payment_attempt_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_items_attemptId_productId_key" ON "payment_attempt_items"("attemptId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_work_attemptId_key" ON "payment_work"("attemptId");

-- CreateIndex
CREATE INDEX "payment_work_state_nextRunAt_idx" ON "payment_work"("state", "nextRunAt");

-- CreateIndex
CREATE INDEX "payment_work_state_leaseUntil_idx" ON "payment_work"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "stripe_events_attemptId_idx" ON "stripe_events"("attemptId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempt_items" ADD CONSTRAINT "payment_attempt_items_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempt_items" ADD CONSTRAINT "payment_attempt_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_work" ADD CONSTRAINT "payment_work_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exact USD money, immutable purchase quantities and bounded worker claims.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_money_check"
  CHECK ("currency" = 'USD' AND "subtotal" >= 0 AND "shippingCost" >= 0 AND "total" = "subtotal" + "shippingCost"
    AND "amountCents" BETWEEN 50 AND 99999999 AND "amountCents" = "total" * 100
    AND ("refundAmountCents" IS NULL OR "refundAmountCents" > 0));
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_identity_check"
  CHECK ("requestHash" ~ '^[a-f0-9]{64}$' AND "revision" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("request") = 'object' AND ("activeCartId" IS NULL OR "activeCartId" = "cartIdentity"));
ALTER TABLE "payment_attempt_items" ADD CONSTRAINT "payment_attempt_items_money_quantity_check"
  CHECK ("quantity" BETWEEN 1 AND 999 AND "unitPrice" >= 0 AND "lineTotal" = "unitPrice" * "quantity");
ALTER TABLE "payment_work" ADD CONSTRAINT "payment_work_lease_check"
  CHECK ("retryCount" BETWEEN 0 AND 12 AND (("state" = 'LEASED' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR ("state" <> 'LEASED' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_card_check"
  CHECK ("amount" >= 0 AND ("cardLast4" IS NULL OR "cardLast4" ~ '^[0-9]{4}$'));

-- These internal financial tables are not browser Data API surfaces. Prisma uses the server DB role.
ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempt_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_work" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "payment_attempts", "payment_attempt_items", "payment_work", "stripe_events" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "payment_attempts", "payment_attempt_items", "payment_work", "stripe_events" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "payment_attempts", "payment_attempt_items", "payment_work", "stripe_events" FROM authenticated;
  END IF;
END $$;

COMMIT;
