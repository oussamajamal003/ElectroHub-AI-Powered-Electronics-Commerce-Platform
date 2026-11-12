# Customer welcome and out-for-delivery notifications — implementation evidence

This report supersedes the earlier preliminary-only handoffs. It does not mark Phase 06.2 complete.

## Source and recovery

- Repository: `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`.
- Base: `feature/06.2-accessibility-qa-ci-cd`, verified remote SHA `9e506557b3f84049e4c1fdf27d2abe39e1055159`.
- Implementation: `feature/06.2-customer-email-delivery-notifications` in the existing `.cache/customer-delivery-notifications` worktree.
- Preserved the prior subject correction and regression assertions. Those earlier attempts had not implemented welcome events, customer history, APIs or the header UI.
- No changes to the other occupied worktrees. No merge/deployment or shared DEV/PROD database writes.

## Architecture inspected

Root AGENTS.md; ADR-009; Prisma schema and outbox/delivery migrations; AuthService, OtpService, GoogleRepository; commerce-email domain, producer, dispatcher, config, runtime and delivery reconciliation; email layout/renderers; store identity; DeliveryService/controller/publisher/gateway; auth middleware; customer header; shared Radix dropdown and SCSS tokens; delivery socket/hooks/query keys; PostgreSQL harnesses, fixtures, release/browser configurations and GitHub workflows.

The shared `emails/brand.ts` and official `public/brand/electrohub-email-logo.png` were reused from `origin/feature/06.2-branding-toasts-tooltips-emails-cloud`, rather than creating competing artwork/layout infrastructure. No broad cherry-pick was performed.

Repository Figma reference READMEs were inspected. There are no customer screenshot files in this checkout. Figma metadata returned the cover page; design context could not return a selected relevant frame. Exact Figma matching is NOT VERIFIED. Existing components/tokens govern the new panel.

## Missing welcome email: root cause and lifecycle

The original outbox enum, snapshot union and renderer registry had no welcome event, and neither registration completion path enqueued one. Also, a credential-redacted inspection of the main checkout's backend configuration found Brevo configured but `COMMERCE_EMAIL_ENQUEUE_ENABLED`, `COMMERCE_EMAIL_DISPATCH_ENABLED` and `COMMERCE_EMAIL_SEND_MODE` unset. The existing safe defaults therefore create/send no queued emails.

Password registration still creates an unverified CUSTOMER and sends its existing verification OTP. No welcome is generated at that point. The transaction that consumes the valid EMAIL_VERIFICATION challenge, sets emailVerifiedAt and records EMAIL_VERIFIED now enqueues CUSTOMER_WELCOME. A new verified Google CUSTOMER enqueues it in the same transaction as user/OAuth creation. Existing Google identities, login, profile changes and administrator activation do not use this hook; the producer also enforces CUSTOMER plus verified email.

The unique key is `customer:<userId>:welcome`. ON CONFLICT preserves the original event and snapshot. A rollback leaves no welcome event. HTML and plain text contain no password, OTP or session token. Store name/contact details are captured from the existing store settings and links use the configured origin.

## Existing fulfillment lifecycle preserved

Canonical order states remain AWAITING_CAPTURE, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED and CANCELLED. There is no SHIPPED state in this base. The existing authorized fulfillment progression remains CONFIRMED -> PREPARING -> OUT_FOR_DELIVERY -> DELIVERED, with its existing payment, revision and terminal guards.

`transitionFulfillment`, called inside DeliveryService's locked transaction, now persists one customer notification on the genuine PREPARING -> OUT_FOR_DELIVERY transition. The existing ORDER_OUT_FOR_DELIVERY outbox event remains the email event; no second queue or worker is added. Repeated status requests remain no-ops. Notification creation is independent of the email enqueue flag so in-app history is still available when email is intentionally disabled.

No Shipped template, record type, trigger or socket event is implemented. Regression coverage asserts the event registry exclusion and rejects an unsupported SHIPPED API update without customer notifications. Existing fulfillment/payment/inventory logic is unchanged.

## Persistence, migration and security

`20261111000000_customer_notifications` adds CUSTOMER_WELCOME to the email enum and permits orderless outbox rows only for that event. Existing order email rows still require an order through a physical CHECK. Existing immutable-payload, lease, provider-evidence and terminal-state constraints remain intact.

`customer_notifications` holds UUID ID, unique eventKey, customer/order foreign keys, ORDER_OUT_FOR_DELIVERY type CHECK, event time and nullable readAt. It has ownership/time/cursor and unread indexes, RLS enabled, and explicit PUBLIC/anon/authenticated privilege revocation. Express authorization is the only customer access path; this app uses its existing JWT identity, not Supabase Auth uid policies.

History is retained until its owning user/order is physically removed; reading does not delete it or modify delivery. Existing soft-deleted accounts cannot authenticate. No historical notifications are rewritten or backfilled.

## API and real-time contracts

- `GET /api/notifications`: authenticated CUSTOMER only. Returns `{ data: { items, unreadCount, nextBefore } }`. Each item is `{ id, type, orderReference, occurredAt, readAt }`. Ownership comes solely from the authenticated user. Unread count covers all pages. Pages contain up to 50 rows, ordered by timestamp and ID; the validated `before` cursor includes both, avoiding lost equal-timestamp rows. List/count use one RepeatableRead transaction. Unknown query keys are rejected.
- `PATCH /api/notifications/:id/read`: authenticated CUSTOMER, ownership-scoped, idempotent, 204 on success; absent/foreign IDs return 404. No delivery updates occur.
- Both APIs return private/no-store cache headers.
- Existing `/delivery` Socket.IO namespace and authentication are reused. The server alone joins `user:<userId>` rooms. Post-commit publication emits `notification:created` with `{ v: 1, id, type: 'ORDER_OUT_FOR_DELIVERY', orderReference, occurredAt }` only to the owner. No email, address or payment data is emitted.
- Socket delivery is a best-effort hint, not durable transport. A process crash between commit and emit is recovered by REST on reconnect/focus and the 60-second foreground refetch. Database rows remain authoritative.

## Customer experience

The existing CustomerHeader mounts the panel only for the verified CUSTOMER session. It reuses the tab's reference-counted delivery socket and Radix DropdownMenu, with a bell, unread badge, timestamp, order tracking link, read indication, explicit mark-as-read, pagination and loading/empty/error/retry states. List IDs are deduplicated; socket events never increment a local counter. Valid events invalidate the notification, order detail and tracking queries. Reconnection refetches history; cleanup removes listeners and customer cache on logout/identity change. Mobile bounds, keyboard/focus, 44px actions and contextual dark styling are included.

## Email worker/retry semantics

The existing dispatcher handles both events with its claim leases, SKIP LOCKED, attempt journal, current-account checks, configured allowlist/capture/live modes and safe logging. A proven connection rejection is retried on the existing bounded ladder; ambiguous provider acceptance remains UNCERTAIN and is not blindly resent. Provider errors cannot roll back an already committed registration/delivery transaction. Exactly-once external email delivery is not claimed.

Subjects: `Welcome to ElectroHub!` and `Your ElectroHub Order Is Out for Delivery!`. Both use the shared official PNG header with alt text, escaped customer text, configured links, optional actual support details and plain text. No courier identity/location or promised delivery time is invented.

## Environment recovery and verification

`npm ci --cache .cache/npm --no-audit --no-fund` completed: 920 packages. Initial Prisma postinstall hit ECONNRESET; `npm rebuild @prisma/engines @prisma/client --cache .cache/npm` and the subsequent lockfile install succeeded. No dependency versions or lockfile changed.

Native PostgreSQL 18 exists under Program Files although not on PATH. The Windows sandbox restricted token and Unicode cluster path initially prevented initdb. Both existing local harnesses now create their cluster in a temporary ASCII path; the disposable harness was run outside that restriction. No shared database URL was used.

| Check | Actual result |
|---|---|
| Frontend + backend typecheck | PASS |
| Frontend lint | PASS; three pre-existing Fast Refresh warnings |
| Backend lint | PASS |
| Frontend + backend build | PASS; existing bundle-size, Sass and dependency annotation warnings |
| Focused backend render/domain/schema/OTP/provider/socket tests | 235 passed in 9 files |
| Frontend header/delivery/notification component tests | 77 passed in 7 files; final notification-only expansion: 3 passed |
| Disposable PostgreSQL public-schema/API/Socket.IO/worker + actual browser suite | 45 passed in 5 files |
| Installed-Chrome browser presentation, 390px + 1440px | 2 passed; screenshots inspected |
| Workflow migration-safety policy | PASS |
| Brevo sandbox request acceptance | Both rendered templates: HTTP 201, message ID returned |
| Full backend CI command with non-listening synthetic URL | NOT PASS: 2098 passed, 9 failed, 263 skipped; 7 failed files. Database-dependent tests lacked a database, the payment SDK test lacked its synthetic test key, env-file assertion lacked .env.test.local, and server/swagger checks encountered port/timing issues. This run is not represented as full CI acceptance. |
| Full original commerce PostgreSQL harness | NOT PASS: local PostgreSQL lacks pgvector; failed before notification migration |

Focused backend command: `npm run test --workspace=apps/backend -- src/emails/commerce/__tests__ src/services/__tests__/commerce-email.domain.test.ts src/services/__tests__/commerce-email-schema.verify.test.ts src/services/__tests__/commerce-email.producer-disabled.test.ts src/services/__tests__/commerce-email.delivery.test.ts src/services/__tests__/otp.service.test.ts src/sockets/delivery.publisher.test.ts src/sockets/delivery.gateway.test.ts` (synthetic loopback URL/JWT settings).

Disposable command: `node apps/backend/scripts/delivery-pg.cjs`. It applies 35 public-schema migrations and explicitly logs four pgvector/media-only skips. Migration diff showed only seven pre-existing authentication default statements, none on notification or delivery objects. Tests exercise registration/OTP/Google, rollback, dedupe/concurrency, worker retries, owner API access, socket isolation, RLS/grants and equal-timestamp pagination.

Browser command: `NOTIFICATION_QA_CHROME_CHANNEL=chrome npx playwright test -c playwright.notifications.config.ts --project=chromium` from apps/frontend (PowerShell environment syntax locally). This suite uses controlled API fixtures, not a live provider/database. Screenshot artifacts are under `apps/frontend/test-results/notifications` (ignored). The separate real-stack browser journey passed: actual built React UI, Express, PostgreSQL, authenticated Socket.IO, persisted read state, tracking navigation and controlled dispatcher capture. Final disposable run: 45 tests across 5 files passed in 114.51 seconds (electrohub-delivery-pg-TupIOj).

Pinned browser installation failed with ENOSPC after downloading Chromium; installed Google Chrome was used successfully. Firefox/WebKit remain local NOT VERIFIED; their CI matrix is configured. Remote CI status is recorded below. The GitHub workflow now runs notification PostgreSQL/socket tests on its existing disposable database and browser checks on each existing browser-engine job.

Brevo used the official [sandbox drop mechanism](https://developers.brevo.com/docs/using-sandbox-mode), the existing configured sender/key read without printing them, and `welcome-fixture@example.invalid`. Sandbox mode sends no email and creates no delivery log: **inbox delivery NOT VERIFIED**. A normal allowlisted recipient was not configured, so no ordinary live send was attempted.

## Activation and review risks

This is a PR, not a deployment. Before enabling in an approved environment: apply the reviewed migration through the established process, update API and worker code together, serve the PNG asset, configure the trusted frontend origin, enable COMMERCE_EMAIL_ENQUEUE_ENABLED in registration/fulfillment processes, and run the existing email worker with COMMERCE_EMAIL_DISPATCH_ENABLED plus an explicitly chosen capture/allowlist/live mode. Keep existing sender/Reply-To and target-approval safeguards. Do not enable live mode as part of this task. A Brevo key alone is insufficient.

Users who completed verification while enqueueing was disabled are not retroactively emailed. No backfill of historical registrations/orders is performed. Mixed old/new worker versions must not consume new welcome rows. Socket hints can be missed during process/network failure; persistence and reconciliation are the recovery mechanism.

## Final delivery update

Implementation and corrective code commits are pushed. PR #59 targets the verified Phase 06.2 base. Nothing has been merged or deployed. Remote checks are tied to each exact SHA; consult the PR checks for the final documentation-inclusive HEAD.

Recovery follow-up: the real-browser fixture cleanup now removes its email attempt rows before outbox rows (the existing RESTRICT constraint remains unchanged). The browser test uses the existing NodeNext/CommonJS import convention. Backend typecheck passed after this correction.

## PR and verification follow-up

PR: https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/59 (base Phase 06.2, implementation commit cc5c667b2d11b8aefee994de6cd235685b77039e).

Initial remote CI run 43177683855: main backend suite 2,122 passed, 251 skipped; frontend tests, all three release browser engines, lint/typechecks, backend build, Docker, payment PostgreSQL and security audit passed. The frontend budget failed at 305,284 gzip bytes; lazy loading the customer-only panel reduced the largest chunk to 278,318 and total JS to 587,071, passing unchanged 300,000/600,000 limits. The added integration step passed 41 tests but three simulation tests rejected the CI connection configuration. Follow-up showed the strict simulation classifier rejects the migration-only `sslmode=disable`, while the general Prisma adapter tolerates that CLI flag in tests. The integration step now uses `sslmode=require` with the same job-owned loopback database and verified CA. An intermediate disposable-clone attempt was removed because the database name was already accepted. No runtime safety guard was changed.

Visual follow-up: one mobile keyboard run raced the order page's existing initial heading-focus effect; the browser fixture now waits for that handoff. Both final Chrome viewport tests passed (21.6 seconds). Screenshot review caught dark-link contrast and it was corrected with existing inverse-text tokens; explicit computed-color assertions protect it. Header/notification component rerun: 30 tests passed. Corrective code SHA: `049227ea8a7a881b693c54f76face5a5b57a7285`. Its Development CI run was 43179085726 (superseded). The follow-up run 43179255931 confirmed all 2,122 main backend tests but reproduced the three TLS-classification failures, leading to the CI-only URL correction. Final SHA/status is recorded in the PR and final handoff.

## Changed files

- `.github/workflows/ci.yml`
- `apps/backend/prisma/migrations/20261111000000_customer_notifications/migration.sql`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/scripts/commerce-email-pg.cjs`
- `apps/backend/scripts/delivery-pg.cjs`
- `apps/backend/scripts/lib/commerce-email-schema.cjs`
- `apps/backend/src/emails/brand.ts`
- `apps/backend/src/emails/commerce/__tests__/render.test.ts`
- `apps/backend/src/emails/commerce/__tests__/welcome.test.ts`
- `apps/backend/src/emails/commerce/layout.ts`
- `apps/backend/src/emails/commerce/templates.ts`
- `apps/backend/src/repositories/google.repository.ts`
- `apps/backend/src/routes/customer-notification.routes.ts`
- `apps/backend/src/routes/index.ts`
- `apps/backend/src/services/__tests__/commerce-email.domain.test.ts`
- `apps/backend/src/services/__tests__/commerce-email.multicustomer.postgres.integration.test.ts`
- `apps/backend/src/services/__tests__/customer-notifications.browser.postgres.integration.test.ts`
- `apps/backend/src/services/__tests__/customer-notifications.postgres.integration.test.ts`
- `apps/backend/src/services/__tests__/delivery.postgres.integration.test.ts`
- `apps/backend/src/services/__tests__/helpers/delivery-fixtures.ts`
- `apps/backend/src/services/commerce-email.domain.ts`
- `apps/backend/src/services/commerce-email.producer.ts`
- `apps/backend/src/services/customer-notification.service.ts`
- `apps/backend/src/services/otp.service.ts`
- `apps/backend/src/sockets/delivery.publisher.ts`
- `apps/backend/src/sockets/delivery.realtime.postgres.integration.test.ts`
- `apps/backend/vitest.commerce-email-pg.config.mts`
- `apps/backend/vitest.delivery-pg.config.mts`
- `apps/frontend/playwright.notifications.config.ts`
- `apps/frontend/public/brand/electrohub-email-logo.png`
- `apps/frontend/src/components/layout/CustomerHeader/CustomerHeader.tsx`
- `apps/frontend/src/features/notifications/CustomerNotifications.module.scss`
- `apps/frontend/src/features/notifications/CustomerNotifications.test.tsx`
- `apps/frontend/src/features/notifications/CustomerNotifications.tsx`
- `apps/frontend/tests/notifications/customer-notifications.spec.ts`
- `docs/tasks/Phase-06/CUSTOMER_NOTIFICATION_PRELIMINARY_EVIDENCE.md`
