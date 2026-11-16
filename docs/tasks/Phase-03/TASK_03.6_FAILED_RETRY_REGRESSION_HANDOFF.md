# Failed-payment retry regression follow-up

2026-10-16, branch `feature/Stripe`, base HEAD `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`. Task 03.6 remains OPEN. NO PUSH.

## Findings and attribution

This is a correction to the previous payment synchronization handoff, not a new financial implementation. The task-start source and hashes are retained in `.cache/payment-retry-followup/baseline.json`; the earlier pre-synchronization snapshot remains in `.cache/payment-success-sync/baseline.json`.

The previous change introduced an unconditional `observedPaymentIds(...).has(attemptId)` diversion before reconciling that marker with the freshly read owned status. A stale submitted marker could route a **newer confirmed decline** to Payment Failed/observation instead of calling `/resume` and displaying secure entry. A regression test failed before the correction: the page showed Payment Failed at `step=payment`, with no entry. The correction applies the existing version-aware terminal observation logic to that fresh status before deciding whether a marker is still unresolved. An unchanged pre-confirmation decline remains blocked; no marker is blindly cleared on Try Again.

A second defect is inherited from the earlier saved-retry component: it trusted `step=review` in router history after its Payment Element was destroyed. Its Review-ready flag was not reset on a new entry epoch. Before correction, Chromium reproduced this at both 390×900 and 1366×900: Cart → Try Again → fill card → Review → refresh remained on Review without a live completed card entry. This missing gate was already present in the pre-synchronization snapshot; it is not falsely attributed to the latest synchronization patch.

The entire reported rejection → automatic Processing → Order Confirmed sequence was **not reproduced** in this isolated investigation. Source inspection found no automatic call to `place()` or `confirmPayment()` on eligible retry entry. Success navigation requires `hasVerifiedPayment`: backend PAID, committed order, confirmation payment PAID and matching order reference. The exact historical `/resume` code, provider state and backend responses are unavailable without separately authorized real-environment evidence. A real `CHECKOUT_CHANGED` followed by a separately confirmed PAID result must not be assumed to be a frontend auto-charge. No shared database/provider access was used to fill this evidence gap.

## Small correction

Production source changes are confined to `apps/frontend/src/features/checkout/SavedPurchaseCheckout.tsx`:

- Reconcile an old observation marker with the fresh owned status before testing retry eligibility.
- Reset local Review completion on entry initialization and return to Payment. A restored Review URL is replaced with `step=payment` until this current secure entry validates.
- Guard `place()` itself with current entry completion and the Review step, in addition to the existing busy/identity guards.
- Fence asynchronous validation by the component generation, so an obsolete validation cannot navigate a new entry session.
- Recheck `/resume` response identity and outcome before exposing its secret to entry. A raced PAID, UNKNOWN, recovery or no-longer-retryable response is observed instead. Existing ownership, `CHECKOUT_CHANGED` and recovery conflicts retain their safety behavior.

Only explicit Review Order validation advances entry; only explicit Place Order calls the existing confirmation and reconciliation handoff. The existing `StripePaymentSession` still mounts the production Stripe Payment Element. Reload/retry destroys its completed entry and creates a fresh entry; no card details, `paymentComplete` flags or submitted Cart B draft are restored into this component. The same PaymentAttempt and Intent are required. No backend, provider, stock, inventory, order creation, migration, API contract, dependency or notification implementation was changed.

Changed tests: `apps/frontend/tests/checkout/payment-success-sync.spec.ts`; new `apps/frontend/src/features/checkout/SavedPurchaseCheckout.retry.test.tsx`. This document is the fourth task-owned file. Prior concurrent work remains intact.

## Verification boundary

All browser cases run real Chromium and the real React app, with the existing API and Stripe SDK interception harness. The SDK iframe is explicitly labeled an intercepted fixture; it is **not real hosted Stripe card entry or proof of a provider charge**. The production component still uses the existing Stripe Payment Element, but real hosted entry/backend/Stripe Test Mode acceptance remains NOT VERIFIED: no authorized isolated real backend/provider environment was supplied or accessed. No live authentication, database, payment or worker operations ran.

The dedicated config owns a fresh production build in `.cache/payment-success-sync/dist` and loopback preview port 3158; fallback API proxy points to closed loopback port 1. Payment-entry screenshots are `.cache/payment-retry-followup/payment-entry-390.png` and `payment-entry-1366.png`. Existing Cart/Orders/notification screenshots remain under `.cache/payment-success-sync/shots`.

From `apps/frontend`:

```text
npx vitest run src/features/checkout/SavedPurchaseCheckout.retry.test.tsx src/features/checkout/paymentObservation.test.ts src/features/checkout/PaymentPurchases.test.tsx src/features/checkout/paymentResume.test.tsx src/features/checkout/PaymentSessionIsolation.test.tsx src/features/checkout/PaymentRecovery.test.tsx src/pages/customer/OrdersPage.test.tsx --maxWorkers=1 --no-file-parallelism
npx playwright test -c playwright.payment-success-sync.config.ts
npx playwright test -c playwright.payment-success-sync.config.ts --project=journeys --grep "authoritative PAID outcome"
npm run typecheck
npm run lint
```

From the root: `git --no-optional-locks -c core.safecrlf=false diff --check`.

Before source correction, the new component tests had two failures/one pass (exit 1), and the initial Chromium retry test failed at both viewports (exit 1). The unchanged-old-decline safety case passed before and after correction. One intermediate component assertion was corrected to await React Router's asynchronous URL replacement; card entry itself already displayed correctly.

The expanded browser run passed 27/29 and failed two newly added already-PAID cases (exit 1). Those fixtures incorrectly returned PAID from status but PENDING from Order readback; the error snapshots showed “Payment is being confirmed”. The application preserved that server readback rather than inventing success. The fixture was corrected to share its authoritative state across status, purchases and Orders, with no change to application capture guards. Results of the affected rerun and final checks are recorded below.

## Completion evidence

| Final check | Result | Scope |
| --- | --- | --- |
| Focused Vitest command above | Exit 0, 101 tests across seven files, 54.48 seconds | Three new component regressions plus 98 existing focused tests; mocked API/entry; unchanged-old-decline safety retained |
| Final full dedicated Chromium command above | Exit 0, 29 passed, zero skipped/flaky/unexpected, approximately 2.1 minutes | Twelve journeys at each viewport plus five notification cases; API/SDK interception |
| Already-PAID focused fixture-correction rerun | Exit 0, two passed | Both viewport cases; followed by the final full passing run |
| Frontend typecheck | Exit 0 | Current production and component-test source |
| Frontend lint | Exit 0 | Repeated after final browser-test edits |
| Dedicated Vite production build | Exit 0 | Task-owned isolated cache output; existing bundle-size advisory remains |
| Root tracked diff whitespace check | Exit 0 | No staging/index writes; task-owned new files also checked separately |
| Real backend / hosted Stripe Payment Element / Stripe Test Mode | NOT VERIFIED | No authorized isolated environment was supplied or accessed |

The final Chromium assertions explicitly require the real app's `#processing-heading` to be absent before submission and visible only after explicit Place Order while the reconciliation response is held pending. They assert zero confirmation/reconciliation calls before submission, fresh empty card fields after reload and re-entry, one confirmation/reconciliation after submission, no new PaymentAttempt setup or Cart-write requests, final backend-fixture PAID outcome, and independent Cart B. Other cases cover retry decline, already-PAID, UNKNOWN, PROCESSING, recovery conflict, genuine `CHECKOUT_CHANGED`, delayed confirmation, automatic Cart removal, Paid Orders, toast deduplication, hidden tabs and `/read` failure. No test or safety rejection was removed or disabled. The existing Orders pagination unit test still emits JSDOM's `window.scrollTo` diagnostic while passing.

Final screenshots at both widths were inspected. They show the saved purchase's products/address/delivery/total, Payment as the current step, empty intercepted card entry and Review Order. Existing layout/components/styles were retained. The supplied screenshot served as the rejection-state reference; `assets/figma` is absent. This is functional visual evidence, not Figma pixel approval or real Stripe-hosted acceptance.

The task-start byte audit found only the owned existing source and browser spec changed, plus a concurrent change to `apps/frontend/tests/checkout/real-stack.acceptance.spec.ts`. That concurrent file was not edited or overwritten here. The new component test and this document complete the four-file ownership inventory. Backend payment/provider/AUTH/logging files, migration SQL, Git attributes, migration guard and physical Git index retain their task-start hashes. Local reports are preserved under `.cache/payment-retry-followup`, including before/expanded/focused browser reports and final source/scope fingerprints; final Playwright output is under `apps/frontend/test-results/payment-success-sync`.

The complete eligible retry journey works in isolated intercepted Chromium at both requested widths. Provider durability, actual card replacement and the full historical reported error-to-success sequence remain unverified in a real backend/Stripe environment. This handoff does not claim those facts or authorize shared-data testing. Next owner action: review this four-file correction and provide a separately authorized isolated backend/Stripe Test Mode acceptance environment if live integration closure is required. No release or Architect approval is assigned. Task 03.6 remains OPEN; NO PUSH.
