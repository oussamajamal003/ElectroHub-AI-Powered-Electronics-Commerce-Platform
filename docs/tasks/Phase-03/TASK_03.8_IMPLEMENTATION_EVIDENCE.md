# Task 03.8 — Implementation Evidence

**Branch:** `feature/Email-Notifications` · **Base:** `7d29774c8125a10a883894bca2f583c753c2b7ee` (= `origin/develop` at start) · **Date:** 2026-10-18
**Status:** implementation-complete, ready for independent architect review. Changes are uncommitted and unstaged in the working tree (owner instruction); not pushed, not merged, not deployed. The self-review score below is not an approval.

## 1. Summary

The implementation adds a transactional commerce email outbox (ADR-009) with seven versioned HTML/plain-text templates, a leased worker,
truthful customer notices, and a read-only purchases GET. The forward-only migration `20261018000000_commerce_email_outbox` was applied to DEV
and PROD, and both were verified by physical readback. A live DEV Brevo gate passed G01–G12 (G05 confirmed by the owner's mailbox check).

| Area | Files |
| --- | --- |
| Schema / migration | `prisma/schema.prisma` (+108 lines, additive), `prisma/migrations/20261018000000_commerce_email_outbox/migration.sql` |
| Domain / config | `src/services/commerce-email.domain.ts`, `commerce-email.config.ts` |
| Producer (in-transaction) | `src/services/commerce-email.producer.ts`; hooks in `payment.service.ts` `markPaid` / `compensate` |
| Dispatcher / worker | `src/services/commerce-email.dispatcher.ts`, `src/commerce-email-runner.ts`, `bootstrap.ts --commerce-email-worker`, `npm run email:worker` |
| Brevo (additive) | `integrations/brevo/brevo.{types,client,provider}.ts`: structured `failure` (category, httpStatus, providerCode, retryAfterMs) |
| Templates | `src/emails/commerce/{escape,format,layout,templates,fixtures}.ts` |
| Reads / GET fix | `order.service.ts` (`emailConfirmation` on details/confirmation only); `PaymentService.purchases` read-only; new `recoverOverdue` + `POST /api/checkout/payment-attempts/recover-overdue`; frontend `requestOverdueRecovery` |
| Frontend | `features/orders/CommerceEmailNotice.{tsx,module.scss,stories.tsx,test.tsx}`; placement in `CheckoutComponents.tsx` and `OrderDetailsPage.tsx`; `checkout/types.ts` |
| Verification tooling | `scripts/commerce-email-pg.cjs` (+ `vitest.commerce-email-pg.config.mts`), `scripts/commerce-email-migration.cjs`, `scripts/commerce-email-dev-gate.ts`, `scripts/render-commerce-email-previews.ts`, `tests/orders/commerce-email.spec.ts` |
| Docs | ADR-009, `docs/10_Operations/COMMERCE_EMAIL_RUNBOOK.md`, `.env.example`, task spec corrections (§6.2/6.3, execution boundary) |

## 2. Key decisions

- **Events:** `order:<id>:confirmed`, `payment:<id>:succeeded`, `order:<id>:transition:<uuid>`, `payment:<id>:refund:<refundId>`.
  Inserts use `ON CONFLICT DO NOTHING` inside the existing fenced transaction. A replay verifies the existing row's identity, and its first
  snapshot stands. `markPaid` now keeps the first `paidAt` on replay.
- **Cancellation/refund:** emitted from the `compensate` transaction only. `ORDER_CANCELLED` carries `paymentConfirmed` and includes `refund`
  only when that same transaction recorded a verified refund (`PAYMENT_REFUNDED` uses the verified `refundAmountCents`). A failed refund emits nothing.
- **Fulfillment:** `transitionFulfillment(tx, …)` is the producer contract for the future 05.4 writer. No route exposes it, and no live fulfillment producer exists yet.
- **Suppression correction:** a missing or unusable recipient (or invalid facts) produces a SUPPRESSED row with a NULL recipient, a minimal snapshot and a reason.
  The payment still commits. A trigger makes SUPPRESSED, ACCEPTED and FAILED terminal and makes identity/payload immutable; a purge is one-way.
- **Dispatcher:** claims with `FOR UPDATE SKIP LOCKED` on database UTC time, journals STARTED before any send, and acknowledges only under its current,
  unexpired token. An expired lease with no attempt returns to READY; with a STARTED attempt it becomes UNCERTAIN, never resent automatically.
  401/403/configuration errors pause sending for 5 minutes. Retries: 5 attempts on a 30s/2m/10m/30m ladder with ±10% jitter and a Retry-After floor of at most 1h, within 24h.
  `deliveryState` stays UNKNOWN (webhooks deferred), so "Sent" means provider acceptance.
- **GET fix:** `GET /api/checkout/payment-attempts` never calls `process()`. Liveness comes from the runners plus the explicit, throttled
  `POST …/recover-overdue`, which keeps identical semantics (due-only, lease-claimed, ≤5, owner-scoped, no wake).
- **Safety switches:** enqueue, dispatch and send mode are all off by default. Capture mode is disposable-only, allowlist mode claims only listed recipients,
  and live mode on a shared DB needs the exact approved identity.

## 3. Verification (commands actually run)

| Check | Command (cwd) | Result |
| --- | --- | --- |
| Real PostgreSQL (DB01–DB10, T01–T25 backend) | `node scripts/commerce-email-pg.cjs` (backend): fresh PG 18 with TLS, session timezone Asia/Seoul, all 20 migrations via `prisma migrate deploy` | **23/23 passed** |
| Backend unit (affected) | `npx vitest run` payment.service/retry/purchase-ownership + brevo | 220/220 after the F-01 fix. An earlier run reported 220/220 while one `recoverOverdue` timing assertion was flaky (failed 2 of 3 reruns); it now brackets the cutoff between before/after clock reads |
| Commerce domain/config | `npx vitest run src/services/__tests__/commerce-email.domain.test.ts` | 27/27 |
| Templates | `npx vitest run src/emails/commerce` | 153/153 |
| Backend typecheck / lint | `npx tsc --noEmit`, `npx eslint src/` | clean |
| Backend full CI selection | `npx vitest run --exclude adminSeedLogin --exclude auth.integration` | 1148 passed, 5 failed, 85 skipped. The failures (`logging-continuity` ×3, `auth.service` refresh ×3) are unrelated to changed code and pass when rerun alone (54/54). The run overlapped other heavy processes, so this is NOT a fully green full run. |
| Frontend unit | `npx vitest run` | 792 total; 1 checkout timing test failed only under the full parallel run and passes alone (2×) and per file (129/129) |
| Frontend typecheck / lint / Storybook | `npx tsc -b`, `npx eslint .`, `npm run build-storybook` | clean / clean / built |
| Playwright (mocked reads) | `npx playwright test -c playwright.orders.config.ts tests/orders/commerce-email.spec.ts` | **16/16** (E01–E12, E14, E16–E18) |

Real PostgreSQL highlights:
- DB01/T02/T21: two exact events with Payment, Order and Attempt.
- T01: AWAITING_CAPTURE produces 0 events.
- DB02/T04/T05: an injected outbox failure rolls finalization back; recovery completes with `captured === 1` and `capture` called once.
- DB03/T03: replayed and concurrent producers insert 0 new rows.
- T09/T10: an inactive account produces SUPPRESSED rows with a NULL recipient; the payment is PAID; the trigger rejects reactivation.
- T06/T07/T08: cancellation and refund semantics.
- DB09/T11/T12: transition identity.
- DB04/T13: two connections claim disjoint rows, with one attempt each.
- DB05/T14 and DB06/T15/T16: lost acknowledgement becomes UNCERTAIN, with one send.
- DB07/T17: a stale worker returns STALE and the state is unchanged.
- DB08: 429 handling, exhaustion at 5, no tight loop.
- 5xx and timeout become UNCERTAIN; 400 becomes FAILED; 401 pauses the worker.
- DB10: every prohibited CHECK combination is rejected and every allowed one accepted; RLS on; `anon`/`authenticated` have no privileges.
- T23/T24/T25 and E19/E20: GET reads are write-free and provider-free; a foreign order gets 404; no fabricated projection; POST recovery still finalizes.

## 4. Visual evidence (captured and opened)

- **App** (`apps/frontend/test-results/commerce-email/`): confirmation and details, DELAYED state, at 390/768/1440/1920px.
  The notice matches the card width (±1px) and sits card → notice → View Order Details → Continue Shopping. On details it sits under the header/badges and above the grid. No horizontal overflow.
- **Email** (local captures of the preview fixtures): 11 templates/variants at 320/390/600px, plus images blocked at 390px.
  - Defects found and fixed: unbreakable names/SKUs overflowed the viewport (fixed with a fixed-layout item table and wrap-anywhere); a 639px stacking rule
    misaligned item borders at 600px (replaced by hiding the thumbnail column below 480px); the CTA padding was not clickable (moved onto the link).
  - Re-captured with no overflow.
- **Not verified:** Gmail/Outlook/Apple Mail client rendering. Browser previews do not prove email-client compatibility.
  When an image fails in Chromium, a broken-image box appears in the thumbnail cell; real images are HTTPS Supabase Storage URLs.

## 5. Database operations (authorized)

The new migration's SHA-256 is `9cf9ad9caca06fcf025ee5fbedc422ea219b2059093d27794f392224c6f5f19e`. All 19 historical migration files are byte-identical to the base.

| Target | Preflight | Deploy | Readback |
| --- | --- | --- | --- |
| DEV `pzxekjybdiulzmssalfo` (ap-northeast-2) | Client TLS verified; 19/19 checksums explained; pending set = exactly the new migration; only the 7 documented historical defaults differ | `prisma migrate deploy`, exit 0 | 20 ledger rows, new row finished with matching checksum, history fingerprint unchanged; `email_deliveries` 175 rows with identical fingerprint; 2 tables with RLS, 14 constraints, 11 indexes, 2 guard triggers, 4 enums; no browser-role privileges; no commerce drift |
| PROD `yepfgjehdstlxbpespun` (ap-northeast-1) | Same gates passed; PROD held 0 users/orders/payments/OTP rows | Owner gave explicit, migration-specific risk acceptance (backup/PITR not verifiable from this session); `prisma migrate deploy`, exit 0 | Same readback as DEV, all passed. No application deploy, no worker, no email |

Evidence JSON (credential-free) is in `apps/backend/.cache/commerce-email-migration/` (gitignored).

## 6. DEV live gate (`scripts/commerce-email-dev-gate.ts`, run `a1d284a8`)

The gate used one disposable account at a plus-alias of the owner-approved mailbox, one hidden product, and one genuine Stripe **Test Mode** purchase
(`pm_card_visa`, $12.34) through the real PaymentService lifecycle. The producer was enabled only in that process. The dispatcher ran in allowlist mode with that single address.
The first run aborted after G02 because the harness's direct replay transaction hit Prisma's 5s default; the resumed run used the same order, made no second purchase, and allowed 30s.

| Gate | Result |
| --- | --- |
| G01 transition creates two distinct events | PASS (attempt PAID, order CONFIRMED, payment SUCCEEDED) |
| G02 stable keys | PASS |
| G03 worker claims only approved work | PASS (claimed exactly 2) |
| G04 Brevo accepts and returns message IDs | PASS (both ACCEPTED, delivery UNKNOWN; message-id hashes `1c682a61…`, `c9b7fcb8…`) |
| G05 two distinct emails in the mailbox | PASS (owner-confirmed 2026-10-18): "Order confirmed — ORD-E48B54D6-0F3F-420E-AC24-744AF1F37B7F" and "Payment confirmed — …" arrived as two separate emails, plus the G11 OTP email. Observed by the owner, not the agent |
| G06 references and amounts match | PASS (12.34 / 12.34, visa ··4242) |
| G07 no other recipient | PASS (2 sends, 1 distinct recipient) |
| G08 ownership and projection | PASS (owner sees `SENT`, a foreign account gets 404, no address in the DTO) |
| G09 duplicate replay | PASS (0 inserted) |
| G10 email does not mutate payment/order | PASS |
| G11 OTP still works | PASS (`sendAccountVerificationOtp` → SENT with a provider ID). The email shows the fixed placeholder `000000`: the harness calls the email service directly, so no OTP challenge exists and the code verifies nothing; real codes come from `crypto.randomInt(100000, 1000000)` |
| G12 attempt facts persisted | PASS (1 ACCEPTED attempt each, no error code) |

The paid DEV order, its Test Mode payment and its outbox rows are retained as evidence. The cart was emptied and the product and category deactivated.

## 7. EN traceability

| ID | Status | Evidence |
| --- | --- | --- |
| EN01 | PASS | Brevo transport reused (additive only); brevo/email tests; G11 |
| EN02 | PASS | markPaid hook; T01, DB01, DB02 |
| EN03 | PASS (client matrix NOT VERIFIED) | 7 renderers, 153 tests, opened captures |
| EN04 | PASS (fulfillment = adapter only) | compensate hook; T06–T08, DB09 |
| EN05 | PASS | DB01–03, snapshot immutability test |
| EN06 | PASS | ADR-009; DB10; DEV/PROD readback |
| EN07 | PASS | DB04–DB07 |
| EN08 | PASS | DB08, uncertain tests, runbook |
| EN09 | PASS | Provider calls are only in the dispatcher outside transactions; T23/E19; E20 liveness |
| EN10 | PASS | Notice tests, Playwright E01–E16 |
| EN11 | PASS | 404 isolation, DTO allowlist, escaping tests, trusted origin, allowlisted logs |
| EN12 | PARTIALLY VERIFIED | App 390–1920 and emails 320–600 verified; real email clients NOT VERIFIED |
| EN13 | PASS | Historical bytes identical; ledger fingerprints unchanged |
| EN14 | PASS (G05 owner-confirmed) | §6 |
| EN15 | EXPLICITLY DEFERRED | Acceptance-only mode; DELIVERED is never set; webhook not configured |
| EN16 | PASS | Bounded batch/concurrency/lease, heartbeat/health metrics, OTP rows untouched |
| EN17 | PASS | No invoice, tracking, admin route or dashboard |
| EN18 | Self-review done; independent review pending | §8 |

## 8. Residual risks and self-review

- There is no exactly-once inbox delivery; UNCERTAIN events need operator resolution (runbook).
- Producer activation (`COMMERCE_EMAIL_ENQUEUE_ENABLED`) must be enabled per environment with a recorded cutoff. No backfill exists by design.
- Deactivated accounts are suppressed at send time. Account deletion does not purge pending events (out of scope; retention purge is a manual, documented operation).
- The domain schema does not cross-check money arithmetic or `estimatedStart ≤ estimatedEnd`. The renderer prints persisted values, and an invalid range makes rendering fail (quarantined as FAILED rather than sending a wrong date).
- Two load-related flakes appeared only under fully parallel runs and pass in isolation: backend `logging-continuity`, frontend checkout timing.
- PROD backup/PITR was not verified; the owner accepted that risk explicitly for this migration.

**Self-review:** 88/100 (self-assessed, not approval). Deductions: email-client matrix not verified,
webhooks deferred, and fulfillment covered only by the adapter.

## 9. Architect closure (findings F-01 to F-04)

Base: `9085adf` (pushed, CI run 39166078163 all 10 jobs passed). The changes below are **uncommitted and unpushed**; remote CI for them is pending.
Migration SHA-256 is unchanged (`9cf9ad9c…19e`); no migration file was touched.

| Finding | Correction | Focused proof | Result |
| --- | --- | --- | --- |
| F-01 | `verify` now fails (exit 2) unless the migration is applied, finished and checksum-exact with nothing pending, and the physical schema matches the contract in `scripts/lib/commerce-email-schema.cjs`: named constraints (kind, key tokens, validated, FK target/action), indexes (definition, uniqueness, validity), triggers (timing, enabled, function and function-body markers), exact enum members, RLS and `anon`/`authenticated` privileges, plus commerce Prisma drift. Deploy postflight uses the same checks. Failures are credential-free codes on stdout and stderr. A loopback-only `LOCAL` target lets the real CLI run against a disposable database | Real PostgreSQL 18 via `npm run email:pg`: good DB exits 0 with documented historical drift tolerated; absent tables, a database with no ledger, a dropped lease index, a non-unique `eventKey` index, a dropped and a weakened CHECK, a dropped FK, a dropped trigger, a no-op trigger function, RLS off, and `anon`/`authenticated` privileges each exit non-zero with the specific code. Pure rules (`commerce-email-schema.verify.test.ts`, 8) cover ledger cases that need no database (not applied, duplicate, unfinished, rolled back, checksum mismatch, pending) | PASS. The first real run caught a wrong expectation of mine (PostgreSQL prints `PRIMARY KEY (id)` unquoted); fixed, then 33/33 |
| F-02 | Producer keeps a product image only if it is an absolute HTTPS URL, credential-free, without a custom port, on an approved host, otherwise `null`. Approved hosts come only from configuration: the `COMMERCE_EMAIL_ORIGIN` host, the configured Supabase Storage host (`SUPABASE_URL`), and the optional `COMMERCE_EMAIL_IMAGE_HOSTS`. Plain http only for loopback outside production. The email is never invalidated by an image. Read-only check: all 274 `product_images` and 65 `order_items` in DEV have no absolute http(s) host (relative paths), so no image appears in emails until absolute approved URLs exist | `commerce-email.images.test.ts` (17): approved URL kept; lookalike and subdomain hosts, other storage project hosts, http, `javascript:`/`data:`/`file:`, credentials, ports, malformed, oversized and markup characters rejected; a producer-level case with six items (one approved, five unsafe) still yields two READY events that parse and render with every item listed | PASS |
| F-03 | Runbook: 10-step activation sequence (identity, `verify` with exit 0 and no failures, compatible code and writers, Brevo and config readiness, producer at a recorded cutoff, dispatcher separately, inspect, pause). It prohibits enabling the producer against an unverified schema. No query was added to payment finalization | Source inspection of `docs/10_Operations/COMMERCE_EMAIL_RUNBOOK.md` | PASS |
| F-04 | One policy: IPv6 loopback is unsupported in both `trustedOrigin` (config) and `assertTrustedOrigin` (renderer); production remains HTTPS-only | Parameterized agreement test in `commerce-email.images.test.ts` (localhost, 127.0.0.1, `[::1]`, https, http) | PASS |

Changed files: `apps/backend/scripts/commerce-email-migration.cjs`, `apps/backend/scripts/lib/commerce-email-schema.cjs` (new), `apps/backend/src/services/commerce-email.config.ts`, `commerce-email.producer.ts`, `apps/backend/vitest.commerce-email-pg.config.mts`, `apps/backend/.env.example`, `docs/10_Operations/COMMERCE_EMAIL_RUNBOOK.md`, and three new test files (`commerce-email-migration-verify.postgres.integration.test.ts`, `commerce-email-schema.verify.test.ts`, `commerce-email.images.test.ts`).

Read-only verification against shared databases (`verify`, SELECTs and a local schema diff only, no deploy and no writes):
- DEV `pzxekjybdiulzmssalfo`: exit 0, `failures: []`, 20 ledger rows, new migration finished with the matching checksum, 14 constraints, 11 indexes, 2 triggers, RLS on, no browser-role privileges, no commerce drift, outbox/attempts rows 2/2 (the retained gate evidence).
- PROD `yepfgjehdstlxbpespun`: exit 0, `failures: []`, same schema readback, outbox/attempts rows 0/0.

Other verification on the working tree:
- Playwright `tests/orders/commerce-email.spec.ts` against a rebuilt `dist`: **16/16**. A first run before rebuilding failed 1/16 because `vite preview` was serving the earlier build with the old PARTIAL wording; it passed after the rebuild.
- Typecheck and lint, backend and frontend: clean. `git diff --check`: clean apart from CRLF notices. Secret scan of changed files: nothing found.
- Backend focused: 399 of 400 before the closure; after the F-01 test fix, `payment.purchase-ownership` 42/42 ten times in a row. The images and schema unit tests are 24/24.
- **Full suites on this machine are not green.** Backend: 1200 passed, 8 failed, all in `tests/logging-continuity.test.ts` (a child `tsx` process that exceeds the 5s default timeout; it takes 6s here and 8–10s on the base commit `7d29774`, so it is not caused by this work); the file passes 23/23 with `--testTimeout=30000`. Frontend: 765 passed, 29 failed in 3 files, then 6 different files on a second run (checkout-heavy suites timing out under load, including a Vite dev server on port 3000 that has used about 14 CPU-hours and is not part of this work); the six failing files pass 205/205 with `--testTimeout=60000`. Those longer timeouts are diagnostics only; the repo timeouts are unchanged. CI on the pushed `9085adf` passed all of these; CI for this delta has not run.

## 10. Missing-email incident: second customer (2026-10-19)

**Report:** a purchase by a second manual QA account produced no confirmation emails, while the first test mailbox received them.

**Read-only trace (DEV `pzxekjybdiulzmssalfo` and PROD `yepfgjehdstlxbpespun`; ids, states and booleans only):**
- The QA account exists in DEV only (PROD has no users), is active, and has 39 orders. Its newest order is from 2026-10-16, two days **before** the Task 03.8 migration existed. No order from it exists after the migration, so no event was ever possible for it. Its older orders have no events by design (no backfill).
- None of the `COMMERCE_EMAIL_*` switches is set in any env file, so the producer is off (the safe default) in the running API and payment worker, and no email worker was running. The first mailbox received its emails only because the DEV gate script (run `a1d284a8`) enabled the producer and an allowlist worker inside its own process. It was never evidence that ordinary purchases send email.
- Recipient handling is not the cause: events are addressed from each purchaser's own account email (no per-address configuration anywhere in the code). The only address-based restriction is the optional `allowlist` test mode.

**Root cause (operational, proven):** producer disabled and no supervised worker in the environment where the purchase would be made; and, once enabled, DEV safety mode (`allowlist`) correctly sends only to listed addresses. No source defect in recipient selection was found.

**Corrections:**
| Area | Change |
| --- | --- |
| Visibility | `email_producer_disabled` is logged (first occurrence and every 50th, counts only) so a disabled producer can no longer pass for a healthy one. Worker `email_worker_ready` and every heartbeat now report `sendMode`, dispatch/producer flags and allowlist size; in allowlist mode the heartbeat adds `allowlistExcluded` (due events the worker will deliberately never claim). |
| Runtime | `docker-compose.yml` gains a supervised `commerce-email-worker` service (`node dist/bootstrap.js --commerce-email-worker`, `restart: unless-stopped`, 30s grace). It is inert and refuses to start until dispatch and a send mode are authorised for the resolved database. |
| Runbook | "A customer says they got no email" diagnosis table (producer, worker, authorisation, allowlist, suppression, retry, provider outcome) and a local-dev `.env.local` example. |

Nothing else changed: no migration, no payment finalization logic, no OTP code, no new email type (no `PAYMENT_FAILED`), no frontend change, no individual address added to any allowlist.

**Verification:**
- Real PostgreSQL (`npm run email:pg`): 38/38 (23 original, 10 migration-verifier, 5 new multi-customer). The multi-customer suite uses two distinct active customers with distinct registered addresses: four unique events, each owned by and addressed to its own account, with no cross-customer reference in any snapshot; an allowlist worker sends only the listed customer's two emails and the other customer's events stay READY with `attemptCount` 0 (reported as `allowlistExcluded`); a live worker then sends the second customer's two emails to their own address with no per-address configuration, makes exactly four ACCEPTED first attempts in total, and a rerun resends nothing. A declined payment, a pending checkout and an abandoned checkout create zero events; re-processing settled purchases adds none.
- Unit: `commerce-email.producer-disabled.test.ts` 3/3. Backend lint and typecheck clean. Full backend suite: **1211 passed, 0 failed, 100 skipped** (no load failures this run).
- Live DEV gate for the second approved mailbox (plus-alias of the owner-confirmed address; run `d99a81cd`, Stripe Test Mode $12.34, order `ORD-D63B827C-45B6-4AE5-B674-79BA5DE91F84`): G01–G04 and G06–G12 PASS. Two events created atomically with finalization, the worker claimed exactly 2, Brevo ACCEPTED both (message-id hashes `efa07a84…`, `a068da18…`), 1 distinct recipient, projection `SENT`, a foreign account gets 404, the purchase stays CONFIRMED/SUCCEEDED. **G05 (mailbox observation) is pending the owner**; provider acceptance is not delivery.
- Migration SHA-256 unchanged (`9cf9ad9c…19e`); no migration file touched.

**Not done / not verified:**
- The Playwright and frontend suites were not rerun (no frontend change since the last verified run).
- Production sending was not activated and cannot be proven here: `live` mode on a shared target needs `COMMERCE_EMAIL_LIVE_APPROVED_TARGET`, a deployed supervised worker, a verified Brevo sender and an HTTPS origin, under the separate operational authorization. General recipient independence is shown by the real-PostgreSQL live-mode test, not by two mailbox tests.
- Orders paid before activation (including the QA account's) get no email and are not backfilled; backfill would need a separately approved, idempotent, bounded procedure.
- Spam-folder placement, bounces and deferrals need Brevo's transactional log; delivery webhooks remain deferred (EN15).

## 11. Manual-checkout email failure: normal runtime fix (2026-10-19)

**Root cause (corrects §10, which looked only at shared DEV).** The manual purchases happened on the **isolated local PostgreSQL** (`localhost:55434/electrohub_disposable`), not shared DEV, and three independent conditions each prevented email:
1. That database had 19 migrations and **no `commerce_email_*` tables** (the Task 03.8 migration had only been applied to DEV and PROD). Enabling the producer there would have broken payment finalization.
2. The producer switch was off, and no email worker was part of either dev launcher (`dev:isolated`, `payment:dev`).
3. Proven live: a purchase on this database was finalized by the pre-existing backend on :5000 (producer off, started before any email setting existed), which logged `email_producer_disabled` at the moment it marked the order PAID. A correctly configured second backend sharing the database cannot compensate, because whichever process claims the payment work finalizes it.

**Changes (no migration edited, no payment finalization logic changed):**
| Area | Change |
| --- | --- |
| `scripts/dev-isolated.cjs` | Applies pending migrations to the verified disposable database at startup (also `migrate`); starts the supervised email worker; capture mode by default and `--real-email` (approved `COMMERCE_EMAIL_ALLOWED_RECIPIENTS` only, refuses without them or without the Brevo key); `captured`, `use-real-recipient`, `restore-recipient`. Explicit email settings override `.env.local` so the mode cannot drift |
| `scripts/dev-payment-runtime.cjs` (`payment:dev`, shared DEV) | Starts the supervised email worker with the API and payment worker; reports it in the readiness record; a missing build or unconfigured email is reported, never hidden, and never blocks payments |
| `scripts/lib/commerce-email-dev.cjs` | Config summary with actionable warnings; worker supervisor: bounded restart (5 per 5 min), no restart on a config/schema refusal (exit 78), single-supervisor lock, readiness confirmed from the structured log |
| `src/services/commerce-email.runtime.ts` | `email_runtime` startup line in the API, payment worker and email worker (producer, dispatch, send mode, allowlist size, warnings such as `WORKER_BUT_NO_EVENTS`); best effort, cannot stop startup |
| `src/commerce-email-runner.ts` | One startup check that the commerce tables exist (exit 78 otherwise); `email_runtime`; no per-payment query |
| `package.json`, `.env.example`, runbook | `dev:isolated:real-email`, `db:isolated:emails`; DEV settings block; development runtime section |
| `scripts/dev-email-smoke.cjs`, `tests/isolated/commerce-email.isolated.spec.ts` | Reusable normal-runtime verification (HTTP API with Stripe Test Mode; browser equivalent) |
| `.env.local` (untracked) | `COMMERCE_EMAIL_*` DEV block: producer and dispatch on, `allowlist` with the two approved mailboxes |

**Verification:**
- Isolated database now verifies clean with the physical verifier (`verify LOCAL`): no failures, 20 ledger rows, checksum match, 14 constraints, 11 indexes, 2 triggers. Migration SHA-256 unchanged (`9cf9ad9c…19e`).
- Normal-runtime smoke on `PORT=5200 npm run dev:isolated` (capture), run twice, 12/12 each, the second after killing the worker (supervisor restarted it in 2s): a declined payment gives DECLINED and no email; each of two successful purchases yields exactly two emails (Order confirmed, Payment confirmed) automatically, addressed only to the signed-in customer, order details report `SENT`, no email carries another purchase's reference, re-reading orders and purchases sends nothing, four emails per run in total.
- Real Brevo in the same runtime (`dev:isolated:real-email`, allowlist of one approved alias, fixture customer switched to it and restored afterwards): purchase `ORD-E126C647-533B-45D8-B0E2-529AD31C0A17` PAID; both outbox events `ACCEPTED`, provider BREVO, one attempt each, recipient equals the account's address, message-id hashes `ef252b72…`, `1b1fc51c…`; details report `SENT`.
- Real PostgreSQL `npm run email:pg` 38/38; supervisor tests (`node --test scripts/dev-payment-runtime.test.cjs`) 13/13 including the new email-worker cases; new helper/diagnostic unit tests 13/13; full backend suite **1221 passed, 0 failed, 100 skipped** (an earlier run found 2 failures in `server.recovery.test.ts` caused by this change's startup diagnostic against that test's logger mock; fixed by making the diagnostic best-effort and completing the mock); backend and frontend lint and typecheck clean.

**Not verified / open:**
- **Mailbox receipt is owner-observed:** the real-Brevo purchase went to an alias of an approved mailbox, and Gmail alias delivery does not prove base-address delivery. The first base-address proof is the owner's own purchase with an approved account (accounts with both approved addresses already exist in the isolated database).
- **Browser card entry not exercised:** `js.stripe.com` stalled from this machine during the run (connection opened, no completion in 60s), so the Payment Element never loaded. The browser spec exists but has not passed; the API smoke substitutes only the card-confirmation step (server-side Stripe Test Mode payment methods).
- **Shared-DEV `payment:dev` was not run live** (it would share port 5000 with the isolated runtime); it is covered by the supervisor tests above and by the DEV gate runs in §6 and §10.
- Frontend unit and Playwright suites were not rerun (no frontend source changed).
- Production is unchanged: no live sending, no worker deployment, no PROD action.

## 12. Third-account delivery and confirmation UI (2026-10-19)

- **Root cause (proven from the isolated DB serving :3000):** `dev:isolated:real-email` runs `allowlist` mode with the two approved addresses. The third account (not on the list) received correct durable events (`ORDER_CONFIRMED`, `PAYMENT_CONFIRMED`) for `ORD-DEA248A3-…`, but they stayed `READY` with 0 attempts, because the dispatcher never claims excluded recipients. The UI had no refresh, so it showed `QUEUED` indefinitely.
- **Screenshot B:** `ORD-B8EA06B6-…` exists, is `CONFIRMED`, and is owned by a different account (both its events are `ACCEPTED`). The 404 is the correct owner-scoped denial. The defect was the copy: 404 and 5xx/network failures showed the same "could not find" text. They are now separate (not-found for this account vs. temporary, retryable).
- **Fixes:**
  - `dev:isolated:all-recipients` (`--real-email --all-recipients`) runs the existing `live` mode, which `live-disposable` permits on the disposable DB only. It sends to every eligible account's own email, with no allowlist. It reports the pending sendable count and refuses to start above 10.
  - Allowlist mode is unchanged.
  - The worker now emits a warn-level `email_allowlist_excluded` (count only) signal.
  - The frontend uses bounded read-only refresh (`emailConfirmationRefetchInterval`) on Confirmation and Order Details: 15 s while visible and QUEUED/DELAYED, at most 40 polls, stops at terminal states, exponential backoff after failures, and revalidates on focus.
- **Runtime:** the owner authorized the restart of :5000. `mode=live producer=true dispatch=true`, worker READY. The 2 pending events for `ORD-DEA248A3-…` went READY→ACCEPTED (Brevo, 1 attempt each, provider message IDs recorded). Mailbox receipt: **pending owner confirmation**.
- **Checks run:**
  - Frontend: ConfirmationPage + orders tests 55/55, `tsc` clean, eslint clean.
  - Backend: `tsc` clean, eslint clean, commerce-email unit tests 64 passed (38 PG-gated tests skipped, not rerun; no dispatcher or producer code changed), supervisor tests 13/13.
- **Not run:** a new three-customer automated purchase run, Playwright/Storybook, full suites, and CI.

## 13. Transient email notice and clean logout (2026-10-19, frontend only)

- **Notice lifetime:** the initial-email notice shows for at most 60 s per (owner, order), starting when it first becomes eligible: a PAID, non-cancelled order placed within the last 10 minutes. The start time is stored per user and order in `sessionStorage` (in-memory fallback), so rerenders, React Query refreshes, reloads and Confirmation↔Details navigation never restart it. Once expired it never returns, and a historical order never starts a window. Sign-out removes it immediately, and another account never inherits it (the owner id is part of the key). When it expires the component renders nothing: no wrapper and no gap. Visibility only: no backend call, no outbox change.
- **Where:** Confirmation and Order Details. **Not on My Orders**, per the owner's instruction (the Orders-list notice was removed).
- **Polling:** the status refresh now stops when the notice window ends, as well as at terminal states, after 40 polls, and when the tab is hidden.
- **Logout:** `OrdersAccessGate` remembers an in-page sign-out for that mount and shows the loading placeholder, then routes Home, instead of "Sign In Required". `ProtectedRoute` sends an explicit logout to `/` instead of the `/cart` fallback. A guest opening these URLs directly keeps the existing behaviour. Owner-scoped queries are disabled while logging out (Orders list, Details, Confirmation).
- **Evidence:**
  - Vitest: 812/812 (full frontend suite), `tsc` and eslint clean.
  - New unit tests cover 60 s expiry (fake timers), rerender/remount, expired-stays-gone, historical and unpaid orders, account isolation, no fetch on expiry, the gate during logout, and the protected-route redirect.
  - Playwright (mocked reads, fresh production build): `npx playwright test -c playwright.orders.config.ts tests/orders/commerce-email.spec.ts` gave 22/22. It includes expiry at 60 s with no write requests, My Orders without a notice, logout from Orders / Details / Confirmation with no sign-in flash (mutation observer), and a direct guest visit to /orders still protected.
  - The 390 px capture (`test-results/commerce-email/details-delayed-390.png`) was viewed and checked for placement and wrapping. The 1440 px capture ran under the same overflow and alignment assertions; I did not view that image.
- **Not done:** no live-stack browser run, and no remote CI on these changes. Backend email delivery was not touched or retested.
