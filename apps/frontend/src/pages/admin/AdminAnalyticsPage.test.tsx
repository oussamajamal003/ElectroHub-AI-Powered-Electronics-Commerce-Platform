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
  it('shows a skeleton with busy regions while every report is loading, not zeros', () => {
    mockHooks(Object.fromEntries(Object.keys(hooks).map(name => [name, loading()])));
    renderPage();
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveAttribute('aria-busy', 'true');
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
    expect(screen.getByText(/Tracking started/)).toBeInTheDocument();
  });

  it('formats a negative fractional growth value as a percentage', () => {
    const data = structuredClone(fx.overviewFixture);
    data.data.paidOrders.growth = -0.25;
    mockHooks({ overview: ready(data) });
    renderPage();
    expect(screen.getByText(/-25% vs previous 30 days/)).toBeInTheDocument();
  });

  it('does not show any session-duration metric', () => {
    renderPage();
    expect(screen.queryByText(/session/i)).not.toBeInTheDocument();
  });

  it('gives the revenue chart a text summary and a complete data table for screen readers', () => {
    renderPage();
    expect(screen.getByRole('img', { name: /Revenue over time in USD\. Peak \$310\.50/ })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Revenue per day in USD' });
    expect(within(table).getAllByRole('row')).toHaveLength((fx.overviewFixture.data.revenueSeries.byCurrency[0]?.points.length ?? 0) + 1);
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
