import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 03.9 REAL STACK (no interception): isolated frontend -> isolated backend -> disposable PostgreSQL -> worker-thread PDF
 * renderer. Needs `node scripts/document-isolated-check.cjs --seed-ui` and `--customer-b` (apps/backend) for synthetic orders and
 * the second customer. Refuses any non-local base URL. Screenshots land in test-results/isolated/documents-*.png.
 *   ISOLATED_BASE_URL=http://localhost:3000 ISOLATED_FIXTURE_CREDENTIALS=../backend/.isolated/fixture-credentials.txt \
 *     npx playwright test -c playwright.isolated.config.ts order-documents
 */
const base = process.env.ISOLATED_BASE_URL ?? 'http://127.0.0.1:3200';
const credentialsFile = process.env.ISOLATED_FIXTURE_CREDENTIALS;
test.skip(!credentialsFile, 'Isolated fixture credentials are not configured.');
test.describe.configure({ mode: 'serial' });

const credentials = () => Object.fromEntries(readFileSync(credentialsFile!, 'utf8').split(/\r?\n/).filter(Boolean).map(line => line.split('=') as [string, string]));
const shot = (name: string) => `test-results/isolated/documents-${name}.png`;

async function signIn(page: Page, who: 'customer' | 'customer_b' = 'customer') {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):(3000|3200)$/.test(base)) throw new Error('Refusing: local isolated frontend only.');
  const c = credentials();
  const login = await page.request.post(`${base}/api/auth/login`, { data: { email: c[who], password: c[`${who}_password`] } });
  expect(login.status()).toBe(200);
  return (await login.json()).accessToken as string;
}

async function references(page: Page, token: string) {
  const list = await (await page.request.get(`${base}/api/orders?page=1&pageSize=50`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const orders = list.data as { orderReference: string; paymentState: string; status: string; items: unknown[] }[];
  return { paid: orders.find(order => order.paymentState === 'PAID')!.orderReference,
    pending: orders.find(order => order.paymentState === 'PENDING')?.orderReference };
}

/** Headless Chromium reports no inline PDF viewer, so the app must show its download fallback; headed browsers show the blob frame. */
async function expectPreview(page: Page, dialog: ReturnType<Page['getByRole']>) {
  const native = await page.evaluate(() => (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false);
  if (native) await expect(dialog.locator('iframe[src^="blob:"]')).toBeVisible({ timeout: 30_000 });
  else {
    await expect(dialog.getByText('This browser can’t show PDFs inside the page.')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  }
  return native;
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Scoped to the Task 03.9 UI (panels, chooser and preview dialogs); unrelated shell findings are tracked separately. */
async function axe(page: Page) {
  await page.addScriptTag({ content: readFileSync('../../node_modules/axe-core/axe.min.js', 'utf8') });
  return page.evaluate(async () => (await Reflect.get(window, 'axe').run({ include: [['[data-order-documents]'], ['[role=dialog]'], ['[aria-label^="Documents for order"]']] },
    { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }))
    .violations.map((violation: { id: string; nodes: { target: string[] }[] }) => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`));
}

test('Order Details: real PDF download, preview and read-only behaviour', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const token = await signIn(page);
  const { paid } = await references(page, token);
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && !request.url().includes('/api/auth/')) writes.push(`${request.method()} ${request.url()}`); });
  await page.goto(`${base}/orders/${paid}`);
  const panel = page.getByRole('region', { name: 'Documents' });
  await expect(panel.getByRole('button', { name: /^Download PDF: Order invoice \(non-tax\)/ })).toBeVisible({ timeout: 30_000 });
  for (const label of ['Order invoice (non-tax)', 'Payment receipt', 'Order summary']) {
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: `Download PDF: ${label}, order ${paid}` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`^ElectroHub-${paid}-(invoice|receipt|summary)\\.pdf$`));
    const bytes = readFileSync((await file.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10_000);
    await expect(page.getByText(`${label} PDF download started.`)).toBeAttached();
    await expect(page.getByText(/saved/i)).toHaveCount(0);
  }
  await panel.getByRole('button', { name: `View PDF: Order invoice (non-tax), order ${paid}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Order invoice (non-tax)' });
  const native = await expectPreview(page, dialog);
  if (!native) {
    // The fallback reuses the previewed bytes: a working download without a second render request.
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PDF', exact: true }).click();
    expect(readFileSync((await (await download).path())!).subarray(0, 5).toString()).toBe('%PDF-');
  }
  await page.waitForTimeout(1500); // native viewer paint for the evidence screenshot only; assertions above are event-based
  await page.screenshot({ path: shot('details-preview-1440') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByRole('button', { name: `View PDF: Order invoice (non-tax), order ${paid}` })).toBeFocused();
  expect(writes, 'document reads must not issue any mutation request').toEqual([]);
  expect(await axe(page)).toEqual([]);
});

test('Order Details: another customer gets the same 404 for documents', async ({ page }) => {
  const tokenA = await signIn(page);
  const { paid } = await references(page, tokenA);
  const tokenB = await signIn(page, 'customer_b');
  const foreign = await page.request.get(`${base}/api/orders/${paid}/documents/invoice`, { headers: { Authorization: `Bearer ${tokenB}` } });
  const unknown = await page.request.get(`${base}/api/orders/ORD-00000000-0000-4000-8000-000000000000/documents/invoice`, { headers: { Authorization: `Bearer ${tokenB}` } });
  expect(foreign.status()).toBe(404);
  expect(await foreign.text()).toBe(await unknown.text());
  expect(foreign.headers()['content-type']).toContain('application/json');
});

test('Logout while a preview is open leaves nothing for the next customer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const token = await signIn(page);
  const { paid } = await references(page, token);
  await page.goto(`${base}/orders/${paid}`);
  await page.getByRole('button', { name: `View PDF: Payment receipt, order ${paid}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Payment receipt' });
  await expectPreview(page, dialog);
  // Session end (the app's own expiry event), then customer B signs in in the same tab.
  await page.evaluate(() => window.dispatchEvent(new Event('electrohub:session-expired')));
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('iframe[src^="blob:"]')).toHaveCount(0);
  await signIn(page, 'customer_b');
  await page.goto(`${base}/orders/${paid}`);
  await expect(page.getByRole('heading', { name: 'Order not found' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Documents' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`responsive documents at ${viewport.width}px (Confirmation, Details, My Orders chooser)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const token = await signIn(page);
    const { paid, pending } = await references(page, token);
    await page.goto(`${base}/checkout/confirmation/${paid}`);
    const confirmation = page.getByRole('region', { name: 'Your documents' });
    await expect(confirmation.getByRole('button', { name: /^View PDF: Payment receipt/ })).toBeVisible({ timeout: 30_000 });
    // Placement: after the order card and before the outside navigation; View Order Details stays the primary link.
    const order = await page.getByRole('region', { name: 'Order confirmation' }).boundingBox();
    const documents = await confirmation.boundingBox();
    const details = await page.getByRole('link', { name: 'View Order Details' }).boundingBox();
    expect(documents!.y).toBeGreaterThan(order!.y + order!.height - 1);
    expect(details!.y).toBeGreaterThan(documents!.y + documents!.height - 1);
    expect(await noHorizontalOverflow(page)).toBe(true);
    await confirmation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`confirmation-${viewport.width}`), fullPage: true });

    await page.goto(`${base}/orders/${pending ?? paid}`);
    const panel = page.getByRole('region', { name: 'Documents' });
    await expect(panel.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });
    for (const button of await panel.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43);
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`details-${viewport.width}`), fullPage: true });

    await page.goto(`${base}/orders?page=2`);
    const trigger = page.getByRole('button', { name: /^Documents for order / }).first();
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
    await expect(page).toHaveURL(/\/orders\?page=2$/);
    const chooser = page.getByRole('dialog', { name: 'Documents' });
    await expect(chooser.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });
    const close = (await chooser.getByRole('button', { name: 'Close documents' }).boundingBox())!;
    expect(close.x + close.width).toBeLessThanOrEqual(viewport.width);
    expect(close.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: shot(`orders-chooser-${viewport.width}`) });
    if (viewport.width === 390) {
      await chooser.getByRole('button', { name: /^View PDF: Order invoice/ }).click();
      const preview = page.getByRole('dialog', { name: 'Order invoice (non-tax)' });
      await expectPreview(page, preview);
      const closePreview = (await preview.getByRole('button', { name: 'Close preview' }).boundingBox())!;
      expect(closePreview.x + closePreview.width).toBeLessThanOrEqual(viewport.width);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: shot('preview-390') });
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
  });
}
