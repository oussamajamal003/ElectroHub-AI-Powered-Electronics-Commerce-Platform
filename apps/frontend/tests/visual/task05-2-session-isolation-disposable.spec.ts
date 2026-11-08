import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request as playwrightRequest, test, type BrowserContext, type Page, type Request } from '@playwright/test';

/**
 * Task 05.2 ADMIN / CUSTOMER session isolation, real browser on the DISPOSABLE stack (apps/backend: node scripts/task05-2-browser-stack.cjs; never shared
 * DEV or PROD). One browser context holds both sessions at once, as one person's browser would. Synthetic *.invalid identities only.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = process.env.TASK05_2_API_PORT || '5200';
const credentials = JSON.parse(readFileSync(path.resolve(here, `../../../../.cache/task05-2-browser-credentials${API_PORT === '5200' ? '' : `-${API_PORT}`}.json`), 'utf8')) as
  { ownerEmail: string; customerEmail: string; password: string };
const BASE = `http://localhost:${process.env.TASK05_2_FRONTEND_PORT || '3200'}`;
const shots = path.resolve(here, '../../test-results/task05-2-session-isolation-disposable/screens');

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}
const lastStep = new Map<string, number>();
async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30000) <= (lastStep.get(secret) ?? 0)) await new Promise(resolve => setTimeout(resolve, 1000));
  const step = Math.floor(Date.now() / 30000);
  lastStep.set(secret, step);
  return totp(secret, step);
}

let ownerSecret = '';
test.describe.configure({ mode: 'serial' });

// The owner enrolls once per stack; the disposable secret is kept beside the stack's credentials so the spec can be re-run on the same stack.
const secretFile = path.resolve(here, `../../../../.cache/task05-2-session-isolation-secret-${API_PORT}.txt`);
test.beforeAll(async () => {
  if (existsSync(secretFile)) { ownerSecret = readFileSync(secretFile, 'utf8').trim(); return; }
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await (await api.post('/api/auth/login', { data: { email: credentials.ownerEmail, password: credentials.password } })).json();
  const start = await (await api.post('/api/auth/admin/mfa/enrollment/start', { data: { mfaToken: login.mfaToken } })).json();
  const confirm = await api.post('/api/auth/admin/mfa/enrollment/confirm', { data: { mfaToken: login.mfaToken, factorId: start.factorId, code: await freshCode(start.secret) } });
  expect(confirm.status()).toBe(200);
  ownerSecret = start.secret;
  writeFileSync(secretFile, ownerSecret);
  await api.dispose(); // that API enrollment created its own administrator session; it is not the browser's
});

async function signInAdmin(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(credentials.ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('6-digit code').fill(await freshCode(ownerSecret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(adminMenu(page)).toBeVisible();
}
async function signInCustomer(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Email Address' }).fill(credentials.customerEmail);
  await dialog.getByLabel('Password', { exact: true }).fill(credentials.password);
  await dialog.getByLabel('Password', { exact: true }).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/account/);
}
const cookieNames = async (context: BrowserContext) => (await context.cookies()).map(cookie => cookie.name).sort();
const guestAccountButton = (page: Page) => page.getByRole('button', { name: 'Account', exact: true });
const adminMenu = (page: Page) => page.getByRole('button', { name: /Account menu for Olivia/ });
const customerMenu = (page: Page) => page.getByRole('button', { name: /Account menu for Shopper/ });

test('Journey A (ISO-02): an administrator-only browser keeps the storefront in guest mode and the customer APIs closed', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  const customerCalls: string[] = [];
  page.on('request', request => { if (/\/api\/(cart|wishlist|orders)/.test(request.url())) customerCalls.push(request.headers()['authorization'] ?? 'none'); });
  await signInAdmin(page);
  expect(await cookieNames(context)).toEqual(['electrohub_admin_refresh']);
  await page.goto('/products');
  await expect(guestAccountButton(page)).toBeVisible();
  await expect(page.getByText(/Olivia|owner@qa\.invalid/)).toHaveCount(0);
  await expect(customerMenu(page)).toHaveCount(0);
  // Storefront private routes never authenticate from the administrator session.
  expect(customerCalls.every(header => header === 'none')).toBe(true);
  const cart = await page.evaluate(async () => (await fetch('/api/cart', { credentials: 'include' })).status);
  expect([401, 403]).toContain(cart);
  await page.goto('/account');
  await expect(page).not.toHaveURL(/\/account$/);
  await expect(adminMenu(page)).toHaveCount(0);
  await page.goto('/admin');
  await expect(adminMenu(page)).toBeVisible(); // the administrator session is still valid
  await page.screenshot({ path: path.join(shots, 'journey-a-admin-only-return.png') });
  await context.close();
});

test('Journey B (ISO-03): a customer-only browser cannot enter the Admin Console and stays signed in', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  await signInCustomer(page);
  expect(await cookieNames(context)).toEqual(['electrohub_customer_refresh']);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/admin/settings/administrators');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/account');
  await expect(customerMenu(page)).toBeVisible();
  await context.close();
});

test('Journeys C/D/E/F (ISO-04..15): both sessions coexist, restore on reload, refresh and sign out independently', async ({ browser }) => {
  const context = await browser.newContext();
  const adminTab = await context.newPage();
  const storeTab = await context.newPage();
  const adminTokens = new Set<string>(); const customerTokens = new Set<string>();
  const trace = (request: Request) => {
    const header = request.headers()['authorization'];
    if (!header) return;
    if (/\/api\/admin\//.test(request.url())) adminTokens.add(header);
    else if (/\/api\/(cart|wishlist|orders)/.test(request.url())) customerTokens.add(header);
  };
  adminTab.on('request', trace); storeTab.on('request', trace);

  // C: sign in as ADMIN, then separately as CUSTOMER, in one browser.
  await signInAdmin(adminTab);
  await signInCustomer(storeTab);
  const cookies = await context.cookies();
  expect(cookies.map(cookie => cookie.name).sort()).toEqual(['electrohub_admin_refresh', 'electrohub_customer_refresh']);
  expect(cookies.find(cookie => cookie.name === 'electrohub_admin_refresh')?.path).toBe('/api/auth/admin');
  expect(cookies.find(cookie => cookie.name === 'electrohub_customer_refresh')?.path).toBe('/api/auth/customer');
  expect(cookies.every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true);
  await expect(customerMenu(storeTab)).toBeVisible();
  await expect(adminMenu(adminTab)).toBeVisible();
  await adminTab.reload(); await storeTab.reload();
  await expect(adminMenu(adminTab)).toBeVisible();
  await expect(customerMenu(storeTab)).toBeVisible();
  await expect(adminMenu(storeTab)).toHaveCount(0);
  await storeTab.goto('/products'); await expect(customerMenu(storeTab)).toBeVisible();
  await adminTab.goto('/admin/settings'); await expect(adminMenu(adminTab)).toBeVisible();
  // No customer API ever carried an administrator token, nor the reverse.
  expect([...adminTokens].filter(token => customerTokens.has(token))).toEqual([]);
  await adminTab.screenshot({ path: path.join(shots, 'journey-c-admin-tab.png') });
  await storeTab.screenshot({ path: path.join(shots, 'journey-c-store-tab.png') });

  // F: simultaneous reloads in two tabs (concurrent refreshes of each scope) never swap roles or sign anyone out.
  const second = await context.newPage();
  const refreshes: string[] = [];
  for (const tab of [adminTab, storeTab, second]) tab.on('response', response => { if (/\/api\/auth\/(admin|customer)\/refresh/.test(response.url())) refreshes.push(`${response.url().split('/').slice(-2).join('/')}:${response.status()}`); });
  await Promise.all([adminTab.reload(), storeTab.reload(), second.goto('/admin/settings')]);
  await expect(adminMenu(adminTab), `admin tab at ${adminTab.url()} after refreshes ${refreshes.join(' ')}`).toBeVisible();
  await expect(customerMenu(storeTab)).toBeVisible();
  await expect(adminMenu(second)).toBeVisible();
  await second.close();

  // D: sign out of the Admin Console only.
  await adminMenu(adminTab).click();
  await adminTab.getByRole('menuitem', { name: /sign out/i }).click();
  await adminTab.getByRole('dialog').getByRole('button', { name: /^sign out$/i }).click();
  await expect(adminTab).toHaveURL(/\/admin\/login/);
  expect(await cookieNames(context)).toEqual(['electrohub_customer_refresh']);
  await storeTab.reload();
  await expect(customerMenu(storeTab)).toBeVisible();
  await adminTab.goto('/admin');
  await expect(adminTab).toHaveURL(/\/admin\/login/);

  // E: re-establish ADMIN, then sign out of the storefront only.
  await signInAdmin(adminTab);
  expect(await cookieNames(context)).toEqual(['electrohub_admin_refresh', 'electrohub_customer_refresh']);
  await storeTab.reload();
  await customerMenu(storeTab).click();
  await storeTab.getByRole('menuitem', { name: /sign out/i }).click();
  await storeTab.getByRole('dialog').getByRole('button', { name: /^sign out$/i }).click();
  await expect(guestAccountButton(storeTab)).toBeVisible();
  expect(await cookieNames(context)).toEqual(['electrohub_admin_refresh']);
  await adminTab.reload();
  await expect(adminMenu(adminTab)).toBeVisible();
  await storeTab.reload();
  await expect(guestAccountButton(storeTab)).toBeVisible();

  // F: one scope revoked server-side while the other stays active.
  await signInCustomer(storeTab);
  const revoker = await playwrightRequest.newContext({ baseURL: BASE, storageState: await context.storageState() });
  const out = await revoker.post('/api/auth/customer/logout');
  expect(out.status()).toBe(200);
  await revoker.dispose();
  await storeTab.reload();
  await expect(guestAccountButton(storeTab)).toBeVisible();
  await adminTab.reload();
  await expect(adminMenu(adminTab)).toBeVisible();
  await context.close();
});

test('Journey H: the storefront guest state and both account menus stay usable at 390/768/1440/1920 and by keyboard', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  await signInAdmin(page);
  for (const width of [390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.goto('/products');
    await expect(adminMenu(page)).toHaveCount(0);
    await expect(page.getByText(/Olivia|owner@qa\.invalid/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `@${width}px storefront overflows`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, `journey-h-store-guest-${width}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  // Keyboard: the guest Account button opens the sign-in dialog with Enter and Space, Escape closes it, focus returns to the button.
  const account = guestAccountButton(page);
  await account.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(account).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
  await context.close();
});
