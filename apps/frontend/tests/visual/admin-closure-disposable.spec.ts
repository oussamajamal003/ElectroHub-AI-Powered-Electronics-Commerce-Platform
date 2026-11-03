import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Task 05.1 closure checks on the DISPOSABLE delivery QA stack only (synthetic data, generated credentials read from the stack's own
 * run folder and never logged). Covers: unsaved-edit guard (links, breadcrumb, Discard, Back, Forward, close, save), D05 categories at
 * 390/768, E06 inventory adjustment at a 200% zoom-equivalent viewport (validation + conflict), G06 customers (empty, server pagination,
 * loading, error), J05 reduced motion, J06 one persisted mutation with authorization and conflict, B01 live sign-out.
 * Writes one structured evidence record per check to EH_QA_OUT/closure-evidence.json.
 */
const statePath = process.env.EH_QA_STACK_STATE;
const outDir = process.env.EH_QA_OUT;
const revision = process.env.EH_QA_REVISION ?? 'unknown';
type State = { frontend: string; backend: string; credentials: string; database: string };
const state = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) as State : null;
type Account = { email: string; password: string };
const accounts = state ? JSON.parse(readFileSync(state.credentials, 'utf8')) as { admin: Account; customer: Account } : null;

type Evidence = { testId: string; route: string; action: string; expected: string; actual: string; evidence: string; result: 'PASS' | 'FAIL' | 'NOT VERIFIED' };
const records: (Evidence & { environment: string; revision: string; viewport: string })[] = [];
function record(page: Page, entry: Evidence) {
  const size = page.viewportSize();
  records.push({ ...entry, environment: state!.database, revision, viewport: size ? `${size.width}x${size.height}` : 'n/a' });
}

test.describe.configure({ mode: 'default' }); // one worker: checks run in file order, sign-out last
test.skip(!state || !accounts || !outDir, 'Set EH_QA_STACK_STATE and EH_QA_OUT to run the disposable closure checks.');
test.afterAll(() => { if (outDir) writeFileSync(path.join(outDir, 'closure-evidence.json'), JSON.stringify(records, null, 2)); });

async function shot(page: Page, name: string) { await page.screenshot({ path: path.join(outDir!, `${name}.png`), fullPage: false }); }
async function login(page: Page) {
  await page.goto('/admin/login');
  await page.locator('#admin-email').fill(accounts!.admin.email);
  await page.locator('#admin-password').fill(accounts!.admin.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/admin');
}
async function token(request: APIRequestContext, account: Account) {
  const response = await request.post(`${state!.backend}/api/auth/login`, { data: { email: account.email, password: account.password } });
  expect(response.status()).toBe(200);
  return (await response.json() as { accessToken: string }).accessToken;
}
async function api(request: APIRequestContext, bearer: string, method: 'get' | 'post' | 'patch', url: string, data?: unknown) {
  return request[method](`${state!.backend}${url}`, { headers: { Authorization: `Bearer ${bearer}` }, data });
}
// The seeded catalog is all protected test fixtures, which the admin console hides by design: create one QA product through the admin API.
let qa: { id: string; name: string; sku: string } | null = null;
async function qaProduct(request: APIRequestContext, admin: string) {
  if (qa) return qa;
  const options = await (await api(request, admin, 'get', '/api/admin/catalog/options')).json() as { data: { categories: { id: string; isActive: boolean }[] } };
  const sku = `QA-051-${Date.now().toString(36).toUpperCase()}`;
  const created = await api(request, admin, 'post', '/api/admin/catalog/products', { name: `QA 05.1 closure ${sku}`, sku,
    categoryId: options.data.categories.find(category => category.isActive)!.id, price: '19.99', inventory: { quantity: 10, lowStockAt: 2 } });
  expect(created.ok()).toBe(true);
  const body = await created.json() as { data: { id: string; name: string } };
  qa = { id: body.data.id, name: body.data.name, sku };
  return qa;
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function inViewport(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.top >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
  });
}

test('A: unsaved product edits are guarded for links, breadcrumb, Discard, Back, Forward and close; save is not', async ({ page, request }) => {
  const admin = await token(request, accounts!.admin);
  const product = await qaProduct(request, admin);
  await login(page);
  await page.goto(`/admin/products/${product.id}/edit`);
  const name = page.getByLabel(/Product name/);
  await expect(name).toHaveValue(product.name);
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  let nativePrompts = 0;
  page.on('dialog', native => { nativePrompts += 1; void native.dismiss(); });

  // Clean form: sidebar navigation does not ask.
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Inventory' }).click();
  await page.waitForURL(url => url.pathname === '/admin/inventory');
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(name).toHaveValue(product.name);

  await name.fill(`${product.name} (edited)`);
  const results: string[] = [];
  for (const [label, act] of [
    ['sidebar', () => page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Orders' }).click()],
    ['breadcrumb', () => page.getByRole('navigation', { name: /breadcrumb/i }).getByRole('link', { name: 'Dashboard' }).click()],
    ['discard', () => page.getByRole('link', { name: 'Discard' }).click()],
    ['back', () => page.goBack()],
  ] as const) {
    await act();
    await expect(dialog, label).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' }), `${label}: Cancel has initial focus`).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page, `${label}: still on the form`).toHaveURL(new RegExp(`/admin/products/${product.id}/edit$`));
    await expect(name).toHaveValue(`${product.name} (edited)`);
    results.push(`${label}: dialog, stayed`);
  }
  await shot(page, 'guard-dialog-1440');
  await page.goBack();
  await shot(page, 'guard-back-dialog-1440');
  await page.keyboard.press('Escape');
  const forwardMoved = await page.evaluate(async () => { const before = location.href; history.forward(); await new Promise(r => setTimeout(r, 300)); return location.href !== before; });
  results.push(`forward: ${forwardMoved ? 'navigated' : 'no forward entry while dirty'}`);
  await expect(name).toHaveValue(`${product.name} (edited)`);

  // Close/refresh: the native beforeunload prompt.
  const closing = await page.context().newPage();
  await closing.goto(`/admin/products/${product.id}/edit`);
  await closing.getByLabel(/Product name/).fill('Close probe');
  const beforeUnload = new Promise<string>(resolve => closing.once('dialog', native => { resolve(native.type()); void native.dismiss(); }));
  await closing.close({ runBeforeUnload: true });
  results.push(`close: ${await beforeUnload}`);

  // Confirm leaving through Back goes to the entry before the form (the dashboard this page was opened from) in one step.
  await page.goBack();
  await dialog.getByRole('button', { name: 'Leave page' }).click();
  await page.waitForURL(url => url.pathname === '/admin');
  results.push('back + Leave page: left to /admin in one step');

  // Successful save: no prompt, and later navigation is unguarded until the next edit.
  await page.goto(`/admin/products/${product.id}/edit`);
  await name.fill(`${product.name} QA`);
  const saved = page.waitForResponse(r => r.url().includes(`/api/admin/catalog/products/${product.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save changes' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Customers' }).click();
  await page.waitForURL(url => url.pathname === '/admin/customers');
  await expect(dialog).toHaveCount(0);
  results.push('save: 200, no prompt afterwards');
  expect(nativePrompts, 'no window.confirm prompts (beforeunload is counted on its own page)').toBe(0);
  const ok = forwardMoved === false;
  record(page, { testId: '05.1-A', route: '/admin/products/:id/edit', action: 'Edit name, then sidebar, breadcrumb, Discard, Back, Forward, close, Back+Leave, save',
    expected: 'In-app dialog for links/Back; no forward loss; native prompt on close; none after save; one prompt per action',
    actual: results.join('; '), evidence: 'guard-dialog-1440.png, guard-back-dialog-1440.png', result: ok ? 'PASS' : 'FAIL' });
  expect(ok).toBe(true);
});

test('D05: categories dialog at 390 and 768 px', async ({ page }) => {
  await login(page);
  const notes: string[] = [];
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/admin/categories');
    await page.getByRole('button', { name: 'Add category' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add category' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/Name/).first()).toBeFocused();
    await dialog.getByRole('button', { name: 'Add category' }).click();
    const invalid = await dialog.locator('[aria-invalid="true"]').count();
    await shot(page, `d05-categories-dialog-${width}`);
    const fits = await inViewport(page, '[role="dialog"]');
    const noScroll = await noHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const focusBack = await page.evaluate(() => document.activeElement?.textContent?.includes('Add category') ?? false);
    notes.push(`${width}: invalid fields=${invalid}, fits=${fits}, no h-scroll=${noScroll}, focus returned=${focusBack}`);
    expect(invalid).toBeGreaterThan(0);
    expect(fits && noScroll && focusBack).toBe(true);
  }
  record(page, { testId: 'D05', route: '/admin/categories', action: 'Open Add, submit empty, Escape, at 390 and 768',
    expected: 'Name focused; validation shown; dialog inside viewport; no horizontal scroll; focus back on the trigger', actual: notes.join('; '),
    evidence: 'd05-categories-dialog-390.png, d05-categories-dialog-768.png', result: 'PASS' });
});

test('E06 + J06: inventory adjustment at 200% zoom-equivalent, persisted on the disposable DB, with conflict and authorization', async ({ page, request }) => {
  // Chrome at 200% zoom on a 1280x800 window lays out a 640x400 CSS viewport at device scale factor 2.
  await page.setViewportSize({ width: 640, height: 400 });
  await login(page);
  const admin = await token(request, accounts!.admin);
  const customer = await token(request, accounts!.customer);
  const { sku } = await qaProduct(request, admin);
  const stock = async () => (await (await api(request, admin, 'get', `/api/admin/inventory?q=${sku}`)).json() as { data: { productId: string; quantity: number }[] }).data[0];
  const before = (await (await api(request, admin, 'get', `/api/admin/inventory?q=${sku}`)).json() as { data: { productId: string; quantity: number }[] }).data[0];

  await page.goto(`/admin/inventory?q=${sku}`);
  await page.getByRole('button', { name: /Adjust stock for/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Adjust stock' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByLabel('Units received');
  await expect(input).toBeFocused();
  await dialog.getByRole('button', { name: 'Add stock' }).click();
  await expect(dialog.getByText('Enter at least 1 unit to add.')).toBeVisible();
  await shot(page, 'e06-adjust-validation-zoom200');
  // Taller than a 400 px viewport, the dialog must scroll inside its modal container with every part reachable (never clipped above the fold).
  const reach = await dialog.evaluate(element => {
    const scroller = element.parentElement!;
    const box = () => element.getBoundingClientRect();
    const widthFits = box().left >= 0 && box().right <= window.innerWidth;
    scroller.scrollTop = 0;
    const titleReachable = element.querySelector('h2')!.getBoundingClientRect().top >= 0;
    scroller.scrollTop = scroller.scrollHeight;
    const submit = [...element.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Add stock')!.getBoundingClientRect();
    return { widthFits, titleReachable, actionsReachable: submit.bottom <= window.innerHeight, height: Math.round(box().height), scrolls: scroller.scrollHeight > scroller.clientHeight };
  });
  const fits = reach.widthFits && reach.titleReachable && reach.actionsReachable;
  await page.keyboard.press('Tab');
  const keyboard = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);

  // Conflict: another admin restocks after this dialog opened.
  expect((await api(request, admin, 'post', `/api/admin/inventory/${before.productId}/adjustments`, { operation: 'RESTOCK', quantity: 1, expectedQuantity: before.quantity })).status()).toBe(200);
  await input.fill('5');
  await dialog.getByRole('button', { name: 'Add stock' }).click();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await shot(page, 'e06-adjust-conflict-zoom200');
  const afterConflict = (await stock()).quantity;

  // Retry against the refreshed quantity: persisted.
  const saved = page.waitForResponse(r => r.url().includes('/adjustments') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Add stock' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  const after = (await stock()).quantity;
  const forbidden = (await api(request, customer, 'post', `/api/admin/inventory/${before.productId}/adjustments`, { operation: 'RESTOCK', quantity: 1, expectedQuantity: after })).status();
  const unchanged = (await stock()).quantity;

  const ok = afterConflict === before.quantity + 1 && after === before.quantity + 6 && forbidden === 403 && unchanged === after;
  record(page, { testId: 'E06', route: '/admin/inventory', action: 'Open Adjust at 640x400 (200% zoom-equivalent), empty submit, stale submit, retry',
    expected: 'Within viewport width; title and Add stock/Close reachable by scrolling; focus stays in the dialog; validation and conflict shown',
    actual: `dialog ${reach.height}px in a 400px viewport, scrolls=${reach.scrolls}, width fits=${reach.widthFits}, title reachable=${reach.titleReachable}, actions reachable=${reach.actionsReachable}, focus trapped=${keyboard}, validation and conflict alerts shown`,
    evidence: 'e06-adjust-validation-zoom200.png, e06-adjust-conflict-zoom200.png', result: fits && keyboard ? 'PASS' : 'FAIL' });
  record(page, { testId: 'J06', route: 'POST /api/admin/inventory/:id/adjustments', action: 'Concurrent restock (+1 via API), stale UI restock (+5) rejected, retry persisted, customer token',
    expected: `quantity ${before.quantity} → ${before.quantity + 1} → ${before.quantity + 6}; stale write rejected; customer 403 with no change`,
    actual: `after conflict=${afterConflict}, after retry=${after}, customer status=${forbidden}, after customer attempt=${unchanged}`,
    evidence: `database ${state!.database}`, result: ok ? 'PASS' : 'FAIL' });
  expect(fits && keyboard).toBe(true);
  expect(ok).toBe(true);
});

test('G06: customers empty, server pagination, loading and error states', async ({ page, request }) => {
  await login(page);
  const admin = await token(request, accounts!.admin);
  const pageOne = await (await api(request, admin, 'get', '/api/admin/customers?pageSize=1&page=1')).json() as { data: { id: string }[]; meta: { total: number; totalPages: number; pageSize: number } };
  const pageTwo = await (await api(request, admin, 'get', '/api/admin/customers?pageSize=1&page=2')).json() as { data: { id: string }[] };
  const serverPaged = pageOne.data.length === 1 && pageOne.meta.pageSize === 1 && pageOne.meta.totalPages === pageOne.meta.total
    && (pageOne.meta.total < 2 || pageTwo.data[0]?.id !== pageOne.data[0]?.id);

  await page.goto('/admin/customers?q=zz-no-such-customer');
  await expect(page.getByText('No customers match these filters')).toBeVisible();
  await shot(page, 'g06-customers-empty');

  await page.route('**/api/admin/customers?*', async route => { await new Promise(resolve => setTimeout(resolve, 2500)); await route.continue().catch(() => undefined); });
  await page.goto('/admin/customers?sort=createdAt');
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  await shot(page, 'g06-customers-loading');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await page.route('**/api/admin/customers?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
  await page.goto('/admin/customers?sort=email');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'g06-customers-error');
  // A failed load must not claim the list is empty.
  await expect(page.getByText('These rows could not be loaded')).toBeVisible();
  await expect(page.getByText('No customers yet')).toHaveCount(0);
  await page.unroute('**/api/admin/customers?*');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);

  record(page, { testId: 'G06', route: '/admin/customers', action: 'No-match search; pageSize=1 pages 1 and 2; delayed response; HTTP 500 then Retry',
    expected: 'Empty state; distinct server pages; busy state; error with working Retry and no false "No customers yet"',
    actual: `total=${pageOne.meta.total}, totalPages(pageSize 1)=${pageOne.meta.totalPages}, distinct pages=${serverPaged}`,
    evidence: 'g06-customers-empty.png, g06-customers-loading.png, g06-customers-error.png', result: serverPaged ? 'PASS' : 'FAIL' });
  expect(serverPaged).toBe(true);
});

test('J05: reduced motion for drawer, dialogs and menus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const longest = () => page.evaluate(() => {
    let max = 0;
    for (const element of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="dialog"] *, [role="menu"], [role="menu"] *')) {
      const style = getComputedStyle(element);
      for (const value of [...style.animationDuration.split(','), ...style.transitionDuration.split(',')]) max = Math.max(max, parseFloat(value) * (value.trim().endsWith('ms') ? 0.001 : 1));
    }
    return max;
  });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('#admin-drawer')).toBeVisible();
  const drawer = await longest();
  await shot(page, 'j05-drawer-reduced-motion');
  await page.keyboard.press('Escape');
  await page.goto('/admin/categories');
  await page.getByRole('button', { name: 'Add category' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialog = await longest();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Account menu/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  const menu = await longest();
  await page.keyboard.press('Escape');
  const ok = Math.max(drawer, dialog, menu) <= 0.011;
  record(page, { testId: 'J05', route: '/admin, /admin/categories', action: 'prefers-reduced-motion: reduce; open drawer, dialog, account menu',
    expected: 'No animation/transition longer than 10 ms; content visible without motion', actual: `longest (s): drawer=${drawer}, dialog=${dialog}, menu=${menu}`,
    evidence: 'j05-drawer-reduced-motion.png', result: ok ? 'PASS' : 'FAIL' });
  expect(ok).toBe(true);
});

test('B01: live sign-out ends admin access', async ({ page, request }) => {
  await login(page);
  await page.goto('/admin/customers');
  await expect(page.getByRole('table')).toBeVisible();
  let bearer = '';
  page.on('request', r => { const value = r.headers().authorization; if (value?.startsWith('Bearer ') && r.url().includes('/api/admin/')) bearer = value.slice(7); });
  await page.reload();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(url => url.pathname === '/admin/login');
  await shot(page, 'b01-after-sign-out');
  const leaked = await page.getByRole('table').count();
  await page.goto('/admin/customers');
  await page.waitForURL(url => url.pathname === '/admin/login');
  const refresh = (await page.request.post(`${state!.backend}/api/auth/refresh`)).status();
  const oldToken = bearer ? (await api(request, bearer, 'get', '/api/admin/customers')).status() : 0;
  const ok = leaked === 0 && refresh === 401;
  record(page, { testId: 'B01', route: '/admin → Sign out', action: 'Sign out from the account menu; reopen a protected route; call refresh; replay the last access token',
    expected: 'Redirect to /admin/login; no admin data; refresh rejected', actual: `table after sign-out=${leaked}, protected route → /admin/login, refresh=${refresh}, old access token=${oldToken}`,
    evidence: 'b01-after-sign-out.png', result: ok ? 'PASS' : 'FAIL' });
  expect(ok).toBe(true);
});
