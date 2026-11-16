-- Only the separately authorized runner invokes this through Prisma's native
-- schema engine. No ledger creation, fixture creation or financial data access.
BEGIN READ ONLY;
SELECT 1 / CASE WHEN current_user = 'eh_payment_concurrency_runner'
  AND session_user = 'eh_payment_concurrency_runner'
  AND current_database() = 'postgres'
  AND current_schema() = 'electrohub_payment_concurrency_20261012'
  AND current_schemas(false)::text[] = ARRAY['electrohub_payment_concurrency_20261012']::text[]
  THEN 1 ELSE 0 END;
ROLLBACK;
