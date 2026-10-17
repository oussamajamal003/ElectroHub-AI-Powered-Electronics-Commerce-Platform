# ELECTROHUB — TASK 03.6 / STRIPE TEST MODE & PAYMENT ORCHESTRATION

**Phase:** 03 — Commerce  
**Task:** 03.6 — Stripe  
**Branch:** `feature/Stripe`  
**Target branch:** `develop`  
**Scope:** Full-stack / UI / API / Database / Payment transaction / Webhooks / Storybook / Testing / Playwright / Real-browser QA / Documentation / Architect review  
**Status before implementation:** NOT STARTED  
**Authority:** This is the authoritative implementation specification for ElectroHub 03.6, subject to the explicit user request, roadmap boundaries, and verified repository contracts.  
**Prepared:** 2026-10-06  
**Expected repository location:** `docs/tasks/Phase-03/TASK_03.6_STRIPE.md`

> **Primary outcome:** Replace the safe 03.5 payment shell with a real, local Stripe Test Mode flow. Authorize payment before the authoritative purchase transaction, reuse existing Checkout/Order/Inventory foundations, capture only after commit, reconcile without relying on the browser, and show Paid only after verified capture. Deliver a polished, responsive, accessible first handoff with reproducible tests, inspected screenshots, and explicit recovery evidence.

---

# Task-Specific Visual / UX Invariants

- Preserve the current customer Header/Footer, Checkout hierarchy, four-step navigation, Review cards, and desktop summary composition.
- Stripe owns PAN/CVC/expiry entry. No application-owned raw card fields, persistence, transmission, or fake decline simulation.
- Payment → Review validates provider entry without charging. Final Place Order / Pay is the purchase action.
- Retain safe Shipping/Delivery drafts through edits and retry. Never reuse an authorization for different purchase facts.
- Authorization is not Paid. Unresolved payment is not failure, empty Cart, or confirmed payment.
- Use ElectroHubLoader. Prevent duplicate purchase interaction in both UI and backend.
- Preserve Cart and stock on decline or pre-commit failure. After commit, resolve capture failure through durable compensation, never a false rollback claim.
- Display real Stripe metadata only when available; never copy `5647`, an example order reference, or example dates as facts.
- Payment, Review, Processing, Pending, Failed, and Confirmation must work at 390 / 768 / 1440 / 1920.
- No PayPal implementation, prototype bottom controls, Order Management, email, PDFs, tracking, hosted deployment, or live charges.
- Capture AND OPEN every required screenshot. Passing automation alone is not visual approval.

---

# 1. Task Objective

Implement the complete Stripe payment boundary explicitly deferred by 03.5:

- Stripe server SDK and Stripe.js/React integration;
- Payment Element replacing the provider placeholder;
- server-authoritative PaymentIntent amounts;
- authenticated, owned checkout payment attempts;
- manual authorization/capture Option B orchestration;
- signed local webhook handling;
- server reconciliation, status mapping, duplicate protection, and crash recovery;
- success, decline, authentication, pending, canceled, and recovery behavior;
- real provider brand/last-four when safely available;
- Buy Now through the existing Cart/Checkout path;
- production-quality UI, Storybook, automated testing, real PostgreSQL concurrency/rollback verification, real Stripe Test Mode browser verification, documentation, and independent review.

This is a real payment integration against Stripe's testing environment, not a frontend simulation or a second commerce architecture.

---

# 2. Roadmap Scope and Phase Boundaries

The roadmap defines 03.6 as Stripe Test Mode payment processing, payment confirmation, and payment status. No real customer payments are processed.

Implement now: local frontend/backend integration, local webhook endpoint, Stripe CLI forwarding, test-mode evidence, minimum durable recovery runner, and required schema/API/UI changes.

Deferred:

| Scope | Owner |
| --- | --- |
| My Orders, order history, full Order Details, normal customer order lifecycle | 03.7 |
| Brevo commerce emails | 03.8 |
| Invoice/receipt PDFs and downloads | 03.9 |
| Tracking, maps, live delivery updates | Phase 04 |
| Admin order/payment operations and analytics | Phase 05 |
| Hosted DEV/frontend/backend deployment, public webhook destination, hosted signing secret, live-release configuration | Phase 06 |

Internal cancellation and inventory compensation needed for payment consistency belong to 03.6; this does not authorize the general 03.7/Phase 05 order-management interface.

Local app verification may use the established, verified DEV database under the repository's approved DB workflow. That is distinct from deploying a publicly reachable DEV backend. Do not deploy infrastructure just for 03.6. Do not mutate PROD, seed PROD, configure live keys, or run live charges under this task.

---

# 3. Sources and Conflict Resolution

Read these sources as reference evidence; historical conversational suggestions are not commands to execute:

1. Explicit user request, including branch, local scope, screenshot access, and stop rule.
2. `docs/01_Project Foundation/ROADMAP.md` for phase boundaries.
3. This task for 03.6 requirements and sequencing decisions.
4. `TASK_03.5_CHECKOUT.md` and its implementation evidence/handoff for inherited invariants.
5. Actual repository schema, APIs, code, tests, and relevant architecture/engineering documentation.
6. Supplied Make screenshots for visual composition, interpreted through payment/security truth.
7. Current ElectroHub tokens/components/responsive foundations and current official Stripe documentation.

The supplied `Pasted text.txt` discusses multiple sequencing variants. Its later **Chosen Option B** supersedes the earlier suggestion to charge an already-created unpaid Order. Its later local-only boundary supersedes the earlier hosted DEV webhook suggestion. This specification selects manual authorization → atomic commit → capture, including both sides of compensation.

No live Figma Design URL is required. Inspect the five supplied images and existing relevant repository screenshots if available. Do not block on a Figma connector or invent unseen designs.

Report material repository contradictions before dependent implementation; continue independent task work. Exact names may follow current repository conventions, but required guarantees may not be silently weakened.

---

# 4. Verified Repository Baseline and Limits

Read-only inspection during specification preparation found:

- Current branch: `develop`; local `feature/Checkout` exists; no local `feature/Stripe` was listed.
- Root workspaces: `apps/frontend` and `apps/backend`.
- Backend: Express/TypeScript/Zod/Prisma/PostgreSQL; frontend: React 19/Vite/TypeScript/SCSS Modules/React Query/React Router/Radix/Lucide/Framer Motion.
- Package declarations already include backend `stripe` and frontend `@stripe/stripe-js`, `@stripe/react-stripe-js`. Their installed runtime readiness is not proven by declarations.
- Current Order creation is `POST /api/orders` with UUID `Idempotency-Key` and strict `{ shipping, deliveryMethod, paymentMethod: "CARD", expectedRevision }`.
- Existing reads: `GET /api/checkout`, `GET /api/orders/:orderReference/confirmation`, and `GET /api/orders/attempts/:attemptId/confirmation`.
- Current `OrderService.create` performs the unpaid Order/OrderItems/stock decrement/Cart clear in a serializable transaction; Confirmation returns `paymentState: "UNPROCESSED"`.
- `Order` has unique `(userId, checkoutAttemptId)` and a request hash; public reference is `ORD-` plus its UUID, not a separate reference column.
- Existing `Payment` requires unique non-null `orderId`, has unique optional `providerPaymentId`, Decimal amount, currency, paidAt, and status. It cannot alone represent an attempt before Order creation.
- Current payment enum: `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `REFUNDED`; order enum: `CONFIRMED`, `PREPARING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`.
- Backend default port is 5000. `app.ts` currently parses JSON before API routes; the webhook requires deliberate middleware ordering changes.
- Backend loader reads development `.env` + `.env.local`, test `.env` + `.env.test.local`, and production `.env` + `.env.production.local`.
- Existing checkout Storybook, component tests, Playwright checkout config, DB/browser gates, and 03.5 evidence documentation exist.
- Working tree contains pre-existing changes in backend/frontend package declarations, frontend `.env.example`, and `package-lock.json`. Preserve them; inspect intent before editing those files.
- The expected root `assets/figma/` directory was not present in the inspected checkout. Use supplied images and discover the actual repository layout.

Recheck all baseline facts at implementation time. Historical 03.5 evidence is a handoff, not proof that 03.6 works. No payment, database, browser, migration, CI, or production verification is claimed by this specification. Stripe CLI was reported installed/logged in by the user; its executable did not start in the specification session. Do not treat that environment limitation as proof that the user's CLI installation is missing.

---

# 5. Mandatory Repository-First Workflow

Before coding:

1. Read applicable `AGENTS.md`, this complete task, roadmap scope, 03.5 task/evidence, and relevant docs.
2. Inspect branch, status, recent history, dependency lockfile, existing tests, and API consumers. Preserve user changes.
3. Establish `feature/Stripe` from the verified `develop` baseline using the approved Git workflow. Do not reset or discard changes. Do not commit/push/merge.
4. Inspect Cart locks/mutations, Inventory primitives, Order transaction, checkout revision/hash, confirmations, auth, error envelopes, environment loader, and logger redaction.
5. Inspect frontend draft ownership, QueryClient/CartProvider, step routing, loader, shared components, tokens, Storybook, and Playwright.
6. Open every supplied screenshot and compare against product requirements before implementing.
7. Produce the visual classification matrix, related-file manifest, API/DB compatibility decision, state machines, recovery design, and bounded implementation plan.
8. Implement → test → run real local app and Stripe CLI → inspect DB/payment state → capture/open screenshots → fix task defects → review all changed files → update docs → report → stop.

Use a bounded plan following the previous task architecture; do not make repeated permission prompts for routine implementation choices already authorized. This generation request itself authorizes producing the specification, not starting implementation or external writes.

---

# 6. Related-File Manifest and Documentation Discovery

Before implementation list every relevant file, why it matters, whether it changes, and requirement IDs served. Categories: CORE IMPLEMENTATION / DIRECT INTEGRATION / DB-MIGRATION / TEST / STORYBOOK / E2E / DOCUMENTATION / DESIGN-EVIDENCE.

Discover task-relevant documents under:

- `docs/01_Project Foundation/`: roadmap, stack, structure, dependencies, decisions;
- `docs/02_Design/`: tokens, typography, components, layouts, motion, responsive rules;
- `docs/03_Architecture/`: frontend/backend/API/database architecture;
- `docs/04_Engineering Standards/`: API, state, logging, security, performance, TypeScript/SCSS;
- `docs/05_Features/`: Auth, Cart, Inventory, Checkout, Orders, payment feature docs;
- `docs/06_Database/`: schema/migrations/indexes/relationships/seeding and 03.4 handoff;
- `docs/08_Quality/`: testing, Storybook, E2E, accessibility, Definition of Done;
- `docs/09_Deployment/`, `docs/10_Operations/`, `docs/11_Workflow/`: only relevant environment, recovery, review, and Git guidance;
- `docs/ADR/`: existing ADRs; add a focused payment-orchestration ADR for this consistency change.

Do not read unrelated AI/admin/email/PDF documentation unless a direct dependency appears. Do not create a competing documentation hierarchy.

---

# 7. Critical Architecture Statement

```text
03.2 Cart intent + 03.4 Inventory authority + 03.5 Checkout/Order core
                              ↓
03.6 owned payment attempt + Stripe PaymentIntent + verified authorization
                              ↓
existing authoritative atomic purchase transaction, adapted for Option B
                              ↓
durable capture command → verified Stripe capture → Paid confirmation
```

Reuse the existing Order model, immutable snapshots, checkout totals, Cart economic revision, locks, bounded serialization retry, InventoryService, and idempotency infrastructure. Do not call the old public unpaid creation path before payment authorization. Extract/reuse its transactional core; do not duplicate it into a second order builder.

Stripe/network calls must run outside PostgreSQL transactions. No DB lock may be held while awaiting Stripe, 3DS, the browser, or a webhook. Stripe and PostgreSQL do not share an atomic transaction; implement a durable orchestration with recovery rather than claiming distributed atomicity.

---

# 8. Selected Option B — Authorization → Commit → Capture

Required normal path:

```text
Authenticated valid Cart
→ Shipping → Delivery
→ create/reuse owned immutable payment attempt and manual-capture PaymentIntent
→ Stripe Payment Element
→ validate entry → Review (no authorization/capture yet)
→ explicit final Place Order / Pay
→ Stripe confirmation / 3DS
→ server retrieves and verifies requires_capture authorization
→ FINAL DATABASE TRANSACTION
   lock attempt + Cart in consistent order
   recheck owner, current Cart/Product/category/Inventory
   verify reviewed revision, shipping/delivery, amount/currency
   create one Order + immutable OrderItems + linked Payment
   InventoryService.decreaseStock(..., same tx) for all lines
   clear purchased Cart intent
   record durable capture work and committed attempt outcome
→ COMMIT
→ capture exact authorized total outside transaction
→ verify succeeded and full amount received
→ persist payment success/paidAt, complete durable work
→ owned refreshable Order Confirmed + Paid
```

Use `capture_method: "manual"`; support the approved CARD flow with eligible methods. Capture promptly after commit. Authorization lifetime is finite: obtain provider expiry information where supported and reconcile before expiry; do not assume an unconditional fixed seven-day window. See [Stripe separate authorization and capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).

Do not switch to charge-first/refund-later, introduce speculative reservation infrastructure, or enable payment methods that bypass this sequencing without an explicit architectural amendment. A reservation alternative would need its own expiry/release/concurrency design and is not the chosen baseline.

---

# 9. Business and Consistency Invariants

- Before verified authorization: no Order creation, stock consumption, or Cart clearing.
- Decline/auth cancellation before commit: no purchase effects; preserve Cart and safe draft.
- One immutable attempt buys one reviewed Cart revision for one owner and one exact currency/total.
- Authorization/processing/unknown outcome cannot be displayed as Paid.
- One atomic DB commit owns Order + OrderItems + Inventory decrement + Cart clear + payment linkage + capture work.
- Stock never becomes negative; multi-item failure rolls back all DB purchase effects.
- Exactly one purchase consumes an unchanged Cart, even across distinct attempt keys/tabs.
- Exactly one successful capture is allowed for that purchase; no second PaymentIntent on timeout.
- After commit, failures require durable recovery or compensation; the already committed transaction cannot be retroactively rolled back.
- No fulfillment/Preparing/Delivery initiation is allowed before verified full capture.
- Success must recover without a browser callback and survive process restart.
- No unresolved paid-but-unfulfilled or committed-but-unpaid attempt may be silently abandoned.

---

# 10. Payment Attempt Identity and Immutable Purchase Snapshot

Persist a pre-Order attempt before provider creation with semantic equivalents of:

```text
opaque attempt ID, owner ID, Cart ID
client idempotency key + canonical request hash
Cart economic revision and normalized shipping/delivery choices
immutable intended lines/quantities/prices and authoritative totals/currency
provider environment/account context, PaymentIntent ID when known
provider status + orchestration status + outcome timestamps
Order link after commit
authorization/capture/cancel/refund/recovery operation identities
retry count, next retry time, lease/version/fencing where needed
sanitized failure category; expiry/supersession information
```

Exact model/column names follow repository standards. A minimal durable attempt is necessary because `Payment.orderId` currently requires an existing Order. Prefer an owned attempt structure linking the existing Payment after commit rather than creating a parallel Payment/Order universe. If choosing nullable Payment ownership instead, document and test the full invariant/backfill consequences before migration.

Do not persist client secrets, ConfirmationToken secrets, PAN/CVC/expiry, full webhook payloads containing unnecessary PII, or arbitrary raw provider errors. Preserve bounded business snapshots needed for safe finalization and compensation.

---

# 11. Money and Purchase Authority

Use existing Prisma Decimal rules for Product subtotal, shipping, and total. For current USD flow convert Decimal to exact integer cents without binary floating-point rounding, rejecting overflow, unsupported precision, invalid currency, zero/negative totals, or Stripe limits.

Server owns Product prices, active Product/category, quantities allowed, delivery pricing, currency, ownership, snapshots, and payment status. Client sends choices and expected revision only; it cannot submit authoritative prices, stock, total, user ID, or Paid state.

Preserve current delivery semantics unless verified requirements change: STANDARD USD 0.00, EXPRESS USD 9.99, OVERNIGHT USD 19.99, with existing delivery estimates. Do not add tax, coupons, adaptive currency, subscriptions, or saved cards under this task.

At final commit require exact matches between attempt snapshot, current authoritative checkout, PaymentIntent amount/currency, capturable amount, and intended capture. Do not silently capture less, charge more, clamp quantity, or rewrite purchased prices.

---

# 12. Checkout Changes and Attempt Supersession

Shipping/delivery/Cart/Product-price changes affecting the immutable request must invalidate or supersede the old attempt and require re-review. The current economic revision excludes stock, so independently revalidate Inventory at final commit.

Editing before authorization may create a replacement only after safely disabling/reconciling the previous attempt. An authorized old attempt must be canceled outside the DB transaction if it is no longer purchasable. Do not allow two active attempts for the same purchase to independently capture.

Changing card details on a failed, still-compatible attempt may retry its existing PaymentIntent when Stripe permits. Changes to purchase facts require a new immutable attempt identity; do not reuse an idempotency key with altered parameters.

Stale setup/status responses must not overwrite the current attempt. Guard against browser Back, multiple tabs, slow network, and account transitions. No stock reservation is implied by mounting the Payment Element.

---

# 13. Server Verification Before Purchase Commit

Retrieve the PaymentIntent server-side using the persisted provider ID. Verify:

- owned attempt and authenticated active CUSTOMER for browser actions;
- correct configured Stripe test account/environment and `livemode: false`;
- persisted provider ID binding, not client-supplied metadata alone;
- exact amount/currency and manual capture semantics;
- eligible payment method and current `requires_capture`/full capturable authorization;
- no prior successful/canceled/refunded/compensated incompatible outcome;
- intended request hash/revision/shipping/delivery and no supersession;
- authorization remains valid.

Webhook recovery authenticates Stripe by signature and uses persisted ownership; it must not require a customer's JWT to complete previously authorized work. Validate account/user/Cart availability according to the documented recovery policy and compensate if final purchase cannot safely proceed.

---

# 14. Atomic Purchase Transaction and Existing Inventory Reuse

Adapt existing serializable OrderService transaction to an internal verified-attempt capability. Public callers cannot bypass verification using an `authorized: true` flag.

Inside one bounded transaction:

1. Lock/serialize attempt and Cart consistently; recheck an already committed result first.
2. Reuse sorted Product/category/Inventory locking and currentCart projection.
3. Validate non-empty Cart, ownership, active Product/category, quantity limits, Inventory, shipping/delivery, revision, and exact attempt totals.
4. Create one Order with existing shipping/item snapshots, unique attempt linkage, and correct internal capture-pending semantics.
5. Create/link existing Payment as pending/processing, never SUCCEEDED merely from authorization.
6. Decrement through existing transaction-aware `InventoryService.decreaseStock`; no nested transaction or handwritten second algorithm.
7. Clear the purchased Cart under the same Cart lock.
8. Persist committed attempt result plus unique durable capture command.

Any failure rolls back all these DB effects. Process inventory IDs in deterministic order. Preserve bounded serialization retries only for documented transaction conflicts. Revalidate claim/version inside the commit so canceled/superseded workers cannot write stale purchase state.

The existing default Order `CONFIRMED` is insufficient to communicate payment readiness by itself. Document an internal awaiting-capture state or an explicit payment gate with equivalent guarantees. UI and future fulfillment consumers must respect that gate.

---

# 15. Capture, Success, and Unknown Capture Outcomes

After commit, execute the persisted capture command outside the transaction with a stable Stripe idempotency key specific to that operation. Capture the exact full intended total only; partial/multiple capture is out of scope.

After provider success, persist Payment `SUCCEEDED`, verified paid amount/currency, paidAt, safe card metadata, and completed work atomically. A timeout after provider capture is **unknown**, not failed: retrieve the same intent, reuse the same operation identity, and never create another intent or restore stock based solely on transport errors.

If Stripe succeeds but the success DB write fails, leave durable pending work; webhook/recovery retrieves and persists the already successful result. A delayed older processing/failed event must not downgrade this outcome.

See [Stripe capture API](https://docs.stripe.com/api/payment_intents/capture) and [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

---

# 16. Pre-Commit Failure Compensation

If authorization succeeds but current stock, price, Cart, shipping/delivery, ownership, or transaction commit fails:

- no Order/OrderItems/stock decrement/Cart clear may survive;
- record durable cancellation/recovery intent;
- cancel the authorization outside the transaction using stable operation identity;
- verify terminal provider cancellation and record outcome;
- if cancel times out, continue reconciliation rather than claiming the hold was released;
- show actionable conflict/pending recovery copy, preserving safe draft and Cart;
- require correction and re-review before a new purchase.

The frontend must distinguish a bank authorization hold from a captured charge. Do not promise instant bank-side release timing. If an unexpected captured intent exists without a purchasable Order, follow the consistency repair rule in section 18.

---

# 17. Post-Commit Capture Failure Compensation

For a committed Order whose capture fails definitively:

1. Retrieve/reconcile Stripe state. Attempt cancellation of any remaining authorization outside transactions; confirm terminal cancellation or a definitive noncaptured expired state before releasing purchase effects.
2. In one idempotent compensation transaction, lock the attempt/Order/Inventory consistently, verify it is not paid/fulfilled/previously compensated, mark internal Order canceled/payment failed, and restore each consumed quantity exactly once through existing Inventory increase primitives.
3. Preserve historical Order/OrderItem snapshots for audit; do not delete the committed Order to hide failure.
4. Restore customer intent safely from the committed purchase snapshot without overwriting new Cart changes. Use current Cart locks and merge only the purchased quantities according to existing bounds/uniqueness rules.
5. If current product availability or quantity/line limits prevent a full merge, retain the unmerged intent durably with actionable recovery information. Do not lose it or claim full restoration.
6. Complete compensation work only when both provider and DB outcomes are verified.

During uncertain capture/cancel state, keep the Order nonfulfillable and show Pending/recovery. Never restore Inventory while a capture can still settle unnoticed. A stale worker must not reverse a success; use shared operation serialization and state checks, including provider reconciliation after ambiguous outcomes.

The screenshot's “Your cart has been preserved” is valid for pre-commit decline. Post-commit recovery needs truthful “Cart restored” / “Recovery in progress” / partial-restoration wording backed by actual persisted state.

---

# 18. Unexpected Capture Without a Purchasable Order

Manual-capture configuration must make this abnormal, but external account actions/configuration drift must not leave money silently stranded.

If a verified succeeded intent has no committed purchasable Order, or has an amount/currency inconsistent with the immutable attempt:

- do not blindly create an Order or decrement stock;
- retain a durable consistency incident and sanitized reason;
- initiate an idempotent refund only for the verified owned test intent and appropriate captured amount, using the established recovery policy;
- reconcile refund success/pending/failure; do not call it refunded on request submission alone;
- preserve Cart and show recovery status;
- escalate unrecoverable cases in the implementation report/operational diagnostics.

Minimum automatic refund compensation is in scope for this integration fault. A general refunds/admin/customer returns product is out of scope. A refund is not equivalent to canceling an uncaptured authorization.

---

# 19. Durable Recovery Runner

Implement the smallest repository-consistent persistent work mechanism for create-intent completion, finalize, capture, cancel, refund, and compensation. An in-memory timer, browser callback, or “try again later” TODO is insufficient.

Required: work written atomically with state transitions; unique operation identities; bounded exponential retry/backoff; attempt counts; next-run time; worker lease/claim and stale-worker protection; safe shutdown; restart recovery; terminal incident visibility. Provider calls occur outside DB transactions.

Reuse an existing queue if present; otherwise a focused DB-backed runner/command is sufficient for local 03.6. Document how to start it alongside the local backend and how to inspect sanitized backlog. Hosted runner/process deployment remains Phase 06.

Reconcile unfinished attempts at startup and on scheduled bounded scans. Resolve abandoned/expired authorizations, incomplete capture writes, and compensation work without customer presence. Lease expiry alone must not permit conflicting irreversible actions; use stable provider operation identities and fresh provider/state checks.

Define concrete retry interval, timeouts, maximum attempts, expiry handling, retention, and incident escalation in the implementation ADR. Do not allow an unbounded tight polling loop or silent permanent pending.

---

# 20. Status Contracts and State Machine

Keep provider status, orchestration status, payment status, and fulfillment status separate.

| Provider state | Semantic application behavior |
| --- | --- |
| requires_payment_method | Collect/retry compatible card; no paid/order claim |
| requires_confirmation | Ready for explicit final confirmation |
| requires_action | Authentication required; no purchase commit yet |
| processing | Pending; recover server-side; no Paid |
| requires_capture | Authorized only; eligible for verified Option B finalization |
| succeeded | Captured; persist Paid only after exact verification and consistent Order linkage |
| canceled | Terminal canceled; compensate committed unpaid purchase if necessary |

Attempt states must distinguish preparing, awaiting input/action, authorized, committing, capture pending, paid, failed/canceled, cancellation pending, compensation pending/completed, refund pending/refunded, superseded, expired, and incident/unknown. Exact enum grouping may be leaner if the same guarantees remain explicit and tested.

Existing Payment `SUCCEEDED` maps to customer-facing Paid. Use PENDING/PROCESSING where appropriate; add internal orchestration fields instead of mislabeling authorization as success. Failure may recover through a permitted same-intent retry before commit; define transition legality, not a blanket timestamp-based or numeric status ordering.

No terminal success downgrade from stale events. Paid→refunded is a distinct verified compensation path. Order Processing in screenshot 4 describes order fulfillment, while payment Processing describes unresolved payment; label them distinctly.

---

# 21. Idempotency at Every Boundary

Use existing UUID attempt key and canonical normalized request hash conventions. Required protections:

- same owner/key/body → same attempt/provider intent/Order outcome;
- same key with incompatible body → `IDEMPOTENCY_CONFLICT`;
- stable Stripe key per create/capture/cancel/refund operation, never across differing parameters;
- one provider ID bound uniquely to one owned attempt/purchase;
- unique Order attempt linkage and unique event/work identities;
- same Cart with different keys/tabs cannot create duplicate purchases or successful captures;
- concurrent browser reconciliation, webhook, and worker produce one finalization;
- unknown setup/confirmation/capture outcome reuses identity until reconciled;
- operation keys retained in durable application state; provider idempotency alone is not a permanent business guarantee.

Do not rely on disabled buttons, a global process mutex, or event arrival order. Stripe API retries and application transaction retries are separate policies.

---

# 22. Payment Element and Review Sequencing

Mount Stripe.js through the installed supported library using the publishable test key. Use one stable initialized Stripe instance and appropriate Elements provider; do not recreate it on every render.

At Payment:

- request/reuse server-owned attempt setup for the validated Shipping/Delivery/current Cart revision;
- mount Payment Element using the intent client secret;
- show loading, ready, incomplete, validation, provider unavailable, and setup conflict states;
- validate provider entry through supported Elements APIs before Review;
- do not confirm/authorize/capture merely because “Review Order” was clicked.

Preserve the live provider context across Payment/Review as supported, or use the documented deferred/ConfirmationToken flow when needed. Do not unmount provider fields and expect application state to reconstruct card data. If secure entry cannot survive navigation, explicitly ask for re-entry; do not build raw-field persistence. Document the chosen supported flow and prove Payment → Review → Back → Review → Pay in a real browser.

Final CTA runs supported `elements.submit()`/`stripe.confirmPayment()` behavior or an equivalent documented token-backed confirmation flow. Handle required authentication and configured return URL. `redirect: "if_required"` may be used when appropriate. See [Stripe Payment Element flow](https://docs.stripe.com/payments/payment-element/migration) and [server-side confirmation tokens](https://docs.stripe.com/payments/finalize-payments-on-the-server).

Metadata may be unavailable before confirmation. Review may show “Credit / Debit Card — securely entered with Stripe”; optional brand/last-four appears only when obtained safely through a supported provider flow. Do not create an extra payment solely to obtain preview metadata.

---

# 23. Stripe Method Configuration and Dependencies

Honor the approved PaymentIntent + Payment Element architecture rather than replacing the existing wizard with hosted Checkout. Verify current SDK/API compatibility from official documentation and installed lockfile/types; record chosen API version. Do not blindly install or downgrade SDKs already present.

Configure eligible approved CARD methods using the current supported API/account configuration. Do not enable PayPal, bank debits, BNPL, Link/account-saving flows, or wallets merely because dynamic methods surface them. If supporting an eligible card wallet already approved by repository truth, document and test its explicit review/auth flow. No speculative methods may invalidate manual capture guarantees.

Use current documented payment-method configuration/allowlist controls compatible with the chosen API; avoid copying obsolete parameters. Verify the actual rendered Payment Element and provider account settings. Missing account capability is a reported blocker, not permission to fake integration.

---

# 24. API Capabilities and Concrete Baseline

Reuse the central API client and `{ data: ... }` / `{ error: { code, message } }` envelopes. Preferred 03.6 additions, adjusted only for documented existing conventions:

| Endpoint | Responsibility |
| --- | --- |
| `GET /api/checkout` | Existing eligibility, revision, authoritative options/totals |
| `POST /api/checkout/payment-attempts` | CUSTOMER-owned setup/reuse; strict shipping/delivery/method/revision and UUID Idempotency-Key |
| `GET /api/checkout/payment-attempts/:attemptId` | Owned persisted outcome; safe attempt/payment/order/recovery summary |
| `POST /api/checkout/payment-attempts/:attemptId/reconcile` | Owned server retrieval and shared reconciliation; never accepts success as truth |
| `POST /api/checkout/payment-attempts/:attemptId/cancel` | Request safe abandonment; reconcile/cancel pending state; no cancel-after-paid shortcut |
| `POST /api/webhooks/stripe` | Public raw-body signature-authenticated Stripe ingress |
| Existing confirmation reads | Owned immutable Order data plus truthful payment/recovery projection |

Setup request retains current normalized shipping fields and `paymentMethod: "CARD"`; no price/user/status/provider intent supplied as authority. Setup response includes attempt ID, trusted revision/totals/currency, safe status, and client secret only for the owning active flow. Status reads must not routinely return client secrets; provide an owned bounded resume/setup capability when necessary.

Reconciliation returns current outcome, e.g. pending/action required/paid/failed/conflict/recovery, order reference when created, and safe recovery actions. Use 202 for accepted unfinished work where appropriate, 201/200 for created/replayed setup, and consistent status DTOs. Never promise synchronous capture in every request.

There is no public general-purpose capture/refund endpoint for arbitrary provider IDs. Internal operations accept persisted authorized attempt identity, not user-controlled financial instructions.

---

# 25. Legacy Order API Compatibility and Bypass Prevention

Inventory-consuming unpaid `POST /api/orders` must not remain an alternate public purchase path after 03.6. Inspect all consumers/tests and choose/document one explicit evolution:

- retain the route with an owned attempt reference and verified orchestration semantics; or
- migrate the current frontend to payment-attempt endpoints and turn unpaid creation into an internal service, returning a normalized payment-required/obsolete-contract error to unsupported public calls.

Do not continue creating unpaid Orders for the old body, silently breaking Option B. This behavior change is necessary and must update OpenAPI, frontend types, tests, docs, and consumer notes. Preserve confirmation URLs and owner-scoped recovery routes; distinguish old unpaid Orders from new Stripe attempts. Legacy records must remain viewable without inventing a provider ID or Paid status.

03.7 extends this same Order/Payment core. It must not recreate checkout or introduce another Order model.

---

# 26. Error Semantics

Use existing validation/auth/ownership conventions and normalized codes equivalent to:

```text
CHECKOUT_VALIDATION_ERROR / CHECKOUT_EMPTY_CART / CHECKOUT_CHANGED
PRODUCT_UNAVAILABLE / INVENTORY_NOT_FOUND / OUT_OF_STOCK / INSUFFICIENT_STOCK
IDEMPOTENCY_CONFLICT / PAYMENT_REQUIRED / PAYMENT_ATTEMPT_NOT_FOUND
PAYMENT_CONFIGURATION_UNAVAILABLE / PAYMENT_SETUP_FAILED
PAYMENT_ACTION_REQUIRED / PAYMENT_DECLINED / PAYMENT_PENDING
PAYMENT_ATTEMPT_SUPERSEDED / PAYMENT_AMOUNT_MISMATCH
PAYMENT_RECOVERY_PENDING / PAYMENT_UNAVAILABLE
WEBHOOK_INVALID_SIGNATURE
```

400 malformed/validation/signature; 401 unauthenticated; existing role semantics for 403; sanitized owned resource misses 404; 409 revision/stock/idempotency conflicts; 429 existing abuse controls; 5xx only genuine transient/unexpected failures. Do not turn an unknown provider result into a confirmed decline.

Return actionable customer copy, not raw Stripe/Prisma/SQL/constraint/stack details. A sanitized decline category may be shown; never disclose sensitive fraud/risk diagnostics.

---

# 27. Webhook Middleware and Signature Verification

Expose exact `POST /api/webhooks/stripe`. Mount its bounded `express.raw({ type: "application/json" })` handling before global JSON/urlencoded parsing, or preserve exact raw bytes through a proven equivalent. Keep normal JSON routes unchanged.

Use the official server SDK signature construction with exact bytes, `Stripe-Signature`, and backend `STRIPE_WEBHOOK_SECRET`. Reject missing/invalid/stale/tampered signatures before side effects. Do not verify signatures over JSON reserialization. See [Stripe webhook guide](https://docs.stripe.com/webhooks).

Webhook does not require JWT/CUSTOMER middleware or browser CSRF tokens; signature authentication is its boundary. Exempt only this narrow route from incompatible auth/CSRF policy. Keep bounded body size/security headers/error handling and appropriate abuse protections. CORS is not webhook authentication.

Logger/Sentry/request tracing must never serialize raw webhook bodies, signing headers, client secrets, or card/billing PII. Do not disable security globally to make forwarding work.

---

# 28. Required Webhook Events and Handling

Handle at minimum:

- `payment_intent.amount_capturable_updated`: authorized; retrieve/verify and enqueue/shared finalization;
- `payment_intent.succeeded`: verify captured outcome and reconcile committed Order/payment;
- `payment_intent.payment_failed`: failed confirmation or capture-related recovery as applicable;
- `payment_intent.processing`: pending, never Paid;
- `payment_intent.canceled`: cancellation/expiry, including compensation if committed;
- refund lifecycle events relevant to the chosen automatic refund compensation, with retrieved refund state verification.

Support required-action outcome through the intent/status flow; event subscriptions may include it if useful. Valid unrelated events are safely acknowledged without changing purchases.

Signature-valid does not mean an event belongs to ElectroHub. Validate persisted intent/attempt binding, environment/account, type, exact amounts/currency, and current transition legality. Metadata helps correlation but cannot assign ownership alone. Unknown valid events are durably classified/acknowledged without phantom Orders.

---

# 29. Webhook Durability, Duplicates, and Ordering

Record event identity with a unique constraint and processing/durable-work status. Do not mark an event completed before its necessary work is persisted. Return 2xx only after durable acceptance or completed processing; return retryable failure when acceptance fails.

Duplicate delivery of one event and separate events describing the same intent transition must not duplicate Order creation, stock consumption/restoration, Cart mutation, capture, or refund. Reconciliation operates on current retrieved provider state and persisted operation identities, not event order. Stale payloads cannot overwrite a later success/refund outcome.

Keep ingress fast; persist work and let the bounded recovery runner perform network/transaction operations. Browser reconciliation, webhook, and runner must invoke the same domain orchestration with shared claims/state checks.

---

# 30. Local Environment Configuration

User reports publishable/secret test keys, SDK installation, Stripe CLI installation, and CLI login already done. Verify presence/format/readiness without printing values; do not ask for secrets in chat.

```env
# Frontend local environment only
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_PLACEHOLDER

# Backend local environment only
STRIPE_SECRET_KEY=sk_test_PLACEHOLDER
STRIPE_WEBHOOK_SECRET=whsec_LOCAL_PLACEHOLDER
```

Actual credentials belong only in ignored files/runtime configuration. `.env.example` uses placeholders and cannot satisfy runtime setup.

Inspect active `NODE_ENV` and the existing loader before choosing the actual backend file. Development normally uses `.env.local`; isolated tests use `.env.test.local`; local production-build verification may use `.env.production.local` under the existing policy. Put LOCAL whsec only into the backend file actually loaded by that local process. Do not copy it indiscriminately into every environment file or hosted configuration.

Validate configuration centrally. Test-mode task rejects live publishable/secret keys and `livemode: true` results/events. Missing config produces an actionable unavailable state without logging values; unrelated app startup/tests must follow the existing optional-feature config policy. Deterministic tests use explicit fake provider adapters, not real missing-secret bypasses in production.

Restricted test credentials may be used if compatible and sufficient, but the user's already established `sk_test_` local setup is the baseline. No new account provisioning or key rotation is required absent evidence of a problem.

---

# 31. Local Stripe CLI Webhook Runbook

Use existing CLI/login rather than reinstalling automatically. Confirm executable/version/auth context with safe commands, never dump the credential configuration.

1. Implement the signed raw-body route and start the local backend on the verified port.
2. Forward test events:

```powershell
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

3. If using an event filter, include authorization, success, failure, processing, canceled, and required refund events; do not filter out `amount_capturable_updated`.
4. Take the listener's generated LOCAL signing secret directly into the active ignored backend env without echoing it in reports/chat/screenshots.
5. Restart/reload backend as required by its loader, verify route readiness, and confirm a valid forwarded test event is accepted.
6. Run real app-created Test Mode payment flows with the listener and recovery runner running.

The listener secret differs from a hosted Dashboard endpoint secret. Later Phase 06 flow is backend deployment → reachable public URL → Dashboard test destination → new hosted whsec → hosted verification. Never use LOCAL whsec as that destination's secret.

Generic `stripe trigger` events are useful ingress tests; they usually are not associated with an app-owned attempt and are not purchase finalization proof.

---

# 32. Database Decision and Forward Migration

Inspect current Prisma schema/migration history, constraints/indexes, actual allowed test DB state, and 03.5 legacy records before writing migrations. Existing Payment cannot currently represent pre-Order attempts: document the minimal extension plus event/work persistence and internal state requirements.

Requirements:

- smallest forward migration; never edit applied historical migrations or use `prisma db push` as completion;
- preserve current Order/OrderItem/Payment history and reference behavior;
- unique attempt-owner/key, intent binding, Order linkage, event ID, and operation identity;
- exact money types/nonnegative constraints, supported currency, positive snapshot quantities;
- valid foreign keys/deletion behavior; no cascade loss of financial evidence through routine deletion;
- minimal justified indexes for owned lookup and pending work scans;
- Prisma schema, generated client, physical schema, migrations, and OpenAPI synchronized;
- no destructive reset/reseed or fabricated legacy Paid backfill.

Keep nullable transitions/backfills explicit. Preflight incompatible data and report before applying constraints. Separate source validation from external deployment. No PROD migration/write is authorized by this task; prepare compatible forward migration and Phase 06 deployment notes.

---

# 33. Test Database and Supabase Evidence

Use a disposable local/test PostgreSQL database or verified approved Supabase DEV project according to repository workflow. Verify target identity without exposing credentials before any fixture/migration write. Never infer identity solely from a filename.

Evidence must distinguish: source/schema validation; migration application and ledger/physical readback; real PostgreSQL integration; local browser connected to DEV DB; PROD read-only observations if already permitted. Supabase verification must inspect relevant access policies/RLS and ensure browser clients cannot directly mutate payment/order/work/event records or access service-role credentials.

No PROD seed, race test, payment fixture, migration, or repair. Cleanup targets only isolated task fixture identities and retains required payment audit records. Stripe test cleanup and DB cleanup are separate operations; do not erase an unresolved recovery obligation.

Fixtures must use disposable labeled test accounts/products/Cart rows, isolated from curated catalog and customer data. Inspect existing seed behavior; do not run it merely because a script exists. Do not mutate curated Products for stock/price races without explicit approval. Document cleanup completion and any retained financial evidence.

---

# 34. Authentication, Authorization, and Secret Safety

Browser payment/checkout/order endpoints require existing authenticated active CUSTOMER authorization. Derive owner from auth; never accept another user ID. Scope attempt/status/resume/cancel/reconcile/confirmation by owner and return sanitized misses. Test cross-user intent substitution even for valid Stripe IDs.

Preserve existing JWT/refresh/logout/guest-Cart reconciliation behavior. Rate limit setup and mutation/reconciliation appropriately; bound status polling. Apply strict body/parameter schemas, known fields, lengths, and safe server-generated metadata. Restrict return URLs to configured allowed frontend origin/path; no open redirects.

Never expose `sk_*`, `rk_*`, `whsec_*`, DB/service-role credentials, auth tokens, or raw payment fields through browser bundles, logs, telemetry, source, screenshots, Playwright traces, reports, fixtures, or Git. Publishable `pk_test_*` is browser configuration but need not be echoed in evidence. Treat intent client secrets as sensitive capabilities: owner-only delivery, no shared caches, no logs/storage/URLs of your own design, and `Cache-Control: no-store` on sensitive responses.

Stripe may add payment-related return parameters. Read only what is required for owned reconciliation, sanitize analytics/logging, and replace the URL to remove client-secret parameters promptly. Query parameters never prove payment success.

Review CSP/Helmet and frontend hosting policies for official Stripe.js frames/scripts/connect origins using current Stripe security docs; maintain narrow directives rather than wildcards or globally disabling CSP. Preserve CORS/CSRF controls appropriate to the existing auth model.

---

# 35. Raw Payment Data — Forbidden

ElectroHub must not own normal inputs for PAN, expiry, or CVC. Stripe-hosted secure fields handle them. Do not read iframe contents into application state or intercept/log provider bodies to extract card data.

Forbidden destinations include app request bodies, Prisma columns, local/session storage, persisted drafts, React Query, analytics, logger/Sentry breadcrumbs, test recordings with real data, and reusable fixtures resembling real credentials.

Cardholder/billing information legitimately required by supported provider APIs may be passed as bounded non-PAN data, but do not log it or invent a new billing-profile feature. Store/display only necessary safe brand/last-four metadata after verified retrieval.

Use only official test cards. Never enter real customer/family cards in Test Mode.

---

# 36. Supplied Make Screenshot Manifest

The five images are included beside this document under `assets/` with their original attachment filenames. They are the approved starting evidence; no Design link is needed.

| Image | Actual supplied filename | Size | State and required interpretation |
| --- | --- | --- | --- |
| 1 | `codex-clipboard-b27f57b0-5fbb-4038-9b00-699a25ae0ced.png` | 1920 × 908 | Review cards/Edit links, main panel/summary, stepper, Place Order total; replace placeholder address and fabricated last-four |
| 2 | `codex-clipboard-c7b2fc76-95b9-49d8-8970-c8d822691c37.png` | 1920 × 911 | Payment hierarchy, method treatment/actions/summary; replace raw field composition with Stripe-hosted Payment Element |
| 3 | `codex-clipboard-751765c2-6757-42d6-bfab-8e9edaaef3b1.png` | 1920 × 907 | Product Details quantity/Add to Cart/Buy Now relationship; contextual integration only, not a catalog redesign |
| 4 | `codex-clipboard-96a19844-abd3-459c-b231-6cefe74930b8.png` | 1920 × 906 | Centered confirmation icon/card/reference/date/items/totals; Paid/Total Paid now allowed only after verified captured payment |
| 5 | `codex-clipboard-2b82bd3f-2872-49af-a4c9-528e6e4cae2e.png` | 1920 × 904 | Centered red Payment Failed, alert, Try Again/Return to Cart, Footer; adjust wording to actual failure/recovery state |

References:

- [Review](assets/codex-clipboard-b27f57b0-5fbb-4038-9b00-699a25ae0ced.png)
- [Payment](assets/codex-clipboard-c7b2fc76-95b9-49d8-8970-c8d822691c37.png)
- [Product Details / Buy Now](assets/codex-clipboard-751765c2-6757-42d6-bfab-8e9edaaef3b1.png)
- [Confirmation](assets/codex-clipboard-96a19844-abd3-459c-b231-6cefe74930b8.png)
- [Payment Failed](assets/codex-clipboard-2b82bd3f-2872-49af-a4c9-528e6e4cae2e.png)

No new Shipping, Delivery, processing, mobile, or lower-confirmation screenshot was supplied in this set. Reuse their existing approved 03.5 production behavior and available prior references; design necessary new states with current components and document the inference. Do not claim unseen references were inspected.

---

# 37. Mandatory Approved / Refinement / Future Matrix

Before coding, open each image and produce the actual matrix. Baseline:

| Element | Classification | Action |
| --- | --- | --- |
| Current Header/Footer, typography/tokens, loader | APPROVED / REUSE | Reuse production foundation |
| Four checkout steps, Review Edit, right summary | APPROVED / REUSE | Preserve structure and functionality |
| Payment card-entry appearance | CONTROLLED REFINEMENT | Stripe secure fields/Appearance API; no normal PAN inputs |
| PayPal tab | FUTURE / UNAPPROVED | Omit; no enabled unsupported provider |
| `0000 0000 0000 0000` decline note | PROTOTYPE / INVALID TEST INSTRUCTION | Remove; official tests only, documented outside customer flow |
| `Card ending 5647` | PLACEHOLDER | Replace with verified metadata or generic Card label |
| Paid / Total Paid | NEW 03.6 VERIFIED STATE | Show after full captured payment only |
| Confirmation Processing badge | ORDER STATUS | Keep distinct from pending payment status |
| Payment Failed composition | APPROVED 03.6 STATE | Implement with truthful actionable copy |
| Buy Now | APPROVED TASK INTEGRATION | Use same Cart/Checkout/payment path |
| Pending, 3DS, provider unavailable, recovery | NEW 03.6 STATES REQUIRED | Add controlled layouts using existing design system |
| Prototype Customer/Admin/Flows/Components overlay | PROTOTYPE — NEVER SHIP | Exclude from app and evidence targets |
| `256-bit SSL encryption` | UNVERIFIED MARKETING | Use accurate secure-payment copy or omit claim |
| Full Order Details/My Orders | FUTURE 03.7 | Do not build to satisfy screenshot CTA |

Preserve hierarchy/composition; refinement allows stronger spacing, complete states, responsive behavior, accessibility, long data, and subtle interaction. It does not authorize a generic replacement design or unrelated redesign.

---

# 38. Visual Quality and Polished Layouts

Target clean, premium, calm, trustworthy electronics commerce from the first handoff. Use current Poppins/UI typography, existing data typography where appropriate, 4px spacing foundation, tokens, control sizing, radii, focus indicators, and shared components. Configure provider Appearance API within supported boundaries; do not force unsupported iframe styling.

Desktop retains centered max-width Checkout main + readable summary. Keep stable widths across Payment/Review; optional sticky summary must avoid Header/Footer and support many items. Confirmation/failure use constrained centered content matching supplied proportions. No giant empty placeholders, arbitrary shadows, squeezed panels, layout jumps, unsupported security copy, or extra decorative cards.

---

# 39. Payment UI States and Actions

Required states: initial setup loading; provider loading; ready/incomplete; validation error; SDK/script blocked; backend setup error; stale/superseded attempt; auth expiry; disabled submission; retry setup; secure re-entry after refresh; restored Shipping/Delivery.

“Review Order” validates without paying; “Back” preserves safe draft. Keep summary current with server-authoritative delivery/total. Do not let stale background content imply empty or success. Provide useful recovery for blocked Stripe scripts/network without enabling fake payment.

Use accessible labels/help text outside provider fields, status announcements, and error focus. Do not show debug API IDs or infrastructure details in customer UI.

---

# 40. Review UI and Purchase Consent

Show validated actual Shipping, chosen Delivery/window, safe payment method label/metadata when available, product snapshots/projection, subtotal/shipping/total/currency, and contextual Edit actions.

Final CTA communicates the exact reviewed purchase amount, e.g. `Place Order · $1099.99` or `Pay & Place Order · $1099.99` using approved current wording. One deliberate final action initiates authorization. No authorization triggered on card-entry completion or step navigation.

Edits preserve other safe fields but invalidate affected payment attempt facts. Require explicit re-review for any changed total/Cart. Disable final action while invalid, stale, setup pending, provider unavailable, or purchase resolution active.

---

# 41. Processing, Authentication, and Pending UI

Reuse ElectroHubLoader and current shell for real asynchronous transitions. Announce “Confirming payment”, “Creating your order”, or safe equivalent without exposing implementation internals. Do not fake artificial delays.

Support Stripe 3DS/modal/redirect action and cancellation. Avoid a competing overlay trapping Stripe focus. During a known active confirmation prevent duplicate purchase controls, but support safe refresh/recovery rather than relying on “do not close” text.

Pending/unknown outcome gets its own truthful state: no Paid/no false decline/no new purchase CTA; offer bounded status refresh/recovery and Cart access consistent with existing committed state. Long pending time transitions to documented recovery assistance, never infinite spinner or second charge.

---

# 42. Payment Failed UI and Retry

Implement screenshot 5's centered red icon/title/description, alert panel, full-width primary Try Again and secondary Return to Cart, current Footer. Distinguish decline, authentication canceled, setup unavailable, stock/price conflict, and compensation pending.

On pre-commit decline preserve Cart/Shipping/Delivery and allow secure card replacement. Reuse compatible intent/attempt when permitted. On committed/unknown payment do not offer a new charge until the previous outcome resolves. On compensation completion guide a new re-reviewed attempt; restoration copy reflects actual full/partial recovery.

Do not label network timeout “Your payment was declined.” Do not promise no hold/refund without verified provider truth.

---

# 43. Paid Confirmation and Refresh

Render owned persisted Order/OrderItem/shipping/delivery snapshots and payment projection, not old Cart data or browser result. Preserve reference algorithm and date formatting. Show Paid/Total Paid only when server records verified full capture. Order Processing/Confirmed is separate fulfillment information.

Support one/many items, free/paid shipping, long names/address, captured metadata, refresh loading/error/not-owned, and canceled/refunded/recovery representations when reached through this task.

Hard refresh and direct confirmation URL retrieve owned records. Return routes/Stripe query parameters may locate the current attempt only through verified mapping. Another customer's reference/attempt returns sanitized miss. Continue Shopping works; View Order Details appears only if a real approved route already exists, otherwise omit it.

Legacy 03.5 confirmations remain truthful unpaid/unprocessed historical records; never assign Paid merely because the new task is installed.

---

# 44. Buy Now — Explicit Semantics

Implement/reuse Product Details Buy Now without a second payment path:

```text
selected Product + selected quantity
→ existing Cart mutation and authoritative availability validation
→ await successful reconciliation
→ existing authenticated Checkout
→ same Shipping/Delivery/Payment/Review/Option B flow
```

Baseline semantics: add the selected quantity through existing Cart behavior and checkout the resulting entire Cart, retaining existing other products. Make this clear in UX/feature docs; do not silently discard or replace Cart contents. If existing approved behavior sets rather than adds quantity, follow that verified Cart contract and document it before coding.

Guest Buy Now follows existing login/return-route/guest-Cart reconciliation. OOS/invalid quantity/limit/auth/network failure cannot navigate to a fake successful checkout. Prevent duplicate add/navigation from rapid clicks. It creates no Order, PaymentIntent, stock mutation, or charge from Product Details itself. Test existing-product-in-Cart and multiple-item behavior.

---

# 45. Draft, Query, and Cache Ownership

Reuse one QueryClient and existing CartProvider. Shipping/Delivery remain user/session-scoped safe drafts. Sensitive provider state is transient Elements context; no raw card or client secret storage in persisted checkout or shared query caches.

Owned status/confirmation keys include account identity and attempt/reference. Clear private caches/drafts on logout/account transition; abort/ignore stale responses. Resume pending attempt before creating a replacement on refresh.

After DB purchase commit, reflect actual cleared Cart/header badge even while capture is pending, with truthful purchase state. After verified compensation, update Cart/Inventory caches from authoritative current server projection. Never optimistically clear before commit or resurrect stale Cart after success. Background reads retain usable UI without wiping draft.

Bound polling by nonterminal status, backoff, visibility/unmount, and configured timeout; terminal results stop polling. No per-line browser Inventory requests.

---

# 46. Responsive Requirements

Mandatory widths: **390, 768, 1440, 1920**. Use existing SCSS breakpoint/container system, not an unrelated responsive implementation.

| Width | Required behavior |
| --- | --- |
| 390 | Single column; clear compact/wrapping stepper; full-width provider panel; summary stacks; touch-friendly actions; no sticky aside/page overflow; failure/confirmation fit |
| 768 | Stack or adapt main/summary without cramped fields; readable Edit/actions, provider errors, multi-item content |
| 1440 | Recognizable supplied main/aside composition; stable panel widths; clear primary action; balanced result screens |
| 1920 | Current constrained max-width; preserve screenshot hierarchy; no full-monitor form stretching or disconnected summary |

Verify long product names, international address/phone, many items, large totals, paid delivery, error wrapping, keyboard-open mobile interactions, authentication, and provider load transitions. No clipped card fields, badges, Edit links, or Footer overlap. Test 200% zoom where supported and smaller viewport edges beyond the four baseline widths for overflow.

---

# 47. Advanced UX, Motion, and Accessibility

- Functional completed-step navigation; future steps cannot bypass validation.
- Review Edit returns to exact step and keeps unrelated valid state.
- Focus first app/provider validation issue through supported APIs; announce server conflicts and pending outcomes.
- Full keyboard journey including method entry, Review, authentication, failure/retry, confirmation.
- Correct stepper `aria-current`, contextual Edit names, headings, semantic buttons/links, live regions, labels/descriptions, visible focus, and non-color-only badges.
- Whole Delivery rows remain keyboard accessible; no nested interactive controls.
- Loader respects reduced motion; subtle transitions do not obscure payment state or create theatrical route effects.
- Provider iframes remain accessible; do not replace their accessibility with a mock field set.
- Run Storybook a11y/axe and manual keyboard checks; record third-party iframe limitations distinctly rather than claiming complete iframe coverage from outer DOM scans.

---

# 48. Storybook — Mandatory Production Component Coverage

Extend existing Storybook; use production components with a bounded provider/state adapter, not duplicate fake pages. Deterministic stories do not require live keys/backend and must clearly model provider UI rather than claiming real tokenization. A separate documented integration/demo path may exercise actual Stripe locally.

Required groups:

| Group | Required states |
| --- | --- |
| Stepper/summary | Each step; compact mobile; one/many items; long names/totals; free/paid delivery |
| Payment | Provider loading/ready/incomplete/validation/unavailable; setup failure; stale attempt; restored draft; disabled CTA |
| Review | Generic safe label; verified metadata fixture; long address/many products; paid delivery; changed total; pending submit |
| Processing | Existing loader; confirming/committing/capture pending; reduced motion |
| Authentication | Required/canceled/returning presentation around supported provider boundary |
| Pending/recovery | Unknown network outcome; capture recovery; cancel/refund/compensation pending; partial Cart restoration |
| Failure | Decline; retryable setup failure; auth canceled; stock/price conflict; terminal canceled |
| Confirmation | Captured Paid; multi-item; free/paid shipping; legacy unpaid; refresh loading/error/not-owned; refunded/canceled projection |
| Buy Now | Available; invalid/OOS; pending add; guest auth continuation; Cart mutation failure |

Verify relevant stories at all four widths, keyboard/focus, and current a11y tooling. Storybook pass does not replace real Stripe or real browser evidence.

---

# 49. Testing Tools and Validation Commands

Reuse current Vitest, Testing Library/user-event, Supertest, real PostgreSQL gates, Storybook a11y, and Playwright infrastructure. Installed versions/configuration are repository truth.

Current root validation scripts:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run build-storybook --workspace=apps/frontend
```

Existing checkout Playwright configuration:

```powershell
cd apps/frontend
npx playwright test -c playwright.checkout.config.ts
```

Add/reuse focused Stripe tests/config/scripts with documented names and commands; do not pretend uncreated commands exist. Root `test:e2e` currently selects auth config; it is not payment coverage. Existing frontend `test:visual` includes `--update-snapshots`: run comparison without automatic baseline replacement for verification and inspect any intentional updated baselines.

Run relevant existing Cart/Inventory/Checkout/Auth regression tests and required type/lint/build checks. Record actual counts, skipped tests, coverage tool/version, executed command, environment, and exit status. Do not weaken tests/disable controls to obtain PASS. Use behavior/risk-driven coverage of success, transition, recovery, concurrency, authorization, and fault paths; document existing coverage thresholds and uncovered critical branches rather than inventing a percentage PASS.

Also run final `git diff --check` and the existing secret-scanning workflow, including staged and untracked task files. Inspect file contents without printing credential matches. Record unsupported/missing scanner tooling as a limitation and perform an appropriate safe source/evidence review; do not claim an unrun automated scan.

---

# 50. Backend Unit and API Tests

At minimum cover:

- exact Decimal→cents conversion, max/precision/currency errors, delivery totals;
- strict setup/reconcile/cancel schemas; body tampering and unknown keys;
- owner/active customer/role enforcement and cross-user attempt/Order/intent attacks;
- canonical request hash/revision and idempotency conflict;
- test-mode config/live rejection and no sensitive error leakage;
- PaymentIntent creation manual capture, trusted metadata/amount/account binding;
- provider status mapping and legal transition rules;
- authorization not Paid; amount/currency/capturable mismatch blocked;
- decline/3DS/cancel/processing/unknown/capture success/failure classification;
- same-intent retry vs superseded/new immutable request;
- duplicate/out-of-order events and worker/browser shared orchestration;
- operation idempotency and retry/backoff/expiry;
- legacy API cannot consume stock without payment verification;
- safe owned confirmation/client-secret response/cache headers.

Use fake Stripe adapter only for deterministic unit/API fault tests and label it as such. A fake `succeeded` payload is not Stripe evidence.

---

# 51. Signed Webhook Tests

Generate test signatures with a clearly fake local test signing secret through the SDK helper or documented equivalent. Exercise the actual Express middleware stack.

Prove raw-byte signature success; missing/wrong signature; JSON reserialization/tampered body rejection; timestamp tolerance; oversized/malformed body; `livemode`/wrong account/mismatched amount; unknown intent; unrelated valid event; duplicate delivery; different events for same transition; out-of-order success/failure/processing; handler crash; durable acceptance failure; and retry after partial processing.

Verify HTTP ack semantics and that signatures/errors/body data do not leak through loggers. Signed mocked events are webhook security/integration evidence; real CLI-forwarded owned events are a separate gate.

---

# 52. Real PostgreSQL Transaction and Migration Tests

Mandatory against isolated real PostgreSQL:

- valid one/many-item authorized commit; exact stock; immutable snapshots;
- pre-authorization decline: zero purchase effects;
- authorized stock conflict and price/Cart/product/category change: all purchase effects absent;
- injected second-item failure: no Order/OrderItems/decrement/Cart clear/capture command survives;
- unique attempt/provider/event/work constraints and money/quantity checks;
- linked Payment created only with proper verified commit;
- no Stripe call inside transaction, including fault/retry paths;
- capture success DB-write failure recovered from existing intent;
- definitive capture failure compensation restores stock exactly once and preserves canceled history;
- Cart restoration with newer added items, existing same-product line, quantity limits, removed/inactive product, and partial recovery;
- migration apply/readback/backward-compatible legacy record reads.

Read before/after state for every affected Order, item, Cart, Inventory, Payment, attempt, event/work row. Mocks do not prove physical rollback/constraints.

---

# 53. Genuine Concurrency Tests

Run overlapping operations against real PostgreSQL, not sequential mocked calls:

| Race | Required result |
| --- | --- |
| Two customers authorize last unit (stock=1) | One committed/captured purchase; loser rolls back and authorization cancels; stock=0 |
| Same owner/key repeated/concurrent setup | One attempt and provider creation operation |
| Same Cart, distinct keys/tabs | At most one committed purchase and successful capture; unused authorization resolved |
| Browser reconcile + webhook + worker | One Order, one decrement, one capture command, one terminal outcome |
| Duplicate capture/timeout/restart | Same capture result; no second charge |
| Compensation runners overlap | One restoration and one Cart intent recovery; no inflation |
| Stale worker vs success/cancel/supersede | No stale finalization, paid downgrade, or release while capture is unresolved |
| Cart mutation during setup/authorization | Changed intent requires conflict/re-review; no unintended items erased/purchased |

Use deterministic barriers/fault injection controlled exclusively in test mode. No public production fault-injection headers/routes. Report real DB concurrency separately from real Stripe network concurrency.

---

# 54. Crash and Recovery Tests

Inject/reproduce crashes at these boundaries:

1. Attempt persisted, provider create not completed.
2. Provider intent created, DB ID write/response lost.
3. Authorization succeeds, browser closes before callback.
4. Authorization webhook accepted, work not yet executed.
5. Transaction commits, process dies before capture.
6. Capture succeeds, response/status DB write lost.
7. Authorization cancellation succeeds, local outcome write lost.
8. Compensation begins/retries; provider or DB unavailable.
9. Refund created, outcome not yet terminal.
10. Worker lease expires while a provider request outcome is unknown.

Restart the real local runner and prove recovery uses existing identities, creates no duplicate purchase/capture/refund, and leaves no permanent silent backlog. Report unresolved external outages as pending/incident, never false PASS.

---

# 55. Frontend Component and State Tests

Cover secure provider mount/loading/failure, no normal PAN inputs, validation-before-Review, no charge on Review, Elements lifetime/re-entry, back/Edit preservation, draft/account isolation, current revision guarding, double-click lock, stale response rejection, same-attempt timeout recovery, final CTA amount, authentication cancellation, pending vs decline copy, Cart cache timing, compensation refresh, real metadata fallback, owned direct refresh, and legacy unpaid rendering.

Verify the purchase API requests contain no raw card data/client price/Paid claim. Do not inspect sensitive third-party request payloads to create test logs. Provider mocks test app control flow only, not Stripe iframe security or real authorization.

---

# 56. Playwright / Browser E2E Matrix

Implement deterministic app-level coverage and separately run real Test Mode payment journeys:

| ID | Journey |
| --- | --- |
| E01 | Guest Checkout/Buy Now auth continuation; empty/invalid Cart protection |
| E02 | Shipping validation/draft preservation and all delivery totals |
| E03 | Payment Element setup/validation → Review without payment |
| E04 | Review Edit/back/re-entry; changed delivery/Cart/price requires re-review |
| E05 | Successful authorize → DB commit → capture → Paid; one Order/stock change/Cart clear |
| E06 | Decline → Failed → retry different test card; Cart/stock unchanged before success |
| E07 | 3DS success and cancellation; no premature Paid |
| E08 | Processing/pending/unknown state; safe bounded refresh |
| E09 | Browser result first vs webhook first; browser closed after authorization |
| E10 | Delayed/duplicate/out-of-order webhook; runner convergence |
| E11 | Double click/two tabs/same-intent network retry; no duplicate purchase |
| E12 | Stock/product/category/price change after authorization; cancellation and no purchase |
| E13 | Capture failure and compensation; Cart restoration with new intent retained |
| E14 | Capture succeeded but response lost; refresh resolves existing Paid order |
| E15 | Confirmation/status refresh and wrong-owner direct URL protection |
| E16 | Buy Now quantity/already-in-Cart/multi-item/OOS/auth/network behavior |
| E17 | Stripe script/API unavailable, auth expiry, expired/superseded attempt |
| E18 | 390/768/1440/1920 plus long data/paid shipping; no overflow |
| E19 | Keyboard, focus, reduced motion, automated accessibility |
| E20 | Network/security review: no raw card/secret leak, no Inventory request explosion, no unsupported scope |

Tests must assert financial/domain outcomes, not merely presence of “Order Confirmed”. Store safe evidence references and use stable accessible locators; provider frames may need documented frame locators. Do not bypass genuine Stripe verification to get a passing real-flow test.

---

# 57. Real Stripe Test Mode Gate

With actual local frontend/backend, verified test keys, signed CLI forwarding, runner, and approved test DB, prove:

- real app-created PaymentIntent with trusted total/currency/manual capture;
- valid real card authorization and full capture → persisted Payment success;
- declined test card → no Order/stock/Cart purchase mutation;
- authentication-required card success and cancellation;
- authorization `amount_capturable_updated` and captured `succeeded` events processed;
- real duplicate/replay handling and browser-independent reconciliation;
- refresh status from persisted owned data;
- normalized mismatch/wrong-owner attacks blocked;
- final test DB/Stripe readback agrees on intent/Order/amount/state.

Official documented examples: success `4242 4242 4242 4242`; insufficient funds `4000 0000 0000 9995`; authentication `4000 0025 0000 3155`. Use a future expiry and documented test details. Reverify scenarios against [Stripe testing documentation](https://docs.stripe.com/testing) during implementation. The screenshot's all-zero number is not an official decline scenario.

Manual-capture card integration may not produce a long-lived real `processing` state deterministically. Prove real applicable pending intervals (authentication/authorized/capture pending/delayed webhook) and test provider-processing mapping via clearly labeled signed fixtures/adapters. Do not enable an unapproved asynchronous payment method or claim a fixture was a real card processing event.

Capture failure/expired authorization may need controlled test faults plus provider verification. Separate what Stripe actually exercised from app-simulated faults. Stripe connector is helpful for docs/inspection when available but not a requirement if SDK/CLI evidence is sufficient.

---

# 58. Real-Browser Adversarial Review

Automated tests are not enough. Manually inspect actual app journeys with real Test Mode Stripe, not Storybook or intercepted success alone:

- entry, Payment, Review/Edit, 3DS, processing, pending, decline/retry, Paid confirmation, refresh, Buy Now;
- double-click, Back/Forward, tab duplication, network offline/reconnect, slow script/backend, browser close/reopen;
- long address/product names, many items, paid delivery, four widths, keyboard/reduced motion;
- devtools console/network for errors and secret/raw-card exposure, without exporting sensitive payloads;
- DB/Stripe state agrees with customer UI and Cart badge.

Test supported browsers according to repository policy; at minimum run the primary Chromium local flow, and record additional browser coverage or explicit NOT VERIFIED gaps. Phase 06 broad release QA does not excuse task-critical browser gaps.

---

# 59. Slow-Network and Unknown-Outcome Review

Exercise delayed SDK load, setup timeout, authorization timeout, dropped commit/capture response, delayed webhook, backend restart, and recovery polling. Preserve usable content on background revalidation. Avoid skeleton/failure/success flicker or automatic duplicate charge retries.

Network failure must not become decline. Once purchase commit is known, Cart emptiness is actual state even if payment is pending; communicate the pending purchase and recovery. When outcome is unknown, locate the existing attempt before allowing a new one. Document exact recovery CTAs and polling cutoff.

---

# 60. Required Screenshot Capture and Inspection

Capture a reproducible visual matrix with viewport/state/data/source and automation/manual provenance. Required primary states at **each** width (390/768/1440/1920):

- Payment ready in actual local Stripe app;
- Review with real Shipping/Delivery and multi-item/paid-shipping variant;
- Processing/capture pending with existing loader;
- pre-commit decline Failed with Try Again/Return to Cart;
- unknown/recovery pending;
- verified Paid confirmation, including lower content/Footer;
- Product Details Buy Now integration.

Additional targeted captures: Payment validation/unavailable; Review conflict and long address; 3DS surrounding UI/focus behavior; retry state; compensation completed/partial intent recovery; legacy unpaid confirmation; confirmation refresh error/not-owned; keyboard focus; reduced motion.

Use synthetic customer data and test cards only. Exclude secrets, auth tokens, provider client-secret URLs, raw signed webhook content, and terminal listener secrets. Avoid saving sensitive Playwright trace/HAR data; redact before evidence delivery.

**OPEN AND INSPECT EVERY REQUIRED CAPTURE.** Verify spacing, typography/tokens, proportions, provider fit, long content, summary width, stepper, action focus, badges, no overflow, Header/Footer, mobile stacking, and truthful state copy. Compare supplied desktop references; record allowed deviations and defects, fix them, recapture/reopen. File existence alone is not QA.

Store implementation captures in the current evidence structure with an index. Preserve original reference image names; do not invent renamed Figma exports. Reference a screenshot by exact artifact path in the final report.

---

# 61. Performance and Observability

Backend: bulk Product/Inventory reads; bounded items/quantities; short transactions and deterministic locks; no provider waits inside transactions; justified owned lookup/work indexes; bounded webhook ingress/recovery/polling; reused Stripe client; no global mutex or unbounded scans/retries.

Frontend: stable Stripe initialization/provider; no second QueryClient; no per-product Inventory HTTP; narrow owned queries; background content retention; correct cache invalidation; no uncontrolled polling or remount loops; no unnecessary global bundle churn.

Log safe attempt/work/request correlation, operation category, normalized error, retry/latency, and backlog/incident counts. Correlation IDs are not credentials; minimize PII. Do not log client secrets/provider payloads/signatures. Document how to find a stuck attempt safely. Connected Sentry may provide runtime evidence if relevant, but no new monitoring infrastructure is required just for this task.

---

# 62. Documentation Updates and Handoffs

Update discovered existing docs rather than scatter new duplicates:

- payment architecture ADR: sequence, state machines, no distributed atomicity, failure matrix, durable runner, authorization expiry, compensation;
- Checkout/Cart/Inventory/Orders feature docs: changed purchase semantics, Buy Now, payment gate, recovery and snapshots;
- API/OpenAPI and frontend types: new endpoints/DTOs/errors and legacy route migration;
- schema/migration/index/access policy docs;
- local setup/env/CLI runbook and runner commands, placeholders only;
- testing/Storybook/E2E/visual evidence instructions;
- implementation evidence document under `docs/tasks/Phase-03/`;
- Phase 06 handoff for public endpoint/new hosted secret/runner hosting/live-release review;
- 03.7 handoff for owned Order + Payment projections, payment/fulfillment distinction, canceled/legacy states, and no recreation of purchase logic.

Do not mark roadmap milestones completed merely because code exists. Do not rewrite old 03.5 evidence as if it were Stripe evidence. Record approved architecture evolution and distinguish historical unpaid records.

---

# 63. Changed-File Full Review

Before handoff inspect every changed file in full plus final diff, not only newly added lines. Review architectural consistency, ownership/security, money, provider/DB boundaries, transition legality, API consumers, migration compatibility, indexes, rollback/compensation, concurrency, logging, types, state/cache isolation, responsive/a11y, and test quality.

Review shared primitives/integration consumers for regressions. Preserve unrelated pre-existing changes and report task-specific diff boundaries. No repository-wide cleanup or unrelated bug hunting. Report out-of-scope observations separately without silently expanding scope.

---

# 64. Validation Categories and Evidence Rule

Every requirement result uses **PASS / FAIL / BLOCKED / NOT VERIFIED / NOT APPLICABLE** with a reason and evidence reference.

Keep evidence categories separate:

```text
SOURCE / TYPE / LINT / BUILD
MOCKED UNIT / API / SIGNED-WEBHOOK
REAL POSTGRESQL / MIGRATION PHYSICAL READBACK
STORYBOOK / A11Y
PLAYWRIGHT DETERMINISTIC / INTERCEPTED
REAL LOCAL STRIPE TEST MODE / CLI FORWARDED
REAL-BROWSER MANUAL / NETWORK REVIEW
OPENED SCREENSHOT VISUAL REVIEW
REMOTE CI (only if actually available)
HOSTED DEV / PROD (deferred, not claimed)
```

No test/coverage/CI/DB/Stripe/Figma/visual PASS without actual execution/inspection. Historical evidence and mocked success are not live 03.6 proof. Report exact environment, commands, counts/skips, evidence paths, safe timestamps/correlation, and limitations. Missing required real-flow evidence means not ready for approval, even if source checks pass.

---

# 65. Full Requirement Traceability Matrix

Fill this matrix in the implementation report; extend it for every detailed scenario above. Each ID maps to implementation files, tests, evidence, status, and remaining risk. A checked box without evidence is incomplete.

| ID | Requirement | Required proof |
| --- | --- | --- |
| R01 | Branch/baseline/user changes preserved; no commit/push/merge | Git/status/diff report |
| R02 | Repository/docs/screenshots inspected; manifest/matrix/plan | Source manifest and inspection findings |
| R03 | Local Test Mode boundaries/environment separation | Config validation + no-live tests/runbook |
| R04 | Payment Element secure entry; Review not charging | Component + real browser/network |
| R05 | Owned immutable attempt and exact totals | Unit/API + real DB + Stripe readback |
| R06 | Authorization → atomic commit → capture | Sequence evidence + fault tests |
| R07 | Reuse Order/Cart/Inventory core; no unpaid bypass | Diff/API regression tests |
| R08 | Atomic multi-item rollback/nonnegative stock | Real PostgreSQL before/after |
| R09 | Same-Cart/last-unit concurrency | Genuine overlapping DB tests |
| R10 | Idempotency across provider/DB/browser/worker | Duplicate/timeout/restart tests |
| R11 | Pre-commit authorization cancellation | Stripe/DB recovery evidence |
| R12 | Post-commit failure compensation/Cart recovery | Real DB + provider state/fault evidence |
| R13 | Unknown capture never double charges/releases stock | Fault/reconciliation tests |
| R14 | Durable runner/restart/expiry/incident handling | Crash matrix and backlog readback |
| R15 | Signed raw-body local webhook | Actual Express tests + CLI delivery |
| R16 | Duplicate/out-of-order event convergence | Unit/API + replay/recovery evidence |
| R17 | Payment status/metadata truthful; legacy compatibility | DTO tests + owned refresh/browser |
| R18 | Auth/IDOR/tamper/secret/log/CSP security | Security tests + sanitized inspection |
| R19 | Minimal forward migration/physical constraints | Preflight/apply/readback/legacy tests |
| R20 | Buy Now same Cart/Checkout path | Component + browser variants |
| R21 | Responsive polish/new states/loader | Four-width captures opened |
| R22 | Storybook production state coverage/a11y | Build/test/visual index |
| R23 | Playwright matrix and real local Stripe journey | Separate deterministic/live reports |
| R24 | Real browser/slow network/keyboard/reduced motion | Manual findings + inspected captures |
| R25 | Performance/cache/observability | Request/transaction/polling review |
| R26 | Docs/ADR/API/03.7/Phase 06 handoff | Changed docs and traceable contracts |
| R27 | Complete changed-file review/independent architect review | Findings, severity, score, decision |

---

# 66. Definition of Done — Functional and Financial

- [ ] Authenticated valid Cart follows existing Shipping/Delivery → Stripe Payment → Review → explicit final action.
- [ ] Payment step/Review navigation never creates a premature charge or purchase.
- [ ] Manual authorization verified server-side before atomic purchase commit.
- [ ] Exact authoritative total/currency used; stock/revision independently revalidated.
- [ ] One Order/items/decrement/Cart clear/capture operation per purchase.
- [ ] Successful full capture persists Paid and refreshable owned confirmation.
- [ ] Decline/auth cancellation preserves Cart/stock; retry is compatible and safe.
- [ ] Stock/price/Cart conflict after authorization cancels hold without purchase effects.
- [ ] Post-commit capture failure compensates once, preserves history and customer intent.
- [ ] Unknown outcomes resolve existing identity without double charge or unsafe restoration.
- [ ] Worker/webhook recover browser-close and process-crash cases.
- [ ] Legacy unpaid endpoint cannot bypass Stripe; legacy records remain truthful.
- [ ] Buy Now reuses the same validated Cart/Checkout path.

---

# 67. Definition of Done — Security, Database, and Compatibility

- [ ] Raw-body signature verification precedes effects; test events/account/intent binding validated.
- [ ] Duplicate/out-of-order events and concurrent workers are safe.
- [ ] Owned setup/status/resume/reconcile/cancel/confirmation and active CUSTOMER rules proven.
- [ ] No raw card fields or secret/PII leakage; test-only configuration and safe CSP/logging.
- [ ] Minimal forward migration validated and applied/read back on allowed test target.
- [ ] Constraints/indexes/history/deletion/access policies support the actual design.
- [ ] No external network request inside purchase/compensation transactions.
- [ ] API/types/OpenAPI/consumers and pending-payment fulfillment gate updated.
- [ ] PROD/live/hosted deployment deferred; no unsafe environment crossover.

---

# 68. Definition of Done — UI, Testing, and Evidence

- [ ] Five supplied images inspected; actual approved/refinement/future matrix recorded.
- [ ] Current shell/tokens/loader reused; Payment/Review/Failed/Confirmation composition recognizable.
- [ ] Pending, authentication, provider unavailable, recovery, and long-content states complete.
- [ ] 390/768/1440/1920 verified with opened screenshots; keyboard/a11y/reduced motion tested.
- [ ] Storybook production states built/tested, including legacy unpaid and recovery.
- [ ] Unit/API/security/signed-webhook/real PostgreSQL rollback/concurrency/migration tests complete.
- [ ] Crash/restart recovery and capture/cancel/compensation faults proven.
- [ ] Playwright and manual real-browser QA complete; real Stripe/CLI proof separate from mocks.
- [ ] Required type/lint/test/build checks pass or clearly recorded blockers prevent approval.
- [ ] All requirements traceable; documentation and handoffs complete; changed-file review done.
- [ ] Implementation stops for independent Principal Architect review.

---

# 69. Rejection Conditions

Request changes or reject if any of these remain:

- unverified client success/redirect marks Paid;
- order/stock/Cart effects occur before verified authorization or through an unpaid bypass;
- Stripe calls occur inside PostgreSQL transactions;
- charge/order inconsistency lacks durable automatic recovery;
- capture timeout creates another intent/charge or restores stock without provider resolution;
- compensation duplicates Inventory or overwrites/losses newer Cart intent;
- no raw-body verification, no event idempotency, or browser-dependent finalization;
- another user's attempt/Order/provider ID can be used;
- live keys/charges/PROD fixtures or secrets/raw card leakage;
- no real concurrency/rollback proof where required;
- fake card inputs/last-four/date/reference, unsupported PayPal, prototype controls, misleading failure/security copy;
- missing responsive/Storybook/real browser/opened screenshot evidence;
- tests weakened, snapshots blindly accepted, mocks passed off as real Stripe;
- legacy migration/API break not documented/tested;
- required runner/state/compensation work left as TODO;
- commit/push/merge/self-approval without later explicit authorization.

---

# 70. Required Final Implementation Report

Use this structure, matching the prior task's detailed handoff architecture:

```markdown
# TASK 03.6 — STRIPE IMPLEMENTATION REPORT

## Status
Complete / Partial / Blocked; ready-for-review truth, not self-approval.

## Branch and Baseline
feature/Stripe → develop; baseline revision; pre-existing changes preserved.

## Scope Implemented / Explicitly Deferred
Local Test Mode; 03.7/03.8/03.9/Phase 04/05/06 boundaries.

## Documentation Read / Related-File Manifest
Actual paths and requirement mapping.

## Make Screenshot Verification
All five actual filenames; inspected states; classification matrix; deviations.

## Architecture / ADR / State Machines
Option B, provider/payment/order distinctions, full failure/recovery table.

## Database Decision / Migration / Target Verification
Schema extension, constraints, indexes, physical readback, legacy records.

## API / Compatibility
Routes, DTOs, errors, old unpaid route handling, consumer changes.

## Stripe SDK / API Version / Test Environment
Actual resolved versions and safe environment verification; no credentials.

## Payment Element / Review / Metadata / Buy Now
Supported provider lifetime; no charge on Review; verified/fallback metadata.

## Atomic Transaction / InventoryService Reuse
Order/items/stock/Cart/capture work; no network in transaction.

## Idempotency / Genuine Concurrency
Owner-key/body, same Cart, last unit, webhook/browser/worker overlaps.

## Capture / Cancel / Refund / Compensation
Verified outcomes, safe Cart merge, unknown result handling.

## Durable Runner / Crash Recovery / Expiry
Commands, fault scenarios, backlog, retry/escalation policy.

## Webhook / Stripe CLI
Raw-body/signature/event mapping; real forwarded owned events, replay results.

## Security / Access Policies / Sensitive Data
IDOR/tamper/live rejection/log/CSP/client-secret URL and trace handling.

## Backend Unit / API / Real DB / Migration Tests
Actual commands, counts/skips, results, environment.

## Frontend / State / Regression Tests
Existing Cart/Inventory/Auth/Checkout coverage and changed expectations.

## Storybook / Accessibility / Responsive
Production state list, four widths, a11y and keyboard results.

## Playwright
Deterministic/intercepted vs real local Stripe results separated.

## Real Stripe Test Mode Gate
Intent/Order correlation, trusted amounts, authorization/capture/events/readback.

## Real Browser / Slow Network Review
Browsers, cases, defects found/fixed, limitations.

## Screenshot Capture AND Opened Inspection
Artifact index; viewport/state/source; findings; recapture/final status.

## Performance / Observability
Requests, transactions, polling, runner and sanitized incidents.

## Validation / Coverage / CI
Actual type/lint/test/build commands, coverage gaps, CI only if checked.

## Files Changed / Documentation Updated
Task diff vs pre-existing edits; updated docs.

## 03.7 Handoff / Phase 06 Handoff
Same Order core, payment gate/projection, later hosted endpoint/secret/runner.

## Requirement Matrix
R01–R27 plus detailed scenarios: implementation/test/evidence/status/gap.

## Out-of-Scope Observations / Remaining Risks / Blockers
Explicit uncertainty and unresolved recovery incidents.

## Ready for Principal Architect Review
Yes/No with evidence; no commit/push/merge performed.
```

---

# 71. Principal Architect Review and Score

Implementation engineer hands off evidence and stops. Principal Architect independently reads the task and summary, reviews all changed files/consumers/migrations/tests, and checks architecture, security, edge cases, performance, database compatibility, API compatibility, coverage, documentation, and visual evidence.

Review output must include actionable senior-engineer findings with severity, exact file/line where available, concrete trigger/impact, expected correction, and missing evidence. Score out of 100 and decide **✅ Approve / ⚠ Request Changes / ❌ Reject**.

Suggested score allocation: financial architecture/recovery 25; security/ownership 20; database/concurrency/compatibility 20; automated/live verification 15; UI/responsive/a11y/Storybook 15; docs/traceability/handoff 5. A high numeric score does not override a release-blocking financial/security defect or missing mandatory real verification. Do not award an implementation score to this unimplemented specification.

---

# 72. Permanent 03.6 Execution Flow

```text
REPOSITORY BASELINE + TASK + RELEVANT DOCS
→ RELATED-FILE MANIFEST
→ OPEN FIVE MAKE REFERENCES + REQUIREMENT COMPARISON
→ APPROVED / REFINEMENT / FUTURE MATRIX
→ BOUNDED PLAN + PAYMENT ADR + API/DB COMPATIBILITY DECISION
→ ATTEMPT + STATE MACHINE + DURABLE WORK + FORWARD MIGRATION
→ STRIPE ADAPTER + EXACT TOTALS + MANUAL AUTHORIZATION
→ REUSED ATOMIC ORDER / INVENTORY / CART COMMIT
→ CAPTURE + CANCEL / REFUND / COMPENSATION + RECOVERY RUNNER
→ RAW SIGNED WEBHOOK + LOCAL CLI
→ PAYMENT ELEMENT / REVIEW / FAILED / PENDING / PAID / BUY NOW
→ STORYBOOK + UNIT / API / SECURITY / REAL POSTGRESQL
→ CONCURRENCY / CRASH / MIGRATION GATES
→ PLAYWRIGHT + REAL LOCAL STRIPE TEST MODE
→ REAL-BROWSER / SLOW-NETWORK ADVERSARIAL REVIEW
→ CAPTURE + OPEN SCREENSHOTS + FIX TASK DEFECTS
→ FULL CHANGED-FILE REVIEW + DOCS + TRACEABILITY
→ IMPLEMENTATION REPORT + 03.7 / PHASE 06 HANDOFF
→ PRINCIPAL ARCHITECT REVIEW
```

---

# 73. Stop Rule

Do not commit, push, merge, create/publish a PR, deploy hosted infrastructure, perform live payments, mutate PROD, or self-approve under this task. Any later explicit authorization is a separate action.

When implementation and verification are complete:

```text
STOP
→ provide implementation report and evidence
→ report READY / NOT READY FOR PRINCIPAL ARCHITECT REVIEW
```

Completion means a secure, authoritative, consistent, polished local Stripe Test Mode purchase flow whose success and failure outcomes survive retries, event disorder, browser closure, and process restart. Screens existing or a mocked green test suite alone are insufficient.
