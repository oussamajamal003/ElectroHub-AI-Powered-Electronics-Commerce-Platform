# Codex Prompt — Task 06.3 Render Free Implementation and Deployment Preparation

## Role

Act as Principal Software Architect and Technical Supervisor for ElectroHub. Inspect the committed repository and implement only repository configuration, tests and documentation needed to prepare and, only with explicit exact authorization, deploy a complete application release on Render Free.

## Hard boundaries

Do not create or change Render resources, add a payment method, enable paid plans/add-ons, buy a domain, change DNS, modify GitHub protections or Environments, create Stripe webhooks, rotate secrets, run migrations, mutate PROD, build/activate a PROD AI index, send real email, run live payments or deploy unless the operator explicitly authorizes each exact action and approval gate.

The target is $0/month Render hosting. Existing external-service costs are outside that target.

## Required start

1. Inspect `git status`, current branch and `git rev-parse HEAD`.
2. Read Task 06.3 documentation and repository architecture.
3. Do not perform a pre-commit audit; the repository work is already committed.
4. Create a dedicated branch for implementation, for example `implementation/06.3-render-free`.
5. Inspect package scripts, Dockerfiles, Prisma migrations, frontend routing, backend startup, FastAPI startup and environment references.

## Investigation

Recheck official Render documentation: Free web services, compute plans, outbound bandwidth, FAQ and pricing. Record the date, current 512 MB/0.1 CPU limits, 750-hour workspace allowance, spin-down behavior, ephemeral filesystem, restart behavior, one-instance limit, bandwidth/build limits, private-network restrictions and SMTP block. Verify actual account eligibility only if the operator has explicitly authorized account inspection.

Do not assume complete Render Free feasibility.

Compare:

- Option A: separate Static Site + Express + FastAPI services.
- Option B: combined backend-hosted frontend + separate FastAPI.
- Option C: combined runtime only if repository supervision and failure isolation support it safely.

Include instance hours, RAM, cold starts, bandwidth, cookie/CORS/OAuth, WebSocket, logs, isolation and complete-feature coverage.

## Implementation scope

Prepare only justified repository changes:

- Render service definitions or a clearly marked Blueprint template.
- Vite build output and static SPA fallback configuration.
- Express public port, bind behavior, health checks and static-serving integration only if proven safe.
- FastAPI port/start configuration and health/readiness paths.
- Safe `.env.example` and secret inventory documentation.
- GitHub Actions release/deployment hooks only if approved by repository policy.
- Deployment, smoke-test, rollback and GO/NO-GO runbooks.

Do not put secrets in source, examples, logs or frontend variables.

## Environment

Derive exact variable names from code. Separate local development, Render runtime and GitHub Actions responsibilities. Confirm Test Mode-only Stripe keys and hosted webhook secrets. Verify Brevo HTTPS API use; do not use SMTP ports. Preserve secure cookies, CORS, OAuth callbacks, WebAuthn origin, Socket.IO origin and trusted email origins.

Report existing secret-like tracked values for rotation as operator-authorized follow-up. Do not print values or rotate credentials automatically.

## Supabase

Preserve existing PROD. Inspect actual identity and region, connection pooling, Prisma migration status, pgvector and restricted roles, backups and latency. Do not apply migrations or change roles/data until an explicit operator approval identifies exact resources and rollback.

## AI

Verify CPU/runtime dependencies, model artifact locations and hashes, preprocessing, relevance gate, vector index compatibility and startup memory. Do not activate a PROD index without operator approval and a verified manifest. Preserve feature behavior; document any exact limitation instead of disabling AI silently.

## Integrations and quality

Prepare and, only with exact authorization, verify Stripe Test Mode checkout and hosted webhook reconciliation, Brevo HTTPS delivery, Supabase Storage, OAuth, Socket.IO, maps, customer/admin flows and all security controls. Preserve 24/7 not promised and 100-user unsupported claims until measured.

Run local risk-based checks: frontend build, backend build/typecheck/tests, AI tests, environment scans, lint, migrations dry inspection and relevant smoke tests. Never weaken tests to obtain a pass.

## Approval gates

Keep preparation and hosted deployment as separate gates:

1. Repository/architecture approval.
2. Render account and resource eligibility approval.
3. Exact paid-action prohibition remains unless separately authorized.
4. Secret configuration approval.
5. Supabase migration/data mutation approval.
6. Stripe hosted webhook approval.
7. Real email/mailbox approval.
8. Production deployment and production migration approval.
9. AI index activation approval.

Stop at each gate unless the exact action is authorized.

## Evidence and final report

Report implementation SHA, changed files, commands/tests, official Render constraints checked, topology decision, $0 feasibility status, hosted verification status, external verifier limitations and STRICT NO-GO blockers. Never claim production ready solely because a service responds or a build passes. Never claim 100-user support, Stripe, email or complete AI functionality without hosted evidence.
