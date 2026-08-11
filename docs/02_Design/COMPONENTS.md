# Components

## 1. Purpose

This document defines the reusable UI component architecture for ElectroHub.

The component system is designed to:

- Maintain visual consistency.
- Reduce duplicated UI implementation.
- Provide predictable interaction behavior.
- Support responsive layouts.
- Support accessibility.
- Align implementation with the Figma design system.
- Provide reusable building blocks for customer and administrator experiences.

Components should represent reusable interface patterns rather than one-off page-specific markup.

---

# 2. Component Architecture

The component hierarchy follows:

```text
Design Tokens
      ↓
UI Primitives
      ↓
Shared Components
      ↓
Feature Components
      ↓
Page Components
      ↓
Application Screens
```

The distinction between these levels should remain clear.

---

# 3. UI Primitives

UI primitives are the smallest reusable interface building blocks.

Examples:

- Button
- Icon Button
- Input
- Label
- Textarea
- Select
- Checkbox
- Radio
- Switch
- Badge
- Separator
- Tooltip

Primitives should remain generic and reusable.

They should not contain feature-specific business logic.

---

# 4. Shared Components

Shared components combine primitives into reusable application-level patterns.

Examples:

- Header
- Footer
- Navigation
- Search Input
- Modal
- Dialog
- Dropdown
- Toast
- Alert
- Pagination
- Loading State
- Empty State
- Error State
- Skeleton

Shared components may contain UI behavior but should avoid owning domain-specific business rules.

---

# 5. Feature Components

Feature components represent reusable UI patterns belonging to a specific domain.

Examples:

```text
ProductCard
ProductGrid
ProductGallery
CartItem
OrderCard
OrderTimeline
DeliveryMap
RecommendationSection
InventoryStatus
PaymentSummary
```

Feature components may consume feature-specific data and hooks.

Business rules should remain in the appropriate service or application layer.

---

# 6. Page Components

Page components compose reusable components into complete screens.

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
```

Pages should primarily coordinate layout, routing, data requirements, and feature components.

They should not become large collections of duplicated UI markup.

---

# 7. Component Naming

Component names should clearly describe their purpose.

Prefer:

```text
ProductCard
SearchInput
OrderTimeline
DeliveryMap
PaymentSummary
InventoryBadge
```

Avoid:

```text
Box
Thing
Container2
CardNew
ComponentCopy
```

Names should remain stable even when visual styling changes.

---

# 8. Component File Structure

A component should generally keep its implementation, styles, and tests close together.

Example:

```text
ProductCard/
├── ProductCard.tsx
├── ProductCard.module.scss
├── ProductCard.test.tsx
└── index.ts
```

The exact folder organization may vary for very small components.

---

# 9. Component Exports

Reusable components should expose a clear public interface.

Prefer:

```ts
export interface ProductCardProps {
  product: Product;
  onAddToCart?: () => void;
}
```

Avoid exposing unnecessary internal implementation details.

Barrel exports may be used when they improve discoverability without creating circular dependencies.

---

# 10. Props

Props should be:

- Explicit
- Typed
- Minimal
- Meaningful
- Stable

Avoid passing large unrelated objects when a component only requires a small subset of data.

Prefer:

```ts
type ProductCardProps = {
  name: string;
  price: number;
  imageUrl: string;
};
```

over passing an unnecessarily large object when the full object is not required.

---

# 11. Component Variants

Variants should represent meaningful visual or behavioral differences.

Example:

```text
Button
├── Primary
├── Secondary
├── Ghost
└── Danger
```

States should remain separate from variants where appropriate:

```text
Default
Hover
Focus
Disabled
Loading
```

---

# 12. Buttons

Buttons should support:

- Primary actions
- Secondary actions
- Destructive actions
- Loading state
- Disabled state
- Icon-only actions where appropriate

Examples:

```text
Primary
Secondary
Ghost
Danger
```

Buttons must have visible focus states.

Icon-only buttons must provide an accessible name.

---

# 13. Inputs

Inputs should support:

- Label
- Placeholder
- Value
- Helper text
- Error message
- Disabled state
- Required state
- Focus state

Forms must associate labels with their controls.

---

# 14. Search Input

The search input is a high-priority shared component.

It may support:

- Text input
- Search suggestions
- Loading state
- No suggestions
- Clear action
- Keyboard navigation
- Submit action

Search suggestions should be presented accessibly and should not create navigation or selection ambiguity.

---

# 15. Product Card

The product card is a core commerce component.

A typical product card may contain:

```text
Product Image
Brand
Product Name
Rating
Price
Availability
Primary Action
Wishlist Action
```

Supported states may include:

```text
Default
Hover
Loading
Low Stock
Out of Stock
Featured
```

The card should maintain a consistent visual hierarchy across product listings, search results, categories, and recommendations.

---

# 16. Product Gallery

The product gallery should support:

- Main product image
- Thumbnail images
- Image selection
- Loading state
- Missing image state

Image interaction should remain usable on touch devices.

---

# 17. Cart Components

Cart-related components include:

```text
CartItem
CartSummary
QuantityControl
CartEmptyState
```

The components should clearly communicate:

- Product
- Quantity
- Unit price
- Total price
- Availability
- Remove action

---

# 18. Wishlist Components

Wishlist components include:

```text
WishlistItem
WishlistGrid
WishlistEmptyState
```

The UI should provide clear actions for:

- Open product
- Remove from wishlist
- Add to cart where applicable

---

# 19. Checkout Components

Checkout components may include:

```text
CheckoutSummary
ShippingForm
PaymentForm
PaymentStatus
OrderConfirmation
```

The checkout UI must support:

- Validation
- Loading
- Payment processing
- Payment failure
- Payment success
- Order creation
- Confirmation

---

# 20. Order Components

Order-related components include:

```text
OrderCard
OrderSummary
OrderItems
OrderStatus
OrderTimeline
InvoiceDownload
PaymentReceiptDownload
```

Order components should clearly communicate:

- Order number
- Date
- Total
- Payment status
- Order status
- Delivery status

---

# 21. Delivery Components

Delivery tracking components include:

```text
DeliveryMap
DeliveryTimeline
DeliveryStatus
EstimatedArrival
DeliveryLocation
```

The delivery experience combines:

```text
Status
+
Timeline
+
Map
+
Location
+
Estimated Arrival
```

Real-time updates are received through Socket.IO.

---

# 22. Search by Image Components

The image-search feature may use:

```text
ImageSearchTrigger
ImageSourceSelector
ImageUploader
CameraCapture
ImagePreview
ImageProcessingState
ImageSearchResults
```

Supported workflow:

```text
Choose Source
      ↓
Upload / Camera
      ↓
Preview
      ↓
Analyze
      ↓
Results
```

The components should provide clear states for:

- Permission denied
- Invalid image
- Upload failure
- Processing
- No matches
- Results

---

# 23. Recommendation Components

Recommendation components may include:

```text
RecommendationSection
RecommendationCarousel
RecommendedProductCard
```

Supported sections include:

- Recommended for You
- You May Also Like
- Similar Products
- Frequently Bought Together

Recommendation components should reuse the standard product-card system.

---

# 24. Inventory Components

Inventory-related components include:

```text
InventoryStatus
StockBadge
LowStockAlert
StockEditor
```

Availability states include:

```text
In Stock
Low Stock
Out of Stock
```

The visual state should not rely solely on color.

---

# 25. Feedback Components

Shared feedback components include:

```text
Toast
Alert
Dialog
ConfirmationDialog
InlineError
LoadingState
Skeleton
EmptyState
ErrorState
```

Feedback should be:

- Clear
- Non-destructive where possible
- Accessible
- Recoverable where appropriate

---

# 26. Skeleton Components

Skeletons should represent the structure of the content being loaded.

Examples:

```text
ProductCardSkeleton
ProductDetailsSkeleton
OrderSkeleton
TableSkeleton
DashboardSkeleton
```

Skeleton dimensions should closely approximate the final component dimensions to reduce layout shift.

---

# 27. Empty State Components

Empty states should provide:

- Clear explanation
- Appropriate visual treatment
- Relevant next action where possible

Examples:

```text
EmptyCart
EmptyWishlist
NoSearchResults
NoOrders
NoNotifications
```

---

# 28. Error Components

Error components should provide:

- User-friendly explanation
- Recovery action
- Appropriate severity

Examples:

```text
ErrorState
RetryButton
InlineError
PaymentError
NetworkError
```

Technical error details should not be exposed unnecessarily.

---

# 29. Navigation Components

Navigation components include:

```text
Header
MainNavigation
Sidebar
MobileNavigation
Breadcrumbs
Pagination
```

Navigation must provide:

- Active state
- Focus state
- Keyboard accessibility
- Responsive behavior

---

# 30. Admin Components

Administrator interfaces require additional reusable components.

Examples:

```text
AdminSidebar
DashboardCard
DataTable
TableFilters
BulkActions
StatusBadge
AnalyticsCard
ChartContainer
AdminForm
ConfirmationDialog
```

Admin components should reuse the same design tokens and foundational primitives as the customer interface.

---

# 31. Data Tables

TanStack Table is used for complex administrative tables.

Tables may support:

- Sorting
- Filtering
- Pagination
- Row selection
- Bulk actions
- Responsive behavior
- Loading
- Empty states
- Error states

Tables must remain usable on smaller screens.

---

# 32. Dialogs and Modals

Dialogs should be implemented using accessible primitives where appropriate.

Dialogs must support:

- Focus management
- Keyboard dismissal
- Clear title
- Clear actions
- Responsive sizing

Destructive actions should use confirmation dialogs when appropriate.

---

# 33. Toasts

Toasts should be used for temporary feedback such as:

- Successful actions
- Recoverable errors
- Background operation results

Important information should not exist only inside a toast.

---

# 34. Accessibility Requirements

Every reusable component must consider:

- Keyboard navigation
- Focus visibility
- Accessible names
- Labels
- Semantic HTML
- Screen-reader behavior
- Contrast
- Touch targets
- Reduced motion

Accessibility should be built into components rather than fixed separately on individual pages.

---

# 35. Responsive Requirements

Components must define how they behave across:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Responsive behavior may include:

- Layout changes
- Stacking
- Resizing
- Visibility changes
- Touch interactions
- Alternative navigation

---

# 36. Styling Requirements

Components use:

```text
SCSS
+
CSS Modules
```

Styling should follow the project's SCSS 7-1 architecture.

Components should consume design tokens instead of introducing arbitrary values.

---

# 37. Radix UI Boundary

Radix UI is used for behavior and accessibility primitives.

It should not dictate the application's visual design.

The component architecture is:

```text
Radix UI
    ↓
Interaction Primitive
    ↓
ElectroHub Component
    ↓
SCSS / CSS Modules
```

---

# 38. Component Testing

Reusable components should have appropriate tests for:

- Rendering
- User interaction
- Important states
- Validation
- Accessibility behavior
- Error handling

Critical components should not rely exclusively on E2E tests.

---

# 39. Component Documentation

Important reusable components should document:

- Purpose
- Props
- Variants
- States
- Usage
- Accessibility
- Responsive behavior
- Dependencies

---

# 40. Component Completion Criteria

A reusable component is considered complete when:

- Its purpose is clear.
- Props are typed.
- Required states are implemented.
- Responsive behavior is defined.
- Accessibility is addressed.
- Styling follows the design system.
- Tests are provided where appropriate.
- Figma and implementation are aligned.
- No unnecessary feature-specific business logic is embedded in the component.

---

# 41. Component Principle

> **Build components around reusable behavior and visual patterns, not around individual pages.**

The component system should allow ElectroHub to grow without duplicating UI logic or creating inconsistent interfaces.
