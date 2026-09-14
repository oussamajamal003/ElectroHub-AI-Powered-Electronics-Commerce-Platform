# Backend Architecture

## 1. Purpose

This document defines the backend architecture for ElectroHub.

The backend is the central application service and the primary security boundary. It owns REST APIs, authentication, authorization, business logic, database access, commerce workflows, external integrations, PDF generation, email orchestration, AI integration, and real-time communication.

## 2. Technology Stack

```text
Node.js
Express.js
TypeScript
Prisma ORM
Supabase PostgreSQL
Socket.IO
Stripe Test Mode
Brevo
Cloudinary
```

The backend communicates with the separate FastAPI AI service through defined APIs.

## 3. Architecture Flow

```text
HTTP Request
 ↓
Express
 ↓
Middleware
 ↓
Route
 ↓
Controller
 ↓
Service
 ↓
Prisma / Repository
 ↓
Supabase PostgreSQL
```

Controllers remain thin. Business logic belongs in services.

## 4. Recommended Structure

```text
apps/backend/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── integrations/
│   ├── validators/
│   ├── sockets/
│   ├── utils/
│   ├── types/
│   └── app.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
├── tests/
├── package.json
└── tsconfig.json
```

## 5. API and Service Layers

Routes define endpoints and controllers translate HTTP requests into application operations.

Typical services:

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

Services should avoid coupling business logic to Express request/response objects.

## 6. Authentication and Authorization

Authentication uses:

```text
JWT
Refresh Tokens
Password Hashing
Role-Based Access Control
```

OTP flow:

```text
Authentication Event
 ↓
OTP Generation
 ↓
Email Service
 ↓
Brevo
 ↓
User Email
```

OTP handling must protect against expiration, reuse, excessive attempts, and excessive requests.

Authorization is enforced by the backend. Frontend role checks are not security controls.

## 7. Validation

Backend validation is mandatory even when the frontend validates input.

Validate:

- Request bodies.
- Parameters.
- Query parameters.
- Authentication context.
- Business rules.

API errors should use a consistent structure.

## 8. Database

Prisma is the database access layer for Supabase PostgreSQL.

```text
Service
 ↓
Prisma / Repository
 ↓
PostgreSQL
```

The frontend never connects directly to PostgreSQL.

## 9. Commerce Architecture

Product, category, cart, wishlist, inventory, checkout, and order operations are server-owned.

Cart and inventory must be revalidated by the backend during purchase workflows.

## 10. Checkout and Payments

Stripe is used in Test Mode.

```text
Customer
 ↓
Frontend Payment UI
 ↓
Backend
 ↓
Stripe Test Mode
 ↓
Verified Payment Result
 ↓
Payment / Order State
```

The backend verifies payment results before marking payment successful. No real customer payments are processed.

## 11. Orders

Order lifecycle:

```text
Confirmed
 ↓
Preparing
 ↓
Out for Delivery
 ↓
Delivered
```

Customers can view orders, payment status, delivery status, invoices, and payment receipts where available.

Administrators can manage orders, payment state, and shipment progress.

Multi-record order operations should use appropriate database transaction boundaries.

## 12. Inventory

Inventory states:

```text
In Stock
Low Stock
Out of Stock
```

Inventory quantity and availability are authoritative on the backend/database.

The backend must re-check inventory during purchase workflows.

## 13. Email Integration

Brevo handles:

```text
OTP
Order Confirmation
Payment Confirmation
```

Flow:

```text
Application Event
 ↓
EmailService
 ↓
Brevo
 ↓
Customer
```

Email credentials remain server-side.

Email delivery failure must be distinguished from the authoritative order/payment state.

## 14. PDF Generation

The backend generates:

```text
Order Invoice PDF
Payment Receipt PDF
```

Flow:

```text
Authorized Request
 ↓
Order / Payment Service
 ↓
PdfService
 ↓
PDF Generation
 ↓
Authorized Download
```

Documents must be generated from authoritative backend data. Users may only access documents they are authorized to view.

## 15. Delivery and Socket.IO

Delivery updates flow through:

```text
Admin
 ↓
DeliveryService
 ↓
Database State Update
 ↓
Socket.IO
 ↓
Customer
```

The server is the source of truth for delivery state.

## 16. AI Integration

```text
Frontend
 ↓
Backend
 ↓
FastAPI AI Service
 ↓
AI Result
 ↓
Backend
 ↓
Frontend
```

The backend owns authentication, authorization, product retrieval, and commerce rules. FastAPI owns AI-specific processing.

## 17. Image Search

```text
Upload / Camera
 ↓
Backend
 ↓
FastAPI
 ↓
Image Analysis / Similarity
 ↓
Product References
 ↓
Backend Product Retrieval
 ↓
Frontend
```

Simulated matching logic is acceptable for the academic/portfolio implementation when explicitly documented.

## 18. Recommendations

Supported modes may include:

```text
Popular Products
Similar Category
Purchase History
Behavior-Based Recommendations
```

The architecture must distinguish real ML from rule-based or simulated behavior.

## 19. Cloudinary

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

Authorization must be enforced for administrative media operations.

## 20. Error and External-Service Handling

Errors should distinguish:

```text
Validation
Authentication
Authorization
Not Found
Conflict
Business Rule
Payment
External Service
Database
Internal
```

External integrations include Stripe, Brevo, Cloudinary, and FastAPI.

Handle timeouts, provider failures, invalid responses, and retryable failures appropriately.

Internal stack traces and secrets must never be exposed.

## 21. Security

Required controls include:

- Password hashing.
- JWT validation.
- Refresh-token protection.
- RBAC.
- Input validation.
- Authorization checks.
- Rate limiting where appropriate.
- Secure headers.
- CORS configuration.
- Secure environment variables.
- Safe error responses.

Secrets must never be committed to Git.

## 22. Transactions and Consistency

Use database transactions where business consistency requires atomicity, especially for related operations such as:

```text
Order Creation
+
Order Items
+
Inventory Update
```

External provider calls do not participate in PostgreSQL transactions and must be handled separately.

## 23. Configuration

Environment variables hold sensitive configuration such as:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
BREVO_API_KEY
CLOUDINARY credentials
AI_SERVICE_URL
```

Production secrets are managed by the deployment environment.

## 24. Testing

Backend tests should cover:

```text
Unit
Integration
API
Database
External Integration
E2E
```

Critical workflows include authentication, OTP, cart, checkout, payment, orders, inventory, delivery, admin authorization, PDF access, and email orchestration.

## 25. Performance

Consider:

- Efficient Prisma queries.
- Database indexes.
- Pagination.
- Avoiding N+1 queries.
- Controlled external API calls.
- Caching where appropriate.
- Efficient PDF generation.
- Appropriate logging volume.

## 26. Completion Criteria

The backend architecture is complete when request flow, layers, authentication, database access, payments, email, PDF generation, orders, inventory, delivery, AI, Cloudinary, errors, security, transactions, and testing are documented.

## 27. Backend Foundation (TASK 02.1)

The Phase 02.1 Backend Foundation establishes the foundational infrastructure required for feature development:

- **App/Server Separation**: `app.ts` configures the Express application (middleware, routing), and `server.ts` imports the configured app to bind the HTTP server. This allows HTTP testing without binding to a port.
- **Middleware Order**:
  1. `requestId` (assigns UUID to `req.id`)
  2. `helmet` (security headers)
  3. `cors` (frontend origin access)
  4. `express.json` & `express.urlencoded` (strict 10kb body limits)
  5. `requestLogger` (logs request method, path, and UUID)
  6. API Routes (`/api`)
  7. Swagger UI (`/api/docs`)
  8. `notFoundHandler` (404 catch-all)
  9. `errorHandler` (global error catch)
- **Logging Integration**: Centralized Winston logger integrates request/error logging. Sensitive metadata (e.g., passwords, tokens) is actively redacted via `winston.format`.
- **Health / Readiness**:
  - `GET /api/health`: Deterministic endpoint verifying the server is actively running.
  - `GET /api/ready`: **N/A** (Currently not required by the deployment architecture as no external stateful boundaries are mandatory for startup).
- **Startup / Shutdown**: Graceful shutdown handles `SIGINT`/`SIGTERM`, safely closing active HTTP connections within a 10s timeout window before process exit.
- **Environment**: Configuration is validated strictly at startup using `zod` in `config/env.ts`.

## 28. Backend Principle

> **Keep business logic centralized, security server-side, persistence consistent, and external integrations isolated behind clear service boundaries.**
