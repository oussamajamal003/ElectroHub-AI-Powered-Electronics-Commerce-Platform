-- New orders capture the seller identity in the order transaction. NULL is retained for historical orders and uses the legacy brand.
ALTER TABLE "orders" ADD COLUMN "storeIdentitySnapshot" JSONB;
