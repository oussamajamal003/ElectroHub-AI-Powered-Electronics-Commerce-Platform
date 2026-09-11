# Figma

## 1. Purpose

This document defines how Figma is used as the primary design and
prototyping source for ElectroHub.

Figma is responsible for defining the intended visual experience before
and during frontend implementation.

The Figma workspace should remain aligned with the project's:

-   Design system
-   Component architecture
-   Layouts
-   Colors
-   Typography
-   Icons
-   Motion
-   Responsive behavior
-   UI guidelines

Figma is the source of truth for the intended visual design.

------------------------------------------------------------------------

# 2. Design Source of Truth

Figma defines the intended visual behavior of the application.

The implementation relationship is:

Figma ↓ Design System ↓ Component Specifications ↓ React Components ↓
SCSS / CSS Modules ↓ Implemented UI

The frontend implementation should reproduce the approved Figma design
while respecting technical constraints and accessibility requirements.

If implementation intentionally differs from the approved design, the
difference should be reviewed and documented when significant.

------------------------------------------------------------------------

# 3. Figma Workspace Structure

The Figma project should be organized into clear areas.

Recommended structure:

ElectroHub │ ├── Cover │ ├── Foundations │ ├── Colors │ ├── Typography │
├── Spacing │ ├── Radius │ ├── Shadows │ └── Icons │ ├── Components │
├── Buttons │ ├── Inputs │ ├── Selects │ ├── Cards │ ├── Dialogs │ ├──
Dropdowns │ ├── Navigation │ ├── Tables │ └── Feedback │ ├── Customer │
├── Home │ ├── Search │ ├── Product Details │ ├── Cart │ ├── Wishlist │
├── Checkout │ ├── Orders │ └── Delivery Tracking │ ├── Admin │ ├──
Dashboard │ ├── Products │ ├── Categories │ ├── Inventory │ ├── Orders │
├── Delivery │ ├── Recommendations │ └── Analytics │ ├── Responsive │
├── Mobile │ ├── Tablet │ ├── Desktop │ └── Large Desktop │ └──
Prototypes

The exact Figma page structure may evolve as the product grows, but the
separation between foundations, components, customer screens, and
administrator screens should remain clear.

------------------------------------------------------------------------

# 4. Design Foundations

The Figma design should define the visual foundations before large-scale
screen implementation.

These include:

-   Colors
-   Typography
-   Spacing
-   Grid
-   Border radius
-   Shadows
-   Icons
-   Motion
-   Responsive behavior

The corresponding technical documentation is maintained in:

docs/02_Design/ ├── DESIGN_SYSTEM.md ├── COLORS.md ├── TYPOGRAPHY.md ├──
ICONS.md ├── MOTION.md └── RESPONSIVE.md

------------------------------------------------------------------------

# 5. Components

Figma components should represent reusable UI patterns rather than
isolated screenshots.

Examples include:

-   Button
-   Input
-   Search Input
-   Select
-   Dropdown
-   Modal
-   Dialog
-   Tooltip
-   Card
-   Product Card
-   Badge
-   Toast
-   Table
-   Pagination
-   Navigation
-   Header
-   Footer
-   Loading State
-   Skeleton
-   Empty State
-   Error State

Components should use Figma variants when multiple states or
configurations exist.

Example:

Button ├── Variant: Primary ├── Variant: Secondary ├── Variant: Ghost
├── State: Default ├── State: Hover ├── State: Focus ├── State: Disabled
└── State: Loading

------------------------------------------------------------------------

# 6. Auto Layout

Figma Auto Layout should be used wherever appropriate.

Auto Layout should define:

-   Spacing
-   Padding
-   Alignment
-   Direction
-   Content resizing
-   Component relationships

This helps the design translate reliably into responsive frontend
layouts.

Avoid relying heavily on manually positioned elements when the interface
represents a reusable layout or component.

------------------------------------------------------------------------

# 7. Components and Variants

Reusable components should use variants to represent meaningful
differences.

For example:

Product Card ├── Default ├── Hover ├── Loading ├── Out of Stock ├── Low
Stock └── Featured

Another example:

Order Status ├── Confirmed ├── Preparing ├── Out for Delivery └──
Delivered

Variants should represent actual application states rather than
arbitrary visual alternatives.

------------------------------------------------------------------------

# 8. Customer Screens

The Figma design should cover the complete customer journey.

At minimum:

## Authentication

-   Login
-   Registration
-   OTP verification
-   Authentication errors

## Product Discovery

-   Home
-   Product catalog
-   Categories
-   Search
-   Search suggestions
-   Search results
-   Search by image

## Product

-   Product details
-   Product gallery
-   Specifications
-   Availability
-   Recommendations

## Shopping

-   Cart
-   Wishlist
-   Checkout
-   Payment
-   Order confirmation

## Orders

-   Order history
-   Order details
-   Invoice
-   Payment receipt
-   Delivery tracking

------------------------------------------------------------------------

# 9. Administrator Screens

The Figma design should also cover administrative workflows.

At minimum:

-   Admin Dashboard
-   Products
-   Categories
-   Inventory
-   Orders
-   Payments
-   Delivery
-   Users
-   Recommendations
-   Analytics

Each administrative screen should include the relevant:

-   Loading state
-   Empty state
-   Error state
-   Success state
-   Confirmation state
-   Responsive behavior

------------------------------------------------------------------------

# 10. Search by Image UI

The search-by-image workflow should be represented in Figma.

The user should be able to:

Search by Image ↓ Choose Source ├── Upload Image └── Camera ↓ Image
Preview ↓ Analyze ↓ Matching Products ↓ Product Details

The design should include:

-   Upload state
-   Camera state
-   Image preview
-   Processing state
-   No-results state
-   Error state
-   Matching-results state

------------------------------------------------------------------------

# 11. Checkout and Payment UI

The checkout design should clearly represent the complete flow:

Cart ↓ Shipping ↓ Payment ↓ Processing ↓ Success ↓ Order Confirmation

Figma should include:

-   Validation states
-   Payment errors
-   Loading state
-   Success state
-   Order number
-   Invoice availability
-   Payment receipt availability

Stripe Test Mode is used for the actual implementation.

------------------------------------------------------------------------

# 12. Order and Delivery UI

Order screens should visually communicate order progress.

Example:

Confirmed ↓ Preparing ↓ Out for Delivery ↓ Delivered

The delivery tracking screen should include:

-   Current status
-   Delivery timeline
-   Map
-   Delivery location
-   Route
-   Estimated arrival
-   Relevant loading states
-   Connection/error states

Real-time updates are implemented through Socket.IO.

------------------------------------------------------------------------

# 13. Email and PDF Experience

The visual design should also consider application states related to
transactional documents and emails.

Relevant UI includes:

-   Order confirmation
-   Payment confirmation
-   Invoice availability
-   Payment receipt availability
-   PDF download
-   Email delivery status where exposed to the user

Brevo handles transactional email delivery.

The backend generates order and payment PDFs.

------------------------------------------------------------------------

# 14. Responsive Design

Figma should contain responsive designs for the supported viewport
categories:

-   Mobile
-   Tablet
-   Desktop
-   Large Desktop

Responsive designs should define how:

-   Navigation changes
-   Grids resize
-   Cards adapt
-   Tables behave
-   Forms stack
-   Dialogs resize
-   Maps adapt
-   Typography scales
-   Spacing changes

Responsive behavior should be documented in:

docs/02_Design/RESPONSIVE.md

------------------------------------------------------------------------

# 15. States

Every important interactive component should have appropriate states.

Typical states include:

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

States should only be defined when they are meaningful to the component.

------------------------------------------------------------------------

# 16. Accessibility in Figma

Accessibility should be considered during design rather than added after
implementation.

Design reviews should consider:

-   Color contrast
-   Focus visibility
-   Touch target size
-   Text readability
-   Form labels
-   Error communication
-   Keyboard interaction
-   Reduced motion
-   Semantic relationships

Figma designs should not depend solely on color to communicate important
information.

------------------------------------------------------------------------

# 17. Design Tokens

Where appropriate, repeated design values should be represented as
reusable tokens.

Examples:

-   Color
-   Typography
-   Spacing
-   Radius
-   Shadow
-   Motion
-   Breakpoint

The design tokens should correspond to the implementation tokens used by
the SCSS architecture.

The goal is to avoid situations where the Figma design and
implementation use unrelated values for the same concept.

------------------------------------------------------------------------

# 18. Naming Conventions

Figma layers, components, variants, and styles should use clear names.

Prefer:

Button / Primary Button / Secondary Input / Default Input / Error
Product Card / Default Product Card / Out of Stock

Avoid:

Frame 123 Group 45 Rectangle 19 Component Copy Copy

Names should communicate purpose rather than implementation history.

------------------------------------------------------------------------

# 19. Prototype Requirements

Figma prototypes should demonstrate important user journeys.

At minimum:

## Customer

Home ↓ Search ↓ Product ↓ Cart ↓ Checkout ↓ Payment ↓ Order ↓ Delivery

## Image Search

Search ↓ Search by Image ↓ Upload / Camera ↓ Analyze ↓ Results ↓ Product

## Administrator

Login ↓ Dashboard ↓ Products / Orders / Inventory ↓ Management ↓
Delivery

The prototype should focus on meaningful product behavior rather than
attempting to simulate every backend operation.

------------------------------------------------------------------------

# 20. Design-to-Code Process

Frontend implementation should follow this process:

Requirement ↓ Figma Design ↓ Design Review ↓ Component Specification ↓
React Implementation ↓ SCSS / CSS Modules ↓ Responsive Implementation ↓
Accessibility Review ↓ Visual Comparison

The implementation should not begin with arbitrary styling when an
approved design already exists.

------------------------------------------------------------------------

# 21. Visual Validation

Implemented screens should be compared against the approved Figma
designs.

Review:

-   Layout
-   Spacing
-   Typography
-   Colors
-   Component dimensions
-   Alignment
-   Responsive behavior
-   States
-   Motion

Differences should be categorized as:

-   Intentional
-   Unintentional
-   Technical Constraint
-   Design Update Required

Significant intentional deviations should be documented.

------------------------------------------------------------------------

# 22. Figma Versioning

Important design milestones should be identifiable.

Examples:

-   Foundation Approved
-   Customer UI Approved
-   Admin UI Approved
-   Responsive Approved
-   Pre-Development Approved
-   Final UI Approved

Major design changes should be communicated before implementation
changes are made.

------------------------------------------------------------------------

# 23. Design Handoff

Before a major feature enters implementation, the relevant Figma design
should provide:

-   Approved screens
-   Component states
-   Responsive behavior
-   Typography
-   Colors
-   Spacing
-   Interaction behavior
-   Error states
-   Loading states
-   Empty states

A feature should not be considered design-complete if critical states
are missing.

------------------------------------------------------------------------

# 24. Figma and Documentation

Figma-related decisions should remain synchronized with:

-   DESIGN_SYSTEM.md
-   COMPONENTS.md
-   LAYOUTS.md
-   COLORS.md
-   TYPOGRAPHY.md
-   ICONS.md
-   MOTION.md
-   RESPONSIVE.md
-   UI_GUIDELINES.md

When a design-system decision changes, the relevant documentation must
be updated.

------------------------------------------------------------------------

# 25. Figma and Implementation Authority

Figma is the source of truth for intended visual design.

The implementation is the source of truth for actual runtime behavior.

When the two disagree:

1.  Identify the difference.
2.  Determine whether the design or implementation is outdated.
3.  Review the intended behavior.
4.  Update the appropriate source.
5.  Document significant changes.

Neither Figma nor implementation should silently drift from the other.

------------------------------------------------------------------------

# 26. Figma Completion Criteria

The Figma design foundation is considered complete when:

-   Core customer flows are designed.
-   Core administrator flows are designed.
-   Design foundations are established.
-   Reusable components are defined.
-   Component states are defined.
-   Responsive layouts are defined.
-   Loading states are defined.
-   Empty states are defined.
-   Error states are defined.
-   Checkout and payment states are defined.
-   Order and delivery states are defined.
-   Search-by-image states are defined.
-   Accessibility considerations are addressed.
-   Major user journeys are prototyped.
-   Design documentation is synchronized.

------------------------------------------------------------------------

# 27. Design Principle

> **Design the system, not just the screens.**

Figma should communicate the reusable rules, components, states, and
interactions that make the ElectroHub interface consistent across the
entire product.

------------------------------------------------------------------------

# 33. Final Figma Work Update --- ElectroHub

This section records the completed Figma/Figma Make work and the final
repository organization approved for the project.

## 33.1 Final Source-of-Truth Model

Figma is the **visual source of truth** for ElectroHub.

Figma defines the approved:

-   Visual composition
-   Components
-   Variants
-   States
-   Typography usage
-   Colors
-   Spacing relationships
-   Layout relationships
-   Responsive composition
-   Interaction intent
-   Prototype flows
-   Visual QA reference
-   Handoff presentation

The Markdown files under `docs/02_Design/` document the decisions and
rules derived from that visual source.

The implementation realizes the design and is authoritative for runtime
behavior and technical constraints.

``` text
Figma
  ↓
Approved Visual Design
  ↓
Design Documentation
  ↓
Frontend Implementation
  ↓
Visual Validation
```

A Markdown rule must never silently become a competing visual source.

## 33.2 Final Repository Asset Structure

The approved repository organization is:

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

### Repository responsibilities

| Location | Responsibility |
|---|---|
| `assets/figma/FIGMA.md` | Main repository-side Figma design handoff, governance, source-of-truth model, workflow, and approved Figma baseline |
| `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` | Rules for implementing the approved Figma design in the frontend |
| `assets/figma/FIGMA_REFERENCES.md` | Figma file, page, frame, prototype, and handoff navigation/reference information |
| `assets/figma/exports/Components/` | Reusable component export/reference material and component screenshots |
| `assets/figma/exports/admin/` | Administrator experience export/reference material and admin screenshots |
| `assets/figma/exports/customer/` | Customer experience export/reference material and customer screenshots |

### Figma source policy

The editable Figma Design file remains the authoritative visual source of truth.

Figma Make is used as a supporting visual/reference source through screenshots. Its screenshots are organized under the appropriate `Components`, `admin`, or `customer` export package.

Repository assets must support implementation and visual validation without becoming a competing design source.

The previous `Layouts/`, `Foundation/`, `screens/`, and `responsive/` export directories are not part of the approved structure and should not be recreated.

### Screenshot policy

Screenshots under the export packages are reference material only.

- Preserve the default filename generated by Figma Make.
- Do not invent component or screen filenames such as `Button — Default.png` or `Customer Home — Mobile.png`.
- Context should be provided by the package directory, README documentation, and the screenshot itself.
- Do not create repository screenshots solely to simulate a missing Figma source.
## 33.3 Replacement of the Previous Design Artifact Structure

The older standalone structure:

```text
Design/
├── Components/
├── Cover/
├── Playground/
├── Specs/
├── Tokens/
├── Variables/
└── Weather UI/
```

is not the approved ElectroHub repository structure.

The approved repository-side Figma export model is:

```text
assets/figma/exports/
├── Components/
├── admin/
└── customer/
```

Important decisions:

- `Components/` contains reusable component reference material.
- `admin/` contains administrator experience reference material.
- `customer/` contains customer experience reference material.
- `Layouts/`, `Foundation/`, `screens/`, and `responsive/` are not recreated as separate export directories.
- `Weather UI/` is WeatherApp-specific and is not carried into ElectroHub.
- Cover, Playground, and Specs remain Figma/design-work areas unless a future requirement explicitly justifies a repository artifact.
- The editable Figma project remains authoritative.

## 33.4 Figma Repository Reference Files

### `assets/figma/FIGMA.md`

The main repository-side Figma handoff and governance document. It records the source-of-truth model, approved design baseline, workflow, implementation relationship, and repository organization.

### `assets/figma/FIGMA_IMPLEMENTATION_RULES.md`

Defines the implementation rules that Antigravity and frontend developers must follow when translating the approved Figma Design into React and SCSS/CSS Modules.

### `assets/figma/FIGMA_REFERENCES.md`

Provides navigation/reference information such as:

- Figma Design file reference
- Important pages
- Important frames
- Prototype references
- Handoff references

### Export package READMEs

Each export package has its own README describing the screenshots and reference material it contains:

```text
assets/figma/exports/
├── Components/README.md
├── admin/README.md
└── customer/README.md
```

These files support navigation and handoff. They do not compete with `docs/02_Design/`.

## 33.5 Completed Foundation Work

The Figma foundation established:

### Color

-   Primary `#2563EB`
-   Primary Hover `#1D4ED8`
-   Primary Foreground `#FFFFFF`
-   Accent `#06B6D4`
-   Slate 900 → Slate 50 neutral scale
-   Semantic text/background/surface/border/status aliases
-   Muted/placeholder `#64748B`
-   Rating fill `#FDE68A`
-   Rating stroke `#B45309`

### Typography

-   Poppins for UI
-   JetBrains Mono for data/monospace
-   400 / 500 / 600 / 700 weights
-   Inter removed from the active design-system declaration

### Type scale

-   12px
-   14px
-   16px
-   18px
-   24px
-   30px
-   36px
-   48px

### Sizing

-   Control: 40px
-   Small control: 32px
-   Large control: 48px
-   Icon: 24px
-   Small icon: 20px
-   Medium avatar: 40px
-   Thumbnail: 64px
-   Product image: 240px

### Radius

Verified decisions:

-   XL: 16px
-   Avatar: 15px
-   Thumbnail: 5px
-   Modal: 12px

### Spacing

The system follows a 4px spacing foundation, with commonly verified
values including 16px, 24px, 32px, and 48px.

## 33.6 Completed Component System

The final reusable system contains 42 components.

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

The system uses reusable components and meaningful variants/states
instead of independent screen-specific styling.

## 33.7 Customer Design Work

The completed customer experience covers:

-   Home
-   Products/listing
-   Search
-   Product Detail
-   Wishlist
-   Cart
-   Checkout
-   Account
-   Orders
-   Delivery Tracking

Authentication:

``` text
Login
  ↓
OTP
  ↓
Verification
  ↓
Authenticated
```

Primary customer journey:

``` text
Home
  ↓
Search / Browse
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

## 33.8 Search-by-Image

The approved flow is:

``` text
Search
  ↓
Search by Image
  ↓
Upload / Camera
  ↓
Analyze
  ↓
Results
  ↓
Product
```

States:

-   Upload
-   Camera
-   Preview
-   Processing
-   Matching Results
-   No Results
-   Error

The user-facing experience uses a visible upload control and constrained
preview. Raw URLs remain implementation data rather than the primary
upload interaction.

## 33.9 Checkout, Payment, Orders, and Delivery

Checkout:

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

The design covers:

-   Shipping information
-   Shipping method
-   Payment method
-   Validation
-   Processing
-   Payment failure
-   Payment success
-   Order confirmation
-   Invoice availability
-   Payment receipt availability

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

Delivery tracking combines:

-   Current status
-   Timeline
-   Map
-   Location
-   Route/location information
-   Estimated arrival
-   Relevant loading/error states

## 33.10 Administrator Design Work

The completed administrator experience covers:

``` text
Admin Login
  ↓
Dashboard
  ↓
Products
  ↓
Create / Edit Product
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

``` text
Admin Header
      ↓
Sidebar + Main Content
```

Sidebar:

-   Collapse control at the top
-   Sticky below the header
-   Independent main-content scrolling
-   No header overlap
-   Correct main-content resizing when collapsed/expanded

Create/Edit Product:

-   Upload Image control
-   Empty upload state
-   Constrained preview
-   Replace
-   Remove

## 33.11 Responsive Work

The completed design covers:

-   Mobile
-   Tablet
-   Desktop
-   Large Desktop

QA addressed:

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

Rules:

-   No content overlap.
-   Desktop cart/checkout content and summaries remain separated.
-   Mobile commerce layouts stack.
-   Orders-by-status content stacks on narrow screens.
-   Admin dashboard content reflows.
-   Sidebar remains independent from main scrolling.
-   Sidebar does not cover the header.

## 33.12 Accessibility and Interaction Refinement

The design refinement established:

-   Keyboard navigation
-   Visible focus
-   Accessible labels
-   Icon-only labels
-   Touch-friendly controls
-   Validation feedback
-   Disabled states
-   Loading feedback
-   Error communication
-   Contrast-aware semantic colors
-   Reduced motion
-   Escape behavior for modal/drawer interactions where applicable

Focus:

``` text
2px primary-blue ring
2px offset
```

Critical information must not rely only on color.

## 33.13 Prototype and User Flows

### Customer purchase

``` text
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

### Authentication

``` text
Login
 ↓
OTP
 ↓
Verification
 ↓
Authenticated
```

### Administrator

``` text
Admin Login
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

Useful flow diagrams may be exported into:

``` text
assets/diagrams/flows/
```

## 33.14 Final QA and Polish

Final visual QA addressed:

-   Hero CTA default/hover/focus text visibility
-   Compact hero promotional eyebrow treatment
-   Customer branding
-   Admin branding
-   Admin sidebar collapse placement
-   Sidebar sticky/scroll behavior
-   Button typography weights
-   Admin dashboard responsiveness
-   Orders-by-status responsiveness
-   Product image upload presentation
-   Cart/checkout overlap
-   Prototype-flow integrity

These corrections form part of the current visual baseline.

## 33.15 Figma Make Workflow

The completed workflow was:

``` text
Existing Figma Context
        ↓
Design Audit
        ↓
Foundation / Token Work
        ↓
Component System
        ↓
Navigation / Shells / Layouts
        ↓
Customer IA / Screens
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

The project uses a persistent top-level `guidelines.md` for Figma Make
project rules.

The guideline layer is distinct from phase prompts:

-   Audit prompts understand existing context.
-   Guidelines establish persistent rules.
-   Phase prompts perform targeted design work.
-   QA prompts correct discovered issues.
-   Handoff organizes the approved result.

## 33.16 Handoff

The final handoff communicates:

``` text
Layouts
├── Customer
└── Admin

Screens
├── Customer
└── Admin

Responsive
├── Desktop
├── Tablet
└── Mobile

Prototype
└── Main User Flows
```

Developer notes:

``` text
Spacing      → use existing spacing tokens
Colors       → use existing color tokens
Typography   → use existing typography styles
Components   → reuse Figma components
Responsive   → follow established responsive rules
```

## 33.17 Design-to-Code Process

``` text
Requirement
    ↓
Check Existing Figma System
    ↓
Design / Update Figma
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
    ↓
Approved
```

Existing Figma components and tokens should be reused whenever the
required pattern already exists.

## 33.18 Documentation Synchronization

The design documentation remains:

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

Responsibilities:

-   `FIGMA.md` --- Figma governance, source of truth, workflow,
    references, handoff, validation
-   `DESIGN_SYSTEM.md` --- system-wide visual/interaction contract
-   `COMPONENTS.md` --- component specifications
-   `LAYOUTS.md` --- layout and shell rules
-   `COLORS.md` --- color definitions
-   `TYPOGRAPHY.md` --- typography definitions
-   `ICONS.md` --- icon rules
-   `MOTION.md` --- motion rules
-   `RESPONSIVE.md` --- responsive behavior
-   `UI_GUIDELINES.md` --- general UI rules

## 33.19 Change Governance

A significant design change follows:

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

A design change is not complete while known Figma, documentation, or
implementation drift remains unresolved.

## 33.20 Current Completion Baseline

The current Figma baseline includes:

-   Foundation tokens and variables
-   42 reusable components
-   Customer IA and screens
-   Authentication
-   Commerce and cart
-   Checkout and payment
-   Orders and delivery
-   Search by image
-   Administrator workflows
-   Responsive layouts
-   Detailed states
-   Accessibility refinement
-   Prototype/user flows
-   Final QA and polish
-   Developer handoff
-   Approved repository export organization

> **Figma defines the intended visual experience; Markdown documents the
> decisions; implementation realizes and validates that experience.**
