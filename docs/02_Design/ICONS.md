# Icons

## 1. Purpose

This document defines the approved ElectroHub icon system.

It covers:

-   Icon library
-   Icon sizing
-   Icon buttons
-   Navigation icons
-   Commerce icons
-   Admin icons
-   Status icons
-   Accessibility
-   Alignment
-   Responsive behavior
-   Figma-to-code usage

**Figma is the visual source of truth.** This document records the
approved icon decisions and implementation rules established during the
design workflow.

------------------------------------------------------------------------

# 2. Icon Source of Truth

The authority chain is:

``` text
Figma Icon Usage
      ↓
Icon Library / Semantic Icon Role
      ↓
React Icon Component
      ↓
Application Components
```

The implementation must preserve the visual role established in Figma.

------------------------------------------------------------------------

# 3. Approved Icon Library

The application component system uses:

``` text
Lucide React
```

The Figma work established a consistent outline-icon language, and the
implementation uses Lucide React to provide that language in the
application.

Do not introduce another icon library for individual features without
architectural review.

------------------------------------------------------------------------

# 4. Icon Style

The default icon language is:

-   Clean
-   Minimal
-   Outline-based
-   Consistent stroke treatment
-   Simple geometric forms
-   Appropriate for both customer and admin interfaces

Icons should support the interface rather than become decorative noise.

------------------------------------------------------------------------

# 5. Core Icon Size

The approved base icon size is:

``` text
24px
```

Implementation token:

``` text
--size-icon: 24px
```

This is the primary size for standard UI icons.

------------------------------------------------------------------------

# 6. Small Icons

Small icons use:

``` text
20px
```

Implementation token:

``` text
--size-icon-sm: 20px
```

Typical uses:

-   Compact metadata
-   Small status indicators
-   Dense admin UI
-   Supporting labels

Do not reduce icons below the intended touch/control size when the icon
itself is interactive.

------------------------------------------------------------------------

# 7. Icon and Control Sizing

Icon size and control size are separate concepts.

Approved semantic sizing includes:

``` text
Icon
24px

Small Icon
20px

Control
40px

Small Control
32px

Large Control
48px
```

An icon button therefore has a control box and an icon inside it.

Example:

``` text
40px control
┌──────────┐
│   24px   │
└──────────┘
```

Do not treat the icon itself as the complete interactive target.

------------------------------------------------------------------------

# 8. Icon Buttons

Icon buttons must provide:

-   Sufficient target size
-   Accessible name
-   Visible focus state
-   Clear hover/pressed state
-   Disabled state where appropriate

Typical uses:

``` text
Search
Wishlist
Cart
Menu
Close
Edit
Delete
More
Filter
```

An icon-only control must have an accessible label.

------------------------------------------------------------------------

# 9. Navigation Icons

Navigation icons may be used in:

-   Customer Header
-   Mobile Navigation
-   Admin Sidebar
-   Admin Header
-   Breadcrumbs
-   Tabs

Icons must remain secondary to the navigation label where a label is
present.

------------------------------------------------------------------------

# 10. Customer Navigation

Typical semantic roles include:

``` text
Home
Products
Search
Cart
Orders
Account
Wishlist
```

Use the icon that most clearly communicates the destination.

Avoid using multiple visually similar icons for the same semantic
action.

------------------------------------------------------------------------

# 11. Admin Navigation

Admin navigation may include:

``` text
Dashboard
Products
Categories
Inventory
Orders
Customers
Analytics
Settings
```

The icon language should remain consistent with the customer experience.

Admin does not receive a separate icon library.

------------------------------------------------------------------------

# 12. Commerce Icons

Commerce-related icons include semantic roles such as:

``` text
Shopping Cart
Heart / Wishlist
Search
Filter
Plus
Minus
Trash
Package
Credit Card
Receipt
Truck
Map Pin
```

Use semantic icons consistently throughout the purchase and order
lifecycle.

------------------------------------------------------------------------

# 13. Authentication Icons

Authentication screens may use icons for:

``` text
Email
Password
Visibility
OTP / Verification
Lock
Security
```

Icons should supplement labels and instructions.

They must not replace required form labels.

------------------------------------------------------------------------

# 14. Status Icons

Status icons support:

``` text
Success
Warning
Error
Info
Neutral
```

Examples:

``` text
Check
Alert
X
Info
```

Status meaning should be communicated by:

``` text
Icon + Color + Text
```

rather than color alone.

------------------------------------------------------------------------

# 15. Delivery Icons

Delivery workflows may use:

``` text
Package
Truck
Map Pin
Location
Clock
Check
```

Icons should support the delivery timeline and tracking information.

------------------------------------------------------------------------

# 16. Product Icons

Product interfaces may use:

``` text
Image
Zoom
Heart
Star
Shopping Cart
Compare
Share
```

Only icons relevant to the actual supported feature should be displayed.

Do not show an icon merely because the design system has one.

------------------------------------------------------------------------

# 17. Rating Icons

Rating uses star icons.

The approved rating treatment is:

``` text
Fill   → #FDE68A
Stroke → #B45309
```

The star treatment is specific to rating and should not be reused as
generic warning styling.

------------------------------------------------------------------------

# 18. Admin Data Icons

Admin interfaces may use icons for:

``` text
Edit
Delete
View
Filter
Sort
Export
Search
More
```

Actions must remain understandable through accessible names and/or
visible labels.

------------------------------------------------------------------------

# 19. Icon Stroke

Icons should use a consistent stroke language.

Avoid changing stroke width arbitrarily from one component to another.

When the selected Lucide icon provides a standard stroke, retain the
system-consistent stroke unless Figma explicitly requires another
treatment.

------------------------------------------------------------------------

# 20. Icon Color

Icons should normally inherit the semantic color of their context.

Examples:

``` text
Navigation icon
→ Navigation text color

Primary button icon
→ Primary foreground

Error icon
→ Error semantic color

Muted metadata icon
→ Muted text color
```

Do not introduce arbitrary icon colors.

------------------------------------------------------------------------

# 21. Icon Alignment

Icons must align optically with their accompanying content.

For icon + text:

``` text
[Icon] Label
```

Maintain consistent:

-   Gap
-   Vertical alignment
-   Baseline relationship
-   Control padding

The icon should not visually overpower the text.

------------------------------------------------------------------------

# 22. Icons in Buttons

Buttons with icons should maintain:

``` text
Icon
+
Consistent gap
+
Label
```

The icon position should remain predictable:

``` text
[Icon] Label
```

or:

``` text
Label [Icon]
```

depending on the semantic action.

Do not mix patterns randomly.

------------------------------------------------------------------------

# 23. Icon-Only Actions

When the action is obvious from context, an icon-only control may be
used.

Requirements:

-   Accessible name
-   Tooltip where useful
-   Visible focus
-   Adequate target size
-   Clear state

Critical destructive actions should not rely on an unlabeled icon alone.

------------------------------------------------------------------------

# 24. Tooltips

Tooltips can supplement icon-only controls.

They are especially useful for:

-   Admin actions
-   Collapsed sidebar
-   Dense data tables
-   Unfamiliar controls

Tooltips do not replace accessible labels.

------------------------------------------------------------------------

# 25. Sidebar Collapse Icon

The admin sidebar has a collapse/expand control.

The approved shell behavior places this control at the top of the
sidebar.

When collapsed:

-   The sidebar remains usable.
-   Icon-only navigation remains understandable.
-   Tooltips may provide additional context.
-   The main content resizes rather than being covered.

The collapse control must not be positioned in a way that overlaps or
competes with the header.

------------------------------------------------------------------------

# 26. Mobile Navigation Icons

Mobile navigation uses icons where appropriate.

Touch targets must remain large enough for comfortable interaction.

The icon itself may remain 20--24px while the surrounding control is
larger.

------------------------------------------------------------------------

# 27. Responsive Icons

Icon size should not change simply because the viewport becomes smaller.

Responsive changes should be made when they improve:

-   Density
-   Touch usability
-   Visual hierarchy

The control target must remain accessible even when the icon is visually
compact.

------------------------------------------------------------------------

# 28. Loading Icons

Loading indicators use the shared Spinner component rather than
arbitrary spinning icons.

Where a status is genuinely loading:

``` text
Spinner
+
Accessible loading state
```

should be preferred.

------------------------------------------------------------------------

# 29. Decorative Icons

Purely decorative icons should not create unnecessary screen-reader
announcements.

Implementation should mark decorative icons appropriately.

Functional icons require accessible semantics.

------------------------------------------------------------------------

# 30. Accessibility

Icon accessibility requirements include:

-   Accessible names for icon-only controls
-   Keyboard accessibility
-   Visible focus
-   Adequate target size
-   Non-color-only meaning
-   Decorative icon suppression
-   Tooltip support where useful

An icon is not a substitute for semantic HTML.

------------------------------------------------------------------------

# 31. Icon Asset Strategy

Prefer library-based icons for interface controls.

Use raster/vector assets for:

-   Product photography
-   Logos
-   Brand illustrations
-   Complex illustrations
-   Marketing artwork

Do not convert ordinary interface icons into image assets without a
reason.

------------------------------------------------------------------------

# 32. Brand Logo

The ElectroHub logo/brand mark is a brand asset, not a generic UI icon.

It belongs to the application branding layer and is used in:

-   Customer Header
-   Admin Header
-   Cover/handoff documentation where appropriate

The logo must remain visually aligned with the existing header system.

------------------------------------------------------------------------

# 33. Figma Organization

The icon system should be documented around:

``` text
Icons
├── Navigation
├── Commerce
├── Authentication
├── Status
├── Delivery
├── Admin
└── Utility
```

The actual Figma component/library organization may evolve, but semantic
roles should remain stable.

------------------------------------------------------------------------

# 34. Token Integration

Icons consume existing semantic tokens.

Relevant sizing tokens include:

``` text
--size-icon: 24px
--size-icon-sm: 20px
```

Controls consume:

``` text
--size-control: 40px
--size-control-sm: 32px
--size-control-lg: 48px
```

This keeps icon dimensions separate from interactive target dimensions.

------------------------------------------------------------------------

# 35. Icon Review Rules

Before adding an icon:

1.  Check whether Lucide already provides an appropriate icon.
2.  Check the Figma reference.
3.  Reuse the existing semantic role.
4.  Confirm accessibility.
5.  Confirm the icon is actually needed.
6.  Confirm size and alignment.
7.  Avoid introducing a second icon library.

------------------------------------------------------------------------

# 36. Completion Criteria

The icon system is complete when:

-   Library is defined.
-   Base sizes are defined.
-   Icon/control sizing is separated.
-   Navigation usage is defined.
-   Commerce usage is defined.
-   Admin usage is defined.
-   Status usage is defined.
-   Rating treatment is defined.
-   Accessibility is defined.
-   Responsive behavior is defined.
-   Brand logo treatment is defined.
-   Figma and implementation remain aligned.

------------------------------------------------------------------------

# 37. Icon Principle

> **Icons should clarify actions and information, remain visually
> consistent, and never replace accessible meaning.**
# 38. Repository Figma Asset Structure

Icon documentation remains part of `docs/02_Design/`. Figma visual-reference and handoff assets use the single approved repository structure below:

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

## 38.1 Responsibilities

- `assets/figma/FIGMA.md` — primary repository-side Figma governance and handoff documentation.
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules for translating Figma into the application.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and handoff references.
- `assets/figma/exports/Components/` — component reference exports and supporting screenshots, including icon usage evidence.
- `assets/figma/exports/admin/` — administrator experience reference exports and screenshots.
- `assets/figma/exports/customer/` — customer experience reference exports and screenshots.

Do not recreate legacy Figma export categories such as `Layouts/`, `Foundation/`, `screens/`, or `responsive/`.

## 38.2 Screenshot Policy

Figma Design remains authoritative for icon appearance and usage. Figma Make screenshots are supporting visual references for implementation and Antigravity.

Preserve the default filenames generated by Figma Make. Do not manually rename screenshots into custom naming patterns.

Responsive evidence belongs inside the three approved export packages rather than in a separate responsive export directory.

