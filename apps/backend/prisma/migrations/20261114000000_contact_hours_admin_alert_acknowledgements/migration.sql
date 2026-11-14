-- Additive only: one nullable column and one new table. No existing row is rewritten and no data is dropped.
-- Not applied to any shared environment from this change; apply through the normal migration workflow.

-- Public Contact page opening hours (free text, nullable = not configured).
ALTER TABLE "store_settings" ADD COLUMN "businessHours" VARCHAR(255);

-- Per-administrator acknowledged baseline for the header alerts. Browsers never access this table.
CREATE TABLE "admin_alert_acknowledgements" (
  "userId" UUID NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "acknowledgedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_alert_acknowledgements_pkey" PRIMARY KEY ("userId", "category"),
  CONSTRAINT "admin_alert_acknowledgements_count_check" CHECK ("acknowledgedCount" >= 0),
  CONSTRAINT "admin_alert_acknowledgements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "admin_alert_acknowledgements" ENABLE ROW LEVEL SECURITY;
