-- Administrator forgot-password: a purpose-bound pre-auth transaction that only an existing MFA factor can convert into a reset authorization.
ALTER TYPE "AdminChallengePurpose" ADD VALUE 'PASSWORD_RECOVERY';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_PASSWORD_RECOVERY_VERIFIED';
