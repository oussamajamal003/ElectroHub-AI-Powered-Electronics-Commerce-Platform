# ADR-009 — Commerce email outbox separate from the auth email ledger

**Status:** Accepted for implementation (Task 03.8, 2026-10-18). Independent architect review pending.
**Context source:** `docs/tasks/Phase-03/TASK_03.8_EMAIL_NOTIFICATIONS.md` §5–§7.

## Context

Commerce emails (order/payment confirmation, fulfillment, cancellation, refund) must be created atomically with the authoritative
Order/Payment transition and delivered asynchronously, without putting Brevo on the payment transaction or customer navigation path.
The existing `EmailDelivery` table serves authentication email (OTP, password reset/changed): rows are created and sent immediately,
carry no recoverable payload, and an OTP is only useful for about a minute.

## Decision

1. A transactional outbox, `commerce_email_outbox`, plus an append-only send-attempt journal, `commerce_email_attempts`. Rows are inserted
   with `INSERT … ON CONFLICT ("eventKey") DO NOTHING` inside the same Prisma transaction as the business transition
   (`PaymentService.markPaid`, `PaymentService.compensate`, and the future fulfillment writer through `transitionFulfillment`).
2. `EmailDelivery`, `EmailType`, `EmailDeliveryStatus` and the OTP flows are unchanged. Only the Brevo transport (`BrevoProvider`/`BrevoClient`)
   is shared, extended additively with structured failure metadata.
3. A dedicated worker (`npm run email:worker`) claims due rows with `FOR UPDATE SKIP LOCKED`, journals a STARTED attempt before any provider
   call, sends outside every transaction and acknowledges only under its current, unexpired lease token.
4. Ambiguous outcomes (timeout, 5xx, lost acknowledgement, expired lease after a started attempt) become `UNCERTAIN` and are never resent
   automatically. The guarantee is one durable event per key and one active claim per event, not exactly-once inbox delivery.
5. Delivery webhooks are deferred: `deliveryState` stays `UNKNOWN`; "sent" means provider acceptance only.
6. Physical invariants (payload/suppression/purge states, lease pairing, transition identity) are SQL CHECKs plus a guard trigger that makes
   SUPPRESSED/ACCEPTED/FAILED terminal and identity/payload immutable. RLS is enabled and browser roles have no privileges.

## Alternatives rejected

- **Extend `EmailDelivery`:** commerce-only nullable payload/lease/retry columns, two meanings of QUEUED, and the risk of a retrying worker
  selecting old OTP rows. Rejected.
- **Dual ledger (mirror commerce rows into `EmailDelivery`):** inconsistent status updates and extra writes. Rejected.
- **Redis/BullMQ or a cloud queue:** new infrastructure without a proven need; it also cannot be atomic with the PostgreSQL transition. Rejected.
- **Send in-process after commit:** lost on crash between commit and send. Rejected.

## Consequences

- Two extra tables, one worker process and separate operational queries (`commerceEmailHealth`, runbook in
  `docs/10_Operations/COMMERCE_EMAIL_RUNBOOK.md`).
- An outbox insert failure rolls back payment finalization; durable payment recovery then re-reads the already captured intent (no new charge).
- `GET /api/checkout/payment-attempts` became read-only. Overdue recovery moved to `POST /api/checkout/payment-attempts/recover-overdue`
  and the runners, so a read can never indirectly create email events.
- Mixed old/new producer versions can miss events during rollout. Activation is controlled by `COMMERCE_EMAIL_ENQUEUE_ENABLED`, with a
  recorded cutoff. There is no historical backfill.
