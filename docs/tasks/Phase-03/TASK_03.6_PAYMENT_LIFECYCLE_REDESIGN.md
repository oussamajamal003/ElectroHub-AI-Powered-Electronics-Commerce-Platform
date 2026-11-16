# Task 03.6 — Payment lifecycle redesign

Date: 2026-10-12. Branch: `feature/Stripe`. Source implementation is complete; hosted acceptance is **NOT VERIFIED**. This working tree already contained extensive uncommitted work before this task. The inventory below identifies this task's implementation rather than claiming ownership of the entire branch diff. No commit, push, deployment, migration application, global payment worker, historical READY processing, or live financial operation was performed.

## Ownership and lifecycle

Previously an unresolved cart payment continued to own the mutable active Cart. Ordering and compensation could consequently depend on later cart contents, and the browser was asked to block navigation while payment recovered.

The existing `PaymentAttempt` and immutable `PaymentAttemptItem` snapshot now also represent the authoritative saved purchase. A separate Purchase table would duplicate the existing snapshot. `PaymentWork` remains the durable processor queue; `Order` remains the persisted commercial outcome. No new payment engine or capture strategy was introduced.

1. Setup snapshots product, SKU, quantity, unit price, delivery and shipping. New item snapshots record `snapshotCartItemId`, an exact cart-line generation rather than merely a product ID.
2. Explicit `POST /api/checkout/payment-attempts/:id/submit` verifies the authenticated owner, live revision, exact line IDs and quantities, eligible attempt and available work. A Serializable transaction locks **Attempt → Work → Cart**, transfers the exact lines using `sourceCartItemId`, removes those lines, marks `submittedAt`, and releases `activeCartId` atomically. No provider operation occurs in this transaction. Replays return the same purchase without deleting newly added lines.
3. Cart B can now contain different products, or a newly created line of the same SKU, without becoming part of A. Pending A is excluded from B's totals, badge, validation and checkout eligibility. Buy Now submission does not write Cart.
4. Order commit reads the submitted purchase's snapshot and retains existing inventory fencing, transaction boundaries, uniqueness and capture rules. It never clears Cart B. A new cart snapshot authorized without the submit handshake is rejected before inventory or Cart consumption. Historical null-marker attempts retain the existing guarded legacy path.
5. Submitted purchase expiration does not silently cancel an authorization. Existing durable lease/token fencing, provider idempotency and recovery handle the attempt independently of browser activity. The worker was not started in this task.
6. Submitted compensation restores inventory through existing order compensation, but does not automatically reinsert A into B. Explicit restoration is additive and idempotent, stock/quantity constrained, and requires fresh provider proof of cancellation or complete refund.

## API and customer behavior

All payment routes retain the authenticated CUSTOMER boundary and no-store behavior. IDs are ownership checked server-side; no roles, totals, ownership or payment success are accepted from the client.

| Endpoint | Behavior |
| --- | --- |
| GET `/api/checkout/payment-attempts` | Customer's submitted pending/retained purchases and unread outcomes, without a recent-50 cutoff hiding an old pending purchase. Safe item/total/status summary; no client secret. |
| POST `/:id/submit` | Exact atomic ownership transfer; strict empty request; no provider calls. |
| POST `/:id/resume` | Fresh provider/binding/zero-funds proof, saved stock and price validation, and locked eligibility. Returns the same eligible intent and saved shipping/items. Never creates an intent or reads B as payment authority. |
| POST `/:id/restore` | Explicit verified terminal restoration, once, additive to current Cart. |
| POST `/:id/read` | Persistent acknowledgement scoped to the customer and exact current outcome; races cannot acknowledge a later outcome. |
| GET `/api/orders` | Owned persisted orders, latest 50, including saved items/shipping/payment state. No client-derived orders. Pagination is not added in this task. |

Existing response fields remain; `classification`, `checkoutId`, `scope`, `submittedAt`, timestamps and `retryAllowed` provide customer semantics. PAID is SUCCEEDED; authorized payment is AUTHORIZED; committed capture is ORDER_PROCESSING; processing is PROCESSING; verified decline is DECLINED; card/authentication input is NOT_SUBMITTED or AWAITING_CUSTOMER_ACTION; cancellation/refund/compensation is FAILED. Work/provider uncertainty takes precedence over stale failure presentation and maps to UNKNOWN.

Generic checkout abandons a submitted browser draft as a checkout authority while retaining its shipping preference. Saved status and retry are accessed through exact attempt URLs. Checkout B never installs A's Stripe secret, confirmation, shipping or totals. Late responses are fenced by attempt/account generation. Navigation, Back/Forward, header and footer remain available; navigation does not cancel submitted work.

Only provider-verified PAID confirmation shows **Order Confirmed** and Paid. Authorization/capture wait shows **Finalizing your order**. Unknown state is not success or decline and has no blind pay-again action. Checkout observation ends after 120 seconds; account status uses bounded/backoff reads with explicit refresh after interruption. Notifications poll pending identities for at most five minutes per identity set, pause on hidden/error states, and share a customer-keyed query. Persistent outcome banners do not navigate or alter active checkout. Outcome signatures invalidate owned Orders, and acknowledgement persists across remounts.

Retry loads exact saved eligibility, shipping and item quantities. Its action explicitly says **Pay USD <saved total>**. Confirmation response loss removes the consent control and directs the customer to status; it does not silently resubmit. Retry eligibility has a 25-second abort bound and a pending retry moves to saved status after 30 seconds.

## Migration and rollout gate

Prepared migration: `apps/backend/prisma/migrations/20261012120000_payment_purchase_ownership/migration.sql`.

Nullable additive columns: attempt `submittedAt`, `restoredAt`, `notificationReadState`; item `sourceCartItemId`, `snapshotCartItemId`. A unique index prevents transfer of one source line to two purchases. A CHECK requires submitted purchases to release the active-cart claim. There is no historical data update, bulk work selection, destructive DDL or migration-triggered provider operation. Prisma schema is synchronized; the explicit CHECK remains SQL because Prisma does not model it.

**Approval required before applying to DEV or PROD.** The current application requires these columns; deploying source before migration is not compatible. CI includes a migrate-deploy job, so pushing this branch must also be treated as a database-changing gate. No push was performed. PostgreSQL migration, constraint behavior, real serializable conflicts and rollback must be exercised in an authorized disposable PostgreSQL environment before merge/rollout. Transaction mocks are not PostgreSQL proof.

Earlier Prisma generation attempts hit a Windows locked query-engine DLL; existing application services were not stopped. A subsequent fresh-schema generation succeeded once the lock was released naturally. Final standard generation is recorded below.

## Source inventory

- Backend schema/migration; `cart.service.ts` saved projection; `payment.domain.ts` classification; `payment.service.ts` transfer/resume/restore/list/ack/recovery; `order.service.ts` saved purchase commit and order history; payment and checkout routes.
- Frontend checkout state/types/page/components/presentation; navigation lock context; saved status/recovery; new `PaymentPurchases.tsx` and `PaymentRetryPage.tsx`; CustomerLayout; CartPage; OrdersPage and its styles; retry route.
- Backend payment domain/service/retry/isolation fixtures and new ownership/migration tests; frontend checkout/navigation/recovery/status/session/Stripe/notifications/retry/cart/orders tests; frontend-only `playwright.payment-lifecycle.config.ts`, lifecycle/retry/recovery/isolation/processing/blocker/checkout/reliability specs and intercepted SDK harness.
- This document and its final evidence logs. No SECURITY-01 control was changed.

## Offline regression matrix

The following maps the requested 50 scenarios to actual source-path suites. Evidence establishes doubles/component/browser behavior only; PostgreSQL and hosted provider gates remain separately unresolved.

| Requested scenarios | Actual coverage |
| --- | --- |
| 1–4 stay, leave, refresh, browser remount | Browser checkout consent/navigation/lost response; actual tab close/reopen saved status. |
| 5–8 pending A, nonpayable A, B, Stripe B | Lifecycle browser desktop/mobile; backend exact transfer; frontend Cart and session isolation. |
| 9–12 A completes during B/Home/Cart, Orders update | PaymentPurchases route/state parameter cases and persistent acknowledgement; session isolation late A response; order history hydration. |
| 13 A never clears B | Backend detached snapshot order commit and committed replay tests; frontend late response isolation. |
| 14–17 decline presentation, Home/B, safe retry | Reliability scope matrix; notification route/state cases; exact saved retry browser/component/provider-readback tests. |
| 18–20 additive restoration, no failed inventory consumption, no false success | Ownership restore once with same SKU; existing processor/compensation/domain tests; terminal browser matrix. |
| 21–24 lost response, unknown provider, recovery restart, B starts | Processor PRE/POST response-loss and worker replacement tests; unknown resume; browser lost response/remount; A/B isolation. |
| 25–29 stale/competing leases, webhook replay, duplicate submit, interrupted commit | Existing processor/service/webhook suites with deterministic doubles; submit replay; commit/fencing regressions. |
| 30 bounded status | PaymentStatusPage unit tests; processing/browser clock tests. |
| 31–34 Cart/Buy Now independence, same SKU, quantity | Exact-line transfer/recreation rejection, detached commit and additive restore; Buy Now isolation; cart/session tests. |
| 35–37 history, multiple tabs, direct refreshed URL | Navigation component/browser tests; real close/reopen saved URL; isolated checkout generations. |
| 38–40 badge, accessible pending notice, B-only totals | Desktop/mobile lifecycle browser; PaymentPurchases and Cart component tests. |
| 41–43 owner, stale identity, wrong provider binding | Ownership/isolation/provider tests and authenticated route suites. |
| 44–47 duplicate order/capture, retry eligibility, uncertainty | Processor response-loss/fencing/idempotency suites; resume wrong binding/status/price/stock tests; retry unknown response tests. |
| 48 historical READY never selected | Additive migration test and existing isolated runtime durable budget test; no worker or historical job run. |
| 49 cancellation vs authorization | Existing expiry/cancel/provider binding and supersession concurrency tests. |
| 50 order/inventory atomicity | Source transaction and mocked fault regressions PASS; actual PostgreSQL integration **SKIP / NOT VERIFIED**. |

No test was removed. Assertions requiring navigation blocks or reuse of detached A through active Cart were updated to the new task's requirements. The durable filesystem guard test received a 20-second test deadline on Windows, retaining all operation budgets and fencing assertions. Earlier exploratory runs failed for old expectations, fixture contract omissions, an unstable retry user-object dependency, the five-second filesystem deadline, and cold UI/bootstrap assertions under simultaneous build/test load; final results below supersede those runs.

## Independent review and visual evidence

A separate read-only architect reviewer inspected final ownership, unsubmitted authorization rejection, unknown-state handling, retry fencing, acknowledgement and pending queries. It found **no remaining P0/P1 source blockers**. It did not execute tests or verify PostgreSQL, Stripe, migration or visuals. One earlier P1 (new unsubmitted authorization entering the legacy cart commit path) was fixed and regression-tested before that final review.

Repository visual sources inspected: `docs/assets/figma/exports/customer/screenshots/Cart page.png`, `Checkout page.png`, and relevant export READMEs. Existing typography, tokens and responsive foundations are reused. The connected Figma file returned only its cover, not an applicable checkout frame: exact Figma frame compliance **NOT VERIFIED**.

Reusable browser QA captures desktop 1440×900 and mobile 390×900 Cart/pending/B views; saved retry; and checkout/review/processing/confirmation at 390, 768, 1440 and 1920 widths. Captures are under `apps/frontend/test-results/payment-lifecycle/` and `apps/frontend/screenshots/stripe-intercepted/`. The desktop/mobile pending Cart and saved retry captures were inspected. Pending A remains outside the active B summary, badge is B-only, mobile stacks without horizontal overflow, and the saved retry uses its own shipping/total with an explicit Pay label. A duplicate status link found during inspection was removed; final recapture is recorded below. This establishes inspected layout behavior, not exact inaccessible Figma parity. Browser interception is UI evidence only, never real charge proof.

## Final verification

Final counts, command logs and screenshot inspection are appended after the final run. Scoped lint/typechecks/builds are local verification, not full remote CI certification. Frontend build retains an existing >500 KB chunk warning. GitHub CI, Sentry, hosted Stripe Test Mode and Supabase/PostgreSQL runtime remain **NOT VERIFIED**. No real-provider cancellation, capture, refund or retry was executed.

Merge recommendation: **NO** until authorized PostgreSQL migration/concurrency and hosted lifecycle gates are demonstrated. Source-level implementation and independent review do not imply 100% hosted acceptance.


### Exact implementation paths

Backend: `apps/backend/prisma/schema.prisma`; `apps/backend/prisma/migrations/20261012120000_payment_purchase_ownership/migration.sql`; `apps/backend/src/services/cart.service.ts`; `apps/backend/src/services/payment.domain.ts`; `apps/backend/src/services/payment.service.ts`; `apps/backend/src/services/order.service.ts`; `apps/backend/src/routes/payment.routes.ts`; `apps/backend/src/routes/checkout.routes.ts`.

Frontend: `apps/frontend/src/features/checkout/CheckoutPage.tsx`; `CheckoutComponents.tsx`; `Checkout.module.scss`; `state.ts`; `types.ts`; `paymentPresentation.ts`; `PaymentLockContext.tsx`; `PaymentRecovery.tsx`; `PaymentStatusPage.tsx`; `PaymentPurchases.tsx`; `PaymentRetryPage.tsx`; `StripePaymentSession.tsx` (all under the same checkout directory); `apps/frontend/src/layouts/CustomerLayout.tsx`; `apps/frontend/src/pages/customer/CartPage.tsx`; `OrdersPage.tsx`; `OrdersPage.module.scss`; `apps/frontend/src/routes/index.tsx`.

Reusable regression entry point: `apps/frontend/playwright.payment-lifecycle.config.ts`. The source-only migration and ownership regression entry points are `apps/backend/src/services/__tests__/payment.purchase-migration.test.ts` and `payment.purchase-ownership.test.ts`; actual transfer/commit isolation is tested in `payment.session-isolation.test.ts`. Frontend saved retry and notifications are covered by `PaymentRetryPage.test.tsx` and `PaymentPurchases.test.tsx`.


### Recorded final results

Evidence directory: [payment-lifecycle-2026-10-12](evidence/payment-lifecycle-2026-10-12/). All PASS statements below are local/source/offline evidence.

| Verification | Final result | Evidence |
| --- | --- | --- |
| Backend affected suites | **PASS 307/307**, 15 files | [backend log](evidence/payment-lifecycle-2026-10-12/backend-final.txt) |
| Frontend affected suites | **PASS 197/197**, 16 files | [frontend log](evidence/payment-lifecycle-2026-10-12/frontend-final.txt) |
| Browser lifecycle matrix | **PASS 49/49**, one worker | [browser log](evidence/payment-lifecycle-2026-10-12/browser-final.txt) |
| Final four lifecycle/visual cases | **PASS 4/4**, repeated after duplicate-link cleanup | [recapture log](evidence/payment-lifecycle-2026-10-12/browser-visual-final.txt) |
| Final notifications including exact Home/Cart/Checkout routes | **PASS 11/11**, repeated after making the Home route assertion exact | [notifications log](evidence/payment-lifecycle-2026-10-12/notifications-final.txt) |
| Retry component after link cleanup | **PASS 5/5** | [retry log](evidence/payment-lifecycle-2026-10-12/retry-final.txt) |
| Backend/frontend typechecks | **PASS** | `typecheck-backend.txt`, `typecheck-frontend.txt` |
| Scoped backend/frontend lint plus final additions | **PASS**, no errors/warnings | `lint-backend.txt`, `lint-frontend.txt`, `lint-final-additions.txt` |
| Backend/frontend production builds | **PASS**; frontend retains chunk-size warning | `build-backend.txt`, `build-frontend.txt` |
| Prisma validate and standard fresh client generation | **PASS** with dummy localhost database URLs; no connection/migration | `prisma-validate-final.txt`, `prisma-generate-final.txt` |
| Source-only migration diff and additive migration tests | **PASS**; no PostgreSQL behavior inferred | migration regression included in backend 307 |
| Git diff whitespace and scoped credential patterns | **PASS** | `diff-check.txt`; no credential pattern matches in changed financial/customer source |
| Independent source review | **PASS: no remaining P0/P1 findings** | [review](evidence/payment-lifecycle-2026-10-12/independent-review.txt) |
| PostgreSQL migration/constraints/real transaction concurrency | **SKIP / NOT VERIFIED** | No local PostgreSQL/container runtime available; no remote migration authorization |
| Hosted Stripe Test Mode/browser-independent deployed recovery | **SKIP / NOT VERIFIED** | Real financial operations and global worker startup prohibited by this task |
| Applicable Figma checkout frame, Supabase runtime, Sentry, remote CI for this uncommitted source | **NOT VERIFIED** | No applicable Figma frame; no hosted runtime test or source publication |

Unique final regression cases: **553 PASS, 0 FAIL** (307 backend + 197 frontend + 49 browser). Repeated focused checks are not counted twice. The most recent full frontend run and subsequent notification focused run together cover the current route assertions. Earlier timing failures were resolved by a five-second wait for multi-stage blocker release and a fifteen-second cold bootstrap assertion, without changing financial invariants or browser/processor deadlines.

Commands actually executed (from repository root unless stated):

```powershell
npm run test --workspace=@electrohub/backend -- src/services/__tests__/payment src/services/__tests__/cart.service.test.ts src/services/__tests__/buynow.concurrency-scope.test.ts src/services/__tests__/checkout.domain.test.ts src/routes/payment.routes.test.ts src/routes/stripe-webhook.routes.test.ts src/routes/cart.routes.test.ts src/routes/checkout.routes.test.ts --exclude '**/payment.stripe.live.test.ts' --maxWorkers=1
npm run test --workspace=@electrohub/frontend -- src/features/checkout src/features/cart src/pages/customer/CartPage.test.tsx src/pages/customer/OrdersPage.test.tsx --maxWorkers=1
npm run test --workspace=@electrohub/frontend -- src/features/checkout/PaymentPurchases.test.tsx --maxWorkers=1
npm run test --workspace=@electrohub/frontend -- src/features/checkout/PaymentRetryPage.test.tsx --maxWorkers=1
npm run typecheck --workspace=@electrohub/backend
npm run typecheck --workspace=@electrohub/frontend
npm run build --workspace=@electrohub/backend
npm run build --workspace=@electrohub/frontend
# From apps/frontend, with API/SDK interception and frontend-only Vite port 3129:
../../node_modules/.bin/playwright.cmd test -c playwright.payment-lifecycle.config.ts
../../node_modules/.bin/playwright.cmd test -c playwright.payment-lifecycle.config.ts payment-lifecycle.spec.ts
# Dummy offline URLs were explicitly set for schema/client commands:
apps/backend/node_modules/.bin/prisma.cmd validate --schema apps/backend/prisma/schema.prisma
apps/backend/node_modules/.bin/prisma.cmd generate --schema apps/backend/prisma/schema.prisma
git -c core.safecrlf=false diff --check
```

Scoped ESLint commands cover the affected backend payment/domain/order/cart/routes/tests and frontend checkout/cart/orders/layout/browser/config files; final additions were linted separately. Complete per-workspace lint and full remote CI are not claimed.

Final visual inspection: [desktop Cart](evidence/payment-lifecycle-2026-10-12/cart-1440.png), [mobile Cart](evidence/payment-lifecycle-2026-10-12/cart-390.png), [saved retry](evidence/payment-lifecycle-2026-10-12/retry.png). The updated retry capture was inspected: one status link, saved shipping/total, explicit Pay consent, and no duplicated Review/Pay action. Hosted Stripe fields remain unverified because the browser uses an explicit intercepted SDK fixture.

Source architect assessment: **90/100**, an engineering judgment, not an external certification. Remaining acceptance gates are PostgreSQL migration/concurrency and authorized hosted lifecycle/provider verification; applicable Figma parity and CI on the published source also remain unverified. No remaining P0/P1 source defect was identified. No claim of 100% hosted completion or merge readiness is made.

## Final integration checkpoint — 2026-10-12

The independent Task 03.6 integration review and authorization follow-up are recorded in [TASK_03.6_FINAL_INTEGRATION_REVIEW.md](TASK_03.6_FINAL_INTEGRATION_REVIEW.md). The follow-up records explicit owner authorization and Prisma application of only `20261012120000_payment_purchase_ownership` to DEV. Post-migration schema, Prisma ledger and read-only integrity checks passed; the affected offline backend suite passed 307/307. No worker/API service or payment/Stripe operation was run.

The executable PostgreSQL concurrency integration suite covering scenarios A–J remains unrun against PostgreSQL; no authorized disposable test database was used. The separate SQL contract harness also remains unrun. Hosted Stripe, background recovery runtime and cross-tab live behavior remain **NOT VERIFIED / BLOCKED**. Merge remains NO.

### Disposable PostgreSQL concurrency gate — 2026-10-12

Owner authorization was provided, but the suite's required disposable target/gate environment variables were absent. The DEV Prisma URL was not substituted; no PostgreSQL connection, fixture creation, local database, or cleanup operation occurred. Scenarios A–J are **BLOCKED / NOT RUN**. Offline guard tests passed 2/2 and `node --check` passed. Review also found that the existing script tests a reduced synthetic SQL schema rather than application services, and its cleanup silently ignores schema-drop failures; see the final integration review before any future execution.
