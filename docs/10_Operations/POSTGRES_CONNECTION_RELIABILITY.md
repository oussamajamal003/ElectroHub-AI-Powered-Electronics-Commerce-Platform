# PostgreSQL connection failure investigation — 2026-10-15

Task: recurring PostgreSQL connection errors. Workstream: DATABASE / OBSERVABILITY. Implementer: Codex, under the Principal Architect. Base: `feature/Stripe`, `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`.

The owner's request authorizes the narrow runtime connection fix and isolated verification. This is the scoped connection-pool change request under `AGENT_COORDINATION.md`: affected reviewers are DATABASE, AUTH, PAYMENT, PERFORMANCE and the Architect; source changes are limited to the runtime adapter selection and a new adapter observer, tests and documentation. Review/integration approval remains with the owners. No operational authorization for shared environments is implied.

## Findings and limits of attribution

The installed packages are `@prisma/adapter-pg` 6.12.0, Prisma Client 6.12.0 and `pg` 8.23.0. The adapter factory creates `new pg.Pool(config)` internally. Its runtime adapter exposes that pool as its protected `client` property in JavaScript, but its published factory API accepts only configuration and schema options. It has no pool error callback or supplied-pool option in this version. The real installed baseline factory has **zero** pool `error` listeners.

Two application defects are confirmed:

1. An idle client failure is re-emitted by `pg` as a pool `error`. Without a listener, Node treats that event as uncaught; the application's fatal logging handler then exits. A checked-out interactive transaction can also lose its connection between queries, when `pg` has removed its idle listener. The old adapter has no connection error listener for that gap. Both failure paths are reproduced by the regression tests.
2. Driver failure details are lost at the existing evidence boundary. The logger deliberately substitutes `Error: operation failed` for exception messages to protect SQL, parameters and secrets. The Prisma global error event extracts only Prisma codes and SQLSTATEs from engine text. Code-less connection termination and pg acquisition timeout errors therefore become `DATABASE_ERROR` with both fields null. `pg-pool/index.js:45` rewrites the rejection's stack to the caller; it does not establish why the connection failed.

Five HTTP failures in the captured active `error.log` have pg-pool/adapter stack frames and no driver code or useful cause code. Correlated completion times were 20,447.93 ms (500), 21,211.67 ms (503), 8,918.28 ms (500), 13,273.42 ms (500), and 6,405.09 ms (500). These are whole-request durations, not connection-acquisition measurements. They cannot distinguish pool exhaustion, upstream termination, a network interruption, TLS failure, query latency or transaction timeout. No claim that these historical requests caused process exits is made.

**The trigger of the original infrastructure failures is UNKNOWN.** No shared DEV/PROD query, network probe, provider log read, or capacity inspection was performed for this task. The fix closes reproduced application crash/recovery gaps and provides the missing evidence for future failures; it does not establish that the remote infrastructure is repaired.

## Source correction

- `apps/backend/src/lib/prisma.ts`: selects `ObservablePrismaPg`; the existing singleton and all configuration and query/Prisma diagnostics remain intact.
- `apps/backend/src/lib/database-adapter.ts`: attaches a nonthrowing pool error listener before database I/O, and a checked-out client error listener when each connection is created. `pg` removes bad idle clients; the observer never releases them again, disconnects the whole pool, or restarts Prisma on a request failure.
- Runtime adapter `queryRaw`, `executeRaw` and transaction acquisition are observed. Transaction query methods keep the same adapter object and implementations. Every failure is rethrown unchanged, with no retry, replacement transaction, extra SQL, or commit/rollback intervention. SQL constraint failures continue through existing Prisma/application error reporting.
- Diagnostics contain fixed classifications, allowlisted system codes, SQLSTATE where available, pool counts, operation duration, and sanitized stack frames. Raw messages, SQL, parameters, provider objects, connection URLs and credentials are excluded. Request context is used at awaited operation boundaries. Background socket events explicitly have null request/correlation IDs because a socket can retain an old request's async context.
- Duplicate reports of the same error object are suppressed. A later successful operation emits one `db.connection.recovered` transition. This means an operation succeeded; it does not certify every connection or the whole infrastructure.
- Observer exceptions cannot replace a business error or escape a pool listener. The accepted logger still applies redaction, failure fallback, JSON persistence, rotation and shutdown flushing.

Supporting files owned by this task: `src/lib/database-adapter.test.ts`, `verification/database-reliability.postgres.ts`, `scripts/database-reliability-tests.cjs`, `vitest.database-reliability.config.mts` (all under `apps/backend`), and this report. The PostgreSQL verification file is outside the default `tests/**/*.test.ts` / `src/**/*.test.ts` discovery paths and is selected only by the dedicated config.

The only version-specific bridge is a checked `adapter.client instanceof pg.Pool` check immediately after factory creation. An incompatible adapter is disposed and rejected before queries rather than silently running without error handling. This avoids a Prisma upgrade, driver conversion fork, global monkey patch, or dependency/lockfile change. Revalidate this bridge when upgrading the adapter; migrate to a public pool/callback API if the project approves a version providing one. Runtime migration/shadow-database operations are outside this wrapper's intended scope.

## Configuration and lifecycle preserved

`DIRECT_URL || DATABASE_URL` remains the runtime selection. Offline inspection of the local environment files identifies the former as a session pooler and the latter as a transaction pooler; historical process overrides are not established. No endpoint mode change was made.

| Setting | Development | Test | Production |
| --- | --- | --- | --- |
| Per-process maximum | 5 | 5 | 10 |
| Retained minimum | 1 | 0 | 2 |
| Idle eviction | 300 s | 10 s | 300 s |
| Connect/acquisition timeout | 30 s | 30 s | 30 s |
| TCP keepalive initial delay | 10 s | 10 s | 10 s |
| TLS | Verified; configured CA when supplied | Same | Same |

`pg` minimums retain existing clients; they do not pre-create connections. Pool limits are per process and do not prove Supavisor tenant headroom. Multiple API/worker processes add their budgets. No speculative pool increase, idle/lifetime change, query timeout, transaction timeout or isolation change was introduced. Connect/acquisition timeouts do not bound query execution.

Prisma still owns disposal and calls `pool.end()`. The existing HTTP server closes HTTP connections, awaits `$disconnect()` and flushes logs, with its existing forced shutdown deadline. The payment runner's existing Prisma disconnect ownership is preserved. The new observer introduces no shutdown hook or second pool owner.

## Safe repeatable verification

From `apps/backend`:

```text
node scripts/database-reliability-tests.cjs
node scripts/database-reliability-tests.cjs --postgres
npm run typecheck
npm run lint
npx eslint verification/database-reliability.postgres.ts
```

From the repository root:

```text
git --no-optional-locks diff --check
```

The dedicated runner/config select exact files and omit the general `.env` test setup and all existing integration-suite globs. URLs are replaced with loopback-only values before spawning tests. The `--postgres` path initializes its own fresh cluster and one-day test certificate, binds to IPv4 loopback on an allocated port, enforces certificate verification in clients, and stops only that newly initialized cluster. It performs no migrations, application fixture writes, Stripe calls or worker execution. General Google/payment integration tests are never selected. With no `--postgres`, no database is started or contacted. Unknown runner arguments are rejected.

This Windows machine has PostgreSQL binaries at `C:/Program Files/PostgreSQL/18/bin` and OpenSSL at `C:/Program Files/Git/usr/bin/openssl.exe`. Other approved local installations can set `ELECTROHUB_LOCAL_PG_BIN` and `ELECTROHUB_LOCAL_OPENSSL` to executable directories/files. No runtime installation or system PostgreSQL service changes are needed. Each `.cache/database-reliability-run-*` contains its own disposable provisioning/server logs and isolated application logs; none are the application's normal log files.

Final focused run: **42/42 passed in 3 files**, exit 0, on Node **22.19.0**, PostgreSQL **18.1**:

- 12 existing Prisma wiring tests: runtime URL/TLS configuration, caps, singleton reuse, safe Prisma classification and request context (mocked client/adapter; no database).
- 22 new adapter tests: classification, nested/cyclic errors, idle/checked-out events, request correlation, unchanged rejection identity, no write replay, transaction delegation, observer failures, cleanup and compatibility guard (real pg EventEmitters plus mocked adapter I/O).
- 8 real PostgreSQL tests: verified TLS and identity; idle backend termination and replacement; connection loss between serializable transaction statements with no replay; actual acquisition timeout with a held client and later recovery; isolated Express liveness/readiness and existing error middleware through a TCP outage and restoration; actual pool disposal; persisted redaction/classification/recovery; missing listener in the unmodified installed adapter.

The HTTP fixture loads the actual runtime Prisma singleton and health/error middleware in a minimal Express application. It deliberately does not load commerce/auth/Stripe routes or the full server/worker bootstrap. Responses remained 200 for liveness, 503 for readiness during the outage, and the existing generic 500 for a failed database route; database routes returned 200 afterward in the same process.

Final real-run evidence: `.cache/database-reliability-run-P9AbKQ`; the owned PostgreSQL process stopped successfully and its PID file is absent. Initial attempts exposed a sandbox transform-cache rename denial and disposable harness issues (Windows Unicode certificate paths, native inherited pipe handles, a test TLS timeout and a type-only Socket import). These were corrected; those failed/partial attempts are not counted as passes. The final run has no skipped tests or unhandled errors. Typecheck, backend lint, the additional PostgreSQL test lint and repository `diff --check` completed with exit 0. An earlier lint command also named the `.mts` config; ESLint reported it ignored because the repository config matches `.ts`. The dedicated Vitest configuration was exercised by the successful run, not lint-verified.

## Operational triage and release limits

Filter `error.log` for `DATABASE_DRIVER_ERROR` and group by operation, request ID where present, failure kind and UTC timestamp. Use the existing `db.error` and HTTP completion events as separate operation/response boundaries, not duplicate independent incidents. Never infer a successful SQL execution from a timing event alone.

| Evidence | Interpretation / next check |
| --- | --- |
| `pool_acquisition_timeout`, full pool, no idle clients | Client-side wait expired; inspect checked-out duration, demand and transaction completion. This does not by itself prove server capacity exhaustion. |
| `connection_capacity`, `53300` | Server/pooler explicitly refused capacity; reconcile the total multi-process budget against observed tenant capacity. |
| `connection_terminated`, `57P01`/`57P02`/`57P03`, `08xxx` | Connection/server termination evidence; correlate narrowly scoped provider/server logs. |
| `network`, `ECONNRESET`/`ECONNREFUSED`/`EPIPE` | Transport failure; inspect network path, endpoint availability and lifecycle. |
| `dns`, `ENOTFOUND`/`EAI_AGAIN` | Name resolution evidence. |
| `tls`, certificate error code | Verify CA, certificate lifetime and hostname; never disable certificate checks. |
| `query_cancelled`, `57014` | Cancellation evidence; not proof of a transaction rollback or a specific timeout origin. |
| `idle_transaction_timeout`, `25P03` | PostgreSQL idle transaction timeout evidence. |
| `unknown`, null codes | Insufficient driver detail; do not invent a cause or log unrestricted raw messages. |

No shared infrastructure cause, hosted headroom, network stability, or PostgreSQL 17/Supavisor behavior is proven by this local PostgreSQL 18 verification. Node 20 was not run. Actual production termination semantics and a full server shutdown were not re-exercised. A loss during a transaction/commit can leave an uncertain business outcome; existing idempotency/reconciliation rules remain necessary and this fix never replays the operation.

Ownership audit found concurrent changes to `payment.service.ts` and `helpers/payment-postgres-harness.ts`; this task did not edit either file. All 18 migration SQL files present at this task's start retain their raw SHA-256 identities, including the protected historical 353-byte migration. This count records the current workspace only and is not a new migration-inventory approval. The strict migration guard, logging implementation, `.gitattributes`, index and all other baseline files except `src/lib/prisma.ts` were preserved by this task. No staging, commit, push, CI run, shared database access or deployment occurred.

Task 03.6 remains OPEN. NO PUSH remains in effect. Any future shared DEV/PROD infrastructure investigation, migration execution, release integration or deployment needs its own applicable authorization. Logging approval and historical checksum approvals are not reopened by this work.

References: [node-postgres pool events and disposal](https://node-postgres.com/apis/pool), [Prisma 6.12 adapter source](https://github.com/prisma/prisma/blob/6.12.0/packages/adapter-pg/src/pg.ts), [Supabase observability](https://supabase.com/docs/guides/observability). The Supabase changelog was checked; the announced HTTP TLS deprecation explicitly excludes direct PostgreSQL and pooler connections.
