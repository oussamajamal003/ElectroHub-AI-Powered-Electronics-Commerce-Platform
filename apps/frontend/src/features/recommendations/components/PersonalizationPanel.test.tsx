import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductSummary } from '@/features/products/types';
import {
  useClearRecentlyViewed,
  useRecentlyViewed,
  useRecommendationPreferences,
  useSetRecommendationPreferences,
} from '@/features/recommendations/queries';
import { PersonalizationPanel } from './PersonalizationPanel';

vi.mock('@/features/recommendations/queries', () => ({
  useRecommendationPreferences: vi.fn(),
  useSetRecommendationPreferences: vi.fn(),
  useRecentlyViewed: vi.fn(),
  useClearRecentlyViewed: vi.fn(),
}));
vi.mock('@/features/recommendations/useStoreCardActions', () => ({
  useStoreCardActions: () => ({ navigate: vi.fn(), cardActions: {} }),
}));

type Query = ReturnType<typeof useRecommendationPreferences>;
type RecentQuery = ReturnType<typeof useRecentlyViewed>;
type SetMutation = ReturnType<typeof useSetRecommendationPreferences>;
type ClearMutation = ReturnType<typeof useClearRecentlyViewed>;

const sampleProduct: ProductSummary = {
  id: 'sample-recent-1',
  name: 'Sample Headphones',
  description: null,
  slug: 'sample-headphones',
  price: '79.00',
  compareAtPrice: null,
  discountPercent: null,
  averageRating: null,
  reviewCount: 0,
  currency: 'USD',
  availability: 'AVAILABLE',
  category: { id: 'sample-category', name: 'Headphones', slug: 'headphones' },
  brand: null,
  primaryImage: null,
};

function preferencesQuery(personalizationEnabled: boolean, overrides: Partial<Query> = {}): Query {
  return {
    data: { data: { personalizationEnabled, updatedAt: null } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as Query;
}

function recentQuery(items: ProductSummary[], overrides: Partial<RecentQuery> = {}): RecentQuery {
  return {
    data: { data: { personalizationEnabled: true, items } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as RecentQuery;
}

describe('PersonalizationPanel', () => {
  const setPreferences = vi.fn();
  const clearHistory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setPreferences.mockReset();
    clearHistory.mockReset();
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(false));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([]));
    vi.mocked(useSetRecommendationPreferences).mockReturnValue({
      mutate: setPreferences,
      isPending: false,
    } as unknown as SetMutation);
    vi.mocked(useClearRecentlyViewed).mockReturnValue({
      mutate: clearHistory,
      isPending: false,
    } as unknown as ClearMutation);
  });

  it('shows the personalization switch unchecked when personalization is off', () => {
    render(<PersonalizationPanel userId="user-1" />);
    const toggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    expect(toggle).not.toBeChecked();
  });

  it('calls the preference mutation with true when the switch is turned on', () => {
    render(<PersonalizationPanel userId="user-1" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Personalized recommendations' }));
    expect(setPreferences).toHaveBeenCalledTimes(1);
    expect(setPreferences).toHaveBeenCalledWith(true, expect.any(Object));
  });

  it('shows the success message from the onSuccess callback passed to mutate', () => {
    setPreferences.mockImplementation((_next: boolean, options: { onSuccess: () => void }) => options.onSuccess());
    render(<PersonalizationPanel userId="user-1" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Personalized recommendations' }));
    expect(screen.getByRole('status')).toHaveTextContent('Personalized recommendations are on.');
  });

  it('tells the customer their activity history was deleted when personalization is turned off', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    setPreferences.mockImplementation((_next: boolean, options: { onSuccess: () => void }) => options.onSuccess());
    render(<PersonalizationPanel userId="user-1" />);
    const toggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    expect(setPreferences).toHaveBeenCalledWith(false, expect.any(Object));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Personalized recommendations are off and your activity history was deleted.',
    );
  });

  it('shows an alert with a Retry action when the preference fails to load', () => {
    const refetch = vi.fn();
    vi.mocked(useRecommendationPreferences).mockReturnValue(
      preferencesQuery(false, { isError: true, data: undefined, refetch }),
    );
    render(<PersonalizationPanel userId="user-1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Your preference could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the Recently Viewed rail and a clear action when enabled with items', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    render(<PersonalizationPanel userId="user-1" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Recently Viewed' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recently Viewed' })).toBeInTheDocument();
    expect(screen.getByText('Sample Headphones')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear recently viewed' }));
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(clearHistory).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('shows the empty Recently Viewed message when enabled with zero items', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([]));
    render(<PersonalizationPanel userId="user-1" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Recently Viewed' })).toBeInTheDocument();
    expect(screen.getByText('Products you open will appear here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear recently viewed' })).not.toBeInTheDocument();
  });

  it('hides the Recently Viewed section entirely when personalization is off', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(false));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    render(<PersonalizationPanel userId="user-1" />);

    expect(screen.queryByText('Recently Viewed')).not.toBeInTheDocument();
    expect(screen.queryByText('Sample Headphones')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear recently viewed' })).not.toBeInTheDocument();
  });
});
