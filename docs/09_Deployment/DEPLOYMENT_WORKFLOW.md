# Deployment Workflow

## 1. Purpose

This document defines the standard production deployment workflow for ElectroHub.

The workflow provides a controlled process for moving an approved release from the repository to the DigitalOcean production environment.

Production deployment is intentionally deferred until the final project phase.

---

# 2. Deployment Architecture

```text
Developer
 ↓
Feature Branch
 ↓
Pull Request
 ↓
Code Review
 ↓
CI Validation
 ↓
Approved Release
 ↓
GitHub Actions
 ↓
DigitalOcean VPS
 ↓
Docker
 ↓
Nginx
 ↓
HTTPS
 ↓
Production
```

---

# 3. Deployment Preconditions

A production deployment must not begin until:

- [ ] Feature work is complete.
- [ ] Code review is complete.
- [ ] Required tests pass.
- [ ] Critical E2E tests pass.
- [ ] Security checks pass.
- [ ] Documentation is updated.
- [ ] Release checklist is complete.
- [ ] No unresolved Critical defects exist.
- [ ] Required High-severity defects are resolved or formally accepted.

---

# 4. Release Preparation

Before deployment:

```text
Review Changes
 ↓
Verify Version
 ↓
Update Changelog
 ↓
Verify Documentation
 ↓
Run Release Checklist
```

The release must have a traceable version or commit reference.

---

# 5. CI Validation

GitHub Actions validates the release.

Expected checks:

```text
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
Docker Build
```

Critical E2E tests should be completed before production release.

A failed required check blocks deployment.

---

# 6. Production Configuration

Before deployment, verify:

```text
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
BREVO_API_KEY
SUPABASE_SERVICE_ROLE_KEY
AI_SERVICE_URL
```

Production secrets must be stored securely.

Stripe must remain configured for Test Mode for this project.

---

# 7. Database Migration Preparation

If the release contains database changes:

```text
Review Prisma Migration
 ↓
Verify Compatibility
 ↓
Confirm Recovery Plan
 ↓
Apply Approved Migration
```

Destructive migrations require additional review.

Never rely on an automatic container restart to safely perform arbitrary production schema changes.

---

# 8. Deployment to DigitalOcean

The deployment target is:

```text
DigitalOcean VPS
Ubuntu
Docker
Nginx
SSL
```

The deployment process should:

1. Connect securely to the server.
2. Obtain the approved release.
3. Build or pull the required Docker images.
4. Apply approved database migrations when required.
5. Update application containers.
6. Verify service health.
7. Verify Nginx.
8. Verify HTTPS.

---

# 9. Container Deployment

Expected services:

```text
frontend
backend
ai-service
```

Deployment should ensure that all required containers use the same approved release version.

Avoid deploying partially incompatible service versions.

---

# 10. Nginx Verification

After application deployment:

```text
Validate Nginx Configuration
 ↓
Reload Nginx
 ↓
Verify Routes
 ↓
Verify HTTPS
 ↓
Verify WebSocket / Socket.IO
```

Nginx must not be reloaded with an invalid configuration.

---

# 11. Health Checks

Immediately after deployment, verify:

```text
Frontend
Backend /health
AI Service
Database
Nginx
HTTPS
Socket.IO
```

A successful container startup alone is not sufficient evidence of a successful deployment.

---

# 12. Smoke Tests

Run critical production smoke tests:

```text
Open Application
 ↓
Login
 ↓
Search Product
 ↓
Open Product
 ↓
Add to Cart
 ↓
Checkout Test Flow
 ↓
Create / Verify Order
 ↓
View Order
 ↓
Verify Delivery
```

Also verify:

```text
OTP Email
Order Confirmation Email
Payment Confirmation Email
Invoice PDF
Payment Receipt PDF
```

Payment verification must remain in Stripe Test Mode.

---

# 13. AI Verification

Verify:

```text
AI Service Health
 ↓
Image Search
 ↓
Recommendation Request
 ↓
Backend Validation
 ↓
Expected Response
```

AI failures must not expose internal service details.

---

# 14. Real-Time Verification

Verify:

```text
Admin Delivery Update
 ↓
Backend
 ↓
Socket.IO
 ↓
Authorized Customer
 ↓
Updated Delivery State
```

Ensure that one customer's order updates cannot be delivered to another customer.

---

# 15. Email Verification

Verify Brevo transactional events:

```text
OTP
Order Confirmation
Payment Confirmation
```

Confirm:

- Correct recipient.
- Correct event.
- Correct template/content.
- No sensitive values exposed.
- Failure handling works.

---

# 16. PDF Verification

Verify:

```text
Order
 ↓
Invoice PDF
 ↓
Download
```

and:

```text
Payment
 ↓
Receipt PDF
 ↓
Download
```

Verify authorization for document access.

---

# 17. Deployment Monitoring

After deployment, monitor:

```text
CPU
Memory
Disk
Container Health
HTTP Errors
Application Logs
Database Errors
AI Errors
Nginx Errors
```

The deployment should remain under observation long enough to identify immediate failures.

---

# 18. Failure During Deployment

If deployment fails:

```text
Stop
 ↓
Identify Failure
 ↓
Preserve Logs
 ↓
Do Not Continue Blindly
 ↓
Rollback or Repair
 ↓
Health Verification
```

Do not repeatedly restart containers without understanding the failure.

---

# 19. Rollback Workflow

```text
Failed Release
 ↓
Identify Previous Known-Good Release
 ↓
Restore Application Version
 ↓
Restart Required Containers
 ↓
Verify Database Compatibility
 ↓
Verify Nginx
 ↓
Run Health Checks
 ↓
Run Smoke Tests
 ↓
Confirm Recovery
```

Database migrations require special rollback planning.

---

# 20. Post-Deployment Verification

After successful deployment:

- [ ] Frontend is available.
- [ ] Backend is available.
- [ ] AI service is available.
- [ ] Database connectivity works.
- [ ] Authentication works.
- [ ] Checkout works in Test Mode.
- [ ] Orders work.
- [ ] Emails work.
- [ ] PDFs work.
- [ ] Delivery tracking works.
- [ ] Socket.IO works.
- [ ] Nginx works.
- [ ] HTTPS works.
- [ ] No critical errors are present.

---

# 21. Release Completion

A deployment is complete only after:

```text
Deployment
 ↓
Health Checks
 ↓
Smoke Tests
 ↓
Monitoring
 ↓
Release Confirmation
```

The release should then be recorded in:

```text
CHANGELOG.md
```

and any relevant deployment documentation.

---

# 22. Deployment Evidence

Record evidence such as:

```text
Git Commit / Tag
CI Result
Deployment Result
Health Check Result
Smoke Test Result
Migration Result
Release Version
```

Evidence should be sufficient to reconstruct what was deployed and when.

---

# 23. Security Requirements

Deployment must:

- Use secure connections.
- Protect production secrets.
- Avoid exposing internal ports.
- Validate server identity.
- Avoid logging secrets.
- Use approved release artifacts.
- Preserve rollback capability.

---

# 24. Final Deployment Gate

Production deployment is approved only when:

```text
Requirements
      ↓
Implementation
      ↓
Code Review
      ↓
Automated Tests
      ↓
Security Verification
      ↓
Release Checklist
      ↓
Deployment
      ↓
Health Checks
      ↓
Smoke Tests
      ↓
Release Approval
```

---

# 25. Definition of Done

Deployment workflow is complete when:

- The release can be validated automatically.
- Approved releases can be deployed to DigitalOcean.
- Database migrations are controlled.
- Docker services update consistently.
- Nginx and SSL are verified.
- Health checks run automatically or through documented procedures.
- Smoke tests are performed.
- Rollback is documented.
- Deployment evidence is recorded.
- Production release status is confirmed.

---

# 26. Deployment Principle

> **Every production deployment must be deliberate, observable, reversible, and supported by evidence from automated checks and post-deployment verification.**

## Task 06.3 status

`prod-migration.yml` is manual-only and requires an exact approved SHA on `develop`, an authorization reference and the existing protected environment. It retains the PROD target/checksum/order/additive-SQL and pre/post checks. GitHub Environment reviewer rules remain unverified in repository/account settings. A separate manual-only candidate application workflow exists at `.github/workflows/deploy-production.yml`; it validates exact-SHA checks, creates a checksummed short-lived image bundle, waits for the `electrohub-production-deploy` environment, and invokes a fixed host deployment command. It does not publish to a registry or run migrations. During a separately approved host bootstrap, `install-deploy-command.sh` installs the deployment entrypoint and its fixed root-owned release guard without overwriting differing host files. The host bootstrap must create `/var/lib/electrohub` and its `releases` directory as root-owned, non-writable directories, and create `/var/lib/electrohub/incoming` as an SSH-user-owned, non-group/world-writable directory beneath that root-controlled parent. The guard opens the user-controlled exact-SHA intake by directory/file descriptors without following symlinks, copies the five expected regular files into a private root-owned staging directory, applies the root-managed `PROD_RELEASE_MAX_*` limits, validates the bundle manifest and all file hashes with installed host code before extracting source or invoking release verifiers, and extracts the complete source archive with no-follow exclusive file creation. The example limits are 512 MiB compressed source, 8 GiB image archive, 50,000 source members, 256 MiB per source file and 2 GiB aggregate expanded source; they are safety ceilings for this candidate, not measured bundle sizes or proof of host disk capacity. They may be changed only in the root-managed deployment settings and remain subject to the helper's hard ceilings. The host deployment script still requires an existing healthy release and does not support initial installation. Neither workflow nor host path was run. Hostname/OAuth, browser sessions, TLS, full-stack capacity, PROD backup/restore, Environment protections, Nginx/Compose runtime and immutable base-image digest evidence remain gates. See [single-origin design](TASK_06.3_SINGLE_ORIGIN_VPS_DESIGN.md), [implementation evidence](TASK_06.3_SINGLE_ORIGIN_IMPLEMENTATION_EVIDENCE.md) and [Prompt 2 handoff checklist](TASK_06.3_PROMPT_2_HANDOFF_CHECKLIST.md). This documentation does not authorize a PROD migration or deployment.
