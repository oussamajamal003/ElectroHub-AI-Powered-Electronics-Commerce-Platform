# ELECTROHUB — TASKS 04.5 / 04.6 / 04.7 — INTEGRATED DESIGN & ARCHITECTURE

**Phase:** 04 — AI & Real-Time Features
**Tasks:** 04.5 Delivery Tracking · 04.6 Leaflet + OpenStreetMap · 04.7 Socket.IO Real-Time Delivery
**Document status:** DESIGNED / PROPOSED. It is **not approved and not implemented.** It awaits Principal Architect review. No application code, schema, migration, dependency or external system was changed to produce it.
**Prepared:** 2026-10-31
**Feature branch:** `feature/04.5-04.7-delivery-tracking` (local HEAD = `develop` = `origin/develop` = `origin/feature/04.5-04.7-delivery-tracking` = `1cd550a`, the merge of Task 04.4 PR #39)
**Companion documents:** [Design System & Handoff](TASK_04.5_04.7_DESIGN_SYSTEM_HANDOFF.md) · milestone specs [04.5](TASK_04.5_DELIVERY_TRACKING.md) · [04.6](TASK_04.6_LEAFLET_OSM.md) · [04.7](TASK_04.7_SOCKET_IO.md) · [ADR-011 (proposed)](../../ADR/ADR-011-delivery-tracking-realtime.md)
**Design-system artifact:** https://claude.ai/artifact/9uEiC6tbMUUTPViergzFCd (private until shared by the owner)

Status labels used here: **EXISTING** (verified in source at `1cd550a`), **PROPOSED** (this design), **APPROVED** and **IMPLEMENTED** (neither applies yet).

---

## 1. Verified baseline (EXISTING)

| Fact | Evidence |
|---|---|
| `Order.status` enum: AWAITING_CAPTURE, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED | `apps/backend/prisma/schema.prisma` `enum OrderStatus` |
| `Delivery` 1:0..1 with Order (`orderId @unique`), `status DeliveryStatus` (4 values, no CANCELLED), `trackingCode? @unique`, `latitude/longitude Decimal(9,6)?`, `estimatedAt?`, `deliveredAt?`, `onDelete: Cascade` | `model Delivery` |
| Order carries `shippingLatitude/Longitude Decimal(9,6)?` and the checkout promise `estimatedDeliveryStart/End @db.Date` | `model Order` |
| **No code creates or updates `Delivery`.** The checkout live test asserts `prisma.delivery.count(...) === 0` | `checkout.live.test.ts:157` |
| `shippingLatitude/Longitude` are never populated by checkout. Only account deletion nulls them | `account-deletion.service.ts:82` |
| A forward-only fulfillment writer already exists: `transitionFulfillment(tx, { orderId, to })` locks the order row `FOR UPDATE`, allows only CONFIRMED→PREPARING→OUT_FOR_DELIVERY→DELIVERED, treats a replay as a no-op, and enqueues the commerce email in the same transaction. No route calls it yet ("future fulfillment writer (Task 05.4)") | `services/commerce-email.producer.ts:154-187` |
| Payment projection: `paymentState` is PAID only when `Payment.status === 'SUCCEEDED'` | `services/order.service.ts:27` |
| Customer order routes: `router.use(['/checkout','/orders'], requireAuth, requireRole('CUSTOMER'), Cache-Control: no-store)`. `GET /api/orders/:orderReference` returns 404/400 for not-owned or invalid references. Reference format: `ORD-<UUID upper>` | `routes/checkout.routes.ts:14,148`, `order.service.ts:26` |
| Admin route guard pattern: `requireAuth, requireRole('ADMIN')`, `Cache-Control: private, no-store` | `routes/product-media.routes.ts:12` |
| Auth: Bearer access JWT, re-checked against `User.isActive` per request; refresh token in the HttpOnly cookie `electrohub_refresh` | `middleware/auth.ts`, `routes/auth.routes.ts` |
| Frontend holds the access token in module memory (`setAccessToken`) and refreshes it inside `apiClient` | `apps/frontend/src/lib/api.ts:10-140` |
| Order Details exists at `/orders/:orderReference`. **It has no Track Delivery control**, and its test asserts that | `features/orders/OrderDetailsPage.tsx`, `OrderDetailsPage.test.tsx:64` |
| The customer header has a "Track Delivery" link to `/orders`. The Account page has a "Delivery Tracking" tile | `layouts/CustomerLayout.tsx:73`, `pages/customer/AccountPage.tsx:92` |
| `apps/backend/src/sockets/` contains only `.gitkeep`. There are no `socket.io`, `socket.io-client` or `leaflet` dependencies | `git ls-files`, `package.json` |
| The HTTP server is `app.listen(...)`, exported as `server` (attachable by Socket.IO) | `apps/backend/src/server.ts:42` |
| `helmet()` runs with default CSP on the API | `apps/backend/src/app.ts:41` |
| Query keys are account-scoped: `queryKeys.orders.detail(userId, reference)` | `apps/frontend/src/lib/query.ts` |
| Design tokens: `_variables.scss` (all radii 0, Poppins/JetBrains Mono, 4px spacing, breakpoints 640/768/1024/1280/1536) | `apps/frontend/src/styles/abstracts/_variables.scss` |

### 1.1 Contradictions found (reported, not silently resolved)

1. **`assets/figma/` does not exist** in the repository. Delivery Figma work is **deferred to Phase 05 by owner decision**; the Claude interactive artifact and the design handoff are the current visual reference.
2. **The prompt's "existing Order Details screen with a Track Delivery button" is not the shipped code.** The shipped page has no tracking control, and its test asserts absence. The design adds it deliberately (§6.1 of the handoff).
3. **`DELIVERY_TRACKING.md` §21 proposes `/api/orders/:id/delivery`.** All existing customer order routes use `:orderReference`, so this design uses `:orderReference`.
4. **`origin/main` is an unrelated single "Initial commit"** with no merge base with `develop`. The approved integration branch is `develop`. `git merge-base HEAD main` fails because there is no local `main`.
5. **The shared `Card` primitive** references undefined tokens (`$spacing-1-5`, `$font-family-sans`) and has no consumers. Delivery reuses the Order Details `.card` pattern instead.
6. **RTL/Arabic** is required by `DELIVERY_TRACKING.md` §20, but the frontend has no i18n or RTL runtime. The design uses logical CSS properties and states the gap.

---

## 2. Architecture overview (PROPOSED)

```text
Admin UI (/admin/deliveries)           Customer UI (/orders/:ref/tracking)
        │ PATCH/POST (Bearer, ADMIN)           │ GET (Bearer, CUSTOMER, owner)      ▲ socket "delivery:updated" (04.7)
        ▼                                      ▼                                    │
  delivery.admin.routes ──► delivery.controller ──► delivery.validator (zod)        │
                                   │                                                 │
                                   ▼                                                 │
                        DeliveryService (state machine, eligibility)                │
                                   │  prisma.$transaction                            │
                   ┌───────────────┼────────────────┬──────────────────┐             │
                   ▼               ▼                ▼                  ▼             │
             orders FOR UPDATE  transitionFulfillment  Delivery upsert   DeliveryEvent insert
             (payment check)    (EXISTING; Order.status  (+revision)      (+revision, @@unique)
                                + commerce email outbox)                             │
                                   │ COMMIT                                          │
                                   ▼                                                 │
                       DeliveryPublisher.afterCommit(snapshot)  ── 04.7 ── Socket.IO /delivery ns
                                                                       room delivery:order:<orderId>
```

**The database is authoritative.** REST reads are the source of truth. Socket events are a hint that carries a revision, and a client that sees a gap or reconnects re-reads REST.

---

## 3. Canonical state ownership (PROPOSED)

**`Order.status` remains the single authoritative fulfillment state.** `Delivery.status` is a mirror kept for the existing index, and it is written **only** by `DeliveryService` inside the same transaction.

Invariants (asserted in the service and in integration tests):

- **I1.** If a Delivery exists and `Order.status ∈ {CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED}`, then `Delivery.status = Order.status`.
- **I2.** `Order.status` changes for fulfillment happen only through `transitionFulfillment` (forward, one step, replay-safe).
- **I3.** No fulfillment write is allowed unless `Payment.status = 'SUCCEEDED'`. Delivery state never implies payment, and payment state never changes from delivery code.
- **I4.** `Delivery.deliveredAt` is set exactly once, in the transaction that moves to DELIVERED. DELIVERED is terminal.
- **I5.** CANCELLED is owned by `PaymentService.compensate` (EXISTING). Delivery code never sets or clears it. If an order is CANCELLED, every delivery write is rejected, and the Delivery row keeps its last mirrored status (the enum has no CANCELLED, and none is added).
- **I6.** `Delivery.revision` increases by exactly 1 per accepted change, and every accepted change writes exactly one DeliveryEvent with that revision.
- **I7.** AWAITING_CAPTURE orders cannot have a Delivery row.

### 3.1 Transition table

| From (Order.status) | Allowed delivery action | Result |
|---|---|---|
| AWAITING_CAPTURE | none | 409 `DELIVERY_PAYMENT_INELIGIBLE` |
| CONFIRMED (paid), no Delivery | `start` | Delivery created (status CONFIRMED, reference generated), event TRACKING_STARTED, rev 1 |
| CONFIRMED | `status: PREPARING`; location/ETA edits | via transitionFulfillment; STATUS_CHANGED |
| PREPARING | `status: OUT_FOR_DELIVERY`; location/ETA | STATUS_CHANGED |
| OUT_FOR_DELIVERY | `status: DELIVERED`; location/ETA | STATUS_CHANGED + `deliveredAt`; ETA and live location frozen |
| DELIVERED | none (terminal) | 409 `DELIVERY_TERMINAL` |
| CANCELLED | none | 409 `DELIVERY_ORDER_CANCELLED` |
| any | `status` equal to current | no-op on status (other fields may still apply). A request that changes nothing returns 200 with the unchanged snapshot and writes no event |
| any | backward or skip (e.g. CONFIRMED→OUT_FOR_DELIVERY) | 409 `ORDER_TRANSITION_INVALID` (EXISTING code) |
| CONFIRMED (paid) but **legacy, no SUCCEEDED payment** | none | 409 `DELIVERY_PAYMENT_INELIGIBLE`. Never auto-treated as paid |

**Paid order in PREPARING / OUT_FOR_DELIVERY with no Delivery row** (possible only through future tooling): `start` is allowed. It creates a Delivery mirroring the current status, and TRACKING_STARTED records the current status. **No earlier milestones are fabricated.**

**Location and ETA edits** are allowed in CONFIRMED, PREPARING and OUT_FOR_DELIVERY. A courier location is accepted only in OUT_FOR_DELIVERY, because a location before dispatch means nothing to a customer. ETA is accepted in all three.

---

## 4. Database design (PROPOSED — not migrated)

### 4.1 Schema diff

```prisma
enum DeliveryEventType {
  TRACKING_STARTED
  STATUS_CHANGED
  LOCATION_UPDATED
  LOCATION_CLEARED
  ETA_UPDATED
  ETA_CLEARED
  SIMULATION_STARTED
  SIMULATION_STOPPED
}

enum DeliveryEventSource {
  ADMIN
  SIMULATION
  SYSTEM
}

enum DeliveryEventChange {
  STATUS
  LOCATION
  ETA
}

enum DeliveryLocationSource {
  MANUAL
  SIMULATED
}

model Delivery {
  // EXISTING fields unchanged: id, orderId @unique, status, trackingCode? @unique, latitude?, longitude?, estimatedAt?, deliveredAt?, order, createdAt, updatedAt
  revision          Int                     @default(0)
  locationLabel     String?                 @db.VarChar(80)
  locationSource    DeliveryLocationSource?
  locationUpdatedAt DateTime?
  etaUpdatedAt      DateTime?
  isSimulated       Boolean                 @default(false)
  events            DeliveryEvent[]

  @@index([status])               // EXISTING
  @@index([status, updatedAt])    // admin list "active deliveries"
}

model DeliveryEvent {
  id          String              @id @default(uuid()) @db.Uuid
  deliveryId  String              @db.Uuid
  revision    Int
  type        DeliveryEventType
  changes     DeliveryEventChange[]
  source      DeliveryEventSource
  fromStatus  OrderStatus?
  toStatus    OrderStatus?
  latitude    Decimal?            @db.Decimal(9, 6)
  longitude   Decimal?            @db.Decimal(9, 6)
  estimatedAt DateTime?
  actorUserId String?             @db.Uuid
  note        String?             @db.VarChar(280)
  occurredAt  DateTime            @default(now())
  createdAt   DateTime            @default(now())

  delivery Delivery @relation(fields: [deliveryId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  actor    User?    @relation("DeliveryEventActor", fields: [actorUserId], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@unique([deliveryId, revision])
  @@index([deliveryId, occurredAt])
  @@index([type, occurredAt])
  @@map("delivery_events")
}
// User gains: deliveryEvents DeliveryEvent[] @relation("DeliveryEventActor")
```

SQL-level guards in the migration (Prisma can't express these): `CHECK (revision >= 0)` on deliveries. `CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)` on both tables (NULL passes). `CHECK ((latitude IS NULL) = (longitude IS NULL))`. `CHECK (revision >= 1)` on delivery_events.

### 4.2 Event rules

- **Immutable.** Rows are never updated except by the retention and account-deletion scrubs below, which null coordinates and notes only.
- **Ordering.** Use `revision` within a delivery, which is total and gap-free. `occurredAt` is for display.
- **Duplicate protection.** `@@unique([deliveryId, revision])` together with the `expectedRevision` check under the order row lock.
- **Exposure.** Customers receive `{ id, type, occurredAt, toStatus?, estimatedAt? }` for TRACKING_STARTED, STATUS_CHANGED, ETA_UPDATED and ETA_CLEARED only. `actorUserId`, `note`, `source` and event coordinates are admin-only.
- **Retention and minimisation.** A Phase 06 retention job nulls `latitude/longitude` on LOCATION_UPDATED events 30 days after `deliveredAt` (or after cancellation), and nulls `Delivery.latitude/longitude/locationLabel` at the same point. Until that job exists, the gap is recorded as a known limitation. Account deletion (EXISTING `account-deletion.service.ts`) is extended in 04.5 to null coordinates and notes on the user's DeliveryEvents and Delivery rows, the same way it already nulls `shippingLatitude`.
- **Volume.** Simulation writes at most one LOCATION_UPDATED per 5 s per delivery, capped at 240 per run.

### 4.3 Migration plan

- **Name:** `2026110X000000_delivery_tracking` (the timestamp is set at implementation).
- **Steps:** create 4 enums. `ALTER TABLE deliveries ADD COLUMN` × 6, all nullable or defaulted, so no table rewrite on PostgreSQL 11+. Add CHECK constraints. Create `delivery_events` with FKs and indexes. Add the `deliveries(status, "updatedAt")` index.
- **Backward compatible:** existing code never reads or writes deliveries, so the old app runs against the new schema unchanged.
- **Backfill: none.** Existing orders get no Delivery and no events. Their tracking page shows `NOT_STARTED`, or `PAYMENT_PENDING` for legacy unpaid orders. **Historical events are never fabricated.**
- **Rollback:** before any write, `DROP TABLE delivery_events`, drop the added columns and the enums (a down SQL script ships alongside, for manual use). After writes, roll back by deploying the previous app version and leaving the additive schema in place.
- **QA:** `prisma migrate diff` shows no drift. Apply to a disposable DB. Run `prisma validate`. Run constraint tests: an out-of-range coordinate is rejected, and a duplicate revision is rejected. Applying to shared DEV/PROD needs separate explicit authorization (AGENTS.md §7, §22).

### 4.4 Commerce integrity

Delivery code reads Order, Payment and OrderItem and writes only `orders.status` (via the existing `transitionFulfillment`), `deliveries` and `delivery_events`. It never touches order items, price snapshots, products, inventory, carts, `payments`, `payment_attempts`, Stripe objects or documents. A unit test asserts the transaction's Prisma call surface.

---

## 5. REST API contracts (PROPOSED)

Conventions follow the existing routes: zod validation, `AppError(message, status, code)`, error envelope from `errorHandler`, `Cache-Control: no-store` on customer routes and `private, no-store` on admin routes. Reference parameters are validated as `^ORD-[0-9A-F-]{36}$` and resolved to an order id server-side.

### 5.1 `GET /api/orders/:orderReference/delivery` (customer, 04.5)

Mounted inside the existing `checkout.routes.ts` `/orders` guard (CUSTOMER, no-store). Ownership is `order.userId === req.user.userId`. Otherwise **404 `ORDER_NOT_FOUND`**, the same as Order Details, so existence never leaks. An ADMIN token gets 403 from the existing `requireRole('CUSTOMER')`.

```ts
type DeliveryAvailability = 'AVAILABLE' | 'NOT_STARTED' | 'PAYMENT_PENDING' | 'CANCELLED';
interface CustomerDeliverySnapshot {
  orderReference: string;
  availability: DeliveryAvailability;  // PAYMENT_PENDING: AWAITING_CAPTURE or paymentState !== 'PAID'
  status: FulfillmentStatus;           // Order.status (canonical)
  paymentState: OrderPaymentState;     // same projection as Order Details
  revision: number;                    // 0 when no Delivery
  trackingReference: string | null;
  deliveryMethod: 'STANDARD' | 'EXPRESS' | 'OVERNIGHT';
  eta: { estimatedAt: string | null; updatedAt: string | null; promisedStart: string; promisedEnd: string };
  location: { latitude: number; longitude: number; label: string | null; updatedAt: string;
              source: 'MANUAL' | 'SIMULATED' } | null;   // only while OUT_FOR_DELIVERY
  deliveredAt: string | null;
  isSimulated: boolean;
  timeline: { id: string; type: 'TRACKING_STARTED' | 'STATUS_CHANGED' | 'ETA_UPDATED' | 'ETA_CLEARED';  // derived per changed aspect
              occurredAt: string; status?: FulfillmentStatus; estimatedAt?: string | null }[]; // ≤ 50, newest first
  serverTime: string;                  // lets the client judge staleness without trusting its clock
  map?: CustomerDeliveryMap;           // added additively in 04.6 (§7.3)
}
```

| Case | Status |
|---|---|
| owner, any state | 200 + snapshot (availability tells the UI what to render) |
| malformed reference | 400 `VALIDATION_ERROR` (UI treats it like 404, as Order Details does) |
| not found / not owner | 404 `ORDER_NOT_FOUND` |
| no / expired token | 401 (existing) |
| rate limit | reuse the order-read limiter, 60/min/user, 429 |

### 5.2 Admin (04.5)

New file `routes/delivery.admin.routes.ts`, `router.use('/admin/deliveries', requireAuth, requireRole('ADMIN'), private no-store)` plus `/admin/orders/:orderReference/delivery`.

| Method & path | Purpose | Body | Success |
|---|---|---|---|
| `GET /api/admin/deliveries?status=&page=&pageSize=` | paid, non-cancelled orders, newest first, pageSize ≤ 50 | — | 200 `{ data: AdminDeliveryRow[], meta }` |
| `GET /api/admin/orders/:ref/delivery` | admin snapshot | — | 200 `AdminDeliverySnapshot` (customer fields + `orderId`, `history[]` with actor email, source, note, coordinates; `allowedNextStatus`; `paymentEligible`) |
| `POST /api/admin/orders/:ref/delivery` | start tracking | `{}` | 201 snapshot, or 200 if it already exists (idempotent) |
| `PATCH /api/admin/orders/:ref/delivery` | update | see below | 200 snapshot |

```ts
// PATCH body (zod, .strict())
{ expectedRevision: number;                       // int ≥ 1
  status?: 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  location?: { latitude: number; longitude: number; label?: string | null } | null;  // null = clear
  estimatedAt?: string | null;                    // ISO; now-5min ≤ t ≤ now+30d; null = clear
  note?: string }                                 // ≤ 280, trimmed, stored admin-only
// at least one of status/location/estimatedAt required
```

Errors: 400 `VALIDATION_ERROR` · 404 `ORDER_NOT_FOUND` · 404 `DELIVERY_NOT_STARTED` (PATCH before POST) · 409 `DELIVERY_REVISION_CONFLICT` (body includes the current `snapshot`) · 409 `DELIVERY_PAYMENT_INELIGIBLE` · 409 `DELIVERY_ORDER_CANCELLED` · 409 `DELIVERY_TERMINAL` · 409 `ORDER_TRANSITION_INVALID` · 409 `DELIVERY_LOCATION_NOT_ALLOWED` (location before OUT_FOR_DELIVERY) · 429.

**Idempotency** comes from `expectedRevision`: a replayed request after success hits 409 with the current snapshot, and the UI shows "already applied". `POST` start is naturally idempotent.

**Concurrency:** both writes run in one transaction that starts with `SELECT … FROM orders WHERE id=$1 FOR UPDATE`. That is the same lock `transitionFulfillment` and payment compensation take, so delivery writes and cancellation serialize.

### 5.3 Transaction (one PATCH)

1. Re-validate the ADMIN role (middleware) and the body (zod).
2. `BEGIN`. Lock the order row and load `status`, `payment.status`, and the Delivery `FOR UPDATE`.
3. Check: the order exists, it is not CANCELLED, `payment.status = SUCCEEDED`, a Delivery exists, `delivery.revision = expectedRevision`, and the order is not DELIVERED.
4. If `status` is present, call `transitionFulfillment(tx, { orderId, to })` (EXISTING; also enqueues the commerce email), then mirror `Delivery.status`, plus `deliveredAt` when DELIVERED.
5. Apply location (OUT_FOR_DELIVERY only) and ETA. Set `locationUpdatedAt` / `etaUpdatedAt = now()`.
6. If nothing changed, return 200 unchanged with no event and no revision bump.
7. Increment `revision` by 1 and insert **exactly one** DeliveryEvent: one accepted request is one revision. `type` is the primary change (precedence STATUS_CHANGED > LOCATION_* > ETA_*), and `changes[]` lists every aspect changed (`STATUS`, `LOCATION`, `ETA`) with its values on the same row. The customer projection emits one timeline entry per customer-visible aspect (ids `<eventId>:status`, `<eventId>:eta`).
8. `COMMIT`. Read back the snapshot. Then (04.7) `DeliveryPublisher.afterCommit(orderId, snapshot)`. **Nothing is published before commit or on rollback.**

### 5.4 Tracking reference

Generated server-side at `start` as `EH-TRK-` + 10 Crockford base32 characters from `crypto.randomBytes`, stored in the existing `trackingCode @unique` column, with a retry on a unique collision. It is display-only, is not a credential, never appears in URLs, and grants nothing.

---

## 6. Frontend architecture (PROPOSED)

```text
apps/frontend/src/features/delivery/
  types.ts                 CustomerDeliverySnapshot, DeliveryAvailability (mirror of §5.1)
  api.ts                   getDelivery(ref, signal)
  presentation.ts          eventCopy(type,status), isStale(location, serverTime), etaText(...)
  DeliveryTrackingPage.tsx (+ .module.scss)  route /orders/:orderReference/tracking, wrapped in OrdersAccessGate
  components/DeliveryProgressStepper.tsx | DeliveryOverviewCard.tsx | DeliveryTimeline.tsx | DeliveryMapPanel.tsx
  map/ (04.6)              LeafletDeliveryMap.tsx (lazy), markers.ts, useLeafletMap.ts
  realtime/ (04.7)         deliverySocket.ts, useDeliveryLiveUpdates.ts, ConnectionStatusIndicator.tsx
apps/frontend/src/features/adminDelivery/        AdminDeliveriesPage.tsx, AdminDeliveryDetailPage.tsx, AdminDeliveryUpdatePanel.tsx
apps/frontend/src/lib/query.ts                    + delivery: { snapshot: (userId, ref) => ['delivery','snapshot',userId,ref],
                                                               admin: (ref) => ['delivery','admin',ref], adminList: (status,page) => [...] }
apps/frontend/src/routes/index.tsx                + /orders/:orderReference/tracking ; /admin/deliveries ; /admin/deliveries/:orderReference
apps/frontend/src/features/orders/OrderDetailsPage.tsx  + TrackDeliveryAction link + one status line
```

Query policy: `staleTime: 10_000`, `retry: false` (matching Order Details), `refetchOnWindowFocus: true` for this query only. In 04.5 (before sockets exist), it polls `refetchInterval: 60_000` only while `status === 'OUT_FOR_DELIVERY'` and the tab is visible. 04.7 removes the polling while the socket is subscribed.

---

## 7. Task 04.6 — map and route (PROPOSED)

### 7.1 Technology decision

`leaflet@1.9.4` + `@types/leaflet`, used directly through a small `useLeafletMap` hook (no `react-leaflet`: one dependency fewer, and full control over marker updates and cleanup). Lazy-loaded with `React.lazy` so the Leaflet chunk and CSS load only on the tracking page, and only when the snapshot has something to draw.

| Concern | Provider | Decision |
|---|---|---|
| Rendering | Leaflet (client) | ✔ |
| Tiles | OSM-compatible raster XYZ, configured by `VITE_MAP_TILE_URL` + `VITE_MAP_ATTRIBUTION` | **Dev/review:** `tile.openstreetmap.org` within the OSMF Tile Usage Policy (attribution visible, low volume, no prefetch, valid Referer). **Production: an open decision (§12, D1)**: self-hosted or a commercial OSM-based provider. The public OSM tiles are not a production CDN. |
| Geocoding | none | Addresses are **never** sent to a geocoder. The destination pin appears only when `Order.shippingLatitude/Longitude` are already stored, which checkout does not do today, so usually no pin. |
| Routing | none in MVP | **No routing provider.** The line drawn is the polyline through **recorded** positions ("Recorded positions"). For simulation, it is the approved fixture's geometry, drawn dashed and labelled "Simulated route". **No origin→destination straight line is ever drawn.** A real road route needs D2 approval (provider, cost, privacy review). |

### 7.2 Origin

A single dispatch hub from server config (`DELIVERY_ORIGIN_LAT/LNG/LABEL`), validated at boot and the same for all orders. Clearly fictional demo values are used in dev.

### 7.3 Contract addition (additive to §5.1)

```ts
interface CustomerDeliveryMap {
  origin: { latitude: number; longitude: number; label: string };
  destination: { latitude: number; longitude: number } | null;   // owner's stored coords rounded to 3 dp (~110 m)
  path: [number, number][];                                       // recorded LOCATION_UPDATED points this delivery, server-thinned to ≤ 200, oldest→newest
  pathKind: 'RECORDED' | 'SIMULATED_FIXTURE' | 'NONE';
}
```

The server validates every coordinate against the ranges again before emitting. The client also discards non-finite or out-of-range points and renders the "Route not available" state if nothing valid remains.

### 7.4 Privacy

- Coordinates appear only in owner-scoped JSON responses and owner-scoped socket rooms. They never appear in URLs, query strings, `logger` calls or Sentry breadcrumbs (`requestLogger` already logs paths only; the delivery validator error messages exclude values).
- **What tile providers see:** the tile x/y/z the viewer pans to, plus IP and Referer. That reveals an approximate area, which is inherent to any web map, and is documented in the privacy note. No addresses or order data are sent.
- CSP: the frontend's Nginx CSP `img-src` must add the tile host (Phase 06 config; dev has no CSP on Vite).

### 7.5 Map acceptance highlights

Attribution is always visible. Markers fit on load. Tile failure falls back to text plus Retry. Mobile starts non-interactive and enables "Explore map". The keyboard can focus the map and pan and zoom it. The text summary carries all the facts. Simulated data is always labelled.

---

## 8. Task 04.7 — Socket.IO (PROPOSED)

### 8.1 Server

`socket.io@4.8.x` attached to the exported `server` in `server.ts`, at namespace **`/delivery`**, path `/socket.io`, `cors.origin` = the same allowlist as Express `cors(...)`, `transports: ['websocket','polling']`, `maxHttpBufferSize: 4 KB`, `pingInterval 25 s / pingTimeout 20 s`. Code lives in `apps/backend/src/sockets/` (`delivery.gateway.ts`, `socket-auth.ts`, `delivery.publisher.ts`).

### 8.2 Authentication and rooms

- **Handshake:** `io('/delivery', { auth: { token: <access JWT> } })`. Middleware runs `verifyAccessToken`, then the same `User.isActive` + role lookup as `requireAuth`. Failure → `connect_error` `{ code: 'UNAUTHENTICATED' }`. There are no cookies on the socket, so there is no CSRF surface.
- **Expiry:** the server schedules `socket.disconnect(true)` at the token's `exp` and emits `session:expired` first. The client refreshes through the existing `apiClient` refresh path and reconnects with the new token.
- **Subscribe:** client → `delivery:subscribe { orderReference }`, acknowledged `{ ok: true, revision } | { ok: false, code: 'NOT_FOUND' | 'RATE_LIMITED' | 'INVALID' }`. The server resolves the reference, checks `order.userId === socket.data.userId` (or role ADMIN), then joins **`delivery:order:<orderId>`**. Room names are server-built from the UUID and never accepted from clients, so they can't be guessed or chosen. NOT_FOUND covers both "doesn't exist" and "not yours".
- **User room:** every socket also joins `user:<userId>`. Logout, account deactivation and account deletion call `io.of('/delivery').in('user:<id>').disconnectSockets(true)`. This needs a one-line hook in the existing logout and deletion services. Admin role checks are re-evaluated on every subscribe.
- **Account switch:** the client tears the socket down when `AuthContext.user.id` changes and drops all `['delivery', …, oldUserId, …]` cache entries. Events that arrive late for the old user can't land, because the cache key includes `userId` and the socket instance is discarded.
- **Limits:** 10 sockets per user (extra connections are refused with `TOO_MANY_CONNECTIONS`), 5 subscriptions per socket, 20 subscribe attempts per minute per socket.

### 8.3 Events (v1)

```ts
// server → client, room delivery:order:<orderId>
'delivery:updated': {
  v: 1;
  orderReference: string;
  revision: number;                       // = Delivery.revision after commit
  occurredAt: string;                     // server time of the event
  changed: ('status' | 'location' | 'eta' | 'tracking' | 'simulation')[];
  snapshot: Omit<CustomerDeliverySnapshot, 'timeline'>;   // safe customer projection (map path delta excluded)
  timelineEntry: CustomerDeliverySnapshot['timeline'][number] | null;  // customer-visible entry, if any
  source: 'ADMIN' | 'SIMULATION';
}
'delivery:revoked': { v: 1; orderReference: string; reason: 'ACCESS_REVOKED' | 'ORDER_CANCELLED' }
'session:expired': { v: 1 }
// client → server
'delivery:subscribe' / 'delivery:unsubscribe': { orderReference: string }
```

Client reconciliation in `useDeliveryLiveUpdates`:

- `revision ≤ cached`: ignore (duplicate or out of order).
- `revision === cached + 1`: `setQueryData` with the merged snapshot, prepend `timelineEntry`, and append the location to `map.path`.
- `revision > cached + 1` (gap): `invalidateQueries` to refetch REST.
- `delivery:revoked`: refetch (the page then shows Cancelled or Not found) and unsubscribe.
- **On every (re)connect:** re-subscribe, **always refetch REST**, then apply only newer revisions.

Socket.IO connection-state recovery is **not** relied on.

### 8.4 Publication

`DeliveryPublisher.afterCommit` is called by the controller or simulation runner after `$transaction` resolves. A publish failure is logged (`DELIVERY_PUBLISH_FAILED`, with no coordinates) and never fails the HTTP response. Clients converge on the next event, the REST refetch or reconnect. Trade-off: if the process dies between commit and emit, the event is lost and clients see it on their next refetch (focus refetch or reconnect). An outbox is unnecessary for a hint channel and is noted for Phase 06 multi-instance work.

### 8.5 Simulation (04.7, demo only)

- **Enablement:** `DELIVERY_SIMULATION_ENABLED=true` **and** `NODE_ENV !== 'production'` (boot refuses the flag in production). Runs only against local or disposable QA databases unless shared-DEV writes are explicitly authorized.
- **Admin API:** `POST /api/admin/orders/:ref/delivery/simulation { routeId }` / `DELETE …/simulation`. Requires ADMIN, an OUT_FOR_DELIVERY status and an approved `routeId` from `services/delivery-simulation/routes/*.json` (fictional points near the dev hub, ≤ 120 points).
- **Runner:** in-process interval, one tick per 5 s. Each tick calls `DeliveryService.applyUpdate({ location, source: 'SIMULATION' })` (the same validation, revision and transaction path as admins), then publishes. It stops at the route end, on Stop, at DELIVERED or CANCELLED, after 240 ticks, or on process shutdown. On boot, any `isSimulated` delivery with no runner gets a SIMULATION_STOPPED event.
- It sets `isSimulated = true` and `locationSource = SIMULATED`, which every surface labels "Simulated demo". It **never** changes status, payment, Stripe or orders automatically.

### 8.6 Deployment notes (Phase 06, design only)

Nginx `location /socket.io/ { proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 60s; }` on the API host over TLS. A single instance works as-is. Horizontal scaling needs `@socket.io/redis-adapter` and sticky sessions (or a websocket-only transport). Graceful shutdown: `io.close()` before `server.close()`, so clients reconnect and refetch. Observability: connected-socket gauge, subscribe-denied counter, publish-failed counter. Event payloads are never logged.

---

## 9. Cross-layer traceability

| Feature | Frontend component | REST / socket contract | Backend owner | Prisma model | Task |
|---|---|---|---|---|---|
| Entry point | `TrackDeliveryAction` in `features/orders/OrderDetailsPage.tsx` | existing `GET /api/orders/:ref` (`status`, `paymentState`) | existing `order.service` | Order, Payment | 04.5 |
| Status progress | `DeliveryProgressStepper` | `snapshot.status`, `timeline[].status` | `DeliveryService.getCustomerSnapshot` | Order.status, Delivery.status | 04.5 |
| Status badges | `OrderBadges` (EXISTING) | `status`, `paymentState` | same | Order, Payment | 04.5 |
| Timeline | `DeliveryTimeline` | `snapshot.timeline[]` | `DeliveryService` | DeliveryEvent | 04.5 |
| ETA | `DeliveryOverviewCard` ETA row | `snapshot.eta` | `DeliveryService` | Delivery.estimatedAt/etaUpdatedAt, Order.estimatedDelivery* | 04.5 |
| Current location (text) | `DeliveryOverviewCard` location row, map text summary | `snapshot.location` | `DeliveryService` | Delivery.latitude/longitude/locationLabel/locationUpdatedAt | 04.5 |
| Tracking reference | `DeliveryOverviewCard` | `snapshot.trackingReference` | `DeliveryService.start` | Delivery.trackingCode | 04.5 |
| States/errors | `DeliveryStateNotice` (EmptyState/ErrorState/Alert) | `availability`, HTTP codes | controller | — | 04.5 |
| Admin update | `AdminDeliveryUpdatePanel` | `GET/POST/PATCH /api/admin/orders/:ref/delivery` | `DeliveryService.start/applyUpdate` | Delivery, DeliveryEvent, Order | 04.5 |
| Admin list | `AdminDeliveriesPage` (DataTable) | `GET /api/admin/deliveries` | `DeliveryService.listForAdmin` | Order, Payment, Delivery | 04.5 |
| Route/map | `DeliveryMapPanel` → `LeafletDeliveryMap` | `snapshot.map` | `DeliveryMapProjection` | DeliveryEvent (LOCATION_UPDATED), Order.shipping*, config | 04.6 |
| Live updates | `useDeliveryLiveUpdates`, `ConnectionStatusIndicator`, live region | `delivery:updated` / `delivery:revoked` | `sockets/delivery.gateway`, `DeliveryPublisher` | Delivery.revision | 04.7 |
| Simulation | Simulated badge, dashed route, admin Demo tools | `POST/DELETE …/simulation`, `source: 'SIMULATION'` | `DeliverySimulationRunner` | Delivery.isSimulated, DeliveryEvent(SIMULATION_*) | 04.7 |

Every field in the schema diff has a consumer, and every UI control has a contract.

---

## 10. Security model summary

| Threat | Control |
|---|---|
| IDOR on tracking | owner check, with a 404 that hides existence (REST and socket) |
| Room guessing / choosing | server-built room names from UUIDs; subscribe re-checks ownership |
| Privilege escalation | `requireRole('ADMIN')` server-side; zod `.strict()` bodies; no role in payloads |
| Payment bypass | I3 payment check under the row lock; no admin override flag exists |
| Stale session on socket | token `exp` disconnect; `user:<id>` room disconnect on logout, deactivation and deletion |
| Coordinate leakage | owner-only projection; no coordinates in URLs or logs; retention scrub; destination rounded |
| XSS via labels/notes | `locationLabel` and `note` length-capped, rendered as React text only; notes never reach customers |
| Flooding | REST limiter; socket connection, subscription and rate caps; simulation tick floor of 5 s |
| Fabricated tracking | no backfill; simulated data flagged at row level and labelled everywhere |
| Third-party exposure | no geocoding or routing providers; tiles only |

**Security design: PASS with open decisions D1–D3 (§12). None blocks 04.5.**

---

## 11. Test & acceptance matrix (risk-based; nothing here has been run)

Abbreviations: **U** unit (Vitest), **I** integration (supertest + disposable Postgres), **C** component (Testing Library), **B** browser (Playwright), **S** socket integration (socket.io-client against a test server).

| ID | Task | Preconditions | Action | Backend | Database | Frontend | Security invariant | Verify |
|---|---|---|---|---|---|---|---|---|
| T5-01 | 04.5 | paid CONFIRMED, Delivery rev 1 | customer GET | 200 AVAILABLE | unchanged | stepper current=Confirmed | owner only | I, C |
| T5-02 | 04.5 | paid CONFIRMED, no Delivery | GET | 200 NOT_STARTED, rev 0 | unchanged | "Tracking reference: assigned…", empty timeline | — | I, C |
| T5-03 | 04.5 | legacy CONFIRMED, payment null/PENDING | GET; admin POST/PATCH | GET PAYMENT_PENDING; writes 409 DELIVERY_PAYMENT_INELIGIBLE | no rows | EmptyState, no button on Order Details | I3 | I, C |
| T5-04 | 04.5 | AWAITING_CAPTURE | GET; POST | PAYMENT_PENDING; 409 | none | no button; direct URL notice | I7 | I, C |
| T5-05 | 04.5 | CANCELLED (with/without Delivery) | GET; PATCH | CANCELLED; 409 DELIVERY_ORDER_CANCELLED | unchanged | cancelled panel, recorded history kept | I5 | I, C |
| T5-06 | 04.5 | DELIVERED | PATCH any | 409 DELIVERY_TERMINAL | unchanged | "View delivery details" | I4 | I |
| T5-07 | 04.5 | rev n, PREPARING | PATCH OUT_FOR_DELIVERY rev n | 200 | order+delivery status, rev n+1, 1 event, 1 email outbox row (if enabled) | — | I1, I2, I6 | I |
| T5-08 | 04.5 | PREPARING | PATCH CONFIRMED or DELIVERED | 409 ORDER_TRANSITION_INVALID | unchanged | form offers only next | I2 | I, C |
| T5-09 | 04.5 | rev n | two admins PATCH rev n concurrently | one 200, one 409 + snapshot | exactly one event rev n+1 | conflict Alert + Load latest | I6 | I (parallel tx) |
| T5-10 | 04.5 | rev n applied | replay same PATCH | 409 REVISION_CONFLICT | unchanged | "already applied" | idempotency | I |
| T5-11 | 04.5 | customer A, order of B | GET B's ref | 404 | — | Order not found | IDOR | I, B |
| T5-12 | 04.5 | customer token | PATCH admin route | 403 | — | — | role | I |
| T5-13 | 04.5 | OUT_FOR_DELIVERY | PATCH location lat 91 / lng 535 / NaN | 400 | unchanged + DB CHECK | inline error | validation | U, I |
| T5-14 | 04.5 | PREPARING | PATCH location | 409 LOCATION_NOT_ALLOWED | unchanged | location fieldset hidden | — | I |
| T5-15 | 04.5 | any | PATCH ETA past -1h / +31d / null | 400 / 400 / 200 clears | ETA_CLEARED event | "Not available yet" + promise | — | I, C |
| T5-16 | 04.5 | 60 events | GET | timeline 50, rev DESC, no LOCATION_* rows | — | ordered list | minimisation | I |
| T5-17 | 04.5 | forced error after event insert | PATCH | 500 | **full rollback**: no status, rev or event | refetch shows old | atomicity | I |
| T5-18 | 04.5 | migration | apply to disposable DB with existing orders | — | no rows created; CHECKs active | — | no fabrication | I (migrate) |
| T5-19 | 04.5 | paid orders | Order Details render matrix | — | — | button visible/hidden per §handoff 6.1 | — | C (updates existing test) |
| T5-20 | 04.5 | account deletion | delete user with deliveries | — | coords and notes nulled | — | privacy | I |
| T5-21 | 04.5 | — | tracking page 390/768/1440, 200% zoom, keyboard | — | — | no overflow; focus order = visual | a11y | B (`npm run test:visual`) |
| T6-01 | 04.6 | location + path | load map | — | — | markers, recorded path, fit bounds | — | C, B |
| T6-02 | 04.6 | no coordinates | load | `map.pathKind NONE`, location null | — | no Leaflet chunk requested; text summary | — | B (network) |
| T6-03 | 04.6 | corrupt point in path | load | server drops invalid points | — | renders remaining or "Route not available" | validation | U, C |
| T6-04 | 04.6 | tile host blocked | load | — | — | warning Alert + Retry; summary intact | resilience | B (route abort) |
| T6-05 | 04.6 | — | inspect | — | — | attribution visible at all sizes | licence | B |
| T6-06 | 04.6 | 390 px | scroll page over map | — | — | page scrolls; "Explore map" enables | a11y/touch | B |
| T6-07 | 04.6 | — | keyboard | — | — | map focusable, ring visible, +/- zoom | a11y | B |
| T6-08 | 04.6 | — | network audit | — | — | only tile host contacted; no address/coords in any URL | privacy | B (network log) |
| T6-09 | 04.6 | simulated | load | `pathKind SIMULATED_FIXTURE` | — | dashed line + "Simulated" | truthfulness | C |
| T7-01 | 04.7 | owner socket | subscribe | ack ok + rev | — | indicator "Live updates on" | owner only | S |
| T7-02 | 04.7 | customer A | subscribe B's ref | ack NOT_FOUND, not joined | — | — | IDOR | S |
| T7-03 | 04.7 | A subscribed | admin PATCH | `delivery:updated` rev n+1 to room only | — | in-place update + live region | scoping | S, B |
| T7-04 | 04.7 | DB failure injected | admin PATCH | 500, **no event emitted** | rolled back | unchanged | post-commit | S |
| T7-05 | 04.7 | subscribed | logout | sockets disconnected via user room | — | indicator gone; cache cleared | revocation | S, B |
| T7-06 | 04.7 | A then B in same tab | switch account | old socket closed; late A event dropped | — | B sees only B data | isolation | S, C |
| T7-07 | 04.7 | subscribed | kill network 30 s while 3 updates occur | — | — | "paused" → reconnect → REST refetch → rev current | no missed state | B |
| T7-08 | 04.7 | rev 5 cached | deliver rev 5 again, then rev 7 | — | — | dup ignored; gap → refetch | ordering | C (hook) |
| T7-09 | 04.7 | two tabs | update | both update once | — | one announcement per tab | — | B |
| T7-10 | 04.7 | subscribed | restart backend | clients reconnect, re-auth, refetch | — | resynced announcement | — | S, B |
| T7-11 | 04.7 | socket server down | load page | — | — | REST works; indicator "paused"; polling fallback 60 s | resilience | B |
| T7-12 | 04.7 | NODE_ENV=production + flag | boot | refuses to start simulation | — | — | demo isolation | U |
| T7-13 | 04.7 | non-admin | POST simulation | 403 | — | — | role | I |
| T7-14 | 04.7 | token expiring | wait past exp | `session:expired` + disconnect | — | silent refresh + reconnect | expiry | S |
| T7-15 | 04.7 | many sockets | open 11th / 21 subscribes per min | refused / RATE_LIMITED | — | — | abuse | S |

---

## 12. Open decisions for the Principal Architect

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Production tile source | self-hosted raster tiles or a commercial OSM-based provider; public OSM tiles for dev/review only | 04.6 production, not 04.6 dev |
| D2 | Real road routing | out of MVP; recorded positions only | nothing |
| D3 | Destination coordinates | do **not** add geocoding; show a destination only when coordinates already exist | nothing |
| D4 | Customer tracking UI in Arabic/RTL | defer to the i18n task; build with logical properties now | nothing |
| D5 | Simulation against shared Supabase DEV | disallowed by default; local or disposable DB only | 04.7 QA environment |
| D6 | Location retention window | 30 days after delivery or cancellation; job in Phase 06 | nothing |
| D7 | Customer email on each transition | keep the EXISTING `transitionFulfillment` email behaviour (already gated by `commerceEmailEnqueueEnabled`) | nothing |

---

## 13. Risks

- **Payment:** low. Delivery writes require a SUCCEEDED payment under the same order row lock payment compensation uses, and delivery code never writes payment tables.
- **Migration:** low. It is additive and nullable or defaulted, with no backfill. The risk is CHECK constraints on a non-empty `deliveries` table, which is empty today: verify with `SELECT count(*)` before applying to any shared DB.
- **Mapping:** OSM tile policy compliance (D1). Tile requests reveal the viewing area to the tile host.
- **Real-time:** a lost event between commit and emit (mitigated by refetch on reconnect and focus). A single-instance assumption until the Phase 06 Redis adapter.
- **UX:** a location label typed by admins could leak personal data. Mitigated by the help text, the 80-character cap, and showing the label to the order owner only.
- **Test gaps:** there are no Figma references (deferred to Phase 05), so visual QA compares against the Claude artifact and the handoff only.
