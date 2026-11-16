import { z } from 'zod';
import { MAX_PAGE } from './product.validator.js';

const pageNumber = (fallback: number, maximum: number) => z.string().regex(/^[1-9]\d{0,14}$/)
  .transform(Number).pipe(z.number().int().safe().max(maximum)).prefault(String(fallback));

export const reviewPaginationSchema = z.object({
  // Task 06.2: the same bounded offset cap as the catalog (worst-case OFFSET 4,950 at pageSize 50).
  page: pageNumber(1, MAX_PAGE), pageSize: pageNumber(10, 50),
}).strict();

export const reviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(1).max(2000),
}).strict();

export const reviewUpdateSchema = reviewCreateSchema.partial().refine(
  value => value.rating !== undefined || value.body !== undefined,
  'At least one review field is required.',
);
