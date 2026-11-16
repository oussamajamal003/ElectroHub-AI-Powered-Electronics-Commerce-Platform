# ELECTROHUB — TASK 04.6 — LEAFLET + OPENSTREETMAP

**Document status:** IMPLEMENTATION SPECIFICATION. **IMPLEMENTED on `feature/04.6-leaflet-osm` (2026-10-31), uncommitted, awaiting Principal Architect review.** Evidence: [TASK_04.6_IMPLEMENTATION_EVIDENCE.md](TASK_04.6_IMPLEMENTATION_EVIDENCE.md).
**Normative sources:** [Integrated architecture](TASK_04.5_04.7_DESIGN_ARCHITECTURE.md) §7, §9–§11 · [Design handoff](TASK_04.5_04.7_DESIGN_SYSTEM_HANDOFF.md) §3 (#10–14), §6 · artifact component `DeliveryMapPanel`

## Required changes

1. **Dependencies:** `leaflet@1.9.4`, `@types/leaflet` (frontend only). No `react-leaflet`, routing or geocoding packages.
2. **Backend:** a `DeliveryMapProjection` that adds the `map` field to the customer snapshot (additive, so 04.5 clients ignore it): origin from validated `DELIVERY_ORIGIN_*` config; destination only from stored `shippingLatitude/Longitude`, rounded to 3 dp; `path` from LOCATION_UPDATED events, thinned to ≤ 200; `pathKind`.
3. **Frontend:** `features/delivery/map/LeafletDeliveryMap.tsx` (via `React.lazy`), `useLeafletMap.ts` (create/destroy, `fitBounds`, marker updates without remounting), `markers.ts` (`divIcon` with token classes), Leaflet CSS imported inside the lazy chunk, zoom controls restyled to 44 px squares, attribution always visible, and the mobile "Explore map" gate.
4. **Config:** `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` (dev default: OSM standard tiles under the OSMF usage policy). Document the Phase 06 Nginx CSP `img-src` addition.

**Implementation notes (04.6):** Leaflet's own zoom and attribution controls are replaced by React controls (44px Zoom in / Zoom out / Recenter buttons and a text-only attribution link), so no configured string is ever written as HTML. The recorded path is shared only while OUT_FOR_DELIVERY (the same window as the live location), so delivered and cancelled orders show no route. `SIMULATED_FIXTURE` is reported for any delivery with `isSimulated` and recorded points; the 04.7 simulation runner that writes such data does not exist yet.

**Visual source of truth:** handoff §9.3 (DeliveryMapPanel) and the artifact's *DeliveryMapPanel* previews: header pills, text summary, 16:9 / 4:3 map with 44px controls, legend (hub, courier, recorded vs dashed simulated line, delivery area), and the stale, simulated, route-unavailable, no-location, tile-error and delivered states. The preview artwork is illustrative, not Leaflet output.

## Out of scope

Road routing (D2), geocoding (D3), production tile provider procurement (D1), real-time updates (04.7), and any change to 04.5 contract meanings.

## Acceptance criteria

- **AC1.** T6-01 … T6-09 pass.
- **AC2.** A network log during browser QA shows only the tile host contacted, and no URL contains coordinates other than tile x/y/z, addresses or order data.
- **AC3.** No straight origin→destination line can ever be rendered (a unit test on the layer builder).
- **AC4.** The Leaflet chunk is not requested when `map.pathKind === 'NONE'` and `location === null`.
- **AC5.** Visual QA at 390/768/1440/1920 plus 200% zoom; tile failure simulated by aborting the tile route.

## Risks

OSM tile policy (heavy use is forbidden, and production requires D1). Tile requests reveal the viewed area. Leaflet z-index sits below the sticky header (`isolation: isolate` on the container).

**STOP after 04.6 for Principal Architect review.**
