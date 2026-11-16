# Task 03.6 — Controlled Acceptance Approval

Prepared 2026-10-11. **NOT APPROVED. Execution NO-GO.** This is the single human approval packet; the existing machine approval draft is supporting evidence, not a competing authorization. No signatures or permissions are prefilled.

## Scope and evidence

- Branch `feature/Stripe`; source/runtime SHA-256 `51cc461a2b1c6586d0a0ac8bb6436ce372b796caa669920db248cc9c49c2ca86`. Runtime hash includes compiled backend; documentation is excluded.
- DEV only: `electrohub-dev`, `pzxekjybdiulzmssalfo`, `ap-northeast-2`. Stripe TEST account `acct_1UEZW5KiVgdl63pN`. Fresh identity/capture evidence is recorded in canonical Prompt 2/4; Free/Nano and 15/200/60 limits remain historical owner reports.
- Prompt 2/4 GET-only snapshot: four bounded captures, USD $52.46; authorization submission ledger **INCOMPLETE**, historical remaining allowance **UNKNOWN**. Eight due READY jobs / zero live leases was a timestamped prior snapshot, not a fresh Prompt 3 database read.
- PostgreSQL integration **NOT TESTED — OWNER SKIPPED**; historical P2028 cause UNKNOWN. Source/model locking is not PostgreSQL deadlock, MVCC or rollback certification.
- This pass: **100 harness + 128 backend + 25 frontend = 253 PASS / 0 FAIL / 0 SKIP**. One backend launch initially failed sandbox configuration access before test execution; authorized elevated rerun passed. No source/build change or financial operation occurred.

## Independent source findings

Paths below are repository-relative; line references identify inspected current source, not an approval of the entire repository.

| Control | Finding and source | Classification |
|---|---|---|
| Setup/expiry | `payment.service.ts:100-142`: owned Attempt → Work → Cart; candidate identity rechecked, expired nonterminal identity retained; only terminal identity released | SOURCE VERIFIED; source/model only |
| Late authorization | `payment.service.ts:345-379`: bound requires_capture/processing/succeeded overrides an old expiry flag; cancellation revalidates current locked local state; unknown readback reaches no destructive callback | SOURCE VERIFIED; OFFLINE TEST VERIFIED |
| Worker fence | `payment.service.ts:278-288,299-305`: Attempt → Work locks precede token/state/expiry read and fenced writes; replacement ownership cannot be overwritten between validation and update in the modeled critical section | SOURCE VERIFIED; OFFLINE TEST VERIFIED |
| Purchase | `order.service.ts:103-166`: Attempt → Work → Cart → sorted Product/Category → sorted Inventory; Serializable purchase and existing deadline retained | SOURCE VERIFIED; PostgreSQL NOT VERIFIED |
| Provider boundary | `stripe.provider.ts:11-20,36-66`: Test keys only, SDK retry count zero, stable per-attempt operation keys; provider network calls are outside inspected service transactions | SOURCE VERIFIED |
| Ownership/API/webhook | `payment.service.ts:42-49,264-270`; `payment.routes.ts:29-40,137-155`; `stripe-webhook.routes.ts:14-44,58-91`: owned customer access/no-store/strict body; raw signature authentication before atomic event ingestion | SOURCE VERIFIED; signed-webhook doubles tested |
| Bootstrap | `acceptance-launcher.cjs:9-48`: verified ledger/permissions before lazy provider factory; injected capability only. `acceptance-child.cjs:1-18` is expressly offline-only | OFFLINE TEST VERIFIED; live installation BLOCKED |
| Browser guard | `acceptance-installation.cjs:195-239`: owned context, service workers blocked, exact Intent confirm route, durable authorization reservation before forwarding, no repeated submission after unknown outcome | OFFLINE TEST VERIFIED; HOSTED RUNTIME NOT VERIFIED |
| Scoped runner | `acceptance-installation.cjs:56-74,187-193`: reject queue scans; add exact Work ID to claim; call only exact Attempt. Capture contract verifies owner/token/expiry/amount, with lease recheck after provider readback | SOURCE VERIFIED; OFFLINE TEST VERIFIED |
| Secrets | `state.ts:61-73` whitelist excludes client secret; secret is React memory/Elements only (`StripePaymentSession.tsx:66-77`); setup responses no-store. `stripe-gate-safety.cjs:14-21` redacts URLs/keys/tokens/secrets; browser network evidence retains method/path/timing, not response bodies | SOURCE VERIFIED within inspected paths; no hosted artifact certification |

No new independently reproduced P0/P1 defect in the two corrected financial paths. SECURITY-01 files were not changed; its prior closed status is retained, not broadly re-audited. Public API/schema/migrations unchanged this pass.

## Actual hosted execution boundaries — NO-GO

- Explicit authorization is `StripePaymentSession.tsx:39` (`stripe.confirmPayment`), called from `CheckoutPage.tsx:474` after Place Order. Mount/readiness/Review do not confirm. Unknown responses retain the owned attempt; retries require resolved server state (`CheckoutPage.tsx:492-529`). Backend status, not browser success, drives confirmation (`CheckoutPage.tsx:220-229`).
- **Setup itself can create a financial provider object automatically:** `CheckoutPage.tsx:323-330` calls setup; `payment.routes.ts:137-138` reaches `PaymentService.setup/process`, including `payment.service.ts:330`. Therefore ordinary Checkout initialization is NOT nonfinancial. Guard installation and creation reservation must precede the first page/API setup request.
- `stripe-browser-gate.cjs:834-838` unconditionally blocks `--execute` before environment loading/execution; the exported CLI exposes no `executeGate` capability. This barrier stays intact. `--offline-bootstrap` requires injected doubles; it is not a hosted launcher.
- **Meaningful uncovered alternate paths:** ordinary `dist/server.js` loads the default provider singleton; `dist/payment-runner.js` defaults to global `runBatch` (`payment-runner.ts:12,24`); `dev-payment-runtime.cjs:97-103` spawns those unguarded children with an unrestricted worker. Its `pg_stat_activity`/fixed-15 check (`:69-70`) is NOT tenant capacity proof. Exclude `npm run payment:dev`, `payment:worker`, ordinary API startup and legacy gate body from this acceptance scope. Do not execute them or approve a command that silently falls back to them.
- Scoped CLI `--attempt` is a production-runner convenience, not the full acceptance Work/run/budget contract. Only the injected guarded runtime's exact `runOnce` capability qualifies. A future hosted entry must demonstrably use that same boundary before app/provider initialization, expose only the approved fixture API/attempt, and reject unguarded singleton creation. **Actual live composition is not implemented/verified by this offline rehearsal. Readiness promotion stops here; approvals cannot waive this gap or remove the barrier.**
- The Playwright route matches one recognized confirm POST shape, not arbitrary Stripe.js transports/endpoints. SDK POSTs outside its recognized pattern, other browser contexts, ordinary APIs and global SDK calls are not universally intercepted. Actual hosted traffic coverage must be validated without a financial submission first under separately approved nonfinancial service scope.

## Intended topology and ownership plan — NOT APPROVED

Repository root is `C:/Users/ouss0/Desktop/Tools/Coding/Portfolio/ElectroHub — AI-Powered Electronics Commerce Platform`.

| Component | Intended identity / ownership requirement |
|---|---|
| Runtime | Observed executable `C:/Program Files/nodejs/node.exe`; match executable, PID, parent PID, cwd, run/source hash at handshake; command identity must be approved before spawn |
| API | Backend cwd; app entry `apps/backend/dist/server.js`, port **5136**, but only behind verified guarded bootstrap; ordinary direct launch prohibited |
| Frontend | `node_modules/vite/bin/vite.js` exists; frontend cwd, localhost port **3136**, strict-port; exact API proxy destination must be bound to owned API before browse |
| Stripe listener | Installed `C:/Users/ouss0/AppData/Roaming/npm/node_modules/@stripe/cli/node_modules/@stripe/cli-win32-x64/bin/stripe.exe`; signed Test listener to **http://127.0.0.1:5136/api/webhooks/stripe**; assert canonical account, owned PID, in-memory signing-secret match and durable receipt sink |
| Worker/replacement | Approved same-bootstrap injected runner only; exact Attempt/Work/run/owner/token/lease; one bounded invocation. No queue scan, `runBatch` fallback, historical recovery or unrestricted CLI |
| Database | Existing runtime selects `DIRECT_URL || DATABASE_URL` (`prisma.ts:30`), verified TLS with rejectUnauthorized true; configured Test max 5 per API/runner (`:39-48`), diagnostic 1 sequential; webhook shares API pool. Actual acquisition/pool utilization UNKNOWN |
| Ledger | One `apps/backend/.cache/stripe-acceptance-budget/<approved-run-UUID>/`; exclusive owner-role file and atomic reservations; owner-only ACL/POSIX permissions; no symlink/shared writer; exact dead predecessor required for restart; no reset/release |
| Shutdown | Owned child handles only; controlled replacement after verified original exit and lease expiry; preserve failure/ledger evidence. `acceptance-lifecycle.cjs:1-16` preserves primary failure and separately counts cleanup failures. Unknown port occupants are never killed |

Fresh read-only local metadata inspection this pass: no listener on **5000/5173/5107/5177/5136/3136**, no Stripe process observed. Other Node processes remain unidentified and untouched; absence of port listeners does not prove absence of a dormant worker. No owned hosted services, live run ledger/ACL, browser or runner were established. Required variable names include NODE_ENV, PORT, FRONTEND_URL, DATABASE_URL, DIRECT_URL, DB_SSL_CA_CERT_PATH, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CLI_PATH, VITE_STRIPE_PUBLISHABLE_KEY and ELECTROHUB_SQL_DIAGNOSTICS; values/secrets are not reproduced. No services started.

## Fixture specification — NOT APPROVED

One new run UUID binds generated immutable CUSTOMER/User ID, Cart ID, two Product/Inventory IDs and unique SKUs `stripe-acceptance-<runUUID>-A/B`. Freeze the explicit allowed-record manifest before writes. Products have no customer-owner field: test ownership is manifest identity, not a claimed database ownership relationship.

| Resource | Contract |
|---|---|
| Customer/Cart | One active CUSTOMER and its one owned isolated Cart; no existing customer or curated records; synthetic shipping contact only; no admin/public role changes |
| Product A | USD 1.00, quantity 2, stock 10 → 8 |
| Product B | USD 0.50, quantity 3, stock 10 → 7 |
| Visibility | ACTIVE products and active existing approved category; **isTestFixture=false required** by `cart.service.ts:31,69,94` and purchase Product filter. Products become customer-visible: explicit approval required; never weaken visibility restrictions |
| Amount | Actual compiled `checkoutTotals('3.50', EXPRESS.price)` returned subtotal 3.50 + shipping 9.99 = **13.49 USD**. Current function adds no tax/discount; authoritative server quote/revision must match exactly 1349 cents before any provider creation/authorization |
| Isolation | Exact IDs/SKUs, inventory-before snapshot, scoped Cart revision and permitted transitions; no category/curated Product changes, historical work or shared fixture cleanup |

No fixture IDs or records created in this prompt. Existing fixture helper is a specification, not permission. An existing active category must be approved without modification; category identity remains unselected.

## Separate financial budget and receipts — NOT APPROVED

Propose an independent run, explicitly separated from historical batch `1c678aad-5b76-4453-84bb-39187417613a`: **one new PaymentIntent, one authorization submission, one capture, maximum 1349 cents USD** on the canonical TEST account. Historical accounting remains incomplete; owner must approve its reconciliation or a written accounting disposition and separately authorize this new ceiling. No historical reset, overwrite or inferred remaining allowance.

Keep original Intent and keys for the entire run. Actual irreversible callbacks require atomic durable reservations before send; unknown outcome retains allowance across restart and blocks new sends. Only authoritative GET reconciliation can resolve uncertainty. No second capture/authorization, replacement Intent, cleaner-result retry, refund/cancel/compensation or webhook resend is authorized.

`acceptance-budget.cjs:126-130` persists reservation/dispatch-intent identity and `:105-109` sanitized provider outcome. **It does not record complete actual dispatch timestamps, HTTP path/status, Stripe request ID or human approval reference.** Treat dispatch-intent count as conservative attempted allowance, not proof the network request was sent. Before execution, operator must verify a sanitized append-only receipt capture bound to the same ledger; missing request metadata stays UNKNOWN, never backfilled from event timestamps.

Required immutable receipt columns: run and approval reference/hash; local operation ID; reservation/dispatch-intent time distinct from actual network-send UTC; API method/path; Attempt/Intent/Work; owned PID/browser-session; local request ID and Stripe request ID when exposed; idempotency fingerprint; response HTTP status; submitted/not-sent/unknown; confirmed/declined/failed/timeout/unknown effect; Charge/capture identity; amount/currency; readback reference. Stripe.js may not expose its internal request/key: record that limitation and require authorized Workbench correlation; never claim the ledger key was set on Stripe.js by the browser route.

## Performance contract — proposed, NOT APPROVED

One future purchase gives one-run maxima, **not p95/p99 or production compliance**. Correlate browser request UUID → X-Request-ID → backend spans; map Attempt → Work → Intent/request receipt. No summing nested provider/transaction spans. Unknown or missing boundary means NOT VERIFIED, not PASS.

| Proposed target | Start → end / measurement / waiting policy |
|---|---|
| Setup ≤10s | Browser `payment-request-start` → HTTP response and `payment-request-response`; includes network, authentication, pool/transaction/provider waits. Report backend router ingress→response-finish separately (`payment.routes.ts:14-25`) |
| Reuse ≤5s | Same boundaries for compatible same-key/same-Attempt request; report replayed=true and Intent unchanged. At most one separately recorded noncreating setup reuse; guard rejects a new creation |
| Intent create ≤3s | `stripe.create` callback start→settled provider response, including network and projection; SDK maxNetworkRetries=0. Provider service spans are client-observed, not Stripe internal processing |
| Purchase transaction ≤10s | OrderService transaction request→settled commit/error; also show callback entry/exit, acquisition-and-BEGIN and lock/operation spans separately. Includes waiting/commit in outer span; pure Prisma acquisition UNKNOWN |
| Hosted fields ≤5s | Maximum of same-attempt secret available, Stripe.js initialized and approved auth/quote prerequisites ready → `PaymentElement.onReady`; includes subsequent React/Elements/render waits. Record `elements-context-ready` separately, then validate usable hosted input without confirming |
| Pay→Confirmed ≤30s | Owned browser actual Place Order activation→server-verified confirmation visibly rendered; `authorization-start`→`confirmation-navigation` are supporting marks, not exact click/paint substitutes. Includes recovery/lease/provider/webhook/DB/poll/network delays; user/3DS wait separately recorded, never silently excluded |

Artifacts: sanitized browser monotonic marks/visibility assertion, request UUID HTTP trace, PaymentSetupTiming structured spans, OrderService timings, bounded demand/error diagnostics, owned worker/readback receipts. Timeouts classify provider unknown, transaction unknown/P2028, or readiness timeout distinctly; no timeout increase or automatic purchase repeat. Any threshold failure stops new submissions, preserves the single sample and requires owner review. Existing 25-second readiness UI deadline and 30-second DB deadline are unchanged; proposed smaller SLOs do not alter runtime deadlines.

## Single operator evidence packet

- **Stripe owner:** provide all ten historical submission receipts with operation sequence/UTC/method/path/request IDs, Attempt/Intent bindings, key fingerprints, submission/effect classification and batch inclusion/exclusions; reconcile missing tenth identity, three null-request event associations and no-event retries/timeouts. Use canonical Prompt 2/4 table and exact event IDs; sanitized export, no privileged credentials.
- **Supabase operator:** for DEV exact database/role/connection-mode pools, timestamped effective client and session limits, active/idle backend sessions and clients, waits/queue, recent representative peaks, rejection/timeout/error deltas, other consumers and explicit separate reserves. Existing Grafana/authorized `/customer/v1/privileged/metrics` export, requested 60-second samples over representative last 60 minutes; extend if not representative. Obtain Supabase Support report for unavailable tenant fields. Client/session/PG headroom calculations must use comparable scopes/windows; configured 5+5+1 and PostgreSQL totals are not tenant utilization.
- **Runtime owner:** approved executable/port/parent/cwd/run/ledger/browser identities plus evidence actual hosted API/provider injection and exact runner are guarded before initialization; fresh listener signature binding and no dormant/unowned worker. No credentials need be given to Codex.

## Incident, restoration and retention — NOT APPROVED

STOP new mutations for wrong project/account/live key, unknown/insufficient headroom/reserve, unapproved budget/fixture/API mutation, ownership or source mismatch, historical work touched, guard bypass, wrong Intent/amount/work/token, uncertain provider/commit, P2028/timeout, duplicate submission/effect, stale completion, unexpected inventory/state change, invalid webhook signature or credential exposure.

After STOP: freeze further financial submissions; preserve IDs/receipts/ledger; GET/SELECT reconciliation only; report to owner. No blind retry, replacement object, refund, cancel, compensation, financial deletion, fixture deletion or budget reset. This restriction also blocks production-required compensation in the acceptance adapter; unexpected business failure is an incident, not permission to disable production safety.

| Resource class | Restoration boundary |
|---|---|
| Disposable fixtures | Only separately approved exact run-bound nonfinancial cleanup after authoritative terminal-state verification; prefer bounded Product deactivation/withdrawal if financial FKs require retention. No broad deletion or cleanup now |
| Order/Payment/Attempt/events | Retain financial audit history; never delete to manufacture clean results. Existing retention policy must be named/approved by owner |
| Stripe financial objects | Preserve identities and readback; no cancellation/refund/delete without new explicit authority |
| Work/leases | Preserve durable jobs; no global clearing or historical processing. Unknown lease/commit requires read-only reconciliation and separately reviewed replacement |
| Browser/session artifacts | Only owned context closes; clear owned transient session only when approved; no HAR/trace/DOM/network-body capture containing secrets/PII/card data; mask hosted iframes if screenshots later approved |
| Service processes | Stop only spawned and positively verified owned handles; do not kill port occupants. Preserve primary failure plus separate teardown failures; no restart after financial uncertainty except specifically approved readback recovery |

## Owner approval matrix

**Every permission below is NOT APPROVED.** Status describes the missing decision/prerequisite, not delegated authority. Prior local source/testing permission does not authorize these live actions.

| Item | Status | Exact required action |
|---|---|---|
| A DEV/account | PENDING | Explicitly approve exact DEV/ref/region and canonical TEST account/source hash |
| B Tenant capacity/reserves | BLOCKED | Supply operator export and approve matching client/session/PG reserves |
| C Historical accounting | BLOCKED | Supply receipts or explicit documented disposition of irreducible uncertainty; do not treat unknown allowance as unused |
| D Independent budget | PENDING | Approve separate run ID/ledger and 1/1/1 ≤1349 cents, approval reference and submission receipt capture |
| E Fixture creation/visibility | PENDING | Approve CUSTOMER/Cart/Product/category IDs, temporary purchasable visibility and bounded allowed record set |
| F Service startup/ownership | BLOCKED | Approve exact identities only after actual guarded hosted entry is independently demonstrated; never ordinary unguarded supervisor |
| G Scoped replacement worker | PENDING | Approve exact new Attempt/Work/run/owner/token, bounded original/replacement and post-capture response-loss scenario; no historical worker |
| H Historical exclusion | PENDING | Approve exact allowlist and fresh before/after readbacks of eight historical jobs; no processing permission |
| I SLO thresholds | PENDING | Approve/revise six targets, boundaries, one-run sample and failure handling |
| J Incident policy | PENDING | Approve STOP/read-only reconciliation policy and named decision owner |
| K Cleanup/retention | PENDING | Approve exact permitted nonfinancial restoration and retention policy; financial cleanup remains separately forbidden |
| L Hosted guard validation | BLOCKED | Authorize nonfinancial owned-service/browser validation only after capacity/source gates; independently prove actual route/adapter coverage before financial permission |
| M One Intent creation | PENDING | Explicit provider operation permission, reserved before automatic Checkout setup |
| N One authorization | PENDING | Explicit one hosted submission permission; no retry after uncertainty |
| O One capture ≤13.49 | PENDING | Explicit exact lease-bound capture and response-loss/replacement readback permission; no second capture |
| P Final reviewer | PENDING | Name independent Principal Architect/acceptance reviewer and evidence sign-off requirements |

## Go/no-go and sign-off

Current **NO-GO**: ledger INCOMPLETE, headroom UNKNOWN, hosted composition/bypass coverage unverified, services/fixtures/budget/SLOs/incident/cleanup NOT APPROVED. Offline PASS does not waive any gate. The current execute barrier must not be bypassed or converted to an approval-flag shortcut.

Only after explicit approvals and every prerequisite is independently verified may the owner authorize a future bounded run. Proposed sequence: rehash → validate capacity/reserve/accounting disposition and new budget → bind exact immutable fixture/service/ledger scope → independently verify guarded nonfinancial startup/browser/listener → at most one approved purchase → observe requires_capture and atomic effects → exact lease-bound post-success response loss → STOP new sends → approved scoped readback/replacement → verify PAID/DONE/one Charge/one Order/one Payment/stock8/7/Cart removal/signed event persistence → retain actual timings and reconcile ledger → independent review. This is not an executable command and no step was performed here.

Owner approval reference/signature/date: **NOT APPROVED — blank**.
Supabase operator export/reserve reference/signature/date: **NOT PROVIDED — blank**.
Stripe accounting disposition/export reference/signature/date: **NOT PROVIDED — blank**.
Runtime nonfinancial preflight authorization/reference: **NOT APPROVED — blank**.
Final independent reviewer/signature/date: **NOT APPROVED — blank**.
Financial execution authorization (separate, exact run/budget): **NOT APPROVED — blank**.

First-time out-of-order webhook delivery, competing workers, 3DS/decline, refund/compensation, multiple-purchase concurrency and production deployment/performance remain separate scenarios; one future purchase cannot certify them. **Merge NO. Score 95/100 provisional, not independent approval.**

## Reproducible offline verification

- Backend cwd: `node --test --test-concurrency=1 scripts/acceptance-budget.test.cjs scripts/acceptance-installation.test.cjs scripts/acceptance-launcher.test.cjs scripts/acceptance-lifecycle.test.cjs scripts/guarded-acceptance.test.cjs scripts/real-capture-response-loss.test.cjs scripts/operational-acceptance-preflight.test.cjs scripts/stripe-gate-safety.test.cjs` — **100/0/0**, ignored receipt `.cache/prompt3-harness.tap`.
- Backend cwd: `npx vitest run src/services/__tests__/payment.service.test.ts src/services/__tests__/payment.lock-order.test.ts src/services/__tests__/payment.retry.test.ts src/routes/stripe-webhook.routes.test.ts` — **128/0/0**, ignored receipt `.cache/prompt3-backend.log`.
- Frontend cwd: `npx vitest run src/features/checkout/StripePaymentSession.test.tsx src/features/checkout/PaymentRecovery.test.tsx src/features/checkout/paymentTiming.test.ts` — **25/0/0**. Provider/transaction/browser doubles only; seven retained lock-order design-specimen checks are not PostgreSQL proof.
- Actual compiled pricing function read, source hash, read-only process/port metadata and installed executable existence checked. No env values, provider calls, database connections, hosted browser/service startup or CI dispatch in this prompt. No build/typecheck rerun needed for documentation-only change.
- Final `git diff --check` PASS under repository configuration (existing line-ending warnings retained in ignored `.cache/prompt3-diff-check.log`); appended/new documentation whitespace and credential scan PASS, zero credential patterns. Seven document checks PASS: sixteen decisions, no granted permission, source binding, bounded canonical append, whitespace, credentials and explicit NO-GO. An initial nonstandard `core.autocrlf=false` override incorrectly treated existing CRLF as trailing whitespace (exit 2); removed the override and reran the normal check without modifying files or repository settings.
