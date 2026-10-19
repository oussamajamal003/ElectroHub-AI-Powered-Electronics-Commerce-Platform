/** Task 03.9 `GET /api/orders/:orderReference/documents` contract (server-controlled copy; no PDF bytes, no internal facts). */
export type DocumentKind = 'invoice' | 'receipt' | 'summary';
export type DocumentUnavailableReason =
  | 'PAYMENT_NOT_CONFIRMED' | 'HISTORICAL_PAYMENT_UNVERIFIED' | 'DATA_INCOMPLETE' | 'DATA_INCONSISTENT'
  | 'UNSUPPORTED_CURRENCY' | 'DOCUMENT_TOO_LARGE' | 'DOCUMENTS_UNAVAILABLE';

export interface OrderDocumentEntry {
  kind: DocumentKind;
  label: string;
  description: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  reasonCode: DocumentUnavailableReason | null;
  mediaType: 'application/pdf';
  filename: string | null;
  contentVersion: string | null;
  templateVersion: string;
  policy: 'COMMERCIAL_V1';
  issuedAt: null;
  purchaseDate: string;
  paidAt: string | null;
  previewPath: string | null;
  downloadPath: string | null;
}

export interface OrderDocumentsDto { orderReference: string; documents: OrderDocumentEntry[] }

/** Unknown future reason codes fall back to a neutral message (never "payment failed"). */
export const UNAVAILABLE_COPY: Record<DocumentUnavailableReason, string> = {
  PAYMENT_NOT_CONFIRMED: 'Available after a successful payment is recorded for this order.',
  HISTORICAL_PAYMENT_UNVERIFIED: 'The original payment for this order can’t be verified, so this document isn’t issued.',
  DATA_INCOMPLETE: 'This document can’t be generated from the recorded order details.',
  DATA_INCONSISTENT: 'This document can’t be generated from the recorded order details.',
  UNSUPPORTED_CURRENCY: 'Documents aren’t available for this order’s currency.',
  DOCUMENT_TOO_LARGE: 'This order is too large to generate as a document.',
  DOCUMENTS_UNAVAILABLE: 'Documents are temporarily unavailable. Please try again later.',
};
export const unavailableCopy = (reason: string | null) =>
  (reason && reason in UNAVAILABLE_COPY ? UNAVAILABLE_COPY[reason as DocumentUnavailableReason] : 'This document isn’t available for this order.');
