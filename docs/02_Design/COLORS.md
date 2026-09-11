# Colors

## 1. Purpose

This document defines the approved ElectroHub color system.

It records the color decisions established during the complete
Figma/Figma Make workflow and defines how those decisions should be
consumed by the application.

The color system covers:

-   Brand identity
-   Neutral scale
-   Backgrounds
-   Surfaces
-   Text
-   Borders
-   Interactive states
-   Status states
-   Commerce states
-   Rating
-   Focus
-   Overlays
-   Accessibility

**Figma is the visual source of truth.** This document records the
approved color decisions so they can be implemented consistently.

------------------------------------------------------------------------

# 2. Source of Truth

The authority chain is:

``` text
Figma Variables / Styles
        ↓
Semantic Design Tokens
        ↓
SCSS / CSS Custom Properties
        ↓
React Components
        ↓
Feature Screens
```

Figma defines the intended visual appearance.

Implementation defines how those values are technically consumed at
runtime.

If a visual discrepancy appears, do not introduce a local color to hide
it. Determine whether the Figma definition or implementation is
outdated.

------------------------------------------------------------------------

# 3. Color Architecture

The approved system separates:

``` text
Primitive Colors
      ↓
Semantic Tokens
      ↓
Component Usage
```

### Primitive

Primitive values describe the actual color scale.

Example:

``` text
Slate 900
Slate 800
...
Slate 50
```

### Semantic

Semantic tokens describe purpose:

``` text
Text Primary
Surface
Border Default
Success
Error
Primary
```

### Component

Components consume semantic tokens rather than inventing local colors.

------------------------------------------------------------------------

# 4. Primary Brand

The approved primary brand color is:

  Token                Value       Purpose
  -------------------- ----------- -----------------------------
  Primary              `#2563EB`   Main brand/action color
  Primary Hover        `#1D4ED8`   Hovered primary action
  Primary Foreground   `#FFFFFF`   Content on primary surfaces

Primary is used for:

-   Primary buttons
-   Important links
-   Selected controls
-   Main actions
-   Brand highlights
-   Key interactive elements

Do not introduce another blue for a component when the existing semantic
primary role applies.

------------------------------------------------------------------------

# 5. Accent

The approved accent color is:

``` text
Accent → #06B6D4
```

The accent is used selectively for secondary visual emphasis and
interaction highlights established by the Figma work.

Examples observed in the design system include:

-   Sidebar hover treatment
-   Dropdown hover treatment
-   Reset/filter CTA emphasis

Accent must not replace Primary for primary actions.

------------------------------------------------------------------------

# 6. Neutral Scale

The approved neutral foundation uses a Slate scale:

``` text
Slate 900
Slate 800
Slate 700
Slate 600
Slate 500
Slate 400
Slate 300
Slate 200
Slate 100
Slate 50
```

The neutral scale provides the foundation for:

-   Text
-   Backgrounds
-   Surfaces
-   Borders
-   Disabled UI
-   Supporting content

Primitive values should normally be consumed through semantic aliases.

------------------------------------------------------------------------

# 7. Semantic Text Colors

The approved text hierarchy includes:

``` text
Text Primary
Text Secondary
Text Muted
Text Disabled
Text Inverse
Text Link
```

### Muted / Placeholder

The verified muted/placeholder value is:

``` text
#64748B
```

This value is important for:

-   Placeholder text
-   Secondary metadata
-   Supporting labels
-   Low-emphasis content

Do not use an arbitrary gray for placeholder text when the muted
semantic token is appropriate.

------------------------------------------------------------------------

# 8. Background Colors

Background roles include:

``` text
Background
Background Secondary
Background Tertiary
```

Use backgrounds for page-level and large structural regions.

The background system should create hierarchy without introducing
unnecessary decorative colors.

------------------------------------------------------------------------

# 9. Surface Colors

Surface roles include:

``` text
Surface
Surface Elevated
Surface Secondary
Surface Hover
Surface Selected
```

Typical usage:

-   Cards
-   Product containers
-   Panels
-   Dropdowns
-   Dialogs
-   Dashboard widgets
-   Navigation regions

The overall ElectroHub visual direction is predominantly flat.

Functional elevation may be used where separation is necessary,
particularly for overlays and floating UI.

------------------------------------------------------------------------

# 10. Border Colors

Approved semantic border roles include:

``` text
Border Default
Border Subtle
Border Strong
Border Focus
```

Borders are used for:

-   Inputs
-   Cards
-   Tables
-   Navigation
-   Dividers
-   Form sections

Prefer the existing border token instead of creating slightly different
local grays.

------------------------------------------------------------------------

# 11. Interactive States

Interactive colors communicate:

``` text
Default
Hover
Active / Pressed
Focus
Disabled
```

Primary interactive behavior is based on the approved brand tokens.

Important requirements:

-   Hover must not make text unreadable.
-   Focus must remain clearly visible.
-   Disabled state must be distinguishable.
-   Interaction must not rely only on color.

------------------------------------------------------------------------

# 12. Focus

The approved focus treatment is:

``` text
2px solid Primary
2px offset
```

The project uses a shared focus-ring concept rather than
component-specific focus colors.

Conceptually:

``` css
.focus-ring {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

The exact implementation syntax may differ, but the visual intent should
remain consistent.

------------------------------------------------------------------------

# 13. Status Colors

The semantic status system contains:

``` text
Success
Warning
Error
Info
Neutral
```

These are used consistently across:

-   Alerts
-   Badges
-   Toasts
-   Forms
-   Inventory
-   Orders
-   Payments
-   Delivery
-   Admin interfaces

Status presentation should normally combine color with text, icons,
labels, or position.

------------------------------------------------------------------------

# 14. Commerce Status

Commerce states include:

``` text
In Stock
Low Stock
Out of Stock
Sale
Discount
```

The status presentation should be semantic rather than feature-specific.

Example:

``` text
"In Stock"
    ↓
Success semantic treatment
```

The label determines meaning; the visual variant determines
presentation.

------------------------------------------------------------------------

# 15. Order Status

Order lifecycle states may include:

``` text
Pending
Processing
Shipped
Delivered
Cancelled
```

The actual business-state vocabulary belongs to the application domain.

The color system provides the semantic presentation.

Do not create a unique color for every new order state without design
review.

------------------------------------------------------------------------

# 16. Payment Status

Payment states include:

``` text
Pending
Processing
Paid / Successful
Failed
Refunded / Cancelled
```

Payment state must remain understandable through text and status
indicators, not color alone.

------------------------------------------------------------------------

# 17. Delivery Status

Delivery tracking may use semantic status treatment for:

``` text
Confirmed
Preparing
Out for Delivery
Delivered
Delayed
Unavailable
```

Use supporting:

-   Status labels
-   Icons
-   Timeline position
-   Explanatory text

when necessary.

------------------------------------------------------------------------

# 18. Inventory

Inventory states include:

``` text
In Stock
Low Stock
Out of Stock
```

Example:

``` text
Low Stock
Only 3 left
```

is preferable to communicating the state only through color.

------------------------------------------------------------------------

# 19. Rating Colors

The approved rating/star treatment is:

``` text
Star Fill   → #FDE68A
Star Stroke → #B45309
```

These values are specifically associated with the rating visual
language.

They should not be generalized into unrelated warning or brand colors.

------------------------------------------------------------------------

# 20. Overlay Colors

Overlays are used for:

-   Modals
-   Drawers
-   Mobile navigation
-   Image viewers
-   Confirmation interfaces

Semantic roles may include:

``` text
Overlay
Overlay Strong
```

Overlay opacity must preserve sufficient context while visually
separating the active layer.

------------------------------------------------------------------------

# 21. Validation Colors

Forms use semantic status colors for:

``` text
Valid
Invalid
Warning
Required
```

An invalid field should provide:

``` text
Visual state
+
Error message
+
Accessible association
```

Do not rely only on a red border.

------------------------------------------------------------------------

# 22. Disabled Colors

Disabled controls should communicate unavailability through a
combination of:

-   Reduced emphasis
-   Disabled text treatment
-   Disabled background/border treatment
-   Disabled interaction
-   Appropriate cursor/behavior

Disabled content must not be confused with normal muted content.

------------------------------------------------------------------------

# 23. Theme Strategy

The semantic layer is intentionally separated from primitive values.

Conceptually:

``` text
Component
   ↓
--color-surface
   ↓
Current theme value
```

If themes are introduced, component code should remain semantic.

Do not duplicate hard-coded light/dark colors inside individual
components.

------------------------------------------------------------------------

# 24. Token Naming

Prefer purpose-based names:

``` text
--color-primary
--color-primary-hover
--color-text-primary
--color-text-muted
--color-surface
--color-border-default
--color-success
--color-error
```

Avoid appearance-only names:

``` text
--color-blue
--color-gray
--color-dark-blue
```

Semantic naming makes the system scalable.

------------------------------------------------------------------------

# 25. Figma Organization

The Figma color architecture should remain organized around semantic
categories:

``` text
Colors
├── Brand
├── Background
├── Surface
├── Text
├── Border
├── Interactive
├── Status
└── Commerce
```

Primitive variables may exist underneath these semantic categories.

The design documentation should not claim a primitive value is a
semantic role unless the mapping has been intentionally established.

------------------------------------------------------------------------

# 26. Accessibility

Color usage must consider:

-   Text contrast
-   Interactive contrast
-   Focus visibility
-   Disabled controls
-   Status communication
-   Surface separation
-   Small text
-   Large text

Important information must not depend exclusively on color.

Examples:

``` text
Error
+
Error icon
+
Error message
```

``` text
Out of Stock
+
Text label
+
Visual indicator
```

------------------------------------------------------------------------

# 27. Color Usage Rules

## Do

-   Use approved Figma colors.
-   Prefer semantic tokens.
-   Reuse the same semantic role consistently.
-   Validate contrast.
-   Pair status color with non-color information.
-   Keep brand colors consistent.
-   Preserve the approved rating colors.

## Do Not

-   Add arbitrary hex values.
-   Create one-off grays/blues.
-   Change the primary brand color locally.
-   Communicate critical state through color alone.
-   Use rating colors as generic status colors.
-   Duplicate semantic tokens with slightly different values.

------------------------------------------------------------------------

# 28. Component Mapping

Typical mapping:

``` text
Button
    ↓
Primary / Interactive Tokens

Input
    ↓
Surface + Border + Focus + Error

Badge
    ↓
Status Tokens

Product Card
    ↓
Surface + Border + Text Tokens

Rating
    ↓
Rating Fill / Stroke

Order Status
    ↓
Status Tokens

Payment Status
    ↓
Status Tokens

Admin Sidebar
    ↓
Surface + Text + Accent / Interactive
```

------------------------------------------------------------------------

# 29. Design Review for New Colors

Before adding a color:

1.  Check whether an existing semantic token already represents the
    requirement.
2.  Confirm the visual requirement in Figma.
3.  Determine whether the color is primitive or semantic.
4.  Check accessibility.
5.  Confirm whether the color will be reused.
6.  Update this document if a new approved semantic role is created.
7.  Update implementation tokens.
8.  Validate affected components.

A new color should solve a real design-system need, not a local styling
problem.

------------------------------------------------------------------------

# 30. Verified vs Derived Values

The documentation distinguishes between values established directly
through Figma work and values that are implementation baselines.

### Verified / explicitly established

-   `#2563EB` Primary
-   `#1D4ED8` Primary Hover
-   `#FFFFFF` Primary Foreground
-   `#06B6D4` Accent
-   Slate 900 → 50 neutral foundation
-   `#64748B` muted/placeholder
-   `#FDE68A` rating fill
-   `#B45309` rating stroke
-   2px focus ring
-   2px focus offset

### Semantic / derived

-   Component-specific status mapping
-   Theme aliases
-   Overlay roles
-   Disabled-state presentation
-   Additional semantic aliases

Derived values must remain consistent with the approved visual system
and should not be represented as independently verified Figma primitives
unless they are later confirmed.

------------------------------------------------------------------------

# 31. Implementation Boundary

The frontend should consume colors through centralized tokens.

Conceptually:

``` text
Figma
  ↓
Design Token
  ↓
CSS Custom Property / SCSS Token
  ↓
Component
```

Avoid scattering raw hexadecimal values throughout component styles.

------------------------------------------------------------------------

# 32. Completion Criteria

The color system is complete when:

-   Brand colors are defined.
-   Neutral scale is defined.
-   Semantic text colors are defined.
-   Backgrounds and surfaces are defined.
-   Borders are defined.
-   Interactive states are defined.
-   Focus is defined.
-   Status semantics are defined.
-   Commerce semantics are defined.
-   Rating treatment is defined.
-   Accessibility rules are defined.
-   Figma and implementation terminology are aligned.
-   New colors are governed through review.

------------------------------------------------------------------------

# 33. Color Principle

> **Use color as a consistent language of identity, hierarchy,
> interaction, and state---not as arbitrary decoration.**
# 34. Repository Figma Asset Structure

Color documentation remains part of `docs/02_Design/`. Figma visual-reference and handoff assets use the single approved repository structure below:

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

## 34.1 Responsibilities

- `assets/figma/FIGMA.md` — primary repository-side Figma governance and handoff documentation.
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules for translating Figma into the application.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and handoff references.
- `assets/figma/exports/Components/` — component reference exports and supporting screenshots.
- `assets/figma/exports/admin/` — administrator experience reference exports and screenshots.
- `assets/figma/exports/customer/` — customer experience reference exports and screenshots.

Do not recreate legacy Figma export categories such as `Layouts/`, `Foundation/`, `screens/`, or `responsive/`.

## 34.2 Screenshot Policy

Figma Design remains authoritative for visual decisions. Figma Make screenshots are supporting visual references for implementation and Antigravity.

Preserve the default filenames generated by Figma Make. Do not manually rename screenshots into custom patterns such as `<Component> — Default.png` or `<Screen> — Desktop/Tablet/Mobile.png`.

Responsive evidence belongs inside the `Components`, `admin`, and `customer` export packages rather than in a separate responsive export directory.

