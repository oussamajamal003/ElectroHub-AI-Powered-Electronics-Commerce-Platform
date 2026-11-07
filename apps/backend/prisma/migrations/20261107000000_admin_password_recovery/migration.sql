-- Administrator forgot-password: a purpose-bound pre-auth transaction that only an existing MFA factor can convert into a reset authorization.
ALTER TYPE "AdminChallengePurpose" ADD VALUE 'PASSWORD_RECOVERY';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_PASSWORD_RECOVERY_VERIFIED';
-- Recovery transactions are pre-auth like LOGIN: they have no session family. Compared as text because a value added in this same transaction cannot be referenced as an enum literal yet.
ALTER TABLE "admin_auth_challenges" DROP CONSTRAINT "admin_auth_challenges_binding_check";
ALTER TABLE "admin_auth_challenges" ADD CONSTRAINT "admin_auth_challenges_binding_check" CHECK ("purpose"::text IN ('LOGIN', 'PASSWORD_RECOVERY') OR "sessionFamilyId" IS NOT NULL);
