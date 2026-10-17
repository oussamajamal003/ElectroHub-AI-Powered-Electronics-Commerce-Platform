import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { ConfirmationSignalUncertain, announceConfirmation } from './confirmationSignal';

vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<object>()), apiClient: vi.fn() }));
const call = vi.mocked(apiClient);
const SIGNAL = '/api/checkout/payment-attempts/a1/confirmation-started'; const STATUS = '/api/checkout/payment-attempts/a1';
beforeEach(() => call.mockReset());

describe('announceConfirmation', () => {
  it('resolves once the backend records the signal', async () => {
    call.mockResolvedValueOnce({ data: {} });
    await expect(announceConfirmation('a1')).resolves.toBeUndefined();
    expect(call).toHaveBeenCalledWith(SIGNAL, expect.objectContaining({ method: 'POST' }));
  });
  it('a lost response is resolved by reading server truth: persisted means safe to confirm, without a second post', async () => {
    call.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ data: { confirmationStartedAt: '2026-10-16T12:00:00Z' } });
    await expect(announceConfirmation('a1')).resolves.toBeUndefined();
    expect(call.mock.calls.map(item => item[0])).toEqual([SIGNAL, STATUS]);
  });
  it('a timeout with no persisted signal retries the idempotent post once', async () => {
    call.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError')).mockResolvedValueOnce({ data: { confirmationStartedAt: null } }).mockResolvedValueOnce({ data: {} });
    await expect(announceConfirmation('a1')).resolves.toBeUndefined();
    expect(call.mock.calls.map(item => item[0])).toEqual([SIGNAL, STATUS, SIGNAL]);
  });
  it('stays uncertain, so Stripe confirmation is never started, when neither the signal nor the status read succeeds', async () => {
    call.mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline'));
    await expect(announceConfirmation('a1')).rejects.toBeInstanceOf(ConfirmationSignalUncertain);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('a definitive refusal (409) blocks confirmation without any guessing read', async () => {
    call.mockRejectedValueOnce(new ApiError(409, 'no', undefined, 'PAYMENT_CONFIRMATION_NOT_ALLOWED'));
    await expect(announceConfirmation('a1')).rejects.toBeInstanceOf(ConfirmationSignalUncertain);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
