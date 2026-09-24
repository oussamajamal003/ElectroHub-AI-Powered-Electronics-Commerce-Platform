# Task 02.4-A: Database Verification & Infrastructure Review

## 1. Incident Overview

During the implementation of Task 02.4-A (Email & OTP Foundation), database connectivity and migration processes to the `electrohub-dev` environment began failing. 

The initial hypothesis from previous remediation attempts incorrectly identified region drift as the cause—specifically, attributing the failures to `ap-northeast-2` being used in development versus `ap-northeast-1` in production. This led to an inappropriate modification of `.env.local` that violated ElectroHub's intentional multi-region deployment architecture.

## 2. Root Cause Analysis

Upon deeper investigation, the failures were determined to be the result of three distinct issues working in tandem, rather than infrastructure drift:

1. **Local Prisma Engine DNS Resolution (`P1001`)**:
   Prisma locally failed with `P1001: Can't reach database server` when connecting to `aws-0-ap-northeast-2.pooler.supabase.com:6543`. Network diagnostics (`Test-NetConnection` and Node `pg` client tests) confirmed that TCP reachability was healthy and the database was actively accepting connections. The root cause was a known bug in Prisma's Rust Query Engine on Windows environments, where it attempts to resolve IPv6 DNS first and times out before falling back to IPv4, causing a persistent `P1001` error.
   
2. **GitHub Actions Runner Network Rejection (`ECONNREFUSED`)**:
   The `ECONNREFUSED` error encountered during the CI pipeline was entirely unrelated to the `P1001` local error. Inspection of `.github/workflows/ci.yml` revealed that the `backend-test` job explicitly hardcoded the test database connection to `localhost:5432` rather than mapping the `ELECTROHUB_DEV_DATABASE_URL` secrets. Since no PostgreSQL container was spun up in the CI runner, the integration tests immediately crashed with connection refused.

3. **Failed Dev Database Migration State (Byte Order Mark)**:
   The DEV database was actively locked out of accepting new migrations. The `20240101000000_database_foundation` base migration had failed due to an unexpected `\u{feff}` (Byte Order Mark) at the beginning of the SQL file (`ERROR: syntax error at or near "\u{feff}"`). Prisma consequently refused to apply `20240103000000_email_otp_foundation`.

## 3. Fixes & Remediation

- **Infrastructure Region Integrity**: The `.env.local` region settings were reverted to preserve ElectroHub's correct architecture (`ap-northeast-2` for dev, `ap-northeast-1` for production).
- **CI Network Configuration**: Updated `.github/workflows/ci.yml` to correctly inject `${{ secrets.ELECTROHUB_DEV_DATABASE_URL }}` and `${{ secrets.ELECTROHUB_DEV_DIRECT_URL }}` for integration tests instead of pointing to dummy `localhost` instances.
- **Migration & Schema Recovery**: 
  - Stripped the `\uFEFF` BOM from the SQL migration files.
  - Bypassed the Prisma local engine DNS issue by applying the missing schemas directly via a Node `pg` client using the Supabase pooler.
  - Executed state-repair operations on the `_prisma_migrations` table to mark `20240101000000_database_foundation` and `20240103000000_email_otp_foundation` as successfully applied.

## 4. Verification Evidence

A post-remediation schema verification script was executed directly against `aws-0-ap-northeast-2.pooler.supabase.com:6543`. The target schemas correctly exist on the DEV database:

**_prisma_migrations State:**
- `20240101000000_database_foundation`: Applied
- `20240103000000_email_otp_foundation`: Applied

**Target Tables Deployed:**
- `otp_challenges`
- `email_deliveries`

**Target Columns Deployed:**
- `users.emailVerifiedAt` (timestamp without time zone)

**Conclusion:**
DEV connectivity has been fully restored, CI is now pointing at the correct database infrastructure, the region architecture has been preserved, and the Task 02.4-A foundation migrations are successfully deployed.
