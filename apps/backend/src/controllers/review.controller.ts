import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { slugSchema } from '../validators/product.validator.js';
import { reviewCreateSchema, reviewPaginationSchema, reviewUpdateSchema } from '../validators/review.validator.js';
import { ReviewService } from '../services/review.service.js';

const service = new ReviewService();
const slug = (request: Request) => slugSchema.parse(request.params.slug);
const userId = (request: Request) => request.user!.userId;

function forward(error: unknown, next: NextFunction) {
  next(error instanceof z.ZodError
    ? new AppError('Invalid review request.', 400, 'VALIDATION_ERROR') : error);
}

export const reviewController = {
  listMine: async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(await service.listMine(userId(request), reviewPaginationSchema.parse(request.query))); }
    catch (error) { forward(error, next); }
  },
  list: async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(await service.list(slug(request), reviewPaginationSchema.parse(request.query))); }
    catch (error) { forward(error, next); }
  },
  mine: async (request: Request, response: Response, next: NextFunction) => {
    try {
      z.object({}).strict().parse(request.query);
      response.json({ data: await service.mine(slug(request), userId(request)) });
    } catch (error) { forward(error, next); }
  },
  create: async (request: Request, response: Response, next: NextFunction) => {
    try {
      z.object({}).strict().parse(request.query);
      const result = await service.create(slug(request), userId(request), reviewCreateSchema.parse(request.body));
      response.status(201).json({ data: result.review, summary: result.summary });
    } catch (error) { forward(error, next); }
  },
  update: async (request: Request, response: Response, next: NextFunction) => {
    try {
      z.object({}).strict().parse(request.query);
      const result = await service.update(slug(request), userId(request), reviewUpdateSchema.parse(request.body));
      response.json({ data: result.review, summary: result.summary });
    } catch (error) { forward(error, next); }
  },
  remove: async (request: Request, response: Response, next: NextFunction) => {
    try {
      z.object({}).strict().parse(request.query);
      await service.remove(slug(request), userId(request));
      response.status(204).send();
    } catch (error) { forward(error, next); }
  },
};
