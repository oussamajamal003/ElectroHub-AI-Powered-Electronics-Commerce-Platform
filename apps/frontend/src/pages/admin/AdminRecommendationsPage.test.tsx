import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  useFeaturedPins, useRecommendationConfigurations, useRecommendationMutations, useRecommendationOverview, useRecommendationPreview,
  type SectionConfig,
} from '@/features/admin/recommendations/api';
import { AdminRecommendationsPage } from './AdminRecommendationsPage';
import { useAdminProducts } from '@/features/admin/products/api';

vi.mock('@/features/admin/recommendations/api', async importOriginal => ({
  ...await importOriginal<object>(),
  useRecommendationOverview: vi.fn(), useRecommendationConfigurations: vi.fn(), useFeaturedPins: vi.fn(),
  useRecommendationMutations: vi.fn(), useRecommendationPreview: vi.fn(),
}));
vi.mock('@/features/admin/products/api', async importOriginal => ({ ...await importOriginal<object>(), useAdminProducts: vi.fn() }));

const home: SectionConfig = { surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: true, itemLimit: 12, defaultLimit: 4, maxLimit: 12, version: 3, updatedAt: null, configured: true };
const cart: SectionConfig = { surface: 'cart', mode: 'FREQUENTLY_BOUGHT_TOGETHER', enabled: true, itemLimit: 6, defaultLimit: 4, maxLimit: 12, version: 1, updatedAt: null, configured: true };
const PRODUCT = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const eligibleProduct = { id: PRODUCT, name: 'QA Probe Headphones', sku: 'QA-PROBE', slug: 'qa-probe-headphones', price: '19.99', compareAtPrice: null,
  currency: 'USD', status: 'ACTIVE', category: { id: 'category-1', name: 'Audio', isActive: true }, brand: null,
  image: null, imageCount: 0, inventory: { quantity: 5, lowStockAt: 1, status: 'IN_STOCK', updatedAt: '2026-11-05T00:00:00.000Z' },
  storefrontVisible: true, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', deletable: false, deleteBlocker: null };
const lowStockProduct = { ...eligibleProduct, id: '2c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c12', name: 'Low Stock Camera', sku: 'LOW-CAMERA',
  inventory: { quantity: 1, lowStockAt: 2, status: 'LOW_STOCK', updatedAt: '2026-11-05T00:00:00.000Z' } };
const outOfStockProduct = { ...eligibleProduct, id: '3c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c13', name: 'Out of Stock Camera', sku: 'OUT-CAMERA',
  inventory: { quantity: 0, lowStockAt: 2, status: 'OUT_OF_STOCK', updatedAt: '2026-11-05T00:00:00.000Z' } };
const pin = { id: 'pin-1', productId: PRODUCT, surface: 'home' as const, position: 2, startsAt: null, endsAt: null, enabled: true, version: 7,
  state: 'ACTIVE' as const, eligible: true, product: { id: PRODUCT, name: 'QA Probe Headphones', slug: 'qa-probe-headphones', sku: 'QA-PROBE' } };

const saveSection = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };
const createPin = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };
const updatePin = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };
const deletePin = { mutate: vi.fn(), isPending: false, isError: false, error: null as unknown };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(path = '/admin/recommendations') {
  return render(<MemoryRouter initialEntries={[path]}>
    <AdminRecommendationsPage />
    <LocationProbe />
  </MemoryRouter>);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  for (const mutation of [saveSection, createPin, updatePin, deletePin]) { mutation.isPending = false; mutation.isError = false; mutation.error = null; }
  vi.mocked(useRecommendationOverview).mockReturnValue({ data: { period: '30d', since: '2026-10-06T00:00:00.000Z',
    totals: { impressions: 40, clicks: 10, ctr: 0.25, fallbackImpressions: 0, fallbackShare: 0 },
    breakdown: [{ surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', impressions: 40, clicks: 10, ctr: 0.25, fallback: false }] },
  isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useRecommendationConfigurations).mockReturnValue({ data: [home, cart], isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useFeaturedPins).mockReturnValue({ data: { data: [], meta: { maxPerSurface: 8 } }, isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useRecommendationPreview).mockReturnValue({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useRecommendationMutations).mockReturnValue({ saveSection, createPin, updatePin, deletePin } as never);
  vi.mocked(useAdminProducts).mockReturnValue({ data: { data: [eligibleProduct], meta: { page: 1, totalPages: 1, total: 1, pageSize: 20 } }, isPending: false, isError: false } as never);
});

describe('AdminRecommendationsPage', () => {
  it('keeps icon tabs named and navigable with the Radix arrow-key pattern', async () => {
    const user = userEvent.setup();
    renderPage();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.click(overviewTab);
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Strategies' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: 'Strategies' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=strategies');
  });

  it('shows content-shaped loading states for each management section', async () => {
    vi.mocked(useRecommendationOverview).mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() } as never);
    vi.mocked(useRecommendationConfigurations).mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() } as never);
    vi.mocked(useFeaturedPins).mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() } as never);
    vi.mocked(useRecommendationPreview).mockReturnValue({ data: undefined, isFetching: true, isError: false, refetch: vi.fn() } as never);
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading recommendation performance' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Strategies' }));
    expect(screen.getByRole('status', { name: 'Loading strategy settings' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Featured' }));
    expect(screen.getByRole('status', { name: 'Loading featured products' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByRole('status', { name: 'Loading recommendation preview' })).toBeInTheDocument();
  });

  it('shows the overview by default and keeps the active tab in the URL', async () => {
    renderPage();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // Shown in the click-through KPI and in the breakdown row for the same strategy.
    expect(screen.getAllByText('25.0%').length).toBeGreaterThanOrEqual(1);

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Featured' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?tab=featured'));
    expect(screen.getByText('Nothing is featured yet')).toBeInTheDocument();
  });

  it('opens the requested tab from the URL and falls back to overview for an unknown value', () => {
    const { unmount } = renderPage('/admin/recommendations?tab=strategies');
    expect(screen.getByRole('tab', { name: 'Strategies' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    renderPage('/admin/recommendations?tab=not-a-tab');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('answers a stale section save with the reload message and sends the version the admin saw', async () => {
    saveSection.mutate.mockImplementation((_body, options: { onError: (error: unknown) => void }) => {
      options.onError(new ApiError(409, 'Stale', { error: { code: 'VERSION_CONFLICT' } }, 'VERSION_CONFLICT'));
    });
    renderPage('/admin/recommendations?tab=strategies');
    const row = screen.getByRole('form', { name: 'Popular products on Home' });
    fireEvent.change(within(row).getByRole('textbox', { name: /Items shown/ }), { target: { value: '8' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save section' }));

    expect(saveSection.mutate).toHaveBeenCalledWith(expect.objectContaining({ surface: 'home', mode: 'POPULAR_PRODUCTS', itemLimit: 8, expectedVersion: 3 }), expect.anything());
    expect(await within(row).findByRole('alert')).toHaveTextContent('This changed since you loaded it. Reload to see the latest version, then try again.');
  });

  it('refuses an item limit above the engine maximum before calling the API', () => {
    renderPage('/admin/recommendations?tab=strategies');
    const row = screen.getByRole('form', { name: 'Popular products on Home' });
    fireEvent.change(within(row).getByRole('textbox', { name: /Items shown/ }), { target: { value: '13' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save section' }));
    expect(saveSection.mutate).not.toHaveBeenCalled();
    expect(within(row).getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 12.');
  });

  it('requires choosing a listed eligible product and validates the pin window', async () => {
    renderPage('/admin/recommendations?tab=featured');
    fireEvent.click(screen.getByRole('button', { name: 'Add featured product' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add featured product' }));
    expect(createPin.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose an eligible product.');

    await userEvent.setup().click(within(dialog).getByRole('button', { name: /Eligible product/ }));
    await userEvent.setup().click(await screen.findByRole('option', { name: /QA Probe Headphones/ }));
    fireEvent.change(within(dialog).getByLabelText('Starts (optional)'), { target: { value: '2026-11-06T10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Ends (optional)'), { target: { value: '2026-11-05T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add featured product' }));
    expect(createPin.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText('The end must be after the start.')).toBeInTheDocument();
  });

  it('offers purchasable low-stock products but omits products with zero quantity', async () => {
    vi.mocked(useAdminProducts).mockReturnValue({ data: { data: [lowStockProduct, outOfStockProduct], meta: { page: 1, totalPages: 1, total: 2, pageSize: 20 } }, isPending: false, isError: false } as never);
    renderPage('/admin/recommendations?tab=featured');
    fireEvent.click(screen.getByRole('button', { name: 'Add featured product' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /Eligible product/ }));
    expect(await screen.findByRole('option', { name: /Low Stock Camera/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Out of Stock Camera/ })).not.toBeInTheDocument();
    expect(useAdminProducts).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE', page: 1 }));
    expect(vi.mocked(useAdminProducts).mock.calls.every(([params]) => !('stock' in params))).toBe(true);
  });

  it('keeps products beyond the first catalog page discoverable', async () => {
    vi.mocked(useAdminProducts).mockImplementation((params) => ({
      data: { data: params.page === 1 ? [eligibleProduct] : [lowStockProduct], meta: { page: params.page, totalPages: 2, total: 21, pageSize: 20 } },
      isPending: false, isFetching: false, isError: false,
    } as never));
    renderPage('/admin/recommendations?tab=featured');
    fireEvent.click(screen.getByRole('button', { name: 'Add featured product' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /Eligible product/ }));
    expect(await screen.findByRole('option', { name: /QA Probe Headphones/ })).toBeInTheDocument();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Next products' }));
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /Eligible product/ }));
    expect(await screen.findByRole('option', { name: /Low Stock Camera/ })).toBeInTheDocument();
    expect(useAdminProducts).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('shows the server reason when a pin is refused, for example the placement is full', async () => {
    createPin.mutate.mockImplementation((_body, options: { onError: (error: unknown) => void }) => {
      options.onError(new ApiError(409, 'This placement already has the maximum of 8 featured products.', { error: { code: 'FEATURED_LIMIT_REACHED' } }, 'FEATURED_LIMIT_REACHED'));
    });
    renderPage('/admin/recommendations?tab=featured');
    fireEvent.click(screen.getByRole('button', { name: 'Add featured product' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: /Eligible product/ }));
    await userEvent.setup().click(await screen.findByRole('option', { name: /QA Probe Headphones/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add featured product' }));
    expect(createPin.mutate).toHaveBeenCalledWith(expect.objectContaining({ productId: PRODUCT, surface: 'home', position: 0 }), expect.anything());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This placement already has the maximum of 8 featured products.');
  });

  it('edits a pin schedule, position and enabled state using the row version', async () => {
    vi.mocked(useFeaturedPins).mockReturnValue({ data: { data: [pin], meta: { maxPerSurface: 8 } }, isPending: false, isError: false } as never);
    renderPage('/admin/recommendations?tab=featured');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit featured QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Position (0 is first)'), { target: { value: '4' } });
    fireEvent.change(within(dialog).getByLabelText('Starts (optional)'), { target: { value: '2026-11-06T10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Ends (optional)'), { target: { value: '2026-11-10T10:00' } });
    fireEvent.click(within(dialog).getByLabelText('Active'));
    fireEvent.submit(dialog.querySelector('form')!);

    expect(updatePin.mutate).toHaveBeenCalledWith({ id: 'pin-1', expectedVersion: 7, position: 4,
      startsAt: new Date('2026-11-06T10:00').toISOString(), endsAt: new Date('2026-11-10T10:00').toISOString(), enabled: false }, expect.anything());
  });

  it('preserves exact stored schedule timestamps for a position-only edit in a non-UTC timezone', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const scheduledPin = { ...pin, startsAt: '2026-11-05T18:00:37.456Z', endsAt: '2026-11-12T18:30:45.789Z' };
    vi.mocked(useFeaturedPins).mockReturnValue({ data: { data: [scheduledPin], meta: { maxPerSurface: 8 } }, isPending: false, isError: false } as never);
    renderPage('/admin/recommendations?tab=featured');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit featured QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Starts (optional)')).toHaveValue('2026-11-05T10:00');
    expect(within(dialog).getByLabelText('Ends (optional)')).toHaveValue('2026-11-12T10:30');
    fireEvent.change(within(dialog).getByLabelText('Position (0 is first)'), { target: { value: '3' } });
    fireEvent.submit(dialog.querySelector('form')!);

    expect(updatePin.mutate).toHaveBeenCalledWith({ id: 'pin-1', expectedVersion: 7, position: 3, enabled: true }, expect.anything());
  });

  it('resets the edit draft when reopened and uses the refreshed pin version and values', async () => {
    vi.mocked(useFeaturedPins).mockReturnValue({ data: { data: [pin], meta: { maxPerSurface: 8 } }, isPending: false, isError: false } as never);
    const view = renderPage('/admin/recommendations?tab=featured');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit featured QA Probe Headphones' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Position (0 is first)'), { target: { value: '4' } });
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const latestPin = { ...pin, position: 5, version: 8, enabled: false, startsAt: '2026-11-08T12:00:00.000Z' };
    vi.mocked(useFeaturedPins).mockReturnValue({ data: { data: [latestPin], meta: { maxPerSurface: 8 } }, isPending: false, isError: false } as never);
    view.rerender(<MemoryRouter initialEntries={['/admin/recommendations?tab=featured']}><AdminRecommendationsPage /><LocationProbe /></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Edit featured QA Probe Headphones' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Position (0 is first)')).toHaveValue('5');
    expect(within(dialog).getByLabelText('Active')).not.toBeChecked();
    fireEvent.change(within(dialog).getByLabelText('Position (0 is first)'), { target: { value: '6' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(updatePin.mutate).toHaveBeenCalledWith({ id: 'pin-1', expectedVersion: 8, position: 6, enabled: false }, expect.anything());
  });

  it('does not send an edit with an invalid schedule', async () => {
    vi.mocked(useFeaturedPins).mockReturnValue({ data: { data: [pin], meta: { maxPerSurface: 8 } }, isPending: false, isError: false } as never);
    renderPage('/admin/recommendations?tab=featured');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit featured QA Probe Headphones' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Starts (optional)'), { target: { value: '2026-11-10T10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Ends (optional)'), { target: { value: '2026-11-09T10:00' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(updatePin.mutate).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The end must be after the start.');
  });

  it('labels a preview result that was pinned and never reports it as recorded', () => {
    vi.mocked(useRecommendationPreview).mockReturnValue({ isFetching: false, isError: false, refetch: vi.fn(), data: { recorded: false, context: null, sections: [{
      mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'MERCHANDISED_PIN', isPersonalized: false, isFallback: true, fallbackReason: 'NO_MEASURED_DEMAND',
      modelVersion: null, embeddingVersion: null, algorithmVersion: 'merchandised-pin-v1', context: null, impressionToken: null,
      items: [{ rank: 1, featured: true, product: { id: PRODUCT, name: 'QA Probe Headphones', price: '19.99', currency: 'USD', category: { name: 'Audio' } } }],
    }] } } as never);
    renderPage('/admin/recommendations?tab=preview');
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByText('QA Probe Headphones').closest('li')).toHaveTextContent('Featured');
    expect(screen.getByText('$19.99')).toBeInTheDocument();
    expect(screen.getByText(/Previews are not recorded as impressions or clicks/)).toBeInTheDocument();
  });
});
