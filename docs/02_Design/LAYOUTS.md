# Layouts

## 1. Purpose

This document defines the layout architecture for ElectroHub.

The layout system establishes consistent rules for:

- Page structure
- Containers
- Navigation
- Headers
- Sidebars
- Grids
- Sections
- Forms
- Tables
- Customer screens
- Administrator screens
- Responsive behavior
- Mobile navigation

The goal is to provide predictable layouts across the entire application while allowing feature-specific content to remain flexible.

---

# 2. Layout Principles

ElectroHub layouts follow these principles:

### Consistency

Common page structures should use shared layout components.

### Hierarchy

Layouts should clearly communicate the relationship between navigation, content, actions, and supporting information.

### Responsiveness

Layouts must adapt across:

```text
Mobile
Tablet
Desktop
Large Desktop
```

### Reusability

Repeated structural patterns should become reusable layout components.

### Accessibility

Layout structure must preserve semantic order, keyboard navigation, and readable content flow.

---

# 3. Application Layout Architecture

The application is organized into major layout levels:

```text
Application Shell
      ↓
Page Layout
      ↓
Section Layout
      ↓
Feature Layout
      ↓
Components
```

---

# 4. Application Shell

The application shell provides the global structure.

Customer shell:

```text
┌───────────────────────────────┐
│ Header / Navigation           │
├───────────────────────────────┤
│                               │
│ Main Content                  │
│                               │
├───────────────────────────────┤
│ Footer                        │
└───────────────────────────────┘
```

Administrator shell:

```text
┌──────────────┬────────────────┐
│              │ Header         │
│ Admin        ├────────────────┤
│ Sidebar      │                │
│              │ Main Content   │
│              │                │
└──────────────┴────────────────┘
```

---

# 5. Customer Layout

The customer-facing application should use a consistent global structure.

Typical layout:

```text
Header
  ↓
Main Navigation / Search
  ↓
Page Content
  ↓
Footer
```

The exact header and navigation behavior may change responsively.

---

# 6. Header

The header is a primary global navigation component.

It may contain:

```text
Logo
Navigation
Search
Wishlist
Cart
Authentication
User Menu
```

The desktop header may use a multi-area layout where appropriate.

The header must remain contained within the viewport and must not create horizontal overflow.

---

# 7. Search Header Layout

The search experience is a core part of product discovery.

The search input should:

- Remain visually contained within the header.
- Adapt to available width.
- Support suggestions.
- Remain usable on smaller screens.
- Preserve appropriate vertical spacing.
- Avoid shrinking to an unusable width.
- Avoid causing header overflow.

Search suggestions should align with the search input and remain visually connected to it.

---

# 8. Main Content Container

Pages should use a shared content-container strategy.

Conceptually:

```text
Viewport
│
├── Outer spacing
│
└── Content Container
      │
      ├── Page Header
      ├── Main Content
      └── Supporting Content
```

The container should provide:

- Maximum content width
- Horizontal padding
- Responsive spacing
- Consistent alignment

The exact values are defined by the design system.

---

# 9. Page Header

Page headers should establish:

- Page title
- Description where needed
- Primary action
- Supporting actions
- Breadcrumbs where appropriate

Example:

```text
Page Title                         [Primary Action]

Supporting description
```

Page headers should maintain consistent vertical spacing from the main content.

---

# 10. Section Layout

Sections provide vertical organization within pages.

A typical section contains:

```text
Section Header
      ↓
Section Content
```

Section headers may include:

- Title
- Description
- Action
- Filter
- View control

Sections should use consistent spacing tokens.

---

# 11. Product Grid Layout

Product listings should use a responsive grid.

Conceptually:

```text
Desktop

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ Card │ │ Card │ │ Card │ │ Card │
└──────┘ └──────┘ └──────┘ └──────┘


Tablet

┌──────┐ ┌──────┐ ┌──────┐
│ Card │ │ Card │ │ Card │
└──────┘ └──────┘ └──────┘


Mobile

┌────────┐
│  Card  │
└────────┘

┌────────┐
│  Card  │
└────────┘
```

The exact number of columns is determined by available width and the approved Figma design.

---

# 12. Product Listing Layout

A product listing page may use:

```text
Page Header
     ↓
Search / Filters / Sort
     ↓
Product Grid
     ↓
Pagination
```

On larger screens, filters may appear as a sidebar.

On smaller screens, filters may become a drawer or dialog.

---

# 13. Search Results Layout

The search page should provide:

```text
Search Query
     ↓
Suggestions / Search Controls
     ↓
Filters + Sorting
     ↓
Results Count
     ↓
Product Grid
```

The layout should clearly distinguish:

- Search controls
- Results
- Empty state
- Loading state
- Error state

---

# 14. Product Details Layout

The product details page should prioritize product information and the primary purchase action.

Typical desktop structure:

```text
┌─────────────────┬────────────────────────┐
│                 │ Product Information    │
│ Product Gallery │ Price                  │
│                 │ Availability           │
│                 │ Specifications         │
│                 │ Purchase Actions       │
└─────────────────┴────────────────────────┘
```

Supporting content may follow:

```text
Product Details
      ↓
Specifications
      ↓
Recommendations
      ↓
Related Products
```

On mobile, the layout should stack vertically.

---

# 15. Cart Layout

The cart page may use:

```text
Page Header
     ↓
Cart Items              Order Summary
     ↓                        ↓
Quantity / Actions       Subtotal
                         Shipping
                         Total
                         Checkout
```

On smaller screens:

```text
Cart Items
    ↓
Order Summary
    ↓
Checkout
```

---

# 16. Wishlist Layout

The wishlist should reuse the product-grid layout where appropriate.

Typical structure:

```text
Page Header
     ↓
Wishlist Grid
```

When empty:

```text
Page Header
     ↓
Empty State
     ↓
Explore Products
```

---

# 17. Checkout Layout

Checkout should use a focused layout that minimizes unnecessary navigation.

Typical structure:

```text
Checkout
│
├── Shipping Information
├── Payment
└── Order Summary
```

A desktop layout may use:

```text
┌────────────────────────┬────────────────┐
│ Checkout Form          │ Order Summary  │
│                        │                │
│ Shipping               │ Products       │
│ Payment                │ Subtotal       │
│                        │ Total          │
└────────────────────────┴────────────────┘
```

On mobile, content should stack.

---

# 18. Order Confirmation Layout

After successful order creation:

```text
Success
   ↓
Order Number
   ↓
Order Summary
   ↓
Payment Status
   ↓
Invoice / Receipt
   ↓
Track Order
```

The primary next action should be visually clear.

---

# 19. Orders Layout

The orders page should present customer order history in a scannable structure.

Desktop may use:

```text
Orders
────────────────────────────────
Order # | Date | Total | Status
────────────────────────────────
...
```

Mobile may use order cards instead of a wide table.

---

# 20. Order Details Layout

Order details should organize information into clear sections:

```text
Order Header
     ↓
Order Status
     ↓
Products
     ↓
Payment Information
     ↓
Shipping Information
     ↓
Delivery Tracking
     ↓
Invoice / Receipt
```

The order number and current status should be easy to identify.

---

# 21. Delivery Tracking Layout

The delivery tracking screen should combine operational information with the map.

Desktop:

```text
┌──────────────────────┬───────────────────────┐
│ Delivery Information  │                       │
│ Status                │                       │
│ Timeline              │        MAP            │
│ Estimated Arrival    │                       │
│ Location              │                       │
└──────────────────────┴───────────────────────┘
```

Mobile:

```text
Delivery Status
      ↓
Timeline
      ↓
Estimated Arrival
      ↓
Map
```

The map must remain usable without overwhelming smaller screens.

---

# 22. Search by Image Layout

The image-search flow should use a focused layout:

```text
Search by Image
      ↓
Source Selection
      ↓
Upload / Camera
      ↓
Preview
      ↓
Processing
      ↓
Results
```

Camera capture should account for:

- Permission state
- Camera availability
- Mobile viewport
- Capture controls
- Cancel action

---

# 23. Recommendation Layout

Recommendation sections should be reusable across multiple pages.

Examples:

```text
Product Details
      ↓
You May Also Like
      ↓
Product Grid
```

or:

```text
Home
 ├── Recommended for You
 ├── Popular Products
 └── Frequently Bought Together
```

The same product-card layout should be reused.

---

# 24. Admin Layout

The admin application uses a dedicated dashboard shell.

Desktop:

```text
┌──────────────┬────────────────────────────┐
│              │ Header                     │
│ Sidebar      ├────────────────────────────┤
│              │ Page Header                │
│ Navigation   │                            │
│              │ Main Content               │
│              │                            │
└──────────────┴────────────────────────────┘
```

The sidebar contains administrative navigation.

---

# 25. Admin Dashboard Layout

The dashboard may use:

```text
Page Header
     ↓
Key Metrics
     ↓
Charts / Analytics
     ↓
Recent Orders
     ↓
Inventory / Alerts
```

Dashboard widgets should use consistent card and grid patterns.

---

# 26. Admin Data Layout

Administrative data pages may use:

```text
Page Header
     ↓
Filters / Search / Actions
     ↓
Data Table
     ↓
Pagination
```

For smaller screens, complex tables should adapt through:

- Horizontal scrolling where appropriate
- Responsive columns
- Card representation
- Alternative mobile presentation

The chosen approach should follow the Figma design.

---

# 27. Admin Product Layout

Typical product-management structure:

```text
Products
     ↓
Search / Filters
     ↓
Product Table
     ↓
Create / Edit Product
```

Product forms should use shared form components.

---

# 28. Admin Inventory Layout

Inventory management may use:

```text
Inventory
     ↓
Filters
     ↓
Stock Table
     ↓
Low Stock Alerts
     ↓
Stock Editing
```

Important inventory states should remain visually distinct.

---

# 29. Admin Order Layout

Order administration may use:

```text
Orders
     ↓
Filters
     ↓
Order Table
     ↓
Order Details
     ↓
Status / Payment / Delivery Actions
```

Destructive or irreversible actions should require appropriate confirmation.

---

# 30. Admin Delivery Layout

Delivery management should provide:

```text
Active Deliveries
     ↓
Delivery List
     ↓
Delivery Details
     ↓
Map
     ↓
Status / Location Controls
```

Administrators may update:

- Delivery status
- Delivery location
- Shipment progress

---

# 31. Analytics Layout

Analytics pages should use a consistent hierarchy:

```text
Page Header
     ↓
Filters / Date Range
     ↓
Key Metrics
     ↓
Charts
     ↓
Detailed Tables
```

Charts should remain readable on smaller screens.

---

# 32. Navigation Responsiveness

Desktop navigation may use:

```text
Full Header
Full Navigation
```

Mobile navigation may use:

```text
Compact Header
Menu Trigger
Drawer / Sheet
```

The navigation should not require desktop-width assumptions on mobile.

---

# 33. Sidebar Responsiveness

The administrator sidebar may behave as:

```text
Desktop
Persistent Sidebar

Tablet
Collapsible Sidebar

Mobile
Drawer / Overlay Navigation
```

The exact behavior should follow the approved Figma design.

---

# 34. Layout Containers

Layouts should use consistent container primitives.

Conceptually:

```text
Page
 └── Container
      ├── Header
      ├── Content
      └── Footer / Supporting Content
```

Containers should control:

- Maximum width
- Horizontal padding
- Alignment
- Responsive spacing

---

# 35. Grid System

The layout system may use CSS Grid for:

- Product grids
- Dashboard cards
- Admin layouts
- Multi-column forms
- Content sections

Grid behavior should be responsive rather than fixed to one viewport size.

---

# 36. Flex Layouts

Flexbox should be used for:

- Navigation
- Toolbars
- Button groups
- Inline controls
- Alignment
- Card internals
- Header regions

Use Grid when the layout represents two-dimensional content relationships.

---

# 37. Forms Layout

Forms should use consistent field spacing and grouping.

Example:

```text
Form
 ├── Section
 │    ├── Field
 │    ├── Field
 │    └── Field
 │
 ├── Section
 │    ├── Field
 │    └── Field
 │
 └── Actions
```

Complex forms may use multiple columns on desktop and stack on mobile.

---

# 38. Loading Layouts

Loading layouts should preserve the expected page structure.

For example:

```text
Page
 ↓
Page Header Skeleton
 ↓
Filter Skeleton
 ↓
Product Grid Skeleton
```

Avoid replacing the entire page with an unrelated spinner when the final layout is known.

---

# 39. Empty Layouts

Empty states should occupy the same logical content area that populated content would use.

Example:

```text
Page Header
     ↓
Content Area
     ↓
Empty State
```

The empty state should not cause unexpected layout shifts.

---

# 40. Error Layouts

Error states should preserve the surrounding page structure when possible.

Example:

```text
Page Header
     ↓
Content Area
     ↓
Error State
     ↓
Retry
```

Global application failures may use a dedicated error boundary layout.

---

# 41. Footer

The customer footer may contain:

- Product navigation
- Support links
- Company information
- Policies
- Contact information
- Copyright

The footer should remain consistent across public customer pages.

Administrative pages may use a simplified or omitted footer depending on the final design.

---

# 42. Accessibility and Semantic Layout

Layouts must preserve:

- Logical heading hierarchy
- Semantic landmarks
- Keyboard navigation
- Focus order
- Readable content flow
- Responsive accessibility

Recommended landmarks include:

```text
<header>
<nav>
<main>
<aside>
<footer>
```

The exact semantic structure should reflect the actual content hierarchy.

---

# 43. Overflow Rules

The application should avoid unintended horizontal overflow.

Particular attention should be given to:

- Header search
- Navigation
- Product grids
- Tables
- Dialogs
- Maps
- Long product names
- Long order numbers

Horizontal scrolling should only be introduced where it is intentional and usable.

---

# 44. Layout and Figma

Every major page layout should correspond to an approved Figma design.

The implementation relationship is:

```text
Figma Layout
     ↓
Layout Specification
     ↓
React Layout Component
     ↓
SCSS / CSS Modules
```

Major deviations should be reviewed.

---

# 45. Layout Completion Criteria

A layout is considered complete when:

- Desktop behavior is defined.
- Tablet behavior is defined.
- Mobile behavior is defined.
- Containers are consistent.
- Navigation is responsive.
- Overflow is controlled.
- Loading states are considered.
- Empty states are considered.
- Error states are considered.
- Accessibility is considered.
- Figma and implementation are aligned.

---

# 46. Layout Principle

> **Layouts should provide a stable structure while allowing content and features to evolve independently.**

ElectroHub layouts should remain predictable, responsive, accessible, and consistent across customer and administrator experiences.
