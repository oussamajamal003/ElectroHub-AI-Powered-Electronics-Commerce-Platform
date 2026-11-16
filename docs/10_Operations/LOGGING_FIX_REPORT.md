# Application logging fix report

Date: 2026-10-13. Branch: `feature/Stripe`.

## Assessment

**80/100 — REQUEST CHANGES.** The logging implementation passes local checks,
but an accidentally selected real database integration suite violated the task's
no-mutations restriction. Its database effects have not been verified. This
incident prevents approval of the task; it is not being represented as a clean,
restriction-compliant verification run.

## Root cause

Repository evidence establishes several independent gaps:

- Handled `AppError` failures and retry failures used `warn`, which the
  error-only file transport excluded.
- Request logging was installed after body parsing and the Stripe webhook router,
  missing early failures, webhook responses and aborted requests.
- Prisma logs went to Prisma's console output rather than the application files.
- HTTP shutdown called `process.exit` immediately after asynchronous logging.
- Uncaught exceptions, unhandled rejections and early configuration failures had
  no consistently initialized file logging/flush boundary.
- Several successful HTTP responses concealed internally handled failures,
  including logout and Google popup failures.
- File transports had no rotation/retention, explicit failure fallback, health
  warning or coordination of rotations across processes.
- Redaction skipped message/stack content, mishandled arrays and Error objects,
  and did not cover several personal-data fields.

These are confirmed implementation defects. No historical production outage or
specific disk-full incident was independently verified.

## Implementation and coverage

Winston remains the public logging interface. Its new asynchronous file transport
uses pinned `proper-lockfile` 4.1.2 for shared append/rotation/cleanup ownership.
It implements 20 MiB or midnight UTC rotation, streamed gzip, daily monotonic
archive sequences, app retention of 14 days/500 MiB, and error retention of
30 days/1 GiB. Startup and rotation perform cleanup. Active files are append-only
and excluded from archive deletion. Compression and sequence publication use
temporary files and synchronized writes before rename.

The file writes are independent; error events deliberately appear once in each
file. Failed disk delivery is reported to stderr with a sanitized fallback record
and an observability warning available in the health response. Storage is retried
on subsequent activity. The queue is limited to 10,000 events or 16 MiB; errors
are fsynced. Production JSON also goes to stdout/stderr for persistent collectors.

Coverage includes bootstrap, configuration errors, HTTP start/completion/abort,
public failure codes, auth/logout/Google popup errors, checkout/cart/order
transaction failures, Stripe SDK request/response and capture/account failures,
Prisma statement kinds/durations/errors, payment runner and background recovery,
and existing email/OTP lifecycle logs. Request service logs inherit correlation
through AsyncLocalStorage. Records include UTC time, severity, operation, event,
process and correlation identifiers, measured durations and sanitized diagnostic
fields/stacks. Request bodies, SQL, authorization/cookies and payment payloads
are excluded. No payment or commerce business transition was modified.

The operating guide is [LOGGING.md](LOGGING.md), including exact policy,
investigation commands, hosting requirements, and failure/recovery limitations.

## Files changed by this task

This manifest includes logging edits to files that already contained unrelated
user work; the broader preexisting working tree is not attributed to this task.

```text
apps/backend/.env.example
apps/backend/package.json
package-lock.json
apps/backend/src/app.ts
apps/backend/src/bootstrap.ts
apps/backend/src/server.ts
apps/backend/src/payment-runner.ts
apps/backend/src/config/env.ts
apps/backend/src/controllers/auth.controller.ts
apps/backend/src/controllers/google.controller.ts
apps/backend/src/lib/prisma.ts
apps/backend/src/middleware/errorHandler.ts
apps/backend/src/middleware/requestId.ts
apps/backend/src/middleware/requestLogger.ts
apps/backend/src/routes/health.routes.ts
apps/backend/src/services/auth.service.ts
apps/backend/src/services/cart.service.ts
apps/backend/src/services/order.service.ts
apps/backend/src/services/payment.service.ts
apps/backend/src/services/stripe.provider.ts
apps/backend/src/utils/logger.ts
apps/backend/src/utils/logTransport.ts
apps/backend/src/utils/logContext.ts
apps/backend/src/types/proper-lockfile.d.ts
apps/backend/src/controllers/__tests__/auth.controller.test.ts
apps/backend/src/routes/checkout.routes.test.ts
apps/backend/src/routes/stripe-webhook.routes.test.ts
apps/backend/src/services/__tests__/cart.service.test.ts
apps/backend/tests/logger.test.ts
apps/backend/tests/logging-continuity.test.ts
apps/backend/tests/logging-http.test.ts
apps/backend/tests/fixtures/log-writer.ts
apps/backend/tests/google.configuration.test.ts
apps/backend/tests/google.integration.test.ts
docs/10_Operations/LOGGING.md
docs/10_Operations/LOGGING_FIX_REPORT.md
```

## Verification actually performed

The inspected, safe selection passed **174 tests across 16 files** after the
final rotation and retention adjustments:

```sh
npx vitest run tests/logging-continuity.test.ts tests/logging-http.test.ts tests/logger.test.ts tests/requestId.test.ts src/middleware/__tests__/errorHandler.test.ts src/lib/prisma.test.ts src/services/__tests__/stripe.provider.test.ts src/controllers/__tests__/auth.controller.test.ts src/routes/checkout.routes.test.ts src/routes/stripe-webhook.routes.test.ts tests/health.test.ts tests/env.test.ts tests/google.configuration.test.ts tests/google.provider.test.ts src/services/__tests__/auth.service.test.ts src/services/__tests__/cart.service.test.ts
```

Database and provider operations in that selection are mocked, or the tests stop
at local configuration/error boundaries. File verification uses disposable
directories and actual child processes. Tests cover an actual 20 MiB active
file, midnight UTC while idle, gzip, age/storage cleanup, archive numbering after
cleanup/restart, append continuity, three concurrent writers, killing a live lock
holder and automatic recovery, redaction, handled/fatal/rejection evidence,
configuration failure, parser errors, aborted responses, independent file
failure, injected ENOSPC/EACCES, compression recovery and production streams.

Typecheck, backend lint and backend build succeeded. The repository-wide
`git diff --check` reports one trailing-whitespace line in the unrelated,
preexisting working-tree edit `apps/backend/src/repositories/auth.repository.ts:409`;
that file was left untouched. Commands:

```sh
npx vitest run tests/logging-continuity.test.ts tests/logger.test.ts tests/logging-http.test.ts
npm run typecheck
npm run lint
npm run build
git diff --check
```

The dependency was installed using `npm install proper-lockfile
--workspace=@electrohub/backend --ignore-scripts`, with lifecycle scripts disabled,
and pinned in the manifest/lockfile. This environment used Node 22.19.0/npm 11.4.1;
the repository declares Node 20.11.0/npm 10.2.4, which was not separately tested.

## Verification incident and unresolved database effects

One expanded command mistakenly included `tests/google.integration.test.ts`
before that file was checked for real database operations. It connected using
the repository test configuration and attempted database fixture/session writes;
the suite also contains deletion cleanup. The output showed expired Prisma
transactions and test timeouts. Those errors do **not** prove no writes committed
or that cleanup completed. Database state and target-environment impact remain
**NOT VERIFIED**. No additional database audit or cleanup was attempted after
recognizing the mistake, because the user's restrictions remain in force.

That expanded run had seven failures: six in the eight-test Google integration
suite and one resource-contention timeout in the large-file logging test. The
Google logging assertion was updated from `path` to the new safe `route` field,
but that database suite was **not rerun**. The archive stream's repeated string
copying was eliminated; the subsequent isolated logging checks passed.

An authorized review of the integration run's database effects is required before
task approval. No claim of production safety, absence of fixture changes or
successful database cleanup is made.

## External verification and limits

- Local logging: **VERIFIED** in the exercised scenarios.
- Stripe SDK behavior: **PARTIALLY VERIFIED**, with mocks; no financial operation.
- Database/Supabase state: **NOT VERIFIED**, including the incident above.
- Deployed collector retention/persistence and production filesystem:
  **NOT VERIFIED**. Deployment was not performed.
- CI, commits, pushes and live Stripe operations: **NOT RUN**.

Abrupt termination can lose queued records. Routine appends rely on OS writeback;
two-file delivery is not atomic. Forced/fatal flushing is bounded. Failed disk
delivery requires collected stderr to preserve fallback evidence. Compression
failure retains a recoverable uncompressed archive that counts toward the archive
storage cap until recovery. A stalled heartbeat can compromise ownership and
trigger fallback.
Legacy gzip archives are not rewritten; free-text redaction cannot infer every
possible personal datum. Other runtimes/scripts and direct server imports require
their own logging/bootstrap discipline. Actual tsx restart timing, load capacity,
Windows ACLs and deployed collector durability were not independently verified.

For ephemeral hosting, persistent centralized collection is required; local files
alone cannot survive container replacement.
