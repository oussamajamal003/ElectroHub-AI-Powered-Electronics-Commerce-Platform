# SCSS Standard

## 1. Purpose

This document defines the SCSS and styling standards for ElectroHub.

The frontend uses:

```text
SCSS
CSS Modules
7-1 SCSS Architecture
```

The goal is to keep styling:

- Consistent.
- Scalable.
- Maintainable.
- Component-oriented.
- Responsive.
- Accessible.
- Compatible with the Figma design system.

---

## 2. Styling Principles

Styles should follow:

- Clear ownership.
- Predictable scope.
- Reusable design tokens.
- Minimal duplication.
- Responsive-first thinking.
- Accessibility requirements.
- Consistent naming.
- Separation of global and component styles.

Avoid unnecessary specificity and deeply nested selectors.

---

## 3. 7-1 Architecture

The project follows a structured 7-1-inspired SCSS organization.

Conceptually:

```text
styles/
├── abstracts/
│   ├── _variables.scss
│   ├── _functions.scss
│   ├── _mixins.scss
│   └── _breakpoints.scss
│
├── base/
│   ├── _reset.scss
│   ├── _typography.scss
│   └── _global.scss
│
├── components/
├── layout/
├── pages/
├── themes/
├── vendors/
└── main.scss
```

The exact directory names may evolve, but the separation of concerns should remain.

---

## 4. CSS Modules

Component-specific styles should use CSS Modules where appropriate.

Example:

```text
ProductCard.tsx
ProductCard.module.scss
```

CSS Modules provide local scoping and reduce accidental style collisions.

---

## 5. Global Styles

Global SCSS should be limited to concerns such as:

- Reset.
- Base typography.
- Global tokens.
- Theme variables.
- Accessibility utilities.
- Global layout primitives.

Do not place component-specific styling into global styles without justification.

---

## 6. Naming

Use clear, semantic class names.

Prefer:

```scss
.productCard {}
.productCard__title {}
.productCard__price {}
```

For CSS Modules, local class names should remain readable:

```scss
.container {}
.title {}
.price {}
```

Avoid meaningless names:

```scss
.box {}
.redThing {}
.test1 {}
```

---

## 7. Nesting

Keep nesting shallow.

Prefer:

```scss
.productCard {
  display: flex;

  &__title {
    font-weight: 600;
  }
}
```

Avoid excessive nesting such as:

```scss
.productCard {
  .content {
    .header {
      .title {
        span {
          // ...
        }
      }
    }
  }
}
```

Deep nesting increases specificity and maintenance cost.

---

## 8. Variables and Design Tokens

Use centralized variables/tokens for recurring values.

Examples:

```scss
$color-primary: ...;
$color-text: ...;
$spacing-md: ...;
$radius-md: ...;
$shadow-sm: ...;
```

The actual project values must follow the documented design system.

Avoid repeating the same design value across unrelated files.

---

## 9. CSS Custom Properties

CSS custom properties may be used for runtime theming.

Example:

```scss
:root {
  --color-background: ...;
  --color-text: ...;
}

[data-theme="dark"] {
  --color-background: ...;
  --color-text: ...;
}
```

This is especially appropriate for light/dark theme switching.

---

## 10. Responsive Design

Responsive behavior should follow the documented breakpoints.

Styles should support:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Avoid designing only for one viewport.

Prefer fluid layouts where appropriate rather than excessive fixed dimensions.

---

## 11. Accessibility

SCSS must support accessible interaction.

Do not remove focus indicators without providing an accessible replacement.

Example:

```scss
.button:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

Respect reduced-motion preferences:

```scss
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
    transition-duration: 0.01ms;
  }
}
```

---

## 12. Theme System

The application supports theme switching.

Theme styles should be based on shared design tokens rather than duplicating entire component styles.

Prefer:

```text
Component styles
      ↓
Design tokens
      ↓
Theme values
```

Avoid separate duplicated implementations of the same component for light and dark themes.

---

## 13. RTL and Localization

The application supports localization and Arabic RTL layouts.

Styles should avoid assumptions about left-to-right layout.

Prefer logical properties where practical:

```scss
margin-inline-start
margin-inline-end
padding-inline
inset-inline-start
inset-inline-end
```

Avoid unnecessary hard-coded directional properties.

---

## 14. Layout

Prefer modern CSS layout systems:

```text
Flexbox
CSS Grid
Container Queries where appropriate
```

Avoid positioning-based layouts when normal flow, flexbox, or grid is sufficient.

---

## 15. Spacing

Use the project's spacing scale consistently.

Avoid arbitrary values unless a design requirement requires them.

Prefer:

```scss
padding: var(--spacing-md);
```

over repeatedly introducing unrelated values.

---

## 16. Typography

Typography should follow the documented design system.

Avoid styling headings and body text independently in every component.

Global typography tokens should define:

- Font families.
- Font sizes.
- Font weights.
- Line heights.
- Letter spacing.

---

## 17. Animations

Animations should be purposeful.

Use consistent durations and easing values.

Do not add animation merely for decoration when it harms usability or performance.

Motion must respect:

```text
prefers-reduced-motion
```

---

## 18. Z-Index

Avoid arbitrary high z-index values.

Use a documented layering scale.

Conceptually:

```text
Base
Dropdown
Sticky
Modal
Toast
Critical Overlay
```

This prevents z-index conflicts across the application.

---

## 19. Images and Media

Images should:

- Be responsive.
- Preserve intended aspect ratios.
- Avoid unnecessary layout shifts.
- Use appropriate object-fit behavior.
- Follow Cloudinary optimization where applicable.

Do not use enormous source images when smaller optimized assets are sufficient.

---

## 20. Component Styles

A component should normally own its styles.

Example:

```text
ProductCard/
├── ProductCard.tsx
└── ProductCard.module.scss
```

This keeps implementation and styling close together.

Shared styles should only be extracted when reuse is meaningful.

---

## 21. Avoid Magic Values

Avoid unexplained values:

```scss
margin-top: 37px;
z-index: 9999;
```

Prefer design tokens or documented values.

If a value is intentionally unique, its reason should be clear from the design context.

---

## 22. Vendor Prefixes

Do not manually add vendor prefixes unless a specific compatibility requirement justifies them.

Use the project's build tooling where appropriate.

---

## 23. Performance

Avoid:

- Extremely complex selectors.
- Excessive animations.
- Large global stylesheets.
- Repeated duplicated rules.
- Unnecessary layout-triggering animations.

Prefer transform/opacity for performant animations where applicable.

---

## 24. Dead Styles

Remove:

- Unused classes.
- Obsolete selectors.
- Duplicate rules.
- Commented-out styles.
- Temporary debugging styles.

Production code must not contain abandoned styling experiments.

---

## 25. Validation

SCSS quality should be checked through:

```text
Lint
Build
Responsive Testing
Cross-Browser Testing
Accessibility Testing
Visual QA
```

Important visual changes should be checked against Figma.

---

## 26. SCSS Principle

> **Use structured, scoped, token-driven SCSS that keeps styling predictable across components, themes, responsive layouts, and RTL interfaces.**
