# Task 00.2–00.4 — Project Foundation Setup

## Task Status

**Phase:** Phase-00 — Project Foundation  
**Task Group:** 00.2, 00.3, 00.4  
**Status:** Ready for implementation  
**Repository:** `ElectroHub-AI-Powered-Electronics-Commerce-Platform`  
**Repository URL:** https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform  
**Working Branch:** `project-foundation`  
**Target Branch:** `develop`

> **Do NOT work directly on `main`.**

---

# 1. Objective

Establish the initial working foundation of the ElectroHub monorepo.

Task 00.1 — documentation foundation — is already complete. The existing `docs/` architecture must be treated as the source of truth and must not be recreated.

This task establishes the remaining Phase-00 foundation:

1. Full repository/project setup.
2. Monorepo folder structure.
3. Application/service structure.
4. `packages/`, `services/`, and `tests/` organization.
5. Initial frontend, backend, and FastAPI foundations.
6. Initial centralized logging foundation.
7. Initial Swagger/OpenAPI foundation.
8. Initial secure environment/configuration foundation.
9. Initial foundation tests and validation.

This is a **foundation task**, not a feature-development task.

---

# 2. Existing State

The GitHub repository has already been created and contains the initial repository setup/README.

The complete documentation architecture has already been established.

Do NOT recreate or replace:

```text
docs/
```

The current repository documentation is authoritative for:

- Project vision
- Project structure
- Technology stack
- Architecture
- Engineering standards
- Security
- Database
- AI
- Quality
- Deployment
- Operations
- Workflow
- ADRs
- Development prompts

---

# 3. Scope

## In Scope

### Repository Foundation

Establish the approved monorepo structure.

### Applications

Establish:

```text
apps/
├── frontend/
├── backend/
└── ai-service/
```

### Shared Areas

Establish, where justified by the approved architecture:

```text
packages/
services/
tests/
```

Do not create speculative packages or duplicate business-logic boundaries.

### Frontend

Create the initial React + TypeScript + Vite foundation.

### Backend

Create the initial Node.js + Express + TypeScript foundation.

### AI Service

Create the initial Python + FastAPI foundation.

### Logging

Implement the initial reusable backend logging foundation.

### Swagger

Implement the initial Swagger/OpenAPI foundation for the backend.

### Configuration

Establish safe environment/configuration conventions.

### Testing

Establish foundation tests that prove the initial services and infrastructure work.

---

# 4. Out of Scope

Do NOT implement:

- Authentication functionality
- Products
- Categories
- Search
- Image search
- Recommendations
- Cart
- Wishlist
- Checkout
- Payments
- Orders
- Delivery tracking
- Admin functionality
- Analytics
- AI business functionality
- Real Stripe payments
- Real Brevo workflows
- PDF generation
- Cloudinary workflows
- Production deployment
- DigitalOcean production setup
- Production SSL
- Full monitoring/observability
- Unrelated refactoring
- Future business features

Only establish the foundation required by Phase-00.

---

# 5. Required Architecture

Core architecture:

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

AI architecture:

```text
Frontend
    ↓
Backend
    ↓
FastAPI AI Service
```

The frontend must never directly access the database.

The AI service must not own core commerce business logic.

The backend remains authoritative for:

```text
Authentication
Authorization
Pricing
Inventory
Payment State
Order State
```

---

# 6. Approved Technology Foundation

Follow the current `TECH_STACK.md`.

Expected foundation:

```text
Frontend:
React
TypeScript
Vite
SCSS
CSS Modules
React Router
React Query
React Hook Form
Zod
Framer Motion

UI:
Radix UI
Lucide React
TanStack Table

Backend:
Node.js
Express.js
TypeScript
Prisma
Socket.IO

Database:
Supabase PostgreSQL

AI:
Python
FastAPI

External:
Stripe Test Mode
Brevo
Cloudinary
Leaflet / OpenStreetMap

Infrastructure:
Docker
Ubuntu
DigitalOcean
Nginx
SSL
GitHub Actions
```

Do NOT introduce:

```text
Next.js
Tailwind CSS
shadcn/ui
Bootstrap
Material UI
```

unless the current approved project documentation explicitly changes that decision.

---

# 7. Repository Structure

Derive the final structure from:

```text
docs/01_Project Foundation/PROJECT_STRUCTURE.md
docs/03_Architecture/MONOREPO_STRUCTURE.md
docs/03_Architecture/SYSTEM_ARCHITECTURE.md
```

The foundation must support at least:

```text
ElectroHub/
│
├── apps/
│   ├── frontend/
│   ├── backend/
│   └── ai-service/
│
├── packages/
├── services/
├── tests/
├── docs/
├── infrastructure/
├── .github/
│
├── .gitignore
├── README.md
├── package.json
└── ...
```

Do NOT blindly create every possible subdirectory.

Create only directories justified by the architecture and this task.

Use `.gitkeep` only where an intentionally empty, Git-tracked directory is actually required.

---

# 8. Frontend Foundation

Establish the initial frontend using the approved stack.

The structure must provide an appropriate foundation for future:

```text
pages
components
features
hooks
services / API clients
types
utilities
routing
query/state configuration
styles
```

Do not implement business features.

The application must have a minimal verifiable startup path.

---

# 9. Backend Foundation

Establish the initial Express + TypeScript backend.

The foundation should support future:

```text
routes
controllers
services
middleware
schemas
types
utils
config
logging
```

Follow the current backend architecture.

Implement a minimal health/status endpoint.

Example:

```text
GET /health
```

The exact route prefix and response contract must follow the current API documentation. Do not invent a conflicting convention.

---

# 10. AI Service Foundation

Establish the FastAPI service foundation.

It must provide:

- Application entry point
- Configuration foundation
- Health/status endpoint
- Future AI module boundary
- Test foundation
- Environment/configuration foundation

Do not implement image search or recommendation logic.

---

# 11. Packages

Establish:

```text
packages/
```

only where justified.

Potential future shared areas include:

```text
shared types
shared validation
shared configuration
shared utilities
```

Do NOT create speculative packages containing unused abstractions.

Avoid circular dependencies.

Shared packages must have clear ownership and consumers.

---

# 12. Services

Establish:

```text
services/
```

only according to the approved architecture.

Do not accidentally create a second backend architecture.

Clearly distinguish:

```text
Application
Service
Module
Package
Infrastructure
```

Every business responsibility must have one clear owner.

---

# 13. Tests

Establish the testing structure according to:

```text
docs/08_Quality/TESTING.md
docs/08_Quality/UNIT_TESTING.md
docs/08_Quality/INTEGRATION_TESTING.md
docs/08_Quality/E2E.md
```

Tests for this task should verify the foundation only.

Where applicable, verify:

- Frontend startup/rendering
- Backend health endpoint
- Logging initialization
- Swagger/OpenAPI availability
- AI service health endpoint
- Configuration behavior

Do not create fake feature tests for functionality that does not exist.

---

# 14. Logging Foundation

Implement the initial centralized backend logging foundation.

Read and follow:

```text
docs/04_Engineering Standards/LOGGING.md
docs/04_Engineering Standards/ERROR_HANDLING.md
docs/10_Operations/MONITORING.md
docs/10_Operations/SECURITY.md
```

The logger must:

- Be reusable.
- Support appropriate log levels.
- Follow project logging standards.
- Be structured where required.
- Be suitable for future production observability.

At minimum, support appropriate:

```text
debug
info
warn
error
```

Use an already-approved dependency if one exists.

Do not introduce a conflicting logging library.

Never log:

```text
Passwords
JWT secrets
Refresh tokens
OTP values
Stripe secrets
Brevo API keys
Database credentials
Cloudinary private credentials
Sensitive customer data
```

Do not implement the complete production monitoring platform in this task.

---

# 15. Swagger / OpenAPI Foundation

Implement the initial backend Swagger/OpenAPI foundation.

Swagger/OpenAPI must:

- Initialize successfully.
- Be accessible through a documented route.
- Contain API title and version.
- Describe the current API purpose.
- Document the existing health endpoint.
- Establish reusable schema/documentation organization.
- Establish the appropriate security-scheme foundation for future authenticated APIs where applicable.

Do NOT document nonexistent endpoints.

Do NOT invent future request/response contracts.

The setup must be maintainable as the API grows.

---

# 16. Environment Configuration

Follow:

```text
docs/10_Operations/ENVIRONMENT_VARIABLES.md
docs/04_Engineering Standards/SECURITY_STANDARD.md
```

Establish safe configuration conventions.

Use:

```text
.env
.env.example
```

where appropriate.

`.env` must be ignored by Git.

`.env.example` may contain placeholders only.

Never commit actual:

```text
DATABASE_PASSWORD
JWT_SECRET
STRIPE_SECRET_KEY
BREVO_API_KEY
CLOUDINARY_SECRET
SUPABASE_SERVICE_ROLE_KEY
```

or equivalent credentials.

---

# 17. Monorepo Workspace Configuration

Before selecting the workspace/package-management strategy, inspect:

```text
docs/01_Project Foundation/TECH_STACK.md
docs/01_Project Foundation/DEPENDENCIES.md
docs/03_Architecture/MONOREPO_STRUCTURE.md
docs/ADR/ADR-001-monorepo.md
```

Use the approved package manager/workspace strategy.

Do not introduce a conflicting monorepo system.

The final setup must allow applications/packages to be managed consistently.

---

# 18. Dependency Rules

Before adding any dependency:

1. Check the approved dependency documentation.
2. Search the repository for an existing solution.
3. Determine whether the dependency is actually required.
4. Prefer approved/established libraries.
5. Avoid duplicate libraries with the same responsibility.

Every new dependency must have a clear reason.

---

# 19. Security Requirements

This foundation will support all future features.

Therefore:

- Never expose secrets.
- Validate environment configuration.
- Keep security boundaries clear.
- Avoid permissive CORS without documented justification.
- Do not expose internal errors directly.
- Do not expose stack traces in production responses.
- Do not log secrets.
- Do not expose sensitive unauthenticated endpoints.
- Keep Swagger documentation limited to the actual current API.

---

# 20. Documentation Updates

Update documentation only when implementation changes documented behavior or architecture.

Potential documents:

```text
docs/01_Project Foundation/PROJECT_STRUCTURE.md
docs/01_Project Foundation/TECH_STACK.md
docs/01_Project Foundation/DEPENDENCIES.md
docs/01_Project Foundation/CHANGELOG.md

docs/03_Architecture/SYSTEM_ARCHITECTURE.md
docs/03_Architecture/MONOREPO_STRUCTURE.md
docs/03_Architecture/FRONTEND_ARCHITECTURE.md
docs/03_Architecture/BACKEND_ARCHITECTURE.md

docs/04_Engineering Standards/LOGGING.md
docs/04_Engineering Standards/ERROR_HANDLING.md

docs/08_Quality/TESTING.md

docs/10_Operations/ENVIRONMENT_VARIABLES.md
```

Do not update unrelated documentation.

---

# 21. Acceptance Criteria

## Repository

- [ ] Monorepo foundation established.
- [ ] `apps/frontend` established.
- [ ] `apps/backend` established.
- [ ] `apps/ai-service` established.
- [ ] `packages/` established where justified.
- [ ] `services/` established where justified.
- [ ] `tests/` established.
- [ ] Required infrastructure directories established.
- [ ] No duplicate architectural boundaries introduced.

## Frontend

- [ ] Starts successfully.
- [ ] Uses approved React/TypeScript/Vite foundation.
- [ ] Follows frontend architecture.
- [ ] Contains no business feature implementation.

## Backend

- [ ] Starts successfully.
- [ ] Express/TypeScript foundation established.
- [ ] Health endpoint works.
- [ ] Backend structure follows documentation.

## AI

- [ ] FastAPI service starts.
- [ ] Health endpoint works.
- [ ] No AI business feature implemented.

## Logging

- [ ] Central logging foundation implemented.
- [ ] Appropriate log levels supported.
- [ ] Reusable logger established.
- [ ] Secrets/sensitive values are not logged.

## Swagger

- [ ] Swagger/OpenAPI initializes.
- [ ] Documentation endpoint is accessible.
- [ ] API metadata is present.
- [ ] Health endpoint is documented.
- [ ] Future nonexistent endpoints are not invented.

## Tests

- [ ] Foundation tests exist where applicable.
- [ ] Backend health test passes.
- [ ] Swagger availability is verified.
- [ ] Logging initialization is verified where appropriate.
- [ ] AI health test passes where applicable.
- [ ] Frontend startup/render verification passes where applicable.

## Security

- [ ] No secrets committed.
- [ ] `.env` ignored.
- [ ] `.env.example` contains placeholders only.
- [ ] No credentials appear in logs.
- [ ] No sensitive endpoint accidentally exposed.

## Quality

- [ ] No unused dependencies.
- [ ] No unused imports.
- [ ] No dead code.
- [ ] No unnecessary files.
- [ ] No unrelated refactoring.
- [ ] Type checking passes.
- [ ] Lint passes.
- [ ] Tests pass.
- [ ] Build passes where applicable.

---

# 22. Validation

Determine the correct commands from the current repository configuration.

Do not invent commands that do not exist.

Run applicable:

```text
Lint
Typecheck
Unit tests
Integration tests
Build
Frontend startup verification
Backend startup verification
AI startup verification
Swagger verification
```

For database changes, run the applicable migration/schema checks.

For UI changes, run applicable responsive/accessibility checks.

Record:

```text
Command
Result
Evidence
```

A successful build alone does NOT prove completion.

---

# 23. Git Requirements

Work only on:

```text
project-foundation
```

Target:

```text
develop
```

Do NOT:

- Work directly on `main`.
- Merge into `develop`.
- Merge into `main`.
- Approve your own work.

Prepare the branch for review.

Suggested Conventional Commit:

```text
chore(project-foundation): establish monorepo foundation and api infrastructure
```

---

# 24. Self-Review

Before declaring the task complete:

Read the CURRENT:

```text
docs/prompts/REVIEW_PROMPT.md
```

Perform the complete self-review against the actual changed files.

Fix every issue discovered.

Then prepare the branch for:

```text
docs/prompts/ARCHITECT_PROMPT.md
```

architectural review.

---

# 25. CRITICAL — TASK-SCOPED DOCUMENTATION ANALYSIS

This task MUST NOT cause Antigravity to analyze the entire documentation repository unnecessarily.

The agent MUST read the following documentation because it directly governs this task:

```text
docs/01_Project Foundation/PROJECT_VISION.md
docs/01_Project Foundation/PROJECT_STRUCTURE.md
docs/01_Project Foundation/TECH_STACK.md
docs/01_Project Foundation/DEPENDENCIES.md
docs/01_Project Foundation/DECISIONS.md
docs/01_Project Foundation/GLOSSARY.md

docs/03_Architecture/SYSTEM_ARCHITECTURE.md
docs/03_Architecture/MONOREPO_STRUCTURE.md
docs/03_Architecture/FRONTEND_ARCHITECTURE.md
docs/03_Architecture/BACKEND_ARCHITECTURE.md
docs/03_Architecture/AI_ARCHITECTURE.md

docs/04_Engineering Standards/CODING_STANDARD.md
docs/04_Engineering Standards/TYPESCRIPT_STANDARD.md
docs/04_Engineering Standards/ERROR_HANDLING.md
docs/04_Engineering Standards/LOGGING.md
docs/04_Engineering Standards/API_GUIDELINES.md
docs/04_Engineering Standards/SECURITY_STANDARD.md

docs/08_Quality/TESTING.md
docs/08_Quality/UNIT_TESTING.md
docs/08_Quality/INTEGRATION_TESTING.md

docs/10_Operations/SECURITY.md
docs/10_Operations/DEPENDENCIES.md
docs/10_Operations/DEFINITION_OF_DONE.md
docs/10_Operations/ENVIRONMENT_VARIABLES.md

docs/11_Workflow/GIT_WORKFLOW.md
docs/11_Workflow/BRANCHING.md

docs/ADR/ADR-001-monorepo.md
```

Read other documentation ONLY when the implementation evidence shows it is relevant.

The agent MUST NOT spend time analyzing unrelated feature documentation such as:

```text
Products
Categories
Search
Image Search
Recommendations
Cart
Wishlist
Checkout
Payments
Inventory
Orders
Delivery
Admin
Analytics
```

Those features are explicitly out of scope.

---

# 26. CRITICAL — TASK-SCOPED CODE ANALYSIS

Because the repository is currently empty/near-empty, the initial code analysis MUST be narrow.

Inspect first:

```text
Repository root
README.md
Existing package/workspace configuration
Existing Git configuration
Existing .gitignore
Existing docs/
Existing task files
```

Then create the foundation.

After creation, inspect only:

```text
apps/frontend
apps/backend
apps/ai-service
packages
services
tests
root configuration
```

and the exact files created/modified.

Do NOT analyze future feature implementations that do not exist.

---

# 27. RELATED-FILES RULE

A file is considered related if it:

- Implements this foundation.
- Is directly called by the foundation.
- Defines its configuration.
- Defines its types/contracts.
- Defines its logging boundary.
- Defines its API documentation.
- Contains tests for this foundation.
- Provides a shared dependency used by the foundation.
- Is required to validate compatibility.
- Is required to understand an architectural constraint.

Do NOT modify a file merely because you read it.

Do NOT inspect unrelated features to increase context.

---

# 28. DO NOT OVER-ENGINEER

This is a foundation task.

Do NOT:

- Build the complete application.
- Build future feature modules.
- Create speculative abstractions.
- Create unused architecture layers.
- Add unnecessary dependencies.
- Build production observability now.
- Build complete authentication now.
- Build complete CI/CD unless explicitly required.
- Implement future business logic.

The goal is a clean, working, scalable foundation.

---

# 29. Final Deliverable

Provide:

```text
# Implementation Summary

## Task
Task 00.2–00.4 — Project Foundation Setup

## Scope Completed
...

## Repository Structure
...

## Applications
...

## Packages
...

## Services
...

## Tests
...

## Logging
...

## Swagger/OpenAPI
...

## Dependencies Added
...

## Environment Configuration
...

## Documentation Analyzed
...

## Documentation Updated
...

## Files Created
...

## Files Modified
...

## Validation Commands
...

## Test Results
...

## Build Results
...

## Security Verification
...

## Known Limitations
...

## Remaining Risks
...

## Suggested Conventional Commit
...

## Architectural Handoff
READY FOR ARCHITECTURAL REVIEW
```

---

# 30. Definition of Done

The task is complete only when:

```text
[ ] Repository synchronized.
[ ] Correct branch confirmed.
[ ] Complete task analyzed.
[ ] Required documentation read from CURRENT repository.
[ ] Task-specific requirements extracted.
[ ] Related-file analysis performed.
[ ] Monorepo foundation established.
[ ] Frontend foundation works.
[ ] Backend foundation works.
[ ] AI service foundation works.
[ ] packages/services/tests structure is correct.
[ ] Logging foundation works.
[ ] Swagger/OpenAPI foundation works.
[ ] Environment configuration is secure.
[ ] Required tests pass.
[ ] Required validation passes.
[ ] No secrets committed.
[ ] No unrelated files modified.
[ ] No unrelated features implemented.
[ ] Documentation updated where required.
[ ] Self-review completed.
[ ] Evidence provided.
[ ] Branch is ready for architectural review.
```

---

# Final Instruction

**Do not start coding immediately.**

Follow this sequence:

```text
Synchronize branch
        ↓
Read this COMPLETE task
        ↓
Read REQUIRED documentation
        ↓
Extract required scope
        ↓
Inspect ONLY related repository files
        ↓
Confirm architecture and implementation boundaries
        ↓
Implement foundation
        ↓
Validate
        ↓
Self-review
        ↓
Architectural handoff
```

> **Build the foundation cleanly, keep the scope strict, read the current repository documentation every time, analyze only the smallest complete code surface necessary for this task, and provide evidence for every completion claim.**
