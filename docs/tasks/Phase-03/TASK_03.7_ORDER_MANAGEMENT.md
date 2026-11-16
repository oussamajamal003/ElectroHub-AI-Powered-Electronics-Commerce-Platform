# ELECTROHUB — TASK 03.7 / CUSTOMER ORDER MANAGEMENT

**Phase:** 03 — Commerce  
**Branch:** `feature/Order-Management`, based on up-to-date `develop`  
**Target:** `develop`, subject to independent review and separate integration authorization  
**Prepared:** 2026-10-18, Asia/Beirut  
**Status:** Implementation complete (2026-10-18), awaiting independent architect review. See [implementation evidence](TASK_03.7_IMPLEMENTATION_EVIDENCE.md). Not integrated or released.  
**Scope:** Customer UI, owned Order APIs, lifecycle presentation, immutable snapshots, confirmation integration, Storybook, automated tests, browser/visual QA, documentation and architect review  
**Location:** `docs/tasks/Phase-03/TASK_03.7_ORDER_MANAGEMENT.md`

> Deliver a complete, polished customer Order Management experience on the existing 03.5 Order foundation and closed 03.6 payment architecture. The first handoff must include working history and details, truthful independent fulfillment/payment states, secure ownership, responsive layouts, inspected screenshots, and proportionate reproducible evidence. Do not recreate checkout, reopen payment orchestration, mutate PROD, commit, push, merge, trigger CI, or deploy under this task.
 
## 1. Authority, intent and source decisions

This is the authoritative implementation specification for 03.7, subject to explicit owner instructions and the repository's coordination rules. Read it completely before implementation. Existing code establishes the integration baseline; it is not permission to retain behavior that contradicts these acceptance criteria.

Use explicit task requirements first, then verified implementation/contracts and repository architecture. The three supplied Make screenshots are the visual targets for this task. Existing design tokens/components determine reusable implementation details. Historical discussion is reference material, not an instruction to execute old migrations or reopen completed work.

Resolve these historical contradictions explicitly:

- The roadmap's “Order creation” means completing the management experience around Orders already created through approved Checkout/payment orchestration. It does not authorize another creation endpoint, model, transaction, stock decrement, or cart-clearing path.
- The screenshots' fulfillment labels “Processing” and any older “Shipped” component labels must become the exact canonical labels in section 6. Payment processing remains a separate concept.
- The pasted discussion's PROD 15/19 statement is obsolete. Update 8 records successful 19/19 migration completion; see section 3.
- The older suggestion to fix processing navigation in 03.6 is historical. Preserve the accepted current 03.6 behavior, including durable recovery and safe continued shopping. Do not restore a blanket navigation lock based on an old discussion.
- “Full lifecycle” means truthful customer lifecycle reads and presentation, plus preservation of existing internal transitions. General administrator transition controls belong to 05.4. Customer cancellation/refund actions are not authorized by displaying Cancelled/Refunded.
- No live Figma Design link or connector is required. Open the supplied screenshots directly. Do not block on Figma access or claim to have inspected an unseen frame.

## 2. Repository-first baseline and inspected sources

Specification preparation inspected the repository at:

`C:/Users/ouss0/Desktop/Tools/Coding/Portfolio/ElectroHub — AI-Powered Electronics Commerce Platform`

The local Git branch query returned `develop`; recent history included `c646dce` (merge of Stripe PR #29), `c42fa60` (PROD migration verification), and `a824eb4` (auth/test alignment). A working-tree status command failed with “this operation must be run in a work tree” in the inspection environment. Therefore a clean working tree, remote freshness and implementation branch readiness are **not verified**. Resolve the Git context at implementation startup without changing Git configuration or discarding work merely to bypass this issue.

Inspected references include root `AGENTS.md`, `AGENT_COORDINATION.md`, workspace/package configuration, roadmap sections 03.7–03.9, 03.5 task and handoff/evidence, 03.6 task and Update 8 cutover record, actual Order schema/service/routes/validator, frontend history/confirmation/types/status components/router, Storybook examples, Playwright configuration and CI configuration. The supplied pasted discussions and all three screenshots were read/opened. No runtime, live database, payment, browser implementation test, or remote CI result is claimed by specification preparation.

### Concrete baseline to extend

| Layer | Existing implementation and consequence |
| --- | --- |
| Structure | npm workspaces `apps/frontend` and `apps/backend`; also `packages`, `services`, `infrastructure`, `scripts`, `tests`, `docs`. Keep the established hierarchy. |
| Frontend | React 19, TypeScript, Vite, SCSS Modules, React Router, React Query, Radix, Lucide. Use current lockfile/toolchain. |
| Backend | Express, TypeScript, Zod, Prisma/PostgreSQL; central auth, error middleware and API routing. |
| Schema | `apps/backend/prisma/schema.prisma`: `Order`, `OrderItem`, optional one-to-one `Payment`, existing payment-attempt/work relationships. |
| Order service | `apps/backend/src/services/order.service.ts`: `confirmation`, `list`, `getConfirmation`, `getAttempt`, rejected legacy `create`, internal `commitAuthorized`. Extend read capabilities here or a focused collaborating read module; no parallel Order domain. |
| Existing list | `GET /api/orders` already exists in `apps/backend/src/routes/checkout.routes.ts`, with CUSTOMER auth, no-store, owner predicate, bounded pagination and descending `(createdAt,id)` ordering. It currently returns full confirmation projections. |
| Pagination | `apps/backend/src/validators/order.validator.ts`: defaults page 1/pageSize 10; page maximum 1000, pageSize maximum 50; strict query object. Preserve these bounds unless an explicit compatible change is documented. |
| Existing reads | `GET /api/orders/:orderReference/confirmation` and `GET /api/orders/attempts/:attemptId/confirmation`. Keep both compatible. |
| Creation | `POST /api/orders` deliberately returns `409 PAYMENT_REQUIRED`; `commitAuthorized` is an internal orchestrator capability. Do not reactivate unpaid order creation. |
| Public reference | Computed as `ORD-` plus uppercase Order UUID. No separate short-reference column. Do not copy `ORD-J220A0` from the prototype into production behavior. |
| History UI | `apps/frontend/src/pages/customer/OrdersPage.tsx` already fetches paginated history with account-scoped query keys. Its cards currently link to confirmation, not a dedicated details page, and do not provide the required canonical fulfillment presentation. |
| History styling | `OrdersPage.module.scss` constrains list/empty widths; `.empty` has no explicit centering. Rework composition to the supplied reference and center the true empty state. |
| Confirmation | `apps/frontend/src/features/checkout/ConfirmationPage.tsx`, `CheckoutComponents.tsx`, `Checkout.module.scss`; preserve payment-truth logic and separate confirmation from durable details. |
| Shared types | `apps/frontend/src/features/checkout/types.ts`: `Confirmation` already contains snapshot data, `paymentState`, optional safe card metadata; its `status` is currently a broad string. Introduce precise management mappings without silently breaking checkout consumers. |
| Badges | `components/ui/OrderStatus` currently supports processing/shipped/delivered/cancelled; `PaymentStatus` supports pending/paid/failed/refunded. Extend compatible shared behavior for canonical labels and legacy unprocessed payment; inspect all consumers. |
| Router/query | `apps/frontend/src/routes/index.tsx`, `src/lib/query`, central `src/lib/api`; `/orders` and `/checkout/confirmation/:orderReference` already exist. |
| Visual infrastructure | Existing Skeleton, EmptyState, ErrorState, ProductImage, Pagination, Breadcrumb, Button, StatusBadge and ElectroHubLoader; reuse production components in stories/tests. |

Read relevant surrounding code, tests, query invalidation and auth/session cleanup before edits. Revalidate this baseline against the actual implementation branch.

## 3. Closed task and PROD baseline

03.5 owns Checkout and immutable Order core. 03.6 owns payment-authorized creation, capture, compensation, retries, recovery, webhook processing and saved-purchase behavior. Both boundaries remain intact. Completing their deferred Order Management integration does not reopen their tasks.

`TASK_03.6_PROD_CUTOVER_GO_NO_GO_RECORD.md`, **Update 8**, is the authoritative historical migration evidence:

- Prisma applied exactly the four approved pending migrations and exited 0.
- PROD reached **19 finished migrations, 0 failed, 0 unfinished**.
- All four checksums matched, including migration #1's CRLF bytes.
- Exact definition parity: **18 enums, 297 columns, 77 constraints, 116 indexes**.
- All 28 application tables remained empty at that verification point.
- Historical ledger records, RLS settings, policies and grants were preserved.
- The owner explicitly accepted the absence of a verified backup/PITR recovery point for that database-only operation.
- Task 03.6 remains **CLOSED**. Database migration completion did not deploy or activate a production application/payment service.

These are recorded Update 8 facts, not a fresh live inspection by 03.7. Do not rerun the four migrations, revive the superseded Update 7 NO-GO, claim current tables are still empty without evidence, or treat prior authorization as permission for new operations.

**03.7 must not mutate PROD:** no migrations, schema pushes, seed/fixture/cleanup writes, RLS/grant changes, worker runs, payment operations, activation flags or deployment. Do not expose credentials in evidence. Prefer offline and isolated tests; remote DEV operations also require the repository's separate operational authorization. Preserve Prisma migration governance; do not introduce a second Supabase migration history.

## 4. Branch, shared-work and multi-agent protocol

1. Read root `AGENTS.md`, `AGENT_COORDINATION.md`, applicable nested instructions and active ownership records.
2. Inspect current revision, branch/worktree, uncommitted changes and related files before edits. Do not reset, clean, auto-stash, overwrite or move someone else's work.
3. Fetch the relevant remote using the established workflow; verify `develop` is up to date. Never claim freshness from an old local branch name. If fetch/access is unavailable, record that limitation before dependent branch work.
4. Create `feature/Order-Management` from verified up-to-date `develop` in a safe checkout/worktree. If it already exists, inspect ancestry and ownership and continue it only when appropriate; do not recreate or reset it. Record base SHA and current SHA.
5. Record task ID, workstream, owner, owned files, protected files, dependencies, status and approval reference in the existing task registry/protocol. Define a related-file manifest with purpose, change intent and requirement IDs.
6. Follow the protected-file CCR matrix. Schema/generator, payment services, shared auth/API interceptors, CartProvider, checkout/recovery state and connection settings require the relevant owners/architect when changed. Prior explicit authorization remains valid within its scope; do not repeatedly request it.
7. If parallel agents are used, assign independent file ownership and interfaces first. One owner per shared file; serialize shared-contract edits and integration. Review the combined result, not just individual workstream reports.
8. Produce a bounded implementation plan covering data/API, state mapping, visual classification, tests and evidence. Continue routine authorized work autonomously; stop only dependent work on material conflicts or an actual required approval.
9. **No commit, push, merge, CI trigger or deployment.** Finish with reviewable local changes, evidence and handoff. Implementation-complete is not architect-approved, integrated or released.

## 5. Scope and exclusions

### Required

- Authenticated customer history, newest first, with bounded pagination and total order count.
- Dedicated refresh-safe, deep-linkable owned Order Details.
- Purchase-time items, address, delivery estimates/method, currency and totals.
- Independent canonical fulfillment and truthful payment presentation, including cancellation, awaiting capture and legacy payment absence.
- Completion of confirmation's **View Order Details** CTA and exact outside-card placement.
- Centered Orders empty-state panel and complete loading/error/auth/no-result states.
- Consistent Header/Footer/account/card/breadcrumb/back navigation.
- Polished responsive layouts at 390, 768, 1440 and 1920 pixels; keyboard and reduced-motion behavior.
- Shared component stories, appropriate automated tests, real-browser QA, captured and opened screenshots, documentation and independent review.

### Excluded

No second order creation flow, new checkout wizard, Stripe integration redesign, payment retry/charge/refund initiation from details, inventory/cart mutations on reads, email (03.8), invoices/PDFs (03.9), live tracking/maps/driver/Socket.IO (Phase 04), administrator order editing or analytics (Phase 05), hosted release (Phase 06), returns/reorder/cancellation products, unrelated refactoring or broad bug hunts.

Track Delivery may be active only if an already-approved, functioning, owned destination exists and is verified. Otherwise omit the button and tracking number; a schema relationship or prototype route is not proof of functionality. Do not add a fake disabled feature solely to fill space.

## 6. Fulfillment and payment contracts

### Fulfillment

| Stored Order status | Exact customer label | Behavior |
| --- | --- | --- |
| `CONFIRMED` | Confirmed | Existing confirmed fulfillment state; not inferred from an Order's existence. |
| `PREPARING` | Preparing | Show preparation independently of payment badge. |
| `OUT_FOR_DELIVERY` | Out for Delivery | No invented tracking location, number or ETA. |
| `DELIVERED` | Delivered | Historical completed fulfillment; no invented delivered timestamp. |
| `CANCELLED` | Cancelled | Terminal exception; do not imply refund or automatically mutate payment. |
| `AWAITING_CAPTURE` | Finalizing your order | Internal pre-fulfillment state, not a fifth normal fulfillment step and not Confirmed/Paid. |

Normal progression is **Confirmed → Preparing → Out for Delivery → Delivered**. Preserve cancellation/compensation semantics already implemented by 03.6. Do not infer intermediate timestamps or a status history from `updatedAt`. No customer endpoint or UI may advance, reverse or cancel fulfillment. General transition mutation/administration is deferred to 05.4; document its future preconditions rather than adding an unused mutation API.

Inspect existing capture/compensation writers and preserve their verified-capture gating. No UI mapper, GET handler or fixture reachable in production may set CONFIRMED or progress fulfillment. Do not reject or rewrite historical legacy rows merely because they lack Payment.

### Payment

Reuse the established safe projection:

| Persisted Payment | Existing projection | Customer wording |
| --- | --- | --- |
| absent | `UNPROCESSED` | Not processed |
| `PENDING` | `PENDING` | Pending |
| `PROCESSING` | `PENDING` | Pending; use Processing only with a deliberately documented safe distinction |
| `SUCCEEDED` | `PAID` | Paid |
| `FAILED` | `FAILED` | Failed |
| `REFUNDED` | `REFUNDED` | Refunded |

Maintain confirmation contract compatibility. Do not silently change `PENDING` into a new enum for its existing consumers. Do not collapse legacy `UNPROCESSED` into Paid or claim it is an actively processing charge. PaymentAttempt/provider/work states remain distinct from Payment and Order statuses.

Render both badges with accessible context (Order status / Payment status), text and icons, not color alone. Paid is based on stored authoritative success, never redirect parameters, localStorage, optimistic state or client assertions. Show “Total paid” only when justified; use “Order total” otherwise. Refunded/cancelled/failed combinations must reflect their independent stored states, not an invented pairing table.

Optional safe detail fields from Payment are amount, currency, paidAt, refundedAt and masked brand/last4, only if useful and actually persisted. Dates are omitted when absent. Never show raw provider failure messages. Unknown future status values fail safely to “Status unavailable” without crashing or falsely claiming success; log only sanitized diagnostics.

## 7. Immutable snapshot and data-integrity rules

Use the existing Order/OrderItem purchase facts:

- Order reference and creation date; owner derived from authenticated request.
- `productName`, `sku`, `productImageUrl`, quantity, Decimal unit price and line total from OrderItem.
- Shipping recipient, phone, line1/line2, city/state/postalCode/country from Order, not the current profile/address book.
- Delivery method and estimatedDeliveryStart/End from Order, not newly calculated checkout options.
- Subtotal, shippingCost, total and currency from Order; money serialized as fixed-decimal strings, formatted for display only.

Do not fetch current product prices/names/images to reconstruct history. Product edits, deactivation and image changes must not rewrite purchase facts. Current Product deletion is restricted by OrderItem's foreign key; preserve that constraint and test it rather than weakening it to simulate deletion. Missing/unavailable historical images use ProductImage fallback without replacing snapshot metadata with current catalog data. A stored image URL preserves the reference, not a guarantee that a remote image stays available forever.

Do not recalculate old totals with today's prices or delivery fees. Preserve existing decimal precision; do not use floating-point arithmetic as financial truth. Use stored currency and existing formatting conventions. Distinguish zero shipping (“Free”) from missing data. Date-only delivery estimates must not shift calendar days across timezones; follow the established UTC/business-date treatment. Estimates remain estimates; a past date does not prove delivery.

History item count means **sum of quantities**. If showing a distinct-line count, label it separately. Preview images can be bounded (for example first three plus remaining count); details must show every purchased line. Use stable persisted line identity for new details DTOs where available; do not assume product ID always uniquely identifies a future order line.

## 8. Backend API requirements

Extend existing route/service/validator architecture. Controllers remain thin; ownership and projections remain server-side. No direct browser-to-Supabase replacement for the existing API/auth model.

### History: `GET /api/orders?page=1&pageSize=10`

- `requireAuth`, `requireRole('CUSTOMER')`, existing central error handling and `Cache-Control: no-store`.
- Owner predicate on both list and count; never accept userId, role or ownership authority from query/body.
- Preserve strict positive-integer validation and current bounds. Reject zero, negatives, floats, nonnumeric/unsafe numbers, repeated/array values and unknown parameters consistently with existing validation errors.
- Stable newest-first sort `(createdAt DESC, id DESC)`; preserve tie ordering. No unbounded read or per-card follow-up API call.
- Preserve `{ data: [...], meta: { page, pageSize, total, totalPages } }` and existing consumers. `total` counts Orders, not items or current page length.
- Empty account returns an empty array/zero total; a valid out-of-range page returns empty data with accurate metadata, not a misleading “no orders yet” claim.
- Existing list returns Confirmation-shaped data. Default to compatible additions such as itemCount/preview data if useful. Removing fields/replacing it with a summary DTO requires a documented consumer migration; do not silently break tests, confirmation or saved-purchase integrations.
- Keep queries bounded and avoid N+1 lookups. Inspect existing `[userId,createdAt]` index before proposing changes. A new index is not mandatory without measured need.

### Details: `GET /api/orders/:orderReference`

- Add a dedicated management read backed by the same persisted records/projection helpers. Keep existing confirmation and attempt-confirmation endpoints intact.
- Validate reference length and UUID/public-reference syntax using existing conventions. Generate canonical `ORD-<UPPERCASE UUID>` links; retain supported legacy reference normalization where compatibility requires it.
- Query by normalized ID **and authenticated owner together**. Unknown and non-owned valid references both return `404 ORDER_NOT_FOUND` with the same public message. Do not first reveal global existence.
- Return `{ data: OrderDetails }` containing reference/date, canonical stored status, safe payment projection, immutable items/shipping/delivery and totals. Document exact nullable fields and amount/date formats in API docs/types/tests.
- Keep route matching unambiguous with `/orders/attempts/.../confirmation` and `/orders/:orderReference/confirmation`; register specific routes deliberately.
- Expected semantics: 200 success, existing 400 validation errors, 401 unauthenticated, 403 wrong role, indistinguishable 404 for missing/wrong owner, sanitized 5xx. GET never creates, reconciles, captures, cancels, refunds or clears anything.

### Security and compatibility

DTOs must be allowlisted. Never serialize a Prisma Order/Payment relation wholesale. Exclude other customers' records, request hashes, checkout idempotency keys, PaymentIntent client secrets/IDs unless already explicitly required by an unrelated approved flow, webhook payloads, work leases, recovery internals, raw failureReason, credentials and unnecessary internal identifiers. Card output is masked brand/last4 only, never PAN/CVC/expiry collection.

Use parameterized ORM access, existing request validation, auth/rate-limit/error conventions and sanitized logging. Do not weaken auth, CORS, cookies, RLS or grants. If an exposed database access path is discovered, assess it under the existing access model; backend auth alone is not proof of Data API protection. Prepare a scoped finding/CCR where material, without unapproved security-schema changes or a migration detour.

Private order data must not enter public/shared caches, analytics payloads, URLs beyond the intended order reference, or logs. History/address data stays account scoped. Do not persist new sensitive order details in browser storage. Escape all names/addresses through normal React text rendering; no unsafe HTML.

## 9. Database decision

The existing schema already contains the required statuses, snapshots, owner relation, money, estimates and Payment fields. **Default decision: no schema migration.** Do not add another public-reference scheme or duplicate snapshot columns merely for the UI.

Document the explicit decision after inspection. If a concrete gap requires a migration, prepare only a minimal compatible Prisma change with existing DATABASE/Architect coordination: exact diff, data/backfill implications, indexes, legacy behavior, rollout and rollback. Do not edit historical migrations or change Prisma generator/relation-loading settings globally for this task. Application authorization does not authorize migration execution in any remote environment.

## 10. Screenshot manifest and approved/refinement/future matrix

The following supplied images were opened during specification preparation. Preserve these original filenames when packaging reference evidence:

| Reference | Observed layout | Required treatment |
| --- | --- | --- |
| `Order details page.png` (1920 × 907) | Customer shell; Home → Orders → reference breadcrumb; title/date left and two badges right; Items above Delivery Address in broad left column; Order Summary and actions in narrower right column. | Match composition, proportions, alignment, borders, whitespace and hierarchy; real snapshots and canonical labels replace prototype data. |
| `Orders page.png` (1920 × 910) | Home → Account → My Orders; large heading and count; broad bordered card; reference left, badges right, thumbnail preview, divider, Date/Total/Items footer and chevron; Back to Account. | Match structure; complete pagination, states and accessible navigation. Do not retain the existing narrow confirmation-style list merely because it exists. |
| `Screenshot 2026-09-04 162526.png` (1919 × 911) | Scrolled lower confirmation; card ends after estimate/address; primary View Order Details outside card, then outlined Continue Shopping, both aligned to centered card width. | Exact action label, placement/order and shared width; preserve existing upper confirmation and payment semantics. |

The screenshot source attachments are part of the task inputs. A Markdown filename is not a substitute for an available image: before UI implementation, locate the actual attachments or repository copies and open them. If inputs are missing in a later session, obtain them and mark visual matching unverified until available. The expected root `assets/figma/` was absent in this inspected checkout; discover existing conventions before adding reference files. Do not fabricate a Figma URL or unseen mobile design.

| Classification | Elements |
| --- | --- |
| Approved visual target | Shell continuity, breadcrumbs, page hierarchy, broad cards, two-column desktop details, independent badges, items/address/summary grouping, outside-card stacked confirmation actions. |
| Required refinements | Real full UUID references, exact fulfillment labels, safe payment truth, centered empty state, responsive wrapping, loading/error/auth states, long/many-item content, pagination, keyboard focus and accessible action targets. |
| Future/omit | Unsupported Track Delivery, fake tracking values, admin controls, invoices, refund/cancel actions, email flows and Make bottom-right Customer/Admin/Flows/Components prototype switcher. |

Before coding, record a concise design gap matrix comparing these references with current implementation: approved parts to retain, required changes, allowable refinements and intentionally omitted future scope. Do not redesign the page or introduce new visual systems under “polish.”

## 11. My Orders experience

- Canonical route `/orders`; preserve current customer shell. Header, footer and account Orders entry reach the same route.
- Breadcrumb and heading follow the screenshot. Total count has correct singular/plural and is not the current page count. No fabricated count while loading.
- Cards show reference, snapshot preview, date, order total, item quantity count, fulfillment badge and payment badge. Newest first. Long references/names wrap without breaking alignment.
- Use a real link to `/orders/:orderReference` with a meaningful accessible name. Reference/card/chevron behavior must be consistent; avoid nested interactive controls, click-only divs or redundant keyboard stops.
- Include working Back to Account if its existing destination is supported. Do not invent a second account/order architecture.
- Pagination uses shared components, labels and `aria-current`; preserves sensible position on back navigation, and displays the current page correctly during loading. Support bookmarked page state using existing URL/search-param conventions where appropriate. Invalid UI query values normalize safely without bypassing backend bounds.
- Keep previous same-owner data during background/page refresh if useful, mark busy/non-current state clearly and prevent stale responses from replacing a newer page. Avoid showing old cards as though they belong to a newly selected page.
- On a now-empty out-of-range page with total > 0, offer/perform a bounded return to a valid page. Never show the first-purchase empty state for that case.

### Centered empty state

Only a successful, settled zero-total history response shows the true empty state. Reuse EmptyState with package icon, clear no-orders message and Explore Products action. Center a bounded panel horizontally beneath the heading and balance it vertically within the available main content area. Keep responsive gutters, normal document flow and unchanged Header/Footer. Do not use absolute viewport positioning, stretch the panel across the full viewport, or confuse errors/auth/session initialization with zero orders.

## 12. Order Details experience

Canonical route `/orders/:orderReference`. Refresh/direct entry works without prior checkout/navigation state.

- Breadcrumb: Home → Orders → real reference; title “Order <reference>”, placed date, two distinctly labeled badges.
- Desktop: broad Items/Delivery Address column and narrower Order Summary/action column as the reference shows. Keep aligned top edges and consistent gaps.
- Items: every snapshot item, image/fallback, name, quantity, unit amount and line total. No quantity editor or current-price recalculation. An optional existing product link cannot be required to read historical facts or lead to a fabricated product destination.
- Delivery: actual saved recipient/address and appropriate phone presentation; omit absent optional lines cleanly. Show stored method and estimated date/range. No placeholder address, tracking value or manufactured completion timestamp.
- Summary: stored subtotal, shipping amount or Free, divider and total/currency. Safe payment method/card information can be included as a focused supporting detail when available without displacing the approved hierarchy.
- Back to Orders returns to the known list page when navigation context is valid; direct-entry fallback is `/orders`. Do not send the user back into checkout/payment submission.
- Cancelled, refunded, failed, legacy unprocessed and awaiting-capture details remain readable with truthful neutral/status copy. No blanket success celebration.
- Unknown/wrong-owner detail renders the same safe unavailable/not-found experience, with Back to Orders. Network failure offers Retry; do not disclose ownership or offer futile retries for a confirmed 404.
- This is the durable management page, not a renamed Confirmation screen. Share snapshot primitives, formatters and safe projections rather than embedding the entire confirmation workflow.

## 13. Confirmation integration

Preserve 03.5/03.6 confirmation data, query ownership, payment-authoritative headings and current successful checkout/recovery routing. Modify only required presentation/navigation and directly affected shared behavior.

After the confirmation card's estimated-delivery/address section, render actions **outside the bordered card** in this order:

1. Primary, full-width **View Order Details** → `/orders/<persisted orderReference>`.
2. Outlined, full-width **Continue Shopping** → established shopping destination.

Both actions share the centered card's content width and align on both sides, with reference-consistent vertical gaps. They must not move inside the summary, float beside it or stretch to viewport width. Use the already-known public reference; no lookup merely to discover the created Order. Render only when the persisted reference is available. This navigation must never create/retry a purchase or change Cart/Inventory.

Audit related “View Order” consumers and distinguish payment-outcome notification flows from durable management links. Update genuine management links consistently; preserve intentional 03.6 confirmation/recovery routing and protected-workstream ownership.

## 14. Responsive, accessibility and interaction requirements

| Width | Required behavior |
| --- | --- |
| 390 | One readable column, existing mobile shell, wrapped title/reference/badges, touch-friendly links, stacked panels/actions, compact item rows that do not collide with amounts, no horizontal scroll. |
| 768 | Existing tablet gutters/breakpoints; deliberate stacking or supported grid based on available width. No squeezed desktop summary or clipped labels. |
| 1440 | Screenshot-aligned desktop hierarchy and details columns; stable history card metadata, generous but controlled whitespace. |
| 1920 | Match supplied desktop composition, content width/alignment and confirmation action placement; do not let sections become unrelated narrow islands or stretch without bounds. |

Use existing SCSS tokens and Task 01.5 responsive foundation, not new arbitrary breakpoint systems. Reuse Poppins, existing typography/spacing/radius/focus/border/color semantics; use existing data typography where established. Reference screenshots define visual proportions, not permission to hardcode sample content.

Use semantic headings, lists, time elements and links; one meaningful main landmark per routed view. Breadcrumbs have an accessible label, current item semantics and valid destinations. Keep visible focus, keyboard activation, adequate contrast and approximately 44px touch targets. Announce loading/error changes politely without every badge flooding a live region. Use informative image alt text only when the image conveys information not already adjacent; decorative previews may use empty alt.

Handle keyboard-only navigation, browser Back/Forward, refresh, rapid pagination, slow responses, abort on route/account change and auth expiry. Restore appropriate focus after route transitions/retry; do not repeatedly steal focus on background fetch. Respect reduced motion and do not require animation to understand status. Preserve readable content at 200% zoom. No unnecessary polling, motion, modal or sticky overlay; any enhancement must solve a concrete usability problem.

## 15. Async, auth and query-state matrix

| State | Required UI/data behavior |
| --- | --- |
| Session initializing | Existing verification/loading behavior; no premature empty page or private request. |
| Session verification unavailable | Retry session using established auth flow, no false sign-out or endless spinner. |
| Signed out | Existing sign-in UX with safe same-origin return to intended route; no private data flash. |
| Initial data load | Layout-appropriate skeleton/loader with accessible status; no false zero count. |
| Background refresh | Retain valid same-account data with subtle busy indicator; communicate refresh failure separately. |
| Successful empty | Centered empty panel only for zero total. |
| List/details error | Clear message, bounded retry, no raw backend details; avoid simultaneous contradictory empty/success/error claims. |
| Detail 404 | Safe unavailable state identical for unknown and non-owned Orders. |
| 401/session expiry | Existing auth handling, stop private reads and prevent stale account data exposure. |
| Account switch/logout | Cancel/ignore old responses; clear/isolate queries and placeholder data by user identity. |
| Long/missing content | Wrap safely, image fallback, omit nullable address/card fields, retain money alignment. |
| Pending/cancelled/refunded/legacy | Independent truthful badges and copy; no new financial action. |

Centralize management query keys and API types using existing conventions. Keys include authenticated user identity, reference or page/pageSize. Detail and confirmation caches must not be confused with incompatible DTOs. Retain established invalidation after purchase/status changes without redesigning payment recovery. Do not use a customer's cached page as placeholder data for a different account.

## 16. Storybook requirements

Use the actual production components, router/query/auth decorators or isolated presentation props consistent with existing stories. No alternate mock implementation that only looks correct in Storybook. Fixtures are synthetic and contain no real customer addresses/secrets.

Required coverage:

- History: loading, zero orders, one order, many orders/pagination, refresh failure, signed-out/session-unavailable views, long reference and multiple previews.
- Details: normal paid, all four canonical fulfillment labels, Cancelled, awaiting capture, pending/failed/refunded/legacy unprocessed, missing card/image, many items, long address, free/paid shipping, loading/error/not found.
- Shared badges: exact labels and accessible names, sizes where supported, unknown fallback where applicable; legacy consumers stay compatible.
- Confirmation: production paid composition and outside-card action placement, plus applicable non-paid states without false success wording.
- Responsive examples at 390/768/1440/1920 and keyboard/a11y checks. Add focused interaction coverage for navigation/retry/pagination where the existing Storybook tooling supports it.

Build Storybook and open the relevant stories. A successful build alone does not establish visual/a11y correctness.

## 17. Backend and integration verification

Use Vitest/Supertest and current repository patterns. Add meaningful tests for changed contracts, not tests that mirror implementation details without proving behavior.

| ID | Required evidence |
| --- | --- |
| B01 | Anonymous and wrong-role access rejected; CUSTOMER list/count/detail scoped to authenticated identity. |
| B02 | Customer A cannot read B's valid reference; missing and wrong-owner return indistinguishable 404; malformed reference handled safely. |
| B03 | Defaults/bounds/invalid/unknown pagination inputs; stable tie ordering; page metadata and empty/out-of-range behavior. |
| B04 | Snapshot DTO values unchanged after current product/address/delivery-price edits; Product deletion constraint preserved; missing image safely represented. |
| B05 | All Order statuses and Payment projections, including absent Payment and AWAITING_CAPTURE; safe nullable card/date fields; no invented paid/cancelled pairing. |
| B06 | Allowlist/redaction: no secrets/provider internals/request hashes/work metadata/raw failureReason in history/details responses. |
| B07 | Existing confirmation/attempt confirmation and rejected POST creation contracts preserved. Management GETs have no purchase/payment/cart/inventory writes or provider calls. |
| B08 | Decimal strings, zero shipping, quantity totals, date-only estimates and stable item ordering. |
| B09 | Bounded queries and no N+1 read expansion; use real query evidence when query shape changes materially. |

For materially changed Prisma queries, execute focused tests against an explicitly authorized isolated PostgreSQL target with two customer fixtures, equal-timestamp Orders and representative snapshot/payment states. Mock ownership assertions alone do not prove real database semantics. Respect the repository's environment gate; local disposable execution must be scoped/authorized, remote DEV requires separate approval, PROD is forbidden. If no authorized runtime is available, complete offline preparation and report the exact runtime gap rather than fabricate a pass.

No need to repeat the full 03.6 A–J financial/concurrency suite for a read/UI task. Reuse credible accepted evidence. If protected financial behavior changes, stop treating it as a read-only extension, obtain the scoped review and run the relevant additional regressions.

## 18. Frontend and browser verification

Use Vitest, Testing Library/user-event, existing mock patterns and Playwright. Required component/query tests cover independent status mappings, snapshots, money/date formatting, direct detail fetch, exact links, page state, retries, empty-vs-error distinction, session/account isolation, stale response races, image fallback and confirmation action placement structure.

Required real-browser scenarios:

| ID | Scenario |
| --- | --- |
| E01 | Header, footer and account Orders entry → history → details → Back to Orders; correct active navigation. |
| E02 | Direct owned details URL, refresh and browser Back/Forward without checkout state. |
| E03 | One/many orders, bounded pagination, rapid page changes and return to preserved history context. |
| E04 | Zero orders centered below heading; no empty state during loading, auth verification or request failure. |
| E05 | Two-account ownership and logout/account-switch isolation; safe not-found and sign-in return behavior. |
| E06 | All canonical fulfillment labels, cancellation, awaiting capture and payment variants, with independent badges. |
| E07 | Long full UUID reference, long names/address, many items, unavailable image, free/paid shipping and missing card metadata. |
| E08 | Slow network, failed initial read, failed refresh, retry and stale responses without misleading success or endless loading. |
| E09 | Confirmation primary CTA uses exact label, outside-card placement and persisted reference; Continue Shopping works; no new purchase/network mutation. |
| E10 | 390/768/1440/1920 layouts, keyboard focus/order, touch targets, reduced motion, zoom and no horizontal overflow. |
| E11 | Existing checkout/payment confirmation and saved-purchase navigation regressions for directly touched consumers; accepted two-state payment behavior remains intact. |

Use deterministic mocked reads for exhaustive visual states and clearly label them. Supplement with authorized real API/database ownership/read evidence; mocked screenshots do not prove integration or payment correctness. Use existing accepted checkout evidence where unaffected; no live charge or worker start merely to create a screenshot.

## 19. Screenshot capture AND opened inspection

Preserve reusable Playwright tests/scripts in the repository. Capture actual running app pages, not only Storybook renders or a static mockup. Wait for fonts/images/settled state and use deterministic fixture dates/content. Record browser, viewport dimensions, fixture mode, revision and source reference.

Minimum visual evidence:

| Screen/state | Required widths |
| --- | --- |
| Populated history | 390, 768, 1440, 1920 |
| Centered zero-order history | 390, 768, 1440, 1920 |
| Normal details | 390, 768, 1440, 1920 |
| Confirmation lower card/actions | 390, 768, 1440, 1920 |
| Long/many-item details and image fallback | 390 and 1920 |
| Loading, error/retry, unavailable detail and representative exceptional status | 390 and desktop; stories/tests cover the remaining permutations |

Capture full-page evidence plus focused crops where needed to compare card/action position. **Open and inspect every required capture.** Compare desktop against the three Make images; mobile/tablet against the documented responsive strategy, not an invented mobile reference.

Inspect hierarchy, gutters, container width, card proportions, borders, typography, badges, image size, amount alignment, breadcrumb/reference wrapping, empty-state centering, confirmation action order/width/outside-card placement, footer behavior, focus and absence of prototype controls. Fix material task-scoped differences and recapture affected states. Record filenames and concise findings in an evidence index.

The existing `npm run test:visual` script includes `--update-snapshots`. Do not use automatically updated baselines as proof of correctness. Inspect baseline changes explicitly and run comparison mode without update flags for regression verification (for example `npx playwright test -c playwright.config.ts <targeted-spec>` from frontend, using the installed package). Discover config/test paths before claiming a command is runnable.

If browser installation, fixtures or image access prevents verification, report **Visual QA: NOT VERIFIED**, exact cause and missing cases. Captured-but-unopened screenshots are incomplete evidence. Do not claim “matches Make,” “responsive verified” or “pixel-perfect” without actual inspection.

## 20. Performance, standards and quality gates

Preserve strict TypeScript and existing architectural separation. No unjustified `any`, duplicate status implementations, globally changed design primitives without consumer checks, broad formatting or speculative dependency additions. Reuse image optimization, tokens, error components, route lazy loading and API/query helpers where established.

History requests are bounded; details needs one owned API read, not a request per item. Bound preview rendering and avoid fetching current products for history. Existing detail/order item limits make virtualization unnecessary unless measured. Do not add provider calls, background workers, realtime subscriptions or aggressive polling. Preserve query cancellation and no-store semantics. If optimizing, show comparable before/after evidence; do not impose unrelated load benchmarks on a UI/read task.

Discover relevant engineering, architecture, feature and quality documents under the existing `docs/` hierarchy. Read only directly relevant material, including Orders/Checkout/Payment/Auth/API/security, SCSS/design/accessibility, testing and Git workflow. Inspect CI workflows for applicable local equivalents. Existing script declarations include:

```text
# Repository root
npm run typecheck
npm run lint
npm run build

# Focused test selection using actual added/affected files
npm run test --workspace=apps/backend -- <test-paths>
npm run test --workspace=apps/frontend -- <test-paths>
npm run build-storybook --workspace=apps/frontend

# Frontend working directory: inspect config first; comparison mode, no baseline update
npx playwright test -c playwright.config.ts <targeted-spec>

# Final diff hygiene in the verified worktree
git diff --check
```

These are execution guidance, not results. Check tests/config/environment loading before invoking broad suites: some backend scripts include integration tests, and runtime commands can start services with external credentials. Use the established isolated stack and explicit safe environment rather than defaulting to `.env` targets. Report actual commands, exit codes, counts and scope; do not hide failures or call partial tests a full suite. Once required checks pass, rerun only when new changes or risks justify it.

## 21. Documentation and handoff deliverables

Update existing relevant feature/API/design/testing documentation; avoid a competing hierarchy. At minimum deliver:

- Order Management behavior and routes, snapshot fields and pagination contract.
- Canonical fulfillment/payment mapping, awaiting capture, legacy unprocessed behavior and no customer mutations.
- API DTO/error/nullability examples, ownership/no-store/redaction rules and compatibility decisions.
- Related-file manifest and screenshot approved/refinement/future matrix.
- Explicit database decision (expected no migration), protected-change coordination where applicable, and Update 8 baseline reference.
- Storybook inventory, reusable tests/browser scripts, captured-and-inspected screenshot index and responsive/a11y results.
- `docs/tasks/Phase-03/TASK_03.7_IMPLEMENTATION_EVIDENCE.md` with requirement traceability, actual checks and limitations.
- Handoff to 03.8/03.9/Phase 04/05: existing Order/public-reference/ownership/snapshot contracts to reuse; no implemented email/PDF/tracking/admin claims.

Do not edit 03.5/03.6 closure status or append unrelated payment remediation. Report a concrete discovered regression separately with evidence; fix only an authorized direct integration defect.

## 22. Acceptance and requirement traceability

For every row provide implementation paths, tests/evidence and PASS / FAIL / NOT VERIFIED / NOT APPLICABLE with justification. Do not mark an unmet requirement PASS based on intent.

| ID | Acceptance criterion |
| --- | --- |
| R01 | Verified base/branch, preserved shared work, root coordination and protected-file ownership respected. |
| R02 | Existing 03.5/03.6 creation/payment/core contracts reused; no duplicate architecture or financial side effects. |
| R03 | Bounded newest-first owned history with total count, stable ordering and complete pagination states. |
| R04 | Dedicated secure details API/route supports direct entry, refresh and indistinguishable missing/wrong-owner results. |
| R05 | Immutable item/address/delivery/money snapshots remain authoritative after current catalog/profile changes. |
| R06 | Exact four fulfillment labels plus Cancelled; internal awaiting-capture handled truthfully without expanding the normal lifecycle. |
| R07 | Independent truthful payment mapping, legacy absence, safe masked metadata and unknown fallback. |
| R08 | Make history/details composition, current shell, canonical navigation and no unsupported prototype features. |
| R09 | View Order Details exact text/reference/link; primary and secondary actions outside confirmation card with aligned width. |
| R10 | Successful zero-order empty state centered; errors/auth/loading never masquerade as empty. |
| R11 | Responsive 390/768/1440/1920 and long/missing/many-item content verified. |
| R12 | Keyboard, focus, semantics, contrast, reduced motion and zoom behavior checked. |
| R13 | Account-scoped cache, logout/switch isolation, stale-response handling and no private data leakage. |
| R14 | Production-component Storybook states built and inspected. |
| R15 | Focused API/service/component tests and risk-appropriate real database/read integration evidence. |
| R16 | Playwright/browser scenarios, required captures opened and inspected; material visual defects corrected. |
| R17 | Typecheck/lint/build/diff hygiene and affected regression gates passed or explicitly reported as blocking. |
| R18 | Database decision, API/features/QA docs and future task handoffs complete. |
| R19 | No PROD mutation, unsafe DEV execution, secret exposure, commit, push, merge, CI trigger or deployment. |
| R20 | Changed-file full review, score/100, explicit architect verdict and residual-risk record. |

## 23. Review, score and stopping rule

Before handoff, inspect every changed file and relevant surrounding code, not only the generated diff summary. Check requirement coverage, authorization, DTO leakage, status semantics, snapshot integrity, API compatibility, query bounds, UI states, shared-component regressions and documentation accuracy.

The Principal Architect reads the task and implementation report, reviews actual changes and credible QA evidence, and scores out of 100 using root coordination categories: correctness 20, security 20, architecture/compatibility 15, concurrency/database safety 15, tests/evidence 15, performance/reliability 10, documentation/operations 5.

- **✅ Approve:** acceptance criteria and required checks met; no material blocker; residual risks documented.
- **⚠ Request Changes:** actionable defects or material verification gaps; no merge.
- **❌ Reject:** fundamentally unsafe design, financial/ownership violation or unauthorized operation.

Unresolved P0/P1 blocks approval regardless of score. Optional improvements are labeled separately and do not create endless review loops. Reuse credible existing 03.5/03.6 evidence; do not demand exhaustive reruns without a concrete risk. Implementation self-review is not independent architect approval, and approval is not release authorization.

### Required final implementation report

```text
TASK / WORKSTREAM / OWNER:
STATUS (implementation / review / integration / release separately):
BASE SHA / CURRENT SHA / BRANCH / WORKTREE STATUS:
SUMMARY AND EXACT CHANGED FILES:
REQUIREMENTS MET / UNMET (R01–R20):
RELATED-FILE AND APPROVED/REFINEMENT/FUTURE MATRICES:
API / SNAPSHOT / STATE / CACHE DECISIONS:
SECURITY AND OWNERSHIP EVIDENCE:
DATABASE DECISION / NO-PROD-MUTATION CONFIRMATION:
PROTECTED-FILE CCRS / APPROVAL REFERENCES:
TEST COMMANDS / COUNTS / EXIT CODES:
STORYBOOK / BROWSER / RESPONSIVE / ACCESSIBILITY:
SCREENSHOT PATHS / SOURCES / OPENED INSPECTION / FIXES:
EXTERNAL EVIDENCE (VERIFIED / PARTIALLY VERIFIED / NOT VERIFIED):
DOCUMENTATION AND FUTURE HANDOFFS:
ACTIONABLE BLOCKERS / OPTIONAL IMPROVEMENTS / RESIDUAL RISKS:
ARCHITECT SCORE /100 AND VERDICT (when independently reviewed):
NO COMMIT / PUSH / MERGE / CI TRIGGER / DEPLOYMENT:
```

Permanent execution flow: inspect repository and screenshots → establish safe branch/ownership → bounded plan and visual classification → extend existing reads/UI → focused tests → authorized integration verification → Storybook/browser QA → capture and OPEN screenshots → fix concrete defects → review all changed files → update evidence/docs → architect review → stop before commit/push/merge/deployment.
