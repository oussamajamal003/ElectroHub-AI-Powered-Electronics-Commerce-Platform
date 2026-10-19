import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logSafely } from '../utils/logger.js';
import { ASSET_VERSION, documentAssetsReady } from '../documents/assets.js';
import { DOCUMENT_LIMITS, DOCUMENT_POLICY, TEMPLATE_VERSION, type DocumentKind, type RenderedPdf, type UnavailableReason } from '../documents/document.types.js';
import { RenderError, RenderPool } from '../documents/render-pool.js';
import { canonicalReference, documentFilename, evaluateDocuments, type DocumentSourceOrder } from './order-document.domain.js';
import { parseOrderReference } from './order.service.js';

/**
 * Task 03.9 customer documents. Every public call is owner-scoped (authenticated userId + parsed Order id in one query), read-only
 * (no payment, cart, inventory, outbox or mail dependency is even reachable from here) and re-evaluates eligibility from committed
 * facts. Rendering starts only after the database read has returned and its connection is released.
 */
export const DOCUMENT_ENTRY_COPY: Record<DocumentKind, { label: string; description: string }> = {
  invoice: { label: 'Order invoice (non-tax)', description: 'Itemized commercial statement of your purchase. Not a tax invoice.' },
  receipt: { label: 'Payment receipt', description: 'Confirms the card payment recorded for this order.' },
  summary: { label: 'Order summary', description: 'Order record with items, delivery and current status. Not proof of payment.' },
};

export interface OrderDocumentEntry {
  kind: DocumentKind;
  label: string;
  description: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  reasonCode: UnavailableReason | null;
  mediaType: 'application/pdf';
  filename: string | null;
  contentVersion: string | null;
  templateVersion: string;
  policy: typeof DOCUMENT_POLICY;
  issuedAt: null;
  purchaseDate: string;
  paidAt: string | null;
  previewPath: string | null;
  downloadPath: string | null;
}
export interface OrderDocumentsDto { orderReference: string; documents: OrderDocumentEntry[] }

/** Allowlisted columns only: no request hash, provider secrets, work state, email payloads, phone or coordinates. */
const documentSelect = {
  id: true, userId: true, status: true, currency: true, subtotal: true, shippingCost: true, total: true, createdAt: true,
  deliveryMethod: true, estimatedDeliveryStart: true, estimatedDeliveryEnd: true, shippingRecipient: true, shippingLine1: true,
  shippingLine2: true, shippingCity: true, shippingState: true, shippingPostalCode: true, shippingCountry: true,
  // One extra row detects an over-limit order without loading an unbounded relation.
  items: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], take: DOCUMENT_LIMITS.maxItems + 1,
    select: { id: true, productName: true, sku: true, unitPrice: true, quantity: true, lineTotal: true, createdAt: true } },
  payment: { select: { id: true, provider: true, providerPaymentId: true, status: true, amount: true, currency: true, paidAt: true,
    cardBrand: true, cardLast4: true, refundedAt: true } },
  paymentAttempt: { select: { userId: true, providerIntentId: true, amountCents: true, currency: true, total: true, state: true,
    refundId: true, refundAmountCents: true } },
};

export const documentsEnabled = () => process.env.DOCUMENTS_ENABLED !== 'false';

let sharedPool: RenderPool | null = null;
const defaultPool = () => (sharedPool ??= new RenderPool());

const unavailable = () => new AppError('Documents are temporarily unavailable. Your order is not affected.', 503, 'DOCUMENTS_UNAVAILABLE');

export class OrderDocumentService {
  /** Principals with a generation in flight (one per customer per process; preview and download share the budget). */
  private readonly active = new Set<string>();

  constructor(private readonly database: PrismaClient = prisma, private readonly pool: () => RenderPool = defaultPool,
    private readonly ready: () => boolean = () => documentsEnabled() && documentAssetsReady()) {}

  /** One SQL statement (relationJoins) gives a coherent Order + items + Payment + Attempt view under concurrent refunds. */
  private async read(userId: string, reference: string): Promise<DocumentSourceOrder> {
    const order = await this.database.order.findFirst({ where: { id: parseOrderReference(reference), userId }, select: documentSelect,
      relationLoadStrategy: 'join' });
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    return order as DocumentSourceOrder;
  }

  async list(userId: string, reference: string): Promise<OrderDocumentsDto> {
    const order = await this.read(userId, reference);
    const orderReference = canonicalReference(order.id);
    const enabled = this.ready();
    const decisions = evaluateDocuments(order, ASSET_VERSION);
    logSafely('info', 'Document metadata read.', { event: 'document_metadata_read', orderId: order.id,
      available: decisions.filter(entry => enabled && entry.available).map(entry => entry.kind) });
    return { orderReference, documents: decisions.map(decision => {
      const available = enabled && decision.available;
      const path = `/api/orders/${orderReference}/documents/${decision.kind}`;
      return {
        kind: decision.kind, ...DOCUMENT_ENTRY_COPY[decision.kind], availability: available ? 'AVAILABLE' : 'UNAVAILABLE',
        reasonCode: available ? null : enabled ? decision.reason : 'DOCUMENTS_UNAVAILABLE', mediaType: 'application/pdf',
        filename: available ? documentFilename(orderReference, decision.kind) : null, contentVersion: available ? decision.contentVersion : null,
        templateVersion: TEMPLATE_VERSION, policy: DOCUMENT_POLICY, issuedAt: null, purchaseDate: order.createdAt.toISOString(),
        paidAt: decision.snapshot?.payment.evidence === 'VERIFIED' ? decision.snapshot.payment.paidAt : null,
        previewPath: available ? `${path}?disposition=inline` : null, downloadPath: available ? `${path}?disposition=attachment` : null,
      } satisfies OrderDocumentEntry;
    }) };
  }

  async render(userId: string, reference: string, kind: DocumentKind, signal: AbortSignal): Promise<RenderedPdf> {
    const order = await this.read(userId, reference);
    if (!this.ready()) throw unavailable();
    const decision = evaluateDocuments(order, ASSET_VERSION).find(entry => entry.kind === kind)!;
    if (!decision.available) {
      // Owned but ineligible: generic message; the allowlisted reasonCode comes from a fresh metadata read.
      if (decision.reason === 'DOCUMENT_TOO_LARGE') throw new AppError('This document is too large to generate.', 422, 'DOCUMENT_LIMIT_EXCEEDED');
      if (decision.reason !== 'PAYMENT_NOT_CONFIRMED' && decision.reason !== 'HISTORICAL_PAYMENT_UNVERIFIED') {
        throw new AppError('This document cannot be generated from the recorded order details.', 422, 'DOCUMENT_DATA_INVALID');
      }
      throw new AppError('This document is not available for this order.', 409, 'DOCUMENT_NOT_AVAILABLE');
    }
    if (this.active.has(userId)) throw new AppError('Another document is being prepared. Please try again in a moment.', 429, 'RATE_LIMITED');
    this.active.add(userId);
    const started = performance.now();
    const context = { orderId: order.id, kind, templateVersion: TEMPLATE_VERSION };
    logSafely('info', 'Document render started.', { event: 'document_render_started', ...context, ...this.pool().stats() });
    try {
      const pdf = await this.pool().render(decision.snapshot!, decision.contentVersion!, signal);
      logSafely('info', 'Document render completed.', { event: 'document_render_completed', ...context,
        durationMs: Math.round(performance.now() - started), bytes: pdf.bytes.length, pages: pdf.pageCount });
      return { bytes: pdf.bytes, byteLength: pdf.bytes.length, pageCount: pdf.pageCount, contentVersion: decision.contentVersion!,
        filename: documentFilename(canonicalReference(order.id), kind), mediaType: 'application/pdf' };
    } catch (error) {
      throw this.translate(error, context, Math.round(performance.now() - started));
    } finally {
      this.active.delete(userId);
    }
  }

  private translate(error: unknown, context: Record<string, unknown>, durationMs: number) {
    const code = error instanceof RenderError ? error.code : 'RENDER_FAILED';
    if (code === 'CANCELLED') {
      logSafely('info', 'Document request cancelled.', { event: 'document_request_cancelled', ...context, durationMs });
      return new AppError('The document request was cancelled.', 499, 'DOCUMENT_REQUEST_CANCELLED');
    }
    if (['PAGE_LIMIT', 'BYTE_LIMIT', 'UNSUPPORTED_GLYPH', 'LAYOUT_OVERFLOW'].includes(code)) {
      logSafely('warn', 'Document limit rejected.', { event: 'document_limit_rejected', ...context, code, durationMs });
      return code === 'UNSUPPORTED_GLYPH' || code === 'LAYOUT_OVERFLOW'
        ? new AppError('This document cannot be generated from the recorded order details.', 422, 'DOCUMENT_DATA_INVALID')
        : new AppError('This document is too large to generate.', 422, 'DOCUMENT_LIMIT_EXCEEDED');
    }
    logSafely(code === 'QUEUE_FULL' ? 'warn' : 'error', 'Document render failed.', { event: 'document_render_failed', ...context, code, durationMs,
      ...this.pool().stats() });
    if (code === 'QUEUE_FULL' || code === 'ASSETS_UNAVAILABLE') return unavailable();
    if (code === 'TIMEOUT') return new AppError('The document took too long to prepare. Please try again.', 503, 'DOCUMENT_GENERATION_TIMEOUT');
    return new AppError('The document could not be generated. Please try again.', 500, 'DOCUMENT_GENERATION_FAILED');
  }
}
