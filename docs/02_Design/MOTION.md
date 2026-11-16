# Motion

## 1. Purpose

This document defines the approved ElectroHub motion system.

Motion exists to communicate:

-   Interaction feedback
-   State changes
-   Navigation continuity
-   Loading
-   Success and error feedback
-   Commerce transitions
-   Delivery updates

Motion is supportive, not decorative.

**Figma is the visual source of truth for intended motion.** This
document records the approved motion principles and implementation
contract.

------------------------------------------------------------------------

# 2. Motion Philosophy

ElectroHub follows five principles:

### Purposeful

Every animation must communicate or improve something.

### Fast

Interaction feedback should feel immediate.

### Subtle

Motion should not compete with product content.

### Consistent

Similar interactions should behave similarly.

### Accessible

Users who prefer reduced motion must receive an equivalent non-motion
experience.

------------------------------------------------------------------------

# 3. Motion Source of Truth

``` text
Figma Interaction / Prototype
          ↓
Motion Pattern
          ↓
Motion Token
          ↓
React / CSS Implementation
```

Figma defines intended behavior.

Implementation must not invent contradictory motion.

------------------------------------------------------------------------

# 4. Motion Technology

The approved application-level motion library is:

``` text
Framer Motion
```

Simple transitions may use CSS/SCSS when that is technically simpler and
sufficient.

Do not add another animation library for isolated effects.

------------------------------------------------------------------------

# 5. Motion Categories

The system covers:

``` text
Micro-interactions
Navigation
Overlays
Feedback
Loading
Commerce
Checkout
Orders
Delivery
Admin
Responsive
```

------------------------------------------------------------------------

# 6. Timing Philosophy

Motion uses a small timing hierarchy rather than arbitrary values.

Conceptual levels:

``` text
Instant
Fast
Normal
Slow
```

### Instant

Tiny state changes.

### Fast

Buttons, hover states, small controls.

### Normal

Dropdowns, dialogs, drawers, content transitions.

### Slow

Large or prominent transitions only when justified.

The exact numerical timing should be centralized rather than scattered
through components.

------------------------------------------------------------------------

# 7. Easing

Approved semantic easing roles:

``` text
Standard
Ease In
Ease Out
Ease In Out
Spring
```

Use the simplest curve that communicates the interaction.

Do not introduce custom cubic-bezier values for individual components
without design review.

------------------------------------------------------------------------

# 8. Hover

Hover feedback may use:

-   Color transition
-   Border transition
-   Small elevation change
-   Opacity
-   Very small transform

Hover must not cause layout shift.

The final Figma UI should remain understandable even without animation.

------------------------------------------------------------------------

# 9. Pressed State

Pressed interactions may use subtle visual compression or state
transition.

Avoid exaggerated movement.

The pressed state should be distinguishable from hover.

------------------------------------------------------------------------

# 10. Focus

Focus visibility is not dependent on animation.

The established focus treatment remains:

``` text
2px primary outline
2px offset
```

If motion is disabled, the focus indicator remains fully visible.

------------------------------------------------------------------------

# 11. Button Motion

Buttons may animate:

``` text
Hover
Pressed
Loading
Success
```

The animation should be short and restrained.

Do not make every button bounce or scale dramatically.

------------------------------------------------------------------------

# 12. Product Card Motion

Product cards may receive subtle hover feedback.

Example:

``` text
Default
   ↓
Hover
Visual emphasis
```

Avoid transforms that cause cards to overlap or change the surrounding
grid.

------------------------------------------------------------------------

# 13. Dropdown Motion

Dropdowns may use:

``` text
Fade
+
Small translate / scale
```

The animation must not delay keyboard access.

------------------------------------------------------------------------

# 14. Modal / Dialog Motion

Modal and dialog transitions may use:

``` text
Overlay fade
+
Dialog fade/scale/translate
```

Requirements:

-   Focus remains correctly managed.
-   Escape behavior remains correct.
-   Background interaction remains blocked where required.
-   Closing must not trap focus.

------------------------------------------------------------------------

# 15. Drawer Motion

Drawers, especially mobile navigation, may use:

``` text
Slide In
Slide Out
```

with a synchronized overlay fade.

The animation should not make navigation feel slow.

------------------------------------------------------------------------

# 16. Sidebar Motion

Admin sidebar collapse/expand may animate width or content visibility.

Requirements:

-   Header is never covered.
-   Main content resizes.
-   Sticky behavior remains correct.
-   Collapsed navigation remains usable.
-   Motion does not cause horizontal overflow.

------------------------------------------------------------------------

# 17. Mobile Navigation

Mobile navigation may animate its entrance and exit.

The final interaction must remain usable with:

-   Touch
-   Keyboard where applicable
-   Reduced motion
-   Screen readers

------------------------------------------------------------------------

# 18. Page Transitions

Page transitions should be used sparingly.

They must not:

-   Delay route changes unnecessarily.
-   Create disorientation.
-   Cause layout jumps.
-   Hide the destination content for too long.

Basic application navigation should feel immediate.

------------------------------------------------------------------------

# 19. Loading

Approved loading patterns include:

``` text
Skeleton
Spinner
Progress / Processing state
```

Prefer skeletons when the final content structure is known.

Use a spinner when the operation itself is the main thing being waited
on.

------------------------------------------------------------------------

# 20. Skeleton

Skeleton animation may use a subtle shimmer.

Requirements:

-   Low visual distraction
-   Stable dimensions
-   No excessive flashing
-   Reduced-motion alternative

With reduced motion enabled, shimmer should be replaced with a static
representation where appropriate.

------------------------------------------------------------------------

# 21. Success

Success may use subtle motion for:

``` text
Added to Cart
Wishlist Updated
Payment Successful
Order Created
```

Possible patterns:

``` text
Fade
Scale
Checkmark reveal
```

Motion must not delay the user's next action.

------------------------------------------------------------------------

# 22. Error

Errors may use:

``` text
Fade
Slide
Subtle emphasis
```

Avoid aggressive shaking.

Errors must remain understandable without animation.

------------------------------------------------------------------------

# 23. Toast

Toast lifecycle:

``` text
Enter
 ↓
Visible
 ↓
Exit
```

The animation should reinforce appearance and disappearance.

The message itself remains accessible independently of motion.

------------------------------------------------------------------------

# 24. Search

Search interactions may transition:

``` text
Input
 ↓
Suggestions
 ↓
Loading
 ↓
Results
```

Animation must not interfere with typing, keyboard navigation, or result
access.

------------------------------------------------------------------------

# 25. Image Search

Image-search interaction may show:

``` text
Select Image
      ↓
Preview
      ↓
Processing
      ↓
Results
```

The interface must represent real processing state.

Do not simulate fake AI progress.

------------------------------------------------------------------------

# 26. Cart

Cart interactions may use subtle transitions for:

-   Add item
-   Remove item
-   Quantity change
-   Cart count update

The updated state must remain immediately understandable.

------------------------------------------------------------------------

# 27. Wishlist

Wishlist interactions may animate:

``` text
Not Saved
   ↕
Saved
```

The heart state should communicate the actual current state.

------------------------------------------------------------------------

# 28. Checkout and Payment

Checkout may use transitions for:

``` text
Validation
Processing
Success
Failure
Order confirmation
```

Payment UI must never animate into a success state before the backend
confirms payment.

------------------------------------------------------------------------

# 29. Orders

Order status changes may transition through the established order
lifecycle.

Example:

``` text
Pending
   ↓
Processing
   ↓
Shipped
   ↓
Delivered
```

Motion should represent actual state changes.

------------------------------------------------------------------------

# 30. Delivery Tracking

Delivery tracking can use motion for:

-   Timeline progression
-   Map updates
-   Status changes
-   Location updates
-   Estimated arrival changes

Real-time movement must be based on actual received data.

Do not simulate movement that has not occurred.

------------------------------------------------------------------------

# 31. Admin Motion

Admin interfaces prioritize efficiency.

Use motion mainly for:

-   Dialogs
-   Drawers
-   Loading
-   Feedback
-   Navigation state
-   Status changes

Avoid unnecessary animations in dense tables and operational workflows.

------------------------------------------------------------------------

# 32. List Motion

Lists may animate:

-   Item insertion
-   Removal
-   Filtering
-   Reordering
-   Loading

When many records change at once, motion should be restrained to avoid
visual confusion.

------------------------------------------------------------------------

# 33. Layout Stability

Animations must not introduce unexpected layout shifts.

Prefer properties such as:

``` text
transform
opacity
```

for visual transitions where appropriate.

Avoid animations that:

-   Push surrounding content unexpectedly
-   Create horizontal overflow
-   Move focused controls
-   Cause unstable grid layouts

------------------------------------------------------------------------

# 34. Performance

Motion must remain performant across:

``` text
Desktop
Tablet
Mobile
```

Avoid:

-   Continuous expensive animations
-   Large repaint-heavy effects
-   Excessive simultaneous transitions

Lower-powered devices must remain usable.

------------------------------------------------------------------------

# 35. Reduced Motion

The application must respect:

``` text
prefers-reduced-motion
```

When enabled:

-   Remove decorative movement.
-   Reduce or eliminate transitions.
-   Disable shimmer where appropriate.
-   Preserve focus.
-   Preserve status feedback.
-   Preserve functional state changes.

Reduced motion changes presentation, not functionality.

------------------------------------------------------------------------

# 36. Motion Tokens

Motion should be centralized conceptually:

``` text
--motion-duration-fast
--motion-duration-normal
--motion-duration-slow

--motion-ease-standard
--motion-ease-in
--motion-ease-out
--motion-ease-in-out
```

Do not scatter raw animation durations throughout the application.

------------------------------------------------------------------------

# 37. Implementation Boundary

Use:

``` text
CSS / SCSS
```

for simple style transitions.

Use:

``` text
Framer Motion
```

for meaningful component/application transitions.

The technology should follow complexity rather than forcing every
transition through one system.

------------------------------------------------------------------------

# 38. Motion Naming

Use semantic names:

``` text
fadeIn
fadeOut
slideIn
slideOut
scaleIn
scaleOut
```

Avoid:

``` text
animation1
effect2
newTransition
```

------------------------------------------------------------------------

# 39. Motion and Accessibility

Motion must never be required to understand:

-   Errors
-   Success
-   Order state
-   Payment result
-   Availability
-   Navigation
-   Loading state

Equivalent information must remain available without animation.

------------------------------------------------------------------------

# 40. Review Rules

Before introducing motion:

1.  Identify the user benefit.
2.  Check the Figma reference.
3.  Reuse an existing motion pattern.
4.  Confirm it does not destabilize layout.
5.  Confirm reduced-motion behavior.
6.  Confirm mobile performance.
7.  Confirm it does not delay critical actions.
8.  Confirm real-time motion represents real data.

------------------------------------------------------------------------

# 41. Verified vs Derived

### Established

-   Motion is purposeful, subtle, consistent, and accessible.
-   Framer Motion is the approved application-level motion library.
-   CSS/SCSS is appropriate for simple transitions.
-   Reduced-motion behavior is required.
-   Motion must not compromise layout stability.
-   Real-time delivery motion must represent actual data.

### Derived

-   Exact duration values.
-   Exact easing curves.
-   Specific transition distances/scales.
-   Component-specific animation parameters.

These values should be finalized from Figma when explicitly specified
rather than invented as design truth.

------------------------------------------------------------------------

# 42. Completion Criteria

The motion system is complete when:

-   Motion principles are defined.
-   Timing hierarchy is defined.
-   Easing roles are defined.
-   Component patterns are defined.
-   Overlay behavior is defined.
-   Loading behavior is defined.
-   Commerce behavior is defined.
-   Delivery behavior is defined.
-   Admin behavior is defined.
-   Reduced-motion behavior is defined.
-   Performance requirements are defined.
-   Figma and implementation remain aligned.

------------------------------------------------------------------------

# 43. Motion Principle

> **Motion explains change, confirms interaction, and preserves
> continuity without slowing the user down.**
# 44. Repository Figma Asset Structure

Motion documentation remains part of `docs/02_Design/`. Figma visual-reference and handoff assets use the single approved repository structure below:

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

## 44.1 Responsibilities

- `assets/figma/FIGMA.md` — primary repository-side Figma governance and handoff documentation.
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules for translating Figma interactions into the application.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and handoff references.
- `assets/figma/exports/Components/` — component interaction and motion reference exports/screenshots.
- `assets/figma/exports/admin/` — administrator flow and interaction reference exports/screenshots.
- `assets/figma/exports/customer/` — customer flow and interaction reference exports/screenshots.

Do not recreate legacy Figma export categories such as `Layouts/`, `Foundation/`, `screens/`, or `responsive/`.

## 44.2 Screenshot Policy

Figma Design is authoritative for intended motion and interaction behavior. Figma Make screenshots are supporting visual references; screenshots alone do not establish exact animation timing or easing unless explicitly evidenced by the design.

Preserve default Figma Make-generated filenames. Do not manually rename screenshots into custom component/screen naming patterns.

Responsive motion evidence belongs inside the approved `Components`, `admin`, and `customer` packages rather than a separate responsive export directory.

