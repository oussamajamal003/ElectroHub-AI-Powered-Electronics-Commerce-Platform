# Task 06.3 Deployment Architecture Audit

**Status:** Architecture discovery and handoff only  
**Audit date:** 2026-11-17  
**Repository:** ElectroHub — AI-Powered Electronics Commerce Platform  
**Audit baseline:** feature/06.3-production-infrastructure at 053a271ba36ebcf436720bdc6aa87c7bb79cf149

## 1. Scope, repository state, and method

Repository root confirmed as:

C:\Users\ouss0\Desktop\Tools\Coding\Portfolio\ElectroHub — AI-Powered Electronics Commerce Platform

- Current branch: feature/06.3-production-infrastructure
- HEAD: 053a271ba36ebcf436720bdc6aa87c7bb79cf149
- Upstream: origin/feature/06.3-production-infrastructure
- Local/upstream commit difference: 0 ahead, 0 behind.
- The required branch exists locally. develop, origin/develop, and the feature branch were at the same HEAD during inspection.
- Task 06.2 merge bed33e28 is an ancestor of current HEAD. Task 06.2 is included in the current base.
- Tracked worktree changes: none.
- Preserved worktree change: untracked docs/tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT.md, the already-prepared Prompt 1. It was read and not edited.
- docs/09_Deployment contains seven Markdown files and no subdirectories or binary assets.
- DEPLOYMENT_ARCHITECTURE.md was located at docs/03_Architecture/DEPLOYMENT_ARCHITECTURE.md and read in full.
- Relevant source, environment templates, Docker files, Compose, workflows, migrations, and linked Operations/AI documents were inspected. This audit did not access production accounts, credentials, databases, cloud resources, or GitHub environment settings. It did not start services, execute migrations, deploy, or run tests.

## 2. Deployment-document inventory

The table records the actual scope in each document. Environment names below are names only; values are omitted. Many docs are design/checklist documents rather than executable runbooks.

| Exact path | Purpose, decisions, services, environment/secrets names | Procedures and dependencies | Currency, issues, Task 06.3 milestones |
|---|---|---|---|
| docs/09_Deployment/DEPLOYMENT_WORKFLOW.md | Release preconditions, CI gate, production configuration, migration preparation, DigitalOcean VPS release, container health, Nginx/HTTPS checks, smoke tests, rollback, evidence. Names include DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BREVO_API_KEY, SUPABASE_SERVICE_ROLE_KEY, AI_SERVICE_URL. | Generic order: review/version/docs, CI, production config, migration review/approval, SSH to VPS, build or pull images, deploy, check services/Nginx/HTTPS, smoke test, monitor, rollback. It says migrations are deliberate and not to be delegated to container restarts. Depends on Docker, DigitalOcean, Nginx, SSL, Production, and Actions docs. No repository-executable release command is defined. | Coherent as a checklist, incomplete as an executable procedure. Assumes VPS/domain-era topology. A broad service-role key is named without process scoping. Affects M0, M2–M7, M9–M11. |
| docs/09_Deployment/DIGITALOCEAN.md | Selects DigitalOcean VPS/Ubuntu/Docker/Nginx/SSL; VPS hosts app, Supabase/Postgres and Storage, Stripe, and Brevo remain external. Includes VPS duties, sizing, firewall, SSH, backups, cost. Names: AI_SERVICE_URL, BREVO_API_KEY, DATABASE_URL, JWT_REFRESH_SECRET, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. | Describes provisioning, firewall, SSH deployment, migration, monitoring, backup/recovery, and removal/cost review. Depends on Docker, Production, Nginx, SSL, Workflow, and Operations backup docs. No provisioning automation or exact verified plan is included. | Explicitly says production deployment requires a domain (section “10. Domain and DNS”). That conflicts with no-purchase scope and remains unresolved in implementation. A VPS and domain are assumed; free static hosting is not described. Affects M1–M5, M9, M11. |
| docs/09_Deployment/DOCKER.md | Describes frontend, Express backend, AI container, Compose, env, images, health, private networking, volumes, logs, and resource limits. Names: AI_SERVICE_URL, BREVO_API_KEY, DATABASE_URL, JWT_REFRESH_SECRET, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. | Conceptual image and Compose standards; says TLS/public routing are handled elsewhere. Depends on Dockerfiles, Compose, Nginx/SSL, environment docs. It does not define a production Compose file or exact production command. | Broadly aligned on service separation but not proof of present production readiness. It predates implemented process-specific email/payment/media worker boundaries and does not resolve their deployment profiles. Affects M0, M2–M7, M9. |
| docs/09_Deployment/GITHUB_ACTIONS.md | Describes CI, PR checks, branch strategy, monorepo checks, secrets/environment separation, Docker build, production deploy, approvals and rollback. Names: BREVO_API_KEY, DATABASE_URL, DIGITALOCEAN_SSH_KEY, JWT_REFRESH_SECRET, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. | Describes test/build/deploy and protected migration flow, but does not itself implement deployment. Depends on .github/workflows and release docs. | Its opening Task 06.2 note describes then-current CI/migration state but says infrastructure deployment is reserved for Task 06.4. Current Task 06.3 Prompt 1 includes infrastructure and deployment work, so this line is stale relative to task scope and should be reconciled. Actual workflows differ from older generic examples. Affects M0, M2, M5, M7, M8–M11. |
| docs/09_Deployment/NGINX.md | Defines conceptual internet → Nginx → frontend/API/AI traffic, TLS, reverse proxy, Socket.IO, SPA/API routes, headers, limits, caching, logs and health. No secret names. | Describes API and websocket proxying and verification/reload. Depends on Docker, Production, SSL, Workflow. | It is not the Nginx config shipped in the frontend image. No deployed reverse-proxy configuration was found. It assumes a domain/TLS topology. Affects M1–M4, M9–M10. |
| docs/09_Deployment/PRODUCTION.md | Production stack: React, Express/Prisma, FastAPI, external Supabase PostgreSQL/Storage, Stripe Test Mode, Brevo; runtime responsibilities, migrations, security, monitoring, backups and release. Names: AI_SERVICE_URL, BREVO_API_KEY, DATABASE_URL, JWT_REFRESH_SECRET, JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. | Generic production readiness, migration, backup, deployment, rollback and smoke-test checklists. Depends on every other deployment document and Operations runbooks. | Consistent with high-level VPS architecture, but lacks actual topology artifacts, region, secrets delivery, cost controls, exact process allocation and browser-origin strategy. Affects M0–M11. |
| docs/09_Deployment/SSL.md | Requires HTTPS with Nginx TLS termination, domain certificate, renewal, monitoring, recovery, secure websockets/cookies and no committed private keys. | Describes issue/install/validate/renew/monitor, reload and recovery. Depends on Nginx, DigitalOcean, Production. | Security principles remain valid; “production domain” and certificate flow are domain-based and no provider/IP-certificate automation is implemented. Affects M1, M4, M9–M11. |

### Related source-of-truth documents consulted

- docs/03_Architecture/DEPLOYMENT_ARCHITECTURE.md — primary high-level deployment architecture.
- docs/10_Operations/ENVIRONMENT_VARIABLES.md and BACKUP_RECOVERY.md — environment and recovery conventions.
- docs/10_Operations/COMMERCE_EMAIL_RUNBOOK.md and PRODUCT_MEDIA_RUNBOOK.md — worker activation, leases and safety.
- docs/07_AI/RECOMMENDER.md, current AI runtime/configuration, and Task 04.3/04.4 implementation artifacts — current model/vector lineage.
- .github/workflows/ci.yml, prod-migration.yml, dev-migration.yml, verify-migration.yml, security.yml — actual workflow implementation.
- apps/backend/prisma/schema.prisma and relevant migrations — database and vector/worker roles.

## 3. Complete summary of DEPLOYMENT_ARCHITECTURE.md

Source: docs/03_Architecture/DEPLOYMENT_ARCHITECTURE.md, sections 1–30.

Section map:

- Sections 1–5 establish the purpose, deployment goals, production topology, DigitalOcean target, and VPS server model.
- Sections 6–10 describe container separation, Compose orchestration, frontend build/deploy, Express backend, and internal FastAPI deployment.
- Sections 11–15 assign Nginx routing/TLS responsibilities, require HTTPS and a production domain, and distinguish private service-to-service communication from external Supabase, Stripe, Brevo and Storage integrations.
- Sections 16–20 define environment separation/validation, CI/CD and release flow, deployment procedure, and health/readiness checks.
- Sections 21–25 cover application rollback, deliberate database migration, secrets, security hardening, logging and monitoring.
- Sections 26–30 cover backup/recovery, performance, production validation, completion criteria, and the principle that production deployment must be secure, repeatable and observable.

The document’s intended production model is one DigitalOcean Ubuntu VPS running Dockerized application services. Nginx is the public reverse proxy and TLS termination point. React/Vite, Express/Prisma, and FastAPI are distinct containers; internal services communicate on a private Docker network. Supabase PostgreSQL and Storage, Stripe, and Brevo are external services. The document assumes a production domain, HTTPS, environment-specific hostnames, and secret injection from environment/GitHub rather than source control.

The remainder establishes the operating model: validate environment variables at startup; keep DEV/PROD isolated; run CI checks and production approval before deployment; deploy a consistent release; expose health checks; roll back application releases; review and apply database migrations deliberately; keep secrets out of Git; harden networking and headers; log/monitor; document backup/recovery; and verify performance and production readiness before completion. It does not specify a concrete production Compose/Nginx/TLS artifact, DNS/TLS provider, VPS size, region, real command sequence, or current CI workflow implementation.

It is internally coherent as a conceptual single-VPS architecture. It is not a ready-to-run deployment specification. Task 06.3 changes hosting and budget assumptions: add a free static frontend candidate, avoid domain purchase, make a $6 VPS optional and approval-gated, and require production DB/AI/worker evidence. These changes need reconciliation rather than silently treating the old one-VPS/domain design as already implemented.

## 4. Actual implementation and intended topology

### Frontend and public browser behavior

- The root npm workspace includes apps/frontend and apps/backend; package-lock.json is at repository root. The React/Vite app builds a dist directory. apps/frontend/vite.config.ts uses Vite’s default root asset base and has no App Platform deploy spec. index.html references browser icons/manifest and root-relative assets.
- The application uses client-side routes for customer and admin experiences. Deep-link refresh needs the static host to fall back to index.html.
- apps/frontend/src/lib/api.ts normalizes requests as root-relative /api paths (around lines 186–221). apps/frontend/src/features/delivery/realtime/deliverySocket.ts:13 connects with relative /delivery and /socket.io paths. A source search found no runtime consumer of VITE_API_URL; that variable is present in apps/frontend/.env.example:10 and local Compose only. Setting it in App Platform alone does not configure API traffic.
- apps/frontend/nginx.conf:1–18 listens on HTTP port 80; it has SPA fallback and the right broad cache distinction (hashed /assets/ immutable, root/index no-cache). It contains no API or Socket.IO reverse proxy, TLS, or certificate lifecycle.
- The frontend Dockerfile expects repository-root build context and produces a static Nginx image. The free App Platform static service is a plausible alternate host because it can build a monorepo from source directory /. Candidate command is npm ci && npm run build --workspace=@electrohub/frontend, with output apps/frontend/dist and index.html as catchall. This is a candidate only: it was not built or deployed in this audit.

### Backend, auth, and health

- Express production startup is selected by apps/backend/src/bootstrap.ts; the server is apps/backend/src/server.ts. API binds port 5000. Health routes are in apps/backend/src/routes/health.routes.ts (/api/health, /api/health/ready, /api/ready) and payment health in /api/health/payments. Readiness verifies database access. Startup can serve liveness while database readiness retries.
- apps/backend/src/app.ts:34 trusts one proxy hop. CORS is configured around the exact FRONTEND_URL with credentials. That is compatible only if the actual proxy chain and browser origin are configured and verified.
- Refresh cookies in apps/backend/src/controllers/auth.controller.ts:49 are HttpOnly, Secure in production, and SameSite=Lax. Account-deletion cookies use Strict. The frontend and API are currently same-origin coded. Moving the frontend to *.ondigitalocean.app while API is a separate IP/dynamic-DNS host creates a cross-origin and potentially cross-site topology. A CORS allowlist is not a substitute for cookie compatibility. Authentication and refresh must be tested in target browsers before the API is exposed; if cookie policy/CSRF changes are needed, that is a security architecture decision, not merely setting an environment variable.
- apps/backend/src/config/env.ts validates production configuration. It requires database URLs and server-side integrations including JWT/OTP, Brevo and Stripe configuration, and rejects seed provisioning in production. Do not put these secrets in the frontend.
- There is no application migration on container start. The backend image CMD starts bootstrap, and bootstrap.ts chooses API or an explicitly requested worker role.

### Database, Prisma, Supabase and assets

- apps/backend/prisma/schema.prisma uses DATABASE_URL and DIRECT_URL. Runtime code in apps/backend/src/lib/prisma.ts resolves configured runtime URL source, applies a bounded Prisma pool, uses TLS certificate verification, and optionally loads DB_SSL_CA_CERT_PATH. DB_RUNTIME_URL_SOURCE affects runtime routing. Pool/session limits must be budgeted across the API and each worker process.
- Production and migration workflows use separate named database secrets, but actual credentials, grants, Supabase plan, pooler mode, schema state and project configuration were not accessed. A configured URL is not proof that runtime and migration roles are least-privileged.
- Migrations include the private AI schema and pgvector extension with 256-dimensional vectors, and restricted ai_vector_reader, ai_vector_ingest, and media-worker role boundaries. These are local migration definitions only; their presence does not prove they have been applied to PROD or that PROD roles/extension/grants are correct.
- The actual PROD project region is not established by checked-in deployment docs. A DEV example or host value is not evidence of PROD region. Backup/PITR and restore readiness are also unverified. Do not copy DEV database rows, admin accounts, or vectors into PROD. If product images are reused, copy and verify approved objects into PROD Storage where required through the existing media process.

### AI service and model release

- apps/ai-service is FastAPI/Python 3.11 in a CPU-only image with pinned runtime dependencies, non-root execution, health probe, and one inference worker. Model artifacts are mounted read-only and are not included in the Docker image or Git. AI_MODEL_ARTIFACT_DIR, AI API key, vector-reader URL, and media-worker database/storage settings are distinct config fields.
- The code contains distinct api and media_worker roles. FastAPI can require an API credential when bound beyond loopback; Express holds that credential and is the commerce boundary. AI errors are intended to be non-fatal to ordinary commerce.
- Current repository evidence supports the later D3 SigLIP2 path as well as legacy EfficientNet artifacts. Task 06.3’s D3 SigLIP2 description is compatible with later AI implementation; it must require an exact artifact manifest/checksum and preprocessing identity. PROD vectors must be built against actual PROD product IDs/catalog data. No artifact or vector set is a checked-in production release, and neither PROD model nor index was verified here.

### Background and scheduled work

The repository has more process roles than the conceptual three-service deployment diagrams:

- The API process runs real-time Socket.IO and several lifecycle loops/recovery tasks.
- apps/backend/src/bootstrap.ts can start a dedicated payment worker with --payment-worker or a dedicated commerce-email worker with --commerce-email-worker.
- The payment runner has payment-specific leases, recovery and safety gates. Stripe must remain Test Mode; shared mutation is guarded by explicit target authorization.
- The commerce-email runner has separate leases/provider pause, bounded batch/concurrency, no PaymentWork access, health/heartbeat and graceful claim shutdown. It also owns the separately gated push dispatcher; push delivery is not Socket.IO delivery.
- apps/ai-service/app/media_sync.py runs a distinct media worker role with restricted DB access, bounded leased claims, heartbeat, read-only model artifacts, startup permission validation and SIGTERM drain.
- Root Compose includes only the commerce-email worker. Payment and media worker services are absent, and any worker remains inert or unavailable depending on explicit authorization/configuration. Do not add a generic worker or bypass process gates. Prompt 1 needs a process inventory, worker-specific deployment profile, shutdown/lease behavior, health/monitoring and DB connection budget for every enabled role.

## 5. Docker, Compose, Nginx and source-control implementation

### Existing Dockerfiles and Compose

- apps/frontend/Dockerfile and apps/backend/Dockerfile copy the root package.json/lockfile and use monorepo workspace paths. They require repository-root build context.
- Root .github/workflows/ci.yml builds these Dockerfiles with repository root as context.
- docker-compose.yml instead sets frontend context to ./apps/frontend and backend/worker context to ./apps/backend. Those contexts do not contain the root lockfile/workspace layout the Dockerfiles copy. Static inspection therefore shows a build-context mismatch; Compose builds were not run to avoid turning this audit into implementation/testing.
- Compose maps frontend host port 3000 to container port 3000, while the frontend image’s Nginx listens on 80. Backend is published on 5000 and FastAPI on 8000; neither is private in this Compose file. Frontend config is local localhost API. Compose has no TLS, no production Nginx, no production network/secret profile, and no readiness healthchecks. The database target is supplied from a local backend env file.
- Compose is development-oriented and is not production-ready. It has a commerce-email worker with an explicit dispatch gate. It is not evidence that the complete production process set is deployed.
- No production Compose file, deployment shell/PowerShell automation, certificate renew/reload/alert service, production Nginx config, or App Platform spec was found.
- Root .dockerignore excludes env files and build/test outputs and is suitable for root-context frontend/backend builds. apps/ai-service/.dockerignore excludes model/training/env artifacts. Separate frontend/backend .dockerignore files are absent; if build context changes from root, secret/context exclusions must be reconsidered. .gitignore ignores .env and .env.* while explicitly keeping .env.example files tracked.

### CI/CD and migrations

- Current CI validates multiple branch patterns, tests/builds frontend/backend/AI, checks security and migration replay, and builds/smoke-checks Docker images. It is not a production application deployment workflow.
- Workflows present: ci.yml, security.yml, verify-migration.yml, dev-migration.yml, and prod-migration.yml. No app deployment workflow exists.
- prod-migration.yml is triggered after successful Development CI on a push to develop, checks branch/repository/SHA, uses the electrohub-prod-database GitHub Environment and serialized concurrency, then uses separate PROD DB secrets and invokes prisma migrate deploy after preflight/plan checks. This is a real production mutation path. The repository claims a protected environment, but required reviewers/branch restrictions are GitHub settings not visible in this audit. Verify those settings without running the workflow before any production database mutation.
- No secret values were read. Secrets belong only in protected backend/worker or GitHub environment scopes; Vite VITE_* variables are public build-time values. Never pass credentials through build args, image layers, frontend bundles, or logs.
- The current docs/09_Deployment/GITHUB_ACTIONS.md statement reserving infrastructure deployment for 06.4 needs documentation reconciliation because this Prompt 1 assigns infrastructure/deployment to 06.3. Keep the 06.4 handoff boundary explicit.

## 6. DigitalOcean free frontend and optional VPS feasibility

### Free static site

Current DigitalOcean documentation says the free App Platform tier covers static-site components only; it permits up to three static-only apps and includes 1 GiB outbound per app. Additional outbound is $0.02/GiB; transfer is pooled at team level, and accrued allowance/cumulative App Platform usage is not currently exposed in the control panel. Therefore “free” does not establish a hard zero-bill cap. ([App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/)). Check current account slot and pricing before resource creation; require the user to accept any unbounded overage exposure under the $0 budget.

The repository is an npm workspace with root lockfile and can in principle use a monorepo root build. DigitalOcean’s [monorepo guide](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-monorepo/) recommends source directory / when root files are required, with commands changing into the workspace as needed. For this repository, validate the candidate build command and output locally/CI and configure the SPA catchall. App Platform’s static frontend is global CDN-served and has no selectable region. It does not automatically forward API traffic to an external Droplet. Platform rewrites route only to components in the same App Platform app; redirect rules change the browser URL and are not a transparent reverse proxy ([rewrite documentation](https://docs.digitalocean.com/products/app-platform/how-to/url-rewrites/)). A static-only free app therefore does not supply the API gateway expected by current relative /api and Socket.IO clients.

### $6 Droplet

The current advertised Basic plan is 1 shared vCPU, 1 GiB RAM and 25 GiB SSD for $6/month ([Droplet pricing](https://www.digitalocean.com/pricing/droplets)). It is an optional one-month experiment, never created during repository-only prep. CPU-only Python, PyTorch/model inference, Node, Nginx, API loops and all authorized workers compete for 1 GiB. There is no measured full-stack image/model footprint, startup peak, load, OOM behavior, or connection budget. This is a constrained experiment, not evidence that the complete platform fits. Keep all required features or stop and report measured limits; do not silently omit services or raise the plan.

A powered-off Droplet remains billable. Destruction ends compute billing but does not automatically remove every separately billable item: retained backups persist to their retention deletion date, and snapshots/volumes/volume snapshots not selected for deletion remain ([power-off billing](https://docs.digitalocean.com/reference/doctl/reference/compute/droplet-action/power-off/), [destroy behavior](https://docs.digitalocean.com/products/droplets/how-to/destroy/)). Closeout must preserve approved evidence and required recovery material, destroy the Droplet if there is no extension approval, and verify resource and backup cleanup in the account. Do not enable paid backups/add-ons without approval.

## 7. API HTTPS, hostname, and customer/admin origin compatibility

The frontend provider hostname has managed HTTPS. No API hostname or certificate solution currently exists in the repository. Old DIGITALOCEAN.md, NGINX.md and SSL.md assume a purchased domain; the current task disallows buying one.

A no-domain IP certificate is technically possible now: Let’s Encrypt IP certificates are generally available but use a short-lived profile of about 160 hours. Current Certbot support requires version 5.4+ for IP issuance; its Nginx plugin does not yet support IP certificate installation, so a webroot/manual challenge path, certificate file integration/deploy hook, automated renewal, Nginx reload, monitoring, alert, and recovery must be built and proven ([Let’s Encrypt IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability), [Certbot IP/deploy-hook guidance](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)). This is an investigated candidate, not an implementation or verified production solution. A free hostname plus normal certificate is another candidate, but no exact provider/renewal method has been selected or verified. Do not expose API on plain HTTP.

There is a separate origin/authentication gate beyond TLS:

1. Existing API requests and Socket.IO use relative same-origin paths.
2. VITE_API_URL is not consumed by frontend source.
3. API CORS uses FRONTEND_URL and credentials.
4. Refresh cookies use SameSite=Lax.
5. The App Platform hostname does not proxy the external API.

Prompt 1 must explicitly choose and validate a browser-compatible topology before setting frontend API URLs or deploying customer/admin sign-in. It must test customer and admin login, refresh, logout, credentialed API calls, Socket.IO connect/reconnect, CORS, cookie send/clear, deep route reload, and failure handling in the actual target browser(s). If cross-site cookie/CSRF changes or a different hosting topology is needed, stop for a reviewed architecture decision. HTTPS alone does not satisfy this gate.

## 8. Supabase PROD, region, backup, and latency plan

**Supabase PROD region: NOT VERIFIED.** This audit did not access PROD. Checked-in deployment documentation does not provide a verified region; a DEV example must not be used as proxy evidence.

Recommended evidence sequence for Prompt 1:

1. Using operator-authorized read-only access, verify actual PROD project identity and region from Supabase project configuration; record evidence without copying secrets.
2. Enumerate currently available plausible DigitalOcean Droplet regions from provider documentation ([regional availability](https://docs.digitalocean.com/platform/regional-availability/)). Evaluate Singapore first, then only other plausible regions (for example Bangalore, Frankfurt, Amsterdam, London) using one consistent measurement method and timestamp.
3. Do not claim candidate-region DB latency without an actual probe path. Before provisioning, use existing public/third-party measurement nodes or clearly label network estimates as provisional; do not create multiple paid Droplets. Record DNS, TCP, TLS, and where authorized a safe database round trip with p50/p95, min/max, count, failure rate, TLS verification state, and sample window.
4. Once a single Droplet is explicitly approved, measure from that host to the verified Supabase endpoint, including repeated SELECT 1 and a representative read-only query; record pooler/direct endpoint and pool limits across all processes.
5. Do not move the database, change plan/pooler/TLS/roles, or modify production connection settings based on latency results without separate approval.

The presence of migration files or DATABASE_URL does not prove PROD readiness. Verify PROD project ref, role grants, TLS, connection mode, pgvector schema/extension, applied migration state, Storage buckets/assets, backup scope/retention/PITR and an approved restore procedure before any production mutation. Existing PROD remains authoritative. Use distinct runtime, migration, AI reader, AI ingest and media-worker logins/permissions as current schema/runbooks intend. No PROD mutation or DEV row/vector/admin copying is authorized.

## 9. External services and cost/security boundaries

- Stripe: Test Mode only; no live keys or real charges. Server state/webhook verification remain authoritative.
- Brevo: credentials server-side only. Transactional links must use actual public HTTPS origins.
- Push: delivery is a separate provider/worker path, not Socket.IO. Keep existing exact authorization, leases, send-mode and recipient gates.
- Maps: frontend .env.example currently includes OpenStreetMap raster tiles and attribution but explicitly says a production provider decision is pending. Task 06.3 must decide terms, attribution, quota and cost before production tile traffic; do not treat the public development endpoint as an unlimited production dependency.
- Storage: use Supabase Storage PROD. Reuse approved product image assets only after copying/verifying in PROD where required. Keep media worker scope/lease/auth checks.
- Secrets: local .env/.env.local are ignored, .env.example templates are safe/tracked. Keep all secrets out of Git, client bundles, Docker layers, app build args and CI logs. Scope them to the exact backend/worker/CI job that needs them.
- Admin/customer UX: retain distinct customer/admin auth scopes, no public admin registration, no role selector, and no default credentials. Any one-time production administrator bootstrap must be operator-authorized, narrowly available, auditable, and not a customer-accessible registration path. Preserve deep-link fallback, secure cookies, loading/error behavior, and ordinary commerce availability during AI outage.

## 10. Existing verification tools and evidence limits

Repository tools include npm workspace scripts for frontend/backend builds, type checks, lint and tests; Vitest/React Testing Library suites; Playwright browser tests and visual scripts; Python pytest, Ruff and mypy; migration replay against disposable PostgreSQL; CI Docker build/smoke checks; and payment/worker guarded integration tools. These were inspected as available workflow/configuration, not run for this audit. No application service was started, no visual comparison was captured, no Docker build was executed, and no test result is claimed.

Evidence used for current provider constraints was checked on 2026-11-17:

- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)
- [DigitalOcean monorepo build guidance](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-monorepo/)
- [Static-site configuration and output/catchall docs](https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/)
- [App Platform rewrite scope](https://docs.digitalocean.com/products/app-platform/how-to/url-rewrites/)
- [DigitalOcean bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/)
- [Current Droplet pricing](https://www.digitalocean.com/pricing/droplets)
- [DigitalOcean regions](https://docs.digitalocean.com/platform/regional-availability/)
- [Droplet power-off billing](https://docs.digitalocean.com/reference/doctl/reference/compute/droplet-action/power-off/)
- [Droplet destroy and retained-resource behavior](https://docs.digitalocean.com/products/droplets/how-to/destroy/)
- [Let’s Encrypt IP/short-lived certificate availability](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Certbot IP issuance and deploy-hook limitation](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)

## 11. Reconciliation matrix

| Topic | Existing documented decision | Actual implementation | Task 06.3 requirement | Finding |
|---|---|---|---|---|
| Overall topology | Single DO VPS hosts frontend, API, AI, Nginx; managed services external. | Frontend/API/AI Dockerfiles exist; no production Compose/deploy topology. Free static frontend is not represented in old docs. | $0 static frontend first; optional one-month $6 VPS. | **HIGH / CONFLICT** — architecture must be reconciled with budget and split hosting. |
| Static-site build | Old docs deploy frontend container to VPS. | Root workspace/lockfile and Vite dist can support root-context build; not built here. | Free App Platform static site if actual build succeeds. | **MEDIUM / ALIGNED IN PRINCIPLE, UNVERIFIED** — candidate root build/output/catchall require validation. |
| API URL and browser sessions | Docs assume Nginx same-origin routing. | API and Socket.IO are relative; VITE_API_URL is sample-only; refresh cookie is Lax; exact CORS origin. | Static frontend + separate API hostname over HTTPS. | **HIGH / GAP + RISK** — no compatible production origin is implemented or proven; auth can fail even if TLS works. |
| App Platform API proxy | Concept docs place Nginx in front of services. | No API gateway in static app; App Platform rewrites cannot route to external domains. | No paid component/domain, but API must be browser-accessible. | **HIGH / GAP** — target needs an explicit compatible topology; no transparent proxy is provided. |
| Domain and HTTPS | DIGITALOCEAN.md, NGINX.md, SSL.md assume production domain. | No production TLS Nginx or certificate automation. | No domain purchase; never serve API over HTTP. | **HIGH / CONFLICT** — hostname/certificate remains an approval-gated stop/go decision. |
| IP certificate route | Domain certificate lifecycle described conceptually. | No ACME client/hooks/renewal/reload monitoring. | Evaluate free hostname or short-lived IP cert. | **HIGH / RISK, UNVERIFIED** — IP cert is possible, but six-day rotation and Nginx integration are not implemented/proven. |
| Compose build context | Docs describe Compose generically. | Compose uses app subdirectory contexts; Dockerfiles require repository root; frontend port mapping also mismatches Nginx port. | Production configuration must be buildable and tested. | **MEDIUM / GAP** — current Compose is not a valid production profile and likely cannot build as written; no build was run. |
| Production Nginx/ports | Nginx docs specify public proxy/TLS/socket. | Shipped Nginx is static-only port 80; Compose publishes backend and AI ports. | Only HTTPS Nginx public; API/AI/workers private. | **HIGH / GAP** — no production proxy/network configuration exists. |
| CI deployment | Docs describe SSH deploy generally and reserve infrastructure for 06.4. | CI/test/security/migration workflows exist; app deployment workflow absent. | Task 06.3 owns reviewed deployment preparation and deployment scope in its prepared prompt. | **HIGH / CONFLICT** — update stale scope note and add only the approved deployment mechanism. |
| PROD migration authorization | Docs require approval and deliberate migration. | Workflow runs after successful develop push and uses protected GitHub Environment; actual reviewer rules unknown. | No unapproved production mutation. | **HIGH / UNVERIFIED** — inspect environment protections read-only before permitting any workflow run. |
| PROD region/roles/network | Docs treat Supabase as external/authoritative. | URLs/config code and migration role definitions exist; no live PROD evidence. | Verify actual region, least privilege, TLS, pool strategy, migration path. | **HIGH / UNVERIFIED** — no PROD read/validation performed. |
| Backups/recovery | Docs prescribe backup and restore checklists. | Operations runbook exists; actual account backup/PITR/restore state not verified. | Evidence and recovery readiness before migration/destruction. | **HIGH / UNVERIFIED** — do not call backups ready based on docs. |
| AI artifact/index | Docs say AI is a separate service. | CPU API, read-only artifact mounting, role separation and 256-D vectors exist. No PROD artifact/index proof. | Exact approved artifact/preprocessing; build vectors from PROD catalog IDs. | **HIGH / UNVERIFIED** — release is feasible in design but not ready/validated in PROD. |
| Worker topology | Docs mainly depict frontend/API/AI. | Payment, email/push and media-worker processes have separate safeguards; Compose includes only email worker. | Preserve auth, lease, health, shutdown and ownership mechanisms. | **HIGH / GAP** — enumerate/select authorized worker profiles without bypassing safeguards. |
| VPS capacity | Docs lack measured small-plan capacity. | CPU-only AI and workers can run; no 1-GiB full-stack load evidence. | At most one $6 Droplet with measured full capability. | **HIGH / RISK** — do not promise full service on 1 GiB before measurement. |
| Static-site cost | Old docs have generic cost section. | No DO account/billing state inspected. | Start at $0. | **MEDIUM / RISK** — free tier includes 1 GiB outbound/app; overage is billable and not hard-capped. |
| Map tiles | Old docs say external map capability. | OSM tile URL/attribution example; production decision pending in env template. | Explicit provider terms, attribution, quota, cost. | **MEDIUM / GAP** — must decide before production use. |
| Secret scope | Docs say secure env/GitHub secrets. | Root .dockerignore and .gitignore exclude local env; app Docker contexts complicate ignore behavior; Vite vars public. | No secrets in Git, bundles, layers or CI logs. | **MEDIUM / PARTIALLY ALIGNED** — preserve root build context/ignore rules and scope secrets by process. |
| Stripe/email/admin | Docs require Stripe Test Mode, server secrets, secure admin. | Existing payment/email authorization and distinct admin flows are guarded. | Test Mode only, real HTTPS links, no public admin registration/default credentials. | **ALIGNED IN DESIGN** — maintain existing controls and verify target deployment behavior. |

## 12. Decisions and approval gates

### Confirmed constraints and repository evidence

- Existing service boundaries remain Express/Prisma as commerce/security boundary, private FastAPI, external Supabase PROD, Stripe Test Mode, server-only Brevo secrets, distinct authorized workers.
- The current frontend is same-origin coded. VITE_API_URL is not currently an API switch.
- No production Compose/Nginx/deployment workflow is present.
- Task 06.2 is in the base, and the authorized branch is already checked out and synced.
- Current code/migrations contain model/vector/worker safety controls that must be preserved.

### Repository-only work that can be implemented in Prompt 1 without a cloud purchase

- Add and validate repository deployment configuration, root-context production Compose, private service networking, Nginx/TLS automation candidate, health/resource settings, safe examples, local/CI checks and synchronized docs.
- Validate the real static workspace build, route fallback, production asset paths and browser-origin design with testable local configuration.
- Document/prove that deployment cannot proceed until hostname, session compatibility, secrets, region, database restore and worker authorization gates are satisfied.
- Correct stale deployment documentation to reflect the task’s explicitly assigned 06.3 scope and the 06.4 handoff boundary.
- No production/deployment workflow should run against PROD as part of repository preparation.

### Explicit user/operator approval required

- Create/publish a public App Platform app when possible bandwidth overage cannot be guaranteed zero, or when enabling automatic deployments from the selected branch.
- Create the one optional $6 Droplet; select its region/plan and accept the monthly cap. Any extension, resize, paid backup, snapshot, volume or additional service requires separate explicit approval.
- Select a no-domain public API hostname/certificate approach if the only viable option changes cookie/CSRF architecture or requires another service/account.
- Any PROD credential use, migration, role/grant change, bucket creation/copy, vector build/activation, backup/PITR change, or other mutation.
- Any change to database region, plan, pooler, TLS verification or connection limits.
- Any live Stripe use, paid map provider, domain purchase, or non-Test payment behavior is outside approved scope.

## 13. Exact Task 06.3 Prompt 1 amendments and implementation sequence

The prepared Prompt 1 is thorough and already includes M0–M11, budget gates, user approvals, production DB/AI/worker controls, and a stop condition. It needs targeted additions, not a redesign. A separate revised draft has been prepared; the original untracked file is preserved.

### Required additions to Prompt 1

1. **Frontend/API/session compatibility gate before deploy.** Name apps/frontend/src/lib/api.ts, apps/frontend/src/features/delivery/realtime/deliverySocket.ts, apps/frontend/.env.example, apps/backend/src/app.ts, apps/backend/src/controllers/auth.controller.ts, and apps/frontend/nginx.conf. State that current API/socket paths are same-origin, VITE_API_URL is not consumed, and refresh cookies are SameSite=Lax. Require a proven customer/admin login, refresh, logout, credentialed API and Socket.IO flow against actual origins; stop for approval if security/cookie/CSRF or topology changes are required. Static App Platform does not proxy to a Droplet.
2. **Hard-zero cost gate.** Include current free static egress allowance and billable overage, team pooling and lack of a visible accrued-usage counter; require a current pricing/account check and user approval before public resource creation if $0 cannot be enforced.
3. **Production Compose/Docker repair at correct context.** State that both Node Dockerfiles need repo-root context; current docker-compose.yml points at app subdirectories and has a frontend port mismatch. Require all production Docker builds to use correct root .dockerignore or add/verify package-local ignore files.
4. **Reconcile deployment scope.** Correct stale 06.4 statement in docs/09_Deployment/GITHUB_ACTIONS.md to match explicit 06.3 task scope while keeping M11’s future 06.4 boundary.
5. **Keep limitations explicit.** Supabase PROD region/roles/backups/AI artifact/index are NOT VERIFIED by this audit. No tests or Docker builds were run for this discovery stage.

### Recommended Prompt 1 sequence

- **M0 — Repository/release baseline:** preserve current branch and untracked prompt; reconfirm head/dirty state; update baseline with this report; check actual existing files and scope contradictions.
- **M1 — Topology/cost/region feasibility:** verify provider account free slot/pricing and egress behavior; determine PROD region through authorized read-only evidence; state which candidate-region latency can and cannot be measured before a Droplet.
- **M2 — Environment/security config:** update only exact public URL/CORS/proxy/security configuration after resolving origin gate; keep server-only credentials per API/worker.
- **M3 — Docker production images/Compose:** correct build contexts; define only required service roles; keep FastAPI/database/worker ports private, size pools across processes, add actual health/shutdown/resource settings; never migrate at startup.
- **M4 — Nginx/HTTPS/hostname:** test selected hostname/certificate renewal, reload, monitoring and recovery; verify Socket.IO and cookies; stop if no reliable no-cost HTTPS route.
- **M5 — Supabase readiness:** verify project identity, PROD region, TLS, roles, migration state, backups and restore readiness read-only first; any write remains separately approved.
- **M6 — AI release:** pin approved model/preprocessing identity/checksum, mount artifact read-only, create vectors from actual PROD products only after approval, preserve reader/ingest/media role separation and non-fatal commerce fallback.
- **M7 — External services/workers:** preserve Stripe Test Mode, Brevo server-only, push/email/payment/media gates, leases, health and shutdown; make OSM/map decision before production tiles.
- **M8 — Static App Platform:** verify root workspace build and catchall; prepare exact branch/source/build/output/browser-safe variables; no app create/autodeploy until cost and public-origin gates are approved.
- **M9 — Optional single Droplet:** only after explicit plan/region/budget approval, provision one candidate; measure memory/CPU and end-to-end latency; do not add paid resources or omit required service roles.
- **M10 — Smoke/performance/UX:** verify customer and admin auth, checkout in Stripe Test Mode, Socket.IO, email links, push semantics, AI degraded mode, error paths, and production safe smoke checks. Do not claim performance or visual outcomes without runs/evidence.
- **M11 — Handoff/cleanup:** preserve required evidence/backups; destroy the Droplet if extension is not explicitly approved; verify remaining backups, snapshots, volumes and other billable resources; retain Task 06.4 boundary.

## 14. Audit outcome

### Architecture assessment

The conceptual architecture is coherent, and much of the application already has production-oriented boundaries and safety controls. The repository does not yet contain a deployable production topology. The free static frontend is feasible to build in principle, but its current browser requests, cookie policy and external API topology are not compatible by assumption. A no-domain HTTPS API is technically investigable, but certificate lifecycle and app/browser integration are not implemented or verified. PROD and capacity evidence remains absent.

### Readiness score

**55 / 100.** The score credits a coherent deployment architecture, strong application/worker boundaries, current CI, migration checks and actual Dockerfiles. It is reduced for no production Compose/Nginx/deployment workflow, Compose context mismatch, unresolved static/API origin and cookie compatibility, unverified HTTPS/cost/region, unknown PROD backup/role state, and no measured full-stack capacity.

### Recommendation

**READY AFTER SPECIFIC PROMPT 1 UPDATES.**

Prompt 1 should add the frontend/API/session gate, current free-tier cost/egress gate, root-context Compose correction, and 06.3/06.4 documentation reconciliation before implementation starts. If the origin/security gate cannot be resolved within no-domain/no-cost constraints, pause API exposure and bring the specific architecture choice to the user.

### Deliverables and verification

- Created docs/09_Deployment/TASK_06.3_DEPLOYMENT_ARCHITECTURE_AUDIT.md.
- Prepared separate revised draft docs/tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_REVISED_DRAFT.md. The existing untracked Prompt 1 remains unchanged.
- No code, Docker, Compose, Nginx, CI, production, cloud, or database implementation was performed.
- No tests, builds, Docker builds, services, migrations, deployments, commits, or pushes were run.
- External account configuration, PROD state, GitHub Environment protection, App Platform account capacity, domain/DNS ownership, and billing state remain **NOT VERIFIED**.

