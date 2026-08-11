# Cart

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

A cart belongs to an authenticated customer.

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

Customers can increase or decrease quantities.

The backend must revalidate:

```text
Product Exists
Product Is Purchasable
Quantity Is Valid
Inventory Is Sufficient
```

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
