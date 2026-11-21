# Task 06.3 Repository Implementation Evidence

**Status: CONDITIONAL repository implementation; production release is NO-GO.** The deployment topology and browser-origin/session gate are unresolved. No application/API was exposed, no cloud resource was created, and no PROD system was accessed or changed.

## Task 06.3S current-SHA reconciliation

- **Historical implementation baseline:** `053a271ba36ebcf436720bdc6aa87c7bb79cf149`.
- **Reviewed Task 06.3 implementation baseline:** `9bccb69ec251dadb79b5bff893506e10f6d6fae7`.
- **Current repository SHA during this reconciliation:** `9bccb69ec251dadb79b5bff893506e10f6d6fae7`, before Task 06.3S remediation commits.
- The `053a271...` statements below describe historical evidence produced before the implementation commits and must not be rewritten as results for `9bccb69...`.
- Exact-SHA Development CI run `44914676778` and Security Audit run `44914676756` passed at `9bccb69...`.
- New Task 06.3S source and policy evidence is recorded in `TASK_06.3S_IMPLEMENTATION_EVIDENCE.md` after the remediation commit.
- Docker/Compose/Nginx runtime execution remains Linux-CI evidence, not local Windows evidence. Local Docker availability was unavailable during Task 06.3S preflight.

This report implements repository-side preparation under the approved task contract in `docs/tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT.md`. It uses `docs/09_Deployment/TASK_06.3_DEPLOYMENT_ARCHITECTURE_AUDIT.md` as discovery evidence and rechecked relevant source at the historical base, while Task 06.3S separately reconciles the live reviewed implementation. The revised draft adds the same-origin/session gate and clarifies free-tier cost and Compose context requirements; the textual comparison found additions and clarifications, not a material contradiction with the approved task. The approved task remains the acceptance contract.

## 1. Repository baseline and preservation

| Item | Observed state |
|---|---|
| Branch | `feature/06.3-production-infrastructure` |
| HEAD | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Local `develop` | Same SHA as HEAD |
| Merge base with `develop` | `053a271ba36ebcf436720bdc6aa87c7bb79cf149` |
| Local upstream ref | `origin/feature/06.3-production-infrastructure`, same SHA as HEAD |
| Task 06.2 | Its approved merge is an ancestor of this base; no Task 06.2 implementation was redone |
| Fresh remote state | NOT VERIFIED: `git ls-remote` could not resolve/connect to GitHub in this environment. Local remote-tracking refs may be stale. |
| Initial worktree | Tracked files clean. Three pre-existing untracked user documents were preserved untouched: the Task 06.3 architecture audit, approved task specification, and revised draft. |
| Current worktree | Repository changes listed below are uncommitted and unstaged. No reset, clean, stash, commit, push, merge, or branch creation was performed. |

The current change set is limited to Task 06.3 environment validation/templates, candidate production Compose/Nginx configuration, migration workflow safety, and deployment evidence/docs. The pre-existing untracked task/audit documents are not implementation changes.

## 2. Architecture and browser-origin decision

### Existing logical architecture

The prior deployment documentation (`docs/09_Deployment/DIGITALOCEAN.md`, “High-Level Architecture” and “VPS Responsibilities”; `docs/09_Deployment/PRODUCTION.md`, “Production Architecture”) describes a DigitalOcean VPS running the frontend, Express backend, FastAPI AI service, Docker and Nginx. Supabase PostgreSQL and Storage are external; Stripe is Test Mode; Brevo handles transactional email. This is an intended design, not evidence of an operational deployment.

The Task 06.3 $0-first candidate differs: a DigitalOcean App Platform static frontend plus an optional single $6 VPS for Express, private FastAPI, Nginx and explicitly selected worker profiles. The candidate split has not been accepted as viable. The new production Compose file is API-side only and does not serve the static frontend; it is not a second, fully working topology.

### Source-verified origin and session behavior

| Surface | Current implementation / proposed candidate | Verification status |
|---|---|---|
| Frontend | Candidate only: `https://<app>.ondigitalocean.app`; no app or exact hostname exists. Build output is `apps/frontend/dist`. | Build verified locally; hosting/deployment not verified. |
| Express API | No selected public origin. Candidate is a VPS public IP/hostname over HTTPS. | NOT VERIFIED. |
| REST client | `apps/frontend/src/lib/api.ts` issues relative `/api` requests and uses `credentials: 'include'`. Access tokens are in memory with customer/admin scope separation, bounded refresh retry, single-flight refresh and cross-document refresh locking. | Source inspected; no cross-origin browser session test. |
| Refresh/logout | Backend sets host-only HttpOnly refresh cookies with production `Secure`, `SameSite=Lax`, and scope-specific `/api/auth/{customer,admin}` paths. Refresh rotates tokens and handles reuse/concurrent rotation; logout revokes and clears. No cookie attributes or rotation behavior were changed. | Source/test coverage exists locally; browser matrix NOT run. |
| CSRF/origin checks | Express CORS uses the exact configured `FRONTEND_URL` with credentials. Cookie-authenticated sensitive flows have route-specific exact-Origin checks (including account deletion, Google linking and push writes); `SameSite=Lax` remains an additional cookie boundary. No global CSRF-token system was introduced. | Source inspected; no cross-site request test. Do not broaden origins or rely on third-party cookies without a reviewed design. |
| Socket.IO | Frontend currently connects relatively to namespace `/delivery`, path `/socket.io`, websocket then polling, and sends the access token in socket auth. Backend uses exact `FRONTEND_URL` CORS with credentials and verifies socket identity/authorization. The Socket.IO server does not configure Engine.IO `allowRequest` to independently reject an invalid `Origin` on websocket upgrades; token authentication remains enforced. | Source inspected; invalid-origin websocket negative test NOT run. |
| Google OAuth | Callback path is `/api/auth/google/callback`; production validation now requires callback origin to equal `FRONTEND_URL`. Transaction cookie is short-lived, host-only, HttpOnly, Secure in production and Lax. The flow includes random state, nonce, PKCE S256 verifier and signed transaction-cookie validation. | Source inspected; no provider callback or browser test. |
| Stripe webhook | `POST /api/webhooks/stripe` is on the API and verifies signed raw-body input. Requires the selected API HTTPS origin and Test Mode endpoint setup. | No Stripe endpoint/key configured or tested. |
| Brevo links | Generated links use `COMMERCE_EMAIL_ORIGIN`, falling back to `FRONTEND_URL`. Production validation now restricts either to canonical public HTTPS origins. | Code/config validation only; no email sent. |
| Browser push | Separate VAPID delivery is distinct from Socket.IO; worker dispatch and provider target remain disabled/unapproved. | No push sent. |
| Maps | Production tile URL/attribution are blank in the public template pending provider terms, attribution, quota and cost choice. | NOT VERIFIED. |
| FastAPI | Private Compose application network only, accessed by Express at `http://ai-service:8000`; it is not a public browser origin. | Source/config inspected; image/runtime not started. |

An App Platform-generated `ondigitalocean.app` hostname and a separate VPS IP/dynamic-DNS hostname are **cross-site** because they do not share a registrable domain. App Platform static hosting does not proxy `/api`, `/socket.io`, or `/api/auth/google/callback` to the VPS. With current `SameSite=Lax` cookies, cross-site credentialed fetches do not provide the needed refresh-cookie behavior. Switching to `SameSite=None` would still depend on third-party-cookie policy and would require explicit CSRF review and browser evidence. No API-origin client, CORS broadening, socket origin change, cookie change, or OAuth topology change was made.

### Browser/session matrix

| Engine / setting | Version | Customer/admin login | Refresh/rotation/reuse | Logout/reload/protected routes | OAuth | Socket auth/reconnect | Result |
|---|---|---|---|---|---|---|---|
| Chromium, normal cookie settings | Not recorded | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | UNVERIFIED: no assigned production-like origins |
| Chromium, third-party-cookie restricted/privacy setting | Not recorded | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | UNVERIFIED: no assigned production-like origins |
| Firefox, normal and privacy settings | Not recorded | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | UNVERIFIED: no assigned production-like origins |
| WebKit/Safari-equivalent, normal and privacy settings | Not recorded | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | UNVERIFIED: no assigned production-like origins |
| Negative CORS/cookie/socket cases | N/A | Unapproved Origin, absent credentials, wildcard CORS, HTTP/local/DEV/private origins and invalid websocket Origin tests NOT RUN | N/A | N/A | N/A | NOT RUN | UNVERIFIED |

No browser version is reported because no browser was launched for a localhost-only substitute. Such a run would not establish cookie behavior on the actual cross-site hostnames.

**Mandatory outcome: BLOCKED.** No actual public origins exist and no credible cross-site production-like Chromium, Firefox, WebKit/Safari-equivalent, or third-party-cookie-restricted session test was possible. Do not publish the static frontend or expose the API. Do not claim the split design is viable.

Options requiring owner choice:

1. **Keep the $0 constraint and hold public exposure.** Continue searching for a verifiable same-site/no-cost topology; until one exists, stop before deployment.
2. **Evaluate a single-origin VPS candidate.** Serve the frontend and API through Nginx on one approved VPS origin, retaining current cookie semantics. This gives up the free static-site plan and remains subject to explicit $6 Droplet approval, one-month cap and measured 1 GiB capacity. The current Compose file does not yet include the frontend, and no Droplet was created.
3. **Revisit cross-site auth/session architecture.** This needs a written security design and approval before changing auth/session/topology code, followed by full browser/privacy testing. `SameSite=None` alone is not a solution.

## 3. Configuration and secret boundaries

Implemented:

- `apps/backend/src/config/env.ts` syntactically validates production `FRONTEND_URL` and optional `COMMERCE_EMAIL_ORIGIN` as canonical HTTPS origins, rejects private/reserved IP literals and local/private-style/development hostnames, requires Google OAuth settings as a complete set with the exact frontend callback path, and rejects Stripe Live secret-key prefixes. This synchronous validator cannot prove public DNS ownership or that a public-looking hostname resolves only to public addresses; deployment preflight must verify that. `STRIPE_WEBHOOK_SECRET` format cannot prove endpoint Test Mode and still requires an operator dashboard check.
- `apps/backend/tests/env.test.ts` covers allowed/rejected origins, email origin, OAuth callback pairing and Test Mode Stripe secret-key prefixes.
- `apps/frontend/.env.example` no longer suggests a localhost API URL; it documents that `VITE_API_URL` is unused and the same-origin gate is unresolved. `apps/frontend/.env.production.example` contains public build values only, keeps image search off until approved artifacts are ready, and has no API-origin setting.
- Backend and AI templates separate API, payment worker, email/push worker, AI API and AI media-worker settings. All are safe placeholders, not deployable credentials. Worker templates disable email/push dispatch; payment/email/media workers are explicit Compose profiles and do not auto-start by default.
- `infrastructure/production/compose.env.example` contains only nonsecret Compose interpolation. Runtime secrets are expected outside the checkout under `/etc/electrohub` (or an explicitly selected external directory).
- `.gitignore` keeps `.env`, `.env.local`, other local variants, certificates, backups and local production state ignored while allowing tracked `*.example` templates. `git check-ignore` confirmed local frontend/backend `.env` and `.env.local` are ignored and examples are not ignored.
- The API and worker templates keep migration-only DB credentials out of containers. They use the same placeholder runtime role for `DATABASE_URL` and `DIRECT_URL`; actual grants, pooler choice, TLS chain, connection limits and role scope remain unverified.
- Product media uses `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_SECRET_KEY` (preferred) or the legacy `SUPABASE_SERVICE_ROLE_KEY` fallback, `PRODUCT_MEDIA_BUCKET`, and `PRODUCT_MEDIA_STORAGE_TIMEOUT_MS`. The production template now names these values and warns that the current integration’s effective Storage privileges must be operator-verified. Least privilege is not proven.
- The production admin bootstrap reuses `AdminInvitation` with an additive `isBootstrap` marker. Its only issuance entrypoint is `apps/backend/src/admin-bootstrap.cli.ts`: pinned PROD DB/Storage identifiers, explicit `ADMIN_BOOTSTRAP_ENABLED`, an interactive terminal, approval reference and typed project/recipient confirmation are required. It refuses any existing ADMIN and the known DEV seed admin addresses, stores only the token hash, expires in one hour, audits issuance/revocation, and grants the accepted first admin Owner/admin-management capability with required MFA enrollment. A partial unique index prevents concurrent pending bootstraps; acceptance rechecks that no ADMIN exists. No route, account, invitation, email or migration was executed against PROD.
- AI variables remain private: `AI_SERVICE_API_KEY`, `AI_VECTOR_DATABASE_URL`, `AI_MEDIA_WORKER_DATABASE_URL`, artifact directories and media storage URL belong only to their applicable AI process. GitHub migration secrets are only `ELECTROHUB_PROD_DATABASE_URL` and `ELECTROHUB_PROD_DIRECT_URL`, scoped by the workflow to `electrohub-prod-database`; no GitHub deployment secrets are configured by repository evidence.

### Secret inventory (names only)

| Destination | Names identified in code/templates | Status |
|---|---|---|
| App Platform public build | `VITE_IMAGE_SEARCH_ENABLED`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` | Public values only. No production values assigned. `VITE_API_URL` remains unused and unset. |
| Backend runtime | `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, optional `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `AI_SERVICE_API_KEY`, `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `DB_SSL_CA_CERT_PATH` | Templates only. No values collected or verified. |
| Worker env | Worker-local DB/auth decoys; payment `STRIPE_SECRET_KEY`; email `BREVO_API_KEY`; push `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`, approved-target values; AI media `AI_MEDIA_WORKER_DATABASE_URL` | Separate safe examples; delivery remains disabled/unapproved. |
| Operator bootstrap | `ADMIN_BOOTSTRAP_ENABLED` | Persistent template is `false`; temporary interactive override only after explicit operator approval. |
| AI API | `AI_SERVICE_API_KEY`, `AI_VECTOR_DATABASE_URL`, `AI_MODEL_ARTIFACT_DIR`, `AI_RELEVANCE_ARTIFACT_DIR` | Safe template; no artifacts or PROD vectors created. |
| GitHub production DB environment | `ELECTROHUB_PROD_DATABASE_URL`, `ELECTROHUB_PROD_DIRECT_URL` | Workflow references names only. Actual configured secrets and account-level environment protections were not inspected. |

No secret values were included in this report or printed by the frontend artifact scan.

## 4. Docker, Compose, Nginx and operations

- Existing Dockerfiles are retained. Root `.dockerignore` limits Node root-context builds to the root workspace manifests and frontend/backend apps while excluding `.git`, local env files, `node_modules`, build outputs, docs and caches. AI has a separate `apps/ai-service/.dockerignore` that excludes secrets, training data, model artifacts and development dependencies.
- New `infrastructure/production/compose.yaml` is separate from the development `docker-compose.yml`. Node images use repository-root context and correct Dockerfile paths; the AI image uses its app context. It defines API, private FastAPI, public Nginx, and opt-in payment/email/media worker profiles. Only Nginx publishes ports; API/AI/workers are unexposed on internal Compose networks. Migrations are not an entrypoint. CPU/memory limits have no assumed defaults and must be filled after profiling. No Compose services were started.
- The API Compose health check calls existing `/api/health/ready` (process plus PostgreSQL reachability); liveness is separately available at `/api/health`. AI Compose checks `/health` liveness only, not compatible model/index readiness. Worker health/readiness is not defined and must not be represented as ready just because a worker process exists.
- New `infrastructure/production/nginx.conf` is an API-only reverse proxy candidate: only ACME challenge files are served over HTTP; other HTTP redirects to HTTPS; `/api/` and `/socket.io/` proxy to Express with WebSocket upgrade, body limit and timeouts; docs/OpenAPI are blocked; other paths return 404. It has basic response headers and query-free access logging. Its catch-all HTTP redirect currently reflects `$host`; before exposure, configure the approved host and reject unknown Host values to avoid host-header redirect abuse. It is not the frontend SPA server and contains no certificate issuance/renewal/reload/expiry-monitoring mechanism. HSTS/CSP policy and browser/security-header verification remain release review items.
- Existing frontend Nginx (`apps/frontend/nginx.conf`) handles SPA fallback and hashed asset caching; the existing frontend container listens on port 80. The old development Compose configuration is not production-safe and remains unchanged.
- Graceful backend shutdown and readiness/liveness contracts already exist in the application. Existing payment recovery and email/push/media workers have authorization, idempotency/lease and target safeguards; profiles remain disabled. No provider dispatch was enabled.

Docker is not installed/available here. Production Docker image builds, image smoke tests, `docker compose config`, Nginx syntax validation and host networking checks are **NOT VERIFIED**. YAML was parsed locally, which is not equivalent to Docker Compose validation.

## 5. Database, Supabase PROD and recovery

`AGENT_COORDINATION.md` and Task 03.6 repository evidence record DEV `ap-northeast-2`, PROD `ap-northeast-1` (Tokyo), and the PROD project reference `yepfgjehdstlxbpespun`. This is a **repository-recorded baseline**, not a live provider query this turn. No PROD Supabase connection was made.

Still UNVERIFIED: actual project identity/region, current grants and runtime/migration/AI/media roles, migration ledger/checksums, extension availability, pgvector schema, TLS certificate chain, pooler and connection limits, PITR/backup retention, restore evidence and backup billing. No migration, role change, backup, restore, query, AI index operation or storage copy was performed. DEV and PROD isolation remains a release gate; never copy DEV rows, admin accounts, customer data or embeddings into PROD. Approved image bytes may be copied only through a separately authorized and verified Storage process.

The existing Prisma deployment guard checks target identity, ordered migration history/checksums, status and additive-only policy. `.github/workflows/prod-migration.yml` is now manual-only and requires an exact approved SHA on `develop`, a nonempty authorization reference, and successful `Required / Quality Gate` and `Security / NPM Audit` check runs on that same SHA before it supplies migration secrets. It retains the `electrohub-prod-database` Environment, non-cancelling concurrency, project-ref guard and pre/post checks. The workflow was not run. GitHub Environment reviewer/ruleset configuration is NOT VERIFIED from YAML alone. Application deployment remains separate and no application deploy workflow exists yet.

## 6. AI release and worker safety

New `AI_RELEASE_MANIFEST.md` and `AI_RELEASE_MANIFEST.schema.json` bind a full code SHA, verified PROD project/region, model descriptor and artifact digests, preprocessing identity, PROD catalog snapshot/product-ID-set digests, index status, previous active version and approval evidence. The existing Task 04.3 CLI (`stage`, `status`, `activate`, `rollback`) remains authoritative; the manifest is evidence and does not replace its compatibility guard. No manifest was populated with PROD evidence and no vector index was staged or activated.

FastAPI remains private behind Express. The online AI API gets only its service key, AI read-only vector access and read-only model/relevance mounts. Media synchronization has a separate process/env and DB role. Payment recovery, commerce email/push and media are explicit opt-in worker roles with separate environment files; Compose does not enable dispatch merely by starting the main stack. Their PROD role grants, leases/targets, health, resource use and provider delivery remain unverified.

## 7. CI, tests and evidence

Repository changes:

- `.github/workflows/security.yml` checks out the exact PR head SHA (or push SHA).
- Existing CI/security/migration-verification workflows are checked by policy tests for `develop` and `main` push/PR parity, PR SHA checkout, required quality gate dependencies, security audit and disposable database isolation.
- PROD migration is an explicit operator-dispatched, exact-SHA workflow. Ordinary CI has no production deployment or migration trigger under the local workflow policy.
- There is no exact-SHA application release/deployment workflow yet because no deployment topology, host target, registry and approval path are selected. Do not treat the migration workflow as an application deploy workflow.

Commands actually run and results:

| Command / check | Result |
|---|---|
| `npm exec -- vitest run tests/env.test.ts` in `apps/backend` | PASS, 13/13 |
| `npm exec -- vitest run src/services/__tests__/admin-team.service.test.ts` in `apps/backend` | PASS, 22/22, including zero-admin guard, one-time completion, seed-address rejection and first-owner/MFA assignment |
| Backend typecheck and `npm run build` | PASS |
| Backend lint | PASS |
| Frontend production Vite build with local/ambient `VITE_*` inputs scrubbed | PASS; output `apps/frontend/dist`. Existing Sass deprecation, split-chunk and large-bundle warnings remain. |
| `node .github/scripts/check-workflow-policy.cjs` | PASS |
| `node --test .github/scripts/ci-safety.test.cjs` | PASS, 29/29, including additive administrator-bootstrap migration and partial-index guard |
| YAML parse of production Compose/workflows; dotenv parse of Compose example; JSON parse of AI manifest schema | PASS; static syntax only |
| Prisma Client generation from updated schema; migration additive SQL policy | PASS; generation is local, migration was not run |
| Frontend artifact secret-marker scan | PASS, no configured secret markers found; scan did not print matched values. Summed output: 37,965,636 bytes; gzip-per-file sum 35,239,200 bytes. This is not provider-metered egress. |
| `git diff --check` | PASS |
| Remote CI status / exact-SHA check runs | NOT VERIFIED; network lookup failed. |
| Docker build, Compose config/smoke, Nginx syntax | NOT VERIFIED; Docker unavailable. |
| Browser matrix / cross-origin session / CORS-cookie-CSRF negatives | NOT RUN; no assigned public origins/topology, so localhost-only tests would not prove the gate. |
| OAuth/provider, Stripe Test Mode, Brevo, push, Storage, maps, database/AI PROD, load test | NOT RUN. No provider dispatch or PROD data was touched. |

Existing verification assets include Vitest unit/integration suites, Playwright browser/release suites, AI pytest tooling, Prisma migration verification and `.github/scripts` workflow safety policy tests. They do not constitute browser-origin evidence for the unassigned public hostnames.

## 8. Hosting, HTTPS, region and cost

### Free static frontend

The root-workspace frontend build succeeded using the checked-in workspace/lockfile dependencies with `npm run build --workspace=@electrohub/frontend`; Vite emits `apps/frontend/dist`. DigitalOcean supports static-site build commands/output directories and monorepo source directories, so `npm ci` followed by that workspace build is a plausible clean App Platform command. The clean App Platform build itself has not been exercised there, and no site was deployed. It does not resolve API/session routing.

DigitalOcean currently lists up to three free static apps, 1 GiB outbound per app, and $0.02/GiB overage. Bandwidth is pooled at team level; accrued allowance/cumulative usage is not currently visible in the control panel. Therefore this is not guaranteed $0. Obtain explicit overage acceptance before public exposure. Recheck limits at deployment time. [App Platform pricing](https://www.digitalocean.com/pricing/app-platform) · [bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/).

Before any public App Platform creation, Prompt 2 must record the current team quota/other apps, expected static bytes and request volume, image/media transfer sources, outbound usage alert/owner, overage acceptance and stop condition. If the operator cannot bound or accept possible overage, do not publish.

### Optional VPS and destruction limit

Current DigitalOcean pricing lists the Basic Droplet candidate at $6/month, 1 vCPU, 1 GiB RAM and 25 GiB SSD. It is a constrained experiment, not validated capacity for Express, CPU inference, Nginx and required workers. No Droplet was created. An initial experiment is limited to one month; extension needs explicit approval. Power-off remains billable: preserve approved evidence/backups, destroy the Droplet if no extension is approved, and separately verify/remove billable backups, snapshots, volumes and other resources. [Droplet pricing](https://www.digitalocean.com/pricing/droplets) · [power-off billing](https://docs.digitalocean.com/reference/doctl/reference/compute/droplet-action/power-off/).

### HTTPS without purchasing a domain

Let's Encrypt made IP-address and short-lived certificates generally available in January 2026. The short-lived profile lasts 160 hours (about 6.6 days), making HTTPS for a VPS public IP technically plausible without buying a domain. [Let's Encrypt IP and short-lived certificate announcement](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/) · [Certbot command reference](https://eff-certbot.readthedocs.io/en/stable/man/certbot.html).

This is not a verified solution yet: no compatible ACME client/version was pinned, staging issuance attempted, renewal timer installed, keypair copied atomically, Nginx reload tested, expiry monitored or failure recovery exercised. A dynamic-DNS hostname is another candidate but introduces its own ownership, certificate and cross-site questions. Plain HTTP API is forbidden; keep ports unbound until the public origin and TLS lifecycle pass host tests.

### Region measurement plan

Repository evidence records PROD region `ap-northeast-1` (Tokyo), not freshly confirmed from Supabase. DigitalOcean lists `sgp1` (Singapore), `blr1` (Bangalore), `sfo3` (San Francisco) and `syd1` (Sydney) among available Basic Droplet regions. Availability is not latency evidence. [DigitalOcean regional availability](https://docs.digitalocean.com/platform/regional-availability/).

Use one authorized measurement host/source and compare candidate regions without creating multiple paid Droplets. Record:

| Field | Required evidence |
|---|---|
| Target | Candidate region, Supabase PROD project/region, resolved pooler/direct hostname (redact credentials) |
| Method | Same tool/version, source network, DNS resolver, sample count, timeout, TLS verification and connection strategy for every region |
| DNS | Cold and warm lookup p50/p95, failures, resolver and timestamp |
| TCP | New connection p50/p95 and failures |
| TLS | Verified handshake p50/p95, certificate chain result and failures |
| DB RTT | Read-only `SELECT 1` p50/p95, connection mode/pooler, concurrency 1 and no writes |
| Conclusion | Median/tail latency, errors, region selected/reason, reviewer and evidence location |

No measurements were taken in this repository task.

### Prompt 2 manual setup checklist (not authorization)

- [ ] Reconfirm feature branch, exact approved SHA, current remote, and identify all user changes.
- [ ] Record the approved topology and exact HTTPS origins for storefront, API, Socket.IO, OAuth callback, Stripe Test Mode webhook, email CTAs and any other browser-facing service.
- [ ] Obtain separate approval before creating/publishing an App Platform app where egress overage is possible or creating the single $6 Droplet; record the one-month expiry date.
- [ ] Verify Supabase PROD project ref/region, runtime/migration/AI/media role grants, TLS host/CA, migration baseline/checksums, backup/PITR and authorized restore evidence using the approved read-only procedure.
- [ ] Select one region from the consistent measurement report; do not create multiple comparison Droplets.
- [ ] Confirm exact browser matrix, cookie/privacy settings, CORS/CSRF/socket negative cases and retain redacted result evidence.
- [ ] Pin and verify AI model/preprocessing artifact digests; build the vector index from PROD catalog IDs only after separate approval; preserve pre-activation version and rollback evidence.
- [ ] Verify protected GitHub Environment reviewers/settings independently, and exact-SHA CI checks; keep DB migration and app deployment distinct.
- [ ] Confirm Stripe Test Mode only, Brevo sender/origin and recipient target, VAPID push target, map terms/attribution/quota, product-media PROD bucket and privilege scope. Keep provider dispatch disabled until separately approved.
- [ ] Before closing the one-month experiment, export only approved evidence/backups, destroy the Droplet if no extension was approved, then verify backups, snapshots, volumes and other separately billed resources are removed.

## 9. Findings by severity

| Severity | Classification | Finding and consequence |
|---|---|---|
| Critical | GAP / release blocker | Cross-site App Platform/VPS split is untested and incompatible with current SameSite=Lax refresh-cookie assumptions; exact public origins do not exist. No frontend/API publication or API exposure. |
| High | GAP | No application exact-SHA deployment workflow or verified hosting topology/approval environment. PROD migration workflow is not deployment. |
| High | UNVERIFIED / RISK | Supabase PROD identity/region, least-privilege grants, migration baseline, backups/PITR and restore evidence were not queried. Production migration and AI release stay blocked. |
| High | GAP | IP certificate renewal, Nginx reload, expiry monitoring and recovery are not automated or tested. Public API HTTPS is not ready. |
| High | RISK | $6 / 1 GiB full-stack capacity and worker/model memory use are unmeasured. Do not suppress required functionality to fit. |
| High | RISK | The Nginx candidate redirects HTTP using the request `$host` and does not yet enforce the eventual approved host. Fix host allowlisting/reject unknown Host before binding public ports. |
| Medium | GAP | Docker/Compose and Nginx syntax/image smoke were not executable here. Candidate configuration could still have runtime-only errors. |
| Medium | GAP | Socket.IO CORS is exact, but an explicit websocket `Origin` allowRequest guard and invalid-origin browser negative test are absent. Socket token/session checks remain present. |
| Medium | UNVERIFIED | Worker PROD scopes, health/readiness, ownership/lease state, actual target approvals and provider delivery were not exercised. Templates keep dispatch off. |
| Medium | UNVERIFIED | The bootstrap code and additive migration passed focused local checks only; its migration, PROD zero-admin check, invitation email, account acceptance and MFA were not executed. |
| Medium | UNVERIFIED | GitHub Environment reviewer protections, actual secret presence and remote CI checks were not inspected. Workflow YAML alone cannot establish account-level protections. |
| Medium | GAP | Startup URL syntax validation cannot establish DNS ownership or reject a public-looking hostname that resolves into a private network. Deployment preflight must resolve/verify the approved origin before exposure. |
| Medium | GAP | Maps tile provider terms, attribution, quota and cost remain undecided. |
| Low | RISK | Nginx candidate has basic headers but no verified HSTS/CSP policy; static site and API response headers have not been tested in browsers. |
| Informational | ALIGNED | Existing health/readiness, graceful shutdown, AI artifact/index compatibility lifecycle, exact Prisma migration safeguards and worker authorization mechanisms provide reusable foundations. |

## 10. Milestone handoff to Prompt 2

| Milestone | Status | Evidence / gate |
|---|---|---|
| M0 repository baseline | CONDITIONAL GO | Local branch/base verified; fresh remote state unavailable. Recheck before further edits. |
| M1 topology/cost/region | BLOCKED | Origins and region measurements not established; user topology choice required. |
| M2 production configuration | CONDITIONAL GO | Safe templates and origin checks exist; runtime secrets, DB roles and browser topology need approval/evidence. |
| M3 production images/Compose | BLOCKED | Candidate config added; Docker unavailable, image builds and Compose runtime not verified. |
| M4 Nginx/HTTPS/browser routing | NO-GO | API-only Nginx candidate, no cert lifecycle; origin/session tests absent. |
| M5 Supabase PROD/migrations/backups | NO-GO | Additive bootstrap migration is present in the repository but unapplied; provider state and restore evidence not verified; no PROD changes made. |
| M6 AI release | NO-GO | Manifest/guardrails documented; no approved PROD artifact/index manifest or PROD-built vectors. |
| M7 integrations/workers | CONDITIONAL / NO dispatch | Templates and profiles preserve opt-in controls; target/role/health/delivery evidence missing. |
| M8 free App Platform frontend | NO-GO for publication | Build candidate works locally, but browser-origin/session and overage gates are unresolved. |
| M9 optional VPS | NOT AUTHORIZED | No resource created; capacity and user approval required. |
| M10 production smoke/performance | NO-GO | No deployment, public traffic, browser matrix, or authorized load test. |
| M11 handoff/cost cleanup | CONDITIONAL | No resources to clean up. If an experiment is later approved, one-month destruction and separately billed-resource checks are mandatory. |

Prompt 2 must receive **BLOCKED** for the split-origin topology unless real browser evidence proves customer/admin login, expiry refresh, rotation/reuse handling, logout/revocation, reload persistence, protected routes, OAuth (if enabled), Socket.IO auth/reconnect and privacy-restricted behavior across Chromium, Firefox and WebKit/Safari-equivalent on the actual HTTPS origins. Include negative tests for invalid origins, absent credentials, HTTP/local/private/DEV origins and invalid websocket origin.

## 11. Explicit approval gates and recommended sequence

Repository-only work already safe to perform is complete: strict origin validation, safe templates, production-only Compose/Nginx candidate, workflow safeguards, AI release manifest schema, cost/region notes and evidence documentation.

The next sequence is:

1. Recheck remote branch/head and reconcile the approved task with this evidence before continuing.
2. Obtain the owner's topology decision: hold at $0 pending same-site hosting evidence, or evaluate the single-origin VPS candidate. This is an architecture decision only; it does not authorize a Droplet.
3. If topology is approved, assign exact public origins and OAuth/webhook/email/push URLs; confirm no localhost/DEV endpoints; re-evaluate App Platform free-tier usage/overage.
4. Implement only the approved routing/session approach. Preserve current cookie semantics unless an approved security review justifies a change. Add exact Socket.IO origin enforcement and cross-origin browser tests only after the actual hostnames are known.
5. Complete Docker builds/Compose smoke, Nginx validation, certificate automation/renewal/recovery and browser matrix. If any required browser/privacy test fails or is unavailable, keep the gate blocked.
6. Collect read-only Supabase PROD region/project/roles/migration/backup evidence and run a restore rehearsal only with separate authorization. Keep migration/deployment steps distinct.
7. Measure one candidate region and 1 GiB resource capacity; seek explicit approval before any paid/public resource, provider dispatch, PROD mutation, AI index activation, or load test.
8. Build a manual, exact-SHA deployment workflow only after the target host/registry and protected-environment rules are approved. Verify account-level GitHub Environment protection independently.
9. Reassess each milestone and obtain the separate operator approvals required by the task. Never infer deployment readiness from successful repository builds.

No public deployment, Droplet, App Platform app, domain, paid service, provider dispatch, database change, migration, storage copy, AI index activation, test payment, bulk email/push, commit or push was performed.

## 12. Changed files

**Configuration/application:** `.gitignore`; `apps/backend/src/config/env.ts`; `apps/backend/src/admin-bootstrap.cli.ts`; `apps/backend/src/services/admin-team.service.ts`; `apps/backend/src/services/__tests__/admin-team.service.test.ts`; `apps/backend/package.json`; `apps/backend/prisma/schema.prisma`; additive migration `apps/backend/prisma/migrations/20261117120000_admin_bootstrap_invitation/migration.sql`; `apps/backend/tests/env.test.ts`; `apps/frontend/.env.example`; safe templates `apps/frontend/.env.production.example`, `apps/backend/.env.production.example`, `apps/backend/.env.payment-worker.example`, `apps/backend/.env.commerce-email-worker.example`, `apps/ai-service/.env.production.example`, and `apps/ai-service/.env.media-worker.example`.

**Infrastructure:** new `infrastructure/production/compose.yaml`, `infrastructure/production/compose.env.example`, `infrastructure/production/nginx.conf`.

**CI/migration safety:** `.github/workflows/prod-migration.yml`, `.github/workflows/security.yml`, `.github/workflows/dev-migration.yml`, `.github/scripts/check-workflow-policy.cjs`, `.github/scripts/ci-safety.test.cjs`.

**Documentation:** `docs/09_Deployment/AI_RELEASE_MANIFEST.md`, `docs/09_Deployment/AI_RELEASE_MANIFEST.schema.json`, `docs/09_Deployment/TASK_06.3_IMPLEMENTATION_EVIDENCE.md`, and Task 06.3 notes in `DEPLOYMENT_WORKFLOW.md`, `DIGITALOCEAN.md`, `DOCKER.md`, `GITHUB_ACTIONS.md`, `NGINX.md`, `PRODUCTION.md`, and `SSL.md`.

**Operations:** Task 06.3 origin/secret gates in `docs/10_Operations/ENVIRONMENT_VARIABLES.md` and `SECURITY.md`; PROD backup/destruction evidence in `BACKUP_RECOVERY.md`; exact-SHA manual-only migration update in `PRODUCT_MEDIA_RUNBOOK.md`; one-time administrator bootstrap in `PRODUCTION_ADMIN_BOOTSTRAP.md`.

## 13. Assessment

**Implementation score: 58/100. Recommendation: Request Changes before release approval.** Repository-side safety foundations are in place and focused local checks pass, but the acceptance-critical browser-origin gate, Docker/Nginx runtime verification, Supabase PROD evidence, certificate lifecycle, remote CI and application deployment workflow remain blocked or unverified. This is not a production-ready deployment and must not be presented as such.
