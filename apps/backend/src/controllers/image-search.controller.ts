import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import type { SniffedImage } from '../middleware/imageSearchUpload.js';
import { IMAGE_SEARCH_DEFAULT_LIMIT, IMAGE_SEARCH_MAX_LIMIT, ImageSearchError, imageSearchService } from '../services/image-search.service.js';
import { imageSearchLifecycle } from '../middleware/imageSearchAdmission.js';
import { recordImageSearchCompleted, recordImageSearchFailed } from '../services/analytics-events.service.js';
import { issueAnalyticsToken } from '../services/analytics-token.js';

/** Public failure envelope code to a fixed, non-sensitive analytics and lifecycle category. */
const FAILURE_CATEGORIES = { IMAGE_SEARCH_TIMEOUT: 'inference_timeout', IMAGE_SEARCH_UNAVAILABLE: 'upstream_unavailable',
  IMAGE_TOO_LARGE: 'too_large', IMAGE_SEARCH_UNSUPPORTED_TYPE: 'invalid', IMAGE_UNREADABLE: 'invalid', IMAGE_SEARCH_BUSY: 'busy' } as const;

const imageSearchQuerySchema = z.object({
  limit: z.string().regex(/^[1-9]\d{0,1}$/).transform(Number).pipe(z.number().int().min(1).max(IMAGE_SEARCH_MAX_LIMIT))
    .prefault(String(IMAGE_SEARCH_DEFAULT_LIMIT)),
}).strict();

export const imageSearchController = {
  /** Runs before the multipart body is read so malformed query strings never consume upload bandwidth. */
  validateQuery: (req: Request, res: Response, next: NextFunction) => {
    const parsed = imageSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError('Invalid image search parameters.', 400, 'VALIDATION_ERROR'));
      return;
    }
    res.locals.imageSearchLimit = parsed.data.limit;
    next();
  },

  search: async (req: Request, res: Response, next: NextFunction) => {
    // A disconnected client stops the work: the AI call and the catalog query are both cancelled via this signal.
    const disconnect = new AbortController();
    const lifecycle = imageSearchLifecycle(req);
    const signal = lifecycle?.signal ?? disconnect.signal;
    const onClose = () => { if (!res.writableFinished) disconnect.abort(); };
    res.once('close', onClose);
    // Task 05.2: one correlation id per served search; analytics rows never contain the image, the request or the user.
    const analyticsAllowed = req.get('X-ElectroHub-Analytics') === 'consented';
    const correlationId = analyticsAllowed ? randomUUID() : undefined;
    const startedAt = Date.now();
    try {
      const sniffed = res.locals.sniffedImage as SniffedImage | undefined;
      const limit = res.locals.imageSearchLimit as number | undefined;
      if (!sniffed || limit === undefined) {
        next(new AppError('Choose a photo to search with.', 400, 'IMAGE_REQUIRED'));
        return;
      }
      const body = await imageSearchService.search({
        image: sniffed.buffer,
        contentType: sniffed.contentType,
        limit,
        requestId: req.id,
        signal,
      });
      if (signal.aborted || res.writableEnded) return;
      if (lifecycle) { lifecycle.outcome = 'completed'; lifecycle.modelVersion = body.meta.modelVersion;
        lifecycle.embeddingVersion = body.meta.embeddingVersion; lifecycle.resultCount = body.meta.count; }
      // Fire-and-forget: recording can neither delay nor change this response.
      if (correlationId) recordImageSearchCompleted({ correlationId, resultCount: body.meta.count, durationMs: Date.now() - startedAt });
      const productIds = body.data.items.map(item => item.id);
      // Only a search that returned products can be followed by a selection, so only those responses carry a token.
      const analyticsToken = correlationId && productIds.length > 0 ? issueAnalyticsToken({ correlationId, productIds }) : undefined;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(analyticsToken ? { ...body, analyticsToken } : body);
    } catch (error) {
      if (signal.aborted || res.writableEnded) return;
      const category = error instanceof ImageSearchError && error.code in FAILURE_CATEGORIES
        ? FAILURE_CATEGORIES[error.code as keyof typeof FAILURE_CATEGORIES] : 'failed';
      if (correlationId) recordImageSearchFailed({ correlationId, category, durationMs: Date.now() - startedAt });
      if (lifecycle) {
        lifecycle.outcome = category;
      }
      if (error instanceof ImageSearchError && error.retryAfterSeconds !== undefined) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      next(error);
    } finally {
      res.off('close', onClose);
    }
  },
};
