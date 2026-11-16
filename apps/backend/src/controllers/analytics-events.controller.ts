import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsUnavailableError, MAX_SESSION_MS, recordImageSearchSelection, recordStorefrontSession, withdrawImageSearchAnalytics } from '../services/analytics-events.service.js';

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

/** Task 06.2: random per-search references of consented image searches that were still running when the shopper withdrew. */
const withdrawalSchema = z.object({
  refs: z.array(z.string().uuid().transform(value => value.toLowerCase())).min(1).max(16),
}).strict();

export const analyticsEventsController = {
  /**
   * Applies an analytics withdrawal to in-flight image searches. Always 202 for a well-formed body, so the response never reveals
   * whether a reference existed; 503 only if an already-written row could not be erased (the client retries when back online).
   */
  withdraw: async (req: Request, res: Response, next: NextFunction) => {
    const parsed = withdrawalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid analytics withdrawal.' } });
      return;
    }
    try {
      await withdrawImageSearchAnalytics([...new Set(parsed.data.refs)]);
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
