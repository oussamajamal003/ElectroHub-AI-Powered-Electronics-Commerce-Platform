# Commerce Email Runbook (Task 03.8)

Operational guide for the commerce email outbox (`commerce_email_outbox`, `commerce_email_attempts`) and its worker. Architecture: ADR-009.
The worker never touches Payments, Orders, Carts or PaymentWork, and never sends OTP email.

## Switches (all default off)

| Variable | Effect |
| --- | --- |
| `COMMERCE_EMAIL_ENQUEUE_ENABLED` | Producer. When off, no events are created and the customer notice shows "Your order details are saved here for reference." |
| `COMMERCE_EMAIL_DISPATCH_ENABLED` | Worker master switch: an emergency pause that keeps events. |
| `COMMERCE_EMAIL_SEND_MODE` | `disabled`, `capture` (disposable/test DB only; writes files), `allowlist` (claims only listed recipients), `live`. |
| `COMMERCE_EMAIL_LIVE_APPROVED_TARGET` | Required for `live` on a shared DB; must equal the worker's logged `identity` (`host:port/database`). |

| `COMMERCE_EMAIL_IMAGE_HOSTS` | Optional extra hostnames whose product images may appear in emails. Always accepted: the `COMMERCE_EMAIL_ORIGIN` host and the configured Supabase Storage domain (`*.supabase.co` public storage endpoint). Any other image is omitted from the email; the email is still sent. |

Deployment: `docker-compose.yml` defines a supervised `commerce-email-worker` service (`node dist/bootstrap.js --commerce-email-worker`, `restart: unless-stopped`). It is inert and refuses to start until dispatch and a send mode are configured for the resolved database.

Start: `npm run email:worker` (add `--once` for a single bounded pass). On startup the worker logs `email_worker_permission` with the resolved
identity and reason; it refuses to start unless that permission is allowed, and never runs under `npm run dev`.

## Development runtime (normal startup is enough)

Commerce email needs three things in every environment: the **producer** on in every process that can finalize a payment, a **supervised worker**,
and a **send mode**. The development launchers now provide all three, so no one-shot script or manual worker is needed after a purchase.

| Mode | Command (apps/backend) | What it does |
| --- | --- | --- |
| Shared Supabase DEV | `npm run build` then `npm run payment:dev` | Starts the Stripe listener, API, payment worker **and the supervised email worker** (log lines `[email-worker]`). Settings come from `.env.local`: `COMMERCE_EMAIL_ENQUEUE_ENABLED`, `COMMERCE_EMAIL_DISPATCH_ENABLED`, `COMMERCE_EMAIL_SEND_MODE=allowlist`, `COMMERCE_EMAIL_ALLOWED_RECIPIENTS=<approved mailboxes>`. Only listed addresses can ever receive mail |
| Isolated local PostgreSQL, safe default | `npm run dev:isolated` | Applies pending migrations to the disposable database, starts the watched API and the supervised worker in **capture** mode. No external email; `npm run db:isolated:emails` lists what would have been sent |
| Isolated, real Brevo | `npm run dev:isolated:real-email` | Same, with real Brevo to the approved `COMMERCE_EMAIL_ALLOWED_RECIPIENTS` only (refuses to start without them or without `BREVO_API_KEY`). Accounts that are not listed keep their events READY and visible (`allowlistExcluded`) |
| Isolated, sign in as an approved address | `node scripts/dev-isolated.cjs use-real-recipient <address>` / `restore-recipient` | Points the fixture customer at an approved address that has no account yet, then back (disposable database only) |

Startup prints (and every process logs as `email_runtime`) the producer, dispatch, send mode and allowlist size, and warns about inconsistent
combinations. The supervised worker restarts after a crash with a bounded backoff (5 restarts in 5 minutes), is **not** restarted after a configuration or
schema refusal (exit 78), and a second supervised copy is refused by a lock. Readiness is confirmed from the structured log
(`[email-worker] READY ...`). Changing email settings requires restarting the launcher.

**Every process that can finalize a payment must have the producer on.** On 2026-10-19 a purchase on the isolated database was finalized by an older
backend still running on port 5000 with the producer off (it logged `email_producer_disabled` at that moment): the order was PAID and no events existed,
while a correctly configured second backend sharing the database could not help. Stop any old backend or payment worker before relying on email; the
producer log line and the startup `email_runtime` line identify the process.

`node scripts/dev-email-smoke.cjs [--base=http://127.0.0.1:5200] [--real --login-email=<approved address>]` exercises a running isolated stack over its
HTTP API with Stripe Test Mode (a decline, then successful purchases) and checks that each purchase automatically produced exactly its two emails and that
re-reading orders sends nothing. The browser equivalent is `tests/isolated/commerce-email.isolated.spec.ts` (needs Stripe.js to be reachable).

## Activation sequence (per environment)

Never set `COMMERCE_EMAIL_ENQUEUE_ENABLED=true` against a database whose Task 03.8 schema has not been verified. The producer runs inside
payment finalization: if the tables are missing, finalization of an already captured payment fails and is retried until it reaches INCIDENT.

1. **Confirm the environment and database identity.** The `identity` printed by the migration tool and the worker (`host:port/database`)
   must be the intended project.
2. **Verify the schema:** `node scripts/commerce-email-migration.cjs verify DEV|PROD`.
3. **Require exit code 0 and `failures: []`.** Any `ledger:`, `schema:` or `drift:` code is a stop: do not enable anything. Read-only, safe to repeat.
4. **Confirm compatible application code is deployed** to every process that finalizes payments (API and payment worker), including
   `markPaid`/`compensate` with the producer hooks and the read-only `GET /checkout/payment-attempts` plus `POST .../recover-overdue`.
5. **Confirm payment finalization writers are the reviewed ones** (no older replica still finalizing without the producer, which would create an event gap).
6. **Confirm Brevo is ready:** the sender is verified, `BREVO_API_KEY` is set for the worker, `COMMERCE_EMAIL_ORIGIN` is the public HTTPS frontend
   origin, product-image hosts are as intended, and daily sending capacity covers expected volume plus OTP traffic. An invalid `COMMERCE_EMAIL_*`
   value makes the producer throw inside payment finalization, so check the exact values first (a malformed value fails `commerceEmailConfig()`;
   the worker reports it at startup as `Invalid commerce email configuration (<variable>)`) before the producer is enabled in step 7.
7. **Enable the producer** (`COMMERCE_EMAIL_ENQUEUE_ENABLED=true`) and **record the cutoff time**. Orders paid earlier get no email by design.
8. **Activate the dispatcher separately** (`COMMERCE_EMAIL_DISPATCH_ENABLED=true`) under the reviewed `COMMERCE_EMAIL_SEND_MODE`: begin with `allowlist`
   for approved recipients, and use `live` only with `COMMERCE_EMAIL_LIVE_APPROVED_TARGET` set to the logged identity.
9. **Inspect the worker:** `email_worker_permission` (allowed, expected identity), `email_worker_ready`, then `email_worker_heartbeat` with
   `attention: false`, the queue draining (diagnostics below), and `email_provider_accepted` for real events.
10. **Pause on anything unexpected** (`COMMERCE_EMAIL_DISPATCH_ENABLED=false` first; the producer can keep recording). Triggers: any `email_send_uncertain`,
    `email_worker_unavailable`, `attention: true`, a growing `oldestDueMs`, or unexpected recipients. Resolve using the incident notes below.

## "A customer says they got no email": diagnosis

Recipients are never configured per customer. Every event is addressed to the registered email of the account that bought, captured in the same
transaction as the payment. When one customer's emails arrive and another's do not, the cause is operational state, found in this order:

| Check | Signal / query | Meaning |
| --- | --- | --- |
| Was an event created? | No `commerce_email_outbox` rows for the order (`WHERE "orderId" = $1`). `email_producer_disabled` in the API or payment-worker logs | `COMMERCE_EMAIL_ENQUEUE_ENABLED` is off **in the process that finalized the payment**. Nothing was queued and nothing can be sent. Orders paid before activation are never backfilled |
| Is the worker running? | `email_worker_ready` then `email_worker_heartbeat` every 60s. None: no worker process | The API never sends. Run and supervise `commerce-email-worker` (compose) or `npm run email:worker` |
| Is sending authorised? | `email_worker_permission` (`allowed`, `reason`, `sendMode`). A refusal exits the process | `dispatch-disabled`, `send-mode-disabled`, `allowlist-empty`, `live-target-not-approved` |
| Held back by the test allowlist? | Heartbeat `sendMode: allowlist` and `allowlistExcluded > 0` | Expected in test environments: only listed recipients are claimed. Not a fault. Use `live` (with `COMMERCE_EMAIL_LIVE_APPROVED_TARGET`) only where real customers should receive mail |
| Suppressed? | `dispatchState = SUPPRESSED` and `suppressionReason` (`ACCOUNT_INACTIVE`, `RECIPIENT_UNAVAILABLE`, `SNAPSHOT_INVALID`) | Terminal by design; never overridden |
| Still waiting or retrying? | `READY`/`RETRY_WAIT` with `oldestDueMs` growing, `email_retry_scheduled` | Worker down or provider throttling. Events expire for automatic sending after 24h (`staleNeedingReview`) |
| Provider outcome? | `email_provider_accepted`, `email_delivery_failed` (`PROVIDER_REJECTED`), `email_send_uncertain` | `ACCEPTED` means Brevo accepted, not that the mailbox received it: check Brevo transactional logs (bounce, block, deferral) and the spam folder |

For a development environment, a typical local setup (in the untracked `.env.local`; restart the API and payment worker afterwards, then run the worker):

```
COMMERCE_EMAIL_ENQUEUE_ENABLED=true
COMMERCE_EMAIL_DISPATCH_ENABLED=true
COMMERCE_EMAIL_SEND_MODE=allowlist
COMMERCE_EMAIL_ALLOWED_RECIPIENTS=<approved test mailbox 1>,<approved test mailbox 2>
COMMERCE_EMAIL_ORIGIN=http://localhost:3000
```

Keep `allowlist` for shared test databases; it is a safety mode, not the customer-facing policy.

## States

`READY → LEASED → ACCEPTED` on the normal path. A provable temporary rejection goes `RETRY_WAIT → LEASED` (5 attempts maximum: 30s/2m/10m/30m
±10%, Retry-After honoured up to 1h, 24h age limit). `FAILED` means a permanent rejection or an exhausted budget. `UNCERTAIN` means the provider
may have accepted. `SUPPRESSED` means there is no usable recipient, the account is inactive, or the snapshot was invalid.
SUPPRESSED, ACCEPTED and FAILED are terminal, and a database trigger enforces this. `deliveryState` stays `UNKNOWN`: delivery webhooks are not
configured, so "sent" means provider acceptance only.

## Signals (structured logs)

`email_event_created`, `email_event_suppressed`, `email_send_attempt`, `email_provider_accepted`, `email_retry_scheduled`, `email_send_uncertain`,
`email_delivery_failed`, `email_ack_stale`, `email_worker_ready`, `email_producer_disabled` (first occurrence and every 50th: the producer is off in that process), `email_worker_heartbeat` (every 60s, with `sendMode`, counts by state, `oldestDueMs`, `allowlistExcluded` in allowlist mode,
`expiredLeases`, `staleNeedingReview`, `paused`), `email_worker_unavailable`, `email_worker_stopped`, `email_projection_unavailable`.
Logged fields are opaque IDs, types, attempt numbers, durations and safe codes only; recipients, snapshots and HTML are never logged.

Treat `attention: true` on the heartbeat as an alert. That covers any UNCERTAIN event, a due age over 5 minutes, any expired lease,
stale events awaiting review, an `email_worker_unavailable` event, and three consecutive batch failures.

## Read-only diagnostics

```sql
SELECT "dispatchState", "deliveryState", count(*) FROM commerce_email_outbox GROUP BY 1, 2;
SELECT id, type, "orderId", "attemptCount", "lastErrorCode", "uncertainAt" FROM commerce_email_outbox WHERE "dispatchState" = 'UNCERTAIN' ORDER BY "uncertainAt";
SELECT a."attemptNumber", a.outcome, a."httpStatus", a."errorCode", a."startedAt", a."finishedAt" FROM commerce_email_attempts a WHERE a."outboxId" = $1 ORDER BY 1;
```

## Incidents

- **Provider outage / 5xx / timeouts:** events become UNCERTAIN and are not retried, so nobody gets a duplicate email. Check the message in the Brevo
  transactional logs using the time and order reference; never search by customer address in shared channels.
- **429 / rate limit:** automatic. Rows sit in RETRY_WAIT with a bounded delay. Lower `COMMERCE_EMAIL_CONCURRENCY` if this persists.
- **401/403 or a missing API key:** the worker pauses all commerce sends for 5 minutes and logs `email_worker_unavailable`. Fix the configuration.
  OTP is unaffected because its rows are not processed by this worker.
- **Invalid recipient (400):** the event becomes FAILED with `PROVIDER_REJECTED`. It is not retried.
- **Lost acknowledgement / worker killed mid-send:** after the lease expires (60s) the next pass marks it UNCERTAIN. An expired claim with no
  started attempt returns to READY without using any send budget.
- **Stale backlog (older than 24h):** it is never sent automatically (`staleNeedingReview`). Decide per event after checking that the Order is
  still relevant, for example that it was not cancelled meanwhile.
- **Resolving UNCERTAIN:** if Brevo shows the message was accepted, an operator records that in a reviewed, audited change setting ACCEPTED with
  the real message id. A deliberate replay (UNCERTAIN → READY) requires a written reason and acceptance of the duplicate risk. The event key is
  kept; never insert a new key to force a resend.
- **Payload purge (retention):** a separate bounded operation applies only to ACCEPTED/FAILED/SUPPRESSED rows. It sets `payloadPurgedAt` and nulls
  `recipient`/`snapshot`. The trigger prevents restoring the payload or redispatching the row. It is not automated in Task 03.8.

## Rollback

Pause first (`COMMERCE_EMAIL_DISPATCH_ENABLED=false`); messages Brevo already accepted cannot be recalled. Disabling the producer
(`COMMERCE_EMAIL_ENQUEUE_ENABLED=false`) creates an event gap, so record the cutoff time. Keep the tables, journal and tombstones: older app
versions tolerate the additive tables. Fix forward and never delete migration history.

## Migration gate

`node scripts/commerce-email-migration.cjs preflight|deploy|verify DEV|PROD` (deploy requires `--confirm=<project ref>`) validates identity,
client TLS, the historical ledger and checksums, the exact pending set, and the documented drift. `verify` is stricter than `preflight`: it exits 2
unless the new migration is applied, finished and checksum-exact with nothing pending, and the physical schema matches the contract in
`scripts/lib/commerce-email-schema.cjs` (named constraints, indexes, triggers and trigger function bodies, enum members, RLS, no `anon`/`authenticated`
privileges, no commerce Prisma drift). Failures are listed as credential-free codes on stdout (JSON `failures`) and stderr, for example
`schema:index-missing:<name>` or `ledger:new-migration-not-applied`. It fingerprints historical ledger and OTP rows
before and after, and reads back physical constraints, triggers, indexes, RLS and browser-role privileges. Evidence is written to
`apps/backend/.cache/commerce-email-migration/`.

## Isolated general-recipient mode

`npm run dev:isolated:all-recipients` (apps/backend) runs the isolated stack with real Brevo in `live` mode. Every eligible account receives email at its own address, with no allowlist. This is permitted only because the target is the disposable database. The command refuses to start when more than 10 sendable events are pending. Use `dev:isolated:real-email` (allowlist) when only approved test inboxes may receive mail. In allowlist mode, the worker logs `email_allowlist_excluded` with the count of events it will never send. If a customer reports "queued" forever, check for this signal first.
