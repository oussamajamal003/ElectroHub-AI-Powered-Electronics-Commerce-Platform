# Task 06.1 — Automated Testing, E2E, API, Integration & Cross-Browser Verification

Roadmap: `docs/01_Project Foundation/ROADMAP.md` §06.1. Branch: `feature/06.1-automated-e2e-cross-browser-testing` (base `develop` @ `095cea4`).
Evidence: [TASK_06.1_IMPLEMENTATION_EVIDENCE.md](TASK_06.1_IMPLEMENTATION_EVIDENCE.md).

## 1. Scope

Implement and verify unit, integration, API and E2E tests; run the release-critical Playwright journeys on Chromium, Firefox and
WebKit and at 390 / 768 / 1440 / 1920 px; wire a bounded release suite into CI. Out of scope: production deployment, production
data, real charges, live provider configuration, accessibility certification (Task 06.2).

## 2. What was built

### 2.1 Hermetic release stack (no shared database, no provider credentials)

| Piece | File | Role |
|---|---|---|
| Disposable PostgreSQL (local) | `apps/backend/scripts/release-e2e-db.cjs` | Local mirror of `.github/actions/disposable-postgres`: pinned `pgvector/pgvector:0.8.0-pg17`, tmpfs data, per-run CA + server certificate, random password, loopback port 55436, database `electrohub_ci`. `start` / `stop` / `status`. |
| Stack runner | `apps/backend/scripts/release-e2e-stack.cjs` | Refuses any non-loopback or non-`electrohub_(disposable\|ci)*` target, runs the real `prisma migrate deploy`, seeds fixtures, starts the real backend (`src/bootstrap.ts`) on :5206 with `NODE_ENV=test`, `ELECTROHUB_ENV_FILES=none` and per-run random JWT / OTP / MFA secrets. No Stripe, Brevo, Google or AI configuration exists in this process. |
| Fixtures | `apps/backend/scripts/fixtures/release-e2e-seed.ts` | Six catalog products (in stock, low stock, out of stock), one shopper per browser project × spec family, an outsider, an Owner + staff administrator per project. Every start resets carts, wishlists, refresh tokens and admin MFA enrollment and adds one paid, CONFIRMED (untracked) order per shopper. |
| Hermetic env opt-out | `apps/backend/src/config/env.ts` (`selectEnvFiles`) | `ELECTROHUB_ENV_FILES=none` loads no `.env*` file, so a developer's local DEV/PROD URLs can never leak into the release stack. Only that exact value opts out; unit-tested in `tests/env.test.ts`. |
| Playwright config | `apps/frontend/playwright.release.config.ts` | Starts the stack and Vite (:3206 → :5206) as `webServer`s; six projects (below); JSON + HTML reports, traces and screenshots on failure. |

Email OTPs are captured by the backend's existing test-only outbox (`E2E_OTP_OUTBOX_DIR`); `COMMERCE_EMAIL_SEND_MODE=disabled`. Test-only
routes (`/api/__e2e/*`) exist only under `NODE_ENV=test` and require a support token.

### 2.2 Projects

| Project | Browser | Viewport | Runs |
|---|---|---|---|
| `chromium-desktop` | Chromium | 1440×900 | all specs |
| `firefox-desktop` | Firefox | 1440×900 | all specs |
| `webkit-desktop` | WebKit | 1440×900 | all specs |
| `mobile-webkit-390` | WebKit (iPhone 13) | 390×664 | `@responsive` |
| `tablet-chromium-768` | Chromium, touch | 768×1024 | `@responsive` |
| `wide-firefox-1920` | Firefox | 1920×1080 | `@responsive` |

### 2.3 CI

`.github/workflows/ci.yml` job **Release E2E / Chromium, Firefox, WebKit**: disposable PostgreSQL action → `npm ci` → Prisma generate →
`playwright install --with-deps chromium firefox webkit` → `npm run test:release` → uploads `playwright-report/release` and
`test-results/release` (14 days). No secrets are referenced; `check-workflow-policy.cjs` passes.

Commands: `npm run test:release` (apps/frontend), `npm run test:release:db -- start|stop|status` and `npm run test:release:stack` (apps/backend).

## 3. Coverage matrix

Legend: **E2E** = Playwright against the real stack · **API** = HTTP assertions inside the release specs · **Unit/Int** = existing or
updated Vitest/pytest suites · **NV** = not verified by this task.

| Journey | Covered by | Assertions | Gaps |
|---|---|---|---|
| Registration | E2E `customer-auth` | required fields block submit; wrong OTP rejected; emailed OTP verifies; OTP single-use (API 400); new account is CUSTOMER (admin API 401/403) | — |
| Login / logout / session | E2E `customer-auth` | generic, identical error for known/unknown email; `/me` 401 when signed out; session survives reload; sign-out confirm + cancel; refresh cookie revoked (401) | — |
| Customer vs admin separation | E2E `customer-auth`, `admin` | customer → `/admin` redirects to login; customer token refused by 4 admin APIs; no `/admin/register` (UI + API 404/405); anonymous admin APIs 401 | — |
| Search & suggestions | E2E `discovery` | newest query wins under rapid typing; ArrowDown/Enter/Escape; results page ranks laptops, excludes audio; back navigation; empty state; Clear focuses input; 503 shows an error, not a false empty result | — |
| Product details | E2E `discovery` | heading/SKU/price/stock equal the API; specs tab; quantity bounded by stock; out-of-stock cannot be added; unknown slug → not-found | — |
| Recommendations | E2E `discovery` ("More in …" category rail excludes the current product and navigates); admin Recommendations page renders | Personalised/AI ranking: NV here (backend + pytest suites) |
| Image search | E2E `image-search`, opt-in `image-search-ai` | unsupported/empty files refused in-browser with no upload; valid photo → truthful "not available / unavailable", never fabricated matches; with the AI service (`RELEASE_E2E_AI=1`): unseen photos return only visually similar products, best first | Similarity: verified locally on 3 engines; not in CI (no AI service) |
| Cart | E2E `cart-wishlist` | add / increase / decrease / remove / empty; totals equal server cart; persists across reload; rapid increases capped at stock; guest cart merges on sign-in; failed POST rolls back the count with an inline error | — |
| Wishlist | E2E `cart-wishlist` | heart `aria-pressed`, header count, persistence, outsider isolation (API), empty state, rapid toggles settle on last intent server-side | — |
| Checkout | E2E `checkout-orders` | shipping validation (`aria-invalid`); delivery price from server flows into total; progress kept across navigation | — |
| Payment | E2E + API `checkout-orders` | truthful "payments switched off" state, Review Order disabled, retry keeps it disabled; no order/attempt created; forged price → 400; forged payment-attempt/order bodies → 4xx | Stripe Test Mode success/decline/webhook: **NV here** — backend Stripe/webhook/idempotency suites and the separate isolated real-Stripe harness (`playwright.isolated.config.ts`) |
| Orders & documents | E2E + API `checkout-orders` | details show server status/payment/items/total; invoice/receipt/summary are `%PDF-`, `no-store`, owner-only (outsider 404, anonymous 401); UI download is a PDF; foreign order → "Order not found" | — |
| Delivery tracking | E2E `checkout-orders`, `admin` (Journey C) | tracking page renders authorised state + live channel; admin Start tracking → next status → confirm; customer page updates **without reload** over Socket.IO (server counter `published` increments); outsider/anonymous refused | Map/simulation route: NV |
| Admin workflows | E2E `admin` | MFA enrollment + TOTP sign-in; 9 console pages render without error/overflow; inventory adjust reaches storefront and is reverted (Journey B); staff blocked from Administrators, Owner allowed, own switch locked; sign-out ends session | Product/category CRUD UI: covered by existing unit + Task 05.x Playwright suites, not re-run here |
| Responsive | `@responsive` tests on 390 / 768 / 1920 | no horizontal overflow on search, PDP, cart, wishlist, checkout, orders, tracking, admin pages; admin drawer navigation | Pixel comparison against Figma: NV (06.2) |

### Cross-feature journeys

| Journey | Where |
|---|---|
| A — discover → PDP → cart → checkout → payment gate | `discovery` + `checkout-orders` (@responsive checkout test starts from the PDP) |
| B — admin inventory change visible to shoppers | `admin` "Journey B" |
| C — admin delivery update visible live to the customer | `admin` "Journey C" |
| D — failure and recovery (search 503, cart POST 503 rollback, payment unavailable retry) | `discovery`, `cart-wishlist`, `checkout-orders` |
| E — customer and admin sessions coexist in separate contexts | `admin` Journey C (customer context + admin context) |
| F — guest → signed-in continuity (guest cart merge) | `cart-wishlist` |

## 4. Product defects found and fixed

| Id | Defect | Fix |
|---|---|---|
| D-1 | After a full page load, Add to Cart / Buy Now clicked while the stored session was still being re-verified failed with the misleading "Could not add this product. Check availability and try again." | `ProductDetailPage` keeps both actions pending until the session has a verdict; `CartProvider` throws a named `SESSION_CHECK_MESSAGE`, mapped to a truthful message. Regression test in `ProductDetailPage.test.tsx`. |
| D-2 | In the same window the wishlist heart accepted clicks that `WishlistProvider.toggle` silently dropped. | Shared `WishlistButton` gains `disabled`; the product page disables the heart until the session is verified. Test: `WishlistButton.test.tsx`. |
| D-3 | Admin **Delivery** list overflowed a 390 px phone by 110 px (the whole page scrolled sideways). Its page-local `.page` grid lacked the `> * { min-width: 0 }` rule the shared admin page layout has, and its table frame was not a positioning context, so 1 px visually-hidden badge labels escaped the scroller. | `AdminDeliveriesPage.module.scss`: same rule as `features/admin/shared/AdminPages.module.scss`, and `position: relative` on the table frame (as the shared `TableCard`). Measured 0 px overflow at 390, 768 and 1440 on the list and detail pages; guarded by the `@responsive` admin test. |

Follow-up R-1 (fixed): product **cards** on Home/Search/Wishlist called `addItem` during that window and showed the generic "Could not
add item. Please try again." The shared `ProductCard` now keeps Add to Cart and the heart disabled until the session has a verdict.

## 5. Security constraints honoured

No production or shared DEV database was read or written; every database operation targets loopback `electrohub_ci`. Payment
isolation, MFA, rate limiters and authorization were not weakened: the harness sends documentation-range `X-Forwarded-For`
addresses (the app trusts one proxy hop) so per-IP limiters do not couple unrelated tests. No public admin registration exists or was added.
