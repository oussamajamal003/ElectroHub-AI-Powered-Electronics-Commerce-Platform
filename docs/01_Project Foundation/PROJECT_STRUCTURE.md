# Project Structure

## 1. Purpose

This document defines the repository structure and organizational conventions for the ElectroHub monorepo.

The structure is designed to:

- Separate application responsibilities.
- Keep frontend, backend, and AI services independent.
- Centralize project documentation.
- Support Docker-based development and deployment.
- Support automated CI/CD.
- Keep infrastructure configuration organized.
- Scale as the application grows.

---

# 2. Repository Model

ElectroHub uses a **single monorepo**.

All primary application services and project documentation are maintained in one repository.

```text
electrohub/
│
├── apps/
│   ├── frontend/
│   ├── backend/
│   └── ai-service/
│
├── docs/
│
├── infrastructure/
│
├── .github/
│
├── docker-compose.yml
├── package.json
├── README.md
└── LICENSE
```

A monorepo was selected because the frontend, backend, and AI service belong to the same product and are developed and released as a coordinated system.

---

# 3. Root Structure

```text
electrohub/
│
├── apps/
├── docs/
├── infrastructure/
├── .github/
│
├── docker-compose.yml
├── package.json
├── README.md
├── .gitignore
└── LICENSE
```

---

# 4. Applications

The `apps/` directory contains the three primary application services.

```text
apps/
│
├── frontend/
├── backend/
└── ai-service/
```

Each service owns its implementation and runtime responsibilities.

Services must communicate through defined APIs/contracts rather than importing another service's internal source code.

---

# 5. Frontend

```text
apps/frontend/
│
├── public/
├── src/
│
├── tests/
│
├── package.json
├── vite.config.ts
├── tsconfig.json
└── ...
```

The frontend is responsible for the customer and administrator interfaces.

The frontend should contain organized areas for:

- Pages
- Components
- Features
- Hooks
- API clients
- Query configuration
- Forms
- Routing
- State/context
- Utilities
- Styling

The exact internal structure will follow the frontend architecture documentation.

---

# 6. Backend

```text
apps/backend/
│
├── src/
├── prisma/
├── tests/
│
├── package.json
├── tsconfig.json
└── ...
```

The backend owns:

- REST APIs
- Authentication
- Authorization
- Business logic
- Product management
- Cart operations
- Wishlist operations
- Orders
- Payments
- Inventory
- Delivery
- Administrative operations
- Database access

Prisma is the database access layer.

---

# 7. AI Service

```text
apps/ai-service/
│
├── app/
├── tests/
├── requirements.txt
└── ...
```

The AI service is implemented using FastAPI.

Its responsibilities include:

- Image processing
- Image similarity
- Recommendation processing
- AI-specific logic

The AI service must remain isolated from core commerce business logic.

Communication with the main backend occurs through defined API contracts.

---

# 8. Documentation

The `docs/` directory contains the complete engineering documentation.

```text
docs/
│
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
├── 11_Workflow/
├── ADR/
├── prompts/
├── tasks/
└── assets/
```

Documentation must remain synchronized with the implementation.

---

# 9. Design Documentation

```text
docs/02_Design/
```

Contains:

- Figma documentation
- Design system
- Components
- Layouts
- Colors
- Typography
- Icons
- Motion
- Responsive behavior
- UI guidelines

Figma is the source of truth for the intended visual design.

---

# 10. Architecture Documentation

```text
docs/03_Architecture/
```

Contains:

- System architecture
- Frontend architecture
- Backend architecture
- AI architecture
- Database architecture
- Deployment architecture
- Monorepo structure
- Architecture diagrams

Architectural decisions must be reflected here and, when significant, documented through ADRs.

---

# 11. Engineering Standards

```text
docs/04_Engineering Standards/
```

Defines development standards for:

- Coding
- TypeScript
- SCSS
- Components
- APIs
- State management
- Error handling
- Logging
- Performance
- Security

All implementation work must follow these standards unless an approved architectural decision specifies otherwise.

---

# 12. Features

```text
docs/05_Features/
```

Each major product capability receives dedicated documentation.

Examples:

```text
AUTHENTICATION.md
PRODUCTS.md
SEARCH.md
IMAGE_SEARCH.md
RECOMMENDATIONS.md
CART.md
WISHLIST.md
CHECKOUT.md
PAYMENTS.md
INVENTORY.md
ORDERS.md
DELIVERY_TRACKING.md
ADMIN.md
ANALYTICS.md
```

Feature documentation should explain:

- Purpose
- User workflow
- Admin workflow where applicable
- Architecture
- API interactions
- Data requirements
- Validation
- Error handling
- Testing requirements

---

# 13. Database Documentation

```text
docs/06_Database/
```

Contains:

- ERD
- Prisma schema documentation
- Table definitions
- Relationships
- Indexing
- Seeding
- Migrations

Database changes must be reflected in the documentation when they affect architecture or important business rules.

---

# 14. AI Documentation

```text
docs/07_AI/
```

Contains:

- Image search
- Recommendation engine
- FastAPI service
- Model/data flow
- AI prompts where applicable

AI documentation must clearly distinguish:

- Real ML functionality
- Rule-based functionality
- Simulated academic behavior
- Future enhancements

---

# 15. Quality Documentation

```text
docs/08_Quality/
```

Contains:

- Testing strategy
- QA
- Unit testing
- Integration testing
- E2E testing
- Accessibility
- Performance
- Release checklist

Quality verification must provide evidence rather than relying solely on implementation claims.

---

# 16. Deployment Documentation

```text
docs/09_Deployment/
```

Contains:

```text
DOCKER.md
DIGITALOCEAN.md
NGINX.md
SSL.md
GITHUB_ACTIONS.md
PRODUCTION.md
DEPLOYMENT_WORKFLOW.md
```

These documents describe the final production environment and deployment process.

Production deployment is intentionally deferred until the final project phase.

---

# 17. Operations Documentation

```text
docs/09_Operations/
```

Contains:

- Security
- Dependency management
- Dependency updates
- Definition of Done
- Environment variables
- Monitoring
- Backup and recovery

Operations documentation focuses on maintaining the system after implementation and deployment.

---

# 18. Workflow Documentation

```text
docs/10_Workflow/
```

Contains:

- Git workflow
- Branching
- Task template
- Pull request template
- Code review
- Release process
- Contributing

This defines how development work is planned, implemented, reviewed, and released.

---

# 19. Architecture Decision Records

```text
docs/ADR/
```

Important architectural decisions are recorded using ADRs.

Initial decisions include:

```text
ADR-001-monorepo.md
ADR-002-prisma.md
ADR-003-supabase.md
ADR-004-fastapi.md
ADR-005-digitalocean.md
ADR-006-radix-ui.md
ADR-007-scss-modules.md
```

Additional ADRs should be created when a significant architectural decision is introduced.

---

# 20. Prompts

```text
docs/prompts/
```

Contains reusable engineering prompts for AI-assisted development.

Examples:

- Architect prompt
- Developer prompt
- Review prompt
- Bug-fix prompt

Prompts must not override project architecture or engineering standards.

---

# 21. Tasks

```text
docs/tasks/
```

Implementation tasks are organized by project phase.

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

Each task should define:

- Objective
- Scope
- Requirements
- Acceptance criteria
- Testing requirements
- Documentation requirements
- Completion status

---

# 22. Assets

```text
docs/assets/
│
├── diagrams/
├── screenshots/
└── figma/
```

### diagrams/

Contains architecture and technical diagrams.

### screenshots/

Contains approved application screenshots used by documentation and README files.

### figma/

Contains exported design assets or references where appropriate.

Figma itself remains the primary design source.

---

# 23. Infrastructure

The root `infrastructure/` directory contains deployment-related configuration that is part of the repository.

```text
infrastructure/
│
├── docker/
├── nginx/
└── deployment/
```

Infrastructure configuration should remain separate from application source code.

Production-specific secrets must never be committed.

---

# 24. GitHub Actions

```text
.github/
└── workflows/
```

CI/CD workflows belong here.

Typical workflows include:

- Pull request validation
- Unit testing
- Integration testing
- E2E testing
- Production build
- Release deployment

Production deployment workflows are introduced during the final release phase.

---

# 25. Root Configuration

The repository root may contain shared configuration such as:

```text
package.json
docker-compose.yml
.gitignore
README.md
LICENSE
```

Configuration should remain at the root when it applies to the entire monorepo.

Service-specific configuration belongs inside the corresponding application directory.

---

# 26. Separation of Responsibilities

The repository must maintain clear boundaries.

```text
Frontend
    ↓
Backend API
    ↓
Business Logic
    ↓
Prisma
    ↓
Supabase PostgreSQL
```

For AI functionality:

```text
Frontend
    ↓
Backend
    ↓
FastAPI AI Service
```

For real-time delivery:

```text
Admin
    ↓
Backend
    ↓
Socket.IO
    ↓
Customer
```

The frontend must not directly manipulate the database.

The AI service must not own commerce business logic.

The database must not become a replacement for application business logic.

---

# 27. Structural Principle

The repository structure should make it possible for a developer to answer three questions immediately:

1. **Where does this feature live?**
2. **Which service owns this responsibility?**
3. **Where is the design, architecture, and implementation documented?**

If the answer is unclear, the structure should be reconsidered before adding more complexity.

---

# 28. Growth Principle

The structure is intentionally designed to support future growth.

New functionality should normally be added to an existing appropriate area rather than creating new top-level directories.

New top-level architectural boundaries require an explicit architectural decision.

---

# 29. Source of Truth

When documentation and implementation disagree:

1. Verify the actual implementation.
2. Determine whether the implementation or documentation is outdated.
3. Update the appropriate source.
4. Record a decision if the architecture changed.

Documentation must not silently describe functionality that does not exist.
