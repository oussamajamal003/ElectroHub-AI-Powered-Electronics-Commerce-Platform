# Task 03.5 — implemented Checkout and Order core

## Boundary and unpaid semantics

Authenticated customers complete Shipping → Delivery → Payment Method → Review → Processing → persisted Confirmation. Controlled React forms reuse Input/Button and existing design tokens. Processing uses ElectroHubLoader. `CONFIRMED` means the Order was received, **not paid**. Card is the selected method only; no PAN, CVV, expiry or fabricated last-four is collected. No Payment or tracking Delivery record, provider request, email, PDF or management screen is created.

## API and authority

All endpoints use existing authenticated CUSTOMER middleware. The server derives ownership; the client never submits customer IDs, prices, totals, Inventory or status claims.

| Endpoint | Contract |
| --- | --- |
| `GET /api/checkout` | `data` contains `cartRevision`, eligibility/blockers, subtotal and all delivery options with calculated totals. |
| `POST /api/orders` | Required UUID `Idempotency-Key`; strict body is `{ shipping, deliveryMethod, paymentMethod: "CARD", expectedRevision }`. First commit 201, compatible replay 200. Returns persisted Confirmation and current authoritative Cart. |
| `GET /api/orders/:orderReference/confirmation` | Minimal persisted snapshots, owner scoped; sanitized 404 for ownership misses. |
| `GET /api/orders/attempts/:attemptId/confirmation` | Owner-scoped recovery when the submission outcome is unknown. |

Success uses `{ data: ... }`; checkout validation/business failures preserve `{ error: { code, message } }`. Invalid input is 400; stock/price/idempotency conflicts are 409. Existing shared authentication middleware retains its existing 401/403 behavior. POST is rate limited. A public reference is `ORD-` plus the server-generated Order UUID; there is no separate reference column.

Shipping is trimmed and server validated: recipient 2–200, street 2–255, city 2–100, postal code 1–20, country 2–100, phone ≤32 characters with 7–15 digits and common international punctuation. Optional line2/state are bounded by 255/100. Unknown body/Shipping keys are rejected.

| Server delivery method | USD charge | Estimate |
| --- | --- | --- |
| STANDARD | 0.00 | 5–7 business days |
| EXPRESS | 9.99 | 2–3 business days |
| OVERNIGHT | 19.99 | Next business day |

Amounts use Prisma Decimal and existing Decimal(12,2) precision. Estimates are UTC calendar dates skipping weekends; holidays and cutoff times are not guaranteed. Cart's economic `revision` hashes Cart identity, sorted product IDs/quantities/current prices and actual delivery configuration. Inventory changes alone do not change the economic revision; stock is independently revalidated.

## Atomicity, locks and idempotency

One bounded serializable Prisma transaction locks the owner's Cart row, rechecks the attempt, acquires Product/category read locks and Inventory write locks in sorted ID order, validates current lines and economic revision, creates Order/OrderItem snapshots, calls existing `InventoryService.decreaseStock` with the same transaction client, and clears Cart items. Any failure rolls back all four effects. No external request happens within this transaction. Product hydration is bulk and images are bounded to one per line.

Cart add/update/remove/reconcile acquire the same Cart-row lock. Existing positive quantity/ownership checks and OOS strict decrement correction remain intact. Cart and Wishlist intent never reserve stock. Only committed checkout decrements Inventory.

Unique `(userId, checkoutAttemptId)` and a canonical normalized request hash protect retries. A committed matching attempt returns the same snapshots without consuming stock again; a different body for that attempt returns `IDEMPOTENCY_CONFLICT`. Different keys cannot purchase one Cart twice. Serialization retries are bounded and do not retry arbitrary failures.

## Frontend state and recovery

CartProvider remains the sole Cart authority. Checkout quote/confirmation query keys include verified user identity. Cached identity is insufficient to authorize checkout reads. Step URLs are `/checkout?step=shipping|delivery|payment|review`; future links return to the first missing prerequisite. Back/history and Edit preserve draft values.

The identity-scoped session draft contains Shipping, delivery, completion flags, Card method type inside a submitted request, and an immutable submission attempt. No Product records or raw payment data are persisted. Drafts clear on success/identity transition. A saved attempt is checked before empty-Cart handling on reload; unknown network/5xx outcomes retain the exact key and request, with explicit same-key retry. Confirmed business rejection preserves editable fields and allows a newly reviewed attempt.

Changing steps or delivery does not refetch quote options. All delivery totals are returned together. Background revalidation preserves usable Cart/draft content and disables purchase when totals/availability are unconfirmed. Purchase uses CartProvider's mutation queue, cancels old Cart reads and installs the committed Cart response before navigation so stale responses cannot resurrect purchased rows.

## Schema and deployment

Forward migration `20261006000000_checkout_core` adds attempt/hash, delivery/method, phone and UTC delivery-date snapshots to Order, nullable image snapshot to OrderItem, owner/attempt uniqueness and positive quantity/nonnegative money CHECKs. It stops if historical Orders require backfill. Existing Decimal precision, FKs and delete restrictions are retained. Historical migrations and ledger entries are not rewritten.

The exact deployment and live/visual verification results are recorded in [implementation evidence](../tasks/Phase-03/TASK_03.5_IMPLEMENTATION_EVIDENCE.md). Local skips, intercepted UI tests and real authenticated DEV proofs are distinct evidence categories.

## Task 03.6 handoff

Mount the future provider UI in the existing Payment shell. These Orders are unpaid. Reuse Order identity, amounts, request idempotency and the atomic purchase boundary. Payment success must be server verified; a redirect is not proof. Do not put Stripe/PayPal/network calls inside the PostgreSQL transaction or rebuild Order/Inventory core. Payment failures/cancellation/refund policy require their own approved orchestration.

## Task 03.7 handoff

Reuse persisted name/SKU/price/image snapshots, `ORD-<UUID>`, ownership, totals, delivery dates and the Confirmation DTO. Do not recompute historical prices from current Products. Management lists/details, status updates, tracking, documents and emails remain future scope; Confirmation offers only Continue Shopping.

## Verification commands

From backend: `npm run test -- src/routes/checkout.routes.test.ts src/services/__tests__/checkout.domain.test.ts`; opt-in real DEV gate: `CHECKOUT_LIVE_DEV=true npm run test -- src/services/__tests__/checkout.live.test.ts` (PowerShell sets this variable with `$env:`). The live suite checks the exact DEV target before writes and cleans only its labeled fixtures. Never opt in against PROD.

From frontend: focused checkout/Cart tests, `npx playwright test -c playwright.checkout.config.ts`, and `npx playwright test -c playwright.cart-storybook.config.ts checkout.stories.spec.ts`. UI interception is labeled explicitly and does not replace live database proof.
