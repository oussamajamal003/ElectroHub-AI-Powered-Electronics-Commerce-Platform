import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendationSection } from '@/features/recommendations/types';

const query = vi.hoisted(() => ({ current: {} as { data?: { data: RecommendationSection }; isFetching: boolean } }));
const rail = vi.hoisted(() => vi.fn());
vi.mock('@/features/recommendations/queries', () => ({ useCartRecommendations: () => query.current }));
vi.mock('@/features/recommendations/components/RecommendationSectionRail', () => ({
  RecommendationSectionRail: (props: { section?: RecommendationSection; loading?: boolean }) => {
    rail(props);
    return props.section?.items.length ? <ul>{props.section.items.map(item => <li key={item.product.id}>{item.product.name}</li>)}</ul> : null;
  },
}));
vi.mock('@/features/checkout/PaymentPurchases', () => ({ PendingPurchases: () => null, usePaymentPurchases: () => ({}) }));

const { CartSuggestions } = await import('./CartPage');

function fbt(...ids: string[]): RecommendationSection {
  return { mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart', strategy: 'CO_PURCHASE', isPersonalized: false, isFallback: false,
    fallbackReason: null, modelVersion: null, embeddingVersion: null, algorithmVersion: 'co-purchase-v1', context: null, impressionToken: null,
    items: ids.map((id, index) => ({ rank: index + 1, product: { id, name: `Product ${id}` } as RecommendationSection['items'][number]['product'] })) };
}
const noData = { ...fbt(), strategy: 'NO_DATA' as const, fallbackReason: 'INSUFFICIENT_SUPPORT' };

describe('CartSuggestions (Frequently Bought Together)', () => {
  beforeEach(() => rail.mockClear());

  it('renders nothing and never a skeleton while the first request is unresolved', () => {
    query.current = { isFetching: true };
    const { container } = render(<CartSuggestions productIds={['a']} />);
    expect(container).toBeEmptyDOMElement();
    expect(rail).toHaveBeenCalledWith(expect.not.objectContaining({ loading: true }));
  });

  it('renders nothing when the server confirms insufficient support', () => {
    query.current = { data: { data: noData }, isFetching: false };
    const { container } = render(<CartSuggestions productIds={['a']} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never shows the previous anchor set after the cart changes, until the new cart is confirmed', () => {
    query.current = { data: { data: fbt('m', 'e') }, isFetching: false };
    const { rerender, container } = render(<CartSuggestions productIds={['laptop']} />);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Product m', 'Product e']);
    query.current = { isFetching: true };
    rerender(<CartSuggestions productIds={['laptop', 'phone']} />);
    expect(container).toBeEmptyDOMElement();
    query.current = { data: { data: fbt('e') }, isFetching: false };
    rerender(<CartSuggestions productIds={['laptop', 'phone']} />);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Product e']);
  });

  it('hides the section once every confirmed candidate is already in the cart', () => {
    query.current = { data: { data: fbt('m') }, isFetching: false };
    const { rerender, container } = render(<CartSuggestions productIds={['laptop']} />);
    query.current = { isFetching: true };
    rerender(<CartSuggestions productIds={['laptop', 'm']} />);
    expect(container).toBeEmptyDOMElement();
    query.current = { data: { data: noData }, isFetching: false };
    rerender(<CartSuggestions productIds={['laptop', 'm']} />);
    expect(container).toBeEmptyDOMElement();
  });
});
