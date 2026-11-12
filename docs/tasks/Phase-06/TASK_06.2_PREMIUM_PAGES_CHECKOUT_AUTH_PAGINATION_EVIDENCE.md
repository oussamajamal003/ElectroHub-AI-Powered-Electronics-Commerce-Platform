# Task 06.2 — premium pages, checkout skeletons, secure OTP and cursor pagination: evidence

This report records implementation and locally observed evidence for six work packages (A About, B Contact, C Product
Details, D Checkout skeletons + scroll restoration, E OTP eligibility, F catalog pagination). It is not an approval, does not
mark the Phase 06.2 roadmap complete, and makes no deployment or production claim. Every result below was actually observed;
anything not run is marked **NOT VERIFIED**.

## 1. Starting branch and SHA

| Item | Value |
|---|---|
| Branch | `feature/06.2-premium-pages-checkout-auth-pagination` (new, isolated worktree) |
| Base | `origin/feature/06.2-accessibility-qa-ci-cd` at `9e506557b3f84049e4c1fdf27d2abe39e1055159` ("docs(quality): record native zoom, browser QA and performance evidence") |
| PR target | `feature/06.2-accessibility-qa-ci-cd` (new PR; nothing pushed to the shared branch) |

## 2. Relevant existing PR overlap (parallel agents)

Open PRs into the same base were compared file by file with `gh pr diff <n> --name-only` against this change set. None of their
commits were pulled in or overwritten; whichever lands second must resolve the overlaps below.

| PR | Overlapping files | Nature |
|---|---|---|
| #55 motion/contact/alerts/cart | `AboutPage.tsx`, `ContactPage.tsx`, `CompanyPages.module.scss`, `CompanyPages.test.tsx`, `ProductDetailPage.tsx/.module.scss/.test.tsx`, `SearchPage.tsx`, `schema.prisma` | Highest risk: both touch About/Contact layout and the review textarea. Text-level conflicts expected. |
| #52 premium dark mode | `Checkout.module.scss`, `SearchPage.module.scss`, `CompanyPages.module.scss`, `ProductDetailPage.module.scss` | Dark tokens will need to be applied to the new skeleton, description, review-summary and contact-card rules. |
| #54 branding/toasts | `AuthModal.tsx`, `ContactPage.tsx`, `ProductDetailPage.tsx` | Small text-level overlap. |
| #58 email validation | `AuthModal.tsx`, `ContactPage.tsx` | Small text-level overlap. |
| #61 payment/inventory | `ProductDetailPage.module.scss`, `ProductDetailPage.test.tsx` | Append-only on both sides; likely trivial. |
| #57, #59, #60 | `schema.prisma` | Each adds unrelated models/fields; this branch adds one `@@index` line. |

## 3. Files changed

**Backend**
- `prisma/schema.prisma`, `prisma/migrations/20261114000000_catalog_price_keyset_index/migration.sql` (new)
- `src/services/catalog-cursor.ts` (new), `src/services/search.service.ts`, `src/services/review.service.ts`, `src/services/auth.service.ts`
- `src/controllers/search.controller.ts`, `src/controllers/product.controller.ts`, `src/controllers/auth.controller.ts`, `src/controllers/admin-security.controller.ts`
- `src/validators/product.validator.ts`, `src/validators/search.validator.ts`, `src/validators/review.validator.ts`
- `src/middleware/rateLimiter.ts`, `src/routes/auth.routes.ts`
- `src/docs/swagger/product.openapi.ts`, `src/docs/swagger/search.openapi.ts`
- Tests: `src/services/catalog-cursor.test.ts`, `src/services/catalog-pagination.postgres.integration.test.ts`, `src/services/__tests__/auth.otp-eligibility.test.ts`, `src/services/__tests__/review.summary.test.ts`, `src/routes/auth.otp-rate-limit.test.ts` (all new); `src/services/__tests__/product.service.test.ts`, `tests/review.test.ts`, `tests/search.test.ts` (updated to the new additive contracts)
- Tooling: `scripts/catalog-pagination-pg.cjs`, `vitest.catalog-pagination-pg.config.mts` (new; disposable PostgreSQL only)

**Frontend**
- About/Contact: `src/pages/AboutPage.tsx`, `src/pages/ContactPage.tsx`, `src/pages/CompanyPages.module.scss`, `src/pages/CompanyPages.test.tsx`, `public/images/about/` (36 images + README)
- Product Details: `src/pages/customer/ProductDetailSections.tsx` (new), `ProductDetailPage.tsx`, `ProductDetailPage.module.scss`, `ProductDetailPage.test.tsx`, `src/components/ui/Rating/Rating.tsx` (+ test), `src/features/products/types.ts`, `src/features/products/queries.ts`
- Checkout: `src/features/checkout/CheckoutComponents.tsx`, `CheckoutPage.tsx`, `Checkout.module.scss`, `CheckoutSkeleton.test.tsx` (new)
- Scroll: `src/layouts/CustomerScrollRestoration.tsx` (+ test)
- Pagination: `src/features/search/SearchPage.tsx`, `SearchPage.module.scss`, `api.ts`, `queries.ts`, `searchState.ts`, `search.test.tsx`
- Auth copy: `src/features/auth/components/AuthModal.tsx`
- Browser QA: `playwright.task06-2-premium.config.ts`, `tests/visual/task06-2-world.helper.ts`, `task06-2-premium-pages.spec.ts`, `task06-2-checkout-skeletons.spec.ts`, `task06-2-scroll-restoration.spec.ts` (new)

**Docs/evidence**: this file and `docs/tasks/Phase-06/evidence/TASK_06.2_catalog-pagination-benchmark.json`.

## 4. About Us UI changes (WP A)

- Dark hero with a 2×2 product mosaic, a "Who we are" story block with an image, "What we offer" cards, an "Across the range"
  image grid (monitors, tablets, gaming, accessories), "What we stand for" cards, and a CTA band. Copy describes only real
  platform behaviour (factual product pages, real reviews, Stripe-handled card data, delivery price before payment). It has no
  invented statistics, awards, founding dates, team members or testimonials.
- Motion reuses the existing `SectionReveal`/`StaggerContainer` (one-shot `IntersectionObserver`). Sections reveal once and do
  not replay on scroll-up/down. Under `prefers-reduced-motion: reduce` content is visible immediately with no scroll animation.
- Images use `<picture>` with AVIF first and a WebP fallback, explicit `width`/`height`, `srcset`/`sizes`, priority loading for
  the first two hero tiles, lazy loading below the fold, and descriptive alt text.

## 5. Generated image asset paths and provenance

`apps/frontend/public/images/about/{laptop,laptop-closed,headphones,smartwatch,smartphone,monitor,tablet,console,charging-dock}-{480,800}.{avif,webp}` (36 files, about 385 KiB in total).

They are re-encoded derivatives (Pillow 12.3, Lanczos; AVIF q55, WebP q80) of the project's own unbranded studio photographs in
`public/images/catalog/`, which were AI-generated for ElectroHub in Task 03.1. **No new images were generated for this task**,
and no stock, third-party or manufacturer imagery is used. The provenance table is in `public/images/about/README.md`.

## 6. Contact layout changes (WP B)

- The empty band beside "Contact information / We're here to help" is gone. The intro now sits directly under its heading
  (browser-asserted gap of 0–32 px at 390/1024/1440).
- Email, Phone and Location render as cards with icon chips, **only from configured `/api/store/profile` values**. A method that
  is not configured is omitted, never filled with placeholder data.
- When nothing is configured, a dashed "Send us a message" empty state points to the form (browser-verified at 390 and 1440).
- The form, its fields, validation and the backend contact contract are unchanged.

## 7. Product Description changes (WP C)

`ProductDescriptionPanel` (`ProductDetailSections.tsx`) has two parts.

**Description body**
- The stored description is split on blank lines into paragraphs.
- It is rendered as React text only, so markup is never interpreted. A unit test feeds `<img onerror>`/`<script>` and asserts
  the text is literal.
- An empty description shows "No description is available."

**"At a glance" aside**
- Category, SKU, and Brand/Model only when present.
- Up to four specification items taken verbatim from `product.specifications`, plus "N more in the Specifications tab."
- No spec, value or claim is invented.

## 8. Customer Reviews changes (WP C)

**Backend**
- `reviewSummary` now returns `distribution: [{rating, count}]` for 5…1 from a `groupBy` over approved, visible reviews.
- This is additive; `averageRating` and `reviewCount` are unchanged and documented in `product.openapi.ts`.

**Frontend `ReviewSummaryCard`**
- Shows the average, stars, and "Based on N review(s)".
- Distribution bars render **only** when the server sent five rows whose counts sum to `reviewCount`. Bars are never estimated
  from the average.
- Each row has an accessible text alternative ("5 stars: 3 reviews, 50%"), and the visual bars are `aria-hidden`.
- With no reviews it shows "No ratings yet".

**Review form**
- Placeholder "Share your experience with this product...".
- `maxLength` 2000 and `required` are preserved.
- Review eligibility rules are unchanged; the backend still has no purchase requirement.

**Visual vocabulary**: the cards reuse Contact's icon-chip and border/shadow treatment.

## 9. Checkout skeleton state mapping (WP D)

| Real state | Before | After |
|---|---|---|
| Session not yet verified / draft owner mismatch | full-page `ElectroHubLoader` | `CheckoutSkeleton step={step}` |
| Cart query loading | full-page loader | `CheckoutSkeleton step={step}` |
| Cart query failed | error + Retry | unchanged (never a skeleton; browser-asserted) |
| Delivery quote loading (Delivery step) | existing `DeliverySkeleton` | unchanged, browser-asserted to disappear when options arrive |
| Review step before the delivery quote is available | inline loader | `ReviewSkeleton` inside the "Review Your Order" panel |
| Payment element mounting | existing `PaymentSkeleton` | reused inside `CheckoutSkeleton` for the Payment step |

How the skeleton is built:
- The skeleton mirrors the target step: Shipping form fields in the same order and spans, delivery option rows, payment
  fields, or review cards.
- It also renders the stepper with the active step and an Order Summary placeholder.
- The skeleton itself is `aria-hidden`; a polite `role="status"` region announces "Loading checkout…".

Not changed: payment authority, Stripe flow and order logic.

## 10. Scroll restoration root cause and solution (WP D)

**Root cause.** On Back (POP), `CustomerScrollRestoration` scrolled to the saved position immediately. The target route was
often still a short loader (lazy chunk or pending data), so the browser clamped the scroll to the bottom of that short page. The
clamped value was then recorded over the real one. Visitors therefore landed at the bottom of Cart, Wishlist or Product pages.

**Fix (single scroll authority).**
- **PUSH and first visit** start at the top.
- **POP** restores, but waits until the document is tall enough. Up to 4 s it holds at the top of the loading page instead of
  its clamped bottom.
- **Nothing is recorded while a restore is pending.**
- **Any wheel, touch, key or pointer input** cancels a pending restore.
- **REPLACE** (filter URL rewrites) keeps the position.
- **Payment entry and recovery routes** always start at the top.
- **Persistence.** Positions are mirrored to `sessionStorage` by history-entry key, capped at 60 entries, numbers only, so Back
  restores after a full reload too. A freshly typed URL always starts at the top; restore-on-first-render happens only for a
  Navigation Timing `reload` or `back_forward`.

**Evidence.** The browser journeys in `task06-2-scroll-restoration.spec.ts` (5/5 pass) and the unit tests in
`CustomerScrollRestoration.test.tsx` cover:
- Product→Cart and Product→Wishlist→Back;
- Catalog→Product→Back;
- Back into a still-loading page;
- deep position → short page.

## 11. OTP vulnerability root cause (WP E)

Login was already password-first: no login OTP is sent before the password is proven. The defects were in the public,
unauthenticated OTP endpoints and in timing.

1. **`POST /api/auth/resend-verification`** found a live `EMAIL_VERIFICATION` challenge by email alone and re-sent it. It did not
   check the account's state. A suspended account, an administrator address, or a stale primary address after a
   verification-email correction could therefore receive codes.
2. **`resendPasswordReset`** had no audience check. The customer resend endpoint could re-deliver an **administrator** recovery
   code, and the reverse was also possible.
3. **`POST /api/auth/verify-email`** had no per-IP limiter. Brute force was bounded only per challenge (5 attempts), and a resend
   reset that counter.
4. **Login timing.** An unknown or inactive address returned before any bcrypt comparison. Response time therefore revealed
   which addresses had accounts.

## 12. Login vs registration flow security distinction

| Flow | Eligibility now enforced (service layer) | Response to ineligible requests |
|---|---|---|
| Login | Password first. Unknown/inactive accounts spend a bcrypt comparison against a discarded-secret hash of equal cost. An unverified CUSTOMER with the **correct** password reuses its live challenge for its own address. ADMIN still gets only the restricted MFA transaction. | Generic "Invalid credentials"; no challenge, no mail |
| Resend registration verification | Active, unverified CUSTOMER whose current destination (`pendingEmail` or `email`) equals the address and which owns a live challenge for exactly that user and destination | Byte-identical generic acknowledgement "If this email address is eligible, a verification code will be sent." Nothing is created or sent. Cooldown, consumed and locked challenges are indistinguishable. |
| Password reset request / resend | Active account of the matching audience (`CUSTOMER` on the customer endpoint, `ADMIN` on admin recovery) | Generic acknowledgement; nothing created or sent |
| Verify email | Per-IP `verifyEmailRateLimiter` (30 / 15 min) added on top of the per-challenge 5-attempt lock | 429 `RATE_LIMITED` before the handler |

Unchanged: OTP expiry and replay protection (codes are consumed once), the existing `resendVerificationRateLimiter` (10 per
window), the delivery-failure 503 contract for an eligible account, and admin MFA. No test OTP is hard-coded and no rate limit
is bypassed. All OTP tests mock the email service, so no real email is sent.

The UI change is limited to the reset-verify copy in `AuthModal`, which now reads "If <masked> is eligible, a 6-digit
verification code will be sent." so it no longer confirms that an account exists.

## 13. Pagination validator cap

- `paginationSchema` caps `page` at **100** (was 1000) and `pageSize` at **100**.
- Values must be digits only, at most 15 digits, so nothing large is multiplied into an offset before the cap is checked.
- The worst-case offset is therefore 9,900 rows.
- `page > 100` returns **400 `PAGE_LIMIT_EXCEEDED`**, with a message pointing to `paginate=cursor`; no SQL runs (asserted:
  `$queryRaw` not called). Other malformed values remain 400 `VALIDATION_ERROR`.
- **Contract note:** `page` 101–1000 previously returned 200. This is a deliberate breaking narrowing. The only first-party
  consumer (SearchPage) now clamps to 100 and continues with cursors.

## 14. Cursor schema and ordering contract

- **Opt-in.** `GET /api/search/products?paginate=cursor` returns the first page; `&cursor=<opaque>` continues.
- **Response meta.** It adds `hasNextPage` and `nextCursor`. Offset responses also gain `hasNextPage`/`nextCursor: null`, which
  is additive.
- **Cursor format.** `base64url(JSON{v, s, k, f}) "." base64url(HMAC-SHA256)`. `k` holds the last row's seek values as database
  text (`timestamp(3)::text`, `numeric::text`, uuid). `f` is a fingerprint of the filters plus sort.
- **Signing key.** The HMAC key is derived from the existing `JWT_SECRET` with a domain-separation label
  (`electrohub:catalog-cursor:v1`), so no new secret or environment variable is introduced. Cursors carry only public product
  attributes.
- **Reviews endpoint.** Review list pagination is capped at page 100 by the same rule (`review.validator.ts`).
- **Rejections.** Tampering, version mismatch, or reuse with different filters/sort returns a clean 400. `category-mix` (a window
  round-robin with no row-local key) returns `CURSOR_UNSUPPORTED_SORT` and remains bounded-offset only.
- **Orderings.** They are identical to the offset path, and every column is NOT NULL:

| Sort | ORDER BY |
|---|---|
| newest | `createdAt DESC, id ASC` |
| price-asc | `price ASC, createdAt DESC, id ASC` |
| price-desc | `price DESC, createdAt DESC, id ASC` |
| name-asc | `name ASC, id ASC` |
| relevance | `rank(q) ASC, createdAt DESC, id ASC` |

- **Frontend.** After page 100, SearchPage offers "Load more" through `useSearchContinuation` (`useInfiniteQuery`). Its key
  includes the full search state, so any filter change discards stale cursors.
- **Real PostgreSQL integration.** `catalog-pagination.postgres.integration.test.ts`, run through
  `node scripts/catalog-pagination-pg.cjs` on a freshly provisioned loopback cluster, verifies:
  - full traversal for every keyset sort has no duplicates and no skips and equals a plain SQL `ORDER BY` oracle, including
    price/createdAt ties;
  - offset→cursor continuity;
  - filter and sort mismatch rejection.

## 15. Database indexes / migrations

- Migration `20261114000000_catalog_price_keyset_index` adds `products_price_createdAt_id_idx`
  (`price, createdAt DESC, id`). It is mirrored in `schema.prisma` as `@@index([price, createdAt(sort: Desc), id])`.
- It is additive, with no data change.
- It is a plain `CREATE INDEX`: it takes a SHARE lock on `products` while building. The table is small today, but it should be
  applied in a low-traffic window, and the migration header explains this.
- It was applied **only** to the disposable benchmark cluster. No DEV/PROD migration was run.

## 16. Performance results (disposable PostgreSQL 18.1, 200,000 products, median of repeated EXPLAIN ANALYZE runs)

Raw data: `evidence/TASK_06.2_catalog-pagination-benchmark.json`.

| Query | Without new index | With `products_price_createdAt_id_idx` |
|---|---|---|
| catalog price-asc, page 1 | 333.5 ms (Seq Scan + Sort) | **0.203 ms** (Index Scan) |
| catalog price-asc, keyset after row 9,900 | 218.4 ms | **0.485 ms** |
| catalog price-asc, offset page 100 | 290.9 ms | 7.0 ms |
| catalog price-desc, keyset after row 9,900 | 231.5 ms | **1.008 ms** |
| catalog newest, old cap offset 99,900 | 198.0 ms | 195.0 ms (now unreachable: page cap) |
| catalog newest, keyset after row 9,900 | 0.205 ms | 0.221 ms |
| category newest, offset page 100 | 217.3 ms | 133.3 ms |
| category newest, keyset after row 9,900 | 0.192 ms | 0.223 ms |
| category price-asc, keyset after row 9,900 | 274.2 ms | **0.457 ms** |
| catalog name-asc, keyset after row 9,900 | 228.8 ms | 158.7 ms (index does not cover name) |

Conclusions:
- Keyset pages stay sub-millisecond for newest and price sorts at any depth.
- The page cap removes the 200–580 ms deep-offset queries.
- `name-asc` and deep **offset** pages inside a category remain in the 130–200 ms range at 200k rows; see Risks.

## 17. Actual tests and pass/fail counts

| Command | Result |
|---|---|
| `npm run typecheck` (frontend; app + `tsconfig.quality.json` incl. Playwright specs) | Pass |
| `npm run lint` (frontend) | 0 errors, 3 pre-existing React Refresh warnings |
| `npx vitest run` (frontend, full) | **1440 / 1440 passed** |
| `npm run build` (frontend) | Pass (pre-existing large-chunk / Sass deprecation warnings) |
| `npm run lint` (backend) | Pass |
| `npx tsc --noEmit` / `npm run build` (backend) | Pass |
| Backend targeted: catalog-cursor, auth.otp-eligibility, auth.otp-rate-limit, review.summary, product.service (35), `tests/review` + `tests/search` (43) | All passed |
| Backend full `npx vitest run` (local, no disposable PG, no payment mutations) | 2140 tests: 1837 passed, 266 failed, 37 skipped; 70/505 suites failed. Every failing file is outside this change set except `catalog-pagination.postgres.integration.test.ts`, which must run under its own disposable runner (next row). Causes: 39 suites stop on `DATABASE_TARGET_UNAPPROVED`; payment route/service suites get the `PAYMENT_MUTATIONS_DISABLED` 503 guard and the state assertions that follow from it; `logging-continuity` hits a stack-trace error. Not baseline-compared locally; CI's disposable-PG jobs are the authority. |
| `node scripts/catalog-pagination-pg.cjs` (disposable PG 18.1, fresh loopback cluster) | **12 passed, 1 skipped** (the `--bench` benchmark block); the benchmark JSON above came from a `--bench` run |
| `PREMIUM_CHROMIUM_CHANNEL=chrome npx playwright test -c playwright.task06-2-premium.config.ts` | **21 / 21 passed** (Chrome, one worker, retries 0) |

The task06-2 Playwright suite breaks down as:
- checkout skeletons 4;
- premium pages 12, made up of:
  - 3 pages × 6 widths × light/dark;
  - dark-preference contradiction;
  - Contact empty state;
  - Contact gap;
  - PDP reviews/description;
  - reveal-once;
  - reduced motion;
- scroll restoration 5.

**QA harness defect found and fixed during verification.** The first green run produced About screenshots with blank sections.
There were three causes:
1. The step-wise scroller used `window.scrollTo(x, y)`, which the global `scroll-behavior: smooth` turned into interrupted
   smooth scrolls, so reveal sections never intersected.
2. It measured the page height once, while lazy images grow it.
3. The reveal-once check counted the sticky header's CSS transitions and the infinite CTA pulse as "replays".

The helper now scrolls with `behavior: 'instant'`, waits two frames per step and re-reads the height. `settle()` additionally
asserts that no `main` heading sits inside an `opacity < 1` wrapper, so a blank-section screenshot can no longer pass. The
reveal check counts only finite keyframe animations plus `animationstart` events. The product code was not changed for this.

## 18. Browser screenshots / QA

Screenshots are written to `apps/frontend/test-results/task06-2-evidence/` (git-ignored build output, regenerated by the
command above):
- `{about,contact,pdp}-{320,390,768,1024,1440,1920}-{light,dark}.png`
- `contact-empty-{390,1440}.png`
- `pdp-reviews-{390,1440}.png`
- `checkout-skeleton-{shipping-390,shipping-1440,delivery-1280}.png`, `checkout-loaded-shipping-{390,1440}.png`

These were inspected by eye:
- About 1440: all sections visible after the harness fix.
- Contact 1440: cards, no gap.
- Contact empty 390.
- PDP reviews 1440: summary 4.5 and the 3/3/0/0/0 distribution.

Every width asserts no horizontal overflow.

Observations, not caused by this change:
- In the PDP full-page capture the focused skip link and the sticky header appear mid-page. These are full-page capture
  artefacts.
- The mocked world returns the same rail twice ("More in Phones").

**Dark mode contradiction.** The task asks for light and dark verification, but on this base the storefront is light-only
(compile-time SCSS colours, no `prefers-color-scheme` rules). A dedicated test proves that a dark OS preference leaves the body
background and text unchanged. Full dark mode is being delivered separately in PR #52, which will need to style the new
components. Dark-theme rendering of these pages is therefore **NOT VERIFIED** (it does not exist on this base).

**Figma.** The Figma Design / Make sources were **NOT VERIFIED** in this task (no Figma inspection was performed). Visual
decisions reuse existing repository tokens and components.

## 19. Accessibility evidence

- axe-core (`wcag2a`, `wcag2aa`, `wcag21aa`) runs on About, Contact and PDP at all six widths in both schemes, on the Contact
  empty state, and on the PDP reviews tab. **No violations** (soft assertions; per-run JSON is attached to the Playwright
  results).
- Semantics are covered by unit and browser assertions:
  - landmark/labelled regions ("Product Description", "At a glance" complementary);
  - the rating distribution list with screen-reader text;
  - the skeleton `role="status"`;
  - reduced-motion visibility;
  - textbox labels.
- Engines: **Chromium (installed Chrome channel) VERIFIED**. **Firefox and WebKit NOT VERIFIED locally**: their Playwright
  browsers are not installed on this machine. The config supports `PREMIUM_BROWSERS=chromium,firefox,webkit`. CI's per-engine
  release/quality jobs run the existing suites, not these task06-2 specs.

## 20. CI status

Recorded after the PR is opened; see the PR checks. Local equivalents of the CI jobs (frontend typecheck/lint/unit/build,
backend lint/typecheck/build) pass as listed above. The backend `test:ci` job and the payment-PG job need CI's disposable
PostgreSQL, which is not available locally.

## 21. Remaining material risks

1. **Merge conflicts with PR #55** (About/Contact/PDP), and dark-mode styling of the new components when PR #52 lands.
2. **`page` 101–1000 now returns 400 `PAGE_LIMIT_EXCEEDED`.** Any external client that deep-links past page 100 must switch to
   `paginate=cursor`.
3. **`name-asc` sorting** (all depths) and **deep offset pages within a category** cost about 130–230 ms at 200k rows. The
   current catalog is far smaller. A `(name, id)` index or a category-scoped composite index should be evaluated if the catalog
   grows.
4. **Migration lock.** `CREATE INDEX` (not `CONCURRENTLY`, because Prisma migrations run in a transaction) briefly blocks writes
   to `products` during DEV/PROD application.
5. **Unverified engines and theme.** Firefox/WebKit and real dark-theme rendering are not verified locally.
6. **Backend tests not runnable locally.** The suites that require the disposable CI PostgreSQL or enabled payment mutations
   fail locally on their environment guards; they are only verifiable in CI.

## 22. Final commit SHA

Implementation head: `1bd399381430eaf2ab530b927904bb3a4f8e8259` (six focused commits on top of `9e50655`). Later commits
on this branch only add this report. The PR's current head is the final-SHA authority.

## 23. PR URL

PR_URL
