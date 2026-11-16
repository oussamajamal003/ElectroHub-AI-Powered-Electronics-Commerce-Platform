# Customer Order Management (Task 03.7)

Read-only customer management of Orders created by the 03.5 Checkout core and the 03.6 Stripe orchestration. No Order, Payment, Inventory or Cart writes are reachable from these routes. No customer cancellation, refund, reorder, tracking, email, or invoice action is implemented here.

## Routes

| Route | Purpose |
| --- | --- |
| `/orders` | My Orders: paginated history. `?page=N` is the bookmarkable page; invalid values normalize to 1. |
| `/orders/:orderReference` | Order Details: deep-linkable and refresh-safe, needs no checkout state. |
| `/checkout/confirmation/:orderReference` | Unchanged 03.5/03.6 confirmation. Its actions now sit outside the card: **View Order Details** → `/orders/:orderReference`, then **Continue Shopping** → `/products`. |

Header, Footer and Account entries all point to `/orders`. Guests see the existing sign-in card. While the session is still being verified, the pages show a loader and make no private request.

## API contract

Both endpoints sit behind `requireAuth` + `requireRole('CUSTOMER')` and send `Cache-Control: no-store`. The owner always comes from the verified token and is never taken from the client.

### `GET /api/orders?page=1&pageSize=10`
- The bounds are unchanged (`order.validator.ts`): `page` is 1–1000, `pageSize` is 1–50, both are strict positive integers, and unknown or repeated parameters return 400.
- The `where: { userId }` predicate applies to both `findMany` and `count`. Results are ordered by `createdAt DESC, id DESC`.
- Response: `{ data: OrderSummary[], meta: { page, pageSize, total, totalPages } }`. `total` counts Orders. A valid out-of-range page returns `data: []` with truthful metadata.
- `OrderSummary` is the existing Confirmation projection plus `itemCount`, which is the **sum of quantities**. This is a compatible addition: no field was removed.

### `GET /api/orders/:orderReference`
- The reference is `ORD-<UUID>`. The prefix is case-insensitive, and a bare UUID is accepted for legacy links. The length limit is 40. A malformed reference returns `400 ORDER_REFERENCE_INVALID` and makes no query.
- The lookup is a single `findFirst({ where: { id, userId } })`. An unknown Order and another customer's Order both return the same `404 ORDER_NOT_FOUND`.
- `OrderDetails` = `OrderSummary` + `items[].id` (stable line identity) + `payment: { paidAt, refundedAt } | null`.
- The allowlist never serializes `providerPaymentId`, `failureReason`, `checkoutRequestHash`, `checkoutAttemptId`, `userId`, or coordinates.

Money values are fixed-2 decimal strings, formatted for display only. Delivery estimates are UTC-midnight business dates and are formatted in UTC. Every value is a purchase-time snapshot from `Order`/`OrderItem`; current Product or Profile data is never read.

The existing `/api/orders/:ref/confirmation`, `/api/orders/attempts/:id/confirmation` and `POST /api/orders` (409 `PAYMENT_REQUIRED`) endpoints are unchanged.

## Status presentation (`features/orders/presentation.ts`)

| Stored `Order.status` | Badge | | Payment projection | Badge |
| --- | --- | --- | --- | --- |
| `CONFIRMED` | Confirmed | | `UNPROCESSED` (no Payment row) | Not processed |
| `PREPARING` | Preparing | | `PENDING` (PENDING/PROCESSING) | Pending |
| `OUT_FOR_DELIVERY` | Out for Delivery | | `PAID` (SUCCEEDED) | Paid |
| `DELIVERED` | Delivered | | `FAILED` | Failed |
| `CANCELLED` | Cancelled | | `REFUNDED` | Refunded |
| `AWAITING_CAPTURE` | Finalizing your order | | anything else | Status unavailable |
| anything else | Status unavailable | | | |

- The two badges are always independent.
- "Total paid" and "Paid with …" appear only for `PAID`. Other states use "Order total" and "Card: …".
- Non-normal states get a neutral note, for example "Please do not pay again" for awaiting capture or pending.
- The shared `OrderStatus` and `PaymentStatus` primitives keep their legacy keys. They are not live regions: each one carries a visually hidden "Order status:" or "Payment status:" prefix, so many badges never flood announcements.

## Client state

- **Query keys:** `queryKeys.orders.list(userId, page, pageSize)` and `queryKeys.orders.detail(userId, reference)`, both under the `['orders']` prefix. The existing 03.6 invalidation and the `queryClient.clear()` on logout still apply.
- **Placeholder data:** the previous page stays visible, marked `aria-busy` and dimmed, but only for the same user.
- **Request lifecycle:** requests are abortable, and page changes use React Query keys, so a stale page response never replaces the selected page.
- **Loading vs empty:** a loading or failed request never shows the empty state or a zero count. The centered empty panel appears only after a settled `total === 0` response. An out-of-range page with `total > 0` shows a "Go to page N" notice instead.
- **Detail errors:** a 404 or 400 shows the safe "Order not found" state with no retry. A network or 5xx error shows a Retry button. If a background refresh fails, the loaded content stays and a separate Retry notice appears.
- **Back to Orders:** it returns to `?page=N` from the list's navigation state. When the page was opened directly, it falls back to `/orders`.

## Screenshot classification

| Approved and matched | Required refinements made | Omitted (future or prototype) |
| --- | --- | --- |
| Shell, breadcrumbs, heading + count, wide bordered cards, badges top-right, preview, divider, Date/Total/Items + chevron, Back to Account; 2fr/1fr details with aligned tops; Items/Address left, Summary + Back to Orders right; confirmation actions outside the card at card width | Real full UUID references; canonical labels (not "Processing"); truthful payment states; centered empty state; loading/error/not-found states; pagination; responsive wrapping; long and multi-item content; keyboard focus | Track Delivery and tracking number (Phase 04: no functioning owned route), map, admin controls, invoices, refund/cancel, Make Customer/Admin/Flows/Components switcher |

## Database

No migration is needed (Case A). The existing `Order`, `OrderItem` and `Payment` models, the `OrderStatus` and `PaymentStatus` enums, and the `[userId, createdAt]` index cover the contract.

## Future handoffs

These are not implemented here. They should reuse the public reference, the owner-scoped reads and the snapshot DTO:
- **03.8:** email "Order Details Link" → `/orders/:ref`.
- **03.9:** invoice and receipt PDFs from the same allowlisted snapshot.
- **Phase 04:** tracking route and button on Order Details.
- **05.4:** admin status transitions. These must keep the capture gating and must not add customer mutations.
