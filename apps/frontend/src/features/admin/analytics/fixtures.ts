import type { AnalyticsEnvelope, AnalyticsMeta, AnalyticsPeriod, CategoriesData, CustomersData, DeliveriesData, ImageSearchData,
  InventoryData, OverviewData, ProductsData, RecommendationsData } from './api';

/** Synthetic fixtures for stories and tests only. They are not real store data and are never shown as such. */
export function analyticsMeta(period: AnalyticsPeriod = '30d'): AnalyticsMeta {
  return {
    period,
    window: { start: '2026-10-07T00:00:00.000Z', end: '2026-11-06T00:00:00.000Z' },
    previousWindow: { start: '2026-09-07T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z' },
    generatedAt: '2026-11-05T12:00:00.000Z',
    timezone: 'UTC',
    definitions: {},
  };
}

const envelope = <T,>(data: T, period: AnalyticsPeriod = '30d'): AnalyticsEnvelope<T> => ({ data, meta: analyticsMeta(period) });

const days = Array.from({ length: 6 }, (_, index) => `2026-11-0${index + 1}`);
const amounts = ['120.00', '0.00', '310.50', '95.25', '0.00', '240.00'];

export const overviewFixture = envelope<OverviewData>({
  paidOrders: { current: 9, previous: 6, growth: 0.5 },
  byCurrency: [{
    currency: 'USD',
    revenue: { current: '765.75', previous: '510.00', growth: 0.5015 },
    averageOrderValue: { current: '85.08', previous: '85.00', growth: 0.0009 },
    paidOrders: { current: 9, previous: 6, growth: 0.5 },
  }],
  newCustomers: { current: 14, previous: 0, growth: null },
  revenueSeries: {
    granularity: 'DAY',
    buckets: days,
    byCurrency: [{ currency: 'USD', points: days.map((bucket, index) => {
      const amount = amounts[index] ?? '0.00';
      return { bucket, amount, paidOrders: amount === '0.00' ? 0 : index + 1 };
    }) }],
  },
});

export const productsFixture = envelope<ProductsData>({
  limit: 10,
  byUnits: [
    { productId: 'p-1', name: 'Studio Monitor Headphones', status: 'ACTIVE', currency: 'USD', units: 18, amount: '2250.00', orders: 14 },
    { productId: 'p-2', name: 'Mechanical Keyboard TKL', status: 'INACTIVE', currency: 'USD', units: 9, amount: '810.00', orders: 8 },
  ],
  byAmount: [],
});

export const categoriesFixture = envelope<CategoriesData>({
  basis: 'CURRENT_CATALOG_CATEGORY',
  categories: [
    { categoryId: 'c-1', name: 'Audio', currency: 'USD', units: 27, amount: '3060.00', share: 0.7 },
    { categoryId: 'c-2', name: 'Peripherals', currency: 'USD', units: 12, amount: '1310.00', share: 0.3 },
  ],
});

export const inventoryFixture = envelope<InventoryData>({
  basis: 'CURRENT_STATE',
  trackedProducts: 42,
  byStatus: { IN_STOCK: 30, LOW_STOCK: 9, OUT_OF_STOCK: 3 },
});

export const recommendationsFixture = envelope<RecommendationsData>({
  impressions: 1200,
  clicks: 96,
  ctr: 0.08,
  breakdown: {
    bySurface: [{ surface: 'HOME', impressions: 800, clicks: 60, ctr: 0.075 }, { surface: 'PRODUCT', impressions: 400, clicks: 36, ctr: 0.09 }],
    byMode: [],
    byStrategy: [],
  },
  conversion: {
    model: 'LAST_CLICK_7D_CONSENTED',
    coverage: 'Signed-in customers who opted in to personalization only',
    attributedOrders: 3,
    attributedOrderItems: 4,
    attributedRevenue: [{ currency: 'USD', amount: '240.00' }],
  },
});

export const imageSearchFixture = envelope<ImageSearchData>({
  requests: 52, completed: 50, noResults: 6, failed: 2, noResultRate: 0.12, selections: 11, selectionRate: 0.26,
  latencyMs: { p50: 820, p95: 2140 }, trackingSince: '2026-10-20T09:30:00.000Z',
});

export const deliveriesFixture = envelope<DeliveriesData>({
  active: 5,
  byStatus: { CONFIRMED: 1, PREPARING: 2, OUT_FOR_DELIVERY: 2, DELIVERED: 17 },
  deliveredInWindow: 7,
  averageHoursPaidToDelivered: { value: 41.5, sampleSize: 7, unavailableReason: null },
});

export const customersFixture = envelope<CustomersData>({
  newCustomers: { current: 14, previous: 9, growth: 0.5556 },
  registrations: { granularity: 'DAY', buckets: days.map((bucket, index) => ({ bucket, count: index + 1 })) },
  repeatBuyers: {
    allTime: { repeatCustomers: 7, payingCustomers: 20, rate: 0.35 },
    inWindow: { repeatCustomers: 2, payingCustomers: 9, rate: 0.2222 },
  },
  ordersPerCustomer: { paidOrders: 12, payingCustomers: 9, average: 1.3333 },
  sessions: { count: 48, averageMs: 272000, previousAverageMs: 240000, growth: 0.1333, trackingSince: '2026-11-01T00:00:00.000Z' },
});
