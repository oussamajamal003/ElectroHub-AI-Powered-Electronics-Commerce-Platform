-- Task 05.2: administrator security (invitations, TOTP, recovery codes, WebAuthn, MFA-assured sessions, audit), store/shipping/
-- notification settings, recommendation section configuration + featured pins, and analytics events. ADDITIVE ONLY: no existing
-- column, constraint or row is changed or removed. The shipping seed reproduces the previous hard-coded checkout terms exactly
-- (03.5-v1: STANDARD 0.00, EXPRESS 9.99, OVERNIGHT 19.99, no threshold), so every existing cart revision stays valid.
-- Forward repair only (no down migration once written): disable features in code, never drop tables holding audit history.

-- CreateEnum
CREATE TYPE "AdminInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AdminInvitationDelivery" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AdminChallengePurpose" AS ENUM ('LOGIN', 'STEP_UP', 'WEBAUTHN_REGISTRATION');

-- CreateEnum
CREATE TYPE "AdminMfaMethod" AS ENUM ('TOTP', 'WEBAUTHN', 'RECOVERY_CODE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_MFA_CHALLENGE_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_MFA_ENROLLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_MFA_DISABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_RECOVERY_CODES_REGENERATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_RECOVERY_CODE_USED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_PASSKEY_ADDED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_PASSKEY_REMOVED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_SESSION_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_STEP_UP_VERIFIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailType" ADD VALUE 'ADMIN_INVITATION';
ALTER TYPE "EmailType" ADD VALUE 'ADMIN_NOTIFICATION';

-- CreateTable
CREATE TABLE "admin_account_security" (
    "userId" UUID NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "canManageAdmins" BOOLEAN NOT NULL DEFAULT false,
    "enrollmentAllowedUntil" TIMESTAMP(3),
    "mfaEnrolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_account_security_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "admin_mfa_factors" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "secretCiphertext" VARCHAR(255) NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "lastUsedStep" BIGINT,
    "verifiedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_webauthn_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" VARCHAR(512) NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" VARCHAR(32) NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(60) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_auth_challenges" (
    "id" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "AdminChallengePurpose" NOT NULL,
    "sessionFamilyId" UUID,
    "credentialFingerprint" VARCHAR(64) NOT NULL,
    "webauthnChallenge" VARCHAR(128),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "familyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mfaMethod" "AdminMfaMethod" NOT NULL,
    "mfaVerifiedAt" TIMESTAMP(3) NOT NULL,
    "stepUpAt" TIMESTAMP(3),
    "userAgent" VARCHAR(300),
    "ipAddress" VARCHAR(64),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("familyId")
);

-- CreateTable
CREATE TABLE "admin_invitations" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "invitedById" UUID,
    "status" "AdminInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryStatus" "AdminInvitationDelivery" NOT NULL DEFAULT 'PENDING',
    "grantManageAdmins" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "acceptedUserId" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "resourceType" VARCHAR(40) NOT NULL,
    "resourceId" VARCHAR(100),
    "outcome" VARCHAR(16) NOT NULL,
    "details" JSONB,
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'default',
    "storeName" VARCHAR(120) NOT NULL,
    "supportEmail" VARCHAR(255),
    "supportPhone" VARCHAR(32),
    "addressLine1" VARCHAR(255),
    "addressLine2" VARCHAR(255),
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "postalCode" VARCHAR(20),
    "country" VARCHAR(100),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_settings" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'default',
    "freeShippingThreshold" DECIMAL(12,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_method_settings" (
    "method" "CheckoutDeliveryMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_method_settings_pkey" PRIMARY KEY ("method")
);

-- CreateTable
CREATE TABLE "admin_notification_preferences" (
    "userId" UUID NOT NULL,
    "orderPaid" BOOLEAN NOT NULL DEFAULT true,
    "lowStock" BOOLEAN NOT NULL DEFAULT true,
    "invitationAccepted" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_notification_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "recommendation_section_configs" (
    "surface" VARCHAR(32) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "itemLimit" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_section_configs_pkey" PRIMARY KEY ("surface","mode")
);

-- CreateTable
CREATE TABLE "featured_product_pins" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "position" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "featured_product_pins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "outcome" VARCHAR(24),
    "correlationId" UUID,
    "productId" UUID,
    "resultCount" INTEGER,
    "durationMs" INTEGER,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_account_security_isOwner_idx" ON "admin_account_security"("isOwner");

-- CreateIndex
CREATE INDEX "admin_mfa_factors_userId_idx" ON "admin_mfa_factors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_recovery_codes_codeHash_key" ON "admin_recovery_codes"("codeHash");

-- CreateIndex
CREATE INDEX "admin_recovery_codes_userId_batchId_idx" ON "admin_recovery_codes"("userId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_webauthn_credentials_credentialId_key" ON "admin_webauthn_credentials"("credentialId");

-- CreateIndex
CREATE INDEX "admin_webauthn_credentials_userId_idx" ON "admin_webauthn_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_auth_challenges_tokenHash_key" ON "admin_auth_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_auth_challenges_userId_purpose_idx" ON "admin_auth_challenges"("userId", "purpose");

-- CreateIndex
CREATE INDEX "admin_auth_challenges_expiresAt_idx" ON "admin_auth_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "admin_sessions_userId_createdAt_idx" ON "admin_sessions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_tokenHash_key" ON "admin_invitations"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_acceptedUserId_key" ON "admin_invitations"("acceptedUserId");

-- CreateIndex
CREATE INDEX "admin_invitations_status_createdAt_idx" ON "admin_invitations"("status", "createdAt");

-- CreateIndex
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");

-- CreateIndex
CREATE INDEX "admin_audit_logs_resourceType_createdAt_idx" ON "admin_audit_logs"("resourceType", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actorId_createdAt_idx" ON "admin_audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "featured_product_pins_surface_enabled_position_idx" ON "featured_product_pins"("surface", "enabled", "position");

-- CreateIndex
CREATE UNIQUE INDEX "featured_product_pins_surface_productId_key" ON "featured_product_pins"("surface", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_idempotencyKey_key" ON "analytics_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "analytics_events_type_occurredAt_idx" ON "analytics_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_events_occurredAt_idx" ON "analytics_events"("occurredAt");

-- AddForeignKey
ALTER TABLE "admin_account_security" ADD CONSTRAINT "admin_account_security_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_mfa_factors" ADD CONSTRAINT "admin_mfa_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_webauthn_credentials" ADD CONSTRAINT "admin_webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_auth_challenges" ADD CONSTRAINT "admin_auth_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notification_preferences" ADD CONSTRAINT "admin_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_product_pins" ADD CONSTRAINT "featured_product_pins_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One outstanding invitation per recipient; accepted/revoked rows remain as history.
CREATE UNIQUE INDEX "admin_invitations_pending_email_key" ON "admin_invitations"("email") WHERE "status" = 'PENDING';

-- Integrity constraints Prisma cannot express.
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_email_normalized_check" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_state_check" CHECK (
  ("status" = 'ACCEPTED') = ("acceptedAt" IS NOT NULL) AND ("status" = 'REVOKED') = ("revokedAt" IS NOT NULL));
ALTER TABLE "admin_auth_challenges" ADD CONSTRAINT "admin_auth_challenges_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= "maxAttempts");
ALTER TABLE "admin_auth_challenges" ADD CONSTRAINT "admin_auth_challenges_binding_check" CHECK ("purpose" = 'LOGIN' OR "sessionFamilyId" IS NOT NULL);
ALTER TABLE "admin_mfa_factors" ADD CONSTRAINT "admin_mfa_factors_step_check" CHECK ("lastUsedStep" IS NULL OR "lastUsedStep" >= 0);
ALTER TABLE "admin_webauthn_credentials" ADD CONSTRAINT "admin_webauthn_credentials_counter_check" CHECK ("counter" >= 0);
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_singleton_check" CHECK ("id" = 'default');
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_currency_check" CHECK ("currency" = 'USD');
ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_singleton_check" CHECK ("id" = 'default');
ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_threshold_check" CHECK ("freeShippingThreshold" IS NULL OR "freeShippingThreshold" >= 0);
ALTER TABLE "shipping_method_settings" ADD CONSTRAINT "shipping_method_settings_price_check" CHECK ("price" >= 0 AND "price" <= 9999.99);
ALTER TABLE "recommendation_section_configs" ADD CONSTRAINT "recommendation_section_configs_limit_check" CHECK ("itemLimit" BETWEEN 1 AND 24);
ALTER TABLE "featured_product_pins" ADD CONSTRAINT "featured_product_pins_position_check" CHECK ("position" BETWEEN 0 AND 99);
ALTER TABLE "featured_product_pins" ADD CONSTRAINT "featured_product_pins_window_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_counts_check" CHECK (("resultCount" IS NULL OR "resultCount" >= 0) AND ("durationMs" IS NULL OR "durationMs" >= 0));

-- Seed singletons: identical to the previous constants, so checkout terms do not change at deploy.
INSERT INTO "store_settings" ("id", "storeName", "timezone", "currency", "updatedAt") VALUES ('default', 'ElectroHub', 'UTC', 'USD', CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
INSERT INTO "shipping_settings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "shipping_method_settings" ("method", "enabled", "price", "updatedAt") VALUES
  ('STANDARD', true, 0.00, CURRENT_TIMESTAMP), ('EXPRESS', true, 9.99, CURRENT_TIMESTAMP), ('OVERNIGHT', true, 19.99, CURRENT_TIMESTAMP)
  ON CONFLICT ("method") DO NOTHING;

-- Private data: Express (table owner) is the only reader/writer. No PostgREST/anon access.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_account_security', 'admin_mfa_factors', 'admin_recovery_codes', 'admin_webauthn_credentials',
    'admin_auth_challenges', 'admin_sessions', 'admin_invitations', 'admin_audit_logs', 'store_settings', 'shipping_settings',
    'shipping_method_settings', 'admin_notification_preferences', 'recommendation_section_configs', 'featured_product_pins', 'analytics_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', t); END IF;
  END LOOP;
END $$;
