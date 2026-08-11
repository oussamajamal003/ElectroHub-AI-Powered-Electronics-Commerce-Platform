# API Guidelines

## 1. Purpose

This document defines API standards for the ElectroHub backend.

The API should be:

- Consistent.
- Predictable.
- Secure.
- Validated.
- Versionable.
- Documentable.
- Easy for the frontend and external integrations to consume.

The backend is the authoritative API boundary for the application.

---

## 2. API Architecture

Requests should follow:

```text
Client
 ↓
Nginx / HTTPS
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
Prisma / External Integration
```

Controllers should remain thin and business logic should live in services.

---

## 3. API Style

The primary application API uses REST principles.

Resources should be represented as nouns.

Prefer:

```text
GET    /api/products
GET    /api/products/:id
POST   /api/products
PATCH  /api/products/:id
DELETE /api/products/:id
```

Avoid action-heavy routes when a resource-oriented design is appropriate.

---

## 4. Resource Naming

Use consistent plural resource names.

Prefer:

```text
/products
/categories
/orders
/cart
/wishlist
/payments
/delivery
```

Use lowercase URL paths.

Avoid inconsistent naming such as:

```text
/getProducts
/ProductList
/createNewOrder
```

---

## 5. API Versioning

The API should use an explicit version when versioning is introduced.

Example:

```text
/api/v1/products
/api/v1/orders
```

Breaking API changes require a deliberate versioning strategy rather than silently changing an existing contract.

---

## 6. HTTP Methods

Use HTTP methods according to operation semantics.

```text
GET       Retrieve
POST      Create / execute a non-idempotent operation
PUT       Replace
PATCH     Partially update
DELETE    Remove
```

The selected method must match the behavior of the endpoint.

---

## 7. HTTP Status Codes

Use appropriate status codes.

Common examples:

```text
200 OK
201 Created
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
```

Do not return `200` for every outcome.

---

## 8. Response Structure

Responses should be predictable.

Example:

```json
{
  "data": {
    "id": "product-123",
    "name": "Laptop"
  }
}
```

Collections may include pagination metadata:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

The exact response contract should remain consistent across related endpoints.

---

## 9. Error Structure

API errors should use a consistent structure.

Example:

```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product not found."
  }
}
```

Optional validation details may be included:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request.",
    "details": {}
  }
}
```

Do not expose stack traces, internal database errors, secrets, or provider credentials.

---

## 10. Request Validation

Every externally supplied request must be validated.

Validate:

- Body.
- Parameters.
- Query parameters.
- Headers where required.
- Uploaded files.
- Authentication context.

Frontend validation improves user experience but never replaces backend validation.

---

## 11. Zod and Runtime Validation

Where appropriate, use Zod or the project's approved validation layer.

Conceptually:

```text
HTTP Request
 ↓
Runtime Validation
 ↓
Typed Input
 ↓
Controller
 ↓
Service
```

Invalid input should fail before business logic executes.

---

## 12. Authentication

Protected endpoints require authentication.

```text
Request
 ↓
Authentication Middleware
 ↓
JWT Validation
 ↓
Authenticated User
 ↓
Authorization
 ↓
Controller
```

Public and protected endpoints must be clearly distinguished.

---

## 13. Authorization

Authentication answers:

```text
Who are you?
```

Authorization answers:

```text
Are you allowed to perform this operation?
```

Authorization must be enforced server-side.

Examples:

- A customer may view their own orders.
- A customer may modify their own cart.
- An administrator may manage products.
- An administrator may update delivery status.

The frontend must never be the only authorization layer.

---

## 14. Ownership Checks

Resource ownership must be verified before returning or modifying protected data.

Example:

```text
GET /api/orders/:id
        ↓
Authenticated User
        ↓
Does order belong to user?
        ↓
Yes → Return order
No  → Reject
```

Do not rely on an ID being difficult to guess as a security control.

---

## 15. Pagination

Large collections should support pagination.

Example:

```text
GET /api/products?page=1&pageSize=20
```

Pagination should be applied to:

- Products.
- Orders.
- Admin tables.
- Analytics collections where appropriate.
- Other potentially large datasets.

Avoid returning unbounded collections.

---

## 16. Filtering and Sorting

Collection endpoints may support controlled filtering and sorting.

Example:

```text
GET /api/products?category=laptops&sort=price_asc
```

Only supported fields should be accepted.

Do not directly translate arbitrary client input into database ordering or filtering.

---

## 17. Search API

Search should use a dedicated query contract.

Example:

```text
GET /api/search?q=laptop&page=1&pageSize=20
```

The backend should handle:

- Empty queries.
- Invalid parameters.
- No results.
- Pagination.
- Safe query construction.

---

## 18. Authentication and OTP APIs

Authentication endpoints may include:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/otp/request
POST /api/auth/otp/verify
```

OTP endpoints must enforce:

- Expiration.
- Attempt limits.
- Request rate limits.
- Single-use behavior.
- Secure response messages.

Brevo credentials remain server-side.

---

## 19. Checkout and Payment APIs

Checkout operations should be coordinated by the backend.

Conceptually:

```text
POST /api/checkout
        ↓
Validate Cart
        ↓
Validate Inventory
        ↓
Create / Confirm Payment
        ↓
Create Order
        ↓
Update Inventory
        ↓
Send Notifications
```

Stripe is used in Test Mode.

The backend must verify payment state rather than trusting frontend success messages.

---

## 20. Order APIs

Typical order endpoints:

```text
GET   /api/orders
GET   /api/orders/:id
POST  /api/orders
```

Administrative operations may include:

```text
PATCH /api/admin/orders/:id/status
```

Users must only access authorized orders.

---

## 21. Payment APIs

Payment endpoints should expose application-level payment state rather than sensitive provider information.

Do not expose:

```text
Stripe secret keys
Private payment credentials
Internal provider configuration
```

Provider-specific identifiers should only be returned when there is a legitimate client requirement.

---

## 22. Delivery APIs

Delivery operations may include:

```text
GET   /api/orders/:id/delivery
PATCH /api/admin/orders/:id/delivery
```

Delivery state is controlled by the backend.

Socket.IO may then broadcast approved state changes to connected clients.

---

## 23. Image Search API

The image-search flow is:

```text
Client
 ↓
POST /api/image-search
 ↓
Backend Validation
 ↓
FastAPI AI Service
 ↓
Matching Product References
 ↓
Backend Product Retrieval
 ↓
Response
```

The backend remains the public API boundary.

The FastAPI service should not expose internal AI implementation details through the main application API.

---

## 24. Recommendations API

Possible endpoint:

```text
GET /api/recommendations
```

Optional context may include a product:

```text
GET /api/recommendations?productId=product-123
```

The backend validates returned product references before exposing them to the client.

---

## 25. PDF APIs

Authorized document endpoints may include:

```text
GET /api/orders/:id/invoice
GET /api/orders/:id/payment-receipt
```

The backend must verify resource ownership or administrative authorization before generating or returning a document.

---

## 26. Email Notifications

Email delivery is initiated by backend services.

```text
Order / Payment / OTP Event
 ↓
EmailService
 ↓
Brevo
```

Email provider failures should be handled separately from authoritative order/payment state.

---

## 27. File Uploads

Uploaded files must be validated for:

- File type.
- File size.
- Expected content.
- Authorization.

This applies especially to:

```text
Product images
Search-by-image uploads
Camera images
```

Do not trust client-provided MIME types alone when stronger validation is required.

---

## 28. Rate Limiting

Rate limiting should be considered for sensitive or expensive endpoints.

Especially:

```text
Login
OTP Request
OTP Verification
Password-related operations
Search
Image Search
Payment Operations
```

Limits should balance security and legitimate user behavior.

---

## 29. CORS

CORS must be explicitly configured.

Production should allow only the required application origins.

Avoid unrestricted production configuration such as:

```text
Access-Control-Allow-Origin: *
```

when authenticated or sensitive operations are involved.

---

## 30. Idempotency

Operations that may be retried should consider idempotency.

This is especially important for:

```text
Payments
Order Creation
External Provider Calls
```

The implementation should prevent accidental duplicate orders or charges when a request is retried.

---

## 31. Transactions

When multiple database operations must succeed together:

```text
Order
+
Order Items
+
Inventory
```

use appropriate Prisma transaction boundaries.

External provider calls such as Stripe cannot participate directly in PostgreSQL transactions and require explicit reconciliation.

---

## 32. API Security

API security requirements include:

- Authentication.
- Authorization.
- Input validation.
- Rate limiting where appropriate.
- Secure headers.
- CORS restrictions.
- Safe error responses.
- HTTPS in production.
- Secret management.
- Audit logging where appropriate.

---

## 33. Logging

API logs should contain useful operational information without exposing secrets.

Never log:

```text
Passwords
JWT secrets
API keys
Stripe secrets
Brevo credentials
Sensitive payment data
```

---

## 34. API Compatibility

Changes to public API contracts require review.

Before changing an endpoint, consider:

- Existing frontend consumers.
- Existing tests.
- External integrations.
- Response compatibility.
- Database compatibility.
- Deployment order.

Breaking changes must be intentional and documented.

---

## 35. API Testing

Critical APIs should have tests covering:

```text
Successful Requests
Validation Errors
Authentication
Authorization
Not Found
Conflict
External Service Failure
Database Failure
Rate Limits
Edge Cases
```

Critical user journeys should also be covered through E2E tests.

---

## 36. API Documentation

Important endpoints should be documented with:

- Purpose.
- Method.
- Path.
- Authentication requirement.
- Request parameters/body.
- Response structure.
- Error cases.
- Authorization requirements.

Documentation must remain synchronized with implementation.

---

## 37. API Completion Criteria

An API endpoint is production-ready when:

- The contract is defined.
- Input is validated.
- Authentication is correct.
- Authorization is enforced.
- Status codes are appropriate.
- Responses are consistent.
- Errors are safe.
- Tests exist where required.
- Documentation is updated.
- No sensitive information is exposed.

---

## 38. API Principle

> **Design APIs as stable contracts: validate everything, authorize every protected operation, return predictable responses, and keep business logic behind the service layer.**
