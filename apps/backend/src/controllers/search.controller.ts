import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { SearchService } from '../services/search.service.js';
import { searchSchema, suggestionsSchema } from '../validators/search.validator.js';
const service = new SearchService();
export const searchController = {
  products: async (req: Request, res: Response, next: NextFunction) => {
    try { res.json(await service.products(searchSchema.parse(req.query))); }
    catch (error) { next(error instanceof z.ZodError ? new AppError('Invalid search parameters.', 400, 'VALIDATION_ERROR') : error); }
  },
  suggestions: async (req: Request, res: Response, next: NextFunction) => {
    try { const input = suggestionsSchema.parse(req.query); res.json(await service.suggestions(input.q, input.limit)); }
    catch (error) { next(error instanceof z.ZodError ? new AppError('Invalid suggestion parameters.', 400, 'VALIDATION_ERROR') : error); }
  },
};
