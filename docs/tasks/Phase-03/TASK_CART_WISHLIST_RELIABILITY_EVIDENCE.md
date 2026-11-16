# Cart/Wishlist reliability — focused evidence

## Confirmed source findings and corrections

- `CartPage.tsx:94`: the global Cart observer survives navigation, so route re-entry did not trigger query mount revalidation. Validate failed/stale reads once on entry, share startup reads, reuse fresh snapshots, and use an accepted pending mutation's response instead of an extra GET. Settled errors clear only after successful server validation.
- `CartProvider.tsx:126` and `WishlistProvider.tsx:73`: development StrictMode could cancel and restart owner reads. The existing shared-read signal policy now applies to verified owner-keyed collection queries. Production cancellation remains enabled.
- `CartProvider.tsx:195` and `WishlistProvider.tsx:161`: reads started during a mutation could publish an older snapshot or error after its authoritative response. Cancel those reads at the response publication boundary; owner/epoch checks remain intact.
- `CustomerHeader.tsx:41`: unresolved counts without hints were announced as zero. Shared Skeleton/busy states now distinguish unknown counts from confirmed empty collections. Existing global providers and verified-auth query gates remain intact.
- `ProductCard.tsx:84` and `ProductDetailPage.tsx:118`: same-action clicks lacked a synchronous in-flight guard. Guard pending actions, disable duplicate submissions, and clear old reset timers. Success still requires the authoritative mutation response; stock failures remain actionable.
- Cart/Wishlist HTTP routes return `private, no-store` JSON and ignore stale conditional GET validators; the API client bypasses private HTTP caches. Historical 304 server logs do **not** establish that browsers received a bodyless 304.

## Scope

Production: `apps/backend/src/routes/{cart,wishlist}.routes.ts`; `apps/frontend/src/lib/api.ts`; `src/features/{cart/CartProvider,wishlist/WishlistProvider}.tsx`; `src/features/cart/context.ts`; `src/components/{ui/ProductCard/ProductCard,layout/CustomerHeader/CustomerHeader}.tsx`; `src/pages/customer/{ProductDetailPage,CartPage}.tsx`.
Backend test changes: `apps/backend/src/routes/cart.routes.test.ts`, `apps/backend/src/routes/wishlist.routes.test.ts`.
Frontend test changes under `apps/frontend/src/`: `lib/api.test.ts`; `features/cart/CartProvider.test.tsx`; `features/cart/CartAvailabilityRegression.test.tsx`; `features/wishlist/WishlistProvider.test.tsx`; `components/ui/ProductCard/ProductCard.test.tsx`; `components/layout/CustomerHeader/CustomerHeader.test.tsx`; `pages/customer/ProductDetailPage.test.tsx`.
Browser changes: `apps/frontend/tests/checkout/cart-availability.spec.ts`; reusable `apps/frontend/playwright.cart.config.ts`. Total: 23 source/test/config/documentation paths touched in this pass, excluding ignored validation logs/configs.
Documentation: this file and `docs/05_Features/CART.md`. Preserve all pre-existing working-tree changes.

## Measurement and limits

- Existing sanitized backend HTTP records: Cart GET approximately 10.9–16.9s, Wishlist GET 15.0–20.4s. These are server ingress-to-finish durations, not pure database or network latency. Authentication/database attribution and a live after-measurement remain UNKNOWN.
- Unit regressions assert immediate pending feedback, optimistic counts/rollback, shared startup reads, stale-read rejection, genuine unavailable inventory, and no extra successful mutation GET. They are not live latency benchmarks.
- Offline browser APIs and Stripe are intercepted before navigation. A blank pre-React cold Vite page caused initial browser failures; final verification uses the production build without changing application timeouts.
- No database/provider operations, payment workers, financial source changes, SECURITY-01 changes, commits or deployments. Live acceptance remains blocked.
- Root cause of the reported live availability banner is not conclusively bound without its failing HTTP status/code/request ID. The confirmed races are corrected; genuine backend failures must not be hidden.

## Reproduction

- Backend: `npx vitest run src/routes/cart.routes.test.ts src/routes/wishlist.routes.test.ts src/services/__tests__/cart.service.test.ts src/services/__tests__/wishlist.service.test.ts`.
- Frontend: scoped API, Cart provider/availability/sync, Wishlist provider, AuthContext query, ProductCard, ProductDetailPage and CustomerHeader suites; `--maxWorkers=1`.
- Browser: `npm run build`, verify port 3127 is free, then `npx playwright test -c playwright.cart.config.ts`. Never reuse/terminate a foreign server.
- Both backend/frontend typechecks, scoped ESLint and builds executed. Frontend build retains the existing large-chunk warning.
- Scoped diff/credential checks clean; whole-tree diff check has pre-existing trailing EOF blanks in Cart `storage.ts` and `storage.test.ts`.
- Runtime SHA-256 (sorted ten production paths, each path + LF + raw-file SHA-256 + LF): `d40849b8d2074aa48612b1aa4b19641ed6ed06166feb30971d0c8e390cec395b`.

## Verification disposition

- Backend: 50 PASS / 0 FAIL / 0 SKIP across four route/service files.
- Latest outcomes by frontend file: 143 PASS / 0 FAIL / 0 SKIP across nine files. Reruns replace earlier outcomes, not additional unique coverage. Auth hydration's one-request assertion remains unchanged; its fixture now preserves the app's persistent QueryClient.
- Production-preview browser run: 12 PASS / 2 FAIL / 0 SKIP. All eight Cart/Wishlist cases and all three Payment → Cart cases passed. Try Again still failed to enable Review at 390px and 768px (`payment-retry.spec.ts:79`); 1440px passed. Do not classify the broader checkout flow as verified.
- Both Add cases were rerun with exact one-item POST/response quantities and a confirmed one-item subtotal; both passed. They overlap the 14-case run and are not added to its coverage count.
- Initial worker startup errors, generic-error test-fixture mismatch, cold Vite blank pages and duplicate entry-read regression were recorded and addressed. No assertions or application timeouts were relaxed.
- Both backend/frontend typechecks, scoped lint and builds passed. The last frontend build took 1m18s and retained the existing large-chunk warning.
- Auth/startup screenshot inspected at 1280px: Cart structure and both header badges show placeholders while verification is held, with no false empty state. Relevant repository Figma assets were absent; no Figma fidelity claim.
- Source corrections and offline Cart journeys are verified. Actual DEV availability failures, database stage attribution, mutation latency before/after and live browser behavior remain unverified.
- Recommendation: NO MERGE. Preserve the two broader payment-retry failures and obtain sanitized failing API code/request timing before claiming permanent runtime closure.

## Final regression closure — 2026-10-12

- This section supersedes the browser disposition above; historical runs remain preserved.
- Original Try Again failures: `payment-retry.spec.ts` expected enabled Review after recovery. Its reconcile POST returned DECLINED, while the shared harness's later GET still returned AWAITING_INPUT for the same attempt (HTTP 200). The inconsistent fixture kept the old attempt nonterminal. The exact-attempt GET now retains DECLINED/failureCode after reconciliation (`payment-retry.spec.ts:47–50`). No production payment-state change was justified by that fixture failure.
- Production Cart defect: mount-only initialization captured loading state; pathname-only observation also missed rapid away/back transitions. `routes/index.tsx:18–32` now observes history-entry keys outside the route Suspense trees. `CartPage.tsx` no longer owns mount-only revalidation.
- `CartProvider.tsx:431–440` exposes route validation, shares in-flight reads, and consumes a successful mutation snapshot once within the existing 30s/15s freshness windows. Identity changes clear the shortcut; genuine validation errors remain visible. The route listener waits for accepted mutations before validating.
- Added fresh/expired-snapshot regressions in `CartProvider.test.tsx`; browser re-entry verifies failed validation disables Checkout and later successful validation clears the error. URL transitions, request counts, idempotency keys, ready inputs and confirmation assertions remain enforced.
- Final frontend: **222 PASS / 0 FAIL / 0 SKIP**, 13 files, `npx vitest run ... --maxWorkers=1` (the previously listed twelve files plus `features/cart/storage.test.ts`).
- Final backend: **50 PASS / 0 FAIL / 0 SKIP**, four route/service files using the command above.
- Final production-preview browser run: **14 PASS / 0 FAIL / 0 SKIP**, `npx playwright test -c playwright.cart.config.ts --reporter=list --workers=1 --trace=on`.
- Formerly flaky Cart re-entry: three additional repeated executions PASS; these overlap the fourteen scenarios and are not additional unique coverage.
- A resource-concurrent frontend run timed out three unchanged Checkout assertions; the full serial rerun passed. No assertion, test timeout or application timeout was weakened.
- Measured actual browser click-event → pending UI: Product Card **5.1ms**, Product Details **20.8ms**, while the Add API response was deliberately held. Timing starts at the DOM click event and ends at the observed disabled/pending button mutation.
- Cart/Wishlist API server/network/database latency remains **NOT MEASURED in this pass**: browser routes are intercepted. Earlier server durations above are historical only. No before/after speed improvement is claimed.
- Reviewed the scoped Cart/Wishlist source delta, ownership/query boundaries and retry fixture. Public HTTP contracts and payment fencing/idempotency remain unchanged. No financial production source or SECURITY-01 edits in this closure.
- Fresh frontend/backend typechecks, scoped ESLint and production builds PASS; frontend retains the existing large-chunk advisory. Whole-tree `git diff --check` PASS after removing two pre-existing trailing EOF blank lines from Cart storage files. Scoped credential-pattern scan: no findings.
- Inspected the 390px retry screenshot: hosted-SDK fixture inputs visible, Review enabled, correct Express total, no error banner. This is offline UI evidence; actual hosted Stripe remains unverified.
- Source edits: `apps/frontend/src/features/cart/{CartProvider.tsx,context.ts}`; `apps/frontend/src/pages/customer/CartPage.tsx`; `apps/frontend/src/routes/index.tsx`.
- Test/fixture edits: `apps/frontend/src/features/cart/{CartProvider.test.tsx,CartSyncPerformance.test.tsx}`; `apps/frontend/src/features/checkout/CheckoutPage.test.tsx`; `apps/frontend/src/pages/customer/{CartPage.test.tsx,CartPage.stories.tsx}`; `apps/frontend/tests/checkout/{cart-availability.spec.ts,payment-retry.spec.ts}`.
- Whitespace-only edits: `apps/frontend/src/features/cart/{storage.ts,storage.test.ts}`. Documentation: this evidence file and `docs/05_Features/CART.md`. Existing unrelated working-tree changes preserved.
- Scoped runtime fingerprint: **5032a6b738b1015470759a3a9ae495104c257cd41235fd2014474873537131e3**. Same ten production paths/formula above plus `apps/frontend/src/routes/index.tsx`; not a full-repository or live-runtime fingerprint.
- Owned test preview shut down; port 3127 verified available. No real Stripe/database operations, workers, commits or deployment. Live `--execute` remains blocked.
- Remaining: actual failing DEV request/status/timing evidence and real-service acceptance. Offline regression closure complete; merge requires independent review and the existing operational/payment gates.
