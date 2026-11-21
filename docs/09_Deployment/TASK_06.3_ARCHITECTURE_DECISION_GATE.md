# Task 06.3 — Architecture Decision Gate: Single-Origin VPS Feasibility

**Assessment date:** 2026-11-17  
**Scope:** Architecture evaluation and repository review only. No resources were created, no services exposed, no authentication/configuration changed, and no deployment or provider operation was performed.

**Repository snapshot:** branch **feature/06.3-production-infrastructure**, HEAD **053a271b**. The working tree already contained Prompt 1 modifications and untracked files before this report was added; those changes were preserved.

## Executive recommendation

**Score: 63/100**  
**Decision: READY AFTER SPECIFIC CLARIFICATIONS** — for selecting an architecture direction only. **Deployment remains BLOCKED.**

The current free DigitalOcean static frontend plus a separate VPS API is blocked by the implemented browser session model. The frontend uses same-origin relative API and Socket.IO URLs, while customer and administrator refresh cookies are host-only, HttpOnly, Secure in production and SameSite=Lax. A generated static-app hostname and an unrelated VPS hostname are cross-site; adding credentialed CORS or changing SameSite to None does not make this design reliable or safe.

A single-origin VPS is the best fit for the existing application contract: Nginx can serve the React build and forward REST, Stripe webhook and Socket.IO traffic under one HTTPS origin. It preserves the current Lax cookie model and avoids cross-origin browser requests. However, the checked-in Nginx config is API-only, no frontend/release workflow or certificate lifecycle exists, Google OAuth cannot use a raw IP redirect host, and the candidate 1 GiB Droplet has not been shown to run the complete service set. The origin/session design is feasible; production readiness and capacity are not demonstrated.

A free Cloudflare Pages Functions/Workers edge proxy is a credible same-origin alternative without buying a domain or choosing a paid plan. It could serve the static build on a provider hostname and proxy application routes to the VPS under that same browser origin. This is an unimplemented candidate: WebSocket relay, cookie forwarding, OAuth hostname eligibility, quota behavior, trust-proxy handling and raw Stripe webhook preservation all require proof. It does not solve the VPS capacity concern.

**Recommended next direction:** authorize repository-only design/prototype work for option B using a free hostname strategy, while first deciding whether Google OAuth is required and whether a generated/third-party hostname is acceptable. Keep the $6 VPS unapproved until a measured full-stack capacity experiment demonstrates safe limits. If avoiding a VPS-served frontend is preferred, authorize a separate no-cost prototype for option C. Neither direction authorizes purchase, provisioning, public exposure, provider activation or deployment.

### Score basis

| Area | Score |
|---|---:|
| Same-origin fit with current frontend and session contracts | 18/20 |
| Customer/admin authentication compatibility | 17/20 |
| Hostname, TLS and OAuth viability | 8/15 |
| Complete-stack capacity evidence for the $6 plan | 6/20 |
| Release, rollback and operational evidence | 5/15 |
| Cost feasibility under stated restrictions | 9/10 |
| **Total** | **63/100** |

## Finding severity

- **BLOCKER — Option A:** separate static-app and VPS origins are incompatible with the current Lax refresh-cookie contract and relative API/socket URLs without an architectural change or an actual same-origin proxy.
- **BLOCKER — Deployment:** no full-stack capacity evidence exists for the 1 GiB plan; production resource limits are deliberately unset until measured.
- **BLOCKER — OAuth on bare IP:** Google’s web-server OAuth rules do not permit a raw IP address as a production redirect host. A raw-IP-only single-origin deployment cannot support the currently implemented Google OAuth callback.
- **HIGH — TLS lifecycle:** IP certificates are available, but short-lived certificates require automated issuance, deployment, renewal monitoring and Nginx reload/recovery. The current repository has no certificate client or lifecycle automation.
- **HIGH — Release path:** Prompt 1 does not provide an exact-SHA application image build/publish/deploy/rollback workflow. The current Compose file refers to release-tagged images but has no registry/release pipeline.
- **HIGH — Single-host failure/isolation:** B places the edge, frontend, API, AI inference and any enabled workers on one host and shares one kernel, disk, memory pool and failure domain.
- **HIGH — Option C proof:** the edge proxy is not implemented or tested for Engine.IO polling/WebSocket upgrades, cookie headers, Stripe raw-body integrity, OAuth and trusted client-IP handling.
- **MEDIUM — Host handling:** the current default Nginx HTTP server redirects to a URL built from the request Host header. Unknown hosts are not explicitly rejected before redirect.
- **MEDIUM — AI artifact naming:** the task/release description and checked-in sharded SigLIP2 encoder artifacts do not use the same apparent single-file naming; reconcile the approved manifest and actual loader input before provisioning.
- **MEDIUM — Runtime limits:** Compose has required-but-unset memory/CPU limits, no worker health checks and only a liveness check for AI, not model readiness. This is appropriately fail-closed before measurement, but release work is incomplete.
- **LOW — Static free-tier egress:** DigitalOcean App Platform’s free static allocation is limited to 1 GiB outbound per app per month; overage is billed at $0.02/GiB. It is not a guaranteed zero-cost option at arbitrary traffic.
- **INFORMATIONAL — Existing safe preparation:** the reviewed changes include useful fail-closed production configuration, private service networking, manual exact-SHA migration gating and additive admin-bootstrap preparation. Those do not demonstrate a deployed or production-ready stack.

## Architecture comparison

| Concern | A. DO static frontend + separate VPS API | B. Single-origin VPS | C. Free Pages/Worker edge + VPS origin |
|---|---|---|---|
| Browser origin/site | Different origins and different sites for generated DO app host versus an unrelated API IP/hostname. | One scheme, host and port for page, API and socket. Same-origin and same-site. | One browser origin if Pages/Worker serves the app and proxies API/socket paths on that exact hostname. |
| Current refresh cookies | **Blocked.** Cross-site fetch does not send SameSite=Lax cookies. Credentials include and CORS do not override cookie policy. SameSite=None is not a reliable fix under third-party-cookie restrictions and would require CSRF review. | Compatible with current host-only Secure/HttpOnly/SameSite=Lax cookies, subject to HTTPS and browser verification. | Potentially compatible if edge forwards request Cookie and all backend Set-Cookie headers without rewriting attributes. Must test browser storage/rotation and role paths. |
| CORS / CSRF | Requires exact credentialed CORS and cross-origin CSRF/origin review. CORS cannot use wildcard with credentials. | Browser calls are same-origin; current exact-origin checks remain relevant for unsafe routes and OAuth. | Browser is same-origin at edge, but edge-to-origin is server-to-server. Preserve Origin semantics and prevent bypassing the edge. |
| Socket.IO / delivery | Current relative client URL resolves to frontend host, not VPS. Requires explicit remote manager URL, cross-origin polling policy and WS origin validation. Not currently configured. | Current relative Socket.IO URL reaches Nginx. Proxy Engine.IO at /socket.io/ with upgrades and polling; /delivery is a Socket.IO namespace, not a separate HTTP path. REST delivery routes remain under /api/. | Worker/Pages Function must relay polling and WebSocket upgrade/close semantics, forward the Socket.IO auth payload, and prove reconnect. Not established by provider documentation alone. |
| OAuth | Current backend requires callback origin to equal FRONTEND_URL. App Platform rewrite rules operate among components in the same app, not a VPS external origin, so they do not provide the needed callback proxy. | Same-origin callback works with a valid hostname. A raw-IP Google OAuth redirect is prohibited by Google’s web-server OAuth validation rules. | Callback can remain at the Pages hostname if proxied to the API, but Google ownership/verification eligibility for a provider-generated hostname has not been established. |
| TLS / hostname | DO gives the static site its app hostname/TLS; VPS API still needs its own public HTTPS hostname and certificate. A separate custom domain is outside this task’s no-purchase boundary. | Public IP TLS is technically possible with short-lived Let’s Encrypt IP certificates. A free DDNS hostname may also work, but provider terms, continuity and Google OAuth eligibility need validation. | Provider supplies TLS for a generated Pages hostname; VPS still needs protected origin transport or a separately managed origin certificate. The provider hostname and account become part of the trust boundary. |
| Stripe / email URLs | Webhook and OAuth point to API while customer-facing links point to frontend; provider and browser URLs span hosts. | Stripe webhook can use same-origin /api path; email links use the canonical frontend origin. Must update and verify provider configuration in Test Mode only. | Worker must forward Stripe signature and raw request bytes unchanged. Brevo links can use edge origin. Provider webhook setup remains unverified. |
| SPA / routing | Existing frontend Nginx has SPA fallback; static host also serves the SPA. No proxy from static host to external API. | Nginx must serve Vite dist, cache hashed assets, avoid caching HTML, and use SPA fallback for client routes. Not implemented in production Nginx. | Pages serves SPA and function routes must be restricted so static asset paths bypass functions. Explicit catch-all fallback and API routing rules are needed. |
| Release / rollback | Two deployables and compatibility skew; frontend is separate from API. | One Compose release can align frontend/API/Nginx, but no app release pipeline exists and one-host rollback is coupled. Database migrations still need compatible expand/contract sequencing. | Three moving pieces (Pages static build, Worker/Functions proxy, VPS origin) increase release and rollback coordination and quota/configuration failure modes. |
| Cost / bandwidth | Static site is free only within the current allowance; overage may be billed. VPS starts at $6/month; its public response traffic consumes Droplet transfer. | Candidate Droplet is $6/month with 1,000 GiB transfer in the published Basic tier; backups/snapshots and any extra services are additional. | Same $6 VPS plus a free Cloudflare service within its free quota. No paid upgrade is assumed. A quota stop can make routes unavailable. |
| Isolation | Static host and API host are separate providers/services; smallest VPS still hosts API and possibly AI/workers. | Lowest component count, but all processes share one host and kernel. Compromise or resource exhaustion has broad blast radius. | Edge delivery and origin are separated, but Worker credentials and edge routing become security-critical; VPS remains a shared-service failure domain. |

### A — Free DigitalOcean static frontend plus separate VPS API

This option is **BLOCKED under the current implementation and restrictions**. The frontend API client uses root-relative /api paths and the live delivery socket uses a relative URL. On the generated static-app host, those requests stay on the frontend host. There is no repository or App Platform configuration that proxies those paths to an external VPS.

Even if the frontend were changed to call the API host, the browser would make cross-site requests. Current production refresh cookies are SameSite=Lax and host-only. Such cookies are excluded from cross-site fetch requests; setting fetch credentials to include only permits credentialed CORS and does not override SameSite. Setting SameSite=None would require Secure, remains subject to browser third-party-cookie controls and changes the CSRF threat model. Do not adopt it as a deployment workaround.

The current backend also constrains Google’s callback origin to FRONTEND_URL. A callback on the VPS origin conflicts with that rule when FRONTEND_URL is the App Platform host; a callback on the frontend host has nowhere to reach the external VPS under the supported App Platform component rewrite feature. Stripe and email links could be configured to separate hosts, but that would not fix browser auth/socket behavior.

**Required to reconsider A:** an approved same-origin reverse proxy at the frontend hostname, or a deliberate auth/session architecture redesign with CSRF, CORS, browser privacy and OAuth review. App Platform rewrites alone cannot proxy to an external domain. A purchased domain with sibling subdomains could make requests same-site but still cross-origin and require CORS/socket changes; it is outside the no-purchase constraint and does not solve callback routing by itself.

### B — Single-origin VPS

This is the most compatible topology with existing code. Nginx terminates TLS and serves the React build. Browser requests to /api, /socket.io and delivery REST routes stay on that origin. The API validates session cookies, CSRF-sensitive Origins and Socket.IO auth as it does now. The frontend’s two in-memory token scopes and role-specific refresh-cookie paths remain on one origin without a cross-site cookie dependency.

This fit does not prove browser compatibility. Required evidence still includes a production-like browser run for customer and admin login, refresh rotation, concurrent tabs, logout/revocation, CSRF rejection, Socket.IO polling and WebSocket paths, reconnect, deep links and unknown-host behavior.

**Hostname choices:**

- A raw public IP avoids domain purchase and can receive a publicly trusted short-lived IP certificate with current Let’s Encrypt support. The current Nginx Compose mount only consumes certificate files; it does not issue, renew, install or reload them. Certbot 5.4+ can request IP certificates using webroot, but the normal Nginx/Apache installer plugins do not install IP certificates. A custom deploy hook, renewal monitoring and tested recovery are required. Let’s Encrypt recommends frequent renewal for these short-lived certificates.
- A free dynamic-DNS hostname can provide a human-readable TLS name without purchasing a domain, if a selected provider permits the required stable record, verification and production use. No provider has been selected or tested. It is still a provider-controlled subdomain; Google OAuth may require a domain the app owner owns or is authorized to use, so do not assume such a hostname qualifies.
- A generated Cloudflare Pages hostname can be used for C, not as a hostname attached to the direct VPS without a proxy.

Raw-IP URLs are operationally brittle: recreating the Droplet may change the address, and OAuth, Stripe webhook registration, email URLs, allowlists and certificates must then be updated. The one-month experiment must not be treated as a durable production hostname.

### C — Free same-origin edge proxy

Cloudflare Pages can serve static assets on a provider-generated hostname and Pages Functions/Workers can route selected paths to a VPS. Static requests are free/unlimited under the cited Pages model; Functions are Worker requests. The Workers Free plan currently documents a 100,000-request/day limit and a 10 ms CPU time limit per invocation. This can satisfy “no purchased domain and no unapproved paid service” only if the account stays on the free plan and traffic stays within quota. Quota exhaustion is a service availability failure; do not rely on an automatic paid upgrade.

This is a **viable candidate topology**, not a verified implementation. The proxy must preserve all Set-Cookie headers and cookie attributes, forward the incoming Cookie and Origin safely, preserve request bodies and Stripe-Signature without parsing/re-serialization, proxy Engine.IO polling and WebSocket frames/upgrades, enforce a fixed origin target, and fail closed. Tests must cover connection close, reconnect, timeouts and origin outage. An origin access control is also needed so clients cannot bypass the Worker and send spoofed forwarding headers to the VPS. The backend’s current trust proxy count assumes one proxy hop; Cloudflare Worker to Nginx to Express changes that boundary.

The generated Pages hostname is not a domain the operator owns. Google OAuth domain ownership/verification and any production OAuth consent requirements must be checked before relying on this option. It also leaves the full AI/API workload on the VPS.

## Authentication and session compatibility

Repository inspection confirms:

- Frontend requests use relative /api paths and include credentials. Admin and customer tokens are held in separate in-memory scopes.
- The backend sets refresh cookies as HttpOnly, production Secure, SameSite=Lax, and with role-specific /api/auth/admin or /api/auth/customer paths. Cookies are host-only because no Domain attribute is set.
- Google OAuth transaction cookies use secure production settings and Lax behavior; the backend requires GOOGLE_REDIRECT_URI to share the configured FRONTEND_URL origin and expected callback path.
- Existing CORS is configured for the exact FRONTEND_URL with credentials. Sensitive cookie-authenticated flows use exact Origin checks, including account deletion and OAuth linking. This is not a universal CSRF-token system; do not broaden cookie policy or weaken Origin checks as topology glue.
- Socket.IO uses the /delivery namespace over the /socket.io transport path and sends the in-memory access token through Socket.IO auth, not in a URL.

Consequences:

1. A is a cross-site browser session. CORS does not cause a Lax cookie to be attached to a cross-site fetch. SameSite=None is not a demonstrated fix and is explicitly not recommended as a shortcut.
2. B preserves the existing origin and cookie model. Secure requires HTTPS; browser behavior remains unverified.
3. C preserves the browser-visible origin only if the edge behaves as a transparent, correctly constrained reverse proxy. Cookie Domain rewriting should not be needed when the browser sees the edge host, but forwarding must be proven in an actual browser.
4. Admin and customer session paths must remain separate in all proxy routing and tests. Never accept a client role as authorization.

## Nginx routing design for B

The existing production Nginx file is an API-only configuration. It forwards /api/ and /socket.io/ to Express and returns 404 for all other HTTPS paths. The following is a target design, not an applied change:

1. Define an explicit canonical hostname (or exact public IP) in the application server block. Reject unknown HTTP and HTTPS Host values with a default server response such as 444/421. Do not redirect using arbitrary $host. If HTTP redirects, construct the redirect with a configured canonical authority. Keep the ACME challenge route narrowly scoped.
2. Expose only ports 80 and 443 on the host. Keep Express, AI service and all workers private on Compose networks; never publish their ports directly.
3. Serve Vite output from a read-only web root. Return index.html for known client-side routes using SPA fallback. Give hashed assets immutable cache headers; keep HTML entrypoints revalidatable/no-cache. Do not let the SPA fallback mask missing API or socket routes.
4. Forward /api/ to Express with the existing path intact, controlled request/proxy headers, bounded request body/timeouts, and request ID handling. Preserve exact raw request bytes and Stripe-Signature on /api/webhooks/stripe so the existing signature verifier can validate them.
5. Forward /socket.io/ to the same Express server with HTTP/1.1 Upgrade and Connection headers, buffering disabled, polling support retained and idle timeouts longer than the configured Socket.IO heartbeat. Keep /delivery as the Socket.IO namespace; it is not an independent HTTP route. REST delivery endpoints are already under /api/.
6. Keep /api/docs and /api/openapi.json disabled in production. Add explicit no-store behavior for health or sensitive responses if those paths are reachable through the public vhost. Do not serve internal health checks publicly.
7. Configure real TLS protocols, certificate paths and renewal hooks; add HSTS only after the canonical HTTPS hostname and recovery path are verified. Confirm headers do not override security behavior on auth or webhook routes.
8. Verify Host, forwarded-proto and client-IP handling. The backend sets trust proxy to one hop, appropriate only when the immediate trusted proxy boundary is actually one hop. Do not let public clients choose X-Forwarded-For/Proto values.

The existing config already has a Socket.IO upgrade block and denies docs, but its port 80 listener redirects to https://$host$request_uri and its HTTPS default server is not an explicit host allowlist. It has no static root or SPA fallback, no HSTS, and no certificate automation. Do not interpret its YAML parse or prior static review as an Nginx syntax/runtime verification.

## TLS, hostname and external callback feasibility

Let’s Encrypt announced short-lived certificate and IP-address certificate availability in 2026. IP certificates have a 160-hour lifetime. The current Certbot webroot flow supports IP issuance in Certbot 5.4+, but does not install the certificate into Nginx; the Nginx plugin does not support installing IP certificates. Automating renewals around a short-lived certificate requires a tested deploy hook that validates files, atomically installs them, reloads Nginx and alerts on failure.

Google’s web-server OAuth rules require HTTPS redirect URIs in production, reject raw IP redirect hosts (apart from localhost development), and require a public-suffix domain. Google’s OAuth policy further requires use of domains owned by or explicitly authorized to the app owner. Therefore:

- **Bare IP + Google OAuth:** BLOCKED.
- **Free DDNS + Google OAuth:** NOT VERIFIED until the exact provider hostname and project authorization/verification requirements are accepted.
- **Pages-generated hostname + Google OAuth:** NOT VERIFIED; it is provider-controlled, not operator-owned.
- **Single origin without Google OAuth:** TLS on a raw IP is technically feasible, but lifecycle automation and browser validation remain unverified.

Stripe’s webhook route is already under /api and verifies Stripe signatures in the application. A stable HTTPS URL is needed and the configured Test Mode endpoint must be updated/confirmed by an authorized operator; this evaluation did not call Stripe or alter provider configuration. Brevo transactional email links use COMMERCE_EMAIL_ORIGIN with FRONTEND_URL fallback, so B/C can use their canonical browser origin after configuration. No email was sent. Changing a Droplet IP or hostname requires corresponding OAuth, Stripe, email and allowlist updates.

## $6 VPS capacity assessment

DigitalOcean’s current public Basic Droplet listing was checked for this assessment: **$6/month, 1 shared vCPU, 1 GiB RAM, 25 GiB SSD and 1,000 GiB transfer**. Pricing, included transfer, optional backup charges and plan availability must be rechecked before any purchase. This is shared CPU with no GPU.

The repository’s production Compose file includes the Node/Prisma API, CPU-only FastAPI AI service and Nginx. Profile-gated payment, commerce-email and AI media-worker services are also defined. Profiles prevent accidental activation; they do not prove the required production feature set can fit if those jobs must run. Runtime memory/CPU values are required environment settings and intentionally have no unmeasured defaults.

Checked-out AI artifact files total approximately 186,742,169 bytes (178 MiB) for the encoder plus D3 relevance artifacts and 227,228,724 bytes (217 MiB) across the local AI model artifact directory. These are disk sizes only, not memory measurements or evidence that a production artifact package is complete. The encoder loader reads sharded safetensors into a state mapping, creates the model, converts/loads weights and performs warmup. The media worker builds its own encoder process when enabled. Runtime memory can therefore exceed the stored weight bytes and may include duplicate checkpoint/model tensors, Python/PyTorch overhead, image decode buffers and concurrent requests.

The default image limit is 8 MiB and the pixel cap is 40 megapixels. A 40 MP RGB image alone is about 120 MB when decoded to one uncompressed buffer; resizing, copies, inference tensors and parallel requests can raise the transient peak. This is a lower-bound illustration, not a measured process peak. The API, Prisma, Node workers, Nginx, Docker/containerd, operating system and AI model all compete for 1 GiB. AI inference is CPU-only and shares one variable shared vCPU with API and worker activity. This is a credible OOM, swap-thrash, CPU saturation, slow startup and restart-loop risk.

The 25 GiB disk is not disproven as sufficient, but image layers, retained releases for rollback, package trees, model artifacts, logs and container metadata have not been measured. The backend Docker runtime copies broad repository/backend dependencies rather than demonstrating a pruned production image, so image size is unknown. No disk budget or log rotation evidence establishes safe headroom. Swap, if configured, is disk-backed and cannot substitute for RAM during inference; no swap behavior was measured.

| Dimension | $6 VPS conclusion |
|---|---|
| Running Nginx and the Node API alone | Technically feasible, but still needs actual memory/CPU measurements and configured limits. |
| Serving the React build from Nginx | Technically feasible and relatively small compared with model inference; build/image size not measured. |
| Running the required CPU SigLIP2 AI service with API and Nginx | **Feasible only with measured limitations; currently NOT VERIFIED.** One shared vCPU and 1 GiB make this a high-risk fit. |
| Running media inference worker concurrently with AI API and API | **Feasible only with measured limitations; currently NOT VERIFIED.** Separate worker may load a second encoder process and compete for the same memory/CPU. |
| Running every required API, AI and job profile reliably on one Droplet | **Not approved by available evidence.** No measurements demonstrate safe coexistence or workload headroom. |
| Disk fit and rollback retention | **NOT VERIFIED.** Model artifacts fit in a fraction of nominal disk, but container image sizes and safe retention were not measured. |
| Production latency, throughput, inference capacity, OOM margin | **NOT VERIFIED.** No performance measurements were invented or run. |

Do not silently omit the AI service or required workers to make the plan fit. An authorized experiment would need a disposable VPS, representative model artifacts, the intended Compose profiles and concurrency, actual login/API/socket/image workloads, cold-start and steady-state memory/CPU measurements, disk and log budgets, restart/OOM observations, and explicit pass/fail headroom criteria. The experiment must be separately approved; this task did not create or access a VPS.

## Cost and operational risks

- The $6 plan is a base Droplet price, not the full service cost. Backups, snapshots, volumes, domains (if later selected), external monitoring and email/provider usage may add cost. Confirm current prices before authorization.
- DigitalOcean App Platform currently lists up to three free static sites with 1 GiB outbound transfer per app/month and $0.02/GiB for overage. Bandwidth is pooled at team level; the console does not provide a live accrued overage total. Do not represent A as unconditionally free.
- DigitalOcean’s candidate Droplet transfer allowance is 1,000 GiB. Browser assets, API responses, image-search traffic and Cloudflare-to-origin responses consume transfer; a high-volume or abusive public service can exhaust the allowance. No traffic forecast exists.
- Cloudflare option C avoids a purchase only while using the free plan and within the current documented request/CPU quotas. Quota changes or exhaustion may require service degradation; no paid upgrade is authorized.
- The single VPS is a single point of failure. Host maintenance, disk exhaustion, kernel/Docker failure, resource exhaustion or a compromised container can take down all customer/admin routes, realtime events and AI.
- Restore and rollback must include the exact application SHA, image retention, compatible schema state, model artifact manifest, env/config backup and certificate recovery. Compose alone does not provide a proven release mechanism.
- Nginx startup depends on API health and mounted certificate files. No certificate bootstrap or renewal/reload service exists; first boot and failed renewal are operational gaps.
- AI health currently checks process liveness only; it does not prove model/index readiness. Worker services lack health checks, and restart is set to no. Operational monitoring/runbooks must distinguish a healthy process from a usable model and a drained/failed worker.

## Security implications

### Benefits

- One browser origin avoids cross-site refresh-cookie dependence and reduces cross-origin surface.
- Existing HttpOnly/Secure/Lax and role-scoped path cookies can remain intact.
- Compose publishes only Nginx ports and keeps API/AI services on private networks; app containers use non-root/read-only patterns in their Dockerfiles.
- The production migration workflow was changed to a manual exact-SHA gate rather than an automatic deployment trigger.

### Risks and controls required

- One Droplet raises the blast radius: a kernel, Docker socket or host compromise can expose the app, AI and secrets. Keep a small least-privilege service set, avoid mounting the Docker socket, keep secrets outside images, restrict SSH, patch the host and document recovery.
- Ensure the AI service and workers are unreachable from the public interface. Validate Compose networks and bind addresses on the actual host.
- Reject unknown Host values; never reflect arbitrary Host into redirects. Validate forwarded headers at the trusted proxy boundary.
- Keep Stripe webhook raw bytes intact, verify signatures, preserve idempotency and remain in Test Mode until explicitly approved.
- C has additional trust in the edge account and Worker code. Lock the origin to the proxy where practical, use a high-entropy origin credential if needed, and prevent spoofed X-Forwarded-* headers. Do not treat provider TLS as proof the origin is protected.
- Do not widen CORS, set SameSite=None, add broad Domain cookies or weaken CSRF/Origin checks as a proxy workaround.
- Do not expose docs/OpenAPI, worker ports, AI endpoints or health internals publicly.
- No Google OAuth, Stripe, Brevo, Supabase PROD, push, or AI provider changes were made or verified.

## Prompt 1 implementation review

The review covered the current uncommitted production changes and the repository implementation. The working tree already contained uncommitted Prompt 1 work; this report preserves it. No existing file was edited by this assessment.

### Material gaps and defects

1. **No application release workflow (HIGH).** The Compose file expects electrohub/backend and electrohub/ai-service images tagged by RELEASE_SHA, but the reviewed changes do not define an exact-SHA image build, registry push, host pull/deploy, health-gated switch, rollback or image-retention workflow. The manual production migration workflow is not an application deployment workflow.
2. **No frontend in production Compose (HIGH for B).** Production Nginx explicitly returns 404 for all non-API paths; there is no frontend build/image or static mount in Compose. This implements A’s API edge shape, not B’s single-origin target.
3. **Unsafe host redirect (MEDIUM/HIGH).** The HTTP default server redirects to an HTTPS URL built from $host$request_uri without an explicit canonical-host allowlist. Unknown Host values should be rejected and not reflected.
4. **TLS lifecycle missing (HIGH).** Compose mounts TLS files and the ACME webroot but does not issue or renew certificates, run a deploy hook, reload Nginx, monitor expiry, or test recovery. Missing files can prevent first startup.
5. **Container/release evidence absent (HIGH).** Docker was unavailable in the prior implementation environment, so builds, Compose config, container smoke tests, Nginx syntax and actual image size were not demonstrated. The image tags are SHA-based but not registry/digest-pinned evidence; tags alone do not prove immutable release content.
6. **Resource profile unmeasured (BLOCKER for $6 approval).** Required memory/CPU limits intentionally fail until populated from measurements. This is a sound guard, but confirms deployment is not ready. AI model health is liveness only and worker health checks are absent.
7. **AI artifact contract needs reconciliation (MEDIUM).** The deployment/release description refers to a single model.safetensors-style encoder name, while the checked-out model directory and loader use ten encoder shards plus projection weights and a separate relevance artifact. Reconcile artifact identity, size/checksum and mount paths before a real host experiment.
8. **Admin bootstrap remains unverified.** The new provisioning CLI/schema migration are within the task preparation scope and appear designed as additive, controlled provisioning. They were not executed or tested against a disposable database in this evaluation, and the migration was not applied. Do not infer production-admin state from repository code.
9. **No edge/browser acceptance evidence (BLOCKER for release).** There is no demonstrated browser matrix for customer/admin refresh cookies, concurrent refresh, CSRF, Google OAuth callback, WebSocket upgrade/polling/reconnect, deep links or unknown Host behavior. No production/provider state was checked.
10. **Potential proxy-chain change for C (HIGH).** Existing Express trust proxy is set to one hop. C adds an edge hop and needs a strict, tested forwarded-header and client-IP policy; simply retaining the current hop count is unsafe or incorrect depending on route path.

### Useful Prompt 1 work observed

- Production environment validation and examples, secret separation, private service networks, read-only/non-root runtime patterns, resource-limit placeholders and worker profiles.
- A manual exact-SHA production migration gate and policy changes. GitHub environment protection settings/reviewer configuration remain external and were not verified.
- A production admin-bootstrap CLI and additive Prisma migration, with task-specific preparation.
- Documentation and release-manifest preparation.

These changes make repository-side preparation materially useful, but they are not sufficient to proceed to public deployment. The existing migration workflow’s controls do not prove remote CI passed or that GitHub has the expected environment reviewers.

### Existing verification evidence versus this assessment

The Task 06.3 implementation evidence records earlier local passes for focused backend env tests (13/13), admin-team service tests (22/22), backend typecheck/build/lint, frontend production build, workflow safety tests (29/29), YAML/JSON/env parsing, Prisma client generation and static policy checks. It records Docker/Compose/Nginx runtime, browser auth/socket, providers, remote CI, database and load tests as unverified.

This architecture assessment performed repository/source review and official documentation/pricing review only. It did not rerun tests, build containers, start a browser/server, contact Supabase PROD, Stripe, Brevo, Google OAuth or Sentry, inspect remote CI, or load-test a VPS. The recorded previous local checks are not proof of deployment or browser compatibility.

## Required implementation changes by option

### If B is selected

- Add a frontend production build to the release artifact and serve it under the same canonical host in Nginx.
- Add explicit host allowlisting/rejection, fixed-authority HTTP redirects, SPA fallback and cache policy.
- Add automated TLS bootstrap/renewal/deploy-hook/reload/expiry monitoring for the selected IP or DNS hostname.
- Add an exact-SHA build/publish/deploy workflow with registry/auth controls, digest verification, health checks, rollback and retained artifacts.
- Measure and set host/container memory, CPU, disk, logs and concurrency limits; establish AI model readiness and worker health monitoring without omitting required features.
- Resolve whether Google OAuth is required. If it is, choose and verify an eligible hostname before any deployment.
- Add browser tests for customer/admin auth and refresh, cross-tab rotation, CSRF, OAuth, Socket.IO and delivery deep links; verify Stripe Test Mode webhook raw-body handling only after explicit provider authorization.
- Reconcile the AI artifact manifest against actual file names, checksums and model loader expectations.

### If C is selected

- Implement Pages/Worker routing for static assets, /api/* and /socket.io/* under one provider hostname, with a fixed origin and no generic proxy behavior.
- Preserve cookies, Origin, Stripe signature/raw body, streaming, response status and multiple Set-Cookie headers; protect the origin from direct access and spoofed forwarding headers.
- Prove Engine.IO polling and WebSocket upgrade/close/reconnect using real browsers and an origin outage case.
- Validate request/CPU quotas and safe behavior at quota exhaustion without upgrading to a paid plan.
- Verify OAuth domain eligibility or explicitly defer Google OAuth.
- Complete the same VPS capacity, TLS-to-origin, release, monitoring and rollback work as B.

### If A is reconsidered

- It needs a same-origin reverse proxy under the frontend hostname, which the current App Platform rewrites do not provide to an external VPS; or a reviewed session/auth/CSRF architecture change. A custom-domain sibling-host setup is not available under the current no-purchase constraint. Re-evaluate cookie privacy, CORS, socket auth and Google callback routing before implementation.

## Remaining unknowns and evidence needed

| Unknown | Evidence needed |
|---|---|
| Is Google OAuth required for this production/review release? | Operator confirmation; if yes, exact hostname and Google OAuth console acceptance/ownership evidence. |
| Is a third-party free dynamic-DNS hostname acceptable? | Operator decision and selected provider terms, stability/renewal behavior, DNS control and certificate proof. |
| Can the complete production Compose service profile run safely on 1 GiB? | Separately authorized disposable VPS experiment with intended services/artifacts, concurrent workload, peak/steady RSS, CPU, disk, OOM, startup and rollback measurements. |
| Does raw IP TLS renew and recover correctly? | Automated renewal/deploy-hook rehearsal on disposable host, including failed renewal alert and Nginx reload recovery. |
| Do browser sessions work on B/C? | Automated browser tests on customer/admin login, refresh/cookie rotation, role isolation, logout, CSRF, OAuth, polling, WebSocket and reconnect. |
| Can Cloudflare Pages/Functions relay the full protocol within free quotas? | Implemented disposable prototype, WebSocket/polling/raw-body/cookie tests, quota controls and origin-bypass review. |
| Does Stripe accept and reach the chosen public endpoint? | Authorized Stripe Test Mode endpoint configuration and signed webhook delivery evidence. No live mode. |
| Do Brevo links and delivery routes resolve correctly on the canonical hostname? | Test-template inspection plus authorized test email and route checks. No email was sent here. |
| Are production image builds small and reproducible? | Docker builds, image size reports, digest evidence, vulnerability scan and rollback retention rehearsal. |
| Are remote workflow/environment approvals configured? | GitHub workflow run evidence and environment protection settings from an authorized connected source. Not verified here. |

## Next step and approval boundary

**Recommended next step:** approve one architecture direction for further repository-only work:

1. **B — Single-origin VPS design**, using an operator-approved free hostname approach. Keep Google OAuth, TLS automation and capacity as hard gates.
2. **C — Free Cloudflare Pages/Worker proxy prototype**, if the operator accepts a provider-controlled hostname and a free-plan quota as an availability limit.
3. **Hold public exposure** until hostname/OAuth and capacity constraints are clarified.

Please approve one direction. That approval would authorize architecture/design or prototype work only; it would **not** authorize buying a domain, creating a VPS, spending money, publishing the frontend, exposing an API, changing auth/cookies/CSRF, changing provider settings, deploying artifacts, running migrations or activating workers.

## Sources

### Repository evidence

- [Task 06.3 implementation evidence](TASK_06.3_IMPLEMENTATION_EVIDENCE.md)
- [Task 06.3 deployment architecture audit](TASK_06.3_DEPLOYMENT_ARCHITECTURE_AUDIT.md)
- [Approved Task 06.3 specification](../tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT.md)
- [Task 06.3 revised draft](../tasks/Phase-06/TASK_06.3_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_REVISED_DRAFT.md)
- [Production Compose](../../infrastructure/production/compose.yaml)
- [Production Nginx](../../infrastructure/production/nginx.conf)
- [Frontend API client](../../apps/frontend/src/lib/api.ts)
- [Production frontend Nginx](../../apps/frontend/nginx.conf)
- [Backend environment validation](../../apps/backend/src/config/env.ts)
- [Express application setup](../../apps/backend/src/app.ts)
- [Socket.IO delivery gateway](../../apps/backend/src/sockets/delivery.gateway.ts)
- [Delivery Socket.IO client](../../apps/frontend/src/features/delivery/realtime/deliverySocket.ts)
- [Backend Dockerfile](../../apps/backend/Dockerfile)
- [AI service Dockerfile](../../apps/ai-service/Dockerfile)

### Current external references checked 2026-11-17

- [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets)
- [DigitalOcean App Platform pricing](https://www.digitalocean.com/pricing/app-platform)
- [DigitalOcean bandwidth billing](https://docs.digitalocean.com/platform/billing/bandwidth/)
- [DigitalOcean App Platform URL rewrite scope](https://docs.digitalocean.com/products/app-platform/how-to/url-rewrites/)
- [Let’s Encrypt IP and short-lived certificate availability](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Let’s Encrypt Certbot IP support](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
- [Let’s Encrypt certificate FAQ](https://letsencrypt.org/docs/faq/)
- [Google OAuth web-server flow and redirect URI validation](https://developers.google.com/identity/protocols/oauth2/web-server?hl=en)
- [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies)
- [MDN Set-Cookie SameSite behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [MDN Fetch credentials](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
- [MDN credentialed CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [Cloudflare Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)
- [Cloudflare Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Cloudflare Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers WebSocket example](https://developers.cloudflare.com/workers/examples/websockets/)
- [Cloudflare Workers WebSocket runtime](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
- [Stripe webhook endpoint connectivity guidance](https://support.stripe.com/questions/webhooks-how-to-investigate-and-fix-connection-to-remote-host-denied?locale=en-GB)
