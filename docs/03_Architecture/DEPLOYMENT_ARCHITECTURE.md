# Deployment Architecture

## 1. Purpose

This document defines the deployment architecture for ElectroHub.

Production deployment is intentionally handled during the final project phase.

The deployment architecture is designed around:

```text
DigitalOcean Cloud VPS
Ubuntu
Docker
Nginx
SSL / HTTPS
GitHub Actions
```

---

## 2. Deployment Goals

The deployment architecture prioritizes:

- Reproducible deployments.
- Container isolation.
- Secure HTTPS access.
- Clear service boundaries.
- Automated validation.
- Controlled production releases.
- Environment separation.
- Easy rollback and recovery.
- Maintainable infrastructure.

---

## 3. Production Architecture

High-level production flow:

```text
Internet
   ↓
HTTPS
   ↓
Nginx
   ↓
DigitalOcean Ubuntu VPS
   ↓
Docker Containers
   ├── Frontend
   ├── Backend
   └── AI Service
        │
        ├── Supabase PostgreSQL
        ├── Stripe
        ├── Brevo
        └── Cloudinary
```

Supabase PostgreSQL remains externally managed rather than running as a database container on the VPS.

---

## 4. DigitalOcean

The initial production infrastructure uses a DigitalOcean Cloud VPS.

The VPS provides:

- Ubuntu Linux.
- Application runtime.
- Docker runtime.
- Nginx.
- SSL termination.
- Network access to external services.

The initial architecture is intentionally simple enough for a portfolio project while retaining clear service boundaries.

---

## 5. Server Model

Initial deployment:

```text
1 DigitalOcean VPS
        ↓
Docker
        ↓
Multiple Application Containers
```

Possible future evolution:

```text
Single VPS
 ↓
Larger VPS
 ↓
Multiple VPS / Dedicated Services
 ↓
Managed / Distributed Infrastructure
```

Infrastructure should only be expanded when actual requirements justify it.

---

## 6. Docker Architecture

Application services are containerized.

Conceptually:

```text
Docker
├── frontend
├── backend
└── ai-service
```

Docker provides:

- Reproducible environments.
- Dependency isolation.
- Consistent runtime behavior.
- Easier deployment.
- Service-level separation.

---

## 7. Docker Compose

Docker Compose may orchestrate the initial multi-service deployment.

Conceptually:

```text
docker-compose.yml

services:
  frontend
  backend
  ai-service
```

The exact production configuration should use production-safe environment handling and should not expose internal services unnecessarily.

---

## 8. Frontend Deployment

The React/Vite frontend is built for production.

Typical flow:

```text
Source Code
 ↓
npm install
 ↓
npm run build
 ↓
Production Assets
 ↓
Web Server / Nginx
```

The frontend should not require development tooling at runtime.

---

## 9. Backend Deployment

The Node.js/Express backend runs as a production container.

```text
Docker Container
 ↓
Node.js
 ↓
Express
 ↓
API
```

Production configuration must:

- Disable development-only behavior.
- Use production environment variables.
- Validate required configuration.
- Expose only required ports.
- Provide health/status behavior where appropriate.

---

## 10. AI Service Deployment

The FastAPI service runs as an independent container.

```text
Docker Container
 ↓
Python
 ↓
FastAPI
```

The backend communicates with the AI service through an internal network where possible.

The AI service should not be directly exposed publicly unless there is a justified requirement.

---

## 11. Nginx

Nginx acts as the production reverse proxy.

Conceptually:

```text
Internet
 ↓
Nginx
 ├── Frontend
 └── Backend API
```

Nginx is responsible for appropriate:

- Reverse proxying.
- HTTPS termination.
- Static asset serving where applicable.
- Request routing.
- Security headers where configured.
- Connection handling.

---

## 12. HTTPS and SSL

Production traffic must use HTTPS.

Conceptually:

```text
Client
 ↓
HTTPS
 ↓
SSL Certificate
 ↓
Nginx
 ↓
Application
```

HTTP should redirect to HTTPS where appropriate.

Certificates must be managed and renewed before expiration.

Private keys must never be committed to Git.

---

## 13. Domain and Routing

A production domain should route through Nginx.

Conceptually:

```text
example.com
     ↓
Nginx
     ├── Frontend
     │
     └── /api → Backend
```

The final domain configuration is environment-specific.

---

## 14. Internal Service Communication

Internal communication should use the Docker network where possible.

```text
Frontend
   ↓
Backend
   ↓
AI Service
```

The AI service should not require a public endpoint for normal backend-to-AI communication.

---

## 15. External Service Communication

The backend communicates with:

```text
Supabase PostgreSQL
Stripe
Brevo
Cloudinary
```

External credentials are supplied through environment variables or deployment secrets.

---

## 16. Environment Architecture

Environments are separated conceptually:

```text
Development
      ↓
Testing / CI
      ↓
Preview
      ↓
Production
```

Each environment may use different:

- Database credentials.
- API keys.
- Stripe configuration.
- Brevo configuration.
- Cloudinary configuration.
- AI service URLs.

Production secrets must never be committed.

---

## 17. Environment Validation

The application should validate required environment variables during startup/build where appropriate.

Examples:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
BREVO_API_KEY
CLOUDINARY credentials
AI_SERVICE_URL
```

Missing critical configuration should fail clearly rather than producing unpredictable runtime behavior.

---

## 18. CI/CD Architecture

GitHub Actions provides automated validation and release workflows.

Typical pipeline:

```text
Pull Request
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
E2E
```

Production release:

```text
Approved Release
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
Health Verification
```

CI/CD implementation is intentionally finalized during the final project phase.

---

## 19. Deployment Workflow

Production deployment should follow:

```text
1. Change implemented
2. Pull request created
3. Code review completed
4. CI checks pass
5. Release approved
6. Production build created
7. Deployment performed
8. Containers updated
9. Health checks verified
10. Production smoke tests executed
11. Release recorded
```

A failed deployment must not be treated as successful merely because the deployment command completed.

---

## 20. Health Checks

Production services should expose or support appropriate health verification.

Conceptually:

```text
Frontend
Backend
AI Service
```

Health checks should verify service availability without exposing sensitive internal information.

---

## 21. Rollback

A deployment strategy must support rollback.

Possible approach:

```text
Current Release
      ↓
New Release
      ↓
Validation
      ↓
Failure
      ↓
Previous Known-Good Release
```

Docker image/version tagging should make it possible to identify the deployed release.

---

## 22. Database Deployment Considerations

Database migrations must be handled carefully.

```text
Application Release
      ↓
Migration Review
      ↓
Migration
      ↓
Application Deployment
```

Destructive migrations require explicit review and a recovery plan.

The application and database schema must remain compatible during deployment.

---

## 23. Secrets Management

Secrets include:

```text
JWT secrets
Database credentials
Stripe keys
Brevo API key
Cloudinary credentials
Deployment credentials
```

Secrets must be stored using:

- GitHub Actions Secrets where appropriate.
- VPS environment configuration.
- Secure deployment secret mechanisms.

Secrets must never be committed to source control.

---

## 24. Security

Production infrastructure should include:

- HTTPS.
- Firewall configuration.
- Restricted exposed ports.
- Secure SSH access.
- Updated operating system packages.
- Non-development application configuration.
- Secure environment variables.
- Nginx security configuration.
- Container isolation.
- Dependency updates.

Only required public services should be exposed.

---

## 25. Logging and Monitoring

Production operations should provide visibility into:

- Nginx errors.
- Backend errors.
- AI-service errors.
- Container status.
- Deployment failures.
- Application health.

Logs must not expose secrets or sensitive user data unnecessarily.

---

## 26. Backup and Recovery

Production data requires a documented recovery strategy.

The database backup strategy is primarily associated with Supabase PostgreSQL.

Operational documentation should define:

- Backup availability.
- Retention.
- Recovery steps.
- Restore verification.
- Responsibility.

Application/container configuration should also be recoverable from Git.

---

## 27. Performance

Deployment performance considerations include:

- Gzip/Brotli where appropriate.
- Static asset caching.
- Optimized frontend builds.
- Nginx configuration.
- Container resource limits where appropriate.
- Database connection management.
- AI-service resource usage.

Performance should be verified through measurement rather than assumptions.

---

## 28. Production Validation

Before release, verify:

```text
Build
Type Check
Lint
Unit Tests
Integration Tests
E2E Tests
Environment Variables
Docker Containers
Nginx
HTTPS
Database Connectivity
Backend Health
AI Service Health
External Integrations
```

Production validation must provide evidence.

---

## 29. Deployment Completion Criteria

The deployment architecture is complete when:

- DigitalOcean infrastructure is defined.
- Ubuntu environment is defined.
- Docker architecture is defined.
- Frontend deployment is defined.
- Backend deployment is defined.
- AI deployment is defined.
- Nginx routing is defined.
- HTTPS/SSL is defined.
- Environment separation is defined.
- Secrets management is defined.
- CI/CD flow is defined.
- Health checks are defined.
- Rollback is defined.
- Database migration considerations are defined.
- Backup/recovery is defined.
- Production validation is defined.

---

## 30. Deployment Principle

> **Deploy reproducibly, expose only what is necessary, keep secrets outside source control, and require evidence-based validation before considering a release successful.**
