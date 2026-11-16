# Task 03.6 — Real Payment & PostgreSQL Acceptance (first real execution)

Executed 2026-10-15 19:10Z → 2026-10-16 09:20Z by Claude Code under Master Task 03.6 + Addendum ("eliminate disposable PostgreSQL blockers").
Scope: disposable PostgreSQL 17 + Stripe **Test Mode** only. Nothing was staged, committed, pushed, merged or deployed. Shared DEV/PROD,
the installed PostgreSQL 18 service (:5432) and the user's backend (:5000) were never touched. **Task 03.6 remains OPEN** pending
Principal Architect review. Earlier Task 03.6 evidence documents are preserved unchanged; this document adds to them.

Evidence root: `docs/tasks/Phase-03/evidence/real-acceptance-20261015/` (all paths below are relative to it). Evidence categories follow
the directive: **B** real backend + disposable PG, **C** real PG concurrency, **D** real Stripe Test Mode, **E** signed webhook + durable
worker, **F** real Chromium + real frontend/backend/PG/Stripe (no route interception, no Stripe.js stub). Category A (intercepted) results
are not reused here.

## 1. Executive summary

| Area | Result |
|---|---|
| Disposable PG17 (TLS, per-run CA) + migration replay of all **18** repository migrations | **PASS** |
| A–J real-PostgreSQL concurrency suite | **PASS** — 10/10 in **7 consecutive guarded runs** (runs 4–9 + final-source run); runs 1–3 failed and led to 2 source fixes + test-harness fixes |
| Real Stripe Test Mode suite (26 cases, disposable DB) | **PASS** — 26/26 (run 4 and final-source run); runs 1–3 failed (test-contract drift, see §11) |
| Signed CLI webhooks, tamper rejection, replay/out-of-order, worker down → restart recovery, lost responses | **PASS** |
| Decline → retry on same attempt/intent; delivery-terms refusal; resume concurrency across 2 instances; lease precedence; cross-customer isolation | **PASS** (live `40001` retry branch on resume not observed — §6) |
| Real Chromium Scenarios 1–6, notifications, Cart badge, responsive 390→1440 | **PASS** except **D-4** (open, needs decision) and the UX findings in §13 |
| Source defects found by real execution | **3 fixed** (D-1, D-2, D-3) with regression tests; **2 open** needing an owner decision (D-4 navigation contract, D-5 AUTH refresh rotation) |
| Typecheck / lint / focused regression tests | **PASS** (§12) |

**Recommendation to the Principal Architect:** the payment core is behaving correctly on real PostgreSQL and real Stripe Test Mode for every
financial invariant tested. Do **not** close Task 03.6 yet: decide D-4 and D-5 (§11), confirm the contract questions in §13, and review the
three source fixes. A–S (K–S), DEV/PROD migration parity and release authorization remain separate gates and were **not** executed.

## 2. Verified disposable environment

| Item | Value |
|---|---|
| Engine | PostgreSQL **17.10** (x86_64-windows), npm `@embedded-postgres/windows-x64@17.10.0-beta.17`, tarball sha512 verified against the npm registry integrity (`q6xIETTkv67i…`) |
| Why not Docker / PG18 | Docker/Podman absent; the installed PG18 service is not a valid target (and the harness rejects it by design). A **separate** PG17 cluster was created with `initdb` |
| Listener | `127.0.0.1:55432` only; `pg_hba.conf` = `hostssl all postgres 127.0.0.1/32 scram-sha-256` (no plaintext, no other hosts) |
| TLS | Per-run CA `CN=electrohub-ci-ca`, valid 2026-10-15 19:10Z → 2026-10-16 19:10Z (24 h), SHA-256 `E5:ED:26:AC:…:A5:7E`; server cert `CN=localhost`, SAN `DNS:localhost, IP:127.0.0.1`; `openssl verify` OK; sessions TLSv1.3 |
| Negative TLS proof | plaintext → `28000` (no pg_hba entry); client without the per-run CA → `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (`tls-negative.txt`) |
| Database / roles | `electrohub_ci` only (plus `postgres`/templates); single role `postgres` (`target-identity*.json`) |
| Session TimeZone | `Asia/Beirut` (UTC+3) — deliberately **not** UTC; this exposed D-2 |
| Guards | `payment-pg-disposable.cjs` proof (loopback, CA, PG17, TLS active, dedicated/empty, marker schema) passed before every run |
| Instances | #1 (PID 216984, data in session scratchpad) and #2 (PID 221992 → 229640, `%TEMP%`) self-terminated because empty directories / `share/` were pruned by the workstation's temp cleanup; #3 (PID 9228) in `%USERPROFILE%\.electrohub-disposable-pg-cc54a91c` ran the final-source suites. Only owned PIDs were stopped |

Integrated stack (category F/E): backend `:5100` (+ second instance `:5101` for cross-instance tests) and a separate durable worker, both from a
fresh `dist` build; Vite frontend `:5180` proxying `/api` → `:5100`; `stripe listen` forwarding to `:5100/api/webhooks/stripe`. Explicit
`DATABASE_URL/DIRECT_URL` (process env wins over env files — verified in `src/config/env.ts`), fresh random JWT/OTP secrets, Brevo/Google/
storage credentials blanked, logs isolated via `ELECTROHUB_LOG_DIR`.

## 3. Stripe Test Mode validation (`stripe-identity.json`)

- Secret and publishable keys are both Test Mode and bound to the **same** account `acct_1UEZW5KiVgdl63pN` (US, USD): a PaymentMethod created
  with the publishable key was retrieved with the secret key.
- **Contradiction found:** the Stripe CLI's stored login is account `acct_1UEZV83TuYNdQJpp` (different). Plain `stripe listen` would forward
  the wrong account's events. The listener was run with `STRIPE_API_KEY` = the application's Test Mode key (no CLI config change).
- The `STRIPE_WEBHOOK_SECRET` in `apps/backend/.env` does **not** match the listener secret for the application account; the isolated
  stack used the listener's secret in memory only. Owner action: re-login the CLI to the app account (or keep using `STRIPE_API_KEY`) and
  refresh the local `.env` webhook secret.
- All objects: `livemode=false`, manual capture, USD, metadata `attemptId`. No live key was present anywhere (runner scans env files).

## 4. Prisma migration replay (`migration-ledger.txt`)

`prisma migrate deploy` with strict native TLS replayed **18** migrations (2024-01-01 foundation → `20261015000000_payment_attempt_dismissed_at`),
all finished, none rolled back; 29 tables; `payment_attempts.dismissedAt` nullable `timestamp`. `dismissedAt` is part of the current source
chain and required by the generated client, so it was included. No historical migration or checksum was modified. This is disposable-replay
evidence only, **not** DEV/PROD parity.

## 5. A–J real-PostgreSQL concurrency

Runner: `node scripts/payment-pg-disposable.cjs --run --scope=scenarios-A-J` with its own exact authorization
`DISPOSABLE:electrohub_ci:scenarios-A-J:fixtures+drop-run-schema` (new scope; the A–S string was not used and still only starts A–S).
Each run: target proof → marked run schema → strict-TLS engine probe → migrate → tests → marker-verified `DROP SCHEMA`.

| Run | Time (UTC) | Result | Notes |
|---|---|---|---|
| 1–2 | 19:12–19:14 | FAIL (0/10) | harness isolation probe: `name` columns not deserializable; `42P01` not surfaced by adapter-pg |
| 3 | 19:25 | FAIL 8/10 | D-1 (C/D/E/H/I flaky), H webhook body bug, SQLSTATE extraction |
| 4–6 | 19:30–19:31 | **PASS 10/10 ×3** | after D-1, D-2 and harness fixes (`aj-runs-4-6.log`) |
| 7–9 | 19:33–19:34 | **PASS 10/10 ×3** | fresh cluster #2 (`aj-runs-7-9.log`) |
| final | 2026-10-16 09:14 | **PASS 10/10** | final source incl. D-3 (`aj-final.log`) |

| ID | Property exercised (real PG, real services) | Result |
|---|---|---|
| A | two concurrent `submit` → one Cart-generation transfer | PASS |
| B | `submit` racing `CartService.add` → commits first or rolls back cleanly | PASS |
| C | A processing while B added and set up → A's order only A, one capture | PASS |
| D | same SKU added after submit → new line identity, stock 48 | PASS |
| E | `commitAuthorized` with lease token leaves Cart B byte-equal | PASS |
| F | trigger `P0001` mid-transfer → full rollback | PASS |
| G | stale worker lease → no order, no capture | PASS |
| H | duplicate signed webhook + duplicate processor → 1 order/payment/capture/stock decrement | PASS |
| I | `23505` / `23514` ownership constraints | PASS |
| J | Serializable write skew → exactly one aborted, one write survives | PASS |

Server-side SQLSTATE evidence (PG log, runs 4–6): `40001` ×6, `P0001` ×3, `23514` ×3 (`submitted_purchase_releases_active_cart`),
`23505` ×3 (`payment_attempt_items_sourceCartItemId_key`). Note: Prisma 6 adapter-pg reports `40001` as `P2034` and `23505` as
"Unique constraint failed" (code `N/A`); J now asserts the production classifier `isSerializationConflict` plus `P2034`.

## 6. Stripe Test Mode results

**Suite** (`payment.stripe.live.test.ts`, 26 cases, disposable DB, allowance 100 000 cents): run 1 0/26 (fixture), run 2 6/26, run 3 18/26,
run 4 **26/26**, final-source **26/26** (`stripe-live-final-report.json`). Covers authorization+capture with multi-item snapshots, duplicate/
concurrent submit, unknown capture reconciled without recapture, compensation once, last unit with two customers, overlapping keys, lost
create reply, decline + 3DS, unknown refund identity across restart, partial compensation with overlapping workers, expired worker after
capture, Cart mutation before the final action, browser abandonment completed by a fresh runner, lost cancel reply, second-item failure
rollback, expired intent cancel, DB CHECK/UNIQUE bindings, authoritative price/product/category changes, double-binding refusal,
acknowledgement failures at binding/capture/cancel, real pending refund across restarts (Stripe `pm_card_pendingRefund` settled after 142 s).
Final audit (`stripe-audit-final.json`): 29 intents, 14 succeeded each with its refund, 15 canceled, 0 live.

**API-level real flows** (`api-acceptance.jsonl`, category D/E/B):

| Flow | Evidence |
|---|---|
| Success purely via webhook + worker (client never reconciles) | `PAID` in 3.1 s, order CONFIRMED/payment SUCCEEDED, stock 30→29, PI captured $49.99 manual USD |
| Decline → retry | real `card_declined` → `DECLINED` via signed `payment_failed`; `resume` 200 returns **same** attempt and a client secret of the **same** intent; retry → `PAID`; still 1 attempt, 1 intent, stock −2, 1 capture |
| Delivery-terms rejection | outdated saved delivery method → two concurrent retries `409 CHECKOUT_CHANGED`, `expiresAt` unchanged, provider untouched ($0). (A variant that also changed `amountCents` was refused earlier by `PAYMENT_AMOUNT_MISMATCH`) |
| Resume concurrency, 2 instances | 6 simultaneous resumes (3 on :5100, 3 on :5101) all 200, same attempt + intent, one lifetime extension, no new attempt; elapsed 3.7 s. No `40001` occurred on this path, so the bounded-retry branch was **not** exercised live (unit-tested only) |
| Recovery-lease precedence | unexpired lease → `409 PAYMENT_RECOVERY_PENDING` on both instances, `expiresAt` unchanged |
| Cross-customer isolation | another customer: read/resume/reconcile → `404`, no intent id leaked |
| Lost responses | submit and reconcile replies dropped client-side (5 ms abort): submit still committed; mid-state `AWAITING_INPUT` (never Paid/Failed); durable path → `PAID`, 1 intent, 1 capture |

## 7. Signed webhook and durable worker (category E)

- Listener: `stripe listen --forward-to http://localhost:5100/api/webhooks/stripe` (9 subscribed event types). Every delivery `[200]`.
- Tampered/missing/garbage/wrong-secret signatures → 4 × `400 WEBHOOK_INVALID_SIGNATURE`, `stripe_events` rows unchanged.
- `stripe events resend` of `payment_intent.succeeded` then the **older** `amount_capturable_updated` (reverse order) → `200`, still exactly
  one row per event id, state stays `PAID`, 1 order, no second capture, stock unchanged — provider truth wins over arrival order.
- Worker stopped: a confirmed authorization's webhook was persisted `ACCEPTED`, work `READY`, **no** order/stock effect for 15 s; worker
  restarted → `PAID` in 3.2 s, single capture.
- Live suite covers lease expiry, fresh-runner restarts (spawned `dist/payment-runner.js`), stale workers fenced, refund identity reuse.

## 8. Real Chromium Scenarios 1–6 (category F)

Spec: `apps/frontend/tests/checkout/real-stack.acceptance.spec.ts`, config `playwright.real-stack.config.ts`. No `page.route`, real Stripe.js
and Payment Element (iframes from `js.stripe.com`), official test cards (`4242…`, `4000 0000 0000 0002`, 3DS `4000 0027 6000 3184`).
Final clean round (`real-stack/run*.log`, fresh customers per round): S1a, S1b/S2/S3, S1c, S4, S5, S6, N1, R1, S4b **passed**; S6r failed
as annotated (D-4). Screenshots in `real-stack/`.

| Scenario | Result | Key evidence |
|---|---|---|
| 1 Processing & recovery | **PASS** | "Processing your order…" then backend-backed "Order Confirmed!" (A×2 $99.98, visa 4242). With an unanswered real 3DS challenge, A stays unresolved; Cart shows **Pending purchases** (`AWAITING_CUSTOMER_ACTION`), no Continue Payment; badge = server `totalQuantity` 0 |
| 1 return to A | **PARTIAL** | Re-entering `/checkout` never offers Place Order / a second setup. View depends on timing: "Payment needs a different card" once the server knows `ACTION_REQUIRED`, but "Your cart is empty" if reloaded before. Pending card has no link back to A (§13) |
| 2 Pending A, Cart B | **PASS** | B active, badge "1 item", Checkout B shipping fields empty, B total $19.99 (A excluded), separate setup |
| 3 Late success on Checkout B | **PASS** | A completed at the provider (same intent) → exactly **one** success toast; B stays on `?step=payment`, Review Order + Payment Element mounted, badge 1, toast auto-dismissed after **5.1 s**; Orders lists A |
| 4 Decline & retry | **PASS** | Real decline → "Payment Failed" → Cart "Failed payments" → Try Again → isolated Payment step (saved item, $9.99) → `PAID`; same attempt **and** intent; **0** new setups, **0** new submits |
| 4 delivery snapshot | **PASS** | browser retry → `409 CHECKOUT_CHANGED` → "This purchase can't be paid again right now", no card entry, lifetime unchanged, $0 |
| 5 Unknown/delayed | **PASS** | Browser taken offline at the network layer right after Stripe accepted confirmation: "We couldn't confirm your payment yet", no failure screen, no resubmission, no toast from network errors; worker reached `PAID` while offline; after refresh the success toast discovered the result (390 px) |
| 6 Buy Now isolation | **PASS** (full-navigation leave) / **FAIL D-4** (in-app leave during open 3DS) | With full navigation: one toast, B's URL/step/total/badge/Cart rows unchanged. With in-app navigation while A's 3DS modal is open: modal persists over Checkout B (§11 D-4) |

## 9. Real-backend payment notifications (N1)

PAID + DECLINED created through the real stack → exactly 2 toasts on Home (success / "Payment was not completed…"); auto-dismiss sent
exactly one `/read` per purchase and server read-state = outcome; reload and Products/Orders/Cart/Home → 0 replays; two visible tabs + a new
PAID → presented once in total (`[1,0]`, Web Locks); Close → `/read 204`; a real pending-3DS purchase never notified. Checkout's own result
screens acknowledge only their attempt (S3: A's toast appeared on Checkout B). **NOT VERIFIED:** hidden-tab behavior (cannot background a
tab in Playwright without mocking `visibilityState`). Earlier runs showed a second browser-side `/read` that was aborted before reaching the
server (server logs: one acknowledgement per outcome); no duplicate persisted.

## 10. Cart ownership and badge

Badge always equals the authoritative server Cart (R1: 6 viewports, badge = server quantity; S1b: 0 = 0; S2: 1 = 1). Measured precisely,
the badge drops to "0 items" **412 ms** after the `/submit` response while Processing is still shown (an earlier stale "1/2" reading was a
pre-submit sample, not a defect). Saved purchases never inflate the count; submitted A never reappears in Cart; Cart B unchanged through A's
lifecycle (DB rows compared). Integrated-stack invariants (`stack-invariants.json`): 30 PAID ↔ 30 orders ↔ 30 succeeded intents; 0
duplicate orders, 0 multi-payment orders, 0 duplicate events, 0 negative stock, 0 submitted attempts holding a Cart; stock conserved exactly
(A 10+20, B 24+6, C 24+6 = 30 each). Account switching: cross-customer API isolation verified (§6); a UI account-switch run was not executed.

## 11. Defects and corrections

| ID | Defect (real evidence) | Fix | Regression |
|---|---|---|---|
| **D-1** fixed | New `payment_work.nextRunAt` came from the column default (DB/engine clock, ms-rounded) while the claim compares with the app clock: claim `14.706Z` vs `nextRunAt 14.707Z` → inline setup claim skipped, attempt stuck `PREPARING` (A–J C/D/E/H/I flaky). Any host clock skew widens it | `payment.service.ts`: `work: { create: { nextRunAt: new Date() } }` | `payment.retry.test.ts` "new PaymentWork is due on the application clock…" (fails pre-fix) + A–J 7/7 |
| **D-2** fixed | Webhook ingestion wrote `CURRENT_TIMESTAMP` into `timestamp without time zone` columns → follows session TimeZone; with a UTC+3 session work was scheduled **3 h** ahead and the worker could not claim it (A–J H hang). Latent on Supabase (UTC sessions) | `stripe-webhook.routes.ts`: one app-clock `receivedAt` for `stripe_events.createdAt`, `payment_work.nextRunAt/updatedAt` | `stripe-webhook.routes.test.ts` "timestamps … on the application clock" (fails pre-fix) |
| **D-3** fixed | Setup's "release stale card entry" path re-armed only `DONE` work; the worker reschedules abandoned `AWAITING_INPUT` work +10 s each pass, so the claim was a silent no-op → new checkout blocked with `409 PAYMENT_RECOVERY_PENDING` ("An existing payment is unresolved") most of the time | `payment.service.ts`: re-arm `DONE` **or `READY`** (never `LEASED`; retry accounting untouched) | `payment.retry.test.ts` "abandoned card entry whose READY work is scheduled in the future…" (fails pre-fix) + R1 real re-entry |
| **D-4** open | Leaving Checkout by in-app navigation while Stripe's 3DS modal is open: the modal (owned by the pending `confirmPayment`) survives and overlays Checkout B, hiding the late-result toast and B's controls (reproduced 3×; S6r) | Not fixed: `PaymentLockProvider` deliberately never locks navigation ("Navigation never cancels or locks that work"). **Decision needed:** lock in-app navigation only while a Stripe next-action is open, or accept | `S6r` (`test.fail`, known defect) |
| **D-5** open (AUTH) | Refresh-token rotation: if a rotating `/auth/refresh` response is aborted (fast reload/navigation) the browser keeps the old token; grace-window refreshes return no cookie; the next refresh outside 10 s triggers `AUTH_REFRESH_TOKEN_REUSE_DETECTED` → all sessions revoked → signed out. Dev pages issue two refreshes per load | Not fixed (AUTH protected files). **Decision needed** from AUTH + Architect (e.g. idempotent rotation response, or successor re-issue within grace) | Server log evidence (`msSinceRevocation: 17860`) |

Test/harness corrections (no production effect): A–J SQLSTATE extraction for adapter-pg; isolation probe (`::text` casts, catalog-based
absence check); webhook test body sent as string (supertest JSON-serialized a Buffer, 1179 bytes → signature mismatch); live suite fixtures
`isTestFixture:false, storefrontVisible:false` per `STOREFRONT_FIXTURE_VISIBILITY.md`; live `reconcile()` helper awaits the durable pass
started by the request (async reconcile contract) using a single shared wrapper; expectations aligned to the current submitted-purchase
contract (§13); pending-refund observation window extended; runner: new A–J scope, report kept on failure.

## 12. Verification commands (all run here)

| Command | Result |
|---|---|
| `node scripts/payment-pg-disposable.cjs --run --scope=scenarios-A-J` | 10/10 ×7 (§5) |
| `node scripts/payment-stripe-disposable.cjs --run` | 26/26 ×2 (§6) |
| `npx playwright test -c playwright.real-stack.config.ts` (rounds 2–4) | 9 passed + S6r expected failure |
| `node --test scripts/payment-pg-disposable.test.cjs scripts/payment-stripe-disposable.test.cjs` | 32/32 |
| `npx vitest run src/routes/stripe-webhook.routes.test.ts src/services/__tests__/payment.retry.test.ts src/services/__tests__/payment.service.test.ts` | 145/145 |
| `npx vitest run src` (DATABASE_URL forced to a non-existent disposable DB, Stripe key blanked) | 660 passed, 63 skipped, 3 env-induced failures (OTP + Cart-quantity DB integration tests need a DB; two payment tests need a Stripe key — pass with repo env: 86/86) |
| `npx tsc --noEmit` (backend), `npm run lint` (backend), frontend `tsc --noEmit`, ESLint on new spec/config | all clean |

**NOT RUN:** `apps/backend/tests/**` DB-backed suites — they load `.env` (shared DEV) and were not pointed at DEV; GitHub Actions CI;
frontend unit suite (frontend source unchanged).

Performance: no PG statement > 2 s; no pool errors, crashes or 5xx. Slowest payment setup 6.05 s of which `stripe.create` 5.65 s (DB
transaction 253 ms); median setup 569 ms; login up to 6.5 s under parallel load (bcrypt CPU); 6 concurrent resumes 3.7 s.

## 13. Remaining risks, contract questions and incomplete gates

1. **D-4, D-5** (above) — owner decisions.
2. **Price change after authorization of a submitted purchase is honored** (`PAID` at the saved $1.00; product/category changes still cancel). `OrderService` validates saved `unitPrice` for submitted purchases. Please confirm this is the intended contract.
3. **Submitted purchases never merge back into Cart on compensation** (remainder recorded). `PAYMENT_CORE_03.6.md` still says compensation "merges purchased intent with newer Cart quantities" — documentation contradiction; source + readiness doc say never merge.
4. Re-entering `/checkout` during an unresolved purchase: timing-dependent view; `ACTION_REQUIRED` shown as "Payment needs a different card" (authentication would be more accurate); pending card offers no link to A.
5. Worker re-polls each abandoned unsubmitted card entry every ~10 s (one Stripe retrieve per pass) for its 30-min lifetime — load/rate-limit consideration.
6. After compensation the projected `providerStatus` stays `requires_capture` although the intent is canceled (display only).
7. Stripe Test-Mode developer badge overlaps the toast at 1366 px (test mode only).
8. Concurrent edits by another workstream during this run (`cart.service.ts`, new `cart.service.baseline.ts`, `cart.add-*` tests, `CartProvider.tsx` 20:52). Builds were refreshed before each suite; final fingerprints in `source-fingerprint-final.txt`.
9. Not covered: hidden-tab notifications; live `40001` on resume; Supavisor/hosted pooler behavior; UI account switching; A–S (K–S, not authorized); DEV/PROD parity; CI.
10. Shared Stripe test account: a foreign `requires_capture` $1,499.00 intent (`pi_3UQuqs…`, 20:02Z) belongs to other activity and was left untouched; 30 succeeded Test-Mode captures from the integrated stack were kept as evidence (21 open intents of mine canceled).

## 14. Reproduction

1. PG17 cluster: `initdb -U postgres --auth=scram-sha-256`; TLS with a per-run CA (`openssl req -x509 … -subj /CN=electrohub-ci-ca -days 1`), server cert SAN `localhost,127.0.0.1`; `listen_addresses=127.0.0.1`, `port=55432`, `ssl=on`; `pg_hba`: `hostssl all postgres 127.0.0.1/32 scram-sha-256`; `CREATE DATABASE electrohub_ci`. Keep the cluster **outside** `%TEMP%`.
2. A–J: `PAYMENT_PG_DISPOSABLE_APPROVED=true PAYMENT_PG_DISPOSABLE_URL=postgresql://postgres:<pw>@localhost:55432/electrohub_ci PAYMENT_PG_DISPOSABLE_CA_FILE=<abs ca.crt> PAYMENT_PG_DISPOSABLE_AUTHORIZATION=DISPOSABLE:electrohub_ci:scenarios-A-J:fixtures+drop-run-schema node scripts/payment-pg-disposable.cjs --run --scope=scenarios-A-J`.
3. Stripe suite (fresh database): Mode C variables per `TASK_03.6_UNIFIED_ACCEPTANCE_READINESS.md` §12 with the PG authorization `…:stripe-live-suite:disposable-fixtures-owned-ids`, then `npm run build && node scripts/payment-stripe-disposable.cjs --run`.
4. Real stack: backend `PORT=5100` and worker (`node dist/bootstrap.js [--payment-worker]`) with explicit disposable `DATABASE_URL/DIRECT_URL`, `DB_SSL_CA_CERT_PATH`, fresh secrets, blank Brevo/Google; `STRIPE_API_KEY=<app test key> stripe listen --forward-to http://localhost:5100/api/webhooks/stripe` and its secret as `STRIPE_WEBHOOK_SECRET`; `E2E_FRONTEND_PORT=5180 E2E_API_PROXY_TARGET=http://localhost:5100 npx vite`; seed disposable products/customers; `REAL_STACK_FIXTURES=… REAL_STACK_STRIPE_TEST_KEY=… REAL_STACK_DB_TOOL=… REAL_STACK_OUTCOME_TOOL=… npx playwright test -c playwright.real-stack.config.ts`. The operator tools used here (DB read/fixture tool, outcome generator, API driver) are recorded in the evidence logs; they are not part of the repository.

## 15. Cleanup record

Owned and removed after evidence collection: PG17 instance PID 9228 (stopped via `pg_ctl -m fast`), its folder
`%USERPROFILE%\.electrohub-disposable-pg-cc54a91c` (binaries, data, per-run CA/keys, password), the `%TEMP%` instances
`eh-pg17-disposable-cc54a91c` / `eh-pg17-bin-cc54a91c`, stack processes (backends :5100/:5101, worker, Vite :5180, Stripe listener — all
stopped earlier and ports verified free). Stripe Test Mode objects: suite intents self-cleaned (refund/cancel); stack intents reconciled
(§13.10). The installed PG18 service and the user's :5000 backend were never stopped or modified.
