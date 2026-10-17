# Stripe acceptance harness — Pass 3I

This is an offline repair, not financial acceptance. Never execute the financial modes until the approved runner, PostgreSQL reliability, connection budget, disposable fixtures and Stripe Test Mode credentials are independently verified.

## Entrypoints

From `apps/backend`, `node scripts/stripe-browser-gate.cjs --dry-run` performs local configuration checks only. `checkout-browser-gate.cjs` delegates to the PaymentAttempt flow rather than the obsolete unpaid Order endpoint. The webhook verifier and fixture cleanup also default to offline preflight.

Exit codes: `READY_TO_RUN=0`, `BLOCKED_BY_ENVIRONMENT=2`, `FAILED_PRECONDITION=3`, `FAILED_ACCEPTANCE=1`, `NOT_VERIFIED=2`. A zero dry-run exit means static prerequisites matched; it never means a payment passed.

Future authorized execution requires `--execute --fixture-manifest=PATH`, a selected scenario (`--success`, `--capture-recovery`, `--decline`, `--sca`, `--sca-cancel`), and optional `--buy-now`. Ports are configurable with `--backend-port=PORT` and `--frontend-port=PORT`. No migration or seed is run.

## Approval and fixtures

The strict manifest contains only `runId`, `projectRef`, `isolatedDev`, two distinct `productIds`, `sourceFingerprint`, `approvedRunner`, `postgresReliabilityVerified`, and `connectionBudgetVerified`. Project identity must be the approved DEV project. Source fingerprint includes backend source, scripts, schema, Checkout source, lockfile and built backend runtime. Authorization additionally requires matching `STRIPE_GATE_RUN_AUTHORIZED` and `STRIPE_GATE_APPROVED_RUNNER` values supplied securely by the authorized operator.

The operator must supply explicitly approved isolated DEV Products that are legitimately customer-purchasable (`isTestFixture=false`), with unique run-owned SKU/category, expected prices and stock. The harness must not republish hidden fixtures or modify existing customer Products. It creates only an owned disposable customer and uses the real Cart service. No approved manifest or runner currently exists; do not manufacture approval to bypass this gate.

## Safety

Only the exact DEV database identity and Stripe Test Mode are accepted. TLS verification remains enabled. Environment loading matches the test runtime (`.env`, then `.env.test.local`); runtime values are compared with preflight in memory. The fresh listener forwards to the configured backend port and supplies the active signing secret. Existing services are not replaced. Spawned process handles are tracked; cleanup never terminates an unidentified port owner.

Financial records are preserved after success, failure and interruption. Separate cleanup requires an ownership manifest and `STRIPE_GATE_CLEANUP_AUTHORIZED`; paid, declined, leased, uncertain or otherwise unreconciled records are retained. Cleanup neither refunds/cancels Stripe nor deletes Order/Payment/Product records. Terminal cancellation is provider-verified before any eligible owned-customer deletion.

No raw provider objects, credentials, connection strings, tokens, card values or client secrets belong in output/artifacts. There is no HAR or Playwright tracing. Output is redacted across split chunks. Screenshots contain only rendered UI; operators must inspect artifacts before sharing.

## Evidence scope

The guarded executor supports real Payment Element entry, independent provider authorization verification before purchase, provider-backed capture/Paid readbacks, Cart/Buy Now isolation, decline, 3DS success/cancellation, refresh/same-key reuse, scoped fresh-worker recovery and signed app-owned events in the capture-recovery scenario. Reversed replay of already accepted genuine events proves duplicate handling, not first-time out-of-order delivery.

The full financial matrix remains NOT VERIFIED. Actual tab-close/reopen, interruption/restart of an already leased worker, first-time out-of-order events, last-unit Buy Now concurrency, different-key conflicts and compensation need explicit additional acceptance scenarios. Offline stubs test harness guards, not those live outcomes. A successful selected scenario must not be promoted to a full-matrix PASS.

## Connection ownership

API and runner share the module implementation, not a cross-process pool: each allows 10 connections (5 for CI test processes). One API plus one runner has theoretical capacity 20; additional verifier parents/API instances add 10 each. Module reload now reuses both Prisma client and adapter. Migration helpers use independent one-connection `pg` pools and are not executed here. Configured maxima are not observed usage; the historical pooler limit of 15 is unverified. Do not resize pools or blame latency on exhaustion without current telemetry.

The API exits after HTTP shutdown; the runner disconnects on normal completion. Harnesses explicitly disconnect their parent client. Reliable regional infrastructure and aggregate capacity must be established before executing any financial gate. GitHub-hosted `ubuntu-latest` has no verified suitable region; migration-bearing workflows are not an authorized substitute.

## Real-stack and A–J disposable runs (2026-10-15)

- `scripts/payment-pg-disposable.cjs --run --scope=scenarios-A-J` runs only the A–J file with its own exact authorization `DISPOSABLE:<db>:scenarios-A-J:fixtures+drop-run-schema`; the default scope stays A–S. `PAYMENT_PG_DISPOSABLE_REPORT_FILE` / `PAYMENT_STRIPE_DISPOSABLE_REPORT_FILE` keep the child's JSON report, including on failure.
- `apps/frontend/tests/checkout/real-stack.acceptance.spec.ts` (`playwright.real-stack.config.ts`) drives the real frontend, backend, disposable PostgreSQL and Stripe Test Mode with no route interception. It is skipped unless `REAL_STACK_FIXTURES` is set and needs an operator-started stack.
- Results and reproduction: `docs/tasks/Phase-03/TASK_03.6_REAL_PAYMENT_POSTGRES_ACCEPTANCE.md`.
