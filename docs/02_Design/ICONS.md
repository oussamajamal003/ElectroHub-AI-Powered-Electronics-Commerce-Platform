# Icons

## 1. Purpose

This document defines the icon system used throughout ElectroHub.

The icon system provides consistent rules for:

- Icon library
- Icon sizing
- Icon usage
- Icon alignment
- Interactive icons
- Status icons
- Navigation icons
- Accessibility
- Responsive behavior
- Figma-to-code consistency

ElectroHub uses **Lucide React** as its approved icon library.

---

# 2. Icon Principles

The icon system follows these principles:

### Consistency

Icons should use a consistent visual language, stroke style, and sizing system.

### Clarity

Icons should communicate familiar concepts without unnecessary complexity.

### Accessibility

Icons must not be the only way to communicate critical information.

### Restraint

Icons should support content and interaction rather than create visual noise.

### Reusability

The same icon should be reused for the same semantic purpose throughout the application.

---

# 3. Approved Icon Library

ElectroHub uses:

```text
Lucide React
```

Lucide provides:

- Consistent stroke-based icons
- React components
- Configurable sizing
- Accessibility support
- A broad set of interface and commerce icons

New icon libraries should not be introduced without an architectural or design decision.

---

# 4. Figma and Implementation

The icon relationship is:

```text
Figma Icon
    ↓
Lucide Icon Selection
    ↓
React Component
    ↓
SCSS / CSS Modules
```

Figma should use icons that have an equivalent Lucide React implementation whenever possible.

If a custom icon is required, the reason should be documented.

---

# 5. Icon Sizes

The icon system should use a consistent size scale.

Conceptual sizes:

```text
XS
SM
MD
LG
XL
```

Typical usage:

```text
XS
Small metadata or compact controls

SM
Inputs, badges, compact buttons

MD
Default UI icons

LG
Prominent actions

XL
Large empty states or feature visuals
```

The exact pixel values should follow the approved Figma design tokens.

---

# 6. Icon Weight

Icons should maintain a consistent stroke treatment.

Lucide icons should normally use their default stroke style unless the design system explicitly defines an alternative.

Avoid mixing unrelated icon styles such as:

```text
Filled
Outlined
3D
Multicolor
Hand-drawn
```

without design approval.

---

# 7. Navigation Icons

Navigation icons may represent:

```text
Home
Products
Categories
Orders
Wishlist
Cart
Account
Settings
Dashboard
Analytics
Inventory
Delivery
```

Navigation icons should be paired with text where space permits.

Icons alone should not be relied upon for navigation meaning unless the control has an accessible name.

---

# 8. Action Icons

Common action icons include:

```text
Search
Add
Edit
Delete
Close
Back
Forward
Refresh
Filter
Sort
More
Download
Upload
Share
Copy
```

The same semantic action should use the same icon throughout the application.

---

# 9. Commerce Icons

Commerce interfaces may use icons for:

```text
Cart
Wishlist
Heart
Shopping Bag
Package
Credit Card
Receipt
Invoice
Tag
Discount
Truck
Map Pin
```

Icons should reinforce the associated label or action.

---

# 10. Product Icons

Product-related interfaces may use icons for:

```text
Image
Camera
Zoom
Star
Heart
Compare
Specifications
Availability
```

Product icons should remain visually secondary to product information unless the action itself is primary.

---

# 11. Search by Image Icons

The image-search workflow may use:

```text
Camera
Upload
Image
Scan
Search
Refresh
Close
```

The camera icon should be used consistently for camera capture actions.

Upload and camera actions should remain distinguishable.

---

# 12. Delivery Icons

Delivery tracking may use:

```text
Map Pin
Navigation
Truck
Package
Clock
Check
Route
Location
```

Icons should support the delivery timeline and map interface.

---

# 13. Order and Payment Icons

Order interfaces may use:

```text
Package
Receipt
File
Download
Credit Card
Check Circle
Clock
Alert Circle
X Circle
```

Icons should correspond to the semantic state or action.

---

# 14. Status Icons

Status icons may represent:

```text
Success
Warning
Error
Information
Pending
Loading
```

Status communication should normally combine:

```text
Icon
+
Text
```

rather than relying on an icon alone.

---

# 15. Icon Buttons

Icon-only buttons should be used when the action is universally recognizable or when space is constrained.

Examples:

```text
Search
Close
Menu
More
Wishlist
Delete
Edit
```

Every icon-only button must provide an accessible name.

Example:

```tsx
<button aria-label="Remove from wishlist">
  <Heart />
</button>
```

---

# 16. Icons With Text

When an icon accompanies text:

```text
[Icon] Add to Cart
[Icon] Download Invoice
[Icon] Track Order
```

The icon should reinforce the action rather than duplicate the complete meaning unnecessarily.

---

# 17. Decorative Icons

Decorative icons should not create unnecessary accessibility announcements.

When an icon is purely decorative, it should be hidden from assistive technology where appropriate.

Conceptually:

```tsx
<Icon aria-hidden="true" />
```

---

# 18. Icon Alignment

Icons should align consistently with adjacent content.

For inline icon/text combinations:

```text
[Icon] Text
```

The icon should use the same visual alignment and appropriate spacing.

Avoid manually positioning icons with arbitrary offsets.

---

# 19. Icon Spacing

Icon-to-text spacing should use the project's spacing tokens.

Avoid:

```css
margin-left: 7px;
```

when an appropriate spacing token already exists.

Prefer the design system spacing scale.

---

# 20. Interactive States

Interactive icons should define:

```text
Default
Hover
Focus
Active
Disabled
Loading
```

The state should be visible without relying solely on color.

Focus states are required for keyboard-accessible controls.

---

# 21. Selected Icons

Selected states may be represented through:

- Color
- Background
- Stroke treatment
- Filled state where supported
- Supporting text

The exact treatment must follow the Figma design.

---

# 22. Loading Icons

Loading indicators may use:

- Spinner icons
- Dedicated loading components
- Skeletons

Animated icons should not replace meaningful loading content when the structure of the final content can be represented by a skeleton.

---

# 23. Responsive Icons

Icons should remain appropriately sized across:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Do not automatically scale icons simply because the viewport changes.

Size changes should be intentional and defined by the design system.

---

# 24. Icon Accessibility

Accessibility requirements include:

- Accessible names for interactive icon buttons.
- Decorative icons hidden from assistive technology where appropriate.
- Icons not being the sole source of critical information.
- Adequate contrast.
- Visible focus states.
- Appropriate touch target sizes.

---

# 25. Touch Targets

Interactive icons must provide an adequately sized interaction area.

The visible icon and its clickable area are separate concepts.

For example:

```text
┌──────────────┐
│      ♥       │
└──────────────┘
```

The icon may be small while the interactive target remains sufficiently large.

---

# 26. Icon Color

Icons should use semantic color tokens.

Prefer:

```text
color: var(--color-text-secondary);
```

rather than arbitrary component-specific colors.

Status icons should use the corresponding semantic status color where appropriate.

---

# 27. Icon Naming

Icon usage should describe the semantic purpose.

Prefer:

```text
Search
Trash2
Heart
ShoppingCart
MapPin
Download
```

Avoid creating custom wrapper names that obscure the underlying meaning unless the abstraction provides meaningful application behavior.

---

# 28. Figma Icon Organization

Figma should organize icons consistently.

Recommended structure:

```text
Icons
├── Navigation
├── Actions
├── Commerce
├── Products
├── Delivery
├── Orders
├── Status
└── Utility
```

The selected Lucide equivalent should be identifiable during design handoff.

---

# 29. Custom Icons

Custom icons should only be introduced when:

1. No suitable Lucide icon exists.
2. The icon represents important ElectroHub-specific identity.
3. The custom icon is required by the approved Figma design.

Custom icons should document:

- Purpose
- Source
- Usage
- Dimensions
- Accessibility requirements
- Licensing where applicable

---

# 30. Icon Usage Rules

### Do

- Use Lucide React.
- Reuse semantic icons.
- Keep sizing consistent.
- Provide accessible names.
- Use semantic colors.
- Maintain consistent stroke style.
- Follow Figma.

### Do Not

- Mix unrelated icon libraries.
- Use icons as decoration everywhere.
- Rely only on icons for critical information.
- Use arbitrary sizes throughout the application.
- Manually position icons unnecessarily.
- Introduce custom icons without justification.

---

# 31. Icon Completion Criteria

The icon system is considered complete when:

- Lucide React is established as the primary icon library.
- Icon categories are defined.
- Size rules are defined.
- Interactive states are defined.
- Accessibility rules are defined.
- Figma and implementation icons are aligned.
- Customer and admin workflows use consistent icon semantics.
- Custom icons are documented when required.

---

# 32. Icon Principle

> **Use icons to reinforce meaning and interaction, not to replace clear communication.**
