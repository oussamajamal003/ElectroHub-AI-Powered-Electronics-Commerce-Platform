import { expect, test } from '@playwright/test';

// Product-discovery toolbar: alignment, auto-apply filtering, sort menu, keyboard and overflow checks at 390 / 768 / 1440 / 1920.
const SHOTS = 'playwright-report/discovery-toolbar';
for (const width of [390, 768, 1440, 1920] as const) {
  test.describe(`discovery toolbar @ ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });

    test('controls share one height and never overflow', async ({ page }) => {
      await page.goto('/products');
      await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
      const search = page.getByRole('combobox', { name: 'Search products' });
      const filters = page.getByRole('button', { name: /^Filters/ });
      const sort = page.getByRole('combobox', { name: 'Sort by' });
      const [s, f, o] = await Promise.all([search.boundingBox(), filters.boundingBox(), sort.boundingBox()]);
      expect(Math.round(s!.height)).toBe(Math.round(f!.height));
      expect(Math.round(f!.height)).toBe(Math.round(o!.height));
      if (width >= 1024) { expect(Math.abs(s!.y - f!.y)).toBeLessThan(2); expect(Math.abs(f!.y - o!.y)).toBeLessThan(2); }
      else expect(Math.abs(f!.y - o!.y)).toBeLessThan(2);
      await expect(page.getByText('Sort by', { exact: true })).toHaveCount(0); // no floating visible label
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/toolbar-${width}.png`, clip: { x: 0, y: 0, width, height: 420 } });
    });

    test('filters apply automatically, sort menu, reset, URL state, keyboard', async ({ page }) => {
      await page.goto('/products');
      await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
      const trigger = page.getByRole('button', { name: /^Filters/ });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: /apply filters/i })).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Availability' }).click();
      await page.getByRole('option', { name: 'Available', exact: true }).click();
      await expect(page).toHaveURL(/availability=available/);
      await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/panel-open-${width}.png` });
      await page.getByRole('combobox', { name: 'Sort by' }).click();
      await expect(page.getByRole('option', { name: 'Newest' })).toHaveAttribute('data-state', 'checked');
      await page.screenshot({ path: `${SHOTS}/sort-open-${width}.png` });
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: 'Sort by' }).click();
      await page.getByRole('option', { name: 'Price: low to high' }).click();
      await expect(page).toHaveURL(/sort=price-asc/);
      await page.getByLabel('Min price ($)').fill('100');
      await expect(page).toHaveURL(/minPrice=100/, { timeout: 5000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Clear all filters' }).click();
      await expect(page).not.toHaveURL(/availability=|minPrice=/);
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });
}

test.describe('discovery toolbar: races and reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('rapid sort changes with out-of-order responses settle on the last choice', async ({ page }) => {
    // Earlier requests are held back longest, so they resolve AFTER the final one — a stale-response race.
    const delays = [2500, 1500, 0];
    let seen = 0;
    await page.route('**/api/search/products**', async route => {
      const delay = delays[Math.min(seen++, delays.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delay));
      await route.continue().catch(() => undefined);
    });
    await page.goto('/products');
    await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
    seen = 0;
    const sort = page.getByRole('combobox', { name: 'Sort by' });
    for (const option of ['Price: low to high', 'Price: high to low', 'Name: A–Z']) {
      await sort.click();
      await page.getByRole('option', { name: option }).click();
    }
    await expect(page).toHaveURL(/sort=name-asc/);
    await page.waitForTimeout(4000); // let every slow, stale response land
    await expect(sort).toHaveText('Name: A–Z');
    const names = await page.getByTestId('product-card').locator('h3, h2').allInnerTexts();
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    expect(names.slice(0, 8)).toEqual(sorted.slice(0, 8));
    await expect(page.getByRole('heading', { name: /Search unavailable|No products found/ })).toHaveCount(0);
  });

  test('reduced motion disables the panel animation and chevron/trigger transitions', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/products');
    await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
    const trigger = page.getByRole('button', { name: /^Filters/ });
    await trigger.click();
    const panel = page.locator('#search-filters');
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    // A global reduced-motion rule may clamp to 0.00001s rather than 0s; either is effectively instant.
    const duration = await trigger.locator('svg').last().evaluate(element => getComputedStyle(element).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    await context.close();
    // Control: with motion allowed the same panel does animate.
    const normal = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const normalPage = await normal.newPage();
    await normalPage.goto('/products');
    await expect(normalPage.getByTestId('product-card').first()).toBeVisible({ timeout: 30000 });
    await normalPage.getByRole('button', { name: /^Filters/ }).click();
    expect(await normalPage.locator('#search-filters').evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
    await normal.close();
  });
});
