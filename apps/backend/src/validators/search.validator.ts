import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema, slugSchema } from './product.validator.js';

export const normalizeQuery = (value: string) => value.trim().replace(/\s+/g, ' ');
const query = z.string().max(120).transform(normalizeQuery);
const price = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
export const searchSchema = paginationSchema.extend({
  q: query.optional().default(''),
  category: slugSchema.max(120).optional(), brand: slugSchema.max(120).optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  minPrice: price.optional(), maxPrice: price.optional(),
  sort: z.enum(['relevance', 'price-asc', 'price-desc', 'newest', 'name-asc']).optional(),
}).strict().refine(value => value.minPrice == null || value.maxPrice == null ||
  new Prisma.Decimal(value.minPrice).lte(value.maxPrice), { message: 'Minimum price exceeds maximum price.' });
export const suggestionsSchema = z.object({
  q: query.pipe(z.string().min(2)),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(10)).optional().default('8'),
}).strict();
export type SearchInput = z.infer<typeof searchSchema>;
export const hasDiscovery = (input: SearchInput) => Boolean(input.q || input.category || input.brand ||
  input.availability || input.minPrice !== undefined || input.maxPrice !== undefined);
