# Task 04.5 — Delivery Tracking Foundation: Implementation Evidence

- **Branch:** `feature/04.5-04.7-delivery-tracking` (uncommitted working tree; nothing committed, pushed or merged)
- **Date:** 2026-10-31
- **Scope:** 04.5 only. The map (04.6) and Socket.IO/simulation (04.7) are not started. No Phase 05 work.
- **Design baseline:** refined artifact https://claude.ai/artifact/9uEiC6tbMUUTPViergzFCd, with [TASK_04.5_04.7_DESIGN_SYSTEM_HANDOFF.md](TASK_04.5_04.7_DESIGN_SYSTEM_HANDOFF.md) and [TASK_04.5_04.7_DESIGN_ARCHITECTURE.md](TASK_04.5_04.7_DESIGN_ARCHITECTURE.md).
- **Figma:** DEFERRED TO PHASE 05 BY OWNER DECISION.

## 1. What was built

### Database (additive)
Migration `apps/backend/prisma/migrations/20261031000000_delivery_tracking/` (with a manual `down.sql`):
- `deliveries` gains `revision`, `location_label`, `location_source`, `location_updated_at`, `eta_updated_at`, `is_simulated`, and an index on `(status, updated_at)`.
- A new `delivery_events` table, unique on `(delivery_id, revision)`, with cascade from the delivery.
- Four new enums.
- CHECK constraints on revisions, coordinate ranges and the coordinate pair.
- RLS is enabled on `delivery_events` and client roles have their access revoked.
- No existing column is altered or dropped.

### Backend
- `services/delivery.service.ts`: customer and admin snapshots, the admin list, `start`, `applyUpdate`.
  - Every write locks the order row (`FOR UPDATE`), requires a SUCCEEDED payment inside the transaction, and checks `expectedRevision` (409 `DELIVERY_REVISION_CONFLICT`, returning the current snapshot).
  - Status changes go through the existing `transitionFulfillment`, so they are forward-only and use the existing email-outbox hook.
  - One event per accepted change. A request that changes nothing writes nothing.
- `validators/delivery.validator.ts`: strict Zod schemas. The ETA must fall between 5 minutes ago and 30 days ahead; coordinates are range-checked; labels are at most 80 characters and notes at most 280.
- `controllers/delivery.controller.ts` and `routes/delivery.admin.routes.ts` (ADMIN guard, 30 writes/min).
- Customer route `GET /api/orders/:orderReference/delivery` in `checkout.routes.ts`: owner-scoped, 60/min/user, `private, no-store`. Another customer's order returns the same 404 as a missing one.
- Customer projection:
  - Location is returned only while the order is OUT_FOR_DELIVERY.
  - Internal notes and actor IDs are never returned to customers.
  - The timeline is capped at 50 entries.
  - The response includes `serverTime`, used for the stale-location check (older than 30 min).
- `account-deletion.service.ts` scrubs the location label/source and event coordinates/notes for completed orders.
- Swagger: Delivery tag and paths.

### Frontend
- `features/delivery/`: types, presentation helpers, React Query hooks (`queryKeys.delivery.*`), `DeliveryTrackingPage`, `TrackDeliveryAction`, overview card, progress stepper, timeline, text-only location panel and state notices. Styling uses SCSS modules with tokens only and container queries.
- `OrderDetailsPage` shows **Track delivery** only for paid CONFIRMED→DELIVERED orders.
- Admin pages: `AdminDeliveriesPage` (list and filters) and `AdminDeliveryDetailPage`, plus `AdminDeliveryUpdatePanel`:
  - Only the next status can be chosen.
  - Location fields appear only for OUT_FOR_DELIVERY.
  - Every change is shown in a confirm dialog first.
  - A revision conflict shows a "Load latest" action.
  - Focus returns to the button that opened the dialog.
- Lazy routes plus a sidebar link in `AdminLayout`.
- Shared `Textarea` helper text changed from the muted colour (2.56:1) to `$color-text-secondary` to pass WCAG AA contrast. The fix is in the shared component.

## 2. Verification actually run

| Gate | Command | Result |
|---|---|---|
| Backend typecheck / lint / build | `npm run typecheck`, `npm run lint`, `npm run build` (apps/backend) | pass |
| Backend unit tests | delivery.unit.test.ts | **3/3** |
| Disposable PostgreSQL gate | `node scripts/delivery-pg.cjs` (PG18 on a random loopback port, DB `electrohub_disposable_*`, all migrations applied) | **17/17** (13 service + 4 route); delivery-scoped schema drift **0** |
| Frontend typecheck / lint / build | `npx tsc -b`, `npm run lint`, `npm run build` | pass |
| Frontend unit / component tests | `npx vitest run` | **1060/1060** across 122 files (includes 14 tracking-page tests and the Order Details T5-19 matrix, 40 tests) |
| Real Chromium QA | `node scripts/delivery-qa-stack.cjs` (backend), then `npx playwright test -c playwright.delivery.config.ts` (frontend) | **8/8** passed in 53.0 s |

The disposable PG gate covers:
- forward-only transitions
- payment required (no payment, failed payment, awaiting capture)
- cancelled orders
- revision conflict
- no-op updates
- one event per change and event-type precedence
- location visible only while out for delivery
- stale location
- other customers' orders return 404
- the 60/min rate limit
- account-deletion scrub
- `transitionFulfillment` outbox behaviour

The Chromium suite runs against the real API on a disposable, seeded database:
1. Order Details → Track delivery → tracking page → back navigation.
2. Every customer state at 1440 px: no horizontal overflow, axe reports no violations, no console errors.
3. 390 / 768 / 1920 px and 200 % zoom: content order is kept and nothing overflows.
4. Keyboard: focus order starts at the overview, the focus ring is visible, targets are at least 44 px, `aria-current` is set, and reduced motion is respected.
5. Copy puts the tracking reference on the clipboard and the result is announced.
6. Retry after a controlled API fault, then the real data loads.
7. Another customer's order (IDOR) and signed-out access are both blocked.
8. Admin: list → Start → update with the confirm dialog → revision conflict → Delivered; after a hard refresh the customer sees the history.

The QA stack was stopped afterwards; run evidence is in `.cache/delivery-qa-stack-*` (git-ignored). Screenshots are in `apps/frontend/screenshots/delivery-04.5/`.

**Not run / not verified:**
- No NVDA or VoiceOver screen-reader testing.
- No remote CI run.
- No Stripe calls: payment rows are synthetic fixtures on the disposable database.
- No Brevo sends.
- The default backend suite fails 45 files and 274 tests on environment guards (`Payments are unavailable`, `DATABASE_TEST_TARGET_REQUIRED`, timeouts). These look pre-existing: they are guards outside the delivery code, and the new PG suites skip there. The suite was not run on unmodified HEAD to confirm this.

## 3. Safety
- Shared DEV mutations: **none**. PROD mutations: **none**. All migrations and writes ran only on disposable loopback clusters whose database names are required to match `electrohub_disposable_*`.
- Payment and Stripe code and guards are unchanged. Delivery writes only read payment state; they never change it.

## 4. Known limitations
- Tracking pages nest a `<main>` inside the layout's `<main>`, the same pattern other pages use.
- The breadcrumb links are 24 px tall: inline-text links, below the 44 px target size.
- The shared `Input` helper text still uses the muted colour (below AA). It was left alone because it has many consumers; it needs a separate foundation fix.
- Account deletion scrubs delivery data only for completed orders; in-progress deliveries are not scrubbed.
- Order Details does not show a status line from cached tracking data. It shows the link only.
- If the clipboard is unavailable, Copy only shows a "copy manually" message; there is no other fallback.
- Screen-reader announcements were checked through the accessibility tree and axe only.
