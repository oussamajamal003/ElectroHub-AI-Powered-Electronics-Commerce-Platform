-- Task 04.5 Delivery Tracking Foundation: additive only (4 enums, 6 nullable/defaulted deliveries columns, delivery_events).
-- No backfill: existing orders get no Delivery and no events, so no history is ever fabricated. Rollback SQL: down.sql (manual, before writes).

-- CreateEnum
CREATE TYPE "DeliveryEventType" AS ENUM ('TRACKING_STARTED', 'STATUS_CHANGED', 'LOCATION_UPDATED', 'LOCATION_CLEARED', 'ETA_UPDATED', 'ETA_CLEARED', 'SIMULATION_STARTED', 'SIMULATION_STOPPED');

-- CreateEnum
CREATE TYPE "DeliveryEventSource" AS ENUM ('ADMIN', 'SIMULATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DeliveryEventChange" AS ENUM ('STATUS', 'LOCATION', 'ETA');

-- CreateEnum
CREATE TYPE "DeliveryLocationSource" AS ENUM ('MANUAL', 'SIMULATED');

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "etaUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "isSimulated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationLabel" VARCHAR(80),
ADD COLUMN     "locationSource" "DeliveryLocationSource",
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "type" "DeliveryEventType" NOT NULL,
    "changes" "DeliveryEventChange"[],
    "source" "DeliveryEventSource" NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus",
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "estimatedAt" TIMESTAMP(3),
    "actorUserId" UUID,
    "note" VARCHAR(280),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_events_deliveryId_occurredAt_idx" ON "delivery_events"("deliveryId", "occurredAt");

-- CreateIndex
CREATE INDEX "delivery_events_type_occurredAt_idx" ON "delivery_events"("type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_events_deliveryId_revision_key" ON "delivery_events"("deliveryId", "revision");

-- CreateIndex
CREATE INDEX "deliveries_status_updatedAt_idx" ON "deliveries"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Guards Prisma cannot express. NULL coordinates pass the range checks; the pair must be both set or both NULL.
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_revision_nonnegative_check" CHECK ("revision" >= 0);
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_coordinates_range_check"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_coordinates_pair_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_revision_positive_check" CHECK ("revision" >= 1);
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_coordinates_range_check"
  CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_coordinates_pair_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));

-- Private customer data: Express (table owner) is the only reader/writer. No PostgREST/anon access.
ALTER TABLE "delivery_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "delivery_events" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "delivery_events" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "delivery_events" FROM authenticated;
  END IF;
END $$;
