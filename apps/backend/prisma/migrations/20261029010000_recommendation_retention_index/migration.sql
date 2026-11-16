-- Supports the global 90-day retention sweep over recently viewed rows.
-- The existing (userId, lastViewedAt) index is not usable for lastViewedAt-only filtering.
CREATE INDEX "recently_viewed_products_lastViewedAt_idx"
  ON "recently_viewed_products"("lastViewedAt");
