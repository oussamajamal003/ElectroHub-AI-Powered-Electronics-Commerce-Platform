import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartContext, type CartContextValue } from '@/features/cart/context';
import { recommendationsApi } from '@/features/recommendations/api';
import type { RecommendationSection } from '@/features/recommendations/types';
import { wishlistProduct } from '@/features/wishlist/fixtures';
import { CartPage } from './CartPage';

vi.mock('@/features/recommendations/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/recommendations/api')>();
  return { ...actual, recommendationsApi: { ...actual.recommendationsApi, cart: vi.fn() } };
});
vi.mock('@/features/checkout/PaymentPurchases', () => ({ usePaymentPurchases: () => ({ data: { data: [] }, isLoading: false }), PendingPurchases: () => null }));

const cart: CartContextValue = { totalQuantity: 1, isGuest: true, isLoggingOut: false, isLoading: false, isError: false, isMutating: false,
  pendingProductIds: [], pendingRemoveProductIds: [], mergeError: null, pendingGuestItems: [], addItem: vi.fn(), setQuantity: vi.fn(), removeItem: vi.fn(),
  retry: vi.fn(), validateRoute: vi.fn(), retryMerge: vi.fn(), removePendingGuestItem: vi.fn(), submitCheckout: async operation => (await operation()).result,
  data: { items: [{ id: null, productId: wishlistProduct.id, quantity: 1,
    product: { slug: wishlistProduct.slug, name: wishlistProduct.name, category: 'Phones', price: wishlistProduct.price, image: null },
    availableQuantity: 5, availability: 'AVAILABLE', lineTotal: wishlistProduct.price }],
  totalQuantity: 1, subtotal: wishlistProduct.price, shipping: '0.00', total: wishlistProduct.price, currency: 'USD', canCheckout: true, revision: 'test-revision' } };

const coPurchase = (items: RecommendationSection['items']): RecommendationSection => ({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart',
  strategy: 'CO_PURCHASE', isPersonalized: false, isFallback: false, fallbackReason: null, modelVersion: null, embeddingVersion: null,
  algorithmVersion: 'test', context: null, impressionToken: null, items });

async function showCartWithSuggestions(response: unknown) {
  // `unknown` on purpose: these cases model payloads that violate the typed contract.
  vi.mocked(recommendationsApi.cart).mockResolvedValue(response as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><CartContext.Provider value={cart}><CartPage /></CartContext.Provider></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(recommendationsApi.cart).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

beforeEach(() => { vi.mocked(recommendationsApi.cart).mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Cart suggestions rail failures never blank the Cart', () => {
  it('renders a valid co-purchase section (control: the rail is mounted in this setup)', async () => {
    const companion = { ...wishlistProduct, id: '41f516ae-8385-4dcb-9a85-90b5dc9fe363', name: 'Companion Case', slug: 'companion-case' };
    await showCartWithSuggestions({ data: coPurchase([{ rank: 1, product: companion }]) });
    expect(await screen.findByRole('heading', { name: 'Frequently Bought Together' })).toBeInTheDocument();
    expect(screen.getByTestId('cart-item')).toHaveTextContent(wishlistProduct.name);
  });

  it.each([
    ['a list instead of a section', { data: [] }],
    ['a section without items', { data: { strategy: 'CO_PURCHASE', surface: 'cart' } }],
    ['a non-object section', { data: 'unexpected' }],
  ])('hides the rail and keeps the cart rows for %s', async (_label, response) => {
    await showCartWithSuggestions(response);
    expect(screen.getByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument();
    expect(screen.getByTestId('cart-item')).toHaveTextContent(wishlistProduct.name);
    expect(screen.queryByRole('heading', { name: 'Frequently Bought Together' })).not.toBeInTheDocument();
  });

  it('contains a render failure inside the rail and keeps the cart rows', async () => {
    // The error boundary path: React reports the caught error to the console, which is silenced here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await showCartWithSuggestions({ data: coPurchase([{ rank: 1, product: null as never }]) });
    expect(screen.getByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument();
    expect(screen.getByTestId('cart-item')).toHaveTextContent(wishlistProduct.name);
    expect(screen.getByRole('button', { name: 'Sign in to Checkout' })).toBeEnabled();
  });
});
