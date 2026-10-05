# Inventory

## Task 03.4A — implemented customer/core boundary

Customer status is derived from current `quantity` and `lowStockAt`, not the persisted status enum: zero is OUT_OF_STOCK, positive quantity at/below threshold is LOW_STOCK, otherwise IN_STOCK. Invalid/missing Inventory has null stock status and is unavailable, not genuine Out of Stock. Threshold zero is supported. Stored status remains compatible and internal writes synchronize it.

`apps/backend/src/services/inventory.service.ts` owns snapshots, purchase validation, and internal set/increase/decrease primitives. Inputs are integers within PostgreSQL's signed integer range; set accepts zero, deltas must be positive. A transaction locks the unique Product Inventory row with `FOR UPDATE`, guards the locked quantity/threshold on update, rejects underflow/overflow, and writes quantity/status together. Existing transaction clients are accepted without nesting. There is no customer or Admin stock-write route.

Product/Search DTOs add `stockStatus`, `availableQuantity`, and `purchasable`; existing binary `availability`, Decimal price strings, bounded images, grouped reviews, and visibility rules remain. Cart stock status is separate from Cart line `LOW_STOCK`, which still means requested quantity exceeds availability. Cart quantities remain unchanged until explicit correction. Cart/Wishlist never reserve or write Inventory. Saved out-of-stock Products remain navigable/removable.

The existing StatusBadge presents success/warning/error states and compact low-stock feedback. Product Details uses remaining stock minus Cart quantity, resets invalid transient selection to one, and retains cached content/gallery state during background refresh. Shared ProductCard adapters cover Home, Products, Search, related Products and Wishlist without extra Inventory requests or polling.

The owner-supplied Gemini live gate reports `20261005000000_inventory_nonnegative` applied on DEV (`pzxekjybdiulzmssalfo`) and PROD (`yepfgjehdstlxbpespun`), 11/11 migrations on both, both physical CHECK constraints passing, no schema drift, authenticated DEV Cart/Wishlist checks passing, and one-success/one-`INVENTORY_CONFLICT` last-unit concurrency with final quantity zero. This is external live evidence, not a local Codex database test; the two local PostgreSQL tests remain SKIPPED because `INVENTORY_TEST_DATABASE_URL` was not configured. After that Gemini gate, `CartService.setQuantity` was changed to allow a genuine reduction of an existing Cart line without requiring the reduced quantity to fit stock. The service source fingerprint therefore changed: authenticated Cart quantity-correction evidence is stale and requires the targeted DEV re-gate documented in the [handoff](../06_Database/TASK_03.4A_INVENTORY_HANDOFF.md). No migration or PROD re-verification is required for this service-only correction, and no database operation was performed by Codex. See the [evidence matrices and source fingerprint](../tasks/Phase-03/TASK_03.4A_IMPLEMENTATION_EVIDENCE.md). The Checkout, Orders, alerts and Admin workflows described below remain future architecture, not implemented 03.4A features.

## 1. Purpose

This document defines the inventory management system for ElectroHub.

Inventory controls product availability across:

- Product catalog.
- Cart.
- Checkout.
- Orders.
- Administration.
- Delivery workflows.

The backend and database are authoritative for inventory state.

---

## 2. Inventory Model

Inventory is associated with a product.

Conceptually:

```text
Product
 ↓
Inventory Quantity
 ↓
Availability State
```

Relevant information may include:

```text
Product ID
Quantity
Low-Stock Threshold
Updated At
```

The exact schema is defined by Prisma and documented in `docs/06_Database/`.

---

## 3. Availability States

Customers may see:

```text
In Stock
Low Stock
Out of Stock
```

Conceptually:

```text
Quantity > Low-Stock Threshold
        ↓
In Stock

0 < Quantity <= Low-Stock Threshold
        ↓
Low Stock

Quantity = 0
        ↓
Out of Stock
```

The exact threshold is configurable.

---

## 4. Customer Workflow

Customers can see current availability on:

```text
Product Details
Product Cards
Search Results
Cart
Checkout
```

Availability shown in the UI is informational.

The backend must revalidate inventory before allowing an order.

---

## 5. Add to Cart

When a customer adds a product:

```text
Product
 ↓
Backend Validation
 ↓
Inventory Check
 ↓
Cart Item
```

The system must reject quantities that exceed the currently available inventory where applicable.

Adding an item to a cart does not permanently reserve inventory unless an explicit reservation mechanism is implemented.

---

## 6. Cart Quantity Changes

When a customer changes quantity:

```text
Requested Quantity
 ↓
Backend
 ↓
Inventory Validation
 ↓
Cart Updated
```

Invalid quantities must be rejected.

The frontend may prevent obviously invalid values, but backend validation is mandatory.

---

## 7. Checkout Validation

Inventory is revalidated during checkout.

```text
Checkout
 ↓
Load Cart
 ↓
Validate Products
 ↓
Validate Quantities
 ↓
Validate Inventory
 ↓
Continue Payment / Order
```

This prevents stale cart state from creating invalid orders.

---

## 8. Inventory and Order Creation

Inventory changes must be coordinated with order creation.

Where concurrency is possible, the implementation should use an appropriate database transaction or concurrency-control strategy.

Conceptually:

```text
Validate Inventory
 ↓
Create Order
 ↓
Update Inventory
 ↓
Commit
```

The exact transaction boundary must follow the database architecture.

---

## 9. Preventing Overselling

The system must protect against two customers purchasing the last available unit simultaneously.

The implementation should use appropriate database-level consistency controls.

Possible approaches include:

```text
Atomic Inventory Update
Database Transaction
Conditional Update
Concurrency Control
```

The selected approach must be documented if it materially affects the architecture.

---

## 10. Inventory Decrease

Inventory is decreased when a successful purchase is finalized according to the approved order/payment flow.

The system must avoid decreasing inventory multiple times for the same order.

Idempotent order/payment handling is required where repeated requests are possible.

---

## 11. Inventory Restoration

If the business workflow supports cancellation or refund-related restoration, inventory may be returned according to the approved order policy.

Example:

```text
Order Cancelled
 ↓
Eligible for Restoration
 ↓
Inventory Increased
```

Inventory must not be restored multiple times for the same event.

---

## 12. Low-Stock Alerts

Administrators should receive a low-stock warning when inventory reaches the configured threshold.

Example:

```text
Quantity <= Threshold
        ↓
Low Stock Event
        ↓
Admin Notification / Dashboard Warning
```

The exact notification mechanism follows the operations and admin architecture.

---

## 13. Admin Workflow

Administrators can:

- View inventory.
- Update product quantities.
- Restock products.
- Review low-stock products.
- Review out-of-stock products.

All inventory modifications require server-side administrator authorization.

---

## 14. Inventory Adjustment

Administrative inventory changes should be validated.

Examples:

```text
Restock
Manual Adjustment
Correction
```

Where useful, inventory adjustments should record:

```text
Administrator
Previous Quantity
New Quantity
Reason
Timestamp
```

This provides traceability for important stock changes.

---

## 15. Product Availability

Inventory controls whether a product can be purchased.

```text
Active + Available
        ↓
Purchasable

Active + Out of Stock
        ↓
Not Purchasable

Inactive
        ↓
Not Purchasable
```

The backend must enforce purchasability.

---

## 16. Inventory and Recommendations

Recommendation results should consider availability where appropriate.

Out-of-stock products should not normally be prioritized as purchasable recommendations.

Inventory validation remains authoritative at checkout.

---

## 17. Inventory and Search

Search results may display availability.

Examples:

```text
In Stock
Low Stock
Out of Stock
```

Search availability must reflect backend data and must not be treated as a reservation.

---

## 18. Inventory and Cart

The cart can contain a product that later becomes unavailable.

Therefore, checkout must always revalidate:

```text
Product Status
Current Price
Requested Quantity
Inventory
```

The customer should receive a clear adjustment message if the cart is no longer valid.

---

## 19. API

Typical endpoints may include:

```text
GET   /api/products/:id/inventory
PATCH /api/admin/products/:id/inventory
```

Inventory may also be updated internally by order services rather than through a public endpoint.

The exact API contract follows the backend implementation.

---

## 20. Security

Inventory management must enforce:

- Administrator authentication.
- Administrator authorization.
- Input validation.
- Server-side quantity validation.
- Ownership of administrative operations.
- Auditability where required.

Customers must never be allowed to modify inventory.

---

## 21. Performance

Inventory operations should:

- Use efficient database queries.
- Avoid unnecessary inventory reads.
- Use appropriate indexes.
- Keep transaction scopes focused.
- Avoid race conditions.

Inventory correctness takes priority over premature optimization.

---

## 22. Real-Time Updates

Where Socket.IO is used, inventory-related UI updates may be communicated to relevant clients when required.

Example:

```text
Inventory Changed
 ↓
Backend Event
 ↓
Socket.IO
 ↓
Relevant UI
```

Real-time information is informational; checkout still performs authoritative validation.

---

## 23. Testing

Inventory testing should cover:

```text
In Stock
Low Stock
Out of Stock
Add to Cart
Quantity Update
Checkout Validation
Successful Purchase
Insufficient Inventory
Concurrent Purchase
Inventory Decrease
Inventory Restoration
Low-Stock Threshold
Admin Restock
Unauthorized Update
Duplicate Inventory Update
```

Concurrency-sensitive behavior should be tested explicitly where practical.

---

## 24. Definition of Done

Inventory is complete when:

- Product quantities are stored correctly.
- Availability states work.
- Customers can see availability.
- Cart quantities are validated.
- Checkout revalidates inventory.
- Successful orders update inventory correctly.
- Overselling is protected against.
- Low-stock behavior works.
- Admin inventory management works.
- Authorization is enforced.
- Duplicate updates are prevented.
- Tests pass.
- Documentation matches implementation.

---

## 25. Inventory Principle

> **Inventory is authoritative server-side state; customer-facing availability is informational, while every purchase must perform final inventory validation with concurrency-safe updates.**
