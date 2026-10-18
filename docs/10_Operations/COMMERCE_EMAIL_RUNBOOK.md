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

Start: `npm run email:worker` (add `--once` for a single bounded pass). On startup the worker logs `email_worker_permission` with the resolved
identity and reason; it refuses to start unless that permission is allowed, and never runs under `npm run dev`.

## States

`READY → LEASED → ACCEPTED` on the normal path. A provable temporary rejection goes `RETRY_WAIT → LEASED` (5 attempts maximum: 30s/2m/10m/30m
±10%, Retry-After honoured up to 1h, 24h age limit). `FAILED` means a permanent rejection or an exhausted budget. `UNCERTAIN` means the provider
may have accepted. `SUPPRESSED` means there is no usable recipient, the account is inactive, or the snapshot was invalid.
SUPPRESSED, ACCEPTED and FAILED are terminal, and a database trigger enforces this. `deliveryState` stays `UNKNOWN`: delivery webhooks are not
configured, so "sent" means provider acceptance only.

## Signals (structured logs)

`email_event_created`, `email_event_suppressed`, `email_send_attempt`, `email_provider_accepted`, `email_retry_scheduled`, `email_send_uncertain`,
`email_delivery_failed`, `email_ack_stale`, `email_worker_ready`, `email_worker_heartbeat` (every 60s, with counts by state, `oldestDueMs`,
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
client TLS, the historical ledger and checksums, the exact pending set, and the documented drift. It fingerprints historical ledger and OTP rows
before and after, and reads back physical constraints, triggers, indexes, RLS and browser-role privileges. Evidence is written to
`apps/backend/.cache/commerce-email-migration/`.
