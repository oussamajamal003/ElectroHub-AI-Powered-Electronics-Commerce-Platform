# Search

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
React Query
 ↓
Search Results
```

The backend is responsible for authoritative search behavior.

---

## 3. Search Input

The search interface should provide:

- Clear input.
- Search action.
- Loading feedback.
- Empty-state feedback.
- Error handling.
- Accessible labeling.

Where appropriate, search input may be debounced to avoid excessive requests.

---

## 4. Search API

A typical endpoint may be:

```text
GET /api/search?q=laptop&page=1&pageSize=20
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
