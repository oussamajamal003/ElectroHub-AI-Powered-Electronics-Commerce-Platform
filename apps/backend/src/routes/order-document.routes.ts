import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { DOCUMENT_KINDS, type DocumentDisposition } from '../documents/document.types.js';
import { OrderDocumentService } from '../services/order-document.service.js';

/**
 * Task 03.9 customer document API. Paths are owner-scoped reads under the existing bearer JWT + CUSTOMER role contract.
 * Every response on these paths (including auth/validation errors) is private and never cached; no ETag/304 is produced.
 */
const METADATA_PATH = '/orders/:orderReference/documents';
const FILE_PATH = '/orders/:orderReference/documents/:kind';
const REQUEST_BUDGET_MS = 15_000;

const kindSchema = z.enum(DOCUMENT_KINDS);
const fileQuery = z.object({ disposition: z.enum(['inline', 'attachment']).optional() }).strict();
const metadataQuery = z.object({}).strict();
const invalid = () => new AppError('Invalid document request.', 400, 'DOCUMENT_REQUEST_INVALID');

function privateHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', Vary: 'Authorization' });
  next();
}

const methodNotAllowed = (_req: Request, res: Response) => {
  res.set('Allow', 'GET').status(405).type('json').end(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }));
};

/** RFC 6266 / RFC 8187: quoted ASCII fallback plus percent-encoded UTF-8; only server-generated names reach this. */
export function contentDisposition(disposition: DocumentDisposition, filename: string) {
  const safe = /^[A-Za-z0-9._-]{1,120}$/.test(filename) ? filename : 'ElectroHub-document.pdf';
  return `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/**
 * @swagger
 * /orders/{orderReference}/documents:
 *   get:
 *     tags: [Orders]
 *     summary: Task 03.9 document availability for an owned Order (metadata only; never renders a PDF)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: orderReference, required: true, schema: { type: string, example: ORD-7C9E6679-7425-40DE-944B-E07FC1F90AE7 } }
 *     responses:
 *       200: { description: "{ data: { orderReference, documents: [invoice, receipt, summary] } } with AVAILABLE/UNAVAILABLE + reasonCode" }
 *       400: { description: ORDER_REFERENCE_INVALID / DOCUMENT_REQUEST_INVALID }
 *       401: { description: Authentication required }
 *       403: { description: Customer role required }
 *       404: { description: ORDER_NOT_FOUND (identical for unknown and other customers' Orders) }
 *       405: { description: METHOD_NOT_ALLOWED (Allow GET) }
 *       429: { description: RATE_LIMITED }
 * /orders/{orderReference}/documents/{kind}:
 *   get:
 *     tags: [Orders]
 *     summary: Task 03.9 owned PDF (Order invoice — commercial transaction statement, Payment receipt or Order summary)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: orderReference, required: true, schema: { type: string } }
 *       - { in: path, name: kind, required: true, schema: { type: string, enum: [invoice, receipt, summary] } }
 *       - { in: query, name: disposition, required: false, schema: { type: string, enum: [attachment, inline], default: attachment } }
 *     responses:
 *       200: { description: Complete application/pdf (private, no-store; X-Document-Version), content: { application/pdf: { schema: { type: string, format: binary } } } }
 *       400: { description: ORDER_REFERENCE_INVALID / DOCUMENT_REQUEST_INVALID }
 *       401: { description: Authentication required }
 *       403: { description: Customer role required }
 *       404: { description: ORDER_NOT_FOUND }
 *       405: { description: METHOD_NOT_ALLOWED }
 *       409: { description: DOCUMENT_NOT_AVAILABLE (owned but ineligible; re-read metadata for reasonCode) }
 *       422: { description: DOCUMENT_DATA_INVALID / DOCUMENT_LIMIT_EXCEEDED }
 *       429: { description: RATE_LIMITED (Retry-After) }
 *       500: { description: DOCUMENT_GENERATION_FAILED }
 *       503: { description: DOCUMENTS_UNAVAILABLE / DOCUMENT_GENERATION_TIMEOUT (Retry-After) }
 */
export interface DocumentRouterOptions { service?: OrderDocumentService; fileLimit?: number; metadataLimit?: number; windowMs?: number }

export function createOrderDocumentRouter(options: DocumentRouterOptions = {}) {
  const service = options.service ?? new OrderDocumentService();
  const windowMs = options.windowMs ?? 5 * 60 * 1000;
  const limiter = (limit: number) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => `document:${req.user!.userId}`,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many document requests. Please wait a few minutes and try again.' } } });
  const fileLimiter = limiter(options.fileLimit ?? 20);
  const metadataLimiter = limiter(options.metadataLimit ?? 60);
  const router = Router();

  router.use([METADATA_PATH, FILE_PATH], privateHeaders);
  // Express would otherwise answer HEAD with the GET handler and render a PDF only to discard it.
  router.head([METADATA_PATH, FILE_PATH], methodNotAllowed);
  router.use([METADATA_PATH, FILE_PATH], (req, res, next) => req.method === 'GET' ? next() : methodNotAllowed(req, res));
  router.use([METADATA_PATH, FILE_PATH], requireAuth, requireRole('CUSTOMER'));

  router.get(METADATA_PATH, metadataLimiter, async (req, res, next) => {
    try {
      if (!metadataQuery.safeParse(req.query).success) throw invalid();
      const body = { data: await service.list(req.user!.userId, String(req.params.orderReference)) };
      res.status(200).type('json').end(JSON.stringify(body));
    } catch (error) { next(error); }
  });

  router.get(FILE_PATH, fileLimiter, async (req, res, next) => {
    const controller = new AbortController();
    // Client disconnects cancel the queued/running render; the overall budget bounds queue wait + render.
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const budget = setTimeout(() => controller.abort(), REQUEST_BUDGET_MS);
    try {
      const kind = kindSchema.safeParse(req.params.kind);
      const query = fileQuery.safeParse(req.query);
      if (!kind.success || !query.success) throw invalid();
      const disposition: DocumentDisposition = query.data.disposition ?? 'attachment';
      let pdf;
      try { pdf = await service.render(req.user!.userId, String(req.params.orderReference), kind.data, controller.signal); }
      catch (error) {
        if (error instanceof AppError && error.code === 'DOCUMENT_REQUEST_CANCELLED' && !res.destroyed && !res.writableEnded && controller.signal.aborted) {
          throw new AppError('The document took too long to prepare. Please try again.', 503, 'DOCUMENT_GENERATION_TIMEOUT');
        }
        throw error;
      }
      if (res.destroyed) return;
      // Headers are committed only after the complete PDF exists and passed its byte/page/format checks.
      res.status(200).set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(disposition, pdf.filename),
        'Content-Length': String(pdf.byteLength), 'X-Document-Version': pdf.contentVersion });
      res.end(pdf.bytes);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof AppError && (error.statusCode === 429 || error.statusCode === 503)) res.set('Retry-After', error.statusCode === 429 ? '5' : '15');
      next(error);
    } finally {
      clearTimeout(budget);
    }
  });

  return router;
}

export default createOrderDocumentRouter();
