# Typography

## 1. Purpose

This document defines the typography system used throughout ElectroHub.

The typography system establishes consistent rules for:

- Font family
- Font weights
- Font sizes
- Heading hierarchy
- Body text
- Labels
- Captions
- Line height
- Letter spacing
- Responsive typography
- Accessibility

Typography should provide a clear visual hierarchy while remaining readable across all supported devices.

---

# 2. Typography Principles

The ElectroHub typography system follows these principles:

### Readability

Text must remain easy to read across supported screen sizes.

### Hierarchy

Typography should clearly communicate the importance and relationship of content.

### Consistency

The same semantic text role should use the same typography rules throughout the application.

### Responsiveness

Typography should adapt appropriately across mobile, tablet, and desktop layouts.

### Accessibility

Font size, contrast, spacing, and scaling should support accessible reading.

### Design-Code Alignment

Figma typography definitions and frontend typography tokens should represent the same design decisions.

---

# 3. Typography Source of Truth

Figma is the source of truth for the approved typography system.

The implementation relationship is:

```text
Figma Typography
       ↓
Typography Tokens
       ↓
SCSS
       ↓
CSS Modules
       ↓
React Components
```

---

# 4. Font Family

The project should use the approved font family defined by the Figma design.

The selected font should provide:

- Good readability
- Multiple required weights
- Consistent rendering
- Appropriate character coverage
- Reliable web delivery

The exact font family should be documented in the approved Figma typography styles and reflected in the implementation.

---

# 5. Font Stack

The implementation should provide appropriate fallbacks.

Conceptually:

```scss
font-family:
  "Primary Font",
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

The final font stack should follow the approved project design.

Fallback fonts should preserve reasonable proportions and readability.

---

# 6. Font Weights

The typography system should use a controlled set of font weights.

Recommended semantic roles:

```text
Regular
Medium
Semibold
Bold
```

Not every component should use every weight.

Weights should be selected according to hierarchy and emphasis.

---

# 7. Typography Scale

The system should define a consistent type scale.

Conceptually:

```text
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
```

The exact values are defined by the approved Figma design tokens.

---

# 8. Display Text

Display typography is reserved for high-level visual headings.

Typical use:

- Landing page hero
- Major marketing section
- Primary visual statement

Display text should not be used for ordinary application headings.

---

# 9. Heading 1

Heading 1 is the primary page-level heading.

Examples:

```text
Products
My Orders
Checkout
Admin Dashboard
```

Each page should normally have a clear primary heading.

---

# 10. Heading 2

Heading 2 is used for major sections within a page.

Examples:

```text
Recommended for You
Order Details
Shipping Information
Payment
```

---

# 11. Heading 3

Heading 3 is used for subsections and grouped content.

Examples:

```text
Product Specifications
Payment Information
Delivery Details
```

---

# 12. Heading 4

Heading 4 is used for smaller content groups where additional hierarchy is required.

It should not be introduced unnecessarily.

---

# 13. Body Text

Body text is the default content typography.

It is used for:

- Descriptions
- Instructions
- Supporting information
- General application content

Body text should prioritize readability over visual density.

---

# 14. Body Large

Body Large may be used for:

- Important introductory text
- Prominent descriptions
- Hero supporting text
- Large form instructions

It should not replace heading styles.

---

# 15. Body Small

Body Small is useful for:

- Secondary descriptions
- Supporting information
- Dense administrative interfaces
- Metadata

Body Small should remain readable and should not be used below accessible minimum sizes.

---

# 16. Caption

Captions are used for secondary supporting information.

Examples:

```text
Updated 5 minutes ago
Last modified
Optional information
Additional metadata
```

Captions should have sufficient contrast and should not be excessively small.

---

# 17. Labels

Labels identify controls and fields.

Examples:

```text
Email
Password
Shipping Address
Payment Method
Quantity
```

Labels must remain associated with their controls.

---

# 18. Button Typography

Buttons should use typography that clearly communicates their action.

Button typography should define:

- Font size
- Font weight
- Line height
- Letter spacing

Primary and secondary buttons should maintain consistent typography.

---

# 19. Navigation Typography

Navigation typography should provide clear hierarchy between:

- Primary navigation
- Secondary navigation
- Active items
- Supporting navigation
- User menu

Active navigation should not rely solely on color.

---

# 20. Product Typography

Product interfaces should use a clear hierarchy.

Recommended order:

```text
Brand
 ↓
Product Name
 ↓
Rating / Metadata
 ↓
Price
 ↓
Availability
 ↓
Supporting Information
```

Product name and price should receive stronger visual emphasis than secondary metadata.

---

# 21. Price Typography

Prices are important commerce information.

The typography system should support:

```text
Current Price
Original Price
Discount
Currency
```

Example conceptual hierarchy:

```text
$899
$999
20% OFF
```

The original price should remain visually secondary to the current price.

---

# 22. Order Typography

Order interfaces should prioritize:

```text
Order Number
 ↓
Order Status
 ↓
Total
 ↓
Products
 ↓
Supporting Information
```

Important order information should remain scannable on both desktop and mobile.

---

# 23. Status Typography

Status labels should be concise and easy to scan.

Examples:

```text
Confirmed
Preparing
Out for Delivery
Delivered

In Stock
Low Stock
Out of Stock

Paid
Pending
Failed
```

Status text should be paired with appropriate visual indicators.

---

# 24. Form Typography

Forms should maintain consistent typography for:

```text
Label
Input
Helper Text
Error Text
Success Text
```

Example:

```text
Email
[ user@example.com ]

We'll use this email for order notifications.

Please enter a valid email address.
```

Error and helper text must remain readable and associated with the correct field.

---

# 25. Table Typography

Administrative tables should use typography optimized for scanning.

Table typography should define:

- Header
- Cell
- Numeric values
- Status
- Supporting metadata

Avoid excessively small table text simply to fit more columns.

---

# 26. Dashboard Typography

Dashboard interfaces should establish a hierarchy between:

```text
Metric
Metric Label
Trend
Supporting Information
```

For example:

```text
$24,850
Revenue

+12.4%
vs previous period
```

---

# 27. AI and Search Typography

AI and image-search interfaces should use typography that clearly communicates:

- Search state
- Processing state
- Results
- Match information
- Recommendation context

Processing messages should remain concise.

---

# 28. Responsive Typography

Typography must adapt to viewport size when necessary.

Typical behavior:

```text
Desktop
Larger headings
More spacious hierarchy

Tablet
Moderate scaling

Mobile
Compact headings
Readable body text
```

Responsive typography should avoid:

- Oversized mobile headings
- Text overflow
- Unnecessary wrapping
- Extremely small supporting text

---

# 29. Line Height

Line height should be appropriate for the text role.

Generally:

```text
Headings
Tighter line height

Body
More generous line height

Captions
Compact but readable
```

The exact values should be defined by the Figma typography tokens.

---

# 30. Letter Spacing

Letter spacing should be used intentionally.

It may be useful for:

- Uppercase labels
- Small metadata
- Certain display styles

Avoid excessive letter spacing in normal body text.

---

# 31. Text Wrapping

Layouts must support natural text wrapping.

Components should account for:

- Long product names
- Long category names
- Long order numbers
- Translated text
- Error messages
- User-generated content

Text should not be clipped without a deliberate UX reason.

---

# 32. Truncation

Truncation may be used when content must fit a constrained UI.

Examples:

```text
Product cards
Tables
Navigation
Compact lists
```

Truncation should not hide critical information when the full content is necessary for decision-making.

Where appropriate, provide a way to access the complete text.

---

# 33. Localization

Typography should support localized content.

The system should account for:

- Different text lengths
- Different scripts
- RTL languages if supported
- Character rendering
- Line wrapping

Layouts must not assume that English text length is representative of every language.

---

# 34. Accessibility

Typography must consider:

- Readable font size
- Adequate line height
- Sufficient contrast
- Clear hierarchy
- Zoom behavior
- Text resizing
- Focus visibility
- Reduced motion where typography interacts with animation

The interface should remain usable when users increase browser or system text size.

---

# 35. Color and Typography

Typography and color must work together.

Important text should not depend only on:

- Font weight
- Color
- Size

Critical information should use multiple appropriate visual cues.

---

# 36. Typography Tokens

The implementation should centralize typography tokens.

Conceptually:

```scss
--font-family-primary
--font-size-display
--font-size-heading-1
--font-size-heading-2
--font-size-body
--font-size-body-small
--font-size-caption

--font-weight-regular
--font-weight-medium
--font-weight-semibold
--font-weight-bold

--line-height-tight
--line-height-normal
--line-height-relaxed
```

The exact values should follow the approved Figma system.

---

# 37. Semantic Typography

Components should use semantic typography roles rather than arbitrary font sizes.

Prefer:

```text
Page Heading
Body
Caption
Label
```

rather than:

```text
font-size: 19px
font-size: 14px
font-size: 11px
```

when an appropriate design token already exists.

---

# 38. Figma Typography Organization

Figma should organize typography styles by semantic role.

Recommended structure:

```text
Typography
├── Display
├── Headings
├── Body
├── Labels
├── Captions
└── Special / Commerce
```

Styles should use clear and consistent names.

---

# 39. Typography Usage Rules

### Do

- Use approved typography tokens.
- Maintain clear hierarchy.
- Respect responsive behavior.
- Support localization.
- Validate readability.
- Keep font weights intentional.
- Use semantic text roles.

### Do Not

- Introduce arbitrary font sizes throughout components.
- Use too many font weights.
- Use extremely small text for dense layouts.
- Rely solely on font weight to communicate meaning.
- Prevent text from wrapping without a deliberate reason.
- Override the design system for isolated screens without approval.

---

# 40. Design Review

Before introducing a new typography style, verify:

1. Does an existing semantic role already meet the requirement?
2. Is the new style required by the design?
3. Does it remain readable across supported viewports?
4. Does it support localization?
5. Is it documented in Figma?
6. Will it be reused?

Avoid creating one-off typography styles.

---

# 41. Typography and Components

Reusable components should consume typography tokens.

Example:

```text
Button
   ↓
Button Typography

Product Card
   ↓
Product Name + Price Typography

Order Card
   ↓
Order Heading + Metadata Typography
```

This keeps typography consistent throughout the application.

---

# 42. Typography Completion Criteria

The typography system is considered complete when:

- Font family is defined.
- Font weights are defined.
- Typography scale is defined.
- Heading hierarchy is defined.
- Body styles are defined.
- Labels and captions are defined.
- Commerce typography is defined.
- Responsive behavior is defined.
- Localization considerations are addressed.
- Accessibility requirements are verified.
- Figma and implementation tokens are aligned.
- Components use semantic typography roles.

---

# 43. Typography Principle

> **Typography should create hierarchy, improve readability, and communicate information clearly without unnecessary visual complexity.**
