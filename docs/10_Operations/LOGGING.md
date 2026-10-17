# Application logging

The backend writes newline-delimited JSON to `apps/backend/logs/app.log` and
`error.log`. Export `ELECTROHUB_LOG_DIR` in the host environment before launching
to select a persistent, private local directory; bootstrap precedes .env loading.
Use `npm run dev`, `npm start`, or `npm run payment:worker` from the backend so
the bootstrap installs fatal logging before importing application configuration.
These commands do not truncate existing logs. No business transitions are changed.

## Exact policy

| Policy | app.log | error.log |
| --- | --- | --- |
| Active size | 20 MiB | 20 MiB |
| Rotation | Size threshold or midnight UTC, whichever comes first | Same |
| Archive age | 14 days | 30 days |
| Archive storage | 500 MiB | 1 GiB |
| Archive name | app-YYYY-MM-DD.N.log.gz | error-YYYY-MM-DD.N.log.gz |

The UTC date identifies the rotation time. Sequences increase within that date,
including across restart and deletion of old archives. Private
sequence files preserve the next number. Cleanup runs at startup and after
rotation; expired archives are removed before the oldest remaining archives are
removed to meet the storage limit. Active files are excluded from cleanup.
Completed compressed and recoverable uncompressed archives both count toward
retention bytes. Archive age is measured from its filename's UTC date at 00:00
UTC. Empty files are not archived. The midnight timer also rotates idle,
nonempty files.

All participating processes serialize append, rotation and cleanup through one
directory lock, using pinned `proper-lockfile` 4.1.2. Its atomic directory creation
and heartbeat avoid a permanent PID/reclaimer lock after a crash. Every writer
uses the same five-second stale threshold and one-second heartbeat. Acquisition
retries for up to eight seconds; stale locks recover automatically. Compromise
sets a warning and prevents subsequent writes under the lost lease. See the
[upstream locking design](https://github.com/moxystudio/node-proper-lockfile).
File handles are closed before
rename. Gzip is streamed to a temporary file, synchronized, published by rename,
and only then is the uncompressed archive removed. A failed compression leaves
the original archive recoverable; startup retries compression. Archives are
sanitized again before compression, including legacy text records.

## Records and coverage

Every record has UTC `timestamp`, `level`, `severity`, `operation`, `pid`,
`instanceId`, `eventId` and `correlationId`. HTTP service activity inherits
`requestId` through AsyncLocalStorage. Non-request events use the runtime instance
as their correlation ID. Durations are numeric milliseconds where measured.

| Boundary | Evidence |
| --- | --- |
| Bootstrap/server | Starting, initialization failures, ready/degraded, shutdown and timeout |
| HTTP | Start, completed/aborted, method, route template, status, duration, public error code |
| Authentication | Existing registration/login/verification/refresh/logout events, swallowed logout failures, Google popup failures and HTTP failures |
| Checkout/orders | Route completion, existing transaction events, database durations and errors |
| Stripe | SDK request/response, status, duration, provider request ID, account/capture failures |
| Prisma | Statement-kind operation, query durations, error classification and warnings; SQL/parameters are excluded |
| Payment worker | Startup/readiness, failed batches, reconciliation errors, stopped/fatal events |
| Email/OTP | Existing lifecycle and delivery failure events through the same sanitizer |
| Fatal process failures | Uncaught exceptions and unhandled rejections, nonzero exit after bounded flush |

Every error-level event intentionally appears once in each file. Handled HTTP
exceptions are errors; their completion record uses info to avoid duplicating
the exception. Direct failure responses (including 4xx) and aborted requests
produce error completion records. Different boundary events for the same failure
can coexist: use `eventId` to distinguish records and `correlationId` to connect
them. Background work spawned from HTTP can retain that request's correlation.
Durable jobs in another process do not automatically inherit a request ID; join
their records using safe operational identifiers such as `attemptId`/`orderId`.

Requests are observed before CORS, parsers and signed webhook handling. Raw
bodies, query strings, authorization headers, cookies, SQL and payment payloads
are never captured by this middleware. Only a response's public error code is
read. Nested secrets and personal fields are redacted, arrays/cycles are handled,
and error objects retain diagnostic fields and stack frames rather than their
raw provider responses, parser bodies or SQL metadata. Prisma and Stripe error
messages are generalized to avoid customer/input snippets.
Sanitization replaces the original output record; fields beyond the 100-field
limit are dropped. Correlation values inherited from async context are sanitized
before output. Canonical sanitized errors retain their classification and stack
frames when archives are sanitized again.

### Database failure and payment setup fields

`db.error` carries `prismaCode` (for example `P2024`, `P2028`, `P2034`) and `sqlState` when the engine message contains them in their fixed format; the message itself is never logged because it can contain SQL or parameters. Handled HTTP errors keep the sanitized underlying error code through `error.code`. `payment.setup.performance` additionally reports where a setup transaction spends its 30-second budget: `setupTransactionAttempts`, `setupTransactionOutcomes` (per-attempt `OK` or sanitized code), `acquisitionAndBeginMs`, `setupTransactionOperationCount`/`Ms`, `rowLockOperationCount`/`rowLockWaitMs`, `setupTransactionCommitAndOverheadMs`, `longestSetupTransactionMs`, `setupTransactionBudgetExceeded`, and `externalCallCount` with `stripeApiMs`. These are client-observed spans, so a lock wait includes its network round trip; exact SQL statement counts and pure pool-acquisition time remain unavailable (`setupQueryCount` and `dbConnectionAcquisitionMs` stay `null`).

## Root-cause investigation

1. Obtain the `x-request-id` from the failed response and the approximate UTC time.
2. Search `error.log` for that ID, then follow it in `app.log` to reconstruct the
   start, service events, provider result and HTTP outcome.
3. Check `code`, `operation`, `durationMs`, `providerRequestId`, and the sanitized
   error stack. Compare `instanceId` and PID to identify restarts or worker activity.
4. Search gzip archives when the incident predates the current active file.
5. Check `/api/health` → `data.observability` and captured stderr for logging
   failures before assuming a missing event did not happen.

From the backend directory on Linux:

```sh
tail -F logs/app.log logs/error.log
jq -c 'select(.correlationId == "REQUEST_ID")' logs/app.log
zcat logs/app-*.log.gz | jq -c 'select(.correlationId == "REQUEST_ID")'
```

On PowerShell, `Get-Content logs/app.log -Tail 50 -Wait` follows an active file;
reopen it after rotation if the host does not follow the replaced filename.
Use `Select-String -Path logs/*.log -SimpleMatch 'REQUEST_ID'` for active records.
Extract gzip archives with a gzip-capable utility and filter their JSON lines.

## Storage failures and hosting

App and error file writes are attempted independently, with error.log attempted
first for errors. Permission, disk-full, locking, rotation, compression and
cleanup failures emit a sanitized JSON diagnostic to stderr. Failed delivery
also emits the sanitized original record to stderr. Observability health becomes
`warning` with a cumulative failure count and the latest safe filesystem code;
the warning remains until restart so transient loss remains visible. Later
events retry storage automatically. Rotation failure favors continued append,
so a failed filesystem can temporarily exceed its active size target.

The asynchronous queue is bounded at 10,000 events or 16 MiB. Queue overflow reports
`QUEUE_FULL` and sends the sanitized record to stderr. Errors are synchronized
to disk; routine activity uses append without a per-event fsync. HTTP shutdown
drains connections before flushing; worker shutdown flushes after disconnection.
Forced HTTP termination bounds its last flush to one second; fatal errors bound
flush to two seconds and exit nonzero. Startup failure, graceful HTTP completion
and worker completion also bound the logging flush to two seconds. A timeout or
rejection emits `logging.flush_failed` with `LOG_FLUSH_TIMEOUT` or
`LOG_FLUSH_FAILED`, marks observability health as warning and exits nonzero.
These deadlines bound the logging flush, not an in-flight worker operation or
database disconnect; the HTTP server retains its separate ten-second deadline.

In production, JSON is also emitted to stdout, with errors/warnings on stderr.
Ephemeral containers must have a persistent centralized stdout/stderr collector
with retention configured there. Local retention controls only these files;
container replacement cannot preserve them without a persistent volume.
Do not run an external rotator on these files. All writers must use the same
policy and lock configuration, and must not manually remove a live lock.
Windows local file storage was exercised; other environments and network storage remain unverified.

## Limits and recovery

- SIGKILL, power failure and kernel termination can lose queued records. Ordinary
  appends can be lost before OS storage writeback; fsync cannot guarantee a
  storage device honors durability. Writes to two files are not atomic together.
- Disk or collector failure cannot guarantee persistence. Inspect stderr and
  health warnings; restore permissions/capacity and confirm new records arrive.
- A stalled event loop or filesystem can prevent the locking heartbeat and cause
  lease compromise. This is reported; subsequent writes fall back to stderr.
  Do not delete a live `.logging.lock` directory. A killed holder's lock normally
  becomes recoverable after five seconds. Central collection covers fallback.
- Failed compression leaves a recoverable uncompressed archive that counts
  toward the storage cap until recovered. Temporary gzip files are discarded
  safely during locked startup recovery and retried from the preserved archive.
- Legacy active logs remain untouched until rotation. Sanitization catches known
  fields and patterns; it cannot infer arbitrary personal data embedded in free
  text. Callers must use fixed messages and explicitly safe metadata. New log
  instrumentation avoids raw customer/provider inputs. Old gzip archives are not
  rewritten, and preexisting sensitive logs require restricted operator handling.
- Python/AI-service, frontend, native crashes and scripts that bypass the backend
  logger require their own observability. Direct server/worker imports bypass
  bootstrap protection for module-initialization failures.
- Local mocked verification does not establish deployed collector persistence,
  production filesystem behavior, database state or live Stripe behavior.

## Local verification

```sh
npm run test:logging
# Optional narrow test-name selection, without changing the file allowlist:
npm run test:logging -- -t 'final acceptance output boundaries|startup failure flush deadline'
node --test scripts/logging-safe-tests.test.cjs
npm run typecheck
npx eslint src/utils/logger.ts src/bootstrap.ts src/server.ts src/payment-runner.ts
npm run build
```

Run these from `apps/backend`. `test:logging` uses a fixed eight-file allowlist in
`vitest.logging.config.mts`, disposable log directories and child processes. It
does not load the general environment setup or .env files. The launcher replaces
both database URLs with an offline loopback endpoint, removes provider credentials
and disables live development payment flags. Only `-t`/`--testNamePattern` is
accepted; file paths, project selection and configuration overrides are rejected
before Vitest starts. Selected HTTP tests use a local mocked Express boundary.

Do not expand a logging selection with Google/AUTH or other database integration
tests. General `npm test` and the general Vitest configuration can include suites
that write fixture data; a test environment name does not establish a disposable
database. Legitimate integration suites remain intact and require their owner's
explicit authorization and target verification. No CI workflow was changed.

See [the final acceptance handoff](LOGGING_FINAL_ACCEPTANCE_HANDOFF.md) for the
accidental integration-test incident, reused verification and remaining read-only
authorization boundary.
