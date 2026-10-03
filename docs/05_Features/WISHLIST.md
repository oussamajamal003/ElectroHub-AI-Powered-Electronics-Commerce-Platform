# Wishlist

## 1. Purpose

This document defines the wishlist functionality for ElectroHub.

The wishlist allows guests and authenticated customers to save products for later. Task 03.3 is a bounded set of at most 50 Product IDs; it has no quantity, totals, price reservation, or inventory reservation.

During authenticated refresh, the latest confirmed user-scoped count sizes the loading grid (at most 10 cards). Unknown count metadata remains distinct from a confirmed zero. The item-count label shows a skeleton and the header badge stays hidden until Wishlist loading resolves; stored estimates are never displayed as current counts. Successful mutation and reconciliation responses persist the confirmed count metadata before notifying query-cache consumers. This makes the refresh count available in the same publication step, including 0→1. Unresolved authenticated data never renders the resolved-empty state.

Guest and authenticated presentation use the same current-membership count and missing-item loading predicate. Usable cards stay visible during background reads; optimistic membership changes update the displayed and skeleton-count basis together. Mode-specific storage and protected reads remain necessary: guest IDs are browser-owned, while authenticated membership must be confirmed by the account endpoint. Shared presentation cannot eliminate upstream token-refresh or account API latency. A live comparison using the same saved Product in separate guest/authenticated browsers confirmed one first-frame skeleton, no false Empty state, a hidden unresolved badge, one membership/hydration request, and cards/badge in the same DOM update. Response-to-card time was 35.1 ms for guest and 35.4 ms for authenticated; total time was 3.00 seconds versus 7.28 seconds. The authenticated token refresh took 2.71 seconds and account Wishlist read 3.64 seconds, versus guest validation at 1.99 seconds. This read-only comparison made no account Wishlist mutations. Total-duration parity remains unclosed.

When guest-saved IDs require reconciliation, call reconcile directly rather than waiting for a preliminary Wishlist GET. Its complete response populates the same user-scoped query cache with a 30-second freshness window before guest storage is cleared. A failed merge still enables the fallback account read and preserves retry behavior. Header counts consume the feature providers directly, without a separate badge fetch or count store.

On refresh with an existing customer hint, the server-confirmed refresh token starts Cart and Wishlist reads in parallel with `/auth/me`. Their results are held by the shared session-read bootstrap helper and consumed by the ordinary user-scoped queries only after identity verification. They are not displayed or persisted under the cached identity while verification is pending. Invalid sessions discard the pending reads. This removes the `/auth/me` → commerce-read waterfall without introducing count stores or weakening server authorization.

Wishlist is imported eagerly at the route boundary to avoid an additional lazy/Suspense reveal wait when data is fast. Focused browser measurement reduced that wait from approximately 252 ms to 62 ms after required data was usable. Live authenticated DEV checks confirmed 0→1, 2→3, 3→2 and 12→10 capped refresh skeleton counts, no first-frame Empty flash, one Wishlist GET per refresh, and a badge in the same render as cards. The account's original Wishlist was restored. Latest live total load was 7.49–9.64 seconds versus Products at 1.43 seconds: token refresh took 3.07–3.65 seconds and Wishlist responses took 3.55–5.64 seconds. Cards appeared 33–54 ms after the Wishlist response and Cart badges within 30–47 ms of the Cart response. Overall speed remains unclosed; backend optimization is outside this frontend-only task.

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

The backend is authoritative for authenticated ownership and contents. Guests store only `{ productIds: string[] }` under `electrohub.wishlist.v1`; one bounded public validation request hydrates current public Product summaries. Storage is untrusted, normalized, deduplicated, and bounded; failed writes are reported.

---

## 3. Wishlist Ownership

Each server wishlist belongs to an authenticated customer. Guest wishlists are isolated browser-local Product ID sets.

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

The UI updates optimistically. Authenticated writes are serialized with versioned per-Product intent; newer intent overlays earlier responses, and failed final intent rolls back to confirmed membership. Removal restores focus to the next/previous heart or Explore Products.

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
Product Remains Saved
```

Add to Cart reuses Task 03.2 and never removes the Wishlist entry. Cart stock validation remains authoritative and independent.

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

Task 03.3 approves public guest Wishlist UI and hydration. Persistent account endpoints require `requireAuth` and `requireRole('CUSTOMER')`; no client-selected ownership is accepted.

Unauthenticated users should receive an appropriate UX path, such as:

```text
Save as a guest, then sign in to merge with your account.
```

---

## 16. API

Typical endpoints may include:

```text
GET    /api/wishlist
POST   /api/wishlist/items
DELETE /api/wishlist/items/:productId
POST   /api/wishlist/validate
POST   /api/wishlist/reconcile
```

Strict Add body: `{ productId: UUID }`. Strict validation/reconciliation body: `{ productIds: UUID[] }`, duplicates normalized, maximum 50 distinct IDs. Responses use `{ data: { items, totalItems } }`; each item has `productId`, current lean `product` summary or null, and `AVAILABLE`, `OUT_OF_STOCK`, or `UNAVAILABLE`. Reconcile additionally returns safe `unresolved` entries. New Add is 201, duplicate Add and idempotent Remove are 200; capacity is 409. Public validation is rate-limited.

Reconciliation is transactional SET UNION with Serializable retries and existing unique constraints. Install returned user-scoped cache before clearing accepted guest IDs. Invalid guests remain locally recoverable; failed merge retains both sources and has explicit Retry/Remove controls. Logout never copies server contents to guest storage.

Active out-of-stock Products can be saved and remain removable. New inactive/missing saves are rejected; existing unavailable entries remain placeholders without unpublished metadata. Product/Review hydration is batched, and prices use the existing Decimal-derived summary mapping. No Product, Search, Review, Home, Cart, or Inventory mutation/invalidation is introduced by Wishlist actions.

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

> **The wishlist supports browser-local guest discovery and persistent authenticated discovery, while the backend remains authoritative for product validity and authenticated ownership.**
