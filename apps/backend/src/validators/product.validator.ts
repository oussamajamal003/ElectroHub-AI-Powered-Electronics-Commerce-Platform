import { z } from 'zod';
import { Prisma } from '@prisma/client';

// Digits only (no sign, decimal point, exponent or whitespace) and at most 15 digits, so Number() is exact and no large value
// is ever multiplied into an offset before the maximum is enforced.
const positiveInteger = (fallback: number, maximum: number) =>
  z.string().regex(/^[1-9]\d{0,14}$/).transform(Number)
    .pipe(z.number().int().safe().max(maximum)).prefault(String(fallback));

/**
 * Task 06.2: offset pagination is capped at page 100 (worst-case OFFSET 9,900 rows at pageSize 100). Deeper catalog browsing
 * uses keyset cursors (GET /api/search/products?paginate=cursor). Exported so validators and docs share one number.
 */
export const MAX_PAGE = 100;
export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  page: positiveInteger(1, MAX_PAGE),
  pageSize: positiveInteger(20, MAX_PAGE_SIZE),
}).strict();

/** Maps a pagination ZodError to the documented public error; a page above the cap gets its own actionable code. */
export function paginationValidationError(error: z.ZodError, fallbackMessage: string) {
  const pageTooLarge = error.issues.some(issue => issue.path[0] === 'page' && issue.code === 'too_big');
  return pageTooLarge
    ? { message: `Page numbers above ${MAX_PAGE} are not supported. Use cursor pagination (paginate=cursor) to continue browsing.`, code: 'PAGE_LIMIT_EXCEEDED' }
    : { message: fallbackMessage, code: 'VALIDATION_ERROR' };
}

export const slugSchema = z.string().min(1).max(280).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function normalizeSlug(value: string): string {
  return slugSchema.parse(value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
}

export const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/, 'Enter an amount with two decimals, for example 19.99.');
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
  .regex(/^\/images\/(?:products|categories|brands|catalog)\/[a-z0-9/-]+\.(?:svg|webp|png|jpg)$/);
