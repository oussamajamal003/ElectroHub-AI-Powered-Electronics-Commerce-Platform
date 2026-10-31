# ELECTROHUB — TASK 04.5 — DELIVERY TRACKING FOUNDATION

**Document status:** IMPLEMENTATION SPECIFICATION, DESIGNED / PROPOSED. Not approved and not implemented.
**Branch:** `feature/04.5-04.7-delivery-tracking` · **Base:** `develop` @ `1cd550a`
**Normative sources:** [Integrated architecture](TASK_04.5_04.7_DESIGN_ARCHITECTURE.md) §3–§6, §9–§11 · [Design handoff](TASK_04.5_04.7_DESIGN_SYSTEM_HANDOFF.md) §3–§8 · design-system artifact https://claude.ai/artifact/9uEiC6tbMUUTPViergzFCd

## Required changes

1. **Prisma migration** `*_delivery_tracking`: Delivery columns (`revision`, `locationLabel`, `locationSource`, `locationUpdatedAt`, `etaUpdatedAt`, `isSimulated`), enums `DeliveryEventType`, `DeliveryEventChange`, `DeliveryEventSource`, `DeliveryLocationSource`, model `DeliveryEvent`, CHECK constraints, index `deliveries(status, updatedAt)`. No backfill.
2. **`DeliveryService`** (`apps/backend/src/services/delivery.service.ts`): `getCustomerSnapshot`, `getAdminSnapshot`, `listForAdmin`, `start`, `applyUpdate`. All writes run inside `prisma.$transaction` with the order-row lock and call the EXISTING `transitionFulfillment` for status. Invariants I1–I7 hold.
3. **Validators** `delivery.validator.ts` (zod `.strict()`); **controller** `delivery.controller.ts`.
4. **Routes:** `GET /api/orders/:orderReference/delivery` inside the existing CUSTOMER `/orders` guard; new `delivery.admin.routes.ts` (ADMIN, `private, no-store`) with `GET /api/admin/deliveries`, `GET|POST|PATCH /api/admin/orders/:orderReference/delivery`.
5. **Account deletion:** null coordinates, labels and notes on the user's Delivery and DeliveryEvent rows.
6. **Swagger** schemas for the new endpoints (`src/docs/swagger`).
7. **Frontend:** `features/delivery/*` (page, Stepper, Overview, Timeline, StateNotice, MapPanel *text shell only*); `features/adminDelivery/*`; `queryKeys.delivery`; three routes; `TrackDeliveryAction` on Order Details; while OUT_FOR_DELIVERY, a 60 s visible-tab poll.
   **Visual source of truth:** handoff §9 (refined v2 design) and the artifact's *Interactive Delivery Tracking Showcase*: status hero, ETA focal panel, location panel with fresh/stale/none, copyable tracking reference, icon stepper, rail timeline, nine state notices, admin panel with confirm dialog. Everything uses existing tokens. Figma is deferred to Phase 05.
8. **Docs:** update `docs/05_Features/DELIVERY_TRACKING.md` and `ORDERS.md` to IMPLEMENTED for 04.5 scope only, with evidence.

## In scope / out of scope

- **In scope:** the modules above, plus tests.
- **Out of scope:** Leaflet, tiles, map path (04.6); Socket.IO, simulation (04.7); courier assignment, bulk admin, analytics (05.4/05.5); any change to payment, Stripe, checkout, inventory, cart or product code; geocoding; i18n.

## Acceptance criteria

- **AC1.** Every row T5-01 … T5-21 in the architecture §11 passes with real evidence.
- **AC2.** For a paid order, an admin can Start → PREPARING → OUT_FOR_DELIVERY (with location + ETA) → DELIVERED. The customer page shows each state after reload, the timeline lists exactly the recorded events, and the commerce email outbox gains rows only when `commerceEmailEnqueueEnabled()`.
- **AC3.** Unpaid, legacy-unpaid, awaiting-capture and cancelled orders cannot be advanced. They render the specified notices.
- **AC4.** Concurrency: two simultaneous PATCHes at the same revision produce exactly one event.
- **AC5.** No customer response contains `actorUserId`, `note`, the admin email or Stripe identifiers (asserted by a DTO allowlist test).
- **AC6.** Visual QA: tracking page captured at 390/768/1440 and at 200% zoom with `npm run test:visual` (new `apps/frontend/tests/visual/delivery-tracking.visual.spec.ts`, following the existing visual specs) and compared against the design-system artifact and handoff §6. No horizontal overflow. Focus order matches §5.
- **AC7.** `typecheck`, `lint`, unit, integration and `build` all pass for backend and frontend. The migration is applied to a disposable database only.

## Security risks to verify

IDOR (404 not 403 for non-owners), admin-only writes, payment check under the lock, zod `.strict()`, no coordinates in logs, and the XSS-safe rendering of `locationLabel`.

## Rollback

Revert the app deploy. The schema is additive and can stay. Before any production write, the down SQL can drop it.

**STOP after 04.5 for Principal Architect review.**
