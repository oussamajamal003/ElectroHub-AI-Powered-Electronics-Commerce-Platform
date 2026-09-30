import { z } from 'zod';

const pageNumber = (fallback: number, maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().safe().max(maximum)).optional().default(String(fallback));

export const reviewPaginationSchema = z.object({
  page: pageNumber(1, 1000), pageSize: pageNumber(10, 50),
}).strict();

export const reviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(1).max(2000),
}).strict();

export const reviewUpdateSchema = reviewCreateSchema.partial().refine(
  value => value.rating !== undefined || value.body !== undefined,
  'At least one review field is required.',
);
