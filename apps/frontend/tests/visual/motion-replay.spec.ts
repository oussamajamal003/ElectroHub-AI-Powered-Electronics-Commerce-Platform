import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 06.2 Work Package C. Home and Products with realistic catalog data (the older scroll spec stubs every API with an empty
 * list, so the data-driven Home sections never rendered there). Every `animationstart` and every removed element is recorded while
 * the visitor scrolls, so a reveal that replays, a section that remounts or content that is hidden again is caught, not guessed.
 * Every API is intercepted: nothing reaches a database.
 */
const image = (n: number) => ({ id: `image-${n}`, url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: `Phone ${n}`, sortOrder: 0, isPrimary: true });
const summary = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `Phone model ${n}`, slug: `phone-${n}`,
  description: 'A current smartphone.', price: '499.00', compareAtPrice: '599.00', discountPercent: 17, averageRating: 4, reviewCount: 2, currency: 'USD',
  availability: 'AVAILABLE', stockStatus: 'IN_STOCK', availableQuantity: 10, purchasable: true,
  category: { id: 'category-1', name: 'Phones', slug: 'phones' }, brand: { id: 'brand-1', name: 'Apple', slug: 'apple' }, primaryImage: image(n), secondaryImage: null });
const categories = ['Phones', 'Laptops', 'Audio', 'Tablets', 'Cameras', 'Gaming', 'Wearables', 'Accessories'].map((name, i) => ({
  id: `category-${i + 1}`, name, slug: name.toLowerCase(), description: `${name} for every day.`, imageUrl: null, productCount: 40 - i }));
const popular = { mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'MEASURED_POPULARITY', isPersonalized: false, isFallback: false, fallbackReason: null,
  modelVersion: null, embeddingVersion: null, algorithmVersion: 'test', context: {}, impressionToken: null,
  items: Array.from({ length: 4 }, (_, i) => ({ rank: i + 1, product: summary(300 + i) })) };

const page24 = (first: number, total = 48, page = 1) => {
  const items = Array.from({ length: 24 }, (_, i) => summary(first + i));
  return { data: items, meta: { page, pageSize: 24, total, totalPages: Math.ceil(total / 24), hasNextPage: page * 24 < total } };
};

async function world(page: Page) {
  const calls = { catalog: 0, deals: 0 };
  await page.route(/^https?:\/\/[^/]+\/api\//, route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/auth/customer/refresh') return json({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }, 401);
    if (path === '/api/categories') return json({ data: categories });
    if (path === '/api/products/deals') {
      // A later read returns the same deals in another order (ties in discount, a price change): React then MOVES the keyed cards.
      const deals = Array.from({ length: 6 }, (_, i) => summary(200 + i));
      return json({ data: calls.deals++ === 0 ? deals : deals.reverse(), meta: { page: 1, pageSize: 6, total: 6, totalPages: 1 } });
    }
    if (path === '/api/recommendations/popular') return json({ data: popular });
    if (path === '/api/products' && url.searchParams.get('pageSize') === '6') return json({ data: Array.from({ length: 6 }, (_, i) => summary(400 + i)), meta: { page: 1, pageSize: 6, total: 6, totalPages: 1 } });
    if (path === '/api/search/products' || path === '/api/products') {
      calls.catalog++;
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      return json(page24(pageNumber === 2 ? 124 : 100, 48, pageNumber));
    }
    return json({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  });
  return calls;
}

/** Starts recording. Hero image cross-fades and loading shimmers are ongoing, not entrance animations, so they are labelled apart. */
async function record(page: Page) {
  await page.evaluate(() => {
    const log = { animations: [] as string[], removed: 0 };
    Reflect.set(window, '__motionLog', log);
    document.addEventListener('animationstart', event => {
      const target = event.target as HTMLElement;
      log.animations.push(`${String(target.className).split(' ')[0]}:${(event as AnimationEvent).animationName}`);
    }, true);
    new MutationObserver(records => { for (const r of records) log.removed += [...r.removedNodes].filter(n => n.nodeType === 1).length; })
      .observe(document.querySelector('main') ?? document.body, { subtree: true, childList: true });
  });
}
const readLog = (page: Page) => page.evaluate(() => Reflect.get(window, '__motionLog') as { animations: string[]; removed: number });
const entrances = (names: string[]) => names.filter(name => !/loading|spin|pulse|shimmer|ctaPulse/i.test(name));
/** Text-bearing elements in (or above) the viewport that are still invisible: a reveal stuck at opacity 0 or hidden again. */
const hiddenInView = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main *')].filter(node => {
  const box = node.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || box.top > innerHeight) return false;
  return Number(getComputedStyle(node).opacity) < 0.05 && (node.textContent ?? '').trim().length > 0 && !node.closest('[aria-hidden="true"]');
}).map(node => `${node.tagName}.${String(node.className).split(' ')[0]}@${Math.round(node.getBoundingClientRect().top)}`));

async function scrollThrough(page: Page, from: number, to: number, step = 250, pause = 60) {
  const direction = to >= from ? 1 : -1;
  for (let y = from; direction > 0 ? y <= to : y >= to; y += direction * step) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(pause);
  }
  await page.evaluate(position => window.scrollTo(0, position), to);
}
const scrollable = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - innerHeight);

for (const [label, viewport] of [['desktop 1440', { width: 1440, height: 900 }], ['mobile 390', { width: 390, height: 844 }]] as const) {
  test(`Home (${label}): sections reveal once on the way down and never replay, re-hide or remount on the way up`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await world(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /Phone model 40[0-5]/ }).first()).toBeAttached({ timeout: 20_000 });   // the data-driven sections exist
    await page.waitForTimeout(1500);
    await record(page);

    const height = await scrollable(page);
    expect(height).toBeGreaterThan(1500);
    await scrollThrough(page, 0, Math.round(height / 2));          // 1-2: scroll down part way, then pause
    await page.waitForTimeout(1200);
    await scrollThrough(page, Math.round(height / 2), height);     // 3: farther, to the end
    await page.waitForTimeout(1500);
    const first = await readLog(page);
    test.info().annotations.push({ type: 'home-first-pass', description: JSON.stringify(first) });
    // The reveal system really runs: sections and cards animated in on the first pass.
    expect(entrances(first.animations).filter(name => /heroRise|benefitsRise/.test(name)).length).toBeGreaterThan(5);
    expect(await hiddenInView(page), 'bottom of page').toEqual([]);

    await record(page);                                             // 4: back up, checking every stop
    for (let y = height; y >= 0; y -= 250) {
      await page.evaluate(position => window.scrollTo(0, position), y);
      await page.waitForTimeout(60);
      expect(await hiddenInView(page), `hidden content at ${y} while scrolling up`).toEqual([]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await scrollThrough(page, 0, height, 300, 40);                  // 5: and down again
    await page.waitForTimeout(600);
    const replay = await readLog(page);
    test.info().annotations.push({ type: 'home-replay-pass', description: JSON.stringify(replay) });
    expect(entrances(replay.animations), 'no reveal may replay after the first pass').toEqual([]);
    expect(replay.removed, 'no section or card may remount while scrolling').toBe(0);
    await page.screenshot({ path: `test-results/motion-contact/home-after-replay-${viewport.width}.png` });
  });
}

test('Home: a background refetch that returns the same cards in a new order never replays their entrance', async ({ page }) => {
  test.setTimeout(150_000);
  const calls = await world(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Phone model 20[0-5]/ }).first()).toBeAttached({ timeout: 30_000 });
  const deals = page.locator('#deals-title').locator('xpath=ancestor::section[1]');
  await deals.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);                                 // the deals grid has revealed and finished
  await record(page);
  const order = () => deals.getByRole('link', { name: /^Phone model 20[0-5]$/ }).allTextContents();
  const before = await order();
  await page.waitForTimeout(61_000);                                // the products cache is stale after 60 s
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => calls.deals, { timeout: 10_000 }).toBeGreaterThan(1);
  await expect.poll(order, { timeout: 10_000 }).not.toEqual(before);   // the cards really moved
  await page.waitForTimeout(1000);
  const log = await readLog(page);
  test.info().annotations.push({ type: 'home-reorder', description: JSON.stringify(log) });
  expect(entrances(log.animations), 'moved cards must not play their entrance again').toEqual([]);
  expect(await hiddenInView(page)).toEqual([]);
});

test('Home: leaving and returning (back/forward) shows every section at the restored position without replaying', async ({ page }) => {
  await world(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Phone model 40[0-5]/ }).first()).toBeAttached({ timeout: 30_000 });
  const height = await scrollable(page);
  await scrollThrough(page, 0, Math.round(height * 0.7));
  await page.waitForTimeout(1200);
  await page.getByRole('link', { name: 'Phone model 400' }).first().click();
  await expect(page).toHaveURL(/\/products\/phone-400/);
  await page.goBack();
  await expect(page.getByRole('link', { name: /Phone model 40[0-5]/ }).first()).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  expect(await hiddenInView(page), 'restored position').toEqual([]);
  await record(page);
  for (let y = await page.evaluate(() => scrollY); y >= 0; y -= 250) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(60);
    expect(await hiddenInView(page), `hidden content at ${y}`).toEqual([]);
  }
  expect(entrances((await readLog(page)).animations), 'sections passed over by the restored scroll position never animate when scrolled to').toEqual([]);
});

test('Home: reduced motion shows every section immediately with no entrance animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await world(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Phone model 40[0-5]/ }).first()).toBeAttached({ timeout: 30_000 });
  await record(page);
  const height = await scrollable(page);
  for (const y of [0, height / 3, (2 * height) / 3, height, 0]) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(150);
    expect(await hiddenInView(page)).toEqual([]);
  }
  expect(entrances((await readLog(page)).animations)).toEqual([]);
});

test('Products: cards play their entrance once on first load, new pages reveal, and a background refetch never replays', async ({ page }) => {
  test.setTimeout(150_000);
  const calls = await world(page);
  await page.addInitScript(() => {
    const seen: string[] = [];
    Reflect.set(window, '__cardEntrances', seen);
    document.addEventListener('animationstart', event => {
      // A card entrance is an animation on a wrapper that holds exactly one product card (its title names the product).
      const target = event.target as HTMLElement;
      const titles = target.querySelectorAll?.('h2, h3');
      if (titles?.length === 1 && /cardRise|heroRise/.test((event as AnimationEvent).animationName)) seen.push(titles[0].textContent ?? '');
    }, true);
  });
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Phone model 100' }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const entered = () => page.evaluate(() => Reflect.get(window, '__cardEntrances') as string[]);
  const firstView = await entered();
  // The cards in the first viewport animate in, each exactly once.
  expect(firstView.length).toBeGreaterThanOrEqual(3);                 // the first row at 1280x720 (0 before the fix)
  expect(new Set(firstView).size).toBe(firstView.length);
  expect(await hiddenInView(page)).toEqual([]);

  const height = await scrollable(page);
  await scrollThrough(page, 0, height);                            // cards further down reveal as they arrive
  await page.waitForTimeout(1200);
  const afterScroll = await entered();
  expect(afterScroll.length).toBeGreaterThan(firstView.length);
  expect(new Set(afterScroll).size, 'no card may animate twice').toBe(afterScroll.length);
  for (let y = height; y >= 0; y -= 250) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(50);
    expect(await hiddenInView(page), `hidden content at ${y}`).toEqual([]);
  }
  expect(await entered(), 'scrolling back up never replays a card').toEqual(afterScroll);

  // A background refetch of the same results (stale after 30 s, re-read on reconnect) keeps every card mounted and still.
  const before = calls.catalog;
  await page.waitForTimeout(31_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => calls.catalog, { timeout: 10_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(1200);
  expect(await entered(), 'a refetch with the same products never replays their entrance').toEqual(afterScroll);

  // A new page brings new products. Cards that mount below the viewport reveal (once each) as they arrive; cards that mount above it
  // while the page is moving to the results top are shown settled, never hidden. Either way nothing is stuck invisible.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: 'Go to page 2' }).click();
  await expect(page.getByRole('link', { name: 'Phone model 124' }).first()).toBeAttached({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(await hiddenInView(page)).toEqual([]);
  await scrollThrough(page, await page.evaluate(() => scrollY), await scrollable(page));
  await page.waitForTimeout(1200);
  const paged = await entered();
  const pageTwo = paged.filter(name => Number(name.replace('Phone model ', '')) >= 124);
  test.info().annotations.push({ type: 'page-2-entrances', description: JSON.stringify(pageTwo) });
  expect(pageTwo.length, 'new cards on page 2 reveal').toBeGreaterThan(0);
  expect(new Set(paged).size, 'still no card animates twice').toBe(paged.length);
  expect(await hiddenInView(page)).toEqual([]);
  await page.screenshot({ path: 'test-results/motion-contact/products-page-2.png' });
});

test('Products: reduced motion shows every card with no entrance animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await world(page);
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Phone model 100' }).first()).toBeVisible({ timeout: 30_000 });
  await record(page);
  const height = await scrollable(page);
  for (const y of [0, height / 2, height, 0]) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(120);
    expect(await hiddenInView(page)).toEqual([]);
  }
  expect(entrances((await readLog(page)).animations)).toEqual([]);
});
