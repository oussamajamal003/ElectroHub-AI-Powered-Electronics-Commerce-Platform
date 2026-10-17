# Task 03.6 — Endless Processing: Root Cause and Closure Handoff

Status: **OPEN — pending Principal Architect review. NO PUSH. Nothing committed.**
Date: 2026-10-17 (UTC). DEV = Supabase project `electrohub-dev` (`pzxekjybdiulzmssalfo`), read with SELECT only.

> **Disclosure — read first.** The DEV backend running on the owner's workstation reloads on file changes. It picked up this task's
> uncommitted source at about 11:02 UTC (pid 264336, later 274424). Its own recovery worker then applied the new never-confirmed rule to two live
> DEV purchases: it cancelled their Stripe Test Mode intents and marked them `CANCELED / PAYMENT_INCOMPLETE` (§2). I issued no write; the
> application did. The outcome matches the approved policy (nothing was charged, Restore items offered), but it was a shared DEV + Stripe
> Test Mode mutation by unreviewed code. Recommendation: point the watched dev server at a disposable database while Task 03.6 code is uncommitted.

---

## 1. Confirmed root causes, ranked by impact

| # | Root cause | Evidence | Fix |
|---|---|---|---|
| 1 | **Confirmation silently dropped after a slow `/submit`.** After the server accepted Place Order, `place()` continued only if page-wide freshness still held (`isMounted`, setup generation, draft key). A slow submit (8.5–24.1 s in these incidents) gives Cart/quote refetches or navigation time to break that check. The continuation then threw `StalePaymentAttemptResult`, which is swallowed: no `confirmation-started`, no Stripe confirmation, no reconcile, no signal to the server. | All 4 incidents: `/submit` 200, the post-submit Cart/purchases invalidation GETs present, then **no** `confirmation-started` request (a route that is always logged), with the flag ON. Reproduced: "Checkout unmounted before slow submit returned". | **Handoff contract (§6).** Confirmation depends only on *this attempt's secure card form* still being mounted (a per-mount identity). Otherwise the client explicitly **releases** the purchase, and the server ends it race-safely as INCOMPLETE. |
| 2 | **No terminal outcome for a submitted, never-confirmed purchase.** Such a purchase stayed Processing until the 15-minute abandonment rule fired at about 45 minutes. Abandonment was then **hidden** (`ABANDONED`) while its items had already left the Cart, so the customer had no recovery path. | MacBook/Buds2: cancelled `PAYMENT_EXPIRED` at 10:12/10:07 and disappeared; no restore path. | Verified **never-confirmed rule** (10 min, provider read from the same recovery pass, no marker, nothing at Stripe) → `INCOMPLETE`. Every submitted lapse is now `INCOMPLETE` (historical `PAYMENT_EXPIRED` rows included, read-side), visible, with explicit **Restore items**. |
| 3 | **Status page could load indefinitely.** `RestoredPurchase` status reads had no timeout. DEV status reads took up to 8 s, and other requests up to 56 s. | `GET …/:attemptId` 3–8 s; `POST /payment-attempts` 56 s at 10:37. | Bounded read (15 s) → visible "couldn't verify" screen with Try again. A later failed refresh keeps the last-known status. The page never confirms or pays. |
| 4 | **DEV receives no webhooks.** The Stripe listener forwards to a *different* runtime (pid 270904, started 08:32) that is connected to a *different database*. | 11 webhooks today verified and "COMMITTED/NEW" by pid 270904, including the cancellations of `aab01e3a`/`bf43a065`. None are in DEV `stripe_events` (latest 2026-10-10). Its 3 claimed attempts don't exist in DEV. | **Operational, not code:** point `stripe listen --forward-to` at the DEV backend's port and stop the stray runtime. Recovery is safe without webhooks (worker polling resolved every incident). |
| 5 | **Background passes hold leases 4–26 s** (p50 4.3 s / p90 10.6 s / max 26.3 s over 614 passes). This is dominated by remote database round trips (multiple 1–3 s statements per pass) plus Stripe calls. Several dev runtimes also ran concurrently. | §8. | Reduced contention at the source: idle saved checkouts recheck every 60 s instead of 10 s; list reads no longer reconcile unless work is overdue by 30 s or more (§9). Resume no longer applies to never-confirmed purchases, so the resume-vs-lease race is moot for them. The lease length itself is unchanged: it needs DB locality/pooling work (§13). |

**Why the earlier fixes didn't solve it.** They tuned how the symptom was *presented* or *waited out*: the lease-independent label, longer resume/settle waits, the 60 s back-off, and removing Checkout saved. None of them addressed the purchase whose confirmation was never sent. That purchase had no path to a terminal outcome except a hidden 45-minute expiry, so "Processing" was correct-but-endless, and "Check payment status" could only observe it.

## 2. Real DEV purchases — individual outcomes

Provider truth below comes from the **backend's own Stripe reads** (`payment.provider.observed` logs and persisted `providerStatus`). **No direct Stripe-account verification:** the connector reaches `acct_1UEZV83TuYNdQJpp`, but the app's account is `acct_1UEZW5KiVgdl63pN` (§14).

| Purchase | Attempt / Intent | Owner | `/submit` | Confirmation started? | Provider (backend reads) | Current DB (11:30 UTC) | Order / capture | Outcome |
|---|---|---|---|---|---|---|---|---|
| MacBook Air 15 16GB 512GB Space Gray $1,499 | `aab01e3a…` / `pi_3URTtb…` | customer A (redacted) | 8.5 s | No | `requires_payment_method` ×33, then `canceled` | `CANCELED / PAYMENT_EXPIRED` (cancelled 10:12:21 by the pre-change abandonment rule); **dismissed by the customer 11:29:58** | none / none | Incomplete, nothing taken. Shown as "Not completed" via the read-side mapping; the customer dismissed it. |
| Galaxy Buds2 Pro $149 | `bf43a065…` / `pi_3URTmx…` | customer A | 19.1 s | No | `requires_payment_method` ×49, then `canceled` | `CANCELED / PAYMENT_EXPIRED` (10:07:20); **dismissed 11:30:06** | none / none | Same as MacBook. |
| iPad Air 11 M2 1TB Starlight $959 | `5c9261c5…` / `pi_3URV1r…` | customer A | **24.1 s** | No | `requires_payment_method` (10:59:22, 11:02:44), then `canceled` | `CANCELED / PAYMENT_INCOMPLETE` (11:03:04, **new rule via hot-reloaded DEV backend**); **restored 11:28:17**, dismissed 11:28:43 | none / none | Incomplete → **Restore items used by the customer**. Cart now holds exactly 1 × iPad (created 11:28:16), not 2, although `/restore` returned 200 twice (11:28:22, 11:29:07): idempotent. |
| MacBook Air 15 16GB 1TB Starlight $1,619 | `aac568f8…` / `pi_3URV8J…` | **customer B** (a different account) | 11.4 s | No | `requires_payment_method`, then `canceled` | `CANCELED / PAYMENT_INCOMPLETE` (11:02:17, new rule); not dismissed, not restored | none / none | Incomplete. Shown under purchases that didn't complete as "Not completed" with **Restore items** (CART scope). |

For all four: no Order, no capture, no stock mutation from the purchase, no duplicate PaymentIntent, and no work row leased or in error (`DONE`, retry 0, no `lastError`). None of them was ever classified DECLINED.

## 3. Exact mechanism of the lost card confirmation

`CheckoutPage.place()`: validate → remember pointer → `POST /submit` (server commits `submittedAt` and moves the Cart lines out) → `matchesPaymentAttempt` → invalidate Cart/purchases → **`if (!current()) throw StalePaymentAttemptResult`** → announce → `confirmPayment` → reconcile.

The server logs prove execution reached the invalidation (the GETs fire within 1 s of each submit returning) and never reached the announce. `current()` compares `isMounted`, `setupGeneration` and `draftRef.attempt.key`; any of them can change during a 10–25 s submit through navigation, a remount, or Cart/quote refetch effects. Server logs can't tell which component of `current()` failed in each incident. **The fix doesn't depend on it.** The remaining gate is whether the same secure-entry mount is present, which is exactly what is needed to confirm safely.

## 4. Changed files (this pass; all uncommitted)

Backend
- `apps/backend/src/services/payment.domain.ts`: `INCOMPLETE` classification, `INCOMPLETE_FAILURE_CODE`, `NEVER_CONFIRMED_GRACE_MS`, read-side mapping of submitted `PAYMENT_EXPIRED`.
- `apps/backend/src/services/payment.service.ts`:
  - `releaseUnconfirmed()`, the never-confirmed lapse rule, and provider-wins for a release;
  - lapse code `PAYMENT_INCOMPLETE` for submitted attempts;
  - `purchases()`: `restorable`, `pending` excludes INCOMPLETE, overdue-only list reconcile (`POLL_RECONCILE_OVERDUE_MS`), listing of submitted lapses;
  - dismiss allows INCOMPLETE.
- `apps/backend/src/routes/payment.routes.ts`: `POST /api/checkout/payment-attempts/:attemptId/release-unconfirmed`.
- Tests: `payment.service.test.ts`, `payment.confirmation-signal.test.ts`, `payment.purchase-ownership.test.ts`, `payment.classification.test.ts`.

Frontend
- `apps/frontend/src/features/checkout/CheckoutPage.tsx`: handoff contract in `place()`.
- `StripePaymentSession.tsx`: stable per-mount `instance` identity on the handle.
- `confirmationSignal.ts`: `releaseUnconfirmed()`.
- `PaymentPurchases.tsx`: "Not completed" card, `RestorePurchaseItems`, INCOMPLETE dismissible, never a failure toast.
- `PaymentRecovery.tsx`: "Purchase not completed" copy (Restore items already existed).
- `RestoredPurchase.tsx`: bounded status read.
- `types.ts`: `INCOMPLETE`.
- Tests: `CheckoutPage.test.tsx`, `PaymentPurchases.test.tsx`, new `RestoredPurchase.test.tsx`.

Earlier passes in this task (still uncommitted, listed in the investigation report): lease-independent classification, Checkout saved and Continue to payment removed, resume lease wait, announce after validation, fresh read before marker clearance, 60 s idle back-off.

## 5. Customer lifecycle (now)

| Situation | Internal state | Customer sees |
|---|---|---|
| Place Order accepted, confirmation in flight or provider processing | `AWAITING_INPUT`+marker / `PROCESSING` | Processing — "We're confirming this payment with our payment provider." + Check payment status |
| Accepted, confirmation not (yet) started | `AWAITING_INPUT`, no marker | Processing — "Checking the status of this purchase." (at most 10 min) |
| Customer left / announce failed | release → `CANCEL_PENDING` → `CANCELED / PAYMENT_INCOMPLETE` | **Not completed** — "No payment was taken…" + **Restore items** (Cart purchases) + dismiss |
| Client vanished entirely | never-confirmed rule after 10 min (same-pass read, nothing at Stripe) | Not completed + Restore items |
| Bank verification (3DS) pending | `ACTION_REQUIRED` | Processing — extra-verification copy; Check payment status → Try Again opens secure entry |
| 3DS abandoned past lifetime | lapse → `PAYMENT_INCOMPLETE` | Not completed + Restore items |
| Decline | `DECLINED` | Failed payments, one failure toast, Try Again → fresh empty card entry (unchanged) |
| Capture | `PAID` | Card removed, one success toast, Paid Order (unchanged) |
| Provider/worker unknown | `INCIDENT` / work `lastError` | Awaiting confirmation; never cancelled for cleanliness; escalation after 45 min with support reference |

## 6. Handoff contract (submission → confirmation)

1. Place Order captures the secure-entry **instance** (a symbol that is stable for one mounted Payment Element).
2. `/submit` commits. If the response is lost, the existing pointer and recovery path apply.
3. After the response: the same instance is mounted → `confirm(beforeProvider = announce)`. Announce failure → `release-unconfirmed`, and Stripe.js is not called.
4. Instance gone (unmount or remount) → `release-unconfirmed`; **never** confirm in the background.
5. Server `releaseUnconfirmed`: a single guarded `updateMany`. It requires owner, submitted, `AWAITING_INPUT`, **no marker**, no order, no cancel, no failure code, and signal ON. It is idempotent; anything else returns 409.
   - **Race safety with `confirmation-started`:** both are single guarded statements on the same row, and `confirmationStarted` requires `cancelRequested=false`. Exactly one wins.
6. The fenced worker cancels the intent; **a provider authorization wins over a release** (cancel request cleared, the purchase proceeds).
7. Backstop: the never-confirmed rule is evaluated on the locked row (late announcement wins) using the provider read from the same recovery pass. (Corrected 2026-10-17: it does not re-read Stripe; see the isolation/audit handoff.)

## 7. Payment status page

- **Before it loads:** the full-page loader is bounded by a 15 s status read timeout (database-only endpoint).
- **On failure:** "We couldn't verify your payment right now", with Try again and Return to Cart. A failed later refresh keeps the last status shown.
- **Unresolved:** the existing CheckingPayment view, with a bounded 120 s handoff back to Cart. No provider operation blocks rendering; the page never confirms or creates a PaymentIntent (asserted in tests).

## 8. Lock and latency measurements (DEV, before)

- Recovery passes claim→persist: p50 4.3 s, p90 10.6 s, max 26.3 s (614 passes, 2026-10-17).
- `/submit` 8.5–24.1 s; payment setup 12–56 s; restore 18.8–27.3 s; status reads 1–8 s.
- Concurrent runtimes on the same log: up to 2 at once (the main watch-restarting server plus stray pid 270904 on another database).
- **After:** not measured. That needs the changed server running against DEV for a comparable window. The changes reduce pass *frequency* (60 s idle back-off, list reads provider-free while the runner keeps up), not pass *duration*.

## 9. Worker and webhook findings

- The in-process runner rediscovered due work across restarts (pids 267648 → 275164 → 274476 → 265092 → 264336 → 274424) without loss. Every incident row ended `DONE`, retry 0, no `lastError`.
- Webhooks: §1 #4. **Unresolved operational blocker** (owner: environment owner; gate: before any webhook-dependent acceptance).
- List-poll reconciliation now runs only for work overdue by 30 s or more (runner stalled); ordinary reads make no Stripe calls (tested).

## 10. Abandonment and restore

- The restore endpoint pre-existed and enforces ownership, submitted, `CANCELED`, intent `canceled` with nothing received/capturable (re-read from Stripe), no BUY_NOW, no worker lease, Cart line/quantity limits and availability. It is Serializable and idempotent (`restoredAt`) and **adds** to current Cart quantities (Cart B preserved).
- New: a visible "Restore items" action only when `restorable` (INCOMPLETE, CART scope, not yet restored). Never automatic.
- **Real evidence:** iPad `5c9261c5` restored once by the customer through the live UI. The Cart holds exactly one iPad after two 200 responses.

## 11. Tests actually run (this pass)

| Suite | Result |
|---|---|
| Backend `vitest src/services src/routes` | **659 passed**, 55 skipped, 1 failed. The failure is the existing `cart.quantity-correction.integration.test.ts › persists a genuine OOS decrement…` (500 vs 200): it imports no payment code, failed before this task's changes, and the risk is a Cart quantity-correction path. Owner: Cart workstream. |
| Frontend `vitest src/features/checkout` | **247 passed** |
| Playwright `payment-recovery-navigation` (mocked API, Chromium 390px + 1366px) | **14 passed** |
| Typecheck / lint / build (backend + frontend) | all exit 0 |
| `git diff --check` | clean |

New regressions, and the failure each protects against (numbers from the directive's list):
- **(1)(2)(3) slow submit + unmount:** release, no background confirm. The same form still mounted confirms exactly once.
- **(5) confirmation-started never called:** never-confirmed rule; release when announce fails.
- **(6) announce OK, Stripe response lost:** the marker blocks release and the never-confirmed rule; reconciled normally (existing tests).
- **(7)(8) slow lease and resume race:** previous pass; resume is now refused for submitted card entry.
- **(9) `requires_payment_method` without a card:** INCOMPLETE after the grace, not before; not when a PM is attached, declined, or processing.
- **(10) decline after a stale read:** previous pass (fresh read).
- **(12) status page during an outage:** bounded read.
- **(17) Restore after verified abandonment:** card, idempotency, BUY_NOW exclusion, CART_FULL error.
- **Provider authorization beats release.**
- Overdue-only list reconciliation.

**Not reproduced here (unchanged paths, existing coverage or real stack needed):**
- (4) a lost `/submit` response;
- (11) provider authorizes while the DB is down;
- (13) delayed or missing webhooks;
- (14) worker restart, beyond the log evidence in §9;
- (15)(16) concurrent purchases and Checkout B, beyond the 14 mocked browser cases;
- (18) real 3DS.

## 12. Real vs mocked evidence

- **Real (DEV, read-only + logs):** §2 states and transitions, §8 measurements, §9 runner and webhook routing, and the iPad restore idempotency (customer-driven).
- **Real but not authorized as acceptance:** the two never-confirmed cancellations performed by the hot-reloaded DEV backend (see Disclosure).
- **Mocked:** every new unit and component test, and the Playwright suite (mocked API).
- **No new real Stripe acceptance:** the 70/70 budget is exhausted; no PaymentIntents were created by me.

## 13. Risk and blocker register

| Item | Status | Owner / gate |
|---|---|---|
| Lost confirmation after slow submit | **Fixed in source**, unit/component verified; real-browser slow-submit not run | Architect review; real-stack gate below |
| Endless Processing for never-confirmed purchases | **Fixed in source**; real DEV evidence of INCOMPLETE + restore (unauthorized execution, see disclosure) | Architect review |
| Status page endless loader | Fixed (bounded) | — |
| Webhook routing to the wrong runtime/DB | **UNRESOLVED (operational)** | Environment owner; fix before webhook-dependent acceptance |
| Recovery lease duration 4–26 s (remote DB RTT) | **UNRESOLVED**; frequency reduced only | Platform/DB owner: pooling/region; release gate for PROD latency SLO |
| Stray concurrent runtime / watch server on shared DEV | **UNRESOLVED**: caused the unreviewed DEV mutation | Environment owner: disposable DB for uncommitted payment work |
| Confirmation-started flag | ON in DEV (inferred: marker writes) | The release and never-confirmed rules are inert when the flag is OFF (tested) |
| Prisma migration compatibility | No schema change in this pass | — |
| 3DS modal/navigation | Not exercised (real 3DS needs Stripe) | Real-stack acceptance |
| Missing Payment Element on retry | Unchanged; covered by the existing retry tests | — |
| Auth refresh rotation affecting checkout | Not investigated in this pass | Auth workstream |
| Toast dedup | INCOMPLETE never toasts (backend `unread=false`); decline/paid unchanged | — |
| Flaky browser cases | search tests flaked once in a prior full parallel run; checkout suites stable | QA |
| Pre-existing cart quantity-correction failure | Open (§11) | Cart workstream |

## 14. Required external authorizations

1. Stripe connector access to Test Mode account **`acct_1UEZW5KiVgdl63pN`** (read-only), to verify the 4 intents directly.
2. A **bounded real-stack acceptance allowance**, so the new contract can be verified end-to-end. The plan:
   - (a) 1 PaymentIntent: slow submit, stay on the page → PAID.
   - (b) 1 PaymentIntent: slow submit, navigate away → release → INCOMPLETE → Restore.
   - (c) 1 PaymentIntent: decline → Failed → Try Again (Try Again reuses that same intent).
   - Requested ceiling: **3 new Test Mode PaymentIntents**, on a disposable DB.
3. A decision on the routing fix for the DEV Stripe listener (environment owner).

## 15. Recommendation

**Do not close Task 03.6 yet.** The root causes of the endless Processing are identified with real evidence and fixed in source, and the regressions pass. Closure still needs:
- (1) Architect review of the handoff contract and the new `INCOMPLETE` outcome;
- (2) the bounded real-stack acceptance in §14;
- (3) the webhook routing fix;
- (4) acknowledgement of the DEV mutation disclosed at the top.

**NO PUSH.**
