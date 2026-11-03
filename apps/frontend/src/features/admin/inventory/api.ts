import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient } from '@/lib/api';
import { useAdminList } from '../shared/useAdminList';
import { adminKeys, errorCode, type ItemResponse, type ListResponse } from '../shared/api';
import type { ProductStatus, StockStatus } from '../products/api';

export interface InventoryRow {
  productId: string; name: string; sku: string; productStatus: ProductStatus; category: { id: string; name: string; isActive: boolean };
  image: { url: string; altText: string | null } | null; quantity: number | null; held?: number; lowStockAt: number | null; stockStatus: StockStatus | null;
  purchasable: boolean; updatedAt: string | null;
}
export interface InventorySummary { inStock: number; lowStock: number; outOfStock: number; untracked: number }
export interface InventoryListParams { q?: string; page: number; status?: string; sort: string; order: string }
export interface InventoryAdjustment { operation: 'RESTOCK' | 'SET'; quantity: number; expectedQuantity: number | null; reason?: string }

export function useAdminInventory(params: InventoryListParams) {
  return useAdminList<ListResponse<InventoryRow, { summary: InventorySummary }>>('/api/admin/inventory', adminKeys.inventoryList, params);
}

/** The 409 body carries the row as it is now; screens adopt it so the admin re-decides against real numbers (no blind retry). */
export const conflictRow = (error: unknown) => error instanceof ApiError && errorCode(error) === 'INVENTORY_CONFLICT'
  ? (error.data as { data?: InventoryRow } | undefined)?.data : undefined;

export function useInventoryMutations() {
  const client = useQueryClient();
  // Write the server's row into every cached page at once, so a follow-up adjustment never starts from a stale count while the refetch runs.
  const adopt = (row: InventoryRow) => client.setQueriesData<ListResponse<InventoryRow, { summary: InventorySummary }>>({ queryKey: adminKeys.inventory },
    page => page && { ...page, data: page.data.map(item => item.productId === row.productId ? row : item) });
  const settle = (row?: InventoryRow) => {
    if (row) adopt(row);
    for (const key of [adminKeys.inventory, adminKeys.products, adminKeys.alerts, ['admin', 'dashboard']]) void client.invalidateQueries({ queryKey: key });
  };
  const onError = (error: unknown) => { const current = conflictRow(error); if (current) settle(current); };
  const adjust = useMutation({
    mutationFn: ({ productId, ...body }: InventoryAdjustment & { productId: string }) =>
      apiClient<ItemResponse<InventoryRow>>(`/api/admin/inventory/${encodeURIComponent(productId)}/adjustments`, { method: 'POST', data: body }),
    onSuccess: response => settle(response.data),
    onError,
  });
  const threshold = useMutation({
    mutationFn: ({ productId, ...body }: { productId: string; lowStockAt: number; expectedLowStockAt: number }) =>
      apiClient<ItemResponse<InventoryRow>>(`/api/admin/inventory/${encodeURIComponent(productId)}/threshold`, { method: 'PATCH', data: body }),
    onSuccess: response => settle(response.data),
    onError,
  });
  return { adjust, threshold };
}
