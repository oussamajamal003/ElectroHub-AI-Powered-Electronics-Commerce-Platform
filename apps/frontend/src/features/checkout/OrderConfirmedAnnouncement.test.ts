import { describe, expect, it, vi } from 'vitest';
import { announceOrderConfirmed, ORDER_CONFIRMED_TEXT, ORDER_CONFIRMED_TITLE } from './PaymentPurchases';

vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

describe('single order-confirmed announcement', () => {
  it('fires once per owner and attempt: repeats from polling, remounts or refresh handlers are ignored', () => {
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('electrohub:order-confirmed', listener);
    try {
      const detail = { owner: 'owner-a', attemptId: 'attempt-1', orderReference: 'ORD-1' };
      announceOrderConfirmed(detail);
      announceOrderConfirmed(detail);
      announceOrderConfirmed({ ...detail });
      expect(seen).toEqual([detail]);
      announceOrderConfirmed({ owner: 'owner-b', attemptId: 'attempt-1', orderReference: 'ORD-1' });
      announceOrderConfirmed({ owner: 'owner-a', attemptId: 'attempt-2', orderReference: 'ORD-2' });
      expect(seen).toHaveLength(3);
      announceOrderConfirmed({ owner: '', attemptId: 'attempt-3', orderReference: 'ORD-3' });
      announceOrderConfirmed({ owner: 'owner-a', attemptId: 'attempt-4', orderReference: '' });
      expect(seen).toHaveLength(3);
    } finally { window.removeEventListener('electrohub:order-confirmed', listener); }
  });
  it('uses the approved copy and makes no email claim', () => {
    expect(ORDER_CONFIRMED_TITLE).toBe('Order confirmed! 🎉');
    expect(ORDER_CONFIRMED_TEXT).toBe('Your payment was successful. Your order is ready to view.');
    expect(`${ORDER_CONFIRMED_TITLE} ${ORDER_CONFIRMED_TEXT}`).not.toMatch(/email|inbox|sent|delivered/i);
  });
});
