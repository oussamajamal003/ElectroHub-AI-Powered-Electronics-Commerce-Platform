import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AppError } from '../middleware/errorHandler.js';

const audit = vi.hoisted(() => ({ recordAdminAudit: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));
vi.mock('./admin-audit.js', () => ({ recordAdminAudit: audit.recordAdminAudit }));

const ADMIN = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const A = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const B = '2d6cc2b3-6a1f-4b8e-8e5f-3c9e2a1b0d22';
const C = '3e7dd3c4-7b2f-4c9b-9f6a-4d0f3b2c1e33';
const stamp = '2026-11-01T10:00:00.000Z';

function database() {
  const db = {
    product: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  return db;
}
const row = (status: 'ACTIVE' | 'INACTIVE', categoryActive = true) => ({ isTestFixture: false, status, category: { isActive: categoryActive } });

describe('AdminCatalogService.bulkSetProductStatus', () => {
  let db: ReturnType<typeof database>;
  let service: AdminCatalogService;
  beforeEach(() => {
    vi.clearAllMocks();
    db = database();
    service = new AdminCatalogService(db as unknown as PrismaClient);
  });

  it('reports mixed outcomes per item and reuses the single-item policy for each row', async () => {
    db.product.findUnique
      .mockResolvedValueOnce(row('ACTIVE'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row('ACTIVE'));
    db.product.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const { results, summary } = await service.bulkSetProductStatus(ADMIN, 'INACTIVE', [
      { id: A, expectedUpdatedAt: stamp }, { id: B, expectedUpdatedAt: stamp }, { id: C, expectedUpdatedAt: stamp },
    ]);

    expect(results.map(r => [r.id, r.outcome])).toEqual([[A, 'UPDATED'], [B, 'NOT_FOUND'], [C, 'CONFLICT']]);
    expect(summary).toEqual({ updated: 1, unchanged: 0, conflict: 1, notFound: 1, rejected: 0 });
    expect(db.product.updateMany).toHaveBeenNthCalledWith(1, { where: { id: A, updatedAt: new Date(stamp) }, data: { status: 'INACTIVE' } });
    expect(db.product.updateMany).toHaveBeenNthCalledWith(2, { where: { id: C, updatedAt: new Date(stamp) }, data: { status: 'INACTIVE' } });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('rejects reactivation inside a hidden category per item without blocking the rest', async () => {
    db.product.findUnique
      .mockResolvedValueOnce(row('INACTIVE', false))
      .mockResolvedValueOnce(row('INACTIVE', true));
    db.product.updateMany.mockResolvedValueOnce({ count: 1 });

    const { results, summary } = await service.bulkSetProductStatus(ADMIN, 'ACTIVE', [
      { id: A, expectedUpdatedAt: stamp }, { id: B, expectedUpdatedAt: stamp },
    ]);

    expect(results[0]).toMatchObject({ id: A, outcome: 'REJECTED' });
    expect(results[1]).toMatchObject({ id: B, outcome: 'UPDATED' });
    expect(summary).toMatchObject({ updated: 1, rejected: 1 });
    expect(db.product.updateMany).toHaveBeenCalledTimes(1);
  });

  it('reports an already-matching item as UNCHANGED without writing when its version still matches, and as CONFLICT when stale', async () => {
    db.product.findUnique.mockResolvedValueOnce(row('INACTIVE')).mockResolvedValueOnce(row('INACTIVE'));
    db.product.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const { results, summary } = await service.bulkSetProductStatus(ADMIN, 'INACTIVE', [
      { id: A, expectedUpdatedAt: stamp }, { id: B, expectedUpdatedAt: stamp },
    ]);

    expect(results.map(r => r.outcome)).toEqual(['UNCHANGED', 'CONFLICT']);
    expect(summary).toMatchObject({ unchanged: 1, conflict: 1 });
    expect(db.product.updateMany).not.toHaveBeenCalled();
  });

  it('turns an unexpected database failure into a per-item REJECTED without leaking the error', async () => {
    db.product.findUnique.mockRejectedValueOnce(new Error('connection string postgres://secret'));
    db.product.findUnique.mockResolvedValueOnce(row('ACTIVE'));
    db.product.updateMany.mockResolvedValueOnce({ count: 1 });

    const { results } = await service.bulkSetProductStatus(ADMIN, 'INACTIVE', [
      { id: A, expectedUpdatedAt: stamp }, { id: B, expectedUpdatedAt: stamp },
    ]);

    expect(results[0]).toEqual({ id: A, outcome: 'REJECTED', message: 'This product could not be changed. Try again.' });
    expect(results[1]).toMatchObject({ id: B, outcome: 'UPDATED' });
    expect(JSON.stringify(results)).not.toContain('postgres://');
  });

  it('maps a Prisma write conflict (P2034) to CONFLICT', async () => {
    db.product.findUnique.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }));
    const { results } = await service.bulkSetProductStatus(ADMIN, 'INACTIVE', [{ id: A, expectedUpdatedAt: stamp }]);
    expect(results[0]).toMatchObject({ outcome: 'CONFLICT' });
  });

  it('writes exactly one sanitized audit row: SUCCESS when everything applied, PARTIAL when any item failed', async () => {
    db.product.findUnique.mockResolvedValueOnce(row('ACTIVE'));
    db.product.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.bulkSetProductStatus(ADMIN, 'INACTIVE', [{ id: A, expectedUpdatedAt: stamp }]);
    expect(audit.recordAdminAudit).toHaveBeenCalledTimes(1);
    expect(audit.recordAdminAudit).toHaveBeenCalledWith({ actorId: ADMIN, action: 'PRODUCT_BULK_STATUS', resourceType: 'product', outcome: 'SUCCESS',
      details: { status: 'INACTIVE', counts: { updated: 1, unchanged: 0, conflict: 0, notFound: 0, rejected: 0 }, ids: [A] } });

    audit.recordAdminAudit.mockClear();
    db.product.findUnique.mockResolvedValueOnce(null);
    await service.bulkSetProductStatus(ADMIN, 'INACTIVE', [{ id: B, expectedUpdatedAt: stamp }]);
    expect(audit.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'PARTIAL' }));
  });

  it('keeps the single-item endpoint behaviour: a stale archive still raises PRODUCT_CONFLICT and writes no audit row', async () => {
    db.product.findUnique.mockResolvedValue(row('ACTIVE'));
    db.product.updateMany.mockResolvedValue({ count: 0 });
    const failure = await service.setProductStatus(ADMIN, A, 'INACTIVE', stamp).catch(error => error);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: 'PRODUCT_CONFLICT' });
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
  });
});
