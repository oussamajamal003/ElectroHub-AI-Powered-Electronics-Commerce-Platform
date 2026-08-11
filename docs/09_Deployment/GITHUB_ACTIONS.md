# GitHub Actions

## 1. Purpose

This document defines the CI/CD strategy for ElectroHub using GitHub Actions.

GitHub Actions automates project validation, builds, testing, and production deployment workflows.

CI/CD is intentionally introduced during the final deployment/release phase.

Earlier development phases may use local validation without requiring production deployment.

---

# 2. CI/CD Architecture

The planned flow is:

```text
Developer
 ↓
Git Push / Pull Request
 ↓
GitHub Actions
 ↓
Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
Build
 ↓
Release Approval
 ↓
Production Deployment
 ↓
DigitalOcean VPS
```

---

# 3. CI Responsibilities

Continuous Integration verifies that changes do not break the project.

Typical CI checks include:

```text
Dependency Installation
Lint
Type Check
Unit Tests
Integration Tests
Build
```

E2E tests may run in a dedicated CI stage depending on execution time and infrastructure requirements.

---

# 4. Pull Request Validation

Pull requests should trigger automated validation.

The workflow should verify:

```text
Code Quality
Type Safety
Unit Tests
Integration Tests
Build
```

A failed required check should prevent the pull request from being considered ready for merge according to the project workflow.

---

# 5. Branch Strategy

The workflow follows the project's Git branching conventions.

Typical development flow:

```text
Feature Branch
 ↓
Pull Request
 ↓
CI Validation
 ↓
Code Review
 ↓
Merge
```

Production deployment should not be triggered by arbitrary feature branches.

---

# 6. Monorepo Considerations

ElectroHub is a monorepo containing:

```text
apps/frontend
apps/backend
apps/ai-service
```

CI should validate the relevant services affected by a change while maintaining sufficient cross-service validation.

Changes to shared configuration or infrastructure may require broader validation.

---

# 7. Frontend CI

Frontend validation includes:

```text
Dependency Installation
Lint
Type Check
Tests
Production Build
```

The production build must complete successfully before a release can proceed.

---

# 8. Backend CI

Backend validation includes:

```text
Dependency Installation
Lint
Type Check
Unit Tests
Integration Tests
Prisma Validation
Production Build
```

Database-related checks must use a safe test environment.

---

# 9. AI Service CI

AI service validation includes:

```text
Python Dependency Installation
Lint / Formatting Checks where configured
Unit Tests
API Validation
Build / Container Validation
```

AI tests must remain deterministic where practical.

---

# 10. Docker CI

CI should validate the production container build.

Verify:

```text
Frontend Image
Backend Image
AI Service Image
```

Images must build without embedding production secrets.

---

# 11. Secrets

GitHub Actions secrets must be used for sensitive values.

Examples include:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
BREVO_API_KEY
CLOUDINARY_URL
DIGITALOCEAN_SSH_KEY
```

Secrets must not be:

```text
Committed
Printed to Logs
Embedded in Images
Stored in Source Code
```

Only workflows that require a secret should receive access to it.

---

# 12. Environment Separation

CI/CD environments should distinguish:

```text
Test
Staging / Pre-production where used
Production
```

Production secrets must not be used for ordinary pull-request testing.

Stripe Test Mode must be used for development and automated payment verification.

---

# 13. Integration Testing in CI

Integration tests should run using controlled dependencies.

Examples:

```text
Test Database
Stripe Test Mode
Controlled Brevo Test Configuration
Controlled Cloudinary Configuration
FastAPI Test Service
```

External integrations should not accidentally send production emails or process real payments.

---

# 14. E2E Testing in CI

Critical E2E tests should run before production release.

A typical flow is:

```text
Build
 ↓
Start Test Environment
 ↓
Run E2E
 ↓
Collect Results
 ↓
Release Decision
```

Failures must be investigated before production deployment.

---

# 15. Production Build

The production build must verify:

```text
Frontend Build
Backend Build
AI Service Build
Docker Images
```

The build must be reproducible using committed dependency definitions and lockfiles.

---

# 16. Deployment Trigger

Production deployment should occur only from an approved release path.

The final trigger may be:

```text
Approved Release
 ↓
GitHub Actions
 ↓
Production Deployment
```

Do not automatically deploy every feature branch to production.

---

# 17. DigitalOcean Deployment

The production deployment target is:

```text
DigitalOcean VPS
Ubuntu
Docker
Nginx
SSL
```

Deployment should update the application containers while preserving required production configuration.

---

# 18. Deployment Flow

The planned deployment workflow is:

```text
Release
 ↓
CI Validation
 ↓
Build Images
 ↓
Connect to DigitalOcean
 ↓
Deploy
 ↓
Apply Approved Database Migrations
 ↓
Restart / Update Containers
 ↓
Health Checks
 ↓
Smoke Tests
 ↓
Deployment Complete
```

Database migrations must be deliberate and must not be blindly executed on every container restart.

---

# 19. Deployment Security

Production deployment must:

- Use encrypted connections.
- Use protected GitHub secrets.
- Limit SSH access.
- Avoid printing secrets.
- Avoid copying unnecessary credentials to the server.
- Verify the target environment.
- Preserve rollback capability.

---

# 20. Health Checks

After deployment, verify:

```text
Frontend Availability
Backend /health
AI Service Health
Database Connectivity
Socket.IO Connectivity
Nginx
HTTPS
```

A deployment must not be considered successful merely because the containers started.

---

# 21. Smoke Testing

After production deployment, run critical smoke checks:

```text
Open Application
Login
Product Search
Product Details
Cart
Checkout Test Flow where appropriate
Orders
Delivery Tracking
AI Health
```

Payment verification must remain within Stripe Test Mode.

---

# 22. Rollback

A deployment must have a documented rollback strategy.

Conceptually:

```text
Deployment Failure
 ↓
Identify Failed Release
 ↓
Stop / Revert Release
 ↓
Restore Previous Application Version
 ↓
Verify Health
 ↓
Investigate
```

Database migrations require additional rollback planning because not every schema change is safely reversible.

---

# 23. Workflow Files

GitHub Actions workflows belong in:

```text
.github/
└── workflows/
```

Suggested workflow separation:

```text
ci.yml
e2e.yml
docker.yml
deploy.yml
```

The exact number of workflows may be adjusted according to project complexity.

---

# 24. Dependency Caching

Where appropriate, GitHub Actions may cache dependency artifacts to reduce build time.

Caching must not compromise dependency correctness or reproducibility.

---

# 25. Artifacts

CI may retain useful artifacts such as:

```text
Test Reports
Coverage Reports
Build Reports
E2E Screenshots
E2E Videos
Docker Metadata
```

Artifacts must not contain secrets or sensitive customer information.

---

# 26. Failure Notifications

Important CI/CD failures should be visible to the development workflow.

At minimum, developers must be able to identify:

```text
Failed Workflow
Failed Job
Failed Test
Failed Deployment
```

---

# 27. Production Approval

Production deployment should follow the project's release and review process.

The deployment workflow must not bypass:

```text
Testing
Code Review
Security Verification
Release Checklist
```

---

# 28. CI/CD and Final Phase

CI/CD infrastructure is intentionally deferred until the final deployment phase.

Earlier phases should still maintain:

```text
Buildability
Testability
Documentation
```

without requiring the production server.

---

# 29. Definition of Done

GitHub Actions CI/CD is complete when:

- Pull-request validation works.
- Required tests run automatically.
- Builds are reproducible.
- Docker images build successfully.
- Secrets are protected.
- Production deployment is restricted to the approved release path.
- DigitalOcean deployment works.
- Health checks run after deployment.
- Smoke tests run.
- Rollback is documented.
- Deployment evidence is available.

---

# 30. GitHub Actions Principle

> **CI/CD automates verification and controlled delivery; automation must strengthen the release process rather than bypass testing, review, security, or operational safeguards.**
