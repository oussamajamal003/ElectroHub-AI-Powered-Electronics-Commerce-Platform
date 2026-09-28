# Customer Product Catalog

The customer `/products` page is the catalog discovery surface. It renders the shared compact SearchField, product grid, category/brand/availability/price filters, sort, active-filter removal, reset, and pagination.

Catalog search and the dedicated `/search` page share `GET /api/search/products`, `GET /api/search/suggestions`, SearchService, canonical Product Foundation summaries, and URL-backed query/filter state. An initial `/products` visit loads a bounded newest-first page through the empty-query API contract; plain `/search` intentionally remains empty until a query or filter is active. Query input updates after a 275 ms debounce; query edits replace the URL entry, while deliberate filter/sort/page actions remain navigable.

Filter controls use live Category and Brand API data. The price range is applied as one filter. An empty query requests only a bounded, newest-first page and its total count; it never materializes the entire catalog. Product prices are display-only adapters of the API's decimal strings; the client does no commerce arithmetic.

The global customer Footer is rendered once by CustomerLayout, not per page. Its approved content and responsive layout follow `docs/assets/figma/exports/customer/screenshots/Footer.png`; Admin and standalone authentication layouts do not receive it.
