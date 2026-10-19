# PDF Documents (Task 03.9)

Signed-in customers can view and download three PDFs for their own orders: an **Order invoice (non-tax)**, a **Payment receipt** and an **Order summary**. The documents appear in Order Confirmation, Order Details and the My Orders **Documents** chooser.

- The specification is [TASK_03.9_PDF_DOCUMENTS.md](../tasks/Phase-03/TASK_03.9_PDF_DOCUMENTS.md).
- The evidence is [TASK_03.9_IMPLEMENTATION_EVIDENCE.md](../tasks/Phase-03/TASK_03.9_IMPLEMENTATION_EVIDENCE.md).

## Policy: `COMMERCIAL_V1`

**Invoice**
- PDF title: *Order invoice — commercial transaction statement*.
- A prominent first-page qualifier says **Not a tax invoice**.
- The UI label is *Order invoice (non-tax)*.
- It does not invent any of the following:
  - seller registration;
  - VAT rate or tax row;
  - billing identity ("Ship to", never "Bill to");
  - sequential invoice number.
- The order reference is a reference, not a legal number.

**Receipt**
- It records the original successful payment: amount, the recorded `paidAt` (labelled as a confirmation time, not bank settlement), and the card brand and last four only when both are stored.
- A later refund is disclosed separately. The original amount and date are never changed.

**Summary**
- It is an order record, "not an invoice or proof of payment".
- It shows the actual fulfilment state and payment state (pending, not recorded, failed, refunded, unverified).

**Test mode**
- Every output carries **TEST TRANSACTION — no live payment** (this deployment is Stripe Test Mode).
- A live or mixed rollout needs per-record provenance. See the specification, §5.1 and §6.2.

## Eligibility

There is one domain function, `evaluateDocuments`, in `apps/backend/src/services/order-document.domain.ts`. Listing and rendering both use it.

| Stored situation | Invoice / receipt | Summary |
|---|---|---|
| Valid snapshot and proven payment: Payment `SUCCEEDED`, valid `paidAt`, amount and currency equal the order, Stripe binding present, linked attempt `PAID` when it exists | Available | Available ("Paid") |
| Payment `PENDING` / `PROCESSING` | `PAYMENT_NOT_CONFIRMED` | Available ("Payment pending — not proof of payment") |
| No Payment row (legacy) | `PAYMENT_NOT_CONFIRMED` | Available ("Payment not recorded") |
| Payment `FAILED` | `PAYMENT_NOT_CONFIRMED` | Available ("Payment not completed") |
| Paid, then cancelled | Available, with a cancellation note ("not a refund") | Available |
| `REFUNDED` with retained `paidAt` and `refundedAt` | Available, original facts plus a refund note | Available |
| `REFUNDED` without `paidAt` | `HISTORICAL_PAYMENT_UNVERIFIED` | Available ("Refund recorded — original payment not verified") |
| Contradictory payment facts: amount, currency, attempt state/identity/amount, dates | `DATA_INCONSISTENT` / `DATA_INCOMPLETE` | Available ("Payment details unavailable") |
| Invalid snapshot: 0 or >100 lines, line/subtotal/total mismatch, non-USD, missing address | Same reason for all three | Unavailable |

Rules for the refund amount:
- It is printed only from a bound, persisted successful refund (attempt `REFUNDED` with a `refundId` and `refundAmountCents` no greater than the original amount).
- Otherwise the document says "Refund recorded" and omits the amount.

## API

All document routes use the existing bearer JWT and `CUSTOMER` role. Ownership is a single query predicate, `findFirst({ id, userId })`, so an unknown order and another customer's order return the same `404 ORDER_NOT_FOUND`.

| Route | Result |
|---|---|
| `GET /api/orders/:orderReference/documents` | `{ data: { orderReference, documents: [invoice, receipt, summary] } }`. Metadata only. Rate limit: 60 per user per 5 min. |
| `GET /api/orders/:orderReference/documents/:kind?disposition=attachment\|inline` | The complete PDF. Default disposition is `attachment`. Rate limit: 20 per user per 5 min, plus one generation in flight per user per process. |

**Every response is private:**
- `Cache-Control: private, no-store, max-age=0`
- `Pragma: no-cache`
- `nosniff`
- `Referrer-Policy: no-referrer`
- No ETag, no 304, no ranges. A `Range` header is ignored and the full PDF is returned.

**PDF responses also carry:**
- `Content-Type: application/pdf`
- `Content-Disposition: <disposition>; filename="ElectroHub-ORD-…-<kind>.pdf"; filename*=UTF-8''…`
- An exact `Content-Length`
- `X-Document-Version`

**Errors** use the existing `{error:{code,message}}` envelope:

| Status | Code(s) |
|---|---|
| 400 | `ORDER_REFERENCE_INVALID`, `DOCUMENT_REQUEST_INVALID` |
| 405 | `METHOD_NOT_ALLOWED` (`Allow: GET`; HEAD never renders) |
| 409 | `DOCUMENT_NOT_AVAILABLE` |
| 422 | `DOCUMENT_DATA_INVALID`, `DOCUMENT_LIMIT_EXCEEDED` |
| 429 | `RATE_LIMITED` |
| 500 | `DOCUMENT_GENERATION_FAILED` |
| 503 | `DOCUMENTS_UNAVAILABLE`, `DOCUMENT_GENERATION_TIMEOUT` |

Example metadata entry:

```json
{ "kind": "receipt", "label": "Payment receipt", "description": "Confirms the card payment recorded for this order.",
  "availability": "UNAVAILABLE", "reasonCode": "PAYMENT_NOT_CONFIRMED", "mediaType": "application/pdf", "filename": null,
  "contentVersion": null, "templateVersion": "commercial-template-1.0.0", "policy": "COMMERCIAL_V1", "issuedAt": null,
  "purchaseDate": "2026-10-19T12:00:00.000Z", "paidAt": null, "previewPath": null, "downloadPath": null }
```

## Rendering and runtime

**Generation**
- Documents are generated on demand, with no schema change and no stored PDFs.
- Snapshot → PDF goes through a bounded pool of worker threads (`apps/backend/src/documents/`).

**Pool limits**

| Setting | Value |
|---|---|
| Workers per process | 2 |
| Queue | 8 |
| Hard render deadline | 10 s, enforced by terminating the worker |
| Request budget | 15 s |
| Output size | ≤5 MiB |
| Pages | ≤30 |
| Items | ≤100 |
| Canonical input | ≤256 KiB |

**Library and text handling**
- PDFKit `0.20.2`, fontkit `2.0.4` and bidi-js `1.1.0` are pinned exactly.
- Text is selectable and embedded.
- Arabic and RTL text is ordered with UAX #9 (L2). Mixed-direction lines carry `ActualText` for copy and search.
- An uncovered glyph fails closed with `422`.
- PDF metadata and file IDs come from source dates, so identical inputs give identical bytes.

**Fonts**
- The fonts live in `apps/backend/assets/documents/fonts/`, all under the SIL OFL 1.1 with license texts alongside:
  - Poppins 400/500/600;
  - Noto Sans 400/600;
  - Noto Sans Arabic 400/600.
- Their SHA-256 values are pinned in `assets.ts` and checked every time a worker starts.
- The Dockerfile copies `apps/backend/assets` into the runtime image.
- Missing or corrupt fonts turn the feature into `DOCUMENTS_UNAVAILABLE`. Checkout and order reads are unaffected.
- No font, image or network asset is ever fetched at runtime.

**Switches and logs**
- `DOCUMENTS_ENABLED=false` disables document generation. Metadata then reports `DOCUMENTS_UNAVAILABLE`.
- Structured logs: `document_metadata_read`, `document_render_started`, `document_render_completed`, `document_render_failed`, `document_request_cancelled`, `document_limit_rejected`. Logs carry no names, addresses, emails, card data or PDF bytes.

## Frontend

**Data and transport**
- `apiBinary` in `src/lib/api.ts` uses the same bearer token and single-refresh transport as `apiClient`.
- It validates the response: `application/pdf`, non-empty, no larger than 5 MiB as streamed, complete against `Content-Length`, and starting with `%PDF-`.
- Metadata is cached under `queryKeys.orders.documents(userId, reference)`. PDF bytes are never cached.

**Preview and download**
- Preview shows the returned PDF in a Radix dialog via a blob URL.
- Browsers without an inline PDF viewer get a fallback that downloads the same bytes, with no second request.
- Download announces "PDF download started". It never claims the file was saved.

**Account and order changes**
- Logout, an account switch or an order change aborts in-flight requests.
- Late responses are dropped before any URL is created.
- Private URLs are revoked.

**My Orders**
- The **Documents** button is a sibling of the card link, stacked above the link's overlay.
- Its metadata loads only when the chooser opens.

## Optional email attachments

**DEFERRED / OFF.** Attachments would require changing the Task 03.8 producer/dispatcher and Brevo payload (protected EMAIL/PAYMENT ownership) and a new immutable event descriptor version. Customer downloads do not depend on them (see the specification, §12).

## Rollback

1. Set `DOCUMENTS_ENABLED=false`, or revert the routes and UI.
2. No data migration is needed, and orders, payments and email are untouched.

Already downloaded files cannot be revoked.
