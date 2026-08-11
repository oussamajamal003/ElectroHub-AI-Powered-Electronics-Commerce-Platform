# Accessibility

## 1. Purpose

This document defines accessibility requirements for ElectroHub.

The goal is to ensure that the application can be used by people with different abilities and interaction methods.

Accessibility applies to:

```text
Customer Store
Checkout
Orders
Delivery Tracking
Admin Dashboard
Forms
Dialogs
Tables
Maps
```

## 2. Accessibility Target

The application should target modern WCAG accessibility practices, with WCAG 2.1 AA used as the baseline reference unless a later project decision specifies otherwise.

## 3. Keyboard Navigation

All interactive functionality must be usable with a keyboard where applicable.

Verify:

```text
Tab
Shift + Tab
Enter
Space
Escape
Arrow Keys
```

## 4. Focus Management

Interactive elements must have clear focus states.

Dialogs and overlays must manage focus correctly:

```text
Open Dialog
 ↓
Move Focus Into Dialog
 ↓
User Interaction
 ↓
Close Dialog
 ↓
Restore Focus
```

## 5. Semantic HTML

Prefer semantic elements such as:

```text
header
nav
main
section
article
button
form
label
table
footer
```

## 6. Forms

Forms must provide programmatic labels, clear validation messages, error association, keyboard accessibility, useful input types, and clear required-field indicators.

Important forms include:

```text
Login
Registration
OTP
Search
Checkout
Shipping
Admin Product
Admin Order
```

## 7. Error Messages

Errors must be understandable and associated with the relevant control.

Do not rely only on color, icons, or position.

## 8. Images

Product images require meaningful alternative text where the image conveys information.

Decorative images should use appropriate decorative semantics.

Image-search upload controls must provide accessible labels and instructions.

## 9. Color and Contrast

Do not use color as the only method of communicating state.

Examples:

```text
Payment Status
Order Status
Inventory Status
Delivery Status
Errors
Success
```

Status should combine color with text, iconography, or another accessible indicator.

## 10. Typography

Typography must remain readable across supported viewport sizes.

Avoid excessively small text, insufficient line spacing, and text embedded into images when avoidable.

## 11. Motion

Animations must not prevent users from completing tasks.

Respect reduced-motion preferences where appropriate:

```text
prefers-reduced-motion
```

## 12. Responsive Accessibility

Accessibility must remain functional on:

```text
Mobile
Tablet
Desktop
```

Touch targets must be practical for mobile interaction.

## 13. Tables

Admin tables must support:

```text
Keyboard Navigation
Clear Headers
Readable Row/Column Relationships
Pagination Controls
Sorting Controls
Filtering Controls
```

TanStack Table behavior must remain accessible in the final UI.

## 14. Dialogs and Menus

Radix UI behavior should be configured with accessible labels, focus handling, keyboard interaction, and appropriate semantics.

Custom wrappers must not remove built-in accessibility behavior.

## 15. Maps

Leaflet maps require an accessible alternative for important information.

For delivery tracking, critical information should also be available as text:

```text
Delivery Status
Current / Latest Location
Estimated Arrival
```

## 16. Authentication Accessibility

Verify:

```text
Login
Registration
OTP
Password Errors
Session Errors
```

OTP inputs must support keyboard navigation and clear instructions.

## 17. Checkout Accessibility

The complete checkout must support:

```text
Cart Review
Shipping Form
Payment Flow
Validation
Confirmation
```

## 18. Screen Reader Testing

Critical workflows should be tested with screen-reader technology where practical.

Priority:

```text
Authentication
Product Search
Cart
Checkout
Orders
Delivery
Admin
```

## 19. Automated Accessibility Testing

Automated accessibility tools may detect common issues. Automated testing does not replace manual accessibility verification.

## 20. Accessibility QA

QA should verify:

```text
Keyboard Navigation
Focus
Labels
Contrast
Semantic Structure
Alternative Text
Dialogs
Forms
Tables
Maps
Reduced Motion
```

## 21. Definition of Done

Accessibility is complete when:

- Critical workflows are keyboard accessible.
- Focus behavior is correct.
- Forms have accessible labels and errors.
- Important images have appropriate alternatives.
- Status is not communicated by color alone.
- Dialogs and menus are accessible.
- Maps provide textual alternatives.
- Responsive accessibility is verified.
- Automated accessibility checks pass where configured.
- Manual accessibility verification is completed for critical workflows.

## 22. Accessibility Principle

> **Accessibility is a functional requirement, not a visual enhancement. Critical workflows must remain usable through different interaction methods and assistive technologies.**
