import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import { usePaymentCapability } from './paymentCapability';

const auth = vi.hoisted(() => ({ user: { id: 'customer-a' } as { id: string } | null, isSessionVerified: true }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {}, apiClient: vi.fn() }));

function mountHook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client }, children);
  return { ...renderHook(() => usePaymentCapability(), { wrapper }), client };
}

beforeEach(() => {
  auth.user = { id: 'customer-a' };
  auth.isSessionVerified = true;
  vi.resetAllMocks();
});

it('returns the backend capability after the verified session query succeeds', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: { paymentsEnabled: true } } as never);
  const { result } = mountHook();
  await waitFor(() => expect(result.current).toBe(true));
  expect(apiClient).toHaveBeenCalledWith('/api/checkout/payment-capability', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('returns unknown when capability lookup fails instead of reusing stale cached availability', async () => {
  vi.mocked(apiClient).mockRejectedValue(new Error('backend unavailable'));
  const { result, client } = mountHook();
  client.setQueryData(['payment-capability', 'customer-a'], { paymentsEnabled: true });
  await waitFor(() => expect(result.current).toBeUndefined());
});

it('does not expose cached capability while the session is unverified', () => {
  auth.isSessionVerified = false;
  const { result, client } = mountHook();
  client.setQueryData(['payment-capability', 'customer-a'], { paymentsEnabled: true });
  expect(result.current).toBeUndefined();
  expect(apiClient).not.toHaveBeenCalled();
});

it('returns false only when the backend explicitly disables payment actions', async () => {
  vi.mocked(apiClient).mockResolvedValue({ data: { paymentsEnabled: false } } as never);
  const { result } = mountHook();
  await waitFor(() => expect(result.current).toBe(false));
});
