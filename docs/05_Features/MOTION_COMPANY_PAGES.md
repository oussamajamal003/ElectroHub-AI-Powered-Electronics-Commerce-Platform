# Task 03.1 — Home motion and company pages

Home uses CSS transform and opacity animations through shared `HeroEntrance`, `SectionReveal`, `StaggerContainer`, and `StaggerItem` primitives. The hero sequence runs on a fresh page load or refresh, and does not restart during ordinary back navigation. The Home sections and `/products` cards use an IntersectionObserver that resets after leaving the viewport and replays on re-entry; About and Contact retain one-time reveals. Motion is removed when the visitor prefers reduced motion. ProductCard hover behavior remains separate from page entrance motion.

`/about` is a static company page with an Explore Products link. `/contact` has illustrative contact information and a browser-only validated form. A valid submit displays an explicit demo notice; no message is delivered or stored.

The customer header links to About and Contact in desktop and mobile navigation. Orders remains hidden from unauthenticated header navigation. The footer links to Home sections and the company pages. The Home page handles section hashes after its lazy route mounts.

Visual QA source: existing repository design tokens and responsive breakpoints. `assets/figma/` is unavailable in this checkout. Reusable Playwright checks and viewport screenshots are in `apps/frontend/tests/visual/company-motion.spec.ts` and generated under `apps/frontend/test-results/` when run.

## Targeted closure verification

The benefits banner uses three equal columns from the tablet breakpoint and stacked rows on small screens. Its columns replay their entrance when the banner leaves and re-enters the viewport. The mobile navigation closes before opening the Sign Out confirmation; successful logout clears authenticated controls. During refresh, the header reads a presentation-only identity hint from session storage so a previously authenticated account icon and Orders link stay in place while `/auth/me` restores the session. The hint never grants route access and is cleared on confirmed invalid auth or sign-out. The catalog fetches the requested product page with a stable query key, loads filter metadata when needed, and retains cached pages during background refetch. Product listing requests are kept cacheable across React Strict Mode's development remount so the first request is reused.

Real local Playwright measurement at `127.0.0.1:3101`, backed by the local API: page 1 issued one product request, with 4,060 ms API latency and 5,541 ms until a usable grid. Page 2 issued one request, with 6,819 ms API latency and 7,372 ms until its grid. Returning to cached page 1 took 109 ms and issued no product request. The 3,000 ms cold-load target remains unmet because the local product API response itself exceeds that target; no database changes were made. The repeat measurement varied, with an earlier page 1 API response of 6,253 ms.
