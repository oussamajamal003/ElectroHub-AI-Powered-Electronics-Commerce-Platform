# Motion

## 1. Purpose

This document defines the motion and animation system used throughout ElectroHub.

Motion is used to improve:

- User feedback
- Interaction clarity
- Navigation continuity
- State transitions
- Perceived performance
- Product polish

Motion should support the interface rather than distract from the user's task.

ElectroHub uses **Framer Motion** for application-level motion where appropriate.

---

# 2. Motion Principles

### Purposeful

Every animation should have a clear reason to exist.

### Fast

Most interface interactions should feel immediate.

### Consistent

Similar interactions should use similar motion behavior.

### Subtle

Motion should support hierarchy without becoming visually distracting.

### Accessible

Users who prefer reduced motion must receive an appropriate reduced-motion experience.

### Responsive

Motion should remain appropriate across device classes and interaction methods.

---

# 3. Motion Source of Truth

Figma defines the intended motion behavior.

The implementation relationship is:

```text
Figma Motion Specification
        ↓
Motion Tokens
        ↓
Framer Motion
        ↓
React Components
```

Significant motion behavior should be represented in the design before implementation.

---

# 4. Motion Library

The approved animation library is:

```text
Framer Motion
```

CSS transitions and animations may be used for simple styling transitions where they are more appropriate.

Motion libraries should not be added without an approved architectural reason.

---

# 5. Motion Categories

ElectroHub motion is organized into:

```text
Micro-interactions
State transitions
Navigation
Dialogs
Loading
Feedback
Lists
Commerce
Delivery
Responsive
```

---

# 6. Motion Timing

Motion should use a small, consistent timing scale.

Conceptual durations:

```text
Instant
Fast
Normal
Slow
```

Typical use:

```text
Instant
Very small visual state changes

Fast
Buttons, hover states, small UI feedback

Normal
Dialogs, dropdowns, content transitions

Slow
Page-level or prominent transitions
```

The exact durations should be defined by the approved Figma motion system.

---

# 7. Easing

Motion should use a controlled set of easing curves.

Conceptual roles:

```text
Standard
Ease-in
Ease-out
Ease-in-out
Spring
```

Use the simplest appropriate easing.

Avoid custom easing values for individual components unless the design requires them.

---

# 8. Hover Motion

Hover effects should provide subtle feedback.

Examples:

```text
Product Card
Button
Navigation Item
Icon Button
```

Possible changes:

- Elevation
- Background
- Border
- Opacity
- Small translation
- Icon movement

Hover motion must not cause layout instability.

---

# 9. Focus Motion

Focus transitions should remain subtle.

Focus visibility must never depend on animation.

The focus indicator must remain visible even when motion is disabled.

---

# 10. Button Motion

Buttons may use subtle transitions for:

```text
Hover
Active
Loading
Success
```

Examples:

```text
Hover
Slight visual emphasis

Active
Small press feedback

Loading
Progress indicator

Success
Clear completion feedback
```

Buttons should not use excessive bounce or large movement.

---

# 11. Card Motion

Product cards may use subtle hover motion.

Possible behavior:

```text
Default
   ↓
Hover
Slight elevation / visual emphasis
```

Card motion should not cause neighboring cards to move unexpectedly.

---

# 12. Modal and Dialog Motion

Dialogs should use clear entry and exit transitions.

Conceptually:

```text
Opening
Fade overlay
+
Scale / translate dialog

Closing
Reverse transition
```

Focus management must remain correct regardless of animation.

---

# 13. Drawer and Mobile Navigation Motion

Mobile navigation drawers may use:

```text
Slide In
Slide Out
```

The background overlay may fade simultaneously.

The animation should be fast enough that navigation does not feel delayed.

---

# 14. Dropdown Motion

Dropdowns may use a short:

```text
Fade
+
Small translate / scale
```

The motion should not interfere with keyboard navigation.

---

# 15. Page Transitions

Page transitions should be used sparingly.

If used, they should:

- Preserve orientation.
- Avoid delaying navigation.
- Avoid excessive movement.
- Respect reduced-motion preferences.

The application should never make basic navigation feel slower because of animation.

---

# 16. Loading Motion

Loading feedback may use:

```text
Skeleton Shimmer
Spinner
Progress Indicator
```

Skeletons should generally be preferred when the structure of the final content is known.

Loading animations should avoid excessive flashing.

---

# 17. Skeleton Motion

Skeleton animation should communicate activity without becoming distracting.

If shimmer is used:

- Keep contrast subtle.
- Keep timing consistent.
- Avoid excessive speed.
- Respect reduced motion.

When reduced motion is enabled, shimmer may be replaced with a static skeleton.

---

# 18. Success Motion

Success states may use subtle animation.

Examples:

```text
Payment Successful
Order Created
Item Added to Cart
Wishlist Updated
```

Possible patterns:

```text
Fade
Scale
Checkmark transition
```

Success motion should reinforce the result without delaying the next action.

---

# 19. Error Motion

Error motion should attract attention without being aggressive.

Possible behavior:

```text
Inline Error
Fade in

Invalid Form
Subtle highlight

Error Alert
Fade / slide in
```

Avoid excessive shaking.

If a shake animation is used, it must remain accessible and respect reduced-motion preferences.

---

# 20. Toast Motion

Toasts may:

```text
Enter
  ↓
Remain visible
  ↓
Exit
```

The animation should clearly communicate appearance and disappearance.

Important information should not disappear solely because the animation completed.

---

# 21. Search Motion

Search interactions may include:

```text
Search Suggestions
Fade / slide in

Loading
Progress indicator

Results
Content transition
```

Search animations should not delay typing or result access.

---

# 22. Image Search Motion

The image-search flow may use motion for:

```text
Image Selection
 ↓
Preview
 ↓
Processing
 ↓
Results
```

Processing feedback should make it clear that the system is working.

The animation must not imply AI certainty or progress that the system cannot actually measure.

---

# 23. Cart Motion

Cart interactions may use subtle feedback for:

```text
Add to Cart
Remove Item
Quantity Change
Cart Update
```

Examples:

```text
Button feedback
Cart count update
Small item transition
```

Motion should not obscure the updated cart state.

---

# 24. Wishlist Motion

Wishlist interactions may use:

```text
Heart state transition
Add
Remove
Loading
```

The animation should clearly communicate whether the product is currently saved.

---

# 25. Checkout and Payment Motion

Checkout may use motion for:

```text
Validation
Payment Processing
Success
Error
Order Confirmation
```

Payment processing should provide clear visual feedback.

The UI must not imply successful payment before the backend confirms the transaction.

---

# 26. Order Motion

Order status changes may use subtle transitions.

Example:

```text
Confirmed
   ↓
Preparing
   ↓
Out for Delivery
   ↓
Delivered
```

Timeline progression may animate when a new status is received.

---

# 27. Delivery Tracking Motion

Delivery tracking is a real-time feature and may use motion for:

- Map marker movement
- Timeline updates
- Status changes
- Estimated arrival changes
- Connection state

Socket.IO provides the real-time data.

Motion should represent actual received updates rather than simulate movement that has not occurred.

---

# 28. Recommendation Motion

Recommendation sections may use:

- Carousel transitions
- Card entrance
- Loading skeletons

Motion should remain secondary to product discovery.

---

# 29. Admin Motion

Administrative interfaces should prioritize efficiency.

Motion should be more restrained than marketing-oriented interfaces.

Use motion for:

- Dialogs
- Feedback
- Loading
- Status updates
- Navigation

Avoid unnecessary animation in dense tables and operational workflows.

---

# 30. List Motion

Lists may use subtle item transitions for:

- Adding items
- Removing items
- Reordering
- Filtering
- Loading results

Animations must avoid creating confusing movement when many items change simultaneously.

---

# 31. Layout Stability

Motion must not create unexpected layout shifts.

Avoid animations that:

- Change document flow unnecessarily.
- Push surrounding content unexpectedly.
- Cause horizontal overflow.
- Move controls away from the user's pointer or keyboard focus.

Prefer transform and opacity for many visual transitions when appropriate.

---

# 32. Performance

Motion should remain performant.

Prefer GPU-friendly properties where appropriate:

```text
transform
opacity
```

Avoid expensive continuous animations when they provide little value.

Motion should not noticeably reduce performance on lower-powered mobile devices.

---

# 33. Reduced Motion

The application must respect:

```text
prefers-reduced-motion
```

When reduced motion is requested:

- Remove unnecessary transitions.
- Disable decorative movement.
- Replace shimmer with static loading where appropriate.
- Reduce page transitions.
- Preserve essential state feedback.

Functional feedback must remain available without animation.

---

# 34. Motion and Accessibility

Motion must never be required to understand:

- Navigation
- Status
- Errors
- Success
- Availability
- Payment results
- Order state

Users must receive equivalent information without animation.

---

# 35. Motion Tokens

Motion should use centralized tokens.

Conceptually:

```scss
--motion-duration-fast
--motion-duration-normal
--motion-duration-slow

--motion-ease-standard
--motion-ease-in
--motion-ease-out
--motion-ease-in-out
```

The exact values should follow the approved Figma motion system.

---

# 36. Framer Motion Usage

Framer Motion should be used when it provides meaningful value for:

- Component transitions
- Layout animations
- Presence animations
- Page transitions
- Complex interaction sequences

Simple hover and color transitions may remain in SCSS/CSS.

---

# 37. Animation Boundaries

Motion logic should remain close to the component or feature it belongs to.

Avoid creating a global animation abstraction for every possible animation.

Shared motion utilities should be introduced only when the same behavior is genuinely reused.

---

# 38. Motion Naming

Motion definitions should use semantic names.

Prefer:

```text
fadeIn
fadeOut
slideIn
slideOut
scaleIn
scaleOut
```

rather than:

```text
animation1
transition2
effectNew
```

---

# 39. Motion Usage Rules

### Do

- Use motion with purpose.
- Keep transitions consistent.
- Respect reduced motion.
- Prefer subtle feedback.
- Validate performance.
- Align motion with Figma.
- Keep important information available without animation.

### Do Not

- Animate everything.
- Delay critical workflows.
- Use excessive bouncing or shaking.
- Simulate real-time activity inaccurately.
- Depend on animation for meaning.
- Introduce arbitrary durations everywhere.

---

# 40. Design Review

Before adding a new animation, verify:

1. What user problem does the animation solve?
2. Is the animation defined in Figma?
3. Can an existing motion pattern be reused?
4. Does it preserve layout stability?
5. Does it respect reduced motion?
6. Does it perform well on mobile?
7. Does it delay or obscure a critical action?

---

# 41. Motion Completion Criteria

The motion system is considered complete when:

- Motion principles are defined.
- Timing rules are defined.
- Easing rules are defined.
- Common interaction patterns are defined.
- Loading motion is defined.
- Feedback motion is defined.
- Commerce motion is defined.
- Delivery motion is defined.
- Admin motion is defined.
- Reduced-motion behavior is defined.
- Performance requirements are defined.
- Figma and implementation are aligned.

---

# 42. Motion Principle

> **Motion should explain change, provide feedback, and improve continuity without slowing the user down.**
