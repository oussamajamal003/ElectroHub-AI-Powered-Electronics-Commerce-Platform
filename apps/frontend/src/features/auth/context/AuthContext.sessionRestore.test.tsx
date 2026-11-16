import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query';
import { ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from './AuthContext';
import { authApi } from '../api/auth';

vi.mock('../api/auth', () => ({ authApi: { refreshSession: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() } }));

const customer = { id: '11111111-1111-4111-8111-111111111111', email: 'c@example.invalid', firstName: 'C', lastName: 'U', role: 'CUSTOMER' };
function State() {
  const auth = useAuth();
  return <><output data-testid="state">{auth.isSessionVerified ? auth.isAuthenticated ? 'VERIFIED_SIGNED_IN' : 'VERIFIED_GUEST' : auth.sessionUnavailable ? 'UNAVAILABLE' : 'RESTORING'}</output>
    <button onClick={auth.retrySession}>Retry session</button></>;
}
const mount = () => render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><AuthProvider><State /></AuthProvider></MemoryRouter></QueryClientProvider>);
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('session restore never leaves screens loading forever', () => {
  it.each([['HTTP 503', new ApiError(503, 'unavailable')], ['HTTP 500', new ApiError(500, 'error')], ['network failure', new ApiError(0, 'Unable to connect.')]])(
    '%s: bounded automatic retries, then an unavailable verdict that is neither signed in nor guest', async (_name, failure) => {
      vi.mocked(authApi.refreshSession).mockRejectedValue(failure);
      mount();
      await advance(0);
      expect(state()).toBe('RESTORING');
      await advance(2_000 + 4_000);
      expect(authApi.refreshSession).toHaveBeenCalledTimes(3);
      expect(state()).toBe('UNAVAILABLE');
      await advance(60_000);
      expect(authApi.refreshSession).toHaveBeenCalledTimes(3); // no endless request loop
      expect(state()).toBe('UNAVAILABLE');
    });
  it('a customer retry starts one new bounded cycle and a recovered backend verifies the session', async () => {
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(503, 'unavailable'));
    mount(); await advance(6_000);
    expect(state()).toBe('UNAVAILABLE');
    vi.mocked(authApi.refreshSession).mockResolvedValue({ accessToken: 'test-token' });
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: customer } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry session' }));
    await advance(0);
    expect(state()).toBe('VERIFIED_SIGNED_IN');
    expect(authApi.refreshSession).toHaveBeenCalledTimes(4);
  });
  it('recovers automatically when the backend returns within the bounded attempts', async () => {
    vi.mocked(authApi.refreshSession).mockRejectedValueOnce(new ApiError(0, 'Unable to connect.')).mockResolvedValue({ accessToken: 'test-token' });
    vi.mocked(authApi.getCurrentUser).mockResolvedValue({ user: customer } as never);
    mount(); await advance(0);
    expect(state()).toBe('RESTORING');
    await advance(2_000);
    expect(state()).toBe('VERIFIED_SIGNED_IN');
  });
  it('an authoritative 401 is a verified guest immediately, with no retries', async () => {
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(401, 'No session'));
    mount(); await advance(10_000);
    expect(state()).toBe('VERIFIED_GUEST');
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  });
  it('/me failing with 5xx after a successful refresh is also bounded', async () => {
    vi.mocked(authApi.refreshSession).mockResolvedValue({ accessToken: 'test-token' });
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new ApiError(503, 'unavailable'));
    mount(); await advance(6_000);
    expect(state()).toBe('UNAVAILABLE');
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(3);
  });
  it('retrying after a verified session does nothing', async () => {
    vi.mocked(authApi.refreshSession).mockRejectedValue(new ApiError(401, 'No session'));
    mount(); await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry session' }));
    await advance(10_000);
    expect(authApi.refreshSession).toHaveBeenCalledTimes(1);
  });
});
