import { expect, request, test, type Browser, type Page } from '@playwright/test';
import { admins, apiOrigin, distinctClientAddress, expectNoHorizontalOverflow, product, shopper, signInAdmin, signInCustomer,
  slot } from './support';

/**
 * Administrator workflows on the real stack: mandatory MFA sign-in, console pages, inventory changes reaching the storefront
 * (Journey B), delivery updates reaching the customer's live tracking page (Journey C), the Owner/staff capability boundary, and
 * sign-out. Each browser project uses its own Owner and staff administrator and its own product, so projects never contend.
 */
test.describe.configure({ mode: 'serial' });

/** Per-project stock product: never one whose stock level another spec asserts on. */
const stockProduct = (projectSlot: string) =>
  product(({ chromium: 'REL-NIMBUS-14', firefox: 'REL-VECTOR-16' } as Record<string, string>)[projectSlot] ?? 'REL-ATLAS-DOCK');

/** Up to tablet width the admin sidebar is a drawer behind "Open navigation"; on desktop it is always shown. */
async function openMainNavigation(page: Page) {
  const toggle = page.getByRole('button', { name: 'Open navigation' });
  if (await toggle.isVisible()) await toggle.click();
}

/** What an anonymous shopper is offered on the product page, read in a fresh context. */
async function availableToAdd(browser: Browser, slug: string) {
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(`/products/${slug}`);
  // An empty Cart: the exact sellable quantity the server reports ("12 available" / "Only 3 left"); Add to Cart reserves nothing.
  const text = await guest.getByTestId('product-available-quantity').innerText();
  await context.close();
  return Number(text.match(/(\d+)/)?.[1]);
}

test.describe('administrator console', () => {
  test.beforeEach(async ({ page }, testInfo) => { await distinctClientAddress(page, testInfo); });

  test('@responsive the Owner signs in with MFA and the console pages render real data without overflow', async ({ page }, testInfo) => {
    // Nine full console pages in one test: ~30 s alone on Firefox, but over 90 s when three browser engines share a machine.
    test.slow();
    await signInAdmin(page, admins(testInfo).ownerEmail);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Key figures' })).toContainText('Paid revenue');
    await expectNoHorizontalOverflow(page, 'admin dashboard');
    for (const [url, heading] of [['/admin/products', 'Products'], ['/admin/inventory', 'Inventory'], ['/admin/orders', 'Orders'],
      ['/admin/deliveries', /Deliver/], ['/admin/customers', 'Customers'], ['/admin/recommendations', 'Recommendations'],
      ['/admin/analytics', 'Analytics'], ['/admin/settings', 'Settings']] as const) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1, name: heading }), url).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: /something went wrong|failed to load/i }), url).toHaveCount(0);
      await expectNoHorizontalOverflow(page, url);
    }
    // The seeded order for this project is shown with its authoritative state.
    const reference = shopper(testInfo, 'admin').orderReference;
    await page.goto(`/admin/orders/${reference}`);
    await expect(page.getByRole('heading', { level: 1, name: reference })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Fulfillment' })).toBeVisible();
    await openMainNavigation(page);
    await expect(page.getByRole('link', { name: 'Inventory' }).first()).toBeVisible();
  });

  test('Journey B: a stock adjustment in Inventory is what the storefront offers, and is reverted', async ({ page, browser }, testInfo) => {
    const item = stockProduct(slot(testInfo));
    const before = await availableToAdd(browser, item.slug);
    expect(before).toBeGreaterThan(0);
    await signInAdmin(page, admins(testInfo).ownerEmail);
    await page.goto('/admin/inventory');
    await page.getByRole('searchbox', { name: 'Search inventory' }).fill(item.sku);
    const adjust = async (units: number, label: 'Add stock' | 'Remove stock') => {
      await page.getByRole('button', { name: `Adjust stock for ${item.name}` }).click();
      const dialog = page.getByRole('dialog', { name: 'Adjust stock' });
      await dialog.getByLabel('Units to add or remove').fill(String(units));
      await dialog.getByLabel('Reason (optional)').fill('Task 06.1 release check');
      await dialog.getByRole('button', { name: label }).click();
      await expect(dialog).toBeHidden();
    };
    await adjust(3, 'Add stock');
    await expect.poll(() => availableToAdd(browser, item.slug)).toBe(before + 3);
    await adjust(-3, 'Remove stock');
    await expect.poll(() => availableToAdd(browser, item.slug)).toBe(before);
  });

  test('Journey C: a delivery update by the Owner reaches the customer tracking page live', async ({ page, browser }, testInfo) => {
    const buyer = shopper(testInfo, 'admin');
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    await distinctClientAddress(customer, testInfo);
    await signInCustomer(customer, buyer.email);
    await customer.goto(`/orders/${buyer.orderReference}/tracking`);
    await expect(customer.getByText(/Live updates on/)).toBeVisible();

    await signInAdmin(page, admins(testInfo).ownerEmail);
    await page.goto(`/admin/deliveries/${buyer.orderReference}`);
    // A paid order starts untracked; "Start tracking" creates the delivery (revision 1) exactly as in production.
    const start = page.getByRole('button', { name: 'Start tracking' });
    const update = page.getByRole('form', { name: 'Update delivery' });
    const complete = page.getByText('This order has been delivered. Its tracking is complete and can no longer change.');
    await expect(start.or(update).or(complete)).toBeVisible();
    // Each run advances this stack's seeded order one step; a fresh stack start (as in CI) reseeds a new, untracked order.
    expect(await complete.isVisible(), 'seeded order already delivered: restart the release stack to reseed').toBe(false);
    if (await start.isVisible()) await start.click();
    await expect(update).toBeVisible();
    const state = page.getByRole('region', { name: 'Current tracking state' });
    const fact = (term: string) => state.getByRole('term').filter({ hasText: term }).locator('xpath=following-sibling::*[1]');
    await expect(fact('Tracking reference')).not.toHaveText('Not started');
    const revision = Number(await fact('Revision').innerText());
    // A retry may find the order one step further along, so always take the server's allowed next step.
    const next = (await fact('Allowed next status').innerText()).trim();
    expect(['Preparing', 'Out for delivery', 'Delivered']).toContain(next);
    await page.getByRole('combobox', { name: 'Next status' }).click();
    await page.getByRole('option', { name: `Move to ${next}`, exact: true }).click();
    await page.getByRole('button', { name: 'Review update' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm delivery update' });
    await expect(confirm).toContainText(next);
    await confirm.getByRole('button', { name: 'Confirm update' }).click();
    await expect(confirm).toBeHidden();
    // The server accepted exactly one new revision (not just a UI echo), and the authoritative status is the new one. Delivering
    // replaces the form with the completed notice, so the check reads the server-backed state panel rather than the form.
    await expect(fact('Revision')).toHaveText(String(revision + 1));
    await expect(fact('Delivery status')).toHaveText(next);

    // No reload on the customer side: the change arrives over the live channel.
    await expect(customer.getByRole('region', { name: 'Delivery overview' })).toContainText(next, { timeout: 20_000 });
    const anonymous = await request.newContext({ baseURL: apiOrigin });
    expect([401, 404]).toContain((await anonymous.get(`/api/orders/${buyer.orderReference}/delivery`)).status());
    await anonymous.dispose();
    await customerContext.close();
  });

  test('staff administrators cannot manage administrators; the Owner can; anonymous admin APIs are refused', async ({ page, browser }, testInfo) => {
    const { ownerEmail, staffEmail } = admins(testInfo);
    await signInAdmin(page, staffEmail);
    await page.goto('/admin/settings/administrators');
    await expect(page.getByRole('heading', { level: 1, name: 'Access Restricted' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Administrators' })).toHaveCount(0);

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await distinctClientAddress(owner, testInfo);
    await signInAdmin(owner, ownerEmail);
    await owner.goto('/admin/settings/administrators');
    await expect(owner.getByRole('table', { name: 'Administrators' }).getByRole('row').filter({ hasText: staffEmail })).toBeVisible();
    // The Owner cannot change their own administrator-management access.
    await expect(owner.getByRole('switch', { name: `Manage administrators for ${ownerEmail}` })).toBeDisabled();
    await ownerContext.close();

    const anonymous = await request.newContext({ baseURL: apiOrigin });
    for (const endpoint of ['/api/admin/administrators', '/api/admin/dashboard', '/api/admin/orders']) {
      expect((await anonymous.get(endpoint)).status(), endpoint).toBe(401);
    }
    await anonymous.dispose();
  });

  test('signing out ends the admin session and the console requires sign-in again', async ({ page }, testInfo) => {
    await signInAdmin(page, admins(testInfo).staffEmail);
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Sign out of ElectroHub?' }).or(page.getByRole('dialog', { name: 'Sign out of ElectroHub?' }));
    await confirm.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin/orders');
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole('heading', { name: 'Sign In to Admin' })).toBeVisible();
  });
});
