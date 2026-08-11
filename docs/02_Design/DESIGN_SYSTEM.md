# Design System

## 1. Purpose

This document defines the visual and interaction system used throughout ElectroHub.

The design system provides a shared foundation for:

- Colors
- Typography
- Spacing
- Layout
- Components
- Icons
- Motion
- States
- Responsive behavior
- Accessibility

The goal is to ensure that the customer application and administrator application feel like parts of the same product.

---

# 2. Design System Principles

The ElectroHub design system follows these principles:

### Consistency

The same visual and interaction patterns should be reused throughout the application.

### Clarity

Interfaces should communicate purpose and state clearly.

### Accessibility

Components should be usable through different interaction methods and should provide appropriate focus, contrast, and semantic behavior.

### Responsiveness

Components should adapt gracefully across supported viewport sizes.

### Reusability

Repeated patterns should be implemented as reusable components.

### Custom Identity

The interface should have a distinctive ElectroHub visual identity rather than resembling a generic UI framework.

---

# 3. Design Source of Truth

Figma is the primary source of truth for the intended visual design.

The implementation stack is:

Figma
   ↓
Design Tokens
   ↓
SCSS
   ↓
CSS Modules
   ↓
React Components

Radix UI may provide interaction and accessibility primitives, but it does not define the application's visual appearance.

---

# 4. Design System Foundations

The design system is built from the following foundations:

- Colors
- Typography
- Spacing
- Grid
- Borders
- Radius
- Shadows
- Icons
- Motion
- Breakpoints
- Components
- States

Each foundation should be defined consistently in Figma and reflected in the implementation.

---

# 5. Colors

The color system should define semantic roles rather than encouraging arbitrary color usage.

Examples of semantic roles:

- Primary
- Primary Hover
- Primary Active
- Secondary
- Background
- Surface
- Surface Elevated
- Text Primary
- Text Secondary
- Text Muted
- Border
- Success
- Warning
- Error
- Info

Colors should be documented in:

docs/02_Design/COLORS.md

Components should consume semantic colors rather than hard-coded values whenever practical.

---

# 6. Typography

Typography should define:

- Font family
- Font sizes
- Font weights
- Line heights
- Letter spacing
- Heading hierarchy
- Body text
- Labels
- Captions

Example hierarchy:

- Display
- Heading 1
- Heading 2
- Heading 3
- Heading 4
- Body Large
- Body
- Body Small
- Caption
- Label

Typography decisions are documented in:

docs/02_Design/TYPOGRAPHY.md

---

# 7. Spacing

Spacing should use a consistent scale.

Spacing controls:

- Component padding
- Component gaps
- Section spacing
- Grid gaps
- Form spacing
- Page spacing

Example conceptual scale:

- XS
- SM
- MD
- LG
- XL
- 2XL
- 3XL

The actual values should be defined by the approved Figma design tokens.

---

# 8. Layout

The design system should provide consistent layout rules for:

- Page containers
- Sections
- Columns
- Grids
- Flex layouts
- Content widths
- Alignment
- Vertical rhythm

Layouts should avoid arbitrary positioning when a reusable layout pattern can be used.

---

# 9. Border Radius

Radius tokens should provide consistent corner treatment.

Examples:

- None
- Small
- Medium
- Large
- XL
- Pill

Radius should be used consistently across:

- Cards
- Buttons
- Inputs
- Dialogs
- Images
- Badges
- Containers

---

# 10. Shadows

Shadows should communicate elevation rather than decorate every component.

Typical levels:

- None
- Small
- Medium
- Large
- Elevated

Shadows should remain subtle and consistent with the overall visual direction.

---

# 11. Icons

Icons use Lucide React in the implementation.

Icons should:

- Have consistent visual weight.
- Use appropriate sizes.
- Align with surrounding text.
- Have accessible labels when necessary.
- Avoid communicating critical information through icons alone.

The icon system is documented in:

docs/02_Design/ICONS.md

---

# 12. Motion

Motion should provide useful feedback rather than unnecessary decoration.

Motion may be used for:

- Page transitions
- Hover interactions
- Dialogs
- Dropdowns
- Loading transitions
- Success feedback
- Error feedback
- Delivery updates

Framer Motion is the approved animation library.

Reduced-motion preferences must be respected.

Motion standards are documented in:

docs/02_Design/MOTION.md

---

# 13. Component Architecture

The design system is implemented through reusable React components.

Conceptually:

Design Tokens
     ↓
Primitives
     ↓
Components
     ↓
Feature Components
     ↓
Pages

Examples:

Button
   ↓
Product Card
   ↓
Product Grid
   ↓
Product Listing Page

---

# 14. Component States

Components should define meaningful interaction states.

Common states include:

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

States should reflect actual application behavior.

---

# 15. Buttons

Buttons should have clearly defined:

- Variants
- Sizes
- States
- Icons
- Loading behavior
- Disabled behavior

Example:

- Primary
- Secondary
- Ghost
- Danger

Button hierarchy should reflect action importance.

---

# 16. Inputs

Inputs should provide consistent:

- Label
- Placeholder
- Value
- Focus
- Error
- Disabled
- Helper text

Search inputs should additionally support:

- Suggestions
- Loading
- No results
- Clear action
- Keyboard interaction

---

# 17. Cards

Cards should provide consistent structure and spacing.

Product cards may include:

- Image
- Brand
- Product Name
- Rating
- Price
- Availability
- Actions

Cards should support meaningful states such as:

- Default
- Hover
- Loading
- Out of Stock
- Low Stock
- Featured

---

# 18. Forms

Forms should use consistent:

- Field spacing
- Labels
- Validation
- Error messages
- Required indicators
- Submit states
- Success feedback

Forms must remain accessible and keyboard-friendly.

---

# 19. Feedback Components

The design system should provide consistent feedback patterns for:

- Success
- Error
- Warning
- Information
- Loading

Examples include:

- Toast
- Alert
- Inline Error
- Dialog
- Skeleton
- Spinner
- Empty State

---

# 20. Loading States

Loading states should communicate what content is being loaded.

Skeletons should approximate the final content structure rather than displaying arbitrary blank blocks.

Examples:

- Product Card Skeleton
- Product Details Skeleton
- Order Skeleton
- Table Skeleton
- Dashboard Skeleton

---

# 21. Empty States

Empty states should explain:

1. What is empty.
2. Why it may be empty when useful.
3. What the user can do next.

Example:

Your wishlist is empty.

Save products here to find them later.

[Explore Products]

Empty states should provide an appropriate action whenever one exists.

---

# 22. Error States

Error states should:

- Explain what happened.
- Avoid exposing technical details unnecessarily.
- Provide a recovery action when possible.

Example:

Something went wrong.

We couldn't load your orders.

[Try Again]

---

# 23. Navigation

Navigation should remain consistent across customer and administrator experiences.

The system should define:

- Header
- Sidebar
- Mobile navigation
- Breadcrumbs where appropriate
- Active states
- Focus states

Navigation behavior should be documented in `LAYOUTS.md`.

---

# 24. Product Experience

Product interfaces should maintain consistent patterns across:

- Product cards
- Product listing
- Product details
- Search
- Categories
- Recommendations

Product information hierarchy should prioritize:

Product
 ↓
Price
 ↓
Availability
 ↓
Key information
 ↓
Primary action

---

# 25. Checkout Experience

Checkout should use a clear visual hierarchy.

The system should consistently represent:

Cart
 ↓
Shipping
 ↓
Payment
 ↓
Confirmation

Important states include:

- Validation
- Payment processing
- Payment failure
- Payment success
- Order creation
- Order confirmation

---

# 26. Order Experience

Order interfaces should clearly communicate:

- Order number
- Date
- Products
- Total
- Payment status
- Order status
- Delivery status
- Invoice
- Payment receipt

Status presentation should remain consistent throughout the application.

---

# 27. Delivery Tracking

Delivery tracking should combine:

Status
+
Timeline
+
Map
+
Location
+
Estimated Arrival

The visual hierarchy should allow the user to understand delivery progress quickly.

---

# 28. Search by Image

The search-by-image experience should follow a consistent flow:

Choose Image
    ↓
Preview
    ↓
Analyze
    ↓
Results

The design system should define states for:

- Upload
- Camera
- Preview
- Processing
- Results
- No results
- Error

---

# 29. Recommendations

Recommendation sections should have consistent:

- Section headers
- Product-card patterns
- Loading states
- Empty states
- Error handling

Examples:

- Recommended for You
- You May Also Like
- Similar Products
- Frequently Bought Together

---

# 30. Admin Design System

The administrator interface should reuse the same design foundations.

Admin-specific patterns include:

- Data tables
- Filters
- Pagination
- Bulk actions
- Status badges
- Confirmation dialogs
- Analytics cards
- Dashboard widgets
- Forms

The admin interface should feel like the same product while being optimized for operational workflows.

---

# 31. Responsive Behavior

Components must support:

- Mobile
- Tablet
- Desktop
- Large Desktop

Responsive behavior should be defined at the component and page levels.

Avoid designing desktop-only components that cannot adapt to smaller screens.

---

# 32. Accessibility

The design system must consider:

- Keyboard navigation
- Focus visibility
- Color contrast
- Semantic structure
- Screen-reader compatibility
- Form labels
- Error messages
- Touch target size
- Reduced motion

Accessibility is a design requirement, not a final-stage enhancement.

---

# 33. Design Tokens and Implementation

Design tokens should be shared conceptually between Figma and the implementation.

Examples:

--color-primary
--color-surface
--color-text-primary
--spacing-md
--radius-md
--shadow-sm

The exact implementation naming convention should follow the SCSS standards.

---

# 34. UI Library Boundary

Radix UI is used for behavior and accessibility primitives.

It does not replace the ElectroHub design system.

The intended architecture is:

Radix UI
   ↓
Behavior

ElectroHub Design System
   ↓
Visual Identity

SCSS / CSS Modules
   ↓
Implementation

---

# 35. Component Documentation

Each important reusable component should document:

- Purpose
- Variants
- Props
- States
- Accessibility behavior
- Responsive behavior
- Usage restrictions

Component documentation belongs in:

docs/02_Design/COMPONENTS.md

---

# 36. Design Review

Before a major UI feature is implemented, verify:

- Figma design exists.
- Design tokens are defined.
- Components are reusable.
- States are defined.
- Responsive behavior is defined.
- Accessibility is considered.
- Empty and error states are designed.

---

# 37. Design System Completion Criteria

The design system is considered complete when:

- Foundations are defined.
- Design tokens are established.
- Typography is defined.
- Colors are defined.
- Spacing is defined.
- Components are documented.
- Component states are defined.
- Responsive behavior is defined.
- Motion rules are defined.
- Accessibility requirements are incorporated.
- Figma and implementation terminology are aligned.

---

# 38. Design System Principle

> **Build reusable visual rules and components rather than styling every screen independently.**

The ElectroHub design system should make the interface consistent, scalable, accessible, and visually distinctive across the entire product.