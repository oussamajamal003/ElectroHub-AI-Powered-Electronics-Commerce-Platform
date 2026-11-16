import { expect, test } from '@playwright/test';
import { harness } from './stripe.harness';
import { cart } from '../../src/features/checkout/fixtures';
import { wishlistProduct } from '../../src/features/wishlist/fixtures';
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('cart-state', { body: await page.locator('body').innerText(), contentType: 'text/plain' });
    await page.screenshot({ path: testInfo.outputPath('cart-failure.png'), fullPage: true });
  }
});

for (const entry of ['/', `/products/${wishlistProduct.slug}`]) test(`badges hydrate globally on direct ${entry} refresh`, async ({ page }) => {
  await harness(page);
  let carts = 0; let wishes = 0;
  await page.route('**/api/cart', route => { carts++; return route.fulfill({ json: { data: cart } }); });
  await page.route('**/api/wishlist', route => {
    wishes++; return route.fulfill({ json: { data: { items: [{ productId: wishlistProduct.id, product: wishlistProduct, availability: 'AVAILABLE' }], totalItems: 1 } } });
  });
  await page.route(`**/api/products/${wishlistProduct.slug}`, route => route.fulfill({ json: { data: {
    ...wishlistProduct, sku: 'OFFLINE-ONLY', modelNumber: null, specifications: [], images: [wishlistProduct.primaryImage],
    purchasable: true, availableQuantity: 10, stockStatus: 'IN_STOCK',
  } } }));
  await page.goto(entry);
  const cartName = `Cart, ${cart.totalQuantity} ${cart.totalQuantity === 1 ? 'item' : 'items'}`;
  await expect(page.getByRole('link', { name: cartName })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: cartName })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Wishlist (1)', exact: true })).toBeVisible();
  await expect.poll(() => carts).toBe(2); await expect.poll(() => wishes).toBe(2);
});

test('private collections initialize together before and after direct Wishlist refresh', async ({ page }) => {
  await harness(page);
  let carts = 0; let wishes = 0;
  await page.route('**/api/cart', route => { carts++; return route.fulfill({ json: { data: cart } }); });
  await page.route('**/api/wishlist', route => {
    wishes++;
    return route.fulfill({ json: { data: { items: [{ productId: wishlistProduct.id, product: wishlistProduct, availability: 'AVAILABLE' }], totalItems: 1 } } });
  });
  await page.goto('/wishlist');
  await expect(page.getByText(wishlistProduct.name, { exact: true })).toBeVisible();
  await expect.poll(() => carts).toBe(1);
  await expect.poll(() => wishes).toBe(1);
  await page.reload();
  await expect(page.getByText(wishlistProduct.name, { exact: true })).toBeVisible();
  await expect.poll(() => carts).toBe(2);
  await expect.poll(() => wishes).toBe(2);
  await page.screenshot({ path: 'test-results/checkout/cart-run/wishlist-refresh.png', fullPage: true });
});

test('unverified authentication holds private reads and never displays a false empty Cart', async ({ page }) => {
  const fixture = await harness(page);
  let release!: () => void;
  const verified = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/me', async route => {
    await verified;
    return route.fulfill({ json: { user: { id: '11111111-1111-4111-8111-111111111111', email: 'checkout-demo@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' } } });
  });
  await page.goto('/cart');
  await expect(page.getByRole('status', { name: 'Loading cart' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cart, loading items' })).toHaveAttribute('aria-busy', 'true');
  await page.screenshot({ path: 'test-results/cart-reliability/auth-cart-skeleton.png', fullPage: true });
  await expect(page.getByText(/Your cart is empty/i)).toHaveCount(0);
  expect(fixture.requests.filter(request => request.path === '/api/cart' || request.path === '/api/wishlist')).toHaveLength(0);
  release();
  await expect(page.getByText(cart.items[0]!.product!.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
});

for (const entry of ['Product Card', 'Product Details']) test(`Add from ${entry} survives immediate Cart navigation without an extra read`, async ({ page }) => {
  await harness(page);
  const empty = { ...cart, items: [], totalQuantity: 0, subtotal: '0.00', total: '0.00', canCheckout: false };
  const unitPrice = cart.items[0]!.product!.price;
  const added = { ...cart, items: [{ ...cart.items[0]!, productId: wishlistProduct.id, quantity: 1, lineTotal: unitPrice }],
    totalQuantity: 1, subtotal: unitPrice, total: unitPrice, shipping: '0.00' };
  let current = empty; let reads = 0; let additions = 0; let release!: () => void;
  const committed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/cart', route => { reads++; return route.fulfill({ json: { data: current } }); });
  await page.route('**/api/wishlist', route => route.fulfill({ json: { data: { items: [{ productId: wishlistProduct.id, product: { ...wishlistProduct, purchasable: true, availableQuantity: 10, stockStatus: 'IN_STOCK' }, availability: 'AVAILABLE' }], totalItems: 1 } } }));
  await page.route(`**/api/products/${wishlistProduct.slug}`, route => route.fulfill({ json: { data: {
    ...wishlistProduct, sku: 'OFFLINE-ONLY', modelNumber: null, specifications: [],
    images: [wishlistProduct.primaryImage], purchasable: true, availableQuantity: 10, stockStatus: 'IN_STOCK',
  } } }));
  await page.route('**/api/cart/items', async route => {
    expect(route.request().postDataJSON()).toEqual({ productId: wishlistProduct.id, quantity: 1 });
    additions++; await committed; current = added;
    return route.fulfill({ json: { data: added } });
  });
  await page.goto(entry === 'Product Card' ? '/wishlist' : `/products/${wishlistProduct.slug}`);
  const button = page.getByRole('button', { name: entry === 'Product Card' ? `Add ${wishlistProduct.name} to cart` : 'Add to Cart' });
  await button.evaluate(element => {
    const timing = { click: 0, pending: 0 };
    Reflect.set(window, '__cartFeedbackTiming', timing);
    element.addEventListener('click', () => { timing.click = performance.now(); }, { once: true });
    const observer = new MutationObserver(() => {
      if (timing.click && element instanceof HTMLButtonElement && element.disabled) {
        timing.pending = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(element, { attributes: true, childList: true, subtree: true });
  });
  await button.click();
  if (entry === 'Product Card') await expect(button).toHaveText('Adding…');
  else await expect(button).toHaveClass(/loading/);
  const feedbackMs = await page.evaluate(() => {
    const timing = Reflect.get(window, '__cartFeedbackTiming') as { click: number; pending: number };
    if (!timing.click || !timing.pending) throw new Error('Add-to-Cart feedback timestamps were not observed');
    return timing.pending - timing.click;
  });
  expect(feedbackMs).toBeGreaterThanOrEqual(0);
  console.log(`Add-to-Cart click-event → pending UI (${entry}): ${feedbackMs.toFixed(1)}ms; API response is intentionally held/mocked.`);
  await expect(button).toBeDisabled();
  await page.getByRole('link', { name: /^Cart,/ }).click();
  await expect(page.getByRole('status', { name: 'Loading cart' })).toBeVisible();
  release();
  await expect(page.getByText(cart.items[0]!.product!.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await expect(page.getByText('Subtotal (1 item)', { exact: true })).toBeVisible();
  expect(additions).toBe(1); expect(reads).toBe(1);
});

test('direct Cart refresh revalidates once without a false availability banner', async ({ page }) => {
  await harness(page);
  let reads = 0;
  await page.route('**/api/cart', route => {
    reads++;
    return route.fulfill({ json: { data: cart } });
  });

  await page.goto('/cart');
  await expect(page.getByText(cart.items[0]!.product!.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await expect(page.getByText(/Current availability could not be confirmed/i)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(cart.items[0]!.product!.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await expect(page.getByText(/Current availability could not be confirmed/i)).toHaveCount(0);
  expect(reads).toBe(2);
});

test('Cart route re-entry automatically replaces a settled availability error with fresh validation', async ({ page }) => {
  await harness(page);
  let fail = false; let reads = 0;
  await page.route('**/api/cart', route => {
    reads++;
    return fail ? route.fulfill({ status: 409, json: { error: { code: 'CART_UNAVAILABLE', message: 'Availability unavailable.' } } }) : route.fulfill({ json: { data: cart } });
  });
  await page.goto('/cart');
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await page.getByRole('link', { name: 'Continue shopping', exact: true }).click();
  await expect(page).toHaveURL(/\/products$/);
  fail = true;
  await page.getByRole('link', { name: /^Cart,/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByText('Current availability could not be confirmed. Your cart is still visible.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
  await page.getByRole('link', { name: 'Continue shopping', exact: true }).click();
  fail = false;
  await page.getByRole('link', { name: /^Cart,/ }).click();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeEnabled();
  await expect(page.getByText('Current availability could not be confirmed. Your cart is still visible.')).toHaveCount(0);
  expect(reads).toBe(3);
});
