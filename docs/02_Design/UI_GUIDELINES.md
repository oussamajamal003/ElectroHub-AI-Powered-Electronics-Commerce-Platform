# UI Guidelines

## 1. Purpose

This document defines the practical UI rules for ElectroHub.

It connects the design system with implementation and provides a consistent standard for:

- Visual hierarchy
- Layout
- Components
- Spacing
- Colors
- Typography
- Icons
- Forms
- Feedback
- Accessibility
- Responsive behavior
- Customer interfaces
- Administrator interfaces

Figma is the source of truth for approved visual design, while these guidelines define how that design should be consistently implemented.

---

# 2. Core UI Principles

ElectroHub follows these principles:

### Clarity

Users should immediately understand what they can do and what is happening.

### Consistency

Equivalent actions and states should look and behave consistently.

### Simplicity

Avoid unnecessary visual complexity.

### Accessibility

Accessibility is part of the UI rather than a separate final step.

### Responsiveness

Interfaces must work across supported viewport sizes.

### Feedback

Every important user action should provide appropriate feedback.

### Performance

Visual polish must not come at the cost of application performance.

---

# 3. Source of Truth

The UI hierarchy is:

```text
Figma
  ↓
Design System
  ↓
UI Guidelines
  ↓
Reusable Components
  ↓
Feature Implementation
```

If implementation differs from approved design, the difference should be intentional and documented.

---

# 4. Visual Hierarchy

Every screen should establish a clear hierarchy.

A typical hierarchy is:

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

---

# 5. Spacing

Spacing should use the approved design token scale.

Avoid arbitrary spacing values when an existing token provides the required result.

Spacing should be consistent between:

- Sections
- Cards
- Form fields
- Buttons
- Navigation items
- Page elements

---

# 6. Containers

Pages should use consistent content containers.

Containers should control:

- Maximum width
- Horizontal padding
- Alignment
- Responsive behavior

Do not allow individual pages to invent unrelated container widths.

---

# 7. Alignment

Related elements should share common alignment lines.

Common alignment patterns include:

```text
Page Header
     │
     ├── Title
     ├── Description
     └── Actions

Content
     │
     └── Aligned to same container
```

Misaligned content should require a deliberate design reason.

---

# 8. Typography

Use semantic typography roles:

```text
Display
Heading
Body
Label
Caption
```

Typography should follow `TYPOGRAPHY.md`.

Do not introduce arbitrary font sizes or weights in individual components.

---

# 9. Colors

Use semantic color tokens defined by `COLORS.md`.

Examples:

```text
Primary
Surface
Text Primary
Text Secondary
Border
Success
Warning
Error
```

Avoid arbitrary raw colors inside components.

---

# 10. Buttons

Buttons should have clear hierarchy.

Recommended types:

```text
Primary
Secondary
Ghost
Danger
```

Use:

- Primary for the main action.
- Secondary for supporting actions.
- Ghost for low-emphasis actions.
- Danger for destructive actions.

Avoid multiple competing primary actions in the same visual region.

---

# 11. Button States

Buttons should support relevant states:

```text
Default
Hover
Focus
Active
Disabled
Loading
Success
```

The state must be understandable without relying only on color.

---

# 12. Forms

Forms should provide:

```text
Label
Input
Helper Text
Error Text
```

Required fields should be clearly indicated.

Validation should occur at appropriate interaction points and should provide actionable error messages.

---

# 13. Form Errors

Error messages should:

- Identify the affected field.
- Explain what is wrong.
- Explain how to correct it where possible.
- Be associated with the input.
- Remain visible long enough to be understood.

Avoid generic messages such as:

```text
Invalid input
Something went wrong
```

when more useful information is available.

---

# 14. Search

Search is a primary commerce interaction.

Search should support:

- Clear input
- Suggestions
- Loading
- Empty results
- Error handling
- Keyboard interaction
- Mobile usability

Search suggestions should be visually and semantically associated with the search input.

---

# 15. Product Cards

Product cards should consistently communicate:

```text
Image
Product Name
Price
Availability
Primary Action
Wishlist
```

Optional information:

```text
Brand
Rating
Discount
Badge
```

Do not overload cards with low-priority information.

---

# 16. Product Details

Product detail pages should prioritize:

1. Product identity.
2. Product image.
3. Price.
4. Availability.
5. Purchase action.
6. Key specifications.
7. Supporting information.
8. Recommendations.

The primary purchase action should remain easy to locate.

---

# 17. Cart

The cart should clearly show:

- Product
- Quantity
- Price
- Item total
- Availability
- Remove action
- Cart subtotal
- Checkout action

Users should always understand what they are about to purchase.

---

# 18. Checkout

Checkout should minimize distractions.

Recommended structure:

```text
Shipping
   ↓
Payment
   ↓
Order Summary
   ↓
Confirmation
```

The payment state must always be explicit.

Do not show payment success until the backend confirms the transaction.

---

# 19. Payments

Stripe is used in Test Mode.

The UI should clearly communicate:

```text
Processing
Successful
Failed
Cancelled
```

Payment errors should provide recovery guidance where possible.

The UI must never expose sensitive payment information.

---

# 20. Orders

Order interfaces should prioritize:

```text
Order Number
Status
Total
Payment Status
Delivery Status
```

Customers should be able to access:

- Order details
- Purchased products
- Payment information
- Delivery progress
- Invoice
- Payment receipt where available

---

# 21. Email and PDF Documents

The commerce UI should clearly communicate document availability.

Supported documents include:

```text
Order Invoice PDF
Payment Receipt PDF
```

Transactional emails may include:

```text
OTP
Order Confirmation
Payment Confirmation
```

Email and PDF generation are backend responsibilities and should not be simulated as successful before the underlying operation completes.

---

# 22. Delivery Tracking

Delivery tracking should combine:

```text
Status
Timeline
Map
Estimated Arrival
```

The current status should be visually prominent.

Real-time changes received through Socket.IO should update the interface without requiring unnecessary manual refreshes.

---

# 23. Search by Image

The image-search experience should make the workflow clear:

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

Each state should provide clear feedback.

Permission failures and invalid images should have actionable recovery paths.

---

# 24. Recommendations

Recommendation sections should clearly indicate why products are being shown when useful.

Examples:

```text
Recommended for You
You May Also Like
Similar Products
Frequently Bought Together
```

Recommendations should not visually overpower the primary product or task.

---

# 25. Inventory

Inventory states include:

```text
In Stock
Low Stock
Out of Stock
```

Availability should be communicated using:

```text
Text
+
Visual indicator
```

Do not rely only on red, yellow, or green.

Out-of-stock products should prevent invalid purchase actions.

---

# 26. Statuses

Statuses should have:

- Consistent wording
- Consistent color semantics
- Consistent icons where appropriate
- Accessible text

Examples:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Do not create different labels for the same state in different screens.

---

# 27. Feedback

Use the appropriate feedback mechanism.

```text
Toast
Short temporary feedback

Inline Error
Field-specific problem

Alert
Important persistent information

Dialog
Confirmation / focused decision

Empty State
No content exists

Error State
Content could not be loaded

Skeleton
Content is loading
```

---

# 28. Empty States

Empty states should explain:

1. What is empty.
2. Why it may be empty when useful.
3. What the user can do next.

Example:

```text
Your wishlist is empty.

Save products here to find them later.

[Browse Products]
```

---

# 29. Loading States

Use skeletons when the final layout is known.

Use spinners or progress indicators for:

- Short actions
- Buttons
- Processing operations

Avoid replacing the entire application with a spinner when only one section is loading.

---

# 30. Error States

Error states should provide:

```text
What happened
     ↓
What the user can do
     ↓
Retry / Recovery
```

Do not expose raw stack traces or internal implementation details to users.

---

# 31. Dialogs

Dialogs should be reserved for:

- Confirmation
- Important decisions
- Focused workflows
- Destructive actions

Dialogs should not be used for every piece of information.

---

# 32. Destructive Actions

Destructive actions include:

```text
Delete Product
Remove Item
Cancel Order
Delete Account
```

Use appropriate confirmation when the action is irreversible or high impact.

The destructive action should be visually distinguishable.

---

# 33. Icons

Use Lucide React consistently.

Icons should:

- Reinforce meaning.
- Follow the approved size system.
- Have accessible names when interactive.
- Be decorative when appropriate.
- Avoid replacing necessary text.

Follow `ICONS.md`.

---

# 34. Motion

Use motion to:

- Explain state changes.
- Provide feedback.
- Improve continuity.

Do not use motion merely for decoration.

Respect `prefers-reduced-motion`.

Follow `MOTION.md`.

---

# 35. Responsive Behavior

Every major interface must work across:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Responsive behavior should adapt structure, not simply scale the desktop layout.

Follow `RESPONSIVE.md`.

---

# 36. Accessibility

UI implementation must consider:

- Semantic HTML
- Keyboard navigation
- Focus visibility
- Labels
- Accessible names
- Contrast
- Touch targets
- Screen readers
- Reduced motion
- Zoom and text resizing

Accessibility must be considered during component implementation.

---

# 37. Touch Interaction

Interactive controls should have adequate touch targets.

Pay particular attention to:

- Icon buttons
- Menu controls
- Quantity controls
- Product actions
- Map controls
- Form controls

Avoid tightly packed controls on mobile.

---

# 38. Admin UI

The administrator interface should prioritize:

- Information density
- Clarity
- Fast workflows
- Consistent tables
- Clear status indicators
- Safe destructive actions

Admin UI should use the same design system as the customer interface while allowing different layout patterns where operational needs require them.

---

# 39. Data Tables

Tables should support:

- Sorting
- Filtering
- Pagination
- Selection where needed
- Loading
- Empty state
- Error state

Use TanStack Table for complex administrative data tables.

---

# 40. UI Consistency Rules

Equivalent functionality should look equivalent.

For example:

```text
Edit
→ Same icon and interaction pattern

Delete
→ Same destructive treatment

Loading
→ Same loading language

Success
→ Same success treatment
```

Do not create multiple visual patterns for the same interaction without a clear reason.

---

# 41. Content Guidelines

UI text should be:

- Clear
- Concise
- Action-oriented
- Consistent
- Human-readable

Prefer:

```text
Remove from wishlist
```

over:

```text
Delete
```

when the action specifically removes a wishlist item.

---

# 42. Localization

UI should support localized content where required.

Layouts must tolerate:

- Longer translations
- Different word order
- Different scripts
- RTL languages where supported

Do not hard-code widths based on English text.

---

# 43. Security in UI

The UI must never be treated as the security boundary.

Sensitive operations must be validated by the backend.

Do not rely on:

```text
Hidden buttons
Frontend role checks
Disabled controls
```

as the only authorization mechanism.

---

# 44. Performance

UI implementation should avoid:

- Unnecessary re-renders
- Excessive animation
- Oversized images
- Blocking assets
- Large unnecessary dependencies

Use:

- Lazy loading
- Code splitting
- Responsive images
- Efficient queries
- Appropriate caching

---

# 45. Figma Handoff

Figma should communicate:

- Layout
- Colors
- Typography
- Components
- States
- Responsive behavior
- Motion
- Interaction behavior

Implementation should not require guessing basic design decisions.

---

# 46. Review Checklist

Before considering a UI feature complete, verify:

```text
[ ] Figma design approved
[ ] Layout matches design
[ ] Typography matches tokens
[ ] Colors use semantic tokens
[ ] Components are reusable
[ ] States are implemented
[ ] Loading state exists where needed
[ ] Empty state exists where needed
[ ] Error state exists where needed
[ ] Responsive behavior verified
[ ] Keyboard accessibility verified
[ ] Focus states verified
[ ] Touch targets verified
[ ] Motion respects reduced motion
[ ] No unintended overflow
[ ] No unnecessary visual complexity
```

---

# 47. UI Completion Criteria

A UI feature is considered complete when:

- It follows the design system.
- It follows the approved Figma design.
- Components are reusable.
- Responsive behavior is defined.
- Accessibility is addressed.
- Loading, empty, and error states are handled.
- Interactive states are implemented.
- Content is clear and consistent.
- Performance is acceptable.
- No unnecessary visual inconsistencies remain.

---

# 48. UI Principle

> **Build interfaces that are clear, consistent, accessible, responsive, and easy to understand before making them visually impressive.**
