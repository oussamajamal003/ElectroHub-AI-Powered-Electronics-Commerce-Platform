# Logging final acceptance handoff — 2026-10-14

**Dated follow-up:** the owner subsequently authorized DEV read-only incident verification. See [the database incident handoff](LOGGING_DATABASE_INCIDENT_READ_ONLY_HANDOFF.md) and its evidence JSON. No identifiable fixture residue was found; a prior migration-evidence contradiction requires owner reconciliation. The authorization-blocked account below is preserved as the earlier snapshot.

**Database incident classification: INDETERMINATE. Final acceptance remains blocked by read-only incident verification authorization.** The logging changes below pass focused local verification. No remaining material logging defect was identified in the reviewed scope; this is not a Principal Architect score or release approval.

This closure review preserves the accepted transport and rotation policy. It is separate from AUTH, Task 03.6, CI migration safety and relationJoins. Branch: `feature/Stripe`; reviewed base: `3d69b97`. The checkout contains extensive uncommitted work from those owners. No database connection, mutation, Stripe call, migration, worker execution, CI edit, staging, commit, push or deployment was performed in this closure review.

## Database incident evidence

### Target selection, established without connecting

The general Vitest configuration loads `tests/setupEnv.ts`, which imports `src/config/env.ts`. The incident transcript shows `.env` followed by `.env.test.local`, with inherited process variables taking precedence. Prisma selects `DIRECT_URL || DATABASE_URL`. Neither a test environment name nor those configuration files enforce database disposability.

Local file parsing printed variable names and noncredential target metadata only. Both configuration files predate the incident (`.env`: 2026-10-12T20:02:24.458Z; `.env.test.local`: 2026-10-10T14:26:40.384Z). Current inherited database variables were absent. The effective file configuration is:

| Property | Evidence |
| --- | --- |
| Environment identified in repository registry | Shared DEV, `electrohub-dev`, ap-northeast-2 |
| Supabase project reference | `pzxekjybdiulzmssalfo` |
| Host / database / schema | `aws-0-ap-northeast-2.pooler.supabase.com` / `postgres` / `public` |
| Runtime-selected DIRECT_URL port | 5432 |
| DATABASE_URL port | 6543 |
| Environment registry sources | `AGENT_COORDINATION.md`; `docs/06_Database/AUTH_MIGRATION_RELEASE_PLAN.md` |

Credentials, URL values, passwords, tokens and personal records were not printed. Historical inherited variables were not fully captured, so the target is a strong configuration-based identification, not a database-confirmed historical connection identity. No PROD access was made or authorized.

### Execution and local log evidence

The preserved local chat tool output identifies execution `exec-12f6dadc-876c-4f34-9744-ebc97440105e`. The command accidentally added `tests/google.integration.test.ts` to the expanded logging selection (the exact command is in the verification section). It exited 1: 17 files, 174 total tests, 167 passed and 7 failed; six failures were Google integration tests and one was a logging size test timeout. Google reported two expired-transaction errors (15-second limit, elapsed 27,258 / 17,010 ms), plus test timeouts. A test timeout does not cancel all in-flight work or prove rollback.

Vitest started at 15:32:39 host time (2026-10-13T12:32:39Z); duration 269.47 seconds. The shell operation lasted 278.059 seconds. Proposed audit window: **2026-10-13T12:31:00Z through 12:39:00Z**.

A read of existing local active/gzip logs in that window found 176 records across both files. The runtime associated with Google HTTP activity was PID `159040`, instance `47a29a61-9a53-4bf8-b795-300a595b83db`, from 12:33:07.490Z to 12:37:08.478Z. It contained:

| Operation | Records |
| --- | ---: |
| db.select | 79 |
| db.insert | 25 |
| db.commit | 4 |
| db.rollback | 3 |
| db.delete | 2 |
| db.error | 6 |

The commit and delete records are evidence that some commands completed, not row counts or proof of durable cleanup. Error records appear in both app/error files; cross-file counts must not be interpreted as distinct exceptions. No fixture UUID was recovered. Six legacy lines could not be attributed by timestamp. Other test runtimes used mocks; their synthetic OTP/email events are not evidence of real database writes. Machine-readable sanitized scope and source fingerprints are in `LOGGING_FINAL_ACCEPTANCE_EVIDENCE.json`.

### Fixture and cleanup analysis

The integration test generates an unreported `crypto.randomUUID()` marker. Its exact email namespace is `google-<UUID>@electrohub-test.invalid`, `local-google-<UUID>@electrohub-test.invalid`, `admin-google-<UUID>@electrohub-test.invalid`, `link-google-<UUID>@electrohub-test.invalid`. Google subjects are `google-<UUID>`, `local-<UUID>`, `admin-<UUID>`, `http-link-<UUID>`. Fixture user IDs were not recorded in the preserved output.

Source paths attempt user/OAuth creation, verified password and Google sessions, refresh-token issuance/rotation/revocation, and security events. Google customer creation also upserts `roles.CUSTOMER` with an empty update, creating the shared role if absent; fixture cleanup does not remove that role. There are no migrations in this test. OTP/password-reset creation is not an intended Google test path, but related counts should be checked if fixture users remain.

`afterAll` separately selects fixture user IDs, deletes their security events, then deletes users by the four exact emails, and disconnects. These operations are not one encompassing transaction. No failed cleanup hook appears in the captured result, and two delete events were observed, but affected-row counts and fixture identities are absent. Timed-out tasks may have remained in flight. The current schema cascades user deletion to OAuth accounts, refresh tokens, OTP challenges, password reset tokens, carts and wishlists; security events and email deliveries use SET NULL. Actual deployed foreign keys were not inspected.

No broad existing-user mutation is evident in the inspected Google/session selectors: they target identities, user IDs and token families derived from the generated fixtures. A collision with an existing identity/email, detached SET NULL rows, or unexpected deployed schema behavior cannot be excluded without evidence. There is no preincident database snapshot. Current residual counts, cleanup completeness, possible pre-existing-data effects and the migration ledger are **UNKNOWN**. No clean-state assertion is made.

## Exact authorization boundary and next owner action

**Required next owner action:** authorize a narrowly scoped, read-only investigation on shared DEV `electrohub-dev`, project `pzxekjybdiulzmssalfo`, schema `public`, using a verified read-only role/transaction or an existing approved read-only access path. This task's authorization does not already establish permission for a database connection. The repository Supabase skill was used for local configuration review only; no connector query was performed.

Proposed authorized reads, with aggregate output and no credentials/customer payloads:

1. Confirm project/database identity and effective read-only access. Read relevant table/foreign-key metadata only.
2. Match the four synthetic email patterns and Google-subject patterns above, restricted to incident-created candidates where timestamps exist. Derive fixture UUID markers and synthetic user IDs only if necessary to distinguish candidates; report object classes/counts, not email/token values. Stop if the target does not match or candidates cannot be attributed safely.
3. Count related `oauth_accounts`, `refresh_tokens` (including revoked/active session counts), `security_events`, `otp_challenges`, `password_reset_tokens`, `carts` and `wishlists` for those candidate fixture IDs. Check associated SET NULL event/delivery metadata if an approved audit path can attribute deleted fixtures. Do not inspect raw tokens, password/OTP hashes, IPs, addresses or customer/payment data.
4. Check only `CUSTOMER`/`ADMIN` role metadata and creation times against the incident window; an absent baseline can leave role attribution unknown.
5. Read `_prisma_migrations` names, timestamps, checksums and status for the incident window; compare with an owner-held preincident ledger if available. Do not retrieve raw migration failure logs that might expose data. The test has no intended ledger write, but that is not proof the ledger was unchanged.
6. If necessary and separately supported by the approved path, inspect provider audit metadata limited to that time window and operation classes to attribute cleanup/late commits. Aggregate fixture absence alone cannot establish that pre-existing records were unaffected.

These are proposed reads, **not executed queries**. No query count or affected-row count is claimed. If evidence remains insufficient, retain INDETERMINATE. If residual data or possible existing-data impact is found, stop after preparing an owner-reviewed list of confirmed fixture IDs, object classes/counts, dependency order and backup requirements. Any recovery or cleanup requires separate mutation approval and subsequent independent verification. Do not delete shared roles or unidentified records. Do not retry the integration suite.

## Logging integration review and smallest fixes

Four material violations were reproduced before changing code:

| Defect | Smallest change | Evidence |
| --- | --- | --- |
| Original Winston metadata after field 100 survived redaction | Replace output with the sanitized record, preserving only required severity symbol | Actual app/error files with 110 metadata fields and synthetic password |
| Async context correlation IDs were added after sanitization | Sanitize context IDs before serialization | Actual JSON file with a synthetic JWT-shaped ID |
| Archive re-sanitization replaced canonical errors with REDACTED | Recognize only the restricted canonical error shape; sanitize it again | Actual gzip archive retains P2028/type/stack, excludes synthetic secret |
| Startup/worker completion flush could wait indefinitely | Shared two-second flush deadline; one second on forced HTTP exit; sanitized failure warning | Mocked startup import failure/stalled flush, rejected flush and fake-timer deadline checks |

No approved retention or lock algorithm was changed. `logTransport.ts` and `logContext.ts` are unchanged during this closure; the exact 20 MiB / UTC-midnight policy, 14-day/500 MiB app and 30-day/1 GiB error retention, sequential gzip archives, startup/postrotation cleanup and append behavior remain intact. A directory lease serializes all writers and rotation. App/error writes have separate failure handling inside the lease; a directory/lease failure necessarily affects both and falls back to sanitized stderr. File handles close before rename. Existing compromised-lease handling remains intact.

The logging-owned AUTH/logout and Google catch hunks add observation while retaining their existing response and cleanup behavior. AUTH cookie/session/security changes belong to the separate AUTH owner and were not edited. Cart/order transaction retry, state, locking and relation-loading changes belong to their concurrent workstreams; logging events retain safe classifications and unknown outcomes rather than changing retry decisions. Payment/Stripe observer calls use `logSafely` around provider/setup/recovery diagnostics; existing exception mapping and provider operations were preserved. Prisma listeners log operation kind/duration and fixed-format codes, excluding SQL/parameters; concurrent pool tuning/diagnostics remain intact. HTTP error handling keeps API status/code/message while observing failures. Production console output shares the sanitized format.

Fatal and startup failures exit nonzero after bounded flushing. Graceful HTTP completion exits nonzero on a failed flush. The worker's scoped test-runner arguments, batch operations and business lifecycle remain unchanged; only logging completion/error flushing changed. No server or payment worker was launched in this review. Bootstrap testing substitutes the server module before import.

`proper-lockfile` remains exactly 4.1.2 in manifest/lock, with recorded lockfile integrity; no dependency or lockfile change was made during closure. The integration review does not approve unrelated Stripe, AUTH or database dependency changes already present in the dirty tree.

## Runtime compatibility

Installed runtimes found were Node 22.19.0 (used here) and bundled Node 24.19.0. No approved Node 20 runtime was found in the inspected local runtime locations; none was installed. Repository Node 20.11.0 requirements remain unchanged.

Static review found no concrete Node 20.11 incompatibility in the changed logging code: CommonJS/NodeNext output, ES2022, AsyncLocalStorage, UUIDs, fs append/sync, stream pipeline, StringDecoder, gzip, performance and timers APIs are supported there; `--import` used by child fixtures is also available. Locked proper-lockfile 4.1.2, Winston 3.19.0, winston-transport 4.9.0, tsx 4.23.13, TypeScript 5.9.3, Vitest 4.1.11 and Vite 6.4.3 have compatible engine ranges (proper-lockfile declares no restrictive Node engine). **Actual Node 20 runtime behavior remains NOT VERIFIED.** Typecheck/build on Node 22 are not proof of execution on Node 20.

## Verification ledger

All commands below run from `apps/backend`. Counts are per run and overlap; they must not be added as unique tests.

### Reused evidence

The accepted 2026-10-13 selection passed **174 tests / 16 files, exit 0** at 13:59:43 UTC on Node 22.19.0:

```sh
npx vitest run tests/logging-continuity.test.ts tests/logging-http.test.ts tests/logger.test.ts tests/requestId.test.ts src/middleware/__tests__/errorHandler.test.ts src/lib/prisma.test.ts src/services/__tests__/stripe.provider.test.ts src/controllers/__tests__/auth.controller.test.ts src/routes/checkout.routes.test.ts src/routes/stripe-webhook.routes.test.ts tests/health.test.ts tests/env.test.ts tests/google.configuration.test.ts tests/google.provider.test.ts src/services/__tests__/auth.service.test.ts src/services/__tests__/cart.service.test.ts
```

That evidence is reused for unchanged transport policy/retention/restart/recovery and mocked integration boundaries. New formatter and lifecycle changes are covered below. The broad selection was **not rerun**. Previous backend typecheck/lint/build and logging-specific diff-check evidence was retained; changed source additionally received the narrow checks below.

The accidental command was exactly that selection with `tests/google.integration.test.ts` added between Google configuration/provider tests. It exited 1 as described above; do not run it again.

### Newly executed

```sh
node scripts/logging-safe-tests.cjs -t 'final acceptance output boundaries|startup failure flush deadline'
node --test scripts/logging-safe-tests.test.cjs
npm run test:logging -- -t 'final acceptance output boundaries|startup failure flush deadline|error responses survive a failing logger|durable queue writable|causal error classification|sanitizes nested|preserves all records|serializes real child|flushes .* evidence|production JSON|HTTP logging coverage|Logger|unexpected error responses'
npm run typecheck
npx eslint src/utils/logger.ts src/bootstrap.ts src/server.ts src/payment-runner.ts
npm run build
git -c core.safecrlf=false diff --check -- apps/backend/src/utils/logger.ts apps/backend/src/server.ts apps/backend/package.json
```

| Check | Exit / evidence |
| --- | --- |
| Initial sandbox attempt of first command | 1, zero tests: temporary Vitest cache rename EPERM; rerun with explicit sandbox approval |
| First command before fixes | 1, four reproduced failures, 41 skipped |
| First command after fixes and two additional flush assertions | 0, six passed, 41 skipped; two passed files, six skipped files |
| Node launcher guard tests | 0, six passed; real subprocess rejection of unsafe selectors before Vitest starts |
| Final focused official logging selection, 2026-10-14T14:28:58Z | 0, 29 passed, 18 skipped; seven passed files, one skipped file |
| Backend typecheck | 0 |
| Targeted source lint | 0 |
| Backend build | 0 |
| Final scoped diff check (run from repository root), closure-file whitespace scan and evidence JSON parsing | 0; zero whitespace issues; 18 source fingerprints unchanged since the reviewed snapshot |

Actual evidence includes Windows filesystem app/error output, gzip round trip, queue continuity, 90 records from three real concurrent child writers, fatal/rejection child processes and structured production stdout/stderr. HTTP tests use local Express/Supertest; startup import, stalled/rejected flush and error-handler faults are mocked. No actual database or Stripe call was made. Unchanged full 20 MiB, UTC midnight, retention and lock-recovery cases reuse the accepted evidence rather than repeat it. CI and deployed collectors were not executed or verified.

## Ownership and limitations

Closure-owned edits: `src/utils/logger.ts`; bounded flush hunks only in `src/bootstrap.ts`, `src/server.ts`, `src/payment-runner.ts`; one `test:logging` script in `package.json`; new `scripts/logging-safe-tests.cjs`, `scripts/logging-safe-tests.test.cjs`, `vitest.logging.config.mts`, `tests/logging-final-acceptance.test.ts`, `tests/logging-startup-deadline.test.ts`; this handoff/evidence and `docs/10_Operations/LOGGING.md`. The earlier `LOGGING_FIX_REPORT.md` remains historical evidence.

Reviewed but not edited during closure: transport/context, Prisma, logging middleware, AUTH/Google/Cart/Order/Payment/Stripe integration files, root lockfile. Source fingerprints accompany the evidence to identify the reviewed snapshot. Preexisting uncommitted owner changes were preserved; a clean combined release diff or approval of those separate workstreams is not claimed.

Remaining limitations:

- Database effects, fixture UUIDs and historical ledger baseline remain unknown pending authorized reads. Successful cleanup commands and timed-out tests do not settle durability or existing-data impact.
- Node 20 execution and deployed filesystem/centralized collector retention are unverified. Ephemeral deployments require persistent stdout/stderr collection; local rotation cannot preserve replaced containers.
- Abrupt termination, disk exhaustion, queue overflow, collector failure or a flush deadline can lose file events. The bounded flush reports failure but cannot cancel every stalled filesystem operation. Stderr itself may also be unavailable.
- Free-text redaction cannot infer arbitrary personal information. Callers must use fixed messages/safe fields. Already-existing legacy active logs and old gzip archives may require restricted operator handling; this review did not rewrite them.
- Shared-directory lease failure affects both sinks; separate file permissions/disk writes are handled independently. A stalled event loop can lose the lease. Filesystem durability is not a guarantee against all power/storage failures.
- Worker in-flight operations/database disconnect are outside the logging-flush deadline; no worker execution was authorized. No AI/frontend or native-crash coverage is claimed.

**Handoff decision:** logging remediation is locally reviewable, but the logging task is **not ready for final acceptance** until the Database Owner authorizes/performs the bounded read-only incident verification and the Principal Architect evaluates its evidence. Stop at that authorization boundary. No cleanup is authorized. Project-wide **NO PUSH UNTIL TASK 03.6 IS FORMALLY CLOSED AND RELEASE SAFEGUARDS ARE SATISFIED** remains in force.
