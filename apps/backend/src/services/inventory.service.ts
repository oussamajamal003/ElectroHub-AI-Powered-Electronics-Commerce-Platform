import { Prisma, ProductStatus, InventoryStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export const MAX_STOCK = 2147483647;
export interface InventoryInput { quantity: number; lowStockAt?: number }

function validInteger(value: number, minimum = 0) {
  return Number.isInteger(value) && value >= minimum && value <= MAX_STOCK;
}

export function deriveStockStatus(quantity: number, threshold: number): InventoryStatus {
  if (!validInteger(quantity) || !validInteger(threshold)) throw new AppError('Inventory is unavailable.', 409, 'INVALID_INVENTORY');
  return quantity === 0 ? 'OUT_OF_STOCK' : quantity <= threshold ? 'LOW_STOCK' : 'IN_STOCK';
}

export function projectInventory(inventory: InventoryInput | null | undefined, active = true) {
  const valid = inventory && validInteger(inventory.quantity) && validInteger(inventory.lowStockAt ?? 5);
  return {
    stockStatus: valid ? deriveStockStatus(inventory.quantity, inventory.lowStockAt ?? 5) : null,
    availableQuantity: valid ? inventory.quantity : 0,
    purchasable: Boolean(active && valid && inventory.quantity > 0),
  };
}

export function validateInventoryPurchase(inventory: InventoryInput | null | undefined, requestedQuantity: number, active = true) {
  if (!validInteger(requestedQuantity, 1)) throw new AppError('Invalid quantity.', 400, 'INVALID_CART_QUANTITY');
  if (!active) throw new AppError('Product is unavailable.', 409, 'PRODUCT_UNAVAILABLE');
  const snapshot = projectInventory(inventory);
  if (snapshot.stockStatus === null) throw new AppError('Inventory is unavailable.', 409, 'INVENTORY_NOT_FOUND');
  if (!snapshot.purchasable) throw new AppError('Product is out of stock.', 409, 'CART_STOCK_CONFLICT');
  if (requestedQuantity > snapshot.availableQuantity) {
    throw new AppError(`Only ${snapshot.availableQuantity} ${snapshot.availableQuantity === 1 ? 'item is' : 'items are'} currently available.`, 409, 'CART_STOCK_CONFLICT');
  }
  return snapshot;
}

export class InventoryService {
  async getSnapshot(productId: string, client: Prisma.TransactionClient = prisma) {
    this.validateId(productId);
    const product = await client.product.findUnique({ where: { id: productId }, select: {
      status: true, category: { select: { isActive: true } }, inventory: { select: { quantity: true, lowStockAt: true, updatedAt: true } },
    } });
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    return { productId, active: product.status === ProductStatus.ACTIVE && product.category.isActive, ...projectInventory(product.inventory, product.status === ProductStatus.ACTIVE && product.category.isActive),
      lowStockAt: product.inventory?.lowStockAt ?? null, updatedAt: product.inventory?.updatedAt ?? null };
  }

  async validateRequestedQuantity(productId: string, quantity: number, client: Prisma.TransactionClient = prisma) {
    const snapshot = await this.getSnapshot(productId, client);
    return validateInventoryPurchase(snapshot.stockStatus === null ? null : { quantity: snapshot.availableQuantity, lowStockAt: snapshot.lowStockAt ?? 5 }, quantity,
      snapshot.active);
  }

  setStock(productId: string, quantity: number, client?: Prisma.TransactionClient) { return this.change(productId, quantity, 'set', client); }
  increaseStock(productId: string, quantity: number, client?: Prisma.TransactionClient) { return this.change(productId, quantity, 'increase', client); }
  decreaseStock(productId: string, quantity: number, client?: Prisma.TransactionClient) { return this.change(productId, quantity, 'decrease', client); }

  private validateId(productId: string) {
    if (!z.string().uuid().safeParse(productId).success) throw new AppError('Invalid product ID.', 400, 'INVALID_PRODUCT_ID');
  }

  private async change(productId: string, amount: number, operation: 'set' | 'increase' | 'decrease', client?: Prisma.TransactionClient) {
    this.validateId(productId);
    if (!validInteger(amount, operation === 'set' ? 0 : 1)) throw new AppError('Invalid quantity.', 400, 'INVALID_QUANTITY');
    const execute = async (transaction: Prisma.TransactionClient) => {
      const rows = await transaction.$queryRaw<{ quantity: number; lowStockAt: number }[]>(Prisma.sql`
        SELECT "quantity", "lowStockAt" FROM "inventory" WHERE "productId" = ${productId}::uuid FOR UPDATE`);
      const inventory = rows[0];
      if (!inventory) throw new AppError('Inventory is unavailable.', 409, 'INVENTORY_NOT_FOUND');
      deriveStockStatus(inventory.quantity, inventory.lowStockAt);
      const quantity = operation === 'set' ? amount : operation === 'increase' ? inventory.quantity + amount : inventory.quantity - amount;
      if (!validInteger(quantity)) throw new AppError('Stock adjustment exceeds available inventory limits.', 409, 'INVENTORY_CONFLICT');
      return transaction.inventory.update({ where: { productId, quantity: inventory.quantity, lowStockAt: inventory.lowStockAt }, data: { quantity, status: deriveStockStatus(quantity, inventory.lowStockAt) } });
    };
    try { return await (client ? execute(client) : prisma.$transaction(execute)); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2025', 'P2028', 'P2034'].includes(error.code)) {
        throw new AppError('Inventory changed. Please retry the adjustment.', 409, 'INVENTORY_CONFLICT');
      }
      throw error;
    }
  }
}
