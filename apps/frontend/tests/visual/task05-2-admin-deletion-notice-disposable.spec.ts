import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Task 05.2 deleted administrators + one-time Owner notice, real browser on the DISPOSABLE stack (scripts/task05-2-browser-stack.cjs; never shared
 * DEV or PROD). A staff administrator deletes their own account through the API, then the Owner opens Settings → Administrators.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = process.env.TASK05_2_API_PORT || '5200';
const credentials = JSON.parse(readFileSync(path.resolve(here, `../../../../.cache/task05-2-browser-credentials${API_PORT === '5200' ? '' : `-${API_PORT}`}.json`), 'utf8')) as
  { ownerEmail: string; staffEmail: string; password: string };
const shots = path.resolve(here, '../../test-results/task05-2-deletion-notice-disposable/screens');
const BASE = `http://localhost:${process.env.TASK05_2_FRONTEND_PORT || '3200'}`;

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
async function enroll(api: APIRequestContext, email: string) {
  const login = await (await api.post('/api/auth/login', { data: { email, password: credentials.password } })).json();
  const start = await (await api.post('/api/auth/admin/mfa/enrollment/start', { data: { mfaToken: login.mfaToken } })).json();
  const confirm = await api.post('/api/auth/admin/mfa/enrollment/confirm', { data: { mfaToken: login.mfaToken, factorId: start.factorId, code: await freshCode(start.secret) } });
  expect(confirm.status()).toBe(200);
  return { secret: start.secret as string, accessToken: (await confirm.json()).accessToken as string };
}
async function capture(page: Page, name: string, widths: number[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} @${width}px overflows horizontally`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('DNOTE-UI: a deleted administrator disappears from the table and the Owner sees a small notice exactly once', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const owner = await enroll(api, credentials.ownerEmail);
  const staff = await enroll(api, credentials.staffEmail);
  const deleted = await api.post('/api/admin/me/delete', { data: { currentPassword: credentials.password, confirmation: 'DELETE' }, headers: { Authorization: `Bearer ${staff.accessToken}` } });
  expect(deleted.status()).toBe(200);
  // The API agrees with the table: the anonymized account is not listed, and the Owner has exactly one new notice.
  const listed = await (await api.get('/api/admin/administrators', { headers: { Authorization: `Bearer ${owner.accessToken}` } })).json();
  expect(JSON.stringify(listed.data)).not.toMatch(/deleted\.invalid/);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(credentials.ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('6-digit code').fill(await freshCode(owner.secret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await page.goto('/admin/settings/administrators');
  await expect(page.getByRole('heading', { name: 'Administrators', level: 1 })).toBeVisible();

  const banner = page.getByRole('status', { name: 'Administrator deletion notice' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Administrator account deleted');
  await expect(banner).toContainText('Required audit records remain available');
  await expect(page.getByText('Deleted Administrator')).toHaveCount(0);
  await expect(page.getByText(/deleted-admin-/)).toHaveCount(0);
  await expect(page.getByText(credentials.staffEmail)).toHaveCount(0);
  await capture(page, 'notice-visible', [390, 768, 1440]);

  // Keyboard: the dismiss button is reachable and operable without a mouse.
  const dismiss = page.getByRole('button', { name: 'Dismiss notice' });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner).toHaveCount(0);

  // Acknowledged server-side: it stays away after a refresh and in a fresh browser context.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Administrators', level: 1 })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Administrator deletion notice' })).toHaveCount(0);
  await capture(page, 'notice-dismissed', [1440]);
  const notice = await (await api.get('/api/admin/administrators/deletion-notice', { headers: { Authorization: `Bearer ${owner.accessToken}` } })).json();
  expect(notice.data).toEqual({ count: 0, through: null });
  await context.close();
  await api.dispose();
});
