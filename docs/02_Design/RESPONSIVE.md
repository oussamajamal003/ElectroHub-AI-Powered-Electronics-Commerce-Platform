# Responsive Design

## 1. Purpose

This document defines the responsive design strategy for ElectroHub.

The responsive system ensures that the application remains usable, readable, accessible, and visually consistent across:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Responsive behavior must be designed intentionally rather than treated as a final styling adjustment.

---

# 2. Responsive Principles

ElectroHub follows these principles:

### Mobile First

Layouts should begin with the smallest practical viewport and progressively enhance for larger screens.

### Content First

Breakpoints should respond to content requirements rather than arbitrary device names.

### Consistency

The same feature should remain recognizable across all viewport sizes.

### Accessibility

Responsive changes must not reduce keyboard accessibility, readability, or touch usability.

### Performance

Mobile layouts should avoid unnecessary assets, rendering, and animation.

### Figma Alignment

Responsive behavior must follow the approved Figma designs and specifications.

---

# 3. Supported Viewports

The application should support at minimum:

```text
Mobile
Tablet
Desktop
Large Desktop
```

The exact breakpoint values are defined by the implementation design tokens and should be selected according to content behavior.

Avoid designing only for specific device models.

---

# 4. Breakpoint Strategy

Breakpoints should be content-driven.

Conceptually:

```text
Mobile
    ↓
Small / Medium Tablet
    ↓
Desktop
    ↓
Large Desktop
```

A breakpoint should be introduced when the current layout no longer provides an acceptable experience.

Avoid unnecessary breakpoints.

---

# 5. Mobile Layout

Mobile layouts prioritize:

- Single-column content
- Touch interaction
- Clear hierarchy
- Compact navigation
- Readable text
- Accessible controls

Typical structure:

```text
Header
   ↓
Page Content
   ↓
Sections
   ↓
Footer
```

Multi-column desktop layouts should generally stack vertically on mobile.

---

# 6. Tablet Layout

Tablet layouts may use:

- Two-column content
- Reduced navigation
- Collapsible sidebars
- Adaptive product grids
- Compact toolbars

Tablet behavior should not simply be a scaled-down desktop layout.

---

# 7. Desktop Layout

Desktop layouts may use:

- Multi-column grids
- Persistent navigation
- Sidebars
- Expanded search
- Multi-column forms
- Dashboard layouts

Content should remain within readable maximum widths.

---

# 8. Large Desktop

Large desktop screens should use additional space carefully.

Do not simply stretch all content indefinitely.

Large screens may provide:

- Larger content areas
- Additional grid columns
- Increased spacing where appropriate
- Wider dashboard layouts

Primary content should remain visually focused.

---

# 9. Container System

Pages should use responsive containers.

Conceptually:

```text
Viewport
│
├── Responsive Padding
│
└── Max Width Container
      │
      └── Page Content
```

The container should:

- Prevent excessive line length.
- Maintain consistent horizontal alignment.
- Adapt padding by viewport size.
- Prevent unintended overflow.

---

# 10. Header Responsiveness

The header is one of the most important responsive components.

Desktop may contain:

```text
Logo
Navigation
Search
Wishlist
Cart
Account
```

Mobile may contain:

```text
Menu
Logo
Search
Cart
```

Secondary navigation should move into a menu or drawer when necessary.

The header must never create horizontal overflow.

---

# 11. Search Responsiveness

Search must remain usable at every supported width.

Desktop:

```text
[ Navigation ] [ Search Input ] [ Actions ]
```

Mobile may use:

```text
[ Menu ] [ Logo ] [ Cart ]

[ Search Input ]
```

Search suggestions should remain aligned with the search control.

Search controls must remain large enough for touch interaction.

---

# 12. Product Grid Responsiveness

Product grids should adapt to available width.

Conceptually:

```text
Desktop
4+ columns

Tablet
2–3 columns

Mobile
1–2 columns
```

The final number of columns depends on product-card dimensions and the approved Figma design.

Cards should not become too narrow.

---

# 13. Product Card Responsiveness

Product cards should preserve:

- Image ratio
- Product name readability
- Price visibility
- Availability
- Primary action
- Wishlist action

Long product names should wrap or truncate according to the design system.

Critical information must remain visible.

---

# 14. Product Details Responsiveness

Desktop:

```text
Gallery | Product Information
```

Mobile:

```text
Gallery
    ↓
Product Information
    ↓
Purchase Actions
    ↓
Specifications
    ↓
Recommendations
```

The primary purchase action should remain easy to locate on mobile.

---

# 15. Cart Responsiveness

Desktop may use:

```text
Cart Items | Order Summary
```

Mobile should generally stack:

```text
Cart Items
    ↓
Order Summary
    ↓
Checkout
```

The checkout action should remain clearly visible.

---

# 16. Checkout Responsiveness

Desktop:

```text
Checkout Form | Order Summary
```

Mobile:

```text
Shipping
    ↓
Payment
    ↓
Order Summary
    ↓
Confirm Payment
```

Form fields should use full available width where appropriate.

Payment controls must remain comfortable to use with touch input.

---

# 17. Forms

Forms should adapt from multi-column to single-column layouts.

Desktop:

```text
First Name       Last Name
Email            Phone
Address          City
```

Mobile:

```text
First Name
Last Name
Email
Phone
Address
City
```

Fields should maintain adequate spacing and readable labels.

---

# 18. Tables

Administrative tables require special responsive treatment.

Possible strategies include:

```text
Horizontal Scrolling
Responsive Columns
Card Transformation
Priority-Based Column Hiding
```

The chosen strategy should depend on the data and approved design.

Important information must remain accessible.

---

# 19. Admin Sidebar

The administrator sidebar should adapt:

```text
Desktop
Persistent Sidebar

Tablet
Collapsible Sidebar

Mobile
Drawer / Overlay
```

Navigation should remain accessible when collapsed.

---

# 20. Admin Dashboard

Dashboard cards should adapt their grid.

Desktop:

```text
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│ KPI │ │ KPI │ │ KPI │ │ KPI │
└─────┘ └─────┘ └─────┘ └─────┘
```

Tablet:

```text
┌─────┐ ┌─────┐
│ KPI │ │ KPI │
└─────┘ └─────┘
```

Mobile:

```text
┌─────────┐
│   KPI   │
└─────────┘
```

Charts must remain readable at smaller widths.

---

# 21. Delivery Tracking Responsiveness

Desktop:

```text
Delivery Information | Map
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

The map must provide usable controls on touch devices.

---

# 22. Search by Image Responsiveness

The image-search flow must support:

- Mobile camera capture
- File upload
- Image preview
- Processing
- Results

Mobile camera UI should use the available viewport efficiently without creating unnecessary page scrolling.

---

# 23. Dialogs and Drawers

Dialogs should adapt to the viewport.

Desktop:

```text
Centered Dialog
```

Mobile may use:

```text
Full-width Dialog
Bottom Sheet
Full-screen Dialog
```

The chosen pattern depends on the interaction.

Dialogs must remain within the viewport and support keyboard/focus management.

---

# 24. Navigation

Navigation should progressively simplify as available width decreases.

Desktop:

```text
Full Navigation
```

Tablet:

```text
Reduced / Collapsible Navigation
```

Mobile:

```text
Menu / Drawer
```

Navigation labels must remain understandable.

---

# 25. Typography Responsiveness

Typography should scale according to the approved typography system.

Responsive typography should prevent:

- Oversized headings on mobile
- Tiny body text
- Horizontal overflow
- Unnecessary wrapping

Text should remain readable when users zoom or increase system font size.

---

# 26. Spacing Responsiveness

Spacing may reduce at smaller widths.

Conceptually:

```text
Desktop
Generous spacing

Tablet
Moderate spacing

Mobile
Compact but comfortable spacing
```

Spacing should remain consistent with the design token system.

---

# 27. Images

Images should be responsive and preserve appropriate aspect ratios.

Use:

```text
Responsive dimensions
Object-fit
Appropriate image sizes
Lazy loading where appropriate
```

Avoid loading unnecessarily large images on small screens.

---

# 28. Maps

Maps should have responsive dimensions.

The map must:

- Remain usable on touch screens.
- Provide adequate height.
- Avoid trapping page scrolling unnecessarily.
- Preserve important controls.
- Adapt to orientation changes.

---

# 29. Touch Targets

Interactive controls should provide sufficiently large touch areas.

Pay particular attention to:

- Icon buttons
- Navigation items
- Product actions
- Quantity controls
- Map controls
- Form controls

The visible icon size does not need to equal the complete interactive target size.

---

# 30. Hover Behavior

Hover-dependent interactions must have an alternative on touch devices.

Do not make important functionality accessible only through:

```text
:hover
```

Touch devices should receive equivalent interaction paths.

---

# 31. Orientation

The application should remain usable in:

```text
Portrait
Landscape
```

where the device supports both orientations.

Important controls must not disappear when the viewport height becomes limited.

---

# 32. Horizontal Overflow

Unintended horizontal scrolling is prohibited.

Particular attention should be given to:

- Header
- Search
- Navigation
- Product cards
- Tables
- Long text
- Order numbers
- Dialogs
- Maps
- Images

Horizontal scrolling may be used intentionally for tables or specific content patterns when documented and usable.

---

# 33. Responsive States

Every major component should consider:

```text
Loading
Empty
Error
Success
Default
Interactive
Disabled
```

Responsive behavior must remain correct in each relevant state.

---

# 34. Accessibility

Responsive layouts must preserve:

- Keyboard navigation
- Focus visibility
- Semantic structure
- Screen-reader usability
- Text readability
- Touch usability
- Contrast
- Zoom support

Mobile simplification must not remove essential accessibility information.

---

# 35. Performance

Responsive implementation should consider mobile performance.

Use:

- Responsive images
- Lazy loading
- Code splitting
- Efficient rendering
- Limited animation
- Appropriate asset sizes

Avoid loading desktop-only resources when they are unnecessary.

---

# 36. Figma Responsive Design

Figma should contain responsive representations for important screens.

Recommended design coverage:

```text
Desktop
Tablet
Mobile
```

Each major feature should document meaningful layout changes.

---

# 37. Testing

Responsive behavior should be verified using:

- Browser responsive tools
- Real mobile devices where possible
- Tablet-sized viewports
- Desktop viewports
- Automated E2E viewport tests where appropriate

Test important workflows at multiple viewport sizes.

---

# 38. Responsive Completion Criteria

A feature is considered responsive when:

- Mobile behavior is defined.
- Tablet behavior is defined.
- Desktop behavior is defined.
- Large-screen behavior is considered.
- No unintended horizontal overflow exists.
- Touch targets are usable.
- Navigation adapts correctly.
- Forms remain usable.
- Tables have an intentional mobile strategy.
- Images and maps adapt correctly.
- Accessibility is preserved.
- Figma and implementation are aligned.

---

# 39. Responsive Principle

> **Responsive design is adaptation of structure and interaction, not simply shrinking the desktop interface.**
