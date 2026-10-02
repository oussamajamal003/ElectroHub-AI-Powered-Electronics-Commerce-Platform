import { expect, test, type Locator, type Page } from '@playwright/test';

const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const product = { id: productId, name: 'Apple iPhone 15 Pro', slug: 'apple-iphone-15-pro',
  description: 'A current smartphone.', price: '1099.99', compareAtPrice: null, discountPercent: null,
  averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE',
  category: { id: 'category-1', name: 'Phones', slug: 'phones' }, brand: { id: 'brand-1', name: 'Apple', slug: 'apple' },
  primaryImage: { id: 'image-1', url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: 'iPhone', sortOrder: 0, isPrimary: true }, secondaryImage: null };

const cartResponse = (quantity: number) => {
  const total = (109999 * quantity / 100).toFixed(2);
  return { data: { items: quantity ? [{ id: 'line-1', productId, quantity,
    product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: product.primaryImage },
    availableQuantity: 5, availability: 'AVAILABLE', lineTotal: total }] : [],
    totalQuantity: quantity, subtotal: total, shipping: '0.00', total, currency: 'USD', canCheckout: quantity > 0 } };
};

async function tabUntil(page: Page, target: Locator, reverse = false) {
  for (let index = 0; index < 60; index++) {
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    if (await target.evaluate(element => element === document.activeElement)) {
      await expect(target).toBeFocused();
      expect(await target.evaluate(element => element.matches(':focus-visible'))).toBe(true);
      expect(await target.evaluate(element => {
        const style = getComputedStyle(element);
        return (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      })).toBe(true);
      return;
    }
  }
  throw new Error('Keyboard navigation did not reach the expected control.');
}

test('guest Cart add, quantity, persistence, removal, and responsive layout', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }) }));
  await page.route('**/api/search/products**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [product], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) }));
  let validationCount = 0;
  await page.route('**/api/cart/validate', async route => {
    validationCount++;
    const input = route.request().postDataJSON() as { items: { productId: string; quantity: number }[] };
    const items = input.items.map(entry => ({ id: null, productId: entry.productId, quantity: entry.quantity,
      product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: { url: product.primaryImage.url, altText: 'iPhone' } },
      availableQuantity: 5, availability: 'AVAILABLE', lineTotal: (109999 * entry.quantity / 100).toFixed(2) }));
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = (109999 * totalQuantity / 100).toFixed(2);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items, totalQuantity, subtotal, shipping: '0.00', total: subtotal, currency: 'USD', canCheckout: items.length > 0 } }) });
  });

  await page.goto('/products');
  await expect(page.getByRole('button', { name: 'Add Apple iPhone 15 Pro to cart' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add Apple iPhone 15 Pro to cart' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await page.getByRole('link', { name: 'Cart, 1 item' }).click();
  await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
  await expect(page.getByText('$1,099.99').first()).toBeVisible();
  await page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect.poll(() => page.locator('[data-testid="cart-item"] img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.getByText('$2,199.98').first()).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
  await expect(page.getByText('$2,199.98').first()).toBeVisible();
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/cart-guest-${width}.png`, fullPage: true });
  }
  expect(validationCount).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Sign in to Checkout' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Remove Apple iPhone 15 Pro from cart' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
});

test('Cart quantity changes stay responsive during serialized rapid updates', async ({ page }) => {
  await page.addInitScript(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 1 }] })), productId);
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }) }));
  await page.route('**/api/cart/validate', async route => {
    const input = route.request().postDataJSON() as { items: { quantity: number }[] };
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartResponse(input.items[0]?.quantity ?? 1)) });
  });
  await page.goto('/cart');
  const increase = page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' });
  const decrease = page.getByRole('button', { name: 'Decrease quantity for Apple iPhone 15 Pro' });
  await expect(increase).toBeEnabled();
  await increase.click();
  await increase.click();
  await increase.click();
  await expect(page.getByRole('link', { name: 'Cart, 4 items' })).toBeVisible();
  await expect(increase).toBeEnabled();
  await decrease.click();
  await decrease.click();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect(page.getByText('$2,199.98').first()).toBeVisible();
});

test('authenticated Cart retries a failed guest merge without losing saved items', async ({ page }) => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'cart-customer@example.invalid', firstName: 'Cart', lastName: 'Customer', role: 'CUSTOMER' };
  await page.addInitScript(({ user, productId }) => {
    sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user));
    localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 3 }] }));
  }, { user, productId });
  const cart = (quantity: number) => ({ data: { items: [{ id: 'line-1', productId, quantity,
    product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: { url: product.primaryImage.url, altText: 'iPhone' } },
    availableQuantity: 5, availability: 'AVAILABLE', lineTotal: (109999 * quantity / 100).toFixed(2) }],
    totalQuantity: quantity, subtotal: (109999 * quantity / 100).toFixed(2), shipping: '0.00', total: (109999 * quantity / 100).toFixed(2), currency: 'USD', canCheckout: true } });
  await page.route('**/api/auth/refresh', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token' }) }));
  await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user }) }));
  await page.route('**/api/cart', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(cart(2)) }));
  let mergeAttempts = 0;
  await page.route('**/api/cart/reconcile', route => {
    mergeAttempts++;
    return mergeAttempts === 1 ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }) })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify(cart(3)) });
  });
  await page.goto('/cart');
  await expect(page.getByText('Your saved items could not be added. Remove unavailable saved items or retry.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).not.toBeNull();
  await page.getByRole('button', { name: 'Retry saved items' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 3 items' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).toBeNull();
  expect(mergeAttempts).toBe(2);
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
});

test('Cart skeleton keeps item and summary geometry across responsive widths', async ({ page }) => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'cart-customer@example.invalid', firstName: 'Cart', lastName: 'Customer', role: 'CUSTOMER' };
  await page.addInitScript(user => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)), user);
  await page.route('**/api/auth/refresh', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token' }) }));
  await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user }) }));
  let release!: () => void;
  await page.route('**/api/cart', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartResponse(2)) });
  });
  await page.goto('/cart');
  await expect(page.getByTestId('cart-skeleton')).toBeVisible();
  await expect.poll(() => typeof release).toBe('function');
  const skeletonHeights = new Map<number, { row: number; summary: number }>();
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const row = await page.getByTestId('cart-skeleton-row').first().boundingBox();
    const summary = await page.getByTestId('cart-skeleton-summary').boundingBox();
    expect(row).not.toBeNull(); expect(summary).not.toBeNull();
    skeletonHeights.set(width, { row: row!.height, summary: summary!.height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/cart-skeleton-${width}.png`, fullPage: true });
  }
  release();
  await expect(page.getByTestId('cart-item')).toBeVisible();
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const row = await page.getByTestId('cart-item').boundingBox();
    const summary = await page.getByRole('heading', { name: 'Order Summary' }).locator('..').boundingBox();
    expect(row).not.toBeNull(); expect(summary).not.toBeNull();
    expect(Math.abs(row!.height - skeletonHeights.get(width)!.row)).toBeLessThanOrEqual(24);
    expect(Math.abs(summary!.height - skeletonHeights.get(width)!.summary)).toBeLessThanOrEqual(40);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Product Details quantity adds to guest Cart without resetting the gallery', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/products/apple-iphone-15-pro', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: {
    ...product, sku: 'IPHONE-15-PRO', modelNumber: 'A2848', availableQuantity: 5,
    images: [product.primaryImage, { id: 'image-2', url: '/images/catalog/variety/apple-phone-generic-02.jpg', altText: 'iPhone alternate view', sortOrder: 1, isPrimary: false }],
    specifications: [],
  } }) }));
  await page.route('**/api/products/apple-iphone-15-pro/reviews**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, summary: { averageRating: null, reviewCount: 0 } }) }));
  await page.route('**/api/search/products**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } }) }));
  await page.route('**/api/cart/validate', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items: [{ id: null, productId, quantity: 3,
    product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: { url: product.primaryImage.url, altText: 'iPhone' } },
    availableQuantity: 5, availability: 'AVAILABLE', lineTotal: '3299.97' }], totalQuantity: 3, subtotal: '3299.97', shipping: '0.00', total: '3299.97', currency: 'USD', canCheckout: true } }) }));

  await page.goto('/products/apple-iphone-15-pro');
  await expect(page.getByRole('heading', { name: 'Apple iPhone 15 Pro' })).toBeVisible();
  const gallery = page.locator('[data-testid="product-gallery"]');
  await expect(gallery).toBeVisible();
  await page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' }).click();
  await page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' }).click();
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 3 items' })).toBeVisible();
  await expect(gallery).toBeVisible();
  await expect.poll(() => gallery.locator('img').first().evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: 'test-results/cart-product-detail-1920.png', fullPage: true });
});

test('low stock can be corrected and an out-of-stock line stays removable', async ({ page }) => {
  await page.addInitScript(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 3 }] })), productId);
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  let outOfStock = false;
  await page.route('**/api/cart/validate', route => {
    const quantity = (route.request().postDataJSON() as { items: { quantity: number }[] }).items[0]!.quantity;
    const availability = outOfStock ? 'OUT_OF_STOCK' : quantity > 2 ? 'LOW_STOCK' : 'AVAILABLE';
    const total = (109999 * quantity / 100).toFixed(2);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items: [{ id: null, productId, quantity,
      product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: product.primaryImage },
      availableQuantity: outOfStock ? 0 : 2, availability, lineTotal: total }], totalQuantity: quantity, subtotal: total,
      shipping: '0.00', total, currency: 'USD', canCheckout: availability === 'AVAILABLE' } }) });
  });
  await page.goto('/cart');
  await expect(page.getByText('Only 2 left. Reduce quantity to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  await page.getByRole('button', { name: 'Decrease quantity for Apple iPhone 15 Pro' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeEnabled();
  outOfStock = true;
  await page.reload();
  await expect(page.getByText('Out of stock. Remove this item to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove Apple iPhone 15 Pro from cart' }).click();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
});

test('duplicate adds retain one line and failed quantity update keeps prior Cart', async ({ page }) => {
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/search/products**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [product], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) }));
  let failNext = false;
  await page.route('**/api/cart/validate', route => {
    const quantity = (route.request().postDataJSON() as { items: { quantity: number }[] }).items[0]!.quantity;
    if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }) }); }
    const total = (109999 * quantity / 100).toFixed(2);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items: [{ id: null, productId, quantity,
      product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: product.primaryImage },
      availableQuantity: 5, availability: 'AVAILABLE', lineTotal: total }], totalQuantity: quantity, subtotal: total,
      shipping: '0.00', total, currency: 'USD', canCheckout: true } }) });
  });
  await page.goto('/products');
  const add = page.getByRole('button', { name: 'Add Apple iPhone 15 Pro to cart' });
  await add.click();
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await add.click();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await page.getByRole('link', { name: 'Cart, 2 items' }).click();
  await expect(page.locator('[data-testid="cart-item"]')).toHaveCount(1);
  failNext = true;
  await page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' }).click();
  await expect(page.getByText('Cart could not be updated. Please try again.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect(page.getByText('$2,199.98').first()).toBeVisible();
  await expect(page.getByText('$3,299.97')).toHaveCount(0);
  await page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 3 items' })).toBeVisible();
  await expect(page.getByText('$3,299.97').first()).toBeVisible();
});

test('failed Add does not claim success or change the badge and can be retried', async ({ page }) => {
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/search/products**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [product], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) }));
  let requests = 0;
  await page.route('**/api/cart/validate', route => {
    requests++;
    return route.fulfill(requests === 1
      ? { status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'private database details' } }) }
      : { contentType: 'application/json', body: JSON.stringify(cartResponse(1)) });
  });
  await page.goto('/products');
  const add = page.getByRole('button', { name: 'Add Apple iPhone 15 Pro to cart' });
  await add.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not add item. Please try again.' })).toBeVisible();
  await expect(page.getByText('Added ✓')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
  await expect(page.getByText('private database details')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).toBeNull();
  await add.click();
  await expect(page.getByRole('link', { name: 'Cart, 1 item' })).toBeVisible();
  await page.getByRole('link', { name: 'Cart, 1 item' }).click();
  await expect(page.getByText('$1,099.99').first()).toBeVisible();
});

test('failed Remove preserves authenticated line, badge, and totals until retry succeeds', async ({ page }) => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'cart-customer@example.invalid', firstName: 'Cart', lastName: 'Customer', role: 'CUSTOMER' };
  await page.addInitScript(user => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)), user);
  await page.route('**/api/auth/refresh', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token' }) }));
  await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user }) }));
  await page.route('**/api/cart', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartResponse(2)) }));
  let attempts = 0;
  await page.route(`**/api/cart/items/${productId}`, route => {
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'private database details' } }) }
      : { contentType: 'application/json', body: JSON.stringify(cartResponse(0)) });
  });
  await page.goto('/cart');
  const remove = page.getByRole('button', { name: 'Remove Apple iPhone 15 Pro from cart' });
  await expect(page.getByText('$2,199.98').first()).toBeVisible();
  await remove.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Cart could not be updated. Please try again.' })).toBeVisible();
  await expect(remove).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await expect(page.getByText('$2,199.98').first()).toBeVisible();
  await expect(page.getByText('private database details')).toHaveCount(0);
  await remove.click();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
});

test('Tab-only ProductCard to Cart quantity, Remove, and Continue shopping', async ({ page }) => {
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/search/products**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [product], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) }));
  await page.route('**/api/cart/validate', route => {
    const quantity = (route.request().postDataJSON() as { items: { quantity: number }[] }).items[0]!.quantity;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartResponse(quantity)) });
  });
  await page.goto('/products');
  const add = page.getByRole('button', { name: 'Add Apple iPhone 15 Pro to cart' });
  await expect(add).toBeVisible();
  await tabUntil(page, add);
  await page.keyboard.press('Enter');
  const cartLink = page.getByRole('link', { name: 'Cart, 1 item' });
  await expect(cartLink).toBeVisible();
  await tabUntil(page, cartLink, true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();
  const increase = page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' });
  await tabUntil(page, increase);
  await page.keyboard.press('Space');
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  const remove = page.getByRole('button', { name: 'Remove Apple iPhone 15 Pro from cart' });
  await tabUntil(page, remove);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  const explore = page.getByRole('link', { name: 'Explore Products' });
  await tabUntil(page, explore);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/products$/);
});

test('authenticated Cart survives refresh and does not become the guest Cart on logout', async ({ page }) => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'cart-customer@example.invalid', firstName: 'Cart', lastName: 'Customer', role: 'CUSTOMER' };
  await page.addInitScript(user => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(user)), user);
  await page.route('**/api/auth/refresh', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token' }) }));
  await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user }) }));
  let finishLogout!: () => void;
  let logoutStarted!: () => void;
  const logoutStartedPromise = new Promise<void>(resolve => { logoutStarted = resolve; });
  await page.route('**/api/auth/logout', async route => {
    logoutStarted();
    await new Promise<void>(resolve => { finishLogout = resolve; });
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/auth/login', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token', user }) }));
  await page.route('**/api/cart', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items: [{ id: 'line-1', productId, quantity: 2,
    product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: product.primaryImage },
    availableQuantity: 5, availability: 'AVAILABLE', lineTotal: '2199.98' }], totalQuantity: 2, subtotal: '2199.98', shipping: '0.00', total: '2199.98', currency: 'USD', canCheckout: true } }) }));
  await page.goto('/cart');
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu for Cart Customer' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (location.pathname === '/cart' && document.body.innerText.includes('Your cart is empty')) {
        document.body.dataset.logoutEmptyCartFlash = 'true';
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Sign Out' }).click();
  await logoutStartedPromise;
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await expect(page.getByText('Apple iPhone 15 Pro')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).toBeNull();
  finishLogout();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.locator('body').getAttribute('data-logout-empty-cart-flash')).toBeNull();
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();
  await page.getByRole('link', { name: 'Cart, 0 items' }).click();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('CartPass123!');
  await page.getByRole('dialog').getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).toBeNull();
});

test('committed reconciliation survives a failed response without a stale saved-item error', async ({ page }) => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'cart-customer@example.invalid', firstName: 'Cart', lastName: 'Customer', role: 'CUSTOMER' };
  await page.addInitScript(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 3 }] })), productId);
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/auth/login', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token', user }) }));
  let serverQuantity = 2;
  await page.route('**/api/cart/validate', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartResponse(3)) }));
  await page.route('**/api/cart', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartResponse(serverQuantity)) }));
  await page.route('**/api/cart/reconcile', route => {
    serverQuantity = 3;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'private database details' } }) });
  });
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Sign in to Checkout' }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('CartPass123!');
  await page.getByRole('dialog').getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('link', { name: 'Cart, 3 items' })).toBeVisible();
  await expect(page.getByText('Your saved items could not be added.')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).toBeNull();
});

test('guest Checkout intent signs in, reconciles, and returns only to Cart', async ({ page }) => {
  const user = { id: '62a990ff-7909-4bbb-b42f-8f20b6d97af4', email: 'cart-customer@example.invalid', firstName: 'Cart', lastName: 'Customer', role: 'CUSTOMER' };
  const guestOnlyId = '41f516ae-8385-4dcb-9a85-90b5dc9fe363';
  const serverOnlyId = '53d67cc1-cced-45e2-88a9-c54d5860122b';
  await page.addInitScript(({ productId, guestOnlyId }) => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 9 }, { productId: guestOnlyId, quantity: 1 }] })), { productId, guestOnlyId });
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/auth/login', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accessToken: 'browser-test-token', user }) }));
  const line = (id: string, quantity: number, name: string, slug: string, price: string) => ({ id: `line-${id}`, productId: id, quantity,
    product: { slug, name, category: 'Phones', price, image: product.primaryImage }, availableQuantity: 20, availability: 'AVAILABLE', lineTotal: (Number(price) * quantity).toFixed(2) });
  const response = (items: ReturnType<typeof line>[]) => {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal), 0).toFixed(2);
    return { data: { items, totalQuantity, subtotal, shipping: '0.00', total: subtotal, currency: 'USD', canCheckout: true } };
  };
  const server = response([line(productId, 7, product.name, product.slug, product.price), line(serverOnlyId, 1, 'Server Cart Tablet', 'server-cart-tablet', '299.00')]);
  const merged = response([line(productId, 9, product.name, product.slug, product.price), line(serverOnlyId, 1, 'Server Cart Tablet', 'server-cart-tablet', '299.00'), line(guestOnlyId, 1, 'Guest Cart Tablet', 'guest-cart-tablet', '199.00')]);
  await page.route('**/api/cart/validate', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(response([line(productId, 9, product.name, product.slug, product.price), line(guestOnlyId, 1, 'Guest Cart Tablet', 'guest-cart-tablet', '199.00')])) }));
  const requestOrder: string[] = [];
  await page.route('**/api/cart', route => { requestOrder.push('server'); return route.fulfill({ contentType: 'application/json', body: JSON.stringify(server) }); });
  let reconciliations = 0;
  let finishReconcile!: () => void;
  let reconcileStarted!: () => void;
  const reconcileStartedPromise = new Promise<void>(resolve => { reconcileStarted = resolve; });
  await page.route('**/api/cart/reconcile', async route => {
    reconciliations++; requestOrder.push('reconcile'); reconcileStarted();
    await new Promise<void>(resolve => { finishReconcile = resolve; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(merged) });
  });
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Sign in to Checkout' }).click();
  await page.getByRole('textbox', { name: 'Email Address' }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('CartPass123!');
  await page.getByRole('dialog').getByRole('button', { name: 'Login' }).click();
  await reconcileStartedPromise;
  await expect(page.getByTestId('cart-skeleton')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  finishReconcile();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('link', { name: 'Cart, 11 items' })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: /^9$/ })).toBeVisible();
  await expect(page.getByText('$10,397.91').first()).toBeVisible();
  await expect(page.getByTestId('cart-skeleton')).toHaveCount(0);
  await expect(page.getByText('Server Cart Tablet')).toBeVisible();
  await expect(page.getByText('Guest Cart Tablet')).toBeVisible();
  await expect(page.getByText('Apple iPhone 15 Pro')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toHaveCount(0);
  await expect(page.getByText('Your saved items could not be added. Remove unavailable saved items or retry.')).toHaveCount(0);
  expect(reconciliations).toBe(1);
  expect(requestOrder).toEqual(['server', 'reconcile']);
  expect(await page.evaluate(() => localStorage.getItem('electrohub.cart.v1'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Proceed to Checkout' })).toBeDisabled();
});

test('Cart controls remain keyboard-operable with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(productId => localStorage.setItem('electrohub.cart.v1', JSON.stringify({ version: 1, items: [{ productId, quantity: 1 }] })), productId);
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
  await page.route('**/api/cart/validate', route => {
    const quantity = (route.request().postDataJSON() as { items: { quantity: number }[] }).items[0]!.quantity;
    const total = (109999 * quantity / 100).toFixed(2);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { items: [{ id: null, productId, quantity,
      product: { slug: product.slug, name: product.name, category: 'Phones', price: product.price, image: product.primaryImage },
      availableQuantity: 5, availability: 'AVAILABLE', lineTotal: total }], totalQuantity: quantity, subtotal: total,
      shipping: '0.00', total, currency: 'USD', canCheckout: true } }) });
  });
  await page.goto('/cart');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const increase = page.getByRole('button', { name: 'Increase quantity for Apple iPhone 15 Pro' });
  await increase.focus();
  await expect(increase).toBeFocused();
  await increase.press('Enter');
  await expect(page.getByRole('link', { name: 'Cart, 2 items' })).toBeVisible();
  const remove = page.getByRole('button', { name: 'Remove Apple iPhone 15 Pro from cart' });
  await remove.focus();
  await remove.press('Enter');
  await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore Products' }).focus();
  await expect(page.getByRole('link', { name: 'Explore Products' })).toBeFocused();
});
