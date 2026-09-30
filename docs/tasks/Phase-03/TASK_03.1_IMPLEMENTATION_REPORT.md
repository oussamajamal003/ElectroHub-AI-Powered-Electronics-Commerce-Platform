# Task 03.1 implementation and database handoff

## Scope and handoff

The existing Product, Search, React Query, and Storybook foundations are reused. The authoritative `TASK_03.1_PRODUCT_CATALOG.md` remains untracked and unchanged. No live DEV or PROD database command, migration, or seed has been executed by Codex. Gemini must independently verify physical schema and migration ledgers, review `apps/backend/prisma/migrations/20260928000000_product_reviews/migration.sql`, apply it through the approved DEV/PROD gate, seed DEV twice, compare scoped counts, and run gated database tests. Never seed PROD.

Prepared DEV dataset: 128 curated Products across eight existing Categories and ten represented Brands, with 320 deterministic Reviews on 16 Products by 24 inactive synthetic `.invalid` reviewers. Unrated Products remain. Stable Product/Review identities and guarded upserts preserve existing rows; these are source-code/test expectations, **not live database counts**. Variants are derived from existing factual product sources and official configuration/color options; USD prices and stock are demo values. Local deterministic category JPEGs and paired alternate views replace the generic SVG catalog art; they are illustrative category-level imagery, not SKU-specific manufacturer photography.

Review API: public `GET /api/products/:slug/reviews` (page 1, pageSize 10, maximum 50); authenticated `GET /api/products/:slug/reviews/me`, `POST /api/products/:slug/reviews` (201), `PATCH /api/products/:slug/reviews/me` (200), `DELETE /api/products/:slug/reviews/me` (204). The `/me` read returns `{ data: null }` when absent. Duplicate creation returns 409; missing own Review returns 404. Rating/body and database checks, unique `(productId, userId)`, User lookup, and Product/time index are in the migration. Public authors expose no email or internal User fields.

## Mandatory screenshot evidence

All references are under `docs/assets/figma/exports/customer/screenshots/`. All captured routes use deterministic API responses and 1920px source-width Playwright screenshots under ignored `apps/frontend/test-results/catalog.visual-*`. These are local route captures, **not live DEV database evidence**. The original Figma Make overlay is intentionally excluded. Reference product names, counts, ratings, imagery, and prices are illustrative; backend data must not be fabricated to match them.

| # | Documented reference | Actual local filename | Source size | Route / state; viewport / anchor | Capture | Result / differences |
|---|---|---|---|---|---|---|
| 1 | `Home page(1).png` | `Home page.png` | 1920×911 | `/`, hero; 1920×911 / hero | `test-results/catalog-visual/catalog.visual-01-Home-page-1-png-maps-to-Home-page-png/Home page.png` | FAIL — hero height and left-aligned copy are close, but the actual benefits strip/header treatment and hero image composition differ. Documented `(1)` suffix is absent. |
| 2 | `Home.png` | `Home.png` | 1920×906 | `/`, New Arrivals; 1920×906 / section | `test-results/catalog-visual/catalog.visual-02-Home-png-maps-to-Home-png/Home.png` | FAIL — same three-card structure, but the implemented section is materially narrower and cards are wider than reference; product/media identity also differs. |
| 3 | `Home_page.png` | `Home_page.png` | 1920×906 | `/`, Shop by Category; 1920×906 / section | `test-results/catalog-visual/catalog.visual-03-Home-page-png-maps-to-Home-page-png/Home_page.png` | FAIL — six-category row is present, but content container and tile/image proportions are materially smaller/narrower than reference. |
| 4 | `homepage.png` | `homepage.png` | 1920×909 | `/`, promotions; 1920×909 / section | `test-results/catalog-visual/catalog.visual-04-homepage-png-maps-to-homepage-png/homepage.png` | FAIL — two data-backed promotion panels are present, but the implementation container is materially narrower than the reference; data-driven copy does not justify the geometry mismatch. |
| 5 | `Home-page.png` | `Home-page.png` | 1920×907 | `/`, Featured Deals; 1920×907 / section | `test-results/catalog-visual/catalog.visual-05-Home-page-png-maps-to-Home-page-png/Home-page.png` | FAIL — three-card section exists, but card scale/container width and visual hierarchy differ materially; local images are category-level and do not match reference product imagery. |
| 6 | `product details page.png` | `product details page.png` | 1920×907 | `/products/:slug`; 1920×907 / top | `test-results/catalog-visual/catalog.visual-06-product--dd8a5-to-product-details-page-png/product details page.png` | PASS WITH DOCUMENTED REFINEMENT — gallery is approximately 560px square vs reference 550px; breadcrumb and two-column balance align closely. Product identity/content differ; cart/checkout controls remain out of scope. |
| 7 | `Product_details_page.png` | `Product_details_page.png` | 1920×907 | `/products/:slug`; 1920×907 / top | `test-results/catalog-visual/catalog.visual-07-Product--16e19-to-Product-details-page-png/Product_details_page.png` | PASS WITH DOCUMENTED REFINEMENT — same balanced gallery/details geometry; selected product differs from reference and purchase actions are intentionally excluded. |
| 8 | `product-details-page.png` | `product-details-page.png` | 1920×906 | `/products/:slug`; 1920×906 / More in | `test-results/catalog-visual/catalog.visual-08-product--b920c-to-product-details-page-png/product-details-page.png` | FAIL — same-category section is correct, but its two cards are substantially wider/closer together than reference; product imagery/content differ. |
| 9 | `Products page(1).png` | `Products page.png` | 1920×907 | `/products`; 1920×907 / top | `test-results/catalog-visual/catalog.visual-09-Products-9d829-g-maps-to-Products-page-png/Products page.png` | FAIL — approved live Search + Filters + Sort toolbar is intentionally retained, but the cards are substantially wider and less dense than the reference. `(1)` suffix is absent. |
| 10 | `products_page.png` | `products_page.png` | 1920×909 | `/products`; 1920×909 / pagination | `test-results/catalog-visual/catalog.visual-10-products-9827d-g-maps-to-products-page-png/products_page.png` | FAIL — settled capture shows three wide cards and pagination, while reference uses denser/narrower cards and different lower-page spacing. |
| 11 | `Productspage.png` | `Productspage.png` | 1920×911 | `/products?page=2`; 1920×911 / continuation | `test-results/catalog-visual/catalog.visual-11-Productspage-png-maps-to-Productspage-png/Productspage.png` | FAIL — page-two continuation works, but card width/density and lower-page position differ materially. |
| 12 | `products-page(1).png` | `products-page.png` | 1920×907 | `/products?q=I7`; 1920×907 / empty | `test-results/catalog-visual/catalog.visual-12-products-9ef22-g-maps-to-products-page-png/products-page.png` | PASS WITH DOCUMENTED REFINEMENT — same centered no-results state and query recovery; toolbar reflects the approved Search UX refinement. Documented `(1)` suffix is absent. |

This matrix records all twelve mapped states, source dimensions, route anchors, deterministic Playwright capture locations, and manual side-by-side geometry results. Screenshot tests now wait for catalog API content before capturing (the initial run exposed skeleton-only captures on Product routes). The final focused matrix passed 12/12. Manual comparison still leaves nine unresolved geometry failures; CAT-01 is not closed. Responsive 390/768/1440 catalog and detail captures passed a no-horizontal-overflow check. Live-DEV captures remain a separate acceptance gate, not inferred from mocked routes.

Storybook includes ProductCard (Default, Discounted, NoReviews, LongTitle, Unavailable, OutOfStock), CategoryCard, ProductGallery (OneImage, MultiImage, SecondarySelected), ProductPrice, ProductRating, ProductReviews (Empty, Populated), ProductSpecifications, ProductDetailsTabs, and ProductCardSkeleton stories using deterministic local fixtures. ProductDetailSkeleton is not implemented. Captured 21 critical story/viewport combinations: ProductCard 390/768/1440/1920; CategoryCard 390/768/1440; ProductGallery 390/768/1440/1920; ProductSpecifications 390/768/1440; ProductReviews 390/768/1440; ProductDetailsTabs 390/768/1440/1920. The Storybook accessibility scan reported zero axe violations across those 21 captures after text-contrast corrections. No story makes a default API request.

## Focused E2E matrix

The isolated `playwright.catalog.config.ts` uses deterministic API mocks. Final focused catalog E2E passed 24/24, and the settled screenshot matrix passed 12/12. The matrix below distinguishes local UI evidence from the Gemini live-DB gate:

| Flow | Evidence |
|---|---|
| A Browse all Products | PASS — 24-result grid, detail link, and next-page navigation asserted. |
| B Browse Category | PASS — Home category link, filtered count, and Back restoration asserted. |
| C Search + Filter + Sort | PASS — combined query/category/brand/availability/price/sort, reset, URL, delayed stale response, Back, and Forward asserted in one focused scenario. |
| D Pagination | PASS — next-page, Back, Forward, and current-page state asserted. |
| E Product Details | PASS — ProductCard navigation, direct detail route, heading and breadcrumb rendered. |
| F Gallery | PASS — secondary thumbnail Enter selection and ArrowLeft selection asserted. |
| G Specifications | PASS — tab selection and grouped section visible. |
| H Reviews | PASS — populated/empty states, aggregate stability, and 11-review two-page next/previous navigation asserted. |
| I Authenticated Review lifecycle | PASS locally — mocked customer create/update/delete updates the visible Review list and aggregate; non-owner public Review has no controls. Live migrated DEV remains Gemini-owned. |
| J Availability | PASS — explicit In stock and Out of stock text, and no Add to cart/Buy now controls asserted. |
| K Empty Products | PASS — no-result state and query clearing restore populated results. |
| L Controlled Error / Retry | PASS — mocked 503 produces sanitized error and explicit retry restores results. |
| M Background Refetch | PASS — delayed Product-detail refetch is triggered by Review invalidation; existing details remain visible, with no full loader or skeleton/empty reset, then refresh completes. |
| N Responsive | PASS — no horizontal overflow for catalog and detail at 390, 768, 1440, and 1920px. |
| O Keyboard-only | PASS — keyboard path covers breadcrumb/category, search/filter/sort, product navigation, gallery arrow/Enter, tabs, Review controls, and pagination with focus-visible assertions. |
| P Reduced Motion | PASS — browser emulates `prefers-reduced-motion: reduce`; detail tabs/gallery remain usable and no running main-content animations are observed. |

## Customer UI refinement follow-up (2026-09-29)

The current Home sequence is Hero → benefits → Categories → Deals → two promotions → New Arrivals. The benefit strip follows the supplied three-column screenshot; section loading uses ProductCard/Category-shaped skeletons and retry uses the shared Button. Product detail data loading now has a structural gallery/thumbnail/summary/tabs skeleton. Guest Orders uses a centered sign-in card, while the guest header omits the Account text item. Review UI waits for AuthContext initialization, uses the shared Select and Button, and refreshes Review/detail aggregates without awaiting broad list/Search refetches. Customer navigation scrolls new paths to top and restores in-session Back/Forward positions.

Real localhost browser/API reads confirmed Category, Brand, Product, Deal, gallery, and guest Orders rendering. A transient Category 500 in the first browser smoke was traced in `apps/backend/logs/error.log` to Prisma's closed interactive transaction on `product.groupBy`; CategoryService used Prisma's shorter default transaction timeout while Product/Search used bounded 10s/30s settings. CategoryService now uses those same bounds. The subsequent real-localhost smoke passed with no unexpected 500. This was a scoped runtime fix, not a database operation.

Curated seed validation now requires at least two distinct image URLs per Product, and smartphone image selection no longer alternates Apple and Samsung across the same category. This changes seed code only; the connected DEV rows and their image mappings remain Gemini-owned and require a guarded seed rerun. Existing live rows cannot be claimed visually corrected until that pass.

## Known verification gaps

- Catalog media is repository-owned deterministic JPEG photography, but it remains representative category-level imagery rather than source-matching SKU photography. CAT-01 remains blocked by the nine geometry/content differences recorded in the matrix, chiefly Home section/card widths, category tile proportions, featured card scale, catalog card density, and related-card sizing.

---

## Live database migration and DEV seed verification closure (2026-09-30)

### 1. Migration Ledger Sync (DEV & PROD)
Both Supabase DEV and PROD environments were queried directly via `execute_sql` against `_prisma_migrations`.
- **All 10 migrations** are applied and finished with 0 rolled back in both DEV and PROD:
  1. `20240101000000_database_foundation`
  2. `20240102000000_authentication`
  3. `20240103000000_email_otp_foundation`
  4. `20260925000000_security_events`
  5. `20260925010000_pending_email_reset_authorization`
  6. `20260925020000_remove_users_phone`
  7. `20260926000000_google_oauth`
  8. `20260927000000_account_deleted_security_event`
  9. `20260928000000_product_foundation`
  10. `20260928000000_product_reviews`
- Physical ledger state matches repo migrations in `apps/backend/prisma/migrations/` exactly.
- PROD database was strictly verified read-only; no seed was executed against PROD.

### 2. DEV Seed Application & Idempotency
DEV seed was executed twice (`prisma db seed`) to verify idempotency:
- **Run 1 Counts**:
  - Products: 128 (127 ACTIVE, 1 INACTIVE `EH-025-024`)
  - Product Images: 256 (exactly 2 images per product)
  - Reviews: 324 (320 deterministic target reviews + 4 pre-existing legacy reviews on variant products)
  - Inventories: 128 (1 inventory record per product)
  - Categories: 8
  - Brands: 10
  - Users: 54
- **Run 2 Counts (Idempotency Check)**:
  - Products: 128
  - Product Images: 256
  - Reviews: 324
  - Inventories: 128
  - Categories: 8
  - Brands: 10
  - Users: 54
- Result: **Strict idempotency verified** (0 entity drift, 0 duplicate creation).

### 3. Image Mapping & Quality Audits
- Products with < 2 images: 0
- Primary images reused > 2: 0 (all unique primary images)
- Any image reused > 2: 0
- Duplicate primary + secondary pairs: 0
- Malformed image paths: 0 (all follow `/images/catalog/...` pattern)
- Products with null brandId: 0

### 4. API & Integration Verification
- `GET /api/products?page=1&pageSize=12`: 200 OK (meta total: 127 active products, 1 inactive properly filtered).
- `GET /api/products/:slug`: 200 OK with product details and 2 associated images.
- Seed unit tests (`tests/product.seed.test.ts`, `tests/review.seed.test.ts`): 9/9 passed.
- API tests (`tests/product.api.test.ts`, `tests/review.test.ts`, `tests/search.test.ts`): 55/55 passed.
- Backend typecheck (`tsc --noEmit`): 0 errors.
- Backend lint (`eslint`): 0 errors.
- Backend build (`tsc`): 0 errors.
