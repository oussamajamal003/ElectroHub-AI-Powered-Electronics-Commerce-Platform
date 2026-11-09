-- Durable internal outbox for committed inventory-category transitions. No public grants or RLS policies are introduced:
-- browser clients never access this table, and the trusted Prisma backend owns the processing path.
ALTER TYPE "EmailDeliveryStatus" ADD VALUE IF NOT EXISTS 'SENDING';

ALTER TABLE "email_deliveries"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "stockAlertEventId" UUID;

CREATE TABLE "stock_alert_events" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "previousStatus" "InventoryStatus",
  "status" "InventoryStatus" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lowStockAt" INTEGER NOT NULL,
  "productName" VARCHAR(255) NOT NULL,
  "sku" VARCHAR(100) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_alert_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_alert_events_processedAt_createdAt_idx" ON "stock_alert_events"("processedAt", "createdAt");
CREATE INDEX "stock_alert_events_productId_createdAt_idx" ON "stock_alert_events"("productId", "createdAt");
CREATE INDEX "email_deliveries_stockAlertEventId_status_nextAttemptAt_idx" ON "email_deliveries"("stockAlertEventId", "status", "nextAttemptAt");
CREATE UNIQUE INDEX "email_deliveries_stockAlertEventId_userId_key" ON "email_deliveries"("stockAlertEventId", "userId");

ALTER TABLE "stock_alert_events"
  ADD CONSTRAINT "stock_alert_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_alert_events_productId_inventory_fkey" FOREIGN KEY ("productId") REFERENCES "inventory"("productId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_stockAlertEventId_fkey" FOREIGN KEY ("stockAlertEventId") REFERENCES "stock_alert_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_alert_events" ENABLE ROW LEVEL SECURITY;
