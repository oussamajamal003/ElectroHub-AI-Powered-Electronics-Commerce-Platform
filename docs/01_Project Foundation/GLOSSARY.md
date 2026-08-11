# Glossary

## 1. Purpose

This glossary defines the terminology used throughout the ElectroHub project documentation, architecture, implementation, and workflows.

The goal is to keep terminology consistent across:

- Product documentation
- Technical documentation
- Source code
- API documentation
- Database documentation
- UI/UX documentation
- Testing documentation
- Deployment documentation
- AI-assisted development

When a term has a project-specific meaning, this glossary takes precedence within the ElectroHub project.

---

# 2. Project Terms

## ElectroHub

The name of the project: an AI-powered electronics e-commerce platform.

---

## Customer

A registered application user who can browse products, manage a cart and wishlist, place orders, make payments through the supported payment workflow, and track deliveries.

---

## Administrator

A privileged application user responsible for managing products, categories, inventory, orders, deliveries, users, recommendations, and analytics according to the application's authorization rules.

---

## Monorepo

A single Git repository containing multiple related applications and project resources.

ElectroHub's monorepo contains:

```text
apps/
├── frontend/
├── backend/
└── ai-service/

docs/
infrastructure/
.github/
```

---

## Feature

A user-facing or system capability that provides a defined piece of application functionality.

Examples:

- Search
- Cart
- Wishlist
- Checkout
- Image Search
- Delivery Tracking
- Recommendations

---

## User Workflow

The sequence of actions performed by a customer to complete a task.

Example:

```text
Browse
 ↓
Product Details
 ↓
Cart
 ↓
Checkout
 ↓
Payment
 ↓
Order
```

---

## Admin Workflow

The sequence of actions performed by an administrator to manage or monitor application operations.

---

# 3. Frontend Terms

## React

The frontend library used to build ElectroHub's component-based user interfaces.

---

## TypeScript

The typed programming language used for frontend application development.

---

## Vite

The frontend development server and build tool used by the React application.

---

## Component

A reusable frontend UI building block.

Examples include:

- Button
- Card
- Modal
- Input
- Product Card
- Navigation

---

## CSS Modules

A styling approach that scopes CSS class names to individual components.

---

## SCSS

A CSS preprocessor used to create structured and maintainable application styles.

---

## SCSS 7-1 Architecture

A structured SCSS organization that separates styling concerns into categories such as abstracts, base styles, components, layouts, pages, themes, and vendors.

---

## Design System

A collection of reusable visual and interaction rules that define the application's:

- Colors
- Typography
- Spacing
- Components
- Icons
- Motion
- Responsive behavior

---

## Figma

The primary design and prototyping tool for ElectroHub.

Figma is the source of truth for the intended visual design.

---

## Radix UI

A collection of accessible, behavior-focused UI primitives.

Radix UI provides interaction behavior rather than ElectroHub's visual design.

---

## Lucide React

The icon library used by the application.

---

## Framer Motion

The animation library used for controlled UI motion and micro-interactions.

---

## React Router

The routing library used to manage client-side application navigation.

---

## React Query / TanStack React Query

The server-state management library used for:

- API requests
- Caching
- Background refetching
- Mutations
- Loading states
- Error states
- Cache invalidation

---

## React Hook Form

The form-management library used for complex frontend forms.

---

## Zod

A schema-validation library used to validate structured data.

---

## TanStack Table

A table-management library used for complex administrative data tables.

---

## Responsive Design

An approach where the interface adapts to different screen sizes and devices.

ElectroHub targets:

- Mobile
- Tablet
- Desktop
- Large desktop

---

## RTL

**Right-to-Left** layout direction.

RTL support may be required if localized interfaces are introduced.

---

# 4. Backend Terms

## Node.js

The JavaScript runtime used to execute the backend application.

---

## Express.js

The backend framework used to build ElectroHub's REST APIs.

---

## REST API

An HTTP-based application interface used for communication between the frontend and backend.

---

## API

**Application Programming Interface.**

A defined interface through which software components communicate.

---

## Route

A backend endpoint definition that maps an HTTP method and URL to application behavior.

---

## Controller

A backend layer responsible for handling HTTP requests and responses.

Controllers should remain focused on transport concerns rather than owning core business logic.

---

## Service

A backend layer responsible for application business logic.

Examples:

- Order service
- Payment service
- Inventory service
- Email service

---

## Middleware

Backend logic that executes during the request/response lifecycle.

Examples:

- Authentication
- Authorization
- Validation
- Logging
- Error handling

---

## Business Logic

The rules that determine how ElectroHub operates.

Examples:

- Whether a product can be purchased.
- How inventory is updated.
- Whether an order can change status.
- Whether a user can access an administrative operation.

---

## Authentication

The process of verifying a user's identity.

---

## Authorization

The process of determining whether an authenticated user is permitted to perform an action.

---

## JWT

**JSON Web Token.**

A token format used for authentication and authorization.

---

## Refresh Token

A long-lived authentication token used to obtain a new access token without requiring the user to authenticate again.

---

## Role-Based Access Control / RBAC

An authorization model where permissions are associated with user roles.

Initial ElectroHub roles include:

```text
Customer
Administrator
```

---

## OTP

**One-Time Password.**

A temporary verification code used for authentication or account verification workflows.

ElectroHub uses Brevo for OTP delivery.

---

# 5. Database Terms

## PostgreSQL

The relational database system used by ElectroHub.

---

## Supabase

The managed platform used to host ElectroHub's PostgreSQL database.

---

## Prisma

The ORM and database access layer used by the backend.

---

## ORM

**Object-Relational Mapping.**

A programming abstraction that maps application objects and operations to relational database structures.

---

## Schema

The structure that defines database models, fields, relationships, and constraints.

---

## Migration

A versioned database change used to evolve the database schema safely.

---

## Seed

Initial or sample data inserted into the database for development, testing, or demonstration.

---

## Table

A PostgreSQL structure that stores records of a particular entity.

Examples:

- Users
- Products
- Orders
- Payments

---

## Relationship

A logical connection between database entities.

Examples:

```text
Order
 ↓
Order Items
 ↓
Products
```

---

## Index

A database structure used to improve query performance for selected access patterns.

---

# 6. Commerce Terms

## Product

An electronics item available through the ElectroHub catalog.

A product may contain:

- Name
- Description
- Price
- Category
- Brand
- Specifications
- Images
- Inventory information

---

## Category

A classification used to organize products.

Examples may include:

- Smartphones
- Laptops
- Accessories
- Components

---

## Product Catalog

The collection of products available through the application.

---

## Search

The functionality used to find products using textual queries and filters.

---

## Search Suggestion

A suggested search term or product-related query displayed while the user is entering a search.

---

## Search by Image

A feature that allows users to upload an image or capture a photo to find visually similar products.

---

## Shopping Cart

A temporary collection of products selected by a customer before checkout.

---

## Wishlist

A collection of products saved by a customer for future consideration or purchase.

---

## Checkout

The process through which a customer reviews a cart, provides shipping information, selects a payment method, and completes an order.

---

## Payment

The financial transaction associated with an order.

ElectroHub uses Stripe Test Mode for development and demonstration.

---

## Stripe Test Mode

Stripe's non-production payment environment used to simulate payment workflows without processing real customer payments.

---

## Order

A persisted record representing a customer's purchase request and its associated products, payment, and delivery information.

---

## Order Item

A record representing a specific product and quantity belonging to an order.

---

## Invoice

A document representing the financial/order details associated with a purchase.

ElectroHub supports downloadable invoice PDF generation.

---

## Payment Receipt

A document confirming payment-related information for an order.

ElectroHub supports payment receipt PDF generation.

---

## Inventory

The collection of product stock quantities maintained by the application.

---

## Stock

The quantity of a product currently available for purchase.

---

## Low Stock

A product availability state indicating that inventory has fallen below the configured threshold.

---

## Out of Stock

A product availability state indicating that the product cannot currently be purchased because no available inventory remains.

---

# 7. Order and Delivery Terms

## Order Status

The current lifecycle state of an order.

ElectroHub's planned states are:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

---

## Delivery Tracking

The feature that allows customers and administrators to monitor delivery progress.

---

## Delivery Location

The current or simulated geographic position associated with a delivery.

---

## Route Visualization

A map-based representation of a delivery route.

---

## Estimated Arrival

The expected delivery arrival time displayed to the customer.

---

## Leaflet

The JavaScript mapping library used to render interactive delivery maps.

---

## OpenStreetMap

The map-data provider used with Leaflet.

---

## Socket.IO

The real-time communication library used for delivery updates.

---

## Real-Time

Communication where updates can be delivered to connected clients without requiring a full page refresh.

---

# 8. Email and Document Terms

## Brevo

The transactional email service used by ElectroHub.

Primary use cases include:

- OTP emails
- Order confirmation emails
- Payment confirmation emails
- Transactional order notifications

---

## Transactional Email

An automated email triggered by a specific application event.

Examples:

- OTP requested
- Order created
- Payment confirmed

---

## Email Provider

An external service responsible for delivering application-generated emails.

Brevo is the approved email provider for ElectroHub.

---

## PDF Generation

The backend process of creating PDF documents from trusted application data.

Used for:

- Invoices
- Payment receipts
- Order documents

---

## PDF Document

A generated document representing order or payment information in a downloadable format.

---

# 9. AI Terms

## AI Service

The dedicated FastAPI service responsible for AI-related processing.

---

## FastAPI

The Python web framework used to expose the AI service APIs.

---

## Image Processing

The process of analyzing or transforming an uploaded image before matching or classification.

---

## Image Similarity

A method for determining how visually similar two images or products are.

---

## Recommendation System

A system that selects products that may be relevant to a customer based on available signals.

---

## Recommendation

A product suggested to a customer based on behavior, product similarity, category, popularity, or other configured signals.

---

## Rule-Based Recommendation

A recommendation approach based on explicitly defined application rules rather than a trained machine-learning model.

---

## Simulated AI

An implementation that reproduces an AI-like workflow using simplified or deterministic logic for demonstration purposes.

ElectroHub may use simulated logic where a production-grade ML model is not required.

---

## Model

A computational representation used to perform an AI or machine-learning task.

---

## AI API

An API exposed by the FastAPI service for AI-related processing.

---

# 10. Infrastructure Terms

## Docker

A containerization platform used to package and run application services consistently.

---

## Container

An isolated runtime environment containing an application and its required dependencies.

---

## Docker Compose

A tool used to orchestrate multiple containers in a development or deployment environment.

---

## VPS

**Virtual Private Server.**

The planned production server model for ElectroHub.

---

## DigitalOcean

The planned cloud provider for the production VPS.

---

## Ubuntu

The planned operating system for the production VPS.

---

## Nginx

The production reverse proxy used to route incoming requests to application services.

---

## Reverse Proxy

A server that receives client requests and forwards them to internal application services.

---

## HTTPS

HTTP secured using TLS encryption.

---

## SSL/TLS

Security protocols used to encrypt network communication.

---

## Environment Variable

A configuration value provided to an application through its execution environment rather than hard-coded into source code.

Examples include:

- Database credentials
- JWT secrets
- Stripe keys
- Brevo credentials
- Cloudinary credentials

---

## Secret

Sensitive configuration information that must not be committed to source control.

---

## Health Check

A mechanism used to determine whether an application service is operating correctly.

---

# 11. CI/CD and Development Terms

## CI

**Continuous Integration.**

The automated process of validating code changes when they are integrated into the repository.

---

## CD

**Continuous Delivery / Continuous Deployment.**

The automated process of preparing or deploying validated software.

---

## GitHub Actions

The automation platform used for ElectroHub CI/CD workflows.

---

## Pipeline

An ordered sequence of automated validation or deployment steps.

Example:

```text
Lint
 ↓
Type Check
 ↓
Tests
 ↓
E2E
 ↓
Build
 ↓
Docker
```

---

## Pull Request / PR

A GitHub mechanism used to propose changes for review before merging.

---

## Branch

An independent line of Git development used to isolate work.

---

## Code Review

The process of examining code changes for correctness, quality, security, architecture, and maintainability.

---

## Release

A formally validated version of the application prepared for distribution or production deployment.

---

## Semantic Versioning

A versioning convention using:

```text
MAJOR.MINOR.PATCH
```

Example:

```text
1.0.0
```

---

# 12. Testing Terms

## Unit Test

A test that verifies a small isolated piece of application logic.

---

## Integration Test

A test that verifies multiple components or services working together.

---

## API Test

A test that validates backend API behavior through HTTP requests.

---

## E2E Test

**End-to-End Test.**

A test that validates a complete user workflow through the application interface.

---

## Playwright

The browser automation and E2E testing framework used by ElectroHub.

---

## Cross-Browser Testing

Testing the application across supported browser engines.

---

## Accessibility

The practice of making the application usable by people with different abilities and interaction methods.

---

## Responsive Testing

Testing application behavior and layout across different screen sizes and devices.

---

## Regression

An unintended reintroduction of a bug or failure after a change.

---

# 13. Quality Terms

## QA

**Quality Assurance.**

The systematic process of verifying that the application meets functional, technical, usability, accessibility, and quality requirements.

---

## Smoke Test

A small set of tests that verifies that the most important application functionality is operational.

---

## Performance

The efficiency and responsiveness of the application under expected workloads.

---

## Lighthouse

A web quality auditing tool that can evaluate areas such as:

- Performance
- Accessibility
- Best Practices
- SEO

---

## Empty State

A UI state displayed when there is no data to show.

Example:

```text
Wishlist is empty.
```

---

## Loading State

A UI state displayed while data or an operation is being loaded.

---

## Skeleton

A visual placeholder representing the structure of content while it is loading.

---

## Error State

A UI state displayed when an operation fails or data cannot be loaded.

---

# 14. Architecture Terms

## Architecture

The high-level organization of application components, services, dependencies, and communication boundaries.

---

## Service Boundary

A defined boundary separating one application service from another.

---

## API Contract

The agreed structure and behavior of communication between services or clients.

---

## Separation of Concerns

An architectural principle where different responsibilities are handled by distinct components or layers.

---

## Source of Truth

The authoritative location from which a particular piece of information should be derived.

Examples:

```text
Figma
    ↓
Visual Design

Backend
    ↓
Commerce Business Logic

PostgreSQL
    ↓
Persisted Application Data
```

---

## ADR

**Architecture Decision Record.**

A documented record explaining a significant architectural decision, its reasoning, and its consequences.

---

## Technical Debt

The future cost created by choosing a temporary, incomplete, or less optimal implementation.

Technical debt should be explicitly identified rather than hidden.

---

# 15. Security Terms

## Security Boundary

A component or layer responsible for enforcing a security rule.

For ElectroHub:

```text
Backend
    ↓
Primary authorization boundary
```

The frontend must never be considered a sufficient security boundary.

---

## Password Hashing

The process of transforming passwords into secure non-reversible representations before storage.

---

## Principle of Least Privilege

The practice of granting users, services, and processes only the permissions they require.

---

## Secret Management

The secure handling of credentials, tokens, API keys, and other sensitive configuration.

---

# 16. Documentation Terms

## README

The primary repository-level introduction and usage document.

---

## Technical Documentation

Documentation describing how the system is designed, implemented, tested, deployed, and maintained.

---

## Changelog

A chronological record of meaningful project changes.

---

## Roadmap

The planned sequence of project milestones and implementation phases.

---

## Definition of Done

The criteria that must be satisfied before a task can be considered complete.

---

## Task

A defined unit of implementation work with a specific objective, scope, requirements, and acceptance criteria.

---

## Feature Traceability

The ability to connect a requirement or roadmap item to its implementation, documentation, and verification evidence.

---

# 17. Project-Specific Principles

## Evidence-Based Completion

A feature should not be marked complete merely because code exists.

Completion requires appropriate:

```text
Implementation
    +
Testing
    +
Documentation
    +
Verification
```

---

## Replaceable Integration

External services and AI implementations should be isolated sufficiently to allow replacement without redesigning unrelated application logic.

---

## Backend Authority

The backend owns authoritative commerce business rules.

The frontend provides the interface but does not enforce security or authoritative business decisions.

---

## Production Readiness

Production readiness means that the application has been implemented, tested, documented, secured, built, and verified against the project's release requirements.

---

# 18. Terminology Rule

When documentation, source code, or task descriptions introduce a new project-specific term:

1. Determine whether the term has an existing definition.
2. Reuse the existing terminology when possible.
3. Add a glossary entry if the term becomes important to the architecture or product.
4. Avoid introducing multiple names for the same concept.

Consistent terminology is required across:

- Product requirements
- UI
- APIs
- Database
- Documentation
- Tests
- Tasks
- Pull requests
- Architecture decisions

