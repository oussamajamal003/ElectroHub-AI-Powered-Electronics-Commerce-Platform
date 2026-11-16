# ADR-011: Delivery tracking state ownership, event log and real-time transport

Status: Proposed for Principal Architect review. Not approved and not implemented.
Date: 2026-10-31. Tasks: 04.5, 04.6, 04.7. Detail: `docs/tasks/Phase-04/TASK_04.5_04.7_DESIGN_ARCHITECTURE.md`.

## Context

`Order.status` already carries the fulfillment lifecycle, and `transitionFulfillment` (Task 03.8) is the forward-only, replay-safe writer that also enqueues commerce email. The `Delivery` model exists but is never written, and has no CANCELLED value. Customers need a durable timeline, location and ETA, and later live updates, without weakening payment authority or exposing coordinates.

## Decision

`Order.status` stays canonical. `Delivery.status` is a mirror written only by a new `DeliveryService` in the same transaction, which calls `transitionFulfillment` under the order row lock and requires a SUCCEEDED payment. Cancellation remains owned by PaymentService.

Every accepted change increments `Delivery.revision` and writes one immutable `DeliveryEvent` (`@@unique([deliveryId, revision])`). Optimistic concurrency uses `expectedRevision`. There is no backfill, and history is never fabricated.

Maps use Leaflet with OSM-compatible tiles only. There is no geocoding and no routing provider in the MVP. The only polylines are through recorded positions, or an explicitly labelled simulated fixture.

Real-time uses a Socket.IO `/delivery` namespace on the existing HTTP server, authenticated with the access JWT. Rooms are server-built from order UUIDs after an ownership check. Events carry revisions and are published only after commit. Clients always re-read REST on reconnect or when they detect a revision gap. Socket.IO is a hint channel, not a store.

## Consequences

- Delivery cannot drift from Order. Concurrent admin edits fail loudly.
- Customers see only recorded facts.
- A process crash between commit and emit loses one event, which clients recover by refetching.
- Horizontal scaling later needs the Redis adapter and sticky sessions.
- Production tiles need a policy-compliant provider.

## Alternatives rejected

- Making `Delivery.status` authoritative. That creates two writers and contradicting states.
- Creating Delivery at payment success. That touches the Stripe path.
- Socket.IO connection-state recovery as a delivery guarantee. It isn't one.
- A third-party routing API. It adds cost and privacy exposure, and has no approved provider.
