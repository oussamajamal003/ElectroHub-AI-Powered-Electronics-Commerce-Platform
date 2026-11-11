# Task 06.2 side task — motion, Contact/About, admin alerts, cart checkout readiness

Side branch `feature/06.2-motion-contact-alerts-cart-cloud`, based on `feature/06.2-accessibility-qa-ci-cd` @ `9e50655`.
PR target: `feature/06.2-accessibility-qa-ci-cd` (not `develop`). This does **not** complete Phase 06.2.

## Root causes and fixes
| Package | Root cause | Fix |
|---|---|---|
| Scroll motion | `replay` mode in `SectionReveal`/`StaggerItem` and `BenefitsReveal` re-hid a section as soon as it left the viewport (including through the bottom edge when scrolling up) and replayed its animation on re-entry. Reproduced on the base commit: 5 reveal animations restarted while scrolling up on Home. | Reveal once, then stay visible (one observer per wrapper, disconnected after reveal). Sections already above the viewport (reload, back/forward) settle without animation, via the observer plus one shared passive scroll sweep that exists only while something is pending. `replay` prop removed. Reduced motion shows everything. |
| Cart checkout | `isMutating` was a boolean cleared by whichever queued write settled first (checkout re-enabled while later writes pending), and every rapid click queued its own serial transaction. | Pending-write count (zero only when the queue is drained); unsent quantity changes on one line coalesce into a single PATCH with the latest quantity (a write already on the wire is never altered); accessible "Updating your cart…" note via `aria-describedby`. Backend totals/stock remain authoritative; no timers. |
| Admin alerts | The bell showed live operational counts only ("no unread semantics"); nothing could be marked read. | New per-admin baseline (`admin_alert_acknowledgements`). `unread = max(0, current − acknowledged)`; baseline is lowered when a condition clears. Acknowledge sends the counts actually displayed and the server clamps them to current, so an alert that arrived meanwhile stays unread. Operational counts are never altered. Optimistic update with rollback + error message; in-flight refetch cancelled first. |
| Contact settings | No business-hours field; no placeholders. | `store_settings.businessHours` (nullable, optional on the wire so older clients leave it untouched; audit records field names only). Placeholders: `support@example.com`, `+961 XX XXX XXX`, `Monday–Friday, 9:00 AM–6:00 PM`, address examples. Existing Owner-only save, version conflict handling and step-up unchanged. |
| Contact form | Existing API already validated, rate-limited (5/min) and used the configured mailbox. | Added honeypot (`website`), branded escaped HTML + text notification (store name in the body), sanitised subject/reply-to. The subject keeps its original `Store contact: …` contract (see Round 2). UI: min/max lengths, whitespace, focus on first error, blocks double submit, clears only after server acceptance, honest empty state for unconfigured details, hours card. |
| About | Contained unsupported claims ("certified", "fast shipping", "expert support"). | Rewritten using only capabilities present in the repo (search, image search, recommendations, Stripe checkout, delivery tracking, contact form); links to Contact/Products. |

**Delivery semantics:** HTTP 202 means the email provider accepted the message. Inbox delivery is not claimed or verified.

## Migration
`apps/backend/prisma/migrations/20261114000000_contact_hours_admin_alert_acknowledgements`: one nullable column + one new table (RLS enabled, no policies, like the other server-only tables). Additive; apply via the normal migration workflow. Not applied to any shared DEV/PROD database. Round 2 applied it to a **disposable** local PostgreSQL 16 cluster (see below).

## Verification actually run (Round 1, head `08ce5d3`)
- Frontend `npx vitest run`: 172 files passed, 1 failed; 1431 tests passed, 1 failed. The failure (`AdminSettingsPage.test.tsx` › "asks before leaving a tab with unsaved changes…") also fails with my uncommitted changes stashed (base behaviour).
- Backend (placeholder env, no DB): `admin.routes`, `admin-settings.routes`, `storefront.routes`, `admin-alert-acknowledgement`, `storefront-contact.service`, `store-settings.service`, `admin-operations.service` = 111 tests passed. A broad run of `src/services|routes|controllers|emails` without DB/Stripe/Google configuration shows many unrelated failures (payment suites return 503 under placeholder config; `*integration*`/`*.live*` need PostgreSQL); not attributable to this change but **not verified against a configured environment**.
- Typecheck: frontend `tsc -b` clean; backend `tsc --noEmit` clean for changed files. ESLint clean on changed backend files; frontend lint: 0 errors (one react-refresh warning for an exported validator).
- Playwright (Chromium only), `npx playwright test -c playwright.motion-contact.config.ts`: **25 passed**. Covers scroll down/up/down, rapid reverse, reduced motion, 390px mobile scroll, reload/back, Contact+About at 390/768/1440/1920 (no horizontal overflow; screenshots in `apps/frontend/test-results/motion-contact/`), keyboard focus order, contact pending/failure/429/recovery, empty-config state, admin badge clear/refresh/navigate/new-alert/failure, cart increase/decrease/remove/last-item/rapid/stock-conflict/refresh. All APIs are intercepted; nothing real was touched.
- Pre-fix reproduction: same scroll spec against the base commit: Home failed ("no reveal animation may restart while scrolling up", received 5).
- Cart timing: Checkout re-enabled within the test's 1.5 s bound after the simulated server response; value recorded as a test annotation. This measures client behaviour against simulated latency, not real backend latency.

## Round 1 status at the time (superseded where Round 2 says otherwise)
- Remote CI on `08ce5d3`: all 19 checks green, including Release E2E Chromium/Firefox/WebKit (the repository's existing release suite, not the new specs).

## Residual risks
- Acknowledgement is per category count, not per event: if one alert clears and another of the same category appears between reads, the unread number may under-count by the overlap.
- Coalescing means intermediate quantities are never sent; a stock failure rolls back to the last server state, not to the intermediate click.

---

# Round 2 — PR #55 recovery (starting head `08ce5d3`)

## What Round 2 changed
| Area | Finding | Change |
|---|---|---|
| Product Details motion | Reproduced on the **base** commit `9e50655` with real Chromium: Product Details itself did **not** replay (no CSS animation, transition or remount while scrolling up). The `/products` catalog grid **did**: cards were hidden again (`_item` at opacity 0, y = 2334) because every card used `StaggerItem replay`. That replay was removed in Round 1. | New regression spec `tests/visual/pdp-scroll-motion.spec.ts`: Product Details at 1440 and 390 px (instrumented: animationstart, opacity/transform transitionstart and DOM removals recorded while scrolling up must all be zero), reload at depth, back/forward, reduced motion, and the `/products` catalog. |
| Product Details remount (user request in this session) | The page rendered the full skeleton whenever `productQuery.isFetching` was true, so any background refetch (reconnect, invalidation) unmounted every section and image and lost the visitor's place. | Skeleton only until this mount has a fresh successful read for the slug (cached data from before the mount still never renders, so a denied product never flashes). After that, a background refetch keeps the verified product; a failed refetch (404 / no longer public) still removes it at once. 2 new unit tests; the existing "hides stale product details while the authoritative refresh is in flight" test still passes. |
| Review box | `textarea#review-body` (Product Details → Reviews tab, `ProductDetailPage.tsx`) had no placeholder and its `0/2000` counter was not associated. | Placeholder `Share your experience with this product...`, visible "(required)" hint, `aria-required`, counter linked via `aria-describedby`, readable placeholder colour (`$color-text-muted`), min-height. Validation, limits, submit/edit/delete unchanged. Unit + browser tests (320/390/1440 px). |
| Admin contact placeholders | Store name, State or region and Postal code had none; City/Country used bare words. | Every editable store text field now has an example placeholder (table below). No website/social fields exist, so none were invented. |
| Admin alerts | The bell menu had no "See all alerts" action. | "See all alerts" menu item → `/admin` (dashboard Fulfillment + Stock attention). Opening the menu acknowledges what is shown (unchanged). |
| Contact email subject (regression in Round 1) | Round 1 changed the subject to `[Store] Contact: …`, silently breaking the existing disposable capture helper (`tests/visual/storefront-contact-capture.helper.ts`, used by `task05-2-administrators-access-disposable.spec.ts`) and any mailbox filter on the old prefix. | Restored `Store contact: <subject>`. |
| `AdminSettingsPage` test failure | Root cause: the test queried the Store Information heading synchronously right after clicking Cancel in a Radix dialog; Radix keeps the page `aria-hidden` until the dialog finishes closing, so under CPU load the query raced the close. Product behaviour (Cancel keeps the edits) was correct. | Test waits for the dialog to close before the same assertions; nothing weakened or skipped. 4/4 repeated runs pass, plus full-suite runs. |

### Admin store-information placeholders (all examples, never saved)
| Field | Placeholder |
|---|---|
| Store name | `Your store name` |
| Store email | `support@example.com` |
| Phone | `+961 XX XXX XXX` |
| Business hours | `Monday–Friday, 9:00 AM–6:00 PM` |
| Address line 1 | `Street, Building` |
| Address line 2 | `Floor, suite (optional)` |
| City | `Enter city` |
| State or region | `Enter state or region (optional)` |
| Postal code | `Enter postal code (optional)` |
| Country | `Enter country` |
| Currency | read-only (`USD – US Dollar (fixed)`), no placeholder |
| Time zone | select, no placeholder |

## Disposable PostgreSQL (real database, not mocks)
`node apps/backend/scripts/admin-security-pg.cjs` (the repository harness: fresh local cluster on a random loopback port, TLS on, every migration applied in order through `psql -v ON_ERROR_STOP=1`, the four pgvector migrations skipped as the harness documents). The sandbox runs as root and PostgreSQL refuses root, so `ELECTROHUB_LOCAL_PG_BIN` pointed at four one-line shims that run the PostgreSQL 16 binaries as the `postgres` user; the harness itself is unchanged and the shims are not committed.
- Result: **9 files, 106 tests passed, 0 skipped, exit 0.** This includes migration `20261114000000` applied on top of every earlier migration, and the new `admin-alert-acknowledgement.admin-pg.integration.test.ts`:
  - acknowledgement persists and a fresh service instance reads it back; counts are never changed; per-administrator isolation; 3 parallel acknowledgements converge on exactly 3 rows (one per category); new alerts raise unread; a cleared condition lowers the stored baseline; a recurrence counts again;
  - schema: CHECK rejects a negative baseline, the FK rejects orphan rows, rows cascade away with their administrator, RLS is enabled;
  - business hours: stored via the existing Owner-only path, untouched when an older client omits the field, cleared with `''`, audit records the field name and never the value.
- The other 8 suites (admin security, email change + RLS, features, seed provisioning/recovery, shipping threshold, store profile) also passed on the migrated schema.

## Contact form through the real provider (captured, never sent)
`apps/backend/src/routes/storefront.contact-capture.test.ts`: real route, validation, `StorefrontContactService` and `BrevoProvider`; only the store-settings read is stubbed. The configured recipient is `support@northstar.invalid`, so the provider writes to its capture outbox instead of calling Brevo. **5 passed**: message delivered only to the configured mailbox with the text intact; client-chosen recipient and CRLF header injection rejected with nothing captured; filled honeypot answered 202 with nothing captured; unconfigured mailbox → 503 `CONTACT_UNAVAILABLE`; oversized message → 400.
Real Brevo acceptance and inbox delivery remain **NOT VERIFIED** (needs authorised provider credentials).

## Round 2 verification commands
- Frontend changed areas: `npx vitest run` on AdminSettingsPage, ProductDetailPage, layouts, motion, cart, CartPage, CompanyPages → **14 files, 152 passed**; later AdminAlertsBadge + AdminSettingsPage → 38 passed.
- Frontend `npx tsc -b` and `npx tsc -p tsconfig.quality.json`: exit 0. ESLint on changed files: clean.
- Backend `npx tsc --noEmit`: clean. ESLint on changed files: clean. Contact unit + route + capture tests: 16 passed.
- Playwright (Chromium) and the full frontend suite: see "Final results" below.

## Still NOT VERIFIED
- New specs on Firefox/WebKit (only Chromium is installed in this sandbox; CI's Release E2E covers its own suite on all three engines).
- Dark mode (the dark-mode branch is not integrated here).
- Real Brevo delivery.
- Admin Settings form in a real browser (covered by RTL tests only; its page needs many admin-security fixtures).
- Native 200% browser zoom (only responsive widths 320–1920 were exercised).

## Residual risks
- Acknowledgement is per category count, not per event (see Round 1).
- Product Details now keeps a verified product visible during a background refetch; if a refetch returns 200 with a changed product it re-renders in place (prices/stock update), which is intended.
