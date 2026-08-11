# Tech Stack

## 1. Overview

ElectroHub is a full-stack, AI-powered electronics e-commerce platform built as a single monorepo.

The technology stack is selected to support:

- Modern frontend development
- Type-safe application code
- Custom UI/UX implementation
- REST API development
- Relational database management
- AI service integration
- Real-time communication
- Payment processing
- Image management
- Containerization
- Automated testing and CI/CD
- Production-oriented deployment

The project intentionally avoids unnecessary framework and UI-library complexity.

---

# 2. Technology Stack Summary

| Area | Technology |
|---|---|
| Design | Figma |
| Frontend | React |
| Frontend Language | TypeScript |
| Frontend Build Tool | Vite |
| Styling | SCSS + CSS Modules |
| SCSS Architecture | 7-1 Architecture |
| UI Primitives | Radix UI |
| Icons | Lucide React |
| Animation | Framer Motion |
| Routing | React Router |
| Server State | TanStack React Query |
| Forms | React Hook Form |
| Validation | Zod |
| Admin Tables | TanStack Table |
| Backend Runtime | Node.js (v20.11.0 LTS) |
| Backend Framework | Express.js |
| ORM | Prisma |
| Database | PostgreSQL |
| Database Hosting | Supabase |
| AI Service | FastAPI (Python 3.11.4) |
| Authentication | JWT |
| Real-Time Communication | Socket.IO |
| Maps | Leaflet |
| Map Data | OpenStreetMap |
| Payments | Stripe |
| Email Service | Brevo |
| PDF Generation | PDF generation library |
| Image Storage | Cloudinary |
| Containers | Docker |
| CI/CD | GitHub Actions |
| Production Cloud | DigitalOcean |
| Production OS | Ubuntu |
| Reverse Proxy | Nginx |
| SSL/TLS | SSL certificates |
| Version Control | Git + GitHub |

---

# 3. Design

## 3.1 Figma

**Figma** is the primary design and prototyping tool.

It is used for:

- Complete UI/UX design
- Wireframes
- High-fidelity screens
- Interactive prototypes
- Design system definition
- Responsive layout planning
- Component design
- Visual validation

The design process follows:

```text
Figma
   ↓
Design System
   ↓
Component Specifications
   ↓
React Components
   ↓
SCSS / CSS Modules
```

Figma is the source of truth for the intended visual design.

---

# 4. Frontend

## 4.1 React

React is the primary frontend framework.

It is responsible for:

- Customer interfaces
- Admin interfaces
- Reusable UI components
- Feature composition
- Interactive application views

The application will favor reusable components and feature-oriented organization.

---

## 4.2 TypeScript

TypeScript is used throughout the frontend.

It provides:

- Static type checking
- Safer component interfaces
- Typed API contracts
- Better refactoring support
- Improved developer tooling
- Reduced runtime errors

The frontend should avoid unnecessary use of `any`.

---

## 4.3 Vite

Vite is the frontend build tool and development server.

It provides:

- Fast local development
- Hot module replacement
- Production builds
- TypeScript integration
- Modern asset handling

---

# 5. Styling

## 5.1 SCSS

SCSS is the primary styling technology.

The project uses a structured **7-1 SCSS architecture** to organize:

- Abstracts
- Base styles
- Components
- Layouts
- Pages
- Themes
- Vendors

The exact organization will be documented in the SCSS engineering standards.

---

## 5.2 CSS Modules

CSS Modules are used to provide component-scoped styling.

They help prevent:

- Global class collisions
- Unintended style leakage
- Naming conflicts

SCSS and CSS Modules are used together where appropriate.

---

## 5.3 UI Framework Restrictions

The project intentionally does **not** use:

- Tailwind CSS
- shadcn/ui
- Bootstrap
- Material UI visual styling

The visual identity must remain custom and aligned with the Figma design system.

---

# 6. UI Libraries

## 6.1 Radix UI

Radix UI is used as a headless UI and accessibility primitive library.

It provides behavior for components such as:

- Dialogs
- Dropdown menus
- Popovers
- Tooltips
- Select controls
- Tabs
- Other accessible interaction primitives

Radix UI does not define the application's visual identity.

Custom SCSS provides the visual styling.

---

## 6.2 Lucide React

Lucide React provides the application's icon system.

Icons should be used consistently across the interface and should follow the project's design guidelines.

---

## 6.3 Framer Motion

Framer Motion is used for purposeful UI animation and micro-interactions.

Examples include:

- Page transitions
- Component entrance animations
- Modal transitions
- Hover interactions
- Loading transitions
- Feedback animations

Motion should remain subtle and purposeful.

Reduced-motion preferences must be respected.

---

## 6.4 TanStack Table

TanStack Table is used for complex administrative data tables.

Potential use cases include:

- Product management
- Order management
- Inventory management
- User management
- Analytics

Tables should remain responsive and accessible.

---

# 7. Frontend Application Libraries

## 7.1 React Router

React Router manages client-side application routing.

It is responsible for:

- Public routes
- Customer routes
- Protected routes
- Admin routes
- Route parameters
- Navigation

Authorization must still be enforced by the backend.

---

## 7.2 TanStack React Query

TanStack React Query manages server state.

It is used for:

- API requests
- Query caching
- Request deduplication
- Background refetching
- Mutation handling
- Loading states
- Error states
- Cache invalidation

React Query is not a replacement for backend business logic.

---

## 7.3 React Hook Form

React Hook Form manages complex forms.

Potential use cases include:

- Authentication
- Shipping information
- Checkout
- Product management
- Profile forms
- Administrative forms

---

## 7.4 Zod

Zod provides schema-based validation.

It is used for validating structured data such as:

- Form input
- API responses where appropriate
- Configuration
- Request payloads

Validation should exist on the backend as well. Frontend validation must never be treated as a security boundary.

---

# 8. Backend

## 8.1 Node.js

Node.js provides the backend runtime environment.

It is responsible for running the Express API and supporting backend services.

---

## 8.2 Express.js

Express.js is the primary backend framework.

It provides:

- REST API routing
- Middleware
- Request handling
- Authentication middleware
- Validation middleware
- Error handling
- API composition

The backend will use a layered architecture to separate:

```text
Routes
   ↓
Controllers
   ↓
Services
   ↓
Prisma
   ↓
PostgreSQL
```

---

# 9. Database

## 9.1 PostgreSQL

PostgreSQL is the primary relational database.

It stores core application data including:

- Users
- Roles
- Products
- Categories
- Inventory
- Carts
- Wishlists
- Orders
- Order items
- Payments
- Deliveries
- Recommendation-related data
- Search-related data
- Analytics data where applicable

The exact schema is documented separately under `docs/06_Database/`.

---

## 9.2 Supabase

Supabase provides managed PostgreSQL hosting.

Supabase is used primarily as the database infrastructure.

Prisma remains the application's ORM and database access layer.

---

# 10. Prisma

Prisma is the ORM used by the backend.

It provides:

- Type-safe database access
- Schema management
- Database migrations
- Query construction
- Relationship handling
- Developer tooling

The backend should access PostgreSQL through Prisma rather than embedding raw database access throughout application services.

---

# 11. Authentication and Security

## 11.1 JWT Authentication

JSON Web Tokens are used for authentication.

The authentication architecture includes:

- Access tokens
- Refresh tokens
- Password hashing
- Protected routes
- Role-based access control

Authentication is enforced by the backend.

---

## 11.2 Role-Based Access Control

The initial application roles are:

```text
Customer
Administrator
```

Backend authorization determines whether a user can perform an operation.

The frontend may hide unavailable functionality, but this is not considered authorization.

---

# 12. AI Service

## 12.1 FastAPI

FastAPI is used to implement the dedicated AI service.

The service provides an isolated environment for AI-related processing.

Primary responsibilities include:

- Image analysis
- Image similarity
- Recommendation processing
- AI-specific computation

---

## 12.2 AI Architecture Principle

The AI service does not own core commerce business logic.

The main backend remains responsible for:

- Users
- Products
- Orders
- Payments
- Inventory
- Permissions

The AI service receives defined requests from the backend and returns structured results.

---

# 13. Search by Image

The image-search feature uses the FastAPI service for image-related processing.

The workflow is:

```text
User
  ↓
Upload / Camera Capture
  ↓
Frontend
  ↓
Backend
  ↓
FastAPI AI Service
  ↓
Image Analysis / Similarity
  ↓
Matching Products
  ↓
Frontend
```

A simplified or simulated matching strategy is acceptable for the academic portfolio implementation if a full production-grade computer vision model is not required.

The architecture must keep this logic replaceable.

---

# 14. AI Product Recommendations

The recommendation system can use:

- Product views
- Clicks
- Categories
- Purchases
- User behavior
- Product similarity
- Popularity

Initial recommendation logic may be deterministic or rule-based.

The architecture should allow future integration of a more advanced machine-learning model without requiring a redesign of the core commerce system.

---

# 15. Real-Time Communication

## 15.1 Socket.IO

Socket.IO provides real-time communication.

The primary use case is delivery tracking.

Example:

```text
Administrator
      ↓
Delivery Update
      ↓
Express Backend
      ↓
Socket.IO
      ↓
Connected Customer
      ↓
Updated Delivery Status / Location
```

Socket.IO should only be used where real-time behavior provides meaningful value.

Normal HTTP requests remain the default for standard CRUD operations.

---

# 16. Maps

## 16.1 Leaflet

Leaflet provides the interactive map interface.

It is used for:

- Delivery locations
- Route visualization
- Delivery tracking
- Map interaction

---

## 16.2 OpenStreetMap

OpenStreetMap provides map data.

It is used together with Leaflet for the delivery-tracking interface.

The project should respect the applicable OpenStreetMap tile and attribution requirements.

---

# 17. Payments

## 17.1 Stripe

Stripe provides the payment integration.

The project uses **Stripe Test Mode**.

The checkout flow includes:

```text
Cart
  ↓
Checkout
  ↓
Shipping Information
  ↓
Payment
  ↓
Stripe Test Mode
  ↓
Payment Result
  ↓
Order Confirmation
```

No real customer payments are processed during development.

Stripe secrets must be stored in environment variables and never committed to the repository.

---

# 18. Email Service

## 18.1 Brevo

Brevo is used as the transactional email service for application-generated emails.

Primary use cases include:

- Order confirmation emails
- Payment confirmation emails
- OTP emails
- Other transactional order-related notifications

The backend is responsible for triggering transactional emails through Brevo after the relevant business operation has been validated.

Email credentials and API keys must be stored in environment variables and never committed to the repository.

The email service must not be used as the source of truth for orders or payments. Order and payment state remain owned by the backend and database.

---

# 19. PDF Generation

## 19.1 Order and Payment Documents

The backend will generate PDF documents for order and payment records.

Primary use cases include:

- Order invoices
- Payment receipts
- Downloadable order documents
- PDF attachments for transactional order/payment emails where appropriate

PDF generation is handled by the backend so that document creation remains independent from the frontend.

Generated PDFs should be created from trusted order and payment data stored by the backend and database.

PDF generation must not expose sensitive payment information such as full card numbers or security codes.

---

# 20. Image Management

## 20.1 Cloudinary

Cloudinary is used for product image storage and delivery.

Responsibilities include:

- Product image storage
- Image URLs
- Image transformations
- Image delivery
- Image optimization where applicable

The application should avoid storing large binary image files directly inside the Git repository or PostgreSQL database.

---

# 21. Containerization

## 21.1 Docker

Docker is used to containerize application services.

The intended services include:

```text
Frontend
Backend
AI Service
```

Docker provides:

- Consistent environments
- Reproducible builds
- Service isolation
- Simplified deployment
- Local multi-service development

---

## 21.2 Docker Compose

Docker Compose is used to orchestrate the local multi-service environment.

The development environment should make it possible to run the required application services together.

External managed services such as Supabase, Cloudinary, and Stripe remain external dependencies.

---

# 22. CI/CD

## 22.1 GitHub Actions

GitHub Actions provides automated CI/CD.

The pipeline will progressively validate:

- Linting
- Type checking
- Unit tests
- Integration tests
- E2E tests
- Production builds
- Docker builds

Production deployment is reserved for the final release phase.

---

# 23. Production Infrastructure

## 23.1 DigitalOcean

DigitalOcean is the planned production cloud provider.

The application will be deployed to a DigitalOcean Cloud VPS.

The VPS is intentionally introduced during the final deployment phase rather than during early development.

---

## 23.2 Ubuntu

Ubuntu is the planned operating system for the production VPS.

The server will host the containerized application environment.

---

## 23.3 Nginx

Nginx is used as the production reverse proxy.

Responsibilities include:

- Reverse proxying
- Request routing
- HTTPS termination
- Static asset handling where appropriate
- Service exposure

---

## 23.4 SSL/TLS

Production traffic must use HTTPS.

SSL/TLS certificates will be configured for the production domain.

Certificates and private keys must never be committed to Git.

---

# 24. Version Control

## 24.1 Git

Git is used for source control.

The repository follows a structured branching and pull-request workflow documented under:

```text
docs/11_Workflow/
```

---

## 24.2 GitHub

GitHub hosts the repository and provides:

- Source control
- Pull requests
- Code review
- Issues
- GitHub Actions
- Release management

---

# 25. Testing Stack

The project will use a layered testing strategy.

### Frontend

- Unit testing
- Component testing
- Integration testing
- Playwright E2E testing

### Backend

- Unit testing
- Integration testing
- API testing

### AI Service

- Unit testing
- API testing
- Service-level integration testing where appropriate

### E2E

Playwright will validate critical end-to-end customer and administrator workflows.

The exact testing libraries and configuration are documented in the quality documentation.

---

# 26. Architecture Principles

The technology stack follows several principles.

## Keep Responsibilities Separated

Each technology should have a clear responsibility.

## Prefer Type Safety

TypeScript and Prisma provide strong type safety across the application.

## Avoid Unnecessary Dependencies

A dependency should be introduced when it provides meaningful value.

## Keep the UI Custom

The application should not inherit the visual identity of a generic UI framework.

## Keep AI Isolated

AI-specific processing should remain isolated from commerce business logic.

## Design for Replacement

External services and AI implementations should be replaceable where practical.

## Optimize Based on Evidence

Performance and architectural optimizations should address measured problems rather than assumptions.

---

# 27. Technology Restrictions

The following technologies are intentionally excluded from the project:

- Tailwind CSS
- shadcn/ui
- Bootstrap
- Material UI visual styling

This is an intentional architectural and design decision.

The project instead uses:

```text
SCSS
CSS Modules
Radix UI
Lucide React
```

to create a custom visual system based on the Figma design.

---

# 28. Development Environment

The development environment should support:

```text
Frontend
React + TypeScript + Vite

Backend
Node.js + Express + Prisma

AI
FastAPI

Database
Supabase PostgreSQL

Supporting Services
Cloudinary
Brevo
Stripe Test Mode
```

Docker is used to make the multi-service environment reproducible.

---

# 29. Production Environment

The target production environment is:

```text
Internet
   ↓
HTTPS
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

External managed services:

```text
Supabase PostgreSQL
Cloudinary
Brevo
Stripe
OpenStreetMap
```

---

# 30. Technology Selection Principle

Every technology in the stack must have a documented purpose.

The project should avoid adopting technologies simply because they are popular.

Technology decisions should be evaluated based on:

- Project requirements
- Maintainability
- Security
- Performance
- Developer experience
- Integration complexity
- Portfolio value
- Long-term suitability

Significant technology decisions should be documented through Architecture Decision Records under:

```text
docs/ADR/
```
