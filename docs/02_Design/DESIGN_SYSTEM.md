# Design System

## 1. Purpose

This document defines the visual and interaction system used throughout
ElectroHub.

The design system provides a shared foundation for:

-   Colors
-   Typography
-   Spacing
-   Layout
-   Components
-   Icons
-   Motion
-   States
-   Responsive behavior
-   Accessibility

The goal is to ensure that the customer application and administrator
application feel like parts of the same product.

------------------------------------------------------------------------

# 2. Design System Principles

The ElectroHub design system follows these principles:

### Consistency

The same visual and interaction patterns should be reused throughout the
application.

### Clarity

Interfaces should communicate purpose and state clearly.

### Accessibility

Components should be usable through different interaction methods and
should provide appropriate focus, contrast, and semantic behavior.

### Responsiveness

Components should adapt gracefully across supported viewport sizes.

### Reusability

Repeated patterns should be implemented as reusable components.

### Custom Identity

The interface should have a distinctive ElectroHub visual identity
rather than resembling a generic UI framework.

------------------------------------------------------------------------

# 3. Design Source of Truth

Figma is the primary source of truth for the intended visual design.

The implementation stack is:

Figma ↓ Design Tokens ↓ SCSS ↓ CSS Modules ↓ React Components

Radix UI may provide interaction and accessibility primitives, but it
does not define the application's visual appearance.

------------------------------------------------------------------------

# 4. Design System Foundations

The design system is built from the following foundations:

-   Colors
-   Typography
-   Spacing
-   Grid
-   Borders
-   Radius
-   Shadows
-   Icons
-   Motion
-   Breakpoints
-   Components
-   States

Each foundation should be defined consistently in Figma and reflected in
the implementation.

------------------------------------------------------------------------

# 5. Colors

The color system should define semantic roles rather than encouraging
arbitrary color usage.

Examples of semantic roles:

-   Primary
-   Primary Hover
-   Primary Active
-   Secondary
-   Background
-   Surface
-   Surface Elevated
-   Text Primary
-   Text Secondary
-   Text Muted
-   Border
-   Success
-   Warning
-   Error
-   Info

Colors should be documented in:

docs/02_Design/COLORS.md

Components should consume semantic colors rather than hard-coded values
whenever practical.

------------------------------------------------------------------------

# 6. Typography

Typography should define:

-   Font family
-   Font sizes
-   Font weights
-   Line heights
-   Letter spacing
-   Heading hierarchy
-   Body text
-   Labels
-   Captions

Example hierarchy:

-   Display
-   Heading 1
-   Heading 2
-   Heading 3
-   Heading 4
-   Body Large
-   Body
-   Body Small
-   Caption
-   Label

Typography decisions are documented in:

docs/02_Design/TYPOGRAPHY.md

------------------------------------------------------------------------

# 7. Spacing

Spacing should use a consistent scale.

Spacing controls:

-   Component padding
-   Component gaps
-   Section spacing
-   Grid gaps
-   Form spacing
-   Page spacing

Example conceptual scale:

-   XS
-   SM
-   MD
-   LG
-   XL
-   2XL
-   3XL

The actual values should be defined by the approved Figma design tokens.

------------------------------------------------------------------------

# 8. Layout

The design system should provide consistent layout rules for:

-   Page containers
-   Sections
-   Columns
-   Grids
-   Flex layouts
-   Content widths
-   Alignment
-   Vertical rhythm

Layouts should avoid arbitrary positioning when a reusable layout
pattern can be used.

------------------------------------------------------------------------

# 9. Border Radius

Radius tokens should provide consistent corner treatment.

Examples:

-   None
-   Small
-   Medium
-   Large
-   XL
-   Pill

Radius should be used consistently across:

-   Cards
-   Buttons
-   Inputs
-   Dialogs
-   Images
-   Badges
-   Containers

------------------------------------------------------------------------

# 10. Shadows

Shadows should communicate elevation rather than decorate every
component.

Typical levels:

-   None
-   Small
-   Medium
-   Large
-   Elevated

Shadows should remain subtle and consistent with the overall visual
direction.

------------------------------------------------------------------------

# 11. Icons

Icons use Lucide React in the implementation.

Icons should:

-   Have consistent visual weight.
-   Use appropriate sizes.
-   Align with surrounding text.
-   Have accessible labels when necessary.
-   Avoid communicating critical information through icons alone.

The icon system is documented in:

docs/02_Design/ICONS.md

------------------------------------------------------------------------

# 12. Motion

Motion should provide useful feedback rather than unnecessary
decoration.

Motion may be used for:

-   Page transitions
-   Hover interactions
-   Dialogs
-   Dropdowns
-   Loading transitions
-   Success feedback
-   Error feedback
-   Delivery updates

Framer Motion is the approved animation library.

Reduced-motion preferences must be respected.

Motion standards are documented in:

docs/02_Design/MOTION.md

------------------------------------------------------------------------

# 13. Component Architecture

The design system is implemented through reusable React components.

Conceptually:

Design Tokens ↓ Primitives ↓ Components ↓ Feature Components ↓ Pages

Examples:

Button ↓ Product Card ↓ Product Grid ↓ Product Listing Page

------------------------------------------------------------------------

# 14. Component States

Components should define meaningful interaction states.

Common states include:

-   Default
-   Hover
-   Focus
-   Active
-   Disabled
-   Loading
-   Success
-   Error
-   Empty
-   Selected

Not every component requires every state.

States should reflect actual application behavior.

------------------------------------------------------------------------

# 15. Buttons

Buttons should have clearly defined:

-   Variants
-   Sizes
-   States
-   Icons
-   Loading behavior
-   Disabled behavior

Example:

-   Primary
-   Secondary
-   Ghost
-   Danger

Button hierarchy should reflect action importance.

------------------------------------------------------------------------

# 16. Inputs

Inputs should provide consistent:

-   Label
-   Placeholder
-   Value
-   Focus
-   Error
-   Disabled
-   Helper text

Search inputs should additionally support:

-   Suggestions
-   Loading
-   No results
-   Clear action
-   Keyboard interaction

------------------------------------------------------------------------

# 17. Cards

Cards should provide consistent structure and spacing.

Product cards may include:

-   Image
-   Brand
-   Product Name
-   Rating
-   Price
-   Availability
-   Actions

Cards should support meaningful states such as:

-   Default
-   Hover
-   Loading
-   Out of Stock
-   Low Stock
-   Featured

------------------------------------------------------------------------

# 18. Forms

Forms should use consistent:

-   Field spacing
-   Labels
-   Validation
-   Error messages
-   Required indicators
-   Submit states
-   Success feedback

Forms must remain accessible and keyboard-friendly.

------------------------------------------------------------------------

# 19. Feedback Components

The design system should provide consistent feedback patterns for:

-   Success
-   Error
-   Warning
-   Information
-   Loading

Examples include:

-   Toast
-   Alert
-   Inline Error
-   Dialog
-   Skeleton
-   Spinner
-   Empty State

------------------------------------------------------------------------

# 20. Loading States

Loading states should communicate what content is being loaded.

Skeletons should approximate the final content structure rather than
displaying arbitrary blank blocks.

Examples:

-   Product Card Skeleton
-   Product Details Skeleton
-   Order Skeleton
-   Table Skeleton
-   Dashboard Skeleton

------------------------------------------------------------------------

# 21. Empty States

Empty states should explain:

1.  What is empty.
2.  Why it may be empty when useful.
3.  What the user can do next.

Example:

Your wishlist is empty.

Save products here to find them later.

\[Explore Products\]

Empty states should provide an appropriate action whenever one exists.

------------------------------------------------------------------------

# 22. Error States

Error states should:

-   Explain what happened.
-   Avoid exposing technical details unnecessarily.
-   Provide a recovery action when possible.

Example:

Something went wrong.

We couldn't load your orders.

\[Try Again\]

------------------------------------------------------------------------

# 23. Navigation

Navigation should remain consistent across customer and administrator
experiences.

The system should define:

-   Header
-   Sidebar
-   Mobile navigation
-   Breadcrumbs where appropriate
-   Active states
-   Focus states

Navigation behavior should be documented in `LAYOUTS.md`.

------------------------------------------------------------------------

# 24. Product Experience

Product interfaces should maintain consistent patterns across:

-   Product cards
-   Product listing
-   Product details
-   Search
-   Categories
-   Recommendations

Product information hierarchy should prioritize:

Product ↓ Price ↓ Availability ↓ Key information ↓ Primary action

------------------------------------------------------------------------

# 25. Checkout Experience

Checkout should use a clear visual hierarchy.

The system should consistently represent:

Cart ↓ Shipping ↓ Payment ↓ Confirmation

Important states include:

-   Validation
-   Payment processing
-   Payment failure
-   Payment success
-   Order creation
-   Order confirmation

------------------------------------------------------------------------

# 26. Order Experience

Order interfaces should clearly communicate:

-   Order number
-   Date
-   Products
-   Total
-   Payment status
-   Order status
-   Delivery status
-   Invoice
-   Payment receipt

Status presentation should remain consistent throughout the application.

------------------------------------------------------------------------

# 27. Delivery Tracking

Delivery tracking should combine:

Status + Timeline + Map + Location + Estimated Arrival

The visual hierarchy should allow the user to understand delivery
progress quickly.

------------------------------------------------------------------------

# 28. Search by Image

The search-by-image experience should follow a consistent flow:

Choose Image ↓ Preview ↓ Analyze ↓ Results

The design system should define states for:

-   Upload
-   Camera
-   Preview
-   Processing
-   Results
-   No results
-   Error

------------------------------------------------------------------------

# 29. Recommendations

Recommendation sections should have consistent:

-   Section headers
-   Product-card patterns
-   Loading states
-   Empty states
-   Error handling

Examples:

-   Recommended for You
-   You May Also Like
-   Similar Products
-   Frequently Bought Together

------------------------------------------------------------------------

# 30. Admin Design System

The administrator interface should reuse the same design foundations.

Admin-specific patterns include:

-   Data tables
-   Filters
-   Pagination
-   Bulk actions
-   Status badges
-   Confirmation dialogs
-   Analytics cards
-   Dashboard widgets
-   Forms

The admin interface should feel like the same product while being
optimized for operational workflows.

------------------------------------------------------------------------

# 31. Responsive Behavior

Components must support:

-   Mobile
-   Tablet
-   Desktop
-   Large Desktop

Responsive behavior should be defined at the component and page levels.

Avoid designing desktop-only components that cannot adapt to smaller
screens.

------------------------------------------------------------------------

# 32. Accessibility

The design system must consider:

-   Keyboard navigation
-   Focus visibility
-   Color contrast
-   Semantic structure
-   Screen-reader compatibility
-   Form labels
-   Error messages
-   Touch target size
-   Reduced motion

Accessibility is a design requirement, not a final-stage enhancement.

------------------------------------------------------------------------

# 33. Design Tokens and Implementation

Design tokens should be shared conceptually between Figma and the
implementation.

Examples:

--color-primary --color-surface --color-text-primary --spacing-md
--radius-md --shadow-sm

The exact implementation naming convention should follow the SCSS
standards.

------------------------------------------------------------------------

# 34. UI Library Boundary

Radix UI is used for behavior and accessibility primitives.

It does not replace the ElectroHub design system.

The intended architecture is:

Radix UI ↓ Behavior

ElectroHub Design System ↓ Visual Identity

SCSS / CSS Modules ↓ Implementation

------------------------------------------------------------------------

# 35. Component Documentation

Each important reusable component should document:

-   Purpose
-   Variants
-   Props
-   States
-   Accessibility behavior
-   Responsive behavior
-   Usage restrictions

Component documentation belongs in:

docs/02_Design/COMPONENTS.md

------------------------------------------------------------------------

# 36. Design Review

Before a major UI feature is implemented, verify:

-   Figma design exists.
-   Design tokens are defined.
-   Components are reusable.
-   States are defined.
-   Responsive behavior is defined.
-   Accessibility is considered.
-   Empty and error states are designed.

------------------------------------------------------------------------

# 37. Design System Completion Criteria

The design system is considered complete when:

-   Foundations are defined.
-   Design tokens are established.
-   Typography is defined.
-   Colors are defined.
-   Spacing is defined.
-   Components are documented.
-   Component states are defined.
-   Responsive behavior is defined.
-   Motion rules are defined.
-   Accessibility requirements are incorporated.
-   Figma and implementation terminology are aligned.

------------------------------------------------------------------------

# 38. Design System Principle

> **Build reusable visual rules and components rather than styling every
> screen independently.**

The ElectroHub design system should make the interface consistent,
scalable, accessible, and visually distinctive across the entire
product.

------------------------------------------------------------------------

# 41. Final Figma-Derived Design System Update --- ElectroHub

This section records the finalized design-system baseline established
during the complete Figma/Figma Make work.

## 41.1 Visual Source of Truth

**Figma is the visual source of truth.**

Figma is authoritative for the intended visual design, including:

-   Visual appearance
-   Component composition
-   Variants
-   States
-   Layout relationships
-   Responsive composition
-   Interaction intent
-   Prototype flows
-   Visual QA reference

`docs/02_Design/` documents the decisions derived from that design.

The implementation is authoritative for runtime behavior and technical
constraints.

``` text
Figma
  ↓
Design Decisions
  ↓
Tokens / Styles
  ↓
SCSS / CSS Modules
  ↓
React Components
  ↓
Feature UI
  ↓
Pages
```

------------------------------------------------------------------------

## 41.2 Foundation Color System

### Primary

  Token                Value
  -------------------- -----------
  Primary              `#2563EB`
  Primary Hover        `#1D4ED8`
  Primary Foreground   `#FFFFFF`

### Accent

  Token    Value
  -------- -----------
  Accent   `#06B6D4`

### Neutral

The system includes a Slate 900 → Slate 50 neutral scale.

Semantic roles:

-   Text Primary
-   Text Secondary
-   Text Muted
-   Background
-   Surface
-   Surface Elevated
-   Border Default
-   Border Subtle

Verified muted/placeholder:

`#64748B`

### Status

-   Success
-   Warning
-   Error
-   Info
-   Neutral

### Rating

``` text
Fill   → #FDE68A
Stroke → #B45309
```

Detailed definitions belong in `COLORS.md`.

------------------------------------------------------------------------

## 41.3 Typography System

### UI

**Poppins**

Weights:

-   400
-   500
-   600
-   700

### Data / Monospace

**JetBrains Mono**

Weights:

-   400
-   500
-   600
-   700

Canonical family:

``` text
--font-mono: 'JetBrains Mono', monospace
```

Inter is not part of the active design system.

### Type Scale

  Role     Size
  ------ ------
  XS       12px
  SM       14px
  MD       16px
  LG       18px
  XL       24px
  2XL      30px
  3XL      36px
  4XL      48px

Verified line-height details:

-   2XL: 40px
-   4XL: 56px

------------------------------------------------------------------------

## 41.4 Spacing

The design follows a 4px spacing foundation.

Common verified values:

-   16px
-   24px
-   32px
-   48px

Reuse an existing project/framework spacing value when it already
represents the approved design value.

Do not create duplicate tokens without a reason.

------------------------------------------------------------------------

## 41.5 Semantic Sizing

  Token             Value
  --------------- -------
  Control            40px
  Control Small      32px
  Control Large      48px
  Icon               24px
  Icon Small         20px
  Avatar Medium      40px
  Thumbnail          64px
  Product Image     240px

------------------------------------------------------------------------

## 41.6 Radius

Verified decisions:

  Token         Value
  ----------- -------
  XL             16px
  Avatar         15px
  Thumbnail       5px
  Modal          12px

An unverified generic 8px `lg` radius was removed from the approved
system.

------------------------------------------------------------------------

## 41.7 Elevation

The visual direction is predominantly flat.

Default component treatment should avoid decorative shadows.

Functional elevation may be used for:

-   Dialogs
-   Modals
-   Drawers
-   Dropdowns
-   Floating surfaces
-   Overlays

Functional shadows are not automatically design tokens unless explicitly
established by Figma.

------------------------------------------------------------------------

## 41.8 Grid, Container, and Breakpoint Intent

Figma design-intent references include:

-   768px medium/tablet reference
-   1440px large-desktop reference

These are design references and should not automatically become CSS
media-query thresholds.

Verified horizontal page/container padding:

`24px`

A 1440px maximum content width is a derived large-desktop intent unless
implementation evidence establishes it as an explicit CSS constraint.

------------------------------------------------------------------------

## 41.9 Focus

Approved focus treatment:

``` text
2px primary-blue ring
2px offset
```

Use a shared focus pattern.

------------------------------------------------------------------------

## 41.10 Component System

The completed system contains 42 components.

### Tier 1 --- Foundation

1.  Button
2.  Icon Button
3.  Input
4.  Textarea
5.  Select
6.  Checkbox
7.  Radio
8.  Switch
9.  Badge
10. Avatar
11. Tooltip

### Tier 2 --- Navigation

12. Header
13. Sidebar
14. Breadcrumb
15. Tabs
16. Pagination
17. Dropdown
18. Mobile Navigation

### Tier 3 --- Feedback

19. Alert
20. Toast
21. Modal
22. Drawer
23. Dialog
24. Spinner
25. Skeleton
26. Error State
27. Empty State

### Tier 4 --- Commerce

28. Product Card
29. Product Image
30. Product Gallery
31. Price
32. Rating
33. Quantity Selector
34. Cart Item
35. Order Status
36. Payment Status

### Tier 5 --- Admin

37. Data Table
38. Filter Bar
39. Stats Card
40. Chart Container
41. Admin Form
42. Status Badge

------------------------------------------------------------------------

## 41.11 Component Behavior and QA Contracts

### Checkbox

-   Supports indeterminate state.
-   Uses the correct peer/focus structure.
-   Provides visible focus.

### Radio

-   Uses a direct peer relationship for the selected indicator.

### Navigation

Header, Sidebar, Dropdown, and Mobile Navigation use the approved border
token.

### Dropdown

Unused imports were removed during correction.

### Price

Price/data presentation uses JetBrains Mono with the approved weight
treatment.

### Data Table

DataTable uses the shared Checkbox component, including indeterminate
behavior.

------------------------------------------------------------------------

## 41.12 Button System

Approved action hierarchy:

-   Primary
-   Secondary
-   Ghost
-   Danger

Buttons support:

-   Variants
-   Sizes
-   States
-   Icons
-   Loading
-   Disabled behavior

Typography must use the established type system.

Hero CTA text must remain readable in the default state as well as
hover/focus states.

------------------------------------------------------------------------

## 41.13 Navigation and Shells

### Customer

-   Branded Header
-   Primary Navigation
-   Main Content
-   Mobile Navigation where applicable
-   Footer where applicable

### Administrator

-   Admin Header
-   Sidebar
-   Main Content

Sidebar requirements:

-   Collapse control at the top
-   Sticky below header
-   Independent main-content scrolling
-   No header overlap
-   Correct content resizing in expanded/collapsed states

------------------------------------------------------------------------

## 41.14 Product Experience

Hierarchy:

``` text
Product
  ↓
Price
  ↓
Availability
  ↓
Key Information
  ↓
Primary Action
```

Product cards may include:

-   Image
-   Brand
-   Product name
-   Rating
-   Price
-   Availability
-   Actions

Product details may include:

-   Product Gallery
-   Product Image
-   Price
-   Availability
-   Specifications
-   Quantity Selector
-   Add to Cart
-   Wishlist
-   Recommendations

------------------------------------------------------------------------

## 41.15 Search-by-Image Pattern

``` text
Choose Image
  ↓
Preview
  ↓
Analyze
  ↓
Results
```

States:

-   Upload
-   Camera
-   Preview
-   Processing
-   Matching Results
-   No Results
-   Error

Primary user interaction is upload/camera with constrained preview. Raw
URLs are implementation data.

------------------------------------------------------------------------

## 41.16 Cart and Checkout

### Cart

Desktop:

-   Cart content and summary use separate columns.

Mobile:

-   Content stacks.

### Checkout

``` text
Cart
  ↓
Shipping
  ↓
Payment
  ↓
Processing
  ↓
Success / Failure
  ↓
Order Confirmation
```

No overlap is acceptable.

------------------------------------------------------------------------

## 41.17 Orders and Delivery

Order information includes:

-   Order number
-   Date
-   Products
-   Total
-   Payment status
-   Order status
-   Delivery status
-   Invoice
-   Payment receipt

Delivery combines:

``` text
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

------------------------------------------------------------------------

## 41.18 Administrator System

Admin patterns:

-   Data Table
-   Filter Bar
-   Pagination
-   Bulk actions
-   Stats Card
-   Chart Container
-   Admin Form
-   Status Badge
-   Confirmation dialogs
-   Dashboard widgets

Admin areas:

-   Dashboard
-   Products
-   Categories
-   Inventory
-   Orders
-   Delivery
-   Customers
-   Analytics
-   Settings

The admin UI must retain the same ElectroHub design language.

------------------------------------------------------------------------

## 41.19 Admin Dashboard

The dashboard includes approved patterns such as:

-   Stats Cards
-   Sales Overview
-   Orders by Status

Responsive behavior must prevent:

-   Chart overlap
-   Content collision
-   Clipped labels
-   Unreadable data
-   Avoidable horizontal overflow

`Chart Container` is a reusable visual container; chart-library behavior
is an implementation concern unless specifically defined by the design.

------------------------------------------------------------------------

## 41.20 Image Upload Pattern

``` text
Empty State
    ↓
Upload Image
    ↓
Preview
    ↓
Replace / Remove
```

Requirements:

-   Visible upload control
-   Constrained preview
-   Replace
-   Remove
-   Clear empty state
-   No raw URL as primary UI

------------------------------------------------------------------------

## 41.21 Responsive System

Supported categories:

-   Mobile
-   Tablet
-   Desktop
-   Large Desktop

Responsive coverage includes:

-   Navigation
-   Product grids
-   Product details
-   Forms
-   Tables
-   Cart
-   Checkout
-   Admin dashboard
-   Orders by status
-   Dialogs
-   Drawers
-   Search by image
-   Delivery tracking

Core rule:

> **No responsive state may introduce content overlap or make a primary
> action inaccessible.**

------------------------------------------------------------------------

## 41.22 Accessibility

Requirements:

-   Keyboard navigation
-   Visible focus
-   Accessible labels
-   Icon-only labels
-   Semantic relationships
-   Form labels
-   Validation messages
-   Error communication
-   Disabled-state communication
-   Touch-friendly controls
-   Contrast-aware semantic colors
-   Reduced motion

Critical information must not rely solely on color.

------------------------------------------------------------------------

## 41.23 Motion

Motion is intentionally restrained.

Appropriate uses:

-   Hover transitions
-   Pressed states
-   Dropdowns
-   Dialogs
-   Drawers
-   Loading transitions
-   Success feedback
-   Error feedback
-   Page/flow transitions
-   Delivery-status updates

Reduced-motion preferences must be respected.

Motion values should not be presented as verified Figma tokens unless
explicitly established.

------------------------------------------------------------------------

## 41.24 Empty, Loading, and Error States

### Loading

Skeletons should approximate final content structure.

Examples:

-   Product Card Skeleton
-   Product Details Skeleton
-   Order Skeleton
-   Table Skeleton
-   Dashboard Skeleton

### Empty

An empty state should explain:

1.  What is empty.
2.  Why it may be empty when useful.
3.  What the user can do next.

### Error

An error state should:

-   Explain the problem.
-   Avoid unnecessary technical details.
-   Provide recovery when possible.

------------------------------------------------------------------------

## 41.25 Recommendations

Recommendation sections reuse:

-   Section headers
-   Product Card
-   Loading state
-   Empty state
-   Error handling

Examples:

-   Recommended for You
-   You May Also Like
-   Similar Products
-   Frequently Bought Together

------------------------------------------------------------------------

## 41.26 Token-to-Implementation Boundary

Conceptual tokens include:

``` text
--color-primary
--color-surface
--color-text-primary
--font-family-ui
--font-family-data
--font-mono
--size-control
--size-icon
--radius-xl
```

Reuse existing project/framework tokens when they already represent the
approved value.

------------------------------------------------------------------------

## 41.27 UI Library Boundary

Radix UI may provide behavior and accessibility primitives.

It does not define ElectroHub visual identity.

``` text
Radix UI
   ↓
Behavior / Accessibility

ElectroHub Design System
   ↓
Visual Identity / Tokens / Components

SCSS / CSS Modules
   ↓
Styling

React
   ↓
Composition
```

------------------------------------------------------------------------

## 41.28 Repository Design-Asset Structure

The design system is supported by:

``` text
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

Responsibilities:

-   Architecture diagrams are engineering artifacts.
-   Flow diagrams are exported user/prototype-flow artifacts.
-   README screenshots are presentation assets.
-   Figma exports are reference/handoff artifacts.
-   The approved Figma export structure contains only `Components`, `admin`, and `customer` packages.
-   Figma remains the visual source of truth.

------------------------------------------------------------------------

## 41.29 Design Documentation Structure

``` text
docs/02_Design/
├── FIGMA.md
├── DESIGN_SYSTEM.md
├── COMPONENTS.md
├── LAYOUTS.md
├── COLORS.md
├── TYPOGRAPHY.md
├── ICONS.md
├── MOTION.md
├── RESPONSIVE.md
└── UI_GUIDELINES.md
```

  -----------------------------------------------------------------------
  Document                            Responsibility
  ----------------------------------- -----------------------------------
  `FIGMA.md`                          Figma governance, source of truth,
                                      workflow, handoff, visual
                                      validation

  `DESIGN_SYSTEM.md`                  Cross-system visual and interaction
                                      contract

  `COMPONENTS.md`                     Component specifications

  `LAYOUTS.md`                        Layout and shell rules

  `COLORS.md`                         Color definitions

  `TYPOGRAPHY.md`                     Typography definitions

  `ICONS.md`                          Icon rules

  `MOTION.md`                         Motion rules

  `RESPONSIVE.md`                     Responsive behavior

  `UI_GUIDELINES.md`                  General UI rules
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 41.30 Design Review

Before implementation:

-   Approved Figma design exists.
-   Existing components have been checked for reuse.
-   Required tokens exist.
-   Variants are meaningful.
-   Required states exist.
-   Responsive behavior is defined.
-   Accessibility is considered.
-   Loading/empty/error states exist where needed.
-   Interaction behavior is understood.
-   Documentation ownership is identified.

------------------------------------------------------------------------

## 41.31 Visual Review

Compare implementation against Figma for:

### Visual

-   Colors
-   Typography
-   Spacing
-   Radius
-   Component dimensions
-   Alignment
-   Image treatment
-   Icon sizing

### Layout

-   Containers
-   Columns
-   Grid
-   Vertical rhythm
-   Responsive behavior
-   No overlap
-   No unintended overflow

### Interaction

-   Hover
-   Focus
-   Active
-   Disabled
-   Loading
-   Error
-   Empty
-   Modal/drawer behavior

### Accessibility

-   Keyboard navigation
-   Focus visibility
-   Labels
-   Contrast
-   Touch targets
-   Reduced motion

------------------------------------------------------------------------

## 41.32 Change Governance

A significant change follows:

``` text
Figma Update
    ↓
Affected Documentation
    ↓
Affected Components / Screens
    ↓
Implementation Update
    ↓
Visual Validation
```

Known Figma/documentation/implementation drift must not remain
unresolved.

------------------------------------------------------------------------

## 41.33 Completion Baseline

The final design-system baseline contains:

-   Brand and semantic colors
-   Slate neutral scale
-   Poppins UI typography
-   JetBrains Mono data typography
-   4px spacing foundation
-   Semantic sizing
-   Verified radius decisions
-   Flat elevation direction
-   Focus treatment
-   Responsive design intent
-   42 reusable components
-   Component variants and states
-   Customer/admin shells
-   Commerce patterns
-   Search-by-image pattern
-   Checkout/payment patterns
-   Orders/delivery patterns
-   Admin patterns
-   Accessibility requirements
-   Motion principles
-   Final responsive corrections
-   Final visual QA corrections
-   Figma handoff alignment
-   Approved repository asset/export structure

> **Figma defines the intended visual experience; this document defines
> the reusable system derived from it.**


# 42. Approved Repository Figma Asset Structure

The design-system documentation remains under `docs/02_Design/`. Repository-side Figma handoff and visual-reference assets use the following exact structure:

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

## 42.1 Responsibilities

- `assets/figma/FIGMA.md` — primary repository-side Figma governance and handoff documentation.
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and handoff references.
- `assets/figma/exports/Components/` — shared component reference exports and screenshots.
- `assets/figma/exports/admin/` — administrator reference exports and screenshots.
- `assets/figma/exports/customer/` — customer reference exports and screenshots.

Do not recreate legacy export categories such as `Layouts/`, `Foundation/`, `screens/`, or `responsive/`.

Figma Design is authoritative for visual design. Figma Make screenshots are supporting visual references for Antigravity and implementation. Preserve default Figma Make screenshot filenames; do not manually rename them into custom component/screen naming patterns.

Responsive evidence belongs inside the approved `Components`, `admin`, and `customer` packages rather than in a separate responsive export directory.
