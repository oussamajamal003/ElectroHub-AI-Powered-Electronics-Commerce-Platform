# Monorepo Structure

## 1. Purpose

This document defines the monorepo organization for ElectroHub.

ElectroHub uses a single repository containing the frontend, backend, AI service, documentation, infrastructure configuration, CI/CD workflows, and project assets.

The structure is designed to:

- Keep service boundaries clear.
- Centralize shared documentation.
- Support independent service development.
- Support Docker-based deployment.
- Support automated CI/CD.
- Scale as the project grows.
- Make ownership and responsibilities easy to identify.

---

## 2. Repository Model

ElectroHub uses a **single monorepo**.

```text
electrohub/
├── apps/
│   ├── frontend/
│   ├── backend/
│   └── ai-service/
├── docs/
├── infrastructure/
├── .github/
├── docker-compose.yml
├── package.json
├── README.md
├── .gitignore
└── LICENSE
```

The services belong to the same product and are developed as a coordinated system, while maintaining independent runtime boundaries.

---

## 3. Applications

All primary application services are located under:

```text
apps/
├── frontend/
├── backend/
└── ai-service/
```

Each service owns its implementation, dependencies, tests, and runtime configuration.

Services communicate through defined interfaces rather than importing another service's internal source code.

---

## 4. Frontend

```text
apps/frontend/
├── public/
├── src/
├── tests/
├── package.json
├── vite.config.ts
└── tsconfig.json
```

The frontend is responsible for:

- Customer UI.
- Administrator UI.
- Routing.
- Forms.
- Client-side validation.
- React Query server-state management.
- Responsive behavior.
- Accessibility.
- Real-time delivery presentation.
- Map visualization.

The frontend does not directly access PostgreSQL.

---

## 5. Backend

```text
apps/backend/
├── src/
├── prisma/
├── tests/
├── package.json
└── tsconfig.json
```

The backend owns:

- REST APIs.
- Authentication.
- Authorization.
- Business logic.
- Products.
- Categories.
- Search.
- Cart.
- Wishlist.
- Checkout.
- Payments.
- Orders.
- Inventory.
- Delivery.
- Administration.
- Analytics.
- Email orchestration.
- PDF generation.
- AI integration.
- Socket.IO communication.

Prisma provides database access to Supabase PostgreSQL.

---

## 6. AI Service

```text
apps/ai-service/
├── app/
├── tests/
├── requirements.txt
└── Dockerfile
```

The AI service uses FastAPI and owns:

- Image processing.
- Image similarity.
- Recommendation processing.
- AI-specific logic.

It does not own authentication, payments, orders, inventory, or core commerce business rules.

---

## 7. Documentation

All engineering documentation is located under:

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
├── 09_Operations/
├── 10_Workflow/
├── ADR/
├── prompts/
├── tasks/
├── Phase-00/
├── Phase-01/
├── Phase-02/
├── Phase-03/
├── Phase-04/
├── Phase-05/
├── Phase-06/
└── assets/
```

Documentation must remain synchronized with the implementation.

---

## 8. Architecture Documentation

```text
docs/03_Architecture/
├── SYSTEM_ARCHITECTURE.md
├── FRONTEND_ARCHITECTURE.md
├── BACKEND_ARCHITECTURE.md
├── AI_ARCHITECTURE.md
├── DATABASE_ARCHITECTURE.md
├── DEPLOYMENT_ARCHITECTURE.md
├── MONOREPO_STRUCTURE.md
└── DIAGRAMS.md
```

Architecture documentation describes both technical responsibilities and relationships between services.

---

## 9. Design Documentation

```text
docs/02_Design/
├── FIGMA.md
├── DESIGN_SYSTEM.md
├── COMPONENTS.md
├── LAYOUTS.md
├── COLORS.md
├── TYPOGRAPHY.md
├── ICONS.md
├── MOTION.md
├── RESPONSIVE.md
└── UI_GUIDELINES.md
```

Figma is the source of truth for intended visual design.

---

## 10. Engineering Standards

```text
docs/04_Engineering Standards/
├── CODING_STANDARD.md
├── TYPESCRIPT_STANDARD.md
├── SCSS_STANDARD.md
├── COMPONENT_GUIDELINES.md
├── API_GUIDELINES.md
├── STATE_MANAGEMENT.md
├── ERROR_HANDLING.md
├── LOGGING.md
├── PERFORMANCE.md
└── SECURITY_STANDARD.md
```

All application services should follow the relevant standards.

---

## 11. Feature Documentation

```text
docs/05_Features/
├── AUTHENTICATION.md
├── PRODUCTS.md
├── CATEGORIES.md
├── SEARCH.md
├── IMAGE_SEARCH.md
├── RECOMMENDATIONS.md
├── CART.md
├── WISHLIST.md
├── CHECKOUT.md
├── PAYMENTS.md
├── INVENTORY.md
├── ORDERS.md
├── DELIVERY_TRACKING.md
├── ADMIN.md
└── ANALYTICS.md
```

Feature documentation explains behavior, workflows, architecture, validation, errors, and testing requirements.

---

## 12. Database Documentation

```text
docs/06_Database/
├── ERD.md
├── PRISMA_SCHEMA.md
├── TABLES.md
├── RELATIONSHIPS.md
├── INDEXING.md
├── SEEDING.md
└── MIGRATIONS.md
```

The Prisma schema remains the implementation source of truth for exact database definitions.

---

## 13. AI Documentation

```text
docs/07_AI/
├── IMAGE_SEARCH.md
├── RECOMMENDER.md
├── FASTAPI.md
├── MODEL_FLOW.md
└── PROMPTS.md
```

AI documentation must clearly distinguish real ML functionality from simulated or rule-based behavior.

---

## 14. Quality Documentation

```text
docs/08_Quality/
├── TESTING.md
├── QA.md
├── UNIT_TESTING.md
├── INTEGRATION_TESTING.md
├── E2E.md
├── ACCESSIBILITY.md
├── PERFORMANCE.md
└── RELEASE_CHECKLIST.md
```

Quality verification must be evidence-based.

---

## 15. Operations

```text
docs/09_Operations/
├── DEPLOYMENT.md
├── DEPLOYMENT_WORKFLOW.md
├── SECURITY.md
├── DEPENDENCIES.md
├── DEFINITION_OF_DONE.md
├── ENVIRONMENT_VARIABLES.md
├── MONITORING.md
├── BACKUP_RECOVERY.md
└── DEPENDENCY_UPDATES.md
```

Operations documentation covers the system after implementation, including deployment, security, maintenance, monitoring, and recovery.

---

## 16. Workflow

```text
docs/10_Workflow/
├── GIT_WORKFLOW.md
├── BRANCHING.md
├── TASK_TEMPLATE.md
├── PR_TEMPLATE.md
├── CODE_REVIEW.md
├── RELEASE_PROCESS.md
└── CONTRIBUTING.md
```

Workflow documentation defines how work is planned, implemented, reviewed, and released.

---

## 17. ADRs

```text
docs/ADR/
├── ADR-001-monorepo.md
├── ADR-002-prisma.md
├── ADR-003-supabase.md
├── ADR-004-fastapi.md
├── ADR-005-digitalocean.md
├── ADR-006-radix-ui.md
└── ADR-007-scss-modules.md
```

Significant architectural decisions should be recorded as ADRs.

---

## 18. Infrastructure

The root infrastructure directory contains deployment-related configuration.

```text
infrastructure/
├── docker/
├── nginx/
└── deployment/
```

Infrastructure configuration remains separate from application source code.

Production secrets must never be committed.

---

## 19. GitHub Actions

CI/CD workflows are stored under:

```text
.github/
└── workflows/
```

Typical workflows include:

```text
Pull Request Validation
Build
Type Check
Lint
Unit / Integration Tests
E2E
Preview Deployment
Production Deployment
```

Production deployment is finalized during the final project phase.

---

## 20. Root Configuration

Root-level configuration applies to the monorepo as a whole.

```text
package.json
docker-compose.yml
README.md
.gitignore
LICENSE
```

Service-specific configuration belongs inside the relevant application directory.

---

## 21. Dependency Boundaries

Each application service should own its service-specific dependencies.

```text
Frontend
 ↓
Frontend dependencies

Backend
 ↓
Backend dependencies

AI Service
 ↓
Python dependencies
```

Shared dependencies should only be centralized when there is a clear architectural benefit.

A service must not depend on another service's private implementation files.

---

## 22. Communication Boundaries

The primary architecture is:

```text
Frontend
   │
   │ HTTP / WebSocket
   ▼
Backend
   │
   ├── Prisma → Supabase PostgreSQL
   ├── FastAPI → AI
   ├── Stripe
   ├── Brevo
   └── Cloudinary
```

The frontend communicates with the backend rather than directly accessing protected infrastructure.

---

## 23. Docker Boundaries

The runtime may contain:

```text
Docker
├── frontend
├── backend
└── ai-service
```

Internal services should communicate through the Docker network where appropriate.

Only services that need public access should be exposed externally.

---

## 24. Testing Boundaries

Tests should remain close to the service they validate.

```text
apps/frontend/tests/
apps/backend/tests/
apps/ai-service/tests/
```

Cross-service user journeys are covered through integration/E2E testing.

---

## 25. Assets

Project assets are stored under:

```text
docs/assets/
├── diagrams/
├── screenshots/
└── figma/
```

These assets may be referenced by documentation and the project README.

---

## 26. Tasks and Phases

Implementation work is organized by project phase:

```text
docs/tasks/
├── Phase-00/
├── Phase-01/
├── Phase-02/
├── Phase-03/
├── Phase-04/
├── Phase-05/
└── Phase-06/
```

Tasks should define:

- Objective.
- Scope.
- Requirements.
- Acceptance criteria.
- Testing requirements.
- Documentation requirements.
- Completion status.

---

## 27. Structural Rules

The repository follows these rules:

1. Application code belongs under `apps/`.
2. Documentation belongs under `docs/`.
3. Deployment configuration belongs under `infrastructure/`.
4. CI/CD workflows belong under `.github/workflows/`.
5. Secrets never belong in source control.
6. Services communicate through defined APIs/interfaces.
7. A service must not import another service's private source code.
8. New top-level boundaries require architectural justification.

---

## 28. Growth Principle

New functionality should normally be added to an existing appropriate directory.

New top-level directories should only be introduced when a genuine architectural boundary exists.

The structure should remain understandable as the system grows.

---

## 29. Source of Truth

When structure documentation and implementation disagree:

1. Inspect the actual repository.
2. Determine which side is outdated.
3. Update the appropriate documentation or implementation.
4. Record an ADR if the architecture changed.

---

## 30. Monorepo Principle

> **Keep the product unified at the repository level while keeping service responsibilities and runtime boundaries explicit.**
