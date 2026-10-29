import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProductDetail, ProductSummary } from '../../src/features/products/types';
import type { RecommendationSection } from '../../src/features/recommendations/types';

// Mocked Task 04.4 recommendation UI (no backend). Every /api request is answered by mockApi below; any other origin is
// aborted so nothing leaves the local Vite server.

const LOCAL_ORIGIN = 'http://127.0.0.1:3404';
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

const CATEGORY = { id: 'smartphones', name: 'Smartphones', slug: 'smartphones' };
const BRAND = { id: 'electrohub-test', name: 'ElectroHub Test', slug: 'electrohub-test' };
const IMAGE = '/images/catalog/smartphones.jpg';
const TOKENS = {
  similar: 'rec-token-similar-0001',
  alsoLike: 'rec-token-also-like-0001',
  popular: 'rec-token-popular-0001',
  cart: 'rec-token-cart-0001',
} as const;

function product(index: number, name: string, slug: string): ProductSummary {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name, slug, description: `${name} fixture description.`,
    price: `${299 + index}.00`, compareAtPrice: null, discountPercent: null,
    averageRating: '4.5', reviewCount: 12, currency: 'USD', availability: 'AVAILABLE',
    stockStatus: 'IN_STOCK', availableQuantity: 5, purchasable: true,
    category: CATEGORY, brand: BRAND,
    primaryImage: { id: `image-${index}`, url: IMAGE, altText: name, sortOrder: 0, isPrimary: true },
    secondaryImage: null,
  };
}

const ANCHOR = product(1, 'Anchor Phone Pro', 'anchor-phone-pro');
const SIMILAR = [2, 3, 4, 5].map(index => product(index, `Similar Phone ${index}`, `similar-phone-${index}`));
const ALSO_LIKE = [6, 7, 8, 9].map(index => product(index, `Also Like Phone ${index}`, `also-like-phone-${index}`));
const POPULAR = [10, 11, 12, 13].map(index => product(index, `Popular Phone ${index}`, `popular-phone-${index}`));
const CART_SUGGESTIONS = [14, 15, 16, 17].map(index => product(index, `Bundle Phone ${index}`, `bundle-phone-${index}`));
const ALL_PRODUCTS = [ANCHOR, ...SIMILAR, ...ALSO_LIKE, ...POPULAR, ...CART_SUGGESTIONS];

type EventsBody = { token: string; events: { productId: string; type: 'IMPRESSION' | 'CLICK' }[] };

function section(input: {
  mode: RecommendationSection['mode'];
  surface: RecommendationSection['surface'];
  strategy: RecommendationSection['strategy'];
  items?: ProductSummary[];
  impressionToken?: string;
  context?: RecommendationSection['context'];
  isFallback?: boolean;
  fallbackReason?: string | null;
}): RecommendationSection {
  const items = input.items ?? [];
  return {
    mode: input.mode, surface: input.surface, strategy: input.strategy, isPersonalized: false,
    isFallback: input.isFallback ?? false, fallbackReason: input.fallbackReason ?? null,
    modelVersion: null, embeddingVersion: null, algorithmVersion: 'task04-mock-v1',
    context: input.context ?? null,
    impressionToken: items.length > 0 ? (input.impressionToken ?? null) : null,
    items: items.map((item, index) => ({ rank: index + 1, product: item })),
  };
}

const similarSection = () => section({ mode: 'SIMILAR_PRODUCTS', surface: 'product_detail', strategy: 'EMBEDDING_SIMILARITY', items: SIMILAR, impressionToken: TOKENS.similar });
const alsoLikeSection = () => section({ mode: 'YOU_MAY_ALSO_LIKE', surface: 'product_detail', strategy: 'HYBRID_EMBEDDING', items: ALSO_LIKE, impressionToken: TOKENS.alsoLike });
const noDataSection = (mode: RecommendationSection['mode'], surface: RecommendationSection['surface']) => section({ mode, surface, strategy: 'NO_DATA' });

interface RecommendationMock {
  productSections: RecommendationSection[];
  productStatus: number;
  popular: RecommendationSection;
  cart: RecommendationSection;
  productRequests: number;
  popularRequests: number;
  personalRequests: number;
  events: EventsBody[];
  unmocked: string[];
}

function detail(item: ProductSummary): ProductDetail {
  return {
    id: item.id, name: item.name, description: item.description, slug: item.slug, price: item.price,
    compareAtPrice: item.compareAtPrice, discountPercent: item.discountPercent, averageRating: item.averageRating,
    reviewCount: item.reviewCount, currency: item.currency, availability: item.availability,
    stockStatus: item.stockStatus, purchasable: item.purchasable, category: item.category, brand: item.brand,
    availableQuantity: 5, sku: `SKU-${item.slug.toUpperCase()}`, modelNumber: null,
    images: item.primaryImage ? [item.primaryImage] : [], specifications: [],
  };
}

function cartLine(item: ProductSummary, quantity: number) {
  return {
    id: null, productId: item.id, quantity,
    product: { slug: item.slug, name: item.name, category: item.category.name, price: item.price,
      image: item.primaryImage ? { url: item.primaryImage.url, altText: item.primaryImage.altText } : null },
    availableQuantity: 5, stockStatus: 'IN_STOCK', availability: 'AVAILABLE',
    lineTotal: (Number(item.price) * quantity).toFixed(2),
  };
}

/** Registers the mock for every request of the page. Tests mutate the returned state before navigating. */
async function mockApi(page: Page): Promise<RecommendationMock> {
  const mock: RecommendationMock = {
    productSections: [similarSection(), alsoLikeSection(), noDataSection('FREQUENTLY_BOUGHT_TOGETHER', 'product_detail')],
    productStatus: 200,
    popular: noDataSection('POPULAR_PRODUCTS', 'home'),
    cart: noDataSection('FREQUENTLY_BOUGHT_TOGETHER', 'cart'),
    productRequests: 0, popularRequests: 0, personalRequests: 0, events: [], unmocked: [],
  };
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== LOCAL_ORIGIN) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname;
    const method = request.method();
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path.startsWith('/api/auth/')) return respond({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }, 401);
    if (path === '/api/categories') {
      return respond({ data: [{ ...CATEGORY, description: null, imageUrl: IMAGE, productCount: ALL_PRODUCTS.length }],
        meta: { page: 1, pageSize: 100, total: 1 } });
    }
    if (path === '/api/products/deals' || path === '/api/products' || path === '/api/search/products') {
      const data = ALL_PRODUCTS.slice(0, 6);
      return respond({ data, meta: { page: 1, pageSize: 6, total: data.length, totalPages: 1 } });
    }
    const reviews = /^\/api\/products\/[^/]+\/reviews(\/me)?$/.exec(path);
    if (reviews) {
      if (reviews[1]) return respond({ data: null });
      return respond({ data: [], summary: { averageRating: null, reviewCount: 0 }, meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    }
    if (/^\/api\/products\/[^/]+\/recommendations$/.test(path)) {
      mock.productRequests++;
      if (mock.productStatus !== 200) return respond({ error: { code: 'INTERNAL_ERROR', message: 'Recommendations are unavailable.' } }, mock.productStatus);
      return respond({ data: { sections: mock.productSections } });
    }
    const productMatch = /^\/api\/products\/([^/]+)$/.exec(path);
    if (productMatch) {
      const slug = decodeURIComponent(productMatch[1] ?? '');
      const item = ALL_PRODUCTS.find(candidate => candidate.slug === slug);
      return item ? respond({ data: detail(item) }) : respond({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } }, 404);
    }
    if (path === '/api/recommendations/popular') {
      mock.popularRequests++;
      return respond({ data: mock.popular });
    }
    if (path === '/api/recommendations/cart' && method === 'POST') return respond({ data: mock.cart });
    if (path === '/api/recommendations/events' && method === 'POST') {
      const body = request.postDataJSON() as EventsBody;
      mock.events.push(body);
      return respond({ data: { accepted: body.events.length } }, 202);
    }
    if (path === '/api/cart/validate' && method === 'POST') {
      const body = request.postDataJSON() as { items: { productId: string; quantity: number }[] };
      const lines = body.items.map(entry => {
        const item = ALL_PRODUCTS.find(candidate => candidate.id === entry.productId);
        return item ? cartLine(item, entry.quantity) : null;
      });
      if (lines.some(line => line === null)) return respond({ error: { code: 'NOT_FOUND', message: 'Unknown product.' } }, 404);
      const subtotal = lines.reduce((total, line) => total + Number(line?.lineTotal ?? 0), 0).toFixed(2);
      return respond({ data: { revision: 'rev-task04-mock', items: lines, totalQuantity: body.items.reduce((total, entry) => total + entry.quantity, 0),
        subtotal, shipping: '0.00', total: subtotal, currency: 'USD', canCheckout: true } });
    }
    if (path.startsWith('/api/me/')) mock.personalRequests++;
    mock.unmocked.push(`${method} ${path}`);
    return respond({ error: { code: 'NOT_MOCKED', message: 'Not mocked in this spec.' } }, 404);
  });
  return mock;
}

/** Tab from the top of the document until `target` has focus (a real keyboard reachability check). */
async function tabUntilFocused(page: Page, target: Locator, maxPresses = 400): Promise<boolean> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const handle = await target.elementHandle();
  if (!handle) return false;
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(element => element === document.activeElement, handle)) return true;
  }
  return false;
}

/** Scrolls the whole page once so scroll-triggered reveals settle before a full-page capture. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.7));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    window.scrollTo(0, 0);
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('product detail shows Similar and You May Also Like rails and hides an empty Frequently Bought Together rail', async ({ page }, testInfo) => {
      const mock = await mockApi(page);
      await page.goto(`/products/${ANCHOR.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: ANCHOR.name })).toBeVisible();

      await expect(page.getByRole('heading', { name: 'Similar Products', exact: true })).toBeVisible();
      await expect(page.getByText('Products that look alike, matched by our image model.')).toBeVisible();
      const similarRail = page.getByRole('list', { name: 'Similar Products' });
      await expect(similarRail.getByRole('listitem')).toHaveCount(4);

      await expect(page.getByRole('heading', { name: 'You May Also Like', exact: true })).toBeVisible();
      await expect(page.getByRole('list', { name: 'You May Also Like' }).getByRole('listitem')).toHaveCount(4);

      await expect(page.getByRole('heading', { name: 'Frequently Bought Together' })).toHaveCount(0);
      await expect(page.getByTestId('rail-frequently-bought-together-title')).toHaveCount(0);

      expect(await tabUntilFocused(page, similarRail.getByRole('link', { name: SIMILAR[0]!.name, exact: true }))).toBe(true);
      await expectNoHorizontalOverflow(page);

      await settle(page);
      await page.screenshot({ path: testInfo.outputPath(`pdp-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
      expect(mock.unmocked).toEqual([]);
    });

    test('product detail labels a same-category fallback as More in the category with a category link', async ({ page }) => {
      const mock = await mockApi(page);
      mock.productSections = [
        section({ mode: 'SIMILAR_PRODUCTS', surface: 'product_detail', strategy: 'FALLBACK_CATEGORY', isFallback: true,
          fallbackReason: 'AI_UNAVAILABLE', context: { categoryName: CATEGORY.name, categorySlug: CATEGORY.slug },
          items: SIMILAR, impressionToken: TOKENS.similar }),
        noDataSection('YOU_MAY_ALSO_LIKE', 'product_detail'),
        noDataSection('FREQUENTLY_BOUGHT_TOGETHER', 'product_detail'),
      ];
      await page.goto(`/products/${ANCHOR.slug}`);
      await expect(page.getByRole('heading', { name: `More in ${CATEGORY.name}`, exact: true })).toBeVisible();
      await expect(page.getByText('Newest products in this category.')).toBeVisible();
      await expect(page.getByRole('link', { name: /View category/ })).toHaveAttribute('href', `/products?category=${CATEGORY.slug}`);
      await expect(page.getByRole('heading', { name: 'Similar Products', exact: true })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(mock.unmocked).toEqual([]);
    });

    test('product detail keeps the product and purchase actions when recommendations fail, with a retry', async ({ page }) => {
      const mock = await mockApi(page);
      mock.productStatus = 500;
      await page.goto(`/products/${ANCHOR.slug}`);
      await expect(page.getByRole('heading', { level: 1, name: ANCHOR.name })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add to Cart', exact: true })).toBeVisible();

      const unavailable = page.getByRole('status').filter({ hasText: 'These suggestions are unavailable right now.' });
      await expect(unavailable).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Similar Products', exact: true })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Similar Products' })).toHaveCount(0);

      const before = mock.productRequests;
      await unavailable.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect.poll(() => mock.productRequests).toBeGreaterThan(before);
      await expect(unavailable).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(mock.unmocked).toEqual([]);
    });

    test('similar rail records a viewable impression with its token and a click on navigation', async ({ page }) => {
      const mock = await mockApi(page);
      await page.goto(`/products/${ANCHOR.slug}`);
      const similarRail = page.getByRole('list', { name: 'Similar Products' });
      await expect(similarRail.getByRole('listitem')).toHaveCount(4);

      await similarRail.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(1500);
      await expect.poll(() => mock.events.some(body => body.token === TOKENS.similar
        && body.events.some(event => event.type === 'IMPRESSION' && SIMILAR.some(item => item.id === event.productId)))).toBe(true);

      const target = SIMILAR[0]!;
      await similarRail.getByRole('link', { name: target.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/products/${target.slug}$`));
      await expect(page.getByRole('heading', { level: 1, name: target.name })).toBeVisible();
      await expect.poll(() => mock.events.some(body => body.token === TOKENS.similar
        && body.events.some(event => event.type === 'CLICK' && event.productId === target.id))).toBe(true);
      expect(mock.unmocked).toEqual([]);
    });

    test('home shows Popular Products only from measured demand and never Recommended for You for an anonymous visitor', async ({ page }, testInfo) => {
      const mock = await mockApi(page);
      mock.popular = section({ mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'MEASURED_POPULARITY', items: POPULAR, impressionToken: TOKENS.popular });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'New Arrivals', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Popular Products', exact: true })).toBeVisible();
      await expect(page.getByText('In demand with shoppers over the last 30 days.')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Popular Products' }).getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('heading', { name: 'Recommended for You' })).toHaveCount(0);
      expect(mock.personalRequests).toBe(0);
      await expectNoHorizontalOverflow(page);

      await settle(page);
      await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
      expect(mock.unmocked).toEqual([]);
    });

    test('home hides the Popular rail when the popularity result is a new-arrivals fallback', async ({ page }) => {
      const mock = await mockApi(page);
      mock.popular = section({ mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'FALLBACK_NEW_ARRIVALS', isFallback: true,
        fallbackReason: 'NO_MEASURED_DEMAND', items: POPULAR, impressionToken: TOKENS.popular });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'New Arrivals', exact: true })).toBeVisible();
      await expect.poll(() => mock.popularRequests).toBeGreaterThan(0);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { name: 'Popular Products', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('rail-popular-products-title')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Recommended for You' })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(mock.unmocked).toEqual([]);
    });

    test('cart shows Frequently Bought Together only with co-purchase evidence and leaves checkout unchanged', async ({ page }) => {
      const mock = await mockApi(page);
      mock.cart = section({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart', strategy: 'CO_PURCHASE', items: CART_SUGGESTIONS, impressionToken: TOKENS.cart });
      await page.addInitScript(items => { localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items })); },
        [{ productId: ANCHOR.id, quantity: 1 }]);

      await page.goto('/cart');
      await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
      const checkout = page.getByRole('button', { name: 'Sign in to Checkout', exact: true });
      await expect(checkout).toBeEnabled();
      await expect(page.getByRole('heading', { name: 'Frequently Bought Together', exact: true })).toBeVisible();
      await expect(page.getByText('Often ordered with items in your cart.')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Frequently Bought Together' }).getByRole('listitem')).toHaveCount(4);
      await expectNoHorizontalOverflow(page);

      mock.cart = section({ mode: 'FREQUENTLY_BOUGHT_TOGETHER', surface: 'cart', strategy: 'NO_DATA' });
      await page.goto('/cart');
      await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Frequently Bought Together' })).toHaveCount(0);
      await expect(page.getByTestId('rail-cart-bought-together-title')).toHaveCount(0);
      await expect(checkout).toBeEnabled();
      expect(mock.unmocked).toEqual([]);
    });
  });
}
