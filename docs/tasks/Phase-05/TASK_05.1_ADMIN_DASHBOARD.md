# ELECTROHUB — TASK 05.1 / COMPLETE ADMIN DASHBOARD & OPERATIONS

Phase: 05 — Admin & Advanced Features
Task: 05.1 — Admin Dashboard (full operational admin system)
Task type: Frontend · Backend · Database · Security · Accessibility · Visual QA · Integration · Operations
Document status: IMPLEMENTATION SPECIFICATION / FIRST HANDOFF — NOT A CLAIM OF IMPLEMENTATION OR TEST PASS
Prepared: 2026-11-02
Proposed development branch: feature/05.1-admin-dashboard
Base / integration target: up-to-date develop (verify SHA at task start)
Previous approved baseline: Task 04.7 and associated 04.5/04.6 delivery features have been approved, committed, and merged into develop; preserve them.
Primary design input: repository-hosted Figma Make screenshots, docs/assets/figma/exports/admin/screenshots/
Design standards: docs/assets/figma/FIGMA.md, project tokens, existing components, and architecture documents
Delivery: one coherent 05.1 task, subdivided into milestones M0–M9, with reviewable commits and a single final PR; no premature split into 05.2.
Reviewer: Principal Software Architect — risk-based review at milestone boundaries and final merge gate.
Branch status: the requested branch already existed at prior inspection; revalidate it without recreating or resetting it. New API contracts and migrations below remain proposals until reconciled with actual code in M0.
North star: Deliver a complete, production-quality administrative experience that feels like ElectroHub's approved Figma visual language, but goes far beyond a static mockup: accurate commerce data, reliable backend operations, safe persistence, premium interaction quality, responsive and accessible components, comprehensive operational states, and browser-verified integration. Build on what exists. Do not rebuild approved systems or invent data.


## Consolidated baseline and interpretation

This file combines both task specifications into one normative handoff. The detailed requirements, API/security matrices, state coverage and acceptance checklist below incorporate the earlier specification; the following reconciliations apply throughout rather than creating alternative requirements.

- At prior repository inspection, local `develop` and the existing `feature/05.1-admin-dashboard` pointed to `43d1c576fdeb69ac8d3a1e3d510c8361796d0798`; merge `3776679` contained approved 04.7, and the checkout was clean. These are historical observations, not a claim about the current remote. Recheck current status, upstream, divergence and unrelated edits at M0. Do not recreate/reset the branch, silently rebase shared work, or stash another contributor's work. Use a separate worktree when appropriate and branch availability permits.
- Actual inspected Prisma uses `UserRole` with `ADMIN` and `CUSTOMER`; earlier shorthand “Role” refers to this enum, not a proposed additional model. All schema field names, lengths, status definitions and installed versions must be verified against current code. Stock on-hand/reserved/available values must reflect actual model semantics; do not invent separate stored quantities.
- The roadmap source and earlier task numbering may differ by revision. Consolidating operational modules into 05.1 and deferring the named advanced scope to 05.2 is the owner's explicit planning refinement. Inspect the current roadmap rather than treating a historical section description as proof of current contents.
- Use existing Storybook first. A development-only `/dev/components` fallback is permitted only for a documented concrete gap, must render the same production components with synthetic data, and must be excluded from production. It complements real-page testing and does not justify a parallel story system.
- Customer active-status mutation requires established safe account/session policy; otherwise deliver read-only summaries/status and obtain targeted architect disposition of the gap. New financial cancellation/refund orchestration remains outside scope; wire only already-approved safe workflows. Unsupported screenshot actions must be omitted or clearly explained.
- Existing delivery simulation policy remains authoritative, verified server-side by environment/database identity and eligible order policy. Ordinary purchases and production remain protected; availability must never depend on frontend flags or local port. Preserve Start, movement, Stop, refresh and provenance for eligible fixtures, without financial/inventory side effects.
- Validate migration from both empty and baseline disposable PostgreSQL, maintain applied history/checksums and document compatibility, locking/backfills and forward repair. Shared DEV writes require the stated authorization; production rollout is a separate release action.
- For conflicts between illustrative route/status/schema examples and actual code, M0 records a compatible contract and targeted review. No new state enum, currency restriction, retention assumption or business capability is authorized merely by a sample value.

### Exact screenshot filename register from prior inspection

All names below are relative to `docs/assets/figma/exports/admin/screenshots/`; verify current inventory and native dimensions at M0.

| Domain | Files |
| --- | --- |
| Dashboard | `Dashboard page.png`, `Dashboard_page.png` |
| Products | `products page.png`, `products_page.png`, `Create Product.png`, `Edit product.png`, `Delete product.png` |
| Categories | `Categories page.png`, `Add category.png`, `Edit category.png` |
| Inventory | `Inventory page.png`, `Inventory_page.png` |
| Orders | `Orders page.png`, `Order details page.png`, `Order_details_page.png` |
| Delivery | `Delivery page.png` |
| Customers | `Customers page.png` |
| Future 05.2 references | `Analytics page.png`, `Analytics_page.png`, `Settings page.png`, `Settings-page.png`, `Settings_page.png`, `Settingspage.png`, `Admin login.png` |

Screenshot exports are sufficient Make input for this task; no new live Figma link is required. Match actual reference dimensions plus 390/768/1440/1920 CSS-pixel coverage, manually compare actual DOM, and record intentional premium expansions. Pixel-level comparison is a verification method; documented data/responsive changes must not be misrepresented as exact pixel identity.

## 0. EXECUTION AUTHORITY, REPOSITORY-FIRST CONTRACT, AND HANDOFF RULES

### 0.1 First action: inspect the repository, not implement from screenshots

Before editing any file, the developer must:
1. Read root AGENTS.md and any applicable scoped AGENTS.md; follow repository instructions and docs/prompts/DEVELOPER_PROMPT.md / fixed frontend visual developer prompt where applicable.
2. Verify git status, current branch, upstream, current local/remote develop SHA, open PRs, uncommitted changes, and available dev/test processes. Never assume a clean worktree.
3. Inspect the existing feature/05.1-admin-dashboard branch against verified current develop; create it only if absent, and never reset existing work; if local edits are present, preserve them or use a separate Git worktree. Do not silently stash/overwrite another person's work; do not reuse the merged 04.7 branch.
4. Inspect the actual latest frontend, backend, Prisma schema, migration history, service/repository layers, API conventions, Storybook and Playwright setup. The baseline observations in this document are not an excuse to skip fresh inspection.
5. Inventory and visually open every relevant screenshot in docs/assets/figma/exports/admin/screenshots/; read docs/assets/figma/exports/admin/README.md and docs/assets/figma/FIGMA.md. Map every screenshot to a route, component and state, or explicitly identify it as a design-only reference.
6. Read the architecture and feature rules: docs/01_Project Foundation/ROADMAP.md, PROJECT_VISION.md, PROJECT_STRUCTURE.md, TECH_STACK.md; docs/03_Architecture/{SYSTEM,FRONTEND,BACKEND,DATABASE}_ARCHITECTURE.md; docs/04_Engineering Standards/ (security, API, state, code standards); docs/05_Features/{ADMIN,PRODUCTS,CATEGORIES,INVENTORY,ORDERS,DELIVERY_TRACKING}.md; docs/06_Database/ migration guidance; docs/08_Quality/{STORYBOOK,TESTING,QA}.md; and applicable ADRs/operations runbooks.
7. Enumerate existing routes, controllers, validators, services, Prisma clients and tests. Record implemented versus missing capabilities separately by frontend, backend and database. Reuse existing code and tests where credible.
8. Confirm current environment isolation: disposable local PostgreSQL for write tests; explicitly authorized Supabase DEV for narrow smoke tests; never production for development or ad-hoc migration.
9. Prepare the M0 baseline/contract note and milestone test/evidence plan before broad implementation. Do not propose a wholesale redesign or automatically create migrations.
Mandatory starting commands (adapt to OS/repo)
```powershell
git status --short
git branch --show-current
git remote -v
git fetch origin develop
git log -1 --oneline origin/develop
git diff --stat
git ls-files --others --exclude-standard
```
Check actual branch and worktree before git switch -c feature/05.1-admin-dashboard origin/develop or creating a worktree. Never run a destructive reset --hard on owner files.

### 0.2 Evidence hierarchy and baseline provenance

Implemented code + real test evidence > current feature/docs/contracts > roadmap objectives > Figma Make screenshot visual intent. Screenshots do not prove hidden APIs or business operations. The approved design reference hierarchy in FIGMA.md distinguishes live Figma Design, project design documentation, Figma Make screenshots, and implementation. For this task, the owner specifically directs an offline screenshot-led Figma Make workflow: do not require a live Figma Design link or Figma MCP access. Respect existing tokens and component rules; do not claim Figma Design variables were inspected when they were not. If screenshot detail is insufficient, use existing design tokens, documented component semantics and a reasoned enhancement recorded in the deviation log.

The owner has supplied visual references for dashboard (top/scrolled), products (list/create/edit/delete), categories (list/add/edit), inventory (top/scrolled), orders (list/detail/scrolled detail), delivery (list), customers (list); reference images are in the repository folder above, whose exact filenames must be inventoried rather than guessed. The screenshots show the desired visual composition, not evidence that the corresponding pages currently function.

### 0.3 Read-only repository inspection baseline (revalidate on branch start)

Previously inspected develop included:
- ```text
apps/frontend/src/routes/index.tsx: /admin/login exists; /admin is a placeholder; /admin/products currently focuses on product-media management; /admin/products/:productId/media exists; /admin/deliveries and /admin/deliveries/:orderReference exist. Dedicated frontend category, inventory, order and customer management routes were not observed in the inspected router.
- apps/frontend/src/layouts/AdminLayout.tsx: basic brand, sidebar and incomplete navigation placeholders.
- Existing protected routing uses ProtectedRoute requiredRole="ADMIN"; admin authentication page exists. Keep existing authentication working throughout 05.1.
- apps/backend/src/services/inventory.service.ts: concurrency-aware setStock, increaseStock, decreaseStock, getSnapshot, status derivation and validation already exist; use, extend or wrap correctly rather than writing competing stock logic.
- Task 04.3 product-media components/APIs and Tasks 04.5–04.7 delivery lifecycle/Socket.IO/Leaflet components/APIs are implemented and approved. Integrate them rather than replacing them.
- Repository already installs Storybook 9 (@storybook/react-vite, @storybook/addon-a11y) and Playwright, with npm run storybook --workspace=apps/frontend, npm run build-storybook --workspace=apps/frontend, multiple visual specs and viewport presets Mobile 390 / Tablet 768 / Desktop 1440 / Large Desktop 1920. Reuse these existing tools; do not create a parallel /components route or a second story system unless a concrete gap requires it.
- Existing frontend stack: React 19, TypeScript, Vite, React Router, TanStack React Query, SCSS Modules, Radix, Lucide, Framer Motion, Storybook, Playwright and Vitest. Backend: Express, Zod, Prisma, PostgreSQL, Vitest and Supertest. TanStack Table and React Hook Form are documented patterns; verify actual installed versions before importing, and add only justified dependencies.
- Existing schema.prisma includes User/`UserRole`, Product, ProductImage, ProductSpecification, Brand, Category, Inventory, Order, OrderItem, Payment, PaymentAttempt, Delivery, DeliveryEvent, RefreshToken, SecurityEvent, OtpChallenge, ProductInteraction, and RecommendationEvent. The owner-supplied schema snapshot is a useful baseline; the branch's actual apps/backend/prisma/schema.prisma and migrations are authoritative for implementation.
This is a scope starting point, not a complete audit or a claim that any specific proposed admin mutation endpoint exists.

### 0.4 Task completion and authority

The implementing developer may build, test and prepare task-scoped commits on the 05.1 feature branch; publishing the branch/PR follows the agreed Git workflow. No unapproved merge, PROD deployment, migration execution against PROD, live Stripe charge, real Brevo dispatch, broad shared-DEV mutations, or destructive historical-data cleanup. At each completed milestone, provide concise evidence for Architect review; do not require pointless repeated testing of untouched approved components. Keep customer order, media and delivery contracts backward compatible.

## 1. PURPOSE, USER OUTCOMES AND FUNCTIONAL DEFINITION OF DONE

### 1.1 Objective

Implement all roadmap Task 05.1 Admin Dashboard capabilities end-to-end:
1. Admin navigation and unified admin application shell.
2. Dashboard operational overview with real authenticated data.
3. Product CRUD/lifecycle, images, specifications, category, status and stock management.
4. Category lifecycle management.
5. Inventory quantity adjustments, restocking, low-stock alerts and availability visibility.
6. Order list/details, payment-state visibility, authorized order-state progression and shipment management.
7. Customer/user administration (authorized customer list, details, status and order lookup).
8. Delivery management using the previously approved implementation (start tracking, update status/location/ETA, active deliveries, history, simulation/provenance, realtime where appropriate).
9. Production-quality 05.1-owned loading, skeleton, empty, error, form, dialog, responsive, keyboard, focus, motion and mobile interactions.
10. Real persistence, authorization, regression tests, Figma screenshot comparisons, Storybook and actual-browser QA.
User journeys that must work
- ADMIN logs in using the existing admin auth flow → responsive shell → navigates to any 05.1 module → maintains legitimate session → logs out from profile menu.
- ADMIN creates a validated product, assigns category, saves specifications, manages images with the existing media pipeline, sets inventory, publishes appropriately → customer catalog remains consistent.
- ADMIN edits an existing product; archives it safely without destroying order history; can recover it if policy permits.
- ADMIN creates/edits/disables a category; dependent product behavior remains coherent.
- ADMIN finds an inventory item, makes an authorized restock/correction with reason and confirmation, sees reliable low-stock/availability changes.
- ADMIN finds an order, reads immutable item/payment facts, performs an allowed fulfillment transition, and opens the existing delivery detail.
- ADMIN finds a customer and reviews only authorized customer facts/orders; cannot elevate customer role from a general customer-list action.
- ADMIN reads dashboard KPIs, recent orders and stock/active delivery alerts that reconcile with authoritative records, not placeholder screenshot numbers.

### 1.2 Quality bar — premium, not generic CRUD

Deliver a clean → premium → interactive → modern electronics-commerce admin system faithful to the screenshot layout, brand and hierarchy. Each screen must include actual data, realistic constraints, comprehensive states, polished interactions, sensible responsive transformations and accessible semantics. A static collection of screenshot-shaped pages fails 05.1. Likewise, an API-only implementation without high-quality UI and browser proof fails.

### 1.3 Formal definition of done

All M0–M9 acceptance gates pass; all eight core modules are connected; changed API/migrations are safe; privilege boundaries enforced; protected order/payment/inventory/delivery invariants hold; page/story visual snapshots have been reviewed; keyboard and responsive checks pass; affected unit/API/integration/Playwright tests pass; required CI checks are green on the actual PR SHA; docs/evidence and rollback plan updated; Principal Architect approves. Minor known residual risks may be accepted explicitly if no material blocker remains.
## 2. SCOPE BOUNDARIES — 05.1 VERSUS 05.2


| Domain | 05.1: required now | 05.2: explicitly deferred |
| --- | --- | --- |
| Shell | Unified responsive sidebar/header, breadcrumbs, working logout/profile menu, actionable operational alert view | Advanced user preference center, customizable dashboard and deep personalization |
| Dashboard | Bounded current operational aggregates from existing authoritative commerce records | General AnalyticsEvent ingestion, historical event warehouse, advanced time-series reporting, attribution/conversion funnels |
| Products | Catalog create/edit/status/archive, specs, images through existing media pipeline, category/stock linkage | Recommendation configuration, advanced product ranking/featured-pin recommendation controls |
| Categories | Create/edit/list/active lifecycle, relationship-safe archive/disable | Advanced taxonomy redesign without explicit requirement |
| Inventory | Atomic adjust/restock/set, thresholds and accurate stock alerts | Advanced forecasting, business intelligence and cross-domain event aggregation |
| Orders | List/details, payment read-only status, sanctioned fulfillment transitions, delivery navigation | New refund/payment orchestration, financial recovery supervisor redesign |
| Customers | Search/list/detail, authorized safe active-status controls, account order view | Admin invitation/onboarding, new privileged roles, MFA, passkeys, login history UI, multi-session console |
| Deliveries | Integrate/refine approved delivery/Leaflet/Socket.IO workflows, navigation and operational visibility | Rebuild of delivery engine, production fleet-routing or real courier GPS integration |
| UX | Complete, responsive, accessible, polished for new 05.1 screens; all necessary states | Broad cross-application visual refactor, unrelated customer-side polish, advanced bulk table operations |
| Settings | Only functioning profile/logout navigation and basic identity in shell | Dedicated admin Settings, Security page, preferences, MFA setup and invitation console |



**05.2 candidate work packages** (future specification only): 05.2-A admin invitations (hashed, expiring, revocable single-use tokens; admin invitation API and UI); 05.2-B MFA/OTP login; 05.2-C session history/active sessions/passkeys/profile security; 05.2-D recommendation operations; 05.2-E analytics events/aggregation/reporting; 05.2-F settings, selected bulk actions and global UX refinement. Avoid implementing those opportunistically in 05.1. Current enum uses ADMIN, not ADMINISTRATOR; do not invent a new role. Existing seeded-admin login stays as an interim/bootstrap path in 05.1 and must never be exposed as a public admin-registration mechanism; 05.2 will design migration to invitation-only admin onboarding with initial-owner recovery.

Minimal notifications and profile in 05.1
The header notification bell may surface real, bounded operational data (e.g., low-stock alert, active-delivery warning, pending operational item) with meaningful deep-links; no fake unread counters, persisted notification event model or fabricated activity. A status/last-checked view with no global unread badge is acceptable if no trustworthy persisted unread semantics exist. Show current admin display name/role and a functional logout; profile screen may link to existing account page only where authorized and correct. Do not present inert Profile, Settings or MFA buttons as finished functionality: either provide a genuine basic 05.1 destination or clearly mark 05.2-only entry unavailable/omit it.

## 3. NON-NEGOTIABLE ARCHITECTURE AND DATA INVARIANTS

### 3.1 Layering and ownership

```text
Admin React pages / feature components / Storybook stories
    ↓ React Query, typed DTOs, form state, accessible UI
Protected Express routes / middleware (ADMIN server-side)
    ↓ strict Zod validation, bounded queries, error contracts
Domain services (catalog / category / inventory / order / delivery)
    ↓ repositories, Prisma transactions and existing domain guards
Prisma + Supabase PostgreSQL (DEV for approved smoke; disposable for tests)
```
- Backend services, not the browser, enforce every role, state transition, inventory invariant and relationship constraint. Every admin write uses requireAuth + requireRole('ADMIN') or equivalent authoritative middleware; frontend routing alone is never security.
- Do not bypass backend services with frontend-to-database writes. Do not clone existing customer/read, media, order, payment or delivery controllers into competing logic.
- Preserve Product.status (ACTIVE / INACTIVE), Category.isActive, Inventory.quantity and lowStockAt, Order.status, Payment.status, Delivery.revision and history semantics.
- Payment success is provider-authoritative; administration cannot write Payment.status = SUCCEEDED, manually manufacture paid orders, alter immutable historical OrderItem snapshots or directly call Stripe live for QA.
- Order delivery changes reuse existing revisioned delivery APIs, state machine and after-commit Socket.IO; do not write Order.status and Delivery.status independently in unrelated controllers.
- Catalog/order edits must not destroy linked commerce history. OrderItem.productId references Product with onDelete: Restrict; default product lifecycle is archive/unpublish rather than destructive deletion. Category with linked products likewise requires a relationship-safe policy.
- Inventory mutations must preserve atomic, checked quantities and concurrency safety, especially against checkout/purchase/refund/compensation; use existing InventoryService, DB row locking or equivalent proven transaction boundaries.
- Real prices, revenue and currency values derive from stored Decimal data and verified payment records; no fake dashboard statistics.
- Product media follows existing approved Supabase Storage/media publication and AI indexing lifecycle. No direct URL-only image replace shortcut, orphan storage objects, or silent removal of 04.3 readiness protections.
- Do not expose personal addresses, sensitive payment information, secrets, JWTs or raw internal errors in admin logs or screenshot artifacts. Admin may view only necessary PII.

### 3.2 Current domain schema (verify latest migration)


| Existing model / enum | Consequence for 05.1 |
| --- | --- |
| User, UserRole (CUSTOMER, ADMIN) | Real role checks, customer active status; no new privileged role in 05.1 |
| Product (sku, slug, price, compareAtPrice, status, category, brand) | Validate uniqueness, price limits, publish behavior, relationship-safe archive |
| ProductSpecification (group, name, value, sortOrder) | Ordered, validated specification editor; reuse rows |
| ProductImage (storage path, media state, primary, position) | Manage via approved media APIs and source lifecycle |
| Category (name, slug, description, imageUrl, isActive) | Admin CRUD/disable; flat category structure |
| Inventory (quantity, lowStockAt, status) | Atomic adjustments, thresholds, UI status projection |
| Order, OrderItem | Canonical fulfillment state and immutable historical line snapshots |
| Payment, PaymentAttempt, PaymentWork | Read-authorized payment summary only, no manufactured success or recovery |
| Delivery, DeliveryEvent | Existing immutable revision/event tracking, ETA/location, simulation source |
| RefreshToken, SecurityEvent, OtpChallenge | Preserve auth infrastructure; don't repurpose as 05.2 MFA implementation |
| ProductInteraction, RecommendationEvent | Existing event data, not a general AnalyticsEvent warehouse |



Migration decision rule
Prefer zero migrations. Introduce a 05.1 Prisma migration only for a documented, irreducible operational invariant that cannot be implemented using the existing schema or approved services (example: durable inventory adjustment audit history if mandated by applicable standards). If needed: separate written design + additive schema + backfill strategy + indexing/constraints + Prisma client updates + migration on disposable DB + DEV preflight + rollback/forward-repair and deployment plan. Review production migration policy; never quietly apply migrations to PROD during this task. Do not add generic AnalyticsEvent, AdminInvitation, MfaFactor or speculative settings tables here.

### 3.3 API design invariants

- Reuse established /api/... prefix and response envelopes { data, meta? } / { error: { code, message } }; validate with actual existing conventions before naming final routes.
- Use stable canonical product UUIDs, category UUIDs, and ORD-<UUID> order references; avoid scraping display text as identifiers.
- Validate page/pageSize bounds, sort fields/whitelists, search length, cursor/offset pagination and filter enums; cap response size; never accept raw Prisma where/orderBy objects from client.
- Distinguish 400 validation, 401 unauthenticated, 403 non-admin, 404 unknown/private where appropriate, 409 conflict/dependency, 413 media payload, 429 rate limit, 5xx unexpected failure. No stack traces or SQL in response.
- Apply no-store/private cache policy to sensitive admin responses; invalidate the relevant React Query keys after mutations and on session/account transition.
- Pagination/sort/filter must be server-grounded for large datasets. UI-only slicing of an incomplete backend result is not acceptable.
- Use transactions and optimistic concurrency for material edits. Avoid duplicate submission; robust mutation states and clearly worded retry guidance.
- Log sanitized operational metadata (actor/resource ID or safe correlation ID, action, outcome, timestamps) proportionately; avoid raw PII and sensitive form fields.

### 3.4 Recommended frontend architecture (fit actual codebase)

apps/frontend/src/
  layouts/AdminLayout.tsx                  # extend existing, not parallel layout
  pages/admin/...                         # route compositions (naming consistent with repo)
  features/admin/{shell,dashboard,products,categories,inventory,orders,customers}/
    api.ts, queries.ts, types.ts, components/, ...
  features/adminMedia/...                 # reuse existing 04.3
  features/delivery/...                   # reuse approved 04.5–04.7
  components/ui/...                       # reuse existing shared primitives
  **/*.stories.tsx                        # real components, deterministic fixtures
```
This is a proposed organization, not a demand to move approved existing code. Only refactor when necessary for consistent composition or to eliminate proven duplication. Reuse existing SCSS Modules, React Router lazy routing, React Query, Button, Input, Alert, loader, and Radix components. Prefer feature-local components and explicit typed hooks; avoid monolithic pages, unnecessary global stores and duplicated server state.
## 4. MANDATORY UI/UX DESIGN STRATEGY — FIGMA MAKE SCREENSHOT → PREMIUM PRODUCTION UI


### 4.1 Screenshot-led, no Figma link required

The owner explicitly authorizes the repository screenshot references as the sufficient design input for this task. Every developer action uses this workflow:
1. Open the relevant actual screenshot under docs/assets/figma/exports/admin/screenshots/. Record its filename, visible viewport, content and controls.
2. Study its information hierarchy, overall layout, content placement, table density, color roles, typography, control dimensions, modals and brand styling. Open neighboring screenshots for scrolled and modal states.
3. Compare with existing ElectroHub design tokens/components; honor FIGMA.md where documented. If a hypothetical live Design file would differ, do not claim to know it. Do not block implementation waiting for a Figma Design link/MCP selection.
4. Identify what is explicit screenshot fidelity versus what is owner-approved refinement/expansion. Prepare the decision log. Do not copy screenshot placeholder numbers as real values.
5. Implement functional screen using real APIs and shared primitives, not a static HTML imitation.
6. Render real components in existing Storybook, with deterministic fixtures covering states. Launch the real page and capture browser screenshots at matched viewports.
7. Visually compare side by side (and use pixelmatch/image diff when useful), correct unintentional layout differences, and document intentional improvements.
8. Verify real keyboard, focus, dialogs, responsive interactions, motion, async behavior, access control, route transitions and data consistency.
Visual hierarchy contract: preserve screenshots' overall two-column admin shell, blue active navigation, white workspace, table/card/grid organization, modal layout, typography, status badges and primary-action hierarchy. Premium expansion contract: increase refinement via better microspacing, alignment, tasteful typography, useful icons, hover/pressed/focus/disabled states, coherent feedback, responsive transformation and real workflow depth; never change the primary color system or substitute a generic SaaS dashboard look.

### 4.2 Approved brand principles

- Primary #2563EB, primary hover #1D4ED8, accent #06B6D4; primary text #0F172A, secondary #475569, muted #64748B; surface white #FFFFFF, border #E2E8F0. Prefer actual current CSS custom properties rather than repeated hex values.
- Poppins 400/500/600/700 for UI, JetBrains Mono for dense data where appropriate. Existing 4px spacing scale; established button/control, radius and shadow roles. Blue focus ring with appropriate offset and contrast.
- SCSS Modules and existing design tokens. No Tailwind, Bootstrap, shadcn-generated UI, MUI or competing component library. Reuse Radix for dialogs, menus, selects, tabs and tooltips.
- Consistent semantic status palette: success/green, warning/amber, error/red, neutral/gray, info/blue, with labels and icons (not color alone). Avoid overfilled noisy cards, excessive gradient backgrounds and decorative motion.
- Do not implement the floating Customer / Admin / Flows / Components screenshot switcher as product navigation. It is a design-preview artifact, not part of the admin application's functional IA.

### 4.3 Fully expanded UI interaction contract

Every page must include the relevant elements below, not just the screenshot's static happy path:
- Distinct first load, background refresh, pending mutation, stale-data/error, partial failure, empty list, zero search results, not-found/unauthorized, conflict, success and destructive confirmation states.
- Intentional skeletons matching component geometry; no fake data flash; no indefinite spinner or fake delay. Preserve usable stale data during failed background refresh with a clear retry.
- Search debounce where beneficial, immediate clear/reset, URL query persistence where meaningful, truthful counts, stable sort and server-side pagination, filter chips/controls and keyboard usable tables.
- Modal and drawer focus trap, Escape close, focus restoration, scroll locking, accessible labels/descriptions, screen-reader alerts, no accidental Enter destructive submit. Use polite live announcements and avoid announcing every realtime tick.
- Forms with labels, descriptions, example formats, inline Zod/reactive validation, server error mapping, dirty/unsaved state, save progress, retry, double-submit protection, explicit destructive action; do not silently discard unsaved edits on navigation.
- Menus with coherent item grouping; popovers close correctly on Escape/outside click and restore focus. No nonfunctional icons or ghost actions.
- Transitions ~100–250ms where appropriate and consistent with current design; honor prefers-reduced-motion. Avoid animating large tables on every query refresh.
- Responsive layouts transform: mobile sidebar becomes drawer, tables reflow/scroll with clear affordances, multi-column forms become one column, action buttons remain reachable above fixed/sticky overlays, dialogs fit viewport and keyboard. Do not depend on hover.
- Clear permission boundaries: disabled action with reason, not misleading visible active control when backend denies. Use optimistic UI only for safely reversible edits; do not optimistically declare financial or fulfillment success.

### 4.4 Required Storybook + Playwright pipeline

Storybook is already installed. Reuse actual apps/frontend/.storybook/ configuration and docs/08_Quality/STORYBOOK.md, existing storybook and build-storybook scripts, accessibility addon, story providers and isolated QueryClient. Never create an unrelated preview app if stories can do the job.
Actual Figma Make screenshot
   → screenshot inventory and baseline composition
   → real reusable component (not a duplicate demo-only implementation)
   → existing Storybook story: loading / empty / populated / error / dialog / mobile / keyboard
   → Playwright screenshot at reference viewport (1920 where reference approximately matches)
   → inspect overlay/difference + document intentional premium deviations
   → integrate in real parent page with actual API / route
   → Playwright real browser on localhost exact viewport / live DOM / keyboard and responsive QA
   → architect milestone evidence and acceptance
Required viewports: 390, 768, 1440, 1920 CSS px (use screenshot frame's actual dimensions if different; document browser device scale and actual viewport). Also test 200% browser zoom for critical dialogs, navigation and data tables where risk justifies. Use browser MCP or Playwright Chromium; screenshot-only tests cannot prove functional UX. Compare semantic focus/navigation manually and through keyboard automation; Storybook a11y is supplemental to real WCAG audits and manual verification. Use deterministic fixture data in stories, never connect to real Stripe/Supabase PROD or expose real customer data in snapshots.

### 4.5 Screenshot inventory → page mapping (M0 must verify actual file names)


| Reference image content | 05.1 target | Required expanded states / interactions |
| --- | --- | --- |
| Dashboard overview + scrolled dashboard | /admin | Real KPIs, recent orders, low stock, activity/deep-links, skeleton/empty/errors; charts only where grounded |
| Products table + scrolled product list | /admin/products | Images, price, SKU, category, status, inventory, search/filter/sort/pagination, edit/media/archive and empty/error |
| Create Product | /admin/products/new | Category, optional brand, name, SKU, price, compare-at, specifications, media workflow, inventory, publish/readiness |
| Edit Product | /admin/products/:productId/edit | Current values, concurrent edit guard, specs/media actions, unsaved changes, archive/status |
| Delete Product modal | in Products flow | Archive/unpublish by default, dependent-record warning, keyboard/focus safe confirmation |
| Categories list | /admin/categories | Search, counts, active/inactive, pagination/sort, safe disable and error states |
| Add Category + Edit Category modals | Categories page | Validated name/slug/description, duplicate handling, cancel/dirty confirmation, focus management |
| Inventory overview + scrolled table | /admin/inventory | Stock KPIs, filters, inline/dialog adjust, restock reason, concurrency conflicts |
| Orders listing | /admin/orders | Search, status/payment filter, sorting/pagination, payment badge separate from fulfillment |
| Order Details + lower scrolled section | /admin/orders/:orderReference | Truthful customer/order item snapshot, payment display, guarded actions, delivery link, invoices if already supported |
| Delivery listing | /admin/deliveries | Existing list integrated into shell and responsive model; active status/ETA, deep-links |
| Customers listing | /admin/customers | Protected list, active state, order counts, authorized details, search/pagination |
| Consistent header and sidebar in all shots | AdminLayout | Actual collapse/drawer, active routes, role/profile/logout, notifications, breadcrumbs |



Reference label values (product names, dates, dollar amounts, customer counts, categories) are visual fixtures only. Live UI must use actual backend data and proper empty states.

## 5. DELIVERY PLAN — TEN REVIEWABLE MILESTONES, ONE COHERENT TASK

Execution order: M0 (discovery) → M1 (shell) → M2 (products) → M3 (categories) → M4 (inventory) → M5 (orders) → M6 (customers) → M7 (delivery integration) → M8 (dashboard) → M9 (full visual/integration closure). Small refactoring to support a dependent milestone may occur earlier, but every scope change must be logged and reviewed. Complete all milestones in 05.1; do not ship a collection of unrelated partial pages.

Milestone handoff template, required each time: implemented functionality; exact changed files; reuse versus new code; API contracts; schema/migration effects; security checks; tests and real browser QA; screenshot comparisons; material risks; score/100; requested Architect verdict. Do not block progress for repetitive proof already accepted on unchanged code.

### M0 — Repository discovery, implementation inventory and contracts

Purpose: establish truthful current state and prevent code duplication or architectural regressions.

Frontend work: enumerate actual routes and protected branches; inspect AuthProvider, query key conventions, existing admin shell/login, admin media products, delivery pages, shared components, Storybook stories and visual specs. Identify which screenshots match existing components and which are only aspirational. Inventory responsive/style tokens and route lazy-loading behavior.

Backend work: identify current admin routes, exact role middleware, service/repository boundaries, product/category public read APIs, inventory service, payment/order lifecycle, customer account security, media and delivery. Catalogue all existing validators, API envelopes, error codes, idempotency and transaction patterns. Confirm how product availability is projected to storefront/search/AI.

Database work: inspect actual Prisma model fields and migrations; read relevant applied ledgers only on authorized targets; map product/order/media/delivery foreign keys and restrictive deletion policies, indexes, Decimal precision and operational status enums. Record each proposed migration as either not needed or justified by a concrete invariant; never infer current PROD schema from the local model alone.

Deliverable: docs/tasks/Phase-05/TASK_05.1_IMPLEMENTATION_PLAN.md (or repository-equivalent evidence location) with reuse matrix, routes/API contract table, test coverage map, Figma frame inventory, scoped migration plan and sequential commits. A task evidence file is a plan, not a claim of passing tests.

Acceptance M0: separate frontend/backend/database baseline; screenshots inventoried; 05.2 exclusions agreed; no accidental edits or branch loss; no fake endpoint inventory; safe testing environments and real npm commands established.

### M1 — Premium admin shell, header, sidebar, navigation and identity

Frontend
1. Replace simplistic AdminLayout navigation with responsive one-source-of-truth navigation config (route, icon, label, permission, active route matching). Sections: Main (Dashboard, Products, Categories, Inventory), Operations (Orders, Delivery, Customers). Display Reporting/Settings only if they link to actual available 05.2 routes; otherwise omit or show non-clickable future labels clearly, not inert links.
2. Desktop sidebar: branded header/logo, optional collapse toggle, expanded width and compact icon rail, persistent active indicator, accurate icon labels/tooltips in collapsed mode, responsive content resizing, smooth height/width transitions; optional local persistence of collapse preference with safe default. No forced scroll jump or focus loss.
3. Mobile/tablet: drawer toggle in header, backdrop, Escape/outside-click closing, focus trap/restore, body scroll lock, reduced-motion transitions, close on navigation, sensible tablet layout. Do not leave content hidden behind sidebar.
4. Header: admin brand context, accessible local/global search scope (if real), genuine notification bell/popover, authenticated profile menu with initials/avatar, name/role and working logout. If profile route is not yet offered, use non-navigating identity label rather than dead action. Clear focus and Escape behavior.
5. Breadcrumbs: routes that reflect hierarchy and link to real parent list; long names truncate without hiding the actual accessible label. For product/order/detail breadcrumb trail preserve deep-link and refresh behavior.
6. Protect each route with existing ADMIN role boundary; show initialization/loading state without admin-data flash; redirect unauthenticated user to /admin/login preserving safe return path where existing auth permits. Account switch/logout must clear private admin cache and socket listeners as applicable.
7. Responsive page container, page title/action row, section rhythm, footer/scroll behavior, status chips, toast portal, skeleton and error patterns. Avoid reproducing the screenshot's floating prototype switcher.
Backend / auth
Reuse existing auth, role verification, session refresh and logout. If a /api/.../me endpoint already exists, use it; otherwise add minimal authorized identity projection only with evidence that client cannot obtain it. Notification surface may read existing operational aggregates (low stock etc.), but no notifications table is presumed. A non-ADMIN cannot access any 05.1 route's backend data.
Database
No schema change expected. Do not add settings, MFA, invitation or notification-event tables. Collapse preference is a harmless client UI preference, not security context.
Required Storybook / visual states
Expanded/collapsed desktop, active section, focus outline, small-screen drawer open/closed, header search (if functional), empty/loading/error notification, profile menu, no-role/expired session, keyboard accessibility.

Acceptance M1: navigation to every implemented module works; menu/shell keyboard and focus correct at 390/768/1440/1920 and 200% zoom; no overlay/horizontal overflow; logout succeeds and clears sensitive state; no nonexistent clickable links or fake alert counts; admin-only route/API checks pass.

### M2 — Complete product management (catalog + specifications + existing media)

Business scope
Admin can list/search/filter/sort products; create; inspect/edit; assign active category/optional brand; manage SKU/slug, name/description/model, price/compare-at; edit ordered product specifications; set visibility/status; attach and manage approved images; manage initial inventory/stock; archive/reactivate safely. Advanced recommendation controls are not 05.1.
Frontend: list
- /admin/products evolves from media-only list into the full product table from Figma (thumb, name/SKU, category, price, stock, status, row actions). Preserve direct access to /admin/products/:productId/media and all existing 04.3 behaviors.
- Search by name/SKU; filter by category/status/availability, whitelist sorting; server pagination (page size constrained); loading skeleton and stale-data handling; row action menu or clear Edit / Media / Archive actions.
- Use real primary image with alt/fallback; show unavailable/retiring media state honestly. No misleading sample stock/status or invented total records.
- Empty catalog, no search results, backend 403/409/500 and retry, no primary image, inactive category, out-of-stock and very long names all covered.
Frontend: create/edit forms
- /admin/products/new; /admin/products/:productId/edit (or existing routing convention); reusable form composition with sections: Basics (name, SKU, slug, optional brand/model, category), Pricing (positive Decimal-compatible amount in the supported catalog currency (USD only if confirmed by the current contract), optional compare-at, explicit validation), Availability (active/unpublished and storefront visibility), Specifications (repeatable group/name/value, reorder, remove), Images (existing media editor and upload readiness), Inventory (initial on-hand quantity/threshold or linked stock update).
- Show inline validation, required marker, server uniqueness errors, unsaved-changes navigation guard, initial placeholder/error states, saving progress, optimistic concurrency conflict feedback, cancel/back, saved action toast and accurate result page.
- Image upload must use existing Task 04.3 media APIs and safe file policy (MIME, size, dimensions, provider, immutable storage, asset status). Creating a product must not require faking publication of pending media; support coherent draft/disabled state if necessary.
- Specifications editor supports 0, 1 and many items, preserves order, accessible add/remove/reorder buttons and validation constraints verified from the current schema and validators. Avoid arbitrary JSON input exposed to admin.
- Delete confirmation follows Figma visual intent but defaults to archive/unpublish; explain effect on storefront, cart, recommendations and inventory. Hard delete only if explicitly safe (no linked order/history and approved service rules).
Backend
- Reuse catalog media and product read services; add ADMIN CRUD services/controllers/validators only for missing capabilities. Enforce role on every read and write; constrain payload shape; validate unique normalized SKU/slug and category/brand existence; enforce price bounds, compare-at logical conditions, status/visibility invariants and specification limits.
- Product create must transactionally establish relational product metadata and valid inventory record/status (if product is purchasable). Distinguish media linking/primary-publish post-creation via the existing media workflow, rather than crossing external file operations inside a long DB transaction.
- Product update should reconcile editable fields and specifications without destroying immutable order item snapshots. Prevent stale overwrites (compare updatedAt / optimistic version policy, or equivalent). Handle active checkout/cart consumers safely. isTestFixture and internal QA markers must not be user-editable normal catalog form fields.
- Media delete/reorder/primary operations use existing 04.3 behavior. A product archive must not automatically purge stored blobs or AI media rows without approved retention policy.
- Product deletion and category reassignment must protect referential constraints, payment attempts and past order records; use explicit conflict responses and helpful UI explanations.
Database
Reuse Product, ProductSpecification, ProductImage, Brand, Category, Inventory and existing indexes/uniques. Verify slug and SKU canonical generation, optimistic concurrency feasibility, all relations/cascade effects. Do not add another stock field on Product. Any migration must be explicitly justified and independently reviewed.
Critical tests / visual evidence
Creation validation and duplicate SKU/slug; category inactive; optional brand invalid; media pending/failure; no specs/many specs; archives with OrderItem; price range/Decimal formatting; stock and media consistency; unauthorized customer blocked; parallel edits conflict; search/filter/sort/pagination; Figma list/create/edit/delete modal vs real Storybook and real route screenshots.

Acceptance M2: create/edit/archive/reactivate persist through real API; customer product reads and historical orders remain consistent; approved 04.3 media workflow unaffected; responsive/keyboard/visual QA passes; failures recover cleanly.

### M3 — Category management

Frontend
- /admin/categories list with name, slug, assigned product count, status, description preview, actions, search, active/inactive filters, sorting and pagination.
- Add/Edit Category Radix dialog, closely reflecting screenshot content and dimensions (name/optional description), but with real slug preview/edit policy where needed, validated errors, close/cancel, dirty confirmation, Enter/Escape/focus return.
- Delete action must be labelled according to actual behavior: Deactivate / Archive when products reference category; optional hard delete for unreferenced category only after explicit dependency-safe confirmation. Never silently delete category-linked products or break catalog.
- Activated/deactivated category and dependent product visibility must update accurately in product form/category selectors, product list, catalog and search.
- Proper no-categories/empty search, duplicate, inactive, dependency-conflict, loading and retry states.
Backend
- ADMIN category list may include product counts via bounded database projection, not one query per row.
- Validate length, normalized case behavior, slug collisions, allowed fields, updates and status. Document whether slug can change once published; if so, preserve existing links/SEO via approved redirect mechanism or explicitly restrict changes.
- Return 409 on duplicate or invalid relationship transitions, and prevent permanent deletion when referential constraints prohibit it. Category activation must not make unsafe products purchasable without inventory/status validation.
Database
Use existing Category.isActive, unique name/slug and Product.categoryId. No hierarchy or new categories schema unless a concrete new requirement is approved. Category count query should use efficient grouped aggregate.

Acceptance M3: category list/add/edit/deactivate work, duplicate and product-relation cases safe, customer catalog remains coherent, keyboard/modal and responsive Storybook/browser evidence captured.

### M4 — Inventory operations, stock control and alerts

Frontend
- /admin/inventory: Figma-inspired KPI summary In Stock, Low Stock, Out of Stock with real counts; search by product/SKU; filters (All/In Stock/Low/Out); table image/name/category/SKU/quantity/status/last updated/actions; reliable server pagination and sorting.
- Stock action: accessible Adjust Stock UI (inline with explicit Save/Cancel or focused dialog) with current quantity, adjustment type Restock (+) / Correction (set absolute) (and controlled decrease where permitted), amount, current versus projected quantity, optional/required reason according to audit policy, confirmation and pending state. Inline input must not imply persistence until Save succeeds.
- Protect against invalid/negative/excessive counts, stale concurrent updates and duplicate submission. Low-stock threshold edit only if supported; show derived availability/visibility and threshold messaging. Support zero stock, null inventory (unavailable), inactive product/category, test fixture and long datasets.
- Low-stock warnings/alerts deep-link to specific inventory rows; dashboard count revalidation after adjustment.
Backend
- Reuse InventoryService and existing transaction locking. Add ADMIN listing/adjustment endpoints using bounded queries, strict Zod, actor authorization and expected-current quantity/version for optimistic concurrency. Never implement naive read-modify-write without a transactional guard.
- Derive stock status with existing deriveStockStatus, quantity and lowStockAt; handle product/category active state independently from physical stock.
- Verify checkout reservation/commit and refund compensation use the same row-lock semantics. Retrying a submission must not accidentally double-restock; choose idempotency key or conflict-safe deduplication as warranted.
- If operational audit is required, use existing security/operation logging where appropriate or introduce only a small, reviewed InventoryAdjustment ledger with actor, product, delta, old/new, reason, timestamp and idempotency correlation; keep it separate from 05.2 general analytics.
- For bulk restocking import/selection, defer to 05.2 unless demanded by an existing core workflow; do not add multi-row destructive bulk actions in 05.1.
Database
Use Inventory.quantity, lowStockAt, status, updatedAt, unique productId; preserve schema check constraints, checkout row locking and indexes. Migration only for a specifically accepted audit/invariant need.

Acceptance M4: restock/set/correct persist and update storefront availability; no negative/duplicate/lost updates under concurrency; low/out status/counts accurate; authorization and error feedback correct; screenshot and keyboard/mobile evidence pass.

### M5 — Order management, payment visibility and shipment handoff

Frontend: orders
- /admin/orders: Figma-aligned orders table (order reference, customer, order date, item quantity, total and currency, canonical fulfillment status, separate payment badge, actions). Search by exact order ref or authorized customer identity; filter by status and payment status, date period when supported; constrained server-side pagination, deterministic sort and URL-backed filters.
- /admin/orders/:orderReference: full deep-linkable details. Summary: immutable order reference, created date, delivery method, estimated window, subtotal/shipping/total; customer shipping identity/address only for authorized admin; all historical line items with quantity, snapshot name/SKU/image/unit price/line total; payment status and safe sanitized payment reference/date/amount; download existing authorized invoice/receipt if existing APIs support it; existing delivery detail link/track reference and event status.
- Actions panel: only state-machine-valid actions, with clear confirmation and explanation. Do not reproduce screenshot's generic “Mark as Shipped” if canonical enum has no SHIPPED. Display user-facing “In transit” for OUT_FOR_DELIVERY when appropriate; map to the existing canonical enum. Distinguish AWAITING_CAPTURE, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED; no invented PENDING/`PROCESSING` persisted status without verified mapping.
- Allow legitimate fulfillment progression without creating separate state management from DeliveryService. Show why an order with failed/unconfirmed payment, cancelled state, unknown payment state or already delivered state cannot transition.
- Clearly distinguish payment status vs order status vs delivery status. No Mark as Paid action, no field to edit PaymentIntent, provider reference, amount or customer order history.
- Handle loading, missing/forbidden order, stale status, revision/concurrency conflicts, stock/payment incident, retry, long shipping addresses, large item counts and narrow screens. Ensure safe redirect and refresh with no cross-customer cached data.
Backend
- Reuse existing order customer projection, payment status logic, DeliveryService and domain invariants. Add ADMIN list/detail projections in existing order service/route organization; no duplicated fulfillment state machine. Use indexed queries and bounded search; select only required PII.
- Admin transitions must validate allowed next state and payment eligibility, enforce transactional status/order-delivery consistency and monotonic revision/event history. Prefer using existing delivery update/start workflows where they already own the transition. No direct Prisma status flip outside approved service.
- Payment read projection must expose only minimal method type/card brand+last4 if already authorized and stored, status/amount/currency/timestamps and masked provider ID where needed; never secrets, raw payment method, tokens, signed webhook payload or internal recovery controls.
- Cancellation/refund/payment-recovery and invoice generation are not implicitly added by screenshot buttons. If existing supported APIs are present, wire only their authorized state-safe workflows; do not create a new financial cancellation flow. Disable or omit unsupported actions with an explicit explanation.
- ADMIN list is privilege-scoped; normal CUSTOMER cannot use it or access another customer's order. OrderItem snapshot remains immutable after product editing/archive.
Database
Reuse Order/OrderItem/Payment/PaymentAttempt/Delivery and current indexes; no duplicate shipment schema. Any supporting index for demonstrated slow admin queries needs measured plan and migration review. No mutable order line rewrite.

Acceptance M5: correct list, detail and payment facts from real seeded/authorized records; valid transitions via canonical service; forbidden transitions and customer role denied; cross-module delivery link works; no financial mutation; keyboard/responsive Figma screenshot comparison complete.

### M6 — Customer/user management with privacy and safe active state

Frontend
- /admin/customers: Figma-inspired table with avatar/initials, display name, masked email as appropriate, order count, total amount spent (if reliably defined), active status, join date, latest order and View action; search by name/email (bounded), active/inactive filters, stable sorting/pagination.
- /admin/customers/:userId: authorized detail with account status, verified email state, customer-only history navigation, recent orders, addresses only when operationally necessary, and safe controls that have existing support. Do not show full sensitive tokens/auth provider data or raw addresses unnecessarily.
- KPI cards (total/active customers, optional total revenue) derive from authoritative definitions and must be reconciled; do not copy screenshot's count 10, active 9 or dollar revenue value.
- If account deactivation is supported, require confirmation, protected self-deactivation behavior, security event, predictable effect on sessions/refresh tokens, and clear impact on existing orders. No ambiguous "Delete customer" without retention/delete-contract analysis.
- Customer details and list must not expose ADMIN identities as normal customers or allow arbitrary ADMIN role elevation, privilege reassignment or password reset impersonation.
Backend
- Build protected, paginated account list/detail using explicit allowlisted user fields and account type/role predicate. Query count/lastOrder/aggregate spends in bounded grouped queries; no N+1. Determine spent definition: successful paid order totals minus verified refunds if policy requires net revenue, with correct currency handling, or label as paid gross if that is what the data reliably supplies. No summing pending/cancelled transactions into revenue.
- If isActive mutation is in-scope, implement a guarded ADMIN service with transaction/revocation policy consistent with current auth, prevent self-lockout and protected-owner removal, audit with sanitized event facts, avoid invalidating current admin sessions incorrectly. If existing auth cannot safely support that operation, limit 05.1 to read-only + status visibility and record the specific missing policy for Architect decision before claiming full active-state management.
- Authorization: every CUSTOMER-related admin API is role guarded and avoids returning password hash, pending email secret, refresh token hash, OTP values, private security events or full payment provider details.
Database
Reuse User.isActive, UserRole, Order, Payment, SecurityEvent, RefreshToken; add indexes only for measured query need. No AdminInvitation, MFA factors, login-history tables, passkey entities or role expansion in 05.1.

Acceptance M6: accurate pagination/search/status/order metrics; unauthorized roles denied; any enabled deactivation action has tested session semantics; safe privacy projection; responsive table/detail; working View links and no misleading fake revenue.

### M7 — Integrate approved Delivery Management (04.5, 04.6, 04.7)

Frontend
- Continue existing /admin/deliveries, /admin/deliveries/:orderReference pages and features/delivery logic. Preserve existing page state, revision-aware reconciliation, status progression, ETA/location confirmation, Leaflet/OpenStreetMap map, map fallback, Socket.IO connection status and event history.
- Fit approved delivery screens into M1 shell: nav active states, breadcrumbs, cross-links from order details, responsive table and customer preview. Improve shared headings/actions/style where appropriate without changing approved delivery backend semantics.
- Admin deliveries list must support meaningful search/filters/pagination/status labels and accurate active/simulated state, if not already present. A "Track" action should lead to the correct existing detail route; avoid creating a duplicate delivery management interface.
- Realtime courier location/display, simulated provenance (“Simulated demo”), freshness warnings, map path versus marker semantics and simulation Start/Stop remain as approved. On shared DEV, any enabled simulation must respect the latest integrated opt-in/security policy; do not broaden production simulation as part of 05.1.
- Ensure Delivery can be reached from Orders; and return links/breadcrumbs work. Customer tracking links remain customer-only and ownership-protected.
Backend
- Reuse DeliveryService, controllers/routes, simulation runner and Socket.IO publisher. If 05.1 order-management action triggers a delivery update, call the canonical service rather than new direct writes.
- Maintain revision locks, event ordering, no negative/stale writes, payment eligibility, foreign/unknown order 404 equivalence for customers, Admin-only mutation. Browser refresh and two-session authorization must remain correct.
- No new courier dispatch, driver assignment or road-routing engine is required; assign delivery status refers to the existing delivery state, not building a workforce management module without supporting models.
Database
Use existing Delivery and DeliveryEvent, immutable history and version ordering. Do not add redundant Shipment or Courier tables, nor execute delivery migration again if already applied. Confirm Order.status consistency and data integrity.

Acceptance M7: previous accepted 04.5–04.7 behavior remains, route integration and admin shell polished, no new auth/transaction regression, status/location/ETA and simulated provenance preserve behavior, Figma delivery-list comparison and key browser smoke pass. No broad re-run of the 26-case acceptance campaign without a concrete regression trigger.

### M8 — Dashboard overview: operational KPIs, live records and meaningful quick actions

Frontend
- /admin becomes the actual Dashboard from Figma (not a placeholder). Desktop composition: title/secondary context, KPI grid, sales/orders summary area, recent orders, low-stock alert, active delivery signal, direct links to Orders/Inventory/Delivery. Mobile: stacked KPI cards, condensed list/carousel as appropriate and accessible quick actions.
- KPI candidates (grounded, with exact definitions): successfully paid gross revenue for a defined time window/currency, count of orders by canonical state, active orders, active deliveries, published products, customers, low-stock/out-of-stock inventory. Display periods and timestamp “Updated ...”; no decorative percentages without real previous-period computation and denominator semantics.
- Figma's sample revenue $48,230, order count 1,284, customers 9,871, colored monthly percentages and sparkline bars are illustrative only. Use actual aggregates and documented timezone/currency rules, or show a truthful zero/empty/insufficient-data state. If enough real data exists, a bounded recent-series chart is acceptable; 05.2 owns full analytics/reporting product.
- Recent orders table displays canonical order status and independent payment status, currency, order date and customer summary only to authorized admin. Clicking opens M5 detail; low-stock alert opens M4 filtered view; active deliveries open M7 list.
- Background refresh must not cause layout jump, reset search/navigation, duplicate event processing or full-page blocking. Use React Query with sane stale time and invalidation after related admin mutations; optional websocket operational refresh only if safe and existing channels support it.
- Provide first load skeleton, no data, partial KPI failure with per-section retry, mixed currencies, unknown paid revenue, empty recent orders, low-stock zero and slow-DB timeout states.
Backend
- Define bounded read-only operational overview endpoint(s), ADMIN-only. Batch aggregate queries to avoid full-table fetch/N+1; use Prisma.Decimal correctly, count distinct orders versus sum quantities as labelled; validate time window and timezone if parameters exist.
- Decide revenue semantics based on verified payments only; no pending/failed payment into revenue. If refunds are represented, specify gross vs net clearly and do not double-count. If currencies vary, group by currency rather than summing incompatible units.
- Use existing indexed columns (createdAt, status, userId, payment state, inventory status); measure query plan only for materially slow datasets; add index if justified.
Database
No AnalyticsEvent, generic event bus, precomputed dashboard warehouse or offline conversion funnel. Query canonical Order, Payment, Product, Inventory, User and Delivery tables. Minimal read optimizations only.

Acceptance M8: numbers reconcile against database sample of QA-owned data; dates/currency/paid revenue correct; no fabricated metrics; quick links and filters work; responsive screenshot comparison; backend performance bounded; auth and loading/error behavior pass.

### M9 — Final visual, functional, accessibility, security and integration acceptance

Scope: close 05.1 as one production-quality handoff, using all M1–M8 features integrated together.
Visual acceptance
- One reference-to-live screenshot pair per Figma target page/state, including list, create, edit, delete/disable confirmation, inventory, orders details (scrolled), delivery, customers and dashboard (scrolled).
- Component-level Storybook stories for button/input/badge/table/dialog/sidebar/header/breadcrumbs/pagination/search/filter/stock adjustment/product form/order action and representative error/loading/empty combinations; reuse original components, not look-alike mock code.
- Browser at the matched screenshot dimensions, plus 390, 768, 1440, 1920, no unintended horizontal overflow, trapped scrolling, clipped modal, unreachable bottom action, broken sticky header/side nav, or overlay interference.
- Visually compare real DOM against Figma screenshot: structural alignment, color/token fidelity, text hierarchy, gaps, card/table/modal geometry, images, focus/hover/disabled, meaningful discrepancies. Record deliberate premium expansions and reasons; don't demand numeric pixel equality when responsive/data differences are intentional.
Functional acceptance
- Run full ADMIN navigation from login → Dashboard → Products → Categories → Inventory → Orders → Customers → Deliveries; explicit API and database correctness for each mutation.
- Valid/invalid forms, duplicates, concurrency/revision, unauthorized customer, inactive users/categories/products, missing relationships, empty lists, network errors, large results, keyboard navigation, tab order, Escape/focus restoration, reduced motion and announcements.
- Cross-module consistency: product archived → customer storefront/search/wishlist behavior, inventory restocked → stock availability and dashboard, order status → customer order and delivery history, category disabled → product visibility, account active status → auth policy.
- Verify real image upload using approved DEV fixture or isolated store, no orphan object or broken media pipeline; avoid live external side effects in disposable tests.
Non-functional acceptance
- Backend role middleware + validation, safe DB transaction locks, bounded queries and no material N+1, cache/session privacy, secrets/PII protection, safe rate limits, no unauthorized production writes.
- Affected Vitest frontend/backend tests, Supertest/API, disposable PostgreSQL integration, Playwright UI/browser, Storybook accessibility/visual smoke, builds, typechecks and lint pass.
- Final git diff --check, scoped staged diff review, docs/migrations/rollback, CI on actual feature head, residual risks and evidence manifest.
Acceptance M9: all material M0–M8 requirements verified; no critical/high unresolved in-scope defect; QA evidence sufficient and repeatable; final Principal Architect decision ✅ Approve / ⚠ Request Changes / ❌ Reject with score/100. All test/report claims distinguish mock/story/disposable/authorized DEV/PROD (no PROD tests by default).

## 6. PROPOSED ADMIN ROUTES AND NAVIGATION CONTRACT

These are TARGET ROUTES, not a claim they currently exist. During M0, preserve existing exact paths unless change is justified; add aliases/redirects only when needed. All /admin/* pages except /admin/login are protected with existing ADMIN authorization.

| UI route | Purpose | Data requirements | Owning milestone |
| --- | --- | --- | --- |
| /admin/login | Existing secure admin login; reused | Auth/session and ADMIN role | M1 (preserve) |
| /admin | Dashboard overview | KPI/alerts/recent orders | M8 |
| /admin/products | Product listing + actions | Product/availability/media summaries | M2 |
| /admin/products/new | Create product | Category/brand options, schema rules | M2 |
| /admin/products/:productId/edit | Edit product | Product/specs/inventory/media readiness | M2 |
| /admin/products/:productId/media | Existing 04.3 media UI | Approved product-media pipeline | M2 reuse |
| /admin/categories | Category list + add/edit modal | Category counts/status | M3 |
| /admin/inventory | Inventory list + adjustment | Stock status/quantity/threshold | M4 |
| /admin/orders | Order listing | Fulfillment, payment, totals | M5 |
| /admin/orders/:orderReference | Order detail/actions | Historical line snapshots, payment, delivery | M5 |
| /admin/customers | Customer list | Sanitized users/counts/aggregates | M6 |
| /admin/customers/:userId | Authorized customer detail | Account, limited orders, safe status | M6 |
| /admin/deliveries | Existing approved list | Delivery status/pagination | M7 reuse |
| /admin/deliveries/:orderReference | Existing approved detail | Revisioned updates, location, ETA and events | M7 reuse |



Information architecture: Dashboard, Products, Categories, Inventory under Main; Orders, Delivery, Customers under Operations. Avoid promising a working Analytics or Settings route before 05.2. Preserve deep links and refresh, and use explicit not-found for unknown admin subpaths.

## 7. PROPOSED EXPRESS ADMIN API CONTRACTS (FINALIZE IN M0)

Names below are illustrative consistent REST targets. Reuse existing routes where present; the backend reviewer must finalize exact prefixes, request/response DTOs, validation and error codes before adding handlers. Do not duplicate public APIs with extra unguarded write routes. All admin APIs require authoritative ADMIN role checks.

### 7.1 API matrix


| Intent | Proposed HTTP route | Data/behavior and guard |
| --- | --- | --- |
| Product list | GET /api/admin/products | q, category/status/stock filters, sort/page/pageSize; bounded data + meta |
| Product detail | GET /api/admin/products/:productId | Catalog fields + specs + images metadata + inventory projection |
| Product create | POST /api/admin/products | Strict validated product, initial inventory; transactional, unique constraints |
| Product patch | PATCH /api/admin/products/:productId | Allowed editable subset + optimistic concurrency, no fixture flags |
| Product archive/status | PATCH /api/admin/products/:productId/status | Active/unpublish with dependent-product and history-safe policy |
| Product media | Reuse existing Task 04.3 admin product-media APIs | Authenticated upload/status/primary/order/delete via approved lifecycle |
| Category list | GET /api/admin/categories | Search, active, sort, product counts, bounded pagination |
| Category create | POST /api/admin/categories | Unique name/slug, description, initial active state |
| Category update | PATCH /api/admin/categories/:categoryId | Strict allowed edits; collision/dependency checks |
| Category deactivate | PATCH /api/admin/categories/:categoryId/status | Safe deactivate/reactivate, relationship consistency |
| Inventory list | GET /api/admin/inventory | Search, status, page/sort, threshold/product summaries |
| Inventory adjust | POST /api/admin/inventory/:productId/adjustments | operation, quantity/delta, optional reason, expected state/idempotency; atomic |
| Inventory threshold | PATCH /api/admin/inventory/:productId | Validated threshold/status semantics if offered |
| Order list | GET /api/admin/orders | Search, status/payment filters, date, bounded page/metadata |
| Order detail | GET /api/admin/orders/:orderReference | Read-only historical snapshots/payment/delivery summary |
| Order fulfillment | POST /api/admin/orders/:orderReference/transitions | Allowed next step; delegate existing canonical order/delivery service |
| Customers list | GET /api/admin/customers | Customer-only list, projection, aggregated counts |
| Customer detail | GET /api/admin/customers/:userId | Role-scoped personal summary + bounded related orders |
| Customer active | PATCH /api/admin/customers/:userId/status | Only if session/safety/audit semantics approved in M6 |
| Dashboard overview | GET /api/admin/dashboard/overview | Canonical bounded KPIs/recent records, currency/period definitions |
| Delivery list/detail/mutations | Reuse existing /api/admin/deliveries and /api/admin/orders/:orderReference/delivery | No parallel state machine |
| Simulation | Reuse existing /api/admin/orders/:orderReference/delivery/simulation | Current integrated DEV/PROD policy untouched |
| Admin identity | Existing auth/session/me endpoint | Use only minimal necessary identity projection |



Never expose a generic PUT /api/admin/data or raw Prisma filter endpoint. Minimize backend changes to existing shipped systems.

### 7.2 Example API envelope

```json
{
  "data": [
    { "id": "<product-uuid>", "name": "Example item", "sku": "SKU-EXAMPLE", "status": "ACTIVE", "stockStatus": "LOW_STOCK" }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```
This is a contract shape example, not a fixture representing a real customer or the currently deployed API. Use existing types for money/stock/media and explicit DTO projections; do not serialize raw Prisma models containing private fields.

### 7.3 Validation and error matrix


| Case | Expected behavior |
| --- | --- |
| No login / expired session | 401 and safe admin login flow; clear scoped query cache |
| Customer hits admin API | 403; no partial data exposed |
| Unknown product/order/category/customer | 404, no sensitive leakage |
| Invalid price/quantity/slug/filter | 400 with safe field/code errors |
| Duplicate SKU/slug/category | 409 or project-standard validated conflict |
| Product/category with dependent history | Archive or explicit dependency conflict; no cascade deletion |
| Concurrent inventory change | 409 with fresh canonical state and retry flow |
| Invalid/terminal fulfillment transition | 409 and allowed-state feedback; no half-mutated delivery |
| Unconfirmed/failed payment | No manual paid override, shipment only if eligible |
| Media invalid type/size/provider failure | 400/413/422/503 as appropriate; no ghost success or orphan |
| API unavailable during refetch | Preserve last good data, stale indicator + retry |
| Too many writes/search abuse | Bounded request/rate-limit policy (429) |



### 7.4 Pagination, currency and search consistency

Document supported sort keys, default sort, filters, max page size and search normalization for every list. Counts are total database rows matching filters, not length of current page; item count is sum of quantities where labelled. Money represented as Decimal-safe strings and currency (rather than unsafe float math), formatted at presentation boundary. Revenue excludes unverified/failed payments and respects refunded transaction policy. Search by personal email must be ADMIN-authorized, rate limited and never leak in public query logs.

## 8. SECURITY THREAT MODEL AND CONSISTENCY REVIEW

### 8.1 Threats and mandatory mitigations


| Threat / failure | Required verification / prevention |
| --- | --- |
| Customer calls admin endpoints | Backend ADMIN role checked per route, including read APIs; tests with anon/customer/admin |
| Role/client impersonation | Identity from verified auth token/session and DB role; reject user-supplied actor/role |
| Cross-account cache leakage | Session-scoped query keys, logout/account-switch cache cleanup, no private stale results displayed |
| Mass assignment | Strict DTO whitelist; never accept roleId, isTestFixture, payment status, delivery revision or internal media state in general edit payload |
| Stored XSS in name/description/specification | Safely render React text; sanitize any rich markup if explicitly supported, avoid dangerouslySetInnerHTML |
| SQL injection / unbounded search | Prisma parameterization, bounded query limits, sort whitelist; no raw interpolated SQL |
| Race: inventory correction vs checkout | Reuse row locks/transaction and test concurrency; no lost updates or negative stock |
| Race: product edit vs order/payment | Preserve historical OrderItem and payment-attempt snapshots, never delete linked records |
| Race: order update vs delivery event | Canonical lifecycle service and revision conflict handling, atomic state changes |
| Unauthorized image upload/retire | ADMIN gate, file limits, storage path ownership and approved 04.3 media workflow |
| Destructive category/product action | Archive/deactivate by default, explicit dependency check, confirmation and audit trail |
| Admin self-deactivation/last-admin lockout | Block or narrowly constrain any sensitive account action; no general role elevation |
| CSRF/CORS/session theft | Retain established cookie/JWT security, no new client-side secret storage; review mutating routes |
| Sensitive data in logs/snapshots | No passwords, tokens, card data, raw secret URLs, private full address/email in published stories |
| Revenue fraud through UI | Payment success read-only; never allow manual Payment.status/amount/provider changes |
| Error leakage | Sanitized code/message, no Prisma stacks, SQL, key material or existence of private resources |
| DEV/PROD mixing | Disposable tests; explicit DEV project verification for any shared smoke; migration gates |



### 8.2 Admin auditability

Every sensitive mutation should be attributable where compatible with current infrastructure: actor user ID, entity ID/type, action, outcome, timestamp, request correlation and safe old/new summary. Avoid storing secret payloads or unbounded diffs. Distinguish an operational audit trail of a stock adjustment or account deactivation (possibly necessary in 05.1) from 05.2 analytics events (deferred). Reuse SecurityEvent for semantically appropriate security actions only; do not overload it for every catalog action without a schema/retention decision.

### 8.3 Authorization tests

At minimum, for every new admin endpoint: assert 401 anonymous, 403 CUSTOMER, 2xx valid ADMIN with correct scope, malformed 400, forbidden mutation/relationship 409, and sanitized unexpected failure. Verify client-side buttons cannot bypass server restrictions by direct HTTP call. Ensure role guard is effective before data fetching and not only at route rendering time. Rate-limit sensitive writes; protect against repeated submission.

### 8.4 Data-retention and privacy

- Keep historical commerce Order/`OrderItem`, payment records and generated invoices intact when products or categories are archived.
- Protect customer personal data (email, address, phone) through least privilege and minimize exposure in aggregate dashboards. Screenshots and Storybook fixtures must use synthetic names/addresses, never real shared-DEV customer PII.
- Do not introduce public admin registration, invitation codes, MFA setup or passkey storage in 05.1.
- Account status changes must respect current deletion/token revocation flows; do not silently delete sessions without policy or fail to revoke when required.

## 9. FULL DESIGN SYSTEM, ACCESSIBILITY AND RESPONSIVE QA SPECIFICATION

### 9.1 Visual fidelity versus permitted premium polish

Source of visual intent: Figma Make PNG/JPG screenshots already committed to docs/assets/figma/exports/admin/screenshots/; do not require a Figma Design link or new export. Inspect all of them and read existing FIGMA.md. The implementation must preserve: blue ElectroHub brand/logo, left navigation with dark-to-bright blue active state, white page canvas, pale gray list/filter/table surfaces, modular cards, table headers, status badges, page title/action alignment, modal dimensions and affordances, typography and icon rhythm.

Allowed refinements (record in design decision log): better whitespace consistency, responsive and mobile adaptation, cohesive button hierarchy, refined category/product dialogs, richer empty/loading/error/retry, accessible labels, status explanations, sophisticated filter/search UX, sticky headings or toolbars when safe, subtle transitions, ergonomic confirmation and progressive disclosure of complex details, polished chart legend/labels with actual backend metrics, operation-specific help/tooltips and high-fidelity thumbnails. Keep main composition/colors/content structure recognizable.

Not allowed without separate design review: replacing page layout with a different design system, large dark-mode theme switch, new brand palette/typeface, generic dashboard template, static screenshot-based mock API, inventing important business capabilities, changing 04.7 semantics, or representing Figma prototype tab switcher as production feature.

### 9.2 State matrix by component family


| Component / screen family | Minimum stories / states |
| --- | --- |
| Admin shell | Expanded/collapsed, mobile drawer open/closed, inactive/active nav, auth loading/expired |
| Header notifications | None, 1 real operational alert, several alerts, failed fetch/retry, keyboard menu |
| Profile menu | Authenticated, unavailable profile destination, logout pending/error/success |
| Breadcrumbs | Root, nested order, long product name, back navigation, keyboard |
| Data table | Populated, 0 rows, 1 row, 20+ rows, empty search, filtering, sorting, pagination, loading, background error |
| Search/filter bar | Typing/debounce, clear, all/active/low-stock, no results, URL/back restored, keyboard |
| Product list | With/without image, media pending, inactive, out-of-stock, low-stock, long names, error |
| Product create/edit | Pristine, invalid, multiple specs, media upload pending/error, save conflict, cancel with dirty changes |
| Product archive | Allowed/blocked dependency, confirmed/cancelled, focus return, optimistic UI prohibition |
| Category modal | Add/edit, duplicate name, inactive, linked products, dirty close |
| Inventory adjustment | No-op, restock, correction, negative/overflow invalid, concurrent conflict, successful adjustment |
| Orders list/detail | No orders, many items, paid/unpaid/refunded, each status, invalid transition, sensitive data masked |
| Customer list/detail | No customers, disabled customer, long email/name, no orders, permission denied |
| Delivery integrated | Active, delivered, stale/no location, source simulated, Socket.IO reconnect/fallback (reuse approved coverage) |
| Dashboard | Zero data, mixed data, partial endpoint failure, unusually large values, empty recent orders, low-stock alert |
| Dialog / drawer | Open, close, Escape, focus trap, long mobile content, reduced motion and 200% zoom |



Storybook examples must use deterministic local mocks, isolated query clients, real component props, and no default external API traffic. No story-only lookalike component accepted; page integration tests must import/compose the same production components.

### 9.3 Keyboard and assistive technology verification

- Sidebar: Tab follows DOM order; expand toggle communicates aria-expanded, collapsed icon links have accessible name, mobile drawer traps and restores focus, current route indicated by aria-current="page" where appropriate.
- Header: profile/notification menus open by Enter/Space, Arrow/Home/End where Radix menu semantics apply, close on Escape/outside, appropriate focus return and no invisible enabled action.
- Breadcrumb: semantic <nav aria-label="Breadcrumb">, correct links, current page aria-current; no tab-stop on decorative separator.
- Tables: native table semantics; sorting has aria-sort, keyboard action menus and pagination, row click does not swallow nested buttons. Avoid forcing grid arrow-key model unless implemented correctly.
- Tabs: Radix tab semantics, roving focus and visible active state; no custom tabs with unhandled keyboard interactions.
- Dialog: labeled title/description, focus trap and restoration, Escape behavior, scrollable content at small viewports, destructive CTA clear and not focused by default for dangerous operations.
- Form: label association, aria-invalid/error description, required/optional meaning, numeric input handling, no keyboard trap, validation errors announced without repeated noise.
- Toast / live region: meaningful success/error feedback, restrained aria-live, no infinite repeated alerts during background polling.
- Motion: prefers-reduced-motion respected; purposeful micro-interactions not necessary to understand the state.
- Accessibility audit: Playwright axe WCAG A/AA where existing tooling supports, Storybook a11y addon, manual keyboard traversal, contrast and zoom review; record exceptions and mitigations.

### 9.4 Responsive matrix


| Viewport | Layout expectations | Essential verification |
| --- | --- | --- |
| 390px mobile | Admin sidebar becomes drawer; single-column forms/cards; tables switch to accessible horizontal scroll or responsive row representation; CTA visible | No document-level horizontal overflow, readable content, modal keyboard, lower actions reachable, no sidebar collision |
| 768px tablet | Collapsed/drawer sidebar as design permits; 1–2 column dashboard; readable filter/search | Breakpoint transition, overlays, page scroll and table actions |
| 1440px desktop | Full sidebar/header, table/card hierarchy, meaningful content width | Alignment with screenshot hierarchy, navigation, table density |
| 1920px large | High-fidelity screenshot composition and spacing | Match reference visual, avoid stretched cards/huge unbounded line lengths |
| 200% real browser page zoom | Components remain operable when CSS viewport changes | No clipped confirmations, inaccessible row actions, lost focus, hidden save button |



Additional viewport checks triggered by wrapping and content density are encouraged; the above four are mandatory. Responsive transformation matters more than visually scaling a 1920px screenshot down.

### 9.5 Visual comparison method and criteria

1. Use original screenshot frame as reference; record its pixel dimensions and visible state.
2. Navigate to actual same route/state using synthetic/disposable fixture; set Chromium viewport to comparable dimensions and disable animations for static capture where appropriate.
3. Capture image and element geometry/DOM diagnostics (bounding rectangles for shell, header, title, table, modal, button); use Playwright snapshot, browser tooling and optional pixelmatch to highlight major differences.
4. Review color, typography, alignment, hierarchy, spacing, card/table placement, modal positioning, visible area, icon treatment, and the expanded actions not present in the original screenshot.
5. Fix accidental mismatches. Where data, responsive behavior or premium additions intentionally diverge, document the reason, final visual and reviewer acceptance.
6. Record manual keyboard/responsive outcomes; a screenshot diff alone does not prove UX functionality.
Do not set a universal arbitrary pixel-error threshold if content/viewport differ; use component-specific tolerance and visual sign-off based on meaningful mismatch. No visual story should freeze personally identifiable production data.

## 10. IMPLEMENTATION TEST STRATEGY — UNIT, API, DATABASE, STORYBOOK, LIVE BROWSER

### 10.1 Existing tooling and commands

This repository already includes Vitest, Testing Library, Playwright and Storybook. Verify current scripts at execution time, then use these root commands as available:

```powershell
# Static analysis and builds (run after code changes)

npm run typecheck:frontend
npm run typecheck:backend
npm run lint:frontend
npm run lint:backend
npm run build:frontend
npm run build:backend

# Focused tests (prefer actual target files instead of every suite after every small change)

npm run test:frontend
npm run test:backend

# Existing Storybook preview and build

npm run storybook --workspace=apps/frontend
npm run build-storybook --workspace=apps/frontend

# Playwright: adapt config and spec names to current repo

cd apps/frontend
npx playwright test -c playwright.config.ts <targeted-spec>
```
Existing specialized Playwright configs may include playwright.cart-storybook.config.ts, playwright.admin-media-live-dev.config.ts and others; inspect actual files and reuse the closest existing project harness rather than inventing a new one. Use docs/08_Quality/STORYBOOK.md and docs/08_Quality/TESTING.md as the executable guidance. Never claim a test was run unless it ran.

### 10.2 API and service test matrix


| Domain | Critical happy-path tests | Security / edge / concurrency tests |
| --- | --- | --- |
| Shell/auth | Existing admin session, me/logout, nav authorization | Guest/customer forbidden, expired session, cache isolation, admin status |
| Products | Create/edit specs/pricing/category/status, media link | Duplicate SKU/slug, invalid category, linked orders archive, edit race, mass assignment, image failure |
| Categories | Create/edit/disable/reactivate, product counts | Unique collision, linked product relation, inactive visibility, non-admin denied |
| Inventory | Restock/set/change, thresholds/stock statuses | Concurrent adjustment vs checkout, negative/overflow, idempotency, missing row, stale quantity |
| Orders | List/detail, allowed transitions, delivery link | Unpaid/failed/terminal disallowed, financial tampering blocked, history immutable, private read denial |
| Customers | List/detail, accurate filtered counts, controlled active status | Non-admin/role modification denied, self/last-admin lockout, safe session revocation and PII |
| Delivery | Existing status/location/ETA flow and link | Revision conflict, customer ownership, simulated provenance, no financial side effects |
| Dashboard | Paid revenue/orders/categories/inventory/active-deliveries queries | Mixed currency, refunded transaction handling, empty/large data, pagination/bounded query, non-admin denied |



Run real database integration in a disposable PostgreSQL instance, applying migration set through the approved test harness. Do not use shared DEV as a substitute for freely mutable test data. Avoid Stripe real payments and Brevo email in 05.1 tests. Only narrowly approved QA smoke may touch shared DEV and must have a before/after integrity manifest.

### 10.3 UI, Storybook and Playwright mapping

For each feature, minimum evidence is: story states rendered and inspected at relevant viewport(s), accessible keyboard behavior, real page at matched screenshot viewport, correct route navigation, one live API happy path, one error/conflict path, mobile/tablet check, and screenshot comparison. Critical forms and purchase/order-affecting operations get actual end-to-end/disposable DB tests, not only mocks. Representative browser workflows:

| Flow | Browser assertion |
| --- | --- |
| Admin login → shell | Correct role gate, navbar, dashboard real content and logout |
| Sidebar navigation/collapse | Main/Operations link works, active state, keyboard and mobile drawer |
| Product create → list → edit → archive | Persistence and customer catalog effect, specs/media linked, no order history loss |
| Category add/edit/deactivate | Product form choices/counters update and storefront category consistency |
| Inventory restock → availability | Updated quantity/status after refresh; customer purchasable changes correctly |
| Two concurrent stock adjustments | Conflict/retry semantics, final persisted count correct |
| Order list → details → valid transition | Canonical order+delivery state, payment stays unchanged, customer sees update |
| Foreign role/admin endpoint | Customer and anonymous API denied, no private leakage |
| Customer list → details | Only authorized fields, counts and links accurate |
| Dashboard KPI → source view | Totals reconcile, cross-links/filters correct, empty/partial failure truthful |
| Delivery list → detail | Previously approved 04.7 flow still works; no extra broad simulation run needed |



### 10.4 Test data and repeatability

- Storybook: synthetic fixed data, no secret/production PII, realistic varied lengths/statuses. Use existing seeded story fixture structure.
- Unit/API: mocked external side effects and disposable DB; explicit assertions on persisted rows for critical mutations.
- DB integration: isolated disposable schema or container; own test users/catalog/orders; no pretending synthetic SUCCEEDED Stripe payments are real provider transactions. When testing admin order reads, fixtures can represent state only if clearly identified as deterministic mock/DB-test state.
- Browser integration: dedicated QA credentials stored outside Git; masked logs, exact API target verification, distinct roles/tabs, no shared session contamination.
- Regression: reuse prior accepted 04.3 and 04.5–04.7 tests. Rerun when touched files or dependency surfaces change, not automatically after cosmetic unrelated work.

### 10.5 Performance budgets and diagnostic quality

- Server-side list cap 50 by default unless repo contract differs; deterministic sort/page. Query aggregation avoids N+1 and unbounded joins; measure with realistic QA row counts and document any necessary indexes.
- Lazy-load admin routes. Images appropriately sized/lazy, avoid huge media in admin table; no unnecessary eager loading of Leaflet on Dashboard.
- Avoid multiple overlapping identical React Query requests, stale cache leaks, refetch storms, or SSE/Socket.IO duplication.
- Capture actual browser console/network failures, hydration/route errors, accessibility audit results, stale retry behavior and memory/connection cleanup when features use listeners.
- A passing Lighthouse score alone does not replace functional QA. Material performance regression requires evidence and focused fix; do not invent arbitrary runtime metrics.

## 11. PRISMA MIGRATIONS, RELEASE AND CI GATES

### 11.1 Before any schema change

Produce a written migration decision containing: exact missing invariant; why current model/service cannot satisfy it; affected tables/constraints; read/write compatibility with old app; row count/backfill need; lock/index impact; rollback/forward-repair; test/DEV/PROD verification sequence; approval boundary. Do not commit a schema mutation based merely on the Figma table having an extra column.

### 11.2 Migration execution sequence (if approved)

1. Create additive Prisma migration from current develop schema with explicit migration name and deterministic SQL; preserve historical migrations/checksums.
2. Apply and exercise on disposable PostgreSQL; test fresh install and upgrade from prior known state, transaction constraints and index performance.
3. Review migration against CI migration-safety rules and production workflow. No db push shortcut to skip history.
4. If authorized shared DEV rollout is necessary, run project-specific reviewed preflight and exact migration approval in approved DEV workflow; do not modify unrelated data.
5. Production migration is not authorized by this 05.1 implementation handoff; use separate release approvals, project identity checks and production migration job. No manual secret copying into PR or logs.

### 11.3 CI and branch discipline

- One feature branch: feature/05.1-admin-dashboard; reuse the existing branch after verifying its develop ancestry and prior 04.7 merged state. Create from current develop only if absent; resolve divergence without silently rebasing shared work.
- Prefer logical milestone commits, e.g., feat(admin): implement accessible shell, feat(admin): complete product operations, feat(admin): add inventory adjustment UI and so forth. No need for artificial commit per individual line.
- Preserve unrelated changes using worktree where appropriate; do not stage ROADMAP.md edits unless explicitly part of approved task documentation refinement; do not blanket git add . with screenshots/secrets.
- Push feature branch and create a PR targeting develop only when milestone deliverables are coherent and allowed by workflow. Do not merge without Architect approval; never force push or skip branch protection.
- Required CI should cover frontend/backend typecheck/lint/test/build, workflow/migration checks and applicable security/AI checks. Green on the actual PR SHA, not historical commit. If CI fails, fix relevant failure without disabling tests or weakening policy.
- Update docs/tasks/Phase-05/ implementation plan and evidence, plus task-scoped feature docs and CHANGELOG if required. Avoid rewriting whole architecture/roadmap files without justification.

### 11.4 Rollback and operational safety

Frontend/Express feature rollback can deploy previous compatible app revision while additive DB schema remains. For migrations, provide forward fix/rollback plan without assuming destructive down migrations are safe after data writes. Product/catalog or inventory mutation recovery must preserve historical orders, payments and event audits. Keep any temporary QA data manifest and do not run silent cleanup on shared DEV.

## 12. FULL ACCEPTANCE CHECKLIST — FINAL AUTHORITATIVE SIGN-OFF

Use [PASS / FAIL / NOT VERIFIED] per check with evidence path, commit SHA, environment and reviewer. Failure and not-verified are not interchangeable. Tests already credibly passing may be reused when unaffected; do not demand unrelated full re-execution. A material bug prevents sign-off regardless of numerical checklist completion.
A. Baseline and architecture
- [ ] A01 — Current develop/PR baseline inspected; approved 04.7 merged behavior preserved.
- [ ] A02 — Dedicated feature/05.1-admin-dashboard branch verified/reused or created safely if absent; unrelated edits protected.
- [ ] A03 — Existing routes/APIs/Prisma/models/media/delivery audited before new code; no shadow implementation.
- [ ] A04 — Figma Make screenshot inventory complete; exact references, routes and states mapped.
- [ ] A05 — M0 API/domain contracts, authorization and migration impact documented.
- [ ] A06 — 05.2 exclusions respected; no invitation/MFA/analytics event scope creep.
B. Admin shell and cross-cutting UI
- [ ] B01 — ADMIN login, authenticated session and logout work with existing auth.
- [ ] B02 — Accurate, keyboard-accessible sidebar: expand/collapse, active routes, mobile drawer.
- [ ] B03 — Header profile menu, role/identity, functioning logout and meaningful notification states.
- [ ] B04 — Breadcrumbs route correctly; no inert prototype links or Figma navigation switcher.
- [ ] B05 — Responsive shell and real 200% zoom; no trapped scroll, hidden CTA or overflow.
- [ ] B06 — New admin routes block guests/customers on frontend and backend.
C. Products
- [ ] C01 — Product list search/filter/sort/page accurate; image/status/stock real.
- [ ] C02 — Product create validates name/SKU/slug/category/prices and persists.
- [ ] C03 — Product edit loads/saves specifications, pricing, status, category and media safely.
- [ ] C04 — Approved media upload/primary/reorder/retirement 04.3 behavior preserved.
- [ ] C05 — Product archive/deactivate leaves historical orders/payment attempts intact.
- [ ] C06 — Errors/duplicate/stale edits/invalid media/security tests pass.
- [ ] C07 — List/create/edit/archive Figma comparison, responsive/keyboard QA recorded.
D. Categories
- [ ] D01 — Category list and counts/filter work, no N+1.
- [ ] D02 — Add/Edit dialogs save with validation and focus behavior.
- [ ] D03 — Unique slug/name collision safe; inactive category behavior coherent.
- [ ] D04 — Disable/archive preserves linked products and handles dependency rules.
- [ ] D05 — Figma list/add/edit responsive/keyboard comparison and errors documented.
E. Inventory
- [ ] E01 — Summary cards, stock filters and product/SKU search reflect authoritative inventory.
- [ ] E02 — Restock/correct/set persist through atomic checked inventory service.
- [ ] E03 — Negative/overflow, missing inventory and concurrent stock update rejected safely.
- [ ] E04 — Checkout/refund compensation inventory invariants preserved.
- [ ] E05 — Stock status/threshold and customer availability update correctly.
- [ ] E06 — Inline or modal adjustment keyboard/visual/200% zoom checks pass.
F. Orders
- [ ] F01 — Admin order list server pagination/filter/sort and separate payment status correct.
- [ ] F02 — Order detail shows immutable historical line items and sanitized customer/payment facts.
- [ ] F03 — Allowed order/delivery transitions work; invalid/payment-ineligible/terminal denied.
- [ ] F04 — No admin UI fabricates payment success, refunds or new shipment schema.
- [ ] F05 — Order-to-delivery and back navigation/refresh persistence work.
- [ ] F06 — List/detail/scrolled Figma comparison and responsive/keyboard QA pass.
G. Customers
- [ ] G01 — ADMIN-only list/search/filter/page shows real authorized customers.
- [ ] G02 — Customer detail and order links work without PII overexposure.
- [ ] G03 — Customer aggregates count/paid spending are defined and reconcile.
- [ ] G04 — Any active-status mutation has confirmed session/security rules, otherwise excluded with approved rationale.
- [ ] G05 — No generic role elevation, MFA/invite management or seeded-admin registration expansion.
- [ ] G06 — Customer screenshot/interaction/empty/large-list QA passes.
H. Delivery integration
- [ ] H01 — Existing 04.5–04.7 admin delivery routes, realtime and history continue working.
- [ ] H02 — Orders and Deliveries link to correct canonical existing pages.
- [ ] H03 — Active delivery list and filter/pagination show correct information.
- [ ] H04 — No regressions to payment eligibility, order status, map, simulation labels or authorization.
- [ ] H05 — Delivery Figma comparison and affected browser smoke evidence collected.
I. Dashboard
- [ ] I01 — /admin is real dashboard, not placeholder.
- [ ] I02 — KPIs reflect authoritative filtered time period, correctly formatted money/currency.
- [ ] I03 — Recent orders and low-stock/active-delivery quick links work.
- [ ] I04 — No fictitious chart, count, growth percentage or unread indicator shown as real.
- [ ] I05 — Empty/partial error/large-number/responsive/visual states pass.
J. QA, security and integration
- [ ] J01 — Every new admin endpoint unauthorized role/API tests pass.
- [ ] J02 — Product/category/inventory/order concurrency, dependency and history tests pass.
- [ ] J03 — Storybook real component states cover normal/error/empty/loading/dialog/responsive.
- [ ] J04 — Actual browser comparison with each supplied screenshot recorded; meaningful differences explained.
- [ ] J05 — Keyboard, focus, 390/768/1440/1920, 200% zoom and reduced-motion QA verified.
- [ ] J06 — Runtime API + disposable database browser flows pass; no DEV/PROD data confusion.
- [ ] J07 — Typecheck/lint/build/affected tests/Playwright/Storybook checks pass.
- [ ] J08 — Schema changes (if any) approved, additive, tested on disposable DB and migration CI-safe.
- [ ] J09 — No credentials, private PII, test passwords, raw Stripe data, QA dumps or irrelevant files in commits.
- [ ] J10 — PR CI green on final HEAD, docs/evidence updated, Architect reviewed and approved.
Closing rule: Task 05.1 is not considered complete merely because all screenshot pages render. The recorded acceptance must prove reliable admin operations, safe backend writes, correct database invariants and live browser UX. Conversely, do not keep reopening accepted work without a real defect or requirement gap.

## 13. REQUIRED IMPLEMENTATION HANDOFF, DOCUMENTATION AND SCORECARD

### 13.1 Deliverables

1. Task branch/PR: feature/05.1-admin-dashboard → develop, containing all reviewed in-scope production code, test code and needed docs.
2. M0 implementation matrix: backend/frontend/database capability inventory and reuse plan; M1–M9 milestones and screens.
3. Frontend: complete AdminLayout and all operational pages/components with Storybook stories and styling.
4. Backend: protected ADMIN endpoints/services/validators following existing patterns, documented DTO contracts and response behavior.
5. Database: schema/migrations only if justified, constraint verification and before/after integrity evidence.
6. Quality evidence: screenshot-reference-to-live pairs, Storybook screenshots, Playwright logs/traces, accessibility/responsive/keyboard results, unit/integration outcomes.
7. Docs: task evidence, API/feature docs, migration decisions, operational caveats, changelog entries where appropriate; deliberate Figma refinement/deviation log.
8. Final report: summary, exact files, API and DB changes, security review, test commands/results, screenshots, CI SHA, residual risks, non-scope, final recommended disposition.

### 13.2 Expected per-milestone summary

```text
TASK: 05.1 — M<n> — <milestone name>
BRANCH / SHA:
IMPLEMENTED FRONTEND:
IMPLEMENTED BACKEND / API:
PRISMA / DATABASE IMPACT:
EXISTING APPROVED CODE REUSED:
SOURCE SCREENSHOTS AND VISUAL REFINEMENTS:
STORYBOOK / PLAYWRIGHT / MANUAL KEYBOARD / RESPONSIVE EVIDENCE:
TESTS RUN / PASS / FAIL / NOT RUN:
SECURITY AND DATA-INTEGRITY VERIFICATION:
MATERIAL BLOCKERS (if any):
OPTIONAL IMPROVEMENTS (nonblocking):
ARCHITECT SCORE /100:
VERDICT: APPROVE | REQUEST CHANGES | REJECT
NEXT MILESTONE READY: YES | NO
```
Stop at meaningful milestone handoffs for Architect review as project governance requires; no endless review loops. Integrate fixes where genuine, then move to next milestone. Full final release approval remains separate from milestone technical acceptance.

### 13.3 Final PR self-review checklist

Before calling ready for review: inspect exact changed files and staged diff (including untracked), ensure no unrelated ROADMAP/04.7 work got staged, verify real develop merge base, check tests on actual final commit, ensure missing CI checks are clearly stated, confirm no private screenshot/data leaked, ensure all new routes are linked/not orphaned, verify no duplicated catalog/media/delivery implementations, reconcile API docs with code and migrate only through approved process. No merge or deployment without explicit authorization.

## 14. IMPLEMENTATION INSTRUCTIONS TO CLAUDE / CODEX

Build the complete Task 05.1 described above in the existing ElectroHub repository. Begin with current develop, verify the approved 04.7 merged state, preserve any local changes, and use feature/05.1-admin-dashboard after verifying its baseline (create only if absent). Read the task, architecture, AGENTS.md, Figma screenshot exports and the real source code before implementing. Use only the repository-hosted Figma Make screenshots as supplied visual reference—no Figma Design link is required—and follow existing design tokens and architecture. Complete all ten milestones M0–M9 across frontend, backend and database, reusing 04.3 product media and 04.5–04.7 delivery rather than replacing them. Build every admin page into a polished, responsive, accessible, production-grade operational system with real state/validation/data. Use existing Storybook and Playwright to compare actual DOM to each reference and test keyboard, focus, motion, responsive states and live integration. Respect canonical order/payment/inventory/delivery state, data privacy and production-migration boundaries. Do not implement 05.2 invitations/MFA, recommendation admin or general analytics events during 05.1. Deliver milestone evidence/review handoffs and a final PR with passing required CI; do not merge/deploy without Architect approval.

This paragraph is a concise execution summary; the preceding sections and acceptance criteria are the normative full task file. If implementation discovers a conflict with inspected actual code or newer merged changes, document the conflict, propose the least disruptive compatible solution and obtain targeted review of the material decision; never silently invent functionality or weaken security.

## 15. PROJECT SOURCE REGISTER AND TRACEABILITY

### 15.1 Repository project sources (inspect actual latest revision)

- docs/01_Project Foundation/ROADMAP.md — Phase 05 §8: Task 05.1 operational modules, Task 05.2 recommendation/analytics/polish.
- docs/01_Project Foundation/{PROJECT_VISION,TECH_STACK,PROJECT_STRUCTURE}.md — project goals, approved stack and repo conventions.
- docs/03_Architecture/{SYSTEM,FRONTEND,BACKEND,DATABASE}_ARCHITECTURE.md — service layering, UI/router/state, admin tables, Prisma and migration principles.
- docs/05_Features/{ADMIN,PRODUCTS,CATEGORIES,INVENTORY,ORDERS,DELIVERY_TRACKING}.md and docs/05_Features/ORDER_MANAGEMENT_03.7.md — domain contracts; verify outdated statements against actual code.
- docs/04_Engineering Standards/ — API, security, testing, state and coding standards.
- docs/08_Quality/{STORYBOOK,TESTING,QA}.md — installed Storybook and Playwright workflow, QA evidence.
- docs/06_Database/ — Prisma migration and production release controls.
- docs/assets/figma/FIGMA.md — design token hierarchy, screenshot workflow and restrictions on Figma Make extraction.
- docs/assets/figma/exports/admin/screenshots/ — actual approved visual references to inspect locally.
- apps/frontend/src/routes/index.tsx, apps/frontend/src/layouts/AdminLayout.tsx, apps/frontend/src/pages/admin/*, apps/frontend/src/features/adminMedia/, apps/frontend/src/features/delivery/ — actual frontend baseline.
- apps/backend/src/routes/, apps/backend/src/controllers/, apps/backend/src/services/, apps/backend/src/services/inventory.service.ts, apps/backend/prisma/schema.prisma, apps/backend/prisma/migrations/ — actual domain/API/data source.
- apps/frontend/.storybook/, apps/frontend/src/**/*.stories.tsx, apps/frontend/tests/, apps/frontend/playwright*.ts, frontend/backend package scripts — existing testing infrastructure.
- docs/tasks/Phase-04/TASK_04.3_PRODUCT_IMAGE_STORAGE_AI_EMBEDDING_SYNCHRONIZATION.md, docs/tasks/Phase-04/TASK_04.5_DELIVERY_TRACKING.md, docs/tasks/Phase-04/TASK_04.7_SOCKET_IO.md, and accepted 04.5–04.7 implementation/acceptance evidence — approved predecessor features.

### 15.2 Screenshots included by owner in the task discussion

The owner provided visual references for: Dashboard first/scrolled, Products first/scrolled, Create Product, Edit Product, Delete Product confirmation, Categories list, Add Category, Edit Category, Inventory first/scrolled, Orders list, Order Details first/scrolled, Delivery Management list, Customers list. Do not mention any pasted-discussion attachment's filename as an implementation dependency; this task incorporates its architecture and UI decisions directly. The developer must map these content categories to actual screenshot export filenames under the repository folder in M0.

### 15.3 Historical versus current assertions

This document reflects a read-only examination of repository files and the owner-provided schema/screenshots as of its preparation, but does not claim a full local running-app inspection, exact current PR SHA, applied PROD migration ledger or completion of 05.1. All API routes marked proposed must be reconciled with existing code at M0. Any data model/API requirement that is already implemented should be reused, not recreated. The 04.7 merger is a confirmed prior milestone, not a new 05.1 implementation requirement.

## 16. FINAL ACCEPTANCE PRINCIPLE

05.1 delivers a complete functional admin operations platform on a dedicated branch, using the existing commerce and delivery architecture, the repository's Figma Make screenshots and established UI design system, its current Storybook/Playwright test infrastructure, strict backend authorization, safe PostgreSQL/Prisma persistence, and thorough real browser QA.


Figma screenshots define the starting composition; they are not the ceiling for state coverage, responsive design or advanced interaction. Every premium enhancement must maintain ElectroHub's recognizable layout, content, colors and hierarchy. The 05.1 result must be credible enough to hand over for architectural review on the first full implementation pass; 05.2 starts only after 05.1 has its own documented, accepted scope and integration status.

## Consolidated acceptance index and coverage

The detailed A01–J10 checklist above is the executable sign-off record. These summary IDs retain traceability to the earlier task specification and are additional indexes into the same requirements, not a second review cycle.

| Earlier criterion | Consolidated coverage |
| --- | --- |
| AC1: baseline, M0–M9 review, safe branch and approved 04.7 | Sections 0, 5, 11; A01–A06 |
| AC2: complete real operational workflows without dead actions | Sections 1, 5–7; B–I |
| AC3: server security, privacy, lifecycle and concurrency | Sections 3, 7–8, 10; J01–J02 |
| AC4: authoritative reconciled overview | M8; I01–I05 |
| AC5: reference/DOM comparison, component stories, keyboard/responsive/motion and parent-page integration | Sections 4, 9–10; J03–J06 |
| AC6: proportionate tests, safe migrations, compatibility, CI and approved systems | Sections 10–11; H04, J07–J09 |
| AC7: documentation, rollback, risks and final architect score/verdict | Sections 11–13; J10 |

All acceptance statements require evidence of actual execution. This specification itself establishes no implementation, passing QA, CI, merge or deployment. Approve when requirements and required QA are met with acceptable residual risks; reopen accepted work only for actionable defects or material gaps.

## 17. IMPLEMENTATION INVARIANTS AND TEST MAP (recorded during implementation)

Full contracts, decisions and the test map are in `TASK_05.1_IMPLEMENTATION_PLAN.md`; acceptance evidence is in `TASK_05.1_IMPLEMENTATION_EVIDENCE.md`. Short form:

| # | Invariant | Enforced by | Test |
|---|---|---|---|
| 1 | ADMIN from the database role on every request; strict bodies; whitelisted list queries | `routes/admin.routes.ts`, `validators/admin.validator.ts` | `admin.routes.test.ts` |
| 2 | No silent overwrite: `expectedUpdatedAt` (products, categories, customers) and `expectedQuantity` under `FOR UPDATE` (inventory) → 409 | admin services | `admin-operations.service.test.ts`, `AdminInventoryPage.test.tsx` |
| 3 | Stock changes only through `InventoryService` | `admin-inventory.service.ts` | `admin-operations.service.test.ts` |
| 4 | Archive, never hard-delete products; delete a category only when unreferenced | `admin-catalog.service.ts` | `admin-operations.service.test.ts` |
| 5 | No activation into a hidden category | `admin-catalog.service.ts` | `admin-operations.service.test.ts` |
| 6 | Payment read-only; fulfillment through the 04.5 delivery API only | `AdminOrderDetailPage.tsx` → `useAdminDeliveryMutations` | delivery suites (unchanged) |
| 7 | Customer: no self-change, no role change, deleted accounts never reactivated, deactivation revokes tokens + sockets | `admin-customer.service.ts` | `admin-operations.service.test.ts` |
| 8 | Truthful dashboard numbers (SUCCEEDED by `paidAt`, refunded excluded, per currency, no growth %) | `admin-dashboard.service.ts`, `AdminDashboardPage.tsx` | route validation tests; browser QA |
| 9 | Only implemented 05.1 modules in navigation; logout returns to `/admin/login` | `features/admin/shell/navigation.ts`, `routes/index.tsx` | `AdminLayout.test.tsx` |
