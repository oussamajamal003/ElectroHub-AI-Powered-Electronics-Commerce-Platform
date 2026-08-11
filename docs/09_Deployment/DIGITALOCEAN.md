# DigitalOcean

## 1. Purpose

This document defines the planned DigitalOcean production environment for ElectroHub.

DigitalOcean is the selected cloud VPS provider for the production deployment phase.

Production deployment is intentionally deferred until the final project phase.

---

# 2. Production Environment

The planned environment is:

```text
DigitalOcean Cloud VPS
Ubuntu
Docker
Nginx
SSL
GitHub Actions
```

The VPS hosts the application runtime.

Managed external services remain outside the VPS.

---

# 3. High-Level Architecture

```text
                    Internet
                       │
                     HTTPS
                       │
                    Nginx
                       │
          ┌────────────┴────────────┐
          │                         │
      Frontend                   Backend
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                 Prisma          FastAPI         Socket.IO
                    │
             Supabase PostgreSQL
```

External integrations:

```text
Stripe
Brevo
Cloudinary
Supabase
```

---

# 4. VPS Responsibilities

The DigitalOcean VPS is responsible for running:

```text
Frontend Container
Backend Container
AI Service Container
Nginx
Docker Runtime
```

The VPS is not the owner of the managed PostgreSQL database.

---

# 5. Managed Services

ElectroHub uses external services for specific responsibilities.

## Supabase

Responsible for:

```text
PostgreSQL Database
```

Prisma is the application database access layer.

---

## Stripe

Responsible for:

```text
Payment Processing
```

The project uses Stripe Test Mode.

No real customer payments are processed during development and demonstration.

---

## Brevo

Responsible for transactional email:

```text
OTP
Order Confirmation
Payment Confirmation
```

---

## Cloudinary

Responsible for application media storage where configured.

---

# 6. VPS Sizing

The exact DigitalOcean Droplet size should be selected according to measured project requirements.

The initial deployment should prioritize cost efficiency while maintaining sufficient resources for:

```text
Node.js Backend
React Frontend
FastAPI AI Service
Nginx
Docker
```

AI workloads are the primary resource consideration.

The VPS size should be increased only when monitoring or load testing demonstrates a need.

---

# 7. Operating System

The production server uses Ubuntu.

Required server responsibilities include:

```text
Docker
Docker Compose
Nginx
Git
Security Updates
Firewall
Monitoring
```

The operating system must remain patched.

---

# 8. Network Exposure

Only required public ports should be exposed.

Typical public access:

```text
80  → HTTP
443 → HTTPS
```

Internal application ports should not be directly exposed to the public internet unless required.

---

# 9. Firewall

The production server should use a restrictive firewall policy.

Allow only required traffic.

The database, AI service, and backend internal ports should not be publicly reachable when Nginx can act as the public entry point.

---

# 10. Domain and DNS

Production deployment requires a domain configured to point to the DigitalOcean VPS.

Expected flow:

```text
Domain
 ↓
DNS
 ↓
DigitalOcean VPS
 ↓
Nginx
 ↓
Application
```

The exact domain is environment-specific.

---

# 11. Environment Variables

Production secrets must be stored securely.

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

Secrets must never be committed to Git.

---

# 12. Deployment Model

The production application runs through Docker.

Expected deployment flow:

```text
GitHub
 ↓
GitHub Actions
 ↓
Build / Validate
 ↓
Deploy
 ↓
DigitalOcean VPS
 ↓
Docker
 ↓
Nginx
 ↓
Application
```

CI/CD is introduced during the final deployment/release phase.

---

# 13. Deployment Strategy

Deployment should minimize service downtime.

The deployment process should:

1. Validate the release.
2. Build required images.
3. Transfer or pull the release artifacts.
4. Start updated containers.
5. Run health checks.
6. Verify application availability.
7. Retain rollback capability.

---

# 14. Database Migrations

Prisma migrations must be handled deliberately.

Production deployment should:

```text
Backup / Recovery Readiness
 ↓
Deploy Application
 ↓
Apply Approved Migration
 ↓
Verify
```

Destructive database changes require special review.

Never treat production migration execution as an automatic consequence of every container restart.

---

# 15. Monitoring

Production monitoring should cover:

```text
CPU
Memory
Disk
Container Health
Application Errors
HTTP Errors
Database Connectivity
AI Service Availability
```

Monitoring must provide enough evidence to identify major production failures.

---

# 16. Backups and Recovery

Database backup and recovery procedures must be documented.

Supabase is responsible for the managed PostgreSQL infrastructure according to the selected Supabase plan and configuration.

The project should still document:

```text
Recovery Procedure
Migration Recovery
Application Rollback
Configuration Recovery
```

---

# 17. Security

Production security includes:

```text
HTTPS
Firewall
Secure Secrets
SSH Security
Updated Ubuntu
Updated Docker Images
Least-Exposure Networking
Authentication
Authorization
```

The DigitalOcean server must not expose internal services unnecessarily.

---

# 18. Cost Management

DigitalOcean infrastructure is a paid production resource.

The project should:

- Start with an appropriately sized VPS.
- Monitor resource usage.
- Avoid unnecessary infrastructure.
- Scale only when required.
- Stop/remove unused resources when the project is not actively using production infrastructure.

Development should primarily use local environments and managed test services.

---

# 19. Production Phase

DigitalOcean deployment is planned for the final deployment/release phase.

Earlier development phases should not depend on the production VPS.

Development and testing must remain possible without production infrastructure.

---

# 20. Definition of Done

DigitalOcean deployment is complete when:

- VPS is provisioned.
- Ubuntu is configured.
- Docker is installed.
- Required containers run successfully.
- Nginx is configured.
- Domain/DNS is configured.
- SSL is active.
- Firewall rules are reviewed.
- Environment variables are configured securely.
- Database connectivity works.
- External integrations work.
- Monitoring is available.
- Backup/recovery documentation exists.
- Rollback is documented.
- Production verification passes.

---

# 21. DigitalOcean Principle

> **The DigitalOcean VPS is the production compute layer for ElectroHub; managed data and external SaaS responsibilities remain separated from the application server.**
