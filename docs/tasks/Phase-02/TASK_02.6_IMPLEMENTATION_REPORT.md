# Task 02.6 — Search Foundation implementation handoff

## Working tree and boundaries

- Branch: `feature/search-foundation`.
- Unchanged HEAD: `704a872ddbaaeaf4cb3398cee9e8bc4fe8f0ce1f`.
- Local/uncommitted implementation; no commits, pushes, PRs or merges.
- Existing untracked `TASK_02.6_SEARCH_FOUNDATION.md` preserved.
- No database writes, migrations, seeds, schema changes, environment changes, PROD access or external email/OAuth operations.

## Implemented

- Public Search products/suggestions routes, strict query validation, AND token/filter matching, literal wildcard escaping and parameterized SQL.
- Database-side relevance ranking/count/page selection, repeatable-read bounded hydration and canonical Product Foundation summaries. Exact Decimal price strings, nullable legacy brands, deterministic images/availability remain compatible.
- Search page maximum 1,000 and pageSize maximum 100; Product Foundation page maximum tightened to 1,000 with an explicit boundary regression assertion.
- Scoped public search/suggestion rate limits, existing structured/sanitized error handling and OpenAPI contracts.
- Header Search navigation without expansion, preserving auth/cart/wishlist/navigation.
- URL-authoritative discovery, local typing draft, filters/sort/pagination, Back/Forward restoration, validation recovery, independent cancellation and stale-response guards.
- Debounced accessible combobox suggestions, keyboard selection/dismissal and non-blocking suggestion failures.
- Responsive Search shell, real category/brand options, canonical ProductCard reuse with Search-only hidden unimplemented actions, loading/error/empty recovery.
- Local-only image selection, drag/drop, replace/remove, filename fallback, revocable image previews; no upload or image matching.

## Verification actually executed

| Check | Result |
| --- | --- |
| Backend typecheck | PASS (`npm run typecheck`) |
| Backend lint/build | PASS (`npm run lint`, `npm run build`) |
| Backend scoped unit/API compatibility tests | PASS — 75 tests across 3 files |
| Frontend typecheck | PASS; strict `tsc -b` also passed in build |
| Frontend lint | PASS; scoped Search lint also passed after corrections |
| Frontend scoped component/consumer tests | PASS — 37 tests across Search, CustomerHeader and ProductCard |
| Final Search-only component check | PASS — 20 tests after the strict-build/native Enter corrections |
| Frontend build | PASS, with existing auth import/chunk-size warnings |
| Real DEV read API/browser suite | PASS — 6 Playwright scenarios |
| Four viewport flows | PASS — 390, 768, 1440 and 1920 px, height 1000 |
| Git whitespace diff | PASS (`git diff --check`) |
| Live Figma Design comparison | NOT VERIFIED |
| Remote GitHub CI | NOT RUN — local uncommitted task |

Commands:

```text
apps/backend:
npm run typecheck
npm run lint
npm run build
npx vitest run tests/search.test.ts src/services/__tests__/product.service.test.ts tests/product.api.test.ts --maxWorkers=1

apps/frontend:
npm run lint
npm run typecheck
npx vitest run src/features/search/search.test.tsx src/components/layout/CustomerHeader/CustomerHeader.test.tsx src/components/ui/ProductCard/ProductCard.test.tsx
npx vitest run src/features/search/search.test.tsx
npx eslint src/features/search src/components/ui/SearchField src/components/ui/FilterControls tests/search playwright.search.config.ts
npm run build
npx playwright test --config playwright.search.config.ts
```

The final real API scenario exercised multi-token/name/model/SKU discovery, category/brand/availability AND filters, price range/sort, invalid parameters, hostile query text and bounded suggestions. UI scenarios exercised header keyboard navigation, suggestions, manual Enter search, history/filter restoration, empty recovery, local file selection/removal, no image requests and document-width overflow checks. Controlled browser mocks verified safe unexpected-error presentation and stale response behavior; these mocks are not evidence of real database matching.

## Failures diagnosed and corrected

1. Initial real Search HTTP 500: Prisma's default interactive transaction lifetime expired during remote DEV connection startup (`P2028`). The bounded read-only transaction now uses maxWait 10 seconds / timeout 30 seconds; real API checks returned 200 afterward. No TLS bypass or database/configuration change.
2. Native Enter was ignored while the sole submit button was disabled by an in-flight search. A changed draft can now submit and cancel the previous request; identical duplicate submissions remain blocked. Component/browser regression evidence passes.
3. Strict frontend build found unchecked array access and unsupported test-query options that the package's no-project typecheck command did not expose. Corrected those new Search errors; strict build passed.
4. Windows sandbox prevented esbuild config access. Focused tests/build were run with approved execution outside that restriction.
5. Existing local frontend/backend servers stopped during verification. Restored each once using its existing dev script; direct and proxied auth/me returned the expected unauthenticated 401. No proxy/auth behavior changes.
6. Concurrent browser/build work caused mocked API test timeout failures. Final focused backend tests ran serially and passed without weakening assertions. The 120-request throttle test has a bounded 15-second test budget; production limits are unchanged.

## Visual evidence and limitations

All five supplied source screenshots were inspected. Browser captures for initial, populated, empty and image states are under ignored `apps/frontend/test-results/search-real-Search-UI-*/`; focused final desktop spacing captures are under `test-results/search-polish/`. Images were visually inspected at mobile/tablet/desktop sizes.

Verified structural composition: breadcrumb/heading, underline tabs, square search controls, focus ring, neutral chip/filter surfaces, bounded sparse result cards, aligned footer container and dashed local-image dropzone. No horizontal overflow in the four tested viewport flows. Visual review corrected footer alignment, search-button typography and separation of empty-state recovery actions.

Differences intentionally retained: the existing customer header/announcement and shared ProductCard typography; real 02.5 product metadata and project-owned media rather than screenshot sample photographs/ratings/prices; additional required price/brand/availability controls. The prototype switcher is excluded. This is **not** a pixel-perfect/live Figma approval or an exhaustive accessibility audit.

## Changed implementation files

Backend:

```text
apps/backend/src/controllers/search.controller.ts
apps/backend/src/docs/swagger/openapi.ts
apps/backend/src/docs/swagger/product.openapi.ts
apps/backend/src/docs/swagger/search.openapi.ts
apps/backend/src/routes/index.ts
apps/backend/src/routes/search.routes.ts
apps/backend/src/services/__tests__/product.service.test.ts
apps/backend/src/services/product.service.ts
apps/backend/src/services/search.service.ts
apps/backend/src/services/search.sql.ts
apps/backend/src/validators/product.validator.ts
apps/backend/src/validators/search.validator.ts
apps/backend/tests/search.test.ts
```

Frontend:

```text
apps/frontend/playwright.search.config.ts
apps/frontend/src/components/layout/CustomerHeader/CustomerHeader.module.scss
apps/frontend/src/components/layout/CustomerHeader/CustomerHeader.test.tsx
apps/frontend/src/components/layout/CustomerHeader/CustomerHeader.tsx
apps/frontend/src/components/ui/FilterControls/FilterControls.module.scss
apps/frontend/src/components/ui/FilterControls/FilterControls.tsx
apps/frontend/src/components/ui/ProductCard/ProductCard.tsx
apps/frontend/src/components/ui/SearchField/SearchField.module.scss
apps/frontend/src/components/ui/SearchField/SearchField.tsx
apps/frontend/src/features/search/ImageSearchShell.tsx
apps/frontend/src/features/search/SearchPage.module.scss
apps/frontend/src/features/search/SearchPage.tsx
apps/frontend/src/features/search/api.ts
apps/frontend/src/features/search/search.test.tsx
apps/frontend/src/features/search/searchState.ts
apps/frontend/src/routes/index.tsx
apps/frontend/tests/search/search.spec.ts
```

Documentation:

```text
docs/05_Features/PRODUCT_API_02.5.md
docs/05_Features/SEARCH.md
docs/tasks/Phase-02/TASK_02.6_IMPLEMENTATION_REPORT.md
```

## Scoped self-review / remaining limitations

Task boundaries, canonical Product compatibility, SQL parameterization/allowlisted ordering, visibility, nullable relations, cancellation, URL validation, error sanitization and generated-artifact exclusion reviewed. No new dependencies, schema changes, credentials, debug logging or later-phase features introduced. Current files contain no environment edits; build/test artifacts remain ignored.

DEV verification is through actual read APIs, not an independent schema/ledger audit. No production or Supabase schema state is claimed. Query-plan/load benchmarking was not performed; ordinary case-insensitive substring SQL remains a foundation approach whose scaling should be reviewed against future catalog size. The 30-second transaction bound does not promise low latency. Full repository tests, full E2E matrix, live Figma and remote CI were deliberately not run.

Decision: implementation is ready for the separately requested architectural review; no commit or push performed.
# Final Search consistency correction

Product suggestions and result search previously used different predicates: suggestions matched product names, while results matched the documented product/catalog fields. The shared result predicate now additionally checks ProductSpecification group, name, and value through correlated parameterized `EXISTS`, preventing duplicate products and avoiding specification hydration. PRODUCT suggestions now use this same predicate. Query matching retains the short-token boundary behavior: short alphabetic terms can match measurement values such as `40mm`, while accidental mid-word matches such as `tt` within `battery` remain excluded. The existing result DTO stays unchanged.

The customer Search/Product discovery surfaces use square corners. Search inputs use compact control heights, the `/search` Sort field has a token-based gap, and the `/products` filter panel spans the content width with a four-column desktop control row and Reset/Apply actions together at the panel end. Shared Select changes are opt-in, and ProductCard square styling is opt-in for Search/Product discovery so other consumers are unaffected.
