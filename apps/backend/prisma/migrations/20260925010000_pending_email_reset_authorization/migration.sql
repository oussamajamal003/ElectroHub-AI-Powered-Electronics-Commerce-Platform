ALTER TABLE "users" ADD COLUMN "pendingEmail" VARCHAR(255);

CREATE UNIQUE INDEX "users_pendingEmail_key" ON "users"("pendingEmail");

ALTER TABLE "password_reset_tokens" ADD COLUMN "consumedAt" TIMESTAMP(3);

CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");
