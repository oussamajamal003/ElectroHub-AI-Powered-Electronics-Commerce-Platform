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

## Task 03.4A Inventory states

`StatusBadge.stories.tsx` covers success/warning/error. `ProductCard.stories.tsx` covers InStock, LowStock, OutOfStock and SavedOutOfStock. `ProductPurchaseActions.stories.tsx` renders the production Details action composition: InStock, LowStock, OutOfStock, AtMaximum, Loading, Added and interactive StockShrink. CartPage covers LowStock conflict, ExactStock, Unavailable and MixedStock; WishlistPage covers InStock, LowStock, OutOfStock and MixedStock. No default API request is needed. `tests/storybook/inventory.stories.spec.ts` checks 22 states at 390/768/1440/1920 with WCAG A/AA axe, overflow and no API assertions. The axe instance is isolated from the Storybook addon to prevent concurrent audit collisions. Full Details/gallery remain route-level browser evidence, not a fabricated Storybook page.

## Task 03.3 Wishlist

`WishlistPage.stories.tsx` renders the actual `WishlistPageContent` with deterministic local Product fixtures: Guest, Authenticated, Empty, Loading, Error, BackgroundError, MergeRecovery, OutOfStock, Unavailable and Pending. `WishlistButton.stories.tsx` covers Unsaved, Saved, Pending, Error and DetailsActions (the real Button and heart using the Details action layout). ProductCard adds WishlistUnsaved, WishlistSaved, WishlistPending and WishlistOutOfStock. No default API calls occur. Page stories exercise actual ProductCards and their independent Add-to-Cart action.

Run `npx playwright test -c playwright.cart-storybook.config.ts wishlist.stories.spec.ts` from `apps/frontend` for actual axe WCAG 2 A/AA checks, no API request assertions, overflow checks and screenshots at 390/768/1440/1920. Full Product Details composition is checked by the catalog browser suite, not claimed as a standalone Storybook page.
