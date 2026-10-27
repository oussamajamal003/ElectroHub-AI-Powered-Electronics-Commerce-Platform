import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { requestOverdueRecovery } from './overdueRecovery';

vi.mock('@/lib/api', () => ({ apiClient: vi.fn() }));

describe('Task 03.8: overdue recovery is an explicit, throttled POST (the purchases GET is read-only)', () => {
  beforeEach(() => { vi.mocked(apiClient).mockReset().mockResolvedValue({}); });
  it('posts at most once per 30 s per account, and never without an account', () => {
    requestOverdueRecovery('', 1_000);
    requestOverdueRecovery('account-a', 1_000);
    requestOverdueRecovery('account-a', 20_000);
    requestOverdueRecovery('account-b', 20_000);
    requestOverdueRecovery('account-a', 31_001);
    expect(vi.mocked(apiClient).mock.calls).toEqual([
      ['/api/checkout/payment-attempts/recover-overdue', { method: 'POST', data: {} }],
      ['/api/checkout/payment-attempts/recover-overdue', { method: 'POST', data: {} }],
      ['/api/checkout/payment-attempts/recover-overdue', { method: 'POST', data: {} }],
    ]);
  });
  it('a failed recovery request never surfaces as a purchase error', async () => {
    vi.mocked(apiClient).mockRejectedValue(new Error('503'));
    expect(() => requestOverdueRecovery('account-c', 1_000)).not.toThrow();
    await Promise.resolve();
  });
});
