# Layouts

## 1. Purpose

This document defines the layout architecture for ElectroHub.

The layout system establishes consistent rules for:

-   Application shells
-   Headers
-   Sidebars
-   Navigation
-   Containers
-   Grids
-   Sections
-   Forms
-   Tables
-   Customer screens
-   Administrator screens
-   Commerce flows
-   Delivery tracking
-   Responsive behavior
-   Loading, empty, and error states

**Figma is the visual source of truth for the intended composition of
these layouts.** This document records the structural rules that
implementation must follow.

------------------------------------------------------------------------

# 2. Layout Principles

ElectroHub layouts follow these principles:

### Consistency

Repeated structures use shared layout components.

### Hierarchy

Navigation, content, actions, and supporting information must have a
clear visual relationship.

### Reusability

Page structures should be composed from shared shells, containers,
sections, and components.

### Responsiveness

Layouts adapt across:

``` text
Mobile
Tablet
Desktop
Large Desktop
```

### Accessibility

Responsive changes must preserve logical reading order, focus order,
semantic landmarks, and usable controls.

### No Overlap

Approved layouts must not produce unintended overlap between:

-   Header and sidebar
-   Cart and order summary
-   Checkout pipeline and order summary
-   Dashboard widgets
-   Orders-by-status content
-   Form actions and image-upload areas

------------------------------------------------------------------------

# 3. Layout Architecture

The application is organized as:

``` text
Application Shell
      ↓
Page Layout
      ↓
Section Layout
      ↓
Feature Layout
      ↓
Reusable Components
```

A page should compose these levels rather than recreate their structure
independently.

------------------------------------------------------------------------

# 4. Customer Application Shell

The customer shell follows:

``` text
┌─────────────────────────────────┐
│ Branded Header / Navigation     │
├─────────────────────────────────┤
│                                 │
│ Main Content                    │
│                                 │
├─────────────────────────────────┤
│ Footer                          │
└─────────────────────────────────┘
```

The Header remains the global customer navigation boundary.

The Main region contains page-specific content.

The Footer is used on public/customer pages where appropriate.

------------------------------------------------------------------------

# 5. Administrator Application Shell

The admin shell follows:

``` text
┌────────────────────────────────────────┐
│ Admin Header                           │
├──────────────┬─────────────────────────┤
│              │                         │
│ Sidebar      │ Main Content            │
│              │                         │
│ Navigation   │                         │
│              │                         │
└──────────────┴─────────────────────────┘
```

The approved admin shell is:

``` text
Admin Header
      ↓
Sidebar + Main Content
```

The sidebar begins below the header and must never overlay it.

------------------------------------------------------------------------

# 6. Customer Header Layout

The customer Header may contain:

``` text
ElectroHub Brand
Navigation
Search
Wishlist
Cart
Authentication / Account
```

Requirements:

-   Branding is part of the approved header.
-   Search remains usable.
-   Header content stays within the viewport.
-   No unintended horizontal overflow.
-   Navigation adapts for smaller screens.
-   Mobile navigation is used when desktop navigation no longer fits.

------------------------------------------------------------------------

# 7. Admin Header Layout

The Admin Header establishes the administrator context.

It follows the same ElectroHub branding principle while remaining
optimized for operational workflows.

The header is structurally independent from sidebar scrolling.

------------------------------------------------------------------------

# 8. Admin Sidebar Layout

The sidebar is a persistent navigation region on desktop.

Approved behavior:

``` text
Header
  ↓
Sticky Sidebar
  +
Scrollable Main
```

Requirements:

-   Collapse button at the top of the sidebar.
-   Sticky below the header.
-   Never cover the header.
-   Main content scrolls independently.
-   Main content width changes when sidebar expands/collapses.
-   Collapsed navigation remains usable.
-   Mobile may transition to drawer/overlay navigation.

------------------------------------------------------------------------

# 9. Main Content Container

Pages use a shared content-container strategy.

Conceptually:

``` text
Viewport
│
└── Page Container
      ├── Page Header
      ├── Sections
      └── Supporting Content
```

Approved horizontal page/container padding reference:

``` text
24px
```

A large-desktop 1440px reference is a design-intent value. It should not
automatically be treated as a CSS max-width unless implementation
establishes that behavior.

------------------------------------------------------------------------

# 10. Page Header

A page header establishes:

-   Page title
-   Description where useful
-   Primary action
-   Supporting actions
-   Breadcrumbs where appropriate

Typical structure:

``` text
Page Title                    [Primary Action]

Supporting description
```

On mobile, actions may stack beneath the title.

------------------------------------------------------------------------

# 11. Section Layout

A section follows:

``` text
Section Header
      ↓
Section Content
```

The header may contain:

-   Title
-   Description
-   Action
-   Filter
-   View control

Spacing must use the approved design-system rhythm.

------------------------------------------------------------------------

# 12. Product Discovery Layout

The discovery hierarchy is:

``` text
Home / Search / Products
        ↓
Search / Filters / Sort
        ↓
Results
        ↓
Product Grid
        ↓
Pagination
```

Customer discovery surfaces include:

-   Home
-   Products
-   Search
-   Categories
-   Wishlist
-   Recommendations

------------------------------------------------------------------------

# 13. Product Grid

The product grid is responsive.

Design intent:

``` text
Desktop → Multi-column
Tablet  → Reduced columns
Mobile  → Single-column / compact arrangement
```

The exact number of columns follows the approved Figma screen at each
target viewport.

Cards must not overlap or become unreadable because of fixed-width
assumptions.

------------------------------------------------------------------------

# 14. Product Listing Layout

Typical structure:

``` text
Page Header
     ↓
Search / Filters / Sort
     ↓
Results Count
     ↓
Product Grid
     ↓
Pagination
```

On larger screens, filters may occupy a sidebar region.

On smaller screens, complex filters may move into a Drawer.

------------------------------------------------------------------------

# 15. Search Layout

Search is a core product-discovery layout.

``` text
Search Query
     ↓
Search Controls
     ↓
Filters / Sort
     ↓
Results
```

Search must distinguish:

-   Loading
-   Results
-   No Results
-   Error

Search-by-image is part of the Search experience rather than a
disconnected page.

------------------------------------------------------------------------

# 16. Search-by-Image Layout

The image-search layout follows:

``` text
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
Matching Results
```

States:

-   Upload
-   Camera
-   Preview
-   Processing
-   Results
-   No Results
-   Error

The primary UI is an upload/camera interaction with constrained image
preview.

------------------------------------------------------------------------

# 17. Product Details Layout

Desktop intent:

``` text
┌──────────────────────┬─────────────────────────┐
│ Product Gallery      │ Product Information     │
│                      │ Price                   │
│ Main Product Image   │ Availability            │
│                      │ Specifications          │
│                      │ Quantity                │
│                      │ Purchase Actions        │
└──────────────────────┴─────────────────────────┘
```

Supporting content:

``` text
Product Details
      ↓
Specifications
      ↓
Recommendations
      ↓
Related Products
```

Mobile:

``` text
Gallery
  ↓
Information
  ↓
Price / Availability
  ↓
Quantity / Actions
  ↓
Details
  ↓
Recommendations
```

------------------------------------------------------------------------

# 18. Wishlist Layout

Typical:

``` text
Page Header
     ↓
Wishlist Product Grid
```

Empty:

``` text
Page Header
     ↓
Empty State
     ↓
Explore Products
```

Reuse Product Card rather than creating a separate wishlist card.

------------------------------------------------------------------------

# 19. Cart Layout

Desktop:

``` text
┌──────────────────────────┬────────────────────┐
│ Cart Items               │ Order Summary      │
│                          │                    │
│ Product / Quantity       │ Subtotal           │
│ Actions                  │ Shipping           │
│                          │ Total              │
│                          │ Checkout           │
└──────────────────────────┴────────────────────┘
```

The cart content and order summary must remain visually separated.

Mobile:

``` text
Cart Items
     ↓
Order Summary
     ↓
Checkout
```

The mobile cart must scroll naturally and must not trap or hide content.

------------------------------------------------------------------------

# 20. Checkout Layout

Checkout is a focused purchase flow.

``` text
Cart
  ↓
Shipping Information
  ↓
Payment
  ↓
Processing
  ↓
Success / Failure
  ↓
Order Confirmation
```

Desktop:

``` text
┌──────────────────────────────┬──────────────────┐
│ Checkout Pipeline / Form     │ Order Summary     │
│                              │                  │
│ Shipping                     │ Products         │
│ Payment                      │ Subtotal         │
│                              │ Total             │
└──────────────────────────────┴──────────────────┘
```

The pipeline and summary must never overlap.

Mobile:

``` text
Checkout Steps
     ↓
Form
     ↓
Order Summary
     ↓
Primary Action
```

------------------------------------------------------------------------

# 21. Payment States

Payment layout must account for:

``` text
Payment Form
     ↓
Processing
     ↓
Success
     OR
Failure
```

Processing must communicate that the operation is in progress.

Failure must provide a clear recovery path where possible.

------------------------------------------------------------------------

# 22. Order Confirmation Layout

Successful completion follows:

``` text
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

The next action should be clearly prioritized.

------------------------------------------------------------------------

# 23. Orders Layout

Customer order history may use:

``` text
Orders
────────────────────────────────────
Order # | Date | Total | Status
────────────────────────────────────
...
```

On mobile, use a card or stacked representation when a table would
become unreadable.

------------------------------------------------------------------------

# 24. Order Details Layout

Order details hierarchy:

``` text
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

The order number and current status should be immediately scannable.

------------------------------------------------------------------------

# 25. Delivery Tracking Layout

Desktop:

``` text
┌────────────────────────┬────────────────────────┐
│ Delivery Information   │                        │
│ Current Status         │          MAP           │
│ Timeline               │                        │
│ Estimated Arrival      │                        │
│ Location               │                        │
└────────────────────────┴────────────────────────┘
```

Mobile:

``` text
Delivery Status
      ↓
Timeline
      ↓
Estimated Arrival
      ↓
Map
```

The map must remain usable without dominating the mobile viewport.

------------------------------------------------------------------------

# 26. Recommendations Layout

Recommendations reuse the standard product-grid system.

Examples:

``` text
Product Details
      ↓
You May Also Like
      ↓
Product Grid
```

or:

``` text
Home
 ├── Recommended for You
 ├── Popular Products
 └── Frequently Bought Together
```

Do not create separate layout systems for each recommendation type.

------------------------------------------------------------------------

# 27. Admin Dashboard Layout

The dashboard hierarchy is:

``` text
Page Header
     ↓
Stats Cards
     ↓
Sales Overview
     ↓
Orders by Status
     ↓
Additional Analytics / Operational Data
```

The dashboard must reflow on smaller screens.

### Sales Overview

The chart container must resize with available width.

### Orders by Status

Mixed content must not overlap.

On narrow screens, items stack safely.

------------------------------------------------------------------------

# 28. Admin Data Layout

Typical:

``` text
Page Header
     ↓
Filter Bar
     ↓
Data Table
     ↓
Pagination
```

Responsive table behavior may include:

-   Horizontal scrolling when appropriate
-   Reduced columns
-   Stacked cards
-   Alternative mobile representation

The chosen representation follows the approved Figma screen.

------------------------------------------------------------------------

# 29. Admin Product Layout

``` text
Products
     ↓
Search / Filters
     ↓
Product Table
     ↓
Create / Edit Product
```

Create/Edit forms use the shared Admin Form and foundation components.

------------------------------------------------------------------------

# 30. Create/Edit Product Layout

The product form should clearly separate:

``` text
Product Information
      +
Image Upload
      +
Form Actions
```

Image upload:

``` text
Empty State
     ↓
Upload Image
     ↓
Constrained Preview
     ↓
Replace / Remove
```

The upload control must remain visible and usable.

Do not expose a raw URL field as the primary image-selection experience.

------------------------------------------------------------------------

# 31. Admin Inventory Layout

Typical:

``` text
Inventory
     ↓
Filters
     ↓
Stock Table
     ↓
Low Stock / Inventory Alerts
     ↓
Stock Actions
```

Inventory statuses use the shared semantic status language.

------------------------------------------------------------------------

# 32. Admin Order Layout

``` text
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

Destructive actions require appropriate confirmation.

------------------------------------------------------------------------

# 33. Admin Delivery Layout

``` text
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

The layout must distinguish operational controls from read-only delivery
information.

------------------------------------------------------------------------

# 34. Analytics Layout

``` text
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

Charts must remain readable on tablet and mobile.

------------------------------------------------------------------------

# 35. Forms Layout

Forms use consistent grouping:

``` text
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

Desktop may use multiple columns when the Figma layout supports it.

Mobile should stack fields into a readable single flow.

------------------------------------------------------------------------

# 36. Navigation Responsiveness

Desktop:

``` text
Full Header
Full Navigation
```

Mobile:

``` text
Compact Header
Menu Trigger
Mobile Navigation / Drawer
```

The mobile layout must preserve access to:

-   Home
-   Products
-   Search
-   Cart
-   Orders
-   Account

according to the approved information architecture.

------------------------------------------------------------------------

# 37. Sidebar Responsiveness

Desktop:

``` text
Persistent Sidebar
```

Tablet:

``` text
Collapsible Sidebar
```

Mobile:

``` text
Drawer / Overlay Navigation
```

The exact breakpoint behavior follows the approved Figma responsive
composition.

------------------------------------------------------------------------

# 38. Responsive Reference Values

Figma design-intent references include:

``` text
768px  → tablet / medium reference
1440px → large desktop reference
```

These values describe design references and are not automatically CSS
media-query requirements.

The project should avoid creating duplicate breakpoint tokens when the
implementation framework already provides equivalent defaults.

------------------------------------------------------------------------

# 39. Spacing and Layout Rhythm

The design uses a 4px spacing foundation.

Common verified values include:

``` text
16px
24px
32px
48px
```

Horizontal page/container padding reference:

``` text
24px
```

Layout implementations should consume the existing spacing system
instead of inventing local spacing scales.

------------------------------------------------------------------------

# 40. Loading Layouts

Loading states should preserve the final page structure.

Example:

``` text
Page Header
     ↓
Filter Skeleton
     ↓
Content Skeleton
```

Use Skeleton when the eventual layout is known.

Use Spinner for short indeterminate operations where replacing the
content structure is unnecessary.

------------------------------------------------------------------------

# 41. Empty Layouts

Empty states occupy the same logical content region as populated
content.

Examples:

``` text
Wishlist
   ↓
Empty State
```

``` text
Orders
   ↓
No Orders
```

``` text
Search
   ↓
No Search Results
```

An empty state should not cause unexpected layout shifts.

------------------------------------------------------------------------

# 42. Error Layouts

Error states preserve surrounding structure when possible:

``` text
Page Header
     ↓
Content Area
     ↓
Error State
     ↓
Retry
```

Global failures may use a dedicated error boundary layout.

------------------------------------------------------------------------

# 43. Modal, Drawer, and Overlay Layouts

Overlays must:

-   Remain within viewport bounds.
-   Avoid clipping.
-   Preserve focus behavior.
-   Prevent inappropriate background interaction.
-   Respect mobile viewport constraints.
-   Avoid covering critical navigation unnecessarily.

Functional elevation is acceptable for floating UI even though the
overall visual system is predominantly flat.

------------------------------------------------------------------------

# 44. Grid and Flex Rules

Use CSS Grid for two-dimensional structures such as:

-   Product grids
-   Dashboard grids
-   Multi-column content
-   Complex admin arrangements

Use Flexbox for:

-   Navigation
-   Toolbars
-   Inline controls
-   Button groups
-   Header regions
-   Alignment
-   Card internals

The choice should follow the relationship represented by the layout
rather than habit.

------------------------------------------------------------------------

# 45. Overflow Rules

Avoid unintended horizontal overflow.

Review carefully:

-   Header search
-   Navigation
-   Product grids
-   Tables
-   Dialogs
-   Maps
-   Long product names
-   Long order numbers
-   Admin dashboard charts

Horizontal scrolling is acceptable only when intentional and usable,
especially for genuinely tabular data.

------------------------------------------------------------------------

# 46. Semantic Layout

Use appropriate landmarks:

``` html
<header>
<nav>
<main>
<aside>
<footer>
```

Maintain:

-   Logical heading hierarchy
-   Correct reading order
-   Keyboard focus order
-   Meaningful landmarks
-   Accessible responsive behavior

------------------------------------------------------------------------

# 47. Figma-to-Layout Workflow

The layout implementation process is:

``` text
Approved Figma Layout
        ↓
Layout Rules
        ↓
React Layout / Shell
        ↓
SCSS / CSS Modules
        ↓
Responsive Implementation
        ↓
Visual Validation
```

Major layout deviations require review.

------------------------------------------------------------------------

# 48. Final Figma Layout Corrections Incorporated

The final QA pass established:

-   Customer and admin branding is present in the headers.
-   Admin sidebar collapse control is at the top.
-   Sidebar is sticky below the header.
-   Main content scrolls independently.
-   Sidebar collapse resizes main content.
-   Header is never covered by sidebar behavior.
-   Browse Deals CTA remains readable in its default state.
-   "New Season 2026" is a compact promotional eyebrow rather than an
    oversized heading.
-   Cart content and order summary do not overlap.
-   Checkout pipeline and order summary do not overlap.
-   Mobile cart scrolls correctly.
-   Admin Sales Overview responds to available width.
-   Orders by Status avoids mixed-item overlap and stacks safely on
    mobile.
-   Product image upload has a visible control and constrained preview.

------------------------------------------------------------------------

# 49. Layout Completion Criteria

A layout is complete when:

-   Approved Figma composition exists.
-   Desktop behavior is defined.
-   Tablet behavior is defined.
-   Mobile behavior is defined.
-   Containers are consistent.
-   Navigation is responsive.
-   Sidebar behavior is defined where applicable.
-   Overflow is controlled.
-   Loading states are considered.
-   Empty states are considered.
-   Error states are considered.
-   Accessibility is considered.
-   Primary actions remain accessible.
-   No unintended overlap exists.
-   Implementation has been visually validated against Figma.

------------------------------------------------------------------------

# 51. Figma Repository Export Structure

This layout documentation follows the approved repository-side Figma asset structure:

```text
assets/
└── figma/
    ├── FIGMA.md
    ├── FIGMA_IMPLEMENTATION_RULES.md
    ├── FIGMA_REFERENCES.md
    │
    └── exports/
        │
        ├── Components/
        │   ├── README.md
        │   └── screenshots/
        │
        ├── admin/
        │   ├── README.md
        │   └── screenshots/
        │
        └── customer/
            ├── README.md
            └── screenshots/
```

### Responsibilities

- `assets/figma/FIGMA.md` — consolidated Figma governance, source-of-truth, handoff, and design context.
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules for translating approved Figma layouts into the application.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and reference navigation.
- `assets/figma/exports/Components/README.md` — component screenshot/reference package.
- `assets/figma/exports/admin/README.md` — administrator layout/screen reference package.
- `assets/figma/exports/customer/README.md` — customer layout/screen reference package.
- Each corresponding `screenshots/` directory contains supporting Figma Make visual evidence.

**Figma Design remains authoritative for layout composition and responsive intent. Figma Make screenshots are supporting visual references only.**

The previous export categories `Layouts/`, `Foundation/`, `screens/`, and `responsive/` are not part of the approved repository export structure and must not be recreated.

For Figma Make screenshots, preserve the filename generated by Figma Make. Do not introduce manual naming patterns such as `<Screen> — Desktop/Tablet/Mobile.png`. Context is provided by the destination folder and README.

The responsive layout rules themselves remain documented in `docs/02_Design/RESPONSIVE.md`; the repository export structure is only the evidence/reference organization.

------------------------------------------------------------------------

# 50. Layout Principle

> **Layouts provide the stable structural framework that allows
> ElectroHub features and content to evolve without breaking
> consistency, responsiveness, or usability.**
