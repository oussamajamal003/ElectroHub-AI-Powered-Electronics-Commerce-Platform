# ElectroHub — TASK 01.4 Shared Components
## FINAL TASK SPECIFICATION — BATCHES 1–8 + DESIGN FOUNDATION / TOKEN CONSOLIDATION

**Status:** Final post-batch task specification  
**Scope:** Complete shared UI foundation, Batches 1–8, and final design-token consolidation  
**Workflow:** Figma-first, evidence-driven, batch-controlled implementation


## 1. FINAL TASK SCOPE

TASK 01.4 is now the complete ElectroHub shared UI foundation implemented through eight controlled batches plus a final Design Foundation / Token Consolidation pass.

### Batch 1 — Core Controls
- Button
- IconButton
- Input
- Textarea
- Select

### Batch 2 — Form / Feedback Controls
- Checkbox
- Radio
- Switch
- Badge
- Avatar
- Tooltip

### Batch 3 — Navigation
- Header
- Sidebar
- Breadcrumb
- Tabs
- Pagination

### Batch 4 — Overlays / Navigation
- Dropdown
- Mobile Navigation
- Alert
- Toast
- Modal
- Drawer
- Dialog

### Batch 5 — Loading / Content States
- Spinner
- Skeleton
- Error State
- Empty State
- Price

### Batch 6 — Commerce Components
- Rating
- Quantity Selector
- Cart Item
- Order Status
- Payment Status

### Batch 7 — Product / Data Components
- Product Card
- Product Image
- Product Gallery
- Data Table
- Filter Bar
- Stats Card

### Batch 8 — Analytics / Admin Components
- Chart Container
- Admin Form
- Status Badge

### Final Foundation Pass
- Figma Foundation verification
- canonical SCSS token consolidation
- undefined-token remediation
- removal of accidental parallel CSS-token systems
- Batch 1–8 token-consumer audit
- final visual and automated verification

---

## 2. AUTHORITATIVE FIGMA SOURCES

### Figma Design
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?m=auto&t=LXiqpv5AACaZ00jo-6

### Figma Make
https://www.figma.com/make/6Y4bdXmEreL8v1Fq2nYDA1/Audit-ElectroHub-Design?t=LXiqpv5AACaZ00jo-6

Figma Design is the primary visual authority.

Figma Make is supporting implementation/reference evidence.

Never fabricate Figma values, states, variants, responsive behavior, or motion.

When evidence is unavailable, report `NOT VERIFIED`.

---

## 3. FIGMA-FIRST IMPLEMENTATION PIPELINE

Every batch used the following evidence chain:

**Selected Figma component/frame**
→ `get_design_context`
→ `get_variable_defs` where relevant
→ `get_screenshot`
→ `get_metadata`
→ `get_motion_context` where relevant
→ inspect repository tokens
→ inspect related repository screenshots
→ implementation
→ exact visual comparison
→ behavioral tests
→ typecheck/lint/build
→ git diff review
→ GitHub Actions verification

The final Foundation pass used:

**Selected Figma Foundation**
→ actual Figma values
→ canonical SCSS tokens
→ Batch 1–8 consumers
→ visual verification

---

## 4. FIGMA FOUNDATION

Final Foundation reference:

- **Node ID:** `373:3`
- **Name:** `Frame 29`
- **Dimensions:** `4645 × 11997px`

The Foundation frame was inspected for:

- color system
- typography
- spacing
- grid
- borders
- shadows
- button specifications
- other foundation properties represented by the frame

`get_variable_defs` returned `{}`. This means no bound Figma variables were returned for the selected frame; it does not mean the frame contains no design values. Raw values from design context/screenshots remain the evidence source.

---

## 5. CANONICAL SCSS ARCHITECTURE

The central token layer is:

`apps/frontend/src/styles/abstracts/_variables.scss`

The architecture remains:

```text
abstracts/_variables.scss
    → tokens only

abstracts/_mixins.scss
    → reusable SCSS behavior

base/_typography.scss
    → global typography foundation

base/_reset.scss
    → CSS normalization

components/** / *.module.scss
    → component-specific styles

layout/**
    → layout behavior

pages/**
    → page-specific styles

themes/**
    → theme overrides

vendors/**
    → third-party overrides
```

`_variables.scss` must never become a global stylesheet.

---

## 6. FINAL TOKEN SYSTEM

The final foundation follows:

**Figma actual value**
→ **verified repository token**
→ **component consumer**

Never infer a token's value from its name.

A mapping is `EXACT` only when the actual values match.

Use this decision hierarchy:

1. Existing exact semantic token
2. New reusable foundation token when Figma establishes reuse
3. Component-specific token/value when genuinely local
4. Documented hardcoded Figma value when no suitable token exists

Do not substitute a visually different "nearest" token solely to eliminate hardcoding.

---

## 7. CSS CUSTOM PROPERTY POLICY

The accidental parallel ElectroHub design-token system has been consolidated into the canonical SCSS token layer.

Batch 7 components were migrated away from token patterns such as:

```scss
var(--color-*, fallback)
var(--font-*, fallback)
var(--radius-*, fallback)
```

Legitimate runtime/library CSS variables remain allowed, including Radix variables such as:

```text
--radix-toast-swipe-move-x
--radix-toast-swipe-end-x
--radix-select-trigger-width
```

Do not remove legitimate runtime variables.

---

## 8. BATCH ARCHITECTURE REQUIREMENTS

All Batch 1–8 components are shared UI components.

They must:

- use explicit reusable APIs
- avoid page-specific duplication
- consume the canonical design foundation appropriately
- preserve accessibility
- preserve keyboard behavior where applicable
- preserve responsive behavior where Figma evidence exists
- preserve reduced-motion behavior
- avoid business logic
- avoid direct API/database/payment access

Existing Radix primitives should be reused rather than duplicated.

---

## 9. COMMERCE / BUSINESS-LOGIC BOUNDARY

The following components remain presentation-oriented:

- QuantitySelector
- CartItem
- OrderStatus
- PaymentStatus
- ProductCard
- FilterBar
- StatsCard
- ChartContainer
- AdminForm
- StatusBadge

Required architecture:

```text
UI component
→ props / children / callbacks
→ application/page logic
→ service/API
```

Never:

```text
UI component
→ API / database / payment / business logic
```

Shared components must not directly perform:

- API calls
- HTTP requests
- database access
- Prisma operations
- payment processing
- authentication/business services
- business mutations

---

## 10. FINAL TOKEN-CONSOLIDATION REQUIREMENTS

The final consolidation addressed:

### Undefined token references
Canonical names must be used instead of obsolete references such as:

```text
$font-family-primary
$color-primary-text
$color-secondary-text
$color-surface-hover
$color-disabled-text
$color-background-surface
$color-border-default
```

No undefined SCSS variable may remain.

### Batch 7 CSS token migration
StatsCard, ProductCard, ProductImage, ProductGallery, DataTable, and FilterBar must use the canonical SCSS foundation where the mapping is correct.

### Exact-match rule
Do not map:

```text
#dcfce7 → #f0fdf4
#fee2e2 → #fef2f2
#f1f5f9 → #f8fafc
```

and call the result exact.

If such differences remain, they must be explicitly documented and justified.

### Radius rule
Do not infer intended Figma radius from a previous CSS fallback. Verify the actual Figma component and select the correct token/value.

### Skeleton exception
`#d9d9d9` may remain component-specific when supported by the Figma evidence and documented as an intentional exception.

---

## 11. VISUAL EVIDENCE

For each batch the intended evidence chain is:

**Selected Figma component**
→ **Figma screenshot**
→ **repository Batch screenshot**
→ **implementation**
→ **exact visual comparison**

The final Foundation evidence chain is:

**Figma Foundation**
→ **verified values**
→ **SCSS tokens**
→ **Batch 1–8 consumers**
→ **visual verification**

Do not claim pixel-perfect or exact visual matching without evidence.

Page-level localhost verification for components whose page contexts were not yet implemented belongs to the later page implementation tasks; it must not be fabricated as completed evidence.

---

## 12. ACCESSIBILITY / MOTION

All shared components must preserve:

- semantic HTML
- keyboard navigation
- focus visibility
- accessible names
- required ARIA
- disabled states
- error states
- loading states
- dialog focus management
- dropdown/select behavior
- tooltip accessibility
- contrast

Motion must follow the actual Figma evidence and existing Framer Motion architecture where relevant.

Reduced-motion preferences must remain respected.

---

## 13. TESTING AND QUALITY GATE

The final implementation must independently pass:

```bash
npm run test --workspace=@electrohub/frontend -- --run
npm run typecheck --workspace=@electrohub/frontend
npm run lint --workspace=@electrohub/frontend
npm run build --workspace=@electrohub/frontend
```

Do not infer one check from another.

Historical baseline:

- 46 test files
- 126 tests

If the final count differs, document the reason.

GitHub Actions remains the remote source of truth. Local success alone is not CI evidence.

---

## 14. DOCUMENTATION / EVIDENCE

Maintain and keep synchronized where applicable:

```text
assets/figma/FIGMA.md
assets/figma/FIGMA_IMPLEMENTATION_RULES.md
assets/figma/FIGMA_REFERENCES.md
assets/figma/exports/Components/README.md
```

Approved screenshot structure:

```text
assets/
└── figma/
    ├── FIGMA.md
    ├── FIGMA_IMPLEMENTATION_RULES.md
    ├── FIGMA_REFERENCES.md
    └── exports/
        ├── Components/
        │   ├── README.md
        │   └── screenshots/
        ├── admin/
        │   ├── README.md
        │   └── screenshots/
        └── customer/
            ├── README.md
            └── screenshots/
```

Do not create legacy `Layouts/`, `Foundation/`, `screens/`, or `responsive/` structures.

Preserve original Figma Make generated screenshot filenames.

---

## 15. SECURITY / PERFORMANCE

Shared components must not introduce:

- unsafe HTML
- arbitrary script execution
- insecure URL handling
- unsafe DOM manipulation
- exposed secrets
- unnecessary runtime token processing
- unnecessary dependencies
- unnecessary state/effects/renders

No backend, database, payment, or API changes belong to this task unless explicitly required.

---

## 16. GIT / CHANGE CONTROL

Before completion:

```bash
git status
git diff --check
git diff --stat
git diff
```

Confirm:

- no unrelated changes
- no debug code
- no console logs
- no secrets
- no temporary artifacts
- no accidental deletions
- no unrelated dependency changes

Every modified file must have a clear TASK 01.4 reason.

---

## 17. FINAL COMPONENT EVIDENCE

Maintain evidence for all 42 components:

| Batch | Components |
|---|---|
| 1 | Button, IconButton, Input, Textarea, Select |
| 2 | Checkbox, Radio, Switch, Badge, Avatar, Tooltip |
| 3 | Header, Sidebar, Breadcrumb, Tabs, Pagination |
| 4 | Dropdown, Mobile Navigation, Alert, Toast, Modal, Drawer, Dialog |
| 5 | Spinner, Skeleton, Error State, Empty State, Price |
| 6 | Rating, Quantity Selector, Cart Item, Order Status, Payment Status |
| 7 | Product Card, Product Image, Product Gallery, Data Table, Filter Bar, Stats Card |
| 8 | Chart Container, Admin Form, Status Badge |

For each component record where available:

- Figma node/frame
- design context
- variables
- screenshot
- motion
- responsive evidence
- repository screenshot
- visual match
- final status

Use `NOT VERIFIED` where evidence is unavailable.

---

## 18. FINAL FOUNDATION EVIDENCE

Record:

| Category | Figma Actual | SCSS Token | Actual SCSS Value | Exact Match | Consumers | Status |
|---|---|---|---|---|---|---|
| Colors | | | | | | |
| Typography | | | | | | |
| Spacing | | | | | | |
| Grid/Breakpoints | | | | | | |
| Radius | | | | | | |
| Borders | | | | | | |
| Shadows | | | | | | |
| Focus | | | | | | |
| Transitions | | | | | | |

---

## 19. FINAL ACCEPTANCE CRITERIA

TASK 01.4 is complete only when:

- [ ] Batches 1–8 are implemented.
- [ ] All 42 shared components are accounted for.
- [ ] Actual Figma frames/components were selected and inspected.
- [ ] Required Figma MCP evidence was collected.
- [ ] Figma Design remains the visual authority.
- [ ] Figma Make remains supporting evidence.
- [ ] Related repository screenshots were inspected.
- [ ] Foundation values were verified.
- [ ] `_variables.scss` remains token-only.
- [ ] `_mixins.scss` remains behavior-only.
- [ ] Typography/reset architecture remains separated.
- [ ] Undefined SCSS variables are eliminated.
- [ ] No accidental parallel ElectroHub token system remains.
- [ ] Legitimate Radix runtime variables remain functional.
- [ ] Token substitutions are exact or explicitly justified.
- [ ] Component-specific values are documented.
- [ ] Shared component APIs remain reusable.
- [ ] Business logic remains outside shared UI.
- [ ] API compatibility is preserved.
- [ ] Accessibility is verified.
- [ ] Responsive behavior matches available Figma evidence.
- [ ] Motion/reduced-motion behavior is correct.
- [ ] Behavioral tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Build passes.
- [ ] Git diff is clean and scoped.
- [ ] Documentation is synchronized.
- [ ] GitHub Actions is verified.
- [ ] No unsupported Figma claims remain.

---

## 20. FINAL ARCHITECT REPORT

The final report must contain:

### Implementation Summary
What was delivered across Batches 1–8.

### Figma Evidence
Selected frames/nodes and evidence status.

### Component Evidence
Complete Batch 1–8 matrix.

### Foundation Evidence
Figma → SCSS token mapping.

### Token Decisions
Exact matches, new semantic tokens, and component-specific exceptions.

### Discrepancies
All Figma ↔ repository differences and their resolution.

### Accessibility
Final status.

### Business Logic
Final boundary verification.

### API Compatibility
Final status.

### Testing
Actual Tests / Typecheck / Lint / Build results.

### CI
Actual GitHub Actions result.

### Git
Branch, commit, push status, and final diff scope.

### Remaining Risks
Anything still `NOT VERIFIED`, deferred, or intentionally different.

### Final Status
Exactly one:

`COMPLETE`

`COMPLETE WITH DOCUMENTED DEVIATIONS`

`NOT COMPLETE`

---

## 21. FINAL PRINCIPAL ARCHITECT DECISION

The final task review must provide:

**Score: XX / 100**

Then exactly one:

### ✅ APPROVE

### ⚠ REQUEST CHANGES

### ❌ REJECT

Approval requires actual evidence, not assumptions.

The final architecture must represent:

**Figma Design**
→ **verified design values**
→ **canonical SCSS token layer**
→ **reusable Batch 1–8 components**
→ **visual verification**
→ **automated validation**
→ **remote CI verification**

The objective is not maximum tokenization.

The objective is:

**Figma fidelity + correct token ownership + reusable APIs + accessibility + maintainability + no regressions.**


---

# APPENDIX — ORIGINAL PRE-BATCH TASK SPECIFICATION

**# ElectroHub — TASK 01.4 Shared Components**

**# Figma-First UI Implementation**

You are implementing:

**## TASK 01.4 — Shared Components**

Build the reusable ElectroHub UI foundation:

\- Buttons

\- Inputs

\- Selects

\- Dialogs

\- Dropdowns

\- Tooltips

\- Cards

\- Badges

\- Tables

\- Navigation

\- Headers

\- Footers

\- Loading states

\- Error states

\- Empty states

This task is the formal transition to the ElectroHub Figma-first implementation workflow.

The authoritative visual source is the actual ElectroHub Figma Design.

Figma Make is supporting visual/implementation evidence.

Repository code, tokens, and documentation are implementation constraints and must be reconciled with the actual Figma design.

DO NOT begin implementation by guessing from repository tokens.

**==================================================**

**# 1. SOURCE OF TRUTH**

**==================================================**

Use this authority hierarchy:

1\. Task requirements / acceptance criteria

2\. Actual repository implementation and tests

3\. Approved ElectroHub Figma Design

4\. Figma Make implementation/reference screens

5\. Repository design tokens and documentation

6\. General UI conventions

For visual decisions, Figma is the primary source of truth.

Figma Make is important supporting evidence and must be used alongside the selected Figma design.

Never fabricate a Figma value, component, variant, state, or layout.

If Figma cannot be accessed:

    Figma Status = NOT VERIFIED

Do NOT pretend that Figma was inspected.

**==================================================**

**# 2. MANDATORY INITIAL INSPECTION**

**==================================================**

Before modifying code:

Read:

\- AGENTS.md

\- Fixed Developer Prompt

\- task documentation for TASK 01.4

\- existing frontend architecture documentation

\- existing design-system documentation

\- existing SCSS/token files

\- existing shared components

\- existing tests

Then inspect:

    git status

    git branch --show-current

    git log --oneline -10

    git diff

    git diff develop...HEAD

Inspect the existing frontend structure before creating new files.

Do not duplicate existing components.

Determine which components were already created during TASK 01.3 and which must now be expanded/refined.

**==================================================**

**# 3. FIGMA-FIRST WORKFLOW — MANDATORY**

**==================================================**

For EVERY meaningful UI component in this task, follow this workflow:

    Figma

       ↓

    Select exact frame/component/variant

       ↓

    Inspect design context

       ↓

    Inspect variables/tokens when relevant

       ↓

    Inspect screenshot

       ↓

    Inspect motion when relevant

       ↓

    Compare with repository tokens

       ↓

    Implement

       ↓

    Visual QA against Figma

Do NOT reverse this order.

The first meaningful UI implementation step must be selecting and inspecting the relevant Figma component/frame.

**==================================================**

**# 4. FIGMA DESIGN — REQUIRED INSPECTION**

**==================================================**

Open the ElectroHub Design source:

https\://www\.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?m=auto&t=LXiqpv5AACaZ00jo-6

For each component, locate and SELECT the actual relevant Figma frame/component.

Use:

    get\_design\_context

to inspect the selected design.

When token/variable information is required, use:

    get\_variable\_defs

For visual verification, use:

    get\_screenshot

When metadata is useful, use:

    get\_metadata

When interaction/motion behavior is relevant, use:

    get\_motion\_context

These are evidence-gathering steps, not optional decoration.

**==================================================**

**# 5. COMPONENT-BY-COMPONENT FIGMA INSPECTION**

**==================================================**

Do not inspect only one generic page and assume all components from it.

Create an inspection matrix.

For each component, identify the actual Figma source:

Component:

    Buttons

Figma:

    [actual selected frame/component/node]

Variants:

    [actual variants found]

States:

    [actual states found]

Responsive behavior:

    [actual evidence]

Tokens:

    [actual variables used]

Then repeat for:

    Inputs

    Selects

    Dialogs

    Dropdowns

    Tooltips

    Cards

    Badges

    Tables

    Navigation

    Headers

    Footers

    Loading states

    Error states

    Empty states

If a component or state does not exist in Figma, DO NOT invent it silently.

Report:

    Figma Evidence = NOT FOUND

and determine whether the task requirements explicitly authorize creating the missing state.

**==================================================**

**# 6. FIGMA AREAS TO INSPECT**

**==================================================**

When navigating the design, look for the actual approved structures corresponding to:

    Foundation / tokens & variables

    Components

    states/

    responsive/

    Layouts/

Use the actual Figma hierarchy/names when available.

Do not assume these folders/sections exist exactly as written if the live Figma file uses another hierarchy.

The live Figma structure is authoritative.

**==================================================**

**# 7. FIGMA MAKE — SUPPORTING EVIDENCE**

**==================================================**

Also inspect the ElectroHub Figma Make source:

https\://www\.figma.com/make/6Y4bdXmEreL8v1Fq2nYDA1/Audit-ElectroHub-Design?t=LXiqpv5AACaZ00jo-6

Use Figma Make to obtain supporting implementation/reference screenshots.

Compare:

    Figma Design

        +

    Figma Make screenshot

        ↓

    intended implementation

Do not treat a Make-generated implementation as automatically correct if it conflicts with the authoritative Figma Design.

Figma Design wins visual conflicts.

**==================================================**

**# 8. SCREENSHOT EVIDENCE**

**==================================================**

When using Figma Make screenshots:

\- Preserve the original generated filenames.

\- Do NOT rename them.

\- Do NOT invent replacement filenames.

\- Store them only under the approved structure.

Use:

    assets/figma/exports/

Approved structure:

    assets/

    └── figma/

        ├── FIGMA.md

        ├── FIGMA\_IMPLEMENTATION\_RULES.md

        ├── FIGMA\_REFERENCES.md

        └── exports/

            ├── Components/

            │   ├── README.md

            │   └── screenshots/

            ├── admin/

            │   ├── README.md

            │   └── screenshots/

            └── customer/

                ├── README.md

                └── screenshots/

Do NOT create legacy folders:

    Layouts/

    Foundation/

    screens/

    responsive/

Responsive evidence belongs inside the approved component/admin/customer structure.

**==================================================**

**# 9. FIGMA → TOKEN → CODE MAPPING**

**==================================================**

For every important visual property, establish:

    Figma evidence

          ↓

    repository token

          ↓

    implementation

Example:

    Figma component

        ↓

    radius observed = 12px

        ↓

    inspect actual repository variable

        ↓

    $radius-xl = 12px

        ↓

    use $radius-xl

Do NOT assume a token's value from its name.

For example:

    $radius-xl

    $font-size-4xl

    $spacing-lg

must never be assumed.

Inspect the actual token definition.

**==================================================**

**# 10. TOKEN DISCREPANCIES**

**==================================================**

If Figma says:

    radius = 12px

but repository token says:

    radius = 16px

DO NOT silently modify the global token.

Report:

    DESIGN/TOKEN DISCREPANCY

Then determine whether:

1\. The component should use an existing correct token.

2\. A component-specific token is appropriate.

3\. The global design token itself should be changed.

Do not change global design-system values merely to make one component match Figma.

Protect existing consumers.

**==================================================**

**# 11. COMPONENT ARCHITECTURE**

**==================================================**

Components must be genuinely reusable.

Avoid creating page-specific copies such as:

    ProductPageButton

    CheckoutButton

    AdminButton

when a reusable:

    Button

with appropriate variants is correct.

Prefer composable components with explicit APIs.

Examples:

    Button

    Input

    Select

    Dialog

    DropdownMenu

    Tooltip

    Card

    Badge

    Table

    Navigation

    Header

    Footer

    LoadingState

    ErrorState

    EmptyState

Use existing libraries/primitives where already approved by the project architecture.

Do not introduce another UI framework.

Do not duplicate Radix primitives unnecessarily.

Use Lucide React for icons where appropriate.

**==================================================**

**# 12. VARIANTS AND STATES**

**==================================================**

Inspect the actual Figma states.

Where Figma defines states such as:

    default

    hover

    active

    focus

    disabled

    loading

    error

    selected

    open

implement the corresponding reusable state behavior.

Do not implement only the default visual state when the design defines additional states.

Accessibility states must remain functional even when the visual design does not explicitly show every state.

**==================================================**

**# 13. RESPONSIVE BEHAVIOR**

**==================================================**

Inspect the actual responsive Figma designs.

Do not simply make desktop layouts shrink.

Determine actual behavior for:

    desktop

    tablet

    mobile

where evidence exists.

Inspect:

\- widths

\- stacking

\- wrapping

\- spacing changes

\- navigation behavior

\- table behavior

\- dialog sizing

\- input/select behavior

\- header/footer transformations

Implement the observed responsive behavior.

If no responsive evidence exists for a component:

    Responsive Figma Evidence = NOT VERIFIED

Do not fabricate breakpoints.

**==================================================**

**# 14. INTERACTION AND MOTION**

**==================================================**

Use:

    get\_motion\_context

for components where interaction/motion is relevant.

Pay particular attention to:

\- dialogs

\- dropdowns

\- tooltips

\- navigation

\- loading states

\- interactive buttons

Use the project's existing Framer Motion architecture where appropriate.

Respect reduced-motion preferences.

Do not introduce unnecessary animation.

**==================================================**

**# 15. ACCESSIBILITY**

**==================================================**

All shared components must be production-quality.

Verify:

\- keyboard navigation

\- focus visibility

\- semantic HTML

\- ARIA where required

\- accessible names

\- disabled states

\- loading states

\- error messaging

\- dialog focus management

\- dropdown keyboard behavior

\- tooltip accessibility

\- sufficient visual focus indication

Decorative icons must not become unnecessary screen-reader content.

Do not use accessibility attributes merely to silence lint.

**==================================================**

**# 16. IMPLEMENTATION SCOPE**

**==================================================**

The goal is a complete shared component foundation, not superficial placeholders.

Implement:

**### Buttons**

\- actual Figma variants

\- sizes

\- states

\- icons where supported

**### Inputs**

\- label

\- placeholder

\- helper text

\- error

\- disabled

\- required states where designed

**### Selects**

\- trigger

\- menu

\- selected state

\- disabled

\- keyboard interaction

**### Dialogs**

\- overlay

\- content

\- title

\- description

\- close

\- responsive behavior

\- motion where designed

**### Dropdowns**

\- trigger

\- menu

\- items

\- selected/disabled states

\- keyboard interaction

**### Tooltips**

\- trigger

\- content

\- positioning

\- accessibility

**### Cards**

\- variants found in Figma

\- content structure

\- interactive states if designed

**### Badges**

\- variants

\- sizes/states supported by Figma

**### Tables**

\- header

\- rows

\- cells

\- states

\- responsive behavior based on evidence

**### Navigation**

\- desktop/mobile behavior

\- active state

\- interaction states

**### Header**

\- responsive behavior

\- navigation integration

\- actions

**### Footer**

\- responsive layout

\- links

\- content hierarchy

**### Loading**

\- spinner/skeleton/etc. according to actual design evidence

**### Error**

\- reusable error presentation

\- action/retry where designed

**### Empty**

\- reusable empty state

\- icon/content/action where designed

Do not create fake content merely to make the components look complete.

Use realistic content only where the design requires content examples.

**==================================================**

**# 17. DOCUMENTATION**

**==================================================**

Update relevant design-system documentation.

Document:

\- component purpose

\- variants

\- states

\- responsive behavior

\- accessibility behavior

\- Figma reference

\- implementation notes

\- token mapping

\- known discrepancies

Maintain:

    assets/figma/FIGMA.md

    assets/figma/FIGMA\_IMPLEMENTATION\_RULES.md

    assets/figma/FIGMA\_REFERENCES.md

when relevant.

Do not document Figma inspection as complete unless the actual Figma source was accessible.

**==================================================**

**# 18. TESTING**

**==================================================**

Every shared component must have appropriate tests.

At minimum test important behavior such as:

\- rendering

\- variants

\- states

\- keyboard behavior

\- accessibility-critical behavior

\- dialog open/close

\- dropdown interaction

\- select interaction

\- loading/error/empty states

Do not create meaningless snapshot-only tests as a substitute for behavioral tests.

Run:

    npm run typecheck --workspace=@electrohub/frontend

    npm run lint --workspace=@electrohub/frontend

    npm run test --workspace=@electrohub/frontend

    npm run build --workspace=@electrohub/frontend

All applicable checks must pass.

**==================================================**

**# 19. PERFORMANCE**

**==================================================**

Avoid unnecessary:

\- re-renders

\- state

\- effects

\- DOM complexity

\- dependencies

\- animation work

Do not over-engineer shared components.

Shared components will be used throughout the application, so APIs must remain lightweight and predictable.

**==================================================**

**# 20. SECURITY**

**==================================================**

Do not introduce:

\- unsafe HTML

\- arbitrary HTML injection

\- unsafe URL handling

\- user-controlled script execution

\- insecure DOM manipulation

Shared UI must not create security problems for future consumers.

**==================================================**

**# 21. GIT / CHANGE CONTROL**

**==================================================**

Do not modify unrelated application features.

Do not modify backend code unless explicitly required by the task.

Do not change database schema.

Do not change API contracts.

Do not upgrade dependencies without explicit necessity.

Before committing:

    git status

    git diff --check

    git diff

Review the complete diff.

**==================================================**

**# 22. FINAL VISUAL QA**

**==================================================**

Before declaring the task complete:

For each major component:

    Figma selected component

          ↓

    implementation

          ↓

    screenshot / rendered result

          ↓

    visual comparison

Check:

\- dimensions

\- spacing

\- typography

\- colors

\- borders

\- radius

\- shadows

\- icons

\- alignment

\- states

\- responsive behavior

Record any intentional deviations.

Do not claim pixel-accurate implementation without evidence.

**==================================================**

**# 23. CI VERIFICATION**

**==================================================**

After pushing the branch:

Inspect the actual GitHub Actions run.

Verify:

\- Frontend / Typecheck

\- Frontend / Lint

\- Frontend / Test

\- Frontend / Build

and all other applicable CI jobs.

Do NOT say:

    CI passed

based only on local commands.

Use actual GitHub Actions evidence.

If CI fails:

    TASK STATUS = NOT COMPLETE

unless the failure is demonstrably unrelated and explicitly documented.

**==================================================**

**# 24. FINAL REPORT**

**==================================================**

Return:

**## Implementation Summary**

What was implemented.

**## Figma Evidence**

For every major component:

    Component:

    Selected Figma frame/component:

    Figma node:

    Figma states:

    Responsive evidence:

    Variables/tokens inspected:

Do not invent missing information.

**## Figma Make Evidence**

List the Make screenshots actually used.

Preserve their original filenames.

**## Token Mapping**

Show important:

    Figma value → repository token → implementation

**## Discrepancies**

List any:

    Figma ↔ repository

differences.

Explain how they were handled.

**## Files Changed**

List all changed files.

**## Tests**

Report actual results:

    Typecheck: PASS/FAIL

    Lint: PASS/FAIL

    Tests: PASS/FAIL

    Build: PASS/FAIL

**## CI**

Report the actual GitHub Actions result.

**## Git**

Report:

    branch

    commit

    push status

**## Completion Status**

Use exactly one:

    COMPLETE

    COMPLETE WITH DOCUMENTED DEVIATIONS

    NOT COMPLETE

Never claim completion without evidence.

**==================================================**

**# FINAL ACCEPTANCE CRITERIA**

**==================================================**

[ ] Actual Figma Design was inspected.

[ ] Actual Figma frames/components were selected.

[ ] Figma evidence was collected before implementation.

[ ] Figma Make screenshots were used as supporting evidence.

[ ] Make screenshot filenames were preserved.

[ ] Figma Design remains the primary visual authority.

[ ] Repository tokens were inspected rather than assumed.

[ ] Token discrepancies were identified and documented.

[ ] Components are reusable.

[ ] Component variants match Figma evidence.

[ ] Component states match Figma evidence.

[ ] Responsive behavior matches available Figma evidence.

[ ] Accessibility requirements are implemented.

[ ] Motion behavior respects the approved design and reduced-motion requirements.

[ ] Tests exist for important shared-component behavior.

[ ] Typecheck passes.

[ ] Lint passes.

[ ] Tests pass.

[ ] Build passes.

[ ] Git diff contains no unrelated changes.

[ ] Documentation is updated.

[ ] Actual GitHub Actions results were verified.

[ ] No unsupported Figma claims were made.

If any requirement is not satisfied, report it explicitly.

DO NOT GUESS.

DO NOT FABRICATE FIGMA EVIDENCE.

DO NOT SILENTLY OVERRIDE THE DESIGN SYSTEM.

DO NOT WEAKEN CI.

DO NOT DECLARE SUCCESS WITHOUT EVIDENCE.