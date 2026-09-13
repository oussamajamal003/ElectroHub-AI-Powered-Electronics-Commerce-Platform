# ElectroHub — TASK 01.4 Shared Components
# Figma-First UI Implementation

You are implementing:

## TASK 01.4 — Shared Components

Build the reusable ElectroHub UI foundation:

- Buttons
- Inputs
- Selects
- Dialogs
- Dropdowns
- Tooltips
- Cards
- Badges
- Tables
- Navigation
- Headers
- Footers
- Loading states
- Error states
- Empty states

This task is the formal transition to the ElectroHub Figma-first implementation workflow.

The authoritative visual source is the actual ElectroHub Figma Design.
Figma Make is supporting visual/implementation evidence.
Repository code, tokens, and documentation are implementation constraints and must be reconciled with the actual Figma design.

DO NOT begin implementation by guessing from repository tokens.

==================================================
# 1. SOURCE OF TRUTH
==================================================

Use this authority hierarchy:

1. Task requirements / acceptance criteria
2. Actual repository implementation and tests
3. Approved ElectroHub Figma Design
4. Figma Make implementation/reference screens
5. Repository design tokens and documentation
6. General UI conventions

For visual decisions, Figma is the primary source of truth.

Figma Make is important supporting evidence and must be used alongside the selected Figma design.

Never fabricate a Figma value, component, variant, state, or layout.

If Figma cannot be accessed:

    Figma Status = NOT VERIFIED

Do NOT pretend that Figma was inspected.

==================================================
# 2. MANDATORY INITIAL INSPECTION
==================================================

Before modifying code:

Read:

- AGENTS.md
- Fixed Developer Prompt
- task documentation for TASK 01.4
- existing frontend architecture documentation
- existing design-system documentation
- existing SCSS/token files
- existing shared components
- existing tests

Then inspect:

    git status
    git branch --show-current
    git log --oneline -10
    git diff
    git diff develop...HEAD

Inspect the existing frontend structure before creating new files.

Do not duplicate existing components.

Determine which components were already created during TASK 01.3 and which must now be expanded/refined.

==================================================
# 3. FIGMA-FIRST WORKFLOW — MANDATORY
==================================================

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

==================================================
# 4. FIGMA DESIGN — REQUIRED INSPECTION
==================================================

Open the ElectroHub Design source:

https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?m=auto&t=LXiqpv5AACaZ00jo-6

For each component, locate and SELECT the actual relevant Figma frame/component.

Use:

    get_design_context

to inspect the selected design.

When token/variable information is required, use:

    get_variable_defs

For visual verification, use:

    get_screenshot

When metadata is useful, use:

    get_metadata

When interaction/motion behavior is relevant, use:

    get_motion_context

These are evidence-gathering steps, not optional decoration.

==================================================
# 5. COMPONENT-BY-COMPONENT FIGMA INSPECTION
==================================================

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

==================================================
# 6. FIGMA AREAS TO INSPECT
==================================================

When navigating the design, look for the actual approved structures corresponding to:

    Foundation / tokens & variables
    Components
    states/
    responsive/
    Layouts/

Use the actual Figma hierarchy/names when available.

Do not assume these folders/sections exist exactly as written if the live Figma file uses another hierarchy.

The live Figma structure is authoritative.

==================================================
# 7. FIGMA MAKE — SUPPORTING EVIDENCE
==================================================

Also inspect the ElectroHub Figma Make source:

https://www.figma.com/make/6Y4bdXmEreL8v1Fq2nYDA1/Audit-ElectroHub-Design?t=LXiqpv5AACaZ00jo-6

Use Figma Make to obtain supporting implementation/reference screenshots.

Compare:

    Figma Design
        +
    Figma Make screenshot
        ↓
    intended implementation

Do not treat a Make-generated implementation as automatically correct if it conflicts with the authoritative Figma Design.

Figma Design wins visual conflicts.

==================================================
# 8. SCREENSHOT EVIDENCE
==================================================

When using Figma Make screenshots:

- Preserve the original generated filenames.
- Do NOT rename them.
- Do NOT invent replacement filenames.
- Store them only under the approved structure.

Use:

    assets/figma/exports/

Approved structure:

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

Do NOT create legacy folders:

    Layouts/
    Foundation/
    screens/
    responsive/

Responsive evidence belongs inside the approved component/admin/customer structure.

==================================================
# 9. FIGMA → TOKEN → CODE MAPPING
==================================================

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

==================================================
# 10. TOKEN DISCREPANCIES
==================================================

If Figma says:

    radius = 12px

but repository token says:

    radius = 16px

DO NOT silently modify the global token.

Report:

    DESIGN/TOKEN DISCREPANCY

Then determine whether:

1. The component should use an existing correct token.
2. A component-specific token is appropriate.
3. The global design token itself should be changed.

Do not change global design-system values merely to make one component match Figma.

Protect existing consumers.

==================================================
# 11. COMPONENT ARCHITECTURE
==================================================

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

==================================================
# 12. VARIANTS AND STATES
==================================================

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

==================================================
# 13. RESPONSIVE BEHAVIOR
==================================================

Inspect the actual responsive Figma designs.

Do not simply make desktop layouts shrink.

Determine actual behavior for:

    desktop
    tablet
    mobile

where evidence exists.

Inspect:

- widths
- stacking
- wrapping
- spacing changes
- navigation behavior
- table behavior
- dialog sizing
- input/select behavior
- header/footer transformations

Implement the observed responsive behavior.

If no responsive evidence exists for a component:

    Responsive Figma Evidence = NOT VERIFIED

Do not fabricate breakpoints.

==================================================
# 14. INTERACTION AND MOTION
==================================================

Use:

    get_motion_context

for components where interaction/motion is relevant.

Pay particular attention to:

- dialogs
- dropdowns
- tooltips
- navigation
- loading states
- interactive buttons

Use the project's existing Framer Motion architecture where appropriate.

Respect reduced-motion preferences.

Do not introduce unnecessary animation.

==================================================
# 15. ACCESSIBILITY
==================================================

All shared components must be production-quality.

Verify:

- keyboard navigation
- focus visibility
- semantic HTML
- ARIA where required
- accessible names
- disabled states
- loading states
- error messaging
- dialog focus management
- dropdown keyboard behavior
- tooltip accessibility
- sufficient visual focus indication

Decorative icons must not become unnecessary screen-reader content.

Do not use accessibility attributes merely to silence lint.

==================================================
# 16. IMPLEMENTATION SCOPE
==================================================

The goal is a complete shared component foundation, not superficial placeholders.

Implement:

### Buttons
- actual Figma variants
- sizes
- states
- icons where supported

### Inputs
- label
- placeholder
- helper text
- error
- disabled
- required states where designed

### Selects
- trigger
- menu
- selected state
- disabled
- keyboard interaction

### Dialogs
- overlay
- content
- title
- description
- close
- responsive behavior
- motion where designed

### Dropdowns
- trigger
- menu
- items
- selected/disabled states
- keyboard interaction

### Tooltips
- trigger
- content
- positioning
- accessibility

### Cards
- variants found in Figma
- content structure
- interactive states if designed

### Badges
- variants
- sizes/states supported by Figma

### Tables
- header
- rows
- cells
- states
- responsive behavior based on evidence

### Navigation
- desktop/mobile behavior
- active state
- interaction states

### Header
- responsive behavior
- navigation integration
- actions

### Footer
- responsive layout
- links
- content hierarchy

### Loading
- spinner/skeleton/etc. according to actual design evidence

### Error
- reusable error presentation
- action/retry where designed

### Empty
- reusable empty state
- icon/content/action where designed

Do not create fake content merely to make the components look complete.

Use realistic content only where the design requires content examples.

==================================================
# 17. DOCUMENTATION
==================================================

Update relevant design-system documentation.

Document:

- component purpose
- variants
- states
- responsive behavior
- accessibility behavior
- Figma reference
- implementation notes
- token mapping
- known discrepancies

Maintain:

    assets/figma/FIGMA.md
    assets/figma/FIGMA_IMPLEMENTATION_RULES.md
    assets/figma/FIGMA_REFERENCES.md

when relevant.

Do not document Figma inspection as complete unless the actual Figma source was accessible.

==================================================
# 18. TESTING
==================================================

Every shared component must have appropriate tests.

At minimum test important behavior such as:

- rendering
- variants
- states
- keyboard behavior
- accessibility-critical behavior
- dialog open/close
- dropdown interaction
- select interaction
- loading/error/empty states

Do not create meaningless snapshot-only tests as a substitute for behavioral tests.

Run:

    npm run typecheck --workspace=@electrohub/frontend

    npm run lint --workspace=@electrohub/frontend

    npm run test --workspace=@electrohub/frontend

    npm run build --workspace=@electrohub/frontend

All applicable checks must pass.

==================================================
# 19. PERFORMANCE
==================================================

Avoid unnecessary:

- re-renders
- state
- effects
- DOM complexity
- dependencies
- animation work

Do not over-engineer shared components.

Shared components will be used throughout the application, so APIs must remain lightweight and predictable.

==================================================
# 20. SECURITY
==================================================

Do not introduce:

- unsafe HTML
- arbitrary HTML injection
- unsafe URL handling
- user-controlled script execution
- insecure DOM manipulation

Shared UI must not create security problems for future consumers.

==================================================
# 21. GIT / CHANGE CONTROL
==================================================

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

==================================================
# 22. FINAL VISUAL QA
==================================================

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

- dimensions
- spacing
- typography
- colors
- borders
- radius
- shadows
- icons
- alignment
- states
- responsive behavior

Record any intentional deviations.

Do not claim pixel-accurate implementation without evidence.

==================================================
# 23. CI VERIFICATION
==================================================

After pushing the branch:

Inspect the actual GitHub Actions run.

Verify:

- Frontend / Typecheck
- Frontend / Lint
- Frontend / Test
- Frontend / Build

and all other applicable CI jobs.

Do NOT say:

    CI passed

based only on local commands.

Use actual GitHub Actions evidence.

If CI fails:

    TASK STATUS = NOT COMPLETE

unless the failure is demonstrably unrelated and explicitly documented.

==================================================
# 24. FINAL REPORT
==================================================

Return:

## Implementation Summary

What was implemented.

## Figma Evidence

For every major component:

    Component:
    Selected Figma frame/component:
    Figma node:
    Figma states:
    Responsive evidence:
    Variables/tokens inspected:

Do not invent missing information.

## Figma Make Evidence

List the Make screenshots actually used.

Preserve their original filenames.

## Token Mapping

Show important:

    Figma value → repository token → implementation

## Discrepancies

List any:

    Figma ↔ repository

differences.

Explain how they were handled.

## Files Changed

List all changed files.

## Tests

Report actual results:

    Typecheck: PASS/FAIL
    Lint: PASS/FAIL
    Tests: PASS/FAIL
    Build: PASS/FAIL

## CI

Report the actual GitHub Actions result.

## Git

Report:

    branch
    commit
    push status

## Completion Status

Use exactly one:

    COMPLETE
    COMPLETE WITH DOCUMENTED DEVIATIONS
    NOT COMPLETE

Never claim completion without evidence.

==================================================
# FINAL ACCEPTANCE CRITERIA
==================================================

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