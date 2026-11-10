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
| Contact form | Existing API already validated, rate-limited (5/min) and used the configured mailbox. | Added honeypot (`website`), branded escaped HTML + text notification, sanitised subject/reply-to, store name in subject. UI: min/max lengths, whitespace, focus on first error, blocks double submit, clears only after server acceptance, honest empty state for unconfigured details, hours card. |
| About | Contained unsupported claims ("certified", "fast shipping", "expert support"). | Rewritten using only capabilities present in the repo (search, image search, recommendations, Stripe checkout, delivery tracking, contact form); links to Contact/Products. |

**Delivery semantics:** HTTP 202 means the email provider accepted the message. Inbox delivery is not claimed or verified.

## Migration (not applied anywhere)
`apps/backend/prisma/migrations/20261114000000_contact_hours_admin_alert_acknowledgements`: one nullable column + one new table (RLS enabled, no policies, like the other server-only tables). Additive; apply via the normal migration workflow. `prisma generate` was run; no migration was executed against any database.

## Verification actually run
- Frontend `npx vitest run`: 172 files passed, 1 failed; 1431 tests passed, 1 failed. The failure (`AdminSettingsPage.test.tsx` › "asks before leaving a tab with unsaved changes…") also fails with my uncommitted changes stashed (base behaviour).
- Backend (placeholder env, no DB): `admin.routes`, `admin-settings.routes`, `storefront.routes`, `admin-alert-acknowledgement`, `storefront-contact.service`, `store-settings.service`, `admin-operations.service` = 111 tests passed. A broad run of `src/services|routes|controllers|emails` without DB/Stripe/Google configuration shows many unrelated failures (payment suites return 503 under placeholder config; `*integration*`/`*.live*` need PostgreSQL); not attributable to this change but **not verified against a configured environment**.
- Typecheck: frontend `tsc -b` clean; backend `tsc --noEmit` clean for changed files. ESLint clean on changed backend files; frontend lint: 0 errors (one react-refresh warning for an exported validator).
- Playwright (Chromium only), `npx playwright test -c playwright.motion-contact.config.ts`: **25 passed**. Covers scroll down/up/down, rapid reverse, reduced motion, 390px mobile scroll, reload/back, Contact+About at 390/768/1440/1920 (no horizontal overflow; screenshots in `apps/frontend/test-results/motion-contact/`), keyboard focus order, contact pending/failure/429/recovery, empty-config state, admin badge clear/refresh/navigate/new-alert/failure, cart increase/decrease/remove/last-item/rapid/stock-conflict/refresh. All APIs are intercepted; nothing real was touched.
- Pre-fix reproduction: same scroll spec against the base commit: Home failed ("no reveal animation may restart while scrolling up", received 5).
- Cart timing: Checkout re-enabled within the test's 1.5 s bound after the simulated server response; value recorded as a test annotation. This measures client behaviour against simulated latency, not real backend latency.

## Not verified / Local Mode
- Firefox and WebKit: browsers not installed in the cloud sandbox → NOT VERIFIED.
- Dark mode: parallel dark-mode branch not integrated; pages use existing tokens only → NOT VERIFIED.
- Real Brevo delivery, the migration on disposable/real PostgreSQL, admin alert persistence against a real DB, and `*admin-pg*` integration suites → need Local Mode.
- No axe/automated accessibility scan was run; keyboard order, labels, `aria-describedby`, `role=status/alert` were exercised by Playwright/RTL only.
- Remote CI for the final SHA: not yet observed.

## Residual risks
- Acknowledgement is per category count, not per event: if one alert clears and another of the same category appears between reads, the unread number may under-count by the overlap.
- Coalescing means intermediate quantities are never sent; a stock failure rolls back to the last server state, not to the intermediate click.
- The existing, unrelated `AdminSettingsPage` test failure is untouched.
