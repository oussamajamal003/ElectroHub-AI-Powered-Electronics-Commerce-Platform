import { z } from 'zod';
import { Prisma } from '@prisma/client';

const positiveInteger = (fallback: number, maximum: number) =>
  z.string().regex(/^[1-9]\d*$/).transform(Number)
    .pipe(z.number().int().safe().max(maximum)).optional().default(String(fallback));

export const paginationSchema = z.object({
  page: positiveInteger(1, 1000000),
  pageSize: positiveInteger(20, 100),
}).strict();

export const slugSchema = z.string().min(1).max(280).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function normalizeSlug(value: string): string {
  return slugSchema.parse(value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
}

export const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/);
export const pricingSchema = z.object({
  price: moneySchema,
  compareAtPrice: moneySchema.nullable().optional(),
}).refine(value => value.compareAtPrice == null ||
  new Prisma.Decimal(value.compareAtPrice).gte(value.price), {
  message: 'Reference price must be at least the price.',
  path: ['compareAtPrice'],
});

export const specificationSchema = z.object({
  group: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(1000),
  sortOrder: z.number().int().nonnegative(),
}).strict();

export const mediaPathSchema = z.string().max(2048)
  .regex(/^\/images\/(?:products|categories|brands)\/[a-z0-9/-]+\.(?:svg|webp|png|jpg)$/);
