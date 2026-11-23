# DigitalOcean

> **SUPERSEDED:** DigitalOcean is no longer the selected production target. Do not provision a Droplet or App Platform service from this document. The current investigation and replacement are [RENDER_FREE.md](RENDER_FREE.md) and [Task 06.3](TASK_06.3_RENDER_FREE_PRODUCTION_DEPLOYMENT.md). This file remains as historical context only.

## 1. Purpose — Historical

This document previously defined the planned DigitalOcean production environment for ElectroHub.

It is retained to explain prior planning and must not be used to select or provision DigitalOcean infrastructure now.

Production deployment under the current direction is deferred and investigated as Render Free only.

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
Supabase (PostgreSQL + Storage)
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

## Supabase Storage

Responsible for catalog product media storage (`product-media` bucket) with DEV/PROD environment isolation.

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

The earlier deployment design assumed a purchased domain. Task 06.3 does not authorize a domain purchase, so no custom domain is selected or required for the current experiment.

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

The App Platform static candidate can use its provider-generated HTTPS hostname. The API candidate may use an IP-address certificate or a verified free hostname, but neither exact origin nor TLS lifecycle is approved or tested. The API must remain unexposed until HTTPS renewal/reload/recovery and browser-origin/session compatibility pass. See `SSL.md` and `TASK_06.3_IMPLEMENTATION_EVIDENCE.md`.

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
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
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

## Task 06.3 budget and region check (2026-11-17)

DigitalOcean's current public pricing lists up to three free static-site apps, 1 GiB outbound transfer per app, and $0.02/GiB overage; its billing documentation says accrued App Platform transfer allowance/cumulative usage is not currently visible. Therefore a public static site is not guaranteed to remain $0 without an operator usage/overage approval. The current Basic Droplet table lists the $6/month 1 GiB, 1 vCPU, 25 GiB SSD option. See [App Platform pricing](https://www.digitalocean.com/pricing/app-platform), [App Platform bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/), and [Droplet pricing](https://www.digitalocean.com/pricing/droplets).

The repository records Supabase PROD as `ap-northeast-1` (Tokyo), but no live provider query was made in Task 06.3. DigitalOcean currently lists `sgp1` Singapore, `blr1` Bangalore, `sfo3` San Francisco, and `syd1` Sydney as Basic Droplet regions; a single-Droplet experiment must select one only after a consistent network comparison. See [DigitalOcean regional availability](https://docs.digitalocean.com/platform/regional-availability/). Do not provision several paid Droplets to compare regions.
