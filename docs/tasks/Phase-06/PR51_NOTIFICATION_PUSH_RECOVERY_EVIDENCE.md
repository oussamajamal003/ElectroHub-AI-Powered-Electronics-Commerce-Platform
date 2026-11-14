# PR 51 notification recovery evidence

## Scope and revision

- Existing PR: https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/51
- Source: `feature/06.2-accessibility-qa-ci-cd`; target: `develop`.
- Starting revision: `704166def1a77e1d81df236255967e4c203d1a16`.
- Refetched and incorporated concurrent revision `0a4dfb45da04d3479113495347cd81502f6c8fb0` before delivery. Its existing Development CI, security and Linux migration runs were green; those results are not attributed to this recovery.
- Work was isolated in a detached worktree. The running checkout and other agents' worktrees were not modified.
- This supersedes the earlier customer **header bell** acceptance requirement. Backend notification history and read APIs remain intact. No Shipped notification or order lifecycle change is introduced.

## Observed runtime failure

Read-only inspection found the reported order already at `OUT_FOR_DELIVERY`, with its out-for-delivery email durably queued. Its commerce email rows were `READY`, attempt count zero, with no provider identifier or suppression reason. No commerce email worker process was observed. Local API logs contained `GET /api/notifications` route-not-found errors while the notification table existed. This supports an unconsumed queue and a stale/mixed running application revision; the precise running commit was not proven. The reported order had no durable notification row. Existing history was not manufactured or backfilled.

The local environment files enabled enqueue/dispatch with allowlist mode and two approved recipients. File configuration is not proof of a running process's effective environment. No credentials, addresses, order identifiers or private payloads are reproduced here. No shared process was restarted and no shared backlog was sent. The welcome event for the reporter's particular account was not independently identified.

`npm run notifications:doctor --workspace=apps/backend` is a read-only diagnostic for schema, redacted configuration, dispatch permission and queue health. It explicitly does **not** claim that a worker is running. Correlate `email_worker_ready` and recent `email_worker_heartbeat` logs. API `npm run dev` does not start the worker. The existing `dev:isolated` supervisor starts the isolated stack and capture worker; real sending remains an explicit opt-in. Never reset or replay an `UNCERTAIN` email automatically.

## Welcome and out-for-delivery email

Existing registration, OTP verification, Google provisioning, welcome producer and shared branded templates are reused. Welcome is keyed by the new customer's user ID after verified onboarding, not by email address. A new disposable integration regression deletes/anonymizes an account, re-registers the same address, verifies the new identity, and processes its independent welcome event without duplicating the old event.

The canonical fulfillment transition remains unchanged. Only the committed `OUT_FOR_DELIVERY` transition creates the existing customer event and corresponding push deliveries in that transaction. Rollback creates neither. Existing email delivery state, provider message identifiers, retries and uncertain-outcome handling are preserved. The existing branded HTML/plain-text out-for-delivery template already has the prominent `View Order Details` CTA to a configured, validated storefront order route. No second email layout or mail queue was created.

## Web Push architecture and operations

`CustomerPushSubscription` records an endpoint, encryption keys, VAPID public-key version, customer ID and refresh-token family. `CustomerPushDelivery` is a channel-delivery journal referencing the existing `CustomerNotification`, with a unique notification/subscription pair. Both tables have RLS enabled and no PUBLIC, anon or authenticated Data API grants. Account deletion removes endpoint material and cascades the channel journal. Historical customer notifications are preserved.

The existing `email:worker` also drains push deliveries. It claims bounded batches with `FOR UPDATE SKIP LOCKED`, leases and a conditional per-attempt latch. All raw SQL timestamp comparisons use UTC to match Prisma's timestamp-without-time-zone values, including on a non-UTC database server. Retry is bounded to five attempts with backoff; 404/410 retire the subscription; other permanent responses fail visibly. Stale events and orders that have progressed beyond out-for-delivery are suppressed. Network calls occur outside database transactions. Provider acceptance does not prove OS display; an ambiguous network failure can produce an at-least-once replay. Stable notification tags collapse displayed duplicates where supported.

Push is disabled by default. Configure backend-only `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` and `CUSTOMER_PUSH_ENABLED=true`. Outside a disposable target, the worker also requires an exact `CUSTOMER_PUSH_APPROVED_TARGET` matching the runtime's target identity. This task does not authorize enabling production/shared sending. Protect the private key in secret storage; rotation requires browser resubscription. Apply the narrowly scoped migration through the normal reviewed deployment process **before** deploying code that writes these tables. It was not applied to shared DEV/PROD.

The authenticated `/api/auth/customer/push` preferences API returns only the public key. Writes require a trusted Origin and a live customer refresh cookie consistent with the bearer identity. Endpoints are restricted to HTTPS Google, Mozilla and Apple Web Push services; no arbitrary destination is accepted. An endpoint is never reassigned to another identity or session family. Logout revokes bindings for its family; session expiry/revocation is checked again before dispatch and receipt. Browser disable unsubscribes and revokes consent. Expired provider endpoints are retired rather than silently resubscribed.

## Frontend and background behavior

The header bell, unread badge, dropdown and its error/retry surface are removed. `CustomerDeliveryEvents` retains authenticated Socket.IO listeners and authoritative query invalidation, including reconnect reconciliation, with listener cleanup on identity change. No header notification polling remains.

My Account has a Delivery Notifications preference using existing Button/tokens, explicit keyboard-operable enable/disable controls, loading/error/retry and unsupported/denied states. Permission is requested only from the enable action. The service worker has no fetch interception, cache strategy or stored bearer token. The minimal web manifest supports Home Screen installation; iOS/iPadOS still requires a supported installed Home Screen app and explicit permission.

Encrypted push payloads contain only version, binding ID and event ID. The worker requests the same-origin receipt API using the existing HttpOnly customer refresh cookie before showing anything. The API rechecks customer, order and session-family ownership. Offline/no-session/foreign-session receipt fails closed. Thus messages accepted before logout cannot reveal order data to a later browser user. Notification click reauthorizes; a logged-out click may retain only the previously authorized same-origin order route and use the existing login/ownership guard. A different authenticated customer receives no fallback. Email and push preferences are independent.

Frontend and API must share the configured trusted origin (including the `/api` proxy) for background cookie authorization. Notification presentation depends on browser/OS settings, permission, network, service-worker support and background execution policy. Browser fully terminated behavior cannot be guaranteed. Push received after session expiry or while offline is intentionally suppressed; durable order state remains accessible after sign-in.

## Verification ledger

- Frontend typecheck: passed after removing the unused bell-only variable.
- Backend build/typecheck and frontend/backend lint: passed. Frontend lint has four existing Fast Refresh warnings and zero errors.
- Preference component tests: 3 passed.
- Service worker VM and actual VAPID encryption/configuration tests: all five passed. These are not OS evidence. The same focused invocation had two existing bcrypt tests exceed their five-second deadline on the loaded Windows host; it is not reported as an entirely green invocation.
- Disposable PostgreSQL first completed suite: 49 passed, 1 failed, 1 skipped. The failure exposed non-UTC retry timing and prompted the UTC fix. Corrected rerun: 50 passed, one optional browser test skipped. Expanded run with the actual React/API/Socket.IO/browser journey enabled: **52 passed, no skips**, including the additional consent/staleness/exhaustion assertions. Real database transactions and controlled email capture were used; the Web Push provider in these database tests is mocked.
- Migration initially failed because it preceded its dependency; renamed to `20261117000000_customer_web_push`. Subsequent application succeeded. Seven pre-existing early-auth default drift statements were observed; no push schema drift was present in that run.
- Real headed Chrome protocol proof: the first ephemeral-context attempt failed with `AbortError: Registration failed - permission denied`. Retrying with a generated persistent profile and background networking enabled **created a real subscription, received real provider acceptance, sent while the storefront tab was closed, and found the service worker's browser notification record**. The temporary profile and subscription were removed afterward. OS toast visibility remains NOT VERIFIED. `PUSH_BROWSER_PROOF=1 node scripts/push-browser-proof.mjs` preserves this repeatable, one-recipient proof; its receipt server is a fixture, not account integration.
- Brevo inbox delivery: NOT VERIFIED; no live email was sent by this recovery task.
- Frontend production build passed, with existing bundle/Sass/dependency warnings. Chromium Playwright preference tests: **2 passed** (390 × 900 and 1440 × 900), using controlled permission/subscription fixtures. Mobile light and desktop dark screenshots were inspected; card contents fit both viewports. The supplied error screenshot informed bell removal; no Figma matching claim is made. Full-stack tracking screenshot: `.cache/notification-browser-evidence/real-tracking.png`; preference screenshots: `apps/frontend/test-results/notifications/` (regenerated by the checked-in tests).
- Full frontend rerun: **1,550 passed, 186 files**. Full backend CI-equivalent run on fresh disposable PostgreSQL: **2,316 passed / 269 existing gated skips; 163 passed / 28 skipped files**. Two existing fixed-admin-fixture suites remain excluded exactly as in `test:ci`. The first broad backend invocation incorrectly inherited producer-enabled specialist-suite settings and was interrupted. A subsequent attempt exposed missing CI fixture configuration (test env file, nonfunctional Stripe key and an occupied HTTP port). The final run supplied those fixtures and a random HTTP port; no application guard/assertion was weakened. The original full frontend run was interrupted during synchronization and is not counted as passed.
- Local WebKit responsive preference checks: **2 passed**. Local Firefox installed successfully but Windows rejected process launch (`spawn UNKNOWN`); those two tests did not execute locally. Linux CI executed the browser jobs successfully on the pushed candidate.
- The opt-in **actual customer Web Push journey** passed twice (52/52 in each complete disposable run): My Account → authenticated subscription API → owned database row → authorized administrator transition → durable channel journal → real Web Push provider → actual receipt authorization → service worker/browser notification record with the storefront tab closed. One intermediate repeat timed out during browser subscription startup at 30 seconds; the bounded 60-second diagnostic run passed. The ordinary CI path never contacts a live push provider. See [real push result](evidence/notification-recovery/real-push-result.json), [email capture receipt](evidence/notification-recovery/out-for-delivery-email-capture.json), [real tracking](evidence/notification-recovery/real-tracking.png), [mobile preferences](evidence/notification-recovery/preferences-mobile-webkit.png) and [desktop dark preferences](evidence/notification-recovery/preferences-desktop-dark-webkit.png). These contain synthetic fixtures only. The JSON separates real push provider HTTP 201 from captured email and unverified inbox/OS presentation.
- Candidate `b58ad46d48e1396cfb247de56389ebcb8787dbd6`: [Development CI](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/43322037829), [Security Audit](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/43322037741), and [Linux migration verification](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/actions/runs/43322037877) all passed. Final evidence/test-harness commit checks are recorded in PR #51 against that exact final SHA; candidate results must not be relabeled as final-SHA results.
- Shared DEV/PROD mutation: none. Production migration, merge and deployment: none.

## Final revision, file manifest and residual risks

The final SHA and its exact CI links are recorded in PR #51's notification recovery section, avoiding a self-referential commit hash in this file. Independent review is appropriate once those checks pass. Migration rollout, real Brevo inbox delivery, OS toast visibility and physical Safari/iOS behavior remain separate environment checks. The running shared DEV checkout was not restarted or migrated; these changes do not claim to have sent its backlog or repaired its deployed runtime in place.

## Controlled local acceptance procedure

1. Use this revision in an isolated checkout. Generate the Prisma client with `npm run prisma:generate --workspace=apps/backend`. Run `npm run db:isolated:init --workspace=apps/backend` and the existing isolated startup workflow; verify its disposable target and migration readiness. Do not use a shared database URL. `npm run dev:isolated --workspace=apps/backend` starts the existing API/worker stack in capture mode by default.
2. For provider-independent registration evidence, run `node scripts/delivery-pg.cjs` from `apps/backend`. The registration tests intercept the verification-email method to capture the generated code, then use the real OTP verification, deletion and re-registration services against disposable PostgreSQL. They confirm one `CUSTOMER_WELCOME` event for each new verified user ID. The ordinary local commerce capture mode does **not** capture authentication OTPs; a manual registration requires the approved verification-mail provider/mailbox. Do not bypass verification. Use the existing admin operations for a disposable paid-state order fixture to transition from its existing preceding state to Out for Delivery; do not change real payment state or call a live payment provider. Confirm one `ORDER_OUT_FOR_DELIVERY` event and the `View Order Details` CTA. Failed/repeated transitions must not add events.
3. For supervised Brevo acceptance, first verify the configured sender in Brevo. Configure only an explicitly approved mailbox in `COMMERCE_EMAIL_ALLOWED_RECIPIENTS`, a trusted `COMMERCE_EMAIL_ORIGIN`, and the existing Brevo sender/API settings. Start `npm run dev:isolated:real-email --workspace=apps/backend` only after inspecting the disposable pending queue and recipient allowlist. Inspect `email_worker_ready`, heartbeat, outbox attempt state and provider message ID; verify that Brevo accepted/delivered the particular message and then check the actual inbox. `ACCEPTED` alone is not inbox proof. Do not reset uncertain rows or send the shared backlog. No such live-mailbox run was performed in this task.
4. For automated real push, build the frontend and run from `apps/backend` in PowerShell:

   ```powershell
   $env:NOTIFICATION_BROWSER_RUN='1'
   $env:NOTIFICATION_REAL_PUSH_RUN='1'
   $env:NOTIFICATION_QA_CHROME_CHANNEL='chrome'
   node scripts/delivery-pg.cjs
   ```

   This provisions a fresh local PostgreSQL cluster, generates ephemeral VAPID keys, creates synthetic customers/orders, registers the subscription through the actual My Account UI/API, captures email, sends one push to its own temporary persistent Chrome profile, checks the actual receipt API and browser notification record, then removes the fixture/profile. It never uses real customer subscriptions. Sanitized artifacts are under `.cache/notification-browser-evidence/`; actual OS visibility is still a separate observation.
5. For manual OS presentation, use an operator-owned browser profile and the same isolated backend/frontend origin. Set the backend VAPID pair/subject and `CUSTOMER_PUSH_ENABLED=true` before starting the existing worker. Sign in to a disposable customer, choose **Enable Delivery Notifications**, and grant browser/OS permission. Close every storefront tab while keeping the browser's background execution enabled. Perform one authorized disposable Out for Delivery transition. Observe and record the OS notification, click it, confirm the correct protected order opens, then test logout/account switching and disable notifications. Repeat in physical Safari/iOS Home Screen mode if that platform is a release requirement. Do not infer success from a provider response or from `getNotifications()` alone.

The standalone `PUSH_BROWSER_PROOF=1 node scripts/push-browser-proof.mjs` is a smaller protocol diagnostic with a synthetic receipt API; it is explicitly weaker than the full-stack command above. Private/incognito browser profiles may reject subscription creation even when permission is pre-granted. The real proof uses a temporary persistent profile.


## Complete recovery file manifest

Relative to preserved integration revision `0a4dfb45da04d3479113495347cd81502f6c8fb0`:

```text
apps/backend/.env.example
apps/backend/package.json
apps/backend/prisma/migrations/20261117000000_customer_web_push/migration.sql
apps/backend/prisma/schema.prisma
apps/backend/scripts/delivery-pg.cjs
apps/backend/scripts/push-browser-proof.mjs
apps/backend/src/commerce-email-runner.ts
apps/backend/src/notification-doctor.ts
apps/backend/src/repositories/auth.repository.ts
apps/backend/src/routes/customer-push.routes.ts
apps/backend/src/routes/index.ts
apps/backend/src/services/__tests__/auth.service.test.ts
apps/backend/src/services/__tests__/customer-notifications.browser.postgres.integration.test.ts
apps/backend/src/services/__tests__/customer-notifications.postgres.integration.test.ts
apps/backend/src/services/__tests__/customer-push-sw.test.ts
apps/backend/src/services/__tests__/customer-push.config.test.ts
apps/backend/src/services/__tests__/customer-push.postgres.integration.test.ts
apps/backend/src/services/__tests__/helpers/refresh-token-model-db.ts
apps/backend/src/services/account-deletion.service.ts
apps/backend/src/services/commerce-email.producer.ts
apps/backend/src/services/commerce-email.runtime.ts
apps/backend/src/services/customer-push.config.ts
apps/backend/src/services/customer-push.dispatcher.ts
apps/backend/src/services/customer-push.service.ts
apps/backend/vitest.delivery-pg.config.mts
apps/frontend/index.html
apps/frontend/public/delivery-push-sw.js
apps/frontend/public/manifest.webmanifest
apps/frontend/src/components/layout/CustomerHeader/CustomerHeader.tsx
apps/frontend/src/features/auth/context/AuthContext.tsx
apps/frontend/src/features/notifications/CustomerDeliveryEvents.tsx
apps/frontend/src/features/notifications/CustomerNotifications.module.scss
apps/frontend/src/features/notifications/CustomerNotifications.test.tsx
apps/frontend/src/features/notifications/CustomerNotifications.tsx
apps/frontend/src/features/notifications/DeliveryNotificationPreferences.module.scss
apps/frontend/src/features/notifications/DeliveryNotificationPreferences.test.tsx
apps/frontend/src/features/notifications/DeliveryNotificationPreferences.tsx
apps/frontend/src/features/notifications/pushClient.ts
apps/frontend/src/layouts/CustomerLayout.tsx
apps/frontend/src/pages/customer/AccountPage.tsx
apps/frontend/tests/notifications/customer-notifications.spec.ts
docs/tasks/Phase-06/PR51_NOTIFICATION_PUSH_RECOVERY_EVIDENCE.md
docs/tasks/Phase-06/evidence/notification-recovery/out-for-delivery-email-capture.json
docs/tasks/Phase-06/evidence/notification-recovery/preferences-desktop-dark-webkit.png
docs/tasks/Phase-06/evidence/notification-recovery/preferences-mobile-webkit.png
docs/tasks/Phase-06/evidence/notification-recovery/real-push-result.json
docs/tasks/Phase-06/evidence/notification-recovery/real-tracking.png
package-lock.json
```
