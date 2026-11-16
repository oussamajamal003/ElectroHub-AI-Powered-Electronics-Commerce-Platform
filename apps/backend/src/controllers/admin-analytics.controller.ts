import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ANALYTICS_PERIODS, DEFAULT_ANALYTICS_PERIOD, adminAnalyticsService, type AnalyticsPeriod } from '../services/admin-analytics.service.js';

/** Strict query: only the whitelisted period is accepted; unknown keys (for example a userId filter) are rejected. */
const periodQuery = z.object({
  period: z.enum(ANALYTICS_PERIODS).default(DEFAULT_ANALYTICS_PERIOD),
}).strict();

type Report = (period: AnalyticsPeriod) => Promise<unknown>;

/** Each report is its own endpoint so one failing panel never blocks the others. */
const report = (run: Report) => async (req: Request, res: Response, next: NextFunction) => {
  const parsed = periodQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'period must be one of 7d, 30d, 90d or 12m.' } });
    return;
  }
  try {
    res.status(200).json(await run(parsed.data.period));
  } catch (error) {
    next(error);
  }
};

export const adminAnalyticsController = {
  overview: report(period => adminAnalyticsService.overview(period)),
  products: report(period => adminAnalyticsService.products(period)),
  categories: report(period => adminAnalyticsService.categories(period)),
  inventory: report(period => adminAnalyticsService.inventory(period)),
  recommendations: report(period => adminAnalyticsService.recommendations(period)),
  imageSearch: report(period => adminAnalyticsService.imageSearch(period)),
  deliveries: report(period => adminAnalyticsService.deliveries(period)),
  customers: report(period => adminAnalyticsService.customers(period)),
};
