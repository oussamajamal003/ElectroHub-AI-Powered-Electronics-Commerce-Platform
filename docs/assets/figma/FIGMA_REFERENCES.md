# ElectroHub — Figma References

**Location:** `assets/figma/FIGMA_REFERENCES.md`  
**Status:** Approved  
**Purpose:** Canonical reference registry for the approved ElectroHub UI/UX design resources.

---

## 1. Purpose

This document identifies the canonical visual references that must be used when designing, implementing, reviewing, or visually validating the ElectroHub frontend.

The approved ElectroHub UI/UX design is defined by the Figma Design resource and its associated approved visual references.

The central rule is:

> **Do not redesign the approved ElectroHub UI. Reproduce it faithfully.**

Implementation must reproduce the approved:

- Layout
- Typography
- Colors
- Spacing
- Components
- Responsive behavior
- UI states
- Navigation
- Interactions
- Visual hierarchy
- Design-system relationships

If an implementation decision is not supported by the available design evidence, it must not be invented silently.

---

# 2. Canonical Figma Design

## 2.1 Approved Design URL

The approved ElectroHub Figma Design file is:

**ElectroHub — Design System & Product Design**

```text
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?m=auto&t=LXiqpv5AACaZ00jo-6
```

This is the **primary visual source of truth**.

When exact design information is required, developers and implementation agents should consult this Design resource rather than creating an approximation.

### Figma Design identity

```text
File key:
bAIuYTmp3sDON20fgnlBxw

Resource type:
Figma Design

Authority:
Primary visual/design-system source

Access:
Design link / connected Figma MCP where available
```

---

# 3. Source-of-Truth Model

ElectroHub uses multiple reference types, but they have clearly defined responsibilities.

```text
                 ELECTROHUB FIGMA DESIGN
                         │
                         │ Primary visual source
                         ▼
              APPROVED VISUAL DESIGN
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
  DESIGN DOCUMENTATION          APPROVED SCREENSHOTS
          │                             │
          └──────────────┬──────────────┘
                         ▼
                 FRONTEND IMPLEMENTATION
                         │
                         ▼
                  VISUAL VALIDATION
```

### Authority rules

**Figma Design** is authoritative for intended visual design.

**Approved design documentation** records the decisions, constraints, tokens, architecture notes, and implementation rules derived from the design.

**Approved screenshots** are visual references and are especially important for Figma Make output and screen-level comparison.

**Implementation** is authoritative for actual runtime behavior and technical constraints, but it must not silently replace approved visual intent.

---

# 4. Reference Categories

The ElectroHub Figma reference package consists of:

1. **Figma Design**
2. **Figma-related Markdown documentation**
3. **Approved Figma screenshots**
4. **Figma Make visual references**
5. **Repository-side visual validation references**

These references must be used according to their intended authority.

---

# 5. Figma Design — Primary Reference

The live Figma Design should be consulted for exact visual and structural information.

Use it to verify:

### Visual design

- Page composition
- Component placement
- Alignment
- Dimensions and relationships
- Typography
- Colors
- Spacing
- Radius
- Icons
- Visual hierarchy
- Responsive composition

### Design system

- Variables
- Component definitions
- Variants
- Component states
- Reusable patterns
- Foundation relationships
- Token usage

### Interaction intent

- Navigation behavior
- Interactive states
- Hover behavior
- Focus behavior
- Selected states
- Loading/processing behavior
- Modal/drawer behavior
- Prototype relationships
- Motion intent where documented

### Screen coverage

The approved work covers both:

**Customer experience**
- Home
- Products / Listing
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

**Administrator experience**
- Admin Login
- Dashboard
- Products
- Create Product
- Edit Product
- Categories
- Inventory
- Orders
- Order Details
- Delivery Management
- Customers
- Analytics
- Settings

---

# 6. Design Documentation References

The Figma reference package is supported by the project's design documentation.

The documentation may contain information derived from the approved Figma work, including:

- Design-system decisions
- UI guidelines
- Design tokens
- Component specifications
- Layout rules
- Responsive rules
- Accessibility requirements
- Interaction rules
- Figma implementation rules
- Design handoff information
- Architecture and implementation notes

## Important documentation policy

The project may consolidate these concepts into `assets/figma/FIGMA.md`.

References such as:

```text
DESIGN_HANDOFF.md
guidelines.md
DESIGN_TOKENS.md
FIGMA_IMPLEMENTATION_RULES.md
FIGMA_REFERENCES.md
```

describe conceptual areas of documentation. They do **not** automatically mean that each must exist as a separate file.

Where the project has consolidated this material, `FIGMA.md` is the central repository-side Figma documentation source.

This file exists specifically to register the canonical references and their intended authority.

---

# 7. Figma Make References

Figma Make has a different role from the live Figma Design.

For the Antigravity implementation workflow:

```text
Figma Make
     ↓
Approved screenshots
     ↓
Repository visual reference
```

Figma Make should be treated as a **visual reference**, not as the application's source-code dependency.

## Make access policy

The approved workflow does **not** require:

- `.make` files
- Make source extraction
- `makelink` as an implementation dependency
- `exportpng`
- `exportfigmaframespng`
- Make-generated source copied into the production architecture

The repository should contain approved screenshots when Make visuals are required for implementation or visual comparison.

---

# 8. Screenshot References

Screenshots are important implementation references.

They are used to preserve visual evidence for screen-level comparison, particularly where Figma Make is involved.

Screenshots should be treated as:

- Visual reference
- Layout reference
- Responsive reference
- State reference
- QA comparison reference
- Handoff reference

They must **not** be used to invent behavior that cannot be supported by the approved design.

## Screenshot authority

A screenshot represents the visual state captured at the time it was produced.

For live Design details, prefer the current Figma Design.

For Figma Make visual reference, use the approved repository screenshot.

If a screenshot and the live Design appear to conflict:

1. Identify the exact conflict.
2. Determine whether the screenshot represents an older or different state.
3. Verify the live Design where possible.
4. Preserve the approved intended design.
5. Document significant unresolved differences.

Do not silently choose an arbitrary interpretation.

---

# 9. Approved Repository Screenshot Structure

The approved Figma screenshot organization is:

```text
assets/
└── figma/
    ├── FIGMA.md
    ├── FIGMA_REFERENCES.md
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

The exact screenshot inventory may grow as the design evolves.

The category structure should remain understandable and stable.

---

# 10. Component References

The approved Figma component system contains **42 reusable components**.

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

### Implementation rule

Prefer the approved shared component model.

Do not create a visually different replacement component when an approved component already covers the requirement.

If a new component is genuinely required, it must follow the existing design-system language and be reviewed against the Figma Design.

---

# 11. Design-System References

The approved design reference establishes the following key values and conventions.

## Colors

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

The design also uses the approved Slate neutral scale and semantic aliases for:

- Text
- Background
- Surface
- Border
- Success
- Warning
- Error
- Information
- Neutral states

Do not introduce arbitrary replacement colors.

## Typography

UI typography:

```text
Poppins
Weights:
400
500
600
700
```

Data-oriented typography:

```text
JetBrains Mono
Weights:
400
500
600
700
```

Do not replace the active design-system typography with another font without explicit approval.

## Spacing

The approved visual system follows the 4px spacing scale.

Common implementation evidence includes:

```text
16px
24px
32px
48px
```

## Sizing

Approved key sizing references include:

```text
Control:          40px
Small control:    32px
Large control:    48px
Icon:             24px
Small icon:       20px
Avatar:           40px
Thumbnail:        64px
Product image:    240px
```

## Radius

Approved references include:

```text
XL:          16px
Avatar:      15px
Thumbnail:    5px
Modal:       12px
```

Do not create additional radius values merely for convenience when an approved token already applies.

## Focus

The approved focus treatment uses:

```text
2px solid primary blue
2px offset
```

Interactive elements must preserve a visible focus treatment.

---

# 12. Responsive References

The design covers:

```text
Desktop
Tablet
Mobile
```

Key design-intent references include:

```text
Tablet / medium breakpoint reference: 768px
Large desktop reference:              1440px
```

These values represent design intent and must not automatically be interpreted as proof of an exact CSS media-query implementation.

Responsive behavior should be reproduced from the approved visual composition.

Important responsive principles include:

- Preserve hierarchy.
- Preserve usability.
- Reflow rather than merely shrink desktop layouts.
- Maintain touch-friendly controls.
- Stack content where required.
- Keep navigation usable on small screens.
- Prevent horizontal overflow.
- Preserve readable typography.
- Preserve required states across breakpoints.

---

# 13. UI State References

Approved state coverage includes:

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

These states are part of the design reference and should not be omitted from implementation when the corresponding feature requires them.

A feature should not be considered visually complete if critical states are missing.

---

# 14. Navigation and Flow References

## Customer navigation

```text
Home
Products
Cart
Orders
Account
```

## Customer purchase flow

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

## Authentication flow

```text
Login
  ↓
OTP
  ↓
Verification
  ↓
Authenticated
```

## Admin flow

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
Customer sees status
```

These flows are references for intended navigation and interaction relationships.

---

# 15. Visual Validation

When implementing or reviewing a screen, compare the result against the appropriate approved reference.

## Validation checklist

Verify:

- Layout
- Alignment
- Spacing
- Typography
- Colors
- Component selection
- Component states
- Icons
- Borders
- Radius
- Responsive composition
- Navigation
- Interaction states
- Loading/empty/error behavior
- Accessibility-related visual states

## Evidence classification

Use one of:

```text
VERIFIED
PARTIALLY VERIFIED
NOT VERIFIED
```

Example:

```text
FIGMA REFERENCE:
Figma Design

VERIFICATION:
VERIFIED

SCREEN:
Product Details — Desktop

RESULT:
PASS
```

If the comparison is against a repository screenshot:

```text
FIGMA REFERENCE:
Approved Figma screenshot

VERIFICATION:
VISUAL REFERENCE ONLY

RESULT:
PASS / PASS WITH DEVIATIONS
```

---

# 16. Conflict Resolution

When references disagree, do not guess.

Use this process:

### Step 1 — Identify

Describe the exact conflict.

Example:

```text
Figma Design shows a 16px radius.
Screenshot appears to show a different radius.
```

### Step 2 — Verify

Check the live Figma Design and applicable documentation.

### Step 3 — Classify

Determine whether the difference is:

- Outdated screenshot
- Different responsive state
- Different component state
- Design evolution
- Implementation defect
- Unresolved

### Step 4 — Resolve

Follow the highest-authority applicable source.

### Step 5 — Document

Record significant deviations rather than silently changing the design.

---

# 17. No-Redesign Rule

The purpose of implementation is to reproduce the approved ElectroHub design.

Do **NOT**:

- Invent a new visual system.
- Replace approved components without reason.
- Change colors arbitrarily.
- Change typography arbitrarily.
- Change spacing arbitrarily.
- Simplify responsive behavior without approval.
- Remove designed states.
- Replace navigation patterns.
- Create a competing layout.
- Use generic UI as a substitute for the approved design.
- Treat generated code as automatically correct.

### Required behavior

If something is unclear:

```text
VERIFY → DO NOT INVENT
```

If something is missing:

```text
REPORT → DO NOT FABRICATE
```

If something conflicts:

```text
IDENTIFY → VERIFY → DOCUMENT
```

---

# 18. Antigravity Reference Rules

Antigravity must distinguish between the two Figma resources.

## Figma Design

```text
ALLOWED
- designlink
- Connected Figma MCP
- get_metadata
- get_design_context
- get_variable_defs
- get_screenshot when required for verification
- get_motion_context
- Selected-node/frame inspection
```

```text
NOT THE APPROVED DESIGN WORKFLOW
- exportfigmaframespng
- Repository screenshots as a substitute for the live Design
```

The Figma MCP is selection-scoped for deep inspection. A selected frame/node can provide detailed information about that scope, but a single selected frame must not be represented as unrestricted full-file inspection.

## Figma Make

```text
ALLOWED
- Approved repository screenshots
- Visual comparison against those screenshots
```

```text
NOT ALLOWED
- .make files
- Make source extraction
- exportpng
- exportfigmaframespng
- makelink as an implementation dependency
- Treating Make source as production architecture
```

---

# 19. Evidence and No-Fabrication Policy

Every important design claim must be supported by an appropriate reference.

Possible evidence:

- Figma Design inspection
- Figma MCP result
- Approved screenshot
- Approved project documentation
- Existing implementation that has already been validated

Do not claim:

- A variable exists without verifying it.
- A component property exists without verifying it.
- A responsive rule exists without evidence.
- A screenshot represents a different state without evidence.
- Figma Make source was inspected when only screenshots were available.

If evidence is unavailable:

```text
NOT VERIFIED
```

and state what is missing.

---

# 20. Relationship to `FIGMA.md`

`FIGMA.md` is the central Figma documentation and implementation reference for the repository.

`FIGMA_REFERENCES.md` exists to make the reference sources explicit and easy to locate.

The two documents have different purposes:

```text
FIGMA.md
    ↓
Full Figma design/handoff/implementation policy

FIGMA_REFERENCES.md
    ↓
Canonical resource registry and source-reference policy
```

If the project chooses to keep all conceptual Figma documentation consolidated into `FIGMA.md`, this file should remain a concise registry of the canonical resources and their authority rather than becoming a competing design specification.

---

# 21. Repository Placement

This document belongs at:

```text
assets/
└── figma/
    └── FIGMA_REFERENCES.md
```

The associated visual references belong under:

```text
assets/
└── figma/
    └── exports/
        ├── Components/
        ├── admin/
        └── customer/
```

---

# 22. Canonical Reference Summary

| Reference | Role | Authority |
|---|---|---|
| Figma Design | Live approved visual/design-system source | **Primary** |
| `FIGMA.md` | Consolidated design/handoff/implementation documentation | **Authoritative project documentation** |
| Approved Figma screenshots | Visual reference and comparison evidence | **Reference** |
| Figma Make screenshots | Visual reference for Make output | **Reference** |
| Frontend implementation | Actual runtime behavior and technical constraints | **Runtime authority** |

---

# 23. Final Policy

```text
ELECTROHUB FIGMA REFERENCE POLICY

SOURCE OF TRUTH
- Use the approved Figma Design as the primary visual source of truth.
- Use approved screenshots as important visual references.
- Use project Figma documentation for documented decisions and rules.

IMPLEMENTATION
- Reproduce the approved design.
- Do not redesign the UI.
- Reuse approved components and tokens.
- Preserve typography, colors, spacing, layout, states, navigation,
  responsive behavior, and interactions.

FIGMA DESIGN
- Use the approved Design link.
- Use connected Figma MCP when exact inspection is required.
- Do not replace the live Design source with repository PNG exports.

FIGMA MAKE
- Use approved screenshots as visual references.
- Do not extract or depend on Make source.

CONFLICTS
- Identify.
- Verify.
- Resolve using the applicable authoritative source.
- Document significant deviations.

UNCERTAINTY
- Never invent.
- Mark unsupported information as NOT VERIFIED.
```

---

## 24. Design Principle

> **Do not invent a replacement design. Reproduce the approved ElectroHub experience faithfully.**

The objective is not to create a similar interface.

The objective is to implement the **approved ElectroHub design system and experience** with high visual and behavioral fidelity.
