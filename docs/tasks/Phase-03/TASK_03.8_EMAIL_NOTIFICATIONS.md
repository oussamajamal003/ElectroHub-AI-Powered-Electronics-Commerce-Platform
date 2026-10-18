# ELECTROHUB — TASK 03.8 / EMAIL NOTIFICATIONS

**Phase:** 03 — Commerce  
**Task:** 03.8 — Brevo transactional commerce emails  
**Branch:** `feature/Email-Notifications`  
**Base / integration target:** `develop`  
**Prepared:** 2026-10-18  
**Inspected baseline:** `7d29774c8125a10a883894bca2f583c753c2b7ee`  
**Scope:** Specification for backend, database, API, email templates, focused frontend UX, security, reliability, observability, Storybook, Playwright, migration gates and independent review.  
**Status:** IMPLEMENTED on `feature/Email-Notifications` (2026-10-18); see `TASK_03.8_IMPLEMENTATION_EVIDENCE.md` for actual verification. This specification remains the scope authority.  
**Execution boundary (updated 2026-10-18):** the owner subsequently authorized full implementation, local task commits, the forward-only DEV migration with its live controlled Brevo gate, and a safely gated forward-only PROD schema migration (only after its preconditions, including backup/PITR or an explicit migration-specific risk acceptance). Not authorized: push, merge, application deployment, live Stripe charges, production customer email sends, production seeding or destructive operations. 

> **Outcome:** Customers receive distinct, truthful order confirmation, payment confirmation and genuine order-state emails through the existing Brevo integration. Persist email intent atomically with the authoritative business transition; deliver asynchronously without putting Brevo on the payment transaction or customer navigation path. Email failure must never cause another charge, a lost purchase, inventory reversal or a false checkout failure.

## Task-specific visual / UX invariants — read first

1. Preserve the approved Header, Footer, lightning-logo identity, checkout hierarchy, Order Details layout and existing purchase/recovery behavior. This task adds a compact email notice, not a site redesign or notification dashboard.
2. Keep the current blue/white ElectroHub identity: primary `#2563EB`, hover `#1D4ED8`, surface `#F8FAFC`, text `#0F172A`, secondary text `#475569`, border `#E2E8F0`. Use the actual SCSS semantic tokens in the application. The inspected radius tokens are **0**; do not introduce generic rounded cards/buttons. Status icons may use the existing circular treatment.
3. The application keeps Poppins and existing type weights; emails use a dependable system/Arial fallback stack, optionally Poppins only when supported. Essential layout cannot depend on a remotely loaded font.
4. On Confirmation, place the compact email notice **after the order summary card and before the existing outside-card actions**, aligned to the card width. Keep **View Order Details** primary and **Continue Shopping** secondary. Do not put those actions back inside the card.
5. On Order Details, use one restrained notice beneath the header/status note and before the details grid. Preserve items/address/main column, summary/aside, breadcrumbs, back-navigation and independent payment/fulfillment badges.
6. Purchase success is visible immediately from persisted payment/order facts. Do not await Brevo, spin over the success screen, disable navigation, show a payment error or offer payment retry because email is delayed or failed.
7. “Sent” requires provider acceptance; “Delivered” requires authenticated delivery evidence. Neither page rendering, an outbox row nor a successful HTTP checkout response proves inbox delivery. Never show a success email notice for pending, declined, failed or legacy unpaid purchases.
8. Use one strong **View Order Details** CTA in emails, with the real `ORD-<UPPERCASE UUID>` and actual `/orders/:orderReference` route. No fake short references, support URLs, tracking buttons, invoices, PDF receipts or nonfunctional resend controls.
9. Email layout: centered fluid 600px maximum-width white card, 24px outer desktop gutter, 32px desktop inner padding; at widths below 640px use 12px outer gutter and 20px inner padding. Square border, restrained blue brand line, clear title, event facts, content and CTA. Readable without images, CSS media queries or dark-mode support.
10. At 390/768/1440/1920px application viewports, and 320/390/600px email previews, preserve hierarchy, wrapping and usable touch targets. Long UUIDs, names, addresses and amounts must not overflow or force a squeezed summary. Mobile notices stack naturally; email CTA fills the available inner width on small screens.
11. Keyboard focus remains visible; announcements occur once on meaningful state changes, not every poll/refetch. Use text plus icon for status, meaningful link labels, semantic headings and reduced-motion behavior. No email animations, JavaScript, forms or interactive widgets.
12. Capture **and open** required screenshots. Storybook/browser HTML previews prove application and basic layout behavior; they do not prove Outlook/Gmail email-client rendering. Record those separately.

## 1. Authority, inspection and source decisions

Explicit task requirements take precedence, followed by actual implementation/tests, repository architecture and supporting uploaded context. Preserve `AGENTS.md` and `AGENT_COORDINATION.md` governance. Do not apply obsolete task text over newer code silently.

### 1.1 Verified repository baseline

Repository: `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`.

The actual checkout inspected was `C:/Users/ouss0/Desktop/Tools/Coding/Portfolio/ElectroHub — AI-Powered Electronics Commerce Platform`. It was clean on `feature/Email-Notifications`, tracking its existing remote branch. Local `develop`, this branch and GitHub's inspected `develop` tree resolved to `7d29774c8125a10a883894bca2f583c753c2b7ee`. That commit merges PR #30, Order Management. No branch reset or recreation is needed. Recheck freshness, ownership and working-tree state at implementation start.

An older `electrohub-release` worktree at `cae658d` was initially inspected for discovery only. Current-branch reads and a targeted diff confirmed that the email integration, schema and root agent policies used here were unchanged between those revisions. Current payment/frontend findings below come from the requested branch.

| Inspected source | Concrete finding / consequence |
| --- | --- |
| `AGENTS.md`, `AGENT_COORDINATION.md` | Protected schema/payment/API changes need coordinated ownership and CCR review. Editing source does not authorize remote execution. |
| `docs/tasks/Phase-03/TASK_03.5_CHECKOUT.md` | Established task structure: visual invariants, repository-first contract, layer requirements, traceability, QA, DEV/PROD gates. Preserve immutable purchase snapshots and inventory/cart ownership. |
| `TASK_03.6_STRIPE.md`, current payment implementation | Authorization → order committed as `AWAITING_CAPTURE` → capture/recovery → authoritative finalization. An existing Order alone is not email-success authority. |
| `TASK_03.7_ORDER_MANAGEMENT.md`, `TASK_03.7_IMPLEMENTATION_EVIDENCE.md` | Owner-scoped order details/history exist; no 03.7 schema migration. Recorded prior tests are historical evidence, not new 03.8 results. |
| `apps/backend/prisma/schema.prisma` | `EmailDelivery` is auth-oriented; Order/Payment and payment-work models already exist. Uploaded schema has identical SHA-256 to this schema. |
| `src/services/email.service.ts` | OTP/reset/password-change methods create `QUEUED`, immediately call Brevo and update `SENT`/`FAILED`; return boolean. No durable rendered payload, retry schedule, lease or event key. |
| `src/integrations/brevo/brevo.provider.ts` | Existing sender configuration, provider injection, safe logging and test mocks. Reuse this integration. |
| `src/integrations/brevo/brevo.client.ts` | REST `POST /v3/smtp/email`; 10-second default timeout; sanitized rejection/category fields; success requires messageId. |
| `src/integrations/brevo/brevo.types.ts` | Result currently exposes success/messageId/error only. Dispatcher needs additive structured failure metadata; never parse error prose for retry decisions. |
| `src/services/payment.service.ts` | `markPaid` checks binding/received amount and, within `fenced`, writes Payment `SUCCEEDED`, Order `CONFIRMED`, Attempt `PAID`. `compensate` persists cancellation and, when proven, refund. |
| `src/services/order.service.ts` | `commitAuthorized` creates `AWAITING_CAPTURE` and Payment `PROCESSING`; snapshot fields and `ORD-UUID` projection already exist. Order reads enforce ownership. |
| `src/payment-runner.ts`, `payment-recovery-loop.ts` | Standalone worker, bounded batches, readiness, graceful abort/disconnect/log flush, safe context, isolation and `--once` conventions. Reuse patterns, not PaymentWork rows. |
| `src/routes/payment.routes.ts`, `PaymentService.purchases` | Single-attempt status is read-only, but list GET can call `process()` for overdue recovery. Resolve this concrete indirect GET side effect before attaching email-producing transitions. See §5. |
| `apps/frontend/src/features/checkout/ConfirmationPage.tsx`, `CheckoutComponents.tsx` | Owned confirmation read, truthful payment-dependent heading, existing outside-card actions. Add notice without changing purchase authority. |
| `apps/frontend/src/features/orders/OrderDetailsPage.tsx`, `Orders.stories.tsx` | Durable details route, auth gate, stale-data behavior, semantic structure and existing stories available for reuse. |
| `apps/frontend/src/styles/abstracts/_variables.scss` | Blue/white palette, Poppins/mono, 4px spacing, breakpoints 640/768/1024/1280/1536, square radius tokens. |
| `apps/backend/prisma/migrations`, `docs/06_Database/MIGRATIONS.md`, `scripts/checkout-migration.cjs` | 19 migration directories plus `migration_lock.toml`; ledger is `_prisma_migrations`, with documented legacy byte/default differences. Never normalize or rewrite history. |
| Backend/frontend `package.json` and existing email tests | Vitest, Supertest, TypeScript, ESLint, Playwright and Storybook/a11y already available. Existing frontend `test:visual` updates snapshots; do not use it blindly for comparison QA. |

Backend source paths in this table are relative to `apps/backend/` unless otherwise stated. All new filenames below are proposed, not claims that implementation exists.

### 1.2 Uploaded context and limitations

The requested `/mnt/data/` directory is not mounted in this Windows session. The referenced chat's attachment records exposed local temporary previews, which were read instead:

- `ROADMAP(2).md`: Brevo authentication foundation 02.4; commerce notifications 03.8; PDFs 03.9; tracking 04.5; admin order operations 05.4; release Phase 06.
- `schema.prisma`: byte-identical to current repo schema; SHA-256 `7c23196f5ce1469c9537b8c120ecc12bffddb4b8dfa4f78034fc4c287c060d0e`.
- `Pasted text(20261018-181344).txt`: distinct email purposes, same-transaction outbox, truthful notices, Brevo reuse, uncertain acceptance, bounded retry and preference to consider extending EmailDelivery **subject to actual inspection**. The alternative selected in §6 is an explicit, evidence-based resolution of that preference.

The bounded chat history was read; its assistant artifacts were content-reference placeholders, not readable full artifacts. The pasted attachment provides the substantive architecture context. No claim is made that hidden conversation material or inaccessible design frames were inspected. No live database, mailbox, Brevo account or production runtime was queried. Figma/email-client visual compliance is NOT VERIFIED at specification stage.

## 2. Objective, scope and boundaries

Required: durable commerce email events; distinct order/payment confirmations; persisted status notifications; versioned branded HTML and plain text; resilient dispatcher; safe migration; truthful compact UI; operational runbook; test and review evidence.

Excluded: a second provider or SMTP stack, replacement auth email workflow, public send/resend endpoint, preferences/marketing subscription system, notification center, new admin order editor, refund initiation, tracking maps, simulated fulfillment, invoice/receipt PDF generation, attachments, live payment activation, unrelated auth fixes or broad UI refactors.

03.5 owns checkout/order snapshots and inventory. 03.6 owns money, binding, capture, compensation and payment recovery. 03.7 owns customer reads and order presentation. 03.8 subscribes to proven transitions and adds narrowly scoped persistence hooks; it must not redefine those state machines. 03.9 may later attach documents through a reviewed extension. 04.5/05.4 will call the status event contract when genuine transition writers exist.

## 3. Start-of-implementation declaration and ownership

Record task/workstream/owner, base SHA/current SHA, clean/dirty state, exact owned files, protected hotspots, dependencies, CCRs, acceptance IDs and operational actions requested. Inspect nested instructions and active ownership records. Preserve unrelated changes; stop dependent edits if ownership conflicts.

Expected manifest:

| Layer | Existing files / proposed addition | Owner and restriction |
| --- | --- | --- |
| Schema | `apps/backend/prisma/schema.prisma`, one new forward migration | DATABASE + Architect; coordinate regeneration, no historical edits. |
| Producer | `src/services/payment.service.ts`; proposed `commerce-notifications.service.ts` | PAYMENT + notification owner; use existing fenced transaction. |
| Dispatcher | proposed `commerce-email-dispatcher.ts`, `commerce-email-runner.ts` | Backend; dedicated lifecycle, no automatic API-import worker startup. |
| Provider | `src/integrations/brevo/{brevo.types,brevo.provider,brevo.client}.ts` | Shared AUTH dependency; additive compatibility and existing tests. |
| Templates | proposed `src/emails/commerce/` renderers and fixtures | Backend; pure deterministic functions, no network/database. |
| Reads | `order.service.ts`, `routes/checkout.routes.ts`, shared order/confirmation types | Backend + FRONTEND; additive projection only. |
| UX | checkout components/styles, orders details/styles, proposed shared `CommerceEmailNotice` | FRONTEND; narrow presentation scope. |
| Tests/docs | colocated tests, email preview fixtures, task evidence and runbook | Respective owners; no credentials or customer data. |

Do not change generator preview features, Prisma version, connection pools, transaction timeouts, auth middleware, CartProvider or shared interceptors merely to implement email. Any necessary exception requires the protected-change process with a concrete reason. Parallel agents are optional only when separately requested; one owner per shared file.

## 4. Event authority and semantic contracts

### 4.1 Required event matrix

| Event type | Required persisted authority | Event key | Customer meaning |
| --- | --- | --- | --- |
| `ORDER_CONFIRMED` | Existing owned Order, verified capture, Payment `SUCCEEDED`, Attempt `PAID` in finalization transaction | `order:<orderId>:confirmed` | Purchase accepted; items, shipping, total and estimate. |
| `PAYMENT_CONFIRMED` | Same finalization, Payment ID and stable paidAt, amount/currency verified | `payment:<paymentId>:succeeded` | Payment amount/date/method; not an invoice or PDF receipt. |
| `ORDER_PREPARING` | Actual persisted Order transition to `PREPARING` | `order:<orderId>:transition:<transitionId>` | Preparation has begun. |
| `ORDER_OUT_FOR_DELIVERY` | Actual persisted Order transition to `OUT_FOR_DELIVERY` | Same transition pattern | Delivery status only; no invented driver, map or tracking code. |
| `ORDER_DELIVERED` | Actual persisted Order transition to `DELIVERED` | Same transition pattern | Delivered according to stored event; never claim personal receipt/signature without evidence. |
| `ORDER_CANCELLED` | Actual persisted Order transition to `CANCELLED` | Same transition pattern | Order cancellation; does not itself assert refund. |
| `PAYMENT_REFUNDED` | Proven successful refund, Payment `REFUNDED`, durable refund identity/amount and refundedAt | `payment:<paymentId>:refund:<refundId>` | Recorded refund amount; bank processing may take time. |

Never key on webhook ID alone: multiple webhook events and reconciliation can represent one logical outcome. Never key repeatable fulfillment events only by destination status. Generate a transition UUID exactly once under the mutation's lock and persist it in the event with from/to state. A replay observing the same current state performs no transition and emits no new UUID. A genuine later transition back to a state gets a new identity. Future writers with their own transition ledger pass that committed identity instead.

Two confirmations are intentional: different subjects, emphasis and content. Do not merge them into one email or send two near-identical order summaries. Delivery ordering is not guaranteed by the provider. Both must make sense independently; include the same reference and event time.

### 4.2 Events that must not produce success emails

Checkout entry, submit click, redirect query parameters, `requires_capture`, `AUTHORIZED`, `CAPTURE_PENDING`, `AWAITING_CAPTURE`, `PROCESSING`, `DECLINED`, `FAILED`, missing Payment, browser refresh, GET requests, an unverified webhook, a refund request, `REFUND_PENDING` and a failed/unknown refund are not success authority.

An unpaid cancelled Order may receive a cancellation email only when the cancellation is real. It must say no payment was confirmed where the data proves that; never invent a refund. A no-Order unexpected-charge incident must remain in 03.6's recovery/incident flow: do not invent an Order reference or route just to send a commerce email. A separate no-Order incident email requires a reviewed contract and is not silently included here.

### 4.3 Future fulfillment boundary

Current inspection found fulfillment enums/read presentation, not a complete 05.4 admin transition writer. Implement all required status templates and a transaction-bound notification adapter with tests against real persisted fixture transitions. Integrate existing cancellation/refund writers now. Do not add public/admin status mutation routes, periodic fake state changes or database triggers that send email. Clearly distinguish “template and adapter ready” from “live fulfillment producer exists.”

## 5. Transactional producer and GET reconciliation boundary

### 5.1 Atomic success transaction

Extend `PaymentService.markPaid` inside its existing `fenced` callback, after its verified binding and amount checks. With the **same Prisma transaction client**:

1. Read/select the committed Order, snapshot items, Payment and authoritative account recipient; no current catalog repricing or address-book substitution.
2. Preserve a first successful `paidAt` on replay; do not restamp the logical event or overwrite an existing snapshot.
3. Persist Payment `SUCCEEDED`, Order `CONFIRMED`, Attempt `PAID` using existing transition rules.
4. Insert both immutable outbox events with unique event keys. Use conflict-safe insert semantics that do not abort the PostgreSQL transaction on expected duplicate keys; check the existing event's type/aggregate identity if a conflict occurs.
5. Commit. The worker later renders/sends. No Brevo call, template network asset fetch, wait or process-local callback is necessary to preserve intent.

An event insert failure must not be swallowed. Roll back that local finalization transaction and let existing durable payment recovery reconcile the already-known provider outcome with the same identities. Do not undo a captured charge, create another PaymentIntent or classify it as a decline because the database is unavailable. This is different from provider delivery failure, which occurs after commit and cannot roll back the purchase.

Avoid user-row locks that invert the existing payment/cart/inventory lock order. A normal transaction read establishes the event-time account recipient; document READ COMMITTED snapshot semantics. Do not add catalog/inventory locks for email.

### 5.2 Cancellation and refund

Extend the transaction that actually persists cancellation/refund in `compensate`, not the provider request initiation. Capture before/after state, stable transition identity and refund facts. Only emit on a genuine state change. When cancellation and refund happen together, separate events explain different facts. Include refund amount from the verified refund/attempt record, not blindly the order total. Reject or flag inconsistent identity/amount rather than fabricating a full refund.

Retried `refundUnexpected` paths that merely observe already-completed state must not duplicate events. Preserve 03.6 compensation guards and cart restoration behavior.

### 5.3 Concrete existing GET issue — required narrow resolution

`GET /api/checkout/payment-attempts` currently calls `PaymentService.purchases`, which can asynchronously invoke `process()` for overdue submitted attempts. Attaching an outbox hook to `markPaid` without addressing this would permit a GET to cause email-event creation indirectly. The single-attempt GET already uses the read-only `status` method.

Required implementation: move the overdue fallback invocation out of `purchases()` into the existing authenticated `POST /api/checkout/payment-attempts/:attemptId/reconcile` path or the independently running durable/in-process recovery loop. Keep the list response contract and ownership filters. Preserve recovery liveness when the standalone worker is unavailable using the existing deliberate POST recovery behavior; inspect `PaymentRecovery` consumers before editing. Do not simply remove the fallback and strand processing purchases.

This is a narrowly scoped PAYMENT/FRONTEND CCR, not permission for a payment redesign. Tests must show that all affected GETs are provider-free and write-free, while due recovery still progresses via authorized mutation/worker paths with unchanged idempotency, isolation and bounded retry behavior. If liveness cannot be preserved safely, stop this integration and report the exact blocker; do not relax the no-GET-email invariant or ship a known regression.

## 6. Database decision — separate commerce outbox

### 6.1 Decision and precise tradeoffs

**Select a separate `CommerceEmailOutbox` model/table and a small send-attempt journal. Keep `EmailDelivery`, `EmailType`, `EmailDeliveryStatus` and all OTP behavior unchanged. Reuse BrevoProvider/Client.**

Extending EmailDelivery would reuse recipient/provider fields and one reporting table, but would require commerce-only nullable payload, key, lease and retry fields; additional enum values; explicit auth exclusion everywhere; and two incompatible meanings of QUEUED. Existing auth rows have no recoverable OTP payload and a one-minute OTP lifetime. Accidentally selecting old auth QUEUED rows for retry would be incorrect and potentially harmful. Sharing one status enum also confuses provider delivery outcomes with worker scheduling.

A dedicated table makes queue membership structural, gives new fields strict commerce constraints and keeps OTP schema and immediate boolean-return callers stable. Costs are an extra queue table, attempt table and separate operational queries. Those costs are acceptable for reduced auth coupling. Do not additionally mirror every commerce row into EmailDelivery: dual ledgers would introduce inconsistent status updates and unnecessary writes. Share transport and safe utility code, not persistence lifecycles. Document this decision in the task evidence/ADR location used by the repo.

### 6.2 Required physical schema contract

Use mapped lower_snake_case table names and repository-style quoted camelCase columns. Prisma model fields and migration SQL must agree. Proposed names below are normative unless a reviewed equivalent preserves every invariant.

`CommerceEmailOutbox` → `commerce_email_outbox`:

| Fields | Type / constraints / purpose |
| --- | --- |
| `id` | UUID primary key; generated once. |
| `eventKey` | VARCHAR(255), NOT NULL, UNIQUE; stable logical-event dedupe. |
| `type` | New commerce-only enum containing the seven event types in §4. |
| `orderId` | UUID NOT NULL FK to orders, ON DELETE RESTRICT, ON UPDATE CASCADE. No fake orders for incidents. |
| `paymentId` | UUID nullable FK to payments, ON DELETE RESTRICT; required for payment types by CHECK. |
| `userId` | UUID nullable FK to users, ON DELETE SET NULL; owner reads always join the actual Order userId. |
| `transitionId`, `fromStatus`, `toStatus` | Nullable UUID and bounded strings; required for fulfillment/cancellation events. Not a new order-status authority. |
| `recipient`, `snapshot` | VARCHAR(255) and JSONB; immutable once written. **Correction (2026-10-18, implementation):** dispatchable events require a validated nonempty recipient and a complete object snapshot. An *initially SUPPRESSED* event (no usable recipient, inactive account or invalid event facts) may have NULL recipient and keeps a minimal object snapshot (`suppressed: true`, type, reference, occurredAt) plus a required `suppressionReason`; it is never selected for dispatch and a guard trigger forbids leaving SUPPRESSED. A *privacy-purged* terminal row (ACCEPTED/FAILED/SUPPRESSED) has NULL recipient and snapshot with `payloadPurgedAt`, keeps its dedupe identity, and can never be restored or redispatched. Enforced by `commerce_email_outbox_payload_check` and `commerce_email_outbox_guard`. |
| `snapshotVersion`, `templateVersion` | Positive integer, bounded version string; deterministic validation/rendering. |
| `occurredAt`, `createdAt`, `updatedAt` | UTC timestamps with repository-consistent precision. occurredAt is the business event, not send time. |
| `dispatchState` | New enum: `READY`, `LEASED`, `RETRY_WAIT`, `ACCEPTED`, `UNCERTAIN`, `FAILED`, `SUPPRESSED`. Default READY. |
| `deliveryState` | New enum: `UNKNOWN`, `DELIVERED`, `BOUNCED`, `BLOCKED`; default UNKNOWN. Separate from dispatch. |
| `attemptCount`, `nextAttemptAt` | Nonnegative integer default 0; due timestamp default now. No silent retry-budget reset. |
| `leaseToken`, `leaseUntil` | Nullable UUID/time pair; both present exactly when LEASED. |
| `provider`, `providerMessageId` | BREVO; nullable VARCHAR(255) message ID with unique index when present. |
| `acceptedAt`, `deliveredAt`, `failedAt`, `uncertainAt` | Nullable timestamps matching proven lifecycle facts. |
| `lastErrorCode` | Nullable bounded allowlisted code, not raw provider text. |
| `payloadPurgedAt` | Nullable timestamp; never purge an actionable READY/LEASED/RETRY_WAIT/UNCERTAIN row. |

`CommerceEmailAttempt` → `commerce_email_attempts`:

- UUID PK; `outboxId` UUID FK RESTRICT; `attemptNumber` positive Int; UNIQUE(outboxId, attemptNumber).
- `leaseToken` UUID, `startedAt`, nullable `finishedAt`, outcome enum `STARTED/ACCEPTED/REJECTED/UNCERTAIN`, nullable bounded providerMessageId, safe HTTP status/error code.
- Persist STARTED before a network call. An unresolved STARTED record proves an ambiguous crash boundary, not proof of delivery.
- Do not store recipient, HTML, snapshot, provider response body, headers or secrets again in this journal.

Indexes: `(dispatchState,nextAttemptAt,createdAt)` for due selection; `(dispatchState,leaseUntil)` for recovery; `(orderId,createdAt)` for owner projections; `(outboxId,startedAt)` for attempts. Do not index recipient or arbitrary JSON without a concrete query need. Due/expired scans must be bounded and index-supported; verify plans with representative disposable data.

SQL CHECKs: counters/versions valid; lease fields paired with LEASED; accepted state requires acceptedAt and providerMessageId; payment types require paymentId; transition types require transition identity/from/to and a real change; dispatchable/non-purged records have nonempty recipient and object snapshot; purge allowed only for terminal non-actionable records with payloadPurgedAt; delivered state requires deliveredAt. Ensure CHECK logic handles SQL NULL explicitly. Prisma does not represent every CHECK: retain them in new migration SQL and test physical definitions.

Enable RLS on the new public-schema tables; revoke public/anon/authenticated access and grant only the established backend role's necessary access. Browser JWT auth is application auth, not permission to expose queue rows through Supabase Data API. Verify the actual role, default privileges and exposure configuration at authorized preflight; do not invent blanket policies or use SECURITY DEFINER to bypass missing rights.

### 6.3 Immutable snapshot contract

Snapshot v1 contains: schema/template versions; event type/time; real Order reference; business statuses; event-time recipient/name; purchase-time item name/SKU/quantity/unit price/line total and safe image URL if available; subtotal/shipping/total/currency as exact decimal strings; delivery method and stored estimate range; shipping recipient/postal address for the order confirmation only; payment amount/paidAt and optional validated brand/last4; refund identity/amount/time only for refund events; transition from/to when relevant.

Use a discriminated validation schema per event type. Payment/status templates need less PII than order confirmation; omit unnecessary shipping phone, coordinates and address data. Never persist PAN, CVV, expiry, client secret, tokens, raw provider objects or OTP values. Do not derive historic facts from mutable Product/UserAddress records when dispatching. Choose the authenticated account's event-time email, normalized under existing rules; never accept recipient/from/CTA URLs from checkout inputs. Later account-email changes do not silently redirect existing events. Missing/unusable recipient creates a durable SUPPRESSED event with a safe reason and alert; it does not send elsewhere or undo the payment. Such an event stores the minimal non-sendable snapshot described in §6.2 (correction), not a sendable one.

Template changes require a new version. Old renderer versions remain available while actionable rows reference them. Payload/schema validation failure quarantines the event as FAILED with no provider call. Amount formatting must preserve decimal precision, explicit currency and UTC/date-only delivery semantics already used by orders.

### 6.4 Retention

Proposed default: purge recipient and snapshot from terminal rows after 90 days, subject to owner-approved retention policy before rollout; retain minimal eventKey/aggregate/type/time/outcome tombstones for the lifetime of the associated Order so replay cannot resend a purged event. Attempt metadata may expire after 90 days if no incident is open. Do not delete pending/uncertain events automatically. Purge is a separate bounded, auditable operational action, not an automatically enabled job in this task. Account deletion/privacy workflows must acknowledge retained purchase records and this policy; do not silently add cascading deletion to financial history.

## 7. Concurrency-safe dispatcher and reliability

### 7.1 Claim, attempt and acknowledgement

Use a dedicated process patterned after `payment-runner.ts`: explicit startup, env validation, readiness, bounded work, structured context, stop signal, graceful Prisma disconnect and log flush. Do not repurpose PaymentWork or share a payment lease. No Redis/BullMQ infrastructure is justified for this scope.

Initial bounded configuration: batch 10, send concurrency 2, idle poll 5 seconds, provider timeout 10 seconds, lease 60 seconds. Validate positive limits; lease must exceed network timeout plus DB acknowledgement budget. These are starting operational limits, not measured performance claims. Reserve DB/provider capacity for OTP; throttle commerce independently and pause on account-wide failures.

1. In a short DB transaction, select eligible READY/RETRY_WAIT rows due by database time, ordered deterministically, using `FOR UPDATE SKIP LOCKED` and LIMIT, then set LEASED with fresh UUID token and leaseUntil. An equivalent atomic conditional-update claim is acceptable only with real concurrency proof.
2. Commit claim. Validate/render the immutable snapshot outside DB locks.
3. Immediately before send, conditionally validate live token/lease and create STARTED attempt plus increment attemptCount in a short transaction. No network call until that commit succeeds. Check the send-mode and recipient allowlist again at this boundary.
4. Call the existing Brevo provider outside all DB transactions. One invocation per journal attempt; no hidden nested HTTP retry loop.
5. Persist sanitized attempt outcome and event state only with current lease token and unexpired lease conditions. Clear lease on completion. Stale workers cannot overwrite a new claim or downgrade accepted/delivered facts.
6. If acknowledgement loses its lease or fails after provider acceptance, stop sending that event. Recovery treats the unresolved attempt as UNCERTAIN. Never call Brevo again just because an ACK UPDATE failed.

Use DB time for claim/expiry to avoid host-clock skew. Keep lock ordering consistent. Shutdown stops new claims and bounds in-flight drain; killed processes leave recoverable persisted state. External delivery cannot be fenced by a PostgreSQL token: it remains possible that an old request is accepted after lease expiry. Therefore expired rows with STARTED attempts are never blindly reclaimed for sending.

### 7.2 Expired leases and uncertain acceptance

- Expired LEASED with **no started attempt**: safe to return to READY without consuming send budget.
- Expired LEASED with unresolved STARTED: set UNCERTAIN, retain evidence and alert. Do not automatically resend.
- Timeout, connection reset after possible request write, malformed successful response, accepted response followed by DB failure: UNCERTAIN, not definitely failed.
- Safe operator reconciliation can mark accepted only with trustworthy provider/message correlation. Unknown outcomes remain unknown; absence of a webhook is not proof the email was not accepted.
- An explicitly authorized replay of UNCERTAIN requires an audit reason and acknowledgement of duplicate risk. It preserves event identity and attempt history; no customer-facing resend control. Never automatically reset counters or generate a new event key to bypass dedupe.

**Guarantee:** one durable logical event per key and one active database claim; not mathematically exactly-once inbox delivery. The selected default avoids automatic duplicates after ambiguous sends at the cost of possible delayed/missing email until reconciliation. Document this residual risk and monitor it.

Brevo documents a time-limited batch-email idempotency mechanism. Do not assume it applies unchanged to this single-message payload or survives arbitrary retries. Any future use requires verified endpoint/payload behavior, TTL handling and tests; local event uniqueness remains necessary. See official references in §18.

### 7.3 Retry and failure policy

Maximum 5 provider attempts per event, including initial send. For confirmed retryable rejections use 30s, 2m, 10m and 30m delays with bounded jitter; respect a validated Retry-After within an operator-defined cap, never tight-loop. Exhaustion becomes FAILED with a visible operational alert. Maximum automatic retry age: 24 hours; older queued work requires explicit stale-event review before a send. Do not truncate contents or silently drop a valid event to avoid a failure.

| Outcome | Required handling |
| --- | --- |
| Success with messageId | ACCEPTED + acceptedAt; delivery remains UNKNOWN. |
| 429 explicit rejection | RETRY_WAIT, throttle shared commerce traffic; honor bounded Retry-After. |
| Explicit temporary rejection with documented no-acceptance semantics | Bounded retry. |
| 5xx without reliable no-acceptance evidence | UNCERTAIN by default; do not infer non-delivery from status alone. |
| Invalid recipient/payload, permanent rejection | FAILED or SUPPRESSED as classified; no repeated retries. |
| 401/403/config/sender problem | Pause commerce sends and alert; do not burn every row's budget or affect OTP configuration. |
| Timeout/network/invalid successful response | UNCERTAIN unless transport can prove nothing was submitted. |
| Bounce/block after acceptance | Delivery outcome BOUNCED/BLOCKED; never automatically resend. |

Add optional structured result fields to the existing Brevo types: category, safe HTTP status, safe provider code, retryAfterMs and acceptance classification. Preserve `success`, `messageId`, `error` and all OTP call semantics. Missing metadata fails conservatively to uncertain/configuration failure; never classify through regex parsing of the human error string. Preserve request timeouts and response redaction.

Do not guarantee chronological mailbox delivery. Include event timestamp and historical wording such as “Your order moved to Preparing on …”; link to current details. For stale backlog or rapid cancellation/refund, an operator must review before releasing old confirmations. No automatic historical-order backfill on deployment.

## 8. APIs and optional Brevo delivery webhooks

### 8.1 Existing endpoints

Preserve checkout submit/reconcile and Stripe webhook contracts. No new public send, resend, arbitrary preview or recipient-edit endpoint. Preserve `POST /api/orders` rejection (`PAYMENT_REQUIRED`), owner-scoped order reads and existing response envelope/error middleware.

Add an optional `emailConfirmation` object to the existing owned confirmation and order-details projections only:

```ts
type EmailConfirmationSummary = {
  state: 'QUEUED' | 'DELAYED' | 'SENT' | 'DELIVERED' | 'PARTIAL' | 'UNAVAILABLE';
  updatedAt: string; // ISO time of the projected event facts
};
```

This aggregate covers the two initial confirmations, not fulfillment history. Both accepted → SENT; both delivered → DELIVERED; both pending → QUEUED or DELAYED if overdue/retrying; mixed outcomes → PARTIAL; terminal failure/suppression or uncertainty without safe aggregate completion → UNAVAILABLE. Define and unit-test precedence explicitly: both DELIVERED, both accepted without bounce/block, any mixed acceptance/negative state, both pending, otherwise UNAVAILABLE. A bounce/block prevents a blanket “sent successfully” completion claim. Uncertainty is not shown as a payment problem.

No rows, historical orders or disabled/unavailable projection → omit the object; do not manufacture QUEUED. Do not expose recipient, payload, attempts, lease, provider ID, raw failure reason or delivery history. Two indexed event lookups in the existing detail read are sufficient; do not add a polling endpoint or query this for every history card. If an old/new schema compatibility flag disables projection, keep order reads usable and emit a safe operational signal rather than hiding unexpected DB errors globally.

Existing CUSTOMER auth and Order.userId ownership remain authoritative. Return the same 404 for unknown/other-owner references, no-store sensitive responses, account-scoped query keys and cache clearing on logout/account switch. No webhook/worker secrets in browser code.

### 8.2 Optional webhook scope

Default release scope may stop at provider acceptance. If webhooks are deferred, state DELIVERED is never emitted and evidence must say delivery tracking NOT CONFIGURED. Controlled-mailbox observation is human QA evidence, not a fabricated webhook state.

If implemented, proposed `POST /api/webhooks/brevo` must use an actually supported configured Brevo authentication mechanism, preferably a dedicated high-entropy authorization header over HTTPS, constant-time comparison, safe rotation and body-size/rate limits. Do not invent a Stripe-style signature. No secrets in URL/query/logs. Reject unauthenticated callbacks before processing body contents. Preserve the existing Stripe raw-body middleware order; do not change it for Brevo JSON.

Validate event type, message ID, timestamps and bounded schema. Match a known commerce message ID or a verified non-PII custom correlation token whose round-trip was tested; never resolve ownership from a supplied recipient address. Duplicate callbacks must be idempotent. Store minimal normalized receipt identity/outcome/time with a unique dedupe key if receipts are implemented; this adds a separately documented commerce receipt table to the same forward migration. No raw webhook payload archive.

Handle callback-before-ACK by bounded durable unmatched receipt storage and later correlation; authenticated unknown IDs must not create outgoing events. TTL-clean unmatched records after a reviewed short retention, e.g. 7 days. Out-of-order accepted/deferred callbacks cannot downgrade DELIVERED; bounce/block evidence is retained and raises an operational issue even if it conflicts with earlier delivery. Use provider occurrence time and deterministic event precedence, not arrival time alone. Opens/clicks do not prove delivery and are unnecessary tracking scope.

On DB failure return non-2xx for provider retry; only acknowledge persisted/duplicate/no-op valid events. Authentication failures are 401/403, invalid schema 400, over-limit 413/429. No callback may mutate Payment/Order or invoke another email send.

## 9. Branded HTML and plain-text template specifications

Build pure typed renderers returning subject, preheader, HTML and text from the versioned snapshot. Use a shared commerce layout; do not copy whole templates per event. Do not rewrite OTP templates as part of visual polish.

### 9.1 Shared layout

- Header: existing lightning mark/wordmark, 24px high icon and readable ElectroHub text. Use a reviewed static email-safe raster asset derived from the existing mark, or text fallback; never invent a replacement logo. Decorative asset has empty alt; meaningful standalone wordmark has “ElectroHub” alt. No remote image is required to understand the message.
- Short hidden preheader with event-specific context, without address/card details. Visible heading 24px/600 desktop, 22px mobile; body 16px with 1.5 line height; secondary metadata minimum 14px. Order reference 14px mono with safe wrapping.
- Compact status band with icon and text, real reference and event date. Neutral cancellation/refund treatment, green only for proven successful facts, blue for progress.
- Item rows use 56px thumbnails as optional decoration, product name, quantity, unit price and line total. At narrow widths, stack amounts below text rather than compressing four columns. Missing images use quiet reserved space or omit image column; never expose broken-image artifacts.
- Totals have aligned labels/amounts and one clear grand total. “Total paid” only for payment success; refund template labels its own amount. Show currency explicitly where ambiguity exists. Do not add tax/discount rows without persisted values.
- One 48px-minimum-height primary CTA, white 16px semibold text on primary blue, square corners, generous horizontal padding. Provide a readable fallback URL in plain text. No secondary promotional/product carousel.
- Footer: transactional-purpose explanation and actual support contact only if configured/verified. Otherwise say “You can find the latest information in Order Details.” No fake support address, social links or unsubscribe marketing workflow.
- Use presentation tables where needed, semantic headings, inline critical CSS, safe fixed-width fallbacks and fluid widths. Avoid CSS grid/flex as essential layout, external stylesheets, background images for essential content, embedded scripts or forms. Mark layout tables `role="presentation"`.
- Escape every variable for HTML/text/attribute context. Strip CR/LF from subject/header values. Build links from a validated configured frontend origin and encoded known route; allow HTTPS in deployed modes and explicit localhost only in isolated development. No user-controlled base URL or javascript/data URL. Product images use trusted HTTPS asset origins; no server-side fetch of arbitrary snapshot URLs.
- Dark mode must remain legible with explicit foreground/background pairs. Images-disabled rendering retains reference, amounts, address and CTA. Keep rendered HTML below 90KB with realistic maximum-order fixtures; if real bounds exceed this, design a reviewed readable representation, never silently omit items.

### 9.2 Exact purposes and copy contracts

| Template | Subject / headline | Required content and exclusions |
| --- | --- | --- |
| Order confirmed | `Order confirmed — {reference}` / `Your order is confirmed` | Purchased item snapshot, quantities/prices, subtotal/shipping/total, shipping recipient/address, delivery method and stored estimate with business-day caveat. “Your purchase is confirmed. Here are your order details.” No invoice label. |
| Payment confirmed | `Payment confirmed — {reference}` / `Your payment is confirmed` | Amount/currency, paid date, reference, verified brand/last4 if present. “We’ve confirmed your payment for this order.” Do not repeat full address/item catalogue, claim a downloadable receipt or show provider secrets. |
| Preparing | `We’re preparing your order — {reference}` / `Your order is being prepared` | Actual transition time, reference, concise preparation message, optional stored delivery estimate clearly labelled as estimate. |
| Out for Delivery | `Your order is out for delivery — {reference}` / `Your order is out for delivery` | Persisted transition and existing estimate only. No “arrives in 10 minutes”, driver location or tracking link. |
| Delivered | `Order delivered — {reference}` / `Your order is marked delivered` | Stored delivered transition date. Do not invent a signature or delivery recipient. |
| Cancelled | `Order cancelled — {reference}` / `Your order was cancelled` | Cancellation fact/time, persisted payment status and careful explanation. Only mention a refund as completed if independently proven. |
| Refunded | `Refund confirmed — {reference}` / `Your refund is confirmed` | Verified refund amount/currency/time and order reference. “The refund has been recorded. Your bank’s processing time may vary.” Do not promise a specific bank arrival date. |

All seven require equivalent plain text with meaningful sections, full amounts/reference and valid order link. Optional data is omitted cleanly, not replaced by “undefined”, fake ETA, placeholder card or invented image. UTC instants and date-only delivery windows must not shift a day under client timezone differences. Refund/cancellation language must agree with actual stored states.

## 10. Frontend states, interactions and responsive behavior

Use a focused reusable notice component consuming the additive projection. Do not create a notification store, global badge, preferences page, toast stream or email-address editor. Reuse Button/Link, semantic notice styles and existing query/auth/error behavior.

| Situation | Notice / behavior |
| --- | --- |
| Paid + QUEUED | **Email confirmations** — “Your order and payment confirmations are queued. You can view your order details now.” |
| Paid + DELAYED | “Your confirmation emails are taking a little longer. Your order and payment are confirmed.” |
| Paid + SENT | “Your order and payment confirmations have been sent. Check your inbox or spam folder.” This means provider accepted, not guaranteed inbox delivery. |
| Paid + DELIVERED | “Your order and payment confirmation emails were delivered.” Only from authenticated provider evidence for both. |
| Paid + PARTIAL | “Some confirmation emails are still pending or could not be confirmed. Your purchase is confirmed.” Avoid claiming both succeeded. |
| Paid + UNAVAILABLE | “Your purchase is confirmed. We couldn’t confirm email delivery. Your order details are available here.” Calm inline information, no checkout-error banner. |
| Paid + no projection / historical | “Your order details are saved here for reference.” No claim about queued/sent mail. |
| Pending/unknown/unprocessed/declined | Preserve existing truthful payment/recovery messaging; no initial-success email notice. |
| Cancelled/refunded | Keep genuine order/payment status and relevant existing explanation. Do not show the original success notice as current order status. |
| Background read failure | Preserve loaded order; show existing stale-data notice. Do not replace email state with an invented failure. |
| Session unresolved / signed out / other owner | Existing auth gate/loading/404; no recipient or event data leaks. |

No full recipient address is returned or shown. Do not claim “registered address” is current if an old event used a previous address. The notice's only navigation is the existing order-details action; no “try payment again”, “resend” or fake “contact support.”

Desktop notice: icon and copy aligned, 16px padding, 12px gap, 1px semantic border, shared width with surrounding content. Small mobile: icon remains small, text wraps, no fixed height, 16px gutter inherited from page. Use current 640/768/1024 breakpoints; no global layout changes. At 200% zoom and 320px narrow preview, reference text may break anywhere without overlapping amounts. CTA touch target at least 44×44 CSS px.

Use static text for initial render; optional `role="status"`/`aria-live="polite"` only for a meaningful newly received change, with deduplication. Do not announce the entire order repeatedly or move focus on background email state changes. Keep existing first-load heading focus and navigation behavior. Restrained existing hover/focus transitions may be used; respect reduced motion, no automatic dismissal or confetti.

No extra polling solely for email. A normal authorized order refresh may update the projection. If future polling is approved, it must be bounded, visibility-aware and stop at terminal state; it may only call read APIs.

## 11. Security and privacy requirements

- Brevo key/sender settings remain backend-only. Do not add `VITE_BREVO_*`, browser sends, client-supplied recipient or arbitrary template parameters.
- Snapshot recipient derives from trusted account identity; use one recipient per request, no BCC/CC batching that risks cross-customer disclosure.
- Validate enum/status mappings, UUIDs, decimal strings, lengths, asset URL schemes and template versions. Escape malicious product/address/name fixtures; do not render raw customer HTML.
- Email links contain only public order reference. Existing login/ownership controls guard details; a UUID link is not an authorization token. Preserve safe internal return paths after login and reject external redirect targets.
- No PAN/CVV/expiry, Stripe client secrets, raw JWT/cookies, OTP, Brevo credentials, full email/postal addresses, phone or coordinates in logs, metrics labels, screenshots or evidence. Card brand/last4 may appear in authorized email/UI when validated, not in general worker logs.
- Do not log serialized snapshots, email HTML/text, request/response bodies or raw exception objects that may contain them. New commerce logging uses allowlisted fields only; existing OTP masking is not permission to log commerce addresses.
- New tables are backend-private, with RLS/grants verified. Review default privileges and no anonymous read/write through Supabase Data API. Use existing application authorization; do not add Supabase Auth as a second identity system.
- Keep OTP rate limits, resend semantics, expiry, test-outbox behavior and password-change notifications intact. Commerce backlogs must not consume all provider or DB capacity needed for authentication.

## 12. Observability, operations and performance

Emit UTC structured events: `email_event_created`, `email_send_attempt`, `email_provider_accepted`, `email_retry_scheduled`, `email_send_uncertain`, `email_delivery_failed`, `email_delivered`, `email_bounced`, `email_blocked`, `email_worker_ready`, `email_worker_stopped`, `email_worker_unavailable`. An event-created log is emitted only after commit or explicitly labelled uncommitted; logs are never the durable queue.

Allowlist fields: outboxId, type, templateVersion, opaque orderId, workerInstanceId, attemptNumber, safe errorCode/status, durationMs, queue age, correlation ID. Do not use recipient/order IDs as unbounded metric labels. Store provider messageId in restricted persistence; redact or hash it in shared operational evidence.

Metrics: counts by dispatch/delivery state and type, oldest due age, attempts/retries, uncertain outcomes, permanent failures, send latency, expired leases and heartbeat. Initial alert thresholds: due age >5 minutes, no worker heartbeat >60 seconds while backlog exists, any UNCERTAIN, any auth/config rejection, repeated batch failures ≥3. Tune with actual DEV evidence, not invented SLO results.

Runbook must cover provider outage/rate limit, bad configuration, invalid recipient, lost acknowledgement, expired lease, worker restart, safe readback, explicit uncertain replay, payload purge and flag rollback. Do not expose a broad admin dashboard just to inspect rows; scoped read-only operational queries and existing logging suffice.

Performance acceptance: producer adds bounded snapshot selection and two inserts, no external round trips. Render outside locks. Dispatcher claims at most its batch and respects concurrency/provider limits. Record before/after finalization transaction latency and due-query plan in comparable isolated/DEV conditions; investigate material regression, do not globally raise pool/timeouts. One small notice should add no heavyweight runtime library or additional page-loading waterfall.

## 13. Configuration and safe sending modes

Reuse `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` and verified existing origin config where suitable. Proposed new validated backend settings:

| Setting | Safe default / meaning |
| --- | --- |
| `COMMERCE_EMAIL_ENQUEUE_ENABLED` | false until schema/application rollout is ready. Controls only new event producer activation; do not imply queued email when disabled. |
| `COMMERCE_EMAIL_DISPATCH_ENABLED` | false; independent emergency pause retains events. |
| `COMMERCE_EMAIL_SEND_MODE` | `disabled`, `capture`, `allowlist`, `live`; default disabled. |
| `COMMERCE_EMAIL_ALLOWED_RECIPIENTS` | Explicit controlled DEV addresses; empty means no real sends. Never print values. |
| Worker limits | Validated batch/concurrency/timeout/lease/retry caps from §7. |
| Trusted frontend origin | HTTPS deployment origin; isolated localhost only in test/dev. |
| Optional webhook secret | Separate from Brevo API key; absent means endpoint disabled. |

Capture mode uses synthetic fixtures and local restricted artifacts only; never route real customer payloads to a developer mailbox. Allowlist mode refuses recipients outside the list rather than silently replacing them. Test mocks/capture must be visibly labelled in evidence. The existing provider auto-mocks in NODE_ENV=test and has `VITEST_NO_MOCK_BREVO` / `E2E_OTP_OUTBOX_DIR` behavior; a passing mocked test is not a real send. A real controlled-mailbox run must deliberately verify the provider mode and authorization without changing OTP test semantics.

Do not run email workers as an incidental effect of importing services, building Storybook or starting generic tests. A future dedicated `email:worker` command may be added through the existing bootstrap/environment-loading pattern; record exact target identity and mode before starting it. No global worker processing historical rows during a fixture test.

## 14. Physical migration, DEV gate and PROD protection

### 14.1 Preserve actual history

The inspected repository has 19 Prisma migration directories, from `20240101000000_database_foundation` through `20261016000000_payment_attempt_confirmation_started`. Two different migrations share the `20260928000000` prefix; preserve both names/order as recorded. Do not renumber, squash, regenerate, normalize line endings/BOMs, edit checksums or rewrite `_prisma_migrations`.

The OTP migration `20240103000000_email_otp_foundation/migration.sql` physically creates email_deliveries with UUID and updatedAt defaults. Repository evidence documents seven historic defaults that raw Prisma diffs propose dropping, plus approved historical LF/CRLF/BOM checksum differences. Preserve them. Compare exact bytes and documented semantic exceptions; unexplained drift is a stop condition. Do not copy the old checkout gate's hard-coded migration name/count into a new gate unchanged.

Use Prisma as the only schema/migration authority. No competing Supabase migration ledger, `db push`, reset, resolve/mark-applied workaround or direct untracked remote DDL. Generate a new timestamped forward migration through the repository's pinned Prisma workflow on an explicitly disposable database or offline reviewed diff. Filename is allocated at implementation time; no historical timestamp collision. The expected migration adds commerce enums/tables/indexes/FKs/CHECKs/RLS/grants and, only if selected, the webhook receipt table. It must not alter auth email enums/table or existing order/payment data.

New Prisma reverse relations are metadata additions to Order/Payment/User; they do not justify unrelated column changes. Do not manually edit generated client. Preserve generator features/versions and lockfile; regenerate once after coordinated schema approval.

### 14.2 Offline/disposable proof

Validate SQL, schema/client and diff. Apply all historical migrations plus the new one to an authorized disposable PostgreSQL instance using explicit isolated credentials; never let a shadow database default to DEV/PROD. Verify unique/check/FK/RLS/index definitions, normal inserts, rejected invalid states, duplicate event behavior and concurrent claims. Compare historic-file hashes before/after. Record rollback limitations: deleting schema is not recovery for accepted email or event history.

### 14.3 Authorized DEV gate

DEV reference from repo policy: `pzxekjybdiulzmssalfo` (`electrohub-dev`). Verify actual target independently; a configured URL is not authorization. Prepare exact migration checksum, pending set, commands, fixture ownership/IDs, test mailbox, worker scope, cleanup and stop thresholds before execution.

Preflight readback: database identity, TLS validation, Prisma versions, `_prisma_migrations` fields (`migration_name`, checksum, finished_at, rolled_back_at and failure/unfinished state), physical schema and documented drift exceptions, backend role/grants/RLS, row counts relevant to locks/rollout, backup/recovery position. Compare all previous ledger rows and exact migration bytes. Do not print connection strings.

After separate authorization, deploy exactly the reviewed pending set. Prisma migrate deploy can apply every pending migration, so stop if anything beyond the approved set is pending. Verify the new ledger checksum/completion, old ledger fingerprint unchanged, physical definitions, RLS/grants and OTP table/data unchanged. Do not claim a fresh remote 19-row baseline without reading it; counts can legitimately change before implementation.

Run scoped synthetic events through the guarded dispatcher to one approved mailbox. Prove: authoritative transition and two outbox events; one claimed attempt per event; Brevo message IDs/acceptedAt; actual mailbox observation for both distinct emails; mobile/plain-text checks; no other recipients. Optionally prove authenticated delivery webhook state. Record safe opaque IDs, timestamps, redacted mailbox identity and outcomes. Clean only owned fixtures after preserving concise evidence; no broad deletes or replay of existing queues. New real payment exercises remain Stripe Test Mode and require existing payment-isolation approval.

### 14.4 PROD preflight and later rollout — no execution in this task

PROD reference: `yepfgjehdstlxbpespun`; independently verify before any separately authorized access. Historical 03.6 Update 8/03.7 records report 19 completed migrations and preserved schema/ledger, but that is not current inspection or permission. Prior acceptance of backup risk is not carried forward automatically.

Before rollout require owner/architect approval of exact revision, new SQL checksum, pending set, backup/PITR or documented recovery-risk decision, lock/time budget, sender-domain verification, DNS deliverability configuration, live credentials/origin, worker capacity, monitoring, retention and pause/recovery plan. No production fixtures, test charges, seeds, mailbox experiments or global historical email backfill.

Rollout sequence: migration expansion with features disabled → compatible app/provider code → verify all finalization writers use the new producer revision → enable enqueue for new events → controlled dispatcher activation → monitor backlog/uncertainty/rejection/OTP latency. Mixed old/new producer versions can miss events; use a coordinated activation boundary and document the cutoff. Do not assert exactly-once intent for events processed by old code before activation. No implicit retroactive scan.

Rollback first pauses dispatch (irreversible messages already accepted remain sent), then disables enqueue only with an explicit event-gap record and recovery plan. Preserve outbox, journal, schema and tombstones; old app versions must tolerate additive tables. Drain/reconcile uncertainty before any future schema contraction. Fix forward instead of deleting migration history.

## 15. Verification plan — all layers

No implementation tests are claimed as run by this specification. Use existing credible evidence for unchanged areas, and add focused proof for changed behavior. Inspect environment loading before test commands; some backend suites can reach live systems.

### 15.1 Unit / contract tests

- All seven renderers: subject/preheader, HTML/text parity, exact decimals/currency/dates, long content, missing optional data, escape injection, invalid links, no secrets, image-off fallback and version dispatch.
- Event selection: no event before authoritative payment success; two distinct initial keys; immutable recipient/snapshot after account/product changes; no-op transition emits none; repeat genuine destination transition gets new identity; refund pending/failed/no-order incident creates no false confirmation.
- Provider result mapping: accepted, 429, explicit reject, auth/config issue, timeout, network failure, 5xx ambiguity, malformed success and Retry-After parsing. Existing OTP provider/service tests still pass unchanged in semantics.
- Projection precedence, no-recipient exposure, omitted historic projection, auth/owner isolation, no GET mutation/provider calls and backward-compatible response fields.
- Retry bounds, age limit, lease token fencing, shutdown and disabled/capture/allowlist/live mode guards.

### 15.2 Real PostgreSQL integration — critical

Use deterministic barriers and separate connections/processes, not only sleeps or mocked Prisma:

| ID | Scenario | Required observation |
| --- | --- | --- |
| DB01 | Finalization succeeds | Payment/Order/Attempt and both events commit together. |
| DB02 | Force outbox insert failure | Local finalization rolls back; existing payment recovery remains eligible; no provider email call or new charge. |
| DB03 | Duplicate webhook/reconcile and concurrent finalization | One event per logical key, no snapshot overwrite; existing payment fencing preserved. |
| DB04 | Two dispatchers select same due work | One active token/attempt; other worker skips or loses conditional claim safely. |
| DB05 | Crash after claim before STARTED | Expiry safely recovers with no send consumed. |
| DB06 | Crash after STARTED / provider accepted before ACK | UNCERTAIN, no automatic resend; stale ACK cannot corrupt current state. |
| DB07 | Expired worker overlaps newer recovery | Token/expiry guards reject stale writes; recovery does not blindly resend unresolved request. |
| DB08 | 429/transient rejection/exhaustion | Correct due times/counters, max five attempts, no tight-loop. |
| DB09 | New legitimate status transition and replay | Identity dedupe works; later return to same status is not suppressed. |
| DB10 | Migration/security/purge | Required constraints/indexes/grants; denied browser-role access; old ledger preserved; purge retains dedupe tombstone. |

If optional webhooks: duplicate/out-of-order, invalid auth, early receipt before ACK, unknown ID, bounce/block, no raw payload retention and DB-failure retry behavior. Mocked SQL tests alone do not establish these properties.

### 15.3 Frontend, Storybook and accessibility

Component tests cover every row in §10, stable purchase success under email failure, stale data, auth changes and no extra mutation calls. Use existing production components in stories; no story-only duplicate implementation.

Storybook stories: Queued, Delayed, Sent, Delivered, Partial, Unavailable, LegacyNoProjection, PendingPaymentNoSuccessNotice, CancelledRefunded, LongReferenceAndCopy, Mobile, Dark/HighContrast where supported. Include keyboard interaction and a11y addon checks. Stories for optional delivery state use clearly labelled fixtures, not a claim that callbacks are configured.

Playwright: paid confirmation → details; refresh/back/forward; direct email deep link → login → owned order; other-owner/unknown reference; blocked Brevo/uncertain email while purchase remains usable; pending/failed payment never shows confirmation-mail success; stale read; account switch/logout; network-failure retry; slow order read without layout jumps. Verify GETs cause no enqueue/send and explicit payment recovery still progresses after the §5 change.

Capture application states at 390, 768, 1440 and 1920 widths; inspect long data, queued/delayed/unavailable, cancellation/refund and loading/error. Test keyboard-only navigation, visible focus, 200% zoom, reduced motion, screen-reader announcement behavior and contrast (4.5:1 ordinary text, 3:1 large text/non-text controls). Automated a11y checks supplement manual keyboard/announcement checks.

Render deterministic email fixtures at 320/390/600 widths; open captures for all seven templates, plain text, images blocked and dark-mode fallback. Inspect at least Gmail web/mobile, Outlook desktop/web and Apple Mail where available using the controlled mailbox; identify exact tested clients. Browser preview is insufficient evidence for table/layout compatibility in real email clients. Missing client evidence is reported and assessed by risk, not concealed.

### 15.4 Commands and evidence discipline

Use actual workspace scripts: backend/frontend `npm run typecheck`, `npm run lint`, targeted `npx vitest run <actual-files>`, `npm run build`, frontend `npm run build-storybook`. Run existing OTP/Brevo, payment finalization/recovery, owner-read and changed frontend regressions. Add focused dispatcher/PostgreSQL and notification Playwright suites with explicit safe configuration; new command names must be implemented before being reported as available.

For comparison, call Playwright directly with the verified config and without `--update-snapshots`. The current `npm run test:visual` includes baseline update; accepting newly generated screenshots is not a visual test pass. Run `git diff --check`, inspect changed-file scope and scan fixtures/evidence for secrets/PII. Do not run full live suites or start global workers because a generic test command is convenient.

Record command, cwd, revision, environment/mode, exit code, counts and safe artifact links. Label mock/disposable/DEV/provider/mailbox evidence distinctly. Existing 03.7 evidence reports four pre-existing checkout visual failures; compare only relevant failing cases against the current base if they recur. Do not absorb unrelated failures or call a partial run fully green.

## 16. Acceptance traceability and deliverables

Every ID below must map to exact implementation files and concise evidence. Use PASS / FAIL / NOT VERIFIED / explicitly DEFERRED, with reason and owner. An optional webhook deferral is not a mandatory-feature failure; missing core atomicity/concurrency evidence is.

| ID | Acceptance requirement | Minimum evidence |
| --- | --- | --- |
| EN01 | Existing Brevo transport reused; OTP behavior preserved | Source diff + existing provider/auth email tests. |
| EN02 | Success emails only after authoritative committed payment success | markPaid transaction inspection + DB01/02 and negative state tests. |
| EN03 | Two distinct confirmations and seven complete templates | Renderer assertions + HTML/plain-text captures opened. |
| EN04 | Genuine cancellation/refund and future fulfillment adapter | Actual writer integration + persisted transition tests; future writer limit documented. |
| EN05 | Same-transaction outbox, immutable recipient/snapshot, event dedupe | DB01–03/09 + mutation-of-source-data test. |
| EN06 | Separate outbox/journal decision and physical schema | Schema/SQL/ADR + constraints/indexes/RLS readback. |
| EN07 | Leased dispatcher safe across replicas/crashes | DB04–07, token fencing and restart evidence. |
| EN08 | Bounded retry and explicit uncertain acceptance | DB08 + timeout/ACK-loss/5xx tests and runbook. |
| EN09 | No email network calls in payment transactions; no GET email side effects | Call graph review + GET and provider-call assertions; recovery liveness regression. |
| EN10 | Truthful compact notice; email failure leaves purchase usable | Component/Playwright scenarios for §10. |
| EN11 | Ownership, privacy, escaping, secret-safe logs and safe URLs | API/security tests + redacted log inspection. |
| EN12 | Responsive, polished, accessible UI and email | Storybook, required viewport captures, keyboard/a11y and client matrix. |
| EN13 | Historical migration bytes/ledger/defaults preserved | Before/after fingerprints + scoped physical readback. |
| EN14 | Controlled DEV delivery and correct accepted/delivered distinction | Authorized mailbox/provider/DB evidence, or exact runtime gate still outstanding. |
| EN15 | Optional webhook secure or explicitly deferred | Auth/replay/order tests OR acceptance-only documented state. |
| EN16 | Observability and resource limits; OTP capacity protected | Bounded batch/metric/log tests + relevant timing comparison. |
| EN17 | No invoices/tracking/admin updates/dashboard scope creep | Changed-file/UI review. |
| EN18 | Self-review and independent architect review | Checklist, actual diff review, score and explicit verdict. |

Implementation handoff adds `docs/tasks/Phase-03/TASK_03.8_IMPLEMENTATION_EVIDENCE.md` and a concise operational runbook in the existing operations documentation structure. Update affected feature/API/database/environment docs and record this architectural decision where established ADRs live. Do not update roadmap completion or claim release merely because files exist.

Evidence should be compact: one summary table, exact tests/counts, migration fingerprints, a small safe trace for each critical interleaving, and indexed screenshot/client evidence. Keep full logs in controlled artifacts, not thousands of pasted lines. Do not expose test mailbox addresses or snapshots in public documents.

## 17. Review process, score and stopping rules

### 17.1 Risk tiers

- **Low risk — 5–15 minute target:** isolated copy/layout/docs refinement with no changed authority or persistence. Review full diff, relevant visual/state evidence and focused checks.
- **Medium risk — 15–40 minute target:** additive read projection, template/provider metadata change or worker orchestration refinement. Review consumers, failure states, compatibility and targeted integration/security evidence.
- **Critical — full critical-path review, no arbitrary time cap:** payment transaction hooks, schema/migration, idempotency, concurrent claims, uncertain acceptance, GET-to-recovery boundary or webhook authentication. Task 03.8 as a whole is critical because it includes these changes. Deep review is scoped to these risks, not every unrelated file.

Time ranges are review planning budgets, not permission to skip blockers or mandates to spend the entire period. Accept credible existing evidence for unchanged behavior. Repeat checks only after relevant changes, failures or unresolved concerns. Distinguish material defects from optional enhancements.

### 17.2 Implementation agent self-review

Before handoff, read the original request and this specification, inspect every changed file and affected caller, verify EN01–EN18, review transaction/lease/state interleavings, verify safe logs/assets/URLs, inspect migration SQL/history and confirm no unauthorized runtime action. Open required screenshots. Explain remaining gaps rather than fabricating results. Give a self-score with reasons, but label it **self-review**, not independent approval.

### 17.3 Independent Principal Architect review

A reviewer independent of the implementation must read the task and summary, inspect actual changed files and relevant surrounding code, assess architecture/security/edge cases/performance/migrations/API compatibility proportionately, and assess available QA evidence. Only actionable defects or material evidence gaps should block approval.

| Category | Points |
| --- | ---: |
| Correctness and requirements | 20 |
| Security | 20 |
| Architecture and compatibility | 15 |
| Concurrency and database safety | 15 |
| Tests and evidence | 15 |
| Performance and reliability | 10 |
| Documentation and operations | 5 |

Required verdict: **✅ Approve** when criteria and required gates pass with acceptable documented residual risk; **⚠ Request Changes** for fixable material defects/missing required evidence; **❌ Reject** for fundamentally unsafe design, contract violations or unauthorized actions. Unresolved P0/P1 blocks regardless of score. A high numerical score alone does not approve the work. Review approval never authorizes merge or deployment.

No implementation score or independent approval is invented in this specification. At review, provide score `/100`, evidence-supported rationale, blockers with file/line and concrete fix, optional improvements separately, residual risks and approval scope. If DEV execution is not authorized, implementation may be marked offline-review-ready, but full operational acceptance remains NOT VERIFIED.

### 17.4 Stop conditions

Stop affected work on: protected-file conflict; unexpected user changes; ambiguous target identity; unauthorized live send/write/worker operation; unknown pending migrations; unexplained checksum/schema drift; new access exposure; recipient leak; payment/cart/inventory invariant regression; provider call under transaction; GET-driven enqueue; unbounded retry; overlapping/stale send risk not handled; tests weakened; new secrets in artifacts; pool/lock exhaustion.

Report exact evidence, risk, safe next options and required owner action. Continue unrelated authorized work. Do not repeatedly reopen resolved decisions or demand new tests without a concrete risk. Once mandatory criteria pass and no material blocker remains, approve with residual risks; avoid endless cosmetic or speculative review loops.

### 17.5 Final implementation report template

```text
TASK / OWNER / BRANCH / BASE SHA / REVIEWED SHA:
STATUS: implementation-complete / review-ready / approved (exact scope)
SUMMARY AND EXACT CHANGED FILES:
EN01–EN18 TRACEABILITY:
TRANSACTION / EVENT / LEASE / UNCERTAINTY DECISIONS:
API AND OTP COMPATIBILITY:
SCHEMA / NEW MIGRATION CHECKSUM / HISTORY PRESERVATION:
TEST COMMANDS / ENVIRONMENT / EXIT CODES / COUNTS:
STORYBOOK / PLAYWRIGHT / OPENED CAPTURES / EMAIL CLIENT MATRIX:
DEV / BREVO / MAILBOX / WEBHOOK EVIDENCE OR NOT VERIFIED:
PERFORMANCE / OBSERVABILITY:
AUTHORIZATIONS AND ACTUAL OPERATIONS:
RESIDUAL RISKS / BLOCKERS / OPTIONAL IMPROVEMENTS:
SELF-REVIEW SCORE AND LIMITATIONS:
INDEPENDENT ARCHITECT SCORE /100 AND VERDICT:
ROLLBACK / RELEASE GATES:
COMMIT / PUSH / MERGE / DEPLOY STATUS:
```

## 18. Reference links and verification limits

- [Repository baseline](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/tree/7d29774c8125a10a883894bca2f583c753c2b7ee): anchors the inspected source, not a claim about future branch state.
- [Brevo send transactional email](https://developers.brevo.com/docs/send-a-transactional-email): existing transport endpoint and accepted message behavior.
- [Brevo secured webhooks](https://developers.brevo.com/docs/secured-webhooks) and [create webhook](https://developers.brevo.com/reference/create-webhook): supported authentication/event configuration; verify the selected account configuration before activation.
- [Brevo transactional webhooks](https://developers.brevo.com/docs/transactional-webhooks): delivery-event shapes and provider message correlation.
- [Brevo batch idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails): documented bounded mechanism; not an unlimited exactly-once guarantee for this implementation.

External documentation was checked on 2026-10-18 for the specification. The Supabase changelog fetch was unavailable; no new Supabase feature/API is assumed or implemented. Repository Prisma governance governs this task; recheck current relevant database/provider documentation during implementation. Physical migration ledger, new behavior, email-client rendering and production readiness remain unverified until the prescribed authorized gates are actually executed.
