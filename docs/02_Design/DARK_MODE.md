# ElectroHub — Dark Mode (Light / Dark Theme System)

Status: implemented (Task 06.2 parallel side task). Applies to the customer storefront and the admin console.

> **Design authority.** The ElectroHub Figma Design defines the light theme only; it has **no dark variant**. The dark values below are
> an ElectroHub *extension* derived from the existing tokens (brand blue `#2563EB`, accent cyan `#06B6D4`, slate neutrals, zero radius,
> Poppins / JetBrains Mono). They were not taken from Figma and must not be described as Figma-approved until design review adopts them.

---

## 1. Architecture — one source of truth

| Layer | File | Role |
|---|---|---|
| Semantic tokens (both themes) | `apps/frontend/src/styles/themes/_index.scss` | `:root, [data-theme='light']` and `[data-theme='dark']` define every `--eh-color-*` / `--eh-shadow-*` custom property. |
| Sass API (unchanged names) | `apps/frontend/src/styles/abstracts/_variables.scss` | `$color-*`, `$shadow-*`, `$focus-ring-color` now resolve to `var(--eh-…)`, so every existing SCSS module became theme-aware without per-module dark styles. |
| Helpers | `apps/frontend/src/styles/abstracts/_functions.scss` | `theme-alpha($token, $a)` replaces `rgba($token, $a)` (runtime `color-mix`); `@include dark-theme { … }` for the few component-specific Figma literals with no semantic token. |
| Third-party overrides | `apps/frontend/src/styles/vendors/_leaflet.scss` | Leaflet controls, popups, attribution. |
| Runtime state | `apps/frontend/src/features/theme/` | `ThemeProvider`, `useTheme`, `ThemeToggle`, `themePreference.ts`. |
| Pre-paint initialiser | `apps/frontend/public/theme-init.js` + `<script src="/theme-init.js">` in `index.html` | Sets `<html data-theme>` before first paint. |

The theme is a single attribute on `<html>`. Radix portals (dialogs, dropdowns, tooltips, toasts, drawers, the Discovery console)
render under `<body>` and therefore inherit it automatically — no portal-specific code exists.

### Authoring rules

1. Use semantic tokens (`$color-*`). Never hard-code a colour for a surface, text, border or state.
2. Translucent tints: `theme-alpha($color-primary, .1)` — **not** `rgba($color-primary, .1)` (Sass cannot evaluate a CSS variable).
3. Brand-coloured **text/links/icons** use `$color-primary-text` (hover `$color-primary-text-hover`). `$color-primary` is for fills,
   borders and focus-adjacent decoration. No single blue passes WCAG AA both as white-label fill and as text on a dark surface.
4. Text on an accent (cyan) fill uses `$color-accent-foreground`; text on a primary fill uses `$color-text-inverse`/`$color-primary-foreground`.
5. Popovers/menus/dialogs may use `$color-elevated` for depth; page canvases `$color-surface`; cards/headers `$color-background`.
6. Elements drawn on **always-dark artwork** (home hero, company hero, out-for-delivery slab) keep fixed light literals (`#e2e8f0`)
   — a theme token would invert them. Mark such literals with a `// fixed:` comment.
7. A component-specific Figma tint without a semantic equivalent keeps its light literal and adds `@include dark-theme { … }`.

## 2. Theme preference

| Step | Rule |
|---|---|
| 1 | A valid explicit choice in `localStorage['electrohub:theme:customer']` or `localStorage['electrohub:theme:admin']` (`light` \| `dark`) wins. |
| 2 | Otherwise `prefers-color-scheme`, followed live until the user chooses. |
| 3 | Otherwise light. |

- Only explicit choices are written; invalid values are ignored; blocked storage never breaks switching (the choice just isn't kept).
- Route ownership selects the active preference: `/admin` and `/admin/...` use admin, including login; similar prefixes such as `/administrator-help` use customer.
- A single provider sits inside BrowserRouter and changes the document attribute in a layout effect on SPA transitions. It never copies a theme between scopes or remounts the application.
- Storage events synchronise each scope only. Customer/admin tabs remain independent; clearing storage returns each scope to system preference.
- The old `electrohub:theme` key is consumed once for customer only and removed; valid explicit scoped settings win. Admin initializes independently from system. Invalid legacy values are removed without migration.
- Device-local only: never sent to the backend, no cookie, no database field.
- `public/theme-init.js` mirrors the same rules (kept in sync by a unit test). It is a classic, render-blocking, same-origin script —
  compatible with a future `script-src 'self'` CSP; no inline script was added.

## 3. Header toggle

`ThemeToggle` is rendered in both headers (customer utility group before the cart; admin header before alerts) and reuses each
header's own `.iconButton` class for size, hover and focus ring.

- Lucide `Moon` (offers dark) / `Sun` (offers light); the icon is `aria-hidden`.
- Accessible name states the action: "Switch to dark mode" / "Switch to light mode" (also the `title`).
- `aria-pressed` is intentionally **not** used: per the ARIA APG a toggle button with `aria-pressed` keeps a constant label.
- Switching flips one attribute: no reload, no remount, no React Query refetch, no auth/cart/form reset.
- Small screens: ≤ 375 px customer icon buttons are 32 px; ≤ 374 px admin header controls are 40 px (both ≥ WCAG 2.5.8's 24 px),
  so the extra control fits at 320 px without horizontal overflow.

## 4. Dark palette

Surface hierarchy (blue-tinted slate, never pure black): **canvas** `#0B1220` → **card / header / body** `#111A2D` →
**elevated** (menus, dialogs) `#172238`; hover `#1B2740`; borders `#26344D` / strong `#3A4B69`; overlay `rgb(2 6 16 / .72)`.

| Token | Light (unchanged) | Dark |
|---|---|---|
| `--eh-color-primary` (fill) | `#2563EB` | `#2563EB` (white label 5.17:1) |
| `--eh-color-primary-text` | `#2563EB` | `#7CB2FF` |
| `--eh-color-primary-subtle` | `#EFF6FF` | `#15284A` |
| `--eh-color-accent` | `#06B6D4` | `#22D3EE` |
| `--eh-color-accent-foreground` | `#FFFFFF` | `#042F38` (7.91:1) |
| `--eh-color-text-primary` | `#0F172A` | `#E8EEF7` |
| `--eh-color-text-secondary` | `#475569` | `#A8B5C9` |
| `--eh-color-text-muted` | `#94A3B8` | `#7D8CA5` |
| `--eh-color-focus-ring` | `#2563EB` | `#60A5FA` |
| success / warning / error / info fg | `#15803D` / `#B45309` / `#B91C1C` / `#0369A1` | `#6EE7A0` / `#FCD34D` / `#FCA5A5` / `#93C5FD` |
| success / warning / error / info bg | Figma tints | `#0C2A1C` / `#2B200B` / `#2D1418` / `#0C2238` |
| `--eh-color-image-well` | `#F1F5F9` | `#E9EEF5` (product photos are shot on light backgrounds) |

Measured contrast (WCAG relative luminance) of dark text tokens:

| Token | canvas `#0B1220` | card `#111A2D` | elevated `#172238` | hover `#1B2740` |
|---|---|---|---|---|
| text-primary | 16.05 | 14.89 | 13.62 | 12.76 |
| text-secondary | 9.02 | 8.37 | 7.65 | 7.17 |
| text-muted (placeholder/disabled role) | 5.50 | 5.10 | 4.66 | 4.37 |
| primary-text | 8.62 | 7.99 | 7.31 | 6.85 |
| success / warning / error / info fg | ≥ 9.6 | ≥ 9.1 | ≥ 8.4 | ≥ 7.8 |
| focus ring `#60A5FA` (non-text, ≥ 3:1) | 7.36 | 6.83 | 6.25 | 5.85 |

Shadows deepen in dark (`rgb(0 0 0 / .4–.7)`), borders carry most separation; no glow, neon or gradients were added.

## 5. Third-party UI

| Surface | Treatment | Limitation |
|---|---|---|
| Stripe Payment Element | `appearance.theme` `stripe` ↔ `night` with ElectroHub variables; delivered through `elements.update()` (the `<Elements key>` is unchanged) so the iframe is not remounted and card entry is kept. | Provider-hosted iframe internals are Stripe's; verified with the SDK mocked, not against live Stripe. |
| Leaflet / OSM | Zoom bar, popups, attribution use dark tokens; attribution stays legible. | Raster tiles are unchanged (no approved dark tile source; filtering tiles harms legibility). |
| Google sign-in button | Google's own dark specification (`#131314` / `#8E918F` / `#E3E3E3`). | Brand-specified, not ElectroHub tokens. |
| Charts (admin dashboard / analytics) | Bars, axes, labels and tooltips use tokens; muted analytics bars use a lighter, higher-alpha fill in dark (≈ 3:1). | Categorical `CHART_SERIES` colours are unchanged (readable on both themes). |
| Native controls / scrollbars | `color-scheme: light|dark` per theme. | Rendering is browser-defined. |

## 6. Storybook

`.storybook/preview.ts` adds a **Theme** toolbar (Light / Dark) that sets `<html data-theme>` exactly like the app.
