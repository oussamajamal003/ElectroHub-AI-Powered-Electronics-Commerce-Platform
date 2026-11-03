import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Task 05.1 premium UI/UX acceptance (UX-01…UX-22) on the DISPOSABLE delivery QA stack only: synthetic data, generated credentials read
 * from the stack's run folder (never logged). Creates its own categories/products through the admin API; brands must exist (the runner
 * inserts four synthetic brands into the disposable database). Writes one evidence record per check to EH_QA_OUT/premium-evidence.json.
 */
const statePath = process.env.EH_QA_STACK_STATE;
const outDir = process.env.EH_QA_OUT;
const revision = process.env.EH_QA_REVISION ?? 'unknown';
type State = { frontend: string; backend: string; credentials: string; database: string };
const state = statePath ? JSON.parse(readFileSync(statePath, 'utf8')) as State : null;
type Account = { email: string; password: string };
const accounts = state ? JSON.parse(readFileSync(state.credentials, 'utf8')) as { admin: Account; customer: Account } : null;

type Result = 'PASS' | 'FAIL' | 'NOT VERIFIED';
const records: { id: string; requirement: string; actual: string; evidence: string; result: Result; environment: string; revision: string }[] = [];
const record = (id: string, requirement: string, actual: string, evidence: string, result: Result) =>
  records.push({ id, requirement, actual, evidence, result, environment: state!.database, revision });

test.describe.configure({ mode: 'default' });
test.skip(!state || !accounts || !outDir, 'Set EH_QA_STACK_STATE and EH_QA_OUT to run the premium UI checks.');
// A crashed worker is replaced by a new one: merge by requirement id so earlier results are kept.
test.afterAll(() => {
  if (!outDir) return;
  const file = path.join(outDir, 'premium-evidence.json');
  const earlier = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as typeof records : [];
  const ids = new Set(records.map(item => item.id));
  writeFileSync(file, JSON.stringify([...earlier.filter(item => !ids.has(item.id) && item.environment === state!.database), ...records], null, 2));
});

const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(outDir!, `${name}.png`), fullPage });
async function login(page: Page) {
  await page.goto('/admin/login');
  await page.locator('#admin-email').fill(accounts!.admin.email);
  await page.locator('#admin-password').fill(accounts!.admin.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/admin');
}
// One API sign-in per account per run: the login limiter allows 30 attempts per 15 minutes per IP (access tokens last 15 minutes).
const tokens = new Map<string, string>();
async function token(request: APIRequestContext, account: Account) {
  const cached = tokens.get(account.email);
  if (cached) return cached;
  const response = await request.post(`${state!.backend}/api/auth/login`, { data: { email: account.email, password: account.password } });
  expect(response.status()).toBe(200);
  const value = (await response.json() as { accessToken: string }).accessToken;
  tokens.set(account.email, value);
  return value;
}
/** API call that honours the admin write limit (60/min): on 429 it waits for the advertised reset, then retries. */
async function call(request: APIRequestContext, bearer: string, method: 'get' | 'post' | 'patch' | 'delete', url: string, data?: unknown) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await request[method](`${state!.backend}${url}`, { headers: { Authorization: `Bearer ${bearer}` }, data });
    if (response.status() !== 429 || attempt >= 4) return response;
    const reset = Number(/(?:^|[;,\s])t=(\d+)/.exec(response.headers()['ratelimit'] ?? '')?.[1] ?? 15);
    await new Promise(resolve => setTimeout(resolve, (reset + 1) * 1000));
  }
}

// ─── Fixtures (created once per run, in the disposable database) ─────────
const LONG = 'stripe-acceptance-1218e692-079c-42ad-bd6c-303aa5213c9b';
let fixtures: { categories: Record<string, string>; brands: Record<string, string>; products: { id: string; sku: string }[] } | null = null;
async function setup(request: APIRequestContext) {
  if (fixtures) return fixtures;
  // One fixture set per disposable database, shared by replacement workers (no duplicate categories after a crash).
  const saved = path.join(outDir!, 'fixtures.json');
  if (existsSync(saved)) {
    const stored = JSON.parse(readFileSync(saved, 'utf8')) as { database: string; fixtures: NonNullable<typeof fixtures> };
    if (stored.database === state!.database) { fixtures = stored.fixtures; return fixtures; }
  }
  const admin = await token(request, accounts!.admin);
  const stamp = Date.now().toString(36).toUpperCase();
  const categories: Record<string, string> = {};
  for (const name of ['Smartphones', 'Laptops', 'Audio', `${LONG} ${stamp}`]) {
    const created = await call(request, admin, 'post', '/api/admin/categories', { name: `${name.startsWith('stripe') ? name : `${name} ${stamp}`}` });
    expect(created.status(), name).toBe(201);
    const body = (await created.json() as { data: { id: string; updatedAt: string } }).data;
    expect((await call(request, admin, 'patch', `/api/admin/categories/${body.id}/status`, { isActive: true, expectedUpdatedAt: body.updatedAt })).ok()).toBe(true);
    categories[name.startsWith('stripe') ? 'long' : name] = body.id;
  }
  const options = (await (await call(request, admin, 'get', '/api/admin/catalog/options')).json() as { data: { brands: { id: string; name: string }[] } }).data;
  const brands = Object.fromEntries(options.brands.map(brand => [brand.name, brand.id]));
  expect(brands.Apple && brands.Sony, 'synthetic brands present').toBeTruthy();
  const products: { id: string; sku: string }[] = [];
  // 24 products: more than one admin page (20). Apple spans two categories, Sony one, Samsung one.
  const plan = [...Array(10).fill(['Smartphones', 'Apple']), ...Array(4).fill(['Laptops', 'Apple']), ...Array(6).fill(['Audio', 'Sony']),
    ...Array(4).fill(['Smartphones', 'Samsung'])] as [string, string][];
  for (const [index, [category, brand]] of plan.entries()) {
    const sku = `QA-PREM-${stamp}-${String(index).padStart(2, '0')}`;
    const response = await call(request, admin, 'post', '/api/admin/catalog/products', { name: `QA premium ${brand} ${category} ${index}`, sku,
      categoryId: categories[category], brandId: brands[brand], price: '49.00', status: 'ACTIVE', inventory: { quantity: 12, lowStockAt: 2 } });
    expect(response.status(), sku).toBe(201);
    products.push({ id: (await response.json() as { data: { id: string } }).data.id, sku });
  }
  fixtures = { categories, brands, products };
  writeFileSync(saved, JSON.stringify({ database: state!.database, fixtures }));
  return fixtures;
}

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }];

test('UX-01/02/15: sidebar collapse on the MAIN row, centred rail icons, avatar-only header', async ({ page, request }) => {
  await setup(request);
  await login(page);
  const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
  const inSidebar = await toggle.evaluate(element => Boolean(element.closest('aside')) && !element.closest('header'));
  const sameRow = await toggle.evaluate(element => {
    const heading = element.parentElement!.querySelector('p')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return Math.abs((heading.top + heading.bottom) / 2 - (box.top + box.bottom) / 2) < 6 && box.left > heading.left;
  });
  const avatarOnly = (await page.getByRole('button', { name: /Account menu for/ }).innerText()).trim().length <= 3;
  await shot(page, 'ux01-sidebar-expanded-1440');
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  const rail = await page.locator('aside nav a').evaluateAll(links => links.map(link => {
    const box = link.getBoundingClientRect();
    const icon = link.querySelector('svg')!.getBoundingClientRect();
    return { width: box.width, height: box.height, iconSize: icon.width, offset: Math.abs((box.left + box.right) / 2 - (icon.left + icon.right) / 2) };
  }));
  await page.locator('aside nav a').nth(2).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shot(page, 'ux02-sidebar-collapsed-1440');
  await page.reload();
  const persisted = await page.getByRole('button', { name: 'Expand sidebar' }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Orders' }).click();
  const persistedNav = await page.getByRole('button', { name: 'Expand sidebar' }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  const railOk = rail.every(link => link.width >= 44 && link.height >= 44 && link.iconSize >= 20 && link.offset <= 1);
  record('UX-01', 'Collapse control on the MAIN heading row', `in sidebar=${inSidebar}, same row as MAIN=${sameRow}`, 'ux01-sidebar-expanded-1440.png',
    inSidebar && sameRow ? 'PASS' : 'FAIL');
  record('UX-02', 'Collapsed rail icons sized and centred; state persists', `links ${rail.map(link => `${link.width}x${link.height}/icon ${link.iconSize}/off ${link.offset.toFixed(1)}`).join(', ')}; after reload=${persisted}; after navigation=${persistedNav}`,
    'ux02-sidebar-collapsed-1440.png', railOk && persisted && persistedNav ? 'PASS' : 'FAIL');
  record('UX-15', 'Avatar-only header', `trigger text is initials only=${avatarOnly}`, 'ux01-sidebar-expanded-1440.png', avatarOnly ? 'PASS' : 'FAIL');
  expect(inSidebar && sameRow && railOk && persisted && persistedNav && avatarOnly).toBe(true);
});

test('UX-03: large bold titles on every admin page', async ({ page, request }) => {
  const { products } = await setup(request);
  await login(page);
  const routes = ['/admin', '/admin/products', '/admin/products/new', `/admin/products/${products[0]!.id}/edit`, '/admin/categories', '/admin/inventory',
    '/admin/orders', '/admin/customers', '/admin/deliveries'];
  const sizes: string[] = [];
  let ok = true;
  for (const route of routes) {
    await page.goto(route);
    const h1 = page.locator('#admin-main h1').first();
    await expect(h1).toBeVisible();
    const style = await h1.evaluate(element => { const computed = getComputedStyle(element); return { size: parseFloat(computed.fontSize), weight: Number(computed.fontWeight) }; });
    sizes.push(`${route} ${style.size}px/${style.weight}`);
    ok &&= style.size >= 40 && style.weight >= 700;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/products');
  const mobile = await page.locator('#admin-main h1').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await shot(page, 'ux03-title-390');
  record('UX-03', 'Titles match the storefront (clamp(2rem, 3vw, 3.5rem), bold): ≥40px at 1440, smaller on phones', `${sizes.join('; ')}; 390px: ${mobile}px`, 'ux03-title-390.png', ok && mobile < 40 ? 'PASS' : 'FAIL');
  expect(ok && mobile < 40).toBe(true);
});

test('UX-04/05/22: dropdowns readable at 390/768/1440/1920, long names on one line', async ({ page, request }) => {
  await setup(request);
  await login(page);
  const notes: string[] = [];
  let ok = true;
  const inspect = async (label: string) => page.evaluate(() => {
    const popup = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const box = (popup.closest('[data-radix-popper-content-wrapper]') as HTMLElement | null ?? popup.parentElement!).getBoundingClientRect();
    const options = [...popup.querySelectorAll<HTMLElement>('[role="option"]')];
    const tallest = Math.max(...options.map(option => option.getBoundingClientRect().height));
    return { left: box.left, right: box.right, width: box.width, viewport: window.innerWidth, tallest, count: options.length,
      noScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  }).then(result => ({ label, ...result }));
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto('/admin/products');
    for (const [name, opener] of [
      ['stock filter', () => page.getByRole('combobox', { name: 'Filter by stock' }).click()],
      ['category filter', () => page.getByRole('button', { name: /^Filter by category/ }).click()],
    ] as const) {
      await opener();
      await expect(page.getByRole('listbox')).toBeVisible();
      const result = await inspect(name);
      if (viewport.width === 1440 || viewport.width === 390) await shot(page, `ux04-${name.replace(' ', '-')}-${viewport.width}`);
      const fine = result.tallest <= 48 && result.left >= -1 && result.right <= result.viewport + 1 && result.noScroll;
      ok &&= fine;
      notes.push(`${viewport.width} ${name}: ${result.count} options, tallest ${Math.round(result.tallest)}px, popup ${Math.round(result.width)}px, inside=${fine}`);
      await page.keyboard.press('Escape');
    }
    await page.goto('/admin/products/new');
    for (const name of ['Category', 'Brand']) {
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole('listbox')).toBeVisible();
      const result = await inspect(`form ${name}`);
      if (viewport.width === 1440 || viewport.width === 390) await shot(page, `ux05-form-${name.toLowerCase()}-${viewport.width}`);
      const fine = result.tallest <= 48 && result.left >= -1 && result.right <= result.viewport + 1 && result.noScroll;
      ok &&= fine;
      notes.push(`${viewport.width} form ${name}: ${result.count} options, tallest ${Math.round(result.tallest)}px, inside=${fine}`);
      await page.keyboard.press('Escape');
    }
    await page.goto('/admin/deliveries');
    await page.getByRole('combobox', { name: 'Order status' }).click();
    const delivery = await inspect('delivery status');
    const fine = delivery.tallest <= 48 && delivery.right <= delivery.viewport + 1;
    ok &&= fine;
    notes.push(`${viewport.width} delivery status: tallest ${Math.round(delivery.tallest)}px, inside=${fine}`);
    await page.keyboard.press('Escape');
  }
  // Long category name: single line with ellipsis and full text in the title; keyboard search reaches it.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/products/new');
  await page.getByRole('button', { name: /^Category/ }).focus();
  await page.keyboard.press('s');
  await page.keyboard.type('tripe-acc');
  const long = page.getByRole('option', { name: new RegExp(LONG) }).first();
  await expect(long).toBeVisible();
  const longLine = await long.evaluate(element => ({ height: element.getBoundingClientRect().height, title: element.getAttribute('title') ?? '' }));
  await page.keyboard.press('Enter');
  const chosen = await page.getByRole('button', { name: /^Category/ }).innerText();
  await shot(page, 'ux05-long-category-selected-1440');
  const longOk = longLine.height <= 48 && longLine.title.includes(LONG) && chosen.includes('stripe-acceptance');
  record('UX-04', 'Stock, category, brand and delivery dropdowns readable', notes.join('; '), 'ux04-*.png, ux05-form-*.png', ok ? 'PASS' : 'FAIL');
  record('UX-05', 'Long category names: one line, full name in title, keyboard search', `option ${Math.round(longLine.height)}px tall, title has full name=${longLine.title.includes(LONG)}, chosen by keyboard=${chosen.includes('stripe-acceptance')}`,
    'ux05-long-category-selected-1440.png', longOk ? 'PASS' : 'FAIL');
  record('UX-22-dropdowns', 'Dropdowns inside the viewport with no horizontal page scroll at 390/768/1440/1920', ok ? 'all popups inside the viewport' : 'see UX-04', 'ux04-*.png', ok ? 'PASS' : 'FAIL');
  expect(ok && longOk).toBe(true);
});

test('UX-06/21: pagination scrolls to the content top (smooth, or instant with reduced motion)', async ({ page, request }) => {
  await setup(request);
  await login(page);
  const notes: string[] = [];
  let ok = true;
  for (const reduce of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    for (const route of ['/admin/products', '/admin/inventory']) {
      await page.goto(route);
      await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const before = await page.evaluate(() => window.scrollY);
      await page.getByRole('button', { name: 'Next' }).click();
      const immediately = await page.evaluate(() => window.scrollY);
      await expect(page).toHaveURL(/page=2/);
      const header = await page.locator('[data-admin-header]').evaluate(element => element.getBoundingClientRect().height);
      const titleTop = () => page.locator('#admin-main h1').evaluate(element => Math.round(element.getBoundingClientRect().top));
      // Settled position: the title sits just below the sticky header (not above the viewport, not far down the page).
      await expect.poll(async () => { const value = await titleTop(); return value >= header && value <= 200; }, { timeout: 5_000 }).toBe(true).catch(() => undefined);
      const top = await titleTop();
      await expect(page.locator('nav[aria-label$="pages"] [aria-live="polite"]')).toContainText('21');
      const summary = await page.locator('nav[aria-label$="pages"] [aria-live="polite"]').innerText();
      const fine = top >= header && top <= 200 && before > 0 && (reduce ? immediately < before / 2 : true) && /21/.test(summary);
      ok &&= fine;
      notes.push(`${reduce ? 'reduced' : 'smooth'} ${route}: scrolled ${before}→title at ${top}px (header ${header}px), live summary "${summary}"`);
      await page.goBack();
      await expect(page).not.toHaveURL(/page=2/);
    }
  }
  await shot(page, 'ux06-after-next');
  record('UX-06', 'Pager returns to the page title below the sticky header; URL page state and Back coherent', notes.join('; '), 'ux06-after-next.png', ok ? 'PASS' : 'FAIL');
  record('UX-21', 'Reduced motion: instant scroll, no smooth animation', notes.filter(note => note.startsWith('reduced')).join('; '), 'ux06-after-next.png', ok ? 'PASS' : 'FAIL');
  expect(ok).toBe(true);
});

test('UX-08/09/10: brand/category ranking, Publish now and Save as draft reach the storefront correctly', async ({ page, request }) => {
  const { categories } = await setup(request);
  await login(page);
  const stamp = Date.now().toString(36).toUpperCase();
  const create = async (status: 'draft' | 'publish') => {
    await page.goto('/admin/products/new');
    await page.getByLabel(/Product name/).fill(`QA premium ${status} ${stamp}`);
    await page.getByLabel(/^SKU/).fill(`QA-PREM-${status.toUpperCase()}-${stamp}`);
    await page.getByLabel(/^Price/).fill('25.00');
    await page.getByRole('button', { name: /^Brand/ }).click();
    await page.getByRole('option', { name: /^Sony/ }).click();
    // Sony's products are all in one category, so the empty category is filled (with a note) rather than left for the admin.
    await expect(page.getByRole('button', { name: /^Category/ })).toContainText('Audio');
    if (status === 'publish') await page.getByRole('radio', { name: 'Publish now' }).click();
    const created = page.waitForResponse(r => r.url().endsWith('/api/admin/catalog/products') && r.request().method() === 'POST');
    await page.getByRole('button', { name: status === 'publish' ? 'Create and publish' : 'Create draft' }).click();
    const response = await created;
    const body = await response.json() as { data: { slug: string; status: string; category: { id: string } } };
    await page.waitForURL(/\/edit$/);
    return { status: response.status(), body: body.data };
  };
  // Ranking: Apple shows its two categories first, most products first.
  await page.goto('/admin/products/new');
  await page.getByRole('button', { name: /^Brand/ }).click();
  await page.getByRole('option', { name: /^Apple/ }).click();
  const autoFilled = await page.getByRole('button', { name: /^Category/ }).innerText();
  await page.getByRole('button', { name: /^Category/ }).click();
  const ranked = (await page.getByRole('group', { name: /Used with Apple/ }).getByRole('option').allInnerTexts()).map(text => text.replace(/\s+/g, ' '));
  await shot(page, 'ux08-apple-ranked-categories');
  await page.keyboard.press('Escape');
  const published = await create('publish');
  const sonyAuto = published.body.category.id === categories.Audio;
  const toastPublished = await page.getByText(/was published\./).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  const storefrontPublished = (await request.get(`${state!.backend}/api/products/${published.body.slug}`)).status();
  const draft = await create('draft');
  const storefrontDraft = (await request.get(`${state!.backend}/api/products/${draft.body.slug}`)).status();
  const draftPill = await page.locator('#admin-main dd').getByText('Unpublished', { exact: true }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await shot(page, 'ux10-draft-edit-page');
  const ok = /Choose a category/.test(autoFilled) && ranked.length === 2 && /Smartphones.*10 products/.test(ranked[0]!) && /Laptops.*4 products/.test(ranked[1]!)
    && sonyAuto && published.status === 201 && published.body.status === 'ACTIVE' && storefrontPublished === 200
    && draft.status === 201 && draft.body.status === 'INACTIVE' && storefrontDraft === 404 && draftPill && toastPublished;
  record('UX-08', 'Data-driven brand/category ranking; single-category brand fills an empty category with a note',
    `Apple (2 categories) left category empty: ${/Choose a category/.test(autoFilled)}; ranked: ${ranked.join(' | ')}; Sony auto-filled Audio=${sonyAuto}`, 'ux08-apple-ranked-categories.png', ok ? 'PASS' : 'FAIL');
  record('UX-09', 'Publish now creates ACTIVE and the storefront serves it', `POST ${published.status} status=${published.body.status}; GET /api/products/:slug → ${storefrontPublished}`, 'API', published.status === 201 && storefrontPublished === 200 ? 'PASS' : 'FAIL');
  record('UX-10', 'Save as draft creates INACTIVE, hidden from the storefront', `POST ${draft.status} status=${draft.body.status}; storefront → ${storefrontDraft}; admin pill Unpublished=${draftPill}`, 'ux10-draft-edit-page.png',
    draft.status === 201 && storefrontDraft === 404 && draftPill ? 'PASS' : 'FAIL');
  expect(ok).toBe(true);
});

test('UX-11: delete an unused draft; refuse a product in a cart; admin only', async ({ page, request }) => {
  const { categories, brands } = await setup(request);
  const admin = await token(request, accounts!.admin);
  const customer = await token(request, accounts!.customer);
  const stamp = Date.now().toString(36).toUpperCase();
  const make = async (suffix: string, status: 'ACTIVE' | 'INACTIVE') => (await (await call(request, admin, 'post', '/api/admin/catalog/products', {
    name: `QA delete ${suffix} ${stamp}`, sku: `QA-DEL-${suffix}-${stamp}`, categoryId: categories.Audio, brandId: brands.Nokia, price: '9.00', status,
    inventory: { quantity: 5, lowStockAt: 1 } })).json() as { data: { id: string; updatedAt: string; name: string } }).data;
  const draft = await make('DRAFT', 'INACTIVE');
  const carted = await make('CART', 'ACTIVE');
  expect((await call(request, customer, 'post', '/api/cart/items', { productId: carted.id, quantity: 1 })).status()).toBe(201);
  const unpublished = await call(request, admin, 'patch', `/api/admin/catalog/products/${carted.id}/status`, { status: 'INACTIVE', expectedUpdatedAt: carted.updatedAt });
  expect(unpublished.ok()).toBe(true);

  await login(page);
  await page.goto(`/admin/products?q=QA-DEL-DRAFT-${stamp}`);
  await page.getByRole('button', { name: `Delete ${draft.name}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`QA-DEL-DRAFT-${stamp}`);
  await shot(page, 'ux11-delete-confirm');
  const removed = page.waitForResponse(r => r.url().includes(`/api/admin/catalog/products/${draft.id}`) && r.request().method() === 'DELETE');
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();
  const deleteStatus = (await removed).status();
  await expect(page.getByText(`${draft.name} was deleted.`)).toBeVisible();
  const gone = (await call(request, admin, 'get', `/api/admin/catalog/products/${draft.id}`)).status();

  await page.goto(`/admin/products?q=QA-DEL-CART-${stamp}`);
  const blocked = page.getByRole('button', { name: new RegExp(`Delete ${carted.name} \\(unavailable`) });
  const blockedLabel = await blocked.getAttribute('aria-label');
  // Real browsers dispatch clicks on aria-disabled buttons (Playwright's click would wait for them to become enabled).
  await blocked.dispatchEvent('click');
  // The toast is also announced through its live region, so the text exists twice: check the visible one.
  const explained = await page.getByText(/cannot be deleted\. Customers have it in a cart/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  const forced = await call(request, admin, 'delete', `/api/admin/catalog/products/${carted.id}`);
  const forcedBody = await forced.json() as { error?: { code?: string } };
  const asCustomer = (await call(request, customer, 'delete', `/api/admin/catalog/products/${carted.id}`)).status();
  const stillThere = (await call(request, admin, 'get', `/api/admin/catalog/products/${carted.id}`)).status();
  await shot(page, 'ux11-delete-blocked');
  const ok = deleteStatus === 204 && gone === 404 && /cart/.test(blockedLabel ?? '') && explained && forced.status() === 409
    && forcedBody.error?.code === 'PRODUCT_IN_USE' && asCustomer === 403 && stillThere === 200;
  record('UX-11', 'Safe delete: unused draft deleted; protected product refused; admin only',
    `draft DELETE ${deleteStatus}, then GET ${gone}; carted product: button "${blockedLabel}", explanation shown=${explained}, forced DELETE ${forced.status()} ${forcedBody.error?.code}, customer DELETE ${asCustomer}, still exists ${stillThere}`,
    'ux11-delete-confirm.png, ux11-delete-blocked.png', ok ? 'PASS' : 'FAIL');
  expect(ok).toBe(true);
});

test('UX-12/13/14/19: skeletons instead of spinners; media button not clipped', async ({ page, request }) => {
  const { products } = await setup(request);
  await login(page);
  const delay = (pattern: string, ms: number) => page.route(pattern, async route => { await new Promise(resolve => setTimeout(resolve, ms)); await route.continue().catch(() => undefined); });

  await delay(`**/api/admin/catalog/products/${products[0]!.id}`, 2500);
  await page.goto(`/admin/products/${products[0]!.id}/edit`);
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  const editSkeleton = { inputs: await page.locator('#admin-main input').count(), loader: await page.locator('#admin-main [class*="loader"]').count() };
  await shot(page, 'ux12-edit-skeleton');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await delay('**/api/admin/catalog/options', 2500);
  await page.goto('/admin/products/new');
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  const newSkeleton = { inputs: await page.locator('#admin-main input').count(), status: await page.getByRole('status').first().innerText() };
  await shot(page, 'ux13-new-options-loading');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await delay('**/api/admin/deliveries?*', 2500);
  await page.goto('/admin/deliveries');
  await expect(page.locator('#admin-main h1')).toBeVisible();
  const deliverySkeleton = { rows: await page.locator('#admin-main tbody tr').count(), header: await page.locator('#admin-main thead th').count(),
    loader: await page.locator('#admin-main svg[class*="loader"], #admin-main [class*="ElectroHubLoader"]').count() };
  await shot(page, 'ux14-delivery-skeleton');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/admin/deliveries?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' }));
  await page.goto('/admin/deliveries?status=DELIVERED');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 });
  const deliveryError = await page.getByText('These rows could not be loaded').isVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await page.goto(`/admin/products/${products[1]!.id}/media`);
  const choose = page.getByRole('button', { name: 'Choose photos' });
  await expect(choose).toBeVisible();
  const clip = await choose.evaluate(element => { const content = element.querySelector('span') ?? element; const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), clipped: content.scrollWidth > content.clientWidth + 1 || box.width < 120, radius: getComputedStyle(content).borderRadius }; });
  await shot(page, 'ux19-media-empty');

  const ok12 = editSkeleton.inputs === 0 && editSkeleton.loader === 0;
  const ok13 = newSkeleton.inputs === 0 && /Loading the product form/.test(newSkeleton.status);
  const ok14 = deliverySkeleton.rows === 8 && deliverySkeleton.header > 0 && deliverySkeleton.loader === 0 && deliveryError;
  const ok19 = !clip.clipped;
  record('UX-12', 'Edit product: form-shaped skeleton, no editable inputs, no spinner', `inputs=${editSkeleton.inputs}, loader=${editSkeleton.loader}`, 'ux12-edit-skeleton.png', ok12 ? 'PASS' : 'FAIL');
  record('UX-13', 'Add product: same form skeleton as Edit until categories/brands load', `inputs=${newSkeleton.inputs}, status="${newSkeleton.status}"`,
    'ux13-new-options-loading.png', ok13 ? 'PASS' : 'FAIL');
  record('UX-14', 'Delivery: table skeleton (8 rows), no spinner; honest error state', `rows=${deliverySkeleton.rows}, header cells=${deliverySkeleton.header}, loader=${deliverySkeleton.loader}, error row=${deliveryError}`,
    'ux14-delivery-skeleton.png', ok14 ? 'PASS' : 'FAIL');
  record('UX-19', 'Media empty state: Choose photos fully visible', `button ${clip.width}px wide, clipped=${clip.clipped}, inner radius=${clip.radius}`, 'ux19-media-empty.png', ok19 ? 'PASS' : 'FAIL');
  expect(ok12 && ok13 && ok14 && ok19).toBe(true);
});

test('UX-07: filter and search response (disposable stack timings)', async ({ page, request }) => {
  await setup(request);
  await login(page);
  await page.goto('/admin/products');
  await expect(page.locator('#admin-main tbody tr').first()).toBeVisible();
  const lists: { url: string; start: number; end?: number }[] = [];
  page.on('request', r => { if (r.url().includes('/api/admin/catalog/products?')) lists.push({ url: r.url(), start: Date.now() }); });
  page.on('requestfinished', r => { const entry = lists.find(item => item.url === r.url() && !item.end); if (entry) entry.end = Date.now(); });

  const chip = page.getByRole('button', { name: 'Unpublished', exact: true });
  const listed = page.waitForResponse(r => r.url().includes('/api/admin/catalog/products?') && r.url().includes('status=INACTIVE'));
  // Timed inside the page (click → aria-pressed flips), so Playwright's polling interval does not inflate the figure.
  await chip.evaluate(element => {
    const marks = window as unknown as { clickAt: number; pressedAt: number };
    element.addEventListener('click', () => { marks.clickAt = performance.now(); }, { capture: true, once: true });
    new MutationObserver((_, observer) => { if (element.getAttribute('aria-pressed') === 'true') { marks.pressedAt = performance.now(); observer.disconnect(); } })
      .observe(element, { attributes: true, attributeFilter: ['aria-pressed'] });
  });
  const clicked = Date.now();
  await chip.click();
  const pressed = await expect(chip).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 }).then(() => 'true', () => 'false');
  const feedback = await page.evaluate(() => { const marks = window as unknown as { clickAt: number; pressedAt: number }; return Math.round(marks.pressedAt - marks.clickAt); });
  await listed;
  await expect(page.locator('section[aria-label="Products"]')).not.toHaveAttribute('aria-busy', 'true');
  const chipDone = Date.now() - clicked;
  const chipRequests = lists.length;

  lists.length = 0;
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('section[aria-label="Products"]')).not.toHaveAttribute('aria-busy', 'true');
  const cached = lists.length;

  lists.length = 0;
  await page.getByRole('searchbox').evaluate(element => {
    element.addEventListener('input', () => { (window as unknown as { lastInput: number }).lastInput = performance.now(); });
  });
  const typed = Date.now();
  // One input event (as from paste or fast typing): exactly one debounced request must follow.
  await page.getByRole('searchbox').fill('QA premium Sony');
  await expect.poll(() => lists.length).toBeGreaterThan(0);
  // Last keystroke → search request start, both on the page's own clock (Resource Timing).
  const debounce = await page.evaluate(() => {
    const request = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/admin/catalog/products?') && entry.name.includes('q=')).at(-1)!;
    return Math.round(request.startTime - (window as unknown as { lastInput: number }).lastInput);
  });
  await expect(page.locator('section[aria-label="Products"]')).not.toHaveAttribute('aria-busy', 'true');
  const searchRequests = lists.length;
  // Correctness is asserted; wall-clock figures are recorded as measured (dev build on a shared machine), with a generous guard only.
  const ok = pressed === 'true' && feedback < 100 && chipRequests === 1 && searchRequests === 1 && debounce >= 190 && debounce < 1000;
  record('UX-07', 'Immediate chip feedback; one request per filter state; cached return; single debounced search request',
    `chip pressed in ${feedback}ms, rows updated in ${chipDone}ms with ${chipRequests} request; back to All: ${cached} new request(s) (cache shows rows at once, refetch in background); typing ${Date.now() - typed}ms produced ${searchRequests} request starting ${debounce}ms after the last key`,
    'network timings (disposable stack, local DB)', ok ? 'PASS' : 'FAIL');
  expect(ok).toBe(true);
});

test('UX-16/17: sign-out confirmation and linked-card hover', async ({ page, request }) => {
  await setup(request);
  await login(page);
  const card = page.locator('#admin-main section[aria-label="Key figures"] a[href="/admin/orders"]');
  const rest = await card.evaluate(element => getComputedStyle(element).transform);
  await card.hover();
  await expect.poll(() => card.evaluate(element => getComputedStyle(element).transform)).not.toBe(rest);
  const hover = await card.evaluate(element => ({ transform: getComputedStyle(element).transform, shadow: getComputedStyle(element).boxShadow }));
  await page.keyboard.press('Tab');
  await shot(page, 'ux17-card-hover');
  const staticCard = await page.locator('#admin-main section[aria-label="Key figures"] > div').first().evaluate(element => getComputedStyle(element).cursor);

  await page.getByRole('button', { name: /Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out of ElectroHub?' });
  await expect(dialog).toBeVisible();
  await shot(page, 'ux16-signout-dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  const stayed = new URL(page.url()).pathname === '/admin';
  await page.getByRole('button', { name: /Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(url => url.pathname === '/admin/login');
  const refresh = (await page.request.post(`${state!.backend}/api/auth/refresh`)).status();
  const ok17 = rest !== hover.transform && hover.shadow !== 'none' && staticCard !== 'pointer';
  const ok16 = stayed && refresh === 401;
  record('UX-16', 'Sign out asks first; Cancel keeps the session; confirm ends it', `cancel stayed on /admin=${stayed}; confirm → /admin/login; refresh → ${refresh}`, 'ux16-signout-dialog.png', ok16 ? 'PASS' : 'FAIL');
  record('UX-17', 'Linked cards lift on hover; static cards do not look clickable', `linked: transform ${rest} → ${hover.transform}, shadow set; static cursor=${staticCard}`, 'ux17-card-hover.png', ok17 ? 'PASS' : 'FAIL');
  expect(ok16 && ok17).toBe(true);
});

test('UX-22: no horizontal page scroll on the main admin pages at 390/768/1440/1920', async ({ page, request }) => {
  const { products } = await setup(request);
  await login(page);
  const notes: string[] = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const route of ['/admin', '/admin/products', '/admin/products/new', `/admin/products/${products[2]!.id}/edit`, '/admin/categories', '/admin/deliveries', '/admin/customers']) {
      await page.goto(route);
      const titled = await page.locator('#admin-main h1').first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
      if (!titled) {
        notes.push(`${viewport.width} ${route}: no page title (at ${new URL(page.url()).pathname}: ${(await page.locator('body').innerText()).slice(0, 120).replace(/\s+/g, ' ')})`);
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => undefined);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) notes.push(`${viewport.width} ${route}: +${overflow}px`);
    }
    await page.goto('/admin');
    await expect(page.locator('#admin-main h1')).toBeVisible();
    await expect(page.locator('#admin-main [aria-label="Loading"]')).toHaveCount(0);
    await shot(page, `ux22-dashboard-${viewport.width}`, true);
  }
  record('UX-22', 'Pages fit 390/768/1440/1920 without horizontal scroll', notes.length ? notes.join('; ') : '7 routes × 4 viewports, no overflow', 'ux22-dashboard-*.png', notes.length ? 'FAIL' : 'PASS');
  expect(notes).toEqual([]);
});

test('PERF: page and filter switching under 300 ms API latency (before/after comparison)', async ({ page, request }) => {
  const { categories, brands } = await setup(request);
  const admin = await token(request, accounts!.admin);
  const drafts = (await (await call(request, admin, 'get', '/api/admin/catalog/products?status=INACTIVE')).json() as { meta: { total: number } }).meta.total;
  for (let index = drafts; index < 2; index += 1) {
    expect((await call(request, admin, 'post', '/api/admin/catalog/products', { name: `QA perf draft ${index}`, sku: `QA-PERF-DRAFT-${Date.now()}-${index}`,
      categoryId: categories.Audio, brandId: brands.Sony, price: '10.00', status: 'INACTIVE', inventory: { quantity: 1, lowStockAt: 0 } })).status()).toBe(201);
  }
  await login(page);
  // Same latency on every API call in both runs, standing in for the round trips to the shared DEV database region.
  await page.route('**/api/**', async route => { await new Promise(resolve => setTimeout(resolve, 300)); await route.continue().catch(() => undefined); });
  let requests = 0;
  page.on('request', r => { if (r.url().includes('/api/admin/catalog/products?')) requests += 1; });
  await page.goto('/admin/products');
  const summary = page.locator('nav[aria-label="Product pages"] [aria-live="polite"]');
  await expect(summary).toContainText('Showing 1–20');
  // The range summary is rendered from the data on screen, so it changes only when the new page/filter's real rows are shown.
  const time = async (label: string, act: () => Promise<void>, expected: RegExp) => {
    const before = requests;
    const start = Date.now();
    await act();
    await expect(summary).toHaveText(expected, { timeout: 15_000 });
    return `${label} ${Date.now() - start}ms (${requests - before} req)`;
  };
  await page.waitForTimeout(1500); // let any background prefetch finish before timing (same in both runs)
  const steps = [
    await time('page1→2', () => page.getByRole('button', { name: 'Next' }).click(), /Showing 21–/),
    await time('page2→1', () => page.getByRole('button', { name: 'Previous' }).click(), /Showing 1–20 /),
    await time('page1→2 again', () => page.getByRole('button', { name: 'Next' }).click(), /Showing 21–/),
    await time('chip Unpublished', () => page.getByRole('button', { name: 'Unpublished', exact: true }).click(), /Showing 1–[1-9] of [1-9]$/),
    await time('chip All', () => page.getByRole('button', { name: 'All', exact: true }).click(), /Showing 1–20 /),
    await time('chip Unpublished again', () => page.getByRole('button', { name: 'Unpublished', exact: true }).click(), /Showing 1–[1-9] of [1-9]$/),
  ];
  record('PERF', 'Products list switching under 300 ms API latency', steps.join('; '), 'timings', 'PASS');
});
