# Task 05.1 — Implementation evidence (A01–J10)

- **Branch / baseline:** `feature/05.1-admin-dashboard` @ `43d1c57` (`origin/develop`, contains merged 04.7 `3776679`). All 05.1 work is **uncommitted** (owner override: no commit, push, merge or deploy).
- **Environment:** Windows 11. Owner-run backend `:5000` → shared Supabase **DEV** (`pzxekjybdiulzmssalfo`) and Vite `:3000`. Chromium is Playwright's bundled build. Supabase **PROD** (`yepfgjehdstlxbpespun`) was not touched, and no migration exists.
- **Reviewer:** not yet reviewed (Architect sign-off pending).
- **Status values:** PASS = evidence exists. FAIL = a known defect. NOT VERIFIED = not exercised. These are never used interchangeably.

## 1. Commands actually executed (final state)

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
| B01 | PASS | Live ADMIN sign-in (HTTP 200, role ADMIN). Logout is the profile-menu `logout()`, unit-tested in `AdminLayout.test.tsx`. **Logout was not clicked in the live run.** |
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
| D05 | NOT VERIFIED | Desktop verified live. Category pages at 390/768/zoom were not captured. |
| E01 | PASS | Live summary cards and SKU search on authoritative rows. |
| E02 | PASS | Live restock 3→5 and set 5→4 through `InventoryService` under `FOR UPDATE` (unit). |
| E03 | PASS | Zero restock is refused in the UI (unit) and API (route); stale or resubmitted adjustments return 409 with the current row (unit + live during defect 2); restock of an untracked product is refused. |
| E04 | PASS | Checkout and compensation still use the unchanged `InventoryService`; no change to those paths. |
| E05 | PASS | Status is derived by `InventoryService`. The threshold form is unit-covered; **the threshold was not changed live.** |
| E06 | NOT VERIFIED | The dialog keyboard flow is verified at 1440. The inventory page is verified at 200%, but the dialog itself was not captured at 200%. |
| F01 | PASS | Live list, status chips with counts, separate payment filter; server pagination ("Page 1 of 4"). Since the PR #44 review fix, chip counts respect the search, payment and customer filters (unit). |
| F02 | PASS | Live detail: item snapshot, sanitized payment (status, amount, method), customer, address. |
| F03 | PASS (component) / NOT VERIFIED (live) | Steps call the existing 04.5 delivery API, whose eligibility and revision tests are unchanged. `AdminOrderDetailPage.test.tsx` covers confirm-then-start, one allowed step with the current revision, reload on 409, no action for cancelled/unpaid/delivered orders and the payment-blocked explanation. No live transition was run, to avoid mutating real DEV orders. |
| F04 | PASS | Live: no mark-paid, refund or cancel buttons (spec asserts none exist). |
| F05 | PASS | Order detail links to "Delivery details" and the delivery detail links back to "View order" (code + screenshot). Deep-link refresh works (direct `goto` of the detail URL in the responsive pass). |
| F06 | PASS | §2; detail at all viewports. |
| G01 | PASS | Live list (CUSTOMER role only; route tests). |
| G02 | PASS | Live detail; projection allowlist; deleted accounts are nulled (unit). |
| G03 | NOT VERIFIED | Definition: SUCCEEDED payments per currency (refunded payments excluded). No independent database reconciliation was run. |
| G04 | PASS | Lock, refresh-token revocation and socket disconnect; self-change blocked; deleted accounts are never reactivated (unit). Not exercised live, to avoid deactivating a real DEV customer. |
| G05 | PASS | No role field accepted anywhere (strict schemas, route test). |
| G06 | NOT VERIFIED | Normal list and detail verified live at all viewports. The empty state is only in Storybook; a large list was not tested. |
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
| J05 | NOT VERIFIED | Keyboard skip link, focus on the first invalid field, all viewports and 200% are verified live. **Reduced motion was not verified in a browser** (CSS `prefers-reduced-motion` rules exist). |
| J06 | NOT VERIFIED | Browser flows ran on **shared DEV** with tagged QA data, not on a disposable database. No DEV/PROD confusion: PROD was never addressed. |
| J07 | PASS | §1. |
| J08 | PASS | No schema change or migration. |
| J09 | PASS | Commits contain no secrets or QA credentials (checked before push). Screenshots with PII sit in gitignored `scratch/`. The credential runner lives outside the repo, in the session scratchpad. |
| J10 | NOT VERIFIED | No commit or PR by owner instruction, so no CI run or Architect review yet. |

## 4. Storybook

`npx storybook build` was rebuilt after the final table-style changes and exited 0 (output in the session scratchpad, not committed). `Admin/Primitives` was not reviewed visually in a Storybook browser session after the rebuild.
