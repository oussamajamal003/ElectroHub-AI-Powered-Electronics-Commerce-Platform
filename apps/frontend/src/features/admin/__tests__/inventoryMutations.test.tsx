import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { useInventoryMutations, type InventoryRow } from '../inventory/api';
import { adminKeys } from '../shared/api';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<object>(), apiClient: vi.fn() }));

const row = (quantity: number, productId = 'p1'): InventoryRow => ({ productId, name: 'QA Probe', sku: 'QA-1', productStatus: 'ACTIVE',
  category: { id: 'c1', name: 'Audio', isActive: true }, image: null, quantity, lowStockAt: 5, stockStatus: 'IN_STOCK', purchasable: true, updatedAt: null });
const page = (rows: InventoryRow[]) => ({ data: rows, meta: { page: 1, pageSize: 20, total: rows.length, totalPages: 1,
  summary: { inStock: rows.length, lowStock: 0, outOfStock: 0, untracked: 0 } } });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(adminKeys.inventoryList('?page=1'), page([row(3), row(9, 'p2')]));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const cached = () => client.getQueryData<ReturnType<typeof page>>(adminKeys.inventoryList('?page=1'))!.data.map(item => item.quantity);
  return { ...renderHook(() => useInventoryMutations(), { wrapper }), cached };
}

describe('useInventoryMutations cache', () => {
  it('writes the saved row into cached pages at once, so the next adjustment starts from the new count', async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({ data: row(5) });
    const { result, cached } = setup();
    await act(() => result.current.adjust.mutateAsync({ productId: 'p1', operation: 'RESTOCK', quantity: 2, expectedQuantity: 3 }));
    expect(cached()).toEqual([5, 9]);
  });

  it('adopts the current row from a 409 conflict instead of keeping the stale count', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(409, 'Stock changed.', { data: row(7) }, 'INVENTORY_CONFLICT'));
    const { result, cached } = setup();
    await act(() => result.current.adjust.mutateAsync({ productId: 'p1', operation: 'SET', quantity: 4, expectedQuantity: 3 }).catch(() => undefined));
    expect(cached()).toEqual([7, 9]);
  });
});
