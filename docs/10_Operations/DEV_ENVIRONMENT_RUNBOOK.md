# MAIN DEV and isolated QA

> **STOP-WORK (2026-10-20):** The shared DEV payment supervisor remains stopped after an unscoped worker processed an attempt outside the approved scope. The fail-closed two-ID scope fix in CCR T04-PAY-01 has been implemented, reviewed by PAYMENT and Architect, and covered by offline tests. The user approved code edits and offline tests only; no runtime start or payment recovery is authorized. Preserve all payment rows. The out-of-scope attempt still requires owner review, and any future start requires a clear read-only preflight plus separate exact operational authorization.

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
