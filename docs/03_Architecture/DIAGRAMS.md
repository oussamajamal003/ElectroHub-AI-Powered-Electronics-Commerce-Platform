# Architecture Diagrams

## 1. Purpose

This document provides the primary architecture diagrams for ElectroHub.

The diagrams communicate:

- Overall system architecture.
- Monorepo boundaries.
- Frontend/backend/AI relationships.
- Database access.
- External integrations.
- Authentication.
- Checkout and payments.
- Email and PDF generation.
- Delivery tracking.
- Image search.
- Recommendations.
- Production deployment.
- CI/CD.

The diagrams are conceptual representations. Detailed implementation behavior remains documented in the corresponding architecture and feature documents.

---

# 2. System Architecture

```text
                         ┌─────────────────────┐
                         │       Customer      │
                         │        Browser      │
                         └──────────┬──────────┘
                                    │
                              HTTPS / REST
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ React + TypeScript  │
                         │      Frontend       │
                         └──────────┬──────────┘
                                    │
                         HTTP / WebSocket
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Node.js + Express   │
                         │     Backend API     │
                         └──────┬─────┬─────┬──┘
                                │     │     │
                    ┌───────────┘     │     └───────────────┐
                    ▼                 ▼                     ▼
             ┌─────────────┐   ┌──────────────┐     ┌──────────────┐
             │ Prisma ORM  │   │ FastAPI AI   │     │ Integrations │
             └──────┬──────┘   └──────────────┘     └──────┬───────┘
                    │                                       │
                    ▼                             ┌─────────┼─────────┐
          ┌──────────────────┐                     ▼         ▼         ▼
          │ Supabase         │                  Stripe     Brevo   Cloudinary
          │ PostgreSQL       │
          └──────────────────┘
```

---

# 3. Monorepo Architecture

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
│   └── workflows/
│
├── docker-compose.yml
├── package.json
├── README.md
└── LICENSE
```

The repository is unified, while application services remain isolated.

---

# 4. Service Boundary Diagram

```text
┌──────────────────────────────────────────────────────────────┐
│                         ElectroHub                           │
│                                                              │
│  ┌────────────────┐      ┌────────────────┐                 │
│  │    Frontend    │─────►│    Backend     │                 │
│  │ React/TS/Vite  │ HTTP │ Node/Express   │                 │
│  └────────────────┘      └───────┬────────┘                 │
│                                  │                           │
│                     ┌────────────┼────────────┐              │
│                     ▼            ▼            ▼              │
│                ┌─────────┐ ┌─────────┐ ┌────────────┐       │
│                │ Prisma  │ │ FastAPI │ │ External   │       │
│                │         │ │   AI    │ │ Services   │       │
│                └────┬────┘ └─────────┘ └────────────┘       │
│                     │                                       │
└─────────────────────┼───────────────────────────────────────┘
                      ▼
              Supabase PostgreSQL
```

---

# 5. Frontend Data Flow

```text
React Component
      ↓
Feature Hook
      ↓
React Query
      ↓
API Client
      ↓
Backend API
      ↓
Service Layer
      ↓
Database / External Service
```

The frontend consumes server state and does not own authoritative business state.

---

# 6. Backend Layered Architecture

```text
┌──────────────────────────────┐
│          HTTP API            │
├──────────────────────────────┤
│ Routes                       │
├──────────────────────────────┤
│ Controllers                  │
├──────────────────────────────┤
│ Services / Business Logic    │
├──────────────────────────────┤
│ Repository / Prisma          │
├──────────────────────────────┤
│ Supabase PostgreSQL          │
└──────────────────────────────┘
```

Cross-cutting concerns such as authentication, validation, logging, and error handling are implemented through appropriate middleware/utilities.

---

# 7. Database Architecture

```text
                 ┌──────────────┐
                 │   Backend    │
                 └──────┬───────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ Prisma ORM  │
                 └──────┬───────┘
                        │
                        ▼
              ┌────────────────────┐
              │ Supabase PostgreSQL│
              └────────────────────┘
                        │
       ┌────────────────┼─────────────────┐
       ▼                ▼                 ▼
    Users            Products           Orders
       │                │                 │
       ▼                ▼                 ├── Payment
     Roles          Inventory             └── Delivery
```

---

# 8. Authentication Flow

```text
User
 ↓
Login / Registration
 ↓
Frontend
 ↓
Backend Auth API
 ↓
Credential Validation
 ↓
JWT / Refresh Token
 ↓
Authenticated Client
```

OTP:

```text
Authentication Event
 ↓
Backend
 ↓
OTP Generation
 ↓
Brevo
 ↓
User Email
 ↓
OTP Verification
 ↓
Backend
```

---

# 9. Checkout and Payment Flow

```text
Customer
 ↓
Cart
 ↓
Checkout
 ↓
Shipping Information
 ↓
Backend Validation
 ↓
Stripe Test Mode
 ↓
Payment Verification
 ↓
Order Creation
 ↓
Inventory Update
 ↓
Order Confirmation
```

No real customer payments are processed.

---

# 10. Payment Notification Flow

```text
Verified Payment
      ↓
PaymentService
      ↓
EmailService
      ↓
Brevo
      ↓
Payment Confirmation Email
```

PDF:

```text
Verified Payment
      ↓
PdfService
      ↓
Payment Receipt PDF
      ↓
Authorized Download
```

---

# 11. Order and Invoice Flow

```text
Order Created
      ↓
OrderService
      ├──────────────► Database
      │
      ├──────────────► Brevo
      │                  ↓
      │             Order Confirmation
      │
      └──────────────► PdfService
                         ↓
                    Invoice PDF
```

---

# 12. Inventory Flow

```text
Product
 ↓
Inventory
 ↓
Availability
 ├── In Stock
 ├── Low Stock
 └── Out of Stock
```

During checkout:

```text
Checkout
 ↓
Backend Inventory Validation
 ↓
Sufficient Quantity?
 ├── No → Reject / Update Cart
 └── Yes
       ↓
    Order Creation
       ↓
    Inventory Update
```

---

# 13. Delivery Tracking

```text
Admin
 ↓
Admin Dashboard
 ↓
Backend Delivery Service
 ↓
Database State Update
 ↓
Socket.IO Event
 ↓
Customer Browser
 ↓
Order Timeline
 +
Leaflet Map
```

Delivery states:

```text
Confirmed
 ↓
Preparing
 ↓
Out for Delivery
 ↓
Delivered
```

---

# 14. Map Architecture

```text
Backend Delivery Data
        ↓
React Delivery Page
        ↓
Leaflet
        ↓
OpenStreetMap
        ↓
Map / Markers / Route Visualization
```

The map is a visualization layer. Delivery state remains authoritative on the backend.

---

# 15. Image Search Flow

```text
Customer
 ↓
Search by Image
 ├── Upload
 └── Camera
 ↓
Frontend
 ↓
Backend
 ↓
FastAPI AI Service
 ↓
Image Processing
 ↓
Similarity / Matching
 ↓
Product IDs + Scores
 ↓
Backend
 ↓
PostgreSQL Product Data
 ↓
Frontend Results
 ↓
Product Details
```

---

# 16. Recommendation Flow

```text
User Behavior
 ├── Views
 ├── Clicks
 └── Purchases
        ↓
      Backend
        ↓
Recommendation Service
        ↓
FastAPI / Rule-Based Logic
        ↓
Ranked Product References
        ↓
Backend Product Retrieval
        ↓
Frontend
        ↓
Recommended Products
```

Supported approaches may include:

```text
Popular
Similar Category
Purchase History
Behavior-Based
```

---

# 17. Cloudinary Media Flow

```text
Admin
 ↓
Product Management
 ↓
Backend
 ↓
Cloudinary
 ↓
Image URL / Metadata
 ↓
PostgreSQL
 ↓
Product API
 ↓
Frontend
```

---

# 18. Real-Time Architecture

```text
┌───────────────┐
│     Admin     │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│    Backend    │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Socket.IO   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│    Customer   │
│    Browser    │
└───────────────┘
```

The server emits events after authoritative state changes.

---

# 19. AI Service Boundary

```text
┌───────────────────────┐
│      Backend          │
│                       │
│ Authentication        │
│ Authorization         │
│ Commerce Rules        │
│ Product Data          │
└───────────┬───────────┘
            │
            │ API
            ▼
┌───────────────────────┐
│   FastAPI AI Service  │
│                       │
│ Image Processing      │
│ Similarity            │
│ Recommendations       │
└───────────────────────┘
```

The AI service does not own commerce state.

---

# 20. Production Deployment

```text
                         Internet
                            │
                            ▼
                    ┌──────────────┐
                    │    HTTPS     │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    Nginx     │
                    └──────┬───────┘
                           ▼
              ┌────────────────────────┐
              │ DigitalOcean Ubuntu VPS│
              │                        │
              │       Docker           │
              │  ┌──────────────────┐  │
              │  │ Frontend         │  │
              │  ├──────────────────┤  │
              │  │ Backend          │  │
              │  ├──────────────────┤  │
              │  │ FastAPI AI       │  │
              │  └──────────────────┘  │
              └───────────┬────────────┘
                          │
           ┌──────────────┼───────────────┐
           ▼              ▼               ▼
       Supabase        Stripe           Brevo
      PostgreSQL      Test Mode        Email
                          │
                          ▼
                      Cloudinary
```

---

# 21. CI/CD Flow

```text
Developer
 ↓
Git Push / Pull Request
 ↓
GitHub Actions
 ↓
Install Dependencies
 ↓
Lint
 ↓
Type Check
 ↓
Unit / Integration Tests
 ↓
Build
 ↓
E2E Tests
 ↓
Approval
 ↓
Production Deployment
 ↓
DigitalOcean
 ↓
Docker
 ↓
Health Verification
```

---

# 22. Environment Flow

```text
Development
      ↓
Testing / CI
      ↓
Preview
      ↓
Production
```

Each environment must use appropriate configuration and secrets.

---

# 23. Security Boundary Diagram

```text
                 PUBLIC
                   │
                   ▼
              Nginx / HTTPS
                   │
                   ▼
              Frontend
                   │
                   ▼
             Backend API
          ┌────────┼────────┐
          ▼        ▼        ▼
       Auth     Business   Admin
                   │
                   ▼
                Prisma
                   │
                   ▼
              PostgreSQL
```

Sensitive operations remain behind the backend.

---

# 24. External Service Map

```text
                    Backend
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
     Stripe           Brevo         Cloudinary
    Payments          Email            Media
       │
       └─────────────────────────────────┐
                                         │
                                         ▼
                                  FastAPI AI Service
```

---

# 25. Architectural Principle

> **The frontend presents the system, the backend controls business logic and security, PostgreSQL stores authoritative persistent state, and specialized services provide isolated capabilities such as AI, payments, email, and media storage.**
