/**
 * Task 03.9 — the allowlisted rendering model. The renderer (and its worker thread) only ever receives a validated
 * DocumentSnapshotV1: plain strings/numbers/booleans built from committed Order/OrderItem/Payment facts. Never Prisma rows,
 * HTML, URLs, filesystem paths or browser-supplied values.
 */
export const DOCUMENT_KINDS = ['invoice', 'receipt', 'summary'] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];
export type DocumentDisposition = 'inline' | 'attachment';

export const DOCUMENT_POLICY = 'COMMERCIAL_V1' as const;
export const SNAPSHOT_VERSION = 1 as const;
/** Bump when the visual template changes; old bytes are not retrievable in on-demand mode (§6.1). */
export const TEMPLATE_VERSION = 'commercial-template-1.0.0';
/** Brand-only seller profile: no registered legal entity, address, phone or tax number is asserted. */
export const SELLER_PROFILE_VERSION = 'electrohub-brand-1';

export const DOCUMENT_LIMITS = {
  maxItems: 100,
  maxCanonicalBytes: 256 * 1024,
  maxPdfBytes: 5 * 1024 * 1024,
  maxPages: 30,
  renderDeadlineMs: 10_000,
} as const;

export type UnavailableReason =
  | 'PAYMENT_NOT_CONFIRMED' | 'HISTORICAL_PAYMENT_UNVERIFIED'
  | 'DATA_INCOMPLETE' | 'DATA_INCONSISTENT' | 'UNSUPPORTED_CURRENCY'
  | 'DOCUMENT_TOO_LARGE' | 'DOCUMENTS_UNAVAILABLE';

/** Customer-facing payment situation printed on the documents. Never derived from a client value. */
export type PaymentEvidence =
  | 'VERIFIED'          // V + P: original successful payment proven
  | 'PENDING'           // authorization / processing, not proof of payment
  | 'NOT_RECORDED'      // legacy order without a Payment row
  | 'FAILED'            // declined / cancelled before success
  | 'REFUND_UNVERIFIED' // REFUNDED without original success evidence
  | 'UNAVAILABLE';      // contradictory or incomplete payment facts

export interface DocumentLineV1 {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: string; // exact 2-decimal string
  lineTotal: string;
}

export interface DocumentSnapshotV1 {
  version: typeof SNAPSHOT_VERSION;
  kind: DocumentKind;
  policy: typeof DOCUMENT_POLICY;
  templateVersion: string;
  assetVersion: string;
  sellerProfileVersion: string;
  /** This deployment only processes Stripe Test Mode payments (§5.1); printed on every output. */
  testTransaction: boolean;
  orderReference: string;
  purchaseDate: string;          // ISO UTC instant (Order.createdAt)
  fulfillmentStatus: string;     // stored OrderStatus
  currency: 'USD';
  items: DocumentLineV1[];       // empty for the receipt
  subtotal: string;
  shipping: string;
  total: string;
  delivery: { method: string; estimateStart: string; estimateEnd: string } | null; // date-only YYYY-MM-DD
  shipTo: { recipient: string; lines: string[] } | null;
  payment: {
    evidence: PaymentEvidence;
    paidAt: string | null;       // proven original paidAt only
    amount: string | null;       // proven original amount only
    receiptReference: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
  };
  annotation: { cancelled: boolean; refundedAt: string | null; refundAmount: string | null };
}

export interface RenderedPdf {
  bytes: Buffer;
  byteLength: number;
  pageCount: number;
  contentVersion: string;
  filename: string;
  mediaType: 'application/pdf';
}
