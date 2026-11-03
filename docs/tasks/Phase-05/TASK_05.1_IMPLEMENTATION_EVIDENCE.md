# Task 05.1 — Implementation evidence (A01–J10)

- **Branch / PR:** `feature/05.1-admin-dashboard`, published as [PR #44](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/44) into `develop` (baseline `43d1c57`, contains merged 04.7 `3776679`). Not merged or deployed.
- **Review history:** Stage 1 (local source review before publishing): APPROVE, 88/100. Stage 2 (PR #44 code review): 10 findings, all fixed in `fe6ca16`…`a7dfc5b`; CI on `a7dfc5b`: 24/24 checks green (Development CI and Security Audit, push and pull_request). The closure round (§1A) adds the Back/Forward guard, the failed-load table state and the disposable-DB checks; CI for its head is recorded on PR #44.
- **Environment:** Windows 11. Owner-run backend `:5000` → shared Supabase **DEV** (`pzxekjybdiulzmssalfo`) and Vite `:3000`. Chromium is Playwright's bundled build. Supabase **PROD** (`yepfgjehdstlxbpespun`) was not touched, and no migration exists.
- **Reviewer:** Architect sign-off pending.
- **Status values:** PASS = evidence exists. FAIL = a known defect. NOT VERIFIED = not exercised. These are never used interchangeably.

## 1A. Closure round (2026-11-03): current status

| Check | Command / source | Result |
|---|---|---|
| Frontend admin tests | `npx vitest run src/pages/admin src/features/admin src/layouts src/components/layout/ProtectedRoute` | 14 files, **71/71 passed** |
| Frontend typecheck / lint | `npx tsc -b`, `npx eslint src/features/admin src/pages/admin tests/visual/admin-closure-disposable.spec.ts` | exit 0 / exit 0 |
| Disposable browser checks | `EH_QA_STACK_STATE=<run>/state.json EH_QA_OUT=… npx playwright test -c playwright.admin-closure-disposable.config.ts` against `node apps/backend/scripts/delivery-qa-stack.cjs` (`loopback:57587/electrohub_disposable_delivery_qa_f7330a02`, backend :5310, Vite :3310; stack stopped afterwards) | **6/6 passed**; one structured record per check (test ID, environment, revision, route, action, expected, actual, evidence, result) in `scratch/qa-05.1/closure/closure-evidence.json` (gitignored, with screenshots) |
| G03 reconciliation | `npx tsx apps/backend/scripts/admin-spend-reconciliation.ts --customers=5` (read-only; refuses production) on the same disposable DB | **PASS**: 2 customers. One has 15 orders with 12 SUCCEEDED and 1 REFUNDED payment (paid spend USD 4199.88 = 12 × 349.99); the other has 2 orders (USD 699.98). Order counts and last-order dates match |

Defects found and fixed in this round:
- **Browser Back/Forward discarded unsaved product edits.** `useUnsavedChangesGuard` (`features/admin/shared/useUnsavedChangesGuard.ts`) keeps `BrowserRouter`. While the form is dirty it duplicates the current history entry, so Back lands on the form and asks in the in-app dialog (Cancel focused). Duplicating the entry also clears the forward stack, so Forward cannot discard edits. Links, the breadcrumb and Discard use the same dialog instead of `window.confirm`. Confirmed exits remove the duplicate entry first and creating a product replaces it, so history gains no extra step.
- **Double prompt when Back left the app's first entry.** After confirming in the dialog, the browser's `beforeunload` prompt also fired, and dismissing it cancelled the navigation. Confirming now releases the unload warning.
- **Edits after a save were unguarded.** The guard switched off once any save had succeeded; now only a successful *create* switches it off.
- **Failed list loads claimed the list was empty.** With an error and no data, the table showed "No customers yet" (or the page's equivalent) under the error banner. `ListEmpty` in `AdminUi` now shows "These rows could not be loaded" on the products, categories, inventory, orders and customers lists and on the dashboard's recent orders.

Still NOT VERIFIED after this round:
- **G03 on shared DEV.** It needs a DEV admin sign-in, and this run had no approved credential source. Owner action, in `apps/backend` with the DEV `.env`: `EH_RECON_API=http://127.0.0.1:5000 EH_RECON_ADMIN_EMAIL=… EH_RECON_ADMIN_PASSWORD=… npx tsx scripts/admin-spend-reconciliation.ts`.
- **Native Ctrl+'+' zoom.** Automation cannot press browser zoom. E06 ran at the equivalent layout (640×400 CSS px, as Chrome at 200% on a 1280×800 window).
- **F03 live fulfilment step on DEV** (unchanged; see the row).
- **Access token after sign-out.** Sign-out revokes the refresh token (refresh → 401) and clears the console, but the last access token stays valid until it expires (15 min, stateless JWT). This is the existing auth design, not a 05.1 change.

### Architect re-review of `4c83f53`: history after save (2026-11-03)

- **Reproduced (real Chromium, disposable stack `loopback:50182/electrohub_disposable_delivery_qa_14d41e20`, check `05.1-A2` on `4c83f53`):** open a QA product from `/admin/products`, edit, save (PATCH 200, value persisted), press Back once → **FAIL**, still on `/admin/products/:id/edit`.
- **Root cause:** `ProductForm` is keyed by `product.updatedAt`, so each save remounts it. The old guard instance had pushed a duplicate history entry and unmounted without removing it; the new instance did not know that entry was a guard entry, so Back only moved onto the identical original entry.
- **Fix (`useUnsavedChangesGuard.ts`):** the guard entry carries a marker in `history.state`. Whenever the form is clean (after a save, a revert, or a remount from a newer version), the guard removes a marked entry with one Back before anything else runs; `leave()` chains with a removal already in flight instead of starting a second Back. A Forward onto a marked entry is skipped once the form is clean. Unmarked (real) entries are never touched, and no `history.go(n)` is used.
- **Regression tests:** `useUnsavedChangesGuard.test.tsx` (4 tests: one save → one Back; two saves → one Back; edit after save → Back asks, Cancel stays, Leave exits once; clean form → no prompt). 3 of the 4 fail on the old guard; all pass now.
- **After the fix (same stack):** Chromium closure run **7/7 passed**, including `05.1-A2` (one save, two saves, edit after save, clean form: all PASS) and the existing guard check `05.1-A` (sidebar, breadcrumb, Discard, Back, Forward, close, one-step Leave, save). Frontend admin tests **75/75** (15 files); `tsc -b`, eslint and `npm run build` exit 0; `git diff --check` clean. The stack was stopped afterwards.

### Premium UI/UX refinement (owner screenshots A–J, 2026-11-03)

Chromium run on a disposable stack (`loopback:64645/electrohub_disposable_delivery_qa_29df3bdf`; four synthetic brands inserted; stack stopped afterwards): `npx playwright test -c playwright.admin-closure-disposable.config.ts` → closure spec 7/7 and premium spec 10/10. Evidence: one record per item in `scratch/qa-05.1/final-evidence/` (gitignored, with screenshots, all reviewed).

| ID | Result | Evidence |
|---|---|---|
| UX-01 | PASS | Collapse control on the MAIN heading row, inside the sidebar (not the header). |
| UX-02 | PASS | Rail links 56×48 px, 22 px icons, centred (0 px offset); the state survives reload and navigation. Root cause: Radix Tooltip's Slot stringified NavLink's className callback, so the rail was unstyled. |
| UX-03 | PASS | Every admin page title is 36 px/700 at 1440 (28 px at 390). |
| UX-04 | PASS | Stock, category, form category/brand and delivery-status popups at 390/768/1440/1920: every option one line (44 px), every popup inside the viewport. |
| UX-05 | PASS | A 55-character category name stays on one line with an ellipsis, keeps its full name in `title`, and is found and chosen by keyboard search. |
| UX-06 | PASS | Pager Next on products and inventory: the title settles 84–133 px from the top (header 64 px); the live range updates; Back restores the URL. |
| UX-07 | PASS (measured) | Chip selected in 2–8 ms (was 85–190 ms; it now marks itself before the URL transition). One request per filter state; returning to a cached filter shows rows at once. One search request per input, 291–514 ms after the last key (200 ms debounce + dev-build render; varies with machine load). Shared-DEV timings NOT measured. |
| UX-08 | PASS | Apple ranks Smartphones (10) and Laptops (4) first and leaves the category to the admin; Sony (one category) fills Audio with a note. A brand with no products is accepted. |
| UX-09 | PASS | Publish now → POST 201 `ACTIVE`; storefront `GET /api/products/:slug` → 200. |
| UX-10 | PASS | Save as draft → POST 201 `INACTIVE`; storefront → 404; admin shows Unpublished. |
| UX-11 | PASS | Unused draft: DELETE 204, then 404. Product in a customer's cart: the button is `aria-disabled` with its reason; a forced DELETE → 409 `PRODUCT_IN_USE`; a customer token → 403; the product still exists. |
| UX-12 | PASS | Edit product shows a form-shaped skeleton (no inputs, no spinner). |
| UX-13 | PASS | Add product: fields usable at once; pickers disabled with "Loading categories…"; submit blocked until options load. |
| UX-14 | PASS | Delivery: 8 skeleton rows under the real table header, no spinner; a failed load says the rows could not be loaded. |
| UX-15 | PASS | Header shows the avatar only; name, email and actions are in its menu. |
| UX-16 | PASS | Sign out asks first; Cancel keeps the session; Confirm → `/admin/login` and refresh → 401. |
| UX-17 | PASS | Linked KPI cards lift with a shadow on hover and keep focus rings; static cards keep the default cursor. |
| UX-18 | PASS | Shared fixes reach every list: Select, `SearchSelect`, the table busy bar with dimmed rows, `ListEmpty`, pills, and the 36 px titles (UX-03/04/14). |
| UX-19 | PASS | "Choose photos" is 171 px wide and unclipped. Root cause: `.empty span` also styled the Button's inner span as a 52 px circle; scoped to `> span`. |
| UX-20 | PASS (partial) | Shared DEV (`pzxekjybdiulzmssalfo`, verified by project list; PROD untouched): see the cleanup record below. |
| UX-21 | PASS | Reduced motion: the pager jumps instantly; drawer, dialogs and menus have no motion (J05). |
| UX-22 | PASS | 7 routes × 390/768/1440/1920: no horizontal page scroll; dropdowns inside the viewport. |
| UX-23 | PASS | 04.3 media page and 04.5 delivery list/detail render; media and delivery APIs unchanged; delivery and route tests pass. |
| UX-24 | PASS | Product-form history guard: `useUnsavedChangesGuard.test.tsx` 4/4 and Chromium 05.1-A / A2 pass. |
| UX-25 | PASS | Before/after screenshots reviewed against owner screenshots A–J. |

Shared-DEV cleanup (dry run first; ownership established from repository provenance, never from names alone):
- **QA 05.1 probe products** (created by `admin-dashboard-live-dev.spec.ts`): 5 found. 4 had no references and were deleted with the same rule as the new endpoint, re-checked inside the `DELETE`. Products went from 235 to 231, with no orphaned inventory or specification rows. 1 kept (`QA-051-2611022142`: photo history).
- **Test categories** (account-deletion test, EH038 gate, Stripe acceptance): 12 found, 0 deletable; all hold products with orders, payments or fixture history. The 9 holding only protected fixtures are now hidden from admin lists and options. The other 3 hold real orders and stay visible.
- **Synthetic customers:** 8 accounts with no orders or payments match repo test patterns. They were NOT removed; that needs the owner's go-ahead, because the EH038 gate pairs some of them with its fixtures. 6 accounts with commerce history are preserved.
- **Future runs:** the live-DEV spec now deletes its own probe product at the end.

## 1. Commands actually executed (before PR #44)

| Check | Command | Result |
|---|---|---|
| Frontend lint | `apps/frontend: npm run lint` | exit 0 |
| Frontend typecheck | `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| Frontend build | `npm run build` | exit 0 (only the existing chunk-size warnings) |
| Frontend admin tests | `npx vitest run src/layouts/AdminLayout.test.tsx src/pages/admin src/features/admin src/components/ui/DataTable src/components/ui/Tooltip` | 11 files, **53/53 passed** |
| Backend typecheck / lint | `apps/backend: npx tsc --noEmit -p .`, `npm run lint` | exit 0 / exit 0 |
| Backend admin tests | `npx vitest run src/routes/admin.routes.test.ts src/services/admin-operations.service.test.ts` | 2 files, **26/26 passed** |
| Storybook | `npx storybook build` | exit 0 |
| Live browser QA | `playwright test -c playwright.admin-dashboard-live-dev.config.ts` (opt-in, `EH_RUN_LIVE_ADMIN_DEV=true`) | **1/1 passed**, run stamp `2611022222`, 7.7 min |

Full-suite notes (not caused by 05.1):
- Locally, the full backend suite fails in payment and database tests because the repository's environment guards (`PAYMENT_MUTATIONS_DISABLED`, `DATABASE_TEST_TARGET_REQUIRED`) are active. CI runs `test:ci` against a disposable PostgreSQL instead.
- The full frontend suite showed 11 checkout/search failures under parallel load. In isolation, checkout passed 74/74 and search 34/34.

### Live QA run (stamp 2611022222)

**Login.** The spec signed in as the seeded DEV admin from `apps/backend/prisma/seed.ts`. The value was read in-process and never printed or persisted. Traces, videos and automatic screenshots are off.

**Report line:**
- Order detail and customer detail opened.
- `categoryCreatedHidden: true`. The category was created, edited and deleted.
- Product `QA-051-2611022222` was created as a draft and its price edited to 129.00.
- Inventory: restock 3→5, then set 5→4.
- `overflow: []`. `problems.api: []`, `problems.page: []`.
- One console 401 from the pre-login session-refresh probe (expected).

**Screenshots:** 40 files in `scratch/qa-05.1/`. The folder is gitignored because the screenshots show real DEV customer emails.
- Every route at 1440.
- Dashboard, products, inventory, orders, an order detail and a customer detail at 390, 768, 1920 and the 200% zoom equivalent. Zoom is emulated as a 720×500 CSS-px viewport, which is the same CSS layout as 1440×1000 at 200%.
- The mobile drawer open.

### Defects found by live QA and fixed in this task

1. **New categories were created visible** (invariant 4/5 and the dialog copy say hidden).
   - Cause: `createCategory` never set `isActive`, so the schema default `true` applied.
   - Fix: [admin-catalog.service.ts](../../../apps/backend/src/services/admin-catalog.service.ts) now creates with `isActive: false`.
   - Covered by a new unit test, and confirmed live after the backend restart.
2. **The inventory table kept the old count after a successful adjustment** until the refetch returned. A quick second adjustment then sent a stale `expectedQuantity` and was correctly refused as a 409.
   - Fix: the saved row, or the current row from a 409, is written into every cached inventory page immediately ([inventory/api.ts](../../../apps/frontend/src/features/admin/inventory/api.ts)).
   - Covered by the new `inventoryMutations.test.tsx` and confirmed live (3→5→4 in one session).
3. **Page-level horizontal scroll** on Orders and Inventory at 390 and at 200% zoom.
   - Cause: grid children used `min-width: auto`, so the table and chip strip widened the page.
   - Fix: `.page > * { min-width: 0 }`, plus `min-width: 0` on the mobile chip strip. Live overflow check: `[]`.
4. **Table body text rendered in JetBrains Mono.**
   - Cause: the shared DataTable's `td` default.
   - Fix: admin table cells use Poppins (per Figma), with mono kept only for identifiers and money. Scoped to `TableCard`, so the existing delivery tables are unchanged.

### QA data left on shared DEV (tagged, not purged)

- **Draft products.** Four products named `QA 05.1 <stamp> Probe` with SKU `QA-051-<stamp>`, all INACTIVE (never on the storefront), each with stock 4–5. One was created by each run that reached product creation, including `QA-051-2611022211` and `QA-051-2611022222`. Search "QA-051" in Products to find them. They cannot be hard-deleted by design; archiving is their final state.
- **Categories.** None remain. Each run deleted its own, and run 2611022142 also deleted the one visible leftover, `QA 05.1 2611022053`.
- **Orders, customers, payments, deliveries.** Read only; no mutation.

## 2. Figma screenshot comparison (`docs/assets/figma/exports/admin/screenshots/`)

| Reference | Route | Evidence | Meaningful differences (intentional) |
|---|---|---|---|
| Dashboard page(.png / _page) | `/admin` | 1440/1920/768/390/zoom200-dashboard | Figma's growth percentages ("12.4% vs last month") and "4 added today" are not shown, because no truthful source exists (invariant 8). A 7/30/90-day window replaces "Last 30 days". A fulfillment panel and a stock-attention panel are added. |
| products page | `/admin/products` | *-products | Archive replaces Delete (no hard delete). Status and category filters were added. Edit and Media are icon actions. |
| Create Product / Edit product | `/admin/products/new`, `/:id/edit` | 1440-product-new(-errors), 1440-product-edit-qa | Drafts by default. Specifications editor. Stock is changed only through Inventory once the product exists. |
| Delete product | Archive confirmation | Storybook `ArchiveConfirmation` | Archive or reactivate replaces delete. |
| Categories page / Add category / Edit category | `/admin/categories` | 1440-categories(-qa) | New categories start hidden. Delete only when the category is empty; otherwise hide. |
| Inventory page(_page) | `/admin/inventory` | *-inventory, 1440-inventory-adjust | The adjust dialog checks the expected quantity. A "Not tracked" card and filter were added; each stock filter lists exactly the rows its count counts (PR #44 review fix). |
| Orders page | `/admin/orders` | *-orders | Payment is a separate read-only column with its own filter. |
| Order details page | `/admin/orders/:ref` | *-orders-ORD-2069D6ED, 1440-order-detail | Figma's **Mark as Shipped / Mark as Delivered / Cancel Order** buttons are not shipped. Fulfillment steps use the existing 04.5 delivery API (next allowed step only). There is no cancel or refund, and payment is read-only. |
| Customers page | `/admin/customers` (+ detail) | *-customers(-16113428…) | Detail page with paid spend, orders link, and deactivate/reactivate with confirmation. |
| Delivery page | `/admin/deliveries` | 1440-deliveries | Existing 04.5–04.7 page inside the new shell, with breadcrumbs. |
| Admin login | `/admin/login` | (live sign-in) | Unchanged apart from the validated return path. |
| Analytics / Settings pages | — | — | 05.2 scope. Not routed, and no nav entry (no dead links). |

Shell-wide differences:
- **Square corners.** Figma shows radius 5–16 px. The implemented token system is square (ADR-007 / Task 01.5), and adding a second radius scale would create a competing system.
- **No header search.** Figma's global search field is omitted because no global admin search API exists. Each module has its own working search.
- **No preview switcher.** The Figma Make "Customer/Admin/Flows/Components" switcher is not reproduced, as the task requires.

## 3. Acceptance checklist

| ID | Status | Evidence |
|---|---|---|
| A01 | PASS | Baseline 43d1c57 inspected; delivery 04.5–04.7 code reused unchanged in logic; delivery page tests pass in the 53/53 run; `/admin/deliveries` renders live. |
| A02 | PASS | Working on `feature/05.1-admin-dashboard`; unrelated files untouched (git status lists only 05.1 files). |
| A03 | PASS | Implementation plan §1: auth, InventoryService, DeliveryService, 04.3 media, and the account lifecycle are reused. Catalog CRUD sits beside the 04.3 media API, not over it. |
| A04 | PASS | §2 table maps every reference file to its route, state and evidence. |
| A05 | PASS | Implementation plan §2–3: API table, envelopes, authorization, zero migrations. |
| A06 | PASS | No analytics, settings, invitation or MFA code. Nav has only 05.1 modules (AdminLayout test). |
| B01 | PASS | Live ADMIN sign-in (HTTP 200, role ADMIN). Closure (disposable): Sign out clicked in the account menu → `/admin/login`, no admin table left, protected route redirects, refresh → 401. The last access token stays valid until it expires (15 min; see §1A). |
| B02 | PASS | Live: skip link is the first Tab stop and focuses `#admin-main`; the 390 drawer opens, lists modules and closes on navigation. Unit: collapse persistence, active route, collapsed tooltips. |
| B03 | PASS | Profile menu shows name, email and role (unit). Alert counts come from `/dashboard/alerts`, with an aria-label stating the count (unit + live badge). |
| B04 | PASS | Breadcrumbs on every page (screenshots); no Figma switcher. |
| B05 | PASS | Live `overflow: []` at 390/768/1440/1920 and 200% equivalent, after defect fix 3. |
| B06 | PASS | Backend: 401 without a token, and 403 for CUSTOMER even when the JWT claims ADMIN, on every route (`admin.routes.test.ts`). Frontend: admin `ProtectedRoute`. |
| C01 | PASS | Live list with real images, stock and status; SKU search finds the QA product. Sort and filter whitelists are tested in the route and `useListParams` tests. |
| C02 | PASS | Live: empty submit focuses the first invalid field; the draft was created and persisted (redirect to its edit page). Route tests cover price, compare-at and smuggled fields. |
| C03 | PASS | Live: specification and price edit saved ("Product changes saved."). Category move and the media link are covered by unit tests and code; a category move was not done live. |
| C04 | PASS | The 04.3 media page and API are unchanged; its tests pass in the 53/53 run; product rows link to it. Media upload was not exercised live. |
| C05 | PASS | Archive only sets `status` with a version check (unit). There is no hard-delete path. No live archive of a real product was done, by design. |
| C06 | PASS | Stale edit gives `PRODUCT_CONFLICT`; smuggled `isTestFixture` gives 400; malformed id gives 404; fixtures are refused (unit and route tests). |
| C07 | PASS | §2 comparison; responsive screenshots of the products list. |
| D01 | PASS | Live list with counts, filter and search. Counts come from a single grouped query (`_count`), with no per-row query. |
| D02 | PASS | Live: the add and edit dialogs save; the name field is auto-focused. |
| D03 | PASS | `CATEGORY_NAME_TAKEN`/`CATEGORY_SLUG_TAKEN` mapping. Slug is immutable. A hidden category refuses activation of its products (unit). New categories start hidden (fixed and confirmed live). |
| D04 | PASS | Delete only when unused, under a row lock (unit); live delete of the empty QA category; hiding keeps products. |
| D05 | PASS | Desktop verified live. Closure (disposable), Add dialog at 390 and 768: Name focused, empty submit shows the error, dialog inside the viewport, no horizontal scroll, Escape closes and focus returns to the trigger. |
| E01 | PASS | Live summary cards and SKU search on authoritative rows. |
| E02 | PASS | Live restock 3→5 and set 5→4 through `InventoryService` under `FOR UPDATE` (unit). |
| E03 | PASS | Zero restock is refused in the UI (unit) and API (route); stale or resubmitted adjustments return 409 with the current row (unit + live during defect 2); restock of an untracked product is refused. |
| E04 | PASS | Checkout and compensation still use the unchanged `InventoryService`; no change to those paths. |
| E05 | PASS | Status is derived by `InventoryService`. The threshold form is unit-covered; **the threshold was not changed live.** |
| E06 | PASS (zoom-equivalent) | Closure (disposable) at 640×400 CSS px (the Chrome 200% layout): the 728 px dialog scrolls inside its modal container; title and Add stock/Close are reachable; focus stays in the dialog; empty and stale submits show their alerts. Native Ctrl+'+' zoom NOT VERIFIED. |
| F01 | PASS | Live list, status chips with counts, separate payment filter; server pagination ("Page 1 of 4"). Since the PR #44 review fix, chip counts respect the search, payment and customer filters (unit). |
| F02 | PASS | Live detail: item snapshot, sanitized payment (status, amount, method), customer, address. |
| F03 | PASS (component) / NOT VERIFIED (live) | Steps call the existing 04.5 delivery API, whose eligibility and revision tests are unchanged. `AdminOrderDetailPage.test.tsx` covers confirm-then-start, one allowed step with the current revision, reload on 409, no action for cancelled/unpaid/delivered orders and the payment-blocked explanation. No live transition was run, to avoid mutating real DEV orders. |
| F04 | PASS | Live: no mark-paid, refund or cancel buttons (spec asserts none exist). |
| F05 | PASS | Order detail links to "Delivery details" and the delivery detail links back to "View order" (code + screenshot). Deep-link refresh works (direct `goto` of the detail URL in the responsive pass). |
| F06 | PASS | §2; detail at all viewports. |
| G01 | PASS | Live list (CUSTOMER role only; route tests). |
| G02 | PASS | Live detail; projection allowlist; deleted accounts are nulled (unit). |
| G03 | PASS (disposable) / NOT VERIFIED (shared DEV) | `scripts/admin-spend-reconciliation.ts` recomputes spend from individual SUCCEEDED payment rows and compares it with `GET /api/admin/customers/:id`: 2/2 customers match, including one whose refunded payment is excluded. The DEV run needs the owner's admin sign-in (§1A). |
| G04 | PASS | Lock, refresh-token revocation and socket disconnect; self-change blocked; deleted accounts are never reactivated (unit). Not exercised live, to avoid deactivating a real DEV customer. |
| G05 | PASS | No role field accepted anywhere (strict schemas, route test). |
| G06 | PASS | Live list and detail at all viewports. Closure (disposable): a no-match search shows the filtered empty state; `pageSize=1` returns distinct server pages (total 2, 2 pages); a delayed response shows the busy state; HTTP 500 shows the error with a working Retry and no false "No customers yet" (fixed). The disposable data has 2 customers, so large lists were checked through server pagination, not volume. |
| H01 | PASS | `/admin/deliveries` renders live inside the shell; delivery logic untouched; its tests pass. Realtime not re-exercised. |
| H02 | PASS | Canonical links: order ↔ delivery (code + screenshot). |
| H03 | PASS | Live delivery list with the status filter in the URL. |
| H04 | PASS | No change to delivery, payment-eligibility or map code; existing tests pass. |
| H05 | PASS | 1440 delivery screenshot vs the Figma Delivery page. |
| I01 | PASS | Live real dashboard. |
| I02 | PASS | 7/30/90 window; revenue per currency by `paidAt`, UTC, refunded payments excluded and labelled so (unit + live). |
| I03 | PASS | Live links: All orders, Deliveries, Inventory, stock rows. |
| I04 | PASS | No growth percentages or fake series; empty days are zero; unavailable values show a dash. |
| I05 | PASS | Responsive dashboard live; loading, empty and error states in Storybook. |
| J01 | PASS | `admin.routes.test.ts` (15 tests). |
| J02 | PASS | `admin-operations.service.test.ts` (11 tests) + `inventoryMutations.test.tsx`. |
| J03 | PASS | Storybook `Admin/Primitives`: header, KPI, filters + table, loading/empty, errors, dialog. Build exit 0 (§4). |
| J04 | PASS | §2. |
| J05 | PASS | Keyboard skip link, focus on the first invalid field, all viewports and 200% verified live. Closure (disposable) with `prefers-reduced-motion: reduce`: drawer, dialog and account menu have no animation or transition longer than 0.01 ms, and content shows without motion. |
| J06 | PASS | The shared-DEV live run is kept as is. Closure: one admin flow on the disposable stack (`loopback:57587/electrohub_disposable_delivery_qa_f7330a02`). A QA product was created; stock went 10 → 11 through a concurrent write; the stale UI restock was rejected with the conflict alert; the retry persisted 16; a customer token got 403 and the quantity stayed 16. Shared DEV and PROD were not written. |
| J07 | PASS | §1. |
| J08 | PASS | No schema change or migration. |
| J09 | PASS | Commits contain no secrets or QA credentials (checked before push). Screenshots with PII sit in gitignored `scratch/`. The credential runner lives outside the repo, in the session scratchpad. |
| J10 | PARTIALLY VERIFIED | PR #44 is open; CI is 24/24 green on `a7dfc5b`, and the closure head's CI is on the PR. Architect review pending. |

## 4. Storybook

`npx storybook build` was rebuilt after the final table-style changes and exited 0 (output in the session scratchpad, not committed). `Admin/Primitives` was not reviewed visually in a Storybook browser session after the rebuild.
