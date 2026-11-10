# Task 06.2 — cookie and privacy evidence (work in progress)

Base: `origin/feature/06.2-accessibility-qa-ci-cd` at `9e50655`. Isolated worktree; original checkout contained unrelated changes. This is a source audit, not a complete runtime/provider or legal audit.

## Decision

Optional first-party analytics exist: visible storefront session duration, recommendation impressions/clicks, and image-search outcome and selection events. An opt-in is therefore warranted. Account personalization is a distinct existing opt-in controlled in account settings; server-side product interactions check that preference. Operational request and image-search lifecycle logs are separate from these analytics. No Google Analytics, GTM, advertising pixel, or browser Supabase client was identified in the inspected application sources; this is not proof about deployed infrastructure or provider scripts.

## Source inventory

All application-owned entries below are first-party. Local storage generally persists until cleared; session storage lasts for a tab session. Neither has cookie security attributes; it is readable by same-origin script. Lifetimes and removals below are source behavior, not runtime observations.

| Name | Technology and purpose | Classification, trigger, lifetime/removal | Source |
|---|---|---|---|
| `electrohub_customer_refresh`, `electrohub_admin_refresh` | HttpOnly refresh cookies, distinct portals | Necessary; sign-in; 7 days; cleared at logout. Host-only, path `/api/auth/customer` or `/api/auth/admin`, SameSite=Lax, Secure in production | `auth.controller.ts` |
| `electrohub_refresh` | Legacy cookie | Only expired at legacy paths, never used as active session | `auth.controller.ts` |
| `electrohub_google_transaction` | Sealed OAuth transaction cookie | Necessary for requested Google sign-in; 5 minutes; cleared on completion; HttpOnly, host-only, `/api/auth/google`, Lax, Secure in production | `google.controller.ts` |
| `electrohub_google_transaction_completion` | OAuth completion cookie | Necessary; 30 seconds; same scope and flags as transaction | `google.controller.ts` |
| `electrohub_account_deletion_proof` | Reauthentication proof cookie | Necessary for requested deletion; 5 minutes, cleared after use; HttpOnly, host-only, `/api/account`, Strict, Secure in production | `account-deletion.controller.ts`, `google.controller.ts` |
| `electrohub.cart.v1`, `electrohub.wishlist.v1` | Local storage; guest selections | Requested cart/wishlist function; created by guest actions; cleared when empty or merged | `cart/storage.ts`, `wishlist/storage.ts` |
| `electrohub.cart.auth-count.v1:<user>`, `electrohub.wishlist.auth-count.v1:<user>` | Session storage; cached counts | Requested shopping function; tab lifetime | corresponding `storage.ts` |
| `electrohub:cached-user`, `electrohub:admin:cached-user`, `electrohub:header-identity`, `electrohub:admin:header-identity` | Local and session storage; display/session restoration hints, not access tokens | Authentication UX; on sign-in; cleared on logout or invalid identity. Local storage persists otherwise | `AuthContext.tsx`, `sessionRestore.ts` |
| `electrohub:checkout:v1:<user>`, buy-now variant, `electrohub:checkout:submitted:v1:<scope>:<user>`, `electrohub:checkout:history:v1:<scope>:<user>`, `electrohub:buynow:v1`, `electrohub:payment-observation:v1:<owner>` | Session storage; checkout draft, recovery and purchase state | Requested transaction; tab lifetime or explicit cleanup | `checkout/state.ts`, `buyNow.ts`, `paymentObservation.ts` |
| `electrohub.payment-notice.<user>.<attempt>.<state>` | Local storage; payment notification deduplication | Transaction UX; persistent until browser clearing | `PaymentPurchases.tsx` |
| `electrohub:admin-sidebar-collapsed` | Local storage; user-requested admin layout preference | Preference; created by admin action; persists until cleared | `AdminLayout.tsx`, `navigation.ts` |
| `eh.admin-sign-in-notice` | Session storage; fixed sign-in notice | Security workflow; read and removed on sign-in page | `endAdminSession.ts`, `AdminLoginPage.tsx` |
| `eh.storefront-session` | Session storage; random tab identifier for visible duration | Optional analytics; created only after opt-in by changed code; removed on withdrawal or tab closure | `useStorefrontSession.ts` |
| `electrohub.privacy.v1` | Local storage; version, analytics boolean and timestamp | Choice storage; valid 180 days, stale record remains until replaced or cleared. No identity or token | `privacy/consent.ts` |

## Integrations and limits

Stripe.js is loaded in checkout and provider-managed storage, fraud/security use and lifetimes require live Test Mode inspection; no blanket classification of its cookies is made here. Google OAuth, map tile providers, external media and other services receive requests when used and may have independent policies. Backend Supabase/Postgres, Brevo, AI, Socket.IO and server logs do not by their names establish browser cookies. Browser/provider inspection remains outstanding. No IndexedDB or `document.cookie` application use was found in the searched frontend source.

The consent store defaults off, validates schema/timestamp, synchronizes through storage events and clears the tab identifier on rejection. The storefront session and recommendation event senders check the current choice; image-search sends an opt-in header and the backend only creates its outcome analytics/token with that header. Previously submitted or in-flight requests cannot be recalled. Existing account-personalization consent remains separate. Analytics already stored server-side are not deleted by browser withdrawal. Provider-managed storage is not erased.

## Security review

Source review found the refresh and transaction flags listed above. Access tokens are held in memory in `lib/api.ts`; identity hints are JavaScript-readable and are not credentials. Cookie path separation and logout behavior are unchanged. CSRF, OAuth cross-origin, rotation, MFA, checkout and live provider behavior have not been independently verified in this task. Do not infer production correctness from source alone.

## Verification and remaining work

- Frontend focused tests: 6 files, 18 tests passed, including the final corrupted-storage assertion. Frontend typecheck passed; lint passed with three existing Fast Refresh warnings; build passed with existing Sass and chunk warnings.
- Backend typecheck passed after local Prisma client generation; lint passed. Two isolated analytics test files passed (20 tests); the image-search consent controller tests passed (3 tests), with dummy connection settings and no live database evidence.
- Initial Vite test under sandbox failed to resolve configuration; rerun outside sandbox passed. Initial backend tests lacked environment configuration; rerun with disposable values passed.
- Installed Chrome against production preview with APIs intercepted: at 390×844, rejection survived reload, the tab identifier was absent, no analytics event request was seen and settings reopened. At 900px height, controls fit and no horizontal overflow was observed at widths 320, 390, 768, 1024, 1440 and 1920; screenshots captured locally. This does not validate real API, login or payments. Actual response headers, login/cart/checkout/MFA regressions, full cross-browser and visual QA, and CI: NOT VERIFIED. Figma page metadata was accessible, but no cookie-specific visual reference was established. No visual match claim is made.
- Regulatory references: Irish DPC cookie guidance, UK ICO storage and access technology guidance, MDN secure cookie guidance, and Lebanese Law 81/2018. Applicability, the 180-day re-consent interval, preference classifications, policy wording, operational telemetry and provider behavior require legal/privacy review for target markets. No compliance certification is claimed.
- Known risk: an image-search request started while opted in can complete after withdrawal and still record its already-authorized server outcome. Server logs and account-personalization choices are separate. Further audit of recommendation and third-party flows is required before release.

References: https://www.dataprotection.ie/en/dpc-guidance/guidance-cookies-and-other-tracking-technologies ; https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/how-do-we-manage-consent-in-practice/ ; https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies ; https://legallaw.ul.edu.lb/OriginalLawPage.aspx?lawId=278573

Draft PR: https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/56

GitHub reported no PR workflow runs or combined status entries for initial head `5500201` when checked; CI is not verified.
