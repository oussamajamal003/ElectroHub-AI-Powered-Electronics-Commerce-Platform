import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

/** Task 05.2 administrator analytics. Mirrors apps/backend/src/services/admin-analytics.service.ts (money is a 2-decimal string). */
export const ANALYTICS_PERIODS = ['7d', '30d', '90d', '12m'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = '30d';

export interface AnalyticsRangeIso { start: string; end: string }
export interface AnalyticsMeta {
  period: AnalyticsPeriod;
  window: AnalyticsRangeIso;
  previousWindow: AnalyticsRangeIso;
  generatedAt: string;
  timezone: 'UTC';
  definitions: Record<string, string>;
}
export interface AnalyticsEnvelope<T> { data: T; meta: AnalyticsMeta }

export interface Comparison { current: number; previous: number; growth: number | null }
export interface MoneyComparison { current: string | null; previous: string | null; growth: number | null }

export interface OverviewData {
  paidOrders: Comparison;
  byCurrency: {
    currency: string;
    revenue: { current: string; previous: string; growth: number | null };
    averageOrderValue: MoneyComparison;
    paidOrders: Comparison;
  }[];
  newCustomers: Comparison;
  revenueSeries: {
    granularity: 'DAY' | 'MONTH';
    buckets: string[];
    byCurrency: { currency: string; points: { bucket: string; amount: string; paidOrders: number }[] }[];
  };
}

export interface ProductsData {
  limit: number;
  byUnits: ProductRow[];
  byAmount: ProductRow[];
}
export interface ProductRow { productId: string; name: string; status: string; image: { url: string; altText: string | null } | null; currency: string; units: number; amount: string; orders: number }

export interface CategoriesData {
  basis: 'CURRENT_CATALOG_CATEGORY';
  categories: { categoryId: string; name: string; currency: string; units: number; amount: string; share: number | null }[];
}

export interface InventoryData {
  basis: 'CURRENT_STATE';
  trackedProducts: number;
  byStatus: Record<'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK', number>;
}

export interface RecommendationsData {
  impressions: number;
  clicks: number;
  ctr: number | null;
  breakdown: {
    bySurface: (BreakdownCounts & { surface: string })[];
    byMode: (BreakdownCounts & { mode: string })[];
    byStrategy: (BreakdownCounts & { strategy: string })[];
  };
  conversion: {
    model: 'LAST_CLICK_7D_CONSENTED';
    coverage: string;
    attributedOrders: number;
    attributedOrderItems: number;
    attributedRevenue: { currency: string; amount: string }[];
  };
}
export interface BreakdownCounts { impressions: number; clicks: number; ctr: number | null }

export interface ImageSearchData {
  requests: number;
  completed: number;
  noResults: number;
  failed: number;
  noResultRate: number | null;
  selections: number;
  selectionRate: number | null;
  latencyMs: { p50: number | null; p95: number | null };
  /** Earliest recorded image-search event; null when nothing has been recorded yet. */
  trackingSince: string | null;
}

export interface DeliveriesData {
  active: number;
  byStatus: Record<'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED', number>;
  deliveredInWindow: number;
  averageHoursPaidToDelivered: { value: number | null; sampleSize: number; unavailableReason: string | null };
}

export interface CustomersData {
  newCustomers: Comparison;
  registrations: { granularity: 'DAY' | 'MONTH'; buckets: { bucket: string; count: number }[] };
  repeatBuyers: {
    allTime: RepeatBuyers;
    inWindow: RepeatBuyers;
  };
  /** Orders paid inside the window ÷ customers who paid in it; average is null when nobody paid. */
  ordersPerCustomer: { paidOrders: number; payingCustomers: number; average: number | null };
  /** Storefront tab sessions (visible time). averageMs is null until a session is recorded in the window. */
  sessions: { count: number; averageMs: number | null; previousAverageMs: number | null; growth: number | null; trackingSince: string | null };
}
export interface RepeatBuyers { repeatCustomers: number; payingCustomers: number; rate: number | null }

export const analyticsKeys = {
  report: (endpoint: string, period: AnalyticsPeriod) => ['admin', 'analytics', endpoint, period] as const,
};

/** One hook per report so every panel loads, fails and retries on its own. Previous data stays visible while a new period loads. */
function useAnalyticsReport<T>(endpoint: string, period: AnalyticsPeriod) {
  return useQuery({
    queryKey: analyticsKeys.report(endpoint, period),
    queryFn: ({ signal }) => apiClient<AnalyticsEnvelope<T>>(`/api/admin/analytics/${endpoint}?period=${period}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export const useAnalyticsOverview = (period: AnalyticsPeriod) => useAnalyticsReport<OverviewData>('overview', period);
export const useAnalyticsProducts = (period: AnalyticsPeriod) => useAnalyticsReport<ProductsData>('products', period);
export const useAnalyticsCategories = (period: AnalyticsPeriod) => useAnalyticsReport<CategoriesData>('categories', period);
export const useAnalyticsInventory = (period: AnalyticsPeriod) => useAnalyticsReport<InventoryData>('inventory', period);
export const useAnalyticsRecommendations = (period: AnalyticsPeriod) => useAnalyticsReport<RecommendationsData>('recommendations', period);
export const useAnalyticsImageSearch = (period: AnalyticsPeriod) => useAnalyticsReport<ImageSearchData>('image-search', period);
export const useAnalyticsDeliveries = (period: AnalyticsPeriod) => useAnalyticsReport<DeliveriesData>('deliveries', period);
export const useAnalyticsCustomers = (period: AnalyticsPeriod) => useAnalyticsReport<CustomersData>('customers', period);
