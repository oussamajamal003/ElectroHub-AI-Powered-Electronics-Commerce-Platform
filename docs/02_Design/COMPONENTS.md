# Components

## 1. Purpose

This document defines the reusable UI component architecture for
ElectroHub.

The component system is derived from the approved Figma visual system
and is responsible for:

-   Maintaining visual consistency.
-   Reducing duplicated UI implementation.
-   Providing predictable interaction behavior.
-   Supporting responsive layouts.
-   Supporting accessibility.
-   Providing reusable building blocks for customer and administrator
    experiences.
-   Keeping feature-specific business logic outside reusable visual
    components.

**Figma is the visual source of truth for component appearance and
intended interaction states.** This document records the reusable
component contract derived from that source.

------------------------------------------------------------------------

# 2. Component Architecture

The component hierarchy is:

``` text
Figma Foundations / Tokens
          ↓
Tier 1 — Foundation Components
          ↓
Tier 2 — Navigation Components
          ↓
Tier 3 — Feedback Components
          ↓
Tier 4 — Commerce Components
          ↓
Tier 5 — Admin Components
          ↓
Feature Composition
          ↓
Pages / Screens
```

A component should be reused whenever the same visual or interaction
pattern already exists.

Do not create a second component merely because a screen needs a small
visual variation. Prefer an existing component variant or composition
when the behavior remains the same.

------------------------------------------------------------------------

# 3. Final Approved Component Inventory

The completed Figma component system contains **42 reusable
components**.

## Tier 1 --- Foundation

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

## Tier 2 --- Navigation

12. Header
13. Sidebar
14. Breadcrumb
15. Tabs
16. Pagination
17. Dropdown
18. Mobile Navigation

## Tier 3 --- Feedback

19. Alert
20. Toast
21. Modal
22. Drawer
23. Dialog
24. Spinner
25. Skeleton
26. Error State
27. Empty State

## Tier 4 --- Commerce

28. Product Card
29. Product Image
30. Product Gallery
31. Price
32. Rating
33. Quantity Selector
34. Cart Item
35. Order Status
36. Payment Status

## Tier 5 --- Admin

37. Data Table
38. Filter Bar
39. Stats Card
40. Chart Container
41. Admin Form
42. Status Badge

This inventory replaces the earlier generic planning inventory as the
current Figma-approved component baseline.

------------------------------------------------------------------------

# 4. Foundation Components

## 4.1 Button

Button is the primary action component.

Approved action variants include:

-   Primary
-   Secondary
-   Ghost
-   Danger

Button supports:

-   Size variants
-   Interaction states
-   Disabled state
-   Loading state
-   Optional icons
-   Text labels

### Required behavior

-   Text must remain visible in the default state.
-   Hover and focus must not make the label unreadable.
-   Typography must use the established Poppins system.
-   Do not introduce arbitrary font weights.
-   Use existing sizing and spacing tokens.
-   Preserve an accessible focus indicator.

### Usage

Use Button for actions.

Do not use a styled link as a substitute when the interaction is an
action rather than navigation.

------------------------------------------------------------------------

## 4.2 Icon Button

Used for compact icon-only actions.

Requirements:

-   Accessible name/label.
-   Appropriate touch target.
-   Visible focus.
-   Consistent icon size.
-   Tooltip where the action is not otherwise obvious.

------------------------------------------------------------------------

## 4.3 Input

Used for text entry.

Must support:

-   Label
-   Placeholder
-   Value
-   Focus
-   Disabled
-   Error
-   Helper text where required

Placeholder text uses the approved muted color treatment.

------------------------------------------------------------------------

## 4.4 Textarea

Used for multi-line input.

Must follow the same:

-   Label structure
-   Focus treatment
-   Error treatment
-   Disabled treatment
-   Typography
-   Spacing

as Input.

------------------------------------------------------------------------

## 4.5 Select

Used for controlled selection.

Must support:

-   Label
-   Current value
-   Open state
-   Disabled state
-   Focus state
-   Selection state
-   Error state where applicable

Dropdown positioning must avoid viewport clipping where practical.

------------------------------------------------------------------------

## 4.6 Checkbox

Checkbox supports:

-   Checked
-   Unchecked
-   Indeterminate
-   Disabled
-   Focused

The indeterminate state is part of the approved component behavior and
is required by the Data Table selection pattern.

Accessibility:

-   Use a semantic checkbox.
-   Preserve keyboard operation.
-   Expose the correct accessible state.
-   Maintain a visible focus indicator.

------------------------------------------------------------------------

## 4.7 Radio

Radio supports:

-   Unselected
-   Selected
-   Disabled
-   Focused

The selected indicator must remain correctly associated with its
control.

------------------------------------------------------------------------

## 4.8 Switch

Used for binary settings.

Supports:

-   On
-   Off
-   Disabled
-   Focused

The visual state must not be communicated only by color.

------------------------------------------------------------------------

## 4.9 Badge

Badge communicates compact status or category information.

Approved semantic variants:

-   Success
-   Warning
-   Error
-   Info
-   Neutral

The semantic variant is separate from the displayed content. For
example, an inventory label such as "In Stock" can use the success
semantic variant without creating a new visual variant.

------------------------------------------------------------------------

## 4.10 Avatar

Avatar supports user/profile representation.

Approved medium sizing:

``` text
40px
```

Approved avatar radius:

``` text
15px
```

The component should provide a stable fallback when an image is
unavailable.

------------------------------------------------------------------------

## 4.11 Tooltip

Tooltip provides contextual information for compact or unfamiliar
controls.

Use it particularly for icon-only actions where the accessible label
alone does not provide sufficient visible explanation.

Tooltip must not contain the only copy required to complete a critical
task.

------------------------------------------------------------------------

# 5. Navigation Components

## 5.1 Header

The Header is a global customer navigation component.

Typical content:

``` text
Brand / Logo
Navigation
Search
Wishlist
Cart
Authentication / Account
```

The approved design includes ElectroHub branding.

Requirements:

-   Remain within the viewport.
-   Avoid horizontal overflow.
-   Adapt to responsive layouts.
-   Preserve search usability.
-   Keep navigation hierarchy clear.

------------------------------------------------------------------------

## 5.2 Sidebar

Sidebar is the primary administrator navigation component.

Approved behavior:

``` text
Expanded
    ↓
Collapsed
```

The collapse control is positioned at the **top of the sidebar**.

The sidebar is sticky below the admin header.

Main content scrolls independently.

Requirements:

-   Never overlay the admin header.
-   Resize the main content when collapsed/expanded.
-   Preserve navigation accessibility.
-   Maintain usable behavior on smaller screens.

------------------------------------------------------------------------

## 5.3 Breadcrumb

Breadcrumb communicates page hierarchy.

Use when the page benefits from contextual navigation.

It should remain concise and responsive.

------------------------------------------------------------------------

## 5.4 Tabs

Tabs switch between related views.

Requirements:

-   Clear active state.
-   Keyboard navigation.
-   Accessible tab relationships.
-   Responsive handling when labels become constrained.

------------------------------------------------------------------------

## 5.5 Pagination

Pagination controls movement through paginated datasets.

Used in:

-   Product listings
-   Admin tables
-   Orders
-   Other large collections

Current page must be visually and programmatically identifiable.

------------------------------------------------------------------------

## 5.6 Dropdown

Dropdown presents contextual actions or selectable options.

Requirements:

-   Correct alignment.
-   Keyboard operation.
-   Escape behavior where applicable.
-   Visible focus.
-   Correct layering.
-   Approved border token.

------------------------------------------------------------------------

## 5.7 Mobile Navigation

Mobile Navigation provides compact access to primary navigation.

It may use a drawer/sheet pattern depending on the approved screen.

Requirements:

-   Touch-friendly controls.
-   Clear open/close behavior.
-   No desktop-width assumptions.
-   Preserve accessible focus behavior.

------------------------------------------------------------------------

# 6. Feedback Components

## 6.1 Alert

Alert communicates contextual information requiring attention.

Semantic variants:

-   Success
-   Warning
-   Error
-   Info

Important information must not depend only on color.

------------------------------------------------------------------------

## 6.2 Toast

Toast communicates transient outcomes such as:

-   Successful actions
-   Recoverable errors
-   Background operation results

Critical information must not exist only inside a toast.

------------------------------------------------------------------------

## 6.3 Modal

Modal presents focused content above the current page.

Requirements:

-   Appropriate overlay.
-   Focus management.
-   Escape behavior where applicable.
-   Body scroll management where applicable.
-   Clear close action.
-   Accessible dialog semantics.

------------------------------------------------------------------------

## 6.4 Drawer

Drawer presents secondary or responsive content from an edge of the
viewport.

Used for patterns such as:

-   Mobile navigation
-   Filters
-   Secondary controls

It must preserve focus and close behavior.

------------------------------------------------------------------------

## 6.5 Dialog

Dialog is used for focused confirmation or interaction.

Use for:

-   Confirmations
-   Important decisions
-   Compact workflows

Destructive actions should communicate consequences clearly.

------------------------------------------------------------------------

## 6.6 Spinner

Spinner represents short indeterminate operations.

Prefer Skeleton when the final content structure is already known.

------------------------------------------------------------------------

## 6.7 Skeleton

Skeleton preserves the expected layout while content is loading.

It should approximate the shape and hierarchy of the eventual content.

Examples:

-   Product cards
-   Product details
-   Orders
-   Tables
-   Dashboard widgets

------------------------------------------------------------------------

## 6.8 Error State

Error State communicates failure and provides recovery where possible.

Should include:

-   Clear explanation
-   Recovery action where applicable
-   Appropriate visual severity

Avoid exposing unnecessary technical implementation details.

------------------------------------------------------------------------

## 6.9 Empty State

Empty State communicates the absence of expected content.

Should answer:

1.  What is empty?
2.  Why might it be empty, when useful?
3.  What should the user do next?

Examples:

-   Empty cart
-   Empty wishlist
-   No orders
-   No search results

------------------------------------------------------------------------

# 7. Commerce Components

## 7.1 Product Card

Product Card is the primary reusable product-discovery pattern.

It may contain:

``` text
Product Image
Brand
Product Name
Rating
Price
Availability
Actions
```

It should remain reusable across:

-   Home
-   Product listings
-   Search results
-   Wishlist
-   Recommendations

------------------------------------------------------------------------

## 7.2 Product Image

Product Image provides a consistent product-media treatment.

Approved product image sizing reference:

``` text
240px
```

Use constrained image containers to prevent uncontrolled layout growth.

------------------------------------------------------------------------

## 7.3 Product Gallery

Product Gallery presents multiple product images.

It should support:

-   Main image
-   Alternate images
-   Selection state
-   Responsive layout

On mobile, gallery controls must remain usable without creating
overflow.

------------------------------------------------------------------------

## 7.4 Price

Price communicates product or order monetary values.

The approved data/price treatment uses **JetBrains Mono**.

Price typography must use an established weight rather than arbitrary
bold styling.

------------------------------------------------------------------------

## 7.5 Rating

Rating communicates customer/product rating.

Approved star colors:

``` text
Fill   → #FDE68A
Stroke → #B45309
```

The component should not rely only on the visual stars to communicate
the numeric rating to assistive technology.

------------------------------------------------------------------------

## 7.6 Quantity Selector

Quantity Selector provides controlled quantity adjustment.

Must support:

-   Increment
-   Decrement
-   Current value
-   Minimum/maximum constraints
-   Disabled behavior
-   Accessible labels

It is used in cart and product-purchase contexts.

------------------------------------------------------------------------

## 7.7 Cart Item

Cart Item represents an individual cart product.

Typical content:

``` text
Product
Price
Quantity
Subtotal
Remove / Actions
```

The component should remain compact and readable on mobile.

------------------------------------------------------------------------

## 7.8 Order Status

Order Status communicates the lifecycle state of an order.

It should use the shared status language consistently.

Examples may include:

-   Pending
-   Processing
-   Shipped
-   Delivered
-   Cancelled

Exact business statuses are owned by the domain model; the component
owns presentation.

------------------------------------------------------------------------

## 7.9 Payment Status

Payment Status communicates payment lifecycle state.

Examples:

-   Pending
-   Processing
-   Paid
-   Failed
-   Refunded

Presentation must remain consistent with the shared semantic status
system.

------------------------------------------------------------------------

# 8. Admin Components

## 8.1 Data Table

Data Table presents structured administrative data.

Requirements:

-   Shared Checkbox integration.
-   Indeterminate bulk-selection support.
-   Sortable/interactive headers where applicable.
-   Clear selected state.
-   Responsive behavior.
-   Pagination support where needed.

On narrow screens, use the approved Figma mobile presentation rather
than forcing an unreadable desktop table.

------------------------------------------------------------------------

## 8.2 Filter Bar

Filter Bar groups:

-   Search
-   Filters
-   Sort
-   Date range
-   Reset
-   Related actions

It must adapt to available width.

Complex filter sets may move into a Drawer on smaller screens.

------------------------------------------------------------------------

## 8.3 Stats Card

Stats Card communicates high-level metrics.

Typical content:

``` text
Metric Label
Value
Trend / Supporting Information
```

Used heavily in the Admin Dashboard.

------------------------------------------------------------------------

## 8.4 Chart Container

Chart Container provides the visual structure for analytics content.

It defines:

-   Title area
-   Supporting controls where required
-   Chart content area
-   Loading state
-   Empty state
-   Error state

The container does not define a specific charting library.

------------------------------------------------------------------------

## 8.5 Admin Form

Admin Form composes shared form controls into create/edit workflows.

Used for:

-   Products
-   Categories
-   Settings
-   Other administrative entities

Create/Edit Product image handling must provide:

``` text
Empty Upload State
       ↓
Upload Image
       ↓
Constrained Preview
       ↓
Replace / Remove
```

A raw image URL must not be the primary user-facing upload experience.

------------------------------------------------------------------------

## 8.6 Status Badge

Status Badge is the admin-focused presentation pattern for operational
statuses.

It should reuse the semantic status language rather than creating
arbitrary colors for every business state.

------------------------------------------------------------------------

# 9. Component Variants and States

Variants should represent meaningful differences.

Recommended dimensions:

``` text
Type / Variant
Size
State
```

Avoid creating compound variants that duplicate the same visual rule
under different names.

Typical state model:

``` text
Default
Hover
Focus
Active / Pressed
Disabled
Loading
Error
Success
```

Not every component needs every state. Only define states relevant to
its behavior.

------------------------------------------------------------------------

# 10. Component Tokens

Components consume established design tokens.

Important shared values include:

``` text
Primary Color       #2563EB
Primary Hover       #1D4ED8
Accent              #06B6D4
Muted Text          #64748B

Control             40px
Control Small       32px
Control Large       48px

Icon                24px
Icon Small          20px

Avatar Medium       40px
Thumbnail            64px
Product Image       240px

Radius XL           16px
Radius Avatar       15px
Radius Thumbnail     5px
Radius Modal        12px
```

Do not introduce arbitrary component-specific values when an approved
token already exists.

------------------------------------------------------------------------

# 11. Component Typography

UI components use:

``` text
Poppins
```

Data and monetary values may use:

``` text
JetBrains Mono
```

Available weights:

``` text
400
500
600
700
```

Button and component weight must match the intended hierarchy. Do not
make every variant `font-bold`.

------------------------------------------------------------------------

# 12. Component Styling

The implementation styling boundary is:

``` text
React
  ↓
Component Composition
  ↓
SCSS / CSS Modules
  ↓
Design Tokens
```

Components should not depend on page-specific selectors.

Avoid global style leakage.

------------------------------------------------------------------------

# 13. Radix UI Boundary

Radix UI may provide behavior and accessibility primitives.

The relationship is:

``` text
Radix UI
    ↓
Behavior / Accessibility Primitive
    ↓
ElectroHub Component
    ↓
SCSS / CSS Modules
```

Radix does not define ElectroHub's visual identity.

------------------------------------------------------------------------

# 14. Accessibility Requirements

Every reusable component must consider:

-   Keyboard navigation
-   Visible focus
-   Accessible names
-   Labels
-   Semantic HTML
-   Screen-reader behavior
-   Color contrast
-   Touch targets
-   Reduced motion
-   Disabled state communication
-   Error communication

Critical information must not be conveyed through color alone.

------------------------------------------------------------------------

# 15. Responsive Requirements

Components must support the approved responsive categories:

``` text
Mobile
Tablet
Desktop
Large Desktop
```

Responsive behavior may involve:

-   Stacking
-   Resizing
-   Visibility changes
-   Alternative navigation
-   Drawer presentation
-   Table transformation
-   Control wrapping

Responsive behavior must never introduce content overlap or make primary
actions inaccessible.

------------------------------------------------------------------------

# 16. Commerce Component Relationships

The main commerce composition is:

``` text
Product Card
    ↓
Product Detail
    ↓
Product Gallery + Product Image
    ↓
Price + Rating + Quantity Selector
    ↓
Cart Item
    ↓
Checkout
    ↓
Order Status + Payment Status
```

Recommendations reuse the same product-card system rather than creating
separate product-card designs.

------------------------------------------------------------------------

# 17. Admin Component Relationships

The admin composition is:

``` text
Admin Shell
    ↓
Page Header
    ↓
Filter Bar
    ↓
Data Table / Stats Cards / Chart Container
    ↓
Admin Form
    ↓
Status Badge
```

This allows admin pages to remain consistent while supporting different
workflows.

------------------------------------------------------------------------

# 18. Component Testing Expectations

Reusable components should be tested for:

-   Rendering
-   Important interactions
-   Keyboard behavior
-   Required states
-   Validation
-   Accessibility behavior
-   Error handling
-   Responsive-sensitive logic where applicable

Critical interaction components should not rely exclusively on
visual/E2E testing.

------------------------------------------------------------------------

# 19. Component Documentation

Important components should document:

-   Purpose
-   Variants
-   Props
-   States
-   Accessibility behavior
-   Responsive behavior
-   Usage
-   Restrictions
-   Dependencies where relevant

Detailed layout rules belong in `LAYOUTS.md`.

Detailed visual tokens belong in:

``` text
COLORS.md
TYPOGRAPHY.md
MOTION.md
RESPONSIVE.md
```

------------------------------------------------------------------------

# 20. Component-to-Figma Mapping

Every major reusable component should have a corresponding Figma
representation or approved Figma usage pattern.

The implementation workflow is:

``` text
Figma Component
      ↓
Component Contract
      ↓
React Component
      ↓
SCSS / CSS Modules
      ↓
Visual Validation
```

If an implementation component visually diverges from Figma, determine
whether the Figma design or implementation is outdated before changing
either.

------------------------------------------------------------------------

# 21. Final QA Corrections Incorporated

The final Figma QA established these component-level requirements:

-   Hero "Browse Deals" uses the shared Button system and keeps text
    visible by default.
-   Hero promotional text such as "New Season 2026" is treated as a
    compact eyebrow/promo label rather than an oversized heading.
-   Customer Header includes ElectroHub branding.
-   Admin Header follows the same branding principle.
-   Admin Sidebar collapse control is at the top.
-   Sidebar remains sticky below the header.
-   Button typography follows the established hierarchy.
-   Data Table uses the corrected Checkbox behavior.
-   Product image upload uses a visible upload control and constrained
    preview.
-   Cart and checkout component composition must not overlap.
-   Admin dashboard components must reflow correctly.
-   Orders-by-status content must stack safely on narrow screens.

------------------------------------------------------------------------

# 22. Component Completion Criteria

A reusable component is complete when:

-   Its purpose is clear.
-   Its Figma visual reference is approved.
-   Its props are typed.
-   Required variants are defined.
-   Required states are defined.
-   Tokens are reused.
-   Responsive behavior is defined.
-   Accessibility is addressed.
-   Tests are provided where appropriate.
-   It does not contain inappropriate feature business logic.
-   It does not duplicate an existing component.
-   Visual validation has been performed.

------------------------------------------------------------------------

# 24. Figma Repository Export Structure

This component documentation follows the approved repository-side Figma asset structure:

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
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules for translating approved Figma designs into the application.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and reference navigation.
- `assets/figma/exports/Components/README.md` — documentation for the component screenshot/reference package.
- `assets/figma/exports/Components/screenshots/` — Figma Make-generated component screenshots used as supporting visual references.
- `assets/figma/exports/admin/` — administrator screen reference package.
- `assets/figma/exports/customer/` — customer screen reference package.

**Figma Design remains authoritative for component appearance and interaction intent. Figma Make screenshots are supporting visual references only.**

The previous export categories `Layouts/`, `Foundation/`, `screens/`, and `responsive/` are not part of the approved repository export structure and must not be recreated for this package.

For Figma Make screenshots, preserve the filename generated by Figma Make. Do not rename screenshots into manual patterns such as `<Component> — Default.png` or `<Component> — Desktop/Tablet/Mobile.png`. Context is provided by the folder and README.

------------------------------------------------------------------------

# 23. Component Principle

> **Build reusable components around approved visual patterns and
> behavior, not around individual screens.**

The component system is the bridge between the Figma design system and
the React application.
