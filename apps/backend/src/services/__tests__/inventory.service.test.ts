import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryService, MAX_STOCK, deriveStockStatus, projectInventory, validateInventoryPurchase } from '../inventory.service.js';

const database = vi.hoisted(() => ({ $queryRaw: vi.fn(), $transaction: vi.fn(), inventory: { update: vi.fn() }, product: { findUnique: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
beforeEach(() => {
  vi.resetAllMocks();
  database.$transaction.mockImplementation(operation => operation(database));
  database.$queryRaw.mockResolvedValue([{ quantity: 5, lowStockAt: 5 }]);
  database.inventory.update.mockImplementation(({ data }) => data);
});

describe('Inventory core', () => {
  it.each([[0, 5, 'OUT_OF_STOCK'], [1, 5, 'LOW_STOCK'], [5, 5, 'LOW_STOCK'], [6, 5, 'IN_STOCK'], [1, 0, 'IN_STOCK']])('derives %i at threshold %i', (quantity, threshold, status) => {
    expect(deriveStockStatus(quantity as number, threshold as number)).toBe(status);
  });
  it.each([-1, 1.5, NaN, Infinity, MAX_STOCK + 1])('rejects invalid stock %s', value => {
    expect(() => deriveStockStatus(value, 5)).toThrow();
    expect(() => deriveStockStatus(1, value)).toThrow();
    expect(projectInventory({ quantity: value, lowStockAt: 5 })).toMatchObject({ stockStatus: null, purchasable: false });
  });
  it('distinguishes missing inventory, inactive Products and genuine zero stock', () => {
    expect(projectInventory(null)).toEqual({ stockStatus: null, availableQuantity: 0, purchasable: false });
    expect(projectInventory({ quantity: 3 }, false)).toMatchObject({ stockStatus: 'LOW_STOCK', purchasable: false });
    expect(() => validateInventoryPurchase(null, 1)).toThrow('Inventory is unavailable.');
    expect(() => validateInventoryPurchase({ quantity: 3 }, 1, false)).toThrow('Product is unavailable.');
    expect(() => validateInventoryPurchase({ quantity: 0 }, 1)).toThrow('Product is out of stock.');
  });
  it('allows exact stock and rejects above stock and invalid requests', () => {
    expect(validateInventoryPurchase({ quantity: 3 }, 3).purchasable).toBe(true);
    expect(() => validateInventoryPurchase({ quantity: 3 }, 4)).toThrow('Only 3 items are currently available.');
    for (const quantity of [0, -1, 1.5, NaN, MAX_STOCK + 1]) expect(() => validateInventoryPurchase({ quantity: 3 }, quantity)).toThrow('Invalid quantity.');
  });
  it('locks stock before deriving and persisting quantity/status atomically', async () => {
    const service = new InventoryService();
    expect(await service.decreaseStock(productId, 5)).toEqual({ quantity: 0, status: 'OUT_OF_STOCK' });
    expect(database.$queryRaw.mock.calls[0][0].text).toContain('FOR UPDATE');
    expect(await service.increaseStock(productId, 1)).toEqual({ quantity: 6, status: 'IN_STOCK' });
    expect(await service.setStock(productId, 2)).toEqual({ quantity: 2, status: 'LOW_STOCK' });
  });
  it('rejects underflow, overflow, invalid IDs and missing rows without writing', async () => {
    const service = new InventoryService();
    await expect(service.decreaseStock(productId, 6)).rejects.toMatchObject({ code: 'INVENTORY_CONFLICT' });
    await expect(service.increaseStock(productId, MAX_STOCK)).rejects.toMatchObject({ code: 'INVENTORY_CONFLICT' });
    await expect(service.setStock(productId, -1)).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    await expect(service.setStock('invalid', 1)).rejects.toMatchObject({ code: 'INVALID_PRODUCT_ID' });
    database.$queryRaw.mockResolvedValue([]);
    await expect(service.setStock(productId, 1)).rejects.toMatchObject({ code: 'INVENTORY_NOT_FOUND' });
    expect(database.inventory.update).not.toHaveBeenCalled();
  });
  it('supports an existing transaction without nesting and guards the locked snapshot', async () => {
    await new InventoryService().setStock(productId, 0, database as unknown as Parameters<InventoryService['setStock']>[2]);
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.inventory.update).toHaveBeenCalledWith({ where: { productId, quantity: 5, lowStockAt: 5 }, data: { quantity: 0, status: 'OUT_OF_STOCK' } });
  });
  it('validates current snapshots without exposing inactive Products as purchasable', async () => {
    const service = new InventoryService();
    database.product.findUnique.mockResolvedValue({ status: 'INACTIVE', category: { isActive: true }, inventory: { quantity: 0, lowStockAt: 5 } });
    await expect(service.validateRequestedQuantity(productId, 1)).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    database.product.findUnique.mockResolvedValue(null);
    await expect(service.getSnapshot(productId)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });
});
