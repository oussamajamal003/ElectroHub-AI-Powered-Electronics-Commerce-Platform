import type { Page, Route } from '@playwright/test';
import { emptyCart, emptyWishlist, noSavedPurchases } from '../../src/test/e2eApiFixtures';

/**
 * Task 06.2: a fully intercepted storefront "world" (guest visitor). No request leaves the browser for a real API.
 * `delays` holds one endpoint back so a spec can observe genuine loading states; `overrides` replaces any endpoint.
 */
export const image = (n: number) => ({ id: `image-${n}`, url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: `Phone ${n}`, sortOrder: 0, isPrimary: true });
export const summary = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `Phone model ${n}`, slug: `phone-${n}`,
  description: 'A current smartphone.', price: '499.00', compareAtPrice: null, discountPercent: null, averageRating: 4, reviewCount: 2, currency: 'USD',
  availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 10, purchasable: true,
  category: { id: 'category-1', name: 'Phones', slug: 'phones' }, brand: { id: 'brand-1', name: 'Apple', slug: 'apple' }, primaryImage: image(n), secondaryImage: null });
export const product = { ...summary(1), name: 'Apple iPhone 15 Pro', slug: 'apple-iphone-15-pro', sku: 'IP15P', images: [image(1)],
  description: 'A titanium smartphone with a 6.1-inch display.\n\nUp to 29 hours of video playback.',
  specifications: [{ group: 'General', items: Array.from({ length: 6 }, (_, i) => ({ id: `spec-${i + 1}`, name: `Spec ${i + 1}`, value: `Value ${i + 1}`, group: 'General', sortOrder: i })) },
    { group: 'Display', items: Array.from({ length: 6 }, (_, i) => ({ id: `spec-${i + 7}`, name: `Spec ${i + 7}`, value: `Value ${i + 7}`, group: 'Display', sortOrder: i })) }] };
const section = (mode: string, from: number) => ({ mode, surface: 'product_detail', strategy: 'FALLBACK_CATEGORY', isPersonalized: false, isFallback: true,
  fallbackReason: null, modelVersion: null, embeddingVersion: null, algorithmVersion: 'test', context: { categoryName: 'Phones', categorySlug: 'phones' },
  impressionToken: null, items: Array.from({ length: 4 }, (_, i) => ({ rank: i + 1, product: summary(from + i) })) });
export const reviews = Array.from({ length: 6 }, (_, i) => ({ id: `review-${i}`, rating: i % 2 ? 5 : 4, body: 'Solid phone with a great screen.',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', author: { displayName: 'Sam T.' } }));

// Six reviews alternate 4 and 5 stars: three of each, average 4.5. The summary is derived from them, never invented.
export const reviewSummary = { averageRating: '4.5', reviewCount: 6, distribution: [{ rating: 5, count: 3 }, { rating: 4, count: 3 }, { rating: 3, count: 0 }, { rating: 2, count: 0 }, { rating: 1, count: 0 }] };
/** Fictional, reserved-domain store contact details (RFC 2606 `.invalid`; 555-01xx is a fictional US range). */
export const storeProfile = { storeName: 'ElectroHub', supportEmail: 'support@electrohub.invalid', supportPhone: '+1 555 0100',
  addressLine1: '100 Example Street', addressLine2: null, city: 'Springfield', region: 'IL', postalCode: '62701', country: 'US', currency: 'USD' };

export interface WorldOptions {
  delays?: Partial<Record<'product' | 'catalog' | 'cart', number>>;
  overrides?: (path: string, route: Route) => Promise<boolean> | boolean;
}

export async function world(page: Page, options: WorldOptions = {}) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const wait = (ms = 0) => ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
    if (options.overrides && await options.overrides(path, route)) return;
    if (path === '/api/auth/customer/refresh') return json({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }, 401);
    if (path === `/api/products/${product.slug}`) { await wait(options.delays?.product); return json({ data: product }); }
    const catalogSlug = /^\/api\/products\/phone-(\d+)$/.exec(path);
    if (catalogSlug) {
      await wait(options.delays?.product);
      const n = Number(catalogSlug[1]);
      return json({ data: { ...summary(n), sku: `PHONE-${n}`, images: [image(n)], description: product.description, specifications: product.specifications } });
    }
    if (path.startsWith('/api/products/') && path.endsWith('/recommendations')) return json({ data: { sections: [section('SIMILAR_PRODUCTS', 10), section('FREQUENTLY_BOUGHT_TOGETHER', 20)] } });
    if (/\/reviews\/me$/.test(path)) return json({ data: null });
    if (/\/reviews$/.test(path)) return json({ data: reviews, meta: { page: 1, pageSize: 10, total: reviews.length, totalPages: 1 }, summary: reviewSummary });
    if (path === '/api/store/profile') return json({ data: storeProfile });
    if (path === '/api/cart') { await wait(options.delays?.cart); return json(emptyCart); }
    if (path === '/api/wishlist') return json(emptyWishlist);
    if (path === '/api/checkout/payment-attempts') return json(noSavedPurchases);
    if (path === '/api/search/products' || path === '/api/products') {
      await wait(options.delays?.catalog);
      const items = Array.from({ length: 24 }, (_, i) => summary(100 + i));
      return json({ data: items, meta: { page: 1, pageSize: 24, total: items.length, totalPages: 1, hasNextPage: false, nextCursor: null } });
    }
    return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });
}

export const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
export const maxScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
