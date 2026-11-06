import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsUnavailableError, MAX_SESSION_MS, recordImageSearchSelection, recordStorefrontSession } from '../services/analytics-events.service.js';

/**
 * Task 05.2 controlled ingestion. Two client events only: a customer selecting a product from a photo-search result, and a
 * storefront tab's visible time. `.strict()` rejects any other type and any extra field, so no client can submit outcomes,
 * counts, prices or identities.
 */
const selectionSchema = z.object({
  type: z.literal('image_search.result_selected'),
  token: z.string().min(1).max(4096),
  productId: z.string().uuid(),
}).strict();

const sessionSchema = z.object({
  type: z.literal('storefront.session'),
  sessionId: z.string().uuid(),
  visibleMs: z.number().int().min(0).max(MAX_SESSION_MS),
}).strict();

export const analyticsEventsController = {
  create: async (req: Request, res: Response, next: NextFunction) => {
    const session = sessionSchema.safeParse(req.body);
    if (session.success) {
      try {
        await recordStorefrontSession(session.data);
        res.setHeader('Cache-Control', 'no-store');
        res.status(202).json({ accepted: true });
      } catch (error) {
        if (error instanceof AnalyticsUnavailableError) {
          res.status(503).json({ error: { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics is temporarily unavailable.' } });
          return;
        }
        next(error);
      }
      return;
    }
    const parsed = selectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid analytics event.' } });
      return;
    }
    try {
      const result = await recordImageSearchSelection({ token: parsed.data.token, productId: parsed.data.productId });
      if (!result.accepted) {
        res.status(400).json({ error: { code: 'INVALID_ANALYTICS_TOKEN', message: 'This analytics token is invalid or expired.' } });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(202).json({ accepted: true });
    } catch (error) {
      if (error instanceof AnalyticsUnavailableError) {
        res.status(503).json({ error: { code: 'ANALYTICS_UNAVAILABLE', message: 'Analytics is temporarily unavailable.' } });
        return;
      }
      next(error);
    }
  },
};
