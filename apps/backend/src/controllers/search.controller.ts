import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { SearchService, type ProductListingProfile } from '../services/search.service.js';
import { searchSchema, suggestionsSchema } from '../validators/search.validator.js';
const service = new SearchService();
export const searchController = {
  products: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const started = performance.now();
      const input = searchSchema.parse(req.query);
      const profile: ProductListingProfile | undefined = process.env.NODE_ENV !== 'production' && req.header('x-electrohub-profile') === '1' ? {} : undefined;
      const parsed = performance.now();
      const result = await service.products(input, profile);
      if (profile) {
        profile.requestToParse = parsed - started;
        profile.service = performance.now() - parsed;
      }
      const body = JSON.stringify(result);
      if (profile) {
        profile.serialization = performance.now() - parsed - profile.service;
        profile.beforeSend = performance.now() - started;
        res.setHeader('Server-Timing', Object.entries(profile).map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(', '));
        res.on('finish', () => console.info('Product listing profile', { ...profile, responseSent: performance.now() - started }));
      }
      res.type('json').send(body);
    }
    catch (error) { next(error instanceof z.ZodError ? new AppError('Invalid search parameters.', 400, 'VALIDATION_ERROR') : error); }
  },
  suggestions: async (req: Request, res: Response, next: NextFunction) => {
    try { const input = suggestionsSchema.parse(req.query); res.json(await service.suggestions(input.q, input.limit)); }
    catch (error) { next(error instanceof z.ZodError ? new AppError('Invalid suggestion parameters.', 400, 'VALIDATION_ERROR') : error); }
  },
};
