import { expect, test, type Page, type Locator } from '@playwright/test';
import { wishlistProduct } from '../../src/features/wishlist/fixtures';

const first = wishlistProduct;
const second = { ...first, id: '41f516ae-8385-4dcb-9a85-90b5dc9fe363', name: 'Second Apple smartphone', slug: 'second-phone' };
const third = { ...first, id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', name: 'Third Apple smartphone', slug: 'third-phone' };
const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'wishlist@example.invalid', firstName: 'Wish', lastName: 'Customer', role: 'CUSTOMER' };
async function harness(page: Page, options: { signedIn?: boolean; serverIds?: string[]; outOfStock?: boolean; delayWishlist?: boolean; delayProducts?: boolean; delayMutation?: boolean; cartQuantity?: number; delayUserVerification?: boolean } = {}) {
  let signedIn = options.signedIn ?? false;
  let ids = options.serverIds ?? [];
  let failMerge = false;
  let failMutation = false;
  let merges = 0;
  let releaseWishlist: (() => void) | undefined;
  let wishlistGate = Promise.resolve();
  let releaseMutation: (() => void) | undefined;
  let signalMutationStarted!: () => void;
  const mutationStarted = new Promise<void>(resolve => { signalMutationStarted = resolve; });
  const mutationGate = options.delayMutation ? new Promise<void>(resolve => { releaseMutation = resolve; }) : Promise.resolve();
  let deleteRequests = 0;
  let releaseProducts: (() => void) | undefined;
  let reviewRequests = 0;
  let wishlistReads = 0;
  let cartReads = 0;
  let releaseUserVerification: (() => void) | undefined;
  const userGate = options.delayUserVerification ? new Promise<void>(resolve => { releaseUserVerification = resolve; }) : Promise.resolve();
  const holdWishlist = () => { wishlistGate = new Promise<void>(resolve => { releaseWishlist = resolve; }); };
  if (options.delayWishlist) holdWishlist();
  const productsGate = options.delayProducts ? new Promise<void>(resolve => { releaseProducts = resolve; }) : Promise.resolve();
  const products = [options.outOfStock ? { ...first, availability: 'UNAVAILABLE' } : first, second, third];
  const hydrate = (productIds: string[]) => ({ data: { items: productIds.map(productId => ({ productId,
    product: products.find(product => product.id === productId) ?? null,
    availability: !products.some(product => product.id === productId) ? 'UNAVAILABLE' : options.outOfStock && productId === first.id ? 'OUT_OF_STOCK' : 'AVAILABLE' })), totalItems: productIds.length } });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.includes('/reviews')) reviewRequests++;
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/refresh') return signedIn ? send({ accessToken: 'intercepted-test' }) : send({ error: 'Unauthenticated' }, 401);
    if (url.pathname === '/api/auth/me') { await userGate; return signedIn ? send({ user }) : send({ error: 'Unauthenticated' }, 401); }
    if (url.pathname === '/api/auth/login') { signedIn = true; return send({ user, accessToken: 'intercepted-test' }); }
    if (url.pathname === '/api/auth/logout') { signedIn = false; return send({}); }
    if (url.pathname === '/api/wishlist/validate') { await wishlistGate; return send(hydrate(route.request().postDataJSON().productIds)); }
    if (url.pathname === '/api/wishlist/reconcile') {
      merges++; if (failMerge) return send({ error: { message: 'private database error' } }, 503);
      ids = [...new Set([...ids, ...route.request().postDataJSON().productIds as string[]])]; return send({ data: { ...hydrate(ids).data, unresolved: [] } });
    }
    if (url.pathname === '/api/wishlist') { wishlistReads++; await wishlistGate; return send(hydrate(ids)); }
    if (url.pathname.startsWith('/api/wishlist/items')) {
      if (method === 'DELETE') deleteRequests++;
      if (failMutation) return send({ error: { message: 'private database error' } }, 503);
      const productId = method === 'DELETE' ? url.pathname.split('/').at(-1)! : route.request().postDataJSON().productId as string;
      ids = method === 'DELETE' ? ids.filter(id => id !== productId) : [...new Set([...ids, productId])];
      signalMutationStarted(); await mutationGate; return send(hydrate(ids));
    }
    if (url.pathname === '/api/cart/validate') {
      const input = route.request().postDataJSON().items as { productId: string; quantity: number }[];
      return send({ data: { items: input.map(item => ({ ...item, id: null, availableQuantity: 5, availability: 'AVAILABLE', lineTotal: '1099.99',
        product: { name: first.name, slug: first.slug, category: 'Phones', price: first.price, image: first.primaryImage } })),
        totalQuantity: input.reduce((sum, item) => sum + item.quantity, 0), subtotal: '1099.99', total: '1099.99', shipping: '0.00', currency: 'USD', canCheckout: true } });
    }
    if (url.pathname === '/api/cart') { cartReads++; if (options.cartQuantity) await wishlistGate; return send({ data: { items: [], totalQuantity: options.cartQuantity ?? 0, subtotal: '0.00', total: '0.00', shipping: '0.00', currency: 'USD', canCheckout: false } }); }
    if (url.pathname.endsWith('/reviews/me')) return send({ data: null });
    if (url.pathname.endsWith('/reviews')) return send({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, summary: { averageRating: null, reviewCount: 0 } });
    if (url.pathname === `/api/products/${first.slug}`) return send({ data: { ...first, sku: 'PHONE', modelNumber: null, availableQuantity: 5,
      images: [first.primaryImage, { ...first.primaryImage, id: 'second-image', sortOrder: 1, isPrimary: false }], specifications: [] } });
    if (url.pathname === '/api/search/products' && options.delayProducts) await productsGate;
    if (url.pathname === '/api/search/products' || url.pathname === '/api/products' || url.pathname === '/api/products/deals') return send({ data: products, meta: { page: 1, pageSize: 20, total: products.length, totalPages: 1 } });
    return send({ data: [], meta: { page: 1, pageSize: 100, total: 0 } });
  });
  return { failMerge: (value: boolean) => { failMerge = value; }, failMutation: (value: boolean) => { failMutation = value; }, merges: () => merges,
    holdWishlist, releaseWishlist: () => releaseWishlist?.(), releaseProducts: () => releaseProducts?.(), reviewRequests: () => reviewRequests,
    wishlistReads: () => wishlistReads, cartReads: () => cartReads, releaseUserVerification: () => releaseUserVerification?.(),
    mutationStarted, releaseMutation: () => releaseMutation?.(), deleteRequests: () => deleteRequests, serverIds: () => [...ids] };
}
async function login(page: Page) {
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('WishlistPass123!');
  await page.getByRole('dialog').getByRole('button', { name: 'Login' }).click();
}
async function storedAuthenticatedCount(page: Page) {
  return page.evaluate(userId => {
    const value = sessionStorage.getItem(`electrohub.wishlist.auth-count.v1:${userId}`);
    if (!value) return null;
    try { return JSON.parse(value).count; } catch { return Number(value); }
  }, user.id);
}
async function countAtRefreshInit(page: Page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('wishlist-test:refresh-count-at-init');
    if (!raw || raw === 'unknown') return undefined;
    try { return JSON.parse(raw).count as number; } catch { return Number(raw); }
  });
}
async function renderedWishlistIds(page: Page) {
  const idBySlug = new Map([first, second, third].map(product => [product.slug, product.id]));
  return (await page.getByTestId('product-card').evaluateAll(cards => cards.map(card =>
    card.querySelector('a[href^="/products/"]')?.getAttribute('href')?.split('/').at(-1) ?? null)))
    .map(slug => idBySlug.get(slug ?? '') ?? `UNMAPPED:${slug}`).sort();
}
async function observeFirstRefreshFrame(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.removeItem('wishlist-test:first-refresh-frame');
    const user = JSON.parse(sessionStorage.getItem('electrohub:cached-user') ?? 'null');
    const rawCount = user?.id ? sessionStorage.getItem(`electrohub.wishlist.auth-count.v1:${user.id}`) : null;
    sessionStorage.setItem('wishlist-test:refresh-count-at-init', rawCount ?? 'unknown');
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[aria-label="Loading wishlist"]')) return;
      sessionStorage.setItem('wishlist-test:first-refresh-frame', JSON.stringify({
        skeletons: document.querySelectorAll('[data-testid="product-skeleton"]').length,
        countLoading: Boolean(document.querySelector('[aria-label="Wishlist count loading"]')),
        headerLabel: document.querySelector('header a[href="/wishlist"]')?.getAttribute('aria-label'),
        falseZero: document.querySelector('main')?.textContent?.includes('0 items') ?? false,
      }));
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}
async function expectFirstRefreshFrame(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('wishlist-test:first-refresh-frame') ?? 'null')))
    .toEqual({ skeletons: count, countLoading: true, headerLabel: 'Wishlist', falseZero: false });
}
async function openProducts(page: Page) {
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: `Add ${first.name} to wishlist` })).toBeVisible();
}
async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 70; index++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) {
      expect(await target.evaluate(element => element.matches(':focus-visible'))).toBe(true); return;
    }
  }
  throw new Error('Keyboard target unreachable');
}

test('A–I guest hearts, persistence, independent navigation, count, focus and empty', async ({ page }) => {
  await harness(page); await openProducts(page);
  await page.getByRole('button', { name: `Add ${first.name} to wishlist` }).click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole('button', { name: `Remove ${first.name} from wishlist` })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.getByRole('button', { name: `Remove ${first.name} from wishlist` })).toBeVisible();
  await page.getByRole('button', { name: `Remove ${first.name} from wishlist` }).click();
  await page.getByRole('button', { name: `Add ${first.name} to wishlist` }).click();
  await page.locator('[data-testid="product-card"]').first().getByRole('link', { name: first.name }).click();
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  const secondary = page.getByRole('tablist', { name: 'Product thumbnails' }).getByRole('tab').nth(1);
  await secondary.click();
  await expect(page.getByRole('button', { name: `Remove ${first.name} from wishlist`, exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: `Remove ${first.name} from wishlist`, exact: true }).first().click();
  await expect(secondary).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: `Add ${first.name} to wishlist`, exact: true }).first().click();
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Wishlist', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: first.name })).toBeVisible();
  await page.locator('[data-testid="product-card"]').getByRole('link', { name: first.name }).click();
  await page.goBack();
  await page.getByRole('button', { name: `Remove ${first.name} from wishlist` }).click();
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore Products' })).toBeFocused();
});
test('J–K Wishlist Cart independence and out-of-stock removal', async ({ page }) => {
  await harness(page); await openProducts(page); await page.getByRole('button', { name: `Add ${first.name} to wishlist` }).click();
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await page.getByRole('button', { name: `Add ${first.name} to cart` }).click();
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove ${first.name} from wishlist` })).toBeVisible();
});
test('K out-of-stock active product stays saved and removable', async ({ page }) => {
  await harness(page, { outOfStock: true }); await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: `Add ${first.name} to wishlist` })).toBeVisible();
  await page.getByRole('button', { name: `Add ${first.name} to wishlist` }).click();
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await expect(page.getByText('Out of stock', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: `Add ${first.name} to cart` })).toBeDisabled();
  await page.getByRole('button', { name: `Remove ${first.name} from wishlist` }).click();
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();
});
test('authenticated Wishlist refresh never flashes Empty while saved items are loading', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [first.id, second.id, third.id], delayWishlist: true });
  await page.addInitScript(({ cachedUser, knownCount }) => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, String(knownCount));
  }, { cachedUser: user, knownCount: 3 });
  const wishlistRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/wishlist');
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status', { name: 'Wishlist count loading' })).toBeVisible();
  await expect(page.getByTestId('product-skeleton')).toHaveCount(3);
  await expect(page.getByText('0 items', { exact: true })).toHaveCount(0);
  await wishlistRequest;
  await expect(page.getByRole('status', { name: 'Loading wishlist' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Wishlist count loading' })).toBeVisible();
  await expect(page.getByText('0 items', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
  await expect(page.getByTestId('product-skeleton')).toHaveCount(3);
  state.releaseWishlist();
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(3);
  await expect(page.getByRole('status', { name: '3 items' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
});
test('authenticated Wishlist refresh clamps known counts above ten skeletons', async ({ page }) => {
  const ids = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const state = await harness(page, { signedIn: true, serverIds: ids, delayWishlist: true });
  await page.addInitScript(({ cachedUser, knownCount }) => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, String(knownCount));
  }, { cachedUser: user, knownCount: 12 });
  const wishlistRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/wishlist');
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await wishlistRequest;
  await expect(page.getByRole('status', { name: 'Wishlist count loading' })).toBeVisible();
  await expect(page.getByText('0 items', { exact: true })).toHaveCount(0);
  for (const [width, expectedColumns] of [[390, 1], [768, 2], [1440, 4], [1920, 5]]) {
    await page.setViewportSize({ width, height: 906 });
    const skeletons = page.getByTestId('product-skeleton');
    await expect(skeletons).toHaveCount(10);
    expect(await skeletons.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().left))).size)).toBe(expectedColumns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  state.releaseWishlist();
  await expect(page.getByRole('status', { name: '12 items' })).toBeVisible();
});
test('authenticated confirmed-empty refresh keeps one neutral skeleton until the empty response resolves', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [], delayWishlist: true });
  await page.addInitScript(cachedUser => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, '0');
  }, user);
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status', { name: 'Loading wishlist' })).toBeVisible();
  await expect(page.getByTestId('product-skeleton')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
  expect(state.deleteRequests()).toBe(0);
  state.releaseWishlist();
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();
  await expect(page.getByTestId('product-skeleton')).toHaveCount(0);
  expect(state.deleteRequests()).toBe(0);
});
test('stable authenticated Wishlist preserves exact Product IDs across ten hard refreshes', async ({ page }) => {
  const expectedIds = [first.id, second.id].sort();
  const state = await harness(page, { signedIn: true, serverIds: expectedIds });
  await page.addInitScript(({ cachedUser, count }) => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, String(count));
  }, { cachedUser: user, count: expectedIds.length });
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status', { name: '2 items' })).toBeVisible();
  expect(await renderedWishlistIds(page)).toEqual(expectedIds);
  const evidence: { before: string[]; get: string[]; rendered: string[] }[] = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    const before = state.serverIds().sort();
    const getResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/wishlist' && response.request().method() === 'GET');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const getIds = ((await (await getResponse).json()).data.items as { productId: string }[]).map(item => item.productId).sort();
    await expect(page.getByTestId('product-card')).toHaveCount(expectedIds.length);
    const rendered = await renderedWishlistIds(page);
    expect(before).toEqual(expectedIds);
    expect(getIds).toEqual(expectedIds);
    expect(rendered).toEqual(expectedIds);
    expect(state.deleteRequests()).toBe(0);
    evidence.push({ before, get: getIds, rendered });
  }
  expect(evidence).toHaveLength(10);
});
test('immediate authenticated zero-to-one Add survives hard refresh without flashing Empty', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [], delayMutation: true });
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(0);
  await page.getByRole('button', { name: `Add ${third.name} to wishlist` }).click();
  await expect(page.getByRole('button', { name: `Remove ${third.name} from wishlist` })).toBeVisible();
  await state.mutationStarted;
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(1);
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await expect(page).toHaveURL(/\/wishlist$/);
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(1);
  state.holdWishlist();
  await observeFirstRefreshFrame(page);
  const wishlistRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/wishlist');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wishlistRequest;
  expect(await countAtRefreshInit(page)).toBe(1);
  await expectFirstRefreshFrame(page, 1);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Wishlist count loading' })).toBeVisible();
  await expect(page.getByTestId('product-skeleton')).toHaveCount(1);
  await expect(page.getByText('0 items', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/wishlist-zero-add-refresh-loading.png' });
  state.releaseMutation(); state.releaseWishlist();
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(1);
  await expect(page.getByRole('status', { name: '1 item' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/wishlist-zero-add-refresh-resolved.png' });
});
test('immediate authenticated Add count is the first loading count after hard refresh', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [first.id], delayMutation: true });
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(1);
  await page.getByRole('button', { name: `Add ${third.name} to wishlist` }).click();
  await expect(page.getByRole('button', { name: `Remove ${third.name} from wishlist` })).toBeVisible();
  await state.mutationStarted;
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(2);
  await page.getByRole('link', { name: 'Wishlist (2)', exact: true }).click();
  await expect(page).toHaveURL(/\/wishlist$/);
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(2);
  state.holdWishlist();
  await observeFirstRefreshFrame(page);
  const wishlistRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/wishlist');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wishlistRequest;
  expect(await countAtRefreshInit(page)).toBe(2);
  await expectFirstRefreshFrame(page, 2);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (2)', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Wishlist count loading' })).toBeVisible();
  await expect(page.getByTestId('product-skeleton')).toHaveCount(2);
  await expect(page.getByText('0 items', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
  expect(state.deleteRequests()).toBe(0);
  await page.screenshot({ path: 'test-results/wishlist-add-refresh-loading.png' });
  state.releaseMutation(); state.releaseWishlist();
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(2);
  await expect(page.getByRole('status', { name: '2 items' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (2)', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/wishlist-add-refresh-resolved.png' });
});
test('immediate authenticated Remove count is the first loading count after hard refresh and refresh never deletes', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [first.id, second.id], delayMutation: true });
  await page.addInitScript(cachedUser => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser)), user);
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status', { name: '2 items' })).toBeVisible();
  await page.getByRole('button', { name: `Remove ${first.name} from wishlist` }).click();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '1 item' })).toBeVisible();
  await state.mutationStarted;
  await expect.poll(() => storedAuthenticatedCount(page)).toBe(1);
  const deleteCountBeforeRefresh = state.deleteRequests();
  state.holdWishlist();
  await observeFirstRefreshFrame(page);
  const wishlistRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/wishlist');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wishlistRequest;
  expect(await countAtRefreshInit(page)).toBe(1);
  await expectFirstRefreshFrame(page, 1);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Wishlist count loading' })).toBeVisible();
  await expect(page.getByTestId('product-skeleton')).toHaveCount(1);
  await expect(page.getByText('0 items', { exact: true })).toHaveCount(0);
  expect(state.deleteRequests()).toBe(deleteCountBeforeRefresh);
  await page.screenshot({ path: 'test-results/wishlist-remove-refresh-loading.png' });
  state.releaseMutation(); state.releaseWishlist();
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(1);
  await expect(page.getByRole('status', { name: '1 item' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/wishlist-remove-refresh-resolved.png' });
});
test('navigating to Account from a scrolled customer page starts at the top', async ({ page }) => {
  await harness(page, { signedIn: true });
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.body.style.minHeight = '2400px'; });
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'My Account', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
test('reconciliation response immediately displays server two plus one unique guest Product', async ({ page }) => {
  const guestProductId = '62a990ff-7909-4bbb-b42f-8f20b6d97af4';
  const state = await harness(page, { signedIn: true, serverIds: [first.id, second.id] });
  await page.addInitScript(productId => localStorage.setItem('electrohub.wishlist.v1', JSON.stringify({ productIds: [productId] })), guestProductId);
  const reconciliation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/wishlist/reconcile');
  await page.goto('/wishlist');
  await reconciliation;
  await expect(page.getByRole('status', { name: '3 items' })).toBeVisible();
  await expect(page.getByRole('status', { name: '2 items' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('electrohub.wishlist.v1'))).toBeNull();
  expect(state.wishlistReads()).toBe(0);
});
test('authenticated refresh renders cards and both badges directly from resolved provider state', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [first.id, second.id, third.id], delayWishlist: true, cartQuantity: 2 });
  await page.addInitScript(cachedUser => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, '3');
    const times: Record<string, number> = {};
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="product-card"]') && times.cards === undefined) times.cards = performance.now();
      if (document.querySelector('header a[aria-label="Wishlist (3)"]') && times.wishlistBadge === undefined) times.wishlistBadge = performance.now();
      if (document.querySelector('header a[aria-label="Cart, 2 items"]') && times.cartBadge === undefined) times.cartBadge = performance.now();
      sessionStorage.setItem('wishlist-test:resolved-timings', JSON.stringify(times));
    }).observe(document, { childList: true, subtree: true, attributes: true });
  }, user);
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('product-skeleton')).toHaveCount(3);
  await expect.poll(() => state.wishlistReads()).toBe(1);
  await expect.poll(() => state.cartReads()).toBe(1);
  state.releaseWishlist();
  await expect(page.getByTestId('product-card')).toHaveCount(3);
  await expect(page.getByTestId('product-skeleton')).toHaveCount(0);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist (3)', exact: true })).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: 'Cart, 2 items', exact: true })).toBeVisible();
  const times = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wishlist-test:resolved-timings') ?? '{}') as Record<string, number>);
  expect(Math.abs(times.cards - times.wishlistBadge)).toBeLessThan(100);
  expect(Math.abs(times.cards - times.cartBadge)).toBeLessThan(100);
  await page.waitForLoadState('networkidle');
  expect(state.wishlistReads()).toBe(1);
  expect(state.cartReads()).toBe(1);
  const network = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType('resource')
    .filter(entry => ['/api/wishlist', '/api/cart'].includes(new URL(entry.name).pathname))
    .map(entry => { const resource = entry as PerformanceResourceTiming; return [new URL(entry.name).pathname, { responseEnd: resource.responseEnd, duration: resource.duration }]; })));
  const wishlistRenderDelay = times.cards - network['/api/wishlist'].responseEnd;
  const cartBadgeDelay = times.cartBadge - network['/api/cart'].responseEnd;
  expect(wishlistRenderDelay).toBeLessThan(100);
  expect(cartBadgeDelay).toBeLessThan(100);
  console.log('Wishlist refresh timings (ms)', { ...times, network, wishlistRenderDelay, cartBadgeDelay });
});
test('Wishlist refresh overlaps Cart and Wishlist reads with auth verification instead of serializing them', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [first.id, second.id], delayWishlist: true, cartQuantity: 2, delayUserVerification: true });
  await page.addInitScript(cachedUser => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, '2');
  }, user);
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => state.wishlistReads()).toBe(1);
  await expect.poll(() => state.cartReads()).toBe(1);
  await expect(page.getByTestId('product-skeleton')).toHaveCount(2);
  state.releaseWishlist();
  await page.waitForResponse(response => new URL(response.url()).pathname === '/api/wishlist');
  await expect(page.getByTestId('product-card')).toHaveCount(0);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist (2)', exact: true })).toHaveCount(0);
  state.releaseUserVerification();
  await expect(page.getByTestId('product-card')).toHaveCount(2);
  await expect(page.getByTestId('product-skeleton')).toHaveCount(0);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist (2)', exact: true })).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: 'Cart, 2 items', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(state.wishlistReads()).toBe(1);
  expect(state.cartReads()).toBe(1);
});
test('Wishlist and Products render usable cards promptly after their required data resolves', async ({ page }) => {
  await harness(page, { signedIn: true, serverIds: [first.id, second.id, third.id] });
  await page.addInitScript(() => {
    sessionStorage.removeItem('wishlist-test:first-cards');
    const readJson = Response.prototype.json;
    Response.prototype.json = async function () {
      const value = await readJson.call(this);
      const endpoint = new URL(this.url).pathname;
      if (['/api/wishlist', '/api/search/products', '/api/auth/me'].includes(endpoint)) {
        sessionStorage.setItem(`wishlist-test:data-ready:${endpoint}`, String(performance.now()));
      }
      return value;
    };
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="product-card"]')) return;
      sessionStorage.setItem('wishlist-test:first-cards', String(performance.now()));
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const measured: Record<string, { visible: number; responseToCards: number; requiredDataToCards: number }> = {};
  for (const [path, endpoint] of [['/products', '/api/search/products'], ['/wishlist', '/api/wishlist']]) {
    await page.goto(path!, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('product-card')).toHaveCount(3);
    measured[path!] = await page.evaluate(apiPath => {
      const visible = Number(sessionStorage.getItem('wishlist-test:first-cards'));
      const resource = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === apiPath) as PerformanceResourceTiming;
      const dataReady = Number(sessionStorage.getItem(`wishlist-test:data-ready:${apiPath}`));
      const verificationReady = Number(sessionStorage.getItem('wishlist-test:data-ready:/api/auth/me'));
      const requiredDataReady = apiPath === '/api/wishlist' ? Math.max(dataReady, verificationReady) : dataReady;
      return { visible, responseToCards: visible - resource.responseEnd, requiredDataToCards: visible - requiredDataReady };
    }, endpoint!);
    console.log('Catalog render timing', path, measured[path!]);
    expect(measured[path!]!.requiredDataToCards).toBeLessThan(100);
    await expect(page.getByTestId('product-skeleton')).toHaveCount(0);
  }
  console.log('Products versus Wishlist browser timing (ms)', measured);
});
test('authenticated profile menu opens with motion and supports focus-safe dismissal and reduced motion', async ({ page }) => {
  await harness(page, { signedIn: true });
  await page.goto('/wishlist');
  const trigger = page.getByRole('button', { name: 'Account menu for Wish Customer' });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const openAnimation = await menu.evaluate(element => getComputedStyle(element).animationName);
  expect(openAnimation).not.toBe('none');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(1500, 800);
  await expect(menu).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});
test('products loading grid fills responsive columns and cards reuse rating aggregates without Review requests', async ({ page }) => {
  const state = await harness(page, { delayProducts: true });
  const searchRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/search/products');
  await page.goto('/products?pageSize=10', { waitUntil: 'domcontentloaded' }); await searchRequest;
  const skeletons = page.getByTestId('product-skeleton');
  await expect(skeletons).toHaveCount(10);
  for (const [width, expectedColumns] of [[390, 1], [768, 2], [1440, 3], [1920, 3]]) {
    await page.setViewportSize({ width, height: 906 });
    const columnCount = await skeletons.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().left))).size);
    expect(columnCount, `skeleton columns at ${width}px`).toBe(expectedColumns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  state.releaseProducts(); await expect(page.getByTestId('product-card')).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Rated 4.9 out of 5.' }).first()).toBeVisible();
  expect(await state.reviewRequests()).toBe(0);
});
test('L–P union retry, failure retention, refresh and logout/relogin isolation', async ({ page }) => {
  const state = await harness(page, { serverIds: [second.id] });
  await openProducts(page); await page.getByRole('button', { name: `Add ${first.name} to wishlist` }).click();
  await page.getByRole('button', { name: `Add ${second.name} to wishlist` }).click();
  state.failMerge(true); await login(page);
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click();
  await expect(page.getByText('Your saved products could not be merged.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('electrohub.wishlist.v1'))).not.toBeNull();
  state.failMerge(false); await page.getByRole('button', { name: 'Retry saved products' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.locator('[data-testid="product-card"]')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem('electrohub.wishlist.v1'))).toBeNull(); expect(state.merges()).toBe(2);
  await page.reload(); await expect(page.locator('[data-testid="product-card"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Account menu for Wish Customer' }).click(); await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out' }).click(); await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('electrohub.wishlist.v1'))).toBeNull();
  await page.getByRole('link', { name: 'Wishlist', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();
  await login(page); await page.getByRole('link', { name: 'Wishlist (2)', exact: true }).click();
  await expect(page.locator('[data-testid="product-card"]')).toHaveCount(2);
});
test('Q authenticated Add/Remove failures roll back safely without unrelated refresh', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [second.id] }); await openProducts(page);
  state.failMutation(true); await page.getByRole('button', { name: `Add ${first.name} to wishlist` }).click();
  await expect(page.getByRole('alert')).toContainText('restored'); await expect(page.getByRole('button', { name: `Add ${first.name} to wishlist` })).toBeVisible();
  await page.getByRole('link', { name: 'Wishlist (1)', exact: true }).click(); await page.getByRole('button', { name: `Remove ${second.name} from wishlist` }).click();
  await expect(page.getByRole('alert')).toContainText('restored'); await expect(page.getByRole('button', { name: `Remove ${second.name} from wishlist` })).toBeVisible();
  state.failMutation(false); await page.getByRole('button', { name: `Remove ${second.name} from wishlist` }).click();
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();
});
test('R responsive screenshots, layout, shell, readable controls and overflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await harness(page, { signedIn: true, serverIds: [first.id, second.id] }); await page.goto('/wishlist');
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 906 }); await expect(page.getByRole('heading', { name: 'Wishlist', exact: true })).toBeVisible();
    await expect(page.getByText('2 items', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Remove ${first.name} from wishlist` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Add ${first.name} to cart` })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Rated 4.9 out of 5.' }).first()).toBeVisible();
    await expect(page.getByText('(318)', { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-testid="product-card"]').first().getByRole('link', { name: first.name })).toHaveAttribute('href', `/products/${first.slug}`);
    await expect(page.locator('header')).toBeVisible(); await expect(page.locator('footer')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('[data-testid="product-card"]').first().evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(220);
    await page.screenshot({ path: `screenshots/wishlist-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: `Remove ${second.name} from wishlist` }).click();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await page.screenshot({ path: 'screenshots/wishlist-reference-1920.png', fullPage: false });
  await page.setViewportSize({ width: 1920, height: 907 });
  await page.locator('[data-testid="product-card"]').getByRole('link', { name: first.name }).click();
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="product-gallery"] img').first()).toBeVisible();
  await expect.poll(() => page.locator('[data-testid="product-gallery"] img').first().evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(() => page.locator('[data-testid="product-gallery"] img').first().evaluate(image => getComputedStyle(image).opacity)).toBe('1');
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 1920 ? 907 : 906 });
    await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Cart', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Remove ${first.name} from wishlist`, exact: true }).first()).toBeAttached();
    await expect(page.locator('header')).toBeVisible(); await expect(page.locator('footer')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `screenshots/wishlist-details-${width}.png`, fullPage: width !== 1920 });
  }
  await page.setViewportSize({ width: 1920, height: 906 });
  const related = page.getByRole('heading', { name: 'More in Phones' });
  await expect.poll(async () => {
    await related.evaluate(element => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 96, behavior: 'instant' }));
    return related.evaluate(element => element.getBoundingClientRect().top);
  }).toBeGreaterThanOrEqual(68);
  await expect(related).toBeInViewport();
  await page.screenshot({ path: 'screenshots/wishlist-related-1920.png', fullPage: false });
});
test('S–T keyboard-only heart/navigation/removal and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await harness(page); await page.goto('/products');
  const heart = page.getByRole('button', { name: `Add ${first.name} to wishlist` }); await expect(heart).toBeVisible();
  await tabTo(page, heart); await page.keyboard.press('Space'); await expect(heart).toHaveCount(0);
  const link = page.getByRole('link', { name: 'Wishlist (1)', exact: true }); await tabTo(page, link); await page.keyboard.press('Enter');
  const remove = page.getByRole('button', { name: `Remove ${first.name} from wishlist` }); await tabTo(page, remove);
  expect(await remove.evaluate(element => Math.max(...getComputedStyle(element).transitionDuration.split(',').map(value => Number.parseFloat(value))))).toBeLessThanOrEqual(0.001);
  await page.keyboard.press('Enter'); await expect(page.getByRole('link', { name: 'Explore Products' })).toBeFocused();
});

for (const mode of ['guest', 'authenticated'] as const) {
  for (const scenario of ['zero-add', 'add', 'remove', 'cap'] as const) {
    test(`guest/auth parity ${mode} ${scenario} first refresh frame`, async ({ page }) => {
      const initial = scenario === 'zero-add' ? [] : scenario === 'add' ? [first.id, second.id] : scenario === 'remove'
        ? [first.id, second.id, third.id] : Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
      const finalCount = scenario === 'zero-add' ? 1 : scenario === 'add' ? 3 : scenario === 'remove' ? 2 : 12;
      const state = await harness(page, { signedIn: mode === 'authenticated', serverIds: initial });
      await page.addInitScript(({ mode, initial, user }) => {
        if (mode === 'authenticated') sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user));
        else if (!sessionStorage.getItem('wishlist-test:parity-seeded')) {
          localStorage.setItem('electrohub.wishlist.v1', JSON.stringify({ productIds: initial }));
          sessionStorage.setItem('wishlist-test:parity-seeded', 'true');
        }
      }, { mode, initial, user });
      await page.goto('/products');
      if (mode === 'authenticated') await expect.poll(() => storedAuthenticatedCount(page)).toBe(initial.length);
      if (scenario !== 'cap') {
        const target = scenario === 'zero-add' ? first : third;
        await page.getByRole('button', { name: `${scenario === 'remove' ? 'Remove' : 'Add'} ${target.name} ${scenario === 'remove' ? 'from' : 'to'} wishlist`, exact: true }).click();
      }
      await expect.poll(() => mode === 'authenticated' ? storedAuthenticatedCount(page) : page.evaluate(() => JSON.parse(localStorage.getItem('electrohub.wishlist.v1') ?? '{"productIds":[]}').productIds.length)).toBe(finalCount);
      await page.goto('/wishlist');
      await expect(page.getByRole('status', { name: `${finalCount} ${finalCount === 1 ? 'item' : 'items'}`, exact: true })).toBeVisible();
      state.holdWishlist();
      await observeFirstRefreshFrame(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expectFirstRefreshFrame(page, Math.min(finalCount, 10));
      await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toHaveCount(0);
      state.releaseWishlist();
      await expect(page.getByRole('status', { name: `${finalCount} ${finalCount === 1 ? 'item' : 'items'}`, exact: true })).toBeVisible();
      await expect(page.locator('header').getByRole('link', { name: `Wishlist (${finalCount})`, exact: true })).toBeVisible();
      await expect(page.getByTestId('product-skeleton')).toHaveCount(0);
      if (scenario !== 'cap') await expect(page.getByTestId('product-card')).toHaveCount(finalCount);
    });
  }
}

test('early auth bootstrap shares refresh and holds commerce data until ownership verification', async ({ page }) => {
  const state = await harness(page, { signedIn: true, serverIds: [first.id], cartQuantity: 2, delayWishlist: true, delayUserVerification: true });
  await page.addInitScript(cachedUser => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(cachedUser));
    sessionStorage.setItem(`electrohub.wishlist.auth-count.v1:${cachedUser.id}`, '1');
  }, user);
  const refreshes: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/refresh') refreshes.push(request.url()); });
  await page.goto('/wishlist', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => state.wishlistReads()).toBe(1);
  await expect.poll(() => state.cartReads()).toBe(1);
  await expect(page.getByTestId('product-skeleton')).toHaveCount(1);
  state.releaseWishlist();
  await expect(page.getByTestId('product-card')).toHaveCount(0);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist (1)', exact: true })).toHaveCount(0);
  state.releaseUserVerification();
  await expect(page.getByTestId('product-card')).toHaveCount(1);
  await expect(page.locator('header').getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: 'Cart, 2 items', exact: true })).toBeVisible();
  expect(refreshes).toHaveLength(1);
  expect(state.wishlistReads()).toBe(1);
  expect(state.cartReads()).toBe(1);
});
