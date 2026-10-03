import type { ProductSummary } from '@/features/products/types';
import type { WishlistContextValue } from './context';
export const wishlistProduct: ProductSummary = {
  id: '8f2813b4-a388-44d3-b51e-5d4c40386677', name: 'Apple iPhone 15 Pro', slug: 'apple-iphone-15-pro',
  description: 'A17 Pro chip, titanium design, USB-C.', price: '1099.99', compareAtPrice: null, discountPercent: null,
  averageRating: '4.9', reviewCount: 318, currency: 'USD', availability: 'AVAILABLE',
  category: { id: 'phones', name: 'Phones', slug: 'phones' }, brand: { id: 'apple', name: 'Apple', slug: 'apple' },
  primaryImage: { id: 'primary', url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: 'Apple-style smartphone', sortOrder: 0, isPrimary: true },
  secondaryImage: null,
};
export function wishlistFixture(options: Partial<WishlistContextValue> = {}): WishlistContextValue {
  const totalItems = options.totalItems ?? options.expectedCount ?? options.data?.totalItems ?? 1;
  return { data: { items: [{ productId: wishlistProduct.id, product: wishlistProduct, availability: 'AVAILABLE' }], totalItems: 1 },
    productIds: [wishlistProduct.id], expectedCount: options.expectedCount ?? totalItems, isLoading: false, isError: false, isLoggingOut: false, isMerging: false,
    error: null, mergeError: null, unresolved: [], pending: [], toggle: () => undefined, retry: async () => undefined,
    retryMerge: async () => undefined, discardGuest: () => undefined, ...options, totalItems };
}
