import { expect, test, type Page } from '@playwright/test';

// INTERCEPTED APIs (real Chromium, real app). Server latency is simulated by gating the responses, so the measured "disabled" time is the
// time the client keeps Checkout blocked beyond the simulated server work. Backend stock and totals stay authoritative (the fake recomputes both).
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'cart@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
const image = { id: 'image-1', url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: 'Phone', sortOrder: 0, isPrimary: true };
const catalog = [
  { id: '8f2813b4-a388-44d3-b51e-5d4c40386677', name: 'Apple iPhone 15 Pro', slug: 'phone', price: '100.00', stock: 8 },
  { id: '41f516ae-8385-4dcb-9a85-90b5dc9fe363', name: 'Studio Headphones', slug: 'headphones', price: '50.00', stock: 8 },
];

async function world(page: Page) {
  const quantities: Record<string, number> = { [catalog[0]!.id]: 2, [catalog[1]!.id]: 1 };
  const state = { gates: [] as (() => void)[], patches: [] as number[], deletes: 0, failNext: false, manual: true };
  const cart = () => {
    const items = catalog.filter(p => quantities[p.id]).map(p => ({ id: `line-${p.slug}`, productId: p.id, quantity: quantities[p.id]!,
      product: { slug: p.slug, name: p.name, category: 'Phones', price: p.price, image }, availableQuantity: p.stock, availability: 'AVAILABLE',
      lineTotal: (Number(p.price) * quantities[p.id]!).toFixed(2) }));
    const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal), 0).toFixed(2);
    return { items, revision: `r${subtotal}`.padEnd(64, '0'), totalQuantity: items.reduce((s, i) => s + i.quantity, 0), subtotal, shipping: '0.00', total: subtotal, currency: 'USD', canCheckout: items.length > 0 };
  };
  await page.addInitScript(value => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)), user);
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/auth/customer/refresh') return json({ accessToken: 'intercepted', user });
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/cart' && method === 'GET') return json({ data: cart() });
    const item = /^\/api\/cart\/items\/([^/]+)$/.exec(path);
    if (item && (method === 'PATCH' || method === 'DELETE')) {
      const productId = decodeURIComponent(item[1]!);
      if (method === 'PATCH') state.patches.push((route.request().postDataJSON() as { quantity: number }).quantity); else state.deletes++;
      if (state.manual) await new Promise<void>(release => state.gates.push(release));
      if (state.failNext) { state.failNext = false; return json({ error: { code: 'INSUFFICIENT_STOCK', message: 'Only 3 items are currently available.' } }, 409); }
      if (method === 'PATCH') quantities[productId] = (route.request().postDataJSON() as { quantity: number }).quantity; else delete quantities[productId];
      return json({ data: cart() });
    }
    if (path === '/api/wishlist') return json({ data: { items: [], totalItems: 0 } });
    if (path.startsWith('/api/recommendations')) return json({ data: { items: [] } });
    if (path === '/api/checkout/payment-attempts') return json({ data: [] });
    return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });
  return { state, quantities, release: () => state.gates.shift()?.(), held: () => state.gates.length };
}
const checkout = (page: Page) => page.getByRole('button', { name: 'Proceed to Checkout' });
const phone = catalog[0]!.name;

test('quantity and removal: Checkout is blocked only while a write is unsettled and recovers as soon as the cart is saved', async ({ page }) => {
  const flow = await world(page);
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await expect(checkout(page)).toBeEnabled({ timeout: 20_000 });

  // Increase: blocked and explained while the write is pending, enabled right after it resolves.
  await page.getByRole('button', { name: `Increase quantity for ${phone}` }).click();
  await expect(checkout(page)).toBeDisabled();
  await expect(checkout(page)).toHaveAccessibleDescription(/Updating your cart/);
  await expect.poll(() => flow.held()).toBe(1);
  const releasedAt = Date.now();
  flow.release();
  await expect(checkout(page)).toBeEnabled();
  const recoveryMs = Date.now() - releasedAt;
  test.info().annotations.push({ type: 'checkout-recovery-after-increase-ms', description: String(recoveryMs) });
  expect(recoveryMs).toBeLessThan(1500);
  await expect(page.getByText('$350.00').first()).toBeVisible();   // 3 x 100 + 1 x 50: the authoritative total

  // Decrease.
  await page.getByRole('button', { name: `Decrease quantity for ${phone}` }).click();
  await expect(checkout(page)).toBeDisabled();
  await expect.poll(() => flow.held()).toBe(1);
  flow.release();
  await expect(checkout(page)).toBeEnabled();

  // Remove one line.
  await page.getByRole('button', { name: /Remove Studio Headphones/i }).click();
  await expect(checkout(page)).toBeDisabled();
  await expect.poll(() => flow.held()).toBe(1);
  flow.release();
  await expect(checkout(page)).toBeEnabled();
  await expect(page.getByText('Studio Headphones')).toHaveCount(0);

  // Remove the last line: an empty cart is never eligible.
  await page.getByRole('button', { name: new RegExp(`Remove ${phone}`, 'i') }).click();
  await expect.poll(() => flow.held()).toBe(1);
  flow.release();
  await expect(page.getByText('Your cart is empty')).toBeVisible();
  await expect(checkout(page)).toHaveCount(0);
});

test('rapid + clicks are coalesced: few writes, final quantity, and Checkout is released only after the last one settles', async ({ page }) => {
  const flow = await world(page);
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await expect(checkout(page)).toBeEnabled({ timeout: 20_000 });
  const plus = page.getByRole('button', { name: `Increase quantity for ${phone}` });
  for (let i = 0; i < 5; i++) await plus.click();                // 2 -> 7 while the first write is still held
  await expect.poll(() => flow.held()).toBeGreaterThanOrEqual(1);
  flow.release();
  // With the first write settled, a coalesced second write may still be queued: Checkout must stay blocked until it also settles.
  await page.waitForTimeout(150);
  if (flow.held() > 0) { await expect(checkout(page)).toBeDisabled(); flow.release(); }
  await expect(checkout(page)).toBeEnabled();
  expect(flow.state.patches.length, `PATCH bodies ${JSON.stringify(flow.state.patches)}`).toBeLessThanOrEqual(2);
  expect(flow.state.patches.at(-1)).toBe(7);
  expect(flow.quantities[catalog[0]!.id]).toBe(7);
  await expect(page.getByText('$750.00').first()).toBeVisible();   // 7 x 100 + 1 x 50
});

test('a stock conflict rolls the quantity back to the server state and releases Checkout', async ({ page }) => {
  const flow = await world(page);
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await expect(checkout(page)).toBeEnabled({ timeout: 20_000 });
  flow.state.failNext = true;
  await page.getByRole('button', { name: `Increase quantity for ${phone}` }).click();
  await expect(checkout(page)).toBeDisabled();
  await expect.poll(() => flow.held()).toBe(1);
  flow.release();
  await expect(checkout(page)).toBeEnabled();                    // the failed write no longer blocks anything
  await expect(page.getByText('$250.00').first()).toBeVisible();  // rolled back: 2 x 100 + 1 x 50
  expect(flow.quantities[catalog[0]!.id]).toBe(2);
  // Retry succeeds.
  await page.getByRole('button', { name: `Increase quantity for ${phone}` }).click();
  await expect.poll(() => flow.held()).toBe(1);
  flow.release();
  await expect(checkout(page)).toBeEnabled();
  await expect(page.getByText('$350.00').first()).toBeVisible();
});

test('refresh keeps the saved cart and an enabled Checkout', async ({ page }) => {
  const flow = await world(page);
  flow.state.manual = false;
  await page.goto('/cart', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Increase quantity for ${phone}` }).click();
  await expect(page.getByText('$350.00').first()).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('$350.00').first()).toBeVisible();
  await expect(checkout(page)).toBeEnabled();
});
