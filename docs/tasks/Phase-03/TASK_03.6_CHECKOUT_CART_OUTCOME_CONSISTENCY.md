# Checkout / Cart authoritative outcome consistency

2026-10-16. Task 03.6 remains OPEN; NO PUSH. This is local source verification plus narrowly scoped real-account observation, not financial acceptance.

## Exact purchase and observed cause

The screenshots identify attempt `bdf8f98a-f440-4cef-a910-b585f8425080`, USD349 Apple iPad 10 Wi-Fi 64GB — Yellow, intent `pi_3URAQiKiVgdl63pN1Po0ngMG`, Test account `acct_1UEZW5KiVgdl63pN`, DEV project `pzxekjybdiulzmssalfo`.

Read-only DEV readback: AWAITING_INPUT, providerStatus requires_payment_method, READY work, zero retries/no last error, no Order. Stripe readback at 12:55:45.942 UTC: requires_payment_method, Test Mode, no payment method, no last error/decline code, received/capturable zero. This does **not** establish a decline. No financial state was changed for this attempt.

`isResolvedPayment` incorrectly included AWAITING_INPUT; `PaymentRecovery` then rendered it as a red failure headed “Payment needs a different card.” Cart correctly retained this backend classification as pending. Thus the screenshot's failure was frontend presentation, not an authoritative backend decline. The previous browser assertion explicitly expected that incorrect screen and has been corrected. READY work not progressing is still an operational recovery concern; no global DEV worker was started to mask it.

## Source correction

- `paymentPresentation.ts`: AWAITING_INPUT is no longer a resolved outcome. Retry-entry eligibility is a separate `canResumePaymentEntry` predicate, because `/resume` approval is not proof of failure.
- `PaymentRecovery.tsx`: removes the false AWAITING_INPUT failure heading, red failure notice and terminal retry presentation. Unconfirmed attempts retain Checking; confirmed declines retain the existing failure view.
- `SavedPurchaseCheckout.tsx`: explicit retry uses entry eligibility before/after `/resume`, preserving same-attempt identity, backend eligibility checks, fresh card entry and genuine CHECKOUT_CHANGED rejection.
- `PaymentPurchases.tsx`: backend-confirmed failure snapshots immediately update an existing shared purchase row, without inventing notification unread state or touching Cart B. Incoming list rows with older backend timestamps cannot overwrite newer outcomes. Newer legitimate retry versions remain accepted. Existing capture proof and refund handling remain intact.
- Tests updated: `PaymentRecovery.test.tsx`, `paymentObservation.test.ts`, `payment-recovery-navigation.spec.ts`.

No backend/payment-provider source, schema, migration, CI or logging pipeline changes in this correction.

## Verification

Commands from `apps/frontend`:

```text
npx vitest run src/features/checkout/PaymentRecovery.test.tsx src/features/checkout/paymentObservation.test.ts src/features/checkout/PaymentPurchases.test.tsx src/features/checkout/PaymentSessionIsolation.test.tsx src/features/checkout/SavedPurchaseCheckout.retry.test.tsx --maxWorkers=1 --no-file-parallelism
npx vitest run src/features/checkout/SavedPurchaseCheckout.retry.test.tsx --maxWorkers=1 --no-file-parallelism
npx playwright test -c playwright.payment-recovery-navigation.config.ts
npx playwright test -c playwright.payment-recovery-navigation.config.ts --grep 'submitted card-entry purchases'
npx playwright test -c playwright.payment-success-sync.config.ts --grep 'eligible retry requires'
npm run typecheck
npm run lint
```

The initial focused 88-test run passed. During the retry-predicate edit, a partial multi-file patch left the helper temporarily unexported: a subsequent build failed and two retry unit cases failed safely into the unverified view. The export was completed; final retry-only rerun **3/3 passed**, with the other 85 unique focused cases unchanged and passing. Final typecheck/lint exit 0. `git --no-optional-locks -c core.safecrlf=false diff --check` exit 0.

Chromium: initial recovery suite **10/10 passed** at 390px/1366px; extended decline-to-retry cases initially caught the shared-predicate coupling, then **2/2 passed** after the fix. They verify Checking rather than a false failure, navigation to Cart, automatic authoritative DECLINED transition, no pending card, Failed payments, exactly one failure toast, Try Again to Payment, empty hosted-card fixture before/after refresh, and no submit/reconcile/confirm request. Existing successful-retry journeys **2/2 passed**, including explicit card entry, Review/Place Order, Paid result, history/refresh and Cart B isolation. These are real Chromium with intercepted API/Stripe boundaries, not real charges or PostgreSQL transaction acceptance. Vite retains the existing bundle-size warning.

Screenshots in `.cache/payment-lifecycle-followup/shots`: `unconfirmed-checkout-390/1366.png`, `confirmed-decline-390/1366.png`. Mobile Checking and desktop Failed payments/one toast were visually inspected. The synthetic product/image fixture is not the actual customer's purchase.

## Actual account observation

At the owner's explicit request, CUSTOMER_CRED from the backend `.env` was consumed in memory without printing or persisting credentials/tokens. A separate headless Chromium context signed into the real localhost application (HTTP200), read the owned purchase and opened its explicit Checkout route. Checkout mutation endpoints were blocked; no financial action occurred. Ordinary sign-in/refresh uses the application's authentication session workflow. No auth security code was modified.

Live purchases HTTP200 returned the exact attempt as AWAITING_INPUT / AWAITING_CUSTOMER_ACTION, pending=true, retryAllowed=false, updatedAt 12:41:06.857 UTC. Corrected Checkout displayed Checking your payment, with no Payment not processed text. This proves the actual account still has an unfinished purchase; it does not prove a decline. Receipt: `.cache/payment-lifecycle-followup/real-account-readback.json`. Actual-account screenshots: `real-account-cart-1366.png`, `real-account-checkout-1366.png`.

## Remaining boundary

The source inconsistency is corrected and verified locally. The live USD349 attempt remains unfinished; it has not been canceled, force-failed, paid, hidden or deleted. Previous explicit cancellation approval applied to the separate USD719 attempt 080806E3, already reconciled CANCELED/DONE. A separate guarded USD349 application cancellation is prepared at `.cache/payment-lifecycle-followup/cancel-349-dev-attempt.ts`, **NOT EXECUTED**, and requires explicit owner authorization for this exact purchase. It rechecks account/project, no Order, exact amount/intent binding and unpaid provider state, uses the existing cancellation workflow and records Cart/inventory hashes.

Real disposable PostgreSQL/new-card Stripe acceptance and monitored alert delivery remain NOT VERIFIED; no approved isolated runtime was established. Do not treat intercepted tests as those results or declare Task 03.6 closed. No staging, commit, push, deployment, migration or PROD access occurred.

## 2026-10-16 owner-authorized USD349 cancellation

The owner subsequently explicitly authorized canceling only unfinished Test Mode reference BDF8F98A through the existing safe workflow. From `apps/backend`, the reviewed command was:

```text
npx tsx ../../.cache/payment-lifecycle-followup/cancel-349-dev-attempt.ts
```

**Exit 0, verified at 13:08:47.902 UTC (16:08:47 Beirut).** Fresh exact-project/account/amount/intent binding and unpaid-provider checks passed. Existing `PaymentService.cancel` completed the cancellation; no global runner or create/capture/refund operation ran. Stripe is canceled, received/capturable zero; DEV attempt is CANCELED/providerStatus canceled, work DONE with leaseUntil null and no last error. No Order exists. Before/after hashes confirmed Cart and relevant inventory unchanged; zero active Cart lines. An independent read-only DEV query confirmed CANCELED/DONE and both lease fields cleared. Receipt: `.cache/payment-lifecycle-followup/dev-349-cancellation-evidence.json`.

This supersedes the earlier “not canceled” status for this specific purchase. Its normal customer projection is FAILED/nonpending for a canceled purchase, not an invented card decline. Cancellation cannot preserve a reusable Stripe intent: the existing approved same-intent Try Again flow applies to eligible DECLINED attempts, not canceled intents. The real-account browser verification is recorded separately in `real-account-canceled-readback.json`; a first attempt timed out and a second diagnostic read was prepared without payment actions. No production source changes or repeated unit suite were needed for this authorized operational step; prior verification remains applicable.

**Final real-account verification: exit 0.** Sign-in HTTP200; two purchases GETs HTTP200 omitted this attempt; `purchaseListed=false`, `pendingCardCount=0`. Its explicit Checkout route displayed Payment did not complete / Payment not processed for the verified cancellation. The `/read` acknowledgment was blocked so this separate verification context did not consume the owner's notification. No payment mutation was sent by the browser. Screenshots: `.cache/payment-lifecycle-followup/shots/real-account-canceled-cart-1366.png` and `real-account-canceled-checkout-1366.png`. Thus no Failed-card visibility is claimed for the actual Cart: the live list omitted the purchase, and the verified requirement here is absence from Processing plus a correct canceled outcome. The separate intercepted decline-to-Failed/empty-retry journeys remain the evidence for that distinct contract.
