import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
for (const story of ['stepper', 'shipping', 'delivery', 'payment-shell', 'summary', 'review', 'conflict', 'processing', 'confirmation', 'confirmation-loading', 'confirmation-error']) {
  test(`production Checkout ${story}: accessibility and responsive layout`, async ({ page }) => {
    await page.goto(`/iframe.html?id=customer-checkout--${story}&viewMode=story`); await expect(page.locator('#storybook-root > *').first()).toBeVisible();
    await page.addScriptTag({ content: `const oldCheckoutAxe = window.axe; ${readFileSync('../../node_modules/axe-core/axe.min.js', 'utf8')}\nwindow.__checkoutAxe = window.axe; window.axe = oldCheckoutAxe;` });
    for (const width of [390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const violations = await page.evaluate(async () => (await (window as Window & { __checkoutAxe: { run: (selector: string, options: object) => Promise<{ violations: { id: string }[] }> } }).__checkoutAxe.run('#storybook-root', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(value => value.id));
      expect(violations).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
