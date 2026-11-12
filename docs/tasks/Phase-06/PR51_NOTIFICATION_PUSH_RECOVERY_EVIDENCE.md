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
- Broad local test attempts and final-SHA CI remain under verification. The first broad backend invocation incorrectly inherited producer-enabled specialist-suite settings and was interrupted; the corrected invocation showed two payment guard fixture failures. Both payment cases passed separately with a correctly named disposable target and nonfunctional test key. No payment guard was weakened. The original full frontend run was interrupted during synchronization and is not claimed as passed.
- Shared DEV/PROD mutation: none. Production migration, merge and deployment: none.

## Final revision, file manifest and residual risks

Final commit, complete changed-file manifest, test totals and exact CI revision will be appended after verification. This document does not yet declare review readiness. Migration rollout, real Brevo inbox delivery, OS toast visibility and physical Safari/iOS behavior remain separate environment checks.
