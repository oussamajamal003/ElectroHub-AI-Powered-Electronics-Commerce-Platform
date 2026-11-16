// Run against the local frontend: node scripts/administrators-loading-qa.cjs
// All API requests are mocked; this never signs in or changes server data.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    fs.mkdirSync('.cache/administrators-loading', { recursive: true });
    for (const width of [1920, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on('pageerror', error => console.error('Browser error:', error.message));
      const user = { id: 'loading-qa', email: 'qa@example.invalid', firstName: 'Admin', lastName: 'QA', role: 'ADMIN', emailVerified: true };
      let release;
      const profileGate = new Promise(resolve => { release = resolve; });
      await page.route(/^http:\/\/localhost:3000\/api\//, async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/admin/me/profile') {
          await profileGate;
          return route.fulfill({ json: { data: { ...user, capabilities: { isOwner: false, canManageAdmins: true } } } });
        }
        if (path === '/api/auth/admin/refresh') return route.fulfill({ json: { accessToken: 'mock-browser-token' } });
        if (path === '/api/auth/me') return route.fulfill({ json: { user } });
        return route.fulfill({ json: { data: [], meta: { page: 1, totalPages: 1, total: 0, limit: 20 } } });
      });
      await page.goto('http://localhost:3000/admin/settings/administrators');
      const loading = page.getByRole('status', { name: 'Loading administrators', exact: true });
      await expect(loading).toBeVisible({ timeout: 30000 }).catch(async error => {
        await page.screenshot({ path: `.cache/administrators-loading/failure-${width}.png` });
        console.error('Page:', page.url(), (await page.locator('body').innerText()).slice(0, 1200));
        throw error;
      });
      await expect(loading.locator('tbody tr')).toHaveCount(4);
      await expect(page.getByRole('button', { name: 'Invite administrator' })).toHaveCount(0);
      await page.screenshot({ path: `.cache/administrators-loading/pending-${width}.png`, fullPage: true });
      release();
      await expect(loading).toHaveCount(0);
      await expect(page.getByText('No administrators to show')).toBeVisible();
      await page.getByRole('combobox', { name: 'Status' }).click();
      await expect(page.getByRole('option', { name: 'Pending', exact: true })).toBeVisible();
      await page.screenshot({ path: `.cache/administrators-loading/dropdown-${width}.png` });
      await page.getByRole('option', { name: 'Accepted', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText('Accepted');
      const settingsCrumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Settings', exact: true });
      await expect(settingsCrumb).toHaveAttribute('href', '/admin/settings');
      await settingsCrumb.click();
      await expect(page).toHaveURL('http://localhost:3000/admin/settings');
      console.log(`${width}px: pending skeleton and loaded transition passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
