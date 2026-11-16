/**
 * Task 03.8: a disabled producer must be visible. With COMMERCE_EMAIL_ENQUEUE_ENABLED off, a successful purchase creates no email events
 * (by design, the safe default), and the process says so instead of staying silent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const logSafely = vi.hoisted(() => vi.fn());
vi.mock('../../utils/logger.js', () => ({ logSafely, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { enqueueCancellation, enqueuePaymentSucceeded } from '../commerce-email.producer.js';

describe('disabled commerce email producer', () => {
  afterEach(() => { vi.unstubAllEnvs(); logSafely.mockClear(); });
  const tx = { order: { findUnique: vi.fn() }, $queryRaw: vi.fn() };

  it('creates nothing, touches no table, and logs email_producer_disabled with a counter and the switch name only', async () => {
    vi.stubEnv('COMMERCE_EMAIL_ENQUEUE_ENABLED', 'false');
    const created = await enqueuePaymentSucceeded(tx as never, { orderId: '3f2c1a40-9b7e-4d1c-8a55-0e6d2b9c1f10', paidAt: new Date(), card: null });
    expect(created).toEqual([]);
    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    const calls = logSafely.mock.calls.filter(call => (call[2] as { event?: string }).event === 'email_producer_disabled');
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toEqual({ event: 'email_producer_disabled', skippedSinceStart: expect.any(Number), enable: 'COMMERCE_EMAIL_ENQUEUE_ENABLED' });
  });

  it('is logged on the first occurrence and every 50th afterwards, not on every purchase', async () => {
    vi.stubEnv('COMMERCE_EMAIL_ENQUEUE_ENABLED', 'false');
    const before = logSafely.mock.calls.length;
    for (let index = 0; index < 100; index++) await enqueueCancellation(tx as never, { orderId: '3f2c1a40-9b7e-4d1c-8a55-0e6d2b9c1f10', fromStatus: 'CONFIRMED',
      cancelledAt: new Date(), paymentConfirmed: true, refund: null });
    const logged = logSafely.mock.calls.slice(before).filter(call => (call[2] as { event?: string }).event === 'email_producer_disabled');
    expect(logged.length).toBeGreaterThanOrEqual(1);
    expect(logged.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(logged)).not.toMatch(/@|orderId|3f2c1a40/);
  });

  it('stays silent when the producer is enabled', async () => {
    vi.stubEnv('COMMERCE_EMAIL_ENQUEUE_ENABLED', 'true');
    tx.order.findUnique.mockResolvedValue(null);
    await expect(enqueuePaymentSucceeded(tx as never, { orderId: '3f2c1a40-9b7e-4d1c-8a55-0e6d2b9c1f10', paidAt: new Date(), card: null })).rejects.toThrow();
    expect(logSafely.mock.calls.some(call => (call[2] as { event?: string }).event === 'email_producer_disabled')).toBe(false);
  });
});
