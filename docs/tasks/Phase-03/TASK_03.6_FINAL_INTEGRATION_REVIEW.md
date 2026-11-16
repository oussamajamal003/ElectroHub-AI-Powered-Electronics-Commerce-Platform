# Task 03.6 — Final Payment Lifecycle Integration Review

Date: 2026-10-12  
Branch: `feature/Stripe`  
Reviewed base commit: `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`  
Decision: **PARTIAL / BLOCKED — merge NO**

## Executive status

The submitted-purchase architecture and offline regressions are present in source. I independently reviewed the payment ownership transaction, order commit, cart projection, retry/status routes, webhook ingress, worker entry point, and customer purchase/notification surfaces. No new reproducible P0/P1 source defect was found.

The full operational acceptance criteria are not met:
1. DEV database does not have the required schema (migration `20261012120000_payment_purchase_ownership` is prepared but not executed; awaiting owner approval).
2. Service-level PostgreSQL concurrency against an authorized isolated database has not run (disposable environment not authorized; local DB declined by owner).
3. Hosted Stripe Test Mode acceptance has not run (prerequisites missing; financial execution gated).
4. Owned background recovery runtime has not been established in a hosted environment.

Offline test doubles and intercepted browser suites cannot substitute for these operational gates.

No DEV/PROD migration was applied. No database fixture writes, live payment authorization/capture/refund/cancel, webhook resend, API startup or worker startup occurred. Historical READY work was not selected or touched. GitHub CI, commit, push, merge, deployment and owner manual browser verification were excluded.

## Source fingerprint and scope

Reviewed HEAD: `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`.

Primary source set:
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261012120000_payment_purchase_ownership/migration.sql`
- `apps/backend/src/services/payment.service.ts`
- `apps/backend/src/services/order.service.ts`
- `apps/backend/src/services/cart.service.ts`
- `apps/backend/src/payment-runner.ts`
- `apps/backend/src/routes/payment.routes.ts`
- `apps/backend/src/routes/stripe-webhook.routes.ts`
- `apps/frontend/src/features/checkout/CheckoutPage.tsx`
- `apps/frontend/src/features/checkout/PaymentPurchases.tsx`
- `apps/frontend/src/features/checkout/PaymentRetryPage.tsx`
- `apps/backend/scripts/payment-ownership-postgres-check.cjs`
- `apps/backend/scripts/payment-concurrency-integration-suite.cjs`
- `apps/backend/scripts/payment-concurrency-integration-suite.test.cjs`

The working tree had extensive pre-existing modified/untracked files at review start. Those were preserved. This task verified all source invariants, created the comprehensive executable PostgreSQL concurrency integration suite (`payment-concurrency-integration-suite.cjs`) with companion tests, and produced this definitive readiness assessment.

## Migration and database compatibility

The prepared ownership migration adds:
- `payment_attempts`: `submittedAt` (TIMESTAMP(3)), `restoredAt` (TIMESTAMP(3)), `notificationReadState` (VARCHAR(32)), plus CHECK constraint `submitted_purchase_releases_active_cart` (`submittedAt IS NULL OR activeCartId IS NULL`).
- `payment_attempt_items`: `sourceCartItemId` (UUID), `snapshotCartItemId` (UUID), plus unique index `payment_attempt_items_sourceCartItemId_key` ON (`sourceCartItemId`).

Key architectural characteristics:
- All new columns are nullable; no destructive DDL, no backfill required, no default values altering legacy data.
- Historical attempts receive NULL markers and satisfy the CHECK constraint (`submittedAt IS NULL` evaluates to TRUE).
- The unique index on `sourceCartItemId` permits multiple NULLs under standard PostgreSQL semantics, preserving historical attempt rows and existing financial uniqueness constraints (`idempotencyKey`, `orderId`, `refundId`).
- Migration locking: Nullable column additions are metadata-only. Table size is modest (~64 rows, ~248 kB), making CHECK validation and unique index build fast, but ACCESS EXCLUSIVE locks are still required during DDL application. A lock timeout and maintenance window are mandatory.
- Sequence verification: Migration follows `20261012000000_storefront_product_visibility` (already applied to DEV). Checksum and schema alignment verified.
- Target DEV identity: `electrohub-dev` / ref `pzxekjybdiulzmssalfo` / region `ap-northeast-2`.
- Target PROD identity: `electrohub` / ref `yepfgjehdstlxbpespun` / region `ap-northeast-1`.

**Migration status: PREPARED / DEV APPROVAL REQUIRED. PROD: NOT EXECUTED.**  
There is no prior explicit owner approval for this exact migration in the project record.

## PostgreSQL concurrency

The implementation introduces `POST /api/checkout/payment-attempts/:id/submit`.  
Source inspection confirms the required concurrency invariants:
- **Lock ordering:** Attempt → Work → Cart locked via `FOR UPDATE` in one Serializable transaction.
- **Cart-line transfer:** Deletes only exact matching cart-line IDs (`sourceCartItemId = line.id`), sets `submittedAt = now()`, and nullifies `activeCartId`.
- **Bounded conflict handling:** Catches PostgreSQL serialization failures (`40001`) with bounded retry (up to 2 retries); unexpected errors trigger clean rollback.

To verify scenarios A through J under PostgreSQL semantics without touching DEV/PROD data, an executable integration suite has been prepared:
- Script: `apps/backend/scripts/payment-concurrency-integration-suite.cjs`
- Companion test: `apps/backend/scripts/payment-concurrency-integration-suite.test.cjs` (2 PASS / 0 FAIL)
- Covered scenarios:
  - **A. Two simultaneous submissions of A:** Evaluates concurrent submissions; exactly one durable ownership transfer commits, second yields no duplicate claim.
  - **B. Submission during Cart modification:** Verifies quantity/line modification during submit triggers mismatch detection and clean rollback.
  - **C. Product B added during processing of A:** B receives independent Cart lines and is payable; A does not mutate B.
  - **D. Same SKU added again:** New Cart line receives a fresh distinct UUID; original `sourceCartItemId` remains uniquely bound to A.
  - **E. Order A commits while Cart B modified:** Order commit decrements inventory and consumes attempt A snapshot only; active Cart B items remain untouched.
  - **F. Transaction failure after partial writes:** Simulates error/rollback; leaves zero partial ownership markers.
  - **G. Concurrent PaymentWork lease changes:** Token fencing rejects updates from workers with stale lease tokens.
  - **H. Duplicate webhook/processor completion:** Unique constraint on `orders.paymentAttemptId` rejects duplicate order insertion.
  - **I. Unique-index and CHECK violations:** PostgreSQL rejects duplicate `sourceCartItemId` (`23505`) and violates `submitted_purchase_releases_active_cart` (`23514`).
  - **J. Serializable conflicts/deadlocks:** Concurrent serializable write conflicts raise `40001` and roll back cleanly without unsafe auto-replay.

**Safety gates:** The suite requires `PAYMENT_PG_TEST_DATABASE_URL`, `PAYMENT_PG_TEST_TARGET=disposable`, and `PAYMENT_PG_TEST_APPROVED=I_APPROVE_DISPOSABLE_PG_WRITES`. It rejects all Supabase DEV/PROD endpoints.  
**Actual PostgreSQL status: BLOCKED / NOT VERIFIED.** No isolated disposable database environment was authorized.

## Hosted payments and background recovery

Hosted Stripe Test Mode is **BLOCKED / NOT EXECUTED** for all 16 scenarios:
- 01. Successful card payment
- 02. Definitive declined card
- 03. Additional authentication / 3DS
- 04. Payment response loss
- 05. Unknown payment outcome
- 06. Authorized but capture pending
- 07. Purchase processing interruption
- 08. Backend recovery after browser closure
- 09. Payment A succeeds during Checkout B
- 10. Payment A fails during Checkout B
- 11. Buy Now A processing while Cart B starts
- 12. Safe saved-purchase retry
- 13. Webhook duplicate/out-of-order delivery
- 14. No duplicate PaymentIntent or capture
- 15. Correct immutable order/stock effects
- 16. No historical payment work processed

Canonical account: `acct_1UEZW5KiVgdl63pN`.  
Prerequisites missing: 0/10 acceptance gates approved, historical submission ledger incomplete, authorization allowance unknown, Supavisor headroom unknown, hosted guard unverified, budget unapproved. No live Stripe API was called.

Background recovery topology:
- Webhook receiver verifies raw-body signatures and persists idempotency.
- Durable processor `PaymentWork` maintains leased state.
- Scoped runner `payment-runner.ts` supports `--attempt` execution.
- Global worker execution is prohibited to preserve historical DEV READY jobs.
- **Background recovery status: SOURCE ONLY; RUNTIME NOT VERIFIED.**

## Real Cart A / Checkout B isolation & Buy Now

Source and offline regression verification confirms:
- **Scenario 1:** Submitted Product A displays under Pending Purchases, is excluded from active Cart total/checkout, and cannot be paid again from active Cart.
- **Scenario 2:** When Product B is added, active Cart and header badge reflect B only. Stripe checkout inputs use B's attempt and intent.
- **Scenario 3:** If Payment A completes during Checkout B, Order A confirms with an in-app banner; Checkout B remains mounted with unchanged shipping, totals, and intent.
- **Scenario 4:** If Payment A declines during Checkout B, A is classified as DECLINED in Pending Purchases; retry is restricted to A; Checkout B is unaffected.
- **Scenario 5:** Adding the same SKU creates a new Cart line with a new UUID. A owns only the original `sourceCartItemId`.
- **Scenario 6:** Buy Now submissions bypass Cart storage entirely and run in independent sessions.

## UI, Figma and notifications

- UI components reviewed against ElectroHub design tokens (Primary `#2563EB`, Hover `#1D4ED8`, Poppins/JetBrains Mono, standard radius/spacing).
- Tested screens: Cart, Checkout, Review, Payment Processing, Payment Failed, Payment Retry, Order Confirmed, Orders, Pending Purchases.
- Connected Figma file did not expose specific checkout/payment frames. Inspected repository exports (`Cart page.png`, `Checkout page.png`).
- **Figma compliance: PARTIAL / NOT VERIFIED** (applicable frame inaccessible).
- Notifications: In-app banners display on payment completion/decline; `POST /:id/read` provides idempotent acknowledgment; bounded foreground polling (up to 5 min) with window focus/mount revalidation. Cross-tab live consistency is partial (requires focus/revalidation).

## Performance and security

- Latency paths reviewed: bounded polling (2-3s intervals, max 120s in checkout, max 5m in notifications), Attempt → Work → Cart lock hierarchy, external Stripe network calls kept outside DB transactions.
- Runtime performance: **UNVERIFIED** (historical slow query / P2028 root cause remains unknown in hosted environment).
- Security audit: Customer ownership enforced server-side on all endpoints; raw-body webhook signature verification; lease-token fencing; strict body parsing; sensitive logs sanitized; `SECURITY-01` preserved.

## Automated verification summary

| Verification Suite | Result | Evidence Boundary |
|---|---:|---|
| Backend affected test suites | **307 PASS / 0 FAIL** (15 files) | Local offline tests / doubles |
| Frontend affected test suites | **197 PASS / 0 FAIL** (16 files) | Local component / unit tests |
| Intercepted browser lifecycle matrix | **49 PASS / 0 FAIL** (1 worker) | Local Playwright / mocked SDK |
| Combined unique regression tests | **553 PASS / 0 FAIL** | Offline verification |
| Backend & Frontend Typechecks | **PASS** (0 errors) | `tsc --noEmit` |
| Scoped ESLint (Backend & Frontend) | **PASS** (0 errors, 0 warnings) | ESLint scoped run |
| Backend & Frontend Production Builds | **PASS** | `tsc`, `vite build` |
| Prisma Schema Validation | **PASS** | `prisma validate` |
| Concurrency Suite Offline Safety Gates | **2 PASS / 0 FAIL** | `node --test` |
| Git Diff Whitespace Check | **PASS** (0 errors) | `git diff --check` |
| Credential Pattern Scan | **PASS** (0 matches) | Regex scan on diff |
| Real PostgreSQL Concurrency | **BLOCKED** | Isolated environment not authorized |
| DEV Ownership Migration | **BLOCKED** | Explicit owner approval required |
| Hosted Stripe Test Mode (16 scenarios) | **BLOCKED** | Financial acceptance gates unapproved |
| Background Recovery Runtime | **SOURCE ONLY** | Real services / workers not started |
| Applicable Figma Frame | **NOT VERIFIED** | Specific frame unavailable |

## Remaining owner approvals & consolidated NO-GO packet

### 1. DEV Migration Approval Request
- **Target:** Apply `apps/backend/prisma/migrations/20261012120000_payment_purchase_ownership/migration.sql`
- **Target Environment:** `electrohub-dev` (project ref `pzxekjybdiulzmssalfo`, region `ap-northeast-2`).
- **Scope:** Add 5 nullable columns, 1 unique index on `sourceCartItemId`, 1 CHECK constraint on `payment_attempts`.
- **Pre-flight requirements:** Verify project identity, verify pending migration ledger, apply with lock monitoring, verify table integrity. PROD is NOT included.

### 2. Isolated Disposable PostgreSQL Approval Request
- **Scope:** Authorize executing `apps/backend/scripts/payment-concurrency-integration-suite.cjs` against an isolated disposable PostgreSQL instance (non-Supabase, non-production).
- **Required parameters:** `PAYMENT_PG_TEST_DATABASE_URL`, `PAYMENT_PG_TEST_TARGET=disposable`, `PAYMENT_PG_TEST_APPROVED=I_APPROVE_DISPOSABLE_PG_WRITES`.

### 3. Hosted Stripe Test Mode Acceptance Approval Request
- **Scope:** Authorize controlled acceptance execution for scenarios 01–16 on account `acct_1UEZW5KiVgdl63pN`.
- **Pre-flight requirements:** Approved submission ledger, authorization allowance, Supavisor headroom, hosted guard verification, isolated fixture scope, incident policy, approved run budget, and explicit owner execution token.

## Final assessment

| Metric | Rating |
|---|---|
| Architecture Preservation | 100% |
| Offline Test Coverage | 553 / 553 PASS (100%) |
| Code Quality & Type Safety | 100% |
| PostgreSQL Runtime Verification | BLOCKED (0%) |
| Hosted Stripe Acceptance | BLOCKED (0%) |
| Deployed Recovery Runtime | SOURCE ONLY (0%) |
| **Final Architect Score** | **86 / 100** (Engineering judgment) |
| **Recommendation** | **PARTIAL / BLOCKED — DO NOT MERGE** |

## DEV migration execution follow-up — 2026-10-12

This follow-up supersedes the migration status and DEV approval request above; it does not change the Stripe, PostgreSQL concurrency, worker-runtime or merge gates.

**Owner authorization:** received for only `20261012120000_payment_purchase_ownership` on DEV `electrohub-dev`, ref `pzxekjybdiulzmssalfo`, `ap-northeast-2`. The Supabase API URL ref matched. Prisma `DIRECT_URL` was scoped to the same ref through `aws-0-ap-northeast-2.pooler.supabase.com:5432`; no credential value was printed. The connector cannot independently expose project-region metadata; the URL host confirmed ap-northeast-2.

**Preflight:** `npx prisma migrate status --schema prisma/schema.prisma` found 16 migrations and exactly one unapplied migration: the authorized ownership migration. All 15 applied migration file checksums matched the DEV ledger after normalizing Windows CRLF to LF. The ownership SQL SHA-256 was `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8`. The SQL was reviewed as additive DDL only, with no data writes. No new-index/constraint name collision existed. The pre-change aggregate baseline was 64 attempts (26 PAID, 27 CANCELED, 5 DECLINED, 1 PREPARING, 1 AUTHORIZED, 4 AWAITING_INPUT), 91 attempt items, 12 carts, 13 cart lines, 35 orders, 26 SUCCEEDED payments, and PaymentWork 53 DONE / 10 READY / 1 LEASED. There were 4 active-cart claims; no orphan attempt/item/payment/cart relations; all attempts had their durable Work. The existing unique order, intent, refund, user/idempotency, active-cart and attempt/product indexes remained present. This aggregate baseline is recovery evidence, not a restorable database backup; the migration itself contains no DML and performs no row rewrite.

**Application:** Prisma CLI `npx prisma migrate deploy --schema prisma/schema.prisma`, from `apps/backend`, applied exactly `20261012120000_payment_purchase_ownership`; exit code 0. No Supabase `apply_migration` shortcut was used. No other migration was applied.

**Post-checks:** Prisma status reports “Database schema is up to date” (16 migrations). The five expected columns exist nullable with types: three attempt markers (`timestamp without time zone`, `timestamp without time zone`, `character varying`) and two item markers (`uuid`, `uuid`). `payment_attempt_items_sourceCartItemId_key` is UNIQUE, valid and ready. `submitted_purchase_releases_active_cart` is validated and has the expected CHECK definition. The ledger row is finished, not rolled back, one step, checksum `0cf4bc6b88a2222b47e691100364b0e961b5bb20b61149dfb759b651ef177ff8`. Post-check counts remained 64 attempts, 91 items, 12 carts, 13 cart lines, 35 orders, 26 SUCCEEDED payments and 53 DONE / 10 READY / 1 LEASED work. There are zero submitted attempts retaining an active-cart claim, zero non-null/duplicate source-line markers, and zero checked orphan relations. No PaymentAttempt or PaymentWork row was updated by the migration; no worker was started.

**Affected backend regression:** 307/307 PASS across 15 files using the offline/mocked suite; `payment.stripe.live.test.ts` was excluded. An initial sandbox attempt failed because temporary-directory rename was denied; a retry then had 52 local loopback EACCES failures with 255 passing. The same suite passed fully with local loopback enabled. These are not real PostgreSQL concurrency or hosted Stripe results. No DB fixture, payment, capture, refund, cancel, CI, deployment or credential action was performed.

**Current migration status: DEV APPLIED / VERIFIED.** Actual PostgreSQL application concurrency and hosted payment/runtime acceptance remain separate, unverified gates; merge remains NO.

## Disposable PostgreSQL concurrency authorization follow-up — 2026-10-12

The user authorized running `apps/backend/scripts/payment-concurrency-integration-suite.cjs` only against a dedicated disposable PostgreSQL database. The required process variables `PAYMENT_PG_TEST_DATABASE_URL`, `PAYMENT_PG_TEST_TARGET`, and `PAYMENT_PG_TEST_APPROVED` were all absent. The only configured database URLs are the previously verified DEV Prisma URLs; they were not used. No local database was created, and no PostgreSQL connection or fixture write was attempted. Scenarios A–J: **BLOCKED / NOT RUN**.

Executed safe offline checks: `node --test scripts/payment-concurrency-integration-suite.test.cjs` — **2/2 PASS** (missing-target and known DEV/PROD URL rejection); `node --check scripts/payment-concurrency-integration-suite.cjs` — **PASS**. These are guard/syntax checks only, not PostgreSQL results.

Suite review limitation for a future authorized run: it creates a synthetic reduced schema and executes hand-written SQL rather than invoking PaymentService, OrderService, webhook handling or the worker fence. It has no Payment table/provider operation, so its “duplicate webhook/processor completion” case proves only a synthetic unique order constraint. Scenario B does not assert a SQLSTATE/actual service rollback, and scenario J assumes a specific serialization victim without a synchronization barrier. Cleanup silently swallows schema-drop failures and does not verify schema absence. Thus the existing script does not substantiate the full A–J application acceptance even if a disposable DB is later configured; it must be repaired/reviewed before being represented as that evidence. No script edits or DB changes were made in this blocked run.

## Minimal-infrastructure DEV schema verification preparation — 2026-10-12

This addendum supersedes the immediately preceding disposable-database plan and its synthetic-suite assessment. The user requested investigation and suite preparation using one dedicated schema inside the existing DEV database, and explicitly prohibited PostgreSQL execution during this phase. **The suite was not executed.** No schema, role, fixture, migration, or financial record was created or changed.

### Read-only isolation findings

- `mcp__supabase_dev__get_project_url` returned `https://pzxekjybdiulzmssalfo.supabase.co`. The configured connection target was inspected without printing its password: `aws-0-ap-northeast-2.pooler.supabase.com:5432`, username project suffix `pzxekjybdiulzmssalfo`, database `postgres`. This matches the requested DEV project and region; PROD is not in scope.
- Read-only PostgreSQL metadata reported database `postgres`, connector role `supabase_read_only_user`, `search_path="$user", public`, current schema `public`, `max_connections=60`, and 7 sessions in this database at observation time. That is a point-in-time database count, not Supavisor tenant headroom or a capacity approval.
- `public` grants schema `USAGE` to `PUBLIC`, but the inspected financial tables (`payment_attempts`, `payment_attempt_items`, `payment_work`, `orders`, `payments`, `carts`, and `cart_items`) have no table-level privileges granted to `PUBLIC`. A future role must still be checked after provisioning: it must have no membership in `anon`, `authenticated`, or `service_role`, no public table/view/sequence access, no executable `SECURITY DEFINER` function in `public`, and direct `LIMIT 0` probes of financial tables must fail with SQLSTATE `42501`. Until that exact login exists, the role’s effective privileges and the public-data boundary are **not runtime-verified**.
- Relevant service SQL uses unqualified relation names; no `public.` table references were found in the PaymentService, OrderService, CartService, PaymentWork paths, or Prisma migrations. PrismaPg exposes an explicit schema option, and PostgreSQL startup `options` can pin `search_path`; the repaired harness requires both the Prisma schema and connection search path to name the same disposable schema.
- The harness does not invoke the general seed command. It applies the repository migrations with `prisma migrate deploy` against the schema-scoped URL, then creates disposable fixtures through an injected schema-specific Prisma client. It replays the migration files only inside the empty isolated schema; the production Prisma schema and DEV `public` migration ledger are not used as the fixture target.

### Prepared implementation

`apps/backend/scripts/payment-concurrency-integration-suite.cjs` now fails closed unless it receives all of the following exact scope values: `PAYMENT_PG_TEST_APPROVED=true`, `PAYMENT_PG_TEST_TARGET=dev-isolated-schema`, project ref `pzxekjybdiulzmssalfo`, schema `electrohub_payment_concurrency_20261012`, role `eh_payment_concurrency_runner`, and authorization string `DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop`. It also requires the matching DEV session-pooler URL, port 5432, TLS, `schema=<exact schema>`, and `options=-csearch_path=<exact schema>`. It rejects PROD, public/unscoped targets, other regions, mismatched generic Prisma URLs, live Stripe keys, and a privileged or inherited test role.

Before the first write, the runner performs read-only checks for exact database/login/schema identity, role flags and memberships, current schema/search path, no public table/view/sequence privileges or executable public `SECURITY DEFINER` functions, denied public financial-table probes, an empty marked schema including standalone types, and a minimum `max_connections` reserve. Only then does it use Prisma Migrate and launch the isolated tests. The runner never invokes `paymentService.runBatch`, `payment-runner.ts`, or a global worker. `STRIPE_SECRET_KEY` is cleared in both child processes; `PaymentService` receives a local fake provider, while webhook signatures are generated and verified locally with a test-only secret and no Stripe API calls.

The new service suite is `apps/backend/src/services/__tests__/payment.concurrency.postgres.integration.test.ts`. It calls the actual PaymentService, injected CartService, OrderService, and webhook route, and covers A–J with barriers, the repository migration constraints, actual `PaymentWork` claims/fencing, payment/order/inventory counts, rollback SQLSTATEs, and Cart A / Checkout B separation. A CartService database-injection unit regression was added. Webhook routing now has a dependency factory while the production default router retains its existing provider and Prisma dependencies.

Cleanup checks the exact schema owner and authorization comment, checks for external catalog dependencies, drops only that schema using PostgreSQL `DROP SCHEMA` with `RESTRICT` (never `CASCADE`), applies bounded lock/statement timeouts, and verifies `to_regnamespace(...)` is NULL. Cleanup errors are reported and fail the run. No ledger row is edited manually.

### Resource and execution boundary

The isolated schema will replay 16 migrations and hold only small disposable fixtures; it duplicates table/index definitions but contains no copied DEV customer, cart, order, attempt, or work records. The Prisma integration pool is capped at 4 connections; preflight and cleanup use one sequential connection, so their sessions do not overlap the service pool. The observed database count (7/60) is not proof of Supavisor reserve. Current safe pooler headroom remains unknown and must be approved before running.

No local PostgreSQL, new Supabase project, server, DEV `public` write, PROD write, Stripe operation, worker, credential change, CI, commit, push, merge, or deployment occurred. The existing authorized ownership migration remains applied from the earlier migration task; this addendum made no further database mutation.

Local verification after the harness changes: backend typecheck and build passed; Prisma validation passed; scoped ESLint passed; CJS syntax and offline safety tests passed (5/5); affected offline service tests passed (179) with 10 gated skips; webhook route regressions passed (20/20) using the offline loopback test harness. These are source/offline results only. The real PostgreSQL A–J file remained skipped; PostgreSQL SQLSTATEs, role ACLs, migrations inside the new schema, cleanup, and runtime pool behavior remain **NOT VERIFIED**.

### Current status and exact owner action

| Gate | Status |
|---|---|
| Schema isolation design | **FEASIBLE, conditional on role provisioning and runtime probes** |
| Actual public-data denial for test role | **NOT VERIFIED** (role does not yet exist) |
| Actual Payment/Cart/Order/webhook test coverage | **Prepared; NOT EXECUTED** |
| Stripe provider | **Mocked/local only** |
| PostgreSQL A–J | **NOT RUN** |
| Database mutations this phase | **NONE** |
| Merge | **NO** |

Before a later run, the owner must provision the exact login and schema through an approved DEV administration path: role `eh_payment_concurrency_runner` with `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`, no parent-role memberships, and no privileges on public relations or sequences; schema `electrohub_payment_concurrency_20261012`, owned by that role, empty, with the exact scope string above as its schema comment. On this Supabase PostgreSQL 17 SQL Editor path, the non-superuser CREATEROLE provisioner must be granted `SET` membership in the new runner role so it can make the runner the schema owner; the runner remains a member of no parent roles. The SQL below verifies that exact direction/options and no other memberships. The owner must keep the test-only role credential in the local secret environment and supply the scoped `PAYMENT_PG_TEST_DATABASE_URL`; do not put the password in chat or repository files. Then separately authorize one run that applies migrations only to that schema, creates test fixtures, runs A–J with Stripe mocked, and drops only that marked schema with `RESTRICT`. Supavisor headroom/reserve must be confirmed before execution. No PROD target is included.

**Exact DEV-only authorization request (not granted by this preparation task):** approve provisioning the named restricted role and empty schema in project `electrohub-dev` / `pzxekjybdiulzmssalfo` / `ap-northeast-2`, then separately approve one run with `PAYMENT_PG_TEST_APPROVED=true`, `PAYMENT_PG_TEST_TARGET=dev-isolated-schema`, `PAYMENT_PG_TEST_PROJECT_REF=pzxekjybdiulzmssalfo`, `PAYMENT_PG_TEST_SCHEMA=electrohub_payment_concurrency_20261012`, `PAYMENT_PG_TEST_ROLE=eh_payment_concurrency_runner`, and `PAYMENT_PG_TEST_SCOPE_AUTHORIZATION=DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop`. This authorizes only Prisma migrations, disposable fixtures, A–J mocked-Stripe tests, and `DROP SCHEMA RESTRICT` for that marked schema; it excludes every public-schema object, DEV/PROD financial record, real Stripe operation, worker, and other schema. Do not supply the role password in the approval response; store it in the local secret environment. Confirm Supavisor reserve before the run.

## DEV isolated-schema provisioning gate — 2026-10-12

Provisioning was **not executed**. Read-only project URL resolved to `https://pzxekjybdiulzmssalfo.supabase.co`; PostgreSQL reported database `postgres`, connector/session role `supabase_read_only_user`, server port 5432, PostgreSQL 17.6, and search path `"$user", public`. The exact role and schema each had zero catalog matches. No DEV/PROD data or schema was changed.

The observed database `max_connections` is 60 and 9 sessions were visible at query time. This is only a database snapshot; Supavisor tenant capacity/headroom is unavailable from the connector. Current `public` ACL grants `USAGE` to `PUBLIC` and the database ACL grants `CONNECT` and `TEMPORARY` to `PUBLIC`. The inspected payment/cart/order relations have no PUBLIC ACL grants; the PUBLIC ACL expansion query found no PUBLIC grants on those financial relations and no PUBLIC-executable `SECURITY DEFINER` function in `public`. The connector role `supabase_read_only_user` is not a valid test identity: it has `BYPASSRLS` and membership in `pg_read_all_data`, and can SELECT financial tables. `anon`, `authenticated`, and `service_role` have no direct memberships in this observation; the future test role must have no memberships into parent/privileged roles. The only expected inbound grants are the provisioner's automatic ADMIN-only grant and the separate SET-only/non-inheriting grant required to create the owned test schema. No `pg_default_acl` entries were present for global or `public` scope. Effective denial remains **UNVERIFIED until tested while authenticated as the test role**. PUBLIC's existing CONNECT/TEMPORARY/USAGE defaults are not changed by the prepared operation.

Static review covered all 16 Prisma migration directories. They create/alter schema-local types, tables, indexes, constraints, and foreign keys; the Stripe orchestration migration also revokes privileges on its own payment tables from `PUBLIC` and, conditionally, Supabase `anon`/`authenticated`. No migration uses `CREATE EXTENSION`, creates roles/schemas, changes `public`, or contains a `public.` object reference. A role that owns the empty test schema can perform these object-local DDL and revokes; no database CREATE, CREATEROLE, superuser, or RLS bypass should be granted to the test role. Prisma datasource URLs are env-based; PrismaPg supports the explicit schema option, and the runner pins the URL's `schema` and `options=-csearch_path=...`. Actual test-role connectivity remains unverified.

Prepared provisioning SQL below must be run only through an owner-confirmed admin session already connected to the exact DEV project. Supabase's current documentation says SQL Editor statements execute as `postgres`, so the transaction now checks that execution identity instead of `dashboard_user`; its authority predicates still verify actual catalog/database privileges at runtime. PostgreSQL 17 requires the provisioner to be able to `SET ROLE` to a different schema owner. A non-superuser CREATEROLE provisioner receives an automatic ADMIN-only membership; the SQL adds a separate self-membership with only `SET TRUE, INHERIT FALSE` so schema ownership can be established without granting ADMIN back to its grantor. It tests `SET ROLE` before schema creation and applies the marker as the schema owner. A superuser can `SET ROLE` without these memberships. The runner has no parent-role memberships, and neither inbound membership makes `postgres` inherit runner privileges. The transaction rolls back both objects on any SQL error. It contains no password; any test credential must be configured through an approved secret path and never placed in the repository or chat.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $preflight$
DECLARE can_manage_roles boolean;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong database; expected postgres' USING ERRCODE = 'P0001';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Unexpected SQL Editor execution identity' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(bool_or(rolsuper OR rolcreaterole), false) INTO can_manage_roles
    FROM pg_roles WHERE rolname = current_user;
  IF NOT can_manage_roles THEN
    RAISE EXCEPTION 'Provisioner lacks role-management authority' USING ERRCODE = '42501';
  END IF;
  IF NOT has_database_privilege(current_user, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Provisioner lacks database CREATE authority' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eh_payment_concurrency_runner') THEN
    RAISE EXCEPTION 'Role already exists; do not adopt or alter it' USING ERRCODE = '42710';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'electrohub_payment_concurrency_20261012') THEN
    RAISE EXCEPTION 'Schema already exists; do not adopt or alter it' USING ERRCODE = '42P06';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE n.nspname = 'public'
      AND c.relname IN ('users','carts','cart_items','payment_attempts','payment_attempt_items',
        'payment_work','orders','payments','order_items','stripe_events')
      AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC has a privilege on an existing financial relation' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC has a privilege on an existing public sequence' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can create objects in public' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_default_acl x
    CROSS JOIN LATERAL aclexplode(x.defaclacl) a
    WHERE (x.defaclnamespace = 0 OR x.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
      AND x.defaclobjtype IN ('r','S') AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC has a global/public default grant on tables or sequences' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public' AND p.prosecdef AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute a SECURITY DEFINER function in public' USING ERRCODE = '42501';
  END IF;
END
$preflight$;

CREATE ROLE eh_payment_concurrency_runner
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 4;
ALTER ROLE eh_payment_concurrency_runner IN DATABASE postgres
  SET search_path = electrohub_payment_concurrency_20261012;
-- PostgreSQL creates a separate ADMIN-only membership for the CREATEROLE
-- creator. Add only the SET path required for schema ownership; do not grant
-- ADMIN back to postgres (that fails with SQLSTATE 0LP01).
GRANT eh_payment_concurrency_runner TO postgres
  WITH SET TRUE, INHERIT FALSE;

-- Fail before schema creation if the SQL Editor role cannot SET ROLE as needed.
SET ROLE eh_payment_concurrency_runner;
RESET ROLE;

CREATE SCHEMA electrohub_payment_concurrency_20261012
  AUTHORIZATION eh_payment_concurrency_runner;
SET ROLE eh_payment_concurrency_runner;
COMMENT ON SCHEMA electrohub_payment_concurrency_20261012 IS
  'DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop';
RESET ROLE;

DO $verify$
DECLARE role_oid oid; schema_oid oid; relation_count integer; function_count integer; custom_type_count integer;
  provisioner_is_superuser boolean; provisioner_membership_count integer;
BEGIN
  SELECT oid INTO role_oid FROM pg_roles WHERE rolname = 'eh_payment_concurrency_runner'
    AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit = 4;
  IF role_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_roles parent WHERE parent.oid <> role_oid
      AND pg_has_role(role_oid, parent.oid, 'MEMBER')
  ) THEN RAISE EXCEPTION 'Role attributes or membership check failed' USING ERRCODE = '42501'; END IF;
  SELECT rolsuper INTO provisioner_is_superuser FROM pg_roles WHERE rolname = current_user;
  SELECT count(*)::int INTO provisioner_membership_count FROM pg_auth_members
    WHERE roleid = role_oid
      AND member = (SELECT oid FROM pg_roles WHERE rolname = current_user);
  IF provisioner_is_superuser THEN
    IF provisioner_membership_count <> 0 THEN
      RAISE EXCEPTION 'Unexpected membership into the test role from another role' USING ERRCODE = '42501';
    END IF;
  ELSIF provisioner_membership_count <> 2 OR NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.roleid = role_oid AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.roleid = role_oid AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option
  ) THEN
    RAISE EXCEPTION 'Expected separate ADMIN-only and SET-only, NOINHERIT memberships' USING ERRCODE = '42501';
  END IF;
  SELECT oid INTO schema_oid FROM pg_namespace WHERE nspname = 'electrohub_payment_concurrency_20261012'
    AND nspowner = role_oid
    AND obj_description(oid, 'pg_namespace') =
      'DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop';
  IF schema_oid IS NULL THEN RAISE EXCEPTION 'Schema owner/marker check failed' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO relation_count FROM pg_class WHERE relnamespace = schema_oid;
  SELECT count(*) INTO function_count FROM pg_proc WHERE pronamespace = schema_oid;
  SELECT count(*) INTO custom_type_count FROM pg_type WHERE typnamespace = schema_oid
    AND typrelid = 0 AND typtype <> 'p' AND typelem = 0;
  IF relation_count <> 0 OR function_count <> 0 OR custom_type_count <> 0 THEN
    RAISE EXCEPTION 'New schema is not empty' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_database_privilege(role_oid, 'postgres', 'CONNECT')
     OR has_database_privilege(role_oid, 'postgres', 'CREATE')
     OR NOT has_schema_privilege(role_oid, schema_oid, 'USAGE')
     OR NOT has_schema_privilege(role_oid, schema_oid, 'CREATE')
     OR has_schema_privilege(role_oid, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Required isolated schema privileges are not exact' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n WHERE n.oid <> schema_oid
      AND has_schema_privilege(role_oid, n.oid, 'CREATE')) THEN
    RAISE EXCEPTION 'Test role can create objects outside the isolated schema' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege(role_oid, c.oid, 'SELECT') OR has_table_privilege(role_oid, c.oid, 'INSERT')
        OR has_table_privilege(role_oid, c.oid, 'UPDATE') OR has_table_privilege(role_oid, c.oid, 'DELETE')
        OR has_table_privilege(role_oid, c.oid, 'TRUNCATE') OR has_table_privilege(role_oid, c.oid, 'REFERENCES')
        OR has_table_privilege(role_oid, c.oid, 'TRIGGER') OR has_table_privilege(role_oid, c.oid, 'MAINTAIN')
        OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND (has_column_privilege(role_oid, c.oid, a.attnum, 'SELECT')
            OR has_column_privilege(role_oid, c.oid, a.attnum, 'INSERT')
            OR has_column_privilege(role_oid, c.oid, a.attnum, 'UPDATE')
            OR has_column_privilege(role_oid, c.oid, a.attnum, 'REFERENCES'))))
  ) THEN RAISE EXCEPTION 'Test role can access a public relation' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      AND (has_sequence_privilege(role_oid, c.oid, 'USAGE') OR has_sequence_privilege(role_oid, c.oid, 'SELECT')
        OR has_sequence_privilege(role_oid, c.oid, 'UPDATE'))
  ) THEN RAISE EXCEPTION 'Test role can access public sequences' USING ERRCODE = '42501'; END IF;
END
$verify$;
COMMIT;
```

After provisioning, authenticate as the test role and verify the session reports exactly `current_user = session_user = eh_payment_concurrency_runner`, `current_database() = postgres`, `current_schema() = electrohub_payment_concurrency_20261012`, `current_schemas(false) = ARRAY['electrohub_payment_concurrency_20261012']`, and `current_setting('search_path') = 'electrohub_payment_concurrency_20261012'`. Recheck flags, zero parent-role memberships, `rolconnlimit=4`, schema owner/comment, and zero schema relations/functions/custom types. Check `has_table_privilege` and column-level privileges are false for public relations, `has_database_privilege(..., 'CREATE')` is false, and the role can create objects only in its isolated schema. Then execute `SELECT * FROM public."payment_attempts" LIMIT 0` and the corresponding protected-table probes individually and require driver SQLSTATE `42501` for each. Any success or different error blocks the integration gate. Do not use the read-only connector as a substitute for this test-role verification.

**Gate result:** `PROVISIONING: BLOCKED` pending explicit owner authorization and an admin provisioning path; the current read-only connector lacks `CREATEROLE`. `PUBLIC ACCESS DENIAL: UNVERIFIED` for the absent role. `SCHEMA ISOLATION: UNVERIFIED` at runtime. `MIGRATION PRIVILEGES: COMPATIBLE` by static migration review only. `CAPACITY: UNVERIFIED` (9 visible sessions of 60 at observation time; pooler reserve unavailable). `POSTGRESQL A–J: NOT EXECUTED`. No provisioning, migration, fixture, or other database mutation occurred.

**Required next approval:** authorize provisioning exactly the role/schema above on DEV (and only these objects), then allow the owner to provide its credential through a secret path. After successful post-provision verification, request a separate, exact-scope approval for the A–J migration/fixture/test/schema-cleanup run; no such integration-run approval is implied here.

## Owner-authorized provisioning preflight — 2026-10-12

The owner explicitly authorized only role/schema provisioning. Before any provisioning SQL, read-only checks reconfirmed project URL `https://pzxekjybdiulzmssalfo.supabase.co`, database `postgres`, and connector/session role `supabase_read_only_user`. The requested role and schema each still have zero catalog matches. Production was not accessed.

Provisioning is **BLOCKED**: the active connector role reports `rolsuper=false`, `rolcreaterole=false`, and no database `CREATE` privilege. It cannot create the login role or assign the schema owner. The Supabase migration tool was not used because this operation is not a migration and its execution identity/ledger effects cannot be established as limited to the two authorized objects. No DDL was attempted. The prepared transaction changes only the role (including its schema search_path setting) and isolated schema/marker; it does not modify public application tables, grants, or financial rows.

At the latest read-only sample, `max_connections=60` and 12 sessions were visible (one connector session); this is not a Supavisor tenant-capacity measurement. Pooler reserve remains unknown, so the capacity gate is **UNVERIFIED**. This shell has no `PAYMENT_PG_TEST_DATABASE_URL` or database secret environment entry and exposes no configured PowerShell SecretManagement/CredentialManager module or commands. No password was generated; secure local credential storage is **NOT ESTABLISHED**.

**Result:** `PROVISIONING: BLOCKED`; `ROLE: NOT CREATED`; `SCHEMA: NOT CREATED`; `ROLE SECURITY: NOT VERIFIED`; `PUBLIC DATA ACCESS: UNVERIFIED for the absent role` (catalog review still shows no PUBLIC grants on the inspected financial relations); `SCHEMA ISOLATION: NOT VERIFIED`; `CONNECTION CAPACITY: UNVERIFIED`; `POSTGRESQL A–J: NOT EXECUTED`; `STRIPE: NOT EXECUTED`. The exact provisioning SQL and verification plan above remain prepared. Resume only through a DEV admin provisioning path with sufficient privileges, a confirmed secret store, and pooler reserve evidence; then repeat the post-provision checks and request separate A–J execution approval.

## DEV SQL Editor administrative-path review — 2026-10-12

Supabase's documented SQL Editor execution role is `dashboard_user` ([Supabase Postgres Roles](https://supabase.com/docs/guides/database/postgres/roles)). Read-only catalog inspection of this exact DEV database confirms `dashboard_user` has `rolcreaterole=true` and effective database `CREATE=true`; it is not superuser, has no role memberships, and lacks `public` schema `CREATE`. This is sufficient authority for the narrowly scoped `CREATE ROLE` and `CREATE SCHEMA ... AUTHORIZATION` operations, without granting those capabilities to the test role. The connected MCP identity remains `supabase_read_only_user` (`rolcreaterole=false`, database `CREATE=false`, `rolbypassrls=true`, member of `pg_read_all_data`) and is explicitly unsuitable for provisioning or test-role verification. The local pooler probe could not resolve its hostname in this execution environment, and the Dashboard UI is not available to this task session; therefore the owner-authorized SQL Editor transaction was not submitted.

The SQL Editor path does not itself provide a safe password prompt. No approved local secret store is configured in this task environment, so no password was generated or stored. Use an interactive `psql` `\password eh_payment_concurrency_runner` prompt with a password-manager-generated value to avoid putting cleartext in SQL history; save that same secret in the owner-approved local store for the runner. Do not add a `GRANT` to the provisioner or test role. The SQL Editor project selector/URL must be checked against `pzxekjybdiulzmssalfo` and `ap-northeast-2` immediately before executing the prepared transaction because a SQL statement cannot prove which Dashboard project tab submitted it.

## Final SQL Editor / PostgreSQL 17 correction — 2026-10-12

This addendum supersedes the prior paragraph's claim that Dashboard SQL Editor runs as `dashboard_user`. Supabase's current role documentation and troubleshooting documentation state Dashboard SQL runs as `postgres` ([roles](https://supabase.com/docs/guides/database/postgres/roles), [Dashboard query identity](https://supabase.com/docs/guides/troubleshooting/tracking-postgres-role-activity-to-specific-dashboard-users-8d3715)). The DEV read-only connector confirmed project URL `https://pzxekjybdiulzmssalfo.supabase.co`, database `postgres`, PostgreSQL `17.6`, `postgres.rolsuper=false`, `postgres.rolcreaterole=true`, and effective database `CREATE=true`. The prior `dashboard_user` catalog values are real but do not identify the SQL Editor execution role. The actual connector identity remains `supabase_read_only_user` and is not an admin path.

The original provisioning transaction was **not ready**: under PostgreSQL 17 a non-superuser CREATEROLE role automatically receives ADMIN on a new role, but still needs a separate `SET ROLE` membership for `CREATE SCHEMA ... AUTHORIZATION another_role`. The SQL above explicitly creates that second membership with `ADMIN=false`, `SET=true`, and `INHERIT=false`, then proves it with `SET ROLE` before schema creation. The runner is a member of no parent roles; `postgres` is the sole inbound member identity represented by two grants: the automatic ADMIN-only membership and the explicit SET-only membership. PostgreSQL 17 exposes each grant and grantor in `pg_auth_members` ([PG17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html), [PG17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html), [PG17 membership catalog](https://www.postgresql.org/docs/17/catalog-pg-auth-members.html)). If policy means absolutely no membership row involving the runner role, this SQL Editor path cannot meet that condition; do not remove the required membership and proceed with schema ownership anyway.

## Provisioning verifier failure diagnosis — 2026-10-12

The owner-reported `42501` came from the combined inbound-membership predicate. Read-only DEV checks after the failed attempt showed neither runner role nor schema existed, so the transaction rolled back. The earlier verifier incorrectly expected one inbound membership containing ADMIN+SET. PostgreSQL's automatic CREATEROLE grant is ADMIN-only; the non-superuser must add a second membership to itself for `SET ROLE`. `CREATE ROLE ... NOINHERIT` controls privileges inherited by the runner from its parent roles; it does not set the provisioner's inbound membership options.

An earlier read-only preflight reconfirmed both requested names absent, the self-grant GUC was empty by default and had `user` context, `max_connections=60`, and 11 visible sessions. Supavisor pool-size/client-limit/reserve is not exposed by the connected tools, so capacity remains **UNKNOWN**; the 11/60 database-session snapshot is not a pooler-headroom measurement. The owner later reported failed SQL Editor submissions; no successful provisioning is evidenced.

The runner was tightened to require the exact effective `search_path`, detect table-level and column-level public relation privileges (including views), deny all public sequence privileges and executable public `SECURITY DEFINER` functions, and use `SELECT * ... LIMIT 0` for non-returning direct-denial probes. It continues to pin the exact DEV session pooler URL, role, project, schema, and approval scope; refuse PROD/public/unscoped URLs and live Stripe config; launch no worker; mock Stripe in the service-level A–J suite; and clean up only the marked schema with PostgreSQL's default `RESTRICT`, then verify absence. These are source/offline checks only; the actual integration test file is not executed.

## Follow-up provisioning SQL error — SQLSTATE 0LP01 — 2026-10-12

The next reported SQL Editor error was `ADMIN option cannot be granted back to your own grantor` at the explicit `GRANT eh_payment_concurrency_runner TO postgres WITH ADMIN TRUE, SET TRUE, INHERIT FALSE`. This is PostgreSQL's role-membership cycle protection: the CREATEROLE creator already has an automatically-created ADMIN membership on the role; asking `GRANT` to re-grant ADMIN to that same creator fails with `0LP01`. PostgreSQL 17 documents that `createrole_self_grant='set'` supplies the creator's SET membership option and that CREATEROLE already supplies ADMIN ([role attributes](https://www.postgresql.org/docs/17/role-attributes.html), [self-grant setting](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)).

Correction: do not set `createrole_self_grant` for this transaction. Keep the explicit self-grant but use `GRANT eh_payment_concurrency_runner TO postgres WITH SET TRUE, INHERIT FALSE;`. It preserves PostgreSQL's automatic ADMIN-only membership and adds a separate SET-only/non-inheriting membership. The verifier must require those two distinct rows. The latest failed transaction was reported by the owner; no successful provisioning is evidenced, and the prior read-only check found the runner role and schema absent. The corrected transaction has not been executed. No database mutation, migration, fixture, A–J run, or Stripe operation was performed for this correction.

**Owner handoff:** (1) In Supabase Dashboard, select project ref `pzxekjybdiulzmssalfo` and verify region `ap-northeast-2`. (2) Open SQL Editor and execute the final transaction above once. If it fails, do not rerun blindly; return sanitized SQLSTATE/error text. (3) If it succeeds, set the role password interactively in an authorized DEV `psql` session with `\password eh_payment_concurrency_runner`; use a password-manager-generated value. If no authorized interactive `psql` path is available, stop rather than typing a plaintext password into SQL Editor. (4) Store the password only in the approved local secret environment as `PAYMENT_PG_TEST_DATABASE_URL`; never put it in chat or repository files. Then Codex must verify as the runner: exact current/session user, database/schema/search_path, zero parent memberships, no public relation/view/sequence/definer access, SQLSTATE `42501` on direct probes, and an empty marked schema. No migration or A–J run is authorized at that point.

**Current result:** SQL review **CORRECTED; NOT RUNTIME-VERIFIED**; admin path **VERIFIED by current Supabase docs and DEV role catalog**; provisioning **NOT SUCCESSFUL** (owner-submitted transaction failed; no successful role/schema creation is evidenced); credentials **NOT CONFIGURED**; public-data denial and role-session isolation **UNVERIFIED**; Supavisor capacity **UNKNOWN**; offline runner guard tests **5 PASS / 0 FAIL** and Node syntax check **PASS**; PostgreSQL A–J **NOT EXECUTED**. Next gate is owner execution of the exact corrected transaction, secure password setup, and post-provision verification. A–J still requires a separate exact-scope authorization after pooler capacity evidence.

Latest catalog observation: database `postgres`, `max_connections=60`, 12 sessions. This remains only a database snapshot; Supavisor tenant headroom is **UNKNOWN**. No role, schema, migration, fixture, financial record, or production object was changed. Effective test-role isolation remains **UNVERIFIED** until login as that role proves the restricted search path and public financial-table/view/sequence denials (`42501`). PostgreSQL A–J and Stripe remain **NOT EXECUTED**.

## Superseding current snapshot — 2026-10-12

This snapshot supersedes the earlier `dashboard_user` SQL Editor identity inference and earlier 9/12-session observations. Current DEV read-only evidence is PostgreSQL 17.6; SQL Editor role `postgres` is non-superuser with CREATEROLE and database CREATE; the runner role and schema were absent in the prior read-only check; `max_connections=60` and 11 sessions were visible. Supavisor headroom remains **UNKNOWN**. The owner reported the later transaction failed with SQLSTATE `0LP01` when it tried to grant ADMIN back to `postgres`; no successful provisioning is evidenced. The corrected transaction uses a separate SET-only, non-inheriting self-membership (no ADMIN re-grant) and verifies two expected membership rows, but is **NOT EXECUTED**. No database objects or financial data were changed. The five offline runner gate tests pass, but role/session isolation and public-access denials remain **UNVERIFIED**, and A–J remains **NOT EXECUTED / BLOCKED**. The next external action remains one owner execution of the corrected SQL; no test-run approval is requested or implied yet.

## Latest read-only provisioning verification — 2026-10-12

After the owner reported that a repeat run stopped with `42710 Role already exists`, a read-only check through the DEV connector confirmed project URL `https://pzxekjybdiulzmssalfo.supabase.co`, database `postgres`, and PostgreSQL `17.6`. The runner role exists with `LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, and connection limit `4`. The two inbound membership rows match the intended PostgreSQL 17 structure: `postgres` has an ADMIN-only, non-inheriting automatic membership granted by `supabase_admin`, plus a separate SET-only, non-inheriting membership granted by `postgres`. The runner has zero parent memberships.

The named schema exists, is owned by the runner, has the exact authorization marker, and has zero relations and functions. Its configured role search path is exactly the isolated schema. Effective privilege catalog checks report database `CREATE=false`, isolated-schema `USAGE/CREATE=true`, public-schema `CREATE=false`, zero public relation/table privileges, zero public sequence privileges, and zero executable public `SECURITY DEFINER` functions. These are read-only catalog/effective-ACL checks using the connector identity `supabase_read_only_user`; direct login as the restricted role and direct prohibited-access probes expecting SQLSTATE `42501` remain **UNVERIFIED**. Credential setup was not verified. Supavisor capacity remains **UNKNOWN**; PostgreSQL A–J remains **NOT EXECUTED**.

Interpretation: the first provisioning transaction succeeded; the repeat was rejected by the intentional fail-closed existing-role check. Do not rerun the provisioning transaction or alter/adopt these objects. Codex performed only read-only queries for this verification. No migration, fixture, financial operation, worker, or test scenario ran. The next step is secure test-role credential setup followed by read-only connection/isolation verification; A–J still requires separate exact-scope owner authorization.

## Windows psql credential setup gate — 2026-10-12

Windows inspection found PostgreSQL client `psql.exe` at `C:\Program Files\PostgreSQL\18\bin\psql.exe`; no PostgreSQL server installation was performed. The executable was absent from the current PATH. After adding that directory to the process PATH only, `psql --version` returned `psql (PostgreSQL) 18.1`; user and system PATH settings were not changed.

No local `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGPASSWORD`, or `PAYMENT_PG_TEST_DATABASE_URL` was set, and the standard Windows `pgpass.conf` was absent. Their values were not read or logged. The Supabase database connector is read-only, so no authorized administrative psql connection was available in this session. Per the stop condition, no password was set, no URL was configured, and no restricted-role login/direct `42501` probe was attempted. PostgreSQL A–J, migrations, Stripe, and worker execution remain untouched.

Next: obtain the non-secret DEV host/port/user details from the Supabase Dashboard Connect panel and establish the admin psql connection locally, allowing psql to prompt for the current admin password. Once connected to DEV, run `\password eh_payment_concurrency_runner` at the `psql` prompt. Do not place either password in a connection command, SQL Editor statement, chat, logs, or repository file. Configure the test URL only in the approved local secret environment after the role password is set; then verify the isolated login and direct public-data denials before considering A–J.
## DEV connection diagnostics and credential gate — 2026-10-12

Client verification returned `psql (PostgreSQL) 18.1` from the existing installed executable. No installation or permanent PATH change occurred. Network-sandbox DNS probes timed out against localhost and public resolvers; those results are not evidence of the owner's network. Authorized diagnostics outside that sandbox resolved the exact owner-supplied `aws-0-ap-northeast-2.pooler.supabase.com` through both `1.1.1.1` and `8.8.8.8`, returning IPv4 addresses `15.164.120.176`, `13.124.111.232`, and `15.165.245.138`. The configured DNS server `fe80::ae84:c6ff:fe77:698a` returned “No response from server.” Windows .NET hostname resolution nevertheless succeeded and the exact hostname's TCP port `5432` was reachable. The confirmed failure is the configured resolver's non-response; its underlying router/network cause is not established. The hostname is valid, IPv4 connectivity works, and an authentication failure has not been observed. No network settings were changed.

The DEV connector independently returned project URL `https://pzxekjybdiulzmssalfo.supabase.co`. This identifies the connector project, not a yet-unopened administrative pooler session. Administrative credentials are unavailable to Codex, so administrative authentication, password initialization, secure `PAYMENT_PG_TEST_DATABASE_URL` setup, restricted-role login, and direct SQLSTATE `42501` probes remain BLOCKED/UNVERIFIED. No password or authenticated URL was collected or printed. Prior catalog-only isolation evidence remains unchanged. Supavisor pool/client limits, active/waiting utilization, and approved reserve remain unavailable; capacity is UNKNOWN.

Offline source inspection confirmed restricted-role/project/schema/search_path and exact-scope guards; public ACL and direct-denial checks; Prisma's isolated adapter schema with pool maximum four; real PaymentService/CartService/OrderService imports; local mocked payment provider and concurrency barriers; no global worker launch; and marked-schema dependency checks plus default DROP SCHEMA RESTRICT and absence verification. The runner accepts regional `aws-N` pooler hosts rather than pinning only `aws-0`; any future configured target must match the owner-verified endpoint. Source review is not runtime acceptance. No suite, migrations, fixtures, cleanup, Stripe operations, or database mutations were executed.

Next owner action: open an interactive PowerShell administrative session using the command below and enter the existing DEV administrator password only at psql's hidden prompt. This uses the owner's authorized TLS minimum; certificate-verifying TLS configuration remains to be established before test-run readiness. Do not initialize the test-role password until session identity and authorization have been confirmed.

```powershell
$env:PGSSLMODE = 'require'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h aws-0-ap-northeast-2.pooler.supabase.com -p 5432 -U postgres.pzxekjybdiulzmssalfo -d postgres -W
```

At the resulting psql prompt, run the read-only identity query: `SELECT current_user, session_user, current_database(), inet_server_addr(), inet_server_port();`. Provide only sanitized identity output. Password initialization with `\password eh_payment_concurrency_runner` remains gated on owner confirmation of this administrative session and explicit approval of that exact operation. PostgreSQL A–J remains NOT EXECUTED and requires separate authorization.


## Restricted-session A–J readiness follow-up — 2026-10-12

Owner-provided terminal evidence confirms PostgreSQL 17.6/TLS 1.3; exact current/session runner identity; postgres database; exact isolated schema/search_path; required role flags, limit four, no parent memberships, denied database/public CREATE; and six financial SELECT LIMIT 0 probes rejected with SQLSTATE 42501. The app terminal tool returned no attached session, so these are owner-provided observations, not independently captured terminal output. Password initialization is owner-confirmed; no credential was received by Codex.

Independent read-only DEV catalog verification confirms schema owner eh_payment_concurrency_runner, the exact existing authorization marker, zero schema relations/functions, zero accessible public sequences, and zero executable public SECURITY DEFINER functions. Remaining actual restricted-login probes are users, payment_attempt_items, order_items and stripe_events; public view and column privileges also need final read-only verification. An initial catalog query failed with 42809 because PostgreSQL evaluated a sequence privilege function on a non-sequence before applying the relkind filter. A CASE-guarded diagnostic succeeded; the existing runner query has the same unsafe evaluation pattern and needs correction before execution.

Offline runner gate tests: 5 PASS, 0 FAIL, 0 SKIP. Node syntax check PASS. Prisma datasource uses DATABASE_URL/DIRECT_URL; runner overrides both only in child processes with the scoped test URL; integration PrismaPg adapter pins schema and pool max four. Provider is local mocked PaymentProvider; worker startup is absent. No hardcoded public references were found in migration SQL by the scoped search. No migrations, fixtures, tests A–J or deletion ran.

Additional source blocker: cleanup checks external dependencies and calls DROP SCHEMA with default RESTRICT, but never removes the migration-created relations/types or disposable fixtures first. RESTRICT will reject a nonempty migrated schema. Offline gate tests do not cover cleanup. The suite is NOT READY until dependency-safe, exact-schema object removal and cleanup regression coverage are prepared and reviewed. No source or database cleanup was attempted in this review.

Capacity observation: max_connections 60, 16 visible database sessions. No connected tool exposes verified Supavisor tenant pool size/client cap, active/waiting client utilization or approved DEV reserve. This observation cannot establish safe four-session headroom; capacity UNKNOWN.

Secure configuration helper: apps/backend/scripts/set-payment-pg-test-url.ps1 prompts using Read-Host -AsSecureString, percent-encodes the password, and sets PAYMENT_PG_TEST_DATABASE_URL only in the interactive PowerShell process. It writes no secret file and never emits the URL; it does not set execution approval or alter normal DATABASE_URL/DIRECT_URL. Closing the process discards its environment. The helper was prepared, not executed with credentials. A process environment necessarily contains the plaintext connection value in memory; it is not persistent secret storage. Do not print it or enable environment dumps. TLS certificate-chain validation for the Node/Prisma path remains untested.

Remaining gates: owner executes secure helper in the intended runner shell; remaining restricted read-only denial checks; certificate validation; cleanup/query repairs; actual Supavisor configuration/utilization and reserve approval. Only after these pass request separate exact authorization DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop. No A–J execution authorization is inferred from credential setup. Database mutations this turn: NONE.
Final read-only catalog query additionally confirmed zero effective public table/view/materialized-view/foreign-table privileges, zero public column privileges, and zero isolated-schema types. Remaining four direct restricted-session 42501 probes are not independently executed. These catalog results do not replace direct-role probes.

## Final runner repair and credential visibility gate — 2026-10-12

The owner confirmed successful process-only secret-helper execution. Presence-only inspection in Codex returned TEST_SECRET_PRESENT=false: the owner PowerShell environment is not inherited by existing Codex processes. No password was requested, read, or printed. Secret setup is owner-confirmed CONFIGURED in that shell; direct verification from Codex is BLOCKED. Four remaining direct denial probes and TLS runtime verification remain BLOCKED until the read-only verifier runs in the existing configured owner shell.

Source repairs: the sequence ACL predicate uses CASE WHEN relkind = S before evaluating has_sequence_privilege, preventing planner reordering from invoking it on non-sequences. Cleanup authenticates the exact restricted role/database, verifies schema owner/marker and external dependencies, inventories schema objects and owners, rejects unsupported objects or routines, drops all ordinary tables in one schema-qualified RESTRICT statement (including the Prisma ledger), then residual sequences and enums, then the schema RESTRICT. Table-owned constraints, indexes, triggers, row types and owned sequences follow their owning tables; internal foreign keys are handled by the joint table DROP. External dependents remain protected by RESTRICT. All cleanup DDL, absence verification and commit are in one transaction with bounded lock/statement timeouts; errors trigger rollback and propagate to the existing CLEANUP FAIL reporting. Rollback failure is explicitly reported. No cleanup executed, so this design is offline-verified only.

TLS repair: pg URL sslmode parameters can override an explicit ssl object. Client and Prisma integration adapter now remove URL SSL options before passing rejectUnauthorized=true, retaining certificate validation. An offline test verifies the resulting pg connection configuration. Runtime certificate verification remains BLOCKED, not PASS; the existing owner session TLS 1.3 evidence does not prove this Node path. No CA or TLS security relaxation was introduced.

Prepared apps/backend/scripts/payment-pg-readiness.cjs: read-only entry point importing verification helpers without executing runner main; requires the exact owner-supplied aws-0 DEV endpoint and existing isolated URL; does not set PAYMENT_PG_TEST_APPROVED, run migrations/fixtures/workers, or call cleanup. It checks restricted identity/schema, all ten direct 42501 probes, ACLs, marker/emptiness and backend SSL in BEGIN READ ONLY. It suppresses raw connection errors to avoid credential exposure. Invoke in the already configured owner PowerShell: node .\apps\backend\scripts\payment-pg-readiness.cjs. This consumes the existing process environment without requesting the password again.

Verification actually executed: Node offline gate/cleanup/TLS tests 9 PASS / 0 FAIL / 0 SKIP; backend npm run typecheck PASS; scoped ESLint for runner, tests, read-only helper and integration TypeScript PASS; Node read-only helper syntax PASS; git diff --check PASS (tracked files; existing CRLF notices only). Tests use synthetic URLs and client doubles and establish no PostgreSQL cleanup/concurrency PASS. No real A–J test ran.

Changed this follow-up: apps/backend/scripts/payment-concurrency-integration-suite.cjs; apps/backend/scripts/payment-concurrency-integration-suite.test.cjs; apps/backend/scripts/payment-pg-readiness.cjs; apps/backend/src/services/__tests__/payment.concurrency.postgres.integration.test.ts; this review document. Historical evidence retained.

Supavisor capacity remains UNKNOWN: connected tools expose no tenant configuration/utilization/reserve evidence. The previous 16/60 DB-session snapshot is not pooler capacity. The bounded integration pool remains max four; the preflight connection closes before migration/suite launch. Neither that limit nor the database reserve guard proves available tenant headroom. A–J remains BLOCKED pending read-only verifier results, approved capacity evidence and separate exact migrate-deploy+fixtures+scenarios-A-J+drop authorization. Database mutations this follow-up: NONE.
## Readiness diagnostic failure remediation — 2026-10-12

Owner execution reported TEST_SECRET_PRESENT=true followed by the generic READ-ONLY BLOCKED label. This proves presence in the owner process, not successful connection. Runtime root cause remains UNKNOWN; no raw error was received. Codex performed local source/offline work only in this follow-up.

A definite source bug was independently reproduced by an offline transaction-state regression: expected 42501 probes inside BEGIN READ ONLY abort the PostgreSQL transaction, causing subsequent queries to receive 25P02. verifyIsolatedTarget now accepts a transactional option and wraps each direct-denial query in SAVEPOINT, rolls back the expected error to that savepoint, and releases it. The ordinary runner preflight remains outside a transaction and does not use savepoints. No financial mutation is introduced. This bug would fail any readiness run reaching the denial probes but is not proven to be the first cause of the owner failure.

The read-only helper now reports a fixed, allowlisted stage and safe error classification as JSON, including allowlisted SQLSTATE when known. Stages cover configuration, DNS, TCP, PostgreSQL connection, role identity, schema/search_path, database reserve, role/public/sequence/definer permissions, each of ten denial probes, schema marker/emptiness, TLS evidence, commit and disconnect. DNS and bounded TCP checks precede PostgreSQL connection; connection errors classify certificate, authentication and pooler responses. Unknown errors remain UNEXPECTED_VERIFIER_EXCEPTION; unrecognized codes/messages are never printed. Raw exceptions, stacks, URLs and password fields are never forwarded. Importing the helper no longer runs it; injectable offline test seams perform no network calls. Cleanup/disconnection errors cannot mask the first failing stage.

The helper retains exact DEV host, restricted project login and schema guards. validateConfiguration(false) bypasses only execution approval for read-only verification and retains all URL/scope/security guards. No PAYMENT_PG_TEST_APPROVED value is set. createClient still removes URL SSL override options and explicitly requires rejectUnauthorized=true; no TLS relaxation or credential reset occurred. The CASE-guarded sequence query remains intact.

Verification: combined offline runner/readiness tests 13 PASS / 0 FAIL / 0 SKIP; backend typecheck PASS; scoped ESLint PASS; Node syntax check PASS; git diff --check PASS for tracked files. Four new regressions cover error-field redaction, DNS classification, verifier-stage/SQLSTATE reporting and recovery from all ten expected denials. Source changes: apps/backend/scripts/payment-pg-readiness.cjs, apps/backend/scripts/payment-pg-readiness.test.cjs, apps/backend/scripts/payment-concurrency-integration-suite.cjs, this document. No database queries, mutations, migrations, fixtures, cleanup, A–J, Stripe, workers or deployment occurred.

Next owner action in the existing configured PowerShell: node .\apps\backend\scripts\payment-pg-readiness.cjs; share only its fixed sanitized output. Runtime readiness/TLS remain UNVERIFIED and Supavisor headroom UNKNOWN until evidence is obtained. Do not execute A–J.
## Supabase TLS root trust gate — 2026-10-12

Owner runtime evidence is postgres_connect / TLS_UNTRUSTED_CHAIN (SELF_SIGNED_CERT_IN_CHAIN), before SQL authentication/verification. This verifies chain-trust rejection, not an incorrect password. Prior psql sslmode=require/TLS1.3 establishes encryption, not certificate or hostname verification. Node v22.19.0 inspection confirms readiness and integration adapter pass rejectUnauthorized=true after removing URL SSL overrides; neither loads an explicit CA. The existing application adapter supports DB_SSL_CA_CERT_PATH, but that application configuration is not loaded by this isolated runner. pg sets TLS servername to the URL hostname and uses normal Node hostname checks. There is no secure evidence of a hostname mismatch or an incomplete served chain in this session.

Repository apps/backend/prisma/supabase-ca.pem contains leaf, intermediate and self-signed root, not a root-only file. Root subject Supabase Root 2021 CA; SHA256 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA; expires 2031-04-26. This root is absent from Node bundled roots; retained chain signatures verify and leaf hostname matches the exact DEV pooler. These are offline facts. Repository certificate provenance is not established; no repository certificate was promoted into trust.

Official Supabase guidance https://supabase.com/docs/guides/platform/ssl-enforcement requires the root downloaded under Dashboard Database Settings / SSL Configuration for verify-full. Official Studio source SSLConfiguration.tsx uses an authenticated/custom-content ssl:certificate_url setting for Download certificate. No independently established public download URL was available; no third-party URL or fetched server certificate was trusted. The fingerprint is corroborated by a public issue in the Supabase repository, but that issue is not authoritative provider issuance evidence. Owner must obtain the root through the verified DEV Dashboard download; automatic trust provisioning remains BLOCKED pending that file and provenance.

Prepared scripts/payment-pg-ca.cjs accepts a single current self-signed CA certificate with the exact reviewed fingerprint, rejects leaves/intermediates/bundles/keys and invalid content, and prints only the public SHA256. scripts/set-payment-pg-ca.ps1 accepts the Dashboard-downloaded file path, validates it, refuses unsafe TLS override or conflicting existing NODE_EXTRA_CA_CERTS, sets NODE_EXTRA_CA_CERTS in the owner process, and starts the read-only verifier. Node loads this setting at process startup; new readiness/runner processes and their Prisma adapter descendants inherit additional roots without replacing hostname checks or setting rejectUnauthorized=false. It does not alter the test URL, credentials, system trust store, roles or database. The read-only verifier also rejects NODE_TLS_REJECT_UNAUTHORIZED=0. No private keys or secrets were added.

Offline tests check root identity rejection/acceptance, missing default trust anchor, retained chain signatures, correct hostname acceptance and wrong hostname rejection. These are certificate/configuration regressions, not a live endpoint handshake or full network TLS acceptance. Runtime root cause beyond the demonstrated trust rejection remains unconfirmed pending the official root and rerun. Root rotation or an unexpected fingerprint fails closed and requires provider review rather than bypass.

Owner handoff: download the certificate from https://supabase.com/dashboard/project/pzxekjybdiulzmssalfo/database/settings SSL Configuration, save it outside the repository, then in the existing secret-configured PowerShell run: & .\apps\backend\scripts\set-payment-pg-ca.ps1 -CertificatePath "$env:USERPROFILE\Downloads\prod-ca-2021.crt" (adjust only the local downloaded-file path if necessary). No password re-entry is needed. No database query/mutation, migration, fixture, A–J, Stripe or worker operation was performed by Codex. Certificate trust and PostgreSQL readiness remain BLOCKED/NOT YET VERIFIED until owner runtime output; Supavisor remains UNKNOWN.
Final verification this follow-up: offline tests 15 PASS / 0 FAIL / 0 SKIP; scoped ESLint PASS; PowerShell helper syntax PASS; git diff --check PASS for tracked files. Backend typecheck FAIL at unrelated src/controllers/auth.controller.ts:207 (string | null passed as string); no unrelated auth file was changed. Changed files: scripts/payment-pg-ca.cjs, scripts/payment-pg-ca.test.cjs, scripts/set-payment-pg-ca.ps1, scripts/payment-pg-readiness.cjs and this review. Offline trust signature tests are not live TLS handshake tests.

## Schema-array decoding repair — 2026-10-13

Owner supplied CA_IDENTITY_PASS for the reviewed root, TEST_SECRET_PRESENT=true, then schema_search_path rejection. Reaching that stage proves the first run connected with certificate verification enabled and passed role/database identity; it does not establish full readiness. A subsequent run stopped at postgres_connect with an unknown exception; its root cause remains UNKNOWN.

Local reproduction verified pg types parser OID 1003 (name[]) returns a string whereas OID 1009 (text[]) returns an array. current_schemas(false) produces name[], so the previous JSON-array comparison rejected valid schema membership. Both runner and Prisma integration identity SQL now explicitly cast current_schemas(false)::text[]. No schema security assertion was removed. Schema failures now report only allowlisted boolean comparisons. Uncoded connection timeout/termination messages are classified into fixed labels without forwarding raw content. Two regression tests cover decoding and output redaction. No runtime connection or mutation was performed by Codex.

Next: rerun node .\apps\backend\scripts\payment-pg-readiness.cjs in the existing CA/secret-configured owner PowerShell and share sanitized output. Do not reset credentials or rerun provisioning. A–J remains NOT EXECUTED and Supavisor capacity UNKNOWN.
Verification for the schema-array repair: offline tests 17 PASS / 0 FAIL / 0 SKIP; scoped ESLint PASS; backend typecheck PASS. Checks were slower than prior runs but completed successfully. Runtime second-run connection failure remains UNKNOWN; no database mutation occurred.

## Correct TLS evidence boundary — 2026-10-13

Owner output reached tls_evidence/TLS_EVIDENCE_MISSING after the isolation verifier completed, demonstrating all ten denial probes and identity/schema/ACL/marker checks passed in that owner run. It does not establish a complete readiness PASS because the final evidence condition failed.

Source defect: the helper required pg_stat_ssl for pg_backend_pid() to show SSL. Through Supavisor this is pooler-to-PostgreSQL backend evidence, not the Node-to-pooler TLS connection. Its unavailable/false result was incorrectly treated as missing client TLS. Exact upstream TLS state remains UNVERIFIED; no inference of encryption or exposure is made from the generic label.

The helper now verifies the actual pg client connection.stream: encrypted=true, authorized=true, no authorizationError, effective rejectUnauthorized=true, peer certificate present, and Node tls.checkServerIdentity against the exact URL hostname. No security predicate is bypassed. Pooler-to-database TLS is explicitly NOT ASSESSED, and Supavisor capacity remains UNKNOWN. Offline regression rejects unauthorized sockets, plaintext sockets and wrong hostnames, while accepting an authorized mock socket with the retained matching certificate. This is not a live TLS handshake test.

No database operation or mutation was performed by Codex. Next owner action: rerun node .\apps\backend\scripts\payment-pg-readiness.cjs in the same secret/CA-configured PowerShell. A–J remains NOT EXECUTED; no migration, fixture, cleanup or worker execution is authorized.
Verification of the client-socket evidence repair: 18 offline tests PASS / 0 FAIL / 0 SKIP; scoped ESLint PASS; backend typecheck PASS. Files changed: payment-pg-readiness.cjs, payment-pg-readiness.test.cjs and this review document. Runtime readiness still requires the owner rerun.

## Owner-executed restricted readiness PASS — 2026-10-13

The owner supplied output from node .\apps\backend\scripts\payment-pg-readiness.cjs in the existing secret/CA-configured PowerShell:

```text
TEST_SECRET_PRESENT=true
READ-ONLY PASS: restricted identity/schema, marker/emptiness, ten 42501 probes and public ACL checks.
TLS PASS: Node-to-pooler socket encrypted, certificate authorized and exact hostname verified. Pooler-to-database TLS not assessed; Supavisor capacity UNKNOWN.
```

Classification: owner-executed real PostgreSQL read-only readiness evidence PASS, not A–J concurrency acceptance. This verifies exact restricted current/session role and database; isolated schema/search_path; role security and public ACL checks; ten direct financial-relation denials with SQLSTATE 42501; exact ownership marker and empty schema; and actual client socket encryption, authorized certificate and exact hostname verification. Process secret presence is confirmed without its value being exposed. No password reset or repeated provisioning is needed.

Remaining external gates: Supavisor tenant pool size/client cap, current active/waiting utilization and approved four-connection reserve; pooler-to-database TLS remains NOT ASSESSED. Separate explicit authorization is still required for DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop after prerequisites pass. No migrations, fixtures, schema cleanup, A–J, Stripe or workers ran. Database mutations for this follow-up: NONE. Overall concurrency integration remains BLOCKED; do not report PostgreSQL A–J PASS from this readiness result.
## Final Supavisor capacity assessment — 2026-10-13

Capacity-only decision: NO-GO / BLOCKED, because effective Supavisor pool size, client limit, active/waiting utilization and approved workload reserve remain UNKNOWN. No settings, connections burst, test workload or database data were changed.

Read-only project metadata verifies electrohub-dev, pzxekjybdiulzmssalfo, ap-northeast-2, ACTIVE_HEALTHY, PostgreSQL 17.6.1.166. Aggregate pg_stat_activity observation: max_connections=60; superuser_reserved_connections=3; reserved_connections=0; 14 total visible backends (includes background processes), 6 client backends, 1 visible active, 6 visible idle, zero visible Lock waiters, zero runner-role backends. Visibility of other session state may be restricted. These are one-time database observations, not Supavisor client/queue metrics or a measured normal workload peak. Do not subtract all 14 backends from 60 to compute available client connections. PostgreSQL lock waiters do not equal clients queued at Supavisor.

Available connector metadata contains project identity/status/version, not compute tier or tenant pool configuration. No discovered read-only tool exposes the configured pool size, client limit or metric endpoint. An aggregate logs query for pool-related sources returned an empty result; this establishes no queue-depth or no-error claim. No failed historical access investigation was repeated.

Current official documentation: https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits distinguishes backend pool size from compute-specific maximum pooler clients and identifies Observability reports. https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI specifies pool size per user/database/mode combination and one backend reserved for each session-mode client until disconnect. Different role pools still share the PostgreSQL connection budget. General 40%/80% guidance is not project-specific approval or proof of spare capacity. https://supabase.com/docs/guides/database/connection-management identifies Database Settings / Connection pooling and existing connection monitoring.

Source topology reviewed: runner closes its read-only preflight client before Prisma migrate deploy; synchronous migration process exits before one Vitest fork launches; integration PrismaPg max=4/min=0, afterAll disconnects; cleanup starts only after the test child exits, using one pg client. Thus cleanup is not a fifth simultaneous test connection. Prisma migration engine connection usage has not been measured; role limit four and URL connection_limit are safeguards, not measurements of CLI demand. Close owner admin/test psql sessions before any future run, since they consume role or normal workload slots. Successful sequential structure does not prove immediately released pooler sessions or resource usage under failure.

Capacity acceptance requires observed tenant client spare capacity >=4 after the approved normal DEV reserve, a session backend pool for the runner supporting four simultaneous sessions, and global PostgreSQL backend reserve sufficient for four extra sessions plus normal workload. A separate one-slot operational contingency is recommended for stage overlap/reconnect and migration/cleanup transitions; it is a planning reserve, not a claimed fifth steady test connection. The owner must explicitly establish the reserve and quiet-window workload assumptions. Verify waiting queue absent or acceptably bounded with authoritative telemetry; log silence alone is insufficient.

No connection-cap change is justified yet. A quiet existing DEV window is preferred once metrics confirm sufficient reserve. Reducing max four to two could be evaluated if the measured budget requires it, but concurrency barriers and nested service transaction demand must first be reviewed; reducing to one would invalidate concurrent-transaction verification. Do not weaken A–J or extend acquisition timeouts to conceal queueing.

One consolidated owner evidence action: open https://supabase.com/dashboard/project/pzxekjybdiulzmssalfo/database/settings -> Connection pooling and record Pool Size, maximum client connections and compute tier without connection strings. Then https://supabase.com/dashboard/project/pzxekjybdiulzmssalfo/observability/database -> Shared Pooler (Supavisor) Client Connections and Database Connections: record latest refresh timestamp, current utilization and recent normal-workload peak, available session/role breakdown and waiting/queued clients from existing telemetry. Pooler Logs at /logs/pooler-logs can identify saturation/timeouts but do not measure queue depth. If queued-client telemetry is not available, report that explicitly and obtain authoritative queue/capacity evidence from the existing monitoring/provider support; do not invent zero. Supply one sanitized packet with these values, proposed quiet test window and explicitly reserved normal DEV headroom. No new monitoring infrastructure or credential disclosure is requested.

Final: pool size UNKNOWN; max client connections UNKNOWN; Supavisor active UNKNOWN; Supavisor waiting UNKNOWN; reserved headroom UNKNOWN; four-connection budget BLOCKED; PostgreSQL A–J NOT EXECUTED. The existing read-only readiness PASS is preserved. Capacity GO is separate from the still-required exact A–J mutation authorization.

## Owner-supplied DEV capacity screenshots — 2026-10-13

This update supersedes the **unknown configuration values** in the preceding capacity assessment; it does not change its no-go decision or the read-only readiness result. All seven screenshots show the Supabase Dashboard URL for `pzxekjybdiulzmssalfo` and the `electrohub-dev` project. The `main PRODUCTION` badge names the branch environment inside that DEV project, not the separate ElectroHub production project.

| Evidence | Value shown | Interpretation |
| --- | --- | --- |
| Infrastructure screenshots `975db09e…` and `f128f16d…` | `t3.nano` in `ap-northeast-2`; selected **Nano** tier, Free plan | Up to 0.5 GB memory, shared compute. Infrastructure card showed **7/60 PostgreSQL connections** at its capture. |
| Database Settings screenshot `8f239635…` | Connection pool size **15**; maximum client connections **200** | Dashboard defines the 15 as underlying PostgreSQL connections **per user + database pool** and the 200 as the pooler's concurrent **client** limit. These are different ceilings; neither is a measured active-client count. |
| Live Database Connections screenshot `af249a87…` | **10/60 PostgreSQL connections**; 0 active queries, 0 idle in transaction, 0 blocked queries | A separate live database-backend snapshot. Zero blocked PostgreSQL queries does **not** establish zero Supavisor clients waiting for a backend. |
| Database observability screenshot `2775a9b1…` | **7 PostgreSQL connections**; displayed interval **Oct 13, 2026, 12:09 a.m.–1:09 a.m.** | Dashboard time-zone label and actual screenshot capture instant are absent. This is a backend-connections chart, not client utilization. |
| Observability Overview screenshot `508109f1…` | **13/60 peak PostgreSQL connections** over displayed **last 24 hours** | Recent database-backend peak, not a Supavisor client peak. The screenshot does not show the precise start/end instant. |
| Database Size screenshot `bceea5b3…` | Storage only | No additional connection-capacity or queue metric. |

Supavisor **active client connections, recent client peak, and waiting/queued clients remain UNKNOWN**; no screenshot displays those metrics. The 7/60 and 10/60 values are different backend snapshots, not conflicting simultaneous measurements. For session pooling, four concurrent test clients can require four PostgreSQL backends. Four is below the configured 15-connection pool ceiling for the restricted user/database combination (assuming no other sessions consume that combination). The recent observed backend peak plus four would be 17/60, which indicates ample **historical PostgreSQL backend** capacity, but it does not prove current pooler client headroom, queue absence, or a reserved margin for normal DEV activity. The prior role connection limit of four also makes any overlapping test-role administration/migration session relevant; no such overlap is approved from these screenshots.

**Capacity-only decision: NO-GO / BLOCKED.** The configured ceilings are compatible with a four-connection pool, but safe reserved Supavisor capacity is not demonstrated. Before changing this decision, obtain a same-window measurement of Supavisor active and waiting clients (and recent client peak if available), plus an explicit normal-DEV reserve/quiet-window budget. Do not substitute `max_connections=60`, the 13-backend peak, or zero blocked PostgreSQL queries for those missing pooler measures. PostgreSQL A–J remains NOT EXECUTED; this documentation update caused no database mutation or setting change.

## Bounded A–J execution proposal and fresh read-only assessment — 2026-10-13

**Capacity: CONDITIONAL GO for the proposed supervised budget only. Current execution: NO-GO.** This is a conditional plan, not verified Supavisor headroom or permission to run. It can become executable after the source blockers below are resolved, fresh start checks pass, and the owner approves the window/reserve and explicitly accepts the remaining unobservable pooler risk (or supplies authoritative pooler telemetry). If the requirement is a guarantee of no interference with normal DEV, unknown pooler utilization prevents that guarantee and capacity remains NO-GO.

### Fresh observations

The project metadata connector reconfirmed `electrohub-dev`, `pzxekjybdiulzmssalfo`, `ap-northeast-2`, ACTIVE_HEALTHY, PostgreSQL 17.6.1.166. A DEV-only aggregate catalog query at **2026-10-13 10:12:46.673282 UTC** reported max_connections=60, superuser_reserved_connections=3, reserved_connections=0; 6 database-visible backends, including **4 client backends**, 1 active and 3 idle, 0 hidden client states, 0 visible Lock waiters, **0 runner-role backends**. The active count includes the observation itself. Non-client/background backends must not be charged as ordinary client slots. This leaves a configured ordinary-client ceiling of 57, not a normal-workload reservation or a Supavisor utilization measurement. No application query text or financial row content was retrieved.

A separate DEV aggregate of PaymentWork state at **10:17:24 UTC** found **55 DONE, 11 READY (all due), and 1 LEASED (expired or missing lease)**, with zero unexpired leases. No job IDs, customer data or provider objects were read. These historical jobs were not modified or processed; the snapshot cannot prove no external worker will start later. No worker or service was started. Owner supervision must ensure no concurrent acceptance, recovery startup or scheduled test workload during the window.

Available connector metadata/tools still expose no live Supavisor client count or queue depth. An application_name-based count found no labelled Supavisor backends; this is not evidence of zero pooler usage. No repeated logs/access investigation was attempted. The earlier screenshots remain the configuration evidence: Nano, pool size 15, client ceiling 200, historical PostgreSQL peak 13. Current client/waiting counts and normal DEV reserve remain **UNKNOWN**.

### Separate pool and connection demand

The current [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI), reviewed in this follow-up, defines a pool per user/database/mode combination and a backend held by each session-mode client until disconnect. Thus `eh_payment_concurrency_runner` / `postgres` / session is a distinct pool from the application's `postgres` user pool. It is not a reserved slice of global PostgreSQL or Supavisor capacity. The restricted role's connection limit of four remains the role-level bound; other sessions using that role must be closed before starting.

Source review: `payment.concurrency.postgres.integration.test.ts:111` caps one PrismaPg adapter at **4**, min=0; runner uses one Vitest fork and sequential tests. A/B start two service calls together; J holds **two independent Serializable transactions** after reads at its barrier, so one connection invalidates J. G/H use provider gates after the claim transaction, rather than holding a SQL transaction across mock-provider waiting. Inventory changes receive the existing OrderService transaction client. Parallel final assertions can queue bounded read queries without needing six simultaneous sessions. No inspected transaction path waits for another connection while holding its own transaction and depending on that connection. The injected database/provider is used for the exercised service and webhook paths; no global recovery selection is called.

**Four is sufficient as a source-level cap, not runtime proven or shown necessary.** Two is the logical transaction-concurrency lower bound and appears viable from inspected paths, but this source has no supported budget parameter or real two-slot qualification. Do not change the cap for the first approved run merely on inference. The imported default Prisma singleton has a separate configured pool but is lazy; any accidental fallback could exceed the intended aggregate demand, so the four-role-session ceiling and monitoring remain mandatory. A/B barriers synchronize requests before service entry; they do not prove a specific simultaneous row-lock interleaving. J's in-transaction barrier is stronger. Record actual observed transaction outcomes rather than claiming exhaustive deadlock/lock scheduling coverage.

### Proposed window, budget and stop rules

Propose one **15-minute owner-selected quiet DEV window**, starting within five minutes of a fresh readiness/capacity check. No particular clock time is presumed quiet. Keep normal DEV services available; avoid deploys, bulk imports, other tests and worker startup during this window. These are proposed operating constraints, not verified current topology or permission to stop existing services.

Budget: **at most four simultaneous runner-role sessions**, including any migration-engine demand; no separate test-role psql session. Preflight, migration, one test fork, and cleanup must not overlap. Reserve **at most one independent read-only observation connection**, **two ordinary slots for reconnect/operational contingency**, and **16 ordinary slots for normal DEV growth**. The latter figures are conservative proposals requiring owner acceptance; they are not provider-reserved capacity. With 57 ordinary slots, require baseline client backends **<=34** before adding four test sessions and one observer (34+4+1+2+16=57). The measured four and historical peak 13 fit that arithmetic; neither establishes future workload.

If Supavisor client telemetry is available, require baseline **<=173/200** to retain four test clients, one observer, two contingency clients and 20 normal-client slots; require no pre-existing queue. These are proposed margins, not measured usage. If telemetry is unavailable, record UNKNOWN and require explicit residual-risk acceptance; connection success or PostgreSQL lock telemetry cannot replace the missing queue measure.

Observe at most every **5 seconds** during the bounded run, using existing Dashboard/connector monitoring and at most one observation connection. Stop advancing stages on any: total PostgreSQL client backends **>=41**; runner-role sessions **>4** or unexpected test client/pool; any normal-DEV connection rejection, new timeout or service incident; SQLSTATE **53300**, **57P03**, connection timeout, ECONNRESET or ETIMEDOUT; Prisma acquisition timeout/P2024 or unexpected P2028; reported Supavisor queue lasting **>5 seconds** or two consecutive samples; a normal-DEV query blocked by a test PID; loss of target/TLS/isolation verification; or lost monitoring for **>10 seconds**. Expected controlled P0001, 23505, 23514 and J's asserted 40001 are test outcomes, not capacity incidents. Preserve bounded conflict handling; do not increase timeouts or replay the run automatically. Stop means halt fixture/test progression, close only run-owned sessions, then perform authorized cleanup only after child termination is confirmed. Do not terminate normal DEV sessions or historical workers.

### Execution blockers and failure recovery

Confirmed source blocker: runner line 343 passes **`--config vitest.config.ts`**, but only **`apps/backend/vitest.config.mts`** exists. The runner would migrate first, then fail test startup and attempt cleanup. This must be corrected and regression-tested **before approval is exercised**. No source was changed in this read-only assessment.

The runner's spawnSync implementation has 120-second migration and test stage limits, but **no live capacity watchdog or verified Windows cancellation/descendant termination**. Proposed stop thresholds are an operating plan, not existing automation. A supervised cancellation/monitoring procedure must be proven before mutation. Migration-engine session count and TLS trust are also not proven by Node readiness: `NODE_EXTRA_CA_CERTS` establishes Node trust, while Prisma migrate uses a separate engine and the unchanged URL has `sslmode=require`. Verify that engine's supported CA/hostname verification and role-wide connection bound offline; never infer those properties from the PrismaPg TLS result. The suite has no explicit per-scenario timeout override; validate its remote-test time budget without concealing performance failures.

Successful sequencing: read-only isolation preflight closes; Prisma deploy applies the migration chain only to the empty marked test schema (no seed invocation); migration child exits; one fork runs isolated fixtures and A–J with LocalPaymentProvider and local webhook signatures; test disconnect/child exit; one cleanup client. Provider gates use only the fixture attempt IDs. No real Stripe or global worker is involved.

On a migration/test failure, retain sanitized stage/SQLSTATE/count evidence before cleanup. The cleanup transaction checks identity/owner/marker and external dependencies, drops all internal tables together using RESTRICT (including the isolated migration ledger; dependent indexes/constraints/row types/owned sequences follow), remaining sequences and enums with RESTRICT, then the schema with RESTRICT and verifies absence. Failure rolls back and explicitly reports CLEANUP FAIL; it must not fall back to CASCADE or broader privileges. A failed F teardown can leave a function that deliberately blocks this conservative cleanup; inspect only isolated catalogs and prepare exact recovery separately. Connection-loss rollback/cleanup cannot be promised without reconnection evidence. A killed parent cannot be assumed to execute finally. Never retry provisioning or migration blindly, manually edit a migration ledger, or drop external objects. The login role remains after successful schema cleanup; any recreation/rerun requires new scope review.

### Exact conditional owner authorization request

After the config/cancellation/migration-TLS prerequisites are corrected and verified, request this **single one-run authorization** (not granted by this assessment):

> I authorize one controlled A–J run in DEV `pzxekjybdiulzmssalfo` during the agreed 15-minute quiet window, using only `eh_payment_concurrency_runner`, with at most four role sessions, and only the marked schema `electrohub_payment_concurrency_20261012`. Scope: `DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop`. This permits the schema-local migration chain, disposable fixtures, actual service A–J tests with mocked Stripe, and exact RESTRICT cleanup on success or failure, after child termination. I approve the proposed normal-workload reserve and stop conditions. If Supavisor utilization remains unavailable, I explicitly accept the residual risk of unseen pooler saturation/queueing and transient DEV disruption; stop on the defined signals, with no automatic rerun. No public/PROD writes, live Stripe, worker startup, historical PaymentWork processing, pool-setting changes, or extra privileges are authorized. Start only after fresh isolation, TLS, capacity and operational prerequisites pass; otherwise remain blocked.

Verification this follow-up: offline runner/readiness/CA safety tests **18 PASS / 0 FAIL / 0 SKIP** (`node --test` on the three script test files). They do not cover the erroneous execution config path or prove real application concurrency. Source fingerprints SHA256: runner `4486F9BFC401D769AE59E26D7828DC34FB43D5C9BD9727D0246B4F0EE1BD33C8`; service suite `34B6EA33663D4EB89A5C3BA9280C563AD5E2EEFC1AF2DF724271D5AE6013F46F`; actual Vitest config `B06DD9D4BDF1BFCC9E8D1BC511CA9B723F080288F0E6E432360822F726C805B7`. Test secret/approval are absent in Codex's process; the owner's separately configured PowerShell secret remains untouched. Only this document was edited; database mutations **NONE**. A–J, migrations, fixture creation and cleanup **NOT EXECUTED**.

## Execution safety hardening — 2026-10-13

The three source-preparation blockers have been addressed and verified offline. This section supersedes the previous config-path, cancellation and reserve-threshold proposals; it does not change historical runtime evidence or grant execution approval. No database connection, migration, fixture, A–J run, cleanup, Stripe operation or worker startup occurred in this follow-up. `PAYMENT_PG_TEST_APPROVED` remains unset in Codex's process. Existing offline gate fixtures continue testing synthetic child environments with fake URLs; they never invoke --run.

### Selection and process lifecycle

`payment-pg-execution.cjs:52` builds the exact test child with backend working directory, the existing **vitest.config.mts**, the one integration file, one fork and no file parallelism. The test child inherits execution approval only after separate authorization; it does not manufacture it. Before fixture writes, the integration beforeAll still verifies its internal gate and database identity. The runner parses the in-memory Vitest JSON report and requires the exact file, exactly ten passed assertions named A–J, zero failures/skips/todos and success=true. A silent gated skip is a failure. Raw child stdout/stderr/reports are not logged or written to disk; only fixed stage labels, allowlisted database error codes and numeric exit evidence are emitted.

`payment-pg-child-guard.ps1` starts each target suspended, assigns it to a private Windows Job with KILL_ON_JOB_CLOSE, then resumes it. Descendants inherit containment without breakaway permission. It retains an owner-process handle and terminates the job on owner loss, deadline or root exit, including orphaned descendants after a natural root exit. Normal completion confirms Job ActiveProcesses=0 before returning. Assignment/startup failures fail closed. Targets are passed as structured arguments to CreateProcess, without shell expansion or credentials in command arguments. No process-name matching, global taskkill or privilege change is used. The implementation intentionally refuses other platforms until equivalent containment is verified.

The asynchronous parent handles SIGINT/SIGTERM through AbortControllers, polls the observer once per second, bounds output to 4 MiB, and terminates only its owned guardian on cancellation. Unconfirmed termination after five seconds is a failure and prevents cleanup or subsequent stages. Native child lifetime bounds: read-only engine probe **30s**, migration **120s**, tests **120s**, cleanup **60s**, with bounded startup/drain allowances. A second owner signal can cancel cleanup. OS/owner force termination can prevent parent finally execution; the schema may remain, so successful cleanup is never promised after abrupt parent loss.

Sequence: close Node read-only preflight; strict native-engine read-only TLS/identity probe; migration; one A–J test fork; bounded cleanup child. A failed admission or failed engine probe causes no schema deletion. After a potentially mutating stage, failure stops further stages and attempts cleanup only with fresh healthy monitoring and confirmed child termination. Cleanup first rejects any other test-role database session, checks exact role/owner/marker/external dependencies, and uses schema-qualified RESTRICT drops. All tables are dropped together to handle internal FKs; indexes/constraints/row types/owned sequences follow their owning tables. Only the exact owned zero-argument, non-SECURITY-DEFINER plpgsql trigger function `pgtest_raise_after_transfer` is additionally allowed, so failed F teardown can be cleaned safely; other routines are rejected. Remaining sequences, enums and schema are dropped with RESTRICT, absence verified, and the transaction committed. Errors roll back and explicitly report CLEANUP FAIL/BLOCKED; no CASCADE, public drop or privilege fallback exists. Database connection loss can leave isolated objects; recovery requires verified reconnection and exact scope review, with no automatic rerun.

### Prisma native TLS and connection configuration

Installed prisma, engines and client versions are **6.12.0**. Source preparation refuses an unreviewed CLI/engine version. Reviewed primary source: [Prisma 6.12 PostgreSQL URL parser](https://github.com/prisma/prisma-engines/blob/6.12.0/quaint/src/connector/postgres/url.rs) and [native connector](https://github.com/prisma/prisma-engines/blob/6.12.0/quaint/src/connector/postgres/native/mod.rs). The pinned engine reads a PEM root via **sslcert**, loads it as an additional trusted root, and defaults to accepting invalid certificates unless **sslaccept=strict** is supplied. Its native TLS builder retains default hostname checking; the URL parser accepts options/connect_timeout/socket_timeout. Do not rely on the generic documentation's sslrootcert spelling for this pinned version.

The migration URL is derived in memory from the exact restricted DEV URL, rejects duplicate/unexpected parameters, revalidates the approved CA fingerprint/signature/validity, and sets **sslmode=require, sslaccept=strict, sslcert=absolute verified CA path, connection_limit=1, connect_timeout=5, pool_timeout=5, socket_timeout=30**. Startup options pin only the test search_path and bound statement_timeout=30000ms and lock_timeout=5000ms. DATABASE_URL and DIRECT_URL are set identically **only in the native child environment**. The parent's application URLs and original test URL remain untouched. Session mode, hostname, role suffix, database and schema are exact; schema-local ledger isolation remains mandatory. Node pg strips URL SSL overrides and retains rejectUnauthorized=true with query/statement/lock/connect timeouts. PrismaPg keeps its four-slot cap, verified Node trust, certificate checks and hostname behavior, and now has server-side statement/lock bounds.

**Prisma TLS: PARTIAL (configuration/source verified; live native handshake NOT EXECUTED). Connection limits: PARTIAL (one-slot native URL/four-slot application cap, role ceiling and watchdog verified offline; native runtime demand NOT MEASURED).** The first future native child uses `payment-pg-engine-probe.sql` in BEGIN READ ONLY and asserts role/session/database/exclusive schema before deploy. Any TLS/identity failure stops before migration. A success will establish the configured native connection path; this follow-up does not claim native engine runtime PASS from Node readiness. No timeouts were increased in application services; the test harness explicitly bounds test/hook lifetime to 30s.

### Corrected capacity and observation contract

All **19 reserve slots** (16 normal DEV + 2 contingency + 1 observer) are now excluded from the test allocation: **57 - 19 = 38**. Admission requires **<=34 ordinary client backends** (38-4); the test-inclusive allowed maximum is **38**; cancel at **>=39**, replacing the unsafe previous >=41 threshold. Counts must be cluster-wide ordinary client backends, not all PostgreSQL background processes, a single database subset or Supavisor per-pool usage. The observer's own connection is part of that cluster count; conservatively retaining the extra observer reserve avoids promising those slots to tests. No normal reserve is claimed physically reserved or owner-approved yet.

The runner requires an absolute `PAYMENT_PG_TEST_MONITOR_FILE` supplied by a **trusted external read-only observer**, outside the repository. Publish it atomically at least every five seconds; samples older than ten seconds, malformed samples, target mismatch or missing health observations block/cancel. The runner observes the file; it does not start an administrative connection, worker, observer service or new infrastructure. The external observer must be operational before execution and must report real measurements rather than defaulting missing values to safe values.

Required sample fields: `project=pzxekjybdiulzmssalfo`, numeric UTC `timestampMs`, `ordinaryLimit=57`, `clientBackendScope=cluster`, numeric `clientBackends` and `runnerBackends`, observed booleans `devConnectionErrors=false`, `abnormalLockWait=false`, `tlsIsolationPass=true`, and `poolerClients`/`queueDurationMs` as measured numbers or explicit **null**. Undefined metrics are invalid. Public financial rows/query text are not needed. The observer must detect normal DEV errors and abnormal/test-caused lock waits through existing approved monitoring. Configured admission is zero existing runner sessions and <=4 during execution; Supavisor admission <=173 clients, run ceiling177, cancellation>=178, queue zero at admission and cancellation after >5000ms. These pooler margins are proposed, not provider reservations. Missing pooler metrics require **separate explicit residual-risk acceptance**, represented by PAYMENT_PG_TEST_POOLER_RISK_ACCEPTED only after owner approval; the flag is not set by preparation. Other health/TLS/isolation observations cannot be waived.

Residual risks: queueing and unseen Supavisor saturation remain unobservable when null; five-second sampling is not an instantaneous isolation guarantee; shared Nano CPU/memory contention and native connection demand require runtime evidence; owner/kernel/network failure may retain the isolated schema. Without a real observer feed, the run remains BLOCKED regardless of owner mutation approval. Quiet-window proposal remains one supervised owner-selected 15-minute DEV window. Historical READY/LEASED work remains untouched.

### Verification, changed files and execution gate

Final offline command: `node --test apps/backend/scripts/payment-pg-execution.test.cjs apps/backend/scripts/payment-concurrency-integration-suite.test.cjs apps/backend/scripts/payment-pg-readiness.test.cjs apps/backend/scripts/payment-pg-ca.test.cjs` — **32 PASS / 0 FAIL / 0 SKIP**. This includes real local Windows mock child trees (normal orphan exit, nonzero exit, timeout, cancellation, monitor stop and owner loss), signal dispatch, unresponsive guardian refusal, skip/selection rejection, TLS/options/version rejection, capacity boundary tests, cleanup external-dependency/other-session/marker refusal and exact F-function cleanup. No PostgreSQL fixture writes are involved. Backend `tsc --noEmit` PASS; scoped ESLint PASS; Node syntax checks PASS; PowerShell parser PASS and C# guard compilation/execution exercised by the mock-child tests. `git diff --check` PASS for tracked changes; touched untracked files were separately reviewed because Git does not include them in that check. Initial lint found an unused old redactor, which was removed; final lint passed. No unrelated working-tree changes were modified.

Changed files: `apps/backend/scripts/payment-concurrency-integration-suite.cjs`, `apps/backend/scripts/payment-concurrency-integration-suite.test.cjs`, `apps/backend/scripts/payment-pg-execution.cjs`, `apps/backend/scripts/payment-pg-execution.test.cjs`, `apps/backend/scripts/payment-pg-child-guard.ps1`, `apps/backend/scripts/payment-pg-engine-probe.sql`, `apps/backend/src/services/__tests__/payment.concurrency.postgres.integration.test.ts`, and this review. SHA256: runner `5B2308A0A99E3069D25D580AF8B5693FB9B8111D0F291AE4778F45EA920346B7`; execution helper `6547AE7490724F4FC3D3098465939E0F75B73C9F95CE1358005E203A085928E4`; Windows guard `04532112F41422853039AC8B09306701AA031EEB964C3F79CDF9E5C317330B6D`.

**Architect score: 92/100 provisional for execution preparation. Decision: APPROVE the offline hardening; hosted execution remains conditional and separately unauthorized.** Overall payment/concurrency integration is still PARTIAL/BLOCKED. Migration/TLS/connection runtime acceptance and PostgreSQL A–J remain NOT EXECUTED; database mutations NONE.

One exact owner authorization request:

> I authorize one supervised run in DEV `pzxekjybdiulzmssalfo` / `ap-northeast-2`, database `postgres`, restricted role `eh_payment_concurrency_runner`, exclusively in marked schema `electrohub_payment_concurrency_20261012`. Scope: `DEV:pzxekjybdiulzmssalfo:electrohub_payment_concurrency_20261012:eh_payment_concurrency_runner:migrate-deploy+fixtures+scenarios-A-J+drop`. I approve the 19-slot reserve, <=34 admission, <=38 test-inclusive maximum, >=39 abort, four-role-session cap, stated deadlines and supervised 15-minute quiet window. Proceed only with a fresh trusted observer feed and successful isolation/native strict-TLS probe; then allow schema-local migration chain, disposable fixtures, real-service A–J with mocked Stripe and exact RESTRICT cleanup on success/failure after confirmed child termination. If Supavisor client/queue telemetry remains unavailable, I explicitly accept unseen saturation, queueing and transient DEV disruption risk; otherwise missing acceptance blocks execution. Cleanup may remain blocked on lost monitoring, connection loss, changed ownership/dependencies or abrupt process death; do not broaden permissions or retry automatically. No DEV public/PROD writes, live Stripe, workers, historical work processing, pool changes, credentials/role/schema recreation, CI, commit, deployment or extra privileges are authorized.

## Trusted monitoring gate — 2026-10-13

**Observer status: BLOCKED / source prepared only.** `apps/backend/scripts/payment-pg-observer.cjs` is a local Node observer design. It accepts only the exact DEV session-pooler target and PostgreSQL observer identity, requires the verified CA with strict certificate and hostname checks, uses one connection with `default_transaction_read_only=on`, `search_path=pg_catalog`, and bounded connect/query/statement/lock times, and queries PostgreSQL catalogs/statistics only. It publishes an atomic, locked JSON record under the OS temporary directory every two seconds. Missing values remain `null`; blocked reasons are fixed labels. `payment-pg-execution.cjs` rejects blocked, stale, malformed, wrong-project, over-budget, or non-present-schema samples. Admission is **<=34** cluster client backends, test-inclusive ceiling **38**, abort at **>=39**, test-role sessions **<=4**, observer age **<=10 seconds**. The observer itself consumes a PostgreSQL client backend and is included in the cluster count.

The observer has not been connected or started. In the Codex process, presence-only checks returned `PAYMENT_PG_OBSERVER_DATABASE_URL=false`, `PAYMENT_PG_OBSERVER_HEALTH_FILE=false`, `PAYMENT_PG_TEST_MONITOR_FILE=false`, and test approval unset. No secret values were inspected. A fresh one-shot Supabase DEV connector query at **2026-10-13 14:41:13.456236 UTC** reported PostgreSQL **17.6** (`server_version_num=170006`), database `postgres`, SQL identity `postgres`, `pg_read_all_stats` visibility true, `track_activities=on`, ordinary client limit **57**, **7** cluster client backends, **0** test-role backends, **0** hidden client states, and **0** current lock waiters. A separate role-catalog query confirmed `postgres` is a login role and **not superuser**, with `pg_read_all_stats` visibility. The connector session itself reported `transaction_read_only=off`; the observer's startup option that pins read-only has not been runtime-verified. These are one-shot connector observations, not evidence that local observer login/options work, a reserved DEV workload budget, or a continuously healthy feed.

The observer's full catalog/statistics SELECT was also executed once through the DEV connector at **2026-10-13 14:58:02.233 UTC** to validate PostgreSQL 17 SQL syntax and effective-privilege expressions. It returned ordinary limit **57**, **7** client backends, **0** runner backends, **0** hidden states, no abnormal lock wait, the expected schema marker, `role_secure=true`, and `public_denied=true`. Cumulative counters at that instant were `sessions_fatal=0`, `sessions_abandoned=3178`, `sessions_killed=7`; no counter baseline or delta was inferred. The observer now treats a counter increase as the separate stop label `POSTGRES_SESSION_COUNTER_CHANGED`, never as proof that `devConnectionErrors=true`. The connector query was still not the local observer connection and did not exercise its TLS or read-only session settings.

**Health source blocker:** no approved local five-second feed was available for PostgreSQL, Supavisor, and application connection errors. The one read-only Supabase logs query for the PostgreSQL/Supavisor sources returned a provider backend error; it did not return log fields, complete coverage, or a stream. PostgreSQL session counters cannot detect client rejections that happen before a backend is established. Supavisor active-client and queue values therefore remain explicitly **null/unknown**. With the current missing observer URL, startup would report `OBSERVER_CONNECTION_REQUIRED`; if a valid observer connection were configured but the health file remained absent, the observer would report `CONNECTION_HEALTH_SOURCE_UNAVAILABLE`. It cannot emit a trusted `PASS` sample with these gaps. The local observer connection credential and target file were not configured here, so no operational monitor file was produced. The prior restricted-role TLS pass does not substitute for the observer's own runtime TLS probe.

### Observer test evidence

The monitor/runner offline suite ran **26 PASS / 0 FAIL / 0 SKIP**. It covers exact DEV target and strict TLS configuration, observer identity/full-stat requirements, incomplete/stale health feed rejection, PostgreSQL connection-counter changes/resets, admission and abort thresholds, schema-marker presence, atomic monitor writes, monitor startup failure, two-second updates, missing metrics, cancellation, owner SIGINT/SIGTERM, sanitized database/TLS/publication failures, malformed/stale monitor records, and observer continuity while a mock test child is canceled. Backend `tsc --noEmit` passed; scoped ESLint passed for the four observer/runner scripts; four `node --check` checks passed; `git diff --check` exited 0 (with existing line-ending warnings). Tests use mocks/local temporary files and do not prove DEV observer TLS, five-second health coverage, Supavisor telemetry, or PostgreSQL concurrency. No monitor approval or A–J execution flag was set.

### Interrupted-run inspection and recovery boundary

If the runner stops after migration begins, its Windows Job guard is expected to terminate and confirm the test child tree before its controlled cleanup path can proceed. If the observer or parent is interrupted, the observer publishes a blocked record on handled SIGINT/SIGTERM; abrupt termination leaves the last record stale, causing the runner to cancel. If the child tree cannot be confirmed stopped, monitoring is lost, the connection drops, or cleanup fails, assume the marked schema may remain partially migrated. Do not rerun `migrate deploy`, manually edit `_prisma_migrations`, remove objects, or drop the schema to recover.

The following **read-only** catalog inspection returns only the exact test schema's owner, marker, object names/kinds, and external dependency count; it reads no application rows:

The inspection was executed against the DEV project connector at **2026-10-13 14:51:30.728867 UTC**. It found the exact schema owner `eh_payment_concurrency_runner`, the expected DEV scope marker, **0 objects**, and **0 external dependency references**. The query session identity was `postgres`, not the restricted test role; this establishes the schema's current catalog state, not local runner-role connectivity. The empty schema confirms this task did not encounter a partial migration/test run and did not need recovery.

```sql
WITH target AS (
  SELECT oid, nspname, nspowner, obj_description(oid, 'pg_namespace') AS marker
  FROM pg_namespace
  WHERE nspname = 'electrohub_payment_concurrency_20261012'
), objects(classid, objid, namespace_oid, object_class, object_kind, object_name, owner_oid) AS (
  SELECT 'pg_class'::regclass, c.oid, c.relnamespace, 'relation', c.relkind::text, c.relname, c.relowner FROM pg_class c
  UNION ALL SELECT 'pg_type'::regclass, t.oid, t.typnamespace, 'type', t.typtype::text, t.typname, t.typowner FROM pg_type t
  UNION ALL SELECT 'pg_proc'::regclass, p.oid, p.pronamespace, 'routine', p.prokind::text, p.proname, p.proowner FROM pg_proc p
  UNION ALL SELECT 'pg_constraint'::regclass, c.oid, c.connamespace, 'constraint', c.contype::text, c.conname,
    COALESCE((SELECT r.relowner FROM pg_class r WHERE r.oid = c.conrelid),
      (SELECT ty.typowner FROM pg_type ty WHERE ty.oid = c.contypid)) FROM pg_constraint c
  UNION ALL SELECT 'pg_rewrite'::regclass, r.oid, c.relnamespace, 'rewrite', r.ev_type::text, r.rulename, c.relowner
    FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
), inventory AS (
  SELECT object_class, object_kind, object_name, pg_get_userbyid(owner_oid) AS owner
  FROM objects
  WHERE namespace_oid = (SELECT oid FROM target)
), external_dependencies AS (
  SELECT count(*)::int AS count
  FROM pg_depend d
  JOIN objects ref ON ref.classid = d.refclassid AND ref.objid = d.refobjid
  JOIN objects dep ON dep.classid = d.classid AND dep.objid = d.objid
  WHERE ref.namespace_oid = (SELECT oid FROM target)
    AND dep.namespace_oid <> (SELECT oid FROM target)
)
SELECT clock_timestamp() AT TIME ZONE 'UTC' AS inspected_at_utc,
  current_database() AS database, current_user AS role,
  t.nspname AS schema, pg_get_userbyid(t.nspowner) AS owner, t.marker,
  COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.object_class, i.object_name) FROM inventory i), '[]'::jsonb) AS objects,
  (SELECT count(*)::int FROM inventory) AS object_count,
  COALESCE((SELECT count FROM external_dependencies), 0) AS external_dependency_count
FROM (VALUES (1)) AS singleton(n)
LEFT JOIN target t ON true;
```

Check whether the isolated migration ledger exists with `SELECT to_regclass('electrohub_payment_concurrency_20261012._prisma_migrations')`; only if it exists, read its migration names and status timestamps from that schema's `_prisma_migrations` table. Do not select its `logs` column or any public ledger. Compare owner and marker exactly with the authorization scope, inspect the listed objects and dependency count, and confirm every observer/runner child process is gone before considering recovery.

Recovery remains a separate authorized operation. After the owner reviews the read-only inventory and authorizes exact cleanup, use only the existing owned cleanup path, which checks the test-role identity, no other test-role sessions, exact schema owner/marker, external dependencies, and its allowlisted schema objects; it drops only schema-qualified objects using `RESTRICT`, verifies schema absence, and rolls back/reports failure without `CASCADE`. If identity, marker, dependencies, process termination, or current monitoring cannot be verified, retain the schema and stop for review. This preparation task did not perform that cleanup.

**Gate result:** observer source and offline tests are prepared, but observer runtime, monitoring accuracy, and capacity admission are **BLOCKED**. Native TLS remains **PENDING the observer's runtime probe**. Supavisor clients/queue are **UNKNOWN**. PostgreSQL A–J, migrations, fixtures, and schema cleanup are **NOT EXECUTED**; database mutations **NONE**. The exact remaining owner action is to make an approved read-only observer credential and a genuine, gap-free PostgreSQL/Supavisor/application error-health feed available to the local observer, then review its sanitized live sample before separately authorizing any A–J run.

## Processing return scroll and Checkout B outcome toasts — 2026-10-16

Focused frontend changes: `CustomerScrollRestoration.tsx` starts checkout/payment routes at the top on all history transitions and cancels saved-position replay for those routes. `RestoredPurchase.tsx` also resets scroll when the same saved-attempt screen replaces its initial loader. Purchase identity, status reads and submission/navigation logic are unchanged.

`PaymentPurchases.tsx` scopes processing/result presence to both the route entry (including search parameters) and PaymentAttempt, with layout-effect registration. Global notices suppress only that current attempt's dedicated screen or its matching order confirmation. Other attempts remain eligible throughout Checkout B's Shipping, Delivery, Payment and Review steps. The notification tree renders through a body portal above checkout layout stacking; the mobile viewport remains below the compact header, and its empty area does not intercept checkout controls. Existing one-time/cross-tab claims, five-second dismissal, `/read` acknowledgement, saved-purchase query updates and Orders invalidation are retained; no new Cart mutation or checkout state update was added.

Verification: source review only. No automated tests, Chromium/browser sessions, typecheck, lint or builds were run for this task, as requested. No exported Figma screenshots were available in the Components/customer export folders; no visual parity is claimed. Changes are limited to the four frontend files above (including `Checkout.module.scss`) and this note. No backend/database/Stripe changes or operations, commits or pushes. Task 03.6 remains **OPEN**; runtime/visual behavior is **NOT VERIFIED**.
