# Frontend Architecture

## 1. Purpose

This document defines the frontend architecture for ElectroHub.

The frontend is a React + TypeScript application responsible for the customer and administrator experiences.

The architecture emphasizes:

- Feature-oriented organization.
- Reusable UI components.
- Separation of server state and local UI state.
- Typed API communication.
- Accessibility.
- Responsive design.
- Testable feature boundaries.
- SCSS and CSS Modules.

---

## 2. Technology Stack

```text
React
TypeScript
Vite
SCSS
CSS Modules
React Query
React Router
React Hook Form
Zod
Framer Motion
Radix UI
Lucide React
TanStack Table
Socket.IO Client
Leaflet
OpenStreetMap
```

Not used:

```text
Tailwind CSS
shadcn/ui
Bootstrap
```

---

## 3. Frontend Responsibilities

The frontend owns:

- UI rendering.
- Routing.
- User interaction.
- Form state.
- Client-side validation.
- Server-state consumption.
- Authentication presentation.
- Responsive behavior.
- Accessibility.
- Loading, empty, and error states.
- Real-time UI updates.
- Map visualization.

The frontend does not own authoritative authorization, payment confirmation, inventory, order, delivery, or database state.

---

## 4. Recommended Structure

```text
apps/frontend/
├── public/
├── src/
│   ├── app/
│   ├── assets/
│   ├── components/
│   ├── features/
│   ├── hooks/
│   ├── layouts/
│   ├── lib/
│   ├── pages/
│   ├── routes/
│   ├── services/
│   ├── styles/
│   ├── types/
│   └── main.tsx
├── tests/
├── package.json
├── vite.config.ts
└── tsconfig.json
```

The structure may evolve, but responsibilities must remain separated.

---

## 5. App Layer

The `app/` area contains application-wide configuration:

- Providers.
- Query client.
- Global configuration.
- Authentication context where applicable.
- Error boundaries.
- Application initialization.

Conceptually:

```text
App
 ├── Router
 ├── Query Provider
 ├── Auth Provider
 ├── Global UI Providers
 └── Routes
```

---

## 6. Components

Reusable UI components live in `components/`.

Examples:

```text
Button
Input
Dialog
Toast
SearchInput
ProductCard
OrderCard
StatusBadge
LoadingState
EmptyState
ErrorState
```

Components should remain reusable and should not contain unrelated business logic.

Detailed standards are defined in `docs/02_Design/COMPONENTS.md`.

---

## 7. Feature Architecture

The `features/` directory contains domain-specific frontend functionality.

```text
features/
├── auth/
├── products/
├── categories/
├── search/
├── image-search/
├── recommendations/
├── cart/
├── wishlist/
├── checkout/
├── payments/
├── orders/
├── delivery/
├── inventory/
├── admin/
└── analytics/
```

A feature may contain:

```text
components/
hooks/
api/
types/
utils/
schemas/
```

Feature code should remain close to the domain it serves.

---

## 8. Pages

Pages compose features into route-level screens.

Examples:

```text
HomePage
SearchPage
ProductDetailsPage
CartPage
WishlistPage
CheckoutPage
OrdersPage
OrderDetailsPage
DeliveryTrackingPage

AdminDashboardPage
AdminProductsPage
AdminOrdersPage
AdminInventoryPage
AdminAnalyticsPage
```

Pages should primarily coordinate layout, routing, data requirements, and feature composition.

---

## 9. Layouts

Shared layouts include:

```text
CustomerLayout
AdminLayout
AuthLayout
```

Customer:

```text
Header
 ↓
Main Content
 ↓
Footer
```

Admin:

```text
Sidebar
+
Header
+
Main Content
```

---

## 10. Routing

React Router manages navigation.

Conceptually:

```text
/
├── /search
├── /products/:id
├── /categories/:id
├── /cart
├── /wishlist
├── /checkout
├── /orders
├── /orders/:id
├── /orders/:id/tracking
└── /admin
    ├── /dashboard
    ├── /products
    ├── /categories
    ├── /inventory
    ├── /orders
    ├── /delivery
    └── /analytics
```

Frontend route protection improves UX; backend authorization remains authoritative.

---

## 11. API Layer

API communication should be centralized.

```text
Feature Hook
 ↓
API Client
 ↓
HTTP Request
 ↓
Backend API
```

The API layer handles:

- Base URL.
- Authentication headers.
- Serialization.
- Response parsing.
- Consistent error handling.

Components should not construct arbitrary HTTP requests directly.

---

## 12. React Query

React Query manages server state:

- Fetching.
- Caching.
- Refetching.
- Loading.
- Errors.
- Invalidation.
- Mutation lifecycle.

```text
Component
 ↓
Feature Hook
 ↓
React Query
 ↓
API Client
 ↓
Backend
```

---

## 13. Query and Mutation Strategy

Query keys should be stable and domain-oriented.

Examples:

```text
products
products/list
products/detail/:id
orders
orders/detail/:id
inventory
recommendations
```

Mutations include:

```text
Add to Cart
Remove from Wishlist
Create Order
Update Profile
Update Product
Update Inventory
Update Delivery
```

Successful mutations should invalidate or update related queries appropriately.

---

## 14. Local UI State

Local React state is appropriate for:

- Modal visibility.
- Selected tabs.
- Temporary input state.
- Dropdown state.
- Local visual state.

Do not unnecessarily duplicate server state in local state.

---

## 15. Authentication

Frontend authentication state may expose:

```text
Current User
Authentication Status
Role
Session State
```

It may be used for UI and navigation decisions.

Backend authorization remains the security boundary.

---

## 16. Forms

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
Zod
 ↓
API Mutation
 ↓
Backend Validation
```

Frontend validation improves UX; backend validation is mandatory.

---

## 17. Search

```text
SearchInput
 ↓
Search Hook
 ↓
React Query
 ↓
Backend Search API
 ↓
Results
```

The UI handles:

- Typing.
- Suggestions.
- Loading.
- Results.
- No results.
- Errors.
- Keyboard interaction.

---

## 18. Image Search

```text
Search by Image
 ↓
Upload / Camera
 ↓
Preview
 ↓
Analyze
 ↓
Results
```

The frontend handles:

- Camera permissions.
- Camera availability.
- File validation.
- Upload failure.
- Processing.
- No results.
- Results.

The backend and FastAPI service perform the authoritative processing.

---

## 19. Product, Cart, and Wishlist

Product data is consumed through React Query.

Cart and wishlist are server-owned:

```text
UI
 ↓
Feature Hook
 ↓
React Query
 ↓
Backend
 ↓
Database
```

Optimistic updates may be used when safe, but the backend remains authoritative.

---

## 20. Checkout and Payments

Checkout is a multi-step UI:

```text
Cart
 ↓
Shipping
 ↓
Payment
 ↓
Processing
 ↓
Confirmation
```

Frontend responsibilities:

- Form state.
- Validation.
- Payment UI.
- Loading.
- Errors.
- Confirmation presentation.

Backend responsibilities:

- Order validation.
- Payment verification.
- Inventory validation.
- Order creation.

Stripe is used in Test Mode.

The frontend must never independently declare payment success.

---

## 21. Orders and PDFs

The frontend provides:

```text
Order List
Order Details
Order Status
Payment Status
Delivery Status
Invoice Download
Payment Receipt Download
```

PDF flow:

```text
User Action
 ↓
Frontend Request
 ↓
Backend Authorization
 ↓
PDF Generation / Retrieval
 ↓
Authorized Download
```

The frontend must not generate trusted financial documents from client-side data.

---

## 22. Delivery Tracking

Delivery combines:

```text
Order Data
+
Socket.IO
+
Leaflet
+
OpenStreetMap
```

Flow:

```text
Backend
 ↓
Socket.IO Event
 ↓
Frontend
 ↓
Delivery State
 ↓
Timeline / Map
```

The frontend visualizes delivery state but does not determine it.

---

## 23. Socket.IO

Socket.IO Client handles real-time delivery updates.

The frontend must manage:

- Connection.
- Reconnection.
- Event subscription.
- Event cleanup.
- Connection errors.
- UI synchronization.

Listeners must be cleaned up when components unmount or subscriptions change.

---

## 24. Leaflet

Leaflet provides interactive maps.

The frontend handles:

- Map rendering.
- Markers.
- Route visualization.
- Map interaction.
- Responsive sizing.

Backend delivery data remains authoritative.

---

## 25. Recommendations

```text
Product Page
 ↓
Recommendation Hook
 ↓
React Query
 ↓
Backend
 ↓
Recommendation Service / AI
```

Recommendation rules should not be implemented directly inside UI components.

---

## 26. Admin Architecture

Admin features are organized by domain:

```text
features/admin/
├── dashboard/
├── products/
├── categories/
├── inventory/
├── orders/
├── delivery/
└── analytics/
```

Admin screens reuse shared components and specialized operational components.

---

## 27. Tables

TanStack Table is used for complex administrative tables.

```text
Admin Page
 ↓
Data Hook
 ↓
React Query
 ↓
TanStack Table
 ↓
Table UI
```

Tables should support appropriate:

- Sorting.
- Filtering.
- Pagination.
- Selection.
- Loading.
- Empty states.
- Error states.

---

## 28. Styling Architecture

The frontend uses:

```text
SCSS
+
CSS Modules
```

SCSS follows the 7-1 architecture.

```text
styles/
├── abstracts/
├── base/
├── components/
├── layout/
├── pages/
├── themes/
├── vendors/
└── main.scss
```

Component-specific styles should normally use CSS Modules.

---

## 29. UI Primitives and Icons

Radix UI provides behavior/accessibility primitives where appropriate.

The visual layer remains ElectroHub-specific.

Lucide React is the approved icon library.

---

## 30. Motion

Framer Motion is used for meaningful animation:

- State transitions.
- Feedback.
- Navigation.
- Loading.
- Delivery updates.

The frontend must respect `prefers-reduced-motion`.

---

## 31. Loading, Empty, and Error States

Loading should exist at the correct level:

```text
Page
Section
Component
Mutation
```

Use skeletons when final structure is known.

Feature-aware empty states include:

```text
Empty Cart
Empty Wishlist
No Orders
No Search Results
No Recommendations
No Inventory Results
```

Error states should distinguish validation, authentication, authorization, network, not-found, server, payment, and external-service errors.

---

## 32. Accessibility

The frontend must support:

- Semantic HTML.
- Keyboard navigation.
- Focus management.
- Accessible names.
- Form labels.
- Screen-reader compatibility.
- Contrast.
- Reduced motion.
- Touch targets.

Accessibility should be implemented in reusable components.

---

## 33. Responsive Architecture

Responsive behavior uses:

```text
SCSS
CSS Media Queries
Responsive Components
Responsive Layouts
```

Supported viewports:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Follow `docs/02_Design/RESPONSIVE.md`.

---

## 34. Performance

Frontend performance should consider:

- Code splitting.
- Lazy loading.
- Image optimization.
- React Query caching.
- Efficient list rendering.
- Avoiding unnecessary re-renders.
- Limited animation.
- Appropriate bundle size.

Large feature areas may be lazy-loaded when beneficial.

---

## 35. Security

Frontend security includes:

- No secret exposure.
- Safe HTML handling.
- Client-side validation for UX.
- Safe authentication-state handling.
- No sensitive data in logs.
- HTTPS in production.

The frontend is never the security boundary.

---

## 36. Testing Architecture

Testing should cover:

```text
Unit
 ↓
Component
 ↓
Integration
 ↓
E2E
```

Critical user journeys should have E2E coverage.

Important reusable components should have focused component tests.

---

## 37. Completion Criteria

The frontend architecture is complete when:

- Feature boundaries are defined.
- Routing is defined.
- API access is centralized.
- React Query manages server state.
- Local state is separated from server state.
- Forms use React Hook Form and Zod.
- Components are reusable.
- SCSS/CSS Modules are standardized.
- Accessibility is integrated.
- Responsive behavior is defined.
- Error/loading/empty states are handled.
- Real-time delivery is defined.
- Image search is defined.
- Checkout/payment flows are defined.
- Admin architecture is defined.
- Testing strategy is defined.

---

## 38. Frontend Principle

> **Keep pages compositional, features isolated, server state centralized, and reusable UI independent from business logic.**
