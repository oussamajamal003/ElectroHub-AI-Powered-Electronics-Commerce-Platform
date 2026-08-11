# ADR-007: SCSS and CSS Modules Styling Architecture

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will use **SCSS with CSS Modules and a structured SCSS architecture** for frontend styling.

Figma is the source of truth for visual design.

## Context

The application requires:

- A custom visual identity.
- Maintainable component styling.
- Responsive layouts.
- Reusable design tokens.
- Clear style ownership.
- Strong separation between components.

The project explicitly avoids:

```text
Tailwind CSS
shadcn/ui
Bootstrap
Material Design UI
```

## Alternatives

### Tailwind CSS

A utility-first CSS framework could provide rapid styling.

### Bootstrap

A traditional component-oriented CSS framework could provide ready-made styles.

### CSS-in-JS

Styles could be colocated with JavaScript/TypeScript through a CSS-in-JS solution.

### Plain CSS

The application could use standard CSS files without SCSS or CSS Modules.

### SCSS + CSS Modules

SCSS provides advanced stylesheet capabilities while CSS Modules provide component-scoped class names.

## Rationale

SCSS and CSS Modules were selected because:

- They provide strong control over the visual design.
- Styles remain close to their owning components.
- CSS Modules reduce accidental global style collisions.
- SCSS supports variables, mixins, nesting, and reusable style structures.
- The approach fits the Figma-first custom design strategy.
- It avoids the visual and architectural constraints the team wants to avoid with Tailwind and large UI frameworks.

## Consequences

### Positive

- Custom visual identity.
- Scoped component styles.
- Strong styling control.
- Reusable SCSS architecture.
- Good compatibility with React and Vite.

### Trade-offs

- More styling code must be maintained by the project.
- Developers must follow consistent SCSS conventions.
- Poorly structured SCSS can become difficult to maintain.
- Design tokens and shared utilities must be intentionally organized.

## Architectural Rule

Component-specific styles should normally use CSS Modules.

Shared global styles, tokens, utilities, and foundational rules should follow the project's structured SCSS architecture.

Figma remains the source of truth for intended visual design.
