-- Task 05.2 operator-issued password recovery proof for seeded DEV administrators that already have an enrolled factor but no mailbox.
-- Additive only: a new enum value; no existing row is rewritten. The proof replaces only the email-OTP step of admin forgot-password.
ALTER TYPE "AdminActivationPurpose" ADD VALUE IF NOT EXISTS 'SEED_PASSWORD_RECOVERY';
