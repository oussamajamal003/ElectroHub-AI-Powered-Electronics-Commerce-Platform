# Storybook Foundation

Storybook is a development-only component playground for isolated UI work, state coverage, accessibility review, responsive checks, and screenshot comparison. It supplements—not replaces—Playwright, integration tests, real-page verification, or Figma Make references.

## Commands

From the repository root:

```bash
npm run storybook --workspace=apps/frontend
npm run build-storybook --workspace=apps/frontend
```

The development server opens Storybook locally. Static output is written to `apps/frontend/storybook-static/` and ignored by Git.

## Viewports and visual context

Preview includes resizable viewports named Mobile 390, Tablet 768, Desktop 1440, and Large Desktop 1920. The background selector uses the global white and catalog-surface tokens. Global ElectroHub styles load through the same `src/styles/main.scss` entry used by the application.

## Story policy

- Render the existing component; do not create future product/catalog components just to populate Storybook.
- Use deterministic local fixtures and repository-owned static assets.
- Do not make real API requests by default. Stories needing React Query use an isolated Storybook QueryClient; SearchField suggestions remain disabled until focused and a valid query is entered.
- Use current component props and product DTOs. Do not fabricate unsupported discount, availability, rating, or interaction behavior.
- The a11y addon is a review aid, not a complete accessibility sign-off.
- For motion-sensitive stories, enable the browser's `prefers-reduced-motion: reduce` emulation and verify the component remains understandable.

## Task 03.1 visual QA workflow

```text
Figma Make screenshot
    → Storybook story at the matching viewport
    → Playwright/browser screenshot
    → visual comparison
    → real page integration
    → E2E verification
```

Storybook is not imported by the customer application, is not exposed through customer routing, and is not published as part of the frontend production build.
