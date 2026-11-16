ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_threshold_nonnegative" CHECK ("lowStockAt" >= 0);
