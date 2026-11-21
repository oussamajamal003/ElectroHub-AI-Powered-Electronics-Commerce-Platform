-- Additive Task 06.3 marker for a single operator-authorized initial-owner invitation.
ALTER TABLE "admin_invitations"
  ADD COLUMN "isBootstrap" BOOLEAN NOT NULL DEFAULT false;

-- At most one pending bootstrap invitation may exist; accepted/revoked history is retained.
CREATE UNIQUE INDEX "admin_invitations_one_pending_bootstrap_key"
  ON "admin_invitations" ("isBootstrap")
  WHERE "isBootstrap" = true AND "status" = 'PENDING';
