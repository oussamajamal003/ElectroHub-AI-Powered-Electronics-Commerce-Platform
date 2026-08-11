# Figma

## 1. Purpose

This document defines how Figma is used as the primary design and prototyping source for ElectroHub.

Figma is responsible for defining the intended visual experience before and during frontend implementation.

The Figma workspace should remain aligned with the project's:

- Design system
- Component architecture
- Layouts
- Colors
- Typography
- Icons
- Motion
- Responsive behavior
- UI guidelines

Figma is the source of truth for the intended visual design.

---

# 2. Design Source of Truth

Figma defines the intended visual behavior of the application.

The implementation relationship is:

Figma
  ↓
Design System
  ↓
Component Specifications
  ↓
React Components
  ↓
SCSS / CSS Modules
  ↓
Implemented UI

The frontend implementation should reproduce the approved Figma design while respecting technical constraints and accessibility requirements.

If implementation intentionally differs from the approved design, the difference should be reviewed and documented when significant.

---

# 3. Figma Workspace Structure

The Figma project should be organized into clear areas.

Recommended structure:

ElectroHub
│
├── Cover
│
├── Foundations
│   ├── Colors
│   ├── Typography
│   ├── Spacing
│   ├── Radius
│   ├── Shadows
│   └── Icons
│
├── Components
│   ├── Buttons
│   ├── Inputs
│   ├── Selects
│   ├── Cards
│   ├── Dialogs
│   ├── Dropdowns
│   ├── Navigation
│   ├── Tables
│   └── Feedback
│
├── Customer
│   ├── Home
│   ├── Search
│   ├── Product Details
│   ├── Cart
│   ├── Wishlist
│   ├── Checkout
│   ├── Orders
│   └── Delivery Tracking
│
├── Admin
│   ├── Dashboard
│   ├── Products
│   ├── Categories
│   ├── Inventory
│   ├── Orders
│   ├── Delivery
│   ├── Recommendations
│   └── Analytics
│
├── Responsive
│   ├── Mobile
│   ├── Tablet
│   ├── Desktop
│   └── Large Desktop
│
└── Prototypes

The exact Figma page structure may evolve as the product grows, but the separation between foundations, components, customer screens, and administrator screens should remain clear.

---

# 4. Design Foundations

The Figma design should define the visual foundations before large-scale screen implementation.

These include:

- Colors
- Typography
- Spacing
- Grid
- Border radius
- Shadows
- Icons
- Motion
- Responsive behavior

The corresponding technical documentation is maintained in:

docs/02_Design/
├── DESIGN_SYSTEM.md
├── COLORS.md
├── TYPOGRAPHY.md
├── ICONS.md
├── MOTION.md
└── RESPONSIVE.md

---

# 5. Components

Figma components should represent reusable UI patterns rather than isolated screenshots.

Examples include:

- Button
- Input
- Search Input
- Select
- Dropdown
- Modal
- Dialog
- Tooltip
- Card
- Product Card
- Badge
- Toast
- Table
- Pagination
- Navigation
- Header
- Footer
- Loading State
- Skeleton
- Empty State
- Error State

Components should use Figma variants when multiple states or configurations exist.

Example:

Button
├── Variant: Primary
├── Variant: Secondary
├── Variant: Ghost
├── State: Default
├── State: Hover
├── State: Focus
├── State: Disabled
└── State: Loading

---

# 6. Auto Layout

Figma Auto Layout should be used wherever appropriate.

Auto Layout should define:

- Spacing
- Padding
- Alignment
- Direction
- Content resizing
- Component relationships

This helps the design translate reliably into responsive frontend layouts.

Avoid relying heavily on manually positioned elements when the interface represents a reusable layout or component.

---

# 7. Components and Variants

Reusable components should use variants to represent meaningful differences.

For example:

Product Card
├── Default
├── Hover
├── Loading
├── Out of Stock
├── Low Stock
└── Featured

Another example:

Order Status
├── Confirmed
├── Preparing
├── Out for Delivery
└── Delivered

Variants should represent actual application states rather than arbitrary visual alternatives.

---

# 8. Customer Screens

The Figma design should cover the complete customer journey.

At minimum:

## Authentication

- Login
- Registration
- OTP verification
- Authentication errors

## Product Discovery

- Home
- Product catalog
- Categories
- Search
- Search suggestions
- Search results
- Search by image

## Product

- Product details
- Product gallery
- Specifications
- Availability
- Recommendations

## Shopping

- Cart
- Wishlist
- Checkout
- Payment
- Order confirmation

## Orders

- Order history
- Order details
- Invoice
- Payment receipt
- Delivery tracking

---

# 9. Administrator Screens

The Figma design should also cover administrative workflows.

At minimum:

- Admin Dashboard
- Products
- Categories
- Inventory
- Orders
- Payments
- Delivery
- Users
- Recommendations
- Analytics

Each administrative screen should include the relevant:

- Loading state
- Empty state
- Error state
- Success state
- Confirmation state
- Responsive behavior

---

# 10. Search by Image UI

The search-by-image workflow should be represented in Figma.

The user should be able to:

Search by Image
      ↓
Choose Source
      ├── Upload Image
      └── Camera
      ↓
Image Preview
      ↓
Analyze
      ↓
Matching Products
      ↓
Product Details

The design should include:

- Upload state
- Camera state
- Image preview
- Processing state
- No-results state
- Error state
- Matching-results state

---

# 11. Checkout and Payment UI

The checkout design should clearly represent the complete flow:

Cart
 ↓
Shipping
 ↓
Payment
 ↓
Processing
 ↓
Success
 ↓
Order Confirmation

Figma should include:

- Validation states
- Payment errors
- Loading state
- Success state
- Order number
- Invoice availability
- Payment receipt availability

Stripe Test Mode is used for the actual implementation.

---

# 12. Order and Delivery UI

Order screens should visually communicate order progress.

Example:

Confirmed
   ↓
Preparing
   ↓
Out for Delivery
   ↓
Delivered

The delivery tracking screen should include:

- Current status
- Delivery timeline
- Map
- Delivery location
- Route
- Estimated arrival
- Relevant loading states
- Connection/error states

Real-time updates are implemented through Socket.IO.

---

# 13. Email and PDF Experience

The visual design should also consider application states related to transactional documents and emails.

Relevant UI includes:

- Order confirmation
- Payment confirmation
- Invoice availability
- Payment receipt availability
- PDF download
- Email delivery status where exposed to the user

Brevo handles transactional email delivery.

The backend generates order and payment PDFs.

---

# 14. Responsive Design

Figma should contain responsive designs for the supported viewport categories:

- Mobile
- Tablet
- Desktop
- Large Desktop

Responsive designs should define how:

- Navigation changes
- Grids resize
- Cards adapt
- Tables behave
- Forms stack
- Dialogs resize
- Maps adapt
- Typography scales
- Spacing changes

Responsive behavior should be documented in:

docs/02_Design/RESPONSIVE.md

---

# 15. States

Every important interactive component should have appropriate states.

Typical states include:

- Default
- Hover
- Focus
- Active
- Disabled
- Loading
- Success
- Error
- Empty
- Selected

Not every component requires every state.

States should only be defined when they are meaningful to the component.

---

# 16. Accessibility in Figma

Accessibility should be considered during design rather than added after implementation.

Design reviews should consider:

- Color contrast
- Focus visibility
- Touch target size
- Text readability
- Form labels
- Error communication
- Keyboard interaction
- Reduced motion
- Semantic relationships

Figma designs should not depend solely on color to communicate important information.

---

# 17. Design Tokens

Where appropriate, repeated design values should be represented as reusable tokens.

Examples:

- Color
- Typography
- Spacing
- Radius
- Shadow
- Motion
- Breakpoint

The design tokens should correspond to the implementation tokens used by the SCSS architecture.

The goal is to avoid situations where the Figma design and implementation use unrelated values for the same concept.

---

# 18. Naming Conventions

Figma layers, components, variants, and styles should use clear names.

Prefer:

Button / Primary
Button / Secondary
Input / Default
Input / Error
Product Card / Default
Product Card / Out of Stock

Avoid:

Frame 123
Group 45
Rectangle 19
Component Copy Copy

Names should communicate purpose rather than implementation history.

---

# 19. Prototype Requirements

Figma prototypes should demonstrate important user journeys.

At minimum:

## Customer

Home
 ↓
Search
 ↓
Product
 ↓
Cart
 ↓
Checkout
 ↓
Payment
 ↓
Order
 ↓
Delivery

## Image Search

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

## Administrator

Login
 ↓
Dashboard
 ↓
Products / Orders / Inventory
 ↓
Management
 ↓
Delivery

The prototype should focus on meaningful product behavior rather than attempting to simulate every backend operation.

---

# 20. Design-to-Code Process

Frontend implementation should follow this process:

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

The implementation should not begin with arbitrary styling when an approved design already exists.

---

# 21. Visual Validation

Implemented screens should be compared against the approved Figma designs.

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

# 22. Figma Versioning

Important design milestones should be identifiable.

Examples:

- Foundation Approved
- Customer UI Approved
- Admin UI Approved
- Responsive Approved
- Pre-Development Approved
- Final UI Approved

Major design changes should be communicated before implementation changes are made.

---

# 23. Design Handoff

Before a major feature enters implementation, the relevant Figma design should provide:

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

# 24. Figma and Documentation

Figma-related decisions should remain synchronized with:

- DESIGN_SYSTEM.md
- COMPONENTS.md
- LAYOUTS.md
- COLORS.md
- TYPOGRAPHY.md
- ICONS.md
- MOTION.md
- RESPONSIVE.md
- UI_GUIDELINES.md

When a design-system decision changes, the relevant documentation must be updated.

---

# 25. Figma and Implementation Authority

Figma is the source of truth for intended visual design.

The implementation is the source of truth for actual runtime behavior.

When the two disagree:

1. Identify the difference.
2. Determine whether the design or implementation is outdated.
3. Review the intended behavior.
4. Update the appropriate source.
5. Document significant changes.

Neither Figma nor implementation should silently drift from the other.

---

# 26. Figma Completion Criteria

The Figma design foundation is considered complete when:

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

# 27. Design Principle

> **Design the system, not just the screens.**

Figma should communicate the reusable rules, components, states, and interactions that make the ElectroHub interface consistent across the entire product.