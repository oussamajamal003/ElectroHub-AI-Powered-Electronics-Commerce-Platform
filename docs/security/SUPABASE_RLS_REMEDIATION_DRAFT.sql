-- ==============================================================================
-- ELECTROHUB — PROD DATABASE GRANT REMEDIATION PACKAGE (APPROVAL-READY)
-- Target Project: yepfgjehdstlxbpespun (ap-northeast-1)
--
-- STATUS: DRAFT ONLY — NOT EXECUTED. AWAITING EXPLICIT USER/OWNER AUTHORIZATION.
--
-- Purpose: Remediate residual excessive grants (TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN) granted to 'anon' and 'authenticated' on 25 public relations.
-- Verified via live catalog audit on 2026-10-10.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PART 1: BOUNDED PROD REMEDIATION (25 Relations)
-- ------------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public._prisma_migrations,
  public.addresses,
  public.brands,
  public.cart_items,
  public.carts,
  public.categories,
  public.deliveries,
  public.email_deliveries,
  public.inventory,
  public.oauth_accounts,
  public.order_items,
  public.orders,
  public.otp_challenges,
  public.password_reset_tokens,
  public.payments,
  public.product_images,
  public.product_specifications,
  public.products,
  public.refresh_tokens,
  public.reviews,
  public.roles,
  public.security_events,
  public.users,
  public.wishlist_items,
  public.wishlists
FROM anon, authenticated;

-- Future default ACLs for objects created in schema public:
-- Note: 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres' must be run by role 'postgres' or a member.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;

-- Note: 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin' must be run by role 'supabase_admin' or a member.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

COMMIT;

-- ------------------------------------------------------------------------------
-- PART 2: READ-ONLY POST-EXECUTION VERIFICATION SQL
-- ------------------------------------------------------------------------------
-- Execute after Part 1 to confirm zero grants remain for anon and authenticated:
/*
SELECT
  grantee,
  privilege_type,
  count(DISTINCT table_name) AS table_count
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee, privilege_type;
-- Expected output: 0 rows returned.
*/

-- ------------------------------------------------------------------------------
-- PART 3: ROLLBACK SQL (EMERGENCY ONLY — APPROVAL REQUIRED)
-- ------------------------------------------------------------------------------
-- WARNING: This rollback restores the exact before-state privileges recorded in
-- the 2026-10-10 audit baseline. It re-expands permissions and must only be
-- executed if an authorized dependency breaks, following explicit approval.
-- DO NOT EXECUTE WITHOUT EXPLICIT USER / PLATFORM-OWNER AUTHORIZATION.
/*
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- 1. Restore residual table privileges on the 25 public relations:
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public._prisma_migrations,
  public.addresses,
  public.brands,
  public.cart_items,
  public.carts,
  public.categories,
  public.deliveries,
  public.email_deliveries,
  public.inventory,
  public.oauth_accounts,
  public.order_items,
  public.orders,
  public.otp_challenges,
  public.password_reset_tokens,
  public.payments,
  public.product_images,
  public.product_specifications,
  public.products,
  public.refresh_tokens,
  public.reviews,
  public.roles,
  public.security_events,
  public.users,
  public.wishlist_items,
  public.wishlists
TO anon, authenticated;

-- 2. Restore owner-specific default ACLs for objects created in schema public:
-- Note: 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres' must be run by role 'postgres' or a member.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;

-- Note: 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin' must be run by role 'supabase_admin' or a member.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;

COMMIT;
*/
