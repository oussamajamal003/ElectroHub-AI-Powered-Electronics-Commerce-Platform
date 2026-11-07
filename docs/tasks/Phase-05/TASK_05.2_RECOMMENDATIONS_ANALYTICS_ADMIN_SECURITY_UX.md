# ELECTROHUB — TASK 05.2: RECOMMENDATION MANAGEMENT, ANALYTICS, ADMIN SECURITY, SETTINGS & GLOBAL UX POLISH

**Phase:** 05 — Admin & Advanced Features\
**Task:** 05.2 — Final comprehensive Phase 05 implementation\
**Task type:** Frontend · Express API · Domain Services · Prisma/PostgreSQL · Authentication · Authorization · Brevo · AI Integration · Analytics · Product Operations · Accessibility · Responsive Design · Storybook · Playwright · Security · Performance · Documentation\
**Status:** NORMATIVE IMPLEMENTATION SPECIFICATION — not evidence of successful implementation\
**Prepared:** 2026-11-04\
**Branch:** `feature/05.2-admin-advanced-features` (**already exists** as of repository inspection; preserve/reuse it)\
**Base/target:** latest verified `origin/develop` → one task-scoped PR targeting `develop`\
**Existing approved work:** 05.1 merged in PR #44; preserve its code and accepted behavior, along with 04.2–04.7 and prior commerce/auth systems\
**Reviewer:** Principal Software Architect; review against required evidence, not checklist theater\
**Visual input:** `docs/assets/figma/exports/admin/screenshots/`, plus existing customer/component exports and `docs/assets/figma/FIGMA.md`; **NO live Figma link or Figma MCP connection required**\
**Scope:** One complete 05.2 handoff; sequential milestones **M0–M11**; each layer integrated and verified; no artificial split into future Phase 05 tasks\
**Release boundary:** No merging, production deployment, or direct production data changes by this task without separate explicit authorization.

> **North star.** Complete ElectroHub's advanced administrative capabilities with genuine security, trustworthy data, functional settings, configurable recommendations and a highly polished customer/admin experience. Preserve 05.1's visual identity and behavior. A polished screenshot with inert controls is a failure; a sophisticated backend without compelling, accessible browser-tested UI is also a failure. **First handoff must be production-quality and reviewable with concise, reproducible evidence.**

---

## 0. BASELINE VERIFICATION, GOVERNANCE, EXECUTION AUTHORITY

### 0.1 Repository-first: required first action before any implementation

Do not implement from this document alone, guess current code, generate migrations before inspection, or create a second implementation of accepted systems.

1. Read repository root `AGENTS.md`, applicable nested `AGENTS.md`, current developer and frontend-visual prompts, architecture/engineering standards, task 05.1 plan/acceptance evidence and relevant feature documentation. Follow their operative requirements; reconcile outdated descriptions against actual merged implementation.
2. Inspect `git status --short`, current branch, remotes, upstream, untracked files, current local and remote `develop` SHA, open PRs, and worktree ownership. `git fetch origin develop` safely; do not silently overwrite or stash another contributor's work.
3. **Reuse `feature/05.2-admin-advanced-features`.** At the 2026-11-04 read-only inspection, both its remote head and `develop` were `581726eff055db1dca4778c6e17ce86228509a1f`, and PR #44 was merged. These are historical snapshots—not authority to reset the branch. Recheck current heads before starting. Never `reset --hard`, force-push, recreate an existing branch, or silently rebase shared work. Use a safe worktree if existing changes need isolation.
4. Inspect exact code and dependencies for auth/login/register/refresh/Google/OTP/role, Prisma schema and migration ledger, backend admin service conventions, checkout quotes/payment snapshot, email/outbox, recommendations/AI, image-search processing, delivery and event logging.
5. Inspect the **actual image contents** and dimensions of every relevant Figma Make export; do not merely list filenames. Inspect the approved design tokens and live 05.1 components. Categorize each screenshot into: approved structural design, illustrative/demo data, supported features, newly required behaviors, intentionally omitted prototype elements.
6. Inspect Storybook 9 configuration, existing stories, Playwright projects/specs/harnesses, Vitest/Supertest patterns and authenticated DEV/test harness. Identify the shortest credible proof path for each milestone.
7. Identify environment identity safely: dedicated disposable PostgreSQL for migrations/destructive/negative scenarios; authorized shared Supabase DEV for read/live smoke; PROD read-only identity/preflight if explicitly authorized, **never test writes or ad-hoc migrations**. Document the real backend API target used by `localhost:3000`.
8. Prepare a concise M0 capability matrix (EXISTS / EXTEND / NEW / DEFER) per frontend, backend, Prisma, third-party integration and verification. Record precise API contracts and migration decisions before building broadly. Document security-sensitive architecture decisions and their tests up front.

Suggested non-destructive initial commands (adapt paths/shell to runtime):

```bash
git status --short
git branch --show-current
git remote -v
git fetch origin develop
git rev-parse origin/develop
git rev-parse feature/05.2-admin-advanced-features
git diff --stat
git ls-files --others --exclude-standard
```

### 0.2 Inspected baseline — provenance and precedence

- GitHub repo: `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`; current-development source is authoritative only after M0 revalidation.
- Merged PR #44: Task 05.1 is approved/committed/merged. Existing 05.1 `AdminLayout`, dashboard, catalog, categories, inventory, orders, customers, delivery integration, tests and Figma QA are **not** to be reopened without an actionable 05.2 dependency or actual bug.
- Existing `UserRole` values are `CUSTOMER`, `ADMIN`; preserve `ADMIN`, do **not** invent `ADMINISTRATOR`. `Role` relational model and `User.role` conventions must be honored.
- Existing auth: password login, verification/reset OTP, JWT, hashed rotating refresh tokens with `familyId` and successor lineage, per-user token-lifecycle locking, `SecurityEvent` types, Google/customer flows. Existing admin login currently uses ordinary password login; **all equivalent paths to full ADMIN tokens must receive the MFA gate**.
- Existing recommendations: five modes, FastAPI learned embedding path, SQL co-purchase/popularity and fallbacks, signed impression token, `RecommendationEvent` (`batchId/productId/eventType/mode/strategy/surface/rank`), consenting-customer `ProductInteraction`, `RecommendationPreference`. Do not duplicate the learned model or claim non-personal recommendation events prove order conversion.
- Existing checkout quote: `CheckoutService.get` delegates to `checkout.domain` `deliveryMethods` and `checkoutTotals`; user-visible Shipping Settings are meaningful **only after verified integration into quote and payment/order snapshot pipelines**.
- Existing frontend: React 19 / TS / Vite / React Router / React Query / SCSS Modules / Radix / Lucide / Framer Motion; Storybook 9, Vitest, Testing Library and Playwright. Backend: Express / Zod / Prisma / PostgreSQL / Vitest / Supertest; FastAPI separately owns model inference.
- Existing schema DOES NOT by itself establish an `AnalyticsEvent` warehouse, `AdminInvitation`, dedicated admin MFA factors, WebAuthn credential table, permanent store configuration or analytics conversion attribution. Propose additive changes only after verifying the branch's actual migration state.
- This document's proposed new API paths and models are **targets, not claims of current code**. M0 may adapt naming to established project conventions while preserving all externally observable acceptance behavior.

**Source-of-truth hierarchy:** verified current implementation plus real execution evidence → approved architectural/feature contracts and 05.1 acceptance → this 05.2 normative scope → roadmap goals → Figma Make screenshots for visual composition. Source screenshots are not proof of backend functionality. Existing approved architectural constraints take precedence over unsupported illustrative screenshot actions; record deliberate deviations.

### 0.3 Scope and protected boundaries

**05.2 MUST complete:** invitation-only admin onboarding; mandatory MFA/TOTP and recoveries; WebAuthn/passkeys; admin session list/revocation/login history; real profile/settings/notifications/shipping; recommendation strategy management, previews, pins/activity; trustworthy commerce/image-search/recommendation analytics; selected safe bulk actions; cross-application UI polish including accessibility, responsiveness, states and interaction performance; end-to-end verification.

**05.2 MUST NOT silently expand to:** public registration as ADMIN; a new arbitrary role hierarchy; payment/refund controller redesign; manual marking payments as succeeded; crypto/cookie changes weakening customer auth; live courier/fleet dispatch; retraining AI models; raw AI vector admin editing; replacing Leaflet/Socket.IO or 05.1; live Stripe charges; wholesale storefront redesign; production infrastructure rollout; a fake maintenance mode; unrelated SEO/CI/deployment rewrites; collecting identifiable behavioral analytics without consent.

**Phase 06 retains:** exhaustive cross-browser/system-wide release E2E, final independent security/performance/accessibility audits, production deployment and infrastructure validation, final documentation/roadmap release audit. 05.2 still must test every feature it changes; it cannot defer incomplete feature behavior to Phase 06.

### 0.4 Authority and stop conditions

- Authorized: inspect/reuse/fix task-scoped code, add migrations, build frontend/backend/AI integration changes, add tests, run disposable test stack, use correctly identity-verified DEV under allowed scope, prepare commits and open feature PR according to project workflow. **No automatic merge, forced push, production migration, seed into PROD, unrestricted DEV cleanup, real customer communications or production feature enablement.**
- Security boundary: no workaround to bypass MFA, no direct edits to `_prisma_migrations`, no force-resolving history/checksums, no broad production write despite a convenient MCP connection.
- Infrastructure blockers: identify the exact missing dependency/permission and supply the strongest available safe evidence; do not mislabel unrun tests as PASS. Do not waste time repeating identical unavailable commands.
- **Milestone review:** review each material security/API/migration boundary proportionately, fix real blockers promptly, carry accepted evidence forward if code/environment unchanged. No speculative audit loops.
- At final: Principal Architect independently reviews actual changed full files, relevant surrounding dependencies, required tests/CI and migration status; scores /100 and decides ✅ Approve / ⚠ Request Changes / ❌ Reject. No promise of 100/100 without evidence; aim for a first-pass approvable handoff.

---

## 1. PRODUCT OUTCOMES, INFORMATION ARCHITECTURE AND MODULE OWNERSHIP

### 1.1 Admin navigation, pages and user journeys

**Main:** Dashboard `/admin`; Products `/admin/products`; Categories `/admin/categories`; Inventory `/admin/inventory`.\
**Operations:** Orders `/admin/orders`; Delivery `/admin/deliveries`; Customers `/admin/customers`.\
**Growth & Insights:** Recommendations `/admin/recommendations`; Analytics `/admin/analytics`.\
**Administration:** Settings `/admin/settings`, with a team/invitations destination `/admin/settings/administrators`.\
**Account dropdown:** My Profile `/admin/profile`; Security `/admin/profile/security`; Active Sessions & Login History `/admin/profile/sessions`; Sign Out (existing confirmed action).

Use the established navigation configuration and `AdminLayout`; no parallel shell. Existing 05.1 routes/deep links, active state, collapse behavior, alerts menu, page headers and logout confirmation must remain valid. All new admin pages and APIs are ADMIN-only with any additional elevated permission enforced at the backend.

**Primary task journeys**

1. Existing eligible ADMIN logs in → password verified → server issues restricted MFA challenge, **not full ADMIN session** → TOTP or registered passkey verifies → full session → admin shell; MFA is required after session expiry, not just a client-side one-time banner.
2. Privileged verified admin → creates single-use expiring invitation → Brevo delivers → recipient opens invite → fills first/last/email/password (email invitation-bound) → verifies email/complete enrollment → enrolls/validates MFA → becomes actual `ADMIN` → can log in; invite is atomically consumed.
3. Administrator → Profile/Security → reauthenticate → add/verify/remove factor, create/revoke recovery codes, manage passkeys; cannot remove the last viable factor without an approved recovery path.
4. Administrator → Sessions → distinguish current from other session families → revoke one/all others → revoked access and refresh capabilities cease consistently; login history lists useful facts, not secret credentials.
5. Administrator → Settings → edit store information, configured timezone, compatible shipping rates and notification preferences → save/reload → verify checkout quote or email behavior really reflects supported changes. Unsupported controls are absent or explicitly read-only.
6. Administrator → Recommendations → configure supported modes per surface, inspect actual engine response and fallback, pin eligible products, preview without polluting analytics, publish configuration version → customer storefront reliably reflects it without violating consent or availability.
7. Administrator → Analytics → select period/currency → inspect correct revenue/order/catalog/inventory/recommendation/image-search/delivery reports and drill into source views → refresh without confusing loading flashes or fabricated metrics.
8. Administrator → select eligible products in paginated table → perform bounded atomic-or-truthful-partial action with confirmation and exact result. No arbitrary mass state overwrite.
9. Customer → normal authenticated shopping, consent-based recommendations, image search, checkout, delivery, account flows → sees polished, accessible UI; customer auth is unaffected by admin changes.

### 1.2 Ownership decisions fixed by this task

- **Recommendation Management is a dedicated operational page.** A small global availability/default readout and deep link may appear under Settings; per-surface strategy/pinning/previews/activity belong on Recommendations.
- **Operational dashboard ≠ historical Analytics.** Preserve the 05.1 dashboard's recent operational data; Analytics adds historical reporting and richer breakdowns. Do not duplicate a second `/admin` dashboard.
- **Personal Profile/Security/Sessions ≠ Store Settings.** Store settings are shared business configuration; personal security is per administrator. Team/invitations are an elevated administration capability.
- **Admin login remains password plus MFA by default.** Passkeys may operate as the second factor after primary proof; passwordless passkey sign-in is not necessary unless an explicitly threat-reviewed compatible extension is approved. Email OTP can support invitation/email verification and guarded recovery; TOTP is the primary app OTP for normal admin MFA.
- **Admin `ADMIN` ≠ automatic invitation superuser.** Define a durable elevated capability or designated bootstrap owner: existing eligible administrators may be approved to invite, while new invitees do not automatically get the authority to invite/revoke other administrators. Enforce on every sensitive API; avoid a new `UserRole` enum value just to represent owner privileges.
- **Design image layout is baseline, not ceiling.** Preserve visual identity, content composition and colors, but add meaningful states, interaction, responsive adaptation, performance and accessibility. Do not turn screenshots into static demos or fake sample data.

### 1.3 Observable completion criteria

- All M0–M11 gates and exact acceptance checklist in §16 have evidence.
- At least one fully verified invite → enroll MFA → login → manage session lifecycle end-to-end on disposable environment; DEV smoke where authorized.
- Recommendation configuration and pins materially alter actual authorized customer results, not only admin UI state.
- Analytics are reconciled to source rows, with precise denominators/windows and honest unavailable state where attribution is impossible.
- Shipping and settings are truly wired through supported business flows; no misleading fake Saves.
- Browser/Storybook comparisons, responsive and keyboard work and affected tests pass; CI green on PR final SHA before merge recommendation.

---

## 2. FIGMA MAKE SCREENSHOT INPUT, VISUAL STRATEGY AND REFINEMENT PERMISSION

### 2.1 Offline screenshots — exact repository inventory

Use `docs/assets/figma/exports/admin/screenshots/` on the checked-out branch. During 2026-11-04 repository inspection, the following 05.2 visuals were confirmed present:

| Actual screenshot filename | Visible reference content | 05.2 owning UI | Evidence required |
|---|---|---|---|
| `Admin login.png` | Centered ElectroHub Admin Portal, password/email form, blue CTA | `/admin/login` plus new MFA/register states | Reference-vs-live login screenshot; separate new OTP/invitation/passkey stories |
| `Analytics page.png` | Headline, 7/30/90/12-month control, KPI cards, sales chart, top product/category panels | `/admin/analytics` overview | Matched above-the-fold desktop and drilldown states |
| `Analytics_page.png` | Scrolled analytics panels, top products/categories, customer growth, repeat customers, session duration illustration | `/admin/analytics` below fold | Scrolled matched capture; honest replacement of unavailable session duration |
| `Settings page.png` | Store tab, store name/email/phone/address fields | `/admin/settings?tab=store` | First viewport, editing/validation and save states |
| `Settings_page.png` | Lower Store fields: currency, timezone, save | Store tab scrolled | Reference placement; currency read-only if backend fixed |
| `Settingspage.png` | Notifications tab with email preferences, maintenance-mode illustration, digest | Notifications tab | Keep approved operable preferences; omit fake maintenance toggle |
| `Settings-page.png` | Shipping tab, threshold/rates, method options | Shipping tab | Save, quote consistency, real component and responsive proof |

Also inspect 05.1 screenshot exports for shell/shared layout and cross-page regression: `Dashboard page.png`, `Dashboard_page.png`, `products page.png`, `products_page.png`, `Create Product.png`, `Edit product.png`, `Delete product.png`, `Categories page.png`, `Add category.png`, `Edit category.png`, `Inventory page.png`, `Inventory_page.png`, `Orders page.png`, `Order details page.png`, `Order_details_page.png`, `Delivery page.png`, `Customers page.png`. The screenshot folder can evolve; M0 inventories current exact names and pixel dimensions instead of assuming these historical lists remain complete.

The owner's supplied Figma Make images visibly include a floating `Customer / Admin / Flows / Components` preview selector. **Never implement that selector in the actual product.** Screenshot currencies, revenue charts, user names, product counts, address and period deltas are demonstration visuals; real implementation requires actual data or truthful empty states.

**There is no required visual screenshot for Recommendations, Admin Invitations, MFA entry, passkey enrollment, sessions, login history or bulk actions.** Design new views in established visual grammar; do not claim pixel matching to screenshots that do not exist. Create task-specific stories/synthetic visual captures for these new screens.

### 2.2 Source hierarchy and permitted creative expansion

Read `docs/assets/figma/FIGMA.md`, current tokens and shared components. Figma Make screenshot exports are the **sufficient implementation visual reference** for 05.2; no live Figma design link/access is a prerequisite. Do not claim to have inspected variables from a live design link if only screenshots were used.

**Must preserve:** ElectroHub logo/brand, established #2563EB primary family and semantic tokens, white content surfaces, pale gray dividers/table filters, sidebar/header arrangement, clear Poppins body/headings with mono only for suitable technical data, square-corner system where current ADR/tokens require it, blue active nav, restrained card borders/icons, information hierarchy and real 05.1 components.

**Allowed and expected:** polished spacing/typographic hierarchy, subtle focus/hover/pressed/disabled states, more meaningful content and data density, better chart controls, real filtering, accessible modals, drag-free keyboard-friendly pin ordering, inline validation, help content, progressive disclosure, unobtrusive toasts, meaningful skeletons, responsive mobile transformations, security state feedback, device/session cards, real no-data states, constrained animations honoring reduced motion.

**Not allowed without architecture/design review:** replacing ElectroHub's design system with Tailwind/shadcn/MUI/Bootstrap, radical color/layout changes, randomized motion, arbitrary decorative backgrounds, clickable placeholders, fake MFA success, fake chart statistics, UI controls that cannot persist or apply, broad refactor of accepted 05.1 modules without an actual defect.

### 2.3 Required visual implementation loop

```text
Read exact image PNG + approved tokens + existing 05.1 shell
    → compare actual current UI against design and task requirements
    → label KEEP / ADD / REFINE / OMIT with rationale
    → implement REAL reusable component and real API wiring
    → render component and all states in existing Storybook 9
    → capture Playwright image at reference image viewport
    → compare placement, spacing, colors, typography, geometry and hierarchy
    → correct unintentional mismatches, log intentional premium expansions
    → verify actual DOM and real browser flows at localhost:3000
    → keyboard/focus/reduced motion/mobile/zoom/error/retry/security QA
    → evidence manifest + Architect review
```

**No screenshot comparison alone can prove behavior.** Capture both static visual and live integration proof; use `pixelmatch`/image overlays and DOM bounding rectangles where useful, but do not set absurd universal pixel thresholds for dynamic data. Record the reference screenshot dimensions, actual browser CSS viewport/device scale, scroll offset and significant intentional deviations.

### 2.4 Component/state and interaction policy

Every meaningful new or touched screen must implement: initial loading geometry-preserving skeleton, background refetch preserving valid rows, empty-first-use, zero search results, partial aggregation failure, general error/retry, 401/403, conflict/stale edit, pending and duplicate-save prevention, successful save feedback, destructive/privileged confirmation, session expiry/recoverable auth interruption, long content and responsive layout.

- Tables: accurate server totals, stable server-side sorting/filtering, debounce search with cancellation and query-key correctness, pagination that restores the top of the admin **page content** (not necessarily the browser chrome) without trapping focus, keyboard-accessible controls; avoid unbounded option menus, search waterfalls and blank full-page loaders during ordinary tab/page changes.
- Forms: labels, hints, inline server-compatible validation, dirty state/nav confirmation, password manager compatibility, visible caps-lock indication where helpful, keyboard/focus preservation, no sensitive values in browser logs, explicit optimistic concurrency handling.
- Dialog/menu/tab: Radix-style accessible semantics, label/description, focus initial/restore and trap where required, Escape behavior, no animation in reduced motion, sufficient viewport scroll at 200% actual browser zoom, no clipped dropdowns, no hover-only affordances.
- Cards and charts: meaningful hover/focus if actionable; non-interactive KPI cards must not appear clickable. Use proper charts with data/axes/descriptions, format decimal+currency correctly, ensure screen-reader accessible summaries and empty/error states.
- Security UX: don't disclose whether a particular email has an account in public errors; disable controls while pending; copy/passkey/recovery code flows need concise and truthful feedback; no leaking invitation tokens after acceptance.

### 2.5 Responsive matrix

| Width / mode | Requirements |
|---|---|
| 390 CSS px | Mobile drawer; single-column forms/cards; scrollable concise data tables or accessible card alternatives; overlays/dialogs fully operable; no body horizontal overflow, no unreachable submit |
| 768 CSS px | Tablet nav transition; flexible two-column grids only when content fits; usable charts/filters; mobile keyboard and sticky actions |
| 1440 CSS px | Desktop layout and Figma hierarchy; no excessive blank space; meaningful table/action density |
| 1920 CSS px | High-fidelity Figma Make composition; restrained max width, aligned KPI/chart panels and sidebar |
| Actual 200% browser zoom | Admin invitations, OTP/MFA, login, Settings forms, recommendation selection dialogs and charts remain operable; real zoom is distinguished from simulated viewport resizing |
| Reduced motion | `prefers-reduced-motion: reduce` removes nonessential animation while preserving state change clarity |
| Keyboard-only | Tab/Shift+Tab, arrows for tabs/menus, Enter/Space, Escape, focus return, visible focus/skip link, no traps |

---

## 3. NON-NEGOTIABLE ARCHITECTURE, SECURITY AND BUSINESS INVARIANTS

### 3.1 Layer ownership

```text
React pages / feature components / React Query typed hooks / Storybook
       ↓ HTTPS JSON; auth/cookie and proper CSRF/CORS behavior
Express routers (requireAuth + ADMIN + MFA assurance + permission + Zod + rate limits)
       ↓
Controllers (thin) → domain services (enforce policies, idempotency, concurrency)
       ↓
Prisma transactions / repositories → Supabase PostgreSQL (strictly identified environment)
       ↘ AI client (FastAPI, restricted) / Brevo / Stripe Test Mode / Socket.IO
```

Never make privileged frontend direct Supabase DB writes. Never copy an old service's business logic into a second controller. Preserve established response envelopes, errors, role checks, session ownership, idempotency, cleanup and privacy boundaries. Never store raw JWTs, passwords, OTPs, TOTP secrets, passkey private keys, invitation tokens, image uploads, card data or unnecessary PII as analytics.

### 3.2 Financial and commerce safety

- Provider-authoritative payment state, Stripe verified success, immutable order line snapshots, order totals and inventory reservation remain owned by existing services. Settings must not rewrite historical order shipping charges or trigger payment status changes.
- Checkout shipping prices and eligibility are resolved server-side from a versioned/validated settings snapshot in the same logical quote/payment flow; stale quote/config conflicts follow existing safe retry policy. Re-evaluate price/quote at final order creation as the existing checkout architecture requires. No direct browser trust of rate.
- Recommendations return only currently eligible public catalog products, respect stock/status/category/fixtures/media readiness and consent. Pins cannot make an archived/out-of-stock item purchasable or expose personal rails to nonconsenting users.
- Analytics reads business records and trusted events. No finance writes, no inventing paid orders, no rewriting delivery history, no echoing confidential customer data into dashboards or screenshots.
- Cart, wishlist, customer orders/exports/invoices, customer password/reset/Google and delivery Socket.IO/Leaflet behavior remain backward compatible except strictly required cross-cutting corrections.

### 3.3 Security essentials

- **MFA is enforced server-side for every ADMIN session creation and sensitive mutation**, including legacy `/api/auth/login`, refresh, existing Google paths if they can ever issue ADMIN sessions, account verification, password reset, old refresh families and role changes; only a narrow pre-auth state can reach enrollment/challenge endpoints.
- No arbitrary self-registration as ADMIN. No client-chosen role/permission, role from verified database session only. Protect invitation creation with designated owner/admin-invite permission + recent verified MFA, not role alone when sensitive ownership controls apply.
- Temporary pre-auth tokens/challenges cannot authorize `/api/admin/**`, recommendation/config writes, profile changes beyond explicit enrollment, session issuance or refresh; bind to user, purpose, nonce, expiration, verified primary proof and one-use consumption.
- Rotate session on MFA success, invalidate stale pre-auth attempts, and enforce session revocation on both access and refresh. Do not rely only on client state or a mutable `mfaVerified` UI flag.
- Registration, recovery and invite endpoints have email enumeration-safe public responses, CSRF/origin checks where cookies used, strong per-IP/account rate limits, lockout/backoff and monitoring without leaking identities.
- Security events are append-only sanitized facts; never log raw codes, headers, personal addresses, device fingerprint or invitation URL query token. Distinguish customer behavioral analytics from admin security audit.

### 3.4 Scalability and correctness

- Bounded query page sizes, sort whitelists, real DB aggregation, no N+1 in lists, no full-scan unfiltered events and indexes justified by real `EXPLAIN`/test evidence.
- Time windows are explicit, timezone-safe (store UTC instants; display IANA zone; DST rules), deterministic inclusive/exclusive bounds and reliable mixed-currency grouping.
- React Query keys include all filters/period/currency/permission/session scope; stale/private data removed on logout, MFA failure, account switch or admin downgrade. No request storms and no concurrent duplicate queries on tabs/pagination.
- Secrets encrypted at rest where necessary with a dedicated managed/versioned encryption key, separate from public JWT; hash tokens/recovery material using appropriate deterministic secure digests where equality lookup required. Key rotation and recovery runbook are specified.
- No broad `SELECT *` of sensitive user records. No external AI service gets private identity/OTP/profile values beyond its approved pseudonymous inputs.

---

## 4. DATA MODEL AND MIGRATION DESIGN — PROPOSED, SUBJECT TO M0 CONTRACT

Existing `User`, `Role`, `RefreshToken`, `OtpChallenge`, `SecurityEvent`, `RecommendationEvent`, `ProductInteraction`, `Order`, `OrderItem`, `Payment`, `Inventory`, `Delivery`, and media tables remain authoritative. All new entities below are **conceptual targets**, not license to create duplicated tables. Inspect migrations, FK cascades, lengths, index order and actual Prisma names before finalizing. Design a small number of coherent additive migration batches with independently reviewed risks.

### 4.1 Administrative identity and access

| Candidate entity/change | Required persistence and safety | Relationship / lifecycle |
|---|---|---|
| `AdminInvitation` | id UUID, normalized recipient email, token hash/digest unique, invitedByUserId, status or accepted/revoked timestamps, expiresAt, createdAt, lastSentAt, resend generation, invited user reference where accepted; idempotency/correlation | Unique active invite policy; expiration/revoke/accept atomic; restrict invite target to exact email; prevent double redemption and replay; retention/cleanup |
| `AdminAccountSecurity` or equivalent | userId unique, mandatory MFA enrollment state, activation/verifiedAt, bootstrap-owner flag or separate permission grant, security revision | Enforce privilege from DB at every request; no PUBLIC admin activation before factor proof; prohibit final owner lockout |
| `AdminMfaFactor` | userId, type TOTP, encrypted secret + encryption-key version, enrolledAt, verifiedAt, disabledAt, lastAcceptedTimeStep; never plain OTP | Verify onboarding before active use; allow multiple active factors; only server creates/resets; replay resistance |
| `AdminRecoveryCode` | factor/account relationship, one-way protected hash, createdAt, consumedAt/revokedAt, batch version | Single use; one-time presentation; strong reauthentication for regeneration; no plaintext retrieval |
| `AdminWebAuthnCredential` | userId, credential ID unique, COSE public key, counter metadata, transports/backup flags, label, createdAt, lastUsedAt, revokedAt | Challenge-bound RP/origin checks; safe counter semantics and user verification; device-specific revoke |
| `AdminAuthChallenge` | challengeHash/opaque ID, userId, purpose, primary-proof state, allowed factor, expiry, attempts, consumedAt, bound nonce/operation, limited protocol metadata | May reuse/extend `OtpChallenge` only where semantics fit; WebAuthn challenges may need separate typed record; no raw session elevation |
| `AdminSession` metadata | userId, refresh `familyId` unique, MFA method/assurance, createdAt, lastSeenAt, revokedAt/reason, sanitized device/browser and approximate location if privacy-safe | Link refresh rotation lineage to session; server request checks actual session validity; revoke family + access together |
| `AdminSecurityAudit` or appropriate reuse of `SecurityEvent` | actor/resource/action/outcome, timestamp, correlation, sanitized approximate origin, no secret payload | Record invitations, factor changes, recovery, login failures, session revocations, permission/owner changes |

**Design constraints:** The existing `SecurityEventType` enum currently lists login success/failure, logout and account/account-credential changes. Extending it for admin-specific events is permitted with safe additive migration, but existing account consumers must not break. Do not force every catalogue operation into SecurityEvent. Reuse the per-user lifecycle lock/row-lock ordering from `auth.repository.ts` to avoid deadlocks between session issuance, refresh rotation, account deletion and MFA changes. Any admin session metadata must integrate existing `RefreshToken.familyId`, not introduce an incompatible alternate refresh-token system.

**Owner/bootstrap policy:** Designate the first operator-authorized bootstrap admin as an owner using durable capability state. A second verified owner should be enrollable before disabling any legacy bootstrap path. The bootstrap flow is non-public, one-time, identity-gated and logged. Only owners, or specifically delegated users with a reviewed `MANAGE_ADMINS` capability, can invite/revoke admins. Changing this capability requires owner + fresh MFA. General `ADMIN` role alone does not authorize removal of last active owner or last usable MFA factor. Do not casually create a new global `UserRole` enum entry.

**Existing-account migration:** Add schema compatibly without turning off access before enrollment path is available. Stage credentials/invitations, allow *only* restricted temporary MFA enrollment for designated existing admins, require proof of prior credentials and an out-of-band operator authorization/recovery plan, then enforce full MFA for all ADMIN protected API issuance and subsequent refresh; explicitly revoke or upgrade old admin sessions at cutover. No permanent “grandfathered no MFA” exception. DEV bootstrap and disposable harness continue securely without default production credentials.

### 4.2 Store, user preferences, shipping and notification settings

| Candidate entity | Fields / meaning | Rules |
|---|---|---|
| `StoreSettings` (singleton or typed versioned config) | store name, public support email/phone/address, display IANA timezone, fixed supported currency, configuration version, actor/updatedAt | Schema validation, admin permission, optimistic concurrency, audit; currency read-only unless existing price/payment accounting supports changing it safely |
| `ShippingConfiguration` or versioned subdocument | delivery method ID/name, eligible regions, standard/express/overnight rates actually supported, free threshold, method enabled, currency, version, effectiveAt | Decimal-safe nonnegative rates, consistent checkout/attempt/order snapshot, historical charges immutable, atomic activation, rollback-forward repair |
| `AdminNotificationPreference` | userId, operational email toggles, optional digest frequency/interval, updatedAt | Per-admin preferences. Never disable security-critical alerts or customer transactional messages; no fake channel if worker absent |
| `StoreSettingsAudit` or generic typed configuration audit | actor ID, config key, safe before/after or version refs, action, time, request ID | No secrets/PII beyond minimum; searchable for operations; version-aware rollback only where safe |

**Maintenance mode:** The Figma toggle is **not** a requirement to create fake functionality. Omit it unless a separate fully safe, tested infrastructure mechanism is explicitly approved; no silent global storefront outage.

**Admin digest emails:** Include the control only when scheduled delivery, recipient prefs, opt-out behavior, template, backoff, rate, Brevo and worker/orchestration path are fully functional. Otherwise mark as explicitly omitted with reason, rather than a decorative checkbox.

### 4.3 Recommendation configuration and featured product eligibility

| Candidate entity | Purpose and constraints |
|---|---|
| `RecommendationConfiguration` | Per surface/rail (`home`, `product_detail`, `cart`), supported `RecommendationMode`, enabled flag, approved strategy/fallback, server cap, product count, version, effectiveAt, editedBy; no arbitrary prompt/ranker replacement or anonymous customer profiling |
| `FeaturedProductPin` | canonical `productId`, placement/surface/slot, priority/order, startsAt/endsAt nullable, enabled state, version, editor, timestamps; uniqueness per active placement as required |
| Configuration change audit | actor, old/new normalized policy, version, reason, timestamp; rollback by explicit compensating write, not hidden history rewrite |

**Algorithm compatibility:** Existing five modes are `SIMILAR_PRODUCTS`, `YOU_MAY_ALSO_LIKE`, `RECOMMENDED_FOR_YOU`, `FREQUENTLY_BOUGHT_TOGETHER`, `POPULAR_PRODUCTS`; existing strategies include embedding, hybrid, co-purchase, measured popularity and fallbacks. Only expose combinations supported by the current engine. Product-detail anchored strategies must have an anchor, cart co-purchase requires cart context, personalized mode must have opt-in/customer context. An admin setting cannot turn rules-based fallback into a false claim of machine-learned personalization.

**Featured placement:** A pin is an **explicit merchandising placement** with correct user-facing labeling; it must not covertly impersonate personalized ML ranking. The service validates current active product/category, fixture exclusion, stock/readiness, deduplication and current eligible catalog both when saving and when serving. Expired/unavailable pins are skipped without making the whole rail fail. If actual impression/click attribution is recorded, pin metadata is accurately distinguishable from organic recommendation strategy; never count preview impressions.

### 4.4 Analytics and conversion events

| Candidate entity or view | Purpose / required fields |
|---|---|
| `AnalyticsEvent` | Controlled event type; source (`SERVER`/trusted client with signed context), occurredAt/receivedAt, idempotency key, resource IDs with bounded referential retention policy, short bounded metadata schema/version, non-identifying subject where permitted, consent class; indexes for type/date/surface |
| `ImageSearchEvent` or narrow AnalyticsEvent subtype | search requested/completed/failed, server result count, duration bucket/ms, model/version or failure category, anonymous request/correlation ID and optional selected product **only with legitimate bounded attribution**; **never raw image or upload data** |
| `RecommendationConversionAttribution` if supportable | Trusted click/impression context, consenting customer or genuinely safe pseudonymous linkage, order/orderItem and purchase confirmation reference, expiry window, attribution model, uniqueness/idempotency | Only count after authoritative paid status; avoid retroactive guesswork, duplicate conversions, absent consent and unattributed anonymous claims |
| `AnalyticsDailyAggregate` (optional) | Granular metric+date+currency+dimension+definitionVersion, source watermark, computedAt, exact-backfill policy | Create only for demonstrated slow bounded queries; reconciliation and idempotent recompute required |

**No duplicate event storage:** Reuse existing `RecommendationEvent`, `ProductInteraction`, `DeliveryEvent`, `Order`, `Payment` and `Inventory`; new instrumentation only fills missing data. The existing non-personal recommendation batch events contain no session/user ID, so they support impressions/CTR, **not** directly paid-order conversion. Implement a separately privacy-validated, consented, trusted click→conversion link (explicit attribution window and model), or label conversion **NOT AVAILABLE / INSUFFICIENT ATTRIBUTION**. Do not fabricate it.

**Historical metrics:** Where an OrderItem lacks immutable category-at-time-of-purchase metadata, current-category classification is only a current-taxonomy report; it cannot be called historical purchase category. If historical truth is required, add a compatible snapshot to new orders and explicitly mark legacy unknown/unattributable rows; never rewrite old orders with guessed categories. Historical missing image-search events likewise cannot be synthesized into “last year” statistics.

### 4.5 Prisma/migration workflow and environments

1. M0 inventory `apps/backend/prisma/schema.prisma`, migrations and actual DEV ledger (`_prisma_migrations`) using the established identity verification and permissions. Distinguish code schema, applied DEV, applied PROD and historical documentation; never assume all sync by default.
2. Design minimal additive schema, foreign keys, unique/indexes, encryption metadata, enum extensions where unavoidable. Document migration impact: lock/backfill, old-version reader/writer compatibility, rollback/forward repair, functional cutover and partial-deployment failures.
3. Create deterministic Prisma migrations (no untracked direct DDL); run `prisma generate`; test clean database and upgrade from current baseline in **disposable PostgreSQL**. Validate ledger checksums and second `migrate deploy` no-op. Explicitly inspect DB-level check/uniqueness constraints where Prisma limitations apply.
4. Deploy DEV via authorized verified DEV migration gate/workflow after approval/preflight; reconcile schema and runtime status, including new endpoints. Shared DEV reads for smoke are allowed with verified identity; fixture writes must be scoped, recorded and reversible where safe.
5. Ensure production workflow can deploy reviewed migrations through its safety gates when separately authorized for release; do not manually apply to PROD or mark ledger rows applied. Any PROD observation must be read-only and permission-authorized.
6. Provide operational recovery for lost encryption key, failed migration, unfinished invitations, MFA cutover and config rollback without weakening policy. Distinguish rollback of app code from non-destructive forward repair of an applied database migration.

**Explicit exclusion:** Never run `prisma db push` to avoid migration history; never edit `_prisma_migrations` rows; never copy PROD credentials into DEV scripts or output logs; never run production seed scripts or mass QA cleanup. If Supabase MCP/plugin is available use its identity/permission boundary, not apparent connectivity as authorization.

---

## 5. API CONTRACT MAP — FINAL NAMES RECONCILED IN M0

All new `GET /api/admin/**` routes require `requireAuth`, DB-backed role `ADMIN`, completed MFA assurance and `Cache-Control: private, no-store`; writes additionally require permission, recent MFA step-up where indicated, strict Zod/DTO whitelist, rate limits, CSRF/origin controls where relevant, optimistic concurrency/idempotency and sanitized audit. Common API conventions and error envelopes must be verified against existing `admin.routes.ts`; use one coherent router/service architecture, not conflicting duplicates.

### 5.1 Pre-auth administrator login, invite redemption, MFA and passkey ceremonies

These illustrative public/onboarding paths **must not be mounted behind normal completed-admin middleware**, but each path must enforce the correct limited-purpose proof and never return admin data or session prematurely.

| Method + proposed path | Authorization | Response/behavior | Essential failure cases |
|---|---|---|---|
| `POST /api/auth/admin/login/start` or compatible extension of existing `/api/auth/login` | Anonymous + hardened rate limit | Validate email/password and DB ADMIN; return restricted one-use MFA transaction ID, available factors (non-enumerating public behavior), no access/refresh token | Invalid generic 401, locked 429, not active, not enrolled bootstrap restrictions |
| `POST /api/auth/admin/login/verify-totp` | Restricted valid challenge | Constant-time TOTP validation, replay prevention, consume transaction, issue MFA-assured server session | 400 invalid, 401/410 expired, 409 consumed, 429 attempts |
| `POST /api/auth/admin/login/verify-recovery` | Restricted valid challenge | Consume one hashed recovery code atomically and start verified admin session | Already used, revoked, no valid challenge |
| `POST /api/auth/admin/mfa/enrollment/start` | Restricted authenticated onboarding/recent step-up | Produce TOTP provisioning information once, expiring, bound to user; never log QR secret | Expired/unauthorized, duplicate active enrollment |
| `POST /api/auth/admin/mfa/enrollment/confirm` | Restricted enrollment state | Validate consecutive/reliable TOTP code, activate factor atomically, regenerate/reveal single-use recovery batch, advance account eligibility | Wrong code, replay, expiration, race |
| `POST /api/auth/admin/webauthn/{registration,authentication}/options` | Corresponding restricted stage/recent MFA | Generate server-saved RP/origin-bound challenge and allowlisted credential options | Invalid origin/RP, no credential, too many attempts |
| `POST /api/auth/admin/webauthn/{registration,authentication}/verify` | Corresponding challenge | Cryptographically validate WebAuthn attestation/assertion, origin/RP ID, user verification, challenge, credential ownership/counter; issue session only after verified login ceremony | Replay, foreign credential, invalid signature, wrong RP/UV |
| `GET /api/auth/admin/invitations/:token/preview` | Rate-limited anonymous link | Return only safe invitation context and status; do not leak other admin identities | Generic expired/invalid/revoked |
| `POST /api/auth/admin/invitations/accept` | Valid one-time invitation | Validate invitation-bound email, new first/last/password, atomic pending ADMIN + consume token, launch email/MFA enrollment; NO normal admin session yet | Duplicate email/account collision, token replay/expiry, TOCTOU |
| `POST /api/auth/admin/onboarding/verify-email` | Bound onboarding transaction | Verify email ownership with approved Brevo/OTP mechanism; restrict state | OTP mismatch, expired, repeated, delivery error |

**Mandatory compatibility route audit:** Inspect and secure existing `/api/auth/login`, `/api/auth/refresh`, `/api/auth/register`, Google completion/link, password reset/verify, `/api/auth/me`, account email changes and session restore. No alternate route can mint an ADMIN-completed token from password alone. Customer flows continue using their established contracts. Choose whether to reuse `/api/auth/login` with `requiresMfa` response (prefer minimizing duplicate credential verification) or create a dedicated admin start route; do **not** leave legacy bypass intact.

**Session assurance:** Access-token claims alone are insufficient for revocation. Bind admin tokens to a valid active DB session/family and verified MFA assurance/time; middleware must consult authoritative current session revocation (with safe caching invalidation if needed). Refresh must check same assurance and session state. Account deactivation, credential changes, role downgrade and MFA reset must revoke affected families. Failure is closed, not soft fallback.

### 5.2 Secure admin team/invitations APIs

| API | Purpose | Required guard |
|---|---|---|
| `GET /api/admin/administrators` | List minimal admin team status, invitation and MFA-enrolled flags (no secrets) | ADMIN + `MANAGE_ADMINS`; bounded page/sort/filter |
| `GET /api/admin/invitations` | List issued invites and safe delivery state | `MANAGE_ADMINS`; no raw token or full URL |
| `POST /api/admin/invitations` | Create invitation for exact normalized email; generate secure token, record hash, enqueue Brevo email | `MANAGE_ADMINS` + fresh MFA, uniqueness/idempotency and rate limit |
| `POST /api/admin/invitations/:id/resend` | Invalidate older token and issue replacement atomically | Same strong guard; cooldown/backoff; never show raw URL in logs |
| `POST /api/admin/invitations/:id/revoke` | Revoke outstanding invite without deleting audit history | Same; only pending invited target; idempotent |
| `PATCH /api/admin/administrators/:id/access` | Restricted disable/enable/grant if explicitly approved | Owner-only + recent MFA; no self/last-owner lockout; revoke sessions as required |

### 5.3 Profile, security, sessions and audit APIs

| API | Purpose | Required guard |
|---|---|---|
| `GET /api/admin/me/profile` | Safe admin identity, factor status, preferences, capability flags | MFA-assured self only |
| `PATCH /api/admin/me/profile` | Allowed profile fields, verified-email-change workflow | Self + reauth where sensitive; optimistic concurrency |
| `POST /api/admin/me/security/step-up` | Confirm recent password/MFA; issue limited short-lived step-up transaction | Live admin; rate-limit; never broad fresh token |
| `GET /api/admin/me/security/factors` | List enrolled TOTP/passkey metadata and recovery availability | Self, completed session |
| `POST /api/admin/me/security/totp/start|confirm|disable` | Enroll/verify/disable TOTP | Step-up; last viable factor protected |
| `POST /api/admin/me/security/recovery/regenerate` | Revoke old batch, generate/reveal replacement once | Strong step-up; explicit confirmation |
| `GET /api/admin/me/security/passkeys` / `DELETE /.../:credentialId` | List/revoke labeled WebAuthn authenticators | Self; recent MFA for revoke; protect final factor |
| `GET /api/admin/me/sessions` | Paginated session families, current device, created/lastSeen and assurance | Self; private no-store |
| `DELETE /api/admin/me/sessions/:familyId` | Revoke specific session family, including access token checks | Self; step-up for others if policy requires; safe current-session transition |
| `POST /api/admin/me/sessions/revoke-others` | Revoke all except current validated family | Self + step-up; atomic token lifecycle |
| `GET /api/admin/me/login-history` | Sanitized bounded recent auth/security events | Self; private no-store and retention |

**Errors and responses:** use project-standard `{ data, meta? }` / `{ error: { code, message } }`; distinguish 400 invalid payload, 401 missing/expired primary/MFA, 403 role/permission/assurance forbidden, 404 nonexistent/private, 409 conflict/replay/stale version, 410 expired invite where enumeration policy allows, 422 unsupported factor, 429 abuse, 503 Brevo/provider outage. Never expose passkey verifier internals, secret material or raw DB exceptions.

### 5.4 Settings APIs

| API | Behavior |
|---|---|
| `GET /api/admin/settings/store` | Authoritative singleton config + `version`, supported currency and IANA zone; private no-store |
| `PATCH /api/admin/settings/store` | Zod allowlist and `expectedVersion`; optional verified contact changes; audit |
| `GET /api/admin/settings/shipping` | Real supported delivery methods, prices, currency and version |
| `PATCH /api/admin/settings/shipping` | Validated rates/method flags/threshold; publish atomically; checkout compatibility; source of truth for future quotes |
| `GET/PATCH /api/admin/me/notification-preferences` | Self-only email preferences; no ability to suppress mandatory security mail |
| `GET /api/admin/settings/recommendations` | Optional read-only status/deep link, actual recommendation configuration is handled by §5.5 |

### 5.5 Recommendation Management APIs

| API | Behavior |
|---|---|
| `GET /api/admin/recommendations/overview` | Bounded real activity: request counters only if instrumented, impressions, clicks, CTR, fallback/no-data, version/health, period/surface; no fake conversion |
| `GET /api/admin/recommendations/configurations` | Per-surface modes, strategy/fallback allowlist, limits, flags, versions |
| `PATCH /api/admin/recommendations/configurations/:surface` | Whitelisted settings with expected version, checked mode/context and audit; no setting can bypass consent |
| `GET /api/admin/recommendations/preview` or safe POST | Read-only true-engine preview by product/cart fixture/context, explicit synthetic context; never record user impressions or customer clicks |
| `GET /api/admin/recommendations/featured` | Bounded, filtered pin list with product/public eligibility and schedules |
| `POST /api/admin/recommendations/featured` | Pin eligible product to allowed surface/slot/order/schedule, optimistic lock/unique policy and sanitized audit |
| `PATCH /api/admin/recommendations/featured/:id` | Edit schedule/priority/status; 409 conflict on concurrent update |
| `DELETE /api/admin/recommendations/featured/:id` | Unpin/disable without deleting historical attribution or order records |
| `GET /api/admin/recommendations/activity` | Actual recorded impression/click breakdown with period, surface, strategy and product drilldowns; protect privacy |

Public/current customer recommendation routes (`/api/products/:slug/recommendations`, `/api/recommendations/popular`, `/api/recommendations/cart`, `/api/me/recommendations`, recommendation event/preferences endpoints) remain compatible; their internal server policies honor published admin configuration where supported. Avoid per-request unnecessary DB reads via coherent bounded caching with invalidation/versioning, and validate eligibility again before response.

### 5.6 Analytics endpoints and event ingestion

| API | Authoritative purpose |
|---|---|
| `GET /api/admin/analytics/overview?period&currency&zone` | Paid revenue, orders, AOV, customers and previous-period comparison with definitions |
| `GET /api/admin/analytics/revenue?period&currency&interval` | Time-series paid totals and count, refund-aware labels and reconciliation |
| `GET /api/admin/analytics/orders?period&status` | Canonical status distribution, paid vs created, eligible transitions |
| `GET /api/admin/analytics/products?period&sort&page&pageSize` | Top sold products/units/paid value; interaction metrics only if trusted events exist |
| `GET /api/admin/analytics/categories?period&basis` | Current-catalog taxonomy or immutable-at-purchase snapshot, clearly differentiated |
| `GET /api/admin/analytics/inventory?period` | Current stock, low/out counts and historical changes only if stored |
| `GET /api/admin/analytics/recommendations?period&surface` | Impressions, clicks, deduped CTR, fallback/mode usage, attributable purchases when supportable |
| `GET /api/admin/analytics/image-search?period` | Server-validated requests, success/no-result, selection and latency (only measured) |
| `GET /api/admin/analytics/deliveries?period` | Active/complete counts, status distribution and punctuality when ETA data supports it |
| `GET /api/admin/analytics/customers?period` | New registrations, repeat *paid* purchasers, cohort definitions if supportable |
| `POST /api/analytics/events` (narrow controlled) | Only allow safe client-side low-risk events with signed context/consent, strict type/metadata caps, one-use/idempotency and rate limits; **no client-authoritative payment/fulfillment** |

For each endpoint, document exact parameter enum bounds, default period, UTC date-bound math, IANA display zone, max response rows, currency, inclusion/exclusion, zero-denominator semantics, freshness/lag watermark and privacy threshold when appropriate. Backend should use sanitized DTOs and SQL/Prisma whitelists only.

### 5.7 Bulk product actions (selected safe operations only)

| API | Business contract |
|---|---|
| `POST /api/admin/catalog/products/bulk-status` (proposed) | Explicit array of capped IDs + requested ACTIVE/INACTIVE + per-item expected version; existing archive/reactivation policy, not hard delete; detailed per-item success/conflict/error |
| `POST /api/admin/recommendations/featured/bulk` (optional only if useful) | Add/remove pins with existing validation and capped batch; safe idempotency |

No arbitrary bulk mutation for customers, orders, payment or inventory. Backend never accepts “all matching” as unbounded bulk operation unless an architect-approved server-side selection manifest and immutable query snapshot design exist. UI makes current-page selection vs all-matching explicit.

---

## 6. MILESTONES M0–M11 — ONE COHERENT TASK, FULL STACK AND VERIFIED

The milestone order is dependency-aware, but parallelize safely isolated discovery/UI stories/contracts when possible. Do **not** separately ship partial 05.2 features that depend on unfinished server security. Each milestone produces: changed-file summary, actual API/schema effects, focused test results, browser/story evidence, known risks and remaining actions. A milestone claiming PASS must satisfy its concrete acceptance conditions.

### M0 — Repository inspection, gap analysis, UI contract and risk map

**Goal:** establish the precise merged baseline and eliminate false assumptions before implementation.

**Frontend inspection**
- Read 05.1 `AdminLayout`, navbar, `AdminLoginPage`, `AuthContext`, `ProtectedRoute`, 05.1 dashboard, DataTable, popup/modal/drawer primitives, SCSS tokens and existing React Query hooks. Record which components need additive changes and which must remain untouched.
- Map all exact 05.2 screenshot files listed in §2 to current routes. Record native PNG resolution/visible content and approved versus invented functionality. Inventory customer/component screenshots for polish that genuinely touches existing components.
- Read existing Storybook stories, Playwright visual and auth/AI recommendation configurations; identify reusable fixtures, disposable QA stack and screenshot output policy.

**Backend inspection**
- Trace every route capable of creating a session, refreshing a token, changing a role/account state, issuing OTPs, sending Brevo, returning recommendation rails, accepting public recommendation events, calculating checkout delivery methods, and collecting image-search requests.
- Confirm authenticated user representation, rate limiter, cookie/CSRF/CORS, `SecurityEvent`, session lineage locks, deletion policies, AI integration and ordering of route middleware. Identify potential alternate ADMIN issuance paths explicitly.

**Database inspection**
- Read current schema, exact enum names, all relevant recent migrations, indexes/constraints, target connection identity and actual DEV ledger if authorized. Map session family, OTP lifecycle, invitation/email-outbox feasibility, recommendation events and order/item category snapshots.
- Inventory planned additive models with migration ordering and old-code compatibility. Record account bootstrap and MFA-enforcement cutover approach and a tested rollback/forward-repair strategy.

**Deliverables:** `docs/tasks/Phase-05/TASK_05.2_IMPLEMENTATION_PLAN.md` or existing standard evidence location; route/API/migration mapping, screen-state inventory, explicit architecture decisions, suite mapping and acceptance traceability. Do not create a second source of truth competing with this task file.

**Gate M0:** repo/branch/environment verified; exact 05.1 approval preserved; no unreviewed schema assumptions; screenshot analysis and new-screen designs identified; all risky auth issuance paths enumerated; written implementation/migration/security/test plan ready.

### M1 — Admin security foundation, DB migrations and server-side session assurance

**Frontend**
- Define typed auth response states: primary verification, MFA-required, enrollment-required, recovery-required, factor verified, authenticated, expired/revoked. Add a single source of truth for admin-auth navigation and query invalidation; no flash of protected admin data.
- Prepare shared accessible multi-step authentication components and deterministic Storybook stories before major visual assembly.

**Backend**
- Implement explicit admin MFA assurance policy integrated into `requireAuth`/admin authorization and refresh-token lifecycle. Ensure all ADMIN issuance routes funnel through a verified policy; no customer auth regression. Session family must be checked for revocation on protected requests and Socket.IO admin entry points where applicable.
- Create short-lived restricted pre-auth transaction abstraction with replay/idempotency/expiration bounds; no normal refresh token or broad admin JWT for incomplete MFA.
- Implement reliable session metadata creation/revocation with existing lock order, a one-time bootstrap owner capability and safe policy for existing users/legacy refresh tokens. No bypass that lasts into normal operation.

**DB/security**
- Add narrowly scoped AdminInvitation/AdminAccountSecurity/AdminMfaFactor/AdminAuthChallenge/AdminSession/credential/audit tables or a justified equivalent as designed; migrations additive and tested in disposable PostgreSQL.
- Document encryption-at-rest and key versioning, limited retention and disaster recovery. No TOTP secret plaintext in DB/logs, no raw invitation links in admin list responses.

**Critical tests**
- Password-only ADMIN login cannot reach a protected admin API or acquire unrestricted refresh; reusing old refresh session after MFA cutover is denied/revoked according to policy; CUSTOMER remains compatible.
- Parallel login/refresh/logout/deactivation/factor disable respects per-user locks without deadlock. Concurrent MFA challenge uses cannot both succeed; expired/revoked session cannot open WebSocket admin channels.
- Staged migration works on empty and existing baseline DB, preserves historical rows, applied-ledger integrity and existing tests.

**Gate M1:** Mandatory server-side MFA/session security foundation functions, migration and cutover safe, all alternate auth paths audited, no privileged-token issuance bypass.

### M2 — Invitation-only admin onboarding and team management

**Frontend**
- Implement `/admin/settings/administrators`: real admin team table, invites table (pending/accepted/expired/revoked/delivery failure), search/filter/page, count/status, invite creation dialog, resend/revoke confirmation, recipient status and meaningful send errors. No raw token values anywhere in team UI.
- Implement invite acceptance and registration screens outside normal authenticated admin shell: branded, reference-compatible login typography, email bound to invitation (read-only with safe explanation), first/last/password fields, validation/strength and confirmation, invitation expired/revoked/replayed handling, verification pending/delivery error/retry.
- On successful acceptance, explicitly explain required MFA enrollment and navigate to restricted onboarding; never redirect to full admin console prematurely. Reuse `Button`, `Input`, `Dialog`, toast/error/OTP components and responsive layouts.

**Backend/APIs**
- Implement permissioned invitation list/create/resend/revoke with secure random tokens, digest-only persistence, atomic single-use acceptance and bounded expiry; verify existing accounts/email collisions without permitting privilege escalation.
- Deliver invitation via existing Brevo/email infrastructure, using outbox if current architecture requires durability; no provider send inside long DB transaction. Retry with idempotency and consistent invitation/token version; failed email must be visible and recoverable safely.
- Registration produces a pending ADMIN state that cannot authenticate without MFA; verify email binding and password hashing with current approved logic; server chooses role and capability only.
- Establish one-time operator-authorized bootstrap/owner recovery that does not require public default credentials and cannot be re-run after initialization.

**DB/security**
- Introduce durable invite state, email delivery association, acceptedBy user association, owner permission, request IDs and relevant audit. Handle concurrent accept/resend/revoke races in one transaction. Ensure expiry and cleanup do not erase security history prematurely.
- Normalize email consistently with existing auth; rate-limit invite previews/accept attempts. Redact token in URL analytics/referrer (no third-party requests, strict `Referrer-Policy`, clear URL after acceptance). Enforce origin and `no-store` on all sensitive responses.

**Critical tests/browser**
- Happy path invite → Brevo mocked/disposable mail sink → acceptance → verified email → MFA enroll → fully authenticated ADMIN. Shared DEV email dispatch only to explicitly authorized safe recipients when required.
- Expired, revoked, wrong recipient, duplicate registered email, token replay, parallel accept, resend invalidation, fake user role payload, unprivileged ADMIN cannot invite, CUSTOMER blocked, missing OWNER denied. Invitation email delivery failure and retry do not create inconsistent privilege.
- Responsive screens at 390/768/1440/1920 and actual keyboard/focus, email input accessibility, password manager and 200% zoom.

**Gate M2:** Invitation lifecycle is functional and secure end-to-end, not only a database record or mail illustration; no public admin self-registration, no unconfirmed privileged sessions.

### M3 — Mandatory MFA: TOTP/OTP enrollment, login and recovery

**Frontend**
- Retain the screenshot-derived `Admin login.png` composition for step 1; extend it into polished step 2 (TOTP), enrollment QR/manual secret flow, factor-verification, recovery-code one-time reveal/download/copy, recovery use and clear expired/incorrect/retry/rate-limit states.
- Accessible 6-digit TOTP field (or equivalent input) supports keyboard, paste, autofill conventions as safe, error announcement, no auto-submit that obscures errors, and clear resend only for email OTP flows. Allow the user to choose installed factor or recovery; no ambiguous passkey fallback.
- Factor enrollment requires a successful challenge and final confirmation; do not treat generating a secret as enrollment completion. Failed enrollment must leave an account in restricted state.

**Backend/APIs**
- Implement TOTP algorithm using vetted implementation or correctly verified standards; protect secret with versioned encryption, validate with bounded clock drift, enforce monotonic consumed time-step/replay guard atomically and rate-limit failures. Per factor, handle out-of-sync clocks with recoverable UX without dangerously wide acceptance.
- Generate high-entropy one-time recovery codes; store only appropriately hashed values, reveal once, consume atomically. Regeneration invalidates previous unused codes and raises security notice.
- Integrate Brevo/email OTP only where approved: invitation verification or restricted guarded recovery; do not consider email OTP automatically phishing-resistant or allow email recovery alone to silently replace established strong MFA without step-up/operator policy.
- After valid factor proof, establish new session and bind assurance to the live session family. Prevent subsequent refresh from losing assurance or unblocking a restricted pre-auth transaction.

**Security tests**
- Wrong/expired/replayed TOTP, time drift edge, two concurrent tries for same step, rate-limit, recovery replay, abandoned setup, secret encryption key unavailable, lost-device recovery, disabled factor/session revocation, old MFA-enrolled admin authenticating only with password, customer unaffected.
- No OTP/QR/secret/codes in console, email log, Storybook screenshots, Playwright trace, exception output or analytics storage. Use synthetic secrets in stories only.

**Gate M3:** First and subsequent admin login require completed MFA; recovery works without permanent bypass; session assurance and all one-use invariants verified via API and browser.

### M4 — Passkeys (WebAuthn), live sessions, security history and profile/security

**Frontend**
- Implement `/admin/profile`, `/admin/profile/security`, `/admin/profile/sessions`. Avatar-dropdown links must work, respect existing sign-out confirmation and avoid displaying unnecessary private data in the header.
- Profile: permitted first/last/display info, verified email state, safe change workflow, current role and capabilities; all actions show save/validation/stale/error states. Security: list factors, add/remove TOTP, WebAuthn enrollment with accessible browser prompt/unsupported-device guidance, rename/revoke passkey, recovery code management, recent authentication requirement.
- Sessions: current session distinguished from others, device label/approximate origin/time, session revocation with confirmation, sign out all others, pagination, last login attempts and security alerts. Show truthful timestamps, not invented city/accuracy. No full raw IP necessary.

**Backend/APIs**
- Implement WebAuthn ceremonies using maintained vetted library and appropriate dependencies only after architecture review. Challenge created server-side; verify `RP ID`, exact origin, user verification, challenge single-use, credential signature, registered public key, per-user credential ownership, backup/counter semantics and authenticator metadata. Support multiple devices and accessible fallback.
- Maintain precise login-history events and controlled retention; lock/session family revocation must invalidate **both** refresh and access authorization, including Socket.IO where protected. Preserve current session unless explicitly revoked; allow revoke-others using a scoped transaction.
- Require recent validated primary+factor proof for sensitive profile changes, new credential enrollment, factor disable, recovery regeneration, other-admin invitations and administrator deactivation.

**DB/security**
- Persist COSE public key and credential ID only, no passkey private keys. Index unique credential ID and user/session; stale/revoked credentials cannot authenticate. No user enumeration from WebAuthn options for anonymous callers.
- Keep account deletion/anonymization and password reset consistent with passkeys, sessions and security event retention. Protect last viable factor and last active owner from accidental lockout.

**Critical tests/browser**
- Valid virtual authenticator registration and login; wrong origin/RPID/challenge, cloned/foreign credential, replay, unverified user, tampered signature, unsupported platform, multiple credentials and revocation. Playwright Chromium virtual authenticator if available; clearly label simulated hardware vs physical manual passkey verification.
- Revoked session cannot use existing bearer access or refresh token; active session works; account deactivation/revocation invalidates session; admin/password resets don't reauthorize old family. Customer login and session tests remain green.

**Gate M4:** Real WebAuthn factor flows, sessions and login-history APIs are implemented and verified with independent security tests; not merely passkey buttons and account cards.

### M5 — Real Store Settings, Shipping, Notifications, Team and administrator profile integration

**Frontend**
- Build `/admin/settings` with Figma-derived Store / Notifications / Shipping tabs; integrate Team & Invitations tab or dedicated route. Persistent URL tab state, keyboard arrow navigation, correct pane labeling/focus, unsaved-change protection across tabs/links/Back/refresh and skeleton/error/retry/success states.
- Store: store name, public email/phone/address, supported currency (read-only when fixed), real IANA timezone selector, explicit save/version, validation, feedback, no fabricated New York test address in shared DEV.
- Shipping: supported real methods only, configured rates/thresholds in Decimal-safe fields, on/off toggles only if backend/checkout supports them, validation and preview of actual shipping quote. Do not show unsupported overnight/express methods as functional if absent.
- Notifications: order received/shipped/low-stock/customer registered preferences when actual corresponding event+delivery exists; digest toggle only with working digest service; no cosmetic Maintenance Mode.
- Team: invitation actions from M2; profile menu/route behavior from M4.

**Backend/APIs**
- Create versioned allowlisted settings read/update with ADMIN+capability controls and 409 optimistic conflict; sanitize returned store profile. Keep user preferences self-only. Reuse existing email/outbox for eligible admin notifications; ensure subscribed recipients are verified and send failures observable/retryable.
- Refactor checkout shipping configuration **only along the canonical `CheckoutService`/`checkout.domain` path**. Propagate consistent method/price/version validation into payment attempt/order creation and quote-refresh; ensure Stripe Test Mode totals are still authoritative, order price snapshots remain immutable, and a config change between quote/payment is handled safely. Never silently mutate paid orders.

**DB/security**
- Persist store/shipping/preferences with effective/versioned state and audit; currency/region invariants verified. Unknown legacy method should not break existing orders. Prevent race and configuration edits from causing temporary inconsistent checkout. RLS/DB permissions maintain backend-only access where applicable.

**Tests/visual**
- Each tab visually compared with `Settings page.png`, `Settings_page.png`, `Settingspage.png`, `Settings-page.png` at matching reference size plus 390/768/1440/1920/200% zoom; Storybook pristine/dirty/save/error/optimistic conflict/unsupported-control states.
- Unit integration: valid price, negative/multiple currency invalid, threshold boundary, disabled method, concurrent update, quote recalculation, payment/checkout idempotency and financial snapshots. Check updated shipping config affects *new* real checkout quotations and not historical order costs. Brevo failures cannot fake preference delivery.

**Gate M5:** Every enabled Settings control persists and has real system effect; no fake settings, checkout/Stripe invariants preserved; visual/keyboard/responsive QA complete.

### M6 — Recommendation Management: strategies, pinning, preview and real activity

**Frontend**
- Implement `/admin/recommendations` using high-quality AdminLayout cards: Overview, Strategies, Featured Products, Preview/Activity. Use responsive tabs or subnavigation that maps to actual state; no dead control.
- Overview: authentic impression/click/CTR/campaign/strategy/fallback health; explicitly distinguish request count if instrumented from visible impressions. Set period controls and granularity; show no-data/partial failure honestly.
- Strategies: per-surface mode/enable/limit/fallback selectors restricted to compatible engine strategies. Show current published vs draft settings, supported rail context and impact explanation; reset defaults with confirmation. Saving enforces `expectedVersion` and invalidates proper caches.
- Featured: product selection with searchable eligible catalog, status/stock/expiry indicators, priority, start/end schedule and conflict resolution. Pins list with active/scheduled/expired/paused status; single and optional bounded bulk unpin; no Figma link required for new UI.
- Preview: actual recommendation service response for a safe context, clearly labeled sample vs live, strategy/model and fallback reasons, product cards, rank and eligibility; **preview never records impressions/clicks and never changes active product/user history**.

**Backend/APIs/AI**
- Add admin config/version service and preview projection; integrate per-surface decisions at existing `recommendation.service.ts` entry points. Keep FastAPI model inference boundary intact and unchanged except justified optional metadata; no duplicate recommendation algorithm.
- Pin merge policy: deterministic ordering, dedupe against ranked items, validate eligible products at serving time, correct label/strategy attribution, preserve personalized opt-in and anon behavior, enforce per-rail max; skip expired/hidden/out-of-stock/non-fixture-eligible items gracefully.
- Monitoring: aggregate existing recommendation impressions/clicks by mode/strategy/surface/time; if fallback reason/AI health is not persistently recorded, add narrow server instrumentation rather than guessing from API responses. Do not store or expose personal preferences in admin reports.

**DB/security**
- Create versioned configs/pins/audit with unique constraints and indexes by surface/window; robust simultaneous edit behavior. Ensure future scheduled pins don't require a constantly running user-triggered write job just to activate; evaluate effective time safely on read.

**Tests/browser**
- An admin setting change visibly affects public or customer recommendation result at eligible pages, then restores; one pinned product reliably appears where valid, disappears on expiry/archive/stock-ineligibility, dedupes against organic list and preserves limits; consent off never produces personalized behavior.
- Wrong surface/mode combo rejected, expired/config stale returns 409, anonymous/customer admin-write calls 401/403, preview event counters unchanged, ML fallback/outage still safe and customer page never blocks checkout.
- Storybook responsive strategy cards, configuration dialogs, long product names, eligibility errors, empty recommendations and counters; real browser check on localhost:3000 + safe DEV or disposable fixtures.

**Gate M6:** Real backed configuration and featured placements operate end-to-end and safely; truthful analytics and no personalization leakage; no duplicate recommendation engine.

### M7 — Privacy-conscious analytics instrumentation, event ingestion and conversion attribution

**Frontend**
- Add only required user-facing event hooks to actual customer interactions (e.g., image-search successful result selection), reusing existing recommendation impression/click handling. No duplicated tracking from React StrictMode, rerenders, scrolling or background preview.
- Add analytics error/fallback behavior that cannot break customer interaction, checkout or visual rendering. Never block UI on fire-and-forget analytics or expose event metadata in developer-visible pages.

**Backend/APIs**
- Design controlled event taxonomy (`image_search.requested/completed/failed/result_selected`, optional supported search/product/cart events), strict allowlisted fields, idempotency, source/consent, timestamp skew bounds, bounded throughput, sane retention and secure ingestion. Server-derived outcome, latency and result count must come from backend service—not an unverified browser claim.
- Reuse `RecommendationEvent` for impressions/clicks. Define CTR denominator and count dedupe. For conversion, trace privacy-valid consenting recommendation click/selection into eligible cart/checkout/order state; write trusted attribution only at verified purchase/payment fact, with model (e.g. last qualifying click), explicit bounded window, event dedupe and no multiplication by order line quantity.
- If customer opt-in is missing or anonymous session cannot be validly linked to paid purchase, exclude from attributed conversion (with denominator/coverage explanation) rather than infer. Avoid raw user identity in analytics and avoid retaining uploaded images.
- Add event ingestion observability: accepted, dropped due to no consent, duplicate/replay, rate limited and storage errors aggregated without leaking PII.

**DB/security**
- Add `AnalyticsEvent` or narrow event models, necessary event constraints, retention and deletion jobs integrated with account deletion; optional attribution rows use minimal join keys and secure purge strategy. Backfills from existing trusted payment/order/delivery/recommendation rows permitted only for metrics genuinely derivable; do not fabricate legacy behavior events.
- Model migration/data replay under concurrent checkout and consent-off races; revoke/remove personal attribution according to existing privacy contract.

**Tests**
- Same event retry is deduped; browser rerender doesn't inflate counts; event type injection/schema excess is 400; unauthenticated/private impression spoofed token rejected; consent off no identifying retention; request throttles work; account deletion cleans required tracking; image upload not stored for analytics.
- Correct payment conversion only once on actual canonical paid status; never count pending/failed/refunded as current successful conversion without clearly defined historical attribution semantics. AI event outage cannot interfere with purchasing.

**Gate M7:** Instrumentation produces trustworthy, privacy-compliant measurable data with defined ownership, resilience and retention; conversion reporting has valid evidence or is explicitly unavailable.

### M8 — Real Analytics dashboard and reporting across all nine required domains

**Frontend**
- Implement `/admin/analytics` from `Analytics page.png` and `Analytics_page.png`: prominent title + 7/30/90-day/12-month range control; revenue/orders/AOV/new-customer cards; real revenue time series with axis labels and hover/focus tooltips; popular products/categories with normalized meaningful bar comparison; customer growth/repeat customer metric; image-search/recommendation/inventory/delivery reporting sections.
- Use adaptive dashboard sections or tabs as necessary; no dashboard feels incomplete/like a copied placeholder. Keyboard accessible tabs/range selectors, URL-backed period/currency/tab filters, active selection, chart data table/fallback for screen readers, readable legends/totals, honest unavailable/insufficient data states. Charts never show static random bars.
- Distinguish currency and dataset (Stripe Test Mode demo records where true), updatedAt, UTC versus display timezone, background refresh and partial failures. Drill-down to `/admin/orders`, `/admin/products`, `/admin/inventory`, `/admin/deliveries` using correct status/date filters where actual routes support them.
- Eliminate fictitious average-session-duration shown in screenshot if no measured session telemetry; replace with truthful Repeat Purchase Rate or clearly hide it. No fabricated growth deltas without matching previous-period query.

**Backend/analytics domain**
- Revenue: document successful and non-refunded paid-payment definition carried forward from 05.1; exact distinct order count, paidAt period, per currency; no summing unrelated monetary units. If true net/partial refunds are recorded, implement separate correct semantics and label; no false “gross before refunds.”
- Orders: created vs paid separate, status distribution and authoritative snapshots; AOV denominator = distinct eligible paid orders, rounding Decimal-safe; same period comparison duration and zero handling.
- Products: top sellers by eligible paid order-item quantity/amount; product views/clicks only measured; long/archived product labels show snapshot/availability correctly.
- Categories: explicitly label current-category vs at-purchase category if no historical snapshot exists; category share denominator explicit; include unknown/unclassified where necessary.
- Inventory: current counts and available stock, historical restock trend only if durable source exists; do not reconstruct past counts from `updatedAt` alone.
- Recommendations: event totals, deduped CTR, conversion only where proven, strategy and fallback split, coverage/consent limitation.
- Image search: request count, error/no-result rate, selected products, latency measured and retention. No images/PII stored.
- Delivery: real active status, delivery trend, derived completion time if both timestamps exist, ETA accuracy only where event history supports it. Do not manufacture courier location.
- Customers: registrations, active customers if defined, repeat paid buyers with correct distinct customer count and period; privacy aware and admin scoped.

**DB/performance**
- Use optimized grouped SQL/Prisma, whitelisted filters, keyset/offset bounds, possible existing indexes; query plans where necessary. Persist aggregates only when measured needed with idempotent recompute/versioned definitions and reconciliation against authoritative data; avoid live checkout transaction hot spots.

**Tests/visual/browser**
- Each of nine domain figures independently reconciled to a curated disposable dataset including zero/refund/mixed currency/duplicate event/archived product/unknown category/long period/empty period. Reconcile sampled authorized DEV read-only if feasible.
- Compare top/scrolled Analytics Figma screenshots at exact native dimensions plus all responsive matrix states; inspect actual Storybook stories and live Playwright screenshot; verify browser period switching, tabs, tooltip/focus, drilldowns, no fetching loops and error handling.

**Gate M8:** All required analytics exist with proven definitions or explicit accurate unavailable state when evidence is intrinsically missing; tested charts and stable performance; no invented data.

### M9 — Higher-level admin table selection and safe bulk operations

**Frontend**
- Add selected-row UX to the existing 05.1 DataTable composition only when product/admin feature uses it; keep base component backward compatible. Accessible checkbox in header/rows, select current page, indeterminate state, clear selection, selected count, scoped action toolbar, confirm modal, pending and truthful partial result presentation.
- Supported bulk actions: safe product archive/reactivate subject to existing policies; safe featured pin/unpin if M6 supports a sensible batch. Do not silently select unseen pages. Persist selection across filters only when explicitly designed and safe; otherwise clear on filter change with clear notice.

**Backend/services**
- Bounded id list, dedup IDs, version/preconditions, actor permission, per-row archive/reactivate category/stock/history policy, audit and partial-success contract with per-item errors. Avoid long locks and massive transactions. Use idempotency or concurrency guard; prevent duplicate click or stale multiple writes.
- Do not bulk refund/mark-paid, mutate orders, mass deactivate customers, hard-delete products or bypass inventory locking.

**Tests**
- Keyboard checkbox and screen-reader selection announcements; select all current page vs query, page change, re-sort, conflict partial failures, unknown IDs, unauthorized direct call, duplicate request, 200% modal and mobile action toolbar. Existing 05.1 tables/tests unaffected.

**Gate M9:** Selected row/bulk actions are actual safe workflow enhancements, not checkboxes with no behavior; regression and security tests pass.

### M10 — Cross-application premium UI/UX and performance refinement

**Frontend ADMIN**
- Refine newly built login, invitation, security, recommendations, analytics, settings and existing 05.1 admin shell where a concrete shared component issue is found. Preserve brand, 05.1 accepted functionality and existing sidebar/navigation; new nav destinations are actual pages, not inert links.
- Consistent headings, CTA placement, collapse toggle in header row where applicable, sidebar compact icon size/position, DropdownMenu/Select content width/height, oversized options and scroll behavior, matching skeletons, toast feedback, hover/focus, polished charts and mobile reflow. Profile menu is avatar-only trigger with accessible name, real Profile/Security/Sessions/Logout actions and sign-out confirmation.
- **Pagination and tabs must feel responsive**: preserve usable previous data during fetch, correct query key/cancel stale requests, prefetch adjacent page when justified, keep scroll to page title on pagination, make filter/search debounce efficient and clear, avoid full-page spinner flashes, repeated redundant aggregates or expensive API query waterfalls; back UI perception with measured browser/network/backend timings rather than fake animation/fetch delays.
- Avoid mass changes to 05.1 products/categories/inventory/orders/customer pages simply for aesthetic novelty. Fix actual bugs found during 05.2 QA and focused regressions; document affected modules.

**Frontend CUSTOMER**
- Audit touched/shared flows: home/catalog/search/suggestions/image search/product detail/recommendation rails/cart/wishlist/checkout/payment result/order history/delivery/account. Improve real missing loading/empty/error/retry/success/accessibility/responsive states, with semantic icons, appropriate skeletons, disabled action reasons and consistent toasts.
- Preserve existing customer auth, recommendation consent, Stripe/checkout, media, PDF, delivery and cart contract; do not cause route churn or fake loaders. Avoid testing with real customer PII in exported screenshots. No destructive customer data cleanup.

**Backend/performance**
- Instrument slow admin list/tab/pagination endpoints as needed using request timings and bounded query plans; fix root cause of material latency: indexes, N+1, redundant data fetches, unbounded summary, cache invalidation, poor query keys, unnecessary AI load. Do not add arbitrary global response caching of private admin/user information.
- For async multi-source pages, show partial data/error boundaries; avoid one slow analytics query blocking all cards. Stable API and no exposed low-level error stacks.

**Visual/keyboard**
- 390/768/1440/1920, 200% real browser zoom for risk dialogs, reduced-motion, tab focus, captions/alt, color contrast, loading announcements, filter list menu viewport scrolling, no overlays behind sticky header, mobile close/focus return. Storybook actual components and browser real pages compared against Figma where visual screenshot exists.

**Gate M10:** No materially broken/loading-only path across affected customer/admin features; premium interaction is coherent and accessible, measured performance issues addressed, no regressions from unrelated redesign.

### M11 — One integrated final implementation, source/diff review, real-browser acceptance and PR handoff

**End-to-end integration**
1. Verify current target/environment again. Apply reviewed migrations to disposable and approved DEV via safe workflow; verify `_prisma_migrations`/schema without direct editing. No production writes.
2. Run full browser flow on **`localhost:3000` connected to verified shared DEV** for safe read/non-destructive/account-scoped tests with authorized credentials: admin password→MFA, nav, Analytics charts/periods, recommendation read/preview, Settings read and safe self-preferences, logout; customer recommendation/consent/image search and scoped shopping read flows. Label anything unable to run due to provider or scope as NOT VERIFIED with reason; do not invent a PASS.
3. Use disposable PostgreSQL + synthetic accounts, fake provider emails and Stripe Test Mode stubs where approved for destructive/negative/privilege operations: invite registration, factor transitions/recovery, passkey virtual authenticator, session revocation, shipping price change through checkout, pin activation, bulk product archive, paid-order attribution fixture, deletion and consent rules.
4. Verify new routes/deep links, refresh/Back, session invalidation, error/retry, OTP challenge, keyboard and responsive states in a real Chromium context. Review captured screenshots by eye plus optional pixel diff. Inspect API/network and browser console errors; fix root cause and rerun **affected** tests, not every unrelated suite repeatedly.
5. Run changed-area unit/service/API/Prisma integration tests; build Storybook; typecheck/lint/build frontend+backend; then final required repo/PR CI on actual head. If tests unavailable due to environment guard, separate infrastructure issue and reproduce in approved CI/disposable runner.
6. Principal Architect reviews complete changed files, relevant surrounding code and diff, security/edge cases, migrations, actual QA artifacts and CI; requests only actionable defects or material verification gaps.
7. Produce concise final evidence: pass/fail/not verified per acceptance ID, link to screenshot/trace/test log with environment and SHA, Figma deviations, migration target/status, API compatibility, risks and recommended verdict. No claim of Architect approval from implementing agent alone.

**Gate M11:** M0–M10 requirements met or accepted with defensible documented residual risks; no unresolved critical/high security/integrity/UX blocker; accurate proof of browser/source/CI; normal feature branch PR ready for independent review, not merged or deployed.

---

## 7. REQUIREMENT-TO-TEST TRACEABILITY AND SECURITY INVARIANTS

Test design begins with invariants, **not** a random large test count. Tests must assert correct persisted state and API/browser behavior, not implementation details alone. Reuse existing accepted tests where unchanged.

| ID | Non-negotiable invariant | Minimum verification |
|---|---|---|
| SEC-01 | Neither existing nor new login endpoints can issue unrestricted ADMIN session before MFA | Route/service tests for password, Google, verify/reset, legacy token, and browser blocked navigation |
| SEC-02 | `ADMIN` role comes from DB, not request; invitations require explicit permission | Direct HTTP 401 guest / 403 CUSTOMER or unauthorized ADMIN / 2xx verified authorized ADMIN |
| SEC-03 | Invitation token hash only, exact email, unique consume, expiration/revocation | Transactional DB tests, replay and concurrent requests |
| SEC-04 | Enrolled MFA is truly verified before activation; no permanent bypass | Onboarding service + API + real browser flow |
| SEC-05 | MFA pre-auth challenges restricted, short-lived, one-use, bounded attempts | Replay/expiry/CSRF/challenge endpoint probes |
| SEC-06 | TOTP secret encrypted at rest and accepted timestep never reused | Secret-storage inspection, race and time-window tests |
| SEC-07 | Recovery codes single-use, digest-only; regeneration revokes old codes | Parallel-use and second-request failure tests |
| SEC-08 | WebAuthn binds challenge, RP ID, origin, public key, UV and user | Virtual authenticator + invalid signature/origin/counter/owner tests |
| SEC-09 | Revoked admin session cannot authenticate by old access OR refresh token | Real HTTP + lifecycle tests, socket checks where applicable |
| SEC-10 | Last viable MFA/owner is protected against removal and lockout | Self/last-owner downgrade, final-factor disable tests |
| SEC-11 | Every sensitive mutation requires recent step-up, rate limit and audit | Route guard and audit assertion; no plaintext in log |
| SEC-12 | Customer auth/Google/password reset/deletion continues working | Existing regression suites and focused changed-path tests |
| COM-01 | Shipping settings affect canonical quote/payment/order safely | Quote→attempt/order test; old order immutable; config conflict |
| COM-02 | Payment and inventory are never mutated by analytics/recommendation admin writes | DB before/after integrity assertions |
| REC-01 | Published strategies are from current supported engine modes | Invalid combination rejects; public response matches configured mode |
| REC-02 | Pin cannot bypass product eligibility/consent or duplicate displayed result | Archive/stock/off-consent/fixture/expiry tests |
| REC-03 | Preview produces no real impressions, clicks or user history | DB/event-count before-after check |
| REC-04 | Changed configuration invalidates effective cache without privacy leakage | Live customer API and no cross-session result tests |
| ANA-01 | Paid revenue and AOV match source payment/order facts, currencies separate | Disposable dataset reconciliation including refunded/failed |
| ANA-02 | Recommendation impression count and CTR use deduplicated event denominator | Replay and 0-denominator tests |
| ANA-03 | Conversion uses trusted paid attribution, never guessed linkage | Consent/attribution/purchase/retry/expiry tests |
| ANA-04 | Image-search reports store no actual image or sensitive upload | DB inspection, event schema tests |
| ANA-05 | Historical category/date claims reflect actual snapshots or honest limitation | Data fixtures with moved/deleted categories and pre-instrumentation dates |
| ANA-06 | Event ingestion does not slow/break checkout or leak consent-revoked history | Provider/storage outage tests, deletion purge proof |
| UI-01 | Every new screen handles loading, empty, error, 403, stale and success appropriately | Storybook real states + integration page tests |
| UI-02 | Forms/dialogs/menus are keyboard/focus-correct and usable at 200% zoom | Playwright/manual browser checks |
| UI-03 | Responsive UI has no clipped CTA/popover or horizontal document scroll | 390/768/1440/1920 screenshots + DOM overflow assertions |
| UI-04 | Analytics/Settings Figma structure remains recognizable and purposeful | Exact PNG/live DOM comparison with reasoned deviation log |
| UI-05 | Tab/pagination/search transitions don't cause avoidable blank blocking/refetch storms | Browser network/performance evidence and focused tests |
| OPS-01 | No DEV/PROD identity confusion or unapproved destructive fixtures | DB identity preflight + fixture manifest + teardown |
| OPS-02 | Migration history and checksum integrity maintained; repeat deploy no-op | Empty/baseline disposable and authorized DEV migration checks |
| OPS-03 | CI, relevant tests and real browser gates are checked on actual HEAD | Commit SHA evidence and acceptance table |

---

## 8. TESTING STACK, FOCUSED EXECUTION, STORYBOOK AND BROWSER EVIDENCE

### 8.1 Existing tooling — use, don't reinvent

The repository has root npm workspaces, frontend **Vitest + Testing Library**, backend **Vitest + Supertest**, **Storybook 9 / @storybook/addon-a11y**, **Playwright**, and `pixelmatch`/`pngjs` support for visual comparisons. Prisma migrations and disposable DB scripts are already part of the project's workflows. Use the closest existing test harness; do not create an independent React preview project or duplicate testing infrastructure.

From root (verify scripts in current `package.json` and workspace scripts at M0):

```bash
npm run typecheck:frontend
npm run typecheck:backend
npm run lint:frontend
npm run lint:backend
npm run build:frontend
npm run build:backend
npm run test:frontend
npm run test:backend
npm run build-storybook --workspace=apps/frontend
npm run storybook --workspace=apps/frontend

# Examples: adapt to existing configs and target specs; never run destructive specs on shared DEV.
cd apps/frontend
npx playwright test -c playwright.config.ts <task-05.2-focused-spec>
# Repository includes recommendation and auth Playwright configurations; inspect before selecting.

# Prisma CLI must execute from backend with correctly gated disposable target.
cd ../backend
npx prisma validate
npx prisma generate
npx prisma migrate status
# prisma migrate deploy only against explicitly permitted disposable/DEV target after preflight
```

**Do not confuse local backend unit integration environment guards with failing implementation.** CI/disposable harness can provide valid evidence; record exactly which suite and environment produced PASS. Final acceptance considers relevant CI on final SHA and targeted real-browser proof.

### 8.2 Unit test target map

| Unit focus | Required cases |
|---|---|
| Admin role/MFA gate | Every possible ADMIN token issuance/refresh path, restricted pre-auth, state transitions, stale sessions |
| Invitation lifecycle | TTL, email normalization, duplicate/collision, replay, revoke/resend, atomic race, owner permission |
| TOTP/recovery | Boundary timesteps, drift, replay, code hashes, encryption failure, regeneration, final-factor rule |
| WebAuthn verification | RP/origin/UV/challenge/credential mapping, duplicate, counter semantics, logout and expiration |
| Session manager | Token family lineage, two-device revoke, global revoke, role change/deactivation, concurrency and locking |
| Store/shipping | Validation, currency, zone, update conflict, supported method, quote consistency and snapshot |
| Notification prefs | Idempotent save, opt-in/out, mandatory mail not suppressed, email delivery failure |
| Recommendation config | Compatible strategy map, scheduling, eligibility, priority, duplicates, fallback/AI outage |
| Analytics metric math | Period boundaries, zero division, refund semantics, dedup, currency, category attribution |
| Event ingestion | Source trust, metadata whitelist, consent, purge, idempotency, outage |
| Bulk action | Selection contract, per-item conflicts and status, cap, partial result, no payment/stock mutation |
| Frontend state | Forms, skeleton/error/empty, query keys, tabs/URL/deep link, accessible status, confirm/dirty guard |

### 8.3 API/integration test requirements

- Use actual HTTP middleware with real session claims, not only direct service mocks. For each new privileged endpoint verify 401 anonymous, 403 CUSTOMER, 403 low-permission ADMIN/incomplete MFA and success for authorized MFA-verified ADMIN. Include validation 400, missing 404, conflict 409, rate limit 429 and sanitized server error where relevant.
- Use a disposable Postgres with real migrated schema to prove at least one complete invitation lifecycle, concurrent invite acceptance, MFA session cutover, credential/session revocation and correct DB state. Mock providers where they are not the subject of the test.
- Use provider mocks/email capture for Brevo invitation/outage and JWT/cookie/refresh expiry. Do not send test invites to arbitrary real email addresses.
- Verify checkout from quote through payment attempt/order with shipping settings changes; payments remain Stripe Test Mode or deterministic mocked payment state, not live charges. Order snapshots retain original price.
- Reconcile analytics to authoritative SQL fixture rows and logged recommendation events. Add one test proving a click is **not** automatically a paid conversion; one proving a valid consented paid attribution counts once.
- Test image-search event success/failure/no-result and privacy without requiring GPU training or a new model. Existing AI version readiness and fallback remain authoritative.

### 8.4 Storybook coverage: real components only

Stories must render **the actual production components**, use synthetic fixed fixtures, isolated QueryClient/router where needed, never accidentally issue real API calls to shared DB, and include `@storybook/addon-a11y` inspection. At minimum:

| Component/story family | Required states |
|---|---|
| AdminLogin / MFA | password, submitting, wrong password generic, MFA requested, invalid TOTP, expired challenge, factor choice, success |
| InvitationAccept | valid, expired, already used, validation errors, email verification, MFA onboarding, mobile |
| InvitationManagement | none/pending/sent/failed/revoked/accepted, create dialog, pending resend, destructive revoke, permissions |
| Profile/Security | saved/dirty, step-up, factor enrolled/not enrolled, QR enrollment, passkey browser unsupported, recovery code reveal |
| Sessions / LoginHistory | one/current/many/revoked, long UA, timezone display, revoked current, error/retry |
| Settings Store/Shipping/Notifications | initial loading, populated, unsupported/read-only, validation, dirty, conflict, save error/success |
| RecommendationOverview/Strategy | data/no data, strategy edit, unsupported combination, saving conflict, fallback, consent limitations |
| FeaturedPinPicker/Preview | eligible, expired, archived, unavailable, scheduled, rank/dedupe, large list, empty/error |
| Analytics overview/charts | zero/one/many/mixed currency/partial failure, long labels, legend/tooltip keyboard, mobile/tablet |
| Bulk product selection | none/some/all current-page, changed filters, pending/partial errors/conflicts, confirmation |
| Shared sidebar/header/dialog/select | active/new routes, expanded/collapsed, mobile overlay, long dropdown content, focus/reduced motion |

No new `/components` route is required if existing Storybook supports it. A temporary dev-only preview is justified only for a documented limitation, must use the real component and be excluded from production. Do not export real customer emails or dynamic invitation secrets in stories/snapshots.

### 8.5 Playwright real browser plan and proof classification

**Browser A — primary real DEV environment:** `http://localhost:3000`, backed by explicit **shared Supabase DEV** (through local Express, identity verified before sign-in). Use existing authorized admin credentials from backend environment **without printing them**, and customer credentials only if already authorized; never infer accounts from screenshot fixtures. If MFA migration changed login, enroll the authorized DEV admin using the approved transition first. Safe read and non-destructive scoped preferences/preview tests are permitted when authorized.

**Browser B — disposable QA environment:** own PostgreSQL, synthetic ADMIN/CUSTOMER, local backend and frontend, captured email, seeded safe order/catalog/image-search fixtures. All destructive/privilege/security-negative/OTP/recovery/passkey revocation/shipping mutation/bulk action tests belong here unless DEV-specific permission exists. Identify database before every write. Stop and cleanup only owned disposable resources after evidence capture.

**Manual/automated evidence categories:**
- `STORYBOOK_SIMULATED`: synthetic component state/visual only.
- `UNIT_MOCKED`: pure UI/services and expected calls, no actual DB/provider.
- `API_INTEGRATION_DISPOSABLE`: real API + disposable database transaction/authorization.
- `BROWSER_DISPOSABLE`: real DOM and local API/disposable DB with QA fixtures.
- `BROWSER_DEV`: real frontend `:3000` + verified shared DEV with scoped reads/safe transactions.
- `CI_FINAL_SHA`: GitHub checks on actual feature head, not earlier commit.
- `MANUAL_HUMAN`: physical-authenticator/real zoom/assistive technology where tools lack direct coverage; if unrun mark NOT VERIFIED.

For every critical browser case record: test ID, target environment + verified project ref (never credentials), branch SHA, route, action, expected, observed, result, screenshot/trace path, API status/DB reconciliation if relevant, privacy/redaction. Capture console errors and failed requests; distinguish expected negative 401/403 from unexpected page errors.

### 8.6 End-to-end matrix — minimum required journeys

| Flow ID | Real browser action | Required assertion | Preferred environment |
|---|---|---|---|
| E2E-01 | Admin password login → MFA verify → dashboard | No ADMIN data/token before MFA; real session after verification | Disposable + safe DEV smoke |
| E2E-02 | Invite create → recipient email → acceptance → enrollment → first login | Single-use durable invitation, correct role, MFA enforced | Disposable |
| E2E-03 | Replay/expired/revoked invitation, wrong email | No privilege; deterministic safe error, audit | Disposable |
| E2E-04 | Wrong/replayed TOTP and used recovery code | Denied; rate limits and current session integrity | Disposable |
| E2E-05 | Passkey registration/login/credential revoke | Signature/RP origin verification, revoked cannot sign | Disposable + virtual authenticator |
| E2E-06 | Two sessions; revoke one; try old access/refresh | Revoked session cannot reach admin, second remains valid | Disposable |
| E2E-07 | Last factor/last owner attempt to remove | Blocked safely and shown with explanation | Disposable |
| E2E-08 | Settings Store edit and reload | Persisted through API, dirty/conflict/success correct | Disposable; DEV if safe |
| E2E-09 | Shipping rate edit → checkout quote/attempt/order | New quote correct, old snapshot unchanged, Stripe test safe | Disposable |
| E2E-10 | Notification pref save + provider failure | Truthful save/delivery policy and retry | Disposable |
| E2E-11 | Recommendation strategy publish → customer rail | Real engine output respects config and consent | Disposable + DEV safe read |
| E2E-12 | Featured pin → preview → published eligible result → archive/expiry | Preview no impression; live eligible/expiry effects correct | Disposable |
| E2E-13 | Analytics period switch, click KPI drilldowns | Correct stable series, currency, errors, no stale mix | DEV read + disposable reconciliation |
| E2E-14 | Recommendation impression/click/retry and paid attribution | Dedupe, honest denominator, verified conversion or unavailable | Disposable |
| E2E-15 | Image search → result selection analytics | Server event measured, no raw image retention | Disposable/authorized DEV |
| E2E-16 | Select products, confirm capped bulk archive | Correct per-item outcomes and historical data intact | Disposable |
| E2E-17 | Customer login/cart/checkout/recommendations/delivery | No regressions from admin changes | Disposable + safe DEV smoke |
| E2E-18 | Keyboard, Escape, Back, mobile menu, 200% zoom, reduced motion | Accessibility and viewport operability | Storybook + real browser |
| E2E-19 | Logout and admin route reload/back | Session invalidated, cache cleared, no stale admin data | DEV safe + disposable |
| E2E-20 | Shared 05.1 admin shell and old routes | Admin dashboard/products/orders/delivery still render/authorize | DEV safe + focused regression |

Do not claim Browser A verification when only B ran; do not require destructive credential tests on shared DEV.

### 8.7 Visual evidence matrix and capture procedure

At minimum prepare **reference-to-live evidence pairs** for all seven 05.2 screenshots, with scrolled sections and relevant open dialogs, plus new-screen component/route captures:

- `Admin login.png` → login step 1, and newly designed MFA step 2, invite acceptance, factor setup.
- `Analytics page.png` → top KPI+chart composition (real empty/dataset) and period controls.
- `Analytics_page.png` → scrolled top products/categories/growth/repeat purchasers and new image-search/recommendation/delivery panels.
- `Settings page.png`, `Settings_page.png` → store above/below fold, inline field validation/save/currency/timezone.
- `Settingspage.png` → notifications, actual enabled toggles, no fake maintenance; real save.
- `Settings-page.png` → shipping thresholds and supported delivery methods, quote example.
- New no-screenshot views: Recommendation Management overview/edit/pin/preview; team invitations, invitation registration, recovery, passkey/security and sessions; capture quality against the existing shell/component system, not pretend an exact reference exists.

**Capture dimensions:** use the actual source PNG native 1920×904 (or verify if changed) plus 390, 768, 1440, 1920 CSS pixels. Set correct browser viewport and device-scale; static captures disable animations if needed, but behavior tests run with real motion as appropriate. Record scroll position, data fixture and auth state. Inspect image overlays by eye; correct unintended layout, menu clipping, typography, card heights, table density, colors, chart axes, sticky footer/action overlap and focus indicators. Mark purposeful premium deviations explicitly.

**Accessibility verification:** Storybook a11y checks as useful; manual keyboard tab/Shift+Tab, arrow navigation in Radix tabs/menus, Escape, focus after modal close and route transition, aria-current for nav, proper breadcrumb nav, field error aria-describedby/invalid, live-region feedback, color contrast, chart text summary/data view, red/green status with textual labels, reduced motion and no keyboard trap. Confirm actual page zoom at 200% where test infrastructure/browser tooling permits; simulated 640×400 CSS viewport alone is not proof of real browser zoom.

### 8.8 Performance evidence, not arbitrary numerical promises

- Measure navigation/pagination/search interaction with browser network and React Query/dev instrumentation where available. Report endpoint latency distribution and rendering latency for comparable test data; focus on visible blank blocking/refetch storms, not microbenchmark noise.
- Prefer `placeholderData: keepPreviousData`, appropriate `staleTime`, query cancellation, debounced search, prefetch next page and stable cache keys when validated; never show stale sensitive data to another user/session.
- Backend list/analytics queries use bounded pages, filtered SQL and indexes; measure `EXPLAIN` only for real slow queries; do not prematurely add large materialized-report infrastructure. Verify no N+1 on featured product or invitation list.
- Avoid loading all 05.2 charts and WebAuthn libraries on initial storefront render. Route-level lazy loading and conditional per-tab fetch; AI inference remains outside critical checkout path. Never animate thousands of chart points or render unbounded categories in Select menu.
- Use actual failure observability (request IDs, safe timing, dropped-event counts) instead of adding theoretical logs without measuring or implementing remediation.

---

## 9. AUTH SECURITY THREAT MODEL AND MITIGATION EVIDENCE

| Threat / regression | Required mitigation | Target proof |
|---|---|---|
| Password-only ADMIN API access after MFA rollout | Centralized ADMIN completion/session-assurance check; all old token issuance/refresh audited | SEC-01, E2E-01 |
| Registration body with role ADMIN | Server assigns role only through verified invite | SEC-02/03, E2E-03 |
| Invitation stolen/replayed/used twice | Random one-time digest, exact recipient, expire/revoke, atomic transaction, no referrer leak | M2 tests |
| Staff without invite permission issues invites | Durable owner/capability + step-up check; never browser-only | SEC-02, M2 tests |
| TOTP secret exposed | Encrypted secret with key rotation and no output/logs | SEC-06 |
| TOTP code reused in same timestep | Transactionally monotonic consumed step | SEC-06 |
| Recovery code brute force/replay | High entropy, digest-only, attempt controls, one-use transaction | SEC-07 |
| Compromised/foreign passkey assertion | Exact WebAuthn RP/origin/challenge/UV/signature/credential owner | SEC-08 |
| Admin session revoked but access JWT still works | Authoritative session-family validity check every admin request/socket as applicable | SEC-09, E2E-06 |
| Lost only MFA factor/owner locked out | Safely verified recovery/owner policy; last-factor/owner mutation guard | SEC-10 |
| Attack via forged CSRF/cookie/cross-origin request | Existing CORS/cookie policy preserved, appropriate CSRF/origin protection on mutations | Security integration |
| Credential/email enumeration | Generic public errors, rate limiting, short-lived hidden identifiers | API negative tests |
| Sensitive data in logs, URL query, screenshots or Storybook | DTO minimization, no referrer to third parties, token URL removal after acceptance, scrub traces | Redaction review |
| Settings changes manipulate past payments | Canonical checkout quote, price version and immutable order/payment snapshots | COM-01/02 |
| Featured product hidden/fixture/out of stock | Eligibility enforcement at write and every read, no consent bypass | REC-02 |
| Public client posts fake financial conversion | Only trusted paid facts accepted; user events are hints not truth | ANA-03 |
| Cross-user analytics/React Query cached private data | Session-scoped caching, logout/role-change invalidation, no-store | E2E-19 |
| Prod/DEV mixing or runaway migration | DB identity, separate secrets, migration safety preflight, fail-closed | OPS-01/02 |
| Persistent invalid/bad event data | Strict schemas, size/rate caps, idempotency, retention and deletion | ANA-04/06 |

**Security implementation note:** Follow the existing project password hashing policy, session cookie attributes, JWT validation, CSRF/CORS, IP rate limiter and DB lock ordering unless a documented vulnerability mandates change. Use a vetted WebAuthn implementation rather than manual signature parsing. A debug environment toggle is not an acceptable permanent administrator MFA bypass. Always record that a software virtual authenticator was used for automated passkey tests; physical device QA, if unavailable, stays NOT VERIFIED, never falsely PASS.

---

## 10. DATABASE TARGETS, SAFETY PRE-FLIGHT AND IMPLEMENTATION SEQUENCE

### 10.1 Environment-specific rules

**Disposable QA:** Only target known-owned loopback PostgreSQL or an equivalent explicitly isolated disposable database; use correct environment naming, ports and credentials selected from this test's harness. Create/drop schema and synthetic users only inside the target with a clear ownership manifest. Test full migrations, concurrency, destructive invitation/session/bulk scenarios and cleanup here.

**Shared Supabase DEV:** The project uses a shared development Supabase project (historically `pzxekjybdiulzmssalfo`; **verify actual current identity**). `localhost:3000` is the preferred real frontend smoke environment, backed by local Express against DEV only after checking the actual URL/project ref via the project's safe redacted utility. Read tests can use existing authenticated DEV admin/customer with credentials from properly scoped backend environment; never print them. Any DEV migration/fixture/secret-changing write must follow reviewed project authorization and leave a scoped before/after record. Preserve other contributors' rows and existing QA fixtures; no mass-delete of old browser-test customers or product records.

**Production Supabase:** Historical project ref `yepfgjehdstlxbpespun`; current identity must be verified if inspection permitted. Do not use PROD for task development, testing, seeding, MFA bootstrap or direct migrations. Review production automation only for schema compatibility, migration safety, guarded rollout plan and evidence requirements. A PROD MCP connection does not itself authorize mutation. Production rollout belongs to explicit release authority/Phase 06.

### 10.2 Deployment ordering for new mandatory MFA

This is a **compatibility-sensitive expand-and-enforce change**, not a “deploy all auth at once” toggle:

1. Extend schema compatibly; leave current customer authentication and approved admin APIs functioning until controlled cutover.
2. Deploy restricted challenge, enrollment, sessions and owner bootstrap capabilities; verify access controls for both old and new endpoints.
3. Prove that existing admin accounts can enroll using operator-approved authenticated proof; test no owner lockout. Invite a second eligible admin/owner according to policy.
4. Activate server-side mandatory MFA enforcement for new ADMIN session creation, legacy admin auth entry points, admin refresh, socket access and existing unassured sessions. Revoke/expire incompatible existing admin families in a controlled, auditable manner. No long-lived “legacy bypass.”
5. Verify new MFA login/refresh/recovery/session revocation, customer authentication unaffected, backup recovery procedures ready; publish security/operations notes.
6. Gate PROD behind separate approval and health/recovery plan; monitor invalid session/OTP, invitation delivery, admin access failure without logging secrets.

### 10.3 Migration checks and rollback/forward repair

For each migration record: file, schema diff, exact affected tables and constraints, row count/lock/time assumptions, unique/referential invariants, forward/backward application compatibility, permissible online backfill, `prisma migrate deploy/status` results on disposable, DEV ledger validation when authorized, SQL inspection, checksum integrity and fallback.

A failed migration is a blocker to declaring its environment updated; investigate root cause and follow approved migration recovery/`migrate resolve` runbook only where demonstrably correct and separately approved. Never apply raw SQL to sidestep required history. For config changes use a versioned compensating update, not DELETE of production history. For lost MFA encryption key provide recovery/re-enrollment procedure, not “disable MFA.”

---

## 11. REQUIRED OPERATIONAL METRIC DEFINITIONS

These definitions are part of the API/frontend contract, not merely comments. M0 may refine exact eligible status using authoritative code, but may not substitute arbitrary numbers.

| Metric | Definition / limitations |
|---|---|
| **Paid revenue** | Sum eligible `Payment` successfully paid amounts, attributed by verified paid time and grouped by currency; follow 05.1's **refunded payments excluded** semantics unless a validated net/gross split is explicitly added. Label test/demo transactions if Stripe Test Mode. |
| **Order count** | Count distinct `Order` in selected event window (created vs successfully paid explicitly distinguished); never sum order-line quantity as order count. |
| **Average Order Value** | Eligible paid revenue divided by distinct eligible paid orders for same time window/currency; no division by zero or float drift. |
| **Revenue growth** | `(current - previous) / |previous|` when previous period is nonzero with identical duration and eligibility; otherwise label unavailable/new, do not render false percentage. |
| **Popular products** | Specify units sold, distinct paid orders or paid sales amount; determine with verified order item snapshots, not `Product.updatedAt`. |
| **Popular categories** | State whether based on current catalog category or immutable purchase-time category; if missing historical snapshot, do not fake historic attribution. |
| **Inventory current state** | Current tracked stock count and threshold-derived state using existing InventoryService/status; not a reconstructed inventory time series without historical ledger. |
| **Recommendation impressions** | Accepted deduplicated `IMPRESSION` events representing visible placements; return/request or admin preview is not an impression. |
| **Recommendation CTR** | Deduplicated recommendation clicks / impressions for the same period/surface with exact batch/attribution rules; show N/A when denominator 0; explain incomplete coverage. |
| **Recommendation conversion** | Distinct eligible paid orders/order-items attributed to trusted consented recommendation interactions within explicit configured lookback window; no anonymous order inference. Clearly disclose attribution basis/coverage; N/A if unavailable. |
| **Fallback and no-data** | Persist or measure actual server-served strategy/fallback outcome. Do not infer from current config alone. |
| **Image-search requests / successes / failures** | Count server-handled requests by actual outcome; expose measured time buckets and selected results only with supportable signed context, no uploaded image retention. |
| **Customer growth** | New verified/registered customers per selected period with clearly stated `createdAt` versus verified date; exclude admin accounts. |
| **Repeat customers** | Distinct customers with ≥2 eligible paid purchases under an explicit all-time or period definition; denominator defined and privacy respecting. |
| **Active deliveries** | Delivery records currently in canonical active fulfillment statuses; do not count completed/cancelled as active. ETA punctuality only if real comparable timestamps exist. |
| **Average session duration** | Not an existing required metric and must not copy Figma's example. Implement only with genuine privacy-safe start/end telemetry; otherwise replace with validated repeat-purchase/customer metric. |

Period controls should use actual calendar/rolling windows consistently (7d/30d/90d/12mo defined and displayed). Group server timestamp buckets using explicit UTC event time unless deliberate IANA store-zone reporting is implemented with daylight-saving tests; formatting never changes which records qualify ambiguously. Monetary calculations must use Prisma Decimal or SQL NUMERIC, not unbounded JS `number` accumulation. Mixed currencies produce separate series or clear currency selector. Historical gaps must show insufficient-data indicators rather than false zeros when no tracking previously existed.

---

## 12. DATA PRIVACY, RETENTION, OBSERVABILITY AND FAILURE RECOVERY

### 12.1 Privacy classification

- **Restricted authentication:** password hashes, MFA/TOTP secrets, recovery codes, invite tokens, pre-auth transaction IDs, refresh JWT/token hashes and WebAuthn challenges — never customer-facing, never telemetry; encrypted or hashed as specified.
- **Restricted commerce/customer:** email, shipping/address, payment summary, account/session metadata — strictly allowlisted and ADMIN permission-checked; no raw customer data in public Storybook snapshots or committed Playwright screenshots.
- **Pseudonymous behavioral:** consented user interactions under 04.4 policy; honor opt-in default OFF, deletion/retention, sparse-data fallback. Existing non-personal recommendation event design remains non-personal; don't silently attach user identity.
- **Aggregate analytics:** controlled event type, time, product/category/strategy/surface and count; apply retention and safe minimum reporting if public disclosure risks exist; no raw images, password, OTP, payment credentials or tokens.

Account deletion must clean/reconcile new preference/attribution/session tables according to existing deletion policy without destroying immutable commerce facts or leaving active admin sessions for deleted users. Retention for failed login events must be explicitly bounded and comply with existing security log semantics; do not keep detailed device/IP history indefinitely.

### 12.2 Logging and monitoring

Every significant admin security/change operation records a correlation ID, actor (or appropriately protected attempted actor), resource ID/type, allowed/rejected result, timestamp and sanitized reason. Ensure logs cover: invitation created/accepted/revoked/send failure, MFA enroll/failure/recovery/disabled, passkey add/remove, session revoked, owner permission grant, store/shipping config published, recommendation policy/pin changed, analytics ingestion errors. No raw secret values, request bodies or full sensitive contacts.

Back-end analytics and API failures must surface safe health/error responses and allow local diagnosis. Avoid infinite retries when Brevo/DB/AI is down; use bounded retries/durable outbox where infrastructure already supports it. No silent success toast when save has failed. OTP email failure must not mint an admin session. AI failure uses pre-existing catalog-safe fallback; analytics event failure never blocks checkout.

### 12.3 Disaster/operational recovery cases

- **Lost admin MFA:** use tested recovery codes or limited operator recovery requiring identity proof and audit; never a publicly exposed bypass.
- **Lost last owner:** documented manual, operator-controlled procedure with independent authorization, immutable audit and last-owner guard; not “allow any admin to self-promote.”
- **Brevo unavailable:** invitation created with explicit pending/failed mail state, no privilege issued; resend after recovery with replacement token if needed.
- **Encryption key missing/rotated:** error closed; no fallback to plaintext or broad unencrypted access; define key rotation and re-enrollment procedure.
- **Invalid settings change:** versioned rollback/forward correction; keep prior approved checkout shipping rate for existing in-flight attempts per contract.
- **Analytics backlog:** report data freshness, reconcile from trusted source, no fabricated or duplicate events; background aggregation must never stall live checkout.
- **DEV unstable:** record backend logs/network, attempt focused safe diagnosis, use disposable QA and CI where appropriate; do not claim shared DEV passed solely on isolated results.

---

## 13. SCOPE/SCREEN MATRIX — FRONTEND, API, PERSISTENCE AND VISUAL VERIFICATION

| Screen / module | Primary user outcomes | Backend/DB dependency | Visual source / QA focus |
|---|---|---|---|
| `/admin/login` | Password→MFA; expired challenge/recovery/locked states; successful return URL | Existing auth + new pre-auth/MFA/session | `Admin login.png`; no login token bypass; enter/keyboard/responsive |
| Invitation registration | Valid invite, identity fields, email verification, pending setup | `AdminInvitation`, registration, Brevo, MFA enrollment | New page in established brand grammar; actual E2E, no Figma frame |
| `/admin/settings/administrators` | Team list; create/resend/revoke invite; secure access | Invitation/team APIs; owner permission | New table/dialog states, keyboard/focus, mobile |
| `/admin/profile` | Account info and save | safe self identity/profile APIs | New profile design, real authenticated persistence |
| `/admin/profile/security` | TOTP/passkey/recovery enroll/revoke | Factor/WebAuthn/step-up API, encrypted DB | New security flows, secret-free screenshot fixtures |
| `/admin/profile/sessions` | Active sessions, revoke, login history | RefreshToken lineage, AdminSession, events | New device/session cards, real revocation |
| `/admin/settings` Store | Identity/contact/timezone/currency | versioned settings API | `Settings page.png`, `Settings_page.png` |
| `/admin/settings` Notifications | Honest alert/mail preferences | preferences and Brevo events | `Settingspage.png`; no fake maintenance control |
| `/admin/settings` Shipping | Rates, eligible methods/threshold, quote effect | config + canonical checkout/order domain | `Settings-page.png`; payment/quote integration |
| `/admin/recommendations` | Strategy, pin, preview, activity and real store effect | config/pin services + existing recommendation engine | New visual extension of admin cards/tables; Storybook/live browser |
| `/admin/analytics` top | Period selector, KPI cards, revenue chart | report service, Payment/Order/Customer | `Analytics page.png` comparison |
| `/admin/analytics` lower | products/categories/growth/recommendation/image search/delivery/inventory | report service + trusted telemetry | `Analytics_page.png` comparison |
| `/admin/products` safe bulk selection | Page-scoped selection, confirm, partial results | existing catalog domain, capped batch | Existing products screenshots + new actual states |
| Customer recommendation surfaces | Configured/ranked/pinned/consent-safe rails | public recommendation endpoints/AI | Existing customer design, actual data/no double event |
| Customer image search | Real search outcome and privacy-safe activity | image search, instrumentation | Existing customer design and keyboard/mobile |
| Customer checkout | Real configured shipping, immutable payment/order snapshot | CheckoutService/checkout.domain + Stripe Test Mode | Current approved customer checkout design and E2E |
| 05.1 operational shell | Preserve all routes, menu, collapse, page performance | current admin backend | Compare existing approved screenshots only where changed |

Every additional state/screen designed without a 05.2 Figma reference must use the same typography, colors, form patterns and spacing tokens; deliberate improvement may expand panels but must never become an unrelated generic SaaS template.

---

## 14. REVIEW AND FIRST-HANDOFF QUALITY CONTRACT

### 14.1 Risk-tiered review (no endless loops)

**Level 1 — small visual changes:** inspect changed component and immediate callers, Storybook/targeted visual + typecheck/lint as appropriate.\
**Level 2 — significant feature/API changes:** inspect full changed files, relevant routes/services/schema, focused unit/API/integration plus real page browser behavior; check docs and migrations.\
**Level 3 — critical security/financial/migration changes:** inspect all changed files and exact sensitive dependencies, negative tests/concurrency, disposable real DB migration/flows, existing auth/checkout regression, end-to-end evidence and final CI; separate prod release approval.

Avoid repeated broad scanning of unrelated files and re-running unchanged tests. Read the full changed file for review, plus only affected callers/dependencies. Reuse prior accepted 05.1 evidence for unchanged code. If new actual bug affects an existing area, fix the root cause and verify that regression specifically; don't create random new bugs by opportunistic redesign.

### 14.2 Required code-quality practices

- Prefer small cohesive services/controllers and composable components over huge generic `adminAdvanced.service.ts` or one giant settings component.
- Explicit validation, typed DTOs, only semantic domain abstractions, no raw client Prisma query passthrough, no `any` or unchecked unsafe casts just to satisfy TS. Retain established ESM imports, formatting, lint rules and SCSS modules.
- No new dependency without concrete need; WebAuthn/TOTP libraries require provenance, maintenance/security check and narrow integration. Avoid rolling own cryptographic primitives or inventing a new AI framework.
- Avoid expensive analytics on every customer request; reuse existing async workers/outbox when durable events required. Use efficient indexes and fallback/error state.
- No direct SQL string concatenation from user filters; parameterized queries, stable ordering and proper pagination. Store timestamps UTC and money Decimal.
- Maintain README/feature/API/migration docs proportionately, no repeated entire-file architecture rewrites. New ADR only for a material decision such as mandatory admin MFA and session assurance or global shipping-price persistence.

### 14.3 Final engineering diff review

At handoff, provide `git diff` against the verified `develop` merge base including staged and untracked work, complete changed-file list grouped by module, full-file source for changed critical files, adjacent service/route references, migrations, tests and screenshots. The Principal Architect will validate:

1. Every requirement traces to actual code/API/DB/browser evidence.
2. No alternate admin auth bypass; no role escalation/invite replay; session revocation works.
3. No customer auth, checkout, Stripe Test Mode, AI, delivery, 05.1 admin regression.
4. Consistent UI + design system, actual screenshot comparison, clean browser and a11y behavior.
5. Correct analytics definition and data lineage, no fake conversion or invented metrics.
6. Migration SQL/constraints and DEV/PROD isolation are safe; approvals documented.
7. Changed code is maintainable, secure, proportionate, performant and not duplicated.
8. Final CI on exact head, realistic tests and deployment/forward-fix notes exist.

Only actionable defects or material evidence gaps block acceptance. Prefer a single focused corrections pass to repetitive audits. Accepted minor residual risks are listed and tracked, not reopened without changed facts.

### 14.4 Required first-handoff report template

```text
TASK 05.2 — FINAL IMPLEMENTATION HANDOFF
BRANCH / BASE COMMIT / HEAD COMMIT / PR URL:
APPROVED 05.1 BASELINE PRESERVED:
M0–M11 STATUS: PASS / FAIL / NOT VERIFIED by milestone
CHANGED FILES: frontend / backend / schema+migrations / tests / docs
NEW ADMIN ROUTES AND API CONTRACTS:
AUTH HARDENING: registration, MFA, passkeys, recovery, session revocation
SETTINGS: store, shipping quote, notifications, team
RECOMMENDATION MANAGEMENT: strategy, pin, preview, actual customer effects
ANALYTICS: metric definitions, data sources, measured coverage, limitations
SECURITY: critical attack tests with result and proof
DATABASE: disposable migration results; DEV identity, status; PROD untouched
STORYBOOK: exact stories/build/visual evidence
PLAYWRIGHT: environment/viewport/actual test and screenshot IDs
E2E: real login/invite/OTP/passkey/shipping/recommendation/analytics flows
TESTS: exact executed commands, counts, failures and CI SHA
BUGS FOUND AND FIXED: root cause, impacted files, regression verification
FIGMA DEVIATIONS: filename, before vs after, justified intentional changes
RISK / LIMITATIONS: blocker vs accepted optional follow-up
PROPOSED SCORE /100 AND REVIEW VERDICT (Architect independently decides)
COMMIT/PUSH/MERGE/PROD STATUS:
```

Never print/attach secrets, user emails, OTP/QR data, raw Playwright authenticated storage state or sensitive HAR files. Capture QA screenshots with synthetic/masked data; gitignore real DEV PII captures. A markdown “all tests PASS” sentence with no execution evidence is insufficient.

---

## 15. IMPLEMENTATION BRANCH, COMMITS AND PR HANDOFF

1. Revalidate the already-present `feature/05.2-admin-advanced-features` head, compare to current `origin/develop`, preserve unrelated edits and coordinate conflicts; do not re-create the branch or reset it to a previously observed SHA.
2. Implement M0–M11 as one task. Use logical reviewable commits (e.g. auth schema, invitation/MFA gate, WebAuthn/session security, Settings/checkout, recommendations, analytics instrumentation/reporting, shared UX, final tests). Never leave half-finished security components enabled on shared DEV.
3. Keep migration and application compatibility by deployment phase. If an architecture gate truly requires review, document the concrete decision and safest implementation; do not fake completion or indefinitely postpone in-scope behavior.
4. Stage only task-scoped code/tests/docs/migrations. Do not commit `.env`, tokens, captures with PII, secrets, dumps, generated migrations applied directly to shared PROD or incidental unrelated artifacts. Validate `git diff --check`.
5. Push feature branch and open **one normal PR against `develop`** under authorized workflow, with migration notes and concise evidence. Do not force push, bypass required CI, merge, deploy or run production database modifications without separate explicit authorization.
6. Wait for CI on actual final PR head; fix relevant failures. Confirm PR mergeability and no unintended migration/files, then request independent Principal Architect source/diff approval.

**Definition of Done:** implemented code + actual behavior + backend/DB integrity + verified visual/browser security + documented results + final CI + Architect approval. An implementation summary alone is not completion. Phase 06 starts only once 05.2 is accepted, with residual risks explicitly recorded.

---

## 16. FULL ACCEPTANCE CHECKLIST — AUTHORITATIVE, TRACEABLE, NOT PRE-CHECKED

Use `PASS`, `FAIL`, or `NOT VERIFIED`, with source/line or test name, environment, exact commit SHA and screenshot/trace path where applicable. An accepted rationale for genuinely unsupported metrics/controls must explicitly refer to the truthful alternative described in this specification; it is **not** acceptable to silently omit core 05.2 scope. No checked boxes below indicate implementation completion; this is a future acceptance instrument.

### A — Repository, architecture and scope

- [ ] **A01** Verified newest develop, existing feature branch, current working tree and predecessor PR #44; no reset/overwrite.
- [ ] **A02** Read AGENTS, 05.1 evidence, architecture standards, actual source, relevant migration history and package scripts before changes.
- [ ] **A03** Existing ADMIN/CUSTOMER/Google/refresh/OTP paths traced, including all session issuance and bypass candidates.
- [ ] **A04** Exact 05.2 Figma Make files opened visually, native dimensions/state mapped, screenshot fidelity/expansion decisions documented.
- [ ] **A05** M0 exists/extend/new matrix and role/capability/cutover architecture reviewed before broad implementation.
- [ ] **A06** One feature branch, one coherent 05.2 task, Phase 06 boundary preserved, no unrelated redesign.

### B — Schema, migrations and environments

- [ ] **B01** New schema has concrete security/product/analytics invariants and no duplicated existing domain storage.
- [ ] **B02** Reviewed additive Prisma migration SQL, relationships, indexes, enums, backfill/compatibility and rollback/forward-repair.
- [ ] **B03** Clean disposable PostgreSQL install + baseline-upgrade migration succeeds, repeat deploy no-op, ledger/checksum intact.
- [ ] **B04** DEV environment identity verified, migration applied and reconciled only with required authorization; PROD not modified.
- [ ] **B05** Encryption key versioning, safe secret storage, retention, account deletion and admin cutover operational plan implemented.
- [ ] **B06** DB performance/access constraints measured/verified where relevant; schema.prisma matches reviewed migrations.

### C — Invitation-only administration

- [ ] **C01** Existing privileged verified admin can issue invite with exact email, expiry, token digest, durable audit and email-outbox semantics.
- [ ] **C02** Invitation email actually delivered/captured in authorized environment, retry/resend/revoke state works without leaking tokens.
- [ ] **C03** Recipient registration validates first/last/email/password; role assigned on server; MFA enrollment required before privileged access.
- [ ] **C04** Expired, revoked, replayed, wrong-user, used or concurrent invitation acceptance rejected without double-create.
- [ ] **C05** Unprivileged ADMIN, CUSTOMER, guest and malformed direct API attempts denied; last-owner/self-escalation safeguards work.
- [ ] **C06** One-time production-safe bootstrap and existing-admin migration strategy implemented/tested; no hardcoded production admin credentials.
- [ ] **C07** Team and invitation UI works in real browser with accurate statuses, keyboard navigation, responsive dialogs, error/retry.

### D — Admin MFA/TOTP/OTP

- [ ] **D01** Password-only ADMIN login yields restricted pending challenge, no ADMIN bearer/refresh authorization before second factor.
- [ ] **D02** Existing generic login/refresh, Google/account recovery routes cannot bypass new policy or resurrect unassured sessions.
- [ ] **D03** TOTP enrollment uses encrypted secret, confirmation and strong replay/expiry/attempt protection.
- [ ] **D04** TOTP verification binds correct challenge/account, issues proper session assurance and respects bounded clock drift.
- [ ] **D05** Recovery codes revealed once, stored as hashes, consumed atomically and invalidated on regeneration.
- [ ] **D06** Brevo email verification/recovery follows strict restricted policy; cannot serve as undocumented permanent weak MFA bypass.
- [ ] **D07** Invalid/expired/replayed/locked challenges, abandoned enrollment and missing key have safe UX and fail-closed API results.
- [ ] **D08** Frontend admin login matches screenshot's core structure and supports polished step-2 OTP, recovery, error and responsive states.

### E — Passkeys, sessions, history and personal security

- [ ] **E01** Real WebAuthn registration + authentication verifies challenge, signature, RP ID, origin, user verification and credential owner.
- [ ] **E02** Multiple passkeys listed/labeled/revoked, foreign/replayed/expired assertions denied, private keys never stored.
- [ ] **E03** Current and other admin session families list reliably; revocation disables old access and refresh authorization, not refresh alone.
- [ ] **E04** Session creation/rotation/revocation/password change/deactivation preserve existing locking/deletion semantics.
- [ ] **E05** Sensitive account/security actions require recent strong reauthentication; last factor and last owner protected.
- [ ] **E06** Bounded, sanitized login/security history and factor-change audit render without leaking unnecessary location/PII.
- [ ] **E07** My Profile, Security and Sessions pages function with actual APIs, complete states, responsive, keyboard, zoom and passkey/browser support feedback.

### F — Store settings, shipping, notifications and admin IA

- [ ] **F01** Admin navigation shows only working Recommendations, Analytics, Settings and account destinations; old 05.1 routes remain valid.
- [ ] **F02** Settings Store fields persist through validated versioned API; unsupported currency change read-only; real IANA timezone.
- [ ] **F03** Shipping rates/methods are limited to supported business capabilities and actually change canonical new checkout quotes.
- [ ] **F04** In-flight quote consistency, payment attempt totals, provider test mode and immutable historical order shipping verified.
- [ ] **F05** Notification preferences persist per admin and affect actual supported mail delivery; required security/customer mails cannot be disabled.
- [ ] **F06** Maintenance mode omitted absent production-safe infrastructure implementation; admin digest shown only if real.
- [ ] **F07** All four Settings screenshots compared with real page states, including lower fold, validation, tabs, keyboard/mobile and actual zoom.
- [ ] **F08** Every enabled settings action has consistent loading/error/conflict/success UX, no fake Saves or data loss on tab/Back.

### G — Recommendation console and customer integration

- [ ] **G01** `/admin/recommendations` includes functional Overview, Strategies, Featured Products, Preview and Activity.
- [ ] **G02** Only engine-supported per-surface mode/strategy/fallback combinations can be configured; backend validates independent of UI.
- [ ] **G03** Config is persisted/versioned/audited; concurrent edit 409 and cache invalidation handled.
- [ ] **G04** Pin scheduling/priorities, duplicate avoidance and eligible catalog filters enforced at write and response time.
- [ ] **G05** Featured/pinned products appear in real eligible customer response and disappear when expired/hidden/archived/out-of-stock.
- [ ] **G06** Customer personalization consent off remains off; no private profile leakage or misleading “personalized” forced pin.
- [ ] **G07** Preview uses genuine algorithm/service responses, clearly labels synthetic context, produces no real event mutation.
- [ ] **G08** Mode/strategy/fallback/impression/click reports are real, appropriately labeled and privacy-preserving.
- [ ] **G09** FastAPI outage/cold-start fallback and customer page/cart/checkout remain available; existing 04.4 tests/regression preserved.
- [ ] **G10** New console states, pin dialogs/search, keyboard/mobile and customer rail integration verified via Storybook and real browser.

### H — Analytics pipeline and data privacy

- [ ] **H01** Analytics event taxonomy, source trust, limits, idempotency, timestamps and privacy/consent rules centralized.
- [ ] **H02** Actual image-search request/outcome/selected-result tracking implemented without image/credential contents in storage.
- [ ] **H03** Existing recommendation/product interaction events reused; no double counting on retries/rerenders.
- [ ] **H04** Recommendation CTR numerator/denominator clearly defined, deduplicated, zero-safe and reconciled.
- [ ] **H05** Paid conversion attributed only with genuine eligible, consented and trust-verified payment linkage; otherwise honest N/A.
- [ ] **H06** Analytics retention, deletion/consent revocation and event backfill limitations tested; security events remain separate.
- [ ] **H07** Analytics ingestion errors/outages do not affect customer pages or checkout; safe observability exists.
- [ ] **H08** No arbitrary browser-side “revenue/purchase succeeded” event can alter business facts or be accepted as authoritative.

### I — Historical and operational Analytics page

- [ ] **I01** Revenue correct by eligible paid time/status/currency and 05.1 refund exclusion; test/demo designation clear.
- [ ] **I02** Orders and AOV definitions, distinct counts, previous-period growth and zero denominator accurate.
- [ ] **I03** Top products and category breakdown based on actual paid facts, with historical-taxonomy limitations labeled.
- [ ] **I04** Inventory current counts/stock state and historical trend (only if event-backed) correct.
- [ ] **I05** Recommendation usage/fallback/CTR and conversion coverage accurately reported.
- [ ] **I06** Image-search analytics measured and no-results/failure/latency definitions documented.
- [ ] **I07** Active delivery counts/statuses and duration punctuality only when actual data supports them.
- [ ] **I08** Customer growth and repeat-buyer metric correct; Figma session-duration example not copied without evidence.
- [ ] **I09** 7/30/90/12-month selector, currency/zone/date labels, charts and drilldowns work in browser without stale data confusion.
- [ ] **I10** Top/scrolled Analytics screenshot visual comparison plus 390/768/1440/1920, keyboard tooltips, loading/no-data/partial-failure.

### J — Bulk actions, UX polish and accessibility

- [ ] **J01** Page-scoped actual row selection with accessible checkboxes and accurate selected count; not fake all-page selection.
- [ ] **J02** Bounded bulk product archive/reactivate/featured actions validate each row, version and permission; partial result accurate.
- [ ] **J03** No new unsafe bulk customer/order/payment/inventory mutation; history intact.
- [ ] **J04** Admin sidebar/header/profile/notifications/new routes remain consistent with 05.1 approved behavior.
- [ ] **J05** All new/touched screens have skeletons, empty/errors/retry/pending/success and meaningful helpful validation.
- [ ] **J06** Dropdowns, modals, tabs, focus/keyboard, mobile/desktop, actual 200% zoom and reduced motion verified.
- [ ] **J07** Charts and interaction have accessible names, semantics, visual focus, non-color indicators and text alternatives.
- [ ] **J08** Tab/page/search performance measured and avoidable stale/refetch storms fixed, no full-page blank loading after routine changes.
- [ ] **J09** Customer storefront/recommendations/cart/checkout/order/delivery/shareable UI remains functional after shared-component changes.
- [ ] **J10** No unnecessary redesign, inert links, fabricated UI data, unsupported Settings toggles or console errors.

### K — Testing, evidence, PR and approval

- [ ] **K01** Focused frontend Vitest and Testing Library specs pass for relevant new/touched components.
- [ ] **K02** Backend unit/route/Supertest security-negative tests and service integration pass.
- [ ] **K03** Disposable real DB migration, invitation/MFA/credential/session/checkout/recommendation/analytics/bulk E2E pass.
- [ ] **K04** Real `localhost:3000` + verified shared DEV browser flow provides safe live evidence; destructive flows isolated.
- [ ] **K05** Existing Storybook component states and Storybook build pass, visual exports inspected, no sensitive artifacts committed.
- [ ] **K06** Figma reference-to-live comparisons complete (all 7 05.2 screenshots); new no-reference views visually reviewed in design system.
- [ ] **K07** Keyboard/focus/a11y/mobile/tablet/desktop/large/real zoom/reduced motion findings documented and blockers fixed.
- [ ] **K08** Frontend/backend typecheck, lint, build and affected tests pass; `git diff --check` clean.
- [ ] **K09** CI requirements pass on **actual final feature PR head SHA**, docs/API/schema/evidence in sync.
- [ ] **K10** Full changed-file engineering/diff review completed, critical dependencies inspected, migrations/rollback/privacy/security verified, no material blocker.
- [ ] **K11** No production migration/write/merge/deployment without separate authorization; branch/PR status truthful.
- [ ] **K12** Principal Architect gives score /100 and explicit ✅ Approve / ⚠ Request Changes / ❌ Reject; accepted residual risks recorded.

**Closing policy:** A material security/data-integrity blocker overrides a numerical score. Do not demand a perfect demonstration of physically inaccessible hardware or externally blocked infrastructure to approve independent safe functionality, but never misstate it as verified. When the task's implementation and required QA are proven and residual risks acceptable, close the task—do not continue theoretical audit cycles.

---

## 17. PROJECT SOURCE REGISTER AND TASK-SCOPED READING ORDER

Read the **actual latest** repository files and follow links between services. Exact path may evolve; discover rather than invent old filenames.

### 17.1 Foundation and design

- `AGENTS.md` and applicable scoped agent instructions.
- `docs/01_Project Foundation/ROADMAP.md`, `PROJECT_VISION.md`, `PROJECT_STRUCTURE.md`, `TECH_STACK.md`.
- `docs/03_Architecture/{SYSTEM,FRONTEND,BACKEND,DATABASE,AI}_ARCHITECTURE.md` and relevant deployment/security architecture.
- `docs/04_Engineering Standards/` for auth, validation, API, state, accessibility, coding, privacy and performance.
- `docs/assets/figma/FIGMA.md`, `docs/assets/figma/exports/admin/screenshots/`, established design tokens/styles.
- `docs/08_Quality/{STORYBOOK,TESTING,QA}.md`, existing Storybook preview/stories and Playwright configs.
- Relevant approved ADRs, `docs/05_Features/{ADMIN,ANALYTICS,RECOMMENDATIONS,AUTHENTICATION,ORDERS,INVENTORY,...}` (only files that actually exist), `docs/07_AI/RECOMMENDER.md`, task 04.4 and 05.1 specifications and implementation evidence.

### 17.2 High-risk code inspection targets

- `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/`, schema/seed/DB safety scripts.
- `apps/backend/src/services/auth.service.ts`, `apps/backend/src/repositories/auth.repository.ts`, `apps/backend/src/controllers/auth.controller.ts`, `apps/backend/src/routes/auth.routes.ts`, `apps/backend/src/middleware/auth.ts`, JWT/OTP/session/email/Google/account deletion code.
- `apps/backend/src/services/recommendation.service.ts`, `recommendation.sql.ts`, `recommendation-token.ts`, recommendation routes, public catalog projection and AI/FastAPI integration.
- `apps/backend/src/services/checkout.service.ts`, `checkout.domain.ts`, checkout/payment attempt/order snapshot, Stripe Test Mode and inventory locking code.
- Image-search request/controller/AI service and customer app usage; existing event writers, Delivery and Socket.IO services.
- Existing admin route aggregation/service patterns and sensitive customer projections.
- `apps/frontend/src/routes/index.tsx`, `apps/frontend/src/layouts/AdminLayout.tsx`, `apps/frontend/src/features/admin/shell/navigation.ts`, `apps/frontend/src/pages/admin/AdminLoginPage.tsx`, AuthContext, shared tables/Radix controls/SCSS, existing 05.1 pages and relevant customer flows.
- Frontend/package scripts, Playwright configs, `apps/frontend/.storybook/`, `apps/frontend/src/**/*.stories.tsx`, focused auth/recommendation/checkout/browser suites.

### 17.3 Inspected 2026-11-04 facts requiring refresh at execution

- PR #44 (05.1) merged into `develop`; observed develop SHA `581726eff055db1dca4778c6e17ce86228509a1f`.
- `feature/05.2-admin-advanced-features` **already existed** and its observed SHA was the same as develop; do not recreate it.
- The seven 05.2 screenshot names are present on `develop` as inventoried in §2.1.
- Existing `OtpPurpose` includes email verification/password reset/email change/sensitive action; no dedicated Admin MFA purpose confirmed. Existing `SecurityEventType` has generic login/account events only. Existing `RefreshToken.familyId` is available and must remain compatible.
- Existing frontend has Storybook 9, Playwright, Vitest; backend has Prisma + Supertest. Check current versions and scripts before use.
- Existing recommendation interactions are privacy-conscious; `RecommendationEvent` is non-personal and cannot alone identify paid conversions.
- Existing checkout has fixed domain-level delivery methods and totals; real Shipping Settings require careful service integration, not simple frontend mutation.

**This document does not claim any 05.2 code was implemented, any migration applied, any test passed or any production environment touched.** All tests, APIs and tables marked proposed are implementation requirements to reconcile with source at M0.

---

## 18. FINAL ONE-PARAGRAPH HANDOFF TO IMPLEMENTING AGENT

Implement **the complete Task 05.2 M0–M11** in ElectroHub on the existing `feature/05.2-admin-advanced-features` branch based on inspected latest `develop`, preserving merged Task 05.1. **Inspect the repository and every relevant Figma Make screenshot before coding**; use screenshot exports in `docs/assets/figma/exports/admin/screenshots/` without requesting a live Figma link. Complete invitation-only ADMIN onboarding, strong mandatory MFA/TOTP, passkeys/WebAuthn, recovery, session revocation and login history; real Store/Shipping/Notifications/Team/Profile/Security settings; actual recommendation strategy configuration/pins/preview/activity; trustworthy commerce, recommendation, image-search and delivery Analytics; only selected safe bulk operations; premium accessible cross-admin/customer UX with consistent responsive/motion/visual states. Implement and verify frontend, backend API/services, Prisma migrations, identity-gated DEV migration where authorized, checkout compatibility, AI/consent/privacy and security invariants. Reuse existing Storybook/Vitest/Supertest/Playwright and real browser `localhost:3000` with verified shared DEV for safe flows; use disposable QA for destructive scenarios. Run focused evidence-driven tests after changes and final CI on real PR head. Provide one concise traceable final handoff, **no unapproved PROD writes, merge or deploy**, and request independent Principal Architect source/diff approval. Fix genuine in-scope bugs at root cause, avoid speculative regressions and redundant audit loops.

> **Final acceptance principle:** A task is complete when its real behavior, architecture, safety, usability and tests are demonstrably correct—not when code exists, screenshots resemble mockups, or a report claims 100/100.
