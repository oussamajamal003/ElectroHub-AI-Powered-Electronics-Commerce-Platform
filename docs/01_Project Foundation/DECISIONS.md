# Architectural Decisions

## 1. Purpose

This document records significant architectural and technology decisions made for ElectroHub.

The purpose of maintaining these decisions is to:

- Preserve the reasoning behind important choices.
- Prevent repeated architectural debates.
- Make project constraints explicit.
- Provide context for future development.
- Keep implementation aligned with the approved architecture.
- Document alternatives that were considered or intentionally rejected.

Significant architectural changes should be recorded as new decisions rather than silently changing an existing decision.

---

# 2. Decision Status

Each decision may use one of the following statuses:

```text
Proposed
Accepted
Superseded
Deprecated
Rejected
```

Current approved decisions are marked **Accepted**.

---

# 3. ADR-001 — Monorepo Architecture

**Status:** Accepted

## Decision

ElectroHub will use a single monorepo containing:

```text
apps/
├── frontend/
├── backend/
└── ai-service/
```

alongside:

```text
docs/
infrastructure/
.github/
```

## Reasoning

The frontend, backend, and AI service belong to the same product and are developed as a coordinated system.

A monorepo provides:

- Centralized project management.
- Shared documentation.
- Coordinated development.
- Easier cross-service changes.
- Unified CI/CD.
- A single source repository.
- Clear product-level versioning.

## Consequences

### Positive

- Easier project-wide changes.
- Centralized documentation.
- Consistent development workflow.
- Simplified CI/CD management.

### Negative

- Repository structure requires clear service boundaries.
- Dependency ownership must be controlled.
- CI/CD may require service-specific workflows.

---

# 4. ADR-002 — React + TypeScript + Vite

**Status:** Accepted

## Decision

The frontend will use:

```text
React
TypeScript
Vite
```

## Reasoning

This combination provides:

- Component-based UI development.
- Strong type safety.
- Fast local development.
- Modern production builds.
- Good ecosystem support.
- Suitable portfolio and production-oriented architecture.

## Consequences

Frontend implementation must maintain strong TypeScript usage and avoid unnecessary `any` types.

---

# 5. ADR-003 — Custom SCSS + CSS Modules

**Status:** Accepted

## Decision

ElectroHub will use:

```text
SCSS
CSS Modules
SCSS 7-1 architecture
```

for application styling.

## Reasoning

The project requires a custom visual identity based on the Figma design.

The styling approach provides:

- Component-scoped styles.
- Structured global styles.
- Reusable design tokens.
- Maintainable styling organization.
- Full control over the visual system.

## Explicitly Rejected

The project will not use:

- Tailwind CSS
- shadcn/ui
- Bootstrap
- Material UI visual styling

## Consequences

The project owns more of the styling implementation than it would with a complete visual UI framework.

This increases implementation responsibility but preserves the intended custom design.

---

# 6. ADR-004 — Radix UI for Behavior Primitives

**Status:** Accepted

## Decision

Radix UI will be used for accessible interaction primitives.

Examples include:

- Dialogs
- Dropdown menus
- Popovers
- Tooltips
- Select controls
- Tabs

## Reasoning

Radix UI provides accessible behavior without forcing a visual design system.

This allows:

```text
Radix UI
   ↓
Behavior + Accessibility

SCSS / CSS Modules
   ↓
Visual Design
```

## Consequences

The project remains responsible for styling and visual consistency.

---

# 7. ADR-005 — Prisma ORM

**Status:** Accepted

## Decision

Prisma will be the backend ORM and primary database access layer.

## Reasoning

Prisma provides:

- Type-safe database access.
- Schema management.
- Migrations.
- Relationship handling.
- Strong TypeScript integration.
- Clear database models.

## Consequences

Backend database access should be centralized through Prisma rather than distributed raw SQL throughout application services.

---

# 8. ADR-006 — Supabase PostgreSQL

**Status:** Accepted

## Decision

PostgreSQL hosted through Supabase will be used as the application's primary database.

## Reasoning

The application requires a relational database for:

- Users
- Products
- Categories
- Inventory
- Carts
- Wishlists
- Orders
- Payments
- Deliveries
- Recommendation data
- Search-related data
- Analytics

Supabase provides managed PostgreSQL infrastructure while allowing the application to retain PostgreSQL as the underlying relational database.

## Consequences

The database remains an external managed service.

Prisma remains the application database access layer.

---

# 9. ADR-007 — FastAPI AI Service

**Status:** Accepted

## Decision

AI functionality will be isolated in a dedicated FastAPI service.

```text
Frontend
    ↓
Express Backend
    ↓
FastAPI AI Service
```

## Reasoning

AI processing has different runtime and dependency requirements from the main Node.js backend.

Separating it provides:

- Service isolation.
- Independent AI dependencies.
- Clear API boundaries.
- Easier future model replacement.
- Reduced coupling with commerce logic.

## Consequences

The AI service must not own core commerce business logic.

The backend remains responsible for the application's authoritative business operations.

---

# 10. ADR-008 — DigitalOcean Production VPS

**Status:** Accepted

## Decision

DigitalOcean will be the planned production cloud provider.

The production application will run on an Ubuntu VPS.

## Planned architecture

```text
Internet
   ↓
Nginx
   ↓
DigitalOcean Ubuntu VPS
   ↓
Docker
   ├── Frontend
   ├── Backend
   └── AI Service
```

## Reasoning

The VPS approach provides:

- Production-oriented deployment experience.
- Direct infrastructure control.
- Docker support.
- Nginx reverse-proxy configuration.
- SSL configuration.
- Practical portfolio value.
- A relatively simple deployment architecture.

Production infrastructure is intentionally deferred until Phase 06.

---

# 11. ADR-009 — Figma as Design Source of Truth

**Status:** Accepted

## Decision

Figma will be the primary source of truth for the intended visual design.

## Reasoning

The project requires a complete custom UI/UX system.

Figma will define:

- Layouts
- Components
- Typography
- Colors
- Spacing
- Responsive behavior
- States
- Motion direction
- User flows

## Consequences

Frontend implementation should follow approved Figma designs.

When implementation intentionally deviates from the design, the deviation should be documented or reviewed.

---

# 12. ADR-010 — Stripe Test Mode

**Status:** Accepted

## Decision

Stripe will be integrated using Test Mode.

## Reasoning

The project requires a realistic checkout and payment workflow without processing real customer payments.

Stripe Test Mode provides:

- Checkout integration.
- Payment processing simulation.
- Payment status.
- Payment confirmation.
- Demonstrable payment workflows.

## Consequences

No real customer payment processing is required for the portfolio implementation.

Stripe secrets must remain in environment variables.

---

# 13. ADR-011 — Brevo Transactional Email

**Status:** Accepted

## Decision

Brevo will provide transactional email functionality.

## Primary Use Cases

- OTP delivery.
- Order confirmation emails.
- Payment confirmation emails.
- Transactional order notifications.

## Reasoning

Email functionality is required for realistic authentication and commerce workflows.

Using a dedicated transactional email provider avoids implementing and maintaining a custom mail-delivery infrastructure.

## Consequences

Brevo API credentials must be stored securely.

The backend remains responsible for deciding when an email should be sent.

Brevo does not become the source of truth for authentication, orders, or payments.

---

# 14. ADR-012 — Backend PDF Generation

**Status:** Accepted

## Decision

Order and payment PDF documents will be generated by the backend.

## Primary Use Cases

- Order invoices.
- Payment receipts.
- Downloadable order documents.
- Optional email attachments.

## Reasoning

PDF generation belongs close to the authoritative order and payment data.

Generating documents in the backend provides:

- Consistent document content.
- Controlled access.
- Independent frontend implementation.
- Reusable document generation.
- Easier integration with transactional emails.

## Security Requirements

Generated documents must not expose sensitive payment information such as:

- Full card numbers.
- Card security codes.
- Authentication secrets.
- Private credentials.

## Implementation Note

The exact PDF-generation library has not yet been selected.

That dependency should be recorded here or in `DEPENDENCIES.md` once the implementation decision is made.

---

# 15. ADR-013 — Socket.IO for Real-Time Delivery Tracking

**Status:** Accepted

## Decision

Socket.IO will provide real-time delivery updates.

## Reasoning

Delivery tracking benefits from immediate updates without requiring constant client polling.

The intended flow is:

```text
Administrator
      ↓
Express Backend
      ↓
Socket.IO
      ↓
Customer
```

## Use Cases

- Delivery status updates.
- Delivery location updates.
- Real-time shipment progress.

## Consequences

Socket.IO should be limited to features that require real-time behavior.

Standard CRUD operations continue to use REST APIs.

---

# 16. ADR-014 — Leaflet + OpenStreetMap for Delivery Maps

**Status:** Accepted

## Decision

Leaflet will provide the interactive map interface and OpenStreetMap will provide map data.

## Use Cases

- Delivery location.
- Delivery markers.
- Route visualization.
- Delivery tracking.

## Reasoning

The combination provides an open, flexible mapping solution appropriate for the project's requirements.

## Consequences

The project must respect applicable OpenStreetMap attribution and usage requirements.

---

# 17. ADR-015 — Cloudinary for Product Images

**Status:** Accepted

## Decision

Cloudinary will be used for product image storage and delivery.

## Reasoning

Product images are external media and should not be stored directly in the Git repository or unnecessarily inside PostgreSQL.

Cloudinary provides:

- Image storage.
- Image delivery.
- Transformations.
- Optimization capabilities.

## Consequences

Cloudinary credentials must remain in environment variables.

---

# 18. ADR-016 — Rule-Based / Simulated AI Where Appropriate

**Status:** Accepted

## Decision

The AI features may initially use deterministic, rule-based, or simulated logic where a production-grade ML model is not necessary for the portfolio demonstration.

## Applicable Features

- Search by image.
- Product recommendations.

## Reasoning

The primary objective is to demonstrate:

- AI-service architecture.
- API integration.
- Product workflows.
- User experience.
- Replaceable AI boundaries.

A simulated implementation can demonstrate the complete workflow without requiring a complex production ML pipeline.

## Architectural Requirement

The AI implementation must remain replaceable.

The backend must not become tightly coupled to a specific AI model or implementation.

---

# 19. ADR-017 — Docker for Service Containerization

**Status:** Accepted

## Decision

Docker will be used to containerize the primary application services.

Target services:

```text
Frontend
Backend
AI Service
```

Docker Compose will be used for local multi-service orchestration.

## Reasoning

Docker provides:

- Reproducible environments.
- Service isolation.
- Consistent development.
- Simplified deployment.
- Production-oriented experience.

---

# 20. ADR-018 — GitHub Actions for CI/CD

**Status:** Accepted

## Decision

GitHub Actions will provide the project's CI/CD automation.

## Validation Pipeline

The final pipeline is expected to validate:

```text
Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
E2E Tests
 ↓
Build
 ↓
Docker Build
```

## Reasoning

GitHub Actions integrates directly with the project's GitHub repository and supports automated pull-request validation and release workflows.

## Consequences

CI/CD is intentionally implemented and finalized during Phase 06.

---

# 21. ADR-019 — Playwright for E2E Testing

**Status:** Accepted

## Decision

Playwright will be used for end-to-end testing.

## Reasoning

The application contains multiple critical user journeys that require browser-level verification.

Target workflows include:

- Authentication.
- Search.
- Product details.
- Cart.
- Wishlist.
- Checkout.
- Payment.
- Orders.
- Delivery tracking.
- Image search.
- Recommendations.
- Administrative workflows.

Cross-browser and responsive testing will also be included.

---

# 22. ADR-020 — Single Backend Authority for Commerce Logic

**Status:** Accepted

## Decision

The Express backend remains the authoritative owner of core commerce business logic.

This includes:

- Authentication and authorization.
- Products.
- Inventory.
- Cart.
- Wishlist.
- Orders.
- Payments.
- Delivery.
- Administrative operations.

## Reasoning

Clear ownership prevents business logic from being duplicated across the frontend, AI service, or database.

The architecture remains:

```text
Frontend
    ↓
Backend API
    ↓
Business Services
    ↓
Prisma
    ↓
PostgreSQL
```

---

# 23. ADR-021 — External Services Are Replaceable Boundaries

**Status:** Accepted

## Decision

External services should be integrated behind clear application boundaries where practical.

Relevant services include:

```text
Stripe
Brevo
Cloudinary
Supabase
OpenStreetMap
```

## Reasoning

External providers may change over time.

Keeping integrations isolated reduces the cost of replacing a provider.

## Consequences

Business logic should not be deeply coupled to provider-specific implementation details.

---

# 24. ADR-022 — Production Deployment Deferred to Phase 06

**Status:** Accepted

## Decision

Production infrastructure and CI/CD will be implemented during the final Phase 06.

## Reasoning

Early phases should focus on:

- Product requirements.
- Architecture.
- Design.
- Core implementation.
- Feature development.
- Testing preparation.

Production infrastructure introduces operational complexity that is unnecessary during early development.

## Consequences

The project will use development environments until the final release phase.

Phase 06 is responsible for proving production readiness.

---

# 25. ADR-023 — No Separate Documentation Repository

**Status:** Accepted

## Decision

Documentation will remain inside the same ElectroHub repository.

## Reasoning

The documentation describes the implementation and architecture of the same product.

Keeping documentation in the monorepo provides:

- Version synchronization.
- Easier review.
- Single source control.
- Documentation changes alongside implementation.
- Simpler project management.

## Consequences

Documentation must remain organized under the approved `docs/` structure.

---

# 26. ADR-024 — Custom UI Instead of Generic Design System

**Status:** Accepted

## Decision

ElectroHub will use custom visual styling rather than adopting a complete visual UI framework.

The approved approach is:

```text
Figma
  ↓
SCSS
  ↓
CSS Modules
  ↓
Radix UI behavior primitives
  ↓
Custom ElectroHub UI
```

## Reasoning

The project is intended to demonstrate frontend engineering and UI/UX capability rather than reproduce a generic framework appearance.

---

# 27. Decision Change Process

An accepted architectural decision must not be silently replaced.

When a significant decision changes:

1. Identify the affected ADR.
2. Explain why the existing decision is no longer appropriate.
3. Document the alternatives considered.
4. Record the new decision.
5. Mark the previous decision as superseded when appropriate.
6. Update affected architecture documentation.
7. Update the roadmap when project scope changes.
8. Update the technology/dependency documentation.

---

# 28. Decision Principle

> **Architecture should be intentional, documented, and evidence-driven.**

A technology should not be introduced simply because it is popular.

A significant architectural decision should have:

- A clear problem.
- A defined decision.
- A reason for the decision.
- Known consequences.
- A documented owner/boundary.
- A path for future change when appropriate.

