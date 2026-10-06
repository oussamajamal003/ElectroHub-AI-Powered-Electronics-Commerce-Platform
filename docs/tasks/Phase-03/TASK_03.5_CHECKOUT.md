# ELECTROHUB — TASK 03.5 / CHECKOUT & ORDER CREATION CORE

**Phase:** 03 — Commerce  
**Task:** 03.5 — Checkout  
**Branch:** `feature/Checkout`  
**Target branch:** `develop`  
**Scope:** Full-stack / UI / API / Database / Transaction / Storybook / Testing / E2E / Real-browser QA / Documentation  
**Status before implementation:** NOT STARTED  
**Authority:** This is the authoritative implementation task for ElectroHub 03.5.

> **Primary outcome:** ElectroHub must provide a production-quality authenticated Checkout workflow from a valid Cart through Shipping → Delivery → Payment Method → Review → atomic Order creation → Order Confirmation, while reusing the authoritative Inventory core from 03.4 and preserving strict boundaries with 03.6 Stripe and 03.7 Order Management.

---

# Task-Specific Visual / UX Invariants

- Preserve the current Header/Footer and shell. Desktop keeps main content plus right summary; mobile/tablet stack intentionally.
- Shipping, Delivery, Payment, Review hierarchy stays recognizable; future steps remain incomplete and non-navigable.
- Back/Edit preserve valid draft. The stable summary updates delivery totals immediately.
- Background reads preserve usable content. Unresolved state is never Empty, Out of Stock, Order Created, or success.
- Price/stock conflicts require correction or re-review, never silent quantity/total changes.
- No application-owned PAN/CVV/expiry; reuse ElectroHubLoader and prevent duplicate purchase interaction.
- Confirm only after commit, using persisted owned snapshots, including refresh; no Paid/Total Paid claims.
- Long content, multiple items, paid delivery, and errors fit all four widths without overflow or squeezed summary.
- No prototype controls. Capture and OPEN every required screenshot.

---

# 1. Task Objective

Implement the complete customer Checkout workflow required by the Phase 03 roadmap:

- Cart review;
- Shipping information;
- Delivery method selection;
- Payment method selection shell;
- Checkout validation;
- authoritative server-side totals;
- final Cart/Product/Inventory revalidation;
- atomic Order creation;
- immutable OrderItem snapshots;
- purchase-time Inventory decrement;
- Cart clearing only after successful commit;
- processing/submitting state;
- Order confirmation;
- robust failure/retry behavior;
- responsive, accessible, polished customer UI;
- Storybook state coverage;
- unit/integration/API/E2E testing;
- real-browser QA and screenshot inspection;
- documentation and 03.6/03.7 handoff.

03.5 is **not** a static Checkout mockup. It is the real purchase-orchestration foundation for later Stripe and Order Management work.

---

# 2. Roadmap Scope

The Phase 03 roadmap defines 03.5 Checkout as:

```text
Cart review
Shipping information
Payment method
Validation
Order creation
Order confirmation
```

The approved customer flow is:

```text
Authenticated Cart
        ↓
Checkout entry
        ↓
1 — Shipping
        ↓
2 — Delivery
        ↓
3 — Payment Method
        ↓
4 — Review
        ↓
Final server-side revalidation
        ↓
Place Order
        ↓
ElectroHub existing loading state
        ↓
Atomic Checkout / Order transaction
        ↓
Order Confirmation
```

The task must implement the complete behavior, not only the visual states.

---

# 3. Explicit Phase Boundaries

## 3.1 03.5 — Implement Now

03.5 owns:

- authenticated Checkout entry;
- Cart review/order summary;
- Checkout step state;
- Shipping form and validation;
- Delivery method selection;
- authoritative delivery pricing;
- payment-method selection shell;
- Review step;
- final Cart/Product/Inventory revalidation;
- authoritative price/totals calculation;
- Order core needed for creation;
- OrderItem snapshots;
- order-number/reference generation;
- purchase-time stock decrement;
- deterministic multi-item transaction behavior;
- atomic Order + OrderItems + Inventory + Cart clear;
- duplicate-submit/idempotency protection;
- Order confirmation response/page;
- direct refresh protection;
- minimal confirmation retrieval if needed for refresh;
- generic checkout failure states;
- responsive/accessibility/Storybook/testing/E2E/real-browser evidence.

## 3.2 03.6 — Explicitly Deferred Stripe Scope

Do **not** implement 03.6 in this task.

03.6 owns:

- Stripe Test Mode SDK integration;
- Stripe Elements / Payment Element;
- PaymentIntent creation;
- card-tokenization/provider-hosted card entry;
- payment processing;
- payment confirmation;
- payment failure/decline semantics;
- Stripe webhook behavior if required;
- payment status lifecycle;
- `Paid`, `Failed`, `Pending` payment states;
- actual card last-four from Stripe;
- Stripe idempotency/provider IDs;
- payment-specific retry logic.

03.5 must prepare a clean integration boundary for 03.6 without building a fake payment processor.

## 3.3 03.7 — Explicitly Deferred Order Management Scope

Do **not** implement the complete 03.7 Order Management experience.

03.7 owns:

- My Orders page;
- Order history;
- full Order Details page;
- customer order lists;
- full order status presentation;
- payment status presentation;
- order lifecycle UI;
- order-state transition behavior;
- customer order-management navigation.

03.5 establishes **Order Core + creation + confirmation** only. 03.7 must reuse that core rather than create a parallel order model/service.

## 3.4 Other Explicitly Deferred Scope

Do not implement:

- Brevo order emails — 03.8;
- invoice/receipt PDF generation — 03.9;
- delivery tracking/maps/socket updates — Phase 04;
- Admin order management — Phase 05;
- Admin inventory controls — 05.3;
- unrelated analytics;
- unrelated AI features;
- unrelated redesign/refactor.

---

# 4. Critical Architecture Statement

03.4 established the authoritative Inventory model, validation rules, transaction-aware stock primitives, non-negative guarantees, and concurrency foundation.

03.5 owns the actual purchase-time stock transaction.

```text
03.4 Inventory Core
        ↓
getInventorySnapshot
validateInventoryPurchase
deriveStockStatus
setStock
increaseStock
decreaseStock
transaction-client reuse
non-negative DB constraints
        ↓
03.5 Checkout / Order Transaction
        ↓
Order + OrderItems + stock decrement + Cart clear
```

Do **not** implement a second Inventory decrement algorithm inside Checkout.

Checkout/Order must reuse the existing 03.4 Inventory service/primitives transactionally.

---

# 5. Non-Negotiable Authority Flow

```text
Customer UI
        ↓
Checkout state / forms
        ↓
React Query + central API client
        ↓
Express route/controller
        ↓
Checkout / Order service
        ↓
Prisma transaction
        ↓
Cart + Product + Inventory authority
        ↓
InventoryService safe decrement
        ↓
Order + OrderItem persistence
        ↓
Supabase PostgreSQL
```

The browser is never authoritative for:

- Product price;
- available stock;
- Product sellability;
- shipping price;
- order total;
- order ownership;
- order reference;
- Inventory decrement;
- payment status.

---

# 6. Authenticated Checkout Only

03.2 allows guest Cart behavior, but 03.5 Checkout is authenticated.

Required:

```text
Guest Cart
→ may continue shopping
→ Checkout action requires login
```

Direct unauthenticated navigation to Checkout must:

- not expose protected checkout/order data;
- follow current auth redirect pattern;
- preserve intended return route where current architecture supports it;
- rely on existing guest→auth Cart reconciliation from 03.2;
- never create an Order for an unauthenticated user.

Do not build a guest-order workflow in 03.5.

---

# 7. Checkout Entry Preconditions

Checkout may start only when the authenticated user has a valid non-empty Cart.

At entry, validate current Cart state.

Safe rules:

```text
empty Cart
→ Checkout unavailable

Cart with invalid/OOS/insufficient lines
→ Checkout blocked
→ show actionable Cart/inventory feedback

valid Cart
→ Checkout allowed
```

Frontend route protection is UX only. Final server-side Place Order revalidation is mandatory regardless of what the Checkout screen previously showed.

---

# 8. Checkout State Machine

Required semantic state machine:

```text
SHIPPING
   ↓ validated
DELIVERY
   ↓ selected
PAYMENT_METHOD
   ↓ method selected / provider shell valid
REVIEW
   ↓ final submit
SUBMITTING
   ↓ transaction success
CONFIRMATION
```

Possible failure paths:

```text
shipping invalid
→ remain SHIPPING

delivery invalid
→ remain DELIVERY

payment shell invalid/unavailable
→ remain PAYMENT_METHOD

Cart/price/stock changed
→ remain/re-enter REVIEW with conflict feedback

transaction/network failure
→ return to safe REVIEW/error state

success
→ CONFIRMATION
```

Do not permit step skipping that bypasses required prior state.

---

# 9. Step Navigation Rules

The stepper is functional, not decorative.

Required:

- current step visually active;
- completed steps visually completed;
- previous completed steps may be revisited;
- future incomplete steps cannot be entered by clicking the stepper;
- browser Back/Forward must not corrupt Checkout state;
- Review `Edit` actions return to the appropriate step;
- moving backward preserves safe entered Checkout data;
- moving forward requires validation;
- returning to Review uses updated state;
- completed state must not imply server purchase completion.

---

# 10. Checkout Draft State Ownership

Use the current frontend architecture and existing state-management standards.

Expected ownership:

```text
Server Cart
→ React Query / existing CartProvider authority

Checkout draft
→ local Checkout feature/provider/form state

Shipping draft
→ non-sensitive local/session state if persistence is required

Delivery method
→ Checkout draft state

Payment method type
→ Checkout draft state

Raw card details
→ NOT part of 03.5 production state
```

Do not create a second global app store merely for Checkout.

Do not create another QueryClient.

---

# 11. Refresh / Direct Route Protection

03.5 must behave safely on refresh and direct navigation.

Non-sensitive draft fields such as Shipping/Delivery may be restored using the existing approved persistence pattern or session-scoped storage if required.

Rules:

- Checkout draft must be scoped to the authenticated user/session;
- clear draft on successful Order creation;
- clear/replace draft on logout/account transition where relevant;
- never persist raw payment/card data;
- direct navigation to Delivery without valid Shipping → return to Shipping;
- direct navigation to Payment without Delivery → return to required prior step;
- direct navigation to Review without complete state → return to missing step;
- Confirmation hard refresh must be supported from persisted Order data, not only ephemeral memory.

---

# 12. Cart Review / Shared Order Summary

The desktop Make screenshots show an Order Summary visible throughout Checkout.

Required summary content:

- Product thumbnail;
- Product name;
- quantity;
- unit/line price where appropriate;
- subtotal;
- delivery method;
- shipping amount;
- total.

The summary must derive Product/Cart data from the current authoritative Cart projection.

Do not allow Checkout to maintain a second independent Cart copy.

---

# 13. Money Authority

All authoritative money calculations belong to the backend.

Requirements:

- do not use floating-point arithmetic for authoritative currency totals;
- follow existing Prisma Decimal / project money conventions;
- frontend values are display values only;
- subtotal uses current authoritative Product price at final submission;
- shipping amount is derived by backend from delivery method;
- total is server-calculated;
- client-supplied prices are never trusted;
- OrderItem stores immutable unit-price/line-total snapshots.

---

# 14. Shipping Information Step

Approved Make hierarchy:

```text
Shipping Information

Full Name
Street Address
City
Postcode / ZIP
Phone Number

Back to Cart
Continue to Delivery
```

Required behavior:

- form uses project-standard form architecture;
- inspect and reuse React Hook Form/Zod patterns if currently used;
- trim inputs;
- validate required fields;
- reject whitespace-only values;
- define reasonable min/max lengths according to existing standards;
- validate phone safely without forcing a US-only format;
- preserve actual user-entered values on backward/forward navigation;
- focus first invalid field after submit;
- show inline accessible validation;
- do not submit Shipping to Order until final Place Order transaction.

If current project Address/domain requirements already include `country`, `state/province`, or another field, inspect repository truth before deciding. Do not invent or omit required persisted fields merely to copy the screenshot.

---

# 15. Shipping Snapshot

Once Order creation succeeds, store an immutable shipping snapshot on the Order or an existing OrderAddress structure.

Semantic snapshot must preserve enough information to render the Order later without depending on a mutable user profile address.

At minimum, where supported by current schema:

```text
fullName
streetAddress
city
postalCode
phone
country/state if required by current domain
```

Changing a customer Account address after purchase must not rewrite historical Order shipping data.

---

# 16. Delivery Method Step

Approved Make direction:

```text
Standard Delivery
Free
5–7 business days

Express Delivery
$9.99
2–3 business days

Overnight Delivery
$19.99
Next business day
```

Treat these exact options/prices as the initial approved product behavior unless current repository docs define a different shipping configuration.

The entire option row should be interactive, not only the small radio control.

Required:

- one delivery method selected;
- Standard may be default if current behavior requires a default;
- keyboard-accessible radio-group semantics;
- clear selected visual state;
- summary updates immediately;
- selection preserved when navigating backward/forward;
- backend validates the selected delivery method;
- backend derives price from server-owned configuration.

---

# 17. Delivery Pricing Authority

The client must never determine authoritative shipping cost.

Never accept:

```json
{
  "deliveryMethod": "OVERNIGHT",
  "shippingPrice": 0
}
```

as truth.

Client submits the method identifier only.

Server maps identifier → price / delivery window.

If delivery options are returned by an API, the frontend may display those values, but final Place Order always recalculates on the backend.

---

# 18. Delivery Estimate

03.5 may calculate/store a simple delivery estimate/window derived from the selected delivery method.

This is **not** Phase 04 delivery tracking.

Allowed:

- Standard: semantic 5–7 business-day estimate;
- Express: semantic 2–3 business-day estimate;
- Overnight: semantic next-business-day estimate;
- snapshot/display of expected delivery range/date.

Deferred:

- live driver location;
- maps;
- route visualization;
- dynamic ETA;
- Socket.IO movement.

---

# 19. Payment Method Step — Security Boundary

The Make screenshot is a visual reference, but 03.5 must not create a homemade card-processing system.

Production 03.5 owns:

- payment-method selection shell;
- `CARD` / `Credit / Debit Card` as the currently enabled semantic method if consistent with product scope;
- visual placeholder/provider mount area for future Stripe integration;
- navigation/validation of payment-method selection;
- non-sensitive Review representation.

Production 03.5 must **not** collect/process/persist/transmit real PAN/CVV/expiry as application-owned data.

---

# 20. Raw Payment Data — Forbidden

Never persist or log:

```text
full card number / PAN
CVV/CVC
raw expiry
raw payment credentials
Stripe secret/payment tokens before 03.6
```

Do not put them in:

- localStorage;
- sessionStorage;
- React Query cache;
- Checkout persisted state;
- request bodies to ElectroHub backend;
- database columns;
- logs;
- analytics;
- screenshots with real data;
- test fixtures that resemble real secrets.

03.6 Stripe must own provider-hosted secure card entry.

---

# 21. Payment Make Screenshot Interpretation

The supplied Payment screenshot contains:

- Credit / Debit Card;
- PayPal;
- Card Number;
- Cardholder Name;
- Expiry Date;
- CVV;
- a fake decline-card note.

Classify these as follows:

| Element | 03.5 classification | Required action |
|---|---|---|
| Payment Method section | Approved | Implement |
| Credit / Debit Card selection | Approved | Implement method shell |
| Card-entry layout | Visual direction only | Use safe provider-placeholder composition; no raw application-owned card capture |
| PayPal | Future/unapproved | Do not implement behavior; omit unless current requirements explicitly require it |
| fake decline card number | 03.6 Stripe test behavior | Do not implement |
| Payment Failed flow | 03.6 | Do not implement as card-decline behavior |

Storybook may use clearly fake visual-only fixtures, but production 03.5 must not mislead users into thinking a real card payment was processed.

---

# 22. Review Step

Approved Make hierarchy:

```text
Review Your Order

Shipping Address
[actual validated address]
Edit

Delivery
[selected delivery method]
[delivery window]
Edit

Payment Method
[non-sensitive method label]
Edit

Order Summary
Products
Subtotal
Shipping
Total

Back
Place Order
```

Do not render fake placeholder address text.

Do not fabricate card last-four before Stripe provides tokenized metadata.

For 03.5 use a non-sensitive label such as:

```text
Credit / Debit Card
```

or another approved payment-method label.

---

# 23. Edit Actions

Each Review `Edit` action must:

- navigate to its corresponding prior step;
- preserve other Checkout draft data;
- preserve Cart data;
- return to Review after correction;
- not create an Order;
- not alter Inventory.

---

# 24. Final Place Order Request

The final Place Order request must contain only customer choices/data required for Order creation.

Semantic request may include:

```text
shipping details
deliveryMethod
paymentMethod type / future-provider shell identifier
idempotency key / checkout attempt identifier
optional expected summary values/revision used only for change detection
```

It must **not** trust or accept as authority:

- Product price;
- shipping price;
- final total;
- Inventory quantity;
- Product active state;
- payment success;
- order status.

---

# 25. Server Revalidation — Mandatory

Immediately before purchase commit, the backend must re-read authoritative state.

Required checks:

```text
authenticated user exists
Cart exists
Cart belongs to authenticated user
Cart is non-empty
Cart items exist
Product exists
Product is active/sellable
Inventory exists
requested Cart quantity is valid
requested quantity <= current stock
shipping is valid
delivery method is valid
backend shipping price is known
current Product price is known
money can be calculated safely
```

Never rely solely on the state that was displayed when Checkout first opened.

---

# 26. Price / Cart Change During Checkout

If authoritative price/Cart state changes while the user is on Checkout, do not silently create an Order at a surprising total.

Preferred behavior:

```text
Checkout summary shown at $X
server recalculates current total $Y
X != Y
→ normalized CHECKOUT_CHANGED / equivalent conflict
→ refresh summary
→ preserve safe Shipping/Delivery state
→ require customer to review current total before resubmitting
```

Follow current project error-envelope conventions.

If the repository already uses another revision/version strategy, reuse it.

---

# 27. Inventory Change During Checkout

Example:

```text
Cart quantity = 3
Checkout opens while stock = 3
another purchase reduces stock to 1
customer presses Place Order
```

Required:

```text
reject purchase
requested = 3
available = 1
no silent 3 → 1 mutation
no partial Order
no partial Inventory decrement
Cart intent preserved
```

Customer receives actionable feedback and may return to Cart to correct the quantity.

---

# 28. Atomic Checkout Transaction

The successful Place Order path must use one database transaction for all application-owned purchase state.

Semantic transaction:

```text
BEGIN
  ↓
Lock/serialize authenticated Cart checkout
  ↓
Load authoritative Cart within transaction
  ↓
Load/validate current Products + Inventory
  ↓
Recalculate Product prices
  ↓
Resolve authoritative delivery price
  ↓
Calculate subtotal/shipping/total
  ↓
Create Order
  ↓
Create OrderItems snapshots
  ↓
InventoryService.decreaseStock(...) for every item
  ↓
Clear Cart
COMMIT
```

Any failure:

```text
ROLLBACK EVERYTHING
```

---

# 29. Atomicity Invariant

These effects form one atomic business operation:

```text
Order creation
+
OrderItem creation
+
Inventory decrement
+
Cart clear
```

There must never be a successful state such as:

```text
Order created but stock unchanged
stock decremented but Order missing
one OrderItem created but another missing
Cart cleared but Order rolled back
one Inventory row decremented and another failed permanently
```

Transaction rollback must restore the prior state.

---

# 30. InventoryService Reuse

03.5 must reuse transaction-aware Inventory primitives created in 03.4.

Do not write:

```text
inventory.quantity = inventory.quantity - requested
```

as ad-hoc Checkout logic.

Use the existing safe method equivalent to:

```text
InventoryService.decreaseStock(tx, productId, quantity)
```

Exact names follow repository truth.

Required properties:

- same Prisma transaction client;
- no nested transaction;
- non-negative stock;
- normalized conflict;
- persisted Inventory status synchronized where required by existing schema;
- rollback on any later transaction failure.

---

# 31. Deterministic Multi-Item Locking

Multi-item Checkout must avoid unnecessary deadlock risk.

When locking/decrementing multiple Inventory rows:

- process rows in deterministic stable order, preferably canonical Product/Inventory ID order;
- use the existing Inventory transaction-aware locking behavior;
- do not let Cart item insertion order define lock order across transactions;
- preserve one transaction for the complete Order.

This requirement follows the 03.4 Checkout handoff.

---

# 32. Concurrency Requirement

At minimum prove:

```text
stock = 1
Customer A submits quantity 1
Customer B submits quantity 1 concurrently
```

Expected:

```text
one Order succeeds
one purchase fails with normalized stock conflict
final stock = 0
never -1
failed attempt creates no partial Order
failed attempt does not clear its Cart
```

Do not simulate this only with sequential mocked calls and claim concurrency proof.

---

# 33. Same-Cart Concurrent Submission

Two simultaneous Place Order requests for the same authenticated Cart must not create duplicate Orders.

Protect using:

- Cart row serialization/locking where architecture supports it;
- idempotency semantics;
- transaction checks after lock;
- unique constraints where appropriate.

A second concurrent request must resolve safely to:

- the already-created Order for the same idempotency key; or
- a normalized already-processed/empty-cart conflict;

but never a duplicate purchase.

---

# 34. Idempotency / Duplicate Submit Protection

Frontend disabled buttons are not enough.

03.5 must support backend-safe retry semantics for Place Order.

Preferred semantic contract:

```text
client creates one checkoutAttemptId / idempotency key
same key is reused for retry after timeout/network uncertainty
backend guarantees one Order result for that key + user
```

Implementation may use:

- `Idempotency-Key` header;
- request field;
- existing project idempotency infrastructure.

Do not create competing mechanisms.

A retry after the server already committed must return/recover the existing Order instead of creating another Order.

---

# 35. Cart Lock / Serialization

Where the schema has a Cart row, lock/serialize the authenticated Cart during final transaction so two different idempotency keys cannot both purchase the same unchanged Cart concurrently.

If current architecture has no direct row suitable for locking, use the smallest repository-consistent equivalent and document it.

Do not add a global application mutex.

---

# 36. Cart Clearing Rule

Clear the Cart only after all purchase validation and Order/Inventory writes are safely inside the successful transaction.

Required:

```text
Order failure
→ Cart preserved

Inventory conflict
→ Cart preserved

network request fails before server commit
→ Cart preserved

transaction commit succeeds
→ Cart cleared
```

After success update/invalidate the existing Cart query/provider so header badge and Cart UI become empty without stale flashes.

---

# 37. Order Core — Repository-First Decision

Before changing Prisma, inspect the current schema and migrations for existing:

- Order;
- OrderItem;
- status enums;
- payment fields;
- shipping/address structures;
- Cart relation;
- user relation;
- Product relation;
- price fields;
- unique order/reference fields.

Do not assume Order models are absent.

Prefer reusing/finishing existing foundation over creating parallel models.

---

# 38. Order Semantic Contract

03.5 needs the minimum persistent Order representation required for creation and confirmation.

Semantic fields may include equivalents of:

```text
id
orderNumber / reference
userId
subtotal
shippingAmount
total
deliveryMethod
shipping snapshot
estimated delivery/window if stored
initial order status according to current schema
paymentMethod type if appropriate
idempotency/checkout attempt identity
createdAt
updatedAt
```

Exact names must follow repository conventions.

Do not add fields only because this task document lists semantic examples.

---

# 39. OrderItem Snapshot Contract

OrderItem must preserve historical purchase facts.

Semantic snapshot should include equivalents of:

```text
orderId
productId/reference if current design keeps it
product name snapshot
product image snapshot/reference if required by confirmation
unit price snapshot
quantity
line total
```

Historical Order rendering must not depend entirely on mutable current Product name/price/image.

If current Product deletion behavior would cascade-delete Order history, treat that as a schema/architecture issue to resolve minimally or document/block according to repository standards.

---

# 40. Order Number / Reference

Generate Order reference on the backend.

Requirements:

- unique;
- collision-safe;
- human-readable enough for customer confirmation where possible;
- not trusted from client;
- do not expose unnecessary internal sequential database IDs when a public reference already exists or can safely be introduced.

The Make example `ORD-FZZXP5` is visual direction, not a requirement to copy that exact algorithm.

---

# 41. Initial Order / Payment Semantics

03.5 must not lie about payment.

If current Order schema already has an initial status, follow repository truth and document the pre-Stripe meaning.

Do **not** show:

```text
Paid
Total Paid
Payment Confirmed
```

unless 03.6 Stripe has actually provided that truth.

The confirmation page may say:

```text
Order Confirmed
Order Created
Order Total
```

according to approved product wording, while payment remains unprocessed/not represented as paid.

If the schema requires `paymentStatus`, use the correct pre-payment state such as existing `PENDING`/equivalent. Do not invent `PAID`.

---

# 42. Order Confirmation Data

The confirmation screen must render from persisted Order data / server response, not from the old Cart alone.

Required content where available:

- success icon/state;
- Order reference;
- Order date;
- item snapshot(s);
- quantity;
- prices;
- subtotal;
- shipping;
- Order Total;
- delivery method;
- estimated delivery/window;
- shipping destination summary where appropriate;
- Continue Shopping.

Do not show fake payment success.

---

# 43. Confirmation Hard Refresh

A successful Order confirmation must survive browser refresh.

Preferred architecture:

```text
POST create Order
→ returns public order reference + confirmation DTO
→ navigate to confirmation route keyed by opaque/public Order reference
→ refresh can GET minimal confirmation DTO scoped to authenticated owner
```

This minimal confirmation read is allowed in 03.5.

It is **not** permission to implement 03.7 My Orders/Order Details.

---

# 44. Confirmation Ownership / IDOR Protection

The confirmation read endpoint must verify ownership server-side.

User A must never access User B’s Order confirmation by guessing/changing:

- order ID;
- public order number;
- URL parameter.

Return project-standard not-found/forbidden semantics without leaking existence details beyond current conventions.

---

# 45. Confirmation CTA Boundary

The Make confirmation screenshot includes:

```text
View Order Details
Continue Shopping
```

03.5 must not create the 03.7 Order Details page solely to satisfy this button.

Rules:

- `Continue Shopping` is implemented;
- `View Order Details` is rendered only if a valid existing route already exists within approved scope;
- otherwise omit it or refine it without creating a broken/future route;
- do not create a fake Order Details page.

---

# 46. Processing State

The Make screenshot shows a generic spinner with:

```text
Processing your order…
Please do not close or refresh this page.
```

Use the same layout concept, but:

# **MUST REUSE ELECTROHUB’S EXISTING PRODUCTION LOADING/SPINNER COMPONENT.**

Do not introduce a second arbitrary spinner.

During submission:

- lock duplicate Place Order interaction;
- disable relevant navigation that could cause duplicate submission;
- preserve accessibility status announcement;
- respect reduced motion;
- do not expose stale success before server commit;
- do not clear Cart optimistically before success.

---

# 47. Processing Timeout / Unknown Outcome

Network timeout does not prove the transaction failed.

Use idempotency so the client can safely retry/recover.

Example:

```text
server commits Order
response connection drops
client sees network error
client retries same idempotency key
→ backend returns existing Order
→ no duplicate Order
```

This is a mandatory production-quality behavior if a retry could otherwise duplicate the purchase.

---

# 48. Generic Checkout Failure States

03.5 requires failure handling for:

- invalid Shipping;
- invalid Delivery;
- empty Cart;
- Product inactive;
- missing Product;
- missing Inventory;
- insufficient Inventory;
- Cart changed;
- price changed;
- shipping option changed;
- order transaction failure;
- network/server failure;
- auth expiry;
- duplicate/idempotent retry recovery.

03.5 does **not** implement Stripe card-decline/payment-failed behavior.

---

# 49. Failure Preservation Invariant

On any unsuccessful purchase attempt:

```text
NO partial Order
NO partial OrderItems
NO partial Inventory decrement
NO Cart clear
```

Preserve safe Shipping/Delivery draft data where possible so the user can correct the issue without restarting Checkout.

---

# 50. API Contract — Repository-First

Inspect existing route conventions before introducing endpoints.

Do not create duplicate Order/Checkout APIs if an Order domain already exists.

Preferred semantic capabilities:

```text
GET current Checkout summary/options
POST create Order from authenticated Cart
GET minimal owned Order confirmation
```

A clean implementation may use routes semantically equivalent to:

```text
GET  /api/checkout
POST /api/orders
GET  /api/orders/:orderReference/confirmation
```

Exact route names must follow current repository/API standards.

03.7 should extend the same Order API instead of replacing it.

---

# 51. Checkout Summary / Options API

If the repository needs a Checkout read endpoint, it may return:

```text
current Cart items
current authoritative subtotal
allowed delivery methods
server-owned shipping prices
current total for selected/default method
checkout blockers
```

Avoid overfetching future Order Management fields.

Do not make per-item Inventory requests from the browser.

---

# 52. Create Order Response

The create-order response should return only what the client needs to transition safely to Confirmation.

Semantic response:

```text
orderReference
createdAt
order status appropriate to 03.5
confirmation summary
items snapshots
subtotal
shipping
total
delivery/estimate
```

Do not return raw internal database data unnecessarily.

---

# 53. Error Codes / HTTP Semantics

Follow the existing project error envelope.

Use normalized domain errors equivalent to:

```text
CHECKOUT_EMPTY_CART
CHECKOUT_INVALID_SHIPPING
CHECKOUT_INVALID_DELIVERY
CHECKOUT_CHANGED
PRODUCT_UNAVAILABLE
INVENTORY_NOT_FOUND
OUT_OF_STOCK
INSUFFICIENT_STOCK
ORDER_ALREADY_CREATED / IDEMPOTENCY_CONFLICT
ORDER_NOT_FOUND
```

Suggested semantics only where compatible with existing standards:

```text
400 → malformed/validation
401 → unauthenticated
403/404 → ownership according to project convention
409 → stock/cart/price/idempotency business conflict
```

Never leak:

- Prisma errors;
- SQL;
- raw constraint names;
- stack traces;
- database URLs;
- secrets.

---

# 54. Database Decision Gate

Before any migration:

1. inspect `schema.prisma`;
2. inspect Order/OrderItem/current enums;
3. inspect Cart/User/Product/Inventory relations;
4. inspect migration history;
5. inspect constraints/indexes;
6. inspect seed behavior;
7. compare with required semantic contract.

Prefer:

```text
NO migration
```

if current schema already safely supports 03.5.

If not, create the **smallest forward migration** needed.

Never use `prisma db push` for task completion.

Never edit historical migrations.

---

# 55. Database Integrity Requirements

Where schema changes are required, enforce database-level integrity according to project standards.

Consider/reuse as applicable:

- unique Order reference;
- unique idempotency key scoped appropriately;
- non-negative Order money fields;
- positive OrderItem quantity;
- Order→User relation;
- OrderItem→Order relation;
- Product reference/history behavior;
- indexes for user/order lookup;
- createdAt ordering;
- delivery method/status enum integrity.

Do not add redundant indexes blindly.

---

# 56. Decimal / Money Database Safety

Order monetary fields must use current project Decimal/currency conventions.

Never convert authoritative totals to binary floating point for persistence.

Order snapshot must preserve exact values used when the Order was created.

---

# 57. Existing Bad Data / Migration Preflight

If a required migration adds constraints or non-null fields:

- inspect current DEV/PROD data first;
- do not silently repair unrelated records;
- stop and report if existing data violates a new constraint;
- use explicit migration/backfill strategy only when approved;
- separate source implementation from live DB operations/evidence.

---

# 58. DEV / PROD Database Operations

Repository implementation and DB deployment evidence must remain distinct.

If migration is required:

- validate locally/source first;
- use approved Supabase/Prisma workflow;
- verify DEV project identity before write;
- preflight DEV;
- deploy DEV migration;
- verify ledger/physical schema;
- run DEV live checkout transaction gate;
- only then consider PROD migration under approved workflow;
- never seed PROD;
- perform only read-only PROD post-deploy verification unless explicitly authorized.

Do not claim DB PASS from migration files alone.

---

# 59. React Query / Cache Architecture

Reuse current React Query architecture.

Do not create:

- new global QueryClient;
- per-step query clients;
- per-product Inventory fetches;
- aggressive polling.

Checkout should reuse current Cart query ownership and introduce only bounded Checkout/Order queries/mutations required by 03.5.

After Order success:

- Cart cache must become empty/current;
- header Cart count must update;
- confirmation data must remain available;
- stale pre-order Cart data must not reappear.

---

# 60. Background Cart Revalidation

When Checkout has usable content:

```text
background Cart refetch
→ keep current content visible
```

Do not replace the entire Checkout flow with a full skeleton during ordinary background refresh.

If Cart/Inventory becomes invalid:

- surface current authoritative conflict;
- block Place Order;
- preserve safe Shipping/Delivery draft state;
- provide Return to Cart / actionable path.

---

# 61. Loading State Rules

Reuse existing ElectroHub patterns.

Required loading categories:

```text
initial Checkout load
background Cart/summary refresh
step action pending where relevant
Place Order submitting
Confirmation load/refresh
```

Do not conflate:

```text
loading
empty Cart
invalid Cart
stock conflict
server error
success
```

---

# 62. Source / Authority Hierarchy

When sources appear to conflict:

```text
1. ROADMAP.md
   → owns phase/task boundaries

2. TASK_03.5_CHECKOUT.md
   → exact 03.5 behavior and acceptance criteria

3. Current repository schema/API/domain/code
   → current implementation truth

4. Supplied Figma Make screenshots
   → approved visual starting evidence

5. Current ElectroHub design system
   → tokens/components/loading/motion/responsive rules

6. Approved 03.2 Cart + 03.4 Inventory implementation
   → Cart/Inventory integration truth

7. Existing Storybook/testing architecture
   → verification patterns
```

No live Figma Design link is required for this task.

Do not invent hidden Figma behavior.

---

# 63. Mandatory Make Screenshot Inspection

Before coding, inspect every supplied Make screenshot relevant to 03.5.

The goal is not blind pixel copying.

The goal is to identify:

- approved information architecture;
- stepper hierarchy;
- Header/Footer shell;
- Checkout content width;
- desktop form/summary composition;
- Order Summary behavior;
- form grouping;
- Delivery option treatment;
- Review cards/edit actions;
- Processing-state composition;
- Confirmation-card composition;
- what is approved;
- what needs production refinement;
- what belongs to 03.6/03.7;
- prototype-only controls that must never ship.

Classify each element as:

```text
APPROVED / REUSE
CONTROLLED REFINEMENT ALLOWED
NEW 03.5 STATE REQUIRED
FUTURE 03.6
FUTURE 03.7
STALE SHELL — CURRENT APP WINS
PROTOTYPE CONTROL — NEVER IMPLEMENT
```

---

# 64. Required Screenshot Set

Use the supplied screenshots directly. No Figma Design URL is required.

## 64.1 Shipping

```text
Checkout page.png
1920 × 907
```

Reference for:

- Checkout heading;
- four-step stepper;
- breadcrumb;
- Shipping Information form;
- two-column City/ZIP row;
- action buttons;
- desktop Order Summary placement.

## 64.2 Delivery

```text
Checkout-page.png
1920 × 907
```

Reference for:

- delivery option cards;
- selected-row treatment;
- radio/icon/text/price alignment;
- action buttons;
- summary placement.

## 64.3 Payment

```text
Checkout_page.png
1920 × 911
```

Reference for:

- Payment Method section hierarchy;
- method-tab/card-shell composition;
- action placement;
- summary composition.

Important: raw card inputs/PayPal/test-decline behavior are not authoritative 03.5 functionality. Follow the security boundary in this task.

## 64.4 Review

```text
Checkoutpage.png
1920 × 908
```

Reference for:

- Shipping/Delivery/Payment review cards;
- `Edit` action placement;
- Place Order hierarchy;
- right-side Order Summary.

Replace prototype placeholder address values with real validated data.

## 64.5 Order Confirmation — Top

```text
Screenshot 2026-09-04 162523.png
1920 × 906
```

Reference for:

- centered success composition;
- confirmation card;
- Order reference/date;
- item summary;
- totals hierarchy.

03.5 refinement:

- no `Paid` badge;
- no fake payment success;
- `Total Paid` → `Order Total`.

## 64.6 Order Confirmation — Lower Content

```text
Screenshot 2026-09-04 162526.png
1920 × 911
```

Reference for:

- estimated-delivery placement;
- CTA hierarchy;
- Footer relationship.

Do not build 03.7 Order Details solely for the `View Order Details` CTA.

## 64.7 Processing State

```text
Screenshot 2026-09-04 163230.png
1920 × 909
```

Reference for:

- centered processing layout;
- body spacing;
- Footer placement.

Mandatory deviation:

- replace generic Make spinner with ElectroHub’s existing production Loading/Spinner.

---

# 65. Screenshot Filename Rule

If actual attachment filenames vary by spaces/case/suffix:

- use the actual files available in the worktree/task attachments;
- do not rename merely to satisfy this task;
- document any discrepancy in the implementation report.

---

# 66. Make Refinement Rule

The Make screenshots are the approved visual **starting reference**, not an immutable pixel prison.

Preserve:

- information architecture;
- Checkout sequence;
- major composition;
- ElectroHub identity;
- current Header/Footer;
- summary hierarchy;
- form hierarchy;
- delivery-card style;
- Review hierarchy;
- confirmation structure.

Controlled refinement is explicitly allowed for:

- polished layouts;
- stronger spacing/rhythm;
- actual project typography/tokens;
- additional required states/screens;
- validation feedback;
- error states;
- loading/skeleton behavior;
- current loading spinner reuse;
- sticky summary behavior;
- complete mobile/tablet layouts;
- keyboard/focus interaction;
- reduced motion;
- long content;
- real data variation;
- dynamic multi-item summaries;
- advanced but subtle UX interactions;
- production-grade state transitions.

Refinement is not permission to randomly redesign the product.

---

# 67. Approved vs Refinement vs Future Matrix

Before implementation produce the actual matrix based on repository/screenshots.

Expected baseline:

| Element | Classification | Action |
|---|---|---|
| Existing Header/Footer | Approved/reuse | MUST reuse |
| Shipping step | Approved | Implement + validate |
| Delivery step | Approved | Implement + backend authority |
| Payment Method section | Approved | Implement provider-neutral shell |
| raw card form fields | 03.6 provider boundary | Do not own/store/process in 03.5 |
| PayPal | Future/unapproved | Do not implement behavior |
| Review | Approved | Implement with real state |
| desktop Order Summary | Approved | Implement/reuse |
| generic Make spinner | Replace | Use existing ElectroHub loader |
| confirmation composition | Approved | Implement/refine |
| `Paid` badge | Future 03.6 | Remove in 03.5 |
| `Total Paid` | Future 03.6 semantics | Use `Order Total` |
| Payment Failed / declined card | Future 03.6 | Do not implement |
| My Orders | Future 03.7 | Do not implement |
| Order Details | Future 03.7 | Do not implement |
| Track Delivery | Future Phase 04 | Do not implement |
| Figma prototype bottom nav/control | Prototype-only | Never implement |

Final implementation report must include the actual inspected matrix.

---

# 68. Visual Quality Target

Checkout UI target:

# **Clean → premium → calm → trustworthy → modern electronics commerce**

The first handoff should already feel production-quality.

Avoid:

- unfinished placeholders;
- arbitrary extra cards;
- over-animation;
- excessive shadows;
- giant empty gaps;
- cramped summary panels;
- fake security claims;
- inconsistent button sizes;
- broken mobile stepper;
- layout jumps between steps.

---

# 69. Desktop Layout

At 1440/1920, target the Make composition:

```text
Main Checkout content
        +
Right Order Summary
```

Requirements:

- centered max-width shell consistent with current app;
- Checkout main column receives majority width;
- summary aside remains readable;
- summary may be sticky if current shell supports it cleanly;
- sticky summary must not overlap Header/Footer;
- changing steps should not cause major horizontal layout shifts;
- long multi-item summary must remain usable.

---

# 70. Stepper UX

Stepper must support:

- numbered current/future states;
- completed-state icon/check where design supports;
- meaningful accessible labels;
- clear current step;
- no dependence on color alone;
- responsive compact treatment;
- keyboard focus when step is interactive;
- non-clickable future incomplete steps.

---

# 71. Shipping Visual States

Required Storybook/real-app states:

- pristine;
- partially filled;
- valid;
- invalid one field;
- multiple errors;
- long address;
- long name;
- international-ish phone formatting where supported;
- disabled/pending transition only where necessary;
- restored draft after step navigation.

---

# 72. Delivery Visual States

Required:

- Standard selected;
- Express selected;
- Overnight selected;
- keyboard-focused row;
- hover/pressed where applicable;
- long delivery text;
- selected summary updates;
- server-option load/error if options are API-driven.

---

# 73. Payment Method Visual States

Required:

- Card method selected;
- safe provider-placeholder shell;
- provider unavailable/generic error where meaningful;
- future provider boundary documented;
- no real payment-status simulation;
- no fake `Paid` semantics.

If a disabled future PayPal tile is shown at all, it must be clearly non-interactive and must not imply supported functionality. Prefer omission unless current approved requirements explicitly keep it.

---

# 74. Review Visual States

Required:

- one Cart item;
- multiple Cart items;
- free shipping;
- paid shipping;
- long Shipping address;
- updated Shipping after Edit;
- updated Delivery after Edit;
- generic Card method representation;
- Checkout conflict banner;
- Place Order disabled during invalid/conflicted state;
- submitting transition.

---

# 75. Processing Visual State

Required:

- existing ElectroHub Loading/Spinner;
- centered processing message;
- current Header/Footer shell where approved;
- duplicate clicks impossible;
- reduced-motion behavior;
- accessible live status;
- no flashing between Review and Confirmation.

Do not hard-code a fake delay solely to make the spinner visible.

---

# 76. Confirmation Visual States

Required:

- one item;
- multiple items;
- free shipping;
- paid shipping;
- long Product name;
- long Shipping destination;
- valid Order reference;
- estimated-delivery content;
- refresh loading state;
- refresh error/not-owned state;
- no payment badge claiming `Paid`;
- `Order Total`, not `Total Paid`.

---

# 77. Security Copy

The Make screenshots contain:

```text
Secure checkout — 256-bit SSL encryption
```

Do not hard-code specific encryption claims unless they are accurate for the deployed environment and approved by project documentation.

Allowed refinement:

```text
Secure checkout
```

with a lock icon, or omit unsupported marketing copy.

Never use security theater as a substitute for actual transport/security configuration.

---

# 78. Responsive Requirements

Mandatory review widths:

```text
390
768
1440
1920
```

Do not treat a desktop screenshot as sufficient responsive guidance.

---

# 79. Responsive — 390

At mobile width:

- single-column layout;
- summary moves below/above main action according to best UX, not squeezed beside form;
- stepper remains understandable without horizontal page overflow;
- labels may compact/wrap but remain accessible;
- form fields full width;
- City/ZIP stack if necessary;
- delivery cards fit without clipping price;
- primary/secondary actions are touch-friendly;
- Review cards do not overflow;
- multi-item summary remains readable;
- Confirmation card fits viewport;
- no sticky aside;
- Footer remains correct.

---

# 80. Responsive — 768

At tablet width:

- avoid cramped two-column form+summary if it harms readability;
- summary may stack beneath main content;
- maintain stepper clarity;
- preserve comfortable field width;
- actions remain obvious;
- Review edit links do not collide with content;
- Confirmation remains centered/balanced.

---

# 81. Responsive — 1440

At desktop width:

- Make desktop composition should be clearly recognizable;
- main Checkout content + summary aside;
- stable content widths;
- sticky summary allowed if polished;
- no excessive whitespace;
- primary action hierarchy obvious.

---

# 82. Responsive — 1920

At large desktop:

- do not stretch form fields across the full monitor;
- use current max-width/container system;
- maintain balanced main/aside ratio;
- summary remains visually connected to Checkout;
- confirmation card stays appropriately constrained;
- Footer composition remains consistent.

---

# 83. Advanced UX Interaction Rules

Required first-pass interactions:

- whole Delivery option rows clickable;
- Review `Edit` actions return to exact step;
- returning from Edit preserves other valid state;
- summary updates without full-page flicker;
- focus moves to first form error;
- server Checkout conflict receives visible alert and focus/announcement;
- Place Order cannot be double-clicked into duplicate orders;
- retry after unknown network outcome uses same idempotency key;
- browser Back/Forward does not corrupt step state;
- background Cart changes do not silently disappear;
- Confirmation refresh does not depend on old Cart cache;
- successful Checkout clears transient draft.

---

# 84. Motion

Follow current ElectroHub motion standards.

Motion should be subtle and functional.

Allowed:

- small active-step transitions;
- delivery-card hover/press feedback;
- button pending state;
- error/success appearance;
- current spinner.

Do not add theatrical route transitions.

`prefers-reduced-motion` must be respected.

---

# 85. Accessibility

Mandatory:

- correct form labels;
- inputs associated with errors/descriptions;
- errors announced appropriately;
- logical tab order;
- keyboard-operable Delivery radio group;
- visible focus;
- stepper current state communicated semantically;
- buttons/links use correct elements;
- `Edit` actions have contextual accessible names where necessary;
- summary totals readable by assistive technology;
- no color-only state;
- processing state announced without repeated noisy announcements;
- reduced motion respected;
- minimum reasonable touch targets;
- no nested interactive controls;
- confirmation success meaning does not depend only on green icon.

Run automated accessibility checks and manual keyboard review.

---

# 86. Storybook — Mandatory

Storybook is mandatory for 03.5.

Use production components/pages/state adapters, not fake duplicate components.

Stories must make state review possible without a live backend where appropriate.

Storybook does not replace real application/E2E verification.

---

# 87. Storybook — Checkout Stepper

Required states:

```text
Shipping current
Delivery current
Payment current
Review current
completed previous steps
mobile compact
long labels where applicable
```

---

# 88. Storybook — Order Summary

Required:

```text
one item
multiple items
free shipping
paid shipping
long Product name
large quantity
long price/total
mobile stacked
```

---

# 89. Storybook — Shipping Step

Required:

```text
pristine
valid
single validation error
multiple validation errors
long values
mobile
```

---

# 90. Storybook — Delivery Step

Required:

```text
Standard selected
Express selected
Overnight selected
keyboard/focus visual
mobile
```

---

# 91. Storybook — Payment Method Step

Required:

```text
Card selected
safe Stripe/provider placeholder
method shell unavailable/error if applicable
mobile
```

Do not create a story that suggests ElectroHub owns real card credentials.

---

# 92. Storybook — Review Step

Required:

```text
normal review
long address
multiple products
paid shipping
Checkout changed/conflict
Place Order pending
mobile
```

---

# 93. Storybook — Processing

Required:

```text
existing ElectroHub loader
normal motion
reduced motion
mobile
```

---

# 94. Storybook — Confirmation

Required:

```text
one item
multiple items
free shipping
paid shipping
long destination
long Product name
refresh/loading
not-owned/error presentation if componentized
mobile
```

No `Paid` state in 03.5.

---

# 95. Storybook Responsive / A11y Matrix

Where existing tooling supports it, verify relevant stories at:

```text
390
768
1440
1920
```

Run current Storybook accessibility tooling/axe integration.

Do not introduce a second Storybook configuration for Checkout.

---

# 96. Backend Unit Tests

At minimum test:

## Shipping validation

- required values;
- whitespace;
- length bounds;
- phone validation according to chosen schema.

## Delivery pricing

- Standard;
- Express;
- Overnight;
- unknown method rejected;
- client cannot override shipping amount.

## Order totals

- Product subtotal;
- shipping;
- total;
- Decimal precision;
- multi-item totals.

## Order reference

- generated server-side;
- uniqueness behavior.

## Snapshot behavior

- OrderItem uses purchase-time name/price/quantity;
- later Product changes do not alter persisted snapshot in relevant integration tests.

## Idempotency

- same key returns/reuses one Order;
- different requests with same incompatible key produce normalized behavior;
- no duplicate Order.

---

# 97. Backend Transaction / Integration Tests

Mandatory transaction-level tests:

```text
valid one-item order
valid multi-item order
stock exact quantity
insufficient stock
out of stock
missing Inventory
inactive Product
Product missing
Cart empty
Cart ownership
shipping invalid
delivery invalid
client shipping-price tamper
client Product-price tamper
Order/OrderItem creation
Inventory decrement
Cart clear on success
Cart preserved on failure
rollback after second-item failure
idempotent retry
confirmation ownership
```

Use real database integration where repository test architecture supports it.

Mocks do not prove transaction rollback or physical constraints.

---

# 98. Atomic Rollback Test

Required scenario:

```text
Cart:
Product A × 1 — enough stock
Product B × 2 — conflict/failure
```

Prove after failure:

```text
no Order
no OrderItems
Product A stock unchanged
Product B stock unchanged
Cart unchanged
```

This is a release-blocking invariant.

---

# 99. Genuine Concurrent Checkout Test

Required real PostgreSQL scenario where supported:

```text
one Inventory row quantity = 1
Checkout A requests 1
Checkout B requests 1 concurrently
```

Prove:

- exactly one Order succeeds;
- exactly one normalized stock conflict;
- final quantity = 0;
- no negative stock;
- failed Cart preserved;
- no orphan Order/OrderItem.

Label this evidence accurately as real DB integration/LIVE DEV, not unit.

---

# 100. Same-Cart Duplicate Request Test

Required:

```text
same authenticated Cart
same idempotency key
request sent twice/concurrently
```

Expected:

```text
one Order
one Inventory decrement
one Cart clear
retry resolves to existing Order or documented idempotent response
```

Also test different duplicate key/concurrent Cart submission behavior if architecture permits.

---

# 101. Frontend Unit / Component Tests

At minimum cover:

## Step navigation

- cannot skip required steps;
- back preserves state;
- Review Edit returns correctly.

## Shipping

- validation;
- inline errors;
- focus first error.

## Delivery

- selected method;
- summary price update;
- keyboard behavior.

## Payment shell

- Card method selection;
- no raw-card persistence/submit path;
- correct Review label.

## Review

- real entered address;
- correct delivery method;
- current totals;
- conflict state;
- Place Order pending.

## Confirmation

- server DTO rendering;
- no `Paid`/`Total Paid` in 03.5;
- refresh state.

---

# 102. React Query / State Tests

Verify:

- Cart authority remains existing provider/query;
- background refetch does not erase Checkout draft;
- logout/user transition does not leak prior customer Checkout draft;
- success clears Cart cache/draft;
- failed purchase keeps Cart state;
- mutation cannot create duplicate order from rapid click;
- stale response cannot overwrite confirmed Order state;
- confirmation query is identity scoped;
- no private Order confirmation cache under a shared anonymous key.

---

# 103. Playwright / Browser E2E Matrix

Implement focused deterministic scenarios.

## A — Auth Guard

Guest direct Checkout navigation cannot purchase and follows approved auth flow.

## B — Empty Cart

Authenticated empty Cart cannot proceed to Checkout purchase.

## C — Shipping Validation

Invalid Shipping blocks Delivery and focuses/announces error.

## D — Shipping State Preservation

Valid Shipping survives Delivery→Back→Shipping.

## E — Delivery Standard

Standard selected; summary shipping is Free.

## F — Delivery Express

Express selected; summary reflects server-approved $9.99.

## G — Delivery Overnight

Overnight selected; summary reflects server-approved $19.99.

## H — Payment Method Shell

Card method selected; no raw payment data sent to ElectroHub backend.

## I — Review

Review shows exact Shipping + Delivery + non-sensitive payment method + Cart summary.

## J — Review Edit

Edit Shipping/Delivery returns to step and preserves other state.

## K — Successful Order

Valid Place Order → Processing → Confirmation.

## L — Existing Loader

Processing uses ElectroHub existing loading component, not a task-specific spinner.

## M — Cart Cleared on Success

Header/Cart state reflects empty Cart only after successful Order.

## N — Inventory Decrement

Successful purchase decreases Inventory exactly by ordered quantities.

## O — Exact Stock

Order succeeds when requested quantity equals available stock; stock becomes zero.

## P — Stock Shrink During Checkout

Current stock becomes insufficient before Place Order → conflict; no silent clamp; Cart preserved.

## Q — Product Inactive During Checkout

Product becomes inactive → purchase blocked; no Order/stock mutation.

## R — Price Change

Authoritative price changes before Place Order → customer must review changed summary according to implemented conflict strategy.

## S — Multi-Item Rollback

One item conflict means entire Order transaction rolls back.

## T — Duplicate Click

Rapid double Place Order creates one Order only.

## U — Network Retry / Idempotency

Retry with same attempt key cannot duplicate the Order.

## V — Confirmation Refresh

Hard refresh on confirmation renders persisted owned Order summary.

## W — Confirmation Ownership

Another user cannot access the confirmation URL.

## X — Responsive

390 / 768 / 1440 / 1920.

## Y — Keyboard

Complete essential Checkout flow with keyboard.

## Z — Reduced Motion

Processing/step interactions respect reduced-motion settings.

## AA — No Per-Item Inventory HTTP

Browser network inspection shows no per-item/card Inventory request explosion.

## AB — No Future Scope Leakage

No Stripe payment result, My Orders implementation, Order Details page, email/PDF/tracking is accidentally implemented as part of 03.5.

---

# 104. Real Browser Review — Mandatory

Automated tests are not enough.

Perform real browser QA with the actual application.

At minimum inspect:

- Shipping;
- Delivery;
- Payment method shell;
- Review;
- Processing;
- Confirmation;
- conflict/error state;
- long address;
- multiple Cart items;
- paid delivery;
- browser Back/Forward;
- direct route/hard refresh;
- header Cart badge after success;
- Footer/layout interaction;
- 390;
- 768;
- 1440;
- 1920.

Do not make the user the first visual QA engineer.

---

# 105. Slow-Network Verification

Test meaningful slow-state behavior.

At minimum:

- initial Checkout load;
- Cart summary refresh;
- Place Order pending;
- confirmation fetch;
- server conflict response.

Verify:

- no false success;
- no duplicate submission;
- no full-page flicker when usable data exists;
- no stale Order summary after commit;
- accessible pending state;
- existing loader remains stable.

---

# 106. Screenshot Capture and Inspection

Capture implementation screenshots after behavior is working.

Required visual evidence:

```text
Shipping — desktop + mobile
Delivery — desktop + mobile
Payment Method shell — desktop + mobile
Review — desktop + mobile
Processing — desktop + mobile
Confirmation — desktop + mobile
Checkout conflict/error — representative
multi-item Order Summary — representative
```

Also capture tablet/large desktop where layout differs materially.

Critical rule:

# **OPEN AND INSPECT THE SCREENSHOTS.**

Generating files without visual inspection is not QA.

---

# 107. Screenshot Inspection Checklist

For every captured state inspect:

- Header/Footer consistency;
- container width;
- alignment;
- form field spacing;
- labels/errors;
- stepper state;
- Order Summary alignment;
- delivery price alignment;
- button hierarchy;
- sticky behavior;
- overflow;
- long text;
- scroll position;
- spinner/loading component identity;
- confirmation card;
- footer overlap;
- mobile wrapping;
- focus/error visibility;
- no prototype bottom navigation visible.

Record found/fixed defects.

---

# 108. Performance Requirements

## Backend

Avoid:

- N+1 Product/Inventory reads;
- per-item transaction creation;
- repeated Product queries for the same Cart item;
- unbounded Order reads;
- unnecessary broad locks;
- long network calls inside DB transaction;
- Stripe/external calls in 03.5 transaction (Stripe not implemented yet).

Transaction duration should be bounded to database-owned work.

## Frontend

Avoid:

- duplicate Cart queries per step;
- repeated Order Summary remount/fetch loops;
- broad app invalidation;
- unnecessary full-page rerenders;
- polling;
- huge persisted Checkout state;
- raw card-state storage.

---

# 109. Security Requirements

Mandatory review:

```text
authentication
Order ownership
Cart ownership
server-side Product/Inventory authority
price tampering
shipping-price tampering
input validation
raw card-data prohibition
secret/log exposure
IDOR on confirmation
idempotency abuse
error sanitization
mass assignment
```

Customer must never be able to submit:

- another user’s Cart/order reference;
- arbitrary price;
- arbitrary shipping amount;
- arbitrary `Paid` status;
- arbitrary stock result;
- arbitrary order status.

---

# 110. No Raw Payment Data Security Test

Explicitly verify through source and browser/network inspection:

- no Card Number field value sent to ElectroHub backend;
- no CVV sent;
- no expiry persisted;
- no raw card local/session storage;
- no logs containing card-like values;
- no DB fields introduced for raw card data.

This is merge-blocking.

---

# 111. API Compatibility

All 03.5 API additions should be additive.

Do not break existing:

- Auth;
- Cart;
- Product;
- Inventory;
- Wishlist;
- Search.

Reuse existing error envelope, Decimal serialization, auth middleware, ownership patterns, API client conventions, and query keys.

03.7 must be able to extend Order reads without replacing 03.5 creation APIs.

---

# 112. 03.6 Stripe Handoff Contract

At completion, document exactly what 03.6 must reuse.

At minimum:

- Checkout step architecture;
- Payment Method step/provider placeholder;
- Order Core;
- idempotency model;
- Order totals;
- Shipping snapshot;
- Order reference;
- confirmation semantics;
- current pre-payment order/payment status semantics;
- Inventory transaction behavior.

03.6 may insert Stripe processing into the orchestration, but must not rebuild Checkout/Order models in parallel.

03.6 must replace the safe placeholder with provider-hosted/tokenized Stripe UI and authoritative payment states.

---

# 113. 03.7 Order Management Handoff Contract

At completion, document exactly what 03.7 must reuse.

At minimum:

- Order model;
- OrderItem model/snapshots;
- public Order reference;
- user ownership;
- totals;
- delivery method/shipping snapshot;
- initial status semantics;
- confirmation DTO/query where applicable.

03.7 may add:

- My Orders;
- Order Details;
- history pagination;
- full status presentation;
- payment status presentation;
- management-specific DTOs.

03.7 must not create a second Order table/model/service for the same records.

---

# 114. Mandatory Repository-First Workflow

Before implementation:

1. Read `AGENTS.md`.
2. Confirm branch `feature/Checkout`.
3. Synchronize safely according to repository Git workflow.
4. Read this task file completely.
5. Inspect current `docs/`.
6. Identify only relevant docs.
7. Read them.
8. Inspect current:
   - Cart/CartItem models and services;
   - authenticated Cart API;
   - Inventory model/service from 03.4;
   - Inventory transaction-aware decrement method;
   - Product pricing/status;
   - current Order/OrderItem schema if any;
   - User/Auth middleware;
   - API error envelope;
   - Prisma transaction conventions;
   - money/Decimal conventions;
   - React Router;
   - CartProvider/React Query/query keys;
   - forms/RHF/Zod patterns;
   - Header/Footer;
   - existing loading/spinner component;
   - shared inputs/buttons/radio/status components;
   - Storybook;
   - Playwright configs;
   - supplied Make screenshots.
9. Compare Make screenshots against project requirements.
10. Produce approved/refinement/future matrix.
11. Define Checkout state machine/invariants.
12. Define Order/DB decision.
13. Define API contract.
14. Define transaction/idempotency strategy.
15. Define related-file manifest.
16. Enter bounded Plan Mode.
17. Implement only 03.5.
18. Run focused automated tests.
19. Run database/integration tests.
20. Run Storybook/a11y.
21. Run Playwright.
22. Run real browser adversarial QA.
23. Capture screenshots.
24. OPEN and inspect screenshots.
25. Fix task-scoped defects.
26. Run changed-file full review.
27. Update docs/handoffs.
28. Produce final implementation report.
29. Stop before commit/push/merge.

---

# 115. Task-Specific Documentation Discovery

Do not blindly read every document.

Likely relevant:

## Project Foundation

- Roadmap;
- Project structure;
- tech stack;
- dependencies;
- decisions/glossary if applicable.

## Design

- design system;
- components;
- layouts;
- colors;
- typography;
- icons;
- motion;
- responsive;
- UI guidelines.

## Architecture

- system architecture;
- frontend architecture;
- backend architecture;
- API architecture;
- database architecture.

## Engineering Standards

- coding standard;
- TypeScript;
- SCSS;
- component guidelines;
- API guidelines;
- state management;
- error handling;
- security;
- performance.

## Feature Docs

- Auth;
- Cart;
- Inventory;
- Product;
- Order/Checkout if already present;
- State/API foundation.

## Database

- Prisma schema;
- migrations;
- seed strategy;
- DB operations guidance.

## Quality

- testing;
- Storybook;
- E2E;
- accessibility;
- Definition of Done.

Do not spend task time reading AI, Cloudinary, Email, PDF, Delivery Tracking, Admin analytics, or unrelated features unless a direct dependency is discovered.

---

# 116. Related-File Manifest — Mandatory

Before coding, list the smallest complete file surface.

Classify each file:

```text
CORE IMPLEMENTATION
DIRECT INTEGRATION
DB/MIGRATION
TEST
STORYBOOK
E2E
DOCUMENTATION
SCREENSHOT/DESIGN EVIDENCE
```

For every file explain:

- why it is relevant;
- whether it is expected to change;
- what requirement it serves.

Do not use the task as permission for repository-wide cleanup.

---

# 117. Plan Mode Requirements

The Plan must explicitly state:

- current Cart/Inventory/Order foundation;
- DB migration decision;
- Checkout state machine;
- state ownership;
- route strategy;
- API contract;
- Shipping validation;
- Delivery authority;
- Payment security boundary;
- Order snapshot design;
- transaction boundary;
- deterministic lock ordering;
- idempotency;
- Cart clear behavior;
- confirmation refresh strategy;
- 03.6 handoff;
- 03.7 handoff;
- Storybook matrix;
- test matrix;
- browser/screenshot plan.

Do not code first and rationalize later.

---

# 118. Recommended Implementation Sequence

```text
REPOSITORY + DOCS
        ↓
MAKE SCREENSHOT INSPECTION
        ↓
APPROVED / REFINEMENT / FUTURE MATRIX
        ↓
RELATED-FILE MANIFEST
        ↓
PLAN MODE
        ↓
ORDER/DB DECISION
        ↓
CHECKOUT DOMAIN + VALIDATION
        ↓
DELIVERY AUTHORITY
        ↓
ORDER CORE
        ↓
ATOMIC TRANSACTION + INVENTORY REUSE
        ↓
IDEMPOTENCY
        ↓
API + CONFIRMATION READ
        ↓
FRONTEND CHECKOUT STATE
        ↓
SHIPPING
        ↓
DELIVERY
        ↓
PAYMENT METHOD SHELL
        ↓
REVIEW
        ↓
PROCESSING WITH EXISTING LOADER
        ↓
CONFIRMATION
        ↓
STORYBOOK
        ↓
UNIT / INTEGRATION
        ↓
PLAYWRIGHT
        ↓
REAL BROWSER
        ↓
SCREENSHOT CAPTURE + OPEN/INSPECT
        ↓
FULL CHANGED-FILE REVIEW
        ↓
DOCS + 03.6/03.7 HANDOFF
        ↓
ARCHITECT REVIEW
```

---

# 119. Validation Categories

Use repository scripts that actually exist.

At minimum where applicable:

```text
backend focused unit tests
backend route/API tests
backend DB/transaction integration tests
backend typecheck
backend lint
backend build

frontend component/page tests
frontend state/query tests
frontend typecheck
frontend lint
frontend production build

Storybook build
Storybook a11y/browser verification
Playwright Checkout suite
real-browser manual QA
responsive QA
keyboard QA
reduced-motion QA
screenshot inspection

git diff --check
secret scan
```

Do not invent commands that the repository does not expose.

Do not claim green when a command failed or was skipped.

---

# 120. DEV Live Checkout Gate

03.5 requires live DEV evidence because the defining behavior is transactional persistence.

Against the verified DEV environment, prove with disposable labeled fixtures/account:

- authenticated Checkout;
- real Cart;
- real Shipping/Delivery request;
- real Order creation;
- real OrderItems;
- real Inventory decrement;
- real Cart clear;
- real confirmation retrieval;
- conflict rollback;
- concurrency;
- idempotent retry;
- ownership.

Record before/after DB values.

Clean disposable fixtures.

Do not mutate curated Products unless explicitly approved.

---

# 121. PROD Gate

If 03.5 introduces a migration, PROD may receive only the approved migration after DEV passes and explicit deployment workflow permits it.

PROD verification should be read-only after deployment.

Do not run destructive Order/Inventory transaction fixtures in PROD.

Do not seed PROD.

If no migration is required, no PROD DB write is required for 03.5 implementation verification.

---

# 122. Seed / Fixture Requirements

Inspect seed strategy before running anything.

Do not run seed simply because it exists.

Test fixtures must be:

- disposable;
- clearly labeled;
- isolated from curated Products/orders;
- cleaned after live tests.

Never use real payment credentials.

---

# 123. Documentation Updates

Update only materially affected docs.

Likely:

- CHECKOUT feature doc;
- CART integration doc;
- INVENTORY Checkout handoff/status;
- ORDER core doc if present/new;
- API doc;
- database architecture;
- migrations;
- state management;
- security/payment-boundary doc;
- testing;
- Storybook;
- roadmap evidence/status where project convention records task completion;
- 03.6 Stripe handoff;
- 03.7 Order Management handoff;
- implementation evidence report.

Documentation must describe what was actually implemented, not future intended behavior.

---

# 124. No Random Bug Hunting

Do not use 03.5 to fix unrelated defects.

Allowed fixes:

- task-blocking direct dependency defect;
- regression caused by 03.5;
- pre-existing direct Checkout/Order/Cart/Inventory issue that must be corrected for the required behavior.

If an unrelated issue is found:

- record it as out-of-scope;
- do not refactor unrelated code.

---

# 125. Changed-File Full Review — Mandatory

Before handoff run:

```bash
git status
git diff --stat
git diff --name-only
git diff --check
```

Include staged and untracked files.

Read **every changed/untracked task file in full**, not only diff lines.

For each changed file ask:

```text
Why changed?
Required by 03.5?
Full file coherent?
Duplicate logic?
Stale code?
Unrelated changes?
Security regression?
Transaction regression?
API compatibility risk?
Tests cover changed behavior?
```

If every changed implementation file has not been read in full:

```text
DO NOT HAND OFF AS READY.
```

---

# 126. Full Requirement Traceability

Before completion map every major requirement:

```text
REQUIREMENT
→ SOURCE FILE/FUNCTION
→ TEST
→ LIVE EVIDENCE IF APPLICABLE
→ STATUS
```

Classification:

```text
Implemented
Partially Implemented
Missing
Incorrect
Not Applicable
```

---

# 127. Definition of Done — Checkout Flow

All must pass:

```text
[ ] authenticated-only Checkout
[ ] valid non-empty Cart required
[ ] Shipping
[ ] Delivery
[ ] Payment Method shell
[ ] Review
[ ] Processing
[ ] Confirmation
[ ] back/edit preserves safe state
[ ] direct route protection
[ ] refresh safety
[ ] real Order Summary
```

---

# 128. Definition of Done — Transaction

```text
[ ] final Cart revalidation
[ ] final Product revalidation
[ ] final Inventory revalidation
[ ] server-authoritative Product prices
[ ] server-authoritative shipping price
[ ] Decimal-safe totals
[ ] Order created
[ ] OrderItems snapshots created
[ ] InventoryService safe decrement reused
[ ] deterministic multi-item locking/order
[ ] Cart cleared only on success
[ ] complete rollback on failure
[ ] no negative stock
[ ] duplicate submission protected
[ ] idempotent retry supported
```

---

# 129. Definition of Done — Order Core

```text
[ ] repository Order foundation inspected
[ ] no parallel Order model
[ ] public Order reference
[ ] user ownership
[ ] totals snapshot
[ ] Shipping snapshot
[ ] delivery method snapshot
[ ] Product/price/quantity snapshots
[ ] confirmation DTO
[ ] confirmation refresh
[ ] 03.7 reuse documented
```

---

# 130. Definition of Done — Payment Boundary

```text
[ ] method-selection shell implemented
[ ] no fake payment processing
[ ] no raw PAN persistence
[ ] no CVV persistence
[ ] no raw expiry persistence
[ ] no backend card credential endpoint
[ ] no `Paid` claim
[ ] no `Total Paid`
[ ] Stripe boundary documented
[ ] 03.6 reuse documented
```

---

# 131. Definition of Done — Visual / Make

```text
[ ] all relevant Make screenshots inspected
[ ] approved/refinement/future matrix produced
[ ] Shipping follows approved hierarchy
[ ] Delivery follows approved hierarchy
[ ] Payment follows safe refined hierarchy
[ ] Review follows approved hierarchy
[ ] Processing uses actual ElectroHub loader
[ ] Confirmation follows approved composition
[ ] no prototype customer/admin/flows/components overlay implemented
[ ] no stale shell overrides current app
[ ] additional production states implemented
[ ] screenshots captured and opened/inspected
```

---

# 132. Definition of Done — Responsive

```text
[ ] 390 verified
[ ] 768 verified
[ ] 1440 verified
[ ] 1920 verified
[ ] no horizontal overflow
[ ] stepper usable
[ ] summary usable
[ ] long address safe
[ ] multiple items safe
[ ] actions safe
[ ] Footer safe
```

---

# 133. Definition of Done — Accessibility

```text
[ ] form labels
[ ] error associations
[ ] focus first invalid field
[ ] keyboard Checkout path
[ ] Delivery radio semantics
[ ] stepper semantics
[ ] focus visible
[ ] processing announcement
[ ] success/error not color-only
[ ] reduced motion
[ ] axe/Storybook checks
```

---

# 134. Definition of Done — Storybook

```text
[ ] Stepper stories
[ ] Order Summary stories
[ ] Shipping stories
[ ] Delivery stories
[ ] Payment shell stories
[ ] Review stories
[ ] Processing story with real loader
[ ] Confirmation stories
[ ] conflict/error states
[ ] responsive states
[ ] accessibility pass
[ ] no live backend required for deterministic stories
```

---

# 135. Definition of Done — Testing

```text
[ ] backend unit
[ ] API/route
[ ] DB transaction integration
[ ] atomic rollback
[ ] real concurrency
[ ] idempotency
[ ] frontend component
[ ] React Query/state
[ ] Playwright A–AB or equivalent coverage
[ ] real browser QA
[ ] slow-state QA
[ ] screenshot inspection
```

---

# 136. Definition of Done — Performance

```text
[ ] no N+1 Checkout item reads
[ ] no per-item browser Inventory requests
[ ] bounded DB transaction
[ ] no external network call inside 03.5 DB transaction
[ ] no polling
[ ] no broad unnecessary invalidation
[ ] no duplicate Cart ownership
```

---

# 137. Definition of Done — Security

```text
[ ] authenticated Checkout
[ ] Cart ownership
[ ] Order ownership
[ ] server price authority
[ ] server shipping authority
[ ] Inventory authority
[ ] no raw card data
[ ] no fake Paid status
[ ] confirmation IDOR prevented
[ ] validation/sanitization
[ ] idempotency safe
[ ] no secret exposure
```

---

# 138. Definition of Done — Database

```text
[ ] schema inspected
[ ] migration decision documented
[ ] no db push
[ ] historical migrations untouched
[ ] Order integrity constraints/indexes correct
[ ] money types correct
[ ] idempotency uniqueness correct if implemented
[ ] DEV migration verified if required
[ ] DEV live transaction verified
[ ] PROD only handled per approved workflow
```

---

# 139. Definition of Done — Handoffs

```text
[ ] 03.6 Stripe handoff complete
[ ] 03.7 Order Management handoff complete
[ ] no future task duplicated
[ ] Order/Checkout core reuse explicit
```

---

# 140. Rejection Conditions

Request changes / do not hand off as complete if any applies:

- static UI only with no real Order transaction;
- client prices trusted;
- client shipping price trusted;
- no final Inventory revalidation;
- ad-hoc stock decrement bypasses InventoryService;
- stock can go negative;
- partial Order/stock/Cart side effects possible;
- failed Order clears Cart;
- duplicate Place Order can create duplicate Orders;
- no idempotency/retry safety where duplicate risk exists;
- raw card/CVV persisted or sent to backend;
- fake `Paid` status;
- Stripe implemented prematurely;
- My Orders/Order Details built prematurely;
- confirmation ownership missing;
- confirmation cannot survive refresh;
- generic new spinner instead of existing ElectroHub loader;
- screenshots not inspected;
- mobile/tablet ignored;
- Storybook missing;
- E2E missing;
- real-browser QA missing;
- docs/handoff stale;
- unrelated scope expansion;
- completion claimed from mocks only.

---

# 141. Required Final Implementation Report

Use this structure:

```text
# TASK 03.5 — CHECKOUT IMPLEMENTATION REPORT

## Status
COMPLETE / PARTIAL / BLOCKED

## Branch
feature/Checkout

## Scope Implemented
- ...

## Explicitly Deferred
03.6:
- ...

03.7:
- ...

Other:
- ...

## Documentation Read
- ...

## Related-File Manifest
- ...

## Make Screenshot Verification
Shipping:
PASS / FAIL

Delivery:
PASS / FAIL

Payment:
PASS / FAIL WITH CONTROLLED REFINEMENT

Review:
PASS / FAIL

Processing:
PASS / FAIL — existing ElectroHub loader reused YES/NO

Confirmation:
PASS / FAIL WITH PAYMENT-SEMANTIC REFINEMENT

Approved / Refinement / Future matrix:
...

## Architecture
- ...

## Checkout State Machine
- ...

## Database Decision
NO MIGRATION / MIGRATION
Details:
...

## Order Core
- ...

## API
- ...

## Shipping Validation
PASS / FAIL

## Delivery Authority
PASS / FAIL

## Payment Security Boundary
Raw card data persisted:
NO / YES

Raw card data sent to backend:
NO / YES

03.6 handoff:
PASS / FAIL

## Atomic Transaction
PASS / FAIL

Order:
PASS / FAIL

OrderItems:
PASS / FAIL

Inventory decrement:
PASS / FAIL

Cart clear:
PASS / FAIL

Rollback:
PASS / FAIL

## InventoryService Reuse
PASS / FAIL

## Concurrency
PASS / FAIL

## Idempotency
PASS / FAIL

## Confirmation Refresh / Ownership
PASS / FAIL

## Storybook
PASS / FAIL — count

## Backend Tests
PASS / FAIL — count

## DB/Integration Tests
PASS / FAIL — count

## Frontend Tests
PASS / FAIL — count

## Playwright
PASS / FAIL — count
Scenarios:
...

## Real Browser Review
PERFORMED / NOT PERFORMED

390:
PASS / FAIL

768:
PASS / FAIL

1440:
PASS / FAIL

1920:
PASS / FAIL

## Screenshot Inspection
OPENED AND INSPECTED:
YES / NO

Defects found:
- ...

Defects fixed:
- ...

Remaining:
NONE / ...

## Accessibility
PASS / FAIL

## Performance
N+1:
NO / YES

Per-item Inventory HTTP:
NO / YES

## Security
PASS / FAIL

## Validation
Backend typecheck:
PASS / FAIL

Backend lint:
PASS / FAIL

Backend build:
PASS / FAIL

Frontend typecheck:
PASS / FAIL

Frontend lint:
PASS / FAIL

Frontend build:
PASS / FAIL

Storybook build:
PASS / FAIL

git diff --check:
PASS / FAIL

## DEV Live Checkout Gate
PASS / FAIL / BLOCKED

## PROD Migration / Read-Only Gate
PASS / FAIL / N/A

## Files Changed
- ...

## Documentation Updated
- ...

## 03.6 Stripe Handoff
- ...

## 03.7 Order Handoff
- ...

## Out-of-Scope Observations
NONE / ...

## Remaining Risks
NONE / ...

## Remaining Blockers
NONE / ...

## Ready for Principal Architect Review
YES / NO
```

---

# 142. Required Requirement Matrix

Final report must classify every major requirement as:

```text
Implemented
Partially Implemented
Missing
Incorrect
```

At minimum include:

- authenticated Checkout;
- Cart review;
- Shipping;
- Delivery;
- Payment method shell;
- Review;
- final validation;
- backend price authority;
- backend shipping authority;
- Order creation;
- OrderItems snapshots;
- Inventory decrement;
- no negative stock;
- Cart clear on success;
- Cart preservation on failure;
- atomic rollback;
- concurrency;
- idempotency;
- confirmation;
- confirmation refresh;
- ownership;
- no raw payment data;
- no fake Paid state;
- current loader reuse;
- Storybook;
- responsive;
- accessibility;
- Playwright;
- real-browser review;
- screenshot inspection;
- 03.6 handoff;
- 03.7 handoff.

---

# 143. Evidence Rule

Do not say:

```text
looks correct
should work
probably safe
transaction seems fine
```

Prefer:

```text
verified by unit test
verified by route/API test
verified by real PostgreSQL transaction test
verified by LIVE DEV before/after DB state
verified by browser network trace
verified in real browser
verified by screenshot inspection
verified by migration ledger/catalog
```

Always distinguish:

```text
UNIT
MOCKED SERVICE
COMPONENT
STORYBOOK
INTERCEPTED E2E
LOCAL REAL API
LOCAL REAL POSTGRES
LIVE DEV
LIVE PROD READ-ONLY
```

Do not claim transaction persistence/concurrency from mocks.

---

# 144. Final Architecture Principles

1. **Cart remains customer intent until successful purchase.**
2. **Checkout never trusts stale Cart/price/Inventory state.**
3. **Backend owns Product price and shipping price.**
4. **03.5 owns purchase-time Order transaction.**
5. **03.5 reuses 03.4 Inventory primitives.**
6. **Order + OrderItems + stock decrement + Cart clear are atomic.**
7. **Failed purchase preserves Cart.**
8. **Stock never becomes negative.**
9. **Multi-item lock order is deterministic.**
10. **Duplicate Place Order is backend-protected, not only button-disabled.**
11. **Order snapshots preserve purchase-time facts.**
12. **Confirmation is ownership-protected and refreshable.**
13. **03.5 does not own Stripe payment processing.**
14. **ElectroHub never stores raw card/CVV data.**
15. **03.5 does not own full Order Management.**
16. **Existing Header/Footer/design system/loading spinner are reused.**
17. **Make screenshots guide composition but may be refined for production quality.**
18. **Responsive/accessibility are part of implementation, not future polish.**
19. **Tests do not replace real-browser QA.**
20. **No completion claim without evidence.**

---

# 145. Completion Gate

Task 03.5 is complete only when all applicable items are proven:

```text
REPOSITORY TRUTH
✓ current Cart inspected
✓ current Inventory service inspected
✓ current Order schema inspected
✓ current loading component inspected
✓ current APIs/state patterns inspected

CHECKOUT
✓ authenticated entry
✓ Cart review
✓ Shipping
✓ Delivery
✓ Payment method shell
✓ Review
✓ Processing
✓ Confirmation

AUTHORITY
✓ Product prices server-owned
✓ shipping price server-owned
✓ Inventory server-owned
✓ final revalidation

ORDER
✓ Order core
✓ OrderItems snapshots
✓ public reference
✓ shipping snapshot
✓ confirmation DTO
✓ ownership

TRANSACTION
✓ atomic
✓ InventoryService reuse
✓ deterministic multi-item order
✓ Cart clear on success
✓ Cart preserved on failure
✓ rollback
✓ no negative stock

RESILIENCE
✓ duplicate submission protection
✓ idempotent retry
✓ confirmation refresh
✓ price/stock conflict behavior

PAYMENT BOUNDARY
✓ no raw card data
✓ no fake payment processor
✓ no Paid claim
✓ 03.6 handoff

ORDER MANAGEMENT BOUNDARY
✓ no My Orders
✓ no full Order Details
✓ 03.7 handoff

UI
✓ Make screenshots inspected
✓ current loader reused
✓ polished layouts
✓ additional required states
✓ responsive 390/768/1440/1920
✓ accessibility

QUALITY
✓ Storybook
✓ backend unit
✓ DB integration
✓ frontend tests
✓ Playwright
✓ real browser
✓ slow network
✓ screenshot inspection
✓ performance
✓ security
✓ changed-file full review
✓ docs
```

The standard is not:

> “Checkout screens exist.”

The standard is:

> **ElectroHub has a secure, authoritative, transaction-safe, visually polished Checkout workflow that converts an authenticated Cart into one immutable Order atomically, reuses the 03.4 Inventory core, prevents overselling and duplicate orders, preserves failure recovery, and cleanly hands payment processing to 03.6 and full Order Management to 03.7.**

---

# 146. Permanent 03.5 Execution Flow

```text
REPOSITORY SYNC
        ↓
TASK + CURRENT DOCS
        ↓
RELATED-FILES MANIFEST
        ↓
MAKE SCREENSHOT INSPECTION
        ↓
APPROVED / REFINEMENT / FUTURE MATRIX
        ↓
PLAN MODE
        ↓
ORDER/DB DECISION
        ↓
CHECKOUT DOMAIN / STATE MACHINE
        ↓
SHIPPING + DELIVERY AUTHORITY
        ↓
PAYMENT PROVIDER BOUNDARY
        ↓
ORDER CORE
        ↓
ATOMIC ORDER TRANSACTION
        ↓
03.4 INVENTORY PRIMITIVES
        ↓
IDEMPOTENCY / CONCURRENCY
        ↓
CONFIRMATION CORE
        ↓
FRONTEND SHIPPING / DELIVERY / PAYMENT / REVIEW
        ↓
EXISTING ELECTROHUB LOADER
        ↓
CONFIRMATION UI
        ↓
STORYBOOK
        ↓
UNIT / API / DB INTEGRATION
        ↓
PLAYWRIGHT
        ↓
LIVE DEV TRANSACTION GATE
        ↓
REAL-BROWSER ADVERSARIAL REVIEW
        ↓
SCREENSHOT CAPTURE
        ↓
OPEN + INSPECT SCREENSHOTS
        ↓
FIX TASK-SCOPED DEFECTS
        ↓
FULL CHANGED-FILE REVIEW
        ↓
DOCS
        ↓
03.6 STRIPE HANDOFF
        ↓
03.7 ORDER HANDOFF
        ↓
PRINCIPAL ARCHITECT REVIEW
```

---

# 147. Stop Rule

Do not commit, push, merge, or self-approve unless the user explicitly authorizes that later.

When implementation and verification are complete:

```text
STOP
→ provide implementation report
→ provide evidence
→ READY FOR PRINCIPAL ARCHITECT REVIEW
```

The Principal Software Architect decides final approval.
