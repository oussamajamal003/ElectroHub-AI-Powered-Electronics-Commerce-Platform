# ElectroHub — TASK 01.5 Responsive Foundation

**Task ID:** 01.5  
**Task Name:** Responsive Foundation  
**Branch:** `feature/responsive-foundation`  
**Phase:** 01 — Design & Frontend Foundation  
**Status:** Implementation Task  
**Primary Authority:** Approved Figma Design responsive/layout frames  
**Supporting Authority:** Figma Make responsive screenshots + existing 01.4 Batch 1–8 implementation  
**Scope:** Customer + Admin responsive foundation  
**Do not merge until:** all completion gates and architect review requirements pass

---

# 1. Objective

Establish the complete responsive foundation for ElectroHub across:

- 📱 Mobile
- 💻 Tablet
- 🖥️ Desktop
- 🖥️ Large Desktop

The implementation must follow the **already-selected Figma responsive evidence exactly** and must build on the existing shared UI foundation completed in **TASK 01.4 / Batches 1–8**.

This task is not a redesign.

The goal is to make the existing ElectroHub customer and admin interfaces responsive while preserving:

- the approved visual language
- existing component APIs
- accessibility
- business logic boundaries
- existing application behavior
- design tokens
- shared component architecture

---

# 2. Critical Authority Rule

The following evidence chain is mandatory:

```text
Figma Design
   │
   ├── Desktop frame
   ├── Tablet frame
   └── Mobile frame
          │
          ↓
Figma Make screenshots
(actual responsive/layout specification)
          │
          ↓
Existing TASK 01.4 Batch 1–8 components
          │
          ↓
TASK 01.5 responsive implementation
          │
          ↓
Localhost exact viewport comparison
          │
          ↓
Final visual QA + tests + CI
```

## Authority hierarchy

1. **Figma Design selected responsive/layout frames — visual authority**
2. **Figma Make screenshots — supporting implementation evidence**
3. **Existing 01.4 components — implementation foundation**
4. Repository SCSS/tokens — implementation mechanism
5. Existing application behavior — must be preserved

Do not replace Figma evidence with assumptions.

Do not invent responsive behavior.

Do not invent breakpoints merely because the repository already contains breakpoint variables.

---

# 3. Mandatory Figma-First Workflow

Before modifying responsive CSS or components:

1. Read `/AGENTS.md`.
2. Read the fixed ElectroHub developer prompt.
3. Read this task.
4. Read all relevant Figma documentation under `docs/assets/figma/`.
5. Read all Markdown files under `docs/02_Design/`.
6. Read:
   - `docs/assets/figma/exports/customer/README.md`
   - `docs/assets/figma/exports/admin/README.md`
   - `docs/assets/figma/exports/Components/README.md`
7. Read the existing 01.4 Verification Plan and final architect/evidence documentation.
8. Inspect the selected Figma frames using Figma MCP.
9. Use:
   - `get_design_context`
   - `get_variable_defs` when token information is required
   - `get_screenshot`
   - `get_metadata`
   - `get_motion_context` where motion/responsive transition behavior is relevant
10. Inspect the corresponding Figma Make screenshots.
11. Inspect the existing 01.4 components before changing them.
12. Compare Figma → Make → repository.
13. Implement only verified responsive transformations.
14. Perform localhost visual verification at the exact selected viewport dimensions.
15. Run all required tests/checks.
16. Inspect the complete git diff.
17. Verify GitHub Actions remotely.
18. Produce the final responsive evidence and architect report.

If Figma MCP cannot access a required frame:

> `NOT VERIFIED`

Do not fabricate dimensions, breakpoints, spacing, component behavior, or missing responsive states.

---

# 4. Selected Figma Responsive Evidence

Use **exactly the responsive evidence already generated below**.

Do not replace these frames with guessed alternatives.

## 4.1 Customer

### Customer — Home / Storefront

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 494 | `199:12231` | 1440×900 | Home |
| Tablet | Frame 498 | `201:12754` | 768×1024 | Home |
| Mobile | Frame 504 | `201:13325` | 390×844 | Home |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=199:12231&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=201:12754&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=201:13325&m=auto&t=LXiqpv5AACaZ00jo-6

Responsive evidence: **VERIFIED**

---

### Customer — Product Listing

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 514 | `202:13854` | 1432×810 | Product Listing |
| Tablet | Frame 517 | `203:14130` | 768×934 | Product Listing |
| Mobile | Frame 522 | `204:14361` | 390×844 | Product Listing |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=202:13854&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=203:14130&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=204:14361&m=auto&t=LXiqpv5AACaZ00jo-6

Responsive evidence: **VERIFIED**

---

### Customer — Product Details

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 483 | `185:6068` | 1851×1757 | Product Details |
| Tablet | N/A | N/A | N/A | N/A |
| Mobile | Frame 489 | `198:11959` | 390×844 | Product Details |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=185:6068&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=198:11959&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet evidence: **NOT VERIFIED**

Do not invent a tablet Product Details design.

---

### Customer — Cart / Checkout

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 525 | `205:14506` | 1432×810 | Cart |
| Tablet | Frame 527 | `205:14871` | 768×934 | Cart |
| Mobile | Frame 529 | `205:15039` | 390×844 | Cart |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=205:14506&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=205:14871&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=205:15039&m=auto&t=LXiqpv5AACaZ00jo-6

Responsive evidence: **VERIFIED**

---

## 4.2 Admin

### Admin — Dashboard

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 539 | `206:15516` | 1204×810 | Admin Dashboard |
| Tablet | Frame 544 | `206:15884` | 580×934 | Admin Dashboard |
| Mobile | Frame 554 | `206:16166` | 390×844 | Admin Dashboard |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:15516&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:15884&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:16166&m=auto&t=LXiqpv5AACaZ00jo-6

Responsive evidence: **VERIFIED**

---

### Admin — Data / Table

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 562 | `206:16557` | 1204×810 | Admin Products |
| Tablet | Frame 565 | `206:16643` | 580×934 | Admin Products |
| Mobile | Frame 573 | `206:17134` | 390×844 | Admin Products |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:16557&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:16643&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:17134&m=auto&t=LXiqpv5AACaZ00jo-6

Responsive evidence: **VERIFIED**

---

### Admin — Form / Create / Edit

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 511 | `193:8586` | 1891×992 | Admin Create Product |
| Tablet | N/A | N/A | N/A | N/A |
| Mobile | N/A | N/A | N/A | N/A |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=193:8586&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet evidence: **NOT VERIFIED**

Mobile evidence: **NOT VERIFIED**

Do not invent responsive form layouts.

---

### Admin — Sidebar / Navigation

| Viewport | Frame | Node ID | Dimensions | Figma Make |
|---|---|---|---|---|
| Desktop | Frame 115 | `206:15807` | 236×810 | Admin Sidebar |
| Tablet | Frame 550 | `206:16061` | 188×934 | Admin Sidebar |
| Mobile | N/A | N/A | N/A | N/A |

Desktop:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:15807&m=auto&t=LXiqpv5AACaZ00jo-6

Tablet:
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?node-id=206:16061&m=auto&t=LXiqpv5AACaZ00jo-6

Mobile evidence: **NOT VERIFIED**

Do not fabricate a mobile sidebar frame.

---

# 5. Figma Make Screenshot Evidence

The repository already contains Figma Make exports.

Perform a **full recursive scan** of:

```text
docs/assets/figma/exports/admin/screenshots/
docs/assets/figma/exports/customer/screenshots/
```

The provided screenshot inventories show that these folders contain actual customer and admin screen captures, including multiple naming variants and generated screenshots.

## Admin evidence inventory includes screens such as

- Admin login
- Dashboard
- Analytics
- Categories
- Add category
- Edit category
- Products
- Create Product
- Edit product
- Delete product
- Customers
- Orders
- Order details
- Inventory
- Delivery
- Settings

Examples visible in the existing admin screenshot evidence:

```text
Add category.png
Admin login.png
Analytics page.png
Analytics_page.png
Categories page.png
Create Product.png
Customers page.png
Dashboard page.png
Dashboard_page.png
Delete product.png
Delivery page.png
Edit category.png
Edit product.png
Inventory page.png
Inventory_page.png
Order details page.png
Order_details_page.png
Orders page.png
products page.png
products_page.png
Settings page.png
```

## Customer evidence inventory includes screens such as

- Account
- Cart
- Checkout
- Delivery
- Footer
- Home
- Login
- My profile
- Order details
- Orders
- OTP verification
- Product details
- Products
- Register
- Search
- Wishlist

Examples visible in the existing customer screenshot evidence:

```text
Account page.png
Account_page.png
Cart page.png
Checkout page.png
Checkout_page.png
Checkoutpage.png
Delivery page.png
Deliverypage.png
Footer.png
Home page.png
Home.png
Home_page.png
homepage.png
Home-page.png
login.png
My profile page.png
Order details page.png
Orders page.png
OTP Verification.png
product details page.png
Product_details_page.png
product-details-page.png
Products page.png
products_page.png
Productspage.png
products-page.png
Register.png
Search page.png
search_page.png
Searchpage.png
Wishlist page.png
```

### Important

Do not treat duplicate-looking filenames as duplicate evidence without opening/inspecting them.

Some files may represent different exports, viewport sizes, or versions.

Use the actual image dimensions and visual content to determine whether two screenshots represent different responsive states.

Read the README files in both folders before deciding which screenshots are relevant.

---

# 6. Responsive Verification Scope

The implementation must establish the responsive foundation for:

## Customer

- Header
- Navigation
- Home/storefront
- Hero/content sections
- Product grids
- Product cards
- Product images
- Product gallery
- Product details
- Search
- Filters
- Cart
- Checkout
- Account/profile
- Orders
- Order details
- Wishlist where applicable
- Footer
- Dialogs/drawers where applicable
- Page containers
- Gutters
- Spacing
- Typography scaling

## Admin

- Header/top bar
- Sidebar
- Navigation
- Dashboard
- Stats cards
- Charts
- Data tables
- Filter bars
- Admin forms
- Create/edit layouts
- Product management
- Categories
- Orders
- Customers
- Inventory
- Analytics
- Delivery
- Settings
- Dialogs/drawers where applicable
- Page containers
- Gutters
- Spacing

---

# 7. Responsive Transformation Requirements

Inspect the selected Figma evidence and explicitly document what changes between viewports.

At minimum inspect:

### Desktop → Tablet

- container width
- page gutters
- header sizing
- navigation
- sidebar width
- grid column count
- card width
- table behavior
- form columns
- spacing
- typography
- controls
- dialog/drawer sizing

### Tablet → Mobile

- navigation transformation
- sidebar transformation
- grid stacking
- card width
- table transformation/overflow
- form stacking
- dialog/drawer behavior
- footer stacking
- horizontal spacing
- typography
- button sizing
- image/gallery layout
- content ordering

---

# 8. Do Not Invent Breakpoints

This rule is mandatory.

Do not do:

```text
Repository has 768px breakpoint
↓
Therefore Figma tablet = 768px
```

Instead:

```text
Figma shows a layout transformation
↓
Measure/inspect the actual Figma states
↓
Determine the required responsive rule
↓
Inspect repository breakpoint tokens
↓
Select the repository breakpoint/token that can reproduce it
↓
Implement
```

The breakpoint is an implementation mechanism.

The Figma responsive transformation is the requirement.

If an exact Figma breakpoint cannot be established, document the implementation decision and why the selected repository breakpoint is the closest safe mechanism.

Do not silently change global breakpoints without evidence.

---

# 9. Large Desktop Requirement

TASK 01.5 must verify:

- Mobile
- Tablet
- Desktop
- Large Desktop

However, the **selected Figma evidence supplied for this task explicitly contains Desktop, Tablet, and Mobile states only for the verified responsive frame groups**.

Therefore:

- Do not invent a Large Desktop Figma frame.
- Do not claim Large Desktop is Figma-verified unless actual Figma evidence exists.
- Use the approved desktop design as the visual authority for large-desktop behavior.
- Inspect repository max-width/container rules.
- Verify that large desktop does not introduce:
  - stretched content
  - excessive line lengths
  - broken grids
  - oversized controls
  - incorrect alignment
  - unwanted horizontal overflow
- Record the exact large-desktop viewport used for implementation QA.
- If Figma has no explicit large-desktop evidence, report:

```text
Large Desktop Figma evidence: NOT VERIFIED
Large Desktop implementation QA: VERIFIED / NOT VERIFIED
```

Do not convert implementation QA into Figma approval.

---

# 10. Styles / SCSS Foundation

The responsive foundation must use the existing styles architecture.

Before changing tokens:

1. Inspect the actual `_variables.scss`.
2. Inspect `_mixins.scss`.
3. Inspect global reset/typography files.
4. Inspect all relevant page/component module SCSS.
5. Determine whether an existing token can implement the Figma requirement.
6. Add a new token only when the responsive design establishes a genuinely reusable value.

Do not create duplicate token systems.

Do not introduce arbitrary CSS custom-property token systems.

Do not hardcode repeated responsive values when a repository token is appropriate.

Responsive values should be centralized when they are genuinely shared.

Examples:

```scss
$breakpoint-sm
$breakpoint-md
$breakpoint-lg
$breakpoint-xl
$container-max-width
$page-gutter
```

Use the **actual repository token names and values** after inspecting the codebase.

Do not assume the above variables exist.

---

# 11. SCSS Requirements

Responsive styling must remain consistent with the 01.4 architecture:

- SCSS
- CSS Modules
- existing variables
- existing mixins
- no new CSS framework
- no Tailwind migration
- no inline responsive styling
- no duplicated global style systems

Prefer:

```scss
@media (max-width: ...) {
  ...
}
```

or existing responsive mixins where those already form part of the repository architecture.

Do not introduce a second breakpoint abstraction unless architecture review explicitly requires it.

---

# 12. Existing 01.4 Components

The 01.5 task must build on the components generated/refined during the eight 01.4 batches.

Relevant shared components include:

- Button
- IconButton
- Input
- Textarea
- Select
- Checkbox
- Radio
- Switch
- Badge
- Avatar
- Tooltip
- Header
- Sidebar
- Breadcrumb
- Tabs
- Pagination
- Dropdown
- Mobile Navigation
- Alert
- Toast
- Modal
- Drawer
- Dialog
- Spinner
- Skeleton
- Error State
- Empty State
- Price
- Rating
- Quantity Selector
- Cart Item
- Order Status
- Payment Status
- Product Card
- Product Image
- Product Gallery
- Data Table
- Filter Bar
- Stats Card
- Chart Container
- Admin Form
- Status Badge

Before changing any of these:

- inspect current implementation
- inspect consumers/imports
- inspect props/API
- inspect tests
- determine whether the responsive requirement belongs in the component or its parent layout
- preserve backwards compatibility unless a documented architectural change is required

Do not rewrite working shared components merely to move page-level responsive logic into them.

---

# 13. Component Boundary Rule

Responsive behavior must preserve the established architecture:

```text
UI component
    ↓
props / callbacks / events
    ↓
page/application logic
    ↓
service/API layer
```

Shared UI components must NOT directly perform:

- API calls
- database calls
- payment operations
- authentication operations
- business workflows

Responsive changes must not introduce:

```text
Component → API
Component → database
Component → Stripe
Component → business service
```

Presentation-only components remain presentation-only.

---

# 14. Responsive Component Responsibilities

## Header

Verify:

- desktop header structure
- tablet structure
- mobile structure
- navigation collapse
- logo sizing
- search behavior
- action icon spacing
- user/cart controls
- touch target size

## Sidebar

Verify:

- desktop width
- tablet width
- collapsed behavior
- visibility
- content spacing
- icon/text behavior
- active state
- scroll behavior

Do not invent mobile sidebar behavior because no mobile Sidebar Figma frame is supplied.

If the existing application requires mobile navigation, use the selected Figma Make/customer/admin evidence only where it actually supports the behavior.

## Navigation

Verify:

- desktop links
- tablet links
- mobile navigation
- menu trigger
- overlay/drawer behavior
- keyboard accessibility
- focus behavior

## Product Grid

Determine actual Figma column transformations.

Do not assume:

```text
Desktop = 4
Tablet = 2
Mobile = 1
```

unless the selected Figma evidence actually shows that.

Record the verified transformation.

## Product Card

Verify:

- width
- image ratio
- content wrapping
- price layout
- actions
- title wrapping
- spacing
- mobile stacking

## Tables

Determine whether Figma uses:

- horizontal scrolling
- condensed columns
- transformed rows
- hidden lower-priority columns
- alternate mobile representation

Do not invent a card conversion if Figma shows horizontal scrolling.

## Forms

Determine actual:

- one-column layout
- two-column layout
- field width
- button arrangement
- label wrapping
- spacing
- responsive grouping

For Admin Create Product, tablet/mobile evidence is currently **NOT VERIFIED**.

Do not fabricate those designs.

## Dialog / Drawer / Modal

Verify:

- width
- max-width
- viewport gutters
- mobile width
- height
- overflow
- close control
- focus trap
- keyboard behavior

## Footer

Verify:

- column count
- stacking
- alignment
- spacing
- link wrapping

---

# 15. Customer Page Requirements

Implement and verify responsive behavior for the selected customer evidence.

## Home

Evidence:

- Frame 494 — Desktop
- Frame 498 — Tablet
- Frame 504 — Mobile

Verify:

- header
- hero
- product sections
- cards
- grid
- page gutters
- footer
- responsive typography
- mobile navigation

## Product Listing

Evidence:

- Frame 514 — Desktop
- Frame 517 — Tablet
- Frame 522 — Mobile

Verify:

- filters
- filter bar
- product grid
- card dimensions
- pagination
- spacing
- search/navigation
- mobile transformation

## Product Details

Evidence:

- Frame 483 — Desktop
- Frame 489 — Mobile
- Tablet: NOT VERIFIED

Verify:

- gallery
- product information
- price
- rating
- quantity selector
- CTA controls
- mobile stacking

Do not invent tablet-specific layout requirements.

## Cart

Evidence:

- Frame 525 — Desktop
- Frame 527 — Tablet
- Frame 529 — Mobile

Verify:

- cart item
- quantity selector
- price
- totals
- checkout CTA
- responsive stacking
- page gutters

---

# 16. Admin Page Requirements

## Dashboard

Evidence:

- Frame 539 — Desktop
- Frame 544 — Tablet
- Frame 554 — Mobile

Verify:

- sidebar
- header
- stats cards
- charts
- content sections
- responsive columns
- spacing
- navigation

## Products / Data Table

Evidence:

- Frame 562 — Desktop
- Frame 565 — Tablet
- Frame 573 — Mobile

Verify:

- table
- filters
- pagination
- actions
- columns
- overflow/transformation
- responsive controls

## Create Product

Evidence:

- Frame 511 — Desktop
- Tablet: NOT VERIFIED
- Mobile: NOT VERIFIED

Verify desktop implementation carefully.

Do not fabricate tablet/mobile Figma requirements.

If responsive implementation is needed because the application must support those viewports, document the implementation as engineering behavior rather than claiming it is Figma-approved.

## Sidebar

Evidence:

- Frame 115 — Desktop
- Frame 550 — Tablet
- Mobile: NOT VERIFIED

Verify:

- width
- spacing
- navigation
- active state
- icon alignment

Do not fabricate a mobile sidebar Figma design.

---

# 17. Page Container Foundation

Establish a consistent responsive page-container strategy.

Inspect Figma for:

- desktop maximum content width
- tablet gutters
- mobile gutters
- alignment with headers
- alignment with grids/tables/forms
- large desktop behavior

Do not independently invent different page gutters for every page.

If the same Figma pattern repeats, centralize it.

If pages intentionally differ, document why.

---

# 18. Responsive Typography

Inspect Figma at each verified viewport.

Check:

- heading sizes
- body sizes
- labels
- prices
- navigation text
- metadata
- line heights
- wrapping

Do not create arbitrary typography breakpoints.

Do not change the global typography scale without evidence.

Preserve Poppins UI typography and JetBrains Mono data typography established in 01.4.

---

# 19. Responsive Spacing

Audit:

- page gutters
- section spacing
- card gaps
- grid gaps
- header padding
- navigation gaps
- form gaps
- table padding
- footer spacing

Map repeated values to repository SCSS tokens where appropriate.

Do not silently change global tokens because one component appears different.

---

# 20. Responsive Images

Verify:

- aspect ratios
- object-fit
- gallery behavior
- product image dimensions
- card image dimensions
- mobile image sizing

Avoid layout shift where possible.

Do not distort product images.

---

# 21. Overflow and Stability

At all target viewports, verify:

- no unintended horizontal page scrolling
- no clipped text
- no clipped buttons
- no broken cards
- no overflowing tables
- no viewport-width elements exceeding the viewport
- no fixed-width layout causing mobile overflow
- no images overflowing containers
- no absolute-positioned elements escaping their intended bounds

Where horizontal table scrolling is explicitly shown/designed, contain it within the table region rather than creating page-level horizontal scrolling.

---

# 22. Accessibility

Responsive implementation must preserve accessibility.

Verify:

- keyboard navigation
- visible focus
- focus order
- touch target sizes
- accessible labels
- menu semantics
- dialog semantics
- drawer semantics
- no inaccessible mobile-only controls
- no hidden content remaining keyboard-focusable
- reduced-motion behavior from 01.4 remains intact

Do not use CSS-only hiding in a way that creates accessibility regressions.

---

# 23. Performance

Avoid responsive implementation that causes unnecessary runtime work.

Do not:

- render separate complete desktop/mobile application trees without need
- duplicate large page structures
- add resize listeners when CSS can solve the requirement
- introduce unnecessary layout measurement
- add expensive animation
- load desktop-only assets unnecessarily on mobile when avoidable

Prefer CSS media queries for pure layout changes.

Use JavaScript media-query logic only when behavior genuinely differs and CSS cannot implement it.

---

# 24. Routing / API Compatibility

Responsive work must not change:

- routes
- API endpoints
- request payloads
- response handling
- authentication behavior
- Stripe integration
- business logic
- database schema

Unless a separate requirement explicitly authorizes such a change.

Review all changed components for API compatibility.

---

# 25. Required Repository Audit Before Implementation

Inspect:

```text
apps/frontend/
apps/backend/
apps/ai/
docs/assets/figma/
docs/02_Design/
```

Inspect especially:

```text
apps/frontend/src/styles/
apps/frontend/src/components/
apps/frontend/src/pages/
apps/frontend/src/layouts/
```

Use the actual repository structure.

Do not assume paths exist.

Find all current responsive styles and identify:

- duplicated breakpoints
- hardcoded viewport widths
- fixed pixel widths
- fixed grid columns
- overflow bugs
- absolute positioning
- inline styles
- component-specific media queries
- duplicated container rules
- conflicting responsive rules

---

# 26. Responsive Architecture

The preferred architecture is:

```text
Global responsive foundation
        │
        ├── breakpoints
        ├── container rules
        ├── responsive spacing
        ├── responsive typography where verified
        └── shared layout mixins
                 │
                 ↓
        Shared 01.4 components
                 │
                 ↓
        Customer layouts/pages
                 │
                 ↓
        Admin layouts/pages
```

Avoid:

```text
Every page
   └── its own unrelated breakpoint system
```

Avoid:

```text
Component A → breakpoint 768
Component B → breakpoint 767
Component C → breakpoint 760
```

unless Figma evidence genuinely requires distinct behavior.

---

# 27. Required Responsive Matrix

Create and maintain a matrix like this during implementation:

| Area | Mobile | Tablet | Desktop | Large Desktop | Figma Evidence | Implementation |
|---|---|---|---|---|---|---|
| Customer Header | | | | | | |
| Customer Navigation | | | | | | |
| Home | | | | | | |
| Product Grid | | | | | | |
| Product Card | | | | | | |
| Product Details | | | | | | |
| Cart | | | | | | |
| Checkout | | | | | | |
| Footer | | | | | | |
| Admin Header | | | | | | |
| Admin Sidebar | | | | | | |
| Admin Dashboard | | | | | | |
| Admin Table | | | | | | |
| Admin Form | | | | | | |
| Admin Navigation | | | | | | |

Use:

- `VERIFIED`
- `NOT VERIFIED`
- `IMPLEMENTED`
- `NOT IMPLEMENTED`
- `N/A`

Do not mark Figma evidence `VERIFIED` unless actual evidence exists.

---

# 28. Exact Viewport QA

At minimum, perform visual QA at:

## Customer

- 390×844
- 768×1024
- 1432×810 or 1440×900 according to selected frame
- large desktop engineering QA viewport

## Admin

- 390×844
- 580×934
- 1204×810
- large desktop engineering QA viewport

For selected frames whose dimensions differ, use the **exact Figma dimensions** for comparison.

Do not resize the Figma screenshot and claim exact viewport verification.

---

# 29. Visual QA Procedure

For every verified responsive page:

1. Open Figma Design frame.
2. Capture/inspect Figma screenshot.
3. Open corresponding Figma Make screenshot.
4. Run the application locally.
5. Set browser viewport to exact Figma dimensions.
6. Capture implementation screenshot.
7. Compare:
   - page container
   - header
   - navigation
   - sidebar
   - grids
   - cards
   - tables
   - forms
   - buttons
   - typography
   - spacing
   - colors
   - borders
   - radii
   - image ratios
   - overflow
8. Record discrepancies.
9. Fix discrepancies.
10. Repeat until acceptable.

---

# 30. Figma ↔ Make Reconciliation

If Figma Design and Figma Make differ:

1. Figma Design remains visual authority.
2. Make is supporting evidence.
3. Do not silently choose the Make implementation.
4. Record the discrepancy.
5. Determine whether the difference is:
   - generated implementation artifact
   - screenshot/version difference
   - intentional behavior
   - unresolved design discrepancy

Document unresolved discrepancies as:

```text
TOKEN DISCREPANCY
LAYOUT DISCREPANCY
RESPONSIVE DISCREPANCY
NOT VERIFIED
```

---

# 31. Documentation Requirements

Update responsive documentation where appropriate.

At minimum ensure documentation covers:

- responsive strategy
- verified viewport evidence
- breakpoint mapping
- container strategy
- mobile navigation
- sidebar behavior
- grid transformations
- table behavior
- form behavior
- large desktop strategy
- accessibility considerations
- known NOT VERIFIED states

Do not document invented behavior as approved design.

---

# 32. Required Evidence Files

Create/update the appropriate responsive evidence documentation under the existing Figma asset/documentation structure.

Recommended structure:

```text
docs/assets/figma/
├── FIGMA.md
├── FIGMA_IMPLEMENTATION_RULES.md
├── FIGMA_REFERENCES.md
└── exports/
    ├── Components/
    ├── admin/
    │   ├── README.md
    │   └── screenshots/
    └── customer/
        ├── README.md
        └── screenshots/
```

Do not create legacy structures such as:

```text
Layouts/
Foundation/
screens/
responsive/
```

unless the existing repository architecture explicitly requires them.

Responsive evidence belongs with the relevant customer/admin/Components evidence structure.

---

# 33. Responsive Evidence Report

Create a final report containing:

## Figma Evidence

For every selected frame:

- area
- page
- frame
- node ID
- viewport
- dimensions
- Figma URL
- corresponding Make screenshot
- verified/not verified

## Responsive Transformation

For every page:

```text
Desktop:
...

Tablet:
...

Mobile:
...

Large Desktop:
...
```

## Token Mapping

Document:

```text
Figma requirement
        ↓
Repository SCSS token/mixin
        ↓
Implementation
```

Do not claim exact mapping if values differ.

## Discrepancies

List every unresolved discrepancy.

## Visual QA

Include:

- Figma screenshot reference
- Make screenshot reference
- localhost screenshot
- viewport
- result

---

# 34. Tests

Run independently from Antigravity claims.

Required commands:

```bash
npm run test --workspace=@electrohub/frontend -- --run
npm run typecheck --workspace=@electrohub/frontend
npm run lint --workspace=@electrohub/frontend
npm run build --workspace=@electrohub/frontend
```

If the responsive task changes other workspaces, run their relevant checks as well.

Also run the repository's established CI/security checks where applicable.

---

# 35. Test Requirements

Add/update tests for responsive behavior only where behavior requires JavaScript logic.

Do not write brittle tests for CSS media queries that are better verified through visual QA.

Test behavior such as:

- mobile navigation open/close
- sidebar collapse/expand
- drawer behavior
- responsive menu accessibility
- conditional responsive rendering if any
- keyboard behavior
- focus behavior

Pure CSS layout transformations should primarily be verified through exact viewport visual QA.

---

# 36. Git Diff Review

Before completion:

```bash
git status
git diff
git diff --stat
```

Review:

- all modified SCSS
- all modified components
- all modified pages/layouts
- all documentation
- all screenshots/evidence
- package changes
- lockfile changes
- accidental files

Reject:

- generated junk
- unrelated refactors
- debugging code
- console logs
- secrets
- unrelated dependency changes
- duplicate responsive systems

---

# 37. Security Review

Responsive work must not introduce:

- exposed secrets
- client-side credentials
- unsafe HTML
- new attack surfaces
- insecure dynamic URLs
- bypassed authentication
- bypassed authorization
- sensitive information in responsive-only UI

Admin responsive views must retain the same authorization behavior as desktop views.

---

# 38. Database Migration Review

Expected result:

```text
NO DATABASE MIGRATION
```

If database files are modified, the task is no longer a pure responsive foundation change and must be explicitly justified and reviewed.

---

# 39. API Compatibility Review

Expected result:

```text
NO API CONTRACT CHANGE
```

Responsive components must continue using existing props, callbacks, services, and API contracts.

Any API change requires explicit documentation and architect review.

---

# 40. Performance Review

Verify:

- no duplicate application trees without need
- no unnecessary resize observers
- no unnecessary window listeners
- no layout thrashing
- no excessive animation
- no mobile-only performance regression
- no large asset loading caused by responsive implementation
- no unnecessary React rerenders introduced

---

# 41. Completion Criteria

TASK 01.5 is complete only when all applicable criteria pass.

### Design

- [ ] Figma design is approved.
- [ ] Selected responsive Figma evidence is inspected using Figma MCP.
- [ ] Design system is documented.
- [ ] Figma Design remains visual authority.
- [ ] Figma Make screenshots are reconciled as supporting evidence.

### Shared Foundation

- [ ] Existing 01.4 shared UI primitives are preserved and reused.
- [ ] Responsive styles follow the existing SCSS architecture.
- [ ] No duplicate breakpoint/token system is introduced.
- [ ] Token values are based on actual repository definitions.
- [ ] Responsive layout rules are documented.

### Responsive

- [ ] Mobile verified.
- [ ] Tablet verified where Figma evidence exists.
- [ ] Desktop verified.
- [ ] Large desktop engineering QA performed.
- [ ] Large desktop is not falsely presented as Figma-verified when no explicit evidence exists.
- [ ] Customer responsive foundation established.
- [ ] Admin responsive foundation established.
- [ ] Header responsive behavior implemented.
- [ ] Navigation responsive behavior implemented.
- [ ] Sidebar behavior implemented only where supported by evidence.
- [ ] Product grids respond correctly.
- [ ] Cards respond correctly.
- [ ] Tables behave correctly.
- [ ] Forms respond correctly where evidence exists.
- [ ] Dialog/drawer behavior is responsive.
- [ ] Footer responds correctly.
- [ ] Containers/gutters are consistent.
- [ ] No unintended horizontal overflow exists.

### Quality

- [ ] Accessibility preserved.
- [ ] Reduced motion behavior preserved.
- [ ] No business logic moved into shared UI.
- [ ] No API contract changes.
- [ ] No database migration.
- [ ] No secrets/security regression.
- [ ] No unnecessary performance regression.
- [ ] No unrelated refactoring.

### Verification

- [ ] Tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] Git diff reviewed.
- [ ] GitHub Actions passes remotely.
- [ ] Final responsive evidence is documented.
- [ ] Architect review completed.
- [ ] Score is ≥ 90/100.
- [ ] Decision is `APPROVE`.

---

# 42. Definition of Done

The task is **DONE** only when:

```text
Figma inspected
      ↓
Responsive evidence verified
      ↓
Make screenshots inspected
      ↓
01.4 components audited
      ↓
Responsive SCSS foundation implemented
      ↓
Customer pages responsive
      ↓
Admin pages responsive
      ↓
Mobile QA
      ↓
Tablet QA
      ↓
Desktop QA
      ↓
Large Desktop engineering QA
      ↓
Accessibility QA
      ↓
Tests
      ↓
Typecheck
      ↓
Lint
      ↓
Build
      ↓
Git diff review
      ↓
Remote GitHub CI
      ↓
Architect review
      ↓
APPROVE
```

---

# 43. Architect Review Requirements

The final implementation summary must include:

## 1. Implementation Summary

Explain exactly what changed.

## 2. Files Changed

List all files.

## 3. Figma Evidence

List every selected frame inspected.

## 4. Make Evidence

List every relevant screenshot inspected.

## 5. Responsive Matrix

Provide the completed responsive matrix.

## 6. Token Mapping

Show Figma → SCSS mapping.

## 7. Breakpoint Decisions

Explain every breakpoint decision.

## 8. NOT VERIFIED Items

Explicitly list:

- Customer Product Details tablet
- Admin Create Product tablet/mobile
- Admin Sidebar mobile
- any other missing Figma evidence
- Large Desktop Figma evidence if no explicit frame exists

## 9. Visual QA

Provide exact viewport evidence.

## 10. Tests

Provide actual command results.

## 11. CI

Provide:

- workflow
- run ID
- commit SHA
- job results

Do not say "CI passed" without evidence.

## 12. Git Diff

Provide summary and confirm no unrelated changes.

## 13. Security

Provide security review result.

## 14. API Compatibility

Provide API compatibility result.

## 15. Database

Provide migration result.

## 16. Performance

Provide performance review.

## 17. Final Architect Decision

Use exactly one:

```text
✅ APPROVE
⚠ REQUEST CHANGES
❌ REJECT
```

Include score:

```text
Score: XX/100
Decision: ...
```

---

# 44. Final Architect Scoring

Score out of 100:

| Category | Points |
|---|---:|
| Figma evidence accuracy | 15 |
| Responsive architecture | 15 |
| Customer implementation | 15 |
| Admin implementation | 15 |
| SCSS/token consistency | 10 |
| Visual fidelity | 10 |
| Accessibility | 5 |
| Tests/typecheck/lint/build | 5 |
| CI verification | 5 |
| Documentation/evidence | 5 |
| **Total** | **100** |

### Decision thresholds

```text
90–100 → ✅ APPROVE
75–89  → ⚠ REQUEST CHANGES
0–74   → ❌ REJECT
```

A passing build alone is never sufficient for approval.

---

# 45. Non-Negotiable Rules

1. Never guess Figma behavior.
2. Never invent missing responsive frames.
3. Never invent breakpoint values from repository names.
4. Never claim Figma verification without inspecting the frame.
5. Never claim CI passed without remote evidence.
6. Never silently replace Figma values with repository tokens when they differ.
7. Never silently change global design tokens for a local responsive issue.
8. Never introduce a second responsive system.
9. Never move business logic into shared UI.
10. Never change API contracts for responsive styling.
11. Never modify database schema for responsive styling.
12. Never add unrelated refactors.
13. Never mark missing evidence as verified.
14. Preserve accessibility.
15. Preserve reduced-motion behavior.
16. Use exact viewport dimensions for visual comparison.
17. Inspect all relevant Make screenshots recursively.
18. Read both customer and admin screenshot READMEs.
19. Read all relevant design documentation again.
20. Review the complete diff before declaring completion.

---

# 46. Expected Final Result

The final ElectroHub frontend should behave as a coherent responsive system:

```text
                  ELECTROHUB
                       │
          ┌────────────┴────────────┐
          │                         │
       CUSTOMER                    ADMIN
          │                         │
   ┌──────┼──────┐           ┌──────┼──────┐
   │      │      │           │      │      │
Mobile  Tablet Desktop      Mobile Tablet Desktop
   │      │      │           │      │      │
   └──────┴──────┘           └──────┴──────┘
          │                         │
          └──────────┬──────────────┘
                     │
               Large Desktop
             engineering QA
```

The responsive foundation must feel like **one system**, not a collection of page-specific media-query patches.

---

# 47. Final Verification Statement

The implementer must finish with a statement in this form:

```text
TASK 01.5 RESPONSIVE FOUNDATION — FINAL VERIFICATION

Branch:
feature/responsive-foundation

Figma Design:
INSPECTED / NOT VERIFIED

Figma Make:
INSPECTED / NOT VERIFIED

Customer:
Mobile:
Tablet:
Desktop:
Large Desktop:

Admin:
Mobile:
Tablet:
Desktop:
Large Desktop:

Responsive foundation:
PASS / FAIL

SCSS/token architecture:
PASS / FAIL

Accessibility:
PASS / FAIL

Tests:
PASS / FAIL

Typecheck:
PASS / FAIL

Lint:
PASS / FAIL

Build:
PASS / FAIL

GitHub CI:
PASS / FAIL

Security:
PASS / FAIL

API compatibility:
PASS / FAIL

Database migrations:
NONE / REVIEW REQUIRED

Performance:
PASS / FAIL

Visual QA:
PASS / FAIL

NOT VERIFIED items:
...

Final score:
XX/100

Architect decision:
✅ APPROVE / ⚠ REQUEST CHANGES / ❌ REJECT
```

---

# Appendix A — Selected Evidence Summary

## Customer

| Area | Desktop | Tablet | Mobile |
|---|---|---|---|
| Home / Storefront | Frame 494 — `199:12231` — 1440×900 | Frame 498 — `201:12754` — 768×1024 | Frame 504 — `201:13325` — 390×844 |
| Product Listing | Frame 514 — `202:13854` — 1432×810 | Frame 517 — `203:14130` — 768×934 | Frame 522 — `204:14361` — 390×844 |
| Product Details | Frame 483 — `185:6068` — 1851×1757 | NOT VERIFIED | Frame 489 — `198:11959` — 390×844 |
| Cart / Checkout | Frame 525 — `205:14506` — 1432×810 | Frame 527 — `205:14871` — 768×934 | Frame 529 — `205:15039` — 390×844 |

## Admin

| Area | Desktop | Tablet | Mobile |
|---|---|---|---|
| Dashboard | Frame 539 — `206:15516` — 1204×810 | Frame 544 — `206:15884` — 580×934 | Frame 554 — `206:16166` — 390×844 |
| Data / Table | Frame 562 — `206:16557` — 1204×810 | Frame 565 — `206:16643` — 580×934 | Frame 573 — `206:17134` — 390×844 |
| Form / Create / Edit | Frame 511 — `193:8586` — 1891×992 | NOT VERIFIED | NOT VERIFIED |
| Sidebar / Navigation | Frame 115 — `206:15807` — 236×810 | Frame 550 — `206:16061` — 188×934 | NOT VERIFIED |

---

# Appendix B — Existing Screenshot Evidence Locations

```text
docs/assets/figma/exports/admin/screenshots/
docs/assets/figma/exports/customer/screenshots/
```

The screenshot evidence must be scanned recursively.

Do not rely only on the visible filenames listed in this task.

Inspect actual image dimensions and contents.

---

# Appendix C — Figma Make Evidence Principle

Use the Figma Make screenshots as the cleanest supporting implementation evidence where they show the same page/component across viewport sizes.

However:

```text
Figma Design
    =
visual authority

Figma Make
    =
supporting responsive implementation evidence
```

If they disagree, document the discrepancy rather than silently choosing one.

---

# Appendix D — Responsive Design Acceptance Checklist

### Customer

- [ ] Home desktop matches Frame 494
- [ ] Home tablet matches Frame 498
- [ ] Home mobile matches Frame 504
- [ ] Product Listing desktop matches Frame 514
- [ ] Product Listing tablet matches Frame 517
- [ ] Product Listing mobile matches Frame 522
- [ ] Product Details desktop matches Frame 483
- [ ] Product Details mobile matches Frame 489
- [ ] Product Details tablet explicitly marked NOT VERIFIED
- [ ] Cart desktop matches Frame 525
- [ ] Cart tablet matches Frame 527
- [ ] Cart mobile matches Frame 529

### Admin

- [ ] Dashboard desktop matches Frame 539
- [ ] Dashboard tablet matches Frame 544
- [ ] Dashboard mobile matches Frame 554
- [ ] Products/Table desktop matches Frame 562
- [ ] Products/Table tablet matches Frame 565
- [ ] Products/Table mobile matches Frame 573
- [ ] Create Product desktop matches Frame 511
- [ ] Create Product tablet explicitly marked NOT VERIFIED
- [ ] Create Product mobile explicitly marked NOT VERIFIED
- [ ] Sidebar desktop matches Frame 115
- [ ] Sidebar tablet matches Frame 550
- [ ] Sidebar mobile explicitly marked NOT VERIFIED

### Global

- [ ] Header responsive
- [ ] Navigation responsive
- [ ] Sidebar behavior verified only from available evidence
- [ ] Product grids responsive
- [ ] Cards responsive
- [ ] Tables responsive
- [ ] Forms responsive where evidence exists
- [ ] Dialogs/drawers responsive
- [ ] Footer responsive
- [ ] Containers responsive
- [ ] Gutters responsive
- [ ] Typography responsive
- [ ] No horizontal overflow
- [ ] Accessibility preserved
- [ ] Large desktop engineering QA completed
- [ ] No unverified claim presented as Figma-approved

---

# End of TASK 01.5
