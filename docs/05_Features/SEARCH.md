# Search

## Task 02.6 — implemented foundation

The dedicated public Search route is `/search`. Header Search buttons navigate there. Text Search has no adjacent submit button and no Product-catalog filter panel. Typing/deleting commits a normalized query after 275 ms, resets page to 1 and replaces the current URL entry; Enter commits immediately without a duplicate request. Suggestions debounce 175 ms and remain independently race-safe. Sort is aligned to the right of Search on tablet/desktop and stacks naturally on mobile. Direct `/search` with no query shows no product dump. `/products` shares the API and loads a bounded newest-first page with an empty query. Tabs are local. Search and PRODUCT suggestions now use the same canonical matching predicate across product name, SKU, model number, description, brand/category names, and specification group/name/value. Specification matching uses correlated parameterized `EXISTS`, not specification hydration or a row-multiplying join. Short alphabetic terms use alphabetic boundaries (so `mm` matches `40mm` while `tt` does not accidentally match inside `battery`).

**Approved UX / scope refinement:** supporting screenshots guide the layout; the Search-button screenshot interaction and the old expanded Search filter toolbar are superseded. Full catalog filtering now belongs to `/products`; both pages call the same `/api/search/products` API/SearchService. The Products page owns compact SearchField, dynamic Category/Brand controls, Availability, Min/Max price, immediate Sort, removable active filters, Reset and pagination. Search suggestions are independently debounced and race-safe. Customer Footer is rendered once by CustomerLayout, not pasted into individual pages.

### Public API contract

- `GET /api/search/products`: `q`, `category`, `brand`, `availability`, `minPrice`, `maxPrice`, `sort`, `page`, `pageSize`.
- `GET /api/search/suggestions`: `q` and `limit` only. Normalized query length 2–120; default limit 8, maximum 10. Response `{ data: [{ id, type, label, slug }] }`, with PRODUCT/BRAND/CATEGORY types.
- Product query length maximum 120. Trim/collapse whitespace without stripping punctuation. Every token must match an approved name, SKU, model, description, brand or category field; filters combine with AND. One- and two-character tokens match complete alphanumeric terms to avoid incidental substring hits (for example, `tt` no longer matches the middle of “battery”); longer tokens retain literal substring matching. The shared API returns a bounded newest-first page for an empty query (for `/products`); the `/search` UI intentionally makes no empty-query request.
- Category/brand are single lowercase slugs. Availability is `available`/`unavailable`. Prices are nonnegative decimal strings with at most two fractional digits; reversed ranges are rejected.
- Page defaults to 1, maximum 1,000; pageSize defaults to 20, maximum 100. Search returns `{ data, meta: { page, pageSize, total, totalPages } }`. Product Foundation retains its existing envelope and now shares the 1,000-page ceiling.
- Sort: `relevance`, `price-asc`, `price-desc`, `newest`, `name-asc`. Default relevance with a query, newest for filter-only discovery. Relevance ranks whole-query exact name/SKU/model, name prefix, name contains, SKU/model contains, brand/category, description, then cross-field token matches. Relevance/newest/price ties use creation time descending then ID ascending; name uses name ascending then ID ascending.
- Unknown/repeated API parameters, invalid enums/pagination/prices return structured `400 VALIDATION_ERROR`. Search is limited to 120 requests/minute/IP and suggestions to 240, with structured `429 RATE_LIMITED`. Existing auth limits remain unchanged. Unexpected failures use the existing sanitized error middleware.

### Data and implementation boundaries

Only ACTIVE products in active categories are public. Canonical Product Foundation summary mapping preserves exact two-decimal price strings, nullable legacy brands, one ordered primary image and inventory-derived availability. Parameterized, isolated SQL counts/ranks in PostgreSQL and hydrates only the requested page; literal LIKE wildcards are escaped. A repeatable-read transaction keeps count/page hydration consistent, with `maxWait: 10000` and `timeout: 30000`. No schema, extensions, seeds or migrations are required.

### Scoped DEV query-plan review (2026-09-28)

Read-only DEV `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS)` for `macbook`, `sony` + brand, `apple` + laptops + available, and `sony` + $50–$1,000 + price ascending was repeated 2026-09-28. Latest SQL execution was 0.33, 0.13, 0.17 and 0.24 ms (planning 0.69, 0.67, 0.90 and 0.61 ms); plans used bounded Limit/Sort with hash or nested-loop joins. No Cartesian join or unbounded application candidate materialization was observed. One physical `LEFT JOIN inventory` supports availability and does not multiply rows because inventory is one-to-one. Small-table sequential scans are not, by themselves, a defect. Hydration is one page-scoped Prisma `findMany` followed by batched relation queries rather than per-product N+1 queries. Latest observed DEV cold connection was 8 ms; ID-query round trips 307–351 ms; page hydration 1,520–1,729 ms. SQL is not the bottleneck in this sample; remote round-trip/hydration time dominates. A complete transaction-duration trace was not separately instrumented, so the 30-second timeout is retained without claiming these isolated calls prove it necessary. `maxWait: 10s` remains connection-acquisition headroom; cold startup was not material here. Repeatable Read is appropriate for consistent count, ranked page and hydration during concurrent catalog changes. These tiny DEV measurements do not predict production load.

The frontend reuses the existing API client, independent AbortControllers and latest-response guards. Suggestions debounce 175 ms and implement combobox/listbox keyboard navigation; failure does not block live Search. Category/brand options come from their read APIs. ProductCard uses a display-only numeric price adapter and hides unimplemented cart/wishlist actions on Search only. No fake ratings, product descriptions or hardcoded screenshot products are introduced.

Image Search is a **local file-selection shell only**: Browse/drop, replace/remove, filename, image MIME validation, JPEG/PNG/WebP preview, revoked object URLs and filename fallback. It never uploads or calls an image-search API and defines no permanent server file-size contract. `/products`, product detail navigation, image matching, AI/vector search, admin search, localization and recommendations are outside 02.6; later sections describing those are future guidance, not completion claims.

### Focused verification

Backend: `npx vitest run tests/search.test.ts src/services/__tests__/product.service.test.ts tests/product.api.test.ts`, plus typecheck/lint/build. Frontend: targeted Search, CustomerHeader and ProductCard tests, typecheck/lint/build. Browser: `npx playwright test --config playwright.search.config.ts` against existing local servers and DEV read APIs, with controlled failure/race mocks. Captures cover 390, 768, 1440 and 1920 pixels. Generated screenshots/traces stay ignored under frontend test-results; no DB writes or external email/OAuth tests are involved.

Visual references: the supplied customer `Search page.png`, `search_page.png`, `Searchpage.png`, `products-page.png`, `Footer.png` and admin `products page.png`. Preserve source filenames; exclude the floating prototype switcher. The approved Footer content/layout follows `Footer.png`; screenshots are supporting Figma Make references, not proof of inspection of live Figma Design.

## 1. Purpose

This document defines the product-search functionality for ElectroHub.

Search allows customers to discover technology and electronics products quickly through text-based queries and supports integration with:

- Categories.
- Filters.
- Sorting.
- Pagination.
- Product details.
- Recommendations.
- Image search.

---

## 2. Search Architecture

Text search follows:

```text
Search Input
 ↓
React Search UI
 ↓
Search State / URL
 ↓
Backend Search API
 ↓
Validation
 ↓
Prisma / Database Query
 ↓
Paginated Results
 ↓
Existing API client / cancellation guards
 ↓
Search Results
```

The backend is responsible for authoritative search behavior.

---

## 3. Search Input

The search interface should provide:

- Clear input.
- Live Search after a 275 ms debounce; Enter commits immediately.
- Loading feedback.
- Empty-state feedback.
- Error handling.
- Accessible labeling.

Typing, replacing and deleting debounce URL replacement to avoid history spam. The SearchField remains accessible as one labeled combobox; an active suggestion retains Enter-selection priority.

---

## 4. Search API

A typical endpoint may be:

```text
GET /api/search/products?q=laptop&page=1&pageSize=20
```

Search parameters must be validated server-side.

Supported parameters may include:

```text
q
category
sort
page
pageSize
```

Only supported parameters should be accepted.

---

## 5. Search Query

Search should handle:

```text
Normal Query
Empty Query
Whitespace
No Results
Large Result Set
Invalid Parameters
Special Characters
```

The backend must safely construct database queries.

Untrusted search input must never be directly interpolated into unsafe SQL.

---

## 6. Search Results

Search results should provide the information required for catalog browsing.

Typical result data includes:

```text
Product ID
Name
Price
Primary Image
Category
Availability
Relevant Metadata
```

Avoid returning large unnecessary product objects for every search result.

---

## 7. Pagination

Search results must support pagination.

Example:

```text
Page 1
 ↓
20 Results
 ↓
Page 2
 ↓
Next 20 Results
```

Pagination protects database, network, and frontend performance.

---

## 8. Filtering

Search can be combined with product filters.

Possible filters include:

```text
Category
Price Range
Brand
Availability
```

Example:

```text
/search?q=laptop&category=gaming&availability=in-stock
```

The final supported filters depend on the product schema and roadmap requirements.

---

## 9. Sorting

Search results may support controlled sorting.

Examples:

```text
Relevance
Price: Low to High
Price: High to Low
Newest
```

The backend must whitelist supported sort fields and directions.

Clients must not be allowed to inject arbitrary database ordering expressions.

---

## 10. Category Search

Search and category filtering should work together.

Example:

```text
Query:
phone

Category:
Smartphones
```

The result should contain products matching the query within the selected category.

---

## 11. Search State

Search state may be represented in the URL when it should be:

- Shareable.
- Bookmarkable.
- Restorable after navigation.

Example:

```text
/products/search?q=iphone&category=smartphones&page=2
```

URL parameters are untrusted input and must still be validated.

---

## 12. React Query

Search results are server state and should use React Query.

Conceptually:

```text
Search Parameters
 ↓
Query Key
 ↓
React Query
 ↓
Search API
```

The query key must include parameters that affect the result.

Example:

```ts
["search", { q, category, sort, page }]
```

---

## 13. Search Loading State

During search requests, the UI should provide appropriate feedback.

Possible patterns:

```text
Skeleton Results
Loading Indicator
Pending Search State
```

The previous result may remain visible while a new request is pending when this improves UX.

---

## 14. Empty State

When no products match:

```text
No products found.
```

The UI should provide useful next actions where appropriate, such as:

```text
Clear Filters
Try Another Search
Browse Categories
```

An empty result is not the same as a failed request.

---

## 15. Error State

If search fails because of a network or server error, the UI should distinguish it from an empty result.

Example:

```text
Search unavailable.
Please try again.
```

A retry action should be provided where appropriate.

---

## 16. Search Performance

Search should be optimized through:

- Appropriate database indexes.
- Pagination.
- Query limits.
- Debounced input where appropriate.
- React Query caching.
- Minimal response payloads.

Avoid loading the complete catalog into the browser and filtering it client-side for normal search.

---

## 17. Search Security

Search input is untrusted.

The backend must protect against:

```text
SQL Injection
Abusive Query Size
Excessive Request Rates
Invalid Parameters
```

Rate limiting may be applied according to operational requirements.

---

## 18. Search by Image

Image search is a separate discovery capability but integrates with the normal product catalog.

Flow:

```text
User Uploads / Captures Image
 ↓
Backend
 ↓
FastAPI AI Service
 ↓
Matching Product References
 ↓
Product Catalog
 ↓
Search Results
```

Image-search behavior is documented in `IMAGE_SEARCH.md`.

---

## 19. Search and Recommendations

Search behavior may contribute to recommendation signals such as:

```text
Searches
Product Clicks
Product Views
Purchases
```

The exact tracking behavior must follow the approved analytics and recommendation architecture.

---

## 20. Search and Product Availability

Search results should expose current availability where appropriate:

```text
In Stock
Low Stock
Out of Stock
```

Availability must be derived from authoritative backend/inventory data.

Search results should not guarantee purchasability without checkout-time validation.

---

## 21. Search and Admin

Administrators may use search/filtering for product and order management.

Admin search may require additional filters and pagination.

Administrative endpoints must remain protected by authorization.

---

## 22. Accessibility

Search must support:

- Keyboard navigation.
- Accessible labels.
- Screen readers.
- Visible focus states.
- Appropriate status announcements where necessary.

Search suggestions, if implemented, must have appropriate keyboard and accessibility behavior.

---

## 23. Localization and RTL

Search UI must support localization.

Arabic RTL layouts must be supported.

Search components should avoid hard-coded left/right assumptions and use logical layout properties where appropriate.

---

## 24. Testing

Search testing should include:

```text
Valid Query
Empty Query
Whitespace
No Results
Multiple Results
Pagination
Filtering
Sorting
Category Combination
Special Characters
Invalid Parameters
Network Failure
Authorization for Admin Search
Mobile Search
RTL Search
```

Critical search flows should also be covered by E2E testing.

---

## 25. Definition of Done

Search is complete when:

- Text search works.
- Search results are paginated.
- Category filtering works.
- Supported filters work.
- Sorting works where required.
- Search state is handled correctly.
- Loading state exists.
- Empty state exists.
- Error state exists.
- Results are accessible.
- RTL/localization behavior is verified.
- Search is performant.
- Backend validation and security controls are implemented.
- Tests pass.
- Documentation matches the implementation.

---

## 26. Search Principle

> **Search should provide fast, predictable product discovery while keeping query validation, filtering, authorization, and data retrieval authoritative on the backend.**
