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

vi.mock('@/features/admin/recommendations/api', async importOriginal => ({
  ...await importOriginal<object>(),
  useRecommendationOverview: vi.fn(), useRecommendationConfigurations: vi.fn(), useFeaturedPins: vi.fn(),
  useRecommendationMutations: vi.fn(), useRecommendationPreview: vi.fn(),
}));

const home: SectionConfig = { surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: true, itemLimit: 12, defaultLimit: 4, maxLimit: 12, version: 3, updatedAt: null, configured: true };
const cart: SectionConfig = { surface: 'cart', mode: 'FREQUENTLY_BOUGHT_TOGETHER', enabled: true, itemLimit: 6, defaultLimit: 4, maxLimit: 12, version: 1, updatedAt: null, configured: true };
const PRODUCT = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';

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
});

describe('AdminRecommendationsPage', () => {
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

  it('validates the pin dialog locally: a malformed product ID and an end before the start are refused', async () => {
    renderPage('/admin/recommendations?tab=featured');
    fireEvent.click(screen.getByRole('button', { name: 'Add featured product' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Product ID'), { target: { value: 'not-a-uuid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add featured product' }));
    expect(createPin.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Enter the product ID (a UUID) from the product page.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Product ID'), { target: { value: PRODUCT } });
    fireEvent.change(within(dialog).getByLabelText('Starts (optional)'), { target: { value: '2026-11-06T10:00' } });
    fireEvent.change(within(dialog).getByLabelText('Ends (optional)'), { target: { value: '2026-11-05T10:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add featured product' }));
    expect(createPin.mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText('The end must be after the start.')).toBeInTheDocument();
  });

  it('shows the server reason when a pin is refused, for example the placement is full', async () => {
    createPin.mutate.mockImplementation((_body, options: { onError: (error: unknown) => void }) => {
      options.onError(new ApiError(409, 'This placement already has the maximum of 8 featured products.', { error: { code: 'FEATURED_LIMIT_REACHED' } }, 'FEATURED_LIMIT_REACHED'));
    });
    renderPage('/admin/recommendations?tab=featured');
    fireEvent.click(screen.getByRole('button', { name: 'Add featured product' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Product ID'), { target: { value: PRODUCT.toUpperCase() } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add featured product' }));
    expect(createPin.mutate).toHaveBeenCalledWith(expect.objectContaining({ productId: PRODUCT, surface: 'home', position: 0 }), expect.anything());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This placement already has the maximum of 8 featured products.');
  });

  it('labels a preview result that was pinned and never reports it as recorded', () => {
    vi.mocked(useRecommendationPreview).mockReturnValue({ isFetching: false, isError: false, refetch: vi.fn(), data: { recorded: false, context: null, sections: [{
      mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'MERCHANDISED_PIN', isPersonalized: false, isFallback: true, fallbackReason: 'NO_MEASURED_DEMAND',
      modelVersion: null, embeddingVersion: null, algorithmVersion: 'merchandised-pin-v1', context: null, impressionToken: null,
      items: [{ rank: 1, featured: true, product: { id: PRODUCT, name: 'QA Probe Headphones' } }],
    }] } } as never);
    renderPage('/admin/recommendations?tab=preview');
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByText('QA Probe Headphones').closest('li')).toHaveTextContent('Featured');
    expect(screen.getByText(/Previews are not recorded as impressions or clicks/)).toBeInTheDocument();
  });
});
