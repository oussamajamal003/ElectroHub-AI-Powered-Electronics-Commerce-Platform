import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { useAdminList } from '../shared/useAdminList';
import { adminKeys, type ItemResponse, type ListResponse } from '../shared/api';

export type ProductStatus = 'ACTIVE' | 'INACTIVE';
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface AdminProductRow {
  id: string; name: string; sku: string; slug: string; price: string; compareAtPrice: string | null; currency: string; status: ProductStatus;
  category: { id: string; name: string; isActive: boolean }; brand: { id: string; name: string } | null;
  image: { url: string; altText: string | null } | null; imageCount: number;
  inventory: { quantity: number; lowStockAt: number; status: StockStatus; updatedAt: string } | null;
  storefrontVisible: boolean; createdAt: string; updatedAt: string;
  /** Permanent deletion is offered only when the server found no history at all; `deleteBlocker` says why not. */
  deletable: boolean; deleteBlocker: string | null;
}
export interface Specification { id?: string; group: string; name: string; value: string }
export interface AdminProduct extends AdminProductRow {
  description: string | null; modelNumber: string | null; specifications: Specification[]; orderLineCount: number;
}
export interface CatalogOptions {
  categories: { id: string; name: string; isActive: boolean }[]; brands: { id: string; name: string }[];
  /** How many catalog products use each category/brand pair: used to rank likely matches, never to restrict choices. */
  pairs: { categoryId: string; brandId: string; products: number }[];
}

export interface ProductFields {
  name: string; sku: string; description: string | null; modelNumber: string | null; categoryId: string; brandId: string | null;
  price: string; compareAtPrice: string | null; specifications: Omit<Specification, 'id'>[];
}
export interface ProductCreate extends ProductFields { status: ProductStatus; inventory: { quantity: number; lowStockAt: number } }

export interface ProductListParams { q?: string; page: number; categoryId?: string; status?: string; stock?: string; sort: string; order: string }

export function useAdminProducts(params: ProductListParams) {
  return useAdminList<ListResponse<AdminProductRow>>('/api/admin/catalog/products', adminKeys.productList, params);
}

export function useAdminProduct(productId: string | undefined) {
  return useQuery({
    queryKey: adminKeys.product(productId ?? ''),
    queryFn: ({ signal }) => apiClient<ItemResponse<AdminProduct>>(`/api/admin/catalog/products/${encodeURIComponent(productId!)}`, { signal }),
    enabled: Boolean(productId),
    retry: (count, error) => count < 2 && !(error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404),
  });
}

export function useCatalogOptions() {
  return useQuery({
    queryKey: adminKeys.options,
    queryFn: ({ signal }) => apiClient<ItemResponse<CatalogOptions>>('/api/admin/catalog/options', { signal }),
    staleTime: 60_000,
  });
}

/** Catalog writes change dashboard counts, inventory rows and alerts too: invalidate every dependent admin view. */
function useCatalogInvalidation() {
  const client = useQueryClient();
  return (product?: AdminProduct) => {
    if (product) client.setQueryData(adminKeys.product(product.id), { data: product });
    void client.invalidateQueries({ queryKey: adminKeys.products });
    void client.invalidateQueries({ queryKey: adminKeys.inventory });
    void client.invalidateQueries({ queryKey: adminKeys.categories });
    void client.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    void client.invalidateQueries({ queryKey: adminKeys.alerts });
  };
}

export function useCreateProduct() {
  const settle = useCatalogInvalidation();
  return useMutation({ meta: { action: "create this product" },
    mutationFn: (body: ProductCreate) => apiClient<ItemResponse<AdminProduct>>('/api/admin/catalog/products', { method: 'POST', data: body }),
    onSuccess: response => settle(response.data),
  });
}

export function useUpdateProduct(productId: string) {
  const settle = useCatalogInvalidation();
  return useMutation({ meta: { action: "update this product" },
    mutationFn: (body: ProductFields & { expectedUpdatedAt: string }) =>
      apiClient<ItemResponse<AdminProduct>>(`/api/admin/catalog/products/${encodeURIComponent(productId)}`, { method: 'PATCH', data: body }),
    onSuccess: response => settle(response.data),
  });
}

export function useProductStatus() {
  const settle = useCatalogInvalidation();
  return useMutation({ meta: { action: "change this product's status" },
    mutationFn: ({ id, status, expectedUpdatedAt }: { id: string; status: ProductStatus; expectedUpdatedAt: string }) =>
      apiClient<ItemResponse<AdminProduct>>(`/api/admin/catalog/products/${encodeURIComponent(id)}/status`,
        { method: 'PATCH', data: { status, expectedUpdatedAt } }),
    onSuccess: response => settle(response.data),
  });
}

export interface BulkStatusItem { id: string; expectedUpdatedAt: string }
export type BulkOutcome = 'UPDATED' | 'UNCHANGED' | 'CONFLICT' | 'NOT_FOUND' | 'REJECTED';
export interface BulkStatusResult { id: string; outcome: BulkOutcome; message: string }
export interface BulkStatusSummary { updated: number; unchanged: number; conflict: number; notFound: number; rejected: number }
export interface BulkStatusResponse { results: BulkStatusResult[]; summary: BulkStatusSummary }

/** Bounded archive/reactivate of selected rows. The server applies each row independently and reports per-item outcomes. */
export function useBulkProductStatus() {
  const settle = useCatalogInvalidation();
  return useMutation({ meta: { action: "update the selected products" },
    mutationFn: ({ status, items }: { status: ProductStatus; items: BulkStatusItem[] }) =>
      apiClient<ItemResponse<BulkStatusResponse>>('/api/admin/catalog/products/bulk-status', { method: 'POST', data: { status, items } }),
    // Settled, not succeeded: rows may have changed even when the request failed part-way, so the lists always refresh.
    onSettled: () => settle(),
  });
}

export function useDeleteProduct() {
  const client = useQueryClient();
  const settle = useCatalogInvalidation();
  return useMutation({ meta: { action: "delete this product" },
    mutationFn: (id: string) => apiClient<void>(`/api/admin/catalog/products/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_result, id) => { client.removeQueries({ queryKey: adminKeys.product(id) }); settle(); void client.invalidateQueries({ queryKey: adminKeys.options }); },
  });
}
