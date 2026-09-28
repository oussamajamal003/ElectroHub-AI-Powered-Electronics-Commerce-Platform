# ELECTROHUB — TASK 02.7
# STATE AND API FOUNDATION

**Branch:** `feature/State-API-Foundation`  
**Target:** `develop`  
**Status:** Authoritative implementation task  
**Phase:** 02 — Core Platform  
**Scope:** Frontend server-state foundation + centralized API client + React Query configuration + cache strategy + standardized loading/error handling + branded ElectroHub page loader + migration of approved existing public reads to the new foundation

**Repository implementation note:** React Query was already installed and the
application already had one provider; 02.7 configures that instance rather than
installing a second copy. Search and Products retain URL-authoritative state and
the approved 275 ms live-search / 175 ms suggestion debounces. Public query
policies are recorded in `docs/04_Engineering Standards/STATE_MANAGEMENT.md`.

---

# 1. TASK OBJECTIVE

Establish the canonical ElectroHub frontend server-state and API-access architecture.

TASK 02.7 must move the frontend toward this architecture:

```text
UI Components
   ↓
React Query hooks
   ↓
Central API Client
   ↓
Backend APIs
```

After this task:

- React Query is installed and configured once at application scope.
- The frontend has one canonical API client.
- Query keys follow a documented, reusable convention.
- Default query behavior is standardized.
- Cache/stale-time rules are deliberate and documented.
- Server-state reads are no longer duplicated ad hoc inside components.
- Query cancellation is supported.
- Pagination/query-state integration is defined.
- Mutation invalidation conventions are established.
- Loading states are consistent.
- Error handling is consistent.
- Route/page-level loading uses a branded `ElectroHubLoader`.
- Card/list loading continues to use skeletons.
- Button/action loading uses compact inline indicators.
- Existing Product/Search public reads that are in scope are migrated to the new foundation without changing their backend API contracts.
- Future tasks can build on a stable state/API layer instead of creating per-feature fetching patterns.

This is a FOUNDATION task, not a feature-redesign task.

---

# 2. ROADMAP POSITION

TASK 02.7 follows:

```text
02.5 Product Foundation
        ↓
02.6 Search Foundation
        ↓
02.7 State and API Foundation
        ↓
03.x Customer Catalog / Product Experience
```

TASK 02.7 owns the shared frontend data-access architecture that later customer/admin features must reuse.

It must NOT reimplement Product Foundation, Search Foundation, or later feature UI.

---

# 3. REQUIRED ARCHITECTURE

The canonical frontend architecture becomes:

```text
React Component / Page
        ↓
Feature Query Hook
        ↓
Query Key Factory
        ↓
Central API Client
        ↓
Backend REST API
```

For mutations:

```text
Component
   ↓
Feature Mutation Hook
   ↓
Central API Client
   ↓
Backend API
   ↓
Mutation succeeds
   ↓
Targeted query invalidation / cache update
```

Do not let components become HTTP clients.

---

# 4. PRIMARY DELIVERABLES

Implement:

1. React Query dependency and provider.
2. QueryClient configuration.
3. Query-key conventions/factories.
4. Centralized API client.
5. Shared API error normalization.
6. Retry policy.
7. Stale-time/cache strategy.
8. Request cancellation.
9. Pagination/query parameter support.
10. Mutation invalidation strategy.
11. Reusable query hooks for approved existing public reads.
12. Consistent loading-state architecture.
13. Consistent error-state architecture.
14. `ElectroHubLoader` branded route/page loader.
15. Skeleton guidance for content-level loading.
16. Inline loading indicator guidance for buttons/actions.
17. Tests.
18. Documentation.
19. Migration guidance for future features.

---

# 5. EXPLICIT OUT OF SCOPE

TASK 02.7 must NOT implement:

- new Product business features;
- new Search ranking behavior;
- new Search filters;
- Product Details page if not already owned elsewhere;
- full Admin API migration unrelated to current foundation proof;
- cart business logic changes;
- wishlist behavior changes;
- checkout;
- payment architecture;
- inventory concurrency;
- AI image search;
- recommendations;
- Cloudinary;
- WebSockets;
- offline-first synchronization;
- service worker caching;
- GraphQL;
- Redux replacement project;
- Zustand migration project;
- global app rewrite;
- backend API redesign;
- database migration;
- Prisma schema change;
- new Supabase tables;
- production deployment changes.

---

# 6. FIRST PRINCIPLE — SERVER STATE VS CLIENT STATE

React Query owns SERVER STATE.

Examples:

- Products from backend.
- Product detail from backend.
- Categories.
- Brands.
- Search results.
- Search suggestions.
- Account/profile reads where approved.
- Orders where later migrated.

React Query does NOT automatically own CLIENT-ONLY UI STATE.

Examples:

- Modal open/closed.
- Active local tab.
- Temporary input draft before URL commit.
- Drawer state.
- Selected local image preview before upload.
- Animation state.

Do not move every local state value into React Query.

---

# 7. REPOSITORY-FIRST IMPLEMENTATION RULE

Before implementation:

1. Read root `AGENTS.md`.
2. Read this full TASK 02.7 file.
3. Read the current Fixed Developer Prompt.
4. Read mandatory foundation docs.
5. Inspect current frontend architecture.
6. Inspect current API client/fetch utilities.
7. Inspect current auth/session handling.
8. Inspect Product/Search API usage from 02.5/02.6.
9. Inspect current loading/error/skeleton components.
10. Inspect router/layout structure.
11. Inspect current package versions.
12. Reuse existing patterns where compatible.

Do not assume prior chat context is current repository truth.

---

# 8. RELEVANT DOCUMENTATION

Read current versions where applicable:

- `docs/01_Project Foundation/PROJECT_VISION.md`
- `docs/01_Project Foundation/PROJECT_STRUCTURE.md`
- `docs/01_Project Foundation/TECH_STACK.md`
- `docs/01_Project Foundation/DEPENDENCIES.md`
- `docs/01_Project Foundation/DECISIONS.md`
- `docs/03_Architecture/SYSTEM_ARCHITECTURE.md`
- `docs/04_Engineering Standards/CODING_STANDARD.md`
- `docs/04_Engineering Standards/TYPESCRIPT_STANDARD.md`
- `docs/04_Engineering Standards/STATE_MANAGEMENT.md`
- `docs/04_Engineering Standards/API_GUIDELINES.md`
- `docs/04_Engineering Standards/COMPONENT_GUIDELINES.md`
- `docs/04_Engineering Standards/SECURITY_STANDARD.md`
- relevant `docs/02_Design/*`
- `docs/05_Features/PRODUCTS.md`
- `docs/05_Features/SEARCH.md`
- relevant Auth docs if auth API client/session behavior is touched
- relevant testing docs under `docs/08_Quality/`
- `docs/10_Operations/DEFINITION_OF_DONE.md`
- workflow docs under `docs/11_Workflow/`

Read only relevant ADRs.

---

# 9. DEPENDENCY DECISION — REACT QUERY

Use TanStack Query / React Query version compatible with the current React/TypeScript stack.

Preferred package:

```text
@tanstack/react-query
```

Do not introduce an obsolete package name or incompatible major version.

Before changing dependencies:

- inspect current `package.json`;
- inspect React version;
- inspect TypeScript version;
- verify package compatibility;
- avoid unrelated dependency upgrades.

No broad dependency refresh.

---

# 10. QUERYCLIENT PROVIDER

Create/configure one canonical QueryClient for the customer frontend application.

Conceptually:

```tsx
<QueryClientProvider client={queryClient}>
  <App />
</QueryClientProvider>
```

Use the current application entry/provider architecture.

Do not create multiple independent QueryClients per feature.

Do not recreate QueryClient during every render.

---

# 11. QUERYCLIENT FACTORY / MODULE

Prefer one module responsible for QueryClient creation/configuration.

Conceptual structure:

```text
src/
  lib/
    query/
      queryClient.ts
      queryKeys.ts
      queryDefaults.ts
```

Adapt to actual repository structure.

Do not create folders merely because this task suggests names.

---

# 12. DEFAULT QUERY CONFIGURATION

Define deliberate defaults.

At minimum evaluate:

- `staleTime`
- `gcTime`
- retry count
- retry delay
- refetch on window focus
- refetch on reconnect
- refetch on mount
- network mode where relevant

Do not use arbitrary defaults without documenting intent.

---

# 13. RECOMMENDED DEFAULT PHILOSOPHY

ElectroHub should avoid excessive refetching while keeping commerce data reasonably fresh.

Suggested foundation direction:

```text
General public reference data
→ moderately stale-safe

Search results
→ short stale time

Product detail/list
→ short-to-moderate stale time

Categories/Brands
→ longer stale time

Inventory-sensitive views
→ shorter stale time when later integrated

Account/customer personal data
→ short stale time / explicit invalidation after mutation
```

Exact values must be documented and based on current feature behavior.

---

# 14. CACHE STRATEGY — PRINCIPLES

The cache strategy must answer:

1. How long is cached data considered fresh?
2. When is data refetched?
3. What gets invalidated after mutations?
4. Which queries can reuse cached data?
5. Which data should not be globally persisted?

Do not treat cache as permanent storage.

Do not persist sensitive server data to localStorage by default.

---

# 15. CACHE STRATEGY — PUBLIC REFERENCE DATA

Categories and Brands are relatively stable.

They may use longer stale times than Search results.

Example strategy:

```text
categories
brands
→ 5–15 minutes staleTime
```

Exact values are implementation decisions and must be documented.

Do not hardcode policy inconsistently across hooks.

---

# 16. CACHE STRATEGY — PRODUCTS

Product lists/details change less frequently than Search text changes but more frequently than static reference data.

Suggested initial range:

```text
30–120 seconds staleTime
```

Choose one consistent policy.

Availability may be more volatile than descriptive metadata.

Do not pretend cached availability is real-time inventory.

Future inventory tasks may tighten policy.

---

# 17. CACHE STRATEGY — SEARCH

Search result caching is useful for:

- back navigation;
- repeated queries;
- same filters/sort/page;
- reducing duplicate requests.

Suggested short stale time:

```text
15–60 seconds
```

Search query keys MUST include all committed Search parameters that materially change results.

---

# 18. SEARCH QUERY KEY

Search results must not collide across different state.

Conceptually:

```ts
['search', 'products', {
  q,
  category,
  brand,
  availability,
  minPrice,
  maxPrice,
  sort,
  page,
  pageSize,
}]
```

Canonicalize input so semantically equivalent requests do not fragment cache unnecessarily.

Do not use unstable object construction that causes accidental churn if the library handles structural equality differently than expected.

---

# 19. SEARCH SUGGESTION CACHE

Suggestion queries should be short-lived and bounded.

Do not cache thousands of arbitrary strings indefinitely.

Query key should include normalized query + limit.

Example:

```text
['search', 'suggestions', normalizedQ, limit]
```

Use short stale time.

Respect minimum query length.

---

# 20. QUERY KEY CONVENTION

Create documented query-key factories.

Do not scatter anonymous arrays everywhere.

Conceptual:

```ts
queryKeys.products.all
queryKeys.products.list(params)
queryKeys.products.detail(slug)
queryKeys.categories.all
queryKeys.categories.detail(slug)
queryKeys.brands.all
queryKeys.brands.detail(slug)
queryKeys.search.products(params)
queryKeys.search.suggestions(q, limit)
```

Adapt naming to repository conventions.

---

# 21. QUERY KEY FACTORY RULES

Query keys must be:

- deterministic;
- serializable;
- stable;
- feature-scoped;
- invalidation-friendly;
- documented.

Do not include non-serializable values like functions or AbortControllers.

---

# 22. CENTRAL API CLIENT — OBJECTIVE

Create/reuse one canonical API client.

It must centralize:

- base URL;
- credentials/cookies behavior;
- request method;
- JSON serialization;
- response parsing;
- typed errors;
- AbortSignal support;
- safe headers;
- status handling;
- request IDs where existing architecture uses them.

Components must not duplicate this logic.

---

# 23. API CLIENT — DO NOT OVERENGINEER

Do not introduce Axios if the current project already has a clean `fetch`-based client unless there is a documented reason.

Do not introduce a second HTTP library.

Prefer current stack.

---

# 24. API CLIENT — EXAMPLE CONCEPT

Conceptually:

```ts
apiClient.get<T>(path, options)
apiClient.post<TResponse, TBody>(path, body, options)
apiClient.patch<TResponse, TBody>(path, body, options)
apiClient.delete<T>(path, options)
```

Exact API should fit existing architecture.

---

# 25. API CLIENT — BASE URL

Use approved environment configuration.

Do not hardcode:

```text
http://localhost:5000
```

throughout features.

Centralize base URL handling.

Do not expose server-only secrets.

---

# 26. API CLIENT — CREDENTIALS

Preserve existing cookie/session auth behavior.

If current auth relies on HTTP-only cookies:

- preserve `credentials` behavior;
- do not move tokens into localStorage;
- do not expose refresh tokens to JS;
- do not break `/api/auth/me`.

---

# 27. API CLIENT — HEADERS

Use appropriate default headers.

Examples:

```text
Accept: application/json
Content-Type: application/json
```

Only set Content-Type where a body requires it.

Do not break future FormData/file uploads by forcing JSON headers universally.

---

# 28. API CLIENT — ABORTSIGNAL

The API client MUST accept and forward `AbortSignal`.

React Query should be able to cancel obsolete requests.

Conceptually:

```ts
queryFn: ({ signal }) => api.products.list(params, { signal })
```

Do not create detached network requests that ignore cancellation.

---

# 29. API CLIENT — RESPONSE HANDLING

Normalize response handling.

Supported API envelopes may include:

```json
{ "data": ... }
```

and:

```json
{
  "data": [],
  "meta": { ... }
}
```

Do not make every component parse envelopes manually.

---

# 30. ERROR MODEL

Create/reuse one frontend error representation.

Conceptually:

```ts
ApiError {
  status
  code
  message
  requestId?
  fieldErrors?
}
```

Only include what the backend actually returns.

Do not invent backend fields.

---

# 31. ERROR NORMALIZATION

The API client should normalize:

- structured backend errors;
- unauthorized;
- forbidden;
- not found;
- validation errors;
- rate limiting;
- network failures;
- aborted requests;
- malformed/unexpected response where needed.

Components should not inspect raw `Response` objects everywhere.

---

# 32. USER-FACING ERROR POLICY

Do not show raw:

- stack traces;
- Prisma errors;
- SQL;
- HTML proxy errors;
- internal paths;
- full network exception strings.

Use safe customer-facing messages.

Retain detailed debugging context only where approved logger tooling can safely handle it.

---

# 33. RETRY POLICY

React Query should not blindly retry every failure.

Suggested policy:

Do NOT retry:

- 400 validation;
- 401 unauthorized;
- 403 forbidden;
- 404 expected not-found;
- 409 conflict where user action is required;
- 422 validation;
- most deterministic client errors.

Potentially retry:

- transient network errors;
- selected 5xx failures;
- temporary gateway issues.

Keep retries bounded.

---

# 34. RETRY DELAY

Use bounded backoff.

Do not create long retry storms.

Avoid making a page appear frozen while React Query silently retries for an excessive duration.

---

# 35. RATE LIMIT ERRORS

For `429 RATE_LIMITED`:

- do not aggressive-retry;
- surface a controlled message;
- preserve user state;
- respect Retry-After if backend provides it and architecture supports it.

Search suggestions should not enter retry loops after rate limiting.

---

# 36. LOADING STATE ARCHITECTURE

Use different loading indicators for different scopes.

Approved rule:

```text
Route/page loading
→ ElectroHubLoader

Card/list/content loading
→ Skeletons

Button/action loading
→ small inline spinner/indicator
```

Do not use one giant spinner for every request.

---

# 37. ELECTROHUBLOADER — PURPOSE

Create a shared branded `ElectroHubLoader`.

It is intended for:

- lazy route/page transitions;
- app shell page-level waits;
- route-level Suspense fallback where appropriate;
- major full-content transitions where no stable skeleton layout exists.

It should NOT replace skeletons for Product grids/cards.

---

# 38. ELECTROHUBLOADER — VISUAL IDENTITY

The loader should visually derive from ElectroHub branding.

Use the existing ElectroHub lightning/logo icon.

Conceptual animation:

```text
blue lightning mark
   ↓
controlled spin/rotation
   + subtle pulse
   + subtle glow
```

The animation should feel premium and intentional, not like a generic CSS spinner.

---

# 39. ELECTROHUBLOADER — DESIGN CONSTRAINTS

Use existing brand colors/tokens.

Do not invent a new logo.

Do not distort the existing logo mark.

Do not use an external GIF.

Do not use a heavy animation library solely for this component.

Prefer CSS animation or existing motion utilities.

---

# 40. ELECTROHUBLOADER — VARIANTS

Support practical variants such as:

```text
sm
md
lg
page/fullscreen
```

Exact API must fit repository component conventions.

Do not expose unnecessary configuration.

---

# 41. ELECTROHUBLOADER — PAGE MODE

Page-level mode should:

- center appropriately within page/shell;
- avoid layout shift;
- reserve stable minimum space where useful;
- not block the browser unnecessarily;
- not hide persistent global navigation unless route architecture intentionally does so.

Do not cover the whole app with an opaque overlay for every query.

---

# 42. ELECTROHUBLOADER — ACCESSIBILITY

Required:

```text
role="status"
aria-live="polite" where appropriate
visually hidden "Loading..."
```

Do not make screen readers read decorative animation details.

---

# 43. REDUCED MOTION

Respect:

```css
prefers-reduced-motion: reduce
```

When reduced motion is enabled:

- remove continuous spin or significantly reduce it;
- retain a clear static branded loading state;
- do not rely on animation alone to convey loading.

---

# 44. ELECTROHUBLOADER — VISUAL QA

Verify:

- correct logo proportions;
- brand blue;
- smooth motion;
- no pixelation;
- no odd clipping;
- no accidental rotation around wrong transform origin;
- no excessive glow;
- no motion sickness behavior;
- no content jump when loader resolves.

---

# 45. ROUTE-LEVEL LOADING

Inspect current router implementation.

If routes are lazy-loaded or can support Suspense cleanly:

use `ElectroHubLoader` as route-level fallback.

Do not force an artificial loader on routes that render synchronously with no actual wait.

---

# 46. NAVIGATION LOADING EXPECTATION

The user requested a dedicated ElectroHub spinner "when moving to any page".

Interpretation:

Show the branded loader during REAL route/page loading transitions where content is not ready.

Do NOT add an artificial fixed delay to every navigation solely to make the spinner visible.

Do NOT flash the loader for instantaneous transitions if it creates visual noise.

If a minimum display duration is considered necessary to avoid 20ms flashing, keep it small and justified; do not block navigation for cosmetic reasons.

---

# 47. PAGE TRANSITION FLICKER

Avoid spinner flicker.

Possible strategies:

- delayed appearance threshold;
- keep previous content until next query resolves where UX is better;
- use skeletons instead of page loader for structured content.

Do not implement all strategies simultaneously.

Choose the simplest architecture-consistent behavior.

---

# 48. SKELETON POLICY

Skeletons remain preferred for content whose final shape is known.

Examples:

- Product grid;
- Product card;
- order list;
- account card sections;
- table rows.

Skeletons should mirror actual content layout.

Do not use generic blank blocks.

Follow current approved square-corner design if that remains current repository truth.

---

# 49. BUTTON LOADING POLICY

Mutations/actions should use a small inline loading indicator.

Examples:

```text
Save
Delete
Update profile
Add to cart
```

Do not replace the entire page with `ElectroHubLoader` for a local button action.

Disable/prevent duplicate submission as appropriate.

---

# 50. QUERY HOOK ARCHITECTURE

Feature code should expose reusable hooks.

Conceptual examples:

```ts
useProductsQuery(params)
useProductQuery(slug)
useCategoriesQuery()
useBrandsQuery()
useSearchProductsQuery(params)
useSearchSuggestionsQuery(q, limit)
```

Do not create one generic mega-hook handling every endpoint.

---

# 51. QUERY HOOK LOCATION

Prefer feature-scoped hooks where appropriate.

Conceptual:

```text
features/products/queries.ts
features/search/queries.ts
features/categories/queries.ts
```

or repository equivalent.

Shared query infrastructure belongs in shared/lib layer.

---

# 52. ENABLED CONDITIONS

Use React Query `enabled` conditions deliberately.

Examples:

- Search suggestions disabled below minimum query length.
- Product detail disabled when slug missing.
- Search results disabled for untouched initial `/search` state.

Do not fire meaningless requests and discard them later.

---

# 53. SEARCH LIVE QUERY MIGRATION

TASK 02.6 live Search currently manages fetch/cancel/state manually.

TASK 02.7 should migrate appropriate server fetching to React Query while preserving approved UX:

- live debounced search;
- URL state;
- suggestion timing;
- latest result correctness;
- initial state;
- Search/Products shared backend;
- no history spam.

Do not regress 02.6 behavior.

---

# 54. SEARCH DEBOUNCE VS REACT QUERY

Debounce remains a UI/query-input concern.

React Query should query using the debounced/committed value.

Do not abuse `staleTime` as debounce.

Do not issue a query per raw keystroke if the existing design expects debounce.

---

# 55. SEARCH CANCELLATION

React Query passes `AbortSignal` to query functions.

Use it.

Avoid maintaining unnecessary duplicate request-sequence mechanisms once React Query cancellation safely covers them.

However, remove legacy guards only after proving no stale-response regression.

---

# 56. KEEP PREVIOUS DATA

For pagination/filter transitions, evaluate keeping previous data to reduce UI flashing.

Use current TanStack Query API/version correctly.

Do not show stale page 1 data as if it were page 2 without clear transition semantics.

---

# 57. PAGINATION

Query keys must include pagination parameters.

Changing page must fetch/cache the appropriate page independently.

When query/filter/sort changes:

- page resets to 1 according to current feature behavior;
- new query key is generated;
- prior unrelated page cache should not overwrite new state.

---

# 58. PREFETCHING — FOUNDATION ONLY

Optional low-risk prefetching may be introduced only where clearly valuable.

Examples:

- next Product page;
- Product detail on intentional hover later.

Do not add broad speculative prefetching in 02.7 unless evidence justifies it.

---

# 59. MUTATION FOUNDATION

Even if 02.7 primarily migrates reads, define the mutation convention.

A mutation hook should:

1. call central API client;
2. normalize errors;
3. prevent duplicate submissions where relevant;
4. invalidate/update exact affected query keys;
5. avoid `invalidateQueries()` across the entire app.

---

# 60. MUTATION INVALIDATION — EXAMPLES

Future examples:

Product update:

```text
invalidate product detail
invalidate relevant product lists/search
```

Profile update:

```text
invalidate current-user/profile
```

Cart mutation:

```text
invalidate cart
possibly invalidate dependent badge/count
```

Do not implement future mutations now unless current scoped code already requires migration.

---

# 61. OPTIMISTIC UPDATES

Do not establish optimistic updates as a global default.

Use optimistic UI only when a feature specifically requires it and rollback is safe.

TASK 02.7 should document the convention, not force it everywhere.

---

# 62. AUTH-ADJACENT READS

The task may migrate low-risk existing auth-adjacent READ queries where doing so materially proves the API foundation.

Example:

```text
/api/auth/me
```

Only if compatible with existing AuthContext/session architecture.

Do NOT rewrite authentication around React Query without explicit evidence/approval.

Auth remains security-critical.

---

# 63. AUTH BOUNDARY

Do not:

- move tokens into localStorage;
- expose refresh tokens;
- remove existing session checks;
- make React Query the security authority;
- rely on cached user role for backend authorization.

Backend authorization remains authoritative.

---

# 64. 401 HANDLING

Central API error handling must not create infinite retry/refetch loops on 401.

Preserve current approved auth refresh/session behavior.

If auth middleware/client already handles refresh, integrate rather than duplicate.

---

# 65. LOGOUT CACHE CLEARING

When logout occurs, sensitive cached user-specific queries must be cleared/reset appropriately.

Do not leave another user's account/order/profile data in cache after logout/login switch.

Define and test this if account reads are migrated.

---

# 66. PUBLIC CACHE VS USER CACHE

Public Product/Category/Brand/Search cache can survive ordinary navigation.

User-specific cache must be treated more carefully.

Examples:

- account profile;
- orders;
- wishlist;
- cart;
- addresses.

Do not persist across user identity changes without invalidation/reset.

---

# 67. QUERY DEVTOOLS

Do not ship React Query Devtools in production by default unless current project policy allows it.

If used for development:

- dev-only;
- no production bundle impact if avoidable;
- do not expose sensitive data unnecessarily.

Devtools are optional, not required.

---

# 68. ERROR BOUNDARIES

Do not use React Query as a replacement for React Error Boundaries.

Evaluate current app error-boundary architecture.

Use:

- query error state for request errors;
- ErrorBoundary for render/runtime failures;
- route error handling where router supports it.

---

# 69. LOADING VS FETCHING

Differentiate:

```text
isPending / initial load
vs
isFetching / background refetch
```

Do not replace visible content with a page loader during every background refetch.

Use subtle refresh behavior where appropriate.

---

# 70. BACKGROUND REFETCH UX

When data exists and React Query performs a background refetch:

- keep existing content;
- avoid full-page loader;
- optionally show a subtle updating state if genuinely useful.

Do not flash skeletons repeatedly.

---

# 71. PRODUCT LIST MIGRATION

Migrate Product list reads where appropriate to React Query.

Preserve:

- existing API contract;
- pagination;
- Decimal string mapping;
- availability;
- ProductCard behavior;
- error/empty states;
- existing URL behavior.

---

# 72. CATEGORY / BRAND MIGRATION

Migrate current category/brand reads used by Product/Search pages.

This is a strong candidate because data is reusable across:

- `/search`;
- `/products`;
- filters;
- future catalog pages.

Use shared query cache rather than repeated per-page fetches.

---

# 73. SEARCH RESULTS MIGRATION

Migrate `/api/search/products` consumption.

Preserve:

- q;
- filters;
- sort;
- page;
- initial state;
- live search;
- query consistency;
- no-results behavior.

---

# 74. SEARCH SUGGESTIONS MIGRATION

Migrate `/api/search/suggestions` consumption.

Preserve:

- minimum query length;
- fast debounce;
- bounded limit;
- keyboard UX;
- no stale suggestion display;
- failure does not block product Search.

---

# 75. DUPLICATE FETCH ELIMINATION

After migration, inspect affected pages for redundant network calls.

Examples to avoid:

```text
Search page fetches categories
Products page independently fetches categories
shared hook cache ignored
```

React Query should deduplicate compatible requests.

---

# 76. API CLIENT TYPING

Use TypeScript generics/types carefully.

Avoid:

```ts
any
```

for core response/error types.

Do not create giant generic types that obscure endpoint contracts.

Reuse existing domain types where accurate.

---

# 77. DOMAIN TYPES VS TRANSPORT TYPES

Do not silently conflate:

```text
Backend DTO
Frontend presentation model
```

Example:

Backend price:

```text
"499.00"
```

ProductCard may consume a presentation adapter.

Keep existing safe Decimal strategy.

React Query cache should preferably contain the canonical API DTO, not mutated business-authority numbers.

---

# 78. QUERY DATA TRANSFORM

Use `select` or adapters deliberately when needed.

Do not mutate cached data in-place.

Keep transformations deterministic.

---

# 79. STRUCTURAL SHARING

Use React Query defaults unless there is evidence to change structural sharing behavior.

Do not disable optimization globally without reason.

---

# 80. INVALIDATION GRANULARITY

Query-key factories must allow:

```text
invalidate all products
invalidate one product
invalidate one product list family
invalidate search family
invalidate category family
```

Avoid one flat key namespace that makes invalidation imprecise.

---

# 81. CACHE CLEAR ON APP VERSION / CONTRACT CHANGE

Do not implement persistent cache in 02.7 unless explicitly required.

Because cache is in memory, API-contract deploy compatibility is simpler.

No persistent hydration architecture required.

---

# 82. SSR / NEXT.JS

Do not introduce SSR, Next.js, hydration, or server components.

ElectroHub remains on its approved frontend stack.

---

# 83. OFFLINE MODE

Do not implement offline queueing or offline mutation replay.

Normal network error handling is sufficient.

---

# 84. REQUEST TIMEOUTS

If the current central client supports request timeouts, preserve/document them.

Do not add arbitrary short global timeouts that break Supabase-backed DEV behavior.

Cancellation and timeout are distinct concepts.

---

# 85. SEARCH DEV LATENCY

TASK 02.6 identified remote DEV connection startup latency.

TASK 02.7 must not hide genuine slow Search queries behind loaders.

React Query should improve UX but does not fix backend performance.

Preserve documented backend timeout behavior unless separately reviewed.

---

# 86. LOADER TIMING

Avoid showing `ElectroHubLoader` for tiny sub-100ms operations if that creates flicker.

A short appearance delay may be used if the existing UX framework supports it cleanly.

Do not add a fake minimum wait to every navigation.

---

# 87. ELECTROHUBLOADER IMPLEMENTATION OPTIONS

Prefer:

- existing SVG/logo asset;
- CSS transform animation;
- pseudo-element/glow where appropriate.

Avoid:

- canvas;
- WebGL;
- external animated GIF;
- Lottie dependency solely for this loader.

---

# 88. ELECTROHUBLOADER SQUARE DESIGN COMPATIBILITY

Current ElectroHub UI may follow square rectangular surfaces.

The loader itself is an icon, not a rectangular card.

Do not wrap it in an unnecessarily rounded container.

If a loader container exists, follow current global design tokens.

---

# 89. LOADER Z-INDEX

Do not create an overlay that incorrectly covers persistent header/footer unless the UX intentionally requires a full app-blocking state.

Default page loader should live inside page content.

---

# 90. ROUTER INTEGRATION

Inspect current router.

Potential integration points:

- lazy route fallback;
- Suspense boundary;
- route-level pending component if router supports it;
- page query pending state.

Use the architecture actually available.

Do not invent unsupported router APIs.

---

# 91. ERROR UI STANDARDIZATION

Create/reuse a consistent error-display pattern for server-state failures.

Should support:

- concise message;
- retry action where meaningful;
- preserving surrounding page chrome;
- accessible status/alert semantics.

Do not show one unique error card per feature unless design requires it.

---

# 92. EMPTY VS ERROR

Keep empty state distinct from error state.

Examples:

```text
0 products match filters
→ empty state

500/network failure
→ error state
```

React Query status handling must not confuse them.

---

# 93. LOADING VS EMPTY

Do not briefly show empty state before a query completes.

Use query status correctly.

---

# 94. ERROR RETRY BUTTON

Retry should call React Query refetch for the exact failed query.

Do not manually recreate request state.

---

# 95. GLOBAL QUERY ERROR HANDLING

Use global QueryCache/MutationCache error hooks only for genuinely global concerns.

Do not toast every 404/validation error globally.

Feature-specific errors should remain feature-specific when appropriate.

---

# 96. TOASTS

If current project has a toast system, use it only where current UX uses toasts.

Do not introduce a new notification library for 02.7.

---

# 97. MUTATION CACHE

Configure MutationCache only if it materially improves consistent error/invalidation behavior.

Do not over-centralize all mutation business logic.

---

# 98. REQUEST DEDUPLICATION

React Query should naturally deduplicate same-key simultaneous reads.

Add tests for at least one representative shared query where useful.

---

# 99. PARALLEL QUERIES

Use parallel queries where independent data is needed.

Do not serialize:

```text
categories → brands → products
```

if there is no dependency.

Avoid waterfalls.

---

# 100. CONDITIONAL QUERIES

Do not start dependent queries before prerequisite input exists.

Example:

Product detail query waits for valid slug.

---

# 101. N+1 NETWORK REQUESTS

React Query does not automatically fix application-level N+1 HTTP calls.

Inspect migrated screens.

Do not fetch one Product detail per Product card if the list endpoint already provides summaries.

---

# 102. SEARCH PAGE QUERY USE

The Search page should usually need:

- search results query;
- suggestions query;
- categories query where UI needs them;
- brands query where UI needs them.

Do not fetch Product detail per result.

---

# 103. PRODUCTS PAGE QUERY USE

The Products page can reuse:

- search/products query for catalog discovery;
- categories query;
- brands query.

Do not duplicate catalog/search fetch implementations.

---

# 104. QUERY PARAM CANONICALIZATION

Before building query keys/request URLs:

- trim q;
- omit empty optional filters where possible;
- normalize page/pageSize;
- normalize undefined/null consistently;
- preserve meaningful Decimal strings.

Equivalent Search state should map to equivalent query keys.

---

# 105. URL STATE VS QUERY KEY

URL remains the authority for committed Search/Product discovery state where currently approved.

React Query consumes that state.

Do not make Query cache replace routing state.

---

# 106. ROUTER BACK/FORWARD

After React Query migration:

Back/Forward must still restore:

- query;
- filters;
- sort;
- page;
- visible data.

Cached data may make this faster.

Do not break URL restoration.

---

# 107. AUTH STATE VS QUERY CACHE

If `/api/auth/me` is migrated:

- cache key must be stable;
- logout clears/resets it;
- login invalidates/refetches it;
- role/identity changes are handled safely;
- backend remains authority.

Do not cache stale user identity across logout.

---

# 108. API CLIENT SECURITY

The central client must not log:

- passwords;
- OTPs;
- access tokens;
- refresh tokens;
- Authorization secrets;
- cookies;
- database URLs;
- Brevo/Stripe/Cloudinary secrets.

---

# 109. API CLIENT LOGGING

If request logging exists:

- sanitize headers;
- sanitize bodies;
- preserve request IDs where helpful;
- no secrets.

Do not add verbose production network logging.

---

# 110. CSRF / COOKIE BEHAVIOR

Preserve the existing security model.

Do not weaken SameSite/cookie protections.

Do not invent frontend CSRF handling unless backend architecture requires it.

---

# 111. API COMPATIBILITY

Do not change backend endpoint contracts merely to simplify React Query.

Frontend adapts to approved APIs.

Any backend change requires task evidence.

---

# 112. DATABASE

Expected:

```text
NO Prisma schema change
NO migration
NO DEV seed
NO PROD seed
```

TASK 02.7 is a frontend state/API foundation task.

---

# 113. FOLDER / FILE ORGANIZATION

Use current repository conventions.

Likely conceptual additions:

```text
src/lib/api/
src/lib/query/
src/components/ui/ElectroHubLoader/
features/products/queries.ts
features/search/queries.ts
```

Do not force these exact paths if current structure differs.

---

# 114. API MODULES

Prefer domain-specific API functions layered on central client.

Conceptually:

```ts
productsApi.list()
productsApi.detail()
searchApi.products()
searchApi.suggestions()
categoriesApi.list()
brandsApi.list()
```

Do not place endpoint path strings throughout components.

---

# 115. API CLIENT RETURN TYPE

Choose one clear convention:

Either central client returns parsed DTO/envelope,
or endpoint-specific API modules unwrap it.

Do not inconsistently unwrap in random components.

Document the convention.

---

# 116. QUERY HOOK RETURN API

Do not hide useful React Query state unnecessarily.

Feature hooks may expose:

- data;
- error;
- isPending;
- isFetching;
- refetch;

but avoid gratuitous wrapper abstractions that make TanStack Query harder to reason about.

---

# 117. GENERIC USEAPI HOOK — AVOID

Do not create a generic:

```text
useApi(endpoint)
```

that loses endpoint typing, query-key clarity, and domain semantics.

Prefer specific hooks.

---

# 118. QUERY DEFAULT OVERRIDES

Feature hooks may override global defaults only when justified.

Examples:

- Search suggestions shorter stale time;
- Categories longer stale time;
- current user shorter stale time.

Do not override every option locally.

---

# 119. QUERY OPTION FACTORIES

If current TanStack Query version supports clean query option factories, consider using them.

Only if this improves reuse/testability without overengineering.

---

# 120. INITIAL DATA / PLACEHOLDER DATA

Use deliberately.

Do not fake Product data just to avoid loading.

Use cache/placeholder data only when semantically correct.

---

# 121. SEARCH PLACEHOLDER DATA

For page/filter transitions, previous results may remain temporarily while next data is loading if clearly treated as transitional.

Do not let old query result appear permanently under new query text.

---

# 122. LOADING INDICATOR PRIORITY

Recommended UX hierarchy:

1. If stable content layout is known → skeleton.
2. If existing data can remain during background refetch → keep data.
3. If whole page/module truly awaits first content → `ElectroHubLoader`.
4. If button action → inline loader.

---

# 123. GLOBAL PAGE LOADER MISUSE

Do not show `ElectroHubLoader` every time:

- Search suggestions fetch;
- one Product page changes page number;
- a background refetch occurs;
- category list silently refreshes.

The loader is branded page-level UX, not a replacement for nuanced loading states.

---

# 124. ELECTROHUBLOADER COMPONENT API

Conceptual API:

```tsx
<ElectroHubLoader size="md" />
<ElectroHubLoader variant="page" />
```

Keep API minimal.

Possible props:

- size;
- variant;
- label.

Do not expose arbitrary colors/animation speeds unless repository component guidelines require them.

---

# 125. ELECTROHUBLOADER TESTS

Test:

- renders brand icon;
- accessible loading label;
- variant classes;
- reduced-motion behavior where practical;
- no accidental duplicate SVG title announcements;
- page variant layout.

---

# 126. ROUTE TRANSITION TESTS

Verify at least representative navigation:

```text
Home → Products
Products → Search
Search → Account
```

When actual lazy/page loading occurs:

- loader appears appropriately;
- loader disappears when ready;
- no permanent overlay;
- header/footer behavior remains correct.

Do not artificially delay routes for tests except controlled mocks.

---

# 127. QUERY LOADING TESTS

Verify:

- initial pending;
- success;
- empty;
- error;
- retry;
- background fetching does not blank content;
- cancellation.

---

# 128. API CLIENT TESTS

Unit-test:

- base URL/path handling;
- query params;
- JSON request body;
- GET parsing;
- structured errors;
- network error;
- abort;
- 204/no-content where relevant;
- credentials behavior;
- no forced JSON header for FormData if supported.

---

# 129. QUERY KEY TESTS

Test canonical key generation for:

- Product list;
- Product detail;
- Categories;
- Brands;
- Search products;
- Search suggestions.

Ensure parameter differences create distinct keys.

Ensure equivalent normalized state creates consistent keys.

---

# 130. RETRY TESTS

Verify:

- 400 not retried;
- 401 not retried endlessly;
- 404 not retried;
- 429 not aggressively retried;
- transient 5xx/network bounded retry if configured.

Avoid time-heavy tests; use fake timers/mocks where appropriate.

---

# 131. CACHE TESTS

Test representative behavior:

- same query key reuses cache;
- stale query refetches according to policy;
- categories/brands reuse cache across Search/Products;
- invalidation targets correct family.

Do not write brittle timing tests around internal implementation details.

---

# 132. LOGOUT CACHE TEST

If account/current-user query is migrated:

verify logout removes sensitive user-specific cached data.

If not migrated, document this as a future convention rather than forcing auth refactor.

---

# 133. SEARCH REGRESSION TESTS

After React Query migration, preserve all important 02.6 behavior:

- `mm` suggestion/result consistency;
- specification search;
- random query correctness;
- live search;
- fast suggestions;
- URL state;
- Products compact search;
- full Products filtering;
- sort;
- pagination;
- no stale requests;
- Image Search shell unaffected.

---

# 134. PRODUCTS PAGE REGRESSION

Verify:

- compact Search input;
- filters;
- sort;
- Reset;
- Product grid;
- skeleton shape;
- footer/header;
- square surface design if current project standard remains active.

TASK 02.7 must not undo approved 02.6 UI work.

---

# 135. ACCOUNT REGRESSION

If central API client affects Account/Profile requests:

verify:

- account reads still work;
- auth cookies preserved;
- errors remain sanitized;
- no stale identity issue;
- global loading UX does not break account forms.

Do not redesign Account UI.

---

# 136. FOOTER / HEADER REGRESSION

The shared Header/Footer must remain present according to current layout architecture.

The page loader must not:

- overlap persistent header incorrectly;
- displace footer unexpectedly;
- create giant blank pages after loading.

---

# 137. RESPONSIVE LOADER QA

Verify `ElectroHubLoader` on:

- mobile;
- tablet;
- desktop;
- large desktop.

It must remain centered and proportionate.

Do not make the logo enormous on small screens.

---

# 138. PERFORMANCE

React Query should reduce redundant requests, not add them.

Inspect representative network behavior:

- Products navigation;
- Search typing;
- Search → Products;
- Products → Search;
- Back/Forward.

Look for duplicate identical requests.

---

# 139. BUNDLE IMPACT

Adding React Query is expected.

Do not add multiple support libraries unnecessarily.

Verify build output remains reasonable.

No need for micro-optimization unless bundle regressions are obviously excessive.

---

# 140. REACT QUERY DEV MODE BEHAVIOR

Remember React Strict Mode may double-invoke some development behaviors.

Do not mistake normal Strict Mode behavior for production duplicate requests without evidence.

Still ensure query functions are idempotent/read-safe.

---

# 141. QUERY CANCELLATION AND STRICT MODE

Query functions must tolerate cancellation and re-execution safely.

No side effects in read query functions.

---

# 142. MUTATION SIDE EFFECTS

Mutation side effects belong in mutation lifecycle/business logic, not query functions.

Do not mutate server state from GET query hooks.

---

# 143. SECURITY

Review:

- credentials;
- sensitive cache;
- logout;
- request logging;
- error messages;
- retry storms;
- accidental sensitive persistence;
- cross-user cache leakage.

No backend authorization change.

---

# 144. ACCESSIBILITY

Loading/error states must be accessible.

Required:

- loader `role=status`;
- readable hidden loading text;
- errors use alert/status semantics as appropriate;
- retry buttons keyboard-accessible;
- skeletons decorative where appropriate;
- background refetch not excessively announced.

---

# 145. MOTION

ElectroHubLoader must respect reduced motion.

Do not add unrelated page transition animations.

No flashy global route animation requirement beyond the branded loader.

---

# 146. VISUAL QUALITY

The loader should feel like part of ElectroHub, not a library default.

Desired qualities:

- clean;
- crisp;
- blue brand identity;
- controlled spin;
- subtle pulse;
- subtle glow;
- premium;
- fast;
- not distracting.

---

# 147. ERROR COMPONENT

If a shared query error component does not exist, create the smallest reusable component necessary.

Conceptual content:

```text
Something went wrong
We couldn't load this content.
[ Retry ]
```

Use current copy/design conventions.

No rounded visual style if current global project rule is square.

---

# 148. EMPTY STATE COMPONENT

Do not conflate Query foundation with a mandate to create one universal empty-state mega-component.

Reuse existing empty states.

Standardize only when evidence supports a shared primitive.

---

# 149. API CLIENT MIGRATION STRATEGY

Do NOT migrate every API call in the entire application blindly.

Migrate the smallest complete representative set required to establish and prove the foundation.

Required initial migration surface should include:

- Products public reads;
- Categories public reads;
- Brands public reads;
- Search products;
- Search suggestions.

Optionally low-risk auth/current-user read if architecture benefits and tests prove safety.

Leave unrelated domains for their owning tasks.

---

# 150. NO WHOLE-APP REWRITE

TASK 02.7 is successful when the foundation exists and relevant current reads use it.

It is NOT successful by touching every feature file.

Prefer small complete migration surface over broad risky refactor.

---

# 151. BACKWARD COMPATIBILITY

Existing components should continue receiving compatible data.

Do not force UI rewrites solely because React Query is introduced.

Adapters are acceptable where necessary.

---

# 152. DATA OWNERSHIP

React Query cache is a frontend cache.

It is not authoritative business state.

Backend remains authoritative for:

- authentication;
- authorization;
- prices;
- inventory;
- orders;
- payments;
- ownership.

---

# 153. CACHE INVALIDATION DOES NOT REPLACE BACKEND EVENTS

Do not assume local invalidation creates cross-user real-time consistency.

Real-time concerns belong to later architecture where applicable.

---

# 154. REFRESH ON FOCUS

Choose/document whether `refetchOnWindowFocus` is enabled globally.

Commerce apps often benefit from refreshed data, but excessive focus refetching can create noise.

A reasonable initial choice is allowed, but it must be deliberate.

Feature overrides can be used later.

---

# 155. REFRESH ON RECONNECT

Likely useful for server state.

Document current decision.

Do not enable aggressive loops.

---

# 156. GC TIME

Set a reasonable `gcTime` so cache can support navigation without growing indefinitely.

Do not leave every Search query in memory for hours without deliberate rationale.

---

# 157. SEARCH CACHE CARDINALITY

Search can create many unique query keys.

Keep:

- stale time short;
- gc time reasonable;
- suggestions bounded.

Do not persist Search cache.

---

# 158. PRODUCT CACHE RELATIONSHIP

Search summary data and Product detail may use different query keys.

Do not manually pretend a summary is a full Product detail unless API contract guarantees completeness.

Potential cache seeding can be considered later.

---

# 159. CATEGORY/BRAND SHARED CACHE

Search and Products must reuse the same Category/Brand query keys.

This is a major 02.7 acceptance criterion.

No duplicated API requests per page where fresh cache already exists.

---

# 160. REQUEST PARAM SERIALIZATION

Create/reuse one safe query-string serialization path.

Do not manually concatenate:

```text
?q=${q}&brand=${brand}
```

without encoding.

Use `URLSearchParams` or current approved utility.

---

# 161. EMPTY PARAMS

Avoid sending meaningless:

```text
brand=
category=
minPrice=
```

when API convention expects omission.

Canonicalization helps cache consistency.

---

# 162. DECIMAL PARAMS

Preserve min/max price as validated decimal strings.

Do not convert authoritative money filters through unsafe floating-point math merely for query construction.

---

# 163. RESPONSE VALIDATION

Do not add a new runtime schema library solely for every API response unless current project already uses one or task evidence requires it.

TypeScript compile-time typing plus trusted backend contract may be sufficient in current architecture.

If runtime validators already exist, reuse them.

---

# 164. API CLIENT 204 HANDLING

If delete/no-content endpoints are supported by the central client, handle `204` safely without attempting JSON parse.

This establishes future-safe behavior.

---

# 165. API CLIENT NON-JSON ERRORS

Reverse proxy/server errors may occasionally return non-JSON responses.

The client should fail safely and normalize them without exposing HTML/raw internals.

---

# 166. REQUEST ID

If backend emits request IDs, preserve them in normalized errors/logging where safe.

Do not expose sensitive infrastructure metadata.

---

# 167. ABORT ERROR UX

An intentionally aborted query must not display a scary customer error.

React Query cancellation should be treated as cancellation, not failure UI.

---

# 168. LOADER WITH CANCELLATION

If route/page request is cancelled because navigation changed, loader must disappear naturally with the route.

No orphan overlay.

---

# 169. QUERY INVALIDATION DOCUMENTATION

Create/update docs describing canonical invalidation examples.

Future developers should know how to invalidate:

- products;
- search;
- categories;
- brands;
- current user.

---

# 170. API CLIENT DOCUMENTATION

Document:

- base URL configuration;
- credentials;
- AbortSignal;
- errors;
- endpoint module convention;
- do-not-call-fetch-directly rule for migrated domains.

---

# 171. STATE MANAGEMENT DOCUMENTATION

Update current state-management docs to distinguish:

```text
Server state → React Query
Local UI state → React/useState/context where appropriate
URL state → Router/search params
Auth/session authority → existing security architecture
```

---

# 172. LOADING DOCUMENTATION

Document:

```text
Page/route → ElectroHubLoader
Structured content → skeleton
Action/button → inline indicator
Background refetch → keep existing content
```

---

# 173. CACHE POLICY DOCUMENTATION

Create a concise table.

Example structure:

| Query Family | Stale Time | GC Time | Refetch Focus | Notes |
|---|---:|---:|---|---|
| Categories | ... | ... | ... | reference data |
| Brands | ... | ... | ... | reference data |
| Products | ... | ... | ... | catalog |
| Search | ... | ... | ... | short-lived discovery |
| Suggestions | ... | ... | ... | very short-lived |

Use actual implemented values.

---

# 174. QUERY KEY DOCUMENTATION

Document exact key factories/naming.

Do not let future code invent parallel conventions.

---

# 175. MIGRATION DOCUMENTATION

Document how future features should adopt the foundation:

1. create/reuse endpoint module;
2. add query key;
3. add query hook;
4. configure feature-specific options only when necessary;
5. use correct loading/error state;
6. add invalidation for mutations.

---

# 176. TESTING — UNIT

Unit-test:

- API client;
- error normalization;
- retry decision;
- query-key factories;
- query-param canonicalization;
- cache policy helpers where code exists;
- loader component;
- query hooks with mocked API where appropriate.

---

# 177. TESTING — INTEGRATION

Integration-test migrated feature behavior with QueryClient provider.

At minimum:

- Products query success/error/loading;
- Search query;
- Search suggestions;
- Category/Brand cache reuse;
- cancellation;
- retry policy;
- pagination key separation.

---

# 178. TESTING — E2E

Run focused browser scenarios:

A. Home → Products.

B. Products → Search.

C. Search live query.

D. Search suggestions.

E. Search → Products and verify shared reference data does not unnecessarily refetch where cache is fresh.

F. Error/retry controlled mock.

G. Route/page loader under intentionally delayed lazy/page response.

H. Background refetch keeps content.

I. reduced-motion loader behavior where browser support/test harness allows.

---

# 179. ELECTROHUBLOADER E2E

Use a controlled delay/mocked route to make loader observable.

Do not introduce real production delay.

Verify:

- appears;
- centered;
- accessible;
- disappears;
- no overlay remains;
- header/footer remain correct for chosen variant.

---

# 180. NETWORK INSPECTION

In browser/dev test:

verify:

- no duplicate category request when navigating Search ↔ Products during fresh cache;
- no duplicate same-key Product request in simultaneous consumers;
- stale Search query cancellation;
- no requests for disabled suggestions.

---

# 181. FAILURE TESTING

Test:

- backend 500;
- network failure;
- 404;
- 429;
- abort;
- malformed response if client guards it.

No raw internals shown.

---

# 182. LOADING TESTING

Test:

- loader;
- skeleton;
- inline action loader if a representative action is in scope;
- no empty-state flash;
- background refetch behavior.

---

# 183. RESPONSIVE

Verify Query/loader UI at:

```text
390
768
1440
1920
```

Loader centered.

Errors/Retry not overflow.

Skeletons remain responsive.

---

# 184. ACCESSIBILITY TESTING

Verify:

- `ElectroHubLoader` status;
- hidden label;
- reduced motion;
- error alert semantics;
- retry button;
- skeletons not noisy to screen readers.

---

# 185. PERFORMANCE EVIDENCE

Compare representative network behavior before/after where practical.

Do not require synthetic benchmark suite.

Evidence should show fewer duplicate requests and stable UI.

---

# 186. BROWSER MEMORY

No need for deep memory profiling, but verify Search cache strategy does not obviously grow without bound during a reasonable scripted sequence.

Use sensible `gcTime`.

---

# 187. ERROR RECOVERY

After failed query:

Retry should recover without full page refresh.

URL/user input must remain intact.

---

# 188. REFRESH BEHAVIOR

Refreshing browser on:

```text
/search?q=sony
/products?...filters...
```

must restore URL state and React Query fetch correctly.

Cache is not required to persist across full reload.

---

# 189. CACHE PERSISTENCE

Do NOT add:

- `persistQueryClient`;
- localStorage cache;
- IndexedDB cache;

unless explicitly separately approved.

---

# 190. SECURITY — CROSS USER

If any authenticated query is migrated, test:

user A cached data
→ logout
→ user B login
→ user B must not see A data.

Do not skip this if user-specific data is brought under React Query.

---

# 191. SECURITY — XSS

API errors/messages are text, not trusted HTML.

Do not use `dangerouslySetInnerHTML` for backend error messages.

---

# 192. SECURITY — URLS

API client should not allow arbitrary user-controlled absolute URLs where endpoint modules expect internal API paths.

Avoid becoming an SSRF-like generic proxy abstraction.

Frontend still runs client-side, but endpoint allowlisting through code is cleaner.

---

# 193. SECURITY — CREDENTIALS

Do not print/log:

- cookies;
- auth tokens;
- env secrets.

---

# 194. DOCUMENTATION UPDATES

Update current relevant docs only.

Likely:

- STATE_MANAGEMENT.md
- API_GUIDELINES.md if frontend client conventions belong there
- PRODUCTS.md where migrated query behavior needs mention
- SEARCH.md
- COMPONENTS/UI loading docs
- TESTING.md if common testing convention changes
- DECISIONS.md only if repository process requires documenting React Query adoption
- new task implementation report

Do not create duplicate documentation unnecessarily.

---

# 195. ADR REQUIREMENT

React Query may constitute a meaningful architectural decision.

Inspect current `DECISIONS.md`/ADR policy.

If React Query adoption is already approved by roadmap/docs:

- update existing decision docs as required;
- do not create unnecessary ADR.

If repository policy requires an ADR for new state-management library:

- create/update the appropriate ADR.

Do not silently introduce architectural dependency without documentation.

---

# 196. PACKAGE LOCK

If dependency added:

- update package manifest;
- update lockfile using current package manager;
- no unrelated lockfile churn;
- no manual lockfile editing.

---

# 197. BUILD

Frontend production build must pass.

No unresolved type errors.

No broken lazy imports.

No loader asset-path failures.

---

# 198. LINT

Lint changed surface.

Do not disable lint rules to make implementation pass unless rule exception is truly justified and documented.

---

# 199. TYPECHECK

Strict/current TypeScript check must pass.

No new `any` escapes around Query results/errors without justification.

---

# 200. TEST SUITE STRATEGY

Run focused tests while implementing.

Then one final relevant validation cycle.

Do not repeatedly run full repository test suites.

Do not random-bug-hunt unrelated domains.

---

# 201. DEFINITION OF DONE — ARCHITECTURE

- [ ] React Query installed/configured.
- [ ] One QueryClient.
- [ ] One central API client.
- [ ] Query key convention implemented.
- [ ] Feature query hooks implemented for approved scope.
- [ ] Components do not duplicate HTTP logic in migrated domains.
- [ ] URL state remains separate from server-state cache.
- [ ] Backend remains authoritative.

---

# 202. DEFINITION OF DONE — API CLIENT

- [ ] Base URL centralized.
- [ ] credentials preserved.
- [ ] JSON handling centralized.
- [ ] AbortSignal supported.
- [ ] structured errors normalized.
- [ ] non-JSON failures safe.
- [ ] 204 handling safe where applicable.
- [ ] no secret logging.
- [ ] query-string encoding safe.

---

# 203. DEFINITION OF DONE — QUERY CONFIG

- [ ] staleTime documented.
- [ ] gcTime documented.
- [ ] retry documented.
- [ ] refetch-on-focus documented.
- [ ] refetch-on-reconnect documented.
- [ ] feature overrides justified.

---

# 204. DEFINITION OF DONE — CACHE

- [ ] Product cache policy defined.
- [ ] Search cache policy defined.
- [ ] suggestions cache policy defined.
- [ ] Category/Brand cache policy defined.
- [ ] mutation invalidation convention defined.
- [ ] no sensitive persistent cache.
- [ ] no cross-user cache leakage where auth data migrated.

---

# 205. DEFINITION OF DONE — SEARCH/PRODUCT MIGRATION

- [ ] Products public reads use query hooks.
- [ ] Categories use shared query cache.
- [ ] Brands use shared query cache.
- [ ] Search Products uses React Query.
- [ ] suggestions use React Query.
- [ ] live Search still works.
- [ ] stale requests still safe.
- [ ] URL state preserved.
- [ ] filters/sort/pagination preserved.
- [ ] no Search regressions.

---

# 206. DEFINITION OF DONE — LOADING

- [ ] `ElectroHubLoader` exists.
- [ ] brand lightning/logo reused.
- [ ] page variant exists.
- [ ] size variants appropriate.
- [ ] role=status.
- [ ] hidden Loading text.
- [ ] reduced motion supported.
- [ ] route/page loading uses it where actually needed.
- [ ] skeletons remain for structured content.
- [ ] background refetch does not blank content.
- [ ] no artificial navigation delay.

---

# 207. DEFINITION OF DONE — ERRORS

- [ ] safe normalized API errors.
- [ ] request cancellation not shown as error.
- [ ] validation/404/401 not blindly retried.
- [ ] retry bounded.
- [ ] 429 safe.
- [ ] retry UX works.
- [ ] no raw backend internals shown.

---

# 208. DEFINITION OF DONE — TESTING

- [ ] API client tests.
- [ ] query-key tests.
- [ ] query-hook tests.
- [ ] retry tests.
- [ ] cache reuse tests.
- [ ] Search regression tests.
- [ ] Product/Category/Brand integration tests.
- [ ] ElectroHubLoader tests.
- [ ] focused E2E.
- [ ] typecheck pass.
- [ ] lint pass.
- [ ] build pass.
- [ ] `git diff --check` pass.

---

# 209. DEFINITION OF DONE — SECURITY

- [ ] no secrets exposed.
- [ ] auth cookie behavior preserved.
- [ ] no token localStorage migration.
- [ ] no sensitive persistent cache.
- [ ] user-specific cache reset on identity change if in scope.
- [ ] backend authorization unchanged.

---

# 210. DEFINITION OF DONE — DOCUMENTATION

- [ ] State management docs updated.
- [ ] API client conventions documented.
- [ ] query-key convention documented.
- [ ] cache policy table documented.
- [ ] loading policy documented.
- [ ] error/retry policy documented.
- [ ] migration guidance documented.
- [ ] implementation report created.

---

# 211. REQUIRED IMPLEMENTATION EVIDENCE

Final handoff must include:

1. branch;
2. HEAD;
3. dependency change;
4. QueryClient location;
5. API client location;
6. query-key factory location;
7. actual cache values;
8. retry rules;
9. migrated hooks;
10. removed direct fetch duplication;
11. Search regression results;
12. shared Category/Brand cache evidence;
13. request cancellation evidence;
14. loader screenshots/browser evidence;
15. reduced-motion evidence;
16. error-state evidence;
17. network duplicate-request evidence;
18. tests;
19. build;
20. lint/typecheck;
21. docs;
22. git status/diff/check.

---

# 212. RELEASE-BLOCKING CONDITIONS

Do NOT approve if any remain:

- multiple competing API clients;
- multiple QueryClients without justification;
- components still manually fetch same migrated data;
- cache keys collide;
- Search URL state broken;
- Search suggestions stale;
- cancellation ignored;
- 401 retry loop;
- sensitive user cache survives logout where migrated;
- raw backend errors shown;
- loader ignores reduced motion;
- branded loader replaces every skeleton unnecessarily;
- fake navigation delay introduced;
- React Query Devtools unintentionally shipped in PROD;
- auth security model changed without approval;
- DB migration introduced;
- Critical/High security issue;
- required tests failing.

---

# 213. IMPLEMENTATION SEQUENCE

Recommended order:

1. fresh repository/docs inspection;
2. inspect existing API/fetch/state patterns;
3. add compatible React Query dependency;
4. central API client cleanup/foundation;
5. error normalization;
6. query keys;
7. QueryClient config;
8. provider integration;
9. Product/Category/Brand query hooks;
10. Search query hooks;
11. migrate Search/Products consumers;
12. cancellation/retry/cache verification;
13. implement `ElectroHubLoader`;
14. route/page loading integration;
15. standardized error/loading patterns;
16. tests;
17. browser/network QA;
18. docs;
19. self-review;
20. architect handoff.

---

# 214. FINAL IMPLEMENTATION REPORT FORMAT

Return:

```text
# TASK 02.7 — STATE & API FOUNDATION IMPLEMENTATION REPORT

STATUS:
READY FOR INDEPENDENT ARCHITECTURAL REVIEW / REQUEST CHANGES / BLOCKED

BRANCH:
feature/State-API-Foundation

HEAD:
...

## REACT QUERY

PACKAGE/VERSION:
...

QUERYCLIENT:
<file>

PROVIDER:
<file>

DEVTOOLS:
NOT USED / DEV ONLY / details

## QUERY CONFIGURATION

DEFAULT staleTime:
...

DEFAULT gcTime:
...

RETRY:
...

RETRY DELAY:
...

REFETCH ON FOCUS:
...

REFETCH ON RECONNECT:
...

## CACHE POLICY

PRODUCTS:
...

CATEGORIES:
...

BRANDS:
...

SEARCH PRODUCTS:
...

SUGGESTIONS:
...

USER-SPECIFIC DATA:
...

PERSISTENT CACHE:
NO / details

## API CLIENT

CLIENT FILE:
...

BASE URL:
CENTRALIZED / FAIL

CREDENTIALS:
PASS / FAIL

ABORTSIGNAL:
PASS / FAIL

ERROR NORMALIZATION:
PASS / FAIL

204:
PASS / FAIL / NOT APPLICABLE

NON-JSON ERROR:
PASS / FAIL

SECRET LOGGING:
NONE / details

## QUERY KEYS

FACTORY FILE:
...

PRODUCTS:
PASS / FAIL

PRODUCT DETAIL:
PASS / FAIL

CATEGORIES:
PASS / FAIL

BRANDS:
PASS / FAIL

SEARCH:
PASS / FAIL

SUGGESTIONS:
PASS / FAIL

## MIGRATED QUERIES

PRODUCTS:
PASS / FAIL

CATEGORIES:
PASS / FAIL

BRANDS:
PASS / FAIL

SEARCH PRODUCTS:
PASS / FAIL

SEARCH SUGGESTIONS:
PASS / FAIL

AUTH/ME:
MIGRATED / NOT MIGRATED

DIRECT FETCH DUPLICATION REMAINING IN MIGRATED SURFACE:
NONE / details

## SEARCH REGRESSION

LIVE SEARCH:
PASS / FAIL

SUGGESTIONS:
PASS / FAIL

MM/SPEC SEARCH:
PASS / FAIL

RANDOM QUERY:
PASS / FAIL

FILTERS:
PASS / FAIL

SORT:
PASS / FAIL

PAGINATION:
PASS / FAIL

URL BACK/FORWARD:
PASS / FAIL

## CANCELLATION

SEARCH:
PASS / FAIL

SUGGESTIONS:
PASS / FAIL

ABORT ERROR SHOWN TO USER:
NO / YES

## CACHE REUSE

SEARCH ↔ PRODUCTS CATEGORY CACHE:
PASS / FAIL

SEARCH ↔ PRODUCTS BRAND CACHE:
PASS / FAIL

DUPLICATE SAME-KEY REQUESTS:
NONE / details

## RETRY

400:
NO RETRY / WRONG

401:
NO LOOP / WRONG

404:
NO RETRY / WRONG

429:
CONTROLLED / WRONG

5XX/NETWORK:
<policy>

## ELECTROHUBLOADER

COMPONENT:
<file>

BRAND LOGO/LIGHTNING:
PASS / FAIL

SPIN:
PASS / FAIL

PULSE:
PASS / FAIL

GLOW:
PASS / FAIL

SM:
PASS / FAIL

MD:
PASS / FAIL

LG:
PASS / FAIL

PAGE VARIANT:
PASS / FAIL

ROLE STATUS:
PASS / FAIL

LOADING LABEL:
PASS / FAIL

REDUCED MOTION:
PASS / FAIL

ARTIFICIAL NAVIGATION DELAY:
NONE / details

## LOADING POLICY

PAGE/ROUTE:
ElectroHubLoader / details

CONTENT:
Skeleton / details

BUTTON:
Inline / details

BACKGROUND REFETCH:
CONTENT PRESERVED / FAIL

## ERROR UX

QUERY ERROR COMPONENT:
<file / existing>

RETRY:
PASS / FAIL

RAW INTERNAL ERROR EXPOSURE:
NONE / details

EMPTY VS ERROR:
PASS / FAIL

## SECURITY

AUTH MODEL:
UNCHANGED / details

TOKENS IN LOCALSTORAGE:
NO / YES

SENSITIVE CACHE PERSISTENCE:
NONE / details

CACHE CLEAR ON LOGOUT IF APPLICABLE:
PASS / FAIL / NOT IN SCOPE

SECRETS LOGGED:
NONE / details

## TESTS

API CLIENT:
...

QUERY KEYS:
...

QUERY HOOKS:
...

CACHE:
...

RETRY:
...

SEARCH REGRESSION:
...

LOADER:
...

E2E:
...

TYPECHECK:
PASS / FAIL

LINT:
PASS / FAIL

BUILD:
PASS / FAIL

## RESPONSIVE / ACCESSIBILITY

390:
PASS / FAIL

768:
PASS / FAIL

1440:
PASS / FAIL

1920:
PASS / FAIL

LOADER A11Y:
PASS / FAIL

REDUCED MOTION:
PASS / FAIL

ERROR A11Y:
PASS / FAIL

## DATABASE

PRISMA CHANGE:
NONE / details

MIGRATION:
NONE / details

DEV/PROD DB WRITES:
NONE / details

## DOCUMENTATION

UPDATED:
- ...

CACHE POLICY TABLE:
YES / NO

QUERY KEY CONVENTION:
YES / NO

API CLIENT CONVENTION:
YES / NO

LOADING POLICY:
YES / NO

## GIT

git status --short:
...

git diff --stat:
...

git diff --check:
PASS / FAIL

## OUTSIDE SCOPE OBSERVATIONS

None
OR
- ...

## FINAL

CRITICAL:
NONE / ...

HIGH:
NONE / ...

READY FOR PRINCIPAL ARCHITECT REVIEW:
YES / NO

STOP.
DO NOT COMMIT.
DO NOT PUSH.
DO NOT MERGE.
DO NOT SELF-APPROVE.
```

---

# 215. FINAL PRINCIPLE

TASK 02.7 establishes one coherent frontend server-state architecture:

```text
UI
↓
React Query
↓
Central API Client
↓
Backend
```

React Query manages server state.

The router manages URL state.

React/local state manages UI-only state.

The backend remains authoritative for business/security state.

The cache improves speed; it does not become truth.

The central API client removes HTTP duplication; it does not become a business-logic layer.

Loading UX must be proportional to scope:

```text
Page/route wait
→ ElectroHubLoader ⚡

Structured content wait
→ skeleton

Button/action wait
→ inline indicator
```

The branded ElectroHub loader must improve identity and perceived polish without adding fake delays, visual noise, or replacing more appropriate loading patterns.
