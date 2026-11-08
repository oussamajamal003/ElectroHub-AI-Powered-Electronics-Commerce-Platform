import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

interface Credentials {
  ownerEmail: string;
  staffEmail: string;
  password: string;
  outboxDir: string;
}
const credentials = JSON.parse(readFileSync(path.resolve(process.cwd(), '../../.cache/task05-2-browser-credentials-5300.json'), 'utf8')) as Credentials;

function hotp(secret: string, step: bigint): string {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function currentTotpStep(): bigint { return BigInt(Math.floor(Date.now() / 30_000)); }

async function nextCapturedEmailCode(recipient: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const name of readdirSync(credentials.outboxDir)) {
      try {
        const message = JSON.parse(readFileSync(path.join(credentials.outboxDir, name), 'utf8')) as { to?: string; subject?: string; textContent?: string };
        if (message.to !== recipient || message.subject !== 'Verify your new ElectroHub administrator email') continue;
        const code = message.textContent?.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
        if (code) return code;
      } catch { /* A message may be in the middle of being written by the local capture provider. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The synthetic email OTP was not captured by the disposable QA outbox.');
}

async function keyboardSignIn(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
}

async function enrollAuthenticator(page: Page, email: string): Promise<string> {
  await keyboardSignIn(page, email, credentials.password);
  await expect(page.getByRole('button', { name: 'Set up authenticator app' })).toBeVisible();
  const setup = page.getByRole('button', { name: 'Set up authenticator app' });
  await setup.focus();
  await page.keyboard.press('Space');
  const secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
  await page.getByLabel('Code from your app').fill(hotp(secret, currentTotpStep()));
  await page.getByLabel('Code from your app').press('Enter');
  await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
  const saved = page.getByLabel('I have saved these codes somewhere safe.');
  await saved.focus();
  await page.keyboard.press('Space');
  const continueButton = page.getByRole('button', { name: 'I have saved my codes, continue' });
  await expect(continueButton).toBeEnabled();
  await continueButton.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/?$/);
  return secret;
}

async function emailChangeJourney(page: Page, email: string, secret: string) {
  const target = `changed-${randomUUID()}@qa.invalid`;
  await page.goto('/admin/profile');
  const changeButton = page.getByRole('button', { name: 'Change Email' });
  await expect(changeButton).toBeVisible();
  await changeButton.focus();
  await page.keyboard.press('Enter');
  const requestDialog = page.getByRole('dialog', { name: 'Change your email address' });
  await expect(requestDialog.getByLabel('New email')).toBeFocused();
  await requestDialog.getByLabel('New email').fill(target);
  await requestDialog.getByLabel('Current password').fill(credentials.password);
  await requestDialog.getByLabel('Current password').press('Enter');

  const stepUp = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(stepUp).toBeVisible();
  const stepUpCounter = currentTotpStep() + 1n;
  await stepUp.getByLabel('6-digit code').fill(hotp(secret, stepUpCounter));
  await stepUp.getByLabel('6-digit code').press('Enter');

  const verify = page.getByRole('dialog', { name: 'Verify your new email' });
  await expect(verify).toBeVisible();
  const emailCode = await nextCapturedEmailCode(target);
  await verify.getByLabel('6-digit verification code').fill(emailCode);
  await verify.getByLabel('6-digit verification code').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Email changed successfully' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/, { timeout: 10_000 });

  // The old address must not reach the password-to-MFA challenge.
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Authenticator app' })).toHaveCount(0);

  // A fresh TOTP step after the step-up proof authenticates the new email with the existing password and factor.
  await page.getByLabel('Email Address').fill(target);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('tab', { name: 'Authenticator app' })).toBeVisible();
  const nextStepDeadline = Date.now() + 65_000;
  while (currentTotpStep() <= stepUpCounter) {
    if (Date.now() > nextStepDeadline) throw new Error('Timed out waiting for a fresh TOTP period on the disposable stack.');
    await page.waitForTimeout(250);
  }
  await page.getByLabel('6-digit code').fill(hotp(secret, currentTotpStep()));
  await page.getByLabel('6-digit code').press('Enter');
  await expect(page).toHaveURL(/\/admin(?:\/profile)?\/?$/);
  await expect(page.getByRole('button', { name: 'Change Email' })).toBeVisible();
  return target;
}

test('ordinary ADMIN changes email through fresh MFA and new-email OTP, then signs in again', async ({ page }) => {
  const secret = await enrollAuthenticator(page, credentials.staffEmail);
  await emailChangeJourney(page, credentials.staffEmail, secret);
});

test('Owner changes email without losing Owner access or MFA', async ({ page }) => {
  const secret = await enrollAuthenticator(page, credentials.ownerEmail);
  await emailChangeJourney(page, credentials.ownerEmail, secret);
  await page.goto('/admin/settings/administrators');
  await expect(page.getByRole('heading', { name: 'Administrators', level: 1 })).toBeVisible();
  await expect(page.getByText('Owner', { exact: true }).first()).toBeVisible();
});
