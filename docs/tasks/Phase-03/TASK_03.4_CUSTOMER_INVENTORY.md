# ELECTROHUB — TASK 03.4 / CUSTOMER INVENTORY & INVENTORY CORE

**Phase:** 03 — Commerce  
**Task:** 03.4 — Inventory  
**Working split:** 03.4A — Customer Inventory + Inventory Core  
**Branch:** `feature/Inventory`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Primary area:** Inventory core / Customer availability / ProductCard / Product Details / Cart / Wishlist / Purchase restrictions  
**Implementation type:** Full-stack + UI + API + database decision gate + state + validation + Storybook + automated/manual QA  
**Future consumer:** TASK 05.3 — Admin Inventory Operations MUST reuse this task's Inventory core, status semantics, service layer, DTOs, validations, and existing `StatusBadge`; it must not create a parallel Inventory architecture.

---

# 1. Task Objective

Implement ElectroHub's customer-facing Inventory system and the backend Inventory core required by the remaining Commerce workflow.

TASK 03.4 must establish one authoritative stock model that is consumed consistently by:

- Product listing surfaces;
- ProductCard;
- Product Details;
- Shopping Cart;
- Wishlist;
- later Checkout;
- later Orders;
- later Admin Inventory Operations.

TASK 03.4 must deliver:

- authoritative stock quantity;
- `IN_STOCK`;
- `LOW_STOCK`;
- `OUT_OF_STOCK`;
- backend-derived inventory status;
- low-stock threshold capability;
- current-availability propagation;
- customer purchase restrictions;
- Cart quantity restrictions;
- guest Cart inventory validation;
- authenticated Cart inventory validation;
- out-of-stock purchase blocking;
- low-stock customer messaging;
- existing Cart/Wishlist item preservation when stock changes;
- backend/server-side enforcement;
- safe stock-update service primitives for later Admin/Checkout use;
- low-stock core capability for later Admin alerts;
- consistent ProductCard / Product Details / Cart / Wishlist availability UI;
- reuse of the existing `StatusBadge`;
- polished loading, success, unavailable, low-stock, out-of-stock, stale/background-refresh, and validation states;
- complete responsive behavior;
- accessible keyboard/focus behavior;
- Storybook states;
- backend/frontend/integration/E2E verification;
- mandatory real-browser adversarial visual review;
- screenshot capture AND screenshot inspection;
- documentation and final evidence;
- an explicit 05.3 Admin Inventory handoff.

The customer experience must feel like a real electronics-commerce inventory system, not a decorative "In Stock" label.

```text
02.2 Database Foundation
        ↓
Product / Inventory schema foundation
        ↓
02.5 Product Foundation
        ↓
Product availability
        ↓
02.7 State + API Foundation
        ↓
React Query / API client / cache / loading / errors
        ↓
03.1 Product Catalog
        ↓
ProductCard / Product Details / Product imagery
        ↓
03.2 Shopping Cart
        ↓
Cart quantity / availability validation foundation
        ↓
03.3 Wishlist
        ↓
Saved Product / ProductCard reuse
        ↓
03.4 Inventory
        ↓
Authoritative stock / availability / purchase restrictions
        ↓
03.5 Checkout
        ↓
Final inventory validation + purchase transaction
        ↓
03.7 Orders
        ↓
Order/inventory effects
        ↓
05.3 Admin Inventory Operations
        ↓
Restock / set quantity / low-stock operations
```

03.4 must **consume and extend** the current architecture.

It must NOT create a parallel:

- Inventory model;
- Product model;
- ProductCard;
- `StatusBadge`;
- Cart;
- Wishlist;
- API client;
- QueryClient;
- Auth architecture;
- design system;
- stock-status engine.

---

## Customer Inventory Visual Invariants

1. Unresolved inventory never appears as Out of Stock.
2. Out-of-stock Products remain navigable unless the Product itself is unavailable.
3. Out-of-stock Wishlist Products remain saved and removable.
4. Out-of-stock or insufficient-stock Cart lines remain visible and removable.
5. Background refresh preserves usable Product, Cart, and Wishlist content.
6. Usable data is never replaced by a full skeleton.
7. Stock changes preserve gallery state and Wishlist membership.
8. All surfaces consume the same backend-derived stock semantics.
9. ProductCard geometry remains stable across stock states.
10. Stock presentation reuses the shared StatusBadge.
11. Out-of-stock Add is visibly and semantically disabled; navigation and hearts remain usable.
12. Low-stock feedback remains compact and readable.
13. Cart controls never imply quantities above the server maximum are valid.
14. Cart and Wishlist entries are never silently removed by stock changes.
15. Cart and Wishlist operations never reserve or decrement inventory.

# 2. Roadmap Scope and Approved Split

The roadmap defines 03.4 as:

- Stock quantity
- In-stock
- Low-stock
- Out-of-stock
- Stock updates
- Purchase restrictions
- Low-stock alerts

This task interprets those roadmap bullets using the approved phase split.

## 2.1 03.4A — Implement Now

TASK 03.4A owns:

1. Inventory domain truth
2. Stock quantity
3. Low-stock threshold capability
4. Derived stock status
5. `IN_STOCK`
6. `LOW_STOCK`
7. `OUT_OF_STOCK`
8. Product purchasability using current Product status + Inventory
9. Product summary availability
10. Product detail availability
11. ProductCard availability UI
12. Product Details availability UI
13. Products/Home/Search/related ProductCard propagation
14. Cart availability validation
15. Cart purchase restrictions
16. Guest Cart inventory revalidation
17. Authenticated Cart server-side inventory enforcement
18. Wishlist availability presentation
19. Out-of-stock Cart/Wishlist preservation
20. Low-stock customer messaging
21. Current-stock background refresh behavior
22. Stock-change UX while customer is on a page
23. Backend Inventory service primitives
24. Safe stock set/increase/decrease core methods where current architecture supports them
25. Non-negative-stock guarantees
26. Low-stock predicate/query capability required by future Admin
27. Existing `StatusBadge` reuse
28. Storybook
29. Unit tests
30. Integration/API tests
31. Playwright
32. Real browser QA
33. Responsive QA
34. Accessibility
35. Performance verification
36. Documentation
37. TASK 05.3 reuse/handoff contract

## 2.2 05.3 — Explicitly Deferred Admin UI

Do NOT build these customer-unrelated Admin UI workflows in 03.4A:

- Admin Inventory page;
- Admin Inventory dashboard;
- manual stock editing screen;
- restock form;
- quantity-adjustment form;
- bulk stock operations;
- low-stock Admin list UI;
- low-stock Admin filters;
- low-stock dashboard widgets;
- Admin alerts panel;
- Inventory analytics;
- warehouse UI;
- supplier UI.

These belong to:

```text
TASK 05.3 — Admin Inventory Operations
```

TASK 05.3 MUST later reuse this task's:

- `Inventory` model;
- Inventory service;
- availability derivation;
- low-stock threshold semantics;
- stock update primitives;
- API/domain types;
- validations;
- `StatusBadge`;
- test fixtures;
- database constraints;
- error codes.

05.3 must not duplicate or redefine them.

## 2.3 Stock Updates Interpretation

The 03.4 roadmap bullet "Stock updates" is split as follows:

```text
03.4A
→ backend Inventory core
→ safe set/increase/decrease service behavior
→ validation
→ non-negative guarantees
→ API/domain capability where current architecture already exposes it
→ tests

05.3
→ Admin UI controls that call the approved Inventory core
```

Do not create a large Admin REST/UI surface in 03.4 solely to satisfy a future screen.

If current Product/Admin backend routes already support stock update:

- reuse them;
- route them through the Inventory core;
- enforce ADMIN authorization;
- add tests.

If no approved Admin route exists:

- implement the safe Inventory service/core now;
- defer route/UI exposure to 05.3 unless the current architecture requires a minimal route to verify the core.

## 2.4 Low-Stock Alerts Interpretation

03.4A owns the **low-stock condition and data capability**.

05.3 owns the **Admin alert presentation**.

03.4A must NOT add:

- email low-stock notifications;
- SMS low-stock notifications;
- push notifications;
- Socket.IO low-stock alerts;
- notification center;
- scheduled replenishment alerts.

---

# 3. Explicitly Out of Scope

Do NOT implement:

- Checkout workflow — 03.5;
- Stripe — 03.6;
- Order creation — 03.7;
- payment state;
- shipping;
- tax engine;
- stock reservation on Cart Add;
- stock decrement on Cart Add;
- inventory ownership by frontend;
- full purchase transaction;
- final Checkout atomic decrement unless a tiny reusable primitive is required;
- multi-warehouse inventory;
- location-specific stock;
- supplier management;
- purchase orders;
- automatic replenishment;
- backorders;
- preorders;
- stock transfer;
- serial-number tracking;
- batch/lot tracking;
- return-to-stock workflows;
- inventory history/audit product unless current architecture already provides it;
- AI demand prediction;
- inventory forecasting;
- email/SMS/push low-stock notification;
- Admin Inventory page;
- Admin analytics;
- redesign of Cart/Wishlist/Product Catalog;
- unrelated Product CRUD;
- unrelated bug fixing.

Do not expand 03.4 into 03.5–03.9 or Phase 05.

---

# 4. Non-Negotiable Architecture

## 4.1 Authority Flow

```text
Customer UI
        ↓
Product / Cart / Wishlist feature boundaries
        ↓
React Query + current client state
        ↓
Central API client
        ↓
Express routes/controllers
        ↓
Product / Cart / Inventory services
        ↓
Prisma
        ↓
Supabase PostgreSQL
```

Inventory truth lives here:

```text
Supabase PostgreSQL
        ↓
Prisma Inventory row
        ↓
Backend Inventory/Product/Cart service
        ↓
Bounded API DTO
        ↓
Frontend presentation
```

The frontend may display and react to Inventory.

The frontend must NEVER become the authority for Inventory.

## 4.2 Backend Authority

The backend remains authoritative for:

- stock quantity;
- stock status;
- Product active/sellable state;
- whether a requested quantity is allowed;
- authenticated Cart quantity acceptance;
- later Checkout inventory validation;
- later Inventory mutations.

Never trust client-controlled:

- stock quantity;
- availability status;
- low-stock threshold;
- Product active status;
- Cart stock validation result;
- purchase permission.

## 4.3 State Ownership

```text
Inventory truth
→ backend/database

Product summary/detail server state
→ React Query

Authenticated Cart
→ backend + React Query

Guest Cart intent
→ existing guest Cart storage
→ must be revalidated against current Inventory

Wishlist membership
→ existing 03.3 architecture

UI-only stock feedback
→ derived from authoritative DTO
→ local component state only where ephemeral
```

Do not introduce:

- another QueryClient;
- Redux/Zustand just for Inventory;
- inventory data duplicated into guest Wishlist storage;
- inventory data duplicated into guest Cart as authority;
- direct database access from frontend;
- per-card inventory fetches;
- a second Product availability engine.

---

# 5. Inventory Domain Model

## 5.1 Product and Inventory Are Distinct

Maintain the conceptual relationship:

```text
Product
   ↓ 1:1
Inventory
```

Product identity/business status and Inventory quantity are different concerns.

## 5.2 Required Inventory Fields — Semantic Contract

Repository truth must be inspected first.

The Inventory foundation should semantically support:

```text
productId
quantity
lowStockThreshold
updatedAt
```

Exact field names must follow the current schema.

Do NOT rename working schema merely to match this task text.

## 5.3 Quantity

Quantity must be:

```text
integer
>= 0
```

No decimal stock for standard electronics units.

Reject:

- negative values;
- `NaN`;
- Infinity;
- decimal units;
- strings that bypass validation;
- unsafe integer values.

## 5.4 Low-Stock Threshold

A Product is low stock when:

```text
0 < quantity <= lowStockThreshold
```

Threshold must be:

```text
integer
>= 0
```

Repository-first rule:

1. inspect whether `lowStockThreshold` already exists;
2. reuse current field/semantics if present;
3. if missing and current architecture has no equivalent, adding a persisted threshold is allowed;
4. use a safe migration;
5. do not create a second Inventory table/model.

If a new threshold field is required:

```text
default = 5
```

is the approved fallback for existing/new Inventory rows unless current repository documentation already defines another default.

Do not overwrite existing configured threshold values.

## 5.5 Stock Status

Stock status is DERIVED.

Do not persist a second status column unless current repository architecture already does so for a justified reason.

Required derivation:

```text
quantity === 0
→ OUT_OF_STOCK

quantity > 0 && quantity <= lowStockThreshold
→ LOW_STOCK

quantity > lowStockThreshold
→ IN_STOCK
```

Boundary examples for threshold `5`:

| Quantity | Status |
|---:|---|
| 20 | `IN_STOCK` |
| 6 | `IN_STOCK` |
| 5 | `LOW_STOCK` |
| 4 | `LOW_STOCK` |
| 1 | `LOW_STOCK` |
| 0 | `OUT_OF_STOCK` |

## 5.6 Product Status vs Inventory Status

Do NOT collapse:

```text
Product active/inactive
Inventory stock status
Cart-line validity
```

Example:

```text
Product active + stock 0
→ stock status OUT_OF_STOCK
→ Product may remain visible
→ Product is not purchasable

Product inactive + stock 10
→ stock status may technically be IN_STOCK
→ Product is still NOT purchasable because Product is inactive
```

The UI and backend must preserve this distinction.

## 5.7 Customer Purchasability

Conceptually:

```text
purchasable =
Product is active/sellable
AND Inventory exists
AND quantity > 0
```

Do not use stock status alone to represent Product activation.

---

# 6. Database Decision Gate

Before any Prisma change:

1. read current `schema.prisma`;
2. inspect Product ↔ Inventory relation;
3. inspect current Inventory fields;
4. inspect migrations;
5. inspect indexes/constraints;
6. inspect DEV seed behavior;
7. confirm whether 03.4 can be implemented without migration.

## 6.1 Expected Existing Foundation

Expected concept:

```text
Product
 ↓ 1:1
Inventory
```

Expected uniqueness:

```text
Inventory.productId UNIQUE
```

There must not be multiple inventory rows for one Product unless current approved architecture explicitly models variants/locations.

03.4 does NOT introduce variants/warehouses.

## 6.2 Migration Rule

If current Inventory already supports:

- quantity;
- threshold/equivalent;
- 1:1 Product relation;

then prefer:

```text
NO NEW MIGRATION
```

If `lowStockThreshold` or an essential integrity rule is missing:

- add the smallest safe migration;
- backfill existing rows safely;
- preserve existing data;
- verify rollback implications;
- update DB docs.

Never use:

```text
prisma db push
```

as a migration substitute.

## 6.3 Non-Negative Data Integrity

At minimum, backend service validation MUST prevent negative stock.

If current project migration/database standards support DB-level CHECK constraints safely, prefer physical constraints for:

```text
quantity >= 0
lowStockThreshold >= 0
```

If no physical CHECK is used:

- document why;
- service-level enforcement + tests are mandatory;
- later 05.3/Checkout must use the same safe Inventory service.

## 6.4 Existing Bad Data

Before assuming all rows are valid, inspect DEV/current fixtures for:

- missing Inventory rows;
- negative quantities;
- null quantities if possible;
- duplicate Inventory rows;
- threshold anomalies.

Do not silently "fix" production data.

DEV-only cleanup is allowed only through approved migration/seed/testing workflow.

---

# 7. Inventory Core Service

Business rules belong in the backend service/domain layer.

Controller/routes remain thin.

The Inventory core must provide semantically equivalent behavior for:

```text
getInventorySnapshot(productId)
deriveStockStatus(quantity, threshold)
validateRequestedQuantity(productId, requestedQuantity)
setStock(...)
increaseStock(...)
decreaseStock(...)
```

Exact names follow current architecture.

## 7.1 Snapshot

A bounded Inventory snapshot should provide enough information for services to decide:

- Product ID;
- available quantity;
- low-stock threshold internally;
- derived status;
- updated timestamp where useful.

Do not expose unnecessary internal relations.

## 7.2 Validation

Centralize stock validation.

Do not duplicate rules in:

- Product service;
- Cart service;
- Wishlist service;
- Checkout later.

Use one source of truth.

## 7.3 Safe Set

Conceptually:

```text
setStock(productId, 12)
→ quantity = 12
```

Reject invalid integer/negative input.

## 7.4 Safe Increase

Conceptually:

```text
quantity = 5
increase by 3
→ 8
```

Reject negative/invalid delta.

## 7.5 Safe Decrease

Conceptually:

```text
quantity = 5
decrease by 3
→ 2
```

Never allow:

```text
5 - 6
→ -1
```

The operation must fail safely instead.

When/if used by Checkout later, decrement must support atomic/transaction-safe semantics.

03.4 should establish a safe primitive rather than a naive:

```text
read quantity
→ subtract in application
→ write
```

when concurrent mutation would make it unsafe.

Do NOT reserve or decrement stock from Cart Add.

---

# 8. Concurrency Rules

Inventory is shared mutable state.

Even though 03.4 customer Cart does not purchase stock, the core must not establish unsafe primitives that later Checkout reuses.

Required invariant:

```text
Inventory quantity must never become negative.
```

Future purchase example:

```text
stock = 1

Customer A purchases 1
Customer B purchases 1
```

must never become:

```text
stock = -1
```

For any decrement primitive implemented now:

- use current transaction/conditional-update conventions;
- prove failure when requested decrement exceeds current stock;
- handle concurrency conflict safely;
- return a normalized domain error.

Do not overbuild full Checkout locking/reservation in 03.4.

---

# 9. Public Inventory DTO Contract

Exact DTO shape follows current API conventions.

The frontend needs semantically equivalent public information:

```ts
type InventoryAvailability = {
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  availableQuantity: number;
  purchasable: boolean;
};
```

Do not force this exact TypeScript shape if the repo already has an approved equivalent.

The semantic contract is mandatory.

## 9.1 Public Fields

Customer-facing Product data must expose enough for:

- badge;
- low-stock copy;
- quantity max;
- Add-to-Cart state;
- Cart validation;
- Wishlist presentation.

## 9.2 Threshold Exposure

The frontend normally does NOT need the raw threshold.

Prefer exposing:

- derived `status`;
- `availableQuantity`;
- `purchasable`.

Do not expose internal configuration merely because it exists.

## 9.3 Product Status

Keep Product activation separate.

A Product response may also include current approved Product status/active field.

Do not map inactive Product to `OUT_OF_STOCK` merely for convenience.

---

# 10. Product Summary / Catalog Availability

All Product summary endpoints used by customer ProductCards must include current inventory availability without N+1 requests.

Affected surfaces may include:

- Home Product sections;
- `/products`;
- Search results;
- category results;
- related Products;
- Wishlist ProductCards where current architecture hydrates Product summary.

Rule:

```text
one Product list request
→ enough Product + Inventory data
→ no per-card /inventory request
```

Do not create:

```text
20 Product cards
→ 20 Inventory HTTP calls
```

---

# 11. Product Details Availability

Product Details must receive current Inventory state through the approved Product detail query.

Required customer states:

## 11.1 In Stock

```text
StatusBadge: In Stock
quantity selector enabled
Add to Cart enabled
max quantity = current availableQuantity
```

## 11.2 Low Stock

```text
StatusBadge: Low Stock
customer copy: Only N left
quantity selector enabled
Add to Cart enabled
max quantity = N
```

## 11.3 Out of Stock

```text
StatusBadge: Out of Stock
quantity purchase controls disabled
Add to Cart disabled
Wishlist remains available
Product remains viewable
```

## 11.4 Inactive Product

Do not treat as merely Out of Stock.

Use current Product unavailable/inactive behavior.

No purchase action.

---

# 12. Existing `StatusBadge` Is Mandatory

TASK 03.4 MUST reuse the existing shared `StatusBadge`.

Do NOT create:

- `InventoryBadge`;
- `StockBadge`;
- `AvailabilityBadge`;
- a new badge primitive.

Before editing:

1. inspect existing `StatusBadge`;
2. inspect its Storybook stories;
3. inspect current variants/tokens;
4. inspect current consumers;
5. determine whether existing semantic variants already support the required states.

Conceptually:

```text
StatusBadge
├── In Stock
├── Low Stock
└── Out of Stock
```

If a semantic variant is missing:

- extend the existing component minimally;
- preserve existing API compatibility;
- preserve existing consumers;
- update Storybook;
- add regression tests.

## 12.1 Required Labels

Customer labels:

```text
IN_STOCK
→ In Stock

LOW_STOCK
→ Low Stock

OUT_OF_STOCK
→ Out of Stock
```

Low-stock urgency copy:

```text
Only N left
```

should be separate supporting copy where the design supports it.

Do not overload the badge with long dynamic text if that harms reuse.

---

# 13. ProductCard Inventory UX

Reuse the existing ProductCard.

Do not fork it.

ProductCard must preserve current:

- image;
- hover image behavior if present;
- category;
- Product name;
- rating/review row;
- description where approved;
- price/discount;
- Wishlist heart;
- navigation;
- Add to Cart;
- responsive geometry.

03.4 adds/refines current availability behavior.

## 13.1 In Stock Card

Required:

- existing `StatusBadge` with `In Stock`;
- Add to Cart enabled;
- normal interaction.

## 13.2 Low Stock Card

Required:

- existing `StatusBadge` with `Low Stock`;
- optional compact `Only N left` copy where layout supports it;
- Add to Cart enabled;
- no exaggerated alarm treatment.

## 13.3 Out of Stock Card

Required:

- `Out of Stock` StatusBadge;
- Add to Cart disabled;
- Product navigation remains enabled;
- Wishlist heart remains usable;
- card remains visible.

Do NOT:

- hide the Product solely because quantity is `0`;
- disable navigation;
- remove Wishlist interaction.

## 13.4 Action Isolation

Inventory changes must not break:

```text
heart click
→ Wishlist only

Add to Cart
→ Cart only

card/image/name
→ Product Details navigation
```

---

# 14. Product Details Quantity Interaction

## 14.1 Minimum

Quantity minimum for purchasable Product:

```text
1
```

## 14.2 Maximum

Quantity maximum:

```text
availableQuantity
```

Example:

```text
stock = 3

1 → allowed
2 → allowed
3 → allowed
4 → blocked
```

## 14.3 Low Stock

For stock `3`:

```text
Low Stock
Only 3 left
```

Quantity selector must stop at `3`.

## 14.4 Stock Shrink During Viewing

If background refresh changes:

```text
stock 5
selected 4
→ stock becomes 3
```

Product Details must not submit stale invalid quantity.

Preferred safe behavior:

- clamp ephemeral selected quantity to the new maximum;
- communicate updated availability through the status/copy;
- do not show a full-page loading skeleton;
- do not reset unrelated Product Details state such as selected gallery image.

If stock becomes `0`:

- purchase quantity controls become disabled/non-submittable;
- Add to Cart disabled;
- Wishlist remains usable.

---

# 15. Shopping Cart Inventory Rules

03.4 extends 03.2 Cart availability validation.

Do NOT rewrite Cart.

## 15.1 Cart Does Not Reserve Stock

Still mandatory:

```text
Add to Cart
≠ stock reservation
≠ stock decrement
```

Example:

```text
stock = 5

Customer A Cart = 3
Customer B Cart = 4
```

This is allowed at Cart stage.

Final purchase validation belongs to Checkout/Order.

## 15.2 New Add

Authenticated Cart backend must reject requested quantity above current stock.

Conceptual:

```text
stock = 3
Add 4
→ reject
```

For guest Cart:

- UI uses current authoritative Product availability;
- guest storage cannot become server authority;
- guest Cart hydration/reconciliation revalidates against backend;
- tampered guest quantity must not become valid merely because localStorage says so.

## 15.3 Quantity Increase

```text
stock = 3
Cart qty = 2
increase to 3
→ allowed

increase to 4
→ blocked
```

Authenticated server must enforce.

Frontend should disable/block obvious invalid increment.

## 15.4 Existing Cart Quantity Becomes Greater Than Stock

Example:

```text
Cart qty = 5
stock later becomes 3
```

Do NOT silently clamp or delete the Cart line.

Preserve customer intent:

```text
requested = 5
available = 3
```

Show a clear inline validation state, e.g.:

```text
Only 3 available. Reduce quantity to continue.
```

Required:

- Product remains visible;
- line remains removable;
- decrement remains available;
- increment disabled;
- current Checkout intent remains blocked according to current Cart contract;
- no stock decrement occurs.

## 15.5 Existing Cart Product Becomes Out of Stock

```text
stock → 0
```

Required:

- Cart line remains visible;
- `Out of Stock` StatusBadge;
- clear inline message;
- increment disabled;
- user can decrement/remove where meaningful;
- user can remove;
- Checkout intent blocked;
- no silent deletion.

---

# 16. Wishlist Inventory Rules

03.4 extends 03.3 Wishlist presentation only.

Do NOT rewrite Wishlist membership/reconciliation.

## 16.1 In Stock

Wishlisted Product:

- remains saved;
- ProductCard shows `In Stock`;
- Add to Cart available.

## 16.2 Low Stock

Wishlisted Product:

- remains saved;
- `Low Stock`;
- `Only N left` where current ProductCard layout supports it;
- Add to Cart available while quantity >0.

## 16.3 Out of Stock

Wishlisted Product:

- remains saved;
- `Out of Stock`;
- Add to Cart disabled;
- heart/remove remains usable;
- Product navigation remains usable.

Critical:

```text
Inventory change must NEVER delete Wishlist membership.
```

---

# 17. Availability Revalidation

Inventory changes over time.

The frontend must not assume the stock value loaded yesterday remains true.

Use current React Query architecture.

Required:

- current server DTO on navigation/refetch;
- background revalidation using existing query policy;
- mutations return current availability where relevant;
- Cart read revalidates current inventory;
- Wishlist/Product summaries use current authoritative availability.

Do NOT add aggressive polling unless current architecture explicitly requires it.

Avoid excessive requests.

---

# 18. Background Refresh UX

When usable Product/Cart/Wishlist content exists:

```text
background refetch
→ KEEP content visible
```

Do not replace usable UI with full skeletons.

If Inventory changes during background refresh:

- update `StatusBadge`;
- update low-stock message;
- update quantity boundaries;
- update purchase controls;
- preserve unrelated local UI state.

Do not cause:

- false Empty state;
- full-page flicker;
- gallery reset;
- Wishlist membership flicker;
- Cart row disappearance.

---

# 19. Loading State UX

03.4 must not introduce new arbitrary loaders.

Reuse existing:

- ProductCard skeleton;
- Product Details skeleton;
- Cart skeleton;
- Wishlist skeleton;
- current page loading patterns.

If adding availability changes geometry:

- skeleton should account for the availability row;
- avoid layout jump when badge appears.

Loading is NOT permission to display false inventory state.

Do NOT show:

```text
Out of Stock
```

merely because Inventory data has not resolved.

Unresolved ≠ Out of Stock.

---

# 20. Error State UX

Distinguish:

```text
Inventory unresolved
Inventory API error
Product inactive
Inventory missing
Out of Stock
Insufficient Stock
```

Do not collapse them.

Examples:

```text
OUT_OF_STOCK
→ normal business state

INSUFFICIENT_STOCK
→ validation conflict

INVENTORY_NOT_FOUND / malformed server state
→ error/unavailable condition
```

If usable stale content exists during background error:

- keep it visible where safe;
- show non-blocking retry/feedback;
- do not falsely mark Product Out of Stock unless authoritative state says so.

---

# 21. Missing Inventory Row

Repository truth may contain Product rows without Inventory.

Do not silently interpret missing row as high stock.

Safe behavior:

```text
missing Inventory
→ not safely purchasable
```

Exact customer presentation should follow current unavailable/error patterns.

Do not invent quantity.

Backend should produce a normalized safe state/error.

---

# 22. Backend Purchase Restrictions

Server-side enforcement is mandatory.

For authenticated Cart Add/Update:

Validate:

```text
requested quantity is integer
requested quantity >= 1
Product exists
Product is active/sellable
Inventory exists
Inventory quantity > 0
requested quantity <= available quantity
```

Frontend checks are UX only.

Never rely solely on disabled buttons.

---

# 23. Error Codes / HTTP Semantics

Follow current project error envelope.

Use semantically equivalent normalized domain errors such as:

```text
INVALID_QUANTITY
PRODUCT_NOT_FOUND
PRODUCT_UNAVAILABLE
INVENTORY_NOT_FOUND
OUT_OF_STOCK
INSUFFICIENT_STOCK
```

Do not expose:

- Prisma exceptions;
- SQL;
- stack traces;
- raw constraint names.

Suggested semantics if current project standards do not already define them:

```text
400
→ malformed/invalid quantity

404
→ Product not found

409
→ Out of stock / insufficient current stock
```

Do not change existing API error conventions merely to match this suggestion.

---

# 24. Product List Query Performance

Inventory data for ProductCard must be included efficiently.

Backend query requirements:

- avoid N+1 Inventory queries;
- include/select Inventory with Product summaries;
- keep payload bounded;
- do not load unrelated relations;
- do not load full Reviews for each Product;
- reuse existing grouped Review aggregates.

Frontend requirements:

- no per-card Inventory `fetch`;
- no duplicate Product query just for availability;
- no broad invalidation after Cart/Wishlist action.

---

# 25. Cart Query Performance

Cart response should contain current Inventory validation in the existing bounded Cart DTO.

Avoid:

```text
GET Cart
→ N Cart items
→ N Product calls
→ N Inventory calls
```

Use backend joins/includes/bulk validation consistent with current architecture.

---

# 26. Wishlist Query Performance

Wishlist inventory presentation must reuse current Product summary hydration.

Do not add:

```text
one Inventory request per wishlisted Product
```

---

# 27. Stock Update Core and Admin Authorization

Customer UI must never mutate Inventory.

If existing backend Admin/Product route can change stock:

- ADMIN authorization remains server-side;
- route must use Inventory core;
- reject CUSTOMER;
- reject anonymous;
- validate integer/non-negative quantity.

Do NOT expose an unauthenticated/customer stock-update endpoint.

If no current Admin route exists:

- do not build Admin UI;
- keep safe service primitives ready for 05.3;
- document route exposure as 05.3 work.

---

# 28. Low-Stock Core Capability

03.4 must make low stock queryable/derivable consistently.

At minimum:

```text
LOW_STOCK
→ quantity > 0
AND quantity <= threshold
```

05.3 must later be able to reuse this rule for:

- low-stock list;
- filter;
- warning badge;
- dashboard count.

Do NOT create a separate Admin-specific low-stock definition later.

This task file is the semantic authority for 05.3 unless a later approved architecture decision supersedes it.

---

# 29. No Inventory Reservation in Cart

This rule is critical.

03.4 MUST NOT change:

```text
Cart Add
→ reserve stock
```

into production behavior.

No:

- reservation row;
- reservedQuantity field;
- hold expiration;
- per-user stock hold;
- Cart-triggered decrement.

Reservation/purchase transaction belongs to later Checkout/Order architecture.

---

# 30. Checkout Handoff Contract

03.5 Checkout must be able to rely on the 03.4 core for:

- current stock snapshot;
- requested quantity validation;
- Product purchasability;
- safe stock-decrement primitive if already established;
- normalized insufficient-stock error.

03.4 must not implement Checkout, but it must avoid architecture that makes safe Checkout impossible.

---

# 31. 05.3 Admin Handoff Contract

TASK 05.3 MUST begin by reading this file.

05.3 should reuse:

```text
Inventory model
lowStockThreshold
deriveStockStatus
Inventory service
set/increase/decrease stock primitives
non-negative guarantees
Inventory DTO/domain types
StatusBadge
Storybook inventory fixtures
status labels
error codes
database constraints
```

05.3 may add:

- Admin Inventory route/page;
- Inventory table;
- quantity editor;
- restock interaction;
- low-stock filter;
- out-of-stock filter;
- low-stock alerts panel;
- dashboard inventory metrics;
- Admin-specific permissions/UI.

05.3 must NOT redefine:

```text
IN_STOCK
LOW_STOCK
OUT_OF_STOCK
```

---

# 32. Mandatory Repository-First Workflow

Before implementation:

1. Read root `AGENTS.md`.
2. Confirm branch and HEAD.
3. Work on `feature/Inventory`.
4. Synchronize safely according to repository Git workflow.
5. Read this task file completely.
6. Inspect current `docs/`.
7. Identify only relevant docs.
8. Read them.
9. Inspect current:
   - Product model;
   - Inventory model;
   - Cart/CartItem;
   - Wishlist;
   - Product API;
   - Product summary/detail DTOs;
   - ProductCard;
   - Product Details;
   - Cart page/components;
   - Wishlist page/components;
   - existing `StatusBadge`;
   - API client;
   - QueryClient/query keys;
   - Auth;
   - tests;
   - Storybook;
   - supplied Figma Make screenshots.
10. Compare Make screenshots against project requirements.
11. Produce an approved-vs-refinement-vs-future matrix.
12. Define Inventory domain/state invariants.
13. Define DB decision.
14. Define affected API contracts.
15. Define exact related-file manifest.
16. Enter bounded Plan Mode.
17. Implement only 03.4.
18. Run automated tests.
19. Run Storybook.
20. Run Playwright.
21. Run real browser adversarial QA.
22. Capture screenshots.
23. OPEN and inspect screenshots.
24. Fix task-scoped defects.
25. Run changed-file full review.
26. Update docs.
27. Produce final implementation report.
28. Stop before commit/push/merge.

---

# 33. Task-Specific Documentation Discovery

Do NOT blindly read every document.

Likely relevant:

## Project Foundation

- Roadmap
- Project structure
- Tech stack
- Dependencies
- Decisions
- Glossary

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

- Products;
- Inventory;
- Cart;
- Wishlist;
- Authentication;
- Search where ProductCard is reused.

## Database

- Prisma schema;
- tables;
- relationships;
- indexing;
- migrations;
- seeding.

## Quality

- Testing;
- unit;
- integration;
- E2E;
- accessibility;
- performance;
- Storybook;
- Definition of Done.

## Workflow

- Git;
- branching;
- code review.

Do not spend task time reading Stripe, Orders, Delivery, AI, PDFs, Email, Cloudinary, or analytics unless a direct dependency is discovered.

---

# 34. Source / Authority Hierarchy

When sources appear to conflict:

```text
1. ROADMAP.md
   → owns phase/task boundaries

2. TASK_03.4_CUSTOMER_INVENTORY.md
   → exact 03.4 behavior and acceptance criteria

3. Current repository schema/API/domain/code
   → current implementation truth

4. Supplied Figma Make screenshots
   → approved visual starting evidence

5. Current ElectroHub design system
   → tokens/components/motion/responsive rules

6. Current approved 03.1/03.2/03.3 implementation
   → ProductCard/Product Details/Cart/Wishlist integration truth

7. Storybook foundation
   → isolated component/state verification
```

No live Figma Design link is required for this task.

Do not invent hidden Figma behavior.

---

# 35. Mandatory Figma Make Screenshot Inspection

Before coding, inspect every provided Make screenshot relevant to 03.4.

This is mandatory.

The goal is NOT to copy pixels blindly.

The goal is to understand:

- approved hierarchy;
- current component placement;
- current ProductCard composition;
- Product Details availability/action region;
- Cart line composition;
- Wishlist card composition;
- current Header/Footer;
- current responsive intent where screenshots exist;
- what the screenshot already approves;
- what 03.4 is allowed to refine;
- what belongs to future Admin/Checkout work.

The agent must explicitly classify screenshot elements as:

```text
APPROVED / REUSE
CONTROLLED REFINEMENT ALLOWED
NEW 03.4 STATE REQUIRED
FUTURE SCOPE — DO NOT IMPLEMENT
STALE SHELL — CURRENT APP WINS
PROTOTYPE CONTROL — NEVER IMPLEMENT
```

---

# 36. Required Figma Make Screenshot Set

No Figma Design URL is required.

Use the actual supplied filenames.

Expected relevant screenshot categories:

## 36.1 Product Card / Catalog

Use supplied/current Make screenshots such as:

```text
Product Card.png
Products page.png
Home page.png
Search page.png
```

when available.

Reference for:

- existing ProductCard hierarchy;
- location available for `StatusBadge`;
- Add to Cart;
- Wishlist heart;
- rating/reviews;
- price;
- card height/grid balance.

Do NOT redesign ProductCard.

## 36.2 Product Details

Use the supplied Product Details Make screenshot, for example:

```text
product details page.png
```

Reference for:

- availability region;
- price;
- rating;
- quantity selector;
- Add to Cart;
- Wishlist;
- image/gallery hierarchy;
- action spacing.

03.4 may add/refine inventory states while preserving this hierarchy.

## 36.3 Cart

Use supplied:

```text
Cart page.png
```

Reference for:

- cart-line hierarchy;
- Product metadata;
- quantity control;
- remove action;
- summary;
- layout.

03.4 may add stock status and inline stock validation without redesigning Cart.

## 36.4 Wishlist

Use supplied:

```text
Wishlist page.png
```

Reference for:

- Wishlist page hierarchy;
- ProductCard reuse;
- Add to Cart;
- heart/remove;
- spacing/grid.

03.4 may add availability state through the existing ProductCard/StatusBadge.

## 36.5 Filename Rule

If supplied filenames differ in spaces/case/suffix:

- use actual filenames;
- do not rename them just to match this task;
- document discrepancy.

## 36.6 Record Actual Dimensions

During inspection record:

```text
filename
width
height
route/component represented
```

Do not invent dimensions.

---

# 37. No Dedicated Customer Inventory Page

03.4 does NOT require:

```text
/inventory
```

for customers.

Inventory is a cross-surface commerce capability.

Customer-visible states belong inside existing:

- ProductCard;
- Product Details;
- Cart;
- Wishlist.

Do not invent an Inventory customer dashboard.

---

# 38. Figma Refinement Rule

The Make screenshots are the approved **starting visual reference**, not an immutable pixel prison.

Start from them.

Preserve:

- information architecture;
- hierarchy;
- composition;
- current ElectroHub identity;
- current approved app shell;
- existing component patterns.

Controlled refinement is allowed for:

- `StatusBadge` integration;
- low-stock copy;
- out-of-stock disabled states;
- insufficient-stock inline warnings;
- loading geometry;
- error feedback;
- background refresh stability;
- accessibility;
- touch targets;
- responsive wrapping;
- long content;
- card-height consistency;
- advanced but subtle interactions;
- state transitions not shown in static Make screenshots.

The task explicitly allows:

- polished layouts;
- additional required states;
- more complete responsive behavior;
- advanced UX interactions;
- production-quality missing states.

Refinement is NOT permission to:

- randomly redesign;
- change the brand;
- add a new design system;
- replace current Header/Footer;
- build Admin UI;
- build Checkout;
- add unrelated animations.

Use this test:

> Does the result still clearly look like the approved ElectroHub screen, but with complete Inventory behavior and more polished production states?

If yes, it is allowed.

---

# 39. Approved vs Allowed vs Future Matrix

Before coding, produce a matrix like:

| Element | Classification | Action |
|---|---|---|
| Existing ProductCard | Approved/reuse | Extend only |
| Existing StatusBadge | Approved/reuse | MUST reuse |
| Product Details quantity | Approved/reuse | Add stock max |
| Add to Cart | Approved/reuse | Disable/restrict based on stock |
| Wishlist heart | Approved/reuse | Preserve |
| Cart quantity | Approved/reuse | Apply inventory validation |
| Low Stock state | New 03.4 state | Implement/refine |
| Out of Stock state | New 03.4 state | Implement/refine |
| Insufficient Cart stock | New 03.4 state | Implement/refine |
| Admin restock controls | Future 05.3 | Do not implement |
| Checkout stock commit | Future 03.5/03.7 | Do not implement |
| Prototype overlays | Not product UI | Never implement |

Final report must include the actual matrix.

---

# 40. Visual Quality Target

Customer Inventory UI target:

# **Clean → premium → interactive → modern electronics commerce**

This means:

- clear availability;
- compact semantic badges;
- useful urgency without alarmism;
- stable card geometry;
- polished disabled states;
- immediate input feedback;
- clear validation;
- subtle motion;
- predictable focus;
- no visual clutter;
- no giant warnings;
- no random colors;
- no excessive animation.

Inventory state must feel integrated into the design, not bolted on.

---

# 41. ProductCard Visual States

Required Storybook + browser states:

```text
In Stock
Low Stock
Out of Stock
Long Product name + In Stock
Long Product name + Low Stock
Zero reviews + Out of Stock
Discounted + Low Stock
Wishlist active + Out of Stock
```

Verify:

- card height;
- badge placement;
- Add-to-Cart layout;
- rating row;
- price;
- heart;
- responsive wrapping.

---

# 42. Product Details Visual States

Required:

```text
In Stock
Low Stock
Out of Stock
Stock shrinks below selected quantity
Stock changes to 0
Background refresh
Inventory error with usable Product data
Product inactive
```

Verify:

- badge;
- `Only N left`;
- quantity control;
- Add to Cart;
- Wishlist;
- gallery stability;
- no layout jump.

---

# 43. Cart Visual States

Required:

```text
all valid
low-stock line
requested quantity equals stock
requested quantity exceeds stock
out-of-stock line
mixed valid + invalid
background inventory refresh
stock error while Cart data remains usable
```

No silent line deletion.

---

# 44. Wishlist Visual States

Required:

```text
In Stock saved Product
Low Stock saved Product
Out of Stock saved Product
mixed Wishlist inventory states
background availability refresh
```

Out-of-stock Product remains saved/removable.

---

# 45. Advanced UX Interaction Rules

03.4 should include polished interaction where meaningful.

## 45.1 Quantity Boundaries

At max stock:

- increment disabled;
- no network mutation sent for impossible increment;
- accessible reason via state/message where needed.

## 45.2 Out-of-Stock Add

Button disabled.

Do not fire mutation.

## 45.3 Low-Stock Feedback

Do not use modal/toast for every low-stock Product.

Prefer compact inline status.

## 45.4 Stock Change During Interaction

If server state changes while user is interacting:

- reconcile controls safely;
- update message;
- preserve unrelated UI state;
- do not flash full-page skeleton.

## 45.5 Cart Conflict

If Cart quantity is now too high:

- keep line;
- show exact available amount;
- keep remove available;
- allow decrement;
- block invalid increase/Checkout intent.

---

# 46. Motion

Use existing motion system.

Allowed:

- subtle badge/status transition;
- small opacity/transform feedback;
- quantity-control state transition;
- inline validation reveal.

Avoid:

- bouncing stock alerts;
- long animated warnings;
- shaking buttons;
- animation that blocks interaction.

Respect:

```text
prefers-reduced-motion
```

---

# 47. Accessibility

At minimum verify:

- `StatusBadge` meaning is readable as text;
- state is not conveyed by color only;
- disabled Add-to-Cart is semantically disabled;
- quantity controls keyboard accessible;
- increment/decrement accessible labels;
- low-stock message readable by assistive tech;
- Cart invalid-stock message associated with affected line;
- focus remains logical after validation;
- Wishlist heart remains accessible;
- ProductCard interactive nesting remains valid;
- focus-visible not clipped;
- reduced motion.

Do not use tooltip-only communication for critical stock state.

---

# 48. Responsive Requirements

Mandatory real verification:

```text
390
768
1440
1920
```

Do not treat "no horizontal overflow" as sufficient.

Inspect actual composition.

## 48.1 390

Verify:

- ProductCard badge;
- long Product name;
- price + badge;
- Add to Cart;
- low-stock copy;
- Product Details action stack;
- quantity controls;
- Cart line status/warning;
- Wishlist card;
- touch targets.

## 48.2 768

Verify:

- tablet Product grid;
- Product Details layout transformation;
- Cart line composition;
- mixed status states.

## 48.3 1440

Verify:

- desktop density;
- badge/card hierarchy;
- Cart row;
- Product Details action hierarchy.

## 48.4 1920

Verify:

- large desktop widths;
- card density;
- no oversized whitespace;
- no stretched badges;
- no unstable row widths.

---

# 49. Loading / Skeleton Quality Gate

Inventory UI must participate in existing structural skeletons.

Do not add isolated random badge skeletons that break geometry.

Where the availability row is visible in loaded layout:

- skeleton should reserve similar space;
- loaded badge must not cause avoidable vertical jump.

When real content exists during background refresh:

```text
KEEP REAL CONTENT
```

Do not replace ProductCard/Cart/Wishlist with full skeletons merely because Inventory refetches.

---

# 50. Real-Browser First-Pass Quality Gate

Automated tests are NOT sufficient.

Before handoff, inspect the actual app.

Mandatory even when:

- unit tests pass;
- Storybook passes;
- Playwright passes;
- typecheck/lint/build pass.

For every affected route inspect:

- first navigation;
- hard refresh;
- initial loading;
- loaded state;
- low stock;
- out of stock;
- stock shrink;
- background refetch;
- Cart invalid quantity;
- Wishlist out-of-stock preservation;
- responsive behavior;
- keyboard;
- reduced motion.

The user must not become the first person to notice an obvious UI defect.

---

# 51. Slow-State Verification

Artificially delay relevant Product/Cart requests in test tooling where practical.

Verify:

- unresolved is not shown as Out of Stock;
- badges do not flicker false status;
- Cart line does not disappear;
- Wishlist item does not disappear;
- content does not flash Empty;
- Product Details selection does not reset unnecessarily;
- background refetch keeps content.

Do not add production delays.

---

# 52. Screenshot Capture and Inspection

For UI-heavy implementation, capture final evidence.

At minimum capture representative states at:

```text
390
768
1440
1920
```

Do not merely create files.

OPEN and inspect screenshots.

For each inspect:

- badge placement;
- spacing;
- card height;
- text wrap;
- low-stock copy;
- disabled Add-to-Cart;
- Cart invalid-stock warning;
- Wishlist out-of-stock state;
- Product Details quantity;
- whitespace;
- alignment;
- responsive composition.

If visually wrong:

```text
FIX BEFORE HANDOFF
```

---

# 53. Required Implementation Screenshot Evidence

Generate final implementation screenshots for:

## Customer ProductCard

1. In Stock
2. Low Stock
3. Out of Stock

## Product Details

4. Low Stock
5. Out of Stock

## Cart

6. Mixed valid + low stock
7. Insufficient stock
8. Out-of-stock Cart line

## Wishlist

9. Mixed stock states / Out-of-stock saved Product

Capture at the smallest meaningful set of viewports while still proving:

- mobile;
- tablet;
- desktop;
- large desktop.

Do not create redundant screenshots.

---

# 54. Storybook — Mandatory

Storybook is required for applicable 03.4 UI.

It must use actual production components.

No default live API calls.

Use deterministic fixtures.

## 54.1 `StatusBadge`

Update existing stories if needed:

- In Stock
- Low Stock
- Out of Stock
- reduced motion if component uses motion
- focus/semantic verification if interactive wrapper exists

Do not create a second badge story/component.

## 54.2 ProductCard

Required states:

- In Stock
- Low Stock
- Out of Stock
- long title
- zero reviews
- Wishlist selected + Out of Stock
- disabled Add to Cart

## 54.3 Product Details

Story/component state coverage as current Storybook architecture permits:

- In Stock
- Low Stock
- Out of Stock
- selected quantity at max
- stock shrink
- disabled purchase state

## 54.4 Cart

- valid line
- low stock
- exact max
- insufficient stock
- out of stock
- mixed Cart

## 54.5 Wishlist

Use actual ProductCard/Wishlist wrapper:

- In Stock
- Low Stock
- Out of Stock
- mixed state

## 54.6 Responsive Storybook

Verify meaningful stories at:

```text
390
768
1440
1920
```

## 54.7 Accessibility

Run current Storybook a11y tooling.

Do not treat a11y addon green as complete keyboard verification.

---

# 55. Storybook Production Isolation

Storybook remains dev-only.

03.4 must not:

- import Storybook into production entry;
- expose Storybook through customer routes;
- ship Storybook static output with customer bundle;
- depend on Storybook-only fixtures at runtime.

---

# 56. Backend Unit Tests

Required where applicable.

## 56.1 Status Derivation

Test:

```text
threshold = 5

quantity 6 → IN_STOCK
quantity 5 → LOW_STOCK
quantity 1 → LOW_STOCK
quantity 0 → OUT_OF_STOCK
```

Also test:

- threshold `0`;
- invalid negative values rejected by service;
- very large safe integer boundary if relevant.

## 56.2 Requested Quantity

Test:

```text
stock 3 / requested 1 → allowed
stock 3 / requested 3 → allowed
stock 3 / requested 4 → rejected
stock 0 / requested 1 → OUT_OF_STOCK
requested 0 → INVALID_QUANTITY
requested -1 → INVALID_QUANTITY
requested 1.5 → INVALID_QUANTITY
```

## 56.3 Product State

Test:

```text
inactive Product + stock >0
→ not purchasable
```

## 56.4 Missing Inventory

Test safe failure.

## 56.5 Stock Update Primitives

If implemented now:

- set valid;
- set negative rejected;
- increase;
- decrease;
- decrease below zero rejected;
- concurrency/conditional behavior where supported.

---

# 57. Backend Integration / API Tests

Required for affected routes/services.

Test:

- Product list returns inventory availability;
- Product Details returns availability;
- no private fields;
- authenticated Cart Add within stock;
- authenticated Cart Add above stock rejected;
- Cart quantity update within stock;
- Cart quantity update above stock rejected;
- out-of-stock Add rejected;
- inactive Product Add rejected;
- Cart read returns stock conflict state if stock dropped;
- Wishlist/Product summary still returns out-of-stock Product;
- customer cannot mutate Inventory;
- anonymous cannot call protected inventory update route if one exists;
- CUSTOMER cannot call ADMIN stock update if one exists.

---

# 58. Frontend Unit / Component Tests

Required.

## 58.1 StatusBadge Integration

Verify correct label for:

- In Stock;
- Low Stock;
- Out of Stock.

## 58.2 ProductCard

Verify:

- In Stock → Add enabled;
- Low Stock → Add enabled;
- Out of Stock → Add disabled;
- heart still works;
- heart does not navigate;
- card navigation still works.

## 58.3 Product Details

Verify:

- max quantity = stock;
- increment disabled at max;
- low-stock copy;
- out-of-stock disables purchase;
- stock shrink clamps ephemeral selected quantity safely;
- gallery state unaffected.

## 58.4 Cart

Verify:

- valid;
- exact max;
- over max warning;
- out-of-stock line remains;
- remove remains;
- no silent clamp/delete;
- invalid increment blocked.

## 58.5 Wishlist

Verify:

- out-of-stock Product remains rendered;
- Add to Cart disabled;
- heart/remove remains.

---

# 59. React Query / Cache Tests

Where Inventory data flows through existing queries, verify:

- Product list cache includes current availability;
- Product Details cache updates safely;
- Cart mutation response is not overwritten by stale read;
- background refetch keeps usable content;
- availability change updates affected controls;
- no broad unrelated invalidation;
- no new QueryClient.

Do not create an Inventory global store solely to broadcast status.

---

# 60. Guest Cart Tests

Guest Cart is local intent and must not become Inventory authority.

Test:

```text
guest Product stock 3
→ add qty 3 allowed

tamper localStorage qty 99
→ hydration/revalidation marks invalid
→ does not treat 99 as purchasable

stock becomes 0
→ existing guest Cart line remains
→ Out of Stock
```

Guest-to-auth reconciliation must revalidate current stock.

Do not delete invalid guest line silently.

---

# 61. Authenticated Cart Tests

Test server authority.

Required:

- requested quantity above stock rejected;
- exact stock allowed;
- duplicate Add respects resulting quantity vs stock;
- existing line becomes insufficient after inventory change;
- no stock reservation;
- no inventory decrement from Add/Update/Remove Cart.

---

# 62. Inventory Side-Effect Tests

Critical:

Cart/Wishlist operations must NOT mutate Inventory quantity.

Prove:

```text
Inventory before Add to Cart = N
Inventory after Add to Cart = N

Inventory before Wishlist Add = N
Inventory after Wishlist Add = N
```

Also:

```text
remove Cart
remove Wishlist
→ no Inventory mutation
```

---

# 63. Playwright / Browser E2E Matrix

Create focused 03.4 scenarios.

## A — ProductCard In Stock
Open Product grid → `In Stock` → Add enabled.

## B — ProductCard Low Stock
`Low Stock` → status visible → Add enabled.

## C — ProductCard Out of Stock
`Out of Stock` → Add disabled → navigation + Wishlist still work.

## D — Product Details In Stock
Quantity selector enabled; max respects availability.

## E — Product Details Low Stock
`Only N left`; increment stops at N.

## F — Product Details Out of Stock
Add disabled; Wishlist remains usable.

## G — Cart Exact Stock
Stock 3; Cart 2 → increment to 3 allowed.

## H — Cart Above Stock
Stock 3; attempt 4 → blocked/rejected with clear feedback.

## I — Existing Cart Stock Shrink
Cart 5; Inventory 3 → line remains, warning, decrement/remove work.

## J — Existing Cart Out of Stock
Inventory 0 → line remains, `Out of Stock`, no silent deletion.

## K — Wishlist Out of Stock
Saved Product → Inventory 0 → remains saved, OOS, remove works.

## L — Guest Cart Tamper/Revalidation
Stored quantity > stock does not become valid purchase state.

## M — Auth Server Restriction
API rejects over-stock quantity.

## N — Background Availability Refresh
Usable Product page remains visible; badge/control updates without full skeleton.

## O — Product Active vs Stock
Inactive Product is not mislabeled as merely Out of Stock.

## P — No Inventory Mutation From Cart
Add/change/remove Cart does not decrement stock.

## Q — No Inventory Mutation From Wishlist
Add/remove Wishlist does not mutate stock.

## R — Responsive
Verify 390 / 768 / 1440 / 1920.

## S — Keyboard
Verify Product Details quantity, Cart controls, ProductCard actions.

## T — Reduced Motion
Inventory UI remains usable.

## U — Cross-Surface Consistency
Same Product resolves to same inventory status across ProductCard / Details / Cart / Wishlist.

## V — No Per-Card Inventory Request
Catalog does not issue one Inventory request per card.

---

# 64. Real Browser Verification — Mandatory

Do not rely only on Playwright.

Use real localhost/DEV browser and inspect actual transitions.

Required cases:

1. In Stock ProductCard
2. Low Stock ProductCard
3. Out-of-stock ProductCard
4. Product Details max quantity
5. Product Details low-stock copy
6. Product Details out-of-stock state
7. Cart exact-stock boundary
8. Cart stock shrink
9. Cart out-of-stock line
10. Wishlist out-of-stock saved Product
11. background refetch
12. slow network
13. responsive 390
14. responsive 768
15. responsive 1440
16. responsive 1920
17. keyboard
18. reduced motion

Observe first visible frame and transition, not only final state.

---

# 65. Boundary Verification

Test at minimum:

```text
quantity 0
quantity 1
quantity threshold
quantity threshold + 1
quantity large
```

For Cart:

```text
requested 1
requested available
requested available + 1
```

Do not test only "stock 10".

---

# 66. Performance Requirements

## Backend

Check:

- N+1 Product→Inventory queries;
- unbounded Inventory query;
- duplicated Product read;
- duplicated Cart validation loops;
- transaction contention;
- unnecessary full relations.

## Frontend

Check:

- per-card Inventory requests;
- duplicate Product Details request;
- broad invalidations;
- unnecessary rerenders;
- status calculation duplicated in many components;
- heavy polling.

## Target

Inventory integration should not materially degrade Product Catalog perceived loading.

Prove:

- no avoidable serial request added;
- no per-card request;
- no duplicate hydration;
- no unnecessary full-page loader.

---

# 67. Security Requirements

Check:

- customer cannot set stock;
- customer cannot increase/decrease stock;
- admin route, if existing, verifies ADMIN server-side;
- Product IDs validated;
- quantity validated;
- errors sanitized;
- no internal inventory admin data exposed unnecessarily;
- no secrets;
- no raw Prisma errors;
- no cross-user Cart access.

Inventory state itself is public commerce data only to the level required by UI.

Do not expose unrelated supplier/cost/private fields.

---

# 68. API Compatibility

Do not break existing Product/Cart/Wishlist consumers.

If extending DTOs:

- add compatible fields;
- preserve existing fields;
- update shared types;
- update mocks/fixtures;
- update tests.

Do not rename availability fields casually.

If current Product DTO already includes availability:

- extend/reuse it;
- do not create `inventoryV2`.

---

# 69. Error / Race Edge Cases

Handle:

- Product deleted/inactive between list and Add;
- Inventory row missing;
- stock changes after Product page load;
- stock changes after Cart Add;
- stock changes during Cart quantity mutation;
- stale Product query;
- cancelled request;
- background refetch failure;
- simultaneous Cart actions;
- malformed guest storage quantity;
- threshold boundary;
- stock changed to zero while Wishlist open.

Do not overbuild Checkout transaction semantics.

---

# 70. No Random Bug Hunting

TASK 03.4 is broad.

If an unrelated defect is observed:

```text
OUT-OF-SCOPE OBSERVATION
→ record
→ do not fix
```

Only fix unrelated-looking code when it directly blocks 03.4 and the smallest safe fix is necessary.

Do not use 03.4 for general UI cleanup.

---

# 71. Plan Mode Requirements

Before coding, Plan Mode must explicitly answer:

1. What Inventory model exists?
2. Is migration required?
3. Does threshold exist?
4. What is the current availability DTO?
5. Where is availability derived today?
6. Which Product endpoints need extension?
7. How does Cart validate stock today?
8. How does guest Cart revalidate?
9. How does Wishlist get Product availability?
10. What is the existing `StatusBadge` API?
11. Which components reuse ProductCard?
12. What exact screenshots were inspected?
13. Which visual refinements are allowed?
14. Which Admin work is deferred?
15. What service contract must 05.3 reuse?
16. How will N+1 be prevented?
17. What tests prove no stock reservation/decrement?
18. What browser states will be visually inspected?

No implementation before this plan is coherent.

---

# 72. Recommended Implementation Sequence

1. Read AGENTS/task/relevant docs.
2. Inspect Make screenshots.
3. Produce screenshot classification matrix.
4. Inspect schema/migrations/seed.
5. Inspect Product/Inventory services.
6. Inspect Product DTOs.
7. Inspect Cart inventory behavior.
8. Inspect Wishlist Product hydration.
9. Inspect existing `StatusBadge`.
10. Define domain status derivation.
11. Decide migration.
12. Implement/centralize Inventory core.
13. Add DB migration only if proven necessary.
14. Extend Product summary/detail availability.
15. Update Cart validation.
16. Verify guest Cart revalidation.
17. Update ProductCard availability UI.
18. Update Product Details inventory UX.
19. Update Cart inventory states.
20. Update Wishlist inventory states.
21. Add/update `StatusBadge` variants only if needed.
22. Add Storybook stories.
23. Add backend tests.
24. Add frontend tests.
25. Add integration/API tests.
26. Add Playwright matrix.
27. Verify no Inventory mutation from Cart/Wishlist.
28. Verify performance/no N+1.
29. Real-browser adversarial QA.
30. Screenshot capture.
31. Open/inspect screenshots.
32. Fix task-scoped UI defects.
33. Run responsive/a11y verification.
34. Full changed-file review.
35. Update docs.
36. Produce DB/Admin handoff.
37. Final validation.
38. Stop before commit/push/merge.

---

# 73. Required Validation Categories

Use actual repository scripts.

Expected categories:

- Prisma format/validate if schema touched;
- Prisma generate if required;
- migration status if migration touched;
- backend typecheck;
- backend lint;
- backend build;
- frontend typecheck;
- frontend lint;
- frontend build;
- focused Inventory tests;
- Product API tests;
- Cart integration tests;
- Wishlist affected tests;
- ProductCard/Product Details tests;
- Storybook build;
- Storybook a11y checks;
- focused Playwright 03.4;
- real browser QA;
- `git diff --check`.

Do not invent passing evidence.

---

# 74. DEV Database / Live Verification Gate

If Inventory schema or backend Inventory mutations change, perform a safe DEV verification gate before final approval.

Verify:

- correct DEV project identity;
- PROD identity confirmed but NO PROD writes;
- migration ledger;
- Inventory relation;
- unique Product inventory relation;
- threshold field/default if added;
- non-negative behavior;
- status boundaries;
- Cart Add does not decrement stock;
- Wishlist Add does not decrement stock;
- admin-only stock mutation rejects CUSTOMER if route exists;
- safe set/increase/decrease service behavior if exposed;
- cleanup DEV test data.

Never use production inventory for destructive testing.

---

# 75. Seed / Fixture Requirements

If DEV seed already has useful mixed inventory states, reuse it.

Otherwise add deterministic DEV-only inventory variety as appropriate.

Need representative Products for:

```text
IN_STOCK
LOW_STOCK
OUT_OF_STOCK
```

Do not modify production seed/data.

Do not create fake production runtime data.

Storybook fixtures remain deterministic and dev-only.

---

# 76. Documentation Updates

Update only affected docs.

Likely:

- Inventory feature documentation;
- Product feature documentation;
- Cart availability documentation;
- Wishlist availability documentation;
- API docs/types;
- DB schema/migration docs if changed;
- state/query docs if changed;
- Storybook docs;
- testing/E2E docs;
- roadmap task status;
- implementation report.

Add an explicit section:

```text
TASK 05.3 ADMIN INVENTORY HANDOFF
```

describing what Admin MUST reuse.

Docs must describe actual implementation.

---

# 77. Definition of Done — Domain

- [ ] one authoritative Inventory model
- [ ] quantity integer >=0
- [ ] threshold capability
- [ ] status derived consistently
- [ ] `IN_STOCK`
- [ ] `LOW_STOCK`
- [ ] `OUT_OF_STOCK`
- [ ] Product activation distinct from stock status
- [ ] missing Inventory handled safely
- [ ] no negative stock
- [ ] no duplicate Inventory architecture

---

# 78. Definition of Done — Product UI

- [ ] ProductCard uses existing `StatusBadge`
- [ ] In Stock state
- [ ] Low Stock state
- [ ] Out of Stock state
- [ ] Add disabled when out of stock
- [ ] Wishlist heart remains usable
- [ ] navigation remains usable
- [ ] rating/review row preserved
- [ ] card geometry stable
- [ ] Products/Home/Search/related ProductCard consumers verified

---

# 79. Definition of Done — Product Details

- [ ] existing `StatusBadge` used
- [ ] quantity max = stock
- [ ] low-stock copy
- [ ] Add enabled when valid
- [ ] Add disabled out of stock
- [ ] stock shrink handled
- [ ] gallery does not reset
- [ ] Wishlist remains usable
- [ ] no layout jump

---

# 80. Definition of Done — Cart

- [ ] Add above stock rejected
- [ ] quantity above stock rejected
- [ ] exact stock allowed
- [ ] existing line retained if stock shrinks
- [ ] clear insufficient-stock state
- [ ] out-of-stock line retained
- [ ] remove remains available
- [ ] no silent clamp/delete of persisted Cart line
- [ ] no Inventory reservation
- [ ] no Inventory decrement
- [ ] guest Cart revalidated
- [ ] authenticated server enforcement

---

# 81. Definition of Done — Wishlist

- [ ] In Stock saved Product
- [ ] Low Stock saved Product
- [ ] Out-of-stock saved Product remains
- [ ] Add to Cart disabled when OOS
- [ ] heart/remove remains
- [ ] inventory change never removes membership
- [ ] no Inventory mutation from Wishlist action

---

# 82. Definition of Done — StatusBadge

- [ ] existing component reused
- [ ] no duplicate Inventory badge
- [ ] labels correct
- [ ] tokens/design system preserved
- [ ] current consumers not regressed
- [ ] Storybook updated if variants added

---

# 83. Definition of Done — Figma / Visual

- [ ] all supplied Make screenshots inspected
- [ ] no live Figma Design link required
- [ ] screenshot dimensions recorded
- [ ] approved/refinement/future matrix produced
- [ ] ProductCard hierarchy preserved
- [ ] Product Details hierarchy preserved
- [ ] Cart hierarchy preserved
- [ ] Wishlist hierarchy preserved
- [ ] low-stock state polished
- [ ] out-of-stock state polished
- [ ] insufficient-stock state polished
- [ ] current Header/Footer preserved
- [ ] prototype controls absent
- [ ] controlled refinements documented

---

# 84. Definition of Done — Responsive

- [ ] 390 real browser
- [ ] 768 real browser
- [ ] 1440 real browser
- [ ] 1920 real browser
- [ ] ProductCard badge/wrap correct
- [ ] Product Details controls correct
- [ ] Cart stock warnings correct
- [ ] Wishlist ProductCards correct
- [ ] no horizontal overflow
- [ ] no visually broken whitespace
- [ ] touch targets adequate

---

# 85. Definition of Done — Accessibility

- [ ] semantic status text
- [ ] not color-only
- [ ] keyboard quantity controls
- [ ] accessible Add-to-Cart states
- [ ] inline Cart errors associated correctly
- [ ] focus-visible
- [ ] Wishlist control remains accessible
- [ ] reduced motion
- [ ] Storybook a11y green where applicable
- [ ] real keyboard QA completed

---

# 86. Definition of Done — Storybook

- [ ] existing StatusBadge stories updated
- [ ] ProductCard In Stock
- [ ] ProductCard Low Stock
- [ ] ProductCard Out of Stock
- [ ] Product Details inventory states
- [ ] Cart inventory states
- [ ] Wishlist inventory states
- [ ] deterministic fixtures
- [ ] no default live API
- [ ] responsive verification
- [ ] a11y verification
- [ ] Storybook production isolation preserved

---

# 87. Definition of Done — Testing

- [ ] status derivation unit tests
- [ ] threshold boundaries
- [ ] quantity validation
- [ ] Product inactive test
- [ ] missing Inventory test
- [ ] stock update service tests if implemented
- [ ] Product API integration
- [ ] Cart API restrictions
- [ ] guest Cart revalidation
- [ ] Wishlist out-of-stock preservation
- [ ] no Cart Inventory mutation
- [ ] no Wishlist Inventory mutation
- [ ] React Query/background refetch tests
- [ ] Playwright A–V
- [ ] real browser verification
- [ ] screenshot inspection
- [ ] affected regressions green

---

# 88. Definition of Done — Performance

- [ ] no ProductCard Inventory N+1
- [ ] no per-card Inventory HTTP
- [ ] no duplicate Product Details Inventory call
- [ ] Cart validation bounded
- [ ] Wishlist validation bounded
- [ ] no unnecessary global invalidation
- [ ] no heavy polling
- [ ] no avoidable full-page skeleton on background refresh

---

# 89. Definition of Done — Security

- [ ] customer cannot mutate stock
- [ ] ADMIN enforced server-side if stock route exists
- [ ] Product ID validated
- [ ] quantities validated
- [ ] errors sanitized
- [ ] no secret/private data exposed
- [ ] no raw Prisma errors
- [ ] no cross-user Cart access

---

# 90. Definition of Done — Database

- [ ] current schema inspected
- [ ] migrations inspected
- [ ] no duplicate Inventory model
- [ ] `Inventory.productId` uniqueness verified
- [ ] migration only if necessary
- [ ] threshold persisted safely if added
- [ ] existing rows handled
- [ ] non-negative guarantee documented/proven
- [ ] no `db push`
- [ ] DB docs updated if changed

---

# 91. Definition of Done — 05.3 Handoff

- [ ] Inventory core documented
- [ ] stock mutation primitives documented
- [ ] low-stock semantics documented
- [ ] `StatusBadge` reuse documented
- [ ] Admin UI explicitly deferred
- [ ] 05.3 instructed to read/reuse this task
- [ ] no future Admin duplication introduced

---

# 92. Rejection Conditions

TASK 03.4 must be rejected if any apply:

- frontend is treated as Inventory authority;
- stock status duplicated inconsistently;
- new Inventory model created despite sufficient existing model;
- new Inventory badge created instead of `StatusBadge`;
- Cart reserves/decrements stock;
- Wishlist action mutates stock;
- customer can call stock mutation;
- Add above stock accepted by authenticated backend;
- out-of-stock Cart line silently disappears;
- out-of-stock Wishlist Product silently disappears;
- Product inactive conflated with Out of Stock;
- per-card Inventory requests created;
- negative stock possible through implemented mutation;
- Admin UI implemented as scope creep;
- Checkout implemented as scope creep;
- Figma Make screenshots not inspected;
- responsive states not verified;
- Storybook omitted;
- real browser review omitted;
- screenshots captured but never opened/inspected;
- tests green only because assertions/timeouts were weakened;
- unrelated UI redesigned;
- unresolved Critical/High task-scoped defects remain.

---

# 93. Mandatory Real-Browser Adversarial Review

Before handoff, assume the UI contains an Inventory bug.

Try to break only affected behavior through:

- hard refresh;
- direct Product Details load;
- Products→Details navigation;
- background refetch;
- stock `6→5`;
- stock `1→0`;
- stock `0→1`;
- Cart exact max;
- Cart over max;
- Cart stock shrink;
- Wishlist OOS;
- rapid quantity click;
- slow network;
- route away/back;
- mobile;
- keyboard;
- reduced motion.

Do not call this random bug hunting.

It is task-scoped adversarial QA.

---

# 94. Screenshot Inspection Checklist

For every captured screenshot ask:

1. Is badge placement correct?
2. Is status readable?
3. Is it color-independent?
4. Does ProductCard still look balanced?
5. Is rating row preserved?
6. Is low-stock copy compact?
7. Is disabled Add obvious but not visually broken?
8. Does Product Details action hierarchy remain polished?
9. Does Cart warning fit without breaking row geometry?
10. Does Wishlist OOS Product still look like a saved Product?
11. Are card heights consistent?
12. Is responsive wrapping intentional?
13. Is there excessive whitespace?
14. Is anything clipped?
15. Does it look like a polished electronics commerce UI?

If any answer is no:

```text
FIX BEFORE HANDOFF
```

---

# 95. Changed-File Full Review

Before final status:

```bash
git status
git diff --stat
git diff --name-only
git diff --check
```

Include staged, unstaged, and untracked task files.

Read every changed task-related implementation file IN FULL.

For each ask:

```text
Why changed?
Required?
Architecture correct?
Duplicate logic?
Security?
Performance?
Edge cases?
Tests?
Docs?
```

Do not hand off if changed files were not reviewed in full.

---

# 96. Required Final Implementation Report

Produce:

```text
# TASK 03.4 — CUSTOMER INVENTORY IMPLEMENTATION REPORT

## Status
COMPLETE / PARTIAL / BLOCKED

## Branch
feature/Inventory

## Scope Implemented
- ...

## Explicitly Deferred to 05.3
- ...

## Documentation Read
- ...

## Related Files Inspected
- ...

## Figma Make Verification

Screenshots inspected:
- ...

Dimensions:
- ...

Approved/reused:
- ...

Controlled refinements:
- ...

Future-scope elements excluded:
- ...

Live Figma Design required:
NO

## Architecture
- ...

## Inventory Model
- ...

## Database Decision
Migration:
YES / NO

Reason:
...

## Inventory Status Rules
IN_STOCK:
...

LOW_STOCK:
...

OUT_OF_STOCK:
...

## Existing StatusBadge Reuse
PASS / FAIL

New inventory badge created:
NO / YES

## ProductCard
In Stock:
PASS / FAIL

Low Stock:
PASS / FAIL

Out of Stock:
PASS / FAIL

## Product Details
PASS / FAIL

## Cart
PASS / FAIL

Over-stock restriction:
PASS / FAIL

Out-of-stock line preserved:
PASS / FAIL

## Wishlist
PASS / FAIL

Out-of-stock item preserved:
PASS / FAIL

## Inventory Side Effects
Cart changes stock:
NO / YES

Wishlist changes stock:
NO / YES

## Backend Enforcement
PASS / FAIL

## Concurrency / Non-Negative Safety
PASS / FAIL

## Performance
N+1:
NO / YES

Per-card Inventory HTTP:
NO / YES

## Storybook
PASS / FAIL — count

## Backend Tests
PASS / FAIL — count

## Frontend Tests
PASS / FAIL — count

## Integration/API Tests
PASS / FAIL — count

## Playwright
PASS / FAIL — count

Scenarios A–V:
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

Visual defects found:
- ...

Visual defects fixed:
- ...

Remaining:
NONE / ...

## Accessibility
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

## DEV DB Gate
PASS / FAIL / N/A

## Files Changed
- ...

## Documentation Updated
- ...

## 05.3 Admin Handoff
- ...

## Out-of-Scope Observations
NONE / ...

## Remaining Risks
NONE / ...

## Remaining Blockers
NONE / ...

## Ready for Architect Review
YES / NO
```

---

# 97. Required Requirement Matrix

Final report must classify every major requirement:

```text
Implemented
Partially Implemented
Missing
Incorrect
```

At minimum include:

- stock quantity;
- threshold;
- In Stock;
- Low Stock;
- Out of Stock;
- ProductCard;
- Product Details;
- Cart;
- Wishlist;
- server purchase restrictions;
- guest validation;
- StatusBadge reuse;
- stock update core;
- no negative stock;
- low-stock capability;
- Storybook;
- responsive;
- accessibility;
- Playwright;
- real-browser review;
- screenshot inspection;
- 05.3 handoff.

---

# 98. Evidence Rule

Do not say:

```text
looks correct
should work
probably safe
```

Prefer:

```text
verified by test
verified in real browser
verified by API response
verified by DB query
verified by migration status
verified by screenshot inspection
```

Distinguish:

```text
UNIT
MOCKED COMPONENT
INTERCEPTED E2E
LOCAL REAL API
LIVE DEV
```

Do not claim live persistence from mocks.

---

# 99. Final Architecture Principles

1. **Inventory belongs to backend/database.**
2. **Stock status is derived from quantity + threshold.**
3. **Product active status is not stock status.**
4. **Cart does not reserve stock.**
5. **Cart/Wishlist do not decrement stock.**
6. **Out-of-stock items remain visible where already saved.**
7. **Customer cannot mutate stock.**
8. **Existing `StatusBadge` is reused.**
9. **ProductCard remains one shared component.**
10. **No Inventory N+1.**
11. **03.5 must reuse 03.4 validation.**
12. **05.3 must reuse 03.4 Inventory core.**
13. **No random UI redesign.**
14. **Tests do not replace real-browser visual QA.**
15. **Screenshots must be inspected, not merely generated.**
16. **No negative stock.**
17. **No completion claim without evidence.**

---

# 100. Completion Gate

TASK 03.4 is complete only when all applicable items are verified:

```text
REPOSITORY TRUTH
✓ current schema inspected
✓ current APIs inspected
✓ current UI inspected
✓ current StatusBadge inspected

DOMAIN
✓ quantity
✓ threshold
✓ IN_STOCK
✓ LOW_STOCK
✓ OUT_OF_STOCK
✓ non-negative

PRODUCT
✓ ProductCard
✓ Product Details
✓ Product status separation

CART
✓ server restriction
✓ guest revalidation
✓ exact max
✓ over max blocked
✓ OOS line preserved
✓ no stock reservation/decrement

WISHLIST
✓ stock presentation
✓ OOS item preserved
✓ no stock mutation

UI
✓ existing StatusBadge
✓ Make screenshots inspected
✓ polished states
✓ no random redesign

QUALITY
✓ Storybook
✓ backend tests
✓ frontend tests
✓ integration
✓ Playwright
✓ real browser
✓ screenshot inspection
✓ responsive
✓ accessibility
✓ performance

HANDOFF
✓ docs
✓ 05.3 reuse contract
✓ architect evidence
```

The standard is not:

> "Inventory fields exist."

The standard is:

> **ElectroHub has one authoritative, secure, consistent, responsive, accessible, visually polished Inventory system across the customer commerce experience, with safe service foundations for Checkout and Admin, verified by automated tests and real-browser evidence.**

---

# 101. Permanent 03.4 Execution Flow

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
SCHEMA + MIGRATION DECISION
        ↓
INVENTORY DOMAIN CORE
        ↓
PRODUCT API AVAILABILITY
        ↓
CART SERVER RESTRICTIONS
        ↓
CUSTOMER UI INTEGRATION
        ↓
STATUSBADGE REUSE
        ↓
STORYBOOK
        ↓
UNIT / INTEGRATION
        ↓
PLAYWRIGHT
        ↓
REAL-BROWSER ADVERSARIAL REVIEW
        ↓
SCREENSHOT CAPTURE
        ↓
SCREENSHOT VISUAL INSPECTION
        ↓
FIX TASK-SCOPED DEFECTS
        ↓
REGRESSION
        ↓
FULL CHANGED-FILE REVIEW
        ↓
DOCS
        ↓
05.3 ADMIN HANDOFF
        ↓
ARCHITECT REVIEW
```

---

# 102. Stop Rule

Do not commit, push, merge, or self-approve.

When implementation and verification are complete:

```text
STOP
→ provide implementation report
→ provide evidence
→ READY FOR PRINCIPAL ARCHITECT REVIEW
```

The Principal Software Architect decides final approval.
