# ElectroHub — TASK-01.3 Principal Architect Review & Remediation Prompt

## TASK

Task ID: `TASK-01.3-frontend-foundation`  
Repository: `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`  
Source branch: `frontend-foundation`  
Target branch: `develop`  
Reviewed implementation commit: `6146651`  
Develop base at review: `6c94cce`

The reviewed implementation received:

**68/100 — ⚠️ REQUEST CHANGES**

This prompt is the remediation gate. Do not treat the existing implementation as approved.

---

## 1. ROLE

Act as a **Senior Frontend Engineer working under a Principal Software Architect review**.

Your objective is to fix every material issue identified in the TASK-01.3 review, verify the fixes with real evidence, and leave `frontend-foundation` approval-ready.

Do not optimize for getting an "APPROVE" result. Optimize for a correct, secure, maintainable, testable foundation.

---

## 2. MANDATORY START

Before changing anything:

1. Read repository-root `AGENTS.md`.
2. Read the Fixed Developer Prompt if present.
3. Read `docs/tasks/Phase-01/TASK-01.3-Frontend-Foundation.md`.
4. Read relevant architecture, engineering, quality, and design documentation.
5. Inspect the actual current branch and working tree.
6. Inspect the current `develop` base.
7. Inspect the actual current implementation; do not trust the old walkthrough.
8. Do not overwrite unrelated user changes.
9. Never fabricate test, CI, Figma, database, Stripe, Sentry, or deployment evidence.

Run and inspect:

```bash
git status
git branch --show-current
git log --oneline --decorate -5
git diff
git diff develop...HEAD
```

---

## 3. ORIGINAL FOUNDATION REQUIREMENT

The frontend foundation must provide:

```text
React
TypeScript
Vite
React Router
SCSS
CSS Modules
SCSS 7-1 architecture
Radix UI primitives
Lucide React
Framer Motion
```

Installed packages alone do not satisfy this requirement.

The foundation must be configured, integrated, reusable, accessible, tested, documented, and consistent with ElectroHub's architecture.

---

# 4. P0 — FIX REDUCED-MOTION COMPLIANCE

### Problem

The Dialog uses Framer Motion animations but does not actually implement `prefers-reduced-motion`, despite the implementation claiming it does.

### Required

Implement genuine reduced-motion support using the installed Framer Motion version and an appropriate project-level approach.

Users requesting reduced motion must not receive unnecessary scale/position/opacity animation.

Do not solve this with comments only.

If the project benefits from a reusable motion convention, keep the abstraction small and justified.

### Verify

Test or otherwise provide concrete evidence for:

- normal motion
- reduced-motion behavior

Report exactly what was verified.

---

# 5. P0 — REMOVE HOMEPAGE INLINE STYLING

### Problem

`HomePage.tsx` currently contains inline styles and hardcoded design values such as:

```tsx
style={{ padding: '2rem' }}
```

and:

```tsx
backgroundColor: '#2563eb'
```

This bypasses the SCSS/CSS Modules/design-token architecture.

### Required

Refactor the foundation/demo HomePage to use:

- CSS Modules
- existing SCSS/design tokens
- existing shared UI primitives where appropriate

Do not duplicate Button styling.

Do not introduce arbitrary colors, spacing, radii, or typography.

The final HomePage must contain no inappropriate inline visual styling.

---

# 6. P0 — ADD MEANINGFUL FOUNDATION TESTS

### Problem

The previous implementation added no automated tests despite introducing routing and Radix Dialog behavior.

### Required

Use the existing project test framework if one exists.

Do not introduce a new framework without justification.

At minimum test behavior for:

### Routing

```text
/ → HomePage
unknown route → NotFoundPage
```

### Dialog

Cover appropriate behavior such as:

- opens
- closes
- trigger works
- close control works
- accessible title/description relationship
- keyboard interaction

Tests must verify behavior rather than implementation details.

Do not weaken assertions or remove tests to obtain passing results.

---

# 7. P1 — CORRECT DIALOG DESIGN TOKENS

### Problem

The Dialog currently uses:

```scss
border-radius: $radius-lg;
```

while `$radius-lg` is 8px, whereas the finalized ElectroHub modal treatment uses 12px.

### Required

Use the correct semantic modal/dialog radius token.

Do not arbitrarily change unrelated radius tokens.

Avoid hardcoding the value when the design-token architecture provides a better solution.

---

# 8. P1 — RESOLVE `@radix-ui/react-slot`

Inspect actual usage.

If Slot is genuinely required by the shared UI foundation:

- establish a small legitimate reusable integration.

If it is not required:

- remove `@radix-ui/react-slot`
- synchronize the lockfile.

Do not retain unused dependencies merely because they might be useful later.

---

# 9. P1 — REVIEW SCSS `additionalData`

Current Vite configuration injects:

```ts
@use "@/styles/abstracts" as *;
```

into every SCSS file.

This creates implicit coupling.

### Required

Evaluate the architecture rather than blindly changing it.

Prefer explicit Sass dependencies where practical.

If `additionalData` is retained, ensure:

- it is intentional
- it does not create namespace problems
- the convention is documented

If removed, update affected SCSS files and verify the build.

Do not break existing SCSS compilation.

---

# 10. P2 — ALIGN FOCUS RING

The ElectroHub design system uses:

```text
2px focus ring
2px offset
```

Align Dialog focus behavior with the established system.

Preserve Radix keyboard/focus management.

Do not remove focus indicators.

Use existing focus tokens where appropriate.

---

# 11. P2 — LUCIDE ACCESSIBILITY

For purely decorative icons, use:

```tsx
aria-hidden="true"
```

Examples:

- Dialog close icon
- 404 Home icon

Do not mark an icon hidden if it is the only accessible representation of an action or information.

---

# 12. P2 — REVIEW NOT-FOUND DESIGN VALUES

Inspect `NotFoundPage.module.scss`.

Any arbitrary visual values must either:

- use an existing design token, or
- be supported by actual Figma evidence, or
- have a clear documented reason.

Do not redesign the page unnecessarily.

---

# 13. FIGMA VERIFICATION

Use these fixed sources:

Figma Design:

https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?m=auto&t=LXiqpv5AACaZ00jo-6

Figma Make:

https://www.figma.com/make/6Y4bdXmEreL8v1Fq2nYDA1/Audit-ElectroHub-Design?t=LXiqpv5AACaZ00jo-6

Rules:

- Figma Design is authoritative.
- Figma Make is supporting/reference material.
- Do not claim inspection unless the relevant node/frame/component was actually accessible.
- Do not invent values.

For this remediation, verify where relevant:

- modal/dialog radius
- typography
- colors
- focus treatment
- spacing
- responsive behavior

Report:

```text
VERIFIED
PARTIALLY VERIFIED
NOT VERIFIED
```

---

# 14. DESIGN SYSTEM COMPLIANCE

Preserve the established ElectroHub foundation:

```text
Primary: #2563EB
Primary hover: #1D4ED8
Primary foreground: #FFFFFF
Accent: #06B6D4
Poppins UI typography
JetBrains Mono data typography
4px spacing foundation
2px focus ring
2px focus offset
established control sizing
established radius system
```

Do not introduce:

- Tailwind
- another CSS framework
- another router
- another component library
- duplicate design tokens

---

# 15. SCSS 7-1 REVIEW

Expected direction:

```text
styles/
├── abstracts/
├── base/
├── components/
├── layout/
├── pages/
├── themes/
├── vendors/
└── main.scss
```

Do not create empty files merely for appearance.

Each layer must have a clear responsibility.

Ensure:

- deterministic import order
- no circular Sass dependencies
- controlled global CSS
- CSS Modules compatibility

If a layer is intentionally only scaffolding, document that honestly.

---

# 16. DEPENDENCY REVIEW

Inspect:

```text
apps/frontend/package.json
package-lock.json
```

Confirm actual usage of:

```text
React 19
TypeScript
Vite
React Router
Sass
Radix UI
Lucide React
Framer Motion
```

Do not upgrade unrelated dependencies.

Do not reinstall packages unnecessarily.

Remove dependencies introduced by this task that are genuinely unused.

Keep lockfile synchronized.

---

# 17. ARCHITECTURE / SCOPE CONTROL

Before creating an abstraction, ask:

1. Does it already exist?
2. Is it required by the task?
3. Is it a genuine foundation concern?
4. Is it reusable?
5. Does it introduce coupling?
6. Does it duplicate an existing abstraction?

Keep the remediation localized.

Do not implement customer/admin commerce features.

Do not perform unrelated backend work.

---

# 18. SECURITY REVIEW

Confirm no remediation introduces:

- secrets
- credentials
- unsafe environment handling
- XSS
- unsafe HTML
- exposed internal data
- disabled security controls

No backend/database/payment changes should be introduced unless genuinely required.

---

# 19. API / DATABASE REVIEW

### API

No API changes should be required.

If one appears necessary, stop and report it before expanding scope.

### Database

Expected:

```text
Database migration: NOT REQUIRED
```

Do not introduce Prisma/Supabase changes for this frontend remediation.

---

# 20. PERFORMANCE REVIEW

Check for:

- unnecessary global CSS
- excessive animation
- unnecessary providers
- unnecessary state
- duplicate dependencies
- oversized abstractions

Framer Motion is approved and may remain.

Reduced-motion behavior must be correct.

---

# 21. TESTING / VALIDATION

First inspect actual package-manager/workspace scripts.

Run the appropriate real commands, for example:

```bash
npm run typecheck -w @electrohub/frontend
npm run lint -w @electrohub/frontend
npm run build -w @electrohub/frontend
```

and the actual test command.

Do not blindly copy commands if the repository uses another convention.

Verify where practical:

```text
application starts
root route works
unknown route works
Dialog opens
Dialog closes
keyboard focus works
SCSS compiles
CSS Modules compile
Lucide renders
Radix integration renders
Framer Motion renders
reduced-motion implementation exists
```

Report actual commands and results.

If something cannot be run, state why and mark it NOT VERIFIED.

---

# 22. GITHUB / CI

After changes:

1. Review the final diff.
2. Commit only task-related changes.
3. Push to `frontend-foundation`.
4. Inspect GitHub Actions for the resulting commit.
5. Verify actual workflow results if available.

Distinguish:

```text
LOCAL VERIFIED
REMOTE CI VERIFIED
NOT VERIFIED
```

Never claim CI passed without GitHub evidence.

The previous reviewed commit had no associated workflow runs/statuses, so this must be rechecked after the remediation.

---

# 23. FINAL SELF-REVIEW

Before completion, perform a fresh senior-engineer review.

### Architecture
- coherent?
- reusable?
- no duplicate abstractions?
- no unnecessary Sass coupling?

### Security
- no secrets?
- no unsafe client trust?
- no security regression?

### Performance
- no unnecessary global CSS?
- no excessive motion?
- no dependency bloat?

### UI
- CSS Modules?
- design tokens?
- Figma compliance?

### Accessibility
- keyboard?
- focus?
- reduced motion?
- accessible Dialog?
- icon semantics?

### Tests
- meaningful?
- actually executed?
- assertions behavioral?

### CI
- actually verified?

### Documentation
- conventions synchronized?

---

# 24. APPROVAL GATE

Do NOT declare approval-ready unless all applicable conditions are satisfied:

- [ ] Reduced-motion is genuinely implemented.
- [ ] HomePage has no inappropriate inline styling.
- [ ] HomePage uses design tokens.
- [ ] Meaningful routing tests exist.
- [ ] Meaningful Dialog tests exist.
- [ ] Dialog radius matches the finalized design system.
- [ ] Slot is legitimately used or removed.
- [ ] Focus behavior matches the accessibility system.
- [ ] Decorative icons are handled correctly.
- [ ] SCSS 7-1 architecture is coherent.
- [ ] No unnecessary dependency was introduced.
- [ ] Typecheck passes.
- [ ] Lint passes where configured.
- [ ] Tests pass.
- [ ] Production build passes.
- [ ] Final diff reviewed.
- [ ] Documentation synchronized.
- [ ] Figma status honestly reported.
- [ ] CI status honestly reported.
- [ ] No database migration required.
- [ ] No security regression.
- [ ] No unrelated work.

---

# 25. REQUIRED FINAL HANDOFF

Return exactly:

```text
TASK: TASK-01.3-frontend-foundation

REMEDIATION STATUS: COMPLETE / PARTIAL / BLOCKED

ORIGINAL REVIEW:
68/100 — REQUEST CHANGES

FINAL REVIEW:
Score: __/100
Decision: APPROVE / REQUEST CHANGES / REJECT

ISSUES FIXED
- Reduced motion: ...
- HomePage styling: ...
- Automated tests: ...
- Dialog radius: ...
- Radix Slot: ...
- Sass additionalData: ...
- Focus ring: ...
- Icon accessibility: ...
- NotFoundPage design: ...
- Documentation: ...

IMPLEMENTATION
- ...

FILES CHANGED
- ...

ARCHITECTURE
- ...

DESIGN SYSTEM
- ...

FIGMA
- Status: VERIFIED / PARTIALLY VERIFIED / NOT VERIFIED
- Evidence: ...

RADIX
- ...

LUCIDE
- ...

FRAMER MOTION
- ...

SCSS / CSS MODULES
- ...

ROUTING
- ...

ACCESSIBILITY
- ...

SECURITY
- ...

API COMPATIBILITY
- ...

DATABASE
- No migration required / Details

PERFORMANCE
- ...

TESTS
- Command: ...
- Result: ...

TYPECHECK
- Command: ...
- Result: ...

LINT
- Command: ...
- Result: ...

BUILD
- Command: ...
- Result: ...

CI
- VERIFIED / NOT VERIFIED
- Evidence: ...

DOCUMENTATION
- ...

KNOWN LIMITATIONS
- ...

FINAL RISK
- LOW / MEDIUM / HIGH
```

---

# 26. FINAL PRINCIPLE

**Implement carefully. Verify objectively. Preserve architecture. Never assume. Never fabricate evidence.**

The previous review found real gaps.

Fix them, prove the fixes, review the final diff, and only then report the task as approval-ready.
