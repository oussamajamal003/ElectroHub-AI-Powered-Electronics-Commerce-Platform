# Task 06.3 — Render Free Production Infrastructure & Deployment Preparation

## Objective

Determine and prepare a safe, executable Render Free topology for the complete ElectroHub application while preserving the existing production Supabase database, AI controls, Stripe Test Mode, Brevo, Socket.IO, maps and customer/admin workflows.

Target recurring Render infrastructure cost: **$0/month**.

This task authorizes repository inspection and deployment documentation/preparation only. It does not authorize Render account or resource changes, paid upgrades, a domain, GitHub protection changes, Stripe settings, Supabase mutations, migrations, real email, production deployment or live payments.

## Mandatory milestones

### 06.3.1 — Architecture and Render feasibility

- Confirm the committed application topology.
- Verify current official Render constraints and account eligibility.
- Evaluate static site, combined Node and separate AI deployment options.
- Estimate workspace instance-hour, memory, cold-start and bandwidth consequences.
- Select an evidence-based topology or report that complete $0 deployment is infeasible.

### 06.3.2 — Render deployment configuration

- Prepare static-site and web-service definitions.
- Use exact repository build/start commands.
- Verify Vite output and SPA fallback.
- Verify `PORT`, health checks and graceful shutdown.
- Document whether Express serves the frontend or separate origins are required.

### 06.3.3 — Environment and secrets

- Produce exact frontend, backend and AI environment inventories.
- Update safe `.env.example` files.
- Map runtime variables to Render service settings.
- Map only workflow-required credentials to GitHub Actions.
- Confirm `.env*` ignore and build-context behavior.
- Report exposed local secret-like values for authorized rotation/revocation without printing values or rotating them autonomously.

### 06.3.4 — Supabase readiness

- Identify existing production project and region.
- Inspect Prisma migrations and pending work.
- Verify session/direct pool connection strategy and TLS.
- Inspect pgvector prerequisites and restricted AI roles.
- Verify backup/export readiness.
- Measure candidate Render-region database latency.
- Do not migrate or mutate PROD.

### 06.3.5 — External integrations

- Prepare Stripe Test Mode configuration and hosted webhook plan.
- Prepare Brevo HTTPS API configuration and public origin links.
- Verify Google OAuth callback and WebAuthn origins.
- Verify Socket.IO origins, CORS and reconnect behavior.
- Decide Redis as required or not required; do not add it merely from the old VPS topology.
- Preserve maps and identify the production tile-provider decision.

### 06.3.6 — AI production release

- Verify artifact paths and hashes.
- Record preprocessing, embedding, relevance-gate and compatibility versions.
- Verify production catalog eligibility and image coverage.
- Inspect vector-index prerequisites.
- Produce activation/rollback manifest.
- Keep production index activation blocked until separately approved.

### 06.3.7 — Release and CI

- Use a dedicated branch and approved immutable source SHA.
- Prepare workflow parity for lint, typecheck, tests, builds and AI tests.
- Use deployment credentials only with explicit approval.
- Do not create GitHub Environments, protections or rulesets as part of this task.

### 06.3.8 — Hosted smoke testing

Hosted testing requires explicit deployment authorization. Preserve customer/admin, payments Test Mode, email-safe behavior, storage, Socket.IO, maps and AI smoke coverage.

### 06.3.9 — Performance and capacity

- Measure database/network latency and API p50/p95/p99.
- Measure frontend and AI cold starts.
- Measure recommendations, search and image search.
- Preserve the candidate 3-second Recommended for You threshold where existing evidence supports it.
- Prepare a low-concurrency load-test plan; do not automatically run it against production.
- Do not claim 100-concurrent-user support without measurement.

### 06.3.10 — Security, backup and recovery

- Confirm HTTPS, CORS, cookies, CSRF, authentication, authorization and rate limiting.
- Confirm secrets are not in builds/logs.
- Verify backup/export and application rollback procedures.
- Report provider trust gaps.
- Keep STRICT NO-GO until mandatory gates pass.

### 06.3.11 — GO/NO-GO

Produce an evidence matrix, cost report, remaining blockers, residual risks and one decision: APPROVE for implementation, REQUEST operator authorization, or STRICT NO-GO.

## Acceptance boundaries

- A static frontend URL alone is insufficient.
- A healthy backend does not prove AI, Stripe, email, storage or Supabase readiness.
- A successful hosted deployment is not proof of production readiness.
- Synthetic or test signatures are not cryptographic or provider evidence.
- Free-tier operation is not 24/7 production uptime.

## Required review result

Documentation-only work: verify provider references, repository facts, consistency, operational boundaries and the next-agent prompt. It does not require exhaustive hosted QA unless provider or deployment evidence is claimed.
