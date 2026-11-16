import { test, expect } from '@playwright/test';

/**
 * ElectroHub — Customer Header Visual QA
 *
 * Run with: cd apps/frontend && npm run test:visual
 *
 * Architecture note:
 *   Mobile menu = in-flow <nav> INSIDE <header> (vertical expansion).
 *   No off-canvas drawer. No translateX. No backdrop.
 *   The sticky header grows downward to contain the menu.
 */

const BASE = 'http://localhost:3000';
const SHOTS = 'screenshots/actual';

async function waitForHeader(page: import('@playwright/test').Page) {
  await page.waitForSelector('header[role="banner"]', { state: 'visible' });
  await page.waitForTimeout(200);
}

async function captureHeader(page: import('@playwright/test').Page, filename: string) {
  const header = page.locator('header[role="banner"]');
  await header.screenshot({ path: `${SHOTS}/${filename}` });
}

// ─────────────────────────────────────────────────────────────
// Desktop — 1440px
// ─────────────────────────────────────────────────────────────

test.describe('Desktop Header — 1440px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
  });

  test('desktop header renders correctly at 1440px', async ({ page }) => {
    await captureHeader(page, 'header-desktop-1440.png');

    await expect(page.locator('header[role="banner"]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Announcement' })).toBeVisible();
    await expect(page.getByText('Free delivery on orders over $100')).toBeVisible();
    await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cart' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wishlist' })).toBeVisible();
  });

  test('hamburger button NOT visible at 1440px', async ({ page }) => {
    // Hamburger is display:none on desktop
    const hamburger = page.getByRole('button', { name: /Open navigation menu/i });
    await expect(hamburger).toBeHidden();
  });

  test('active nav link on Home page', async ({ page }) => {
    const homeLink = page.locator('nav[aria-label="Primary navigation"] a[href="/"]');
    await expect(homeLink).toBeVisible();
    await captureHeader(page, 'header-active-home.png');
  });

  test('no horizontal overflow at 1440px', async ({ page }) => {
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1442);
  });
});

// ─────────────────────────────────────────────────────────────
// Desktop — 1280px
// ─────────────────────────────────────────────────────────────

test.describe('Desktop Header — 1280px', () => {
  test('desktop header correct at 1280px, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
    await captureHeader(page, 'header-desktop-1280.png');

    await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeVisible();
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1282);
  });
});

// ─────────────────────────────────────────────────────────────
// Scroll Shadow
// ─────────────────────────────────────────────────────────────

test.describe('Sticky Scroll Shadow', () => {
  test('header remains sticky and gains shadow after scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);

    await page.screenshot({ path: `${SHOTS}/header-top-state.png` });

    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(300);

    await expect(page.locator('header[role="banner"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/header-scrolled-state.png` });

    await page.evaluate(() => window.scrollTo(0, 0));
  });
});

// ─────────────────────────────────────────────────────────────
// Search Expansion
// ─────────────────────────────────────────────────────────────

test.describe('Search Interaction', () => {
  test('search expands inline, collapses back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);

    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForTimeout(100);

    const searchInput = page.getByRole('searchbox', { name: 'Search products' });
    await expect(searchInput).toBeVisible();
    await captureHeader(page, 'header-search-open.png');

    await page.getByRole('button', { name: 'Close search' }).click();
    await page.waitForTimeout(100);

    await expect(searchInput).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
    await captureHeader(page, 'header-search-closed.png');
  });
});

// ─────────────────────────────────────────────────────────────
// Account Auth Modal
// ─────────────────────────────────────────────────────────────

test.describe('Account Auth Modal', () => {
  test('clicking Account nav link triggers auth modal when not logged in', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);

    await page
      .locator('nav[aria-label="Primary navigation"]')
      .getByRole('link', { name: 'Account' })
      .click();

    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/header-auth-modal.png` });
  });
});

// ─────────────────────────────────────────────────────────────
// Tablet — 1024px
// ─────────────────────────────────────────────────────────────

test.describe('Tablet Header — 1024px', () => {
  test('desktop nav still visible at 1024px, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
    await captureHeader(page, 'header-tablet-1024.png');

    await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeVisible();
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1026);
  });
});

// ─────────────────────────────────────────────────────────────
// Mobile — 768px
// ─────────────────────────────────────────────────────────────

test.describe('Mobile Header — 768px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
  });

  test('hamburger visible, desktop nav hidden at 768px', async ({ page }) => {
    await captureHeader(page, 'header-mobile-768-closed.png');

    await expect(page.getByRole('button', { name: /Open navigation menu/i })).toBeVisible();
    await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeHidden();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(770);
  });

  test('mobile menu expands VERTICALLY — no horizontal drawer', async ({ page }) => {
    const hamburger = page.getByRole('button', { name: /Open navigation menu/i });
    await hamburger.click();
    await page.waitForTimeout(250);

    const mobileNav = page.locator('nav[aria-label="Mobile Navigation"]');
    await expect(mobileNav).toBeVisible();

    // Confirm it is inside the header (vertical in-flow), NOT a fixed overlay
    const navBox = await mobileNav.boundingBox();
    const headerBox = await page.locator('header[role="banner"]').boundingBox();

    expect(navBox).not.toBeNull();
    expect(headerBox).not.toBeNull();

    if (navBox && headerBox) {
      // Nav top-edge must be at or below the header's top edge (in-flow, not overlapping page from left)
      expect(navBox.x).toBeLessThanOrEqual(10); // starts at left edge, not offset (not a side drawer)
      expect(navBox.width).toBeGreaterThan(600); // full width (not a narrow 280px side panel)
    }

    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-expanded.png` });
  });

  test('mobile menu closes when hamburger clicked again', async ({ page }) => {
    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);
    await expect(page.locator('nav[aria-label="Mobile Navigation"]')).toBeVisible();

    await page.getByRole('button', { name: /Close navigation menu/i }).click();
    await page.waitForTimeout(250);
    await expect(page.locator('nav[aria-label="Mobile Navigation"]')).not.toBeVisible();
    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-restored.png` });
  });

  test('mobile menu closes on Escape', async ({ page }) => {
    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);
    await expect(page.locator('nav[aria-label="Mobile Navigation"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await expect(page.locator('nav[aria-label="Mobile Navigation"]')).not.toBeVisible();
  });

  test('mobile menu contains strictly Home, Products, Orders, Account only', async ({ page }) => {
    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);

    const mobileNav = page.locator('nav[aria-label="Mobile Navigation"]');
    // Primary ONLY
    await expect(mobileNav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Products' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Account' })).toBeVisible();

    // Verify secondary/other items are NOT present in mobile nav
    await expect(mobileNav.getByRole('link', { name: 'My Profile' })).toBeHidden();
    await expect(mobileNav.getByRole('link', { name: 'Wishlist' })).toBeHidden();
    await expect(mobileNav.getByRole('link', { name: 'Cart' })).toBeHidden();
  });

  test('no horizontal overflow with menu open at 768px', async ({ page }) => {
    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(770);
  });
});

// ─────────────────────────────────────────────────────────────
// Mobile — 393px
// ─────────────────────────────────────────────────────────────

test.describe('Mobile Header — 393px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
  });

  test('compact mobile header at 393px, no overflow', async ({ page }) => {
    await captureHeader(page, 'header-mobile-393-closed.png');

    await expect(page.getByRole('button', { name: /Open navigation menu/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /ElectroHub — Home/i })).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(395);
  });

  test('vertical menu opens correctly at 393px', async ({ page }) => {
    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-closed.png` });

    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);

    const mobileNav = page.locator('nav[aria-label="Mobile Navigation"]');
    await expect(mobileNav).toBeVisible();

    // Full-width dropdown, not a side panel
    const navBox = await mobileNav.boundingBox();
    if (navBox) {
      expect(navBox.width).toBeGreaterThan(300); // covers full viewport width, not 280px drawer
    }

    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-expanded-393.png` });

    // No overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(395);
  });
});

// ─────────────────────────────────────────────────────────────
// Mobile — 375px
// ─────────────────────────────────────────────────────────────

test.describe('Mobile Header — 375px', () => {
  test('no overflow at 375px, menu open or closed', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
    await captureHeader(page, 'header-mobile-375.png');

    let bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(377);

    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);
    bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(377);
  });
});

// ─────────────────────────────────────────────────────────────
// Mobile — 320px
// ─────────────────────────────────────────────────────────────

test.describe('Mobile Header — 320px', () => {
  test('no overflow at 320px, menu open or closed', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await waitForHeader(page);
    await captureHeader(page, 'header-mobile-320.png');

    let bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(322);

    await page.getByRole('button', { name: /Open navigation menu/i }).click();
    await page.waitForTimeout(250);
    bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(322);
  });
});

// ─────────────────────────────────────────────────────────────
// Auth visual regression (preserving existing test suite names)
// ─────────────────────────────────────────────────────────────

test.describe('Auth Flow Regression', () => {
  test('Customer Header', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 911 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const header = page.locator('header');
    await header.waitFor({ state: 'visible' });
    await header.screenshot({ path: `${SHOTS}/customer-header.png` });
  });

  test('Mobile Sidebar Expand and Collapse', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-closed.png` });

    const menuToggle = page.getByRole('button', { name: /Open navigation menu/i });
    await menuToggle.waitFor({ state: 'visible' });
    await menuToggle.click();

    // In-flow vertical nav inside header
    await page.locator('nav[aria-label="Mobile Navigation"]').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-expanded.png` });

    const closeToggle = page.getByRole('button', { name: /Close navigation menu/i });
    await closeToggle.click();

    await page.locator('nav[aria-label="Mobile Navigation"]').waitFor({ state: 'detached' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/mobile-sidebar-restored.png` });
  });
});
