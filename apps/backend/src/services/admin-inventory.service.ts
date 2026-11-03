import { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { deriveStockStatus, InventoryService } from './inventory.service.js';
import { logSafely } from '../utils/logger.js';
import type { inventoryAdjustmentSchema, inventoryListSchema, STOCK_FILTERS } from '../validators/admin.validator.js';

/**
 * Task 05.1 admin inventory. Quantities change only through the existing InventoryService (row lock + checked update + status
 * derivation), the same path checkout and payment compensation use. The admin's `expectedQuantity` is compared under that row lock,
 * so a stale screen or a resubmitted restock is a 409 with the current state, never a double apply or a lost concurrent sale.
 */
type InventoryList = z.infer<typeof inventoryListSchema>;
type Adjustment = z.infer<typeof inventoryAdjustmentSchema>;
const TX = { maxWait: 10_000, timeout: 20_000 };
const isWriteConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);

/** Stock filter shared by the inventory and catalog lists; each value selects exactly the rows its summary() count counts. */
export function stockWhere(filter: (typeof STOCK_FILTERS)[number]): Prisma.ProductWhereInput {
  return filter === 'UNTRACKED' ? { inventory: { is: null } } : { inventory: { is: { status: filter } } };
}

const select = {
  id: true, name: true, sku: true, status: true,
  category: { select: { id: true, name: true, isActive: true } },
  inventory: { select: { quantity: true, lowStockAt: true, updatedAt: true } },
  images: { where: { mediaState: 'PUBLISHED' }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true, altText: true } },
} satisfies Prisma.ProductSelect;
type Row = Prisma.ProductGetPayload<{ select: typeof select }>;

function project(row: Row) {
  const inventory = row.inventory;
  return {
    productId: row.id, name: row.name, sku: row.sku, productStatus: row.status, category: row.category,
    image: row.images[0] ?? null,
    quantity: inventory?.quantity ?? null, lowStockAt: inventory?.lowStockAt ?? null,
    stockStatus: inventory ? deriveStockStatus(inventory.quantity, inventory.lowStockAt) : null,
    // Physical stock and sellability are independent: a stocked product in an archived product/category is still not purchasable.
    purchasable: Boolean(inventory && inventory.quantity > 0 && row.status === 'ACTIVE' && row.category.isActive),
    updatedAt: inventory?.updatedAt.toISOString() ?? null,
  };
}

export class AdminInventoryService {
  constructor(private readonly db: PrismaClient = prisma, private readonly inventory = new InventoryService()) {}

  /** One grouped query over the stored status column InventoryService maintains on every write. */
  async summary() {
    const [groups, missing] = await Promise.all([
      this.db.inventory.groupBy({ by: ['status'], where: { product: { isTestFixture: false } }, _count: { _all: true } }),
      this.db.product.count({ where: { isTestFixture: false, inventory: { is: null } } }),
    ]);
    const count = (status: string) => groups.find(group => group.status === status)?._count._all ?? 0;
    return { inStock: count('IN_STOCK'), lowStock: count('LOW_STOCK'), outOfStock: count('OUT_OF_STOCK'), untracked: missing };
  }

  async list(query: InventoryList) {
    const where: Prisma.ProductWhereInput = { isTestFixture: false };
    if (query.q) where.OR = [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }];
    if (query.status) Object.assign(where, stockWhere(query.status));
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = query.sort === 'quantity' ? [{ inventory: { quantity: query.order } }, { name: 'asc' }]
      : query.sort === 'updatedAt' ? [{ inventory: { updatedAt: query.order } }, { name: 'asc' }] : [{ [query.sort]: query.order }, { id: 'asc' }];
    const [rows, total, summary] = await Promise.all([
      this.db.product.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select }),
      this.db.product.count({ where }),
      this.summary(),
    ]);
    return { data: rows.map(project), meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize), summary } };
  }

  async get(productId: string, db: PrismaClient | Prisma.TransactionClient = this.db) {
    const row = await db.product.findUnique({ where: { id: productId }, select: { ...select, isTestFixture: true } });
    if (!row || row.isTestFixture) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    return project(row);
  }

  private async conflict(productId: string): Promise<never> {
    const current = await this.get(productId);
    throw Object.assign(new AppError('Stock changed since you loaded it. Review the current quantity and try again.', 409, 'INVENTORY_CONFLICT'),
      { current });
  }

  async adjust(actorId: string, productId: string, input: Adjustment) {
    let stale = false;
    const outcome = await this.db.$transaction(async tx => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { isTestFixture: true } });
      if (!product || product.isTestFixture) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      const rows = await tx.$queryRaw<{ quantity: number; lowStockAt: number }[]>(Prisma.sql`
        SELECT "quantity", "lowStockAt" FROM "inventory" WHERE "productId" = ${productId}::uuid FOR UPDATE`);
      const current = rows[0];
      if ((current?.quantity ?? null) !== input.expectedQuantity) { stale = true; return null; }
      if (!current) {
        // A product without a stock record (legacy data) can be given one by an absolute correction only.
        if (input.operation !== 'SET') throw new AppError('Set an absolute quantity to start tracking this product’s stock.', 409, 'INVENTORY_NOT_FOUND');
        await tx.inventory.create({ data: { productId, quantity: input.quantity, lowStockAt: 5, status: deriveStockStatus(input.quantity, 5) } });
        return { from: null, to: input.quantity };
      }
      const next = input.operation === 'SET'
        ? await this.inventory.setStock(productId, input.quantity, tx)
        : await this.inventory.increaseStock(productId, input.quantity, tx);
      return { from: current.quantity, to: next.quantity };
    }, TX).catch(error => {
      if (isWriteConflict(error)) { stale = true; return null; }
      throw error;
    });
    if (stale || !outcome) return this.conflict(productId);
    // Operational audit: identifiers and quantities only; the free-text reason length is recorded, not its content.
    logSafely('info', 'Admin inventory change', { event: 'admin.inventory.adjusted', actorId, productId, operation: input.operation,
      from: outcome.from, to: outcome.to, reasonProvided: Boolean(input.reason) });
    return this.get(productId);
  }

  async setThreshold(actorId: string, productId: string, lowStockAt: number, expectedLowStockAt: number) {
    let stale = false;
    await this.db.$transaction(async tx => {
      // Fixtures are read-only here too, whether or not they have a stock record.
      const product = await tx.product.findUnique({ where: { id: productId }, select: { isTestFixture: true } });
      if (!product || product.isTestFixture) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      const rows = await tx.$queryRaw<{ quantity: number; lowStockAt: number }[]>(Prisma.sql`
        SELECT "quantity", "lowStockAt" FROM "inventory" WHERE "productId" = ${productId}::uuid FOR UPDATE`);
      const current = rows[0];
      if (!current) throw new AppError('This product has no stock record yet. Set its quantity first.', 409, 'INVENTORY_NOT_FOUND');
      if (current.lowStockAt !== expectedLowStockAt) { stale = true; return; }
      await tx.inventory.update({ where: { productId }, data: { lowStockAt, status: deriveStockStatus(current.quantity, lowStockAt) } });
    }, TX).catch(error => {
      if (isWriteConflict(error)) { stale = true; return; }
      throw error;
    });
    if (stale) return this.conflict(productId);
    logSafely('info', 'Admin inventory change', { event: 'admin.inventory.threshold', actorId, productId, lowStockAt });
    return this.get(productId);
  }
}
