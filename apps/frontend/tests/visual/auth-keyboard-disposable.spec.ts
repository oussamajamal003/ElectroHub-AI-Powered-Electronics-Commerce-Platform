import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Locator } from '@playwright/test';
import axe from 'axe-core';

const credentials = JSON.parse(readFileSync('../../.cache/task05-2-browser-credentials.json', 'utf8')) as {
  ownerEmail: string; password: string; invitationToken: string; activationToken: string; customerEmail: string;
};
function totp(secret: string, offset = 0) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret) { value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(); const start = hash[19] & 15;
  return String((hash.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
async function activate(page: Page, target: Locator, key = 'Enter') {
  await target.focus(); await expect(target).toBeFocused(); await page.keyboard.press(key);
}
async function password(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').focus(); await page.keyboard.type(credentials.ownerEmail);
  await page.keyboard.press('Tab'); await page.keyboard.type(credentials.password);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.log('AUTH_QA_RUNTIME', error.name, error.message));
});

test('keyboard enrollment, TOTP/recovery Enter, real passkey ceremony and logout', async ({ page }) => {
  console.log('AUTH-K01: password and enrollment');
  await password(page);
  await activate(page, page.getByRole('button', { name: 'Set up authenticator app' }), 'Space');
  const secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
  await page.getByLabel('Code from your app').focus(); await page.keyboard.type(totp(secret)); await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
  const codes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  await expect(page.getByRole('button', { name: 'I have saved my codes, continue' })).toBeDisabled();
  await activate(page, page.getByLabel('I have saved these codes somewhere safe.'), 'Space');
  await activate(page, page.getByRole('button', { name: 'I have saved my codes, continue' }));
  await expect(page).toHaveURL(/\/admin\/?$/);
  console.log('AUTH-K02: TOTP input Enter at 390/768/1440');
  // Test the native implicit submit on every supported layout, with an honest failure response.
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
  await password(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('tab', { name: 'Authenticator app' })).toHaveAttribute('aria-selected', 'true');
    const otp = page.getByRole('textbox', { name: '6-digit code' });
    await otp.focus(); await page.keyboard.type('123'); await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('12'); await page.keyboard.press('Enter');
    await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const otp = page.getByRole('textbox', { name: '6-digit code' });
  await otp.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(totp(secret, 1)); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/?$/);
  console.log('AUTH-K03: recovery input Enter');
  // Baseline reproduction: Enter in a recovery input must submit through a native form.
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
  await password(page);
  await page.getByRole('tab', { name: 'Authenticator app' }).focus(); await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Recovery code' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.getByRole('textbox', { name: 'Recovery code', exact: true }).focus(); await page.keyboard.type(codes[0]); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/?$/);
  console.log('AUTH-K04: native label dialog and WebAuthn registration');

  const cdp = await page.context().newCDPSession(page); await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/profile/security');
  // Force only the recent-verification gate to exercise its actual UI and real server code verification.
  await page.route('**/api/admin/me/security/passkeys/options', route => route.fulfill({ status: 403,
    contentType: 'application/json', body: JSON.stringify({ error: { code: 'STEP_UP_REQUIRED', message: 'Fresh verification required.' } }) }), { times: 1 });
  await activate(page, page.getByRole('button', { name: 'Add passkey' }));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add passkey' })).toBeFocused();
  await activate(page, page.getByRole('button', { name: 'Add passkey' }));
  await dialog.getByLabel('Name').focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Keyboard QA key');
  await page.keyboard.press('Enter');
  const stepUp = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(stepUp).toBeVisible();
  const stepOtp = stepUp.getByRole('textbox', { name: '6-digit code' });
  await expect(stepUp.getByRole('tab', { name: 'Authenticator app' })).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(stepOtp).toBeFocused(); await page.keyboard.type('12'); await page.keyboard.press('Enter');
  await expect(stepUp.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-labelledby'))).toBe(await stepUp.getAttribute('aria-labelledby')); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/auth-keyboard/step-up-${width}.png` });
  }
  await stepUp.getByRole('tab', { name: 'Authenticator app' }).focus(); await page.keyboard.press('ArrowRight');
  await stepUp.getByRole('textbox', { name: 'Recovery code' }).focus(); await page.keyboard.type(codes[1]); await page.keyboard.press('Enter');
  await expect(stepUp).toBeHidden(); await expect(page.getByText('Keyboard QA key', { exact: true })).toBeVisible();
  console.log('AUTH-K05: keyboard WebAuthn sign-in');
  const logout = async () => {
    await activate(page, page.getByRole('button', { name: /account menu/i }));
    await activate(page, page.getByRole('menuitem', { name: 'Sign out' }));
    await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }));
    await expect(page).toHaveURL(/\/admin\/login/);
  };
  // UI logout is asserted below; this reset keeps focus on the login MFA regression.
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
  await password(page);
  await page.getByRole('tab', { name: 'Authenticator app' }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Passkey' })).toHaveAttribute('aria-selected', 'true');
  // Failure injection is limited to error paths. Registration and successful sign-in use real signature verification.
  const passkey = page.getByRole('button', { name: 'Use passkey' });
  await page.route('**/mfa/webauthn/options', route => route.abort('failed'), { times: 1 });
  await activate(page, passkey); await expect(page.getByText('Unable to connect. Check your connection and try again.')).toBeVisible();
  await expect(passkey).toBeEnabled();
  await page.evaluate(() => {
    const original = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async () => {
      navigator.credentials.get = original;
      throw new DOMException('QA cancellation', 'NotAllowedError');
    };
  });
  await activate(page, passkey, 'Space');
  await expect(page.getByText(/passkey prompt was cancelled or timed out/)).toBeVisible(); await expect(passkey).toBeEnabled();
  await expect(passkey).toBeFocused();
  await page.route('**/mfa/webauthn/verify', async route => {
    const body = route.request().postDataJSON(); body.response.response.signature = 'AAAA';
    await route.continue({ postData: JSON.stringify(body) });
  }, { times: 1 });
  const invalid = page.waitForResponse(response => response.url().includes('/mfa/webauthn/verify'));
  await activate(page, passkey); expect((await invalid).ok()).toBe(false); await expect(passkey).toBeEnabled();
  await expect(page.getByText('That passkey could not be verified. Try again, or use another method.')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addScriptTag({ content: axe.source });
  const accessibility = await page.evaluate(() => window.axe.run(document.querySelector('[aria-labelledby="admin-mfa-title"]')!));
  expect(accessibility.violations.map(violation => violation.id)).toEqual([]);
  await page.screenshot({ path: 'test-results/auth-keyboard/mfa-passkey-1440.png' });
  let optionRequests = 0;
  page.on('request', request => { if (request.url().includes('/webauthn/options')) optionRequests++; });
  await activate(page, passkey, 'Space'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/?$/);
  const registered = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(registered.credentials[0].signCount).toBeGreaterThan(0);
  expect(optionRequests).toBe(1);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await logout(); await page.goto('/admin/analytics'); await expect(page).toHaveURL(/\/admin\/login/);
});

test('unsupported passkey browser and expired sign-in return to usable password form', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true }); });
  await page.clock.install(); await password(page);
  await page.getByRole('tab', { name: 'Authenticator app' }).focus(); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Authenticator app' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Use passkey' })).toBeDisabled();
  await expect(page.getByText(/Passkeys are not available in this browser/)).toBeVisible();
  await page.clock.fastForward(301_000);
  await expect(page.getByText('Your sign-in attempt expired. Start again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled();
});

test('customer password login and visibility toggle use native keyboard semantics', async ({ page }) => {
  await page.goto('/');
  await activate(page, page.getByRole('button', { name: 'Account', exact: true }));
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Email Address' }).focus(); await page.keyboard.type(credentials.customerEmail);
  const passwordInput = dialog.getByLabel('Password', { exact: true });
  await passwordInput.focus(); await page.keyboard.type(credentials.password);
  await activate(page, dialog.getByRole('button', { name: 'Show password' }), 'Space');
  await expect(passwordInput).toHaveAttribute('type', 'text');
  await activate(page, dialog.getByRole('button', { name: 'Hide password' }));
  await passwordInput.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/account/);
});

for (const kind of ['invitation', 'activation'] as const) {
  test(`${kind} acceptance, enrollment and password/delete safeguards work with Enter`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(kind === 'invitation' ? `/admin/invite#token=${credentials.invitationToken}` : `/admin/activate#token=${credentials.activationToken}`);
    if (kind === 'invitation') {
      await page.getByLabel('First name', { exact: true }).focus(); await page.keyboard.type('Keyboard');
      await page.keyboard.press('Tab'); await page.keyboard.type('Invitee');
    }
    const newPassword = `Keyboard-${kind}-9-Password`;
    await page.getByLabel(kind === 'invitation' ? 'Create a password' : 'New password', { exact: true }).focus(); await page.keyboard.type(newPassword);
    await page.getByLabel('Confirm password', { exact: true }).focus(); await page.keyboard.type(newPassword); await page.keyboard.press('Enter');
    await activate(page, page.getByRole('button', { name: 'Set up authenticator app' }));
    const secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
    // Exercise genuine full-code clipboard paste on the actual OTP input.
    await page.evaluate(code => navigator.clipboard.writeText(code), totp(secret));
    await page.getByRole('textbox', { name: 'Code from your app' }).focus(); await page.keyboard.press('ControlOrMeta+V'); await page.keyboard.press('Enter');
    await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
    await activate(page, page.getByLabel('I have saved these codes somewhere safe.'), 'Space');
    await activate(page, page.getByRole('button', { name: 'I have saved my codes, continue' })); await expect(page).toHaveURL(/\/admin\/?$/);
    await page.goto('/admin/profile');
    const current = page.getByLabel('Current password', { exact: true });
    await current.focus(); await page.keyboard.press('Enter');
    await expect(page.getByText('Enter your current password.')).toBeVisible();
    await activate(page, page.getByRole('button', { name: 'Delete My Administrator Account' }));
    const deletion = page.getByRole('dialog');
    await page.keyboard.press('Enter');
    await expect(deletion).toBeVisible();
    await page.keyboard.press('Escape'); await expect(deletion).toBeHidden();
    await expect(page.getByRole('button', { name: 'Delete My Administrator Account' })).toBeFocused();
  });
}
