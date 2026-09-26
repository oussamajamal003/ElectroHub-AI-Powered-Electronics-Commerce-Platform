-- Remove users.phone column
-- This column was removed from schema.prisma in commit 8c73b39 (Task authentication implementation)
-- but no migration was generated at the time.
-- Evidence: users.phone has 0 non-null rows in both DEV and PROD.
-- This column is not used in the application codebase.

ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
