# Task 06.2 side task — browser branding, toasts, tooltips and branded emails (cloud evidence)

Side task of Phase 06.2, run in Cloud Mode. It touches shared UI foundations and email templates only: no schema, API contract,
payment logic, database or environment-secret change, no shared DEV/PROD access, no real email sent, no merge, no deploy.

## 1. Git and coordination

| Item | Value |
|---|---|
| Parent (integration) branch | `feature/06.2-accessibility-qa-ci-cd` @ `9e50655` (verified on the remote; based on `develop` @ `9cae864`) |
| Side branch | `claude/trusting-planck-286jro` (the session is bound to push only this branch, so it replaces the suggested `feature/06.2-branding-toasts-tooltips-emails-cloud` name) |
| PR | base = parent branch, head = side branch (link in §14) |
| Concurrent work | `feature/06.2-premium-dark-mode-cloud` exists remotely; not merged, not copied. New styling uses semantic SCSS tokens only (see §10) |

## 2. Package A — browser branding

* **Asset choice.** The app logo is the lucide `Zap` mark in the blue rounded-corner tile plus the "Electro**Hub**" wordmark
  (`BrandLogo`). No favicon existed (the Vite placeholder was linked). `public/brand/electrohub-mark.svg` redraws that exact tile/path;
  `favicon-32.png`, `apple-touch-icon.png`, `brand/electrohub-icon-192.png` and the email logo were rasterized from it with the
  pre-installed Chromium. One artwork, several formats.
* **Brand map.** App logo = `BrandLogo` · favicon = `/brand/electrohub-mark.svg` (+32 px PNG, Apple touch icon) · email logo =
  `/brand/electrohub-email-logo.png` (295×80, shown 148×40) · alt text `ElectroHub` · default title `ElectroHub — Electronics Commerce Platform`.
* **Titles.** `src/lib/pageTitle.ts` is the single strategy: layouts use `usePageTitle` (h1-derived; admin gets an `Admin ` prefix, so
  `Admin Dashboard | …`); pages outside the layouts (admin login/invite/forgot/activate, 404) use `useDocumentTitle`. A configured store
  name replaces the brand prefix (`<name> — Electronics Commerce Platform`).
* **Evidence.** Vitest `usePageTitle.test`, `pageTitle.test`; Playwright (hermetic, §9): favicon links are root-absolute and return
  200 `image/*` from `/`, `/contact`, `/products/some-product`, `/admin/login`; titles on customer routes, admin login, 404;
  client navigation, back/forward and reload; a URL fragment token never reaches the title.
* **Not verified:** the pixels of the tab icon in a real browser chrome (headless has no tab strip) — only the served files/links.

## 3. Package B — toast architecture

`components/ui/Toast/`: `toastStore.ts` (module singleton: bounded queue of 3, 1.5 s dedupe, replace-by-id, `announce` flag),
`ToastCenter.tsx` (single renderer; extra instances stay inert; pending toasts are dropped on route change; never takes focus),
`describeError.ts` (12 outcomes → safe wording; never prints `error.message` of non-API errors), variants success/error/warning/info/loading,
optional action, reduced-motion safe. `AdminToastProvider`/`useAdminToast` now delegate to it (existing admin call sites unchanged).
`lib/query.ts` adds a `MutationCache` handler so **every** mutation in the storefront and admin caches reports 403/404/409/429/5xx/offline
consistently; validation (400/422) and 401 stay with inline forms and the session flow. `meta.action` names the operation (28 mutations labelled).

## 4. Customer action matrix

| Action | Existing feedback | Toast | Tooltip | Source | Evidence | Status |
|---|---|---|---|---|---|---|
| Add to cart (card) | sr-only status, error alert | success + failure (visual-only, `announce:false`) | — (labelled button) | `ProductCard.tsx` | `ProductCard.toast.test` (pending → no early success; failure safe text) | PASS |
| Add to cart (product page) | inline `cartFeedback` | success + failure | — | `ProductDetailPage.tsx` | existing suite non-regression only | NOT VERIFIED (new toast) |
| Cart remove / stock-rejected update | inline `actionError` | removal info; failure | — | `CartPage.tsx` | existing suite non-regression only | NOT VERIFIED (new toast) |
| Wishlist add/remove (guest, signed-in), full list, storage failure | inline alert | success after local write / server ack; failure; limit warning | — | `WishlistProvider.tsx` | existing suite non-regression only | NOT VERIFIED (new toast) |
| Sign in / register / verify / resend code | modal closes silently | success / info | header Account tooltip | `AuthModal.tsx`, `CustomerHeader.tsx` | existing AuthModal suites pass; header tooltip test | NOT VERIFIED (toast), PASS (tooltip) |
| Sign out | toast (bespoke) | moved to central store, same text | — | `CustomerHeader.tsx` | `tests/visual/refinement.visual.spec.ts` asserts it but was **not run** | NOT VERIFIED |
| Profile save, email change, password change | inline success/error | success/failure (server message preferred; no auth detail) | — | `ProfilePage.tsx` | existing ProfilePage suite passes | NOT VERIFIED (toast) |
| Contact form | inline status/alert | success; 503 error; 429 warning; dedupe | — | `ContactPage.tsx` | Playwright on 3 engines + 320/390 px | PASS |
| Order document view/download failure | inline per-document error | error (visual-only) | — | `useOrderDocuments.ts` | existing OrderDocuments suite passes | NOT VERIFIED (toast) |
| Payment result | bespoke `PaymentNotifications` from authoritative state | **unchanged** (never inferred from navigation) | — | `PaymentPurchases.tsx` | not touched | N/A |
| Delivery tracking updates | bespoke announce-excluded toasts | **unchanged** | — | `DeliveryTrackingPage.tsx` | not touched | N/A |
| AI image search errors/format/size | dedicated in-panel states + one live region | **exception**: a toast would duplicate it | — | `DiscoveryImageMode.tsx` | not touched | N/A |
| Copy tracking reference / recovery codes / TOTP key | inline "Copied" label + status | **exception** (inline, sensitive values) | — | existing | not touched | N/A |
| Header: search, cart, wishlist, account, mobile menu | `aria-label`; search used native `title` | — | yes (native `title` removed) | `CustomerHeader.tsx` | `CustomerHeader.test`; Playwright focus/hover/Escape | PASS |

## 5. Admin action matrix

| Action | Existing feedback | Toast | Tooltip | Source | Evidence | Status |
|---|---|---|---|---|---|---|
| Product/category/inventory/order/delivery/recommendation/settings/administrator/security/session **success** | success toasts already present | routed through the central store, text unchanged | — | pages that call `useAdminToast` | `AdminSettingsPage.test` + all 176 frontend files | PASS (non-regression) |
| Any mutation **failure** (403, 404, 409, 429, 5xx, offline, unexpected) | inline in dialogs only | new, differentiated, deduped by kind | — | `lib/query.ts` + `meta.action` on 28 mutations | `ToastCenter.test` (classification, skip rules, dedupe); same path exercised in-browser by the contact flow | PASS (unit + browser); per-page wording NOT VERIFIED |
| Product row actions (edit, media, publish/unpublish, delete incl. blocked delete) | `title` attribute | — | yes; blocked delete shows the blocker reason | `AdminCatalogProductsPage.tsx` | source only | NOT VERIFIED (no test) |
| Category row actions (edit, show/hide, delete incl. disabled delete) | `title` | — | yes; disabled delete explained via focusable wrapper | `AdminCategoriesPage.tsx` | `AdminCategoriesPage.tooltips.test` | PASS |
| Spec remove, preview-cart remove, deleted-admins dismiss | aria-label | — | yes | form/recommendations/notice pages | source only | NOT VERIFIED (no test) |
| Alerts bell, mobile menu | aria-label | — | yes | `AdminLayout.tsx` | `AdminLayout.test` still passes | NOT VERIFIED (tooltip behavior) |
| Collapsed sidebar rail, sidebar toggle | already Radix tooltips | — | existing | `AdminLayout.tsx` | existing | PASS (pre-existing) |
| Media upload failure | per-image state | via mutation handler | — | `adminMedia/queries.ts` | not exercised | NOT VERIFIED |
| Report/export, clipboard | no export UI exists; copy has inline confirmation | n/a | n/a | — | grep | N/A |

Items marked NOT VERIFIED are implemented and typecheck/lint/build clean with no unit regression, but have no assertion that proves the new feedback.

## 6. Tooltip architecture

Radix, one app-level `TooltipProvider` (a lone `Tooltip` mounts its own, so stories/tests keep working). Hover and keyboard focus open,
Escape/blur close, `collisionPadding` flips near edges, touch taps do not open (so every control keeps an accessible name). `focusableWrapper`
and `IconButton disabledReason` expose *why* a control is unavailable without enabling it. `IconButton` auto-shows its `aria-label`.
Tests: `Tooltip.test` (hover, keyboard focus + `aria-describedby`, Escape, disabled wrapper never fires), `IconButton` hint/override/opt-out/disabled reason.

## 7. Email branding

Inventory (real producers, found by `rg sendTransactionalEmail` + commerce dispatcher): customer verification, password reset,
password changed · admin invitation, activation, owner granted, owner revoked · admin email-change code and old/new notices ·
admin deletion notice · operational alerts (order paid, low-stock digest, invitation accepted) · stock alert (low / out) ·
storefront contact (internal) · commerce templates for every fixture (order confirmed, payment confirmed, preparing,
out for delivery, delivered, cancelled, refunded). All use `src/emails/brand.ts` `renderEmailHeader`.
Business content is untouched: OTP, links, totals, references and expiry assertions pass. The renamed-store identity is kept.
`brand.test.ts` (8 tests) renders every producer through a capturing provider (no network, no real send) and asserts one header,
absolute https logo, alt `ElectroHub`, 148×40, no SVG/CSS-background/data-URI, no leftover old brand div, codes/links/plain text intact,
URL-safety rules, text-wordmark fallback, escaping of a malicious store name; a mutation check (header removed from one producer) failed the test as it should.
Two existing commerce assertions were narrowed (not weakened): "no `<img` for malicious fixtures" and "all images are https product thumbnails
with empty alt" now exclude the single fixed brand-logo tag and additionally assert exactly one such tag.
Rendered previews (Chromium, logo served by request interception): 600 px OTP and commerce emails show the logo centred at 148×40; at 320 px the card reflows;
with the image unavailable the alt text renders as brand-blue "ElectroHub".
**Not verified:** Gmail/Outlook/Apple Mail rendering, Brevo acceptance, and that the PNG is publicly reachable at the real production origin
(it ships in the frontend `public/brand/`; the origin comes from configuration). `LOCAL MODE VERIFICATION REQUIRED` for: one controlled capture-mode send
(`COMMERCE_EMAIL_SEND_MODE=capture`) viewed in a real client.

## 8. Accessibility and responsive evidence

Toasts: Radix live regions (errors/warnings assertive, others polite), labelled dismiss button, never focus-taking (Playwright), `announce:false`
avoids double speech where an inline status exists, reduced motion verified (`animation-name: none`), long unbroken text wraps and stays within
the viewport at rest at 1280/390/320 px with no horizontal scroll. Tooltips: keyboard focus/Escape verified in all three engines.
Not run: axe scan of the new surfaces, native 200 % zoom, screen-reader testing — **NOT VERIFIED**.

## 9. Tests actually run

| Command | Result |
|---|---|
| `npx tsc -b` / `npm run typecheck` (frontend) | clean |
| `npm run lint` (frontend) | 0 errors, 3 `react-refresh/only-export-components` warnings (`OtpCodeInput`, `TotpEnrollment`, `AdminInvitePage`), all pre-existing exports on the parent branch |
| `npx vitest run` (frontend) | 176 files, **1441 passed, 0 failed** (includes the tests added by this task; one failure my own change introduced mid-way is §12 item 1) |
| `npm run build` (frontend) | success (chunk-size advisory is pre-existing); `dist/` contains the brand assets |
| `npx tsc --noEmit` (backend, after `prisma generate`) | clean |
| `npx vitest run` (backend, full) | 265 failed / 1771 passed / 37 skipped. **Identical failing set to the untouched parent branch** (265 failed / 1763 passed): payment-isolation (`PAYMENT_MUTATIONS_DISABLED`), Stripe/payment suites, PostgreSQL integration and DB-dependent app tests — they need the isolated database/payment runtime that this task must not use. The +8 passes are the new email tests |
| `npx vitest run src/emails …` (email suites) | 213 passed |
| `npx playwright test -c playwright.branding.config.ts` | chromium 12/12, firefox 12/12, webkit 11 passed + 1 skipped (hover; keyboard path covers WebKit), 390 px 12/12, 320 px 12/12 |

Browser engines are Playwright Chromium, Firefox and WebKit builds; no real Safari/iOS claim. The branding spec is hermetic (every `/api/**` request is
intercepted); `sendBeacon` analytics calls bypass interception in Firefox/WebKit and only log harmless proxy `ECONNREFUSED` noise.
Not run: Storybook build, the release/quality Playwright suites (need the real backend and disposable database), CI on the final SHA (§13).

## 10. Dark-mode compatibility

New SCSS uses existing semantic tokens only (`$color-warning-*`, `$color-info-*`, focus ring tokens). No light-only hard-coded surface was added.
Not verified against the dark-mode branch (not merged here); email branding is intentionally theme-independent.

## 11. Parallel-work and conflicts

Files shared with likely concurrent work: `AdminLayout.tsx`, `CustomerHeader.tsx`, `Toast.module.scss`, `Tooltip.module.scss`. Changes there are small
and localized; expect trivial conflicts only if the dark-mode branch edits the same lines.

## 12. Defects found and corrected

1. **Toast host never rendered after a deduped re-raise.** Reproduction: `AdminSettingsPage.test` failed only when run after another test that raised the same toast. Cause: the singleton queue kept a deduped item but a freshly mounted `ToastCenter` did not re-render when it registered as host (the host was not part of the subscribed snapshot). Fix: host ownership is now a `useSyncExternalStore` snapshot and the queue is reset between tests. Verified by the full suite and the dedupe/single-viewport tests.
2. **Misleading validation messaging risk.** A wrong current password returns a 4xx that a generic classifier would present as "session expired". `preferServerMessage` keeps the API's sanitized message for form flows (unit-tested).
3. **Native `title` + custom tooltip doubling** removed on the converted controls.
4. **No favicon / generic page titles / untitled admin sign-in and 404 pages** (the Vite icon and a bare `ElectroHub` title were shipped).
5. Test-harness findings (not product defects): my first Playwright route glob `**/api/**` swallowed Vite module URLs (fixed by matching on path); a toast geometry check must wait for the slide-in animation.

## 13. Remaining limitations and CI

* CI for the final SHA: see the PR checks; not claimed here.
* Components without a dedicated assertion are listed as NOT VERIFIED in §4–§5.
* Real email-client rendering, Brevo acceptance and public logo reachability need local/controlled verification (§7).
* Payment/delivery/image-search feedback surfaces were intentionally left as they are (§4).

## 14. Changed files and PR

See the PR file list (`git diff --stat origin/feature/06.2-accessibility-qa-ci-cd…`). PR link: added in the closing commit below.
