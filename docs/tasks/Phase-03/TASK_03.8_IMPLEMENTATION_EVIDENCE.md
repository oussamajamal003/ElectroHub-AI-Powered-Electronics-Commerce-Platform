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
  When an image fails in Chromium, a broken-image box appears in the thumbnail cell; real images are HTTPS Cloudinary URLs.

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
