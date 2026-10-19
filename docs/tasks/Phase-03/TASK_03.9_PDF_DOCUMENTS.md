# ELECTROHUB — TASK 03.9 / PDF DOCUMENTS

**Phase:** 03 — Commerce\
**Task:** 03.9 — Secure branded order and payment PDF documents\
**Branch:** `feature/PDF-Documents`\
**Base / integration target:** approved `develop`, subject to independent review and separate integration authorization\
**Prepared:** 2026-10-19, Asia/Beirut\
**Inspected baseline:** `510b41cd4da7f0260e711df0db099148060b6c97` (develop; merge of PR #31, Email Notifications)\
**Location:** `docs/tasks/Phase-03/TASK_03.9_PDF_DOCUMENTS.md`\
**Scope:** Specification covering backend, customer APIs/DTOs, database decision, PDF rendering, frontend UX, optional Brevo attachments, security, deployment packaging, tests, physical PDF/browser inspection, evidence and architect approval.\
**Status:** SPECIFICATION COMPLETE; implementation and runtime acceptance NOT VERIFIED. This document does not implement Task 03.9.\
**Execution boundary:** The present assignment authorizes repository inspection, a local feature branch and this specification only. No application implementation, database write, migration execution, live send, worker activation, commit, push, merge, CI trigger or deployment. Later implementation and operational actions require their applicable authorization; do not ask again for exact actions already authorized.

> **Outcome:** A signed-in customer can view and download an accurate, beautifully branded, selectable-text Order invoice/commercial statement, verified Payment receipt and Order Summary from Confirmation, My Orders and Order Details. Documents read committed facts; they never create another purchase, charge, refund, inventory change or email. The first implementation handoff must include working secure downloads, polished responsive states, opened PDFs, inspected screenshots and sufficient risk-based evidence.

## Task-specific visual / UX invariants — read first

1. Preserve Header, Footer, lightning-logo identity, checkout success hierarchy, order badges, details columns, breadcrumbs and back-navigation. No redesign, notification center, new checkout flow or admin document dashboard.
2. Reuse actual SCSS tokens: primary `#2563EB`, hover `#1D4ED8`, white / `#F8FAFC` surfaces, `#0F172A` text, `#475569` secondary text, `#E2E8F0` borders, Poppins, JetBrains Mono where appropriate and 4px spacing. Current card/control radius tokens are **0**. Do not introduce rounded template cards or another CSS framework.
3. Confirmation: one compact **Your documents** section after the existing order summary and transient email notice, before existing outside-card navigation. Align to the same width. Keep **View Order Details** primary and **Continue Shopping** secondary, outside the summary card. Documents never delay the authoritative purchase-success screen.
4. Order Details: one durable **Documents** section in the aside immediately after **Order Summary** and before **Back to Orders**. In the existing single-column layout it follows the existing main content and summary. Do not move or duplicate the email notice above the details grid.
5. My Orders: one secondary **Documents** action in each order card footer, after metadata and before the chevron. Open a lightweight accessible document chooser; do not add three large download buttons per card. Existing full-card link overlay must not intercept this action. No nested button inside anchor.
6. All three entries have a name, one-line purpose, availability reason and distinct **View PDF** / **Download PDF** actions when eligible. Use the semantic label returned by the API: the default invoice entry is **Order invoice (non-tax)**, PDF title **Order invoice — commercial transaction statement**. Never silently present a non-tax statement as a legal tax invoice.
7. Loading belongs to the document panel or selected action. Keep other order content and navigation usable. No whole-page spinner for generation, false empty state, false percentage, fake wait or success toast claiming a file was saved to disk.
8. View opens an app-controlled preview dialog containing the actual returned PDF, not a screenshot/mock invoice. Include title, close, download, loading/error and a browser-preview-unavailable fallback. Preview cleanup on logout/account switch is mandatory. A downloaded file cannot be remotely revoked; do not promise that.
9. PDFs share one restrained print-safe blue/white design, embedded fonts, selectable/searchable text, strong hierarchy, readable monochrome output, repeated table headers and page numbers. Financial values and full references must never be clipped, ellipsized, rasterized or hidden by a footer.
10. Verify application layouts at 390/768/1440/1920px plus 320px stress and 200% zoom. Long references, long addresses and large amounts must wrap without horizontal page overflow. Mobile actions stack and maintain practical 44px touch targets; dialogs keep close/download reachable.
11. Use real Radix/shared primitives, Lucide icons, visible focus, semantic headings, descriptive action names including document/order context, keyboard operation, focus restoration, text plus icons, reduced motion and restrained live announcements.
12. Capture **and open** screenshots and actual PDFs. A green test, Storybook render, `%PDF` prefix or generated file alone is not visual approval. Browser PDF preview, desktop PDF reader and print-layout evidence are distinct gates.
 
## Task-specific unit / domain invariants — read first

| ID | Non-negotiable invariant |
| --- | --- |
| U01 | Every metadata/preview/download request authenticates, authorizes CUSTOMER and loads the Order with both authenticated `userId` and parsed Order ID. Wrong owner and missing Order return the same 404. |
| U02 | `Order.status = CONFIRMED`, a frontend `PAID` label, a redirect, an email acceptance or a client-submitted amount alone never proves payment. Use persisted Payment facts and consistency checks in §4. |
| U03 | All document operations are reads plus bounded rendering. Zero calls to payment processing/recovery, capture/refund, checkout mutation, inventory, cart mutation, outbox insertion or mail transport. |
| U04 | Product/profile/address-book changes never replace historical Order/OrderItem facts. Money stays Decimal / exact decimal strings; no binary floating-point financial arithmetic. |
| U05 | Missing or contradictory payment evidence fails closed for invoice/receipt. It does not create dates, masked card digits, taxes, seller registration, refund amount or invoice numbers. |
| U06 | Same canonical facts + document/snapshot/template/font/seller-profile versions produce the same content and stable content version; pinned renderer inputs must produce repeatable bytes. Wall-clock generation time is not an issuance date. |
| U07 | A refund preserves original paid amount/date when those are proven, while current-state disclosure changes visibly. Cancellation is never equated with refund. No unsupported partial-refund arithmetic. |
| U08 | Renderer consumes a validated allowlisted model, never raw Prisma rows, HTML from customers, arbitrary URLs, filenames or font paths. |
| U09 | Listing never renders PDFs; renderer failure cannot break the Order screen. Binary errors are parsed as errors, never downloaded as `.pdf`. |
| U10 | Abort, logout, account switch, route change and stale responses cannot reveal another account's preview or initiate a late download. Blob URLs and private in-memory buffers have bounded lifetimes. |
| U11 | Byte/page/item/time/concurrency bounds apply before and during rendering. A Promise timeout without stopping CPU work is not sufficient cancellation. |
| U12 | Optional attachments preserve immutable event facts, leases, STARTED-before-send journal and UNCERTAIN semantics. Already accepted/uncertain events are never replayed to add attachments. |

## 1. Authority, inspection and source decisions

Explicit current task requirements take precedence, followed by actual implementation/tests, repository architecture and relevant design evidence. Read root `AGENTS.md`, `AGENT_COORDINATION.md`, current `docs/prompts/DEVELOPER_PROMPT.md` and the fixed frontend visual prompt supplied with this project. Scope review to changed files and direct dependencies; older architecture summaries may describe earlier phases and must not override current code.

### 1.1 Verified repository baseline

The GitHub connector resolved `develop` to the SHA above and its merge commit for PR #31. Source files were read at that immutable SHA, not inferred from the previous conversation. A local sparse checkout was created on `feature/PDF-Documents` from the same commit for this spec. Full clone asset downloads stalled; repository inspection used GitHub reads. The sparse checkout is not evidence of a runnable installed development environment. No existing user checkout or unrelated working changes were replaced.

| Inspected source | Verified fact and consequence |
| --- | --- |
| Root agent / coordination files | Protected owners and CCRs govern auth, shared API client, schema/generator, payment services, connection settings and release. Implementation-complete, approved, integrated and released are separate states. |
| `docs/tasks/Phase-03/TASK_03.7_ORDER_MANAGEMENT.md`, `TASK_03.8_EMAIL_NOTIFICATIONS.md` | Follow the established uppercase title, metadata block, up-front invariants, numbered contracts, source decisions, ownership, verification, traceability, scoring and stopping rules. Current repo versions have implementation status updates; local project copies are older references. |
| `docs/03_Architecture/{SYSTEM,BACKEND,DATABASE,FRONTEND,DEPLOYMENT}_ARCHITECTURE.md` | Express owns security/business reads and PDFs; Prisma owns database access/migrations; React Query/SCSS/Radix own customer UI; Docker/Node backend packaging. No frontend database/PDF authority or separate PDF microservice. |
| `apps/backend/prisma/schema.prisma` | Order has Decimal(12,2) totals, saved shipping/delivery facts and unique owner/checkout attempt; OrderItem has saved name/SKU/unit price/quantity/line total; Payment is unique per Order with amount/currency/status/paidAt/card/refundedAt. No document issuance model, tax lines, legal seller identity, billing address or legal invoice sequence. |
| `apps/backend/prisma/migrations/` | 20 migration directories at baseline. Relevant SQL: checkout core (20261006), Stripe orchestration (20261007), purchase ownership (20261012) and commerce email outbox (20261018). No PDF migration. Reviewed checkout/payment CHECKs do not prove every cross-row sum or immutable issued document. Validate document invariants explicitly. |
| `docs/06_Database/MIGRATIONS.md` | Prisma ledger is `_prisma_migrations`. Historical BOM/CRLF checksum differences and existing physical defaults are documented. Do not normalize old migration bytes, rewrite ledger or apply an unreviewed global schema diff. |
| `apps/backend/src/services/order.service.ts` | `parseOrderReference` supports `ORD-UUID` and legacy bare UUID, normalizes ID; details use `findFirst({where:{id,userId}})`. Items sorted by createdAt then ID. Existing DTOs expose exact decimal strings and allowlisted payment dates. `PAID` is a customer projection of Payment `SUCCEEDED`. |
| `apps/backend/src/services/payment.service.ts` | `markPaid` verifies provider binding/received amount, writes Payment SUCCEEDED + Order CONFIRMED + Attempt PAID in a fenced transaction, preserving first paidAt on replay. Compensation can produce REFUNDED without prior normal finalization; therefore REFUNDED alone cannot establish original purchase payment/date. Do not call this service from document GETs. |
| `apps/backend/src/routes/checkout.routes.ts`, `middleware/auth.ts` | Existing order routes require bearer JWT and CUSTOMER role; auth reads active user and current role. Ownership resides in services. Shared auth errors may be string-shaped. Do not replace auth with assumed cookie-only download links. |
| `apps/backend/src/services/commerce-email.{domain,producer,dispatcher}.ts` | Versioned event snapshots, validated decimal strings, 100-item email bound, immutable event identity, lease fencing, STARTED journal, bounded retry and UNCERTAIN quarantine. Snapshot v1 invoice-like event contains items/address; payment event contains paidAt/amount/card, not full invoice facts. |
| `apps/backend/prisma/migrations/20261018000000_commerce_email_outbox/migration.sql` | Payload/identity immutability trigger, one-way purge, terminal-state protections, counters/lease constraints, 256KiB snapshot bound, RLS and public-role revocation. Existing snapshots cannot be edited to add attachments. |
| `apps/backend/src/integrations/brevo/brevo.{types,client}.ts` | Existing REST send integration and structured sanitized failures. Current payload/options have **no attachment property**. Preserve OTP callers and transport classification through an additive extension only. |
| `apps/frontend/src/lib/api.ts`, `lib/query.ts` | Access token held in module memory; shared client adds bearer auth, coordinates bounded refresh and parses JSON. It cannot currently consume successful PDFs. Account-scoped order query keys already exist. A binary client extension is a protected shared-consumer change, not an independent fetch/token store. |
| Confirmation / `CheckoutComponents.tsx` | `ConfirmationContent` owns summary and outside-card actions; `ConfirmationPage` loads persisted order. Transient email notice and bounded email-status refetch exist. Add documents here without replacing payment or email logic. |
| `OrderDetailsPage.tsx`, `pages/customer/OrdersPage.tsx` | Details main/aside layout and durable owned reads exist. History card's single anchor uses `::after` as a stretched full-card target; adding a document button requires intentional click isolation and updated accessibility assertions. |
| `features/orders/Orders.stories.tsx`, `.storybook/` | Real providers/pages with scoped network stubs; Storybook 9 and a11y addon. Restore fetch stubs and clear test identity/query state between stories. |
| `playwright.orders.config.ts`, `tests/orders/orders.spec.ts` | Owned production-preview server on 3137, deterministic intercepted reads, viewport captures, axe-core and keyboard/zoom tests. These are mocked UI evidence, not real DB proof. Existing `test:visual` updates baselines: do not invoke blindly for comparison. |
| `routes/orders.management.test.ts`, `services/__tests__/orders.management.live.test.ts`, backend Vitest config | Supertest with real route/auth and mocked persistence; opt-in real PostgreSQL/DEV test with explicit safety gates. Reuse conventions without accidentally enabling remote fixture writes. |
| Root/backend/frontend package files, backend Dockerfile | Node 20.11.0 / npm 10.2.4 declared, Express 4, Prisma 6.12 range, Vitest/Supertest/Playwright present; no declared backend PDF library. Docker runtime copies dist/prisma/package files, not arbitrary source assets. Add explicit PDF asset packaging when implementing. |
| SCSS variables / repository tree | Existing palette, zero radius and 640/768/1024/1280/1536 breakpoints. No bundled TTF/OTF/WOFF asset path was found in the inspected tree; CSS font declarations do not provide backend font files. |

Backend source paths below are relative to `apps/backend/` unless explicitly qualified. Proposed new filenames, DTOs and limits are requirements, not assertions that implementation already exists.

### 1.2 Uploaded references and limits

The requested `/mnt/data` paths are not mounted in this Windows session. The referenced chat's attachment records exposed local previews with the exact filenames; those were read:

- `ROADMAP.md`: 03.9 backend invoice/receipt/downloads and optional attachments; no new payment or admin scope.
- `schema.prisma`: snapshot upload SHA-256 `2a21b659ac96c18c28a1477f8efa6c9f62929dbf8aaf78ae32665adbc23032b4`. Its text matches the pinned repository schema after CRLF/LF and trailing-newline normalization. This is a source comparison, **not physical database verification**.
- `Pasted text(20261019-152734).txt`: substantive prior design, three documents, frontend placements, on-demand default, conditional issuance metadata, security, email retry constraints and complete QA. Its sample money, addresses, images and interactive controls are illustrative, not current seller facts or completed software.
- Project `sources/FIXED_FRONTEND_UI_UX_VISUAL_DEVELOPER_PROMPT.md` and `sources/DEVELOPER_PROMPT.md` were inspected as supplied fixed prompts. No file with the fixed frontend prompt name appears in the pinned repo tree. Preserve the supplied prompt as supporting authority; do not claim it is a current tracked repo file.

The bounded referenced chat was read; assistant artifacts are content-reference placeholders, not fully retrievable prior answers. No hidden discussion is claimed inspected. Prior reports of DEV/PROD migration/mailbox tests are historical reports, not fresh runtime evidence here. No live database, mailbox, Stripe, application, Figma frame or rendered PDF was tested for this specification. Visual and runtime compliance remain NOT VERIFIED.

### 1.3 Explicit source resolutions

1. The uploaded design suggests existing cookie/session auth; current code requires bearer auth. Use the current client/auth contract in §8.
2. The uploaded summary suggests summaries only for confirmed purchases. This task explicitly chooses a safe broader read: any persisted owned Order with valid snapshot facts may get an Order Summary clearly labeled with its actual unpaid/cancelled/refunded state. Uncommitted attempts/drafts have no Order document. Invoice/receipt remain gated by proven payment.
3. No uploaded legal seller/jurisdiction/tax authority is available. Default to the non-tax commercial statement policy in §5; do not invent a VAT rate, VAT exemption, registration number, legal sequence or tax compliance claim.
4. Current schema supports reproducible commercial renderings from purchase snapshots but does not prove legal issuance/retention. On-demand mode is selected; persistence is conditional, with precise escalation triggers in §6.
5. Optional attachments are a separately gated second stage and may be explicitly deferred with defaults off. Their deferral does not excuse missing required customer documents.

## 2. Objective, scope and boundaries

### Required

- Three distinct real PDFs through one shared backend rendering system: itemized invoice/commercial statement, verified payment receipt, current-state Order Summary.
- Secure owner-scoped listing, preview and download with additive DTOs, strict input validation, safe filenames, private no-store and bounded generation.
- Snapshot-based exact financial data; deterministic versioned rendering; truthful legacy/refund/cancellation treatment; explicit legal/issuance decision.
- Integrated customer controls on all three existing screens, responsive accessible preview/download and full async/auth lifecycle handling.
- Packaged fonts/assets, deployment smoke plan, unit/API/PostgreSQL/UI tests, real PDF opens/text extraction and concise evidence.
- Independent architectural review with score /100 and explicit verdict.

### Optional second stage

One invoice attachment on future ORDER_CONFIRMED events and one receipt attachment on future PAYMENT_CONFIRMED events through the existing Brevo path, after mandatory downloads pass. Default off; exact versions and fallback behavior documented. No attachment-only email event.

### Excluded

Tax engine, legal certification, e-invoicing authority integration, credit-note/refund-receipt workflow, admin document editor, new payment capture/refund logic, order mutation, inventory/cart changes, public sharing links, permanent public file storage, customer upload-to-PDF, arbitrary HTML conversion, payment-provider invoice APIs, tracking maps, broad auth/Prisma modernization, re-running unrelated audits and production activation.

03.5 owns snapshots/order creation; 03.6 owns money and recovery; 03.7 owns customer order reads; 03.8 owns event production and delivery. 03.9 consumes their committed facts. The AI service, browser, Brevo and PDF renderer are never financial authorities.

## 3. Start-of-implementation declaration and ownership

Before later implementation, synchronize approved develop, record exact base/head/status and inspect applicable instructions/active ownership. Create or reuse `feature/PDF-Documents` safely. Do not reset, stash, rebase, merge or overwrite unrelated work merely to make the tree clean. If develop advanced, review only relevant delta and update this source ledger; do not silently implement against the old baseline.

Record task/workstream/owner, acceptance IDs, exact related-file manifest, protected files/CCRs, proposed library version/license, testing environments, current legal mode and optional-attachment decision. One owner per shared file. Parallel agents are not required.

| Layer | Expected existing touchpoints / proposed additions | Ownership |
| --- | --- | --- |
| Domain and reads | Proposed `services/order-document.domain.ts`, `order-document.service.ts`, `validators/order-document.validator.ts` | Backend; injected Prisma reader and pure eligibility/model functions. Reuse public reference parser; no import of payment processing. |
| PDF | Proposed `documents/{pdf-renderer,document-layout,invoice,receipt,order-summary}.ts` and trusted `documents/assets/` | Backend; pure model-to-bytes boundary, worker isolation and resource bounds. |
| API | Proposed `routes/order-document.routes.ts`, register through existing `routes/index.ts` (mounted by `app.ts`); existing AppError/auth primitives | Backend; preserve route specificity, old endpoints and OpenAPI conventions. |
| Browser data | `apps/frontend/src/lib/api.ts`, `lib/query.ts`, proposed document types/client hook | FRONTEND + AUTH/affected API consumers + Architect CCR for binary extension. No exposed access-token getter or duplicate refresh manager. |
| UI | `CheckoutComponents.tsx`, `ConfirmationPage.tsx` if needed, `OrderDetailsPage.tsx`, `OrdersPage.tsx`, their modules; proposed `OrderDocuments` / chooser / preview components | FRONTEND; narrow additions and overlay fix. Shared primitive changes need affected-consumer review. |
| Packaging | Backend package manifest, root lockfile, asset-copy build step and Dockerfile | Backend/INTEGRATION; pin evaluated PDF dependency, font licenses/checksums; no unrelated upgrades. |
| Optional attachments | Commerce dispatcher/runtime, Brevo types/client/provider, future event descriptor/version if needed | EMAIL + affected PAYMENT owner for any producer touch; no silent edit to protected payment hooks. |
| Database | Expected **no schema/migration edit** | DATABASE + Architect CCR only after §6 need demonstrated. |
| Evidence/docs | New task evidence, API/feature/runbook notes, focused tests/stories | Respective owner; synthetic artifacts only, no secrets/customer documents. |

No new Prisma version, generator flag, pool, transaction timeout, global security middleware policy, CartProvider change or checkout/recovery rewrite is justified by basic PDFs. Use the root CCR format for a necessary exception, with evidence and exact consumers. Preparing this specification does not authorize those edits.

## 4. Document authority and eligibility

### 4.1 Canonical facts and qualification

`PAID` is the UI projection; persisted Payment status is `SUCCEEDED`. Fulfillment CONFIRMED/PREPARING/OUT_FOR_DELIVERY/DELIVERED is independent. Establish one domain eligibility function used by listing, rendering and optional attachment mapping; never duplicate weaker frontend rules.

**Valid order snapshot (V):** owned persisted Order, supported currency, valid finite nonnegative decimal totals, 1–100 bounded historical item lines, positive integer quantities within supported limits, valid required address/date fields, and exact arithmetic reconciliation. Schema existence alone does not prove V. Current checkout has `MAX_CART_LINES = 50`, quantity max 999; 100 is a deliberate document-only historical safety ceiling, not permission to increase checkout limits.

**Verified original payment (P):** Payment belongs to the Order; status SUCCEEDED, or REFUNDED with retained original-success evidence; non-null valid `paidAt`; positive amount matching Order total and currency; recorded provider binding for the existing Stripe flow. If a linked PaymentAttempt exists, require matching owner/order/provider identity, amount/currency and compatible state. Normal success expects PAID; proven refund can have later refund state. Do not require current PAID on an already refunded purchase, and do not ignore an INCIDENT/contradictory attempt. Missing old attempt alone is not disqualifying when the authoritative Payment record contains complete trusted success facts; document that legacy path and test it. An Order with no Payment is never treated as paid.

The reader may select PaymentAttempt identity/amount/refund facts for validation, but never serializes secrets, raw request, client secret, provider IDs or work state. It never calls Stripe to fill gaps and never repairs missing paidAt. `paidAt` is the application's persisted payment confirmation time; do not relabel it as an exact bank settlement timestamp.

### 4.2 Required eligibility matrix

| Stored situation | Invoice/commercial statement | Payment receipt | Order Summary |
| --- | --- | --- | --- |
| V + P; CONFIRMED, PREPARING, OUT_FOR_DELIVERY or DELIVERED | Available, original purchased items/totals | Available, original successful payment facts | Available, actual independent fulfillment/payment state |
| AWAITING_CAPTURE; Payment PENDING/PROCESSING; authorization only | Unavailable: PAYMENT_NOT_CONFIRMED | Unavailable: PAYMENT_NOT_CONFIRMED | Available if V; “Payment pending — not proof of payment” |
| Legacy CONFIRMED with no Payment / UNPROCESSED | Unavailable: PAYMENT_NOT_CONFIRMED | Unavailable: PAYMENT_NOT_CONFIRMED | Available if V; “Payment not recorded” |
| Payment FAILED / declined; cancelled before successful payment | Unavailable: PAYMENT_NOT_CONFIRMED | Unavailable: PAYMENT_NOT_CONFIRMED | Available if V; actual cancelled/failed labels; no paid stamp |
| CANCELLED + P + no proven refund | Historical commercial statement available; visible cancellation note | Historical receipt available; “Original payment”; cancellation is not refund | Available; separately state cancellation and recorded payment |
| REFUNDED + retained P + valid refundedAt | Historical statement available; visible refund note separate from original totals | Original receipt available with “Payment subsequently refunded”; original amount/date preserved | Available with current refunded state; exact refund amount only if verified bound refund facts exist |
| REFUNDED but paidAt absent / unexpected-capture compensation without normal success evidence | Unavailable: HISTORICAL_PAYMENT_UNVERIFIED | Unavailable: HISTORICAL_PAYMENT_UNVERIFIED | Available if V, showing recorded refund state without asserting an original invoice/receipt |
| SUCCEEDED but missing paidAt, amount/currency mismatch, contradictory attempt, invalid dates | Unavailable: DATA_INCOMPLETE or DATA_INCONSISTENT | Same | Only available if independent order snapshot is valid; warn payment details unavailable, never assert paid proof |
| Empty/malformed/oversized Order snapshot | Unavailable with stable safe reason | Unavailable; do not bypass a contradictory/incomplete purchase snapshot to issue payment proof in this baseline | Unavailable with safe reason; ordinary order UI remains readable |
| No committed Order; wrong owner; deleted/non-active account | No document | No document | No document; authentication/404 rules apply |

Do not mint an unpaid pro forma under the receipt/invoice route. Pro forma is a pre-payment offer/estimate concept and would need its own approved issuance semantics. For this scope, pending orders use the clearly labeled summary.

### 4.3 Refund and race semantics

RefundedAt is a timestamp, not a refund amount. Payment.amount is the original amount, not net paid. PaymentAttempt.refundAmountCents is usable only with matching order/provider/refund identity and persisted successful refund outcome. Otherwise display “Refund recorded” with date and omit amount. Never infer full refund solely from the REFUNDED enum or invent partial-refund support. Do not net refunds into original invoice rows or turn a receipt into a credit note.

Read one coherent view of Order/items/Payment/needed Attempt. Prefer one joined Prisma read with explicit select and proven query behavior; if multiple SQL reads are necessary, use a short read-only Repeatable Read snapshot with no lock escalation and no rendering inside it. Do not change global Prisma relation strategy. A concurrent refund yields either coherent pre-refund or coherent post-refund facts, never a mixed amount/status/date. Listing is advisory: reauthorize and re-evaluate on every file GET. If content changed after listing, the file response uses the current coherent version, and the UI refreshes metadata.

## 5. Legal naming, seller identity and issuance policy

### 5.1 Selected default: commercial documents, not legal tax issuance

Default `documentPolicy = COMMERCIAL_V1`. The invoice route fulfills the itemized purchase-document use case with the title **Order invoice — commercial transaction statement** and a prominent restrained line **Not a tax invoice**. UI label is **Order invoice (non-tax)**. This is an explicit product decision grounded in absent legal fields; do not merely hide a disclaimer in tiny footer text.

Use ElectroHub brand identity without inventing a registered seller entity/address/phone/tax number or support contact. Recipient shipping facts are labeled **Ship to**, never **Bill to** unless an authoritative billing snapshot is later added. Show only subtotal, shipping and total currently stored. Absence of tax data means **tax details not recorded**, not “0% VAT”, “tax exempt”, “VAT included”, “tax paid” or “tax compliant”. Do not add a fictional tax row or recompute the transaction using a current tax rate.

Receipt title **Payment receipt** describes recorded successful payment, not a bank certificate. If execution is known to be test-only, put **TEST TRANSACTION — no live payment** visibly on all outputs. The current Payment model does not persist test/live mode; do not infer historical mode from today's API key or provider ID shape. The existing project is test-mode commerce: keep that deployment assumption explicit. Mixed/live rollout requires reliable per-record provenance or a reviewed migration; it cannot silently remove a historical test label.

The Order reference and an optional deterministic document reference are **references**, not legally sequential invoice numbers. Display purchase date from Order.createdAt and payment confirmation date from Payment.paidAt, distinctly. Do not display request time as “Issued on”. Default renderings are downloadable views, not evidence a legally immutable invoice was issued.

### 5.2 Legal invoice activation gate

If the owner requires a legal/tax invoice, pause that mode and obtain verified business requirements from the responsible seller/accounting authority for the actual jurisdiction. Required decisions include seller legal name/address/registration, tax registration and applicable tax treatment, customer billing requirements, currency/rounding rules, supply/tax/issuance dates, invoice sequence scope/reset/gap rules, cancellation/correction/credit notes, language, retention, and any e-invoice/signature requirements. No jurisdiction is assumed from the developer's location.

Legal requirements must be reviewed against current authoritative local guidance after jurisdiction is known. This spec makes no legal compliance claim and prescribes no VAT law. Record the approved policy/version and evidence, then assess persistence under §6.2. Changing an environment flag alone must never transform commercial PDFs into legal invoices.

### 5.3 Required content by document

| Document | Required content | Must not imply |
| --- | --- | --- |
| Invoice/commercial statement | Brand/title/non-tax qualifier; full order reference; purchase date; snapshot ship-to; item name + SKU, quantity, unit price, line amount; subtotal/shipping/total/currency; original payment indication when P; separate current cancellation/refund note; document/template version | Legal tax number, billing identity, unrecorded discount/tax, amount currently due after refund, new payment request |
| Payment receipt | Brand/title; order reference; deterministic receipt reference derived from internal payment identity; original amount/currency; recorded paidAt with timezone; payment method; validated brand + last4 if present; current refund/cancellation disclosure | Full card/PAN/CVC/expiry, provider secrets/IDs, paidAt invented from createdAt, exact bank settlement time, original order total substituted for a different payment amount |
| Order Summary | Brand/title; “Order record — not an invoice or proof of payment”; order reference/date; saved items/amounts/address/delivery method/estimate; actual independent fulfillment and payment labels; current-state date/source revision | Successful payment for legacy/pending/failed records, invoice issuance, guaranteed delivery date or live tracking |

Receipt omits shipping phone/address unless a documented customer need justifies inclusion. All documents omit current account email and unnecessary personal data. Missing card metadata renders “Card payment” without placeholder digits. Null optional address parts disappear cleanly.

## 6. Database decision, snapshot precision and deterministic versions

### 6.1 Required baseline: on demand, no mandatory migration

Use existing Order, OrderItem and Payment/necessary Attempt facts; render into bounded memory after the database read ends. Do not persist PDF binary/base64 in PostgreSQL, use outbox as a document registry, add storage buckets, or create a generic document table just because a PDF exists.

Grounding: item price/name/SKU and shipping fields are already purchase snapshots; payment dates/card facts are persisted; basic customer retrieval needs no numbering sequence or durable file URL. This supports a read-only commercial document service with zero schema changes. It does **not** establish physical immutability of all purchase fields or legal retention. Future admin correction writers must preserve history; a detected need to mutate historical facts triggers §6.2 rather than silently changing issued originals.

Canonical `DocumentSnapshotV1` is an internal allowlisted value object: document kind/policy, order reference, stable purchase date, necessary payment reference/date/amount, ordered item snapshots, address/delivery only as needed, exact decimal strings/currency, separate current status annotation, and explicit snapshot/template/asset/seller-profile versions. Validate it independently of Prisma. Never serialize the full database object.

Money rules:

- Read Prisma Decimal without `Number`, `parseFloat`, floating-point sum or locale round trip. Validate scale/range and compare Decimal values exactly. Preserve `0.00`, trailing zeros and upper-bound values without scientific notation.
- Verify each `lineTotal == unitPrice × quantity`, sum(lines) equals subtotal and subtotal + shipping equals total for this schema. Do not repair mismatches or balance with an invented “adjustment”. Invoice fails closed on mismatch; log safe diagnostic code.
- Current order/payment flow is USD with two-decimal columns. Default allowlist is USD; reject unsupported currency as `UNSUPPORTED_CURRENCY`, not automatic FX conversion or guessed minor units. Additional currencies need a reviewed exponent/rounding contract and evidence.
- Display ISO currency explicitly alongside formatted exact amount. Use safe string-based grouping or Decimal-derived integer/fraction formatting; presentation must not introduce floating-point loss.
- Dates use explicit UTC for instants and date-only handling for delivery estimates; no server-locale/timezone drift or invalid-date fallback. Do not mutate saved dates.

Version rules:

1. Canonicalize field order, nullable values, item sort `(createdAt,id)`, Unicode normalization policy and decimal representation. Preserve display text; document any normalization used only for comparison/hashing.
2. Compute an internal SHA-256 content hash over canonical document facts plus policy/template/font/asset/profile versions. Never log the raw snapshot. Do not use mutable Product.updatedAt or request time as a version.
3. Document API exposes an opaque `contentVersion`, not a storage URL or database ID. Original financial facts are a separate stable sub-snapshot; current refund/status annotation can create a new rendering version without rewriting those original facts.
4. Fix PDF metadata timestamps from source events, stable document identifiers and renderer ordering. Do not inject random IDs or wall-clock timestamps. Test byte equality for identical inputs using the selected pinned library; if its documented defaults prevent this, fix metadata via supported APIs or escalate with a narrow evidenced alternative before claiming byte determinism.
5. Same pinned renderer version and complete inputs must produce identical bytes. A later template/font version may change bytes/layout while preserving financial facts. No promise of retrieving arbitrary old bytes in on-demand mode; persistent issuance is necessary if that becomes a requirement.
6. GET has no issuance side effect and requires no Idempotency-Key. Simultaneous repeated GETs may share bounded in-flight computation only **after each request's authorization**, keyed by owner/order/content version/type. Do not retain cross-user PDF caches or persist access logs containing personal content.

### 6.2 Conditional persistent issuance path — only with proven need

Triggers: legal invoice sequence/issuance, immutable original retrieval across corrections or renderer upgrades, explicit retention requirement, per-record test/live provenance for mixed rollout, or audit evidence showing current snapshot fields cannot preserve required historical facts.

Before adding a migration, write a focused ADR/CCR identifying the unmet invariant, why on-demand facts/versioned templates cannot satisfy it, exact schema, storage/retention policy, mixed-version compatibility and operational plan. DATABASE + Architect approval is required; payment producer changes additionally require PAYMENT ownership. Basic downloads proceed without this optional scope unless legal issuance is explicitly mandatory.

Potential narrow `OrderDocument` contract, **not a mandatory model**: internal UUID; Order FK; optional Payment FK; kind; policyVersion; immutable canonical snapshot or durable immutable snapshot reference; snapshotVersion/hash; template/asset/font/seller-profile versions; stable issuedAt; legal number only when approved; correction/supersedes relation if required; unique logical issuance key; byte hash/storage key only if retained bytes are required. Metadata plus hash **without the original facts/bytes** cannot reconstruct a changed original and does not meet immutable issuance.

Legal numbering allocation must be atomic, concurrency-safe and satisfy the approved jurisdiction's policy; never use `MAX(number)+1`, random UUID as a claimed sequential invoice number or an in-memory counter. Unique constraints are necessary but not a complete numbering policy. Separate intentional issuance from GET retrieval; GET cannot silently allocate legal numbers. Older orders remain readable with nullable/additive fields and explicit legacy eligibility; no fabricated historical issuance backfill.

If private object storage is later justified, prohibit public buckets, long-lived public URLs and frontend service credentials; authorize every retrieval and define retention/deletion/access audit. It is not introduced by this baseline task.

## 7. Backend service architecture and implementation contract

```text
Confirmation / My Orders chooser / Order Details
        |
        | existing authenticated client (JSON metadata / bounded binary response)
        v
Express document routes -- requireAuth + requireRole(CUSTOMER)
        |
        v
OrderDocumentService
  parse/validate -> owner-scoped coherent Prisma read -> eligibility
        |                                              |
        | metadata only                                v
        +--------------------> DTO              DocumentSnapshotV1
                                                       |
                                             bounded PDF renderer worker
                                                       |
                                             complete verified PDF bytes
                                                       |
                                             inline / attachment response

Optional future outbox claim -> immutable event adapter -> same renderer
                              -> STARTED journal -> existing Brevo transport

Forbidden arrows: document GET/renderer -> payment processing, inventory,
cart mutation, event enqueue, mail send, arbitrary network asset fetch.
```

Keep routes thin: boundary parsing, call service, set headers/send bytes, forward AppError. Service owns authorization-scoped read and policy selection, pure domain maps facts/eligibility, renderer owns presentation only. Dependency injection must make read-only and no-network assertions testable. Do not call existing confirmation service merely to get its frontend DTO: it converts some states and additionally reads email status; select precise document facts directly.

Suggested interfaces (adapt filenames, retain semantics):

```ts
type DocumentKind = 'invoice' | 'receipt' | 'summary';
type Disposition = 'inline' | 'attachment';
type RenderedPdf = {
  bytes: Buffer; byteLength: number; pageCount: number;
  contentVersion: string; filename: string; mediaType: 'application/pdf';
};
// authorization remains in every public service call
list(userId: string, orderReference: string): Promise<OrderDocumentsDto>;
render(userId: string, orderReference: string, kind: DocumentKind,
       signal: AbortSignal): Promise<RenderedPdf>;
// internal pure boundary; no db / provider / filesystem paths in the input
renderDocument(snapshot: DocumentSnapshotV1, signal: AbortSignal): Promise<RenderedPdf>;
```

Use a bounded worker-thread pool or equivalently proven cancellable isolation for CPU rendering. Load packaged trusted fonts once per worker. Do not start an unbounded worker per request. One limiter/concurrency budget covers preview and download; optional email rendering has its own reserved small budget so API traffic cannot starve delivery and delivery cannot exhaust the API.

## 8. Secure customer API and DTO contracts

### 8.1 Routes

| Method / route | Contract |
| --- | --- |
| `GET /api/orders/:orderReference/documents` | Metadata and eligibility only; never generate a PDF, issue a number, enqueue or send. Return all three ordered entries, including unavailable reasons. |
| `GET /api/orders/:orderReference/documents/:kind?disposition=attachment` | Actual PDF download; default disposition attachment. `kind` exactly invoice/receipt/summary. |
| `GET /api/orders/:orderReference/documents/:kind?disposition=inline` | Same authority/model/bytes as download, inline response for controlled preview. No weaker preview endpoint. |

No POST issuance/send endpoint, generic unowned document ID route, public URL, userId query/body, arbitrary filename, locale/template URL or client totals. Reuse `parseOrderReference`; validate max length, UUID and optional ORD prefix. Canonical responses use uppercase `ORD-<UUID>`. Strict Zod query accepts exactly one optional scalar disposition; reject arrays, duplicate parameters, unknown keys and traversal/encoded separator attempts. Metadata query is empty/strict. Authenticate before order existence disclosure. Explicitly handle method/HEAD behavior: do not let Express's automatic HEAD run expensive rendering; return authenticated metadata headers or a documented 405 with Allow, consistently tested. Unsupported mutation methods return 405 without effects.

### 8.2 Customer metadata DTO

New additive contract; existing order/history/confirmation DTOs need not change. Metadata is fetched on panel mount for Confirmation/Details and lazily on history chooser opening, not N requests for N cards.

```ts
type DocumentUnavailableReason =
  | 'PAYMENT_NOT_CONFIRMED' | 'HISTORICAL_PAYMENT_UNVERIFIED'
  | 'DATA_INCOMPLETE' | 'DATA_INCONSISTENT' | 'UNSUPPORTED_CURRENCY'
  | 'DOCUMENT_TOO_LARGE' | 'DOCUMENTS_UNAVAILABLE';
interface OrderDocumentEntry {
  kind: 'invoice' | 'receipt' | 'summary';
  label: string;                 // controlled server copy, not arbitrary HTML
  description: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  reasonCode: DocumentUnavailableReason | null;
  mediaType: 'application/pdf';
  filename: string | null;       // server-generated only
  contentVersion: string | null;
  templateVersion: string;
  policy: 'COMMERCIAL_V1';
  issuedAt: null;                // no legal issuance in baseline
  purchaseDate: string;          // ISO UTC
  paidAt: string | null;         // proven original paidAt only
  previewPath: string | null;    // relative authenticated API path
  downloadPath: string | null;
}
interface OrderDocumentsDto {
  orderReference: string;
  documents: OrderDocumentEntry[]; // exactly invoice, receipt, summary
}
// HTTP 200: { data: OrderDocumentsDto }
```

For UNAVAILABLE, filename/contentVersion/action paths are null. Never advertise a signed/public link. File size/page count are omitted from listing because bytes have not been rendered; do not display fake “120 KB”. Labels/reasons localize through controlled copy if needed; no user-supplied strings as markup. Do not expose snapshot JSON, raw Payment/Attempt/outbox rows, provider identifiers, recipient email, secrets, diagnostics or internal eligibility evidence. Add documented examples for paid, pending, refunded, legacy and malformed cases in the API docs.

### 8.3 HTTP result matrix

| HTTP | Code / shape | Meaning and client behavior |
| --- | --- | --- |
| 200 JSON | `{data: ...}` | Owned metadata, including unavailable entries. An owned pending order is not a metadata error. |
| 200 PDF | binary, application/pdf | Only after successful bounded generation/validation. |
| 400 | ORDER_REFERENCE_INVALID / DOCUMENT_REQUEST_INVALID | Malformed reference/kind/disposition/unknown query. No renderer. |
| 401 | Existing auth error shapes | Missing/expired/invalid token or inactive account. Existing bounded refresh/sign-in behavior; never infinite retry. |
| 403 | Existing role error | Authenticated non-CUSTOMER; no owner metadata disclosed. |
| 404 | ORDER_NOT_FOUND | Identical safe response for absent and other-owner Order. No document availability leak. |
| 405 | METHOD_NOT_ALLOWED | Unsupported methods; Allow reflects implemented GET/HEAD policy. |
| 409 | DOCUMENT_NOT_AVAILABLE | Owned document not eligible; generic safe message, no internal financial diagnostics. Refresh metadata to obtain the allowlisted reasonCode. |
| 422 | DOCUMENT_DATA_INVALID / DOCUMENT_LIMIT_EXCEEDED | Owned data cannot safely render: invalid/unsupported/oversized facts, glyph coverage or output ceiling. No partial PDF. Not 413 for a bodyless GET. |
| 429 | RATE_LIMITED | Principal/IP abuse bound reached; Retry-After, localized wait, no auto-loop. |
| 503 | DOCUMENTS_UNAVAILABLE / DOCUMENT_GENERATION_TIMEOUT | Feature disabled, bounded pool saturated, dependency/read temporarily unavailable or cancellable deadline exceeded. Retry-After when meaningful. Order remains usable. |
| 500 | DOCUMENT_GENERATION_FAILED | Unexpected internal failure, generic message and request ID; no stack/SQL/path/raw text. |

Use existing `{error:{code,message}}` AppError envelope for new domain errors; preserve current middleware auth compatibility, including string-shaped errors. The inspected handler exposes code/message and no details object: retain it and obtain reasonCode through a fresh metadata read after 409. Do not rewrite all error consumers. Renderer internal diagnostics are logged safely, not returned. No 202 polling job, 204 empty PDF, success JSON inside PDF or 302 login page disguised as a document.

### 8.4 Headers and binary response lifecycle

Successful response requirements:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="ElectroHub-ORD-<UUID>-invoice.pdf"; filename*=UTF-8''ElectroHub-ORD-<UUID>-invoice.pdf
Content-Length: <actual complete byte length>
Cache-Control: private, no-store, max-age=0
Pragma: no-cache
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Document-Version: <opaque content version>
```

Inline changes only disposition. Generate filename from trusted brand + canonical reference + fixed document kind, ASCII fallback, `.pdf`, bounded length (target <=120 bytes). No customer name/address, CR/LF/NUL, quote/backslash/slash, traversal, control or bidi formatting characters. Use a well-tested RFC6266 serializer with RFC8187-compatible `filename*` encoding; never concatenate request text into headers. Unicode names, if ever needed, require safe fallback and percent-encoded UTF-8; they are not needed for the baseline filename.

Apply private no-store to metadata and **all document error/auth responses**, before auth middleware. Do not introduce ETag/Last-Modified conditional private PDF caches or return 304. Ensure proxy/CDN/service-worker configurations do not cache these paths. Same-origin client is preferred; any existing cross-origin setup must retain its exact allowlist and expose only necessary safe response headers, never wildcard credentialed CORS.

Render fully into a capped buffer, validate completion, byte/page bounds and `%PDF`/parseability in tests, then set 200/headers and send using backpressure-aware Node response handling. Never pipe an uncompleted renderer directly into a successful HTTP response. A late socket failure cannot be retroactively changed to JSON; terminate the response and log a safe code. Client validates content type and length where present before offering the file and handles aborted/truncated transfers. No temporary public file path. If implementation later chooses bounded temp-file spooling, require private permissions, random names, cleanup on all exits and a reviewed reason.

Range requests are not supported in baseline; do not advertise Accept-Ranges or render repeatedly for ranges. Return the complete authorized 200 response ignoring Range consistently, or explicitly reject with documented behavior; choose and test one. Baseline choice: ignore Range, return full bounded PDF. Preview uses fetched bytes, so range support is unnecessary.

### 8.5 Authenticated binary browser client

Extend existing API transport through a typed response parser option or sibling exported `apiBinary` using the **same internal** bearer attachment, refreshPromise, abort/error handling and session-expired event. Do not export the token, create a second token store, place JWTs in URLs, use localStorage, or open the API URL with a plain anchor expecting bearer credentials.

Default JSON behavior must remain unchanged. Binary parser first checks `response.ok`; JSON error responses still become ApiError. Require `application/pdf`, enforce 5MiB client cap while reading (Content-Length alone is insufficient), and reject HTML/empty/truncated responses. Use `cache:'no-store'`. For downloads, derive safe filename from validated server header or known canonical fallback; never trust arbitrary header values as paths. Client refresh is an existing auth operation, not a new document business mutation.

## 9. PDF renderer, library, typography and deployment

### 9.1 Selected approach and dependency gate

Select **PDFKit** as the preferred backend renderer, subject to a bounded implementation spike for the exact pinned release on repository Node 20.11.0/Alpine. It fits direct selectable-text generation and shared programmatic layouts without a browser runtime. Current manifests contain no PDF renderer to reuse. Pin the evaluated version and lockfile; record license, Node support, transitive footprint and security review. Do not claim a specific release is installed or tested by this spec.

PDFKit documents wrapping, text measurement and embedded font support. Those capabilities do not prove ElectroHub's pagination, Arabic shaping, reading order or accessibility; the spike and tests must establish them. Do not use base-14 Helvetica as the universal Unicode solution. If required script shaping/glyph/text extraction cannot be met, escalate a focused comparison with a maintained alternative such as a reviewed Chromium renderer, including image size, sandboxing, cold-start/memory and asset-security consequences. Do not silently ship broken glyphs or add Chromium to the main API image without evidence.

No browser screenshot-to-PDF, canvas text images, client-side pricing, remote document SaaS or uploaded HTML. Library choice changes require a brief ADR amendment, not a new architecture audit.

### 9.2 Font and text contract

- Package licensed Poppins regular/medium/semibold for Latin brand/body and a vetted licensed fallback family covering required scripts (for example Noto Sans plus an Arabic font when needed). Confirm real files, licenses, version/hash, glyph coverage and embedding permission. Do not assume CSS-installed fonts exist in Docker.
- Support accented Latin, apostrophes, smart quotes, currency symbols, en/em dashes, combining marks and tested Arabic/RTL names/addresses with correct shaping/direction. Declare the tested script set; do not claim every Unicode glyph is covered.
- Unknown glyphs: detect before sending and use a correct packaged fallback; if unavailable, return controlled DATA_INVALID rather than replace names/amounts with squares or question marks. Emoji may be omitted only from decorative content, never silently from meaningful saved customer text.
- Treat all input as literal text. Normalize unsafe control characters under a documented policy while preserving meaningful line breaks and normal RTL text. Disallow malicious bidi overrides in references/numeric columns; use safe directional runs for names. No PDF JavaScript, embedded files, forms, Launch actions, user-controlled hyperlinks or remote actions.
- Preserve selectable text and Unicode extraction order; embed ToUnicode mappings as supported. Set document language/title and coherent reading order. Aim for tagged headings/tables/reading order using supported APIs. Do not claim PDF/UA or PDF/A compliance without validation; ordinary selectable text alone is not accessible tagging.

### 9.3 Shared visual system

Default A4 portrait, 595.28 × 841.89pt, 40pt left/right and 42pt top margin with a reserved 36pt footer area. Print safely on Letter using fit-to-page; if native Letter is later required, treat it as a versioned server policy, not arbitrary query-controlled layout. No full-bleed backgrounds, heavy ink blocks or external imagery.

Header: trusted local lightning logo/wordmark, 18–20pt title, modest blue rule and compact metadata. Body: 10–11pt embedded font, 1.3–1.45 line height, dark readable text; secondary labels minimum 9pt and adequate contrast. Numbers right-aligned in consistent columns; monetary amount and currency never split ambiguously. Whitespace is deliberate, not huge blank space or squeezed type.

Invoice table: description/SKU widest, then Qty, Unit price, Amount. Use light header shading, thin neutral separators, no dense decorative grid. Long product names wrap with measured row heights; SKU is smaller but readable. Totals block right-aligned after table with generous separation and clear final amount. Receipt emphasizes original amount/date/method and short explanatory facts; it is not an invoice table clone. Summary prioritizes order status, fulfillment and delivery then items/totals.

All pages show abbreviated repeating brand/title plus full order reference where practical, page X of Y and a short non-tax/test qualifier as applicable. Main first-page title carries the full legal-mode wording. Footer never overlaps content; no fake website/contact URL. Print in grayscale remains understandable without color-only status coding.

### 9.4 Multipage algorithm and content limits

Measure text with the same font/size/width used to draw. Reserve header/footer before pagination. Repeat column headers on every continuation page; keep a normal row together when it fits. If one row exceeds usable page height, split its text deliberately with a continuation label while placing quantity/amount once; never duplicate charges. Do not truncate financial or identity content to fit.

Keep totals block together; move it to a new page if necessary with sufficient context, avoiding orphan labels. Address blocks can wrap/split safely with clear headings; no single-character columns or giant overflowing UUIDs. Precalculate page count or use bounded page buffering. Enforce 100 lines / 30 pages / 5MiB output including embedded assets, and a 256KiB canonical-model bound. Read at most 101 rows to detect over-limit data rather than loading an unbounded relation. Limits are proposed service guardrails; validate them against maximum legitimate 50-line checkout fixtures and observed deployment resources. No silent partial order PDF.

### 9.5 Packaging and runtime

Place fonts/logo in a dedicated trusted backend asset folder, copy them into build output/runtime image, resolve paths relative to installed module/package location (not current shell directory) and validate manifest hashes at startup or worker initialization. TypeScript `tsc` alone does not copy fonts. Existing Docker runtime COPY rules require explicit asset additions. No runtime font downloads, CDN logo fetches, `file://` from data or Cloudinary product-image loads; product photos are intentionally omitted for reliability/privacy/print quality.

Build-time trusted logo conversion, if necessary, uses the existing brand vector with a reviewed local asset pipeline, not runtime SVG interpretation of customer input. Fonts and logo must work with networking disabled in the packaged container. Test non-root/read-only filesystem behavior where applicable, missing/corrupt assets, cold startup and paths after production build. Missing required assets disable documents with a clear health signal, not the entire purchase service. Do not start live workers during a document packaging smoke test.

## 10. Frontend behavior, state transitions and responsive integration

### 10.1 Shared feature structure

Create one reusable document list/panel, one chooser wrapper for history and one preview dialog using existing Button/Dialog/Dropdown/Error/Skeleton primitives. Metadata belongs in React Query; selected action, abort controller, PDF bytes and object URL belong in short-lived local state, not persisted query storage. Add `queryKeys.orders.documents(userId, reference)` with explicit owner identity; never key by reference alone. Do not use previous-account placeholderData.

Metadata fetch requires `user && isSessionVerified && !isLoggingOut`. Confirmation/Details can load metadata after their owned order is known; do not gate success/layout on it. History fetches only when chooser opens; cache metadata briefly within the signed-in account and refresh when reopening or after a 409. No PDF prefetch on hover/page load and no generation for every history card. Do not piggyback on the Task 03.8 email polling interval or create permanent document polling.

### 10.2 Exact screen integration

**Confirmation:** modify the actual `ConfirmationContent` composition in `CheckoutComponents.tsx`. After the summary and `TransientEmailNotice`, add compact document panel, then preserve existing primary/secondary navigation. For pending/legacy confirmation, show neutral availability reasons from API; never render paid receipt actions just because the confirmation route exists. Email unavailable does not hide documents. Document unavailable does not hide email or change the heading to payment failure.

**Order Details:** new aside card follows totals/payment facts card and precedes back link; do not hide original payment badges/card facts. Three compact rows; each has fixed icon/name region and actions. At narrow width rows stack description then actions; do not squeeze the totals column or force horizontal scroll. Preserve stale order refresh notice separately from document error.

**My Orders:** footer document trigger is a sibling interactive element outside the card anchor. Give it a named action such as “Documents for order ORD-…”. Put it above the stretched link's overlay through a scoped stacking rule or reduce the overlay hit area around the action. Pointer and keyboard interaction must open the chooser without navigation; clicking the rest of the card still opens details. Stop propagation alone is insufficient if a CSS overlay captures the click. Update the old one-link-per-card accessibility test intentionally to permit the new sibling button; do not delete the test wholesale. Preserve pagination/fromPage state and back navigation.

### 10.3 Preview and download lifecycle

View fetches the inline variant through the authenticated binary client and displays an actual blob-backed PDF inside the controlled dialog. Dialog opens synchronously from the click, shows scoped loading and prevents popup-blocker problems. Use an iframe/object only with the narrow reviewed CSP allowance (`frame-src blob:` if iframe is selected), a meaningful title and no untrusted URL. Do not loosen global CSP to `*`, unsafe-inline or arbitrary object sources. Preserve native PDF zoom/print where supported; provide persistent Download button and a fallback message when preview is unavailable. A blank native viewer is a failed preview, not success.

Use one object URL per active preview; revoke on replacement, close, unmount, logout and account/source change after removing the viewer. Keep the download URL alive until the browser consumes it, then revoke via bounded cleanup; immediate same-tick revocation can break downloads. Do not reuse a revoked URL. A server-rendered HTML invoice replica is not proof the real PDF previews correctly.

Download fetches attachment variant, validates PDF/size, creates a short-lived local URL and browser download trigger. Announce “PDF download started”, not “saved successfully”. Disable only that selected action while in flight; prevent repeated presses/press-and-hold from spawning duplicate requests. Other document types may remain usable within a bounded local concurrency of one generation action per panel. Cancel the request when closing preview or navigating; user cancellation is quiet, not an error toast.

### 10.4 State / transition matrix

| State / transition | Required behavior |
| --- | --- |
| Auth hydration | No private request or cached document display; existing sign-in/loading gate. |
| Metadata initial loading | Panel-shaped skeleton with three entry placeholders, no fake counts or available buttons. |
| Available | Purpose + View PDF / Download PDF; stable layout. |
| Pending / legacy / failed | Neutral explanatory reason; no working receipt/invoice control. Summary remains available when eligible. |
| Metadata fetch failure | Panel-local retry; no “no documents” empty state; order remains visible. |
| Background metadata refresh | Retain same-owner metadata with subtle busy indication; no focus jump, reset or skeleton flash. Reauthorize every actual action. |
| Slow generation | Action-local busy label and aria-busy; navigation usable; no artificial percentage. |
| Double click / keyboard repeat | One request for the same active action; no duplicate download/popups. |
| File 409 after earlier availability | Refresh metadata, explain state change; never retry payment or resend email. |
| File 422 / oversized / glyph failure | Safe document-local message and existing order-detail alternative; no infinite retry. |
| Timeout / network / 5xx | Localized error with manual retry; preserve order/selection where safe. |
| 429 | Honor bounded Retry-After messaging, disable immediate retry briefly; no polling storm. |
| Session expires before/during request | Existing bounded refresh; if unrecoverable, close preview, clear buffers, invoke existing sign-in flow and preserve safe order route. |
| Logout / A→B switch while fetch resolves | Abort, remove private query entries, close dialog, revoke URLs, discard late response by captured owner + session epoch; never auto-download A's file for B. |
| Route A→B / browser back-forward / refresh | Cancel stale action; correct reference/query key; no previous-order preview appears in new route. |
| Refund while preview open | Existing snapshot remains a clearly identified rendition; on reopen/reload fetch current metadata/bytes. Do not silently mix updated status with old totals. |
| Viewer unsupported / blocked | Accessible fallback and working Download action; report preview limits, no blank inaccessible modal. |
| Feature disabled / missing assets | Clear temporary documents-unavailable state; no loss of purchase success, order details or navigation. |

Do not store PDFs in localStorage, IndexedDB, persisted React Query, service-worker cache or analytics. Server no-store does not erase an already downloaded file; explicitly limit cleanup claims to app-controlled private state. A stale/aborted response must be checked before object URL creation and again before download dispatch.

### 10.5 Accessibility / visual verification

Keyboard: history card link and Documents button both reachable, Enter/Space do their intended action, chooser arrows/Escape follow primitive semantics, dialog traps focus and restores it to opener, close remains visible at zoom/mobile. Icons are decorative when a text label exists. Unavailable explanations are accessible text, not disabled controls with tooltip-only reasons. Announce one meaningful status change through a polite region; errors use appropriate alert semantics without repeated polling announcements.

Test real browser at normal/slow network with 0 orders, 1 order, many paginated orders; 1/2/50 item orders; long name/SKU/UUID/address; no optional address line; missing card metadata; large money; each status; dialog open during auth transition. Screenshot names/notes must record viewport, state, design source and what was opened/inspected. Distinguish preservation of existing Figma-derived shell from the new Task 03.9 document addition; do not claim an unseen Figma PDF design was matched.

## 11. Security, privacy and bounded performance

### 11.1 Security controls

- Authenticate active user and current role using existing middleware. Never trust URL/query userId, role, client payment status or purchase success screen. Ownership on listing, preview and download, even when a contentVersion/file is known.
- Use an owner predicate in the database query; no unrestricted fetch followed by forgotten ownership checks. Missing/wrong-owner behavior must be indistinguishable in body/status and avoid material content/timing leaks. Admin role has no automatic customer PDF bypass.
- Strict select/DTO/render model allowlists; no PaymentWork, checkout request hash, provider secret, JWT, email event payload, geolocation or unnecessary phone/address in receipts.
- Fixed local assets only. No network image/font loads or redirects, including internal IP, localhost, link-local, metadata endpoints, data URLs supplied by users and filesystem traversal. No user-controlled HTML/SVG/PDF templates.
- Generated PDF contains literal text only from user fields; malicious strings must not create links/actions/JavaScript, corrupt the file, inject headers or alter layout bounds. Check hidden metadata for PII/secrets.
- Preserve existing TLS/auth/CORS/Helmet settings. Do not disable TLS verification or CSP to make a viewer/test pass. No public storage/URLs or service-role keys in browser.
- Test cancelled requests and account transitions. Browser state cleanup supplements authorization; it does not replace it.
- Existing app JWT authentication is not Supabase Auth. Do not add generic `auth.uid()` policies assuming those identities match. New tables, if approved, require explicit backend-only access model, RLS/grants/public-role revocation review.

### 11.2 Initial service guardrails

These are implementation targets requiring measurement, not claims of existing capacity:

| Resource | Initial bound / acceptance |
| --- | --- |
| Canonical input | <=256KiB; at most 100 rows; all strings bounded by saved schema/explicit validator; no unbounded JSON |
| Output | <=5MiB; <=30 pages; fail closed before success response |
| Generation | Hard cancellable 10s render deadline; 15s overall request budget with existing bounded DB access; terminate worker job on expiry |
| Concurrency | Default 2 renderer workers per API process; queue at most 8 jobs; one in-flight generation per principal; reject excess promptly |
| Rate | Initial 20 binary requests / user / 5min, 60 metadata reads / user / 5min; retain an IP abuse limiter without treating IP as ownership |
| Email attachment | <=2MiB decoded per file, <=3MiB aggregate decoded, <=6MiB serialized send payload; at most one attachment for each supported event |
| Browser | <=5MiB streamed read; one active preview; bounded URL/download cleanup |
| Performance evidence | On documented test hardware: target p95 <=2s for 1–10 lines, <=5s for 50 lines at configured concurrency; no event-loop starvation, unbounded queue, memory growth or payment-read regression |

Rate/concurrency counts must be evaluated across actual instance count; process-local limits are not a global guarantee. Record aggregate deployment cap and use existing shared/proxy rate controls if available. Do not introduce Redis solely for this spec without measured need. Bound queued snapshot memory and account for worker heaps, duplicated buffers, embedded fonts and base64 expansion. Establish a measured container memory budget before release; default concurrency is not proof it fits.

Metadata does no rendering, no assets and no N+1 per item/card. Database snapshot closes before rendering/streaming. Do not hold pool connections during PDF generation. Measure query count and p50/p95 for representative orders, generation time/bytes/pages, peak RSS and recovery after cancellation; test repeated largest supported documents and concurrent customer reads. Avoid speculative indexing: Order PK/user ownership and OrderItem.orderId indexes already exist. New indexes need an actual query-plan reason and conditional migration review.

### 11.3 Observability and operations

Safe structured events: document_metadata_read, document_render_started/completed/failed, document_request_cancelled, document_limit_rejected, document_attachment_omitted. Fields: request ID, safe internal order reference/ID, kind, template version, duration, page/byte counts, error code and resource category. Do not log raw snapshot, PDF/base64, address/name/email, tokens, card digits or provider payloads. Avoid using user/order IDs as unbounded metric labels.

Expose aggregate success/error/timeout/size/pool saturation metrics and font/asset readiness. Document disabled-mode behavior and rollout switches. Default attachments off independently of downloads. Rollback disables document controls/API rendering and optional attachments without touching orders/payments or replaying mail. In-flight work is cancelled safely; existing accepted mail remains accepted.

## 12. Optional Brevo invoice / receipt attachments

### 12.1 Entry gate and ownership

Begin only after required customer routes, all three documents, security and physical PDF gates pass. Declare ENABLED FOR TEST / DEFERRED explicitly. Default remains disabled in all environments. Separate authorization is needed for real sends and worker activation; the current spec assignment authorizes neither.

Reuse `OutgoingCommerceEmail`, `CommerceEmailTransport`, existing Brevo provider/client and domain classifiers. Add typed optional attachments `{name, content}` to internal payload/transport only; `content` is base64 generated from trusted bytes, not a remote URL. Keep OTP/options callers source compatible. Current Brevo API accepts PDF attachment content/name; recheck exact provider/account payload constraints before activation. The conservative local bounds in §11 are application limits, not a claimed provider maximum.

### 12.2 Event/snapshot mapping

| Existing event | Optional attachment | Source |
| --- | --- | --- |
| ORDER_CONFIRMED | One invoice/non-tax commercial statement | Immutable orderConfirmed snapshot: items, shipping address, amounts, delivery, occurredAt; do not fetch current Product/User/address. Event provenance proves original confirmation. |
| PAYMENT_CONFIRMED | One payment receipt | Immutable paymentConfirmed snapshot: original amount/currency/paidAt/card and order reference. Do not enrich with current account/address or unrelated Order data. |
| Other event types / suppressed / purged / old unsupported versions | None | Preserve existing HTML/plain-text behavior; no fabricated attachment facts. |

Snapshot v1 lacks an explicit document/template/font/seller-profile attachment descriptor. Do not attach to all historical rows merely because a worker flag changed. For prospective support, define a versioned immutable descriptor on newly produced events (JSON version evolution, not mandatory DB columns) containing document kind/policy/template/asset/profile version and source semantics. Validate old and new snapshot versions explicitly. New descriptor creation inside an already existing producer is only constant-time metadata, never rendering/network I/O; protected producer/payment integration needs its CCR.

Keep old v1 events valid and attachment-free. Never update immutable snapshot/templateVersion/eventKey in existing rows or rewrite trigger history. If the chosen new envelope cannot safely coexist with old dispatcher readers, deploy readers first, then enable new producer version separately; document rollback compatibility. Do not purge or replay old events to manufacture attachments.

Attachments and downloads share domain formatting/templates and original financial facts. Event-time attachment can omit a later refund annotation that a current download contains; document the difference as event-time versus current rendition, with explicit versions. It must not contradict the original amount/date. A receipt adapter must not fabricate invoice shipping facts absent from its snapshot. If exact byte identity with every future download is required, use the reviewed persistent issuance path; on-demand current status and event-time mail cannot promise identical bytes indefinitely.

### 12.3 Crash/retry rules

1. Claim under existing bounded database lease; validate immutable snapshot/version/recipient; render HTML and optional PDF **outside transactions and before startAttempt**.
2. Pre-send attachment rendering failure, missing version or size limit: preserve valid core email by omitting the optional attachment and logging a safe omission code. Never send a partial/truncated file. Invalid core email snapshot retains existing quarantine behavior. No new fallback email or event.
3. Revalidate unexpired lease with existing `startAttempt`; if lease expired during PDF work, discard bytes and do not call provider. Do not increase lease/DB timeouts blindly. Test the render deadline fits normal configured lease with send/ack margin.
4. STARTED journal commits before the **single** provider send with HTML/text and optional attachment. No database transaction encompasses base64/network work.
5. Crash before STARTED: existing expired-lease recovery returns unstarted work to READY. Crash after STARTED, timeout, missing success ID, ambiguous network outcome or lost acknowledgement: preserve UNCERTAIN; never auto-resend.
6. Provider-proven rejection follows existing bounded attempt/age/Retry-After and permanent/pause classification. A safe retry regenerates from the same pinned event facts and versions. If an earlier rejected attempt omitted its optional attachment, a later attempt may include it only because no accepted delivery was proven; original financial content is unchanged. This variability is documented, not described as exactly identical provider requests.
7. ACCEPTED/SUPPRESSED/FAILED terminal rules and immutable event keys remain unchanged. ACCEPTED is provider acceptance, not inbox delivery. Never resend accepted mail to add a missed attachment. UNCERTAIN needs existing operator handling, not automatic PDF repair.
8. Test process death at render/STARTED/send/ack boundaries and stale worker races with deterministic barriers. No purchase rollback, inventory reversal, payment retry or new event is allowed when PDF/Brevo fails.

Do not store base64 in outbox JSON (existing physical size bound and privacy costs), capture logs or application logs. Capture-mode attachment tests use restricted synthetic artifact files or a safe descriptor/hash, not real customer payloads. Email-client QA must download/open the received attachment and verify name/size/contents; a mocked provider acceptance is not mailbox proof. Real sends remain limited to authorized synthetic recipients and existing safe runtime modes; no all-recipient activation as a shortcut.

## 13. Physical schema, DEV gate and PROD protection

### 13.1 No-migration route

Expected schema diff: none. Confirm no schema/generator/version or migration history edits. Record schema and migration-tree hashes before/after; compare current models to actual read needs. Do not demand a migration to satisfy paperwork. Existing migrations/evidence may be reused; this spec is not a claim they are applied to every runtime.

For later authorized DEV acceptance, verify target identity and read-only physical columns/types/indexes and completed ledger entries relevant to Order/Payment/outbox. Missing 03.8 tables must not be “fixed” by running a launcher that auto-migrates a shared database without authorization. Core PDF downloads should not depend on outbox availability. Distinguish disposable isolated Postgres, shared DEV and PROD in every evidence record.

### 13.2 If §6.2 proves a new migration necessary

- Prepare additive forward-only Prisma schema/SQL in a dedicated coordinated change. Use repo Prisma workflow, not a competing Supabase CLI history. Preserve all 20 historical directories/bytes and existing ledger/default exceptions.
- Review exact SQL, nullable transitions, foreign keys, unique keys, check constraints, access grants/RLS, lock duration, table size, indexing, backfill policy, mixed-version reads/writes and rollback. Hash the new migration; no reset/db push/destructive cleanup.
- Test fresh chain and upgrade from baseline on a specifically authorized disposable PostgreSQL database. Test existing legacy orders, concurrent issuance uniqueness if applicable and failure rollback. These tests require fixture writes and are **not authorized by this spec-only request**.
- DEV execution requires explicit environment/commands/fixture scope authorization. Verify connection identity/TLS, pending migration set, ledger/checksums and physical state first. Apply only reviewed pending changes through Prisma; never accept unexplained drift by rewriting `_prisma_migrations`.
- Post-DEV: verify completed ledger, actual columns/types/defaults/indexes/FKs/CHECKs/triggers/grants/RLS and mixed-version API reads. Capture concise evidence and cleanup only owned synthetic fixtures under authorized conditions.
- PROD is a separate release gate: exact SHA/migration hash, DEV results, backup/PITR or explicit migration-specific risk acceptance, restore/forward-fix plan, expected locks, no unrelated pending migrations, owner approval, controlled deployment and read-only postcheck. No production fixtures, email tests, purchases, seed, migrate dev, reset or schema push.

Prisma validate/generate and mocked tests are offline evidence, not physical DB proof. Keep TLS verification; no `NODE_TLS_REJECT_UNAUTHORIZED=0`. When access/authorization is missing, mark the specific gate NOT VERIFIED and prepare the concrete execution packet; do not invent results or repeatedly ask for already-granted authority.

## 14. Verification plan — all layers

### 14.1 Unit / contract tests

Use Vitest and existing test structure. Tests encode business/security invariants independently of implementation helpers, including explicit expected content, not just snapshots generated by the same function under test.

| Group | Positive / negative cases |
| --- | --- |
| Eligibility | All §4 rows; every fulfillment state with SUCCEEDED; authorization-only/pending/failed/no Payment; paidAt null/invalid; refunded with/without retained success; cancelled paid without refund; contradictory Attempt/INCIDENT; unknown future enum fails closed. |
| Decimal | 0 shipping; cent fractions; repeated quantities; largest Decimal(12,2) supported values; 999 quantity; line/subtotal/total mismatch; negative/invalid/nonfinite/excess-scale input; currency mismatch/non-USD; no floating-point conversion. |
| Historical facts | Change Product name/SKU/price/image, User name/email and address-book after purchase; documents still use Order snapshots. Missing optional fields do not cause invented fallback facts. |
| Determinism | Same canonical input repeated/concurrent and fresh worker process yields equal bytes/hash; different template/font/profile/current refund annotation changes version; time/locale/process cwd cannot alter content. |
| Rendering | One/two/50/100 lines; 101 fails; 0 lines; row/page boundary ±1; one very long row; full UUID; long address; large totals; repeated headers; totals only once; page numbers correct; no overlap/clipping. |
| Unicode | Accented Latin, combining marks, smart quotes, RTL/mixed Arabic-Latin/numbers, supported currency symbols, missing glyph fallback, unsupported glyph failure; selectable extracted text matches source meaning. |
| Injection | CRLF/NUL/path traversal in identifiers and filenames; HTML/script/SVG/PDF metacharacters as literal text; malicious bidi overrides; arbitrary asset URL/path rejected; no outgoing fetch. |
| Resource lifecycle | Cap bytes/pages/model/items; deadline kills worker; queue full; cancellation before/during/after render; disconnect; worker exception; missing font/logo; cleanup and next job still works. |
| Side effects | Assert no create/update/delete/event/provider calls from listing/preview/download across success and errors. Test direct service dependencies, not only HTTP verbs. |

### 14.2 Express / Supertest security and binary tests

Mount actual routes/middleware and injected test persistence as existing `orders.management.test.ts` does. Verify missing/malformed/expired JWT; inactive user; wrong role including ADMIN; valid customer; foreign owner A/B/C; identical unknown/foreign 404; case/bare legacy reference parsing; invalid UUID/long/encoded slash/duplicate query/unsupported disposition/kind/method/HEAD; auth applied to metadata and files; no document lookup/render for unauthorized requests.

Verify exact response envelopes/statuses, safe reason codes, private no-store on every path, safe disposition inline/attachment, MIME, length, nosniff, no JSON/HTML served as PDF, no secret values in bytes/metadata/errors/headers, same bytes for inline/download under same snapshot, range behavior, rate-limit headers and queue saturation. Force renderer failure before response and socket abort after response; no partial successful rendering path. Deliberately guessed contentVersion/known order ID does not bypass owner check.

### 14.3 Real PostgreSQL integration — material required evidence

Run against explicitly authorized disposable Postgres first. Seed labeled synthetic accounts A/B/C and valid/current/legacy/inconsistent fixtures under actual constraints; use real Prisma + Express authentication/queries. Record actual schema/migration baseline. Confirm owner predicates, Decimal precision, stable item ordering, no N+1, query snapshot consistency during a concurrent status/refund change and no document writes. Barrier-controlled concurrent reads verify coherent before/after views; do not use arbitrary sleeps as race proof.

Compare counts and relevant row hashes before/after repeated PDF requests for Orders/OrderItems/Payments/Attempts/Work/Cart/Inventory/Outbox/EmailAttempt. Allow fixture/auth setup writes only outside the document assertions and identify them separately. Never claim whole-database immutability from a single mocked spy. Product/profile mutation fixtures prove history accuracy; no production data export.

Reuse existing credible payment-success evidence for unchanged finalization. A new live Stripe purchase is not required merely to test read-only PDFs if trusted synthetic persisted facts plus existing payment gates suffice. If implementation touches payment producers or states, expand only to relevant critical tests and required authorized runtime proof. Shared DEV read acceptance is separate; no production purchase needed.

### 14.4 Frontend unit / Storybook

Test actual panel/chooser/preview components and binary client: metadata loading/available/unavailable/error/refresh; per-action busy state; JSON error parsing; wrong MIME/zero-length/oversize/truncated blob; filename fallback; repeat click; abort; one bounded refresh; existing JSON consumers unchanged; session epoch/late completion; URL cleanup on every exit; route switch and pagination; history overlay isolation; keyboard and focus restoration.

Stories use real providers/primitives with scoped fetch stubs and synthetic binary fixtures, not decorative static mock screens. Required variants: paid all three available; pending summary only; legacy unprocessed; failed cancelled; paid cancelled; refunded proven; refund missing paidAt; missing card; metadata loading/error; generating; preview loaded/unavailable/error; 429; 503; long names/reference; mobile/tablet/desktop; chooser open; one/many orders. Include API-backed page composition stories and story controls only where they affect real component state. Build Storybook and run a11y addon; clean identity/query/fetch between stories.

### 14.5 Playwright, axe and real browser

Extend `tests/orders`/orders config for deterministic intercepted UI tests without snapshot-update flags. Add a separate clearly identified real-stack test for actual PDF bytes, backend ownership and download/preview; intercepted tests cannot substitute for that gate. Reuse isolated harness safety after reading its launcher (some launchers apply migrations/start workers). Do not run it under spec-only authorization.

Required journeys:

1. Confirmation → View/Download each available document; success heading/nav stay intact during slow/failing generation; email-delayed/unavailable is independent.
2. My Orders page 2 → Documents chooser without card navigation → preview/download → close → card link → Details → Back to Orders page 2. Verify browser refresh/back/forward/direct entry.
3. Details → all three documents with real download event, expected safe filename, nonzero valid PDF bytes and extracted order reference/amount. No charge/cart/email requests.
4. Pending/failed/legacy/refunded/cancelled cases match the server matrix; direct URL attack still denied even if UI is bypassed.
5. A opens preview; logout; B signs in; no A content remains. Repeat switch while request and refresh are in flight; late response does not download. Include third customer C to catch accidental fixed test-user assumptions.
6. Slow network, rapid repeat clicks, close while loading, navigation during download, network interruption, expired token, 429, 500/503, corrupted or oversized response and native-viewer unavailable.
7. At 390/768/1440/1920px and 320 stress: no horizontal overflow, readable long content, correct stacking, reachable close/download; 200% zoom and reduced motion; actual keyboard focus inspection.
8. axe WCAG 2 A/AA on panels/chooser/dialog, plus manual keyboard, contrast and screen-reader naming. Axe does not validate the PDF's internal reading order; inspect that separately.

Do not weaken selectors or update baselines merely to hide a visible regression. Record mocks versus live components/data in each artifact. A download event alone does not prove a parseable complete PDF; open/parse saved bytes.

### 14.6 Physical PDF / client preview acceptance

Generate synthetic fixtures through the actual service/API for all three documents. Open a normal invoice, normal receipt, summary and a maximum/long multipage invoice in the browser PDF viewer and at least one independent desktop PDF reader (record exact application/version). Inspect first, continuation and final pages at 100% and print preview A4, plus Letter fit-to-page/grayscale. Actual paper printing is optional; physical-page layout inspection is mandatory.

Extract text with an independent PDF parser (for example Poppler `pdftotext`) and compare names/references/amounts/page count; inspect page images at readable resolution for clipping/overlap/blank extra pages. Search/select/copy text, inspect embedded fonts and Unicode behavior. Verify logo fidelity, bold/regular weights, long addresses, row splitting/repeated headings, totals once, footer separation, refund/non-tax/test qualifiers and no sensitive metadata. Inspect preview failures on supported browser/mobile combinations; document native viewer limitations and fallback.

Record file SHA-256, size, pages, fixture ID, template/font versions, reader/browser, viewport/print settings, opened pages, findings and fixes. Keep only synthetic PDFs in evidence. Never publish customer PDFs or real shipping details in screenshots. No claim of PDF/UA/A or legal certification without the applicable independent validator/authority.

### 14.7 Optional attachment tests

When enabled, extend existing domain/transport/dispatcher unit and real PostgreSQL race tests: no descriptor/v1 remains attachment-free; supported v2 maps correct type; no cross-account receipt; stable facts across retry/deploy; oversized file omitted; render error before STARTED; lease expires while rendering; crash before/after STARTED; provider accepted then ack lost; retryable rejection; permanent rejection; 401/403 pause; timeout/5xx UNCERTAIN; accepted historical rows never replayed; privacy-purged/suppressed rows not reconstructed; OTP payloads unchanged.

Capture mode verifies serialized payload/size and real PDF content without sending. Authorized live Brevo gate, if requested, uses bounded synthetic recipients, one event per intended existing transition, provider acceptance plus actual attachment received/opened. Mailbox access unavailable means inbox gate NOT VERIFIED. Do not rerun the previous six-email purchase experiment merely because this task exists; run only if the optional attachment integration changes that risk and authorization covers it.

## 15. Commands, evidence and efficient execution

### 15.1 Implementation sequence

1. Source sync + ownership/CCR + concise plan; confirm commercial legal mode, no-migration decision, font/script support and optional attachment deferral/enabling.
2. Bounded renderer spike on real deployment runtime; prove selectable Unicode, deterministic bytes, multipage layout, assets and cancellation. Resolve library blocker before full UI work.
3. Pure domain snapshot/eligibility + read service + secure API; focused Vitest/Supertest and no-side-effect checks.
4. Shared binary client extension and frontend panel/chooser/preview; component/Storybook/transition tests.
5. Authorized real PostgreSQL/real-stack PDF evidence, physical opens, responsive browser/axe/visual QA; fix material defects.
6. Optional attachments only after mandatory path stable; keep separate acceptance evidence and default-off rollout.
7. Changed-file/direct-dependency review, documentation, one final safe full suite, independent architect review and stop at the requested boundary.

### 15.2 Existing command conventions

Commands below are future implementation examples, **not executed for this specification**. Verify installed scripts, test environment and opt-in flags before use. No command here grants DB/worker/provider authorization.

```sh
# Repository root: existing scripts
npm run typecheck
npm run lint
npm run build
npm run test:frontend
npm run test:ci --workspace=apps/backend
npm run build-storybook --workspace=apps/frontend

# Frontend directory: compare with existing baselines; do NOT add --update-snapshots
npx playwright test -c playwright.orders.config.ts

# Repository root
git diff --check
git status --short --branch
```

During development select exact changed test files via Vitest/Playwright, not every suite after every edit. Backend default `test` includes broad integration patterns; inspect environment and use the established safe `test:ci`/focused exclusions with explicit reasons. Do not call a subset “full suite”: the final evidence lists the complete safe applicable set, exclusions and separate authorized DB gate. Before the single final run, ensure all live flags/credentials cannot activate remote fixture suites/workers. If no existing script safely runs the required set, prepare a narrowly scoped documented test command instead of blindly invoking `npm test`.

After the single final safe full suite passes, rerun only checks affected by a subsequent meaningful change/failure/new risk. Do not repeat unrelated payment, auth, Brevo or database audits. Existing credible evidence is acceptable for unchanged dependencies. New protected auth client parsing requires focused JSON/auth regressions; no reason to relitigate the entire closed payment architecture.

### 15.3 Evidence artifact

Deliver `docs/tasks/Phase-03/TASK_03.9_IMPLEMENTATION_EVIDENCE.md` during implementation, with concise rows: requirement ID, source path, command, environment, SHA, date/time, exit code/count, PASS/FAIL/NOT VERIFIED/N/A and artifact link. Separate unit/mocked API, real Postgres, intercepted browser, real-stack browser, actual opened PDF, optional mailbox and production evidence. Preserve useful full logs in controlled artifacts; do not paste thousands of lines or credentials.

Evidence must include final exact changed-file list; legal/no-migration/version decisions; library/font licenses and versions; API examples/headers; query/resource measurements; browser/reader matrix; screenshot inspection notes; PDF hashes; optional-attachment status; protected approvals; unresolved risks; rollback/rollout plan. No tests or production-readiness claims are inferred from this document's existence.

## 16. Acceptance traceability and deliverables

Every row needs implementation paths and actual evidence at handoff. Unmet mandatory rows are blockers; optional rows may be N/A with the feature disabled and documented.

| ID | Acceptance criterion | Required evidence |
| --- | --- | --- |
| PDF01 | Approved base/feature branch, related files and protected ownership preserved | Git status/SHA/manifest/CCRs |
| PDF02 | All three distinct real documents, clear legal-mode labels and truthful purpose | PDF samples + UI/API contracts |
| PDF03 | Complete authority/legacy/refund/cancel matrix; no false payment proof | Domain tests + real persisted fixtures |
| PDF04 | Exact historical money/items/address; no invented tax/billing/seller facts | Independent expected values + snapshot-change tests |
| PDF05 | Explicit on-demand decision; no unnecessary migration; versioned deterministic output | Schema diff + byte/content tests |
| PDF06 | Owner-scoped listing/preview/download and safe status/error contracts | Supertest + real PostgreSQL A/B/C |
| PDF07 | Private headers, safe RFC filename, complete bounded PDF, no secret leaks | Header/binary/security tests |
| PDF08 | Zero payment/cart/inventory/email side effects on any document GET | Spies + before/after real row evidence |
| PDF09 | Shared branded print-safe multipage layout, selectable Unicode and embedded fonts | Opened PDFs/text extraction/reader matrix |
| PDF10 | Packaged assets, runtime compatibility, missing-asset handling | Built container/offline smoke evidence |
| PDF11 | Exact Confirmation/Details placements and history click isolation | Real page captures + interaction assertions |
| PDF12 | Loading/preview/download/errors/session/account-switch lifecycle safe | Component + Playwright transition tests |
| PDF13 | Responsive 390/768/1440/1920 + stress/zoom, keyboard and axe | Opened screenshots + manual/a11y record |
| PDF14 | Real-component Storybook states built and inspected | Story inventory/build/a11y evidence |
| PDF15 | Time/byte/page/queue/concurrency limits and measured memory/query performance | Stress/cancellation metrics |
| PDF16 | Conditional schema path, if required, forward-only and physically verified | ADR/CCR/SQL/hash/authorized DB readback or N/A |
| PDF17 | Optional attachments preserve snapshots/outbox crash/retry/OTP behavior | Dedicated tests/capture/mailbox gate or DEFERRED/off |
| PDF18 | Safe final applicable suite and focused regressions; no fabricated evidence | Exact commands/exits/exclusions |
| PDF19 | API/feature/runbook/evidence docs and production readiness limits | Documentation diff and release gate |
| PDF20 | Independent /100 review and explicit verdict with residual risks | Architect report; no self-approval |

Required final deliverables: implementation source/tests if later authorized, three synthetic real PDF fixtures plus generator/inspection instructions, reusable UI stories and browser scripts, safe API examples, packaging/font manifest, decision record, task evidence and independent review. Do not include real customer PDFs, secrets or generated dependency directories in the change.

## 17. Review process, score and stopping rules

### 17.1 Risk-based time boxes

- **Low risk: 5–15 minute target** — isolated copy, docs or spacing change without changed authority/persistence. Read full changed files, relevant visual evidence and focused checks.
- **Medium risk: 15–40 minute target** — additive read DTO, PDF layout, bounded renderer or frontend integration. Review direct consumers, error/resource/auth transitions and targeted API/UI evidence.
- **Critical: full critical-path review, no arbitrary cap** — cross-user authorization, shared auth/binary refresh behavior, financial eligibility/snapshot consistency, legal issuance, migration/number allocation, worker leases/UNCERTAIN semantics or optional event producer changes. Deep review only these risks and dependencies, not the whole repository.

These ranges are planning targets, not a demand to spend all the time or permission to ignore blockers. The baseline task combines medium implementation work with critical security/financial verification. Accept sufficient credible existing evidence. No repetitive audits or escalating test demands without a concrete defect/risk.

### 17.2 Implementation self-review

Read original task and this spec; inspect every changed file in full and affected caller; verify U01–U12 / PDF01–PDF20; inspect actual PDFs/screenshots and failure states; check source truth, no-side-effects, schema history, auth lifecycle, resources and optional outbox interleavings. Report a self-score if desired but label it self-review, not independent approval. Do not hand obvious visible defects to the owner as first-line QA.

### 17.3 Independent Principal Architect review /100

An independent reviewer reads task prompt and implementation summary, actual changed files and relevant surrounding code, available tests/QA, and evaluates architecture, security, edge cases, performance, migrations and API compatibility proportionately. Reuse prior evidence for unchanged contracts. Only actionable defects or material verification gaps block acceptance; optional refinements are separate.

| Category | Points |
| --- | ---: |
| Correctness and requirements | 20 |
| Security | 20 |
| Architecture and compatibility | 15 |
| Concurrency and database safety | 15 |
| Tests and evidence | 15 |
| Performance and reliability | 10 |
| Documentation and operations | 5 |

Required verdict: **✅ Approve** when required acceptance gates pass and residual risk is acceptable; **⚠ Request Changes** for fixable material defects/missing evidence; **❌ Reject** for fundamental unsafe design, contract violations or unauthorized actions. Unresolved P0/P1 blocks regardless of numeric score. Give a score /100 with evidence-based reasoning, exact blocker locations/fixes, optional improvements and residual risks. A number alone does not approve work.

Implementation-complete ≠ independently approved ≠ integrated ≠ released. Offline-only evidence cannot be labeled full runtime acceptance; missing mandatory authorized runtime gates remain NOT VERIFIED. An architect may approve a clearly limited offline/spec scope while separately retaining rollout gates. No implementation score, approval or deployment result is invented in this specification.

### 17.4 Stop / escalation

Stop affected work for: owner/shared-file conflict; unexpected changes; incorrect target identity; unapproved database/send/worker action; unknown migration/drift; financial mismatch; false paid/issued/tax label; cross-user leak; auth race; broken required Unicode; unbounded resource use; unsupported legal numbering/retention requirement; renderer network access; duplicate email/UNCERTAIN replay; credentials in output; tests weakened; mandatory visual/runtime evidence unavailable.

Report exact evidence, risk, safe options and owner decision needed; continue unrelated authorized work. Never fix by disabling auth/RLS/CSP/TLS, inventing facts, changing historical SQL, resetting data or broadening scope. Once criteria pass and no material blocker remains, approve with documented residual risks and stop; do not reopen resolved decisions or demand perfection.

### 17.5 Final implementation report template

```text
TASK / WORKSTREAM / OWNER:
BASE SHA / REVIEWED SHA / BRANCH / WORKTREE:
STATUS: implementation / review / integration / release separately
SUMMARY / EXACT CHANGED FILES:
U01–U12 AND PDF01–PDF20 TRACEABILITY:
LEGAL MODE / SELLER-TAX LIMITATIONS / TEST-LIVE PROVENANCE:
ON-DEMAND VS ISSUANCE / SNAPSHOT / DETERMINISM / VERSIONS:
API / OWNER SECURITY / AUTH CLIENT COMPATIBILITY:
DATABASE DIFF / MIGRATION AND PHYSICAL EVIDENCE OR N/A:
LIBRARY / FONT LICENSES / CONTAINER / RESOURCE LIMITS:
TEST COMMANDS / EXITS / COUNTS / ENVIRONMENT / EXCLUSIONS:
STORYBOOK / PLAYWRIGHT / AXE / OPENED SCREENSHOTS:
REAL PDF HASHES / OPENED READERS / PRINT / UNICODE:
OPTIONAL ATTACHMENTS: DISABLED-DEFERRED / VERIFIED SCOPE
PERFORMANCE / MEMORY / QUERY EVIDENCE:
DEV / PROD / PROVIDER / Figma: VERIFIED / PARTIAL / NOT VERIFIED
PROTECTED APPROVALS / ACTUAL OPERATIONS:
BLOCKERS / OPTIONAL IMPROVEMENTS / RESIDUAL RISKS:
SELF-REVIEW SCORE (NOT APPROVAL):
INDEPENDENT ARCHITECT SCORE /100 AND VERDICT:
ROLLBACK / RELEASE CONDITIONS:
COMMIT / PUSH / MERGE / DEPLOY STATUS:
```

## 18. Source links, decision references and readiness limits

- [Pinned repository baseline](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/tree/510b41cd4da7f0260e711df0db099148060b6c97) and [PR #31 merge](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/commit/510b41cd4da7f0260e711df0db099148060b6c97): repository evidence only; not a new runtime certification.
- [Task 03.7](TASK_03.7_ORDER_MANAGEMENT.md), [Task 03.8](TASK_03.8_EMAIL_NOTIFICATIONS.md), [03.8 recorded evidence](TASK_03.8_IMPLEMENTATION_EVIDENCE.md), [migration policy](../../06_Database/MIGRATIONS.md): existing architecture/template/contracts and historical evidence.
- [PDFKit text/font documentation](https://pdfkit.org/docs/text.html), [streaming and setup](https://pdfkit.org/docs/getting_started.html), [accessibility](https://pdfkit.org/docs/accessibility.html): evaluated capabilities; version-specific integration and Unicode proof remain implementation gates.
- [RFC 6266 Content-Disposition](https://www.rfc-editor.org/info/rfc6266/): safe filename/header contract.
- [Brevo transactional send API](https://developers.brevo.com/reference/send-transac-email): content/name attachment support; account limits and actual delivery require later verification.
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api) and [changelog](https://supabase.com/changelog): database exposure/RLS guidance. The markdown changelog endpoint was unavailable; the web changelog was inspected. No new Supabase SDK/auth/storage feature is introduced. Repository Prisma governance remains authoritative.

External technical documentation was checked on 2026-10-19. Legal jurisdiction is unspecified; no legal tax rules were asserted. Dependency compatibility, actual fonts, runtime PDF quality, database physical state, browser/Figma fidelity, mailbox delivery and production readiness are **NOT VERIFIED by this specification**. They are concrete later acceptance gates, not reasons to perform unauthorized operations now.

**Completion rule:** A customer can retrieve accurate, secure and polished documents repeatedly without a purchase side effect; every mandatory requirement has sufficient evidence; the independent Architect gives an explicit verdict. Stop at that approved scope and preserve separate integration/release authorization.
