import { expect, request, test, type Page } from '@playwright/test';
import { apiOrigin, distinctClientAddress, expectNoHorizontalOverflow, money, product } from './support';

/**
 * Search, search suggestions, product details and recommendation surfaces against the real catalog API and disposable database.
 * Expected values come from the seeded rows (and are re-read from the API), never from hard-coded production names.
 */
const headphones = () => product('REL-AURORA-HP');
const speakers = () => product('REL-ECHO-SPK');
const earbuds = () => product('REL-PULSE-EB');

async function openSearch(page: Page) {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search ElectroHub' });
  await expect(dialog).toBeVisible();
  return { dialog, box: dialog.getByRole('combobox', { name: 'Search products' }) };
}

test.describe('search and suggestions', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); await page.goto('/'); });

  test('@responsive suggestions follow the newest query, support arrow keys and Enter, and Escape dismisses', async ({ page }) => {
    const { dialog, box } = await openSearch(page);
    // Rapid typing: the final suggestions reflect the last query only (stale responses never win).
    await box.pressSequentially('lap', { delay: 15 });
    await box.fill('');
    await box.pressSequentially('auro', { delay: 15 });
    const listbox = dialog.getByRole('listbox', { name: 'Search suggestions' });
    await expect(listbox.getByRole('option', { name: new RegExp(headphones().name) })).toBeVisible();
    await expect(listbox.getByRole('option', { name: /Laptop|Ultrabook/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, 'search dialog');

    await box.press('ArrowDown');
    await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
    await box.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/products/${headphones().slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: headphones().name })).toBeVisible();

    const reopened = await openSearch(page);
    await reopened.box.fill('nimbus');
    await expect(reopened.dialog.getByRole('listbox', { name: 'Search suggestions' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reopened.dialog).toBeHidden();
  });

  test('submitting a query shows ranked results and products navigate to their details', async ({ page }) => {
    const { dialog, box } = await openSearch(page);
    await box.fill('laptop');
    await dialog.getByRole('button', { name: 'View all results for “laptop”' }).click();
    await expect(page).toHaveURL(/\/(search|products)\?.*laptop/i);
    const cards = page.getByTestId('product-card');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vector 16 Creator Laptop' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: headphones().name })).toHaveCount(0);
    await page.getByRole('link', { name: 'Vector 16 Creator Laptop' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vector 16 Creator Laptop' })).toBeVisible();
    // Browser history returns to the same results.
    await page.goBack();
    await expect(page.getByRole('link', { name: 'Vector 16 Creator Laptop' }).first()).toBeVisible();
  });

  test('a query without matches shows the empty state, and clearing the query resets it', async ({ page }) => {
    const { dialog, box } = await openSearch(page);
    await box.fill('zzqv-no-such-product');
    await expect(dialog.getByRole('status')).toHaveText('0 suggestions');
    await expect(dialog.getByRole('option')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear search' }).click();
    await expect(box).toHaveValue('');
    await expect(box).toBeFocused();
    await box.fill('zzqv-no-such-product');
    await dialog.getByRole('button', { name: /^View all results for/ }).click();
    await expect(page.getByTestId('product-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /no (products|results)/i }).first()).toBeVisible();
  });

  test('a failing search API produces a truthful error instead of a false empty result', async ({ page }) => {
    await page.route('**/api/search/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }));
    const { dialog, box } = await openSearch(page);
    await box.fill('aurora');
    await expect(dialog.getByText(/couldn.t|could not|unavailable|try again/i).first()).toBeVisible();
    await expect(dialog.getByRole('option', { name: new RegExp(headphones().name) })).toHaveCount(0);
  });
});

test.describe('product details', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  test('@responsive shows the server product identity, price, specifications, stock and recommendations', async ({ page }) => {
    const api = await request.newContext({ baseURL: apiOrigin });
    const body = await (await api.get(`/api/products/${headphones().slug}`)).json() as { data: { name: string; price: string | number; sku: string } };
    await api.dispose();
    expect(body.data.sku).toBe(headphones().sku);

    await page.goto(`/products/${headphones().slug}`);
    const summary = page.getByRole('region', { name: headphones().name });
    await expect(summary.getByRole('heading', { level: 1 })).toHaveText(body.data.name);
    await expect(summary.getByText(`SKU: ${headphones().sku}`)).toBeVisible();
    await expect(summary.getByText(money(Number(body.data.price)), { exact: true })).toBeVisible();
    await expect(summary.getByText('In Stock')).toBeVisible();
    // Exact sellable quantity from the server; with nothing in this Cart there is no separate cart-relative line.
    await expect(summary.getByTestId('product-available-quantity')).toHaveText(`${headphones().quantity} available`);
    await expect(summary.getByText(/more items? available to add/)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Specifications' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Specifications' })).toContainText('40 mm dynamic');
    // Recommendation surface (category-based "More in …"): real catalog products, never the current one.
    const more = page.getByRole('region', { name: 'More in Release Audio' });
    await expect(more.getByRole('link', { name: earbuds().name })).toBeVisible();
    await expect(more.getByRole('link', { name: headphones().name, exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, 'product details');
    await more.getByRole('link', { name: earbuds().name }).click();
    await expect(page.getByRole('heading', { level: 1, name: earbuds().name })).toBeVisible();
  });

  test('quantity is bounded by available stock and out-of-stock products cannot be added', async ({ page }) => {
    await page.goto(`/products/${earbuds().slug}`);
    const increase = page.getByRole('button', { name: `Increase quantity for ${earbuds().name}` });
    const decrease = page.getByRole('button', { name: `Decrease quantity for ${earbuds().name}` });
    await expect(decrease).toBeDisabled();
    for (let index = 1; index < earbuds().quantity; index++) await increase.click();
    await expect(increase).toBeDisabled();
    await expect(page.getByRole('group', { name: 'Quantity selector' })).toContainText(String(earbuds().quantity));

    await page.goto(`/products/${speakers().slug}`);
    await expect(page.getByText('Out of Stock').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  });

  test('an unknown product slug renders a not-found state, not a crash', async ({ page }) => {
    const response = await page.goto('/products/release-no-such-product');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: /not found|unavailable|doesn.t exist/i }).first()).toBeVisible();
  });
});
