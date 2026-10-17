import type { PrismaClient } from '@prisma/client';
import { afterEach, expect, it, vi } from 'vitest';
import { paymentRecoveryAttention } from '../../payment-recovery-attention.js';

afterEach(() => vi.useRealTimers());
it('preserves exact-attempt scope and emits bounded lease/incident evidence for either runner', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T18:00:00Z'));
  const findMany = vi.fn().mockResolvedValue([{ attemptId: 'owned', state: 'LEASED', retryCount: 2, leaseUntil: new Date(Date.now() - 1) }]);
  const rows = await paymentRecoveryAttention({ paymentWork: { findMany } } as unknown as PrismaClient, ['owned']);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { attemptId: { in: ['owned'] }, OR: [{ state: 'INCIDENT' }, {
      state: { in: ['READY', 'LEASED'] }, attempt: { submittedAt: { lte: new Date('2026-10-16T17:30:00Z') } },
    }] }, take: 10,
  }));
  expect(rows).toEqual([{ attemptId: 'owned', state: 'LEASED', retryCount: 2, leaseExpired: true }]);
});
