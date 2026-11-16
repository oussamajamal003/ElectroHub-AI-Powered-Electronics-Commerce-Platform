# Task 03.6 — Scenario 1 verification — 2026-10-13

Decision: REQUEST CHANGES. Scenario 1 PARTIAL (offline functional/UI proof); live finalization acceptance BLOCKED by operational authorization. Proposed score: 85/100, not independent approval.

## Evidence and corrections

- Read-only DEV lookup of screenshot attempt `79972f29-3ac6-4093-aee8-5d148acc95a4`: DECLINED, requires_payment_method, PAYMENT_DECLINED; submitted 2026-10-12 18:20:53.009 UTC, updated 18:23:11.500 UTC. Work `ea50aca5-fdc0-49cb-942b-4bce14043eb6` remained READY, no lease. No records modified.
- This establishes a later definite decline, not the provider state at screenshot time. Earlier checking duration/worker absence cannot be conclusively attributed without correlated runtime evidence.
- `payment.service.ts:648`: provider-confirmed decline now finishes the current fenced work DONE. Attempt stays retryable; no new business terminal state, capture, cancellation, timeout, or isolation change. Unknown readbacks retain recovery. Historic READY work is untouched.
- Purchase projection now includes immutable thumbnail, submission time and server-computed retry eligibility; retry/resume still verifies ownership/provider truth. No migration.
- Legacy status URL redirects to Cart with attempt identity preserved in query; no status API removed and no financial submission on redirect. Checkout timeout handoff now uses Cart instead of standalone status UI.
- Removed navbar pending indicator and Cart status link/manual refresh. Compact cards separate saved quantities/totals from active cart; UNKNOWN says Awaiting confirmation; retry link requires server eligibility.
- Existing CheckoutProcessing/ElectroHubLoader retained, not replaced with clock screen. Git history has checkout implementation commit `67be366`; local `assets/figma` absent. No Figma parity claim.
- Existing Radix Toast components: bottom-right viewport, 5000ms, manual close, success/failure only for definitive outcomes. Layout observer survives route navigation, one poll owner, visible-tab 15s reads bounded to five minutes, renewed on focus/reconnect. No background financial reconcile POST or cart invalidation.
- Notifications claim per-customer/attempt/state local storage under Web Locks where supported, then use existing state-fenced server acknowledgement on dismissal. Orders retain success, Cart retains failed retry eligibility. Storage-disabled browsers and cross-device deduplication are not verified; Web Locks unavailable fallback is not atomic across tabs.

## Fresh verification

- Backend: 136 PASS / 0 FAIL / 0 SKIP in payment.service, payment.lock-order, payment.purchase-ownership, payment.routes, stripe-webhook.routes suites. Deterministic DB/provider doubles; no PostgreSQL or real Stripe proof.
- Frontend: 88 PASS / 0 FAIL / 0 SKIP in PaymentPurchases, PaymentStatusPage, CheckoutPage, PaymentRetryPage, CartProvider suites.
- Browser: 11 PASS / 0 FAIL / 0 SKIP, `cd apps/frontend; npx playwright test -c playwright.purchases.config.ts --workers=1`. Fully intercepted APIs/SDK; owned frontend preview only.
- Browser proves mobile/desktop pending isolation, success/decline auto-dismiss and reload deduplication, legacy redirect, processing loader, completion preserving B shipping/route, manual dismissal, UNKNOWN safety, two-tab deduplication.
- Backend/frontend typechecks, scoped ESLint, builds and full diff check passed. Existing frontend bundle-size advisory remains. Scoped credential-pattern scan found no key matches. Schema unchanged, so Prisma validation not rerun.
- Initial test failures included obsolete UI expectations and duplicate Radix announcement locator; corrected expectations preserve no-resubmission/identity checks. Sandbox cache failures occurred before test execution; final suites ran successfully outside sandbox.
- Screenshots inspected: `apps/frontend/test-results/purchases/cart-pending-390.png`, `cart-pending-1440.png`, `toast-PAID.png`, `toast-DECLINED.png`, `checkout-processing-390.png`, `checkout-processing-1440.png`. Screenshot totals use intercepted fixture B, not real catalog acceptance.

## Changed paths and remaining gates

- Production: `apps/backend/src/services/payment.service.ts`; frontend `src/features/checkout/{PaymentPurchases.tsx,PaymentStatusPage.tsx,CheckoutPage.tsx,Checkout.module.scss}` and `src/layouts/CustomerLayout.tsx`.
- Tests: backend `src/services/__tests__/payment.service.test.ts`; frontend `src/features/checkout/{PaymentPurchases.test.tsx,PaymentStatusPage.test.tsx,CheckoutPage.test.tsx}`, `tests/checkout/payment-purchases.spec.ts`, `playwright.purchases.config.ts`. Documentation: this report and canonical checkpoint.
- Six-production-path scoped SHA-256: `c7092c83a8e9f58a0b433dd8a7478e085d8e244c26a35cf4de6cedc9822b1aba`. Formula: sorted path + newline + raw-file SHA-256 + newline, hash concatenation. Not full repository or running service fingerprint.
- Required runtime gate: approved exact-attempt/work scoped recovery with safe capacity, owned services and explicit financial scope. No global worker, historical job processing, financial mutations, Stripe calls, deployments or SECURITY-01 changes performed. Live --execute remains blocked.
- Not separately evidenced this pass: tab-close real backend finalization; concurrent capture/stock effects in PostgreSQL; actual hosted Stripe. Existing mocked ownership suites cover source invariants only.
- Merge: NO pending independent review and authorized operational acceptance.

## Manual rejection remediation — 2026-10-13

- Decision: REQUEST CHANGES; Scenario 1 PARTIAL. The separate real setup-500/timeout gate remains BLOCKED by missing correlated error evidence and the prohibition on replaying financial setup. No manual PASS claimed.
- Confirmed projection defect: `payment.service.ts:219` treated every non-PAID/non-restored purchase as pending, including DECLINED. Pending now derives from `customerPaymentStatus`; definitive failures remain durable and separately retryable. UNKNOWN remains pending. No GET triggers provider work.
- Confirmed loader defect: `CheckoutPage` returns `PaymentRecovery` in its recovering branch before the normal processing render. `PaymentRecovery.tsx:35` now mounts the shared CheckoutProcessing/ElectroHubLoader, with stacked styled navigation actions and no View Payment Status. Foreground recovery deadline and safe Cart handoff remain unchanged.
- Cart tracks transitions previously observed as unresolved. Verified success/failure briefly shows an outcome indicator, then collapses over 450ms. Already-terminal failures go directly into compact Saved purchases, never Pending purchases. Explicit retry preserves the attempt identity. No restoration into Cart B occurs.
- Cart suppresses duplicate result toasts; other routes use existing bottom-right Radix toasts, duration 5000ms and manual close. No toast for UNKNOWN. Orders refresh on success, without cart/checkout invalidation or navigation.
- In-tab presentation deduplication uses existing QueryClient cache (bounded to 100 keys), plus persistent local storage and Web Locks where supported. Storage-disabled browsers still receive toasts. Cross-device/exactly-once delivery is NOT guaranteed; server state-fenced acknowledgement occurs on toast dismissal, not before presentation. Failed results remain in Saved purchases; success remains in Orders.
- Saved-purchase retry now points directly to Cart rather than the legacy status experience; legacy bookmarked status URLs remain compatible through the existing redirect.
- Setup error: owner supplied POST /api/checkout/payment-attempts HTTP500, a setup-readiness timeout screenshot, and a later refresh showing usable card inputs. SQL excerpts contained no values, exception or duration. These facts do not establish the 500 cause. No timeout increase, hidden error, replacement intent or automatic financial retry added.
- Host read-only inspection found existing API5000/frontend3000 listeners. No service started/stopped. Retained error logs lacked a correlated failure for the screenshot; test-generated log events are not runtime evidence for it.
- Read-only customer-scoped DB lookup: latest attempt 09e5b703-1a47-45bb-a314-76008521cb6f was AWAITING_INPUT/requires_payment_method, unsubmitted, no failure code, work READY without lease/error. Previous 16805ad8-d817-49a2-bd86-5d992dcd37aa was PAID with work DONE. No provider readback or database mutation was performed. This supports later readiness, not an explanation for the earlier failure.
- Fresh frontend: 110 PASS / 0 FAIL / 0 SKIP in PaymentPurchases, PaymentRecovery, CheckoutPage, StripePaymentSession, CartProvider; separate PaymentRetryPage 5 PASS / 0 FAIL / 0 SKIP. Final affected PaymentPurchases repeat: 15 PASS (overlapping; not added).
- Fresh backend: 124 PASS / 0 FAIL / 0 SKIP in payment.purchase-ownership, payment.service, payment.routes, stripe-webhook.routes. One earlier run reported 58 logging-transport unhandled errors and was not accepted as clean proof; subsequent rerun had none. Logging maintenance EPERM warnings were observed; production logging files were not changed in this task.
- Backend/frontend typechecks, scoped ESLint and builds exited 0. Full diff check passed; scoped credential-pattern scan found no key matches. Existing frontend chunk-size advisory remains. No schema changes; Prisma validation not required this pass.
- Reproducible browser command: cd apps/frontend; npx playwright test -c playwright.purchases.config.ts --workers=1. All APIs/Stripe SDK behavior are intercepted; no financial backend process is started by this suite.
- Updated mocked screenshots: apps/frontend/test-results/purchases/manual-before-{PAID,DECLINED}.png, manual-inline-{PAID,DECLINED}.png, manual-after-{PAID,DECLINED}.png, manual-home-{PAID,DECLINED}.png, manual-mobile-pending.png, manual-processing.png, manual-new-B.png, manual-retry-destination.png. Inline animation is paused at 100ms only for capture; transitions/removal are separately asserted. No real Stripe proof or Figma parity claim.
- Changed production files this pass: apps/backend/src/services/payment.service.ts; apps/frontend/src/features/checkout/PaymentPurchases.tsx, PaymentRecovery.tsx, CheckoutComponents.tsx, Checkout.module.scss, PaymentRetryPage.tsx.
- Changed tests: backend payment.purchase-ownership.test.ts; frontend PaymentPurchases.test.tsx, PaymentRecovery.test.tsx, CheckoutPage.test.tsx, PaymentRetryPage.test.tsx; tests/checkout/payment-purchases.spec.ts. Documentation: this report and canonical checkpoint. Unrelated working-tree changes preserved.
- Six-production-file scoped SHA-256: 47315635b23fb311a623cacfc704db22d60412d96349908baf3274e6b30d629b. Formula remains sorted path/newline/raw-file SHA-256/newline, hash concatenation; not a running-service or whole-repository fingerprint.
- Remaining gates: owner manual verification against updated source; correlated backend exception/request ID for the setup500; separately authorized controlled payment acceptance if reproduction would require provider mutations. No historical worker, Stripe mutation, financial DB write, deployment, commit or SECURITY-01 change. Live --execute remains blocked.
- Proposed score 80/100; merge NO. The reported new setup error is not declared fixed.
- Final browser result: 13 PASS / 0 FAIL / 0 SKIP, exit 0; scoped browser ESLint exit 0. Covers inline success/failure removal, initial declined state, Home toasts, mobile UNKNOWN/reduced motion, both processing branches, legacy URL, new B Elements, B shipping preservation, storage-disabled notifications, shared-storage tabs and secure saved retry.

## Expanded Scenario 1 Chromium/visual handoff — 2026-10-14

See `TASK_03.6_SCENARIO_1_BROWSER_ACCEPTANCE.md` for the new independent frontend investigation, exact ownership manifest, root causes, 24-item scoped matrix and rollback plan. This checkpoint does not replace the prior manual/runtime evidence above.

- Corrected frontend purchase polling stopping after five minutes, loss of known cards during background read errors, and a simultaneous-tab presentation race. Existing toast styles now reserve the top-right X and respect reduced motion. No backend, auth, Prisma, logging, pool, migration, worker, live-gate or CI source was changed by this workstream.
- Final actual Chromium + intercepted API/Stripe: **36 PASS / 0 FAIL / 0 SKIP**, exit 0; includes 23 expanded journeys and the existing 13 purchase regressions. Separate concurrent-tab repetition: 3 PASS, overlapping coverage. Final focused frontend: **120 PASS / 0 FAIL / 0 SKIP**, eight files, exit 0.
- Frontend typecheck, scoped ESLint and build passed; existing bundle advisory retained. Task-scoped diff/credential checks passed. Before-fix failures and superseded test artifacts are recorded in the new report rather than hidden.
- Four widths (390/768/1440/1920) and 41 new Chromium screenshots cover A/B separation, inline outcomes and final removal, clean B skeleton/readiness, original centered processing, success/failure toast final positions and saved retry. Screenshots are clearly intercepted-fixture evidence, not real Stripe proof or Figma parity.
- Scoped two-production-file SHA-256: `406a51cbe23f0cb9a90e020b571ca98da3e88935a46fd57a5718f37e7d77034e`. Overall Scenario 1 remains **PARTIAL**; real hosted setup/finalization and the historical setup 500/503 remain NOT VERIFIED/BLOCKED. Principal Architect review requested; no self-approval, financial operation, commit, push or deployment. Merge NO; live `--execute` stays blocked.

