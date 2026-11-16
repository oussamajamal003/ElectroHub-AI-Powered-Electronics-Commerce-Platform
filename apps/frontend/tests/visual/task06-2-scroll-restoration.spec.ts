import { expect, test, type Page } from '@playwright/test';
import { maxScroll, product, scrollY, world } from './task06-2-world.helper';

/**
 * Task 06.2 Work Package D: route-aware scroll restoration (layouts/CustomerScrollRestoration.tsx).
 *  - forward navigation (link click / push) starts at the top of the new page;
 *  - Back/Forward returns to the exact position the visitor left;
 *  - a Back into a page whose content is still loading never parks the visitor at the bottom of a half-rendered page and never
 *    replaces the remembered position with a clamped one.
 */
const productPath = `/products/${product.slug}`;

async function openProduct(page: Page) {
  await page.goto(productPath, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: /Phone model 1[0-3]/ }).first()).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate(position => window.scrollTo(0, position), y);
  await page.waitForTimeout(250);
  return scrollY(page);
}

for (const [destination, linkName, heading] of [['Cart', /^Cart/, 'Shopping Cart'], ['Wishlist', /^Wishlist/, 'Wishlist']] as const) {
  test(`Product → ${destination} (header link) starts at the top; Back returns to the same product position`, async ({ page }) => {
    await world(page);
    await openProduct(page);
    const target = Math.min(1200, (await maxScroll(page)) - 50);
    expect(target).toBeGreaterThan(300);
    const left = await scrollTo(page, target);
    await page.getByRole('banner').getByRole('link', { name: linkName }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${destination.toLowerCase()}$`));
    // The URL changes before a lazy route commits; judge the destination's position once it is actually on screen.
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300);
    expect(await scrollY(page), `${destination} must open at the top`).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${productPath}$`));
    await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeAttached();
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(left);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/${destination.toLowerCase()}$`));
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(0);
  });
}

test('Catalog → Product (card click) starts at the top; Back restores the catalog position', async ({ page }) => {
  await world(page);
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Phone model 1(1[0-9]|2[0-3])/ }).first()).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const left = await scrollTo(page, Math.min(900, (await maxScroll(page)) - 50));
  expect(left).toBeGreaterThan(300);
  // A real pointer click on a card already on screen: locator.click() would first scroll it into view natively (animated by
  // html { scroll-behavior: smooth }), and that scroll belongs to the test, not the app.
  const target = await page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="/products/phone-"]')];
    const visible = links.find(link => { const r = link.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 20 && r.width > 0; });
    if (!visible) return null;
    const r = visible.getBoundingClientRect();
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
  });
  expect(target).not.toBeNull();
  await page.mouse.click(target!.x, target!.y);
  await expect(page).toHaveURL(/\/products\/phone-/);
  await expect(page.getByRole('heading', { level: 1, name: /Phone model/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);
  expect(await scrollY(page)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/products$/);
  await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(left);
});

test('Back into a page that is still loading waits for its content instead of landing at the bottom of the loader', async ({ page }) => {
  await world(page, { delays: { catalog: 1_500 } });
  await page.goto('/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /Phone model/ }).first()).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const left = await scrollTo(page, Math.min(900, (await maxScroll(page)) - 50));
  expect(left).toBeGreaterThan(300);
  // A full document load of another page drops every in-memory cache: after Back the catalog must load again, slowly.
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/products$/);
  const samples: { y: number; max: number }[] = [];
  for (let i = 0; i < 10; i += 1) {
    samples.push(await page.evaluate(() => ({ y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight })));
    await page.waitForTimeout(100);
  }
  // While the loader/skeleton is shown the visitor is never parked at its clamped bottom (unless that is the saved position).
  const parked = samples.filter(sample => sample.y > 0 && sample.y !== left && sample.y >= sample.max - 1);
  expect(parked, JSON.stringify(samples)).toEqual([]);
  await expect(page.getByRole('link', { name: /Phone model/ }).first()).toBeAttached({ timeout: 10_000 });
  await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBe(left);
});

test('Leaving a deep position for a short page never lands at the bottom of that page', async ({ page }) => {
  await world(page);
  await openProduct(page);
  await scrollTo(page, await maxScroll(page));
  await page.getByRole('contentinfo').getByRole('link', { name: /^Contact/ }).first().click();
  await expect(page).toHaveURL(/\/contact$/);
  await page.waitForTimeout(400);
  expect(await scrollY(page)).toBe(0);
});
