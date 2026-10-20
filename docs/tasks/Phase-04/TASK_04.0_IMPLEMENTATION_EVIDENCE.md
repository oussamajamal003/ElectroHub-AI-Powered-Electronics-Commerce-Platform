# Task 04.0 — implementation evidence

Status: STOPPED / PARTIAL — environment implementation and offline regressions are present. CCR T04-PAY-01's exact two-ID worker scope is implemented and reviewed; the payment-capable DEV runtime remains stopped after the earlier unscoped worker processed an attempt outside the approved scope. The user authorized code edits and offline tests only, not a runtime start or payment recovery. The genuine DEV purchase and final Architect acceptance remain incomplete.

Continuation 2026-10-20: the user approved recovery of one exact existing attempt. Preflight/readiness passed with `reviewedRecoveryCount=1`, but independent review found the supervisor still launched an unscoped worker. The supervisor was stopped. Sanitized logs show the worker claimed and provider-checked the approved attempt, the Task04 synthetic pre-submit attempt, and one older attempt belonging to another customer. The older attempt was outside the user's approval. Its current local state is `DECLINED`, with no order, recorded provider status `requires_payment_method`, no payment method attached at the last provider observation, and an expired `LEASED` work item. It was claimed five times, provider-checked five times, and outcome-persisted four times between 12:29 and 12:37 UTC. The worker is stopped, its owned PIDs are absent, :5000 is clear, and the exact stale lock/stop marker were removed after verification. No manual financial record edits or retries were made.

Continuation after incident, 2026-10-20: PAYMENT and Architect reviewed and approved CCR T04-PAY-01. The user approved its exact code-only scope and offline tests, explicitly excluding worker start and payment recovery. The runner now requires the active supervisor-issued allowlist in supervised DEV and applies the same immutable two-ID scope to batch and attention scans. The supervisor validates the reviewed attempt plus the uniquely owned Task04 fixture attempt and sends the scope only to the payment worker. Offline launcher/supervisor/runner tests, typecheck and focused lint pass. The runtime was not started. The older customer's attempt remains outside scope and still requires owner review.

## Baseline and execution plan

2026-10-20: fetched origin successfully. Branch `feature/DEV-Environment-Stabilization`, HEAD and current origin/develop `28d828c1a52b92e4bac17ebb96b827cb1ad8be3b`. Existing untracked Phase-04 specification preserved. Existing other worktrees preserved. No commit, push, merge or deployment authorized.

The session is in Default mode; an actual Plan-mode transition is unavailable. This written plan precedes implementation. Four total agent slots permit three concurrent delegates and the integration lead; eight focused workstreams will run in waves. Requested Luna configuration uses supported `gpt-6-luna` only where explicitly selected.

1. Verify source, dependency versions, source contracts and protected ownership.
2. Inspect DEV/PROD through read-only Supabase metadata, migration ledger/checksums and physical schema. Do not mutate either schema until drift, prerequisites, and exact forward-only operation have been reviewed.
3. Resolve database identity, URL selection/TLS and payment supervisor design together. Preserve financial state machine, auth, outbox and PDF architecture.
4. Implement confirmed environment/guard/launcher gaps with focused negative tests; protected changes require the CCR gate below.
5. Preserve and exercise isolated PostgreSQL :55434, API :5200 and frontend :3200; test no shared-target fixture writes and browser session separation.
6. Verify compiled shared DEV API :5000, listener, worker ownership and backlog before any bounded genuine Test Mode purchase. No historical recovery or email backlog dispatch without scoped authority.
7. Measure fixed read-only cold/warm DB and API workloads before/after; optimize only a measured dominant cause. Record samples, p50/p95 and failures.
8. Exercise real browser catalog/cart/checkout/orders/email/PDF journeys, applicable negative states, 320/390/768/1440/1920 widths and 200% zoom. Inspect actual captures. No mock-to-DEV evidence substitution.
9. Exercise owned-process shutdown and restricted restart, preserving all financial/outbox facts. Run one integrated relevant static/test/build pass, review effective diff and document each T04 gate.

## Task registry and ownership

All workstreams: task_id T04.0; base SHA above; approval reference user Task 04.0 implementation prompt; status PLANNED; last_updated 2026-10-20. Initial delegate activity is read-only discovery; exact edit scopes recorded before implementation.

| Owner | Workstream | Owned files / protected requests |
|---|---|---|
| Lead | Integration, environment/DB connection, final evidence | This evidence, task invariants, runbook; protected config/env.ts, lib/prisma.ts and payment-isolation.ts only after CCR review |
| Agent 1 | Database and Supabase | Read-only ledger/physical schema; no schema/migration writes |
| Agent 2 | Stripe supervisor/recovery | scripts/dev-payment-runtime.cjs and tests proposed; no protected edits until coordinated |
| Agent 3 | Isolated QA | scripts/dev-isolated.cjs and targeted tests; no shared writes |
| Wave 2 | Frontend, performance, email/PDF, integration QA | Assign after initial findings; no overlapping writers |

## Initial confirmed gaps

- `resolvePaymentIsolation` permits all `NODE_ENV=test` callers before validating target identity, including shared URLs.
- Prisma runtime selects `DIRECT_URL` before `DATABASE_URL`; the task requires explicit runtime/migration semantics and logical project validation.
- Existing supervisor launches children without supplying the shared-target approval consumed by the runtime guard; supervisor readiness therefore requires investigation.

## CCR T04-ENV-01 — proposed protected boundary changes

Requesting workstreams: DATABASE, AUTH consumers, PAYMENT, PERFORMANCE, INTEGRATION. Owner: lead; supervisor changes delegated only with explicit scope.

Proposed scope: pure trusted database target validation, runtime URL selection/TLS configuration, fail-closed payment target checks and supervisor-owned activation. Preserve production deployment policy and existing financial domain services, auth middleware, API contracts, schema and migrations. No generator/dependency changes planned.

Evidence: source gaps above. Risks: legitimate direct/pooler pairs must resolve to one project; unit mocks must be explicit; watched/unsupervised shared DEV cannot gain payment authority from NODE_ENV or a copied approval string. Test plan: negative target matrix, guard/supervisor lifecycle, unchanged transaction/financial regression, actual read-only TLS and disposable integration. Rollback: stop owned supervisor, return to restricted DEV; never delete financial/outbox rows.

Review status: APPROVED by the user through the CCR T04-ENV-01 approval question on 2026-10-20. Protected scope is payment-isolation.ts, bootstrap.ts, config/env.ts, lib/prisma.ts, and scripts/dev-payment-runtime.cjs. No financial services, auth, schema or migration edits authorized by this CCR.

## CCR T04-PAY-01 — exact worker attempt scoping (code-only scope approved)

```text
CCR ID: T04-PAY-01
REQUESTING WORKSTREAM / TASK: INTEGRATION / Task 04.0
AFFECTED OWNERS: PAYMENT, INTEGRATION (Architect)
PROTECTED FILES / CONTRACTS: apps/backend/src/payment-runner.ts; apps/backend/scripts/dev-payment-runtime.cjs and its tests; the supervised-DEV scope gate in apps/backend/src/lib/dev-supervisor.ts if needed to read the supervisor-issued allowlist. No payment service/state-machine, webhook, API, schema or migration change is proposed.
PROBLEM AND EVIDENCE: The supervisor passed the one-attempt preflight but launched payment-runner without a scope. The runner called paymentService.runBatch(undefined), and one attempt outside the user's approval was processed. Sanitized local logs show five claims/provider observations and four persisted outcomes; current local evidence is DECLINED, no order, last provider observation requires_payment_method, no attached payment method, and an expired lease. The runtime is stopped; that row remains untouched.
PROPOSED CHANGE: In supervised shared DEV, fail closed unless active supervisor IPC authorizes a nonempty, unique, canonical UUID allowlist bounded to the two exact Task04 IDs: the user-reviewed recovery attempt and the Task04-owned synthetic fixture attempt. The trusted launcher validates both IDs against their expected roles and passes them only to the payment-worker child; never pass the allowlist to API or email workers. The runner uses one immutable parsed ID list for both paymentService.runBatch(ids) and paymentRecoveryAttention(prisma, ids). No unscoped fallback is permitted in supervised DEV. Preserve existing disposable NODE_ENV=test --attempt behavior and supported production behavior.
SECURITY / PAYMENT / API / DB IMPACT: This constrains worker reads/claims and recovery-attention scans to the approved two-attempt set; it does not change financial transitions, provider operations, APIs, database schema, or migration state. The older customer's attempt remains excluded. No runtime start, recovery, retry, or database mutation is authorized by this CCR.
COMPATIBILITY AND MIGRATION PLAN: No migration. Preserve scoped disposable-test execution and the currently supported production runner path. Reject absent, empty, malformed, duplicate, oversized, or otherwise unauthorized supervised-DEV scope before the recovery loop or any provider call.
TEST PLAN AND ROLLBACK: Unit tests cover missing/empty/malformed/duplicate/over-limit scope and absent IPC failing before batch/provider access; only the exact two authorized IDs reach every batch and attention poll; the older attempt is excluded; API/email children receive no scope; caller-set env/flags without active IPC are denied; disposable-test scoped and ordinary production behavior remain compatible. Run relevant runner/supervisor tests plus existing payment regression tests. Rollback by stopping the owned supervisor and returning to restricted DEV; do not rewrite or delete payment/order rows.
APPROVAL STATUS: PAYMENT and Architect approved the revised design; the user approved the exact protected code scope and offline tests on 2026-10-20. This does not authorize a DEV worker start, recovery, retry, or database mutation. Any later start/recovery requires a separate exact operational authorization after read-only review of current rows and backlog.
```

Review history: the first PAYMENT review requested changes because the launch path did not transport the allowlist. The revision includes the supervisor callsite and worker-only delivery. PAYMENT and INTEGRATION/Architect approved the exact-scope design, contingent on an active trusted supervisor channel and no unscoped fallback. The user approved the code-only change and offline tests; runtime authorization remains separate. The earlier T04-ENV-01 approval covered connection/isolation startup behavior and did not authorize the new runner-scope semantics.

CCR implementation verification, 2026-10-20: `node --test scripts/dev-payment-runtime.test.cjs` passed 18/18; `npx vitest run src/lib/dev-supervisor.test.ts src/payment-runner.test.ts` passed 10/10; `npm run typecheck` passed; focused ESLint for the supervisor and runner source/tests passed. PAYMENT independently re-reviewed the allowlist transport and runner gates and approved. No DEV runtime was started and no payment attempt was recovered by this CCR.

## 1. Branch and scope

Branch/base remain as above. No commits, pushes, merges, CI triggers or deployments. No remote migration, schema change, seed/reset, financial-row deletion, stock reset, live-mode payment or external commerce email was performed by this task. One bounded synthetic DEV CUSTOMER was provisioned under the explicit task authorization; its private credentials remain ignored. Current read-only reconciliation finds one pre-submit `AWAITING_INPUT` attempt for the fixture, one cart line, and zero orders. It has no `submittedAt`, order, or attached payment method; the browser never sent the `/submit` request.

The user separately approved stopping the verified legacy isolated launcher PID 75004 and its verified backend descendants so :5000 could return to MAIN DEV. The existing PostgreSQL PID 67080 was preserved. Unknown/foreign processes were not killed. Terminal sessions and PIDs are point-in-time evidence, not reusable authority to kill a later process.

## 2. Architecture result

- MAIN DEV: frontend :3000 → API :5000 → canonical Supabase DEV, explicit `DB_RUNTIME_URL_SOURCE=direct` selecting the existing session pooler :5432. Actual direct/proxy diagnostic matched one ready MAIN_DEV instance during supervised operation. A subsequent restricted compiled API verified real catalog and customer session restoration through the same frontend.
- QA: frontend :3200 → API :5200 → existing PostgreSQL 17 :55434 / `electrohub_disposable`, server identity and `verify-full` TLS checked before migrations. API/worker restarted without replacing the cluster or deleting fixtures.
- Separate persisted QA JWT/refresh/OTP secrets. Browser contexts remain separate because localhost cookies cross ports. External Stripe/Brevo keys are blank by default in QA; capture mode is explicit.
- PROD endpoints are refused in DEV/test. Production retains the existing explicit deployment approval and prior direct runtime default; DEV-only Test Mode validation does not change production key policy.

## 3. Database result

**DEV and PROD read-only verification: VERIFIED within the following scope.** See `database-discovery.json` for sanitized primary evidence. DEV `pzxekjybdiulzmssalfo` / ap-northeast-2 and PROD `yepfgjehdstlxbpespun` / ap-northeast-1 were ACTIVE_HEALTHY, PostgreSQL 17.6.1.166.

Both had exactly 20 completed Prisma migrations, no unfinished/rolled-back entries. Checksums matched local SQL or the two already documented historical formatting variants (foundation UTF-8 BOM/CRLF and OTP CRLF). No history repair or migration rewrite. Thirty Prisma models, 330 columns, 22 enum label sets, 91 validated constraints, 127 valid indexes and two trigger signatures were compared with physical catalogs; known historical defaults and enum ordering differences were preserved. This is current physical metadata/ledger verification plus prior accepted Prisma drift evidence, **not a newly executed full raw Prisma diff**. Supabase's separate migration ledger is not Prisma's schema authority. Migration action: **NO-OP**.

Runtime validates both logical datasets, accepts only the Prisma `public` schema, rejects URL override parameters/duplicate parameters/insecure TLS, and refuses transaction-pooler runtime semantics. Different direct/session endpoints may resolve to the same canonical project; different local ports/databases cannot. CA validation and `rejectUnauthorized:true` remain enabled. Supavisor `pg_stat_ssl` is its internal PostgreSQL hop; external TLS is established by the validated application socket and successful query.

Pool maxima remain 5 per nonproduction process / 10 production. Supervisor reserves 10 for API+runner, 15 with email, against a conservative 15 and observed other sessions. Supabase max_connections=60/reserved=3 is not proof of Supavisor tenant capacity. Restart briefly refused while former sessions drained; read-only counts later showed one active inspection and the existing pg_net worker. No limit increase or session termination.

Existing RLS/advisor findings remain explicit: 23 tables have RLS disabled, while anon/authenticated had no table privileges; two invoker outbox functions have mutable search_path advisory findings. This task makes no blanket RLS/security certification or unrelated migration.

## 4. Backend and payment

`payment-isolation.ts` removes NODE_ENV=test shared authority, copied DEV approval strings and forged environment-only supervisor authority. Watched shared DEV stays restricted. `dev-supervisor.ts` grants per-child revocable authority only through the live parent IPC prepare/activate protocol. Worker performs SELECT 1 before activation and imports the financial runner only after activation. API activates after API DB readiness, worker DB readiness, worker activation and actual runner readiness. Disconnect/degraded readiness revokes authority and uses existing shutdown handlers. Financial services, leases, transaction settings and state machine remain unchanged.

The foreground launcher verifies target/TLS, every migration/checksum, recovery backlog, canonical Stripe Test account, reserved port ownership and connection reserve. It owns its compiled API, runner and CLI listener, keeps the listener signing secret/IPC nonce in memory, and releases only its own lock after its recorded children exit. Windows IPC children receive graceful disconnect before force-stop fallback. Unit fixtures now inject the diagnostic-token writer, preventing tests from overwriting an active stack's token.

The supervisor reached API DB/worker DB/runner readiness with private IPC active, canonical account verified, listener signing secret held in memory, and email dispatch off. It was stopped after the scope defect was found. The task's wrapper stop marker did not clear the lock; recorded PIDs and listeners were checked, then only the exact stale task lock and marker were removed. No payment service remains on :5000.

**Unapproved attempt requiring owner review:** one older customer's attempt (created 2026-10-14; private hash `4356f18def`) is locally `DECLINED`, has no order, and its last observed provider state is `requires_payment_method` with no payment method attached. Its work row is `LEASED` with an expired lease. During the unsafe runtime, sanitized logs show five claims, five provider observations, and four persisted outcomes for this attempt. The current payment worker is stopped. Do not resume or manually reconcile this row without a separate exact decision.

The Task04 browser reached the Payment step but never loaded the Stripe card fields; the page remained at “Loading secure payment form.” It did not click “Place Order” and made no `/submit` request. Opening the Payment step had already created one Task04 pre-submit attempt (`AWAITING_INPUT`, `requires_payment_method`, no order/submission/method attached); the unscoped worker observed it seven times and persisted seven outcomes. The user-approved recovery attempt remained `AWAITING_INPUT`; the worker observed it six times and emitted recovery escalation events. No payment method was attached on the last provider observations. Full provider status after shutdown was not rechecked. No order or successful payment is evidenced for any of these three attempts.

## 5. Frontend

Vite validates loopback proxy URLs and reserved :3000/:5000, :3200/:5200 pairs, uses strict ports, honours CLI --port and rejects conflicting CLI/environment values. Builds do not validate unused dev proxies. Payment capability returns no enabled result until session verification, and discards stale enabled data on query failure.

Isolated Playwright global setup requires private direct/proxy diagnostics to attest the same ready ISOLATED_QA instance before fixtures. The real DEV harness has the equivalent MAIN_DEV handshake, exclusive local run lock, explicit purchase opt-in, no retries, one-way pre-submit marker and no retained trace/video. No mock interception is used for its core journey.

Real restricted DEV browser login and reload independently passed `/auth/refresh` and `/auth/me` 200 for the synthetic fixture on cart and product navigations. Catalog rendering was observed. Full genuine DEV checkout/history remains pending. Isolated real Orders/Documents suite passed 8/8; 320,390,768,1440,1920 widths asserted no horizontal overflow, owner/404/logout boundaries, keyboard controls and scoped axe checks. Existing captured details and preview images were opened/inspected. No new visual design or Figma fidelity claim is made; screenshot source continuity is preserved. Headless native PDF viewing uses the application's truthful download fallback.

## 6. Email and PDFs

Shared DEV dispatch is forced off by default. Explicit allowlist opt-in requires approved configuration, no sendable backlog and pool headroom. No historical email was replayed. Initial DEV aggregates: four ACCEPTED/delivery UNKNOWN events, no sendable backlog; provider acceptance is not delivery. No new task purchase means no genuine DEV commerce-email/PDF outcome to claim.

QA restart logged producer/dispatch capture, provider disabled, supervised capture worker READY PID 86048. Escalated CIM confirmed worker existence and preserved PostgreSQL PID 67080. Existing capture files predate this task; configuration/readiness does **not** prove a new captured email. Serialize launch attempts because the pre-existing email helper has a stale-lock reclaim race under concurrent starts; no concurrent restart was attempted.

Isolated actual invoice/receipt/summary downloads had `%PDF-` bytes, correct ElectroHub order-reference filenames and >10KB content. Preview/fallback, customer-B 404, logout and read-only document actions passed. A further separate-context check at 720 CSS px / DPR2 (1440×900 physical, 200%-equivalent) showed three document controls, no horizontal overflow and a 19,631-byte invoice preview response (`200 application/pdf`, `%PDF-`), with the screenshot opened/inspected. Headless Chromium ignored Ctrl+Plus: this is viewport emulation, **not verification of native browser zoom controls**. Screenshot: `apps/frontend/test-results/isolated/task04-documents-1440-zoom200.png`. Existing Arabic PDF exception remains unchanged. DEV PDF from the requested new purchase: NOT VERIFIED.

## 7. Performance

All below were actual bounded measurements, concurrency 1, complete HTTP body consumed or pg SELECT 1, no provider writes. Database driver pg, max 1, trusted CA. API-only customer login is a separately authorized reversible auth write; timed endpoint requests are reads. The empty synthetic customer is the stable fixture for cart/orders.

| Workload / environment | Samples | Baseline p50/p95 ms | Final p50/p95 ms |
|---|---:|---:|---:|
| DEV session pooler warm SELECT 1 | 30 each | 433.93 / 542.43 | 351.78 / 1786.99 |
| DEV pool acquisition | 30 each | 0.08 / 0.87 | 0.10 / 1.28 |
| Disposable TLS warm SELECT 1 | 30 | — | 0.35 / 1.15 |
| Disposable pool acquisition | 30 | — | 0.02 / 0.36 |
| DEV GET products page1/pageSize12 | 30 each | 422 / 987 | 392 / 513 |
| DEV GET owned cart | 10 | — | 741 / 826 |
| DEV GET owned empty order history | 10 | — | 1787 / 5526 |

DEV cold connect/select baseline 2457.54/349.20 ms; final 2294.90/329.01 ms. Local cold 141.80/1.67 ms. Both final DB probes: 30/30 acquires, zero errors, read-only transaction passed. Initial sandbox DNS failures were tooling failures, not performance samples. The benchmark now aborts after one failed cold connection; no fallback target.

Pool wait is negligible relative to remote warm round-trip time. Remote RTT is a confirmed contributor, not a proof of region/root cause. Source shows existing authenticated order history uses authorization reads plus a find/count transaction, so serial network round trips are a plausible contributor. Actual SQL query counts for that HTTP workload were **not captured** by normal adapter logging; do not substitute inferred counts. Existing catalog search uses one CTE query. The 10-sample authenticated results are diagnostic only (below the preferred 30); no checkout/UI p95 is claimed. Tail latency remains unresolved. No connection-pool enlargement, isolation weakening, cloud relocation or SQL rewrite was justified. Variation in two catalog samples is **not claimed as an optimization**.

## 8. Tests and provenance

Executed on Windows/Node v22.19.0 with existing pinned dependencies; CI's Node 20.11 runtime was not reproduced. Writable TEMP/TMP `.cache/task04-temp` resolved sandbox Vitest transform-cache EPERM. Escalation enabled actual localhost/TLS sockets where the sandbox blocked them; TLS was not disabled for application tests.

| Check / command | Actual result / provenance |
|---|---|
| Backend Vitest source regression (single fork, explicit `.isolated/env.json` pair+CA, NODE_ENV=test, mock Test key/Brevo blank) | 66 files passed,9 skipped;1244 tests passed,98 skipped. DISPOSABLE plus mocks; skipped external/barrier/manual gates are not passes. |
| Final backend delta: payment-isolation, database-target, dev-supervisor, prisma, development-runtime route | 5 files /54 passed; includes production compatibility and schema option guard. MOCK/DISPOSABLE-local sockets. |
| `node --test scripts/dev-payment-runtime.test.cjs scripts/dev-isolated.test.cjs scripts/task04-db-benchmark.test.cjs scripts/task04-dev-acceptance.test.cjs` | 25/25 passed after token-writer and port-alias fixes. MOCK, no shared writes. |
| Frontend `vitest run` | 106 files /891 passed. Existing jsdom window.scrollTo diagnostics; no failing tests. |
| Final frontend config/capability/preflight delta | 3 files /25 passed. MOCK. |
| Backend `npm run typecheck`, `npm run lint`, `npm run build` | PASS. Build repeated after reviewed guard changes; final lint passed. |
| Frontend `npm run typecheck`, `npm run lint`, `npm run build` | PASS. Initial two unused-parameter lint failures corrected; final lint/typecheck passed. Existing >500KB chunk warning remains. |
| `npx playwright test -c playwright.isolated.config.ts order-documents --trace off` | Final stable run8/8 PASS, actual disposable API/DB/PDF worker, no provider. Initial live-config reload caused one socket hangup before clean rerun. |
| `TASK04_DEV_PURCHASE_APPROVED=1; npx playwright test -c playwright.task04.config.ts` | NOT PASS; browser reached Payment but Stripe's secure form remained loading. No `/submit` request or order. A pre-submit Task04 attempt exists because the Payment step created it; see bounded post-stop reconciliation above. |
| `node scripts/task04-db-benchmark.cjs --source=direct --samples=30` | DEV read-only and explicitly configured disposable read-only measurements above; zero final errors. |
| Restricted API HTTP probe and real browser session probe | All50 timed catalog/cart/orders GETs200; capability200 false. Login and hard navigation restore200. SHARED_DEV_READ_ONLY endpoint provenance. |
| Git/CI | `git fetch origin`, status/log/diff inspection and `git diff --check` PASS. Relevant ci/security/dev-migration/verify-migration workflows inspected. No remote CI execution for this uncommitted tree. |

Raw local logs, credentials, diagnostic tokens, process locks and generated test artifacts remain ignored in backend `.cache` / `.isolated` and frontend `test-results`. This report intentionally contains no credentials, customer addresses, Stripe secrets, provider identifiers or private diagnostic tokens.

## 9. Security and rollback

Negative matrix covers missing/malformed/unknown targets, mixed DEV/PROD/local datasets, mismatched local ports, public-schema overrides, URL endpoint/TLS overrides/duplicates, global TLS disable, transaction runtime pooling, NODE_ENV=test on shared targets, live keys in nonproduction, copied approvals, forged/replayed/wrong-parent IPC and revoked/disconnected authority. Denied service tests prove zero provider/database calls. QA launcher pins its own exact cluster credential before any migration; numeric reserved-port aliases are rejected.

Restricted rollback was exercised on the real compiled DEV API after clean supervised shutdown. Authenticated payment capability returned `{paymentsEnabled:false}`; catalog/cart/history reads and session reload still worked. Financial records and historical incidents/outbox were preserved. Shared mutation permission cannot survive supervisor IPC disconnect. The payment supervisor/listener/API :5000 are stopped and its lock is cleared. The isolated PostgreSQL cluster at :55434 remains running. At the last process snapshot, :3000 had both the older unrelated IPv6 PID72380 (started Oct19) and a 127.0.0.1 listener PID81424; ownership was not rechecked, so do not treat either listener as verified MAIN DEV. Recheck direct/proxy identity before browser use.

## 10. Acceptance matrix

Paths are repository-relative here; MOCK means no claim of remote provider evidence.

| Gate | Status | Implementation / environment / evidence | Remaining gap |
|---|---|---|---|
| T04-01 | PASS | Branch/base/fetch/status/diff; this registry | Uncommitted by instruction |
| T04-02 | PASS | `viteServerConfig.ts`; actual :3000→:5000 MAIN_DEV attestation/browser | Full purchase journey pending |
| T04-03 | PASS | `database-target.ts`, `prisma.ts`, diagnostic; SHARED_DEV_READ_ONLY TLS/preflight | None in inspected scope |
| T04-04 | PASS | `dev-isolated.cjs`, isolated global setup; DISPOSABLE real browser/TLS | Separate browser contexts required |
| T04-05 | PASS | Target/payment guard matrix; MOCK/DISPOSABLE | No shared destructive negative execution |
| T04-06 | PASS | Explicit runtime source/session selection; actual session smoke | Alternative direct IPv6 endpoint not separately benchmarked |
| T04-07 | PARTIAL | Unchanged max5, reserve10/15, actual session counts/refusal | Supavisor tenant capacity not independently reconfigured/proven |
| T04-08 | PARTIAL | IPC supervisor readiness and owned listener/API/runner reached ready; exact two-ID scope implemented, reviewed, and tested | Runtime remains stopped; out-of-scope backlog review and separate operational authorization are required before restart |
| T04-09 | PASS | Canonical account read, Test-only nonprod guard; read-only intent livemode=false | Genuine task charge pending |
| T04-10 | NOT VERIFIED | Gated `tests/task04/dev-commerce.spec.ts`; core mocked/disposable regressions pass | Stripe card form did not load; confirm/decline/retry/dismiss acceptance pending |
| T04-11 | PARTIAL | Unchanged financial domain; 1244 regression tests, lifecycle tests | Skipped manual/barrier/provider scenarios not rerun as live evidence |
| T04-12 | PASS | Capability hook tests, route regression; restricted DEV actual false | Supervised enabled path source/lifecycle tested; real task submit pending |
| T04-13 | NOT VERIFIED | Synthetic fixture has one pre-submit attempt, one cart line, and zero orders | Genuine paid order, stock/cart completion, and restart persistence not exercised |
| T04-14 | PARTIAL | Real DEV auth/cart/product reload; isolated Orders8/8 | Full genuine DEV checkout/history pending |
| T04-15 | PARTIAL | Shared dispatch off; isolated supervised capture READY | No new genuine task email/capture; no delivery claim |
| T04-16 | PARTIAL | Actual disposable PDFs/owner404/logout/read-only8/8 | New genuine DEV order PDF pending |
| T04-17 | PARTIAL | Bounded pg benchmark + API measurements above | Checkout/UI and correlated SQL-count metrics incomplete |
| T04-18 | PARTIAL | Negligible pool wait, large measured remote RTT, no speculative tuning | DEV order-history tail remains unresolved |
| T04-19 | PASS | Broad regression + target/adapter/guard delta | 98 skipped gated tests explicitly excluded |
| T04-20 | PASS | Exact launcher cluster/credential pin + negative target tests before writes | No intentional shared fixture write attempted |
| T04-21 | PARTIAL | Actual Windows start/stop/restart, strict ports, reserved-port aliases; worker scope fix reviewed | No runtime restart under the code-only approval; backlog review and separate operational approval remain |
| T04-22 | PASS | Private diagnostic, safe event-only IPC, redacted logs, degraded/child-exit tests | No public detailed target diagnostic |
| T04-23 | PASS | Actual clean stop + restricted compiled API/capability false; no data deletion | Genuine paid-order restart persistence pending under T04-13 |
| T04-24 | PARTIAL | Specification, evidence, runbook, exact worker-scope implementation and PAYMENT/Architect review | Genuine checkout and remaining external acceptance pending |

## 11. Remaining risks

1. The worker is now gated by the exact two-ID allowlist in supervised DEV. Keep the runtime stopped until the out-of-scope backlog has been reviewed, a fresh read-only preflight passes, and separate operational authorization is granted.
2. One additional older customer's DECLINED attempt has an expired LEASED work row and was processed by the unscoped worker. Preserve it pending owner review; do not retry or rewrite it.
3. No real task Test Mode purchase, signed webhook/payment/order witness, paid-order restart, new DEV PDFs or commerce email acceptance exists yet. `--witness` deliberately refuses anything short of unique PAID/DONE/order/provider success and a persisted signed event.
4. Remote authenticated Orders tail latency remains high; preserve existing transaction/auth guarantees while preparing a reviewed measured read-path optimization. Pool growth is not supported by these measurements.
5. Supavisor tenant headroom is conservatively gated but not equivalent to verified provider tenant limits. Stopped sessions can briefly delay restart.
6. Existing email helper concurrent stale-lock reclaim race: serialize starts; no external-send concurrency certification. Existing Arabic PDF exception, RLS/advisor findings, large frontend chunk and CI/runtime-version difference remain explicit.

## 12. Self-review and file manifest

Self-review: the CCR code scope passed focused offline tests and PAYMENT re-review. Overall Task 04.0 remains **STOPPED / PARTIAL** because the runtime was intentionally not restarted and the genuine checkout/final Architect acceptance remain incomplete. No merge, deployment, or full-task acceptance is claimed.

Changed tracked paths:
`apps/backend/.env.example`; `apps/backend/scripts/dev-isolated.cjs`; `apps/backend/scripts/dev-payment-runtime.cjs`; `apps/backend/scripts/dev-payment-runtime.test.cjs`; `apps/backend/src/__tests__/payment-isolation.test.ts`; `apps/backend/src/bootstrap.ts`; `apps/backend/src/config/env.ts`; `apps/backend/src/lib/prisma.test.ts`; `apps/backend/src/lib/prisma.ts`; `apps/backend/src/payment-isolation.ts`; `apps/backend/src/payment-runner.ts`; `apps/backend/src/routes/index.ts`; `apps/backend/src/services/__tests__/payment-inprocess-recovery.test.ts`; `apps/frontend/playwright.isolated.config.ts`; `apps/frontend/src/features/checkout/paymentCapability.ts`; `apps/frontend/vite.config.ts`.

New source/tests:
`apps/backend/scripts/dev-isolated.test.cjs`; `apps/backend/scripts/task04-db-benchmark.cjs` and `.test.cjs`; `apps/backend/scripts/task04-dev-acceptance.cjs` and `.test.cjs`; `apps/backend/src/lib/database-target.ts` and `.test.ts`; `apps/backend/src/lib/dev-supervisor.ts` and `.test.ts`; `apps/backend/src/payment-runner.test.ts`; `apps/backend/src/routes/development-runtime.routes.ts` and `.test.ts`; `apps/frontend/playwright.task04.config.ts`; `apps/frontend/src/config/viteServerConfig.ts` and `.test.ts`; `apps/frontend/src/config/isolatedRuntimePreflight.test.ts`; `apps/frontend/src/features/checkout/paymentCapability.test.tsx`; `apps/frontend/tests/isolated/global-setup.ts`; `apps/frontend/tests/task04/dev-commerce.spec.ts`; `apps/frontend/tests/task04/global-setup.ts`.

Documentation: `docs/10_Operations/DEV_ENVIRONMENT_RUNBOOK.md`, this evidence, `database-discovery.json`, and the preserved initially untracked Task04 specification with compact invariants added. Ignored local `.env.local` gained only the explicit runtime-source setting; secrets were not changed or committed. No generated Prisma/schema/migration/dependency files changed.

## 13. Architect handoff

```text
IMPLEMENTATION: STOPPED / PARTIAL (T04-PAY-01 code scope implemented and offline-tested; payment runtime remains stopped)
MAIN DEV: PARTIAL (persistent target/restricted reads verified; payment runtime stopped after worker scope defect)
ISOLATED QA: VERIFIED
STRIPE TEST MODE: PARTIAL (canonical account and no-card provider observations verified; genuine task checkout not verified)
DEV SCHEMA: VERIFIED (physical metadata + migration ledger scope above)
PROD SCHEMA: VERIFIED (physical metadata + migration ledger scope above)
MIGRATION ACTIONS: NO-OP
PERFORMANCE: UNRESOLVED
BROWSER QA: PARTIAL (isolated suite passed; DEV Stripe card form remained loading)
CCR T04-PAY-01 REVIEW: PAYMENT, Architect, and user code-scope approval complete; separate runtime authorization NOT GRANTED
READY FOR FINAL INDEPENDENT ARCHITECT ACCEPTANCE: NO — worker fix, regressions, and remaining external acceptance are incomplete
COMMIT: NO
PUSH: NO
MERGE: NO
DEPLOYMENT: NO
```
