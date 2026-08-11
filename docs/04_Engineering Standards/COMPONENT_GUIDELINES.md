# Component Guidelines

## 1. Purpose

This document defines component development standards for the ElectroHub React frontend.

The goal is to create components that are:

- Reusable.
- Accessible.
- Testable.
- Maintainable.
- Consistent with Figma.
- Responsive.
- Easy to review.

---

## 2. Component Architecture

The frontend should organize components around responsibility.

Conceptually:

```text
Pages
 ↓
Features
 ↓
Components
 ↓
UI Primitives
```

A component should have one clear primary responsibility.

---

## 3. Component Categories

Components may be organized into:

```text
UI Components
Feature Components
Layout Components
Page Components
Form Components
Feedback Components
Data Components
```

Examples:

```text
Button
Modal
ProductCard
ProductGrid
CartSummary
CheckoutForm
OrderTimeline
DeliveryMap
AdminTable
```

---

## 4. UI Components

UI components provide reusable presentation and interaction behavior.

Examples:

```text
Button
Input
Select
Dialog
Dropdown
Tabs
Badge
Toast
Spinner
Skeleton
```

These components should avoid application-specific business logic.

---

## 5. Feature Components

Feature components represent domain-specific behavior.

Examples:

```text
ProductCard
CartItem
CheckoutSummary
OrderTimeline
DeliveryMap
RecommendationSection
ImageSearchPanel
```

Feature components may use hooks and services appropriate to their domain.

---

## 6. Page Components

Pages compose features rather than implementing every detail themselves.

Prefer:

```text
CheckoutPage
 ├── CheckoutForm
 ├── OrderSummary
 └── PaymentSection
```

Avoid large pages containing all business logic and markup.

---

## 7. Props

Props should be:

- Explicit.
- Minimal.
- Typed.
- Predictable.

Example:

```ts
interface ProductCardProps {
  product: Product;
  onSelect?: (productId: string) => void;
}
```

Avoid passing large unrelated objects when only a small subset is required.

---

## 8. Component Responsibilities

A component should generally handle:

- Rendering.
- User interaction.
- Presentation-level state.
- Calling appropriate hooks.

It should not directly contain:

- Database access.
- Complex backend business rules.
- Secrets.
- Provider credentials.

---

## 9. Data Fetching

Use React Query for server state.

Prefer:

```text
Component
 ↓
Custom Hook
 ↓
React Query
 ↓
API Client
 ↓
Backend
```

Avoid putting raw API request logic throughout components.

---

## 10. Custom Hooks

Custom hooks should encapsulate reusable behavior.

Examples:

```text
useProducts()
useCart()
useFavorites()
useAuth()
useOrders()
useDeliveryTracking()
useRecommendations()
```

Hooks should expose a clean interface rather than implementation details.

---

## 11. Forms

Forms use:

```text
React Hook Form
+
Zod
```

The form flow should be:

```text
User Input
 ↓
React Hook Form
 ↓
Zod Validation
 ↓
API Request
 ↓
Backend Validation
```

Frontend validation improves UX but does not replace backend validation.

---

## 12. Accessibility

Every interactive component should support:

- Keyboard operation.
- Visible focus.
- Accessible names.
- Correct semantic roles.
- Appropriate labels.
- Screen-reader compatibility.

Do not use clickable `div` elements when a semantic button or link is appropriate.

---

## 13. Loading States

Components that depend on asynchronous data should define loading behavior.

Use appropriate patterns:

```text
Skeleton
Spinner
Placeholder
Disabled State
```

Avoid blank screens during normal loading.

---

## 14. Error States

Components should handle expected errors.

Examples:

```text
Network Error
Unauthorized
Not Found
Payment Failure
AI Service Unavailable
```

Provide clear user-facing feedback without exposing internal errors.

---

## 15. Empty States

Important collection components should define empty states.

Examples:

```text
No Search Results
Empty Cart
Empty Wishlist
No Orders
No Recommendations
No Notifications
```

Empty states should provide useful next actions where appropriate.

---

## 16. Responsive Components

Components must work across:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Avoid components that depend on a single fixed viewport width.

Responsive behavior should follow the Figma design and responsive documentation.

---

## 17. RTL Support

Components must support Arabic RTL layouts.

Avoid assuming:

```text
left = start
right = end
```

Use logical CSS properties where possible.

Test components in both:

```text
LTR
RTL
```

---

## 18. Theme Support

Components must support:

```text
Light Theme
Dark Theme
```

Do not hardcode colors that bypass the design-token system.

Theme behavior should come from shared tokens.

---

## 19. Motion

Use Framer Motion where meaningful.

Motion should:

- Support usability.
- Be consistent with the design system.
- Avoid excessive animation.
- Respect reduced-motion preferences.

---

## 20. Radix UI

Radix UI is used for accessible behavior primitives where appropriate.

Radix provides behavior/accessibility primitives rather than defining the application's visual identity.

Components should apply the ElectroHub design system through SCSS/CSS Modules.

---

## 21. Icons

Lucide React is the standard icon library.

Icons should:

- Have appropriate accessible labels when meaningful.
- Be decorative when redundant with visible text.
- Use consistent sizing.
- Follow the design system.

Avoid mixing multiple icon libraries without justification.

---

## 22. Tables

TanStack Table is used for complex administrative tables.

Tables should support appropriate:

- Sorting.
- Filtering.
- Pagination.
- Loading states.
- Empty states.
- Error states.
- Responsive behavior where applicable.

---

## 23. Component Composition

Prefer composition over excessive prop-driven branching.

Instead of:

```text
Component with 20 boolean props
```

prefer:

```text
Composable child components
```

This keeps component APIs understandable.

---

## 24. Reusability

Do not extract a component solely because code can technically be reused.

Extract when:

- The responsibility is clear.
- Reuse is real or strongly expected.
- The abstraction improves maintainability.

Avoid premature abstraction.

---

## 25. Component Size

Large components should be reviewed for separation.

Warning signs include:

- Many unrelated handlers.
- Large conditional rendering blocks.
- Multiple API operations.
- Complex state coordination.
- Large style files.
- Difficult testing.

Split by responsibility rather than arbitrary line count.

---

## 26. Naming

Use descriptive component names.

Prefer:

```text
ProductCard
OrderTimeline
DeliveryMap
PaymentSummary
RecommendationSection
```

Avoid:

```text
Box
Thing
Card2
ComponentA
```

---

## 27. File Organization

A component may use colocated files:

```text
ProductCard/
├── ProductCard.tsx
├── ProductCard.module.scss
├── ProductCard.test.tsx
└── index.ts
```

The exact structure may vary according to project conventions.

---

## 28. Testing

Important components should have tests appropriate to their behavior.

Test:

- Rendering.
- User interaction.
- Validation.
- Accessibility.
- Loading.
- Error states.
- Empty states.
- Responsive behavior where meaningful.

Critical workflows should also be covered through integration/E2E tests.

---

## 29. Security

Never put secrets into React components.

The frontend must not contain:

```text
Database credentials
JWT signing secrets
Stripe secret keys
Brevo API keys
Cloudinary private credentials
```

Public/client-safe configuration must be clearly distinguished from server-only secrets.

---

## 30. Performance

Avoid unnecessary rendering and expensive work.

Consider:

- React Query caching.
- Memoization only when justified.
- Lazy loading.
- Virtualization for very large lists.
- Optimized images.
- Code splitting.

Do not optimize blindly; use profiling and measurable evidence.

---

## 31. Definition of Done

A component is ready when:

- Requirements are implemented.
- Props are typed.
- Accessibility is addressed.
- Loading/error/empty states are handled where applicable.
- Responsive behavior is verified.
- Light/dark themes work.
- RTL behavior is verified where applicable.
- Tests are added where required.
- Styling follows SCSS/CSS Modules standards.
- No dead code or debug code remains.

---

## 32. Component Principle

> **Build focused, accessible, composable components that reflect the design system without allowing UI components to become containers for business logic.**
