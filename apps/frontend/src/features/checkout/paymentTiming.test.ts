import { afterEach, expect, it, vi } from 'vitest';
import { markPaymentTiming } from './paymentTiming';
afterEach(() => vi.restoreAllMocks());
it('checkout marks retain correlated timings without payment secrets or customer fields', () => {
  const mark = vi.spyOn(performance, 'mark').mockImplementation(() => ({} as PerformanceMark));
  markPaymentTiming('payment-setup-start', { correlationId: '11111111-1111-4111-8111-111111111111', clientSecret: 'private', customer: 'private' });
  expect(mark).toHaveBeenCalledWith('electrohub.payment.payment-setup-start', { detail: { correlationId: '11111111-1111-4111-8111-111111111111' } });
  expect(JSON.stringify(mark.mock.calls)).not.toContain('private');
});
it('rejects unsafe mark names and bounds retained checkout measurements', () => {
  const mark = vi.spyOn(performance, 'mark').mockImplementation(() => ({} as PerformanceMark));
  const clear = vi.spyOn(performance, 'clearMarks').mockImplementation(() => {});
  markPaymentTiming('unsafe_secret'); expect(mark).not.toHaveBeenCalled();
  for (let i = 0; i < 140; i++) markPaymentTiming('status-read-start');
  expect(clear).toHaveBeenCalled();
});
