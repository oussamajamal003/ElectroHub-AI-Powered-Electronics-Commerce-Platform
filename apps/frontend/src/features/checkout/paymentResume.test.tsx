import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { PaymentRetryPage } from './PaymentRetryPage';
import { PaymentResumeError, RESUME_DEADLINE_MS, resumeSavedPayment } from './paymentResume';

vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), apiClient: vi.fn() }));

const setup = { attemptId: 'saved-a', clientSecret: 'pi_saved_secret_fixture', total: '199.00', currency: 'USD',
  items: [{ name: 'Product A', quantity: 2 }], request: { shipping: { recipient: 'Saved Person', line1: 'Saved Street', city: 'Saved City' }, deliveryMethod: 'STANDARD' } };
const resumeCalls = () => vi.mocked(apiClient).mock.calls.filter(([url]) => String(url).endsWith('/resume'));
/** Barrier: the request stays in flight until the test releases or rejects it. */
const held: ((error: unknown) => void)[] = [];
function heldResume() {
  let release!: (value: unknown) => void;
  const signals: AbortSignal[] = [];
  vi.mocked(apiClient).mockImplementation((_url, options) => {
    if (options?.signal) signals.push(options.signal);
    return new Promise((resolve, fail) => { release = resolve; held.push(fail);
      options?.signal?.addEventListener('abort', () => fail(new DOMException('The user aborted a request.', 'AbortError'))); });
  });
  return { release: (value: unknown = { data: setup }) => act(async () => { release(value); }), signals };
}
beforeEach(() => { vi.resetAllMocks(); });
// The in-flight map is module state by design: settle every barrier so no test joins another test's request.
afterEach(async () => { vi.useRealTimers(); for (const fail of held.splice(0)) fail(new Error('test cleanup')); await act(async () => { await Promise.resolve(); }); });

describe('saved-payment resume: one request per customer and attempt', () => {
  it('concurrent callers share one promise and never abort it; a settled request is not cached and the next call re-verifies', async () => {
    const barrier = heldResume();
    const [a, b] = [resumeSavedPayment('customer-a', 'saved-a'), resumeSavedPayment('customer-a', 'saved-a')];
    expect(a).toBe(b); expect(resumeCalls()).toHaveLength(1);
    expect(barrier.signals.every(signal => !signal.aborted)).toBe(true);
    await barrier.release(); await expect(a).resolves.toMatchObject({ attemptId: 'saved-a' });
    vi.mocked(apiClient).mockResolvedValue({ data: setup });
    await resumeSavedPayment('customer-a', 'saved-a');
    expect(resumeCalls()).toHaveLength(2);
  });
  it('never shares a request across customers or attempts', () => {
    heldResume();
    void resumeSavedPayment('customer-a', 'saved-a').catch(() => undefined);
    void resumeSavedPayment('customer-b', 'saved-a').catch(() => undefined);
    void resumeSavedPayment('customer-a', 'saved-b').catch(() => undefined);
    expect(resumeCalls().map(([url]) => url)).toEqual(['/api/checkout/payment-attempts/saved-a/resume',
      '/api/checkout/payment-attempts/saved-a/resume', '/api/checkout/payment-attempts/saved-b/resume']);
  });
});

describe('saved-payment resume: outcome classification', () => {
  it('the 25-second deadline aborts the request and is classified as timeout, never as a payment failure', async () => {
    vi.useFakeTimers(); const barrier = heldResume();
    const request = resumeSavedPayment('customer-a', 'saved-a'); const settled = request.catch((error: unknown) => error);
    await act(async () => { await vi.advanceTimersByTimeAsync(RESUME_DEADLINE_MS - 1); });
    expect(barrier.signals[0]?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(barrier.signals[0]?.aborted).toBe(true);
    expect(await settled).toMatchObject({ kind: 'timeout' });
    expect(resumeCalls()).toHaveLength(1);
  });
  it.each([['HTTP 503', new ApiError(503, 'unavailable')], ['HTTP 500', new ApiError(500, 'error')], ['offline', new ApiError(0, 'Unable to connect.')],
    ['rate limited', new ApiError(429, 'slow down')], ['unexpected', new Error('socket hang up')]])('%s is a transport failure, not a server decision', async (_name, failure) => {
    vi.mocked(apiClient).mockRejectedValue(failure);
    await expect(resumeSavedPayment('customer-a', 'saved-a')).rejects.toMatchObject({ kind: 'transport' });
    expect(resumeCalls()).toHaveLength(1);
  });
  it.each([[409, 'PAYMENT_RECOVERY_PENDING'], [409, 'CHECKOUT_CHANGED'], [404, 'PAYMENT_ATTEMPT_NOT_FOUND']])('authoritative %i %s refusal is classified as ineligible', async (status, code) => {
    vi.mocked(apiClient).mockRejectedValue(new ApiError(status, 'refused', undefined, code));
    await expect(resumeSavedPayment('customer-a', 'saved-a')).rejects.toMatchObject({ kind: 'ineligible' });
  });
  it('rejects a response for another attempt or without a client secret', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: { ...setup, attemptId: 'other-b' } });
    await expect(resumeSavedPayment('customer-a', 'saved-a')).rejects.toMatchObject({ kind: 'identity' });
    vi.mocked(apiClient).mockResolvedValue({ data: { ...setup, clientSecret: null } });
    await expect(resumeSavedPayment('customer-a', 'saved-a')).rejects.toBeInstanceOf(PaymentResumeError);
  });
});

describe('legacy /account/payment-retry/:attemptId', () => {
  function Where() { const location = useLocation(); return <output data-testid="where">{location.pathname + location.search}</output>; }
  it('resolves to Cart history without contacting the payment service or creating an attempt', async () => {
    render(<MemoryRouter initialEntries={['/account/payment-retry/saved-a']}><Routes>
      <Route path="/account/payment-retry/:attemptId" element={<PaymentRetryPage />} /><Route path="/cart" element={<Where />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByTestId('where')).toHaveTextContent('/cart?purchase=saved-a');
    expect(apiClient).not.toHaveBeenCalled();
    expect(screen.queryByText('Complete your saved purchase')).not.toBeInTheDocument();
  });
});
