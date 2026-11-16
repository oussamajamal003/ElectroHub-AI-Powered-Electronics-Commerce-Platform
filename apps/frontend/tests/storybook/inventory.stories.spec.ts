import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const stories = [
  'components-statusbadge--in-stock', 'components-statusbadge--low-stock', 'components-statusbadge--out-of-stock',
  'components-productcard--in-stock', 'components-productcard--low-stock', 'components-productcard--out-of-stock', 'components-productcard--unavailable', 'components-productcard--saved-out-of-stock',
  'customer-product-purchase-actions--in-stock', 'customer-product-purchase-actions--low-stock', 'customer-product-purchase-actions--out-of-stock', 'customer-product-purchase-actions--unavailable', 'customer-product-purchase-actions--at-maximum', 'customer-product-purchase-actions--loading', 'customer-product-purchase-actions--added', 'customer-product-purchase-actions--stock-shrink',
  'customer-cart-page--low-stock', 'customer-cart-page--exact-stock', 'customer-cart-page--unavailable', 'customer-cart-page--mixed-stock',
  'customer-wishlist-page--in-stock', 'customer-wishlist-page--low-stock', 'customer-wishlist-page--out-of-stock', 'customer-wishlist-page--mixed-stock',
];
for (const story of stories) test(`${story} inventory semantics, layout and axe`, async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto(`/iframe.html?id=${story}&viewMode=story`);
  await expect(page.locator('#storybook-root > *').first()).toBeVisible();
  const canvas = page.locator('#storybook-root');
  if (story === 'components-productcard--unavailable') {
    await expect(canvas.getByText('Unavailable', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByText('Out of Stock', { exact: true })).toHaveCount(0);
    await expect(canvas.getByRole('button', { name: /Add .* to cart/ })).toBeDisabled();
  }
  if (story === 'components-productcard--out-of-stock') {
    await expect(canvas.getByText('Out of Stock', { exact: true }).first()).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Add .* to cart/ })).toBeDisabled();
  }
  if (story === 'customer-product-purchase-actions--unavailable') {
    await expect(canvas.getByText('Unavailable', { exact: true })).toBeVisible();
    await expect(canvas.getByText('Out of Stock', { exact: true })).toHaveCount(0);
    await expect(canvas.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  }
  if (story === 'customer-product-purchase-actions--out-of-stock') {
    await expect(canvas.getByText('Out of Stock', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  }
  if (story === 'customer-cart-page--unavailable') {
    await expect(canvas.getByText('Out of Stock', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Increase quantity/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /Decrease quantity/ })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /Remove .* from cart/ })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Sign in to Checkout' })).toBeDisabled();
  }
  await page.addScriptTag({ content: `const previousInventoryAxe = window.axe; ${readFileSync('../../node_modules/axe-core/axe.min.js', 'utf8')}\nwindow.__inventoryAxe = window.axe; window.axe = previousInventoryAxe;` });
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const violations = await page.evaluate(async () => {
      const axe = (window as Window & { __inventoryAxe: { run: (selector: string, options: object) => Promise<{ violations: { id: string }[] }> } }).__inventoryAxe;
      return (await axe.run('#storybook-root', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(value => value.id);
    });
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(requests).toEqual([]);
});
