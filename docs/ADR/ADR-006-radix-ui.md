# ADR-006: Radix UI

- **Status:** Accepted
- **Date:** 2026-08-10

## Decision

ElectroHub will use **Radix UI** for accessible UI behavior primitives where appropriate.

Radix UI is not the project's visual design system.

The visual appearance will be implemented using the approved Figma design, SCSS, and CSS Modules/structured SCSS approach.

## Context

The application needs accessible interaction behavior for UI patterns such as:

```text
Dialogs
Dropdowns
Menus
Popovers
Tabs
Tooltips
Other Interactive Primitives
```

The project explicitly does not use:

```text
Tailwind CSS
shadcn/ui
Bootstrap
Material Design UI
```

The application requires a custom visual identity rather than a generic component-library appearance.

## Alternatives

### Build every behavior from scratch

All interaction and accessibility behavior could be implemented manually.

### Bootstrap

Bootstrap could provide ready-made components and styling.

### Material UI

Material UI could provide a broad component system.

### shadcn/ui

shadcn/ui could provide composable components, but it is based on the Tailwind ecosystem and does not match the selected styling architecture.

### Radix UI

Radix UI provides behavior and accessibility primitives without imposing a complete visual design language.

## Rationale

Radix UI was selected because:

- It provides accessible interaction primitives.
- It does not impose a Material-style visual identity.
- It works well with custom styling.
- It allows the Figma design to remain the visual source of truth.
- It fits the project's SCSS/CSS Modules approach.

## Consequences

### Positive

- Accessible interaction primitives.
- Strong control over visual design.
- No Tailwind dependency.
- No predefined Material-style appearance.
- Better separation between behavior and presentation.

### Trade-offs

- The project still needs to build and maintain its own visual component styling.
- Developers must understand both Radix behavior and project-specific styling.
- Some components may require additional implementation work.

## Architectural Rule

Radix UI provides behavior primitives only where appropriate. It must not dictate the application's visual language or replace the project's Figma design system.
