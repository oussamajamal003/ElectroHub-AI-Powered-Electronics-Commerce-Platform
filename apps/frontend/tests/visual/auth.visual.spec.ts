import { test } from '@playwright/test';

test.describe('Authentication Visual QA', () => {

  test('Customer Header', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 911 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Capture ONLY the Header region/element
    const header = page.locator('header');
    await header.waitFor({ state: 'visible' });
    await header.screenshot({ path: 'screenshots/actual/customer-header.png' });
  });

  test('Customer Login', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 911 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click the Account link
    await page.click('a:has-text("Account")', { force: true });
    
    // Wait for the modal dialog to appear
    await page.waitForSelector('[role="dialog"]');
    await page.waitForTimeout(300);
    
    // Unfocus input so focus-ring doesn't create synthetic diff with unfocused Figma mockup
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(200);
    
    await page.screenshot({ path: 'screenshots/actual/customer-login.png' });
  });

  test('Customer Register', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 907 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Click the Account link
    await page.click('a:has-text("Account")', { force: true });
    
    // Wait for the login dialog
    await page.waitForSelector('[role="dialog"]');
    
    // Click Register link/button inside the login modal to switch
    await page.click('[role="dialog"] button:has-text("Register"), [role="dialog"] span:has-text("Register")', { force: true });
    
    // Wait for the register dialog
    await page.waitForSelector('[role="dialog"] h2:has-text("Create Account")');
    await page.waitForTimeout(300);
    
    // Unfocus input
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(200);
    
    await page.screenshot({ path: 'screenshots/actual/customer-register.png' });
  });

  test('Admin Login', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 904 });
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle');
    
    // Unfocus input
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(200);
    
    await page.screenshot({ path: 'screenshots/actual/admin-login.png' });
  });

  test('Mobile Sidebar Expand and Collapse', async ({ page }) => {
    // iPad Mini width: 768px
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Closed state
    await page.screenshot({ path: 'screenshots/actual/mobile-sidebar-closed.png' });

    // Expand mobile menu
    const menuToggle = page.locator('button[aria-label="Open navigation menu"]');
    await menuToggle.waitFor({ state: 'visible' });
    await menuToggle.click();

    // Wait for mobile menu to appear in flow
    await page.waitForSelector('nav[aria-label="Mobile Navigation"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'screenshots/actual/mobile-sidebar-expanded.png' });

    // Collapse mobile menu
    const closeToggle = page.locator('button[aria-label="Close navigation menu"]');
    await closeToggle.click();

    // Ensure menu is removed and layout restored
    await page.locator('nav[aria-label="Mobile Navigation"]').waitFor({ state: 'detached' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'screenshots/actual/mobile-sidebar-restored.png' });
  });

});
