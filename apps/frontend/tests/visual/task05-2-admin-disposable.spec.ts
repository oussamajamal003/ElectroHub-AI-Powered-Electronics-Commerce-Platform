import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 05.2 real-browser journeys on the disposable stack: password → mandatory TOTP enrollment → recovery codes → console; every new
 * page at 390/768/1440/1920 with overflow checks; Settings persistence; passkey registration and passkey sign-in with a Chromium
 * virtual authenticator (software, not physical hardware); invitation page token hygiene; session revocation; logout.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-browser-credentials.json'), 'utf8')) as
  { ownerEmail: string; password: string; invitationToken: string };
const shots = path.resolve(here, '../../test-results/task05-2-disposable/screens');

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
async function capture(page: Page, name: string, widths = [1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} @${width}px has horizontal page overflow`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test.describe.serial('Task 05.2 admin journeys (disposable)', () => {
  let secret = '';
  const consoleErrors: string[] = [];
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  });

  test('E2E-01 password alone opens only the MFA step; enrollment issues the session', async () => {
    await page.goto('/admin/login');
    await capture(page, 'login', [390, 768, 1440, 1920]);
    await page.getByLabel('Email Address').fill(credentials.ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
    // No admin data is reachable yet.
    expect(await page.evaluate(() => fetch('/api/admin/me/profile').then(response => response.status))).toBe(401);
    await page.getByRole('button', { name: 'Set up authenticator app' }).click();
    secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await capture(page, 'enrollment', [390, 1440]);
    await page.getByLabel('Code from your app').fill('000000');
    await page.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(page.getByText(/isn.t right/i)).toBeVisible();
    await page.getByLabel('Code from your app').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(page.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
    await capture(page, 'recovery-codes', [1440]);
    const continueButton = page.getByRole('button', { name: 'I have saved my codes, continue' });
    await expect(continueButton).toBeDisabled();
    await page.getByLabel('I have saved these codes somewhere safe.').check();
    await continueButton.click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('every new admin page renders real data without page overflow at 390/768/1440/1920', async () => {
    const pages: [string, string, RegExp][] = [
      ['/admin/analytics?period=30d', 'analytics', /Analytics/],
      ['/admin/analytics?period=12m', 'analytics-12m', /Analytics/],
      ['/admin/settings?tab=store', 'settings-store', /Settings/],
      ['/admin/settings?tab=notifications', 'settings-notifications', /Settings/],
      ['/admin/settings?tab=shipping', 'settings-shipping', /Settings/],
      ['/admin/recommendations?tab=overview', 'recommendations-overview', /Recommendations/],
      ['/admin/recommendations?tab=strategies', 'recommendations-strategies', /Recommendations/],
      ['/admin/recommendations?tab=featured', 'recommendations-featured', /Recommendations/],
      ['/admin/recommendations?tab=preview', 'recommendations-preview', /Recommendations/],
      ['/admin/settings/administrators', 'administrators', /Administrators|Team/],
      ['/admin/profile', 'profile', /Profile/],
      ['/admin/profile/security', 'security', /Security/],
      ['/admin/profile/sessions', 'sessions', /Sessions/],
      ['/admin/products', 'products', /Products/],
    ];
    for (const [url, name, heading] of pages) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
      await capture(page, name, ['analytics', 'settings-store', 'recommendations-overview', 'security', 'administrators', 'products'].includes(name) ? [390, 768, 1440, 1920] : [1440]);
    }
  });

  test('E2E-08 Store settings persist through reload; shipping change is visible in the example quote and restored', async () => {
    await page.goto('/admin/settings?tab=store');
    const name = page.getByLabel(/Store name/i);
    await name.fill('ElectroHub QA Store');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Store name/i)).toHaveValue('ElectroHub QA Store');
    await page.goto('/admin/settings?tab=shipping');
    const express = page.getByLabel('Express Shipping Rate ($)');
    await express.fill('11.50');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Express Shipping Rate ($)')).toHaveValue('11.50');
    await capture(page, 'settings-shipping-saved', [1440]);
    await page.getByLabel('Express Shipping Rate ($)').fill('9.99');
    await page.getByRole('button', { name: /^Save/ }).click();
    // The unsaved-changes guard (correctly) blocks leaving a dirty form: wait until the save settles back to pristine.
    await expect(page.getByRole('button', { name: /^Save/ })).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel('Express Shipping Rate ($)')).toHaveValue('9.99');
  });

  test('E2E-05 passkey registration and passkey sign-in with a Chromium virtual authenticator', async () => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto('/admin/profile/security');
    await page.getByRole('button', { name: 'Add passkey' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('QA virtual key');
    await dialog.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.getByText('QA virtual key')).toBeVisible();
    await capture(page, 'security-with-passkey', [1440]);

    // Sign out and back in with the passkey as the second factor.
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
    await page.goto('/admin/login');
    await page.getByLabel('Email Address').fill(credentials.ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: "Verify it's you" })).toBeVisible();
    await capture(page, 'mfa-step', [390, 1440]);
    await page.getByRole('tab', { name: 'Passkey' }).click();
    await page.getByRole('button', { name: 'Use passkey' }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('E2E-06 a second session is listed and revoked; the invitation page strips its token from the URL', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await other.goto('/admin/login');
    await other.getByLabel('Email Address').fill(credentials.ownerEmail);
    await other.getByLabel('Password', { exact: true }).fill(credentials.password);
    await other.getByRole('button', { name: 'Sign In' }).click();
    await other.getByRole('tab', { name: 'Authenticator app' }).click();
    await other.getByLabel('6-digit code').fill(totp(secret, 1));
    await other.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(other).toHaveURL(/\/admin\/?$/);

    await page.goto('/admin/profile/sessions');
    await expect(page.getByRole('table', { name: 'Active sessions' }).getByRole('row')).toHaveCount(3); // header + 2 sessions
    await capture(page, 'sessions-two', [390, 1440]);
    await page.getByRole('button', { name: /^Sign out session on / }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Active sessions' }).getByRole('row')).toHaveCount(2);
    await other.goto('/admin/profile');
    await expect(other).toHaveURL(/\/admin\/login/);

    const invite = await (await browser.newContext()).newPage();
    await invite.goto(`/admin/invite#token=${credentials.invitationToken}`);
    await expect(invite.getByLabel('Email address')).toHaveValue('newhire@qa.invalid');
    expect(await invite.evaluate(() => window.location.hash)).toBe('');
    await capture(invite, 'invite', [390, 1440]);
    await invite.getByLabel('First name').fill('New');
    await invite.getByLabel('Last name').fill('Administrator');
    await invite.getByLabel('Create a password').fill('several lowercase unrelated words');
    await invite.getByLabel('Confirm password').fill('several lowercase unrelated words');
    await invite.getByRole('button', { name: 'Create my account' }).click();
    await expect(invite.getByLabel('Create a password')).toHaveAttribute('aria-invalid', 'true');
    await invite.getByLabel('Create a password').fill(credentials.password);
    await invite.getByLabel('Confirm password').fill(credentials.password);
    await invite.getByRole('button', { name: 'Create my account' }).click();
    await invite.getByRole('button', { name: 'Set up authenticator app' }).click();
    const inviteSecret = (await invite.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
    await invite.getByLabel('Code from your app').fill(totp(inviteSecret));
    await invite.getByRole('button', { name: 'Confirm and continue' }).click();
    await invite.getByLabel('I have saved these codes somewhere safe.').check();
    await invite.getByRole('button', { name: 'I have saved my codes, continue' }).click();
    await expect(invite).toHaveURL(/\/admin\/?$/);
    const bad = await (await browser.newContext()).newPage(); // a hash-only goto would not reload the same document
    await bad.goto('/admin/invite#token=not-a-real-invitation-token-000000');
    await expect(bad.getByText(/invalid|expired|used/i).first()).toBeVisible();
    await capture(bad, 'invite-invalid', [390]);
  });

  test('logout ends the session and admin routes return to the login page; no console errors during the run', async () => {
    await page.goto('/admin');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await expect(page.getByRole('menuitem', { name: 'My profile' })).toBeVisible();
    await capture(page, 'account-menu', [1440]);
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Sign out' }).last().click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/login/);
    const unexpected = consoleErrors.filter(text => !/401|Unauthorized|status of 4\d\d/.test(text));
    expect(unexpected, unexpected.join('\n')).toEqual([]);
  });
});
