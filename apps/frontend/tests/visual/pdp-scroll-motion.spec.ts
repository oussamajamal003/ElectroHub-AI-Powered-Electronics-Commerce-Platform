import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './axe-audit.helper';

/**
 * Product Details scroll lifecycle. Records every CSS animation/transition that starts and every element that is removed while the
 * visitor scrolls back up, so a reveal that replays, an image that re-fades or a rail that remounts is caught, not just a final screenshot.
 */
const image = (n: number) => ({ id: `image-${n}`, url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: `Phone ${n}`, sortOrder: 0, isPrimary: true });
const summary = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `Phone model ${n}`, slug: `phone-${n}`,
  description: 'A current smartphone.', price: '499.00', compareAtPrice: null, discountPercent: null, averageRating: 4, reviewCount: 2, currency: 'USD',
  availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 10, purchasable: true,
  category: { id: 'category-1', name: 'Phones', slug: 'phones' }, brand: { id: 'brand-1', name: 'Apple', slug: 'apple' }, primaryImage: image(n), secondaryImage: null });
const product = { ...summary(1), name: 'Apple iPhone 15 Pro', slug: 'apple-iphone-15-pro', sku: 'IP15P', images: [image(1)],
  specifications: Array.from({ length: 10 }, (_, i) => ({ name: `Spec ${i + 1}`, value: `Value ${i + 1}`, group: 'General' })) };
const section = (mode: string, from: number) => ({ mode, surface: 'product_detail', strategy: 'FALLBACK_CATEGORY', isPersonalized: false, isFallback: true,
  fallbackReason: null, modelVersion: null, embeddingVersion: null, algorithmVersion: 'test', context: { categoryName: 'Phones', categorySlug: 'phones' },
  impressionToken: null, items: Array.from({ length: 4 }, (_, i) => ({ rank: i + 1, product: summary(from + i) })) });
const reviews = Array.from({ length: 6 }, (_, i) => ({ id: `review-${i}`, rating: 4, body: 'Solid phone with a great screen.',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', author: { displayName: 'Sam T.' } }));

async function world(page: Page) {
  await page.route(/^https?:\/\/[^/]+\/api\//, route => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/auth/customer/refresh') return json({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }, 401);
    if (path === `/api/products/${product.slug}`) return json({ data: product });
    if (path === `/api/products/${product.slug}/recommendations`) return json({ data: { sections: [section('SIMILAR_PRODUCTS', 10), section('FREQUENTLY_BOUGHT_TOGETHER', 20)] } });
    if (/\/reviews\/me$/.test(path)) return json({ data: null });
    if (/\/reviews$/.test(path)) return json({ data: reviews, meta: { page: 1, pageSize: 10, total: reviews.length, totalPages: 1 }, summary: { averageRating: '4.0', reviewCount: 6 } });
    if (path === '/api/search/products' || path === '/api/products') {
      const items = Array.from({ length: 24 }, (_, i) => summary(100 + i));
      return json({ data: items, meta: { page: 1, pageSize: 24, total: items.length, totalPages: 1 } });
    }
    return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });
}

async function instrument(page: Page) {
  await page.evaluate(() => {
    const log = { animations: [] as string[], transitions: [] as string[], removed: 0 };
    Reflect.set(window, '__motionLog', log);
    const label = (event: Event) => { const t = event.target as HTMLElement; return `${t.tagName}.${String(t.className).split(' ')[0]}:${(event as AnimationEvent).animationName ?? (event as TransitionEvent).propertyName}`; };
    document.addEventListener('animationstart', e => log.animations.push(label(e)), true);
    document.addEventListener('transitionstart', e => { if ((e as TransitionEvent).propertyName === 'opacity' || (e as TransitionEvent).propertyName === 'transform') log.transitions.push(label(e)); }, true);
    new MutationObserver(records => { for (const r of records) log.removed += [...r.removedNodes].filter(n => n.nodeType === 1).length; })
      .observe(document.querySelector('main') ?? document.body, { subtree: true, childList: true });
  });
}
const readLog = (page: Page) => page.evaluate(() => Reflect.get(window, '__motionLog') as { animations: string[]; transitions: string[]; removed: number });
const hiddenInView = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main *')].filter(node => {
  const box = node.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.top > innerHeight) return false;
  return Number(getComputedStyle(node).opacity) < 0.05 && (node.textContent ?? '').trim().length > 0;
}).map(node => `${node.tagName}.${String(node.className).split(' ')[0]}`));

for (const [label, viewport] of [['desktop 1440', { width: 1440, height: 900 }], ['mobile 390', { width: 390, height: 844 }]] as const) {
  test(`Product Details (${label}): scrolling up never replays, re-fades, remounts or hides revealed content`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await world(page);
    await page.goto(`/products/${product.slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(height).toBeGreaterThan(400);
    // The fixture must really render the below-the-fold content this test is about.
    await expect(page.getByRole('link', { name: /Phone model 1[0-3]/ }).first()).toBeAttached({ timeout: 15_000 });
    for (let y = 0; y <= height; y += 250) { await page.evaluate(p => window.scrollTo(0, p), y); await page.waitForTimeout(60); }
    await page.waitForTimeout(1200);                 // every image loaded, every first reveal finished
    await instrument(page);
    for (let y = height; y >= 0; y -= 250) {
      await page.evaluate(p => window.scrollTo(0, p), y);
      await page.waitForTimeout(60);
      expect(await hiddenInView(page), `hidden content at ${y}`).toEqual([]);
    }
    for (let y = 0; y <= height; y += 250) { await page.evaluate(p => window.scrollTo(0, p), y); await page.waitForTimeout(40); }
    await page.waitForTimeout(400);
    const log = await readLog(page);
    await page.screenshot({ path: `test-results/motion-contact/pdp-${viewport.width}.png`, fullPage: true });
    test.info().annotations.push({ type: 'pdp-motion-log', description: JSON.stringify(log) });
    expect(log.animations.filter(a => !/loading|spin|pulse|shimmer/i.test(a)), 'no reveal/entrance animation may restart').toEqual([]);
    expect(log.transitions, 'no opacity/transform re-fade while scrolling').toEqual([]);
    expect(log.removed, 'no section or card may remount while scrolling').toBe(0);
  });
}

test('Product Details: reload at a deep scroll position and back/forward keep everything visible', async ({ page }) => {
  await world(page);
  await page.goto(`/products/${product.slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible({ timeout: 20_000 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await page.evaluate(h => window.scrollTo(0, h), height);
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  expect(await hiddenInView(page)).toEqual([]);
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  expect(await hiddenInView(page)).toEqual([]);
});

test('Product Details: reduced motion shows everything with no running animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await world(page);
  await page.goto(`/products/${product.slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible({ timeout: 20_000 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (const y of [0, height / 2, height, 0]) {
    await page.evaluate(p => window.scrollTo(0, p), y);
    await page.waitForTimeout(150);
    expect(await hiddenInView(page)).toEqual([]);
  }
});

test('Products catalog: cards revealed while scrolling down never re-animate or hide when scrolling back up', async ({ page }) => {
  await world(page);
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Phone model 10[0-9]/ }).first()).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(600);
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(height).toBeGreaterThan(600);
  for (let y = 0; y <= height; y += 250) { await page.evaluate(p => window.scrollTo(0, p), y); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200);
  await instrument(page);
  for (let y = height; y >= 0; y -= 250) {
    await page.evaluate(p => window.scrollTo(0, p), y);
    await page.waitForTimeout(60);
    expect(await hiddenInView(page), `hidden content at ${y}`).toEqual([]);
  }
  const log = await readLog(page);
  test.info().annotations.push({ type: 'catalog-motion-log', description: JSON.stringify(log) });
  expect(log.animations.filter(a => !/loading|spin|pulse|shimmer/i.test(a)), 'no card entrance animation may restart').toEqual([]);
});

for (const width of [320, 390, 1440]) {
  test(`Review box at ${width}px: visible placeholder, accessible name and description, no overflow`, async ({ page }) => {
    const user = { id: '11111111-1111-4111-8111-111111111111', email: 'review@example.invalid', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => sessionStorage.setItem('electrohub:cached-user', JSON.stringify(value)), user);
    await world(page);
    await page.route('**/api/auth/customer/refresh', route => route.fulfill({ json: { accessToken: 'intercepted', user } }));
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user } }));
    await page.goto(`/products/${product.slug}#reviews`, { waitUntil: 'domcontentloaded' });
    const box = page.getByRole('textbox', { name: /Your review/ });
    await expect(box).toBeVisible({ timeout: 20_000 });
    await expect(box).toHaveAttribute('placeholder', 'Share your experience with this product...');
    await expect(box).toHaveAccessibleDescription('0/2000 characters');
    // The placeholder is actually painted in a readable colour (not transparent / same as the background).
    const colours = await box.evaluate(el => ({ placeholder: getComputedStyle(el, '::placeholder').color, background: getComputedStyle(el).backgroundColor }));
    expect(colours.placeholder).not.toBe(colours.background);
    expect(colours.placeholder).not.toMatch(/rgba\(.*, 0\)$/);
    const fits = await box.evaluate(el => el.getBoundingClientRect().right <= innerWidth + 0.5);
    expect(fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/motion-contact/review-box-${width}.png` });
    await box.fill('Great phone.');
    await expect(box).toHaveAccessibleDescription('12/2000 characters');
    if (width === 1440) await expectNoAxeViolations(page, 'review-form', 'form:has(#review-body)');
  });
}
