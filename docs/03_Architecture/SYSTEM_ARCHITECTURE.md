# System Architecture

## 1. Purpose

This document defines the high-level architecture of ElectroHub.

ElectroHub is a full-stack electronics and technology e-commerce platform built as a single monorepo containing:

- React frontend
- Node.js / Express backend
- FastAPI AI service
- Supabase PostgreSQL database
- Prisma ORM
- Stripe Test Mode payments
- Brevo transactional email
- PDF generation
- Socket.IO real-time communication
- Leaflet + OpenStreetMap delivery maps
- Cloudinary media storage
- Docker-based services
- GitHub Actions CI/CD
- DigitalOcean production deployment

The architecture is designed to keep responsibilities separated while allowing the services to operate as one coordinated product.

---

## 2. Architectural Goals

The system prioritizes:

- Clear service boundaries.
- Maintainable code organization.
- Secure communication.
- Scalable feature development.
- Reusable frontend components.
- Centralized business logic.
- Reliable database access.
- Isolated AI functionality.
- Real-time delivery updates.
- Testable services.
- Containerized deployment.
- Production-oriented infrastructure.

---

## 3. Repository Architecture

ElectroHub uses a single monorepo.

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
└── LICENSE
```

The monorepo allows coordinated development while maintaining clear service ownership.

---

## 4. System Overview

```text
Customer Browser
      │
      ▼
React + TypeScript Frontend
      │ HTTPS / REST
      ▼
Node.js + Express Backend
   ┌──┼───────────┬─────────────┐
   ▼  ▼           ▼             ▼
Prisma FastAPI    Stripe        Brevo
   │    AI        Test Mode     Email
   ▼
Supabase PostgreSQL

Backend ── Socket.IO ──► Customer
Frontend ── Leaflet + OpenStreetMap ──► Delivery Map
Backend ── Cloudinary ──► Product Media
```

---

## 5. Frontend

The frontend owns:

- Customer interface.
- Administrator interface.
- Routing.
- UI rendering.
- User interaction.
- Client-side validation.
- Query/cache management.
- Authentication presentation.
- Responsive behavior.
- Accessibility.
- Real-time UI updates.
- Map visualization.

Technology:

```text
React
TypeScript
Vite
SCSS
CSS Modules
React Query
React Router
React Hook Form
Zod
Framer Motion
Radix UI
Lucide React
TanStack Table
Socket.IO Client
Leaflet
```

The frontend must not directly access the database.

---

## 6. Backend

The backend is the central application service.

Technology:

```text
Node.js
Express.js
TypeScript
Prisma
```

It owns:

- REST APIs.
- Authentication and authorization.
- Business rules.
- Products and categories.
- Search.
- Cart and wishlist.
- Checkout and payments.
- Orders and inventory.
- Delivery.
- Administration and analytics.
- Email orchestration.
- PDF generation.
- AI-service integration.
- Real-time communication.

The backend is the primary security boundary.

---

## 7. AI Service

The AI service is isolated from core commerce logic.

Technology:

```text
Python
FastAPI
```

Responsibilities:

- Image analysis.
- Image similarity processing.
- Recommendation processing.
- AI-specific logic.

The AI service must not own authentication, payments, orders, inventory, or customer accounts.

---

## 8. Database

The primary database is:

```text
Supabase PostgreSQL
```

The backend accesses it through:

```text
Prisma ORM
```

The database stores users, roles, products, categories, images, inventory, carts, wishlist entries, orders, payments, delivery data, recommendations, and relevant operational records.

The frontend never connects directly to PostgreSQL.

---

## 9. Authentication and Authorization

Authentication uses:

```text
JWT
Refresh Tokens
Password Hashing
Role-Based Access Control
```

Flow:

```text
User
 ↓
Login / Registration
 ↓
Backend
 ↓
Credential Validation
 ↓
JWT / Refresh Token
 ↓
Authenticated Client
```

OTP delivery:

```text
Backend → Brevo → User Email
```

Administrative authorization must always be enforced by the backend. Frontend role checks are only a UX mechanism.

---

## 10. API Architecture

```text
Frontend
 ↓
API Client
 ↓
Express Routes
 ↓
Controllers
 ↓
Services
 ↓
Prisma
 ↓
PostgreSQL
```

Routes should remain thin. Business logic belongs in the service layer.

---

## 11. Service Layer

The backend may organize business logic into services such as:

```text
AuthService
ProductService
CategoryService
SearchService
CartService
WishlistService
CheckoutService
PaymentService
OrderService
InventoryService
DeliveryService
RecommendationService
EmailService
PdfService
```

Services should avoid unnecessary coupling to HTTP-specific concerns.

---

## 12. Payments

Stripe is used in Test Mode.

```text
Customer
 ↓
Checkout
 ↓
Backend
 ↓
Stripe Test Mode
 ↓
Verified Payment Result
 ↓
Order / Payment State
```

No real customer payments are processed.

The frontend must never independently mark a payment as successful.

---

## 13. Transactional Email

Brevo handles transactional emails for:

```text
OTP
Order Confirmation
Payment Confirmation
```

Flow:

```text
Application Event
 ↓
Backend Email Service
 ↓
Brevo
 ↓
Customer Email
```

Brevo credentials remain server-side and are stored in environment variables.

---

## 14. PDF Generation

The backend generates:

```text
Order Invoice PDF
Payment Receipt PDF
```

Flow:

```text
Order / Payment Data
 ↓
PDF Service
 ↓
Generated PDF
 ↓
Authorized Download / Delivery
```

Users may only access documents belonging to orders they are authorized to view.

---

## 15. Orders and Inventory

Order flow:

```text
Cart
 ↓
Checkout Validation
 ↓
Payment
 ↓
Order Creation
 ↓
Inventory Update
 ↓
Order Confirmation
 ↓
Email / PDF Availability
```

Inventory states:

```text
In Stock
Low Stock
Out of Stock
```

Inventory and purchase validation are authoritative on the backend/database.

---

## 16. Delivery and Real-Time Architecture

Delivery states:

```text
Confirmed
Preparing
Out for Delivery
Delivered
```

Real-time flow:

```text
Admin
 ↓
Backend
 ↓
Socket.IO
 ↓
Customer
 ↓
Timeline / Status UI
```

The backend remains the source of truth for delivery state.

Maps use:

```text
Leaflet
OpenStreetMap
```

The frontend visualizes authoritative backend delivery/location data.

---

## 17. Image Search

```text
Customer
 ↓
Upload / Camera
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

The project may use simulated matching logic for academic/demo purposes when explicitly documented.

---

## 18. Recommendations

Recommendation modes may include:

```text
Popular Products
Similar Category
Purchase History
Behavior-Based Recommendations
```

The architecture must distinguish:

```text
Real ML
Rule-Based Logic
Simulated Academic Logic
```

---

## 19. Media Storage

Cloudinary stores product media.

```text
Admin
 ↓
Backend
 ↓
Cloudinary
 ↓
Image URL / Metadata
 ↓
Database
```

The database stores relevant media metadata/references rather than unnecessary binary image data.

---

## 20. Frontend Server-State Architecture

```text
React Component
 ↓
Feature Hook
 ↓
React Query
 ↓
API Client
 ↓
Backend
```

React Query manages fetching, caching, loading, errors, refetching, and invalidation.

Local UI state remains separate from server state.

---

## 21. UI Architecture

```text
React
 ↓
Reusable Components
 ↓
Radix UI primitives where appropriate
 ↓
SCSS
 ↓
CSS Modules
```

The project does not use:

```text
Tailwind CSS
shadcn/ui
Bootstrap
Material Design visual system
```

---

## 22. External Service Boundaries

External integrations should be isolated behind backend abstractions:

```text
PaymentService → Stripe
EmailService → Brevo
MediaService → Cloudinary
PdfService → PDF Generator
AiService → FastAPI
```

This reduces coupling between business logic and third-party SDKs.

---

## 23. Security Boundaries

Security-sensitive responsibilities remain server-side:

- Authentication.
- Authorization.
- Payments.
- Orders.
- Inventory.
- Administrative actions.
- PDF access.
- Email credentials.
- External service credentials.

Secrets must never be committed to Git.

---

## 24. Deployment Architecture

Production uses:

```text
DigitalOcean Cloud VPS
Ubuntu
Docker
Nginx
SSL / HTTPS
```

Conceptually:

```text
Internet
 ↓
HTTPS
 ↓
Nginx
 ↓
Dockerized Application Services
 ↓
External Services
```

Production deployment is intentionally handled during the final project phase.

---

## 25. CI/CD

GitHub Actions provides automated validation and deployment workflows.

Typical pipeline:

```text
Push / Pull Request
 ↓
Install
 ↓
Lint
 ↓
Type Check
 ↓
Unit / Integration Tests
 ↓
Build
 ↓
E2E
 ↓
Deployment
```

Production deployment is finalized in the final project phase.

---

## 26. Scalability

The initial production deployment may use a single DigitalOcean VPS.

Service boundaries remain clear so services can be separated later if actual scale requires it.

Avoid premature infrastructure complexity.

---

## 27. Sources of Truth

```text
Figma → Intended visual design
Backend → Business rules
PostgreSQL → Persistent application state
Stripe → Payment-provider state
Backend / Socket.IO → Delivery events
Cloudinary → Media assets
FastAPI → AI processing
```

External-service results must be reconciled into authoritative application state where required.

---

## 28. Completion Criteria

The architecture is complete when:

- Service boundaries are defined.
- Frontend, backend, AI, and database responsibilities are defined.
- Authentication and authorization boundaries are defined.
- Payment flow is defined.
- Email flow is defined.
- PDF generation is defined.
- Delivery real-time flow is defined.
- Image-search flow is defined.
- Recommendation flow is defined.
- Deployment and CI/CD are defined.
- Security boundaries are defined.

---

## 29. Architectural Principle

> **Keep responsibilities explicit, services isolated, and business-critical state authoritative on the backend.**
