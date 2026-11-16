import path from 'node:path';
import { expect, test } from '@playwright/test';

const axeScript = path.resolve(process.cwd(), '../../node_modules/axe-core/axe.min.js');
const stories = [
  'customer-cart-page--guest-populated',
  'customer-cart-page--authenticated-populated',
  'customer-cart-page--empty',
  'customer-cart-page--loading',
  'customer-cart-page--unavailable',
  'components-cartitem--low-stock',
  'components-quantityselector--maximum',
  'components-productcard--add-to-cart',
];

for (const story of stories) {
  test(`${story} renders and passes focused accessibility checks`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/iframe.html?id=${story}&viewMode=story`);
    await expect(page.locator('#storybook-root')).not.toBeEmpty({ timeout: 20_000 });
    await page.addScriptTag({ path: axeScript });
    const violations = await page.evaluate(async () => {
      const accessibility = (window as Window & { axe: { run: (element: string, options: object) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
      const result = await accessibility.run('#storybook-root', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
      return result.violations.map(violation => ({ id: violation.id, count: violation.nodes.length }));
    });
    expect(violations).toEqual([]);
  });
}
