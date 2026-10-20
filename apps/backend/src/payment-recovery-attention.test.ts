import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { paymentRecoveryAttention } from './payment-recovery-attention.js';
import { PaymentService, paymentWorkScopeWhere } from './services/payment.service.js';

// The owner-isolated incident attempt must be unreachable by a scoped worker: neither its attention scan nor its batch claim
// query can select a row outside the frozen supervisor scope.
const scope = Object.freeze(['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333']) as string[];
const isolated = '22222222-2222-4222-8222-222222222222';

describe('scoped worker queries exclude the isolated backlog attempt', () => {
  it('restricts the attention scan to the exact scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await paymentRecoveryAttention({ paymentWork: { findMany } } as unknown as PrismaClient, scope);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.attemptId).toEqual({ in: scope });
    expect(where.attemptId.in).not.toContain(isolated);
  });

  it('restricts the batch claim selection to the exact scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new PaymentService({ paymentWork: { findMany } } as unknown as PrismaClient);
    await service.runBatch(scope).catch(() => undefined);
    expect(findMany).toHaveBeenCalled();
    for (const [query] of findMany.mock.calls) expect(query.where.attemptId).toEqual({ in: scope });
  });
});

describe('governed DEV scope selects only attempts created at/after the approved boundary', () => {
  const createdSince = new Date('2026-10-20T17:00:00.000Z');
  it('applies the same creation-time filter to the batch claim and the attention scan, never an unscoped query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await new PaymentService({ paymentWork: { findMany } } as unknown as PrismaClient).runBatch({ createdSince }).catch(() => undefined);
    await paymentRecoveryAttention({ paymentWork: { findMany } } as unknown as PrismaClient, { createdSince });
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [query] of findMany.mock.calls) {
      expect(query.where.attempt).toEqual({ createdAt: { gte: createdSince } });
      expect(query.where.attemptId).toBeUndefined();
    }
  });
  it('maps every scope form explicitly', () => {
    expect(paymentWorkScopeWhere(undefined)).toEqual({});
    expect(paymentWorkScopeWhere(scope)).toEqual({ attemptId: { in: scope } });
    expect(paymentWorkScopeWhere({ createdSince })).toEqual({ attempt: { createdAt: { gte: createdSince } } });
  });
});
