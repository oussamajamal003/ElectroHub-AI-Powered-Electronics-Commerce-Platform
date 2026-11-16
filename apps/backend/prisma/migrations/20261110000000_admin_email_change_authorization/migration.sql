-- Task 05.2 administrator email change: an exact-session, password/MFA-bound authorization with one pending OTP.
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'ADMIN_EMAIL_CHANGE_OTP';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'ADMIN_EMAIL_CHANGE_OLD';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'ADMIN_EMAIL_CHANGE_NEW';

CREATE TABLE "admin_email_change_authorizations" (
  "userId" UUID NOT NULL,
  "currentEmail" VARCHAR(255) NOT NULL,
  "targetEmail" VARCHAR(255) NOT NULL,
  "sessionFamilyId" UUID NOT NULL,
  "credentialFingerprint" VARCHAR(64) NOT NULL,
  "securityFingerprint" VARCHAR(64) NOT NULL,
  "stepUpAt" TIMESTAMP(3) NOT NULL,
  "challengeId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resendAvailableAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_email_change_authorizations_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "admin_email_change_authorizations_challengeId_key"
  ON "admin_email_change_authorizations"("challengeId");
CREATE INDEX "admin_email_change_authorizations_sessionFamilyId_idx"
  ON "admin_email_change_authorizations"("sessionFamilyId");
CREATE INDEX "admin_email_change_authorizations_expiresAt_idx"
  ON "admin_email_change_authorizations"("expiresAt");

ALTER TABLE "admin_email_change_authorizations"
  ADD CONSTRAINT "admin_email_change_authorizations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_email_change_authorizations"
  ADD CONSTRAINT "admin_email_change_authorizations_challengeId_fkey"
  FOREIGN KEY ("challengeId") REFERENCES "otp_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
