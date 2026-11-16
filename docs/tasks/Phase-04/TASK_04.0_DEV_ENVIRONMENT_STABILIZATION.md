ELECTROHUB — TASK 04.0 / DEV ENVIRONMENT STABILIZATION
Phase: 04 — Pre-Phase-04 Infrastructure & Commerce Reliability Gate (before roadmap Task 04.1 FastAPI AI Service)
Task: 04.0 — Main DEV + Isolated QA Separation, Safe Stripe Test Mode, Supabase Connectivity & Full-Stack Performance
Proposed branch: feature/DEV-Environment-Stabilization (create locally from the verified current develop; do not base on an outdated PDF branch)
Base / integration target: current approved develop after source/working-tree verification
Remote repository inspected: oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform
Remote snapshot inspected: 2026-10-20; develop = 28d828c1a52b92e4bac17ebb96b827cb1ad8be3b; feature/PDF-Documents = a0bd4ba1bcfbc942581875fb7613df8a0b2acb02, zero ahead / one behind develop at inspection. Re-check at task execution: remote or local branches can move.
Proposed file location: docs/tasks/Phase-04/TASK_04.0_DEV_ENVIRONMENT_STABILIZATION.md
Prepared: 2026-10-20, Asia/Beirut
Scope: Frontend/Vite/React Query; Express/Prisma; Supabase DEV; isolated local PostgreSQL; Stripe Test Mode; webhook and fenced recovery; commerce email; PDF; environment identity; security; database/connection performance; observability; Windows developer workflow; tests/QA; operations and rollback.
Status: AUTHORITATIVE IMPLEMENTATION SPECIFICATION / NOT IMPLEMENTED BY THIS DOCUMENT. No code, remote DB, live provider, CI or deployment action has been carried out by creating this specification.
Execution boundary: The implementation assignment authorizes locally scoped source edits, new scripts/tests/docs, offline tooling, local disposable fixtures, synthetic PDFs, safe builds and offline tests in the assigned worktree after ownership checks. This document does not alone approve shared-DEV/PROD database writes, external Test Mode Stripe mutations, live Brevo sends, CI secret changes, cloud provisioning, migration execution, commits, pushes, merges or deployments. Obtain the task-owner and protected-workstream authorizations required by AGENT_COORDINATION.md; then perform those specifically approved actions without repeated permission requests. No production payments or customer communications are in scope.
Outcome: A developer opens the normal localhost:3000 ElectroHub frontend, uses the intended Express backend on :5000, and works against persistent Supabase DEV with legitimate Stripe Test Mode checkout, payment retries/recovery, order history, captured/allowlisted commerce email, and authenticated PDFs. AI coding agents and destructive E2E tests use a separate, fast, verified, resettable local PostgreSQL backend/frontend, without accidentally writing to DEV/PROD. The system explains and measures any residual latency and can be safely started, stopped, switched, diagnosed and rolled back. Finish with real front-to-back evidence, not just green unit tests or an investigation report.

0. Executive architecture contract — read first
                     MAIN / PERSISTENT DEVELOPMENT
  Browser DEV :3000  ──same-origin /api proxy──► Express DEV :5000
                                                │
                                JWT/auth, checkout, orders, email status,
                                document metadata + PDF rendering
                                                │
                                     Prisma / pg adapter
                                                │ verified TLS
                                                ▼
                           Supabase `electrohub-dev` PostgreSQL
                           project pzxekjybdiulzmssalfo
                                                │
               Stripe TEST listener + exactly governed recovery runner
               Commerce email capture or approved-test-mailbox worker

                     ISOLATED / DISPOSABLE AGENT QA
  Browser QA :3200   ──explicit /api proxy─────► Express QA :5200
                                                │
                                     Prisma / pg adapter
                                                │ verified TLS
                                                ▼
                          local PostgreSQL 17 :55434
                            `electrohub_disposable`
                             agent-owned fixtures
               Stripe mocks/test-safe scoped operations; email CAPTURE

                     PRODUCTION / OUT OF TASK WRITE SCOPE
  Production frontend ─► production backend ─► distinct PROD Supabase
                   NO Task 04.0 application writes or deployment
### Mandatory visual and UX invariants (Task 04.0 execution)

1. MAIN DEV :3000 uses API :5000 and persistent Supabase DEV; isolated :3200 uses only API :5200 and its disposable DB.
2. Render Payment Element only when backend capability is known and genuinely ready. Disabled/unknown state is truthful and recoverable.
3. Preserve checkout hierarchy, navigation, loading states and a single Place Order action; never automatically repeat a charge.
4. Payment success requires authoritative provider/persisted facts, never a redirect, spinner, email or frontend cache.
5. Cart, Orders, retries, email notices and document actions remain usable on mobile. Preserve ElectroHub typography, colors, spacing, icons and square-radius tokens.
6. Verify affected UI at 320, 390, 768, 1440 and 1920px and 200% zoom, with keyboard, focus restoration, accessible names, loading/errors. Open and inspect actual screenshots.

### Mandatory unit and domain invariants (Task 04.0 execution)

1. NODE_ENV=test alone grants no shared/PROD mutation authority. Isolated tests never inherit DEV/PROD write permission.
2. Runtime payment permission requires verified environment identity and an approved supervisor; wrong DB/project/provider mode fails closed.
3. DATABASE_URL and DIRECT_URL identify one logical project; legitimate direct/pooler endpoints may differ physically. Shared DEV Stripe is Test Mode only.
4. Preserve PaymentAttempt, PaymentWork, leases, fencing and UNKNOWN semantics. Timeout/retry never automatically creates a second charge.
5. Startup never reconciles/cancels unapproved historical payment work or dispatches unapproved email backlog.
6. PDF operations remain authenticated, owner-scoped and read-only. Prisma is schema/migration authority; never falsify checksums/history.
7. Listening on a port does not prove DB/payment/worker readiness. Rollback preserves financial records, unresolved outcomes, orders/inventory and outbox rows.

Map these invariants to actual tests/evidence in TASK_04.0_IMPLEMENTATION_EVIDENCE.md; unverified runtime invariants remain explicitly pending.

A. Required user experience and operational invariants
1. The default daily DEV experience must use persistent shared Supabase DEV, not the isolated fixture database. Developer login, cart, products, checkout, saved orders and PDFs persist between API restarts.
2. The default agent E2E experience uses local disposable PostgreSQL and its separate backend/frontend ports; dev:isolated remains reliable, resumable, and safe from shared environment override.
3. On an approved supervised DEV runtime, payment setup, dismiss, retry, confirm, webhook reconciliation and recovery are genuinely available with Stripe TEST credentials. Do not make checkout appear operational by mocking the payment capability response in the real DEV browser.
4. Never eliminate financial safety to make a button work. An unapproved or hot-reloading shared-DEV API must not silently run reconciliation/recovery or allow unintended Stripe/DB payment mutations.
5. Production database, Stripe live credentials, and customer email are NEVER accessible through isolated test commands or DEV approvals. Any ambiguous identity/configuration fails closed before workers or mutations start.
6. NODE_ENV=test, npm_lifecycle_event, a frontend query parameter, a manually edited UI flag, or a mere DATABASE_URL string must not independently grant permission to write to a shared target.
7. DATABASE_URL and DIRECT_URL may legitimately use different hostnames/pooler modes, but must resolve to the same approved project/environment (not merely have similar strings). Verify both configured connections by appropriate safe means; do not compare naïve host:port/database strings as a substitute for project identity.
8. DEV/QA browsers, backend processes and data stores must not leak session state, refresh tokens, synthetic data, provider secrets, email recipients or PDF blobs across identities.
9. Payment success requires authoritative persisted provider-confirmed facts. Unknown outcomes are never turned into an automatic new charge or false paid state.
10. Checkout finalization, inventory, cart ownership, payment attempts, PaymentWork, order snapshots, outbox fencing and document eligibility retain their existing correctness guarantees from Tasks 03.5–03.9.
11. Never automatically apply remote schema migrations, seed shared DEV, clear financial records, reset a Supabase project, migrate to a new Supabase region, raise plan tier, or silently turn on live Brevo/Stripe services.
12. DEV performance must improve based on measured bottlenecks, not by arbitrary pool expansion, global timeout inflation, turning off SSL or deleting payment guards.
13. Do not use additional frontend banners, route redesigns, new payment methods or feature creep. Existing UI states should reflect real API capability and recover when environment readiness changes.
14. The existing Task 03.9 portfolio-only Arabic PDF compatibility exception remains exactly scoped; Task 04.0 must not claim it resolved or reopen PDF renderer work absent a direct regression. Native PDF preview fallback remains usable.
15. Use real, inspected browser screenshots and trustworthy backend/db/provider evidence for first handoff; no faked Test Mode charge, email or production readiness claims.
B. Explicitly out of scope
- Implementing 04.1 FastAPI or any Phase 04 AI feature; this task only prepares a reliable foundation.
- Database architecture migration from PostgreSQL/Prisma, replatforming commerce to Supabase client-side queries, replacing Express, or a new payment architecture.
- Production region migration or paid Supabase upgrade without separate cost, data migration and owner approval.
- Production deployment, live Stripe charges, unrestricted external email, user-data export, or existing historical payment rewrite.
- Optional Brevo PDF attachments (still deferred), new tax-invoice issuance, rewrite of Arabic shaping, admin feature work.
- Global frontend redesign, broad refactor, or unsubstantiated performance fixes.
1. Repository-first evidence and authority
1.1 Required FIRST implementation action — local and remote source inspection
Before coding, inspect the remote develop branch and the real local checkout; record their actual SHAs. This task was authored after read-only remote inspection, not from a guessed historic baseline. At specification time, remote develop was 28d828c1a52b92e4bac17ebb96b827cb1ad8be3b, and feature/PDF-Documents at a0bd4ba1bcfbc942581875fb7613df8a0b2acb02 was behind it. The latest develop commit includes the Task 03.9 integration; do not cherry-pick the old PDF feature unconditionally.
Minimum safe discovery:
 git remote -v
 git fetch --prune origin           # read remote refs only; confirm access first
 git branch -vv
 git status --short --branch
 git worktree list --porcelain
 git rev-parse develop
 git rev-parse origin/develop
 git log -8 --oneline --decorate origin/develop
 git diff --stat
- Never overwrite or reset a local working tree with uncommitted work. If the existing checkout is not safe to branch from, create a separate ordinary worktree from the verified remote/base. Register its path/ownership. Do not automatically delete old Claude/Codex worktrees or their untracked files.
- Proposed task branch: feature/DEV-Environment-Stabilization (do not invent that it currently exists). Branch only from the reviewed up-to-date develop or explicitly approved newer base; report exact SHA.
- If remote develop has changed, inspect the relevant delta and adjust the source decisions below. Do not pin implementation to the old SHA simply because this file quotes it.
- Check root AGENTS.md, AGENT_COORDINATION.md, docs/prompts/DEVELOPER_PROMPT.md, docs/prompts/REVIEW_PROMPT.md, architecture docs, migration guidance and the actual Task 03.5–03.9 implementation evidence.
- Follow the task registry and CCR/ownership protocol before modifying payment services, auth, shared API, database pools/isolation, CI, migrations or protected runners. Resolve those approvals early once, not via repeated indefinite review cycles.
1.2 Remote files inspected for this specification (at stated snapshot)
Inspected source	Verified implementation fact / design consequence
docs/01_Project Foundation/ROADMAP.md	Phase 03 ends at PDF 03.9, Phase 04 starts with 04.1 FastAPI AI Service, so 04.0 is an explicit new pre-04.1 infrastructure gate, not a replacement for 04.1.
AGENTS.md, AGENT_COORDINATION.md	Protected payment, DB/connection, auth, API, deployment and performance changes require owners/Architect; remote writes and commits are separately governed.
apps/backend/src/payment-isolation.ts	Disposable URLs are loopback/named; shared target currently needs exact PAYMENT_SHARED_MUTATIONS_APPROVED; watched npm run dev shared backend is denied. Crucially NODE_ENV=test currently allows writes without first proving a disposable DB.
apps/backend/scripts/dev-payment-runtime.cjs	Existing explicit shared-DEV supervisor: payment:dev:preflight, payment:dev; starts compiled API, Stripe CLI listener, payment runner and conditional supervised email worker; checks Test Mode credentials, TLS CA, connection headroom and migrations. Stop only owned processes.
apps/backend/scripts/stripe-gate-safety.cjs	Existing exact Supabase DEV project and Test Mode Stripe-account identification; conservative approvals, manifest and provider outcome checks. Reuse rather than inventing a second payment gate.
apps/backend/scripts/dev-isolated.cjs	Existing loopback PostgreSQL 17 cluster electrohub_disposable on :55434, TLS identity verification, guarded migrations/seeding, synthetic fixture credentials, isolated backend and commerce email capture. Preserve.
apps/backend/src/lib/prisma.ts	Runtime currently selects `env.DIRECT_URL
apps/backend/src/lib/database-adapter.ts	Real Prisma pg.Pool adapter with sanitized driver errors, pool statistics and recovery reporting. Preserve compatibility and safe logging; no global pg monkey patch.
apps/backend/src/payment-inprocess-recovery.ts, src/server.ts	In-process recovery can be enabled by payment isolation plus config; server starts HTTP before DB prewarm. Supervising a separate payment worker requires explicit process ownership and avoiding overlapping authority.
apps/backend/src/config/env.ts, apps/backend/package.json	Existing dotenv precedence, DATABASE_URL, DIRECT_URL, Stripe/Brevo flags and payment:dev / dev:isolated scripts. Do not introduce ambiguous competing dotenv behavior.
apps/frontend/vite.config.ts	Default Vite :3000 proxy target http://localhost:5000; configurable E2E_FRONTEND_PORT and E2E_API_PROXY_TARGET. These are browser-to-backend routing controls, not database authority.
apps/frontend/playwright.isolated.config.ts	Separate existing isolated suite; workers=1/retries=0 and no implicit live stack creation. Preserve isolation and make explicit environment preflight mandatory.
apps/backend/src/routes/payment.routes.ts, frontend paymentCapability.ts	Actual authenticated GET /api/checkout/payment-capability returns payment write capability; frontend caches scoped to user and handles 503 PAYMENT_MUTATIONS_DISABLED. No new public payment-enable toggle needed.
docs/tasks/Phase-03/TASK_03.6_RECURRING_CHECKOUT_ERRORS_AND_ISOLATED_DEV.md	Current localhost:3000 → :5000 → shared DEV watched server refuses payment writes as designed; Task 03.6 remains OPEN in that report, whereas a separate disposable stack proved safe dismissal. Solve the operating model, not just the UI banner.
docs/10_Operations/COMMERCE_EMAIL_RUNBOOK.md, apps/backend/scripts/lib/commerce-email-dev.cjs	Commerce email has independent safe send modes, deliberate enablement, supervised worker; must not send arbitrary shared-DEV pending backlog after changing runtime configuration.
docs/tasks/Phase-03/TASK_03.9_PDF_DOCUMENTS.md	Real order documents are owner-scoped, read-only, bounded and independently verified; no new checkout side effects or schema columns.
docs/tasks/Phase-03/TASK_03.8_EMAIL_NOTIFICATIONS.md	Email outbox producer/dispatcher has protected, durable leases/journal/UNCERTAIN requirements; provider email acceptance is not payment settlement.


Actual local worktree and up-to-date deployment/Supabase account state were not accessible to this specification author. Every environment-dependent choice below has a preflight verification requirement; no live/DEV/PROD change is claimed.
1.3 Conflicts and decision precedence
1. Current task's explicit security/acceptance conditions.
2. Verified current code, migration ledger and protected contracts.
3. Repo agent/coordination ownership rules and task-scoped approved CCRs.
4. Architecture, operational docs, existing tests and prior accepted evidence.
5. External service documentation/current runtime measurements.
6. Inference (clearly labeled).
When documentation says a capability is complete but the actual launcher/DB says otherwise, report both; do not silently make a false PASS.
2. Workstreams, protected ownership and execution stages
Workstream	Primary responsibility	Potential protected dependencies	Verification
INTEGRATION (lead)	Orchestration, branch, task registry, env contracts, final QA	startup scripts, runbook	local effective diff, integration check
DATABASE + PERFORMANCE	Prisma URL resolution, TLS/connection budget, benchmark/read-only diagnostics	lib/prisma.ts, adapter, config, Prisma schema if justified	identity, p50/p95, capacity and transaction tests
PAYMENT	isolation guard and supervised DEV launcher/webhook/recovery	payment-isolation.ts, services, runner, Stripe CLI policy	negative matrix, exactly-once safety, genuine Test Mode scenario
FRONTEND + AUTH	API proxy/session environment isolation, capability UI, checkout UX	Vite config, shared API/auth, protected checkout	real-stack Playwright, 401/503, switching, accessibility
EMAIL + DOCUMENTS	worker mode, outbox backlog safety and DEV PDFs	commerce email config, document routes only if necessary	provider capture/allowlist, owner-scoped PDF
OBSERVABILITY	safe structured env identity, startup/readiness and perf report	logger middleware/adapter	sanitization tests, request/SQL correlation
ARCHITECT	One first-pass independent review; review protected cross-workstream decisions	CCRs, architecture	/100 + Approve/Changes/Reject


- Parallelize independent diagnostic and test ownership. Serialize edits to protected shared files. Do not let multiple agents modify the Prisma adapter, payment guard or frontend API client simultaneously.
- Prioritize a sound first implementation handoff: inspect → root-cause measurement → choose smallest solution → implement → focused tests → real-stack QA → review. Avoid endless audits and unnecessary test reruns.
- All cross-workstream approvals must name the actual changed paths, migration/rollback/test impact and owner; a blanket statement that the entire system is authorized is insufficient.
3. Environment identity, config and startup contracts
3.1 Explicit three-environment table
Property	MAIN DEV	ISOLATED AGENT QA	PROD
Browser	default localhost:3000	dedicated localhost:3200	deployed HTTPS site
API	supervised :5000	isolated :5200	production service
DB	persistent Supabase DEV project pzxekjybdiulzmssalfo	PostgreSQL 17 127.0.0.1:55434/electrohub_disposable	distinct Supabase PROD yepfgjehdstlxbpespun
Fixture lifecycle	never auto-reset or seed; approved synthetic customer only	resettable agent-owned test fixtures	no development fixtures/writes
Payment	Stripe Test Mode, approved single supervisor / recovery ownership	mocked by default; scoped Test Mode if approved	live-capable only under separate deployment/go-live gate
Commerce email	OFF/capture where safe or allowlisted approved test recipients	capture by default	separate production policy
PDFs	real authenticated persisted DEV orders	real synthetic PDF renderer	production readiness separately assessed
Session	DEV browser/profile	separate browser context/profile, no shared tokens	separate domain/profile
Safety	approved DEV writes only, stable runtime	disposable-only mutation approval	fail closed for all Task 04.0 tooling


The quoted Supabase project references are environment identifiers, not credentials. Never write connection strings, passwords, Stripe secrets, payment client secrets or email API keys to task evidence.
3.2 Configuration and precedence
- Extend/reuse one typed and validated environment configuration, not a second independent dotenv parser. Define documented precedence of .env, .env.local, explicit process variables and dedicated test-profile overrides. Explicit supervisor child process env must override stale parent values for the selected environment.
- Keep DATABASE_URL and DIRECT_URL roles distinct. DATABASE_URL is the application/pool candidate; DIRECT_URL is the migration/direct candidate unless the actual adapter and deployment constraints require a documented alternative. Select an explicit runtime source instead of accidentally preferring DIRECT_URL. Review Prisma adapter semantics, pooler compatibility and migration behavior before changing.
- Introduce a small trusted environment target descriptor shared by launch/preflight/worker startup: mode, expected project/dataset identity, data-plane transport category, provider mode, worker ownership, safety policy version. Do not take this descriptor from untrusted browser input.
- On startup, reject absent/malformed URLs, unexpected hosts, cross-project config, wrong username/database, unacceptable SSL/TLS configuration, contradictory DATABASE_URL/DIRECT_URL, duplicated active supervisors and wrong Stripe credential mode.
- Supabase pooler and direct hosts can differ legitimately. Identity resolution may use validated project refs in DNS/connection username, authenticated TLS and permitted read-only DB introspection. Avoid assuming a mere SELECT current_database() = 'postgres' uniquely identifies a Supabase project.
- Reject NODE_TLS_REJECT_UNAUTHORIZED=0, rejectUnauthorized:false, sslmode=disable on remote connections, unapproved proxy routes, production project references in DEV/QA, and a shared target masquerading under a loopback alias or test database name.
- A caller's NODE_ENV=test must never override runtime target verification, shared-write approval or provider-mode restrictions. Pure mocked tests can inject an isolated test decision dependency; integration tests require a verified disposable DB.
- Expose sanitized startup messages identifying MAIN_DEV, ISOLATED_QA, PRODUCTION, resolved database category, pool strategy, payment capability and worker ownership. Do not expose full URLs or useful project secrets to unauthenticated browser clients.
3.3 Browser/API environment routing
- Preserve Vite's default /api proxy to :5000 for DEV and explicit :5200 for isolated QA; fail if the expected target is not listening or identifies the wrong stack.
- Add a private developer-only environment handshake or assert environment in test setup against an existing protected diagnostic/capability response. Do not add a public endpoint that reveals service credentials or project topology; any new diagnostic endpoint must be non-production and either loopback restricted or authenticated/authorized. Existing public /api/health semantics must remain stable.
- Do not rely on a frontend environment variable, UI badge or React Query cache to provide payment/database authority. Backend decides capability.
- Prevent cross-environment auth confusion: localhost cookies are not inherently port-isolated. Use separate Playwright browser contexts/profiles and environment-scoped caches; if both stacks must run concurrently in a real browser, test distinct safe hostnames/origins/cookie strategies consistent with existing auth/CORS rules. Do not assume ports alone isolate cookies.
- Changes to auth host/domain/CORS, refresh tokens or shared api.ts require AUTH + architect signoff and negative cross-account/session tests; prefer avoiding such changes.
- Preserve UI labels, CheckoutProcessing, Retry, failed-payment dismissal, Orders and documents; show real capability (not fake success). 401/403/409/422/503 remain differentiated. Re-query capability on state change/rejection with bounded retries; do not repeatedly poll when payment is intentionally off.
3.4 Startup modes and operational ergonomics
Provide safe, documented scripts and one normal command sequence for each mode. Prefer extensions of existing scripts over a new orchestrator framework.
Main DEV:
1. Validate current backend build and .env.local without revealing secrets.
2. npm run payment:dev:preflight must verify target, Test Mode Stripe account, migration readiness, TLS, pool/headroom, supervised listener/worker ownership, and email send mode.
3. npm run payment:dev (or a clearly named replacement retaining compatibility) starts compiled API on :5000, Stripe listener with runtime signing secret, one governed payment runner, and the opt-in supervised commerce email worker.
4. Start frontend on :3000 targeting that backend. Avoid npm run dev hot reload against shared DEV for payment-capable operations; a hot-reload-only safe read mode may remain available.
5. The operator sees a truthful single startup report, clear failure remedy, and Ctrl+C stops only owned children, releasing leases safely and not killing another session.
Isolated QA:
1. db:isolated:init if not initialized; db:isolated:start/status as needed.
2. PORT=5200 npm run dev:isolated retains its verified TLS + local database identity check, guarded fixture seeding and default captured email mode.
3. Frontend on :3200 explicitly proxies to :5200; isolated Playwright tests require that handshake before test data mutation.
4. Stop via owned shutdown; never infer that a stuck port belongs to the current agent or kill unknown system processes.
Windows: Scripts must work on the user's Windows/PowerShell environment (or clearly specify required shell/runtime), including quoted paths with spaces and Unicode, process ownership/lock files, Stripe CLI spawn errors, partial startup cleanup and clean shutdown. Avoid relying solely on POSIX environment assignment syntax.
3.5 Startup capability/readiness and API status contract
- Keep GET /api/checkout/payment-capability compatible: authenticated boolean paymentsEnabled and existing no-store behavior. It must reflect the effective supervised runtime safety decision, not just presence of a Stripe key. Any additive safe reason code needs explicit compatibility tests and no internal project/path disclosure.
- Preserve health versus readiness distinction: a server listening on :5000 is not proof that the DB, Stripe listener, worker or email dispatch is ready. Add/extend a protected or local startup/readiness surface only if actually needed; express API_READY, PAYMENTS_READY, PAYMENT_RECOVERY_DEGRADED, EMAIL_CAPTURE, EMAIL_DISABLED, PDF_ASSETS_READY separately. Avoid changing public health contracts without consumers review.
- Do not return 200/payment-enabled during a preflight or partial child startup. On an owned worker crash, downgrade relevant capability truthfully; protect customers from false green states without claiming an already-submitted charge failed.
- All new diagnostic responses should be no-store, sanitized, bounded and restricted to appropriate local/admin roles. No secrets/PII.
4. Payment correctness: solve shared DEV without breaking guards
4.1 Preserve the reasons the guard exists
Task 03.6 recorded a watched shared-DEV backend whose in-process recovery affected prior test purchases. The intended fix is supervised ownership and explicit target/runtime attestation, not removal of payment isolation.
Requirements:
- A shared DEV API may perform legitimate Stripe Test Mode mutations only when launched via the approved stable supervisor and all safety preflight criteria pass.
- An unsupervised/hot-reloaded shared DEV backend cannot gain permission from a copied environment flag, npm_lifecycle_event trick, NODE_ENV=test or a different DIRECT_URL.
- Disposable runs are allowed only after local DB identity, TLS and test-mode/payment policy verification. A loopback host alone is insufficient.
- Shared DATABASE_URL and DIRECT_URL must match the expected Supabase project even when one uses the direct host and one uses session pooler host.
- Production payment behavior remains governed by its own approved deployment/provisioning policy; do not accidentally make PROD always disabled or accidentally enable PROD through DEV heuristics.
- Scope permissions: setup/dismiss/webhook ingestion, provider mutations, batch recovery, and Brevo dispatch have distinguishable capabilities, not one blanket unsafe switch if their risk differs.
4.2 Safe DEV payment supervisor
Inspect and extend dev-payment-runtime.cjs, stripe-gate-safety.cjs, payment-isolation.ts, stripe-webhook.routes.ts, payment-runner.ts, and relevant service/route invariants.
1. Preflight verifies the specific shared DEV project, DB TLS, database migrations/checksums, expected Stripe Test account, sk_test_ or an explicitly approved test-restricted key, listening port, duplicate worker detection, DB pool headroom, and intended email mode. Stripe SDK/provider account lookup must be read-only at preflight.
2. User-provided PAYMENT_SHARED_MUTATIONS_APPROVED identity string is not sufficient as an independent security boundary if copied/leaked; bind the decision to trusted supervisor startup and verified environment. Prefer a process-local non-replayable supervisor attestation/owned-process protocol or equivalent reviewed mechanism over a freely forgeable frontend/config flag. Keep implementation proportionate, testable and cross-platform.
3. Listener secret comes from the running Stripe CLI session, is passed only to owned API/worker processes in memory, and is never committed, logged or reused from an uncertain dormant process. Validate Stripe webhook signatures using the existing trusted route.
4. Start API and worker in a deliberate order; avoid accepting writes before listener/DB/worker readiness is established. Bound readiness retry and clean up owned children on failure. Do not blindly terminate any non-owned process.
5. Single intended supervisor/runner ownership, explicit locks and crash recovery; review whether in-process recovery should be OFF when dedicated worker is owned, without weakening lease fencing. Preserve cross-instance idempotency even if one process restarts.
6. Recovery processes use existing fenced PaymentWork claims, attempt state transitions, provider reconciliation and UNKNOWN/UNCERTAIN rules. No automatic delete, replay, reset or cancellation of old shared-DEV purchases when switching profiles.
7. Stripe outages, CLI disappearance, DB interruptions and worker exits must produce safe errors and reversible degraded readiness; no false “Nothing charged”, no automatic second charge.
8. Existing API and frontend PAYMENT_MUTATIONS_DISABLED/capability flows retain compatibility. Approved DEV operations show enabled capability, while unapproved shared mode still returns a truthful 503.
9. Idempotency keys, Stripe customer/intent mapping and amount/currency from persisted authoritative facts remain unchanged unless a provable bug needs a separately approved correction.
4.3 Payment end-to-end matrix
Case	Required result / evidence
Approved shared DEV setup	Test Mode PaymentIntent created through actual API; no live mode
Success	Signed webhook / authoritative reconciliation produces correct Payment, Attempt, Order, inventory/cart outcomes once
Decline	Truthful declined state and retry availability without duplicate order/charge
SCA/3DS	Correct challenge/cancel/fail/retry/refresh handling when supported by safe test credentials
Network timeout / unknown	UNKNOWN preserved; do not blindly create a new intent/charge; recover through authoritative provider evidence
Dismiss failed purchase	Only eligible owned failed attempt dismissed; persisted in DEV, no unsafe payment deletion
Duplicate/out-of-order webhook	Idempotent and safe; verify DB/protected event journal and provider binding
Worker restart during work	Existing lease/fencing/recovery rules protect state; no separate shadow runner
No listener / bad secret	Payment capability degraded; signed webhook rejected; no false success
Hot reload / NODE_ENV=test on shared	Must remain denied without proper attested approval
Cross-account order/attempt	404/403 indistinguishable as required by affected contract; zero mutation
PROD ref or live Stripe key	DEV launcher fails before any mutation


One genuinely authorized, bounded synthetic Stripe Test Mode checkout against shared DEV is the main acceptance witness. Record the observed provider livemode=false, DB persisted facts, webhook path, order, email outcome, PDF, and unique test-fixture marker. Do not run or authorize this simply because this spec exists; the task owner must approve the named scope and the agent-coordination gate. Use previously accepted tests for unchanged finance invariants, plus focused tests for the new launcher/guard path.
5. Database isolation, Supabase connectivity and Prisma policy
5.1 No automatic database migration
- Prisma schema/migrations are the exclusive source of schema truth. This task should need no Prisma model/column change. If performance profiling proves an index is required, prepare a separate DATABASE+Architect CCR, lock/plan/rollback and forward-only migration; do not auto-apply to shared DEV or PROD.
- Check the actual 20-migration ledger and checksums from the prior DEV/PROD read-only acceptance. Recheck live ledger with authorized READ ONLY connections at implementation; record any drift as its own gate.
- Do not run prisma db push against any shared environment. Do not edit historic migration bytes or repair ledger checksums to force a green test.
- Never auto-seed/reset/cleanup shared DEV, whether via NODE_ENV=test, npm run db:seed, Playwright or another agent script.
5.2 Correct runtime versus migration connection selection
Currently lib/prisma.ts prefers DIRECT_URL if present. Treat this as a measured configuration risk, not proven defect. Proposed contract:
- DATABASE_URL should be the explicit application's configured runtime connection candidate, validated against approved mode/capabilities.
- DIRECT_URL should be reserved for migration/direct CLI or an explicitly documented direct-connection choice; preserving backward compatibility matters.
- Check actual @prisma/adapter-pg semantics: session-level behavior, prepared statements, interactive transactions, advisory locks, leased payment jobs and pooler compatibility. Do not swap to transaction pooler port 6543 blindly; retain session semantics where required.
- Runtime should not silently fall back to the other environment on failure. A safe connection failure is better than writing to a different project.
- Validate CA certificates and server hostname, not just ssl: true. Keep verified TLS in production-like paths; an isolated local sslmode=disable in migration tooling is allowed only after independently verifying the disposable local target and never propagates to the API.
- Preserve adapter disposal ownership and observable events. Avoid global pg.Pool monkey patches or increasing connectionTimeoutMillis to hide errors.
5.3 Pooler strategy and headroom
Evaluate the real project and driver:
Mode	Potential use	Verification concern
Direct db.<project>.supabase.co:5432	Persistent API where networking supports it	IPv6/IPv4, TCP/TLS, connection caps
Supavisor session pooler port 5432	Persistent API on IPv4 with session features	Tenant/session capacity, physical connection budget
Transaction pooler port 6543	Short-lived/stateless workloads only if supported	Prepared statements and transaction/session features; not an unconditional substitute
Dedicated pooler	Optional managed option	Plan eligibility, cost, measured need


Measure connection budget across API + payment runner + commerce email runner + migrations/read tools + concurrent developer processes. Current source config may hold up to five connections per nonproduction Prisma instance, but configured maxima do not prove Supabase's available backend slots. Inspect pg_stat_activity/service metrics where permitted and account for Supavisor limits.
- Warm the correct pool; choose conservative max/min/idleTimeoutMillis/connectionTimeoutMillis from observed concurrency and app demands.
- Verify connection reuse, idle failures, pool exhaustion, reconnect behavior, SIGINT shutdown, worker restart and slow queries.
- Preserve existing transaction isolation and payment leases. A connection strategy that reduces latency but breaks recovery locks or consistency is rejected.
- Confirm Prisma query observability does not log SQL parameters or PII; collect aggregate metrics instead.
5.4 Isolated QA dataset and containment
Preserve dev-isolated.cjs: local PostgreSQL 17, loopback, SCRAM, per-environment TLS CA, disposable DB name, .isolated/ ignored, generated fixture credentials and guarded prisma migrate deploy.
- Before any mutation, identify the actual database connection using trusted target resolution and read-only SQL/TLS validation. A configured hostname or database name alone is not enough if DNS/port mapping could point elsewhere.
- Apply disposable fixture provisioning only to the verified local PostgreSQL. Idempotently resume after interrupted init. Never copy real shared DEV customer/payment data into isolated fixtures.
- Default autonomous agent/CI tests to isolated. Forbid test scripts from honoring a shared/prod DATABASE_URL inherited from a shell; use explicit isolated env and fail if DIRECT_URL disagrees.
- Use separate ports/browser contexts. Test session/log/cookie/storage isolation and document blob cleanup across environment/account switches.
- Stripe mocks and email capture are default. A scoped real Test Mode call requires explicit test approval; capture fixtures must not send real mail.
- Scope isolation proof to the entire chain: test process -> selected frontend proxy -> backend runtime -> observed PostgreSQL identity, not just an expected config string.
6. Performance engineering: find cause, then optimize
6.1 Hypothesis, not assumption
The local PostgreSQL QA environment is reported faster than Supabase DEV. Plausible causes include remote round-trip latency, pool acquisition/warmup, direct/session pooler mismatch, expensive SQL, sequential checkout transaction calls, N+1 reads, frontend waterfalls, excess React Query refetches and provider latency. No numeric production/DEV baseline has been measured in this specification. Do not claim the region, pool or query count is already the cause.
6.2 Required before/after measurements
Use the same read-only or expressly authorized synthetic workload in the same environment, stable fixture sizes, warm/cold separation, compatible driver, controlled concurrency and repeatable sample count (e.g. ≥30 warm observations per critical path; justify deviations). Record median/p50, p95, error rate, query count and resource impact.
Diagnostic	Capture method / interpretation
DNS/TCP/TLS/connect	Sanitized timing around real adapter/pg connection; never display URL/credentials
Cold SELECT 1	Includes new connection/readiness; compare separately from warmed query
Warm SELECT 1	Approximate remote RTT+driver cost; not SQL complexity
Supabase SQL execution	Read-only permitted EXPLAIN and pg_stat_statements/query insights where available; no EXPLAIN ANALYZE of mutating SQL
Pool waiting	total/idle/waiting, acquisition time, refusal/timeout/connection-capacity error counts
API response p50/p95	Authenticated owned cart/catalog, checkout prerequisites, Orders, document metadata; label test mode/environment
Checkout submit	Explicitly authorized synthetic Test Mode only; compare DB transaction time versus provider time
SQL round trips	N+1, serial relation reads, per-item writes in Serializable transactions, unnecessary transactions
Browser waterfall	Network requests, React Query waterfalls/refetch loops, amount of JS/data, screenshot ready / interactive
Total UI user journey	Time from navigation to usable page; loading states must remain truthful


Benchmark at least two isolated patterns: locally hosted backend→local DB and locally hosted backend→remote DEV DB. Optional safe regional backend→DEV DB benchmark only if network evidence justifies it and infrastructure/provisioning is separately authorized.
6.3 Optimization decision tree
1. Slow connection establishment or pool wait: Verify correct runtime URL/pooler, reuse, worker budgets, TLS/network and stale pools; tune conservatively.
2. High warm DB RTT: Reduce serial round trips first; then evaluate colocating an approved DEV backend with Supabase. Moving backend closer is not automatically faster end-to-end if browser-to-backend latency dominates.
3. Slow SQL plans: Review indexes, Prisma projections, aggregation, pagination and N+1 access. Any index/migration is separately approved. Never broaden financial locks to chase speed.
4. Long checkout Serializable transaction: Profile lock waits, round trips, query order and safe batches with PAYMENT/DATABASE owners; preserve cart/stock/attempt idempotency, lock order and exact amounts.
5. Slow UI with fast APIs: Audit React Query keys/stale times/cache invalidation, duplicate fetches, preload and waterfall. Do not overcache private payment state or rely on stale paymentsEnabled for unsafe UI claims.
6. External Stripe/Brevo response: Isolate provider time from DB and UI. Email is async; PDF GET must not trigger purchase. Do not set blanket timeouts or retry writes without idempotency.
7. Remote regional solution: Produce before/after regional API+DB and local browser+API measurements, cost/security/rollback proposal. Supabase region migration is last resort and is not authorized by this task.
6.4 Performance acceptance and truthful targets
- Publish a baseline and post-change table for critical real endpoints; include p50/p95 and samples, same workload, and a short causal explanation.
- Prioritize removing the measured dominant bottleneck. Demonstrate statistically meaningful improvement relative to measurement noise, or prove current bounds are acceptable and document why no optimization is justified.
- Targets proposed for discussion (not fake evidence): warmed ordinary cart/catalog/order read response p95 ≲ 1–2 s under one developer's representative workload, no severe user-facing 503 due to unnecessary pool waits; choose final targets with actual baseline/host limitations.
- Quality outranks raw speed: no new duplicate payment, cross-account read, data loss, new timeouts, less accurate status or unbounded worker connections.
- Do not require the remote DEV database to match local PostgreSQL loopback RTT; latency difference alone is not a correctness failure.
7. Backend, REST contracts and observability
7.1 Backend code scope
Inspect/change minimally as proven necessary:
- apps/backend/src/config/env.ts
- apps/backend/src/payment-isolation.ts
- apps/backend/src/lib/prisma.ts
- apps/backend/src/lib/database-adapter.ts
- apps/backend/src/payment-inprocess-recovery.ts
- apps/backend/src/server.ts, readiness/health routes as needed
- apps/backend/scripts/dev-payment-runtime.cjs, stripe-gate-safety.cjs, dev-isolated.cjs
- relevant payment-runner, webhook route, order-document and commerce email components only when a direct defect is demonstrated
- apps/backend/package.json, .env.example, operational runbooks and focused tests.
Do not change Prisma schema, Stripe payment domain semantics, protected auth services or outbox producer merely to accommodate startup convenience.
7.2 Existing API compatibility
Contract	Required invariant
GET /api/health	Backward compatible liveness; do not mistake for readiness
GET /api/checkout/payment-capability	Authenticated, no-store, meaningful paymentsEnabled boolean, optional safe additive reason only with consumer tests
Payment setup/submit/retry/dismiss	Existing routes, DTOs, auth/ownership, idempotency, status and amount semantics unchanged
Stripe webhook route	Signature verification + raw body; no unauthenticated toggling of payment capability
Orders/Details	Owner-scoped reads/status, true paid/unpaid state, stable customer UX
Commerce email status	Truthful enqueue/sent semantics; do not infer delivered from an API response
Order PDFs	Private, owner-scoped, existing content type/filename/cache protections
New environment diagnostic (if necessary)	DEV/test only or strictly authenticated, no PII/secrets; does not grant permission


A frontend-only change that paints the Payment button active while the backend refuses writes is not a solution.
7.3 Structured logs and readiness signals
Use existing Winston/logContext/driver sanitization. Useful events/fields (exact names are design examples, not proof existing):
- environment.target.verified — mode, project category, transport kind, verification phase, nonsecret fingerprint.
- db.pool.ready|degraded|recovered — connection limit, idle/waiting, bounded timing, error class, not raw DSN/SQL.
- payment.supervisor.ready|degraded|stopped — owned API/listener/runner states, launch mode, readiness; no signing secret.
- payment.isolation.resolved — accepted/denied safe reason, no credentials.
- commerce_email.runtime — disabled/capture/allowlist; never log addresses or contents.
- api.request.timing — request ID, route template, duration, status category, safe environment mode.
Test deduplication/rate bounds, failed transport/sink isolation, graceful flush, no card/JWT/PDF contents in logs. Avoid adding per-query logging overhead to every happy-path request if performance tracing can be sampled/aggregated.
7.4 Rollback
A reversible read-only shared-DEV payment mode must be preserved. One documented operator action should stop only the owned payment supervisor and revert to a non-mutating watched/API mode while preserving payment/outbox records and any uncertain provider events for reconciliation. Rollback must not clear queues, refund/cancel payments, alter migration history, or discard accepted email events.
8. Frontend, React Query and browser UX
8.1 Required user journey
At normal http://localhost:3000 against shared DEV:
1. Sign in with an approved synthetic/test DEV customer; confirm persisted identity.
2. Browse catalog/products, add item to cart, verify stock/cart values survive refresh.
3. Open checkout: shipping/delivery/card/review retain current UI hierarchy; approved Payment capability is true.
4. Stripe Test Mode Payment Element appears only when setup is genuinely available. Submit once under scoped live-test authorization.
5. Wait for provider-confirmed payment and persisted Order; show truthful success, not a guessed redirect.
6. Confirm order visible in My Orders and Details after refresh/re-auth.
7. Confirm email outbox/worker outcome via safe capture/allowlisted mailbox; never assert delivered without provider evidence.
8. View/download Order invoice (non-tax), Payment receipt and Summary for eligible test order; verify response bytes/auth.
9. Test declined/retry and failed-dismiss flows with separate safely controlled synthetic attempts, preserving UNKNOWN semantics.
10. Confirm DEV data survives backend restarts and the QA browser stack never sees the DEV customer's data.
8.2 Frontend changes must be minimal
- Reuse existing Vite E2E_API_PROXY_TARGET, auth/session handling, TanStack React Query keys and payment capability hook.
- On a real capability transition, invalidate/refetch only affected queries without loops or spamming backend.
- Preserve no false 'Nothing was charged' claims. Keep payment-disabled messaging for genuinely restricted runtimes.
- Do not add a broad global frontend environment selector that can point customer UI at production. Startup and browser context select environment; backend attests it.
- Preserve responsive layout at 320, 390, 768, 1440, 1920 widths, keyboard, focus, screen reader names, reduced motion and truthful loading states. QA also checks 200% zoom for relevant checkout/payment interactions.
- If regional DEV backend is tested, confirm CORS, HTTPS, CSP, cookies, SameSite/Secure, Stripe client-side origins and reverse proxy; do not loosen origins to * or log tokens.
9. Email, PDF and related full-stack service continuity
9.1 Commerce email
- Verify existing Task 03.8 schema ledger and producer/dispatcher readiness in DEV. Never auto-enable a worker against a schema missing commerce_email_* objects.
- capture must remain disposable/test-only unless the current reviewed code expressly supports a safe shared-DEV equivalent. On shared DEV, prefer disabled or allowlist for an approved synthetic mailbox, with explicit retained outbox behavior.
- Before starting an allowlist worker, count/sendability-check pending backlog and ownership. No burst to unknown recipients. If a real mailbox is not approved, leave external delivery OFF and validate outbox status/capture in isolated tests.
- Preserve journal/lease STARTED, UNCERTAIN, idempotency, no re-send on unknown provider outcome, no payment rollback on email failure.
- OTP/Auth email integrations remain separate and unchanged unless a demonstrable cross-environment risk is found.
9.2 PDFs
- Verify PDFs render using the real DEV order persisted in shared Supabase; GETs are read-only and owner-scoped.
- Confirm document availability after payment and refunds per existing Task 03.9 contract. No PDF generation shall write to Stripe, DB, inventory, cart or email.
- Verify packaged fonts and graceful document-unavailable handling when needed; do not reopen Task 03.9 print/Arabic exception as Task 04.0 scope unless directly broken.
10. Threat model / security matrix
Threat / failure	Required boundary / negative test
NODE_ENV=test applied to shared DSN	No permission to mutate without approved attested target/runtime
DATABASE_URL isolated + DIRECT_URL shared	Fail before any write; no fallback
Shared DEV DSN disguised as local hostname	Verify actual endpoint/connection identity and TLS, not string pattern only
Wrong Supabase project pooler username or direct host	Reject before worker/provider write
PROD reference in DEV profile	Fail closed, no remote DB or Stripe actions
Live Stripe key in DEV/isolated runner	Refuse before API/listener/worker mutation
Missing/invalid webhook secret	Refuse signed webhook; truthful degraded capability
Unknown/dormant payment runner	Do not kill unknown process; prevent duplicate owner and stop unsafe launch
Provider timeout after charge	UNKNOWN state; reconcile, no second automatic charge
Repeated failed tests	Only disposable data resets; no shared DEV truncation
Browser DEV/QA cross-login	Separate browser context and cache; zero cross-env data access
Backend exposure/diagnostic route	Sanitize, authenticate/loopback restrict; no DSNs, cookies or secrets
TLS failure/certificate change	Fail closed; no rejectUnauthorized:false workaround
Slow SQL/pool timeouts	Do not mask via broad timeout increase, unsafe pool max or missing isolation
Unauthorized Brevo pending backlog	Fail-safe allowlist or dispatch OFF; no blind send
PDF from wrong owner	Same 404/no PII; no stale blob from prior session
Crash during payment/email worker shutdown	Leases and journal preserve exactly-once intent/evidence; safe restart
Concurrent remote configuration changes	Report drift, stop mutating path; do not run automatic migrations


Security check methodology
Use pure unit tests for the full environment/target decision matrix, real disposable DB integration for adversarial source/URL mismatch, and controlled approved DEV tests for truly environment-dependent behavior. Use supertest auth tests, Playwright browser session isolation, child-process fakes/actual owned children and SQL-before/after snapshots. Never run destructive probes against shared DEV/PROD. Threat tests must prove zero side effects when denied, not merely an error response.
11. Test and verification plan: first-handoff acceptance
11.1 Testing layers and tools
Layer	Preferred tools	Proves
Pure guard/config	Vitest/Node test runner, Zod	decision matrix, dotenv precedence, redaction and mismatched targets
Backend/API	Vitest + Supertest	capability, 401/403/503, route contract and error truth
Local Postgres	PostgreSQL 17, Prisma, pg, psql	actual data isolation, migrations, transaction/lease behavior
Stripe transport	Stripe Test Mode + existing Stripe CLI listener when authorized	real signed event, expected account, Test Mode, reconciliation
Payment concurrency	existing barriers/fenced worker tests	retries, interleavings, crash/restart, unknown provider result
Commerce email	existing worker fake/capture/approved allowlist	no accidental live send, journal state and status truth
PDFs	actual document service, PDF parser, browser preview	authenticated real-backed PDF GET and no side effects
Browser E2E	Playwright (real stack), axe-core	frontend proxy, auth/session, checkout, retries, Orders, PDFs, UI
Frontend units	Vitest + Testing Library	capability transitions, loading, errors and cache invalidation
Perf	Node perf hooks, browser timings, Postgres read-only stats	handshake, pool wait, API/UI p50/p95 and before/after
Code quality	TypeScript, ESLint, builds, git diff --check	compile/static reliability
Operations	Windows PowerShell/startup scripts, owned process checks	DEV/QA one-command run/stop, crash/rollback, no wrong-target startup


11.2 Required gates (T04-01 to T04-24)
ID	Mandatory acceptance criterion	Required first-handoff evidence
T04-01	Remote/local branch and working-tree inspection; verified base	SHAs, source/ownership record, diff manifest
T04-02	Normal DEV frontend :3000 targets approved API :5000	real browser/proxy/network capture
T04-03	API :5000 verifies persistent Supabase DEV identity and TLS	sanitized preflight + read-only DB verification
T04-04	Isolated QA :3200 → :5200 → local disposable :55434	TLS/db identity + real isolated browser
T04-05	Cross-environment mismatches and NODE_ENV=test bypass fail closed	exhaustive negative guard/launcher tests
T04-06	DATABASE_URL/DIRECT_URL runtime semantics explicit and safe	source contract + direct/session smoke matrix
T04-07	Pool budget across API/payment/email workers verified	connection stats and restart/capacity metrics
T04-08	Approved DEV supervisor owns API/Stripe listener/payment runner	preflight logs, process ownership, graceful shutdown
T04-09	Stripe Test Mode only in DEV; no live credential accepted	sanitized Stripe account/mode proof and negative tests
T04-10	DEV setup/confirm/decline/retry/dismiss work appropriately	approved synthetic real-stack results + supported tests
T04-11	Payment idempotency/recovery/UNKNOWN and worker crash safety preserved	targeted worker/barrier/provider evidence
T04-12	/api/checkout/payment-capability remains truthful and compatible	Supertest, frontend state and browser check
T04-13	Shared DEV order, inventory, cart and payment facts persist	before/after approved test facts (no data cleanup)
T04-14	Checkout/Orders history browser integration works after reload/sign-in	real DEV Playwright session proof
T04-15	Commerce email capture/allowlist safe; no backlog blast	runtime report + mailbox/capture or authoritative safe N/A
T04-16	DEV order PDF owner-scoped preview/download works	actual PDF bytes and authenticated browser view
T04-17	Baseline/patched Supabase API/DB/frontend p50/p95 captured	fixed workload, sample counts, before/after table
T04-18	Dominant measured latency mechanism addressed proportionately	causal note and measurable effect or accepted bound
T04-19	No payment/security regressions from connection changes	focused transaction/concurrency/auth tests
T04-20	Isolated fixtures cannot touch shared DEV/PROD	deliberately mismatched test DSNs rejected with zero writes
T04-21	Windows/local developer startup, stop and safe switching work	tested commands, relevant screenshots, lock/port behavior
T04-22	Logging/readiness safe, informative and no PII/secrets	structured diagnostic tests, process-degraded test
T04-23	Rollback returns to restricted shared DEV without data loss	exercised safe rollback/failure rehearsal
T04-24	Full task traceability, usable runbooks, independent architect review	evidence file, scoped code review /100 and verdict


T04-10 and T04-13 require specifically approved remote DEV Test Mode mutations for true live evidence. If owner authority or provider/host access is missing, mark BLOCKED / NOT VERIFIED with exact reason; mocks and isolated DB cannot be mislabeled as DEV verification. Do not claim the task fully accepted until mandatory gates are met or a precisely scoped Architect-approved exception is recorded.
11.3 Browser and visual journey coverage
- Baseline and final real DEV browser at 390/768/1440/1920, plus 320px stress and 200% zoom for changed payment state. Tests must open screenshots and inspect them, not just collect images.
- UI states: initial auth, catalog/product, cart, checkout prerequisites, enabled Test Mode card UI, pending, 3DS where applicable, paid, declined, retry, forced 503/unapproved mode, Orders after reload, email status, PDF preview/download, expired JWT/account switch.
- Ensure no duplicate Place Order, no false spinner/saved-file claim, no stale payment-capability reuse on another login, no cross-env tokens, and no lost focus/overflow.
- E2E test should assert backend/database identity using a trusted internal preflight, not simply mocked browser responses. Real tests do not intercept the payment API for the core DEV acceptance.
- Distinguish PDF viewer limitations (including existing Arabic exception) and provider acceptance from delivered email; do not turn a non-guaranteed outcome into a PASS.
11.4 Controlled DEV acceptance protocol
Before any shared DEV write/provider mutation:
1. Written task-owner approval of bounded synthetic DEV fixture/customer, Stripe Test Mode action set, number of purchases, worker startup and handling of persistent financial rows. Protect existing shared DEV data. No production authority.
2. Confirm current branch, source, target project, TLS, live schema ledger/checksums, existing worker ownership, current pending/uncertain payments and outbox backlog. Do not start a runner that may immediately mutate unreviewed historical work.
3. Review signed Stripe CLI listener, account ID, livemode=false, stable compiled API and approved payment isolation decision; do not paste secrets in evidence.
4. Perform one genuine synthetic authorized purchase (additional negative scenarios only within approved scope). Observe DB, Stripe and browser end to end; use explicit unique test marker, never a real customer's identity.
5. After test, leave financial records truthful and intact. No automatic cleanup of purchased financial rows; clean only reversible nonfinancial synthetic fixtures with separate approval where necessary.
6. Stop owned processes; record provider/test mode, order reference (synthetic), hashed/redacted IDs, state transitions, timestamps, errors and precise evidence. No live emails except approved test recipients.
If authorized shared DEV acceptance is unavailable, finish all offline/disposable/architecture work and clearly leave the runtime gate pending. Do not self-approve absent external evidence.
11.5 Test selection and risk-based stop rules
- Low-risk 5–15 min per isolated script/docs/test change: read changed file fully, run its focused test/static check.
- Medium-risk 15–40 min per environment config, performance instrumentation, Vite proxy, startup update: inspect direct consumers, run focused QA and one real representative browser run.
- Critical payment isolation, shared DB pool, provider webhook/worker or auth boundary: deep proof of target identity, side-effect prevention, idempotency, concurrency and rollback. Use necessary time, not arbitrary caps.
- One safe final applicable backend/frontend suite after stabilization if source changes invalidate prior evidence. Reuse accepted 03.5–03.9 evidence for unchanged finance/email/PDF contracts. Avoid repeated broad audits and speculative tests.
- Exit codes, exact commands, suite selection/exclusions, passed/skipped counts and environment provenance must be logged. “CI green,” “Stripe verified,” “DEV ready,” “fast,” and “production quality” require corresponding real evidence.
12. Operational rollout, failure handling and reversibility
12.1 Preferred rollout sequence
1. Baseline only: remote/local inspect, record current DEV capability and safe read-only performance; do not start mutating runners.
2. Local implementation: target resolver/guards/supervisor, frontend routing changes and diagnostics with offline tests.
3. Isolated integration: local Postgres/Playwright, adversarial safety matrix, mocked payment/webhook and captured email.
4. Read-only shared DEV: schema, TLS, exact target, pool strategy/headroom and warmed API metrics; no payment mutations.
5. Authorized DEV activation: verify backlog, run one supervised stable backend/listener/runner and bounded Stripe Test Mode smoke with approved synthetic customer.
6. End-to-end browser: normal default DEV frontend checkout → payment → email outcome → Order Details/PDF; inspect screenshots.
7. Performance comparison: same workload, before/after data; choose documented runtime URL and conservative pool settings. Optional regional benchmark only if justified/approved.
8. Rollback drill: stop owned launcher, revert to read-only restricted mode, verify stored orders/attempts/outbox untouched.
9. One first handoff: exact source diff, commands, evidence, residual gates, and architect score/decision.
12.2 Failure decision table
Failure	Required behavior
Wrong env, wrong DB, TLS failure	Refuse startup of mutation-capable service; no fallback
DEV pool headroom insufficient	Refuse payment supervisor or choose documented capacity correction; not an unsafe max increase
Stripe CLI/account/secret invalid	Disable payment readiness; no checkout submission
Worker crashes	Preserve leases/UNKNOWN; supervised restart bounded; diagnose state
DB transient outage	API may serve liveness; payment readiness false, no false success; recover without new charge
Email worker/send denied	Checkout/order unaffected; no unapproved mail or event replay
PDF asset fails	PDF unavailable with truthful error, order/checkout still healthy
QA fixture target detects DEV	Stop before writes; clean failure evidence
Regional benchmark unavailable	Optimize local stack, record why regional option not chosen
Live DEV test not approved	STOP external actions; mark live gate NOT VERIFIED, preserve offline work


12.3 Documentation and developer runbook
Create or update a single concise environment runbook under docs/10_Operations/ (choose name consistent with existing conventions) with:
- purpose, prerequisites, required tools (Node/Prisma/Postgres17/Stripe CLI, TLS CA), safe .env.example variables (names and placeholders only);
- one command set each for MAIN DEV, READ-ONLY/HOT RELOAD mode, ISOLATED QA, stopping owned processes;
- localhost port allocation and where frontend proxies point;
- safe env:show / preflight diagnostics and how to interpret each error;
- correct pooler choice, connection budget, SQL/HTTP timing and environment-specific troubleshooting;
- payment recovery and email capture/allowlist rules, pending backlog handling;
- Windows PowerShell equivalents (not Unix-only examples), app startup, auth contexts and browser test commands;
- how to re-enter restricted DEV rollback mode without touching financial rows;
- real QA/DEV evidence distinctions, authorized external action checklist, and operational escalation for Supabase/Stripe/Brevo.
Keep docs truthful and practical; no copy-pasted secrets, entire logs or giant repeated architecture summaries.
13. Implementation deliverables and suggested minimal file inventory
13.1 Mandatory artifacts
1. Working supervised shared-DEV backend and safe isolated QA backend, with explicit verified target profile.
2. Payment guard/supervisor configuration correction, including NODE_ENV=test negative protections and no unapproved recovery.
3. Reviewed Prisma runtime connection selection and connection-budget strategy, with actual safe metrics.
4. Verified API/frontend proxy environment routing and payment capability transitions.
5. Safe read-only benchmark script and before/after results (no arbitrary provider traffic).
6. Focused tests (negative identity/payment safety, supervisor, connection, API, browser).
7. Main DEV and isolated QA startup/rollback runbook and .env.example updates.
8. Genuine authorized Test Mode DEV E2E witness, or explicitly separated pending approval gate.
9. Risk-based reviewed effective diff with no unrelated modifications.
10. Single task implementation evidence file, task registry/CCR records and independent Architect handoff.
13.2 Likely touched paths, conditional on inspection
apps/backend/src/payment-isolation.ts
apps/backend/src/lib/prisma.ts
apps/backend/src/lib/database-adapter.ts             (only if proven needed)
apps/backend/src/config/env.ts
apps/backend/src/server.ts                          (only if needed)
apps/backend/src/payment-inprocess-recovery.ts        (only if necessary)
apps/backend/scripts/dev-payment-runtime.cjs
apps/backend/scripts/stripe-gate-safety.cjs           (minimal protected change)
apps/backend/scripts/dev-isolated.cjs                 (preserve existing isolated workflow)
apps/backend/scripts/[focused-env-preflight-or-perf-tool].cjs
apps/backend/src/routes/payment.routes.ts            (only for compatible capability fix)
apps/backend/tests / src/**/*.test.ts                 (focused tests)
apps/backend/package.json, .env.example              (scripts/vars)
apps/frontend/vite.config.ts                          (only if needed)
apps/frontend/src/features/checkout/paymentCapability.ts
apps/frontend/tests / src/**/*.test.tsx              (focused UI tests)
apps/frontend/playwright.isolated.config.ts          (only if needed)
apps/frontend/tests/[focused-real-DEV-test].spec.ts  (explicitly gated)
docs/tasks/Phase-04/TASK_04.0_DEV_ENVIRONMENT_STABILIZATION.md
docs/tasks/Phase-04/TASK_04.0_IMPLEMENTATION_EVIDENCE.md
docs/10_Operations/[environment-runbook].md
Do not presume each path must change. Review and touch the smallest coherent set that meets acceptance. New infra dependencies require pinned versions/license/compatibility rationale; avoid paid resources or cloud architecture changes without approval.
14. Requirements traceability and final QA report
At handoff, output a compact matrix with T04-01 through T04-24, each showing PASS / PARTIAL / NOT VERIFIED / N/A, exact implementation path, environment (MOCK / DISPOSABLE / SHARED_DEV_READ_ONLY / SHARED_DEV_TEST_MODE / PROD_READ_ONLY), command or visible evidence, and remaining gap. Do not label mocked provider or disposable DB tests as remote shared DEV acceptance.
14.1 Required evidence artifacts
- Base SHA / branch, local status, changed file list including untracked additions, relevant CCR/approvals.
- Target identity proof for both stacks, CA/TLS verification, selected pooled/direct mode, connection budget calculations.
- Payment guard truth table including NODE_ENV=test/hot reload/mixed URLs/PROD/live-key denial.
- Supervised DEV startup report and live worker/listener ownership (if authorized), shutdown/rollback evidence.
- Before/after DB/HTTP/UI p50/p95, sample count, query count/connection wait, scenario and environment.
- Real browser signed-in DEV/isolated screenshots actually opened/inspected, no horizontal overflow.
- Real signed Stripe Test Mode event/result only if specifically authorized; saved Order/Payment facts and zero duplicated mutation.
- Brevo mode, outbox/allowlist/capture result, and PDF sample/filename/privacy checks.
- Tests/build/lint/typecheck outcomes, skipped tests, legitimate exclusions and non-run gates.
- Defect list limited to actionable defects and material verification gaps, rollback commands and release limits.
14.2 First-handoff scoring /100 (risk-weighted)
Category	Weight
Correctness / Task requirements	20
Security / provider & environment isolation	25
Architecture / API/compatibility	15
DB/transactions/worker correctness	15
Tests / real evidence	15
Performance / reliability	7
Documentation / operability	3
Total	100

Verdict: ✅ Approve if mandatory acceptance criteria, authorized verification and residual risks are acceptable; ⚠ Request Changes for actual fixable defects/material missing gates; ❌ Reject for dangerous target confusion, provider/financial idempotency failures, unauthorized remote mutation or fundamental unsafe design. A high numeric score cannot override an unresolved security/payment P0/P1. Architect independently assesses implementation; developer self-score is explicitly marked self-review.
14.3 Stop rule — no endless review loop
- Implementation owner should fix evident defects before handoff. After one first-handoff review, re-review only the correction delta, reusing valid unchanged evidence.
- Avoid new tests without a concrete risk, unrelated investigations, and broad repeat full-suite runs. Focus on source and environment critical paths.
- If all mandatory testable requirements pass, reviews are complete and residual risks acceptable, approve and stop; do not seek arbitrary 100/100 perfection.
- Implementation complete ≠ Architect approved ≠ merged into develop ≠ operationally deployed. Explicitly state stage reached.
15. Definition of done — the exact practical outcome
The developer can:
1. Start the normal main DEV backend + frontend with documented simple commands.
2. Load real persistent DEV catalog/cart/orders without the isolated DB.
3. Complete an appropriately authorized genuine Stripe Test Mode checkout in the normal DEV browser without a blanket PAYMENT_MUTATIONS_DISABLED refusal.
4. Observe signed webhook/recovery behavior and persisted payment/order exactly once.
5. View history, approved email outcome and authenticated PDF invoice/receipt/summary from the same DEV purchase.
6. Restart services and find the same persisted DEV order without accidental changes to old financial records.
7. Launch separate fast isolated browser/backend/PostgreSQL for destructive agent QA, safely reseed/restart it and never touch shared DEV/PROD.
8. Observe measured connection/query/API/browser performance and understand the chosen pooler/region decision.
9. Shut down or rollback payment-capable DEV safely without canceling provider work or wiping outbox records.
10. Receive a final first-handoff engineering report with actual passed gates, not fabricated green checks, and obtain one independent Architect verdict.
Task 04.1 (FastAPI) must not be treated as started by this task. Its work should begin after the critical DEV/isolated safety and payment reliability baseline is accepted, or after a narrowly recorded owner-approved exception that does not expose Phase 04 work to corrupt/slow environments.
NO UNAPPROVED PROD WRITES, LIVE STRIPE CHARGES, CUSTOMER EMAILS, GLOBAL SEED/RESET, CLOUD MIGRATION, PUSH, MERGE OR DEPLOYMENT.
Target: one production-quality FIRST IMPLEMENTATION HANDOFF—complete requirements, verified safe execution, measured performance, usable runbooks and an independently reviewable branch.
