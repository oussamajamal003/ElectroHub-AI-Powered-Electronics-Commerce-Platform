# ElectroHub — Figma Design Documentation

**Location:** `assets/figma/FIGMA.md`  
**Purpose:** Single, self-contained design handoff and implementation reference for the ElectroHub Figma work.  
**Audience:** Designers, developers, Antigravity, reviewers, and technical contributors.  
**Status:** Approved project documentation.

> **Important:** This document is intentionally self-contained. The design handoff, Figma Make guidelines, design-token documentation, architecture/implementation notes, Figma access policy, references, and final Figma decisions are consolidated into this single `FIGMA.md` file. They are not intended to imply a required set of separate files.

---

# 1. Design Documentation — Self-Contained Handoff

This document is the central design reference for ElectroHub.

It consolidates the content that would otherwise be distributed across:

- Design handoff documentation
- Figma Make guidelines
- Design tokens
- Architecture and implementation notes
- Figma references
- Antigravity Figma implementation rules
- Final Figma QA and handoff decisions

The goal is to give implementation agents and developers one authoritative place to understand how the approved Figma work should be accessed and implemented.

---

# 2. Figma Resources

ElectroHub uses two separate Figma resources:

1. **ElectroHub Figma Design**
2. **ElectroHub Figma Make**

They have different roles and **MUST NOT be treated as the same resource**.

## 2.1 Figma Design

The Figma Design is the authoritative live visual/design-system source.

Antigravity access:

```text
Figma Design
    ↓
designlink / connected Figma MCP
```

Use the Design source for exact:

- Components
- Layout
- Variables
- Typography
- Colors
- Spacing
- Sizing
- Radius
- Interaction/motion context
- Node structure

## 2.2 Figma Make

Figma Make is a **visual reference only** for the Antigravity implementation workflow.

Antigravity accesses Make through repository screenshots.

```text
Figma Make
    ↓
Repository screenshots
    ↓
Antigravity visual reference
```

Do not treat Figma Make as a source-code dependency or alternate Design API.

---

# 3. Source-of-Truth Hierarchy

For visual design and implementation decisions:

```text
FIGMA DESIGN
    >
ELECTROHUB DESIGN DOCUMENTATION
    >
FIGMA MAKE SCREENSHOTS
    >
IMPLEMENTATION
```

Figma defines the approved visual intent.

The documentation consolidates the approved design decisions and implementation rules.

Make screenshots provide visual reference only.

The implementation realizes the design and is authoritative for actual runtime behavior and technical constraints.

If implementation differs from approved design, the difference must be intentional, technically justified, or explicitly reported.

---

# 4. Final Antigravity Figma Access Policy

## 4.1 Figma Design

Allowed:

- Figma Design `designlink`
- Connected Figma Dev Mode MCP
- `get_metadata`
- `get_design_context`
- `get_variable_defs`
- `get_screenshot` when MCP visual verification is required
- `get_motion_context`
- Selected-node/frame inspection

Explicitly prohibited as the repository Design-reference workflow:

- `exportfigmaframespng`
- Design screenshots stored as substitutes for the live Design source
- Design PNG exports used as a replacement for `designlink`

```text
FIGMA DESIGN
    = LIVE DESIGN SOURCE
    = designlink / Figma MCP
    = NO exportfigmaframespng
    = NO repository screenshots as a Design substitute
```

## 4.2 Figma Make

Allowed:

- Repository screenshots
- Visual inspection of screenshots
- Screenshot-based comparison/reference

Prohibited:

- `.make` files
- Make project exports
- `exportfigmaframespng`
- `exportpng`
- `makelink`
- Make source-resource extraction
- Make implementation/source files
- Make project internals through the Figma Design MCP

```text
FIGMA MAKE
    = VISUAL REFERENCE ONLY
    = REPOSITORY SCREENSHOTS
    = NO .make
    = NO exportfigmaframespng
    = NO exportpng
    = NO makelink
    = NO Make source extraction
```

The Design and Make workflows MUST remain separate.

---

# 5. Figma MCP Implementation Rules

When implementing or reviewing UI based on the ElectroHub Figma Design:

1. Treat Figma Design as the visual source of truth.

2. Before implementing a Figma-based screen or component:
   - Ensure the relevant Figma frame/component is actively selected when selection-scoped MCP inspection is required.
   - Use the connected Figma MCP server.
   - Inspect the selected scope with `get_design_context`.
   - Use `get_variable_defs` when token/variable information is required.
   - Use `get_screenshot` when visual verification is required.
   - Use `get_metadata` when page/frame/node structure needs to be verified.
   - Use `get_motion_context` when motion/interaction information is required and available.

3. Do NOT blindly copy generated Tailwind classes or absolute positioning returned by `get_design_context`.

4. Translate Figma values into the existing ElectroHub design system:
   - existing color tokens
   - existing typography tokens
   - existing spacing system
   - existing sizing tokens
   - existing radius tokens
   - existing component primitives

5. Do NOT introduce duplicate tokens when an equivalent ElectroHub token already exists.

6. Do NOT hardcode design-system values unnecessarily.

7. Do NOT replace existing ElectroHub components with ad-hoc components when an approved shared component already exists.

8. If Figma MCP returns information that conflicts with the documented ElectroHub design system:
   - STOP.
   - Report the conflict.
   - Do not silently choose one source.
   - Resolve the conflict according to the approved source-of-truth rules.

9. Never claim that a Figma property, variable, layout, component, or design decision was verified unless the MCP actually returned evidence.

10. Local Figma MCP inspection is selection-scoped. Do not claim full-file deep inspection from a single selected frame.

11. Figma Make is NOT assumed to be accessible through the local Figma Dev Mode MCP server.

12. After implementation, visually compare the implementation against the corresponding approved Figma reference and report known deviations.

---

# 6. Selection-Scoped MCP Behavior

The local Figma MCP may require an active selection in Figma Desktop for deep inspection.

If an MCP call returns:

```text
Nothing is selected
```

do not interpret that alone as an MCP failure.

Instead:

1. Identify the relevant Design frame/component/node.
2. Select it in Figma Desktop.
3. Re-run the appropriate MCP inspection.
4. Report actual returned evidence.

A successful `get_metadata` call alone does not prove that all variables or deep design properties have been inspected.

Never fabricate missing Figma information.

---

# 7. Interpreting Figma MCP Output

`get_design_context` may return implementation-oriented values such as:

```text
bg-white
text-black
absolute
left-[...]
top-[...]
w-[...]
h-[...]
font-['Poppins:Regular']
```

These are reference evidence, not instructions to blindly reproduce generated code.

The correct process is:

```text
Figma value
    ↓
Existing ElectroHub token
    ↓
Existing shared component / primitive
    ↓
Implementation
```

Avoid:

```text
Figma value
    ↓
Repeated hardcoded values
    ↓
Duplicate design system
```

Preserve the visual result while maintaining reusable, token-driven implementation.

---

# 8. Figma Make Screenshot Repository

The approved Make screenshot organization is:

```text
assets/
└── figma/
    ├── FIGMA.md
    └── exports/
        ├── Components/
        │   ├── README.md
        │   └── screenshots/
        │
        ├── admin/
        │   ├── README.md
        │   └── screenshots/
        │       ├── admin-Dashboard — Desktop.png
        │       ├── Products — Desktop.png
        │       ├── Orders — Desktop.png
        │       └── ...
        │
        └── customer/
            ├── README.md
            └── screenshots/
                ├── customer-Home — Desktop.png
                ├── customer-Home — Tablet.png
                ├── customer-Home — Mobile.png
                ├── Products — Desktop.png
                ├── Product Details — Desktop.png
                ├── Cart — Desktop.png
                ├── Checkout — Desktop.png
                └── ...
```

These screenshots are Make visual references only.

They are not substitutes for the Figma Design source.

---

# 9. Figma Make Screenshot Rules

Repository Make screenshots:

- Are visual references only.
- Are not source code.
- Are not the underlying Make project.
- Must not be used to claim Make implementation/source access.
- May be used for visual comparison.
- May inform visible composition, hierarchy, responsive presentation, and layout appearance.
- Must not silently override the authoritative Figma Design.

If a screenshot does not provide enough information for an implementation decision, do not invent the missing detail.

---

# 10. Design System and Token Rules

The ElectroHub design system is token-driven.

Use existing tokens for:

- Colors
- Typography
- Spacing
- Sizing
- Radius
- Shadows/elevation
- Breakpoints
- Focus treatment
- Semantic aliases

Do not create duplicate tokens when an existing approved token provides the required value.

## 10.1 Colors

Primary:

```text
#2563EB
```

Primary hover:

```text
#1D4ED8
```

Accent:

```text
#06B6D4
```

Semantic text:

```text
Primary:   #0F172A
Secondary: #475569
Muted:     #64748B
Disabled:  #94A3B8
Inverse:   #FFFFFF
```

Surface and borders:

```text
Surface:        #FFFFFF
Border default: #E2E8F0
Border subtle:  #F1F5F9
```

Status colors use the approved semantic success, warning, error, info, and neutral roles.

## 10.2 Typography

Primary UI font:

```text
Poppins
```

Approved UI weights:

```text
400 Regular
500 Medium
600 Semibold
700 Bold
```

Data-oriented typography:

```text
JetBrains Mono
```

Inter is not part of the active ElectroHub design system.

## 10.3 Spacing

Use the established 4px-based spacing scale.

Verified examples include:

```text
16px
20px
24px
48px
```

Do not introduce arbitrary spacing when an existing token provides the required result.

## 10.4 Sizing

Established sizing references:

```text
Control:       40px
Control small: 32px
Control large: 48px
Icon:          24px
Icon small:    20px
Avatar medium: 40px
Thumbnail:     64px
Product image: 240px
```

## 10.5 Radius

Verified examples:

```text
16px — xl
15px — avatar
5px  — thumbnail
12px — modal
```

Unverified/derived values must not silently become new design-system truth.

## 10.6 Shadows and Elevation

The design system uses a predominantly flat treatment.

Functional shadows may be used where required for floating/modal UI, but such shadows must not be represented as Figma-verified design tokens unless actual evidence exists.

## 10.7 Breakpoints and Responsive Intent

The approved design covers:

- Mobile
- Tablet
- Desktop
- Large Desktop

Verified design-intent references include:

```text
768px
1440px
```

These values must not automatically be interpreted as explicit CSS breakpoint declarations unless established by the implementation architecture.

## 10.8 Focus

Approved focus treatment:

```text
2px primary-blue ring
2px offset
```

Focus must remain visible and accessible.

---

# 11. Core UI Principles

ElectroHub follows these principles:

### Clarity

Users should immediately understand what the page is, what changed, and what action is available.

### Consistency

Equivalent interactions should use the same component, visual treatment, terminology, and behavior.

### Reuse

Approved components should be reused instead of recreating visually similar controls.

### Accessibility

Accessibility is part of component and feature design, not a final polish step.

### Responsive Structure

Interfaces adapt their structure and interaction patterns rather than merely shrinking.

### Feedback

Important actions and system states must provide clear feedback.

### Performance

Visual quality must not introduce unnecessary rendering, assets, animation, or dependencies.

---

# 12. Visual Hierarchy and Layout Rules

Every screen should establish a clear hierarchy.

Typical hierarchy:

```text
Page Title
    ↓
Section Title
    ↓
Primary Content
    ↓
Supporting Information
    ↓
Secondary Actions
```

Primary actions should be visually stronger than secondary actions.

Pages should use consistent content containers controlling:

- Maximum width
- Horizontal padding
- Alignment
- Responsive behavior

Individual pages must not invent unrelated container widths.

Related elements should share common alignment lines.

---

# 13. Component System

The approved component system contains five major tiers.

## Tier 1 — Foundation

1. Button
2. Icon Button
3. Input
4. Textarea
5. Select
6. Checkbox
7. Radio
8. Switch
9. Badge
10. Avatar
11. Tooltip

## Tier 2 — Navigation

12. Header
13. Sidebar
14. Breadcrumb
15. Tabs
16. Pagination
17. Dropdown
18. Mobile Navigation

## Tier 3 — Feedback

19. Alert
20. Toast
21. Modal
22. Drawer
23. Dialog
24. Spinner
25. Skeleton
26. Error State
27. Empty State

## Tier 4 — Commerce

28. Product Card
29. Product Image
30. Product Gallery
31. Price
32. Rating
33. Quantity Selector
34. Cart Item
35. Order Status
36. Payment Status

## Tier 5 — Admin

37. Data Table
38. Filter Bar
39. Stats Card
40. Chart Container
41. Admin Form
42. Status Badge

Existing approved primitives should be reused whenever the required pattern already exists.

---

# 14. Component and Interaction Rules

## Buttons

Use clear hierarchy:

```text
Primary
Secondary
Ghost
Danger
```

Use Primary for the main action, Secondary for supporting actions, Ghost for low-emphasis actions, and Danger for destructive actions.

Relevant states include:

```text
Default
Hover
Focus
Active
Disabled
Loading
Success
```

States must remain understandable without relying only on color.

## Forms

Forms should provide:

```text
Label
Input
Helper Text
Error Text
```

Validation must be clear and associated with the relevant control.

## Accessibility

The design expects:

- Keyboard navigation
- Visible focus
- Accessible icon labels
- Disabled states
- Validation feedback
- Touch-friendly controls
- Contrast-aware semantic colors
- Reduced motion
- Escape behavior for modal/drawer interactions where applicable

---

# 15. Customer Experience

The customer information architecture covers:

- Home
- Products
- Search
- Product Details
- Wishlist
- Cart
- Checkout
- Payment
- Order Confirmation
- Orders
- Order Details
- Account
- Delivery Tracking
- Authentication

Primary navigation:

```text
Home
Products
Cart
Orders
Account
```

Core routes:

```text
/
 /products
 /products/:id
 /search
 /wishlist
 /account
 /orders
 /checkout
```

---

# 16. Commerce and Checkout

Checkout is represented as:

```text
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

Desktop cart and checkout use separate content and summary areas without overlap.

Mobile commerce layouts stack.

Order screens communicate:

- Order number
- Date
- Products
- Total
- Payment status
- Order status
- Delivery status
- Invoice
- Payment receipt

Delivery tracking combines:

- Status
- Timeline
- Map
- Location
- Estimated Arrival

---

# 17. Administrator Experience

Admin flow:

```text
Admin Login
    ↓
Dashboard
    ↓
Products
    ↓
Create/Edit Product
    ↓
Categories
    ↓
Inventory
    ↓
Orders
    ↓
Order Details
    ↓
Delivery Management
    ↓
Customers
    ↓
Analytics
    ↓
Settings
```

Admin shell:

```text
Admin Header
    +
Sidebar
    +
Main Content
```

The Sidebar collapse control is positioned at the top of the sidebar.

The sidebar remains sticky below the header while main content scrolls independently.

The sidebar must not cover the header.

The main content must resize correctly between expanded and collapsed sidebar states.

Create/Edit Product includes:

- Upload Image control
- Empty upload state
- Constrained image preview
- Replace action
- Remove action

The raw image URL is not the primary user-facing interaction.

---

# 18. Responsive Rules

Responsive work covers:

- Mobile
- Tablet
- Desktop
- Large Desktop

Validated areas include:

- Customer navigation
- Product grids
- Product details
- Forms
- Tables
- Cart
- Checkout
- Admin dashboard
- Orders
- Dialogs
- Drawers
- Search by image
- Delivery/tracking

Mandatory responsive principles:

- No content overlap.
- Desktop two-column commerce layouts remain separated.
- Mobile commerce layouts stack.
- Admin dashboard content reflows.
- Orders-by-status content stacks on narrow screens.
- Sidebar behavior remains independent from scrolling main content.
- Header is never covered by the sidebar.

---

# 19. Required UI States

The design system covers:

- Loading
- Empty
- Error
- Success
- Validation Error
- Disabled
- Processing
- Out of Stock
- Payment Failed
- No Orders
- No Search Results

A feature should not be considered design-complete if critical states are missing.

---

# 20. Prototype and User Flows

## Customer

```text
Home
  ↓
Search
  ↓
Product
  ↓
Add to Cart
  ↓
Cart
  ↓
Checkout
  ↓
Payment
  ↓
Success
  ↓
Order
  ↓
Delivery Tracking
```

## Authentication

```text
Login
  ↓
OTP
  ↓
Verification
  ↓
Authenticated
```

## Administrator

```text
Login
  ↓
Dashboard
  ↓
Orders
  ↓
Order Details
  ↓
Update Delivery
  ↓
Customer sees updated status
```

The prototype focuses on meaningful product behavior rather than attempting to simulate every backend operation.

---

# 21. Design-to-Code Process

Frontend implementation should follow:

```text
Requirement
    ↓
Figma Design
    ↓
Design Review
    ↓
Component Specification
    ↓
React Implementation
    ↓
SCSS / CSS Modules
    ↓
Responsive Implementation
    ↓
Accessibility Review
    ↓
Visual Comparison
```

When exact Design information is required, use the Design link/MCP.

When visual comparison with the Make reference is required, use the repository screenshots.

Do not begin with arbitrary styling when an approved design already exists.

---

# 22. Visual Validation

Implemented screens should be compared against the approved Design source.

Review:

- Layout
- Spacing
- Typography
- Colors
- Component dimensions
- Alignment
- Responsive behavior
- States
- Motion

Differences should be categorized as:

- Intentional
- Unintentional
- Technical Constraint
- Design Update Required

Significant intentional deviations should be documented.

---

# 23. Figma Versioning and Design Handoff

Important design milestones should be identifiable, such as:

- Foundation Approved
- Customer UI Approved
- Admin UI Approved
- Responsive Approved
- Pre-Development Approved
- Final UI Approved

Before a major feature enters implementation, the relevant Design should provide:

- Approved screens
- Component states
- Responsive behavior
- Typography
- Colors
- Spacing
- Interaction behavior
- Error states
- Loading states
- Empty states

A feature should not be considered design-complete if critical states are missing.

---

# 24. Final Figma Work Baseline

The completed Figma workflow established:

```text
Design Audit
    ↓
Foundation / Tokens
    ↓
Variables / Token Inventory
    ↓
Component System
    ↓
Navigation / Shells / Layouts
    ↓
Customer IA / Core Screens
    ↓
Authentication / Commerce / Cart
    ↓
Checkout / Payment / Orders / Delivery
    ↓
Admin System
    ↓
Responsive + States
    ↓
Accessibility + UX Refinement
    ↓
Prototype / User Flows
    ↓
Final QA / Polish
    ↓
Handoff
```

Final QA/polish included:

- Hero CTA text visibility
- Compact hero promotional eyebrow treatment
- Customer branding
- Admin branding
- Admin sidebar collapse placement
- Sidebar sticky/scroll behavior
- Button typography weights
- Admin dashboard responsiveness
- Orders-by-status responsiveness
- Product image upload presentation
- Cart/checkout overlap
- Prototype-flow integrity

These decisions form the current ElectroHub visual baseline.

---

# 25. Architecture and Implementation Notes

The design system must remain consistent with the approved ElectroHub frontend architecture.

Approved frontend styling approach:

```text
React
+
TypeScript
+
Vite
+
SCSS / CSS Modules
```

The Figma design system must not be used as justification for introducing unrelated architecture or styling dependencies.

Existing shared components and design tokens should be reused.

Figma-generated Tailwind-oriented output may be useful as inspection evidence, but it does not override the approved ElectroHub implementation architecture.

---

# 26. Documentation Synchronization

The design decisions represented in this document should remain synchronized with the broader ElectroHub design documentation where those documents exist.

Relevant design areas include:

- Design System
- Components
- Layouts
- Colors
- Typography
- Icons
- Motion
- Responsive
- UI Guidelines

If this `FIGMA.md` is intended to be the consolidated design handoff, changes to approved design decisions should be reflected here as well.

No separate document should silently become a competing source of truth.

---

# 27. Evidence and Verification

Whenever Figma resources are used, identify the source:

```text
SOURCE:
FIGMA DESIGN
```

or:

```text
SOURCE:
FIGMA MAKE SCREENSHOT
```

For Design MCP evidence:

- Report actual MCP results.
- Identify the inspected frame/node where applicable.
- Distinguish metadata inspection from deep inspection.
- Do not claim full-file deep inspection from a single selected frame.

For Make screenshot references:

- State that the information came from a repository screenshot.
- Do not describe screenshot observations as Make source-code access.
- Do not claim access to Make internals.

---

# 28. No-Fabrication Rule

Never invent:

- Figma variables
- Component properties
- Layout measurements
- Responsive behavior
- Typography values
- Color values
- Design decisions
- Make project source access

If evidence is unavailable, report:

```text
NOT VERIFIED
```

and identify the missing evidence.

---

# 29. Design vs Implementation Authority

Figma is the source of truth for intended visual design.

The implementation is the source of truth for actual runtime behavior and technical constraints.

When they disagree:

1. Identify the difference.
2. Determine whether the Design or implementation is outdated.
3. Review the intended behavior.
4. Update the appropriate source.
5. Document significant changes.

Neither Figma nor implementation should silently drift from the other.

---

# 30. Figma Completion Criteria

The Figma design foundation is complete when:

- Core customer flows are designed.
- Core administrator flows are designed.
- Design foundations are established.
- Reusable components are defined.
- Component states are defined.
- Responsive layouts are defined.
- Loading states are defined.
- Empty states are defined.
- Error states are defined.
- Checkout and payment states are defined.
- Order and delivery states are defined.
- Search-by-image states are defined.
- Accessibility considerations are addressed.
- Major user journeys are prototyped.
- Design documentation is synchronized.

---

# 31. Design Principle

> **Design the system, not just the screens.**

Figma should communicate the reusable rules, components, states, and interactions that make the ElectroHub interface consistent across the entire product.

---

# 32. Final Compact Policy

```text
ELECTROHUB FIGMA POLICY

FIGMA DESIGN
- Live authoritative design source.
- Access through designlink / connected Figma MCP.
- Use selected-node inspection when required.
- No exportfigmaframespng.
- No repository screenshots as a Design substitute.

FIGMA MAKE
- Visual reference only.
- Access through repository screenshots.
- No .make files.
- No exportfigmaframespng.
- No exportpng.
- No makelink.
- No Make source extraction.

IMPLEMENTATION
- Follow approved ElectroHub architecture.
- Reuse existing tokens.
- Reuse approved components.
- Do not blindly copy generated Figma/Tailwind output.
- Report conflicts.
- Report deviations.
- Provide evidence.
- Never fabricate unavailable information.
```

---

# 33. Final Repository Placement

This document belongs at:

```text
assets/
└── figma/
    └── FIGMA.md
```

The `assets/figma/` directory contains the consolidated Figma documentation entry point and the repository's approved **Figma Make screenshot references**.

The key principle is:

```text
FIGMA DESIGN
    → designlink / MCP
    → authoritative live source

FIGMA MAKE
    → repository screenshots
    → visual reference only

FIGMA.md
    → consolidated design handoff
    → guidelines
    → token documentation
    → architecture/implementation notes
    → access policy
    → references
    → QA and handoff rules
```
