import { expect, test } from '@playwright/test';
import { cartLink, customerApi, distinctClientAddress, expectNoHorizontalOverflow, fixtures, money, pressInView, product, rememberRejectedCookieChoice,
  resetCustomerState, shopper, signInCustomer } from './support';

/**
 * Cart and wishlist journeys on the real stack. Each project uses its own shopper, whose cart and wishlist are emptied before every test.
 * Totals and counts are compared with the server's own cart/wishlist responses, not only with what the UI shows.
 */
const headphones = () => product('REL-AURORA-HP');
const dock = () => product('REL-ATLAS-DOCK');
const earbuds = () => product('REL-PULSE-EB');

test.describe.configure({ mode: 'serial' });

test.describe('cart', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await distinctClientAddress(page, testInfo);
    await resetCustomerState(shopper(testInfo, 'cart').email);
  });

  test('@responsive add, change quantity, remove and empty the cart with server-consistent totals that persist across reloads', async ({ page }, testInfo) => {
    await rememberRejectedCookieChoice(page);
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await page.goto(`/products/${headphones().slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 1)).toBeVisible();
    await page.goto(`/products/${dock().slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 2)).toBeVisible();

    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Shopping Cart', level: 1 })).toBeVisible();
    await pressInView(page.getByRole('button', { name: `Increase quantity for ${dock().name}` }));
    await expect(cartLink(page, 3)).toBeVisible();
    const summary = page.getByRole('complementary', { name: 'Order Summary' });
    const expectedSubtotal = headphones().price + dock().price * 2;
    await expect(summary).toContainText(money(expectedSubtotal));

    // The server holds exactly what the UI shows.
    const api = await customerApi(shopper(testInfo, 'cart').email);
    const server = await (await api.get('/api/cart')).json() as { data: { items: { productId: string; quantity: number }[] } };
    expect(server.data.items.map(item => [item.productId, item.quantity]).sort()).toEqual([[dock().id, 2], [headphones().id, 1]].sort());

    await page.reload();
    await expect(cartLink(page, 3)).toBeVisible();
    await expect(summary).toContainText(money(expectedSubtotal));
    await expectNoHorizontalOverflow(page, 'cart');

    await pressInView(page.getByRole('button', { name: `Decrease quantity for ${dock().name}` }));
    await expect(cartLink(page, 2)).toBeVisible();
    await pressInView(page.getByRole('button', { name: `Remove ${dock().name} from cart` }));
    await expect(cartLink(page, 1)).toBeVisible();
    await pressInView(page.getByRole('button', { name: `Remove ${headphones().name} from cart` }));
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect.poll(async () => ((await (await api.get('/api/cart')).json()) as { data: { items: unknown[] } }).data.items.length).toBe(0);
    await api.dispose();
  });

  test('rapid repeated increases reconcile to the stock limit without overshooting', async ({ page }, testInfo) => {
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await page.goto(`/products/${earbuds().slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 1)).toBeVisible();
    await page.goto('/cart');
    const increase = page.getByRole('button', { name: `Increase quantity for ${earbuds().name}` });
    for (let click = 0; click < 4; click++) await increase.click({ force: true }).catch(() => undefined);
    await expect(cartLink(page, earbuds().quantity)).toBeVisible();
    await expect(increase).toBeDisabled();
    const api = await customerApi(shopper(testInfo, 'cart').email);
    await expect.poll(async () => ((await (await api.get('/api/cart')).json()) as { data: { items: { quantity: number }[] } }).data.items[0]?.quantity)
      .toBe(earbuds().quantity);
    await api.dispose();
  });

  test('a guest cart is merged into the account on sign-in', async ({ page }, testInfo) => {
    await page.goto(`/products/${dock().slug}`);
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 1)).toBeVisible();
    await page.goto('/cart');
    await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeVisible();
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await expect(cartLink(page, 1)).toBeVisible();
    const api = await customerApi(shopper(testInfo, 'cart').email);
    await expect.poll(async () => ((await (await api.get('/api/cart')).json()) as { data: { items: { productId: string }[] } }).data.items.map(item => item.productId))
      .toEqual([dock().id]);
    await api.dispose();
  });

  test('product cards wait for the post-reload session check instead of failing a quick Add to Cart (R-1)', async ({ page }, testInfo) => {
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await page.goto(`/search?q=${encodeURIComponent(dock().name)}`);
    // Hold the session refresh that follows a full page load, so the check is observably in flight.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/auth/customer/refresh', async route => { await held; await route.continue(); });
    await page.reload();
    const card = page.getByTestId('product-card').filter({ hasText: dock().name }).first();
    const add = card.getByRole('button', { name: `Add ${dock().name} to cart` });
    await expect(add).toBeDisabled();
    await expect(card.getByRole('button', { name: `Add ${dock().name} to wishlist` })).toBeDisabled();
    release();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(cartLink(page, 1)).toBeVisible();
    await expect(card.getByText('Could not add item. Please try again.')).toHaveCount(0);
    const api = await customerApi(shopper(testInfo, 'cart').email);
    await expect.poll(async () => ((await (await api.get('/api/cart')).json()) as { data: { items: { productId: string }[] } }).data.items.map(item => item.productId))
      .toEqual([dock().id]);
    await api.dispose();
    await page.unroute('**/api/auth/customer/refresh');
  });

  test('a failed cart mutation rolls back the optimistic count and reports the error', async ({ page }, testInfo) => {
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await page.goto(`/products/${headphones().slug}`);
    await expect(cartLink(page, 0)).toBeVisible();
    await page.route('**/api/cart/items', route => route.request().method() === 'POST'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"Temporarily unavailable"}}' })
      : route.continue());
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    // The product page reports the failure inline beside the purchase button (not as a toast) and the optimistic count is rolled back.
    await expect(page.getByRole('status').filter({ hasText: 'Could not add this product. Check availability and try again.' })).toBeVisible();
    await expect(cartLink(page, 0)).toBeVisible();
    await page.unroute('**/api/cart/items');
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(cartLink(page, 1)).toBeVisible();
  });
});

test.describe('wishlist', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await distinctClientAddress(page, testInfo);
    await resetCustomerState(shopper(testInfo, 'cart').email);
  });

  test('@responsive add and remove from the heart, count, empty state, persistence and account isolation', async ({ page }, testInfo) => {
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await page.goto(`/products/${headphones().slug}`);
    const add = page.getByRole('button', { name: `Add ${headphones().name} to wishlist` });
    await add.click();
    const remove = page.getByRole('button', { name: `Remove ${headphones().name} from wishlist` });
    await expect(remove).toBeVisible();
    await expect(remove).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: /^Wishlist \(1\)/ }).first()).toBeVisible();

    await page.goto('/wishlist');
    await expect(page.getByRole('link', { name: headphones().name }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: headphones().name }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, 'wishlist');

    // Another customer never sees this wishlist.
    const outsider = await customerApi(fixtures().outsider.email);
    const theirs = await (await outsider.get('/api/wishlist')).json() as { data: { items: { productId: string }[] } };
    expect(theirs.data.items.map(item => item.productId)).not.toContain(headphones().id);
    await outsider.dispose();

    await page.getByRole('button', { name: `Remove ${headphones().name} from wishlist` }).first().click();
    await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();
    await page.getByRole('link', { name: 'Explore Products' }).click();
    await expect(page).toHaveURL(/\/products/);
  });

  test('rapid repeated heart toggles settle on the last intent on the server', async ({ page }, testInfo) => {
    await signInCustomer(page, shopper(testInfo, 'cart').email);
    await page.goto(`/products/${dock().slug}`);
    const heart = page.getByRole('button', { name: new RegExp(`(Add|Remove) ${dock().name} (to|from) wishlist`) }).first();
    for (let click = 0; click < 3; click++) await heart.click();
    await expect(page.getByRole('button', { name: `Remove ${dock().name} from wishlist` }).first()).toBeVisible();
    const api = await customerApi(shopper(testInfo, 'cart').email);
    await expect.poll(async () => ((await (await api.get('/api/wishlist')).json()) as { data: { items: { productId: string }[] } }).data.items.map(item => item.productId))
      .toEqual([dock().id]);
    await api.dispose();
  });
});
