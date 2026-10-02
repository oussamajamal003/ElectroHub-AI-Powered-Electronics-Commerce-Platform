# ELECTROHUB — TASK 03.2 / SHOPPING CART

**Phase:** 03 — Commerce  
**Task:** 03.2 — Shopping Cart  
**Branch:** `feature/Shopping-Cart`  
**Target branch:** `develop`  
**Status:** Authoritative implementation task  
**Primary area:** Customer cart / Guest cart / Authenticated cart / Product-to-cart interactions  
**Implementation type:** Full-stack + UI + state + API + persistence + validation + Storybook + automated/manual QA  

---

# 1. Task Objective

Implement ElectroHub's complete Shopping Cart experience on top of the approved Product Catalog, Authentication, State/API, Inventory foundation, and existing Cart/CartItem database foundation.

TASK 03.2 must deliver:

- Add Product to Cart;
- Remove Product from Cart;
- Change quantity;
- Cart totals;
- Availability validation;
- guest-cart support;
- authenticated-cart support;
- guest persistence across navigation and refresh;
- authenticated persistence through the existing backend Cart model;
- guest-to-authenticated cart reconciliation;
- ProductCard `Add to Cart`;
- Product Details quantity selector + `Add to Cart`;
- Header cart badge;
- complete `/cart` page;
- empty/loading/error/availability states;
- responsive and accessible behavior;
- Storybook component/state verification;
- focused backend/frontend/integration/E2E verification;
- documentation and final evidence.

The final experience must feel like a real electronics-commerce cart, not a demo-only local counter.

```text
02.2 Database Foundation
        ↓
Cart / CartItem schema foundation
        ↓
02.5 Product Foundation
        ↓
Product / Price / Images / Inventory / Availability
        ↓
02.7 State + API Foundation
        ↓
React Query / API client / cache / loading / errors
        ↓
03.1 Product Catalog
        ↓
ProductCard / Product Details / Product imagery / real inventory data
        ↓
03.2 Shopping Cart
        ↓
Guest + authenticated cart / quantity / totals / availability validation
        ↓
03.5 Checkout
        ↓
Shipping / payment / order creation
```

03.2 must **consume and extend** the current architecture. It must not create a parallel commerce, API, state-management, Product, Inventory, Authentication, or design-system architecture.

---

# 2. Fixed Roadmap Scope

The roadmap defines TASK 03.2 as:

- Add product
- Remove product
- Change quantity
- Cart totals
- Availability validation

This task expands those bullets into the complete customer experience required to make them production-quality.

## 2.1 Included

1. Guest Cart
2. Authenticated Cart
3. Add Product
4. Remove Product
5. Change quantity
6. Cart totals
7. Availability validation
8. ProductCard Add to Cart
9. Product Details quantity selector
10. Product Details Add to Cart
11. Header cart badge
12. `/cart` page
13. Empty Cart state
14. Cart loading/error states
15. Guest local persistence
16. Guest → authenticated cart reconciliation
17. Current-price refresh
18. Current-availability refresh
19. Low-stock / out-of-stock states
20. Responsive Cart UI
21. Keyboard and accessibility behavior
22. Motion/micro-interactions consistent with the current ElectroHub motion system
23. Storybook states
24. Backend/service/API tests
25. Frontend component/hook tests
26. Integration tests
27. Playwright/browser E2E
28. Manual visual/responsive/keyboard verification
29. Task-relevant documentation updates

## 2.2 Explicitly Excluded

Do **not** implement these future roadmap tasks:

- full Checkout workflow;
- shipping-address collection;
- shipping-method selection;
- tax engine;
- payment-method collection;
- Stripe;
- order creation;
- order confirmation;
- coupons/promotions unless already implemented and merely displayed;
- Wishlist persistence/logic that belongs to 03.3;
- Inventory mutation/purchase-reservation architecture that belongs to 03.4;
- inventory decrement on Add to Cart;
- stock reservation;
- Cloudinary;
- AI recommendations;
- frequently bought together;
- admin cart management;
- delivery tracking;
- PDFs;
- transactional emails.

Do not expand 03.2 into 03.3–03.9.

---

# 3. Non-Negotiable Architecture

## 3.1 Customer UI Flow

```text
ProductCard / Product Details / Cart Page / Header Badge
        ↓
Cart feature hooks / guest-cart adapter
        ↓
React Query for authenticated server state
+ local guest-cart state for unauthenticated users
        ↓
Central API client
        ↓
Existing Express route/controller/service architecture
        ↓
CartService / Product / Inventory validation
        ↓
Prisma
        ↓
Supabase PostgreSQL
```

## 3.2 State Ownership

```text
Authenticated Cart server state
    → React Query + backend Cart/CartItem authority

Guest Cart identity/quantity
    → versioned localStorage + small feature-local adapter/state

Authentication
    → existing AuthContext / current backend auth authority

Product/Inventory truth
    → backend / current Product + Inventory data

URL state
    → React Router where navigation requires it

Ephemeral UI state
    → local React state
```

Do not introduce:

- another QueryClient;
- Redux/Zustand/another global-state dependency solely for Cart unless the current repo already uses it;
- direct component `fetch` calls;
- a second API client;
- client-side database access;
- another Product DTO;
- another Inventory model;
- another Auth provider;
- a new design system.

---

# 4. Relationship to Existing Foundation

## 4.1 Database Foundation

The repository's database foundation already defines `Cart` and `CartItem` concepts.

Expected existing relationship:

```text
User
 ↓ 1:1
Cart
 ↓ 1:N
CartItem
 ↓ N:1
Product
 ↓ 1:1
Inventory
```

Expected uniqueness:

```text
Cart.userId               UNIQUE
CartItem(cartId,productId) UNIQUE
```

TASK 03.2 should implement Cart business behavior on that foundation.

### Migration rule

Before writing any migration:

1. inspect the **current** `schema.prisma`;
2. inspect current migration history;
3. confirm whether Cart/CartItem already satisfy 03.2;
4. use the existing schema if sufficient.

Expected outcome: **no new Cart schema migration should be needed** if the current foundation remains intact.

Do not add:

- guest Cart database rows;
- anonymous User rows;
- session-cart tables;
- price snapshot fields to CartItem;
- stock-reservation fields;
- Checkout fields.

A migration is allowed only when current repository truth proves an essential 03.2 requirement cannot be implemented safely without it.

Never use `prisma db push` as a migration substitute.

## 4.2 Product Catalog 03.1

Reuse the current:

- ProductCard;
- Product Details;
- Product image model;
- Product pricing;
- category/brand metadata;
- inventory/availability presentation;
- Product query hooks;
- Product API DTOs;
- Header;
- Footer;
- responsive system;
- motion system;
- skeleton/error patterns.

03.2 adds Cart interaction to existing Product components. Do not fork a second ProductCard.

## 4.3 State/API Foundation 02.7

Reuse:

- central API client;
- current QueryClient;
- query-key factory conventions;
- retry policy;
- cancellation;
- error normalization;
- existing loading patterns;
- background-refetch behavior;
- mutation patterns.

Cart mutations must not cause unrelated Product/Search/Home queries to refetch without a proven reason.

## 4.4 Authentication

Reuse the current Authentication architecture.

03.2 must support both:

```text
Unauthenticated
→ Guest Cart

Authenticated
→ Server-backed customer Cart
```

Authentication must never be required merely to browse or add Products to Cart.

---

# 5. Mandatory Repository-First Workflow

Before implementation:

1. Read root `AGENTS.md`.
2. Confirm branch and HEAD.
3. Work on `feature/Shopping-Cart`.
4. Synchronize safely according to repository Git workflow.
5. Read this task completely.
6. Inspect the current `docs/` tree.
7. Identify only documents materially relevant to 03.2.
8. Read those docs before implementation.
9. Inspect current:
   - Cart/CartItem Prisma models;
   - Inventory;
   - Product;
   - Auth;
   - ProductCard;
   - Product Details;
   - Header;
   - API client;
   - React Query architecture;
   - current tests;
   - Storybook;
   - supplied Figma Make screenshots.
10. Compare Figma Make against task/business requirements.
11. Classify visual elements as:
    - approved + in scope;
    - existing/reused;
    - controlled refinement allowed;
    - future-scope visual only.
12. Produce the smallest complete implementation plan.
13. Implement only 03.2.
14. Update affected documentation.
15. Verify final docs and implementation agree.

Do not trust old chat summaries over current repository files.

---

# 6. Task-Specific Documentation Discovery

Do **not** blindly read every document.

Likely relevant current documentation includes:

## Project Foundation

- Roadmap
- Project structure
- Tech stack
- dependencies
- decisions/ADRs where materially relevant

## Design

- design system
- components
- layouts
- colors
- typography
- icons
- motion
- responsive behavior
- UI guidelines

## Architecture

- system architecture
- frontend architecture
- backend architecture
- API architecture
- database architecture

## Engineering Standards

- coding standards
- TypeScript
- SCSS
- component guidelines
- API guidelines
- state management
- error handling
- security
- performance

## Feature Docs

- Products
- Inventory
- Authentication
- Cart if already documented

## Database

- Prisma schema
- tables
- relationships
- indexing
- migrations

## Quality

- Testing
- E2E
- Accessibility
- Performance
- Storybook
- Definition of Done

## Workflow

- Git workflow
- branching
- code review

Do not spend task time reading Stripe, Delivery, AI, Cloudinary, PDF, Email, Admin analytics, or other future domains unless a real dependency discovered in the code requires it.

Final handoff must list docs read and docs updated.

---

# 7. Source and Authority Hierarchy

When requirements appear to conflict:

```text
1. ROADMAP.md
   → owns Phase/Task boundaries

2. TASK_03.2_SHOPPING_CART.md
   → exact 03.2 behavior and acceptance criteria

3. Current repository schema/API/domain/code
   → implementation truth

4. Supplied Figma Make screenshots
   → approved starting visual intent

5. Current approved ElectroHub design system
   → tokens, components, motion, responsive rules

6. Current 03.1 implementation
   → ProductCard/Product Details/Header/Footer integration truth

7. Storybook foundation
   → isolated visual/state QA workflow
```

Never fabricate Product, Inventory, Cart, price, authentication, or Checkout behavior merely to copy pixels.

---

# 8. Mandatory Figma Make Inspection Before Implementation

Before coding, inspect the supplied screenshots and compare them against the project requirements.

The agent must explicitly determine:

| Screenshot element | Status |
|---|---|
| Cart items | 03.2 approved |
| Quantity stepper | 03.2 approved |
| Remove control | 03.2 approved |
| Order Summary | 03.2 approved |
| Subtotal/Total | 03.2 approved |
| Free shipping display | 03.2 display rule only |
| Proceed to Checkout CTA | visual context; Checkout behavior belongs to 03.5 |
| Product Details quantity | 03.2 approved |
| Product Details Add to Cart | 03.2 approved |
| Buy Now | future Checkout behavior; do not implement 03.5 |
| Wishlist heart | preserve existing behavior only; Wishlist implementation belongs to 03.3 |
| Header/Footer shown in screenshot | context only; current app-shell decisions take precedence |
| Figma Make floating prototype controls | never implement |

The agent must understand what is already approved versus what it is allowed to refine.

---

# 9. Visual Authority — Supplied Figma Make Screenshots

No live Figma Design link is required.

The supplied screenshots are the visual starting authority for TASK 03.2.

## 9.1 Required Screenshot Set

### Cart

1. `Cart page.png` — **1920 × 907**

Reference for:

- `/cart` desktop hierarchy;
- breadcrumb;
- Shopping Cart heading;
- cart-item row;
- Product image;
- Product name/category/price;
- quantity controls;
- remove control;
- Order Summary;
- subtotal;
- shipping;
- total;
- primary CTA;
- Continue shopping;
- two-column desktop composition;
- spacing relationship to Header/Footer.

### Product Details Cart Actions

2. `product details page.png` — **1920 × 907**

Reference for:

- Product Details action region;
- quantity label;
- decrement/current quantity/increment controls;
- `Add to Cart`;
- `Buy Now` visual placement;
- Wishlist icon placement;
- relationship between availability and Cart controls;
- desktop spacing and hierarchy.

## 9.2 ProductCard Reference

No separate new 03.2 ProductCard screenshot is required.

Use:

1. current approved 03.1 ProductCard;
2. current ElectroHub design system;
3. current Products/Home integration;
4. this task's interaction rules.

03.2 must add Cart interaction without destroying the approved ProductCard hierarchy.

## 9.3 Current App Shell Wins Over Stale Screenshot Shell

Do not revert current Header/Footer simply because the Figma Make screenshot shows an older shell.

Preserve current approved:

- navigation order;
- auth visibility rules;
- Account/Profile treatment;
- About/Contact;
- current Footer;
- current brand treatment;
- current motion refinements.

The screenshots define **Cart/Product-detail content**, not permission to regress newer approved app-shell work.

## 9.4 Prototype Overlay Exclusion

Never implement Figma Make prototype controls such as:

```text
Customer | Admin | Flows | Components
```

They are not product UI.

---

# 10. Figma Refinement Rule

Figma Make screenshots are the **first approved design reference**, not an immutable pixel prison.

Start from the supplied design.

Preserve:

- information architecture;
- core composition;
- hierarchy;
- content grouping;
- primary actions;
- visual balance;
- ElectroHub identity.

Controlled refinement is allowed when it clearly improves:

- usability;
- accessibility;
- responsiveness;
- touch behavior;
- keyboard behavior;
- Cart validation clarity;
- loading/error behavior;
- empty states;
- multi-item states;
- guest-auth transitions;
- long Product names;
- low-stock/out-of-stock states;
- design-system consistency;
- current approved app-shell behavior.

Refinement is not permission to:

- ignore Figma;
- perform a random redesign;
- add future Checkout features;
- introduce unrelated visual language;
- undo newer approved ElectroHub UI.

Use this test:

> Does this still clearly look like the approved Cart/Product Details design, but more complete, polished, accessible, responsive, and state-safe?

If yes, it is allowed.

Document meaningful refinements in the final `FIGMA REFINEMENTS` section.

---

# 11. Cart Domain Rules

## 11.1 Cart Does Not Reserve Stock

Adding a Product to Cart does **not** reserve inventory.

```text
CartItem
   ↓
Product
   ↓
Inventory
```

Inventory can change after an item is added.

03.2 validates availability but does not decrement or reserve inventory.

Final purchase validation remains part of later Checkout/Order flow.

## 11.2 Product Identity

Cart uniqueness is by Product identity.

The same Product must not create multiple Cart rows.

```text
same Product + Add again
→ existing line quantity changes
→ no duplicate row
```

## 11.3 Quantity

Quantity rules:

- integer only;
- minimum `1`;
- never `0`;
- cannot exceed currently allowed availability when directly adding/updating an available Product;
- decrement disabled at `1`;
- increment disabled at current maximum;
- invalid client input rejected by backend;
- UI must not rely on client-only checks.

## 11.4 Price

CartItem must not become the authority for Product price.

Current Product price is authoritative for Cart display/totals.

Never trust:

- localStorage price;
- frontend-submitted price;
- frontend-submitted subtotal;
- frontend-submitted total.

## 11.5 Totals

For 03.2:

```text
lineTotal = currentUnitPrice × validatedQuantity

subtotal = Σ lineTotal

shipping = 0 / "Free" for the current approved Cart display

total = subtotal + shipping
```

Do not introduce:

- taxes;
- coupon engine;
- shipping calculation engine;
- payment calculations.

Use current Decimal/money conventions. Avoid floating-point money errors.

## 11.6 Item Count

Header badge and summary item count use **total quantity**, not distinct line count.

Example:

```text
iPhone ×2
MacBook ×1

Header badge = 3
Subtotal label = 3 items
Distinct lines = 2
```

---

# 12. Guest Cart

Unauthenticated customers must be able to:

- add Product from ProductCard;
- add selected quantity from Product Details;
- open `/cart`;
- see Cart items;
- change quantity;
- remove items;
- see totals;
- navigate away and back;
- refresh without losing Cart;
- sign in when ready to continue toward Checkout.

Authentication is not a prerequisite for basic Cart use.

---

# 13. Guest Cart Persistence

Use a small versioned browser-storage model.

Recommended key:

```text
electrohub.cart.v1
```

Persist only minimum identity/intent:

```ts
type GuestCartItem = {
  productId: string;
  quantity: number;
};
```

Do not treat locally stored values as Product truth.

Do **not** persist authoritative:

- Product name;
- Product price;
- Product image;
- category;
- Brand;
- availability;
- inventory quantity;
- line total;
- subtotal;
- total.

Those values must be refreshed from current authoritative Product/Inventory data.

## 13.1 Defensive Storage Handling

Guest Cart hydration must survive:

- missing key;
- empty data;
- malformed JSON;
- invalid Product ID;
- invalid quantity;
- duplicate local entries;
- browser storage failure.

Malformed local state must not crash ElectroHub.

Normalize safely and report recoverable issues where user-visible action is required.

## 13.2 No Sensitive Data

Do not store:

- auth tokens inside Cart storage;
- User IDs;
- email;
- addresses;
- payment data;
- private profile data.

---

# 14. Authenticated Cart

Authenticated customer Cart is server-owned.

Expected behavior:

- one Cart per customer;
- Cart items persist across refresh;
- Cart persists independently of the current device where backend architecture supports it;
- CartItem ownership is derived from authenticated User;
- frontend never sends arbitrary `userId` as authority.

The backend must use the authenticated principal to resolve the customer's Cart.

---

# 15. Guest → Authenticated Cart Reconciliation

When a guest authenticates:

```text
Guest Cart
    ↓
successful authentication
    ↓
server Cart loaded
    ↓
guest entries revalidated
    ↓
guest/server Cart reconciled
    ↓
React Query Cart cache updated
    ↓
guest local storage cleared ONLY after success
```

## 15.1 Reconciliation Requirement

Because the current architecture has a server-backed Cart foundation, 03.2 must implement a safe reconciliation path unless current repository analysis proves an existing approved behavior already handles it.

Do not silently discard a guest Cart on login.

## 15.2 Same-Product Conflict

If a Product exists in both guest and authenticated carts, use the repository's existing documented merge policy if one exists.

If none exists, implement a deterministic, retry-safe reconciliation policy and document it.

The result must:

- never create duplicate CartItem rows;
- respect inventory validation;
- not inflate quantity repeatedly after refresh/retry;
- be safe against duplicate client attempts.

Do not implement a naive non-idempotent `guestQty + serverQty` retry loop.

## 15.3 Merge Failure

If merge/reconciliation fails:

- do not delete guest local state;
- do not show a false success;
- keep user Cart recoverable;
- show a sanitized retryable error;
- do not duplicate server rows on retry.

## 15.4 After Successful Merge

After confirmed reconciliation:

- clear guest Cart storage;
- server Cart becomes authoritative;
- badge immediately reflects server Cart total quantity.

---

# 16. Logout Isolation

On logout:

- authenticated server Cart remains associated with that User;
- do not copy server Cart into guest localStorage;
- do not leak authenticated Cart items to the next guest/session/User;
- guest Cart begins from its own separate state.

Logging out must not destroy the user's server Cart.

---

# 17. Guest Cart Hydration / Validation

Guest localStorage contains only Product IDs and quantities.

The UI must hydrate them with current Product/Inventory data.

Avoid an N+1 request per Cart item.

Preferred approach:

- reuse an existing bounded bulk Product endpoint if it exists;
- otherwise add the smallest public Cart-validation/bulk-hydration API consistent with current API standards.

The public guest validation path must accept only bounded:

```text
productId + quantity
```

and return authoritative public Product/availability information.

Never expose private data.

---

# 18. Authenticated Cart API

Inspect existing routes first.

Reuse them if they exist.

If missing, implement the smallest REST surface consistent with current API conventions.

Conceptual operations:

```text
GET    current authenticated Cart
POST   add Product / quantity
PATCH  set/change quantity
DELETE remove Cart item
POST/PUT guest reconciliation if needed
```

Exact route names and response envelopes must follow current project API standards.

Do not create duplicate Cart APIs.

---

# 19. Cart Response Shape — Required Semantics

Regardless of exact current DTO/envelope conventions, authenticated Cart data must provide enough authoritative information for:

- Cart item ID where applicable;
- Product ID;
- Product slug;
- Product name;
- current Product price;
- primary Product image;
- category display data where needed;
- requested/current Cart quantity;
- current inventory availability;
- current available quantity where safe/appropriate;
- line total;
- availability state;
- Cart subtotal;
- shipping display amount;
- Cart total;
- total quantity;
- whether unavailable items block checkout intent.

Do not return:

- full Reviews;
- all Product specifications;
- all Product images;
- private User fields;
- unrelated relations.

Keep response bounded.

---

# 20. Backend Cart Service

Business logic belongs in the backend service layer.

Controller remains thin.

Service responsibilities include:

- resolve current User Cart;
- create Cart lazily if appropriate;
- validate Product existence/status;
- validate quantity;
- validate availability;
- prevent duplicate lines;
- add/update/remove;
- compute authoritative totals;
- reconcile guest Cart;
- return bounded DTOs;
- sanitize errors.

Do not place core Cart business logic inside Express controllers.

---

# 21. Product Availability Validation

Availability validation is a first-class 03.2 requirement.

Validation occurs at two levels.

## 21.1 Add / Quantity Update

When customer adds or changes quantity:

```text
requested quantity
    ↓
current Product status
    ↓
current Inventory
    ↓
allowed / rejected / capped according to explicit rule
```

Direct add/update must not knowingly exceed current available quantity.

If only `2` are available:

> Only 2 items are currently available.

Use current error/notification style.

## 21.2 Cart Open / Refresh Revalidation

Inventory can change after a Product was added.

Every Cart load/revalidation must handle:

### Available

Normal line.

### Low stock / requested quantity exceeds current stock

Example:

> Only 2 left — quantity adjusted from 4 to 2.

If auto-adjustment is used, it must be deterministic, visible, and persisted.

Do not silently alter quantity without user feedback.

### Out of stock

Keep the line visible.

Show:

> Out of stock

Rules:

- do not silently delete;
- disable quantity increase;
- block checkout intent;
- allow Remove;
- keep Product context visible.

### Inactive / no longer purchasable Product

Keep a recoverable unavailable line where feasible.

Show an explicit message and Remove action.

Do not crash or silently drop the item.

---

# 22. Price Changes

Cart price is always based on current Product price.

If price changes after Product was added:

- Cart displays current price;
- totals use current price;
- stale guest-local price can never override it;
- authenticated CartItem must not act as a price snapshot.

A subtle `Price updated` message may be shown where useful as a controlled refinement.

Historical purchase-price snapshot belongs to OrderItem, not CartItem.

---

# 23. Add Product from ProductCard

Update the existing ProductCard.

Do not create another ProductCard.

Required content hierarchy remains current 03.1 design.

Add:

```text
Add to Cart
```

## 23.1 ProductCard Add Behavior

Default:

```text
click Add to Cart
→ add quantity 1
```

If same Product already exists:

```text
existing quantity 2
+ Add to Cart
→ quantity 3
```

subject to availability.

No duplicate line.

## 23.2 Interaction Isolation

Clicking ProductCard itself:

```text
→ Product Details
```

Clicking `Add to Cart`:

```text
→ Cart mutation only
→ MUST NOT navigate to Product Details
```

Correctly stop card-click propagation where required.

## 23.3 Success State

Use a brief polished state such as:

```text
Added ✓
```

or the current approved notification system.

Requirements:

- immediate feedback;
- accessible live announcement;
- no fake delay;
- returns cleanly to normal control state;
- Header badge updates immediately.

## 23.4 Loading

Use button-level/inline mutation feedback.

Do not:

- replace ProductCard with a skeleton;
- reload the page;
- show full-page loader.

## 23.5 Out of Stock

Out-of-stock Product:

```text
Out of Stock
```

Cart action disabled/unavailable with visible reason.

Do not rely only on tooltip.

---

# 24. Product Details Quantity + Add to Cart

Follow `product details page.png`.

Approved action layout intent:

```text
Qty    −   1   +

[ Add to Cart ]   [ Buy Now ]   [ Wishlist icon ]
```

## 24.1 Quantity Selector

Required:

- default `1`;
- minimum `1`;
- maximum current allowed stock;
- `−` disabled at `1`;
- `+` disabled at max;
- keyboard accessible;
- touch-friendly;
- visible disabled states;
- no free-form invalid negative values unless current design explicitly uses an input;
- if input is editable, sanitize integers and boundaries.

## 24.2 Add Selected Quantity

Example:

```text
selected quantity = 3

Add to Cart
→ adds 3
```

If Cart already contains quantity `2`:

```text
existing 2 + selected 3
→ resulting quantity 5
```

subject to stock limit.

No duplicate row.

## 24.3 Product Details Availability

If out of stock:

- quantity control disabled;
- Add to Cart disabled/unavailable;
- visible `Out of stock`;
- Product Details remains readable.

## 24.4 Buy Now Scope Boundary

`Buy Now` visually appears in the supplied screenshot.

Do **not** implement a new Checkout workflow in 03.2.

If current project already has an approved legitimate Buy Now behavior, preserve it.

Otherwise:

- preserve visual placement only where appropriate;
- use the current project's explicit deferred-control pattern;
- do not route to a fake Checkout;
- do not create Order/Payment behavior.

Document the choice in final evidence.

## 24.5 Wishlist Scope Boundary

03.3 owns Wishlist.

Preserve existing approved Wishlist behavior if already implemented.

Do not implement new Wishlist persistence/business logic in 03.2.

---

# 25. Header Cart Badge

03.2 owns the live Cart count badge.

Badge = **total quantity**.

Example:

```text
iPhone ×2
MacBook ×1

badge = 3
```

Required:

- hidden when `0` unless current Header design requires a zero;
- updates immediately after Add;
- updates after Remove;
- updates after `+`/`−`;
- updates after guest/auth reconciliation;
- reflects correct source after login/logout;
- accessible name such as `Cart, 3 items`;
- no full Header remount;
- no unnecessary Product refetch.

For very large counts, follow current badge conventions (for example `99+`) if such a convention exists.

---

# 26. `/cart` Page

Follow `Cart page.png` as the starting visual reference.

## 26.1 Desktop Composition

Desktop / large-screen intent:

```text
Breadcrumb
Shopping Cart

┌──────────────────────────────┐   ┌──────────────────────┐
│ Cart item                    │   │ Order Summary        │
│ image / info / qty / remove  │   │ Subtotal             │
│                              │   │ Shipping             │
│ additional rows...           │   │ Total                │
└──────────────────────────────┘   │ CTA                  │
                                   │ Continue shopping    │
                                   └──────────────────────┘
```

## 26.2 Cart Item Row

Each row includes:

- Product image;
- Product name;
- category where useful;
- current unit price;
- availability message when relevant;
- quantity controls;
- remove control;
- optional line total if design benefits and remains consistent.

Clicking Product name/image should navigate to Product Details unless current interaction architecture says otherwise.

## 26.3 Order Summary

Required:

- `Order Summary`;
- `Subtotal (n item/items)`;
- Shipping;
- Total;
- primary Checkout-intent CTA;
- Continue shopping.

Current shipping display:

```text
Free
```

This is a 03.2 Cart-summary display rule only.

It does not implement shipping logic.

## 26.4 Continue Shopping

`Continue shopping` should provide deterministic navigation back to shopping, normally `/products`, following current routing conventions.

Do not create an unpredictable history-only path if it can return to Login or unrelated pages.

---

# 27. Guest Checkout Intent

Do **not** disable Checkout merely because the user is unauthenticated and hide the reason in a tooltip.

For a valid guest Cart:

```text
Sign in to Checkout
```

is an enabled, actionable CTA.

Click:

```text
Cart
 ↓
Login
 ↓
successful authentication
 ↓
guest Cart reconciliation
 ↓
return safely to Cart / existing Checkout-intent path
```

Use the existing Auth redirect/return mechanism.

Return targets must be internal and safe.

No open redirect.

Cart must remain intact.

---

# 28. Authenticated Checkout Intent

03.5 owns actual Checkout.

For authenticated users:

```text
Proceed to Checkout
```

may navigate only if a legitimate current `/checkout` route/workflow already exists.

If Checkout is not implemented yet:

- do not create a fake Checkout flow;
- do not create fake Order/Payment records;
- preserve the Figma CTA visually using the current accessible deferred-feature convention;
- provide a visible explanation where necessary;
- do not use a dead clickable button.

This boundary must be documented.

---

# 29. Availability Blocks Checkout Intent

Regardless of auth state:

If Cart contains:

- out-of-stock item;
- inactive Product;
- unresolved invalid item;

the Checkout-intent action must not proceed.

Show a visible message such as:

> Remove unavailable items to continue.

Do not rely only on a tooltip.

Guest authentication may still be available through normal Account/Login UI, but the Cart checkout action itself must reflect Cart invalidity.

---

# 30. Remove Product

Trash/remove control:

```text
click Remove
→ remove line
→ update totals
→ update badge
```

No confirmation modal is required for normal Cart removal.

Use a small notification such as:

> iPhone 15 Pro removed from cart.

if consistent with current UI patterns.

If removal fails:

- restore/retain line;
- show sanitized error;
- do not lie about success.

## 30.1 Focus After Remove

Keyboard focus must remain logical.

After removing:

- move/retain focus on the next sensible Cart control;
- if last item removed, move focus to Empty Cart heading/primary CTA as appropriate.

---

# 31. Quantity Mutation UX

Quantity changes should feel immediate.

Required:

- no page reload;
- no full Cart skeleton;
- no Header reload;
- no Product Details reload;
- bounded mutation feedback;
- totals update with quantity;
- badge updates;
- server validation still wins.

Optimistic updates are allowed if the current mutation architecture supports safe rollback.

On mutation failure:

- rollback visible quantity/totals;
- announce error;
- preserve current Cart.

---

# 32. Empty Cart

Required final state:

**Your cart is empty**

> Explore our latest electronics and find your next upgrade.

Primary action:

```text
Explore Products
→ /products
```

Requirements:

- polished ElectroHub layout;
- not a blank page;
- current Header/Footer remain;
- no full-screen loader;
- responsive;
- keyboard accessible;
- may reuse current approved motion system without creating new motion language.

---

# 33. Cart Loading States

Use the existing loading philosophy.

## 33.1 Route/Page Shell

Keep current app shell visible:

```text
Header
Main Cart loading content
Footer
```

Do not unnecessarily hide Header/Footer.

## 33.2 Authenticated Cart Initial Load

Use **structural Cart skeletons**, matching:

- Cart row geometry;
- image placeholder;
- Product text blocks;
- quantity control area;
- Order Summary geometry.

Do not show raw `Loading...`.

Do not use a full-page ElectroHub spinner for normal Cart data fetch when the shell can render.

## 33.3 Guest Hydration

Guest localStorage hydration should be near-immediate.

Do not introduce a fake spinner delay.

## 33.4 Background Refetch

If usable Cart data exists:

```text
background refetch
→ keep Cart visible
```

Do not reset to skeleton.

## 33.5 Mutations

Use local/inline feedback only.

Do not replace the entire Cart with a skeleton for:

- add;
- remove;
- quantity change.

---

# 34. Cart Error States

Handle:

- Cart fetch failure;
- Product hydration failure;
- guest validation failure;
- add failure;
- quantity-update failure;
- remove failure;
- reconciliation failure;
- temporary network failure;
- invalid localStorage entry;
- Product deleted/inactive;
- inventory changed.

Requirements:

- sanitized message;
- retry action where sensible;
- no raw backend stack/error;
- preserve recoverable Cart state;
- no false empty state caused by error.

---

# 35. React Query / Cart Cache

Use a stable Cart query-key family consistent with repository conventions.

Conceptually:

```text
cartKeys.all
cartKeys.current()
```

Exact implementation must match existing query-key architecture.

Mutations should target Cart cache only.

Do not broadly invalidate:

- Products;
- Categories;
- Search;
- Reviews;
- Home catalog;
- Product Details;

unless a specific business dependency requires it.

Add to Cart should **not** cause Product Details gallery/specifications/reviews to refetch.

---

# 36. Guest Cart Adapter

Provide one unified Cart interaction surface to UI components.

ProductCard/Product Details should not each implement separate guest/auth logic.

Conceptually:

```text
useCart()
  addItem()
  removeItem()
  setQuantity()
  items
  totalQuantity
  subtotal
  availability
  isGuest
  isLoading
```

Implementation may use another shape if current repo patterns dictate it.

The important rule is:

> Components consume one Cart feature boundary; they do not each know how to reimplement guest storage and authenticated API logic.

Do not turn server Cart state into a second global client store.

---

# 37. Cart API Security

Backend rules are mandatory.

## 37.1 Ownership

Authenticated Cart endpoints derive User from auth middleware.

Do not trust:

```text
userId from request body/query
```

to select another user's Cart.

## 37.2 Quantity Validation

Validate:

- integer;
- positive;
- bounded;
- Product exists;
- Product purchasable;
- current inventory.

Client validation is not security.

## 37.3 Price / Totals

Ignore any frontend-submitted:

- Product price;
- line total;
- subtotal;
- total;
- shipping amount.

Compute on backend/current authoritative data where server Cart is involved.

## 37.4 Guest Validation Endpoint

If a public bulk-validation endpoint is needed:

- accept only public Product IDs + quantities;
- bound list size;
- validate input;
- rate-limit using current API infrastructure where applicable;
- return only public Product/Cart validation data;
- no private User data.

## 37.5 Errors

Do not leak:

- SQL;
- Prisma internals;
- stack traces;
- database IDs unrelated to public DTOs;
- private account data.

---

# 38. Concurrency / Duplicate Protection

Cart operations must remain correct when:

- user double-clicks Add;
- two mutations happen quickly;
- two browser tabs update Cart;
- unique CartItem row already exists;
- guest reconciliation retries.

Use:

- database uniqueness;
- transactional service operations where needed;
- safe upsert/update behavior;
- mutation serialization only where necessary.

Do not create duplicate CartItem rows.

---

# 39. Inventory Relationship

03.2 validates inventory but does not own full Inventory workflow.

Do not:

- decrement stock on Add;
- reserve stock;
- introduce reservation expiration;
- send low-stock admin alerts;
- create purchase restrictions beyond Cart validation.

03.4 and 03.5 own deeper inventory/purchase enforcement.

---

# 40. Performance Requirements

Cart must not reintroduce the latency problems already closed in 03.1.

Required:

- no N+1 Product queries;
- no N+1 Inventory queries;
- bounded Cart response;
- one Cart load should hydrate required Product data efficiently;
- guest validation should be bulk/bounded;
- no request per ProductCard just to render Add to Cart;
- Cart badge should reuse Cart state;
- ProductCard Add must not refetch full catalog;
- Product Details Add must not refetch entire Product page;
- images lazy-load where current standards say so;
- Cart item primary image only;
- background refetch keeps content visible;
- no fake loading delay.

Do not add indexes unless query evidence proves they are needed.

---

# 41. Responsive Requirements

Verify at:

- 390
- 768
- 1440
- 1920

## 41.1 Mobile 390

Cart page must not compress desktop columns.

Required:

- Cart content becomes single-column;
- item content remains readable;
- Product image maintains useful size;
- quantity controls remain touchable;
- Remove remains reachable;
- Order Summary stacks below Cart items;
- primary CTA full-width where appropriate;
- no horizontal overflow;
- Header/Footer remain usable.

Do not shrink Cart row into unreadable desktop geometry.

## 41.2 Tablet 768

Use the layout that best preserves readability:

- stacked Cart + Summary where two-column becomes cramped;
- or a balanced responsive split if current design system safely supports it.

No clipped price/quantity/action controls.

## 41.3 Desktop 1440 / Large 1920

Use two-column intent from Figma:

- Cart list primary column;
- Order Summary secondary column;
- balanced whitespace;
- optional sticky summary if it improves usability and does not conflict with Footer/layout.

A sticky summary is a controlled refinement, not a requirement.

---

# 42. ProductCard Responsive Integration

Adding the Cart button must not:

- break card height consistency;
- push prices out of alignment;
- cause overflow on mobile;
- interfere with hover secondary-image behavior;
- interfere with card-click navigation;
- create layout shift after `Added ✓`.

Verify Home and Products-page ProductCards.

---

# 43. Product Details Responsive Integration

Quantity + Cart actions must:

- remain readable at 390;
- wrap cleanly;
- preserve Product image/gallery space;
- preserve availability;
- preserve tabs/specifications/reviews;
- avoid horizontal overflow;
- keep touch targets usable.

Do not regress 03.1 Product Details.

---

# 44. Accessibility

## 44.1 Quantity Controls

Accessible names:

```text
Decrease quantity for <Product>
Increase quantity for <Product>
```

Expose current value appropriately.

Disabled boundary state must be perceivable.

## 44.2 Remove

Icon-only Remove requires accessible label:

```text
Remove <Product> from cart
```

## 44.3 Cart Badge

Header cart control should announce item count.

Example:

```text
Cart, 3 items
```

## 44.4 Add to Cart

ProductCard button must have a meaningful accessible name.

Success/error feedback should use appropriate live-region behavior without excessive announcements.

## 44.5 Guest Checkout CTA

Do not rely on tooltip-only explanation.

`Sign in to Checkout` is explicit text.

## 44.6 Focus

Verify:

- ProductCard Add;
- Product Details quantity;
- Product Details Add;
- Cart quantity controls;
- Remove;
- Continue shopping;
- Sign in to Checkout / Proceed to Checkout;
- Empty Cart CTA.

## 44.7 Reduced Motion

Respect `prefers-reduced-motion`.

Cart remains fully understandable and usable with motion reduced.

---

# 45. Motion / Advanced UX Interactions

Use the current ElectroHub motion system.

Allowed polished interactions:

- subtle Add-to-Cart button success transition;
- Cart badge count update/pulse;
- Cart item entrance;
- quantity number transition;
- remove collapse/fade after confirmed success;
- Empty Cart transition;
- responsive panel transition.

Rules:

- no huge transforms;
- no bounce-heavy behavior;
- no animation-triggered refetch;
- no component remount solely for animation;
- no layout thrash;
- use transform/opacity;
- reduced-motion fallback.

Motion is enhancement, never a dependency for correctness.

---

# 46. Storybook — Mandatory

Storybook remains the development-only isolated component/state environment.

Required workflow:

```text
Figma Make screenshot
        ↓
Storybook isolated component/state
        ↓
browser/Playwright screenshot
        ↓
visual comparison
        ↓
real page integration
        ↓
E2E verification
```

Use existing:

- global styles;
- 390/768/1440/1920 viewports;
- a11y addon;
- isolated QueryClient conventions;
- deterministic local fixtures.

Stories must not call real APIs by default.

Do not expose Storybook in production routing.

---

# 47. Required Storybook Coverage

Add/update actual components only.

## 47.1 ProductCard

Required states:

- Default + Add to Cart
- Added success state
- Mutation/loading state
- Out of Stock
- Long title
- Discounted Product if currently supported
- No Reviews if currently supported

## 47.2 QuantityStepper

Required:

- Default `1`
- Mid quantity
- Minimum boundary
- Maximum boundary
- Disabled/out-of-stock
- Mutation/loading if component owns that state

## 47.3 CartItem

Required:

- Available
- Quantity >1
- Low stock
- Quantity adjusted warning
- Out of Stock
- Product unavailable/inactive
- Long Product name
- Remove/update loading
- Error/rollback presentation where component owns it

## 47.4 CartSummary

Required:

- Guest valid Cart
- Authenticated valid Cart
- One item
- Multiple items
- Unavailable-item blocked state
- Checkout-not-yet-wired authenticated state if applicable

## 47.5 EmptyCart

- Default
- Mobile
- Desktop

## 47.6 CartSkeleton

Must structurally resemble:

- Cart row(s);
- Order Summary.

## 47.7 Product Details Cart Actions

Required:

- Quantity 1
- Quantity >1
- Maximum stock
- Out of stock
- Added success
- Add mutation loading

## 47.8 HeaderCartBadge

Required:

- 0
- 1
- multiple quantity
- large count convention where current UI supports it

---

# 48. Storybook Fixture Rules

Use deterministic fixtures matching current real DTOs.

Do not fabricate unsupported:

- Product fields;
- checkout state;
- coupon state;
- payment state;
- shipping methods;
- Wishlist behavior.

Storybook Cart fixtures may model Cart states that 03.2 legitimately introduces.

No real API calls by default.

---

# 49. Visual Comparison Workflow

For each supplied Figma Make screenshot:

```text
source screenshot
        ↓
initial implementation
        ↓
Storybook / real route at equivalent viewport
        ↓
browser screenshot
        ↓
manual side-by-side comparison
        ↓
controlled refinement
        ↓
final evidence
```

Do not use huge image-diff tolerance to hide visible mismatches.

---

# 50. Screenshot Evidence Matrix

Final report must include one row per supplied screenshot.

## 50.1 `Cart page.png`

Record:

- source size: `1920 × 907`;
- route: `/cart`;
- state: one-item Cart matching reference as closely as current data allows;
- viewport;
- comparison result:
  - PASS;
  - PASS WITH DOCUMENTED REFINEMENT;
  - FAIL;
- exact differences.

## 50.2 `product details page.png`

Record:

- source size: `1920 × 907`;
- route: current Product Details route;
- state: available Product with quantity/add controls;
- viewport;
- comparison result;
- exact differences.

Do not report a vague `Figma checked`.

---

# 51. Additional Required Screens / States Not Shown in Figma

Design these using current ElectroHub design system:

- multi-item Cart;
- Empty Cart;
- guest Cart;
- authenticated Cart;
- low-stock item;
- out-of-stock item;
- Product no longer available;
- Cart loading skeleton;
- Cart error/retry;
- quantity mutation loading;
- remove mutation loading;
- guest `Sign in to Checkout`;
- authenticated future-Checkout boundary;
- mobile Cart;
- tablet Cart;
- 1440 Cart;
- 1920 Cart;
- merge/reconciliation error;
- price-updated state if implemented;
- ProductCard Added state;
- ProductCard Out of Stock;
- Product Details max-stock state.

These are approved **additional states/screens**, not random redesigns.

---

# 52. Backend Unit / Service Tests

At minimum verify:

1. resolve/create current User Cart;
2. add first Product;
3. same Product does not create duplicate row;
4. repeated Add changes quantity correctly;
5. quantity minimum;
6. invalid zero/negative quantity rejected;
7. non-integer rejected;
8. quantity over current availability rejected/correctly handled;
9. out-of-stock direct Add rejected;
10. inactive Product Add rejected;
11. remove existing item;
12. remove missing item follows current API semantics;
13. update quantity;
14. authoritative current Product price used;
15. subtotal calculation;
16. total calculation;
17. shipping display amount;
18. total-quantity calculation;
19. current User ownership;
20. cannot access another User Cart;
21. current Product/Inventory data returned;
22. no duplicate CartItem after concurrent/repeated Add;
23. guest reconciliation;
24. reconciliation does not duplicate on retry;
25. unavailable guest Product handled;
26. low-stock revalidation;
27. out-of-stock existing Cart line retained/flagged;
28. no inventory decrement on Cart mutation.

---

# 53. API / Integration Tests

Verify current route conventions for:

- GET Cart;
- Add;
- Update quantity;
- Remove;
- guest bulk validation if added;
- reconciliation if added.

Also verify:

- 401 where authenticated endpoint requires auth;
- public guest-validation route remains public if implemented;
- input validation;
- error envelope;
- sanitized errors;
- bounded response;
- Product status enforcement;
- Inventory state;
- totals;
- image/category fields used by Cart UI;
- no private User data.

---

# 54. Frontend Tests

Verify:

- guest localStorage hydration;
- malformed guest state does not crash;
- guest Add;
- duplicate guest Add increments;
- guest Remove;
- guest quantity;
- badge total quantity;
- authenticated Cart query;
- mutation cache update;
- rollback on failure;
- background refetch preserves visible Cart;
- ProductCard button does not navigate;
- ProductCard click still navigates;
- Product Details selected quantity;
- quantity min/max;
- out-of-stock disabled state;
- Cart totals display;
- guest CTA label;
- empty state;
- availability warnings;
- login reconciliation;
- logout source isolation.

---

# 55. E2E / Browser / Playwright Matrix

Use existing Playwright/browser tooling.

Required focused scenarios:

### A — Guest Add from ProductCard

```text
guest
→ Products/Home
→ Add to Cart
→ badge increments
→ no Product Details navigation
```

### B — Guest Add from Product Details

```text
guest
→ Product Details
→ quantity 3
→ Add to Cart
→ Cart has quantity 3
```

### C — Duplicate Add

```text
same Product
→ Add again
→ one Cart row
→ quantity increments
```

### D — Guest Refresh Persistence

```text
guest Cart
→ refresh
→ Cart preserved
→ badge preserved
```

### E — Cart Quantity / Totals

```text
+ / −
→ quantity changes
→ subtotal/total changes
→ badge changes
```

### F — Remove

```text
remove
→ row disappears
→ totals update
→ badge updates
```

### G — Empty Cart

```text
remove last item
→ Empty Cart
→ Explore Products works
```

### H — Low Stock

Requested > available:

- visible warning;
- deterministic adjustment/rejection;
- no silent incorrect total.

### I — Out of Stock

Existing item becomes unavailable:

- row remains;
- visible `Out of stock`;
- checkout intent blocked;
- Remove works.

### J — Guest Checkout Intent

```text
valid guest Cart
→ Sign in to Checkout
→ Login
→ Cart preserved/reconciled
→ return safely
```

### K — Authenticated Cart Persistence

```text
authenticated Cart
→ refresh
→ Cart remains
```

### L — Logout Isolation

```text
authenticated Cart
→ logout
→ server Cart not leaked into guest Cart
```

### M — Header Badge

Verify all mutation paths.

### N — Mutation Failure

Force add/update/remove failure:

- no false success;
- rollback/preserve state;
- usable retry.

### O — Responsive

Verify no horizontal overflow at:

- 390
- 768
- 1440
- 1920

### P — Keyboard

Complete Cart flow without mouse.

### Q — Reduced Motion

Cart remains usable with `prefers-reduced-motion: reduce`.

### R — Checkout Scope Boundary

Prove:

- no payment;
- no order creation;
- no fake Checkout implementation.

---

# 56. Manual QA

Manual verification is still required.

Storybook and automated tests do not replace:

- visual comparison;
- touch/keyboard feel;
- quantity-stepper usability;
- ProductCard interaction feel;
- Cart page balance;
- mobile Cart;
- guest-auth transition;
- Header badge;
- low-stock messaging;
- out-of-stock messaging.

---

# 57. Accessibility Review Checklist

Verify:

- [ ] Add to Cart keyboard reachable
- [ ] ProductCard click and Add button do not conflict
- [ ] quantity controls labeled
- [ ] remove icon labeled
- [ ] badge accessible count
- [ ] guest Checkout CTA explicit
- [ ] no tooltip-only critical information
- [ ] visible focus
- [ ] logical focus after removal
- [ ] live feedback for add/remove/error
- [ ] out-of-stock visible in text
- [ ] no color-only availability meaning
- [ ] touch targets usable
- [ ] reduced-motion supported
- [ ] no horizontal overflow

---

# 58. Performance Review Checklist

Verify:

- [ ] no Product hydration N+1
- [ ] no Inventory N+1
- [ ] no all-catalog fetch for Cart
- [ ] authenticated Cart bounded
- [ ] guest bulk validation bounded
- [ ] ProductCard Add no catalog refetch
- [ ] Product Details Add no page reset
- [ ] badge reuses Cart state
- [ ] background refetch preserves Cart
- [ ] no fake loading delay
- [ ] no Cart mutation full skeleton
- [ ] no new heavy dependency without justification

---

# 59. Security Review Checklist

Verify:

- [ ] Cart ownership derived from auth
- [ ] no request-body `userId` authority
- [ ] quantities server validated
- [ ] Product status server validated
- [ ] inventory server validated
- [ ] price never trusted from frontend
- [ ] totals never trusted from frontend
- [ ] guest localStorage treated as untrusted
- [ ] public validation route bounded
- [ ] no private User fields exposed
- [ ] no cross-user Cart access
- [ ] merge/reconciliation retry safe
- [ ] errors sanitized
- [ ] no open redirect in login return path
- [ ] no payment/address data stored in guest Cart

---

# 60. Database / Migration Review

Expected 03.2 database result:

```text
Cart       reused
CartItem   reused
Product    reused
Inventory  reused

new migration:
probably NONE
```

If schema change is proposed, final handoff must explain:

- why current Cart/CartItem cannot satisfy 03.2;
- exact migration;
- data-loss assessment;
- DEV/PROD application status;
- rollback/forward safety.

Do not casually change foundation schema.

---

# 61. DEV / PROD Rules

If no migration exists:

- no database migration operation is required.

If a legitimate migration is created:

- review exact SQL;
- apply through approved migration workflow;
- verify `_prisma_migrations`;
- never seed PROD.

Cart manual testing may create normal customer Cart data in DEV through the app/API.

Do not seed real customer Cart contents into PROD.

---

# 62. Styling Rules

Reuse existing:

- typography;
- spacing;
- buttons;
- inputs;
- card/border conventions;
- icons;
- colors;
- responsive containers;
- motion primitives;
- focus states.

Do not create parallel global styles.

Where current project uses rectangular/square-corner surfaces, do not reintroduce arbitrary rounded cards solely because an old screenshot differs.

True semantic circles remain appropriate for icon badges/buttons where current design uses them.

---

# 63. Icons

Use the current project icon strategy.

Expected examples:

- Cart
- Trash/remove
- Minus
- Plus
- Check
- Alert/availability where appropriate

Icon-only actions require accessible labels.

Do not add another icon library.

---

# 64. Error / Empty / Edge Cases

Explicitly handle:

## Guest

- no local Cart;
- malformed localStorage;
- duplicated local Product IDs;
- impossible quantity;
- localStorage unavailable;
- Product removed after being stored;
- Product becomes inactive;
- Product becomes out of stock;
- Product stock reduced;
- Product price changed.

## Authenticated

- no Cart row yet;
- empty Cart;
- Cart fetch failure;
- duplicate Add;
- concurrent Add;
- update failure;
- remove failure;
- reconciliation failure;
- session refresh;
- logout;
- login with existing guest Cart;
- login with existing server Cart.

## Product UI

- long name;
- one image;
- broken image;
- low stock;
- zero stock;
- inactive Product;
- max quantity;
- quantity 1.

## Cart UI

- one item;
- many items;
- very high total quantity;
- long Product name;
- large price;
- mixed availability;
- last item removed;
- error during background refetch.

---

# 65. No Random Bug Hunting

TASK 03.2 is already broad.

If unrelated defect is observed:

```text
OUT-OF-SCOPE OBSERVATION
→ record it
→ do not fix it
```

Only fix an unrelated-looking issue when:

- it directly blocks 03.2;
- the smallest safe fix is necessary;
- evidence is documented.

Do not use 03.2 to perform general UI cleanup.

---

# 66. Implementation Order

Recommended sequence:

1. Read AGENTS/task/relevant docs.
2. Inspect supplied Figma Make screenshots.
3. Produce approved-vs-refinement-vs-future-scope matrix.
4. Inspect current Cart/CartItem schema/migrations.
5. Inspect current Auth lifecycle.
6. Inspect Product/Inventory DTOs and APIs.
7. Inspect current ProductCard/Product Details/Header.
8. Define one Cart feature boundary.
9. Implement backend Cart service/API for authenticated customer if not already present.
10. Implement bounded guest Product/availability hydration if needed.
11. Implement guest local persistence.
12. Implement authenticated Cart query/mutations.
13. Implement guest/auth reconciliation.
14. Implement Header badge.
15. Add ProductCard Add to Cart.
16. Add Product Details quantity/Add to Cart.
17. Implement `/cart`.
18. Implement availability/price revalidation states.
19. Implement Empty Cart.
20. Implement loading/error/mutation states.
21. Complete responsive behavior.
22. Complete accessibility/motion.
23. Add/update Storybook stories.
24. Run backend tests.
25. Run frontend tests.
26. Run integration tests.
27. Run Playwright/E2E matrix.
28. Capture screenshot evidence.
29. Perform manual visual/keyboard/responsive QA.
30. Update affected docs.
31. Run final validation.
32. Produce implementation report.
33. Stop before commit/push/merge unless explicitly instructed.

---

# 67. Required Validation Commands

Use current repository scripts.

Expected categories:

- Prisma validation if schema touched;
- Prisma generate if schema/client requires it;
- backend typecheck;
- backend lint;
- backend build;
- frontend typecheck;
- frontend lint;
- frontend build;
- focused backend tests;
- focused frontend tests;
- Cart API/integration tests;
- Storybook build;
- Storybook a11y review;
- Playwright focused Cart E2E;
- real localhost manual verification;
- `git diff --check`.

Do not invent passing evidence for commands that could not run.

If a tool/environment fails, report exact reason.

---

# 68. Storybook Production Isolation

Storybook remains development-only.

03.2 must not:

- import Storybook into production app entry;
- expose Storybook via customer routing;
- ship `storybook-static` as customer application content;
- depend on Storybook-only fixtures at runtime.

---

# 69. Documentation Updates

Update only docs materially affected by final implementation.

Likely:

- Cart feature documentation;
- Cart API documentation;
- Product/Product Details UI docs if Cart actions are documented there;
- state/query-key docs;
- Authentication docs for guest→auth Cart reconciliation if architecture changes;
- database docs only if schema changes;
- testing/E2E docs;
- Storybook docs where new Cart states are added;
- accessibility notes;
- performance notes;
- roadmap/task completion status;
- TASK 03.2 implementation report.

Docs must describe what actually shipped.

---

# 70. Definition of Done — Functional

- [ ] guest can Add from ProductCard
- [ ] guest can Add selected quantity from Product Details
- [ ] guest Cart persists refresh
- [ ] authenticated Cart persists
- [ ] duplicate Product does not create duplicate line
- [ ] Remove works
- [ ] quantity works
- [ ] quantity min works
- [ ] quantity max works
- [ ] totals update
- [ ] authoritative price used
- [ ] availability validated
- [ ] low-stock state handled
- [ ] out-of-stock state handled
- [ ] unavailable Product not silently deleted
- [ ] Header badge correct
- [ ] Empty Cart implemented
- [ ] guest `Sign in to Checkout` works
- [ ] guest/auth reconciliation works
- [ ] logout does not leak Cart
- [ ] no stock reservation/decrement

---

# 71. Definition of Done — UI / Figma

- [ ] `Cart page.png` inspected before implementation
- [ ] `product details page.png` inspected before implementation
- [ ] Cart page follows Figma starting layout
- [ ] Product Details action region follows Figma
- [ ] current Header/Footer not regressed
- [ ] ProductCard current design preserved
- [ ] multi-item state polished
- [ ] Empty Cart polished
- [ ] low/out-of-stock states polished
- [ ] loading/error states polished
- [ ] 390 verified
- [ ] 768 verified
- [ ] 1440 verified
- [ ] 1920 verified
- [ ] no horizontal overflow
- [ ] controlled refinements documented
- [ ] Figma prototype overlay absent

---

# 72. Definition of Done — Storybook

- [ ] ProductCard Cart states
- [ ] QuantityStepper states
- [ ] CartItem states
- [ ] CartSummary states
- [ ] EmptyCart
- [ ] CartSkeleton
- [ ] Product Details Cart actions
- [ ] Header Cart badge
- [ ] deterministic fixtures
- [ ] no default real API
- [ ] a11y addon reviewed
- [ ] reduced-motion states checked
- [ ] Storybook production isolation preserved

---

# 73. Definition of Done — Testing

- [ ] backend service tests
- [ ] API tests
- [ ] quantity boundary tests
- [ ] availability tests
- [ ] totals tests
- [ ] ownership/security tests
- [ ] guest storage tests
- [ ] reconciliation tests
- [ ] frontend Cart tests
- [ ] ProductCard interaction tests
- [ ] Product Details Cart tests
- [ ] Header badge tests
- [ ] focused Playwright/E2E matrix
- [ ] manual localhost verification
- [ ] `git diff --check`

---

# 74. Definition of Done — Security / Integrity

- [ ] no client-authoritative price
- [ ] no client-authoritative total
- [ ] no cross-user Cart access
- [ ] no Cart User ID spoofing
- [ ] no malformed quantity acceptance
- [ ] no duplicate CartItem
- [ ] no guest storage sensitive data
- [ ] no open redirect
- [ ] no inventory decrement
- [ ] reconciliation retry safe
- [ ] errors sanitized

---

# 75. Rejection Criteria

TASK 03.2 must be rejected if any of these remain:

- guest forced to login merely to Add to Cart;
- guest Cart lost on normal refresh;
- authenticated Cart lost on refresh;
- duplicate rows for same Product;
- quantity can become `0` or negative;
- quantity exceeds stock without visible/validated handling;
- Product price accepted from frontend as authority;
- Cart totals trusted from frontend;
- out-of-stock item silently deleted;
- Checkout allowed with known unavailable item;
- guest Checkout action is disabled only with tooltip and no actionable sign-in path;
- ProductCard Add navigates to Product Details;
- Add mutation causes full Product page/grid reload;
- Cart mutation causes full-page skeleton;
- cross-user Cart access possible;
- logout leaks User Cart into guest session;
- login destroys guest Cart;
- merge duplicates/inflates on retry;
- Cart page has horizontal overflow;
- current Header/Footer regressed to stale screenshot version;
- Storybook-only behavior differs from real app;
- no real-page integration evidence;
- future Checkout/Stripe/Order behavior implemented inside 03.2;
- fake loading delays;
- raw backend errors exposed.

---

# 76. Final Implementation Handoff Format

Final implementation report must include:

```text
# TASK 03.2 — SHOPPING CART IMPLEMENTATION REPORT

BRANCH:
feature/Shopping-Cart

STATUS:
COMPLETE / PARTIAL / BLOCKED

DOCS READ:
- ...

DOCS UPDATED:
- ...

FIGMA SOURCES:
- Cart page.png — 1920x907
- product details page.png — 1920x907

FIGMA CLASSIFICATION:
Approved/in-scope:
- ...

Controlled refinements:
- ...

Future-scope visual-only:
- ...

ARCHITECTURE:
Guest Cart:
<implementation>

Authenticated Cart:
<implementation>

Guest/Auth reconciliation:
<implementation + retry/idempotency behavior>

DATABASE:
Cart/CartItem reused:
YES / NO

Migration required:
NO / YES — details

API:
GET Cart:
PASS / N/A
Add:
PASS / FAIL
Update quantity:
PASS / FAIL
Remove:
PASS / FAIL
Guest validation:
PASS / N/A
Reconciliation:
PASS / N/A

GUEST CART:
Add:
PASS / FAIL
Persistence:
PASS / FAIL
Refresh:
PASS / FAIL
Malformed storage:
PASS / FAIL

AUTH CART:
Persistence:
PASS / FAIL
Ownership:
PASS / FAIL
Refresh:
PASS / FAIL

PRODUCT CARD:
Add to Cart:
PASS / FAIL
Does not navigate:
PASS / FAIL
Out of stock:
PASS / FAIL
Added state:
PASS / FAIL

PRODUCT DETAILS:
Quantity:
PASS / FAIL
Min:
PASS / FAIL
Max:
PASS / FAIL
Add selected quantity:
PASS / FAIL
Out of stock:
PASS / FAIL

CART PAGE:
Available:
PASS / FAIL
Multiple items:
PASS / FAIL
Remove:
PASS / FAIL
Quantity:
PASS / FAIL
Totals:
PASS / FAIL
Empty state:
PASS / FAIL
Loading:
PASS / FAIL
Error:
PASS / FAIL

AVAILABILITY:
Low stock:
PASS / FAIL
Out of stock:
PASS / FAIL
Inactive Product:
PASS / FAIL
Price refresh:
PASS / FAIL

HEADER BADGE:
PASS / FAIL
Uses total quantity:
YES / NO

CHECKOUT BOUNDARY:
Guest Sign in to Checkout:
PASS / FAIL
Actual 03.5 Checkout implemented:
NO

RESPONSIVE:
390:
PASS / FAIL
768:
PASS / FAIL
1440:
PASS / FAIL
1920:
PASS / FAIL

ACCESSIBILITY:
PASS / FAIL

REDUCED MOTION:
PASS / FAIL

STORYBOOK:
PASS / FAIL
Stories:
<count/list>
A11y:
PASS / FAIL

BACKEND TESTS:
PASS / FAIL — count

FRONTEND TESTS:
PASS / FAIL — count

API/INTEGRATION TESTS:
PASS / FAIL — count

PLAYWRIGHT:
PASS / FAIL — count

TYPECHECK:
Backend PASS / FAIL
Frontend PASS / FAIL

LINT:
Backend PASS / FAIL
Frontend PASS / FAIL

BUILD:
Backend PASS / FAIL
Frontend PASS / FAIL

git diff --check:
PASS / FAIL

FIGMA EVIDENCE:
Cart page.png:
PASS / PASS WITH REFINEMENT / FAIL

product details page.png:
PASS / PASS WITH REFINEMENT / FAIL

FIGMA REFINEMENTS:
NONE
OR
- element / source / change / reason / result

OUT-OF-SCOPE OBSERVATIONS:
NONE
OR
- ...

REMAINING BLOCKERS:
NONE
OR
- ...

READY FOR ARCHITECT REVIEW:
YES / NO
```

---

# 77. Final Architecture Principles

> **Guest customers can build a Cart without authentication.**

> **Authenticated customers use the server-backed Cart foundation.**

> **Guest Cart storage preserves only Product identity and quantity; Product/price/availability truth comes from the backend.**

> **Adding the same Product changes quantity; it never creates a duplicate line.**

> **Cart does not reserve or decrement stock.**

> **Availability is revalidated because inventory can change after Add.**

> **Out-of-stock Products remain visible and recoverable; they are not silently removed.**

> **Header badge represents total quantity.**

> **Guest Checkout intent is an actionable `Sign in to Checkout`, not a disabled button with tooltip-only explanation.**

> **03.2 does not secretly implement 03.5 Checkout.**

> **Figma Make screenshots define the starting visual direction; controlled documented refinements complete the missing real-world states.**

> **Current app-shell decisions override stale Header/Footer details visible in screenshots.**

> **Storybook proves isolated components/states; browser/Playwright proves the integrated application.**

> **The task is complete only when behavior, persistence, availability, totals, security, responsive UI, accessibility, tests, documentation, and visual evidence agree.**

---

# 78. Stop Conditions

Stop and report instead of improvising if:

- current Cart schema materially differs from foundation docs;
- safe authenticated Cart ownership cannot be established;
- migration would require destructive Product/User/Cart changes;
- current Inventory model cannot provide availability without a broader 03.4 redesign;
- supplied screenshots are unavailable and exact visual comparison is required;
- Auth redirect/reconciliation cannot be made safe without changing unrelated Authentication architecture;
- environment prevents required verification.

Do not solve a blocker by expanding into Checkout, Inventory reservations, Payment, Orders, or another roadmap task.

---

# 79. Completion Gate

TASK 03.2 may be submitted for architect review only when:

```text
FUNCTIONAL CART
        +
GUEST PERSISTENCE
        +
AUTHENTICATED PERSISTENCE
        +
SAFE RECONCILIATION
        +
AUTHORITATIVE PRICE/TOTALS
        +
AVAILABILITY VALIDATION
        +
PRODUCTCARD INTEGRATION
        +
PRODUCT DETAILS INTEGRATION
        +
HEADER BADGE
        +
CART PAGE
        +
EMPTY/LOADING/ERROR STATES
        +
RESPONSIVE
        +
ACCESSIBILITY
        +
STORYBOOK
        +
AUTOMATED TESTS
        +
PLAYWRIGHT
        +
MANUAL QA
        +
FIGMA EVIDENCE
        +
DOCS
        =
READY FOR ARCHITECT REVIEW
```

No self-approval.

Do not commit, push, or merge unless explicitly instructed by the project owner.
