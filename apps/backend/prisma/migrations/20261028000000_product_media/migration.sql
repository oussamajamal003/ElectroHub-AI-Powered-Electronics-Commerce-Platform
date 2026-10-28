BEGIN;

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "byteSize" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "mediaState" VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "sourceMimeType" VARCHAR(64),
ADD COLUMN     "sourceRevision" UUID,
ADD COLUMN     "sourceSha256" CHAR(64),
ADD COLUMN     "storageBucket" VARCHAR(100),
ADD COLUMN     "storagePath" VARCHAR(512),
ADD COLUMN     "storageProvider" VARCHAR(32) NOT NULL DEFAULT 'LEGACY_LOCAL',
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "catalog_media_events" (
    "id" UUID NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "requestSha256" CHAR(64) NOT NULL,
    "productId" UUID NOT NULL,
    "productImageId" UUID NOT NULL,
    "operation" VARCHAR(24) NOT NULL,
    "sourceRevision" UUID,
    "sourceSha256" CHAR(64),
    "state" VARCHAR(24) NOT NULL DEFAULT 'READY',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedUntil" TIMESTAMP(3),
    "leaseToken" UUID,
    "lastErrorCode" VARCHAR(80),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_media_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_media_events_idempotencyKey_key" ON "catalog_media_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "catalog_media_events_state_nextAttemptAt_idx" ON "catalog_media_events"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "catalog_media_events_productImageId_createdAt_idx" ON "catalog_media_events"("productImageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_storagePath_key" ON "product_images"("storagePath");

-- Fail rather than silently rewrite legacy duplicate primaries. Preflight must repair any conflict separately.
CREATE UNIQUE INDEX product_images_published_primary_key ON "product_images"("productId")
WHERE "isPrimary" AND "mediaState" = 'PUBLISHED';
ALTER TABLE product_images ADD CONSTRAINT product_images_media_state_check
CHECK ("mediaState" IN ('PUBLISHED','RETIRED'));
ALTER TABLE product_images ADD CONSTRAINT product_images_source_check CHECK ((
  ("sourceRevision" IS NULL AND "sourceSha256" IS NULL) OR
  ("sourceRevision" IS NOT NULL AND "sourceSha256" ~ '^[a-f0-9]{64}$'
    AND "storageProvider" = 'SUPABASE_STORAGE' AND "storageBucket" = 'product-media'
    AND "storagePath" IS NOT NULL AND "sourceMimeType" = 'image/webp'
    AND "width" BETWEEN 128 AND 6000 AND "height" BETWEEN 128 AND 6000
    AND "width"::bigint * "height"::bigint <= 20000000 AND "byteSize" > 0)) IS TRUE);
ALTER TABLE catalog_media_events ADD CONSTRAINT catalog_media_events_state_check
CHECK (state IN ('READY','CLAIMED','RETRY_WAIT','COMPLETED','PERMANENT_FAILURE','SUPERSEDED'));
ALTER TABLE catalog_media_events ADD CONSTRAINT catalog_media_events_attempt_check CHECK ("attemptCount" >= 0);
ALTER TABLE catalog_media_events ADD CONSTRAINT catalog_media_events_digest_check
CHECK ("requestSha256" ~ '^[a-f0-9]{64}$' AND ("sourceSha256" IS NULL OR "sourceSha256" ~ '^[a-f0-9]{64}$'));
ALTER TABLE catalog_media_events ADD CONSTRAINT catalog_media_events_image_fkey
FOREIGN KEY ("productImageId") REFERENCES product_images(id) ON DELETE RESTRICT;
ALTER TABLE catalog_media_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalog_media_events FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON catalog_media_events FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON catalog_media_events FROM authenticated; END IF;
END $$;

COMMIT;
