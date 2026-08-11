# Production

## 1. Purpose

This document defines the production environment and operational requirements for ElectroHub.

Production is the final runtime environment for the completed application.

The production environment is intentionally introduced during the final deployment phase.

---

# 2. Production Stack

The planned production stack is:

```text
DigitalOcean Cloud VPS
Ubuntu
Docker
Nginx
SSL
GitHub Actions
```

Application services:

```text
React Frontend
Node.js / Express Backend
FastAPI AI Service
```

External services:

```text
Supabase PostgreSQL
Stripe Test Mode
Brevo
Cloudinary
```

---

# 3. Production Architecture

```text
                         Internet
                            │
                         HTTPS
                            │
                         Nginx
                            │
              ┌─────────────┴─────────────┐
              │                           │
          Frontend                     Backend
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                 Prisma               FastAPI              Socket.IO
                    │
             Supabase PostgreSQL

External integrations:
    Stripe
    Brevo
    Cloudinary
```

Nginx is the public entry point.

Internal application services should not be unnecessarily exposed to the public internet.

---

# 4. Production Responsibilities

## Frontend

Responsible for:

```text
Customer UI
Admin UI
Routing
Forms
API Consumption
Responsive Interface
```

---

## Backend

Responsible for:

```text
Authentication
Authorization
Business Logic
Products
Categories
Search
Cart
Wishlist
Checkout
Payments
Orders
Inventory
Delivery
Admin
Analytics
Email Integration
PDF Generation
AI Integration
Socket.IO
```

---

## AI Service

Responsible for:

```text
Image Search
Recommendation Processing
AI-specific Processing
```

The AI service must remain separated from core commerce business logic.

---

# 5. Database

Production uses:

```text
Supabase PostgreSQL
        ↓
Prisma
        ↓
Backend
```

The database is managed outside the DigitalOcean VPS.

Production database credentials must be stored securely.

---

# 6. Payments

Stripe is used in:

```text
Test Mode
```

The project does not process real customer payments.

Production-like deployment must not accidentally use live Stripe credentials.

---

# 7. Transactional Email

Brevo provides transactional email for:

```text
OTP
Order Confirmation
Payment Confirmation
```

Email failures must be handled without exposing sensitive information.

---

# 8. PDF Documents

The application generates:

```text
Order Invoice PDF
Payment Receipt PDF
```

Documents must be access-controlled so customers can only retrieve documents belonging to their authorized orders.

---

# 9. Media

Cloudinary is used for application media where configured.

Production credentials must be stored as protected environment variables.

---

# 10. Environment Variables

Production configuration may include:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
BREVO_API_KEY
CLOUDINARY_URL
AI_SERVICE_URL
```

Secrets must never be committed to Git.

---

# 11. Server Security

The DigitalOcean VPS must use:

```text
Ubuntu
Firewall
SSH Security
Docker
Nginx
HTTPS
```

Only required public ports should be exposed.

Typical public ports:

```text
80
443
```

Internal application ports should remain private.

---

# 12. Docker

Production services run as Docker containers.

Expected services:

```text
frontend
backend
ai-service
```

Containers must:

- Build reproducibly.
- Avoid embedded secrets.
- Use appropriate runtime users.
- Expose only required ports.
- Have controlled resource usage.

---

# 13. Nginx

Nginx handles:

```text
HTTPS
Reverse Proxy
Frontend Routing
Backend Routing
Socket.IO Proxying
Security Headers
Request Limits
```

Nginx must not contain application business logic.

---

# 14. SSL

Production must use HTTPS.

Expected flow:

```text
HTTP
 ↓
HTTPS Redirect
 ↓
Nginx
 ↓
Application
```

Certificate renewal must be configured and monitored.

---

# 15. Health Checks

Production verification must include:

```text
Frontend
Backend /health
AI Service
Database Connectivity
Nginx
HTTPS
Socket.IO
```

Health checks must not expose secrets or sensitive internal information.

---

# 16. Monitoring

Production monitoring should cover:

```text
CPU
Memory
Disk
Container Health
Application Errors
HTTP Errors
Database Connectivity
AI Availability
Certificate Expiration
```

The goal is to detect failures before they become extended outages.

---

# 17. Logging

Production logs must support troubleshooting without exposing sensitive information.

Never log:

```text
Passwords
JWT Secrets
Refresh Tokens
OTP Values
Stripe Secrets
Brevo API Keys
Private Customer Data
```

---

# 18. Database Migrations

Prisma migrations must be handled deliberately.

Production migration flow:

```text
Release Validation
 ↓
Backup / Recovery Readiness
 ↓
Apply Approved Migration
 ↓
Verify Database
 ↓
Deploy / Verify Application
```

Destructive migrations require additional review.

Database migrations must not be blindly executed every time a container restarts.

---

# 19. Backups and Recovery

The production documentation must maintain a recovery procedure for:

```text
Database
Application Release
Environment Configuration
Deployment
```

Supabase remains the managed PostgreSQL provider.

Application rollback and migration recovery procedures must be documented separately.

---

# 20. Deployment

Production deployment follows:

```text
GitHub
 ↓
GitHub Actions
 ↓
Validation
 ↓
Build
 ↓
DigitalOcean VPS
 ↓
Docker
 ↓
Nginx
 ↓
Health Checks
 ↓
Smoke Tests
```

Only approved releases should reach production.

---

# 21. Rollback

A production release must have a rollback procedure.

```text
Failure Detected
 ↓
Identify Release
 ↓
Rollback Application
 ↓
Verify Health
 ↓
Investigate
```

Database schema changes require additional rollback planning.

---

# 22. Performance

The VPS must be monitored for:

```text
CPU
Memory
Disk
Container Usage
AI Resource Usage
```

AI workloads must not exhaust resources required by the backend and frontend.

Scale the VPS only when measurements demonstrate a need.

---

# 23. Production Readiness

Production readiness requires:

- [ ] Application builds successfully.
- [ ] Docker images build successfully.
- [ ] Containers start successfully.
- [ ] Database connectivity works.
- [ ] Authentication works.
- [ ] Core commerce workflow works.
- [ ] Stripe Test Mode works.
- [ ] Brevo transactional email works.
- [ ] PDF generation works.
- [ ] AI service works.
- [ ] Socket.IO works.
- [ ] Nginx works.
- [ ] HTTPS works.
- [ ] Monitoring is available.
- [ ] Backup/recovery documentation exists.
- [ ] Rollback is documented.
- [ ] Security checks pass.
- [ ] Release checklist is complete.

---

# 24. Production Phase

Production deployment is intentionally deferred until the final project phase.

Earlier phases must remain fully developable and testable without depending on the production VPS.

---

# 25. Definition of Done

Production configuration is complete when:

- The production environment is provisioned.
- All application services run successfully.
- External services are configured securely.
- Nginx and SSL are operational.
- Health checks pass.
- Smoke tests pass.
- Monitoring is available.
- Recovery procedures are documented.
- Rollback is tested or sufficiently verified.
- Release approval is obtained.

---

# 26. Production Principle

> **Production is a controlled environment where application correctness, security, reliability, observability, and recoverability must all be demonstrated before release.**
