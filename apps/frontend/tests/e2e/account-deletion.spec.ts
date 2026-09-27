import { expect, request, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runId = randomUUID();
const supportToken = 'electrohub-e2e-support-only';
const supportBaseURL = `http://localhost:${process.env.E2E_AUTH_BACKEND_PORT ?? '5202'}`;
const outboxDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/auth-outbox');
const email = (projectName: string) => `e2e-account-delete-${runId}-${projectName.toLowerCase()}@electrohub.invalid`;
const password = 'DeleteAccount#2026';
const deletedUserIds: string[] = [];

async function getVerificationCode(address: string) {
  const fileName = createHash('sha256').update(`${address}:Verify your ElectroHub account`).digest('hex');
  try {
    const record = JSON.parse(await readFile(path.join(outboxDirectory, `${fileName}.json`), 'utf8')) as { textContent: string };
    return record.textContent.match(/\b\d{6}\b/)?.[0] ?? '';
  } catch { return ''; }
}

async function openLogin(page: import('@playwright/test').Page) {
  await page.goto('/');
  if (await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible()) {
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Account' }).click();
  } else if (await page.getByRole('button', { name: 'Account', exact: true }).count()) {
    await page.getByRole('button', { name: 'Account', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await page.getByRole('navigation', { name: 'Mobile Navigation' }).getByRole('link', { name: 'Account' }).click();
  }
  return page.getByRole('dialog');
}

test.describe.serial('customer account deletion', () => {
  test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: supportBaseURL });
    await api.post('/api/__e2e/cleanup', { headers: { 'x-e2e-test-support-token': supportToken }, data: { runId } });
    await api.dispose();
  });

  test.afterAll(async () => {
    const api = await request.newContext({ baseURL: supportBaseURL });
    const cleanup = await api.post('/api/__e2e/cleanup', {
      headers: { 'x-e2e-test-support-token': supportToken },
      data: { runId, deletedUserIds },
    });
    expect(cleanup.status()).toBe(200);
    const counts = await cleanup.json() as { users: number };
    if (deletedUserIds.length) expect(counts.users).toBeGreaterThan(0);
    const repeated = await api.post('/api/__e2e/cleanup', {
      headers: { 'x-e2e-test-support-token': supportToken },
      data: { runId, deletedUserIds },
    });
    expect(await repeated.json()).toMatchObject({ users: 0 });
    await api.dispose();
  });

  test('password customer confirms deletion, loses access, and is cleaned up from test data', async ({ page }, testInfo) => {
    const address = email(testInfo.project.name);
    let accessToken = '';
    let accountId = '';
    page.on('response', async response => {
      if (new URL(response.url()).pathname !== '/api/auth/verify-email' || !response.ok()) return;
      const body = await response.json().catch(() => null);
      accessToken = body?.accessToken ?? '';
      accountId = body?.user?.id ?? '';
    });

    const authDialog = await openLogin(page);
    await authDialog.getByRole('button', { name: 'Register' }).click();
    await authDialog.getByLabel('Full Name').fill('Deletion Test Customer');
    await authDialog.getByLabel('Email Address').fill(address);
    await authDialog.getByLabel('Password', { exact: true }).fill(password);
    await authDialog.getByLabel('Confirm Password').fill(password);
    await authDialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(authDialog.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect.poll(() => getVerificationCode(address)).toMatch(/^\d{6}$/);
    const code = await getVerificationCode(address);
    const otpInputs = authDialog.getByRole('group', { name: 'Verification code' }).getByRole('textbox');
    await otpInputs.nth(0).focus();
    await page.keyboard.type(code);
    await authDialog.getByRole('button', { name: 'Verify' }).click();
    await expect(authDialog).not.toBeVisible();
    await expect.poll(() => accountId).toMatch(/^[0-9a-f-]{36}$/i);
    deletedUserIds.push(accountId);
    await page.goto('/account/profile');
    await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Delete Account' }).click();
    const deletion = page.getByRole('dialog', { name: 'Delete your account?' });
    await expect(deletion.getByRole('button', { name: 'Permanently Delete Account' })).toHaveCount(0);
    await deletion.getByRole('button', { name: 'Cancel' }).click();
    await expect(deletion).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Account' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete your account?' });
    await confirmation.getByLabel('Current Password').fill('incorrect-password');
    await confirmation.getByRole('button', { name: 'Confirm with Password' }).click();
    await expect(confirmation.getByRole('alert')).toHaveText(/Unable to verify this request|Your current password is incorrect/);

    await confirmation.getByLabel('Current Password').fill(password);
    await confirmation.getByRole('button', { name: 'Confirm with Password' }).click();
    await confirmation.getByLabel('Type DELETE to confirm').fill('DELETE');
    await confirmation.getByRole('button', { name: 'Permanently Delete Account' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('alert')).toHaveText('Your account has been deleted.');
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
    const oldAccess = await page.request.get(`${supportBaseURL}/api/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(oldAccess.status()).toBe(401);
  });
});
