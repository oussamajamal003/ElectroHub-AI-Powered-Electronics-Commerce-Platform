import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AdminInventoryService } from './admin-inventory.service.js';
import { AdminCustomerService } from './admin-customer.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import type { InventoryService } from './inventory.service.js';

const publisher = vi.hoisted(() => ({ disconnectUser: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));
vi.mock('../sockets/delivery.publisher.js', () => ({ DeliveryPublisher: publisher }));

const PRODUCT = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const ADMIN = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const CUSTOMER = '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33';
const stamp = new Date('2026-11-01T10:00:00.000Z');

/** A Prisma double whose interactive transaction runs the callback against the same mocks (the row lock is a $queryRaw call). */
function database() {
  const db = {
    product: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    inventory: { create: vi.fn(), update: vi.fn() },
    category: { delete: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    productSpecification: { deleteMany: vi.fn(), createMany: vi.fn() },
    user: { findFirst: vi.fn(), update: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    order: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    address: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  return db;
}
const inventoryRow = (quantity: number) => ({ id: PRODUCT, name: 'QA Probe', sku: 'QA-1', status: 'ACTIVE', isTestFixture: false,
  category: { id: PRODUCT, name: 'Audio', isActive: true }, inventory: { quantity, lowStockAt: 5, updatedAt: stamp }, images: [] });

describe('AdminInventoryService.adjust', () => {
  let db: ReturnType<typeof database>;
  let stock: { setStock: ReturnType<typeof vi.fn>; increaseStock: ReturnType<typeof vi.fn> };
  let service: AdminInventoryService;
  beforeEach(() => {
    db = database();
    stock = { setStock: vi.fn(), increaseStock: vi.fn() };
    service = new AdminInventoryService(db as unknown as PrismaClient, stock as unknown as InventoryService);
  });

  it('applies a restock once, under the row lock, through InventoryService', async () => {
    db.product.findUnique.mockResolvedValueOnce({ isTestFixture: false }).mockResolvedValue(inventoryRow(9));
    db.$queryRaw.mockResolvedValue([{ quantity: 4, lowStockAt: 5 }]);
    stock.increaseStock.mockResolvedValue({ quantity: 9 });
    const result = await service.adjust(ADMIN, PRODUCT, { operation: 'RESTOCK', quantity: 5, expectedQuantity: 4, reason: undefined });
    expect(stock.increaseStock).toHaveBeenCalledTimes(1);
    expect(stock.increaseStock).toHaveBeenCalledWith(PRODUCT, 5, db);
    expect(String(db.$queryRaw.mock.calls[0]![0].strings.join(''))).toContain('FOR UPDATE');
    expect(result.quantity).toBe(9);
  });

  it('rejects a resubmitted restock (stale expected quantity) with the current row instead of applying it twice', async () => {
    db.product.findUnique.mockResolvedValueOnce({ isTestFixture: false }).mockResolvedValue(inventoryRow(9));
    db.$queryRaw.mockResolvedValue([{ quantity: 9, lowStockAt: 5 }]);
    await expect(service.adjust(ADMIN, PRODUCT, { operation: 'RESTOCK', quantity: 5, expectedQuantity: 4, reason: undefined }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVENTORY_CONFLICT', current: expect.objectContaining({ quantity: 9 }) });
    expect(stock.increaseStock).not.toHaveBeenCalled();
    expect(stock.setStock).not.toHaveBeenCalled();
  });

  it('treats a serialization failure as a conflict, never as success', async () => {
    const { Prisma } = await import('@prisma/client');
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }));
    db.product.findUnique.mockResolvedValue(inventoryRow(7));
    await expect(service.adjust(ADMIN, PRODUCT, { operation: 'SET', quantity: 3, expectedQuantity: 7, reason: undefined }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVENTORY_CONFLICT' });
  });

  it('refuses QA fixtures and only lets an absolute SET start tracking an untracked product', async () => {
    db.product.findUnique.mockResolvedValueOnce({ isTestFixture: true });
    await expect(service.adjust(ADMIN, PRODUCT, { operation: 'SET', quantity: 1, expectedQuantity: null, reason: undefined })).rejects.toMatchObject({ statusCode: 404 });
    db.product.findUnique.mockResolvedValueOnce({ isTestFixture: false });
    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.adjust(ADMIN, PRODUCT, { operation: 'RESTOCK', quantity: 2, expectedQuantity: null, reason: undefined }))
      .rejects.toMatchObject({ statusCode: 409, code: 'INVENTORY_NOT_FOUND' });
    expect(db.inventory.create).not.toHaveBeenCalled();
  });
});

describe('AdminCustomerService.setStatus', () => {
  let db: ReturnType<typeof database>;
  let service: AdminCustomerService;
  const user = (overrides: object = {}) => ({ email: 'qa.customer@example.test', isActive: true, updatedAt: stamp, ...overrides });
  beforeEach(() => {
    db = database();
    publisher.disconnectUser.mockReset();
    service = new AdminCustomerService(db as unknown as PrismaClient);
    db.$queryRaw.mockResolvedValue([]);
  });

  it('never lets an administrator change their own account', async () => {
    await expect(service.setStatus(ADMIN, ADMIN, false, stamp.toISOString())).rejects.toMatchObject({ statusCode: 409, code: 'CUSTOMER_SELF_CHANGE' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('deactivates under the token-lifecycle lock, revokes refresh tokens and closes sockets after commit', async () => {
    db.user.findFirst.mockResolvedValueOnce(user()).mockResolvedValue({ id: CUSTOMER, email: 'qa.customer@example.test', firstName: 'QA', lastName: 'Customer',
      isActive: false, emailVerifiedAt: null, createdAt: stamp, updatedAt: stamp });
    await service.setStatus(ADMIN, CUSTOMER, false, stamp.toISOString());
    expect(String(db.$executeRaw.mock.calls[0]![0].join(''))).toContain('pg_advisory_xact_lock');
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: CUSTOMER }, data: { isActive: false } });
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: CUSTOMER, isRevoked: false } }));
    expect(publisher.disconnectUser).toHaveBeenCalledWith(CUSTOMER, 'ACCOUNT_DEACTIVATED');
  });

  it('refuses stale versions and anonymized (deleted) accounts without writing', async () => {
    db.user.findFirst.mockResolvedValueOnce(user({ updatedAt: new Date('2026-11-02T00:00:00.000Z') }));
    await expect(service.setStatus(ADMIN, CUSTOMER, false, stamp.toISOString())).rejects.toMatchObject({ code: 'CUSTOMER_CONFLICT' });
    db.user.findFirst.mockResolvedValueOnce(user({ email: `deleted-${CUSTOMER}@deleted.invalid`, isActive: false }));
    await expect(service.setStatus(ADMIN, CUSTOMER, true, stamp.toISOString())).rejects.toMatchObject({ code: 'CUSTOMER_DELETED' });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(publisher.disconnectUser).not.toHaveBeenCalled();
  });
});

describe('AdminCatalogService safety rules', () => {
  let db: ReturnType<typeof database>;
  let service: AdminCatalogService;
  beforeEach(() => { db = database(); service = new AdminCatalogService(db as unknown as PrismaClient); });

  it('will not activate a product inside a hidden category', async () => {
    db.product.findUnique.mockResolvedValue({ isTestFixture: false, status: 'INACTIVE', category: { isActive: false } });
    await expect(service.setProductStatus(ADMIN, PRODUCT, 'ACTIVE', stamp.toISOString())).rejects.toMatchObject({ statusCode: 409, code: 'CATEGORY_INACTIVE' });
    expect(db.product.updateMany).not.toHaveBeenCalled();
  });

  it('archives with an optimistic version check and reports a concurrent edit as PRODUCT_CONFLICT', async () => {
    db.product.findUnique.mockResolvedValue({ isTestFixture: false, status: 'ACTIVE', category: { isActive: true } });
    db.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.setProductStatus(ADMIN, PRODUCT, 'INACTIVE', stamp.toISOString())).rejects.toMatchObject({ code: 'PRODUCT_CONFLICT' });
    expect(db.product.updateMany).toHaveBeenCalledWith({ where: { id: PRODUCT, updatedAt: stamp }, data: { status: 'INACTIVE' } });
  });

  it('creates categories hidden, overriding the visible schema default', async () => {
    db.category.findFirst.mockResolvedValue(null);
    db.category.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: PRODUCT, name: 'QA 05.1', slug: 'qa-05-1', description: null,
      isActive: false, createdAt: stamp, updatedAt: stamp, _count: { products: 0 } });
    db.category.create.mockResolvedValue({ id: PRODUCT });
    await service.createCategory(ADMIN, { name: 'QA 05.1', slug: undefined, description: null }).catch(() => undefined);
    expect(db.category.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
  });

  it('only deletes a category that no product references, under a row lock', async () => {
    db.$queryRaw.mockResolvedValue([{ id: PRODUCT }]);
    db.product.count.mockResolvedValue(2);
    await expect(service.deleteCategory(ADMIN, PRODUCT)).rejects.toMatchObject({ statusCode: 409, code: 'CATEGORY_IN_USE' });
    expect(db.category.delete).not.toHaveBeenCalled();
    db.product.count.mockResolvedValue(0);
    await service.deleteCategory(ADMIN, PRODUCT);
    expect(db.category.delete).toHaveBeenCalledWith({ where: { id: PRODUCT } });
    expect(String(db.$queryRaw.mock.calls[0]![0].join(''))).toContain('FOR UPDATE');
  });
});
