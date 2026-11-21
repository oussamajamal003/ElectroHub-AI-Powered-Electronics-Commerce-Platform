# Task 06.3 — Production Infrastructure & Production Deployment

**Project:** ElectroHub — AI-Powered Electronics Commerce Platform  
**Phase:** 06 — Production Release  
**Status:** READY FOR IMPLEMENTATION PLANNING  
**Task dependency:** Task 06.2 — approved, committed and closed  
**Implementation branch:** `feature/06.3-production-infrastructure`  
**Base branch:** `develop`  
**Next roadmap task:** 06.4 — Final Release Validation & Documentation Completion  
**Hosting provider:** DigitalOcean  
**Initial spending policy:** $0 first; one optional $6 Basic Droplet experiment, only after explicit operator approval  
**Domain policy:** Do not purchase a domain for this task  
**Payment policy:** Stripe Test Mode only; no Live-mode keys or real charges

---

## 1. Mission and outcome

Deliver a secure, reproducible, production-oriented first deployment of the complete ElectroHub application, including the customer storefront, administrator console, Express API, FastAPI AI service, database integrations, media, payment, email, real-time delivery, background processing, and all operational dependencies required by the implemented features.

This is not a frontend-only hosting exercise. The objective is to prepare and deploy the complete application architecture, prove that its production configuration is coherent, and establish a controlled release and rollback process.

The deployment must be proportionate to a student portfolio project and a very small initial audience. It must avoid unnecessary infrastructure spending while preserving real application boundaries and security. A free static frontend deployment is an initial infrastructure milestone, not proof that the complete application is deployed or production-ready.

### 1.1 Required outcome

At completion, the repository and deployment process must provide:

- A reviewed, production-specific configuration for React/Vite, Express/Prisma, FastAPI, Docker Compose, Nginx, TLS, external integrations, and operational services.
- An explicit separation between local development, automated testing, shared DEV, and PROD.
- A free DigitalOcean App Platform static frontend deployment using a provider-generated hostname and automatic HTTPS, if the repository build and platform configuration pass validation.
- A documented, operator-authorized path to one $6/month Basic Droplet for a limited deployment experiment.
- A region decision based on measured connectivity to the actual Supabase PROD database, not assumptions.
- A safe production database migration, backup, restore, and privilege-readiness plan.
- A production AI release plan that deploys exact verified artifacts and builds/validates the vector index against PROD catalog data.
- A controlled deployment pipeline with exact-SHA provenance, health checks, smoke tests, and rollback readiness.
- Evidence that all required customer and administrator capabilities are either working or explicitly blocked by a verified external/provider/capacity limitation.
- A clear record of what was deployed, what was tested, what was not tested, and what remains for Task 06.4.

### 1.2 Non-goals

This task does not authorize:

- Stripe Live Mode, `pk_live_`, `sk_live_`, live webhook secrets, real customer charges, or live financial activity.
- Purchasing a domain, paid DNS, paid certificate, paid App Platform container, managed database, managed Redis, load balancer, Kubernetes, GPU Droplet, or any add-on without separate explicit approval.
- Moving the Supabase database to DigitalOcean or changing its plan/region/pooler without a measured case and separate approval.
- Copying DEV database records, administrator accounts, customer data, AI embeddings, model registrations, payment records, or operational state into PROD.
- Automatically running unreviewed/destructive migrations.
- Silently disabling an implemented customer/admin feature to make a small server appear healthy.
- Claiming production readiness based only on successful image builds or a green CI workflow.
- Merging this branch into `develop` or `main`, changing the repository default branch, or deploying from `main` without the user's separate approval.
- Completing the separate Task 06.4 release-validation/documentation scope.

---

## 2. Repository baseline and mandatory first actions

### 2.1 Confirmed repository facts from the inspected `develop` baseline

The repository is a monorepo:

- `apps/frontend` — React 19, TypeScript, Vite, React Router, React Query, Stripe.js, Socket.IO client, Leaflet.
- `apps/backend` — Node 22.19.0, Express, TypeScript, Prisma 6, PostgreSQL adapter, Stripe, Brevo integration, Web Push, Socket.IO, PDF generation.
- `apps/ai-service` — Python 3.11, FastAPI, CPU-only PyTorch inference, image search and recommendations, pgvector access, separately constrained media-worker role.
- Root npm workspaces currently include `apps/frontend` and `apps/backend`; the AI service is managed separately with Python requirements.
- Existing root `docker-compose.yml` is a development-oriented file and contains localhost URLs. It is not a production Compose file.
- Existing Dockerfiles are present for frontend, backend, and AI service.
- Existing Nginx configuration exists at `apps/frontend/nginx.conf`; deployment guidance exists under `docs/09_Deployment/`.
- Existing deployment documentation includes:
  - `docs/09_Deployment/PRODUCTION.md`
  - `docs/09_Deployment/DOCKER.md`
  - `docs/09_Deployment/NGINX.md`
  - `docs/09_Deployment/SSL.md`
  - `docs/09_Deployment/GITHUB_ACTIONS.md`
  - `docs/10_Operations/ENVIRONMENT_VARIABLES.md`
  - `docs/ADR/ADR-005-digitalocean.md`
- Existing frontend environment template is `apps/frontend/.env.example`; backend and AI templates are `apps/backend/.env.example` and `apps/ai-service/.env.example`.
- Existing `.gitignore` ignores local `.env` variants and allows `.env.example` templates. Preserve and strengthen this behavior.
- Existing CI uses Node 22.19.0 and has frontend/backend tests, disposable PostgreSQL, release E2E, accessibility/quality browser checks, Docker builds, workflow-policy checks and an aggregate Required / Quality Gate. Security Audit is a separate workflow.
- Existing release E2E uses a disposable PostgreSQL and hermetic test environment; it does not prove live Stripe, Brevo, AI-model, or real external-provider success.
- Existing PROD migration workflow is distinct from application deployment and currently has its own trusted-branch/environment protections. Inspect its exact current behavior before changing it.
- Existing AI runtime is CPU-only. Model artifacts are mounted/read-only rather than baked into the image. The learned image embedding space is the D3 SigLIP2 encoder descriptor; production vectors must be compatible with that exact model/preprocessing identity.
- Existing product-media and AI synchronization work is defined by Task 04.3. Reuse its established outbox/worker/role boundaries; do not invent a second media synchronization system.

### 2.2 Branch state observed during task authoring

The remote branch `feature/06.3-production-infrastructure` already exists. At inspection time it was identical to `develop`:

- `develop` and `feature/06.3-production-infrastructure` both resolved to `053a271ba36ebcf436720bdc6aa87c7bb79cf149`.
- Comparison reported zero commits ahead and zero behind.

Therefore, the implementation agent must **use the existing branch**, verify its current state, and must not create a duplicate branch or force-update it. If the branch has moved since this task was written, inspect its history and reconcile safely.

### 2.3 Mandatory repository inspection before editing

Before any implementation:

1. Verify repository root, branch, HEAD, remote tracking state, worktree status, and untracked files.
2. Confirm `feature/06.3-production-infrastructure` exists locally/remotely and identify its current base.
3. Confirm Task 06.2 is present in `develop`, approved/committed/closed as stated by the project owner, and do not reopen or redo it.
4. Read the actual current:
   - `docs/01_Project Foundation/ROADMAP.md`
   - `docs/01_Project Foundation/PROJECT_STRUCTURE.md`
   - `docs/01_Project Foundation/TECH_STACK.md`
   - `docs/03_Architecture/SYSTEM_ARCHITECTURE.md` and relevant frontend/backend/database/AI architecture files
   - `docs/04_Engineering Standards/` security, API, performance and coding guidance
   - `docs/06_Database/` migration and production database guidance
   - `docs/07_AI/FASTAPI.md`, AI architecture, model and recommender guidance
   - `docs/08_Quality/TESTING.md`, `E2E.md`, and Task 06.1/06.2 task/evidence files
   - `docs/09_Deployment/` and `docs/10_Operations/` runbooks
   - Task 04.2, 04.3, 04.4, 04.5, 04.6, 04.7, 03.6, 03.8, 03.9 and relevant Task 05.x implementation evidence where they define production contracts.
5. Inspect the actual source, Dockerfiles, Compose files, Nginx config, Prisma schema/migrations, CI workflows, environment loaders, payment/email/push supervisors, AI model registry, vector gateway, and media worker. Documentation alone is not proof of implementation.
6. Produce a concise inventory of current implementation, reusable assets, defects, unknowns and planned changes.
7. Preserve all pre-existing user changes. Do not reset, clean, overwrite or stage unrelated work.
8. Do not start the local development stack, run production commands, connect to PROD, create cloud resources, or mutate any database merely to inspect the repository.

### 2.4 Source-of-truth order

When requirements conflict:

1. Current repository implementation and approved architecture/security invariants.
2. `ROADMAP.md` for phase/task boundaries.
3. This Task 06.3 specification for task scope and the decisions approved here.
4. Existing feature task specifications and implementation evidence.
5. Existing deployment/operations runbooks.
6. Provider documentation for current external platform behavior.
7. Historical discussion only where consistent with the above.

Do not silently resolve a material conflict. Record it and ask for a decision.

---

## 3. Approved architecture decisions

### 3.1 Logical target architecture

```text
Customers / Administrators
          |
          | HTTPS
          v
DigitalOcean App Platform
Free Static Site (React/Vite)
Provider-generated *.ondigitalocean.app hostname
          |
          | HTTPS API + secure Socket.IO
          v
Public API hostname / verified TLS endpoint
          |
          v
DigitalOcean Ubuntu Basic Droplet (optional, $6/month)
          |
          +-- Nginx (public reverse proxy / TLS)
          |
          +-- Docker Compose
                |
                +-- Express API / Prisma
                |
                +-- FastAPI AI API (private network)
                |
                +-- separately authorized workers
                     (only where the approved production profile requires them)
          |
          +-----------------------> Supabase PROD PostgreSQL
          |                         Prisma runtime role
          |                         restricted AI vector reader
          |                         restricted media-worker role
          |
          +-----------------------> Supabase Storage PROD
          |
          +-----------------------> Stripe Test Mode
          |
          +-----------------------> Brevo transactional email
          |
          +-----------------------> approved production map-tile provider

GitHub Actions:
exact-SHA validation -> image/build artifacts -> protected approval
-> deployment -> health checks -> smoke tests -> rollback decision
```

The exact public API hostname and TLS strategy must be validated before frontend configuration. The frontend's App Platform hostname is not automatically a reverse proxy for the Droplet API.

#### Audit-derived frontend/API compatibility gate

The discovery audit at HEAD 053a271ba36ebcf436720bdc6aa87c7bb79cf149 found that apps/frontend/src/lib/api.ts and apps/frontend/src/features/delivery/realtime/deliverySocket.ts use same-origin relative API and Socket.IO paths. VITE_API_URL appears in apps/frontend/.env.example but is not consumed by frontend source. The backend uses credentialed CORS based on FRONTEND_URL, and the refresh cookie is HttpOnly, Secure in production, and SameSite=Lax in apps/backend/src/controllers/auth.controller.ts. The App Platform static hostname does not proxy requests to an external Droplet; App Platform rewrites only target components in the same App Platform app.

Before configuring a separate frontend and API origin or publishing customer/admin sign-in, prove the complete browser flow against the actual assigned origins: customer and admin login, credentialed API calls, refresh rotation, logout/cookie clearing, Socket.IO connect/reconnect, CORS, and deep-route reload. Test in the target browser(s). Do not assume that changing VITE_API_URL is sufficient. If the selected topology requires changing cookie SameSite policy, CSRF protection, or the hosting topology, stop and present that security/architecture decision for explicit user approval before implementing it or exposing the API.

### 3.2 Frontend hosting: $0 first

Use DigitalOcean App Platform's **static-site** free tier for the React/Vite production build, if current platform limits and repository build requirements still permit it.

Requirements:

- One static-site component only.
- GitHub repository: `oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform`.
- Source branch: `feature/06.3-production-infrastructure` only after reviewed configuration is ready.
- Do not deploy from `develop` merely because it is selected in the DigitalOcean UI.
- Determine the monorepo root/build context and workspace dependency requirements from the actual repository. Do not assume setting source directory to `apps/frontend` will work when Vite/npm needs root workspace files and the root lockfile.
- Confirm the exact build command and output directory from the real frontend scripts/configuration. `dist` is a candidate, not an unverified hard-coded assumption.
- Use a production build, never Vite's development server.
- Use the generated DigitalOcean hostname (`*.ondigitalocean.app`) and platform-managed HTTPS.
- No purchased domain, DNS subscription or paid certificate.
- Turn off automatic deployment during initial setup. Enable it only after the branch, workflow, build and release policy are approved.
- Configure only browser-safe frontend build variables in App Platform. Vite `VITE_*` values are public and must never contain secrets.
- Recheck the current App Platform static-site pricing and the account's available free static-app slot before creation. Current provider documentation lists 1 GiB outbound per free app and $0.02/GiB additional outbound; allowance/usage is pooled at team level, and cumulative App Platform usage is not currently visible in the control panel. Do not claim a guaranteed $0 bill or publish until the user explicitly accepts any overage exposure when it cannot be hard-capped at zero.
- Keep frontend deployment separate from backend deployment and from production database migrations.

The free frontend is an initial public portfolio surface. It is not a complete commerce deployment until its required backend, database, AI, payment, email, media and real-time dependencies are available and verified.

### 3.3 Optional VPS: $6 experiment only

The only currently approved candidate is the DigitalOcean Basic Droplet:

- 1 shared vCPU
- 1 GiB RAM
- 25 GiB SSD
- advertised $6/month plan
- usage-based/per-second billing subject to provider minimums and monthly cap

The $6 is not a one-time lifetime purchase. It is a monthly-capped compute price while the Droplet exists. Stopping/powering off the Droplet does not stop billing. Destroying the Droplet stops Droplet compute billing, but separately retained backups, snapshots, volumes, reserved resources or other billable items may continue to cost money.

**Budget authorization:**

- Initial spending is $0.
- Do not create a Droplet during repository implementation or the free static-site milestone.
- Create one $6 Droplet only when deployment readiness is demonstrated and the user explicitly approves the creation step.
- Initial experiment maximum: one month.
- Extension requires the user's explicit approval.
- No automatic purchase, resize, upgrade, backup add-on, snapshot, volume, load balancer, managed database, managed Redis, Kubernetes or paid App Platform component.
- Before creation, show the exact selected plan, region, billing estimate, optional resources, and expected total. Wait for explicit approval.
- Before finishing, preserve required evidence and backups, destroy the Droplet if no extension is approved, and verify separately billable resources have been removed.
- Do not leave the Droplet merely powered off and claim spending has stopped.

**Capacity warning:** 1 GiB RAM / 1 vCPU is a constrained experiment and is not presumed capable of running the complete Express + FastAPI + model inference + workers + Nginx stack reliably. The task must measure real container memory/CPU and startup behavior. Do not silently omit AI, email, push, Socket.IO or required workers to make the server fit. If required features cannot run safely within the approved $6 limit, report the measured blocker and present options; do not spend more without approval.

### 3.4 No purchased domain; hostname and TLS strategy

- The frontend uses the free App Platform-generated hostname and automatic HTTPS.
- No domain purchase is allowed in this task.
- The VPS API needs its own browser-reachable HTTPS origin. It must not be left as plain HTTP or a localhost URL.
- Investigate and validate a no-purchase option before committing to a topology:
  1. A supported free provider-generated or free dynamic-DNS hostname pointing to the Droplet; or
  2. A Let's Encrypt IP-address certificate if the selected ACME client and renewal/install workflow can be made reliable.
- Let's Encrypt IP-address certificates are short-lived (approximately 160 hours / six days) and require an ACME client and automated renewal path that supports the short-lived profile. Do not treat this as a simple one-time certificate installation.
- Prove renewal, certificate reload, failure alerting and recovery before relying on IP certificates.
- If neither no-cost hostname nor safely automated IP certificate is viable, stop before exposing the API and ask the user to choose. Do not buy a domain or paid certificate.
- Nginx must expose only the necessary public web ports; application and AI ports remain private.
- Do not expose FastAPI directly to the public internet.
- The public frontend, API, OAuth callback, Stripe webhook, email links, CORS allowlist and Socket.IO URL must all use their actual assigned HTTPS origins.

### 3.5 Region selection: evidence before decision

The actual Supabase PROD region must be identified from verified project/provider configuration, not inferred from DEV, hostnames or previous assumptions.

Measure and compare candidate DigitalOcean regions before choosing:

- Singapore is the first candidate to evaluate.
- Evaluate all currently available nearby/technically plausible DigitalOcean regions with comparable measurements (for example Bangalore and other available Asia/Europe regions only where the route is plausible).
- Do not create multiple paid Droplets for region comparison.
- Use safe network probes, provider-supported measurements and existing infrastructure evidence before provisioning.
- Once the single approved Droplet exists, measure actual VPS-to-Supabase performance from it.

Record:

- DNS lookup time.
- TCP connection time.
- TLS handshake time.
- Repeated authenticated-safe database `SELECT 1` round-trip time.
- Repeated representative read-only query latency.
- p50, p95, min/max, sample count, failure rate and time window.
- Whether the connection uses the approved Supabase pooler/direct endpoint.
- Whether TLS certificate verification is enabled.
- Backend API p50/p95 for representative endpoints.
- Connection pool size and total possible sessions across API and workers.

Do not change the database region, Supabase plan, pooler, TLS verification or connection limits just to improve one measurement. Any such change needs a separate evidence-based decision and explicit approval.

### 3.6 Existing Supabase PROD remains authoritative

- Use the existing Supabase PROD project, not a newly purchased DigitalOcean database.
- Confirm project identity and region before every production database operation.
- PROD project ref recorded in current environment documentation: `yepfgjehdstlxbpespun`. Verify it live/read-only before use; do not trust a copied value alone.
- DEV project ref currently documented as `pzxekjybdiulzmssalfo`. Never mix environment credentials.
- Runtime application role, Prisma migration role, AI vector reader, and media worker must remain least-privilege and distinct according to existing database architecture.
- Production credentials must be supplied only to the process that needs them.
- No production migration may be run from a developer's normal local shell.
- Existing protected production migration workflow must be inspected and retained or improved with explicit approval gates.
- Before any migration: verify approved migration set/order/checksums, database target, backup and restore readiness, compatibility, lock/timeout behavior and rollback plan.
- Do not assume a backup exists. Verify the actual backup/restore capability and record its timestamp and scope.
- A failed migration must stop rollout; do not improvise manual SQL repairs without an approved recovery plan.

### 3.7 AI production release and data preparation

The AI service is a separately deployable FastAPI service and remains isolated from commerce responsibilities.

Production AI activation is a coordinated release, not just starting a container.

Required sequence:

1. Verify production database schema, required extensions (including pgvector), AI schema, grants, restricted roles and migrations.
2. Verify exact approved model artifact set: D3 SigLIP2 encoder `model.safetensors`, descriptor/preprocessing identity, relevance-gate artifact where applicable, checksums and expected paths.
3. Keep model artifacts outside the Docker image where current architecture requires a read-only mount. Do not invent a new model artifact or train a model as part of deployment.
4. Build the production vector index from the actual eligible PROD catalog images and PROD product IDs.
5. Do not copy DEV's vectors or assume DEV catalog coverage, product IDs, image revisions or quality metrics represent PROD.
6. Validate index completeness, active model identity, source-current status, product resolution, relevance behavior, latency and error handling.
7. The DEV-specific 6.8% stocked-photo rejection exception is not automatically a PROD quality decision. Obtain an explicit production quality decision.
8. Generate a production AI release manifest binding:
   - application release SHA
   - AI service image digest
   - encoder/model checksum
   - descriptor/preprocessing version
   - relevance-gate checksum/version
   - database migration prerequisites
   - vector index identity and coverage
   - catalog source/version snapshot
   - activation timestamp/approval
   - rollback-compatible prior release/index
9. Validate compatibility before activation. An incompatible model/index/schema combination must not serve traffic.
10. Activate only after readiness and rollback checks pass.
11. Keep image search/recommendations in a truthful unavailable/degraded state if AI is unavailable; ordinary catalog and commerce operations must remain usable.
12. Use Task 04.3's established media/embedding synchronization workflow for later production product-image additions/replacements. Do not create an independent parallel worker.

If PROD catalog ingestion, model artifacts, database schema, role grants, or quality approval is not ready, AI activation is blocked and must remain explicitly unclaimed.

---

## 4. Complete scope by application layer

### 4.1 Frontend — React/Vite

Production frontend must include all existing customer and administrator routes and functionality, not a reduced demo build.

Review and validate:

- Production Vite build and SPA fallback for nested routes.
- Customer storefront, product catalog/details, search/filter/sort, image search entry, recommendations, cart, wishlist, checkout, account/profile, authentication, OAuth, order history/details, delivery tracking, notification preferences, PDFs/downloads, and all implemented responsive states.
- Admin authentication, one-time bootstrap invitation flow, MFA and role-protected admin shell; dashboard; product/category management; media; inventory; orders; delivery; customer management; analytics; settings; logs and other implemented admin capabilities.
- Loading skeletons, route-level lazy loading, empty/error/offline states, accessible forms, responsive layout, native zoom, reduced motion, keyboard/focus behavior and customer/admin experience parity.
- Browser tab icon/favicon and manifest assets: verify correct icon, sizes, theme and no broken path in deployed production.
- No development banners, demo identities, debug panels or DEV-only controls.
- No browser-side secrets.
- No production source map exposure unless explicitly intended and secured.
- Correct cache headers: hashed assets may be immutable; HTML and runtime config must not be cached in a way that leaves stale API origins.
- Verify refresh/deep-link behavior for routes such as `/account`, `/orders/:reference`, admin routes and delivery detail pages.
- Verify that payment UI does not load slowly due to unnecessary blocking requests; measure Stripe Elements/Payment Element initialization and distinguish provider/network latency from app rendering.
- Preserve existing design system and Task 06.2 accessibility decisions; do not redesign unrelated UI.

### 4.2 Frontend environment files

The task must audit and prepare the frontend environment contract:

- `apps/frontend/.env.example` — committed, safe, documented template with local defaults/placeholders and no credentials.
- `apps/frontend/.env` — local-only, ignored, never committed.
- `apps/frontend/.env.local` — local override, ignored, never committed.
- production App Platform build settings or the approved build pipeline — actual production public values, never copied blindly from local `.env.local`.
- Any other local variants remain ignored.

Because Vite exposes `VITE_*` variables to browser bundles, only public values are allowed. At minimum audit:

- `VITE_API_URL`
- `VITE_STRIPE_PUBLISHABLE_KEY` — Test Mode `pk_test_` only
- `VITE_IMAGE_SEARCH_ENABLED`
- `VITE_MAP_TILE_URL`
- `VITE_MAP_ATTRIBUTION`
- any additional currently consumed public variable discovered in source.

The production frontend API URL must be the actual HTTPS API hostname. It must not be `localhost`, `127.0.0.1`, a Docker service name, a DEV hostname or an internal-only address.

### 4.3 Backend — Express/Prisma

Deploy the existing backend as the authoritative commerce/security boundary.

Validate:

- Production startup configuration and strict environment validation.
- Prisma Client generation in the image build.
- Runtime DB role and pooler configuration.
- Authentication, refresh-token rotation, cookie Secure/HttpOnly/SameSite/path/origin behavior behind Nginx.
- Customer/admin authorization and MFA.
- Product/catalog, search, cart, wishlist, checkout, inventory, orders, delivery, analytics, settings, admin, PDFs, uploads, email, push, AI gateway and Socket.IO routes.
- CORS allowlist contains only actual production frontend origin(s).
- Trusted proxy settings are correct behind Nginx and do not trust arbitrary forwarded headers.
- Rate limiting and request-size limits are appropriate.
- Timeouts and graceful shutdown preserve in-flight work.
- Liveness/readiness endpoints distinguish process health from dependency readiness.
- Health endpoints do not leak secrets, environment values, DB hostnames, stack traces or sensitive configuration.
- Error handling/logging remains sanitized.
- Backend does not become available to public traffic until database, schema, secret, payment and service prerequisites pass.

Do not rewrite authentication or refresh-token rotation without evidence of a specific defect.

### 4.4 Database / Prisma

- Confirm the exact PROD target and region.
- Validate migration history and schema drift read-only first.
- Review all pending migrations for destructive operations, long locks, data backfills and compatibility.
- Confirm pgvector extension/schema/roles/indexes required by AI.
- Verify Prisma runtime role privileges and separate migration authority.
- Verify AI reader and media worker roles have only their intended permissions.
- Verify production seed behavior cannot create DEV/test administrators or sample commerce data.
- Do not run development seed scripts against PROD.
- Do not copy DEV records into PROD.
- Ensure all DB URLs are injected at runtime or through protected migration environment, not baked into images.
- Configure connection pool capacity across all independent processes (API, email/push dispatch, payment worker, AI reader, media worker, migrations and one-off jobs).
- Optimize local-to-Seoul database latency as a diagnostic baseline, but prioritize the actual production VPS-to-PROD database route.
- Keep `DB_SSL_CA_CERT_PATH`/TLS behavior secure; never disable certificate verification to work around a network issue.

### 4.5 AI — FastAPI, artifacts and pgvector

- Build and run the CPU-only FastAPI container from pinned `requirements-runtime.txt`.
- Keep `AI_SERVICE_API_KEY` distinct per environment and shared only between the matching backend and AI service.
- Keep `AI_VECTOR_DATABASE_URL` read-only for online search/recommendation service.
- Keep ingestion/admin credentials out of the online AI API.
- Keep `AI_MEDIA_WORKER_DATABASE_URL` in a separately authorized media-worker process only.
- Mount model and relevance artifacts read-only, checksum-verify and record versions.
- Enforce request size, image pixel, inference timeout, concurrency and CPU-thread budgets.
- Ensure AI readiness accurately reflects artifact/index availability.
- AI service stays on the private Docker network; backend calls it through `AI_SERVICE_URL=http://ai-service:<internal-port>` or the exact Compose service name/port.
- Public browser traffic never calls the private AI service directly.
- No direct AI access to Stripe, Brevo, JWT, customer auth or commerce writes.
- Verify fallback behavior for AI outage and protect the API from resource exhaustion.

### 4.6 Workers and durable processing

Inventory all actual workers and decide which must run for the production customer experience.

At minimum review:

- Payment supervisor/worker and its existing authority model.
- Commerce email outbox producer/dispatcher.
- Delivery push notification dispatch.
- Product-media/AI embedding synchronization worker.
- Any other durable queue or scheduled process found in the repository.

Requirements:

- Worker processes must be separate from the public API where current architecture requires.
- Use the existing ownership/lease/heartbeat/drain mechanisms.
- No ad hoc background process, PM2 inside containers, or duplicate worker instance.
- Docker restart policies must not bypass application-level authorization or reprocess financial work unsafely.
- Health/readiness must report worker state and backlog/oldest-event age where supported.
- Email/push dispatch must not be enabled by a generic "all workers on" switch.
- Production dispatch activation requires explicit operator approval and exact target identity.
- Do not silently leave required customer email/notification processing disabled and claim end-to-end readiness.

### 4.7 Payments — Stripe Test Mode only

- Use only Stripe Test Mode credentials.
- Frontend `VITE_STRIPE_PUBLISHABLE_KEY` must begin with `pk_test_`.
- Backend `STRIPE_SECRET_KEY` must be `sk_test_`.
- Backend `STRIPE_WEBHOOK_SECRET` must be the signing secret for the exact deployed HTTPS webhook destination.
- The local Stripe CLI `whsec_` is not interchangeable with the hosted endpoint's signing secret.
- Hosted endpoint should be the actual public backend URL plus the current webhook route, verified from source (do not assume path).
- Register only required Stripe Test Mode events.
- Keep payment provider events/webhooks idempotent and signature-verified using raw request bytes.
- Verify successful, declined, delayed, duplicate, out-of-order and retry/reconciliation paths using Test Mode only.
- No `pk_live_`, `sk_live_`, live webhook signing secret, real card charge, payout or production financial transaction.
- Ensure production/release config fails closed if any Stripe key is Live Mode.
- Never disable the payment supervisor in the deployed environment if checkout is an accepted feature. If the $6 capacity or safe authorization prevents it from running, the release is blocked/degraded and must be explicitly reported, not bypassed.

### 4.8 Brevo transactional email

- Use the existing Brevo account and verified sender configuration.
- Keep `BREVO_API_KEY` server-side.
- Verify sender identity/domain requirements with Brevo; no new paid domain purchase is authorized.
- All production email links must use the public production frontend HTTPS hostname, never localhost or DEV.
- `COMMERCE_EMAIL_ORIGIN` must equal the trusted production frontend origin.
- Verify OTP, order confirmation, payment confirmation, invoice/receipt and out-for-delivery transactional email templates/links where implemented.
- Out-for-delivery email must target the actual customer's order email, include a clear "View Your Order" CTA and resolve to the correct authorized order detail route.
- All eligible customers must be able to receive transactional out-for-delivery emails; do not retain a personal test-recipient allowlist in the production configuration.
- Verify queue producer, worker authorization, retry policy, idempotency, dead-letter/failed state, backlog visibility and provider acceptance.
- Do not send bulk test messages to all customers. Use controlled test accounts/addresses first.
- Provider acceptance is not proof of inbox delivery; distinguish accepted, delivered, bounced, deferred and suppressed states where provider data permits.
- Email failures must not roll back an already-committed order/delivery state.

### 4.9 Browser push and real-time delivery

- Verify browser push subscription creation/persistence against the deployed API.
- Verify VAPID public/private pair consistency and safe key handling.
- Keep VAPID private key server-side.
- Verify service-worker registration/scope, secure context, permission state, subscription ownership and subscription renewal/revocation.
- Test push when the customer tab is closed, browser is backgrounded, and browser is fully closed where the platform supports it.
- Distinguish push provider/browser delivery from Socket.IO events; Socket.IO alone does not deliver notifications when the browser is closed.
- Verify order status event authorization and correct order reference/link.
- Verify customer sees the correct notification without exposing another customer's order.
- Ensure the push dispatcher is separately authorized and monitored.
- A green VAPID doctor is not proof of a real subscription or delivery. Record each stage separately.
- If browser vendor push services are unreachable, show actionable UI state and preserve email fallback.

### 4.10 Socket.IO

- Nginx must forward WebSocket upgrade headers.
- Configure appropriate read/send/idle timeouts.
- Use the public HTTPS/WSS origin.
- Verify authenticated socket subscription and per-user/per-order authorization.
- Verify reconnect, heartbeat, disconnect and delivery-state propagation.
- One backend instance does not automatically require Redis adapter.
- Add Redis only if demonstrated queue, rate-limit, cache or multi-instance requirements justify it and the user separately approves its cost.
- If horizontal scaling is introduced later, document adapter/session consistency requirements.

### 4.11 Supabase Storage and product images

The user wants to reuse the same product images already used in DEV. Preserve the image assets and visual catalog continuity, but preserve environment isolation.

- Inventory the actual DEV product-media objects/paths and the current PROD bucket.
- Reuse the same image bytes/assets where authorized and suitable.
- If assets must be copied, use a controlled, checksum-verified DEV-to-PROD media transfer into the PROD bucket; do not copy DEV database records or embeddings.
- Do not point PROD application credentials at the DEV Supabase project/bucket.
- Keep PROD media bucket/project credentials separate.
- Public read access only for intentionally public catalog images; writes remain backend-authorized.
- Verify URLs, content types, cache headers, image variants, deletion/replacement behavior and email-safe image URLs.
- Ensure the frontend never receives service-role credentials.
- Verify AI media worker reads the production bucket and builds vectors from production product IDs and image revisions.
- Do not copy DEV vectors to PROD.

### 4.12 Maps and tile provider

- Inspect current Leaflet/OpenStreetMap integration and the Task 04.6/04.7 contracts.
- Choose a production tile provider only after checking its terms, quotas, attribution, CORS, key restrictions, rate limits and cost.
- Do not treat the public OpenStreetMap standard tile endpoint as an unlimited production tile CDN.
- Do not buy a tile plan or add a paid key without explicit approval.
- If a free provider is chosen, document its usage cap and the safe degraded state.
- Configure tile host in frontend CSP and `VITE_MAP_TILE_URL`/attribution values.
- Verify maps work over HTTPS and do not leak internal coordinates or sensitive customer data.

---

## 5. Production environment and secrets strategy

### 5.1 Three separate secret/configuration locations

| Location | What belongs there | What must not belong there |
|---|---|---|
| Local ignored `.env` / `.env.local` | Local URLs, DEV/test credentials and developer-only config | PROD secrets |
| GitHub Actions Secrets / protected Environments | CI-required tokens, deploy SSH key/known host, protected migration credentials only when the exact workflow requires them | Secrets copied to every workflow or printed in logs |
| VPS runtime secret files / platform environment settings | PROD API, DB, AI, Stripe Test Mode, Brevo, Storage and worker credentials | Any secret in Git, Docker image, build args, frontend bundle or logs |

Do not assume every runtime secret must be stored in GitHub Actions. If the deployment uses SSH and a protected host-side environment file, application runtime secrets should normally remain on the server. Give a workflow only the minimum deployment credential it needs.

### 5.2 Runtime environment files

- Keep tracked `.env.example` files with placeholders and clear comments.
- Keep `.env`, `.env.local`, `.env.production.local` and other real local files ignored.
- On the VPS, store runtime configuration outside the repository checkout where practical (for example `/etc/electrohub/` or a root-owned deployment directory).
- Set strict ownership/permissions (`root` or dedicated deploy/runtime group; secret files not world-readable).
- Do not commit, upload as artifacts, echo, print, or include secrets in diagnostics.
- Docker Compose must use `env_file`/secret mounts from protected paths; never interpolate secret values into committed YAML.
- Use Docker secrets or protected files for sensitive values where supported by the single-host design.
- Ensure `docker inspect`, image history, build logs and CI artifacts do not reveal secrets.
- Rotate any credential accidentally exposed.

### 5.3 Secret inventory (derive exact required names from code)

Maintain a table containing variable name, owning service, purpose, secret/public classification, source location, environment, required/optional status, rotation and validation.

At minimum inspect these families and exact current source consumers:

**Frontend public build values**
- `VITE_API_URL`
- `VITE_STRIPE_PUBLISHABLE_KEY` (Test Mode only)
- `VITE_IMAGE_SEARCH_ENABLED`
- `VITE_MAP_TILE_URL`
- `VITE_MAP_ATTRIBUTION`
- any additional public values discovered in code.

**Backend runtime**
- `NODE_ENV=production`
- `PORT`
- `FRONTEND_URL`
- `DATABASE_URL`
- `DIRECT_URL`
- `DB_RUNTIME_URL_SOURCE` if required by current loader
- `DB_SSL_CA_CERT_PATH` if required by verified Supabase TLS chain
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `OTP_HASH_SECRET`
- Google OAuth variables and production callback URL if OAuth is included in the approved release
- `AI_SERVICE_URL`
- `AI_SERVICE_API_KEY`
- Stripe Test Mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Brevo `BREVO_API_KEY`, sender email/name
- commerce email origin, enqueue/dispatch/send-mode settings and worker tuning
- push enablement, VAPID public/private/subject and approved-target controls
- Supabase Storage URL/project/bucket and server-only secret/service-role credentials
- delivery/map settings and any required external-provider values
- any additional variables found in source.

**AI runtime**
- `AI_ENVIRONMENT=production`
- `AI_PROCESS_ROLE=api` for API only
- `AI_SERVICE_API_KEY`
- `AI_BIND_HOST`/`AI_PORT`
- request/inference/resource limits
- `AI_MODEL_ARTIFACT_DIR`
- `AI_RELEVANCE_ARTIFACT_DIR` if applicable
- `AI_VECTOR_DATABASE_URL` read-only
- model/index manifest identity
- separate `AI_PROCESS_ROLE=media_worker` and `AI_MEDIA_WORKER_DATABASE_URL` only for the separately authorized media-worker container
- `AI_MEDIA_STORAGE_BASE_URL` for PROD storage if required.

**Deployment**
- public frontend/API origins
- deployment release SHA/image tags
- Nginx/ACME certificate paths and renewal configuration
- health-check endpoints
- log/monitoring configuration.

### 5.4 Google OAuth constraints

The current Google OAuth consent screen may be restricted to listed test users. Verify the exact current OAuth publishing/testing status, allowed test users, authorized redirect URI and authorized origins.

- Use the actual deployed HTTPS callback path verified from backend source.
- Do not invent callback URLs.
- Do not place `GOOGLE_CLIENT_SECRET` in Vite or browser config.
- If the consent screen remains in Testing and only listed test users can sign in, disclose this limitation. Do not claim unrestricted public OAuth.
- Any change to Google app publishing/verification or allowed users is an operator decision.

### 5.5 GitHub Actions Secrets and Environments

Inspect current workflow usage before changing names. Produce a least-privilege inventory, including only secrets actually required by each workflow.

Likely categories:

- deployment SSH private key
- deployment host/IP
- deployment user
- pinned SSH known-host key/fingerprint
- container registry credentials only if a registry is used
- protected PROD database URLs for the existing migration workflow, if retained
- any narrowly scoped provider credentials needed by a dedicated workflow.

Use protected GitHub Environments for production deployment and migration approval. Restrict environment access to authorized maintainers. Do not make every secret repository-wide if environment-scoped access is available.

Do not place all application runtime secrets in GitHub Actions merely for convenience. The VPS should receive only the secrets required by its services through a secure, auditable path.

### 5.6 Secret safety checks

- Scan repository history/current tree for accidentally committed secrets.
- Verify `.gitignore` protects `.env`, `.env.local`, `.env.production.local`, certificates, private keys, model artifacts, dumps, backups, logs, local caches and generated state.
- Ensure `.env.example` remains tracked.
- Ensure `.env.local` and `.env` are not tracked.
- Check frontend build output for accidental secret strings.
- Check Docker image layers/history for secret leakage.
- Ensure workflow logs redact secrets and avoid printing environment dumps.
- Never copy secret values into the task evidence file.

---

## 6. Docker and production runtime design

### 6.1 Production Compose

Create a production-specific Compose configuration under the existing infrastructure convention (inspect `infrastructure/` and `docs/03_Architecture/MONOREPO_STRUCTURE.md` first). Do not repurpose the development `docker-compose.yml` by changing its localhost defaults.

The production Compose design must:

- Build/pull immutable release-tagged images.
- Use a shared, explicitly named private network.
- Expose only Nginx publicly.
- Keep Express and FastAPI ports internal.
- Keep AI API and workers on private networks.
- Run containers as non-root where practical.
- Use read-only filesystems/capabilities where compatible.
- Set memory/CPU/PID limits appropriate to measured capacity.
- Set restart policies that do not bypass payment/worker authorization.
- Define health checks and startup dependencies.
- Use `init`, stop grace periods and graceful shutdown where appropriate.
- Persist only data that genuinely requires persistence.
- Avoid putting Supabase PostgreSQL inside Compose.
- Avoid Redis unless a verified feature requirement exists.
- Avoid PM2 inside containers; Docker Compose owns container lifecycle.
- Avoid multiple replicas on the one-server topology.
- Keep the email, payment, push and media workers separate when the code architecture requires separate process roles.
- Ensure a worker cannot accidentally start from the generic API image command or become active because Compose restarts it.
- Avoid privileged mode and host Docker socket mounts unless a separately reviewed requirement exists.
- Use explicit image tags/digests; do not deploy floating `latest`.

### 6.2 Frontend deployment model

The free App Platform static frontend is separate from the VPS Compose stack. Do not run two competing public frontend copies unless an explicit fallback/test purpose exists.

If later evidence shows App Platform free static hosting cannot satisfy required production routing, caching, environment or UX requirements, stop and present the trade-off. Do not silently switch to a paid App Platform component.

### 6.3 Image build requirements

- Root lockfile and workspace dependencies must be respected.
- Ensure backend Prisma Client generation occurs at build time without requiring real DB credentials.
- Ensure backend runtime image contains Prisma runtime dependencies, migrations/schema required by deployment operations, PDF fonts/assets and other required packaged files.
- Ensure frontend build output is served with SPA fallback.
- Ensure AI runtime installs only pinned runtime requirements, CPU-only dependencies and no unnecessary test/build packages.
- Keep AI model files outside the image where designed; mount read-only with checksum validation.
- Use multi-stage builds where beneficial.
- Pin base images to supported versions/digests as practical and define an update process.
- Run as non-root.
- Use `.dockerignore` at the correct build contexts; do not exclude required workspace manifests/lockfiles or model artifacts that are intentionally mounted separately.
- Validate build context size and avoid sending caches, local env files, node_modules, test reports, model weights and DB dumps unnecessarily.

### 6.4 Health and readiness

Define and test separate states:

- container process running
- liveness endpoint
- readiness endpoint
- database reachable with verified TLS
- AI model/index ready
- worker authorized and healthy
- Nginx route healthy
- external integration configured
- end-to-end feature ready.

A green Docker health check is not proof of a complete customer journey.

---

## 7. Nginx, HTTPS, WebSocket and public routing

### 7.1 Routing

Nginx is the VPS public entry point. Route only the required paths:

- frontend route only if the chosen architecture serves the frontend from VPS; otherwise App Platform serves it.
- `/api/*` to Express.
- `/socket.io/*` to Express with WebSocket upgrade support.
- any verified public static/media route only if intended.

Do not expose `/docs`, debug endpoints, internal FastAPI routes, worker ports or DB ports publicly.

### 7.2 Security

- HTTP redirects to HTTPS.
- TLS 1.2+ / modern TLS policy.
- HSTS only after stable HTTPS verification and with deliberate max-age.
- Security headers reviewed against the actual SPA, Stripe, OAuth, maps and external resource requirements.
- Correct proxy headers and trusted proxy handling.
- Request body size limits for image uploads.
- Route-specific timeouts; do not globally raise timeouts.
- Compression and static asset cache policy.
- No public caching of personalized account, checkout, admin, order or payment responses.
- Access/error logs sanitized and rotated.
- Validate Nginx config before reload.
- Preserve Socket.IO upgrade headers and suitable idle timeouts.
- Validate certificate renewal automatically and prove renewal/reload/recovery.

### 7.3 Browser origin matrix

Document the exact final origins for:

- App Platform frontend
- VPS backend API
- Socket.IO/WSS
- Google OAuth callback and allowed origins
- Stripe Test Mode webhook endpoint
- Brevo email CTA links
- any map tile host/CSP
- Supabase Storage image origin.

The browser must never call `http://localhost`, `127.0.0.1`, Docker service names, private IPs or DEV origins in production.

Internal backend-to-AI calls may use the Docker private service hostname. This is the intentional exception; it must never be exposed as a browser URL.

---

## 8. CI/CD and branch/release strategy

### 8.1 Branch flow

- Work only on `feature/06.3-production-infrastructure`.
- Base it on the current `develop` state after verifying Task 06.2 is included.
- Do not work directly on `develop` or `main`.
- Do not commit unrelated files.
- Do not force-push.
- Do not merge the task branch.
- When complete, provide the reviewed commit(s) and PR-ready summary for the user.
- User merges the task branch into `develop`; after develop validation, user promotes to `main`.
- `main` is intended to become the repository default branch after the user authorizes that repository setting change. Do not change it autonomously.

### 8.2 CI workflow parity

The same relevant CI and security workflows must run for both `develop` and `main` on equivalent push and pull-request events.

Audit all `.github/workflows/*.yml` triggers, path filters, `if:` conditions, permissions, concurrency, secrets, checkout SHA and required status names.

At minimum verify parity for:

- lint
- frontend/backend typecheck
- frontend/backend unit tests
- backend disposable-PostgreSQL/integration tests
- Prisma schema/migration validation
- release E2E Chromium/Firefox/WebKit and responsive projects
- accessibility/quality/native-zoom QA
- AI tests/lint/build
- frontend/backend/AI Docker builds and image smoke checks
- bundle/gzip budgets
- workflow-policy/security checks
- aggregate Required / Quality Gate
- separate Security Audit.

Do not assume a workflow runs on `main` because it runs on `develop`; inspect exact triggers. Preserve exact PR head SHA testing. Skipped/cancelled/failed required dependencies must fail the aggregate gate.

### 8.3 CI must not deploy or mutate PROD accidentally

- Ordinary PR CI uses disposable databases and synthetic fixtures only.
- CI must not send real emails, run real push dispatch, charge cards, mutate production catalog, activate AI index, or run shared DEV/PROD migrations.
- Production deployment is a separate controlled workflow and protected environment.
- No automatic deployment from arbitrary feature branches.
- Deployment must use the exact reviewed commit SHA and immutable image digest.
- A deploy must not occur merely because a feature branch turns green.
- Keep database migration and application deployment as distinct release steps.
- Verify current `prod-migration.yml` policy before changing it. Do not accidentally cause PROD migrations on feature branches or on an unapproved `main` push.
- Any migration workflow change must retain target identity, checksum/order validation, additive/destructive SQL policy, protected environment, explicit approval and non-cancelling concurrency.

### 8.4 Deployment workflow

The deployment pipeline should support:

1. Select an approved release SHA.
2. Verify all required checks passed on that exact SHA.
3. Build or retrieve immutable images.
4. Produce SBOM/provenance if supported by existing tooling.
5. Run pre-deployment checks and verify target environment identity.
6. Confirm backup/restore readiness and migration plan.
7. Obtain protected environment approval.
8. Apply only approved migrations, if any.
9. Deploy images/configuration.
10. Wait for container and application readiness.
11. Run smoke tests.
12. Confirm key customer/admin routes and external service capability.
13. Mark release successful or rollback application images.
14. Record SHA, image digests, migration state, health checks and operator approval.

Do not run migrations automatically in every container start or restart.

---

## 9. Production database, backup and recovery readiness

### 9.1 Before any PROD change

Read-only inspection first:

- Confirm Supabase project ref and region.
- Confirm database identity without printing credentials.
- Inspect migration ledger, checksums, ordering and pending state.
- Inspect pgvector and AI schema requirements.
- Inspect runtime/migration/AI/media role grants.
- Inspect connection pooler mode and TLS verification.
- Confirm backup plan and last successful backup.
- Confirm restore procedure and whether restore can be performed without destructive impact.
- Confirm application/schema compatibility for the exact release.

### 9.2 Backup/restore acceptance

The task must document:

- What is backed up (database, storage assets, AI artifacts/index manifest, deployment configuration).
- Where backups are stored and who can access them.
- Retention and cost.
- Encryption and access control.
- Restore procedure.
- Recovery point/time expectations.
- A safe restore verification method (prefer isolated/non-PROD target).
- How to recover from a failed migration versus an application rollback.

Do not claim backup readiness from a provider badge alone. Verify the actual backup state and a credible restore path.

### 9.3 Migration policy

- Review all pending Prisma migrations.
- Require backward-compatible expand/contract where appropriate.
- Separate schema deployment from application deployment.
- Do not automatically seed production.
- Do not run destructive SQL without explicit review and backup/restore plan.
- A migration failure blocks deployment until reconciled.
- Never use `prisma db push` as a production release substitute.

---

## 10. Security hardening

### 10.1 Ubuntu / SSH / firewall

- Use a supported Ubuntu LTS image selected from the current DigitalOcean catalog.
- Create a non-root deployment/operator account with narrowly scoped sudo.
- Use SSH keys; disable password SSH only after key login is verified.
- Restrict SSH source IP where practical; preserve a tested recovery path.
- Configure UFW/cloud firewall to allow only SSH, HTTP and HTTPS as required.
- Do not expose PostgreSQL, Redis, Express, FastAPI, worker or debug ports publicly.
- Apply security updates and document unattended update/reboot behavior.
- Configure time synchronization.
- Set sane file permissions and log rotation.
- Avoid Docker group membership as a casual privilege shortcut; Docker daemon access is effectively root.
- Keep a recovery/console access plan.

### 10.2 Docker and host security

- Non-root containers.
- Minimal capabilities.
- No privileged containers.
- No unnecessary host mounts.
- No host Docker socket inside application containers.
- Read-only model artifacts.
- Resource limits.
- Image/dependency scanning.
- Pin versions and patch cadence.
- Secrets only at runtime.
- Separate networks and service accounts.

### 10.3 Application security

- Secure cookies behind TLS and correct proxy configuration.
- Correct CORS, CSRF/origin protections and OAuth callback validation.
- JWT/refresh-token secrets unique to PROD and strong random values.
- Admin MFA and backend RBAC remain authoritative.
- Rate limiting and input validation.
- Upload validation and size/pixel limits.
- No secrets in logs, traces, HAR files, screenshots or error responses.
- No public Swagger/OpenAPI docs in production unless specifically approved.
- No DEV debug routes or seed/provisioning routes in production.

### 10.4 Production administrator bootstrap

Production must not ship with a published default administrator username/password.

Use a **one-time, operator-authorized bootstrap invitation** only when no administrator has been provisioned:

- Verify the PROD administrator count/identity through a safe read-only check.
- If an administrator already exists, bootstrap is unavailable and cannot create another initial owner.
- If none exists, an authorized operator explicitly initiates a one-time invitation/setup flow.
- Invitation is random, short-lived, single-use, securely stored/hashed, and bound to the intended initial owner.
- The initial administrator sets their own password and completes required MFA.
- Record the bootstrap event without logging the token or password.
- Disable/revoke bootstrap after successful provisioning.
- No default credentials, shared demo passwords or seeded development administrators.
- Remove/verify absence of DEV test accounts from PROD, specifically `admin@electrohub.com`, plus any other development/test administrator identities discovered.
- Never delete accounts based only on a guessed email list; inspect and obtain operator confirmation before any PROD account deletion.

---

## 11. Performance and small-audience validation

### 11.1 Performance baseline

Collect current DEV baseline and then production-topology measurements.

Focus on:

- local-to-Seoul Supabase latency as a diagnostic reference;
- actual VPS-to-Supabase latency;
- API p50/p95 for product listing, search, recommendations, account/order reads and store settings;
- frontend route load, LCP/CLS where reliably measurable, asset sizes and loading skeleton duration;
- checkout and Stripe Payment Element load/initialization time;
- Socket.IO connection and event propagation;
- AI cold-start, model load time, inference p50/p95 and memory;
- email outbox enqueue-to-provider-acceptance latency;
- push dispatch latency where a real subscription exists.

Do not rewrite refresh-token logic or unrelated business queries without evidence.

### 11.2 Response-time budgets

Before implementation, inspect existing documented performance budgets and Task 06.2 measurements. Reuse approved thresholds if they exist.

If no approved target exists, propose explicit initial small-audience thresholds, explain methodology, and obtain user approval before treating them as release gates. Suggested candidates for discussion (not automatic guarantees):

- API ordinary read p95: <= 800 ms from a geographically representative client, excluding third-party/provider delays.
- Backend-to-database read p95: <= 250 ms on the selected production topology, subject to measured baseline and query class.
- Frontend key route LCP: <= 3.0 s on a defined test profile.
- Checkout Payment Element ready: <= 3.0 s after the required Stripe script/network path is available.
- Socket.IO delivery-state event: <= 1.0 s under the small test load.
- AI image search/recommendations: define separate cold/warm budgets based on model size and actual CPU capacity.

Do not use one sample as proof. Record repeated samples, warm/cold conditions, region, device/network, sample count and percentiles.

### 11.3 Small-user load test

Initial target is a very small portfolio audience, not 100 simultaneous users.

- Agree a low initial concurrency target (for example 3–5 concurrent virtual users) before running tests.
- Use synthetic test identities and non-financial workflows.
- Test browse/search/product detail/cart/account/order reads, admin read-only views, Socket.IO connections and AI read requests within safe quotas.
- Use Stripe Test Mode and isolated test orders only if the exact test procedure is authorized.
- Never run load tests against real customer email addresses or bulk-send email/push.
- Never stress PROD database or provider APIs without explicit approval and rate limits.
- Record CPU, memory, swap, container restarts, connection counts, API p50/p95, error rates and DB latency.
- If the $6 server cannot sustain the required features, report the capacity limitation. Do not claim 100-user readiness.

---

## 12. UX and customer/admin acceptance strategy

Deployment must preserve the existing product UX and all implemented features.

### 12.1 Customer journeys

Validate the real deployed site for:

1. Public home page, navigation, search and browser tab icon.
2. Product listing, filters, sorting, product detail and image loading.
3. Image search and graceful unavailable/error behavior.
4. Recommendations and personalized recommendations where consent/configuration allows.
5. Guest cart/wishlist and signed-in cart/wishlist reconciliation.
6. Customer registration, login, logout, refresh, Google OAuth if enabled, and account recovery.
7. Account profile, preferences, privacy/cookie controls and notification settings.
8. Checkout form and Stripe Test Mode Payment Element.
9. Successful and declined Test Mode payment outcomes.
10. Order creation, order history and order detail.
11. PDF invoice/receipt download and ownership checks.
12. Admin-driven order status transition to Out for Delivery.
13. Out-for-delivery email to the customer's actual order email, with a working View Your Order button.
14. Browser push notification when the customer tab is closed, where browser/platform push support is available.
15. In-app real-time update while the customer is online.
16. Delivery tracking map, ETA/location privacy and final Delivered state.
17. Refresh/deep links, responsive behavior, keyboard/focus, reduced motion, loading skeletons, empty/error/offline states.

### 12.2 Administrator journeys

Validate:

- Admin login, MFA and role authorization.
- Initial one-time bootstrap only when no administrator exists.
- Dashboard and analytics reads.
- Product/category creation/update and image management.
- Inventory changes and low/out-of-stock restrictions.
- Order review and permitted status transitions.
- Delivery dispatch/tracking state and customer notification triggers.
- Customer account visibility with privacy constraints.
- Settings, logs and operational health visibility.
- Protected routes and expected 401/403 responses without credentials.
- No DEV test admin identity in PROD.

### 12.3 UX quality rules

- Do not introduce localhost or internal service URLs in visible UI, email, push payloads or browser network calls.
- Loading skeletons should reflect actual route/data loading and not mask long waits indefinitely.
- Errors must explain recoverable action without exposing internal details.
- Payment form must not be blocked by unrelated slow recommendations or AI requests.
- Customer and admin experiences must remain usable when AI is degraded.
- Email and push failures must be visible operationally and must not falsify order status.
- Browser push is not equivalent to Socket.IO; verify closed-tab behavior separately.
- Keep existing Task 06.2 accessibility baseline and browser test matrix.

---

## 13. Milestones and work packages

Milestones are ordered to reduce rework. Each milestone has a narrow outcome and a stop/go gate.

### M0 — Repository and release baseline

**Work**
- Verify branch, HEAD, clean/dirty tree and Task 06.2 baseline.
- Inspect architecture, deployment docs, actual source and CI.
- Inventory services, Dockerfiles, existing workflows, env variables, workers, secrets, DB roles and AI artifacts.
- Identify missing files/configuration and conflicting assumptions.
- Reconcile the stale docs/09_Deployment/GITHUB_ACTIONS.md statement that infrastructure deployment is reserved for Task 06.4 with this task's explicit 06.3 scope. Preserve the Task 06.4 handoff boundary defined in M11.
- Produce baseline deployment topology and risk register.

**Acceptance**
- Work is on the existing `feature/06.3-production-infrastructure` branch.
- No user changes lost.
- Existing CI/security workflow behavior is documented.
- All required service boundaries and external dependencies are inventoried.
- No PROD writes or cloud resources created.

### M1 — Production topology, cost and region feasibility

**Work**
- Validate DigitalOcean free static site limits and $6 Droplet plan.
- Verify hostname/TLS approach for frontend and backend without buying a domain.
- Identify actual Supabase PROD region.
- Compare plausible DO regions with evidence; Singapore first candidate.
- Assess 1 GiB RAM feasibility using image sizes, model memory, service requirements and resource profiles.
- Decide whether App Platform frontend + Droplet API/AI topology can work.
- Document cost including egress, backups, snapshots, volumes, registry, email, tile provider and external services.

**Acceptance**
- No paid resource created.
- $0-first/$6-when-authorized policy documented.
- No domain purchase.
- Region recommendation has measured evidence or is explicitly provisional.
- 1 GiB limitations and HTTPS feasibility are explicit.

### M2 — Production configuration and environment separation

**Work**
- Create/update production environment templates and configuration validation.
- Audit frontend `.env.example`, local `.env`, `.env.local` ignore behavior.
- Audit backend and AI env templates.
- Create secret inventory and mapping between runtime env, GitHub Actions secrets, App Platform build variables and VPS files.
- Remove localhost defaults from production-specific config only.
- Validate production origin generation and email/Stripe/OAuth/Socket.IO URL construction.
- Add tests that production rejects localhost and DEV origins for public URLs where required.
- Add tests that Vite bundles cannot contain server secrets.

**Acceptance**
- `.env.example` files are safe and documented.
- Real `.env` and `.env.local` remain ignored and uncommitted.
- No PROD secret appears in repository or artifacts.
- Frontend only receives public values.
- Backend/AI secret separation is enforced.
- Production URLs are validated as HTTPS public origins.

### M3 — Docker production images and Compose

**Work**
- Review/fix frontend, backend and AI Dockerfiles.
- Add production-specific Compose configuration.
- Use repository-root build context for apps/frontend/Dockerfile and apps/backend/Dockerfile, which copy root workspace manifests and lockfile. The current docker-compose.yml uses app-subdirectory contexts and maps host port 3000 to container port 3000 although the frontend Nginx image listens on port 80. Correct these in the relevant Compose configuration and retain root .dockerignore protections (or prove package-local equivalents).
- Add `.dockerignore` files at correct build contexts.
- Configure internal networking, health checks, graceful shutdown, non-root, limits, restart policies, read-only artifacts and volumes.
- Keep DB external.
- Keep Redis omitted unless justified.
- Keep worker process roles separate and gated.
- Add reproducible image build/smoke tests to CI.

**Acceptance**
- All required images build from clean checkout.
- No secrets in image layers.
- Containers run as intended users.
- Only public entrypoint is exposed.
- Health/readiness tests work.
- Production Compose does not inherit localhost URLs or dev-only settings.
- No migration is run on every container restart.

### M4 — Nginx, HTTPS, hostname and routing

**Work**
- Implement Nginx config for frontend/API/Socket.IO according to selected topology.
- Resolve the audit-derived origin/authentication compatibility gate in section 3.1 before exposing customer/admin sessions. CORS configuration alone does not prove cross-site refresh-cookie behavior.
- Validate SPA deep links.
- Validate API proxy, WebSocket upgrade, upload limits, timeouts, compression/cache policy and headers.
- Implement no-domain HTTPS plan: App Platform automatic TLS for frontend; verified free hostname or automated short-lived IP certificate for VPS API.
- Implement certificate renewal/reload/monitoring/recovery.
- Build origin matrix for CORS, OAuth, Stripe, email, push and browser URLs.

**Acceptance**
- No browser-facing production HTTP or localhost.
- Valid HTTPS certificate and renewal mechanism.
- HTTP redirect works.
- Socket.IO secure handshake and reconnect work.
- Internal AI/DB/worker ports remain private.
- Certificate renewal is tested or task remains explicitly blocked.

### M5 — Supabase PROD readiness, migrations, backups and roles

**Work**
- Verify project identity, region, schema, migration ledger and checksums read-only.
- Verify Prisma runtime role, migration authority, AI vector reader, media worker role and pgvector schema.
- Verify TLS and connection pooler.
- Verify backup state and restore procedure.
- Review pending migrations and compatibility.
- Implement controlled migration pre/post checks if missing.
- No migration executes without user-approved release window and backup readiness.

**Acceptance**
- Exact PROD target is verified.
- Migration plan reviewed.
- Backup/restore readiness evidenced.
- Roles least-privilege.
- No DEV data/seed/test accounts copied.
- No migration executed without explicit authorization.

### M6 — Production AI model and vector release preparation

**Work**
- Inventory exact model/relevance artifacts and checksums.
- Prepare read-only artifact mount and AI manifest.
- Verify production schema/role readiness.
- Build PROD vectors from actual eligible PROD product media and IDs through approved Task 04.3/AI ingestion path.
- Validate completeness, quality, model/index compatibility, product resolution and latency.
- Prepare activation/rollback sequence.
- Ensure degraded AI behavior does not break core commerce.

**Acceptance**
- Manifest complete and tied to release SHA.
- No DEV vector copy.
- PROD index built/verified or explicitly blocked.
- Model activation is controlled and reversible.
- AI API is private and least-privilege.
- Media synchronization uses existing Task 04.3 workflow.

### M7 — External services and durable workers

**Work**
- Configure Stripe Test Mode frontend/backend/webhook and exact hosted signing secret.
- Configure Brevo sender, transactional email and public email origin.
- Configure email outbox worker and customer-recipient policy.
- Configure push VAPID/subscription/dispatch with explicit approval.
- Configure Supabase Storage PROD and approved reused product image assets.
- Choose and configure production map tile provider under approved budget.
- Configure payment supervisor, email/push dispatch and media worker according to their individual authorization models.
- Verify Socket.IO through Nginx.

**Acceptance**
- Stripe keys are Test Mode only.
- Webhook signatures verified for deployed endpoint.
- Email provider acceptance and customer CTA link verified with controlled recipients.
- Push subscription and real delivery tested separately; closed-tab behavior documented.
- Existing image assets load from intended production storage.
- Maps have approved provider/attribution/limits.
- Required workers are healthy and authorized; none bypasses existing safety controls.

### M8 — Free App Platform static frontend deployment

**Work**
- Connect GitHub repository.
- Use the dedicated task branch only after reviewed build configuration.
- Configure monorepo root/build command/output directory based on actual workspace requirements.
- Configure public production Vite variables.
- Disable autodeploy until release policy is approved.
- Deploy free static site and verify generated hostname, automatic HTTPS, CDN/cache, SPA routing, browser icon and public pages.
- Verify egress usage and free-tier limits.

**Acceptance**
- No paid component created.
- No domain purchased.
- No auto deployment from arbitrary pushes.
- Frontend loads with valid HTTPS and correct production API URL (API may remain blocked until M9).
- No secret in frontend bundle.
- This milestone is labeled frontend-only until all dependencies are deployed.

### M9 — Operator-authorized $6 VPS experiment and deployment

**Precondition**
- M0–M8 are accepted to the extent applicable.
- Deployment readiness report is reviewed.
- Region and TLS strategy are verified.
- User receives exact price, plan, region, resource limits and possible additional charges.
- User explicitly authorizes creation.

**Work**
- Create one $6 Basic Droplet, 1 vCPU/1 GiB/25 GiB.
- Configure Ubuntu, SSH, firewall, non-root deployment user and updates.
- Configure TLS/hostname for public API.
- Install Docker Engine and Compose plugin from official sources.
- Deploy exact approved images and production Compose.
- Configure protected runtime env files.
- Connect to Supabase PROD with TLS and verified role.
- Configure Nginx, health checks and log rotation.
- Start required services in dependency order.
- Do not start any worker before its own target/authorization preflight passes.

**Acceptance**
- User-authorized single Droplet only.
- No add-ons.
- API and AI services reachable only through intended routes.
- Backend-to-DB and backend-to-AI readiness pass.
- Payment/email/push workers are individually authorized.
- Container resource usage is measured.
- No feature is silently disabled.

### M10 — Production smoke, performance and small-user validation

**Work**
- Run read-only health checks.
- Run controlled synthetic customer/admin workflows.
- Verify auth, product browsing, cart, checkout Test Mode, order, delivery status, email, push, Socket.IO, AI, storage, PDF, maps and admin capabilities.
- Run small concurrency test after explicit approval and safe limits.
- Measure p50/p95 and resource usage.
- Verify browser tab icon, deep links, loading skeletons, responsive/accessibility behavior.
- Verify no test accounts or default admin credentials in PROD.
- Verify all public links and URLs are non-localhost.
- Test application rollback to prior immutable image; do not reverse destructive DB migrations without an explicit plan.

**Acceptance**
- Required features are working or explicitly classified as blocked with evidence.
- No live Stripe keys or charges.
- No bulk email/push test.
- Performance report is reproducible.
- Rollback procedure verified.
- User-visible UX is usable for the agreed small audience.

### M11 — Handoff, cost cleanup and Task 06.4 boundary

**Work**
- Record final branch SHA, images/digests, hostnames, region, migration state, AI manifest, CI run links, smoke tests, performance, limitations and rollback.
- Preserve only safe evidence; redact all secrets and customer data.
- Review DigitalOcean billing resources.
- If no extension is approved, back up required non-ephemeral deployment evidence, destroy the Droplet, and verify backups/snapshots/volumes/reserved resources are removed or intentionally retained with explicit cost approval.
- Keep the free static frontend only if still desired and within free-tier limits.
- Document exact next steps for Task 06.4.

**Acceptance**
- Cost state verified.
- No powered-off Droplet left billing.
- No unapproved billable resources remain.
- Evidence and backup requirements satisfied.
- No merge to `develop` or `main` performed by the agent.
- Task 06.4 scope remains separate.

---

## 14. Release acceptance matrix

| Area | Required proof | Failure classification |
|---|---|---|
| Frontend | Production build, HTTPS, SPA routes, favicon, no secret leakage | Block if storefront inaccessible |
| Backend | Liveness/readiness, auth, API smoke, DB connection | Block core commerce if unavailable |
| Database | Verified PROD identity, schema, role, TLS, backup/migration state | Block writes/deployment if uncertain |
| AI | Exact artifact manifest, PROD vector compatibility, health/readiness | AI feature blocked; core commerce must remain available |
| Stripe | Test Mode keys, webhook signature, test payment lifecycle | Block checkout acceptance if unavailable |
| Brevo | Provider acceptance, template/link and outbox worker | Block transactional-email acceptance if unavailable |
| Push | Real subscription, persisted endpoint, real provider/browser delivery | Do not claim push active without proof |
| Socket.IO | Secure handshake, auth, event authorization, reconnect | Block real-time acceptance if unavailable |
| Storage | Correct PROD project/bucket, image load and access policy | Block media acceptance if unavailable |
| Maps | Approved tile provider, attribution, CSP and quota | Mark map capability blocked if no approved provider |
| Workers | Ownership, authorization, health, backlog and drain | Block dependent feature if worker unavailable |
| Security | Host, Docker, Nginx, secrets, roles, cookies, OAuth, admin bootstrap | Block on critical/high risk |
| CI/CD | Exact SHA, required gate, protected deploy, rollback | Block release if required gate not green |
| Performance | Repeated p50/p95 and resource report | Block or formally accept explicit risk |
| Cost | $0 until approval, $6 one-month cap, no orphan resources | Block provisioning on cost ambiguity |

---

## 15. Existing test and verification tools to reuse

Do not replace existing tests with a new generic smoke suite. Inspect and reuse current scripts and workflows.

Root commands currently include:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:ci
npm run test:runtime
```

Frontend scripts include:

```bash
npm run test --workspace=apps/frontend
npm run test:release --workspace=apps/frontend
npm run test:quality --workspace=apps/frontend
npm run test:visual --workspace=apps/frontend
```

Backend scripts include:

```bash
npm run test --workspace=apps/backend
npm run test:ci --workspace=apps/backend
npm run typecheck --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm run test:release:db --workspace=apps/backend
npm run test:release:stack --workspace=apps/backend
```

AI service:
- `pytest` against `apps/ai-service/requirements.txt`
- runtime dependency validation from `requirements-runtime.txt`
- existing ruff/format/mypy/pip-audit tools where configured
- Docker health check and model/index readiness tests.

Workflow policy:
```bash
node --test .github/scripts/*.test.cjs
node .github/scripts/check-workflow-policy.cjs
```

Playwright:
- Chromium, Firefox and WebKit release projects.
- Responsive 320/390/768/1024/1920 projects where configured.
- Notification browser QA.
- Accessibility/keyboard/reduced-motion/native-zoom tests.
- Real release E2E against disposable PostgreSQL.
- Do not confuse mocked/intercepted payment UI tests with actual Stripe Test Mode proof.

Infrastructure checks to add/reuse:
- Docker build and smoke tests for all services.
- Compose config validation.
- Nginx config validation.
- TLS/HTTPS/certificate renewal checks.
- Production env schema tests.
- Public-origin/localhost rejection tests.
- Secret-leak scanning for images and frontend build.
- Health/readiness and worker-authorization tests.
- AI manifest/index compatibility tests.
- Deployment exact-SHA and rollback tests.
- Database migration plan/policy tests.

Use risk-based verification. Do not rerun unrelated exhaustive suites when existing exact-SHA CI evidence is credible. Do not ask for repeated evidence that does not reduce a material risk.

---

## 16. Required documentation and deliverables

Update/create only files justified by the implementation and keep docs synchronized with actual behavior.

Expected deliverables include:

- This task specification.
- A production deployment topology diagram.
- Production environment/secret inventory and mapping.
- Production Compose and Dockerfiles.
- Nginx configuration and TLS/renewal runbook.
- DigitalOcean App Platform static-site setup guide with exact monorepo build configuration.
- VPS bootstrap/hardening/deployment runbook.
- Supabase PROD migration/backup/restore checklist.
- AI production release manifest schema and deployment/activation/rollback runbook.
- Stripe Test Mode hosted webhook setup and verification guide.
- Brevo sender, transactional email and outbox worker runbook.
- Push subscription/delivery verification runbook.
- Socket.IO production proxy verification.
- Map tile provider decision and attribution/quota record.
- CI/CD deployment workflow and GitHub Secrets/Environment inventory.
- Production smoke test and performance report.
- Rollback and VPS destruction/cost cleanup runbook.
- Task 06.3 implementation evidence/handoff.
- Task 06.4 follow-up boundary and remaining release checklist.

Do not create fake screenshots or claim dashboard configuration without actual operator action. Record manual DigitalOcean steps for the user and wait for their confirmation at purchase/irreversible steps.

---

## 17. Operator decisions and authorization gates

The implementation agent may prepare configuration and instructions, but must stop and ask the user before:

- Creating a Droplet or any paid resource.
- Selecting a region when measurements are inconclusive.
- Enabling a paid App Platform component or exceeding free bandwidth.
- Purchasing a domain, DNS, certificate, storage, backup, volume, load balancer, Redis or monitoring plan.
- Applying a PROD database migration or changing schema/roles.
- Restoring or modifying PROD data.
- Copying media into PROD if it changes existing PROD objects or records.
- Building/activating the PROD vector index if the operation mutates production state.
- Enabling production email or push dispatch.
- Registering/changing Stripe webhook destinations or provider credentials.
- Enabling a new Google OAuth publication/testing mode.
- Deleting or modifying administrator/customer accounts.
- Running load tests that may affect PROD or provider quotas.
- Extending the VPS beyond the one-month initial experiment.
- Merging into `develop`/`main`, changing default branch or deploying a `main` release.

Approval must be explicit and scoped to the specific action. A general instruction to implement Task 06.3 is not approval for all external side effects.

---

## 18. Definition of Done

Task 06.3 can be recommended for approval only when:

- [ ] Repository and existing branch were inspected before edits.
- [ ] Work is confined to `feature/06.3-production-infrastructure`.
- [ ] Task 06.2 remains closed and unchanged.
- [ ] All frontend/backend/database/AI/infrastructure boundaries are documented and implemented as required.
- [ ] Production configuration has no localhost/DEV origins in browser-facing or customer-facing URLs.
- [ ] Local `.env` and `.env.local` remain ignored and uncommitted; `.env.example` is safe.
- [ ] GitHub Actions workflow parity for `develop` and `main` is verified.
- [ ] CI uses exact SHA and disposable DBs; no accidental PROD side effects.
- [ ] Docker images build and pass smoke checks.
- [ ] Production Compose is secure, private-networked and resource-bounded.
- [ ] Nginx, public HTTPS and certificate renewal are verified.
- [ ] Supabase PROD identity, region, schema, roles, TLS, backups and migration plan are verified.
- [ ] AI artifacts and PROD index are compatible, or activation is explicitly blocked with a reason.
- [ ] Stripe Test Mode only is enforced and hosted webhook is verified.
- [ ] Brevo sender and required customer email workflows are verified.
- [ ] Push subscription and delivery claims are backed by real evidence.
- [ ] Socket.IO, storage, maps and workers are verified or explicitly blocked.
- [ ] Production admin bootstrap is one-time/operator-authorized and no default credentials exist.
- [ ] DEV admin/test accounts are absent from PROD; no unapproved deletion occurred.
- [ ] Customer and admin UX smoke journeys pass.
- [ ] Performance and small-audience capacity report is recorded.
- [ ] Rollback path is documented and tested where safe.
- [ ] Cost policy is respected; no unapproved resource exists.
- [ ] If a Droplet was created, its final billing state and separately billable resources are verified.
- [ ] Implementation evidence records exact SHA, test commands/results, manual steps, limitations and residual risks.
- [ ] No task merge or main deployment occurred without user authorization.

A free static frontend alone does not satisfy this definition of done.

---

## 19. Task boundary and handoff to 06.4

Task 06.3 owns infrastructure preparation, production configuration, deployment mechanisms, controlled provisioning, initial production deployment and infrastructure-level health/rollback readiness.

Task 06.4 remains responsible for the final release-validation and documentation completion scope defined by the current roadmap. Do not absorb or prematurely mark 06.4 complete inside 06.3.

The 06.3 handoff must provide:

- Exact release SHA and branch.
- Current deployment state and public hostnames (no secrets).
- Infrastructure/cost state.
- Production database migration/backup state.
- AI model/index manifest and activation state.
- External provider status.
- CI and smoke-test evidence.
- Performance/capacity report.
- Known limitations and accepted risks.
- Rollback and recovery instructions.
- Remaining 06.4 actions.

---

## 20. Architecture principles

1. **No localhost in production:** browser URLs, email links, OAuth callbacks, webhooks and public service URLs must use actual public HTTPS origins.
2. **No secrets in frontend:** Vite variables are public.
3. **Backend owns commerce authority:** AI never owns authentication, pricing, inventory, payment or order state.
4. **PROD is not DEV:** no DEV DB rows, admin users, embeddings or operational state are copied into PROD.
5. **AI release is code + artifacts + production index:** compatibility must be proven.
6. **Workers are explicitly authorized:** restart policies do not grant permission.
7. **No hidden costs:** user approves every paid resource.
8. **No domain purchase:** provider-generated frontend hostname and verified no-cost API TLS strategy.
9. **No Live payments:** Stripe Test Mode only.
10. **Measure before optimizing:** region, database, API, frontend, AI and capacity decisions need repeatable evidence.
11. **No silent feature removal:** report blocked functionality honestly.
12. **Rollback is part of deployment:** every release has a known prior image/config and migration recovery plan.
13. **Security before convenience:** no TLS bypass, default admin, public internal port or broad database role.
14. **Portfolio-scale, production-quality:** keep the system small and understandable, but preserve correct security and reliability boundaries.

> **Final objective:** deliver the strongest responsible first production-style handoff for ElectroHub within the approved $0-first / optional $6 one-month experiment budget, without pretending that an undersized server or a public frontend alone proves the complete application is production-ready.
