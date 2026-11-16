// Requires the existing Storybook on :6006. Synthetic cache fixtures only; no backend or database.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch();
  const output = path.resolve('apps/frontend/test-results/analytics-product-images');
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:6006/iframe.html?id=admin-analytics--populated&viewMode=story');
    const section = page.getByRole('region', { name: 'Top products', exact: true });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await section.scrollIntoViewIfNeeded();
      const image = section.locator('img');
      await expect(image).toHaveAttribute('src', '/images/catalog/headphones.jpg');
      await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
      await expect(section.getByTestId('product-image-fallback')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await section.screenshot({ path: path.join(output, `top-products-${width}.png`) });
    }
    await page.route('**/images/catalog/headphones.jpg', route => route.abort());
    await page.reload();
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByTestId('product-image-fallback')).toHaveCount(2);
    await section.screenshot({ path: path.join(output, 'top-products-broken-image.png') });
    console.log('PASS: loaded catalog photo, missing/broken photo fallbacks, no overflow at 390/768/1440.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
