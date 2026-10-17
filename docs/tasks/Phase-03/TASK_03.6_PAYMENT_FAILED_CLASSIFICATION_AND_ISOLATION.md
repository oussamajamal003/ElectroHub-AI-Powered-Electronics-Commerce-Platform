# Task 03.6 — Payment Failed vs Not Completed: Classification Fix and Isolation

Status: **OPEN — pending Principal Architect review. No staging, commit, push or deployment.**
Date 2026-10-17 (UTC). DEV reads were SELECT-only. No Stripe calls, no PaymentIntents, no shared writes by me.

## 1. Root cause of incorrect "Not completed"

**Confirmed code defect (ordering).** In one recovery pass, `PaymentService.process()` evaluated the **cancellation branch**
(`explicitCancellation || lapsedWithoutPayment`) **before** the branch that persists a provider decline. When Stripe already showed a
decline (`requires_payment_method` with `last_payment_error`) in the same pass that a lapse rule or a client release applied, the worker:
1. cancelled the intent, and
2. recorded the purchase as incomplete (`PAYMENT_INCOMPLETE`, shown "Not completed"). Before 2026-10-17 it recorded `PAYMENT_EXPIRED`, which was hidden as "abandoned".

A real decline could therefore end as Not completed or abandoned. Two predicates were affected: `abandonedSubmission` (the legacy 15-minute
lapse) did not exclude declined intents, and a client release (`release-unconfirmed`) was honoured even when Stripe had recorded a decline.

**Wording defect.** "Card confirmation never started" was shown for every incomplete purchase. Historical lapses can't prove that without a
Stripe read, so the wording over-claimed.

**Section defect.** Incomplete purchases were listed under **Failed payments**, mixed with real declines (as in the screenshot).

## 2. Fix

| Change | File |
|---|---|
| `abandonedSubmission` never applies to a declined intent; the decline is persisted as `DECLINED` / `PAYMENT_DECLINED` (Try Again). `neverConfirmedSubmission` already required "nothing recorded at Stripe" (no decline, no payment method). | `apps/backend/src/services/payment.service.ts` |
| A Stripe decline takes precedence over a client release, like an authorization does: the release is cleared and the purchase becomes `DECLINED`. Nothing is cancelled. | same |
| Every provider observation now logs `providerDeclined` and `paymentMethodAttached`, so future classification can be audited from logs. | same |
| A separate **Incomplete purchases** section (neutral badge "Not completed", Restore items when eligible). **Failed payments** holds only real failures (Payment failed + Try Again). | `apps/frontend/src/features/checkout/PaymentPurchases.tsx` |
| Truthful wording: "No payment was taken. This purchase was closed before payment completed." | `PaymentPurchases.tsx`, `PaymentRecovery.tsx` |

Unchanged (from the earlier passes): the slow-submit handoff contract, release only before a confirmation is announced, the bounded status
page, declined → Failed payments → Try Again → fresh empty card entry, and PAID → Order confirmed.

## 3. The three outcomes

| Actual event | Internal state | Customer result | Coverage |
|---|---|---|---|
| Card confirmed and Stripe declines | `DECLINED` / `PAYMENT_DECLINED` | **Payment failed** under Failed payments + Try Again; one failure toast | Existing decline suites, plus new: a decline beats a release; a decline beats the lapse window; a decline after the never-confirmed grace stays a decline |
| Card confirmed and succeeds | `PAID` + Order | **Paid**, Order confirmed; pending card removed; one success toast | Existing PAID suites and the mocked browser PAID transition (unchanged) |
| Confirmation never started, verified no charge | `CANCELED` / `PAYMENT_INCOMPLETE` | **Not completed** under Incomplete purchases + Restore items (Cart scope) | Never-confirmed and release tests (earlier pass); new section test |

Slow `/submit` (20–40 s) and navigation during confirmation:
- Same form still mounted after a slow submit: confirms exactly once.
- Checkout unmounted before the submit returns: release, never a background confirmation.
- A failed confirmation signal: release, Stripe never reached.
- (`CheckoutPage.test.tsx › Place Order handoff after a slow /submit`.)

Status checks are bounded (`RestoredPurchase.test.tsx`).

## 4. Existing affected purchases (read-only; **no record changed**)

| Attempt | Shown as | What is verified | Classification |
|---|---|---|---|
| `327705a5` iPad Air 11 1TB Starlight $959 (the card in the screenshot) | Not completed (now under Incomplete purchases) | `/submit` 33.7 s, then the client released **before** any `confirmation-started` (marker null). The worker read at 11:34:29 was `requires_payment_method`. Whether Stripe showed a decline at that moment was **not logged** (now logged). The release happens before announce, and announce always precedes `stripe.confirmPayment`, so the client cannot have confirmed this card. | Not completed. **Stripe truth NOT VERIFIED**: the connector reaches `acct_1UEZV83TuYNdQJpp`, not the app's `acct_1UEZW5KiVgdl63pN` |
| `5c9261c5` iPad (restored + dismissed by the customer) | — | Never-confirmed rule; no marker | Not completed; Stripe not verified |
| `aac568f8` MacBook Starlight (customer B) | Not completed | Never-confirmed rule; no marker | Not completed; Stripe not verified |
| `aab01e3a`, `bf43a065` and other historical `PAYMENT_EXPIRED` submitted lapses | Not completed (read-side), or dismissed | Lapsed under the **old ordering**, so a decline in the same pass **cannot be ruled out** without Stripe | Shown with neutral wording (no claim about confirmation). **Must not be converted to Payment failed without Stripe verification** |
| `50651527` JBL, `7427db3c` Watch, `e6fe512f`, `6c7b67ac`, `dafe756a` | Payment failed | `DECLINED` / `PAYMENT_DECLINED` | Correct; unchanged |

No existing record was converted. Only the reviewed source changes how future observations are recorded.

## 5. Isolation (proof that development cannot mutate shared DEV)

- **Boundary:** `src/payment-isolation.ts` (previous pass). A shared target is denied under `npm run dev` even with an approval set. A disposable target must be loopback **and** named `electrohub_disposable*`/`electrohub_ci*` in every URL. Every payment-mutation entry point fails closed.
- **Live evidence:** each hot reload of today's edits re-resolved `allowed=false, target=shared, reason=watched-dev-server-on-shared-target` (pid 275852 at 11:44:10; pid 225760 at 12:29:11). Since 12:01 the only payment-claim log lines come from this session's mocked test runs (pids 272448 at 12:49:09 and 263548 at 12:51:01: ~50 ms bursts, redacted fixture ids, exited). There are **zero live claims, Stripe requests or webhook ingestions**.
- **Customer checkouts on the DEV backend are refused:** 2 × `POST /checkout/payment-attempts` → `503 PAYMENT_MUTATIONS_DISABLED`, as designed. The "Saved purchases could not be updated" banner was a transient list-read failure; all list reads since 11:44 returned 200.
- **Contained:** the stray old-code backend 270904 and the Stripe CLI listener (port 5100) are stopped (§9–10 of the isolation/audit handoff).
- **Not done (owner action):** provisioning the disposable PostgreSQL and its own backend and listener. Docker is not installed; a native `postgres.exe` on 127.0.0.1:55432 exists but its database name is unverified.

## 6. Tests

See §7 for the final counts. The new regressions in this pass:
- Backend `payment.service.test.ts`: decline vs release; decline vs lapse window; decline vs never-confirmed grace. Each fails on the old ordering.
- Frontend `PaymentPurchases.test.tsx`: Failed payments vs Incomplete purchases separation, actions and wording.

## 7. Verification results

| Check | Result |
|---|---|
| Backend `vitest src` | **763 passed**, 55 skipped, 1 failed. The failure is the existing, unrelated `cart.quantity-correction.integration.test.ts › persists a genuine OOS decrement…` (500 vs 200; no payment imports) |
| Frontend `vitest src/features/checkout` | **248 passed** |
| Playwright `payment-recovery-navigation` (mocked API, Chromium 390px + 1366px) | **14 passed** |
| Typecheck / lint / build, backend + frontend | all exit 0 |
| `git diff --check` | clean |

## 8. Evidence classes

- **Mocked:** all new unit, component and Playwright tests (Playwright uses a mocked API).
- **Real (read-only):** DEV rows, backend logs, process and network inspection.
- **Not obtained:** direct Stripe verification of any intent (account access), and any new real payment acceptance (70/70 budget exhausted; no new PaymentIntents).

## 9. Blockers and required authorizations

1. Read-only Stripe access to **`acct_1UEZW5KiVgdl63pN`**: needed to verify `327705a5` and the historical `PAYMENT_EXPIRED` lapses before any relabelling.
2. Provision the disposable PostgreSQL plus a dedicated backend whose startup logs `target=disposable`, and a Test Mode listener forwarding only to it.
3. An explicit Test Mode PaymentIntent allowance (suggested ceiling: 3) for real acceptance of decline, success and never-confirmed.
4. Shared DEV and PROD deployments must set `PAYMENT_SHARED_MUTATIONS_APPROVED` to their logged identity (deliberate release gate).
5. Still unattributed: whether the `327705a5` release was the customer leaving or a form teardown. The release `reason` is now logged for the next occurrence.

Task 03.6 remains **OPEN**.
