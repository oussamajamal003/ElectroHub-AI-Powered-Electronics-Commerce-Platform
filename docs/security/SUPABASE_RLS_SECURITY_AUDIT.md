# Supabase RLS security audit

## Executive assessment

Audit date: 2026-10-10. Branch: `feature/Stripe`. HEAD: `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`.
This is a targeted security audit of a concurrently modified working tree, not a frozen full financial-source approval.

**No anonymous/customer database CRUD exposure was demonstrated.** Both live catalog snapshots deny SELECT, INSERT, UPDATE and DELETE, including column grants, to anon, authenticated, service_role and authenticator on all 29 public tables. PUBLIC has no public-table grants. RLS disabled alone therefore does not establish an exploitable Data API path.

However, **PROD has unnecessary whole-table privileges**, DEV permits PUBLIC schema creation, and the backend uses a broadly privileged database owner. A separate **conditional HIGH application JWT vulnerability** was reproduced offline. Deployment safety and public API configuration remain partly unverified. This report does not certify either deployment secure.

Changes to DEV: **NONE**. Changes to PROD: **NONE**. No customer/payment records retrieved, financial transactions, migrations, seeds, cleanup, infrastructure changes, workflow dispatch, commits, pushes or merges.

## 1. Evidence and project identity

| Environment | Project | Ref | Region | PostgreSQL |
|---|---|---|---|---|
| DEV | electrohub-dev | pzxekjybdiulzmssalfo | ap-northeast-2 | 17.6 |
| PROD | electrohub | yepfgjehdstlxbpespun | ap-northeast-1 | 17.6 |

Read-only Supabase connector catalog queries ran inside BEGIN READ ONLY with bounded statement timeouts, as `supabase_read_only_user`. The snapshot contains catalog identities, column names, privileges and policies, not application records or credentials.

Evidence artifacts:
- `SUPABASE_RLS_AUDIT_METADATA.json`: both environments' relation/role/default ACL/function metadata.
- `SUPABASE_RLS_AUDIT_READ_ONLY.sql`: reusable read-only catalog collection.
- `SUPABASE_RLS_REMEDIATION_DRAFT.sql`: approval-required DDL, **not executed**.
- `apps/backend/src/middleware/__tests__/database-trust-boundary.audit.test.ts`: offline regression/reproduction.

Additional safe aggregate storage checks returned zero buckets and zero public buckets in each environment. No object listing/download occurred. The snapshot does not contain application rows.

Current security-advisor responses contained six INFO `rls_enabled_no_policy` findings per environment, not the reported 23 disabled-table findings. Raw catalogs independently confirm 23 disabled tables. Treat this as an advisor/output discrepancy, not proof that the original warning was incorrect.

## 2. DEV versus PROD access inventory

Both environments have 29 public base tables, all owned by postgres. FORCE RLS is false on all. No public policies, views, materialized views or functions were found.

| Property | DEV | PROD |
|---|---|---|
| RLS disabled | 23 | 23 |
| RLS enabled, no policies | 6 | 6 |
| Normal client CRUD on public tables | None | None |
| PUBLIC public-table rights | None | None |
| Client schema USAGE | Yes | Yes |
| Client schema CREATE | Yes, inherited PUBLIC grant | No |
| anon/authenticated residual table privileges | None | 25 tables |
| service_role residual privileges | None | All 29 tables |
| Public/global explicit default ACL records | None observed | Owner-dependent grants present |

PROD residual privileges are **TRUNCATE, REFERENCES, TRIGGER, MAINTAIN**. They do not imply REST CRUD access. TRUNCATE and REFERENCES are outside row-security enforcement; no reachable public SQL/RPC path to exercise them was demonstrated. [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

DEV explicit public ACLs name postgres only. Absence of explicit default ACL records does not eliminate PostgreSQL built-in defaults, particularly PUBLIC function EXECUTE.

PROD postgres public-table defaults grant residual rights to anon/authenticated/service_role. Supabase_admin public defaults grant full table rights, sequence rights and function EXECUTE to those roles. Future objects created by that owner could reintroduce CRUD access.

## 3. All 23 RLS-disabled tables

Each row: RLS OFF, FORCE OFF, owner postgres, policies NONE; anon/authenticated/service_role/authenticator CRUD NONE, PUBLIC table grants NONE. Other observed managed-role privileges are captured in the snapshot. Backend postgres has ownership CRUD and BYPASSRLS. API schema exposure is UNKNOWN for every row. React direct database access was not found; Prisma schema/backend owns these entities. No public view/RPC bypass was found.

Classification is environment-specific: DEV acceptance is conditional on current ACLs and the Express trust boundary; PROD MEDIUM reflects verified excessive grants, **not demonstrated unauthorized record access**.

| Table | Sensitivity / integrity impact | DEV | PROD |
|---|---|---|---|
| `_prisma_migrations` | Migration checksums/history/error-log column; operational metadata | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `addresses` | Customer identity, postal addresses and location fields | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `brands` | Catalog brand metadata | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `cart_items` | Customer shopping behavior and quantities | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `carts` | Customer cart ownership | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `categories` | Catalog visibility and categorization | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `deliveries` | Order fulfillment and delivery metadata | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `email_deliveries` | Email delivery destinations and security-flow metadata | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `inventory` | Stock counts, threshold/status; financial mutation integrity | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `order_items` | Purchase history and immutable prices | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `orders` | Customer ownership, shipping/contact snapshot and financial totals | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `otp_challenges` | OTP hashes, destination/purpose and expiry | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `password_reset_tokens` | Password recovery authorization material | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `payments` | Provider/payment state, amounts and card-summary metadata | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `product_images` | Catalog media and provider identifiers | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `product_specifications` | Catalog specifications | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `products` | Public catalog plus inactive/fixture/internal fields; pricing integrity | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `refresh_tokens` | Session credentials/hashes and validity | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `reviews` | User-linked feedback and rating integrity | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `roles` | Customer/Admin role definitions; authorization integrity | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `users` | Names, email, password hash, account state and administrator identities | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `wishlist_items` | Customer preferences | ACCEPTED, current backend-only ACL | MEDIUM, M01 |
| `wishlists` | Customer saved-product ownership | ACCEPTED, current backend-only ACL | MEDIUM, M01 |

No enrollments table exists in the observed public schema. Administrator identities live in users/roles, not a separate administrator table.

### Six additional RLS-enabled tables

`security_events`, `oauth_accounts`, `payment_attempts`, `payment_attempt_items`, `payment_work`, `stripe_events` all have RLS ON and no policies: default-deny for non-bypass roles. This is compatible with current backend-only access.

PROD oauth_accounts/security_events retain the same anon/authenticated residual rights (M01). Four payment orchestration tables do not; service_role retains residual rights on all six. No client CRUD was found. Enabling FORCE does not constrain a BYPASSRLS backend role.

## 4. Exposure assessment A–I

| Question | Evidence-based outcome |
|---|---|
| A: Anonymous protected reads | Effective SQL privileges deny reads on all public tables. Runtime HTTP authorization not verified. |
| B: Authenticated cross-user reads | Supabase authenticated role has no public-table SELECT. Express ownership reviewed and tested offline; no real cross-user customer probe conducted. |
| C: Client inserts/updates/deletes | Denied by effective grants. PROD whole-table residual rights remain unnecessary and potentially dangerous if a SQL path becomes available. |
| D: Direct REST table exposure | Exposed-schema/API-enabled settings not established; missing session pgrst settings do not prove API disabled. |
| E: Public-key access | DEV public-key HTTP probes returned gateway 401, including Invalid API key; this is not a table privilege denial or a successful exposure test. |
| F: Frontend privileged credentials | 320 local frontend source/build files scanned: zero privileged-key/database-URL matches. Local frontend env names contain no database/service-role configuration. Deployed artifacts/history not audited. |
| G: Express ownership/admin checks | Current DB-active user and role are used; own Cart/Wishlist/Order/Payment scopes verified. Conditional JWT fallback risk below weakens identity if misconfigured. |
| H: Backend bypass via Supabase | Ordinary client CRUD blocked in snapshots even if public schema is exposed. No public arbitrary-SQL endpoint found. Deployment/configuration changes could invalidate this conclusion. |
| I: Functions/views bypass | No public views/RPCs. Managed SECURITY DEFINER functions reviewed below; no anonymous public-table read path found. |

### DEV HTTP limitations

Read-only root OpenAPI probes and HEAD requests with `select=id&limit=0` for all 29 tables returned 401. A legacy anon-key diagnostic also returned Invalid API key. Keys were kept transiently in memory, never recorded in artifacts. No response containing customer rows was requested or read.

These failures leave API schema configuration and effective gateway access **NOT VERIFIED**. Do not interpret them as RLS protection. No PROD API row probes, new accounts or fixtures were used. Working DEV public-key/configuration access and approved non-sensitive isolated fixtures are needed for runtime authorization testing.

### Functions, storage and realtime

No SECURITY DEFINER functions were found in public/storage/graphql_public. The graphql_public wrapper is SECURITY INVOKER and its inspected definition reports pg_graphql disabled.

Three managed SECURITY DEFINER functions exist:
- pgbouncer.get_auth: empty search_path; client roles lack schema USAGE and EXECUTE. Definition inspected only; never invoked or password material retrieved.
- vault.create_secret / vault.update_secret: empty search_path; anon/authenticated cannot execute; service_role can, consistent with its privileged server role. Never invoked; vault contents not read.

Eight storage tables have RLS ON, FORCE OFF, no policies. Managed storage grants do not bypass their row policies. Both projects currently have zero buckets. No application storage policies exist. Do not revoke managed-schema privileges indiscriminately.

The supabase_realtime publication contains no public tables. Runtime websocket subscriptions were not tested.

## 5. Trust boundary and findings

### Intended architecture

React → Express JWT/ownership authorization → Prisma → PostgreSQL. Frontend `src/lib/api.ts` uses Express /api and cookie-backed refresh; no direct Supabase database client was found. ADR-003 documents backend-only database access.

Local backend connection configuration selects postgres for DEV and PROD. Catalog postgres owns all public tables and has BYPASSRLS. This is configured-role evidence, not inspection of an independently deployed backend process.

App JWTs use userId/role, not Supabase Auth identities. Middleware loads the current active DB user and DB role. No request identity bridge to auth.uid() or per-transaction DB role/claim switching was found. An auth.uid() policy would therefore be unsupported.

Ownership evidence:
- `middleware/auth.ts:44`: current active account lookup; `:53` replaces token role with DB role; `:65` role guard.
- Cart/Wishlist routes derive owner from req.user; services scope carts/wishlists and items to that owner.
- `order.service.ts:43`: owned Order lookup; compound owned attempt lookup follows.
- `payment.service.ts:27`: owned attempt lookup; setup identity is customer-scoped.
- Checkout/Payment routers require authenticated CUSTOMER.
- Account /me changes use current owner and strict fields.
- Registration schema rejects arbitrary role fields; AuthRepository provisions CUSTOMER server-side.
- Stripe webhook verifies signature before accepted processing. Tests here are mocked, not real webhook/provider evidence.

This targeted review does not claim every future/admin endpoint audited. No active public admin-registration or customer stock-write route was discovered in this scope.

### M01 — PROD residual grants and unsafe future defaults (MEDIUM)

Confirmed unnecessary privileges on 25 existing tables, including all 23 requested tables. Potential impact: destructive/DDL-adjacent operations if privileged SQL execution becomes reachable. No such API path demonstrated; no sensitive read exposure demonstrated. Minimize grants and remove future public client defaults. RLS alone cannot fix whole-table privileges.

### M02 — DEV PUBLIC CREATE on public schema (MEDIUM)

Confirmed schema privilege inherited by client roles. It unnecessarily expands SQL-capable role authority and future object/search-path risk. No arbitrary SQL execution path demonstrated. Revoke CREATE only; retain USAGE and owner migration access.

### M03 — Broad backend owner/BYPASSRLS role (MEDIUM defense-in-depth)

Compromised backend SQL authority would reach all customer/payment tables. No SQL injection or backend compromise demonstrated. A dedicated least-privilege role requires a separate reviewed migration/cutover design: simply choosing NOBYPASSRLS would break the six default-deny tables. Do not add blanket true policies.

### H01 — Missing JWT_SECRET permits known development signing fallback (HIGH, conditional)

`apps/backend/src/utils/jwt.ts:4` selects a publicly known development fallback when JWT_SECRET is absent; `:29` verifies with it. `config/env.ts:58` allows the secret to be absent, and production checks at `:73` do not require it.

Offline reproduction with a synthetic active account and mocked Prisma confirms that a token signed using the fallback is accepted when production environment lacks JWT_SECRET. A known active user's identifier could be impersonated; looking up that user's DB role does not repair a forged identity.

**Deployed missing-secret configuration is NOT VERIFIED. No customer ID was retrieved and no live token attack was performed.** This is a code/configuration vulnerability, not evidence of an RLS exploit. No application code was changed.

Recommend separately approved fail-closed production secret validation, removal of insecure production fallback, explicit allowed signing algorithms and payload validation. Verify presence/strength without exposing values. Rotate and revoke affected sessions if fallback use is confirmed. Do not weaken existing ownership enforcement.

## 6. Exact SQL proposals and approval gate

All SQL below is **DRAFT, NOT EXECUTED**, also saved in the remediation draft artifact.

```sql
-- DRAFT ONLY. Approval required; never run as part of this audit.
-- PROD: 25 verified relations; do not add CRUD grants or change RLS.
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
COMMIT;

-- DEV ONLY, separately approved schema privilege correction.
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMIT;

-- PROD ONLY: future public relations created by the two observed owners.
-- Requires platform-owner review; does not affect existing relations.
BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
COMMIT;
```

### Compatibility and rollout

1. Capture before ACL/default ACL metadata (included snapshot); confirm no intentional client SQL consumers.
2. Approve PROD table-grant correction and DEV schema correction separately. Rehearse equivalent ACLs on approved DEV/disposable fixtures before PROD rollout.
3. postgres ownership, CRUD, locks, Serializable transactions, Stripe worker access and RLS flags remain unchanged. Thus Prisma compatibility is expected, not live-tested.
4. Default-privilege changes affect future objects only, require permission to act for the observed owner, and need Supabase platform-owner review. service_role rights are deliberately not changed in this minimal draft.
5. Verify role/grant metadata after rollout and run approved non-financial ownership tests. No customer financial transaction is needed for the ACL audit.
6. Consider Data API schema restriction only after actual platform settings and other REST/storage/edge consumers are verified. This is control-plane configuration, not a SQL operation supplied here.
7. Any client-accessible future table needs explicit restricted grants and identity-compatible RLS, not broad true policies. Function PUBLIC EXECUTE defaults require a separate owner/schema review; per-schema revocation cannot override global built-in defaults. [PostgreSQL default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

### Recovery / rollback (also approval-required)

Do not automatically restore risky permissions. If a verified legitimate dependency breaks:
- Existing PROD tables: reverse only the draft REVOKE with `GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE <the same explicit 25-table list> TO anon, authenticated;`. No SELECT/INSERT/UPDATE/DELETE was present to restore.
- DEV schema: `GRANT CREATE ON SCHEMA public TO PUBLIC;` restores the exact prior grant, but reopens M02; prefer grant to a specific legitimate migration role.
- postgres public table defaults: restore `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;`.
- supabase_admin defaults: restore the recorded full client table/sequence defaults only if independently approved: `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;` and corresponding `GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;`.
- Compare exact baseline grant options/owner context from metadata before execution. No service_role grant was removed by the draft.

RLS enables/policies, backend-role cutover and control-plane schema changes are **not approval-ready implementations** here; they require verified consumers/identity semantics. No blind auth.uid policies proposed.

### Explicit approval requests

- Approve the bounded PROD client residual-grant revocation and future-table/sequence default changes after dependency review.
- Approve DEV PUBLIC schema CREATE revocation.
- Approve separate application JWT fail-closed remediation and deployment secret-presence verification.
- Supply working DEV public-key/configuration access and approved isolated non-sensitive identities/fixtures for runtime API checks.
- Decide whether Data API public exposure is needed before requesting a control-plane change.

## 7. Verification executed

- Read-only DEV and PROD role/grant/policy/owner/schema/function metadata: **VERIFIED**.
- Local focused offline financial/authorization unit/API tests: **152/152 PASS, 12 files** (5 new audit tests, 147 existing).
- New tests cover fallback-vulnerability reproduction, DB role override, configured-secret rejection, expired-token rejection and missing/inactive-account rejection. Reproduction PASS means vulnerability confirmed, not remediated.
- Existing suites: auth middleware/controller/service; Cart/Wishlist service/routes; Payment service/routes; Checkout routes; Stripe webhook routes. Prisma/provider dependencies mocked. No real DB/provider financial testing.
- Backend `npx tsc --noEmit`: **PASS**.
- Scoped ESLint new audit test: **PASS**.
- Local frontend privileged-credential scan: **320 files, zero matches**; not a deployed bundle/history certification.
- Scoped diff whitespace check: **PASS** at initial artifact stage; final artifact validation recorded in final response.
- Real authenticated cross-user API probes, real provider/webhooks and deployed backend identity/configuration: **NOT VERIFIED**.
- Remote CI: **NOT RUN**. No workflows dispatched, especially migration-bearing backend workflows.
- No fixture creation or cleanup required.

The offline tests ran with `--maxWorkers=1` and only the listed focused files. No RLS/grant DDL or audit draft was executed.

## 8. Remaining unknowns and final assessment

Unknown: actual Data API enabled/exposed schemas, reason connector-supplied DEV public keys failed gateway validation, deployed JWT secret enforcement and backend role, deployed frontend artifacts, runtime cross-user authorization with approved fixtures, third-party client consumers and historical permissions.

**Table counts:** audited 23/23 requested tables in each environment; 29 public tables total per environment. DEV accepted current backend-only ACL configurations: 23/23. PROD MEDIUM requested-table classifications: 23/23; two additional enabled tables share M01.

**Finding counts (not table counts):** CRITICAL 0 demonstrated; HIGH 1 conditional application vulnerability; MEDIUM 3 configuration/defense-in-depth groups; LOW 0. No demonstrated live customer/payment disclosure or financial mutation. This does not mean no risk.

Recommended priority: verify/fix H01 deployment secret enforcement; revoke M01/M02 excess authority after explicit approval; document backend-only Data API trust boundary; separately plan restricted backend roles if desired.

**DEV changes performed: NONE. PROD changes performed: NONE. No self-approval.**

### Reference semantics

Grants determine which roles can reach relations; RLS controls permitted rows after grants. Supabase API schema exposure and grants must both be considered. [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

## SECURITY-01 remediation status (2026-10-10)

The former JWT fallback was removed from runtime use. Startup now requires a non-placeholder JWT secret of at least 32 characters with at least eight distinct characters. Signing and verification consume the validated environment object; access tokens are restricted to HS256 and require a UUID userId, CUSTOMER/ADMIN role, issued-at and expiry claims. The authentication middleware continues to load the active user and authoritative role from PostgreSQL.

Focused offline verification passed 41 tests across six files, including configuration validation, fallback-token rejection, algorithm/signature/expiry/claim checks, database-role authority, and mocked authentication service/controller behavior. Backend typecheck, lint and build passed. Prisma schema validation passed. These tests use mocked persistence; they do not verify deployed secrets or live cross-user access.

Local backend env files checked by name/status only contain invalid placeholder JWT values. They were not changed. DEV and PROD deployment secret presence is NOT VERIFIED. GitHub CLI authentication currently fails, so repository/environment secret inventories could not be inspected. CI now creates a fresh test-only signing key per run; this does not establish deployment configuration.

No grant, RLS, schema, API exposure, role, or database configuration change was executed. The PROD residual-grant proposal still requires separate approval and confirmation of managed-service dependencies; residual service_role privileges are explicitly outstanding. The DEV PUBLIC CREATE proposal also remains approval-gated. Data API exposed schemas remain unknown; earlier DEV HTTP probes returned invalid-key 401 responses, which are not authorization evidence.

The original audit classifications above are historical baseline findings. Current SECURITY-01 code status and remaining blockers are detailed in [SECURITY_01_REMEDIATION_REPORT.md](SECURITY_01_REMEDIATION_REPORT.md).

## SECURITY-01 final closure update (2026-10-10)

Read-only catalog revalidation through the connected DEV and PROD Supabase SQL interfaces confirmed the approval-gated findings; no SQL writes were executed.

- DEV project URL confirms project ref `pzxekjybdiulzmssalfo`. PUBLIC retains CREATE on schema `public`; anon, authenticated and service_role have no effective SELECT/INSERT/UPDATE/DELETE on public relations in the current catalog check.
- PROD revalidation: anon and authenticated retain TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on 25 public relations; service_role has these rights on 29 public relations. Effective standard CRUD checks for anon, authenticated and service_role returned zero public relations. PROD PUBLIC has no CREATE on public in the observed schema ACL.
- PROD future defaults are schema-specific: postgres public-table defaults grant the four residual rights to anon/authenticated/service_role; supabase_admin public-table defaults grant all table rights to those roles and public-sequence SELECT/UPDATE/USAGE. The query found no matching global default ACL catalog row for these owners. Supabase-managed schema defaults are not part of the proposed public-only DDL. Future function EXECUTE defaults remain a separate unresolved platform/dependency review.
- Actual PostgREST/Data API enabled state and exposed schemas remain NOT VERIFIED: the database-side `pgrst.db_schemas` setting was unavailable (NULL), and previous invalid-key HTTP 401 responses do not establish authorization. No client CRUD, customer rows, payment rows, or database writes were attempted in this pass.
- The JWT fallback remains removed and the focused tests pass, but all local ignored backend env files still contain invalid placeholder/format JWT values. Local rotation was not performed because multiple Node processes were active and their command lines could not be safely inspected; avoid interfering with a possible payment acceptance runtime.
- DEV and PROD deployment JWT secrets are NOT VERIFIED. No authenticated control-plane runtime-secret interface was available. No database/role/schema changes, deployment changes, session rotation, Stripe work, commit, or push occurred.

See [SECURITY_01_REMEDIATION_REPORT.md](SECURITY_01_REMEDIATION_REPORT.md) for detailed status, current ACL evidence, least-privilege role design, exact approval-gated SQL scopes, verification results, and remaining blockers.

## SECURITY-01 Final Execution & Closure Status (2026-10-10 Final Pass)

This section appends the final execution results achieved during the active engineering closure pass under the Principal Architect Directive:

1. **DEV Schema Hardening (EXECUTED & VERIFIED):**
   - Target: DEV project `pzxekjybdiulzmssalfo` (ap-northeast-2).
   - Compatibility verified: Schema `public` owned by `postgres` with explicit `postgres=UC/postgres`. Prisma and backend runtime do not depend on inherited `PUBLIC CREATE`.
   - Executed: `REVOKE CREATE ON SCHEMA public FROM PUBLIC;` in bounded transaction.
   - Verified ACL: Before `{postgres=UC/postgres,=UC/postgres}`; After `{postgres=UC/postgres,=U/postgres}`.
   - Effective schema rights: `PUBLIC`, `anon`, `authenticated`, and `service_role` have 0 `CREATE` permission on `public`. `postgres` retains `USAGE` and `CREATE`. Live backend tests pass (10/10).

2. **Local JWT Configuration & Process Classification (RESOLVED):**
   - 12 active Node processes classified via Windows PowerShell CIM query: 4 Chrome devtools MCP, 4 Codex `cua_node`, 4 Gemini Antigravity IDE language servers / LSP tooling.
   - Network ports 3000, 3136, 5000, 5136 confirmed 100% idle (zero active backend/payment runtimes).
   - Generated fresh 32-byte CSPRNG hex secret (64 characters) in Git-ignored files (`apps/backend/.env.local`, `apps/backend/.env`, `apps/backend/.env.test.local`).
   - Local environment validation `validateEnvironment(process.env)` PASS. 0 secrets exposed in git diff.

3. **Deployment JWT Secrets (NOT DEPLOYED):**
   - DEV and PROD backend runtimes are not yet deployed (Phase 09 deployment milestone).
   - Pre-deployment security gates documented for container startup validation.

4. **Supabase Data API (VERIFIED VIA CONTROL-PLANE & VALID-KEY PROBES):**
   - Control-plane inspection: PostgREST is `API_ENABLED` in both DEV and PROD; `public,graphql_public` are exposed in PostgREST configuration.
   - Frontend isolation: React + Vite SPA contains no `@supabase/supabase-js`; communicates solely with Express backend (`/api/v1`).
   - Valid-key HTTP probes: Probing PostgREST with authorized DEV `anon` and `publishable` keys succeeded at the API gateway layer (`VALID_KEY_ACCEPTED`), but all tested table read (`SELECT`) and mutation (`POST`, `DELETE`) requests on public application tables returned `HTTP 401` with PostgreSQL SQL error code `42501` (`permission denied for table <table_name>`).
   - RPC endpoints returned `HTTP 404 PGRST202` (no public RPC exposed).
   - Verdict: **No unauthorized direct-table access was demonstrated under the verified current PostgreSQL ACLs and tested Supabase Data API paths.** Verified table protections are enforced by PostgreSQL SQL table grants (`SQL_PERMISSION_DENIED`). Untested future RPC functions, future roles, or newly created schemas remain subject to ongoing configuration governance.

5. **PROD Grant Remediation (BLOCKED — AWAITING EXPLICIT APPROVAL):**
   - **ZERO PROD DDL OR WRITES EXECUTED.**
   - Verified exact 25 public relations retaining `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` for `anon` and `authenticated`:
     `_prisma_migrations`, `addresses`, `brands`, `cart_items`, `carts`, `categories`, `deliveries`, `email_deliveries`, `inventory`, `oauth_accounts`, `order_items`, `orders`, `otp_challenges`, `password_reset_tokens`, `payments`, `product_images`, `product_specifications`, `products`, `refresh_tokens`, `reviews`, `roles`, `security_events`, `users`, `wishlist_items`, `wishlists`.
   - The 4 public relations without `anon`/`authenticated` grants are: `payment_attempt_items`, `payment_attempts`, `payment_work`, `stripe_events`.
   - Complete approval package updated in `SUPABASE_RLS_REMEDIATION_DRAFT.sql` with 3s lock timeout, 10s statement timeout, owner-specific default ACL revokes, verification queries, and rollback SQL.
   - **Managed-Service Compatibility Gate:** Managed-service compatibility is UNKNOWN and serves as a mandatory PRE-EXECUTION GATE. Zero PROD DDL executed.

6. **Database Role Architecture (CONSISTENT LEAST-PRIVILEGE SPECIFICATION):**
   - Catalog verification in DEV and PROD confirms exactly **six** tables have RLS enabled with default-deny (0 policies in `pg_policies`):
     `oauth_accounts`, `payment_attempt_items`, `payment_attempts`, `payment_work`, `security_events`, `stripe_events`.
   - All six are owned by `postgres` with `relrowsecurity = true` and `relforcerowsecurity = false`. The remaining 23 tables are RLS disabled (`relrowsecurity = false`).
   - **Resolved Architecture (Zero Permissive Policies, NOBYPASSRLS):**
     - **Rejection of `BYPASSRLS`:** In PostgreSQL, `BYPASSRLS` is a database-wide role attribute (`rolbypassrls`), not a table-scoped permission. Granting it completely disables RLS database-wide across all tables and schemas. Treating `BYPASSRLS` as a preferred least-privilege pattern is rejected.
     - **Non-Owner `NOBYPASSRLS` Runtime Role:** `electrohub_app` created strictly with `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`. Granted only table DML (`SELECT, INSERT, UPDATE, DELETE`) on public tables and `USAGE, SELECT, UPDATE` on sequences. Possesses zero DDL rights.
     - **Separate Migration/DDL Role:** Dedicated `electrohub_migration` role owns all database objects and executes schema migrations. `electrohub_app` has no membership in `electrohub_migration`.
     - **Safe Handling of All Six RLS-Enabled Tables & Column Mappings:**
       - `oauth_accounts`: Has `user_id` (UUID NOT NULL). Supports direct ownership predicate `user_id = current_setting('app.current_user_id', true)::uuid`.
       - `security_events`: Has `user_id` (UUID NULLABLE). Unauthenticated events have `user_id IS NULL`. User policies apply strictly to customer reads (`SELECT ... WHERE user_id = ...`), while inserts are executed by backend security middleware with service context or append-only policy allowing `user_id IS NULL`.
       - `payment_attempts`: Has `user_id` (UUID NOT NULL). Supports direct ownership predicate.
       - `payment_attempt_items`: Relates via `attempt_id` to `payment_attempts.id` (no direct `user_id`). Requires subquery predicate or worker service isolation.
       - `payment_work` & `stripe_events`: Internal queue/webhook entities (no `user_id`). Addressed via dedicated worker context.
     - **Transaction-Local Identity & Session Variable Protection (Prisma Pattern):**
       - Express backend injects transaction-local claims within Prisma interactive transactions using parameterized `SELECT set_config('app.current_user_id', ${userId}, true)`. Parameter markers are supported via `set_config()`, eliminating SQL injection risks inherent in non-parameterizable `SET LOCAL`.
       - Must execute within the SAME Prisma interactive transaction (`prisma.$transaction`) as protected operations. Setting session variables outside transactions is strictly forbidden.
       - **Trust Limitations:** Custom session variables are NOT inherently trusted primitives; a compromised SQL connection could manipulate them. They serve as defense-in-depth, relying on the application boundary and input validation. Blanket permissive `USING(true)` policies are strictly prohibited.
     - **Separate Worker/Service Authorization Strategy & SECURITY DEFINER Protections:** Background orchestration tables are accessed via a dedicated worker service role (`electrohub_worker` with `NOBYPASSRLS` and `SELECT set_config('app.service_role', 'payment_worker', true)`) or encapsulated `SECURITY DEFINER` state-transition functions owned by `electrohub_migration`. Any `SECURITY DEFINER` function MUST set `search_path = pg_catalog, public` and revoke default `PUBLIC` execution rights to prevent search-path injection.
     - **Prisma Connection-Pooling Compatibility (Implementation-Dependent):** Under PostgreSQL semantics, `SELECT set_config(..., true)` (`is_local = true`) scopes settings to the active transaction. While Prisma interactive transactions (`prisma.$transaction`) pin a client connection for the transaction block, actual connection hygiene across reused connections under connection poolers (such as Supavisor on Port 5432) is implementation-dependent and requires empirical validation of driver lifecycle, pooler reset behavior (`DISCARD ALL`), and error-abort handling rather than being assumed as an unverified guarantee.
     - **Milestone Status:** Explicitly PROPOSED for future evaluation; **NOT implemented or fully validated in this pass**. ZERO roles, policies, or migrations are created. Database-role cutover remains an independent, approval-gated milestone for a future release.

7. **Verification Summary:**
   - 42/42 JWT/auth tests PASS (including OWASP `alg: none` unsigned token rejection); typecheck PASS; lint PASS; build PASS; Prisma validation PASS; git diff --check PASS; credential scan PASS; direct SQL catalog readback confirmed DEV `nspacl = {postgres=UC/postgres,=U/postgres}`.
