BEGIN;

-- CreateTable
CREATE TABLE "recommendation_preferences" (
    "userId" UUID NOT NULL,
    "personalizationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "product_interactions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "eventType" VARCHAR(32) NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recently_viewed_products" (
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recently_viewed_products_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateTable
CREATE TABLE "recommendation_events" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "eventType" VARCHAR(16) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "strategy" VARCHAR(32) NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "rank" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_interactions_userId_occurredAt_idx" ON "product_interactions"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "product_interactions_productId_eventType_occurredAt_idx" ON "product_interactions"("productId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "product_interactions_occurredAt_idx" ON "product_interactions"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_interactions_userId_idempotencyKey_key" ON "product_interactions"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "recently_viewed_products_userId_lastViewedAt_idx" ON "recently_viewed_products"("userId", "lastViewedAt");

-- CreateIndex
CREATE INDEX "recommendation_events_productId_eventType_occurredAt_idx" ON "recommendation_events"("productId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "recommendation_events_occurredAt_idx" ON "recommendation_events"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_events_batchId_productId_eventType_key" ON "recommendation_events"("batchId", "productId", "eventType");

-- AddForeignKey
ALTER TABLE "recommendation_preferences" ADD CONSTRAINT "recommendation_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_interactions" ADD CONSTRAINT "product_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_interactions" ADD CONSTRAINT "product_interactions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_products" ADD CONSTRAINT "recently_viewed_products_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_products" ADD CONSTRAINT "recently_viewed_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Task 04.4 integrity: allowlisted event vocabularies, bounded values and a consent timestamp only when enabled.
ALTER TABLE "product_interactions" ADD CONSTRAINT "product_interactions_event_type_check"
  CHECK ("eventType" IN ('VIEW', 'RECOMMENDATION_CLICK'));
ALTER TABLE "product_interactions" ADD CONSTRAINT "product_interactions_surface_check"
  CHECK ("surface" ~ '^[a-z_]{1,32}$');
ALTER TABLE "product_interactions" ADD CONSTRAINT "product_interactions_idempotency_key_check"
  CHECK ("idempotencyKey" ~ '^[A-Za-z0-9:_-]{8,100}$');
ALTER TABLE "recently_viewed_products" ADD CONSTRAINT "recently_viewed_products_view_count_check"
  CHECK ("viewCount" BETWEEN 1 AND 1000000);
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_event_type_check"
  CHECK ("eventType" IN ('IMPRESSION', 'CLICK'));
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_mode_check"
  CHECK ("mode" IN ('SIMILAR_PRODUCTS', 'YOU_MAY_ALSO_LIKE', 'RECOMMENDED_FOR_YOU', 'FREQUENTLY_BOUGHT_TOGETHER', 'POPULAR_PRODUCTS'));
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_strategy_check"
  CHECK ("strategy" ~ '^[A-Z_]{1,32}$');
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_surface_check"
  CHECK ("surface" ~ '^[a-z_]{1,32}$');
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_rank_check"
  CHECK ("rank" BETWEEN 1 AND 100);

-- Private customer data: Express (table owner) is the only reader/writer. No PostgREST/anon access, no AI role grants.
ALTER TABLE "recommendation_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_interactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recently_viewed_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recommendation_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "recommendation_preferences", "product_interactions", "recently_viewed_products", "recommendation_events" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "recommendation_preferences", "product_interactions", "recently_viewed_products", "recommendation_events" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "recommendation_preferences", "product_interactions", "recently_viewed_products", "recommendation_events" FROM authenticated;
  END IF;
END $$;

COMMIT;
