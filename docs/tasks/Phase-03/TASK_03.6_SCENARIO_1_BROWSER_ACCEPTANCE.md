# Task 03.6 — Scenario 1 browser/UX handoff — 2026-10-14

## Disposition and evidence boundary

Frontend workstream returned for independent Principal Architect review. No architectural score or approval is assigned here. Merge NO. Scenario 1 is **PARTIAL overall**: the customer UI is exercised in real Chromium with intercepted APIs/Stripe; real hosted payment finalization and the original intermittent setup incident are not verified. Live `--execute` remains blocked.

Branch: `feature/Stripe`. Starting Git HEAD: `3d69b97fbea4dbcb536ca1a7ed7bcd7dfa54ace4`. The starting working tree already contained substantial payment, authentication, database, logging, CI and catalog changes. This handoff certifies only the frontend changes listed below. Existing manual Scenario 1 evidence is preserved in `TASK_03.6_SCENARIO_1_VERIFICATION.md`.

Evidence categories:

- **A — REAL CHROMIUM + INTERCEPTED API:** executed using the actual React app, Router, React Query, Radix Toast, styles and iframe fixture. All `/api/**` requests and Stripe.js are intercepted before navigation. Provider responses and terminal transitions are controlled test evidence.
- **B — REAL CHROMIUM + REAL BACKEND:** NOT TESTED in this task. The local frontend preview starts no backend and uses no shared database.
- **C — REAL POSTGRESQL / REAL STRIPE:** NOT TESTED; outside this authorization. No PaymentIntent creation, card submission, authorization, capture, cancellation, refund, worker execution or remote record change occurred.

## Reproduction and root causes

| Symptom | Source/evidence | Determination and correction |
|---|---|---|
| A: pending purchase remains unresolved in the foreground | Pre-task `usePaymentPurchases` stopped its read interval when `Date.now()` passed a five-minute `pollUntil`. The retained browser failure shows no new list GET after the window despite a later controlled PAID result. Prior tests observed only short transitions. | Confirmed frontend defect. Current `PaymentPurchases.tsx:25` observes known unresolved purchases every 15 seconds while visible, stopping when none remain. Each read has a 10-second abort deadline; it never changes a payment state. Focus/reconnect revalidation remains enabled. |
| A: refresh error hides the known purchase | Pre-task `PendingPurchases` returned only its load-error paragraph whenever `query.isError`, including refetch failures with valid cached data. Intercepted GET 503 `PAYMENT_UNAVAILABLE` removed the card. | Confirmed frontend defect. `PaymentPurchases.tsx:62,78` retains last verified cards, reports that they could not be updated, and continues observation. Initial load failure stays explicit. UNKNOWN is never converted into failure. |
| Duplicate notifications in simultaneous tabs | Combined pre-fix browser run: 34 PASS / 1 FAIL; three visible toasts for two distinct outcomes. The old Web Locks callback scheduled a toast and released before React committed its presentation. The sequential two-tab test had not covered simultaneous startup. | Confirmed notification-lifecycle race. `PaymentPurchases.tsx:97,128` holds the presentation claim through the committed presentation/cache update. Cleanup releases interrupted claims. Existing server acknowledgement remains on dismissal only. Three separate repeated race checks passed after the correction. |
| Toast close placement / motion | Screenshot inspection showed the close button below the message; the shared content wrapper contains ToastClose. Existing shared CSS did not disable toast motion for reduced-motion users. | `Toast.module.scss:84,111,172` reserves message space, positions X at top right and disables state/swipe animations for reduced motion. Final geometry checks include both left/right and bottom bounds after entrance animation completion. |
| B: standalone checking screen | Current `PaymentStatusPage.tsx:3` redirects legacy bookmarks to `/cart?purchase=<encoded attemptId>`. Chromium verifies retained identity, no setup POST and no old checking page. Current foreground UNKNOWN exits to its durable Cart destination after the existing two-minute window. | Not reproduced in the current source. No route/backend change was needed. |
| C: fields load, then old error appears | Actual intercepted old A setup returns 503 after B's fields become ready; B stays usable, has no alert and retains its own secret. A genuine current setup 503 remains actionable, disables Review and triggers no automatic financial retry. Current Checkout generation/unmount guards reject stale results. | No current frontend contamination reproduced. The historical real setup 500/503 cause remains UNKNOWN and belongs to PAYMENT/runtime diagnostics. This task does not suppress it or claim it is fixed. |
| D: new B inherits old processing | Full A Review/submission → Home → Cart → Wishlist/product B → Add → Cart → Checkout B runs at all four widths. B shows its own skeleton, then usable intercepted fields. A completion leaves B's route and readiness intact. Existing browser test separately verifies B shipping preservation. | Not reproduced in current source. Existing ownership/generation controls were preserved; CheckoutPage and StripePaymentSession were not edited. |

## Source changes and ownership

Task-owned production changes:

1. `apps/frontend/src/features/checkout/PaymentPurchases.tsx` — foreground observation, retained refetch-error data, committed notification presentation claims, route-aware toast suppression and interrupted-claim cleanup.
2. `apps/frontend/src/components/ui/Toast/Toast.module.scss` — shared dismiss placement, text containment and reduced-motion override using existing tokens. This is the shared toast foundation, not a new notification component.

Task-owned tests/configuration:

3. `apps/frontend/src/features/checkout/PaymentPurchases.test.tsx` — cached-read failure/recovery, presentation cache and StrictMode/refetch deduplication regressions.
4. `apps/frontend/tests/checkout/scenario1-browser.spec.ts` — 23 expanded real-browser scenarios, response evidence attachments, controlled deadlines, late responses, navigation, simultaneous tabs and four-width screenshots.
5. `apps/frontend/playwright.scenario1.config.ts` — combined expanded + existing purchase suite, isolated frontend preview on port 3141, no reuse of another owner's service; JSON report and failure traces.

Documentation:

6. This report.
7. Append-only checkpoint in `docs/tasks/Phase-03/TASK_03.6_SCENARIO_1_VERIFICATION.md`.

`CheckoutPage.tsx`, `StripePaymentSession.tsx`, and `Checkout.module.scss` match their task-start byte hashes. No AUTH, CartProvider, payment service, Prisma, migration, database harness, logging, infrastructure, CI or acceptance-execution file was edited by this task. The shared branch's unrelated changes remain present.

Two-production-file SHA-256: `406a51cbe23f0cb9a90e020b571ca98da3e88935a46fd57a5718f37e7d77034e`. Formula: sort the two repository paths, concatenate `path + LF + lowercase raw-file SHA-256 + LF`, SHA-256 that UTF-8 content. This is a scoped source fingerprint, not a running-service fingerprint.

## Browser transitions and financial isolation

The complete controlled journey starts with A (mouse, USD 49.00), performs Review/Place Order, submits A exactly once and observes processing. The customer navigates via actual Router links to Home and Cart, opens B through Wishlist/Product Details, adds B (buds, USD 149.00), returns to Cart and starts Checkout B.

Assertions verify A is absent from B's payable total, pending cards have no payment/status action, setup keys differ for A/B, only one A submit and one intercepted confirm occurred, B's separate `pi_B` fixture owns secure entry, and A's completion cannot change B's route/readiness. No mock helper silently turns UNKNOWN into PAID; tests explicitly change the intercepted backend record when exercising a verified terminal projection.

Terminal PAID/DECLINED list projections drive Cart's existing 450ms inline outcome/collapse, then removal. Already-declined records render in Saved purchases rather than Pending purchases. Secure retry keeps the exact failed attempt identity and requires the explicit Pay action. PAID remains accessible through Orders/confirmation; toasts carry View Order where the API supplies its reference.

Each read deadline/503/network failure leaves the last known purchase state intact. A held, aborted UNKNOWN list response delivered after newer declined truth cannot resurrect the pending card. Genuine current setup failure is displayed rather than hidden. Legacy URLs do not submit/reconcile a purchase. The UNKNOWN foreground deadline hands off to Cart by durable identity without a second submission.

## Commands and results

All commands below run from `apps/frontend`:

```text
npx playwright test -c playwright.scenario1.config.ts --workers=1
npx playwright test -c playwright.scenario1.config.ts --workers=1 --grep "simultaneous tabs" --repeat-each=3
npx vitest run src/features/checkout/PaymentPurchases.test.tsx src/features/checkout/CheckoutPage.test.tsx src/features/checkout/PaymentRecovery.test.tsx src/features/checkout/PaymentRetryPage.test.tsx src/features/checkout/paymentResume.test.tsx src/features/checkout/StripePaymentSession.test.tsx src/features/checkout/PaymentStatusPage.test.tsx src/components/ui/Toast/Toast.test.tsx --maxWorkers=1
npm run typecheck
npx eslint src/features/checkout/PaymentPurchases.tsx src/features/checkout/PaymentPurchases.test.tsx tests/checkout/scenario1-browser.spec.ts playwright.scenario1.config.ts --max-warnings 0
npm run build
```

- Combined Chromium suite: **36 PASS / 0 FAIL / 0 SKIP**, exit 0 (23 expanded + 13 existing purchase scenarios). Final JSON start: `2026-10-14T15:56:19.732Z`; duration: `117982.352 ms`; flaky: 0. The JSON report retains per-test results and sanitized intercepted response attachments.
- Focused frontend suite: **120 PASS / 0 FAIL / 0 SKIP**, eight files, exit 0. Includes shared Toast regressions. Full frontend suite was not run.
- Separate simultaneous-tab race repetition: **3 PASS / 0 FAIL / 0 SKIP**; overlaps the combined suite and is not added as unique coverage.
- Frontend typecheck, scoped lint and build exit 0. Existing approximately 650 kB bundle advisory remains. Backend tests were not rerun: no backend/shared API contract changed.
- Scoped tracked diff check plus whitespace checks for untracked task files pass. The baseline no-index comparison reports differences (exit 1), with no whitespace diagnostics. Toast line 30 has pre-existing trailing whitespace outside this task's hunks and is preserved. The two-production-file credential-pattern scan has no matches for Stripe key/webhook-secret, database URL or private-key patterns; synthetic fixture secrets are explicitly test-only. This does not certify every possible secret or every file in the shared dirty tree.

Earlier runs were not promoted to final passes: pre-fix polling/background-error failures, a simultaneous-tab duplicate failure, and harness clock/counter/readiness failures are recorded. A development run reported `Failed to fetch dynamically imported module .../src/render.tsx`; its exact transport cause was not established. Source edits were occurring during that dev run. Frozen production-preview runs remove HMR variability and passed. Assertions for totals, identities, submission counts, terminal removal and deduplication were retained. The test clock is installed before navigation; repeated foreground polls are advanced after their responses, and toast screenshots await animation completion. Test-only cache retention matches the application's five-minute default for the storage-disabled presentation-cache assertion.

## Visual evidence and inspection

New screenshot directory: `apps/frontend/test-results/scenario1-browser/` — **41 PNGs** from real Chromium, all using intercepted API/Stripe fixtures. The visible secure-entry iframe is clearly labeled as an intercepted UI test. Viewport heights are 900px; widths are 390, 768, 1440 and 1920px.

Preserved copies of all 41 PNGs and the final `report.json` are in `docs/tasks/Phase-03/evidence/scenario1-browser-20261014/`, independent of the next Playwright output cleanup. The owned preview on port 3141 was no longer listening after the suite; no other owner's process was terminated.

For each width `W`, captures include:

| State | Filename |
|---|---|
| Pending A / active B | `W-cart-pending-A-active-B.png` |
| B initial skeleton | `W-B-skeleton.png` |
| B ready fields | `W-B-ready.png` |
| Centered processing | `W-processing.png` |
| Success outcome and finished removal | `W-PAID-inline.png`, `W-PAID-cart-clean.png` |
| Failure outcome and finished removal | `W-DECLINED-inline.png`, `W-DECLINED-cart-clean.png` |
| Completed entrance of success/failure toast | `W-PAID-toast.png`, `W-DECLINED-toast.png` |
| Durable retry destination / reduced motion | `reduced-motion-retry-destination.png` |

Screenshots were opened and inspected for mobile and desktop pending/active separation, clean terminal end states, skeleton/ready states, centered loader, toast placement and retry access. Four-width assertions check document overflow, pending-row bounds and toast bounds. Final Cart screenshots use active B's USD 149.00 total. Inline frames are evidence of the transition only; separate `cart-clean` frames are captured after removal. Toast frames are captured after their entrance animation finishes, not mid-slide.

Visual findings: compact pending section above active Cart; no navbar status strip; no competing Checkout title/stepper/summary in processing; no overflow detected; top-right X and contained toast text; success/failure styling uses existing Radix/token foundation; reduced motion disables purchase exit/loader/toast animation. Existing repository Figma reference READMEs were inspected under `docs/assets/figma/exports/`; customer screenshot assets were absent. No live Figma frame/parity claim is made. The intercepted iframe's internal typography is a fixture, not hosted Stripe visual acceptance.

Before-fix failures/traces are retained under `.cache/scenario1-browser-20261014/baseline-failures`, `baseline-polling`, and `combined-before-claim-fix`. Earlier owner screenshots/manual evidence remain independent historical references.

## 24-item acceptance matrix

All PASS entries refer to **A: real Chromium + intercepted API**, supplemented by source/unit evidence where stated. None grants a real hosted-payment PASS.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | No navbar pending banner | PASS | Full four-width journey; absent pending/status links |
| 2 | Compact styled pending card | PASS | Four-width captures and row/document bounds |
| 3 | A excluded from B total | PASS | Full journey: summary USD 149.00, not USD 49.00 |
| 4 | A cannot be paid twice through this UI flow | PASS | One A submit/confirm, no pending Pay action, UNKNOWN handoff without resubmit; real financial guarantees are outside scope |
| 5 | Pending reflects API truth | PASS | PROCESSING/UNKNOWN/terminal controlled projections; no timeout-forged state |
| 6 | PAID removes pending card | PASS | Inline outcome and completed collapse at four widths |
| 7 | Terminal failure removes pending card | PASS | Declined transition and already-declined initial load |
| 8 | Durable terminal access | PASS | Saved-purchase retry keeps attempt; success View Order/Orders access |
| 9 | Success toast, bottom right, dismissible, 5s | PASS | Bounds, keyboard/manual close, clock expiry and existing real-time auto-dismiss test |
| 10 | Failure toast, bottom right, dismissible, 5s | PASS | Same independent failure assertions |
| 11 | No duplicate notifications in tested conditions | PASS | StrictMode/refetch unit test, concurrent shared-storage/Web Locks tabs, reload and three race repetitions; unavailable coordination is a stated limitation |
| 12 | Legacy status route is safe | PASS | Cart redirect retains A; no financial POST |
| 13 | Original processing UI after Review | PASS | Centered animated loader; no Checkout heading or summary |
| 14 | B clean initial state | PASS | Separate four-width skeleton, no A processing/error state |
| 15 | B secure entry usable | PASS | Intercepted iframe filled, Review enabled; not hosted SDK acceptance |
| 16 | Old errors cannot contaminate B | PASS | Old A setup 503 delivered after B ready; no B alert/replacement |
| 17 | UNKNOWN accurately recoverable | PASS | Deadline/network/reload, late result and foreground two-minute handoff |
| 18 | Refresh/navigation/second tab identity | PASS | Router Back/Forward, reload, tab close/reopen, simultaneous tabs |
| 19 | Four responsive widths | PASS | 390/768/1440/1920 geometry assertions and screenshots |
| 20 | Accessibility essentials | PASS | Status live region, keyboard retry/X, focus, reduced motion; full assistive-technology audit not performed |
| 21 | Relevant frontend unit tests | PASS | 120 passed, eight files |
| 22 | Actual Chromium journey | PASS | 36 passed; APIs/Stripe intercepted |
| 23 | Typecheck/lint/build | PASS | Exit 0; bundle advisory retained |
| 24 | No unauthorized/cross-workstream action | PASS | Frontend manifest only; no external operations, backend edits, staging/commits/deployment or other process termination |

## Residual risks and next gates

- The actual hosted backend setup 500/503 and finalization behavior remain **BLOCKED / NOT VERIFIED** under this task's no-financial-execution boundary. The earlier historical root cause remains UNKNOWN. PAYMENT owner needs a new correlated sanitized runtime record; any live setup/provider mutation requires separate exact owner authorization.
- Notification coordination is browser-local. Web Locks + writable shared storage passed simultaneous-tab tests. Without Web Locks or shared storage, cross-tab atomic delivery is not guaranteed. With storage disabled, same-tab cache/ref deduplication works during its lifetime; reload/cross-device deduplication needs successful server acknowledgement. No exactly-once notification guarantee is claimed.
- A user who leaves Cart before the 450ms inline presentation completes may receive the result later elsewhere; it is intentionally not acknowledged before presentation. Orders and Saved purchases retain durable access even after toast dismissal.
- Pure API GET/read deadlines alter only observation. No cancelled/unknown financial mutation is retried by this workstream.
- Backend finality/idempotency/concurrency and actual hosted Stripe visual behavior require their separate workstreams and approvals. This report does not certify the broad uncommitted branch.

## Rollback and architect handoff

Before-source copies are retained under `.cache/scenario1-browser-20261014/before/`. Rollback should invert only this task's hunks in PaymentPurchases and Toast styles after comparing against those copies; preserve all later/unrelated edits. Remove only the task-created config/spec/report if unchanged and separately requested. Do not reset the shared branch or replace checkout/auth/database files. No database or provider rollback is required because none was changed.

Review the two production-file diff, three test/config paths, this matrix, final JSON/browser attachments and inspected screenshots. The frontend evidence is ready for independent architectural review. The Architect owns the approval decision; merge remains NO.
