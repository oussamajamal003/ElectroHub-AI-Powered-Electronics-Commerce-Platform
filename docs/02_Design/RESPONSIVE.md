# ElectroHub Responsive Design

## 1. Purpose

This document defines the approved responsive design and implementation strategy for ElectroHub.

It consolidates the responsive decisions established throughout the Figma design work, including:

- Customer and admin experiences
- Desktop, tablet, and mobile representations
- Navigation and shell adaptation
- Commerce flows
- Checkout and payment
- Orders and delivery tracking
- Search and image search
- Admin dashboards, tables, and forms
- Component states
- Accessibility and touch behavior
- Motion and performance considerations

**Figma remains the visual source of truth.** This document records the responsive rules and implementation expectations derived from the approved Figma work; it does not replace the Figma designs.

---

# 2. Responsive Design Principles

ElectroHub follows these principles:

### Mobile First

Implementation should establish a robust small-screen baseline and progressively enhance the layout.

### Content First

Breakpoints are introduced when content no longer fits comfortably, not because a specific device model is being targeted.

### Structural Adaptation

Responsive design changes layout, navigation, density, and interaction patterns where necessary. It is not simply desktop UI scaled down.

### Consistency

A feature must remain recognizable and functionally equivalent across viewport sizes.

### Accessibility

Responsive changes must preserve keyboard access, visible focus, readable content, semantic structure, contrast, and touch usability.

### Performance

Small screens should not unnecessarily load oversized assets, expensive effects, or desktop-only UI.

---

# 3. Approved Responsive Coverage

The Figma work establishes responsive coverage for:

```text
Desktop
Tablet
Mobile
```

Large desktop is also considered in implementation so content does not stretch indefinitely.

Important responsive states and patterns were refined during the final Figma QA and polish work.

---

# 4. Breakpoint and Viewport Decisions

The design work verified the following **design-intent values**:

| Token / value | Status | Meaning |
|---|---|---|
| `md: 768px` | Verified | Figma tablet/design breakpoint intent |
| `xl: 1440px` | Verified | Large desktop/artboard intent |
| `sm: 640px` | Not approved as a Figma-specific value | Do not treat as design truth |
| `lg: 1024px` | Not approved as a Figma-specific value | Do not treat as design truth |

These values must not be described as explicit CSS breakpoints unless the implementation independently establishes them.

Implementation may introduce additional content-driven thresholds when required by layout behavior, but those thresholds must be documented and should not be presented as Figma-verified values.

---

# 5. Container Strategy

The page container must provide stable horizontal alignment across the application.

Verified design evidence includes:

- `24px` horizontal container padding.
- `1440px` as a large-desktop artboard/design intent.

The `1440px` value should not automatically be interpreted as a verified CSS `max-width`.

Conceptually:

```text
Viewport
│
├── 24px+ responsive horizontal padding
│
└── Content Container
       │
       ├── Page Header
       ├── Main Content
       └── Supporting Sections
```

Do not create unrelated page-specific container widths.

---

# 6. Product Grid

The visual audit established the following intended density:

```text
Desktop → 4 columns
Tablet  → 2 columns
Mobile  → 1 column
```

These are **derived responsive rules from the visual design audit**, not claims of explicit Figma CSS/grid implementation.

The product card must retain enough width for:

- Product image
- Name
- Price
- Availability
- Primary action
- Wishlist action
- Optional rating/badge information

Do not force additional columns merely because screen width permits them if the cards become too narrow.

---

# 7. Customer Header and Navigation

### Desktop

The customer header can expose the full navigation and actions:

```text
Logo
Home
Products
Cart
Orders
Account
Search
Wishlist / Account Actions
```

### Tablet

Navigation may become more compact while preserving the primary destinations.

### Mobile

The design supports a compact shell with:

```text
Menu
Logo
Search
Cart
```

Secondary navigation should move into the established mobile navigation/drawer pattern.

The header must not create horizontal overflow or overlap page content.

The ElectroHub brand mark/logo is part of the approved customer and admin shell treatment.

---

# 8. Admin Shell Responsiveness

The admin shell consists of:

```text
Admin Header
Sidebar
Main Content
```

The final Figma work established important shell behavior:

- The sidebar collapse control is positioned at the **top of the sidebar**.
- The sidebar remains sticky below the header.
- The main content scrolls independently.
- Main content resizes correctly when the sidebar is collapsed.
- The collapsed state remains usable.

Expected adaptation:

```text
Desktop
Persistent / collapsible sidebar

Tablet
Collapsible sidebar

Mobile
Compact navigation / drawer pattern
```

Do not allow the sidebar to cover or incorrectly overlap the admin header.

---

# 9. Home and Landing Screens

Customer home content should preserve the established visual hierarchy at smaller widths.

Responsive behavior includes:

- Hero content stacking where necessary.
- Primary CTA remaining visible.
- Promotional content retaining readable hierarchy.
- Product/recommendation sections adapting to available width.
- The compact “New Season 2026” promotion treatment remaining an eyebrow/promo label rather than consuming excessive vertical space.

The final Figma QA also corrected the default visibility of the hero “Browse Deals” CTA text.

---

# 10. Product Listing and Search

Listing and search pages should adapt:

```text
Desktop
Filters + multi-column results

Tablet
Reduced density + adaptive filters

Mobile
Single-column results + compact filter/search controls
```

Search must remain accessible and usable at every supported width.

Search suggestions must stay visually associated with the search control.

The image-search entry point must remain discoverable without overwhelming the normal text-search experience.

---

# 11. Search by Image

The responsive image-search flow supports:

```text
Choose Image
    ↓
Upload / Camera
    ↓
Preview
    ↓
Analyze
    ↓
Results
```

Mobile behavior must support:

- Camera capture where the browser/device permits it.
- File selection.
- Preview before analysis.
- Processing feedback.
- Results that use the normal responsive product layout.
- Clear invalid-image and permission failure recovery.

The interface should avoid unnecessary nested scrolling during image selection or preview.

---

# 12. Product Detail

Desktop structure:

```text
Product Gallery | Product Information
```

Mobile structure:

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

The primary purchase action must remain easy to locate.

Product imagery must preserve the approved aspect-ratio treatment and avoid layout shift while loading.

---

# 13. Product Images and Uploads

The final admin Create/Edit Product design established an image-upload interaction:

```text
Empty
  → Upload Image
  → Preview
  → Replace / Remove
```

Responsive implementation must:

- Constrain preview dimensions.
- Preserve image aspect ratio.
- Keep upload/remove actions reachable on touch screens.
- Provide a meaningful empty state.
- Avoid exposing the raw image URL as the primary user interaction.

The raw URL can remain an internal implementation/model value; it is not the preferred user-facing upload interaction.

---

# 14. Cart

Desktop:

```text
Cart Items | Order Summary
```

Mobile:

```text
Cart Items
    ↓
Order Summary
    ↓
Checkout
```

The Figma refinement specifically addressed mobile cart scrolling and overlap.

Implementation must ensure:

- Cart content can scroll naturally.
- The summary does not overlap items.
- Quantity controls remain usable.
- Remove/wishlist actions remain reachable.
- Checkout remains obvious.
- No fixed element traps or blocks the cart content.

---

# 15. Checkout and Payment

Desktop:

```text
Checkout / Shipping | Order Summary
```

Mobile:

```text
Shipping
   ↓
Payment
   ↓
Order Summary
   ↓
Confirm
```

Forms should move from multi-column desktop arrangements to single-column mobile arrangements when required.

Payment states established by the product flow include:

```text
Processing
Success
Failure
```

The UI must not show successful payment/order completion until the backend confirms the operation.

---

# 16. Orders and Delivery

Customer order views must preserve visibility of:

- Order number
- Order status
- Payment status
- Delivery status
- Total
- Purchased products
- Delivery progress

Delivery tracking can adapt from:

```text
Desktop:
Delivery Information | Map
```

to:

```text
Mobile:
Delivery Status
↓
Timeline
↓
Estimated Arrival
↓
Map
```

The map must remain usable with touch interaction.

Real-time delivery updates received through Socket.IO should update the responsive UI without requiring unnecessary page refreshes.

---

# 17. Admin Dashboard

The admin dashboard uses adaptive card and content density.

Conceptually:

```text
Desktop
[KPI] [KPI] [KPI] [KPI]

Tablet
[KPI] [KPI]
[KPI] [KPI]

Mobile
[KPI]
[KPI]
[KPI]
[KPI]
```

The exact arrangement remains governed by the approved Figma design and available content width.

### Sales Overview

The final responsive QA corrected the Sales Overview layout so it behaves correctly at smaller widths.

Charts must:

- Fit their container.
- Preserve readable labels.
- Avoid horizontal clipping.
- Resize without overlapping adjacent content.

### Orders by Status

The final responsive QA established stacking behavior for the Orders by Status section on smaller screens.

---

# 18. Admin Tables

Administrative data tables require an intentional small-screen strategy.

Possible strategies include:

```text
Horizontal scrolling
Priority-based column reduction
Responsive transformation
Card presentation
```

The chosen approach must preserve important information and remain usable with keyboard and touch input.

Do not allow a table to accidentally force the entire application into horizontal scrolling.

---

# 19. Admin Forms

Admin forms should use:

```text
Desktop → Multi-column where appropriate
Mobile  → Single-column / stacked
```

This applies to:

- Create Product
- Edit Product
- Category management
- Inventory
- Delivery management
- Settings
- Customer/order operations

Labels, validation messages, and action controls must remain associated with their fields after reflow.

---

# 20. Dialogs, Drawers, and Overlays

Dialogs and drawers must adapt to viewport dimensions.

Desktop may use:

```text
Centered dialog
```

Mobile may use:

```text
Full-width dialog
Bottom sheet
Full-screen dialog
Drawer
```

The chosen pattern must follow the approved Figma interaction.

Requirements:

- No viewport clipping.
- Keyboard/focus management.
- Escape behavior where applicable.
- Touch-friendly controls.
- Body scroll handling.
- Clear close/cancel actions.

---

# 21. Navigation and Mobile Navigation

Navigation progressively simplifies as width decreases.

```text
Desktop → Full navigation
Tablet  → Reduced / collapsible navigation
Mobile  → Menu / drawer / mobile navigation
```

The existing Mobile Navigation component should be reused rather than implementing unrelated mobile menus per page.

---

# 22. Typography

Responsive typography follows the approved typography system:

- Poppins for UI.
- JetBrains Mono for data.
- Semantic typography roles.
- Approved type scale.

Responsive implementation must avoid:

- Oversized headings on small screens.
- Tiny body text.
- Unnecessary wrapping.
- Text clipping.
- Fixed widths based on English-only strings.

Data-heavy values such as prices should retain their data typography treatment.

---

# 23. Spacing

The design evidence follows the 4px spacing scale.

Verified examples include:

```text
16px
24px
32px
48px
```

Spacing may become more compact on smaller screens, but it should continue using the existing spacing system rather than arbitrary values.

---

# 24. Controls and Touch Targets

Responsive interfaces must preserve usable touch areas for:

- Buttons
- Icon buttons
- Header actions
- Sidebar/menu controls
- Quantity selectors
- Product actions
- Form controls
- Map controls

The visible icon size is not necessarily the same as the complete interactive target.

The approved control sizing system includes:

```text
Small control → 32px
Base control  → 40px
Large control → 48px
Base icon     → 24px
Small icon    → 20px
```

---

# 25. Hover and Pointer Adaptation

Important functionality must never depend only on hover.

For touch devices:

```text
:hover-only action
        ↓
Equivalent tap/focus action
```

Tooltips and hover affordances must have usable alternatives where their information is important.

---

# 26. Responsive Component States

Responsive behavior must be tested for the relevant states established in the Figma work:

```text
Default
Loading
Empty
Error
Success
Validation Error
Disabled
Processing
Out of Stock
Payment Failed
No Orders
No Search Results
```

A state that works on desktop but clips or overlaps on mobile is incomplete.

---

# 27. Accessibility

Responsive implementation must preserve:

- Semantic HTML.
- Keyboard navigation.
- Visible focus.
- Accessible names.
- Screen-reader relationships.
- Color contrast.
- Touch usability.
- Zoom/text resizing.
- Reduced-motion behavior.

The approved focus treatment is based on a 2px primary-blue ring with a 2px offset.

Mobile simplification must not remove essential labels or status information.

---

# 28. Motion on Small Screens

Motion should remain purposeful and lightweight.

Follow the approved motion system and respect:

```css
@media (prefers-reduced-motion: reduce)
```

Avoid heavy animation on low-power/mobile devices.

Layout changes should not cause unnecessary jank or cumulative layout shift.

---

# 29. Images and Performance

Responsive images should use appropriate dimensions and loading behavior.

Prefer:

- Responsive image sizing.
- Appropriate object-fit behavior.
- Lazy loading for below-the-fold content.
- Constrained previews.
- Optimized Cloudinary assets.
- Avoidance of unnecessarily large mobile downloads.

Do not load desktop-sized assets when a smaller asset is sufficient.

---

# 30. Horizontal Overflow

Unintended horizontal overflow is prohibited.

Review especially:

```text
Header
Navigation
Search
Product grids
Product cards
Cart
Checkout
Admin tables
Charts
Dialogs
Maps
Long order numbers
Long product names
Image previews
```

Intentional horizontal scrolling is acceptable for patterns such as data tables when it is explicitly designed and remains usable.

---

# 31. Orientation and Limited Height

The application should remain usable in portrait and landscape where supported.

For short-height viewports:

- Do not hide critical actions.
- Avoid oversized fixed headers.
- Keep dialogs within the usable viewport.
- Preserve access to checkout/payment actions.
- Allow content to scroll naturally.

---

# 32. Responsive QA Matrix

Every major feature should be reviewed at minimum against:

| Area | Mobile | Tablet | Desktop | Large Desktop |
|---|---:|---:|---:|---:|
| Customer Header | ✓ | ✓ | ✓ | ✓ |
| Home / Hero | ✓ | ✓ | ✓ | ✓ |
| Product Listing | ✓ | ✓ | ✓ | ✓ |
| Search | ✓ | ✓ | ✓ | ✓ |
| Product Detail | ✓ | ✓ | ✓ | ✓ |
| Cart | ✓ | ✓ | ✓ | ✓ |
| Checkout | ✓ | ✓ | ✓ | ✓ |
| Orders | ✓ | ✓ | ✓ | ✓ |
| Delivery Tracking | ✓ | ✓ | ✓ | ✓ |
| Admin Shell | ✓ | ✓ | ✓ | ✓ |
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| Tables | ✓ | ✓ | ✓ | ✓ |
| Admin Forms | ✓ | ✓ | ✓ | ✓ |
| Dialogs/Drawers | ✓ | ✓ | ✓ | ✓ |
| Image Search | ✓ | ✓ | ✓ | ✓ |

---

# 33. Figma Responsive Handoff

Responsive design evidence belongs under the approved Figma repository
structure:

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

## Repository responsibilities

| Location | Responsibility |
|---|---|
| `assets/figma/FIGMA.md` | Primary repository-side Figma governance, source-of-truth, workflow, handoff, and organization reference |
| `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` | Rules for translating approved Figma designs into implementation |
| `assets/figma/FIGMA_REFERENCES.md` | Figma file, page, frame, prototype, and handoff navigation references |
| `assets/figma/exports/Components/` | Component reference material and screenshots |
| `assets/figma/exports/admin/` | Admin experience reference material and screenshots |
| `assets/figma/exports/customer/` | Customer experience reference material and screenshots |

Responsive evidence is therefore organized by the **component, admin, and
customer experience packages** rather than by a separate
`exports/responsive/` directory.

Responsive screenshots should be placed in the relevant package:

```text
assets/figma/exports/
├── Components/
│   └── screenshots/
├── admin/
│   └── screenshots/
└── customer/
    └── screenshots/
```

Use the package README files to explain the responsive context of each
screenshot where necessary.

### Figma Design and Figma Make policy

**Figma Design is the visual source of truth.**

Figma Design should be accessed through the approved Figma Design reference
and used for authoritative inspection of:

- Components
- Layouts
- Responsive composition
- States
- Typography
- Colors
- Spacing
- Interaction intent

**Figma Make is a screenshot reference source only for Antigravity.**

The repository should not require:

- A `.make` file
- A Figma Make code export
- `exportfigmaframespng`
- `makelink`
- `exportpng` as a Figma Make implementation dependency

Figma Make screenshots belong in the relevant `Components`, `admin`, or
`customer` screenshot package when retained as visual implementation
evidence.

### Screenshot naming policy

Do not invent a new manual naming convention for Figma Make screenshots.

Preserve the **default filename generated by Figma Make**.

Do not rename screenshots into patterns such as:

```text
Button — Default.png
Product Card — Desktop.png
Product Card — Tablet.png
Product Card — Mobile.png
Customer Home — Desktop.png
```

The surrounding directory and README provide the context for the screenshot.

### Responsive source hierarchy

When implementing responsive behavior, use this order:

```text
Figma Design
    ↓
FIGMA_IMPLEMENTATION_RULES.md
    ↓
Relevant export README / screenshot evidence
    ↓
RESPONSIVE.md
    ↓
Frontend implementation
    ↓
Visual validation
```

`RESPONSIVE.md` defines the responsive engineering rules and verified vs
derived decisions. It does not override approved Figma visual decisions.

The `assets/figma/` package supports visual handoff and implementation
navigation; it does not replace the live Figma source or the design
documentation under `docs/02_Design/`.

# 34. Verified vs Derived Rules

To prevent design drift, every responsive value must be classified correctly.

### Verified from Figma work

- Desktop/tablet/mobile coverage.
- `768px` medium design intent.
- `1440px` large desktop/artboard intent.
- `24px` horizontal container padding.
- Customer/admin shell behavior.
- Admin sidebar collapse placement and sticky behavior.
- Mobile cart scrolling/overlap correction.
- Sales Overview responsive correction.
- Orders by Status stacking.
- Image-upload responsive interaction refinements.

### Derived from visual/system analysis

- 4/2/1 product-grid density.
- Additional content-driven implementation thresholds.
- Container max-width behavior inferred from artboards.
- Some responsive spacing reductions.
- Exact CSS rules needed to reproduce visual behavior.

Derived rules must not be presented as direct Figma measurements.

---

# 35. Responsive Completion Criteria

A feature is responsive only when:

- Mobile behavior is intentionally defined.
- Tablet behavior is intentionally defined.
- Desktop behavior is intentionally defined.
- Large-screen behavior is considered.
- Approved Figma responsive evidence is respected.
- No unintended horizontal overflow exists.
- Navigation adapts correctly.
- Forms remain usable.
- Tables have an intentional strategy.
- Charts remain readable.
- Images and maps adapt correctly.
- Touch targets remain usable.
- Accessibility is preserved.
- Relevant states work at each supported size.
- Motion respects reduced-motion preferences.
- Performance remains acceptable.

---

# 36. Responsive Principle

> **Responsive design is the intentional adaptation of structure, density, and interaction to available space—not the shrinking of a desktop interface.**
