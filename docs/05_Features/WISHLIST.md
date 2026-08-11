# Wishlist

## 1. Purpose

This document defines the wishlist functionality for ElectroHub.

The wishlist allows authenticated customers to save products for later.

Customers can:

- Add products.
- Remove products.
- View saved products.
- Open product details.
- Move products toward the cart workflow.

---

## 2. Wishlist Architecture

```text
Customer
 ↓
React Wishlist UI
 ↓
Wishlist Hook
 ↓
React Query
 ↓
Wishlist API
 ↓
Backend Service
 ↓
Prisma
 ↓
Supabase PostgreSQL
```

The backend is authoritative for wishlist ownership and contents.

---

## 3. Wishlist Ownership

Each wishlist belongs to an authenticated customer.

The backend must verify:

```text
Authenticated User
        ↓
Owns Wishlist
        ↓
Allowed Operation
```

A customer must never access another user's wishlist.

---

## 4. Adding a Product

The customer can add a product from:

```text
Product Details
Product Card
Search Results
Recommendations
```

Flow:

```text
Product
 ↓
Wishlist Action
 ↓
Backend Validation
 ↓
Wishlist Updated
 ↓
React Query Cache
 ↓
UI
```

The backend must verify that the product exists.

---

## 5. Removing a Product

Customers can remove products from their wishlist.

The operation must verify:

```text
Authentication
+
Wishlist Ownership
+
Product / Wishlist Relationship
```

The UI should update immediately after successful confirmation.

---

## 6. Duplicate Prevention

A product should not appear multiple times in the same customer's wishlist.

The database should enforce uniqueness where appropriate.

Conceptually:

```text
Unique(User, Product)
```

This prevents duplicate wishlist records even when multiple requests occur.

---

## 7. Product Availability

Wishlist products may become:

```text
In Stock
Low Stock
Out of Stock
Unavailable
```

The wishlist should display current product information and availability where appropriate.

A wishlist entry does not reserve inventory.

---

## 8. Price Changes

Product prices may change while an item remains in the wishlist.

The wishlist should display current product information rather than treating the saved item as a price reservation.

The backend must remain authoritative for current pricing.

---

## 9. Move to Cart

Where implemented, customers can move a wishlist product to the cart.

Flow:

```text
Wishlist
 ↓
Add to Cart
 ↓
Inventory Validation
 ↓
Cart Updated
 ↓
Optional Wishlist Removal
```

The system should clearly define whether the product remains in the wishlist or is removed after the operation.

---

## 10. Empty Wishlist

When the wishlist contains no products, show a dedicated empty state.

Example:

```text
Your wishlist is empty.
Save products you love and find them here later.
```

Useful actions may include:

```text
Browse Products
Browse Categories
Search
```

---

## 11. Loading State

The wishlist should provide feedback for:

```text
Loading Wishlist
Adding Product
Removing Product
Moving Product to Cart
```

Duplicate actions should be prevented where necessary.

---

## 12. Error Handling

Possible errors include:

```text
Unauthorized
Product Not Found
Already Saved
Wishlist Operation Failed
Network Failure
```

Errors should use safe, user-friendly messages.

---

## 13. React Query

Wishlist data is server state and should use React Query.

Typical operations may include:

```text
useWishlist()
useAddToWishlist()
useRemoveFromWishlist()
```

The application should update or invalidate relevant queries after mutations.

---

## 14. Optimistic Updates

Wishlist toggles are suitable candidates for optimistic updates.

If used:

```text
User Action
 ↓
Optimistic UI
 ↓
Backend Request
 ├── Success → Keep State
 └── Failure → Roll Back
```

The implementation must handle rollback correctly.

---

## 15. Authentication

Wishlist operations require authentication unless an explicitly approved guest-wishlist strategy is introduced.

Unauthenticated users should receive an appropriate UX path, such as:

```text
Sign in to save products.
```

---

## 16. API

Typical endpoints may include:

```text
GET    /api/wishlist
POST   /api/wishlist/items
DELETE /api/wishlist/items/:productId
```

The exact contract follows the backend implementation and `API_GUIDELINES.md`.

---

## 17. Security

Wishlist operations must enforce:

- Authentication.
- Wishlist ownership.
- Product validation.
- Server-side authorization.

The frontend must not be treated as the security boundary.

---

## 18. Performance

Wishlist performance should use:

- React Query caching.
- Efficient database queries.
- Appropriate indexes.
- Limited response payloads.
- Optimized product images.

Avoid repeatedly loading full product data when only required fields are needed.

---

## 19. Accessibility

Wishlist interactions must support:

- Keyboard navigation.
- Accessible favorite controls.
- Meaningful labels.
- Visible focus.
- Screen-reader feedback.
- Clear success/error messages.

Favorite buttons should communicate their current state.

Example:

```text
Add to wishlist
Remove from wishlist
```

rather than relying only on an icon.

---

## 20. Responsive Design

The wishlist must work across:

```text
Mobile
Tablet
Desktop
```

Product cards should adapt to available width without breaking essential actions.

---

## 21. Localization and RTL

The wishlist supports:

```text
English
Arabic / RTL
```

Text, currency, and layout direction must follow the application's localization system.

Avoid hard-coded left/right assumptions.

---

## 22. Product Integration

Wishlist products integrate with:

```text
Product Details
Cart
Recommendations
Search
Inventory
```

The wishlist must always use current authoritative product data.

---

## 23. Analytics

Where analytics are implemented, wishlist events may include:

```text
Wishlist Added
Wishlist Removed
Wishlist Product Opened
Wishlist Product Added to Cart
```

Analytics must avoid unnecessary personal or sensitive information.

---

## 24. Testing

Wishlist testing should cover:

```text
Add Product
Remove Product
Duplicate Prevention
Empty Wishlist
Unauthorized Access
Product Not Found
Move to Cart
Optimistic Rollback
Availability Changes
Price Changes
Mobile Layout
RTL Layout
Accessibility
Network Failure
```

Critical wishlist interactions should also be covered by E2E tests.

---

## 25. Definition of Done

Wishlist functionality is complete when:

- Customers can add products.
- Customers can remove products.
- Duplicate entries are prevented.
- Current product information is displayed.
- Availability is handled.
- Cart integration works where required.
- Authentication is enforced.
- Ownership is enforced.
- Loading/error/empty states exist.
- Accessibility is verified.
- Responsive behavior is verified.
- RTL/localization is verified.
- Tests pass.
- Documentation matches implementation.

---

## 26. Wishlist Principle

> **The wishlist provides persistent product discovery for authenticated customers while keeping ownership, product validity, and saved-item state authoritative on the backend.**
