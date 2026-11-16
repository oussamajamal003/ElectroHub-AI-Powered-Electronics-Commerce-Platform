# Task 03.6 — MacBook & Galaxy Buds2 Real-Incident Investigation

Status: **OPEN — pending Principal Architect review. NO PUSH.**
Investigation date: 2026-10-17 (all timestamps UTC; local workstation = UTC+3).
Mode: read-only. No database writes, no Stripe calls other than GET, no webhook replay, no worker restart, no commits.

---

## 1. Environment identity

| Item | Evidence | Status |
|---|---|---|
| DEV database | Supabase project `electrohub-dev` (ref `pzxekjybdiulzmssalfo`, ap-northeast-2). A second project named `electrohub` was **not** queried. | VERIFIED |
| Query mode | SELECT statements only, through the Supabase connector. | VERIFIED |
| Migration `20261016000000_payment_attempt_confirmation_started` | `_prisma_migrations`: 1 finished row. | VERIFIED |
| `PAYMENT_CONFIRMATION_SIGNAL=true` on the running DEV backend | Reading `apps/backend/.env` was declined. **Indirect evidence:** one attempt holds `confirmationStartedAt = 2026-10-17 08:59:17.313`, and a matching `POST …/confirmation-started 200` is logged at 08:59:19. The service writes the column only when the flag is on. | PARTIALLY VERIFIED (inferred ON) |
| Local backend logs | `apps/backend/logs/app.log` (00:00:01 → 10:01:04 on 2026-10-17) and `error.log`, written by the backend serving DEV. | VERIFIED |

## 2. Stripe identity — ACCESS BLOCKED

- Both attempts are bound to the account `stripeAccountId = acct_1UEZW5KiVgdl63pN`.
- The connected Stripe MCP exposes only `acct_1UEZV83TuYNdQJpp` ("New business", `livemode=false`). It is a **different** account.
- `GET /v1/payment_intents/{id}` for both intents returned `No such payment_intent`, which is expected for an account that doesn't own them.
- **Permission needed:** connect the Stripe integration to Test Mode account `acct_1UEZW5KiVgdl63pN` (read-only is enough).

Until then, provider truth below comes **only from the backend's own provider observations** (`payment.provider.observed` logs and the persisted `providerStatus`). That is evidence of what Stripe returned to the worker, not a direct Stripe read.

Sentry: not used. The `plugin:sentry` connector requires authorization that was not available.

## 3. Identity mapping

Search: every `payment_attempt_items` row whose product matches "MacBook Air 15" or "Buds2 Pro" (15 rows, one owner).

| Item | Attempt | Stripe intent | Work | Current backend state (09:59 UTC) |
|---|---|---|---|---|
| Apple MacBook Air 15 M3 16GB 512GB — **Space Gray**, qty 1, $1,499.00 | `aab01e3a-588f-4f6b-ac08-1a55262daa87` | `pi_3URTtbKiVgdl63pN0BXcTQN0` | `ea9e3bb4-4dd7-49fe-bfbf-1789aacc2f73` | `AWAITING_INPUT`, `providerStatus=requires_payment_method`, `failureCode=null`, `orderId=null`, work `READY`, retry 0, no lease |
| Samsung Galaxy Buds2 Pro, qty 1, $149.00 | `bf43a065-bc5b-445b-98d6-30b7f134ec70` | `pi_3URTmxKiVgdl63pN1FsF1hXn` | `35129b8e-f591-4ada-a035-b2c4f49ee2d4` | `AWAITING_INPUT`, `providerStatus=requires_payment_method`, `failureCode=null`, `orderId=null`, work `READY`, retry 0, no lease |

Why the match is unambiguous:
- All other Space Gray 512GB / $1,499 rows: **none**. The other $1,499 MacBooks are Silver or Midnight, and all are `PAID` or `CANCELED`.
- All other Buds2 Pro rows are terminal or dismissed: `bbb0903f…` is DECLINED and dismissed; `65b600a5…` and `5ee70845…` are CANCELED.
- These are the only two non-terminal, undismissed, submitted rows for these products. That matches the two "Pending purchases" cards in the screenshot.

Owner: a single customer (ID redacted). Both rows have the same owner.

| Field | MacBook `aab01e3a` | Buds2 `bf43a065` |
|---|---|---|
| createdAt | 09:27:14.213 | 09:20:17.229 |
| submittedAt | 09:27:55.530 | 09:21:12.562 |
| confirmationStartedAt | **null** | **null** |
| expiresAt | 09:57:14.210 (lapsed) | 09:50:17.221 (lapsed) |
| Projected status with the old code | `PROCESSING` while leased, otherwise `AWAITING_CUSTOMER_ACTION` ("Checkout saved") | same |
| Projected status with the current code | `AWAITING_CUSTOMER_ACTION` | same |

## 4. Lifecycle timelines

Sources: [DB] current row · [LOG] http.completed or payment.* lines in `app.log` · [INF] inference.
"start" for an HTTP request is the completion time minus its logged duration.

### Buds2 `bf43a065`
| Time | Source | Event | Evidence |
|---|---|---|---|
| 09:20:04 → 09:20:32 | LOG | `POST /payment-attempts` (setup) 201, **27.4 s** | http.completed |
| 09:20:17.229 | DB | attempt created | `createdAt` |
| 09:20:24 | LOG | first worker claim → 09:20:27 observed `requires_payment_method` → 09:20:30 persisted `AWAITING_INPUT` | payment.work.claimed / provider.observed / outcome.persisted |
| 09:21:00 → 09:21:19 | LOG | `POST …/submit` 200, **19.1 s** (Place Order) | http.completed |
| 09:21:12.562 | DB | `submittedAt` written; Cart items removed server-side | row |
| 09:21:19–09:21:22 | LOG | `GET /api/cart` and `GET /payment-attempts` ×2 right after submit | These match the `invalidateQueries` calls in `CheckoutPage.place()`, which run only after the submit response passed `matchesPaymentAttempt`. |
| after 09:21:19 | LOG | **No `POST …/confirmation-started`, no `POST …/reconcile`** for this attempt, at any time | The route is logged on every call, including earlier 200 and 409 responses. |
| 09:21:23–09:21:33 | LOG | `GET …/:attemptId` ×3 | [INF] a status reader polling this purchase (Checkout's restored-purchase view or the saved-purchase view). |
| 09:20:24 → 10:01:15 | LOG | **49 worker passes**, each observing `requires_payment_method` and persisting `AWAITING_INPUT` | provider.observed |
| 09:52–10:00 | LOG | included in `payment.recovery.escalation` samples (`READY`, lease not expired) | error.log |
| now | DB | `AWAITING_INPUT`, no marker, no failure code, no order | row |

### MacBook `aab01e3a`
| Time | Source | Event | Evidence |
|---|---|---|---|
| 09:25:44 → 09:26:06 | LOG | `POST /payment-attempts` 201 (22.0 s) — an earlier setup | http.completed |
| 09:25:59 / 09:26:19 | LOG | `POST /api/cart/items`, `DELETE /api/cart/items/:id` (Cart changed → new setup) | http.completed |
| 09:26:47 → 09:27:24 | LOG | `POST /payment-attempts` 201, **36.9 s** | http.completed |
| 09:27:14.213 | DB | attempt created | row |
| 09:27:18 | LOG | first worker claim | payment.work.claimed |
| 09:27:49 → 09:27:58 | LOG | `POST …/submit` 200, **8.5 s** (Place Order) | http.completed |
| 09:27:55.530 | DB | `submittedAt` | row |
| 09:27:58–09:27:59 | LOG | `GET /api/cart` and `GET /payment-attempts` ×2 right after submit | Same post-submit invalidations. |
| after 09:27:58 | LOG | **No `confirmation-started`, no `reconcile`, no `GET …/:attemptId`** | Afterwards only the 15 s pending-purchases list poll (09:28:15, :31, :47, 09:29:03), the cadence used while Pending purchases are on screen. |
| 09:27:18 → 10:01:16 | LOG | **33 worker passes**, all `requires_payment_method` → `AWAITING_INPUT` | provider.observed |
| now | DB | `AWAITING_INPUT`, no marker | row |

No `/resume` request for either attempt appears in the window. The only `/resume` (09:19:05, 9.3 s, 200) predates both attempts. **The "Continue to payment → stuck loading" step is therefore not in the retained server logs for these IDs.** Its mechanism is analysed in §7 from the code and the measured leases, not from a logged request.

Webhooks: `stripe_events` has **no rows** for either intent; its latest row is 2026-10-10 13:23. A `POST /api/webhooks/stripe 200` at 09:27:03 produced no row that I could correlate. Reconciliation of these attempts relied entirely on worker polling.

## 5. Financial outcome — category C (card never confirmed)

| Question | MacBook | Buds2 | Basis |
|---|---|---|---|
| Submitted (Place Order)? | Yes | Yes | `submittedAt` + `/submit` 200 |
| Confirmation initiated by the browser? | **No** | **No** | No `confirmation-started` request while the flag is on (§1). `place()` always announces before calling Stripe.js, and always reconciles afterwards; neither request exists. |
| Provider decline recorded? | No | No | Every worker observation reports `requires_payment_method`; `failureCode` stays null. A `last_payment_error` would have persisted `DECLINED`. |
| Authorization / capture in flight? | No | No | Never observed `requires_action`, `processing` or `requires_capture`. |
| Card attached? | **NOT VERIFIED** | **NOT VERIFIED** | `methodType` is not persisted or logged; needs a Stripe read (§2). |
| Money received? | No (as observed by the worker) | No | Persisted state never progressed past card entry. |

**Classification: C — card never confirmed. Nothing was charged according to the backend's provider observations. Direct Stripe confirmation is BLOCKED.**

Pending automatic change: both rows meet `abandonedSubmission` 15 minutes after `expiresAt`. That is ≈10:05:17 for Buds2 and ≈10:12:14 for MacBook. When the running DEV backend's worker passes that point, it will cancel each intent and mark the attempt `CANCELED / PAYMENT_EXPIRED`, which the customer sees as "abandoned" and which is hidden. This is existing approved behaviour. **I did not trigger or prevent it.** A later re-read may show those states rather than the ones recorded here.

## 6. Why "Checkout saved" became "Processing" — CONFIRMED

- Neither row ever had a confirmation marker, and Stripe never left `requires_payment_method`. **No payment fact justified Processing at any point.**
- The work rows were leased for 49 (Buds2) and 33 (MacBook) passes. Measured over all 614 passes today, claim→persist lasts **p50 4.3 s, p90 10.6 s, max 26.3 s**, with a new claim about every 10 s. The row was therefore `LEASED` for a large share of every minute.
- The old `customerPaymentStatus()` returned `PROCESSING` for any `LEASED` work. The pending list therefore flipped Checkout saved ↔ Processing whenever a poll landed inside a pass. That is exactly the reported sequence.
- **Current source:** the lease no longer affects classification (`payment.domain.ts`). Both observed rows (AWAITING_INPUT, submitted, no marker, LEASED or READY) now project `AWAITING_CUSTOMER_ACTION` in both cases. **FIXED IN SOURCE** (unit-verified with the exact row shape).

## 7. Why "Continue to payment" hung — mechanism confirmed, request not logged

The path is `SavedPurchaseCheckout` → `GET …/:id` → `canResumePaymentEntry` (requires `!recoveryActive`) → `POST …/resume` (refused on an active lease).

With the measured leases:
- **Before the previous fix:** any read or resume landing inside a pass (often, given 4–26 s passes about every 10 s) sent the page into the observation spinner. Polling never returned it to card entry, so the page waited out the 120 s window and then redirected to Cart.
- **Previous fix (5 s backend wait / ~6 s frontend wait): insufficient.** It covers roughly the median pass but not p90 (10.6 s) or the max (26.3 s), and the worker re-claims about every 10 s. **ADDITIONAL FIX REQUIRED** — now applied (§10).

The worker's 120 s lease ceiling (`WORK_LEASE_MS`) is not the normal case here: max observed 26.3 s. Leases that genuinely expire are already escalated (`payment.recovery.escalation`, `leaseExpired:true`) for other attempts (`e6fe512f`, `b64bbe8d`, `e7b85a1d`, `aaca3b82`). Those were outside this incident and are listed for follow-up.

## 8. Confirmation-started signal

- The flag is on (§1); the signal works elsewhere (08:59 marker).
- For these two purchases no marker was ever written, cleared or overwritten. No `confirmation-started` request exists, and the column is null. The "cleared after 2 min" path and the "stale snapshot" path were **not** involved in this incident. The earlier hardening (marker recorded only after validation; fresh Stripe read before clearing) stays a valid defence but is not the cause here.

## 9. Why the browser never confirmed after a successful submit

**Evidence:** the post-submit invalidation requests prove `place()` reached the code just after `matchesPaymentAttempt` (`CheckoutPage.tsx`, "Submission is already durable…" block). The very next statement is `if (!current()) throw new StalePaymentAttemptResult()`. That is followed by `announceConfirmation`, which would have produced a logged request (or a `GET …/:id` status read on a lost response). No such request exists for the MacBook. The three status GETs on Buds2 match a status reader, not the single read `announceConfirmation` performs.

**Conclusion [INF, strong]:** in both cases `current()` was false when the slow submit returned (19.1 s and 8.5 s, against DEV database latency). The cause was one of: Checkout unmounted (customer navigated, for example to Cart, where the 15 s list poll then appears for the MacBook), the setup generation changed, or the draft attempt changed. `place()` therefore deliberately did not confirm an unmounted or stale card form. That is a designed safety behaviour, and it left a submitted purchase that was never confirmed. Which of the three `current()` conditions failed cannot be distinguished from server logs; the browser timing marks (`markPaymentTiming`) are client-side only.

This outcome is safe: nothing was charged, and the purchase is resumable. The customer-visible defects were the false Processing (§6) and the hang on resume (§7).

## 10. Source changes in this pass

1. `apps/backend/src/services/payment.service.ts`
   - **Idle back-off.** A submitted `AWAITING_INPUT` attempt with no confirmation marker, past the 3-minute recheck window, now rechecks every 60 s instead of 10 s. A customer confirmation is still followed by `/reconcile`, which wakes the work immediately, and lapse detection still runs. This removes most of the lease occupancy that blocked resume.
   - **`RESUME_LEASE_WAIT_MS = 12_000`** (previously reused the 5 s submit wait), sized from observed p90 and kept inside the client's 25 s resume deadline. Past it, resume still fails closed with `PAYMENT_RECOVERY_PENDING`.
2. `apps/frontend/src/features/checkout/SavedPurchaseCheckout.tsx` — the settle wait is now deadline-based (20 s, 1 s interval) instead of 6 reads. Past the deadline the existing safe observation remains.
3. Tests:
   - `payment.service.test.ts`: idle back-off is 60 s; the routine 10 s cadence is kept for unsubmitted attempts and for attempts with a marker.
   - `payment.purchase-ownership.test.ts`: the persistent-lease tests' timeout was raised to 25 s; they still fail closed.
   - `SavedPurchaseCheckout.retry.test.tsx`: a lease spanning 4 reads is waited out and card entry opens; a genuinely processing purchase is still never resumed.

The previous pass's changes (lease-independent classification, resume lease wait, announce-after-validation, fresh read before marker clearance) remain.

Unchanged: financial invariants, fencing, Stripe calls, schema and migrations, API contracts.

## 11. Verification (offline, mocked DB/Stripe; nothing touched DEV)

| Check | Result |
|---|---|
| Backend `vitest src/services/__tests__/payment` | 303 passed, 45 skipped |
| Frontend `vitest src/features/checkout` | 239 passed |
| Frontend `vitest src/features/search` (rerun) | 29 passed. Two search tests failed once during a full parallel `src/features` run, with different assertions than before; they passed in isolation. Unrelated to this change, timing-sensitive. |
| Backend/frontend typecheck, lint, build | all exit 0 |
| `git diff --check` (backend/frontend src) | clean |
| Known unrelated failure | `src/routes/cart.quantity-correction.integration.test.ts` (500 vs 200), already failing; it doesn't import payment code. |

No Stripe Test Mode PaymentIntents were created; the 70/70 accounting is untouched. No real-browser journey was run (Visual/E2E QA: NOT VERIFIED).

## 12. Comparison

| Area | MacBook | Buds2 |
|---|---|---|
| Payment submitted? | Yes (09:27:55) | Yes (09:21:12) |
| Confirmation initiated? | No | No |
| Stripe card attached? | NOT VERIFIED (Stripe blocked) | NOT VERIFIED |
| Provider decline? | No (worker observations) | No |
| PaymentWork lease | 33 passes, 4–26 s each | 49 passes |
| Recovery scheduling | every ~10 s, healthy, retry 0 | same |
| Resume error | no `/resume` logged for this ID | same |
| Marker cleared? | never set | never set |
| Current outcome | C — never confirmed (about to lapse to abandoned at ≈10:12) | C — never confirmed (≈10:05) |
| Root cause | slow submit + stale `place()` → unconfirmed submission; lease-driven false Processing; lease-blocked resume | identical mechanism |

The two incidents share one cause.

## 13. Recovery infrastructure

- **Working during the incident** (log-verified, not inferred from current health): an in-process runner (`runner:"in-process"`) claimed both attempts on schedule from first creation to 10:01, with `retryCount = 0`, no `lastError`, and no overdue `READY` work at 09:59.
- **Webhook ingestion:** no `stripe_events` rows since 2026-10-10. If webhooks are expected in DEV, ingestion is not persisting them — **follow-up**. That did not strand these attempts; polling covered them.
- **Lease expiry escalations** exist for other attempts (§7). Follow-up.
- **Latency:** DEV request latencies of 1–37 s, including payment setup at 22–37 s and submit at 8.5–19 s, are the precondition for the stale `place()`. This is an operational concern (database region / pool), not addressed here.

## 14. Remaining unverified

- Stripe-side truth for both intents: status, attached payment method, events (account access, §2).
- Which `current()` condition failed in `place()` (client-side only).
- Whether the customer actually clicked Continue to payment for these IDs (no `/resume` logged; logs could have been rotated or lost — not verified either way).
- The `PAYMENT_CONFIRMATION_SIGNAL` value read directly from configuration.
- Sentry events.

## 15. Verdicts

| Purchase | Code-fix verdict | Current financial state (separate) |
|---|---|---|
| MacBook `aab01e3a` | **CONFIRMED ROOT CAUSE — ADDITIONAL FIX REQUIRED** → additional fix applied in source (idle back-off, longer resume and settle waits). Awaiting review. Stripe confirmation: **ACCESS BLOCKED — needs Test Mode read access to `acct_1UEZW5KiVgdl63pN`**. | Never confirmed; nothing captured or authorized per worker observations; scheduled to lapse to abandoned by existing logic. |
| Buds2 `bf43a065` | Same as MacBook. | Same. |

**Recommendation:** do not close Task 03.6 yet. Close after (1) a read-only Stripe check of both intents on `acct_1UEZW5KiVgdl63pN`, (2) Architect review of the §10 changes, and (3) a real-browser Continue-to-payment journey on a saved checkout against DEV latency, which needs an explicit allowance because it creates a PaymentIntent only if the customer re-confirms. Track separately: webhook ingestion (§13), expired-lease escalations (§7), and DEV latency.

---

## Addendum — Product decision: "Checkout saved" and "Continue to payment" removed

**Decision:** once Place Order is accepted (`submittedAt` set), a purchase is shown as **Processing** with **Check payment status** until an authoritative result arrives. It is never shown as a saved card entry again.

**Backend presentation (`payment.domain.ts`, `payment.service.ts`)**
- `customerPaymentStatus`: submitted `AWAITING_INPUT` → `PROCESSING`, with or without `confirmationStartedAt`. Unsubmitted → `NOT_SUBMITTED`. `ACTION_REQUIRED` stays `AWAITING_CUSTOMER_ACTION` (a genuine bank verification).
- As a result, `retryAllowed` is false for submitted card-entry purchases. Try Again stays available only for `DECLINED`, plus `ACTION_REQUIRED` from the status view.
- `/resume` refuses a submitted `AWAITING_INPUT` purchase with `409 PAYMENT_RECOVERY_PENDING`, unless Stripe already records a decline; in that case it persists `DECLINED`, as before. The API therefore can't reopen card entry either.
- The purchases projection adds `confirmationStarted: boolean`. It is used for copy only and never as an outcome.
- Unchanged: internal `AWAITING_INPUT`, the confirmation-started marker, fencing, recovery, the abandonment policy, schema.

**Frontend (`PaymentPurchases.tsx`)**
- Removed: the "Checkout saved" badge, the "Continue to payment" link, and the copy "This purchase is saved separately from your Cart. Nothing was charged. Select Continue to payment to complete your order." Also removed the "can't be continued from here" copy.
- Every unresolved card shows **Processing** (or **Awaiting confirmation** for UNKNOWN), a progress indicator, and **Check payment status**. That link opens `/checkout?purchase=` and performs GET status reads only.
- Copy:
  - Submitted, confirmation never started: "Checking the status of this purchase. Please don't pay again."
  - Confirmation started: "We're confirming this payment with our payment provider."
  - Bank verification: "Your bank asked for an extra verification step. Check payment status to continue."

**How an unconfirmed submission ends.** Recovery keeps reading Stripe. A decline moves to Failed payments; an authorization goes on to capture and a Paid Order. If nothing ever reaches Stripe, the existing abandonment policy cancels the intent 15 minutes after both `expiresAt` and `submittedAt`. The attempt is then ABANDONED, hidden, and not shown as a decline. The 45-minute stale note with a support reference is the escalation while waiting.

**Tests (actually run)**
- Backend services + routes: 641 passed, 55 skipped. 1 failure: the cart-quantity integration test that was already failing.
- Frontend checkout: 239 passed.
- Playwright `payment-recovery-navigation` (mocked API, Chromium 390px + 1366px): 14 passed.
- Typecheck, lint and build: pass on both apps. `git diff --check`: clean.
- Updated, not run (real stack or not wired to a config): `tests/integrated/journey-k.spec.ts`, `journey-m.spec.ts`, `fault-api.mjs`, `tests/checkout/pending-card-status.spec.ts`.

**Remaining risks and unverified**
- After a submitted-but-never-confirmed purchase is abandoned, its items are no longer in the active Cart (they were moved at submit), and the hidden ABANDONED card offers no "Restore items". The customer must re-add them. The policy is unchanged and needs a product decision.
- No real Stripe Test Mode journey was run (budget 70/70 exhausted). Paid and declined outcomes are covered by mocked suites only.
