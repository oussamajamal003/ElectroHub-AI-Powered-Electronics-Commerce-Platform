# Delivery Tracking

> **Task 04.6 Leaflet + OpenStreetMap (2026-10-31): IMPLEMENTED on `feature/04.6-leaflet-osm`, uncommitted, awaiting Principal Architect review.** Evidence: [TASK_04.6_IMPLEMENTATION_EVIDENCE.md](../tasks/Phase-04/TASK_04.6_IMPLEMENTATION_EVIDENCE.md). On top of 04.5:
> - `GET /api/orders/:orderReference/delivery` gains an additive `map` field `{ origin, destination, path, pathKind }` (`null` when no hub is configured or the order is not trackable). The origin is the `DELIVERY_ORIGIN_LAT/LNG/LABEL` hub (all unset = map off; partial or out of range = the server refuses to boot). The destination is only the stored `Order.shippingLatitude/Longitude`, rounded to 3 dp. The path is the recorded LOCATION positions of the delivery, oldest first, at most 200, and only while the order is OUT_FOR_DELIVERY. There is no geocoding, no routing and no migration, and **no origin→destination line is ever drawn**.
> - The location panel keeps its text summary first, then lazy-loads a Leaflet map (`features/delivery/map/`) only when tiles are configured (`VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION`) and there is a courier position or a recorded path of 2+ points. Tile, init or chunk failures show a warning with Retry. Below 48rem the map stays inert until **Explore map**.
> - Production tiles are an open decision (D1): the public OSM tiles are for dev/review only, and the Phase 06 Nginx CSP `img-src` must add the chosen tile host.

> **Task 04.5 Delivery Tracking Foundation (2026-10-31): IMPLEMENTED on `feature/04.5-04.7-delivery-tracking`, uncommitted, awaiting architect review.** Evidence: [TASK_04.5_IMPLEMENTATION_EVIDENCE.md](../tasks/Phase-04/TASK_04.5_IMPLEMENTATION_EVIDENCE.md). What exists now:
> - Customer page `/orders/:orderReference/tracking` with an overview, a 4-stage stepper, an event timeline and a text-only location panel. Order Details shows **Track delivery** for paid CONFIRMED→DELIVERED orders.
> - Customer API `GET /api/orders/:orderReference/delivery` (owner-scoped, 60/min/user, `private, no-store`).
> - Admin API under `/api/admin/deliveries`: list, read, `POST …/start`, `PATCH …` with `expectedRevision` (409 on conflict). Admin pages at `/admin/deliveries` and `/admin/deliveries/:orderReference`.
> - Additive migration `20261031000000_delivery_tracking`: new columns on `deliveries` and a `delivery_events` table, one event per accepted change.
> - `Order.status` stays canonical. Status changes reuse `transitionFulfillment`: forward-only, with a successful payment checked inside the transaction.
> - **Not implemented (in 04.5):** the map (Leaflet/OSM, added by Task 04.6 above) and real-time updates or simulation (Socket.IO, Task 04.7). The customer page refreshes by polling every 60 s, and only while the order is out for delivery and the tab is visible.
>
> The earlier design note below is kept for history; where the two disagree, the implementation and evidence above are what the code does.

> **Tasks 04.5–04.7 design update (2026-10-31): DESIGNED / PROPOSED, not approved, not implemented.** No delivery code exists yet: `Delivery` is never written, and Order Details has no tracking control. The proposed contracts are in [TASK_04.5_04.7_DESIGN_ARCHITECTURE.md](../tasks/Phase-04/TASK_04.5_04.7_DESIGN_ARCHITECTURE.md) and [ADR-011 (proposed)](../ADR/ADR-011-delivery-tracking-realtime.md). They refine this document as follows:
> - Customers track at `/orders/:orderReference/tracking`, as a dedicated page linked from Order Details, not inside it.
> - The API uses `:orderReference`, not `:id` (§21).
> - `Order.status` stays canonical.
> - The route shown is recorded positions only. There is no routing or geocoding provider.
> - Simulated data is always labelled.
> - Arabic/RTL (§20) has no runtime in the app yet, so it is designed with logical properties and deferred.

## 1. Purpose

This document defines the real-time delivery-tracking functionality for ElectroHub.

Customers can monitor delivery progress from the order details page through:

- Order status timeline.
- Estimated arrival information.
- Delivery location.
- Route visualization.
- Real-time updates.

The system uses:

```text
Leaflet
OpenStreetMap
Socket.IO
```

---

## 2. Delivery Architecture

```text
Administrator
 ↓
React Admin Interface
 ↓
Backend Delivery Service
 ↓
Order / Delivery State
 ↓
Socket.IO
 ↓
Customer Order Details
 ↓
Leaflet + OpenStreetMap
```

The backend is authoritative for delivery state.

---

## 3. Customer Workflow

```text
User Opens Order
 ↓
Order Details
 ↓
Delivery Section
 ↓
Status Timeline
 ↓
Map
 ↓
Current Delivery Location
 ↓
Route Visualization
 ↓
Estimated Arrival
```

Customers may only track their own authorized orders.

---

## 4. Delivery States

The delivery timeline uses:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Conceptually:

```text
Confirmed
   ↓
Preparing
   ↓
Out for Delivery
   ↓
Delivered
```

The backend validates allowed state transitions.

---

## 5. Estimated Arrival

The order details page may display:

```text
Estimated Arrival
```

The estimate should be derived from the approved delivery logic.

Estimated arrival is informational and must not be presented as a guaranteed delivery time.

---

## 6. Map Integration

Leaflet provides the interactive map.

OpenStreetMap provides the map data/tiles where the approved deployment and usage requirements allow it.

Conceptually:

```text
Order
 ↓
Delivery Coordinates
 ↓
Leaflet
 ↓
OpenStreetMap
 ↓
Map Display
```

---

## 7. Route Visualization

Where implemented, the customer can see the delivery route.

```text
Origin
 ↓
Route
 ↓
Current Delivery Location
 ↓
Destination
```

Route visualization must use the approved mapping/routing implementation.

The route shown is informational and should not be treated as a guaranteed navigation path.

---

## 8. Delivery Location

The backend may maintain the current delivery location.

Relevant information may include:

```text
Latitude
Longitude
Updated At
```

Location data should only be exposed to authorized users.

---

## 9. Real-Time Updates

Socket.IO provides real-time delivery updates.

Flow:

```text
Admin Updates Delivery
 ↓
Backend
 ↓
Socket.IO Event
 ↓
Authorized Customer
 ↓
Order Details UI
```

The customer should not need to manually refresh the page for normal real-time updates.

---

## 10. Socket Event Security

Delivery events must be scoped to authorized users/orders.

Avoid broadcasting:

```text
Customer Data
Order Data
Location Data
```

to unrelated clients.

The server must determine which connected clients are allowed to receive an event.

---

## 11. Admin Workflow

Administrators can:

- View active deliveries.
- Update delivery status.
- Update delivery location.
- Review shipment progress.
- Monitor active orders.

Administrative delivery operations require server-side authorization.

---

## 12. Delivery Updates

An administrator may update:

```text
Status
Location
Estimated Arrival
```

The backend validates each update.

Invalid order or delivery identifiers must be rejected.

---

## 13. Delivery and Orders

Delivery status is part of the order lifecycle.

The order remains authoritative for:

```text
Order Number
Customer
Products
Payment
Order State
```

Delivery tracking extends the order with shipment progress.

---

## 14. Payment Independence

Delivery status must not replace payment status.

For example:

```text
Order:
Preparing

Payment:
Succeeded
```

The system must maintain these states separately.

---

## 15. Map Privacy

Delivery location is sensitive operational information.

The system should:

- Expose location only to authorized users.
- Avoid unnecessary location history.
- Avoid logging exact coordinates unnecessarily.
- Avoid broadcasting locations to unrelated clients.
- Retain only the location data required by the product.

---

## 16. Failure Handling

Possible failures include:

```text
Socket Disconnected
Map Load Failure
Location Update Failure
Invalid Coordinates
Delivery Service Failure
Network Failure
```

If real-time updates fail, the order details page should remain usable and may fall back to the latest known server state.

---

## 17. Socket Reconnection

When the Socket.IO connection is interrupted:

```text
Connection Lost
 ↓
Reconnect
 ↓
Re-authenticate / Rejoin Authorized Context
 ↓
Receive Current State
```

The application must not assume that missed real-time events were received.

The latest authoritative order/delivery state should be fetched when necessary.

---

## 18. Performance

Delivery tracking should:

- Send only relevant events.
- Avoid unnecessary map redraws.
- Update only changed coordinates/statuses.
- Avoid excessive location frequency.
- Load the map when required.
- Avoid unnecessary route recalculation.

---

## 19. Accessibility

Delivery tracking must provide accessible alternatives to visual map information.

The order details page should expose:

```text
Current Status
Estimated Arrival
Delivery State
```

A user should not need to understand the map visually to know the delivery status.

---

## 20. Localization and RTL

The delivery interface supports:

```text
English
Arabic / RTL
```

Map controls and surrounding UI should remain usable in RTL layouts.

Localized status labels and estimated-arrival information must follow the application's localization system.

---

## 21. API

Typical endpoints may include:

```text
GET   /api/orders/:id/delivery
PATCH /api/admin/orders/:id/delivery
```

Real-time events are delivered through Socket.IO.

The exact API contract follows the backend implementation and `API_GUIDELINES.md`.

---

## 22. Testing

Delivery tracking should cover:

```text
Order Delivery State
Status Transitions
Location Update
Invalid Location
Unauthorized Access
Socket Connection
Socket Reconnection
Real-Time Status Update
Real-Time Location Update
Map Rendering
Route Rendering
Estimated Arrival
Delivery Failure
Mobile Layout
RTL
Accessibility
```

Critical delivery workflows should be covered by E2E tests where practical.

---

## 23. Definition of Done

Delivery tracking is complete when:

- Delivery status timeline works.
- Customers can track authorized orders.
- Admins can update delivery progress.
- Location data is handled securely.
- Leaflet map works.
- OpenStreetMap integration works.
- Route visualization works where required.
- Estimated arrival is displayed.
- Socket.IO real-time updates work.
- Reconnection behavior is handled.
- Unauthorized users cannot access delivery information.
- Accessibility is verified.
- RTL/localization is verified.
- Tests pass.
- Documentation matches implementation.

---

## 24. Delivery Tracking Principle

> **Delivery tracking provides authorized, real-time shipment visibility while keeping order state server-authoritative and protecting customer location information.**
