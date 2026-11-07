import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Task 05.2 existing-administrator MFA activation, real browser on the DISPOSABLE stack (fresh run of scripts/task05-2-browser-stack.cjs;
 * never shared DEV or PROD). The stack has no email provider, so the Owner's send reports a delivery failure (asserted); the link that
 * completes the journey is a seeded activation whose token only exists in the git-ignored credentials file. Synthetic *.invalid identities.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-browser-credentials.json'), 'utf8')) as
  { ownerEmail: string; password: string; activationToken: string; legacyDeliveryEmail: string; legacyLinkedEmail: string; legacyUnactivatedEmail: string };
const shots = path.resolve(here, '../../test-results/task05-2-activation-disposable/screens');
const NEW_PASSWORD = 'Activated-Unique-7-Pass';

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}
/** A code from a time step this account has not used yet: the server accepts each step once (per secret). */
const lastStep = new Map<string, number>();
async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30000) <= (lastStep.get(secret) ?? 0)) await new Promise(resolve => setTimeout(resolve, 1000));
  lastStep.set(secret, Math.floor(Date.now() / 30000));
  return totp(secret);
}
async function capture(page: Page, name: string, widths: number[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} @${width}px has horizontal page overflow`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
/** Mandatory first-factor enrollment; returns the TOTP secret. */
async function enroll(page: Page) {
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
  await page.getByLabel('Code from your app').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.getByLabel('I have saved these codes somewhere safe.').check();
  await page.getByRole('button', { name: 'I have saved my codes, continue' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  return secret;
}
async function passwordStep(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}
const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

test.describe.serial('Task 05.2 existing-administrator activation (disposable)', () => {
  let owner: Page;
  let ownerSecret = '';
  let activatedSecret = '';

  test('ACT-UI-01 Owner signs in with MFA and sees the activation actions only for eligible rows', async ({ browser }) => {
    owner = await newPage(browser);
    await passwordStep(owner, credentials.ownerEmail, credentials.password);
    ownerSecret = await enroll(owner);
    await owner.goto('/admin/settings/administrators');
    const eligible = owner.getByRole('button', { name: `Activate account for ${credentials.legacyDeliveryEmail}` });
    await expect(eligible).toBeVisible();
    await expect(owner.getByRole('button', { name: `Activate account for ${credentials.ownerEmail}` })).toHaveCount(0); // enrolled / self
    await expect(owner.getByText('Two-step verification enabled').first()).toBeVisible();
    // A pending activation shows its state with Resend / Revoke, never a second Activate.
    await expect(owner.getByRole('button', { name: `Activate account for ${credentials.legacyLinkedEmail}` })).toHaveCount(0);
    await expect(owner.getByRole('button', { name: `Resend activation link to ${credentials.legacyLinkedEmail}` })).toBeVisible();
    await expect(owner.getByText('Activation pending').first()).toBeVisible();
    await capture(owner, 'administrators', [390, 768, 1440, 1920]);
  });

  test('ACT-UI-02 the confirmation dialog is accessible, restores focus, and an undeliverable email is reported honestly', async () => {
    await owner.goto('/admin/settings/administrators');
    const trigger = owner.getByRole('button', { name: `Activate account for ${credentials.legacyDeliveryEmail}` });
    await trigger.click();
    const dialog = owner.getByRole('dialog', { name: 'Authorize administrator activation' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(credentials.legacyDeliveryEmail)).toBeVisible();
    await expect(dialog.getByText('30 minutes after it is sent')).toBeVisible();
    await expect(dialog.getByText(/grants privileged administrative access/i)).toBeVisible();
    await capture(owner, 'activation-dialog', [390, 1440]);
    await owner.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole('button', { name: 'Send activation link' }).click();
    // This stack has no email provider: the link exists but delivery failed, and the page must say so instead of claiming success.
    await expect(owner.getByText(/could not be delivered/i)).toBeVisible();
    await expect(owner.getByText('Email delivery failed').first()).toBeVisible();
    await owner.getByRole('button', { name: `Revoke activation for ${credentials.legacyDeliveryEmail}` }).click();
    await owner.getByRole('button', { name: 'Revoke activation' }).click();
    await expect(owner.getByRole('button', { name: `Activate account for ${credentials.legacyDeliveryEmail}` })).toBeVisible();
  });

  test('ACT-UI-03 an administrator redeems the link, rotates the password, enrolls MFA and enters the console', async ({ browser }) => {
    const admin = await newPage(browser);
    await admin.goto(`/admin/activate#token=${credentials.activationToken}`);
    await expect(admin.getByRole('heading', { name: 'Activate your administrator account' })).toBeVisible();
    await expect(admin.getByLabel('Administrator account')).toHaveValue(credentials.legacyLinkedEmail);
    expect(new URL(admin.url()).hash).toBe(''); // the token never stays in the address bar or history
    await admin.getByLabel('New password', { exact: true }).fill('weakpassword');
    await expect(admin.getByText('Add an uppercase letter and a number.')).toBeVisible();
    await admin.getByLabel('Confirm password').fill('different');
    await capture(admin, 'activation-form', [390, 768, 1440, 1920]);
    await admin.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await admin.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await admin.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(admin.getByRole('button', { name: 'Set up authenticator app' })).toBeVisible();
    await capture(admin, 'activation-enroll', [390, 1440]);
    activatedSecret = await enroll(admin);
    await expect(admin.getByText('Administrator', { exact: false }).first()).toBeVisible();
  });

  test('ACT-UI-04 the old password is dead, the new password plus TOTP signs in, and the link cannot be replayed', async ({ browser }) => {
    const old = await newPage(browser);
    await passwordStep(old, credentials.legacyLinkedEmail, credentials.password);
    await expect(old.getByLabel('6-digit code')).toHaveCount(0);
    await expect(old.getByRole('alert').first()).toBeVisible();

    const fresh = await newPage(browser);
    await passwordStep(fresh, credentials.legacyLinkedEmail, NEW_PASSWORD);
    await fresh.getByLabel('6-digit code').fill(await freshCode(activatedSecret));
    await fresh.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(fresh).toHaveURL(/\/admin\/?$/);

    const replay = await newPage(browser);
    await replay.goto(`/admin/activate#token=${credentials.activationToken}`);
    await expect(replay.getByText(/invalid, expired or already used/i)).toBeVisible();
    await expect(replay.getByLabel('New password', { exact: true })).toHaveCount(0);
    await capture(replay, 'activation-invalid', [390, 1440]);
  });

  test('ACT-UI-05 the Owner sees Enabled, and a still-unactivated administrator is told to ask an Owner', async ({ browser }) => {
    await owner.goto('/admin/settings/administrators');
    const row = owner.getByRole('row').filter({ hasText: credentials.legacyLinkedEmail });
    await expect(row.getByText('Two-step verification enabled')).toBeVisible();
    await expect(row.getByRole('button')).toHaveCount(0);

    const blocked = await newPage(browser);
    await passwordStep(blocked, credentials.legacyUnactivatedEmail, credentials.password);
    await expect(blocked.getByText('Your administrator account needs to be activated. Ask an Owner to send you a secure activation link.')).toBeVisible();
    await expect(blocked.getByLabel('6-digit code')).toHaveCount(0);
    await capture(blocked, 'login-needs-activation', [390, 1440]);
    expect(ownerSecret).not.toBe('');
  });
});
