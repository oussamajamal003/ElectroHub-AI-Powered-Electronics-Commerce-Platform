import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import type { SniffedImage } from '../middleware/imageSearchUpload.js';
import { IMAGE_SEARCH_DEFAULT_LIMIT, IMAGE_SEARCH_MAX_LIMIT, ImageSearchError, imageSearchService } from '../services/image-search.service.js';

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
    const onClose = () => { if (!res.writableFinished) disconnect.abort(); };
    res.once('close', onClose);
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
        signal: disconnect.signal,
      });
      if (disconnect.signal.aborted || res.writableEnded) return;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(body);
    } catch (error) {
      if (disconnect.signal.aborted || res.writableEnded) return;
      if (error instanceof ImageSearchError && error.retryAfterSeconds !== undefined) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      next(error);
    } finally {
      res.off('close', onClose);
    }
  },
};
