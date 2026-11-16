# ElectroHub --- Figma Implementation Rules

**Document:** `FIGMA_IMPLEMENTATION_RULES.md`\
**Purpose:** Define the authoritative Figma access and implementation
rules for Antigravity.\
**Scope:** ElectroHub UI implementation and UI review workflows.

------------------------------------------------------------------------

## 1. Purpose

These rules define how Antigravity must access, interpret, and use the
two ElectroHub Figma resources:

1.  **ElectroHub Figma Design**
2.  **ElectroHub Figma Make**

The two resources have different roles and **MUST NOT be treated as the
same resource**.

The Figma Design is the authoritative design-system and implementation
source.

The Figma Make project is a visual reference only and is accessed
through repository screenshots.

------------------------------------------------------------------------

# 2. ElectroHub Figma Source Policy

## 2.1 Source Hierarchy

For design and implementation decisions, use the following priority:

``` text
FIGMA DESIGN
    >
ELECTROHUB FIGMA DOCUMENTATION
    >
FIGMA MAKE SCREENSHOTS
    >
IMPLEMENTATION
```

### Figma Design

-   Primary and authoritative visual/design-system source.
-   Access through the Figma Design link (`designlink`) and the
    connected Figma MCP where applicable.
-   Do not replace Design-link access with exported PNGs or repository
    screenshots.

### Figma Make

-   Visual reference only.
-   Access through screenshots stored in the repository.
-   It is not an implementation/source-code source.
-   Do not attempt to extract Make project internals.

### ElectroHub Figma Documentation

The documentation records approved design decisions, implementation
rules, references, and supporting information.

### Implementation

The implementation MUST follow the approved ElectroHub architecture,
design system, components, and engineering standards.

------------------------------------------------------------------------

# 3. Figma Design --- Primary Design Source

## 3.1 Allowed Access

Antigravity MAY access the Figma Design through:

-   Figma Design `designlink`
-   Connected Figma Dev Mode MCP
-   `get_metadata`
-   `get_design_context`
-   `get_variable_defs`
-   `get_screenshot`
-   `get_motion_context`
-   Selected-node/frame inspection

The connected Figma MCP is used for Design inspection when exact design
information is required.

## 3.2 Explicitly Prohibited for Figma Design

Antigravity MUST NOT use repository exports as a replacement for the
live Design source.

Specifically:

-   **NO `exportfigmaframespng`**
-   **NO Design screenshots stored as implementation references**
-   **NO Design PNG exports for the repository Figma reference
    structure**
-   **NO screenshot-based replacement of the Design link**
-   **NO treating a Design screenshot as equivalent to the live Design
    file**

The Design source is accessed through `designlink` / Figma MCP.

------------------------------------------------------------------------

# 4. Figma MCP Inspection Rules

When implementing or reviewing UI based on the ElectroHub Figma Design:

1.  Treat Figma as the visual source of truth.

2.  Before implementing a Figma-based screen or component:

    -   Ensure the relevant Figma frame/component is actively selected
        when selection-scoped MCP inspection is required.
    -   Use the connected Figma MCP server.
    -   Inspect the selected scope with `get_design_context`.
    -   Use `get_variable_defs` when token/variable information is
        required.
    -   Use `get_screenshot` when visual verification is required.
    -   Use `get_metadata` when page/frame/node structure needs to be
        verified.
    -   Use `get_motion_context` when motion/interaction information is
        required and available.

3.  Do NOT blindly copy generated Tailwind classes or absolute
    positioning returned by `get_design_context`.

4.  Translate Figma values into the existing ElectroHub design system:

    -   existing color tokens
    -   existing typography tokens
    -   existing spacing system
    -   existing sizing tokens
    -   existing radius tokens
    -   existing component primitives

5.  Do NOT introduce duplicate tokens when an equivalent ElectroHub
    token already exists.

6.  Do NOT hardcode design-system values unnecessarily.

7.  Do NOT replace existing ElectroHub components with ad-hoc components
    when an approved shared component already exists.

8.  If Figma MCP returns information that conflicts with the documented
    ElectroHub design system:

    -   STOP.
    -   Report the conflict.
    -   Do not silently choose one source.
    -   Resolve the conflict according to the project's documented
        source-of-truth rules.

9.  Never claim that a Figma property, variable, layout, component, or
    design decision was verified unless the MCP actually returned
    evidence.

10. Local Figma MCP inspection is selection-scoped. Do not claim
    full-file deep inspection from a single selected frame.

11. Figma Make is NOT assumed to be accessible through the local Figma
    Dev Mode MCP server.

12. After implementation, visually compare the implementation against
    the corresponding approved Figma reference and report known
    deviations.

------------------------------------------------------------------------

# 5. Selection-Scoped MCP Behavior

The local Figma MCP may require an active selection in Figma Desktop for
deep inspection.

If an MCP call returns:

``` text
Nothing is selected
```

Antigravity MUST NOT interpret this as proof that the Figma MCP is
broken.

Instead:

1.  Identify the Figma frame/component/node that needs inspection.
2.  Require the relevant element to be actively selected in Figma
    Desktop.
3.  Re-run the appropriate MCP inspection.
4.  Report the result based on actual returned data.

Antigravity MUST NOT fabricate information to compensate for unavailable
selection-scoped data.

A successful `get_metadata` call alone does NOT prove that all deep
design information, variables, or layout properties have been inspected.

------------------------------------------------------------------------

# 6. Figma Design Data Interpretation

`get_design_context` may return implementation-oriented output such as:

``` text
bg-white
text-black
absolute
left-[...]
top-[...]
w-[...]
h-[...]
font-['Poppins:Regular']
```

These values are **reference evidence**, not instructions to blindly
reproduce generated code.

Antigravity MUST translate returned design information into the existing
ElectroHub implementation architecture.

For example:

``` text
Figma value
    ↓
Existing ElectroHub design token
    ↓
Existing shared component / implementation primitive
```

Do not unnecessarily transform:

``` text
Figma value
    ↓
Hardcoded value repeated throughout the codebase
```

The objective is to preserve the visual design while maintaining a
clean, reusable, token-driven implementation.

------------------------------------------------------------------------

# 7. Figma Make --- Visual Reference Only

## 7.1 Role

The Figma Make project is **NOT an implementation source** for
Antigravity.

It is used only as a visual reference through screenshots that are
intentionally stored in the repository.

## 7.2 Allowed Access

For Figma Make, Antigravity MAY use ONLY:

-   Repository screenshots
-   Visual inspection of those screenshots
-   Screenshot-based comparison/reference

## 7.3 Explicitly Prohibited

Antigravity MUST NOT use or request:

-   `.make` files
-   Figma Make project exports
-   `exportfigmaframespng`
-   `exportpng`
-   `makelink`
-   Make project source-resource extraction
-   Make implementation/source files
-   Make project internals through the Figma Design MCP
-   Any unsupported mechanism intended to turn the Make project into a
    code/source dependency

The Figma Design MCP MUST NOT be used to claim access to Figma Make
implementation resources.

------------------------------------------------------------------------

# 8. Figma Make Screenshot Repository Structure

Make screenshots are stored under:

``` text
assets/
└── figma/
    ├── FIGMA.md
    ├── FIGMA_IMPLEMENTATION_RULES.md
    ├── FIGMA_REFERENCES.md
    │
    └── exports/
        ├── Components/
        │   ├── README.md
        │   └── screenshots/
        │
        ├── admin/
        │   ├── README.md
        │   └── screenshots/
        │       ├── admin-Dashboard — Desktop.png
        │       ├── Products — Desktop.png
        │       ├── Orders — Desktop.png
        │       └── ...
        │
        └── customer/
            ├── README.md
            └── screenshots/
                ├── customer-Home — Desktop.png
                ├── customer-Home — Tablet.png
                ├── customer-Home — Mobile.png
                ├── Products — Desktop.png
                ├── Product Details — Desktop.png
                ├── Cart — Desktop.png
                ├── Checkout — Desktop.png
                └── ...
```

------------------------------------------------------------------------

# 9. Figma Make Screenshot Rules

Screenshots stored in the repository:

-   Are visual references only.
-   Must not be interpreted as the underlying Figma source.
-   Must not be used to claim access to Make implementation code.
-   Must not override the authoritative Figma Design system silently.
-   May be used to compare visual composition, spacing appearance,
    hierarchy, responsive presentation, and other visible UI
    characteristics.

If a screenshot does not provide enough information to determine an
implementation detail, Antigravity MUST NOT invent the missing detail.

Use the authoritative Figma Design source or project documentation when
the exact design-system decision is required.

------------------------------------------------------------------------

# 10. Source Conflict Rules

If Figma Make screenshots visually differ from the Figma Design:

1.  Do NOT silently change the design system.
2.  Report the discrepancy.
3.  Treat the Figma Design and approved ElectroHub documentation as
    authoritative.
4.  Use the Make screenshot as visual reference only.
5.  Resolve any required implementation decision explicitly.

------------------------------------------------------------------------

# 11. Implementation Rules

When implementing a screen or component:

### A. Exact Design Information Required

Use the Figma Design link/MCP when exact information is required for:

-   Layout
-   Components
-   Variables
-   Design tokens
-   Typography
-   Colors
-   Spacing
-   Sizing
-   Radius
-   Interaction/motion context
-   Node structure

### B. Visual Reference Required

Use Figma Make screenshots when visual comparison/reference is required.

### C. Existing Design System

Always prefer the existing ElectroHub:

-   Design tokens
-   Shared components
-   Typography system
-   Spacing system
-   Sizing system
-   Radius system
-   UI primitives

Do not create parallel design systems.

### D. Existing Architecture

Implementation MUST remain consistent with the approved ElectroHub
application architecture and engineering standards.

Figma inspection must not be used as justification for introducing
unrelated architectural changes.

------------------------------------------------------------------------

# 12. Verification and Evidence Requirements

Whenever Figma resources are used, Antigravity MUST identify the source.

Use one of:

``` text
SOURCE:
FIGMA DESIGN
```

or:

``` text
SOURCE:
FIGMA MAKE SCREENSHOT
```

For Design MCP data:

-   Provide actual MCP evidence when reporting verification.
-   Identify the inspected node/frame where applicable.
-   Do not claim full-file inspection from a single selected node.
-   Distinguish metadata inspection from deep inspection.

For Make references:

-   State that the information came from a repository screenshot.
-   Do not describe screenshot observations as Make source-code access.
-   Do not claim access to Make project internals.

------------------------------------------------------------------------

# 13. No Fabrication Rule

Antigravity MUST NOT:

-   Invent unavailable Figma values.
-   Invent variables.
-   Invent component properties.
-   Invent responsive behavior not supported by the available source.
-   Claim a screenshot represents source code.
-   Claim Figma Make source access when only screenshots are available.
-   Claim full Design inspection when only metadata or a selected scope
    was inspected.
-   Claim a design decision was verified without evidence.

When information is unavailable, explicitly report:

``` text
NOT VERIFIED
```

and explain what evidence is missing.

------------------------------------------------------------------------

# 14. Required Post-Implementation Review

After implementing a Figma-based UI:

1.  Verify the implementation against the relevant Figma Design source.
2.  Use the appropriate Figma MCP inspection when exact Design
    information is required.
3.  Compare against the relevant Figma Make screenshot when a Make
    visual reference exists.
4.  Check reuse of existing ElectroHub components.
5.  Check that existing design tokens were reused.
6.  Check responsive behavior against available references.
7.  Identify visual or behavioral deviations.
8.  Report deviations instead of silently accepting them.

The final implementation report SHOULD state:

``` text
FIGMA SOURCE:
FIGMA DESIGN / FIGMA MAKE SCREENSHOT

MCP VERIFICATION:
VERIFIED / PARTIALLY VERIFIED / NOT VERIFIED

VISUAL COMPARISON:
PASS / PASS WITH DEVIATIONS / NOT PERFORMED

KNOWN DEVIATIONS:
- ...
```

------------------------------------------------------------------------

# 15. Critical Distinction

The following rules are mandatory:

``` text
FIGMA DESIGN
    = LIVE DESIGN SOURCE
    = designlink / Figma MCP
    = NO exportfigmaframespng
    = NO repository screenshots
```

``` text
FIGMA MAKE
    = VISUAL REFERENCE ONLY
    = REPOSITORY SCREENSHOTS
    = NO .make
    = NO exportfigmaframespng
    = NO exportpng
    = NO makelink
```

The two workflows MUST remain separate.

------------------------------------------------------------------------

# 16. Final Antigravity Policy

``` text
ELECTROHUB FIGMA ACCESS POLICY

FIGMA DESIGN:
- Use designlink / connected Figma MCP.
- Treat as the authoritative design source.
- Use selection-scoped MCP inspection when required.
- Do not use exportfigmaframespng.
- Do not maintain repository screenshots as a substitute for Design.

FIGMA MAKE:
- Use repository screenshots only.
- Treat as visual reference only.
- Do not use .make files.
- Do not use exportfigmaframespng.
- Do not use exportpng.
- Do not use makelink.
- Do not extract Make source resources.
- Do not claim Make implementation/source access.

IMPLEMENTATION:
- Reuse ElectroHub design tokens and shared components.
- Translate Figma values into the existing design system.
- Do not blindly copy generated Figma/Tailwind output.
- Report source and evidence.
- Report conflicts and deviations.
- Never fabricate unavailable information.
```

------------------------------------------------------------------------

## 17. Summary

The ElectroHub Figma workflow intentionally uses **two different access
models**:

  -------------------------------------------------------------------------------
  Resource          Antigravity       Role              Prohibited
                    Access                              
  ----------------- ----------------- ----------------- -------------------------
  **Figma Design**  `designlink` /    Authoritative     `exportfigmaframespng`,
                    Figma MCP         live design       repository screenshots
                                      source            

  **Figma Make**    Repository        Visual reference  `.make`,
                    screenshots       only              `exportfigmaframespng`,
                                                        `exportpng`, `makelink`,
                                                        source extraction
  -------------------------------------------------------------------------------

This separation is mandatory for all Antigravity UI implementation and
review work.
