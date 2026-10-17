# Task 03.6 — Stripe payment orchestration

This describes the implemented source. Completion and external verification are recorded separately in [Task 03.6 evidence](../tasks/Phase-03/TASK_03.6_IMPLEMENTATION_EVIDENCE.md). Stripe Test Mode only; no application deployment or live charge is authorized.

## Purchase boundary

Shipping → Delivery → provider-hosted Card entry → Review validation → explicit Place Order consent → Stripe manual authorization → PostgreSQL purchase commit → Stripe capture → persisted Paid confirmation.

Payment entry and Review Order validate without confirming. Server retrieval must prove the exact owned Test Mode intent, USD amount, CARD method, manual capture and full `requires_capture` authorization before purchase. Authorization does not mean Paid. One serializable transaction locks attempt → Cart → sorted Products/categories → sorted Inventory, revalidates current prices/availability/economic revision, creates immutable Order/items and PROCESSING Payment, decreases stock through InventoryService, clears Cart and records CAPTURE_PENDING. Every effect rolls back together. No provider call runs inside that transaction.

Full provider capture installs Payment SUCCEEDED and Order CONFIRMED. Before capture, Order AWAITING_CAPTURE is not fulfillment-ready. Existing legacy Orders without Payment remain UNPROCESSED and never acquire fabricated card metadata. Public `POST /api/orders` now returns `409 PAYMENT_REQUIRED`; it cannot create an unpaid purchase or consume stock. Historical 03.5 documentation/evidence remains the record of that previous contract.

## Owned API

All customer routes require the existing verified active CUSTOMER middleware. Ownership comes from authentication, not request fields. Responses use `{data: ...}` and errors `{error: {code,message}}`. Payment responses use `Cache-Control: no-store`.

| Route | Contract |
| --- | --- |
| `POST /api/checkout/payment-attempts` | Required UUID Idempotency-Key and strict `{shipping,deliveryMethod,paymentMethod:"CARD",expectedRevision}`. Server-calculated immutable amounts/items. 201 new setup, 200 compatible replay, 202 unresolved setup. Owner-only transient clientSecret appears only here. |
| `GET /api/checkout/payment-attempts/:attemptId` | Safe owned state, provider-status label, total/currency, committed flag, current Cart, recovery remainder, persisted Confirmation, and `recoveryActive` derived from an unexpired durable-worker lease. No secret. |
| `POST /api/checkout/payment-attempts/:attemptId/reconcile` | Strict empty body. Wake the same durable identity and return promptly; `recoveryActive` keeps Checkout locked while its worker is scheduled/leased. Provider/order work continues in the durable worker, not the request. 200 terminal outcome or 202 pending. |
| `POST /api/checkout/payment-attempts/:attemptId/cancel` | Strict empty body. Customer cancellation is limited to uncommitted attempts. Committed purchase returns a recovery conflict. |
| `POST /api/webhooks/stripe` | Exact raw application/json bytes, maximum 256 KiB, official timestamp/signature verification. No customer JWT. Atomic event-ID persistence and durable work wake-up precede acknowledgement. |

Validation failures are 400; stock/revision/idempotency/business conflicts 409; owner misses sanitized 404; temporary provider failures 503 or an already-persisted pending attempt. Authentication retains existing 401/403 semantics. Unknown fields, client totals/prices/stock/ownership and payment/status claims are rejected. Customer payment routes are rate limited to 120 requests per 15 minutes.

## Durability and recovery

PaymentAttempt is created before an Order, with owner/key/hash, immutable relational item snapshots, server Decimal totals/exact integer cents, expiry and a nullable unique active-Cart claim. Every provider operation uses a deterministic attempt/operation idempotency key. Capture uses the exact authorized total and Stripe's default final single capture; `final_capture` is omitted because this account does not enable multicapture.

One PaymentWork row per attempt drives the shared browser/webhook/runner processor. Each claim receives a UUID fence and 120-second lease. All financial writes verify that fence and unexpired lease. The runner handles at most ten due rows per batch, scans every five seconds, recovers expired leases and finishes its active batch on shutdown. Provider requests are bounded to ten seconds. Unknown failures back off from two seconds to five minutes, with twelve automatic failures leading to an explicit INCIDENT. User-requested reconciliation may safely resume the same identity; it never creates a second payment key. Checkout's navigation lock follows the server's active-worker projection: an unexpired lease remains locked; queued/unleased durable recovery is navigable and continues server-side.

Uncommitted input attempts expire after thirty minutes. An unknown provider-create result older than 23 hours becomes INCIDENT instead of risking Stripe idempotency-window expiry. Capture uncertainty retains committed state and stock; only fresh terminal cancellation or verified refund success permits compensation. Once-only compensation restores stock in a transaction, merges purchased intent with newer Cart quantities within current availability/line/quantity limits, cancels historical Order/Payment and records unmerged product IDs/quantities. History is never deleted by orchestration.

Unexpected capture without a compatible Order starts durable same-intent refund repair. Refund amount/identity is persisted before retry; successful refund is verified before releasing stock. Partial compensation rolls back, and stale workers cannot downgrade a newer result. Webhook payload order never decides financial state: every processor retrieves the current provider intent.

Stripe can subsequently report a previously successful refund as failed. A refund-event wake rechecks the same persisted refund identity. A late failure records INCIDENT and changes the persisted Payment to PROCESSING with PAYMENT_REFUND_INCIDENT, so Confirmation cannot continue claiming Refunded. Already-completed stock/Cart compensation is never repeated; the incident requires operational reconciliation, not a second refund request.

### Saved-purchase resume under duplicate requests

`POST /:id/resume` performs only a provider read, saved price/stock validation and an idempotent lifetime extension; it never creates, confirms, cancels or captures. Duplicate requests for one owned attempt on the same instance share a single execution keyed by customer and attempt, so they do not queue behind each other’s Serializable row locks (observed in DEV as two POSTs 35 ms apart, one ending 503 after 53 s, request IDs `324609cf…`/`402c0716…`). Nothing is retained after the execution settles and results are never shared across customers. Duplicates on different instances remain serialized by the attempt/work row locks; a serialization conflict is retried at most twice and each retry re-reads eligibility under fresh locks, so a concurrent recovery lease still fails closed with `PAYMENT_RECOVERY_PENDING`. Process-local sharing is an optimization, not the correctness mechanism.

Try Again, from Checkout's Payment Failed screen or from a Failed payments card in Cart, opens `/checkout?step=payment` with router state `retryPurchase: <attemptId>`. That renders the isolated saved-purchase Checkout (`SavedPurchaseCheckout`). It issues one resume request per customer and attempt: a remount (React StrictMode, Back/Forward, fast re-entry) joins the in-flight request instead of aborting it and posting again. The approved 25-second bound is unchanged. The page restores the saved items, shipping, delivery and verified total only from the resume response; it never reads or writes the active Cart or another scope's draft. The flow is Shipping/Delivery (read-only) → Payment → Review → Place Order: one Stripe confirmation and one reconcile of the same attempt, with no new setup or submission. A transport/5xx failure shows a recoverable "couldn't load" state; an authoritative 4xx refusal shows "can't be paid again right now". Neither is ever shown as a payment failure. The legacy `/account/payment-retry/:attemptId` route redirects to `/cart?purchase=<id>` without any request. See `docs/tasks/Phase-03/TASK_03.6_SCENARIO_1_FINAL_CLOSURE_HANDOFF.md` for the missing backend contracts (editing saved shipping/delivery, per-line prices, delivery re-eligibility).

## Frontend and security

CartProvider remains the sole Cart authority and final submission uses its mutation queue. Stale Cart reads are canceled and the server result is installed before navigation. A saved identity-scoped attempt is recovered before empty-Cart handling. Drafts contain only Shipping, delivery/method, completion flags and immutable attempt/request identity. Client secrets remain in component memory, never QueryClient or persistent storage. Redirect query parameters are scrubbed and never treated as payment success. Once a draft's payment is submitted (or its submission outcome is unconfirmed), its Shipping and delivery belong to that saved purchase: leaving Checkout, Return to Cart from a result screen, or a fresh mount resets the scope's draft, so Checkout B never starts pre-filled with Purchase A's address or delivery method (an unsubmitted draft for the same purchase keeps its fields). After Place Order or Check again settles, the saved-purchases list is re-read so Cart does not show a pre-reconcile projection. Payment outcome toasts are bottom-right from 768px up; on phones, where checkout actions stack full-width at the bottom, they appear below the sticky header so they never cover Review/Place Order (Scenarios 2–6 handoff, 2026-10-15).

The hosted Elements instance remains mounted through Payment/Review/Processing so Back/Edit does not discard secure entry. Shipping/Delivery remain sequential until Review first unlocks the stepper. Changed economic facts require canceling/reconciling the old attempt before fresh setup. Unknown outcomes cannot offer a second payment; decline/cancellation and completed compensation can be explicitly reviewed again.

Buy Now awaits the existing Cart add/reconcile flow, preserves other Cart lines and selected quantity, blocks duplicate clicks and enters the existing protected Checkout route. It does not create an Order/intent or consume stock itself.

Only safe provider-derived brand/last-four is persisted on Payment. No PAN/CVV/expiry, raw webhook payload, secret or full provider object is saved or logged. Raw webhook ingress precedes JSON parsing and request logging. Checkout/Order request logs omit query strings. Four new internal tables have RLS enabled and no PUBLIC/anon/authenticated access; backend ownership remains mandatory.

## Local operations and deployment handoff

Set backend `STRIPE_SECRET_KEY` to a Test Mode server secret, backend `STRIPE_WEBHOOK_SECRET` to the current listener/hosted endpoint secret, and frontend `VITE_STRIPE_PUBLISHABLE_KEY` to the matching Test Mode publishable key. Never copy values into documentation or source. The CLI listener supplies its local signing secret in memory; production uses its own hosted endpoint secret.

Backend: build, then `npm run payment:worker` for the durable runner; `--once` drains one bounded batch. `--attempt=<UUID>` is restricted to NODE_ENV=test disposable-fixture verification, at most ten IDs; it is not an HTTP capability or production option. The application and runner must use the same database/provider identity.

Phase 06 must deploy the reviewed backend and supervised runner, configure a public signed HTTPS webhook with only required intent/refund events, monitor pending/incident/backlog age, and repeat release/security/load gates. No such infrastructure deployment is claimed by local CLI forwarding.

Task 03.7 must reuse persisted Order snapshots/public reference/ownership and Payment projections. It must exclude AWAITING_CAPTURE/CANCELLED orders from fulfillment eligibility and never reconstruct historical prices or infer Paid from browser/Order status. Management UI, general refunds, tracking, emails/PDFs, PayPal, saved cards, tax/coupons and real-money processing remain deferred.

## Verification categories

Deterministic unit/API tests, signed fixture webhooks, real PostgreSQL transactions, real Stripe API, actual hosted browser entry, real CLI forwarding, restarted runner, intercepted UI/a11y and opened screenshots are separate evidence categories. A mocked UI success does not prove DB atomicity or a Stripe charge. PROD migration is allowed only after every mandatory DEV gate passes; PROD has no purchase/concurrency/seed fixtures.

## Real-acceptance corrections (2026-10-15)

First execution on real PostgreSQL 17 + Stripe Test Mode (see `docs/tasks/Phase-03/TASK_03.6_REAL_PAYMENT_POSTGRES_ACCEPTANCE.md`) led to three scoped fixes:
- PaymentWork scheduling uses the application clock everywhere. New work rows set `nextRunAt` explicitly at creation, and webhook ingestion stamps `stripe_events.createdAt` and the woken work's `nextRunAt`/`updatedAt` with one application-clock receipt time instead of `CURRENT_TIMESTAMP` (which followed the session TimeZone in these `timestamp without time zone` columns).
- When a new setup finds an abandoned, unsubmitted card entry still holding the Cart, the release path re-arms its work whether it is `DONE` or `READY` (never `LEASED`, retry accounting unchanged), so the provider readback and fenced cancellation actually run instead of returning `PAYMENT_RECOVERY_PENDING`.

Open questions raised by that acceptance (Architect): navigation while a Stripe next-action modal is open (D-4), refresh-token rotation after aborted responses (D-5, AUTH), and the documentation contradiction about compensation merging submitted purchases into the Cart (source never merges submitted purchases; it records the recovery remainder).
