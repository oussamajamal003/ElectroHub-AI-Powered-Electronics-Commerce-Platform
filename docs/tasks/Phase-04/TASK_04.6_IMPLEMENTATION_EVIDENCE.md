# Task 04.6 — Leaflet + OpenStreetMap Delivery Map: Implementation Evidence

- **Branch:** `feature/04.6-leaflet-osm`, cut from `develop` at `660d30ff37e3d5d1efa12d1c8fa35c9ff73b5c75` (Task 04.5 merged, PR #41). **Uncommitted.** No commit, push, PR, merge or deploy.
- **Date:** 2026-10-31
- **Scope:** 04.6 only. No Socket.IO, simulation runner or other 04.7 work. No migration. No shared DEV/PROD database writes. The PROD migration workflow was not touched.
- **Visual source:** artifact https://claude.ai/artifact/9uEiC6tbMUUTPViergzFCd (`DeliveryMapPanel` README and `tokens.json`), handoff §9.3, architecture §7. **Figma:** DEFERRED TO PHASE 05 BY OWNER DECISION.

## 1. What was built

### Backend
- `src/config/delivery-map.config.ts`: `DELIVERY_ORIGIN_LAT/LNG/LABEL`. All unset → no hub, `map: null`. Partial, non-numeric or out-of-range → a startup error that names the variables, never their values. `server.ts` resolves it once at boot and logs only `configured: true|false`.
- `src/services/delivery-map.projection.ts`: `buildDeliveryMap` (pure). The destination is rounded to 3 dp and comes only from the stored `shippingLatitude/Longitude`. Every path point is re-validated (finite, in range); invalid points are dropped. The path is capped at 200 (newest kept, oldest first). `pathKind` is `NONE` when empty, `SIMULATED_FIXTURE` when `Delivery.isSimulated`, else `RECORDED`.
- `DeliveryService.getCustomerSnapshot` adds `map`. It is non-null only when a hub is configured and availability is `AVAILABLE`. Path points come from one bounded query: `delivery_events` for this delivery, `changes @> {LOCATION}`, non-null coordinates, `ORDER BY revision DESC LIMIT 200`, served by the existing `(deliveryId, revision)` unique index. **The path is shared only while the live location itself is shared** (OUT_FOR_DELIVERY with a current position), so delivered and cancelled orders, and orders whose location an admin cleared, expose no route. The admin snapshot is unchanged.
- Privacy: the response stays owner-scoped and `no-store` (asserted). Redacted owners already hold null shipping and event coordinates (`delivery-privacy.ts`), so they get `destination: null, path: [], pathKind: NONE`. Coordinates are never logged.

### Frontend
- `leaflet` pinned at `1.9.4`, plus `@types/leaflet`. No `react-leaflet`, routing or geocoding package.
- `features/delivery/map/markers.ts` (Leaflet-free at runtime): `sanitizePath`, `buildDeliveryLayers` (the only line is the polyline through `map.path`, so an origin→destination segment cannot be built), `hasDrawableMap` (AC4 gate), `mapTileConfig` (XYZ over https, or http on loopback only), and `markerIcon` (`divIcon` with token classes).
- `useLeafletMap.ts`: creates the map once per container, updates layers in place without a remount, fits bounds on the first draw only, and removes the map on unmount. Tile failure before any tile loads, or an init exception, is reported once. It also exposes zoom in/out, recenter and the interactivity toggle for the mobile gate.
- `LeafletDeliveryMap.tsx` (`React.lazy`; Leaflet JS and CSS live only in this chunk: `LeafletDeliveryMap-*.js` 156.6 kB, 46.0 kB gzip):
  - 44px Zoom in / Zoom out / Recenter buttons.
  - A text-only attribution link that is always visible (Leaflet's HTML attribution and zoom controls are disabled).
  - A legend (hub, latest or stale position, recorded or simulated route, delivery area) and a caption.
  - Below 48rem the map stays inert until **Explore map**, and **Done** makes it inert again.
- `DeliveryMapPanel.tsx`: the text summary stays first (`#delivery-map-summary`, the map's `aria-describedby`). The map is requested only when tiles are configured and there is a courier position or a 2+ point path. A skeleton reserves the final aspect ratio. Tile, init or chunk failure shows a warning `Alert` with **Retry map**, which builds a fresh `lazy()`.
- Config: `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` in `.env.example`. With either missing the panel is text-only.

### QA tooling
- `scripts/delivery-pg.cjs` sets a fictional hub. `delivery-qa-stack.cjs` adds the fictional hub plus a **local loopback SVG tile stub** (Vite gets `VITE_MAP_TILE_URL` pointing at it and logs each tile path). `delivery-qa-seed.ts` adds the `outRoute` (5 recorded points + stored delivery-area coordinates) and `outSimulated` fixtures.

## 2. Verification (commands actually run, 2026-10-31)

| Check | Result |
|---|---|
| `node scripts/delivery-pg.cjs` (disposable `electrohub_disposable_delivery_*`, all migrations) | **26/26 passed** (2 files). Includes new T6-01/T6-03 (destination rounding, 206 recorded updates → 200 points oldest-first, no hub point in the path, route hidden after DELIVERED, other customer 404), T6-09 (SIMULATED_FIXTURE; nulled coordinates → NONE), and the HTTP allowlist + `map` shape + `no-store`. Prisma drift: 0 on delivery objects. |
| Backend `vitest` delivery unit + controller + new `delivery-map.unit.test.ts` | 17/17 passed |
| Backend `npm run typecheck`, `npm run lint`, `npm run build` | pass / pass (no output) / pass |
| Frontend `vitest run src/features/delivery` (incl. new `map/markers.test.ts`, panel tests T6-02 chunk-not-requested, lazy map after summary, missing tile config → text) | 23/23 passed |
| Frontend `tsc -b`, `eslint .`, `npm run build` | pass / pass / pass |
| Playwright `delivery-map.visual.spec.ts` (real Chromium, disposable stack, tile stub) | **9/9 passed** on a fresh stack |
| Playwright `delivery-tracking.visual.spec.ts` (04.5 regression) | **8/8 passed** on a fresh stack |
| `git diff --check` | clean (only LF→CRLF notices) |

The first combined Playwright run (both specs on one stack) had one 04.5 failure: `POST /api/auth/login` returned **429** after about 17 sign-ins (the login rate limiter). It is environmental, not a regression: each spec passes on its own fresh stack. One genuine finding was fixed: the 04.5 keyboard test's 44px rule now exempts the new 12px attribution caption link as an inline-text target (WCAG 2.5.8), as it already exempted breadcrumbs.

### T6 matrix

| ID | Evidence |
|---|---|
| T6-01 | Unit layers; PG path test; browser: 3 `divIcon` markers inside the map box after fit, 1 solid path, legend, caption, attribution, axe 0 |
| T6-02 / AC4 | Unit `hasDrawableMap`; vitest mocked-chunk counter = 0; browser: no Leaflet chunk or tile request for out-for-delivery-no-location and delivered orders |
| T6-03 | Server drops invalid points (unit), client `sanitizePath` (unit), all invalid → route unavailable. Corrupt rows cannot be stored in PostgreSQL (CHECK constraints), so the browser covers the single-point route-unavailable state instead |
| T6-04 | Tile route aborted → warning Alert + Retry, summary intact, no map; unroute + Retry → map loads |
| T6-05 / AC5 | Attribution fully in viewport and inside the map at 390/768/1440/1920 and 640px (200% of 1280); no horizontal overflow; controls ≥ 44×44; axe 0 at each size |
| T6-06 | 390px: zoom disabled, a wheel over the map scrolls the page; Explore map → controls enabled, `tabindex=0`; Done → inert, `tabindex=-1` |
| T6-07 | Tab reaches the map container, outline not `none`; `+` raises the tile zoom; Tab → Zoom in, Enter zooms again; Recenter keeps all markers |
| T6-08 / AC2 | Request origins = {app origin, tile stub}; every tile URL matches `/z/x/y.svg`; no URL contains coordinates, `latitude`/`longitude`, the address or the customer name |
| T6-09 | Dashed path (`stroke-dasharray="8 6"`), "Simulated route" legend, simulated caption, "Simulated demo" pill, axe 0 |
| AC3 | Unit: for every `pathKind` with an empty path no line is built, and a line never contains the origin or destination |

Screenshots (git-ignored): `apps/frontend/screenshots/delivery-04.6/`: `map-recorded-1440`, `map-simulated-1440`, `map-route-unavailable-1440`, `map-tile-error-1440`, `map-outNoLocation-1440`, `map-delivered-1440`, `map-390`, `map-390-exploring`, `map-768`, `map-1440`, `map-1920`, `map-zoom200-1280`, `map-keyboard-focus-1440`, `page-390`, `page-1920`. Inspected against the artifact README: square hub, ringed round courier dot, pin-shaped delivery area, solid primary recorded line, dashed `text-secondary` simulated line, 44px square controls top-right, attribution bottom-right.

## 3. External verification

| System | Status |
|---|---|
| Figma | NOT VERIFIED (deferred to Phase 05 by owner decision) |
| Artifact visual reference | PARTIALLY VERIFIED: the README spec and tokens were read and the screenshots compared by inspection; the preview artwork is illustrative, not Leaflet output |
| Supabase DEV/PROD | NOT VERIFIED / not touched (no migration in 04.6) |
| Public OSM tiles | NOT VERIFIED: QA used a local stub by design; not contacted |
| GitHub CI | NOT VERIFIED: nothing pushed |
| Stripe / Sentry | Not relevant |

## 4. Architect review corrections (pre-commit)

| Severity | Finding | Fix | Verification |
|---|---|---|---|
| High | `package-lock.json` recorded `leaflet: ^1.9.4` while `package.json` pinned `1.9.4`, so `npm ci` would reject the lockfile | lockfile resynced (`npm install`) | lock root now `"leaflet": "1.9.4"` |
| Medium | After an admin cleared the live location, the recorded path was still returned | path served only while a current position exists | PG test asserts `path: [], pathKind: NONE` after `location: null` (26/26) |
| Medium | `DeliveryMap` was not keyed per order, so switching orders could inherit the previous viewport or failure state | `key={snapshot.orderReference}` | frontend 23/23, typecheck, lint |

## 5. Known limitations and risks

- **D1 open:** production tile provider. The public OSM tiles are for dev/review only. The Phase 06 Nginx CSP `img-src` must add the chosen tile host. Tile requests reveal the viewed area (x/y/z) plus IP and Referer to the tile host.
- `SIMULATED_FIXTURE` is driven by `Delivery.isSimulated`; the 04.7 runner that writes simulated positions does not exist. The QA fixture sets the flag directly and its points are entered as `MANUAL`, so the 04.5 text summary reads "Position shared by the courier team" beside the "Simulated demo" pill (04.5 wording, unchanged).
- Path thinning keeps the newest 200 points rather than downsampling the whole history.
- The mobile gate uses a viewport media query (`max-width: 47.99rem`) evaluated at mount, not a container query.
- Screen-reader behaviour is not verified with real AT. The map container carries `role=region`, `aria-roledescription=map`, a label and the summary as its description.
- `npm install` reported 23 pre-existing moderate audit findings; none were introduced by `leaflet@1.9.4`, which has no dependencies.
