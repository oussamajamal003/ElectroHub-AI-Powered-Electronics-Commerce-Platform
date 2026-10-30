import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductSummary } from '@/features/products/types';
import {
  useClearRecentlyViewed,
  useRecentlyViewed,
  useRemoveRecentlyViewed,
  useRecommendationPreferences,
  useSetRecommendationPreferences,
} from '@/features/recommendations/queries';
import { PersonalizationPanel } from './PersonalizationPanel';

vi.mock('@/features/recommendations/queries', () => ({
  useRecommendationPreferences: vi.fn(),
  useSetRecommendationPreferences: vi.fn(),
  useRecentlyViewed: vi.fn(),
  useClearRecentlyViewed: vi.fn(),
  useRemoveRecentlyViewed: vi.fn(),
}));
vi.mock('@/features/recommendations/useStoreCardActions', () => ({
  useStoreCardActions: () => ({ navigate: vi.fn(), cardActions: {} }),
}));

type Query = ReturnType<typeof useRecommendationPreferences>;
type RecentQuery = ReturnType<typeof useRecentlyViewed>;
type SetMutation = ReturnType<typeof useSetRecommendationPreferences>;
type ClearMutation = ReturnType<typeof useClearRecentlyViewed>;
type RemoveMutation = ReturnType<typeof useRemoveRecentlyViewed>;

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
  const removeProduct = vi.fn();
  let preferenceCacheEnabled = false;

  beforeEach(() => {
    vi.clearAllMocks();
    setPreferences.mockReset();
    clearHistory.mockReset();
    removeProduct.mockReset();
    preferenceCacheEnabled = false;
    vi.mocked(useRecommendationPreferences).mockImplementation(() => preferencesQuery(preferenceCacheEnabled));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([]));
    vi.mocked(useSetRecommendationPreferences).mockReturnValue({
      mutate: setPreferences,
      isPending: false,
    } as unknown as SetMutation);
    vi.mocked(useClearRecentlyViewed).mockReturnValue({
      mutate: clearHistory,
      isPending: false,
    } as unknown as ClearMutation);
    vi.mocked(useRemoveRecentlyViewed).mockReturnValue({
      mutate: removeProduct,
      isPending: false,
    } as unknown as RemoveMutation);
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

  it('updates the switch immediately while saving, prevents duplicate requests, and shows no pending success claim', () => {
    const { rerender } = render(<PersonalizationPanel userId="user-1" />);
    const toggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    setPreferences.mockImplementation((next: boolean) => { preferenceCacheEnabled = next; });
    fireEvent.click(toggle);
    vi.mocked(useSetRecommendationPreferences).mockReturnValue({ mutate: setPreferences, isPending: true } as unknown as SetMutation);
    rerender(<PersonalizationPanel userId="user-1" />);
    const optimisticToggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    expect(optimisticToggle).toBeChecked();
    expect(optimisticToggle).not.toBeDisabled();
    expect(screen.getByRole('heading', { level: 3, name: 'Recently Viewed' })).toBeInTheDocument();
    expect(screen.queryByText('Saving preference…')).not.toBeInTheDocument();
    expect(screen.queryByText('Personalized recommendations are on.')).not.toBeInTheDocument();

    fireEvent.click(optimisticToggle);
    fireEvent.click(toggle);
    expect(setPreferences).toHaveBeenCalledTimes(1);
    expect(optimisticToggle).not.toBeDisabled();
  });

  it('disables the switch while the opted-in history section initially loads, but not during a save', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([], { isPending: true, data: undefined }));
    const { rerender } = render(<PersonalizationPanel userId="user-1" />);
    const loadingToggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    expect(loadingToggle).toBeDisabled();

    vi.mocked(useSetRecommendationPreferences).mockReturnValue({ mutate: setPreferences, isPending: true } as unknown as SetMutation);
    rerender(<PersonalizationPanel userId="user-1" />);
    expect(screen.getByRole('switch', { name: 'Personalized recommendations' })).not.toBeDisabled();
  });

  it('allows opting in when the disabled consent-off history query is pending', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(false));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([], { isPending: true, data: undefined }));
    render(<PersonalizationPanel userId="user-1" />);
    const toggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(setPreferences).toHaveBeenCalledWith(true, expect.anything());
  });

  it('keeps the last confirmed value when saving fails', () => {
    setPreferences.mockImplementation((_next: boolean, options: { onError: () => void }) => options.onError());
    render(<PersonalizationPanel userId="user-1" />);
    const toggle = screen.getByRole('switch', { name: 'Personalized recommendations' });
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('Your preference could not be saved. Please try again.');
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
    expect(screen.getByText(/Removing views deletes view activity only; wishlist, cart and purchase signals remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Headphones from recently viewed' }));
    expect(removeProduct).toHaveBeenCalledWith(sampleProduct.id, expect.any(Object));

    fireEvent.click(screen.getByRole('button', { name: 'Clear recently viewed' }));
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(clearHistory).toHaveBeenCalledWith(undefined, expect.any(Object));
  });

  it('shows per-item removal feedback only after the mutation result', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    removeProduct.mockImplementation((_id: string, options: { onSuccess: () => void }) => options.onSuccess());
    render(<PersonalizationPanel userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Headphones from recently viewed' }));
    expect(screen.getByRole('status')).toHaveTextContent('Product removed from recently viewed.');
  });

  it('prevents overlapping history actions while a removal is pending', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    vi.mocked(useRemoveRecentlyViewed).mockReturnValue({ mutate: removeProduct, isPending: true } as unknown as RemoveMutation);
    render(<PersonalizationPanel userId="user-1" />);
    expect(screen.getByRole('button', { name: 'Remove Sample Headphones from recently viewed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear recently viewed' })).toBeDisabled();
  });

  it('shows a per-item removal error only after the mutation fails', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    removeProduct.mockImplementation((_id: string, options: { onError: () => void }) => options.onError());
    render(<PersonalizationPanel userId="user-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Headphones from recently viewed' }));
    expect(screen.getByRole('status')).toHaveTextContent('This product could not be removed. Please try again.');
  });

  it('shows the empty Recently Viewed message when enabled with zero items', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([]));
    render(<PersonalizationPanel userId="user-1" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Recently Viewed' })).toBeInTheDocument();
    expect(screen.getByText('Products you open will appear here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear recently viewed' })).not.toBeInTheDocument();
  });

  it('moves focus to the empty-state heading with a normal focus scroll, so Clear never leaves the viewport at the document end', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(true));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    const { rerender } = render(<PersonalizationPanel userId="user-1" />);
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

    fireEvent.click(screen.getByRole('button', { name: 'Clear recently viewed' }));
    // The optimistic update empties the list while the Clear button is still focused, so it unmounts.
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([]));
    rerender(<PersonalizationPanel userId="user-1" />);

    expect(screen.getByRole('heading', { level: 3, name: 'Recently Viewed' })).toHaveFocus();
    // preventScroll would leave the viewport on the clamped document end; the focus scroll brings the heading into view.
    expect(focusSpy).toHaveBeenLastCalledWith();
    focusSpy.mockRestore();
  });

  it('hides the Recently Viewed section entirely when personalization is off', () => {
    vi.mocked(useRecommendationPreferences).mockReturnValue(preferencesQuery(false));
    vi.mocked(useRecentlyViewed).mockReturnValue(recentQuery([sampleProduct]));
    render(<PersonalizationPanel userId="user-1" />);

    expect(screen.queryByText('Recently Viewed')).not.toBeInTheDocument();
    expect(screen.queryByText('Sample Headphones')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear recently viewed' })).not.toBeInTheDocument();
    expect(useRecentlyViewed).toHaveBeenCalledWith('user-1', 8, false);
  });
});
