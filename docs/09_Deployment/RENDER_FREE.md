# Render Free Deployment Investigation

## 1. Status

**Current status: PREPARATION AND FEASIBILITY ONLY.**

The selected target is Render Free with a recurring infrastructure budget of **$0/month**. This document does not authorize resource creation, account changes, paid upgrades, deployments, provider actions, domain purchases, migrations or secret changes.

Previous DigitalOcean VPS plans are obsolete. Existing historical documents describe work and decisions, not an active Render deployment.

## 2. Zero-cost guardrails

- Do not add a payment method.
- Do not enable paid compute or add-ons.
- Do not create Render Postgres or Key Value unless an approved paid or later migration decision changes the architecture.
- Do not use persistent disks.
- Do not use artificial traffic or keep-alive requests to defeat service sleep.
- Do not promise 24/7 uptime or 100-concurrent-user capacity.
- Stop if Render requires billing details or a paid upgrade before the requested free resource can be created.
- Existing Supabase, Stripe, Brevo, maps, domain, email or other external-service charges remain separate from the $0 Render hosting target.

## 3. Verified Render constraints

These constraints were checked against official Render documentation in 2026-11-23:

- Free web services: 0.1 CPU, 512 MB RAM.
- Free web services spin down after 15 minutes without inbound HTTP or WebSocket traffic and normally take about one minute to wake.
- Filesystems are ephemeral; restarts and redeploys lose local files.
- Persistent disks and scaling beyond one instance are unavailable on Free web services.
- Render may restart a Free service at any time.
- A workspace receives 750 Free instance hours per calendar month across its active Free web services. Spun-down services do not consume instance hours. Once exhausted, Render suspends Free web services until the next month.
- Static sites, web services and builds share relevant workspace outbound-bandwidth/build-pipeline usage. A no-payment-method workspace can be suspended or disabled after included usage is exceeded.
- Free web services cannot receive private network traffic; they can send private traffic to Render data stores or paid services in the same region.
- Ports 25, 465 and 587 are blocked for outbound SMTP. HTTPS APIs must be used.
- Free Render Postgres expires after 30 days, has no backups or managed pooling, and is not a replacement for existing Supabase.
- Free Render Key Value is in-memory and loses state on restart. It must not hold authoritative application state.

Official references:

- https://render.com/docs/free
- https://render.com/docs/compute-plans
- https://render.com/docs/outbound-bandwidth
- https://render.com/docs/faq
- https://render.com/pricing

Pricing and workspace eligibility must be rechecked before resource creation because both can change.

## 4. Repository deployment facts

- Frontend: `apps/frontend`, Vite 6 build via `npm run build --workspace=apps/frontend`; output is `apps/frontend/dist`.
- Backend: `apps/backend`, Express/Socket.IO build via `npm run build --workspace=apps/backend`; start via `npm run start --workspace=apps/backend` (`node dist/bootstrap.js`). It reads `PORT` and has SIGTERM/SIGINT graceful shutdown.
- AI: `apps/ai-service`, Python 3.11+, CPU-only Torch runtime, ASGI entrypoint `python -m app`, liveness `/health`, and configurable `AI_PORT`/`AI_BIND_HOST`.
- Render Static Sites have no server-side runtime.
- The backend currently exposes `/health`, `/health/ready`, `/ready`, and Socket.IO `/delivery` on the same HTTP server.
- The frontend uses relative `/api` and `/socket.io` Vite development proxies; production origin behavior is topology-dependent.

## 5. Candidate topology

### Option A - separate services

- Render Static Site: frontend.
- Render Free Web Service: Express backend.
- Render Free Web Service: FastAPI AI service.

This is the most isolated option, but three free web services share the 750-hour workspace allowance. Their independent 15-minute idle timers and 512 MB RAM limits can create repeated cold starts and make the AI service a likely feasibility blocker.

The backend and AI service require public URLs under this option because Free web services cannot receive private network traffic. The AI URL must use HTTPS and strong AI-service authentication.

### Option B - combined Node origin

- One Render Node Web Service serves the built frontend and Express API, ideally after repository code proves safe static serving and SPA fallback.
- FastAPI remains a second Free web service only if enough allowance and memory remain.

This reduces frontend/backend cross-origin cookie and OAuth concerns, but it is not currently demonstrated by repository routing and requires implementation validation.

### Option C - combined runtime

A shell supervisor would combine multiple application processes in one container/process group. It is not selected because the repository does not document a Render-safe supervisor arrangement and resource/failure isolation would be poor.

### Recommended investigation result

**Option B, backend-hosted static build, is the preferred topology to investigate first**, because it removes separate-origin frontend/cookie complexity and preserves a separate AI service boundary. It is only viable if Express can safely serve `apps/frontend/dist`, SPA fallback, assets and API/Socket.IO routes and if the 512 MB Node process has enough memory.

**If FastAPI cannot start, stay warm or fit in 512 MB, no $0 complete topology is currently feasible.** The service must not be silently mocked or disabled while the catalog is described as fully deployed.

## 6. Supabase and region

Continue using existing production Supabase. Do not create or migrate to Render Postgres.

The next implementation agent must verify:

- actual production project identity and region;
- pooled versus direct Prisma connection and TLS certificates;
- pending migrations without applying them;
- pgvector tables/indexes and restricted AI roles;
- backup/export readiness;
- latency from candidate Render regions;
- production administrator provisioning state.

The chosen backend region should be evidence-based from measured Supabase latency. Do not assume a region.

## 7. AI feasibility

FastAPI imports CPU Torch, Torchvision, Pillow, NumPy, safetensors and psycopg. Model artifacts and relevance-head files are loaded into one process. The 512 MB Free limit is not sufficient to assume startup and inference will succeed.

Required evidence:

- measured RSS during startup and representative inference;
- artifact size and checksum;
- startup time and cold-start timeout;
- successful `/health` and readiness behavior;
- Supabase vector-index readiness;
- Express-to-FastAPI authentication and timeout behavior;
- no commerce credentials or database credentials in the AI process beyond approved AI variables.

## 8. External integrations

### Stripe

Payments remain Stripe Test Mode. `pk_test_*` belongs in the frontend only; `sk_test_*` and the hosted endpoint webhook secret belong in Express runtime secrets. The hosted webhook endpoint may only be created after explicit operator approval and an accessible backend URL.

### Brevo

Production email must use Brevo HTTPS API. Render Free blocks SMTP ports 25, 465 and 587. No real email or allowlist expansion is authorized by this documentation task.

### OAuth, cookies and WebSockets

Frontend and API origins must be explicit. OAuth callback and WebAuthn origins must match HTTPS public origins. Socket.IO must share the backend origin or have credentialed CORS and allowlist configuration. Browser cookies require production `secure` and deliberate `sameSite` settings.

### Redis

No Redis is required solely because of the old VPS plan. Redis is needed only if the implementation has shared state, multi-instance scaling or durable queues that cannot run in one instance. Render Free Key Value is ephemeral and unsuitable for authoritative state.

## 9. Production status

STRICT NO-GO for deployment and production activation. Complete $0 deployment feasibility is **NOT VERIFIED** until real Render account eligibility, measured resources, hosted URLs and hosted smoke evidence exist.
