-- Reviewed precondition: Order tables are empty. Never invent historical checkout data.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "orders") THEN
    RAISE EXCEPTION 'Checkout migration requires an explicit historical Order backfill review';
  END IF;
END $$;

CREATE TYPE "CheckoutDeliveryMethod" AS ENUM ('STANDARD', 'EXPRESS', 'OVERNIGHT');
CREATE TYPE "CheckoutPaymentMethod" AS ENUM ('CARD');
ALTER TABLE "orders"
  ADD COLUMN "checkoutAttemptId" UUID NOT NULL,
  ADD COLUMN "checkoutRequestHash" VARCHAR(64) NOT NULL,
  ADD COLUMN "deliveryMethod" "CheckoutDeliveryMethod" NOT NULL,
  ADD COLUMN "paymentMethod" "CheckoutPaymentMethod" NOT NULL,
  ADD COLUMN "shippingPhone" VARCHAR(32) NOT NULL,
  ADD COLUMN "estimatedDeliveryStart" DATE NOT NULL,
  ADD COLUMN "estimatedDeliveryEnd" DATE NOT NULL,
  ADD CONSTRAINT "orders_money_nonnegative" CHECK ("subtotal" >= 0 AND "shippingCost" >= 0 AND "total" >= 0),
  ADD CONSTRAINT "orders_delivery_window_valid" CHECK ("estimatedDeliveryEnd" >= "estimatedDeliveryStart");
ALTER TABLE "order_items"
  ADD COLUMN "productImageUrl" VARCHAR(2048),
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_money_nonnegative" CHECK ("unitPrice" >= 0 AND "lineTotal" >= 0);
CREATE UNIQUE INDEX "orders_userId_checkoutAttemptId_key" ON "orders"("userId", "checkoutAttemptId");
COMMIT;
