CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "reviews_body_length_check" CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000)
);

CREATE UNIQUE INDEX "reviews_productId_userId_key" ON "reviews"("productId", "userId");
CREATE INDEX "reviews_productId_createdAt_id_idx" ON "reviews"("productId", "createdAt", "id");
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
