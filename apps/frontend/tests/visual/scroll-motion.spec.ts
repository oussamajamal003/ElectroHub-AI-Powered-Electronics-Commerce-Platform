import { expect, test, type Page } from '@playwright/test';

/**
 * Regression for the upward-scroll defect: sections that had been revealed while scrolling down were hidden again (and replayed)
 * when they left the viewport, so scrolling back up produced content that vanished, popped in or re-animated.
 * A reveal wrapper carries a class containing "pending" only while it is hidden awaiting its first reveal.
 */
const pendingInView = (page: Page) => page.evaluate(() => {
  const hidden: string[] = [];
  document.querySelectorAll<HTMLElement>('[class*="reveal"], [class*="benefits"], [class*="item"]').forEach(node => {
    const box = node.getBoundingClientRect();
    const inViewOrAbove = box.bottom > 0 && box.top < window.innerHeight;
    const above = box.bottom <= 0;
    if (!(inViewOrAbove || above)) return;
    const cls = String(node.className);
    const opacity = Number(getComputedStyle(node).opacity);
    if (/pending|benefitsPending/i.test(cls) && opacity < 0.05) hidden.push(`${node.tagName}.${cls.split(' ').find(c => /pending/i.test(c))}@${Math.round(box.top)}`);
  });
  return hidden;
});

async function stepScroll(page: Page, from: number, to: number, step = 300) {
  const direction = to > from ? 1 : -1;
  for (let y = from; direction > 0 ? y <= to : y >= to; y += direction * step) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(60);
  }
}

for (const [name, path] of [['About', '/about'], ['Home', '/']] as const) {
  test(`${name}: revealed content is never hidden or replayed when scrolling down, then up, then down again`, async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) }));
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(height).toBeGreaterThan(600);

    await stepScroll(page, 0, height);              // 1-5: down through every section
    await page.waitForTimeout(900);                 // let the last reveal finish
    expect(await pendingInView(page), 'bottom of page').toEqual([]);

    // 6-7: back up. Sections leave through the bottom edge; none may re-hide (the original defect) or restart an animation.
    const restarted: number[] = [];
    await page.evaluate(() => {
      (window as unknown as { __anim: number }).__anim = 0;
      document.addEventListener('animationstart', () => { (window as unknown as { __anim: number }).__anim++; }, true);
    });
    for (let y = height; y >= 0; y -= 300) {
      await page.evaluate(position => window.scrollTo(0, position), y);
      await page.waitForTimeout(60);
      expect(await pendingInView(page), `scrolling up at ${y}`).toEqual([]);
    }
    restarted.push(await page.evaluate(() => (window as unknown as { __anim: number }).__anim));
    expect(restarted[0], 'no reveal animation may restart while scrolling up').toBe(0);

    // 8-9: down again, still stable and still not replaying.
    await stepScroll(page, 0, height);
    await page.waitForTimeout(300);
    expect(await pendingInView(page)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __anim: number }).__anim)).toBe(0);
  });

  test(`${name}: rapid reverse scrolling leaves nothing hidden`, async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) }));
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let round = 0; round < 6; round++) {
      await page.evaluate(h => window.scrollTo(0, h), height);
      await page.waitForTimeout(25);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(25);
    }
    await page.evaluate(h => window.scrollTo(0, h / 2), height);
    await page.waitForTimeout(900);
    expect(await pendingInView(page)).toEqual([]);
  });
}

test('reduced motion: nothing is hidden or animated, at any scroll position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (const y of [0, height / 2, height, 0]) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(80);
    expect(await pendingInView(page)).toEqual([]);
  }
  await expect(page.getByRole('heading', { name: 'Our values' })).toBeVisible();
  const running = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && !(a.effect as KeyframeEffect | null)?.target?.matches?.('[class*="cta"], [class*="cta"] *')).length);
  expect(running).toBe(0);
});

test('mobile (390px): scroll down and back up without hiding content or horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await stepScroll(page, 0, height, 260);
  await page.waitForTimeout(800);
  for (let y = height; y >= 0; y -= 260) {
    await page.evaluate(position => window.scrollTo(0, position), y);
    await page.waitForTimeout(50);
    expect(await pendingInView(page)).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('navigation and reload keep a restored scroll position fully visible', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  await page.evaluate(h => window.scrollTo(0, h), height);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  expect(await pendingInView(page)).toEqual([]);
  await page.getByRole('link', { name: 'Contact us' }).first().click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.goBack();
  await page.waitForTimeout(900);
  expect(await pendingInView(page)).toEqual([]);
});
