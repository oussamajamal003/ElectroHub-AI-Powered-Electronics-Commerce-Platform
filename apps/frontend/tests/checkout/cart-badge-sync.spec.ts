import { expect, test, type Page } from '@playwright/test';

// INTERCEPTED APIs (real Chromium, real app). Proves badge/Cart synchronization only, not backend latency.
const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const image = { id: 'image-1', url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: 'iPhone', sortOrder: 0, isPrimary: true };
const product = { id: productId, name: 'Apple iPhone 15 Pro', slug: 'apple-iphone-15-pro', description: 'A current smartphone.', price: '1099.99',
  compareAtPrice: null, discountPercent: null, averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE', stockStatus: 'IN_STOCK',
  availableQuantity: 10, purchasable: true, category: { id: 'category-1', name: 'Phones', slug: 'phones' }, brand: { id: 'brand-1', name: 'Apple', slug: 'apple' },
  primaryImage: image, secondaryImage: null, sku: 'IP15P', images: [image], specifications: [] };
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'badge@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
const cart = (quantity: number) => {
  const total = (109999 * quantity / 100).toFixed(2);
  return { items: quantity ? [{ id: 'line-1', productId, quantity, product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image },
    availableQuantity: 10, availability: 'AVAILABLE', lineTotal: total }] : [], revision: 'r'.repeat(63) + quantity,
    totalQuantity: quantity, subtotal: total, shipping: '0.00', total, currency: 'USD', canCheckout: quantity > 0 };
};
const badge = (page: Page) => page.getByRole('link', { name: /^Cart, \d+ items?$/ });

async function world(page: Page) {
  let confirmed = 0; const gates: (() => void)[] = []; let mode: 'ok' | 'fail' = 'ok'; let posts = 0; const postBodies: unknown[] = [];
  // Records the highest badge value ever rendered, so a transient premature count cannot slip past the assertions.
  await page.addInitScript(() => {
    const seen: number[] = []; Reflect.set(window, '__badgeSeen', seen);
    new MutationObserver(() => { for (const link of document.querySelectorAll('a[aria-label^="Cart, "]')) {
      const value = Number(/Cart, (\d+)/.exec(link.getAttribute('aria-label') ?? '')?.[1] ?? NaN); if (!Number.isNaN(value)) seen.push(value); } })
      .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  });
  await page.addInitScript(value => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)), user);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname; const method = route.request().method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/auth/refresh') return json({ accessToken: 'intercepted', user });
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/cart' && method === 'GET') return json({ data: cart(confirmed) });
    if (path === '/api/cart/items' && method === 'POST') {
      posts++; const body = route.request().postDataJSON() as { quantity: number }; postBodies.push(body);
      await new Promise<void>(release => gates.push(release));
      if (mode === 'fail') return json({ error: { code: 'CART_UNAVAILABLE', message: 'Cart could not be updated.' } }, 503);
      confirmed += body.quantity; return json({ data: cart(confirmed) }, 201);
    }
    if (path === '/api/wishlist') return json({ data: { items: [], totalItems: 0 } });
    if (path === '/api/checkout/payment-attempts') return json({ data: [] });
    if (path.startsWith('/api/search/products') || path === '/api/products') return json({ data: [product], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    if (path === `/api/products/${product.slug}`) return json({ data: product });
    if (path.endsWith('/reviews')) return json({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });
  return { release: () => gates.shift()?.(), held: () => gates.length, fail: () => { mode = 'fail'; }, ok: () => { mode = 'ok'; },
    posts: () => posts, bodies: () => postBodies, maxBadge: () => page.evaluate(() => Math.max(0, ...(Reflect.get(window, '__badgeSeen') as number[]))) };
}

for (const width of [390, 1366]) {
  for (const surface of ['Products', 'Product Details'] as const) {
    test(`${surface} at ${width}px: badge waits for the confirmed Cart, survives failure, rapid clicks and refetch`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const flow = await world(page);
      await page.goto(surface === 'Products' ? '/products' : `/products/${product.slug}`);
      const add = surface === 'Products' ? page.getByRole('button', { name: 'Add Apple iPhone 15 Pro to cart' }) : page.getByRole('button', { name: 'Add to Cart', exact: true });
      await expect(add).toBeVisible({ timeout: 20_000 });
      await expect(badge(page)).toHaveAttribute('aria-label', 'Cart, 0 items');

      // Slow success: the button is pending, the badge stays on the confirmed count until the server answers.
      await add.click();
      await expect.poll(flow.held).toBe(1);
      await expect(add).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // concurrent Cart refetch while the add is held
      await page.waitForTimeout(400);
      await expect(badge(page)).toHaveAttribute('aria-label', 'Cart, 0 items');
      expect(await flow.maxBadge()).toBe(0);
      await page.screenshot({ path: `screenshots/cart-badge/${surface === 'Products' ? 'products' : 'pdp'}-pending-${width}.png` });
      flow.release();
      await expect(badge(page)).toHaveAttribute('aria-label', 'Cart, 1 item');
      await expect(add).toBeEnabled();

      // Failure: previous count is kept and never transiently raised.
      flow.fail(); await add.click(); await expect.poll(flow.held).toBe(1);
      await expect(badge(page)).toHaveAttribute('aria-label', 'Cart, 1 item');
      flow.release();
      await expect(add).toBeEnabled();
      await page.waitForTimeout(300);
      await expect(badge(page)).toHaveAttribute('aria-label', 'Cart, 1 item');
      expect(await flow.maxBadge()).toBe(1);

      // Rapid clicks: a single request, and no count above what the server confirmed.
      flow.ok(); const before = flow.posts();
      await add.click(); await add.click({ force: true }).catch(() => undefined); await add.click({ force: true }).catch(() => undefined);
      await expect.poll(flow.held).toBe(1);
      expect(flow.posts() - before).toBe(1);
      await expect(badge(page)).toHaveAttribute('aria-label', 'Cart, 1 item');
      flow.release();
      const confirmed = 1 + (flow.bodies().at(-1) as { quantity: number }).quantity;
      await expect(badge(page)).toHaveAttribute('aria-label', `Cart, ${confirmed} items`);
      expect(await flow.maxBadge()).toBe(confirmed);

      // The Cart page renders the same confirmed state as the badge.
      await badge(page).click();
      await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
      await expect(page.getByText(product.name).first()).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText(`Subtotal (${confirmed} items)`);
      await expect(page.getByRole('complementary', { name: 'Order Summary' })).toContainText((109999 * confirmed / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
      expect(await flow.maxBadge()).toBe(confirmed);
      await page.screenshot({ path: `screenshots/cart-badge/${surface === 'Products' ? 'products' : 'pdp'}-cart-${width}.png`, fullPage: true });
    });
  }
}
