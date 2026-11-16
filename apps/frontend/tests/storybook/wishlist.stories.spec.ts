import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
const stories = ['customer-wishlist-page--guest', 'customer-wishlist-page--authenticated', 'customer-wishlist-page--empty',
  'customer-wishlist-page--loading', 'customer-wishlist-page--error', 'customer-wishlist-page--background-error',
  'customer-wishlist-page--merge-recovery', 'customer-wishlist-page--out-of-stock', 'customer-wishlist-page--unavailable',
  'customer-wishlist-page--pending', 'components-wishlist-button--unsaved', 'components-wishlist-button--saved', 'components-wishlist-button--pending',
  'components-wishlist-button--error', 'components-wishlist-button--details-actions',
  'components-productcard--wishlist-unsaved', 'components-productcard--wishlist-saved', 'components-productcard--wishlist-pending', 'components-productcard--wishlist-out-of-stock'];
for (const story of stories) test(`${story} local fixtures, responsive evidence and accessibility`, async ({ page }) => {
  test.setTimeout(90_000);
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#storybook-root > *').first()).toBeVisible();
  await page.addScriptTag({ content: `${readFileSync(path.resolve(process.cwd(), '../../node_modules/axe-core/axe.min.js'), 'utf8')}\nwindow.__wishlistAxe = window.axe;` });
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 906 });
    const violations = await page.evaluate(async () => {
      const axe = (window as Window & { __wishlistAxe: { run: (selector: string, options: object) => Promise<{ violations: { id: string }[] }> } }).__wishlistAxe;
      return (await axe.run('#storybook-root', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(item => item.id);
    });
    expect(violations).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/wishlist-story-${story}-${width}.png`, fullPage: true });
  }
  expect(requests).toEqual([]);
});
