-- Manual rollback for 20261031000000_delivery_tracking. Only safe BEFORE any delivery tracking write; after writes, roll back the app
-- deploy and leave this additive schema in place. Not run by `prisma migrate`.
DROP TABLE IF EXISTS "delivery_events";
DROP INDEX IF EXISTS "deliveries_status_updatedAt_idx";
ALTER TABLE "deliveries" DROP CONSTRAINT IF EXISTS "deliveries_revision_nonnegative_check",
  DROP CONSTRAINT IF EXISTS "deliveries_coordinates_range_check", DROP CONSTRAINT IF EXISTS "deliveries_coordinates_pair_check",
  DROP COLUMN IF EXISTS "etaUpdatedAt", DROP COLUMN IF EXISTS "isSimulated", DROP COLUMN IF EXISTS "locationLabel",
  DROP COLUMN IF EXISTS "locationSource", DROP COLUMN IF EXISTS "locationUpdatedAt", DROP COLUMN IF EXISTS "revision";
DROP TYPE IF EXISTS "DeliveryEventType";
DROP TYPE IF EXISTS "DeliveryEventSource";
DROP TYPE IF EXISTS "DeliveryEventChange";
DROP TYPE IF EXISTS "DeliveryLocationSource";
