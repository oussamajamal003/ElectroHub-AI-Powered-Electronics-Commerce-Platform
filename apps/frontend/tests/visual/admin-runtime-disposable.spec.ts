import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

// Run only with task05-2-browser-stack.cjs: synthetic credentials and real MFA, Express and PostgreSQL.
const credentials = JSON.parse(readFileSync(path.resolve('../../.cache/task05-2-browser-credentials-5288.json'), 'utf8'));
function totp(secret: string) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret) { value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(); const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
test('real settings and operational counts survive reload and transient failure', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(credentials.ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
  await page.getByLabel('Code from your app').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.getByLabel('I have saved these codes somewhere safe.').check();
  await page.getByRole('button', { name: 'I have saved my codes, continue' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  const statuses: { endpoint: string; status: number; requestId: string | undefined; cacheControl: string | undefined }[] = [];
  page.on('response', response => {
    const endpoint = new URL(response.url()).pathname;
    if (['/api/admin/settings/store', '/api/admin/dashboard/alerts'].includes(endpoint)) {
      statuses.push({ endpoint, status: response.status(), requestId: response.headers()['x-request-id'], cacheControl: response.headers()['cache-control'] });
    }
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Store Information', exact: true })).toBeVisible();
    await expect(page.getByText('Store settings could not be loaded.')).toBeHidden();
    await page.getByRole('button', { name: /^Alerts/ }).click();
    await expect(page.getByText('Operational alerts', { exact: true })).toBeVisible();
    await expect(page.getByText('Live counts from orders and inventory. Refreshed every minute.')).toBeVisible();
    await expect(page.getByText('Alerts could not be loaded.')).toBeHidden();
    await page.screenshot({ path: `test-results/admin-runtime/loaded-${attempt}.png` });
    await page.keyboard.press('Escape');
    await page.reload();
  }
  await page.getByLabel('Store email', { exact: true }).fill('@gmail.com');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('Enter a valid email address before @.')).toBeVisible();
  await page.getByLabel('Store email', { exact: true }).fill('support+runtime@example.com');
  await page.getByLabel('Store name', { exact: true }).fill('Disposable Runtime Store');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('Store settings saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Store name', { exact: true })).toHaveValue('Disposable Runtime Store');
  await expect(page.getByLabel('Store email', { exact: true })).toHaveValue('support+runtime@example.com');
  // Real schema-failure injection is restricted to this harness's disposable loopback database.
  const db = credentials.disposableDb;
  expect(db.database).toMatch(/^electrohub_disposable_browser_[a-f0-9]+$/);
  const sql = (query: string) => execFileSync(db.psql, ['-h', '127.0.0.1', '-p', String(db.port), '-U', 'postgres',
    '-d', db.database, '-v', 'ON_ERROR_STOP=1', '-c', query], { windowsHide: true, stdio: 'pipe' });
  sql('ALTER TABLE store_settings RENAME TO store_settings_runtime_probe');
  try {
    const failure = page.waitForResponse(response => response.url().endsWith('/api/admin/settings/store') && response.status() === 500);
    await page.reload();
    expect(await (await failure).json()).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again later.' } });
    await expect(page.getByText('Store settings could not be loaded.')).toBeVisible();
  } finally { sql('ALTER TABLE store_settings_runtime_probe RENAME TO store_settings'); }
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Store Information', exact: true })).toBeVisible();
  sql('ALTER TABLE inventory RENAME TO inventory_runtime_probe');
  try {
    const failure = page.waitForResponse(response => response.url().endsWith('/api/admin/dashboard/alerts') && response.status() === 500);
    await page.reload();
    expect(await (await failure).json()).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong. Please try again later.' } });
    await page.getByRole('button', { name: /^Alerts/ }).click();
    await expect(page.getByText('Alerts could not be loaded.')).toBeVisible();
  } finally { sql('ALTER TABLE inventory_runtime_probe RENAME TO inventory'); }
  await page.getByRole('button', { name: 'Retry alerts' }).click();
  await expect(page.getByText('Live counts from orders and inventory. Refreshed every minute.')).toBeVisible();
  expect(statuses.some(result => result.endpoint.endsWith('/store') && result.status === 200)).toBe(true);
  expect(statuses.some(result => result.endpoint.endsWith('/alerts') && result.status === 200)).toBe(true);
  expect(statuses.filter(result => result.status === 200).every(result => result.cacheControl?.includes('no-store') && result.requestId)).toBe(true);
  await test.info().attach('safe-http-statuses', { body: JSON.stringify(statuses, null, 2), contentType: 'application/json' });
});
