import { expect, test } from '@playwright/test';

for (const width of [390, 768, 1440, 1920]) {
  test(`company pages and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Technology made simple.' })).toBeVisible();
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < pageHeight; y += 600) {
      await page.evaluate(position => window.scrollTo(0, position), y);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(750);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/about-${width}.png`, fullPage: true });
    await expect(page.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
    await page.getByRole('link', { name: 'Explore Products' }).click();
    await expect(page).toHaveURL(/\/products$/);
    await page.goto('/contact', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: "Let's talk" })).toBeVisible();
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByText('Name is required.')).toBeVisible();
    await page.getByLabel('Name').fill('Demo User');
    await page.getByLabel('Email').fill('demo@example.com');
    await page.getByLabel('Subject').fill('Question');
    await page.getByLabel('Message').fill('Hello');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.getByRole('status')).toContainText('not connected to a delivery service');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/contact-${width}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    if (width <= 820) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await expect(page.getByRole('navigation', { name: 'Mobile Navigation' }).getByRole('link', { name: 'About' })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'About' })).toBeVisible();
    }
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
  });
}

test('Home hero entrance plays on fresh load and stays static on return', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const hero = page.locator('section[aria-labelledby="home-title"]');
  await expect(hero).toBeVisible();
  await expect(hero).toHaveClass(/heroEntrance/);
  await page.screenshot({ path: 'test-results/home-hero.png' });
  await page.waitForTimeout(2100);
  await page.getByRole('link', { name: 'Shop Now' }).click();
  await page.goBack();
  await expect(hero).toBeVisible();
  const active = await hero.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'));
  expect(active).toBe(false);
});

test('reduced motion leaves hero content visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Next-gen tech/ })).toBeVisible();
  const duration = await page.locator('[data-hero-part="heading"]').evaluate(element => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.001);
});

test('Home reveals once and footer section links reach their targets', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('heading', { name: 'Shop by Category' });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading.locator('xpath=../..')).toHaveClass(/visible/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await heading.scrollIntoViewIfNeeded();
  await expect(heading.locator('xpath=../..')).toHaveClass(/visible/);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Deals' }).click();
  await expect(page).toHaveURL(/#deals-title$/);
  await expect(page.getByRole('heading', { name: 'Featured Deals' })).toBeInViewport();
});
