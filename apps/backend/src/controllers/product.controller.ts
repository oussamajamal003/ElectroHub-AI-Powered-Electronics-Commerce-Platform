import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProductService } from '../services/product.service.js';
import { CategoryService } from '../services/category.service.js';
import { BrandService } from '../services/brand.service.js';
import { paginationSchema, slugSchema } from '../validators/product.validator.js';
import { AppError } from '../middleware/errorHandler.js';

function handleError(error: unknown, next: NextFunction) {
  next(error instanceof z.ZodError
    ? new AppError('Invalid product request parameters.', 400, 'VALIDATION_ERROR')
    : error);
}

function readController(service: ProductService | CategoryService | BrandService, slugLimit: number) {
  return {
    list: async (req: Request, res: Response, next: NextFunction) => {
      try { res.json(await service.list(paginationSchema.parse(req.query))); }
      catch (error) { handleError(error, next); }
    },
    detail: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const slug = slugSchema.max(slugLimit).parse(req.params.slug);
        z.object({}).strict().parse(req.query);
        res.json({ data: await service.detail(slug) });
      } catch (error) { handleError(error, next); }
    },
  };
}

export const productController = readController(new ProductService(), 280);
export const dealsController = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await new ProductService().deals(paginationSchema.parse(req.query))); }
  catch (error) { handleError(error, next); }
};
export const categoryController = readController(new CategoryService(), 120);
export const brandController = readController(new BrandService(), 120);
