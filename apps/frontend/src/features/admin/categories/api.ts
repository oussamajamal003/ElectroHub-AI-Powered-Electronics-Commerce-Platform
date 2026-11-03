import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { adminKeys, queryString, type ItemResponse, type ListResponse } from '../shared/api';

export interface AdminCategory {
  id: string; name: string; slug: string; description: string | null; isActive: boolean; productCount: number; createdAt: string; updatedAt: string;
}
export interface CategoryListParams { q?: string; page: number; status?: string; sort: string; order: string }

export function useAdminCategories(params: CategoryListParams) {
  const search = queryString({ ...params, pageSize: 20 });
  return useQuery({
    queryKey: adminKeys.categoryList(search),
    queryFn: ({ signal }) => apiClient<ListResponse<AdminCategory, { summary: { active: number; inactive: number } }>>(`/api/admin/categories${search}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** Category changes alter storefront visibility of every product inside: refresh products, options and dashboard counts as well. */
function useCategoryInvalidation() {
  const client = useQueryClient();
  return () => {
    for (const key of [adminKeys.categories, adminKeys.products, adminKeys.options, adminKeys.inventory, ['admin', 'dashboard']]) {
      void client.invalidateQueries({ queryKey: key });
    }
  };
}

export interface CategoryFields { name: string; description: string | null }

export function useCategoryMutations() {
  const settle = useCategoryInvalidation();
  const create = useMutation({
    mutationFn: (body: CategoryFields) => apiClient<ItemResponse<AdminCategory>>('/api/admin/categories', { method: 'POST', data: body }),
    onSuccess: settle,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: CategoryFields & { id: string; expectedUpdatedAt: string }) =>
      apiClient<ItemResponse<AdminCategory>>(`/api/admin/categories/${encodeURIComponent(id)}`, { method: 'PATCH', data: body }),
    onSuccess: settle,
  });
  const status = useMutation({
    mutationFn: ({ id, isActive, expectedUpdatedAt }: { id: string; isActive: boolean; expectedUpdatedAt: string }) =>
      apiClient<ItemResponse<AdminCategory>>(`/api/admin/categories/${encodeURIComponent(id)}/status`, { method: 'PATCH', data: { isActive, expectedUpdatedAt } }),
    onSuccess: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient<void>(`/api/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: settle,
  });
  return { create, update, status, remove };
}
