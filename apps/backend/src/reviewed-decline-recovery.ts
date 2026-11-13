import type { PaymentAttempt, PaymentWork, PrismaClient } from '@prisma/client';
import { AppError } from './middleware/errorHandler.js';
import { paymentIsolation } from './payment-isolation.js';
import { verifyBinding, type PaymentProvider } from './services/payment.domain.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const select = { id: true, state: true, failureCode: true, providerStatus: true, submittedAt: true, cancelRequested: true, orderId: true,
  providerIntentId: true, stripeAccountId: true, amountCents: true, currency: true,
  work: { select: { state: true, leaseToken: true, leaseUntil: true, lastError: true } } } as const;
type Snapshot = Pick<PaymentAttempt, 'id' | 'state' | 'failureCode' | 'providerStatus' | 'submittedAt' | 'cancelRequested' | 'orderId' |
  'providerIntentId' | 'stripeAccountId' | 'amountCents' | 'currency'> & {
    work: Pick<PaymentWork, 'state' | 'leaseToken' | 'leaseUntil' | 'lastError'> | null;
  };
const changed = () => new AppError('Reviewed decline changed; operator review is required.', 409, 'REVIEWED_DECLINE_CHANGED');
function assertDecline(attempt: Snapshot | null): asserts attempt is Snapshot & { providerIntentId: string } {
  if (!attempt || attempt.state !== 'DECLINED' || attempt.failureCode !== 'PAYMENT_DECLINED' || attempt.providerStatus !== 'requires_payment_method' ||
    !attempt.submittedAt || attempt.cancelRequested || attempt.orderId || !attempt.providerIntentId || attempt.work?.state !== 'READY' ||
    attempt.work.leaseToken || attempt.work.leaseUntil || attempt.work.lastError) throw changed();
}

/**
 * Authenticated supervisor exact-ID policy only. This pass has no provider mutation
 * methods and writes only PaymentWork. It never runs the general payment state
 * machine, so provider drift cannot accidentally capture/cancel/refund a purchase.
 */
export async function reconcileReviewedDecline(db: PrismaClient, provider: Pick<PaymentProvider, 'retrieve'>, ids: readonly string[]): Promise<number> {
  const id = ids[0];
  if (!paymentIsolation().allowed || ids.length !== 1 || typeof id !== 'string' || !UUID.test(id)) throw changed();
  const before = await db.paymentAttempt.findUnique({ where: { id }, select });
  if (before?.work?.state === 'DONE') return 0;
  assertDecline(before);
  const intent = await provider.retrieve(before.providerIntentId);
  verifyBinding(before, intent);
  if (intent.livemode !== false || intent.status !== 'requires_payment_method' || intent.declined !== true || intent.received !== 0 || intent.capturable !== 0) throw changed();
  return db.$transaction(async tx => {
    // Same attempt-then-work lock order as the existing payment state machine.
    await tx.$queryRaw`SELECT id FROM payment_attempts WHERE id=${id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payment_work WHERE "attemptId"=${id}::uuid FOR UPDATE`;
    const current = await tx.paymentAttempt.findUnique({ where: { id }, select });
    assertDecline(current);
    verifyBinding(current, intent);
    const result = await tx.paymentWork.updateMany({ where: { attemptId: id, state: 'READY', leaseToken: null, leaseUntil: null, lastError: null },
      data: { state: 'DONE', nextRunAt: new Date(Date.now() + 10_000), retryCount: 0 } });
    if (result.count !== 1) throw changed();
    return 1;
  }, { maxWait: 5000, timeout: 10000 });
}
