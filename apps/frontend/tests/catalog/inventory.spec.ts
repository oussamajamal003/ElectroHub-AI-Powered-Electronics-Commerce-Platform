import { expect, test, type Page } from '@playwright/test';
import { wishlistProduct } from '../../src/features/wishlist/fixtures';

const productId = wishlistProduct.id;
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error(`Inventory browser runtime: ${error.message}`));
  page.on('response', response => { if (!response.url().includes('/api/') && response.status() >= 400) console.error(`Inventory asset failure: ${response.status()} ${response.url()}`); });
});
async function inventoryHarness(page: Page, initial = 6, cartQuantity = 0) {
  let stock = initial;
  let stockKnown = true;
  let quantity = cartQuantity;
  const requests: string[] = [];
  const summary = () => ({ ...wishlistProduct, ...(stockKnown ? { stockStatus: stock === 0 ? 'OUT_OF_STOCK' : stock <= 5 ? 'LOW_STOCK' : 'IN_STOCK' } : {}),
    availableQuantity: stockKnown ? stock : undefined, purchasable: stockKnown && stock > 0, availability: stockKnown && stock > 0 ? 'AVAILABLE' : 'UNAVAILABLE' });
  if (quantity) await page.addInitScript(({ productId, quantity }) => { if (!localStorage.getItem('electrohub.cart.v1')) localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity }] })); }, { productId, quantity });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push(url.pathname);
    const send = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname.startsWith('/api/auth/')) return send({ error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } }, 401);
    if (url.pathname === '/api/wishlist/validate') return send({ data: { items: (route.request().postDataJSON().productIds as string[]).map(productId => ({ productId, product: summary(), availability: stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK' })), totalItems: route.request().postDataJSON().productIds.length } });
    if (url.pathname === '/api/cart/validate') {
      const input = route.request().postDataJSON().items as { productId: string; quantity: number }[];
      quantity = input[0]?.quantity ?? 0;
      const items = input.map(item => ({ ...item, id: null, stockStatus: summary().stockStatus, availableQuantity: stock,
        availability: stock === 0 ? 'OUT_OF_STOCK' : item.quantity > stock ? 'LOW_STOCK' : 'AVAILABLE',
        product: { slug: wishlistProduct.slug, name: wishlistProduct.name, category: 'Phones', price: wishlistProduct.price, image: wishlistProduct.primaryImage },
        lineTotal: (Number(wishlistProduct.price) * item.quantity).toFixed(2) }));
      const totalQuantity = input.reduce((sum, item) => sum + item.quantity, 0);
      return send({ data: { items, totalQuantity, subtotal: (Number(wishlistProduct.price) * totalQuantity).toFixed(2), total: (Number(wishlistProduct.price) * totalQuantity).toFixed(2), shipping: '0.00', currency: 'USD', canCheckout: items.length > 0 && items.every(item => item.availability === 'AVAILABLE') } });
    }
    if (url.pathname.endsWith('/reviews')) return send({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
    if (url.pathname === `/api/products/${wishlistProduct.slug}`) return send({ data: { ...summary(), sku: 'TEST', modelNumber: null, images: [wishlistProduct.primaryImage, { ...wishlistProduct.primaryImage, id: 'alternate', url: '/images/catalog/variety/apple-phone-generic-02.jpg', altText: 'Alternate phone view', isPrimary: false }], specifications: [] } });
    if (url.pathname === '/api/search/products' || url.pathname === '/api/products' || url.pathname === '/api/products/deals') return send({ data: [summary()], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    return send({ data: [], meta: { page: 1, pageSize: 100, total: 0 } });
  });
  return { setStock: (value: number) => { stock = value; }, setStockKnown: (value: boolean) => { stockKnown = value; }, stock: () => stock, quantity: () => quantity, requests };
}

test('A–F, K, U, V: stock states stay coherent and OOS navigation/heart remain usable (intercepted API)', async ({ page }) => {
  const api = await inventoryHarness(page);
  for (const [stock, label] of [[6, 'In Stock'], [5, 'Low Stock'], [0, 'Out of Stock']] as const) {
    api.setStock(stock);
    const ready = page.waitForResponse(response => new URL(response.url()).pathname === '/api/search/products');
    await page.goto('/products');
    await ready;
    const card = page.getByTestId('product-card').first();
    await expect(card.getByText(label, { exact: true })).toBeVisible();
    expect(await card.getByRole('button', { name: /to cart/ }).isDisabled()).toBe(stock === 0);
    if (stock === 0) await card.getByRole('button', { name: /to wishlist/ }).click();
    await card.getByRole('link', { name: wishlistProduct.name }).click();
    await expect(page.getByRole('heading', { name: wishlistProduct.name, exact: true })).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    expect(await page.getByRole('button', { name: 'Add to Cart', exact: true }).isDisabled()).toBe(stock === 0);
    await expect(page.getByTestId('product-gallery').getByRole('tabpanel').locator('img')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `test-results/inventory-details-stock-${stock}.png`, fullPage: true });
  }
  await page.goto('/wishlist');
  await expect(page.getByTestId('product-card')).toHaveCount(1);
  await expect(page.getByText('Out of Stock', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove .* from wishlist/ })).toBeEnabled();
  await page.screenshot({ path: 'test-results/inventory-wishlist-out-of-stock.png', fullPage: true });
  await page.getByRole('button', { name: /Remove .* from wishlist/ }).click();
  await expect(page.getByText('Your wishlist is empty')).toBeVisible();
  expect(api.requests.filter(path => path.includes('/inventory'))).toEqual([]);
});

test('G–J, L: exact stock, tampered guest quantity and stock shrink preserve invalid rows (intercepted API)', async ({ page }) => {
  const api = await inventoryHarness(page, 3, 2);
  await page.goto('/cart');
  await page.getByRole('button', { name: /Increase quantity/ }).click();
  await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('3');
  await expect(page.getByRole('button', { name: /Increase quantity/ })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('electrohub.cart.v1') ?? '{}').items?.[0]?.quantity)).toBe(3);
  await page.evaluate(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 5 }] })), productId);
  await page.reload();
  await expect(page.getByText('Only 3 left. Reduce quantity to continue.')).toBeVisible();
  await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('5');
  await page.screenshot({ path: 'test-results/inventory-cart-insufficient.png', fullPage: true });
  await page.getByRole('button', { name: /Decrease quantity/ }).click();
  await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('3');
  await page.evaluate(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 99 }] })), productId);
  await page.reload();
  await expect(page.getByText('Only 3 left. Reduce quantity to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Decrease quantity/ })).toBeEnabled();
  api.setStock(0);
  await page.evaluate(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 3 }] })), productId);
  await page.reload();
  await expect(page.getByText('Out of stock. Reduce quantity or remove this item to continue.')).toBeVisible();
  await expect(page.getByTestId('cart-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Increase quantity/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Decrease quantity/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/inventory-cart-out-of-stock.png', fullPage: true });
  await page.getByRole('button', { name: /Decrease quantity/ }).click();
  await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('2');
  await expect(page.getByRole('button', { name: /Increase quantity/ })).toBeDisabled();
  await page.getByRole('button', { name: /Remove .* from cart/ }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
});

test('O: unavailable Products remain recoverable without an Out of Stock claim (intercepted API)', async ({ page }) => {
  const api = await inventoryHarness(page, 0, 5);
  api.setStockKnown(false);
  await page.goto('/products');
  const card = page.getByTestId('product-card').first();
  await expect(card.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  await expect(card.getByText('Out of Stock', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: /to cart/ })).toBeDisabled();
  await page.goto(`/products/${wishlistProduct.slug}`);
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Out of Stock', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to Cart', exact: true })).toBeDisabled();
  await page.route('**/api/cart/validate', route => route.fulfill({ json: { data: { items: [{ id: null, productId, quantity: 5, product: null, stockStatus: null, availableQuantity: 0, availability: 'UNAVAILABLE', lineTotal: null }], totalQuantity: 5, subtotal: '0.00', total: '0.00', shipping: '0.00', currency: 'USD', canCheckout: false } } }));
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item')).toHaveCount(1);
  await expect(page.getByTestId('cart-item').getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Out of Stock', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Remove .* from cart/ })).toBeEnabled();
  await page.route(`**/api/products/${wishlistProduct.slug}`, route => route.fulfill({ status: 404, json: { error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } } }));
  await page.goto(`/products/${wishlistProduct.slug}`);
  await expect(page.getByRole('heading', { name: 'Product unavailable' })).toBeVisible();
});

test('R–T: responsive stock controls, keyboard and reduced motion (intercepted API)', async ({ page }) => {
  await inventoryHarness(page, 2);
  for (const width of [390, 768, 1440, 1920]) {
    await page.goto('/products');
    await page.evaluate(() => localStorage.removeItem('electrohub.cart.v1'));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/products');
    const card = page.getByTestId('product-card').first();
    await expect(card.getByText('Low Stock')).toBeVisible();
    await expect(card.getByRole('button', { name: /to cart/ })).toBeVisible();
    const heart = card.getByRole('button', { name: /wishlist/ });
    await expect(heart).toBeVisible();
    if (await heart.getAttribute('aria-pressed') !== 'true') { await heart.focus(); await page.keyboard.press('Space'); }
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `test-results/inventory-products-${width}.png`, fullPage: true });
    await card.getByRole('link', { name: wishlistProduct.name }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: wishlistProduct.name, exact: true })).toBeVisible();
    const increase = page.getByRole('button', { name: /Increase quantity/ });
    await increase.focus();
    await page.keyboard.press('Enter');
    await expect(increase).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add to Cart', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/inventory-details-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Add to Cart', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`${wishlistProduct.name} added to cart.`)).toBeVisible();
    await page.goto('/cart');
    await expect(page.getByTestId('cart-item')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove .* from cart/ })).toBeVisible();
    await page.getByRole('button', { name: /Decrease quantity/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('1');
    await page.getByRole('button', { name: /Increase quantity/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('2');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/inventory-cart-${width}.png`, fullPage: true });
    await page.goto('/wishlist');
    await expect(page.getByRole('heading', { name: 'Wishlist', exact: true })).toBeVisible();
    await expect(page.getByTestId('product-card')).toHaveCount(1);
    await expect(page.getByTestId('product-card').getByText('Low Stock')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/inventory-wishlist-${width}.png`, fullPage: true });
  }
});

test('M: authenticated stock-conflict response rolls back quantity and shows sanitized feedback (intercepted API)', async ({ page }) => {
  await inventoryHarness(page, 3);
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'inventory@example.invalid', firstName: 'Inventory', lastName: 'Customer', role: 'CUSTOMER' };
  await page.addInitScript(user => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)), user);
  await page.route('**/api/auth/refresh', route => route.fulfill({ json: { accessToken: 'intercepted-inventory-test-token' } }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
  await page.route('**/api/wishlist', route => route.fulfill({ json: { data: { items: [], totalItems: 0 } } }));
  await page.route('**/api/cart', route => route.fulfill({ json: { data: { items: [{ id: 'line-1', productId, quantity: 2, stockStatus: 'LOW_STOCK', availableQuantity: 3, availability: 'AVAILABLE',
    product: { slug: wishlistProduct.slug, name: wishlistProduct.name, category: 'Phones', price: '19.99', image: wishlistProduct.primaryImage }, lineTotal: '39.98' }],
    totalQuantity: 2, subtotal: '39.98', total: '39.98', shipping: '0.00', currency: 'USD', canCheckout: true } } }));
  await page.route(`**/api/cart/items/${productId}`, route => route.fulfill({ status: 409, json: { error: { code: 'CART_STOCK_CONFLICT', message: 'Only 2 items are currently available.' } } }));
  await page.goto('/cart');
  await page.getByRole('button', { name: /Increase quantity/ }).click();
  await expect(page.getByRole('alert')).toHaveText('Only 2 items are currently available.');
  await expect(page.getByTestId('cart-item').locator('[aria-live="polite"]')).toHaveText('2');
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Decrease quantity/ })).toBeEnabled();
});

test('D–F: stock transitions 1 to 0 to 1 update purchase controls on refresh (intercepted API)', async ({ page }) => {
  const api = await inventoryHarness(page, 1);
  for (const stock of [1, 0, 1]) {
    api.setStock(stock);
    await page.goto(`/products/${wishlistProduct.slug}`);
    await expect(page.getByRole('heading', { name: wishlistProduct.name, exact: true })).toBeVisible();
    await expect(page.getByText(stock ? 'Low Stock' : 'Out of Stock', { exact: true })).toBeVisible();
    expect(await page.getByRole('button', { name: 'Add to Cart', exact: true }).isDisabled()).toBe(stock === 0);
    await expect(page.getByRole('button', { name: /Increase quantity/ })).toBeDisabled();
  }
});

test('N: slow background stock refresh preserves content and selected gallery image (intercepted API)', async ({ page }) => {
  await page.clock.install();
  const api = await inventoryHarness(page, 6);
  await page.goto(`/products/${wishlistProduct.slug}`);
  await expect(page.getByRole('heading', { name: wishlistProduct.name, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'View Alternate phone view' }).click();
  const increase = page.getByRole('button', { name: /Increase quantity/ });
  for (let index = 0; index < 4; index++) await increase.click();
  api.setStock(3);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route(`**/api/products/${wishlistProduct.slug}`, async route => { started(); await pending; await route.fallback(); });
  await page.clock.fastForward(61_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await requested;
  await expect(page.getByRole('heading', { name: wishlistProduct.name, exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading product details' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'View Alternate phone view' })).toHaveAttribute('aria-selected', 'true');
  release();
  await expect(page.getByText('Only 3 left')).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: /^1$/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'View Alternate phone view' })).toHaveAttribute('aria-selected', 'true');
});

test('P–Q: Cart and Wishlist intents leave stock presentation unchanged and issue no stock writes (intercepted API)', async ({ page }) => {
  const api = await inventoryHarness(page, 3);
  await page.goto('/products');
  const card = page.getByTestId('product-card');
  await card.getByRole('button', { name: /to cart/ }).click();
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await page.goto('/cart');
  await page.getByRole('button', { name: /Increase quantity/ }).click();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await page.getByRole('button', { name: /Remove .* from cart/ }).click();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
  await page.goto(`/products/${wishlistProduct.slug}`);
  const heart = page.getByRole('button', { name: /to wishlist/ });
  await heart.click();
  await page.getByRole('button', { name: /from wishlist/ }).click();
  await expect(page.getByText('Only 3 left')).toBeVisible();
  expect(api.requests.filter(path => path.includes('/inventory'))).toEqual([]);
  expect(api.stock()).toBe(3);
});
