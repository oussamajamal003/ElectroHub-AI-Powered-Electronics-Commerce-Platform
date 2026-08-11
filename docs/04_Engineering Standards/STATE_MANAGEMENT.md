# State Management

## 1. Purpose

This document defines the state-management strategy for the ElectroHub React frontend.

The application separates state according to ownership and lifecycle rather than placing all state into one global store.

The primary tools are:

```text
React Query
React State / Context
React Hook Form
Zod
```

---

## 2. State Categories

Application state is divided into:

```text
Server State
Local UI State
Form State
Authentication State
Persistent User Preferences
```

Each category should use the simplest appropriate mechanism.

---

## 3. Server State

Server state represents data owned by the backend.

Examples:

```text
Products
Categories
Orders
Inventory
Recommendations
Favorites
Delivery Data
User Profile
```

Server state is managed primarily with:

```text
TanStack React Query
```

---

## 4. React Query Architecture

Typical flow:

```text
React Component
 ↓
Custom Hook
 ↓
React Query
 ↓
API Client
 ↓
Backend API
```

Components should not duplicate server-state fetching logic unnecessarily.

---

## 5. Query Keys

Query keys must be stable and descriptive.

Examples:

```ts
["products"]
["products", productId]
["orders"]
["orders", orderId]
["recommendations", productId]
```

Query keys should include parameters that materially change the returned data.

---

## 6. Queries

Use queries for read operations.

Examples:

```text
Product List
Product Details
Order Details
Wishlist
Recommendations
Delivery Status
```

Queries should define appropriate:

- Query keys.
- Fetch functions.
- Loading behavior.
- Error behavior.
- Cache behavior.

---

## 7. Mutations

Use React Query mutations for server-changing operations.

Examples:

```text
Add to Cart
Remove from Cart
Add Favorite
Remove Favorite
Create Order
Update Profile
Admin Product Update
Delivery Status Update
```

After mutations, invalidate or update affected queries appropriately.

---

## 8. Cache Invalidation

Cache invalidation should be deliberate.

Example:

```text
Add Favorite
 ↓
Mutation Success
 ↓
Invalidate / Update Favorites Query
 ↓
UI Refreshes
```

Avoid invalidating the entire query cache for small changes.

---

## 9. Optimistic Updates

Optimistic updates may be used where the operation is:

- Low risk.
- Easily reversible.
- Predictable.

Examples:

```text
Favorite Toggle
Cart Quantity
```

Do not use optimistic updates for critical financial state without a clear rollback strategy.

---

## 10. Payment and Order State

Payment and order state is server-authoritative.

The frontend must not locally mark an order as paid simply because a UI action succeeded.

Conceptually:

```text
Frontend Action
 ↓
Backend
 ↓
Stripe Verification
 ↓
Backend State
 ↓
React Query
 ↓
UI
```

---

## 11. Delivery State

Delivery state is also server-authoritative.

Real-time updates:

```text
Backend
 ↓
Socket.IO
 ↓
Frontend
 ↓
React Query Cache / Local Presentation State
```

The frontend displays delivery state but does not own the authoritative state.

---

## 12. Local UI State

Use React state for transient UI concerns.

Examples:

```text
Modal Open/Closed
Dropdown Open/Closed
Selected Tab
Mobile Menu
Temporary UI Toggle
```

Example:

```ts
const [isOpen, setIsOpen] = useState(false);
```

Do not place simple local UI state into a global store without a clear reason.

---

## 13. Context

React Context may be used for cross-cutting values that genuinely need broad access.

Examples may include:

```text
Theme
Localization
Authentication presentation state
```

Context should not become a replacement for React Query.

Avoid putting large frequently changing server datasets into Context.

---

## 14. Authentication State

Authentication is server-backed.

The frontend may maintain the current authentication/session state required for UI behavior, but the backend remains authoritative.

The frontend should never store or expose server secrets.

---

## 15. Tokens

Token handling must follow the approved authentication architecture.

Sensitive token storage should be selected with security in mind.

The implementation should minimize exposure to:

```text
XSS
Token theft
Accidental logging
```

Refresh-token handling should remain consistent with backend authentication design.

---

## 16. Form State

Forms use:

```text
React Hook Form
+
Zod
```

Flow:

```text
Input
 ↓
React Hook Form
 ↓
Zod Validation
 ↓
API Mutation
 ↓
Backend Validation
```

Form state should not be duplicated into global application state unless the workflow genuinely requires persistence across pages.

---

## 17. Form Examples

Important forms include:

```text
Login
Registration
OTP
Checkout
Shipping
Product Management
Admin Product Editing
```

Each form should have:

- Validation.
- Submission state.
- Error state.
- Success handling.
- Accessible feedback.

---

## 18. URL State

State that should be shareable or navigational may belong in the URL.

Examples:

```text
Search Query
Category Filter
Sort
Pagination
Product ID
```

Example:

```text
/products?category=laptops&sort=price_asc&page=2
```

URL state should be treated as untrusted input and validated before use.

---

## 19. Persistent Preferences

Persistent client preferences may include:

```text
Theme
Language
Unit / display preferences where applicable
```

Use an appropriate persistence mechanism such as local storage where security requirements allow it.

Do not store secrets or sensitive authentication credentials in ordinary local storage without explicit security justification.

---

## 20. Favorites

Favorites are server-owned when tied to the user's account.

```text
User
 ↓
Backend
 ↓
Favorites
 ↓
React Query Cache
 ↓
UI
```

Local UI state may temporarily represent interaction state, but the server remains authoritative.

---

## 21. Cart

The backend owns authoritative cart data.

```text
User
 ↓
Backend Cart API
 ↓
React Query
 ↓
Cart UI
```

The frontend may provide immediate UI feedback, but checkout must revalidate the cart on the server.

---

## 22. Recommendations

Recommendations are server/AI-derived state.

```text
Backend / AI
 ↓
Recommendation API
 ↓
React Query
 ↓
Recommendation Components
```

The frontend should not permanently calculate authoritative recommendations.

---

## 23. Offline Behavior

Offline support should distinguish:

```text
Cached Read Data
Offline UI State
Pending Mutations
```

Cached data may remain available according to the React Query configuration.

Critical operations such as payments and order creation must not be assumed successful while offline.

---

## 24. Loading and Error States

Every asynchronous state should define:

```text
Loading
Success
Error
Empty
```

Avoid components that assume data always exists.

---

## 25. State Synchronization

When one mutation affects multiple views, update or invalidate related queries.

Example:

```text
Update Product
 ↓
Product Detail Cache
 ↓
Product List Cache
 ↓
Inventory-related Data
```

The exact invalidation strategy should avoid unnecessary network requests.

---

## 26. Avoiding State Duplication

Do not keep the same server data independently in:

```text
React Context
useState
React Query
localStorage
```

unless each copy has a clearly defined purpose.

Duplicated state can become inconsistent.

---

## 27. State Ownership Rule

Use this decision model:

```text
Is it server-owned?
        │
       Yes
        ↓
   React Query

Is it form input?
        │
       Yes
        ↓
 React Hook Form

Is it temporary UI state?
        │
       Yes
        ↓
   React State

Is it a cross-cutting UI concern?
        │
       Yes
        ↓
 Context / appropriate provider

Should it be shareable/bookmarkable?
        │
       Yes
        ↓
      URL
```

---

## 28. Performance

State management should avoid unnecessary renders.

Consider:

- Narrow component subscriptions.
- Appropriate query keys.
- Query caching.
- Selectors/derived values where appropriate.
- Avoiding unnecessary Context updates.
- Pagination for large datasets.

Do not add memoization without a measurable benefit.

---

## 29. Testing

State behavior should be tested at the appropriate level.

Test:

```text
Queries
Mutations
Cache Updates
Form Validation
Loading States
Error States
Offline Behavior
Authentication Transitions
```

Critical workflows should also be covered by E2E tests.

---

## 30. State Management Completion Criteria

The state-management implementation is production-ready when:

- Server state uses React Query appropriately.
- Local UI state remains local.
- Forms use React Hook Form and Zod.
- Authentication state follows the security architecture.
- Orders and payments remain server-authoritative.
- Delivery state remains server-authoritative.
- Cache invalidation is deliberate.
- State duplication is minimized.
- Offline behavior is defined.
- Loading/error/empty states are handled.
- Critical state transitions are tested.

---

## 31. State Management Principle

> **Use the simplest state mechanism that matches ownership: server state belongs to React Query, forms belong to React Hook Form, transient UI state belongs to React, and authoritative business state belongs to the backend.**
