# Security Standard

## 1. Purpose

This document defines the security standards for ElectroHub.

Security applies across:

```text
Frontend
Backend
AI Service
Database
Authentication
Payments
Email
File Uploads
Infrastructure
CI/CD
```

The backend and infrastructure are the primary security boundaries.

---

## 2. Security Principles

ElectroHub follows:

- Defense in depth.
- Least privilege.
- Secure defaults.
- Server-side authorization.
- Input validation.
- Secret management.
- Data minimization.
- Explicit trust boundaries.
- Fail-safe behavior.

Security controls must not depend solely on frontend behavior.

---

## 3. Trust Boundaries

The architecture follows:

```text
Browser
  ↓
Public API
  ↓
Backend
  ↓
Internal Services / Database
```

The browser is untrusted.

The backend validates and authorizes all sensitive operations.

---

## 4. Authentication

Authentication uses:

```text
JWT
Refresh Tokens
Password Hashing
OTP
```

Authentication must be implemented server-side.

Passwords must never be stored in plaintext.

---

## 5. Password Security

Passwords must be hashed using an approved password-hashing algorithm.

Requirements:

- Never store plaintext passwords.
- Never log passwords.
- Never return password hashes through public APIs.
- Apply appropriate password policies.
- Protect authentication endpoints against abuse.

---

## 6. JWT Security

JWTs must:

- Use secure signing secrets.
- Have appropriate expiration.
- Be validated server-side.
- Not be accepted without signature verification.
- Not contain unnecessary sensitive information.

Signing secrets must be stored in secure environment configuration.

---

## 7. Refresh Tokens

Refresh tokens require stronger protection than ordinary application data.

The implementation should consider:

- Secure storage strategy.
- Expiration.
- Rotation where appropriate.
- Revocation.
- Token theft mitigation.
- Logout invalidation.

Refresh tokens must never be logged.

---

## 8. OTP Security

OTP functionality must enforce:

```text
Expiration
Single Use
Attempt Limits
Rate Limits
Secure Generation
```

OTP values must never be logged or returned through API responses.

Brevo credentials remain server-side.

---

## 9. Authorization

Authorization must be enforced by the backend.

Roles include at minimum:

```text
Customer
Administrator
```

Administrative operations require explicit authorization.

Never rely on:

```text
Hidden UI
Disabled Button
Frontend Route Guard
```

as the only authorization mechanism.

---

## 10. Resource Ownership

Users may only access resources they are authorized to access.

Examples:

```text
User → Own Orders
User → Own Wishlist
User → Own Cart
User → Own Profile
```

Administrators may access administrative resources according to their role.

Ownership checks must happen server-side.

---

## 11. Input Validation

All untrusted input must be validated.

Validate:

- Request bodies.
- Query parameters.
- Route parameters.
- File uploads.
- Authentication input.
- External service responses where necessary.

Use runtime validation in addition to TypeScript types.

---

## 12. Injection Prevention

Use safe database access patterns.

Prisma should be used for PostgreSQL access.

Avoid constructing raw SQL from untrusted input.

If raw SQL is ever required, parameters must be safely bound.

---

## 13. XSS Protection

Frontend output must not render untrusted HTML without proper sanitization.

Avoid unnecessary use of:

```text
dangerouslySetInnerHTML
```

User-generated content should be treated as untrusted.

Security headers should be configured appropriately in production.

---

## 14. CSRF

CSRF protection must match the authentication mechanism.

If authentication relies on cookies, appropriate CSRF protections must be implemented.

If tokens are sent through authorization headers, the overall token and CORS strategy must still be reviewed for browser security risks.

---

## 15. CORS

Production CORS configuration must allow only trusted application origins.

Avoid unrestricted origins for authenticated APIs.

Development origins may differ from production origins.

---

## 16. HTTP Security

Production traffic must use HTTPS.

Nginx should be configured with appropriate security headers and TLS settings.

HTTP should redirect to HTTPS where applicable.

---

## 17. Secrets Management

Never commit:

```text
.env
API Keys
JWT Secrets
Database Passwords
Stripe Secrets
Brevo API Keys
Cloudinary Secrets
Private Keys
```

Use environment variables or approved secret-management mechanisms.

Provide safe `.env.example` documentation without real credentials.

---

## 18. Stripe Security

Stripe is used in Test Mode.

The backend must:

- Keep secret keys server-side.
- Never expose secret keys to the frontend.
- Validate payment state server-side.
- Avoid trusting client-side payment success alone.
- Use idempotency where appropriate.
- Avoid logging sensitive payment data.

No real customer payments are processed.

---

## 19. Payment Webhooks

If Stripe webhooks are used, webhook authenticity must be verified.

The backend should validate:

```text
Webhook Signature
Event Type
Event State
Idempotency
```

Do not trust arbitrary client requests claiming that payment succeeded.

---

## 20. Email Security

Brevo credentials must remain server-side.

Email workflows must avoid exposing:

```text
API Keys
OTP Values
Internal provider configuration
```

Email content should minimize sensitive information.

---

## 21. PDF Security

Invoices and payment receipts are sensitive documents.

Before returning a PDF:

```text
Authenticate
 ↓
Authorize
 ↓
Verify Resource Ownership
 ↓
Generate / Retrieve Document
 ↓
Return Document
```

Users must not be able to access another user's invoice by changing an ID.

---

## 22. File Upload Security

Uploads such as:

```text
Product Images
Search-by-Image Files
Camera Images
```

must be validated.

Controls should include:

- File size limits.
- File type validation.
- Extension validation.
- Content validation where appropriate.
- Authorization.
- Safe storage.
- Resource limits.

Uploaded files must not automatically become executable content.

---

## 23. Cloudinary Security

Cloudinary credentials must remain server-side where required.

Uploaded media should use controlled upload policies.

Do not expose private credentials through frontend code.

---

## 24. AI Service Security

FastAPI should not be treated as a public unrestricted service.

Where appropriate:

```text
Backend
 ↓
Authenticated/Internal AI Request
 ↓
FastAPI
```

AI endpoints should enforce:

- Input validation.
- File limits.
- Timeouts.
- Rate limits.
- Resource limits.

---

## 25. Rate Limiting

Rate limiting should protect sensitive and expensive operations.

Priority endpoints include:

```text
Login
OTP Request
OTP Verification
Password Operations
Search
Image Search
Payment Operations
```

Rate limits should be appropriate for legitimate traffic.

---

## 26. Brute Force Protection

Authentication and OTP endpoints must be protected against repeated attempts.

Controls may include:

```text
Rate Limiting
Attempt Limits
Temporary Lockout
Progressive Delays
Monitoring
```

Do not reveal whether an account exists unnecessarily.

---

## 27. Session Security

Authentication/session behavior should include:

- Expiration.
- Secure token handling.
- Logout behavior.
- Refresh-token protection.
- Revocation where required.

Session state must be invalidated appropriately after security-sensitive events.

---

## 28. Error Security

Production errors must not expose:

```text
Stack Traces
Database Errors
SQL
File Paths
Environment Variables
Secrets
Provider Credentials
```

Return safe application-level errors.

---

## 29. Logging Security

Logs must never contain:

```text
Passwords
OTP Codes
JWTs
Refresh Tokens
API Keys
Stripe Secrets
Brevo Credentials
Cloudinary Secrets
Card Data
CVV
```

Logging must follow `LOGGING.md`.

---

## 30. Database Security

Supabase PostgreSQL access must use protected credentials.

Database access should follow least privilege.

The frontend must never connect directly to the production database.

Database credentials must remain server-side.

---

## 31. Prisma Security

Prisma should be the normal database access layer.

Use:

- Parameterized queries.
- Controlled selections.
- Authorization-aware service methods.
- Transactions where required.

Avoid exposing Prisma models directly as public API contracts when this leaks internal data.

---

## 32. Dependency Security

Dependencies should be reviewed for:

```text
Known vulnerabilities
Maintenance status
License compatibility
Unexpected transitive dependencies
```

Dependency updates should be performed deliberately and tested.

---

## 33. Docker Security

Containers should follow least privilege where practical.

Consider:

- Minimal base images.
- Non-root processes where supported.
- No secrets baked into images.
- Pinned/controlled dependencies.
- Limited exposed ports.
- Regular image updates.

Production containers should expose only required services.

---

## 34. Nginx Security

Nginx should provide the production edge layer.

Responsibilities include:

- HTTPS termination.
- Secure headers.
- Reverse proxying.
- Request limits where appropriate.
- Routing.
- Static asset handling.

Only required public ports should be exposed.

---

## 35. DigitalOcean Security

The production Ubuntu VPS should use:

- Firewall rules.
- SSH hardening.
- Key-based authentication.
- Limited exposed ports.
- Regular security updates.
- Monitoring.
- Protected environment configuration.

Administrative access should be restricted.

---

## 36. CI/CD Security

GitHub Actions must not expose secrets.

Use:

```text
GitHub Secrets
Environment Secrets
OIDC / short-lived credentials where appropriate
```

Do not print secrets in workflow logs.

Pull requests from untrusted sources must not receive unnecessary production credentials.

---

## 37. Dependency and Supply-Chain Security

CI should verify dependencies where practical.

Consider:

```text
npm audit
Dependency review
Lockfile integrity
Container scanning
```

Do not automatically accept every dependency update without review.

---

## 38. Security Headers

Production should use appropriate headers such as:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
```

Exact policies must be tested against application requirements before enforcement.

---

## 39. Data Minimization

Only collect and store information required for the application.

Avoid storing unnecessary:

```text
Personal information
Payment information
Location history
Authentication data
```

Sensitive data should have an explicit purpose and retention strategy.

---

## 40. Backup and Recovery

Production data must have an appropriate backup/recovery strategy.

Important considerations include:

```text
Database Backups
Recovery Testing
Backup Retention
Access Control
Failure Scenarios
```

A backup that has never been tested should not be treated as proven recoverability.

---

## 41. Security Testing

Security verification should include:

```text
Authentication Tests
Authorization Tests
Input Validation Tests
File Upload Tests
API Security Tests
Dependency Scanning
CORS Verification
HTTPS Verification
Secret Scanning
```

Critical vulnerabilities must be resolved before release.

---

## 42. Security Review

Before production release, verify:

- No secrets are committed.
- Authentication works correctly.
- Authorization is enforced server-side.
- Ownership checks exist.
- Inputs are validated.
- Rate limiting protects sensitive endpoints.
- Stripe secrets remain private.
- Brevo credentials remain private.
- PDF access is authorized.
- File uploads are restricted.
- AI endpoints are protected.
- HTTPS is enabled.
- Production CORS is restricted.
- Logs contain no secrets.
- Dependencies have been reviewed.

---

## 43. Security Principle

> **Treat every client input as untrusted, keep sensitive operations behind the backend, enforce least privilege, and protect secrets at every layer.**
