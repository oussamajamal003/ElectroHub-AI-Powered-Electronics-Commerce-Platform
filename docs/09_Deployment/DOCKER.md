# Docker

## 1. Purpose

This document defines the Docker strategy for ElectroHub.

Docker is used to provide consistent development, testing, and production environments for the monorepo services.

The containerized application consists of:

```text
Frontend
Backend
AI Service
```

Infrastructure services are configured separately where appropriate.

---

# 2. Docker Architecture

```text
                    Docker Environment
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Frontend          Backend         AI Service
          │                │                │
          │                ├──── Prisma ────┼── Supabase PostgreSQL
          │                │
          │                ├──── Stripe
          │                ├──── Brevo
          │                ├──── Cloudinary
          │                └──── Socket.IO
          │
          └────────────── HTTP/API ─────────┘
```

The frontend communicates with the backend through defined APIs.

The backend communicates with the FastAPI AI service through an internal service boundary.

---

# 3. Container Responsibilities

## Frontend

The frontend container is responsible for serving the production React application.

Technology:

```text
React
TypeScript
Vite
SCSS
```

The frontend must not contain database credentials or backend secrets.

---

## Backend

The backend container runs:

```text
Node.js
Express.js
Prisma
```

Responsibilities include:

```text
Authentication
Authorization
Products
Cart
Wishlist
Checkout
Payments
Orders
Inventory
Delivery
Admin
Analytics
AI Integration
Email Integration
PDF Generation
Socket.IO
```

---

## AI Service

The AI service runs:

```text
Python
FastAPI
```

Responsibilities include:

```text
Image Search
Recommendation Processing
AI-specific Processing
```

The AI service must not become the owner of commerce business logic.

---

# 4. Docker Compose

Development may use:

```text
docker-compose.yml
```

The Compose environment should provide a consistent way to start the application services.

Example structure:

```text
services:
  frontend
  backend
  ai-service
```

External managed services such as Supabase PostgreSQL and third-party SaaS services do not need to run inside the Compose environment.

---

# 5. Environment Variables

Secrets must be provided through environment configuration.

Examples:

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

Do not commit production secrets.

Use environment-specific configuration for:

```text
Development
Testing
Production
```

---

# 6. Dockerfile Standards

Each application service should have an appropriate Dockerfile.

Production images should:

- Use a minimal appropriate base image.
- Install only required dependencies.
- Avoid development-only packages where practical.
- Use deterministic dependency installation.
- Run as a non-root user where practical.
- Avoid embedding secrets.
- Expose only the required service port.

---

# 7. Multi-Stage Builds

Production builds should use multi-stage Docker builds where beneficial.

Typical pattern:

```text
Dependencies
 ↓
Build
 ↓
Production Runtime
```

This reduces unnecessary files and dependencies in the final image.

---

# 8. Frontend Container

The production frontend can be built using:

```text
Vite Build
 ↓
Static Assets
 ↓
Production Web Server
```

Nginx is responsible for production HTTP serving/reverse-proxy behavior according to the deployment architecture.

---

# 9. Backend Container

The backend image should contain only the runtime requirements needed to start the Express application.

Prisma generation and required migration/deployment steps must be handled explicitly.

Production database migrations must never be run blindly during every container restart.

---

# 10. AI Service Container

The AI container should:

- Install Python dependencies deterministically.
- Start FastAPI through the configured production server.
- Validate incoming requests.
- Apply request/resource limits.
- Handle AI failures safely.

Large model assets should not be unnecessarily rebuilt into every image unless explicitly required by the chosen AI architecture.

---

# 11. Health Checks

Services should expose appropriate health information where practical.

Examples:

```text
Frontend → HTTP availability
Backend → /health
AI Service → /health
```

Health checks should verify service availability without exposing sensitive information.

---

# 12. Networking

Containers communicate through controlled Docker networking.

Internal services should not be exposed publicly unless required.

Production traffic should normally follow:

```text
Internet
 ↓
Nginx
 ↓
Frontend / Backend
 ↓
Internal Services
```

The AI service should not be directly exposed to the public internet unless an explicit architectural requirement exists.

---

# 13. Volumes

Persistent data should not depend on ephemeral container filesystems.

Managed services such as Supabase PostgreSQL remain external to the application containers.

If local persistent storage is required for development, Docker volumes may be used.

---

# 14. Logging

Application logs should be written in a way compatible with container environments.

Do not log:

```text
Passwords
JWT Secrets
Refresh Tokens
OTP Values
Stripe Secrets
Brevo API Keys
Private Customer Data
```

Logs should provide enough information for debugging without exposing sensitive information.

---

# 15. Resource Management

Containers should have reasonable resource expectations.

The production DigitalOcean VPS is a shared environment for:

```text
Frontend
Backend
AI Service
Nginx
Docker
```

AI workloads must not be allowed to consume all available CPU or memory.

---

# 16. Local Development

Developers should be able to start the required containerized services using the documented Compose workflow.

The local environment must clearly document:

```text
Required Environment Variables
Ports
Service URLs
Database Access
External Test Credentials
```

---

# 17. Testing

Docker configuration must be tested before production deployment.

Verify:

```text
Image Build
Container Startup
Networking
Environment Variables
Health Checks
Backend Connectivity
AI Connectivity
Frontend Connectivity
```

---

# 18. Security

Docker security requirements include:

- No secrets in Dockerfiles.
- No secrets in committed Compose files.
- Minimal exposed ports.
- Non-root runtime where practical.
- Updated base images.
- Dependency scanning.
- Minimal production images.

---

# 19. Production Principle

Docker provides the runtime packaging layer.

Production traffic, SSL termination, and public routing are handled through the deployment architecture involving:

```text
DigitalOcean
Ubuntu
Nginx
SSL
Docker
GitHub Actions
```

---

# 20. Definition of Done

Docker configuration is complete when:

- All required services build successfully.
- Containers start correctly.
- Service communication works.
- Environment configuration is documented.
- Health checks work where configured.
- Production images do not contain secrets.
- Resource expectations are understood.
- CI can build the required images.
- Deployment documentation is synchronized.

---

# 21. Docker Principle

> **Containers provide consistent, reproducible application environments while keeping service boundaries and production responsibilities explicit.**
