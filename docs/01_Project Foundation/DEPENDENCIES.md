# Dependencies

## 1. Purpose

This document defines the dependency strategy for the ElectroHub monorepo.

The dependency strategy is designed to:

- Keep dependencies purposeful.
- Separate frontend, backend, and AI-service dependencies.
- Avoid unnecessary packages.
- Maintain security and maintainability.
- Support reproducible development and deployment.
- Keep production dependencies distinct from development tooling.
- Make dependency ownership clear.
- Support controlled dependency updates.

Dependencies must provide clear technical or product value before being introduced.

---

# 2. Dependency Architecture

ElectroHub is a monorepo with three primary application services:

```text
electrohub/
│
├── apps/
│   ├── frontend/
│   ├── backend/
│   └── ai-service/
│
├── docs/
├── infrastructure/
└── .github/
```

Each application owns its service-specific dependencies.

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

A dependency must be installed in the smallest scope that requires it.

Shared root dependencies should only be introduced when they genuinely serve the monorepo as a whole.

---

# 3. Frontend Dependencies

## 3.1 Core Framework

### React

Used for:

- Customer interface
- Administrator interface
- Reusable UI components
- Application composition

---

### TypeScript

Used for:

- Static typing
- Component interfaces
- API types
- Safer refactoring
- Developer tooling

---

### Vite

Used for:

- Development server
- Hot module replacement
- Production builds
- Asset handling

---

# 4. Frontend Routing and State

## 4.1 React Router

Used for:

- Application routing
- Public routes
- Protected routes
- Customer routes
- Admin routes
- Route parameters
- Navigation

---

## 4.2 TanStack React Query

Used for server-state management:

- API requests
- Query caching
- Background refetching
- Mutations
- Loading states
- Error states
- Cache invalidation

React Query must not contain core backend business logic.

---

# 5. Frontend Forms and Validation

## 5.1 React Hook Form

Used for complex forms such as:

- Authentication
- Shipping
- Checkout
- Product management
- Administrative forms

---

## 5.2 Zod

Used for schema validation.

Potential validation targets include:

- Form input
- API payloads
- Configuration
- Structured application data

Backend validation remains mandatory.

Frontend validation is not a security boundary.

---

# 6. Frontend UI Dependencies

## 6.1 Radix UI

Radix UI provides accessible behavior primitives.

Potential components include:

- Dialogs
- Dropdown menus
- Popovers
- Tooltips
- Select controls
- Tabs

Radix UI provides behavior rather than the application's visual identity.

Custom SCSS remains responsible for visual styling.

---

## 6.2 Lucide React

Used for:

- Application icons
- Navigation icons
- Action icons
- Status icons

Icons should follow the project's design system.

---

## 6.3 Framer Motion

Used for purposeful motion and micro-interactions:

- Page transitions
- Component transitions
- Modal animations
- Hover interactions
- Feedback animations

Animations must remain consistent with the design system and respect reduced-motion preferences.

---

## 6.4 TanStack Table

Used for complex administrative tables such as:

- Products
- Orders
- Inventory
- Users
- Analytics

---

# 7. Frontend Styling Dependencies

## 7.1 SCSS

SCSS is the primary styling technology.

The project follows a structured 7-1 SCSS architecture.

---

## 7.2 CSS Modules

CSS Modules provide component-scoped styling.

SCSS and CSS Modules are used together to maintain a custom and maintainable visual system.

---

## 7.3 Explicitly Excluded UI Dependencies

The project intentionally does not use:

- Tailwind CSS
- shadcn/ui
- Bootstrap
- Material UI visual styling

These exclusions are architectural and design decisions.

---

# 8. Backend Dependencies

## 8.1 Node.js

Node.js (v20.11.0 LTS) provides the backend runtime.

---

## 8.2 Express.js

Express.js provides:

- REST API routing
- Middleware
- Request handling
- Authentication middleware
- Validation middleware
- Error handling

---

## 8.3 Prisma

Prisma is the ORM and database access layer.

Used for:

- Type-safe database queries
- Schema management
- Migrations
- Relationships
- Database access

The backend should access PostgreSQL through Prisma rather than distributing raw database access throughout application code.

---

# 9. Authentication Dependencies

## JWT

JWT-based authentication is used for:

- Access tokens
- Refresh tokens
- Protected API routes

---

## Password Hashing

Password hashing is required for securely storing user passwords.

The implementation must use an approved secure password-hashing library rather than storing plaintext passwords.

The exact implementation dependency is selected during backend implementation and must be documented when finalized.

---

# 10. Real-Time Dependencies

## Socket.IO

Socket.IO is used for real-time communication.

Primary use case:

- Delivery tracking updates

The intended flow is:

```text
Administrator
      ↓
Backend
      ↓
Socket.IO
      ↓
Customer
```

Socket.IO should not replace normal HTTP APIs for standard CRUD operations.

---

# 11. AI Service Dependencies

## FastAPI

FastAPI is the framework for the dedicated AI service.

It provides:

- HTTP API endpoints
- Request validation
- Structured responses
- Service-level API documentation

---

## Python

Python (v3.11.4) is the runtime language for the AI service.

---

## AI / Image Processing Libraries

The AI service may use image-processing or machine-learning libraries required by the selected implementation.

The exact libraries should be introduced only when the corresponding AI implementation is finalized.

The initial project may use simplified or simulated matching logic for academic portfolio purposes.

The dependency list must be updated when a concrete model or image-processing implementation is selected.

---

# 12. Database Dependencies

## PostgreSQL

PostgreSQL is the application's relational database.

It stores:

- Users
- Roles
- Products
- Categories
- Inventory
- Carts
- Wishlists
- Orders
- Payments
- Deliveries
- Recommendation-related data
- Search-related data
- Analytics data where applicable

---

## Supabase

Supabase provides managed PostgreSQL infrastructure.

Supabase is primarily an external database hosting service.

Prisma remains the application database access layer.

---

# 13. Maps Dependencies

## Leaflet

Leaflet provides interactive map functionality.

Used for:

- Delivery locations
- Delivery markers
- Route visualization
- Tracking interfaces

---

## OpenStreetMap

OpenStreetMap provides map data used with Leaflet.

The application must follow applicable attribution and usage requirements.

---

# 14. Payment Dependencies

## Stripe

Stripe provides payment processing in **Test Mode**.

Used for:

- Checkout
- Payment processing
- Payment confirmation
- Payment status

No real customer payments are processed during development.

Stripe credentials must be stored securely in environment variables.

---

# 15. Email Dependencies

## Brevo

Brevo is the transactional email service.

Used for:

- OTP delivery
- Order confirmation emails
- Payment confirmation emails
- Transactional order notifications

Brevo API credentials must be stored in environment variables.

The email service does not own order or payment state.

The backend and database remain the source of truth.

---

# 16. PDF Generation Dependencies

## PDF Generation Library

The backend will use a dedicated PDF-generation library for:

- Order invoices
- Payment receipts
- Downloadable order documents
- Optional email attachments

The exact PDF library is intentionally selected during backend implementation and must be documented here once finalized.

PDF generation must use trusted order and payment data.

Generated documents must not expose sensitive payment information such as:

- Full card numbers
- Card security codes
- Authentication secrets
- Private credentials

---

# 17. Image Storage Dependencies

## Cloudinary

Cloudinary is used for:

- Product image storage
- Image delivery
- Image transformations
- Image optimization where applicable

Large product image files must not be committed to Git.

---

# 18. Testing Dependencies

The project uses a layered testing strategy.

## Frontend / General

Testing dependencies should support:

- Unit testing
- Component testing
- Integration testing

---

## Playwright

Playwright is used for end-to-end testing.

It covers critical workflows such as:

- Authentication
- Search
- Product details
- Cart
- Wishlist
- Checkout
- Payment
- Orders
- Delivery tracking
- Image search
- Recommendations
- Admin workflows

---

# 19. Development and Build Dependencies

## Git

Used for source control.

---

## GitHub

Used for:

- Repository hosting
- Pull requests
- Code review
- Issues
- GitHub Actions
- Releases

---

## Docker

Docker is used for:

- Service containerization
- Reproducible environments
- Local multi-service development
- Production deployment

---

## Docker Compose

Docker Compose is used to orchestrate the local multi-service environment.

---

# 20. CI/CD Dependencies

## GitHub Actions

Used to automate:

- Linting
- Type checking
- Unit tests
- Integration tests
- E2E tests
- Production builds
- Docker builds
- Production deployment

Production deployment is introduced during Phase 06.

---

# 21. Production Infrastructure

## DigitalOcean

DigitalOcean provides the planned production VPS.

---

## Ubuntu

Ubuntu is the planned production operating system.

---

## Nginx

Nginx provides:

- Reverse proxy
- Request routing
- HTTPS termination
- Production service exposure

---

# 22. Dependency Categories

Dependencies should be categorized as:

```text
Runtime
Development
Testing
Build
Infrastructure
AI
External Service
```

A package should not be added as a production dependency if it is only required during development or testing.

---

# 23. Dependency Installation Rules

Before adding a dependency, verify:

1. The requirement cannot reasonably be implemented with existing dependencies.
2. The dependency has a clear responsibility.
3. The dependency is actively maintained where practical.
4. The dependency has acceptable security characteristics.
5. The dependency does not introduce unnecessary architectural coupling.
6. The dependency is compatible with the current project stack.
7. The dependency does not duplicate existing functionality.

---

# 24. Version Management

Dependencies should use controlled versions.

The project should:

- Commit lockfiles.
- Review dependency updates.
- Avoid uncontrolled major-version upgrades.
- Test updates before merging.
- Document significant dependency changes.
- Keep production builds reproducible.

Major dependency upgrades should be treated as engineering changes rather than routine package updates.

---

# 25. Security

Dependency security must be checked throughout development.

The project should monitor for:

- Known vulnerabilities
- Abandoned dependencies
- Malicious packages
- Vulnerable transitive dependencies
- Unnecessary permissions
- Outdated runtime libraries

Secrets must never be stored inside dependency configuration files committed to Git.

---

# 26. Dependency Updates

Dependency updates should be performed deliberately.

For each meaningful update:

1. Review the changelog/release notes.
2. Check for breaking changes.
3. Update the lockfile.
4. Run tests.
5. Run linting.
6. Run type checking.
7. Run the production build.
8. Run relevant E2E tests.
9. Review the resulting changes.
10. Document architectural impact when applicable.

---

# 27. Dependency Removal

Unused dependencies should be removed.

Before removal:

- Verify there are no imports.
- Verify scripts do not depend on the package.
- Verify build configuration does not depend on it.
- Verify tests do not depend on it.
- Run the complete relevant validation suite.

The repository should not retain packages merely because they may be useful later.

---

# 28. Dependency Ownership

Dependencies should be installed at the appropriate scope.

```text
Frontend-only dependency
        ↓
apps/frontend/

Backend-only dependency
        ↓
apps/backend/

AI-only dependency
        ↓
apps/ai-service/
```

Root-level dependencies should be limited to tools or configuration genuinely shared by the monorepo.

---

# 29. Approved Technology Dependency Map

```text
Frontend
├── React
├── TypeScript
├── Vite
├── React Router
├── TanStack React Query
├── React Hook Form
├── Zod
├── Radix UI
├── Lucide React
├── Framer Motion
├── TanStack Table
├── SCSS
└── CSS Modules

Backend
├── Node.js
├── Express.js
├── Prisma
├── JWT authentication
├── Password hashing
├── Socket.IO
├── Stripe
├── Brevo
└── PDF generation library

AI Service
├── Python
├── FastAPI
└── AI / image-processing libraries

External Services
├── Supabase PostgreSQL
├── Cloudinary
├── OpenStreetMap
└── Stripe

Infrastructure
├── Docker
├── Docker Compose
├── GitHub Actions
├── DigitalOcean
├── Ubuntu
└── Nginx

Testing
└── Playwright
```

---

# 30. Dependency Source of Truth

The actual installed versions and package names are defined by the service-level package manifests and lockfiles.

This document defines the approved technology and dependency architecture.

When implementation introduces a concrete library for an intentionally unspecified area, such as:

- Password hashing
- PDF generation
- AI/image processing

the exact dependency must be added to this document and the relevant ADR when the decision has architectural significance.

The dependency documentation must remain synchronized with the implementation.

---

# 31. Final Dependency Principle

> **Every dependency must earn its place in the project.**

ElectroHub should prefer a small, well-justified, maintainable dependency set over a large collection of packages.

A dependency should be introduced because it solves a real project requirement, not simply because it is popular or convenient.
