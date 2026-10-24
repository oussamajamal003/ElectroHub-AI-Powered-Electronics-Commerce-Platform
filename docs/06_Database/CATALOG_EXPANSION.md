# Catalog expansion — Part 1

Status: **Part 1 implemented and applied to shared DEV on 2026-10-23 (21:09–21:10 UTC).** Not committed, pushed, merged or deployed. No PROD write.

## Plan and ownership

Task ID `CE-PART-1`, workstream DATABASE/catalog, base revision `734f6ce`, branch `feature/Catalog-Expansion-Real-Product-Media`.
Codex implemented the dataset, seed, evidence helper, launcher and media pipeline, and generated all imagery. Claude Code completed media reconciliation and review, fixed two launcher defects, and ran final validation, isolated QA, the DEV dry-run/apply and acceptance checks.

Protected files touched: none. No Prisma schema, migration, general seed, payment/auth service or shared connection configuration change.
Approval reference: the owner's catalog-expansion prompt authorizes the scoped additive DEV write conditional on identity verification, dry-run and successful isolated QA. Imagery was produced only with Codex built-in imagegen under the owner's ChatGPT Plus sign-in (no API key, paid service or credits).

## How to run

From `apps/backend`:

```bash
npm run catalog:expansion -- --validate-data                 # offline dataset gate
npm run catalog:expansion:finalize-media                     # combine four approved batches, decode, write manifest + review
npm run catalog:expansion -- --validate-media                # offline byte/hash/approval gate
npm run catalog:expansion -- --target=qa --apply --verify-repeat   # isolated QA only; writes .cache/catalog-expansion-qa.json
npm run catalog:expansion -- --target=dev                    # read-only DEV dry-run; writes .cache/catalog-expansion-dev-plan.json
CATALOG_EXPANSION_DEV_APPROVED=pzxekjybdiulzmssalfo npm run catalog:expansion -- --target=dev --apply
npm run catalog:expansion:api -- --base-url=http://127.0.0.1:PORT --expected-visible=206 --expected-categories=16
```

DEV apply refuses unless QA evidence and a DEV dry-run (under one hour old) match the exact dataset and manifest digests. Re-running on DEV is a no-op (verified below).

Never run `prisma/seed.ts` or `seedProductDataset` against shared DEV for this work: the general seed can change administrator accounts, inventory and existing product images/specifications.

## Database safety

The expansion uses existing models only, with stable natural keys and deterministic owned row IDs. It rejects identity/category/brand conflicts, preserves existing inventory on repeat, and touches only the explicit 79 identities. One serializable transaction (5 s lock wait, 120 s ceiling) with 100-row bounded inserts; any failure rolls back everything; no automatic retry.

Both URL targets must agree. QA must classify as disposable; DEV must be the approved project. Verified TLS and an authenticated `current_database()` preflight supplement URL classification. Production is forbidden.

Preservation evidence hashes every row of every public table in a read-only repeatable-read snapshot before and after. Non-catalog tables must be byte-identical; catalog tables may only gain the managed rows. Shared DEV may receive unrelated concurrent writes between snapshots, which would make this conservative witness fail after commit. If that happens, review read-only and never replay the broad seed.

Defects fixed during QA (2026-10-23): the launcher identity preflight and the snapshot table listing selected PostgreSQL `name`-typed columns, which the Prisma pg adapter cannot deserialize. Both now cast to `::text` (`scripts/catalog-expansion.ts`, `prisma/catalog-expansion-evidence.ts`). Before the fix, every database run failed at the first query; no data was written.

## Media and provenance

- 166 assets: two per SKU (158) plus eight category covers. All WebP, 1254×1254, about 14 MB in total, under `apps/frontend/public/images/catalog/expansion/`.
- Final manifest `apps/backend/prisma/data/catalog-expansion-media.json` (SHA-256 `6ba5eb93ed080989fc03286ad4ca57fbe030a4948cf4e8925d56e61994a6dae3` after the 2026-10-24 provenance recovery and T110 replacement; the DEV apply ran with the earlier `f15196435d31…`. Image URLs are unchanged, so the DEV rows need no update) and decode attestation `catalog-expansion-media-review.json` combine four batch ledgers: `camera-audio`, `storage-components-networking`, `home-controls`, `printing`. Supplementary provenance ledgers: `-corrections` (12 CPU replacements), `-root-corrections` (4), `-last-five` (5 parent-generated), `-printer-corrections` (4 Brother replacements), `-t110-correction` (1).
- Every asset is `kind: ai-generated`, commercial storefront display approved by the owner, **ML training and Kaggle/redistribution not authorized**. These are illustrative renders, not manufacturer or authenticated model photographs. Alt text in the dataset says so, and product descriptions disclose illustrative imagery and demo pricing.
- Every asset was visually reviewed as primary/alternate contact sheets of the exact hashed bytes. Recorded corrections: CPU AM5 geometry (12), Samsung 870 EVO alternate, Samsung T9 primary, Ryzen 9950X/9900X primaries, K780 alternate redraw, Tapo T110 alternate (near-duplicate angle replaced by a rear view showing the separated sensor, magnet and adhesive backs), and both Brother HL-L2400D (colourway mismatch) and MFC-J4355DW (external ink tanks the real model does not have) pairs, re-checked against official Brother reference photos.
- **Source provenance (recovered 2026-10-24):** every one of the 166 assets has a `sourceGeneration` record. It holds the Codex session, generation ID, original PNG under `~/.codex/generated_images/` and the generator's logged `revisedPrompt`.
  - 102 are **byte-exact**: re-encoding the PNG as WebP (q86, method 6) reproduces the file's SHA-256.
  - 64 are **pixel-matched**: 48px mean absolute difference ≤ 0.71, against at least 12.8× that distance for the next candidate. The method agreed with all 102 byte-exact cases.
  - The 101 assets that previously had no per-asset prompt (including 18 Tapo images and 53 storage/CPU/networking images) now carry the recovered prompt, marked by `generationPromptSource`.
  - One unrelated generated PNG in Codex's cache is unreadable; it is not the source of any asset.
- Accepted weaknesses: M.2 SSD boards share a generic PCB look; some renders show the real brand's wordmark (no invented brands were observed).

## Acceptance evidence (2026-10-23, local + shared DEV)

| Check | Result |
|---|---|
| `--validate-data` | PASS: 8 categories, 79 products, 158 images; dataset SHA-256 `5f23d1d3851025a6ab317e9e6b441e563e6f3e1eebec0916385a989d27b09e54` |
| `catalog:expansion:finalize-media` and `--validate-media` | PASS: 166 approved, 166 independently decoded, no database connection |
| Playwright `catalog-expansion-assets.spec.ts` (Chromium, Vite :3101) | PASS: all 166 paths return HTTP 200 `image/*` and decode at 1254×1254 |
| Vitest `catalog-expansion.seed`, `catalog-expansion.evidence`, `product.seed` | PASS: 21 tests |
| Vitest `catalog-expansion.database` (`CATALOG_EXPANSION_DATABASE_TEST=1`), `product.api`, `test-product-exclusion`, run against isolated QA as the disposable test target (as CI does) | PASS: 3 files, 17 tests; QA counts identical before and after (replay no-op) |
| Strict standalone `tsc` (launcher, finalizer, API smoke, seed, evidence, tests) | PASS |
| Backend `typecheck`, `lint`, `build`; scoped ESLint on expansion files and frontend spec | PASS |
| Isolated QA `localhost:55434/electrohub_disposable` (PG 17, verified TLS) | First apply: +8 categories, +6 brands (2 reused), +79 products, +158 images, +490 specs, +79 inventory. Repeat: 0 writes, 79 inventories preserved. Unrelated-row preservation: PASS |
| QA counts before → after | products 128→207, visible 127→206, categories 8→16, brands 10→16, images 256→414; users 57 and orders 58 unchanged |
| QA API smoke (`dev:isolated` backend :5200, Stripe disabled, email capture) | PASS: visible 206, storefront categories 16, all 79 products and 8 categories match, 8 detail responses valid, 0 mutations |
| DEV identity | Both URLs → project `pzxekjybdiulzmssalfo`, CA set, gate identity `supabase:pzxekjybdiulzmssalfo/postgres`; no PROD reference |
| DEV dry-run (21:09:03 UTC) | Same plan as QA; no conflicts; read-only witness unchanged |
| DEV apply | PASS: same created counts; full-table preservation witness PASS |
| DEV repeat dry-run | 0 creates/updates; 79 inventories preserved |
| DEV API smoke (local backend :5300, payment recovery off, no Stripe/Brevo keys) | PASS: visible 206, storefront categories 16, 79/79 products, 8/8 categories, 0 mutations |
| Browser pages against DEV API (Vite :3300 → read-only API :5300) | All 8 representative detail pages plus `/products/brother-mfc-j4355dw` render name, category breadcrumb, SKU, price, In Stock and "No rating", with 0 broken of 11 expansion images per page. `/products` shows "206 results"; 40/40 first-page card images decoded |
| Provenance refresh and T110 replacement (2026-10-24) | Manifest re-finalized and validated; QA `--apply --verify-repeat` 0 writes and evidence matches; DEV dry-run 0 writes; Playwright 166/166 PASS |

### DEV counts (read-only, verified TLS)

| Measure | Before (21:08 UTC) | After (21:10 UTC) | Δ |
|---|---:|---:|---:|
| Total products | 150 | 229 | +79 |
| ACTIVE, visible, non-test products | 127 | **206** | +79 |
| Categories | 21 | 29 | +8 |
| Active categories with visible non-test products | 8 | **16** | +8 |
| Brands | 10 | 16 | +6 |
| Product image records | 274 | 432 | +158 |
| Distinct product image URLs | 151 | 309 | +158 |
| Product specifications | 897 | 1387 | +490 |
| Inventory rows | 148 | 227 | +79 |
| `EH-CE-*` products | 0 | 79 | +79 |
| Users / orders / carts / reviews | 76 / 65 / 16 / 325 | 76 / 65 / 16 / 325 | 0 |

The fresh baseline matched the 2026-10-22 snapshot exactly.

### Acceptance matrix

| Row | Status | Evidence |
|---|---|---|
| CE-01 Repository and seed inspected | PASS | This runbook; launcher/seed reviewed; defects fixed |
| CE-02 Eight categories with correct slugs | PASS | DEV +8; API smoke category check |
| CE-03 Exactly 79 real SKUs | PASS | Dataset gate; DEV `EH-CE-*` = 79 |
| CE-04 Credible, traceable specifications | PASS (source URLs per product, ≥6 specs each; values not independently re-verified against every source page in this pass) | Dataset `sourceUrl`; detail API spec counts |
| CE-05 Unique, stable SKU/slug identity | PASS | Dataset validation; deterministic owned IDs; repeat no-op |
| CE-06 Brand/category relationships | PASS | API smoke compares category and brand per product |
| CE-07 Category images usable | PASS | 8 covers in manifest; browser decode |
| CE-08 Meaningful primary and alternate per SKU | PASS (158/158) | Contact-sheet review; detail API 2 images, 1 primary |
| CE-09 Established visual style | PASS | Square white/light-grey studio, soft shadow, 1254² |
| CE-10 Not represented as authentic photos | PASS | Alt text, descriptions, manifest `kind` and usage policy |
| CE-11 Rights/provenance manifest | PASS | Final manifest; `sourceGeneration` and prompt for 166/166 assets |
| CE-12 Additive seeding | PASS | Dedicated launcher; preservation witness |
| CE-13 Dry-run and isolated QA | PASS | QA dry-run/apply |
| CE-14 QA idempotency | PASS | Repeat 0 writes; `.cache/catalog-expansion-qa.json` |
| CE-15 DEV identity and gate | PASS | Identity check; approval variable; plan freshness |
| CE-16 Authorized DEV seed | PASS | DEV apply output |
| CE-17 Existing data intact | PASS | DEV preservation witness; unchanged user/order/cart/review counts |
| CE-18 Visible count ≈ 206 | PASS | Exactly 206 (DB and API) |
| CE-19 Validation, tests, typechecks, API smoke | PASS locally | Table above. Remote GitHub CI: NOT VERIFIED (nothing pushed) |
| CE-20 Accurate evidence | This document | Figma: NOT APPLICABLE / NOT VERIFIED; Sentry/Stripe: not involved |

## Part 2 handoff (frontend)

**New categories.** Image prefix: `/images/catalog/expansion/`.

| Name | Slug | Category image | Products |
|---|---|---|---:|
| Cameras & Photography | `cameras-photography` | `category-cameras-photography.webp` | 8 |
| Speakers & Audio | `speakers-audio` | `category-speakers-audio.webp` | 12 |
| Storage & SSDs | `storage-ssds` | `category-storage-ssds.webp` | 10 |
| Computer Components | `computer-components` | `category-computer-components.webp` | 15 |
| Networking & Wi-Fi | `networking-wifi` | `category-networking-wifi.webp` | 8 |
| Smart Home | `smart-home` | `category-smart-home.webp` | 10 |
| Keyboards & Mice | `keyboards-mice` | `category-keyboards-mice.webp` | 10 |
| Printers & Scanners | `printers-scanners` | `category-printers-scanners.webp` | 6 |

New brands on DEV: Canon, AMD, TP-Link, Tapo, Logitech, Brother (Samsung and JBL already existed in the base catalog). Computer Components contains only AMD Ryzen CPUs; its cover image shows a GPU/CPU/SSD composite.

**Verified DEV state:** 206 visible products, 16 storefront categories, 16 brands (counts above).

**API behaviour (verified against DEV):**
- `GET /api/products?page=N&pageSize≤100` returns `{data, meta.total}`. Prices are decimal strings, `compareAtPrice` is `null` for all new products, and `availability` is `AVAILABLE`. `primaryImage`/`secondaryImage` are `images[0]`/`images[1]`.
- `GET /api/categories?pageSize=100` lists only active categories with visible non-test products (16).
- `GET /api/products/:slug` returns SKU, `modelNumber`, 2 images (exactly 1 primary) and specifications in a `Technical` group.
- Inventory starts at 24 simulated units; repeat seeding preserves real changes.
- Do not hardcode 206; use `meta.total`.
- Category filtering on the product list was not part of this work; inspect the actual query validators before relying on it.

**Representative detail routes** (frontend route `/products/:slug`; API `/api/products/:slug`): `/products/canon-eos-r50`, `/products/jbl-go-3`, `/products/samsung-990-pro-1tb`, `/products/amd-ryzen-9-9950x`, `/products/tp-link-archer-ax55`, `/products/tapo-c200-v1`, `/products/logitech-mx-master-3s-bluetooth-edition`, `/products/brother-hl-l2400d`. All 8 returned valid API detail responses from DEV and rendered in the browser with every image decoded.

**Observed for Part 2:** the default `/products` ordering now opens with expansion products (the whole first page), and the footer "Shop" links list only the original categories.

**Asset usage:**
- Use API image URLs and ordering; never substitute a category-wide placeholder.
- All assets are square 1254² WebP on a white/light-grey studio background, so `object-fit: contain` on a light surface matches the existing catalog.
- Keep the illustrative-image disclosure; never label these as manufacturer photos or as ML ground truth.
- Prices are illustrative demo values; there are no discounts, reviews or ratings.

**Not done in Part 1:** Home and Products page changes, category navigation, responsive and visual QA of listing pages, Figma comparison.

## Part 2 storefront (implemented 2026-10-24, uncommitted)

- **Home "Shop by Category"** orders the API's storefront categories by live `productCount` (ties by name) and shows the first 8. A `View all N categories` button (`aria-expanded`/`aria-controls`) reveals the rest. Cards link to `/products?category=<slug>`.
- **Shared `CategoryCard`:** 4:3 contained image frame, equal-height cards, "1 product"/"N products", and a neutral icon tile when an image is missing or fails.
- **`/products`:**
  - Category is an API-driven dropdown labelled `Name (count)`; the 17-chip wall is gone.
  - A category deep link titles the page and breadcrumb with the category name.
  - The visible count appears once (the live status line stays for screen readers).
  - Changing category resets the page and keeps sort and search.
- **Shared fixes found by QA:** `Select` values no longer clip descenders, and `Pagination` fits a 320px screen.
- **Default catalog order:** the new `category-mix` sort (`GET /api/search/products?sort=category-mix`; enum added to the validator and OpenAPI). It works round-robin: each category's newest product, then each one's next newest, with categories in name order within a round. It is deterministic and data-driven, not an editorial ranking.
  - `/products` with no query and no sort uses it, without writing it to the URL. Typed queries keep relevance, and "Newest" and the other sorts stay selectable.
  - On QA, page 1 shows all 16 categories (Newest showed 7), and paging returns all 206 products exactly once.
  - The backend default for omitted `sort` is unchanged (newest), so other API consumers are unaffected.
- **Footer "Shop" links** come from the live Category API (All Products plus the 8 largest categories, via the shared `orderCategoriesByCount`). This replaces hardcoded links, two of which pointed at non-existent slugs (`phones`, `audio`).
- **Reusable real-stack check:** `ISOLATED_BASE_URL=http://localhost:3200 npx playwright test -c playwright.isolated.config.ts catalog-storefront`, with the isolated backend and Vite on :3200 running. Screenshots are saved to `apps/frontend/test-results/isolated/storefront-*.png`.

## Open items

- Remote GitHub CI has not run (nothing pushed).
