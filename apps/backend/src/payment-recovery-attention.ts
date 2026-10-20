import type { PrismaClient } from '@prisma/client';
import { RECOVERY_ALERT_AGE_MS } from './payment-recovery-loop.js';
import { paymentWorkScopeWhere, type PaymentWorkScope } from './services/payment.service.js';

/** Same bounded escalation query for both owners of the existing recovery loop. */
export async function paymentRecoveryAttention(database: PrismaClient, scope?: PaymentWorkScope) {
  const now = new Date();
  const rows = await database.paymentWork.findMany({ where: {
    ...paymentWorkScopeWhere(scope),
    OR: [{ state: 'INCIDENT' }, { state: { in: ['READY', 'LEASED'] },
      attempt: { submittedAt: { lte: new Date(now.getTime() - RECOVERY_ALERT_AGE_MS) } } }],
  }, orderBy: { updatedAt: 'asc' }, take: 10,
  select: { attemptId: true, state: true, retryCount: true, leaseUntil: true } });
  return rows.map(row => ({ attemptId: row.attemptId, state: row.state, retryCount: row.retryCount,
    leaseExpired: row.state === 'LEASED' && Boolean(row.leaseUntil && row.leaseUntil < now) }));
}
