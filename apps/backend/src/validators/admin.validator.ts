import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { moneySchema, slugSchema } from './product.validator.js';
import { MAX_STOCK } from '../services/inventory.service.js';

/**
 * Task 05.1 admin operations. Every body is `.strict()` so authority fields a client might smuggle in (role, isTestFixture,
 * payment status, revision, actor) are rejected; every list query is whitelisted (no raw Prisma where/orderBy from the client).
 */
const pageNumber = (fallback: number, maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().safe().max(maximum)).prefault(String(fallback));
const search = z.string().trim().max(100).optional().transform(value => value || undefined);
const order = z.enum(['asc', 'desc']).prefault('asc');
const listBase = { q: search, page: pageNumber(1, 10_000), pageSize: pageNumber(20, 50), order };

export const uuidSchema = z.string().uuid();
export const expectedUpdatedAt = z.iso.datetime({ offset: true });

// ─── Products ───────────────────────────────────────────
// UNTRACKED = no stock record (legacy data); it is never folded into OUT_OF_STOCK so each filter matches its own summary count.
export const STOCK_FILTERS = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNTRACKED'] as const;
export const productListSchema = z.object({
  ...listBase,
  categoryId: uuidSchema.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  stock: z.enum(STOCK_FILTERS).optional(),
  sort: z.enum(['name', 'price', 'createdAt', 'updatedAt', 'sku']).prefault('updatedAt'),
}).strict();

const specification = z.object({
  group: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(1000),
}).strict();
export const MAX_SPECIFICATIONS = 60;
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform(value => value || null);
const positiveMoney = moneySchema.refine(value => new Prisma.Decimal(value).gt(0), 'Price must be greater than zero.');

const productFields = {
  name: z.string().trim().min(2).max(255),
  sku: z.string().trim().min(2).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, dashes or underscores.')
    .transform(value => value.toUpperCase()),
  description: optionalText(5000),
  modelNumber: optionalText(100),
  categoryId: uuidSchema,
  brandId: uuidSchema.nullable().optional().transform(value => value ?? null),
  price: positiveMoney,
  compareAtPrice: moneySchema.nullable().optional().transform(value => value ?? null),
  specifications: z.array(specification).max(MAX_SPECIFICATIONS).prefault([]),
};
const compareAtRule = (value: { price?: string; compareAtPrice?: string | null }) => value.compareAtPrice == null || value.price === undefined ||
  new Prisma.Decimal(value.compareAtPrice).gt(value.price);
const compareAtIssue = { message: 'The original price must be higher than the price.', path: ['compareAtPrice'] };

export const productCreateSchema = z.object({
  ...productFields,
  slug: slugSchema.max(280).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).prefault('INACTIVE'),
  inventory: z.object({ quantity: z.number().int().min(0).max(MAX_STOCK), lowStockAt: z.number().int().min(0).max(100_000).prefault(5) }).strict(),
}).strict().refine(compareAtRule, compareAtIssue);

export const productUpdateSchema = z.object({
  ...productFields,
  expectedUpdatedAt,
}).strict().refine(compareAtRule, compareAtIssue);

export const statusChangeSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), expectedUpdatedAt }).strict();

// ─── Categories ─────────────────────────────────────────
export const categoryListSchema = z.object({
  ...listBase,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sort: z.enum(['name', 'createdAt', 'products']).prefault('name'),
}).strict();
const categoryFields = {
  name: z.string().trim().min(2).max(100),
  description: optionalText(1000),
};
export const categoryCreateSchema = z.object({ ...categoryFields, slug: slugSchema.max(120).optional() }).strict();
export const categoryUpdateSchema = z.object({ ...categoryFields, expectedUpdatedAt }).strict();
export const categoryStatusSchema = z.object({ isActive: z.boolean(), expectedUpdatedAt }).strict();

// ─── Inventory ──────────────────────────────────────────
export const inventoryListSchema = z.object({
  ...listBase,
  status: z.enum(STOCK_FILTERS).optional(),
  sort: z.enum(['name', 'quantity', 'updatedAt', 'sku']).prefault('quantity'),
}).strict();
export const inventoryAdjustmentSchema = z.object({
  operation: z.enum(['RESTOCK', 'SET']),
  quantity: z.number().int().min(0).max(MAX_STOCK),
  // The quantity the admin saw: a stale screen or a resubmitted restock is rejected instead of applied twice.
  expectedQuantity: z.number().int().min(0).max(MAX_STOCK).nullable(),
  reason: z.string().trim().max(200).optional().transform(value => value || undefined),
}).strict().refine(value => value.operation === 'SET' || value.quantity >= 1, { message: 'Restock at least one unit.', path: ['quantity'] });
export const inventoryThresholdSchema = z.object({
  lowStockAt: z.number().int().min(0).max(100_000),
  expectedLowStockAt: z.number().int().min(0).max(100_000),
}).strict();

// ─── Orders ─────────────────────────────────────────────
export const PAYMENT_STATES = ['PAID', 'PENDING', 'FAILED', 'REFUNDED', 'UNPROCESSED'] as const;
export const orderListSchema = z.object({
  ...listBase,
  status: z.enum(['AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']).optional(),
  payment: z.enum(PAYMENT_STATES).optional(),
  customerId: uuidSchema.optional(),
  sort: z.enum(['createdAt', 'total']).prefault('createdAt'),
  order: z.enum(['asc', 'desc']).prefault('desc'),
}).strict();

// ─── Customers ──────────────────────────────────────────
export const customerListSchema = z.object({
  ...listBase,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sort: z.enum(['createdAt', 'name', 'email']).prefault('createdAt'),
  order: z.enum(['asc', 'desc']).prefault('desc'),
}).strict();
export const customerStatusSchema = z.object({ isActive: z.boolean(), expectedUpdatedAt }).strict();

// ─── Dashboard ──────────────────────────────────────────
export const dashboardSchema = z.object({ days: z.enum(['7', '30', '90']).prefault('30').transform(Number) }).strict();
