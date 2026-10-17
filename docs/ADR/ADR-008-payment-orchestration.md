# ADR-008 — Stripe authorization, purchase commit and durable capture

Status: implemented and DEV/PROD migration gates verified; independent review and Phase 06 deployment remain. Task 03.6, 2026-10-07.

## Decision

Use the existing Order/OrderItem/Payment/Inventory core with Stripe Test Mode PaymentIntents, manual capture and CARD-only hosted Payment Element. Payment entry and Review validation never authorize. Final explicit Review consent confirms with Stripe; only a server-retrieved full `requires_capture` authorization permits the existing purchase transaction.

Owned PaymentAttempt and relational immutable items exist before Order creation. A nullable unique active-Cart claim prevents distinct active attempts from buying one Cart. User/key/hash, provider intent, Order link and refund identities are unique. The server owns Decimal totals and exact integer cents. No client secret or raw provider/card payload is persisted.

Attempt → Cart → sorted Product/category → sorted Inventory is the locking convention. One bounded serializable transaction creates Order/items/Payment, decrements stock through InventoryService, clears Cart and records capture-pending work. Order AWAITING_CAPTURE is not fulfillment-ready; CONFIRMED plus Payment SUCCEEDED is only installed after full provider capture. The old unpaid public creation path returns PAYMENT_REQUIRED. Legacy unpaid Orders remain readable.

There is no distributed transaction. Provider calls occur outside DB transactions. One persistent leased PaymentWork state machine per attempt drives create, reconcile, capture, cancel, refund and compensation. Deterministic attempt/operation Stripe keys remain stable across retries. Leases last 120 seconds; claims have UUID fencing tokens checked in every financial database transition, including the purchase commit. Provider requests time out after 10 seconds. Runner scans at most ten due rows per five-second batch, handles expired leases on restart and finishes active work on shutdown. Unknown errors use exponential 2-second to 5-minute backoff, at most twelve failures; exhaustion is a visible INCIDENT. Ordinary pending/input scans do not consume failure retries. Input attempts expire after thirty minutes; actual authorization expiry comes from Stripe. No new provider create is permitted beyond a 23-hour uncertain-create age.

Cancellation is durably requested before any provider cancel. After commit cancellation is not a public customer operation. Capture timeout retains CAPTURE_PENDING; fresh provider retrieval reconciles the same intent. Inventory is restored only after terminal provider cancellation or verified refund success. Compensation locks and marks the attempt once, restores Inventory through its existing primitive, merges purchased intent without overwriting newer Cart quantities, and retains bounded unmerged IDs/quantities. Order history is canceled, never deleted. A successful captured intent without a compatible Order enters a durable same-intent refund repair; no blind Order/stock mutation.

Raw signed webhook acceptance precedes JSON parsing. Only event identity, safe type/binding and durable disposition are stored. Duplicate delivery acknowledges the stored identity; accepted events wake the same work state machine. Current retrieved provider truth governs all transitions, rather than webhook payload order. Browser status/reconcile/cancel/setup are authenticated and owner-scoped; setup alone returns a transient secret with no-store.

Cart deletion retains attempt audit records via nullable FK plus immutable original Cart identity. User/Order/Product/payment evidence uses restrictive deletion. New internal tables enable RLS and revoke public/anon/authenticated access; ElectroHub JWT ownership is enforced by backend APIs.

## Deferred operations

No live charges, PayPal, saved cards, tax/coupons, general refunds, order-management UI, fulfillment, email/PDF or hosted infrastructure. Phase 06 must deploy the runner and backend, configure the public signed webhook with its own hosted secret, and repeat release/security/load checks. Local CLI forwarding and a local backend connected to DEV are not an application deployment.

## Evidence

Implementation and deployment status — 2026-10-07: the 03.6 implementation and its forward migration are applied and physically verified in DEV and PROD. PROD verification was read-only after migration; no production fixtures, seeds, or purchases ran. DEV transaction, provider, browser, webhook, retry/recovery, and cleanup evidence is recorded in the task evidence document. This status is not an independent architecture approval and does not mean the application, worker, or webhook has been deployed; those infrastructure operations remain Phase 06 work.

Deterministic, real PostgreSQL, real Stripe/CLI, browser and migration gates are recorded individually in Task 03.6 evidence; source implementation alone does not establish release completion. Signed webhook acceptance uses one atomic parameterized PostgreSQL statement for event identity and work wake-up, preserving live leases and avoiding interactive-transaction round-trip overhead. The reviewed forward migration was applied to DEV after its gates passed and then to PROD; PROD verification remained read-only, with no purchase fixtures, seed, or test customer data.
