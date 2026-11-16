# ELECTROHUB — TASKS 04.5–04.7 — DESIGN SYSTEM EXTENSION & DEVELOPER HANDOFF

**Document status:** DESIGNED / PROPOSED. It awaits Principal Architect review and is **not implemented.**
**Prepared:** 2026-10-31 on `feature/04.5-04.7-delivery-tracking` @ `1cd550a`
**Design-system artifact (editable source of these specs):** https://claude.ai/artifact/9uEiC6tbMUUTPViergzFCd (private until the owner shares it)
**Architecture, API, database, tests:** [TASK_04.5_04.7_DESIGN_ARCHITECTURE.md](TASK_04.5_04.7_DESIGN_ARCHITECTURE.md)

> **FIGMA: DEFERRED TO PHASE 05 BY OWNER DECISION.** Delivery Figma work is intentionally deferred to Phase 05; the Claude interactive artifact and this handoff are the current design reference. Figma is **not** a blocker for Tasks 04.5–04.7. This records a delivery-scope decision only and does not change any global project or Figma policy. `assets/figma/` still does not exist in the repository, so visual QA compares against the artifact.

---

## 1. Design-plugin evidence (what actually ran)

| Plugin command | Input actually inspected | Output |
|---|---|---|
| `design:design-system` (audit + extend) | `_variables.scss`, `_mixins.scss`, `components/ui/{OrderStatus,PaymentStatus,StatusBadge,Badge,Card,Button,Alert,Toast,Skeleton,EmptyState,ErrorState}`, `features/orders/*`, `lib/query.ts` | §2 audit, §3 inventory, artifact `tokens.json` |
| `design:design-critique` | the artifact's 10 component previews, rendered locally with Playwright at 1280 px and 390 px against the token values | §4 (5 findings, all corrected) |
| `design:accessibility-review` | the same rendered previews + axe-core 4 (`wcag2a, wcag2aa, wcag21aa, best-practice`) at 1280 and 390 + target-size script + computed contrast for 19 token pairs | §5 (2 actionable findings, both corrected; re-run clean) |
| `design:design-handoff` | the final artifact + architecture doc | this document |
| Figma MCP | — | **deferred to Phase 05 by owner decision** |

Screen-reader testing with real assistive technology (NVDA/VoiceOver) was **not** performed. Previews are static HTML specs, not the React implementation.

---

## 2. Design-system audit (EXISTING system)

**Components reviewed:** 14 · **Issues found:** 5 · **Score: 78/100.** The tokens are coherent and the badge triplets are good. The issues below are deductions.

| Area | Finding | Impact on delivery work |
|---|---|---|
| Tokens | 9 semantic colour triplets, 10 spacing steps, 5 breakpoints, 3 transitions, z-index scale; all radii `0` except `radius-full` | reused as-is; no new raw values |
| Contrast | `color-text-muted` 2.56:1, `color-success` 2.28:1, `color-warning` 2.15:1, `color-accent` 2.43:1 on white: **fail** text and the 3:1 non-text minimum | delivery bans them for text and for meaningful icons; it uses the `*-foreground` tokens instead |
| `Card` primitive | references undefined `$spacing-1-5` and `$font-family-sans`; no consumers | not reused; Order Details `.card` pattern reused. Fix the primitive separately |
| `OrderStatus` | legacy `processing`/`shipped` keys alongside the canonical states | delivery never uses them |
| Hardcoded values | 53 hex literals and ~830 px literals across SCSS modules (rough grep) | delivery SCSS must use tokens only (review gate) |
| Theming | no dark theme; no i18n/RTL runtime | light only; logical properties for future RTL |

---

## 3. Component inventory & reuse decisions

| # | Logical component | Existing source | Decision | States | Tokens | A11y | Task |
|---|---|---|---|---|---|---|---|
| 1 | TrackDeliveryButton | `Orders.module.scss .primaryLink` / `.outlineLink` | reuse style; `<Link>` | default, hover, focus-visible, hidden-when-ineligible | color-primary, primary-dark, spacing-3/6 | link, 44 px | 04.5 |
| 2 | DeliveryStatusBadge | `components/ui/OrderStatus` | **reuse unchanged** | 6 canonical + unknown | badge triplets | sr prefix "Order status:", not live | 04.5 |
| 3 | DeliveryProgressStepper | — | **new** (`features/delivery/components`) | completed, current, future | delivery-step-* aliases | `<ol>`, `aria-current="step"` | 04.5 |
| 4 | DeliveryOverviewCard | `.card`, `.totals` | **new composite** | normal, ETA-missing, stale, simulated, delivered | eta-value, data-reference | `<dl>` | 04.5 |
| 5–6 | DeliveryTimeline / Event | `.items` list pattern | **new** | populated, empty, new-row | data-time | `<ol reversed>`, `<time>` | 04.5 |
| 7 | EstimatedArrivalCard | — | **folded into #4** (a row, not a card) | — | — | — | 04.5 |
| 8 | LastKnownLocationCard | — | **folded into #4** | fresh, stale, simulated, none | warning triplet | text, never coordinates | 04.5 |
| 9 | TrackingReferenceDisplay | — | **folded into #4** | set, pending | data-reference | plain text | 04.5 |
| 10 | DeliveryMapPanel | `.card` | **new** | placeholder, none, loading, loaded, route-unavailable, tile-error, stale, simulated | map aliases | region + describedby summary | 04.5 shell / 04.6 map |
| 11–13 | Courier / Origin / Destination markers | — | **new** Leaflet `divIcon` classes | default, stale, simulated | delivery-marker-* | aria-hidden (summary carries facts) | 04.6 |
| 14 | DeliveryRouteLayer | — | **new** | recorded, simulated-fixture, none | delivery-route-* | legend text | 04.6 |
| 15 | ConnectionStatusIndicator | `components/ui/StatusBadge` | **variant** (dot + label) | connected, reconnecting, paused, stopped | info/warning/neutral | text label | 04.7 |
| 16 | DeliveryEventToast | `components/ui/Toast` | **reuse** (info) | status/ETA only | shadow-lg | live region separate | 04.7 |
| 17 | DeliveryUnavailableState | `EmptyState` | **reuse** | payment-pending, not-found | — | role=alert on first load | 04.5 |
| 18 | DeliveryTrackingSkeleton | `Skeleton` | **reuse**, layout mirrors page | loading | surface | role=status label | 04.5 |
| 19 | DeliveryErrorState | `ErrorState` + `.notice` | **reuse** | first-load error, refetch error | error triplet | role=alert | 04.5 |
| 20 | DeliveryAdminStatusControl | `Select`, `Dialog` | **compose** | next-only, terminal, ineligible | — | labelled select, confirm dialog | 04.5 |
| 21 | AdminLocationUpdateControl | `Input` | **compose** | valid, invalid, cleared | error-foreground | fieldset/legend, aria-invalid | 04.5 |
| 22 | AdminETAEditor | `Input type=datetime-local` | **compose** | set, invalid, cleared | — | label + help | 04.5 |
| 23 | DeliverySimulationIndicator | `components/ui/Badge` (info) | **reuse** + `FlaskConical` | running | info triplet | text "Simulated demo" | 04.6/04.7 |
| 24 | AccessibleMapTextSummary | — | **new text block** inside #10 | always | text-primary/secondary | first child, describedby | 04.5 |

Net new React components: **Stepper, OverviewCard, Timeline, MapPanel (+ map internals), AdminDeliveryUpdatePanel, ConnectionStatusIndicator wrapper.** No new Button, Badge, Card, Modal, Tooltip, Skeleton or Alert.

---

## 4. Design critique (run once, corrections applied)

**Overall:** the design reads as a native extension of Order Details: the same grid, square bordered cards and badge pair. The biggest risk found was copy and visuals implying data the backend does not store.

| # | Finding | Severity | Correction applied |
|---|---|---|---|
| C1 | Overview showed "Between 2:00 PM and 5:00 PM", but the data model stores one `estimatedAt` instant, so the window would be fabricated | 🔴 truthfulness | copy changed to "Around 2:00 PM · Estimate, not guaranteed"; timeline likewise |
| C2 | The cancelled screen "adds a Cancelled row" to the timeline, but cancellation is owned by PaymentService and no delivery event is recorded for it | 🔴 truthfulness | timeline shows recorded events only; cancellation shown by the state panel |
| C3 | Map was 16/9 at 390 px, which made it short and cramped beside the 44 px controls | 🟡 | 4/3 (max 18rem) below md, 16/9 from md, 28rem max from 2xl |
| C4 | Cancelled panel was fully error-tinted, so it read as an app failure, not an order state | 🟢 | neutral card + 3 px error-foreground top rule + `XCircle` |
| C5 | Admin "Clear estimate" was an `<a href>` that performs an action | 🟡 | `<button type="button">` link-styled, 44 px |

**Hierarchy check:** eye goes h1 → badge pair → (desktop) stepper / (mobile) Overview ETA. On mobile the Overview comes **before** the map so the essentials are first, and the map never dominates. Payment and delivery badges stay distinct. Completed steps carry a fill, a check and text.

---

## 5. Accessibility review (WCAG 2.1 AA)

**Summary:** 2 actionable issues found and both fixed. 0 critical remain. Automated: axe-core re-run shows **0 contrast, name/role/value or label violations** at 1280 and 390. The remaining axe notes (`page-has-heading-one`, `landmark-unique`) come from the gallery harness (component examples without an h1, with intentionally duplicated example sections), not the page design. The page spec requires a single h1 and unique region labels.

| # | Issue | WCAG | Severity | Fix |
|---|---|---|---|---|
| A1 | "Refresh now" / "Load latest" buttons 36 px tall | 2.5.5 (project rule: 44 px) | 🟡 | 44 px (`eh-btn` default) |
| A2 | "Clear estimate" target 24 px | 2.5.5 / project rule | 🟡 | 44 px min-height |
| — | OSM attribution link 16 px tall | 2.5.5 inline-text exception | n/a | accepted (inline link in a sentence) |

**Contrast (computed, WCAG relative luminance):**

| Element | FG | BG | Ratio | Req. | Pass |
|---|---|---|---|---|---|
| Body / headings | #0f172a | #ffffff | 17.85 | 4.5 | ✅ |
| Labels, timestamps, future steps | #475569 | #ffffff / #f8fafc | 7.58 / 7.24 | 4.5 | ✅ |
| Links, primary nodes | #2563eb | #ffffff | 5.17 | 4.5 | ✅ |
| Button text on primary | #ffffff | #2563eb | 5.17 | 4.5 | ✅ |
| Info / live badge | #0369a1 | #f0f9ff | 5.57 | 4.5 | ✅ |
| "Current" label on halo | #2563eb | #f0f9ff | 4.85 | 4.5 | ✅ |
| Delivered badge | #15803d | #f0fdf4 | 4.79 | 4.5 | ✅ |
| Stale / reconnecting | #b45309 | #fffbeb | 4.84 | 4.5 | ✅ |
| Error text | #b91c1c | #fef2f2 | 5.91 | 4.5 | ✅ |
| Future connector (decorative) | #e2e8f0 | #ffffff | 1.23 | n/a: state also in text | ✅ by 1.4.1 |
| `text-muted`, `success`, `warning`, `accent` raw | — | #ffffff | 2.15–2.56 | 3 / 4.5 | ❌ **banned in delivery UI** |

**Keyboard / focus order (tracking page):** existing header nav (no skip link exists in `CustomerLayout`; adding one is out of scope) → breadcrumb → (h1 receives programmatic focus on load, not in the tab order) → ConnectionStatusIndicator "Refresh now" (when shown) → Overview (no controls) → stepper (no controls) → map: "Explore map" (mobile) / map container (arrows pan, +/- zoom) → zoom in → zoom out → Recenter → attribution link → timeline (no controls) → View order details → Back to Orders → footer. **Visual order = DOM order at every breakpoint** (no CSS `order`).

**Screen reader:** the badge pair reads "Order status: Out for Delivery, Payment status: Paid". The stepper reads "list, 4 items … Out for delivery, current step". The map region reads "Delivery map" + its summary. Live region announcements are defined in the ConnectionStatusIndicator spec. **Not verified with real AT.**

**Reduced motion / zoom:** every transition sits inside `motion-safe`, and the marker jumps instead of sliding. 200% zoom ≈ the 640 px layout: single column, no horizontal scroll (390 px render: `scrollWidth = 390`).

---

## 6. Handoff spec: customer

### 6.1 Order Details integration (`features/orders/OrderDetailsPage.tsx`)

- Add `TrackDeliveryAction` to `.aside`, after `<OrderDocumentsPanel>` and before `.backLink`.
- Visibility: `paymentState === 'PAID' && ['CONFIRMED','PREPARING','OUT_FOR_DELIVERY','DELIVERED'].includes(status)`. The label is "View delivery details" when DELIVERED.
- In the Delivery Address `.delivery` block, add a third line **only when the tracking query is already cached**. Order Details does **not** fetch tracking, which avoids an extra request per view.
- Update `OrderDetailsPage.test.tsx:64` to assert the matrix in the architecture doc's T5-19.

### 6.2 Tracking page layout (`/orders/:orderReference/tracking`)

| Breakpoint | Layout (tokens) |
|---|---|
| < 640 | `.page` padding `spacing-8 spacing-4 spacing-16`; single column, gap `spacing-6`; order: header → Overview → Stepper (vertical) → Map (4/3, ≤18rem) → Timeline → actions (full-width); timeline time above text |
| 640–767 | timeline time column 9rem beside text |
| 768–1023 | card padding `spacing-8`; stepper horizontal; map 16/9 ≤24rem |
| ≥ 1024 | grid `minmax(0,2fr) minmax(20rem,1fr)`, gap `spacing-8`; left: Stepper, Map, Timeline; right (aside): Overview, View order details (outline, full width), Back to Orders |
| ≥ 1536 | map ≤28rem; container max 120rem (existing) |

**Header:** `OrdersBreadcrumb` (Home / Orders / ORD-… / Tracking). The h1 is "Track order {reference}", using the existing h1 clamp, `overflow-wrap:anywhere` and `tabIndex=-1` with focus on first load. `OrderBadges` sit on the right (wrapping under the title below lg). Under the title: "Last updated {time}" in body `color-text-secondary`, plus ConnectionStatusIndicator (04.7).

### 6.3 Data → UI

| UI | Field | Empty / edge |
|---|---|---|
| Stepper | `status`, `timeline[].status/occurredAt` | not rendered for PAYMENT_PENDING/CANCELLED |
| ETA row | `eta.estimatedAt`, `eta.promisedStart/End` | "Not available yet" + promise; DELIVERED → `deliveredAt` |
| Location row | `location`, `serverTime` | none: "Not shared yet"; stale when `serverTime − updatedAt > 30 min` and OUT_FOR_DELIVERY |
| Reference | `trackingReference` | "Assigned when preparation starts" |
| Simulated | `isSimulated` / `location.source` | badge + "Simulated position" |
| Timeline | `timeline[]` ≤ 50 | "No tracking events recorded yet." |

**Long content:** references wrap anywhere. Location labels are 80 characters max and wrap. Timeline copy wraps without truncation. No ellipsis is used on facts.

### 6.4 Loading / error

- First load: a Skeleton shaped like the page (two columns from lg, stepper bar, a map block at the final aspect ratio, 3 timeline rows), so the layout doesn't shift.
- 404/400: the same "Order not found" `EmptyState` as Order Details.
- 5xx/network: `ErrorState` with Retry and "Back to order".
- Refetch failure with data: the Order Details `.notice` pattern + Retry.

### 6.5 Motion

| Element | Trigger | Animation | Duration / easing | Reduced motion |
|---|---|---|---|---|
| Stepper node + connector | status change | background/border colour | `transition-normal` (250ms ease) | instant |
| Timeline new row | 04.7 event | opacity 0→1 (Framer Motion `initial/animate`) | 250ms ease | none |
| Courier marker | new **recorded** location | linear lat/lng interpolation between two stored points | 350ms ease (`transition-slow`) | jump |
| Connection badge | state change | colour | 150ms | instant |
| Skeleton | loading | existing shimmer | existing | existing |

Not allowed: looping pulses on the courier, progress-bar "filling" animations, or interpolation beyond the last recorded point.

---

## 7. Handoff spec: admin (Phase 04 minimum)

Routes: `/admin/deliveries` and `/admin/deliveries/:orderReference`, inside the existing `ProtectedRoute requiredRole="ADMIN"`. A sidebar entry "Deliveries" is added under the existing admin layout. The full dashboard (analytics, bulk operations, courier assignment) is deferred to 05.4/05.5.

| Step | UI | Contract |
|---|---|---|
| Find order | `DataTable`: reference (mono), customer name, Order status badge, Payment badge, Delivery revision, updated; filter Select by status; Pagination | `GET /api/admin/deliveries` |
| Inspect | detail page: badges, eligibility Alert, Overview (admin variant shows coordinates in mono), history table (time, type, from→to, source, actor email, revision, note) | `GET /api/admin/orders/:ref/delivery` |
| Start | primary "Start tracking" (only when allowed) | `POST` |
| Update | AdminDeliveryUpdatePanel → "Review update" → Dialog diff → Confirm | `PATCH` with `expectedRevision` |
| Conflict | error Alert + "Load latest", form values kept | 409 + snapshot |
| Result | success Toast + "Customer sees: {status}, {ETA text}" | response snapshot |
| Simulation (04.7, non-prod) | "Demo tools" section: route Select, Start/Stop, info badge | `POST/DELETE …/simulation` |

Forms follow the existing `AdminForm` layout. Validation runs on blur and submit, using `aria-invalid` + `aria-describedby` error text in `color-error-foreground`.

---

## 8. Frontend module ownership & boundaries per milestone

| Module | 04.5 | 04.6 | 04.7 |
|---|---|---|---|
| `features/delivery/{types,api,presentation}.ts` | ✔ create | extend `map` type | extend event types |
| `DeliveryTrackingPage` + Stepper/Overview/Timeline/StateNotice | ✔ | — | live region, indicator slot |
| `DeliveryMapPanel` | text-summary shell only, **no Leaflet** | ✔ Leaflet lazy chunk | marker interpolation |
| `features/adminDelivery/*` | ✔ list, detail, update | — | Demo tools |
| `realtime/*` | — | — | ✔ |
| `lib/query.ts` keys | ✔ `delivery.*` | — | — |
| `routes/index.tsx` | ✔ 3 routes | — | — |
| `package.json` | none | `leaflet`, `@types/leaflet` | `socket.io-client` |

---

## 9. Refined visual design (v2, 2026-10-31): Principal Architect visual-review revision

**Status: DESIGNED / PROPOSED. No architecture or API contract changed.** The artifact now contains a full-page **Interactive Delivery Tracking Showcase** and renderers shared by every component preview. All demo data is fictional and labelled *Design preview — fictional delivery data*. Prototype controls change only the preview: they call no API and persist nothing.

### 9.1 Composition (customer page)

DOM order: header → **Overview** → Progress → Map → History → Actions. Mobile shows exactly that order, so status and ETA come before the map. From a container width of 64rem, a grid places Progress, Map, History and Actions in the wide column and the sticky **Overview** in the right column (`minmax(0,2fr) minmax(20rem,1fr)`, gap `spacing-8`). On desktop the Overview is therefore first in the tab order while appearing on the right. That is deliberate: the key facts and the copy control come first for assistive technology. All layout uses **container queries** (the page, the overview card and the map each own a container), so the same markup works at the real width and in the prototype's Tablet/Mobile toggle.

### 9.2 DeliveryOverviewCard (04.5)

| Block | Visual | Variants |
|---|---|---|
| Status hero | 56px square icon tile, eyebrow "Delivery status", 24/700 title, one-line description, four-segment progress bar + "Step n of 4 · label" | Confirmed `info` triplet; Preparing `warning`; **Out for delivery on a dark `color-secondary` surface with a `color-primary` tile** (deliberately the most distinct); Delivered `success` |
| ETA focal panel | 40px icon tile (`Calendar`), eyebrow, **28→32px bold date**, `Clock` + "Around 2:00 PM", disclaimer "An estimate, not a guarantee." | set · unavailable (dashed panel, "Not available yet" + the checkout window "Originally estimated …") · delivered ("Delivered · date · time", success) |
| Location panel | `MapPin` tile, eyebrow, label, freshness pill | fresh (success pill, "Recent · updated 6 min ago") · stale (warning panel + "Stale · updated 42 min ago" + "This may not be where your order is now.") · none (dashed "Not shared yet") · before dispatch · delivered ("Live location is switched off after delivery") · simulated ("Simulated position" + a "Simulated demo" pill in the header) |
| Compact info strip | tracking reference (mono) + **Copy** button (44px, `aria-label="Copy tracking reference EH-TRK-…"`), delivery method, latest update | no reference → "Assigned when preparation starts", with no copy button |

Panels sit side by side when the card is at least 34rem wide and stack below that (the card is 20–22rem wide in the desktop aside).

### 9.3 Other components

- **DeliveryProgressStepper (04.5).** An `<ol>` with 40px circular nodes carrying the Lucide stage icon (`PackageCheck`, `Package`, `Truck`, `CircleCheck`). Completed nodes are filled `color-primary` with a green check badge. The current node has a primary ring and a 4px halo. Future nodes are outlined. Each step shows a word state (Completed / Current / Upcoming) and a time **only when recorded**. It is horizontal from a 40rem container and vertical below. `aria-current="step"` marks the current step. Delivered is "final": it turns `color-success-foreground` and is marked both completed and current.
- **DeliveryTimeline (04.5).** A rail with 32px icon nodes. The newest event is filled primary with a "Latest" badge. Each row has a title, a description and a mono time (right-aligned from 40rem). It uses `<ol reversed>` with `<time datetime>`. Empty: "No tracking events recorded yet. Nothing is back-filled for earlier steps." Only DeliveryEvent-backed entries appear.
- **DeliveryMapPanel (04.5 shell, 04.6 map).** A header with freshness and "Simulated demo" pills, the text summary (always present), then the map (16:9, or 4:3 when the card is under 30rem), the legend (hub square; courier dot, hollow and dashed when stale; recorded-position line or **dashed simulated route**; destination pin) and a caption. The map has 44px zoom and recenter controls, always-visible OSM attribution, and an "Explore map" gate below 48rem. In-map text labels are hidden when narrow because the legend carries them. States: normal, stale, simulated, route unavailable, no location, tile error (alert + Retry), delivered. The artwork is illustrative demo geometry.
- **ConnectionStatusIndicator (04.7).** Icon + word pills: `Wifi` "Live updates on" (info), `RefreshCw` "Reconnecting…" (warning), `WifiOff` "Live updates paused" (neutral, plus a banner with a 44px "Refresh now"), `Check` "Back online · up to date" (success). A delivered order shows "Updates stopped (delivered)". Announcements: only paused and restored, plus status and ETA changes, through one polite live region. The prototype prints the text a screen reader would hear.
- **DeliveryStateNotice (04.5, 04.6, 04.7).** Nine states in one visual language (icon tile, title, text, actions): payment pending, not started, cancelled (error top rule), delivered, failed request (Retry), connection unavailable, route unavailable, no ETA, no location. The last three are inline dashed notes.
- **Admin preview (04.5).** Reuses `AdminForm` patterns. Only the next forward status is offered. Location fields appear only for OUT_FOR_DELIVERY. The confirm Dialog has a focus trap, Escape, Cancel/Confirm, and "This can't be undone" for DELIVERED. A "Customer will see" Overview sits beside the form. Confirming changes the preview only.

### 9.4 Token and icon usage

Only existing tokens (see the artifact's `tokens.json`): `color-primary`, `color-primary-light` (progress bars on the dark hero), `color-secondary` and `color-secondary-light` (dark hero), the five semantic triplets, `color-surface` / `color-background` / `color-border`, the text colours, `spacing-1…12`, `shadow-sm` / `shadow-xl` (map controls, dialog), and `radius-full` for circular nodes only (everything else is square). **No new raw values**, and no gradients, glass or large shadows. The v1 delivery aliases are unchanged.

Icons are Lucide: `PackageCheck`, `Package`, `Truck`, `CircleCheck`, `XCircle`, `Hourglass`, `MapPin`, `Warehouse`, `Calendar`, `Clock`, `Copy`, `Check`, `Info`, `AlertTriangle`, `Map`, `Wifi`, `WifiOff`, `RefreshCw`, `FlaskConical`, `ArrowLeft`. The preview inlines Lucide-style glyph paths. Production imports `lucide-react` (already a dependency). `Package` stands in where `OrderStatus` uses `PackageOpen`: in production use the same icon the existing badge uses.

### 9.5 Motion

Everything sits inside `prefers-reduced-motion: no-preference`: node, segment and copy-button colour transitions of 250 ms ease. There are no loops, no truck animation and no fabricated progress. Verified: with reduced motion emulated, the computed transition duration is `0s`.

### 9.6 Visual element → data field (no new backend data)

| Visual element | Field (architecture §5.1) | Task |
|---|---|---|
| Hero title/description/segments, stepper state, badge | `status` | 04.5 |
| Payment badge | `paymentState` | 04.5 |
| ETA focal date/time | `eta.estimatedAt` | 04.5 |
| ETA-unavailable "originally estimated" window | `eta.promisedStart` / `eta.promisedEnd` | 04.5 |
| Location label, freshness pill, stale panel | `location.label`, `location.updatedAt`, `serverTime` (stale = more than 30 min while OUT_FOR_DELIVERY) | 04.5 |
| "Simulated demo" pill, route and caption | `isSimulated`, `location.source` | 04.5 / 04.6 |
| Tracking reference + Copy | `trackingReference` (display only, never a credential) | 04.5 |
| Delivery method | `deliveryMethod` | 04.5 |
| Latest update, "Last updated" | latest `timeline[].occurredAt` or `location.updatedAt` | 04.5 |
| Stepper times | `timeline[]` TRACKING_STARTED / STATUS_CHANGED `occurredAt` | 04.5 |
| Timeline rows | `timeline[]` | 04.5 |
| Map markers, path, legend | `map.origin`, `map.destination`, `map.path`, `map.pathKind` | 04.6 |
| Route-unavailable, tile-error and no-location states | `map.pathKind === 'NONE'`, client tile error, `location === null` | 04.6 |
| Connection pill, banners, live region, toasts | socket state + `delivery:updated` | 04.7 |
| Admin form and diff dialog | `AdminDeliverySnapshot.allowedNextStatus`, PATCH body, `revision` | 04.5 |

04.5 ships the header, Overview, Stepper, Timeline, Notices, a map-panel **text shell**, Actions and the Admin panel. 04.6 adds the map graphic and legend. 04.7 adds the connection indicator, banners, live region, toasts and simulation labelling.

### 9.7 Verification evidence (prototype only, not production QA)

- Playwright (Chromium) screenshots of all 11 previews and the showcase at 1920, 1440, 768, 390 and 640 px (about 200 % zoom). **No horizontal overflow** on any page except the Cover, which is a fixed 960px by the Design System type's contract.
- Interactions exercised: status, ETA, location, simulation, connection and map toggles; the Tablet/Mobile toggle; "Add preview event"; **Copy puts the real reference `EH-TRK-4K9Q2M7XPA` on the clipboard**; admin Review → Escape closes → Confirm updates the preview.
- axe-core 4 (`wcag2a`, `wcag2aa`, `wcag21aa`, `best-practice`) over every preview and 14 showcase states: **0 contrast, name/role/value or label violations**. The only notes are `page-has-heading-one` and `landmark-unique` on the component *gallery* pages (repeated example sections), which the real page does not have.
- Keyboard: a 40-stop Tab sweep showed a visible 2px `color-primary` outline on every control (the one stop without an outline was the document body when Tab wrapped). The Dialog traps Tab and closes on Escape.
- 44px: every control passes. Breadcrumb links were raised from 21px to 44px. The OSM attribution link (16px) is an inline-text link and is accepted.
- **Not done:** NVDA/VoiceOver testing, real-device testing, Figma comparison (deferred), production-app QA.

### 9.8 Prototype limitations

Illustrative map art (not Leaflet or tiles). Static fictional times. The clipboard falls back to "Select and press Ctrl+C" where the browser blocks it. The header is a simplified stand-in for the real `CustomerHeader`. There is no real focus management between pages and no loading skeleton in the showcase (the skeleton spec in §6.4 stands).

## 10. Figma

**FIGMA: DEFERRED TO PHASE 05 BY OWNER DECISION.** Delivery Figma work is intentionally deferred to Phase 05; the Claude interactive artifact and this design handoff are the current design reference. Do not build Figma frames during 04.5–04.7.
