# Typography

## 1. Purpose

This document defines the approved ElectroHub typography system.

It records the typography decisions established through the complete
Figma/Figma Make workflow and defines how those decisions should be used
across:

-   Customer interfaces
-   Administrator interfaces
-   Commerce content
-   Forms
-   Navigation
-   Data
-   Pricing
-   Status information
-   Responsive layouts

**Figma is the visual source of truth for typography.** This document
records the approved typography contract for implementation.

------------------------------------------------------------------------

# 2. Typography Source of Truth

The authority chain is:

``` text
Figma Typography Styles / Variables
          ↓
Semantic Typography Roles
          ↓
CSS / SCSS Tokens
          ↓
Components
          ↓
Screens
```

Typography must be implemented through established roles rather than
arbitrary local font values.

------------------------------------------------------------------------

# 3. Font Families

The final approved typography system uses two font families.

## 3.1 UI Font --- Poppins

**Poppins** is the primary UI typeface.

It is used for:

-   Navigation
-   Buttons
-   Forms
-   Headings
-   Body copy
-   Labels
-   Product names
-   General interface content

Approved weights:

``` text
400 — Regular
500 — Medium
600 — Semibold
700 — Bold
```

------------------------------------------------------------------------

## 3.2 Data / Monospace Font --- JetBrains Mono

**JetBrains Mono** is the approved secondary/data typeface.

It is used where a monospace/data treatment improves scanning or
establishes the intended visual hierarchy.

Primary examples include:

-   Prices
-   Numeric data
-   Operational/admin data where appropriate
-   Technical/data-oriented values

Approved weights:

``` text
400 — Regular
500 — Medium
600 — Semibold
700 — Bold
```

Canonical implementation family:

``` css
--font-mono: 'JetBrains Mono', monospace;
```

------------------------------------------------------------------------

# 4. Inter Is Not an Active Design-System Font

**Inter is not part of the active ElectroHub typography system.**

Earlier Figma import/reference artifacts may contain Inter declarations.
Those artifacts are treated as read-only reference material and do not
redefine the active design system.

New design-system work must use:

``` text
Poppins
JetBrains Mono
```

Do not introduce Inter into new components unless the design system is
formally changed.

------------------------------------------------------------------------

# 5. Font Family Tokens

Recommended semantic aliases:

``` css
--font-family-ui: 'Poppins', sans-serif;
--font-family-data: 'JetBrains Mono', monospace;
```

The data family should not be split into duplicate tokens such as:

``` text
--font-mono-regular
--font-mono-medium
--font-mono-semibold
--font-mono-bold
```

Weight is a separate property.

------------------------------------------------------------------------

# 6. Font Weight System

The approved weight range is:

    Weight Name       Typical use
  -------- ---------- -----------------------------------------
       400 Regular    Body, descriptions, normal UI
       500 Medium     Labels, navigation, supporting emphasis
       600 Semibold   Important UI, prices, section emphasis
       700 Bold       Strong headings and high emphasis

Weight must be selected according to hierarchy.

**Do not make every button, label, or variant bold.**

------------------------------------------------------------------------

# 7. Type Scale

The approved base type scale is:

  Token     Size
  ------- ------
  XS        12px
  SM        14px
  MD        16px
  LG        18px
  XL        24px
  2XL       30px
  3XL       36px
  4XL       48px

This scale provides the foundation for semantic roles.

The exact role applied to a screen should follow the approved Figma
composition.

------------------------------------------------------------------------

# 8. XS --- 12px

Primary uses:

-   Fine metadata
-   Compact captions
-   Supporting information
-   Dense admin/table content where appropriate

Because 12px is small, contrast and line-height must be handled
carefully.

------------------------------------------------------------------------

# 9. SM --- 14px

Primary uses:

-   Labels
-   Secondary metadata
-   Supporting text
-   Compact navigation
-   Form helper text

This is commonly used for secondary interface information.

------------------------------------------------------------------------

# 10. MD --- 16px

16px is the primary body/UI baseline.

Typical uses:

-   Body text
-   Standard labels
-   Form values
-   Navigation items
-   Product descriptions

It should remain the default starting point for ordinary interface copy
unless the hierarchy calls for another size.

------------------------------------------------------------------------

# 11. LG --- 18px

18px is used for elevated body/UI content.

Typical uses:

-   Important labels
-   Supporting headings
-   Prominent card information
-   Larger body copy where appropriate

------------------------------------------------------------------------

# 12. XL --- 24px

24px is used for stronger section-level information.

Typical uses:

-   Section headings
-   Prominent prices/data
-   Important interface hierarchy

The Figma work established 24px as the XL size.

------------------------------------------------------------------------

# 13. 2XL --- 30px

30px is an approved major heading size.

Verified line height:

``` text
40px
```

Verified tracking:

``` text
-0.01px
```

Typical uses:

-   Major page/section headings
-   Important product or workflow headings
-   High-level application content

------------------------------------------------------------------------

# 14. 3XL --- 36px

36px provides a larger heading step between 30px and 48px.

Use for:

-   Strong section hierarchy
-   Major marketing/application headings
-   Large content emphasis

It should not be used merely to make ordinary UI text look more
prominent.

------------------------------------------------------------------------

# 15. 4XL --- 48px

48px is the largest approved type-scale value.

Verified line height:

``` text
56px
```

Verified tracking:

``` text
-0.02px
```

The 48px role is appropriate for major visual headings, especially
hero-level or page-level visual hierarchy where the Figma composition
supports it.

------------------------------------------------------------------------

# 16. Semantic Typography Roles

The scale should be consumed through semantic roles.

Recommended roles:

``` text
Display
Heading 1
Heading 2
Heading 3
Heading 4
Body Large
Body
Body Small
Caption
Label
Data
Price
```

The role describes purpose.

The underlying size/weight is selected from the approved type scale.

------------------------------------------------------------------------

# 17. Display

Display typography is reserved for high-level visual statements.

Typical use:

``` text
Hero
Major marketing statement
Primary landing-page message
```

Display text must not become the default style for application pages.

------------------------------------------------------------------------

# 18. Heading 1

Heading 1 establishes the primary page hierarchy.

Examples:

``` text
Products
Checkout
My Orders
Admin Dashboard
```

A page should normally have one clear primary heading.

------------------------------------------------------------------------

# 19. Heading 2

Heading 2 is used for major page sections.

Examples:

``` text
Recommended for You
Order Details
Shipping Information
Payment
Sales Overview
```

------------------------------------------------------------------------

# 20. Heading 3

Heading 3 is used for subsections.

Examples:

``` text
Product Specifications
Payment Information
Delivery Details
```

------------------------------------------------------------------------

# 21. Heading 4

Heading 4 is used for smaller grouped sections where an additional
hierarchy level is genuinely needed.

Avoid unnecessary heading levels.

------------------------------------------------------------------------

# 22. Body Typography

### Body Large

Use for prominent supporting copy or important explanatory content.

### Body

Use for standard application content.

### Body Small

Use for compact supporting content.

### Caption

Use for metadata and low-emphasis information.

### Label

Use for form and control labels.

The hierarchy should remain visually consistent across customer and
admin interfaces.

------------------------------------------------------------------------

# 23. Data Typography

JetBrains Mono should be used selectively for data-oriented
presentation.

Examples:

``` text
$1,299.00
ORD-2026-000184
42
12.5%
```

The purpose is improved numerical/data scanning and the specific visual
language established by the Figma design.

Do not convert ordinary UI copy into monospace without a design reason.

------------------------------------------------------------------------

# 24. Price Typography

Prices are a confirmed use case for the JetBrains Mono treatment.

Example:

``` text
$1,299.00
```

Price weight may use the approved 600 level where the component
hierarchy calls for emphasis.

Do not use arbitrary `font-bold` styling when a semantic price role
already exists.

------------------------------------------------------------------------

# 25. Button Typography

Buttons use Poppins.

Button typography must respect:

-   Button variant
-   Button size
-   Hierarchy
-   State

Important:

``` text
Primary ≠ automatically Bold
Secondary ≠ automatically Bold
Ghost ≠ automatically Bold
Danger ≠ automatically Bold
```

The font weight should come from the approved typography hierarchy.

------------------------------------------------------------------------

# 26. Form Typography

Forms use Poppins for:

-   Labels
-   Inputs
-   Selects
-   Textareas
-   Helper text
-   Validation messages

A consistent relationship should be maintained:

``` text
Label
  ↓
Field
  ↓
Helper / Error
```

Error text must remain readable and sufficiently prominent.

------------------------------------------------------------------------

# 27. Navigation Typography

Navigation uses Poppins.

Navigation hierarchy should distinguish:

``` text
Primary navigation
Secondary navigation
Active navigation
Supporting navigation
```

Active state may use weight and/or approved color treatment, but must
remain accessible.

------------------------------------------------------------------------

# 28. Admin Typography

Admin interfaces use the same global typography system.

Admin-specific differences should come from:

-   Density
-   Layout
-   Data hierarchy
-   Component composition

not from introducing a separate font system.

------------------------------------------------------------------------

# 29. Status and Badge Typography

Status labels use Poppins and should remain compact.

The semantic status variant determines the visual state:

``` text
Success
Warning
Error
Info
Neutral
```

Do not create a separate font treatment for every status.

------------------------------------------------------------------------

# 30. Line Height

Line height must support readability and hierarchy.

Verified Figma values:

``` text
30px type → 40px line height
48px type → 56px line height
```

Other roles should use line heights appropriate to their size and
density rather than a single global line-height.

Avoid overly tight body copy.

------------------------------------------------------------------------

# 31. Letter Spacing

Verified Figma tracking values include:

``` text
30px → -0.01px
48px → -0.02px
```

Tracking is part of the typography role and should not be changed
locally without reason.

Body text should generally retain normal readable spacing.

------------------------------------------------------------------------

# 32. Responsive Typography

Typography must remain readable across:

``` text
Mobile
Tablet
Desktop
Large Desktop
```

Responsive changes should be intentional.

Avoid simply shrinking every heading proportionally.

The Figma responsive composition is the visual reference for deciding
when hierarchy changes.

------------------------------------------------------------------------

# 33. Text Wrapping

Typography must support natural wrapping.

Avoid fixed-height text containers that can clip:

-   Product names
-   Headings
-   Form labels
-   Error messages
-   Order information
-   Navigation labels

Long content should wrap or truncate intentionally according to the
approved design.

------------------------------------------------------------------------

# 34. Text Alignment

Default alignment follows the content language and layout hierarchy.

Typical application alignment:

``` text
Left-aligned UI text
```

Data may use alignment appropriate to scanning, especially numeric
information.

Do not center long-form application text without a clear design reason.

------------------------------------------------------------------------

# 35. Accessibility

Typography must consider:

-   Readable font sizes
-   Sufficient line height
-   Contrast
-   Zoom/reflow
-   Text wrapping
-   Focus visibility
-   Error readability
-   Touch interaction
-   Screen-reader heading structure

Do not encode hierarchy through font size alone.

Use semantic headings in implementation.

------------------------------------------------------------------------

# 36. Typography Tokens

A conceptual implementation layer:

``` css
--font-family-ui: 'Poppins', sans-serif;
--font-family-data: 'JetBrains Mono', monospace;

--text-xs: 12px;
--text-sm: 14px;
--text-md: 16px;
--text-lg: 18px;
--text-xl: 24px;
--text-2xl: 30px;
--text-3xl: 36px;
--text-4xl: 48px;
```

Where line height and tracking are explicitly defined:

``` text
2XL
30px / 40px
tracking -0.01px

4XL
48px / 56px
tracking -0.02px
```

The implementation may use different token naming conventions, but the
semantic mapping must remain clear.

------------------------------------------------------------------------

# 37. Figma Typography Organization

Figma typography should remain organized around:

``` text
Typography
├── Font Families
│   ├── Poppins
│   └── JetBrains Mono
│
├── Weights
│   ├── 400
│   ├── 500
│   ├── 600
│   └── 700
│
└── Type Scale
    ├── XS
    ├── SM
    ├── MD
    ├── LG
    ├── XL
    ├── 2XL
    ├── 3XL
    └── 4XL
```

Semantic text styles may reference these foundations.

------------------------------------------------------------------------

# 38. Verified vs Derived Typography Decisions

### Verified / explicitly established

-   Poppins is the UI font.
-   JetBrains Mono is the approved data/monospace font.
-   400 / 500 / 600 / 700 weights are available/approved.
-   Inter is not part of the active design-system declaration.
-   Type scale is 12px → 48px.
-   30px uses 40px line height and -0.01px tracking.
-   48px uses 56px line height and -0.02px tracking.
-   Price/data presentation uses JetBrains Mono.

### Semantic / derived

-   Exact mapping of every screen heading to H1/H2/H3/H4.
-   Responsive changes to individual type roles.
-   Component-specific weight selection where Figma does not explicitly
    annotate it.
-   Fallback stack.

Derived decisions must remain consistent with the visual hierarchy and
can be refined through implementation QA.

------------------------------------------------------------------------

# 39. Typography Review Rules

Before introducing a new typography value:

1.  Check whether an existing scale value solves the requirement.
2.  Check the Figma reference.
3.  Prefer a semantic role over a local value.
4.  Confirm the weight is within the approved set.
5.  Check line height and wrapping.
6.  Validate responsive behavior.
7.  Update this document if the system itself changes.

Do not introduce arbitrary font sizes such as:

``` text
17px
19px
27px
43px
```

unless a new value is intentionally approved as part of the design
system.

------------------------------------------------------------------------

# 40. Typography Completion Criteria

Typography is considered complete when:

-   UI font is defined.
-   Data font is defined.
-   Weights are defined.
-   Type scale is defined.
-   Heading hierarchy is defined.
-   Body roles are defined.
-   Data/price usage is defined.
-   Line-height rules are defined.
-   Tracking rules are defined.
-   Responsive behavior is defined.
-   Accessibility requirements are addressed.
-   Figma and implementation terminology are aligned.
-   Components do not introduce arbitrary typography values.

------------------------------------------------------------------------

# 41. Typography Principle

> **Use typography as a hierarchy system: Poppins communicates the
> interface, JetBrains Mono emphasizes data, and the approved scale
> keeps the entire product visually coherent.**
# 42. Repository Figma Asset Structure

Typography documentation remains part of `docs/02_Design/`. Figma visual-reference and handoff assets use the single approved repository structure below:

```text
assets/
└── figma/
    ├── FIGMA.md
    ├── FIGMA_IMPLEMENTATION_RULES.md
    ├── FIGMA_REFERENCES.md
    │
    └── exports/
        │
        ├── Components/
        │   ├── README.md
        │   └── screenshots/
        │
        ├── admin/
        │   ├── README.md
        │   └── screenshots/
        │
        └── customer/
            ├── README.md
            └── screenshots/
```

## 42.1 Responsibilities

- `assets/figma/FIGMA.md` — primary repository-side Figma governance and handoff documentation.
- `assets/figma/FIGMA_IMPLEMENTATION_RULES.md` — implementation rules for translating Figma typography into the application.
- `assets/figma/FIGMA_REFERENCES.md` — Figma file, page, frame, prototype, and handoff references.
- `assets/figma/exports/Components/` — component typography reference exports and screenshots.
- `assets/figma/exports/admin/` — administrator typography reference exports and screenshots.
- `assets/figma/exports/customer/` — customer typography reference exports and screenshots.

Do not recreate legacy Figma export categories such as `Layouts/`, `Foundation/`, `screens/`, or `responsive/`.

## 42.2 Screenshot Policy

Figma Design remains authoritative for typography. Figma Make screenshots are supporting visual references for implementation and Antigravity.

Preserve default Figma Make-generated filenames. Do not manually rename screenshots into custom naming patterns.

Responsive typography evidence belongs inside the approved `Components`, `admin`, and `customer` packages rather than a separate responsive export directory.

