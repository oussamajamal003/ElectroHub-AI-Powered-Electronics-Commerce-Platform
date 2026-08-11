# Colors

## 1. Purpose

This document defines the color system used throughout ElectroHub.

The color system provides consistent visual roles for:

- Brand identity
- Backgrounds
- Surfaces
- Text
- Borders
- Interactive elements
- Status feedback
- Commerce states
- Administrative interfaces
- Dark and light themes where applicable

Colors should be applied through semantic design tokens rather than arbitrary values.

---

# 2. Color Principles

The ElectroHub color system follows these principles:

### Consistency

The same semantic role should use the same color throughout the application.

### Accessibility

Color choices must provide sufficient contrast and must not be the only mechanism used to communicate important information.

### Semantic Usage

Colors should describe meaning rather than simply decorate individual components.

### Theme Support

If multiple themes are implemented, semantic tokens should remain stable while their underlying values may change.

### Design-Code Alignment

Figma color tokens and implementation tokens should represent the same design decisions.

---

# 3. Color Source of Truth

Figma is the source of truth for the approved visual color system.

The implementation should map the approved Figma colors into semantic SCSS/CSS tokens.

Conceptually:

```text
Figma Color Tokens
        ↓
Semantic Design Tokens
        ↓
SCSS Variables / CSS Custom Properties
        ↓
React Components
```

---

# 4. Color Categories

The ElectroHub color system is organized into:

```text
Brand
Background
Surface
Text
Border
Interactive
Status
Commerce
Overlay
```

---

# 5. Brand Colors

Brand colors establish ElectroHub's visual identity.

Recommended semantic roles:

```text
Primary
Primary Hover
Primary Active
Primary Contrast
Secondary
Secondary Hover
Secondary Active
Secondary Contrast
```

The exact hexadecimal values are defined by the approved Figma design.

Brand colors should be used consistently across:

- Primary buttons
- Links
- Important actions
- Selected states
- Brand elements
- Key interface highlights

---

# 6. Background Colors

Background tokens define large page-level surfaces.

Recommended roles:

```text
Background
Background Secondary
Background Tertiary
```

These may be used for:

- Application background
- Section backgrounds
- Page regions
- Alternate content areas

Background colors should provide sufficient separation between major interface regions.

---

# 7. Surface Colors

Surface colors represent contained interface elements.

Recommended roles:

```text
Surface
Surface Elevated
Surface Secondary
Surface Hover
Surface Selected
```

Typical usage:

- Cards
- Panels
- Dropdowns
- Dialogs
- Navigation surfaces
- Product containers
- Dashboard widgets

---

# 8. Text Colors

Text should use semantic roles.

Recommended tokens:

```text
Text Primary
Text Secondary
Text Muted
Text Disabled
Text Inverse
Text Link
```

### Text Primary

Used for:

- Main headings
- Product names
- Important information
- Primary content

### Text Secondary

Used for:

- Supporting information
- Descriptions
- Secondary labels

### Text Muted

Used for:

- Captions
- Metadata
- Less prominent supporting content

### Text Disabled

Used for unavailable controls and disabled content.

### Text Inverse

Used when text appears on a sufficiently contrasting dark or brand surface.

---

# 9. Border Colors

Borders should communicate separation without creating unnecessary visual noise.

Recommended tokens:

```text
Border
Border Subtle
Border Strong
Border Focus
```

Typical usage:

- Inputs
- Cards
- Tables
- Dividers
- Navigation
- Form sections

---

# 10. Interactive Colors

Interactive states should be visually distinguishable.

Recommended roles:

```text
Interactive
Interactive Hover
Interactive Active
Interactive Focus
Interactive Disabled
```

Interactive states should not rely exclusively on color.

Focus states must remain clearly visible for keyboard users.

---

# 11. Status Colors

Status colors communicate system feedback.

Recommended semantic roles:

```text
Success
Success Background
Success Border
Success Text

Warning
Warning Background
Warning Border
Warning Text

Error
Error Background
Error Border
Error Text

Info
Info Background
Info Border
Info Text
```

Status colors should be paired with text, icons, or other visual indicators where appropriate.

---

# 12. Commerce Colors

Commerce-specific states may use semantic status tokens.

Examples:

```text
In Stock
Low Stock
Out of Stock
Sale
Price
Discount
Payment Success
Payment Pending
Payment Failed
```

These states must remain understandable without relying solely on color.

---

# 13. Order Status Colors

Order states include:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Each state may have a dedicated semantic presentation.

The implementation should not hard-code unrelated colors directly into order components.

---

# 14. Delivery Status Colors

Delivery tracking may use semantic status treatments for:

```text
Confirmed
Preparing
Out for Delivery
Delivered
Delayed
Unavailable
```

Status colors should be reinforced through:

- Text
- Icons
- Timeline position
- Labels

---

# 15. Inventory Colors

Inventory states include:

```text
In Stock
Low Stock
Out of Stock
```

The visual system should communicate these states through more than color alone.

For example:

```text
Low Stock
+
"Only 3 left"
```

is preferable to communicating low stock only through a color change.

---

# 16. Payment Colors

Payment states may include:

```text
Payment Successful
Payment Pending
Payment Failed
Payment Cancelled
```

These states should use the same semantic status system used elsewhere in the application.

---

# 17. Form Validation Colors

Form validation should use semantic status colors.

Recommended roles:

```text
Valid
Invalid
Warning
Required
```

Error messages should include meaningful text rather than relying solely on a red border.

---

# 18. Focus Color

Keyboard focus must remain clearly visible.

The focus treatment may use:

```text
Focus Ring
Focus Border
Focus Shadow
```

The focus style should provide sufficient contrast against the surrounding surface.

---

# 19. Overlay Colors

Overlays are used for:

- Dialogs
- Drawers
- Mobile navigation
- Image viewers
- Confirmation interfaces

Recommended roles:

```text
Overlay
Overlay Strong
```

Overlay opacity should preserve context while clearly separating the active interface from the background.

---

# 20. Theme Architecture

If ElectroHub supports multiple themes, components should consume semantic tokens.

Example:

```text
Component
   ↓
--color-surface
   ↓
Theme-specific value
```

Components should not contain separate hard-coded colors for each theme.

---

# 21. Semantic Token Strategy

Prefer:

```scss
background: var(--color-surface);
color: var(--color-text-primary);
border-color: var(--color-border);
```

Avoid:

```scss
background: #ffffff;
color: #111111;
border-color: #dddddd;
```

when a semantic token already exists.

---

# 22. Color Naming

Color tokens should describe purpose rather than appearance.

Prefer:

```text
--color-primary
--color-surface
--color-text-primary
--color-success
--color-error
```

Avoid:

```text
--color-blue
--color-gray
--color-dark-blue
```

Semantic naming makes theme changes and design evolution easier.

---

# 23. Figma Color Organization

Figma should organize colors by semantic purpose.

Recommended structure:

```text
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

Color styles or variables should use consistent names.

---

# 24. Accessibility

Color decisions must consider:

- Text contrast
- Interactive contrast
- Focus visibility
- Disabled states
- Status communication
- Dark/light surfaces
- Large and small text

Important information must never depend only on color.

Examples:

```text
Out of Stock
+
Text label
+
Icon / visual indicator
```

rather than only a color change.

---

# 25. Color Usage Rules

### Do

- Use semantic tokens.
- Reuse approved colors.
- Follow Figma definitions.
- Validate contrast.
- Use status colors consistently.
- Provide non-color indicators for important states.

### Do Not

- Introduce arbitrary colors.
- Use raw hex values throughout components.
- Create slightly different colors for the same semantic role.
- Use color as the only status indicator.
- Change brand colors per feature without design approval.

---

# 26. Component Usage

Components should consume the color system through semantic tokens.

Examples:

```text
Button
    ↓
Primary Token

Product Card
    ↓
Surface Token

Error Message
    ↓
Error Token

Inventory Badge
    ↓
Inventory Status Token
```

---

# 27. Design Review

Before introducing a new color, verify:

1. Does an existing semantic token already represent the required meaning?
2. Is the new color required by the design?
3. Does it meet accessibility requirements?
4. Is it documented in Figma?
5. Does it need a new semantic token?
6. Will it be reused elsewhere?

Avoid creating one-off colors for isolated components.

---

# 28. Implementation

The implementation should centralize reusable color tokens.

A conceptual structure may be:

```text
styles/
├── abstracts/
│   ├── _variables.scss
│   └── _tokens.scss
│
└── themes/
    └── _themes.scss
```

The exact structure should follow the project's SCSS 7-1 architecture.

---

# 29. Color Completion Criteria

The color system is considered complete when:

- Brand colors are defined.
- Background colors are defined.
- Surface colors are defined.
- Text colors are defined.
- Border colors are defined.
- Interactive states are defined.
- Status colors are defined.
- Commerce states are defined.
- Accessibility requirements are verified.
- Figma and implementation tokens are aligned.
- Components use semantic colors.

---

# 30. Color Principle

> **Use color to communicate meaning consistently, not to create arbitrary visual variation.**
