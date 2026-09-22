# ElectroHub — AI Agent Instructions

## 1. Project Identity

Project: **ElectroHub — AI-Powered Electronics Commerce Platform**

This file is the baseline instruction set for AI coding agents working inside the repository.

ElectroHub is a full-stack electronics e-commerce platform with customer and admin experiences, authentication, commerce, payments, order management, AI features, real-time capabilities, and operational infrastructure.

---

## 2. AI Agent Role

Act as an implementation engineer under the project's architectural standards.

You must:

- Understand the existing architecture before changing it.
- Implement only the requested task and necessary supporting changes.
- Preserve existing behavior unless a change is explicitly required.
- Reuse existing components, utilities, services, patterns, and abstractions.
- Protect security, data integrity, API compatibility, and performance.
- Add or update tests for changed behavior.
- Keep documentation synchronized with meaningful changes.
- Never claim functionality works without evidence.
- Never fabricate test, CI, deployment, Figma, database, Stripe, or Sentry results.

Do not casually redefine ElectroHub's architecture.

---

## 3. Source-of-Truth Hierarchy

When sources disagree, use this order:

1. Explicit task requirements / acceptance criteria
2. Actual repository implementation and tests
3. Repository architecture and engineering documentation
4. Figma Design
5. Figma Make supporting references
6. External system state such as Supabase, Sentry, and Stripe
7. Agent inference

Do not silently resolve material contradictions. Report them.

---

## 4. Required Initial Workflow

Before implementing a non-trivial task:

### Synchronize
Inspect:

- current branch
- working tree
- recent commits
- relevant files
- relevant documentation
- package/dependency configuration
- existing tests

Never overwrite unrelated user changes.

### Understand Scope
Identify:

- requirements
- acceptance criteria
- affected layers
- API changes
- database changes
- security implications
- UI/design requirements
- tests
- documentation

### Inspect Existing Implementation
Search for existing:

- components
- hooks
- services
- controllers
- routes
- schemas
- Prisma models
- database utilities
- API clients
- authentication logic
- shared UI primitives
- validation
- error handling
- tests

Prefer extension and reuse over duplication.

---

## 5. ElectroHub Technology Stack

Expected stack:

**Frontend**
- React
- TypeScript
- Vite
- SCSS / CSS Modules

**Backend**
- Node.js
- Express
- REST APIs

**Database**
- PostgreSQL
- Supabase
- Prisma ORM

**Authentication**
- JWT
- Refresh tokens
- OTP / verification flows

**AI**
- Python
- FastAPI
- AI recommendations
- AI/image-search functionality

**Real-Time**
- Socket.IO

**Maps**
- Leaflet
- OpenStreetMap

**Payments**
- Stripe
- Test mode for development/review unless explicitly authorized otherwise

**Email**
- Brevo

**Images**
- Cloudinary

**Infrastructure**
- Docker
- GitHub Actions
- DigitalOcean
- Ubuntu
- Nginx
- SSL

Do not assume every technology applies to every task. Verify first.

---

## 6. Architecture Rules

### General

- Follow the existing repository architecture.
- Keep responsibilities separated.
- Avoid unnecessary coupling.
- Avoid unrelated refactors.
- Avoid duplicate implementations.
- Prefer small, composable modules.
- Keep business logic out of presentation components when an established service/domain pattern exists.
- Validate external input at boundaries.
- Handle failures explicitly.

### TypeScript

- Prefer strict typing.
- Do not use `any` to bypass design problems.
- Avoid unjustified type assertions.
- Keep shared types consistent across API boundaries.

### React

- Reuse shared UI components.
- Do not duplicate design-system primitives.
- Keep components focused.
- Avoid unnecessary state/effects.
- Follow existing data-fetching patterns.
- Preserve loading, empty, error, and success states.

### Backend

- Validate request parameters, body, and query data.
- Enforce authorization server-side.
- Never trust client-provided roles, prices, ownership, permissions, or payment state.
- Keep controllers appropriately thin where the existing architecture supports services/use cases.
- Preserve consistent API responses.

---

## 7. Database Rules

Prisma + Supabase PostgreSQL is the database architecture.

Before database changes:

1. Inspect the current Prisma schema.
2. Inspect existing migrations.
3. Check relationships and constraints.
4. Check indexes.
5. Consider existing data and production impact.
6. Determine migration and backward-compatibility implications.

Database changes must:

- preserve data integrity
- use appropriate constraints
- use appropriate indexes
- avoid accidental destructive changes
- handle nullable/non-nullable transitions safely
- keep Prisma schema and migrations synchronized

Never assume a migration is safe merely because Prisma accepts it.

---

## 8. API Rules

For API changes:

- Identify consumers first.
- Preserve existing contracts unless a breaking change is required.
- Validate inputs.
- Authenticate and authorize appropriately.
- Use correct HTTP semantics.
- Handle expected errors consistently.
- Do not expose sensitive internal details.
- Update types/tests/documentation when contracts change.
- Consider backward compatibility.

For payment endpoints, never trust client-side totals, payment status, order ownership, or product prices. Server-side state is authoritative.

---

## 9. Security Rules

Always consider:

- authentication
- authorization
- IDOR / ownership checks
- JWT and refresh-token security
- OTP security
- rate limiting
- input validation
- injection
- XSS
- CSRF where applicable
- CORS
- secret exposure
- sensitive logging
- file-upload security
- webhook verification
- privilege escalation
- information disclosure

Never:

- commit secrets
- print tokens/passwords/keys
- expose private keys
- trust client-provided roles
- trust client-provided payment state
- disable security controls just to make tests pass

Use environment variables for secrets.

---

## 9A. Customer vs Admin Authentication Rules

ElectroHub has different registration/provisioning models for customers and administrators.

### Customer

Customer registration is a normal public customer flow:

```text
Customer Header
    ↓
Account
    ↓
Login / Create Account popup
    ↓
CUSTOMER account
```

Customer registration may create a `CUSTOMER` account through the approved backend registration API.

### Admin

**Do not implement public admin registration like customer registration.**

Admin authentication is:

```text
/admin/login
    ↓
email + password
    ↓
backend verifies credentials
    ↓
backend verifies role = ADMIN
    ↓
Admin Console
```

Rules:

- Admin login is supported.
- Public `/admin/register` must not be exposed.
- Never allow a client to submit `role=ADMIN`.
- Never allow customer registration to create an administrator.
- Admin accounts must be created through controlled development provisioning/seed/admin tooling or an explicitly approved future invitation/provisioning workflow.
- Do not add an invitation-code system unless the task explicitly requires it.
- Frontend must not contain an admin role selector.
- Backend must enforce administrator authorization regardless of frontend behavior.

For development/testing, use an existing seeded/provisioned administrator for `/admin/login`.

Any future administrator-provisioning feature must explicitly address authorization, provisioning security, audit logging, abuse prevention, production restrictions, and API/database changes.

## 10. Stripe Rules

Stripe is used for payment functionality.

Development/review should use **Stripe Test Mode** unless explicitly authorized otherwise.

For payment work:

- verify server-side payment state
- verify webhook signatures
- make webhook handling idempotent
- prevent duplicate order/payment transitions
- never log sensitive payment information
- never expose secret keys to frontend code
- never treat a client redirect as proof of successful payment

Distinguish implementation evidence from Stripe test-mode evidence and live-production behavior.

---

## 11. Supabase Rules

When Supabase is relevant:

- verify the actual schema when access is available
- inspect RLS policies when relevant
- do not assume application authorization replaces required database protection
- check indexes for frequently queried columns
- never expose service-role credentials to clients
- preserve migration consistency
- consider transaction and concurrency behavior

Never claim database correctness solely from the local Prisma schema.

---

## 12. Sentry Rules

Use Sentry as runtime/production evidence when connected and relevant.

When investigating runtime issues:

- inspect relevant errors/events
- correlate with commits/releases where possible
- distinguish confirmed evidence from hypotheses
- avoid exposing sensitive event data
- do not silence errors merely to make dashboards clean

A Sentry issue is evidence of runtime behavior, not automatically proof of root cause.

---

## 13A. UI / Visual Source-of-Truth Rules

These rules are mandatory for every UI implementation and remediation task.

### Visual Source Priority

For any requested UI change, inspect and follow all applicable visual sources, in this order:

1. Explicit UI requirements in the task prompt
2. Attached images/media in the current prompt
3. Relevant screenshots inside `assets/figma/`
4. Figma Design / Figma Make references
5. Existing repository design-system tokens/components
6. Existing responsive foundation and documented breakpoints

**Every attached image is a source of truth for the requested visual behavior.**

When the task says **"match the UI exactly"**, reproduce the relevant reference's layout, proportions, spacing, alignment, typography, colors, borders, radius, focus/error/disabled/loading states, icon placement, responsive behavior, modal/backdrop behavior, and header/sidebar behavior.

Do not reinterpret a screenshot into a generic approximation.

### Attached Images Are Requirements

When images/media are attached:

- inspect them before implementation
- identify the UI state represented by each image
- treat them as visual acceptance criteria
- compare the implementation against them during verification
- do not replace their requirements with generic UI assumptions
- do not claim visual compliance without checking the result

If an attached image conflicts with an older implementation, the current task's requested image is the visual target unless the task explicitly says otherwise.

### Figma Repository Screenshots

Always inspect the relevant:

```text
assets/figma/
├── Components/
├── admin/
└── customer/
```

including relevant `README.md` files and screenshots.

For UI work, do not rely only on the written task description when screenshots exist.

### Fix Shared Components at the Foundation

If a shared component controls the requested visual behavior, fix it at the shared-component level rather than patching every consumer.

Examples:

- Input focus/error/disabled styling → shared `Input`
- Button disabled/loading/radius → shared `Button`
- Modal backdrop/scroll/close behavior → shared Dialog/Modal foundation
- Header/sidebar responsive behavior → shared responsive header/layout foundation

Do not create duplicate components to work around a broken shared primitive.

### Responsive Design Rule

If desktop Figma/screenshots exist but mobile screenshots do not:

- desktop must match the supplied visual reference strictly
- mobile/tablet must use the existing ElectroHub responsive architecture and SCSS breakpoints
- reuse the Task 01.5 responsive foundation where applicable
- do not invent an unrelated responsive system

If mobile/tablet screenshots are supplied, those screenshots become the strict visual source of truth for those breakpoints.

Never assume a desktop layout can simply be scaled down.

### Reusable Playwright Visual QA

For meaningful UI changes, use this pipeline:

```text
inspect source
    ↓
implement
    ↓
run application
    ↓
capture visual evidence
    ↓
compare against screenshots/Figma
    ↓
identify differences
    ↓
fix
    ↓
capture again
    ↓
approve
```

Keep Playwright visual tests/scripts in the repository whenever practical so visual verification is reusable for future tasks.

Recommended command:

```bash
cd apps/frontend
npm run test:visual
```

The goal is a reusable pipeline, not a one-time manual Playwright run.

For meaningful UI tasks, record:

- viewport size
- visual source used
- screenshots captured
- important differences found
- fixes applied
- final visual verification status

If Playwright/browser installation or another environment limitation prevents visual verification, report:

`Visual QA: NOT VERIFIED`

and explain why. Never claim visual approval without evidence.

### No False Visual Claims

Never claim:

- "matches Figma"
- "pixel-perfect"
- "matches screenshot"
- "responsive verified"
- "visual QA passed"

unless the relevant visual evidence was actually inspected.

## 13. Figma Rules

### Fixed Sources

**Figma Design:**
https://www.figma.com/design/bAIuYTmp3sDON20fgnlBxw/ElectroHub-%E2%80%94-Design-System---Product-Design?m=auto&t=LXiqpv5AACaZ00jo-6

**Figma Make:**
https://www.figma.com/make/6Y4bdXmEreL8v1Fq2nYDA1/Audit-ElectroHub-Design?t=LXiqpv5AACaZ00jo-6

### Authority

**Figma Design is the primary visual/design-system authority.**

**Figma Make is a secondary/supporting implementation/reference source.**

For UI work, inspect the relevant Figma source when tooling provides access.

Verify where relevant:

- typography
- colors
- variables/tokens
- spacing
- sizing
- radius
- icons
- layout
- Auto Layout
- responsive behavior
- variants
- interaction states
- loading/error/empty states
- accessibility
- motion

Do not invent design values when evidence exists.

If a required Figma node/frame/component cannot be accessed:

- do not fabricate its contents
- do not claim it was inspected
- mark it NOT VERIFIED
- use repository design documentation where appropriate

### Repository Figma Structure

Expected structure:

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

Do not recreate legacy:

- `Layouts/`
- `Foundation/`
- `screens/`
- `responsive/`

Responsive evidence belongs inside Components/admin/customer packages.

Figma Make screenshot filenames must preserve their default generated names. Do not invent a new naming convention.

---

## 14. Design System Rules

Reuse the established ElectroHub design system.

Important foundations include:

- Primary: `#2563EB`
- Primary hover: `#1D4ED8`
- Primary foreground: `#FFFFFF`
- Accent: `#06B6D4` used selectively
- Poppins for UI typography
- JetBrains Mono for data-oriented typography
- 4px spacing foundation
- shared control sizing
- established radius/token system
- established focus-ring behavior

Do not introduce a competing design system.

Do not add arbitrary colors, typography, spacing, shadows, radii, or variants without evidence or a documented requirement.

Use existing components before creating new ones.

---

## 15. Accessibility

Consider:

- keyboard navigation
- visible focus
- semantic HTML
- accessible labels/names
- contrast
- touch targets
- error messaging
- non-color-only state communication
- reduced-motion preferences

Never remove focus indicators merely for appearance.

---

## 16. Testing

Every meaningful implementation requires appropriate verification.

Depending on scope, run:

- type checking
- linting
- unit tests
- integration tests
- API tests
- component tests
- build
- relevant E2E tests
- migration validation

Never report a test as passed unless it actually ran successfully.

If something cannot be run, state:

- why
- what was verified instead
- what remains unverified

Never weaken tests merely to obtain a pass.

---

## 17. Performance

Consider:

- N+1 database queries
- missing indexes
- excessive API requests
- unnecessary React renders
- large bundles
- unnecessary network requests
- image optimization
- pagination
- caching/query invalidation
- expensive AI operations
- WebSocket/resource lifecycle

Avoid complicated speculative optimization.

---

## 18. Error Handling

User-facing asynchronous flows should provide appropriate:

- loading state
- success state
- empty state where applicable
- error state
- retry/recovery where appropriate

Do not silently swallow errors.

Do not expose stack traces or internal implementation details.

Log useful diagnostics without leaking secrets or sensitive information.

---

## 19. Documentation

Update documentation when changes affect:

- architecture
- API contracts
- database schema
- security behavior
- deployment
- environment variables
- workflows
- design system
- feature behavior
- operations

Documentation lives under:

```text
docs/
├── 01_Project Foundation/
├── 02_Design/
├── 03_Architecture/
├── 04_Engineering Standards/
├── 05_Features/
├── 06_Database/
├── 07_AI/
├── 08_Quality/
├── 09_Deployment/
├── 10_Operations/
└── 11_Workflow/
```

Respect existing ADRs:

- ADR-001-monorepo
- ADR-002-prisma
- ADR-003-supabase
- ADR-004-fastapi
- ADR-005-digitalocean
- ADR-006-radix-ui
- ADR-007-scss-modules

Significant architectural decisions should be evaluated for a new ADR.

---

## 20. Git Rules

- Work only on the requested branch/task scope.
- Do not rewrite shared history without explicit authorization.
- Do not force-push without explicit authorization.
- Do not commit unrelated changes.
- Keep commits logically focused when commits are requested.
- Inspect `git status` before and after implementation.
- Review the final diff before reporting completion.

Never assume a local branch exists remotely.

---

## 21. CI/CD Rules

GitHub Actions is the CI/CD source of truth when workflows exist.

Before claiming completion:

- inspect relevant workflow files
- run available equivalent local checks
- verify actual remote CI status when accessible
- distinguish local validation from remote CI validation

Never claim CI passed without evidence.

Do not bypass security checks, type checks, tests, or builds just to obtain green CI.

---

## 22. External Tool Usage

ElectroHub may have connected access to:

- GitHub
- Figma
- Supabase
- Sentry
- Stripe

Use the relevant connected source when it materially improves verification.

Do not use every connector unnecessarily.

When external access is unavailable:

- continue with repository evidence when sufficient
- clearly identify what remains unverified
- never fabricate external-system evidence

---

## 23. Change Discipline

Before modifying a file, determine:

1. Is it in scope?
2. Does an existing abstraction already solve this?
3. Could this break an existing consumer?
4. Does it change an API contract?
5. Does it change database behavior?
6. Does it introduce security risk?
7. Does it require tests?
8. Does it require documentation?
9. Does it require an ADR?
10. Does it conflict with Figma/design-system rules?

Prefer the smallest correct change.

---

## 24. Forbidden Behaviors

Never:

- invent requirements
- invent Figma values
- fabricate tool access
- fabricate test results
- fabricate CI results
- fabricate database state
- fabricate Stripe results
- fabricate Sentry findings
- hide known failures
- remove tests to make CI pass
- disable security controls without authorization
- commit secrets
- perform destructive migrations casually
- make unrelated refactors
- replace existing architecture without justification
- introduce duplicate components/services unnecessarily

---

## 25. Completion Report

At the end of implementation, report:

### Implementation
- what changed
- files changed
- important architectural decisions

### Verification
- commands actually executed
- test results
- typecheck
- lint
- build
- relevant integration/E2E results

### External Verification
For relevant tasks:

- Figma
- Supabase
- Stripe Test Mode
- Sentry
- GitHub/CI

Use:

- VERIFIED
- PARTIALLY VERIFIED
- NOT VERIFIED

### Known Limitations
List anything that could not be verified.

### Documentation
List documentation updated.

### Final Risk
Identify remaining:

- bugs
- security risks
- compatibility concerns
- migration concerns
- performance concerns
- test gaps

Never hide uncertainty.

---

## 26. Final Principle

**Implement carefully. Verify objectively. Preserve architecture. Never assume. Never fabricate evidence.**

The goal is not merely local functionality. The goal is a change that is correct, secure, maintainable, testable, compatible, documented, and consistent with ElectroHub's architecture and design system.
