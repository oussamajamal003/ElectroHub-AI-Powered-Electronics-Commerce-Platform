# Security

## 1. Purpose

This document defines the operational security requirements for ElectroHub.

Security applies across:

```text
Frontend
Backend
AI Service
Database
Authentication
Payments
Email
PDF Documents
File Uploads
Real-Time Communication
Docker
Nginx
DigitalOcean
CI/CD
```

Security is a system-wide requirement and must not depend on the frontend alone.

---

# 2. Security Principles

ElectroHub follows these principles:

- Least privilege.
- Defense in depth.
- Secure-by-default configuration.
- Backend-enforced authorization.
- Secret isolation.
- Input validation.
- Explicit trust boundaries.
- Minimal public exposure.
- Evidence-based security verification.

---

# 3. Authentication

The application uses:

```text
JWT Authentication
Refresh Tokens
Password Hashing
OTP Verification
```

Authentication must be handled by the backend.

The frontend must never be considered a security boundary.

---

# 4. Authorization

Authorization must be enforced server-side.

The system must distinguish at minimum between:

```text
Customer
Administrator
```

Protected operations must verify the authenticated user's permissions before executing business logic.

---

# 5. Customer Data Isolation

Customers must only access resources they are authorized to access.

This applies to:

```text
Orders
Order Items
Payment Records
Invoices
Payment Receipts
Wishlist
Cart
Delivery Information
Personal Information
```

An identifier supplied by the client must never be treated as proof of ownership.

---

# 6. Password Security

Passwords must:

- Never be stored in plaintext.
- Be hashed using an appropriate password-hashing algorithm.
- Never appear in logs.
- Never be returned by APIs.

Password validation must occur on the backend.

---

# 7. OTP Security

OTP functionality is used for authentication-related verification.

OTP requirements include:

```text
Short Expiration
Attempt Limits
Rate Limiting
Secure Storage
One-Time Use
```

OTP values must never be logged.

Brevo is used for OTP delivery.

---

# 8. JWT and Refresh Tokens

JWT and refresh-token handling must:

- Use secure signing secrets.
- Validate expiration.
- Validate token type where applicable.
- Reject malformed tokens.
- Support token revocation/rotation according to the authentication design.
- Avoid exposing secrets to client-side logs.

---

# 9. API Security

Backend APIs must use:

```text
Authentication
Authorization
Request Validation
Rate Limiting where required
Consistent Error Handling
```

Never trust:

```text
Client Prices
Client Roles
Client Ownership Claims
Client Inventory Values
Client Payment Status
```

Business-critical values must be calculated or verified by the backend.

---

# 10. Input Validation

All externally supplied input must be validated.

Examples:

```text
Request Body
Query Parameters
Path Parameters
Headers
File Uploads
Payment Data
Search Queries
Admin Forms
```

Zod or the project's approved validation approach should be used consistently at application boundaries.

---

# 11. Injection Protection

The application must protect against:

```text
SQL Injection
Command Injection
XSS
Path Traversal
Header Injection
```

Prisma should be used through safe parameterized operations.

Raw database queries require explicit review.

---

# 12. File Upload Security

Image uploads must be validated for:

```text
File Type
File Size
Content
Extension
```

Do not trust a client-provided MIME type or file extension alone.

Uploaded files must not be treated as executable application code.

---

# 13. Image Search Security

Image-search endpoints must enforce:

```text
Authentication / Access Rules
Upload Limits
File Validation
Request Limits
AI Timeouts
Resource Limits
```

AI processing must not be allowed to consume unlimited server resources.

---

# 14. Payment Security

Stripe is used in Test Mode for this project.

The backend must remain responsible for:

```text
Payment Validation
Order Validation
Payment State
Webhook Verification
```

Never trust payment status supplied directly by the frontend.

Stripe secrets must never be exposed to the frontend or committed to Git.

---

# 15. Email Security

Brevo is used for:

```text
OTP
Order Confirmation
Payment Confirmation
```

Brevo API credentials must remain server-side.

Emails must not expose unnecessary sensitive information.

---

# 16. PDF Document Security

Generated documents include:

```text
Order Invoice
Payment Receipt
```

Document endpoints must verify authorization before returning a document.

Customers must never be able to access another customer's documents by changing an ID or URL.

---

# 17. Socket.IO Security

Socket.IO connections must enforce authentication and authorization where required.

Delivery updates must be scoped to the appropriate customer/order.

The server must prevent:

```text
Unauthorized Room Access
Cross-Customer Data Leakage
Unauthorized Status Updates
```

---

# 18. AI Service Security

The FastAPI service must remain behind a controlled service boundary.

The backend should validate AI responses before using them in commerce workflows.

AI output must never automatically override:

```text
Authorization
Pricing
Inventory
Payment State
Order State
```

---

# 19. Database Security

Database credentials must be stored securely.

The application should use the minimum required database permissions.

Production database access must not be exposed publicly through unnecessary ports.

Supabase PostgreSQL remains the managed database layer.

---

# 20. Environment Variables and Secrets

Sensitive configuration includes:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
BREVO_API_KEY
CLOUDINARY_URL
```

Secrets must:

- Never be committed.
- Never be hard-coded.
- Never be printed to logs.
- Never be included in Docker images.
- Be separated by environment.

---

# 21. Docker Security

Production containers should:

- Use minimal images.
- Avoid unnecessary packages.
- Run as non-root where practical.
- Expose only required ports.
- Avoid embedded secrets.
- Keep dependencies updated.

---

# 22. Nginx and Network Security

Production public access should normally be limited to:

```text
80
443
```

Nginx is the public entry point.

Internal ports for:

```text
Backend
AI Service
Socket.IO
```

should remain private where possible.

---

# 23. SSL/TLS

Production must use HTTPS.

Expected flow:

```text
Client
 ↓
HTTPS
 ↓
Nginx
 ↓
Application
```

TLS certificates must be renewed and monitored.

---

# 24. CORS

CORS must allow only the required origins.

Do not use unrestricted production configuration such as:

```text
*
```

when credentials or protected APIs are involved.

---

# 25. Security Headers

Production should use appropriate security headers where compatible with the application.

Examples include:

```text
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Content-Security-Policy
```

Restrictive policies must be tested before enforcement.

---

# 26. Rate Limiting

Rate limiting should protect sensitive or abuse-prone endpoints.

Priority areas include:

```text
Login
Registration
OTP Requests
OTP Verification
Password Operations
Search
Image Upload
Checkout
Authentication APIs
```

Limits must balance security with legitimate use.

---

# 27. Logging Security

Logs must never contain:

```text
Passwords
OTP Values
JWT Secrets
Refresh Tokens
API Keys
Payment Secrets
Private Customer Data
```

Logs should contain enough context to investigate failures without exposing sensitive data.

---

# 28. Dependency Security

Dependencies must be monitored for known vulnerabilities.

Security updates must be evaluated before being applied to production.

Dependency changes must not bypass testing.

---

# 29. CI/CD Security

GitHub Actions must:

- Use protected secrets.
- Restrict production deployment permissions.
- Avoid printing secrets.
- Validate builds and tests.
- Use approved release paths.
- Preserve deployment evidence.

Production deployment must not be triggered by arbitrary unreviewed code.

---

# 30. Server Security

The DigitalOcean Ubuntu VPS must be maintained with:

```text
Security Updates
Firewall
SSH Protection
Docker Updates
Nginx Updates
```

Unused services and ports should be disabled.

---

# 31. Backup and Recovery Security

Backups must be protected from unauthorized access.

Recovery procedures must account for:

```text
Database
Application Release
Environment Configuration
```

Recovery credentials must remain secure.

---

# 32. Security Testing

Security verification should include:

```text
Authentication Testing
Authorization Testing
Input Validation
File Upload Testing
API Security Testing
Dependency Scanning
Container Scanning
Access-Control Testing
```

Critical security findings must block release unless formally accepted.

---

# 33. Security Incident Response

If a security incident is suspected:

```text
Detect
 ↓
Contain
 ↓
Preserve Evidence
 ↓
Assess Impact
 ↓
Remediate
 ↓
Verify
 ↓
Document
```

Do not silently continue deployment after discovering a critical security issue.

---

# 34. Definition of Done

Security operations are complete when:

- Authentication is protected.
- Authorization is enforced server-side.
- Customer data isolation is verified.
- Secrets are protected.
- Sensitive data is not logged.
- Input validation is implemented.
- File uploads are restricted.
- Payment integrations are protected.
- Email credentials remain server-side.
- PDF access is authorized.
- Socket.IO access is controlled.
- Internal services are not unnecessarily exposed.
- HTTPS is active in production.
- Dependencies are reviewed.
- Security checks pass.

---

# 35. Security Principle

> **Security is enforced at every trust boundary, with the backend and infrastructure treated as the primary enforcement layers rather than relying on client-side behavior.**
