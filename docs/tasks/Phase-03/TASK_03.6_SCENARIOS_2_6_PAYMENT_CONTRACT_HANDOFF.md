# Task 03.6 — Scenarios 2–6: PAYMENT-owner contract handoff — 2026-10-15

**From:** FRONTEND (Scenarios 2–6). **To:** PAYMENT owner, with a copy to the Principal Architect.

**Status:** decision requested. No backend, contract, pricing or Stripe change was made. The source below was read only.

## 1. Saved-purchase Shipping/Delivery stay read-only during retry: confirm (no change)

`POST /api/checkout/payment-attempts/:id/resume` (`payment.service.ts` `resumeOnce`) reuses the SAME PaymentIntent and returns the stored `attempt.request`. No API amends a submitted attempt's shipping, delivery or amount, and the attempt is an immutable snapshot (AGENT_COORDINATION §7).

The frontend (`SavedPurchaseCheckout`) therefore shows both steps read-only, labelled "kept exactly as it was ordered".

**Recommendation:** keep this as is. Editing would need an owner-approved contract covering:
- re-quote and delivery eligibility;
- a PaymentIntent amount update (or replacement);
- an audit trail;
- idempotency for the amended request.

**Decision needed:** none, unless the product owner wants edits.

## 2. Retry response lacks per-line unit prices: optional

`resumeOnce` returns `items: { name, quantity, imageUrl }`, and the purchases list returns the same shape. The stored `unitPrice` is validated server-side but not exposed.

The UI shows the server-verified purchase total only. Exposing `unitPrice` (read-only, already stored) would let the retry summary and saved-purchase cards show line prices.

**Decision needed:** optional UI improvement. It is low risk, but it changes the API contract and the shared types.

## 3. Delivery-method re-eligibility is not checked by `resume`: RISK DECISION REQUESTED

What the code does today:

- **`resume` checks** `projection.data.canCheckout` and that each item's current product price equals the stored `unitPrice`.
  - The delivery method is only looked up for display: `deliveryMethods.find(…)` returns `delivery: { label, estimate, price } | null`.
  - The shipping cost and `DELIVERY_VERSION` are **not** compared.
- **Order commit after authorization re-derives delivery** (`order.service.ts:194–205`):
  - the cart revision includes `DELIVERY_VERSION` and each method's price/days (`checkout.domain.ts:41`);
  - `deliveryMethods.find(...)` must still succeed, otherwise `CHECKOUT_INVALID_DELIVERY`;
  - `checkoutTotals(...)` must equal the attempt's total and shipping cost, otherwise `CHECKOUT_CHANGED`.

**Consequence.** Suppose a deploy changes delivery pricing, delivery days or the method set (or bumps `DELIVERY_VERSION`) while a declined purchase is still retryable. Then:

1. `resume` succeeds.
2. The customer re-enters the card and authorizes the original amount.
3. The commit then rejects the purchase after authorization.
4. The authorized hold must be released through compensation, and the customer sees a failure only after paying.

Today the methods are a static constant (`DELIVERY_VERSION = '03.5-v1'`), so this needs a configuration/pricing change to occur. It is not reachable in normal operation now.

**Options (PAYMENT decides):**

- **A (recommended, small):** in `resumeOnce`, also require the stored delivery method to exist, with the same price as the stored `shippingCost`, and an unchanged `DELIVERY_VERSION`. Otherwise refuse with `409 CHECKOUT_CHANGED` before any confirmation. The frontend already handles a 4xx refusal as "This purchase can't be paid again right now"; no frontend change is needed.
- **B:** accept the risk for now, and add a release-checklist rule: drain or expire retryable declined attempts before changing delivery pricing.
- **C:** a full re-quote and amount-update contract (larger; see §1).

**Do not** implement re-pricing or an amount update under this task. Any backend change needs separate PAYMENT and Architect approval, plus tests for the refusal path. Real-Stripe verification needs separate authorization.

## Not changed / not verified

- No backend, Prisma, AUTH or Stripe operation.
- The analysis is source-level only; it was not executed against a database or Stripe.
- The frontend refusal handling is covered by the existing intercepted tests ("can't be paid again right now").
