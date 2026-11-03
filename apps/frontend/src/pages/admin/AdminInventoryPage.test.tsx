import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { AdminInventoryPage } from './AdminInventoryPage';
import { useAdminInventory, useInventoryMutations, type InventoryRow } from '@/features/admin/inventory/api';

vi.mock('@/features/admin/inventory/api', async importOriginal => ({ ...await importOriginal<object>(), useAdminInventory: vi.fn(), useInventoryMutations: vi.fn() }));

const row = (quantity: number): InventoryRow => ({ productId: '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11', name: 'QA Probe Headphones', sku: 'QA-051-PROBE',
  productStatus: 'ACTIVE', category: { id: 'c', name: 'Audio', isActive: true }, image: null, quantity, lowStockAt: 5,
  stockStatus: quantity === 0 ? 'OUT_OF_STOCK' : quantity <= 5 ? 'LOW_STOCK' : 'IN_STOCK', purchasable: quantity > 0, updatedAt: '2026-11-01T10:00:00.000Z' });
const adjust = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };
const threshold = { mutate: vi.fn(), isPending: false, isError: false, error: null };

describe('AdminInventoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adjust.isError = false; adjust.error = null;
    vi.mocked(useAdminInventory).mockReturnValue({ data: { data: [row(4)], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1,
      summary: { inStock: 10, lowStock: 1, outOfStock: 2, untracked: 0 } } }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() } as never);
    vi.mocked(useInventoryMutations).mockReturnValue({ adjust, threshold } as never);
  });

  it('shows real summary counts and sends the quantity the admin saw with a restock', () => {
    render(<MemoryRouter><AdminInventoryPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Low stock\s*1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Units to add or remove'), { target: { value: '6' } });
    expect(within(dialog).getByText('Stock after saving: 10')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add stock' }));
    expect(adjust.mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'RESTOCK', quantity: 6, expectedQuantity: 4 }), expect.anything());
  });

  it('adopts the current stock from a 409 so a retry is a conscious decision, not a double apply', async () => {
    adjust.mutate.mockImplementation((_body, options: { onError: (error: unknown) => void }) => {
      const error = new ApiError(409, 'Stock changed since you loaded it.', { error: { code: 'INVENTORY_CONFLICT' }, data: row(1) }, 'INVENTORY_CONFLICT');
      adjust.isError = true; adjust.error = error;
      options.onError(error);
    });
    render(<MemoryRouter><AdminInventoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Units to add or remove'), { target: { value: '6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add stock' }));
    await waitFor(() => expect(within(dialog).getByText('Stock after saving: 7')).toBeInTheDocument());
    adjust.mutate.mockReset();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add stock' }));
    expect(adjust.mutate).toHaveBeenCalledWith(expect.objectContaining({ expectedQuantity: 1 }), expect.anything());
  });

  it('refuses a zero restock before calling the API', () => {
    render(<MemoryRouter><AdminInventoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Units to add or remove'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add stock' }));
    expect(adjust.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Enter a whole number, for example 10 to add or -3 to remove.')).toBeInTheDocument();
  });

  it('removes units as a guarded absolute count and refuses removing more than is in stock', () => {
    render(<MemoryRouter><AdminInventoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust stock for QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Units to add or remove');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove stock' }));
    expect(adjust.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText('You can remove at most 4 units.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '-3' } });
    expect(within(dialog).getByText('Stock after saving: 1')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove stock' }));
    expect(adjust.mutate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'SET', quantity: 1, expectedQuantity: 4 }), expect.anything());
  });
});
