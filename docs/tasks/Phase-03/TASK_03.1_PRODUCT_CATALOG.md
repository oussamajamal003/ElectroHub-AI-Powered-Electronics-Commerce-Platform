# ELECTROHUB — TASK 03.1 / PRODUCT CATALOG

**Phase:** 03 — Commerce  
**Task:** 03.1 — Product Catalog  
**Branch:** `feature/Product-Catalog`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Primary area:** Customer catalog / Product discovery / Product details  
**Implementation type:** Full-stack + data + UI + Storybook + automated/manual QA  

---

# 1. Task Objective

Transform the approved Product Foundation into ElectroHub's production-quality customer catalog experience.

TASK 03.1 must deliver a complete, polished, evidence-verified Product Catalog built on the foundations established in Phase 02:

```text
02.5 Product Foundation
        ↓
Product / Category / Brand / Inventory / Images / Specifications / Pricing
        ↓
02.6 Search Foundation
        ↓
Search / Suggestions / Filtering / Sorting / Search Results
        ↓
02.7 State and API Foundation
        ↓
React Query / Query Keys / API Client / Cache / Retry / Loading / Errors
        ↓
03.1 Product Catalog
        ↓
Complete customer catalog + Product Details + Ratings/Reviews + Visual QA
```

03.1 must **consume and refine** the previous foundations. It must not create competing Product, Search, API, state-management, loading, or query architectures.

The resulting customer experience must feel like a complete electronics store rather than a technical Product-data proof of concept.

---

# 2. Fixed Roadmap Scope

Phase 03 exists to implement the complete customer shopping and purchasing workflow.

TASK 03.1 owns the Product Catalog portion:

- Product listing
- Product details
- Categories
- Product specifications
- Availability presentation
- Product images
- Remaining/full catalog refinement
- Category browsing refinement
- Product Details experience
- Product image gallery
- Product specifications presentation
- Product-rating and review experience required by the approved Figma Make customer design
- Customer-facing Product discovery surfaces that directly belong to catalog browsing
- Expanded realistic DEV catalog data sufficient to exercise the real UI
- Storybook-first component verification
- Visual, responsive, keyboard, accessibility, motion, integration, and E2E verification

TASK 03.1 is intentionally one of the largest customer-facing implementation tasks completed so far.

---

# 3. Non-Negotiable Architecture

The customer catalog must follow:

```text
Customer UI / Pages
        ↓
Feature Query Hooks
        ↓
Stable Query-Key Factories
        ↓
Central API Client
        ↓
Existing Backend REST APIs / bounded 03.1 extensions
        ↓
Services / Prisma
        ↓
PostgreSQL
```

State ownership remains:

```text
Server state      → React Query
URL state         → React Router / existing URL-state conventions
Local draft/UI    → local React state
Authentication    → existing AuthContext + backend authority
Database          → backend/Prisma only
```

Do not introduce:

- another API client;
- another QueryClient;
- component-level ad hoc `fetch` calls;
- duplicate Product search logic;
- duplicate filter/sort state systems;
- an alternate Product domain model;
- another design system;
- a separate customer ProductCard implementation for every page.

---

# 4. Relationship to Earlier Tasks

## 4.1 TASK 02.5 — Product Foundation

Reuse and extend the approved Product Foundation rather than recreating it.

Expected existing concepts include:

- Product
- Category
- Brand
- Inventory
- ProductImage
- ProductSpecification
- Product pricing
- compare-at pricing where supported
- model number
- category images
- Product relationships
- public Product/category/brand read APIs
- curated DEV Product seed strategy

The Product Foundation handoff established a curated baseline of 24 scoped Products, eight curated categories, represented factual brands, Product images and Product specifications. TASK 03.1 expands this catalog rather than deleting/replacing the predecessor foundation.

Do not:

- delete legitimate legacy Products to simplify the new dataset;
- manufacture `Unknown` / `Unspecified` Brands;
- force nullable legacy Brand relationships to non-null without verified evidence;
- destroy existing commerce references;
- use `prisma db push` as a substitute for a reviewed migration.

## 4.2 TASK 02.6 — Search Foundation

Reuse the approved Search behavior.

The dedicated `/search` page remains focused Search.

The `/products` page remains the richer catalog-discovery page.

Do not create a second backend Search implementation for Catalog.

Preserve the approved Search semantics for searchable fields and URL-driven filtering/sorting/pagination.

## 4.3 TASK 02.7 — State and API Foundation

Reuse:

- the single QueryClient;
- existing query keys/factories;
- central API client;
- existing query defaults;
- cache policies;
- cancellation;
- bounded retry policy;
- Product/Search/Category/Brand hooks where already available;
- ElectroHubLoader for real route/page waits;
- skeletons for structured Product content;
- current error and empty-state patterns.

No React Query architecture rewrite is allowed in 03.1.

---

# 5. Mandatory Repository-First Workflow

Before planning implementation:

1. Read root `AGENTS.md` completely.
2. Confirm current branch and HEAD.
3. Synchronize with the approved Git workflow without destroying local work.
4. Read this task completely.
5. Inspect the repository structure.
6. Inspect the current `docs/` tree.
7. Identify documents materially relevant to TASK 03.1.
8. Read those relevant documents before implementation.
9. Inspect the smallest complete Product/Category/Search/Inventory/UI/schema/testing surface required by the task.
10. Build the implementation plan from **current repository truth**, not assumptions from prior conversations.

Do not trust old chat summaries over current files.

---

# 6. Mandatory Task-Specific Documentation Discovery

This rule applies to TASK 03.1 and establishes the expected pattern for future ElectroHub tasks:

> For every task, inspect the documentation tree, identify the documents materially relevant to the assigned scope, read them before implementation, and update affected documentation after implementation.

Do **not** blindly read every document in full.

Do **not** ignore the documentation tree and rely only on the task file.

For 03.1, likely relevant documentation includes current versions of documents covering:

## Project Foundation

- Roadmap
- Project structure
- Tech stack
- Dependencies
- Decisions / ADRs where applicable
- Changelog if task conventions require it

## Design

- Design system
- Components
- Layouts
- Colors
- Typography
- Icons
- Motion
- Responsive rules
- UI guidelines

## Architecture

- System architecture
- Frontend architecture
- Backend architecture
- Database architecture where present

## Engineering Standards

- Coding standard
- TypeScript standard
- SCSS standard
- Component guidelines
- API guidelines
- State management
- Error handling
- Performance
- Security

## Feature Documentation

- Products
- Categories
- Search
- Inventory only where availability depends on current inventory data
- Authentication only where Review write ownership/security requires it

## Database Documentation

- Prisma schema
- Tables
- Relationships
- Indexing
- Seeding
- Migration process if a Review schema addition is necessary

## Quality Documentation

- Testing
- E2E
- Accessibility
- Performance
- Storybook
- Definition of Done / review requirements

## Workflow Documentation

- Git workflow
- Branching
- Code review

Do not spend implementation time reading Stripe, Delivery, Socket.IO, AI image search, Cloudinary, Admin analytics, or other future-feature documentation unless an actual dependency discovered in the current code requires it.

Document in the implementation handoff which docs were read and which docs were updated.

---

# 7. Source and Authority Hierarchy

When requirements appear to conflict, use the following hierarchy:

```text
1. ROADMAP.md
   → defines Phase/Task ownership

2. TASK_03.1_PRODUCT_CATALOG.md
   → defines exact 03.1 requirements

3. Current repository schema/API/domain/code
   → defines implementation truth and reusable architecture

4. Supplied Figma Make screenshots
   → define the starting visual/page/component intent

5. Existing Phase 01 design-system documentation
   → defines approved tokens/primitives/consistency rules

6. Storybook foundation documentation
   → defines isolated visual QA workflow

7. Product Foundation / Search / State-API predecessor handoffs
   → define inherited constraints and evidence
```

Business/security/data truth must never be fabricated merely to reproduce pixels.

However, Ratings/Reviews are explicitly approved in THIS task and must be implemented properly rather than omitted simply because the short roadmap bullet list did not name them separately.

---

# 8. Visual Authority — Figma Make Screenshots

## 8.1 No Live Figma Design Requirement

TASK 03.1 does **not** require fresh inspection of the old Figma Design link.

The Phase 01 shared-component/design work already established the reusable visual foundation.

For TASK 03.1, the supplied **Figma Make customer screenshots are the primary starting visual references**.

Codex must be able to access the supplied PNG files during implementation.

If an expected screenshot is missing/unreadable:

- do not invent a claim of exact visual comparison;
- continue only where current design-system evidence is sufficient;
- report the missing evidence explicitly.

## 8.2 Required Screenshot Set

The 03.1 handoff includes these exact filenames:

### Home/catalog discovery

1. `Home page(1).png` — **1920 × 911**
2. `Home.png` — **1920 × 906**
3. `Home_page.png` — **1920 × 906**
4. `homepage.png` — **1920 × 909**
5. `Home-page.png` — **1920 × 907**

### Product Details

6. `product details page.png` — **1920 × 907**
7. `Product_details_page.png` — **1920 × 907**
8. `product-details-page.png` — **1920 × 906**

### Products/catalog

9. `Products page(1).png` — **1920 × 907**
10. `products_page.png` — **1920 × 909**
11. `Productspage.png` — **1920 × 911**
12. `products-page(1).png` — **1920 × 907**

Do not rename these references inside the evidence matrix.

## 8.3 Screenshot Role Matrix

### `Home page(1).png`

Reference for:

- customer Header context;
- Hero/catalog entry visual relationship;
- promotional hierarchy;
- Product-discovery entry actions;
- large-screen spacing/width baseline.

03.1 should not rebuild the entire Home hero unless current catalog integration/refinement requires it.

### `Home.png`

Reference for:

- New Arrivals section;
- ProductCard appearance in a Home merchandising context;
- Product image/card proportions;
- rating/review presentation;
- price hierarchy;
- section title/View-all alignment;
- grid spacing.

### `Home_page.png`

Reference for:

- Shop by Category;
- CategoryCard/category browsing entry points;
- category Product count display;
- Featured Deals transition;
- responsive category layout intent.

### `homepage.png`

Reference for:

- promotional Product-category banners;
- page rhythm between promotional and Product sections;
- New Arrivals merchandising hierarchy.

Promotional banners may be refined using existing approved data/visual systems; do not create a new CMS or campaign-management backend in 03.1.

### `Home-page.png`

Reference for:

- Featured Deals ProductCard states;
- compare-at price;
- discount percentage;
- ProductCard density/alignment.

### `Products page(1).png`

Reference for:

- `/products` hierarchy;
- breadcrumb/title/result count;
- catalog toolbar visual direction;
- Product grid;
- ProductCard integration.

Important: TASK 02.6's approved interaction architecture takes precedence over an older screenshot toolbar implementation. Preserve current compact Search + Filters + Sort + Reset behavior while refining visual hierarchy toward the screenshot.

### `products_page.png`

Reference for:

- continuation of Product grid;
- ProductCard consistency across mixed categories;
- pagination placement/spacing;
- bottom-of-grid layout.

### `Productspage.png`

Reference for:

- alternate Product grid rows;
- mixed Product-image aspect behavior;
- ProductCard height consistency;
- Product metadata hierarchy.

### `products-page(1).png`

Reference for:

- zero-result state;
- `0 products` result count;
- no-results hierarchy;
- clear/reset action;
- relationship to Footer.

### `product details page.png`

Reference for:

- single-image Product Details layout;
- breadcrumb;
- Product information hierarchy;
- rating/review summary;
- price/status/description;
- availability presentation;
- quantity/action region placement as visual context;
- Description / Specifications / Reviews tabs.

Cart/Wishlist/Buy Now behavior remains owned by later tasks unless current code already provides legitimate behavior.

### `Product_details_page.png`

Reference for:

- multi-image Product gallery;
- large active image;
- thumbnail rail;
- Product sale price/compare-at price/discount;
- Product Details balance at desktop size.

### `product-details-page.png`

Reference for:

- `More in <Category>` browsing section;
- same-category ProductCard integration;
- exclusion of current Product;
- section density/spacing.

This is deterministic catalog browsing, **not AI recommendations**.

## 8.4 Prototype Overlay Exclusion

The floating Figma Make prototype control visible in screenshots:

```text
Customer | Admin | Flows | Components
```

is **NOT part of the ElectroHub product UI**.

It must never be implemented.

---

# 9. Figma Screenshot Refinement Rule

Figma Make screenshots are the **first approved design reference**, not an immutable pixel prison.

The implementation must begin from the screenshot and preserve:

- layout hierarchy;
- content structure;
- spacing rhythm;
- typography hierarchy;
- component relationships;
- visual balance;
- responsive intent;
- interaction placement;
- ElectroHub identity.

Controlled refinement is explicitly allowed when it clearly improves:

- usability;
- accessibility;
- responsiveness;
- alignment;
- spacing consistency;
- visual hierarchy;
- existing design-system consistency;
- component reuse;
- awkward wrapping/overflow;
- loading/empty/error treatment;
- ProductCard consistency;
- Product Details balance;
- keyboard/focus behavior;
- interaction clarity;
- newer approved project decisions that post-date the screenshot.

Refinement is **not** permission to:

- arbitrarily redesign the page;
- ignore the screenshot;
- change brand direction;
- introduce unrelated styles;
- remove important content;
- change roadmap feature ownership;
- break shared-component consistency;
- add flashy effects with no UX purpose;
- revert better 02.6/02.7 behavior merely to copy an older screenshot literally.

Use this test:

> Does the implementation still clearly look like the approved Figma Make design, but more polished, usable, accessible, consistent, or responsive?

If yes, the refinement is allowed.

Meaningful visual deviations must be documented in the final `FIGMA REFINEMENTS` evidence section.

Example:

```text
FIGMA REFINEMENT

Element:
Product Details gallery thumbnail spacing

Figma:
8px visual spacing

Implementation:
12px design-token spacing

Reason:
The original spacing crowds the approved responsive layout and conflicts with the current ElectroHub spacing system.

Result:
Cleaner alignment with unchanged information hierarchy.
```

---

# 10. Catalog Scope — Required Customer Experience

TASK 03.1 must complete/refine:

- `/products` full catalog page;
- category browsing from Home and Products;
- category Product counts;
- Product-grid layout;
- ProductCard final catalog version;
- Product details route/page;
- Product image gallery;
- Product details tabs;
- Description;
- dynamic specifications;
- availability display;
- pricing/compare-at pricing;
- rating summary;
- Review count;
- Reviews tab;
- persisted Ratings/Reviews foundation;
- Review list and customer Review lifecycle described later in this task;
- same-category browsing (`More in <Category>`);
- loading states;
- skeleton states;
- empty states;
- controlled error states;
- pagination;
- breadcrumbs;
- responsive layout;
- accessibility;
- keyboard behavior;
- reduced motion where motion exists;
- Storybook component states;
- screenshot comparison;
- real-page E2E verification.

---

# 11. Home Catalog Discovery Surfaces

The supplied screenshots contain Home-page catalog discovery sections that belong to the 03.1 customer catalog experience.

Refine/reuse the existing Home page rather than creating a second Home implementation.

Required catalog-related Home sections where current architecture supports them:

## 11.1 New Arrivals

Display a bounded deterministic set of recently added Products.

Requirements:

- reuse ProductCard;
- real Product data;
- real ratings/review count;
- real pricing;
- no separate hardcoded fake Product objects;
- `View all` routes to the approved catalog state;
- responsive layout;
- Storybook verification for ProductCard states.

Selection may use existing timestamp/seed ordering or another documented deterministic strategy.

Do not add a new schema flag solely for `New Arrival` unless repository analysis proves it is needed.

## 11.2 Shop by Category

Required:

- category image where supported;
- category name;
- active Product count;
- accessible category link;
- navigation into catalog category state;
- responsive layout;
- zero-count behavior defined;
- no N+1 count queries.

## 11.3 Featured Deals

Use legitimate Product pricing data.

Prefer deterministic selection such as Products where:

```text
compareAtPrice > price
```

and select by documented discount/curation logic.

Do not add a `featured` schema field only because the screenshot title says `Featured Deals` unless current domain requirements justify it.

## 11.4 Promotional Banners

Promotional visual areas may be refined to match the screenshots and current design system.

They must not introduce:

- campaign-management infrastructure;
- admin CMS;
- new AI logic;
- hardcoded business claims that conflict with real Product data.

---

# 12. `/products` — Full Catalog Refinement

The Products page must remain the primary full-catalog discovery surface.

## 12.1 Preserve Approved 02.6 Behavior

Do not regress:

- compact catalog Search field;
- live Search semantics where already approved;
- Filters;
- Brand filter;
- Category filter;
- Availability filter;
- price filtering;
- Sort;
- Reset;
- pagination;
- URL ownership;
- browser back/forward;
- Search API reuse;
- Product Summary DTO reuse;
- Category/Brand React Query cache reuse;
- cancellation;
- stale response safety.

## 12.2 Required Products Page Regions

At minimum:

```text
Customer Header

Breadcrumb

Page Title                         Result count

Catalog discovery toolbar
Search / Filters / Sort / Reset

Active filter summary if current UX supports it

Product Grid

Pagination

Shared Footer
```

## 12.3 Product Count

Result count must reflect the current server result set, not a hardcoded screenshot number.

Examples:

```text
0 products
1 product
24 products
137 products
```

Use correct pluralization.

## 12.4 Category Browsing

Category selection must integrate with existing URL/query state.

Do not invent a second category browsing store.

Deep links must be shareable/bookmarkable.

Back/forward must restore state correctly.

## 12.5 Pagination

Required:

- server-side pagination;
- bounded page size;
- current page indicated;
- previous/next behavior;
- first/last disabled state;
- URL ownership;
- keyboard operation;
- accessible labels;
- no duplicate requests for the same fresh query key;
- no unnecessary page reset except when filter/search state logically changes;
- no layout jump caused by background fetch.

## 12.6 Empty State

Match/refine `products-page(1).png`.

Required:

```text
No products found
Try adjusting your search or filters.
Clear filters
```

Use real reset semantics.

Do not show an ErrorState for a legitimate empty result.

## 12.7 Error State

Controlled request failure must show:

- sanitized message;
- retry where appropriate;
- no raw stack traces;
- no internal SQL/Prisma error details;
- existing content retained during recoverable background refetch where appropriate.

---

# 13. ProductCard — Authoritative Reusable Catalog Card

There must be one authoritative reusable customer ProductCard unless repository evidence proves separate variants are required.

Search existing components first.

Extend the existing ProductCard rather than creating competing copies.

Required supported data/presentation:

- Product image;
- category and/or Brand context according to approved design;
- Product name;
- optional model context where appropriate;
- short description/snippet where design supports it;
- real average rating;
- real review count;
- current price;
- compare-at price where legitimate;
- discount percentage derived from real prices;
- availability state where design calls for it;
- Product Details navigation;
- approved action slots only.

## 13.1 ProductCard Rating

Ratings are mandatory in 03.1.

Do not hardcode values to match screenshots.

Use backend-derived Product review aggregates.

For Products with zero reviews, use a deliberate supported state such as:

```text
No reviews
```

or the approved equivalent.

Do not show fake `5.0 (0)`.

## 13.2 Card Actions and Future Tasks

Screenshots show Wishlist and Add to Cart controls.

Ownership remains:

- Add to Cart business behavior → TASK 03.2
- Wishlist business behavior → TASK 03.3
- Buy Now/Checkout → TASK 03.5+

03.1 must not create competing Cart/Wishlist/Checkout services.

If real functionality already exists and is approved, reuse it.

Otherwise do not ship a misleading clickable control that does nothing.

Document intentional screenshot divergence if a later-phase action is omitted from the functional 03.1 UI.

## 13.3 Card Consistency

Verify:

- equal visual rhythm across short/long names;
- image containment/cropping;
- price row wrapping;
- discount label wrapping;
- review text wrapping;
- button/action alignment;
- mobile/tablet/desktop behavior;
- focus state;
- no invalid nested interactive elements.

---

# 14. Product Details

Product Details is a major part of this task.

Use the existing approved Product Details route if present.

If no route exists, establish the repository-consistent route, normally:

```text
/products/:slug
```

unless current routing/documentation defines another approved convention.

## 14.1 Required Layout

Conceptually:

```text
Breadcrumb

────────────────────────────────────────────────────────

Product Gallery              Product Information
                             Brand / Category
                             Product Name
                             Model
                             Rating summary + review count
                             Price / compare-at / discount
                             Status label if approved
                             Description
                             Availability
                             later-phase action area where applicable

────────────────────────────────────────────────────────

Description | Specifications | Reviews

Active tab panel

────────────────────────────────────────────────────────

More in <Category>
```

## 14.2 Product Data

Product detail must use real backend Product data.

At minimum support:

- id/slug;
- name;
- SKU where useful;
- model number;
- Brand;
- Category;
- full description;
- price;
- compare-at price;
- discount presentation;
- availability;
- ordered images;
- grouped specifications;
- average rating;
- review count;
- Review list endpoint/hook;
- same-category Product list.

## 14.3 Product Not Found

Direct deep links to invalid/inactive Product identifiers must produce the repository-approved Not Found behavior.

Do not expose internal identifiers or raw backend errors.

---

# 15. Product Image Gallery

The MacBook Product Details screenshot establishes the gallery baseline.

Support:

- one-image Product;
- multiple-image Product;
- ordered image list;
- primary/main image;
- thumbnail rail;
- selected thumbnail state;
- click/touch selection;
- keyboard selection;
- clear focus state;
- meaningful alt text;
- responsive thumbnail behavior;
- image fallback;
- no layout jump when switching images;
- no broken aspect ratio;
- no thumbnail overflow;
- graceful missing secondary images.

Do not implement Cloudinary in 03.1.

Cloudinary belongs to the later approved task.

Use the current approved ProductImage/media strategy and keep the implementation compatible with a future storage-provider change.

---

# 16. Product Specifications

Product specifications must come from normalized ProductSpecification data.

Do not hardcode Product-specific component branches such as:

```text
if Samsung...
if MacBook...
```

Group specifications by their stored group/category.

Example:

```text
DISPLAY
Screen Size       6.2 inches
Resolution        2340 × 1080
Panel             Dynamic AMOLED

PERFORMANCE
Processor         ...
GPU               ...

MEMORY
RAM               8 GB
Storage           256 GB
```

Requirements:

- stable display order;
- meaningful grouping;
- category-appropriate Product seed diversity;
- semantic markup (`dl`, table, or equivalent appropriate to the design);
- mobile readability;
- no horizontal overflow;
- empty/missing group behavior;
- no fabricated values.

---

# 17. Ratings and Reviews — Approved 03.1 Scope

Ratings and Reviews are explicitly part of TASK 03.1 Product Details because they are present in the approved Figma Make customer experience and no later roadmap task owns them.

They must be implemented as real domain behavior, not screenshot-only fake data.

## 17.1 Repository Inspection First

Before designing Review schema/API/UI, inspect:

- current Prisma schema;
- Product model;
- Customer/User model;
- Product service;
- Product API DTOs;
- seed architecture;
- existing ProductCard;
- existing Product Details implementation;
- authentication ownership;
- validation/security standards;
- relevant docs.

Reuse existing Review/Rating support if it legitimately exists.

If it does not exist, implement the smallest complete production-oriented Review foundation described here.

## 17.2 Minimum Review Domain Requirements

The exact schema naming must follow repository conventions, but the behavior must support:

- persisted Review identity;
- Product relationship;
- Customer/User relationship;
- integer rating from 1 through 5;
- Review text/content;
- optional title if consistent with the approved UI/domain;
- created timestamp;
- updated timestamp;
- referential integrity;
- one active Review per customer per Product unless current requirements intentionally support otherwise;
- public Review reading;
- authenticated Review writing;
- ownership enforcement for update/delete;
- safe deletion/update semantics.

Do not add moderation, verified-purchase badges, helpful votes, abuse-reporting, admin review management, or AI summarization unless existing approved requirements already own them.

## 17.3 Review Lifecycle

Minimum complete customer behavior:

```text
Guest
→ can read rating summary and Reviews
→ cannot create/update/delete a Review

Authenticated customer
→ can create one Review for a Product
→ can update own Review
→ can delete own Review
→ cannot edit/delete another customer's Review
```

If current Figma screenshots do not show the open Review-writing state, design this state as a controlled refinement using the existing ElectroHub design system rather than inventing an unrelated page style.

## 17.4 Rating Aggregates

ProductCard and Product Details must expose real aggregate data:

```text
averageRating
reviewCount
```

These must be derived from persisted Reviews or another repository-approved computed aggregate strategy.

Never seed/hardcode aggregate values independently of Review records.

Requirements:

- zero Reviews → defined zero state;
- one Review → correct singular count;
- many Reviews → correct aggregate;
- deleted/updated Review → aggregate changes correctly;
- average formatted consistently;
- no floating-point presentation anomalies.

## 17.5 Review API

Reuse repository API conventions.

The exact route names must be consistent with existing Product REST structure.

Expected capabilities include the equivalent of:

```text
GET    Product review list / summary
POST   authenticated customer Review
PATCH  authenticated owner Review
DELETE authenticated owner Review
```

Requirements:

- strict validation;
- rating range validation;
- bounded title/body length;
- pagination for Review list where necessary;
- deterministic sort default, normally newest first unless docs say otherwise;
- safe supported alternate sort only if useful;
- authorization on writes;
- no email/private customer-data leakage;
- sanitized public author identity according to existing account/profile rules;
- rate-limit/security posture consistent with current backend standards;
- no mass-assignment of protected fields;
- duplicate-review conflict handled safely.

## 17.6 Reviews Tab

Product Details must include a real accessible Reviews tab.

The Product Details tabs are:

```text
Description
Specifications
Reviews
```

Use existing Radix UI primitives if appropriate/currently established.

Required semantics:

- `tablist`;
- `tab`;
- `tabpanel`;
- selected state;
- ARIA association;
- Left/Right arrow navigation where the chosen tabs primitive expects it;
- Home/End where supported;
- predictable focus;
- visible focus state;
- keyboard activation;
- responsive layout.

## 17.7 Reviews Panel

At minimum support:

- average rating;
- total review count;
- star summary;
- Review list;
- empty state;
- loading state;
- error/retry state;
- create/update/delete flow for authenticated owners;
- pagination or bounded loading if enough Reviews exist.

A rating distribution visualization is allowed if it improves the approved Reviews panel and can be derived efficiently from real Review data.

Do not fabricate percentages.

## 17.8 Review Security and Privacy

Never expose:

- customer email;
- phone;
- address;
- access token;
- refresh token;
- internal role claims;
- internal database metadata.

Only expose approved public author display information.

Backend authorization remains authoritative.

Do not rely on hidden frontend controls to protect update/delete operations.

---

# 18. Same-Category Browsing

The `More in Phones` screenshot establishes a same-category browsing surface.

Generalize it as:

```text
More in <Category>
```

Requirements:

- same Category as current Product;
- exclude current Product;
- bounded result count;
- active/visible Products only;
- reuse ProductCard;
- deterministic order;
- avoid duplicate queries where cached data is suitable;
- no AI/personalization language;
- no user-behavior scoring.

AI recommendations belong to a later task.

---

# 19. Availability

03.1 owns **availability presentation**, not future inventory-management operations.

Use current Inventory/Product availability data.

Support states already valid in the domain, such as:

- In stock;
- Out of stock;
- low stock only if current domain legitimately exposes it.

Do not implement 03.4 inventory mutation/business workflows early.

Availability must:

- not rely on color alone;
- have accessible text;
- remain visually consistent on card/details;
- not claim real-time certainty beyond the current API/cache model;
- respect 02.7 documentation that cached availability is not a real-time reservation system.

---

# 20. Pricing and Discounts

Use existing Decimal-safe Product pricing contracts.

Support:

- normal price;
- compare-at price;
- calculated discount when legitimate;
- ProductCard display;
- Product Details display.

Do not store hardcoded visual discount percentages that can drift from price data.

If:

```text
compareAtPrice <= price
```

then do not render a false discount.

Currency formatting must be consistent across the application.

---

# 21. Product Summary vs Product Detail DTOs

Keep list APIs lean.

Use an architecture equivalent to:

```text
ProductSummary
→ data required for ProductCard/catalog rows

ProductDetail
→ full description
→ ordered image gallery
→ specifications
→ Review summary
→ detail-only metadata
```

Do not send the full specification tree and entire Review list for every ProductCard in a Product-grid request.

Product Summary may include:

- identity/slug;
- name;
- category/Brand presentation data;
- primary image;
- price/compareAtPrice;
- availability summary;
- short description;
- averageRating;
- reviewCount.

Product Detail may add:

- full images;
- full description;
- Product specifications;
- model/SKU as appropriate;
- Review summary;
- other detail metadata.

Review list should use its own bounded API/query rather than bloating Product detail payload with an unbounded Review collection.

---

# 22. React Query Integration

All 03.1 server state must use the established 02.7 architecture.

Expected key families may include/extend existing factories for:

```text
products.list(...)
products.detail(slug)
categories.list(...)
brands.list(...)
reviews.list(productId, params)
reviews.summary(productId) if separate
```

Exact names must follow current `queryKeys` conventions.

Do not create ad hoc array keys directly inside page components if current factories exist.

## 22.1 Product Detail Query

Use the existing Product cache philosophy.

No manual component fetch.

Forward AbortSignal through central API client.

## 22.2 Review Queries

Use stable Review keys.

After Review mutation:

- invalidate/update affected Review list;
- invalidate/update rating summary;
- invalidate Product detail if it includes rating summary;
- invalidate affected Product-list/card summaries if they include aggregate rating;
- avoid clearing unrelated public cache families.

Do not use global `queryClient.clear()` for ordinary Review mutations.

## 22.3 Background Fetch UX

Existing successful Product/catalog content must remain visible during background refetch.

Do not replace current data with a full-page loader merely because `isFetching` is true.

---

# 23. Loading Strategy

Preserve 02.7 loading hierarchy:

```text
Real route/page chunk wait
→ ElectroHubLoader

Structured Product/Card/Grid/Detail data
→ skeletons

Button/mutation action
→ compact inline progress
```

Do not add artificial delay to show the ElectroHubLoader.

03.1 may create missing structural skeletons, including:

- ProductCardSkeleton;
- ProductGridSkeleton if justified;
- ProductDetailSkeleton;
- ProductGallerySkeleton;
- Review list skeleton.

Skeletons must match real content structure and must not be taller/shorter enough to cause major layout jump.

---

# 24. Dataset Expansion

The original 24-Product curated foundation is insufficient to prove a real catalog.

TASK 03.1 must expand the **DEV curated catalog to at least 120 Products**, with a target range of approximately **120–150 meaningful Products**.

Do not generate meaningless duplicate rows just to hit a number.

Quality and coverage matter more than raw count.

## 24.1 Product Distribution

Use the current approved Category structure from the repository.

A reasonable target distribution may be approximately:

```text
Laptops            20–25
Smartphones        20–25
Tablets            10–15
Audio              15–20
Wearables          10–15
Monitors/Displays  10–15
Accessories        20–25
Other approved category
                   enough for realistic pagination/filter coverage
```

Do not rename/change approved categories merely to fit this example.

## 24.2 Product Data Coverage

Each curated Product should have legitimate deterministic values for applicable fields:

- unique name;
- unique SKU;
- slug;
- model number;
- Brand;
- Category;
- description;
- price;
- optional compare-at price;
- Inventory/availability;
- primary image;
- useful specifications;
- multiple images where practical.

## 24.3 State Coverage

Dataset must deliberately include:

- normal-price Products;
- discounted Products;
- available Products;
- unavailable Products;
- low/zero quantity where domain supports it;
- low price / mid price / high price;
- short names;
- long names;
- short descriptions;
- long descriptions;
- single-image Products;
- multi-image Products;
- small specification sets;
- rich specification sets;
- different Brands;
- different Categories;
- Products with no Reviews;
- one Review;
- several Reviews;
- many Reviews;
- mixed rating distributions;
- high average rating;
- low/mid average rating.

---

# 25. Product Images in Seed Data

Every curated Product must have at least one legitimate image record.

A meaningful subset must have 2–4 images so the gallery is genuinely exercised.

Coverage should include:

```text
1 image
2 images
3 images
4+ images
```

Use the current approved media strategy.

Do not prematurely introduce Cloudinary.

Do not create fragile/unapproved hotlinks purely for visual appearance if current media conventions provide a safer option.

Image records must have deterministic ordering.

---

# 26. Product Specifications in Seed Data

Specifications must be realistic and category-appropriate.

Examples only:

## Laptops

- CPU
- GPU
- RAM
- Storage
- Display
- Battery
- Connectivity
- Weight

## Smartphones

- Display
- Processor
- RAM
- Storage
- Camera
- Battery
- Connectivity
- Dimensions

## Audio

- Type
- Connectivity
- Battery
- ANC
- Microphone
- Weight

## Displays

- Panel
- Size
- Resolution
- Refresh rate
- Brightness
- Ports
- HDR capability where legitimate

Use existing normalized ProductSpecification structure.

Do not embed category-specific JSON blobs in components as a shortcut.

---

# 27. Review Seed Data

Ratings must come from Review records.

Seed a deterministic, meaningful Review dataset for DEV.

Target enough Reviews to exercise:

- aggregate calculations;
- zero-state;
- one-review state;
- multiple pages of Reviews where pagination is supported;
- mixed 1–5-star distributions;
- update/delete aggregate behavior tests.

A practical target is roughly **300–500 deterministic DEV Review records** distributed across the curated Product catalog, while intentionally leaving some Products with zero Reviews.

Do not seed thousands of meaningless Review rows merely for volume.

Review text must be deterministic and safe for development/demo use.

Do not include real personal data.

Do not seed PROD.

---

# 28. Seed Safety Requirements

The 03.1 seed must be:

- deterministic;
- repeatable;
- idempotent;
- DEV-safe;
- environment guarded;
- non-destructive;
- stable on repeated execution;
- scoped to owned curated records;
- safe around legacy Products;
- safe around existing commerce references.

Repeated seed execution must not create duplicates.

Never automatically seed PROD.

Do not delete unrelated legacy Products/Reviews/commerce data.

If existing seed architecture uses stable curated IDs/SKUs, extend that architecture rather than replacing it.

---

# 29. Database Migration Rules

A schema migration is **not automatically required** merely because 03.1 begins.

The existing Product schema should already support Product listing/details/images/specifications/Brand/category/pricing/availability.

However, if current repository inspection confirms no proper Review/Rating model exists, a reviewed Review schema migration is expected.

## 29.1 Migration Requirements

If required:

- create a forward Prisma migration;
- review generated SQL;
- no destructive unrelated changes;
- no `db push` shortcut;
- no reset;
- no automatic PROD application;
- preserve Product/User/commerce relationships;
- add only indexes/constraints justified by actual query behavior;
- ensure Review ownership/product lookup performance;
- keep migration docs synchronized.

## 29.2 DEV / PROD Boundary

DEV migration/seed validation and PROD migration are separate operational concerns.

Do not seed PROD.

Do not claim a PROD migration is verified unless it was explicitly executed through the approved operational gate with evidence.

---

# 30. Review Schema Performance Requirements

If Review schema is added, query patterns must be supported efficiently.

Likely requirements include indexes/constraints equivalent to:

- Product lookup;
- Customer/User lookup;
- Product + creation time ordering;
- Product + User uniqueness where one Review per customer/Product is enforced.

Do not add redundant indexes without evidence.

Do not calculate Product-list rating summaries with per-card Review queries.

---

# 31. Backend Performance / N+1 Rules

With 120+ Products, prove the implementation scales beyond the original tiny seed.

Required:

- `/products` remains paginated;
- bounded page size;
- filtering/sorting remains database-side;
- no Product-image N+1;
- no Category N+1;
- no Brand N+1;
- no Review aggregate N+1;
- Product Details loads images/specifications efficiently;
- Review list is separately bounded;
- same-category query is bounded;
- Home category counts do not produce one query per category if avoidable;
- list response remains lightweight.

Where raw SQL is used, preserve parameterization and existing security standards.

---

# 32. Storybook — Mandatory 03.1 Component Workflow

Storybook is already established under the frontend as a **development-only component playground**.

Do not replace it with a new `/components` route unless current repository architecture already contains one and a specific reason exists.

Do not install another component playground.

Storybook supplements — and does not replace — real-page and E2E verification.

Required workflow:

```text
Figma Make screenshot
        ↓
Storybook isolated component/state
        ↓
Playwright/browser screenshot
        ↓
visual comparison
        ↓
real page integration
        ↓
E2E verification
```

Use the established Storybook global styles, viewports, a11y addon, and isolated QueryClient conventions.

---

# 33. Required Storybook Coverage

As components are implemented/refined, add/update stories for the actual components.

Do not invent future components merely to populate Storybook.

Expected 03.1 stories include where applicable:

## ProductCard

- Default
- Discounted
- Out of stock
- No reviews
- One review
- High rating
- Long title
- Long description/snippet
- Missing optional metadata where legitimate

## ProductCardSkeleton

- default structure
- responsive width/state as useful

## CategoryCard / Category Navigation

- default
- long name
- low/zero count if allowed

## ProductGallery

- one image
- two images
- four images
- selected secondary thumbnail
- fallback/missing image

## ProductPrice

- normal
- discounted
- long currency/value edge state if relevant

## AvailabilityBadge/Status

- in stock
- out of stock
- low stock only if domain supports it

## ProductRating

- zero Reviews
- one Review
- mixed rating
- high rating

## ProductReviewCard

- default
- long content
- low rating
- owner controls where authenticated story context is appropriate

## ProductReviews

- loading
- empty
- error
- populated
- pagination state if used

## ProductSpecifications

- one group
- multiple groups
- long values

## Product Details Tabs

- Description active
- Specifications active
- Reviews active

## Existing shared components

Update Breadcrumb/Pagination/EmptyState/ErrorState stories only if 03.1 changes their supported states/usage.

---

# 34. Story Fixtures

Storybook stories must use deterministic local fixtures.

Stories must not make real API requests by default.

Fixtures must follow real current Product/Review types.

Once 03.1 adds legitimate rating/review fields, Storybook may use those supported fields.

Do not fabricate unsupported future Cart/Wishlist/Checkout behavior.

---

# 35. Exact Visual QA — Required

Visual fidelity is a Definition-of-Done gate.

Do not claim a visual PASS because the page merely “looks close.”

For each critical component/page:

```text
Figma Make PNG
        ↓
initial implementation
        ↓
Storybook or real route at matching viewport
        ↓
Playwright/browser screenshot
        ↓
manual side-by-side comparison
        ↓
controlled refinement where justified
        ↓
final screenshot/evidence
```

Pixel-level QA is required where screenshot evidence exists, subject to normal browser/font rasterization differences.

Verify measurable properties such as:

- container width;
- section width;
- card width/height;
- image dimensions/aspect ratio;
- gutters;
- spacing/gaps;
- alignment;
- typography size/weight/line-height;
- border thickness;
- approved corner treatment;
- colors;
- icon size/alignment;
- grid columns;
- tab underline/selection;
- pagination dimensions;
- thumbnail sizing;
- Product Details column balance;
- Footer/Header spacing;
- overflow/clipping.

Do not use a huge screenshot-diff tolerance that hides visible mismatches.

Do not add a new screenshot-testing dependency solely for this task if Playwright/browser/manual comparison already provides the required evidence.

---

# 36. Required Viewports

Use the exact Figma Make source screenshot viewport first where meaningful.

The supplied screenshots are 1920px wide with heights from 906–911px.

Capture equivalent sections at the corresponding source viewport and scroll position/anchor.

Also verify standard project viewports:

```text
390px   Mobile
768px   Tablet
1440px  Desktop
1920px  Large Desktop
```

Where Figma evidence only exists at desktop size, derive responsive behavior from:

- Phase 01 responsive rules;
- existing shared-component behavior;
- usability/accessibility requirements;
- current page architecture.

Do not merely shrink desktop CSS and call the page responsive.

---

# 37. Required Screenshot Evidence Matrix

Final handoff must include a matrix for each supplied screenshot.

For each screenshot report:

```text
Screenshot:
<exact filename>

Source dimensions:
<width>x<height>

Reference role:
<component/page/state>

Live route or Storybook story:
<route/story>

Viewport used:
<width>x<height>

Scroll/section anchor:
<description>

Captured implementation:
<artifact/path/test evidence>

Visual result:
PASS / PASS WITH DOCUMENTED REFINEMENT / FAIL

Differences/refinements:
<none or exact details>
```

Do not collapse all 12 screenshot references into a vague “Figma checked” statement.

---

# 38. Manual Visual QA — Mandatory

Automated tests do not replace manual inspection.

Manually inspect at representative viewports for:

- wrong spacing;
- wrong hierarchy;
- inconsistent ProductCard heights;
- image cropping;
- broken image fallback;
- misaligned price/discount rows;
- awkward rating/review wrapping;
- overflow;
- clipped dropdowns;
- sticky-layering problems;
- gallery clipping;
- thumbnail alignment;
- specification overflow;
- Reviews layout;
- tab alignment;
- Footer positioning;
- Header overlap;
- empty-state placement;
- loading-state layout jump;
- inconsistent page background;
- mobile Product Details stacking.

---

# 39. Keyboard Verification — Mandatory

Perform real keyboard-only checks.

## Breadcrumb

- Tab reaches links;
- Enter activates;
- current item semantics are correct.

## ProductCard

- Product navigation reachable;
- no invalid nested interactive elements;
- visible focus;
- later-phase action slots do not create dead controls.

## Category Cards / Navigation

- keyboard reachable;
- Enter activates;
- visible focus.

## Filters / Sort / Search

Preserve approved 02.6 keyboard behavior.

## Product Gallery

- thumbnail controls keyboard reachable;
- Enter/Space selection;
- selected state exposed;
- focus remains predictable.

## Product Details Tabs

- proper Tabs semantics;
- arrow-key navigation where applicable;
- Home/End where supported;
- active tab exposed;
- focus visible.

## Reviews

- review form fields labeled;
- star/rating input keyboard operable;
- validation errors associated with fields;
- owner update/delete controls keyboard reachable;
- destructive action confirmation follows current UX standards if required.

## Pagination

- previous/next/page links/buttons reachable;
- current page state exposed;
- disabled controls behave correctly;
- Enter/Space activation as appropriate.

---

# 40. Accessibility Requirements

Accessibility is part of implementation, not deferred polish.

## 40.1 Product Images

- meaningful `alt` text;
- decorative images explicitly treated as decorative;
- thumbnail controls have accessible names.

## 40.2 Product Rating

Star visuals must have a text alternative.

A screen reader must understand something equivalent to:

```text
Rated 4.8 out of 5 based on 318 reviews
```

Do not rely on five star icons alone.

## 40.3 Breadcrumb

Use semantic breadcrumb navigation, normally:

```html
<nav aria-label="Breadcrumb">
```

with the current item identified appropriately.

## 40.4 Availability

Do not communicate availability only via green/red color.

## 40.5 Tabs

Use correct tab semantics and focus behavior.

## 40.6 Specifications

Use semantic structure appropriate to key/value data.

## 40.7 Review Form

- visible labels;
- accessible validation;
- logical focus order;
- no placeholder-only labeling;
- error summary if consistent with form standards.

## 40.8 Storybook A11y

Run the established Storybook a11y addon for relevant stories.

Treat it as a review aid, not proof of complete accessibility.

---

# 41. Motion Requirements

Do not add motion merely because the task is Commerce.

Allowed subtle motion areas may include:

- gallery image transition;
- hover/focus states;
- tabs;
- dropdowns;
- category interaction;
- existing skeleton/loader behavior.

All new non-essential motion must respect:

```text
prefers-reduced-motion: reduce
```

The ElectroHubLoader reduced-motion behavior from 02.7 must not regress.

---

# 42. Responsive Requirements

Verify all major 03.1 surfaces at:

- 390;
- 768;
- 1440;
- 1920;
- exact Figma screenshot width/height where relevant.

Explicitly inspect:

- Product toolbar wrapping;
- Product-grid columns;
- card widths/heights;
- ProductCard text wrapping;
- Category cards;
- promotional sections;
- Product Details column stacking;
- gallery sizing;
- thumbnail wrapping/scrolling;
- tab layout;
- specification layout;
- Review summary/list;
- Review form;
- same-category grid;
- pagination;
- empty/error/loading states;
- Header/Footer.

No horizontal viewport overflow is acceptable at supported sizes.

---

# 43. Integration Testing — Story to Real Page

A Storybook PASS alone does not prove integration.

For critical components, map isolated stories to real parent views.

Example:

```text
ProductCard Storybook
        ↓
Home New Arrivals
        ↓
Home Featured Deals
        ↓
/products grid
        ↓
More in <Category>
```

And:

```text
ProductGallery Storybook
        ↓
Product Details
```

And:

```text
Breadcrumb Storybook
        ↓
/products
        ↓
Product Details
```

And:

```text
ProductRating / ProductReviews Storybook
        ↓
ProductCard
        ↓
Product Details Reviews tab
```

Document this mapping in the implementation handoff.

---

# 44. Frontend Unit / Component Test Requirements

Add/extend focused tests for relevant final behavior.

At minimum cover where applicable:

- ProductCard normal state;
- ProductCard discount state;
- ProductCard no-review state;
- rating accessible label;
- ProductGallery image selection;
- ProductGallery keyboard behavior;
- Product specification grouping;
- Product Details tabs;
- Reviews tab loading/empty/error/populated states;
- Review form validation;
- Review owner actions;
- CategoryCard navigation;
- Breadcrumb semantics;
- Pagination semantics;
- Availability presentation;
- Product skeleton structure;
- Error/empty state recovery;
- reduced motion for new motion-sensitive components.

Do not overuse brittle tests that assert implementation details instead of customer behavior.

---

# 45. Backend Unit / Service / API Test Requirements

Add focused tests for:

- Product list remains paginated;
- Product Summary remains lean;
- Product Detail returns ordered images;
- Product Detail returns specification groups/data correctly;
- inactive Product visibility rules;
- Category browsing;
- category Product counts;
- same-category query excludes current Product;
- pricing/compare-at rules;
- rating average/count calculation;
- Review list pagination;
- Review creation validation;
- duplicate customer/Product Review rule;
- Review update ownership;
- Review delete ownership;
- aggregate changes after create/update/delete;
- guest write rejection;
- auth-required Review mutation behavior;
- sanitized public author shape;
- no private account fields;
- seed determinism/idempotency;
- large curated dataset expectations.

---

# 46. Database Integration Verification

If schema/migration changes are required for Reviews, add/extend gated integration tests according to current database-testing conventions.

Verify on the approved DEV target where allowed:

- migration ledger clean;
- migration applies successfully;
- Review constraints;
- Review FKs;
- indexes;
- one-review-per-user/Product rule if chosen;
- Review deletion/update behavior;
- Product/User deletion relation behavior consistent with approved domain;
- Product references/commerce references remain intact;
- seed executes twice with stable scoped counts;
- no PROD seed.

Do not convert local mock/unit tests into claims of live database verification.

---

# 47. E2E / Browser / Playwright Scenarios

Use existing Playwright/browser tooling.

Required focused scenarios include:

### A — Browse all Products

- enter `/products`;
- Product grid renders;
- Product count correct;
- pagination works.

### B — Browse Category

- select category from Home/category surface;
- URL state correct;
- catalog filters to category;
- browser back restores prior state.

### C — Search + Filter + Sort

- preserve 02.6 behavior;
- no stale result race;
- pagination/reset interactions correct.

### D — Pagination

- next page;
- back/forward;
- disabled first/last state;
- current page semantics.

### E — Open Product Details

- ProductCard → Product Details;
- deep link directly;
- breadcrumb correct;
- Product data correct.

### F — Gallery

- select secondary thumbnail;
- main image changes;
- keyboard selection;
- no layout jump.

### G — Specifications

- open Specifications tab;
- grouped data visible;
- keyboard tabs work.

### H — Reviews

- open Reviews tab;
- rating summary visible;
- Review list visible or correct empty state;
- pagination where applicable.

### I — Authenticated Review lifecycle

- create Review;
- aggregate updates;
- update own Review;
- aggregate updates if rating changes;
- delete own Review;
- aggregate updates;
- cannot mutate another customer's Review.

### J — Availability

- in-stock Product state;
- out-of-stock Product state;
- no false actionable purchase behavior introduced by 03.1.

### K — Empty Products

- produce zero-result filter/search state;
- empty state appears;
- clear filters restores results.

### L — Controlled Error / Retry

- sanitized error;
- retry behavior;
- no raw internal details.

### M — Background Refetch

- existing Product results remain visible during background refetch;
- no full-page loader flash;
- no empty-state flash.

### N — Responsive

Verify core flows at 390 / 768 / 1440 / 1920.

### O — Keyboard-only

Verify Breadcrumb, category controls, Product links, Gallery, Tabs, Reviews, Filters, Sort, Pagination.

### P — Reduced Motion

Where 03.1 adds motion, emulate reduced motion and verify usable static behavior.

---

# 48. Visual Regression Scenarios

Using Storybook and real routes, capture at least:

- ProductCard default;
- ProductCard discounted;
- ProductCard no Reviews;
- ProductCard long title;
- CategoryCard;
- ProductGallery one image;
- ProductGallery multi-image;
- Product Details top section;
- Description tab;
- Specifications tab;
- Reviews tab;
- Product Rating summary;
- Reviews empty state;
- Reviews populated state;
- `/products` populated grid;
- `/products` empty state;
- pagination;
- Home New Arrivals;
- Home Shop by Category;
- Home Featured Deals;
- More in Category.

Compare against the supplied screenshots where direct evidence exists.

For states/screens not shown in Figma Make, use the established ElectroHub design system and document that the state is a controlled 03.1 refinement/additional state.

---

# 49. Advanced UX Interactions

03.1 may refine interactions where they materially improve the Product Catalog and remain within scope.

Examples:

- smooth but restrained gallery transition;
- clear active thumbnail state;
- accessible Product-detail tabs;
- URL-preserving filter/category behavior;
- useful background-fetch feedback without content replacement;
- Review mutation feedback;
- focus restoration after mutation/dialog if applicable;
- scroll behavior after pagination if current UX standards define it;
- sensible deep-link behavior.

Do not implement speculative gestures or animation-heavy effects.

---

# 50. Security Requirements

Review all changed backend/frontend paths for:

- authorization;
- validation;
- XSS-safe rendering;
- Review text handling;
- no dangerous HTML injection;
- no secrets in browser/server logs;
- no raw SQL injection;
- parameterized queries;
- no private User fields in public Review responses;
- no cross-user Review mutation;
- no mass assignment;
- bounded pagination/limits;
- sane input length constraints;
- central API client behavior preserved;
- existing CSRF/cookie/token posture preserved;
- no auth architecture rewrite.

No Critical or High unresolved security issue may remain at handoff.

---

# 51. API Compatibility Requirements

Avoid breaking existing consumers.

If Product DTOs gain fields such as:

```text
averageRating
reviewCount
```

add them compatibly.

Do not silently rename/remove 02.5/02.6 fields.

Do not change Search matching semantics as part of Product Catalog work unless a proven 03.1 defect requires it.

Do not return huge nested Review/spec/image payloads on Product list endpoints.

---

# 52. URL / Routing Requirements

Preserve URL ownership.

Catalog state should remain shareable/bookmarkable where appropriate:

- category;
- filters;
- sort;
- page;
- committed Search term where current architecture uses it.

Product Details deep link must be stable.

Tabs may remain local UI state unless current routing requirements explicitly require tab deep links.

Do not encode ephemeral Storybook-only state in production URLs.

---

# 53. Performance Requirements

The 120–150 Product dataset is a performance fixture, not decoration.

Verify:

- reasonable Products response size;
- Product list not loading all rows;
- no Product card query waterfall;
- image lazy-loading where consistent with current standards;
- primary above-the-fold Product image handled appropriately;
- React Query cache reuse;
- no duplicate Category/Brand reference requests while fresh;
- bounded same-category query;
- bounded Reviews;
- no Review aggregate N+1;
- no repeated expensive aggregate query per Product if avoidable;
- no unnecessary remount/refetch on ProductCard interaction;
- build remains valid.

Existing Vite bundle-size advisory is not automatically a 03.1 blocker, but 03.1 must not introduce an obvious large dependency solely for catalog UI if existing tools/components suffice.

---

# 54. Error / Empty / Edge Cases

Explicitly handle:

## Catalog

- no Products;
- invalid filter;
- category with zero Products;
- page beyond available range;
- request failure;
- slow request;
- stale cache background refetch.

## Product Details

- Product not found;
- inactive Product;
- one image;
- many images;
- missing optional compare-at price;
- no Reviews;
- no optional spec group;
- very long description;
- out of stock.

## Reviews

- zero Reviews;
- one Review;
- duplicate Review attempt;
- rating boundary 1 and 5;
- invalid rating 0/6;
- blank required content if content is required;
- overlong title/body;
- guest create attempt;
- user edits another user's Review;
- Review deleted while UI is open;
- request error during mutation;
- aggregate after update/delete.

## UI

- long Product name;
- long Brand/category name;
- image load failure;
- keyboard-only;
- reduced motion;
- small mobile viewport;
- large desktop whitespace balance.

---

# 55. Styling Rules

Reuse current design tokens and SCSS architecture.

Do not create parallel global styling conventions.

Preserve the currently approved ElectroHub visual language.

Where the project has already standardized rectangular UI surfaces to square corners, do not reintroduce rounded surfaces simply because an older screenshot shows them.

True semantic circles may remain circular where appropriate.

Any meaningful visual divergence from Figma must be documented as a deliberate refinement.

---

# 56. Icons

Reuse the project's established icon strategy, currently Lucide React where applicable.

Do not mix arbitrary icon libraries.

Icons used alone as controls need accessible labels.

Do not reproduce the Figma Make prototype overlay controls.

---

# 57. Storybook / Production Isolation

Storybook remains development-only.

03.1 must not:

- import Storybook into production app entry points;
- expose Storybook through customer routing;
- ship `storybook-static` with the frontend production artifact;
- rely on Storybook-only fixture data inside production components.

Storybook stories may share repository-owned deterministic fixtures only where doing so does not couple production code to dev tooling.

---

# 58. Documentation Updates

Update all docs materially affected by the final implementation.

Likely examples include:

- Products feature documentation;
- Categories feature documentation;
- Product API documentation;
- database/schema documentation if Reviews are added;
- relationships/indexing docs if schema changes;
- seed documentation;
- state-management/query-key docs if new Review query families are added;
- Storybook docs if new 03.1 story conventions/states need documentation;
- testing/E2E docs;
- accessibility notes if required;
- dependency docs only if dependencies changed;
- ADR/Decisions only for true architectural decisions;
- changelog/roadmap progress according to current workflow.

Do not update unrelated docs for cosmetic reasons.

Final docs must describe actual implementation, not intended behavior that was not completed.

---

# 59. No Random Bug Hunting

TASK 03.1 is already large.

Do not expand scope into unrelated bugs discovered while browsing the repository.

If an unrelated issue is observed:

```text
OUT-OF-SCOPE OBSERVATION
→ record it
→ do not fix it
```

Only fix an unrelated-looking defect when it directly blocks 03.1 implementation/verification and the minimal fix is demonstrably necessary.

---

# 60. Explicit Out-of-Scope Features

Unless already implemented and merely reused, do **not** implement these future roadmap features in 03.1:

- full Shopping Cart business logic — 03.2;
- Wishlist business logic — 03.3;
- Inventory management/mutation workflows — 03.4;
- Checkout — 03.5;
- Stripe — 03.6;
- Orders — 03.7;
- transactional order emails — 03.8;
- PDF order/payment documents — 03.9;
- Image Search backend — 04.2;
- Cloudinary — 04.3;
- AI recommendations — 04.4;
- delivery tracking — 04.5+;
- Admin Product CRUD — Phase 05;
- analytics;
- recommendation scoring;
- recently viewed;
- Product comparison feature;
- Review moderation/admin tooling unless already approved elsewhere.

Ratings/Reviews are **not out of scope**. They are explicitly approved in this 03.1 task.

---

# 61. Implementation Sequence

Use Plan Mode first and produce a bounded implementation plan before coding.

Recommended sequence:

1. Read AGENTS + task + relevant docs.
2. Inspect current Product/Category/Search/Inventory frontend/backend/schema/test surfaces.
3. Inspect all supplied Figma Make screenshots.
4. Produce screenshot role/route/component map.
5. Confirm existing Storybook foundation.
6. Confirm existing 02.5/02.6/02.7 architecture and reuse points.
7. Inspect Review/Rating support.
8. Design minimal Review domain/migration only if absent.
9. Implement backend Review foundation + tests.
10. Extend Product Summary/Detail contracts with real aggregate rating data.
11. Expand deterministic DEV seed to 120–150 Products + meaningful images/specs + Review data.
12. Implement/refine reusable catalog components.
13. Add/update Storybook stories as each component lands.
14. Complete/refine Home catalog discovery sections.
15. Complete/refine `/products` integration.
16. Implement Product Details + Gallery + Tabs + Specifications + Reviews.
17. Implement same-category browsing.
18. Run focused unit/service/API tests.
19. Run Storybook visual/a11y checks.
20. Run browser/Playwright E2E scenarios.
21. Capture exact screenshot evidence at source and standard viewports.
22. Perform manual visual/keyboard/responsive QA.
23. Fix only task-scoped proven defects.
24. Update relevant docs.
25. Run final validation cycle on final code.
26. Produce implementation/evidence handoff.

Do not commit/push/merge unless separately instructed.

---

# 62. Required Final Validation

Use actual repository commands rather than inventing scripts.

At minimum validate relevant final code with:

- backend typecheck;
- frontend typecheck;
- backend lint;
- frontend lint;
- backend build if part of current workflow;
- frontend build;
- Storybook static build;
- focused backend tests;
- focused frontend tests;
- Review API/service tests;
- Product/catalog regression tests;
- relevant seed tests;
- gated DB integration tests where environment is approved and schema changed;
- focused Playwright/E2E;
- Storybook/browser visual capture;
- manual visual/keyboard/responsive checks;
- `git diff --check`.

If a required validation cannot run, report exactly why.

Do not convert “not run” into PASS.

---

# 63. Required Final Evidence

The implementation handoff must provide concrete evidence for:

## Repository

- branch;
- HEAD;
- `git status --short`;
- `git diff --stat`;
- `git diff --check`.

## Documentation

- docs inspected;
- docs updated;
- architecture decisions/deviations.

## Product Data

- curated Product count;
- category count;
- represented Brand count;
- ProductImage count for 03.1 curated scope;
- ProductSpecification count for 03.1 curated scope;
- Review count for 03.1 curated scope;
- second seed-run stability/idempotency proof where DEV execution is approved;
- explicit statement that PROD was not seeded.

## Schema/Migration

- whether Review schema already existed;
- migration file if added;
- SQL review;
- DEV migration evidence if executed;
- PROD migration status separately;
- indexes/constraints;
- no destructive unrelated changes.

## APIs

- Product Summary contract;
- Product Detail contract;
- Review contracts;
- validation;
- auth/ownership behavior;
- pagination;
- sanitized public data.

## React Query

- query keys/factories used;
- Product Detail query;
- Review query/mutation invalidation;
- cancellation;
- background refetch behavior;
- no duplicate client/query architecture.

## Storybook

- stories added/updated;
- 390 / 768 / 1440 / 1920 viewports;
- a11y results;
- screenshot capture proof;
- no production Storybook import.

## Visual QA

- all 12 screenshot matrix rows;
- exact viewport;
- live route/story;
- comparison result;
- documented refinement/deviation;
- manual inspection result.

## Keyboard / Accessibility

- Breadcrumb;
- ProductCard;
- Category controls;
- Gallery;
- Tabs;
- Reviews;
- Pagination;
- Filters/Sort;
- reduced motion.

## E2E

Map each required scenario A–P to an actual test/manual-browser scenario and result.

## Performance

- bounded Product list;
- no obvious Product/Brand/Category/Image/Review N+1;
- same-category query bounded;
- Review list bounded;
- list DTO remains lean;
- Category/Brand cache reuse not regressed.

## Security

- guest/owner Review rules;
- no private author data;
- no Review XSS/raw HTML injection;
- no raw internal errors;
- no Critical/High security issue.

---

# 64. Release Blockers

TASK 03.1 is **not ready for approval** if any of these remain:

- competing QueryClient/API client/Product Search architecture;
- Product listing loading all Products without pagination;
- broken 02.6 Search/filter/sort behavior;
- URL-state regression;
- Product Details manual ad hoc fetch bypassing React Query/API client;
- Review aggregate values hardcoded/fabricated;
- Review writes not authorized on backend;
- cross-user Review update/delete possible;
- private User fields exposed publicly;
- Product review count/average inconsistent with stored Reviews;
- unbounded Review list;
- broken Product Gallery keyboard behavior;
- inaccessible Tabs;
- visually broken primary Figma reference at required viewport without documented justified refinement;
- Storybook component looks correct but real-page integration is broken;
- screenshot evidence missing for critical pages/components;
- mobile/tablet horizontal overflow;
- fake loading delays;
- raw backend errors exposed;
- seed not idempotent;
- PROD seeded;
- destructive migration;
- unreviewed schema drift;
- Cloudinary implemented early without approval;
- AI recommendations introduced in same-category section;
- Cart/Wishlist/Checkout business logic reimplemented out of scope;
- Critical/High security issue;
- required tests failing;
- typecheck/lint/build failing;
- `git diff --check` failing.

---

# 65. Definition of Done

TASK 03.1 is complete only when all applicable items are proven with evidence.

## Architecture

- [ ] 02.5 Product Foundation reused
- [ ] 02.6 Search Foundation preserved
- [ ] 02.7 State/API Foundation preserved
- [ ] no competing API/query/search architecture
- [ ] Product Summary vs Detail boundary remains performant

## Documentation Discovery

- [ ] docs tree inspected
- [ ] all materially relevant docs read
- [ ] irrelevant docs not blindly consumed
- [ ] affected docs updated

## Catalog Data

- [ ] at least 120 meaningful curated DEV Products
- [ ] current approved Categories represented
- [ ] legitimate Brands
- [ ] realistic specification coverage
- [ ] every curated Product has primary image
- [ ] meaningful multi-image subset
- [ ] deterministic Review dataset
- [ ] zero/one/few/many Review states represented
- [ ] seed deterministic
- [ ] seed idempotent
- [ ] PROD not seeded

## Product Listing

- [ ] Product grid complete
- [ ] ProductCard authoritative/reused
- [ ] result count correct
- [ ] filters/sort/search preserved
- [ ] Category browsing refined
- [ ] pagination correct
- [ ] empty state correct
- [ ] error state correct
- [ ] background refetch preserves content

## Home Catalog Surfaces

- [ ] New Arrivals uses real Product data
- [ ] Shop by Category works
- [ ] Category counts real
- [ ] Featured Deals uses legitimate pricing
- [ ] visual hierarchy refined against screenshots

## Product Details

- [ ] deep link works
- [ ] breadcrumb works
- [ ] Product information complete
- [ ] pricing complete
- [ ] availability presentation complete
- [ ] gallery complete
- [ ] thumbnails complete
- [ ] one-image state complete
- [ ] multi-image state complete
- [ ] specifications dynamic/grouped
- [ ] Description tab complete
- [ ] Specifications tab complete
- [ ] Reviews tab complete
- [ ] More in Category complete

## Ratings / Reviews

- [ ] real persisted Review model/support
- [ ] rating 1–5 enforced
- [ ] real averageRating
- [ ] real reviewCount
- [ ] zero Review state
- [ ] public Review reading
- [ ] authenticated Review creation
- [ ] owner Review update
- [ ] owner Review delete
- [ ] cross-user mutation blocked
- [ ] aggregates update after mutations
- [ ] Review list bounded/paginated where needed
- [ ] no private author data
- [ ] ProductCard rating real
- [ ] Product Details rating real

## Storybook

- [ ] ProductCard states
- [ ] ProductCardSkeleton if implemented
- [ ] CategoryCard
- [ ] ProductGallery states
- [ ] ProductPrice
- [ ] Availability
- [ ] ProductRating
- [ ] ProductReviewCard
- [ ] ProductReviews states
- [ ] ProductSpecifications
- [ ] Product Details Tabs
- [ ] shared Breadcrumb/Pagination stories updated if needed
- [ ] a11y panel checked
- [ ] no real API requests by default
- [ ] production isolation preserved

## Visual QA

- [ ] all supplied screenshots accessible
- [ ] all 12 screenshot roles mapped
- [ ] exact source viewport comparisons performed
- [ ] 390 verified
- [ ] 768 verified
- [ ] 1440 verified
- [ ] 1920 verified
- [ ] meaningful refinements documented
- [ ] prototype overlay not implemented
- [ ] manual visual review completed

## Accessibility / Keyboard

- [ ] Breadcrumb semantics
- [ ] ProductCard semantics
- [ ] Category controls keyboard
- [ ] Gallery keyboard
- [ ] Tabs keyboard/ARIA
- [ ] rating text alternative
- [ ] Review form accessible
- [ ] pagination accessible
- [ ] availability not color-only
- [ ] reduced-motion behavior verified

## Performance

- [ ] Product list bounded
- [ ] no obvious Product N+1
- [ ] no Brand/Category N+1
- [ ] no image N+1
- [ ] no Review aggregate N+1
- [ ] Review list bounded
- [ ] same-category list bounded
- [ ] Product list payload remains lean

## Security

- [ ] backend Review authorization
- [ ] validation
- [ ] no private User data
- [ ] no raw internal errors
- [ ] no unsafe Review HTML rendering
- [ ] no secrets logged
- [ ] no Critical/High issue

## Validation

- [ ] backend typecheck
- [ ] frontend typecheck
- [ ] backend lint
- [ ] frontend lint
- [ ] backend/frontend builds as applicable
- [ ] Storybook build
- [ ] focused backend tests
- [ ] focused frontend tests
- [ ] Review tests
- [ ] Product regression tests
- [ ] E2E A–P mapped
- [ ] screenshot evidence
- [ ] `git diff --check`

---

# 66. Required Implementation Report Structure

Final implementation report must use this structure.

```text
# TASK 03.1 — PRODUCT CATALOG IMPLEMENTATION REPORT

STATUS:
READY FOR PRINCIPAL ARCHITECT REVIEW / REQUEST CHANGES / BLOCKED

## REPOSITORY
BRANCH:
HEAD:
AGENTS:

## DOCS DISCOVERY
DOCS TREE INSPECTED:
YES / NO

DOCS READ:
- ...

DOCS UPDATED:
- ...

## ARCHITECTURE
02.5 REUSED:
02.6 PRESERVED:
02.7 PRESERVED:
COMPETING API/QUERY ARCHITECTURE:
NONE / details

## DATASET
CURATED PRODUCTS:
CURATED CATEGORIES:
REPRESENTED BRANDS:
CURATED PRODUCT IMAGES:
CURATED SPECIFICATIONS:
CURATED REVIEWS:

SECOND DEV SEED RUN:
PASS / FAIL / NOT RUN

PROD SEEDED:
NO / YES

## DATABASE / MIGRATION
REVIEW MODEL PRE-EXISTING:
YES / NO

MIGRATION ADDED:
NONE / path

SQL REVIEW:
PASS / FAIL / N/A

DEV MIGRATION:
PASS / FAIL / NOT RUN

PROD MIGRATION:
NOT RUN / approved evidence

## PRODUCT API
PRODUCT SUMMARY:
PASS / FAIL

PRODUCT DETAIL:
PASS / FAIL

IMAGES:
PASS / FAIL

SPECIFICATIONS:
PASS / FAIL

AVAILABILITY:
PASS / FAIL

SAME-CATEGORY:
PASS / FAIL

## RATINGS / REVIEWS
REAL PERSISTED REVIEWS:
YES / NO

AVERAGE RATING:
PASS / FAIL

REVIEW COUNT:
PASS / FAIL

PUBLIC READ:
PASS / FAIL

AUTH CREATE:
PASS / FAIL

OWNER UPDATE:
PASS / FAIL

OWNER DELETE:
PASS / FAIL

CROSS-USER MUTATION BLOCKED:
PASS / FAIL

PRIVATE USER DATA EXPOSED:
NONE / details

## REACT QUERY
PRODUCT DETAIL KEY:
...

REVIEW KEYS:
...

CANCELLATION:
PASS / FAIL

INVALIDATION:
PASS / FAIL

BACKGROUND REFETCH:
PASS / FAIL

## STORYBOOK
STORIES ADDED/UPDATED:
- ...

390:
PASS / FAIL
768:
PASS / FAIL
1440:
PASS / FAIL
1920:
PASS / FAIL

A11Y:
PASS / FAIL / findings

PRODUCTION ISOLATION:
PASS / FAIL

## FIGMA MAKE SCREENSHOT MATRIX
1. Home page(1).png
...
12. products-page(1).png
...

For each include:
source size / route-story / viewport / section / PASS-REFINEMENT-FAIL / differences

## FIGMA REFINEMENTS
NONE
OR
- Element / source / change / reason / result

## KEYBOARD / ACCESSIBILITY
BREADCRUMB:
PRODUCTCARD:
CATEGORY NAV:
GALLERY:
TABS:
REVIEWS:
PAGINATION:
FILTERS/SORT:
REDUCED MOTION:

## E2E MATRIX
A Browse all Products:
B Browse Category:
C Search + Filter + Sort:
D Pagination:
E Product Details:
F Gallery:
G Specifications:
H Reviews:
I Review lifecycle:
J Availability:
K Empty Products:
L Error/Retry:
M Background Refetch:
N Responsive:
O Keyboard-only:
P Reduced Motion:

## PERFORMANCE
PRODUCT LIST BOUNDED:
N+1 PRODUCT:
N+1 BRAND/CATEGORY:
N+1 IMAGE:
N+1 REVIEW AGGREGATE:
REVIEW LIST BOUNDED:
SAME-CATEGORY BOUNDED:

## SECURITY
CRITICAL:
HIGH:
AUTHORIZATION:
VALIDATION:
XSS/REVIEW CONTENT:
RAW ERRORS:
SECRETS:

## VALIDATION
BACKEND TYPECHECK:
FRONTEND TYPECHECK:
BACKEND LINT:
FRONTEND LINT:
BACKEND BUILD:
FRONTEND BUILD:
STORYBOOK BUILD:
BACKEND TESTS:
FRONTEND TESTS:
E2E:
git diff --check:

## GIT
git status --short:
...

git diff --stat:
...

## OUT-OF-SCOPE OBSERVATIONS
NONE
OR
- ...

## FINAL
CRITICAL:
HIGH:
MEDIUM:
RELEASE BLOCKERS:
ALL 03.1 DOD ITEMS CLOSED:
YES / NO

READY FOR PRINCIPAL ARCHITECT REVIEW:
YES / NO
```

---

# 67. Principal Architect Acceptance Standard

03.1 is not accepted because the code exists.

It is accepted only when:

```text
Domain behavior is real
        +
Architecture remains coherent
        +
120+ Product dataset proves realistic behavior
        +
Ratings/Reviews are legitimate persisted behavior
        +
Storybook proves component states
        +
Real pages prove integration
        +
Figma Make comparison proves visual quality
        +
Keyboard/accessibility/responsive behavior is verified
        +
Tests prove regressions are controlled
        +
Documentation matches implementation
        +
Security/performance evidence is acceptable
```

Evidence is mandatory.

Do not self-approve.

Do not merge automatically.

---

# 68. Final Task Principle

> **TASK 03.1 must turn ElectroHub's existing Product infrastructure into a polished, realistic, production-oriented customer catalog without sacrificing the architecture already approved in 02.5, 02.6, and 02.7.**

> **Figma Make screenshots lead the starting visual direction, but controlled documented refinements may improve the result.**

> **Ratings and Reviews are real 03.1 functionality, not hardcoded screenshot decoration.**

> **Storybook proves components in isolation; Playwright/browser proves them in the real application. Neither replaces the other.**

> **A milestone is complete only when behavior, tests, documentation, visual fidelity, accessibility, responsiveness, security, and evidence all agree.**

