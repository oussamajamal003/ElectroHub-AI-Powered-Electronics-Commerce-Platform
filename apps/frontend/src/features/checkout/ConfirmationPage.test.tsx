import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { ConfirmationPage } from './ConfirmationPage';

const apiClient = vi.fn();
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: (...args: unknown[]) => apiClient(...args) }));
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'customer-1' }, isSessionVerified: true }) }));

function renderAt(reference: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/checkout/confirmation/${reference}`]}>
    <Routes><Route path="/checkout/confirmation/:orderReference" element={<ConfirmationPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
afterEach(() => { apiClient.mockReset(); });

describe('ConfirmationPage error classification (Task 03.8)', () => {
  it('owner-scoped 404 (missing, or another account\'s order) says not found for this account without any order detail', async () => {
    apiClient.mockRejectedValue(new ApiError(404, 'Not found'));
    renderAt('ORD-B8EA06B6-5C13-472C-BFAE-08C01758AC5F');
    expect(await screen.findByText(/could not find this order for the signed-in account/)).toBeInTheDocument();
    expect(screen.queryByText(/ORD-B8EA06B6/)).not.toBeInTheDocument();
  });
  it('a temporary 503 or network failure is retryable and does not claim the order is missing', async () => {
    apiClient.mockRejectedValue(new ApiError(503, 'Unavailable'));
    renderAt('ORD-DEA248A3-8E1B-46FF-A378-994F73830EEA');
    expect(await screen.findByText(/could not load this confirmation right now/)).toBeInTheDocument();
    expect(screen.queryByText(/could not find/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry confirmation' })).toBeEnabled();
  });
});
