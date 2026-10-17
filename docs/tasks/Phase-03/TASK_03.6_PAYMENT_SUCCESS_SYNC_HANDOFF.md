# Payment success / Cart / Orders / notification synchronization

Local source work, 2026-10-15–16. Base branch `feature/Stripe`, HEAD `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`. Task 03.6 remains OPEN; NO PUSH.

## Scope and ownership

Owner request: fix the failed-payment retry and new-payment navigation scenarios, including the attached `/checkout?step=review` rejection screenshot, without financial operations on shared environments. This is the scoped FRONTEND / PAYMENT change request under `AGENT_COORDINATION.md`: cache synchronization, saved retry observation, notification presentation and their tests. PAYMENT/FRONTEND/Architect review remains required for integration. Existing uncommitted work was the starting point and is preserved.

Changed existing source: `apps/frontend/src/features/checkout/{CheckoutPage.tsx,PaymentPurchases.tsx,RestoredPurchase.tsx,SavedPurchaseCheckout.tsx,paymentResume.ts,types.ts}`. Extended existing tests: `PaymentPurchases.test.tsx` and one scoped visible-toast locator in `apps/frontend/tests/checkout/payment-toasts.spec.ts`. New source/tests: `paymentObservation.ts`, `paymentObservation.test.ts` in the same directory; `apps/frontend/tests/checkout/payment-success-sync.spec.ts`; `apps/frontend/playwright.payment-success-sync.config.ts`; this handoff.

No backend payment/provider/order/inventory implementation, Prisma schema/migrations, AUTH security logic, logging implementation, dependency versions, CI workflow or Git index is owned or edited by this task. The existing backend capture, locking, idempotency and ownership controls remain authoritative.

## Reproduced root causes

Before source changes, both original scenarios failed in intercepted Chromium at **390×900 and 1366×900** (four failures). The addendum's Back-to-Review scenario also failed at both widths (two failures). The screenshot was inspected. The supplied `assets/figma` tree is absent in this checkout; no new visual design or CSS is introduced. Existing Checkout/Cart/toast components are reused.

1. **Unmounted saved retry still consumed success.** `SavedPurchaseCheckout.place()` awaited reconciliation and called `settle()` without checking the generation again. `settle()` acknowledged the outcome and navigated to confirmation even after Cart became active. The failed browser snapshot showed Order Confirmed instead of Cart, with no success toast. Conversely, leaving while Stripe confirmation was still outstanding returned early and skipped the initial reconciliation handoff.
2. **Stale lists could stop observation.** Cart and the always-mounted notifications shared a ten-second purchases cache. Mounting Cart could reuse a fresh empty list; polling then stayed disabled because that list contained no pending purchase. An old declined row likewise did not poll. Cart's `settled` set also treated every decline as permanently terminal, although the same attempt can be retried.
3. **Retry navigation was treated as permission to resume again.** Browser history/refresh preserves `retryPurchase` in router state. Mounting the saved Checkout always called `/resume`. Every 4xx eligibility refusal became the same terminal rejection, including `PAYMENT_RECOVERY_PENDING` for an already-processing/paid purchase. The screen then claimed “Nothing was charged” without checking current payment status. This is the source of the attached error screen; a 409 alone does not prove prices changed or establish charge status.
4. **Orders refresh depended on presentation.** Existing invalidation primarily occurred when Cart observed a transition or a toast was delivered. An already-read result, an on-screen payment, or an off-screen completion could miss that path. Also, the ordinary Checkout and saved retry reused a payment-status cache key with different response shapes (`{data: outcome}` versus `outcome`).

These are reproduced frontend defects. The tests do not establish what Stripe or the shared database did in the user's historical browser session.

## Correction and financial boundary

- Saved Checkout first GETs its owned attempt. Pending/UNKNOWN/paid/already-submitted observations use the existing Checking/result flow. A resume conflict is followed by another owned status read. A `PAYMENT_RECOVERY_PENDING` conflict that still returns the previous DECLINED row remains Checking, without another confirmation. Only an actual `CHECKOUT_CHANGED` response with a resolved, non-paid result shows the price/availability/delivery rejection. Transport failures remain unverified. Unsupported “Nothing was charged” assurances were removed from this screen and from generic failed/refunded purchase copy; a confirmed decline retains its specific no-charge explanation.
- A session-scoped observation marker records only customer/attempt identity and the pre-confirmation state/version. It never stores a secret or claims PAID, modifies a server state, or restores items. While a new card confirmation is unresolved, the previous decline is presented as checking rather than as a new failure or an invitation to pay again. The marker survives refresh/history. A newly versioned backend terminal result, verified capture, explicit authoritative reconcile result, or pre-provider validation failure ends observation. Missing/invalid versions remain conservatively unresolved until better evidence arrives. Observation is scoped to its owner and does not expire unresolved work silently.
- Cart re-reads purchases on mount. Global observation follows submitted retries as well as backend-pending rows, retaining the existing bounded-read/backoff policy. A failed purchases-list read is checked again after 15 seconds while visible, including when a cached capture still needs authoritative unread metadata. This retries only a GET, never a financial operation. Navigation can refresh failed history too. A decline can transition back to pending under the same identity; only capture is treated as monotonic. A stale pre-capture list projection cannot overwrite a capture already verified in this client. Refund/compensation states remain observable.
- The initial authorized confirmation/reconciliation handoff finishes once even if Checkout unmounts. Results are checked against the captured attempt/Intent identity before cache publication. Shared-cache updates survive navigation; acknowledgment and navigation are restricted to the active component generation. Saved status uses its own query key and ignores pre-mount cached responses.
- `synchronizePaymentOutcome` publishes PAID only through the existing `hasVerifiedPayment` gate: backend `state=PAID`, `committed=true`, confirmation payment state PAID, and consistent order reference. It updates that purchase and confirmation cache and invalidates Orders. Notification newness still comes from the purchases endpoint's `unread`; capture status cannot invent an unread notification already acknowledged elsewhere. It does not change Cart B, checkout drafts, shipping or item ownership. Provider confirmation alone, an order reference, `requires_capture`, CAPTURE_PENDING and UNKNOWN do not satisfy the gate.
- Global Orders invalidation is independent of toast eligibility/unread state. A new captured result withdraws an obsolete failure notice for the same attempt. Existing notice keys, navigator-lock/local-storage deduplication, explicit state-qualified `/read` requests and 5,000-ms toast duration are preserved. Hidden screens cannot acknowledge an unseen outcome. Background results remain available for presentation on a visible eligible customer page.

No new payment-creation path, charge/capture retry loop, stock mutation, order creation or cart write was added. Actual database/Stripe duplicate prevention still depends on the existing backend controls; intercepted request counts cannot certify real financial durability.

## Verification commands and evidence boundaries

From `apps/frontend`, the dedicated Chromium config builds a fresh production frontend into the verified workspace `.cache/payment-success-sync/dist` directory and owns a separate preview server at loopback port 3158. It does not replace another owner's `dist`. All API and Stripe requests are intercepted before navigation; a proxy fallback points at closed loopback port 1. It never uses the user's running application, database or Stripe account.

```text
npx playwright test -c playwright.payment-success-sync.config.ts
npx vitest run src/features/checkout/paymentObservation.test.ts src/features/checkout/PaymentPurchases.test.tsx src/features/checkout/paymentResume.test.tsx src/features/checkout/PaymentSessionIsolation.test.tsx src/features/checkout/PaymentRecovery.test.tsx src/pages/customer/OrdersPage.test.tsx --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run lint
```

From the repository root:

```text
git --no-optional-locks -c core.safecrlf=false diff --check
```

The journeys project covers seven cases at each width: retry/leave/PAID; review Back/Forward/refresh while pending; delayed authoritative completion after the reconcile response; pending to genuine failure; genuine changed-price rejection; initial successful-card processing followed by Cart; and recovery conflict with a still-stale decline. Assertions cover no early success, automatic removal of resolved cards, existing order link and Paid Orders, Cart B independence, no new setup/Cart-write/second-confirmation request for retry, and a single state-qualified acknowledgment after dismissal. The notifications project reuses the five existing notification-reliability cases, including hidden/multiple tabs and failed `/read` behavior.

The tests use the real React app and Chromium with an intercepted Stripe SDK; `confirms=1` is a fixture invocation count, not evidence of a real Stripe authorization/capture. No authorized isolated Stripe account/database was supplied, so **real-backend/Stripe Test Mode acceptance is NOT VERIFIED**. No shared DEV/PROD database query/write, hosted Stripe operation, worker, migration or production access was performed. Stripe's [manual capture documentation](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) distinguishes authorization (`requires_capture`) from capture; this fix retains that distinction.

Recorded intermediate evidence: the initial 6-case post-fix browser suite passed; the expanded 12-case run passed 11 and timed out one mobile journey. A focused rerun of that case timed out during session initialization. Its trace shows intercepted `/api/auth/refresh` and `/api/auth/me` returning HTTP 200 after much of the overall test budget was spent; it had not reached payment submission. The shared workstation had approximately 689 MB free RAM at that observation. The overall browser journey budget was raised from 60 to 120 seconds, consistent with other repository journey configs; assertion deadlines and application/provider timeouts were not increased. A later development-server run passed four of five selected journeys and failed while waiting for initial card entry, before payment submission. The harness then switched to a fresh isolated production build to remove cold per-module development transforms from browser timing.

The first production-preview run passed all 12 journeys and four of five existing notification tests (16/17). The remaining test found two DOM matches for the acknowledgment error: the visible Radix toast and its accessible live-region announcement. Its locator was scoped to the visible Notifications region, preserving both UI and accessibility announcements. It was not disabled or made less strict about the expected error. These partial/failed runs are not reported as an all-pass suite.

Intermediate unit evidence: 93 tests passed across six files before the additional component regressions. The existing Orders pagination test emits JSDOM's `window.scrollTo` not-implemented diagnostic while passing. An initial typecheck caught a nullable indexed access in a new test; that test assertion was corrected. The final expanded unit run first found an outdated assertion for canceled-purchase wording; the assertion now requires accurate generic wording, no unverified no-charge assurance and no retry action. One intervening run loaded that test before its new `within` import was saved and failed with a test-only ReferenceError. Both issues were fixed before the final passing run.

Screenshots are saved outside Playwright's automatically cleared output directory at `.cache/payment-success-sync/shots/`; JSON reports/traces are under `apps/frontend/test-results/payment-success-sync`. The root `.cache/payment-success-sync/baseline.json` records initial source bytes and repository file/index hashes; `expanded-first-result.json` records the expanded run's individual outcomes. These are local evidence, not CI or live-payment results.

## Completion status

Final local results on 2026-10-16:

| Verification | Result | Evidence scope |
| --- | --- | --- |
| Dedicated Chromium command above | Exit 0; 19 passed, zero skipped/flaky/unexpected; 279.5 seconds | Seven journeys at each of 390×900 and 1366×900, plus five notification reliability cases; production frontend with intercepted API and Stripe SDK |
| Focused Vitest command above | Exit 0; 98 passed across six files; 49.82 seconds | Mocked API/provider; React/JSDOM plus pure helper tests; includes automatic 15-second recovery after a failed purchases GET |
| `npm run typecheck` | Exit 0 | Frontend TypeScript build references |
| `npm run lint` | Exit 0 | Frontend ESLint |
| Vite production build launched by dedicated browser config | Exit 0 | Isolated cache output; existing bundle-size advisory remains |
| Root `git --no-optional-locks -c core.safecrlf=false diff --check` | Exit 0 | All tracked working-tree changes; separate whitespace/conflict-marker check passed for this task's new source/config/test files |
| Real backend / Stripe Test Mode | NOT VERIFIED | No authorized isolated backend/provider environment was supplied or accessed |

The final Chromium build includes the payment outcome, navigation, rejection, unread/deduplication and copy changes. The subsequent additive 15-second purchases-GET failure fallback is covered by the final component regression rather than claimed as browser-tested; the production branches exercised by the 19 browser cases were unchanged. No broad backend or integration suite ran.

Visual evidence was inspected at both widths during this task. Final saved images include the mobile success toast with View Order and preserved Independent Cart B, and desktop Checking on return to Review. Existing design components and styles were retained; this is functional/responsive evidence, not a pixel-perfect Figma approval. Screenshot capture disables animation to avoid recording an intermediate toast slide.

The final baseline comparison confirmed the physical Git index hash is unchanged. All 18 migration SQL files present in the task-start snapshot retain their exact raw hashes; this is preservation evidence, not approval of an expanded migration inventory. `.gitattributes` and `.github/scripts/migration-plan.cjs` retain their baseline hashes. Concurrent changes were observed in `apps/backend/src/services/payment.service.ts`, its `__tests__/payment.retry.test.ts`, and `apps/frontend/tests/checkout/real-stack.acceptance.spec.ts`; this task did not edit or overwrite them. These are outside this frontend handoff and their separate acceptance is not implied. The eight pre-existing files and five new files listed under Scope and ownership are this task's complete source/test/documentation change inventory. No index operation occurred.

Remaining limits: provider/webhook delays, network outages and server-side capture integrity remain backend/infrastructure concerns. An unresolved observation stays Checking until authoritative evidence arrives; it does not guess failure, silently expire the observation or enable another charge. With unavailable session storage the observation marker has a memory fallback but cannot survive a full reload; owned backend status and conflict verification still apply. Notification delivery still requires a visible eligible page and a successful purchases read. Actual duplicate prevention, durable order/stock effects and the exact historical browser incident require separately authorized isolated real-backend/Stripe acceptance. The intercepted suite cannot establish them.

Ready for PAYMENT/FRONTEND owner and Principal Architect review at the local-evidence boundary. The next owner action is review of this scoped frontend change, followed by separately authorized isolated backend/Stripe Test Mode acceptance before closing Task 03.6. No integration approval, financial acceptance, Architect score, merge or release verdict is assigned. Task 03.6 and all release safeguards remain open; NO PUSH.
