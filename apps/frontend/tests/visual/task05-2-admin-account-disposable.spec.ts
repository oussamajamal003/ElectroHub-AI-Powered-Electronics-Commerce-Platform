import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Task 05.2 addendum, real browser on the DISPOSABLE stack (fresh run of scripts/task05-2-browser-stack.cjs; never shared DEV or PROD):
 * Admin Profile Change Password and Danger Zone. The seeded owner is the only Owner (last-Owner block, then a real password change); the
 * seeded invitation becomes a standard administrator who deletes their own account. Synthetic *.invalid identities only.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const apiPort = process.env.TASK05_2_API_PORT ?? '5200';
const credentialsFile = apiPort === '5200' ? 'task05-2-browser-credentials.json' : `task05-2-browser-credentials-${apiPort}.json`;
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache', credentialsFile), 'utf8')) as
  { ownerEmail: string; password: string; invitationToken: string; disposableDb: { psql: string; port: number; database: string } };
const shots = path.resolve(here, '../../test-results/task05-2-account-disposable/screens');
const NEW_PASSWORD = 'Rotated-Owner-7-Pass';

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string, offsetSteps = 0) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}
/** A code from a time step this account has not used yet: the server accepts each step once. */
let lastStep = 0;
async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30000) <= lastStep) await new Promise(resolve => setTimeout(resolve, 1000));
  lastStep = Math.floor(Date.now() / 30000);
  return totp(secret);
}
async function signIn(page: Page, email: string, password: string, secret: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('6-digit code').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
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
/** Mandatory first-factor enrollment after a password (or invitation) step; returns the TOTP secret. */
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
/** Ages this admin's sessions past the step-up window in the DISPOSABLE database so the REAL server demands a step-up. */
function expireStepUp(email: string) {
  const { psql, port, database } = credentials.disposableDb;
  if (!/^electrohub_disposable_browser_[0-9a-f]+$/.test(database)) throw new Error('Refusing to touch a non-disposable database.');
  // Prisma stores DateTime as UTC in `timestamp without time zone`; plain now() would be the database session's local time.
  const sql = `UPDATE admin_sessions SET "mfaVerifiedAt" = (now() AT TIME ZONE 'UTC') - interval '20 minutes', "stepUpAt" = NULL
    WHERE "userId" = (SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}') AND "revokedAt" IS NULL`;
  execFileSync(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql]);
}
const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

test.describe.serial('Task 05.2 admin profile: password and Danger Zone (disposable)', () => {
  let owner: Page;
  let ownerSecret = '';

  test('ACC-01 the last active Owner sees the profile sections and is offered ownership transfer instead of deletion', async ({ browser }) => {
    owner = await newPage(browser);
    await owner.goto('/admin/login');
    await owner.getByLabel('Email Address').fill(credentials.ownerEmail);
    await owner.getByLabel('Password', { exact: true }).fill(credentials.password);
    await owner.getByRole('button', { name: 'Sign In' }).click();
    ownerSecret = await enroll(owner);
    await owner.goto('/admin/profile');
    await expect(owner.getByRole('heading', { name: 'Danger Zone' })).toBeVisible();
    const order = await owner.locator('h2').allInnerTexts();
    expect(order.filter(text => ['Personal details', 'Role and access', 'Change password', 'Security', 'Danger Zone'].includes(text)))
      .toEqual(['Personal details', 'Role and access', 'Change password', 'Security', 'Danger Zone']);
    // The last Owner is not stuck: the Danger Zone offers the succession wizard (journeys in task05-2-owner-succession-disposable.spec.ts).
    await expect(owner.getByText('You are the last active Owner', { exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: /Transfer Ownership & Delete Account/ })).toBeEnabled();
    await capture(owner, 'profile-owner', [390, 768, 1440, 1920]);
  });

  test('ACC-02 change password: live validation, step-up dialog, then every session ends and the new password is required', async ({ browser }) => {
    const second = await newPage(browser);
    await signIn(second, credentials.ownerEmail, credentials.password, ownerSecret);

    await owner.goto('/admin/profile');
    const section = owner.getByRole('region', { name: 'Change password' });
    await section.getByLabel('New password', { exact: true }).fill('weakpassword');
    await expect(section.getByText('Add an uppercase letter and a number.')).toBeVisible();
    await section.getByRole('button', { name: 'Show password' }).nth(1).click();
    await expect(section.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
    await section.getByLabel('Current password', { exact: true }).fill('Not-The-Password-1');
    await section.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await section.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await capture(owner, 'change-password-filled', [390, 1440]);
    await section.getByRole('button', { name: /Update password/ }).click();
    await expect(section.getByText('Your current password is incorrect.')).toBeVisible();

    // A fresh sign-in is inside the 10-minute step-up window, so the session is aged in the disposable database: the REAL server then
    // answers STEP_UP_REQUIRED (asserted below), the dialog verifies a real TOTP, and the change is retried for real.
    expireStepUp(credentials.ownerEmail);
    const demanded = owner.waitForResponse(async response => response.url().includes('/api/admin/me/password') && response.status() === 403
      && (await response.json().catch(() => null))?.error?.code === 'STEP_UP_REQUIRED');
    await section.getByLabel('Current password', { exact: true }).fill(credentials.password);
    await section.getByRole('button', { name: /Update password/ }).click();
    await demanded;
    const stepUp = owner.getByRole('dialog', { name: "Confirm it's you" });
    await expect(stepUp).toBeVisible();
    await capture(owner, 'change-password-step-up', [390, 1440]);
    await stepUp.getByLabel('6-digit code').fill(await freshCode(ownerSecret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    await expect(owner).toHaveURL(/\/admin\/login/);
    await expect(owner.getByRole('status')).toContainText('Your password was changed and every session was signed out.');
    await capture(owner, 'login-after-password-change', [390, 1440]);

    // The other session ended too, and a reload cannot restore the changed one.
    await second.goto('/admin/profile');
    await expect(second).toHaveURL(/\/admin\/login/);
    await owner.goto('/admin/analytics');
    await expect(owner).toHaveURL(/\/admin\/login/);
    await owner.getByLabel('Email Address').fill(credentials.ownerEmail);
    await owner.getByLabel('Password', { exact: true }).fill(credentials.password);
    await owner.getByRole('button', { name: 'Sign In' }).click();
    await expect(owner.getByText(/Invalid|incorrect/i).first()).toBeVisible();
    await owner.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await owner.getByRole('button', { name: 'Sign In' }).click();
    await expect(owner.getByLabel('6-digit code')).toBeVisible();
  });

  test('ACC-03 an invited administrator deletes their own account; access ends everywhere', async ({ browser }) => {
    const invitee = await newPage(browser);
    await invitee.goto(`/admin/invite#token=${credentials.invitationToken}`);
    await invitee.getByLabel('First name').fill('Temporary');
    await invitee.getByLabel('Last name').fill('Administrator');
    await invitee.getByLabel('Create a password').fill(credentials.password);
    await invitee.getByLabel('Confirm password').fill(credentials.password);
    await invitee.getByRole('button', { name: 'Create my account' }).click();
    await enroll(invitee);
    await invitee.goto('/admin/profile');
    const trigger = invitee.getByRole('button', { name: /Delete My Administrator Account/ });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const dialog = invitee.getByRole('dialog', { name: /Delete your administrator account/ });
    await expect(dialog).toContainText('newhire@qa.invalid');
    await capture(invitee, 'delete-dialog', [390, 768, 1440, 1920]);
    // Escape closes and returns focus to the button that opened the dialog.
    await invitee.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    const remove = dialog.getByRole('button', { name: 'Delete account' });
    await dialog.getByLabel('Current password', { exact: true }).fill(credentials.password);
    await dialog.getByLabel('Type DELETE to confirm').fill('delete');
    await expect(remove).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(remove).toBeEnabled();
    // Keyboard: the destructive button is reachable and activates with Enter.
    await remove.focus();
    await invitee.keyboard.press('Enter');
    await expect(invitee).toHaveURL(/\/admin\/login/);
    await expect(invitee.getByRole('status')).toContainText('Your administrator account was deleted and every session was signed out.');
    await capture(invitee, 'login-after-deletion', [390, 1440]);

    await invitee.goto('/admin/profile');
    await expect(invitee).toHaveURL(/\/admin\/login/);
    await invitee.getByLabel('Email Address').fill('newhire@qa.invalid');
    await invitee.getByLabel('Password', { exact: true }).fill(credentials.password);
    await invitee.getByRole('button', { name: 'Sign In' }).click();
    await expect(invitee.getByText(/Invalid|incorrect/i).first()).toBeVisible();
    expect(await invitee.evaluate(() => fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(response => response.status))).toBe(401);
  });

  test('ACC-04 reflow at a 200%-zoom-equivalent viewport (720 CSS px wide)', async ({ browser }) => {
    // Native browser zoom is not scriptable in headless Chromium; a 720px viewport is the CSS width a 1440px window has at 200%.
    const page = await newPage(browser);
    await signIn(page, credentials.ownerEmail, NEW_PASSWORD, ownerSecret);
    await page.goto('/admin/profile');
    await capture(page, 'profile-200pct-equivalent', [720]);
  });
});
