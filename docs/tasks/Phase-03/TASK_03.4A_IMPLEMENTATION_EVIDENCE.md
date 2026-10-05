# Task 03.4A — Customer Inventory and Inventory Core evidence

## Status and execution boundary

**CLOSED — the authenticated out-of-stock decrement correction is covered by local service and Express-route tests and by the targeted authenticated DEV API re-gate recorded below. The frontend production build typing blockers are fixed and the production build passes.**

Branch: `feature/Inventory`. Starting HEAD: `bb49a7fac4d4f39b191804bdf5e2820821c62229`. No commit, push, merge, self-approval, migration application, seed, or production write was performed. Gemini completed the separately reported live gate documented below. Codex later ran only the targeted DEV authenticated Cart re-gate using disposable data, which it cleaned up; no curated Product or account data was changed. The authoritative `TASK_03.4_CUSTOMER_INVENTORY.md` is preserved with its additive visual-invariants section. The current approved shell, Product facts, media and dependencies remain unchanged.

Evidence categories are deliberately separate: UNIT/component mocks, in-process API tests, INTERCEPTED browser UI, LOCAL REAL API/read-only browser, and LIVE DEV/database. Green local results do not satisfy the live database gate.

## Related-file manifest and review

The review prompt `docs/prompts/REVIEW_PROMPT.md` and all changed/new task implementation files were read in full. Final patches were reviewed. Existing Prisma Inventory fields, enum, unique Product relation and relevant migration conventions were inspected; the Prisma schema and historical migrations are unchanged. The earlier file manifest incorrectly listed `docs/01_Project Foundation/ROADMAP.md`; that file was not changed and is removed from the manifest below.

| Boundary | Changed/new files |
|---|---|
| Inventory core | `apps/backend/src/services/inventory.service.ts`; `services/__tests__/inventory.service.test.ts`; `services/__tests__/inventory.postgres.test.ts`; `apps/backend/prisma/migrations/20261005000000_inventory_nonnegative/migration.sql` |
| Product/Search | `apps/backend/src/services/product.service.ts`; `search.service.ts`; `services/__tests__/product.service.test.ts` |
| Cart/Wishlist | `apps/backend/src/services/cart.service.ts`; `wishlist.service.ts`; `services/__tests__/cart.service.test.ts`; `services/__tests__/wishlist.service.test.ts`; `apps/backend/src/routes/cart.routes.test.ts`; `apps/backend/src/routes/cart.quantity-correction.integration.test.ts` |
| Shared commerce | `apps/frontend/src/components/ui/CartItem/{CartItem.tsx,CartItem.test.tsx}`; `ProductCard/{ProductCard.tsx,ProductCard.module.scss,ProductCardSkeleton.tsx,ProductCard.test.tsx,ProductCard.stories.tsx}`; `QuantitySelector/{QuantitySelector.tsx,QuantitySelector.test.tsx}`; `StatusBadge/StatusBadge.stories.tsx` |
| Feature projections/cache | `apps/frontend/src/features/products/types.ts`; `stockPresentation.ts`; `features/search/api.ts`; `features/cart/types.ts`; `CartProvider.tsx`; `CartProvider.test.tsx` |
| Customer pages | `apps/frontend/src/pages/customer/{CartPage.tsx,CartPage.test.tsx,CartPage.stories.tsx,ProductDetailPage.tsx,ProductDetailPage.module.scss,ProductDetailPage.test.tsx,ProductPurchaseActions.tsx,ProductPurchaseActions.stories.tsx,WishlistPage.stories.tsx,WishlistPage.test.tsx}` |
| Browser tests | `apps/frontend/tests/catalog/inventory.spec.ts`; `apps/frontend/tests/storybook/inventory.stories.spec.ts` |
| Documentation | `docs/05_Features/{INVENTORY,PRODUCTS,PRODUCT_API_02.5,CART,WISHLIST}.md`; `docs/03_Architecture/DATABASE_ARCHITECTURE.md`; `docs/04_Engineering Standards/STATE_MANAGEMENT.md`; `docs/06_Database/{MIGRATIONS.md,TASK_03.4A_INVENTORY_HANDOFF.md}`; `docs/08_Quality/{TESTING,STORYBOOK}.md`; authoritative task and this evidence file |
| Final closure additions | ProductCard/Product Details unknown-stock regressions; QuantitySelector/CartItem/CartPage independent OOS decrement regressions; inventory and Storybook Playwright semantics; targeted Cart quantity-correction service/route tests; updated source fingerprint and required DEV re-gate documentation |

Paths shortened within table cells share the explicitly listed directory for that boundary. Other existing route/provider components were inspected only as direct dependencies; no new auth, QueryClient, stock-write route or global store was introduced.

## Requirement matrix

| Requirement | Classification | Evidence / limitation |
|---|---|---|
| Existing stock quantity/threshold/enum retained | Implemented | Prisma fields unchanged; CHECK-only forward SQL |
| In Stock / Low Stock / Out of Stock derivation | Implemented | `deriveStockStatus`: 0, 1, threshold, threshold+1, threshold zero tests; stored status is not read as authority |
| Missing/invalid Inventory vs real zero | Implemented | `projectInventory`: null/0/false; missing/nullable frontend `stockStatus` remains neutral and unavailable, while only explicit `OUT_OF_STOCK` is labeled Out of Stock; component, Product Details, Storybook and Playwright regression coverage |
| Internal snapshot and purchase validation | Implemented | `InventoryService.getSnapshot`, `validateRequestedQuantity`, `validateInventoryPurchase`; active/hidden Product checks |
| Integer bounds and safe stock primitives | Implemented | set accepts zero; positive deltas; signed int bounds; guarded update after `FOR UPDATE`; existing transaction client has no nesting |
| Nonnegative physical constraints and genuine concurrency | Implemented — Gemini live gate | Gemini reports migration and both physical CHECK constraints pass on DEV/PROD and a real last-unit race ends at zero with one `INVENTORY_CONFLICT`; the two separate local PostgreSQL tests remain SKIPPED because `INVENTORY_TEST_DATABASE_URL` is unset |
| Compatible Product/Search DTOs | Implemented | Additive stockStatus/availableQuantity/purchasable; existing bounded SQL/projections, Decimal strings, grouped rating and images retained |
| ProductCard and StatusBadge reuse | Implemented | Shared adapter covers Home, Products, Search, related Products and Wishlist; statuses and low-stock feedback; independent hearts/navigation/Cart |
| Details remaining quantity / stock shrink / gallery | Implemented | existing `min(999, stock - Cart)` logic, invalid selection reset to 1; production action composition; background and gallery browser test |
| Cart server restriction and guest validation | Implemented locally | Combined Add, update and reconcile validation; API error mapping; tampered/over-stock guest rows remain invalid and visible |
| Cart LOW_STOCK semantic compatibility | Implemented | Separate nullable stockStatus; line LOW_STOCK continues to mean requested quantity exceeds stock |
| Explicit correction/removal and checkout blocking | Implemented and verified locally and on DEV | OOS controls expose decrement and remove while blocking increment/checkout. `CartService.setQuantity` compares the request with the persisted Cart quantity inside the serializable transaction. Strict decreases require an existing owned line, existing active Product/category, valid Inventory and valid positive quantity, but skip stock sufficiency. Equal-quantity requests and increases retain full stock validation. Service and Express route tests plus the targeted authenticated DEV API re-gate cover the behavior. |
| Wishlist OOS preservation | Implemented | Saved zero-stock Product stays navigable/removable; Add-to-Cart disabled; missing Inventory not mislabeled OOS |
| No Cart/Wishlist Inventory mutation | Implemented — local and Gemini DEV gate | Service tests/client checks plus Gemini-reported authenticated DEV Cart and Wishlist checks with unchanged Inventory |
| Existing query/cache/loading architecture | Implemented | No per-card query, polling or broad invalidation; cached Details content retained on refresh/failure; optimistic Cart validity checks last confirmed stock |
| Structural skeleton stock space | Implemented | ProductCard skeleton has stock row reused by Wishlist; unresolved Product stays structural loading |
| Storybook / responsive / accessibility | Implemented locally | Final closure: 24 production-component stories, four widths, WCAG A/AA axe; 96 story/viewport combinations |
| Focused browser A–V mapping | Implemented locally | Eight named tests below; intercepted APIs explicitly labeled |
| Real-browser/live verification | Partially Implemented | Local Playwright covers intercepted frontend state and responsive behavior; Gemini separately reports the authenticated DEV and database gates PASS. The live gate does not claim a full live-backend visual matrix. |
| Inventory/API/state/testing/roadmap docs and 05.3 handoff | Implemented | Updated documents and preflight/deployment/service reuse handoff |
| Admin UI, Checkout, reservations, alerts | Deferred / not in 03.4A | No endpoint/UI/inventory reservation added; existing deferred Checkout treatment retained |

## Playwright A–V matrix — final-tree run only

All eight tests are in `apps/frontend/tests/catalog/inventory.spec.ts`. They exercise the actual React routes with intercepted API responses; they do not prove live backend persistence. Name references below identify exact tests:

- **States:** `A–F, K, U, V: stock states stay coherent and OOS navigation/heart remain usable (intercepted API)`
- **Cart boundaries:** `G–J, L: exact stock, tampered guest quantity and stock shrink preserve invalid rows (intercepted API)`
- **Unavailable:** `O: unavailable Products remain recoverable without an Out of Stock claim (intercepted API)`
- **Responsive:** `R–T: responsive stock controls, keyboard and reduced motion (intercepted API)`
- **Auth conflict:** `M: authenticated stock-conflict response rolls back quantity and shows sanitized feedback (intercepted API)`
- **Transitions:** `D–F: stock transitions 1 to 0 to 1 update purchase controls on refresh (intercepted API)`
- **Background:** `N: slow background stock refresh preserves content and selected gallery image (intercepted API)`
- **No stock writes:** `P–Q: Cart and Wishlist intents leave stock presentation unchanged and issue no stock writes (intercepted API)`

| Scenario | Local result | Named evidence / scope |
|---|---|---|
| A ProductCard In Stock | PASS | States: stock 6, Add enabled |
| B ProductCard Low Stock | PASS | States: stock 5, Low Stock, Add enabled |
| C ProductCard OOS | PASS | States: Add disabled; heart and Details navigation still work |
| D Details In Stock | PASS | States + Background: quantity selection; remaining-max component tests |
| E Details Low Stock | PASS | States + Responsive: Only N left and increment stops at N |
| F Details OOS | PASS | States + Transitions: Add disabled; heart remains usable |
| G Cart exact stock | PASS | Cart boundaries: 2 to 3 permitted; increment then disabled |
| H Cart above stock | PASS | Cart boundaries + Auth conflict; service/API tests prove server rejects over stock |
| I Existing Cart stock shrink | PASS | Cart boundaries: quantity 5/stock 3 retained; explicit correction reaches 3 |
| J Existing Cart OOS | PASS — guest/intercepted UI, local route/service, and targeted authenticated DEV API | Catalog test uses guest validation: zero-stock line remains; with quantity 3, increment is blocked, decrement persists 2, checkout remains blocked and Remove works. Backend service and Express-route tests use mocked persistence; the separate targeted DEV gate below verifies authenticated route behavior and real database persistence. |
| K Wishlist OOS | PASS | States: saved Product remains, OOS shown, Remove works |
| L Guest tamper | PASS | Cart boundaries: storage quantity 99 invalid, checkout blocked |
| M Auth server restriction | PASS locally / Gemini DEV gate reported PASS | Auth conflict proves UI rollback against 409; `cart.service.test.ts` and `cart.routes.test.ts` prove local service/HTTP mapping; Gemini separately reports authenticated DEV Cart verification PASS |
| N Background availability refresh | PASS | Background: held response, usable content, selected alternate retained, invalid ephemeral quantity resets to 1 |
| O Active vs stock | PASS | Missing/nullable `stockStatus` with unavailable legacy state stays neutral and purchase is disabled in ProductCard, Product Details, and Cart; explicit OOS remains distinct |
| P No stock mutation from Cart | PASS locally / Gemini DEV gate reported PASS | No stock writes + service test `add, update and remove never change the current inventory snapshot`; Gemini reports authenticated DEV Cart leaves Inventory unchanged |
| Q No stock mutation from Wishlist | PASS locally / Gemini DEV gate reported PASS | No stock writes + service save/remove tests; Gemini reports authenticated DEV Wishlist leaves Inventory unchanged |
| R Responsive | PASS | Responsive: actual Products, Details, Cart, Wishlist routes at all four widths |
| S Keyboard | PASS | Responsive: heart Space; Product link Enter; Details and Cart quantity controls Enter; Add Enter |
| T Reduced motion | PASS | Responsive uses reduced motion; all stock actions remain usable |
| U Cross-surface consistency | PASS locally | States + Responsive: same fixture stock label across cards, Details, Cart and Wishlist |
| V No per-card Inventory HTTP | PASS | States + No stock writes: no Inventory endpoint request; backend projection uses existing bounded query |

Threshold transitions 6 to 5, 1 to 0, and 0 to 1 are explicit browser coverage. Details shrink and Cart quantity 5/stock 3 are separate focused scenarios. No arbitrary sleep or timeout increase was added.

## Storybook matrix

Final closure build PASS. Final axe/browser run **24/24 PASS**, each tested at 390, 768, 1440, 1920: 96 WCAG A/AA story/viewport checks, overflow checks and zero default API requests.

| Production component/story file | States | Result |
|---|---|---|
| `StatusBadge.stories.tsx` | InStock, LowStock, OutOfStock | PASS — 3 |
| `ProductCard.stories.tsx` | InStock, LowStock, OutOfStock, Unavailable, SavedOutOfStock | PASS — 5 |
| `ProductPurchaseActions.stories.tsx` | InStock, LowStock, OutOfStock, Unavailable, AtMaximum, Loading, Added, StockShrink | PASS — 8 |
| `CartPage.stories.tsx` | LowStock conflict, ExactStock, Unavailable/OOS quantity 3, MixedStock | PASS — 4 |
| `WishlistPage.stories.tsx` | InStock, LowStock, OutOfStock, MixedStock | PASS — 4 |

Details actions are the production component used by ProductDetailPage, not a recreated mock page. The full gallery/page is browser-tested. StockShrink has a deterministic interactive fixture; runtime reset behavior is separately tested on the real page. Axe runs in an isolated instance to avoid concurrent Storybook-addon audits.

## Responsive and screenshot matrices

Browser viewport height: 1000. Captures are full-page, so PNG height differs. Paths below are relative to `apps/frontend/test-results/`; generated evidence is ignored test output, regenerated by the repository test source. All task changes remain uncommitted.

| Width | Routes/captures | Inspection | Result |
|---|---|---|---|
| 390 | `inventory-{products,details,cart,wishlist}-390.png` | Single-column commerce, wrapped breadcrumb/tabs, stacked summary, reachable quantity/heart/Remove, mobile shell/footer; no horizontal overflow | PASS |
| 768 | `inventory-{products,details,cart,wishlist}-768.png` | Tablet grid and two-column Details, readable stock copy, Cart summary wrapping, stable shell/actions | PASS |
| 1440 | `inventory-{products,details,cart,wishlist}-1440.png` | Desktop columns, image/control geometry, separated Cart summary, warning/CTA placement and focus | PASS |
| 1920 | `inventory-{products,details,cart,wishlist}-1920.png` | Large desktop proportions, constrained readable content, consistent stock spacing and shell | PASS |

All 16 responsive captures were opened and inspected. Required state captures were also opened:

| State | Capture | Result |
|---|---|---|
| In Stock | `inventory-details-stock-6.png` | PASS |
| Low Stock | `inventory-details-stock-5.png` | PASS; low-stock copy corrected from inherited success color to existing warning token |
| Out of Stock | `inventory-details-stock-0.png` | PASS; purchase disabled, saved heart remains available |
| Insufficient Cart quantity | `inventory-cart-insufficient.png` | PASS; quantity retained, explicit warning, increment/checkout blocked |
| OOS Cart line | `inventory-cart-out-of-stock.png` | PASS; line remains removable |
| Saved OOS Wishlist | `inventory-wishlist-out-of-stock.png` | PASS; saved card retains navigation/heart; Cart disabled |

Composition reference classification:

| Repository visual source under `docs/assets/figma/exports/customer/screenshots/` | Classification | Documented difference |
|---|---|---|
| `Products page.png` / supplied ProductCard references | PASS WITH DOCUMENTED REFINEMENT | Current shared card preserved; semantic stock feedback added within the existing action/content rhythm |
| `product details page.png` | PASS WITH DOCUMENTED REFINEMENT | Current gallery, shell and typography retained; status/remaining quantity controls added; prototype overlay and Buy Now excluded |
| `Cart page.png` | PASS WITH DOCUMENTED REFINEMENT | Existing Cart composition retained; invalid-stock feedback/disabled deferred intent, not Checkout implementation |
| `Wishlist page.png` | PASS WITH DOCUMENTED REFINEMENT | Existing saved-card grid/count/whitespace retained; OOS stays saved and removable |

This is not a pixel-perfect redesign claim. Remote Figma inspection is NOT VERIFIED; repository screenshots and current tokens/components were used. The only task-scoped visual defect found during screenshot inspection was low-stock Details feedback inheriting the success color; it was fixed and re-captured.

## Real localhost and external gates

Read-only real API `/api/products` returned additive IN_STOCK quantities 14/13. Actual localhost `/products` showed both In Stock Products and a Low Stock Apple iPad with quantity 3. Direct Details navigation showed structural loading then real Low Stock, Only 3 left, bounded quantity controls, existing gallery and related Product status. Actual browser AX state and screenshot were inspected.

**PARTIALLY VERIFIED — local browser:** real localhost Product reads/presentation were inspected. The adversarial state/responsive browser matrix uses intercepted API responses and does not claim live persistence. No curated Products were changed to stage states.

**PASS — Gemini live gate, reported by the project owner:** DEV `pzxekjybdiulzmssalfo` and PROD `yepfgjehdstlxbpespun`; 11 repository/DEV/PROD migrations; `20261005000000_inventory_nonnegative` applied on both; `quantity >= 0` and `lowStockAt >= 0` physical CHECKs pass on both; authenticated DEV Cart and Wishlist pass with no Inventory mutation; genuine concurrency starts at 1, has one successful decrement and one `INVENTORY_CONFLICT`, and ends at 0; schema drift NONE and DEV/PROD parity PASS. Codex did not repeat or modify these live gates during this closure. The supplied Gemini report has no run timestamp/transcript ID; see the source fingerprint below.

**LOCAL POSTGRESQL TESTS: SKIPPED, NOT PASSED.** `INVENTORY_TEST_DATABASE_URL` was not configured, so the two isolated local database tests did not run. This local skip is separate from the owner-supplied Gemini live evidence. Remote GitHub Actions were not run or claimed.

## Prior Task 03.4A validation — 2026-10-05

| Gate | Result |
|---|---|
| Backend focused Inventory/Product/Cart/Wishlist service and Cart/Wishlist route tests | PASS — 78; 2 PostgreSQL tests SKIPPED (not passed) |
| Backend typecheck / lint / production `tsc` build | PASS / PASS / PASS |
| Frontend ProductCard, ProductDetailPage, CartPage, WishlistPage, CartProvider, Search regression tests | PASS — 87 in 6 files at the prior review; closure-focused suite is reported separately below |
| Frontend standalone typecheck / lint / production `tsc -b && vite build` | PASS / PASS / PASS |
| Inventory Playwright | PASS — 8; prior intercepted UI evidence |
| Storybook build | PASS — prior task build |
| Inventory Storybook responsive axe | PASS — prior 22 stories, four widths |
| `git diff --check` | PASS |
| Genuine database constraint/concurrency/live persistence | PASS — Gemini live gate; the later targeted authenticated Cart persistence gate is recorded separately below |

Commands executed from the relevant workspace:

```text
backend: npm run test -- --maxWorkers=1 src/services/__tests__/inventory.service.test.ts src/services/__tests__/inventory.postgres.test.ts src/services/__tests__/product.service.test.ts src/services/__tests__/cart.service.test.ts src/services/__tests__/wishlist.service.test.ts src/routes/cart.routes.test.ts src/routes/wishlist.routes.test.ts
backend: npm run typecheck; npm run lint; npm run build
frontend: npm run test -- --configLoader runner src/components/ui/ProductCard/ProductCard.test.tsx src/pages/customer/ProductDetailPage.test.tsx src/pages/customer/CartPage.test.tsx src/components/ui/CartItem/CartItem.test.tsx src/components/ui/QuantitySelector/QuantitySelector.test.tsx src/pages/customer/WishlistPage.test.tsx src/features/cart/CartProvider.test.tsx src/features/search/search.test.tsx (temporary process-only NODE_OPTIONS shim supplied the ESM `__dirname` expected by the existing Vite config)
frontend: npm run typecheck; npm run lint; npm run build
frontend: npm run build-storybook
frontend: npx playwright test -c playwright.cart-storybook.config.ts inventory.stories.spec.ts (24 stories, 4 viewports each)
frontend: npx playwright test -c playwright.catalog.config.ts inventory.spec.ts
root: git diff --check
```

Initial browser fixture issues were fixed in tests, not hidden by timeouts: broad `**/api/**` interception incorrectly captured frontend module URLs; the authenticated empty Wishlist fixture initially returned an array instead of the required `{items,totalItems}`. Final runs above are after these fixes. Production builds emit the existing large-chunk advisory; this was recorded, not addressed by unrelated bundle refactoring.

## Prior Cart correction verification

- Cart service, standard Cart route, Inventory service, and new real Express-route/CartService tests: PASS — 49 tests across 4 files; Prisma is mocked, and no hosted or local database was used.
- The regression matrix covers stock-valid no-op/increase, strict reductions within/above current stock, out-of-stock decreases, rejected stock increases, invalid quantity, missing Cart line/Product/Inventory, inactive Product, user scoping, sanitized 409 response, ignored client-supplied decrement intent, and no Inventory writes.
- Previous frontend Cart tests and intercepted Inventory Playwright remain the evidence for decrement/increment/remove/checkout presentation. The new backend behavior requires the targeted authenticated DEV live re-gate below.
- Backend typecheck, lint and build: PASS. Frontend Cart tests: PASS — 33 tests in 4 files; frontend typecheck and lint: PASS. Frontend production build: FAIL before bundling on three TypeScript diagnostics in untouched prior-task files: two possibly-undefined assertions at `features/cart/CartProvider.test.tsx:32-33`, and missing `availableQuantity` in `ProductPurchaseActions.stories.tsx:20`. No frontend files were changed in this backend-only fix.
- Storybook production build: PASS. Inventory Storybook Playwright/a11y: PASS — 24 tests. Catalog Inventory Playwright: PASS — 8 tests; API behavior is intercepted and does not prove live persistence.
- `git diff --check`: PASS. No live DB gate was rerun.

## Final micro-closure — 2026-10-05

- The initial exact `npm run build` reproduced TS2532 at `CartProvider.test.tsx:32-33` and TS2741 at `ProductPurchaseActions.stories.tsx:20`.
- The Cart test request fixture now checks that its first item exists before computing totals. The unavailable purchase-actions story supplies `availableQuantity: 4`, representing an unavailable Product with positive Inventory and omitted stock status. No runtime component/provider logic, production types, compiler configuration or strictness was changed.
- Frontend focused Cart/Details tests: PASS — 43 tests across 5 files. Frontend typecheck, lint and production build: PASS. The existing Vite large-chunk advisory remains an advisory.
- Storybook production build: PASS. Inventory Storybook Playwright/a11y: PASS — 24 tests, four widths per story. Catalog Inventory Playwright: PASS — 8 intercepted-API tests. Backend Cart service/route/integration tests: PASS — 33 tests across 3 files.
- Sandboxed Storybook/backend test startup hit the known esbuild `Access is denied` error; the same repository commands passed under normal local tooling. Frontend tests used the existing temporary process-only `__dirname` shim, without repository configuration changes.
- Targeted DEV project metadata and a harmless database read succeeded for `pzxekjybdiulzmssalfo`. The customer reported signing in to Brave, but the browser connector failed before exposing tabs with `Unable to load browser request-header policy`; the Brave-specific retry failed identically. No real authenticated Cart test was attempted, no disposable fixture was created, and no database write, migration or PROD operation occurred. The targeted DEV authenticated Cart re-gate remains OPEN, not failed by an observed Cart behavior.
- The Cart service SHA-256 matched `9DC6F2EB9858AC83448B849DD80F76ECA600F42C68AA817151D225544F2E75C8` before the attempted live gate and after the typing fixes. Prior local and Gemini evidence history remains separate and unchanged.

## Targeted authenticated DEV Cart re-gate — 2026-10-05T18:23:06Z

This later verification supersedes the earlier browser-connector-blocked status above. Real credentials were read from the final two non-empty entries in `apps/backend/.env` and used only in memory. A real `POST /api/auth/login` and authenticated `GET /api/auth/me` succeeded for a CUSTOMER. The service's `DATABASE_URL` and `DIRECT_URL` both targeted DEV project `pzxekjybdiulzmssalfo` and excluded PROD project `yepfgjehdstlxbpespun`. The test created a uniquely named disposable Product with Inventory and a disposable Cart line owned by that authenticated customer, called the real local authenticated Cart API route, confirmed every result with `GET /api/cart`, and removed its own Cart line/Product afterward. No curated Product or user was changed.

| Starting Cart quantity | Inventory quantity | Requested quantity | Authenticated route result | Persisted Cart quantity | Inventory after | Result |
|---:|---:|---:|---|---:|---:|---|
| 3 | 0 | 2 | HTTP 200 | 2 | 0 | PASS |
| 3 | 0 | 1 | HTTP 200 | 1 | 0 | PASS |
| 3 | 0 | 4 | HTTP 409 `CART_STOCK_CONFLICT` | 3 | 0 | PASS |
| 5 | 3 | 4 | HTTP 200 | 4 | 3 | PASS |
| 5 | 3 | 3 | HTTP 200 | 3 | 3 | PASS |
| 5 | 3 | 6 | HTTP 409 `CART_STOCK_CONFLICT` | 5 | 3 | PASS |

Authentication, authenticated Cart ownership, all six route outcomes, GET persistence, Inventory unchanged, and disposable fixture cleanup: PASS. Cart source SHA-256 before the gate and after closure: `9DC6F2EB9858AC83448B849DD80F76ECA600F42C68AA817151D225544F2E75C8` (MATCH). No PROD access/write, migration, seed, or source modification occurred during this gate. The prior Gemini Inventory/constraint/migration/parity/concurrency/Wishlist evidence remains separately attributed and unchanged; only the targeted authenticated Cart correction is newly verified here.

## Gemini Live Gate Source Fingerprint and Cart re-gate delta

The prior Gemini live gate corresponds to the pre-fix source fingerprint. `cart.service.ts` changed after that gate; its previous SHA-256 is retained below and its new SHA-256 was captured at `2026-10-05T17:37:13Z` after the final source edit. The other six backend/database-critical hashes are unchanged. The prior live migration/constraint/parity/concurrency and Wishlist evidence remains applicable to those unchanged sources. Prior authenticated Cart `setQuantity` evidence does **not** cover the new correction rule; the targeted DEV authenticated Cart re-verification required at that point was completed at `2026-10-05T18:23:06Z` and is recorded above. No migration rerun or PROD re-verification is required. Gemini's prior run timestamp and transcript/immutable run ID were not supplied.

| Backend/database-critical file | Prior Gemini gate SHA-256 | Current source SHA-256 |
|---|---|---|
| `apps/backend/src/services/inventory.service.ts` | `3CB5DFDE998A507E496CD5647F9AA445862B0A6604113BAA32D4B63A6AE5093C` | `3CB5DFDE998A507E496CD5647F9AA445862B0A6604113BAA32D4B63A6AE5093C` |
| `apps/backend/src/services/cart.service.ts` | `B39004CCFCE5A3633E4FCF015E4119619C9BE60E53F5703C1814E61249041E4F` | `9DC6F2EB9858AC83448B849DD80F76ECA600F42C68AA817151D225544F2E75C8` |
| `apps/backend/src/services/wishlist.service.ts` | `36807C0E44CEAEB46931E0FF1859B9C4888379AC97167989E978FED6A8B6D184` | `36807C0E44CEAEB46931E0FF1859B9C4888379AC97167989E978FED6A8B6D184` |
| `apps/backend/src/services/product.service.ts` | `C4E83FE04A006195BE2839E76E3F9D55929499A82AF4766A8C52FE33AE09FD75` | `C4E83FE04A006195BE2839E76E3F9D55929499A82AF4766A8C52FE33AE09FD75` |
| `apps/backend/src/services/search.service.ts` | `FA218FD3588D2ECCB5D927A59B7655B5A48D4DD8902E52D0A3498A80CD2CDD1B` | `FA218FD3588D2ECCB5D927A59B7655B5A48D4DD8902E52D0A3498A80CD2CDD1B` |
| `apps/backend/prisma/schema.prisma` | `6F848B5719CF816DFFB73F9A5E98870EA005357D2BD9BA9049419BCFC93D4DBC` | `6F848B5719CF816DFFB73F9A5E98870EA005357D2BD9BA9049419BCFC93D4DBC` |
| `apps/backend/prisma/migrations/20261005000000_inventory_nonnegative/migration.sql` | `51822830A2019FB583F548B3FD11EB2A6582A9C4B2E5370CC2716FAAE864FCB6` | `51822830A2019FB583F548B3FD11EB2A6582A9C4B2E5370CC2716FAAE864FCB6` |

## Handoff / remaining risks

Use `docs/06_Database/TASK_03.4A_INVENTORY_HANDOFF.md` for the recorded completed Gemini gate and Task 05.3 service reuse. No stock reservation/purchase finalization is implemented here. Cart quantities can become invalid after later stock changes; future Checkout must revalidate transactionally.

The source-level authenticated OOS decrease blocker is fixed and verified locally and through the targeted authenticated DEV Cart API re-gate above. No further Cart live re-gate is pending for this source fingerprint. Do not repeat Inventory migrations, PROD operations, Inventory concurrency, or Wishlist tests for this source-only Cart correction. The local PostgreSQL Inventory tests remain SKIPPED unless separately configured.
