# Phase 06.2 runtime reliability and operational recovery

Date: 2026-11-13. Branch: `feature/06.2-accessibility-qa-ci-cd`. Existing [PR #51](https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform/pull/51), target `develop`. Starting local and verified PR head: `4bef532b453b7e50ffd086f2343149ab44169a17`.

## Scope, architecture and confirmed findings

The existing architecture is retained: Vite on 3000 proxies `/api` and `/socket.io` to the single API on 5000. Shared DEV payment writes require the existing supervisor's compiled API, verified database/TLS/migrations/connection budget, canonical Stripe Test account, bound CLI signing secret and live IPC activation. Checkout mode starts no payment-recovery worker. Commerce email/push dispatch has separate durable queues and permissions. Contact and administrator security/operational email use their existing independent Brevo paths.

Initial working tree already contained concurrent payment-service/domain/route/tests, database-pool and checkout UI edits. Those files were not authored or staged as part of this runtime change. No reset, cleanup, force-push, merge, deployment, shared migration or historical payment mutation was performed.

| Finding | Evidence and classification |
| --- | --- |
| No root workflow owned the whole primary stack | Root scripts started frontend/backend separately; watched `dev` deliberately lacks shared financial authority. **CONFIRMED workflow gap**, not an authorization defect. |
| Dormant/bootstrap backends escaped process-name inspection | Supervisor inspected `server.ts/js`, whereas current entrypoint is `bootstrap.ts/js`. Detection now covers both. Port/lock/IPC checks remain. |
| Worker launch was mistaken for readiness | Email helper returned a static `started:true`; readiness polling stopped after its first verdict, so later failure was not exposed to a stack status command. Now live status follows child exit/restart and per-PID log readiness/heartbeats, excluding earlier PID generations and stale heartbeats. |
| Windows worker shutdown did not drain | Helper called `child.kill()` immediately and released its lock. Now the owned IPC worker stops new claims on disconnect, drains, and the helper waits before releasing ownership. Failed shutdown retains its lock; existing durable leases remain. |
| Spawn failures could strand worker processing | Child `error` only logged; it now shares the bounded crash/restart path with duplicate error/exit suppression. Same-supervisor duplicate worker locks are refused. |
| Read retries lacked jitter and ignored Retry-After | Existing query retry count remains one; delay now includes jitter and server wait floors. Long waits do not automatically retry early. Mutation retries remain disabled. |
| IPv4-only diagnostics misclassified healthy Vite | Actual `localhost:3000` returned 200 while `127.0.0.1:3000` refused. Doctor uses the documented localhost origin. Windows owner inventory plus accepting-socket probes protect both families. |
| Existing runtime uses the legacy control protocol | Payment lock recorded supervisor PID 5644, owned listener/API PIDs 6848/27556, all alive when inspected. API PID 27556 owned port 5000. Private diagnostic returned MAIN_DEV and a stable instance ID, but lacks new child/parent authority attestation. New launcher safely refuses replacement/adoption. |
| Not every reported Retry failure is reproduced | Bounded recent logs contained `PAYMENT_MUTATIONS_DISABLED` (19), `PAYMENT_UNAVAILABLE` (6), `email_producer_disabled` (1), `admin.notification.failed` (6), one generic DB error, 401/429/validation events. These are historical aggregate observations, not proof that one root cause explains all operations. No raw messages, tokens, recipients or customer records were published. |

## Implemented runtime and ownership contract

Root commands: `dev:stack:supervised`, `dev:stack:status`, `dev:stack:doctor`, `dev:stack:stop`, `dev:stack:restart`; optional startup/restart flag `--allow-email-allowlist`. [Workflow and prerequisites](../../11_Workflow/DEVELOPMENT_RUNTIME.md).

Exclusive root and supervisor control records contain private random capabilities. Loopback-only HTTP control authenticates owner identity/PID and rejects browser Origin requests. Stop asks the owner to drain its real ChildProcess handles; no recorded PID is killed. Stale/conflicting records fail closed. Secrets are not returned by status. A new supervisor can be reused only when its private API diagnostic proves child/parent PID binding, live shared-DEV authority and database identity/TLS. Borrowing a supervisor does not transfer shutdown ownership.

Fresh startup verifies ports, ensures Prisma Client is current, builds the backend, invokes the existing checkout supervisor without recovery flags, waits for its activation, starts Vite independently, waits for the owned Vite-ready IPC signal and verifies proxied/direct API instance identity. Parent stop during preflight is remembered so a payment runtime cannot start after its session has ended. Financial-child failure drains siblings and never triggers an automatic financial replacement. Root monitoring reports readiness loss/recovery without granting new authority. Backend restart drains and re-runs preflight; frontend HMR never reloads payment code.

## Live main-application observations

Read-only probes were performed against the actual localhost services, without restarting port 5000.

| Operation | Actual result | Meaning / limitation |
| --- | --- | --- |
| `localhost:3000/` and `/@vite/client` | 200 | Frontend available; IPv4 alias was not listening. |
| `localhost:3000/api/health/ready` | 200, database connected | Proxy reaches a real ready API. |
| Backend `/api/health`, `/api/health/ready` | 200 | Liveness and live database query passed independently. |
| Private development diagnostic | 200 MAIN_DEV | Stable observed instance `ad902b60-4248-497c-a737-f82fa61158dc`; old protocol, new supervisor binding **NOT VERIFIED**. |
| `/api/products`, `/api/store/profile` | 200 | Public product/store reads passed. Initial diagnostic wrong-path/invalid-pagination probes (404/400) were corrected; they were not application defects. |
| Swagger `/api/docs/`, Engine.IO polling handshake | 200 / valid handshake | Documentation and transport available. Authenticated socket event delivery is separate. |
| `/api/auth/me`, `/api/admin/settings/store`, `/api/checkout/payment-capability` without credentials | 401 | Expected authorization boundary. Customer/admin sessions, MFA and authenticated capability **NOT VERIFIED on shared DEV**. |
| Admin alerts | No authenticated shared test | Initial `/api/admin/operational-alerts` probe was a diagnostic wrong path (404), not evidence of a missing supported route. |
| Contact POST | No live message submitted | Actual provider acceptance/inbox delivery **NOT VERIFIED**; controlled capture regression tests passed. |
| Private profile photos | Bucket checked read-only | Actual existing-customer upload/reload/header URLs **NOT VERIFIED**; storage/service/photo-manager regression tests passed. |
| New root startup with old services active | Refused occupied port, no replacement | Main-stack one-time upgrade is **BLOCKED by legacy ownership**, not bypassed. Stop the original sessions with their owning terminal before adoption. |

Doctor reports actual evidence instead of hard-coded readiness. Authentication, private storage, completed financial operations, contact acceptance and OS notifications remain NOT VERIFIED when no authorized identity/provider test was performed. A missing new control record does not prove the old runtime's payments are disabled.

## Database, email, notifications and financial safeguards

Read-only connected Supabase DEV inspection found 43 migration rows with zero incomplete/rolled-back/log-bearing rows, the relevant store/admin-notification/commerce/customer-notification/push tables present, and the `profile-photos` bucket private. One point-in-time sample had **10 client sessions, zero idle-in-transaction sessions**. It does not prove absence of a leak over time or available pooler headroom. No session/connection limits were changed; concurrent uncommitted pool edits were preserved and are outside this commit.

The queue aggregate was **26 READY, 16 ACCEPTED**. No queue row was replayed, deleted or claimed by this task on DEV. ACCEPTED is provider acceptance recorded previously, not new inbox evidence. Startup still rejects old sendable work for allowlisted recipients. The allowlist flag requires prior producer/dispatch/send-mode/recipient configuration; no unrestricted sender or historical recovery is activated. Email worker READY is distinct from provider acceptance. Push continues to require its existing independent approved target, VAPID/consent/session-family ownership and browser/OS support.

Stripe credentials/account/listener are validated by the unchanged preflight. No shared payment attempt was created, captured, canceled, refunded or recovered by this task. No real Stripe purchase or signed webhook completion was established by health checks. **Shared-DEV financial acceptance: NOT VERIFIED.** Existing checkout/recovery/idempotency protections remain and are covered by supervisor tests; uncertain attempts must use existing separately reviewed recovery, never startup replay.

## Verification ledger

| Check actually invoked | Result so far |
| --- | --- |
| `npm run test:runtime` (with localhost tool access) | **PASS 43/43**, before the final Vite-readiness/extra socket-check review; final repeat recorded below. First sandboxed run: 41/42, one HTTP test denied by sandbox network; unrestricted local rerun passed. |
| Backend focused Vitest: development-runtime, commerce-email-dev-runtime, storefront routes/capture/contact service, profile service/storage, alert acknowledgement, payment isolation (`--maxWorkers=1`, hermetic dummy credentials) | **PASS 70/70, 9 files**. No shared DB/provider access. |
| Frontend focused Vitest: `query-reliability`, `api`, `ProfilePhotoManager` (`--maxWorkers=1`) | **PASS 35/35, 3 files**. Retry-After/jitter/session refresh/signed-photo failure regression coverage. |
| `npm run typecheck --workspace=@electrohub/backend` | **PASS**. |
| `npm run lint --workspace=@electrohub/backend` | **PASS**. |
| `npm run build --workspace=@electrohub/backend` | **PASS**. |
| Frontend lint/typecheck/build | Initial commands **PASS** (lint: zero errors, four existing Fast Refresh warnings; build: existing Sass/bundle warnings). Repeated after retry changes; final results below. |
| Full frontend Vitest (`--maxWorkers=2`) | Running at initial evidence draft; no pass claimed. |
| `node scripts/delivery-pg.cjs` from backend | Running at initial evidence draft; isolated native PostgreSQL, provider mocks/capture. This harness deliberately excludes four pgvector/media-dependent migrations; it cannot establish full migration replay. |
| Release Playwright desktop Chromium/Firefox/WebKit | Running at initial evidence draft. First invocation used wrong project names and executed no tests; corrected names initially hit Windows reserved-port forwarding (`P1001`). A disposable-only loopback byte relay then enabled real TLS PostgreSQL migrations and the actual browser suite. First three Chromium admin/MFA/inventory/live-tracking journeys passed; no whole-suite pass claimed yet. |
| `git diff --check` | **PASS** at review; final repeat below. |

The temporary relay/container and synthetic fixture state are git-ignored test infrastructure. They do not change main application ports, database TLS or shared database configuration. Browser fixture providers are not Stripe/Brevo financial/email completion evidence.

### Final verification and Git/CI record

- Final runtime repeat: **44/44 PASS**, including corrupt worker locks, Windows accepting-socket checks and Vite-ready IPC.
- Full frontend two-worker runs were **FAIL**, not green: one had 1,574 passing assertions/185 files plus one worker crash; the other had 1,558 passing assertions/185 files plus two worker crashes, including `Fatal process out of memory: Zone`. A one-worker follow-up encountered the full disk and was stopped; it is not a passing suite.
- The native delivery PostgreSQL harness failed during `psql.exe` migration provisioning and ran no assertions. Its own stopped temporary cluster was removed; provisioning evidence was retained. The separate release Docker database did successfully replay migrations through the loopback relay and ran real browser journeys.
- The browser run reached 34 reported Chromium cases: two AI cases skipped, wishlist/account-isolation and session-reload journeys failed, remaining reported cases passed. The full browser run did not complete after host resource exhaustion; Firefox/WebKit acceptance is **NOT VERIFIED** for this run. Failure traces are retained under the git-ignored frontend release test-results directory. These failures are not dismissed as application passes.
- Inspection of both failed journey `test.trace` records identified **`browserContext.close: ENOSPC: no space left on device, write`**. They are infrastructure/teardown failures, not demonstrated application assertion defects; the interrupted invocation is still **FAIL**, not relabeled green. Task-owned container/state cleanup subsequently increased free space to about 1.1 GB. No unrelated disk cleanup was attempted.
- Drive C reached **zero free bytes** during verification; PowerShell/native tools and writes started failing. Cleanup stopped only verified task-owned test/relay processes and removed only this task's stopped PostgreSQL cluster, recovering about 611 MB. No unrelated cache, worktree, process or application data was removed. The full-disk condition is a material operational risk and prevents credible broad-suite completion until adequate headroom exists.

Final local runtime suite: **46/46 PASS**, including production/insecure invocation refusal and disk exhaustion diagnostics/startup guard. Focused frontend repeat and recovered production build are recorded in the delivery PR comment; recovered build passed. Broad suites remain resource-blocked as described above. Exact final implementation SHA, push reconciliation and final-SHA Development CI/Security Audit/migration status are recorded in PR #51 when available. Starting SHA CI was green, but is not used as evidence for this revision. The migration workflow is path-filtered and this change introduces no migration; a non-triggered workflow must be reported NOT APPLICABLE, not passed.

## File manifest and documentation

- Root package scripts and runtime launcher/Vite wrapper/control module/tests under `scripts/`.
- Existing payment supervisor and its tests: local control, bootstrap process detection, preflight stop handling.
- Email helper/runner/tests: live readiness, duplicate prevention, bounded error restart and IPC drain.
- Private development diagnostic and tests: child/parent/authority attestation, retaining token/loopback/nonproduction guards.
- Frontend shared API/query foundation and focused tests: Retry-After floors and bounded jitter.
- Development CI: runtime safety suite after backend build.
- README, commerce email runbook, new development workflow and this evidence document.

No public API contract, database schema, design tokens or UI layout was changed. No new ADR was required: ownership orchestration extends the established supervisor instead of replacing it. Visual QA: NOT APPLICABLE to these nonvisual changes; no Figma/pixel-matching claim is made.

## Remaining acceptance / local handoff

1. Stop the **legacy** supervisor and Vite from their actual owning terminals once. Do not kill unrelated PIDs or delete a live lock. Start `npm run dev:stack:supervised`; resolve any genuine DB/Stripe/migration/backlog/connection-budget gate through existing reviewed procedures.
2. Confirm doctor READY for required services and authenticated customer capability. With an approved synthetic identity, perform login → account/photo → products/cart/wishlist → isolated Test Mode payment → orders/tracking/contact without restarting API 5000. Verify signed webhook persistence separately from redirects.
3. Perform admin login/MFA → dashboard/settings/alerts/products/inventory/orders/delivery/profile under the same API instance. Existing authenticated acceptance cannot be inferred from unauthenticated 401s.
4. Enable only explicitly approved allowlist recipients with no old sendable backlog; test new welcome/order/out-for-delivery events, worker heartbeat, provider acceptance and actual delivery as separate stages. Never replay unknown READY/UNCERTAIN rows to satisfy this check.
5. Verify subscribed browser push/receipt and OS presentation separately, bounded navigation uptime, database session trend, worker failure/restart, signed-photo expiry, provider outage, duplicate actions and controlled restart. No indefinite-uptime claim is supported.

**Current self-assessment: NOT READY — MATERIAL SHARED-RUNTIME ACCEPTANCE REMAINS.** The implementation is reviewable independently; the task's full shared customer/admin/payment/email acceptance has not been self-approved.
