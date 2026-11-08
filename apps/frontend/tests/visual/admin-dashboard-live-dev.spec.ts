import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * Task 05.1 live admin QA on shared DEV. Writes are limited to QA-tagged records:
 * one "QA 05.1" category (created, edited, deleted) and one "QA 05.1" draft product (created, edited, stock-adjusted, never published,
 * then permanently deleted at the end).
 * Orders and customers are read only. Credentials come only from the environment and are never logged.
 */
const enabled = process.env.EH_RUN_LIVE_ADMIN_DEV === 'true';
const adminEmail = process.env.EH_DEV_ADMIN_EMAIL;
const adminPassword = process.env.EH_DEV_ADMIN_PASSWORD;
const outDir = process.env.EH_LIVE_ADMIN_OUT;
const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 12);
const tag = `QA 05.1 ${stamp}`;
const sku = `QA-051-${stamp}`;

interface Problems { console: string[]; page: string[]; api: string[] }

function watch(page: Page): Problems {
  const problems: Problems = { console: [], page: [], api: [] };
  page.on('console', message => { if (message.type() === 'error') problems.console.push(message.text().slice(0, 200)); });
  page.on('pageerror', error => problems.page.push(`${error.name}: ${error.message.slice(0, 200)}`));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && response.status() >= 400 && url.pathname !== '/api/auth/admin/refresh') {
      problems.api.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    }
  });
  return problems;
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: outDir ? `${outDir}/${name}.png` : info.outputPath(`${name}.png`), fullPage: true });
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 }).catch(() => undefined);
}

async function login(page: Page) {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#admin-email').fill(adminEmail!);
  await page.locator('#admin-password').fill(adminPassword!);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL(url => url.pathname === '/admin');
}

test.describe.configure({ mode: 'serial' });

test('admin console: every route, responsive shell, QA catalog/inventory flow, read-only orders/customers', async ({ page }, info) => {
  test.skip(!enabled, 'Set EH_RUN_LIVE_ADMIN_DEV=true to opt into the live DEV admin check.');
  expect(adminEmail && adminPassword, 'EH_DEV_ADMIN_EMAIL / EH_DEV_ADMIN_PASSWORD are required.').toBeTruthy();
  const problems = watch(page);
  const report: Record<string, unknown> = { stamp };

  await login(page);
  await settle(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // Keyboard: the first Tab stop is the skip link and it moves focus to the main region.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('admin-main');

  // Route walk at 1440.
  const routes: Array<[string, string, RegExp]> = [
    ['dashboard', '/admin', /^Dashboard$/], ['products', '/admin/products', /^Products$/], ['product-new', '/admin/products/new', /^Add product$/],
    ['categories', '/admin/categories', /^Categories$/], ['inventory', '/admin/inventory', /^Inventory$/], ['orders', '/admin/orders', /^Orders$/],
    ['customers', '/admin/customers', /^Customers$/], ['deliveries', '/admin/deliveries', /Deliver/], ['not-found', '/admin/does-not-exist', /not found/i],
  ];
  const overflow: string[] = [];
  for (const [name, path, heading] of routes) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // The first visit to a lazy route can wait on a cold Vite transform.
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 60_000 });
    await settle(page);
    if (!await noHorizontalScroll(page)) overflow.push(`${name}@1440`);
    await shot(page, info, `1440-${name}`);
  }

  // Read-only detail pages from real DEV rows.
  await page.goto('/admin/orders', { waitUntil: 'domcontentloaded' });
  await settle(page);
  const firstOrder = page.getByRole('link', { name: /^Order ORD-/ }).first();
  let orderPath: string | null = null;
  if (await firstOrder.count()) {
    orderPath = await firstOrder.getAttribute('href');
    await firstOrder.click();
    // Router navigations are transitions: the list stays mounted until the lazy detail page resolves, so wait for the detail itself.
    await page.waitForURL(url => url.pathname === orderPath);
    await expect(page.getByRole('heading', { level: 1, name: /^ORD-/ })).toBeVisible({ timeout: 60_000 });
    await settle(page);
    await expect(page.getByRole('button', { name: /mark as paid|refund|cancel order/i })).toHaveCount(0);
    await shot(page, info, '1440-order-detail');
  }
  report.orderDetail = orderPath ? 'opened' : 'no orders on DEV';

  await page.goto('/admin/customers', { waitUntil: 'domcontentloaded' });
  await settle(page);
  const firstCustomer = page.locator('table a[href^="/admin/customers/"]').first();
  let customerPath: string | null = null;
  if (await firstCustomer.count()) {
    customerPath = await firstCustomer.getAttribute('href');
    await firstCustomer.click();
    await page.waitForURL(url => url.pathname === customerPath);
    await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await shot(page, info, '1440-customer-detail');
  }
  report.customerDetail = customerPath ? 'opened' : 'no customers on DEV';

  // QA category: create (hidden by default), edit, delete while unused.
  await page.goto('/admin/categories', { waitUntil: 'domcontentloaded' });
  await settle(page);
  // Remove empty categories left by an earlier interrupted run of this spec (exact "QA 05.1 <10 digits>" names only).
  const search = page.getByRole('search', { name: 'Search categories' }).getByRole('searchbox');
  await search.fill('QA 05.1');
  await settle(page);
  const leftovers: string[] = [];
  for (const name of await page.locator('table tbody strong').allTextContents()) {
    if (!/^QA 05\.1 \d{10}$/.test(name)) continue;
    const remove = page.getByRole('button', { name: `Delete ${name}`, exact: true });
    if (await remove.isDisabled()) continue;
    await remove.click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete category' }).click();
    await expect(page.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(0);
    leftovers.push(name);
  }
  report.removedLeftoverCategories = leftovers;
  await search.fill('');
  await page.getByRole('button', { name: 'Add category' }).click();
  const categoryDialog = page.getByRole('dialog');
  await categoryDialog.getByLabel('Name').fill(tag);
  await categoryDialog.getByRole('button', { name: 'Add category' }).click();
  await expect(categoryDialog).toBeHidden();
  await search.fill(tag);
  const categoryRow = page.getByRole('row').filter({ hasText: tag });
  await expect(categoryRow).toHaveCount(1);
  // Soft, so the QA category is still deleted below if this regresses.
  await expect.soft(categoryRow, 'new categories start hidden').toContainText('Hidden');
  report.categoryCreatedHidden = (await categoryRow.textContent())?.includes('Hidden') ?? false;
  await categoryRow.getByRole('button', { name: `Edit ${tag}` }).click();
  await page.getByRole('dialog').getByLabel('Description').fill('Temporary Task 05.1 QA fixture');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(categoryRow).toContainText('Temporary Task 05.1 QA fixture');
  await shot(page, info, '1440-categories-qa');
  await categoryRow.getByRole('button', { name: `Delete ${tag}` }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete category' }).click();
  await expect(categoryRow).toHaveCount(0);
  report.category = 'created hidden, edited, deleted';

  // QA product: create as a draft in an existing visible category, then edit it. It is never published.
  await page.goto('/admin/products/new', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
  await shot(page, info, '1440-product-new-errors');
  await page.getByLabel('Product name').fill(`${tag} Probe`);
  await page.getByLabel('SKU').fill(sku);
  await page.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('option').filter({ hasNotText: '(hidden)' }).first().click();
  await page.getByRole('textbox', { name: /^Price(?: \*)?$/ }).fill('99.00');
  await page.getByLabel('Starting stock').fill('3');
  await page.getByRole('button', { name: 'Add specification' }).click();
  await page.getByLabel('Name', { exact: true }).fill('QA');
  await page.getByLabel('Value', { exact: true }).fill('Task 05.1 probe');
  await expect(page.getByRole('radio', { name: 'Save as draft' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\/edit$/);
  const productId = page.url().match(/products\/([0-9a-f-]{36})\/edit/)![1];
  await expect(page.getByRole('heading', { level: 1, name: `${tag} Probe` })).toBeVisible();
  await page.getByRole('textbox', { name: /^Price(?: \*)?$/ }).fill('129.00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Product changes saved.', { exact: true })).toBeVisible();
  await settle(page);
  await shot(page, info, '1440-product-edit-qa');
  report.product = { id: productId, sku, state: 'draft (INACTIVE), price edited to 129.00' };

  await page.goto(`/admin/products?q=${encodeURIComponent(sku)}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const productRow = page.getByRole('row').filter({ hasText: sku });
  await expect(productRow).toContainText('Unpublished');
  await expect(productRow).toContainText('$129.00');
  // The publish confirmation opens but is cancelled: the probe must stay off the shared storefront.
  await productRow.getByRole('button', { name: `Publish ${tag} Probe` }).click();
  await expect(page.getByRole('heading', { name: 'Publish product?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Publish product?' })).toBeHidden();

  // Inventory: restock +2 (3 → 5), then set an exact count of 4, on the QA product only.
  await page.goto(`/admin/inventory?q=${encodeURIComponent(sku)}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const stockRow = page.getByRole('row').filter({ hasText: sku });
  await expect(stockRow).toContainText('3');
  await stockRow.getByRole('button', { name: `Adjust stock for ${tag} Probe` }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Units to add').fill('2');
  await expect(dialog).toContainText('Stock after saving: 5');
  await shot(page, info, '1440-inventory-adjust');
  await dialog.getByRole('button', { name: 'Add stock' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${tag} Probe: stock is now 5.`, { exact: true })).toBeVisible();
  await stockRow.getByRole('button', { name: `Adjust stock for ${tag} Probe` }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Set exact count' }).click();
  await dialog.getByLabel('Counted quantity').fill('4');
  await dialog.getByRole('button', { name: 'Set stock' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${tag} Probe: stock is now 4.`, { exact: true })).toBeVisible();
  report.inventory = 'restock 3→5, set 5→4';

  // Responsive: the main surfaces at 390/768/1920 and a 200% zoom equivalent (720×500 CSS px at DPR 2).
  const responsive = ['/admin', '/admin/products', '/admin/inventory', '/admin/orders', ...(orderPath ? [orderPath] : []), ...(customerPath ? [customerPath] : [])];
  for (const [width, height] of [[390, 844], [768, 1024], [1920, 1080], [720, 500]] as const) {
    await page.setViewportSize({ width, height });
    for (const path of responsive) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await settle(page);
      if (!await noHorizontalScroll(page)) overflow.push(`${path}@${width}`);
      const slug = path === '/admin' ? 'dashboard' : path.split('/').slice(2).map(part => part.slice(0, 12)).join('-');
      await shot(page, info, `${width === 720 ? 'zoom200' : width}-${slug}`);
    }
  }
  // Mobile drawer: opens from the header, lists the 05.1 modules, closes on navigation.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('link', { name: 'Inventory' })).toBeVisible();
  await shot(page, info, '390-drawer-open');
  await drawer.getByRole('link', { name: 'Inventory' }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/inventory$/);

  // Leave shared DEV as found: the probe was never published, ordered or photographed, so it is permanently deletable.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/admin/products/${productId}/edit`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText(`${tag} Probe was deleted.`, { exact: true })).toBeVisible();
  report.cleanup = 'probe product deleted';

  report.overflow = overflow;
  report.problems = problems;
  console.log(`LIVE_ADMIN_QA ${JSON.stringify(report)}`);
  expect(overflow, 'no horizontal page scroll').toEqual([]);
  expect(problems.page, 'no uncaught page errors').toEqual([]);
});
