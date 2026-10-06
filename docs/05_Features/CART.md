# Cart

## Task 03.5 Checkout integration

Authenticated valid Cart now opens `/checkout`; guest checkout uses the existing auth modal with a validated Checkout return path. Cart DTO adds a server economic `revision` (identity/items/quantities/prices/delivery config, not stock). Add/update/remove/reconcile share the Cart-row lock with Order creation. CartProvider remains the sole Cart authority and exposes its existing queue for checkout: cancel stale reads, submit, then install the authoritative Cart response before Confirmation navigation. No Cart operation itself reserves/decrements Inventory. Earlier 03.2 deferred-CTA statements below are historical and superseded by this section. See [implemented contract](CHECKOUT_CORE_03.5.md).

## Task 03.4A Inventory compatibility

Each Cart line adds nullable `stockStatus` derived from quantity/threshold. This is independent of line `availability: LOW_STOCK` (requested quantity exceeds current stock). Missing/invalid Inventory is UNAVAILABLE; valid zero stock is OUT_OF_STOCK. Reads preserve invalid quantities and removable rows; no silent adjustment/deletion. Additions and quantity updates are validated on the server. A strict reduction is a corrective Cart operation: the service compares the requested final quantity with the persisted Cart quantity, still requires the owned line, active Product/category, valid Inventory, and a positive bounded quantity, but does not require the reduced quantity to fit current stock. Equal-quantity updates and increases retain full stock validation. Checkout remains blocked until all lines are valid. Cart operations never update Inventory. See [Inventory](INVENTORY.md).

## Task 03.2 — Current Cart Contract

Cart is available to guests and authenticated customers. The current implementation uses one frontend Cart feature boundary: guests persist only `{productId, quantity}` in versioned `electrohub.cart.v1` local storage, while authenticated customers use the existing React Query client and a server Cart scoped to the authenticated user ID. Prices, stock, Product status, images, and totals are never trusted from guest storage or request bodies. This section describes implemented 03.2 behavior; later checkout sections below are future architecture, not a live checkout promise.

### API

- `POST /api/cart/validate` accepts `{items: [{productId, quantity}]}` for bounded public guest hydration; it never exposes private User data.
- `GET /api/cart` returns the authenticated customer's current Cart.
- `POST /api/cart/items` adds `{productId, quantity}` and returns the updated Cart (`201`).
- `PATCH /api/cart/items/:productId` sets `{quantity}` and returns the updated Cart.
- `DELETE /api/cart/items/:productId` removes a line and returns the updated Cart.
- `POST /api/cart/reconcile` merges bounded guest items and returns the updated Cart.
- Successful responses use `{data: Cart}`. Errors use the existing sanitized `{error: {code, message}}` envelope. Mutations require an authenticated `CUSTOMER`; the client cannot select a User Cart by ID.

Cart inputs permit at most 50 distinct lines and 999 units per line, additionally limited by stock. Server reads preserve known unavailable lines. Cart DTO lines include current Product name, slug, category, image, price, requested quantity, stock, availability, and line total; the Cart includes total quantity, Decimal-derived subtotal, `0.00` shipping, total, and a checkout-eligibility flag. No Review, full specification, or private User relation is returned.

### Merge and availability

When a Product exists in both carts, reconciliation uses `max(serverQuantity, guestQuantity)`, not addition. The transaction is retry-safe and never duplicates a line. Guest storage is cleared only after a confirmed successful merge. On failure the guest items remain recoverable and the Cart offers Retry or removal of pending saved items. Logout retains the server Cart but does not copy it into guest storage.

Cart does not reserve or decrement inventory. A line whose requested quantity now exceeds stock remains visible and blocks checkout intent until corrected. Out-of-stock, inactive, and missing Products remain visible where possible and can be removed. Price is always read from the current Product. The Header badge counts units, not lines.
Quantity controls update the visible line, totals, and Header badge immediately while the affected line is pending; a rejected server validation restores the last confirmed Cart. Other lines remain interactive. If reconciliation returns an error after a possible commit, the client confirms the user-scoped server Cart before reporting a failed merge or clearing guest storage.
If a background Cart revalidation fails, cached rows remain visible with a retry warning, while the guest checkout-intent action stays disabled until current availability is confirmed.

Task 03.2 does not create Checkout, payment, orders, Wishlist persistence, migrations, or seed data. Guest checkout intent opens the existing sign-in flow and returns to `/cart`; the authenticated Checkout CTA is visibly deferred until Task 03.5 supplies a real route.

---

## 1. Purpose

This document defines the shopping-cart functionality for ElectroHub.

The cart allows customers to:

- Add products.
- View selected products.
- Change quantities.
- Remove products.
- Review totals.
- Proceed to checkout.

The backend is the authoritative source for cart data.

---

## 2. Cart Architecture

```text
Customer
 ↓
React Cart UI
 ↓
Custom Cart Hook
 ↓
React Query
 ↓
Cart API
 ↓
Backend Service
 ↓
Prisma
 ↓
Supabase PostgreSQL
```

The frontend may provide immediate interaction feedback, but the backend remains authoritative.

---

## 3. Cart Ownership

An authenticated cart belongs to one authenticated customer. Guest carts are local to the browser.

The backend must verify:

```text
Authenticated User
        ↓
Owns Cart
        ↓
Allowed Operation
```

A customer must never be able to access another customer's cart by changing an identifier.

---

## 4. Adding Products

The customer can add an available product to the cart.

Flow:

```text
Product Page
 ↓
Quantity Selection
 ↓
Add to Cart
 ↓
Backend Validation
 ↓
Cart Updated
```

The backend must validate:

- Product existence.
- Product availability.
- Requested quantity.
- Inventory constraints.

---

## 5. Cart Item

A cart item represents a product and requested quantity.

Conceptually:

```text
Product
+
Quantity
```

The cart should not duplicate unnecessary product information.

Current product data can be resolved from the product record.

---

## 6. Quantity Updates

Customers can increase or decrease quantities. The backend compares the requested final quantity with the persisted Cart quantity inside its transaction; it does not trust a client-supplied operation type.

Every update requires an existing owned Cart line, an existing active Product/category, valid Inventory, and a positive quantity within the Cart limit. Increases and equal-quantity updates also require the requested quantity to fit current stock. A strict decrease may correct an existing line after stock drops, even when the resulting requested quantity still exceeds stock. This only corrects Cart intent: it does not reserve or mutate Inventory, and it does not make the Cart eligible for checkout.

The UI should prevent obviously invalid actions, but backend validation remains mandatory.

---

## 7. Removing Items

Customers can remove individual products from their cart.

The operation must verify:

```text
Authenticated User
+
Cart Ownership
+
Cart Item Ownership
```

Successful removal should update the cart state shown to the customer.

---

## 8. Cart Totals

The cart may display:

```text
Subtotal
Shipping
Discounts where applicable
Total
```

The frontend may calculate display-only estimates, but final order totals must be calculated and validated by the backend.

The client must never be trusted as the authoritative source for payment amounts.

---

## 9. Pricing

Product prices may change after an item is added to the cart.

At checkout, the backend must revalidate:

```text
Current Product Price
Product Availability
Quantity
Applicable Pricing Rules
```

The customer must not be able to manipulate the final price through frontend state.

---

## 10. Inventory

Cart quantity does not permanently reserve inventory unless explicitly implemented.

At checkout:

```text
Cart
 ↓
Inventory Validation
 ↓
Sufficient Stock?
 ├── Yes → Continue
 └── No  → Reject / Request Adjustment
```

This prevents purchasing unavailable inventory.

---

## 11. Checkout Integration

The cart is the starting point for checkout.

```text
Cart Review
 ↓
Shipping Information
 ↓
Payment
 ↓
Order Creation
```

Before creating an order, the backend validates the cart again.

---

## 12. Empty Cart

When no items exist, display a dedicated empty state.

Example:

```text
Your cart is empty.
Explore our electronics and add something you like.
```

Useful actions may include:

```text
Browse Products
Browse Categories
Search Products
```

---

## 13. Loading State

Cart operations should provide appropriate feedback.

Examples:

```text
Loading Cart
Updating Quantity
Removing Item
Adding Item
```

The UI should prevent accidental duplicate actions where appropriate.

---

## 14. Error Handling

Possible cart errors include:

```text
Product Not Found
Product Out of Stock
Insufficient Inventory
Invalid Quantity
Cart Not Found
Unauthorized
Network Failure
```

Errors should be displayed using safe, user-friendly messages.

Raw backend or database errors must never be shown directly.

---

## 15. React Query

Cart data is server state and should use React Query.

Typical queries/mutations include:

```text
useCart()
useAddToCart()
useUpdateCartItem()
useRemoveFromCart()
```

After mutations, affected cart queries should be updated or invalidated deliberately.

---

## 16. Optimistic Updates

Optimistic updates may be used for low-risk cart interactions such as quantity changes.

If used, the implementation must support rollback when the backend rejects the operation.

Do not treat optimistic UI state as authoritative.

---

## 17. Persistence

Cart persistence should follow the approved backend architecture.

For authenticated users:

```text
User
 ↓
Backend Cart
 ↓
Database
```

The cart should survive normal navigation and authenticated sessions.

---

## 18. Authentication

Cart operations require authentication unless an explicitly approved guest-cart strategy is implemented.

Protected cart operations must verify the authenticated user server-side.

---

## 19. API

Typical endpoints may include:

```text
GET    /api/cart
POST   /api/cart/items
PATCH  /api/cart/items/:id
DELETE /api/cart/items/:id
```

The exact API contract follows the backend implementation and `API_GUIDELINES.md`.

---

## 20. Security

Cart operations must enforce:

- Authentication.
- Cart ownership.
- Product validation.
- Quantity validation.
- Server-side price validation.
- Inventory validation.

The frontend must never be treated as the security boundary.

---

## 21. Performance

Cart operations should:

- Return only required data.
- Avoid unnecessary database queries.
- Use efficient Prisma relations.
- Avoid repeated full-cart refetches when a precise cache update is possible.

Cart data should remain small enough for efficient normal operation.

---

## 22. Accessibility

The cart must support:

- Keyboard navigation.
- Accessible quantity controls.
- Accessible remove actions.
- Clear product names.
- Visible focus states.
- Screen-reader-friendly updates.
- Clear error feedback.

Quantity controls must have meaningful accessible labels.

---

## 23. Responsive Design

The cart must work across:

```text
Mobile
Tablet
Desktop
```

Mobile layouts should prioritize:

```text
Product
Quantity
Price
Remove
Checkout
```

without creating difficult horizontal scrolling.

---

## 24. Localization and RTL

The cart supports:

```text
English
Arabic / RTL
```

Currency and number formatting must follow the application's localization strategy.

Layout should use logical directional properties where appropriate.

---

## 25. Testing

Cart testing should cover:

```text
Add Product
Add Invalid Product
Update Quantity
Remove Product
Empty Cart
Multiple Items
Insufficient Inventory
Price Change
Unauthorized Access
Cart Persistence
Checkout Transition
Network Failure
Mobile Layout
RTL Layout
```

Critical cart workflows should also be covered through E2E tests.

---

## 26. Definition of Done

Cart functionality is complete when:

- Products can be added.
- Quantities can be changed.
- Items can be removed.
- Cart totals are displayed.
- Cart persistence works.
- Inventory is revalidated.
- Prices are revalidated at checkout.
- Ownership is enforced.
- Loading/error/empty states exist.
- Accessibility is verified.
- Responsive behavior is verified.
- RTL/localization is verified.
- Tests pass.
- Documentation matches implementation.

---

## 27. Cart Principle

> **The cart provides a convenient customer experience, but the backend remains authoritative for ownership, pricing, inventory, and checkout validation.**
