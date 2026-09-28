# ELECTROHUB — TASK 02.6
# SEARCH FOUNDATION

> **Approved UX / scope refinement (2026-09-28; final correction 2026-09-28):** `/search` is dedicated live search with no submit button or catalog filter panel; Sort sits to the right of Search on wider screens. Query edits commit after 275 ms with URL replacement; Enter commits immediately. Suggestions debounce 175 ms. Short one/two-character query tokens match whole alphanumeric terms, preventing incidental hits such as `tt` inside “battery.” `/products` owns compact search, progressive filters, sort, removable chips, reset and pagination; its toolbar uses the shared content width. Both routes reuse Search APIs and SearchService. The shared CustomerLayout Footer follows the supplied `Footer.png`; Admin is excluded. An empty-query API request returns a bounded newest-first page for `/products`, while plain `/search` remains untouched. These approvals supersede older screenshot/button/filter deferrals and the Phase 03.1 Products-page deferral below.

**Branch:** `feature/search-foundation`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Phase:** 02 — Core Platform  
**Depends on:** Approved TASK 02.5 Product Foundation  
**Scope:** Dedicated customer Search experience + text product search + suggestions + filtering + sorting + results + reusable search/filter primitives + responsive/accessibility states + API/tests/docs

---

# 0. Task Authority

TASK 02.6 establishes ElectroHub's **search and product-discovery foundation** on top of the approved TASK 02.5 Product Foundation.

The roadmap ownership for TASK 02.6 is:

```text
Product search
Search suggestions
Filtering
Sorting
Search results
```

This task additionally formalizes the approved Search-page UX already represented in the provided Figma Make screenshots:

```text
Navbar Search icon
        ↓
Dedicated /search page
        ↓
Text Search / Image Search tabs
        ↓
Text product search
        ↓
Suggestions + filters + sorting
        ↓
Product search results
```

TASK 02.6 is the first real customer product-discovery feature.

The dedicated `/search` route is not itself the catalog toolbar; under the approved refinement, the customer `/products` route uses this same Search foundation for catalog discovery. Image Search remains UI shell only.

> **Principal architecture rule:** Search must consume the canonical Product / Category / Brand / Price / Availability contracts created by TASK 02.5. It must not create a second product domain, duplicate Product DTO logic unnecessarily, or introduce a new search infrastructure dependency without evidence.

If the current repository differs from assumptions in this task, inspect the actual implementation first and adapt while preserving this architectural intent.

---

# 1. Branch / Dependency Rule

TASK 02.6 belongs on:

```text
feature/search-foundation
```

not:

```text
feature/product-foundation
```

TASK 02.6 must start from a repository state that already contains the approved TASK 02.5 Product Foundation.

Expected dependency chain:

```text
02.5 Product Foundation
        ↓
02.6 Search Foundation
```

If `develop` does not yet contain approved 02.5 work, branch from the approved 02.5 integration point according to the repository Git workflow and reconcile with `develop` before merge.

Do not mix 02.5 and 02.6 commit histories merely for convenience.

---

# 2. Roadmap Position

Approved sequence:

```text
02.5 Product Foundation
        ↓
02.6 Search Foundation
        ↓
02.7 State and API Foundation
        ↓
03.1 Product Catalog
        ↓
03.4 Full Inventory
        ↓
04.2 Search by Image
        ↓
04.3 Cloudinary
        ↓
05.2 Admin Product Management
```

TASK 02.6 prepares reusable search behavior for later screens without prematurely implementing the phases that own those screens.

---

# 3. Objective

Build a polished, production-oriented Search foundation covering:

```text
Dedicated customer Search page
Navbar search navigation
Text product search
Search suggestions
Filtering
Sorting
Search results
Pagination
URL-backed search state
Reusable search/filter/sort primitives
Image Search UI shell only
Responsive behavior
Accessibility
Backend Search APIs
Swagger/OpenAPI
Tests
Documentation
```

The final implementation must be usable with the realistic TASK 02.5 DEV product dataset and must be designed so later Product Catalog and Admin Product Management screens can reuse the primitives without copying the entire Search page.

---

# 4. Task-Specific Visual Authority

TASK 02.6 has approved Figma Make screenshot references supplied with this task.

For this task, the implementation agent must inspect the provided screenshots before coding.

A live Figma Design URL is **not required** for TASK 02.6 when the supplied screenshots are available.

The provided screenshots are the task-specific visual references for page composition, hierarchy, and interaction intent.

Repository design-system documentation and existing components remain authoritative for actual tokens, component implementation, accessibility, and engineering constraints.

## Required screenshot references

Inspect all of the following before implementation:

```text
1. Search page.png
2. search_page.png
3. Searchpage.png
4. products-page.png
5. products page.png
```

The screenshot filenames may be attached directly to the task or stored in the repository's approved Figma reference folders.

Do not guess from memory.

---

# 5. Screenshot Interpretation Matrix

## 5.1 `Search page.png`

Approved visual intent:

- Standard ElectroHub customer header remains visible.
- Breadcrumb: `Home > Search`.
- Large `Search` page heading.
- Supporting copy: `Find laptops, phones, audio, and more.` or approved equivalent.
- Tabs:
  - Text Search
  - Image Search
- Text Search is initially active.
- Large search input with search icon.
- Approved refinement: no adjacent Search button; the input is live/debounced and Enter commits immediately.
- Standard site footer.

This screenshot defines the **initial desktop Text Search state**.

## 5.2 `search_page.png`

Approved visual intent:

- Search field retains submitted query.
- The screenshot's button is historical visual direction, intentionally omitted from the approved live-search UX.
- Results summary such as:

```text
1 result for “macbook”
```

- `Browse all products` navigation appears as a secondary route action when appropriate.
- Product result uses the approved ProductCard visual language.
- Results occupy the content area beneath the search controls.

This screenshot defines the **successful text-search result state**.

## 5.3 `Searchpage.png`

Approved visual intent:

- Search header/breadcrumb remains consistent.
- Image Search tab is active.
- Large bordered drag/drop area.
- Image icon / media affordance.
- Copy similar to:

```text
Drag an image here or click to upload
Supports JPG, PNG, WEBP, and other image formats
```

- `Browse files` control.

This screenshot defines the **Image Search UI shell**, not real image-search processing.

## 5.4 `products-page.png`

This screenshot is approved for the customer `/products` discovery page in 02.6 following the scope refinement above.

It is an approved reference for reusable customer product-discovery controls and states:

- Search field visual treatment.
- Category filter chip/button pattern.
- Sort/select treatment.
- Reset treatment.
- No-results visual language.
- Customer product-result layout direction.

Implement the reusable customer discovery controls on `/products` using real API-backed categories/brands and project design tokens. Do not hardcode illustrative data.

## 5.5 `products page.png`

This Admin Products screenshot is **not permission to integrate Search into Admin Product Management now**.

It is an approved reference for shared primitive language only:

- Search field.
- Reset control.
- Dense product-management toolbar treatment.

Actual Admin Products searching/filtering remains Phase 05.2.

---

# 6. Figma Make Navigation Overlay Is Not Production UI

The screenshots may contain a Figma/Make navigation overlay such as:

```text
Customer | Admin | Flows | Components
```

This is a design/prototype navigation aid.

Do **not** implement it in the production ElectroHub application.

---

# 7. Approved vs. Refinable Design Decisions

Before implementation, compare the supplied Figma Make screenshots against TASK 02.6 requirements and current repository design-system rules.

The implementation agent must understand what is already approved versus what it may refine.

## 7.1 Already approved — preserve

The following should not be redesigned casually:

- Dedicated Search page concept.
- Standard customer header remains visible.
- Search icon routes to Search instead of expanding header content.
- Breadcrumb + title + supporting text hierarchy.
- Text Search / Image Search tab architecture.
- Large primary search input.
- Live Text Search input without an adjacent submit button.
- Search results beneath the Search controls.
- ProductCard visual language for results.
- Image Search drag/drop shell.
- Customer toolbar visual language from Products screenshot.
- Reset/filter visual language.
- Standard footer.
- ElectroHub typography/color/component language.

## 7.2 Allowed / expected refinements

The screenshots do not show every state or viewport.

TASK 02.6 explicitly allows the implementation agent to complete and polish:

- Mobile layout.
- Tablet layout.
- Large-desktop layout.
- Search-suggestion dropdown.
- Loading/skeleton states.
- Search errors.
- Suggestion errors/fallback behavior.
- No-results state on Search.
- Filter toolbar composition.
- Mobile filter interaction.
- Sort interaction.
- Pagination controls.
- Active-filter indicators.
- Filter-clear interactions.
- Search-input clear behavior.
- Selected Image Search file state.
- Drag-over state.
- Invalid local image state.
- Replace/remove selected image interaction.
- Hover/active/focus states.
- Keyboard interactions.
- Screen-reader semantics.
- URL/back-forward behavior.
- Stale request cancellation.
- Reduced-motion behavior.
- Appropriate spacing refinement using approved tokens.
- Layout alignment refinement using approved responsive/container rules.

These refinements must remain visually consistent with the screenshots and the approved design system.

## 7.3 Not allowed without architectural approval

Do not:

- redesign the Search page into a materially different layout;
- remove the tabs;
- replace the approved SearchField treatment with a different design language;
- introduce Tailwind/shadcn/Bootstrap/Material UI;
- introduce random gradients or colors;
- create an alternative header system;
- build a different full-screen search overlay;
- implement image AI processing;
- implement a full catalog/admin experience;
- create a new design system.

---

# 8. In Scope

TASK 02.6 owns:

- Dedicated `/search` customer route.
- Navbar search icon navigation to `/search`.
- Removal of the old expandable-header search behavior.
- Text Search tab.
- Image Search tab shell.
- Text product search backend.
- Product-search result API.
- Search-suggestions API.
- Product suggestions.
- Category suggestions.
- Brand suggestions.
- Search query normalization.
- Case-insensitive product discovery.
- Search result relevance foundation.
- Category filter.
- Brand filter.
- Availability filter.
- Min/max price filter.
- Sorting.
- Bounded pagination.
- URL-backed Search state.
- Search result count.
- Search results grid/list using existing ProductCard language.
- Initial/loading/success/empty/error states.
- Reusable SearchField primitive where appropriate.
- Reusable filter controls.
- Reusable sort control.
- Reset/Clear-filter control.
- Search toolbar composition.
- Suggestion combobox UX.
- Request debouncing.
- Stale request cancellation.
- Responsive Search UX.
- Search accessibility.
- Swagger/OpenAPI.
- Backend tests.
- API integration tests.
- Frontend tests.
- Browser/E2E Search flow.
- Documentation.

---

# 9. Explicitly Out of Scope

## 9.1 Image Search Processing — Phase 04.2

Do NOT implement:

- image upload to backend;
- camera capture processing;
- FastAPI image processing;
- feature extraction;
- similarity matching;
- image embeddings;
- image-search result ranking;
- AI image-search API;
- image-search persistence.

## 9.2 Cloudinary — Phase 04.3

Do NOT implement:

- Cloudinary SDK;
- image upload pipeline;
- signed uploads;
- production media storage;
- Cloudinary transformations.

## 9.3 Full Product Catalog — Phase 03.1

Do NOT implement:

- final Products page;
- final Category catalog page;
- final Product Details page;
- final catalog image gallery;
- full customer catalog browsing architecture.

## 9.4 Admin Product Search — Phase 05.2

Do NOT implement:

- Admin Products search wiring;
- Admin product filtering;
- Admin table sorting;
- Admin product CRUD;
- Admin stock management.

Reusable primitives may be prepared now.

## 9.5 React Query — TASK 02.7

Do NOT introduce:

- React Query;
- query cache architecture;
- query invalidation architecture;
- global API-state redesign.

Use the current approved API-consumption pattern.

## 9.6 Full Inventory Filtering — Phase 03.4

Do NOT implement:

- low-stock filter business logic;
- inventory movement filters;
- warehouse filters;
- reservation filters.

02.6 availability is only the existing Product/Inventory-derived public availability projection.

## 9.7 AI / Recommendations / Analytics

Do NOT implement:

- AI recommendations;
- recommendation scoring;
- SearchEvent persistence;
- SearchHistory persistence;
- popular-search analytics;
- user-search profiling;
- recommendation/search embeddings.

---

# 10. Search Architecture

The target architecture is:

```text
                  SEARCH FOUNDATION 02.6
                           │
             ┌─────────────┴─────────────┐
             ↓                           ↓
       Text Search                 Suggestions
             │                           │
             └─────────────┬─────────────┘
                           ↓
                     SearchService
                           │
              ┌────────────┼────────────┐
              ↓            ↓            ↓
           Query         Filters       Sort
              │            │            │
              └────────────┼────────────┘
                           ↓
                 Product Foundation 02.5
                           │
             Product / Category / Brand
                           │
                        Prisma
                           │
                    Supabase PostgreSQL
```

Frontend:

```text
Navbar Search Icon
        ↓
      /search
        ↓
 ┌──────────────────────┐
 │      Text Search     │ ← fully functional
 ├──────────────────────┤
 │      Image Search    │ ← UI shell only
 └──────────────────────┘
        ↓
Search Input
        ↓
Suggestions
        ↓
Filters / Sorting
        ↓
Search Results
```

---

# 11. Remove Header Search Expansion

The current header search expansion architecture must be removed.

Current behavior to eliminate may include:

- clicking Search icon expands an input inside the header;
- normal header elements are hidden/replaced;
- header Search state changes layout width;
- Search-specific header animation;
- expansion-specific state/tests/styles.

Final behavior:

```text
Navbar Search Icon
        ↓
router navigation
        ↓
/search
```

The customer header must remain structurally stable across screens.

The Search icon must work with:

- mouse/touch;
- keyboard activation;
- accessible name.

Remove obsolete expansion code only when proven unused after the route change.

Do not remove unrelated header behavior.

---

# 12. Global Header Decision

Freeze this navigation concept:

```text
Logo | Home | Products | Orders | Account              Search Cart Wishlist User
                                                           │
                                                           ↓
                                                        /search
```

No customer page should have to support an alternate “expanded search header” layout after TASK 02.6.

---

# 13. Search Route

Add/adapt:

```text
/search
```

The route should support direct URL loading such as:

```text
/search?q=macbook
/search?q=sony&brand=sony
/search?category=headphones&sort=price-asc
```

Search state must be restorable from the URL.

---

# 14. Search Page Initial Layout

The initial Search page should follow `Search page.png`.

Expected structure:

```text
Customer Header

Home > Search

Search
Find laptops, phones, audio, and more.

Text Search      Image Search
──────────

[ Search icon | Search for MacBook, iPhone, headphones... ] [ Search ]

Footer
```

No fake results should be shown before the customer searches or applies a filter.

---

# 15. Page Container / Polished Layout

The Search page should use the approved customer page container/gutter system.

Requirements:

- consistent max-width with other customer pages;
- clear vertical rhythm;
- search controls align to content grid;
- footer begins after meaningful content rather than being forced into awkward viewport gaps;
- no large accidental empty areas caused by fixed heights;
- no horizontal overflow;
- desktop search controls do not become excessively stretched;
- tablet width remains balanced;
- mobile controls remain usable.

Do not hardcode screenshot-specific absolute positions.

---

# 16. Search Tabs

Tabs:

```text
Text Search
Image Search
```

Use existing approved Tabs/Radix primitives where present.

Requirements:

- Text Search is default.
- Active indicator matches approved design language.
- Tabs support keyboard navigation.
- `aria-selected` / tabpanel semantics are correct.
- Focus remains visible.
- Switching tabs does not corrupt Text Search URL state.
- Image Search selection remains local UI-only.

The task may choose whether the active tab itself is represented in the URL only if doing so follows existing routing/state conventions.

Do not introduce a new route solely for Image Search unless existing routing architecture clearly requires it.

---

# 17. Text Search Input

The main Search input must:

- use the approved Input/SearchField visual language;
- include a search icon;
- have a programmatic label;
- support Enter to submit;
- commit normalized text after 275 ms of typing or deleting; Enter commits immediately;
- trim outer whitespace;
- preserve normal internal spaces;
- support common punctuation in real product/model names;
- expose a clear action where consistent with design-system patterns;
- show visible focus;
- not submit while disabled/loading;
- preserve current query after results load.

Suggested placeholder from approved screenshot:

```text
Search for MacBook, iPhone, headphones...
```

Do not hardcode result behavior to these example terms.

---

# 18. Search Query Normalization

Normalize search input conservatively.

Recommended behavior:

- trim leading/trailing whitespace;
- collapse excessive internal whitespace where safe;
- use case-insensitive matching;
- preserve meaningful hyphens/model punctuation;
- do not strip letters/numbers needed by SKU/modelNumber searches;
- do not silently mutate the displayed customer query into a materially different value.

Do not implement typo correction/fuzzy AI behavior in 02.6.

---

# 19. Searchable Product Fields

Text search should operate over the TASK 02.5 domain.

Approved searchable fields:

```text
Product.name
Product.sku
Product.modelNumber
Product.description
Brand.name
Category.name
```

A public slug may participate internally if useful but should not be the primary visible search behavior.

Search remains case-insensitive.

Do not search arbitrary internal fields.

---

# 20. Search Visibility Rules

Search must preserve Product Foundation visibility behavior.

At minimum:

- inactive Products are not returned;
- Products in inactive Categories are not returned;
- unavailable products may still appear unless current Product visibility rules explicitly hide them;
- public results do not expose inventory quantity;
- nullable legacy Brand is handled safely;
- internal/admin-only fields are not returned.

Do not redefine Product publication rules independently in SearchService.

Reuse Product Foundation logic wherever practical.

---

# 21. Search Matching Semantics

The implementation must provide deterministic matching.

Conceptually:

```text
q matches ANY approved searchable field
AND
all selected filters must match
```

Example:

```text
q = galaxy
category = smartphones
brand = samsung
availability = available
```

means:

```text
(query matches one searchable field)
AND category is smartphones
AND brand is samsung
AND product availability is AVAILABLE
```

Do not silently OR filters together.

---

# 22. Multi-Word Queries

Multi-word queries must behave predictably.

The implementation may use safe tokenization if it improves results, but the final behavior must be documented and tested.

Do not introduce a complex language-processing engine.

Examples that should remain useful:

```text
apple laptop
sony headphones
iphone 16
macbook air
```

Avoid behavior where adding a second useful word unexpectedly broadens the result set.

---

# 23. Relevance Foundation

Search sort options include `relevance`.

Relevance must be deterministic and explainable.

Conceptual ranking priority:

```text
1. exact Product name / SKU / model number match
2. Product name starts with query
3. Product name contains query
4. SKU / model number contains query
5. Brand / Category match
6. Description contains query
```

Exact implementation should adapt to Prisma/PostgreSQL capabilities and current architecture.

Do not implement machine-learning relevance.

Do not introduce Elasticsearch, Meilisearch, Algolia, or another search service.

If raw SQL is genuinely required for ranking, it must be parameterized using approved Prisma mechanisms and isolated inside the Search data/service boundary.

Never interpolate raw user strings into SQL.

---

# 24. Search Backend Routes

Preferred foundational API surface:

```text
GET /api/search/products
GET /api/search/suggestions
```

Adapt names only if current repository API conventions require it.

Do not overload existing `/api/products` with a large parallel search/filter contract unless current architecture already explicitly expects that approach.

The Search API should remain a dedicated domain boundary built on Product Foundation helpers.

---

# 25. Product Search API Parameters

`GET /api/search/products`

Supported query parameters:

```text
q
category
brand
availability
minPrice
maxPrice
sort
page
pageSize
```

Unknown query parameters should follow the project's strict validation convention and should not be silently ignored.

---

# 26. `q` Parameter

`q` is optional for the API so filter-only discovery remains possible.

Frontend initial `/search` should not automatically render every Product merely because `q` is empty.

Recommended validation:

- trim;
- maximum safe length;
- allow real model punctuation;
- reject pathological input length.

A maximum around 120–200 characters is sufficient unless repository standards define another limit.

Do not use unlimited search strings.

---

# 27. Category Filter

Query:

```text
category=<category-slug>
```

Requirements:

- use canonical Category slug;
- case/format normalization follows Category rules;
- no client-supplied category name should become raw SQL;
- filter combines with query and all other filters using AND semantics.

UI should use categories from the real Category API, not hardcoded screenshot labels.

Do not hardcode:

```text
Phones
Audio
TVs
```

if the current seeded categories are actually:

```text
Smartphones
Laptops
Tablets
Headphones
Monitors
Smartwatches
Gaming
Accessories
```

Use current database/domain data.

---

# 28. Brand Filter

Query:

```text
brand=<brand-slug>
```

Requirements:

- use canonical Brand slug;
- products with `brandId = null` naturally do not match a selected Brand filter;
- nullable legacy Brand must never crash results;
- no fake fallback Brand.

Brand options should come from the real Brand API.

---

# 29. Availability Filter

Approved public values:

```text
available
unavailable
```

or the project's canonical equivalent.

Availability must use the existing TASK 02.5 derivation.

Conceptually:

```text
Product inactive
→ hidden / not searchable according to visibility rules

Product active + Inventory.quantity > 0
→ AVAILABLE

Product active + missing/zero Inventory
→ UNAVAILABLE
```

Do not add another stock/availability field solely for Search.

---

# 30. Price Filters

Queries:

```text
minPrice
maxPrice
```

Requirements:

- use Decimal-compatible parsing;
- no floating-point authority;
- values >= 0;
- when both are provided, `minPrice <= maxPrice`;
- filtering applies to canonical Product `price`;
- compareAtPrice is not the authoritative filter value.

Return validation error for malformed values.

---

# 31. Sorting Contract

Approved sort values:

```text
relevance
price-asc
price-desc
newest
name-asc
```

Do not add `featured` merely because the Products screenshot contains a Featured dropdown.

TASK 02.5 did not establish a canonical featured-product field.

Do not mutate Product schema simply to imitate a Figma placeholder.

---

# 32. Sort Defaults

Recommended behavior:

```text
q present
→ default sort = relevance

q absent
→ default sort = newest
```

If a URL retains `sort=relevance` after the query becomes empty, normalize safely to the non-query default rather than producing a broken customer experience.

All sort modes must use deterministic tie-breakers.

Examples:

```text
price ASC, then createdAt DESC, then id ASC
price DESC, then createdAt DESC, then id ASC
name ASC, then id ASC
newest = createdAt DESC, then id ASC
```

---

# 33. Pagination Contract

Reuse Product Foundation pagination conventions where practical.

Supported:

```text
page
pageSize
```

Requirements:

- page >= 1;
- bounded maximum page;
- pageSize >= 1;
- pageSize maximum = 100 unless current standards are stricter;
- deterministic ordering;
- result metadata contains total and current page information.

The previously permissive `page <= 1,000,000` behavior must be tightened as part of 02.6 search-query hardening.

A reasonable bounded page limit should be selected and documented.

Do not implement cursor pagination unless current architecture already uses it.

---

# 34. Search Response Contract

Conceptual response:

```json
{
  "data": [
    {
      "id": "...",
      "name": "Apple MacBook Air 13 M3 8GB 256GB",
      "slug": "...",
      "category": {
        "id": "...",
        "name": "Laptops",
        "slug": "laptops"
      },
      "brand": {
        "id": "...",
        "name": "Apple",
        "slug": "apple"
      },
      "price": "1099.00",
      "compareAtPrice": null,
      "availability": "AVAILABLE",
      "primaryImage": {
        "url": "/images/...",
        "altText": "..."
      }
    }
  ],
  "meta": {
    "query": "macbook",
    "page": 1,
    "pageSize": 20,
    "total": 2,
    "totalPages": 1,
    "sort": "relevance"
  }
}
```

Exact envelope must follow existing API conventions.

Reuse TASK 02.5 Product summary mapping where practical.

Do not return full image galleries/specifications in search result lists.

---

# 35. Search Suggestions API

Preferred route:

```text
GET /api/search/suggestions?q=mac&limit=8
```

Required:

- query required;
- minimum query length before suggestions;
- bounded limit;
- default limit around 8;
- safe maximum around 10 unless standards specify otherwise;
- minimal fields only;
- deterministic ordering.

Suggestion types:

```text
PRODUCT
CATEGORY
BRAND
```

No AI suggestions.

---

# 36. Suggestion Response Contract

Conceptual response:

```json
{
  "data": [
    {
      "type": "PRODUCT",
      "label": "Apple MacBook Air 13 M3 8GB 256GB",
      "slug": "apple-macbook-air-13-m3-8gb-256gb",
      "secondaryLabel": "Apple · Laptops"
    },
    {
      "type": "BRAND",
      "label": "Apple",
      "slug": "apple"
    },
    {
      "type": "CATEGORY",
      "label": "Laptops",
      "slug": "laptops"
    }
  ]
}
```

Do not overfetch product details for suggestions.

---

# 37. Suggestion Ranking

Suggestions should prioritize useful direct matches.

Conceptual ordering:

```text
exact product/name match
product prefix match
product contains match
brand match
category match
```

Do not return huge lists.

Do not introduce personalization/history.

---

# 38. Suggestion Frontend Behavior

When the user types enough characters:

```text
mac
 ↓
Suggestion dropdown
```

Requirements:

- approximately 200–300 ms debounce;
- do not request after every un-debounced keystroke;
- abort/cancel stale suggestion requests;
- latest input wins;
- dropdown is anchored to SearchField;
- dropdown should not push page layout vertically in an unstable way;
- bounded height with scroll if needed;
- close on Escape;
- close on click outside;
- close after selection;
- no blank dropdown when no suggestions;
- suggestion API failure must not prevent manual Search submission.

---

# 39. Suggestion Keyboard UX

Required:

- ArrowDown moves to next suggestion;
- ArrowUp moves to previous suggestion;
- Enter applies active suggestion;
- Enter with no active suggestion submits the typed Search;
- Escape closes suggestions;
- Tab behavior remains accessible;
- focus/active option is announced correctly.

Use proper ARIA combobox/listbox semantics.

Do not create six independent focus traps or custom keyboard behavior that conflicts with browser expectations.

---

# 40. Suggestion Selection Behavior

TASK 03.1 may not yet provide final Product Details navigation.

Therefore:

## Product suggestion

If a valid approved Product Details route already exists and is intentionally usable, navigation may be reused.

Otherwise:

```text
select Product suggestion
→ place its useful query/name into Search state
→ execute Search
```

Do not create a premature Product Details route solely for suggestions.

## Brand suggestion

```text
select Brand
→ apply brand filter
→ execute Search
```

## Category suggestion

```text
select Category
→ apply category filter
→ execute Search
```

All actions reset page to 1.

---

# 41. URL-Backed Search State

Search state must be represented in URL query parameters after a Search/filter/sort action.

Examples:

```text
/search?q=macbook
/search?q=macbook&brand=apple
/search?q=galaxy&category=smartphones&brand=samsung&availability=available
/search?q=sony&sort=price-asc&page=2
```

Benefits that must work:

- refresh;
- bookmark;
- share;
- browser back;
- browser forward;
- direct URL navigation.

Do not keep authoritative Search state only in ephemeral component state.

---

# 42. URL State Rules

- typing alone does not need to push browser history;
- submitting Search updates URL;
- selecting a filter updates URL;
- changing sort updates URL;
- changing pagination updates URL;
- query/filter/sort changes reset page to 1;
- direct URL load initializes UI state;
- invalid URL values follow validation/error/normalization rules;
- back/forward restores visible controls and results.

Avoid history spam from every debounced suggestion keystroke.

---

# 43. Reusable Search / Filter / Sort Primitives

TASK 02.6 should prepare reusable controls for later Product Catalog and Admin Product Management without coupling those future pages to the Search page.

Preferred primitive concepts:

```text
SearchField
FilterChipGroup
FilterSelect
SortSelect
ResetFiltersButton
Pagination
```

Then compose them into Search-specific structures such as:

```text
ProductSearchToolbar
```

Do not build one enormous component that assumes Customer Search, Customer Catalog, and Admin Products all have identical requirements.

Reuse existing design-system components first.

---

# 44. Customer Search Toolbar

Search page should use reusable filter primitives after Search becomes active or filters are applied.

A polished desktop composition may include:

```text
Category chips
Brand select
Availability select
Price filter
Sort select
Reset filters
```

The main Search input remains the Search page's primary input and should not be duplicated again inside the toolbar unless actual repository/design evidence requires it.

---

# 45. Category Filter Chips

The `products-page.png` screenshot provides the visual direction for category buttons/chips.

Requirements:

- derive categories from actual Category API;
- one category active at a time for 02.6 unless current architecture already supports multi-select;
- active state clearly visible;
- `All`/clear state supported;
- horizontal overflow handled responsively;
- keyboard accessible;
- category changes reset page to 1.

Do not hardcode categories from the screenshot.

---

# 46. Brand / Availability / Price Controls

Use existing Select/Popover/Input primitives.

Brand:

- single selection in 02.6;
- populated from Brand API;
- clearable.

Availability:

- All;
- Available;
- Unavailable.

Price:

- minimum;
- maximum;
- clear/reset;
- validated;
- no floating-point corruption.

Do not build a dynamic specification-filter system in 02.6.

---

# 47. Reset/Clear Semantics

Distinguish actions clearly.

Recommended:

```text
Clear filters
→ preserves current text query
→ clears category/brand/availability/minPrice/maxPrice
→ restores sort default for current query
→ resets page to 1
```

The Search input itself may have a separate clear control according to approved Input patterns.

Do not unexpectedly erase a user's typed query when they only clear filters.

A future Product Catalog may configure the same Reset primitive differently.

---

# 48. Search Results Header

When results are available, show a concise summary.

Examples:

```text
1 result for “macbook”
2 results for “macbook”
24 products
```

Use correct singular/plural behavior.

Where appropriate and a valid Products route already exists:

```text
Browse all products
```

may navigate to `/products`.

Do not implement the full Products page here.

---

# 49. ProductCard Reuse

Search results must reuse the existing approved ProductCard / shared product-result component where available.

Do not create a separate:

```text
SearchProductCard
```

with a different visual system merely because the Search page needs results.

If ProductCard requires a mapping from TASK 02.5 API decimal strings to its display props, add the smallest explicit adapter/mapper required.

Do not silently coerce monetary strings through unsafe arithmetic.

---

# 50. Search Result Data

Each result should have enough data for the existing ProductCard:

```text
id
name
slug
category
brand?
primaryImage?
price
compareAtPrice?
availability
```

Do not fetch:

- full gallery;
- full specifications;
- internal Inventory quantity;
- unrelated commerce/customer data.

---

# 51. Search Result Grid

The result layout must respond to available space and existing ProductCard/grid rules.

Do not hardcode a desktop screenshot into a fixed one-column layout.

Expected direction:

```text
Mobile      → one column
Tablet      → one/two columns according to card minimum width
Desktop     → multi-column grid
Large       → multi-column grid within approved max-width
```

Use current grid/container tokens.

No horizontal overflow.

---

# 52. Initial State

On initial `/search` with no query/filter state:

- show Search page structure;
- Text Search active;
- input empty;
- no fake products;
- no `0 results` message unless design requires it;
- suggestions closed;
- filters may remain hidden/collapsed until Search is active if that best matches the provided design.

Do not automatically display all products solely because the route opened.

---

# 53. Loading State

While a Search request is in progress:

- keep layout stable;
- indicate loading using existing design-system pattern;
- live result status announces loading;
- prevent duplicate identical Enter commits;
- do not clear prior query text;
- stale prior results may remain with a subtle loading indication only if current UX pattern supports it;
- otherwise use ProductCard skeletons.

Loading must be accessible (`aria-busy` / status where appropriate).

---

# 54. Search Success State

Show:

- submitted query;
- active filters;
- result count;
- results;
- sort state;
- pagination when needed;
- Browse-all-products action where valid.

Do not display stale results from an earlier query after a newer request wins.

---

# 55. No-Results State

Use the approved visual language from `products-page.png`.

Search-specific copy may be:

```text
No results for “<query>”
Try another search or clear your filters.
```

Actions may include:

- Clear filters;
- clear query;
- Browse all products where valid.

Do not show a generic backend error when the real state is zero results.

---

# 56. Error State

Search errors must be controlled.

Requirements:

- generic customer-safe message;
- retry action where appropriate;
- Search input remains usable;
- filters remain recoverable;
- no Prisma error;
- no SQL;
- no stack trace;
- no DB URL/path.

Suggestion request errors should not block manual Search.

---

# 57. Pagination UI

Use an existing approved Pagination component if available.

If no reusable Pagination exists, implementing the smallest accessible reusable pagination primitive is allowed because Search results need it and Product Catalog can reuse it later.

Requirements:

- Previous/Next;
- current page state;
- disabled boundary states;
- URL update;
- page reset on query/filter/sort change;
- keyboard accessible;
- no invalid page navigation;
- optionally scroll/focus results heading after page change according to accessibility/reduced-motion standards.

Do not implement infinite scroll unless already approved.

---

# 58. Image Search Tab — Scope

TASK 02.6 implements only the **UI foundation** shown in `Searchpage.png`.

In scope:

- Image Search tab;
- drag/drop region;
- Browse files control;
- local file selection;
- local selected-file display/preview where practical;
- drag-over visual state;
- remove/replace local selection;
- client-only invalid-type feedback;
- accessibility;
- responsive behavior.

Out of scope:

- upload request;
- FastAPI;
- AI processing;
- matching;
- Cloudinary;
- backend image-search endpoint;
- similarity results.

---

# 59. Image Search Dropzone Initial State

Follow `Searchpage.png`:

```text
[ Image icon ]

Drag an image here or click to upload
Supports JPG, PNG, WEBP, and other image formats

[ Browse files ]
```

Use approved border, background, typography, spacing, icon and focus styles.

Do not implement the Figma prototype's helper overlay.

---

# 60. Image Search Drag-Over State

When a local file is dragged over the dropzone:

- visually indicate active drop target;
- retain clear border/focus contrast;
- avoid page layout jump;
- prevent browser navigation caused by dropped file;
- announce state where practical.

Do not upload the file.

---

# 61. Image Search Selected-File State

A polished 02.6 shell may show:

- local preview if browser-safe;
- file name;
- Replace;
- Remove.

The UI must make clear that real image-search processing is not performed in this task.

Do not add a functional “Search image” network action.

If the repository/product decision prefers the shell to stop at selection, preserve that scope.

---

# 62. Image Search Validation Boundary

TASK 04.2 owns the final server-side image-validation contract.

02.6 may perform minimal client-only preview safety such as:

- ensure a selected item is an image;
- support known browser preview types;
- reject obviously unsupported local selections.

Do not invent a permanent backend upload size contract in 02.6 unless already defined by repository standards.

Do not claim backend support for every format mentioned in prototype copy.

---

# 63. Frontend Network State — No React Query Yet

TASK 02.7 owns React Query and cache architecture.

TASK 02.6 must use the current approved frontend API client/fetch pattern.

Do not add React Query solely for Search.

Do not create a second global API client.

The implementation should nevertheless isolate Search API calls so 02.7 can migrate them cleanly later.

---

# 64. Request Cancellation / Race Conditions

Search and suggestions are vulnerable to stale responses.

Required behavior:

```text
User types query A
→ request A starts
User quickly types query B
→ request B starts
request A resolves last
```

The UI must not show A after B.

Use the project's approved mechanism such as:

- AbortController;
- request sequence IDs;
- equivalent safe stale-response suppression.

Suggestions and Search requests should be handled independently.

---

# 65. Search Submit Behavior

Submitting Search by:

- 275 ms after typing or deleting (replace current URL entry);
- Enter immediately with no active suggestion;

must:

- normalize query;
- write canonical URL state;
- reset page to 1;
- close suggestion list;
- execute one Search request;
- show loading state;
- render results/error.

Do not generate duplicate requests when Enter and a pending debounce refer to the same committed query.

---

# 66. Backend Layering

Follow current backend architecture.

Conceptually:

```text
Search Route
    ↓
Search Controller
    ↓
Search Service
    ↓
Prisma / Product helpers
```

Possible files, adapted to repository conventions:

```text
apps/backend/src/
├── routes/search.routes.ts
├── controllers/search.controller.ts
├── services/search.service.ts
├── validators/search.validator.ts
└── docs/swagger/search.openapi.ts
```

Do not duplicate a repository/data-access layer if current architecture does not use one.

---

# 67. Reuse Product Foundation DTO Logic

TASK 02.5 already owns:

- Product summary mapping;
- Decimal serialization;
- primary image mapping;
- Category summary;
- Brand summary;
- availability derivation;
- visibility rules.

Search should reuse/extract these helpers as needed.

Do not copy/paste a second divergent implementation into SearchService.

A small, focused helper extraction is permitted when necessary to share canonical mapping.

Avoid broad ProductService refactoring.

---

# 68. Search Validator

Use the existing validation library/pattern.

Validate:

```text
q
category
brand
availability
minPrice
maxPrice
sort
page
pageSize
suggestion limit
```

Unknown keys should follow current strict behavior.

Do not add another validation dependency.

---

# 69. API Errors

Use existing centralized error handling.

Expected:

```text
400 VALIDATION_ERROR
500 INTERNAL_SERVER_ERROR
```

Search itself generally returns `200` with zero results for valid filters that match nothing.

A syntactically valid but nonexistent category/brand slug should normally result in zero matching results rather than leaking internal existence details, unless current API standards define another behavior.

Suggestion endpoint may return an empty list for no matches.

---

# 70. Public Search Security

Search APIs may be unauthenticated, but they are still security-sensitive public query surfaces.

Verify:

- bounded query length;
- bounded page size;
- bounded page number;
- bounded suggestion count;
- validated sort values;
- validated price values;
- no raw SQL interpolation;
- no hidden Product fields;
- no customer/admin data;
- no DB metadata;
- existing rate limiting remains applied where appropriate;
- structured logging does not store unnecessary sensitive query payloads;
- internal errors are sanitized.

Search query strings are not secrets, but do not introduce persistent search-history logging/profile persistence in 02.6.

---

# 71. Raw SQL Rule

Prefer Prisma query APIs.

If relevance requires raw PostgreSQL SQL:

- use parameterized Prisma mechanisms;
- keep it isolated;
- document why Prisma query APIs were insufficient;
- include injection tests/validation;
- do not concatenate customer input;
- do not introduce a new SQL library.

---

# 72. Performance Requirements

Search is query-heavy relative to ordinary Product reads.

Required review:

- bounded result sets;
- no obvious N+1;
- only summary fields on result lists;
- only primary image on result lists;
- no specifications/gallery fetched for every result;
- suggestion count limited;
- suggestion fields minimal;
- frontend suggestion debounce;
- stale request cancellation;
- deterministic ordering;
- price/availability filtering performed efficiently;
- no full-table result materialization into browser memory.

Do not add a cache layer in 02.6.

---

# 73. Search Infrastructure Rule

Do NOT introduce:

- Elasticsearch;
- OpenSearch;
- Meilisearch;
- Algolia;
- Redis search;
- vector search;
- AI embedding search.

The 02.5 DEV catalog is small and PostgreSQL/Prisma is sufficient for this foundation.

Future scale may justify another decision later.

---

# 74. Database Migration Expectation

**No Prisma schema migration is expected for TASK 02.6.**

Search should first use the existing TASK 02.5 schema and indexes.

Do NOT create:

```text
Search
SearchHistory
SearchEvent
SearchIndex
PopularSearch
```

tables.

Do NOT enable PostgreSQL extensions merely for speculative optimization.

If implementation evidence demonstrates a genuinely necessary search index/schema change:

1. document the query/performance evidence;
2. stop and request architectural approval before introducing a new migration unless the task has already explicitly approved it;
3. any approved migration must remain additive and follow normal DEV/PROD migration gates.

---

# 75. Search Query Plan Review

For the current small development dataset, no strict performance SLA is required.

However, if raw SQL or complex relation filters are introduced:

- inspect query shape;
- avoid accidental Cartesian joins;
- avoid unbounded scans caused by client-controlled pagination;
- document obvious performance tradeoffs.

Do not prematurely optimize based only on theoretical scale.

---

# 76. Frontend Structure

Adapt to the real repository.

Conceptual structure:

```text
apps/frontend/src/
├── pages/
│   └── SearchPage/
│       ├── SearchPage.tsx
│       └── SearchPage.module.scss
│
├── features/
│   └── search/
│       ├── components/
│       │   ├── TextSearch.tsx
│       │   ├── SearchSuggestions.tsx
│       │   ├── SearchFilters.tsx
│       │   ├── SearchResults.tsx
│       │   └── ImageSearchPlaceholder.tsx
│       ├── api/
│       ├── types.ts
│       └── utils.ts
```

Do not create this structure blindly if the repository uses another organization.

Reuse existing components and feature conventions.

---

# 77. Reusable Primitive Placement

Before creating:

```text
SearchField
FilterChipGroup
FilterSelect
SortSelect
Pagination
ResetFiltersButton
```

search for existing shared implementations.

If a component already exists:

- reuse it;
- extend it minimally only when required;
- do not create duplicate search-specific copies.

If a new primitive is justified and broadly reusable, place it according to existing shared-component architecture.

---

# 78. Customer Products Screenshot Boundary

`products-page.png` is used to inform:

- category chip design;
- search/filter toolbar density;
- reset control;
- sort control;
- no-results presentation.

TASK 02.6 implements the approved customer `/products` browsing experience by reusing SearchService and shared controls.

---

# 79. Admin Products Screenshot Boundary

`products page.png` is used only to confirm that the future Admin experience can reuse:

```text
SearchField
ResetFiltersButton
```

or related primitives.

Do not modify Admin Products screens/routes for 02.6.

Do not wire the new SearchService into Admin Product Management now.

---

# 80. Responsive — Mobile

At mobile widths:

- Search page header/breadcrumb fits naturally;
- tabs remain fully usable;
- Live Search input spans the available width;
- input uses available width;
- Filter, Sort, and clear controls have adequate touch targets;
- suggestion dropdown remains within viewport;
- category chips may horizontally scroll or use a compact control according to design-system patterns;
- filter controls should not create horizontal overflow;
- a Filters button may open an existing approved Dialog/Sheet/Drawer if such a primitive exists;
- if no approved sheet exists, a collapsible inline filter panel is acceptable;
- sort remains reachable;
- results are one column unless ProductCard architecture safely supports another layout;
- Pagination is touch-friendly;
- Image Search dropzone remains usable.

Do not invent a new mobile component library.

---

# 81. Responsive — Tablet

At tablet widths:

- page uses available horizontal space rather than narrow mobile-width controls centered in a large blank area;
- Search input/button may remain side-by-side when comfortable;
- filters wrap intentionally;
- category controls remain usable without clipping;
- result grid may use two columns based on ProductCard minimum width;
- suggestion dropdown matches input width;
- no horizontal overflow;
- Image Search dropzone scales proportionally.

Avoid breakpoint behavior that produces large unused gaps.

---

# 82. Responsive — Desktop

At desktop widths:

- layout should closely follow approved screenshots;
- Search input and button are side by side;
- content aligns to shared customer container;
- filters/sort use available horizontal width without becoming oversized;
- result grid uses balanced multi-column layout;
- result count and Browse-all-products action align cleanly;
- footer remains consistent.

Do not stretch Search input across the entire viewport when the design uses a bounded content region.

---

# 83. Responsive — Large Desktop

At large desktop widths:

- preserve a readable max-width;
- avoid giant whitespace between controls caused by unconstrained flex-grow;
- do not increase ProductCard width beyond approved design behavior;
- keep consistent page gutters;
- suggestion dropdown remains anchored to Search input rather than viewport edges.

---

# 84. Mobile Filter Interaction

A polished mobile interaction may use:

```text
[ Filters (2) ] [ Sort ]
```

where `(2)` is active filter count.

Use an existing approved Sheet/Dialog/Drawer if available.

Requirements:

- current filter values visible;
- Apply/Clear behavior clear;
- closing without applying follows chosen UX consistently;
- keyboard/focus management correct;
- body scrolling managed by existing primitive;
- no duplicated desktop/mobile filter state.

If the existing design system favors inline collapsible controls instead, use that pattern.

---

# 85. Accessibility — Search Field / Suggestions

Required:

- real label or accessible name;
- search landmark/form semantics where appropriate;
- combobox semantics for suggestions;
- listbox/options properly connected;
- active option announced;
- visible focus;
- keyboard navigation;
- Escape closes suggestions;
- loading/status not conveyed by color only.

---

# 86. Accessibility — Results

Required:

- results heading/count meaningful;
- result cards remain keyboard accessible according to ProductCard pattern;
- loading changes announced where appropriate;
- zero-results state is understandable;
- pagination labels clear;
- page change does not strand focus;
- errors announced appropriately.

---

# 87. Accessibility — Tabs / Filters / Image Dropzone

Tabs:

- correct tab semantics;
- keyboard navigation.

Filters:

- labels;
- selected states;
- clear buttons have names.

Image dropzone:

- clickable area keyboard reachable;
- Browse files is real button/control;
- hidden file input associated correctly;
- drag/drop is not the only way to select a file;
- invalid-file message announced;
- selected file remove/replace controls accessible.

---

# 88. Reduced Motion

Follow existing motion/reduced-motion standards.

Do not add mandatory animations to Search.

Any dropdown/filter transitions should respect reduced-motion preferences where existing components support it.

---

# 89. Search Frontend Types

Define/reuse typed contracts for:

```text
SearchQuery
SearchFilters
SearchSort
SearchResultProduct
SearchResponseMeta
SearchSuggestion
SearchSuggestionType
```

Do not duplicate TASK 02.5 Product types unnecessarily.

Search-specific types should reference shared Product summary types when safe.

---

# 90. Swagger / OpenAPI

Document:

```text
GET /api/search/products
GET /api/search/suggestions
```

Swagger must describe:

- all query parameters;
- enums;
- pagination bounds;
- price filter format;
- response schema;
- nullable Brand;
- Product summary;
- suggestion types;
- validation errors;
- internal errors;
- public/no-auth nature where applicable.

Do not document Image Search backend endpoints because they do not exist in 02.6.

---

# 91. Backend Unit / Service Tests

Required focused coverage:

- query normalization;
- empty/optional query behavior;
- name match;
- SKU match;
- modelNumber match;
- Brand match;
- Category match;
- description match;
- case-insensitive behavior;
- multiple-word deterministic behavior;
- category filter;
- Brand filter;
- availability filter;
- min price;
- max price;
- min/max combined;
- invalid min/max range;
- each sort mode;
- default sort with query;
- default sort without query;
- deterministic tie-breakers;
- bounded pagination;
- tightened max page;
- nullable Brand;
- unavailable product result behavior;
- inactive Product exclusion;
- inactive Category exclusion;
- Decimal serialization;
- primary image summary;
- no heavy detail payload in list.

Do not write trivial tests solely for coverage count.

---

# 92. Suggestion Tests

Required:

- query below minimum length;
- exact Product suggestion;
- prefix Product suggestion;
- Brand suggestion;
- Category suggestion;
- bounded limit;
- maximum limit validation;
- deterministic ordering;
- no hidden Product suggestion;
- no sensitive/internal fields;
- empty suggestions;
- malformed input.

---

# 93. API Integration Tests

Required:

```text
GET /api/search/products?q=macbook
GET /api/search/products?q=sony
GET /api/search/products?category=laptops
GET /api/search/products?brand=apple
GET /api/search/products?availability=available
GET /api/search/products?minPrice=...
GET /api/search/products?maxPrice=...
GET /api/search/products?sort=price-asc
GET /api/search/suggestions?q=mac
```

Verify:

- 200 success;
- stable response envelope;
- correct filters;
- correct sort;
- correct pagination;
- correct price strings;
- correct availability;
- strict validation;
- sanitized errors.

Use the migrated/seeded DEV/test Product Foundation according to repository testing standards.

---

# 94. Seeded Dataset Search Scenarios

TASK 02.5 provides a realistic curated dataset.

Use representative scenarios such as:

```text
macbook
sony
apple
laptops
headphones
iphone
```

Do not assume exact counts without verifying the current TASK 02.5 dataset.

Tests should prove expected representative matches rather than brittle unrelated catalog totals where possible.

---

# 95. Frontend Component Tests

Required where supported:

- Search icon navigates to `/search`;
- old header expansion no longer occurs;
- Search page renders initial state;
- tab switch;
- Search submit;
- query retained;
- suggestions render after debounce;
- keyboard suggestion navigation;
- suggestion selection;
- stale suggestion response suppression;
- filter application;
- sort change;
- clear filters;
- URL state updates;
- URL direct load restores controls;
- back/forward behavior where test infrastructure supports it;
- loading state;
- no-results state;
- error state;
- Image Search dropzone keyboard activation;
- selected local file state;
- invalid local file feedback;
- no network image-search processing request.

---

# 96. Browser / E2E Search Flow

Use DEV/test environment.

Required customer flows:

## Flow A — Navbar to Search

```text
Open customer page
→ activate Search icon
→ /search
→ standard header preserved
```

## Flow B — Text Search

```text
/search
→ type query
→ suggestions appear
→ live debounce or Enter
→ URL contains q
→ result count
→ results render
```

## Flow C — Suggestions

```text
type enough characters
→ ArrowDown/ArrowUp
→ Enter selection
→ resulting Search/filter state correct
```

## Flow D — Filters

```text
submit Search
→ category filter
→ Brand filter
→ availability filter
→ price filter
→ result set reflects AND semantics
```

## Flow E — Sorting

```text
change sort
→ URL updates
→ deterministic order changes
```

## Flow F — Reset Filters

```text
active filters
→ Clear filters
→ query preserved
→ filters cleared
→ page reset
```

## Flow G — Browser navigation

```text
Search A
→ Search/filter B
→ browser Back
→ A state restored
→ Forward
→ B state restored
```

## Flow H — No Results

```text
query with no results
→ Search-specific no-results state
→ recovery action works
```

## Flow I — Image Search Shell

```text
Image Search tab
→ keyboard/click Browse files
→ local selection
→ preview/state
→ Remove/Replace
→ no backend AI/upload request
```

---

# 97. Responsive QA

Verify at minimum:

```text
~390px mobile
~768px tablet
~1440px desktop
large desktop according to repository standards
```

For each viewport verify:

- header stable;
- Search icon route;
- breadcrumb/title;
- tabs;
- Search input/button;
- suggestions;
- filters;
- sort;
- reset;
- results;
- ProductCards;
- pagination;
- image dropzone;
- footer;
- no horizontal overflow.

---

# 98. Design / Screenshot Visual QA

After implementation, compare directly against the provided screenshots.

Report separately:

```text
Search page.png
search_page.png
Searchpage.png
products-page.png
products page.png
```

For each, document:

- what was matched directly;
- what was intentionally not implemented because it belongs to a later phase;
- what responsive/state refinements were added because the screenshot did not specify them.

Do not claim that the full Products/Admin screens were implemented.

---

# 99. Visual QA Checklist

Check:

- page gutters;
- breadcrumb alignment;
- heading size/hierarchy;
- supporting text;
- tab underline/active state;
- input height;
- icon alignment;
- live SearchField width/alignment;
- suggestion dropdown width;
- toolbar density;
- category active state;
- selects;
- Reset/Clear style;
- ProductCard grid gaps;
- results count;
- Browse-all-products placement;
- no-results hierarchy;
- image dropzone dimensions;
- footer transition;
- focus states;
- mobile/tablet wrapping.

Use approved design tokens rather than screenshot pixel guessing.

---

# 100. Compatibility

Verify TASK 02.6 does not break:

- TASK 02.5 Product APIs;
- Product/Category/Brand DTO contracts;
- authentication;
- admin authentication;
- Cart/Wishlist relationships;
- Orders;
- Inventory;
- customer header/navigation;
- footer;
- existing Products route;
- existing ProductCard;
- existing API error contract;
- logger;
- rate limiting;
- health checks.

Removing expandable-header Search must not remove unrelated header features.

---

# 101. Documentation Requirements

Update/create applicable docs for:

- Search architecture;
- Search page behavior;
- Navbar Search behavior;
- Search API;
- Search suggestions;
- search matching fields;
- relevance foundation;
- filtering;
- sorting;
- pagination;
- URL state;
- reusable controls;
- Image Search shell boundary;
- responsive behavior;
- accessibility;
- testing;
- known limitations;
- future 04.2 image-search integration boundary.

Do not document planned AI image search as currently functional.

---

# 102. Recommended Documentation Files

Reuse existing repository structure first.

Possible files:

```text
docs/05_Features/SEARCH.md
docs/05_Features/PRODUCTS.md
docs/04_Engineering Standards/API_GUIDELINES.md   ← only if contract standard actually changes
docs/08_Quality/E2E.md                            ← only if task-specific conventions require update
```

Add a task-specific Search API document only if equivalent documentation does not already exist.

Do not create duplicate documentation.

---

# 103. Known Limitations After 02.6

Legitimate boundaries include:

- Image Search is UI shell only.
- No FastAPI image matching.
- No Cloudinary upload.
- Customer `/products` catalog discovery reuses this Search foundation.
- No full Admin Products integration.
- No React Query/cache architecture.
- No specification-driven dynamic filters.
- No search history/analytics.
- No fuzzy typo correction.
- No external search engine.
- Relevance is deterministic foundation logic, not ML ranking.

These are planned boundaries, not defects.

---

# 104. Repository Hygiene

Before completion:

- remove old header Search expansion code proven obsolete;
- remove expansion-only styles/tests;
- remove scratch Search scripts;
- remove temporary debug logs;
- remove local QA screenshots unless intentionally stored as approved references;
- do not add Figma prototype overlay controls;
- do not add generated build output;
- verify `.gitignore`;
- verify no secrets.

Run:

```text
git status
git diff --stat
git diff --check
```

---

# 105. Security / Privacy Checklist

```text
[ ] Search input validated
[ ] Suggestion input validated
[ ] Query length bounded
[ ] page bounded
[ ] pageSize bounded
[ ] suggestion limit bounded
[ ] sort enum bounded
[ ] price inputs validated
[ ] raw SQL parameterized if used
[ ] public result fields minimized
[ ] inactive Products excluded
[ ] inactive Categories excluded
[ ] no customer/admin data exposed
[ ] no DB internals in errors
[ ] no SearchHistory persistence
[ ] existing rate limiting preserved
[ ] no new secrets/dependencies without approval
```

---

# 106. Performance Checklist

```text
[ ] No obvious N+1
[ ] Search list uses Product summaries only
[ ] Only one primary image in list payload
[ ] Suggestions use minimal selects
[ ] Suggestions bounded
[ ] Search pagination bounded
[ ] max page tightened
[ ] deterministic sort/tie-breakers
[ ] stale requests cancelled/ignored
[ ] suggestion debounce implemented
[ ] no huge client-side candidate scoring
[ ] no external search service added
```

If application-level relevance scoring is used, candidate selection must remain bounded.

---

# 107. Definition of Done — Architecture

```text
[ ] Search consumes TASK 02.5 Product Foundation
[ ] Dedicated SearchService/domain boundary exists
[ ] No parallel Product domain
[ ] Product DTO mapping reused where practical
[ ] Existing Inventory availability remains authoritative
[ ] No external search infrastructure introduced
[ ] No React Query introduced
[ ] No Image Search AI introduced
[ ] No Admin Products integration introduced
[ ] Customer `/products` uses shared SearchService and discovery state
```

---

# 108. Definition of Done — Navbar / Routing

```text
[ ] Search icon navigates to /search
[ ] Search icon keyboard-accessible
[ ] Header no longer expands Search inline
[ ] Header elements are not replaced by Search state
[ ] obsolete expansion state removed
[ ] obsolete expansion styles/tests removed where safe
[ ] direct /search navigation works
```

---

# 109. Definition of Done — Backend Search

```text
[ ] GET /api/search/products
[ ] GET /api/search/suggestions
[ ] q supported
[ ] Category filter supported
[ ] Brand filter supported
[ ] Availability filter supported
[ ] minPrice/maxPrice supported
[ ] sorting supported
[ ] pagination bounded
[ ] relevance deterministic
[ ] nullable legacy Brand safe
[ ] Decimal serialization preserved
[ ] Product visibility rules preserved
[ ] errors sanitized
[ ] Swagger accurate
```

---

# 110. Definition of Done — Suggestions

```text
[ ] Product suggestions
[ ] Category suggestions
[ ] Brand suggestions
[ ] minimum input threshold
[ ] debounce
[ ] bounded limit
[ ] stale request cancellation
[ ] keyboard navigation
[ ] mouse/touch selection
[ ] accessible combobox/listbox
[ ] suggestion API failure does not break Search submit
```

---

# 111. Definition of Done — Filters / Sort

```text
[ ] real Category data
[ ] real Brand data
[ ] Availability filter
[ ] Min/max price
[ ] filters combine using AND
[ ] sort relevance
[ ] sort price asc
[ ] sort price desc
[ ] sort newest
[ ] sort name asc
[ ] deterministic tie-breakers
[ ] Clear filters
[ ] filter changes reset page
[ ] no speculative Featured schema
```

---

# 112. Definition of Done — Search UI

```text
[ ] Search page matches approved Figma Make direction
[ ] Breadcrumb
[ ] Heading/supporting text
[ ] Text Search tab
[ ] Image Search tab
[ ] Search input
[ ] Live/debounced Search; immediate Enter (approved refinement)
[ ] suggestions dropdown
[ ] filter/sort toolbar
[ ] results count
[ ] Search results
[ ] ProductCard reuse
[ ] loading state
[ ] no-results state
[ ] error state
[ ] pagination
[ ] footer
```

---

# 113. Definition of Done — Image Search Shell

```text
[ ] Image Search tab matches screenshot direction
[ ] drag/drop visual shell
[ ] Browse files works locally
[ ] keyboard accessible
[ ] drag-over state
[ ] selected-file state where approved
[ ] Remove/Replace where approved
[ ] invalid local image feedback
[ ] NO backend image upload
[ ] NO FastAPI
[ ] NO similarity matching
[ ] NO Cloudinary
```

---

# 114. Definition of Done — URL / Advanced UX

```text
[ ] submitted Search reflected in URL
[ ] filters reflected in URL
[ ] sort reflected in URL
[ ] pagination reflected in URL
[ ] direct URL load restores state
[ ] browser Back works
[ ] browser Forward works
[ ] typing suggestions does not spam history
[ ] stale responses cannot replace newer results
[ ] query/filter/sort changes reset page to 1
```

---

# 115. Definition of Done — Responsive

```text
[ ] Mobile verified
[ ] Tablet verified
[ ] Desktop verified
[ ] Large desktop verified where supported
[ ] no horizontal overflow
[ ] suggestions fit viewport
[ ] filter controls usable
[ ] Search input/button layout appropriate
[ ] ProductCard grid responsive
[ ] Image Search dropzone responsive
```

---

# 116. Definition of Done — Accessibility

```text
[ ] Search icon labeled
[ ] Search input labeled
[ ] Suggestions combobox/listbox semantics
[ ] suggestion keyboard navigation
[ ] Tabs accessible
[ ] filter controls labeled
[ ] Sort labeled
[ ] Reset/Clear buttons named
[ ] loading/status announced where appropriate
[ ] no-results/error meaningful
[ ] Pagination accessible
[ ] Image dropzone keyboard accessible
[ ] visible focus
[ ] touch targets adequate
```

---

# 117. Definition of Done — Testing

```text
[ ] backend unit/service tests PASS
[ ] suggestion tests PASS
[ ] API integration tests PASS
[ ] frontend tests PASS
[ ] Search browser/E2E PASS
[ ] URL/back-forward behavior verified
[ ] responsive QA PASS
[ ] accessibility checks PASS
[ ] lint PASS
[ ] typecheck PASS
[ ] build PASS
```

Do not defer all quality work to Phase 06.

---

# 118. Definition of Done — Design

```text
[ ] all five provided screenshots inspected
[ ] approved layout decisions preserved
[ ] Figma prototype overlay not implemented
[ ] Products screenshot used only for reusable customer primitives
[ ] Admin screenshot used only for reusable primitive direction
[ ] responsive refinements documented
[ ] added states remain consistent with design system
[ ] no unauthorized redesign
```

---

# 119. Required Evidence Before Approval

The implementation agent must provide evidence, not assertions.

Required:

1. Branch + HEAD SHA.
2. Changed-file list.
3. Screenshot/Figma Make inspection report.
4. Existing header Search behavior before/after summary.
5. Search route evidence.
6. Search API endpoint tests.
7. Suggestion API tests.
8. Query/filter/sort validation evidence.
9. Relevance behavior evidence.
10. Pagination bound evidence.
11. Real DEV/test Search against TASK 02.5 dataset.
12. Frontend unit/component test results.
13. Browser/E2E Search flow.
14. Mobile/tablet/desktop QA evidence.
15. Accessibility verification.
16. Swagger verification.
17. Lint/typecheck/build results.
18. `git diff --check`.
19. Documentation updates.
20. Explicit confirmation that Image Search backend was NOT implemented.
21. Explicit confirmation that no Search DB tables/migration were introduced without approval.
22. Explicit confirmation that Admin Products was not integrated.
23. Explicit confirmation that React Query was not introduced.

---

# 120. Principal Architect Review Gate

Before merge, independently review:

## Architecture

- Is Search a clean consumer of 02.5 Product Foundation?
- Any duplicate Product mapping/availability logic?
- Any unnecessary new infrastructure?
- Any premature 02.7/03.1/04.2/04.3/05.2 work?

## Search correctness

- Search fields correct?
- Query normalization safe?
- Filters AND correctly?
- Sort deterministic?
- Relevance explainable?
- Pagination bounded?

## UX

- Search icon routes instead of expanding header?
- Search page matches screenshots?
- Suggestions polished?
- URL state robust?
- Empty/error/loading states complete?
- Image Search clearly shell-only?

## Accessibility

- keyboard suggestions?
- ARIA semantics?
- tabs?
- filters?
- image dropzone?

## Performance

- any N+1?
- heavy payloads?
- unbounded suggestions?
- giant page offsets?
- stale requests?

## Security

- raw SQL safe?
- validation bounded?
- public fields minimal?
- internal errors sanitized?

## Scope

- customer `/products` uses SearchService for catalog discovery?
- no Admin Product integration?
- no React Query?
- no image AI/Cloudinary?

---

# 121. Approval Rule

TASK 02.6 is eligible for approval only if:

```text
Architecture PASS
AND
Search Backend PASS
AND
Suggestions PASS
AND
Filtering PASS
AND
Sorting PASS
AND
Search UI PASS
AND
URL State PASS
AND
Responsive PASS
AND
Accessibility PASS
AND
Testing PASS
AND
Documentation PASS
AND
Scope Boundary PASS
```

Any Critical/High security issue, duplicate Search/Product architecture, unsafe raw SQL, unbounded public query surface, broken Product visibility rules, stale-response bug, inaccessible suggestion UI, or unauthorized implementation of later phases blocks completion.

---

# 122. Final Scope Freeze

## 02.6 owns

```text
✅ Dedicated /search page
✅ Navbar Search icon → /search
✅ Remove header-expanding Search
✅ Text Search
✅ Search suggestions
✅ Product results
✅ Category filter
✅ Brand filter
✅ Availability filter
✅ Min/max price filter
✅ Sorting
✅ Pagination
✅ URL-backed Search state
✅ Search result states
✅ Reusable Search/filter/sort primitives
✅ ProductCard reuse
✅ Image Search UI shell
✅ Responsive Search behavior
✅ Accessibility
✅ Search APIs
✅ Swagger
✅ Tests
✅ Documentation
```

## 02.7 owns

```text
⏭ React Query
⏭ Query cache
⏭ Query invalidation
⏭ Global API-state architecture
```

## 03.1 owns

```text
⏭ Full Products Catalog
⏭ Category browsing page
⏭ Final Product Details page
⏭ Final catalog gallery/specification experience
```

## 03.4 owns

```text
⏭ Full inventory operations
⏭ Low-stock workflows
⏭ Stock movement/history
⏭ Purchase restrictions
```

## 04.2 owns

```text
⏭ Backend image upload/search flow
⏭ Camera capture
⏭ FastAPI image processing
⏭ Similar-product image matching
```

## 04.3 owns

```text
⏭ Cloudinary
⏭ Production image upload/storage
⏭ Transformations
```

## 05.2 owns

```text
⏭ Admin Products search integration
⏭ Admin filters/sorting
⏭ Admin product CRUD
```

---

# 123. Final Architecture Principle

ElectroHub Search should evolve as:

```text
02.5
PRODUCT FOUNDATION
        ↓
02.6
SEARCH FOUNDATION
        ↓
02.7
STATE/API FOUNDATION
        ↓
03.1
FULL CUSTOMER CATALOG
        ↓
04.2
IMAGE SEARCH
```

not:

```text
02.6
Search
+ full catalog
+ React Query
+ Admin Products
+ image AI
+ Cloudinary
+ analytics
+ recommendations
```

The goal is a **clean, reusable, polished search foundation** that later phases can consume without rewriting core behavior.

---

# 124. Recommended Execution Sequence

```text
1. Sync repository / verify feature/search-foundation
2. Read AGENTS.md
3. Read this complete TASK 02.6 file
4. Read applicable foundation/design/product/search/API/testing docs
5. Inspect all five provided Figma Make screenshots
6. Compare screenshot-approved behavior with task requirements
7. Identify approved vs refinable UI decisions
8. Inspect current header Search expansion implementation
9. Inspect 02.5 Product/Category/Brand APIs and DTO mapping
10. Inspect existing ProductCard/shared components
11. Inspect current frontend API-client pattern
12. Freeze Search API contract
13. Implement Search backend + validation + Swagger
14. Implement suggestions backend
15. Implement /search route/page
16. Replace navbar expansion with route navigation
17. Implement Text Search + suggestions
18. Implement URL state
19. Implement filters + sorting + pagination
20. Implement loading/empty/error states
21. Implement Image Search shell only
22. Implement responsive/mobile/tablet refinements
23. Implement accessibility/keyboard behavior
24. Add backend/API/frontend tests
25. Run browser/E2E flows
26. Compare final UI against screenshot references
27. Update docs
28. Repository hygiene
29. Self-review
30. Hand off to Principal Architect
```

---

# 125. Required Implementation Report

At completion, provide:

```text
# TASK 02.6 — IMPLEMENTATION REPORT

STATUS:
READY FOR ARCHITECTURAL REVIEW / REQUEST CHANGES / BLOCKED

BRANCH:
feature/search-foundation

HEAD SHA:
...

## Architecture
SEARCH CONSUMES 02.5 FOUNDATION: PASS/FAIL
DUPLICATE PRODUCT/SEARCH DOMAIN: NONE/<details>
EXTERNAL SEARCH SERVICE: NONE/<details>
DATABASE MIGRATION: NOT REQUIRED / <details>
SCOPE BOUNDARY: PASS/FAIL

## Design / Screenshot Review
Search page.png: INSPECTED / NOT INSPECTED
search_page.png: INSPECTED / NOT INSPECTED
Searchpage.png: INSPECTED / NOT INSPECTED
products-page.png: INSPECTED / NOT INSPECTED
products page.png: INSPECTED / NOT INSPECTED

APPROVED DECISIONS PRESERVED:
- ...

REFINEMENTS ADDED:
- ...

INTENTIONAL LATER-PHASE ITEMS NOT IMPLEMENTED:
- ...

## Navbar / Routing
SEARCH ICON → /search: PASS/FAIL
OLD HEADER EXPANSION REMOVED: PASS/FAIL
HEADER STABILITY: PASS/FAIL
KEYBOARD NAVIGATION: PASS/FAIL

## Backend APIs
GET /api/search/products: PASS/FAIL
GET /api/search/suggestions: PASS/FAIL
QUERY MATCHING: PASS/FAIL
CATEGORY FILTER: PASS/FAIL
BRAND FILTER: PASS/FAIL
AVAILABILITY FILTER: PASS/FAIL
PRICE FILTER: PASS/FAIL
SORTING: PASS/FAIL
PAGINATION: PASS/FAIL
MAX PAGE HARDENED: PASS/FAIL
RELEVANCE: PASS/FAIL
NULLABLE BRAND: PASS/FAIL
PRICE SERIALIZATION: PASS/FAIL
SWAGGER: PASS/FAIL

## Suggestions
MINIMUM QUERY LENGTH: PASS/FAIL
DEBOUNCE: PASS/FAIL
STALE REQUEST CANCELLATION: PASS/FAIL
PRODUCT SUGGESTIONS: PASS/FAIL
CATEGORY SUGGESTIONS: PASS/FAIL
BRAND SUGGESTIONS: PASS/FAIL
KEYBOARD UX: PASS/FAIL
ARIA COMBOBOX: PASS/FAIL

## Frontend Search
/search PAGE: PASS/FAIL
TEXT SEARCH TAB: PASS/FAIL
SEARCH INPUT: PASS/FAIL
SEARCH BUTTON: PASS/FAIL
RESULT COUNT: PASS/FAIL
PRODUCTCARD REUSE: PASS/FAIL
FILTER TOOLBAR: PASS/FAIL
SORT CONTROL: PASS/FAIL
CLEAR FILTERS: PASS/FAIL
PAGINATION UI: PASS/FAIL
LOADING STATE: PASS/FAIL
NO RESULTS STATE: PASS/FAIL
ERROR STATE: PASS/FAIL

## URL State
QUERY: PASS/FAIL
FILTERS: PASS/FAIL
SORT: PASS/FAIL
PAGE: PASS/FAIL
DIRECT LOAD: PASS/FAIL
BACK/FORWARD: PASS/FAIL
HISTORY SPAM AVOIDED: PASS/FAIL

## Image Search Shell
TAB: PASS/FAIL
DROPZONE: PASS/FAIL
BROWSE FILES: PASS/FAIL
DRAG OVER: PASS/FAIL
LOCAL SELECTED STATE: PASS/FAIL/NOT REQUIRED
REMOVE/REPLACE: PASS/FAIL/NOT REQUIRED
BACKEND UPLOAD: NOT IMPLEMENTED
FASTAPI: NOT IMPLEMENTED
CLOUDINARY: NOT IMPLEMENTED
SIMILARITY SEARCH: NOT IMPLEMENTED

## Responsive
MOBILE: PASS/FAIL
TABLET: PASS/FAIL
DESKTOP: PASS/FAIL
LARGE DESKTOP: PASS/FAIL/NOT REQUIRED
HORIZONTAL OVERFLOW: NONE/PRESENT

## Accessibility
SEARCH LABEL: PASS/FAIL
SUGGESTION KEYBOARD: PASS/FAIL
TABS: PASS/FAIL
FILTERS: PASS/FAIL
PAGINATION: PASS/FAIL
IMAGE DROPZONE: PASS/FAIL
FOCUS STATES: PASS/FAIL
STATUS/ERROR ANNOUNCEMENT: PASS/FAIL

## Tests
BACKEND UNIT/SERVICE: <result>
SUGGESTIONS: <result>
API INTEGRATION: <result>
FRONTEND: <result>
E2E: <result>
TYPECHECK: PASS/FAIL
LINT: PASS/FAIL
BUILD: PASS/FAIL

## Compatibility
PRODUCT FOUNDATION 02.5: PASS/FAIL
AUTH: PASS/FAIL
HEADER: PASS/FAIL
PRODUCTCARD: PASS/FAIL
INVENTORY AVAILABILITY: PASS/FAIL
ERROR CONTRACT: PASS/FAIL

## Security / Performance
RAW SQL: NONE / PARAMETERIZED / UNSAFE
QUERY LENGTH BOUNDED: PASS/FAIL
PAGE SIZE BOUNDED: PASS/FAIL
PAGE NUMBER BOUNDED: PASS/FAIL
SUGGESTIONS BOUNDED: PASS/FAIL
N+1 REVIEW: PASS/FAIL
HEAVY PAYLOAD REVIEW: PASS/FAIL
RATE LIMIT COMPATIBILITY: PASS/FAIL

## Documentation
UPDATED:
- ...

## Repository
FILES CHANGED:
- ...

git diff --check: PASS/FAIL
SECRETS CHECK: PASS/FAIL

## Observed Outside Scope
- None
OR
- ...

## Known Limitations
- ...

## Remaining Risks
- None
OR
- ...

## Final Implementer Decision
READY FOR INDEPENDENT ARCHITECTURAL REVIEW
/
REQUEST CHANGES
/
BLOCKED
```

Do not self-approve.

The Principal Software Architect must independently review TASK 02.6 before merge.
