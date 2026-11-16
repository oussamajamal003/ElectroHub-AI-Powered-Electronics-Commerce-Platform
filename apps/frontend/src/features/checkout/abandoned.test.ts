import { describe, expect, it } from 'vitest';
import { isNotifiableOutcome } from './PaymentPurchases';

describe('abandoned card entry is not a payment failure', () => {
  it('never raises a result toast for an ABANDONED classification', () => {
    expect(isNotifiableOutcome({ state: 'CANCELED', classification: 'ABANDONED' })).toBe(false);
  });
  it('still notifies for genuine failures and success', () => {
    expect(isNotifiableOutcome({ state: 'DECLINED', classification: 'DECLINED' })).toBe(true);
    expect(isNotifiableOutcome({ state: 'PAID', classification: 'SUCCEEDED' })).toBe(true);
  });
});
