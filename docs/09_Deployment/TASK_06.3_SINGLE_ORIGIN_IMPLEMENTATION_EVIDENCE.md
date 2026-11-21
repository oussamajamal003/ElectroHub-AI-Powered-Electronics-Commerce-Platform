# Task 06.3B — Single-Origin VPS Implementation Evidence

**Review date:** 2026-11-17  
**Branch:** `feature/06.3-production-infrastructure`  
**HEAD/base:** `053a271ba36ebcf436720bdc6aa87c7bb79cf149` (`develop` and local merge-base match)  
**Architecture score:** **68/100**  
**Architecture direction:** **READY AFTER SPECIFIC CLARIFICATIONS**  
**Repository candidate:** **REQUEST CHANGES**  
**Deployment status:** **NO-GO**

This evidence records a repository-only single-origin deployment candidate. It is not a browser compatibility result, a host-capacity measurement, a purchase approval or deployment authorization.

## 1. Executive recommendation

**[BLOCKER]** Option B is the best fit for ElectroHub's existing browser contract: serve the React build and proxy Express REST, Stripe webhook and Socket.IO traffic under one HTTPS origin. This keeps relative `/api` and `/socket.io` URLs and the current host-only `Secure; HttpOnly; SameSite=Lax` refresh cookies. It avoids the cross-site refresh-cookie failure in Option A without weakening cookie policy.

**[BLOCKER]** The exact hostname, Google OAuth production eligibility, and Chromium/Firefox/WebKit session behavior remain unproven. No no-cost hostname has been shown to meet Google's domain ownership/authorized-domain requirements. B therefore remains conditional for architecture approval and blocked for release.

**[BLOCKER]** The $6 / 1 GiB candidate is not plausible for the required full stack as currently implemented. The AI loader's estimated weight-copy working set alone is approximately 933 MB before Python/PyTorch overhead, decoded image memory, Node, Nginx, Docker and the operating system. This is source-based arithmetic, not a measured RSS result. A larger host or a separately authorized, measured design experiment is required; required AI functionality has not been removed to fit.

**[HIGH]** Repository preparation now includes a candidate production Nginx config, Compose topology, exact-SHA manual workflow, host deploy/rollback scripts and TLS lifecycle scripts. Docker, Nginx, host deployment, browser, TLS renewal and external alert behavior were not run. Repository checks do not establish production readiness.

**Recommendation:** continue with B only as a repository design candidate after the operator clarifies whether Google customer OAuth must be available and whether a provider-controlled/free dynamic-DNS hostname is acceptable. Keep deployment NO-GO and the $6 Droplet unapproved. Option C merits a separate no-cost prototype only if the operator prefers an edge proxy and accepts its unverified service quotas and hostname constraints.

## 2. Topology comparison

| Concern | A. DO static frontend + separate VPS API | B. Single-origin VPS | C. Pages/Worker same-origin proxy to VPS |
|---|---|---|---|
| Browser origin/site | The generated static-app hostname and unrelated VPS IP/hostname are cross-origin and cross-site. Current browser code uses relative `/api` and Socket.IO URLs, so the API origin is not configurable as a separate site. | One canonical HTTPS scheme/host/port serves SPA, REST, OAuth callback, webhook route and Socket.IO. Matches relative browser paths. | Can retain one browser origin if Pages/Worker serves the SPA and proxies `/api/*` and `/socket.io/*` through that same exact hostname. No implementation exists. |
| Customer/admin refresh | **BLOCKED** with the current host-only `SameSite=Lax` cookies across sites. Credentialed CORS cannot override cookie SameSite rules; `SameSite=None` would not establish browser compatibility and is not an approved workaround. | Compatible by design with current per-role host-only cookie paths/attributes, subject to HTTPS browser testing. | Potentially compatible if all Cookie and Set-Cookie headers/attributes, paths, statuses and rotation responses are preserved and actual browsers confirm storage/refresh. |
| Socket.IO | Cross-site socket auth and relative URL mismatch; requires a same-origin proxy or application contract change and browser tests. | `/socket.io/` proxies polling and WebSocket upgrades to Express; `/delivery` remains a namespace. Gateway checks identity, role and WebSocket Origin. Runtime upgrade/reconnect remains unverified. | Worker WebSockets are technically supported by platform APIs, but polling, upgrade, reconnect, headers, origin bypass and quota behavior need a real prototype. |
| OAuth | Callback origin and provider registration must match the public API host; frontend's separate site does not solve the callback/domain requirement. | One callback origin, but Google OAuth needs a hostname meeting provider verification rules. Raw IP is not a production solution; no selected free hostname is proven eligible. | Provider hostname may be shared/provider-controlled; exact OAuth domain ownership eligibility is unproven. |
| Stripe/Brevo | Stripe webhook can be on API host but browser and API origins differ; Brevo links must still target frontend canonical origin. | `/api/` includes webhook path and preserves body at the proxy layer; `COMMERCE_EMAIL_ORIGIN` must equal the canonical origin. Need endpoint/browser proof. | Can proxy those paths, but raw webhook bytes/signature and canonical email links require tests. |
| TLS/hostname | Requires a public API hostname/certificate plus frontend host; no purchased domain is currently allowed. | Candidate DNS hostname and automated public TLS lifecycle required. No DNS/certificate created. | Provider TLS covers browser edge hostname; a protected TLS origin connection and origin-only firewall/trust model still need implementation and tests. |
| Complexity/isolation | Two public origins and cross-origin session complexity; services remain split. | Simplest browser/security routing, but frontend, Nginx, API and AI share one host/kernel and failure domain. | Adds a provider edge and another trust boundary; may reduce static serving load but does not fix API/AI host capacity. |
| Decision | **BLOCKED** under present browser/session contract. Reconsider only with same-origin proxy or separately approved auth/session redesign. | **Preferred design; CONDITIONAL** on hostname/OAuth, browser proof, capacity, TLS/rollback and operational evidence. | **Conditional alternative; NOT READY** until implemented and tested. |

The earlier architecture gate [TASK_06.3_ARCHITECTURE_DECISION_GATE.md](TASK_06.3_ARCHITECTURE_DECISION_GATE.md) contains the initial comparative assessment and official research references. Its 63/100 score reflects the earlier gate. This implementation review's 68/100 score reflects additional repository-side candidate work; it does not mean those runtime gates passed.

## 3. Authentication, session, CORS and CSRF evidence

- **[INFORMATIONAL] Same-origin contract:** `apps/frontend/src/lib/api.ts` uses relative `/api` calls and `credentials: 'include'`. Customer and admin access-token scopes stay in memory; refresh calls are coordinated. The delivery client uses relative Socket.IO transport path `/socket.io`, namespace `/delivery`, token auth, WebSocket with polling fallback, and reconnect/refetch behavior.
- **[INFORMATIONAL] Cookie contract:** backend production refresh cookies remain host-only (no `Domain`), `Secure`, `HttpOnly`, `SameSite=Lax`, and scoped to `/api/auth/customer` or `/api/auth/admin`. Rotation, revocation, role separation and reuse handling were not relaxed.
- **[HIGH] Browser proof absent:** no single-origin browser E2E host or Chromium/Firefox/WebKit matrix ran. Customer/admin login, expiry refresh, simultaneous tabs/rotation/reuse, reload, logout, protected routes and privacy behavior are not claimed as compatible based on code alone.
- **[MEDIUM] CSRF review item:** source review found cookie-authenticated refresh/logout paths without an exact-Origin guard or CSRF token. Lax blocks ordinary cross-site cookie POSTs but is defense-in-depth; it does not replace CSRF protections, particularly with same-site sibling origins. This task did not change auth, cookie, CORS or CSRF behavior. Resolve through a focused security design before release.
- **[INFORMATIONAL] CORS:** the backend retains exact configured frontend origin and credential behavior. For B, browser requests should be same-origin and do not rely on cross-origin CORS. CORS is not a CSRF defense. No wildcard or third-party cookie workaround was added.
- **[HIGH] Socket Origin:** the delivery gateway now checks WebSocket Origin against configured allowed origins, with tests for allowed, missing and untrusted origins plus polling-only behavior. This does not replace socket token/role/ownership/MFA checks. Real Nginx upgrade and reconnect behavior was not run.
- **[HIGH] OAuth:** callback can be routed through the canonical `/api/` proxy, but Google provider settings were not inspected or changed. An exact public hostname and ownership/authorized-domain proof are missing. Do not infer production OAuth eligibility from a local hostname or certificate.

## 4. Candidate Nginx routes

The configuration contract is in `infrastructure/production/nginx.conf.template`; the bootstrap-only ACME server is `infrastructure/production/nginx-acme-bootstrap.conf.template`.

| Host/path | Candidate behavior |
|---|---|
| Canonical HTTP `/.well-known/acme-challenge/*` | Serve only ACME challenge webroot. |
| Canonical HTTP other paths | Fixed `308` to configured `https://${CANONICAL_HOST}$request_uri`; redirect does not reflect arbitrary Host. |
| Unknown HTTP host / unknown TLS SNI | Close/reject; no default application response or wildcard app certificate. |
| HTTPS `/api/health*`, `/api/ready`, `/api/docs*`, `/api/openapi.json` | Return edge `404`; diagnostics and internal health are not public routes. |
| HTTPS `/api/` | Proxy to private Express service, preserve method/query/body (including Stripe webhook), overwrite forwarded host/protocol/client headers, enforce request/time bounds. |
| HTTPS `/socket.io/` | Proxy Engine.IO polling and WebSocket upgrade with upgrade headers, buffering disabled, and longer read/send timeouts. |
| `/delivery` | No separate upstream route: it is the Socket.IO namespace carried over `/socket.io/`. REST delivery remains under `/api/`. |
| Hashed `/assets/*` | Serve static file with immutable caching only for hash-shaped names; non-hashed/missing assets and source maps fail closed. |
| `/index.html` | Serve entry HTML with no-store/revalidation. |
| Other frontend paths | `try_files` static path then `/index.html` for SPA deep links; API paths do not fall through to SPA. |

**[HIGH] Runtime not verified:** Nginx is unavailable locally. Route selection, config syntax, TLS SNI behavior, header/body preservation, static deep links and real Socket.IO upgrade need Docker-backed checks. Static policy tests are not equivalent to Nginx execution.

## 5. TLS, hostname and payment/email URL feasibility

- **[HIGH] Hostname outcome: CONDITIONAL.** The hostname feasibility document compares DuckDNS, EU.org, provider hostnames and IP approaches with official references. No account, hostname, DNS record or certificate was created. Eligibility, stable ownership and Google's authorized-domain acceptance remain unproven for every free hostname candidate.
- **[BLOCKER] OAuth hostname:** raw IP cannot satisfy Google's production web-server redirect URI requirements. DNS plus publicly trusted HTTPS alone does not prove that a shared/free hostname satisfies Google ownership/branding verification.
- **[INFORMATIONAL] TLS candidate:** repository scripts accept a DNS FQDN, use ACME HTTP challenge bootstrap and Certbot staging by default/explicit enablement, install versioned key/certificate material with restricted ownership, atomically switch the active pointer, run Nginx config test before reload and restore prior pointer on reload failure. Renewal and expiry systemd timers are disabled until operator installation/configuration.
- **[HIGH] Lifecycle proof absent:** scripts/systemd units were not installed or run. No staging issuance, renewal, expiration alert, reload rollback, first-boot or recovery rehearsal occurred. Expiry notification only logs locally; no external alert route is configured. Scripts do not implement raw-IP certificate lifecycle.
- **[INFORMATIONAL] Stripe:** Nginx forwards `/api/` without application-level body rewrite, so the existing raw-body signature handler remains the verification boundary. No Stripe endpoint setting, live/test delivery or public reachability test was performed.
- **[INFORMATIONAL] Brevo:** email remains server-side and `COMMERCE_EMAIL_ORIGIN` must be the canonical HTTPS origin. No messages were sent; generated links were not browser-tested.

## 6. $6 / 1 GiB capacity assessment

**[BLOCKER] Classification: INFEASIBLE for the required full stack on 1 GiB based on source-derived resource arithmetic.** DigitalOcean's public pricing page was checked on 2026-11-17; it lists the candidate Basic configuration at $6/month, 1 shared vCPU, 1 GiB RAM, 25 GiB SSD and 1,000 GiB included transfer. Pricing is time-sensitive and must be rechecked before any later decision. No Droplet was created.

| Component | Current evidence | Assessment |
|---|---|---|
| AI model artifacts | SigLIP directory 186,581,546 bytes; relevance artifacts 160,623 bytes. Model is loaded by Python 3.11 + CPU PyTorch. | Model artifacts fit on disk, but cold-load copies do not fit safely in 1 GiB RAM. |
| AI loader working set | Source loads FP16 weights, creates converted FP32 state, then an FP32 model. Approximate tensor copies: 186.6 MB + ~373 MB + ~373 MB = ~933 MB before runtime/native overhead. | Inference from source and bytes; not observed RSS. Leaves no plausible room for OS, Python/PyTorch, API, edge, decode buffer or allocator overhead. |
| Request memory/CPU | Up to 40 MP images (~120 MB decoded RGB) and 8 MiB uploads; production template bounds inference concurrency and Torch threads to one. | Limits reduce contention but cannot solve cold-load memory. One shared vCPU couples model/image work with API/OS. Latency and throughput are unmeasured. |
| Node, Nginx, Docker and Ubuntu | Required online services; no production images or host were built. | Their actual memory/disk footprint is unknown and additive to model memory. |
| Disk | 25 GiB includes OS, container layers, model, logs, current and rollback releases, temporary files and reserve. | Plausible but unverified; exact AI image, retained layers and log growth unknown. |
| Workers | Payment/email/media worker Compose profiles are opt-in and disabled by default. | They remain required operational capabilities and must be measured separately when authorized; do not imply they fit when enabled. |

Swap risks host-wide stalls and disk pressure and does not create RAM. Container memory limits only cap use; they cannot make the cold-load peak viable. The full service set shares a host/kernel/disk and can fail together through OOM, restart loops, swap thrashing or disk exhaustion.

**Evidence needed:** a separately authorized isolated-host experiment on a selected larger candidate should capture idle/startup/cold model load/warm inference/API/browser concurrency, cgroup and host RSS peaks, swap, CPU throttling, p50/p95, image build and disk/log growth, restarts and rollback. No performance measurements are fabricated here. The $6 plan is not recommended for this full stack.

## 7. Cost, deployment and operations

- **[MEDIUM] Cost:** $6/month is the published base Droplet price at review time, not a total operating-cost promise. Taxes, backups/snapshots, overage bandwidth, DNS/provider fees and future capacity are excluded unless separately confirmed. Included transfer is finite. No capacity forecast exists.
- **[HIGH] Release workflow:** `.github/workflows/deploy-production.yml` is manual and exact-SHA gated, checks quality/security status, builds backend/AI/edge images, records image config IDs/checksums, and uploads a seven-day artifact. It does not publish to a registry. A protected GitHub Environment and host SSH secrets are assumed, not verified. Workflow was not run.
- **[HIGH] Supply chain:** Docker base images and Actions use version tags; OCI image digests are not pinned and signed provenance/attestation is absent. Artifact retention is seven days. These should be addressed before production release.
- **[HIGH] Initial deployment:** `infrastructure/production/deploy-release.sh` requires an existing healthy `current` release, so it intentionally cannot bootstrap the first install. A separately reviewed initial install and recovery procedure is required.
- **[HIGH] Rollback:** application smoke failure restores the prior app release/config pointer; database migrations are intentionally excluded. Actual image load, Compose validation, health recovery and rollback were not executed. Backup evidence is a record/check, not proof that a real current PROD backup restores.
- **[MEDIUM] Single-host resilience:** edge/API/AI share a host failure domain and resource pool. External Supabase avoids colocated database but not application outage; there is no demonstrated HA, host replacement time, external monitoring or alert response.

## 8. Security findings

- **[BLOCKER]** No release until a hostname satisfying OAuth requirements, browser auth/session proof and measured capacity on the selected host are established.
- **[HIGH]** No external TLS failure/expiry alert exists; local logger output is insufficient operational notification evidence.
- **[HIGH, resolved in this candidate]** The repository ignore rules originally excluded the entire `infrastructure/production/tls/` directory, which would have hidden the TLS lifecycle source from version control/release review. The rules now allow-list scripts, tests, units and safe examples while retaining private-key/certificate ignores; a policy test and `git check-ignore` verify both sides.
- **[HIGH]** No CSP is configured at the edge. Derive it only after an inventory of required Google, Stripe, maps, image and font origins, then validate in browser tests.
- **[MEDIUM]** Exact-Origin/CSRF review for refresh/logout remains open as described above. No auth/CORS/CSRF changes were made.
- **[MEDIUM]** Nginx/Compose runtime security boundaries, forwarded-header spoofing behavior and origin exposure were only statically reviewed; runtime inspection is missing.
- **[INFORMATIONAL]** Compose publishes only the edge ports; API and AI are on private networks, workers are opt-in, TLS files are host-mounted read-only and not baked into images. This is configuration intent, not proof of effective host firewall or runtime exposure.
- **[INFORMATIONAL]** Frontend build passed and targeted scanning found no live Stripe key pattern, webhook secret, private-key block, Supabase service-role name or Brevo API key name. This is a targeted scan, not a comprehensive secret audit.

## 9. Required changes by topology

### Option A — separate static site and VPS API

**[BLOCKER]** Do not proceed with the present auth/browser contract. Viability requires either a same-origin proxy under the frontend host, or an explicitly reviewed change to the API/socket URL model, cookie design and CSRF controls. A SameSite=None change alone is not sufficient. Re-run customer/admin, browser privacy, OAuth and Socket.IO matrix on exact public-like origins. No such change was made.

### Option B — single-origin VPS

1. **[BLOCKER]** Select a hostname strategy without purchasing/registering in this task; prove exact DNS control and Google OAuth domain eligibility if OAuth remains required.
2. **[BLOCKER]** Select a host that can run all required services; the 1 GiB candidate fails the current source-based capacity gate. Measure the selected candidate before claiming suitability.
3. **[HIGH]** Run Docker builds, Compose config/runtime, Nginx syntax/routing, host exposure, WebSocket upgrade, TLS renewal/recovery and rollback on an authorized isolated host.
4. **[HIGH]** Add browser coverage for customer/admin cookies, refresh rotation/concurrency, CSRF/untrusted Origin, OAuth, Stripe fixture signature path, Socket.IO upgrade/polling/reconnect and SPA deep links.
5. **[HIGH]** Resolve external alerting, CSP, first-install runbook, backup/restore evidence, GitHub environment protections, immutable image provenance and retention.
6. **[MEDIUM]** Independently verify PROD project/region/schema/index/roles and migration/backup safety under their separate approval gates. This task made no PROD query or mutation.

### Option C — Pages/Worker edge proxy

1. **[HIGH]** Build a no-cost disposable prototype serving SPA and `/api/*` + `/socket.io/*` at the same provider hostname; enforce fixed upstream routing and protect the origin from direct access.
2. **[HIGH]** Test cookie forwarding/multiple Set-Cookie headers, Origin and forwarded-header trust, raw Stripe bytes/signature, polling and WebSocket upgrade/reconnect, fail-closed quotas and origin outage.
3. **[BLOCKER]** Establish Google OAuth domain/hostname eligibility on the exact provider hostname if OAuth must remain enabled.
4. **[BLOCKER]** Resolve the same VPS capacity problem. An edge proxy reduces static serving work, not Node/PyTorch memory requirements.

## 10. Repository changes and review scope

All changes remain uncommitted and unstaged. The current worktree includes the prior Prompt 1 preparation and this B candidate; it was already non-clean at the start of this implementation continuation. The exact complete changed/untracked path list is available from `git status --short --untracked-files=all`; no attempt was made to clean or reclassify pre-existing files.

Task 06.3B candidate additions include:

- `.gitignore`: allows TLS lifecycle source into version control while keeping certificate/key formats excluded.
- `infrastructure/production/`: production Compose and env template, edge Dockerfile/entrypoint, Nginx production and ACME configs, release-manifest tools/tests, production-env and release-bundle verifiers, deploy/rollback script, plus TLS renewal/install scripts, systemd units and static policy test.
- `.github/workflows/deploy-production.yml`: manual exact-SHA release candidate.
- `apps/backend/src/sockets/delivery.gateway.ts` and its test: explicit WebSocket Origin enforcement and tests; no cookie/CORS/CSRF/OAuth code changed.
- `apps/ai-service/`: private readiness/worker health checks, artifact verifier, tests and safe env examples.
- `docs/09_Deployment/`: single-origin design, hostname/TLS/OAuth feasibility, capacity assessment, TLS lifecycle, AI artifact manifest/schema and this evidence; relevant runbooks updated.
- Earlier Prompt 1 uncommitted work remains present: protected admin bootstrap and additive migration, environment validation, opt-in worker controls/health checks, CI and migration workflow policy changes, safe environment examples, operations/security/backup documentation and earlier evidence/audit/spec files.

The following is the complete `git status --short --untracked-files=all` inventory at report completion. It is a state snapshot and does not reclassify ownership of files that predated this implementation turn. The approved specification, revised draft, earlier audit and evidence remain untracked and were preserved.

**Modified tracked paths:**

```text
.dockerignore
.github/scripts/check-workflow-policy.cjs
.github/scripts/ci-safety.test.cjs
.github/workflows/ci.yml
.github/workflows/dev-migration.yml
.github/workflows/prod-migration.yml
.github/workflows/security.yml
.gitignore
apps/ai-service/.dockerignore
apps/backend/package.json
apps/backend/prisma/schema.prisma
apps/backend/src/commerce-email-runner.ts
apps/backend/src/config/env.ts
apps/backend/src/payment-runner.ts
apps/backend/src/services/__tests__/admin-team.service.test.ts
apps/backend/src/services/admin-team.service.ts
apps/backend/src/sockets/delivery.gateway.test.ts
apps/backend/src/sockets/delivery.gateway.ts
apps/backend/tests/env.test.ts
apps/frontend/.env.example
docs/09_Deployment/DEPLOYMENT_WORKFLOW.md
docs/09_Deployment/DIGITALOCEAN.md
docs/09_Deployment/DOCKER.md
docs/09_Deployment/GITHUB_ACTIONS.md
docs/09_Deployment/NGINX.md
docs/09_Deployment/PRODUCTION.md
docs/09_Deployment/SSL.md
docs/10_Operations/BACKUP_RECOVERY.md
docs/10_Operations/ENVIRONMENT_VARIABLES.md
docs/10_Operations/PRODUCT_MEDIA_RUNBOOK.md
docs/10_Operations/SECURITY.md
```

**Untracked paths:**

```text
.github/workflows/deploy-production.yml
apps/ai-service/.env.media-worker.example
apps/ai-service/.env.production.example
apps/ai-service/app/healthcheck.py
apps/ai-service/app/worker_healthcheck.py
apps/ai-service/tests/test_task_063_artifact_manifest.py
apps/ai-service/tests/test_task_063_release_healthcheck.py
apps/ai-service/verify-model-artifact.py
apps/backend/.env.commerce-email-worker.example
apps/backend/.env.payment-worker.example
apps/backend/.env.production.example
apps/backend/prisma/migrations/20261117120000_admin_bootstrap_invitation/migration.sql
apps/backend/src/admin-bootstrap.cli.ts
apps/backend/src/utils/worker-health.test.ts
apps/backend/src/utils/worker-health.ts
apps/backend/src/worker-healthcheck.ts
apps/frontend/.env.production.example
docs/09_Deployment/AI_MODEL_ARTIFACT_CANDIDATE.json
docs/09_Deployment/AI_RELEASE_MANIFEST.md
docs/09_Deployment/AI_RELEASE_MANIFEST.schema.json
docs/09_Deployment/RELEASE_MANIFEST.schema.json
docs/09_Deployment/TASK_06.3_ARCHITECTURE_DECISION_GATE.md
docs/09_Deployment/TASK_06.3_CAPACITY_ASSESSMENT.md
docs/09_Deployment/TASK_06.3_DEPLOYMENT_ARCHITECTURE_AUDIT.md
docs/09_Deployment/TASK_06.3_HOSTNAME_TLS_OAUTH_FEASIBILITY.md
docs/09_Deployment/TASK_06.3_IMPLEMENTATION_EVIDENCE.md
docs/09_Deployment/TASK_06.3_PROMPT_2_HANDOFF_CHECKLIST.md
docs/09_Deployment/TASK_06.3_SINGLE_ORIGIN_IMPLEMENTATION_EVIDENCE.md
docs/09_Deployment/TASK_06.3_SINGLE_ORIGIN_VPS_DESIGN.md
docs/09_Deployment/TLS_LIFECYCLE.md
docs/10_Operations/PRODUCTION_ADMIN_BOOTSTRAP.md
docs/tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT.md
docs/tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_REVISED_DRAFT.md
infrastructure/production/Dockerfile.edge
infrastructure/production/compose.env.example
infrastructure/production/compose.yaml
infrastructure/production/create-release-manifest.cjs
infrastructure/production/deploy-release.sh
infrastructure/production/edge-entrypoint.sh
infrastructure/production/nginx-acme-bootstrap.conf.template
infrastructure/production/nginx-compose-policy.test.cjs
infrastructure/production/nginx.conf.template
infrastructure/production/release-manifest.test.cjs
infrastructure/production/tls/bootstrap-staging-certificate.sh
infrastructure/production/tls/bootstrap-staging.sh
infrastructure/production/tls/certbot-deploy-hook.sh
infrastructure/production/tls/check-certificate-expiry.sh
infrastructure/production/tls/check-expiry.sh
infrastructure/production/tls/electrohub-cert-expiry-check.service
infrastructure/production/tls/electrohub-cert-expiry-check.timer
infrastructure/production/tls/electrohub-certbot-renew.service
infrastructure/production/tls/electrohub-certbot-renew.timer
infrastructure/production/tls/electrohub-tls-alert@.service
infrastructure/production/tls/electrohub-tls-expiry-check.service
infrastructure/production/tls/electrohub-tls-expiry-check.timer
infrastructure/production/tls/install-certificate.sh
infrastructure/production/tls/install-renewed-certificate.sh
infrastructure/production/tls/renew.sh
infrastructure/production/tls/tls-lifecycle-policy.test.cjs
infrastructure/production/tls/tls.env.example
infrastructure/production/verify-production-env.py
infrastructure/production/verify-production-env.test.py
infrastructure/production/verify-release-bundle.py
infrastructure/production/verify-release-manifest.cjs
```

**[MEDIUM]** The local AI candidate JSON and release schema both parse, but a JSON Schema validator package was unavailable, and the candidate is explicitly not a complete production release manifest: it deliberately lacks release SHA, verified Supabase project/region and authorization evidence. The local model/loader verifier passed against checked-out artifact digests and source identity. No PROD index/manifest was created.

## 11. Verification record

### Passed locally

| Check | Result |
|---|---|
| `node --test .github/scripts/*.test.cjs infrastructure/production/*.test.cjs infrastructure/production/tls/*.test.cjs` | 43/43 passed, including the TLS source allow-list/private-key ignore policy test. |
| `python infrastructure/production/verify-production-env.test.py` | 4/4 passed. |
| AI manifest/readiness pytest files | 4 passed. |
| AI candidate model/loader artifact verifier | Passed against local artifact hashes and loader identity. |
| AI Ruff targeted check | Passed: all checks passed. |
| Frontend lint | Passed with five existing Fast Refresh warnings and zero errors. |
| Frontend TypeScript check | Passed. |
| Frontend production build | Passed; 126 asset files, no source maps. Existing warnings include a ~690 KB main chunk and Sass/Rollup notices. |
| Backend lint | Passed. |
| Backend typecheck/build | Passed. |
| Socket.IO gateway tests | 19/19 passed, including Origin checks and polling-only case; local loopback needed an approved unsandboxed test run. |
| Admin team/bootstrap service tests | 22/22 passed. |
| Deployment/TLS shell syntax | `bash -n` passed; scripts were not executed. |
| Compose/workflow/migration YAML parse | Passed with local PyYAML parser. |
| JSON parse | AI manifest schema and candidate JSON parsed; complete schema validation unavailable. |
| Git diff hygiene | `git diff --check` passed; cached diff is empty. |
| TLS source ignore policy | Shell scripts, `.cjs` tests, systemd units and `.example` config are visible to Git; a certificate `.pem` remains ignored. |

### Not verified / unavailable

- **[HIGH]** Chromium, Firefox, WebKit/Safari-equivalent browser matrix and production-like HTTPS origin.
- **[HIGH]** Docker builds, `docker compose config`, running containers, Nginx `-t`, TLS SNI, header/body routing, WebSocket upgrade and deploy/rollback runtime.
- **[HIGH]** VPS measurements, model cold load/inference, swap/OOM, CPU throttle, image size/disk/log growth.
- **[HIGH]** OAuth provider registration/ownership, Google sign-in callback, Stripe Test webhook delivery and Brevo link rendering.
- **[HIGH]** Public or staging certificate issuance, renewal, expiry/alert, failure rollback and first boot.
- **[HIGH]** Remote CI run, protected GitHub Environment configuration, signature/provenance and host SSH deployment.
- **[HIGH]** Supabase PROD identity, region, roles, schema/index readiness, backup restore or migration/bootstrap. No PROD access/action occurred.
- **[MEDIUM]** Complete frontend/backend test suites and E2E suites were not run; only named focused checks above ran.
- **[MEDIUM]** Fresh remote reachability was not established: `git ls-remote` failed with DNS/thread-start error. Local `origin` refs may be stale.
- **[INFORMATIONAL]** `docker` and `nginx` executables are absent in this environment. JSON Schema validation library was absent; parser-only JSON validation ran.

No DigitalOcean resources, DNS/hostname, certificates, public app/API, provider settings, real payment/email/push, worker dispatch, migrations, PROD database/storage/index or AI activation were created, changed or run.

## 12. Remaining unknowns and evidence required

| Unknown | Required evidence |
|---|---|
| Exact free hostname and Google OAuth suitability | Operator decision on OAuth and provider-hosted hostname; exact DNS/ownership and OAuth authorized-domain acceptance evidence. |
| Customer/admin browser session behavior | Exact-origin HTTPS browser matrix, including refresh/reuse/logout, role isolation, CSRF and privacy modes. |
| Full-stack resource fit | Separately authorized experiment on the selected host with actual images/model, resource peaks, latency, disk, restart and rollback records. |
| Nginx/Compose correctness | Docker-backed build/config/runtime, host exposure scan and live routing tests for SPA, REST/webhook, polling, WebSocket and reconnect. |
| Certificate operation | Staging issue/renew/reload/rollback/alert/recovery rehearsal; external notification path. |
| Safe first install/release provenance | Reviewed bootstrap/rollback process, immutable image digests, provenance and retention policy, verified GitHub Environment protection. |
| Production data/provider readiness | Separately approved read-only PROD identity/region/schema/index/backup verification; provider endpoint changes and tests each require their own approval. |

## 13. Approval boundary and next step

**Repository-side work is sufficient for design review, but not implementation/release approval.** Score: **68/100**. Recommendation: **REQUEST CHANGES** to the implementation candidate. Architecture direction: **READY AFTER SPECIFIC CLARIFICATIONS**. Deployment status: **NO-GO**.

The operator must choose the next direction. Recommended: approve further **repository-only/controlled local prototype work for B**, with Google OAuth requiredness and acceptable no-cost hostname model clarified first; then plan capacity against a larger candidate. Alternatively, request a separate C edge-proxy prototype. This approval must not be interpreted as approval to purchase/register a domain, create a Droplet, spend money, expose services, change provider settings, access/mutate PROD, issue a public certificate, enable workers or deploy.

## References

- [Single-origin design](TASK_06.3_SINGLE_ORIGIN_VPS_DESIGN.md)
- [Hostname/TLS/OAuth feasibility](TASK_06.3_HOSTNAME_TLS_OAUTH_FEASIBILITY.md)
- [Capacity assessment](TASK_06.3_CAPACITY_ASSESSMENT.md)
- [Earlier architecture decision gate](TASK_06.3_ARCHITECTURE_DECISION_GATE.md)
- [Prompt 1 implementation evidence](TASK_06.3_IMPLEMENTATION_EVIDENCE.md)
- [Prompt 1 architecture audit](TASK_06.3_DEPLOYMENT_ARCHITECTURE_AUDIT.md)
- [Prompt 2 handoff checklist](TASK_06.3_PROMPT_2_HANDOFF_CHECKLIST.md) — not authorized/blocked.
- [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets), reviewed 2026-11-17.
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server?hl=en) and [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance?hl=en), reviewed 2026-11-17.
- [Let's Encrypt certificate profiles](https://letsencrypt.org/docs/profiles/) and [IP/short-lived certificate support](https://letsencrypt.org/2026/03/11/shorter-certs-certbot), reviewed 2026-11-17.
