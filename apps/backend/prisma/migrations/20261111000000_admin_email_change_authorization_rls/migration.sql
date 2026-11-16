-- This internal authorization table is backend-only. RLS has no public policies;
-- the Prisma runtime role owns the table and has BYPASSRLS in shared DEV.
ALTER TABLE "admin_email_change_authorizations" ENABLE ROW LEVEL SECURITY;
