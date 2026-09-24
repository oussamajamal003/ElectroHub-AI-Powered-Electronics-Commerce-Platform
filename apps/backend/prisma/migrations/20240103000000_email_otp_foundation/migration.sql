-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE', 'SENSITIVE_ACTION');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('ACCOUNT_VERIFICATION', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'EMAIL_CHANGED', 'SECURITY_ALERT');

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" "OtpChannel" NOT NULL DEFAULT 'EMAIL',
    "destination" VARCHAR(255) NOT NULL,
    "codeHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "type" "EmailType" NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'BREVO',
    "providerMessageId" VARCHAR(255),
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_userId_purpose_idx" ON "otp_challenges"("userId", "purpose");

-- CreateIndex
CREATE INDEX "otp_challenges_userId_expiresAt_idx" ON "otp_challenges"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "otp_challenges_expiresAt_idx" ON "otp_challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_providerMessageId_key" ON "email_deliveries"("providerMessageId");

-- CreateIndex
CREATE INDEX "email_deliveries_userId_idx" ON "email_deliveries"("userId");

-- CreateIndex
CREATE INDEX "email_deliveries_type_status_idx" ON "email_deliveries"("type", "status");

-- CreateIndex
CREATE INDEX "email_deliveries_recipient_idx" ON "email_deliveries"("recipient");

-- CreateIndex
CREATE INDEX "email_deliveries_createdAt_idx" ON "email_deliveries"("createdAt");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
