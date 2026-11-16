-- Task 05.2 operator provisioning for seeded DEV administrators that have no deliverable mailbox.
-- Additive only: existing activations keep their behaviour (purpose defaults to OWNER_ACTIVATION); no existing row is rewritten.

CREATE TYPE "AdminActivationPurpose" AS ENUM ('OWNER_ACTIVATION', 'SEED_PROVISIONING');
CREATE TYPE "AdminSeedIdentitySource" AS ENUM ('SEED', 'OPERATOR');

ALTER TABLE "admin_mfa_activations"
    ADD COLUMN "purpose" "AdminActivationPurpose" NOT NULL DEFAULT 'OWNER_ACTIVATION',
    ADD COLUMN "operatorName" VARCHAR(120),
    ADD COLUMN "operatorReason" VARCHAR(500);

-- Provenance of an approved seed identity, bound to the exact user id. An email match alone never makes an account a seed identity:
-- a recreated account with the same address has a different id and no row until an operator approves it explicitly.
CREATE TABLE "admin_seed_identities" (
    "userId" UUID NOT NULL,
    "seedEmail" VARCHAR(255) NOT NULL,
    "source" "AdminSeedIdentitySource" NOT NULL,
    "approvedBy" VARCHAR(120),
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_seed_identities_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "admin_seed_identities_seedEmail_key" ON "admin_seed_identities"("seedEmail");

ALTER TABLE "admin_seed_identities" ADD CONSTRAINT "admin_seed_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
