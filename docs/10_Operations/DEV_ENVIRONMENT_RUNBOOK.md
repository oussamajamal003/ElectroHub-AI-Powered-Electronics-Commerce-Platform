# MAIN DEV and isolated QA

> **Status (2026-10-20):** One authorized incident-scoped supervised run completed the Task04 Test Mode purchase. The supervisor is stopped and the watched restricted API is restored. The out-of-scope attempt `df9056ac4e` is owner-isolated and must stay untouched. Any further `--start` requires a fresh read-only preflight and a separate exact authorization. Post-purchase checks: `TASK04_VERIFY_ONLY=1 npx playwright test -c playwright.task04.config.ts` (supervised runtime only; it never reaches checkout).

Task 04.0 keeps persistent development on frontend **3000**, API **5000**, Supabase DEV `pzxekjybdiulzmssalfo`. Disposable agent QA uses frontend **3200**, API **5200**, PostgreSQL 17 **55434** / `electrohub_disposable`. PROD `yepfgjehdstlxbpespun` is a separate target; neither launcher authorizes PROD access. No application deployment is part of these commands.

## Configuration and connection contract

Run commands from the repository root unless a block changes directory. PowerShell resolves quoted paths with spaces and Unicode normally.

Backend dotenv precedence: process variables override `.env.local`, which overrides `.env`; test uses `.env.test.local`, production uses `.env.production.local`. Never print those files. `npm run env:show --workspace=@electrohub/backend` emits the existing redacted report.

`DATABASE_URL` is the development runtime candidate; `DIRECT_URL` is the migration connection. Both must identify the same approved logical project. Different Supabase direct/session pooler hosts can identify one project through authenticated endpoint routing and the pooler username. The application rejects unknown projects, mixed local/shared URLs, mismatched disposable ports/databases and insecure TLS options. `NODE_ENV=test` requires a disposable target and cannot grant shared payment permission.

The existing local configuration uses transaction port 6543 in `DATABASE_URL` and session port 5432 in `DIRECT_URL`. `DB_RUNTIME_URL_SOURCE=direct` explicitly retains the verified session connection. To use the application URL instead, configure `DATABASE_URL` as a session/direct endpoint and set `DB_RUNTIME_URL_SOURCE=database`. No automatic fallback occurs. Transaction pooling is refused for this persistent/session workload. Production retains its prior direct-source default unless explicitly configured. ElectroHub's Prisma profile uses `public`; alternate URL `schema` options are refused.

The pg adapter always validates TLS certificates and hostnames (`rejectUnauthorized:true`). Supply `DB_SSL_CA_CERT_PATH`; URL `sslrootcert` is retained for migration tooling but removed from runtime URL options in favour of this explicit CA. CI's `sslmode=disable` exception is limited to test-mode loopback disposable URLs for Prisma CLI migrations; the runtime adapter strips that flag and independently enforces verified TLS. Supavisor's `pg_stat_ssl` describes the **internal pooler → PostgreSQL hop**, not the application's validated TLS socket; do not interpret that value as proof that external TLS is disabled.

Each nonproduction Prisma process retains its existing maximum of five connections. The DEV supervisor budgets ten for API + payment runner, fifteen with optional email worker, against a conservative limit of fifteen and observed same-role sessions. This does not claim a fresh Supavisor tenant-capacity configuration change. No pool limit was increased.

## MAIN DEV

```powershell
npm run build --workspace=@electrohub/backend
npm run payment:dev:preflight --workspace=@electrohub/backend
```

The foreground supervisor validates both targets, CA/TLS connectivity, every local Prisma migration/checksum, absence of unapproved recovery work, the canonical Stripe Test account and the backend port. A future start also requires `--start --allow-dev-recovery` and one exact `--reviewed-recovery-attempt=<UUID>` value. Preflight validates that attempt and the uniquely owned Task04 fixture attempt; any other unresolved attempt or recovery work blocks startup. The supervisor sends the immutable two-ID allowlist only to the payment worker over the active IPC channel. Both batch claims and recovery-attention scans use that same scope; the API and email worker receive no payment scope. Listener signing secrets and per-launch IPC nonces stay in memory. The API enables writes only after its own database readiness, worker database readiness, worker activation and actual runner readiness. Missing/degraded children revoke permission and trigger owned sibling shutdown. A copied environment approval string or `NODE_ENV=test` cannot activate shared DEV.

If a restart reports a recovery backlog, preserve the attempt/work/provider identifiers and inspect its ownership, submission and provider state read-only. Obtain scoped owner approval before recovery of another customer's pending work. Do not mark work DONE, delete it, edit its state or bypass preflight. An idle card-entry attempt is still financial history. If the connection reserve gate fails just after shutdown, inspect sessions and allow former clients to drain before retrying; do not increase the limit simply to start.

The exact-ID worker scope is implemented and independently reviewed, but the runtime remains stopped. CCR T04-PAY-01 covers code edits and offline tests only. Do not use `--start` or recover any DEV attempt until the out-of-scope backlog has been reviewed, a fresh read-only preflight passes, and the user separately authorizes the exact operational action.

In a second PowerShell terminal:

```powershell
Set-Location 'apps/frontend'
$env:E2E_FRONTEND_PORT = '3000'
$env:E2E_API_PROXY_TARGET = 'http://127.0.0.1:5000'
npm run dev -- --host 127.0.0.1 --strictPort
```

Vite validates loopback targets and reserved port pairs. CLI `--port` is honoured; conflicting CLI/environment ports are rejected. Build commands do not validate unused development proxies. Never direct MAIN DEV at a disposable backend occupying :5000; use the private diagnostic before acceptance testing. Port checks alone cannot identify a database.

`npm run dev --workspace=@electrohub/backend` remains the watched, **payment-restricted** shared-DEV mode. It is not read-only for ordinary authenticated cart/auth actions. It does not run shared payment recovery. Never copy a deployment approval into it.

## Isolated QA

```powershell
Set-Location 'apps/backend'
$env:PG_BIN = 'C:\PostgreSQL\17\bin'
npm run db:isolated:status
# First setup only, when no existing cluster is present:
# npm run db:isolated:init
npm run db:isolated:start
npm run dev:isolated
```

The launcher defaults to :5200 and rejects reserved frontend/MAIN DEV ports. It pins both URLs, database, PostgreSQL user and password to its generated cluster, verifies local server identity over `verify-full`, then runs guarded disposable-only migrations. A standalone `node scripts/dev-isolated.cjs migrate` performs the same identity check first. No shared seeds or migrations are performed.

QA receives separate persisted JWT/refresh/OTP secrets in ignored `.isolated/runtime-secrets.json`. Shared payment approvals and supervisor flags are blanked. External Stripe and Brevo keys are disabled by default; commerce mode is capture. Mock tests supply their own fake provider. `--stripe-test-mode` is an explicit controlled provider opt-in, requiring separately coordinated Test Mode listener/account/fixture scope. `--real-email` requires approved test recipients; never enable it for autonomous QA. Do not enable `--all-recipients` for Task 04.0 browser verification. Serialize launcher starts: the existing email worker helper's stale-lock recovery is not a concurrent-start election protocol. A capture-mode READY log does not prove a new email was captured.

In another terminal:

```powershell
Set-Location 'apps/frontend'
$env:E2E_FRONTEND_PORT = '3200'
$env:E2E_API_PROXY_TARGET = 'http://127.0.0.1:5200'
npm run dev -- --host 127.0.0.1 --strictPort
```

Use separate browser contexts/profiles for DEV and QA. Localhost cookies are shared across ports; port numbers do not isolate sessions. Do not run simultaneous DEV/QA sign-ins in one browser cookie jar.

## Browser and regression checks

The private `GET /api/internal/development-runtime` diagnostic requires loopback access and a per-launch bearer token, is unavailable in production, and returns only runtime mode, random instance identity and database/TLS readiness. Tokens are in ignored `.cache/dev-runtime-token.txt` (supervised DEV) or `.isolated/runtime-token.txt` (QA); never paste them into logs or documentation. No diagnostic grants payment authority.

Isolated Playwright global setup compares direct :5200 and proxied :3200 diagnostics before any fixtures. Both must be the same ready disposable instance.

```powershell
Set-Location 'apps/frontend'
$env:ISOLATED_BASE_URL = 'http://127.0.0.1:3200'
$env:ISOLATED_FIXTURE_CREDENTIALS = '../backend/.isolated/fixture-credentials.txt'
npx playwright test -c playwright.isolated.config.ts order-documents --trace off
```

MAIN DEV purchase testing is explicitly gated and limited to one synthetic fixture. `task04-dev-acceptance.cjs --prepare` creates one marked CUSTOMER and chooses one existing visible product under $100; it does not seed products or reset stock. Private credentials/progress stay in `.cache/task04-acceptance/`. Never reset the progress file after a submit or run another purchase to replace a failed screenshot. Inspect the existing attempt/provider outcome first. Financial records remain intact.

```powershell
Set-Location 'apps/backend'
node scripts/task04-dev-acceptance.cjs --prepare
Set-Location '../frontend'
$env:TASK04_DEV_PURCHASE_APPROVED = '1'
npx playwright test -c playwright.task04.config.ts
Set-Location '../backend'
node scripts/task04-dev-acceptance.cjs --witness
```

**Pre-submit resume.** If a run stopped before Place Order (marker `journeyStarted`), do not edit the marker. Run `node scripts/task04-dev-acceptance.cjs --reconcile-resume` (same exclusive lock as the browser run). It reads the fixture's orders, attempts, work rows, and signed events from the DB, then reads the provider state. It writes one single-use, fixture-bound, 15-minute resume authorization only when all of these hold:
- no order exists and at most one attempt exists;
- the attempt was never submitted or confirmation-started, has idle `READY` work and is not near expiry;
- no signed event is recorded;
- the provider intent is Test Mode `requires_payment_method` with nothing received or capturable and no payment method.

Any other result exits 2 with a `REFUSED_*` reason and changes nothing. `REFUSED_ATTEMPT_EXPIRED_NEEDS_OPERATOR` needs a separate exact recovery decision. Playwright global setup consumes the authorization under its lock. The resumed run reuses the same cart, shipping and delivery, so checkout setup replays the same attempt and PaymentIntent. `confirmSubmitted`/`purchased` never resume.

**Governed DEV recovery: the recommended normal payment runtime.**
- **Start:** `node scripts/dev-payment-runtime.cjs --start --allow-dev-recovery --recovery-mode=governed --governed-since=<owner-approved ISO instant> --accepted-backlog-attempt=<isolated id>`.
- **Worker scope:** only attempts created at or after `--governed-since`, which must be in the past and within 30 days. Every legitimate DEV purchase made after that instant is recovered without per-purchase IDs or code edits.
- **Excluded by construction:** older attempts. Any older open work other than the one accepted isolated row blocks startup.
- **IPC:** the boundary travels over supervisor IPC to the worker only; the API never receives a scope. Payment fencing, leases and Stripe idempotency are unchanged.
- **What happens to a purchase submitted but never confirmed:** about 10 minutes after submit the worker verifies with Stripe and marks it `PAYMENT_NOT_CONFIRMED`. The cart then shows that it needs attention, and Cancel purchase is available. Cancelling cancels the intent, and Return to Cart restores the items.
- **When to change the boundary:** only by a new owner decision.

**Success emails in DEV (default):** governed mode starts the email worker automatically in allowlist mode whenever `COMMERCE_EMAIL_ALLOWED_RECIPIENTS` is set (keep it in `.env.local`). The allowlist is the approval; `--no-email` opts out.
- **No allowlist:** readiness reports `emailAllowlist.reason: allowlist-empty`.
- **Delivery tracking:** about every 60 s the worker reads Brevo events for up to 10 accepted rows from the last 7 days that are still `UNKNOWN`. It records `DELIVERED` (with `deliveredAt`), `BOUNCED` or `BLOCKED` through a one-way conditional update and never resends.
- **Transient failures:** a single failed recovery batch, such as a dropped pooled DB connection, is retried with backoff. Authority is revoked only after 3 consecutive failures.
- **Other environments:** QA keeps capture mode, and production keeps its existing live-approved-target policy.

Manual equivalent of the default: `--allow-email-allowlist` plus `COMMERCE_EMAIL_DISPATCH_ENABLED=true`, `COMMERCE_EMAIL_SEND_MODE=allowlist` and `COMMERCE_EMAIL_ALLOWED_RECIPIENTS=<approved test address(es)>`.
- **Who gets mail:** only approved recipients' new order and payment confirmations are sent automatically. Other recipients' rows are never claimed.
- **Startup:** blocked if an approved recipient already has queued mail. Clear it first with `scripts/dev-email-exact-send.cjs`.
- **Session gate:** it counts only `client backend` sessions, so background workers such as `pg_net` never block it. The email reserve uses the whole 15-session budget, so start right after any previous runtime's pooler connections have drained.
- **Delivery evidence:** `scripts/dev-email-delivery-evidence.cjs --order=<ref>` (read-only Brevo events).
- **Worker locks:** MAIN DEV and isolated QA each have their own email-worker lock (`.cache/commerce-email-worker.lock` / `commerce-email-worker.isolated.lock`), so both can run at once; each still allows only one worker.

**Normal Test Mode checkout (MAIN DEV).**
- **Why checkout fails on the watched API:** `npm run dev` is the payment-restricted API and always reports `paymentsEnabled:false`, so checkout shows `PAYMENT_MUTATIONS_DISABLED`.
- **To check out,** stop the watched API and run `node scripts/dev-payment-runtime.cjs --start --allow-dev-checkout --recovery-mode=checkout --accepted-backlog-attempt=<isolated id>`. A `--preflight` variant runs the same checks without starting.
  - It runs the same DEV identity, TLS, migration, Stripe Test account and backlog gates.
  - It supervises the payment-enabled API plus the signed webhook listener.
  - It starts **no recovery worker** and keeps in-process recovery off. A stalled attempt stays Processing until a separately authorized `exact-attempt` run.
- **Ctrl+C** returns to restricted mode, after which `npm run dev` may be restarted.
- **Only one owner of :5000 at a time.** Switching modes is always: stop, then preflight, then start.

**Recovery policy.** `dev-payment-runtime.cjs` accepts two modes. The default, `--recovery-mode=incident-scoped`, recovers the exact reviewed attempt plus the Task04 fixture attempt. `--recovery-mode=exact-attempt` recovers only the one or two explicitly reviewed attempts (`--reviewed-recovery-attempt=<uuid>`, repeated at most twice) and never reads or requires the Task04 fixture.

Each reviewed attempt is checked read-only before start. Its DB state must be `AWAITING_INPUT` with `READY` work and no order. Its Stripe intent must be Test Mode `requires_payment_method` with 0 received and 0 capturable, bound to the attempt. The worker receives exactly that frozen scope over IPC. A worker release re-adds items to the Cart only for never-submitted attempts. A submitted attempt that ends `CANCELED` is returned to the Cart only through the customer's `POST /api/checkout/payment-attempts/:id/restore`, which re-verifies the provider cancellation. `--recovery-mode=governed`, steady-state recovery of future DEV purchases, fails closed until the owner approves that policy after the out-of-scope backlog is resolved. The backlog gate independently refuses startup while any unscoped `payment_work` row is not `DONE`. One owner-accepted incident row may be named with `--accepted-backlog-attempt=<uuid>`. It is excluded from the count only while it still matches its frozen record, it never enters the worker scope, and it is never modified.

**Orders timing.** Each `GET /api/orders` logs one `orders.list.timing` event with request id, outcome, duration, the adapter's actual DB operation sequence and counts, pool-queue flags, failure classes and service stage timings. No SQL, parameters or customer data are logged. Counts are exact only when `attribution` is `exclusive`. `npx tsx scripts/task04-orders-diagnostic.ts --samples=30` (NODE_ENV=development) measures the real service path serially and read-only for the synthetic fixture.

For unit/backend tests, export **both** disposable URLs and its CA from the existing private `.isolated/env.json`; never inherit shared `.env.test.local` URLs. Mock provider tests use `sk_test_placeholder`, not the real account key. On this Windows sandbox, assigning `TEMP` and `TMP` to a writable workspace `.cache/task04-temp` resolves Vitest transform-cache rename errors. Do not disable TLS to fix test setup.

## Email, PDF, performance and shutdown

Shared DEV commerce dispatch is **off by default**, even if `.env.local` requests allowlist sending. Enqueue/status remain independent. `--allow-email-allowlist` explicitly requires reviewed recipient configuration, no sendable backlog and sufficient pool budget. An ACCEPTED outbox row means provider acceptance, not delivery. Unresolved email outcomes are never replayed automatically. See [COMMERCE_EMAIL_RUNBOOK.md](COMMERCE_EMAIL_RUNBOOK.md).

Documents remain authenticated owner-scoped reads from persisted order/payment facts. A download must have PDF bytes, appropriate filename and private/no-store headers. PDF errors do not create payments or enqueue emails.

```powershell
Set-Location 'apps/backend'
node scripts/task04-db-benchmark.cjs --source=direct --samples=30
```

This is a bounded read-only SELECT 1 probe with one connection, explicit source, trusted CA, cold/warm p50/p95 and sanitized errors. It refuses PROD, shared test-mode targets and transaction runtime pooling. A failed cold connection aborts rather than repeatedly reconnecting. Use comparable workloads for before/after claims; database RTT alone is not a query-plan diagnosis.

Stop each owned foreground command with Ctrl+C. The DEV supervisor revokes/disconnects IPC children, allows their existing graceful drain, then uses a bounded force-stop only for its recorded survivors. It does not kill another port owner. Terminal/job termination can bypass normal cleanup; retain the lock until its exact supervisor/child PIDs are verified stopped. Never delete a foreign lock automatically. Existing clusters and user-started workers must be preserved unless their exact stop is authorized.

Rollback is stopping the owned supervisor, then starting the watched restricted DEV backend. Do not delete PaymentAttempt, PaymentWork, Stripe identifiers, Orders, inventory facts, outbox rows or uncertain outcomes. Do not modify Prisma migration history. Stop the disposable PostgreSQL cluster only when this session owns it and other users are finished; otherwise leave it running.
