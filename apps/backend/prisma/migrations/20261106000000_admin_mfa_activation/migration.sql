-- Task 05.2 existing-administrator MFA activation: one owner-authorized, single-use, hashed credential per factor-less administrator.
ALTER TYPE "EmailType" ADD VALUE 'ADMIN_ACTIVATION';

CREATE TYPE "AdminActivationStatus" AS ENUM ('PENDING', 'REDEEMED', 'REVOKED');

CREATE TABLE "admin_mfa_activations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "authorizedById" UUID,
    "email" VARCHAR(255) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "AdminActivationStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryStatus" "AdminInvitationDelivery" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mfa_activations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_mfa_activations_tokenHash_key" ON "admin_mfa_activations"("tokenHash");
CREATE INDEX "admin_mfa_activations_userId_status_idx" ON "admin_mfa_activations"("userId", "status");
-- At most one live activation per administrator, even under concurrent Owner requests.
CREATE UNIQUE INDEX "admin_mfa_activations_pending_user_key" ON "admin_mfa_activations"("userId") WHERE "status" = 'PENDING';

ALTER TABLE "admin_mfa_activations" ADD CONSTRAINT "admin_mfa_activations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_mfa_activations" ADD CONSTRAINT "admin_mfa_activations_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
