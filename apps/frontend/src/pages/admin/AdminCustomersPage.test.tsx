import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useAdminCustomers } from '@/features/admin/customers/api';
import { AdminCustomersPage } from './AdminCustomersPage';

vi.mock('@/features/admin/customers/api', () => ({ useAdminCustomers: vi.fn() }));

it('restores the Deleted filter from the URL and allows switching back to All', async () => {
  vi.mocked(useAdminCustomers).mockReturnValue({ data: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0,
    summary: { total: 0, active: 0, paidRevenue: [] } } }, isPending: false, isError: false, isFetching: false } as never);
  render(<MemoryRouter initialEntries={['/admin/customers?status=DELETED']}><AdminCustomersPage /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Deleted' })).toHaveAttribute('aria-pressed', 'true');
  expect(useAdminCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'DELETED' }));
  await userEvent.click(screen.getByRole('button', { name: 'All' }));
  await waitFor(() => expect(useAdminCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined })));
  await userEvent.click(screen.getByRole('button', { name: 'Deleted' }));
  await waitFor(() => expect(useAdminCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'DELETED' })));
});
