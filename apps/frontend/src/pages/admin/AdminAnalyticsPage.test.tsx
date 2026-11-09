import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAnalyticsPage } from './AdminAnalyticsPage';
import * as api from '@/features/admin/analytics/api';
import * as fx from '@/features/admin/analytics/fixtures';

vi.mock('@/features/admin/analytics/api', async importOriginal => ({
  ...await importOriginal<object>(),
  useAnalyticsOverview: vi.fn(), useAnalyticsProducts: vi.fn(), useAnalyticsCategories: vi.fn(), useAnalyticsInventory: vi.fn(),
  useAnalyticsRecommendations: vi.fn(), useAnalyticsImageSearch: vi.fn(), useAnalyticsDeliveries: vi.fn(), useAnalyticsCustomers: vi.fn(),
}));

type HookResult = Record<string, unknown>;
const ready = (envelope: unknown): HookResult => ({ data: envelope, isPending: false, isError: false, isFetching: false, error: null, refetch: vi.fn() });
const loading = (): HookResult => ({ data: undefined, isPending: true, isError: false, isFetching: true, error: null, refetch: vi.fn() });
const failed = (refetch: () => void): HookResult => ({ data: undefined, isPending: false, isError: true, isFetching: false, error: new Error('boom'), refetch });

const hooks = {
  overview: vi.mocked(api.useAnalyticsOverview), products: vi.mocked(api.useAnalyticsProducts), categories: vi.mocked(api.useAnalyticsCategories),
  inventory: vi.mocked(api.useAnalyticsInventory), recommendations: vi.mocked(api.useAnalyticsRecommendations),
  imageSearch: vi.mocked(api.useAnalyticsImageSearch), deliveries: vi.mocked(api.useAnalyticsDeliveries), customers: vi.mocked(api.useAnalyticsCustomers),
};
const fixtures = {
  overview: fx.overviewFixture, products: fx.productsFixture, categories: fx.categoriesFixture, inventory: fx.inventoryFixture,
  recommendations: fx.recommendationsFixture, imageSearch: fx.imageSearchFixture, deliveries: fx.deliveriesFixture, customers: fx.customersFixture,
};

/** Each hook gets its own result so a test can make exactly one panel fail or load. */
function mockHooks(overrides: Partial<Record<keyof typeof fixtures, HookResult>> = {}) {
  const pick = <K extends keyof typeof fixtures>(name: K) => (overrides[name] ?? ready(fixtures[name])) as never;
  hooks.overview.mockReturnValue(pick('overview'));
  hooks.products.mockReturnValue(pick('products'));
  hooks.categories.mockReturnValue(pick('categories'));
  hooks.inventory.mockReturnValue(pick('inventory'));
  hooks.recommendations.mockReturnValue(pick('recommendations'));
  hooks.imageSearch.mockReturnValue(pick('imageSearch'));
  hooks.deliveries.mockReturnValue(pick('deliveries'));
  hooks.customers.mockReturnValue(pick('customers'));
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderPage(path = '/admin/analytics') {
  return render(<MemoryRouter initialEntries={[path]}><AdminAnalyticsPage /><LocationProbe /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHooks();
});

describe('AdminAnalyticsPage', () => {
  it('links the Dashboard breadcrumb to the admin dashboard route', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin');
  });
  it('shows customer growth, repeat customers and orders per customer from the customers report', () => {
    renderPage();
    const growth = screen.getByRole('region', { name: 'Customer growth' });
    expect(within(growth).getByText('14')).toBeInTheDocument();
    expect(within(growth).getByRole('img', { name: /Running total of new customers/ })).toBeInTheDocument();
    const repeat = screen.getByRole('region', { name: 'Repeat customers' });
    expect(within(repeat).getByRole('img', { name: /Repeat purchase rate 35(\.0)?%: 7 of 20 paying customers/ })).toBeInTheDocument();
    const orders = screen.getByRole('region', { name: 'Avg. orders per customer' });
    expect(within(orders).getByText('1.33')).toBeInTheDocument();
    expect(within(orders).getByText('12 paid orders from 9 paying customers in this period.')).toBeInTheDocument();
  });
  it('shows a skeleton with busy regions while every report is loading, not zeros', () => {
    mockHooks(Object.fromEntries(Object.keys(hooks).map(name => [name, loading()])));
    const { container } = renderPage();
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('analytics-overview-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-products-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-categories-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-image-search-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-inventory-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-deliveries-skeleton')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="analytics-products-skeleton"]')?.children.length).toBe(1);
    expect(screen.queryByText('Paid revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders real report values with honest previous-period comparisons', () => {
    renderPage();
    expect(screen.getAllByText('$765.75').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+50% vs previous 30 days/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\+0\.5% vs previous 30 days/)).not.toBeInTheDocument();
    expect(screen.getByText(/\+0\.1% vs previous 30 days/)).toBeInTheDocument();
    expect(screen.getAllByText('No prior data').length).toBeGreaterThan(0);
    expect(screen.getAllByText('35.0%').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Image search' })).getByText(/Tracking started/)).toBeInTheDocument();
  });

  it('formats a negative fractional growth value as a percentage', () => {
    const data = structuredClone(fx.overviewFixture);
    data.data.paidOrders.growth = -0.25;
    mockHooks({ overview: ready(data) });
    renderPage();
    expect(screen.getByText(/-25% vs previous 30 days/)).toBeInTheDocument();
  });

  it('shows the measured average session duration with its change and sample size', () => {
    renderPage();
    const card = screen.getByRole('region', { name: 'Avg. session duration' });
    expect(within(card).getByText('4m 32s')).toBeInTheDocument();
    expect(within(card).getByText('Average visible time across 48 storefront sessions in this period.')).toBeInTheDocument();
  });

  it('says no sessions were recorded instead of showing a zero duration', () => {
    mockHooks({ customers: ready({ ...fixtures.customers, data: { ...fixtures.customers.data,
      sessions: { count: 0, averageMs: null, previousAverageMs: null, growth: null, trackingSince: null } } }) });
    renderPage();
    const card = screen.getByRole('region', { name: 'Avg. session duration' });
    expect(within(card).getByText('No storefront sessions recorded in this period')).toBeInTheDocument();
    expect(within(card).queryByText(/0s/)).toBeNull();
  });

  it('gives the revenue chart a text summary and a complete data table for screen readers', () => {
    renderPage();
    expect(screen.getByRole('img', { name: /Revenue over time in USD\. Peak \$310\.50/ })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Revenue per day in USD' });
    expect(within(table).getAllByRole('row')).toHaveLength((fx.overviewFixture.data.revenueSeries.byCurrency[0]?.points.length ?? 0) + 1);
  });

  it('shows a ranked product view with truthful comparison bars and product edit links', () => {
    renderPage();
    const section = screen.getByRole('region', { name: 'Top products' });
    expect(within(section).getByRole('list', { name: 'Top products ranked by units sold' })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Studio Monitor Headphones' })).toHaveAttribute('href', '/admin/products/p-1/edit');
    expect(within(section).getByRole('table', { name: 'Top products ranked by units sold' })).toBeInTheDocument();
    expect(within(section).getAllByText(/units · .* orders/)).toHaveLength(fx.productsFixture.data.byUnits.length);
  });

  it('shows category revenue comparisons without combining currencies', () => {
    renderPage();
    const section = screen.getByRole('region', { name: 'Revenue by category' });
    expect(within(section).getByRole('table', { name: 'Paid revenue by current catalog category' })).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Audio' })).toHaveAttribute('href', '/admin/products?categoryId=c-1');
    expect(within(section).getAllByRole('img').length).toBeGreaterThan(0);
    expect(within(section).getByRole('img', { name: /Audio:.*70/ }).firstElementChild).toHaveStyle({ width: '70%' });
    expect(within(section).getByRole('img', { name: /Peripherals:.*30/ }).firstElementChild).toHaveStyle({ width: '30%' });
  });

  it('shows catalog thumbnails and falls back when a product photo is missing or fails', () => {
    renderPage();
    const section = screen.getByRole('region', { name: 'Top products' });
    const photo = section.querySelector('img')!;
    expect(photo).toHaveAttribute('src', '/images/catalog/headphones.jpg');
    expect(photo).toHaveAttribute('alt', ''); // The adjacent product link already names it.
    expect(within(section).getAllByTestId('product-image-fallback')).toHaveLength(1);
    fireEvent.error(photo);
    expect(within(section).getAllByTestId('product-image-fallback')).toHaveLength(2);
    expect(within(section).getByRole('link', { name: 'Studio Monitor Headphones' })).toBeInTheDocument();
  });

  it('shows recommendation attribution item count and all available breakdowns', () => {
    const data = structuredClone(fx.recommendationsFixture);
    data.data.breakdown.byMode = [{ mode: 'PERSONALIZED', impressions: 700, clicks: 58, ctr: 58 / 700 }];
    data.data.breakdown.byStrategy = [{ strategy: 'POPULAR', impressions: 500, clicks: 38, ctr: 38 / 500 }];
    mockHooks({ recommendations: ready(data) });
    renderPage();
    const section = screen.getByRole('region', { name: 'Recommendations' });
    expect(within(section).getByText('Attributed order items')).toBeInTheDocument();
    expect(within(section).getByText('4')).toBeInTheDocument();
    expect(within(section).getByRole('table', { name: 'Recommendations by mode' })).toBeInTheDocument();
    expect(within(section).getByRole('table', { name: 'Recommendations by strategy' })).toBeInTheDocument();
    expect(within(section).getByText('$240.00')).toBeInTheDocument();
  });

  it('derives image-search outcomes from completed, no-result and failed counts', () => {
    renderPage();
    const section = screen.getByRole('region', { name: 'Image search' });
    expect(within(section).getAllByText('Completed with results')).toHaveLength(2);
    expect(within(section).getAllByText('44').length).toBeGreaterThan(0);
    expect(within(section).getByRole('img', { name: 'Failed: 2 of 52 searches' })).toBeInTheDocument();
  });

  it('shows proportion bars and status-filter links for inventory and delivery states', () => {
    renderPage();
    const inventorySection = screen.getByRole('region', { name: 'Inventory status' });
    expect(within(inventorySection).getByText('Each bar is a share of 42 tracked products.')).toBeInTheDocument();
    expect(within(inventorySection).getByRole('img', { name: 'Low stock: 9 of 42 tracked products' })).toBeInTheDocument();
    expect(within(inventorySection).getByRole('link', { name: 'Low stock' })).toHaveAttribute('href', '/admin/inventory?status=LOW_STOCK');
    const deliveriesSection = screen.getByRole('region', { name: 'Deliveries' });
    expect(within(deliveriesSection).getByText('Each bar is a share of 22 current delivery statuses.')).toBeInTheDocument();
    expect(within(deliveriesSection).getByRole('img', { name: 'Out for delivery: 2 of 22 current delivery statuses' })).toBeInTheDocument();
    expect(within(deliveriesSection).getByRole('link', { name: 'Out for delivery' })).toHaveAttribute('href', '/admin/deliveries?status=OUT_FOR_DELIVERY');
  });

  it('shows honest empty states when nothing was paid or recorded in the period', () => {
    mockHooks({
      overview: ready({ ...fx.overviewFixture, data: { ...fx.overviewFixture.data, byCurrency: [], revenueSeries: { granularity: 'DAY', buckets: [], byCurrency: [] } } }),
      imageSearch: ready({ ...fx.imageSearchFixture, data: { ...fx.imageSearchFixture.data, requests: 0, trackingSince: null } }),
    });
    renderPage();
    expect(screen.getAllByText('No paid orders in this period').length).toBeGreaterThan(0);
    expect(screen.getByText('No image-search activity recorded yet')).toBeInTheDocument();
  });

  it('fails one panel with its own error and Retry while the other panels keep their data', () => {
    const refetch = vi.fn();
    mockHooks({ categories: failed(refetch) });
    renderPage();
    const section = screen.getByRole('region', { name: 'Revenue by category' });
    expect(within(section).getByRole('alert')).toHaveTextContent('Revenue by category could not be loaded.');
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveTextContent('Paid revenue');
    expect(screen.getByRole('region', { name: 'Top products' })).toBeInTheDocument();
  });

  it('updates the period in the URL and requests that period from every report', () => {
    renderPage();
    expect(hooks.overview).toHaveBeenLastCalledWith('30d');
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('period=90d');
    expect(hooks.overview).toHaveBeenLastCalledWith('90d');
    expect(hooks.deliveries).toHaveBeenLastCalledWith('90d');
  });

  it('supports arrow-key selection in the period radio group', () => {
    renderPage();
    const thirty = screen.getByRole('radio', { name: '30 days' });
    expect(thirty).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(thirty, { key: 'ArrowRight' });
    expect(hooks.overview).toHaveBeenLastCalledWith('90d');
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('aria-checked', 'true');
  });

  it('falls back to the 30 day default for an unsupported period in the URL', () => {
    renderPage('/admin/analytics?period=1y');
    expect(hooks.overview).toHaveBeenLastCalledWith('30d');
  });

  it('links drilldowns to the real status filters of the admin list pages', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'View paid orders' })).toHaveAttribute('href', '/admin/orders?payment=PAID');
    expect(screen.getByRole('link', { name: 'Low stock' })).toHaveAttribute('href', '/admin/inventory?status=LOW_STOCK');
    expect(screen.getByRole('link', { name: 'Out for delivery' })).toHaveAttribute('href', '/admin/deliveries?status=OUT_FOR_DELIVERY');
  });
});
