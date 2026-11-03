import { ApiError } from '@/lib/api';

/** Task 05.1 admin envelopes, mirroring apps/backend/src/routes/admin.routes.ts. */
export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number }
export interface ListResponse<T, M = object> { data: T[]; meta: PageMeta & M }
export interface ItemResponse<T> { data: T }
export interface Money { currency: string; amount: string }

/** Every admin query key starts with 'admin' so logout/account switch (queryClient.clear) and targeted invalidation both reach it. */
export const adminKeys = {
  all: ['admin'] as const,
  dashboard: (days: number) => ['admin', 'dashboard', days] as const,
  alerts: ['admin', 'alerts'] as const,
  products: ['admin', 'products'] as const,
  productList: (params: string) => ['admin', 'products', 'list', params] as const,
  product: (id: string) => ['admin', 'products', 'detail', id] as const,
  options: ['admin', 'catalog-options'] as const,
  categories: ['admin', 'categories'] as const,
  categoryList: (params: string) => ['admin', 'categories', 'list', params] as const,
  inventory: ['admin', 'inventory'] as const,
  inventoryList: (params: string) => ['admin', 'inventory', 'list', params] as const,
  orders: ['admin', 'orders'] as const,
  orderList: (params: string) => ['admin', 'orders', 'list', params] as const,
  order: (reference: string) => ['admin', 'orders', 'detail', reference] as const,
  customers: ['admin', 'customers'] as const,
  customerList: (params: string) => ['admin', 'customers', 'list', params] as const,
  customer: (id: string) => ['admin', 'customers', 'detail', id] as const,
};

/** Builds a stable query string (sorted keys, empty values dropped) so the same filters always share one cache entry. */
export function queryString(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface FieldError { field: string | null; message: string }
/** Server validation details (field names + messages only) for inline form errors. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const fields = (error.data as { error?: { fields?: FieldError[] } } | undefined)?.error?.fields ?? [];
  return Object.fromEntries(fields.filter(item => item.field).map(item => [item.field!, item.message]));
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.') {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'You appear to be offline. Check your connection and try again.';
    if (error.status === 401) return 'Your session has ended. Sign in again to continue.';
    if (error.status === 403) return 'This action requires an administrator account.';
    if (error.status === 429) return 'Too many changes in a short time. Wait a moment and try again.';
    return error.message || fallback;
  }
  return fallback;
}

export const errorCode = (error: unknown) => error instanceof ApiError ? error.code : undefined;
