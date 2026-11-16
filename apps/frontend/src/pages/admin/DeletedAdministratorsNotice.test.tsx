import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeletedAdministratorsNotice } from './DeletedAdministratorsNotice';
import { apiClient } from '@/lib/api';

vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()), apiClient: vi.fn() }));

const api = vi.mocked(apiClient);
const noticeCalls = () => api.mock.calls.filter(([endpoint]) => String(endpoint).endsWith('/deletion-notice'));
const ackCalls = () => api.mock.calls.filter(([endpoint]) => String(endpoint).endsWith('/deletion-notice/acknowledge'));
const reply = (data: unknown) => api.mockImplementation((async (endpoint: string) => ({ data: String(endpoint).endsWith('/acknowledge') ? { acknowledged: true } : data })) as never);

const renderNotice = (enabled = true) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DeletedAdministratorsNotice enabled={enabled} />
  </QueryClientProvider>,
);

describe('DeletedAdministratorsNotice', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows one compact, non-identifying notice and acknowledges it server-side when dismissed', async () => {
    reply({ count: 1, through: '2026-11-07T20:00:00.001Z' });
    renderNotice();
    expect(await screen.findByText('Administrator account deleted')).toBeInTheDocument();
    expect(screen.getByText(/permanently deleted and removed from this list/)).toBeInTheDocument();
    expect(screen.getByText(/Required audit records remain available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    await waitFor(() => expect(ackCalls()).toHaveLength(1));
    expect(ackCalls()[0]?.[1]).toMatchObject({ method: 'POST', data: { through: '2026-11-07T20:00:00.001Z' } });
    await waitFor(() => expect(screen.queryByText('Administrator account deleted')).not.toBeInTheDocument());
  });

  it('closes immediately on click without waiting for the server, and returns if the acknowledgement fails', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.mockImplementation((async (endpoint: string) => {
      if (String(endpoint).endsWith('/acknowledge')) return new Promise(resolve => { release = resolve; });
      return { data: { count: 1, through: '2026-11-07T20:00:00.001Z' } };
    }) as never);
    renderNotice();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); // gone before the acknowledgement resolves
    release({ data: { acknowledged: true } });
  });

  it('shows a single banner with a count for several deletions', async () => {
    reply({ count: 3, through: '2026-11-07T20:00:00.001Z' });
    renderNotice();
    expect(await screen.findByText('3 administrator accounts deleted')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('renders nothing when there is nothing new, the request fails (non-Owner) or the viewer is not eligible', async () => {
    reply({ count: 0, through: null });
    const first = renderNotice();
    await waitFor(() => expect(noticeCalls()).toHaveLength(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    first.unmount();
    api.mockRejectedValue(new Error('forbidden'));
    renderNotice();
    await waitFor(() => expect(noticeCalls()).toHaveLength(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    api.mockClear();
    renderNotice(false);
    expect(noticeCalls()).toHaveLength(0);
  });
});
