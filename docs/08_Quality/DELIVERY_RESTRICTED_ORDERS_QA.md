# Customer delivery restricted-order QA — 2026-11-08

Requirement: unpaid, cancelled, unknown and other-customer orders display an appropriate notice without delivery tracking data.

Implementation: customer REST snapshots and realtime projections withhold cancelled history. The page also suppresses history defensively if supplied in a cancelled snapshot. Recorded database events and administrator history are retained. Updated cancellation notice copy and feature documentation. No schema or migration changes.

Verification executed:
- `npx vitest run src/features/delivery/DeliveryTrackingPage.test.tsx` (apps/frontend): 18 passed.
- `npx playwright test -c playwright.delivery.config.ts delivery-tracking.visual.spec.ts --grep "restricted orders"` (apps/frontend): 1 passed, covering awaiting-capture, legacy unpaid, cancelled, unknown, and other-customer orders with real login, Express, and disposable PostgreSQL.
- `node scripts/delivery-pg.cjs` (apps/backend): 23 passed, 10 failed. The service suite passed, including cancellation after tracking started. HTTP/realtime suites fail at administrator authentication: legacy bearer fixtures do not establish the active MFA administrator session required by middleware. These fixtures were not changed and security controls were preserved.
- `npm run typecheck`: passed.
- `npm run lint`: passed, three frontend Fast Refresh warnings.
- `npm run build`: passed, Sass division, mixed import and chunk size warnings.
- `git diff --check`: passed.

Browser evidence: Chromium, 1440 x 900, current explicit restricted-order requirement and existing notice components. Captures: `apps/frontend/screenshots/delivery-04.5/restricted-{awaitingCapture,legacyUnpaid,cancelled,otherCustomer,unknown}-1440.png`. Screenshot review of cancelled state found stale history copy; corrected and recaptured. Browser assertions verify notice, no overview/progress/history/map/copy controls, safe API projection, and no horizontal overflow. Figma fidelity and mobile visual QA: NOT VERIFIED; this change removes restricted data and reuses existing presentation.

External verification: hosted Supabase and production NOT VERIFIED; all database work used disposable local PostgreSQL. Latest remote Development CI at de39e4b was successful (run 42492861299); these uncommitted changes have no remote CI result. No Stripe or Sentry operations.

Remaining gap: ten legacy admin-session HTTP/realtime integration tests require fixture modernization before the full delivery gate can pass. Customer browser coverage above passed independently with real authentication.
